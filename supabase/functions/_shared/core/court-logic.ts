/**
 * コート移動計算ロジック
 * spec.md §4-1〜§4-4
 */

/**
 * §4-1 勝ち上がり負け落ちルール
 * §4-2 境界ルール（v2.6: コート種別境界を含む）
 * §4-3 停止コートスキップルール
 * §4-4 稼働中コートが存在しない場合
 *
 * @param currentCourtNo 試合が行われたコート番号
 * @param isWinner 勝者ならtrue
 * @param courts コート一覧（courtNo昇順）— courtType を持つ場合は種別境界を適用
 * @returns 移動先コート番号
 */
export function calculateDestinationCourt(
  currentCourtNo: number,
  isWinner: boolean,
  courts: { courtNo: number; status: "active" | "stopped"; courtType?: "singles" | "doubles" }[],
): number {
  // v2.6: 同一コート種別の範囲内でのみ移動する
  const currentCourt = courts.find((c) => c.courtNo === currentCourtNo);
  const currentType = currentCourt?.courtType;
  const sameCourts = currentType
    ? courts.filter((c) => c.courtType === currentType)
    : courts;

  // §4-1: 勝者は c-1 方向、敗者は c+1 方向
  const direction = isWinner ? -1 : 1;

  // §4-2: 境界チェック（同種別内）
  const minCourt = Math.min(...sameCourts.map((c) => c.courtNo));
  const maxCourt = Math.max(...sameCourts.map((c) => c.courtNo));

  if (isWinner && currentCourtNo === minCourt) return currentCourtNo;
  if (!isWinner && currentCourtNo === maxCourt) return currentCourtNo;

  // §4-3: 停止コートスキップ — 同種別・同方向で最も近い稼働中コートを探す
  let candidate = currentCourtNo + direction;
  while (candidate >= minCourt && candidate <= maxCourt) {
    const court = sameCourts.find((c) => c.courtNo === candidate);
    if (court && court.status === "active") {
      return candidate;
    }
    candidate += direction;
  }

  // §4-4: 同方向に稼働中コートが存在しない → 現在コートに残留
  return currentCourtNo;
}

/**
 * 結果確定時の勝者・敗者の移動先を一括計算する
 */
export function calculateMovements(
  courtNo: number,
  winnerEntryId: string,
  loserEntryId: string,
  courts: { courtNo: number; status: "active" | "stopped"; courtType?: "singles" | "doubles" }[],
): {
  winnerMovement: { fromCourtNo: number; toCourtNo: number };
  loserMovement: { fromCourtNo: number; toCourtNo: number };
  affectedCourts: number[];
} {
  const winnerTo = calculateDestinationCourt(courtNo, true, courts);
  const loserTo = calculateDestinationCourt(courtNo, false, courts);

  const affected = [...new Set([courtNo, winnerTo, loserTo])].sort(
    (a, b) => a - b,
  );

  return {
    winnerMovement: { fromCourtNo: courtNo, toCourtNo: winnerTo },
    loserMovement: { fromCourtNo: courtNo, toCourtNo: loserTo },
    affectedCourts: affected,
  };
}
