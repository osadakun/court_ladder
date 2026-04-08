import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import type { Entry, Match } from '../../types'
import { hexToRgba } from '../../lib/colors'

interface Props {
  tournamentId: string
  entries: Entry[]
  onClose: () => void
  onCreated: (match: Match) => void
}

function getEntryDisplayName(entry: Entry): string {
  const members = (entry.entry_members || [])
    .sort((a, b) => a.member_order - b.member_order)
    .map((em) => {
      const grade = em.member.grade
      return grade ? `${grade}：${em.member.management_name}` : em.member.management_name
    })
  const names = members.join('・')
  return entry.team?.team_name ? `${names}（${entry.team.team_name}）` : names
}

export function RequestMatchDialog({ tournamentId, entries, onClose, onCreated }: Props) {
  const [entryAId, setEntryAId] = useState<string>('')
  const [entryBId, setEntryBId] = useState<string>('')
  const [note, setNote] = useState('')

  const activeEntries = entries.filter((e) => e.status === 'active')

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api<Match>(
        `/api/admin-matches/${tournamentId}/request-matches`,
        {
          method: 'POST',
          body: {
            entry_a_id: entryAId,
            entry_b_id: entryBId,
            note: note || undefined,
          },
        },
      )
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: (createdMatch) => {
      toast.success('リクエスト試合を作成しました')
      onCreated(createdMatch)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const isValid = entryAId && entryBId && entryAId !== entryBId

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b">
          <h2 className="font-bold text-gray-900">リクエスト試合作成</h2>
          <p className="text-xs text-gray-500 mt-1">待機列・コート移動に影響しません</p>
        </div>

        <div className="p-6 space-y-5">
          {/* エントリーA選択 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">エントリー A</label>
            <select
              value={entryAId}
              onChange={(e) => setEntryAId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {activeEntries.map((entry) => (
                <option key={entry.entry_id} value={entry.entry_id} disabled={entry.entry_id === entryBId}>
                  {getEntryDisplayName(entry)}
                </option>
              ))}
            </select>
            {entryAId && (
              <EntryPreview entry={activeEntries.find((e) => e.entry_id === entryAId)} />
            )}
          </div>

          {/* エントリーB選択 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">エントリー B</label>
            <select
              value={entryBId}
              onChange={(e) => setEntryBId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {activeEntries.map((entry) => (
                <option key={entry.entry_id} value={entry.entry_id} disabled={entry.entry_id === entryAId}>
                  {getEntryDisplayName(entry)}
                </option>
              ))}
            </select>
            {entryBId && (
              <EntryPreview entry={activeEntries.find((e) => e.entry_id === entryBId)} />
            )}
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">メモ（任意）</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="例: 再試合依頼"
            />
          </div>

          {/* アクションボタン */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
              キャンセル
            </button>
            <button
              disabled={!isValid || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? '作成中...' : '作成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EntryPreview({ entry }: { entry: Entry | undefined }) {
  if (!entry) return null
  const bg = entry.team?.color_code ? hexToRgba(entry.team.color_code, 0.14) : undefined
  return (
    <div
      className="mt-1 rounded-md px-3 py-1.5 text-sm"
      style={bg ? { backgroundColor: bg } : { backgroundColor: '#f3f4f6' }}
    >
      {getEntryDisplayName(entry)}
    </div>
  )
}
