import type { IndentContext } from "@codemirror/language"
import type { Extension, Facet } from "@codemirror/state"

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

const FLAG_IGNORED = 1;
const FLAG_COMMENT = 2;

function parse(text: string): { inString: boolean, inComment: boolean, flags: Uint8Array } {
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
      continue;
    }
    if (inString) {
      flags[i] = FLAG_IGNORED;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"' && (i === 0 || text[i-1] !== '\\')) {
      flags[i] = FLAG_IGNORED;
      inString = true;
    } else if (char === ';') {
      flags[i] = FLAG_IGNORED | FLAG_COMMENT;
      inComment = true;
    }
  }
  return { inString, inComment, flags };
}

function isOpeningDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isClosingDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function findBackwards(text: string, index: number, minIndex: number, flags: Uint8Array, pred: (char: string) => boolean | void, skipIgnored: boolean = true): number {
  for (let i = index; i >= minIndex; i--) {
    if (skipIgnored && (flags[i] & FLAG_IGNORED)) continue;
    if (pred(text[i])) return i;
  }
  return -1;
}
function findForward(text: string, index: number, maxIndex: number, flags: Uint8Array, pred: (char: string) => boolean | void, skipIgnored: boolean = true): number {
  for (let i = index; i <= maxIndex; i++) {
    if (skipIgnored && (flags[i] & FLAG_IGNORED)) continue;
    if (pred(text[i])) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(text: string, index: number, flags: Uint8Array, minIndex: number = 0): number {
  return findBackwards(text, index, minIndex, flags, (char) => !/\s/.test(char));
}

function findOpener(text: string, index: number, flags: Uint8Array, depth: number = 0): number {
  return findBackwards(text, index, 0, flags, (char) => {
    if (isClosingDelimiter(char)) {
      depth++;
    } else if (isOpeningDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function findClosing(text: string, index: number, flags: Uint8Array, depth: number = 0): number {
  return findForward(text, index, text.length - 1, flags, (char) => {
    if (isOpeningDelimiter(char)) {
      depth++;
    } else if (isClosingDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function getFormIndentation(prefix: string, openParenIdx: number, flags: Uint8Array): string {
  const openChar = prefix[openParenIdx];
  const openCol = getColumn(prefix, openParenIdx);
  if (openChar !== "(") return " ".repeat(openCol + 1);
  const firstElemIdx = findForward(prefix, openParenIdx + 1, prefix.length - 1, flags, (c) => !/\s/.test(c), false);
  if (firstElemIdx === -1) return " ".repeat(openCol + 1);
  let firstElemEnd = firstElemIdx;
  if (isOpeningDelimiter(prefix[firstElemIdx])) {
    const closing = findClosing(prefix, firstElemIdx + 1, flags);
    firstElemEnd = closing === -1 ? prefix.length : closing + 1;
  } else {
    for (let i = firstElemIdx; i < prefix.length; i++) {
      if (/\s|\(|\)|\[|\]|\{|\}/.test(prefix[i]) && !(prefix[i] === '"' && i > firstElemIdx)) {
        firstElemEnd = i;
        break;
      }
      if (i === prefix.length - 1) firstElemEnd = prefix.length;
    }
  }
  const symbol = prefix.slice(firstElemIdx, firstElemEnd);
  if (BODY_FORMS.has(symbol)) {
    return " ".repeat(openCol + BODY_INDENT_WIDTH);
  }
  const openLineNum = prefix.lastIndexOf("\n", openParenIdx);
  const firstArgIdx = findForward(prefix, firstElemEnd, prefix.length - 1, flags, (c) => !/\s/.test(c), false);
  if (firstArgIdx !== -1) {
    const firstArgLineNum = prefix.lastIndexOf("\n", firstArgIdx);
    if (firstArgLineNum === openLineNum) {
      return " ".repeat(getColumn(prefix, firstArgIdx));
    }
  }
  return " ".repeat(openCol + BODY_INDENT_WIDTH);
}

function getTopLevelIndentation(prefix: string, flags: Uint8Array): string {
  const scanIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, flags);
  if (scanIdx >= 0 && isClosingDelimiter(prefix[scanIdx])) {
    const matchingOpen = findOpener(prefix, scanIdx, flags, -1);
    if (matchingOpen !== -1) {
      return getIndentationAt(prefix, matchingOpen);
    }
  }
  const lastNewline = prefix.lastIndexOf("\n");
  const currentLine = lastNewline === -1 ? prefix : prefix.slice(lastNewline + 1);
  if (currentLine.trim() === "" && lastNewline !== -1) {
    return getIndentationAt(prefix, lastNewline);
  }
  return getIndentation(currentLine);
}

export function calculateIndentation(prefix: string): string {
  const lastNewlineIdx = prefix.lastIndexOf("\n");
  const lastLine = prefix.slice(lastNewlineIdx + 1);
  const { inString, flags } = parse(prefix);
  if (inString) {
      return "";
  }
  const openParenIdx = findOpener(prefix, prefix.length - 1, flags);
  if (openParenIdx === -1) {
    return getTopLevelIndentation(prefix, flags);
  }
  if (openParenIdx < lastNewlineIdx) {
    const scanIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, flags, lastNewlineIdx + 1);
    if (scanIdx !== -1 && !isClosingDelimiter(prefix[scanIdx])) {
      return getIndentation(lastLine);
    }
  }
  return getFormIndentation(prefix, openParenIdx, flags);
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
