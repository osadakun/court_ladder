/**
 * スコアバリデーションロジック
 * spec.md FR-08
 */

import type { OutcomeType } from "./types.ts";

export interface ScoreValidationInput {
  gamePoint: number;
  outcomeType: OutcomeType;
  winnerEntryId: string;
  entryAId: string;
  entryBId: string;
  scoreA: number | null;
  scoreB: number | null;
}

export interface ScoreValidationResult {
  valid: boolean;
  errors: string[];
  normalizedScoreA: number | null;
  normalizedScoreB: number | null;
}

/**
 * FR-08 スコア入力のバリデーション
 *
 * normal: 勝者スコア=gamePoint、敗者スコア=0〜gamePoint-1、両方必須
 * retired/walkover: スコア任意、勝者指定は必須
 */
export function validateScore(input: ScoreValidationInput): ScoreValidationResult {
  const errors: string[] = [];
  const { gamePoint, outcomeType, winnerEntryId, entryAId, entryBId, scoreA, scoreB } = input;

  // abandoned: 勝者不要、スコア任意
  if (outcomeType === "abandoned") {
    return {
      valid: true,
      errors: [],
      normalizedScoreA: scoreA,
      normalizedScoreB: scoreB,
    };
  }

  // 勝者指定は abandoned 以外の全結果種別で必須
  if (!winnerEntryId) {
    errors.push("勝者を指定してください");
  } else if (winnerEntryId !== entryAId && winnerEntryId !== entryBId) {
    errors.push("勝者は対戦中のエントリーから選択してください");
  }

  if (outcomeType === "normal") {
    // 通常終了: スコア必須
    if (scoreA === null || scoreB === null) {
      errors.push("通常終了時はスコアを入力してください");
      return { valid: false, errors, normalizedScoreA: null, normalizedScoreB: null };
    }

    if (errors.length > 0) {
      return { valid: false, errors, normalizedScoreA: null, normalizedScoreB: null };
    }

    const isWinnerA = winnerEntryId === entryAId;
    const winnerScore = isWinnerA ? scoreA : scoreB;
    const loserScore = isWinnerA ? scoreB : scoreA;

    if (winnerScore !== gamePoint) {
      errors.push(`勝者のスコアは${gamePoint}である必要があります`);
    }
    if (loserScore < 0 || loserScore >= gamePoint) {
      errors.push(`敗者のスコアは0〜${gamePoint - 1}の範囲で入力してください`);
    }

    if (errors.length > 0) {
      return { valid: false, errors, normalizedScoreA: null, normalizedScoreB: null };
    }

    return { valid: true, errors: [], normalizedScoreA: scoreA, normalizedScoreB: scoreB };
  }

  // retired / walkover: スコアは任意、勝者指定のみ必須
  if (errors.length > 0) {
    return { valid: false, errors, normalizedScoreA: null, normalizedScoreB: null };
  }

  return {
    valid: true,
    errors: [],
    normalizedScoreA: scoreA,
    normalizedScoreB: scoreB,
  };
}

/**
 * 敗者の取りうる得点リストを返す（UI 選択肢用）
 */
export function getLoserScoreOptions(gamePoint: number): number[] {
  return Array.from({ length: gamePoint }, (_, i) => i);
}
