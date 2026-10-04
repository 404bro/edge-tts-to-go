"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (name) => (...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld("api", {
  voices: invoke("voices"),
  speak: invoke("speak"),
  progress: invoke("progress"),
  stop: invoke("stop"),
  collectAll: invoke("collectAll"),
  chooseSavePath: invoke("chooseSavePath"),
  writeFile: invoke("writeFile"),
  loadSettings: invoke("loadSettings"),
  saveSettings: invoke("saveSettings"),
  setLocale: invoke("setLocale"),
  setTheme: invoke("setTheme"),
  /** cb(msg) for {type: segments | segment_start | segment_end | error, id, ...}. */
  onEvent: (cb) => ipcRenderer.on("tts:event", (_e, msg) => cb(msg)),
  /** cb(id, index, Uint8Array) for each MP3 chunk of a segment. */
  onAudio: (cb) => ipcRenderer.on("tts:audio", (_e, id, index, data) => cb(id, index, data)),
});
