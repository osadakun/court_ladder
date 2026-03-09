import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateDestinationCourt,
  calculateMovements,
} from "../../supabase/functions/_shared/core/court-logic.ts";

/** 10コート全稼働のヘルパー（後方互換: 全 singles 扱い） */
function activeCourts(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    courtNo: i + 1,
    status: "active" as const,
    courtType: "singles" as const,
  }));
}

/** シングルス + ダブルス混合コートのヘルパー */
function mixedCourts(singlesCount: number, doublesCount: number) {
  const courts = [];
  for (let i = 1; i <= singlesCount; i++) {
    courts.push({ courtNo: i, status: "active" as const, courtType: "singles" as const });
  }
  for (let i = singlesCount + 1; i <= singlesCount + doublesCount; i++) {
    courts.push({ courtNo: i, status: "active" as const, courtType: "doubles" as const });
  }
  return courts;
}

/** 指定コートを停止にしたリストを返す */
function withStopped(
  courts: { courtNo: number; status: "active" | "stopped" }[],
  ...stoppedNos: number[]
) {
  return courts.map((c) => ({
    ...c,
    status: stoppedNos.includes(c.courtNo)
      ? ("stopped" as const)
      : c.status,
  }));
}

// ============================================================
// §4-1 勝ち上がり負け落ちルール
// ============================================================
Deno.test("§4-1 勝者は c-1 方向へ移動する", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(3, true, courts), 2);
});

Deno.test("§4-1 敗者は c+1 方向へ移動する", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(3, false, courts), 4);
});

Deno.test("§4-1 コート5の勝者はコート4へ", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(5, true, courts), 4);
});

Deno.test("§4-1 コート5の敗者はコート6へ", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(5, false, courts), 6);
});

// ============================================================
// §4-2 境界ルール
// ============================================================
Deno.test("§4-2 コート1の勝者はコート1に残留する", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(1, true, courts), 1);
});

Deno.test("§4-2 最終コートの敗者は最終コートに残留する", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(10, false, courts), 10);
});

Deno.test("§4-2 コート1の敗者はコート2へ（通常移動）", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(1, false, courts), 2);
});

Deno.test("§4-2 最終コートの勝者はコート9へ（通常移動）", () => {
  const courts = activeCourts(10);
  assertEquals(calculateDestinationCourt(10, true, courts), 9);
});

// ============================================================
// §4-3 停止コートスキップルール
// ============================================================
Deno.test("§4-3 移動先が停止中なら同方向の次の稼働コートへ（勝者）", () => {
  const courts = withStopped(activeCourts(10), 2);
  assertEquals(calculateDestinationCourt(3, true, courts), 1);
});

Deno.test("§4-3 移動先が停止中なら同方向の次の稼働コートへ（敗者）", () => {
  const courts = withStopped(activeCourts(10), 4);
  assertEquals(calculateDestinationCourt(3, false, courts), 5);
});

Deno.test("§4-3 連続する停止コートをスキップする（勝者）", () => {
  const courts = withStopped(activeCourts(10), 4, 3);
  assertEquals(calculateDestinationCourt(5, true, courts), 2);
});

Deno.test("§4-3 連続する停止コートをスキップする（敗者）", () => {
  const courts = withStopped(activeCourts(10), 6, 7);
  assertEquals(calculateDestinationCourt(5, false, courts), 8);
});

// ============================================================
// §4-4 稼働中コートが存在しない場合
// ============================================================
Deno.test("§4-4 同方向に稼働コートがなければ現在コートに残留する（勝者）", () => {
  const courts = withStopped(activeCourts(10), 1, 2);
  assertEquals(calculateDestinationCourt(3, true, courts), 3);
});

Deno.test("§4-4 同方向に稼働コートがなければ現在コートに残留する（敗者）", () => {
  const courts = withStopped(activeCourts(10), 9, 10);
  assertEquals(calculateDestinationCourt(8, false, courts), 8);
});

Deno.test("§4-4 自コート以外全停止で残留する", () => {
  const courts = withStopped(activeCourts(5), 1, 2, 3, 4);
  // コート5のみ稼働、勝者は上方向へ行きたいが全停止
  assertEquals(calculateDestinationCourt(5, true, courts), 5);
});

// ============================================================
// calculateMovements 統合テスト
// ============================================================
Deno.test("calculateMovements 通常ケース: コート5、勝者→4、敗者→6", () => {
  const courts = activeCourts(10);
  const result = calculateMovements(5, "winner", "loser", courts);
  assertEquals(result.winnerMovement, { fromCourtNo: 5, toCourtNo: 4 });
  assertEquals(result.loserMovement, { fromCourtNo: 5, toCourtNo: 6 });
  assertEquals(result.affectedCourts, [4, 5, 6]);
});

Deno.test("calculateMovements 境界残留: コート1、勝者→1残留、敗者→2", () => {
  const courts = activeCourts(10);
  const result = calculateMovements(1, "winner", "loser", courts);
  assertEquals(result.winnerMovement, { fromCourtNo: 1, toCourtNo: 1 });
  assertEquals(result.loserMovement, { fromCourtNo: 1, toCourtNo: 2 });
  assertEquals(result.affectedCourts, [1, 2]);
});

Deno.test("calculateMovements 停止スキップ: コート3、コート2停止、勝者→1、敗者→4", () => {
  const courts = withStopped(activeCourts(10), 2);
  const result = calculateMovements(3, "winner", "loser", courts);
  assertEquals(result.winnerMovement, { fromCourtNo: 3, toCourtNo: 1 });
  assertEquals(result.loserMovement, { fromCourtNo: 3, toCourtNo: 4 });
  assertEquals(result.affectedCourts, [1, 3, 4]);
});

// ============================================================
// §4-1〜§4-2 コート種別境界（v2.6）
// ============================================================
Deno.test("§4-2 v2.6 シングルス最下位コートの敗者はシングルス最下位に残留（ダブルスへ行かない）", () => {
  // シングルス 1-7, ダブルス 8-10
  const courts = mixedCourts(7, 3);
  assertEquals(calculateDestinationCourt(7, false, courts), 7);
});

Deno.test("§4-2 v2.6 ダブルス最上位コートの勝者はダブルス最上位に残留（シングルスへ行かない）", () => {
  const courts = mixedCourts(7, 3);
  assertEquals(calculateDestinationCourt(8, true, courts), 8);
});

Deno.test("§4-1 v2.6 シングルスコート間の通常移動", () => {
  const courts = mixedCourts(7, 3);
  assertEquals(calculateDestinationCourt(3, true, courts), 2);
  assertEquals(calculateDestinationCourt(3, false, courts), 4);
});

Deno.test("§4-1 v2.6 ダブルスコート間の通常移動", () => {
  const courts = mixedCourts(7, 3);
  assertEquals(calculateDestinationCourt(9, true, courts), 8);
  assertEquals(calculateDestinationCourt(9, false, courts), 10);
});

Deno.test("§4-2 v2.6 シングルス最上位（コート1）の勝者は残留", () => {
  const courts = mixedCourts(7, 3);
  assertEquals(calculateDestinationCourt(1, true, courts), 1);
});

Deno.test("§4-2 v2.6 ダブルス最下位（コート10）の敗者は残留", () => {
  const courts = mixedCourts(7, 3);
  assertEquals(calculateDestinationCourt(10, false, courts), 10);
});

Deno.test("§4-3 v2.6 シングルスコート内で停止コートをスキップ", () => {
  const courts = withStopped(mixedCourts(7, 3), 6);
  assertEquals(calculateDestinationCourt(5, false, courts), 7);
});

Deno.test("§4-4 v2.6 ダブルス内で同方向に稼働コートなし → 残留", () => {
  const courts = withStopped(mixedCourts(7, 3), 9, 10);
  assertEquals(calculateDestinationCourt(8, false, courts), 8);
});

Deno.test("§4-1 v2.6 シングルスのみ大会での移動", () => {
  const courts = mixedCourts(5, 0);
  assertEquals(calculateDestinationCourt(3, true, courts), 2);
  assertEquals(calculateDestinationCourt(3, false, courts), 4);
});

Deno.test("§4-1 v2.6 ダブルスのみ大会での移動", () => {
  const courts = mixedCourts(0, 5);
  assertEquals(calculateDestinationCourt(2, true, courts), 1);
  assertEquals(calculateDestinationCourt(2, false, courts), 3);
});
