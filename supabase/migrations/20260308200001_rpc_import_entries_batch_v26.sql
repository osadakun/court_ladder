-- RPC: import_entries_batch v2.6
-- grade フィールド + initial_court_no 対応 + 待機列自動追加
-- category を廃止し、メンバーごとの grade を使用

CREATE OR REPLACE FUNCTION import_entries_batch(
  p_tournament_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  row_item JSONB;
  member_item JSONB;
  v_entry_id UUID;
  v_member_id UUID;
  v_team_id UUID;
  v_member_order INT;
  v_created_count INT := 0;
  v_initial_court_no INT;
  v_next_position INT;
BEGIN
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    -- team_id を解決
    v_team_id := NULL;
    IF row_item->>'team_name' IS NOT NULL AND row_item->>'team_name' != '' THEN
      SELECT team_id INTO v_team_id
      FROM teams
      WHERE tournament_id = p_tournament_id AND team_name = row_item->>'team_name'
      LIMIT 1;
    END IF;

    -- initial_court_no を取得
    v_initial_court_no := (row_item->>'initial_court_no')::INT;

    -- エントリー作成（initial_court_no 含む）
    INSERT INTO entries (tournament_id, entry_type, team_id, initial_court_no)
    VALUES (p_tournament_id, row_item->>'entry_type', v_team_id, v_initial_court_no)
    RETURNING entry_id INTO v_entry_id;

    -- メンバー作成 + entry_members（各メンバーに grade を設定）
    v_member_order := 1;
    FOR member_item IN SELECT * FROM jsonb_array_elements(row_item->'members')
    LOOP
      INSERT INTO members (tournament_id, management_name, grade)
      VALUES (p_tournament_id, member_item->>'management_name', member_item->>'grade')
      RETURNING member_id INTO v_member_id;

      INSERT INTO entry_members (tournament_id, entry_id, member_id, member_order)
      VALUES (p_tournament_id, v_entry_id, v_member_id, v_member_order);

      v_member_order := v_member_order + 1;
    END LOOP;

    -- 初期コートの待機列末尾に追加
    SELECT COALESCE(MAX(queue_position), 0) + 1 INTO v_next_position
    FROM queue_items
    WHERE tournament_id = p_tournament_id AND court_no = v_initial_court_no;

    INSERT INTO queue_items (tournament_id, court_no, entry_id, queue_position, enqueue_reason)
    VALUES (p_tournament_id, v_initial_court_no, v_entry_id, v_next_position, 'initial');

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN jsonb_build_object('created_count', v_created_count);
END;
$$;
