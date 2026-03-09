/**
 * 表示名自動生成ロジック
 * spec.md §4-11 (v2.6: 学年プレフィックス)
 */

import type { EntryType, MemberInfo } from "./types.ts";

/**
 * メンバー1名分の表示文字列を生成する
 * grade がある場合: "学年：名前"
 * grade がない場合: "名前"
 */
function formatMemberName(m: MemberInfo): string {
  if (m.grade) {
    return `${m.grade}：${m.managementName}`;
  }
  return m.managementName;
}

/**
 * §4-11 表示名自動生成
 *
 * v2.6:
 * シングルス: "学年：メンバー名（チーム名）"
 * ダブルス: "学年1：メンバー1名・学年2：メンバー2名（チーム名）"
 * チーム未所属（null または空文字列）: チーム名を省略
 */
export function generateDisplayName(
  entryType: EntryType,
  members: MemberInfo[],
  teamName: string | null,
): string {
  const names = entryType === "singles"
    ? formatMemberName(members[0])
    : members.map(formatMemberName).join("・");

  if (teamName && teamName.length > 0) {
    return `${names}（${teamName}）`;
  }
  return names;
}

/**
 * 試合作成時のエントリースナップショットを生成する
 * matches.entry_a_snapshot / entry_b_snapshot に保存するJSONB
 */
export function createEntrySnapshot(
  entryType: EntryType,
  members: MemberInfo[],
  teamName: string | null,
): {
  display_name: string;
  entry_type: EntryType;
  members: { management_name: string; grade?: string }[];
  team_name: string | null;
} {
  return {
    display_name: generateDisplayName(entryType, members, teamName),
    entry_type: entryType,
    members: members.map((m) => {
      const result: { management_name: string; grade?: string } = {
        management_name: m.managementName,
      };
      if (m.grade) {
        result.grade = m.grade;
      }
      return result;
    }),
    team_name: teamName && teamName.length > 0 ? teamName : null,
  };
}
