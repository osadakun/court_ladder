# コートラダー ER図・API一覧 v2.6

- ベース仕様: `spec.md` v2.6
- 作成日: 2026-03-08
- 対象: バックエンド実装、管理画面、公開画面、本部モニター連携
- 方針: REST + JSON、管理系は Supabase Auth（JWT）、公開系は `public_token`、リアルタイム更新は **Supabase Realtime（WebSocket）+ snapshot 再取得（ETag / max-age=1 / jitter 付き）**

---

## 1. この文書の位置づけ

この文書は `spec.md` v2.6 を実装に落とすための補足設計である。

- **ER図** は論理 ER ベースであり、物理設計時の索引・制約・部分ユニーク制約まで含めて示す
- **API一覧** は初版で必要な操作に絞り、画面実装でそのまま使える粒度に寄せる
- 競技ルール判定は最小限とし、進行管理と整合性維持を優先する
- v2.2 では、終了条件、未所属エントリー復帰、公開タイトル、状態変更時の盤面通知を明文化
- v2.3 では、認証を Supabase Auth（JWT）、リアルタイム通知を Supabase Realtime（WebSocket）に変更
- v2.4 では、ゼッケン番号を廃止し、チームカラーによる色分け表示を導入
- v2.5 では、大会から `format_type` を削除しシングルス/ダブルス混在を許可、表示名の自動生成化、`game_point` によるスコア入力改善、結果確定プレビュー追加、大会削除・PDF エクスポート追加
- v2.6 では、`court_count` を `singles_court_count` / `doubles_court_count` に分割し、`allow_same_team_match`、`members.grade`、`entries.initial_court_no`、`courts.court_type`、`outcome_type = abandoned`、allocation 廃止を反映

---

## 2. ER / 物理設計補足

ER 図の画像ファイルは既存の `courtladder_er.svg` を利用できるが、本版の実装ソースとしては **本節のテーブル定義・制約を優先** する。

### 2-1. 主要エンティティ

| テーブル | 主キー | 主な外部キー | 役割 |
|---|---|---|---|
| tournaments | tournament_id | - | 大会本体。`revision`, `public_page_title`, `public_token`, `game_point`(既定21), `singles_court_count`, `doubles_court_count`, `allow_same_team_match` を持つ |
| admin_accounts | admin_id | - | システム共通の管理者アカウント |
| teams | team_id | tournament_id | チーム名とカラーコード |
| members | member_id | tournament_id | 選手個人。`management_name`, `grade` を保持（表示名は自動生成） |
| entries | entry_id | tournament_id, team_id | 対戦単位。シングルス1名またはダブルス1組。同一大会内で混在可。`initial_court_no` を持つ |
| entry_members | entry_member_id | tournament_id, entry_id, member_id | エントリーとメンバーの対応 |
| courts | court_id | tournament_id, current_match_id | コート定義と現在状態。`court_type` を持つ |
| queue_items | queue_item_id | tournament_id, entry_id, source_match_id | 各コートの現在待機列 |
| matches | match_id | tournament_id, entry_a_id, entry_b_id, winner_entry_id, loser_entry_id, result_confirmed_by | 試合と結果。`entry_a_snapshot JSONB`, `entry_b_snapshot JSONB` で試合作成時のメンバー構成・表示名を保持 |
| movement_logs | movement_log_id | tournament_id, match_id, entry_id | 勝敗や手動移動、ロールバック、状態変更による除外の履歴 |
| audit_logs | audit_log_id | tournament_id, actor_admin_id | 管理操作の監査証跡 |
| import_previews | import_preview_id | tournament_id, created_by_admin_id | CSV 取込プレビューの一時保持 |

### 2-2. 主要リレーション

- `tournaments` 1 : N `teams`
- `teams` 1 : N `entries`
- `tournaments` 1 : N `members`
- `tournaments` 1 : N `entries`
- `tournaments` 1 : N `courts`
- `tournaments` 1 : N `queue_items`
- `tournaments` 1 : N `matches`
- `tournaments` 1 : N `movement_logs`
- `tournaments` 1 : N `audit_logs`
- `tournaments` 1 : N `import_previews`
- `entries` 1 : N `entry_members`
- `members` 1 : N `entry_members`
- `entries` 1 : N `queue_items`
- `courts` 1 : N `queue_items`
- `courts` 1 : N `matches`
- `matches` 1 : N `movement_logs`
- `matches` 1 : N `queue_items`（`queue_items.source_match_id`、nullable）
- `admin_accounts` 1 : N `audit_logs`
- `admin_accounts` 1 : N `matches`（`result_confirmed_by`）
- `admin_accounts` 1 : N `import_previews`

### 2-3. 論理モデル上の補足

1. `queue_items.court_no` と `matches.court_no` は、物理設計では **`(tournament_id, court_no)` を `courts` に参照する複合外部キー** として扱う
2. `courts.current_match_id` は、`matches.state = 'in_progress'` を高速に参照するための補助ポインタとし、試合自動生成 / 結果確定 / 結果取り消し / 現在対戦手動解消 / コート再開後の再計算と **同一トランザクション内で更新**する
3. `queue_items` は履歴テーブルではなく **現在状態テーブル** とし、履歴は `movement_logs` と `matches` に残す
4. ダブルスは `entries.entry_type = doubles` の場合に `entry_members` がちょうど 2 件存在することをアプリケーション制約で担保する
5. `admin_accounts` は大会別ではなく **システム共通** とする。初版は単一運営主体前提とし、将来の大会別権限制御は別テーブルで拡張する
6. preview テーブルは TTL 付きの一時データであるが、再起動耐性とマルチインスタンス耐性のため **DB に保持**する。初版の TTL は **30分** とする
7. `tournaments.revision` は公開 / 管理の盤面に影響する更新単位のグローバルカウンタである
8. `movement_logs.match_id` は、`movement_reason IN ('manual', 'auto_remove_due_to_status')` の場合のみ nullable とする
9. `courts.court_type` によりシングルス/ダブルスの移動境界を判定し、種別間移動は禁止する
10. allocation preview/apply は v2.6 で廃止し、初期所属は `entries.initial_court_no` と `queue_items.enqueue_reason = 'initial'` で表現する

### 2-4. 推奨ユニーク制約・整合性制約

| 対象 | 制約 |
|---|---|
| tournaments | `UNIQUE (public_token)` |
| teams | `UNIQUE (tournament_id, team_name)` |
| teams | `UNIQUE (tournament_id, sort_order)` |
| courts | `UNIQUE (tournament_id, court_no)` |
| queue_items | `UNIQUE (tournament_id, entry_id)` |
| queue_items | `UNIQUE (tournament_id, court_no, queue_position)` |
| entry_members | `UNIQUE (entry_id, member_order)` |
| entry_members | `UNIQUE (entry_id, member_id)` |
| matches | 部分ユニーク `UNIQUE (tournament_id, court_no) WHERE state = 'in_progress'` |
| entries | `CHECK status IN ('active','paused','withdrawn')` |
| courts | `CHECK status IN ('active','stopped')` |
| courts | `CHECK court_type IN ('singles','doubles')` |
| tournaments | `CHECK state IN ('preparing','live','ended')` |
| tournaments | `CHECK (singles_court_count BETWEEN 0 AND 20)` |
| tournaments | `CHECK (doubles_court_count BETWEEN 0 AND 20)` |
| tournaments | `CHECK (singles_court_count + doubles_court_count BETWEEN 2 AND 20)` |
| matches | `CHECK state IN ('in_progress','finished','cancelled')` |
| matches | `CHECK cancel_reason IN ('rollback','manual_clear') OR cancel_reason IS NULL` |
| movement_logs | `CHECK movement_reason IN ('win','loss','manual','rollback','manual_requeue','auto_remove_due_to_status','abandoned_requeue')` |
| members | `CHECK grade IN ('年長','小1','小2','小3','小4','小5','小6','中1','中2','中3','大人')` |

### 2-5. 推奨インデックス

| テーブル | 推奨インデックス | 用途 |
|---|---|---|
| tournaments | `(state, event_date)` | 大会一覧 |
| teams | `(tournament_id, sort_order)` | チーム一覧 |
| queue_items | `(tournament_id, court_no, queue_position)` | コート別待機列描画 |
| matches | `(tournament_id, court_no, state)` | 現在対戦取得 |
| matches | `(tournament_id, finished_at DESC)` | 履歴一覧 |
| movement_logs | `(tournament_id, created_at DESC)` | 移動履歴表示 |
| audit_logs | `(tournament_id, created_at DESC)` | 監査ログ表示 |
| entries | `(tournament_id, status)` | 参加状態フィルタ |
| import_previews | `(tournament_id, expires_at)` | 有効 preview 検索 |

---

## 3. API 設計方針

### 3-1. ベースパス

- 管理 API: `/api/admin`
- 公開 API: `/api/public`

### 3-2. 認証・認可

- 管理 API は **Supabase Auth の JWT（Authorization: Bearer ヘッダ）** を必須とする
- JWT は Edge Functions 内で検証し、`admin_accounts` テーブルと照合して認可する
- CSRF トークンは不要（JWT + Authorization ヘッダ方式のため）
- 公開 API は `public_token` により閲覧を許可する
- `public_enabled = false` の大会は公開 API で `404` を返す

### 3-3. データ形式

- リクエスト / レスポンスは JSON
- 文字コードは UTF-8
- 時刻は ISO 8601 形式（UTC 保存、表示はクライアント側でローカル変換可）

### 3-4. 共通レスポンス形式

正常系:

```json
{
  "data": {},
  "meta": {
    "revision": 128,
    "server_time": "2026-03-07T13:30:00Z"
  }
}
```

異常系:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "対象データが更新されています。再読込してください。",
    "details": {
      "resource": "match",
      "resource_id": "mat_001"
    }
  }
}
```

### 3-5. `meta.revision` の定義

- `meta.revision` は **大会単位のグローバル更新番号** である
- `tournaments.revision` をそのまま返す
- 待機列、現在対戦、コート状態、大会状態、公開表示に影響する設定変更が成功するたびに加算する
- クライアントは `revision` の差分で再描画 / 再取得判断を行う

### 3-6. キャッシュ / ETag 方針

- `GET /api/public/{publicToken}/snapshot` は `ETag: W/"rev-<revision>"` を返す
- `If-None-Match` が現在 revision と一致する場合は `304 Not Modified` を返す
- 公開 snapshot は `Cache-Control: public, max-age=1, must-revalidate` を返す
- 管理 dashboard は `Cache-Control: private, no-store` を返す

### 3-7. HTTP ステータス方針

| ステータス | 用途 |
|---|---|
| 200 | 正常取得・正常更新 |
| 201 | 新規作成 |
| 204 | 正常ログアウトなど本文なし |
| 304 | 変更なし（ETag 一致） |
| 400 | リクエスト不正 |
| 401 | 未認証 |
| 403 | 認可不足 |
| 404 | リソースなし、または無効な公開トークン |
| 409 | version 衝突、状態不整合、ロールバック不成立 |
| 422 | バリデーションエラー |

### 3-8. 楽観的ロック方針

- 試合結果確定・結果取り消し: `matches.version`
- コート停止 / 再開、待機列並び替え、現在対戦解消 / 再計算: `courts.version`
- エントリー編集・状態変更: `entries.version`
- `version` 不一致時は `409 VERSION_CONFLICT` を返す

### 3-9. 公開 API の ID 露出ポリシー

- 公開 API は `entry_id`, `member_id`, `match_id` などの内部 ID を返さない
- 公開画面に必要な情報は自動生成された表示名（`display_name`）, チームカラー（`team_color`）, チーム名（`team_name`）, 位置情報で足りる設計とする
- 内部 ID が必要な操作は管理 API に限定する

### 3-10. Realtime 方針

リアルタイム更新は **Supabase Realtime（Postgres Changes）** を使い、`tournaments` テーブルの `revision` 変更を購読する。

- クライアントは Supabase JS SDK の `channel.on('postgres_changes', ...)` で `tournaments` テーブルの UPDATE を監視する
- `revision` の変更を検知したら、snapshot API を再取得する
- 標準クライアントは通知受信後に **0〜500ms のランダム遅延** を入れて snapshot 再取得する
- 高度なクライアントは独自にコート別 API を再取得してもよい
- WebSocket が切れたら Supabase SDK が自動再接続を試みる。失敗が続く場合は 3 秒ポーリングへフォールバックする
- Supabase Realtime の heartbeat は SDK が自動管理する

### 3-11. preview データのライフサイクル

- `preview` API は preview レコードを作成し、`import_id` または `plan_id` を返す
- preview の TTL は **30分** とする
- `commit` / `apply` は当該 preview が未使用かつ未期限切れであることを検証する
- `commit` / `apply` 成功時は `consumed_at` を記録する
- 期限切れ preview に対しては `409 PREVIEW_EXPIRED` を返す

---

## 4. API 一覧

### 4-1. 認証系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| POST | `/api/admin/auth/login` | 不要 | 管理者ログイン | `email`, `password` | Supabase Auth トークン（access_token, refresh_token） |
| POST | `/api/admin/auth/logout` | 要 | ログアウト | なし | 204 |
| GET | `/api/admin/auth/me` | 要 | ログイン中管理者の取得 | なし | `admin_id`, `display_name` |

### 4-2. 大会・ダッシュボード系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/admin/tournaments` | 要 | 大会一覧取得 | クエリ: `state` | 大会一覧 |
| POST | `/api/admin/tournaments` | 要 | 大会作成 | `name`, `public_page_title`, `event_date`, `singles_court_count`, `doubles_court_count`, `game_point`(既定21), `public_queue_display_limit`, `public_enabled`, `allow_same_team_match` | 大会詳細 |
| GET | `/api/admin/tournaments/{tournamentId}` | 要 | 大会詳細取得 | なし | 大会設定 |
| PATCH | `/api/admin/tournaments/{tournamentId}` | 要 | 大会設定更新 | `version` は不要、差分設定項目 | 更新後大会 |
| POST | `/api/admin/tournaments/{tournamentId}/actions/start` | 要 | 大会開始 | 任意 `confirm_note` | `state = live` |
| POST | `/api/admin/tournaments/{tournamentId}/actions/end` | 要 | 大会終了 | 任意 `confirm_note` | `state = ended` |
| POST | `/api/admin/tournaments/{tournamentId}/actions/reopen` | 要 | 大会再開 | 任意 `confirm_note` | `state = live` |
| DELETE | `/api/admin/tournaments/{tournamentId}` | 要 | 大会データ完全削除 | なし | 204 |
| POST | `/api/admin/tournaments/{tournamentId}/actions/regenerate-public-token` | 要 | 公開 URL トークン再発行 | 任意 `reason` | 新 `public_token` |
| GET | `/api/admin/tournaments/{tournamentId}/dashboard` | 要 | 管理画面の初期表示 / 再読込 | なし | 大会、コート一覧、現在対戦、待機列プレビュー |
| - | Supabase Realtime チャンネル | 要 | 管理画面向けリアルタイム通知 | `tournaments` テーブル購読 | `revision` 変更通知 |

補足:

- `PATCH /tournaments/{id}` では `singles_court_count` / `doubles_court_count` は `state = preparing` のときのみ変更可
- 大会作成時に `courts` テーブルへ `singles_court_count + doubles_court_count` 分の行を作成し、`court_type` を設定する
- `POST /actions/end` は、大会内に `state = in_progress` の試合が 1 件でも存在する場合 **409 ACTIVE_MATCHES_EXIST** を返す
- `POST /actions/reopen` 成功時は `revision` を加算する（Realtime 経由で自動通知）
- `DELETE /tournaments/{id}` は `state = ended` の大会のみ削除可能。関連する全テーブルのデータをカスケード削除する

### 4-3. エントリー・メンバー系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/admin/tournaments/{tournamentId}/entries` | 要 | エントリー一覧 | クエリ: `status`, `q`, `page`, `page_size`, `include_withdrawn` | エントリー一覧 |
| POST | `/api/admin/tournaments/{tournamentId}/entries` | 要 | エントリー作成 | `entry_type`, `team_id`, `initial_court_no`, `members[]` | 作成済みエントリー |
| GET | `/api/admin/tournaments/{tournamentId}/entries/{entryId}` | 要 | エントリー詳細 | なし | エントリー + メンバー |
| PATCH | `/api/admin/tournaments/{tournamentId}/entries/{entryId}` | 要 | エントリー更新 | `version`, 差分項目、`status` 含む | 更新後エントリー |

作成時の `members[]` 例:

```json
{
  "entry_type": "doubles",
  "team_id": "team_001",
  "initial_court_no": 8,
  "members": [
    {"management_name": "田中 太郎", "grade": "中2"},
    {"management_name": "鈴木 花子", "grade": "中2"}
  ]
}
```

バリデーション / 状態変更ルール:

- `entry_type = singles` のとき `members[]` は 1 件
- `entry_type = doubles` のとき `members[]` は 2 件
- `members[].grade` は必須
- `initial_court_no` は必須で、`entry_type` と同じ `court_type` のコートでなければならない
- 作成成功時は `initial_court_no` の待機列末尾へ自動追加する
- `status = withdrawn` のエントリーは現在対戦にも待機列にも新規投入しない
- `status = paused` または `withdrawn` への変更時、当該エントリーが待機列にいる場合は待機列から自動除外する
- 自動除外により盤面が変化した場合は `revision` を加算する（Realtime 経由で自動通知）
- 当該エントリーが `in_progress` 試合に含まれる場合、`paused` / `withdrawn` への変更は **409 CURRENT_MATCH_EXISTS** を返す
- `paused` / `withdrawn` から `active` に戻したエントリーは未所属のままとし、自動では待機列へ戻さない

### 4-4. CSV 一括登録系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| POST | `/api/admin/tournaments/{tournamentId}/imports/entries/preview` | 要 | CSV プレビュー | `multipart/form-data` で `file` | `import_id`, 行別検証結果 |
| POST | `/api/admin/tournaments/{tournamentId}/imports/entries/commit` | 要 | CSV 取込確定 | `import_id`, `mode` (`valid_only` / `all_or_nothing`) | 取込件数、エラー件数 |

プレビュー応答例:

```json
{
  "data": {
    "import_id": "imp_20260307_001",
    "summary": {
      "total_rows": 80,
      "valid_rows": 78,
      "invalid_rows": 2
    },
    "rows": [
      {
        "row_no": 1,
        "status": "valid",
        "normalized": {
          "entry_type": "singles",
          "initial_court_no": 3,
          "members": [
            {"managementName": "山田 太郎", "grade": "中2"}
          ]
        }
      },
      {
        "row_no": 2,
        "status": "invalid",
        "errors": ["ダブルスなのにメンバー2氏名が空です"]
      }
    ]
  }
}
```

### 4-5. チーム管理系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/admin/tournaments/{tournamentId}/teams` | 要 | チーム一覧 | なし | チーム一覧 |
| POST | `/api/admin/tournaments/{tournamentId}/teams` | 要 | チーム作成 | `team_name`, `color_code`(任意) | チーム |
| PATCH | `/api/admin/tournaments/{tournamentId}/teams/{teamId}` | 要 | チーム更新 | `team_name`, `color_code` | チーム |
| DELETE | `/api/admin/tournaments/{tournamentId}/teams/{teamId}` | 要 | チーム削除 | なし | 204 |

補足:

- チーム作成時に `color_code` 未指定の場合、プリセットパレットから `sort_order` 順に自動割り当て
- チーム削除時、所属エントリーの `team_id` は null に設定

### 4-6. 待機列・コート操作系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/admin/tournaments/{tournamentId}/courts` | 要 | コート一覧取得 | なし | コート一覧 |
| GET | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}` | 要 | コート詳細取得 | なし | コート状態、現在対戦、待機列 |
| PATCH | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/queue` | 要 | 待機列の並び替え | `version`, `entry_ids[]` | 更新後コート詳細 |
| POST | `/api/admin/tournaments/{tournamentId}/entries/{entryId}/actions/move` | 要 | 手動移動 | `from_court_no`, `source_court_version`, `to_court_no`, `target_court_version`, `insert_position`, `reason` | 影響コートの更新状態 |
| POST | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/queue/entries` | 要 | 未所属エントリーを待機列へ追加 | `entry_id`, `target_court_version`, `insert_position`, `reason` | 影響コートの更新状態 |
| POST | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/stop` | 要 | コート停止 | `version`, 任意 `reason` | 更新後コート状態 |
| POST | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/resume` | 要 | コート再開 | `version`, 任意 `reason` | 更新後コート状態 |
| POST | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/recalculate` | 要 | 現在対戦の再計算 | `version` | 更新後コート状態 |
| POST | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/clear-current-match` | 要 | 現在対戦の手動解消 | `version`, `requeue_mode`, 任意 `note` | 更新後コート状態 |

`PATCH /queue` リクエスト例:

```json
{
  "version": 12,
  "entry_ids": ["ent_001", "ent_003", "ent_002", "ent_010"]
}
```

`POST /entries/{entryId}/actions/move` リクエスト例:

```json
{
  "from_court_no": 4,
  "source_court_version": 9,
  "to_court_no": 6,
  "target_court_version": 14,
  "insert_position": 3,
  "reason": "manual_adjustment"
}
```

`POST /courts/{courtNo}/queue/entries` リクエスト例:

```json
{
  "entry_id": "ent_099",
  "target_court_version": 14,
  "insert_position": 3,
  "reason": "return_from_paused"
}
```

補足:

- `PATCH /queue` は、送信された `entry_ids[]` が **処理時点の待機列構成と完全一致**することを前提とし、不一致時は `409 QUEUE_MISMATCH` を返す
- `clear-current-match` の `requeue_mode` 初版は `tail_keep_order` のみ対応とする
- `tail_keep_order` では `entry_a → entry_b` の順で同一コート待機列末尾へ戻し、`movement_logs.movement_reason = manual_requeue` を記録する
- `POST /courts/{courtNo}/queue/entries` で `insert_position` を指定した場合、指定位置以降の既存アイテムの `queue_position` を +1 シフトする。実装はトランザクション内で全件再採番してもよい
- `POST /courts/{courtNo}/queue/entries` は、対象エントリーが `active` であること、どの待機列にも `in_progress` 試合にも存在しないこと、対象コートが `active` であることを検証する
- `recalculate` は「現在対戦がない稼働中コート」でのみ許可する。`in_progress` 試合がある場合は `409 CURRENT_MATCH_EXISTS`、停止中コートでは `409 COURT_STOPPED` を返す
- v2.6 では allocation preview/apply は廃止し、初期配置はエントリー作成時または CSV 取込時の `initial_court_no` 指定で行う

### 4-7. 試合・結果系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/admin/tournaments/{tournamentId}/matches` | 要 | 試合一覧 | クエリ: `state`, `court_no`, `page`, `page_size` | 試合一覧 |
| GET | `/api/admin/tournaments/{tournamentId}/courts/{courtNo}/current-match` | 要 | 当該コートの現在対戦取得 | なし | `in_progress` 試合 |
| POST | `/api/admin/tournaments/{tournamentId}/matches/{matchId}/result/preview` | 要 | 結果確定プレビュー | `version`, `outcome_type`, `score_a`, `score_b`, `winner_entry_id` | 移動先計算結果（確定はしない） |
| POST | `/api/admin/tournaments/{tournamentId}/matches/{matchId}/result` | 要 | 試合結果確定 | `version`, `outcome_type`, `score_a`, `score_b`, `winner_entry_id`, `note` | 更新済み試合、移動結果、影響コート |
| POST | `/api/admin/tournaments/{tournamentId}/matches/{matchId}/rollback` | 要 | 結果取り消し | `version`, 任意 `note` | 取り消し後試合、影響コート |

`POST /matches/{matchId}/result` リクエスト例:

```json
{
  "version": 3,
  "outcome_type": "normal",
  "score_a": 21,
  "score_b": 16,
  "winner_entry_id": "ent_001",
  "note": ""
}
```

スコア入力ルール:

- `winner_entry_id` は `abandoned` 以外で必須（先に勝者を選択するフロー）
- 勝者のスコアは必ず `game_point`（大会設定値、既定21）と一致すること
- 敗者のスコアは `0` 〜 `game_point - 1` の範囲であること
- `score_a` / `score_b` のどちらが勝者かは `winner_entry_id` と `entry_a_id` / `entry_b_id` の対応で判定する
- `abandoned` は勝者なし、スコア任意、両者を元コート待機列末尾へ `entry_a → entry_b` の順で戻す

`POST /matches/{matchId}/result/preview` レスポンス例:

```json
{
  "data": {
    "match": { "match_id": "mat_0001", "court_no": 4 },
    "movements": [
      {"entry_display_name": "田中 太郎（A中学校）", "from_court_no": 4, "to_court_no": 3, "movement_reason": "win"},
      {"entry_display_name": "佐藤 次郎（B中学校）", "from_court_no": 4, "to_court_no": 5, "movement_reason": "loss"}
    ]
  }
}
```

`POST /matches/{matchId}/result` レスポンス例:

```json
{
  "data": {
    "match": {
      "match_id": "mat_0001",
      "court_no": 4,
      "state": "finished",
      "winner_entry_id": "ent_001",
      "loser_entry_id": "ent_002",
      "finished_at": "2026-03-07T13:45:00Z"
    },
    "movements": [
      {"entry_id": "ent_001", "from_court_no": 4, "to_court_no": 3, "movement_reason": "win"},
      {"entry_id": "ent_002", "from_court_no": 4, "to_court_no": 5, "movement_reason": "loss"}
    ],
    "affected_courts": [3, 4, 5]
  },
  "meta": {
    "revision": 212,
    "server_time": "2026-03-07T13:45:00Z"
  }
}
```

`POST /matches/{matchId}/rollback` 失敗例:

```json
{
  "error": {
    "code": "AUTO_ROLLBACK_NOT_ALLOWED",
    "message": "既に移動先コートで次試合に割り当てられているため自動取り消しできません。",
    "details": {
      "match_id": "mat_0001"
    }
  }
}
```

結果確定時のサーバー処理:

1. `matches.version` を検証
2. 対象試合が `in_progress` であることを確認
3. 勝者 / 敗者を確定
4. 停止コートスキップルールに従って移動先を決定
5. `allow_same_team_match = false` の場合、移動先待機列で同一チーム回避挿入を行う
6. `queue_items` を追加
7. `matches.state = finished` に更新
8. `movement_logs` を記録
9. 影響コートで必要なら次試合を自動生成
10. `audit_logs` を記録
11. `tournaments.revision` を加算する（Realtime 経由で自動通知）

### 4-8. 履歴・監査・エクスポート系（管理）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/admin/tournaments/{tournamentId}/history/matches` | 要 | 試合履歴一覧 | クエリ: `court_no`, `page`, `page_size`, `from`, `to` | 試合履歴 |
| GET | `/api/admin/tournaments/{tournamentId}/history/movements` | 要 | 移動履歴一覧 | クエリ: `entry_id`, `page`, `page_size` | 移動履歴 |
| GET | `/api/admin/tournaments/{tournamentId}/history/audit-logs` | 要 | 監査ログ一覧 | クエリ: `action_type`, `page`, `page_size` | 監査ログ |
| GET | `/api/admin/tournaments/{tournamentId}/exports/{kind}.csv` | 要 | CSV エクスポート | `kind = matches / movements / audit_logs` | CSV |
| GET | `/api/admin/tournaments/{tournamentId}/exports/results.pdf` | 要 | 全結果 PDF エクスポート | なし | PDF |

### 4-9. 公開画面・本部モニター系（公開）

| Method | Path | 認証 | 用途 | 主なリクエスト | 主なレスポンス |
|---|---|---|---|---|---|
| GET | `/api/public/{publicToken}/snapshot` | 不要 | 公開画面の初期表示 / 再読込 | なし | 大会概要、コート一覧、現在対戦、待機列プレビュー |
| GET | `/api/public/{publicToken}/courts` | 不要 | コート一覧取得 | なし | コート一覧 |
| GET | `/api/public/{publicToken}/courts/{courtNo}` | 不要 | 特定コート詳細 | なし | コート詳細 |
| - | Supabase Realtime チャンネル | 不要 | 公開画面向けリアルタイム通知 | `tournaments` テーブル購読 | `revision` 変更通知 |

`GET /api/public/{publicToken}/snapshot` レスポンス例:

```json
{
  "data": {
    "tournament": {
      "name": "春季校内リーグ",
      "public_page_title": "春季校内リーグ 進行状況",
      "state": "live",
      "event_date": "2026-03-07",
      "updated_at": "2026-03-07T13:45:00Z",
      "queue_display_limit": 5
    },
    "courts": [
      {
        "court_no": 1,
        "status": "active",
        "current_match": {
          "entry_a": {"display_name": "田中", "team_color": "#FF5733", "team_name": "Aチーム"},
          "entry_b": {"display_name": "佐藤", "team_color": "#3366FF", "team_name": "Bチーム"}
        },
        "queue_preview": [
          {"position": 1, "display_name": "伊藤", "team_color": "#FF5733", "team_name": "Aチーム"},
          {"position": 2, "display_name": "中村", "team_color": "#33CC99", "team_name": "Cチーム"}
        ],
        "queue_count": 6,
        "remaining_queue_count": 4
      }
    ]
  },
  "meta": {
    "revision": 212,
    "server_time": "2026-03-07T13:45:00Z"
  }
}
```

補足:

- 公開 API は `entry_id`, `match_id` などの内部 ID を返さない
- 公開 API は `team_id` は返さず `team_color` と `team_name` のみ返す
- `/snapshot`, `/courts`, `/courts/{courtNo}` はいずれも **内部 ID 非公開 / 公開表示名中心** の同一方針でレスポンスを返す
- 公開画面のタイトル表示は `public_page_title` が設定されていればそれを優先し、未設定時は `name` を用いる
- 公開表示名は `grade:management_name` 形式の学年プレフィックスを含み、チームカラーは色丸ではなく背景色表示とする

---

## 5. Realtime 通知設計

### 5-1. 基本方針

- 画面初期表示時に `snapshot` API を呼ぶ
- Supabase Realtime で `tournaments` テーブルの `revision` 変更を購読する
- `revision` の変更を検知したら `snapshot` API を再取得する
- WebSocket が切れたら SDK が自動再接続を試みる。失敗が続く場合は 3 秒ポーリングへフォールバックする

### 5-2. クライアント実装例

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// tournaments テーブルの revision 変更を購読
supabase
  .channel('board-updates')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'tournaments',
      filter: `tournament_id=eq.${tournamentId}`,
    },
    (payload) => {
      const newRevision = payload.new.revision
      if (newRevision > currentRevision) {
        // 0〜500ms のランダム遅延後に snapshot を再取得
        const jitter = Math.random() * 500
        setTimeout(() => fetchSnapshot(), jitter)
      }
    }
  )
  .subscribe()
```

---

## 6. 画面別に使う API の最小セット

### 6-1. 管理ダッシュボード

- `GET /api/admin/auth/me`
- `GET /api/admin/tournaments/{tournamentId}/dashboard`
- Supabase Realtime チャンネル（`tournaments` テーブル購読）
- `POST /api/admin/tournaments/{tournamentId}/matches/{matchId}/result/preview`
- `POST /api/admin/tournaments/{tournamentId}/matches/{matchId}/result`
- `POST /api/admin/tournaments/{tournamentId}/matches/{matchId}/rollback`
- `POST /api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/stop`
- `POST /api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/resume`
- `POST /api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/recalculate`
- `POST /api/admin/tournaments/{tournamentId}/courts/{courtNo}/actions/clear-current-match`

### 6-2. 初期設定・参加者管理画面

- `GET /api/admin/tournaments/{tournamentId}`
- `PATCH /api/admin/tournaments/{tournamentId}`
- `GET /api/admin/tournaments/{tournamentId}/teams`
- `POST /api/admin/tournaments/{tournamentId}/teams`
- `PATCH /api/admin/tournaments/{tournamentId}/teams/{teamId}`
- `DELETE /api/admin/tournaments/{tournamentId}/teams/{teamId}`
- `GET /api/admin/tournaments/{tournamentId}/entries`
- `POST /api/admin/tournaments/{tournamentId}/entries`
- `PATCH /api/admin/tournaments/{tournamentId}/entries/{entryId}`
- `POST /api/admin/tournaments/{tournamentId}/imports/entries/preview`
- `POST /api/admin/tournaments/{tournamentId}/imports/entries/commit`
- `POST /api/admin/tournaments/{tournamentId}/courts/{courtNo}/queue/entries`

### 6-3. 公開画面 / 本部モニター

- `GET /api/public/{publicToken}/snapshot`
- Supabase Realtime チャンネル（`tournaments` テーブル購読）

---

## 7. 実装メモ

### 7-1. トランザクション境界

以下は必ず DB トランザクション内で実行する。

- 試合結果確定
- 結果取り消し
- 手動移動
- 未所属エントリーの待機列追加
- 待機列並び替え
- コート停止 / 再開
- 現在対戦の手動解消
- エントリー状態変更に伴う待機列自動除外

### 7-2. 実装上の注意

- `courts.current_match_id` は、試合生成 / 結果確定 / ロールバック / 手動解消 / 再計算で必ず同一トランザクション内更新とする
- `queue_items` の一意制約を守るため、ロールバックや手動移動では「移動先から削除 → 移動元 / 追加先へ挿入」の順序を守る
- 待機列並び替えはトランザクション内で `DELETE + INSERT` もしくは一時退避を用いた全件再採番で実装する

### 7-3. 監査ログ対象

最低限、次を `audit_logs` に残す。

- ログイン / ログアウト（任意だが推奨）
- 大会設定更新
- 大会開始 / 終了 / 再開
- チーム作成 / 更新 / 削除
- CSV 取込確定
- 試合結果確定
- 結果取り消し
- 手動移動
- 未所属エントリー追加
- 待機列並び替え
- コート停止 / 再開
- 現在対戦の手動解消
- エントリー状態変更

### 7-4. API設計前提: URL構成とプロキシ

Supabase Edge Functions では関数名がURLパスに含まれる（例: `/functions/v1/admin-tournaments/...`）。
`er_api.md` §3-1 で定義した `/api/admin/...` パスは論理パスであり、実際のランタイムとは以下の方法で対応させる。

- **開発環境**: Vite の `server.proxy` で `/api/...` → `/functions/v1/...` にリライト
- **本番環境**: リバースプロキシ（Cloudflare Workers、Nginx 等）で同様にリライト

この設計により、フロントエンドは論理パス `/api/...` のみを意識し、ランタイム固有のパス構成を吸収する。

### 7-5. 次に作るとよいもの

- OpenAPI 3.1 YAML
- PostgreSQL DDL / マイグレーション
- 画面遷移図
- 状態遷移図（大会、コート、試合、エントリー）
