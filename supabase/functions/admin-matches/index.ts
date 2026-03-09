/**
 * admin-matches Edge Function
 * er_api.md §4-7
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { writeAuditLog } from "../_shared/audit.ts";
import { canConfirmResult, canRollback, determineLoser } from "../_shared/core/match-lifecycle.ts";
import { validateScore } from "../_shared/core/score-rules.ts";
import { calculateMovements } from "../_shared/core/court-logic.ts";
import { appendToQueueWithTeamAvoidance, canAutoGenerateMatch, pickMatchEntries } from "../_shared/core/queue-manager.ts";
import { createEntrySnapshot } from "../_shared/core/display-name.ts";
import type { CourtInfo, QueueEntry } from "../_shared/core/types.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-matches\/?/, "/");
  console.log(`[admin-matches] ${req.method} ${url.pathname} → ${path}`);

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

  // GET / → 試合一覧
  if (req.method === "GET" && subPath === "/") {
    return await listMatches(tournamentId, url);
  }

  // Match /matches/:matchId/...
  const matchIdMatch = subPath.match(/^\/matches\/([0-9a-f-]+)\/?(.*)$/);
  if (matchIdMatch) {
    const matchId = matchIdMatch[1];
    const actionPath = "/" + (matchIdMatch[2] || "");

    // POST /matches/:matchId/result/preview
    if (req.method === "POST" && actionPath === "/result/preview") {
      return await previewResult(req, tournamentId, matchId);
    }
    // POST /matches/:matchId/result
    if (req.method === "POST" && actionPath === "/result") {
      return await confirmResult(req, tournamentId, matchId, admin.adminId);
    }
    // POST /matches/:matchId/rollback
    if (req.method === "POST" && actionPath === "/rollback") {
      return await rollbackResult(req, tournamentId, matchId, admin.adminId);
    }
  }

  // GET /courts/:courtNo/current-match
  const courtMatch = subPath.match(/^\/courts\/(\d+)\/current-match\/?$/);
  if (req.method === "GET" && courtMatch) {
    return await getCurrentMatch(tournamentId, parseInt(courtMatch[1]));
  }

  return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-matches] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function listMatches(tournamentId: string, url: URL): Promise<Response> {
  const db = getSupabaseClient();
  let query = db
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });

  const stateFilter = url.searchParams.get("state");
  if (stateFilter) query = query.eq("state", stateFilter);

  const courtFilter = url.searchParams.get("court_no");
  if (courtFilter) query = query.eq("court_no", parseInt(courtFilter));

  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("page_size") || "50");
  query = query.range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error } = await query;
  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);
  return successResponse(data);
}

async function getCurrentMatch(tournamentId: string, courtNo: number): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .eq("state", "in_progress")
    .single();

  if (error || !data) {
    return errorResponse(ErrorCode.NOT_FOUND, "現在対戦がありません。", 404);
  }
  return successResponse(data);
}

async function previewResult(
  req: Request,
  tournamentId: string,
  matchId: string,
): Promise<Response> {
  let body: {
    version?: number;
    outcome_type?: string;
    score_a?: number | null;
    score_b?: number | null;
    winner_entry_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();

  // 試合取得
  const { data: match } = await db
    .from("matches")
    .select("*")
    .eq("match_id", matchId)
    .eq("tournament_id", tournamentId)
    .single();

  if (!match) return errorResponse(ErrorCode.NOT_FOUND, "試合が見つかりません。", 404);

  // 大会取得
  const { data: tournament } = await db
    .from("tournaments")
    .select("state, game_point")
    .eq("tournament_id", tournamentId)
    .single();

  if (!tournament) return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);

  // 確定可能チェック
  const confirmCheck = canConfirmResult({ matchState: match.state, tournamentState: tournament.state });
  if (!confirmCheck.allowed) {
    return errorResponse(confirmCheck.errorCode!, "結果確定できません。", 409);
  }

  // コート一覧を取得して移動先を計算
  const { data: courts } = await db
    .from("courts")
    .select("court_no, status, current_match_id, court_type")
    .eq("tournament_id", tournamentId)
    .order("court_no");

  const courtInfos: CourtInfo[] = (courts || []).map((c: { court_no: number; status: string; current_match_id: string | null; court_type: string }) => ({
    courtNo: c.court_no,
    status: c.status as "active" | "stopped",
    currentMatchId: c.current_match_id,
    courtType: c.court_type as "singles" | "doubles",
  }));

  if (body.outcome_type === "abandoned") {
    return successResponse({
      match: { match_id: matchId, court_no: match.court_no },
      movements: [
        {
          entry_id: match.entry_a_id,
          entry_display_name: match.entry_a_snapshot?.display_name,
          from_court_no: match.court_no,
          to_court_no: match.court_no,
          movement_reason: "abandoned_requeue",
        },
        {
          entry_id: match.entry_b_id,
          entry_display_name: match.entry_b_snapshot?.display_name,
          from_court_no: match.court_no,
          to_court_no: match.court_no,
          movement_reason: "abandoned_requeue",
        },
      ],
    });
  }

  const winnerId = body.winner_entry_id!;
  const loserId = determineLoser(winnerId, match.entry_a_id, match.entry_b_id);
  const result = calculateMovements(match.court_no, winnerId, loserId, courtInfos);

  return successResponse({
    match: { match_id: matchId, court_no: match.court_no },
    movements: [
      {
        entry_id: winnerId,
        entry_display_name: winnerId === match.entry_a_id
          ? match.entry_a_snapshot?.display_name
          : match.entry_b_snapshot?.display_name,
        from_court_no: result.winnerMovement.fromCourtNo,
        to_court_no: result.winnerMovement.toCourtNo,
        movement_reason: "win",
      },
      {
        entry_id: loserId,
        entry_display_name: loserId === match.entry_a_id
          ? match.entry_a_snapshot?.display_name
          : match.entry_b_snapshot?.display_name,
        from_court_no: result.loserMovement.fromCourtNo,
        to_court_no: result.loserMovement.toCourtNo,
        movement_reason: "loss",
      },
    ],
  });
}

async function confirmResult(
  req: Request,
  tournamentId: string,
  matchId: string,
  adminId: string,
): Promise<Response> {
  let body: {
    version?: number;
    outcome_type?: string;
    score_a?: number | null;
    score_b?: number | null;
    winner_entry_id?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();

  // 試合取得
  const { data: match } = await db
    .from("matches")
    .select("*")
    .eq("match_id", matchId)
    .eq("tournament_id", tournamentId)
    .single();

  if (!match) return errorResponse(ErrorCode.NOT_FOUND, "試合が見つかりません。", 404);

  // 楽観的ロック
  if (body.version !== undefined && body.version !== match.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "試合データが更新されています。", 409);
  }

  // 大会取得
  const { data: tournament } = await db
    .from("tournaments")
    .select("state, game_point, revision, allow_same_team_match")
    .eq("tournament_id", tournamentId)
    .single();

  if (!tournament) return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);

  // 確定可能チェック
  const confirmCheck = canConfirmResult({ matchState: match.state, tournamentState: tournament.state });
  if (!confirmCheck.allowed) {
    return errorResponse(confirmCheck.errorCode!, "結果確定できません。", 409);
  }

  // スコアバリデーション
  const scoreResult = validateScore({
    outcomeType: body.outcome_type as "normal" | "retired" | "walkover" | "abandoned",
    scoreA: body.score_a ?? null,
    scoreB: body.score_b ?? null,
    winnerEntryId: body.winner_entry_id ?? "",
    entryAId: match.entry_a_id,
    entryBId: match.entry_b_id,
    gamePoint: tournament.game_point,
  });

  if (!scoreResult.valid) {
    return errorResponse(ErrorCode.INVALID_SCORE, scoreResult.errors.join(', '), 422);
  }

  // コート一覧を取得
  const { data: courts } = await db
    .from("courts")
    .select("court_id, court_no, status, current_match_id, version, court_type")
    .eq("tournament_id", tournamentId)
    .order("court_no");

  const courtInfos: CourtInfo[] = (courts || []).map((c: { court_no: number; status: string; current_match_id: string | null; court_type: string }) => ({
    courtNo: c.court_no,
    status: c.status as "active" | "stopped",
    currentMatchId: c.current_match_id,
    courtType: c.court_type as "singles" | "doubles",
  }));

  const isAbandoned = body.outcome_type === "abandoned";
  const winnerId = isAbandoned ? null : body.winner_entry_id!;
  const loserId = isAbandoned ? null : determineLoser(winnerId!, match.entry_a_id, match.entry_b_id);
  const movements = isAbandoned
    ? [
      { entryId: match.entry_a_id, fromCourtNo: match.court_no, toCourtNo: match.court_no, reason: "abandoned_requeue" as const },
      { entryId: match.entry_b_id, fromCourtNo: match.court_no, toCourtNo: match.court_no, reason: "abandoned_requeue" as const },
    ]
    : (() => {
      const moveResult = calculateMovements(match.court_no, winnerId!, loserId!, courtInfos);
      return [
        { entryId: winnerId!, fromCourtNo: moveResult.winnerMovement.fromCourtNo, toCourtNo: moveResult.winnerMovement.toCourtNo, reason: "win" as const },
        { entryId: loserId!, fromCourtNo: moveResult.loserMovement.fromCourtNo, toCourtNo: moveResult.loserMovement.toCourtNo, reason: "loss" as const },
      ];
    })();

  // 試合を finished に更新
  await db
    .from("matches")
    .update({
      state: "finished",
      outcome_type: body.outcome_type,
      score_a: body.score_a,
      score_b: body.score_b,
      winner_entry_id: winnerId,
      loser_entry_id: loserId,
      finished_at: new Date().toISOString(),
      result_confirmed_by: adminId,
      note: body.note || null,
      version: match.version + 1,
    })
    .eq("match_id", matchId);

  // 現在のコートの current_match_id をクリア
  await db
    .from("courts")
    .update({ current_match_id: null })
    .eq("tournament_id", tournamentId)
    .eq("court_no", match.court_no);

  const { data: movingEntries } = await db
    .from("entries")
    .select("entry_id, team_id")
    .eq("tournament_id", tournamentId)
    .in("entry_id", movements.map((mv) => mv.entryId));
  const teamIdByEntry = new Map((movingEntries || []).map((entry: { entry_id: string; team_id: string | null }) => [entry.entry_id, entry.team_id]));

  // 各移動先の待機列に追加
  const affectedCourts = new Set<number>([match.court_no]);
  for (const mv of movements) {
    affectedCourts.add(mv.toCourtNo);

    if (isAbandoned) {
      const { data: destQueue } = await db
        .from("queue_items")
        .select("queue_position")
        .eq("tournament_id", tournamentId)
        .eq("court_no", mv.toCourtNo)
        .order("queue_position", { ascending: false })
        .limit(1);

      const nextPosition = destQueue && destQueue.length > 0 ? destQueue[0].queue_position + 1 : 1;

      await db.from("queue_items").insert({
        tournament_id: tournamentId,
        court_no: mv.toCourtNo,
        entry_id: mv.entryId,
        queue_position: nextPosition,
        enqueue_reason: "result",
        source_match_id: matchId,
      });

      await db.from("movement_logs").insert({
        tournament_id: tournamentId,
        match_id: matchId,
        entry_id: mv.entryId,
        from_court_no: mv.fromCourtNo,
        to_court_no: mv.toCourtNo,
        movement_reason: mv.reason,
      });
      continue;
    }

    const { data: destQueue } = await db
      .from("queue_items")
      .select("queue_item_id, entry_id, queue_position, entry:entries(team_id)")
      .eq("tournament_id", tournamentId)
      .eq("court_no", mv.toCourtNo)
      .order("queue_position");

    const reorderedQueue = appendToQueueWithTeamAvoidance(
      (destQueue || []).map((q: {
        entry_id: string;
        queue_position: number;
        entry: { team_id: string | null } | { team_id: string | null }[] | null;
      }) => {
        const entry = Array.isArray(q.entry) ? q.entry[0] : q.entry;
        return {
          entryId: q.entry_id,
          queuePosition: q.queue_position,
          teamId: entry?.team_id ?? null,
        };
      }),
      mv.entryId,
      teamIdByEntry.get(mv.entryId) ?? null,
      tournament.allow_same_team_match,
    );

    for (const item of reorderedQueue) {
      if (item.entryId === mv.entryId) {
        await db.from("queue_items").insert({
          tournament_id: tournamentId,
          court_no: mv.toCourtNo,
          entry_id: mv.entryId,
          queue_position: item.queuePosition,
          enqueue_reason: "result",
          source_match_id: matchId,
        });
      } else {
        await db
          .from("queue_items")
          .update({ queue_position: item.queuePosition })
          .eq("tournament_id", tournamentId)
          .eq("court_no", mv.toCourtNo)
          .eq("entry_id", item.entryId);
      }
    }

    // movement_log 記録
    await db.from("movement_logs").insert({
      tournament_id: tournamentId,
      match_id: matchId,
      entry_id: mv.entryId,
      from_court_no: mv.fromCourtNo,
      to_court_no: mv.toCourtNo,
      movement_reason: mv.reason,
    });
  }

  // 影響コートで自動試合生成を試みる
  for (const courtNo of affectedCourts) {
    await tryAutoGenerateMatch(db, tournamentId, courtNo, courts || []);
  }

  // revision 加算
  const newRevision = tournament.revision + 1;
  await db
    .from("tournaments")
    .update({ revision: newRevision })
    .eq("tournament_id", tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "match_confirm", targetType: "match", targetId: matchId, before: match, after: { state: "finished", winner_entry_id: winnerId, loser_entry_id: loserId, score_a: body.score_a, score_b: body.score_b } });

  return successResponse({
    match: {
      match_id: matchId,
      court_no: match.court_no,
      state: "finished",
      winner_entry_id: winnerId,
      loser_entry_id: loserId,
    },
    movements: movements.map((m) => ({
      entry_id: m.entryId,
      from_court_no: m.fromCourtNo,
      to_court_no: m.toCourtNo,
      movement_reason: m.reason,
    })),
    affected_courts: [...affectedCourts].sort((a, b) => a - b),
  }, { revision: newRevision });
}

async function rollbackResult(
  req: Request,
  tournamentId: string,
  matchId: string,
  adminId: string,
): Promise<Response> {
  let body: { version?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const db = getSupabaseClient();

  // 試合取得
  const { data: match } = await db
    .from("matches")
    .select("*")
    .eq("match_id", matchId)
    .eq("tournament_id", tournamentId)
    .single();

  if (!match) return errorResponse(ErrorCode.NOT_FOUND, "試合が見つかりません。", 404);

  // 楽観的ロック
  if (body.version !== undefined && body.version !== match.version) {
    return errorResponse(ErrorCode.VERSION_CONFLICT, "試合データが更新されています。", 409);
  }

  // 勝者・敗者が待機列にいるか確認
  const { data: winnerQueue } = await db
    .from("queue_items")
    .select("queue_item_id, court_no")
    .eq("tournament_id", tournamentId)
    .eq("entry_id", match.winner_entry_id);

  const { data: loserQueue } = await db
    .from("queue_items")
    .select("queue_item_id, court_no")
    .eq("tournament_id", tournamentId)
    .eq("entry_id", match.loser_entry_id);

  // 勝者・敗者が別試合に含まれるか確認
  const { count: winnerMatchCount } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress")
    .or(`entry_a_id.eq.${match.winner_entry_id},entry_b_id.eq.${match.winner_entry_id}`);

  const { count: loserMatchCount } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress")
    .or(`entry_a_id.eq.${match.loser_entry_id},entry_b_id.eq.${match.loser_entry_id}`);

  const rollbackCheck = canRollback({
    matchState: match.state,
    winnerInQueue: (winnerQueue?.length || 0) > 0,
    loserInQueue: (loserQueue?.length || 0) > 0,
    winnerInNewMatch: (winnerMatchCount || 0) > 0,
    loserInNewMatch: (loserMatchCount || 0) > 0,
  });

  if (!rollbackCheck.allowed) {
    return errorResponse(
      rollbackCheck.errorCode!,
      "結果取り消しができません。",
      409,
      { match_id: matchId },
    );
  }

  // 勝者・敗者を待機列から除去
  if (winnerQueue && winnerQueue.length > 0) {
    for (const item of winnerQueue) {
      await db.from("queue_items").delete().eq("queue_item_id", item.queue_item_id);
      await resequenceQueue(db, tournamentId, item.court_no);
    }
  }
  if (loserQueue && loserQueue.length > 0) {
    for (const item of loserQueue) {
      await db.from("queue_items").delete().eq("queue_item_id", item.queue_item_id);
      await resequenceQueue(db, tournamentId, item.court_no);
    }
  }

  // 試合を cancelled に更新
  await db
    .from("matches")
    .update({
      state: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "rollback",
      version: match.version + 1,
    })
    .eq("match_id", matchId);

  // 元のコートの current_match_id を設定して in_progress に戻す
  // → 試合を in_progress に戻すのではなく、cancelled にして両者を元コートの待機列に戻す
  const { data: origQueue } = await db
    .from("queue_items")
    .select("queue_item_id, queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", match.court_no)
    .order("queue_position");

  const maxPos = origQueue && origQueue.length > 0
    ? Math.max(...origQueue.map((q: { queue_position: number }) => q.queue_position))
    : 0;

  // entry_a → entry_b の順で元コートの待機列末尾に追加
  await db.from("queue_items").insert({
    tournament_id: tournamentId,
    court_no: match.court_no,
    entry_id: match.entry_a_id,
    queue_position: maxPos + 1,
    enqueue_reason: "rollback",
    source_match_id: matchId,
  });
  await db.from("queue_items").insert({
    tournament_id: tournamentId,
    court_no: match.court_no,
    entry_id: match.entry_b_id,
    queue_position: maxPos + 2,
    enqueue_reason: "rollback",
    source_match_id: matchId,
  });

  // rollback 用の movement_log
  await db.from("movement_logs").insert([
    {
      tournament_id: tournamentId,
      match_id: matchId,
      entry_id: match.entry_a_id,
      from_court_no: null,
      to_court_no: match.court_no,
      movement_reason: "rollback",
    },
    {
      tournament_id: tournamentId,
      match_id: matchId,
      entry_id: match.entry_b_id,
      from_court_no: null,
      to_court_no: match.court_no,
      movement_reason: "rollback",
    },
  ]);

  // 元コートで自動試合生成を試みる
  const { data: courts } = await db
    .from("courts")
    .select("court_id, court_no, status, current_match_id")
    .eq("tournament_id", tournamentId)
    .order("court_no");

  await tryAutoGenerateMatch(db, tournamentId, match.court_no, courts || []);

  // revision 加算
  const { data: tournament } = await db
    .from("tournaments")
    .select("revision")
    .eq("tournament_id", tournamentId)
    .single();

  const newRevision = (tournament?.revision || 0) + 1;
  await db.from("tournaments").update({ revision: newRevision }).eq("tournament_id", tournamentId);

  await writeAuditLog({ tournamentId, adminId, actionType: "match_rollback", targetType: "match", targetId: matchId, before: match, after: { state: "cancelled", cancel_reason: "rollback" } });

  return successResponse({
    match: { match_id: matchId, state: "cancelled", cancel_reason: "rollback" },
    affected_courts: [match.court_no],
  }, { revision: newRevision });
}

// --- ヘルパー関数 ---

async function resequenceQueue(db: ReturnType<typeof getSupabaseClient>, tournamentId: string, courtNo: number) {
  const { data: items } = await db
    .from("queue_items")
    .select("queue_item_id, queue_position")
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .order("queue_position");

  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].queue_position !== i + 1) {
        await db.from("queue_items").update({ queue_position: i + 1 }).eq("queue_item_id", items[i].queue_item_id);
      }
    }
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

  // 現在対戦がある場合は生成しない
  const { count: inProgressCount } = await db
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .eq("state", "in_progress");

  // 待機列サイズ
  const { data: queue } = await db
    .from("queue_items")
    .select("queue_item_id, entry_id, queue_position")
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

  // 先頭2組をピック
  const queueEntries: QueueEntry[] = (queue || []).map((q: { entry_id: string; queue_position: number }) => ({
    entryId: q.entry_id,
    queuePosition: q.queue_position,
  }));
  const { entryA, entryB, remainingQueue } = pickMatchEntries(queueEntries);

  // エントリーのスナップショットを作成
  const snapshotA = await buildEntrySnapshot(db, tournamentId, entryA);
  const snapshotB = await buildEntrySnapshot(db, tournamentId, entryB);

  // 試合を作成
  const { data: newMatch } = await db
    .from("matches")
    .insert({
      tournament_id: tournamentId,
      court_no: courtNo,
      entry_a_id: entryA,
      entry_b_id: entryB,
      entry_a_snapshot: snapshotA,
      entry_b_snapshot: snapshotB,
    })
    .select()
    .single();

  if (newMatch) {
    // コートの current_match_id を更新
    await db
      .from("courts")
      .update({ current_match_id: newMatch.match_id })
      .eq("tournament_id", tournamentId)
      .eq("court_no", courtNo);
  }

  // ピックした2件を待機列から削除
  await db
    .from("queue_items")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("court_no", courtNo)
    .in("entry_id", [entryA, entryB]);

  // 残りを再採番
  await resequenceQueue(db, tournamentId, courtNo);
}

async function buildEntrySnapshot(
  db: ReturnType<typeof getSupabaseClient>,
  tournamentId: string,
  entryId: string,
): Promise<Record<string, unknown> | null> {
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

  const snapshot = createEntrySnapshot(
    entry.entry_type as "singles" | "doubles",
    members,
    teamName,
  );

  return {
    ...snapshot,
    team_color: teamColor,
  };
}
