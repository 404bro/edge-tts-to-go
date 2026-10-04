"use strict";

// Messages shown by the main process (dialogs and errors passed to the page),
// in the UI language chosen in the page.

const MESSAGES = {
  zh: {
    saveTitle: "保存音频",
    HTTP_STATUS: "服务返回 HTTP {status}",
    VOICES_HTTP: "获取语音列表失败：HTTP {status}",
    RECEIVE_TIMEOUT: "接收超时",
    CONNECTION_CLOSED: "连接意外关闭",
    NO_AUDIO: "未收到音频，请检查语音和参数是否正确",
    UNEXPECTED_RESPONSE: "服务返回了无法识别的数据（{detail}）",
    INVALID_RATE: "语速无效",
    NOTHING_TO_EXPORT: "没有可导出的朗读内容",
    EXPORT_CANCELLED: "导出已取消",
    WRITE_DENIED: "不允许写入该路径",
  },
  en: {
    saveTitle: "Save audio",
    HTTP_STATUS: "The service returned HTTP {status}",
    VOICES_HTTP: "Failed to get the voice list: HTTP {status}",
    RECEIVE_TIMEOUT: "Timed out waiting for the service",
    CONNECTION_CLOSED: "The connection closed unexpectedly",
    NO_AUDIO: "No audio was received; check the voice and parameters",
    UNEXPECTED_RESPONSE: "Unrecognized data from the service ({detail})",
    INVALID_RATE: "Invalid speech rate",
    NOTHING_TO_EXPORT: "Nothing to export",
    EXPORT_CANCELLED: "Export cancelled",
    WRITE_DENIED: "Writing to this path is not allowed",
  },
};

let locale = "zh";

function setLocale(l) {
  if (MESSAGES[l]) locale = l;
}

function t(key, params = {}) {
  const s = MESSAGES[locale][key] ?? MESSAGES.zh[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? ""));
}

/** The message of `e` in the UI language (TtsError codes are translated). */
function errorMessage(e) {
  if (e && e.code && MESSAGES[locale][e.code] !== undefined) return t(e.code, e.params);
  return (e && e.message) || String(e);
}

module.exports = { setLocale, t, errorMessage };
