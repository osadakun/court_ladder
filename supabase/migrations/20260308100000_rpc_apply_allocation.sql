-- RPC: apply_allocation
-- allocationApply のトランザクション化（review.md Finding 1）
-- queue_items の全削除と挿入をアトミックに実行する

CREATE OR REPLACE FUNCTION apply_allocation(
  p_tournament_id UUID,
  p_plan JSONB
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- 既存の queue_items を全削除
  DELETE FROM queue_items WHERE tournament_id = p_tournament_id;

  -- plan に基づいて queue_items を一括挿入
  INSERT INTO queue_items (tournament_id, court_no, entry_id, queue_position, enqueue_reason)
  SELECT
    p_tournament_id,
    (item->>'court_no')::int,
    (item->>'entry_id')::uuid,
    (item->>'queue_position')::int,
    'initial'
  FROM jsonb_array_elements(p_plan) AS item;
END;
$$;
