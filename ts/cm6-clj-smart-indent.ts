import type { IndentContext } from "@codemirror/language"
import type { Extension, Facet } from "@codemirror/state"

export interface IndentResult {
  buffer: string;
  cursor: number;
}

const BODY_FORMS = new Set([
  "->", "->>", "as->", "binding", "bound-fn", "case", "catch", "comment",
  "cond", "cond->", "cond->>", "condp", "def", "definterface", "defmethod",
  "defn", "defn-", "defmacro", "defprotocol", "defrecord", "defstruct",
  "deftype", "do", "doseq", "dotimes", "doto", "extend", "extend-protocol",
  "extend-type", "fn", "for", "future", "if", "if-let", "if-not", "if-some",
  "let", "letfn", "locking", "loop", "ns", "proxy", "reify", "struct-map",
  "some->", "some->>", "try", "when", "when-first", "when-let", "when-not",
  "when-some", "while", "with-bindings", "with-bindings*", "with-in-str",
  "with-loading-context", "with-local-vars", "with-meta", "with-open",
  "with-out-str", "with-precision", "with-redefs", "with-redefs-fn"
]);

enum IndentRule {
  Body = 2,
  Inner = 1,
  Align = 0
}

export function clojureSmartIndent(buffer: string, cursor: number): IndentResult {
  let prefix = buffer.slice(0, cursor);
  const suffix = buffer.slice(cursor);
  const { inString, ignored } = getParseState(prefix, prefix.length);
  if (!inString) {
    const lastNewlineIdx = prefix.lastIndexOf("\n");
    const currentLine = prefix.slice(lastNewlineIdx + 1);
    if (currentLine.length > 0 && currentLine.trim() === "") {
      prefix = prefix.slice(0, lastNewlineIdx + 1);
      cursor = prefix.length;
    }
  }
  const indentation = calculateIndentation(prefix, inString, ignored);
  const newNewlineAndIndent = "\n" + indentation;
  return {
    buffer: prefix + newNewlineAndIndent + suffix,
    cursor: cursor + newNewlineAndIndent.length
  };
}

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

function getParseState(text: string, index: number): { inString: boolean, inComment: boolean, ignored: boolean[] } {
  const ignored = new Array(index).fill(false);
  let inString = false;
  let inComment = false;
  for (let i = 0; i < index; i++) {
    const char = text[i];
    if (inComment) {
      ignored[i] = true;
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      ignored[i] = true;
      if (char === '"' && (i === 0 || text[i-1] !== '\\')) inString = false;
      continue;
    }
    if (char === '"') {
      ignored[i] = true;
      inString = true;
    } else if (char === ';') {
      ignored[i] = true;
      inComment = true;
    }
  }
  return { inString, inComment, ignored };
}

function isOpeningDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isClosingDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function walkBackwards(text: string, index: number, minIndex: number, ignored: boolean[], callback: (char: string, i: number) => boolean | void): number {
  for (let i = index; i >= minIndex; i--) {
    if (ignored[i]) continue;
    if (callback(text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(text: string, index: number, ignored: boolean[], minIndex: number = 0): number {
  return walkBackwards(text, index, minIndex, ignored, (char) => !/\s/.test(char));
}

function findOpener(text: string, index: number, ignored: boolean[], depth: number = 0): number {
  return walkBackwards(text, index, 0, ignored, (char) => {
    if (isClosingDelimiter(char)) {
      depth++;
    } else if (isOpeningDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  });
}

function getFirstElementCol(prefix: string, startIdx: number): number | null {
  const rest = prefix.slice(startIdx);
  const match = rest.match(/^[ \t]+([^\s])/);
  if (match) {
    return getColumn(prefix, startIdx + rest.indexOf(match[1]));
  }
  return null;
}

function getFormIndentation(prefix: string, openParenIdx: number): string {
  const openChar = prefix[openParenIdx];
  const openCol = getColumn(prefix, openParenIdx);
  const rest = prefix.slice(openParenIdx + 1);
  let rule: IndentRule = IndentRule.Inner;
  let alignStartIdx = -1;
  let fallback: IndentRule = IndentRule.Inner;
  if (openChar === "(") {
    const symbolMatch = rest.match(/^([^\s\(\)\[\]\{\}]+)/);
    if (symbolMatch) {
      const symbolName = symbolMatch[1];
      if (BODY_FORMS.has(symbolName)) {
        rule = IndentRule.Body;
      } else {
        rule = IndentRule.Align;
        alignStartIdx = openParenIdx + 1 + symbolName.length;
        fallback = IndentRule.Body;
      }
    }
  } else {
    rule = IndentRule.Align;
    alignStartIdx = openParenIdx + 1;
    fallback = IndentRule.Inner;
  }
  if (rule === IndentRule.Align) {
    const alignCol = getFirstElementCol(prefix, alignStartIdx);
    if (alignCol !== null) return " ".repeat(alignCol);
    rule = fallback;
  }
  return " ".repeat(openCol + rule);
}

function getTopLevelIndentation(prefix: string, ignored: boolean[]): string {
  const scanIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, ignored);
  if (scanIdx >= 0 && isClosingDelimiter(prefix[scanIdx])) {
    const matchingOpen = findOpener(prefix, scanIdx, ignored, -1);
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

export function calculateIndentation(prefix: string, inString: boolean, ignored: boolean[]): string {
  const lastNewlineIdx = prefix.lastIndexOf("\n");
  const lastLine = prefix.slice(lastNewlineIdx + 1);
  if (lastNewlineIdx !== -1 && lastLine.trim() === "") {
    return "";
  }
  if (inString) {
      return "";
  }
  const openParenIdx = findOpener(prefix, prefix.length - 1, ignored);
  if (openParenIdx === -1) {
    return getTopLevelIndentation(prefix, ignored);
  }
  if (openParenIdx < lastNewlineIdx) {
    const scanIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, ignored, lastNewlineIdx + 1);
    if (scanIdx !== -1 && !isClosingDelimiter(prefix[scanIdx])) {
      return getIndentation(lastLine);
    }
  }
  return getFormIndentation(prefix, openParenIdx);
}

function smartIndent(context: IndentContext, pos: number): number | null {
  const prefix = context.state.doc.sliceString(0, pos);
  const { inString, ignored } = getParseState(prefix, prefix.length);
  const indentationString = calculateIndentation(prefix, inString, ignored);
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