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

function isIgnored(flags: Flags, index: number): boolean {
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

const complement =
  <T>(predicate: (value: T) => boolean) =>
  (value: T) =>
    !predicate(value);

function getColumn(text: string, index: number): number {
  const lastNewline = text.lastIndexOf("\n", index);
  return index - (lastNewline === -1 ? 0 : lastNewline + 1);
}

function getIndentation(line: string): string {
  const match = line.match(/^[ \t]*/);
  return match ? match[0] : "";
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "," || c === "\n" || c === "\r" || c === "\t";
}

function isOpenDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isCloseDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function findBackward(text: string, index: number, minIndex: number, flags: Flags, pred: (char: string, index: number) => boolean | void, skipIgnored: boolean = true): number {
  for (let i = index; i >= minIndex; i--) {
    if (skipIgnored && isIgnored(flags, i)) continue;
    if (pred(text[i], i)) return i;
  }
  return -1;
}
function findForward(text: string, index: number, maxIndex: number, flags: Flags, pred: (char: string, index: number) => boolean | void, skipIgnored: boolean = true): number {
  for (let i = index; i <= maxIndex; i++) {
    if (skipIgnored && isIgnored(flags, i)) continue;
    if (pred(text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(text: string, index: number, flags: Flags, minIndex: number = 0): number {
  return findBackward(text, index, minIndex, flags, complement(isWhitespace));
}

function findOpenDelimiter(text: string, index: number, flags: Flags, depth: number = 0, minIndex: number = 0): number {
  return findBackward(text, index, minIndex, flags, (char) => {
    // Note: this does not currently bother about delimiters having to match!
    if (isCloseDelimiter(char)) {
      depth++;
    } else if (isOpenDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function findCloseDelimiter(text: string, index: number, flags: Flags, depth: number = 0): number {
  return findForward(text, index, text.length - 1, flags, (char) => {
    // Note: this does not currently bother about delimiters having to match!
    if (isOpenDelimiter(char)) {
      depth++;
    } else if (isCloseDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function readElement(text: string, index: number, flags: Flags): string {
  if (isOpenDelimiter(text[index])) {
    const closing = findCloseDelimiter(text, index + 1, flags);
    const end = closing === -1 ? text.length : closing + 1;
    return text.slice(index, end);
  } else {
    const end = findForward(text, index, text.length - 1, flags, (c) => isWhitespace(c) || isOpenDelimiter(c) || isCloseDelimiter(c));
    const realEnd = end === -1 ? text.length : end;
    return text.slice(index, realEnd);
  }
}

function getFormIndentation(prefix: string, openParenIdx: number, flags: Flags): number {
  const openChar = prefix[openParenIdx];
  const openCol = getColumn(prefix, openParenIdx);
  if (openChar !== "(") return openCol + 1;
  const firstElemIdx = findForward(prefix, openParenIdx + 1, prefix.length - 1, flags, complement(isWhitespace), false);
  if (firstElemIdx === -1) return openCol + 1;
  const symbol = readElement(prefix, firstElemIdx, flags);
  const firstElemEnd = firstElemIdx + symbol.length;
  if (BODY_FORMS.has(symbol)) {
    return openCol + 2;
  }
  const lineStartIdx = prefix.lastIndexOf("\n", openParenIdx);
  const firstArgIdx = findForward(prefix, firstElemEnd, prefix.length - 1, flags, (c, i) => !isWhitespace(c) && !inComment(flags, i), false);
  if (firstArgIdx !== -1) {
    const firstArgLineStartIdx = prefix.lastIndexOf("\n", firstArgIdx);
    if (firstArgLineStartIdx === lineStartIdx) {
      return getColumn(prefix, firstArgIdx);
    }
  }
  return openCol + 1;
}

function findUnmatchedCloseDelimiter(text: string, index: number, flags: Flags, depth: number = 0, minIndex: number = 0): number {
  let candidate = -1;
  findBackward(text, index, minIndex, flags, (char, i) => {
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
  });
  return candidate;
}

function getFormStart(text: string, openIdx: number, flags: Flags): number {
  if (openIdx > 0 && text[openIdx - 1] === '#') {
    return openIdx - 1;
  }
  let curr = openIdx - 1;
  while (curr >= 0) {
    if (isWhitespace(text[curr]) || inComment(flags, curr)) {
      curr--;
      continue;
    }
    const char = text[curr];
    if (char === '^' || char === '\'' || char === '@' || char === '`' || char === '~') {
      return getFormStart(text, curr, flags);
    }
    if (char === '_') {
      if (curr > 0 && text[curr - 1] === '#') {
        return getFormStart(text, curr - 1, flags);
      }
    }
    if (char === '?') {
      if (curr > 0 && text[curr - 1] === '#') {
        return getFormStart(text, curr - 1, flags);
      }
    }
    break;
  }
  return openIdx;
}

export function calculateIndentation(prefix: string): string {
  if (prefix == "") {
    return "";
  }
  const flags = parse(prefix);
  if (inString(flags, flags.length - 1)) {
    return "";
  }
  let lastSignificantCharIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, flags);
  if (lastSignificantCharIdx === -1) {
    return "";
  }
  const lastSignificantLineStart = prefix.lastIndexOf("\n", lastSignificantCharIdx);
  const openParenIdx = findOpenDelimiter(prefix, lastSignificantCharIdx, flags, 0, lastSignificantLineStart + 1);
  if (openParenIdx !== -1) {
    return " ".repeat(getFormIndentation(prefix, openParenIdx, flags));
  }
  const closeDelimiterIdx = findUnmatchedCloseDelimiter(prefix, lastSignificantCharIdx, flags, 0, lastSignificantLineStart + 1);
  if (closeDelimiterIdx !== -1) {
    const matchingOpenIdx = findOpenDelimiter(prefix, closeDelimiterIdx - 1, flags);
    if (matchingOpenIdx !== -1) {
      const formStartIdx = getFormStart(prefix, matchingOpenIdx, flags);
      const matchingOpenLineStart = prefix.lastIndexOf("\n", formStartIdx);
      return " ".repeat(formStartIdx - matchingOpenLineStart - 1);
    }
  }
  const lastSignificantLine = prefix.slice(lastSignificantLineStart + 1, lastSignificantCharIdx + 1);
  return getIndentation(lastSignificantLine);
}

function smartIndent(context: IndentContext, pos: number): number | null {
  const prefix = context.state.doc.sliceString(0, pos);
  const indentationString = calculateIndentation(prefix);
  return indentationString.length;
}

/**
 * Initialises the Clojure Smart Indent extension for CodeMirror6.
 * @param indentService @codemirror/language.indentService
 * @returns the CodeMirror6 Clojure Smart Indent extension in the form of an array of extensions
 */
export function clojureSmartIndentExtension(indentService: Facet<(context: IndentContext, pos: number) => number | null | undefined>): Extension {
  return indentService.of(smartIndent)
}
