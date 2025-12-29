import type { IndentContext } from "@codemirror/language"
import type { Extension, Facet } from "@codemirror/state"

type Flags = Uint8Array;

const FLAG_ESCAPE = 1;
const FLAG_COMMENT = 2;
const FLAG_STRING = 4;

function parse(text: string): Flags {
  const size = text.length;
  const flags = new Uint8Array(size);
  let inString = false;
  let inComment = false;
  let escaped = false;
  for (let i = 0; i < size; i++) {
    const char = text[i];
    if (inComment) {
      flags[i] = FLAG_COMMENT;
      if (char === '\n') inComment = false;
    } else if (escaped) {
      flags[i] = FLAG_ESCAPE;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (inString) {
      if (char === '"') {
        inString = false;
        flags[i] = FLAG_ESCAPE;
      }
    } else if (char === '"') {
      inString = true;
      flags[i] = FLAG_STRING | FLAG_ESCAPE;
    } else if (char === ';') {
      inComment = true;
      flags[i] = FLAG_COMMENT;
    }
    if (inString) flags[i] |= FLAG_STRING;
  }
  return flags;
}

function hasFlag(flags: Flags, index: number, flag: number): boolean {
  return (flags[index] & flag) !== 0;
}

interface ParsedText {
  text: string;
  flags: Flags;
}

interface FindPredicates {
  match?: (char: string, index: number) => boolean | void;
  shouldSkip?: (parsed: ParsedText, index: number) => boolean;
}

function isIgnored(parsed: ParsedText, index: number): boolean {
  return hasFlag(parsed.flags, index, FLAG_STRING | FLAG_COMMENT | FLAG_ESCAPE);
}

function inString(parsed: ParsedText, index: number): boolean {
  return hasFlag(parsed.flags, index, FLAG_STRING);
}

function inComment(parsed: ParsedText, index: number): boolean {
  return hasFlag(parsed.flags, index, FLAG_COMMENT);
}

const BODY_FORMS = new Set([
  "as->", "binding", "bound-fn", "case", "catch", "comment", "cond", "cond->", "cond->>", "condp",
  "def", "definterface", "defmethod", "defn", "defn-", "defmacro", "defprotocol", "defrecord",
  "defstruct", "deftype", "do", "doseq", "dotimes", "doto", "extend", "extend-protocol",
  "extend-type", "fn", "for", "future", "if", "if-let", "if-not", "if-some", "let", "letfn",
  "locking", "loop", "ns", "proxy", "reify", "struct-map", "some->", "some->>", "try", "when",
  "when-first", "when-let", "when-not", "when-some", "while", "with-bindings", "with-bindings*",
  "with-in-str", "with-loading-context", "with-local-vars", "with-meta", "with-open", "with-out-str",
  "with-precision", "with-redefs", "with-redefs-fn"
]);

function getLineStart(text: string, index: number): number {
  const lastNewline = text.lastIndexOf("\n", index);
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

function getColumn(text: string, index: number): number {
  return index - getLineStart(text, index);
}

function getIndentationLength(line: string): number {
  const match = line.match(/^[ \t]*/);
  return match ? match[0].length : 0;
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "," || c === "\n" || c === "\r" || c === "\t";
}

function notWhitespace(c: string): boolean {
  return !isWhitespace(c);
}

function isSpaceOrComment(parsed: ParsedText, i: number): boolean {
  return isWhitespace(parsed.text[i]) || inComment(parsed, i);
}

function isOpenDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isCloseDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function isDelimiter(char: string): boolean {
  return isOpenDelimiter(char) || isCloseDelimiter(char);
}

function find(parsed: ParsedText, index: number, limit: number, predicates: FindPredicates): number {
  const { match = () => true, shouldSkip = isIgnored } = predicates;
  const scanForward = index < limit;
  const step = scanForward ? 1 : -1;
  for (let i = index; scanForward ? i <= limit : i >= limit; i += step) {
    if (shouldSkip(parsed, i)) continue;
    if (match(parsed.text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(parsed: ParsedText, index: number, minIndex: number = 0): number {
  return find(parsed, index, minIndex, { match: notWhitespace });
}

function findMatching(parsed: ParsedText, index: number, limit: number, depth: number = 0): number {
  const scanForward = index < limit;
  const openPred = scanForward ? isOpenDelimiter : isCloseDelimiter;
  const closePred = scanForward ? isCloseDelimiter : isOpenDelimiter;
  function match(char: string): boolean {
    if (openPred(char)) {
      depth++;
    } else if (closePred(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  }
  return find(parsed, index, limit, { match });
}

function findOpenDelimiter(parsed: ParsedText, index: number, minIndex: number = 0): number {
  return findMatching(parsed, index, minIndex);
}

function findCloseDelimiter(parsed: ParsedText, index: number, depth: number = 0): number {
  return findMatching(parsed, index, parsed.text.length - 1, depth);
}

function readElement(parsed: ParsedText, index: number): string {
  if (index >= parsed.text.length) return "";
  let depth = 0;
  function isEndOfElement(char: string, i: number): boolean {
    if (isOpenDelimiter(char)) {
      depth++;
    } else if (isCloseDelimiter(char)) {
      depth--;
    }
    if (depth === 0) {
      const nextI = i + 1;
      if (nextI === parsed.text.length || isWhitespace(parsed.text[nextI])) {
        return true;
      }
    }
    return depth < 0;
  }
  const lastCharIdx = find(parsed, index, parsed.text.length - 1, { match: isEndOfElement });
  if (lastCharIdx === -1) {
    return parsed.text.slice(index);
  }
  if (depth < 0) {
    return parsed.text.slice(index, lastCharIdx);
  }
  return parsed.text.slice(index, lastCharIdx + 1);
}

function skipSpaceAndComments(parsed: ParsedText, index: number): number {
  if (index >= parsed.text.length) return -1;
  return find(parsed, index, parsed.text.length - 1, { shouldSkip: isSpaceOrComment });
}

function getFormIndentation(parsed: ParsedText, openParenIdx: number): number {
  const openCol = getColumn(parsed.text, openParenIdx);
  const firstElemIdx = skipSpaceAndComments(parsed, openParenIdx + 1);
  if (firstElemIdx === -1) return openCol + 1;
  const element = readElement(parsed, firstElemIdx);
  const firstElemEnd = firstElemIdx + element.length;
  if (BODY_FORMS.has(element)) {
    return openCol + 2;
  }
  const firstArgIdx = skipSpaceAndComments(parsed, firstElemEnd);
  if (firstArgIdx !== -1) {
    const firstArgLineStart = getLineStart(parsed.text, firstArgIdx);
    const lineStart = getLineStart(parsed.text, openParenIdx);
    if (firstArgLineStart === lineStart) {
      return getColumn(parsed.text, firstArgIdx);
    }
  }
  return openCol + 1;
}

function findOutermostCloseDelimiter(parsed: ParsedText, index: number, minIndex: number = 0): number {
  let candidate = -1;
  let depth = 0;
  function updateCandidate(char: string, i: number): boolean {
    if (isCloseDelimiter(char)) {
      depth++;
      if (depth === 1) {
        candidate = i;
      }
    } else if (isOpenDelimiter(char)) {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          candidate = -1;
        }
      }
    }
    return false;
  }
  find(parsed, index, minIndex, { match: updateCandidate });
  return candidate;
}

function getFormStart(parsed: ParsedText, openIdx: number): number {
  let start = openIdx;
  if (start > 0 && parsed.text[start - 1] === "#") return start - 1;
  let curr = start - 1;
  while (curr >= 0) {
    const found = find(parsed, curr, 0, { shouldSkip: isSpaceOrComment });
    if (found === -1) break;
    curr = found;
    const char = parsed.text[curr];
    if ("^'@`~".includes(char)) {
      start = curr;
      curr--;
      continue;
    }
    if ((char === "_" || char === "?") && curr > 0 && parsed.text[curr - 1] === "#") {
      start = curr - 1;
      curr -= 2;
      continue;
    }
    break;
  }
  return start;
}

export function calculateIndentation(prefix: string): number {
  if (prefix == "") {
    return 0;
  }
  const parsed = { text: prefix, flags: parse(prefix) };
  if (inString(parsed, prefix.length - 1)) {
    return 0;
  }
  let lastSignificantCharIdx = findLastSignificantCharIdx(parsed, prefix.length - 1);
  if (lastSignificantCharIdx === -1) {
    return 0;
  }
  const lastSignificantLineStart = getLineStart(prefix, lastSignificantCharIdx);
  const openParenIdx = findOpenDelimiter(parsed, lastSignificantCharIdx, lastSignificantLineStart);
  if (openParenIdx !== -1) {
    return getFormIndentation(parsed, openParenIdx);
  }
  const closeDelimiterIdx = findOutermostCloseDelimiter(parsed, lastSignificantCharIdx, lastSignificantLineStart);
  if (closeDelimiterIdx !== -1) {
    const matchingOpenIdx = findOpenDelimiter(parsed, closeDelimiterIdx - 1, 0);
    if (matchingOpenIdx !== -1) {
      const formStartIdx = getFormStart(parsed, matchingOpenIdx);
      return getColumn(prefix, formStartIdx);
    }
  }
  const lastSignificantLine = prefix.slice(lastSignificantLineStart, lastSignificantCharIdx + 1);
  return getIndentationLength(lastSignificantLine);
}

function smartIndent(context: IndentContext, pos: number): number | null {
  const prefix = context.state.doc.sliceString(0, pos);
  return calculateIndentation(prefix);
}

/**
 * Initialises the Clojure Smart Indent extension for CodeMirror6.
 * @param indentService @codemirror/language.indentService
 * @returns the CodeMirror6 Clojure Smart Indent extension in the form of an array of extensions
 */
export function clojureSmartIndentExtension(indentService: Facet<(context: IndentContext, pos: number) => number | null | undefined>): Extension {
  return indentService.of(smartIndent)
}
