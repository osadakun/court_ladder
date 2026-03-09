/**
 * 待機列操作・現在対戦自動生成ロジック
 * spec.md §4-5, §4-6
 */

import type { QueueEntry, CourtStatus } from "./types.ts";

/**
 * §4-5-2 待機列末尾にエントリーを追加する
 */
export function appendToQueueTail(
  queue: QueueEntry[],
  entryId: string,
): QueueEntry[] {
  const maxPos = queue.length > 0
    ? Math.max(...queue.map((q) => q.queuePosition))
    : 0;
  return [...queue, { entryId, queuePosition: maxPos + 1 }];
}

/**
 * §4-6-2 同一チーム対戦回避ロジック付きの待機列追加 (v2.6)
 *
 * allow_same_team_match=true の場合: 常に末尾追加
 * allow_same_team_match=false の場合:
 *   - 追加エントリーのチームが先頭エントリーと同一の場合、同一チーム連続区間の直前に挿入
 *   - 全エントリーが同一チームの場合は末尾追加（回避不可能）
 *   - チーム未所属(null)の場合は末尾追加
 */
export function appendToQueueWithTeamAvoidance(
  queue: { entryId: string; queuePosition: number; teamId: string | null }[],
  entryId: string,
  teamId: string | null,
  allowSameTeamMatch: boolean,
): QueueEntry[] {
  // 空の待機列 or allow=true or チーム未所属 → 末尾追加
  if (queue.length === 0 || allowSameTeamMatch || !teamId) {
    return appendToQueueTail(
      queue.map((q) => ({ entryId: q.entryId, queuePosition: q.queuePosition })),
      entryId,
    );
  }

  const sorted = [...queue].sort((a, b) => a.queuePosition - b.queuePosition);

  // 先頭と同一チームかチェック
  if (sorted[0].teamId !== teamId) {
    // 別チーム → 末尾追加
    return appendToQueueTail(
      sorted.map((q) => ({ entryId: q.entryId, queuePosition: q.queuePosition })),
      entryId,
    );
  }

  // 先頭から連続する同一チーム区間を計算
  let sameTeamCount = 0;
  for (const q of sorted) {
    if (q.teamId === teamId) {
      sameTeamCount++;
    } else {
      break;
    }
  }

  // 全エントリーが同一チーム → 回避不可能、末尾追加
  if (sameTeamCount === sorted.length) {
    return appendToQueueTail(
      sorted.map((q) => ({ entryId: q.entryId, queuePosition: q.queuePosition })),
      entryId,
    );
  }

  // 同一チーム連続区間の直前に挿入
  const result: QueueEntry[] = [];
  result.push({ entryId, queuePosition: 1 });
  for (let i = 0; i < sorted.length; i++) {
    result.push({ entryId: sorted[i].entryId, queuePosition: i + 2 });
  }
  return result;
}

/**
 * §4-5-3 管理者指定の順序で全件再採番する
 */
export function reorderQueue(entryIds: string[]): QueueEntry[] {
  return entryIds.map((entryId, i) => ({
    entryId,
    queuePosition: i + 1,
  }));
}

/**
 * §4-5-4 現在対戦手動解消時に entry_a → entry_b の順で末尾へ戻す
 */
export function requeueEntries(
  queue: QueueEntry[],
  entryAId: string,
  entryBId: string,
): QueueEntry[] {
  let result = appendToQueueTail(queue, entryAId);
  result = appendToQueueTail(result, entryBId);
  return result;
}

/**
 * 待機列からエントリーを除外し、残りを再採番する
 */
export function removeFromQueue(
  queue: QueueEntry[],
  entryId: string,
): QueueEntry[] {
  const filtered = queue.filter((q) => q.entryId !== entryId);
  return filtered.map((q, i) => ({ entryId: q.entryId, queuePosition: i + 1 }));
}

/**
 * §4-6 現在対戦の自動生成条件を判定する
 */
export function canAutoGenerateMatch(ctx: {
  tournamentState: string;
  courtStatus: CourtStatus;
  hasInProgressMatch: boolean;
  queueSize: number;
}): boolean {
  return (
    ctx.tournamentState === "live" &&
    ctx.courtStatus === "active" &&
    !ctx.hasInProgressMatch &&
    ctx.queueSize >= 2
  );
}

/**
 * §4-6 待機列の先頭2組をピックし、残りの待機列を返す
 * queue は queuePosition 順にソートされている前提ではなく、内部でソートする
 */
export function pickMatchEntries(queue: QueueEntry[]): {
  entryA: string;
  entryB: string;
  remainingQueue: QueueEntry[];
} {
  const sorted = [...queue].sort((a, b) => a.queuePosition - b.queuePosition);
  const entryA = sorted[0].entryId;
  const entryB = sorted[1].entryId;
  const remaining = sorted.slice(2).map((q, i) => ({
    entryId: q.entryId,
    queuePosition: i + 1,
  }));
  return { entryA, entryB, remainingQueue: remaining };
}
