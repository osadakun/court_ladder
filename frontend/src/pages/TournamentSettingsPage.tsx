import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, RefreshCw, Trash2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import type { Tournament } from '../types'

export function TournamentSettingsPage() {
  const { tid } = useParams<{ tid: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: tournament, isLoading } = useQuery({
    queryKey: ['tournament-settings', tid],
    queryFn: async () => {
      const res = await api<Tournament>(`/api/admin-tournaments/${tid}`)
      return res.data!
    },
    enabled: !!tid,
  })

  const [form, setForm] = useState({
    name: '',
    public_page_title: '',
    event_date: '',
    singles_court_count: 5,
    doubles_court_count: 5,
    game_point: 21,
    public_queue_display_limit: 5,
    public_enabled: false,
    allow_same_team_match: true,
  })

  useEffect(() => {
    if (tournament) {
      setForm({
        name: tournament.name,
        public_page_title: tournament.public_page_title || '',
        event_date: tournament.event_date,
        singles_court_count: tournament.singles_court_count,
        doubles_court_count: tournament.doubles_court_count,
        game_point: tournament.game_point,
        public_queue_display_limit: tournament.public_queue_display_limit,
        public_enabled: tournament.public_enabled,
        allow_same_team_match: tournament.allow_same_team_match,
      })
    }
  }, [tournament])

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await api<Tournament>(`/api/admin-tournaments/${tid}`, {
        method: 'PATCH',
        body: form,
      })
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: () => {
      toast.success('設定を保存しました')
      queryClient.invalidateQueries({ queryKey: ['tournament-settings', tid] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const regenerateTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await api<{ public_token: string }>(`/api/admin-tournaments/${tid}/actions/regenerate-public-token`, {
        method: 'POST',
        body: {},
      })
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: () => {
      toast.success('公開トークンを再生成しました')
      queryClient.invalidateQueries({ queryKey: ['tournament-settings', tid] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api(`/api/admin-tournaments/${tid}`, { method: 'DELETE' })
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => {
      toast.success('大会を削除しました')
      navigate('/tournaments')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleDelete() {
    const name = window.prompt('削除するには大会名を入力してください:')
    if (name === tournament?.name) {
      deleteMutation.mutate()
    } else if (name !== null) {
      toast.error('大会名が一致しません')
    }
  }

  function copyPublicUrl() {
    if (tournament) {
      const url = `${window.location.origin}/public/${tournament.public_token}`
      navigator.clipboard.writeText(url)
      toast.success('公開URLをコピーしました')
    }
  }

  if (isLoading) return <div className="text-center py-12 text-gray-500">読み込み中...</div>
  if (!tournament) return <div className="text-center py-12 text-gray-500">大会が見つかりません</div>

  const isPreparing = tournament.state === 'preparing'

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">大会設定</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">大会名</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">公開ページタイトル</label>
          <input
            type="text"
            value={form.public_page_title}
            onChange={(e) => setForm({ ...form, public_page_title: e.target.value })}
            placeholder="未設定時は大会名を使用"
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">開催日</label>
            <input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">シングルス</label>
            <input
              type="number"
              min={0}
              max={20}
              value={form.singles_court_count}
              onChange={(e) => setForm({ ...form, singles_court_count: e.target.valueAsNumber })}
              disabled={!isPreparing}
              className="w-full px-3 py-2 border rounded-md disabled:bg-gray-100"
            />
            {!isPreparing && <p className="text-xs text-gray-400 mt-1">開始後は変更不可</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ダブルス</label>
            <input
              type="number"
              min={0}
              max={20}
              value={form.doubles_court_count}
              onChange={(e) => setForm({ ...form, doubles_court_count: e.target.valueAsNumber })}
              disabled={!isPreparing}
              className="w-full px-3 py-2 border rounded-md disabled:bg-gray-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ゲームポイント</label>
            <input
              type="number"
              min={1}
              value={form.game_point}
              onChange={(e) => setForm({ ...form, game_point: e.target.valueAsNumber })}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">公開待機列表示件数</label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.public_queue_display_limit}
              onChange={(e) => setForm({ ...form, public_queue_display_limit: e.target.valueAsNumber })}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {updateMutation.isPending ? '保存中...' : '設定を保存'}
        </button>
      </div>

      {/* 対戦設定 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6 space-y-4">
        <h2 className="text-lg font-semibold">対戦設定</h2>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-700">同一チーム対戦を許可</span>
            <p className="text-xs text-gray-400 mt-0.5">オフにすると待機列で同チーム対戦を自動回避します</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.allow_same_team_match}
            onClick={() => setForm({ ...form, allow_same_team_match: !form.allow_same_team_match })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.allow_same_team_match ? 'bg-blue-600' : 'bg-gray-200'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${form.allow_same_team_match ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* 公開設定 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6 space-y-4">
        <h2 className="text-lg font-semibold">公開設定</h2>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={form.public_enabled}
            onChange={(e) => {
              setForm({ ...form, public_enabled: e.target.checked })
            }}
            className="w-4 h-4"
          />
          <span className="text-sm">公開ページを有効にする</span>
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">公開URL</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-gray-50 border rounded-md text-sm break-all">
              {window.location.origin}/public/{tournament.public_token}
            </code>
            <button onClick={copyPublicUrl} className="p-2 hover:bg-gray-100 rounded" title="コピー">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            if (window.confirm('公開トークンを再生成しますか？既存のURLは無効になります。')) {
              regenerateTokenMutation.mutate()
            }
          }}
          disabled={regenerateTokenMutation.isPending}
          className="flex items-center gap-2 px-3 py-1.5 text-sm border border-yellow-400 text-yellow-700 rounded hover:bg-yellow-50 disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          トークンを再生成
        </button>
      </div>

      {/* 大会削除 */}
      {tournament.state === 'ended' && (
        <div className="bg-white rounded-lg shadow p-6 border-2 border-red-100">
          <h2 className="text-lg font-semibold text-red-700 mb-2">大会削除</h2>
          <p className="text-sm text-gray-600 mb-4">
            大会に関連するすべてのデータが完全に削除されます。この操作は取り消せません。
          </p>
          <p className="text-sm text-gray-600 mb-4">
            削除前に履歴画面から CSV / PDF をエクスポートしてください。
          </p>
          <div className="flex items-center gap-3 mb-4">
            <Link
              to={`/tournaments/${tid}/history`}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-blue-200 text-blue-700 rounded hover:bg-blue-50"
            >
              履歴画面を開く
            </Link>
          </div>
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            大会を削除
          </button>
        </div>
      )}
    </div>
  )
}
