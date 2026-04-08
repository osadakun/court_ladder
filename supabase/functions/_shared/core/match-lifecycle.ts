/**
 * 結果確定・ロールバックのビジネスルール
 * spec.md FR-09, FR-10
 */

/**
 * FR-09 結果確定の前提条件を判定する
 */
export function canConfirmResult(ctx: {
  matchState: string;
  tournamentState: string;
}): { allowed: boolean; errorCode: string | null } {
  if (ctx.matchState === "finished") {
    return { allowed: false, errorCode: "MATCH_ALREADY_FINISHED" };
  }
  if (ctx.matchState === "cancelled") {
    return { allowed: false, errorCode: "MATCH_CANCELLED" };
  }
  if (ctx.tournamentState !== "live") {
    return { allowed: false, errorCode: "TOURNAMENT_NOT_LIVE" };
  }
  if (ctx.matchState !== "in_progress") {
    return { allowed: false, errorCode: "MATCH_NOT_IN_PROGRESS" };
  }
  return { allowed: true, errorCode: null };
}

/**
 * FR-09 勝者IDから敗者IDを決定する
 */
export function determineLoser(
  winnerId: string,
  entryAId: string,
  entryBId: string,
): string {
  return winnerId === entryAId ? entryBId : entryAId;
}

/**
 * FR-10 ロールバック成立条件を判定する
 */
export function canRollback(ctx: {
  matchState: string;
  matchType: string;
  isLatestFinishedOnCourt: boolean;
  winnerInQueue: boolean;
  loserInQueue: boolean;
  winnerInNewMatch: boolean;
  loserInNewMatch: boolean;
  winnerFinishedNewMatch: boolean;
  loserFinishedNewMatch: boolean;
}): { allowed: boolean; errorCode: string | null } {
  if (ctx.matchState !== "finished") {
    return { allowed: false, errorCode: "MATCH_NOT_FINISHED" };
  }
  if (ctx.matchType !== "regular") {
    return { allowed: false, errorCode: "AUTO_ROLLBACK_NOT_ALLOWED" };
  }
  if (!ctx.isLatestFinishedOnCourt) {
    return { allowed: false, errorCode: "AUTO_ROLLBACK_NOT_ALLOWED" };
  }
  if (ctx.winnerFinishedNewMatch || ctx.loserFinishedNewMatch) {
    return { allowed: false, errorCode: "AUTO_ROLLBACK_NOT_ALLOWED" };
  }
  const winnerReachable = ctx.winnerInQueue || ctx.winnerInNewMatch;
  const loserReachable = ctx.loserInQueue || ctx.loserInNewMatch;
  if (!winnerReachable || !loserReachable) {
    return { allowed: false, errorCode: "AUTO_ROLLBACK_NOT_ALLOWED" };
  }
  return { allowed: true, errorCode: null };
}

/**
 * §4-13 完了済み試合の結果再入力可否を判定する
 */
export function canReenterResult(ctx: {
  matchState: string;
}): { allowed: boolean; errorCode: string | null } {
  if (ctx.matchState !== "finished") {
    return { allowed: false, errorCode: "MATCH_NOT_FINISHED" };
  }
  return { allowed: true, errorCode: null };
}
