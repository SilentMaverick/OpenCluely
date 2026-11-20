/**
 * Local, rule-based cleanup for dictated text (no network, no LLM).
 *
 * Whisper already punctuates well, so this stays conservative: it only does
 * things that are safe on any text. It never rewrites wording.
 *
 *  - "scratch that" / "delete that": drops everything dictated before it
 *  - removes pure filler sounds (um, uh, uhm, erm, hmm)
 *  - spoken formatting: "new line", "new paragraph", "question mark",
 *    "exclamation mark/point", "full stop"
 *  - personal dictionary: snaps names/terms to the spelling you chose, also
 *    when Whisper splits them ("open cluely" -> "OpenCluely")
 *  - tidies spacing, fixes a lone "i" -> "I", capitalizes the first letter
 */

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term) {
  const parts = String(term)
    .split(/(?<=[a-z0-9])(?=[A-Z])|[\s_-]+/)
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map(escapeRegExp).join('[\\s-]*');
  }
  return escapeRegExp(term);
}

function applyDictionary(text, terms) {
  let out = text;
  for (const term of terms || []) {
    const clean = String(term).trim();
    if (!clean) continue;
    const re = new RegExp(`(?<![\\w])${termPattern(clean)}(?![\\w])`, 'gi');
    out = out.replace(re, clean);
  }
  return out;
}

function formatDictation(raw, options = {}) {
  const { removeFillers = true, dictionary = [], trailingSpace = true } = options;
  let text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  // "scratch that": keep only what was said after the last one.
  const scratch = /\b(?:scratch that|delete that)\b[\s.,!?]*/gi;
  let lastEnd = -1;
  let m;
  while ((m = scratch.exec(text)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd >= 0) {
    text = text.slice(lastEnd).trim();
    if (!text) return '';
  }

  if (removeFillers) {
    text = text.replace(/(^|[\s(])(?:um+|uh+|uhm+|erm+|hmm+)(?=[\s,.!?)]|$)[,]?/gi, '$1');
  }

  // Spoken formatting commands.
  text = text
    .replace(/[ \t]*\bnew paragraph\b[.,]?[ \t]*/gi, '\n\n')
    .replace(/[ \t]*\bnew line\b[.,]?[ \t]*/gi, '\n')
    .replace(/[ \t]*\bquestion mark\b[.,]?/gi, '?')
    .replace(/[ \t]*\bexclamation (?:mark|point)\b[.,]?/gi, '!')
    .replace(/[ \t]*\bfull stop\b[.,]?/gi, '.');

  text = applyDictionary(text, dictionary);

  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/([,.]) *([,.])/g, '$2')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  text = text.replace(/\bi\b(?!\.[a-z])/g, 'I');
  text = text.replace(/(^|\n)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());

  if (!text) return '';
  if (trailingSpace && !/\n$/.test(text)) {
    text += ' ';
  }
  return text;
}

module.exports = { formatDictation, applyDictionary };
