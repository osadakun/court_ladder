/**
 * JWT 検証 + admin_accounts 照合
 * spec.md §3-2
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { errorResponse, ErrorCode } from "./response.ts";

export interface AdminInfo {
  adminId: string;
  userId: string;
  displayName: string;
}

/**
 * Authorization ヘッダーから Bearer トークンを抽出する
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * リクエストから管理者情報を取得する。
 * 認証失敗時は Response を返す。
 */
export async function requireAdmin(
  req: Request,
): Promise<AdminInfo | Response> {
  const token = extractBearerToken(req);
  if (!token) {
    console.warn(`[auth] no bearer token found`);
    return errorResponse(ErrorCode.UNAUTHORIZED, "認証が必要です。", 401);
  }
  console.log(`[auth] token found (${token.slice(0, 20)}...)`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.error(`[auth] getUser failed:`, authError?.message);
    return errorResponse(ErrorCode.UNAUTHORIZED, "無効なトークンです。", 401);
  }
  console.log(`[auth] user verified: ${user.id}`);

  // admin_accounts テーブルと照合
  const serviceClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: admin, error: adminError } = await serviceClient
    .from("admin_accounts")
    .select("admin_id, display_name")
    .eq("admin_id", user.id)
    .single();

  if (adminError || !admin) {
    console.error(`[auth] admin lookup failed:`, adminError?.message);
    return errorResponse(ErrorCode.FORBIDDEN, "管理者権限がありません。", 403);
  }
  console.log(`[auth] admin OK: ${admin.display_name}`);

  return {
    adminId: admin.admin_id,
    userId: user.id,
    displayName: admin.display_name,
  };
}
