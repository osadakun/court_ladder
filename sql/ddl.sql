-- =============================================================================
-- コートラダー DDL for Supabase PostgreSQL
-- ベース仕様: spec.md v2.5 / er_api.md v2.5
-- 作成日: 2026-03-08
-- =============================================================================

-- ============================================================
-- 0. 拡張・ユーティリティ
-- ============================================================

-- gen_random_uuid() は Supabase で標準利用可能（pgcrypto）

-- ============================================================
-- 1. ENUM 型定義
-- ============================================================

-- 大会状態
CREATE TYPE tournament_state AS ENUM ('preparing', 'live', 'ended');

-- エントリー種別（大会形式と同値だが、エントリー単位で保持）
CREATE TYPE entry_type AS ENUM ('singles', 'doubles');

-- エントリー状態
CREATE TYPE entry_status AS ENUM ('active', 'paused', 'withdrawn');

-- コート状態
CREATE TYPE court_status AS ENUM ('active', 'stopped');

-- 試合状態
CREATE TYPE match_state AS ENUM ('in_progress', 'finished', 'cancelled');

-- 結果種別
CREATE TYPE outcome_type AS ENUM ('normal', 'retired', 'walkover');

-- 試合キャンセル理由
CREATE TYPE cancel_reason AS ENUM ('rollback', 'manual_clear');

-- 待機列追加理由
CREATE TYPE enqueue_reason AS ENUM ('initial', 'result', 'manual', 'rollback', 'manual_requeue');

-- 移動理由
CREATE TYPE movement_reason AS ENUM ('win', 'loss', 'manual', 'rollback', 'manual_requeue', 'auto_remove_due_to_status');

-- 自動配置モード
CREATE TYPE allocation_mode AS ENUM ('round_robin', 'random_round_robin');

-- ============================================================
-- 2. updated_at 自動更新トリガー関数
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. テーブル定義（依存関係順）
-- ============================================================

-- ------------------------------------------------------------
-- 3-1. tournaments（大会）
-- ------------------------------------------------------------
CREATE TABLE tournaments (
    tournament_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    public_page_title TEXT,                                   -- nullable: 未設定時は name をフォールバック
    event_date DATE NOT NULL,
    court_count INTEGER NOT NULL CHECK (court_count BETWEEN 2 AND 20),
    state tournament_state NOT NULL DEFAULT 'preparing',
    game_point INTEGER NOT NULL DEFAULT 21,
    public_queue_display_limit INTEGER NOT NULL DEFAULT 5 CHECK (public_queue_display_limit BETWEEN 1 AND 10),
    public_enabled BOOLEAN NOT NULL DEFAULT false,
    public_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),  -- URL 安全なランダムトークン
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_tournaments_public_token UNIQUE (public_token)
);

COMMENT ON TABLE tournaments IS '大会。システムの管理単位';
COMMENT ON COLUMN tournaments.revision IS '公開/管理盤面に影響する更新ごとに加算するグローバルカウンタ';
COMMENT ON COLUMN tournaments.public_token IS '公開 URL 用の推測困難なランダムトークン';

CREATE TRIGGER trg_tournaments_updated_at
    BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-2. admin_accounts（管理者アカウント）
--   Supabase Auth (auth.users) と連携。login_id / password_hash は不要。
-- ------------------------------------------------------------
CREATE TABLE admin_accounts (
    admin_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_accounts IS '管理者アカウント。auth.users と 1:1 対応';
COMMENT ON COLUMN admin_accounts.admin_id IS 'auth.users(id) を参照する UUID';

CREATE TRIGGER trg_admin_accounts_updated_at
    BEFORE UPDATE ON admin_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-3. members（メンバー / 選手個人）
-- ------------------------------------------------------------
CREATE TABLE members (
    member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    management_name TEXT NOT NULL,
    affiliation TEXT,
    category TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE members IS 'エントリーを構成する個人（選手）';

CREATE TRIGGER trg_members_updated_at
    BEFORE UPDATE ON members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-4. teams（チーム / チームカラー管理）
-- ------------------------------------------------------------
CREATE TABLE teams (
    team_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    team_name TEXT NOT NULL,
    color_code TEXT NOT NULL DEFAULT '#6B7280',  -- hex カラーコード
    sort_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tournament_id, team_name),
    UNIQUE (tournament_id, sort_order)
);

COMMENT ON TABLE teams IS 'チーム。チームカラー管理';

-- インデックス
CREATE INDEX idx_teams_tournament_sort ON teams (tournament_id, sort_order);

CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-5. entries（エントリー / 対戦単位）
-- ------------------------------------------------------------
CREATE TABLE entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    entry_type entry_type NOT NULL,
    team_id UUID REFERENCES teams (team_id) ON DELETE SET NULL,
    status entry_status NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE entries IS '対戦単位。シングルス=1名、ダブルス=2名で構成';
COMMENT ON COLUMN entries.version IS '楽観的ロック用バージョン';

CREATE TRIGGER trg_entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-6. entry_members（エントリーとメンバーの対応）
-- ------------------------------------------------------------
CREATE TABLE entry_members (
    entry_member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries (entry_id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members (member_id) ON DELETE CASCADE,
    member_order INTEGER NOT NULL CHECK (member_order IN (1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_entry_members_order UNIQUE (entry_id, member_order),
    CONSTRAINT uq_entry_members_member UNIQUE (entry_id, member_id)
);

COMMENT ON TABLE entry_members IS 'エントリーとメンバーの多対多対応（シングルス=1件、ダブルス=2件）';

-- ------------------------------------------------------------
-- 3-7. courts（コート）
--   current_match_id は matches 作成後に外部キーを追加する
-- ------------------------------------------------------------
CREATE TABLE courts (
    court_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    court_no INTEGER NOT NULL CHECK (court_no >= 1),
    status court_status NOT NULL DEFAULT 'active',
    current_match_id UUID,                                    -- 後で FK 追加
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_courts_tournament_court_no UNIQUE (tournament_id, court_no)
);

COMMENT ON TABLE courts IS 'コート定義と現在状態';
COMMENT ON COLUMN courts.current_match_id IS 'in_progress 試合への高速参照用ポインタ（冗長列）';

CREATE TRIGGER trg_courts_updated_at
    BEFORE UPDATE ON courts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-8. matches（試合）
-- ------------------------------------------------------------
CREATE TABLE matches (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    court_no INTEGER NOT NULL,
    entry_a_id UUID NOT NULL REFERENCES entries (entry_id) ON DELETE RESTRICT,
    entry_b_id UUID NOT NULL REFERENCES entries (entry_id) ON DELETE RESTRICT,
    entry_a_snapshot JSONB,                                    -- 試合作成時のエントリーメンバー構成スナップショット
    entry_b_snapshot JSONB,                                    -- 試合作成時のエントリーメンバー構成スナップショット
    state match_state NOT NULL DEFAULT 'in_progress',
    outcome_type outcome_type,
    score_a INTEGER,
    score_b INTEGER,
    winner_entry_id UUID REFERENCES entries (entry_id) ON DELETE RESTRICT,
    loser_entry_id UUID REFERENCES entries (entry_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancel_reason cancel_reason,
    result_confirmed_by UUID REFERENCES admin_accounts (admin_id) ON DELETE SET NULL,
    note TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 複合外部キー: (tournament_id, court_no) → courts
    CONSTRAINT fk_matches_court FOREIGN KEY (tournament_id, court_no)
        REFERENCES courts (tournament_id, court_no) ON DELETE RESTRICT
);

COMMENT ON TABLE matches IS '試合と結果';
COMMENT ON COLUMN matches.entry_a_snapshot IS '試合自動生成時にエントリーのメンバー構成と表示名を記録する。メンバー組み替え後も過去の試合データの正確性を保持するため';
COMMENT ON COLUMN matches.entry_b_snapshot IS '試合自動生成時にエントリーのメンバー構成と表示名を記録する。メンバー組み替え後も過去の試合データの正確性を保持するため';
COMMENT ON COLUMN matches.cancel_reason IS 'rollback=結果取り消し、manual_clear=手動解消';

CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- courts.current_match_id の外部キーを追加（matches 作成後）
ALTER TABLE courts
    ADD CONSTRAINT fk_courts_current_match
    FOREIGN KEY (current_match_id) REFERENCES matches (match_id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3-9. queue_items（待機列 — 現在状態テーブル）
-- ------------------------------------------------------------
CREATE TABLE queue_items (
    queue_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    court_no INTEGER NOT NULL,
    entry_id UUID NOT NULL REFERENCES entries (entry_id) ON DELETE CASCADE,
    queue_position INTEGER NOT NULL CHECK (queue_position >= 1),
    enqueue_reason enqueue_reason NOT NULL,
    source_match_id UUID REFERENCES matches (match_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 複合外部キー: (tournament_id, court_no) → courts
    CONSTRAINT fk_queue_items_court FOREIGN KEY (tournament_id, court_no)
        REFERENCES courts (tournament_id, court_no) ON DELETE CASCADE,

    -- 同一大会内でエントリーは 1 つの待機列にのみ存在可能
    CONSTRAINT uq_queue_items_entry UNIQUE (tournament_id, entry_id),

    -- 同一コート内でポジションは一意
    CONSTRAINT uq_queue_items_position UNIQUE (tournament_id, court_no, queue_position)
);

COMMENT ON TABLE queue_items IS '各コートの待機列（現在状態）。履歴は movement_logs に保持';

CREATE TRIGGER trg_queue_items_updated_at
    BEFORE UPDATE ON queue_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 3-10. movement_logs（移動履歴）
-- ------------------------------------------------------------
CREATE TABLE movement_logs (
    movement_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    match_id UUID REFERENCES matches (match_id) ON DELETE SET NULL,
    entry_id UUID NOT NULL REFERENCES entries (entry_id) ON DELETE CASCADE,
    from_court_no INTEGER,                                    -- nullable: 未所属からの追加時
    to_court_no INTEGER,                                      -- nullable: 状態変更による除外時
    movement_reason movement_reason NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE movement_logs IS '勝敗移動・手動移動・ロールバック・状態変更除外の履歴';

-- ------------------------------------------------------------
-- 3-11. audit_logs（監査ログ）
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
    audit_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    actor_admin_id UUID REFERENCES admin_accounts (admin_id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    before_json JSONB,
    after_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_logs IS '管理操作の監査証跡';

-- ------------------------------------------------------------
-- 3-12. import_previews（CSV 取込プレビュー）
-- ------------------------------------------------------------
CREATE TABLE import_previews (
    import_preview_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    created_by_admin_id UUID NOT NULL REFERENCES admin_accounts (admin_id) ON DELETE CASCADE,
    source_filename TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    valid_row_count INTEGER NOT NULL DEFAULT 0,
    invalid_row_count INTEGER NOT NULL DEFAULT 0,
    preview_json JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE import_previews IS 'CSV 取込プレビュー。TTL 30分の一時データ';

-- ------------------------------------------------------------
-- 3-13. allocation_previews（自動配置プレビュー）
-- ------------------------------------------------------------
CREATE TABLE allocation_previews (
    allocation_preview_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments (tournament_id) ON DELETE CASCADE,
    created_by_admin_id UUID NOT NULL REFERENCES admin_accounts (admin_id) ON DELETE CASCADE,
    mode allocation_mode NOT NULL,
    plan_json JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE allocation_previews IS '初期自動配置プレビュー。TTL 30分の一時データ';

-- ============================================================
-- 4. 部分ユニーク制約（Partial Unique Index）
-- ============================================================

-- 1 コートにつき同時に 1 件のみ in_progress を許容
CREATE UNIQUE INDEX uq_matches_in_progress_per_court
    ON matches (tournament_id, court_no)
    WHERE state = 'in_progress';

COMMENT ON INDEX uq_matches_in_progress_per_court IS '同一コートに in_progress 試合は 1 件のみ';

-- ============================================================
-- 5. 推奨インデックス（er_api.md §2-5）
-- ============================================================

-- 大会一覧（状態・開催日）
CREATE INDEX idx_tournaments_state_event_date
    ON tournaments (state, event_date);

-- コート別待機列描画
-- uq_queue_items_position (tournament_id, court_no, queue_position) が既にカバー

-- 現在対戦取得
CREATE INDEX idx_matches_court_state
    ON matches (tournament_id, court_no, state);

-- 試合履歴一覧
CREATE INDEX idx_matches_finished_at
    ON matches (tournament_id, finished_at DESC);

-- 移動履歴表示
CREATE INDEX idx_movement_logs_created_at
    ON movement_logs (tournament_id, created_at DESC);

-- 監査ログ表示
CREATE INDEX idx_audit_logs_created_at
    ON audit_logs (tournament_id, created_at DESC);

-- エントリー状態フィルタ
CREATE INDEX idx_entries_status
    ON entries (tournament_id, status);

-- 有効 preview 検索
CREATE INDEX idx_import_previews_expires
    ON import_previews (tournament_id, expires_at);

CREATE INDEX idx_allocation_previews_expires
    ON allocation_previews (tournament_id, expires_at);

-- ============================================================
-- 6. RLS（Row Level Security）
-- ============================================================

-- 全テーブルで RLS を有効化
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_previews ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------
-- 6-1. admin_accounts: 認証済みユーザーが自分の行を読み取り可能
-- ----------------------------------------------------------
CREATE POLICY admin_accounts_select_own ON admin_accounts
    FOR SELECT
    TO authenticated
    USING (admin_id = auth.uid());

-- ----------------------------------------------------------
-- 6-2. service_role 用ポリシー（Edge Functions は service_role key を使用）
--   service_role はデフォルトで RLS をバイパスするが、
--   明示的なポリシーを定義して意図を明確にする。
-- ----------------------------------------------------------

-- tournaments
CREATE POLICY tournaments_service_role ON tournaments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- admin_accounts（service_role からの全操作）
CREATE POLICY admin_accounts_service_role ON admin_accounts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- members
CREATE POLICY members_service_role ON members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- teams
CREATE POLICY teams_service_role ON teams
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- entries
CREATE POLICY entries_service_role ON entries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- entry_members
CREATE POLICY entry_members_service_role ON entry_members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- courts
CREATE POLICY courts_service_role ON courts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- queue_items
CREATE POLICY queue_items_service_role ON queue_items
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- matches
CREATE POLICY matches_service_role ON matches
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- movement_logs
CREATE POLICY movement_logs_service_role ON movement_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- audit_logs
CREATE POLICY audit_logs_service_role ON audit_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- import_previews
CREATE POLICY import_previews_service_role ON import_previews
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- allocation_previews
CREATE POLICY allocation_previews_service_role ON allocation_previews
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 7. Supabase Realtime 用の publication 設定
--   tournaments テーブルの revision 変更を公開画面から購読するため
-- ============================================================

-- Supabase はデフォルトで supabase_realtime publication を持つ。
-- tournaments テーブルを追加する。
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;

-- ============================================================
-- 完了
-- ============================================================
