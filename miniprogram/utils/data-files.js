const GENERATED_FILE_PATTERN = /^(?:yongdu-backup-\d{8}-\d{6}\.json|yongdu-transactions-\d{8}-\d{6}\.csv)$/;

function callbackPromise(register, failureMessage) {
  return new Promise((resolve, reject) => register({
    success: resolve,
    fail: (error) => reject(new Error(`${failureMessage}：${error?.errMsg || '平台操作失败'}`)),
  }));
}

function isCancel(error) {
  return /cancel/i.test(String(error?.message || error || ''));
}

function joinUserPath(root, filename) {
  if (!GENERATED_FILE_PATTERN.test(filename)) throw new Error('生成文件名不合法');
  return `${root}/${filename}`;
}

function assertSupported(value, message) {
  if (typeof value !== 'function') throw new Error(message);
}

function byteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function createDataFiles(wxApi) {
  const root = wxApi?.env?.USER_DATA_PATH;
  const fs = typeof wxApi?.getFileSystemManager === 'function' ? wxApi.getFileSystemManager() : null;

  async function writeGeneratedFile(file) {
    if (!root || !fs) throw new Error('当前微信环境不支持本地文件，请使用手动复制');
    assertSupported(fs.writeFile, '当前微信环境不支持写入文件，请使用手动复制');
    const filePath = joinUserPath(root, file.filename);
    await callbackPromise((handlers) => fs.writeFile({
      filePath,
      data: file.content,
      encoding: 'utf8',
      ...handlers,
    }), '本地文件写入失败');
    return { ...file, filePath };
  }

  async function chooseBackupText(maxBytes) {
    assertSupported(wxApi?.chooseMessageFile, '当前微信环境不支持选择文件，请粘贴 JSON 文本');
    try {
      const result = await callbackPromise((handlers) => wxApi.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json'],
        ...handlers,
      }), '文件选择失败');
      const file = result.tempFiles?.[0];
      if (!file) throw new Error('未选择备份文件');
      if (!/\.json$/i.test(String(file.name || file.path || ''))) throw new Error('只支持选择一个 JSON 文件');
      if (!fs) throw new Error('当前微信环境不支持读取文件，请粘贴 JSON 文本');
      assertSupported(fs.readFile, '当前微信环境不支持读取文件，请粘贴 JSON 文本');
      let sizeBeforeRead = Number.isFinite(file.size) ? file.size : null;
      if (sizeBeforeRead === null) {
        assertSupported(fs.stat, '当前微信环境无法在读取前检查文件大小，请粘贴 JSON 文本');
        const stat = await callbackPromise((handlers) => fs.stat({ path: file.path, ...handlers }), '读取文件大小失败');
        sizeBeforeRead = stat.stats?.size;
      }
      if (!Number.isFinite(sizeBeforeRead)) throw new Error('无法在读取前确认文件大小，请粘贴 JSON 文本');
      if (sizeBeforeRead > maxBytes) throw new Error('文件超过 5 MiB 限制');
      const read = await callbackPromise((handlers) => fs.readFile({
        filePath: file.path,
        encoding: 'utf8',
        ...handlers,
      }), 'JSON 文件读取失败');
      const text = String(read.data);
      if (byteLength(text) > maxBytes) throw new Error('读取后的内容超过 5 MiB 限制');
      return { ok: true, fileName: file.name || '选择的备份.json', sizeBytes: byteLength(text), text };
    } catch (error) {
      if (isCancel(error)) return { ok: false, cancelled: true };
      throw error;
    }
  }

  async function shareFile(filePath) {
    assertSupported(wxApi?.shareFileMessage, '当前微信环境不支持文件分享，请使用手动复制');
    return callbackPromise((handlers) => wxApi.shareFileMessage({ filePath, ...handlers }), '文件分享失败');
  }

  async function copyText(text) {
    assertSupported(wxApi?.setClipboardData, '当前微信环境不支持复制，请长按文本手动复制');
    return callbackPromise((handlers) => wxApi.setClipboardData({ data: text, ...handlers }), '复制失败');
  }

  async function removeGeneratedFiles() {
    if (!root || !fs) throw new Error('当前微信环境不支持清理生成文件');
    assertSupported(fs.readdir, '当前微信环境不支持列出生成文件');
    assertSupported(fs.unlink, '当前微信环境不支持删除生成文件');
    const listed = await callbackPromise((handlers) => fs.readdir({ dirPath: root, ...handlers }), '生成文件列表读取失败');
    const names = (listed.files || []).filter((name) => GENERATED_FILE_PATTERN.test(name));
    for (const name of names) {
      await callbackPromise((handlers) => fs.unlink({ filePath: joinUserPath(root, name), ...handlers }), '生成文件删除失败');
    }
    return names;
  }

  return {
    writeGeneratedFile,
    chooseBackupText,
    shareFile,
    copyText,
    removeGeneratedFiles,
  };
}

module.exports = { createDataFiles, GENERATED_FILE_PATTERN };
