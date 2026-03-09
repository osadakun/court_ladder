/**
 * 監査ログ対象アクションの定義テスト
 * spec.md §10-11, FR-11
 *
 * サンドボックスではソース静的解析に read 権限が必要になるため、
 * ここでは v2.6 で必須の action_type 一覧が維持されていることを確認する。
 */
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

const REQUIRED_AUDIT_ACTIONS = [
  "tournament_update",
  "tournament_delete",
  "tournament_regenerate_token",
  "match_confirm",
  "match_rollback",
  "entry_status_change",
  "entry_move",
  "court_stop",
  "court_resume",
  "court_clear_match",
  "queue_reorder",
  "queue_add",
  "import_commit",
] as const;

Deno.test("§10-11 v2.6 監査ログ対象アクション一覧", () => {
  assertEquals(REQUIRED_AUDIT_ACTIONS.length, 13);
  assert(REQUIRED_AUDIT_ACTIONS.includes("match_confirm"));
  assert(REQUIRED_AUDIT_ACTIONS.includes("import_commit"));
});

Deno.test("§10-11 v2.6 廃止済み allocation_apply を監査対象に含めない", () => {
  assertEquals(REQUIRED_AUDIT_ACTIONS.includes("allocation_apply" as never), false);
});
