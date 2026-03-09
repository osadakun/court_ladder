-- =============================================================================
-- v2.6 スキーマ変更
-- - tournaments: court_count → singles_court_count + doubles_court_count, allow_same_team_match 追加
-- - members: category → grade（必須、固定11選択肢）
-- - entries: initial_court_no 追加
-- - courts: court_type 追加
-- - outcome_type ENUM: abandoned 追加
-- - movement_reason ENUM: abandoned_requeue 追加
-- - allocation_previews テーブル削除
-- =============================================================================

-- 1. outcome_type に abandoned を追加
ALTER TYPE outcome_type ADD VALUE IF NOT EXISTS 'abandoned';

-- 2. movement_reason に abandoned_requeue を追加
ALTER TYPE movement_reason ADD VALUE IF NOT EXISTS 'abandoned_requeue';

-- 3. tournaments: court_count → singles_court_count + doubles_court_count
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS singles_court_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS doubles_court_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS allow_same_team_match BOOLEAN NOT NULL DEFAULT true;

-- 既存データがある場合、court_count を singles_court_count にマイグレーション
UPDATE tournaments SET singles_court_count = court_count WHERE singles_court_count = 0 AND court_count > 0;

-- court_count カラムを削除（依存制約がある場合は先に対応）
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_court_count_check;
ALTER TABLE tournaments DROP COLUMN IF EXISTS court_count;

-- 合計コート数の CHECK 制約
ALTER TABLE tournaments ADD CONSTRAINT chk_total_court_count
  CHECK (singles_court_count + doubles_court_count BETWEEN 2 AND 20);
ALTER TABLE tournaments ADD CONSTRAINT chk_singles_court_count
  CHECK (singles_court_count BETWEEN 0 AND 20);
ALTER TABLE tournaments ADD CONSTRAINT chk_doubles_court_count
  CHECK (doubles_court_count BETWEEN 0 AND 20);

-- 4. members: category → grade
ALTER TABLE members ADD COLUMN IF NOT EXISTS grade TEXT;
UPDATE members
SET grade = category
WHERE grade IS NULL
  AND category IS NOT NULL;

ALTER TABLE members
  ADD CONSTRAINT chk_members_grade
  CHECK (grade IN ('年長', '小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '大人'));
ALTER TABLE members ALTER COLUMN grade SET NOT NULL;
-- category カラムを削除
ALTER TABLE members DROP COLUMN IF EXISTS category;

-- 5. entries: initial_court_no 追加
ALTER TABLE entries ADD COLUMN IF NOT EXISTS initial_court_no INTEGER;
UPDATE entries e
SET initial_court_no = q.court_no
FROM (
  SELECT tournament_id, entry_id, MIN(court_no) AS court_no
  FROM queue_items
  GROUP BY tournament_id, entry_id
) q
WHERE e.tournament_id = q.tournament_id
  AND e.entry_id = q.entry_id
  AND e.initial_court_no IS NULL;
ALTER TABLE entries ALTER COLUMN initial_court_no SET NOT NULL;

-- 6. courts: court_type 追加
ALTER TABLE courts ADD COLUMN IF NOT EXISTS court_type TEXT NOT NULL DEFAULT 'singles'
  CHECK (court_type IN ('singles', 'doubles'));
UPDATE courts c
SET court_type = CASE
  WHEN c.court_no <= t.singles_court_count THEN 'singles'
  ELSE 'doubles'
END
FROM tournaments t
WHERE c.tournament_id = t.tournament_id;

-- 7. allocation_previews テーブル削除
DROP TABLE IF EXISTS allocation_previews;
DROP TYPE IF EXISTS allocation_mode;

-- 8. allocation_previews の RLS ポリシーとインデックスも削除
DROP INDEX IF EXISTS idx_allocation_previews_expires;
