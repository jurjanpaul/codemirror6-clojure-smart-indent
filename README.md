# codemirror6-clojure-smart-indent

Clojure Smart Indent extension for CodeMirror 6.

## Installation

```bash
npm install @jurjanpaul/codemirror6-clojure-smart-indent
```

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
  parent: document.body,
});
```