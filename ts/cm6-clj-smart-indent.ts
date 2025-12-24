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

/**
 * A pure function that takes a buffer and cursor position (before pressing Enter),
 * and returns the new buffer and cursor position after Enter and smart indentation.
 * Used for testing purposes.
 */
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

function getLineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

function getIndentation(line: string): string {
  const match = line.match(/^[ \t]*/);
  return match ? match[0] : "";
}

function isOpeningDelimiter(char: string): boolean {
  return char === '(' || char === '[' || char === '{';
}

function isClosingDelimiter(char: string): boolean {
  return char === ')' || char === ']' || char === '}';
}

function getColumn(text: string, index: number): number {
  const lastNewline = text.lastIndexOf("\n", index);
  return index - (lastNewline === -1 ? 0 : lastNewline + 1);
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

function findBackwards(text: string, index: number, initialDepth: number, stopFn: (char: string, depth: number) => boolean): number {
  let i = index;
  let depth = initialDepth;

  while (i >= 0) {
    if (isInCommentOrString(text, i)) {
      i--;
      continue;
    }
    const char = text[i];
    if (isOpeningDelimiter(char)) {
      if (stopFn(char, depth)) return i;
      depth--;
    } else if (isClosingDelimiter(char)) {
      depth++;
    } else {
      if (stopFn(char, depth)) return i;
    }
    i--;
  }
  return -1;
}

function findOpenDelimiter(prefix: string): number {
  return findBackwards(prefix, prefix.length - 1, 0, (char, depth) => depth === 0 && isOpeningDelimiter(char));
}

function findMatchingOpener(prefix: string, closeIdx: number): number {
  return findBackwards(prefix, closeIdx - 1, 1, (char, depth) => depth === 1 && isOpeningDelimiter(char));
}

function getListIndentation(prefix: string, openParenIdx: number): string {
  const openCol = getColumn(prefix, openParenIdx);
  const rest = prefix.slice(openParenIdx + 1);
  const match = rest.match(/^([^\s\(\)\[\]\{\}]+)/);

  if (match) {
    const functionName = match[1];
    if (BODY_FORMS.has(functionName)) return " ".repeat(openCol + 2);

    const afterFunction = rest.slice(functionName.length);
    const argMatch = afterFunction.match(/^[ \t]+([^\s])/);
    if (argMatch) {
      const firstArgIdx = openParenIdx + 1 + functionName.length + (afterFunction.indexOf(argMatch[1]));
      return " ".repeat(getColumn(prefix, firstArgIdx));
    }
    return " ".repeat(openCol + 2);
  }
  return " ".repeat(openCol + 1);
}

function getCollectionIndentation(prefix: string, openParenIdx: number): string {
  const openCol = getColumn(prefix, openParenIdx);
  const rest = prefix.slice(openParenIdx + 1);
  const argMatch = rest.match(/^[ \t]+([^\s])/);
  if (argMatch) {
    const firstArgIdx = openParenIdx + 1 + rest.indexOf(argMatch[1]);
    return " ".repeat(getColumn(prefix, firstArgIdx));
  }
  return " ".repeat(openCol + 1);
}

export function calculateIndentation(prefix: string): string {
  // Check if we are inside a string
  const parseState = getParseState(prefix, prefix.length);
  if (parseState.inString) {
      return "";
  }

  // High precedence rule: never indent after a blank line
  const lines = prefix.split("\n");
  if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      if (lastLine.trim() === "") {
          return "";
      }
  }

  const openParenIdx = findOpenDelimiter(prefix);

  if (openParenIdx === -1) {
    // Top level: check if we just closed a form
    let scanIdx = prefix.length - 1;
    // Skip whitespace and comments backwards to find the last significant char
    while (scanIdx >= 0) {
        const char = prefix[scanIdx];
        if (/\s/.test(char)) {
            scanIdx--;
            continue;
        }

        const state = getParseState(prefix, scanIdx + 1); 
        if (state.inComment || state.inString) {
            scanIdx--;
            continue;
        }

        break;
    }

    if (scanIdx >= 0) {
        const lastChar = prefix[scanIdx];
        if (lastChar === ')' || lastChar === ']' || lastChar === '}') {
            const matchingOpen = findMatchingOpener(prefix, scanIdx);
            if (matchingOpen !== -1) {
                const lineStart = prefix.lastIndexOf('\n', matchingOpen) + 1;
                const line = prefix.slice(lineStart);
                const match = line.match(/^[ \t]*/);
                return match ? match[0] : "";
            }
        }
    }

    // Fallback: match previous line indentation
    const lines = prefix.split("\n");
    let refLine = lines[lines.length - 1];
    if (refLine.trim() === "" && lines.length > 1) {
        refLine = lines[lines.length - 2];
    }
    const match = refLine.match(/^[ \t]*/);
    return match ? match[0] : "";
  }

  const lastNewlineIdx = prefix.lastIndexOf("\n");
  if (openParenIdx < lastNewlineIdx) {
    let scanIdx = prefix.length - 1;
    let foundCloser = false;
    let foundContent = false;

    while (scanIdx > lastNewlineIdx) {
      const char = prefix[scanIdx];
      if (/\s/.test(char)) {
        scanIdx--;
        continue;
      }

      if (isInCommentOrString(prefix, scanIdx)) {
        scanIdx--;
        continue;
      }

      if (char === ';') {
        scanIdx--;
        continue;
      }

      if (char === ')' || char === ']' || char === '}') {
        foundCloser = true;
      } else {
        foundContent = true;
      }
      break;
    }

    if (!foundCloser && foundContent) {
       const lastLine = prefix.slice(lastNewlineIdx + 1);
       const match = lastLine.match(/^[ \t]*/);
       if (match) {
         return match[0];
       }
    }
  }

  return prefix[openParenIdx] === '(' 
    ? getListIndentation(prefix, openParenIdx) 
    : getCollectionIndentation(prefix, openParenIdx);
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
