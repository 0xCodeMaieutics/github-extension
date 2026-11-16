import { headLineOf } from "./diff"
import { findFileContainerOf } from "./files"

export interface CodeSelection {
  container: HTMLElement
  startLine: number
  endLine: number
}

function splitSideOf(node: Node): string | null {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest("[data-split-side]")?.getAttribute("data-split-side") ?? null
}

/** True when the range only touches the row's edge, e.g. a drag that ends at the start of the next line. */
function touchesOnlyEdge(range: Range, row: Element, edge: "start" | "end"): boolean {
  const slice = document.createRange()
  slice.selectNodeContents(row)
  if (edge === "start") slice.setEnd(range.endContainer, range.endOffset)
  else slice.setStart(range.startContainer, range.startOffset)
  return slice.toString().trim() === ""
}

/**
 * Reduces a text selection to a code selection: the inclusive range between the
 * first and last head-side lines it covers inside one file's diff, including
 * lines collapsed between hunks. Returns null for base-only selections and for
 * selections that cross into another file.
 */
export function toCodeSelection(range: Range): CodeSelection | null {
  if (range.collapsed) return null
  const container = findFileContainerOf(range.startContainer)
  if (!container || container !== findFileContainerOf(range.endContainer)) return null
  if (splitSideOf(range.startContainer) === "left" && splitSideOf(range.endContainer) === "left") return null

  const rows = [...container.querySelectorAll("tr")].filter((row) => range.intersectsNode(row))
  if (rows.length > 1 && touchesOnlyEdge(range, rows.at(-1)!, "start")) rows.pop()
  if (rows.length > 1 && touchesOnlyEdge(range, rows[0]!, "end")) rows.shift()

  const headLines = rows.flatMap((row) => headLineOf(row) ?? [])
  if (headLines.length === 0) return null
  return { container, startLine: Math.min(...headLines), endLine: Math.max(...headLines) }
}
