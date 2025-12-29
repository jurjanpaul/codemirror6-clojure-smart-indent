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

function isIgnored(flags: Flags, _text: string, index: number): boolean {
  return hasFlag(flags, index, FLAG_STRING | FLAG_COMMENT | FLAG_ESCAPE);
}

function inString(flags: Flags, index: number): boolean {
  return hasFlag(flags, index, FLAG_STRING);
}

function inComment(flags: Flags, index: number): boolean {
  return hasFlag(flags, index, FLAG_COMMENT);
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

function isAnyChar(): boolean { return true; }

function isWhitespace(c: string): boolean {
  return c === " " || c === "," || c === "\n" || c === "\r" || c === "\t";
}

function notWhitespace(c: string): boolean {
  return !isWhitespace(c);
}

function isSpaceOrComment(flags: Flags, text: string, i: number): boolean {
  return isWhitespace(text[i]) || inComment(flags, i);
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

function find(flags: Flags, text: string, index: number, limit: number, pred: (char: string, index: number) => boolean | void, shouldSkip: (flags: Flags, text: string, index: number) => boolean = isIgnored): number {
  const scanForward = index < limit;
  const step = scanForward ? 1 : -1;
  for (let i = index; scanForward ? i <= limit : i >= limit; i += step) {
    if (shouldSkip(flags, text, i)) continue;
    if (pred(text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(flags: Flags, text: string, index: number, minIndex: number = 0): number {
  return find(flags, text, index, minIndex, notWhitespace);
}

function findMatching(flags: Flags, text: string, index: number, limit: number, depth: number = 0): number {
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
  return find(flags, text, index, limit, match);
}

function findOpenDelimiter(flags: Flags, text: string, index: number, minIndex: number = 0): number {
  return findMatching(flags, text, index, minIndex);
}

function findCloseDelimiter(flags: Flags, text: string, index: number, depth: number = 0): number {
  return findMatching(flags, text, index, text.length - 1, depth);
}

function readElement(flags: Flags, text: string, index: number): string {
  if (index >= text.length) return "";
  let depth = 0;
  function isEndOfElement(char: string, i: number): boolean {
    if (isOpenDelimiter(char)) {
      depth++;
    } else if (isCloseDelimiter(char)) {
      depth--;
    }
    if (depth === 0) {
      const nextI = i + 1;
      if (nextI === text.length || isWhitespace(text[nextI])) {
        return true;
      }
    }
    if (depth < 0) {
      return true;
    }
    return false;
  }
  const lastCharIdx = find(flags, text, index, text.length - 1, isEndOfElement);
  if (lastCharIdx === -1) {
    return text.slice(index);
  }
  if (depth < 0) {
    return text.slice(index, lastCharIdx);
  }
  return text.slice(index, lastCharIdx + 1);
}

function skipSpaceAndComments(flags: Flags, text: string, index: number): number {
  if (index >= text.length) return -1;
  return find(flags, text, index, text.length - 1, isAnyChar, isSpaceOrComment);
}

function getFormIndentation(flags: Flags, text: string, openParenIdx: number): number {
  const openChar = text[openParenIdx];
  const openCol = getColumn(text, openParenIdx);
  if (openChar !== "(") return openCol + 1;
  const firstElemIdx = skipSpaceAndComments(flags, text, openParenIdx + 1);
  if (firstElemIdx === -1) return openCol + 1;
  const element = readElement(flags, text, firstElemIdx);
  const firstElemEnd = firstElemIdx + element.length;
  if (BODY_FORMS.has(element)) {
    return openCol + 2;
  }
  const firstArgIdx = skipSpaceAndComments(flags, text, firstElemEnd);
  if (firstArgIdx !== -1) {
    const firstArgLineStart = getLineStart(text, firstArgIdx);
    const lineStart = getLineStart(text, openParenIdx);
    if (firstArgLineStart === lineStart) {
      return getColumn(text, firstArgIdx);
    }
  }
  return openCol + 1;
}

function findOutermostCloseDelimiter(flags: Flags, text: string, index: number, minIndex: number = 0): number {
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
  find(flags, text, index, minIndex, updateCandidate);
  return candidate;
}

function getFormStart(flags: Flags, text: string, openIdx: number): number {
  let start = openIdx;
  if (start > 0 && text[start - 1] === "#") return start - 1;
  let curr = start - 1;
  while (curr >= 0) {
    const found = find(flags, text, curr, 0, isAnyChar, isSpaceOrComment);
    if (found === -1) break;
    curr = found;
    const char = text[curr];
    if ("^'@`~".includes(char)) {
      start = curr;
      curr--;
      continue;
    }
    if ((char === "_" || char === "?") && curr > 0 && text[curr - 1] === "#") {
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
  const flags = parse(prefix);
  if (inString(flags, flags.length - 1)) {
    return 0;
  }
  let lastSignificantCharIdx = findLastSignificantCharIdx(flags, prefix, prefix.length - 1);
  if (lastSignificantCharIdx === -1) {
    return 0;
  }
  const lastSignificantLineStart = getLineStart(prefix, lastSignificantCharIdx);
  const openParenIdx = findOpenDelimiter(flags, prefix, lastSignificantCharIdx, lastSignificantLineStart);
  if (openParenIdx !== -1) {
    return getFormIndentation(flags, prefix, openParenIdx);
  }
  const closeDelimiterIdx = findOutermostCloseDelimiter(flags, prefix, lastSignificantCharIdx, lastSignificantLineStart);
  if (closeDelimiterIdx !== -1) {
    const matchingOpenIdx = findOpenDelimiter(flags, prefix, closeDelimiterIdx - 1, 0);
    if (matchingOpenIdx !== -1) {
      const formStartIdx = getFormStart(flags, prefix, matchingOpenIdx);
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
