import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { PRESET_COLORS } from '../lib/constants'
import type { Team } from '../types'

export function TeamManagementPage() {
  const { tid } = useParams<{ tid: string }>()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['teams', tid],
    queryFn: async () => {
      const res = await api<Team[]>(`/api/admin-teams/${tid}/`)
      return res.data || []
    },
    enabled: !!tid,
  })

  const deleteMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const res = await api(`/api/admin-teams/${tid}/${teamId}`, { method: 'DELETE' })
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', tid] })
      toast.success('チームを削除しました')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">チーム管理</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          チーム追加
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">読み込み中...</div>
      ) : teams.length === 0 ? (
        <div className="text-center text-gray-500 py-12">チームがありません。</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {teams.map((team) => (
            <div key={team.team_id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full" style={{ backgroundColor: team.color_code }} />
                <span className="font-medium text-gray-800">{team.team_name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditingTeam(team)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { if (confirm(`${team.team_name} を削除しますか？`)) deleteMutation.mutate(team.team_id) }}
                  className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showCreate || editingTeam) && tid && (
        <TeamDialog
          tournamentId={tid}
          team={editingTeam}
          onClose={() => { setShowCreate(false); setEditingTeam(null) }}
          onSaved={() => {
            setShowCreate(false)
            setEditingTeam(null)
            queryClient.invalidateQueries({ queryKey: ['teams', tid] })
          }}
        />
      )}
    </div>
  )
}

function TeamDialog({ tournamentId, team, onClose, onSaved }: {
  tournamentId: string; team: Team | null; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(team?.team_name || '')
  const [color, setColor] = useState(team?.color_code || PRESET_COLORS[0])

  const mutation = useMutation({
    mutationFn: async () => {
      const url = team
        ? `/api/admin-teams/${tournamentId}/${team.team_id}`
        : `/api/admin-teams/${tournamentId}/`
      const res = await api(url, {
        method: team ? 'PATCH' : 'POST',
        body: { team_name: name, color_code: color },
      })
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => {
      toast.success(team ? 'チームを更新しました' : 'チームを追加しました')
      onSaved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">{team ? 'チーム編集' : 'チーム追加'}</h2>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">チーム名</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">チームカラー</label>
            <div className="grid grid-cols-10 gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">キャンセル</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50">
              {mutation.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
