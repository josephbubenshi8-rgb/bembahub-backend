// Shared Unicode-aware tokenization for dictionary-first long translations.
// Keep these as regex literals with single escapes so Unicode property classes
// and whitespace are interpreted by the JavaScript regex engine.
export const WORD_TOKEN_PATTERN = /^[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*$/u;

export function tokenizeTranslationChunk(value) {
  const text = String(value ?? "");
  return text.match(/\s+|[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|[^\s\p{L}\p{M}]+/gu) || [text];
}

export function hasUnicodeLetter(value) {
  return /[\p{L}\p{M}]/u.test(String(value ?? ""));
}
