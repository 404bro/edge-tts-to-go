"use strict";

// Part of edge-tts-to-go, licensed under the LGPLv3 (see LICENSE).
// Ported from edge-tts <https://github.com/rany2/edge-tts>,
// Copyright (C) rany and the edge-tts contributors, LGPLv3.

// The minimal part of edge_tts/communicate.py needed to synthesize MP3 audio:
// one WebSocket per <=4096-byte chunk of escaped text, audio only (no
// word/sentence boundary metadata).

const crypto = require("crypto");
const WebSocket = require("ws");
const {
  WSS_URL,
  WSS_HEADERS,
  SEC_MS_GEC_VERSION,
  OUTPUT_FORMAT,
} = require("./constants");
const drm = require("./drm");
const { TtsError } = require("./errors");

const MAX_CHUNK_BYTES = 4096;
const CONNECT_TIMEOUT_MS = 10000;
const RECEIVE_TIMEOUT_MS = 60000;

function connectId() {
  return crypto.randomUUID().replace(/-/g, "");
}

/** The service rejects a few control characters (e.g. vertical tab from OCR-ed PDFs). */
function removeIncompatibleCharacters(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ");
}

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Split UTF-8 text into chunks of at most `limit` bytes, preferring newlines,
 * then spaces, never splitting a multi-byte character or an XML entity.
 */
function splitTextByByteLength(text, limit = MAX_CHUNK_BYTES) {
  let buf = Buffer.from(text, "utf8");
  const chunks = [];
  while (buf.length > limit) {
    let splitAt = buf.lastIndexOf(0x0a, limit - 1);
    if (splitAt < 0) splitAt = buf.lastIndexOf(0x20, limit - 1);
    if (splitAt < 0) {
      // No whitespace: back off to the start of a UTF-8 character.
      splitAt = limit;
      while (splitAt > 0 && (buf[splitAt] & 0xc0) === 0x80) splitAt--;
    }
    // Don't cut inside an unterminated entity such as "&amp;".
    while (splitAt > 0) {
      const amp = buf.lastIndexOf(0x26, splitAt - 1);
      if (amp < 0) break;
      const semi = buf.indexOf(0x3b, amp);
      if (semi !== -1 && semi < splitAt) break;
      splitAt = amp;
    }
    const chunk = buf.subarray(0, splitAt).toString("utf8").trim();
    if (chunk) chunks.push(chunk);
    buf = buf.subarray(splitAt > 0 ? splitAt : 1);
  }
  const rest = buf.toString("utf8").trim();
  if (rest) chunks.push(rest);
  return chunks;
}

function dateToString() {
  // Javascript-style date string in UTC, as the Edge client sends it.
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function mkssml(voice, rate, escapedText) {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${rate}' volume='+0%'>` +
    escapedText +
    "</prosody></voice></speak>"
  );
}

function configMessage() {
  return (
    `X-Timestamp:${dateToString()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`
  );
}

function ssmlMessage(ssml) {
  return (
    `X-RequestId:${connectId()}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${dateToString()}Z\r\n` + // This is not a mistake, Microsoft Edge bug.
    "Path:ssml\r\n\r\n" +
    ssml
  );
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1);
  }
  return headers;
}

function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

class HttpStatusError extends TtsError {
  constructor(status, date) {
    super("HTTP_STATUS", `The service returned HTTP ${status}`, { status });
    this.status = status;
    this.date = date;
  }
}

function unexpected(detail) {
  return new TtsError("UNEXPECTED_RESPONSE", `Unexpected response: ${detail}`, { detail });
}

/** Synthesize one chunk over a fresh WebSocket. Resolves when the turn ends. */
function streamChunk(escapedText, voice, rate, onAudio, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const url =
      `${WSS_URL}&ConnectionId=${connectId()}` +
      `&Sec-MS-GEC=${drm.generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const ws = new WebSocket(url, {
      headers: drm.headersWithMuid(WSS_HEADERS),
      perMessageDeflate: true,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
    });
    let gotAudio = false;
    let settled = false;
    let idle = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      if (signal) signal.removeEventListener("abort", onAbort);
      try { ws.terminate(); } catch { /* ignore */ }
      if (err) reject(err); else resolve();
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new TtsError("RECEIVE_TIMEOUT", "Receive timed out")), RECEIVE_TIMEOUT_MS);
    };
    const onAbort = () => finish(abortError());
    if (signal) signal.addEventListener("abort", onAbort);

    ws.on("unexpected-response", (_req, res) => {
      finish(new HttpStatusError(res.statusCode, res.headers.date));
    });
    ws.on("error", (e) => finish(e));
    ws.on("close", () => finish(new TtsError("CONNECTION_CLOSED", "Connection closed unexpectedly")));
    ws.on("open", () => {
      touch();
      ws.send(configMessage());
      ws.send(ssmlMessage(mkssml(voice, rate, escapedText)));
    });
    ws.on("message", (data, isBinary) => {
      touch();
      if (!isBinary) {
        const text = data.toString("utf8");
        const sep = text.indexOf("\r\n\r\n");
        const path = parseHeaders(sep >= 0 ? text.slice(0, sep) : text).Path;
        if (path === "turn.end") {
          finish(gotAudio ? null : new TtsError("NO_AUDIO", "No audio was received"));
        }
        return; // turn.start, response, audio.metadata
      }
      if (data.length < 2) return finish(unexpected("binary message without header length"));
      const headerLength = data.readUInt16BE(0);
      if (headerLength + 2 > data.length) return finish(unexpected("invalid binary header length"));
      const headers = parseHeaders(data.subarray(2, 2 + headerLength).toString("utf8"));
      const audio = data.subarray(2 + headerLength);
      if (headers.Path !== "audio") return finish(unexpected("binary message is not audio"));
      if (headers["Content-Type"] === undefined) {
        // End-of-stream marker; must be empty.
        if (audio.length) finish(unexpected("untyped audio message with data"));
        return;
      }
      if (headers["Content-Type"] !== "audio/mpeg") return finish(unexpected("unexpected audio Content-Type"));
      if (!audio.length) return;
      gotAudio = true;
      onAudio(Buffer.from(audio));
    });
  });
}

/**
 * Synthesize `text` to MP3, calling `onAudio(Buffer)` as data arrives.
 * `rate` is like "+10%". Rejects with an AbortError when `signal` aborts.
 */
async function synthesize(text, { voice, rate = "+0%", signal, onAudio }) {
  const chunks = splitTextByByteLength(escapeXml(removeIncompatibleCharacters(text)));
  for (const chunk of chunks) {
    try {
      await streamChunk(chunk, voice, rate, onAudio, signal);
    } catch (e) {
      if (!(e instanceof HttpStatusError && e.status === 403 && drm.adjustClockFromDate(e.date))) throw e;
      await streamChunk(chunk, voice, rate, onAudio, signal);
    }
  }
}

module.exports = { synthesize, splitTextByByteLength };
