/**
 * 監査ログ書き込みヘルパー
 * spec.md §7-3
 */
import { getSupabaseClient } from "./db.ts";

export async function writeAuditLog(params: {
  tournamentId: string;
  adminId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const db = getSupabaseClient();
  const { error } = await db.from("audit_logs").insert({
    tournament_id: params.tournamentId,
    actor_admin_id: params.adminId,
    action_type: params.actionType,
    target_type: params.targetType,
    target_id: params.targetId,
    before_json: params.before ?? null,
    after_json: params.after ?? null,
  });
  if (error) {
    console.error("[audit] Failed to write audit log:", error);
  }
}
