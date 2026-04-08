/**
 * admin-courts Edge Function
 * er_api.md §4-6
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { writeAuditLog } from "../_shared/audit.ts";
import { canAddToQueue } from "../_shared/core/entry-rules.ts";
import { reorderQueue, requeueEntries, canAutoGenerateMatch, pickMatchEntries } from "../_shared/core/queue-manager.ts";
import { createEntrySnapshot } from "../_shared/core/display-name.ts";
import type { QueueEntry } from "../_shared/core/types.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-courts\/?/, "/");
  console.log(`[admin-courts] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
  const adminOrError = await requireAdmin(req);
  if (adminOrError instanceof Response) return adminOrError;

  const baseMatch = path.match(/^\/([0-9a-f-]+)\/?(.*)$/);
  if (!baseMatch) {
    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  }
  const tournamentId = baseMatch[1];
  const subPath = "/" + (baseMatch[2] || "");

  // GET / → コート一覧
  if (req.method === "GET" && subPath === "/") {
    return await listCourts(tournamentId);
  }

  // Match /courts/:courtNo/...
  const courtMatch = subPath.match(/^\/(\d+)\/?(.*)$/);
  if (courtMatch) {
    const courtNo = parseInt(courtMatch[1]);
    const actionPath = "/" + (courtMatch[2] || "");

    if (req.method === "GET" && actionPath === "/") return await getCourtDetail(tournamentId, courtNo);
    if (req.method === "PATCH" && actionPath === "/queue") return await reorderQueueHandler(req, tournamentId, courtNo, adminOrError.adminId);
    if (req.method === "POST" && actionPath === "/queue/entries") return await addToQueue(req, tournamentId, courtNo, adminOrError.adminId);
    if (req.method === "POST" && actionPath === "/actions/stop") return await stopCourt(req, tournamentId, courtNo, adminOrError.adminId);
    if (req.method === "POST" && actionPath === "/actions/resume") return await resumeCourt(req, tournamentId, courtNo, adminOrError.adminId);
    if (req.method === "POST" && actionPath === "/actions/recalculate") return await recalculate(req, tournamentId, courtNo);
    if (req.method === "POST" && actionPath === "/actions/clear-current-match") return await clearCurrentMatch(req, tournamentId, courtNo, adminOrError.adminId);
  }

  return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-courts] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function listCourts(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("courts")
    .select("*, current_match:matches!courts_current_match_id_fkey(match_id, entry_a_id, entry_b_id, entry_a_snapshot, entry_b_snapshot)")
    .eq("tournament_id", tournamentId)
    .order("court_no");

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  // 各コートの待機列件数を付加
  const { data: queueCounts } = await db
    .from("queue_items")
    .select("court_no")
    .eq("tournament_id", tournamentId);

  const countMap = new Map<number, number>();
  for (const q of queueCounts || []) {
    countMap.set(q.court_no, (countMap.get(q.court_no) || 0) + 1);
  }

  const enriched = (data || []).map((c: Record<string, unknown>) => ({
    ...c,
    queue_count: countMap.get(c.court_no as number) || 0,
  }));

  return successResponse(enriched);
}

async function getCourtDetail(tournamentId: string, courtNo: number): Promise<Response> {
  const db = getSupabaseClient();

  const { data: court, error } = await db
    .from("courts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .single();

  if (error || !court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);

  // 現在対戦
  const { data: currentMatch } = await db
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .eq("state", "in_progress")
    .maybeSingle();

  // 待機列
  const { data: queue } = await db
    .from("queue_items")
    .select("*, entry:entries(entry_id, entry_type, status, initial_court_no, team:teams(team_name, color_code), entry_members(member_order, member:members(management_name, grade)))")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .order("queue_position");

  return successResponse({
    court,
    current_match: currentMatch || null,
    queue: queue || [],
  });
}

async function reorderQueueHandler(req: Request, tournamentId: string, courtNo: number, adminId: string): Promise<Response> {
  let body: { version?: number; entry_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();

  // コートの version チェック
  const { data: court } = await db
    .from("courts")
    .select("version")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .single();

  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);

  if (body.version !== undefined && body.version !== court.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。", 409);
  }

  // 現在の待機列と一致チェック
  const { data: currentQueue } = await db
    .from("queue_items")
    .select("queue_item_id, entry_id, queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .order("queue_position");

  const currentEntryIds = (currentQueue || []).map((q: { entry_id: string }) => q.entry_id);
  const requestedIds = body.entry_ids || [];

  if (
    currentEntryIds.length !== requestedIds.length ||
    !currentEntryIds.every((id: string) => requestedIds.includes(id))
  ) {
    return errorResponse(ErrorCode.QUEUE_MISMATCH, "待機列の構成が変更されています。再読込してください。", 409);
  }

  // 再採番
  const newOrder = reorderQueue(requestedIds);
  for (const item of newOrder) {
    await db
      .from("queue_items")
      .update({ queue_position: item.queuePosition })
      .eq("tournament_id", tournamentId)
      .eq("court_no", courtNo)
      .eq("entry_id", item.entryId);
  }

  // コート version 加算
  await db
    .from("courts")
    .update({ version: court.version + 1 })
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo);

  // revision 加算
  await incrementRevision(db, tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "queue_reorder", targetType: "court", targetId: `court_${courtNo}`, after: { court_no: courtNo, entry_ids: requestedIds } });

  return await getCourtDetail(tournamentId, courtNo);
}

async function addToQueue(req: Request, tournamentId: string, courtNo: number, adminId: string): Promise<Response> {
  let body: { entry_id?: string; target_court_version?: number; insert_position?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  if (!body.entry_id) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "entry_id は必須です。", 400);
  }

  const db = getSupabaseClient();

  // コートチェック
  const { data: court } = await db
    .from("courts")
    .select("status, version")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .single();

  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);
  if (court.status !== "active") return errorResponse(ErrorCode.COURT_STOPPED, "停止中のコートには追加できません。", 409);

  if (body.target_court_version !== undefined && body.target_court_version !== court.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。", 409);
  }

  // エントリーチェック
  const { data: entry } = await db
    .from("entries")
    .select("status")
    .eq("entry_id", body.entry_id)
    .eq("tournament_id", tournamentId)
    .single();

  if (!entry) return errorResponse(ErrorCode.NOT_FOUND, "エントリーが見つかりません。", 404);

  // 待機列にいるか
  const { count: queueCount } = await db
    .from("queue_items")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("entry_id", body.entry_id);

  // in_progress 試合に含まれるか
  const { count: matchCount } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress")
    .or(`entry_a_id.eq.${body.entry_id},entry_b_id.eq.${body.entry_id}`);

  const addCheck = canAddToQueue(
    entry.status as "active" | "paused" | "withdrawn",
    (queueCount || 0) > 0,
    (matchCount || 0) > 0,
  );

  if (!addCheck.allowed) {
    return errorResponse(addCheck.errorCode!, addCheck.errorMessage!, 409);
  }

  // 待機列に追加
  const { data: currentQueue } = await db
    .from("queue_items")
    .select("queue_item_id, queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .order("queue_position");

  const pos = body.insert_position ?? ((currentQueue?.length || 0) + 1);

  // 挿入位置以降をシフト（逆順で処理）
  if (currentQueue) {
    for (let i = currentQueue.length - 1; i >= 0; i--) {
      if (currentQueue[i].queue_position >= pos) {
        await db.from("queue_items").update({ queue_position: currentQueue[i].queue_position + 1 }).eq("queue_item_id", currentQueue[i].queue_item_id);
      }
    }
  }

  await db.from("queue_items").insert({
    tournament_id: tournamentId,
    court_no: courtNo,
    entry_id: body.entry_id,
    queue_position: pos,
    enqueue_reason: "manual",
  });

  // movement_log
  await db.from("movement_logs").insert({
    tournament_id: tournamentId,
    entry_id: body.entry_id,
    from_court_no: null,
    to_court_no: courtNo,
    movement_reason: "manual",
  });

  await incrementRevision(db, tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "queue_add", targetType: "entry", targetId: body.entry_id!, after: { court_no: courtNo, queue_position: pos } });

  return await getCourtDetail(tournamentId, courtNo);
}

async function stopCourt(req: Request, tournamentId: string, courtNo: number, adminId: string): Promise<Response> {
  let body: { version?: number; reason?: string };
  try { body = await req.json(); } catch { body = {}; }

  const db = getSupabaseClient();
  const { data: court } = await db.from("courts").select("court_id, version").eq("tournament_id", tournamentId).eq("court_no", courtNo).single();
  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);

  if (body.version !== undefined && body.version !== court.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。", 409);
  }

  await db.from("courts").update({ status: "stopped", version: court.version + 1 }).eq("tournament_id", tournamentId).eq("court_no", courtNo);
  await incrementRevision(db, tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "court_stop", targetType: "court", targetId: court.court_id, after: { court_no: courtNo, status: "stopped" } });

  return await getCourtDetail(tournamentId, courtNo);
}

async function resumeCourt(req: Request, tournamentId: string, courtNo: number, adminId: string): Promise<Response> {
  let body: { version?: number; reason?: string };
  try { body = await req.json(); } catch { body = {}; }

  const db = getSupabaseClient();
  const { data: court } = await db.from("courts").select("court_id, version").eq("tournament_id", tournamentId).eq("court_no", courtNo).single();
  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);

  if (body.version !== undefined && body.version !== court.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。", 409);
  }

  await db.from("courts").update({ status: "active", version: court.version + 1 }).eq("tournament_id", tournamentId).eq("court_no", courtNo);
  await incrementRevision(db, tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "court_resume", targetType: "court", targetId: court.court_id, after: { court_no: courtNo, status: "active" } });

  // 再開後に自動試合生成を試みる
  const { data: courts } = await db.from("courts").select("court_id, court_no, status, current_match_id").eq("tournament_id", tournamentId).order("court_no");
  await tryAutoGenerateMatch(db, tournamentId, courtNo, courts || []);

  return await getCourtDetail(tournamentId, courtNo);
}

async function recalculate(req: Request, tournamentId: string, courtNo: number): Promise<Response> {
  let body: { version?: number };
  try { body = await req.json(); } catch { body = {}; }

  const db = getSupabaseClient();
  const { data: court } = await db.from("courts").select("status, current_match_id, version").eq("tournament_id", tournamentId).eq("court_no", courtNo).single();
  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);

  if (court.status !== "active") return errorResponse(ErrorCode.COURT_STOPPED, "停止中のコートでは再計算できません。", 409);
  if (court.current_match_id) return errorResponse(ErrorCode.CURRENT_MATCH_EXISTS, "現在対戦があるコートでは再計算できません。", 409);

  if (body.version !== undefined && body.version !== court.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。", 409);
  }

  const { data: courts } = await db.from("courts").select("court_id, court_no, status, current_match_id").eq("tournament_id", tournamentId).order("court_no");
  await tryAutoGenerateMatch(db, tournamentId, courtNo, courts || []);

  return await getCourtDetail(tournamentId, courtNo);
}

async function clearCurrentMatch(req: Request, tournamentId: string, courtNo: number, adminId: string): Promise<Response> {
  let body: { version?: number; requeue_mode?: string; note?: string };
  try { body = await req.json(); } catch { body = {}; }

  const db = getSupabaseClient();
  const { data: court } = await db.from("courts").select("current_match_id, version").eq("tournament_id", tournamentId).eq("court_no", courtNo).single();
  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);
  if (!court.current_match_id) return errorResponse(ErrorCode.NOT_FOUND, "現在対戦がありません。", 404);

  if (body.version !== undefined && body.version !== court.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。", 409);
  }

  // 試合を cancelled に
  const { data: match } = await db.from("matches").select("match_id, entry_a_id, entry_b_id").eq("match_id", court.current_match_id).single();
  if (!match) return errorResponse(ErrorCode.NOT_FOUND, "試合が見つかりません。", 404);

  await db.from("matches").update({
    state: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancel_reason: "manual_clear",
  }).eq("match_id", match.match_id);

  // current_match_id をクリア
  await db.from("courts").update({ current_match_id: null, version: court.version + 1 }).eq("tournament_id", tournamentId).eq("court_no", courtNo);

  // entry_a → entry_b の順で待機列末尾へ
  const { data: queue } = await db.from("queue_items").select("queue_position").eq("tournament_id", tournamentId).eq("court_no", courtNo).order("queue_position", { ascending: false }).limit(1);
  const maxPos = queue && queue.length > 0 ? queue[0].queue_position : 0;

  await db.from("queue_items").insert([
    { tournament_id: tournamentId, court_no: courtNo, entry_id: match.entry_a_id, queue_position: maxPos + 1, enqueue_reason: "manual_requeue" },
    { tournament_id: tournamentId, court_no: courtNo, entry_id: match.entry_b_id, queue_position: maxPos + 2, enqueue_reason: "manual_requeue" },
  ]);

  // movement_logs
  await db.from("movement_logs").insert([
    { tournament_id: tournamentId, entry_id: match.entry_a_id, from_court_no: courtNo, to_court_no: courtNo, movement_reason: "manual_requeue" },
    { tournament_id: tournamentId, entry_id: match.entry_b_id, from_court_no: courtNo, to_court_no: courtNo, movement_reason: "manual_requeue" },
  ]);

  await incrementRevision(db, tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "court_clear_match", targetType: "match", targetId: match.match_id, before: { entry_a_id: match.entry_a_id, entry_b_id: match.entry_b_id, court_no: courtNo } });

  return await getCourtDetail(tournamentId, courtNo);
}

// --- ヘルパー ---

async function incrementRevision(db: ReturnType<typeof getSupabaseClient>, tournamentId: string) {
  const { data } = await db.from("tournaments").select("revision").eq("tournament_id", tournamentId).single();
  if (data) {
    await db.from("tournaments").update({ revision: data.revision + 1 }).eq("tournament_id", tournamentId);
  }
}

async function tryAutoGenerateMatch(
  db: ReturnType<typeof getSupabaseClient>,
  tournamentId: string,
  courtNo: number,
  courts: { court_id: string; court_no: number; status: string; current_match_id: string | null }[],
) {
  const court = courts.find((c) => c.court_no === courtNo);
  if (!court) return;

  const { count: inProgressCount } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .eq("state", "in_progress")
    .eq("match_type", "regular");

  const { data: queue } = await db
    .from("queue_items")
    .select("entry_id, queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .order("queue_position");

  const { data: tournament } = await db
    .from("tournaments")
    .select("state")
    .eq("tournament_id", tournamentId)
    .single();

  const canGenerate = canAutoGenerateMatch({
    tournamentState: tournament?.state || "",
    courtStatus: court.status as "active" | "stopped",
    hasInProgressMatch: (inProgressCount || 0) > 0,
    queueSize: queue?.length || 0,
  });

  if (!canGenerate) return;

  const queueEntries: QueueEntry[] = (queue || []).map((q: { entry_id: string; queue_position: number }) => ({
    entryId: q.entry_id,
    queuePosition: q.queue_position,
  }));
  const {
    entryA,
    entryB,
    entryAOriginalQueuePosition,
    entryBOriginalQueuePosition,
  } = pickMatchEntries(queueEntries);

  // ピック対象が既に別の in_progress 試合に入っていないか確認（リクエスト試合含む）
  const { count: pickedInProgress } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress")
    .or(`entry_a_id.in.(${entryA},${entryB}),entry_b_id.in.(${entryA},${entryB})`);
  if ((pickedInProgress || 0) > 0) return;

  // スナップショット作成
  const snapshotA = await buildSnapshot(db, entryA);
  const snapshotB = await buildSnapshot(db, entryB);

  const { data: newMatch } = await db.from("matches").insert({
    tournament_id: tournamentId,
    court_no: courtNo,
    match_type: "regular",
    entry_a_id: entryA,
    entry_b_id: entryB,
    entry_a_snapshot: snapshotA,
    entry_b_snapshot: snapshotB,
    entry_a_original_queue_position: entryAOriginalQueuePosition,
    entry_b_original_queue_position: entryBOriginalQueuePosition,
  }).select().single();

  if (newMatch) {
    await db.from("courts").update({ current_match_id: newMatch.match_id }).eq("tournament_id", tournamentId).eq("court_no", courtNo);
  }

  await db.from("queue_items").delete().eq("tournament_id", tournamentId).eq("court_no", courtNo).in("entry_id", [entryA, entryB]);

  // 残りを再採番
  const { data: remaining } = await db.from("queue_items").select("queue_item_id, queue_position").eq("tournament_id", tournamentId).eq("court_no", courtNo).order("queue_position");
  if (remaining) {
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].queue_position !== i + 1) {
        await db.from("queue_items").update({ queue_position: i + 1 }).eq("queue_item_id", remaining[i].queue_item_id);
      }
    }
  }
}

async function buildSnapshot(db: ReturnType<typeof getSupabaseClient>, entryId: string): Promise<Record<string, unknown> | null> {
  const { data: entry } = await db
    .from("entries")
    .select("entry_type, team:teams(team_name, color_code), entry_members(member_order, member:members(management_name, grade))")
    .eq("entry_id", entryId)
    .single();

  if (!entry) return null;

  const members = ((entry.entry_members || []) as {
    member_order: number;
    member: { management_name: string; grade: string | null } | { management_name: string; grade: string | null }[];
  }[])
    .sort((a, b) => a.member_order - b.member_order)
    .map((em) => {
      const m = Array.isArray(em.member) ? em.member[0] : em.member;
      return { managementName: m?.management_name ?? "", grade: m?.grade ?? undefined };
    });

  const teamRaw = entry.team as { team_name: string; color_code: string } | { team_name: string; color_code: string }[] | null;
  const teamObj = Array.isArray(teamRaw) ? (teamRaw.length > 0 ? teamRaw[0] : null) : teamRaw;
  const teamName = teamObj?.team_name || null;
  const teamColor = teamObj?.color_code || null;

  const snapshot = createEntrySnapshot(entry.entry_type as "singles" | "doubles", members, teamName);
  return { ...snapshot, team_color: teamColor };
}
