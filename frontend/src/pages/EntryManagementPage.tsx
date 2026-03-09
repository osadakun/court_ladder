import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserCheck, UserX, Pause, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { buildDisplayName } from '../lib/displayName'
import type { Court, Entry, Team } from '../types'

const VALID_GRADES = ['年長', '小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '大人'] as const

function groupEntriesByTeam(entries: Entry[]) {
  const map = new Map<string, { teamId: string | null; teamName: string; colorCode: string | null; entries: Entry[] }>()
  for (const entry of entries) {
    const key = entry.team?.team_name || ''
    if (!map.has(key)) {
      map.set(key, {
        teamId: entry.team_id,
        teamName: entry.team?.team_name || 'チームなし',
        colorCode: entry.team?.color_code || null,
        entries: [],
      })
    }
    map.get(key)!.entries.push(entry)
  }
  // チーム名の五十音順、チームなしは末尾
  const groups = [...map.values()].sort((a, b) => {
    if (!a.teamId) return 1
    if (!b.teamId) return -1
    return a.teamName.localeCompare(b.teamName, 'ja')
  })
  // 各グループ内はシングルス→ダブルス、同種別内は表示名の五十音順
  for (const group of groups) {
    group.entries.sort((a, b) => {
      if (a.entry_type !== b.entry_type) return a.entry_type === 'singles' ? -1 : 1
      return buildDisplayName(a).localeCompare(buildDisplayName(b), 'ja')
    })
  }
  return groups
}

export function EntryManagementPage() {
  const { tid } = useParams<{ tid: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['entries', tid],
    queryFn: async () => {
      const res = await api<Entry[]>(`/api/admin-entries/${tid}/`, { method: 'GET' })
      return res.data || []
    },
    enabled: !!tid,
  })

  const { data: teams = [] } = useQuery({
    queryKey: ['teams', tid],
    queryFn: async () => {
      const res = await api<Team[]>(`/api/admin-teams/${tid}/`)
      return res.data || []
    },
    enabled: !!tid,
  })

  const { data: courts = [] } = useQuery({
    queryKey: ['courts', tid],
    queryFn: async () => {
      const res = await api<Court[]>(`/api/admin-courts/${tid}/`)
      return res.data || []
    },
    enabled: !!tid,
  })

  const statusIcon: Record<string, React.ReactNode> = {
    active: <UserCheck className="w-3.5 h-3.5 text-green-600" />,
    paused: <Pause className="w-3.5 h-3.5 text-yellow-600" />,
    withdrawn: <UserX className="w-3.5 h-3.5 text-red-600" />,
  }
  const statusLabel: Record<string, string> = { active: '有効', paused: '休止', withdrawn: '棄権' }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">エントリー管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/tournaments/${tid}/import`)}
            className="flex items-center gap-1.5 bg-gray-100 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-200"
          >
            <Upload className="w-4 h-4" />
            CSV 取込
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            エントリー追加
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">読み込み中...</div>
      ) : entries.length === 0 ? (
        <div className="text-center text-gray-500 py-12">エントリーがありません。</div>
      ) : (
        <div className="space-y-4">
          {groupEntriesByTeam(entries).map((group) => (
            <div key={group.teamId || '_none'} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-2">
                {group.colorCode && (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: group.colorCode }} />
                )}
                <span className="font-semibold text-sm text-gray-700">{group.teamName}</span>
                <span className="text-xs text-gray-400 ml-1">{group.entries.length}件</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50/50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-1.5 font-medium text-xs">表示名</th>
                    <th className="text-left px-4 py-1.5 font-medium text-xs">種別</th>
                    <th className="text-left px-4 py-1.5 font-medium text-xs">状態</th>
                    <th className="text-right px-4 py-1.5 font-medium text-xs">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.entries.map((entry) => (
                    <tr key={entry.entry_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-800">{buildDisplayName(entry)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{entry.entry_type === 'singles' ? 'シングルス' : 'ダブルス'}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1">
                          {statusIcon[entry.status]}
                          {statusLabel[entry.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <StatusChangeButtons entry={entry} tournamentId={tid!} queryClient={queryClient} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {showCreate && tid && (
        <CreateEntryDialog
          tournamentId={tid}
          teams={teams}
          courts={courts}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            queryClient.invalidateQueries({ queryKey: ['entries', tid] })
          }}
        />
      )}
    </div>
  )
}

function StatusChangeButtons({ entry, tournamentId, queryClient }: { entry: Entry; tournamentId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const mutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await api(`/api/admin-entries/${tournamentId}/${entry.entry_id}`, {
        method: 'PATCH',
        body: { version: entry.version, status: newStatus },
      })
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', tournamentId] })
      toast.success('状態を変更しました')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (entry.status === 'active') {
    return (
      <div className="flex gap-1 justify-end">
        <button onClick={() => mutation.mutate('paused')} className="text-xs px-2 py-1 text-yellow-700 hover:bg-yellow-50 rounded">休止</button>
        <button onClick={() => mutation.mutate('withdrawn')} className="text-xs px-2 py-1 text-red-700 hover:bg-red-50 rounded">棄権</button>
      </div>
    )
  }
  return (
    <button onClick={() => mutation.mutate('active')} className="text-xs px-2 py-1 text-green-700 hover:bg-green-50 rounded">復帰</button>
  )
}

function CreateEntryDialog({ tournamentId, teams, courts, onClose, onCreated }: {
  tournamentId: string; teams: Team[]; courts: Court[]; onClose: () => void; onCreated: () => void
}) {
  const [entryType, setEntryType] = useState<'singles' | 'doubles'>('singles')
  const [teamId, setTeamId] = useState('')
  const [member1, setMember1] = useState('')
  const [member1Grade, setMember1Grade] = useState<(typeof VALID_GRADES)[number]>('中1')
  const [member2, setMember2] = useState('')
  const [member2Grade, setMember2Grade] = useState<(typeof VALID_GRADES)[number]>('中1')
  const [initialCourtNo, setInitialCourtNo] = useState('')

  const availableCourts = courts.filter((court) => court.court_type === entryType)

  const mutation = useMutation({
    mutationFn: async () => {
      const members = entryType === 'singles'
        ? [{ management_name: member1, grade: member1Grade }]
        : [
            { management_name: member1, grade: member1Grade },
            { management_name: member2, grade: member2Grade },
          ]
      const res = await api(`/api/admin-entries/${tournamentId}/`, {
        method: 'POST',
        body: {
          entry_type: entryType,
          team_id: teamId || null,
          initial_court_no: Number(initialCourtNo),
          members,
        },
      })
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => { toast.success('エントリーを追加しました'); onCreated() },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">エントリー追加</h2>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">種別</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEntryType('singles')} className={`px-3 py-1.5 text-sm rounded-md border ${entryType === 'singles' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300'}`}>シングルス</button>
              <button type="button" onClick={() => setEntryType('doubles')} className={`px-3 py-1.5 text-sm rounded-md border ${entryType === 'doubles' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300'}`}>ダブルス</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">チーム</label>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">なし</option>
              {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メンバー1</label>
            <input value={member1} onChange={(e) => setMember1(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メンバー1学年</label>
            <select value={member1Grade} onChange={(e) => setMember1Grade(e.target.value as (typeof VALID_GRADES)[number])} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              {VALID_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
            </select>
          </div>
          {entryType === 'doubles' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メンバー2</label>
                <input value={member2} onChange={(e) => setMember2(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メンバー2学年</label>
                <select value={member2Grade} onChange={(e) => setMember2Grade(e.target.value as (typeof VALID_GRADES)[number])} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                  {VALID_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">初期コート</label>
            <select value={initialCourtNo} onChange={(e) => setInitialCourtNo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required>
              <option value="">選択してください</option>
              {availableCourts.map((court) => (
                <option key={court.court_id} value={court.court_no}>
                  コート {court.court_no}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">キャンセル</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? '追加中...' : '追加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
