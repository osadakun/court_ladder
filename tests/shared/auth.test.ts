import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractBearerToken } from "../../supabase/functions/_shared/auth.ts";

// ============================================================
// §3-2 Bearer トークン抽出
// ============================================================
Deno.test("§3-2 Bearer トークン抽出: 正常なAuthorizationヘッダー", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer abc123" },
  });
  assertEquals(extractBearerToken(req), "abc123");
});

Deno.test("§3-2 Bearer トークン抽出: ヘッダーなし → null", () => {
  const req = new Request("http://localhost");
  assertEquals(extractBearerToken(req), null);
});

Deno.test("§3-2 Bearer トークン抽出: Bearer以外のスキーム → null", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Basic abc123" },
  });
  assertEquals(extractBearerToken(req), null);
});

Deno.test("§3-2 Bearer トークン抽出: Bearer のみ（トークンなし） → null（末尾スペースはトリムされる）", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer " },
  });
  // HTTPヘッダーは末尾スペースをトリムするため "Bearer" になり、マッチしない
  assertEquals(extractBearerToken(req), null);
});
