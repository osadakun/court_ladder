import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canConfirmResult,
  canReenterResult,
  canRollback,
  determineLoser,
} from "../../supabase/functions/_shared/core/match-lifecycle.ts";

// ============================================================
// FR-09 結果確定の前提条件
// ============================================================
Deno.test("FR-09 確定可否: in_progress, live → 確定可能", () => {
  const result = canConfirmResult({
    matchState: "in_progress",
    tournamentState: "live",
  });
  assertEquals(result.allowed, true);
});

Deno.test("FR-09 確定可否: finished → 二重確定不可", () => {
  const result = canConfirmResult({
    matchState: "finished",
    tournamentState: "live",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "MATCH_ALREADY_FINISHED");
});

Deno.test("FR-09 確定可否: cancelled → 確定不可", () => {
  const result = canConfirmResult({
    matchState: "cancelled",
    tournamentState: "live",
  });
  assertEquals(result.allowed, false);
});

Deno.test("FR-09 確定可否: 大会がpreparing → 確定不可", () => {
  const result = canConfirmResult({
    matchState: "in_progress",
    tournamentState: "preparing",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "TOURNAMENT_NOT_LIVE");
});

Deno.test("FR-09 確定可否: 大会がended → 確定不可", () => {
  const result = canConfirmResult({
    matchState: "in_progress",
    tournamentState: "ended",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "TOURNAMENT_NOT_LIVE");
});

// ============================================================
// FR-09 敗者の決定
// ============================================================
Deno.test("FR-09 敗者決定: winnerがentryA → loserはentryB", () => {
  assertEquals(determineLoser("entryA", "entryA", "entryB"), "entryB");
});

Deno.test("FR-09 敗者決定: winnerがentryB → loserはentryA", () => {
  assertEquals(determineLoser("entryB", "entryA", "entryB"), "entryA");
});

// ============================================================
// FR-10 ロールバック成立条件
// ============================================================
Deno.test("FR-10 ロールバック可否: 全条件満たす → 可能", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: true,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, true);
});

Deno.test("FR-10 ロールバック可否: 試合がfinishedでない → 不可", () => {
  const result = canRollback({
    matchState: "in_progress",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: true,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, false);
});

Deno.test("FR-10 v2.7 ロールバック可否: 勝者がin_progress試合に割り当て済み → 可能", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: false,
    loserInQueue: true,
    winnerInNewMatch: true,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, true);
});

Deno.test("FR-10 v2.7 ロールバック可否: 敗者がin_progress試合に割り当て済み → 可能", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: true,
    loserInQueue: false,
    winnerInNewMatch: false,
    loserInNewMatch: true,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, true);
});

Deno.test("FR-10 ロールバック可否: 勝者が待機列にいない（かつ別試合でもない）→ 不可", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: false,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "AUTO_ROLLBACK_NOT_ALLOWED");
});

Deno.test("FR-10 ロールバック可否: cancelled試合 → 不可", () => {
  const result = canRollback({
    matchState: "cancelled",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: true,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, false);
});

Deno.test("FR-10 v2.7 ロールバック可否: 直前1件でない → 不可", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: false,
    winnerInQueue: true,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "AUTO_ROLLBACK_NOT_ALLOWED");
});

Deno.test("FR-10 v2.7 ロールバック可否: リクエスト試合 → 不可", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "request",
    isLatestFinishedOnCourt: true,
    winnerInQueue: true,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "AUTO_ROLLBACK_NOT_ALLOWED");
});

Deno.test("FR-10 v2.7 ロールバック可否: 勝者がin_progress試合に割り当て中 → 可能", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: false,
    loserInQueue: true,
    winnerInNewMatch: true,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, true);
});

Deno.test("FR-10 v2.7 ロールバック可否: 勝者が移動先で試合完了済み → 不可", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: false,
    loserInQueue: true,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: true,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "AUTO_ROLLBACK_NOT_ALLOWED");
});

Deno.test("FR-10 v2.7 ロールバック可否: 敗者が移動先で試合完了済み → 不可", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: true,
    loserInQueue: false,
    winnerInNewMatch: false,
    loserInNewMatch: false,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: true,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "AUTO_ROLLBACK_NOT_ALLOWED");
});

Deno.test("FR-10 v2.7 ロールバック可否: 両者ともin_progress試合中 → 可能", () => {
  const result = canRollback({
    matchState: "finished",
    matchType: "regular",
    isLatestFinishedOnCourt: true,
    winnerInQueue: false,
    loserInQueue: false,
    winnerInNewMatch: true,
    loserInNewMatch: true,
    winnerFinishedNewMatch: false,
    loserFinishedNewMatch: false,
  });
  assertEquals(result.allowed, true);
});

// ============================================================
// §4-13 完了済み試合の結果再入力
// ============================================================
Deno.test("§4-13 結果再入力可否: finished → 可能", () => {
  const result = canReenterResult({ matchState: "finished" });
  assertEquals(result.allowed, true);
});

Deno.test("§4-13 結果再入力可否: in_progress → 不可", () => {
  const result = canReenterResult({ matchState: "in_progress" });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "MATCH_NOT_FINISHED");
});

Deno.test("§4-13 結果再入力可否: cancelled → 不可", () => {
  const result = canReenterResult({ matchState: "cancelled" });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "MATCH_NOT_FINISHED");
});
