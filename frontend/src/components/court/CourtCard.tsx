import { Swords, PauseCircle, Users, Play, StopCircle, RotateCcw, XCircle, Undo2, GripVertical } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Court, Match, QueueItem } from '../../types'
import { hexToRgba } from '../../lib/colors'
import { buildDisplayName } from '../../lib/displayName'

interface Props {
  court: Court
  currentMatch: Match | null
  lastFinishedMatch?: Match | null
  queue: QueueItem[]
  tournamentState: string
  isDndEnabled?: boolean
  onResultInput?: () => void
  onStopCourt?: () => void
  onResumeCourt?: () => void
  onRecalculate?: () => void
  onClearMatch?: () => void
  onRollback?: (matchId: string) => void
}

export function CourtCard({ court, currentMatch, lastFinishedMatch, queue, tournamentState, isDndEnabled, onResultInput, onStopCourt, onResumeCourt, onRecalculate, onClearMatch, onRollback }: Props) {
  const isStopped = court.status === 'stopped'

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `court-drop-${court.court_no}`,
    disabled: !isDndEnabled,
  })

  return (
    <div
      ref={setDropRef}
      className={`bg-white rounded-lg border ${isStopped ? 'border-red-200 bg-red-50/30' : isOver ? 'border-blue-400 bg-blue-50/30' : 'border-gray-200'} overflow-hidden transition-colors`}
    >
      {/* ヘッダー */}
      <div className={`px-4 py-2 flex items-center justify-between ${isStopped ? 'bg-red-50' : 'bg-gray-50'} border-b`}>
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-gray-900">コート {court.court_no}</span>
          {isStopped && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <PauseCircle className="w-3.5 h-3.5" />
              停止中
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 mr-1">
            <Users className="w-3.5 h-3.5 inline mr-0.5" />
            {queue.length}
          </span>
          {tournamentState === 'live' && (
            isStopped ? (
              onResumeCourt && (
                <button onClick={onResumeCourt} className="p-1 hover:bg-green-100 rounded" title="コート再開">
                  <Play className="w-3.5 h-3.5 text-green-600" />
                </button>
              )
            ) : (
              onStopCourt && (
                <button onClick={onStopCourt} className="p-1 hover:bg-red-100 rounded" title="コート停止">
                  <StopCircle className="w-3.5 h-3.5 text-red-500" />
                </button>
              )
            )
          )}
        </div>
      </div>

      {/* 現在対戦 */}
      <div className="px-4 py-3">
        {currentMatch ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Swords className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-medium text-gray-500">対戦中</span>
            </div>
            <div className="space-y-1.5">
              <DraggableEntry
                id={`match-${court.court_no}-${currentMatch.entry_a_id}`}
                enabled={!!isDndEnabled}
                snapshot={currentMatch.entry_a_snapshot}
              />
              <div className="text-xs text-gray-400 text-center">vs</div>
              <DraggableEntry
                id={`match-${court.court_no}-${currentMatch.entry_b_id}`}
                enabled={!!isDndEnabled}
                snapshot={currentMatch.entry_b_snapshot}
              />
            </div>
            {tournamentState === 'live' && (
              <div className="mt-3 space-y-1.5">
                {onResultInput && (
                  <button
                    onClick={onResultInput}
                    className="w-full bg-blue-600 text-white text-sm py-1.5 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    結果入力
                  </button>
                )}
                <div className="flex gap-1.5">
                  {onClearMatch && (
                    <button
                      onClick={onClearMatch}
                      className="flex-1 flex items-center justify-center gap-1 border border-gray-300 text-gray-600 text-xs py-1 rounded hover:bg-gray-50"
                      title="現在対戦を手動解消"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      解消
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-sm text-gray-400 py-4">
            対戦なし
            {tournamentState === 'live' && !isStopped && onRecalculate && queue.length >= 2 && (
              <button
                onClick={onRecalculate}
                className="mt-2 flex items-center justify-center gap-1 mx-auto text-xs text-blue-600 hover:text-blue-800"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                再計算
              </button>
            )}
          </div>
        )}
      </div>

      {/* 直近試合ロールバック */}
      {tournamentState === 'live' && lastFinishedMatch && lastFinishedMatch.match_type === 'regular' && onRollback && (
        <div className="border-t px-4 py-2">
          <button
            onClick={() => onRollback(lastFinishedMatch.match_id)}
            className="w-full flex items-center justify-center gap-1 border border-yellow-300 text-yellow-700 text-xs py-1 rounded hover:bg-yellow-50"
            title="直前の結果を取り消し"
          >
            <Undo2 className="w-3.5 h-3.5" />
            直前の結果を取消
          </button>
        </div>
      )}

      {/* 待機列プレビュー */}
      {queue.length > 0 && (
        <div className="border-t px-4 py-2">
          <div className="text-xs text-gray-500 mb-1.5">待機列</div>
          <div className="space-y-1">
            {queue.slice(0, 5).map((q) => (
              <DraggableQueueItem
                key={q.queue_item_id || q.entry_id}
                id={`queue-${court.court_no}-${q.entry_id}`}
                enabled={!!isDndEnabled}
                queueItem={q}
              />
            ))}
            {queue.length > 5 && (
              <div className="text-xs text-gray-400">他 {queue.length - 5} 組</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DraggableEntry({ id, enabled, snapshot }: {
  id: string
  enabled: boolean
  snapshot: { display_name: string; team_color: string | null; team_name: string | null } | null
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled: !enabled,
  })

  if (!snapshot) return <div className="text-sm text-gray-400">-</div>
  const backgroundColor = hexToRgba(snapshot.team_color, 0.18)

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-md px-2 py-1.5 flex items-center gap-1 ${enabled ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      {enabled && <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0" />}
      <span className="text-sm font-medium text-gray-800 truncate">{snapshot.display_name}</span>
    </div>
  )
}

function DraggableQueueItem({ id, enabled, queueItem }: {
  id: string
  enabled: boolean
  queueItem: QueueItem
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled: !enabled,
  })

  const entry = queueItem.entry
  const teamColor = entry?.team?.color_code
  const displayName = entry ? buildDisplayName(entry) : queueItem.entry_id.slice(0, 8) + '...'
  const backgroundColor = hexToRgba(teamColor, 0.18)

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`text-xs text-gray-600 flex items-center gap-1 ${enabled ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      {enabled && <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0" />}
      <span className="text-gray-400 w-4 text-right">{queueItem.queue_position}.</span>
      <div className="truncate rounded px-2 py-1 flex-1" style={backgroundColor ? { backgroundColor } : undefined}>
        <span className="truncate">{displayName}</span>
      </div>
    </div>
  )
}
