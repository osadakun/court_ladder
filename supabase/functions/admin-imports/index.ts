/**
 * admin-imports Edge Function
 * er_api.md §4-4 CSV一括登録
 */
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { writeAuditLog } from "../_shared/audit.ts";
import { parseCsvRows, validateImportRows } from "../_shared/core/csv-import.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-imports\/?/, "/");
  console.log(`[admin-imports] ${req.method} ${url.pathname} → ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
    const adminOrError = await requireAdmin(req);
    if (adminOrError instanceof Response) return adminOrError;
    const admin = adminOrError;

    // /{tournamentId}/entries/preview
    // /{tournamentId}/entries/commit
    const match = path.match(/^\/([0-9a-f-]+)\/entries\/(preview|commit)$/);
    if (!match) {
      return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
    }

    const tournamentId = match[1];
    const action = match[2];

    if (req.method !== "POST") {
      return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
    }

    if (action === "preview") {
      return await handlePreview(req, tournamentId, admin.adminId);
    }
    if (action === "commit") {
      return await handleCommit(req, tournamentId, admin.adminId);
    }

    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-imports] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function handlePreview(
  req: Request,
  tournamentId: string,
  adminId: string,
): Promise<Response> {
  // multipart/form-data または text/plain で CSV を受け取る
  let csvText: string;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return errorResponse(ErrorCode.VALIDATION_ERROR, "file フィールドが必要です。", 400);
    }
    csvText = await file.text();
  } else {
    // JSON body with csv_text field
    try {
      const body = await req.json();
      csvText = body.csv_text;
    } catch {
      return errorResponse(ErrorCode.VALIDATION_ERROR, "CSV データが必要です。", 400);
    }
  }

  if (!csvText || !csvText.trim()) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "CSV データが空です。", 400);
  }

  const db = getSupabaseClient();

  // 大会存在確認
  const { data: tournament } = await db
    .from("tournaments")
    .select("tournament_id, singles_court_count, doubles_court_count")
    .eq("tournament_id", tournamentId)
    .single();

  if (!tournament) {
    return errorResponse(ErrorCode.NOT_FOUND, "大会が見つかりません。", 404);
  }

  // 既存チーム名を取得
  const { data: teams } = await db
    .from("teams")
    .select("team_name")
    .eq("tournament_id", tournamentId);

  const existingTeamNames = (teams || []).map((t: { team_name: string }) => t.team_name);

  // パース → バリデーション
  const parsed = parseCsvRows(csvText);
  const validated = validateImportRows(parsed, existingTeamNames, {
    singlesCourtCount: tournament.singles_court_count,
    doublesCourtCount: tournament.doubles_court_count,
  });

  const validCount = validated.filter((r) => r.status === "valid").length;
  const invalidCount = validated.filter((r) => r.status === "invalid").length;

  // preview を DB に保存（TTL 30分）
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: preview, error: insertError } = await db
    .from("import_previews")
    .insert({
      tournament_id: tournamentId,
      created_by_admin_id: adminId,
      source_filename: "upload.csv",
      row_count: parsed.length,
      valid_row_count: validCount,
      invalid_row_count: invalidCount,
      preview_json: validated,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (insertError || !preview) {
    console.error("[admin-imports] preview insert error:", insertError);
    return errorResponse(ErrorCode.VALIDATION_ERROR, insertError?.message || "プレビュー保存に失敗しました。", 500);
  }

  return successResponse({
    import_id: preview.import_preview_id,
    summary: {
      total_rows: parsed.length,
      valid_rows: validCount,
      invalid_rows: invalidCount,
    },
    rows: validated,
  });
}

async function handleCommit(
  req: Request,
  tournamentId: string,
  adminId: string,
): Promise<Response> {
  let body: { import_id?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const { import_id, mode } = body;
  if (!import_id) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "import_id は必須です。", 400);
  }

  const commitMode = mode || "valid_only";
  if (commitMode !== "valid_only" && commitMode !== "all_or_nothing") {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "mode は valid_only または all_or_nothing です。", 400);
  }

  const db = getSupabaseClient();

  // preview を取得
  const { data: preview, error: fetchError } = await db
    .from("import_previews")
    .select("*")
    .eq("import_preview_id", import_id)
    .eq("tournament_id", tournamentId)
    .single();

  if (fetchError || !preview) {
    return errorResponse(ErrorCode.NOT_FOUND, "プレビューが見つかりません。", 404);
  }

  // 期限切れチェック
  if (new Date(preview.expires_at) < new Date()) {
    return errorResponse(ErrorCode.PREVIEW_EXPIRED, "プレビューの有効期限が切れています。再度アップロードしてください。", 409);
  }

  // 消費済みチェック
  if (preview.consumed_at) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "このプレビューは既に取り込み済みです。", 409);
  }

  const rows = preview.preview_json as Array<{
    rowNo: number;
    status: string;
    errors: string[];
    normalized: {
      entryType: string;
      teamName: string | null;
      members: { managementName: string; grade: string }[];
      initialCourtNo: number;
    } | null;
  }>;

  // all_or_nothing モードでエラー行がある場合は拒否
  if (commitMode === "all_or_nothing") {
    const hasInvalid = rows.some((r) => r.status === "invalid");
    if (hasInvalid) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        "all_or_nothing モードですが不正な行があります。valid_only で取り込むか、CSV を修正してください。",
        400,
      );
    }
  }

  // valid 行のみ取り込み
  const validRows = rows.filter((r) => r.status === "valid" && r.normalized);

  // RPC でトランザクション化（members + entries + entry_members をアトミックに）
  const rpcRows = validRows.map((row) => {
    const norm = row.normalized!;
    return {
      entry_type: norm.entryType,
      team_name: norm.teamName || "",
      initial_court_no: norm.initialCourtNo,
      members: norm.members.map((m) => ({
        management_name: m.managementName,
        grade: m.grade,
      })),
    };
  });

  const { data: rpcResult, error: rpcError } = await db.rpc("import_entries_batch", {
    p_tournament_id: tournamentId,
    p_rows: rpcRows,
  });

  if (rpcError) {
    console.error("[admin-imports] import_entries_batch rpc error:", rpcError);
    return errorResponse(ErrorCode.VALIDATION_ERROR, `取込に失敗しました: ${rpcError.message}`, 500);
  }

  const createdCount = (rpcResult as { created_count: number })?.created_count ?? validRows.length;
  const errorCount = 0;

  // consumed_at を記録
  await db
    .from("import_previews")
    .update({ consumed_at: new Date().toISOString() })
    .eq("import_preview_id", import_id);

  // revision 加算
  if (createdCount > 0) {
    const { error: rpcError } = await db.rpc("increment_revision", { p_tournament_id: tournamentId });
    if (rpcError) {
      const { data: t } = await db.from("tournaments").select("revision").eq("tournament_id", tournamentId).single();
      if (t) {
        await db.from("tournaments").update({ revision: t.revision + 1 }).eq("tournament_id", tournamentId);
      }
    }
  }

  if (createdCount > 0) {
    await writeAuditLog({ tournamentId, adminId, actionType: "import_commit", targetType: "tournament", targetId: tournamentId, after: { import_id, created_count: createdCount, error_count: errorCount, mode: commitMode } });
  }

  return successResponse({
    created_count: createdCount,
    error_count: errorCount,
    skipped_count: rows.length - validRows.length,
  });
}
