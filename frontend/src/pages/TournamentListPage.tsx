import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Calendar, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import type { Tournament } from '../types'

export function TournamentListPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await api<Tournament[]>('/api/admin-tournaments/')
      return res.data || []
    },
  })

  const tournaments = data || []

  const stateLabel: Record<string, string> = {
    preparing: '準備中',
    live: '進行中',
    ended: '終了',
  }

  const stateColor: Record<string, string> = {
    preparing: 'bg-yellow-100 text-yellow-800',
    live: 'bg-green-100 text-green-800',
    ended: 'bg-gray-100 text-gray-600',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">大会一覧</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          大会を作成
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">読み込み中...</div>
      ) : tournaments.length === 0 ? (
        <div className="text-center text-gray-500 py-12">大会がありません。新しい大会を作成してください。</div>
      ) : (
        <div className="space-y-2">
          {tournaments.map((t) => (
            <Link
              key={t.tournament_id}
              to={`/tournaments/${t.tournament_id}`}
              className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-4">
                <div>
                  <div className="font-medium text-gray-900">{t.name}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <Calendar className="w-3.5 h-3.5" />
                    {t.event_date}
                    <span className="text-gray-300">|</span>
                    S{t.singles_court_count} / D{t.doubles_court_count}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stateColor[t.state]}`}>
                  {stateLabel[t.state]}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTournamentDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            queryClient.invalidateQueries({ queryKey: ['tournaments'] })
          }}
        />
      )}
    </div>
  )
}

function CreateTournamentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0])
  const [singlesCourtCount, setSinglesCourtCount] = useState(2)
  const [doublesCourtCount, setDoublesCourtCount] = useState(2)
  const [gamePoint, setGamePoint] = useState(21)
  const [allowSameTeamMatch, setAllowSameTeamMatch] = useState(true)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api('/api/admin-tournaments/', {
        method: 'POST',
        body: {
          name,
          event_date: eventDate,
          singles_court_count: singlesCourtCount,
          doubles_court_count: doublesCourtCount,
          game_point: gamePoint,
          allow_same_team_match: allowSameTeamMatch,
        },
      })
      if (res.error) throw new Error(res.error.message)
      return res
    },
    onSuccess: () => {
      toast.success('大会を作成しました')
      onCreated()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">大会を作成</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">大会名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">開催日</label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">シングルス</label>
              <input
                type="number"
                min={0}
                max={20}
                value={singlesCourtCount}
                onChange={(e) => setSinglesCourtCount(e.target.valueAsNumber)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ダブルス</label>
              <input
                type="number"
                min={0}
                max={20}
                value={doublesCourtCount}
                onChange={(e) => setDoublesCourtCount(e.target.valueAsNumber)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ゲームポイント</label>
              <input
                type="number"
                min={1}
                value={gamePoint}
                onChange={(e) => setGamePoint(e.target.valueAsNumber)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-7">
              <input
                type="checkbox"
                checked={allowSameTeamMatch}
                onChange={(e) => setAllowSameTeamMatch(e.target.checked)}
              />
              同一チーム対戦を許可
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? '作成中...' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
