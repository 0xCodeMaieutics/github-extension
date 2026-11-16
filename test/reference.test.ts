import { beforeEach, describe, expect, it } from "vitest"
import { buildT3PromptUrl, formatReferencePrompt, PROMPT_LINK_MAX_CHARS, readHeadLines } from "../lib/file-opener/reference"
import { classicFile, diffId } from "./fixtures"

describe("readHeadLines", () => {
  beforeEach(() => {
    document.body.innerHTML = classicFile({
      path: "a.ts",
      rows: [
        { hunk: "@@ -10,3 +10,3 @@" },
        { context: [10, 10] },
        { del: 11 },
        { add: 11 },
        { hunk: "@@ -40,1 +40,1 @@" },
        { add: 40 },
      ],
    })
  })
  const container = () => document.getElementById(diffId("a.ts"))!

  it("reads head-side text without deletions", () => {
    expect(readHeadLines(container(), { startLine: 10, endLine: 11 })).toBe("ctx\nadded")
  })

  it("returns null when lines between hunks are not rendered", () => {
    expect(readHeadLines(container(), { startLine: 11, endLine: 40 })).toBeNull()
  })

  it("skips empty trailing cells after the code cell", () => {
    document.body.innerHTML = `
      <div id="${diffId("react.ts")}"><table><tbody>
        <tr>
          <td class="diff-line-number">3</td><td class="diff-line-number">3</td>
          <td class="diff-text-cell"><code><span class="diff-text-marker"> </span>const DAY_MS = 1</code></td>
          <td></td>
        </tr>
        <tr>
          <td class="diff-line-number"></td><td class="diff-line-number addition">4</td>
          <td class="diff-text-cell addition"><code><span class="diff-text-marker">+</span>const HOUR_MS = 2</code></td>
          <td><button aria-label="Add comment"></button></td>
        </tr>
      </tbody></table></div>`
    expect(readHeadLines(document.getElementById(diffId("react.ts"))!, { startLine: 3, endLine: 4 })).toBe(
      "const DAY_MS = 1\nconst HOUR_MS = 2",
    )
  })

  it("reads code from a cell that also carries data-line-number", () => {
    document.body.innerHTML = `
      <div id="${diffId("react.ts")}"><table><tbody>
        <tr>
          <td></td>
          <td class="diff-line-number" data-line-number="3">3</td>
          <td class="diff-line-number" data-line-number="3">3</td>
          <td class="diff-text-cell" data-line-number="3"><code>const TBILISI_UTC_OFFSET_MS = 4 * 60 * 60 * 1000</code></td>
        </tr>
      </tbody></table></div>`
    expect(readHeadLines(document.getElementById(diffId("react.ts"))!, { startLine: 3, endLine: 3 })).toBe(
      "const TBILISI_UTC_OFFSET_MS = 4 * 60 * 60 * 1000",
    )
  })

  it("reads the right half of a split-view row", () => {
    document.body.innerHTML = `
      <div id="${diffId("split.ts")}"><table><tbody><tr>
        <td data-line-number="5" class="blob-num blob-num-deletion"></td>
        <td class="blob-code blob-code-deletion" data-split-side="left"><span class="blob-code-inner">old</span></td>
        <td data-line-number="5" class="blob-num blob-num-addition"></td>
        <td class="blob-code blob-code-addition" data-split-side="right"><span class="blob-code-inner">new</span></td>
      </tr></tbody></table></div>`
    expect(readHeadLines(document.getElementById(diffId("split.ts"))!, { startLine: 5, endLine: 5 })).toBe("new")
  })
})

describe("formatReferencePrompt", () => {
  const pr = { owner: "owner", name: "name", number: 72 }
  const header = "PR #72: https://github.com/owner/name/pull/72\n"

  it("names the pull request, then puts a fenced excerpt below a range location", () => {
    expect(formatReferencePrompt(pr, "src/a.ts", { startLine: 19, endLine: 20 }, "one\ntwo")).toBe(
      `${header}src/a.ts:19~20\n\`\`\`ts\none\ntwo\n\`\`\`\n`,
    )
  })

  it("uses a single-line location and a longer fence when the code contains backticks", () => {
    expect(formatReferencePrompt(pr, "README.md", { startLine: 3, endLine: 3 }, "```sh")).toBe(
      `${header}README.md:3\n\`\`\`\`md\n\`\`\`sh\n\`\`\`\`\n`,
    )
  })

  it("references the whole file by path alone when no range is given", () => {
    expect(formatReferencePrompt(pr, "shared/db/schema.prisma", null, null)).toBe(`${header}shared/db/schema.prisma\n`)
  })

  it("falls back to the location when the excerpt is unknown or too long", () => {
    expect(formatReferencePrompt(pr, "a.ts", { startLine: 1, endLine: 2 }, null)).toBe(`${header}a.ts:1~2\n`)
    expect(formatReferencePrompt(pr, "a.ts", { startLine: 1, endLine: 2 }, "x".repeat(PROMPT_LINK_MAX_CHARS))).toBe(
      `${header}a.ts:1~2\n`,
    )
  })
})

describe("buildT3PromptUrl", () => {
  it("builds a t3code://new prompt link scoped to the repository", () => {
    const url = buildT3PromptUrl({ repo: "owner/name", prompt: "a.ts:1\n```ts\nx + y\n```\n" })
    expect(url.startsWith("t3code://new?")).toBe(true)
    const params = new URL(url).searchParams
    expect(params.get("repo")).toBe("owner/name")
    expect(params.get("prompt")).toBe("a.ts:1\n```ts\nx + y\n```\n")
  })
})
