/**
 * admin-auth Edge Function
 * POST /login, POST /logout, GET /me
 * er_api.md §4-1
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { successResponse, errorResponse, handleCors, ErrorCode } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSupabaseClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/admin-auth\/?/, "/");
  console.log(`[admin-auth] ${req.method} ${url.pathname} → resolved path: ${path}`);

  if (req.method === "OPTIONS") return handleCors();

  try {
    // POST /login
    if (req.method === "POST" && path === "/login") {
      return await handleLogin(req);
    }

    // POST /logout
    if (req.method === "POST" && path === "/logout") {
      return await handleLogout(req);
    }

    // GET /me
    if (req.method === "GET" && path === "/me") {
      return await handleMe(req);
    }

    return errorResponse(ErrorCode.NOT_FOUND, "エンドポイントが見つかりません。", 404);
  } catch (err) {
    console.error(`[admin-auth] unhandled error:`, err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました。", 500);
  }
});

async function handleLogin(req: Request): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "リクエストボディが不正です。", 400);
  }

  const { email, password } = body;
  if (!email || !password) {
    return errorResponse(ErrorCode.VALIDATION_ERROR, "email と password は必須です。", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  console.log(`[admin-auth] login attempt: ${email}`);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`[admin-auth] signIn error:`, error.message);
    return errorResponse(ErrorCode.UNAUTHORIZED, "メールアドレスまたはパスワードが正しくありません。", 401);
  }
  console.log(`[admin-auth] signIn success, user.id: ${data.user.id}`);

  // admin_accounts テーブルと照合
  const serviceClient = getSupabaseClient();
  const { data: admin, error: adminError } = await serviceClient
    .from("admin_accounts")
    .select("admin_id, display_name")
    .eq("admin_id", data.user.id)
    .single();

  if (adminError || !admin) {
    console.error(`[admin-auth] admin lookup failed:`, adminError?.message, admin);
    return errorResponse(ErrorCode.FORBIDDEN, "管理者権限がありません。", 403);
  }
  console.log(`[admin-auth] admin found: ${admin.display_name}`);

  return successResponse({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    admin: {
      admin_id: admin.admin_id,
      display_name: admin.display_name,
    },
  });
}

async function handleLogout(req: Request): Promise<Response> {
  const adminOrError = await requireAdmin(req);
  if (adminOrError instanceof Response) return adminOrError;

  // Supabase Auth のサーバーサイドログアウトは不要（JWT はステートレス）
  // クライアント側でトークンを破棄する
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleMe(req: Request): Promise<Response> {
  const adminOrError = await requireAdmin(req);
  if (adminOrError instanceof Response) return adminOrError;

  return successResponse({
    admin_id: adminOrError.adminId,
    display_name: adminOrError.displayName,
  });
}
