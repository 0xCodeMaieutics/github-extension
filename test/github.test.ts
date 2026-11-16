import { describe, expect, it } from "vitest"
import { parseLineSelection, parsePullRequestChangesView, repositoryKey } from "../lib/file-opener/github"

describe("parsePullRequestChangesView", () => {
  it.each([
    "https://github.com/sindresorhus/ky/pull/700/files",
    "https://github.com/sindresorhus/ky/pull/700/changes",
    "https://github.com/sindresorhus/ky/pull/700/files/abc123..def456",
    "https://github.com/sindresorhus/ky/pull/700/files?diff=split#diff-1d28",
  ])("accepts %s", (url) => {
    expect(parsePullRequestChangesView(url)).toEqual({ owner: "sindresorhus", name: "ky", number: 700 })
  })

  it.each([
    "https://github.com/sindresorhus/ky/pull/700",
    "https://github.com/sindresorhus/ky/pull/700/commits",
    "https://github.com/sindresorhus/ky/commit/abc123",
    "https://github.com/sindresorhus/ky/compare/main...dev",
    "https://github.example.com/sindresorhus/ky/pull/700/files",
    "https://gist.github.com/sindresorhus/ky/pull/700/files",
  ])("rejects %s", (url) => {
    expect(parsePullRequestChangesView(url)).toBeNull()
  })
})

describe("parseLineSelection", () => {
  const diffId = "diff-db3a6e8448d194f567ca1f854d5f7fcba6510079f5afdf01094045e9ef54a383"

  it.each([
    [`#${diffId}R115-R119`, 115, 119],
    [`#${diffId}R115`, 115, 115],
    [`#${diffId}R119-R115`, 115, 119],
    [`#${diffId}L110-R119`, 119, 119],
    [`#${diffId}R115-L120`, 115, 115],
  ])("parses %s", (hash, startLine, endLine) => {
    expect(parseLineSelection(hash)).toEqual({ diffId, startLine, endLine })
  })

  it.each(["", `#${diffId}`, `#${diffId}L10-L12`, `#${diffId}R0`, "#diff-1d28R5", `#${diffId}R5-R`])(
    "rejects %s",
    (hash) => {
      expect(parseLineSelection(hash)).toBeNull()
    },
  )
})

describe("repositoryKey", () => {
  it("is case-insensitive", () => {
    expect(repositoryKey("SindreSorhus", "Ky")).toBe("sindresorhus/ky")
  })
})
