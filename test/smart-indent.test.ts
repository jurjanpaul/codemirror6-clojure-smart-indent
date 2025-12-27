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
  const { buffer: expectedBuffer, cursor: expectedCursor } = parseInput(expected);
  const lastNewline = expectedBuffer.lastIndexOf('\n', expectedCursor);
  const expectedIndentation = expectedBuffer.slice(lastNewline + 1, expectedCursor);
  const { buffer, cursor } = parseInput(input);
  const prefix = buffer.slice(0, cursor);
  const actualIndentation = calculateIndentation(prefix);
  expect(actualIndentation).to.equal(expectedIndentation, `Indentation mismatch for input:\n${input}`);
}

describe("Clojure Smart Indent", () => {
  it("should preserve existing indentation on a simple line", () => {
    assertSmartIndent("  (foo)\n  |",
                      "  (foo)|");
  });

  it("should handle body indentation", () => {
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
    assertSmartIndent("(foo\n    bar\n    |)",
                      "(foo\n    bar|)");
  });

  it("should dedent after closing a form", () => {
    assertSmartIndent("(foo\n  (bar\n    baz)\n  |)",
                      "(foo\n  (bar\n    baz)|)");
  });

  it("should not indent when pressing Enter inside a string", () => {
    assertSmartIndent('(println "Hello\n|")',
                      '(println "Hello|")');
  });

  it("should not indent when pressing Enter inside a multi-line string", () => {
    assertSmartIndent("(println \"Hello\n  there\n|\")",
                      "(println \"Hello\n  there|\")");
  });

  it("should dedent correctly after multiple closing parentheses", () => {
    assertSmartIndent("(defn foo [x]\n  (let [y 1]\n    (println y)))\n|",
                      "(defn foo [x]\n  (let [y 1]\n    (println y)))|");
  });

  it("should dedent correctly when closing paren is followed by comment", () => {
    assertSmartIndent("(let [x 1]\n  x) ; comment\n|",
                      "(let [x 1]\n  x) ; comment|");
  });

  it("should apply proper indentation based on previous lines after a blank line", () => {
    assertSmartIndent("(let [x 1]\n\n  |",
                      "(let [x 1]\n    |");
  });

  it("should apply proper indentation based on previous lines after a line with only whitespace before the cursor", () => {
    assertSmartIndent('(let [x 1]\n\n  |xyz',
                      '(let [x 1]\n    |xyz');
  });

  it("should align ->> forms with the first argument if present", () => {
    assertSmartIndent("(->> data\n     |)",
                      "(->> data|)");
  });

  it("should indent ->> body by 2 spaces if there is no first argument yet", () => {
    assertSmartIndent("(->>\n  |)",
                      "(->>|)");
  });

  it("should indent ->> body by 2 spaces if first argument is on next line", () => {
    assertSmartIndent("(->>\n  data\n  |)",
                      "(->>\n  data|)");
  });

  it("should align subsequent forms with the first argument even if it was on a new line", () => {
     assertSmartIndent("(->>\n  data\n  (map inc)\n  |)",
                       "(->>\n  data\n  (map inc)|)");
  });

  it("should handle escaped backslashes correctly", () => {
    assertSmartIndent('(let [x "\\\\"]\n  |)',
                      '(let [x "\\\\"]\n  |)');
  });

  it("should ignore character literals like \\(", () => {
    assertSmartIndent("(defn foo []\n  \\(\n  |)",
                      "(defn foo []\n  \\(\n  |)");
  });

  it("should ignore comments when looking for the first argument to align with", () => {
    assertSmartIndent("(foo ; comment\n  |)",
                      "(foo ; comment|)");
  });
});