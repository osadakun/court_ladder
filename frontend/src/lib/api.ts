import { supabase } from './supabase'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

interface ApiOptions {
  method?: string
  body?: unknown
  token?: string
  raw?: boolean // true: body をそのまま送信（FormData 等）
}

interface ApiResponse<T = unknown> {
  data?: T
  meta?: { revision?: number; server_time?: string }
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token, raw } = options

  const headers: Record<string, string> = {}
  if (!raw) {
    headers['Content-Type'] = 'application/json'
  }

  // Supabase gateway requires apikey header
  if (ANON_KEY) {
    headers['apikey'] = ANON_KEY
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    } else if (ANON_KEY) {
      headers['Authorization'] = `Bearer ${ANON_KEY}`
    }
  }

  // When BASE_URL points to Edge Functions directly, strip /api prefix
  const resolvedPath = BASE_URL ? path.replace(/^\/api/, '') : path

  const res = await fetch(`${BASE_URL}${resolvedPath}`, {
    method,
    headers,
    body: raw ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) {
    return {}
  }

  return await res.json()
}

export async function downloadFileBlob(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {}

  if (ANON_KEY) {
    headers['apikey'] = ANON_KEY
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  } else if (ANON_KEY) {
    headers['Authorization'] = `Bearer ${ANON_KEY}`
  }

  const resolvedPath = BASE_URL ? path.replace(/^\/api/, '') : path
  const res = await fetch(`${BASE_URL}${resolvedPath}`, { headers })

  if (!res.ok) {
    throw new Error(`ファイルダウンロードに失敗しました (${res.status})`)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadCsvBlob(path: string, filename: string): Promise<void> {
  await downloadFileBlob(path, filename)
}
