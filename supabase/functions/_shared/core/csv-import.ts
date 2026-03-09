/**
 * CSV 一括登録のパース・バリデーション
 * spec.md FR-04 (v2.6: 学年 + 初期コート列追加、category 廃止)
 */

import type { EntryType } from "./types.ts";
import { VALID_GRADES } from "./types.ts";

/** パース結果の1行 */
export interface ParsedRow {
  rowNo: number;
  entryType: string;
  teamName: string;
  member1Name: string;
  member1Grade: string;
  member2Name: string;
  member2Grade: string;
  initialCourtNo: string;
}

/** バリデーション結果の1行 */
export interface ValidatedRow {
  rowNo: number;
  status: "valid" | "invalid";
  errors: string[];
  normalized: {
    entryType: EntryType;
    teamName: string | null;
    members: { managementName: string; grade: string }[];
    initialCourtNo: number;
  } | null;
}

/** コート構成情報 */
export interface CourtConfig {
  singlesCourtCount: number;
  doublesCourtCount: number;
}

/**
 * CSV テキストをパースして行データに変換する。
 * ヘッダー行はスキップ。空行もスキップ。全角スペースはトリム。
 *
 * v2.6 列: 形式,チーム名,メンバー1氏名,メンバー1学年,メンバー2氏名,メンバー2学年,初期コート
 */
export function parseCsvRows(csvText: string): ParsedRow[] {
  if (!csvText.trim()) return [];

  const lines = csvText.split(/\r?\n/);
  if (lines.length <= 1) return [];

  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",").map((c) => c.replace(/[\u3000]/g, " ").trim());

    rows.push({
      rowNo: i + 1,
      entryType: cols[0] || "",
      teamName: cols[1] || "",
      member1Name: cols[2] || "",
      member1Grade: cols[3] || "",
      member2Name: cols[4] || "",
      member2Grade: cols[5] || "",
      initialCourtNo: cols[6] || "",
    });
  }

  return rows;
}

/**
 * パース済み行をバリデーションする。
 * existingTeamNames: 大会に存在するチーム名の配列
 * courtConfig: シングルス/ダブルスのコート数
 */
export function validateImportRows(
  rows: ParsedRow[],
  existingTeamNames: string[],
  courtConfig: CourtConfig,
): ValidatedRow[] {
  const teamSet = new Set(existingTeamNames);
  const validGradeSet = new Set<string>(VALID_GRADES);

  const singlesMin = 1;
  const singlesMax = courtConfig.singlesCourtCount;
  const doublesMin = courtConfig.singlesCourtCount + 1;
  const doublesMax = courtConfig.singlesCourtCount + courtConfig.doublesCourtCount;

  return rows.map((row) => {
    const errors: string[] = [];

    // 形式チェック
    if (row.entryType !== "singles" && row.entryType !== "doubles") {
      errors.push(`形式が不正です: "${row.entryType}"（singles または doubles を指定してください）`);
    }

    // チーム名チェック（空ならチーム無し）
    if (row.teamName && !teamSet.has(row.teamName)) {
      errors.push(`チーム "${row.teamName}" は登録されていません`);
    }

    // メンバー1チェック
    if (!row.member1Name) {
      errors.push("メンバー1氏名は必須です");
    }

    // メンバー1学年チェック
    if (!row.member1Grade) {
      errors.push("メンバー1の学年は必須です");
    } else if (!validGradeSet.has(row.member1Grade)) {
      errors.push(`メンバー1の学年が不正です: "${row.member1Grade}"（${VALID_GRADES.join(" / ")}から選択してください）`);
    }

    // ダブルスのメンバー2チェック
    if (row.entryType === "doubles") {
      if (!row.member2Name) {
        errors.push("ダブルスなのにメンバー2氏名が空です");
      }
      if (!row.member2Grade) {
        errors.push("ダブルスなのにメンバー2の学年が空です");
      } else if (!validGradeSet.has(row.member2Grade)) {
        errors.push(`メンバー2の学年が不正です: "${row.member2Grade}"`);
      }
    }

    // 初期コートチェック
    const courtNo = parseInt(row.initialCourtNo, 10);
    if (!row.initialCourtNo || isNaN(courtNo)) {
      errors.push("初期コート番号は必須です");
    } else if (row.entryType === "singles") {
      if (courtConfig.singlesCourtCount === 0) {
        errors.push("シングルスコートが設定されていません");
      } else if (courtNo < singlesMin || courtNo > singlesMax) {
        errors.push(`シングルスの初期コートは${singlesMin}〜${singlesMax}の範囲で指定してください`);
      }
    } else if (row.entryType === "doubles") {
      if (courtConfig.doublesCourtCount === 0) {
        errors.push("ダブルスコートが設定されていません");
      } else if (courtNo < doublesMin || courtNo > doublesMax) {
        errors.push(`ダブルスの初期コートは${doublesMin}〜${doublesMax}の範囲で指定してください`);
      }
    }

    if (errors.length > 0) {
      return { rowNo: row.rowNo, status: "invalid", errors, normalized: null };
    }

    const members: { managementName: string; grade: string }[] = [
      { managementName: row.member1Name, grade: row.member1Grade },
    ];
    if (row.entryType === "doubles" && row.member2Name) {
      members.push({ managementName: row.member2Name, grade: row.member2Grade });
    }

    return {
      rowNo: row.rowNo,
      status: "valid",
      errors: [],
      normalized: {
        entryType: row.entryType as EntryType,
        teamName: row.teamName || null,
        members,
        initialCourtNo: courtNo,
      },
    };
  });
}
