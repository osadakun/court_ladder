import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Supabase Realtime で tournaments.revision の変更を購読する。
 * revision が変わったら onRevisionChange を呼ぶ。
 */
export function useRealtime(
  tournamentId: string | undefined,
  onRevisionChange: (newRevision: number) => void,
) {
  const channelRef = useRef<RealtimeChannel | null>(null)

  const handleChange = useCallback(
    (payload: { new: { revision: number; tournament_id: string } }) => {
      if (payload.new.tournament_id === tournamentId) {
        // 0〜500ms のランダム遅延
        const delay = Math.random() * 500
        setTimeout(() => onRevisionChange(payload.new.revision), delay)
      }
    },
    [tournamentId, onRevisionChange],
  )

  useEffect(() => {
    if (!tournamentId) return

    const channel = supabase
      .channel(`tournament-${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournaments',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        handleChange,
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [tournamentId, handleChange])
}
