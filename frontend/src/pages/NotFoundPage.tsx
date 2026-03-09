import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="text-center py-20">
      <h1 className="text-4xl font-bold text-gray-300 mb-4">404</h1>
      <p className="text-gray-500 mb-6">ページが見つかりません</p>
      <Link to="/tournaments" className="text-blue-600 hover:text-blue-800 text-sm">
        大会一覧へ戻る
      </Link>
    </div>
  )
}
