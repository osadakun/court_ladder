-- v2.7 スキーマ更新
-- match_type, entry_a_original_queue_position, entry_b_original_queue_position を matches に追加

-- match_type: 'regular'(自動生成) or 'request'(管理者手動作成)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE matches ADD CONSTRAINT chk_match_type CHECK (match_type IN ('regular', 'request'));

-- court_no の NOT NULL 制約を解除（リクエスト試合は court_no = null を許可）
ALTER TABLE matches ALTER COLUMN court_no DROP NOT NULL;

-- FK 制約を再作成（NULL を許可するため ON DELETE RESTRICT のまま、NULL 時はスキップ）
ALTER TABLE matches DROP CONSTRAINT IF EXISTS fk_matches_court;
ALTER TABLE matches ADD CONSTRAINT fk_matches_court
  FOREIGN KEY (tournament_id, court_no)
  REFERENCES courts (tournament_id, court_no) ON DELETE RESTRICT
  NOT VALID;
-- NOT VALID: 既存行は DEFAULT 'regular' で court_no NOT NULL が保証されているため再検証不要

-- リクエスト試合は court_no が null でもよいが、通常試合は必須
ALTER TABLE matches ADD CONSTRAINT chk_match_type_court_no CHECK (match_type = 'request' OR court_no IS NOT NULL);

-- ロールバック時に元の待機列位置に復元するための記録
ALTER TABLE matches ADD COLUMN IF NOT EXISTS entry_a_original_queue_position INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS entry_b_original_queue_position INTEGER;

-- in_progress の一意制約を match_type = 'regular' に限定（リクエスト試合は同一コートに複数可）
-- 既存の partial unique index を削除して再作成
DROP INDEX IF EXISTS uq_matches_in_progress_per_court;
CREATE UNIQUE INDEX uq_matches_in_progress_per_court
  ON matches (tournament_id, court_no)
  WHERE state = 'in_progress' AND match_type = 'regular';
