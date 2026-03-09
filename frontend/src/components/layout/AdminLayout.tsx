import { Link, useLocation } from 'react-router-dom'
import { LogOut, Trophy, Users, Palette, LayoutDashboard, History, Settings } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { admin, logout } = useAuthContext()
  const location = useLocation()

  // /tournaments/:tid/... からtidを抽出
  const tidMatch = location.pathname.match(/^\/tournaments\/([^/]+)/)
  const tid = tidMatch?.[1]

  const navItems = tid
    ? [
        { to: `/tournaments/${tid}`, label: 'ダッシュボード', icon: LayoutDashboard },
        { to: `/tournaments/${tid}/entries`, label: 'エントリー', icon: Users },
        { to: `/tournaments/${tid}/teams`, label: 'チーム', icon: Palette },
        { to: `/tournaments/${tid}/history`, label: '履歴', icon: History },
        { to: `/tournaments/${tid}/settings`, label: '設定', icon: Settings },
      ]
    : []

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/tournaments" className="flex items-center gap-2 font-bold text-lg text-gray-900">
              <Trophy className="w-5 h-5 text-blue-600" />
              コートラダー
            </Link>
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  location.pathname === item.to
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{admin?.display_name}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              ログアウト
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
