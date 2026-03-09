import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, RotateCcw, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { useRealtime } from '../hooks/useRealtime'
import { CourtCard } from '../components/court/CourtCard'
import { ResultInputDialog } from '../components/match/ResultInputDialog'
import type { DashboardData, Match } from '../types'

export function DashboardPage() {
  const { tid } = useParams<{ tid: string }>()
  const queryClient = useQueryClient()
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', tid],
    queryFn: async () => {
      const res = await api<DashboardData>(`/api/admin-tournaments/${tid}/dashboard`)
      return res.data!
    },
    enabled: !!tid,
  })

  const onRevisionChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
  }, [queryClient, tid])

  useRealtime(tid, onRevisionChange)

  const startMutation = useMutation({
    mutationFn: () => api(`/api/admin-tournaments/${tid}/actions/start`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success('大会を開始しました'); queryClient.invalidateQueries({ queryKey: ['dashboard', tid] }) },
    onError: () => toast.error('大会の開始に失敗しました'),
  })

  const endMutation = useMutation({
    mutationFn: () => api(`/api/admin-tournaments/${tid}/actions/end`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success('大会を終了しました'); queryClient.invalidateQueries({ queryKey: ['dashboard', tid] }) },
    onError: (err) => toast.error(err instanceof Error ? err.message : '大会の終了に失敗しました'),
  })

  const courtActionMutation = useMutation({
    mutationFn: async ({ courtNo, action, body }: { courtNo: number; action: string; body?: Record<string, unknown> }) => {
      const res = await api(`/api/admin-courts/${tid}/${courtNo}/actions/${action}`, {
        method: 'POST',
        body: body || {},
      })
      if (res.error) throw new Error((res.error as { message: string }).message)
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const rollbackMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const res = await api(`/api/admin-matches/${tid}/matches/${matchId}/rollback`, {
        method: 'POST',
        body: {},
      })
      if (res.error) throw new Error((res.error as { message: string }).message)
      return res
    },
    onSuccess: () => {
      toast.success('結果を取り消しました')
      queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading || !data) {
    return <div className="text-center text-gray-500 py-12">読み込み中...</div>
  }

  const { tournament, courts, current_matches, queue_items, recent_finished_matches } = data

  const stateLabel: Record<string, string> = { preparing: '準備中', live: '進行中', ended: '終了' }
  const stateColor: Record<string, string> = {
    preparing: 'bg-yellow-100 text-yellow-800',
    live: 'bg-green-100 text-green-800',
    ended: 'bg-gray-100 text-gray-600',
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{tournament.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stateColor[tournament.state]}`}>
              {stateLabel[tournament.state]}
            </span>
            <span className="text-xs text-gray-500">Rev.{tournament.revision}</span>
            {tournament.public_enabled && (
              <Link
                to={`/public/${tournament.public_token}`}
                target="_blank"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                <ExternalLink className="w-3 h-3" />
                公開画面
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tournament.state === 'preparing' && (
            <>
              <button
                onClick={() => { if (confirm('大会を開始しますか？')) startMutation.mutate() }}
                className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700"
              >
                <Play className="w-4 h-4" />
                大会開始
              </button>
            </>
          )}
          {tournament.state === 'live' && (
            <button
              onClick={() => { if (confirm('大会を終了しますか？')) endMutation.mutate() }}
              className="flex items-center gap-1.5 bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700"
            >
              <Square className="w-4 h-4" />
              大会終了
            </button>
          )}
          {tournament.state === 'ended' && (
            <button
              onClick={async () => {
                if (confirm('大会を再開しますか？')) {
                  await api(`/api/admin-tournaments/${tid}/actions/reopen`, { method: 'POST', body: {} })
                  queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
                  toast.success('大会を再開しました')
                }
              }}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
            >
              <RotateCcw className="w-4 h-4" />
              再開
            </button>
          )}
        </div>
      </div>

      {/* コートグリッド */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {courts.map((court) => {
          const match = current_matches.find((m) => m.court_no === court.court_no)
          const queue = queue_items.filter((q) => q.court_no === court.court_no)
          const lastFinished = (recent_finished_matches || []).find((m) => m.court_no === court.court_no) || null
          return (
            <CourtCard
              key={court.court_no}
              court={court}
              currentMatch={match || null}
              lastFinishedMatch={lastFinished}
              queue={queue}
              tournamentState={tournament.state}
              onResultInput={match ? () => setSelectedMatch(match) : undefined}
              onStopCourt={() => {
                if (confirm(`コート ${court.court_no} を停止しますか？`)) {
                  courtActionMutation.mutate({ courtNo: court.court_no, action: 'stop' })
                  toast.success(`コート ${court.court_no} を停止しました`)
                }
              }}
              onResumeCourt={() => {
                if (confirm(`コート ${court.court_no} を再開しますか？`)) {
                  courtActionMutation.mutate({ courtNo: court.court_no, action: 'resume' })
                  toast.success(`コート ${court.court_no} を再開しました`)
                }
              }}
              onRecalculate={() => {
                courtActionMutation.mutate({ courtNo: court.court_no, action: 'recalculate' })
              }}
              onClearMatch={() => {
                if (confirm('現在対戦を手動解消しますか？両エントリーが待機列末尾へ戻ります。')) {
                  courtActionMutation.mutate({ courtNo: court.court_no, action: 'clear-current-match', body: { requeue_mode: 'tail_keep_order' } })
                  toast.success('対戦を解消しました')
                }
              }}
              onRollback={(matchId) => {
                if (confirm('直前の結果を取り消しますか？')) {
                  rollbackMutation.mutate(matchId)
                }
              }}
            />
          )
        })}
      </div>

      {/* 結果入力ダイアログ */}
      {selectedMatch && tid && (
        <ResultInputDialog
          match={selectedMatch}
          tournamentId={tid}
          gamePoint={tournament.game_point}
          onClose={() => setSelectedMatch(null)}
          onConfirmed={() => {
            setSelectedMatch(null)
            queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
          }}
        />
      )}
    </div>
  )
}
