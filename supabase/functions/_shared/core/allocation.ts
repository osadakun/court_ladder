/**
 * 初期配置アルゴリズム
 * spec.md FR-05
 */

export interface AllocationResult {
  court_no: number;
  entry_id: string;
  queue_position: number;
}

/**
 * エントリーをコートに均等配置する。
 *
 * @param entries 配置対象のエントリー（entry_id を持つ）
 * @param courtCount コート数
 * @param mode 配置モード
 * @returns コート番号・エントリーID・待機順の配列
 */
export function allocateEntries(
  entries: { entry_id: string }[],
  courtCount: number,
  mode: "round_robin" | "random_round_robin",
): AllocationResult[] {
  if (entries.length === 0 || courtCount <= 0) return [];

  let orderedEntries = [...entries];

  if (mode === "random_round_robin") {
    // Fisher-Yates シャッフル
    for (let i = orderedEntries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orderedEntries[i], orderedEntries[j]] = [orderedEntries[j], orderedEntries[i]];
    }
  }

  // 各コートのカウンターを初期化
  const courtPositions = new Map<number, number>();
  for (let c = 1; c <= courtCount; c++) {
    courtPositions.set(c, 0);
  }

  const results: AllocationResult[] = [];

  for (let i = 0; i < orderedEntries.length; i++) {
    const courtNo = (i % courtCount) + 1;
    const pos = courtPositions.get(courtNo)! + 1;
    courtPositions.set(courtNo, pos);

    results.push({
      court_no: courtNo,
      entry_id: orderedEntries[i].entry_id,
      queue_position: pos,
    });
  }

  return results;
}
