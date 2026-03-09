import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import { useAuthContext } from '../contexts/AuthContext'

export function LoginPage() {
  const { login, isAuthenticated, loading } = useAuthContext()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) return null
  if (isAuthenticated) return <Navigate to="/tournaments" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Trophy className="w-12 h-12 text-blue-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">コートラダー</h1>
          <p className="text-sm text-gray-500 mt-1">管理者ログイン</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
