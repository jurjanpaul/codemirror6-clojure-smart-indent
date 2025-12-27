import type { IndentContext } from "@codemirror/language"
import type { Extension, Facet } from "@codemirror/state"

export interface IndentResult {
  buffer: string;
  cursor: number;
}

interface IndentStrategy {
  type: "body" | "align";
  count: number;
}

const INDENT_RULES: Record<string, IndentStrategy> = {
  "->": { type: "align", count: 1 },
  "->>": { type: "align", count: 1 },
  "as->": { type: "body", count: 2 },
  "binding": { type: "body", count: 1 },
  "bound-fn": { type: "body", count: 1 },
  "case": { type: "body", count: 1 },
  "catch": { type: "body", count: 2 },
  "comment": { type: "body", count: 0 },
  "cond": { type: "body", count: 0 },
  "cond->": { type: "body", count: 1 },
  "cond->>": { type: "body", count: 1 },
  "condp": { type: "body", count: 2 },
  "def": { type: "body", count: 1 },
  "definterface": { type: "body", count: 1 },
  "defmethod": { type: "body", count: 2 },
  "defn": { type: "body", count: 1 },
  "defn-": { type: "body", count: 1 },
  "defmacro": { type: "body", count: 1 },
  "defprotocol": { type: "body", count: 1 },
  "defrecord": { type: "body", count: 2 },
  "defstruct": { type: "body", count: 1 },
  "deftype": { type: "body", count: 2 },
  "do": { type: "body", count: 0 },
  "doseq": { type: "body", count: 1 },
  "dotimes": { type: "body", count: 1 },
  "doto": { type: "body", count: 1 },
  "extend": { type: "body", count: 1 },
  "extend-protocol": { type: "body", count: 1 },
  "extend-type": { type: "body", count: 1 },
  "fn": { type: "body", count: 1 },
  "for": { type: "body", count: 1 },
  "future": { type: "body", count: 0 },
  "if": { type: "body", count: 1 },
  "if-let": { type: "body", count: 1 },
  "if-not": { type: "body", count: 1 },
  "if-some": { type: "body", count: 1 },
  "let": { type: "body", count: 1 },
  "letfn": { type: "body", count: 1 },
  "locking": { type: "body", count: 1 },
  "loop": { type: "body", count: 1 },
  "ns": { type: "body", count: 1 },
  "proxy": { type: "body", count: 2 },
  "reify": { type: "body", count: 1 },
  "struct-map": { type: "body", count: 1 },
  "some->": { type: "body", count: 1 },
  "some->>": { type: "body", count: 1 },
  "try": { type: "body", count: 0 },
  "when": { type: "body", count: 1 },
  "when-first": { type: "body", count: 1 },
  "when-let": { type: "body", count: 1 },
  "when-not": { type: "body", count: 1 },
  "when-some": { type: "body", count: 1 },
  "while": { type: "body", count: 1 },
  "with-bindings": { type: "body", count: 1 },
  "with-bindings*": { type: "body", count: 1 },
  "with-in-str": { type: "body", count: 1 },
  "with-loading-context": { type: "body", count: 1 },
  "with-local-vars": { type: "body", count: 1 },
  "with-meta": { type: "body", count: 1 },
  "with-open": { type: "body", count: 1 },
  "with-out-str": { type: "body", count: 0 },
  "with-precision": { type: "body", count: 1 },
  "with-redefs": { type: "body", count: 1 },
  "with-redefs-fn": { type: "body", count: 1 }
};

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
  const rule = INDENT_RULES[symbol] || { type: "align", count: 1 };
  let argIndex = 0;
  let targetArgCol = -1;
  let firstArgColOnSameLine = -1;
  let curr = firstElemIdx;
  const openLineNum = prefix.lastIndexOf("\n", openParenIdx);
  while (curr < prefix.length) {
    const start = findForward(prefix, curr, prefix.length - 1, flags, (c) => !/\s/.test(c), false);
    if (start === -1) break;
    const startLineNum = prefix.lastIndexOf("\n", start);
    if (argIndex === 1 && startLineNum === openLineNum) firstArgColOnSameLine = getColumn(prefix, start);
    if (argIndex === rule.count) targetArgCol = getColumn(prefix, start);
    if (isOpeningDelimiter(prefix[start])) {
      const closing = findClosing(prefix, start + 1, flags);
      curr = closing === -1 ? prefix.length : closing + 1;
    } else if (isClosingDelimiter(prefix[start])) {
      break;
    } else if (prefix[start] === '"') {
       let i = start + 1;
       while (i < prefix.length && (prefix[i] !== '"' || prefix[i-1] === '\\')) i++;
       curr = i + 1;
    } else {
      let i = start;
      while (i < prefix.length && !/\s|\(|\)|\[|\]|\{|\}/.test(prefix[i])) i++;
      curr = i;
    }
    argIndex++;
  }
  if (rule.type === "body") {
    return " ".repeat(openCol + BODY_INDENT_WIDTH);
  } else {
    let indent = -1;
    if (argIndex > rule.count && targetArgCol !== -1) indent = targetArgCol;
    else if (firstArgColOnSameLine !== -1) indent = firstArgColOnSameLine;
    else indent = openCol + BODY_INDENT_WIDTH;
    return " ".repeat(indent);
  }
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
