/**
 * admin-teams Edge Function
 * er_api.md §4-5
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { writeAuditLog } from "../_shared/audit.ts";

// プリセット20色パレット
const PRESET_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16",
  "#22C55E", "#14B8A6", "#06B6D4", "#0EA5E9", "#3B82F6",
  "#6366F1", "#8B5CF6", "#A855F7", "#D946EF", "#EC4899",
  "#F43F5E", "#78716C", "#64748B", "#0D9488", "#D97706",
];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-teams\/?/, "/");
  console.log(`[admin-teams] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
  const adminOrError = await requireAdmin(req);
  if (adminOrError instanceof Response) return adminOrError;

  // Extract tournamentId from path: /:tournamentId/...
  const baseMatch = path.match(/^\/([0-9a-f-]+)\/?(.*)$/);
  if (!baseMatch) {
    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  }
  const tournamentId = baseMatch[1];
  const subPath = "/" + (baseMatch[2] || "");

  // GET / → チーム一覧
  if (req.method === "GET" && subPath === "/") {
    return await listTeams(tournamentId);
  }

  // POST / → チーム作成
  if (req.method === "POST" && subPath === "/") {
    return await createTeam(req, tournamentId, adminOrError.adminId);
  }

  // Match /:teamId
  const teamMatch = subPath.match(/^\/([0-9a-f-]+)\/?$/);
  if (teamMatch) {
    const teamId = teamMatch[1];
    if (req.method === "PATCH") return await updateTeam(req, tournamentId, teamId, adminOrError.adminId);
    if (req.method === "DELETE") return await deleteTeam(tournamentId, teamId, adminOrError.adminId);
  }

  return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-teams] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function listTeams(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("teams")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("sort_order");

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);
  return successResponse(data);
}

async function createTeam(req: Request, tournamentId: string, adminId: string): Promise<Response> {
  let body: { team_name?: string; color_code?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  if (!body.team_name) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "team_name は必須です。", 400);
  }

  const db = getSupabaseClient();

  // 次の sort_order を取得
  const { data: existing } = await db
    .from("teams")
    .select("sort_order")
    .eq("tournament_id", tournamentId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 1;

  // color_code 未指定時はプリセットから自動割り当て
  const colorCode = body.color_code || PRESET_COLORS[(nextSortOrder - 1) % PRESET_COLORS.length];

  const { data, error } = await db
    .from("teams")
    .insert({
      tournament_id: tournamentId,
      team_name: body.team_name,
      color_code: colorCode,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 400);
  await writeAuditLog({
    tournamentId,
    adminId,
    actionType: "team_create",
    targetType: "team",
    targetId: data.team_id,
    after: data,
  });
  return successResponse(data, undefined, 201);
}

async function updateTeam(req: Request, tournamentId: string, teamId: string, adminId: string): Promise<Response> {
  let body: { team_name?: string; color_code?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();
  const { data: current } = await db
    .from("teams")
    .select("*")
    .eq("team_id", teamId)
    .eq("tournament_id", tournamentId)
    .single();
  const updateData: Record<string, unknown> = {};
  if (body.team_name !== undefined) updateData.team_name = body.team_name;
  if (body.color_code !== undefined) updateData.color_code = body.color_code;

  if (Object.keys(updateData).length === 0) {
    const { data } = await db.from("teams").select("*").eq("team_id", teamId).eq("tournament_id", tournamentId).single();
    if (!data) return errorResponse(ErrorCode.NOT_FOUND, "チームが見つかりません。", 404);
    return successResponse(data);
  }

  const { data, error } = await db
    .from("teams")
    .update(updateData)
    .eq("team_id", teamId)
    .eq("tournament_id", tournamentId)
    .select()
    .single();

  if (error || !data) return errorResponse(ErrorCode.NOT_FOUND, "チームが見つかりません。", 404);
  await writeAuditLog({
    tournamentId,
    adminId,
    actionType: "team_update",
    targetType: "team",
    targetId: teamId,
    before: current,
    after: data,
  });
  return successResponse(data);
}

async function deleteTeam(tournamentId: string, teamId: string, adminId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data: current } = await db
    .from("teams")
    .select("*")
    .eq("team_id", teamId)
    .eq("tournament_id", tournamentId)
    .single();

  // 所属エントリーの team_id を null に
  await db
    .from("entries")
    .update({ team_id: null })
    .eq("team_id", teamId)
    .eq("tournament_id", tournamentId);

  const { error } = await db
    .from("teams")
    .delete()
    .eq("team_id", teamId)
    .eq("tournament_id", tournamentId);

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);
  if (current) {
    await writeAuditLog({
      tournamentId,
      adminId,
      actionType: "team_delete",
      targetType: "team",
      targetId: teamId,
      before: current,
    });
  }
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
}
