import type { IndentContext } from "@codemirror/language"
import type { Extension, Facet } from "@codemirror/state"

type Flags = Uint8Array;

const FLAG_IGNORED = 1;
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
      flags[i] = FLAG_IGNORED | FLAG_COMMENT;
      if (char === '\n') inComment = false;
    } else if (escaped) {
      flags[i] = FLAG_IGNORED;
      escaped = false;
    } else if (char === '\\') {
      if (inString) flags[i] = FLAG_IGNORED;
      escaped = true;
    } else if (inString) {
      flags[i] = FLAG_IGNORED;
      if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      flags[i] = FLAG_IGNORED;
    } else if (char === ';') {
      inComment = true;
      flags[i] = FLAG_IGNORED | FLAG_COMMENT;
    }
    if (inString) flags[i] |= FLAG_STRING;
  }
  return flags;
}

function hasFlag(flags: Flags, index: number, flag: number): boolean {
  return (flags[index] & flag) !== 0;
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

const BODY_INDENT_WIDTH = 2;

const complement =
  <T>(predicate: (value: T) => boolean) =>
  (value: T) =>
    !predicate(value);

function getColumn(text: string, index: number): number {
  const lastNewline = text.lastIndexOf("\n", index);
  return index - (lastNewline === -1 ? 0 : lastNewline + 1);
}

function getLineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

function getIndentation(line: string): string {
  const match = line.match(/^[ \t]*/);
  return match ? match[0] : "";
}

function getIndentationAt(text: string, index: number): string {
  return getIndentation(getLineAt(text, index));
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "," || c === "\n" || c === "\r" || c === "\t";
}

function isOpeningDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isClosingDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function findBackward(text: string, index: number, minIndex: number, flags: Flags, pred: (char: string, index: number) => boolean | void, skipIgnored: boolean = true): number {
  for (let i = index; i >= minIndex; i--) {
    if (skipIgnored && hasFlag(flags, i, FLAG_IGNORED)) continue;
    if (pred(text[i], i)) return i;
  }
  return -1;
}
function findForward(text: string, index: number, maxIndex: number, flags: Flags, pred: (char: string, index: number) => boolean | void, skipIgnored: boolean = true): number {
  for (let i = index; i <= maxIndex; i++) {
    if (skipIgnored && hasFlag(flags, i, FLAG_IGNORED)) continue;
    if (pred(text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(text: string, index: number, flags: Flags, minIndex: number = 0): number {
  return findBackward(text, index, minIndex, flags, complement(isWhitespace));
}

function findOpener(text: string, index: number, flags: Flags, depth: number = 0, minIndex: number = 0): number {
  return findBackward(text, index, minIndex, flags, (char) => {
    // Note: this does not currently bother about delimiters having to match!
    if (isClosingDelimiter(char)) {
      depth++;
    } else if (isOpeningDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function findClosing(text: string, index: number, flags: Flags, depth: number = 0): number {
  return findForward(text, index, text.length - 1, flags, (char) => {
    // Note: this does not currently bother about delimiters having to match!
    if (isOpeningDelimiter(char)) {
      depth++;
    } else if (isClosingDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function getFormIndentation(prefix: string, openParenIdx: number, flags: Flags): string {
  const openChar = prefix[openParenIdx];
  const openCol = getColumn(prefix, openParenIdx);
  if (openChar !== "(") return " ".repeat(openCol + 1);
  const firstElemIdx = findForward(prefix, openParenIdx + 1, prefix.length - 1, flags, complement(isWhitespace), false);
  if (firstElemIdx === -1) return " ".repeat(openCol + 1);
  let firstElemEnd = firstElemIdx;
  if (isOpeningDelimiter(prefix[firstElemIdx])) {
    const closing = findClosing(prefix, firstElemIdx + 1, flags);
    firstElemEnd = closing === -1 ? prefix.length : closing + 1;
  } else {
    const end = findForward(prefix, firstElemIdx, prefix.length - 1, flags, (c) => isWhitespace(c) || isOpeningDelimiter(c) || isClosingDelimiter(c));
    firstElemEnd = end === -1 ? prefix.length : end;
  }
  const symbol = prefix.slice(firstElemIdx, firstElemEnd);
  if (BODY_FORMS.has(symbol)) {
    return " ".repeat(openCol + BODY_INDENT_WIDTH);
  }
  const openLineNum = prefix.lastIndexOf("\n", openParenIdx);
  const firstArgIdx = findForward(prefix, firstElemEnd, prefix.length - 1, flags, (c, i) => !isWhitespace(c) && !hasFlag(flags, i, FLAG_COMMENT), false);
  if (firstArgIdx !== -1) {
    const firstArgLineNum = prefix.lastIndexOf("\n", firstArgIdx);
    if (firstArgLineNum === openLineNum) {
      return " ".repeat(getColumn(prefix, firstArgIdx));
    }
  }
  return " ".repeat(openCol + 1);
}

function findLastUnopenedClosing(text: string, index: number, flags: Flags, depth: number = 0, minIndex: number = 0): number {
  let candidate = -1;
  findBackward(text, index, minIndex, flags, (char, i) => {
    if (isClosingDelimiter(char)) {
      depth++;
      if (depth === 1) {
        candidate = i;
      }
    } else if (isOpeningDelimiter(char)) {
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

export function calculateIndentation(prefix: string): string {
  if (prefix == "") {
    return "";
  }
  const flags = parse(prefix);
  if (hasFlag(flags, flags.length - 1, FLAG_STRING)) {
    return "";
  }
  let lastSignificantCharIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, flags);
  if (lastSignificantCharIdx === -1) {
    return "";
  }
  const lastSignificantLineStart = prefix.lastIndexOf("\n", lastSignificantCharIdx);
// Distinguish 3 situations considering last significant line:
// - unclosed opener
//   => form indent for last unclosed opener
  const openParenIdx = findOpener(prefix, lastSignificantCharIdx, flags, 0, lastSignificantLineStart + 1);
  if (openParenIdx !== -1) {
    return getFormIndentation(prefix, openParenIdx, flags);
  }
// - unopened closer
//   => find matching opener on any preceding line and use its column for indent
  const closingParenIdx = findLastUnopenedClosing(prefix, lastSignificantCharIdx, flags, 0, lastSignificantLineStart + 1);
  if (closingParenIdx !== -1) {
    const matchingOpenIdx = findOpener(prefix, closingParenIdx, flags, -1);
    if (matchingOpenIdx !== -1) {
      const matchingOpenLineStart = prefix.lastIndexOf("\n", matchingOpenIdx);
      return " ".repeat(matchingOpenIdx - matchingOpenLineStart - 1);
    }
  }
// - otherwise
// => preserve previous line’s indent
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
