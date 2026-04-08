import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import type { Match, MovementPreview } from '../../types'
import { hexToRgba } from '../../lib/colors'

interface Props {
  match: Match
  tournamentId: string
  gamePoint: number
  onClose: () => void
  onConfirmed: () => void
}

type Step = 'input' | 'preview'

export function ResultInputDialog({ match, tournamentId, gamePoint, onClose, onConfirmed }: Props) {
  const isRequest = match.match_type === 'request'
  const [step, setStep] = useState<Step>('input')
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [loserScore, setLoserScore] = useState<number | null>(null)
  const [scoreAInput, setScoreAInput] = useState('')
  const [scoreBInput, setScoreBInput] = useState('')
  const [outcomeType, setOutcomeType] = useState<'normal' | 'retired' | 'walkover' | 'abandoned'>('normal')
  const [preview, setPreview] = useState<MovementPreview[]>([])

  const entryA = match.entry_a_snapshot
  const entryB = match.entry_b_snapshot

  // スコア算出
  const scoreA = winnerId === match.entry_a_id ? gamePoint : (loserScore ?? 0)
  const scoreB = winnerId === match.entry_b_id ? gamePoint : (loserScore ?? 0)
  const abandonedScoreA = scoreAInput === '' ? null : Number(scoreAInput)
  const abandonedScoreB = scoreBInput === '' ? null : Number(scoreBInput)

  // 入力完了判定
  const isInputComplete = outcomeType === 'abandoned'
    ? true
    : winnerId !== null && (outcomeType !== 'normal' || loserScore !== null)

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await api<{ movements: MovementPreview[] }>(
        `/api/admin-matches/${tournamentId}/matches/${match.match_id}/result/preview`,
        {
          method: 'POST',
          body: {
            version: match.version,
            outcome_type: outcomeType,
            score_a: outcomeType === 'normal' ? scoreA : outcomeType === 'abandoned' ? abandonedScoreA : null,
            score_b: outcomeType === 'normal' ? scoreB : outcomeType === 'abandoned' ? abandonedScoreB : null,
            winner_entry_id: outcomeType === 'abandoned' ? null : winnerId,
          },
        },
      )
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: (data) => {
      setPreview(data.movements)
      setStep('preview')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await api(
        `/api/admin-matches/${tournamentId}/matches/${match.match_id}/result`,
        {
          method: 'POST',
          body: {
            version: match.version,
            outcome_type: outcomeType,
            score_a: outcomeType === 'normal' ? scoreA : outcomeType === 'abandoned' ? abandonedScoreA : null,
            score_b: outcomeType === 'normal' ? scoreB : outcomeType === 'abandoned' ? abandonedScoreB : null,
            winner_entry_id: outcomeType === 'abandoned' ? null : winnerId,
          },
        },
      )
      if (res.error) throw new Error(res.error.message)
    },
    onSuccess: () => {
      toast.success('結果を確定しました')
      onConfirmed()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // 敗者スコアの選択肢: 0 ~ gamePoint-1
  const loserScoreOptions = Array.from({ length: gamePoint }, (_, i) => i)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b">
          <h2 className="font-bold text-gray-900">
            結果入力{isRequest ? '（リクエスト試合）' : ` - コート ${match.court_no}`}
          </h2>
        </div>

        <div className="p-6 space-y-5">
          {step === 'input' && (
            <>
              {/* 結果種別 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">結果種別</label>
                <div className="flex gap-2">
                  {(['normal', 'retired', 'walkover', 'abandoned'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setOutcomeType(type)}
                      className={`px-3 py-1 text-xs rounded-md border ${outcomeType === type ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-600'}`}
                    >
                      {{ normal: '通常', retired: '棄権', walkover: '不戦', abandoned: '打切' }[type]}
                    </button>
                  ))}
                </div>
              </div>

              {outcomeType === 'abandoned' ? (
                /* 打ち切り: スコア入力（任意） */
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">打ち切り — スコアは任意入力</p>
                  <label className="block text-sm text-gray-700">
                    <span className="mb-1 block">{entryA?.display_name || 'entry_a'} の得点</span>
                    <input
                      type="number"
                      min={0}
                      value={scoreAInput}
                      onChange={(e) => setScoreAInput(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="未入力可"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    <span className="mb-1 block">{entryB?.display_name || 'entry_b'} の得点</span>
                    <input
                      type="number"
                      min={0}
                      value={scoreBInput}
                      onChange={(e) => setScoreBInput(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="未入力可"
                    />
                  </label>
                </div>
              ) : (
                <>
                  {/* 勝者選択 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">勝者</label>
                    <div className="space-y-2">
                      <WinnerButton
                        snapshot={entryA}
                        entryId={match.entry_a_id}
                        selected={winnerId === match.entry_a_id}
                        onClick={() => setWinnerId(match.entry_a_id)}
                      />
                      <WinnerButton
                        snapshot={entryB}
                        entryId={match.entry_b_id}
                        selected={winnerId === match.entry_b_id}
                        onClick={() => setWinnerId(match.entry_b_id)}
                      />
                    </div>
                  </div>

                  {/* 通常時: 敗者スコア選択 */}
                  {outcomeType === 'normal' && winnerId && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        敗者の得点 <span className="text-gray-400">（勝者: {gamePoint}点）</span>
                      </label>
                      <div className="grid grid-cols-7 gap-1.5">
                        {loserScoreOptions.map((score) => (
                          <button
                            key={score}
                            onClick={() => setLoserScore(score)}
                            className={`py-2 text-sm rounded-md border ${loserScore === score ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* アクションボタン */}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
                  キャンセル
                </button>
                {isRequest ? (
                  <button
                    disabled={!isInputComplete || confirmMutation.isPending}
                    onClick={() => confirmMutation.mutate()}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {confirmMutation.isPending ? '確定中...' : '結果を確定（移動なし）'}
                  </button>
                ) : (
                  <button
                    disabled={!isInputComplete || previewMutation.isPending}
                    onClick={() => previewMutation.mutate()}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {previewMutation.isPending ? '計算中...' : 'プレビュー'}
                  </button>
                )}
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              <p className="text-sm text-gray-600">移動先を確認してください</p>
              <div className="bg-gray-50 rounded-md p-3 space-y-2">
                {preview.map((mv, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{mv.entry_display_name || mv.entry_id?.slice(0, 8)}</span>
                    <span className={`font-medium ${mv.movement_reason === 'win' ? 'text-green-600' : mv.movement_reason === 'loss' ? 'text-red-600' : 'text-gray-700'}`}>
                      コート {mv.from_court_no} → {mv.to_court_no}
                      {mv.from_court_no === mv.to_court_no && '（残留）'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  onClick={() => setStep('input')}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  戻る
                </button>
                <button
                  disabled={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  {confirmMutation.isPending ? '確定中...' : '結果を確定'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function WinnerButton({
  snapshot,
  entryId,
  selected,
  onClick,
}: {
  snapshot: { display_name: string; team_color: string | null } | null
  entryId: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-left transition-all ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      }`}
      style={snapshot?.team_color ? { backgroundColor: hexToRgba(snapshot.team_color, selected ? 0.26 : 0.14) ?? undefined } : undefined}
    >
      <span className="font-medium text-gray-800">{snapshot?.display_name || entryId.slice(0, 8)}</span>
      {selected && <span className="ml-auto text-blue-600 text-sm font-medium">勝者</span>}
    </button>
  )
}
