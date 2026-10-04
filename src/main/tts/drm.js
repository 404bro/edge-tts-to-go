"use strict";

// Part of edge-tts-to-go, licensed under the LGPLv3 (see LICENSE).
// Ported from edge-tts <https://github.com/rany2/edge-tts>,
// Copyright (C) rany and the edge-tts contributors, LGPLv3.

// Ported from edge_tts/drm.py: the Sec-MS-GEC token with clock skew correction.

const crypto = require("crypto");
const { TRUSTED_CLIENT_TOKEN } = require("./constants");

const WIN_EPOCH = 11644473600n;

let clockSkewSeconds = 0;

function unixTimestamp() {
  return Date.now() / 1000 + clockSkewSeconds;
}

/** Correct the clock from a server's RFC 2616 `Date` header. Returns false if unusable. */
function adjustClockFromDate(dateHeader) {
  const server = Date.parse(dateHeader || "");
  if (Number.isNaN(server)) return false;
  clockSkewSeconds += server / 1000 - unixTimestamp();
  return true;
}

/**
 * sha256 of (Windows file time rounded down to 5 minutes, in 100 ns ticks)
 * concatenated with the trusted client token, as uppercase hex.
 */
function generateSecMsGec() {
  let seconds = BigInt(Math.floor(unixTimestamp())) + WIN_EPOCH;
  seconds -= seconds % 300n;
  const ticks = seconds * 10000000n;
  return crypto
    .createHash("sha256")
    .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii")
    .digest("hex")
    .toUpperCase();
}

function generateMuid() {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

function headersWithMuid(headers) {
  return { ...headers, Cookie: `muid=${generateMuid()};` };
}

module.exports = { adjustClockFromDate, generateSecMsGec, headersWithMuid };
