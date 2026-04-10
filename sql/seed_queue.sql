-- v2.6: エントリーの initial_court_no に基づいて待機列を作成し、自動試合生成
-- 同チーム回避ロジック付き
DO $$
DECLARE
  tid UUID := '6d7cbdac-ff8d-4363-82f1-3b8b4dcf749e';
  rec RECORD;
  pos_map INT[] := ARRAY[0,0,0,0,0,0,0,0,0,0]; -- court 1-10 の position カウンタ
  ea UUID;
  eb UUID;
  snap_a JSONB;
  snap_b JSONB;
  match_id_new UUID;
  court INT;
  team_a UUID;
  team_b UUID;
  swap_rec RECORD;
  allow_same_team_match_val BOOLEAN := true;
BEGIN
  -- 既存の待機列と試合をクリア
  DELETE FROM queue_items WHERE tournament_id = tid;
  UPDATE courts SET current_match_id = NULL WHERE tournament_id = tid;
  DELETE FROM matches WHERE tournament_id = tid;

  -- initial_court_no に基づいて待機列に追加（作成順）
  FOR rec IN
    SELECT e.entry_id, e.initial_court_no
    FROM entries e
    WHERE e.tournament_id = tid AND e.status = 'active'
    ORDER BY e.created_at, e.entry_id
  LOOP
    pos_map[rec.initial_court_no] := pos_map[rec.initial_court_no] + 1;

    INSERT INTO queue_items (tournament_id, court_no, entry_id, queue_position, enqueue_reason)
    VALUES (tid, rec.initial_court_no, rec.entry_id, pos_map[rec.initial_court_no], 'initial');
  END LOOP;

  RAISE NOTICE 'Queue items created based on initial_court_no';

  SELECT allow_same_team_match INTO allow_same_team_match_val
  FROM tournaments
  WHERE tournament_id = tid;

  IF NOT allow_same_team_match_val THEN
    -- 同チーム回避: 各コートの先頭2組が同チームなら、別チームのエントリーと入替
    FOR court IN 1..10 LOOP
      SELECT q.entry_id, e.team_id INTO ea, team_a
      FROM queue_items q JOIN entries e ON e.entry_id = q.entry_id
      WHERE q.tournament_id = tid AND q.court_no = court AND q.queue_position = 1;

      SELECT q.entry_id, e.team_id INTO eb, team_b
      FROM queue_items q JOIN entries e ON e.entry_id = q.entry_id
      WHERE q.tournament_id = tid AND q.court_no = court AND q.queue_position = 2;

      IF ea IS NULL OR eb IS NULL THEN
        CONTINUE;
      END IF;

      -- 同チームなら position 3 以降から別チームを探してswap
      IF team_a IS NOT NULL AND team_a = team_b THEN
        SELECT q.queue_item_id, q.queue_position INTO swap_rec
        FROM queue_items q JOIN entries e ON e.entry_id = q.entry_id
        WHERE q.tournament_id = tid AND q.court_no = court
          AND q.queue_position > 2
          AND (e.team_id IS NULL OR e.team_id != team_a)
        ORDER BY q.queue_position
        LIMIT 1;

        IF swap_rec IS NOT NULL THEN
          -- +1000オフセットで一時退避してswap
          UPDATE queue_items SET queue_position = 9999
          WHERE tournament_id = tid AND court_no = court AND queue_position = 2;

          UPDATE queue_items SET queue_position = 2
          WHERE tournament_id = tid AND court_no = court AND queue_position = swap_rec.queue_position;

          UPDATE queue_items SET queue_position = swap_rec.queue_position
          WHERE tournament_id = tid AND court_no = court AND queue_position = 9999;

          -- eb を更新
          SELECT q.entry_id INTO eb
          FROM queue_items q
          WHERE q.tournament_id = tid AND q.court_no = court AND q.queue_position = 2;

          RAISE NOTICE 'Court %: swapped position 2 with position % to avoid same-team match', court, swap_rec.queue_position;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 各コートの先頭2組で自動試合生成
  FOR court IN 1..10 LOOP
    SELECT entry_id INTO ea FROM queue_items
    WHERE tournament_id = tid AND court_no = court AND queue_position = 1;

    SELECT entry_id INTO eb FROM queue_items
    WHERE tournament_id = tid AND court_no = court AND queue_position = 2;

    IF ea IS NULL OR eb IS NULL THEN
      CONTINUE;
    END IF;

    -- スナップショット作成（v2.6: grade 含む、ダブルス対応）
    SELECT jsonb_build_object(
      'display_name',
        (SELECT string_agg(
          COALESCE(m2.grade || '：', '') || m2.management_name,
          '・' ORDER BY em2.member_order
        )
        FROM entry_members em2
        JOIN members m2 ON m2.member_id = em2.member_id
        WHERE em2.entry_id = e.entry_id)
        || CASE WHEN t.team_name IS NOT NULL THEN '（' || t.team_name || '）' ELSE '' END,
      'entry_type', e.entry_type,
      'team_color', t.color_code,
      'team_name', t.team_name,
      'members', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'member_id', m2.member_id::text,
            'management_name', m2.management_name,
            'grade', m2.grade,
            'member_order', em2.member_order
          ) ORDER BY em2.member_order
        )
        FROM entry_members em2
        JOIN members m2 ON m2.member_id = em2.member_id
        WHERE em2.entry_id = e.entry_id
      )
    ) INTO snap_a
    FROM entries e
    LEFT JOIN teams t ON t.team_id = e.team_id
    WHERE e.entry_id = ea;

    SELECT jsonb_build_object(
      'display_name',
        (SELECT string_agg(
          COALESCE(m2.grade || '：', '') || m2.management_name,
          '・' ORDER BY em2.member_order
        )
        FROM entry_members em2
        JOIN members m2 ON m2.member_id = em2.member_id
        WHERE em2.entry_id = e.entry_id)
        || CASE WHEN t.team_name IS NOT NULL THEN '（' || t.team_name || '）' ELSE '' END,
      'entry_type', e.entry_type,
      'team_color', t.color_code,
      'team_name', t.team_name,
      'members', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'member_id', m2.member_id::text,
            'management_name', m2.management_name,
            'grade', m2.grade,
            'member_order', em2.member_order
          ) ORDER BY em2.member_order
        )
        FROM entry_members em2
        JOIN members m2 ON m2.member_id = em2.member_id
        WHERE em2.entry_id = e.entry_id
      )
    ) INTO snap_b
    FROM entries e
    LEFT JOIN teams t ON t.team_id = e.team_id
    WHERE e.entry_id = eb;

    -- 試合作成
    INSERT INTO matches (tournament_id, court_no, entry_a_id, entry_b_id, entry_a_snapshot, entry_b_snapshot)
    VALUES (tid, court, ea, eb, snap_a, snap_b)
    RETURNING match_id INTO match_id_new;

    UPDATE courts SET current_match_id = match_id_new
    WHERE tournament_id = tid AND court_no = court;

    -- 待機列から先頭2組を削除
    DELETE FROM queue_items
    WHERE tournament_id = tid AND court_no = court AND entry_id IN (ea, eb);

    -- 残りの待機列を再採番（ユニーク制約回避のため+1000オフセット経由）
    UPDATE queue_items SET queue_position = queue_position + 1000
    WHERE tournament_id = tid AND court_no = court;

    WITH renumbered AS (
      SELECT queue_item_id, row_number() OVER (ORDER BY queue_position) AS new_pos
      FROM queue_items
      WHERE tournament_id = tid AND court_no = court
    )
    UPDATE queue_items qi SET queue_position = r.new_pos
    FROM renumbered r WHERE qi.queue_item_id = r.queue_item_id;
  END LOOP;

  -- revision更新
  UPDATE tournaments SET revision = revision + 1 WHERE tournament_id = tid;

  RAISE NOTICE 'Initial matches created for all courts (singles 1-7 + doubles 8-10)';
END;
$$;
