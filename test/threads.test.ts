import { beforeEach, describe, expect, it } from "vitest"
import { toCodeSelection } from "../lib/file-opener/selection"
import { readHeadLines } from "../lib/file-opener/reference"
import {
  findThreadLinks,
  hasCodePath,
  resolveCodePath,
  threadFileOf,
  threadSnippetOf,
} from "../lib/file-opener/threads"
import { classicFile, diffId } from "./fixtures"

function additionRow(line: number): string {
  return `<tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="${line}" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker-addition">line ${line}</span></td></tr>`
}

/** Mirrors a classic conversation tab review thread; `lines` null leaves it collapsed. */
function conversationThread(path: string, lines: number[] | null, comment = ""): string {
  const snippet = lines
    ? `<div class="blob-wrapper"><deferred-diff-lines><table class="diff-table"><tbody>${lines.map(additionRow).join("")}</tbody></table></deferred-diff-lines></div>`
    : ""
  return `
    <review-thread-collapsible class="review-thread-component js-resolvable-timeline-thread-container">
      <div class="d-flex"><span class="flex-auto">
        <a href="/o/r/pull/1/files/abc123#${diffId(path)}" class="text-mono text-small Link--primary">${path}</a>
      </span></div>
      <div data-target="review-thread-collapsible.body">
        ${snippet}
        <div class="js-inline-comments-container"><div class="markdown-body">${comment}</div></div>
      </div>
    </review-thread-collapsible>`
}

type ReactRow = { line: number; marker: "+" | "-" | ""; code: string }

function reactRow({ line, marker, code }: ReactRow): string {
  return `<tr><td class="diffLineNumber__GPXhoH"><code>${line}</code></td><td class="diffTextCell__t9hCd8"><code class="syntaxHighlightedLine__x"><span class="diffTextMarker__0JPPZw">${marker}</span><div class="diffTextInner__P-stQx">${code}</div></code></td></tr>`
}

/** Mirrors a React conversation tab review thread; `rows` null leaves it collapsed. */
function reactThread(path: string, commentId: number, rows: ReactRow[] | null, comment = ""): string {
  const href = `/o/r/pull/1/changes#r${commentId}`
  const snippet = rows
    ? `<div class="StaticDiffPreview__x"><table class="unifiedDiffLines__k0eV89"><thead class="sr-only"><tr><th scope="col">Diff line number</th><th scope="col">Diff line change</th></tr></thead><tbody>${rows.map(reactRow).join("")}</tbody></table></div>`
    : ""
  return `
    <article class="container__rfx-3s">
      <div class="header__8DCKRC"><div class="d-flex">
        <h2 class="d-flex"><a class="file-name-overflow__w2kn8A" href="${href}" aria-labelledby="tip">\u200e${path}\u200e</a><span id="tip" popover="auto">${path}</span><span>Line 4</span></h2>
        <a data-component="IconButton" aria-label="Jump to the comment in the diff for ${path}, line 4" href="${href}"><svg></svg></a>
      </div></div>
      <div class="body__APdwN2">${snippet}
        <div data-testid="review-thread"><div id="discussion_r${commentId}">
          <a href="https://github.com/o/r/pull/1#discussion_r${commentId}">on Nov 17</a>
          <div class="markdown-body">${comment}</div>
        </div></div>
      </div>
    </article>`
}

const links = () => findThreadLinks()

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("findThreadLinks", () => {
  it("skips links in comment bodies and in changes-view file containers", () => {
    document.body.innerHTML =
      conversationThread("a.ts", [1], `<a href="/o/r/pull/1/files#${diffId("b.ts")}">b.ts</a>`) +
      classicFile({ path: "c.ts", rows: [{ add: 1 }] })
    expect(links().map((link) => link.textContent)).toEqual(["a.ts"])
  })
})

describe("threadFileOf", () => {
  it("uses the link text when it is the path", async () => {
    document.body.innerHTML = conversationThread("src/a.ts", [3])
    const link = links()[0]!
    expect(await threadFileOf(link)).toEqual({ path: "src/a.ts", label: link })
  })

  it("finds the path beside an icon link with a line anchor", async () => {
    document.body.innerHTML = `
      <div class="thread">
        <div class="header">
          <span class="path"><span>src/</span><span>a.ts</span></span><span>Line 15</span>
          <a href="/o/r/pull/1/changes#${diffId("src/a.ts")}R15" aria-label="View file"><svg></svg></a>
        </div>
      </div>`
    const file = await threadFileOf(links()[0]!)
    expect(file?.path).toBe("src/a.ts")
    expect(file?.label.className).toBe("path")
  })

  it("rejects text that does not match the hash", async () => {
    document.body.innerHTML = `<a href="/o/r/pull/1/files#${diffId("src/a.ts")}">View changes</a>`
    expect(await threadFileOf(links()[0]!)).toBeNull()
  })
})

describe("threadSnippetOf", () => {
  it("finds each thread's own snippet", () => {
    document.body.innerHTML = conversationThread("a.ts", [4, 5]) + conversationThread("b.ts", [8, 9])
    const [a, b] = links()
    expect(threadSnippetOf(a!)?.textContent).toContain("line 5")
    expect(threadSnippetOf(b!)?.textContent).toContain("line 9")
  })

  it("does not borrow another thread's snippet while collapsed", () => {
    document.body.innerHTML = conversationThread("a.ts", null) + conversationThread("b.ts", [8, 9])
    expect(threadSnippetOf(links()[0]!)).toBeNull()
  })
})

describe("React conversation threads", () => {
  const added = (line: number, code = "const a = 1"): ReactRow => ({ line, marker: "+", code })

  it("reads the path from the heading link and ignores the jump icon and timestamp links", async () => {
    document.body.innerHTML = reactThread("apps/src/brand.ts", 11, [added(4)])
    const found = links()
    expect(found).toHaveLength(1)
    expect(await threadFileOf(found[0]!)).toEqual({ path: "apps/src/brand.ts", label: found[0] })
  })

  it("keeps spaces in the path", async () => {
    document.body.innerHTML = reactThread("docs/release notes.md", 11, [added(4)])
    expect((await threadFileOf(links()[0]!))?.path).toBe("docs/release notes.md")
  })

  it("ignores comment links in a markdown heading", () => {
    const comment = `<h3><a href="/o/r/pull/1/changes#r99">other.ts</a></h3>`
    document.body.innerHTML = reactThread("a.ts", 11, [added(4)], comment)
    expect(links().map((link) => link.getAttribute("href"))).toEqual(["/o/r/pull/1/changes#r11"])
  })

  it("resolves a selection to its own thread's file and line", async () => {
    document.body.innerHTML = reactThread("a.ts", 11, [added(4)]) + reactThread("b.ts", 12, [added(8)])
    const inner = document.querySelectorAll(".diffTextInner__P-stQx")[1]!
    const range = document.createRange()
    range.selectNodeContents(inner)

    const selection = toCodeSelection(range)
    expect(selection).toMatchObject({ startLine: 8, endLine: 8 })
    expect(hasCodePath(selection!.container)).toBe(true)
    expect(await resolveCodePath(selection!.container)).toBe("b.ts")
  })

  it("resolves two threads on one file separately", () => {
    document.body.innerHTML = reactThread("a.ts", 11, [added(4)]) + reactThread("a.ts", 12, null)
    const [first, second] = links()
    expect(threadSnippetOf(first!)?.textContent).toContain("const a")
    expect(threadSnippetOf(second!)).toBeNull()
  })

  it("reads code without the diff marker", () => {
    document.body.innerHTML = reactThread("a.ts", 11, [added(4, "const b = 2")])
    expect(readHeadLines(document.querySelector("table")!, { startLine: 4, endLine: 4 })).toBe("const b = 2")
  })

  it("does not treat a deleted line's number as a head line", () => {
    document.body.innerHTML = reactThread("a.ts", 11, [{ line: 9, marker: "-", code: "gone" }, added(4)])
    const inner = document.querySelector(".diffTextInner__P-stQx")!
    const range = document.createRange()
    range.selectNodeContents(inner)
    expect(toCodeSelection(range)).toBeNull()
  })

  it("keeps the line number when a context line's code is only digits", () => {
    document.body.innerHTML = reactThread("a.ts", 11, [{ line: 7, marker: "", code: "42" }])
    const range = document.createRange()
    range.selectNodeContents(document.querySelector(".diffTextInner__P-stQx")!)
    expect(toCodeSelection(range)).toMatchObject({ startLine: 7, endLine: 7 })
  })

  it("reports no path for a snippet without a file link", () => {
    document.body.innerHTML = reactThread("a.ts", 11, [added(4)])
    document.querySelector("h2")!.remove()
    expect(hasCodePath(document.querySelector("table")!)).toBe(false)
  })
})

describe("thread snippet selections", () => {
  it("selects head lines inside a thread snippet and resolves its path", async () => {
    document.body.innerHTML = conversationThread("a.ts", [4, 5, 6]) + conversationThread("b.ts", [8])
    const cells = document.querySelectorAll(".blob-code-inner")
    const range = document.createRange()
    range.setStart(cells[0]!, 0)
    range.setEnd(cells[1]!, cells[1]!.childNodes.length)

    const selection = toCodeSelection(range)
    expect(selection).toMatchObject({ startLine: 4, endLine: 5 })
    expect(await resolveCodePath(selection!.container)).toBe("a.ts")
  })

  it("returns null across two threads", () => {
    document.body.innerHTML = conversationThread("a.ts", [4]) + conversationThread("b.ts", [8])
    const cells = document.querySelectorAll(".blob-code-inner")
    const range = document.createRange()
    range.setStart(cells[0]!, 0)
    range.setEnd(cells[1]!, cells[1]!.childNodes.length)
    expect(toCodeSelection(range)).toBeNull()
  })
})
