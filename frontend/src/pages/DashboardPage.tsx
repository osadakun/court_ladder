import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, RotateCcw, ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DndContext, DragOverlay, pointerWithin, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core'
import { api } from '../lib/api'
import { useRealtime } from '../hooks/useRealtime'
import { CourtCard } from '../components/court/CourtCard'
import { ResultInputDialog } from '../components/match/ResultInputDialog'
import { RequestMatchDialog } from '../components/match/RequestMatchDialog'
import type { DashboardData, Match, Entry } from '../types'

export function DashboardPage() {
  const { tid } = useParams<{ tid: string }>()
  const queryClient = useQueryClient()
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null)
  const [showRequestMatch, setShowRequestMatch] = useState(false)
  const [allEntries, setAllEntries] = useState<Entry[]>([])
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

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

  // D&D: エントリーを別コートへ移動
  const moveEntryMutation = useMutation({
    mutationFn: async ({ entryId, fromCourtNo, toCourtNo, isInProgress }: { entryId: string; fromCourtNo: number; toCourtNo: number; isInProgress: boolean }) => {
      // 1. 移動先コートが有効か事前チェック
      const targetCourtRes = await api<{ court: { status: string } }>(`/api/admin-courts/${tid}/${toCourtNo}/`)
      if (targetCourtRes.error) throw new Error('移動先コートが見つかりません')
      if (targetCourtRes.data?.court?.status === 'stopped') throw new Error('停止中のコートには移動できません')

      // 2. in_progress の場合はまず現在対戦を解消
      if (isInProgress) {
        const clearRes = await api(`/api/admin-courts/${tid}/${fromCourtNo}/actions/clear-current-match`, {
          method: 'POST',
          body: { requeue_mode: 'tail_keep_order' },
        })
        if (clearRes.error) throw new Error(clearRes.error.message)
      }

      // 3. 元コートのキューからドラッグ対象を除外
      const courtRes = await api<{ queue: { entry_id: string; queue_position: number }[] }>(
        `/api/admin-courts/${tid}/${fromCourtNo}/`,
      )
      const fullQueue = (courtRes.data?.queue || [])
        .sort((a, b) => a.queue_position - b.queue_position)
      const filteredIds = fullQueue.filter((q) => q.entry_id !== entryId).map((q) => q.entry_id)
      const patchRes = await api(`/api/admin-courts/${tid}/${fromCourtNo}/queue`, {
        method: 'PATCH',
        body: { entry_ids: filteredIds },
      })
      if (patchRes.error) {
        throw new Error(patchRes.error.message)
      }

      // 4. 移動先コートの待機列に追加
      const res = await api(`/api/admin-courts/${tid}/${toCourtNo}/queue/entries`, {
        method: 'POST',
        body: { entry_id: entryId },
      })
      if (res.error) {
        // 移動先追加失敗 → 元コートに復元
        const restoreIds = fullQueue.map((q) => q.entry_id)
        await api(`/api/admin-courts/${tid}/${fromCourtNo}/queue`, {
          method: 'PATCH',
          body: { entry_ids: restoreIds },
        })
        throw new Error(res.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // D&D: 待機列の並べ替え
  const reorderMutation = useMutation({
    mutationFn: async ({ courtNo, entryIds }: { courtNo: number; entryIds: string[] }) => {
      const res = await api(`/api/admin-courts/${tid}/${courtNo}/queue`, {
        method: 'PATCH',
        body: { entry_ids: entryIds },
      })
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', tid] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    const { active, over } = event
    if (!over || !data) return

    const activeId = active.id as string
    const overId = over.id as string

    // Parse drag IDs: "queue-{courtNo}-{entryId}" or "match-{courtNo}-{entryId}" or "court-drop-{courtNo}"
    const activeMatch = activeId.match(/^(queue|match)-(\d+)-(.+)$/)
    if (!activeMatch) return

    const sourceType = activeMatch[1] as 'queue' | 'match'
    const sourceCourtNo = parseInt(activeMatch[2])
    const entryId = activeMatch[3]

    // Determine target court
    let targetCourtNo: number | null = null

    const overCourtDrop = overId.match(/^court-drop-(\d+)$/)
    if (overCourtDrop) {
      targetCourtNo = parseInt(overCourtDrop[1])
    } else {
      const overMatch = overId.match(/^(queue|match)-(\d+)-(.+)$/)
      if (overMatch) {
        targetCourtNo = parseInt(overMatch[2])
      }
    }

    if (targetCourtNo === null) return

    if (sourceCourtNo === targetCourtNo && sourceType === 'queue') {
      // Same court reorder
      const courtQueue = queue_items
        .filter((q) => q.court_no === sourceCourtNo)
        .sort((a, b) => a.queue_position - b.queue_position)

      const oldIndex = courtQueue.findIndex((q) => q.entry_id === entryId)
      const overQueueMatch = overId.match(/^queue-\d+-(.+)$/)
      const newIndex = overQueueMatch
        ? courtQueue.findIndex((q) => q.entry_id === overQueueMatch[1])
        : courtQueue.length - 1

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newOrder = [...courtQueue]
        const [moved] = newOrder.splice(oldIndex, 1)
        newOrder.splice(newIndex, 0, moved)
        reorderMutation.mutate({
          courtNo: sourceCourtNo,
          entryIds: newOrder.map((q) => q.entry_id),
        })
      }
    } else if (sourceCourtNo !== targetCourtNo) {
      // Cross-court move
      if (sourceType === 'match') {
        // in_progress エントリーの移動は現在対戦がキャンセルされるため確認必須
        if (!confirm(`コート ${sourceCourtNo} の現在対戦が解消されます。コート ${targetCourtNo} へ移動しますか？`)) return
      }
      moveEntryMutation.mutate({
        entryId,
        fromCourtNo: sourceCourtNo,
        toCourtNo: targetCourtNo,
        isInProgress: sourceType === 'match',
      })
    }
  }

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
            <>
              <button
                onClick={async () => {
                  const res = await api<Entry[]>(`/api/admin-entries/${tid}`)
                  setAllEntries(res.data || [])
                  setShowRequestMatch(true)
                }}
                className="flex items-center gap-1.5 bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700"
              >
                <Plus className="w-4 h-4" />
                リクエスト試合
              </button>
              <button
                onClick={() => { if (confirm('大会を終了しますか？')) endMutation.mutate() }}
                className="flex items-center gap-1.5 bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700"
              >
                <Square className="w-4 h-4" />
                大会終了
              </button>
            </>
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

      {/* コートグリッド (D&D対応) */}
      <DndContext
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
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
                isDndEnabled={tournament.state === 'live'}
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
        <DragOverlay>
          {activeDragId ? (
            <div className="bg-blue-100 border border-blue-300 rounded px-3 py-1.5 text-sm shadow-lg opacity-80">
              移動中...
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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

      {/* リクエスト試合作成ダイアログ */}
      {showRequestMatch && tid && (
        <RequestMatchDialog
          tournamentId={tid}
          entries={allEntries}
          onClose={() => setShowRequestMatch(false)}
          onCreated={(createdMatch) => {
            setShowRequestMatch(false)
            setSelectedMatch(createdMatch)
          }}
        />
      )}
    </div>
  )
}
