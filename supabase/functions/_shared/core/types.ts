/**
 * コアロジック用のドメイン型定義
 * DB モデルではなく、業務ルール計算に必要な最小限の型
 */

export type CourtStatus = "active" | "stopped";
export type MatchState = "in_progress" | "finished" | "cancelled";
export type CancelReason = "rollback" | "manual_clear";
export type MatchType = "regular" | "request";
export type EntryStatus = "active" | "paused" | "withdrawn";
export type OutcomeType = "normal" | "retired" | "walkover" | "abandoned";
export type MovementReason =
  | "win"
  | "loss"
  | "manual"
  | "rollback"
  | "manual_requeue"
  | "auto_remove_due_to_status"
  | "abandoned_requeue";
export type CourtType = "singles" | "doubles";
export type EnqueueReason =
  | "initial"
  | "result"
  | "manual"
  | "rollback"
  | "manual_requeue";
export type EntryType = "singles" | "doubles";

/** コート状態（移動計算用） */
export interface CourtInfo {
  courtNo: number;
  status: CourtStatus;
  courtType: CourtType;
  currentMatchId: string | null;
}

/** 待機列アイテム */
export interface QueueEntry {
  entryId: string;
  queuePosition: number;
}

/** 試合自動生成時のピック結果 */
export interface PickedMatch {
  entryA: string;
  entryB: string;
  entryAOriginalQueuePosition: number;
  entryBOriginalQueuePosition: number;
  remainingQueue: QueueEntry[];
}

/** 試合情報 */
export interface MatchInfo {
  matchId: string;
  courtNo: number | null;
  entryAId: string;
  entryBId: string;
  state: MatchState;
  cancelReason: CancelReason | null;
  matchType: MatchType;
}

/** 移動計算結果 */
export interface MovementResult {
  entryId: string;
  fromCourtNo: number;
  toCourtNo: number;
  reason: MovementReason;
}

/** 結果確定プレビュー */
export interface ResultPreview {
  winnerMovement: MovementResult;
  loserMovement: MovementResult;
  affectedCourts: number[];
}

export const VALID_GRADES = ["年長", "小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3", "大人"] as const;
export type Grade = typeof VALID_GRADES[number];

/** メンバー情報（表示名生成用） */
export interface MemberInfo {
  managementName: string;
  grade?: string;
}

/** エントリー情報（表示名生成用） */
export interface EntryInfo {
  entryId: string;
  entryType: EntryType;
  members: MemberInfo[];
  teamName: string | null;
}

/** スコア（バリデーション用） */
export interface ScoreInput {
  winnerEntryId: string;
  loserScore: number;
  outcomeType: OutcomeType;
}
