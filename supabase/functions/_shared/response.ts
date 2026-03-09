/**
 * 共通レスポンスヘルパー + エラーコード定数
 * spec.md §3-4, §3-7
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

/**
 * §3-4 正常系レスポンス
 */
export function successResponse(
  data: unknown,
  meta?: { revision?: number; [key: string]: unknown },
  status = 200,
): Response {
  const body = {
    data,
    meta: {
      ...meta,
      server_time: new Date().toISOString(),
    },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * §3-4 異常系レスポンス
 */
export function errorResponse(
  code: string,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
): Response {
  const body: { error: { code: string; message: string; details?: Record<string, unknown> } } = {
    error: { code, message },
  };
  if (details) {
    body.error.details = details;
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * CORS preflight レスポンス
 */
export function handleCors(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * エラーコード定数
 */
export const ErrorCode = {
  VERSION_CONFLICT: "VERSION_CONFLICT",
  MATCH_ALREADY_FINISHED: "MATCH_ALREADY_FINISHED",
  MATCH_NOT_FINISHED: "MATCH_NOT_FINISHED",
  MATCH_NOT_IN_PROGRESS: "MATCH_NOT_IN_PROGRESS",
  MATCH_CANCELLED: "MATCH_CANCELLED",
  TOURNAMENT_NOT_LIVE: "TOURNAMENT_NOT_LIVE",
  AUTO_ROLLBACK_NOT_ALLOWED: "AUTO_ROLLBACK_NOT_ALLOWED",
  CURRENT_MATCH_EXISTS: "CURRENT_MATCH_EXISTS",
  ENTRY_NOT_ACTIVE: "ENTRY_NOT_ACTIVE",
  ALREADY_IN_QUEUE: "ALREADY_IN_QUEUE",
  IN_ACTIVE_MATCH: "IN_ACTIVE_MATCH",
  QUEUE_MISMATCH: "QUEUE_MISMATCH",
  PREVIEW_EXPIRED: "PREVIEW_EXPIRED",
  COURT_STOPPED: "COURT_STOPPED",
  ACTIVE_MATCHES_EXIST: "ACTIVE_MATCHES_EXIST",
  INVALID_SCORE: "INVALID_SCORE",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;
