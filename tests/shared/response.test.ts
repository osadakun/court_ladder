import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  successResponse,
  errorResponse,
  ErrorCode,
} from "../../supabase/functions/_shared/response.ts";

// ============================================================
// §3-4 共通レスポンス形式
// ============================================================

Deno.test("§3-4 正常レスポンス: data + meta を含む JSON", async () => {
  const res = successResponse({ id: "t1" }, { revision: 128 });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data, { id: "t1" });
  assertEquals(body.meta.revision, 128);
  assertEquals(typeof body.meta.server_time, "string");
});

Deno.test("§3-4 正常レスポンス: ステータス201指定", async () => {
  const res = successResponse({ id: "t1" }, { revision: 1 }, 201);
  assertEquals(res.status, 201);
});

Deno.test("§3-4 正常レスポンス: metaなし（revisionなし）", async () => {
  const res = successResponse({ ok: true });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data, { ok: true });
  assertEquals(typeof body.meta.server_time, "string");
  assertEquals(body.meta.revision, undefined);
});

Deno.test("§3-4 正常レスポンス: CORSヘッダーを含む", () => {
  const res = successResponse({ ok: true });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
});

Deno.test("§3-4 異常レスポンス: error オブジェクトを含む", async () => {
  const res = errorResponse("VERSION_CONFLICT", "再読込してください。", 409);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "VERSION_CONFLICT");
  assertEquals(body.error.message, "再読込してください。");
});

Deno.test("§3-4 異常レスポンス: details付き", async () => {
  const res = errorResponse(
    "VERSION_CONFLICT",
    "再読込してください。",
    409,
    { resource: "match", resource_id: "mat_001" },
  );
  const body = await res.json();
  assertEquals(body.error.details, { resource: "match", resource_id: "mat_001" });
});

Deno.test("§3-4 異常レスポンス: CORSヘッダーを含む", () => {
  const res = errorResponse("NOT_FOUND", "見つかりません", 404);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("§3-4 異常レスポンス: デフォルトステータスは400", () => {
  const res = errorResponse("VALIDATION_ERROR", "不正な値です");
  assertEquals(res.status, 400);
});

// ============================================================
// エラーコード定数
// ============================================================
Deno.test("エラーコード: 主要コードが定義されている", () => {
  assertEquals(ErrorCode.VERSION_CONFLICT, "VERSION_CONFLICT");
  assertEquals(ErrorCode.MATCH_ALREADY_FINISHED, "MATCH_ALREADY_FINISHED");
  assertEquals(ErrorCode.TOURNAMENT_NOT_LIVE, "TOURNAMENT_NOT_LIVE");
  assertEquals(ErrorCode.AUTO_ROLLBACK_NOT_ALLOWED, "AUTO_ROLLBACK_NOT_ALLOWED");
  assertEquals(ErrorCode.CURRENT_MATCH_EXISTS, "CURRENT_MATCH_EXISTS");
  assertEquals(ErrorCode.ENTRY_NOT_ACTIVE, "ENTRY_NOT_ACTIVE");
  assertEquals(ErrorCode.ALREADY_IN_QUEUE, "ALREADY_IN_QUEUE");
  assertEquals(ErrorCode.IN_ACTIVE_MATCH, "IN_ACTIVE_MATCH");
  assertEquals(ErrorCode.QUEUE_MISMATCH, "QUEUE_MISMATCH");
  assertEquals(ErrorCode.PREVIEW_EXPIRED, "PREVIEW_EXPIRED");
  assertEquals(ErrorCode.COURT_STOPPED, "COURT_STOPPED");
  assertEquals(ErrorCode.ACTIVE_MATCHES_EXIST, "ACTIVE_MATCHES_EXIST");
});
