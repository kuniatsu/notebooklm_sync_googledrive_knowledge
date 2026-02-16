// ============================================================
// NotebookLM Auto-Sync Tool (GAS)
// ============================================================
// Googleドライブ上の指定フォルダにアップロードされたPDF/Markdownファイルを
// Googleドキュメント形式に自動変換し、NotebookLMとの同期を維持する。
// ============================================================

// 【必須】監視対象フォルダのID
const SOURCE_FOLDER_ID = 'ここにフォルダIDを貼り付けます';

// 【任意】出力フォルダ名、退避フォルダ名、ログファイル名
const OUTPUT_FOLDER_NAME = 'NotebookLM';
const PROCESSED_FOLDER_NAME = 'Processed';
const LOG_FILE_NAME = '同期ログ';

// ============================================================
// メイン関数: トリガーから呼び出される
// ============================================================
function autoSyncToNotebookLM() {
  const sourceFolder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
  const outputFolder = getOrCreateSubFolder(sourceFolder, OUTPUT_FOLDER_NAME);
  const processedFolder = getOrCreateSubFolder(sourceFolder, PROCESSED_FOLDER_NAME);

  const logEntries = [];

  // PDF ファイルの処理
  const pdfFiles = sourceFolder.getFilesByType(MimeType.PDF);
  while (pdfFiles.hasNext()) {
    const file = pdfFiles.next();
    try {
      const result = processFile(file, outputFolder, 'pdf');
      logEntries.push(result);
      file.moveTo(processedFolder);
    } catch (e) {
      Logger.log('PDF処理エラー: ' + file.getName() + ' - ' + e.message);
      logEntries.push({
        name: file.getName(),
        action: 'エラー',
        detail: e.message
      });
    }
  }

  // Markdown ファイルの処理
  const allFiles = sourceFolder.getFiles();
  while (allFiles.hasNext()) {
    const file = allFiles.next();
    const name = file.getName();
    if (!name.toLowerCase().endsWith('.md')) continue;

    try {
      const result = processFile(file, outputFolder, 'md');
      logEntries.push(result);
      file.moveTo(processedFolder);
    } catch (e) {
      Logger.log('Markdown処理エラー: ' + name + ' - ' + e.message);
      logEntries.push({
        name: name,
        action: 'エラー',
        detail: e.message
      });
    }
  }

  // 処理があった場合のみログを更新
  if (logEntries.length > 0) {
    updateSyncLog(outputFolder, logEntries);
  }
}

// ============================================================
// ファイル処理: PDF/Markdown → Googleドキュメント変換
// ============================================================
function processFile(file, outputFolder, fileType) {
  const originalName = file.getName();
  const baseName = originalName.replace(/\.(pdf|md)$/i, '');
  const fileId = file.getId();
  const shortId = fileId.substring(0, 8);
  const outputDocName = baseName + '_' + shortId;

  // 出力フォルダ内に同名ドキュメントがあるか検索
  const existingDoc = findExistingDoc(outputFolder, outputDocName);

  let content;
  if (fileType === 'pdf') {
    content = convertPdfToText(file);
  } else {
    content = file.getBlob().getDataAsString();
  }

  if (existingDoc) {
    // スマート更新: 中身だけを書き換えてIDを維持
    replaceDocContent(existingDoc, content, outputDocName);
    return {
      name: originalName,
      action: '更新',
      detail: outputDocName + ' の内容を上書き更新しました'
    };
  } else {
    // 新規作成
    createNewDoc(outputFolder, outputDocName, content);
    return {
      name: originalName,
      action: '新規作成',
      detail: outputDocName + ' を作成しました'
    };
  }
}

// ============================================================
// PDF → テキスト変換 (Drive API OCR)
// ============================================================
function convertPdfToText(pdfFile) {
  // Drive API v2 を使用してPDFをGoogleドキュメントに変換（OCR付き）
  const blob = pdfFile.getBlob();
  const resource = {
    title: pdfFile.getName().replace(/\.pdf$/i, '') + '_temp_ocr',
    mimeType: MimeType.GOOGLE_DOCS
  };

  // Drive API (Advanced Service) でOCR変換
  const ocrFile = Drive.Files.insert(resource, blob, {
    ocr: true,
    ocrLanguage: 'ja'
  });

  // 変換されたドキュメントからテキストを取得
  const tempDoc = DocumentApp.openById(ocrFile.id);
  const text = tempDoc.getBody().getText();

  // 一時ファイルを削除
  DriveApp.getFileById(ocrFile.id).setTrashed(true);

  return text;
}

// ============================================================
// 既存ドキュメントの検索
// ============================================================
function findExistingDoc(folder, docName) {
  const files = folder.getFilesByName(docName);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
      return file;
    }
  }
  return null;
}

// ============================================================
// スマート更新: ドキュメントの中身だけを書き換える（ID維持）
// ============================================================
function replaceDocContent(existingFile, newContent, docName) {
  const doc = DocumentApp.openById(existingFile.getId());
  const body = doc.getBody();

  // 全内容をクリアして新しい内容を書き込む
  body.clear();
  body.setText(newContent);
  doc.saveAndClose();
}

// ============================================================
// 新規Googleドキュメントの作成
// ============================================================
function createNewDoc(folder, docName, content) {
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();
  body.setText(content);
  doc.saveAndClose();

  // 作成されたファイルを出力フォルダに移動
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);

  return doc;
}

// ============================================================
// サブフォルダの取得または作成
// ============================================================
function getOrCreateSubFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

// ============================================================
// 同期ログの更新
// ============================================================
function updateSyncLog(outputFolder, logEntries) {
  const timestamp = Utilities.formatDate(
    new Date(),
    'Asia/Tokyo',
    'yyyy/MM/dd HH:mm:ss'
  );

  // ログドキュメントを取得または作成
  let logFile = findExistingDoc(outputFolder, LOG_FILE_NAME);
  let doc;

  if (logFile) {
    doc = DocumentApp.openById(logFile.getId());
  } else {
    doc = DocumentApp.create(LOG_FILE_NAME);
    doc.saveAndClose();
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(outputFolder);
    doc = DocumentApp.openById(doc.getId());
  }

  const body = doc.getBody();

  // ヘッダー行を追加
  const header = body.insertParagraph(0, '--- 同期実行: ' + timestamp + ' ---');
  header.setHeading(DocumentApp.ParagraphHeading.HEADING3);

  // 各ログエントリを追加
  for (let i = 0; i < logEntries.length; i++) {
    const entry = logEntries[i];
    const line = '[' + entry.action + '] ' + entry.name + ' → ' + entry.detail;
    body.insertParagraph(i + 1, line);
  }

  // 区切り行
  body.insertParagraph(logEntries.length + 1, '');

  doc.saveAndClose();
}
