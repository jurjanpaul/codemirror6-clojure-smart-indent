import { expect } from "chai";
import { clojureSmartIndent } from "../ts/clojure-smart-indent.js";

function parse(input: string) {
  const cursor = input.indexOf("|");
  if (cursor === -1) throw new Error("Missing cursor marker '|'");
  return {
    buffer: input.replace("|", ""),
    cursor
  };
}

function format(buffer: string, cursor: number) {
  return buffer.slice(0, cursor) + "|" + buffer.slice(cursor);
}

function runTest(input: string, expected: string) {
  const { buffer, cursor } = parse(input);
  const result = clojureSmartIndent(buffer, cursor);
  const actual = format(result.buffer, result.cursor);
  expect(actual).to.equal(expected);
}

describe("Clojure Smart Indent", () => {
  it("should preserve existing indentation on a simple line", () => {
    runTest("  (foo)|", "  (foo)\n  |");
  });

  it("should handle basic list indentation (placeholder test)", () => {
    runTest("(defn foo [x]|)", "(defn foo [x]\n  |)");
  });

  it("should align with first argument in a regular function call", () => {
    runTest("(foo bar |)", "(foo bar \n     |)");
  });

  it("should indent by 2 for body forms if no args on same line", () => {
    runTest("(let |)", "(let \n  |)");
  });

  it("should indent by 1 for vectors", () => {
    runTest("[foo |]", "[foo \n |]");
  });

  it("should handle nested structures", () => {
    runTest("(defn foo [x]\n  (let [y |]))", "(defn foo [x]\n  (let [y \n        |]))");
  });

  it("should ignore parens in strings", () => {
    runTest("(println \"ignore )\"|)", "(println \"ignore )\"\n         |)");
  });

  it("should ignore parens in comments", () => {
    runTest("(defn foo [] ; ignore )\n  |)", "(defn foo [] ; ignore )\n  \n  |)");
  });

  it("should respect manual indentation from previous line", () => {
    runTest(
`(foo
    bar|)`,
`(foo
    bar
    |)`
    );
  });

  it("should dedent after closing a form", () => {
    runTest(
`(foo
  (bar
    baz)|)`,
`(foo
  (bar
    baz)
  |)`
    );
  });
});
