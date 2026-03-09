import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Upload, CheckCircle, XCircle, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api'

interface PreviewRow {
  rowNo: number
  status: 'valid' | 'invalid'
  errors: string[]
  normalized: {
    entryType: string
    teamName: string | null
    members: { managementName: string; grade: string }[]
    initialCourtNo: number
  } | null
}

interface PreviewResult {
  import_id: string
  summary: { total_rows: number; valid_rows: number; invalid_rows: number }
  rows: PreviewRow[]
}

interface CommitResult {
  created_count: number
  error_count: number
  skipped_count: number
}

export function CSVImportPage() {
  const { tid } = useParams<{ tid: string }>()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [mode, setMode] = useState<'valid_only' | 'all_or_nothing'>('valid_only')

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api<PreviewResult>(`/api/admin-imports/${tid}/entries/preview`, {
        method: 'POST',
        body: formData,
        raw: true,
      })
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: (data) => {
      setPreview(data)
      toast.success(`${data.summary.total_rows} 行を解析しました`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('プレビューがありません')
      const res = await api<CommitResult>(`/api/admin-imports/${tid}/entries/commit`, {
        method: 'POST',
        body: { import_id: preview.import_id, mode },
      })
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: (data) => {
      toast.success(`${data.created_count} 件を取り込みました`)
      setPreview(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setPreview(null)
      uploadMutation.mutate(file)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(`/tournaments/${tid}/entries`)}
          className="p-2 hover:bg-gray-100 rounded"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">CSV 一括登録</h1>
      </div>

      {/* ファイル選択 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <p className="text-sm text-gray-600 mb-4">
          CSV ファイル（UTF-8）を選択してください。<br />
          列: 形式, チーム名, メンバー1氏名, メンバー1学年, メンバー2氏名, メンバー2学年, 初期コート
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {uploadMutation.isPending ? 'アップロード中...' : 'CSV ファイルを選択'}
        </button>
      </div>

      {/* プレビュー結果 */}
      {preview && (
        <>
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">プレビュー結果</h2>
            <div className="flex gap-6 mb-4 text-sm">
              <span>全 {preview.summary.total_rows} 行</span>
              <span className="text-green-600">正常 {preview.summary.valid_rows} 行</span>
              <span className="text-red-600">エラー {preview.summary.invalid_rows} 行</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-3 py-2 text-left w-12">行</th>
                    <th className="px-3 py-2 text-left w-16">状態</th>
                    <th className="px-3 py-2 text-left">形式</th>
                    <th className="px-3 py-2 text-left">チーム</th>
	                  <th className="px-3 py-2 text-left">メンバー</th>
	                  <th className="px-3 py-2 text-left">初期コート</th>
	                  <th className="px-3 py-2 text-left">エラー</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.rowNo}
                      className={`border-b ${row.status === 'invalid' ? 'bg-red-50' : ''}`}
                    >
                      <td className="px-3 py-2">{row.rowNo}</td>
                      <td className="px-3 py-2">
                        {row.status === 'valid' ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                      </td>
                      <td className="px-3 py-2">{row.normalized?.entryType || '-'}</td>
                      <td className="px-3 py-2">{row.normalized?.teamName || '-'}</td>
                      <td className="px-3 py-2">
                        {row.normalized?.members.map((m) => `${m.grade}：${m.managementName}`).join('・') || '-'}
                      </td>
                      <td className="px-3 py-2">{row.normalized?.initialCourtNo ?? '-'}</td>
                      <td className="px-3 py-2 text-red-600">
                        {row.errors.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 取り込み実行 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">取り込み</h2>
            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="valid_only"
                  checked={mode === 'valid_only'}
                  onChange={() => setMode('valid_only')}
                />
                正常行のみ取り込む
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="all_or_nothing"
                  checked={mode === 'all_or_nothing'}
                  onChange={() => setMode('all_or_nothing')}
                />
                全件取り込む（エラーがあれば中止）
              </label>
            </div>
            <button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending || preview.summary.valid_rows === 0}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {commitMutation.isPending ? '取り込み中...' : `${preview.summary.valid_rows} 件を取り込む`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
