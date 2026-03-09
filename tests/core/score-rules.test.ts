import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateScore,
  getLoserScoreOptions,
} from "../../supabase/functions/_shared/core/score-rules.ts";

// ============================================================
// FR-08 通常終了（normal）
// ============================================================
Deno.test("FR-08 normal: 勝者=entryA, 21-16 → valid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 21,
    scoreB: 16,
  });
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.normalizedScoreA, 21);
  assertEquals(result.normalizedScoreB, 16);
});

Deno.test("FR-08 normal: 勝者=entryB, 16-21 → valid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "entryB",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 16,
    scoreB: 21,
  });
  assertEquals(result.valid, true);
  assertEquals(result.normalizedScoreA, 16);
  assertEquals(result.normalizedScoreB, 21);
});

Deno.test("FR-08 normal: 勝者のスコアがgamePointと不一致 → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 19,
    scoreB: 16,
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.length > 0, true);
});

Deno.test("FR-08 normal: 敗者のスコアがgamePoint以上 → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 21,
    scoreB: 21,
  });
  assertEquals(result.valid, false);
});

Deno.test("FR-08 normal: 敗者のスコアが負数 → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 21,
    scoreB: -1,
  });
  assertEquals(result.valid, false);
});

Deno.test("FR-08 normal: スコア未入力（null） → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: null,
    scoreB: null,
  });
  assertEquals(result.valid, false);
});

Deno.test("FR-08 normal: winnerEntryIdがentryAでもentryBでもない → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "normal",
    winnerEntryId: "unknown",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 21,
    scoreB: 16,
  });
  assertEquals(result.valid, false);
});

Deno.test("FR-08 normal: gamePoint=11, 11-0 → valid", () => {
  const result = validateScore({
    gamePoint: 11,
    outcomeType: "normal",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 11,
    scoreB: 0,
  });
  assertEquals(result.valid, true);
  assertEquals(result.normalizedScoreA, 11);
  assertEquals(result.normalizedScoreB, 0);
});

// ============================================================
// FR-08 途中棄権（retired）
// ============================================================
Deno.test("FR-08 retired: スコアなし、勝者指定 → valid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "retired",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: null,
    scoreB: null,
  });
  assertEquals(result.valid, true);
  assertEquals(result.normalizedScoreA, null);
  assertEquals(result.normalizedScoreB, null);
});

Deno.test("FR-08 retired: スコアあり（途中経過）でもvalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "retired",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 15,
    scoreB: 10,
  });
  assertEquals(result.valid, true);
});

Deno.test("FR-08 retired: 勝者未指定 → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "retired",
    winnerEntryId: "",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: null,
    scoreB: null,
  });
  assertEquals(result.valid, false);
});

// ============================================================
// FR-08 不戦勝（walkover）
// ============================================================
Deno.test("FR-08 walkover: スコアなし、勝者指定 → valid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "walkover",
    winnerEntryId: "entryB",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: null,
    scoreB: null,
  });
  assertEquals(result.valid, true);
});

Deno.test("FR-08 walkover: 勝者未指定 → invalid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "walkover",
    winnerEntryId: "",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: null,
    scoreB: null,
  });
  assertEquals(result.valid, false);
});

// ============================================================
// FR-08 打ち切り（abandoned）v2.6
// ============================================================
Deno.test("FR-08 abandoned: 勝者なし、スコアあり → valid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "abandoned",
    winnerEntryId: "",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 15,
    scoreB: 10,
  });
  assertEquals(result.valid, true);
  assertEquals(result.normalizedScoreA, 15);
  assertEquals(result.normalizedScoreB, 10);
});

Deno.test("FR-08 abandoned: 勝者なし、スコアなし → valid", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "abandoned",
    winnerEntryId: "",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: null,
    scoreB: null,
  });
  assertEquals(result.valid, true);
  assertEquals(result.normalizedScoreA, null);
  assertEquals(result.normalizedScoreB, null);
});

Deno.test("FR-08 abandoned: 勝者指定あり → valid（無視される）", () => {
  const result = validateScore({
    gamePoint: 21,
    outcomeType: "abandoned",
    winnerEntryId: "entryA",
    entryAId: "entryA",
    entryBId: "entryB",
    scoreA: 6,
    scoreB: 4,
  });
  assertEquals(result.valid, true);
});

// ============================================================
// getLoserScoreOptions
// ============================================================
Deno.test("FR-08 getLoserScoreOptions: gamePoint=21 → [0..20]", () => {
  const options = getLoserScoreOptions(21);
  assertEquals(options.length, 21);
  assertEquals(options[0], 0);
  assertEquals(options[20], 20);
});

Deno.test("FR-08 getLoserScoreOptions: gamePoint=11 → [0..10]", () => {
  const options = getLoserScoreOptions(11);
  assertEquals(options.length, 11);
  assertEquals(options[0], 0);
  assertEquals(options[10], 10);
});

Deno.test("FR-08 getLoserScoreOptions: gamePoint=1 → [0]", () => {
  const options = getLoserScoreOptions(1);
  assertEquals(options, [0]);
});
