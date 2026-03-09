# コートラダー 実装計画書

- 文書名: コートラダー 実装計画書
- 作成日: 2026-03-08
- ベース仕様: spec.md v2.5 / er_api.md v2.5

---

## 1. ディレクトリ構成

モノレポ構成とする。フロントエンドとSupabaseプロジェクトを同一リポジトリで管理する。

```
court_ladder/
├── README.md
├── package.json                  # ルートのワークスペース設定（npm workspaces）
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Pages デプロイ
│
├── frontend/                     # React + Vite アプリ
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   └── robots.txt            # noindex 設定
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes.tsx             # React Router 定義
│       ├── lib/
│       │   ├── supabase.ts       # Supabase クライアント初期化
│       │   ├── api.ts            # API クライアント（fetch ラッパー）
│       │   └── constants.ts
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useRealtime.ts    # Supabase Realtime 購読
│       │   ├── useDashboard.ts
│       │   └── useSnapshot.ts
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── TournamentListPage.tsx
│       │   ├── DashboardPage.tsx
│       │   ├── EntryManagementPage.tsx
│       │   ├── TeamManagementPage.tsx
│       │   ├── InitialPlacementPage.tsx
│       │   ├── MatchHistoryPage.tsx
│       │   ├── TournamentSettingsPage.tsx
│       │   ├── PublicBoardPage.tsx
│       │   └── NotFoundPage.tsx
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AdminLayout.tsx
│       │   │   ├── PublicLayout.tsx
│       │   │   └── Header.tsx
│       │   ├── court/
│       │   │   ├── CourtCard.tsx
│       │   │   ├── CourtGrid.tsx
│       │   │   ├── QueueList.tsx
│       │   │   └── CurrentMatch.tsx
│       │   ├── team/
│       │   │   ├── TeamForm.tsx
│       │   │   ├── TeamColorPicker.tsx
│       │   │   └── TeamBadge.tsx
│       │   ├── match/
│       │   │   ├── ResultInputDialog.tsx    # 勝者選択→スコア選択のフロー
│       │   │   ├── MovementPreviewDialog.tsx
│       │   │   ├── RollbackDialog.tsx
│       │   │   └── MatchHistoryTable.tsx
│       │   ├── entry/
│       │   │   ├── EntryForm.tsx
│       │   │   ├── EntryTable.tsx
│       │   │   ├── CsvImportDialog.tsx
│       │   │   └── EntryStatusBadge.tsx
│       │   ├── placement/
│       │   │   ├── PlacementBoard.tsx
│       │   │   ├── DraggableEntry.tsx
│       │   │   └── AutoPlacementDialog.tsx
│       │   └── ui/
│       │       ├── ConfirmDialog.tsx
│       │       ├── LoadingSpinner.tsx
│       │       └── ErrorAlert.tsx
│       ├── types/
│       │   ├── tournament.ts
│       │   ├── entry.ts
│       │   ├── court.ts
│       │   ├── match.ts
│       │   ├── team.ts
│       │   └── api.ts            # 共通レスポンス型
│       └── styles/
│           └── global.css
│
├── supabase/
│   ├── config.toml               # Supabase CLI 設定
│   ├── seed.sql                  # 初期データ（開発用）
│   ├── migrations/
│   │   ├── 00001_create_tournaments.sql
│   │   ├── 00002_create_admin_accounts.sql
│   │   ├── 00003_create_teams.sql
│   │   ├── 00004_create_members_entries.sql
│   │   ├── 00005_create_courts_queue.sql
│   │   ├── 00006_create_matches.sql
│   │   ├── 00007_create_movement_audit_logs.sql
│   │   ├── 00008_create_previews.sql
│   │   ├── 00009_create_indexes_constraints.sql
│   │   └── 00010_enable_realtime.sql
│   └── functions/
│       ├── _shared/               # 共通モジュール
│       │   ├── cors.ts
│       │   ├── auth.ts           # JWT 検証 + admin_accounts 照合
│       │   ├── response.ts       # 共通レスポンスヘルパー
│       │   ├── errors.ts         # エラーコード定義
│       │   ├── validation.ts     # バリデーションユーティリティ
│       │   └── db.ts             # Supabase クライアント（サービスロール）
│       ├── admin-auth/
│       │   └── index.ts          # /api/admin/auth/*
│       ├── admin-tournaments/
│       │   └── index.ts          # /api/admin/tournaments/*
│       ├── admin-entries/
│       │   └── index.ts          # /api/admin/tournaments/{id}/entries/*
│       ├── admin-teams/
│       │   └── index.ts          # /api/admin/tournaments/{id}/teams/*
│       ├── admin-imports/
│       │   └── index.ts          # /api/admin/tournaments/{id}/imports/*
│       ├── admin-courts/
│       │   └── index.ts          # /api/admin/tournaments/{id}/courts/*
│       ├── admin-matches/
│       │   └── index.ts          # /api/admin/tournaments/{id}/matches/*
│       ├── admin-history/
│       │   └── index.ts          # /api/admin/tournaments/{id}/history/* + exports/*
│       └── public-api/
│           └── index.ts          # /api/public/{publicToken}/*
```

---

## 2. Edge Functions のエンドポイント分割

### 2-1. 分割方針

Supabase Edge Functions は 1 function 内で URLPattern や手動ルーティングにより複数パスを処理できる。機能ドメインごとに function を分割し、各 function 内でサブルートをハンドリングする。

### 2-2. Function 一覧

| Function 名 | ベースパス | 担当 API（er_api.md 参照） |
|---|---|---|
| `admin-auth` | `/api/admin/auth` | POST /login, POST /logout, GET /me |
| `admin-tournaments` | `/api/admin/tournaments` | GET 一覧, POST 作成, GET/{id}, PATCH/{id}, DELETE/{id}, POST /actions/start\|end\|reopen\|regenerate-public-token, GET /dashboard |
| `admin-entries` | `/api/admin/tournaments/:id/entries` | GET 一覧, POST 作成, GET/:entryId, PATCH/:entryId, POST/:entryId/actions/move |
| `admin-teams` | `/api/admin/tournaments/:id/teams` | GET 一覧, POST 作成, PATCH/:teamId, DELETE/:teamId |
| `admin-imports` | `/api/admin/tournaments/:id/imports` | POST /entries/preview, POST /entries/commit |
| `admin-courts` | `/api/admin/tournaments/:id/courts` | GET 一覧, GET/:courtNo, PATCH/:courtNo/queue, POST/:courtNo/queue/entries, POST /actions/stop\|resume\|recalculate\|clear-current-match, POST /allocations/preview\|apply |
| `admin-matches` | `/api/admin/tournaments/:id/matches` | GET 一覧, GET /courts/:courtNo/current-match, POST/:matchId/result, POST/:matchId/result/preview, POST/:matchId/rollback |
| `admin-history` | `/api/admin/tournaments/:id/history` | GET /matches, GET /movements, GET /audit-logs, GET /exports/:kind.csv, GET /exports/results.pdf |
| `public-api` | `/api/public/:publicToken` | GET /snapshot, GET /courts, GET /courts/:courtNo |

### 2-3. 共通処理の配置

`supabase/functions/_shared/` に置く共通モジュール:

| モジュール | 役割 |
|---|---|
| `auth.ts` | JWT 検証、Supabase Auth からユーザー取得、`admin_accounts` 照合。公開 API では使わない |
| `cors.ts` | CORS ヘッダ付与。全 function の preflight と本リクエストで使用 |
| `response.ts` | `successResponse(data, meta)`, `errorResponse(code, message, details, status)` のヘルパー |
| `errors.ts` | `VERSION_CONFLICT`, `AUTO_ROLLBACK_NOT_ALLOWED` 等のエラーコード定数 |
| `validation.ts` | 必須フィールドチェック、型チェック。Deno 標準ライブラリまたは Zod で実装 |
| `db.ts` | `createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))` によるサーバー側クライアント |

### 2-4. ルーティング実装パターン

各 function の `index.ts` では `URLPattern` を使ってルーティングする。

```typescript
// 例: admin-courts/index.ts
import { serve } from 'https://deno.land/std/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/auth.ts'

const routes = [
  { pattern: new URLPattern({ pathname: '/api/admin/tournaments/:tid/courts' }), method: 'GET', handler: listCourts },
  { pattern: new URLPattern({ pathname: '/api/admin/tournaments/:tid/courts/:courtNo' }), method: 'GET', handler: getCourtDetail },
  { pattern: new URLPattern({ pathname: '/api/admin/tournaments/:tid/courts/:courtNo/queue' }), method: 'PATCH', handler: reorderQueue },
  // ... 他のルート
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCors(req)
  const admin = await requireAdmin(req)
  // マッチしたルートにディスパッチ
})
```

---

## 3. フロントエンド画面構成

### 3-1. ルーティング設計（React Router v6）

| パス | ページコンポーネント | 認証 | 説明 |
|---|---|---|---|
| `/login` | LoginPage | 不要 | 管理者ログイン |
| `/tournaments` | TournamentListPage | 要 | 大会一覧 |
| `/tournaments/:tid` | DashboardPage | 要 | 管理ダッシュボード（メイン画面） |
| `/tournaments/:tid/entries` | EntryManagementPage | 要 | エントリー管理・CSV取込 |
| `/tournaments/:tid/teams` | TeamManagementPage | 要 | チーム管理・カラー設定 |
| `/tournaments/:tid/placement` | InitialPlacementPage | 要 | 初期配置・自動配置 |
| `/tournaments/:tid/history` | MatchHistoryPage | 要 | 試合履歴・移動履歴・監査ログ |
| `/tournaments/:tid/settings` | TournamentSettingsPage | 要 | 大会設定 |
| `/public/:token` | PublicBoardPage | 不要 | 公開モニター画面 |
| `*` | NotFoundPage | 不要 | 404 |

管理系ページは `AdminLayout` でラップし、認証チェック・ナビゲーション・ログアウトを共通化する。
公開系ページは `PublicLayout` でラップし、noindex meta タグを出力する。

### 3-2. 主要コンポーネントと対応画面

**ダッシュボード（DashboardPage）**
- `CourtGrid`: 全コートをグリッド表示
- `CourtCard`: コートごとの現在対戦・待機列サマリ・状態（チームカラー表示対応）
- `CurrentMatch`: 対戦中ペアの表示 + 結果入力ボタン（チームカラー表示対応）
- `ResultInputDialog`: 勝者選択 → 敗者得点選択 → 移動先プレビュー → 確定のステップモーダル
- `MovementPreviewDialog`: 結果確定前の移動先確認ダイアログ
- `RollbackDialog`: 結果取り消し確認モーダル
- `ConfirmDialog`: コート停止/大会開始・終了等の確認

**エントリー管理（EntryManagementPage）**
- `EntryTable`: エントリー一覧（フィルタ・ページネーション付き）
- `EntryForm`: エントリー作成・編集フォーム（メンバー入力 + チーム選択）。表示名は自動生成のため入力欄なし
- `CsvImportDialog`: CSV アップロード → プレビュー → 確定のステップモーダル
- `EntryStatusBadge`: active/paused/withdrawn の状態表示

**初期配置（InitialPlacementPage）**
- `PlacementBoard`: コート別待機列のカンバン形式表示
- `DraggableEntry`: DnD 対応のエントリーカード
- `AutoPlacementDialog`: 自動配置モード選択・プレビュー・確定

**公開モニター（PublicBoardPage）**
- `CourtGrid` + `CourtCard`（公開版: 内部IDなし、チームカラー付き自動生成表示名）
- 自動更新（Realtime 購読 + snapshot 再取得）
- フルスクリーン切替ボタン

**チーム管理（TeamManagementPage）**
- `TeamForm`: チーム名・カラーコード入力フォーム
- `TeamColorPicker`: プリセット20色からの色選択
- `TeamBadge`: チームカラーのプレビュー表示

### 3-3. 状態管理方針

| 用途 | 方式 |
|---|---|
| サーバー状態（API データ） | TanStack Query (React Query) |
| 認証状態 | Supabase JS SDK の `onAuthStateChange` + React Context |
| Realtime 購読 | カスタムフック `useRealtime` で Supabase Realtime チャンネルを管理 |
| フォーム状態 | React Hook Form |
| UI ローカル状態 | React useState / useReducer |
| DnD 状態 | dnd-kit の内部状態 |

TanStack Query の活用方針:
- `queryKey` に `[resource, tournamentId, revision]` を含め、Realtime で revision が進んだ場合に `invalidateQueries` する
- ダッシュボードの `dashboard` API を中心にキャッシュし、結果入力成功後は即座に `invalidate` する
- 公開画面は `snapshot` を単一クエリとし、Realtime 通知 → jitter → refetch のパターンで更新

---

## 4. 実装フェーズと優先順位

### Phase 1: 基盤構築とMVP骨格

**目標**: ログインして大会を作成し、エントリーを登録してコートに配置し、結果入力→自動移動→公開画面表示が一通り動くこと

**成果物**:
- Supabase プロジェクトセットアップ + マイグレーション（全テーブル）
- `admin-auth` Function（ログイン・ログアウト・me）
- `admin-tournaments` Function（作成・取得・設定更新・開始/終了・ダッシュボード）
- `admin-entries` Function（CRUD、状態変更は最低限）
- `admin-teams` Function（チーム CRUD）
- `admin-courts` Function（コート取得、待機列並び替え、コート停止/再開）
- `admin-matches` Function（結果確定、自動移動、次試合自動生成、結果確定前の移動先プレビュー）
- `public-api` Function（snapshot）
- フロント: ログイン画面、大会一覧、ダッシュボード（結果入力含む）、チーム管理画面、公開モニター
- `game_point` 対応のスコア入力
- Realtime 購読による自動更新

**検証基準**:
- 受入基準 1〜10 を満たすこと
- 結果確定→移動→次試合生成→公開画面反映が 3 秒以内

### Phase 2: 手動修正・ロールバック・エントリー管理の充実

**目標**: 運用中の例外処理ができること

**成果物**:
- 結果取り消し（rollback）
- 現在対戦の手動解消（clear-current-match）
- 現在対戦の再計算（recalculate）
- エントリーの手動移動
- 未所属エントリーの待機列追加
- エントリー状態変更時の待機列自動除外
- 楽観的ロック（version 衝突検出と UI 上のエラー表示）
- フロント: ResultInputDialog の完成、RollbackDialog、手動修正操作一式

**検証基準**:
- 受入基準 11〜17 を満たすこと

### Phase 3: CSV取込・初期自動配置・履歴

**目標**: 大会準備〜終了までの一連のワークフローが完結すること

**成果物**:
- `admin-imports` Function（CSV プレビュー・確定）
- `admin-courts` に allocations/preview・apply を追加
- `admin-history` Function（試合履歴・移動履歴・監査ログ・CSV エクスポート）
- PDF エクスポート機能
- 大会データ削除機能
- フロント: CsvImportDialog、AutoPlacementDialog、InitialPlacementPage（DnD）、MatchHistoryPage
- 監査ログの記録

**検証基準**:
- 受入基準 18〜20 を満たすこと
- CSV から一括登録→自動配置→大会開始→結果入力→大会終了→CSV エクスポートの一連の流れが動くこと
- 大会終了 → PDF/CSV エクスポート → 大会データ削除の一連の流れが動くこと

### Phase 4: 品質向上・デプロイ

**目標**: 本番運用に耐えるレベルの品質

**成果物**:
- ETag / 304 対応
- エラーハンドリングの網羅
- レスポンシブ対応の調整（特に公開画面のスマホ表示）
- フルスクリーンモード
- GitHub Actions による GitHub Pages 自動デプロイ
- 本番 Supabase プロジェクトの設定
- RLS（Row Level Security）ポリシーの設定
- Edge Functions の環境変数・シークレット設定

**検証基準**:
- 全受入基準を満たすこと
- 同時閲覧 100 名でもスナップショット取得に支障がないこと
- WebSocket 切断→再接続→ポーリングフォールバックが動作すること

---

## 5. 外部ライブラリ選定

### 5-1. フロントエンド

| カテゴリ | ライブラリ | 理由 |
|---|---|---|
| UI フレームワーク | Tailwind CSS + shadcn/ui | ユーティリティファーストで高速開発。shadcn/ui はコピー方式でバンドルサイズ制御しやすい |
| 状態管理（サーバー） | TanStack Query v5 | キャッシュ・再取得・楽観的更新が充実 |
| ルーティング | React Router v6 | 標準的。ファイルベースルーティングは不要 |
| フォーム | React Hook Form + Zod | バリデーション付きフォーム。Zod スキーマを型安全に共有可能 |
| DnD | @dnd-kit/core + @dnd-kit/sortable | 軽量で React 対応が良い。初期配置・待機列並び替えに使用 |
| Supabase SDK | @supabase/supabase-js v2 | Auth・Realtime・REST 全てカバー |
| 日時 | date-fns | 軽量。ISO 8601 パースとローカル変換 |
| アイコン | lucide-react | shadcn/ui との相性が良い |
| トースト通知 | sonner | shadcn/ui 標準のトースト。操作成功/エラー通知に使用 |
| PDF 生成 | @react-pdf/renderer または jspdf | 大会結果の PDF エクスポートに使用 |

### 5-2. バックエンド（Edge Functions / Deno）

| カテゴリ | ライブラリ | 理由 |
|---|---|---|
| バリデーション | Zod（npm:zod） | Deno で npm パッケージとして利用可能。フロントと型定義を揃えられる |
| CSV パース | csv-parse（Deno 標準ライブラリ `std/csv`） | Deno 標準ライブラリに CSV パーサーがあるためそれを使う |
| UUID | crypto.randomUUID() | Deno / Web 標準 API。外部ライブラリ不要 |
| Supabase | @supabase/supabase-js | Edge Functions 内で DB 操作に使用（サービスロールキー） |

### 5-3. Supabase の制約メモ

- Edge Functions は Deno ランタイム（Node.js API は一部のみ対応）
- 1 リクエストあたり最大 50MB
- リクエスト実行時間はデフォルト 60 秒（設定で延長可、最大 300 秒）
- `_shared/` ディレクトリのファイルは function 間で共有可能だが、デプロイ時に各 function にバンドルされる
- Realtime は同時接続数にプラン上限がある（Free: 200、Pro: 500）。公開画面の同時閲覧数を考慮してプランを選定する
- RLS を有効にしつつ、Edge Functions 内ではサービスロールキーで RLS をバイパスする設計とする
