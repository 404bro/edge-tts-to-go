# edge-tts-to-go

中文 | [English](README.md)

一个 Windows 桌面朗读软件，使用 Microsoft Edge 的在线语音合成服务，边合成边播放，
几乎可以立即开始收听。基于 Electron 开发，直接与服务通信，不需要 Python，
也不依赖 [edge-tts](https://github.com/rany2/edge-tts) 包。

## 功能

- **流式播放**：文本按句子分段，只提前合成正在收听位置之后的几段。
- **任意拖动**：进度条可以拖到尚未合成的位置，从预估的位置（该段内的对应比例处）
  继续合成播放；已合成的部分会缓存，回拖时立即播放。
- **点击任意分段**：已合成的段落立即播放；灰色（未合成）的段落会先合成，
  合成完成前保持灰色。
- **下载完整结果**：保存为一个 MP3 或 WAV 文件，保存前会（并行）补齐未合成的段落。
- 播放速度（播放端调速，即时生效，保持音调）和合成语速（合成端调速，
  朗读中锁定，点“停止”后可修改）。
- 300 多个语音，可按语言筛选。
- 亮色 / 暗色 / 跟随系统主题，中文 / 英文界面。
- 自动记住设置和文本。

## 下载

目前需要自行构建便携版 `.exe`（见下文），无需安装即可运行。暂时只支持 Windows 10/11。

## 开发

需要 [Node.js](https://nodejs.org/) 18 或更高版本。

```sh
npm install
npm start          # 运行软件
npm run smoke      # 命令行检查：列出语音，合成一句话到 out.mp3
npm run dist       # 构建便携版 .exe 到 dist/ 目录
```

### 目录结构

```
src/main/main.js          Electron 主进程：窗口、IPC、设置、保存对话框
src/main/engine.js        按请求调度分段合成并缓存
src/main/i18n.js          主进程的提示文字（对话框、错误）
src/main/tts/             协议：Sec-MS-GEC 令牌、WebSocket 合成、语音列表、分句
src/preload/preload.js    页面使用的 window.api 桥接
src/renderer/             界面：index.html、styles.css、renderer.js（播放器）、
                          i18n.js（界面文字）、wav.js（WAV 导出）
scripts/smoke.js          协议冒烟测试
```

### 工作原理

- **协议**（`src/main/tts/`）：从 edge-tts 中剥离出获取 MP3 音频所需的最小部分，
  用 JavaScript 重写：`Sec-MS-GEC` 令牌（遇到 HTTP 403 时按服务器时间校正时钟）、
  每段不超过 4096 字节的转义 SSML 文本使用一个 WebSocket 连接、语音列表。
  输出为 24 kHz 48 kbps 单声道 MP3。因为需要设置 `Origin`、`User-Agent`
  等 WebSocket 请求头，所以使用了 `ws` 包。
- **调度**（`engine.js`）：页面报告正在播放的分段，引擎保证该段及其后两段已合成；
  拖动会移动这个窗口。导出时用三个并行连接补齐所有未合成的段落。
- **播放**（`renderer.js`）：收到的音频按段保存。已合成段落的时长是精确的
  （恒定码率：字节数 × 8 / 48000），未合成的按语速估算，由此构成虚拟时间轴。
  audio 元素播放由连续分段组成的 MediaSource“链”；拖到链外时，从目标分段开始一条新链。
- **导出**：MP3 直接按顺序拼接各段；WAV 则用 Web Audio 解码后写成 16 位 PCM。

## 许可证

LGPL-3.0，见 [LICENSE](LICENSE)（其中引用的 GPLv3 全文见 [COPYING](COPYING)）。

`src/main/tts/` 中的协议代码移植自 [edge-tts](https://github.com/rany2/edge-tts)
（LGPLv3，作者 rany 及贡献者），界面基于其 `examples/desktop_app`，
因此本项目采用相同的许可证。本项目不包含、也不依赖 edge-tts 包本身。

## 免责声明

本项目为非官方项目，与 Microsoft 无关，也未获其认可。它使用的是未公开的在线服务，
随时可能变化或停止工作。请遵守 Microsoft 的服务条款。
