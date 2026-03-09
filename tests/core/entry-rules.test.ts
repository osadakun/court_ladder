import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateStatusChange,
  canAddToQueue,
} from "../../supabase/functions/_shared/core/entry-rules.ts";

// ============================================================
// §4-8 エントリー状態変更ルール
// ============================================================

// --- active → paused ---
Deno.test("§4-8 active→paused: 待機列にいる → 許可、自動除外あり、revision加算", () => {
  const result = validateStatusChange({
    currentStatus: "active",
    newStatus: "paused",
    isInQueue: true,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
  assertEquals(result.shouldRemoveFromQueue, true);
  assertEquals(result.shouldIncrementRevision, true);
});

Deno.test("§4-8 active→paused: 待機列にいない → 許可、自動除外なし", () => {
  const result = validateStatusChange({
    currentStatus: "active",
    newStatus: "paused",
    isInQueue: false,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
  assertEquals(result.shouldRemoveFromQueue, false);
});

Deno.test("§4-8 active→paused: in_progress試合中 → 拒否", () => {
  const result = validateStatusChange({
    currentStatus: "active",
    newStatus: "paused",
    isInQueue: false,
    isInActiveMatch: true,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "CURRENT_MATCH_EXISTS");
});

// --- active → withdrawn ---
Deno.test("§4-8 active→withdrawn: 待機列にいる → 許可、自動除外あり、revision加算", () => {
  const result = validateStatusChange({
    currentStatus: "active",
    newStatus: "withdrawn",
    isInQueue: true,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
  assertEquals(result.shouldRemoveFromQueue, true);
  assertEquals(result.shouldIncrementRevision, true);
});

Deno.test("§4-8 active→withdrawn: in_progress試合中 → 拒否", () => {
  const result = validateStatusChange({
    currentStatus: "active",
    newStatus: "withdrawn",
    isInQueue: false,
    isInActiveMatch: true,
  });
  assertEquals(result.allowed, false);
  assertEquals(result.errorCode, "CURRENT_MATCH_EXISTS");
});

// --- paused/withdrawn → active ---
Deno.test("§4-8 paused→active: 許可、自動復帰なし", () => {
  const result = validateStatusChange({
    currentStatus: "paused",
    newStatus: "active",
    isInQueue: false,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
  assertEquals(result.shouldRemoveFromQueue, false);
});

Deno.test("§4-8 withdrawn→active: 許可、自動復帰なし", () => {
  const result = validateStatusChange({
    currentStatus: "withdrawn",
    newStatus: "active",
    isInQueue: false,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
  assertEquals(result.shouldRemoveFromQueue, false);
});

// --- paused → withdrawn ---
Deno.test("§4-8 paused→withdrawn: 許可", () => {
  const result = validateStatusChange({
    currentStatus: "paused",
    newStatus: "withdrawn",
    isInQueue: false,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
});

// --- 同一状態 ---
Deno.test("§4-8 active→active: 許可、副作用なし", () => {
  const result = validateStatusChange({
    currentStatus: "active",
    newStatus: "active",
    isInQueue: true,
    isInActiveMatch: false,
  });
  assertEquals(result.allowed, true);
  assertEquals(result.shouldRemoveFromQueue, false);
  assertEquals(result.shouldIncrementRevision, false);
});

// ============================================================
// §4-7 一意性ルール（待機列追加可否）
// ============================================================
Deno.test("§4-7 active、キューなし、試合なし → 追加可能", () => {
  const result = canAddToQueue("active", false, false);
  assertEquals(result.allowed, true);
});

Deno.test("§4-7 active、既にキューにいる → 追加不可", () => {
  const result = canAddToQueue("active", true, false);
  assertEquals(result.allowed, false);
});

Deno.test("§4-7 active、in_progress試合中 → 追加不可", () => {
  const result = canAddToQueue("active", false, true);
  assertEquals(result.allowed, false);
});

Deno.test("§4-7 paused → 追加不可", () => {
  const result = canAddToQueue("paused", false, false);
  assertEquals(result.allowed, false);
});

Deno.test("§4-7 withdrawn → 追加不可", () => {
  const result = canAddToQueue("withdrawn", false, false);
  assertEquals(result.allowed, false);
});
