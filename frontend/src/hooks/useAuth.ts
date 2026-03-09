import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import type { Session } from '@supabase/supabase-js'

interface AdminInfo {
  admin_id: string
  display_name: string
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [admin, setAdmin] = useState<AdminInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchAdmin(session.access_token)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchAdmin(session.access_token)
      else {
        setAdmin(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchAdmin(token: string) {
    const res = await api<AdminInfo>('/api/admin-auth/me', { token })
    if (res.data) setAdmin(res.data)
    setLoading(false)
  }

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{
      access_token: string
      refresh_token: string
      admin: AdminInfo
    }>('/api/admin-auth/login', {
      method: 'POST',
      body: { email, password },
    })

    if (res.error) throw new Error(res.error.message)

    if (res.data) {
      await supabase.auth.setSession({
        access_token: res.data.access_token,
        refresh_token: res.data.refresh_token,
      })
      setAdmin(res.data.admin)
    }
  }, [])

  const logout = useCallback(async () => {
    await api('/api/admin-auth/logout', { method: 'POST' })
    await supabase.auth.signOut()
    setAdmin(null)
  }, [])

  return { session, admin, loading, login, logout, isAuthenticated: !!session && !!admin }
}
