-- テスト大会2 を作成（v2.6: singles_court_count + doubles_court_count）
INSERT INTO tournaments (
  tournament_id, name, public_page_title, event_date,
  singles_court_count, doubles_court_count, allow_same_team_match,
  game_point, state, public_enabled, revision
) VALUES (
  '6d7cbdac-ff8d-4363-82f1-3b8b4dcf749e',
  'テスト大会2',
  'テスト大会2 公開ページ',
  '2026-03-08',
  7, 3, true,
  21, 'preparing', true, 1
)
ON CONFLICT (tournament_id) DO UPDATE SET
  singles_court_count = EXCLUDED.singles_court_count,
  doubles_court_count = EXCLUDED.doubles_court_count,
  allow_same_team_match = EXCLUDED.allow_same_team_match;
