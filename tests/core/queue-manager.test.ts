import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  appendToQueueTail,
  appendToQueueWithTeamAvoidance,
  reorderQueue,
  requeueEntries,
  removeFromQueue,
  canAutoGenerateMatch,
  pickMatchEntries,
} from "../../supabase/functions/_shared/core/queue-manager.ts";

import type { QueueEntry } from "../../supabase/functions/_shared/core/types.ts";

/** 待機列エントリーにチーム情報を付与するヘルパー */
interface QueueEntryWithTeam extends QueueEntry {
  teamId: string | null;
}

// ============================================================
// §4-5 待機列の順序
// ============================================================

// --- 末尾追加（結果確定時の移動） ---
Deno.test("§4-5 末尾追加: 空の待機列に追加 → position=1", () => {
  const queue: QueueEntry[] = [];
  const result = appendToQueueTail(queue, "entry1");
  assertEquals(result, [{ entryId: "entry1", queuePosition: 1 }]);
});

Deno.test("§4-5 末尾追加: 既存3件の末尾に追加 → position=4", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e2", queuePosition: 2 },
    { entryId: "e3", queuePosition: 3 },
  ];
  const result = appendToQueueTail(queue, "e4");
  assertEquals(result.length, 4);
  assertEquals(result[3], { entryId: "e4", queuePosition: 4 });
});

Deno.test("§4-5 末尾追加: 既存のエントリーの順序は変わらない", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e2", queuePosition: 2 },
  ];
  const result = appendToQueueTail(queue, "e3");
  assertEquals(result[0], { entryId: "e1", queuePosition: 1 });
  assertEquals(result[1], { entryId: "e2", queuePosition: 2 });
});

// --- 全件再採番（手動並び替え） ---
Deno.test("§4-5 再採番: 指定順序で1から振り直す", () => {
  const result = reorderQueue(["e3", "e1", "e2"]);
  assertEquals(result, [
    { entryId: "e3", queuePosition: 1 },
    { entryId: "e1", queuePosition: 2 },
    { entryId: "e2", queuePosition: 3 },
  ]);
});

Deno.test("§4-5 再採番: 空配列 → 空配列", () => {
  assertEquals(reorderQueue([]), []);
});

// --- 手動解消時の末尾戻し ---
Deno.test("§4-5 手動解消: entry_a→entry_bの順で末尾に追加", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e2", queuePosition: 2 },
  ];
  const result = requeueEntries(queue, "entryA", "entryB");
  assertEquals(result.length, 4);
  assertEquals(result[2], { entryId: "entryA", queuePosition: 3 });
  assertEquals(result[3], { entryId: "entryB", queuePosition: 4 });
});

Deno.test("§4-5 手動解消: 空の待機列に戻す → position 1, 2", () => {
  const result = requeueEntries([], "entryA", "entryB");
  assertEquals(result, [
    { entryId: "entryA", queuePosition: 1 },
    { entryId: "entryB", queuePosition: 2 },
  ]);
});

// --- 待機列からの除外 ---
Deno.test("§4-5 除外: 指定エントリーを除外して再採番", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e2", queuePosition: 2 },
    { entryId: "e3", queuePosition: 3 },
  ];
  const result = removeFromQueue(queue, "e2");
  assertEquals(result, [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e3", queuePosition: 2 },
  ]);
});

Deno.test("§4-5 除外: 存在しないエントリーを指定 → 変化なし", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
  ];
  const result = removeFromQueue(queue, "unknown");
  assertEquals(result, [{ entryId: "e1", queuePosition: 1 }]);
});

// ============================================================
// §4-6 現在対戦の自動生成
// ============================================================
Deno.test("§4-6 自動生成条件: live, active, 試合なし, 2組以上 → 可能", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "live",
      courtStatus: "active",
      hasInProgressMatch: false,
      queueSize: 2,
    }),
    true,
  );
});

Deno.test("§4-6 自動生成条件: preparing → 不可", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "preparing",
      courtStatus: "active",
      hasInProgressMatch: false,
      queueSize: 2,
    }),
    false,
  );
});

Deno.test("§4-6 自動生成条件: ended → 不可", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "ended",
      courtStatus: "active",
      hasInProgressMatch: false,
      queueSize: 2,
    }),
    false,
  );
});

Deno.test("§4-6 自動生成条件: コート停止中 → 不可", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "live",
      courtStatus: "stopped",
      hasInProgressMatch: false,
      queueSize: 2,
    }),
    false,
  );
});

Deno.test("§4-6 自動生成条件: in_progress試合あり → 不可", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "live",
      courtStatus: "active",
      hasInProgressMatch: true,
      queueSize: 3,
    }),
    false,
  );
});

Deno.test("§4-6 自動生成条件: 待機列1組のみ → 不可", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "live",
      courtStatus: "active",
      hasInProgressMatch: false,
      queueSize: 1,
    }),
    false,
  );
});

Deno.test("§4-6 自動生成条件: 待機列0組 → 不可", () => {
  assertEquals(
    canAutoGenerateMatch({
      tournamentState: "live",
      courtStatus: "active",
      hasInProgressMatch: false,
      queueSize: 0,
    }),
    false,
  );
});

// --- 先頭2組のピック ---
Deno.test("§4-6 ピック: 先頭2組を取り出し、残りの待機列を返す", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e2", queuePosition: 2 },
    { entryId: "e3", queuePosition: 3 },
    { entryId: "e4", queuePosition: 4 },
  ];
  const result = pickMatchEntries(queue);
  assertEquals(result.entryA, "e1");
  assertEquals(result.entryB, "e2");
  assertEquals(result.remainingQueue, [
    { entryId: "e3", queuePosition: 1 },
    { entryId: "e4", queuePosition: 2 },
  ]);
});

Deno.test("§4-6 ピック: ちょうど2組 → 残りは空", () => {
  const queue: QueueEntry[] = [
    { entryId: "e1", queuePosition: 1 },
    { entryId: "e2", queuePosition: 2 },
  ];
  const result = pickMatchEntries(queue);
  assertEquals(result.entryA, "e1");
  assertEquals(result.entryB, "e2");
  assertEquals(result.remainingQueue, []);
});

Deno.test("§4-6 ピック: position順にソートされた先頭2組を取る", () => {
  // position が連番でない場合
  const queue: QueueEntry[] = [
    { entryId: "e5", queuePosition: 10 },
    { entryId: "e3", queuePosition: 5 },
    { entryId: "e1", queuePosition: 1 },
  ];
  const result = pickMatchEntries(queue);
  assertEquals(result.entryA, "e1");
  assertEquals(result.entryB, "e3");
  assertEquals(result.remainingQueue, [
    { entryId: "e5", queuePosition: 1 },
  ]);
});

// ============================================================
// §4-6-2 同一チーム対戦回避（v2.6）
// ============================================================
Deno.test("§4-6-2 allow_same_team_match=true → 常に末尾追加", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
    { entryId: "e2", queuePosition: 2, teamId: "teamA" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e3", "teamA", true);
  assertEquals(result.length, 3);
  assertEquals(result[2].entryId, "e3");
  assertEquals(result[2].queuePosition, 3);
});

Deno.test("§4-6-2 allow_same_team_match=false 先頭と同一チーム → 先頭の前に挿入", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
    { entryId: "e2", queuePosition: 2, teamId: "teamB" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e3", "teamA", false);
  assertEquals(result.length, 3);
  // e3 が先頭に来る（e1の前）
  assertEquals(result[0].entryId, "e3");
  assertEquals(result[0].queuePosition, 1);
  assertEquals(result[1].entryId, "e1");
  assertEquals(result[1].queuePosition, 2);
  assertEquals(result[2].entryId, "e2");
  assertEquals(result[2].queuePosition, 3);
});

Deno.test("§4-6-2 allow_same_team_match=false 先頭と別チーム → 末尾追加", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
    { entryId: "e2", queuePosition: 2, teamId: "teamB" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e3", "teamB", false);
  assertEquals(result.length, 3);
  assertEquals(result[2].entryId, "e3");
  assertEquals(result[2].queuePosition, 3);
});

Deno.test("§4-6-2 allow_same_team_match=false 先頭から連続する同一チーム区間の直前に挿入", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
    { entryId: "e2", queuePosition: 2, teamId: "teamA" },
    { entryId: "e3", queuePosition: 3, teamId: "teamB" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e4", "teamA", false);
  assertEquals(result.length, 4);
  // e4 が先頭に（連続するteamA区間の直前）
  assertEquals(result[0].entryId, "e4");
  assertEquals(result[1].entryId, "e1");
  assertEquals(result[2].entryId, "e2");
  assertEquals(result[3].entryId, "e3");
});

Deno.test("§4-6-2 allow_same_team_match=false 全エントリーが同一チーム → 末尾追加（回避不可能）", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
    { entryId: "e2", queuePosition: 2, teamId: "teamA" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e3", "teamA", false);
  assertEquals(result.length, 3);
  assertEquals(result[2].entryId, "e3");
  assertEquals(result[2].queuePosition, 3);
});

Deno.test("§4-6-2 allow_same_team_match=false チーム未所属(null) → 末尾追加", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
    { entryId: "e2", queuePosition: 2, teamId: "teamB" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e3", null, false);
  assertEquals(result.length, 3);
  assertEquals(result[2].entryId, "e3");
});

Deno.test("§4-6-2 allow_same_team_match=false 空の待機列 → そのまま追加", () => {
  const queue: QueueEntryWithTeam[] = [];
  const result = appendToQueueWithTeamAvoidance(queue, "e1", "teamA", false);
  assertEquals(result.length, 1);
  assertEquals(result[0].entryId, "e1");
  assertEquals(result[0].queuePosition, 1);
});

Deno.test("§4-6-2 allow_same_team_match=false 待機列1件で同チーム → 末尾追加（回避不可能）", () => {
  const queue: QueueEntryWithTeam[] = [
    { entryId: "e1", queuePosition: 1, teamId: "teamA" },
  ];
  const result = appendToQueueWithTeamAvoidance(queue, "e2", "teamA", false);
  assertEquals(result.length, 2);
  assertEquals(result[1].entryId, "e2");
});
