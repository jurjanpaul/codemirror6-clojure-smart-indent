/**
 * @fileoverview This file implements a smart indentation logic for Clojure code within CodeMirror 6.
 * It parses the text to identify strings, comments, and escaped characters, then uses this information
 * to determine the correct indentation level based on Clojure's syntax, especially considering
 * opening and closing delimiters and special forms.
 */

import type { IndentContext } from "@codemirror/language"
import type { Extension, Facet } from "@codemirror/state"

const FLAG_ESCAPE = 1;
const FLAG_COMMENT = 2;
const FLAG_STRING = 4;

interface FlaggedText {
  text: string;
  flags: Uint8Array;
}

function flagCommentsAndStrings(text: string): FlaggedText {
  const size = text.length;
  const flags = new Uint8Array(size);
  let inString = false;
  let inComment = false;
  let escaped = false;
  for (let i = 0; i < size; i++) {
    const c = text[i];
    if (inComment) {
      flags[i] = FLAG_COMMENT;
      if (c === '\n') inComment = false;
    } else if (escaped) {
      flags[i] = FLAG_ESCAPE;
      escaped = false;
    } else if (c === '\\') {
      escaped = true;
    } else if (inString) {
      if (c === '"') {
        inString = false;
      }
      else {
        flags[i] = FLAG_STRING;
      }
    } else if (c === '"') {
      inString = true;
      flags[i] = FLAG_STRING;
    } else if (c === ';') {
      inComment = true;
      flags[i] = FLAG_COMMENT;
    }
  }
  return { text, flags }
}

function hasFlag(flags: Uint8Array, index: number, flag: number): boolean {
  return (flags[index] & flag) !== 0;
}

function isIgnored(flaggedText: FlaggedText, index: number): boolean {
  return hasFlag(flaggedText.flags, index, FLAG_STRING | FLAG_COMMENT | FLAG_ESCAPE);
}

function inString(flaggedText: FlaggedText, index: number): boolean {
  return hasFlag(flaggedText.flags, index, FLAG_STRING);
}

function inComment(flaggedText: FlaggedText, index: number): boolean {
  return hasFlag(flaggedText.flags, index, FLAG_COMMENT);
}

function getLineStart(text: string, index: number): number {
  const lastNewline = text.lastIndexOf("\n", index);
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

function getColumn(text: string, index: number): number {
  return index - getLineStart(text, index);
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "," || c === "\n" || c === "\r" || c === "\t";
}

function notWhitespace(c: string): boolean {
  return !isWhitespace(c);
}

function isSpaceOrComment(flaggedText: FlaggedText, i: number): boolean {
  return isWhitespace(flaggedText.text[i]) || inComment(flaggedText, i);
}

function isOpenDelimiter(c: string): boolean {
  return c === '(' || c === '[' || c === '{';
}

function isCloseDelimiter(c: string): boolean {
  return c === ')' || c === ']' || c === '}';
}

interface ScanOptions {
  match?: (c: string, index: number) => boolean;
  skip?: (flaggedText: FlaggedText, index: number) => boolean;
}

function scan(flaggedText: FlaggedText, index: number, limit: number, options: ScanOptions): number {
  const { match = () => true, skip = isIgnored } = options;
  const scanForward = index < limit;
  const step = scanForward ? 1 : -1;
  for (let i = index; scanForward ? i <= limit : i >= limit; i += step) {
    if (skip(flaggedText, i)) continue;
    if (match(flaggedText.text[i], i)) return i;
  }
  return -1;
}

function findLastCodeCharIdx(flaggedText: FlaggedText): number {
  return scan(flaggedText, flaggedText.text.length - 1, 0, { match: notWhitespace });
}

function findUnmatchedDelimiterInLine(flaggedText: FlaggedText, index: number, limit: number): number {
  let unclosedOpen = -1;
  let unopenedClose = -1;
  let depth = 0;
  const matchFn = (c: string, i: number): boolean => {
    if (isOpenDelimiter(c)) {
      if (depth === 0) {
        unclosedOpen = i;
        return true;
      }
      depth--;
      if (depth === 0) {
        unopenedClose = -1;
      }
    } else if (isCloseDelimiter(c)) {
      depth++;
      if (depth === 1) {
        unopenedClose = i;
      }
    }
    return false;
  };
  if (scan(flaggedText, index, limit, { match: matchFn }) !== -1) {
    return unclosedOpen;
  } else {
    return unopenedClose;
  }
}

function skipSpaceAndComments(flaggedText: FlaggedText, index: number): number {
  if (index >= flaggedText.text.length) return -1;
  return scan(flaggedText, index, flaggedText.text.length - 1, { skip: isSpaceOrComment });
}

function readElement(flaggedText: FlaggedText, index: number): string {
  if (index >= flaggedText.text.length) return "";
  let depth = 0;
  function isEndOfElement(c: string, i: number): boolean {
    if (isOpenDelimiter(c)) {
      depth++;
    } else if (isCloseDelimiter(c)) {
      depth--;
    }
    if (depth === 0) {
      if (i === flaggedText.text.length - 1 || isWhitespace(flaggedText.text[i + 1])) {
        return true;
      }
    }
    return depth < 0;
  }
  const lastCharIdx = scan(flaggedText, index, flaggedText.text.length - 1, { match: isEndOfElement });
  return flaggedText.text.slice(index, lastCharIdx + 1);
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

function formIndentation(flaggedText: FlaggedText, openParenIdx: number): number {
  const openCol = getColumn(flaggedText.text, openParenIdx);
  if (flaggedText.text[openParenIdx] === '(') {
    const firstElemIdx = skipSpaceAndComments(flaggedText, openParenIdx + 1);
    if (firstElemIdx === -1) return openCol + 1;
    const element = readElement(flaggedText, firstElemIdx);
    const firstElemEnd = firstElemIdx + element.length;
    if (BODY_FORMS.has(element)) {
      return openCol + 2;
    }
    const firstArgIdx = skipSpaceAndComments(flaggedText, firstElemEnd);
    if (firstArgIdx !== -1) {
      const firstArgLineStart = getLineStart(flaggedText.text, firstArgIdx);
      const lineStart = getLineStart(flaggedText.text, openParenIdx);
      if (firstArgLineStart === lineStart) {
        return getColumn(flaggedText.text, firstArgIdx);
      }
    }
  }
  return openCol + 1;
}

function findOpenDelimiter(flaggedText: FlaggedText, index: number, limit: number = 0): number {
  let depth = 0;
  function match(c: string): boolean {
    if (isCloseDelimiter(c)) {
      depth++;
    } else if (isOpenDelimiter(c)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  }
  return scan(flaggedText, index, limit, { match });
}

function dedent(flaggedText: FlaggedText, index: number): number {
  return calculateIndent({ text: flaggedText.text.slice(0, index) + "$",
                           flags: flaggedText.flags });
}

function calculateIndent(flaggedText: FlaggedText): number {
  const lastCodeCharIdx = findLastCodeCharIdx(flaggedText);
  if (lastCodeCharIdx === -1) {
    return 0;
  }
  const lastCodeLineStart = getLineStart(flaggedText.text, lastCodeCharIdx);
  const unmatchedDelimiterIdx = findUnmatchedDelimiterInLine(flaggedText, lastCodeCharIdx, lastCodeLineStart);
  if (unmatchedDelimiterIdx !== -1) {
    const c = flaggedText.text[unmatchedDelimiterIdx];
    if (isOpenDelimiter(c)) {
      return formIndentation(flaggedText, unmatchedDelimiterIdx);
    } else if (isCloseDelimiter(c)) {
      const matchingOpenIdx = findOpenDelimiter(flaggedText, unmatchedDelimiterIdx - 1);
      if (matchingOpenIdx !== -1) {
        return dedent(flaggedText, matchingOpenIdx);
      }
    }
  }
  const lastCodeLine = flaggedText.text.slice(lastCodeLineStart, lastCodeCharIdx + 1);
  return lastCodeLine.match(/^\s*/)![0].length;
}

/**
 * Calculates the indentation for a given Clojure code prefix.
 *
 * This function is primarily used for testing the indentation logic. It takes a string
 * of Clojure code as input and returns the calculated indentation in columns for the
 * new line.
 *
 * @param prefix The Clojure code prefix to calculate the indentation for.
 * @returns The calculated indentation in columns.
 */
export function calculateIndentation(prefix: string): number {
  if (prefix == "") {
    return 0;
  }
  const flaggedText = flagCommentsAndStrings(prefix);
  if (inString(flaggedText, prefix.length - 1)) {
    return 0;
  }
  return calculateIndent(flaggedText);
}

function smartIndent(context: IndentContext, pos: number): number | null {
  const prefix = context.state.doc.sliceString(0, pos);
  return calculateIndentation(prefix);
}

/**
 * Creates a CodeMirror 6 extension that provides smart indentation for Clojure code.
 *
 * This extension uses a parser to analyze the code and determine the correct indentation
 * level based on Clojure's syntax and conventions. It handles special forms, comments,
 * strings, and other language features to provide accurate and context-aware indentation.
 *
 * @param indentService The `indentService` facet from `@codemirror/language`.
 * @returns A CodeMirror 6 extension that provides smart indentation for Clojure.
 *
 * @example
 * ```javascript
 * import { EditorState } from "@codemirror/state";
 * import { EditorView } from "@codemirror/view";
 * import { clojure } from "@nextjournal/lang-clojure";
 * import { indentService } from "@codemirror/language";
 * import { clojureSmartIndentExtension } from "@jurjanpaul/codemirror6-clojure-smart-indent";
 *
 * new EditorView({
 *   state: EditorState.create({
 *     doc: "(defn foo [bar]\\n  (println bar))",
 *     extensions: [
 *       clojure(),
 *       clojureSmartIndentExtension(indentService)
 *     ],
 *   }),
 *   parent: document.body,
 * });
 * ```
 */
export function clojureSmartIndentExtension(indentService: Facet<(context: IndentContext, pos: number) => number | null | undefined>): Extension {
  return indentService.of(smartIndent)
}
