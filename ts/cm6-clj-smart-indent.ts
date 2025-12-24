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
  const state = getParseState(prefix, prefix.length);
  if (!state.inString) {
    const lastNewlineIdx = prefix.lastIndexOf("\n");
    const currentLine = prefix.slice(lastNewlineIdx + 1);
    if (currentLine.length > 0 && currentLine.trim() === "") {
      prefix = prefix.slice(0, lastNewlineIdx + 1);
      cursor = prefix.length;
    }
  }
  const indentation = calculateIndentation(prefix);
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

function getParseState(text: string, index: number): { inString: boolean, inComment: boolean } {
  let inString = false;
  let inComment = false;
  for (let i = 0; i < index; i++) {
    const char = text[i];
    if (inComment) {
      if (char === '\n') {
        inComment = false;
      }
      continue;
    }
    if (inString) {
      if (char === '"' && (i === 0 || text[i-1] !== '\\')) {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === ';') {
      inComment = true;
    }
  }
  return { inString, inComment };
}

function isInCommentOrString(text: string, index: number): boolean {
  const state = getParseState(text, index);
  return state.inString || state.inComment;
}

function isOpeningDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isClosingDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function walkBackwards(text: string, index: number, minIndex: number, callback: (char: string, i: number) => boolean | void): number {
  for (let i = index; i >= minIndex; i--) {
    if (isInCommentOrString(text, i) || text[i] === ';') {
      continue;
    }
    if (callback(text[i], i)) {
      return i;
    }
  }
  return -1;
}

function findLastSignificantCharIdx(text: string, index: number, minIndex: number = 0): number {
  return walkBackwards(text, index, minIndex, (char) => !/\s/.test(char));
}

function findOpenDelimiter(prefix: string): number {
  let depth = 0;
  return walkBackwards(prefix, prefix.length - 1, 0, (char) => {
    if (isClosingDelimiter(char)) {
      depth++;
    } else if (isOpeningDelimiter(char)) {
      if (depth === 0) {
        return true;
      }
      depth--;
    }
    return false;
  });
}

function findMatchingOpener(prefix: string, closeIdx: number): number {
  let depth = 1;
  return walkBackwards(prefix, closeIdx - 1, 0, (char) => {
    if (isClosingDelimiter(char)) {
      depth++;
    } else if (isOpeningDelimiter(char)) {
      depth--;
      if (depth === 0) {
        return true;
      }
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

function getTopLevelIndentation(prefix: string): string {
  const scanIdx = findLastSignificantCharIdx(prefix, prefix.length - 1);
  if (scanIdx >= 0 && isClosingDelimiter(prefix[scanIdx])) {
    const matchingOpen = findMatchingOpener(prefix, scanIdx);
    if (matchingOpen !== -1) {
      return getIndentation(getLineAt(prefix, matchingOpen));
    }
  }
  const lastNewline = prefix.lastIndexOf("\n");
  if (lastNewline === -1) return "";
  const currentLine = prefix.slice(lastNewline + 1);
  if (currentLine.trim() === "") {
    return getIndentation(getLineAt(prefix, lastNewline));
  }
  return getIndentation(currentLine);
}

export function calculateIndentation(prefix: string): string {
  const parseState = getParseState(prefix, prefix.length);
  if (parseState.inString) {
      return "";
  }
  const lastNewlineIdx = prefix.lastIndexOf("\n");
  const lastLine = prefix.slice(lastNewlineIdx + 1);
  if (lastLine.trim() === "" && lastNewlineIdx !== -1) {
      return "";
  }
  const openParenIdx = findOpenDelimiter(prefix);
  if (openParenIdx === -1) {
    return getTopLevelIndentation(prefix);
  }
  if (openParenIdx < lastNewlineIdx) {
    const scanIdx = findLastSignificantCharIdx(prefix, prefix.length - 1, lastNewlineIdx + 1);
    if (scanIdx !== -1 && !isClosingDelimiter(prefix[scanIdx])) {
      return getIndentation(lastLine);
    }
  }
  return getFormIndentation(prefix, openParenIdx);
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