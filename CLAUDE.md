# コートラダー 実装ルール

## プロジェクト概要
バドミントンの勝ち上がり負け落ち進行管理Webシステム。
仕様書: `spec.md` v2.5 / `er_api.md` v2.5

## コマンド
- Deno: `$HOME/.deno/bin/deno`
- テスト実行: `$HOME/.deno/bin/deno test tests/core/`
- 単体テスト: `$HOME/.deno/bin/deno test tests/core/<file>.test.ts`

## 技術スタック
- Frontend: React + Vite + TypeScript → GitHub Pages
- Backend: Supabase Edge Functions (Deno/TypeScript)
- DB: Supabase PostgreSQL
- Auth: Supabase Auth (JWT)
- Realtime: Supabase Realtime (Postgres Changes)

## 実装の鉄則

### 1. 仕様が唯一の正（Single Source of Truth）
- `spec.md` と `er_api.md` が全ての判断基準
- 仕様に書いていない振る舞いを勝手に追加しない
- 仕様と実装が矛盾した場合、仕様を確認してから修正する
- 仕様の変更が必要な場合は、先に仕様を更新してから実装する
- エラーを確認して実装を修正した場合、必ずテストも修正すること。この際**絶対に**仕様は変更しないこと

### 2. TDD サイクルを厳守する
1機能ごとに以下のサイクルを回す。**順序を飛ばさない。**

```
1. spec.md の該当節を読む
2. テストケースを書く（この時点では全部 RED）
3. テストが RED であることを確認する
4. core/ のロジックを実装する（GREEN にする）
5. テストが GREEN であることを確認する
6. Edge Function のハンドラを実装する
7. 仕様の記述と実装を突き合わせてレビューする
8. 次の機能へ
```

**絶対にやってはいけないこと:**
- テストと実装を同時に書く
- テストを書く前に実装を書く
- RED を確認せずに GREEN にする

### 3. コアロジックの分離
- 業務ルールは `supabase/functions/_shared/core/` に純粋関数として実装する
- Edge Functions（HTTPハンドラ）はリクエスト受付・レスポンス返却のみ
- コアロジックはDB依存なし、HTTP依存なし → ユニットテスト可能

### 4. テストの書き方
- テストファイルは `tests/core/` に配置する
- Deno テストランナー (`deno test`) を使用する
- テスト名に仕様の節番号を含める（例: `§4-1 勝者はc-1へ移動する`）
- 1つの describe ブロック = 仕様の1つの節

### 5. 実装順序
Phase 1-A（コアロジック + テスト）の実装順序:

```
1. court-logic   (§4-1〜§4-4: 移動先計算)
2. score-rules   (FR-08: スコアバリデーション)
3. display-name  (§4-11: 表示名自動生成)
4. entry-rules   (§4-7, §4-8: 状態変更・一意性ルール)
5. queue-manager (§4-5, §4-6: 待機列操作・現在対戦自動生成)
6. match-lifecycle (FR-09, FR-10: 結果確定・ロールバック)
```

各モジュールは前のモジュールに依存する場合があるため、この順序で進める。

### 6. コミットルール
- 1機能（TDDサイクル1周）ごとにコミットする
- コミットメッセージ: `feat(core): §X-X テスト名 - 内容`
- テストが RED の状態ではコミットしない

### 7. レビューチェックリスト
各機能の実装完了時に確認すること:
- [ ] spec.md の該当節の全条件がテストでカバーされているか
- [ ] テストが全て GREEN か
- [ ] 仕様にない振る舞いを追加していないか
- [ ] エッジケース（境界値、null、空配列）がカバーされているか

### 8. 仕様変更時の横断チェック
v2.6 対応で漏れが出たため、今後は仕様変更時に以下を必ず確認すること。

- 変更した core ロジックが Edge Function から実際に使われているか
- core テストだけでなく、ハンドラ入出力・DB payload・フロント送受信型まで同じ仕様で揃っているか
- 旧カラム名・旧 API パラメータ・旧画面導線が残っていないか
- DB マイグレーションで `NOT NULL`、CHECK、ENUM、既存データ移行まで含めて仕様制約を担保しているか
- 「新機能追加」だけでなく「廃止された機能」を API、画面、テスト、監査対象から除去できているか
- 仕様変更が表示名・スナップショット・CSV・seed・履歴出力に波及しないか
- シングルス/ダブルス、active/paused/withdrawn、normal/abandoned のような分岐がある場合、各分岐が preview / confirm / rollback / UI の全経路で整合しているか
- 最後に `deno test tests/core/` と frontend build を両方通し、片方だけの GREEN で完了扱いにしないこと
