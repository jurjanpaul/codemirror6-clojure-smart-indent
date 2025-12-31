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

interface ParsedText {
  text: string;
  flags: Uint8Array;
}

function parse(text: string): ParsedText {
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
      }
      else {
        flags[i] = FLAG_STRING;
      }
    } else if (char === '"') {
      inString = true;
      flags[i] = FLAG_STRING;
    } else if (char === ';') {
      inComment = true;
      flags[i] = FLAG_COMMENT;
    }
  }
  return { text, flags }
}

function hasFlag(flags: Uint8Array, index: number, flag: number): boolean {
  return (flags[index] & flag) !== 0;
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

interface ScanOptions {
  match?: (char: string, index: number) => boolean;
  shouldSkip?: (parsed: ParsedText, index: number) => boolean;
}

function scan(parsed: ParsedText, index: number, limit: number, options: ScanOptions): number {
  const { match = () => true, shouldSkip = isIgnored } = options;
  const scanForward = index < limit;
  const step = scanForward ? 1 : -1;
  for (let i = index; scanForward ? i <= limit : i >= limit; i += step) {
    if (shouldSkip(parsed, i)) continue;
    if (match(parsed.text[i], i)) return i;
  }
  return -1;
}

function findLastSignificantCharIdx(parsed: ParsedText): number {
  return scan(parsed, parsed.text.length - 1, 0, { match: notWhitespace });
}

function findOpenDelimiter(parsed: ParsedText, index: number, limit: number = 0): number {
  let depth = 0;
  function match(char: string): boolean {
    if (isCloseDelimiter(char)) {
      depth++;
    } else if (isOpenDelimiter(char)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  }
  return scan(parsed, index, limit, { match });
}

/**
 * Reads a complete Clojure element starting from the given index.
 * This function correctly handles nested delimiters to ensure that
 * a full s-expression or literal is extracted as a single element.
 * @param parsed The parsed text.
 * @param index The starting index to read the element from.
 * @returns The extracted element as a string, or an empty string if the index is out of bounds.
 */
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
      if (i === parsed.text.length - 1 || isWhitespace(parsed.text[i + 1])) {
        return true;
      }
    }
    return depth < 0;
  }
  const lastCharIdx = scan(parsed, index, parsed.text.length - 1, { match: isEndOfElement });
  if (lastCharIdx === -1) {
    return parsed.text.slice(index);
  }
  return parsed.text.slice(index, lastCharIdx + 1);
}

function skipSpaceAndComments(parsed: ParsedText, index: number): number {
  if (index >= parsed.text.length) return -1;
  return scan(parsed, index, parsed.text.length - 1, { shouldSkip: isSpaceOrComment });
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

/**
 * Determines the indentation for a Clojure form based on its type and arguments.
 * It considers special forms (e.g., `def`, `fn`, `let`) that have specific indentation rules,
 * as well as general forms where arguments are aligned.
 * @param parsed The parsed text.
 * @param openParenIdx The index of the opening parenthesis of the form.
 * @returns The column where the current line should be indented.
 */
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

/**
 * Finds the index of the outermost unmatched close delimiter on a given line,
 * searching backward from the specified index. This is used for dedenting
 * when a closing delimiter is encountered.
 * @param parsed The parsed text.
 * @param index The starting index for the backward search.
 * @param minIndex The minimum index to search back to, typically the start of the current line.
 * @returns The index of the outermost close delimiter, or -1 if none is found.
 */
function findOutermostCloseDelimiter(parsed: ParsedText, index: number, minIndex: number = 0): number {
  let candidate = -1;
  let depth = 0;
  function trackOutermost(char: string, i: number): boolean {
    if (isCloseDelimiter(char)) {
      depth++;
      // We found a closing delimiter that might be the outermost one on this line.
      // If depth becomes 1, it means this delimiter is not matched by any following (to the right) opening delimiter we've seen so far.
      if (depth === 1) {
        candidate = i;
      }
    } else if (isOpenDelimiter(char) && depth > 0) {
      depth--;
      // If depth returns to 0, the candidate we were tracking was just matched by this opening delimiter.
      // So it wasn't the outermost unmatched delimiter after all.
      if (depth === 0) {
        candidate = -1;
      }
    }
    return false;
  }
  scan(parsed, index, minIndex, { match: trackOutermost });
  return candidate;
}

function dedent(parsed: ParsedText, index: number): number {
  return calculateIndentationInner({ text: parsed.text.slice(0, index) + "$",
                                     flags: parsed.flags });
}

function calculateIndentationInner(parsed: ParsedText): number {
  let lastSignificantCharIdx = findLastSignificantCharIdx(parsed);
  if (lastSignificantCharIdx === -1) {
    return 0;
  }
  const lastSignificantLineStart = getLineStart(parsed.text, lastSignificantCharIdx);
  const openParenIdx = findOpenDelimiter(parsed, lastSignificantCharIdx, lastSignificantLineStart);
  if (openParenIdx !== -1) {
    return getFormIndentation(parsed, openParenIdx);
  }
  const closeDelimiterIdx = findOutermostCloseDelimiter(parsed, lastSignificantCharIdx, lastSignificantLineStart);
  if (closeDelimiterIdx !== -1) {
    const matchingOpenIdx = findOpenDelimiter(parsed, closeDelimiterIdx - 1);
    if (matchingOpenIdx !== -1) {
      return dedent(parsed, matchingOpenIdx);
    }
  }
  const lastSignificantLine = parsed.text.slice(lastSignificantLineStart, lastSignificantCharIdx + 1);
  return getIndentationLength(lastSignificantLine);
}

/**
 * Calculates the indentation for a given Clojure code prefix.
 *
 * This function is primarily used for testing the indentation logic. It takes a string
 * of Clojure code as input and returns the calculated indentation in columns for the
 * last line.
 *
 * @param prefix The Clojure code prefix to calculate the indentation for.
 * @returns The calculated indentation in columns.
 */
export function calculateIndentation(prefix: string): number {
  if (prefix == "") {
    return 0;
  }
  const parsed = parse(prefix);
  if (inString(parsed, prefix.length - 1)) {
    return 0;
  }
  return calculateIndentationInner(parsed);
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
