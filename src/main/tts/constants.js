"use strict";

// Part of edge-tts-to-go, licensed under the LGPLv3 (see LICENSE).
// Ported from edge-tts <https://github.com/rany2/edge-tts>,
// Copyright (C) rany and the edge-tts contributors, LGPLv3.

// Ported from edge_tts/constants.py.

const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const VOICE_LIST = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
    ` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36` +
    ` Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};
const WSS_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  ...BASE_HEADERS,
};
const VOICE_HEADERS = {
  Authority: "speech.platform.bing.com",
  "Sec-CH-UA":
    `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}",` +
    ` "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
  "Sec-CH-UA-Mobile": "?0",
  Accept: "*/*",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  ...BASE_HEADERS,
};

// audio-24khz-48kbitrate-mono-mp3 is a 48 kbps constant bitrate stream, so
// duration = bytes * 8 / 48000.
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const MP3_BITRATE_BPS = 48000;

module.exports = {
  WSS_URL,
  VOICE_LIST,
  TRUSTED_CLIENT_TOKEN,
  SEC_MS_GEC_VERSION,
  WSS_HEADERS,
  VOICE_HEADERS,
  OUTPUT_FORMAT,
  MP3_BITRATE_BPS,
};
