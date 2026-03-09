• Findings

  1. allocationApply が非トランザクションで既存待機列を先に全削除しており、挿入失敗時に大会の初期配置が全消失します。admin-courts/index.ts:507 admin-courts/index.ts:519
     queue_items を全削除したあとで新規挿入しているため、途中失敗時の復旧手段がありません。少なくとも一括適用は DB トランザクション化が必要です。
  2. ロールバック UI は現状成功しません。DashboardPage.tsx:60 DashboardPage.tsx:62 CourtCard.tsx:90 admin-matches/index.ts:39 admin-matches/index.ts:53 admin-matches/index.ts:439
     フロントは /api/admin-matches/${tid}/${matchId}/rollback を叩いていますが、バックエンドは /matches/:matchId/rollback しか受けません。さらにボタン表示条件が currentMatch.state ===
     'in_progress' で、バックエンド側のロールバック条件 finished と矛盾しています。
  3. 履歴画面の CSV ダウンロードは、現在の Bearer トークン認証方式では 401 になります。HistoryPage.tsx:71 HistoryPage.tsx:76 admin-history/index.ts:17
     window.open() では Authorization ヘッダを付けられませんが、admin-history は毎回 requireAdmin() を通しています。今の実装だとブラウザからの CSV エクスポートは通らないはずです。
  4. audit_logs は参照・CSV出力だけ実装されていて、書き込みがありません。admin-history/index.ts:114 admin-history/index.ts:197
     リポジトリ全体を見ても audit_logs への insert が無く、履歴画面の監査ログタブとその CSV は常に空になります。FR-15 と 7-3.監査ログ対象 は未達です。
  5. CSV 取込 commit も非トランザクションで、失敗時に孤児データを残します。admin-imports/index.ts:232 admin-imports/index.ts:253 admin-imports/index.ts:277
     members 作成後に entries が失敗した場合はメンバーだけ残り、entries 作成後に entry_members が失敗した場合はメンバーとエントリーが半端に残ります。再実行で重複も起こりえます。

  Assumptions / Questions

  - CSV エクスポートについて、リバースプロキシ側で Authorization を注入する設計ではなく、現行のフロント実装だけで完結させる前提でレビューしています。
  - allocationApply と CSV import commit は、Supabase RPC か SQL 関数でトランザクション化する方が安全です。