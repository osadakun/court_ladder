-- RPC: recent_finished_per_court
-- コートごとの最新 finished 試合を1件ずつ取得（DISTINCT ON）

CREATE OR REPLACE FUNCTION recent_finished_per_court(p_tournament_id UUID)
RETURNS SETOF matches
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (court_no) *
  FROM matches
  WHERE tournament_id = p_tournament_id
    AND state = 'finished'
  ORDER BY court_no, finished_at DESC;
$$;
