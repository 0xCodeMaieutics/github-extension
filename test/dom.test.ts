import { beforeEach, describe, expect, it } from "vitest"
import { findDiffAnchor, parseHunkHeader } from "../lib/file-opener/diff"
import { findAffordanceSlot, findFileContainers, getFileStatus, resolveHeadPath } from "../lib/file-opener/files"
import { classicFile, diffId, reactFile } from "./fixtures"

function container(path: string): HTMLElement {
  return document.getElementById(diffId(path))!
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("parseHunkHeader", () => {
  it("parses ranges with and without counts", () => {
    expect(parseHunkHeader("@@ -87,7 +87,8 @@ export class Ky {")).toEqual({
      oldStart: 87,
      oldLines: 7,
      newStart: 87,
      newLines: 8,
    })
    expect(parseHunkHeader("@@ -1 +0,0 @@")).toEqual({ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0 })
  })
})

describe("findDiffAnchor", () => {
  it("uses the first added line", () => {
    document.body.innerHTML = classicFile({
      path: "source/core/Ky.ts",
      rows: [{ hunk: "@@ -87,7 +87,7 @@" }, { context: [87, 87] }, { context: [88, 88] }, { add: 89 }, { add: 90 }],
    })
    expect(findDiffAnchor(container("source/core/Ky.ts"))).toBe(89)
  })

  it("uses the head position of a leading deletion", () => {
    document.body.innerHTML = classicFile({
      path: "a.ts",
      rows: [
        { hunk: "@@ -10,6 +10,5 @@" },
        { context: [10, 10] },
        { context: [11, 11] },
        { del: 12 },
        { context: [13, 12] },
        { hunk: "@@ -40,3 +39,4 @@" },
        { add: 40 },
      ],
    })
    expect(findDiffAnchor(container("a.ts"))).toBe(12)
  })

  it("returns null when no diff is rendered (anchor fallback)", () => {
    document.body.innerHTML = classicFile({ path: "image.png" })
    expect(findDiffAnchor(container("image.png"))).toBeNull()
  })

  it("does not treat a code line containing @@ as a hunk header", () => {
    document.body.innerHTML = classicFile({
      path: "patch.diff",
      rows: [{ hunk: "@@ -1,2 +5,2 @@" }, { context: [1, 5] }, { add: 6 }],
    })
    const codeCell = container("patch.diff").querySelector(".blob-code-context span")!
    codeCell.textContent = "@@ -100,1 +100,1 @@"
    expect(findDiffAnchor(container("patch.diff"))).toBe(6)
  })
})

describe("getFileStatus", () => {
  it("trusts the classic data-file-deleted attribute", () => {
    document.body.innerHTML =
      classicFile({ path: "gone.ts", deleted: true }) + classicFile({ path: "kept.ts", deleted: false })
    expect(getFileStatus(container("gone.ts"))).toBe("deleted")
    expect(getFileStatus(container("kept.ts"))).toBe("openable")
  })

  it("detects whole-file deletion hunks when no attribute is present", () => {
    document.body.innerHTML =
      reactFile({ path: "gone.ts", rows: `<tr><td>@@ -1,3 +0,0 @@</td></tr>` }) +
      reactFile({ path: "new.ts", rows: `<tr><td>@@ -0,0 +1,3 @@</td></tr>` }) +
      reactFile({ path: "lazy.ts" })
    expect(getFileStatus(container("gone.ts"))).toBe("deleted")
    expect(getFileStatus(container("new.ts"))).toBe("openable")
    expect(getFileStatus(container("lazy.ts"))).toBe("unknown")
  })

  it("detects a deleted status icon in the header", () => {
    document.body.innerHTML = reactFile({
      path: "gone.ts",
      status: `<svg class="octicon octicon-file-removed" aria-label="deleted"></svg>`,
    })
    expect(getFileStatus(container("gone.ts"))).toBe("deleted")
  })
})

describe("resolveHeadPath", () => {
  it("reads the classic path attribute", async () => {
    document.body.innerHTML = classicFile({ path: "source/core/Ky.ts" })
    expect(await resolveHeadPath(container("source/core/Ky.ts"))).toBe("source/core/Ky.ts")
  })

  it("verifies React header text against the hashed id, picking the new path of a rename", async () => {
    document.body.innerHTML = reactFile({ path: "src/new-name.ts", label: "src/old-name.ts → src/new-name.ts" })
    expect(await resolveHeadPath(container("src/new-name.ts"))).toBe("src/new-name.ts")
  })

  it("refuses unverifiable React paths", async () => {
    document.body.innerHTML = reactFile({ path: "src/real.ts", label: "Something else" })
    expect(await resolveHeadPath(container("src/real.ts"))).toBeNull()
  })
})

describe("findFileContainers and findAffordanceSlot", () => {
  it("finds one container per file and ignores line-number ids", () => {
    document.body.innerHTML =
      classicFile({ path: "a.ts", rows: [{ hunk: "@@ -1 +1 @@" }, { add: 1 }] }) + reactFile({ path: "b.ts" })
    const firstCell = document.querySelector("td")!
    firstCell.id = `${diffId("a.ts")}R1`
    expect(findFileContainers().map((el) => el.id)).toEqual([diffId("a.ts"), diffId("b.ts")])
  })

  it("places the affordance in the classic file-info and after the React file name", () => {
    document.body.innerHTML = classicFile({ path: "a.ts" }) + reactFile({ path: "b.ts" })
    expect(findAffordanceSlot(container("a.ts"))?.parent.className).toBe("file-info")
    const reactSlot = findAffordanceSlot(container("b.ts"))!
    expect(reactSlot.parent.className).toContain("DiffFileHeader-module__diff-file-header")
    expect(reactSlot.before?.previousSibling?.nodeName).toBe("H3")
  })
})

describe("postPageComment", () => {
  it("fills the classic comment box and clicks Comment", async () => {
    const { postPageComment } = await import("../lib/page-comment")
    document.body.innerHTML = `
      <form class="js-new-comment-form">
        <textarea id="new_comment_field" name="comment[body]"></textarea>
        <button type="button">Close pull request</button>
        <button type="submit">Comment</button>
      </form>`
    const form = document.querySelector("form")!
    let posted = ""
    form.addEventListener("submit", (e) => {
      e.preventDefault()
      posted = (document.getElementById("new_comment_field") as HTMLTextAreaElement).value
    })
    await postPageComment("@cursor review")
    expect(posted).toBe("@cursor review")
  })

  it("refuses to overwrite a draft or post without a comment box", async () => {
    const { postPageComment } = await import("../lib/page-comment")
    await expect(postPageComment("@cursor review")).rejects.toThrow(/Conversation tab/)
    document.body.innerHTML = `<textarea id="new_comment_field">draft</textarea><button>Comment</button>`
    await expect(postPageComment("@cursor review")).rejects.toThrow(/draft/)
  })
})
