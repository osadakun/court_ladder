import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  generateDisplayName,
  createEntrySnapshot,
} from "../../supabase/functions/_shared/core/display-name.ts";

// ============================================================
// §4-11 表示名自動生成（v2.6: 学年プレフィックス）
// ============================================================
Deno.test("§4-11 v2.6 シングルス + チーム + 学年 → '学年：メンバー名（チーム名）'", () => {
  assertEquals(
    generateDisplayName("singles", [{ managementName: "田中 太郎", grade: "中3" }], "A中学校"),
    "中3：田中 太郎（A中学校）",
  );
});

Deno.test("§4-11 v2.6 シングルス + チームなし + 学年 → '学年：メンバー名'", () => {
  assertEquals(
    generateDisplayName("singles", [{ managementName: "田中 太郎", grade: "小6" }], null),
    "小6：田中 太郎",
  );
});

Deno.test("§4-11 v2.6 ダブルス + チーム + 学年 → '学年1：メンバー1名・学年2：メンバー2名（チーム名）'", () => {
  assertEquals(
    generateDisplayName(
      "doubles",
      [{ managementName: "田中 太郎", grade: "中2" }, { managementName: "鈴木 花子", grade: "中1" }],
      "A中学校",
    ),
    "中2：田中 太郎・中1：鈴木 花子（A中学校）",
  );
});

Deno.test("§4-11 v2.6 ダブルス + チームなし + 学年 → '学年1：メンバー1名・学年2：メンバー2名'", () => {
  assertEquals(
    generateDisplayName(
      "doubles",
      [{ managementName: "田中 太郎", grade: "小5" }, { managementName: "鈴木 花子", grade: "小4" }],
      null,
    ),
    "小5：田中 太郎・小4：鈴木 花子",
  );
});

Deno.test("§4-11 v2.6 学年未指定（gradeなし）の場合は学年プレフィックスなし", () => {
  assertEquals(
    generateDisplayName("singles", [{ managementName: "田中 太郎" }], "A中学校"),
    "田中 太郎（A中学校）",
  );
});

Deno.test("§4-11 v2.6 チーム名が空文字列 → チームなしと同じ扱い", () => {
  assertEquals(
    generateDisplayName("singles", [{ managementName: "田中 太郎", grade: "年長" }], ""),
    "年長：田中 太郎",
  );
});

Deno.test("§4-11 v2.6 ダブルスのメンバー順序が保持される", () => {
  assertEquals(
    generateDisplayName(
      "doubles",
      [{ managementName: "鈴木 花子", grade: "大人" }, { managementName: "田中 太郎", grade: "中3" }],
      "B中学校",
    ),
    "大人：鈴木 花子・中3：田中 太郎（B中学校）",
  );
});

// ============================================================
// createEntrySnapshot（v2.6: 学年含む）
// ============================================================
Deno.test("§4-11 v2.6 snapshot: シングルスのスナップショットに学年が含まれる", () => {
  const snapshot = createEntrySnapshot(
    "singles",
    [{ managementName: "田中 太郎", grade: "中3" }],
    "A中学校",
  );
  assertEquals(snapshot.display_name, "中3：田中 太郎（A中学校）");
  assertEquals(snapshot.entry_type, "singles");
  assertEquals(snapshot.members, [{ management_name: "田中 太郎", grade: "中3" }]);
  assertEquals(snapshot.team_name, "A中学校");
});

Deno.test("§4-11 v2.6 snapshot: ダブルスのスナップショットにメンバー2件と学年含まれる", () => {
  const snapshot = createEntrySnapshot(
    "doubles",
    [{ managementName: "田中 太郎", grade: "中2" }, { managementName: "鈴木 花子", grade: "中1" }],
    "A中学校",
  );
  assertEquals(snapshot.display_name, "中2：田中 太郎・中1：鈴木 花子（A中学校）");
  assertEquals(snapshot.members.length, 2);
  assertEquals(snapshot.members[0].grade, "中2");
  assertEquals(snapshot.members[1].grade, "中1");
});

Deno.test("§4-11 v2.6 snapshot: チームなしでも正しく動作する", () => {
  const snapshot = createEntrySnapshot(
    "singles",
    [{ managementName: "山田 次郎", grade: "小1" }],
    null,
  );
  assertEquals(snapshot.display_name, "小1：山田 次郎");
  assertEquals(snapshot.team_name, null);
});
