-- RPC: import_entries_batch
-- CSV取込 commit のトランザクション化（review.md Finding 5）
-- members → entries → entry_members をアトミックに実行する

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

    -- エントリー作成
    INSERT INTO entries (tournament_id, entry_type, team_id)
    VALUES (p_tournament_id, row_item->>'entry_type', v_team_id)
    RETURNING entry_id INTO v_entry_id;

    -- メンバー作成 + entry_members
    v_member_order := 1;
    FOR member_item IN SELECT * FROM jsonb_array_elements(row_item->'members')
    LOOP
      INSERT INTO members (tournament_id, management_name, category)
      VALUES (p_tournament_id, member_item->>'management_name', row_item->>'category')
      RETURNING member_id INTO v_member_id;

      INSERT INTO entry_members (tournament_id, entry_id, member_id, member_order)
      VALUES (p_tournament_id, v_entry_id, v_member_id, v_member_order);

      v_member_order := v_member_order + 1;
    END LOOP;

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN jsonb_build_object('created_count', v_created_count);
END;
$$;
