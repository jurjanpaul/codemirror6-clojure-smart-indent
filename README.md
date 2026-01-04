# codemirror6-clojure-smart-indent

<span><a href="https://www.npmjs.com/package/@jurjanpaul/codemirror6-clojure-smart-indent" title="NPM version badge"><img src="https://img.shields.io/npm/v/@jurjanpaul/codemirror6-clojure-smart-indent?color=blue" alt="NPM version badge" /></a></span>

Clojure Smart Indentation extension for [CodeMirror 6](https://codemirror.net/).

The indentation follows the [Clojure Styleguide](https://github.com/bbatsov/clojure-style-guide) in case the last line of code before the cursor contains any unmatched open or close delimiter character, i.e. `(`, `[`, `{`, `}`, `]` or `)`. Otherwise, the current (custom) indentation is followed. Comments are skipped and no smart indentation is applied within strings.

For simplicity's sake no distinction is made between the different types of open and closing delimiters. (A form of structural editing is assumed - tested with Parinfer - that forces each open delimiter to be properly closed with a matching closing delimiter.) The use of tab characters is not supported: they are counted as single spaces.

## Usage

This package provides a CodeMirror 6 extension for smart Clojure indentation.

```javascript
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { clojure } from "@nextjournal/lang-clojure";
import { indentService } from "@codemirror/language";
import { clojureSmartIndentExtension } from "@jurjanpaul/codemirror6-clojure-smart-indent";

new EditorView({
  state: EditorState.create({
    doc: "(defn foo [bar]\n  (println bar))",
    extensions: [
      clojure(),
      clojureSmartIndentExtension(indentService)
    ],
  }),
  parent: document.getElementById("editor")
});
```

Note the need to pass in the `indentService` (to prevent ending up with separate instances).

## Demo

A demo editor is provided in `demo/index.html`.

## Motivation

After upgrading [Away from Preferred Editor ClojureScript Playground](https://github.com/jurjanpaul/ape-cljs-playground) from CodeMirror 5 to CodeMirror 6 (and [making Parinfer work](https://github.com/jurjanpaul/codemirror6-parinfer)), it became clear that the de facto standard [Clojure language extension by Nextjournal](https://github.com/nextjournal/lang-clojure) did not provide Smart Indentation the way [the original Clojure mode](https://github.com/codemirror/codemirror5/tree/master/mode/clojure) had. With a fork I got it to somewhat work, but given the fact that these days a number of competing indentation styles are in use within the Clojure community it always seemed better to make this into its own extension.

## Future
Nothing planned, but if the need arises I can imagine adding an option that allows specifying custom 'body form' symbols.

## Approach

Indentation is determined by scanning characters in the text before the cursor.

Originally, I hoped to be able to take advantage of the existing [Clojure Lezer](https://github.com/nextjournal/lezer-clojure) parser. This worked quite well in a fork of [@nextjournal/lang-clojure](https://github.com/nextjournal/lang-clojure), but I wanted this to be a separate extension and in that context using the existing parser and syntax tree to determine smart indentation proved a lot more involved than I expected. Perhaps I will revisit the approach at some point.
