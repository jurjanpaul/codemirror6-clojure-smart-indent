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

function assertSmartIndent(expected: string, input: string) {
  const { buffer, cursor } = parse(input);
  const result = clojureSmartIndent(buffer, cursor);
  const actual = format(result.buffer, result.cursor);
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
    assertSmartIndent("(defn foo [] ; ignore )\n  \n  |",
                      "(defn foo [] ; ignore )\n  |");
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
});
