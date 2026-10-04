"use strict";

// Part of edge-tts-to-go, licensed under the LGPLv3 (see LICENSE).
// Ported from edge-tts <https://github.com/rany2/edge-tts>,
// Copyright (C) rany and the edge-tts contributors, LGPLv3.

const { VOICE_LIST, VOICE_HEADERS, SEC_MS_GEC_VERSION } = require("./constants");
const drm = require("./drm");
const { TtsError } = require("./errors");

async function fetchVoices() {
  const url = `${VOICE_LIST}&Sec-MS-GEC=${drm.generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const headers = drm.headersWithMuid(VOICE_HEADERS);
  // fetch() refuses to set these itself.
  delete headers.Authority;
  delete headers["Accept-Encoding"];
  return fetch(url, { headers });
}

/**
 * List all voices. On 403 correct the clock skew from the server date and
 * retry once; the service also returns the occasional 5xx, which is retried.
 */
async function listVoices() {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
    res = await fetchVoices();
    if (res.status === 403 && drm.adjustClockFromDate(res.headers.get("date"))) {
      res = await fetchVoices();
    }
    if (res.status < 500) break;
  }
  if (!res.ok) throw new TtsError("VOICES_HTTP", `Failed to get the voice list: HTTP ${res.status}`, { status: res.status });
  return res.json();
}

module.exports = { listVoices };
