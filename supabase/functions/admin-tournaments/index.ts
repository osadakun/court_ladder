/**
 * admin-tournaments Edge Function
 * er_api.md §4-2
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { writeAuditLog } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-tournaments\/?/, "/");
  console.log(`[admin-tournaments] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
  const adminOrError = await requireAdmin(req);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError;

  // GET / → 大会一覧
  if (req.method === "GET" && path === "/") {
    return await listTournaments(url);
  }

  // POST / → 大会作成
  if (req.method === "POST" && path === "/") {
    return await createTournament(req, admin.adminId);
  }

  // Match /:tournamentId patterns
  const idMatch = path.match(/^\/([0-9a-f-]+)\/?(.*)$/);
  if (!idMatch) {
    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  }
  const tournamentId = idMatch[1];
  const subPath = "/" + (idMatch[2] || "");

  // GET /:id → 大会詳細
  if (req.method === "GET" && subPath === "/") {
    return await getTournament(tournamentId);
  }

  // PATCH /:id → 大会設定更新
  if (req.method === "PATCH" && subPath === "/") {
    return await updateTournament(req, tournamentId, admin.adminId);
  }

  // DELETE /:id → 大会削除
  if (req.method === "DELETE" && subPath === "/") {
    return await deleteTournament(tournamentId, admin.adminId);
  }

  // GET /:id/dashboard → ダッシュボード
  if (req.method === "GET" && subPath === "/dashboard") {
    return await getDashboard(tournamentId);
  }

  // POST /:id/actions/start
  if (req.method === "POST" && subPath === "/actions/start") {
    return await changeState(req, tournamentId, "live", admin.adminId);
  }

  // POST /:id/actions/end
  if (req.method === "POST" && subPath === "/actions/end") {
    return await endTournament(req, tournamentId, admin.adminId);
  }

  // POST /:id/actions/reopen
  if (req.method === "POST" && subPath === "/actions/reopen") {
    return await changeState(req, tournamentId, "live", admin.adminId);
  }

  // POST /:id/actions/regenerate-public-token
  if (req.method === "POST" && subPath === "/actions/regenerate-public-token") {
    return await regeneratePublicToken(tournamentId, admin.adminId);
  }

  return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-tournaments] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function listTournaments(url: URL): Promise<Response> {
  const db = getSupabaseClient();
  let query = db.from("tournaments").select("*").order("event_date", { ascending: false });

  const stateFilter = url.searchParams.get("state");
  if (stateFilter) {
    query = query.eq("state", stateFilter);
  }

  const { data, error } = await query;
  if (error) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);
  }
  return successResponse(data);
}

async function createTournament(req: Request, adminId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const {
    name,
    public_page_title,
    event_date,
    singles_court_count,
    doubles_court_count,
    game_point,
    public_queue_display_limit,
    public_enabled,
    allow_same_team_match,
  } = body as {
    name?: string;
    public_page_title?: string;
    event_date?: string;
    singles_court_count?: number;
    doubles_court_count?: number;
    game_point?: number;
    public_queue_display_limit?: number;
    public_enabled?: boolean;
    allow_same_team_match?: boolean;
  };

  if (!name || !event_date || singles_court_count === undefined || doubles_court_count === undefined) {
    return errorResponse(
      ErrorCode.VALIDATION_ERROR,
      "name, event_date, singles_court_count, doubles_court_count は必須です。",
      400,
    );
  }
  const totalCourtCount = singles_court_count + doubles_court_count;
  if (
    singles_court_count < 0 ||
    singles_court_count > 20 ||
    doubles_court_count < 0 ||
    doubles_court_count > 20 ||
    totalCourtCount < 2 ||
    totalCourtCount > 20
  ) {
    return errorResponse(
      ErrorCode.VALIDATION_ERROR,
      "シングルス/ダブルス各 0〜20、合計 2〜20 の範囲で指定してください。",
      400,
    );
  }

  const db = getSupabaseClient();

  // 大会作成
  const { data: tournament, error: createError } = await db
    .from("tournaments")
    .insert({
      name,
      public_page_title: public_page_title || null,
      event_date,
      singles_court_count,
      doubles_court_count,
      game_point: game_point ?? 21,
      public_queue_display_limit: public_queue_display_limit ?? 5,
      public_enabled: public_enabled ?? false,
      allow_same_team_match: allow_same_team_match ?? true,
    })
    .select()
    .single();

  if (createError) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, createError.message, 400);
  }

  // コート行を作成
  const courts = [
    ...Array.from({ length: singles_court_count }, (_, i) => ({
      tournament_id: tournament.tournament_id,
      court_no: i + 1,
      court_type: "singles",
    })),
    ...Array.from({ length: doubles_court_count }, (_, i) => ({
      tournament_id: tournament.tournament_id,
      court_no: singles_court_count + i + 1,
      court_type: "doubles",
    })),
  ];
  const { error: courtsError } = await db.from("courts").insert(courts);
  if (courtsError) {
    // ロールバック: 大会削除
    await db.from("tournaments").delete().eq("tournament_id", tournament.tournament_id);
    return errorResponse(ErrorCode.VALIDATION_ERROR, courtsError.message, 500);
  }

  return successResponse(tournament, { revision: tournament.revision }, 201);
}

async function getTournament(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("tournaments")
    .select("*")
    .eq("tournament_id", tournamentId)
    .single();

  if (error || !data) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }
  return successResponse(data, { revision: data.revision });
}

async function updateTournament(req: Request, tournamentId: string, adminId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();

  // 現在の大会を取得
  const { data: current, error: fetchError } = await db
    .from("tournaments")
    .select("*")
    .eq("tournament_id", tournamentId)
    .single();

  if (fetchError || !current) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }

  // コート構成は preparing のときのみ変更可
  if (
    (body.singles_court_count !== undefined || body.doubles_court_count !== undefined) &&
    current.state !== "preparing"
  ) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "コート構成は準備中の大会でのみ変更できます。", 409);
  }

  const allowedFields = [
    "name",
    "public_page_title",
    "event_date",
    "singles_court_count",
    "doubles_court_count",
    "game_point",
    "public_queue_display_limit",
    "public_enabled",
    "allow_same_team_match",
  ];
  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return successResponse(current, { revision: current.revision });
  }

  const nextSingles = (updateData.singles_court_count as number | undefined) ?? current.singles_court_count;
  const nextDoubles = (updateData.doubles_court_count as number | undefined) ?? current.doubles_court_count;
  const nextTotal = nextSingles + nextDoubles;
  if (
    nextSingles < 0 ||
    nextSingles > 20 ||
    nextDoubles < 0 ||
    nextDoubles > 20 ||
    nextTotal < 2 ||
    nextTotal > 20
  ) {
    return errorResponse(
      ErrorCode.VALIDATION_ERROR,
      "シングルス/ダブルス各 0〜20、合計 2〜20 の範囲で指定してください。",
      400,
    );
  }

  if (
    nextSingles !== current.singles_court_count ||
    nextDoubles !== current.doubles_court_count
  ) {
    const nextTotal = nextSingles + nextDoubles;
    const nextCourtType = (courtNo: number) =>
      courtNo <= nextSingles ? "singles" : "doubles";

    const { data: queueItems } = await db
      .from("queue_items")
      .select("court_no")
      .eq("tournament_id", tournamentId);
    const { data: entries } = await db
      .from("entries")
      .select("initial_court_no")
      .eq("tournament_id", tournamentId);

    const usedCourtNos = new Set<number>([
      ...(queueItems || []).map((item: { court_no: number }) => item.court_no),
      ...(entries || []).map((entry: { initial_court_no: number }) => entry.initial_court_no),
    ]);

    for (const courtNo of usedCourtNos) {
      const existedBefore = courtNo <= current.singles_court_count + current.doubles_court_count;
      const existsAfter = courtNo <= nextTotal;
      if (!existsAfter) {
        return errorResponse(
          ErrorCode.VALIDATION_ERROR,
          `コート ${courtNo} に既存データがあるため、このコート構成には変更できません。`,
          409,
        );
      }

      if (existedBefore) {
        const oldType = courtNo <= current.singles_court_count ? "singles" : "doubles";
        const newType = nextCourtType(courtNo);
        if (oldType !== newType) {
          return errorResponse(
            ErrorCode.VALIDATION_ERROR,
            `コート ${courtNo} に既存データがあるため、シングルス/ダブルス境界を変更できません。`,
            409,
          );
        }
      }
    }
  }

  const { data, error } = await db
    .from("tournaments")
    .update(updateData)
    .eq("tournament_id", tournamentId)
    .select()
    .single();

  if (error) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 400);
  }

  if (
    nextSingles !== current.singles_court_count ||
    nextDoubles !== current.doubles_court_count
  ) {
    const nextTotal = nextSingles + nextDoubles;
    const currentTotal = current.singles_court_count + current.doubles_court_count;

    for (let courtNo = currentTotal; courtNo > nextTotal; courtNo--) {
      await db
        .from("courts")
        .delete()
        .eq("tournament_id", tournamentId)
        .eq("court_no", courtNo);
    }

    const upsertCourts = Array.from({ length: nextTotal }, (_, i) => ({
      tournament_id: tournamentId,
      court_no: i + 1,
      court_type: i + 1 <= nextSingles ? "singles" : "doubles",
    }));

    for (const court of upsertCourts) {
      const { data: existingCourt } = await db
        .from("courts")
        .select("court_id")
        .eq("tournament_id", tournamentId)
        .eq("court_no", court.court_no)
        .maybeSingle();

      if (existingCourt) {
        await db
          .from("courts")
          .update({ court_type: court.court_type })
          .eq("court_id", existingCourt.court_id);
      } else {
        await db.from("courts").insert(court);
      }
    }
  }

  await writeAuditLog({ tournamentId, adminId, actionType: "tournament_update", targetType: "tournament", targetId: tournamentId, before: current, after: data });
  return successResponse(data, { revision: data.revision });
}

async function deleteTournament(tournamentId: string, adminId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data: current } = await db
    .from("tournaments")
    .select("state")
    .eq("tournament_id", tournamentId)
    .single();

  if (!current) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }
  if (current.state !== "ended") {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "終了済みの大会のみ削除できます。", 409);
  }

  const { error } = await db.from("tournaments").delete().eq("tournament_id", tournamentId);
  if (error) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);
  }

  await writeAuditLog({ tournamentId, adminId, actionType: "tournament_delete", targetType: "tournament", targetId: tournamentId, before: current });

  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

async function changeState(
  req: Request,
  tournamentId: string,
  newState: string,
  adminId: string,
): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("tournaments")
    .update({ state: newState })
    .eq("tournament_id", tournamentId)
    .select()
    .single();

  if (error || !data) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }

  // revision 加算
  const { data: updated, error: revError } = await db.rpc("increment_revision", {
    p_tournament_id: tournamentId,
  });

  // rpc がない場合は手動で加算
  if (revError) {
    await db
      .from("tournaments")
      .update({ revision: data.revision + 1 })
      .eq("tournament_id", tournamentId);
  }

  // 最新を取得
  const { data: final } = await db
    .from("tournaments")
    .select("*")
    .eq("tournament_id", tournamentId)
    .single();

  await writeAuditLog({ tournamentId, adminId, actionType: `tournament_${newState === "live" ? "start" : newState}`, targetType: "tournament", targetId: tournamentId, after: final });

  return successResponse(final, { revision: final?.revision });
}

async function endTournament(
  req: Request,
  tournamentId: string,
  adminId: string,
): Promise<Response> {
  const db = getSupabaseClient();

  // in_progress 試合の存在チェック
  const { count } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress");

  if (count && count > 0) {
    return errorResponse(ErrorCode.ACTIVE_MATCHES_EXIST, "進行中の試合があります。先に結果確定または手動解消を行ってください。", 409);
  }

  return await changeState(req, tournamentId, "ended", adminId);
}

async function regeneratePublicToken(
  tournamentId: string,
  adminId: string,
): Promise<Response> {
  const db = getSupabaseClient();

  // 新しいトークンを生成
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const newToken = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const { data, error } = await db
    .from("tournaments")
    .update({ public_token: newToken })
    .eq("tournament_id", tournamentId)
    .select()
    .single();

  if (error || !data) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }

  await writeAuditLog({ tournamentId, adminId, actionType: "tournament_regenerate_token", targetType: "tournament", targetId: tournamentId });

  return successResponse({ public_token: data.public_token }, { revision: data.revision });
}

async function getDashboard(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();

  // 大会情報
  const { data: tournament, error: tError } = await db
    .from("tournaments")
    .select("*")
    .eq("tournament_id", tournamentId)
    .single();

  if (tError || !tournament) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }

  // コート一覧
  const { data: courts } = await db
    .from("courts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("court_no");

  // 現在対戦（in_progress）
  const { data: currentMatches } = await db
    .from("matches")
    .select("*, entry_a:entries!entry_a_id(entry_id, entry_type, team:teams(team_name, color_code)), entry_b:entries!entry_b_id(entry_id, entry_type, team:teams(team_name, color_code))")
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress");

  // 待機列
  const { data: queueItems } = await db
    .from("queue_items")
    .select("*, entry:entries(entry_id, entry_type, team:teams(team_name, color_code), entry_members(member_order, member:members(management_name, grade)))")
    .eq("tournament_id", tournamentId)
    .order("court_no")
    .order("queue_position");

  // 各コートの直近 finished 試合（ロールバック用）— DISTINCT ON でコートごと最新1件
  const { data: recentFinished } = await db.rpc("recent_finished_per_court", {
    p_tournament_id: tournamentId,
  });

  return successResponse({
    tournament,
    courts: courts || [],
    current_matches: currentMatches || [],
    queue_items: queueItems || [],
    recent_finished_matches: recentFinished || [],
  }, { revision: tournament.revision });
}
