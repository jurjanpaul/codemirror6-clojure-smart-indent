import { expect } from "chai";
import { calculateIndentation } from "../ts/cm6-clj-smart-indent.js";

function parseInput(input: string) {
  const cursor = input.indexOf("|");
  if (cursor === -1) throw new Error("Missing cursor marker '|'");
  return {
    buffer: input.replace("|", ""),
    cursor
  };
}

function formatOutput(buffer: string, cursor: number) {
  return buffer.slice(0, cursor) + "|" + buffer.slice(cursor);
}

function assertSmartIndent(expected: string, input: string) {
  const { buffer, cursor } = parseInput(input);
  const prefix = buffer.slice(0, cursor);
  const indentation = calculateIndentation(prefix);

  // Simulate behavior where pressing Enter on a whitespace-only line removes that whitespace
  const lastNewline = prefix.lastIndexOf('\n');
  const lastLine = prefix.slice(lastNewline + 1);
  let processedPrefix = prefix;
  if (lastNewline !== -1 && lastLine.trim() === "") {
      processedPrefix = prefix.slice(0, lastNewline + 1);
  }

  const newNewlineAndIndent = "\n" + indentation;
  const suffix = buffer.slice(cursor);
  const actual = formatOutput(processedPrefix + newNewlineAndIndent + suffix,
                              processedPrefix.length + newNewlineAndIndent.length);
  expect(actual).to.equal(expected);
}

describe("Clojure Smart Indent", () => {
  it("should preserve existing indentation on a simple line", () => {
    assertSmartIndent("  (foo)\n  |",
                      "  (foo)|");
  });

  it("should handle basic list indentation (placeholder test)", () => {
    assertSmartIndent("(defn foo [x]\n  |",
                      "(defn foo [x]|");
  });

  it("should align with first argument in a regular function call", () => {
    assertSmartIndent("(foo bar \n     |)",
                      "(foo bar |)");
  });

  it("should indent by 2 for body forms if no args on same line", () => {
    assertSmartIndent("(let \n  |",
                      "(let |");
  });

  it("should indent by 1 for vectors", () => {
    assertSmartIndent("[foo \n |]",
                      "[foo |]");
  });

  it("should handle nested structures", () => {
    assertSmartIndent("(defn foo [x]\n  (let [y \n        |]))",
                      "(defn foo [x]\n  (let [y |]))");
  });

  it("should ignore parens in strings", () => {
    assertSmartIndent("(println \"ignore )\"\n         |",
                      "(println \"ignore )\"|");
  });

  it("should ignore parens in comments", () => {
    assertSmartIndent("(defn foo [] ; ignore )\n  |",
                      "(defn foo [] ; ignore )|");
  });

  it("should respect manual indentation from previous line", () => {
    assertSmartIndent(
`(foo
    bar
    |)`,
`(foo
    bar|)`
    );
  });

  it("should dedent after closing a form", () => {
    assertSmartIndent(
`(foo
  (bar
    baz)
  |)`,
`(foo
  (bar
    baz)|)`
    );
  });

  it("should not indent when pressing Enter inside a string", () => {
    assertSmartIndent('(println "Hello\n|")',
                      '(println "Hello|")');
  });

  it("should not indent when pressing Enter inside a multi-line string", () => {
    assertSmartIndent(`(println "Hello\n  there\n|")`, `(println "Hello\n  there|")`);
  });

  it("should dedent correctly after multiple closing parentheses", () => {
    assertSmartIndent(
`(defn foo [x]
  (let [y 1]
    (println y)))
|`,
`(defn foo [x]
  (let [y 1]
    (println y)))|`
    );
  });

  it("should dedent correctly when closing paren is followed by comment", () => {
    assertSmartIndent(
`(let [x 1]
  x) ; comment
|`,
`(let [x 1]
  x) ; comment|`
    );
  });

  it("should apply proper indentation based on previous lines after a blank line", () => {
    assertSmartIndent(
`(let [x 1]

  |`,
`(let [x 1]
    |`
    );
  });
  it("should apply proper indentation based on previous lines after a line with only whitespace before the cursor", () => {
    assertSmartIndent('(let [x 1]\n\n  |xyz',
                      '(let [x 1]\n    |xyz');
  });
});
