import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trophy, Swords } from 'lucide-react'
import { hexToRgba } from '../lib/colors'
import { api } from '../lib/api'
import { useRealtime } from '../hooks/useRealtime'

interface PublicSnapshot {
  tournament: {
    tournament_id: string
    name: string
    public_page_title: string | null
    state: string
    event_date: string
    queue_display_limit: number
  }
  courts: {
    court_no: number
    status: string
    current_match: {
      entry_a: { display_name: string; team_color: string | null; team_name: string | null }
      entry_b: { display_name: string; team_color: string | null; team_name: string | null }
    } | null
    queue_preview: { position: number; display_name: string; team_color: string | null }[]
    queue_count: number
    remaining_queue_count: number
  }[]
}

export function PublicBoardPage() {
  const { token } = useParams<{ token: string }>()
  const queryClient = useQueryClient()
  const [tournamentId, setTournamentId] = useState<string | undefined>(undefined)

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-snapshot', token],
    queryFn: async () => {
      const res = await api<PublicSnapshot>(`/api/public-api/${token}/snapshot`)
      if (res.error) throw new Error(res.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'NETWORK_ERROR')
      return res.data!
    },
    refetchInterval: 3000,
    enabled: !!token,
  })

  useEffect(() => {
    if (data?.tournament.tournament_id) {
      setTournamentId(data.tournament.tournament_id)
    }
  }, [data?.tournament.tournament_id])

  const handleRevisionChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['public-snapshot', token] })
  }, [queryClient, token])

  useRealtime(tournamentId, handleRevisionChange)

  const title = data ? (data.tournament.public_page_title || data.tournament.name) : '公開盤面'

  useEffect(() => {
    document.title = title

    let robotsMeta = document.querySelector('meta[name="robots"]')
    let created = false

    if (!robotsMeta) {
      robotsMeta = document.createElement('meta')
      robotsMeta.setAttribute('name', 'robots')
      document.head.appendChild(robotsMeta)
      created = true
    }

    robotsMeta.setAttribute('content', 'noindex,nofollow,noarchive')

    return () => {
      if (created) {
        robotsMeta?.remove()
      } else {
        robotsMeta?.removeAttribute('content')
      }
    }
  }, [title])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    )
  }

  if (error) {
    const isNotFound = error instanceof Error && error.message === 'NOT_FOUND'
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className={isNotFound ? 'text-red-400' : 'text-gray-400'}>
          {isNotFound ? '大会が見つかりません' : '接続中...'}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* ヘッダー */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Trophy className="w-6 h-6 text-yellow-400" />
          <h1 className="text-xl font-bold">{title}</h1>
          <span className="ml-auto text-sm text-gray-400">{data.tournament.event_date}</span>
        </div>
      </header>

      {/* コートグリッド */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.courts.map((court) => (
            <div
              key={court.court_no}
              className={`rounded-lg border overflow-hidden ${
                court.status === 'stopped' ? 'border-red-800 bg-red-950/30' : 'border-gray-700 bg-gray-800'
              }`}
            >
              <div className={`px-4 py-2 flex items-center justify-between border-b ${court.status === 'stopped' ? 'border-red-800 bg-red-900/40' : 'border-gray-700 bg-gray-750'}`}>
                <span className="font-bold text-sm">コート {court.court_no}</span>
                {court.status === 'stopped' && <span className="text-xs text-red-400">停止中</span>}
              </div>

              <div className="px-4 py-3">
                {court.current_match ? (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Swords className="w-4 h-4 text-yellow-400" />
                      <span className="text-xs text-gray-400 font-medium">対戦中</span>
                    </div>
                    <PublicEntryDisplay entry={court.current_match.entry_a} />
                    <div className="text-xs text-gray-500 text-center my-1">vs</div>
                    <PublicEntryDisplay entry={court.current_match.entry_b} />
                  </div>
                ) : (
                  <div className="text-center text-gray-500 text-sm py-4">対戦なし</div>
                )}
              </div>

              {court.queue_preview.length > 0 && (
                <div className="border-t border-gray-700 px-4 py-2">
                  <div className="text-xs text-gray-500 mb-1">待機列</div>
                  {court.queue_preview.map((q) => (
                    <div key={q.position} className="flex items-center gap-2 text-xs text-gray-400 py-0.5">
                      <span className="w-4 text-right text-gray-600">{q.position}.</span>
                      <span
                        className="min-w-0 flex-1 truncate rounded px-2 py-1"
                        style={q.team_color ? { backgroundColor: hexToRgba(q.team_color, 0.18) ?? undefined } : undefined}
                      >
                        {q.display_name}
                      </span>
                    </div>
                  ))}
                  {court.remaining_queue_count > 0 && (
                    <div className="text-xs text-gray-600 mt-0.5">他 {court.remaining_queue_count} 組</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

function PublicEntryDisplay({ entry }: { entry: { display_name: string; team_color: string | null } }) {
  const backgroundColor = hexToRgba(entry.team_color, 0.18)
  return (
    <div
      className="rounded-md px-3 py-2"
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <span className="text-sm font-medium truncate">{entry.display_name}</span>
    </div>
  )
}
