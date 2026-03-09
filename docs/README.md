# コートラダー (Court Ladder) 開発ガイド

バドミントンの勝ち上がり/負け落ちコート進行管理Webシステム。

![ダッシュボード](screenshots/01_dashboard.png)

---

## 目次

- [技術スタック](#技術スタック)
- [ディレクトリ構成](#ディレクトリ構成)
- [環境構築](#環境構築)
- [起動方法](#起動方法)
- [よく使う Docker / Supabase コマンド](#よく使う-docker--supabase-コマンド)
- [テスト](#テスト)
- [画面一覧](#画面一覧)
- [API エンドポイント](#api-エンドポイント)
- [シードデータ](#シードデータ)
- [開発フロー](#開発フロー)

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | React 19 + Vite 7 + TypeScript 5.9 |
| UI | Tailwind CSS 4 + Lucide React (アイコン) + Sonner (トースト) |
| データ取得 | TanStack React Query |
| ルーティング | React Router v7 |
| Backend | Supabase Edge Functions (Deno runtime) |
| DB | PostgreSQL 17 (Supabase) |
| 認証 | Supabase Auth (JWT) |
| リアルタイム | Supabase Realtime (WebSocket + Postgres Changes) |

---

## ディレクトリ構成

```
court_ladder/
├── frontend/                  # React フロントエンド
│   ├── src/
│   │   ├── pages/             # 画面コンポーネント (10ファイル)
│   │   ├── components/        # 共通コンポーネント
│   │   │   ├── court/         #   CourtCard.tsx
│   │   │   ├── match/         #   ResultInputDialog.tsx
│   │   │   └── layout/        #   AdminLayout.tsx
│   │   ├── lib/               # ユーティリティ (api, supabase, displayName, colors)
│   │   ├── hooks/             # useAuth, useRealtime
│   │   ├── contexts/          # AuthContext
│   │   └── types/             # TypeScript 型定義
│   ├── .env.local             # ローカル環境変数
│   └── package.json
│
├── supabase/                  # Supabase バックエンド
│   ├── functions/             # Edge Functions (9個)
│   │   ├── admin-auth/        #   認証
│   │   ├── admin-tournaments/ #   大会 CRUD + ダッシュボード
│   │   ├── admin-entries/     #   エントリー管理
│   │   ├── admin-teams/       #   チーム管理
│   │   ├── admin-matches/     #   試合結果入力
│   │   ├── admin-courts/      #   コート操作
│   │   ├── admin-history/     #   履歴・監査ログ
│   │   ├── admin-imports/     #   CSV 一括登録
│   │   ├── public-api/        #   公開ボード API
│   │   └── _shared/           # 共有コード
│   │       ├── core/          #   ビジネスロジック (純粋関数)
│   │       ├── auth.ts        #   認証ヘルパー
│   │       ├── db.ts          #   DB接続
│   │       └── response.ts    #   レスポンスフォーマット
│   ├── migrations/            # DBマイグレーション
│   └── config.toml            # Supabase 設定
│
├── tests/core/                # Deno テスト (9ファイル)
├── spec.md                    # 仕様書 (v2.6)
├── er_api.md                  # ER図 + API仕様
├── ddl.sql                    # DBスキーマ定義
├── seed_test.sql              # テストデータ (エントリー)
├── seed_queue.sql             # テストデータ (待機列 + 初期試合)
└── seed_tournament.sql        # テストデータ (大会 + 管理者)
```

---

## 環境構築

### 前提条件

- **Docker Desktop** がインストール済みであること
- **Node.js** 18+ (npm 含む)
- **Deno** (`$HOME/.deno/bin/deno`)
- **Supabase CLI** (`npx supabase` で利用可能)

### 初回セットアップ

```bash
# 1. リポジトリをクローン
git clone <repo-url> court_ladder
cd court_ladder

# 2. Supabase ローカル環境を起動（Docker コンテナが自動作成される）
npx supabase start

# 3. フロントエンド依存関係をインストール
cd frontend
npm install

# 4. テストデータを投入（任意）
cd ..
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_tournament.sql
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_test.sql
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_queue.sql
```

### 環境変数

フロントエンド (`frontend/.env.local`):
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...（supabase start で出力される）
VITE_API_BASE_URL=http://127.0.0.1:54321/functions/v1
```

Supabase (`supabase/.env.local`):
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...（supabase start で出力される）
```

---

## 起動方法

### 1. Supabase バックエンド起動

```bash
npx supabase start
```

起動完了すると以下のサービスが利用可能:

| サービス | URL | 用途 |
|---------|-----|------|
| API Gateway (Kong) | `http://127.0.0.1:54321` | Edge Functions + REST API |
| PostgreSQL | `127.0.0.1:54322` | データベース直接接続 |
| Supabase Studio | `http://127.0.0.1:54323` | DB管理GUI |
| Inbucket (メール) | `http://127.0.0.1:54324` | メールテスト |

### 2. フロントエンド起動

```bash
cd frontend

# 開発サーバー（HMR付き）
npm run dev

# または、ビルド済みファイルをプレビュー
npm run build && npx vite preview --port 4174
```

| モード | URL | 特徴 |
|-------|-----|------|
| dev | `http://localhost:5173` | HMR (Hot Module Replacement) 付き |
| preview | `http://localhost:4174` | ビルド済み静的ファイル配信 |

### 3. ログイン

テストデータ投入済みの場合:
- メール: `admin@example.com`
- パスワード: `password123`

---

## よく使う Docker / Supabase コマンド

### Supabase ライフサイクル

```bash
# Supabase 起動（全コンテナ起動）
npx supabase start

# Supabase 停止（コンテナ停止、データ保持）
npx supabase stop

# Supabase 完全リセット（データ消去 + マイグレーション再実行）
npx supabase db reset

# Supabase ステータス確認（URL, キー情報の表示）
npx supabase status
```

### Docker コンテナ操作

```bash
# Supabase 関連コンテナ一覧
docker ps --filter "name=supabase"

# 特定コンテナのログ確認
docker logs supabase_db_court_ladder           # DB
docker logs supabase_edge_runtime_court_ladder  # Edge Functions
docker logs supabase_kong_court_ladder          # API Gateway

# Edge Functions のログをリアルタイム追跡
docker logs -f supabase_edge_runtime_court_ladder

# コンテナ再起動（Edge Functions 反映など）
docker restart supabase_edge_runtime_court_ladder
```

### データベース操作

```bash
# psql で DB に接続（インタラクティブ）
docker exec -it supabase_db_court_ladder psql -U postgres -d postgres

# SQL ファイルを実行
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_test.sql

# ワンライナーで SQL を実行
docker exec supabase_db_court_ladder psql -U postgres -d postgres -c "SELECT count(*) FROM entries;"

# テーブル一覧
docker exec supabase_db_court_ladder psql -U postgres -d postgres -c "\dt public.*"

# 特定テーブルの構造確認
docker exec supabase_db_court_ladder psql -U postgres -d postgres -c "\d entries"
```

### マイグレーション

```bash
# 新しいマイグレーション作成
npx supabase migration new <名前>

# マイグレーション適用（リセット経由）
npx supabase db reset

# 現在のスキーマとの差分確認
npx supabase db diff
```

### Edge Functions

```bash
# 新しい Edge Function 作成
npx supabase functions new <function-name>

# Edge Functions を手動再デプロイ（ローカル）
docker restart supabase_edge_runtime_court_ladder

# Edge Function を直接呼び出し（curl）
curl -X GET http://127.0.0.1:54321/functions/v1/admin-tournaments \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### テストデータ投入（一括）

```bash
# 大会 + 管理者 → エントリー → 待機列 + 初期試合
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_tournament.sql && \
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_test.sql && \
docker exec -i supabase_db_court_ladder psql -U postgres -d postgres < seed_queue.sql
```

### トラブルシューティング

```bash
# コンテナが起動しない場合
docker compose -f supabase/.temp/docker-compose.yml down
npx supabase start

# DB の接続テスト
docker exec supabase_db_court_ladder psql -U postgres -d postgres -c "SELECT 1;"

# Edge Functions が反映されない場合
docker restart supabase_edge_runtime_court_ladder

# ポートが使用中の場合
lsof -i :54321  # API
lsof -i :54322  # DB
lsof -i :5173   # Vite dev
```

---

## テスト

```bash
# 全テスト実行
$HOME/.deno/bin/deno test tests/core/

# 個別テスト
$HOME/.deno/bin/deno test tests/core/court-logic.test.ts
$HOME/.deno/bin/deno test tests/core/queue-manager.test.ts
$HOME/.deno/bin/deno test tests/core/score-rules.test.ts

# フロントエンドビルドチェック
cd frontend && npm run build
```

テストファイル一覧:

| ファイル | テスト内容 |
|---------|----------|
| `court-logic.test.ts` | コート移動ロジック (勝ち上がり/負け落ち) |
| `queue-manager.test.ts` | 待機列操作 |
| `score-rules.test.ts` | スコアバリデーション |
| `display-name.test.ts` | 表示名生成 |
| `entry-rules.test.ts` | エントリー状態遷移ルール |
| `match-lifecycle.test.ts` | 試合結果確定・ロールバック |
| `csv-import.test.ts` | CSV インポートバリデーション |
| `allocation.test.ts` | コート割り当て |
| `audit-coverage.test.ts` | 監査ログカバレッジ |

---

## 画面一覧

### 大会一覧

管理者がログイン後に表示される画面。大会の作成・選択が可能。

![大会一覧](screenshots/06_tournament_list.png)

---

### ダッシュボード

大会の進行管理画面。全コートの現在対戦と待機列をリアルタイム表示。

- コート 1-7: シングルス（1人 vs 1人）
- コート 8-10: ダブルス（2人 vs 2人）
- 表示名形式: `学年：名前（チーム名）`
- チームカラー背景で視覚的にチームを識別

![ダッシュボード](screenshots/01_dashboard.png)

---

### 結果入力ダイアログ

各コートの「結果入力」ボタンから開く。2ステップ構成:
1. **入力画面**: 結果種別（通常/棄権/不戦/打切）選択 → 勝者選択 → 敗者スコア入力
2. **プレビュー画面**: 移動先確認 → 確定

![結果入力](screenshots/08_result_input.png)

---

### エントリー管理

全エントリーをチーム別にグループ表示。シングルス→ダブルスの順、五十音ソート。

- エントリー追加（手動 / CSV一括取込）
- 状態管理（有効 / 休止 / 棄権）

![エントリー管理](screenshots/02_entries.png)

---

### チーム管理

チームの追加・編集・削除。チームカラーの設定。

![チーム管理](screenshots/03_teams.png)

---

### 履歴

3つのタブで構成:
- **試合履歴**: 完了した試合一覧（勝者左/敗者右、チームカラー背景、◯×マーク）
- **移動履歴**: エントリーのコート間移動記録
- **監査ログ**: 管理者の操作記録

CSV/PDF エクスポート機能付き。

![履歴](screenshots/04_history.png)

---

### 大会設定

大会の基本設定、対戦設定（同一チーム対戦許可トグル）、公開設定を管理。

![設定](screenshots/05_settings.png)

---

## API エンドポイント

ベースURL: `http://127.0.0.1:54321/functions/v1`

| Function | 主なメソッド | 用途 |
|----------|------------|------|
| `admin-auth` | POST `/login`, `/logout` | 認証 |
| `admin-tournaments` | GET, POST, PATCH, DELETE | 大会 CRUD + ダッシュボード |
| `admin-entries` | GET, POST, PATCH | エントリー管理 |
| `admin-teams` | GET, POST, PATCH, DELETE | チーム管理 |
| `admin-matches` | POST (confirm/rollback) | 試合結果確定・ロールバック |
| `admin-courts` | PATCH | コート停止・再開 |
| `admin-history` | GET | 試合/移動/監査ログ履歴 |
| `admin-imports` | POST | CSV 一括インポート |
| `public-api` | GET | 公開ボード用 (認証不要) |

---

## シードデータ

テスト用の3つの SQL ファイル:

### `seed_tournament.sql`
- テスト大会（シングルス7面 + ダブルス3面）
- 管理者アカウント（admin@example.com / password123）
- 5チーム（レッド, ブルー, グリーン, イエロー, パープル）

### `seed_test.sql`
- シングルス 40 エントリー（コート 1-7 にラウンドロビン配置）
- ダブルス 30 ペア / 60 メンバー（コート 8-10 にラウンドロビン配置）

### `seed_queue.sql`
- `initial_court_no` に基づいて待機列を生成
- 各コートの先頭2組で初期試合を自動作成
- `allow_same_team_match = false` の場合、同チーム回避ロジック実行

---

## 開発フロー

このプロジェクトは **TDD (テスト駆動開発)** を厳守しています。

```
1. spec.md の該当節を読む
2. テストケースを書く（RED）
3. RED であることを確認
4. core/ のロジックを実装（GREEN）
5. GREEN であることを確認
6. Edge Function のハンドラを実装
7. 仕様と実装を突き合わせてレビュー
8. コミット → 次の機能へ
```

詳細は `CLAUDE.md` を参照。
