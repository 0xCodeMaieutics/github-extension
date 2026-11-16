import { beforeEach, describe, expect, it } from "vitest"
import { toCodeSelection } from "../lib/file-opener/selection"
import { classicFile, diffId } from "./fixtures"

function codeCells(path: string): Element[] {
  return [...document.getElementById(diffId(path))!.querySelectorAll(".blob-code-inner")]
}

function rangeOver(start: Node, end: Node, endOffset = end.childNodes.length): Range {
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, endOffset)
  return range
}

const rows = [
  { hunk: "@@ -10,4 +10,4 @@" },
  { context: [10, 10] as [number, number] },
  { del: 11 },
  { del: 12 },
  { add: 11 },
  { add: 12 },
  { hunk: "@@ -40,2 +40,2 @@" },
  { context: [40, 40] as [number, number] },
  { add: 41 },
]

beforeEach(() => {
  document.body.innerHTML = classicFile({ path: "a.ts", rows }) + classicFile({ path: "b.ts", rows })
})

describe("toCodeSelection", () => {
  it("keeps only head-side lines of a mixed selection", () => {
    const cells = codeCells("a.ts")
    const selection = toCodeSelection(rangeOver(cells[2]!, cells[4]!))
    expect(selection).toMatchObject({ startLine: 11, endLine: 11 })
    expect(selection?.container.id).toBe(diffId("a.ts"))
  })

  it("returns null for a base-only selection", () => {
    const cells = codeCells("a.ts")
    expect(toCodeSelection(rangeOver(cells[2]!, cells[3]!))).toBeNull()
  })

  it("spans hunks as one continuous range", () => {
    const cells = codeCells("a.ts")
    expect(toCodeSelection(rangeOver(cells[1]!, cells[8]!))).toMatchObject({ startLine: 10, endLine: 41 })
  })

  it("drops a trailing row the selection only touches at its start", () => {
    const cells = codeCells("a.ts")
    expect(toCodeSelection(rangeOver(cells[4]!, cells[5]!, 0))).toMatchObject({ startLine: 11, endLine: 11 })
  })

  it("returns null when the selection crosses into another file", () => {
    expect(toCodeSelection(rangeOver(codeCells("a.ts")[4]!, codeCells("b.ts")[1]!))).toBeNull()
  })

  it("returns null for a collapsed selection", () => {
    const cell = codeCells("a.ts")[0]!
    expect(toCodeSelection(rangeOver(cell, cell, 0))).toBeNull()
  })

  it("ignores split-view selections confined to the base side", () => {
    const id = diffId("split.ts")
    document.body.innerHTML = `
      <div id="${id}"><table><tbody>
        <tr>
          <td data-line-number="5" class="blob-num blob-num-deletion"></td>
          <td class="blob-code blob-code-deletion" data-split-side="left"><span class="left">old</span></td>
          <td data-line-number="5" class="blob-num blob-num-addition"></td>
          <td class="blob-code blob-code-addition" data-split-side="right"><span class="right">new</span></td>
        </tr>
      </tbody></table></div>`
    const left = document.querySelector(".left")!
    const right = document.querySelector(".right")!
    expect(toCodeSelection(rangeOver(left, left))).toBeNull()
    expect(toCodeSelection(rangeOver(right, right))).toMatchObject({ startLine: 5, endLine: 5 })
  })
})
