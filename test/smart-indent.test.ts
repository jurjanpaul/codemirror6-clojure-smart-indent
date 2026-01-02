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

function assertSmartIndent(expected: string, input: string) {
  const { buffer, cursor } = parseInput(input);
  const prefix = buffer.slice(0, cursor);
  const actualIndentLength = calculateIndentation(prefix);
  const indent = " ".repeat(actualIndentLength);
  const actualResult = input.replace("|", `\n${indent}|`);
  expect(actualResult).to.equal(expected, `Result mismatch for input:\n${input}`);
}

describe("Clojure Smart Indent", () => {
  describe("Empty or Whitespace-only Documents", () => {
    it("should return 0 indentation for an empty document", () => {
      assertSmartIndent("\n|",
                        "|");
    });
    it("should return 0 indentation for a document with only whitespace", () => {
      assertSmartIndent("   \n|",
                        "   |");
    });
    it("should return 0 indentation for a document with only newlines", () => {
      assertSmartIndent("\n\n\n|",
                        "\n\n|");
    });
  });

  describe("Basic Lists and Vectors", () => {
    it("should align arguments with the first argument on the same line", () => {
      assertSmartIndent("(foo bar \n     |)",
                        "(foo bar |)");
    });
    it("should indent by 1 space if no arguments are on the same line", () => {
      assertSmartIndent("(foo\n |)",
                        "(foo|)");
    });
    it("should indent vector elements by 1 space", () => {
      assertSmartIndent("[foo \n |]",
                        "[foo |]");
    });
    it("should handle nested function calls", () => {
      assertSmartIndent("(foo [x]\n  (bar [y \n        |]))",
                        "(foo [x]\n  (bar [y |]))");
    });
  });

  describe("Body Forms (Special Indentation)", () => {
    it("should indent body forms (e.g., defn) by 2 spaces", () => {
      assertSmartIndent("(defn foo [x]\n  |",
                        "(defn foo [x]|");
    });
    it("should indent 'let' bindings by 2 spaces if no bindings are on the first line", () => {
      assertSmartIndent("(let \n  |",
                        "(let |");
    });
    it("should align threading macros (->>) with the first argument if present", () => {
      assertSmartIndent("(->> data\n     |)",
                        "(->> data|)");
    });
    it("should indent threading macros (->>) by 1 space if no argument is present yet", () => {
      assertSmartIndent("(->>\n |)",
                        "(->>|)");
    });
    it("should align subsequent forms in a threading macro with the first argument", () => {
       assertSmartIndent("(->>\n  data\n  (map inc)\n  |)",
                         "(->>\n  data\n  (map inc)|)");
    });
  });

  describe("Forms with Prefixes", () => {
    it("should dedent to the start of the set literal", () => {
      assertSmartIndent("#{1\n  2}\n|",
                        "#{1\n  2}|");
    });
    it("should dedent to the start of the reader conditional", () => {
      assertSmartIndent("#?(:clj 1\n   :cljs 2)\n|",
                        "#?(:clj 1\n   :cljs 2)|");
    });
    it("should dedent to the start of the anonymous function literal", () => {
      assertSmartIndent("#(\n  inc %)\n|",
                        "#(\n  inc %)|");
    });
    it("should dedent to the start of the metadata map", () => {
      assertSmartIndent("^{\n  :a 1}\n|",
                        "^{\n  :a 1}|");
    });
    it("should dedent correctly after an ignored form", () => {
      assertSmartIndent("#_ (\n  ignore me)\n|",
                        "#_ (\n  ignore me)|");
    });
  });

  describe("Prefixed Forms as First Elements", () => {
    it("should align with the start of a set literal prefix (#)", () => {
      assertSmartIndent("(#{1 2 3}\n |)",
                        "(#{1 2 3}|)");
    });
    it("should align with the start of an anonymous function prefix (#)", () => {
      assertSmartIndent("(#(println %)\n |)",
                        "(#(println %)|)");
    });
    it("should align with the start of a metadata map prefix (^)", () => {
      assertSmartIndent("(^{:tag String}\n |)",
                        "(^{:tag String}|)");
    });
    it("should align with the start of a reader conditional prefix (#?)", () => {
      assertSmartIndent("(#?(:clj 1 :cljs 2)\n |)",
                        "(#?(:clj 1 :cljs 2)|)");
    });
    it("should align with the start of a var prefix (#'')", () => {
      assertSmartIndent("(#'my-var\n |)",
                        "(#'my-var|)");
    });
    it("should align with the start of a regex prefix (#\")", () => {
      assertSmartIndent("(#\"my-regex\"\n |)",
                        "(#\"my-regex\"|)");
    });
  });

  describe("Context Sensitivity (Strings, Comments, Literals)", () => {
    it("should ignore parentheses inside strings", () => {
      assertSmartIndent("(println \"ignore )\"\n         |)",
                        "(println \"ignore )\"|)");
    });
    it("should ignore parentheses inside comments", () => {
      assertSmartIndent("(defn foo [] ; ignore )\n  |",
                        "(defn foo [] ; ignore )|");
    });
    it("should not indent when pressing Enter inside a string", () => {
      assertSmartIndent('(println "Hello\n|")',
                        '(println "Hello|")');
    });
    it("should not indent when pressing Enter inside a multi-line string", () => {
      assertSmartIndent("(println \"Hello\n  there\n|\")",
                        "(println \"Hello\n  there|\")");
    });
    it("should handle escaped backslashes correctly", () => {
      assertSmartIndent('(let [x "\\\\"]\n  |)',
                        '(let [x "\\\\"]|)');
    });
    it("should ignore character literals containing delimiters (e.g., \\()", () => {
      assertSmartIndent("(defn foo []\n  \\(\n  |)",
                        "(defn foo []\n  \\(|)");
    });
    it("should ignore comments when searching for the first argument alignment", () => {
      assertSmartIndent("(foo ; comment\n |)",
                        "(foo ; comment|)");
    });
  });

  describe("Dedenting and Closing Forms", () => {
    it("should return to previous indentation after closing a form", () => {
      assertSmartIndent("(foo\n  (bar\n    baz)\n  |)",
                        "(foo\n  (bar\n    baz)|)");
    });
    it("should dedent correctly after multiple closing parentheses", () => {
      assertSmartIndent("(defn foo [x]\n  (let [y 1]\n    (println y)))\n|",
                        "(defn foo [x]\n  (let [y 1]\n    (println y)))|");
    });
    it("should dedent correctly when the closing parenthesis is followed by a comment", () => {
      assertSmartIndent("(let [x 1]\n  x) ; comment\n|",
                        "(let [x 1]\n  x) ; comment|");
    });
    it("should align with the opening paren of the form that just closed (manual indent style)", () => {
      assertSmartIndent("  (foo\n    bar)\n  |",
                        "  (foo\n    bar)|");
    });
    it("should dedent to the correct level within a deeply nested form (failing test)", () => {
      assertSmartIndent(
        "(a 1\n (b 2\n  (c 3\n   (d 4)))\n |)",
        "(a 1\n (b 2\n  (c 3\n   (d 4)))|)"
      );
    });
    it("should dedent to the correct level within a deeply nested form with manual indentation", () => {
      assertSmartIndent(
        "(a 1\n           (b 2\n  (c 3\n   (d 4)))\n           |)",
        "(a 1\n           (b 2\n  (c 3\n   (d 4)))|)"
      );
    });
  });

  describe("Blank Lines and Manual Indentation", () => {
    it("should preserve indentation of the previous line", () => {
      assertSmartIndent("  (foo)\n  |",
                        "  (foo)|");
    });
    it("should preserve manual indentation from the previous line", () => {
      assertSmartIndent("(foo\n      bar\n      |)",
                        "(foo\n      bar|)");
    });
    it("should use indentation of the last significant line if the current line is blank", () => {
      assertSmartIndent("(let [x 1]\n\n  |",
                        "(let [x 1]\n|");
    });
    it("should use indentation of the last significant line if current line has only whitespace", () => {
      assertSmartIndent('(let [x 1]\n\n  |xyz',
                        '(let [x 1]\n|xyz');
    });
    it("should respect manual indentation even across blank lines within a form", () => {
      assertSmartIndent("(defn foo [x]\n    (manual-indent)\n\n    |)",
                        "(defn foo [x]\n    (manual-indent)\n|)");
    });
  });
});
