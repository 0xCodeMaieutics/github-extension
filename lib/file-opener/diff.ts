export interface HunkRange {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

const HUNK_HEADER = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const CODE_TEXT_SELECTOR = '.blob-code-inner, [class*="diff-text-inner" i], [class*="diffTextInner" i]'
const CODE_MARKER_SELECTOR = '[class*="diff-text-marker" i], [class*="diffTextMarker" i]'

export function parseHunkHeader(text: string): HunkRange | null {
  const match = HUNK_HEADER.exec(text)
  if (!match) return null
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
  }
}

type RowKind = "hunk" | "addition" | "deletion" | "context" | "other"

function lineNumberOf(cell: Element): number | null {
  // Without the attribute, a code cell whose source line is only digits must not read as a line number.
  const text = cell.querySelector(`${CODE_TEXT_SELECTOR}, ${CODE_MARKER_SELECTOR}`) ? "" : cell.textContent?.trim()
  const raw = cell.getAttribute("data-line-number") ?? text ?? ""
  return /^\d+$/.test(raw) ? Number(raw) : null
}

function numberedCells(row: Element): HTMLTableCellElement[] {
  return [...row.querySelectorAll("td")].filter((cell) => lineNumberOf(cell) !== null)
}

function hasCellMatching(row: Element, pattern: RegExp, marker: string): boolean {
  return [...row.querySelectorAll(`td, [data-code-marker], ${CODE_MARKER_SELECTOR}`)].some(
    (cell) =>
      pattern.test(cell.className) ||
      cell.getAttribute("data-code-marker") === marker ||
      (cell.matches(CODE_MARKER_SELECTOR) && cell.textContent?.trim() === marker),
  )
}

function classifyRow(row: Element): RowKind {
  const numbered = numberedCells(row)
  if (numbered.length === 0) {
    return parseHunkHeader(row.textContent ?? "") ? "hunk" : "other"
  }
  if (hasCellMatching(row, /addition/i, "+")) return "addition"
  if (hasCellMatching(row, /deletion/i, "-")) return "deletion"
  return "context"
}

/**
 * The line-number cell holding a row's head-side line; null for deletions,
 * hunk headers and anything else without one. In additions the last numbered
 * addition cell wins so split view picks the right half.
 */
function headNumberCell(row: Element): HTMLTableCellElement | null {
  switch (classifyRow(row)) {
    case "addition": {
      const numbered = numberedCells(row)
      return numbered.filter((cell) => /addition/i.test(cell.className)).at(-1) ?? numbered.at(-1) ?? null
    }
    case "context":
      return numberedCells(row).at(-1) ?? null
    default:
      return null
  }
}

export function headLineOf(row: Element): number | null {
  const cell = headNumberCell(row)
  return cell ? lineNumberOf(cell) : null
}

function cellCodeText(cell: Element): string {
  const inner = cell.querySelector(CODE_TEXT_SELECTOR)
  if (inner) return (inner.textContent ?? "").replace(/\r?\n$/, "")
  const copy = cell.cloneNode(true) as Element
  copy.querySelectorAll(CODE_MARKER_SELECTOR).forEach((marker) => marker.remove())
  return (copy.textContent ?? "").replace(/^\r?\n|\r?\n$/g, "")
}

/**
 * Head-side source text of a diff row, without the `+`/`-` marker. The code
 * sits in or after the head line-number cell (the React UI also puts
 * `data-line-number` on the code cell); rows can carry empty trailing cells for
 * comment and expand controls, so the cell with the most text wins.
 */
export function codeTextOf(row: Element): string | null {
  const numberCell = headNumberCell(row)
  if (!numberCell) return null

  const rightSide = row.querySelector('td[data-split-side="right"]')
  if (rightSide) return cellCodeText(rightSide)

  const cells = [...row.querySelectorAll("td")]
  const texts = cells
    .slice(cells.indexOf(numberCell))
    .map(cellCodeText)
    .filter((text) => !/^\s*\d+\s*$/.test(text))
  if (texts.length === 0) return null
  return texts.reduce((best, text) => (text.trim().length > best.trim().length ? text : best))
}

/**
 * Finds the diff anchor: the head-side line of the first meaningful change in a
 * file's rendered diff. An addition yields its own line; a deletion that comes
 * first yields the head line where the removed block used to be. Returns null
 * when nothing can be determined, which callers treat as the anchor fallback.
 */
export function findDiffAnchor(fileContainer: Element): number | null {
  let nextHeadLine: number | null = null

  for (const row of fileContainer.querySelectorAll("tr")) {
    switch (classifyRow(row)) {
      case "hunk":
        nextHeadLine = parseHunkHeader(row.textContent ?? "")?.newStart ?? null
        break
      case "addition":
        return headLineOf(row)
      case "deletion":
        if (nextHeadLine !== null) return Math.max(nextHeadLine, 1)
        break
      case "context":
        if (nextHeadLine !== null) nextHeadLine += 1
        break
      case "other":
        break
    }
  }
  return null
}

export function renderedHunks(fileContainer: Element): HunkRange[] {
  return [...fileContainer.querySelectorAll("tr")].flatMap((row) => {
    if (!row.textContent?.includes("@@") || classifyRow(row) !== "hunk") return []
    return parseHunkHeader(row.textContent) ?? []
  })
}

/** A deleted-only file's every hunk removes the whole file (`+0,0`). */
export function isWholeFileDeletion(hunks: HunkRange[]): boolean {
  return hunks.length > 0 && hunks.every((hunk) => hunk.newStart === 0 && hunk.newLines === 0)
}
