/**
 * admin-history Edge Function
 * er_api.md §4-8 履歴・監査・エクスポート
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { createSimplePdf } from "../_shared/pdf.ts";

type HistoryMatch = {
  match_id: string;
  court_no: number;
  entry_a_id: string;
  entry_b_id: string;
  entry_a_snapshot: { display_name?: string } | null;
  entry_b_snapshot: { display_name?: string } | null;
  score_a: number | null;
  score_b: number | null;
  outcome_type: string | null;
  state: string;
  winner_entry_id: string | null;
  finished_at: string | null;
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-history\/?/, "/");
  console.log(`[admin-history] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
    const adminOrError = await requireAdmin(req);
    if (adminOrError instanceof Response) return adminOrError;

    const match = path.match(/^\/([0-9a-f-]+)\/?(.*)$/);
    if (!match) {
      return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
    }

    const tournamentId = match[1];
    const subPath = "/" + (match[2] || "");

    if (req.method !== "GET") {
      return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
    }

    if (subPath === "/matches") return await listMatchHistory(tournamentId, url);
    if (subPath === "/movements") return await listMovements(tournamentId, url);
    if (subPath === "/audit-logs") return await listAuditLogs(tournamentId, url);
    if (subPath === "/exports/matches.csv") return await exportMatchesCsv(tournamentId);
    if (subPath === "/exports/movements.csv") return await exportMovementsCsv(tournamentId);
    if (subPath === "/exports/audit-logs.csv") return await exportAuditLogsCsv(tournamentId);
    if (subPath === "/exports/results.pdf") return await exportResultsPdf(tournamentId);

    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-history] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function listMatchHistory(tournamentId: string, url: URL): Promise<Response> {
  const db = getSupabaseClient();
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("page_size") || "50");
  const from = (page - 1) * pageSize;

  let query = db
    .from("matches")
    .select("*", { count: "exact" })
    .eq("tournament_id", tournamentId)
    .in("state", ["finished", "cancelled"])
    .order("finished_at", { ascending: false, nullsFirst: false });

  const courtNoFilter = url.searchParams.get("court_no");
  if (courtNoFilter) query = query.eq("court_no", parseInt(courtNoFilter));

  const fromDate = url.searchParams.get("from");
  if (fromDate) query = query.gte("finished_at", fromDate);

  const toDate = url.searchParams.get("to");
  if (toDate) query = query.lte("finished_at", toDate);

  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  return successResponse(data, { page, page_size: pageSize, total: count || 0 });
}

async function listMovements(tournamentId: string, url: URL): Promise<Response> {
  const db = getSupabaseClient();
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("page_size") || "50");
  const from = (page - 1) * pageSize;

  let query = db
    .from("movement_logs")
    .select("*", { count: "exact" })
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });

  const entryIdFilter = url.searchParams.get("entry_id");
  if (entryIdFilter) query = query.eq("entry_id", entryIdFilter);

  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  return successResponse(data, { page, page_size: pageSize, total: count || 0 });
}

async function listAuditLogs(tournamentId: string, url: URL): Promise<Response> {
  const db = getSupabaseClient();
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("page_size") || "50");
  const from = (page - 1) * pageSize;

  let query = db
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });

  const actionType = url.searchParams.get("action_type");
  if (actionType) query = query.eq("action_type", actionType);

  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  return successResponse(data, { page, page_size: pageSize, total: count || 0 });
}

function csvResponse(filename: string, csvContent: string): Response {
  const bom = "\uFEFF";
  return new Response(bom + csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function pdfResponse(filename: string, pdfBytes: Uint8Array): Response {
  const normalizedBytes = new Uint8Array(pdfBytes.length);
  normalizedBytes.set(pdfBytes);

  return new Response(normalizedBytes.buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function exportMatchesCsv(tournamentId: string): Promise<Response> {
  const data = await fetchFinishedMatches(tournamentId);
  if (data instanceof Response) return data;

  const rows = data.map((m) => [
    m.match_id,
    m.court_no,
    m.entry_a_snapshot?.display_name || m.entry_a_id,
    m.entry_b_snapshot?.display_name || m.entry_b_id,
    m.score_a ?? "",
    m.score_b ?? "",
    m.outcome_type || "",
    m.state,
    m.winner_entry_id || "",
    m.finished_at || "",
  ].join(","));

  const header = "match_id,court_no,entry_a,entry_b,score_a,score_b,outcome_type,state,winner_entry_id,finished_at";
  return csvResponse("matches.csv", [header, ...rows].join("\n"));
}

async function exportMovementsCsv(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("movement_logs")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  const rows = (data || []).map((m: Record<string, unknown>) =>
    [m.movement_log_id, m.entry_id, m.from_court_no ?? "", m.to_court_no ?? "", m.movement_reason, m.match_id || "", m.created_at].join(",")
  );

  const header = "movement_log_id,entry_id,from_court_no,to_court_no,movement_reason,match_id,created_at";
  return csvResponse("movements.csv", [header, ...rows].join("\n"));
}

async function exportAuditLogsCsv(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("audit_logs")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false });

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);

  const rows = (data || []).map((m: Record<string, unknown>) =>
    [m.audit_log_id, m.actor_admin_id, m.action_type, m.target_type, m.target_id, m.created_at].join(",")
  );

  const header = "audit_log_id,actor_admin_id,action_type,target_type,target_id,created_at";
  return csvResponse("audit-logs.csv", [header, ...rows].join("\n"));
}

async function exportResultsPdf(tournamentId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data: tournament } = await db
    .from("tournaments")
    .select("name, public_page_title, state, event_date")
    .eq("tournament_id", tournamentId)
    .single();

  if (!tournament) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }
  if (tournament.state !== "ended") {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "PDF は大会終了後に出力できます。", 409);
  }

  const matches = await fetchFinishedMatches(tournamentId);
  if (matches instanceof Response) return matches;

  const summary = buildEntrySummary(matches);
  const title = tournament.public_page_title || tournament.name;
  const lines: string[] = [
    `大会結果: ${title}`,
    `開催日: ${tournament.event_date}`,
    "",
    "全試合結果",
    "コート | 対戦カード | スコア | 結果種別 | 勝者",
  ];

  for (const match of matches) {
    const entryA = match.entry_a_snapshot?.display_name || match.entry_a_id;
    const entryB = match.entry_b_snapshot?.display_name || match.entry_b_id;
    const winner = match.winner_entry_id === match.entry_a_id
      ? entryA
      : match.winner_entry_id === match.entry_b_id
      ? entryB
      : "-";
    const score = match.score_a === null && match.score_b === null
      ? "-"
      : `${match.score_a ?? "-"}-${match.score_b ?? "-"}`;
    lines.push(
      `${match.court_no.toString().padStart(2, " ")} | ${entryA} vs ${entryB} | ${score} | ${match.outcome_type || "-"} | ${winner}`,
    );
  }

  lines.push("", "エントリー別成績", "エントリー | 試合数 | 勝利 | 敗北 | 打ち切り");
  for (const row of summary) {
    lines.push(
      `${row.displayName} | ${row.played} | ${row.wins} | ${row.losses} | ${row.abandoned}`,
    );
  }

  const pdf = createSimplePdf(lines);
  return pdfResponse("results.pdf", pdf);
}

async function fetchFinishedMatches(tournamentId: string): Promise<HistoryMatch[] | Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("state", "finished")
    .order("court_no")
    .order("finished_at", { ascending: true, nullsFirst: false });

  if (error) return errorResponse(ErrorCode.VALIDATION_ERROR, error.message, 500);
  return (data || []) as HistoryMatch[];
}

function buildEntrySummary(matches: HistoryMatch[]) {
  const summary = new Map<string, { displayName: string; played: number; wins: number; losses: number; abandoned: number }>();

  const ensure = (entryId: string, displayName: string) => {
    if (!summary.has(entryId)) {
      summary.set(entryId, { displayName, played: 0, wins: 0, losses: 0, abandoned: 0 });
    }
    return summary.get(entryId)!;
  };

  for (const match of matches) {
    const a = ensure(match.entry_a_id, match.entry_a_snapshot?.display_name || match.entry_a_id);
    const b = ensure(match.entry_b_id, match.entry_b_snapshot?.display_name || match.entry_b_id);
    a.played += 1;
    b.played += 1;

    if (match.outcome_type === "abandoned") {
      a.abandoned += 1;
      b.abandoned += 1;
      continue;
    }

    if (match.winner_entry_id === match.entry_a_id) {
      a.wins += 1;
      b.losses += 1;
    } else if (match.winner_entry_id === match.entry_b_id) {
      b.wins += 1;
      a.losses += 1;
    }
  }

  return [...summary.values()].sort((a, b) =>
    b.wins - a.wins || a.losses - b.losses || a.displayName.localeCompare(b.displayName)
  );
}
