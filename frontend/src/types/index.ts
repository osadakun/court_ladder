// --- 大会 ---
export interface Tournament {
  tournament_id: string
  name: string
  public_page_title: string | null
  event_date: string
  singles_court_count: number
  doubles_court_count: number
  state: 'preparing' | 'live' | 'ended'
  game_point: number
  public_queue_display_limit: number
  public_enabled: boolean
  allow_same_team_match: boolean
  public_token: string
  revision: number
  created_at: string
  updated_at: string
}

// --- チーム ---
export interface Team {
  team_id: string
  tournament_id: string
  team_name: string
  color_code: string
  sort_order: number
}

// --- メンバー ---
export interface Member {
  member_id: string
  management_name: string
  grade: string | null
}

// --- エントリー ---
export interface Entry {
  entry_id: string
  tournament_id: string
  entry_type: 'singles' | 'doubles'
  team_id: string | null
  initial_court_no: number
  status: 'active' | 'paused' | 'withdrawn'
  version: number
  team?: Team | null
  entry_members?: EntryMember[]
}

export interface EntryMember {
  member_order: number
  member: Member
}

// --- コート ---
export interface Court {
  court_id: string
  tournament_id: string
  court_no: number
  court_type: 'singles' | 'doubles'
  status: 'active' | 'stopped'
  current_match_id: string | null
  version: number
  queue_count?: number
}

// --- 試合 ---
export interface Match {
  match_id: string
  tournament_id: string
  court_no: number
  entry_a_id: string
  entry_b_id: string
  entry_a_snapshot: EntrySnapshot | null
  entry_b_snapshot: EntrySnapshot | null
  state: 'in_progress' | 'finished' | 'cancelled'
  outcome_type: 'normal' | 'retired' | 'walkover' | null
  score_a: number | null
  score_b: number | null
  winner_entry_id: string | null
  loser_entry_id: string | null
  finished_at?: string | null
  version: number
}

export interface EntrySnapshot {
  display_name: string
  team_name: string | null
  team_color: string | null
  entry_type: 'singles' | 'doubles'
  members: { management_name: string; grade?: string }[]
}

// --- 待機列 ---
export interface QueueItem {
  queue_item_id: string
  court_no: number
  entry_id: string
  queue_position: number
  entry?: Entry
}

// --- ダッシュボード ---
export interface DashboardData {
  tournament: Tournament
  courts: Court[]
  current_matches: Match[]
  queue_items: QueueItem[]
  recent_finished_matches: Match[]
}

// --- 移動プレビュー ---
export interface MovementPreview {
  entry_id?: string
  entry_display_name?: string
  from_court_no: number
  to_court_no: number
  movement_reason: 'win' | 'loss' | 'abandoned_requeue'
}
