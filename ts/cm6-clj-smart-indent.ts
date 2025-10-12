import { EditorState } from "@codemirror/state"
import type { Extension, Facet } from "@codemirror/state"
import { syntaxTree, IndentContext } from "@codemirror/language"
import type { SyntaxNode } from "@lezer/common"
import { props } from "@nextjournal/lezer-clojure" // skipLibCheck to work around incomplete, inconsistent declaration
const {coll} = props

function nodeText(state: EditorState, node: SyntaxNode) {
  return state.doc.sliceString(node.from, node.to)
}

function createLookupMap(words: string[]) {
  var obj: { [key: string]: boolean } = {}
  for (var i = 0; i < words.length; ++i) {
     obj[words[i]] = true
  }
  return obj
}

const haveBodyParameter = [
  "->", "->>", "as->", "binding", "bound-fn", "case", "catch", "comment",
  "cond", "cond->", "cond->>", "condp", "def", "definterface", "defmethod",
  "defn", "defmacro", "defprotocol", "defrecord", "defstruct", "deftype",
  "do", "doseq", "dotimes", "doto", "extend", "extend-protocol",
  "extend-type", "fn", "for", "future", "if", "if-let", "if-not", "if-some",
  "let", "letfn", "locking", "loop", "ns", "proxy", "reify", "struct-map",
  "some->", "some->>", "try", "when", "when-first", "when-let", "when-not",
  "when-some", "while", "with-bindings", "with-bindings*", "with-in-str",
  "with-loading-context", "with-local-vars", "with-meta", "with-open",
  "with-out-str", "with-precision", "with-redefs", "with-redefs-fn"]
const hasBodyParameter = createLookupMap(haveBodyParameter)

function nextNodeOnSameLine(state: EditorState, node: SyntaxNode) {
  const line = state.doc.lineAt(node.from);
  let nextNode = node.nextSibling;
  while (nextNode && nextNode.type.isSkipped && nextNode.to < line.to) {
     nextNode = nextNode.nextSibling;
  }
  if (nextNode && !nextNode.type.isSkipped && nextNode.to < line.to) {
    return nextNode;
  }
}

function clojureSmartIndent(context: IndentContext, pos: number): number {
  console.log("clojureSmartIndent invoked")
  const { state } = context
  const tree = syntaxTree(state)
  const node = tree.resolveInner(pos, -1)
  console.log(node)
  console.log(node.type.prop(coll), "...", node.firstChild)
  if (node.type.prop(coll) && node.firstChild) {
    const parentBase = context.column(node.firstChild.to) // column at the right of parent opening-(
    console.log("clojureSmartIndent:parentBase=" + parentBase + ", pos=" + pos)
    const startSymbolNode = node.firstChild.nextSibling
    if ("List" == node.name && startSymbolNode) {
      if (hasBodyParameter[(nodeText(state, startSymbolNode))]) {
        return parentBase + 1
      }
      const nextNode = nextNodeOnSameLine(state, startSymbolNode)
      if (nextNode) {
        return context.column(nextNode.from)
      }
    }
    return parentBase
  }
  console.log("returning 0")
  return 0
}

/**
 * Initialises the Clojure Smart Indent extension for CodeMirror6.
 * @param indentService @codemirror/language.indentService
 * @returns the CodeMirror6 Clojure Smart Indent extension in the form of an array of extensions
 */
export function clojureSmartIndentExtension(indentService: Facet<(context: IndentContext, pos: number) => number | null | undefined>): Extension {
  console.log("init clojureSmartIndentExtension")
  return indentService.of(clojureSmartIndent)
}
