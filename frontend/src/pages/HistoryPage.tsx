import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { api, downloadFileBlob } from '../lib/api'
import { hexToRgba } from '../lib/colors'
import type { Match, Tournament } from '../types'

type Tab = 'matches' | 'movements' | 'audit-logs'

interface MovementLog {
  movement_log_id: string
  entry_id: string
  from_court_no: number | null
  to_court_no: number | null
  movement_reason: string
  match_id: string | null
  created_at: string
}

interface AuditLog {
  audit_log_id: string
  actor_admin_id: string
  action_type: string
  target_type: string
  target_id: string
  created_at: string
}

export function HistoryPage() {
  const { tid } = useParams<{ tid: string }>()
  const [tab, setTab] = useState<Tab>('matches')
  const [page, setPage] = useState(1)
  const [courtFilter, setCourtFilter] = useState('')

  const { data: matchData, isLoading: matchLoading } = useQuery({
    queryKey: ['history-matches', tid, page, courtFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: '30' })
      if (courtFilter) params.set('court_no', courtFilter)
      const res = await api<Match[]>(`/api/admin-history/${tid}/matches?${params}`)
      return { data: res.data || [], meta: res.meta }
    },
    enabled: !!tid && tab === 'matches',
  })

  const { data: movementData, isLoading: movementLoading } = useQuery({
    queryKey: ['history-movements', tid, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: '30' })
      const res = await api<MovementLog[]>(`/api/admin-history/${tid}/movements?${params}`)
      return { data: res.data || [], meta: res.meta }
    },
    enabled: !!tid && tab === 'movements',
  })

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['history-audit', tid, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), page_size: '30' })
      const res = await api<AuditLog[]>(`/api/admin-history/${tid}/audit-logs?${params}`)
      return { data: res.data || [], meta: res.meta }
    },
    enabled: !!tid && tab === 'audit-logs',
  })

  const { data: tournament } = useQuery({
    queryKey: ['history-tournament', tid],
    queryFn: async () => {
      const res = await api<Tournament>(`/api/admin-tournaments/${tid}`)
      return res.data || null
    },
    enabled: !!tid,
  })

  function handleTabChange(newTab: Tab) {
    setTab(newTab)
    setPage(1)
  }

  async function downloadCsv(kind: string) {
    try {
      await downloadFileBlob(`/api/admin-history/${tid}/exports/${kind}.csv`, `${kind}.csv`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ダウンロードに失敗しました')
    }
  }

  async function downloadPdf() {
    try {
      await downloadFileBlob(`/api/admin-history/${tid}/exports/results.pdf`, 'results.pdf')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ダウンロードに失敗しました')
    }
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`

  const reasonLabel: Record<string, string> = {
    win: '勝利',
    loss: '敗北',
    manual: '手動移動',
    rollback: 'ロールバック',
    manual_requeue: '手動再配置',
    auto_remove_due_to_status: '状態変更除外',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">履歴</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCsv(tab === 'audit-logs' ? 'audit-logs' : tab)}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
          >
            <Download className="w-4 h-4" />
            CSV ダウンロード
          </button>
          <button
            onClick={downloadPdf}
            disabled={tournament?.state !== 'ended'}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            title={tournament?.state !== 'ended' ? 'PDF は大会終了後に出力できます' : '全結果 PDF をダウンロード'}
          >
            <Download className="w-4 h-4" />
            PDF ダウンロード
          </button>
        </div>
      </div>

      {/* タブ */}
      <div className="flex border-b mb-6">
        <button className={tabClass('matches')} onClick={() => handleTabChange('matches')}>試合履歴</button>
        <button className={tabClass('movements')} onClick={() => handleTabChange('movements')}>移動履歴</button>
        <button className={tabClass('audit-logs')} onClick={() => handleTabChange('audit-logs')}>監査ログ</button>
      </div>

      {/* 試合履歴タブ */}
      {tab === 'matches' && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm text-gray-600">コート:</label>
            <input
              type="number"
              value={courtFilter}
              onChange={(e) => { setCourtFilter(e.target.value); setPage(1) }}
              placeholder="全て"
              className="w-20 px-2 py-1 border rounded text-sm"
            />
          </div>
          {matchLoading ? (
            <p className="text-gray-500">読み込み中...</p>
          ) : (
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-3 py-2 text-left">コート</th>
                    <th className="px-3 py-2 text-left">勝者</th>
                    <th className="px-3 py-2 text-left">敗者</th>
                    <th className="px-3 py-2 text-left">スコア</th>
                    <th className="px-3 py-2 text-left">状態</th>
                    <th className="px-3 py-2 text-left">日時</th>
                  </tr>
                </thead>
                <tbody>
                  {(matchData?.data || []).map((m: Match) => {
                    const aSnap = m.entry_a_snapshot
                    const bSnap = m.entry_b_snapshot
                    const aName = aSnap?.display_name || m.entry_a_id.slice(0, 8)
                    const bName = bSnap?.display_name || m.entry_b_id.slice(0, 8)
                    // 勝者を左、敗者を右に表示（打ち切り等で勝者なしならそのまま）
                    const swapped = m.winner_entry_id === m.entry_b_id
                    const leftName = swapped ? bName : aName
                    const leftColor = swapped ? bSnap?.team_color : aSnap?.team_color
                    const rightName = swapped ? aName : bName
                    const rightColor = swapped ? aSnap?.team_color : bSnap?.team_color
                    const leftScore = swapped ? m.score_b : m.score_a
                    const rightScore = swapped ? m.score_a : m.score_b
                    const hasResult = !!m.winner_entry_id
                    return (
                      <tr key={m.match_id} className="border-b">
                        <td className="px-3 py-2 text-center font-medium">{m.court_no}</td>
                        <td className="px-3 py-2">
                          <MatchEntryCell name={leftName} teamColor={leftColor} isWinner={hasResult} hasResult={hasResult} />
                        </td>
                        <td className="px-3 py-2">
                          <MatchEntryCell name={rightName} teamColor={rightColor} isWinner={false} hasResult={hasResult} />
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">{leftScore ?? '-'} - {rightScore ?? '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${m.state === 'finished' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {m.state === 'finished' ? '完了' : 'キャンセル'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">
                          {m.finished_at ? new Date(m.finished_at).toLocaleString('ja-JP') : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 移動履歴タブ */}
      {tab === 'movements' && (
        <div>
          {movementLoading ? (
            <p className="text-gray-500">読み込み中...</p>
          ) : (
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-3 py-2 text-left">エントリー</th>
                    <th className="px-3 py-2 text-left">移動元</th>
                    <th className="px-3 py-2 text-left">移動先</th>
                    <th className="px-3 py-2 text-left">理由</th>
                    <th className="px-3 py-2 text-left">日時</th>
                  </tr>
                </thead>
                <tbody>
                  {(movementData?.data || []).map((m: MovementLog) => (
                    <tr key={m.movement_log_id} className="border-b">
                      <td className="px-3 py-2 font-mono text-xs">{m.entry_id.slice(0, 8)}</td>
                      <td className="px-3 py-2">{m.from_court_no ?? '-'}</td>
                      <td className="px-3 py-2">{m.to_court_no ?? '-'}</td>
                      <td className="px-3 py-2">{reasonLabel[m.movement_reason] || m.movement_reason}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{new Date(m.created_at).toLocaleString('ja-JP')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 監査ログタブ */}
      {tab === 'audit-logs' && (
        <div>
          {auditLoading ? (
            <p className="text-gray-500">読み込み中...</p>
          ) : (
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-3 py-2 text-left">操作者</th>
                    <th className="px-3 py-2 text-left">操作</th>
                    <th className="px-3 py-2 text-left">対象</th>
                    <th className="px-3 py-2 text-left">日時</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditData?.data || []).map((m: AuditLog) => (
                    <tr key={m.audit_log_id} className="border-b">
                      <td className="px-3 py-2 font-mono text-xs">{m.actor_admin_id.slice(0, 8)}</td>
                      <td className="px-3 py-2">{m.action_type}</td>
                      <td className="px-3 py-2">{m.target_type}/{m.target_id?.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{new Date(m.created_at).toLocaleString('ja-JP')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ページング */}
      <div className="flex items-center justify-center gap-4 mt-6">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="px-3 py-1 border rounded text-sm disabled:opacity-50"
        >
          前へ
        </button>
        <span className="text-sm text-gray-600">ページ {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1 border rounded text-sm"
        >
          次へ
        </button>
      </div>
    </div>
  )
}

function MatchEntryCell({ name, teamColor, isWinner, hasResult }: { name: string; teamColor?: string | null; isWinner: boolean; hasResult: boolean }) {
  const bg = hexToRgba(teamColor, 0.18)
  return (
    <span className="inline-flex items-center gap-1 text-sm rounded px-2 py-0.5" style={bg ? { backgroundColor: bg } : undefined}>
      {hasResult && (
        <span className={isWinner ? 'text-green-600' : 'text-red-400'}>
          {isWinner ? '◯' : '×'}
        </span>
      )}
      {name}
    </span>
  )
}
