export interface IndentResult {
  buffer: string;
  cursor: number;
}

const BODY_FORMS = new Set([
  "->", "->>", "as->", "binding", "bound-fn", "case", "catch", "comment",
  "cond", "cond->", "cond->>", "condp", "def", "definterface", "defmethod",
  "defn", "defmacro", "defprotocol", "defrecord", "defstruct", "deftype",
  "do", "doseq", "dotimes", "doto", "extend", "extend-protocol",
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
 */
export function clojureSmartIndent(buffer: string, cursor: number): IndentResult {
  const prefix = buffer.slice(0, cursor);
  const suffix = buffer.slice(cursor);

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

function getParseState(text: string, index: number): { inString: boolean, inComment: boolean } {
  // Simple forward scan from start of line to see if index is in a comment or string
  const lastNewline = text.lastIndexOf("\n", index);
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
  let inString = false;
  let inComment = false;

  for (let i = lineStart; i < index; i++) {
    const char = text[i];
    if (inComment) continue;
    if (char === '"' && (i === 0 || text[i-1] !== '\\')) {
      inString = !inString;
    } else if (char === ';' && !inString) {
      inComment = true;
    }
  }
  return { inString, inComment };
}

function isInCommentOrString(text: string, index: number): boolean {
  const state = getParseState(text, index);
  return state.inString || state.inComment;
}

function findOpenDelimiter(prefix: string): number {
  let i = prefix.length - 1;
  let depth = 0;

  while (i >= 0) {
    const char = prefix[i];

    if (isInCommentOrString(prefix, i)) {
      i--;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth++;
    } else if (char === '(' || char === '[' || char === '{') {
      if (depth === 0) {
        return i;
      }
      depth--;
    }
    i--;
  }
  return -1;
}

export function calculateIndentation(prefix: string): string {
  // Check if we are inside a string
  const parseState = getParseState(prefix, prefix.length);
  if (parseState.inString) {
      return "";
  }

  const openParenIdx = findOpenDelimiter(prefix);

  if (openParenIdx === -1) {
    // Top level: match previous line indentation
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

  const openChar = prefix[openParenIdx];
  const openCol = getColumn(prefix, openParenIdx);

  if (openChar === '(') {
    // List indentation logic
    const rest = prefix.slice(openParenIdx + 1);
    const match = rest.match(/^([^\s\(\)\[\]\{\}]+)/);
    if (match) {
      const functionName = match[1];
      if (BODY_FORMS.has(functionName)) {
        return " ".repeat(openCol + 2);
      }

      // Regular function call: align with first argument if it's on the same line
      const afterFunction = rest.slice(functionName.length);
      const argMatch = afterFunction.match(/^[ \t]+([^\s])/);
      if (argMatch) {
        const firstArgIdx = openParenIdx + 1 + functionName.length + (afterFunction.indexOf(argMatch[1]));
        return " ".repeat(getColumn(prefix, firstArgIdx));
      }

      return " ".repeat(openCol + 2);
    }
    return " ".repeat(openCol + 1);
  } else {
    // Vector, Map, Set: align with first element or indent by 1
    const rest = prefix.slice(openParenIdx + 1);
    const argMatch = rest.match(/^[ \t]+([^\s])/);
    if (argMatch) {
      const firstArgIdx = openParenIdx + 1 + rest.indexOf(argMatch[1]);
      return " ".repeat(getColumn(prefix, firstArgIdx));
    }
    return " ".repeat(openCol + 1);
  }
}
