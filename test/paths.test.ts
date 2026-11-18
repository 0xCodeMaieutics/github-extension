import { describe, expect, it } from "vitest"
import { buildEditorFileUrl, isAbsoluteLocalPath, joinRepoPath, normalizeLocalRoot } from "../lib/file-opener/paths"

describe("normalizeLocalRoot", () => {
  it("trims whitespace, quotes and trailing slashes", () => {
    expect(normalizeLocalRoot('  "/Users/me/code/ky/"  ')).toBe("/Users/me/code/ky")
  })

  it("converts Windows separators", () => {
    expect(normalizeLocalRoot("C:\\code\\ky\\")).toBe("C:/code/ky")
  })

  it("keeps filesystem roots", () => {
    expect(normalizeLocalRoot("/")).toBe("/")
    expect(normalizeLocalRoot("C:\\")).toBe("C:/")
  })
})

describe("isAbsoluteLocalPath", () => {
  it.each(["/Users/me/ky", "C:/code/ky", "C:\\code\\ky", "\\\\server\\share\\ky"])("accepts %s", (path) => {
    expect(isAbsoluteLocalPath(path)).toBe(true)
  })

  it.each(["", "~/code/ky", "code/ky", "./ky", "C:ky"])("rejects %s", (path) => {
    expect(isAbsoluteLocalPath(path)).toBe(false)
  })
})

describe("joinRepoPath", () => {
  it("joins without doubling separators", () => {
    expect(joinRepoPath("/Users/me/ky/", "/source/core/Ky.ts")).toBe("/Users/me/ky/source/core/Ky.ts")
  })
})

describe("buildEditorFileUrl", () => {
  it("builds a POSIX file URL with line and column", () => {
    expect(buildEditorFileUrl("vscode", "/Users/me/ky/source/Ky.ts", 90)).toBe("vscode://file/Users/me/ky/source/Ky.ts:90:1")
  })

  it("leaves out the line and column when there is no line", () => {
    expect(buildEditorFileUrl("zed", "/Users/me/ky/source/Ky.ts", null)).toBe("zed://file/Users/me/ky/source/Ky.ts")
  })

  it("prefixes Windows drives with a slash and keeps the colon", () => {
    expect(buildEditorFileUrl("vscode", "C:\\code\\ky\\a.ts", 3)).toBe("vscode://file/C:/code/ky/a.ts:3:1")
  })

  it("encodes characters the URL handler would misread", () => {
    expect(buildEditorFileUrl("vscode", "/Users/me/my repo/#notes?.md", 1)).toBe(
      "vscode://file/Users/me/my%20repo/%23notes%3F.md:1:1",
    )
  })

  it("falls back to line 1 for invalid lines", () => {
    expect(buildEditorFileUrl("vscode", "/a.ts", 0)).toBe("vscode://file/a.ts:1:1")
  })

  it("uses the zed:// scheme for Zed", () => {
    expect(buildEditorFileUrl("zed", "/Users/me/my repo/a.ts", 12)).toBe("zed://file/Users/me/my%20repo/a.ts:12:1")
  })
})
