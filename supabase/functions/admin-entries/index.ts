/**
 * admin-entries Edge Function
 * er_api.md §4-3
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { writeAuditLog } from "../_shared/audit.ts";
import { validateStatusChange } from "../_shared/core/entry-rules.ts";

const ENTRY_SELECT =
  "*, team:teams(team_id, team_name, color_code), entry_members(member_order, member:members(member_id, management_name, grade))";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-entries\/?/, "/");
  console.log(`[admin-entries] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
  const adminOrError = await requireAdmin(req);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError;

  const baseMatch = path.match(/^\/([0-9a-f-]+)\/?(.*)$/);
  if (!baseMatch) {
    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  }
  const tournamentId = baseMatch[1];
  const subPath = "/" + (baseMatch[2] || "");

  // GET / → エントリー一覧
  if (req.method === "GET" && subPath === "/") {
    return await listEntries(tournamentId, url);
  }

  // POST / → エントリー作成
  if (req.method === "POST" && subPath === "/") {
    return await createEntry(req, tournamentId);
  }

  // Match /:entryId
  const entryMatch = subPath.match(/^\/([0-9a-f-]+)\/?(.*)$/);
  if (entryMatch) {
    const entryId = entryMatch[1];
    const actionPath = "/" + (entryMatch[2] || "");

    if (req.method === "GET" && actionPath === "/") {
      return await getEntry(tournamentId, entryId);
    }
    if (req.method === "PATCH" && actionPath === "/") {
      return await updateEntry(req, tournamentId, entryId, admin.adminId);
    }
    // POST /:entryId/actions/move
    if (req.method === "POST" && actionPath === "/actions/move") {
      return await moveEntry(req, tournamentId, entryId, admin.adminId);
    }
  }

  return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-entries] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function listEntries(tournamentId: string, url: URL): Promise<Response> {
  const db = getSupabaseClient();

  let query = db
    .from("entries")
    .select(ENTRY_SELECT)
    .eq("tournament_id", tournamentId)
    .order("created_at");

  const statusFilter = url.searchParams.get("status");
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const includeWithdrawn = url.searchParams.get("include_withdrawn");
  if (includeWithdrawn !== "true" && !statusFilter) {
    query = query.neq("status", "withdrawn");
  }

  const q = url.searchParams.get("q");
  // テキスト検索はメンバー名でフィルタ（簡易実装）

  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("page_size") || "50");
  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  return successResponse(data, { page, page_size: pageSize });
}

async function createEntry(req: Request, tournamentId: string): Promise<Response> {
  let body: {
    entry_type?: string;
    team_id?: string;
    initial_court_no?: number;
    members?: { management_name: string; grade: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const { entry_type, team_id, initial_court_no, members } = body;

  if (!entry_type || !members || members.length === 0 || initial_court_no === undefined) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "entry_type, initial_court_no, members は必須です。", 400);
  }

  if (entry_type === "singles" && members.length !== 1) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "シングルスのメンバーは1名です。", 400);
  }
  if (entry_type === "doubles" && members.length !== 2) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "ダブルスのメンバーは2名です。", 400);
  }

  const db = getSupabaseClient();

  const { data: tournament } = await db
    .from("tournaments")
    .select("tournament_id")
    .eq("tournament_id", tournamentId)
    .single();

  if (!tournament) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }

  const { data: initialCourt } = await db
    .from("courts")
    .select("court_no, court_type")
    .eq("tournament_id", tournamentId)
    .eq("court_no", initial_court_no)
    .single();

  if (!initialCourt) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "初期コートが見つかりません。", 400);
  }

  if (initialCourt.court_type !== entry_type) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "初期コート番号がエントリー種別と一致していません。", 400);
  }

  for (const member of members) {
    if (!member.management_name || !member.grade) {
      return errorResponse(ErrorCode.VALIDATION_ERROR, "メンバー氏名と学年は必須です。", 400);
    }
  }

  // メンバー作成
  const memberRecords = members.map((m) => ({
    tournament_id: tournamentId,
    management_name: m.management_name,
    grade: m.grade,
  }));

  const { data: createdMembers, error: memberError } = await db
    .from("members")
    .insert(memberRecords)
    .select();

  if (memberError || !createdMembers) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, memberError?.message || "メンバー作成に失敗しました。", 400);
  }

  // エントリー作成
  const { data: entry, error: entryError } = await db
    .from("entries")
    .insert({
      tournament_id: tournamentId,
      entry_type,
      team_id: team_id || null,
      initial_court_no,
    })
    .select()
    .single();

  if (entryError || !entry) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, entryError?.message || "エントリー作成に失敗しました。", 400);
  }

  // entry_members 作成
  const entryMemberRecords = createdMembers.map((m: { member_id: string }, i: number) => ({
    tournament_id: tournamentId,
    entry_id: entry.entry_id,
    member_id: m.member_id,
    member_order: i + 1,
  }));

  const { error: emError } = await db.from("entry_members").insert(entryMemberRecords);
  if (emError) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, emError.message, 400);
  }

  const { data: queueTail } = await db
    .from("queue_items")
    .select("queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", initial_court_no)
    .order("queue_position", { ascending: false })
    .limit(1);

  const nextPosition = queueTail && queueTail.length > 0
    ? queueTail[0].queue_position + 1
    : 1;

  const { error: queueError } = await db.from("queue_items").insert({
    tournament_id: tournamentId,
    court_no: initial_court_no,
    entry_id: entry.entry_id,
    queue_position: nextPosition,
    enqueue_reason: "initial",
  });

  if (queueError) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, queueError.message, 400);
  }

  await db.from("movement_logs").insert({
    tournament_id: tournamentId,
    entry_id: entry.entry_id,
    from_court_no: null,
    to_court_no: initial_court_no,
    movement_reason: "manual",
  });

  const { error: revisionError } = await db.rpc("increment_revision", { p_tournament_id: tournamentId });
  if (revisionError) {
    const { data: t } = await db.from("tournaments").select("revision").eq("tournament_id", tournamentId).single();
    if (t) {
      await db.from("tournaments").update({ revision: t.revision + 1 }).eq("tournament_id", tournamentId);
    }
  }

  // 作成結果を取得して返す
  return await getEntry(tournamentId, entry.entry_id, 201);
}

async function getEntry(tournamentId: string, entryId: string, status = 200): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("entries")
    .select(ENTRY_SELECT)
    .eq("entry_id", entryId)
    .eq("tournament_id", tournamentId)
    .single();

  if (error || !data) {
    return errorResponse(ErrorCode.NOT_FOUND, "エントリーが見つかりません。", 404);
  }

  return successResponse(data, undefined, status);
}

async function updateEntry(req: Request, tournamentId: string, entryId: string, adminId: string): Promise<Response> {
  let body: { version?: number; status?: string; team_id?: string; members?: { management_name: string }[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();

  // 現在のエントリーを取得
  const { data: current, error: fetchError } = await db
    .from("entries")
    .select("*")
    .eq("entry_id", entryId)
    .eq("tournament_id", tournamentId)
    .single();

  if (fetchError || !current) {
    return errorResponse(ErrorCode.NOT_FOUND, "エントリーが見つかりません。", 404);
  }

  // 楽観的ロック
  if (body.version !== undefined && body.version !== current.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "データが更新されています。再読込してください。", 409);
  }

  // 状態変更がある場合はルールチェック
  if (body.status && body.status !== current.status) {
    // 待機列にいるか確認
    const { count: queueCount } = await db
      .from("queue_items")
      .select("*", { count: "exact", head: true })
      .eq("entry_id", entryId)
      .eq("tournament_id", tournamentId);

    // in_progress 試合に含まれるか確認
    const { count: matchCount } = await db
      .from("matches")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .eq("state", "in_progress")
      .or(`entry_a_id.eq.${entryId},entry_b_id.eq.${entryId}`);

    const isInQueue = (queueCount || 0) > 0;
    const isInActiveMatch = (matchCount || 0) > 0;

    const result = validateStatusChange({
      currentStatus: current.status,
      newStatus: body.status as "active" | "paused" | "withdrawn",
      isInQueue,
      isInActiveMatch,
    });

    if (!result.allowed) {
      return errorResponse(result.errorCode!, result.errorMessage!, 409);
    }

    // 待機列から自動除外
    if (result.shouldRemoveFromQueue) {
      // 待機列アイテムを取得（court_no が必要）
      const { data: queueItem } = await db
        .from("queue_items")
        .select("queue_item_id, court_no")
        .eq("entry_id", entryId)
        .eq("tournament_id", tournamentId)
        .single();

      if (queueItem) {
        await db.from("queue_items").delete().eq("queue_item_id", queueItem.queue_item_id);

        // 同コートの残りを再採番
        const { data: remaining } = await db
          .from("queue_items")
          .select("queue_item_id, queue_position")
          .eq("tournament_id", tournamentId)
          .eq("court_no", queueItem.court_no)
          .order("queue_position");

        if (remaining) {
          for (let i = 0; i < remaining.length; i++) {
            await db
              .from("queue_items")
              .update({ queue_position: i + 1 })
              .eq("queue_item_id", remaining[i].queue_item_id);
          }
        }

        // movement_log 記録
        await db.from("movement_logs").insert({
          tournament_id: tournamentId,
          entry_id: entryId,
          from_court_no: queueItem.court_no,
          to_court_no: null,
          movement_reason: "auto_remove_due_to_status",
        });
      }
    }

    // revision 加算（盤面に影響する場合）
    if (result.shouldIncrementRevision) {
      const { error: rpcError } = await db.rpc("increment_revision", { p_tournament_id: tournamentId });
      if (rpcError) {
        const { data: t } = await db.from("tournaments").select("revision").eq("tournament_id", tournamentId).single();
        if (t) {
          await db.from("tournaments").update({ revision: t.revision + 1 }).eq("tournament_id", tournamentId);
        }
      }
    }
  }

  // 更新データ構築
  const updateData: Record<string, unknown> = {};
  if (body.status) updateData.status = body.status;
  if (body.team_id !== undefined) updateData.team_id = body.team_id || null;
  updateData.version = current.version + 1;

  const { error: updateError } = await db
    .from("entries")
    .update(updateData)
    .eq("entry_id", entryId)
    .eq("tournament_id", tournamentId);

  if (updateError) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, updateError.message, 400);
  }

  if (body.status && body.status !== current.status) {
    await writeAuditLog({ tournamentId, adminId, actionType: "entry_status_change", targetType: "entry", targetId: entryId, before: { status: current.status }, after: { status: body.status } });
  }

  return await getEntry(tournamentId, entryId);
}

async function moveEntry(
  req: Request,
  tournamentId: string,
  entryId: string,
  adminId: string,
): Promise<Response> {
  let body: {
    from_court_no?: number;
    source_court_version?: number;
    to_court_no?: number;
    target_court_version?: number;
    insert_position?: number;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const { from_court_no, source_court_version, to_court_no, target_court_version, insert_position } = body;

  if (to_court_no === undefined) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "to_court_no は必須です。", 400);
  }

  const db = getSupabaseClient();

  // 移動先コートの version チェック
  if (target_court_version !== undefined) {
    const { data: targetCourt } = await db
      .from("courts")
      .select("version")
      .eq("tournament_id", tournamentId)
      .eq("court_no", to_court_no)
      .single();

    if (targetCourt && targetCourt.version !== target_court_version) {
      return errorResponse(ErrorCode.VERSION_CONFLICT, "コートデータが更新されています。再読込してください。", 409);
    }
  }

  // 移動元の待機列から除外（from_court_noがある場合）
  if (from_court_no !== undefined) {
    await db
      .from("queue_items")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("entry_id", entryId)
      .eq("court_no", from_court_no);

    // 移動元の残りを再採番
    const { data: srcRemaining } = await db
      .from("queue_items")
      .select("queue_item_id, queue_position")
      .eq("tournament_id", tournamentId)
      .eq("court_no", from_court_no)
      .order("queue_position");

    if (srcRemaining) {
      for (let i = 0; i < srcRemaining.length; i++) {
        await db.from("queue_items").update({ queue_position: i + 1 }).eq("queue_item_id", srcRemaining[i].queue_item_id);
      }
    }
  }

  // 移動先の待機列に挿入
  const { data: destQueue } = await db
    .from("queue_items")
    .select("queue_item_id, queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", to_court_no)
    .order("queue_position");

  const pos = insert_position ?? ((destQueue?.length || 0) + 1);

  // 挿入位置以降をシフト
  if (destQueue) {
    for (let i = destQueue.length - 1; i >= 0; i--) {
      if (destQueue[i].queue_position >= pos) {
        await db.from("queue_items").update({ queue_position: destQueue[i].queue_position + 1 }).eq("queue_item_id", destQueue[i].queue_item_id);
      }
    }
  }

  // 新しいキューアイテムを挿入
  await db.from("queue_items").insert({
    tournament_id: tournamentId,
    court_no: to_court_no,
    entry_id: entryId,
    queue_position: pos,
    enqueue_reason: "manual",
  });

  // movement_log 記録
  await db.from("movement_logs").insert({
    tournament_id: tournamentId,
    entry_id: entryId,
    from_court_no: from_court_no ?? null,
    to_court_no,
    movement_reason: "manual",
  });

  // revision 加算
  const { error: rpcError2 } = await db.rpc("increment_revision", { p_tournament_id: tournamentId });
  if (rpcError2) {
    const { data: t } = await db.from("tournaments").select("revision").eq("tournament_id", tournamentId).single();
    if (t) {
      await db.from("tournaments").update({ revision: t.revision + 1 }).eq("tournament_id", tournamentId);
    }
  }

  await writeAuditLog({ tournamentId, adminId, actionType: "entry_move", targetType: "entry", targetId: entryId, after: { from_court_no: from_court_no ?? null, to_court_no, insert_position: pos } });

  return successResponse({ ok: true });
}
