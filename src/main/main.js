"use strict";

// Electron main process: the window, the synthesis engine and the IPC API
// used by the page (see src/preload/preload.js).

const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require("electron");
const fs = require("fs");
const path = require("path");
const { Engine } = require("./engine");
const { TtsError } = require("./tts/errors");
const i18n = require("./i18n");
const { version } = require("../../package.json");

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

let win = null;
const engine = new Engine((channel, ...args) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
});
// Paths the user picked in a save dialog; the page may only write to these.
const savePaths = new Set();

const THEMES = ["system", "light", "dark"];

function defaultLocale() {
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en";
}

function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function applyTheme(theme) {
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : "system";
}

function createWindow() {
  const settings = readSettings();
  applyTheme(settings.theme);
  i18n.setLocale(settings.locale || defaultLocale());
  win = new BrowserWindow({
    title: `edge-tts-to-go ${version}`,
    width: 960,
    height: 860,
    minWidth: 560,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#15171B" : "#F6F7F9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  // The window title is always the app name and version, not the page title.
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("closed", () => {
    win = null;
  });
}

const handlers = {
  voices: () => engine.listVoices(),
  speak: (id, text, voice, rate) => engine.start(id, String(text).trim(), String(voice), String(rate)),
  progress: (id, index) => engine.setCursor(id, Number(index)),
  stop: (id) => engine.stop(id),
  collectAll: (id) => engine.collectAll(id),

  async chooseSavePath(format, name) {
    const ext = format === "wav" ? "wav" : "mp3";
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: i18n.t("saveTitle"),
      defaultPath: path.join(app.getPath("music"), `${name || "tts"}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return null;
    savePaths.add(filePath);
    return filePath;
  },

  async writeFile(filePath, data) {
    if (!savePaths.has(filePath)) throw new TtsError("WRITE_DENIED", "Writing to this path is not allowed");
    await fs.promises.writeFile(filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  },

  loadSettings() {
    return { locale: defaultLocale(), theme: "system", ...readSettings() };
  },

  setLocale: (locale) => i18n.setLocale(String(locale)),
  setTheme: (theme) => applyTheme(String(theme)),

  saveSettings(settings) {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  },
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      throw new Error(i18n.errorMessage(e));
    }
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  engine.stop();
  app.quit();
});
