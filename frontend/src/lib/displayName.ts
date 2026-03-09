type MemberLike = {
  management_name: string
  grade?: string | null
}

type EntryMemberLike = {
  member_order: number
  member: MemberLike
}

type TeamLike = {
  team_name: string
}

type EntryLike = {
  team?: TeamLike | null
  entry_members?: EntryMemberLike[]
}

export function buildDisplayName(entry: EntryLike | null | undefined): string {
  if (!entry) return ''

  const members = (entry.entry_members || [])
    .slice()
    .sort((a, b) => a.member_order - b.member_order)
    .map((em) => em.member.grade ? `${em.member.grade}：${em.member.management_name}` : em.member.management_name)
    .join('・')

  const teamName = entry.team?.team_name
  return teamName ? `${members}（${teamName}）` : members
}
