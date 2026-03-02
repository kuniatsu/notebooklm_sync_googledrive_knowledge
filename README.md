# NotebookLM Auto-Sync Tool (GAS)

Googleドライブ上の指定フォルダにアップロードされた PDF / Markdown ファイルを、Googleドキュメント形式に自動変換し、NotebookLMとの同期を維持する Google Apps Script（GAS）ツールです。

---

## 目次

1. [背景と目的](#背景と目的)
2. [システム概要](#システム概要)
3. [機能一覧](#機能一覧)
4. [技術仕様](#技術仕様)
5. [フォルダ構成](#フォルダ構成)
6. [設定パラメータ](#設定パラメータ)
7. [関数リファレンス](#関数リファレンス)
8. [処理フロー](#処理フロー)
9. [利用開始ガイド](#利用開始ガイド)
10. [運用ルール（スタッフ向け）](#運用ルールスタッフ向け)
11. [トラブルシューティング](#トラブルシューティング)
12. [注意事項・制限](#注意事項制限)

---

## 背景と目的

NotebookLM は Google が提供する AI アシスタントであり、社内文書を「ソース」として読み込ませることで高精度な質問応答が可能になります。しかし、以下の課題があります。

- NotebookLM はローカルファイルや Google ドライブのファイルを **自動で監視・同期する機能を持たない**
- NotebookLM が直接読み込めるのは **Google ドキュメント形式** であり、PDF や Markdown をそのまま扱うには手動変換が必要
- ファイルを削除→再作成すると **NotebookLM 側のソース参照が切れてしまう**

本ツールは、スタッフが「特定のフォルダにファイルを放り込むだけ」で、裏側で自動的にファイルを Google ドキュメントに変換・管理し、NotebookLM との連携をシームレスに行うためのブリッジとして機能します。

---

## システム概要

| 項目 | 内容 |
|------|------|
| 実行環境 | Google Apps Script (GAS) |
| 言語 | JavaScript (ES6 / V8 ランタイム) |
| 必須サービス | Google Drive API v2（Advanced Service） |
| 利用 API | DriveApp, DocumentApp, Drive (Advanced), PropertiesService, Utilities |
| トリガー | 時間主導型（分ベースのタイマー） |
| 対象ファイル | `.pdf`, `.md` |
| 出力形式 | Google ドキュメント (`.gdoc`) |
| 状態管理 | ScriptProperties（処理済みファイルID の JSON） |

---

## 機能一覧

### 1. 自動変換・OCR 処理

監視フォルダ内の `.md` / `.pdf` ファイルを検知し、自動で Google ドキュメント形式に変換します。

- **Markdown**: `Blob.getDataAsString()` でテキストを取得し、Google ドキュメントに書き込み
- **PDF**: Google Drive API v2 の OCR 機能（`ocr: true`, `ocrLanguage: 'ja'`）でテキスト化

### 2. スマート更新（ID 維持）

同名のファイルが更新された場合、ファイルを削除→再作成するのではなく **「中身だけを最新版に書き換える」** 処理を行います。

- `DocumentApp.openById()` → `body.clear()` → `body.setText()` で内容を差し替え
- Google ドキュメントの **ファイル ID が変わらない** ため、NotebookLM 側のソース参照が維持される
- NotebookLM 上の **「同期」ボタンが正常に機能** する

### 3. トレーサビリティの確保（ファイル名への ID 付与）

変換後のファイル名の末尾に、元ファイルの Google Drive ID 先頭 8 文字を自動付与します。

```
元ファイル: 要件定義書.pdf (ID: 1A2B3C4DeFgHiJk...)
変換後:     要件定義書_1A2B3C4D (Googleドキュメント)
```

- 同名ファイルの衝突を防止
- 変換後ドキュメントから原本を特定可能

### 4. 同期ログの自動生成

処理完了後、出力フォルダ内に「同期ログ」ドキュメントを自動作成・更新します。

```
--- 同期実行: 2026/03/02 14:30:00 ---
[新規作成] 要件定義書.pdf → 要件定義書_1A2B3C4D を作成しました
[更新] 議事録.md → 議事録_5E6F7G8H の内容を上書き更新しました
```

- タイムスタンプ付きで処理内容を記録
- 処理があった場合のみログを追記（空ログは生成されない）

### 5. 重複処理の防止

処理済みファイルの ID を `ScriptProperties` に JSON 形式で記録し、同じファイルを二重変換しません。

- 元ファイルは元の場所にそのまま残る
- `resetProcessedIds()` を手動実行することで全ファイルを再処理可能

---

## 技術仕様

### 対応ファイル形式

| 形式 | MIME タイプ | 検出方法 | 変換方式 |
|------|-----------|---------|---------|
| PDF | `application/pdf` | `getFilesByType(MimeType.PDF)` | Drive API v2 OCR → テキスト抽出 |
| Markdown | — | ファイル名の末尾が `.md`（大小不問） | `Blob.getDataAsString()` で直接テキスト取得 |

### PDF 変換の仕組み

```
PDF ファイル
    ↓ Drive.Files.insert(resource, blob, {ocr: true, ocrLanguage: 'ja'})
一時 Google ドキュメント（OCR 済み）
    ↓ DocumentApp.openById() → getBody().getText()
テキスト文字列
    ↓ 一時ドキュメントをゴミ箱に移動
出力用 Google ドキュメントに書き込み
```

### 状態管理の仕組み

```
ScriptProperties
  └── "processedFileIds" : '{"fileId1": true, "fileId2": true, ...}'
```

- キー: Google Drive のファイル ID
- 値: `true`（処理済みフラグ）
- `resetProcessedIds()` でリセット可能

### ファイル命名規則

```
{拡張子を除いた元ファイル名}_{元ファイルIDの先頭8文字}
```

例: `設計書.pdf`（ID: `1A2B3C4DeFgH...`）→ `設計書_1A2B3C4D`

---

## フォルダ構成

本スクリプトを稼働させると、監視対象フォルダの中に自動的にサブフォルダが生成されます。

```
監視対象フォルダ (SOURCE_FOLDER_ID で指定)
 ├── 仕様書.pdf           ← 元ファイル（そのまま残る）
 ├── 議事録.md            ← 元ファイル（そのまま残る）
 │
 └── NoteBookLM/          ← 自動生成される出力フォルダ
      ├── 同期ログ              (処理履歴を記録する Google ドキュメント)
      ├── 仕様書_1A2B3C4D       (Google ドキュメント形式)
      └── 議事録_5E6F7G8H       (Google ドキュメント形式)
```

> **ポイント**: 元の `.md` / `.pdf` ファイルは移動・削除されません。変換された `.gdoc` だけが `NoteBookLM` フォルダに作成されます。

---

## 設定パラメータ

`Code.gs` の先頭で定義されている設定値です。

| 変数名 | デフォルト値 | 説明 |
|--------|------------|------|
| `SOURCE_FOLDER_ID` | `'1wyv8VKTKaQX2PkVOXQuwS0H9vo9ybO_f'` | 監視対象フォルダの Google Drive ID。利用者が自身のフォルダ ID に書き換える |
| `OUTPUT_FOLDER_NAME` | `'NoteBookLM'` | 出力先サブフォルダ名。監視フォルダ直下に自動作成される |
| `LOG_FILE_NAME` | `'同期ログ'` | ログ用 Google ドキュメントの名前 |
| `PROCESSED_KEY` | `'processedFileIds'` | ScriptProperties に保存する処理済み ID のキー名 |

### タイムゾーン設定

`updateSyncLog` 関数内でログのタイムスタンプに使用するタイムゾーンを指定しています。

```javascript
Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
```

| 拠点 | 値 |
|------|---|
| 日本 | `'Asia/Tokyo'` |
| ベトナム | `'Asia/Ho_Chi_Minh'` |

---

## 関数リファレンス

### メイン関数

| 関数名 | 説明 | トリガー対象 |
|--------|------|------------|
| `autoSyncToNotebookLM()` | メイン処理。PDF / Markdown の検出・変換・ログ記録を一括実行 | Yes |

### ユーティリティ関数

| 関数名 | 説明 | 手動実行 |
|--------|------|---------|
| `resetProcessedIds()` | 処理済みリストをリセット。次回実行時にすべてのファイルが再処理される | Yes |

### 内部関数

| 関数名 | 引数 | 説明 |
|--------|------|------|
| `getProcessedIds()` | — | ScriptProperties から処理済み ID の JSON を取得・パース |
| `saveProcessedIds(ids)` | `ids`: Object | 処理済み ID を ScriptProperties に JSON 保存 |
| `processFile(file, outputFolder, fileType)` | `file`: File, `outputFolder`: Folder, `fileType`: `'pdf'`\|`'md'` | 個別ファイルの変換処理。新規作成 or 既存更新を判定して実行 |
| `convertPdfToText(pdfFile)` | `pdfFile`: File | Drive API OCR で PDF をテキスト化。一時ドキュメントは自動削除 |
| `findExistingDoc(folder, docName)` | `folder`: Folder, `docName`: String | 指定フォルダ内の同名 Google ドキュメントを検索 |
| `replaceDocContent(existingFile, newContent, docName)` | `existingFile`: File, `newContent`: String, `docName`: String | 既存ドキュメントの中身を全置換（ID 維持） |
| `createNewDoc(folder, docName, content)` | `folder`: Folder, `docName`: String, `content`: String | 新規 Google ドキュメントを作成し出力フォルダに移動 |
| `getOrCreateSubFolder(parentFolder, folderName)` | `parentFolder`: Folder, `folderName`: String | サブフォルダを取得、なければ新規作成 |
| `updateSyncLog(outputFolder, logEntries)` | `outputFolder`: Folder, `logEntries`: Array | 同期ログドキュメントに処理結果を追記 |

---

## 処理フロー

```
autoSyncToNotebookLM()
│
├── 1. 監視フォルダを取得 (DriveApp.getFolderById)
├── 2. 出力フォルダを取得 or 作成 (getOrCreateSubFolder)
├── 3. 処理済みID一覧を取得 (getProcessedIds)
│
├── 4. PDF ファイルの処理ループ
│   └── 未処理の PDF ごとに:
│       ├── convertPdfToText() で OCR テキスト化
│       ├── findExistingDoc() で既存ドキュメントを検索
│       ├── 既存あり → replaceDocContent() で中身だけ更新
│       └── 既存なし → createNewDoc() で新規作成
│
├── 5. Markdown ファイルの処理ループ
│   └── 未処理の .md ごとに:
│       ├── Blob.getDataAsString() でテキスト取得
│       ├── findExistingDoc() で既存ドキュメントを検索
│       ├── 既存あり → replaceDocContent() で中身だけ更新
│       └── 既存なし → createNewDoc() で新規作成
│
├── 6. 処理済みIDを保存 (saveProcessedIds)
│
└── 7. 処理があった場合のみログを更新 (updateSyncLog)
```

---

## 利用開始ガイド

### Step 1. 監視フォルダの作成と ID の取得

1. ブラウザで **Google ドライブ**（https://drive.google.com/）を開く
2. **「+ 新規」** → **「新しいフォルダ」** でフォルダを作成（例: `AI同期フォルダ`）
3. 作成したフォルダをダブルクリックして開く
4. ブラウザのアドレスバーからフォルダ ID をコピーする

```
https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       ↑ この部分がフォルダID
```

> このIDを控えておいてください。Step 3 で使用します。

---

### Step 2. Google Apps Script プロジェクトの作成

1. **Google Apps Script**（https://script.google.com/）を開く
2. **「+ 新しいプロジェクト」** をクリック
3. 画面上部の **「無題のプロジェクト」** をクリック → `NotebookLM Auto-Sync` に変更 → **「名前を変更」**
4. エディタ中央の `function myFunction() { }` を **`Ctrl + A`** で全選択して削除
5. 本リポジトリの **`Code.gs`** の内容をすべてコピーして貼り付け
6. **`Ctrl + S`** で保存

---

### Step 3. スクリプトの初期設定（フォルダ ID の設定）

貼り付けたスクリプトの **9行目** にあるフォルダ ID を、Step 1 で控えた値に書き換えます。

```javascript
// 書き換え前
const SOURCE_FOLDER_ID = '1wyv8VKTKaQX2PkVOXQuwS0H9vo9ybO_f';

// 書き換え後（例）
const SOURCE_FOLDER_ID = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ';
```

その他の設定（出力フォルダ名・ログファイル名）は必要に応じて変更してください。通常はデフォルトのままで問題ありません。

```javascript
const OUTPUT_FOLDER_NAME = 'NoteBookLM';  // 出力先フォルダ名
const LOG_FILE_NAME = '同期ログ';           // ログドキュメント名
```

変更後、**`Ctrl + S`** で保存します。

---

### Step 4. Drive API サービスの追加

PDF の OCR 変換には **Drive API（Advanced Service）** が必要です。

1. GAS エディタの左サイドバーで **「サービス」** の横にある **「+」** をクリック
2. 一覧から **「Drive API」** を選択
   - バージョン: **v2**（デフォルト）
   - 識別子: **Drive**（デフォルト）
3. **「追加」** をクリック
4. 左サイドバーの「サービス」の下に **「Drive」** が追加されていれば成功

> Markdown のみ使用する場合でも、将来のために追加しておくことを推奨します。

---

### Step 5. 動作テスト（手動実行）

1. 監視対象フォルダにテスト用の `.pdf` または `.md` ファイルをアップロード
2. GAS エディタに戻り、ドロップダウンで **`autoSyncToNotebookLM`** を選択
3. **「▶ 実行」** をクリック

#### 初回実行時の承認フロー

初めて実行する場合、Google アカウントのアクセス承認が必要です。

1. **「承認が必要です」** → **「権限を確認」** をクリック
2. Google アカウントを選択
3. **「このアプリは確認されていません」** → **「詳細」** をクリック
4. **「〈プロジェクト名〉（安全ではないページ）に移動」** をクリック
5. 以下の権限を確認し **「許可」** をクリック
   - Google ドライブのすべてのファイルの参照、編集、作成、削除
   - Google ドキュメントのすべてのドキュメントの参照、編集、作成、削除

#### 実行結果の確認

1. エディタ下部の **「実行ログ」** に `実行完了` と表示されれば成功
2. Google ドライブの監視フォルダを開いて確認:
   - `NoteBookLM` フォルダが作成されている
   - その中に Google ドキュメント形式のファイルと「同期ログ」がある
   - 元の `.md` / `.pdf` ファイルは元の場所にそのまま残っている

---

### Step 6. トリガー（定期実行）の設定

手動テストが成功したら、定期実行のトリガーを設定します。

1. GAS エディタの左サイドバーで **時計アイコン（トリガー）** をクリック
2. **「+ トリガーを追加」** をクリック
3. 以下のように設定:

| 設定項目 | 値 |
|---------|---|
| 実行する関数を選択 | `autoSyncToNotebookLM` |
| 実行するデプロイを選択 | `Head` |
| イベントのソースを選択 | `時間主導型` |
| 時間ベースのトリガーのタイプを選択 | `分ベースのタイマー` |
| 時間の間隔を選択 | `1分おき` または `5分おき` |

4. **「保存」** をクリック

---

### Step 7. NotebookLM にソースを追加

1. **NotebookLM**（https://notebooklm.google.com/）を開く
2. ノートブックを作成または開く
3. **「ソース」** パネル → **「+ ソースを追加」** → **「Google ドライブ」** をクリック
4. `NoteBookLM` フォルダ内のファイルを選択して **「挿入」**

> **ファイル更新時の同期**: 元ファイルを更新→スクリプトが自動で Google ドキュメントの中身を書き換え→ NotebookLM 側でソースの **「同期」アイコン** をクリックすると最新内容が反映されます。

---

## 運用ルール（スタッフ向け）

| 操作 | 手順 |
|------|------|
| **ファイルの追加** | 監視対象フォルダに `.pdf` や `.md` をドロップするだけ。数分後に自動処理される |
| **ファイルの更新** | 同じファイル名で親フォルダに再アップロード。自動検知されて NotebookLM 側のデータが上書き更新される |
| **即時反映** | GAS エディタから `autoSyncToNotebookLM` を手動実行 |
| **全ファイル再処理** | GAS エディタから `resetProcessedIds` を手動実行した後、`autoSyncToNotebookLM` を実行 |
| **処理状況の確認** | `NoteBookLM` フォルダ内の「同期ログ」ドキュメントを確認 |

---

## トラブルシューティング

### `Drive is not defined` エラー

**原因**: Drive API（Advanced Service）が追加されていない

**対処**: [Step 4](#step-4-drive-api-サービスの追加) を実施して Drive API を追加する

### `フォルダが見つかりません` エラー

**原因**: `SOURCE_FOLDER_ID` が正しくない、またはフォルダが削除されている

**対処**: Google ドライブでフォルダを開き、アドレスバーから正しい ID をコピーして `Code.gs` に設定する

### 同じファイルが何度も処理される

**原因**: ScriptProperties がリセットされた可能性

**対処**: 通常は自動的に処理済み ID が記録されるため問題ないが、`resetProcessedIds()` を意図せず実行していないか確認する

### PDF の OCR 結果が不正確

**原因**: Google Drive OCR の精度に依存。低解像度の画像 PDF では精度が落ちる

**対処**:
- 可能であればテキスト埋め込み PDF を使用する
- スキャン時の解像度を上げる（300dpi 以上推奨）

### トリガーが動作しない

**対処**:
1. GAS エディタの左サイドバー → トリガー一覧を確認
2. トリガーにエラーマークがついていないか確認
3. エラーがある場合はトリガーを削除して再作成

### NotebookLM でファイルが更新されない

**対処**: NotebookLM のソースパネルで対象ファイルの **「同期」アイコン** をクリックする。自動では反映されないため手動操作が必要。

---

## 注意事項・制限

- **OCR の精度**: PDF のテキスト化は Google Drive の標準 OCR に依存します。画像ベースの PDF で文字認識精度が低い場合があります
- **OCR 言語**: デフォルトは日本語（`ja`）です。他言語の PDF を扱う場合は `convertPdfToText` 関数内の `ocrLanguage` を変更してください
- **サブフォルダ非対応**: 監視対象フォルダ直下のファイルのみ処理されます。サブフォルダ内のファイルは対象外です
- **GAS の実行制限**: Google Apps Script には [1回の実行で6分](https://developers.google.com/apps-script/guides/services/quotas)の制限があります。大量のファイルを一度に処理する場合はご注意ください
- **Markdown の書式**: Markdown は書式を解釈せずプレーンテキストとして Google ドキュメントに書き込まれます
- **NotebookLM の同期**: NotebookLM 側での同期は手動操作（同期アイコンのクリック）が必要です。Google ドキュメントの更新が自動でNotebookLMに反映されるわけではありません
