"use strict";

// A sentence ends with CJK/Latin terminators (plus closing quotes); a period
// only counts when followed by whitespace, so "3.14" is not split.
const SENTENCE_RE = /.+?(?:[。！？!?；;…]+[”’"')）]*|\.+(?=\s|$)|$)/gsu;
// Short sentences are merged into segments up to this many characters, so we
// don't open a new connection to the service for every tiny sentence.
const MAX_SEGMENT_CHARS = 120;

/** Split text into paragraphs, then into sentence-based segments. */
function splitSegments(text) {
  const segments = [];
  for (let paragraph of String(text).split(/\n+/)) {
    paragraph = paragraph.trim();
    if (!paragraph) continue;
    let current = "";
    for (const match of paragraph.matchAll(SENTENCE_RE)) {
      const sentence = match[0];
      if (!sentence) continue;
      if (current.trim() && current.length + sentence.length > MAX_SEGMENT_CHARS) {
        segments.push(current.trim());
        current = "";
      }
      current += sentence;
    }
    if (current.trim()) segments.push(current.trim());
  }
  return segments;
}

module.exports = { splitSegments };
