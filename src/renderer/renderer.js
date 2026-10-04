/* global encodeWav, I18N */
(() => {
  "use strict";

  const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
  // Rough speaking time per character, used to estimate the length of
  // segments until some have been synthesized.
  const GUESS_SECONDS_PER_CHAR = 0.22;
  // The audio is 48 kbps constant bitrate MP3.
  const BYTES_PER_SECOND = 48000 / 8;
  // Segments appended to the media buffer ahead of the one playing.
  const APPEND_AHEAD = 6;

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const api = window.api;
  const ui = {
    theme: $("theme"), uiLang: $("uiLang"),
    text: $("text"), lang: $("lang"), voice: $("voice"),
    playRate: $("playRate"), playRateOut: $("playRateOut"),
    synthRate: $("synthRate"), synthRateOut: $("synthRateOut"),
    playBtn: $("playBtn"), pauseBtn: $("pauseBtn"), stopBtn: $("stopBtn"),
    mp3Btn: $("mp3Btn"), wavBtn: $("wavBtn"),
    status: $("status"), segments: $("segments"),
    seek: $("seek"), seekBuf: $("seekBuf"), seekPlayed: $("seekPlayed"), seekThumb: $("seekThumb"),
    timeCur: $("timeCur"), timeTotal: $("timeTotal"),
  };

  // ---------- settings ----------
  let settings = {};
  let saveTimer = 0;
  function saveSetting(key, value) {
    settings[key] = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.saveSettings(settings), 400);
  }

  // ---------- i18n ----------
  let locale = "zh";
  let statusMsg = ["starting", {}, false]; // [key, params, isError], re-rendered on language change

  /** Translate `key`, filling `{name}` placeholders from `params`. */
  function t(key, params = {}) {
    const s = (I18N[locale] && I18N[locale][key]) ?? I18N.zh[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? ""));
  }

  /** Re-render every translated string in the page. */
  function applyLocale() {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = t("appTitle");
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
    for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
      el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    }
    ui.segments.dataset.empty = t("segmentsEmpty");
    setState(state);
    setStatus(...statusMsg);
    if (voices.length) { renderLangs(); renderVoices(); }
  }

  function setLocale(l) {
    if (!I18N[l]) return;
    // Swap the sample text along with the language, unless the user edited it.
    const sample = ui.text.value === t("sample");
    locale = l;
    ui.uiLang.value = l;
    if (sample) ui.text.value = t("sample");
    applyLocale();
    api.setLocale(l).catch(() => {});
  }

  function setTheme(theme) {
    ui.theme.value = theme;
    api.setTheme(theme).catch(() => {});
  }

  // ---------- state ----------
  let state = "idle";          // idle | playing | paused | finished (played to the end)
  let started = false;         // a request has been started before (label: 重新合成)
  let reqId = 0;               // id of the current speak request
  let sessionText = "";        // text of the current request
  let startIndex = 0;          // segment to start playing from once segments arrive
  // Per segment: {text, parts: Uint8Array[], bytes, complete, li}. All audio
  // received is kept here, so any synthesized part can be replayed/exported.
  let segs = [];
  // The audio element plays a "chain": one MediaSource holding segments
  // first, first+1, ... appended in order. Seeking outside of it starts a new
  // chain at the target segment.
  let chain = null;
  let pendingSeek = null;      // {index, frac}: waiting for that segment's audio
  let current = -1;            // segment being heard
  let dragging = false, dragTime = 0;
  let exporting = false;

  // ---------- helpers ----------
  /** Show the status message `key` (see i18n.js). */
  function setStatus(key, params = {}, err = false) {
    statusMsg = [key, params, err];
    ui.status.textContent = t(key, params);
    ui.status.classList.toggle("err", err);
  }

  // 朗读/重新合成 is always usable; while a request is running it resets and
  // starts over. 暂停/继续 and 停止 only work while a request is running, and
  // after finishing the pause button replays from the start.
  function setState(s) {
    state = s;
    if (s !== "idle") started = true;
    const canStart = s === "idle" || s === "finished";
    ui.playBtn.textContent = t(started ? "resynth" : "play");
    ui.pauseBtn.disabled = s === "idle";
    ui.pauseBtn.textContent = t({ paused: "resume", finished: "replay" }[s] || "pause");
    ui.stopBtn.disabled = canStart;
    // The synthesis rate and voice are fixed for a request; they can be
    // changed after 停止 or once playback has finished.
    ui.synthRate.disabled = ui.lang.disabled = ui.voice.disabled = !canStart;
  }

  function rateStr() {
    const v = Number(ui.synthRate.value);
    return (v >= 0 ? "+" : "") + v + "%";
  }

  function errText(e) {
    const msg = (e && e.message) || String(e);
    return msg.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
  }

  function fmtTime(t) {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  function concatBytes(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  }

  // ---------- virtual timeline ----------
  // Synthesized segments have an exact length; the others are estimated from
  // the speaking speed of the synthesized ones.
  function timeline() {
    let sec = 0, chars = 0;
    for (const s of segs) {
      if (s.complete) { sec += s.bytes / BYTES_PER_SECOND; chars += s.text.length; }
    }
    const perChar = chars ? sec / chars : GUESS_SECONDS_PER_CHAR;
    const d = [], start = [];
    let total = 0;
    segs.forEach((s, i) => {
      const got = s.bytes / BYTES_PER_SECOND;
      d[i] = s.complete ? got : Math.max(s.text.length * perChar, got);
      start[i] = total;
      total += d[i];
    });
    return { d, start, total };
  }

  function allComplete() {
    return segs.length > 0 && segs.every((s) => s.complete);
  }

  /** Map a virtual time to {index, frac} (fraction into that segment). */
  function locate(t, tl) {
    const n = segs.length;
    t = Math.max(0, Math.min(t, tl.total));
    let i = n - 1;
    for (let k = 0; k < n; k++) {
      if (t < tl.start[k] + tl.d[k]) { i = k; break; }
    }
    const frac = tl.d[i] ? (t - tl.start[i]) / tl.d[i] : 0;
    return { index: i, frac: Math.min(Math.max(frac, 0), 0.999) };
  }

  /** Segment of the chain at the audio element's current time. */
  function playingIndex() {
    if (!chain) return -1;
    const t = audio.currentTime;
    let idx = -1;
    chain.mseStart.forEach((start, i) => { if (start <= t + 0.05) idx = i; });
    return idx;
  }

  function virtualTime(tl) {
    if (pendingSeek) return tl.start[pendingSeek.index] + pendingSeek.frac * tl.d[pendingSeek.index];
    if (!chain) return current >= 0 ? tl.start[current] : 0;
    const i = playingIndex();
    if (i < 0) return tl.start[chain.first] || 0;
    return tl.start[i] + Math.min(Math.max(audio.currentTime - chain.mseStart[i], 0), tl.d[i]);
  }

  // ---------- media chain ----------
  function openChain(first) {
    closeChain();
    const c = {
      first,
      next: first,             // segment being appended
      partIdx: 0,              // parts of `next` already appended
      mseStart: [],            // media time where each appended segment starts
      ended: false,
      ms: new MediaSource(),
      sb: null,
      url: null,
    };
    c.url = URL.createObjectURL(c.ms);
    c.ms.addEventListener("sourceopen", () => {
      if (chain !== c) return;
      c.sb = c.ms.addSourceBuffer("audio/mpeg");
      c.sb.mode = "sequence";
      c.sb.addEventListener("updateend", pump);
      pump();
    }, { once: true });
    chain = c;
    audio.src = c.url;
    applyPlayRate();
  }

  function closeChain() {
    if (!chain) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(chain.url);
    chain = null;
  }

  function ranges(c) {
    try { return c && c.sb ? c.sb.buffered : null; } catch { return null; }
  }

  function bufEnd(c) {
    const b = ranges(c);
    return b && b.length ? b.end(b.length - 1) : 0;
  }

  function isBuffered(c, t) {
    const b = ranges(c);
    if (!b) return false;
    for (let k = 0; k < b.length; k++) if (b.start(k) <= t && t < b.end(k)) return true;
    return false;
  }

  /** Append whatever audio the chain can take next. */
  function pump() {
    const c = chain;
    if (!c || !c.sb || c.sb.updating || c.ms.readyState !== "open") return;
    const limit = Math.max(current, c.first) + APPEND_AHEAD;
    while (c.next < segs.length && c.next <= limit) {
      const s = segs[c.next];
      if (c.partIdx < s.parts.length) {
        if (c.mseStart[c.next] === undefined) c.mseStart[c.next] = bufEnd(c);
        try {
          c.sb.appendBuffer(concatBytes(s.parts.slice(c.partIdx)));
          c.partIdx = s.parts.length;
        } catch {
          // QuotaExceeded: drop audio already played; retried on updateend
          // (or the next timeupdate).
          const b = ranges(c);
          if (b && b.length && b.start(0) < audio.currentTime - 30) c.sb.remove(0, audio.currentTime - 20);
        }
        return; // wait for updateend
      }
      if (!s.complete) break;
      if (c.mseStart[c.next] === undefined) c.mseStart[c.next] = bufEnd(c);
      c.next++;
      c.partIdx = 0;
    }
    applyPendingSeek();
    if (c.next >= segs.length && !c.ended) {
      c.ended = true;
      try { c.ms.endOfStream(); } catch { /* ignore */ }
    }
  }

  /** Jump into the target segment once enough of it is buffered. */
  function applyPendingSeek() {
    const p = pendingSeek, c = chain;
    if (!p || !c || c.first !== p.index) return;
    const start = c.mseStart[p.index];
    if (start === undefined) return;
    const s = segs[p.index];
    let target;
    if (s.complete) {
      if (c.next <= p.index) return; // not fully appended yet
      target = start + p.frac * s.bytes / BYTES_PER_SECOND;
    } else {
      // Use the estimated length until the segment is complete.
      target = start + p.frac * timeline().d[p.index];
      if (bufEnd(c) < target + 0.3) return;
    }
    pendingSeek = null;
    audio.currentTime = target;
    if (state === "playing") {
      audio.play().catch(() => {});
      setStatus("reading", { i: p.index + 1, n: segs.length });
    } else {
      setStatus("paused");
    }
    trackPosition();
  }

  /** Start a new chain at segment i, `frac` of the way into it. */
  function restartAt(i, frac) {
    pendingSeek = { index: i, frac };
    openChain(i);
    setCurrent(i);
    setStatus(segs[i].complete ? "seeking" : "synthFrom", { i: i + 1 });
    pump();
  }

  function seekTo(i, frac) {
    const c = chain;
    if (c && !pendingSeek && c.mseStart[i] !== undefined) {
      const tl = timeline();
      const target = c.mseStart[i] + frac * tl.d[i];
      const ready = segs[i].complete ? c.next > i : target < bufEnd(c) - 0.3;
      if (ready && isBuffered(c, target)) {
        if (audio.ended && state === "playing") audio.play().catch(() => {});
        audio.currentTime = target;
        trackPosition();
        return;
      }
    }
    if (pendingSeek && pendingSeek.index === i) { pendingSeek.frac = frac; pump(); return; }
    restartAt(i, frac);
  }

  function seekVirtual(t) {
    if (state === "idle" || !segs.length) return;
    resumeIfFinished();
    const tl = timeline();
    const { index, frac } = locate(t, tl);
    seekTo(index, frac);
  }

  function trackPosition() {
    if (state === "idle" || pendingSeek) return;
    const i = playingIndex();
    if (i >= 0 && i !== current) setCurrent(i);
    pump();
  }

  // ---------- events from the main process ----------
  api.onAudio((id, index, data) => {
    const s = segs[index];
    if (id !== reqId || !s) return;
    s.parts.push(data);
    s.bytes += data.byteLength;
    pump();
  });

  api.onEvent((msg) => {
    if (msg.id !== reqId) return;
    const s = segs[msg.index];
    switch (msg.type) {
      case "segments":
        renderSegments(msg.segments);
        if (state === "playing" && segs.length) restartAt(Math.min(startIndex, segs.length - 1), 0);
        break;
      case "segment_start":
        if (s && !s.complete && s.parts.length) {
          // Retrying after a failure: drop the partial audio.
          s.parts = [];
          s.bytes = 0;
          if (chain && chain.first <= msg.index && msg.index <= chain.next) {
            const tl = timeline();
            const loc = locate(virtualTime(tl), tl);
            restartAt(loc.index, loc.frac);
          }
        }
        break;
      case "segment_end":
        if (!s) break;
        s.complete = true;
        s.li.classList.add("ready");
        pump();
        if (exporting) {
          const done = segs.filter((x) => x.complete).length;
          setStatus("synthAllProgress", { k: done, n: segs.length });
        }
        break;
      case "error":
        setStatus("segmentError", { i: msg.index + 1, msg: msg.message }, true);
        break;
    }
  });

  // ---------- seek bar ----------
  let lastBufCss = "";

  function renderSeek() {
    const active = state !== "idle" && segs.length > 0;
    const tl = active ? timeline() : null;
    const total = active ? tl.total : 0;
    const pos = active ? (dragging ? dragTime : virtualTime(tl)) : 0;
    const pct = (x) => (total ? Math.min(100, Math.max(0, x / total * 100)) : 0).toFixed(3) + "%";

    // Synthesized (received) audio, merged into contiguous ranges.
    let css = "none";
    if (active) {
      const rs = [];
      segs.forEach((s, k) => {
        if (!s.bytes) return;
        const a = tl.start[k];
        const b = a + (s.complete ? tl.d[k] : Math.min(tl.d[k], s.bytes / BYTES_PER_SECOND));
        const last = rs[rs.length - 1];
        if (last && a - last[1] < 1e-6) last[1] = b; else rs.push([a, b]);
      });
      if (rs.length) {
        css = "linear-gradient(to right, " + rs.map(([a, b]) =>
          `transparent ${pct(a)}, var(--buffered) ${pct(a)}, var(--buffered) ${pct(b)}, transparent ${pct(b)}`
        ).join(", ") + ")";
      }
    }
    if (css !== lastBufCss) { ui.seekBuf.style.background = css; lastBufCss = css; }

    ui.seekPlayed.style.width = pct(pos);
    ui.seekThumb.style.left = pct(pos);
    ui.timeCur.textContent = fmtTime(pos);
    ui.timeTotal.textContent = total ? (allComplete() ? "" : "≈") + fmtTime(total) : "0:00";
    ui.seek.classList.toggle("disabled", !active);
    ui.seek.setAttribute("aria-valuemax", String(Math.round(total)));
    ui.seek.setAttribute("aria-valuenow", String(Math.round(pos)));
    ui.seek.setAttribute("aria-valuetext", t("timeText", { cur: fmtTime(pos), total: fmtTime(total) }));
  }

  function timeFromPointer(ev) {
    const rect = ui.seek.getBoundingClientRect();
    const frac = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
    return frac * timeline().total;
  }

  // While dragging only the thumb moves; the seek happens on release, so
  // dragging across unsynthesized parts doesn't start synthesis everywhere.
  ui.seek.addEventListener("pointerdown", (ev) => {
    if (state === "idle" || !segs.length) return;
    dragging = true;
    dragTime = timeFromPointer(ev);
    ui.seek.classList.add("dragging");
    ui.seek.setPointerCapture(ev.pointerId);
  });
  ui.seek.addEventListener("pointermove", (ev) => { if (dragging) dragTime = timeFromPointer(ev); });
  ui.seek.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    ui.seek.classList.remove("dragging");
    seekVirtual(dragTime);
  });
  ui.seek.addEventListener("pointercancel", () => {
    dragging = false;
    ui.seek.classList.remove("dragging");
  });
  ui.seek.addEventListener("keydown", (ev) => {
    if (state === "idle" || !segs.length) return;
    const now = virtualTime(timeline());
    const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[ev.key];
    if (step) seekVirtual(now + step);
    else if (ev.key === "Home") seekVirtual(0);
    else if (ev.key === "End") seekVirtual(Infinity);
    else return;
    ev.preventDefault();
  });

  function animate() {
    renderSeek();
    if (state !== "idle") requestAnimationFrame(animate);
  }

  // ---------- segments UI ----------
  function renderSegments(list) {
    segs = list.map((text) => ({ text, parts: [], bytes: 0, complete: false, li: null }));
    ui.segments.innerHTML = "";
    segs.forEach((s, i) => {
      const li = document.createElement("li");
      li.textContent = s.text;
      li.addEventListener("click", () => clickSegment(i));
      s.li = li;
      ui.segments.appendChild(li);
    });
  }

  // Any segment can be clicked; unsynthesized (grey) ones are synthesized
  // first and stay grey until their audio is complete.
  function clickSegment(i) {
    if (String(window.getSelection())) return; // the user is selecting text
    if (state === "idle") {
      if (ui.text.value.trim() === sessionText) play(i);
      return;
    }
    resumeIfFinished();
    seekTo(i, 0);
  }

  // Seeking after playback finished plays from the new position.
  function resumeIfFinished() {
    if (state !== "finished") return;
    setState("playing");
    if (audio.ended) audio.play().catch(() => {});
  }

  function setCurrent(i) {
    segs.forEach((s, k) => {
      s.li.classList.toggle("active", k === i);
      s.li.classList.toggle("done", k < i);
    });
    current = i;
    if (segs[i]) segs[i].li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    api.progress(reqId, i).catch(() => {});
    if (state === "playing" && !pendingSeek) setStatus("reading", { i: i + 1, n: segs.length });
  }

  // ---------- controls ----------
  function resetPlayer() {
    closeChain();
    pendingSeek = null;
    current = -1;
  }

  /** Start a new request for `text`; plays from segment `startAt` if `autoplay`. */
  async function startSession(text, autoplay, startAt = 0) {
    resetPlayer();
    segs = [];
    ui.segments.innerHTML = "";
    const id = ++reqId;
    sessionText = text;
    startIndex = startAt;
    setState(autoplay ? "playing" : "paused");
    requestAnimationFrame(animate);
    setStatus("synthesizing");
    await api.speak(id, text, ui.voice.value || DEFAULT_VOICE, rateStr());
    return id;
  }

  async function play(startAt = 0) {
    const text = ui.text.value.trim();
    if (!text) { setStatus("noText", {}, true); return; }
    const id = reqId + 1;
    try {
      await startSession(text, true, startAt);
    } catch (e) {
      if (id === reqId) { setState("idle"); setStatus("message", { msg: errText(e) }, true); }
    }
  }

  function togglePause() {
    if (state === "finished") {
      setState("playing");
      seekTo(0, 0);
      audio.play().catch(() => {});
    } else if (state === "playing") {
      audio.pause();
      setState("paused");
      setStatus("paused");
    } else if (state === "paused") {
      setState("playing");
      if (!segs.length) { setStatus("synthesizing"); return; }
      if (!chain || audio.ended) { restartAt(chain ? 0 : Math.max(current, 0), 0); return; }
      if (pendingSeek) { setStatus("synthFrom", { i: pendingSeek.index + 1 }); return; }
      audio.play().catch(() => {});
      setStatus(current >= 0 ? "reading" : "buffering", { i: current + 1, n: segs.length });
    }
  }

  function stop() {
    api.stop(reqId).catch(() => {});
    reqId++;
    resetPlayer();
    for (const s of segs) s.li.classList.remove("active", "done");
    setState("idle");
    renderSeek();
    setStatus("stopped");
  }

  function applyPlayRate() {
    const r = Number(ui.playRate.value);
    audio.defaultPlaybackRate = r;
    audio.playbackRate = r;
    audio.preservesPitch = true;
  }

  // ---------- export ----------
  function fileName(text) {
    const name = text.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").trim().slice(0, 24).trim();
    return name || "tts";
  }

  /** Synthesize every segment of the current request and save it as one file. */
  async function exportAudio(format) {
    if (exporting) return;
    const text = state === "idle" ? ui.text.value.trim() : sessionText;
    if (!text) { setStatus("noText", {}, true); return; }
    const filePath = await api.chooseSavePath(format, fileName(text));
    if (!filePath) return;
    exporting = ui.mp3Btn.disabled = ui.wavBtn.disabled = true;
    try {
      // Without a request, synthesize the text without playing it.
      const id = state === "idle" ? await startSession(text, false) : reqId;
      setStatus("synthAll");
      await api.collectAll(id);
      if (id !== reqId || !allComplete()) throw new Error(t("exportCancelled"));
      const mp3 = segs.map((s) => concatBytes(s.parts));
      const data = format === "wav"
        ? await encodeWav(mp3, 24000, (k, n) => setStatus("toWav", { k, n }))
        : concatBytes(mp3);
      await api.writeFile(filePath, data);
      setStatus("saved", { path: filePath });
    } catch (e) {
      setStatus("exportFailed", { msg: errText(e) }, true);
    } finally {
      exporting = ui.mp3Btn.disabled = ui.wavBtn.disabled = false;
    }
  }

  // ---------- audio events ----------
  audio.addEventListener("timeupdate", trackPosition);
  audio.addEventListener("playing", () => {
    trackPosition();
    if (state === "playing" && current >= 0) setStatus("reading", { i: current + 1, n: segs.length });
  });
  audio.addEventListener("seeked", trackPosition);
  audio.addEventListener("waiting", () => {
    if (state === "playing" && !pendingSeek && !(chain && chain.ended)) setStatus("buffering");
  });
  audio.addEventListener("ended", () => {
    if (state === "idle" || !chain || !chain.ended) return;
    for (const s of segs) { s.li.classList.remove("active"); s.li.classList.add("done"); }
    current = -1;
    // Keep the audio so it can still be seeked or replayed with “从头播放”.
    setState("finished");
    setStatus("finished");
  });
  audio.addEventListener("error", () => {
    if (state !== "idle" && audio.error && chain) setStatus("audioError", { msg: audio.error.message }, true);
  });

  // ---------- voices ----------
  let voices = [];

  function voiceLabel(v) {
    const name = v.ShortName.replace(v.Locale + "-", "").replace(/Neural$/, "");
    const gender = v.Gender === "Female" || v.Gender === "Male" ? t(v.Gender) : v.Gender;
    return t("voiceName", { name, gender });
  }

  function renderVoices() {
    const lang = ui.lang.value;
    const prev = ui.voice.value || settings.voice || DEFAULT_VOICE;
    const filtered = voices.filter((v) => !lang || v.Locale.split("-")[0] === lang);
    const groups = new Map();
    filtered.forEach((v) => {
      if (!groups.has(v.Locale)) groups.set(v.Locale, []);
      groups.get(v.Locale).push(v);
    });
    ui.voice.innerHTML = "";
    for (const [locale, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const og = document.createElement("optgroup");
      og.label = locale;
      list.forEach((v) => og.appendChild(new Option(voiceLabel(v), v.ShortName)));
      ui.voice.appendChild(og);
    }
    if (filtered.some((v) => v.ShortName === prev)) ui.voice.value = prev;
    saveSetting("voice", ui.voice.value);
  }

  /** Fill the voice language list, named in the UI language. */
  function renderLangs() {
    const prev = ui.lang.value;
    const names = typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale === "zh" ? "zh-CN" : "en"], { type: "language" }) : null;
    const langs = [...new Set(voices.map((v) => v.Locale.split("-")[0]))];
    const label = (l) => { try { return names ? `${names.of(l)} (${l})` : l; } catch { return l; } };
    ui.lang.innerHTML = "";
    ui.lang.appendChild(new Option(t("allLanguages"), ""));
    langs.map((l) => [l, label(l)])
      .sort((a, b) => a[1].localeCompare(b[1], locale))
      .forEach(([l, text]) => ui.lang.appendChild(new Option(text, l)));
    ui.lang.value = prev;
  }

  async function loadVoices() {
    setStatus("loadingVoices");
    try {
      voices = (await api.voices()).sort((a, b) => a.ShortName.localeCompare(b.ShortName));
    } catch (e) {
      setStatus("voicesFailed", { msg: errText(e) }, true);
      ui.voice.innerHTML = "";
      ui.voice.appendChild(new Option(settings.voice || DEFAULT_VOICE, settings.voice || DEFAULT_VOICE));
      return;
    }
    renderLangs();
    const savedLang = (settings.voice || DEFAULT_VOICE).split("-")[0];
    ui.lang.value = voices.some((v) => v.Locale.split("-")[0] === savedLang) ? savedLang : "";
    renderVoices();
    setStatus("ready");
  }

  // ---------- wiring ----------
  ui.playBtn.addEventListener("click", () => play());
  ui.pauseBtn.addEventListener("click", togglePause);
  ui.stopBtn.addEventListener("click", stop);
  ui.mp3Btn.addEventListener("click", () => exportAudio("mp3"));
  ui.wavBtn.addEventListener("click", () => exportAudio("wav"));
  ui.lang.addEventListener("change", renderVoices);
  ui.uiLang.addEventListener("change", () => {
    setLocale(ui.uiLang.value);
    saveSetting("locale", locale);
  });
  ui.theme.addEventListener("change", () => {
    setTheme(ui.theme.value);
    saveSetting("theme", ui.theme.value);
  });
  ui.voice.addEventListener("change", () => saveSetting("voice", ui.voice.value));

  const showRates = () => {
    ui.playRateOut.textContent = Number(ui.playRate.value).toFixed(2) + "x";
    ui.synthRateOut.textContent = rateStr();
  };
  ui.playRate.addEventListener("input", () => {
    showRates();
    applyPlayRate();
    saveSetting("playRate", ui.playRate.value);
  });
  ui.synthRate.addEventListener("input", showRates);
  ui.synthRate.addEventListener("change", () => saveSetting("synthRate", ui.synthRate.value));
  ui.text.addEventListener("input", () => saveSetting("text", ui.text.value));
  ui.text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); play(); }
  });
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (e.key === " " && !["textarea", "input", "select", "button"].includes(tag) && state !== "idle") {
      e.preventDefault();
      togglePause();
    }
  });

  async function init() {
    try { settings = (await api.loadSettings()) || {}; } catch { settings = {}; }
    locale = I18N[settings.locale] ? settings.locale : "zh";
    ui.uiLang.value = locale;
    ui.theme.value = settings.theme || "system";
    ui.text.value = typeof settings.text === "string" && settings.text ? settings.text : t("sample");
    applyLocale();
    if (settings.playRate) ui.playRate.value = settings.playRate;
    if (settings.synthRate) ui.synthRate.value = settings.synthRate;
    showRates();
    applyPlayRate();
    loadVoices();
  }

  showRates();
  renderSeek();
  init().then(() => {
    if (!window.MediaSource || !MediaSource.isTypeSupported("audio/mpeg")) setStatus("noMse", {}, true);
  });
})();
