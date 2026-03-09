/**
 * エントリー状態変更・一意性ルール
 * spec.md §4-7, §4-8
 */

import type { EntryStatus } from "./types.ts";

export interface EntryContext {
  currentStatus: EntryStatus;
  newStatus: EntryStatus;
  isInQueue: boolean;
  isInActiveMatch: boolean;
}

export interface StatusChangeResult {
  allowed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  shouldRemoveFromQueue: boolean;
  shouldIncrementRevision: boolean;
}

/**
 * §4-8 エントリー状態変更の可否判定
 */
export function validateStatusChange(ctx: EntryContext): StatusChangeResult {
  const { currentStatus, newStatus, isInQueue, isInActiveMatch } = ctx;

  // 同一状態 → 何もしない
  if (currentStatus === newStatus) {
    return {
      allowed: true,
      errorCode: null,
      errorMessage: null,
      shouldRemoveFromQueue: false,
      shouldIncrementRevision: false,
    };
  }

  // active → paused/withdrawn
  if (currentStatus === "active" && (newStatus === "paused" || newStatus === "withdrawn")) {
    if (isInActiveMatch) {
      return {
        allowed: false,
        errorCode: "CURRENT_MATCH_EXISTS",
        errorMessage: "対戦中のエントリーの状態は変更できません。先に結果確定または現在対戦の手動解消を行ってください。",
        shouldRemoveFromQueue: false,
        shouldIncrementRevision: false,
      };
    }
    return {
      allowed: true,
      errorCode: null,
      errorMessage: null,
      shouldRemoveFromQueue: isInQueue,
      shouldIncrementRevision: isInQueue,
    };
  }

  // それ以外の遷移（paused→active, withdrawn→active, paused→withdrawn 等）
  return {
    allowed: true,
    errorCode: null,
    errorMessage: null,
    shouldRemoveFromQueue: false,
    shouldIncrementRevision: false,
  };
}

/**
 * §4-7 一意性ルール: 待機列追加可否の判定
 */
export function canAddToQueue(
  entryStatus: EntryStatus,
  isInAnyQueue: boolean,
  isInActiveMatch: boolean,
): { allowed: boolean; errorCode: string | null; errorMessage: string | null } {
  if (entryStatus !== "active") {
    return {
      allowed: false,
      errorCode: "ENTRY_NOT_ACTIVE",
      errorMessage: "有効な状態のエントリーのみ待機列に追加できます。",
    };
  }
  if (isInAnyQueue) {
    return {
      allowed: false,
      errorCode: "ALREADY_IN_QUEUE",
      errorMessage: "既に待機列に存在するエントリーは追加できません。",
    };
  }
  if (isInActiveMatch) {
    return {
      allowed: false,
      errorCode: "IN_ACTIVE_MATCH",
      errorMessage: "対戦中のエントリーは待機列に追加できません。",
    };
  }
  return { allowed: true, errorCode: null, errorMessage: null };
}
