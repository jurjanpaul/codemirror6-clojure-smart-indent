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

function isOpenDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isCloseDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function isDelimiter(char: string): boolean {
  return isOpenDelimiter(char) || isCloseDelimiter(char);
}

function find(text: string, index: number, limit: number, flags: Flags, pred: (char: string, index: number) => boolean | void, skipIgnored: boolean = true): number {
  const scanForward = index < limit;
  const step = scanForward ? 1 : -1;
  for (let i = index; scanForward ? i <= limit : i >= limit; i += step) {
    if (skipIgnored && isIgnored(flags, i)) continue;
    if (pred(text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(text: string, index: number, flags: Flags, minIndex: number = 0): number {
  return find(text, index, minIndex, flags, notWhitespace);
}

function findMatching(text: string, index: number, limit: number, flags: Flags, depth: number = 0): number {
  const scanForward = index < limit;
  const openPred = scanForward ? isOpenDelimiter : isCloseDelimiter;
  const closePred = scanForward ? isCloseDelimiter : isOpenDelimiter;
  return find(text, index, limit, flags, (char) => {
    if (openPred(char)) {
      depth++;
    } else if (closePred(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function findOpenDelimiter(text: string, index: number, minIndex: number = 0, flags: Flags): number {
  return findMatching(text, index, minIndex, flags);
}

function findCloseDelimiter(text: string, index: number, flags: Flags, depth: number = 0): number {
  return findMatching(text, index, text.length - 1, flags, depth);
}

function readElement(text: string, index: number, flags: Flags): string {
  let curr = index;
  // Skip any leading prefixes
  while (curr < text.length) {
    if (text[curr] === "#") {
      if (curr + 1 < text.length && (text[curr + 1] === "{" || text[curr + 1] === "(")) {
        curr++;
        break; // Stop at the delimiter
      } else if (curr + 1 < text.length && (text[curr + 1] === "?" || text[curr + 1] === "_")) {
        curr += 2;
        continue; // Prefix like #? or #_ can be followed by another prefix or form
      } else {
        break; // Atom starting with #
      }
    } else if ("^'@`~".includes(text[curr])) {
      curr++;
      continue;
    } else {
      break;
    }
  }
  if (curr < text.length && isOpenDelimiter(text[curr])) {
    const closing = findCloseDelimiter(text, curr + 1, flags);
    const end = closing === -1 ? text.length : closing + 1;
    return text.slice(index, end);
  }
  const end = find(text, curr, text.length - 1, flags, (c) => isWhitespace(c) || isDelimiter(c));
  const realEnd = end === -1 ? text.length : end;
  return text.slice(index, realEnd);
}

function skipSpaceAndComments(text: string, index: number, flags: Flags): number {
  let curr = index;
  while (curr < text.length) {
    if (isWhitespace(text[curr]) || inComment(flags, curr)) {
      curr++;
      continue;
    }
    return curr;
  }
  return -1;
}

function getFormIndentation(text: string, openParenIdx: number, flags: Flags): number {
  const openChar = text[openParenIdx];
  const openCol = getColumn(text, openParenIdx);
  if (openChar !== "(") return openCol + 1;
  const firstElemIdx = skipSpaceAndComments(text, openParenIdx + 1, flags);
  if (firstElemIdx === -1) return openCol + 1;
  const element = readElement(text, firstElemIdx, flags);
  const firstElemEnd = firstElemIdx + element.length;
  if (BODY_FORMS.has(element)) {
    return openCol + 2;
  }
  const firstArgIdx = skipSpaceAndComments(text, firstElemEnd, flags);
  if (firstArgIdx !== -1) {
    const firstArgLineStart = getLineStart(text, firstArgIdx);
    const lineStart = getLineStart(text, openParenIdx);
    if (firstArgLineStart === lineStart) {
      return getColumn(text, firstArgIdx);
    }
  }
  return openCol + 1;
}

function findOutermostCloseDelimiter(text: string, index: number, minIndex: number = 0, flags: Flags): number {
  let candidate = -1;
  let depth = 0;
  find(text, index, minIndex, flags, (char, i) => {
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
  let start = openIdx;
  if (start > 0 && text[start - 1] === "#") return start - 1;
  let curr = start - 1;
  while (curr >= 0) {
    if (isWhitespace(text[curr]) || inComment(flags, curr)) {
      curr--;
      continue;
    }
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
  let lastSignificantCharIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, flags);
  if (lastSignificantCharIdx === -1) {
    return 0;
  }
  const lastSignificantLineStart = getLineStart(prefix, lastSignificantCharIdx);
  const openParenIdx = findOpenDelimiter(prefix, lastSignificantCharIdx, lastSignificantLineStart, flags);
  if (openParenIdx !== -1) {
    return getFormIndentation(prefix, openParenIdx, flags);
  }
  const closeDelimiterIdx = findOutermostCloseDelimiter(prefix, lastSignificantCharIdx, lastSignificantLineStart, flags);
  if (closeDelimiterIdx !== -1) {
    const matchingOpenIdx = findOpenDelimiter(prefix, closeDelimiterIdx - 1, 0, flags);
    if (matchingOpenIdx !== -1) {
      const formStartIdx = getFormStart(prefix, matchingOpenIdx, flags);
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
