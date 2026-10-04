"use strict";

const { synthesize } = require("./tts/communicate");
const { listVoices } = require("./tts/voices");
const { splitSegments } = require("./tts/segments");
const { TtsError } = require("./tts/errors");
const { errorMessage } = require("./i18n");

const RATE_RE = /^[+-]\d{1,3}%$/;
// How many segments may be synthesized ahead of the one playing. Keeping this
// small avoids synthesizing audio that a seek may make unnecessary.
const MAX_AHEAD = 2;
// Parallel connections used when synthesizing everything for an export.
const EXPORT_CONCURRENCY = 3;

/**
 * Synthesizes the segments of one request at a time. Audio is cached per
 * segment and streamed to the page as it arrives; segments are synthesized in
 * a small window starting at the `cursor` the page reports, so jumping ahead
 * moves synthesis there, and anything already synthesized is reused.
 */
class Engine {
  /** `send(channel, ...args)` delivers a message to the page. */
  constructor(send) {
    this.send = send;
    this.voices = null;
    this.session = null;
  }

  async listVoices() {
    if (!this.voices) {
      this.voices = (await listVoices()).map((v) => ({
        ShortName: v.ShortName,
        Locale: v.Locale,
        Gender: v.Gender,
        FriendlyName: v.FriendlyName,
      }));
    }
    return this.voices;
  }

  /** Cancel the previous request and start synthesizing `text`. */
  start(id, text, voice, rate) {
    this.stop();
    if (!RATE_RE.test(rate)) throw new TtsError("INVALID_RATE", "Invalid rate");
    const s = {
      id,
      voice,
      rate, // fixed for the whole request

      segments: splitSegments(text),
      done: [], // segments fully synthesized (their audio lives in the page)
      pending: new Map(),
      failed: new Set(),
      cursor: 0,
      abort: new AbortController(),
      wake: () => {},
    };
    this.session = s;
    this.send("tts:event", { type: "segments", id, segments: s.segments });
    this.run(s);
  }

  /** The page is now playing (or waiting for) segment `index`. */
  setCursor(id, index) {
    const s = this.current(id);
    if (!s || !(index >= 0 && index < s.segments.length)) return;
    s.cursor = index;
    s.failed.clear();
    s.wake();
  }

  /** Stop request `id` (any request when omitted). */
  stop(id) {
    const s = this.session;
    if (!s || (id !== undefined && id !== s.id)) return;
    s.abort.abort();
    s.wake();
    this.session = null;
  }

  /** Synthesize every segment not cached yet; resolves when all are done. */
  async collectAll(id) {
    const s = this.current(id);
    if (!s) throw new TtsError("NOTHING_TO_EXPORT", "Nothing to export");
    let next = 0;
    const worker = async () => {
      while (next < s.segments.length) await this.ensure(s, next++);
    };
    try {
      await Promise.all(Array.from({ length: EXPORT_CONCURRENCY }, worker));
    } finally {
      if (s.abort.signal.aborted) throw new TtsError("EXPORT_CANCELLED", "Export cancelled"); // eslint-disable-line no-unsafe-finally
    }
  }

  current(id) {
    return this.session && this.session.id === id ? this.session : null;
  }

  /** Synthesize segment `i` once, streaming it to the page. */
  ensure(s, i) {
    if (s.done[i]) return Promise.resolve();
    if (s.pending.has(i)) return s.pending.get(i);
    const p = (async () => {
      const { rate } = s;
      let bytes = 0;
      this.send("tts:event", { type: "segment_start", id: s.id, index: i, rate });
      await synthesize(s.segments[i], {
        voice: s.voice,
        rate,
        signal: s.abort.signal,
        onAudio: (data) => {
          bytes += data.length;
          this.send("tts:audio", s.id, i, data);
        },
      });
      s.done[i] = true;
      this.send("tts:event", { type: "segment_end", id: s.id, index: i, bytes });
    })();
    s.pending.set(i, p);
    p.catch((e) => {
      if (s.abort.signal.aborted) return;
      s.failed.add(i);
      this.send("tts:event", { type: "error", id: s.id, index: i, message: errorMessage(e) });
    }).finally(() => {
      s.pending.delete(i);
      s.wake();
    });
    return p;
  }

  /** Keep the segments in [cursor, cursor + MAX_AHEAD] synthesized, in order. */
  async run(s) {
    while (!s.abort.signal.aborted) {
      const wake = new Promise((resolve) => { s.wake = resolve; });
      const end = Math.min(s.segments.length, s.cursor + MAX_AHEAD + 1);
      let i = s.cursor;
      while (i < end && s.done[i]) i++;
      // A failed segment is retried only once the page moves the cursor.
      if (i < end && !s.failed.has(i)) {
        await Promise.race([this.ensure(s, i).catch(() => {}), wake]);
      } else {
        await wake;
      }
    }
  }
}

module.exports = { Engine };
