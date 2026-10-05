"use strict";

// Renders assets/icon.svg (and the pixel-aligned icon-small.svg and
// icon-24.svg for the smallest sizes) into src/main/icon.ico, used for the
// exe and the window, and assets/icon.png for previews. Runs inside Electron so that no image
// tools are needed:
//
//   npm run icon

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const ROOT = path.join(__dirname, "..");
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function svgDataUrl(file) {
  const svg = fs.readFileSync(path.join(ROOT, "assets", file));
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}

// Draws the SVG on a canvas of exactly size x size pixels and returns PNG
// data, independent of the display's scale factor.
async function render(win, url, size) {
  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = ${size};
        canvas.getContext("2d").drawImage(img, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("cannot load svg"));
      img.src = ${JSON.stringify(url)};
    })
  `);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// An ICO file whose entries are PNG images (supported since Windows Vista).
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("about:blank");
  const large = svgDataUrl("icon.svg");
  const small = svgDataUrl("icon-small.svg");
  const sources = { 16: small, 20: small, 24: svgDataUrl("icon-24.svg") };
  const images = [];
  for (const size of SIZES) {
    images.push({ size, png: await render(win, sources[size] || large, size) });
  }
  fs.writeFileSync(path.join(ROOT, "src", "main", "icon.ico"), encodeIco(images));
  fs.writeFileSync(path.join(ROOT, "assets", "icon.png"), await render(win, large, 512));
  console.log(`icon: ${SIZES.join(", ")} px -> src/main/icon.ico, assets/icon.png`);
  app.quit();
});
