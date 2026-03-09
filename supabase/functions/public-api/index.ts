/**
 * public-api Edge Function
 * er_api.md §4-9
 * 認証不要、public_token による公開画面用API
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { getSupabaseClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/public-api\/?/, "/");
  console.log(`[public-api] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
  // /:publicToken/snapshot
  const snapshotMatch = path.match(/^\/([A-Za-z0-9_-]+)\/snapshot\/?$/);
  if (req.method === "GET" && snapshotMatch) {
    return await getSnapshot(req, snapshotMatch[1]);
  }

  // /:publicToken/courts/:courtNo
  const courtDetailMatch = path.match(/^\/([A-Za-z0-9_-]+)\/courts\/(\d+)\/?$/);
  if (req.method === "GET" && courtDetailMatch) {
    return await getPublicCourtDetail(courtDetailMatch[1], parseInt(courtDetailMatch[2]));
  }

  // /:publicToken/courts
  const courtsMatch = path.match(/^\/([A-Za-z0-9_-]+)\/courts\/?$/);
  if (req.method === "GET" && courtsMatch) {
    return await getPublicCourts(courtsMatch[1]);
  }

  return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[public-api] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function resolveTournament(publicToken: string) {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("tournaments")
    .select("tournament_id, name, public_page_title, state, event_date, public_enabled, public_queue_display_limit, revision, updated_at")
    .eq("public_token", publicToken)
    .single();

  if (error || !data || !data.public_enabled) {
    return null;
  }
  return data;
}

async function getSnapshot(req: Request, publicToken: string): Promise<Response> {
  const tournament = await resolveTournament(publicToken);
  if (!tournament) return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);

  // ETag チェック
  const etag = `W/"rev-${tournament.revision}"`;
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "ETag": etag,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const db = getSupabaseClient();
  const tournamentId = tournament.tournament_id;

  // コート一覧
  const { data: courts } = await db
    .from("courts")
    .select("court_no, status, current_match_id")
    .eq("tournament_id", tournamentId)
    .order("court_no");

  // 現在対戦（スナップショットから表示名を取得）
  const { data: matches } = await db
    .from("matches")
    .select("court_no, entry_a_snapshot, entry_b_snapshot")
    .eq("tournament_id", tournamentId)
    .eq("state", "in_progress");

  const matchByCourt = new Map<number, { entry_a_snapshot: Record<string, unknown>; entry_b_snapshot: Record<string, unknown> }>();
  for (const m of matches || []) {
    matchByCourt.set(m.court_no, m);
  }

  // 待機列（コートごとに limit 分だけ）
  const { data: queueItems } = await db
    .from("queue_items")
    .select("court_no, queue_position, entry:entries(entry_type, team:teams(team_name, color_code), entry_members(member_order, member:members(management_name, grade)))")
    .eq("tournament_id", tournamentId)
    .order("court_no")
    .order("queue_position");

  // 待機列件数（コートごと）
  const queueCountMap = new Map<number, number>();
  for (const q of queueItems || []) {
    queueCountMap.set(q.court_no, (queueCountMap.get(q.court_no) || 0) + 1);
  }

  const displayLimit = tournament.public_queue_display_limit;

  const courtData = (courts || []).map((c: { court_no: number; status: string; current_match_id: string | null }) => {
    const match = matchByCourt.get(c.court_no);
    const queueForCourt = (queueItems || [])
      .filter((q: { court_no: number }) => q.court_no === c.court_no)
      .slice(0, displayLimit);

    const totalQueue = queueCountMap.get(c.court_no) || 0;

    return {
      court_no: c.court_no,
      status: c.status,
      current_match: match
        ? {
            entry_a: formatPublicEntry(match.entry_a_snapshot),
            entry_b: formatPublicEntry(match.entry_b_snapshot),
          }
        : null,
      queue_preview: queueForCourt.map((q) => ({
        position: q.queue_position,
        ...formatPublicEntryFromRelation(Array.isArray(q.entry) ? q.entry[0] : q.entry),
      })),
      queue_count: totalQueue,
      remaining_queue_count: Math.max(0, totalQueue - displayLimit),
    };
  });

  const res = successResponse({
    tournament: {
      name: tournament.name,
      public_page_title: tournament.public_page_title,
      state: tournament.state,
      event_date: tournament.event_date,
      updated_at: tournament.updated_at,
      queue_display_limit: tournament.public_queue_display_limit,
    },
    courts: courtData,
  }, { revision: tournament.revision });

  // キャッシュヘッダー追加
  res.headers.set("ETag", etag);
  res.headers.set("Cache-Control", "public, max-age=1, must-revalidate");

  return res;
}

async function getPublicCourts(publicToken: string): Promise<Response> {
  const tournament = await resolveTournament(publicToken);
  if (!tournament) return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);

  const db = getSupabaseClient();
  const { data: courts } = await db
    .from("courts")
    .select("court_no, status, current_match_id")
    .eq("tournament_id", tournament.tournament_id)
    .order("court_no");

  const { data: matches } = await db
    .from("matches")
    .select("court_no, entry_a_snapshot, entry_b_snapshot")
    .eq("tournament_id", tournament.tournament_id)
    .eq("state", "in_progress");

  const matchByCourt = new Map<number, Record<string, unknown>>();
  for (const m of matches || []) matchByCourt.set(m.court_no, m);

  const courtData = (courts || []).map((c: { court_no: number; status: string }) => {
    const match = matchByCourt.get(c.court_no) as { entry_a_snapshot: Record<string, unknown>; entry_b_snapshot: Record<string, unknown> } | undefined;
    return {
      court_no: c.court_no,
      status: c.status,
      current_match: match
        ? { entry_a: formatPublicEntry(match.entry_a_snapshot), entry_b: formatPublicEntry(match.entry_b_snapshot) }
        : null,
    };
  });

  return successResponse(courtData, { revision: tournament.revision });
}

async function getPublicCourtDetail(publicToken: string, courtNo: number): Promise<Response> {
  const tournament = await resolveTournament(publicToken);
  if (!tournament) return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);

  const db = getSupabaseClient();
  const { data: court } = await db
    .from("courts")
    .select("court_no, status")
    .eq("tournament_id", tournament.tournament_id)
    .eq("court_no", courtNo)
    .single();

  if (!court) return errorResponse(ErrorCode.NOT_FOUND, "コートが見つかりません。", 404);

  const { data: match } = await db
    .from("matches")
    .select("entry_a_snapshot, entry_b_snapshot")
    .eq("tournament_id", tournament.tournament_id)
    .eq("court_no", courtNo)
    .eq("state", "in_progress")
    .maybeSingle();

  const { data: queue } = await db
    .from("queue_items")
    .select("queue_position, entry:entries(entry_type, team:teams(team_name, color_code), entry_members(member_order, member:members(management_name, grade)))")
    .eq("tournament_id", tournament.tournament_id)
    .eq("court_no", courtNo)
    .order("queue_position")
    .limit(tournament.public_queue_display_limit);

  const { count: totalQueue } = await db
    .from("queue_items")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournament.tournament_id)
    .eq("court_no", courtNo);

  return successResponse({
    court_no: court.court_no,
    status: court.status,
    current_match: match
      ? { entry_a: formatPublicEntry(match.entry_a_snapshot), entry_b: formatPublicEntry(match.entry_b_snapshot) }
      : null,
    queue_preview: (queue || []).map((q) => ({
      position: q.queue_position,
      ...formatPublicEntryFromRelation(Array.isArray(q.entry) ? q.entry[0] : q.entry),
    })),
    queue_count: totalQueue || 0,
  }, { revision: tournament.revision });
}

// --- ヘルパー: 内部IDを含まない公開用フォーマット ---

function formatPublicEntry(snapshot: Record<string, unknown> | null): { display_name: string; team_color: string | null; team_name: string | null } | null {
  if (!snapshot) return null;
  return {
    display_name: (snapshot.display_name as string) || "",
    team_color: (snapshot.team_color as string) || null,
    team_name: (snapshot.team_name as string) || null,
  };
}

function formatPublicEntryFromRelation(entry: Record<string, unknown> | null): { display_name: string; team_color: string | null; team_name: string | null } {
  if (!entry) return { display_name: "", team_color: null, team_name: null };

  const members = ((entry.entry_members || []) as { member_order: number; member: { management_name: string; grade?: string | null }[] }[])
    .sort((a, b) => a.member_order - b.member_order)
    .map((em) => {
      const member = em.member[0]
      return member?.grade ? `${member.grade}：${member.management_name}` : member.management_name
    });

  const teamArr = entry.team as { team_name: string; color_code: string }[] | null;
  const teamObj = teamArr && teamArr.length > 0 ? teamArr[0] : null;
  const teamName = teamObj?.team_name || null;
  const teamColor = teamObj?.color_code || null;

  const namesJoined = members.join("・");
  const displayName = teamName ? `${namesJoined}（${teamName}）` : namesJoined;

  return { display_name: displayName, team_color: teamColor, team_name: teamName };
}
