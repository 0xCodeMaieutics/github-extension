export interface PullRequestRef {
  owner: string
  name: string
  number: number
}

/** Owner/name segments GitHub reserves for its own pages rather than repositories. */
const RESERVED_OWNERS = new Set(["orgs", "settings", "marketplace", "notifications", "sponsors"])

const CHANGES_VIEW_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/|$)/
const PULL_REQUEST_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/

function parsePullRequestPath(url: string | URL, path: RegExp): PullRequestRef | null {
  const parsed = typeof url === "string" ? new URL(url) : url
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return null

  const match = path.exec(parsed.pathname)
  if (!match) return null
  const [, owner, name, number] = match
  if (!owner || !name || !number || RESERVED_OWNERS.has(owner)) return null

  return { owner: decodeURIComponent(owner), name: decodeURIComponent(name), number: Number(number) }
}

/**
 * Recognises a pull request changes view on github.com. Both the classic
 * `/files` route and the newer `/changes` route qualify, including commit-range
 * suffixes such as `/files/<sha>..<sha>`.
 */
export function parsePullRequestChangesView(url: string | URL): PullRequestRef | null {
  return parsePullRequestPath(url, CHANGES_VIEW_PATH)
}

/** Any tab of a pull request on github.com: conversation, commits, checks or changes. */
export function parsePullRequestPage(url: string | URL): PullRequestRef | null {
  return parsePullRequestPath(url, PULL_REQUEST_PATH)
}

export interface LineSelection {
  /** Id of the file container the selection belongs to (`diff-<sha256(path)>`). */
  diffId: string
  startLine: number
  endLine: number
}

const LINE_SELECTION_HASH = /^#?(diff-[0-9a-f]{64})([LR])(\d+)(?:-([LR])(\d+))?$/

/**
 * Parses a line selection from a changes-view hash such as
 * `#diff-<sha256>R115-R119`. Only head-side (`R`) lines map onto the file a
 * local open targets, so base-only (`L`) selections yield null and a mixed
 * selection collapses to its head-side endpoint.
 */
export function parseLineSelection(hash: string): LineSelection | null {
  const match = LINE_SELECTION_HASH.exec(hash)
  if (!match) return null
  const [, diffId, startSide, start, endSide = startSide, end = start] = match
  if (!diffId) return null

  const headLines = [
    startSide === "R" ? Number(start) : null,
    endSide === "R" ? Number(end) : null,
  ].filter((line): line is number => line !== null && line > 0)
  if (headLines.length === 0) return null

  return { diffId, startLine: Math.min(...headLines), endLine: Math.max(...headLines) }
}

/** GitHub repository identities are case-insensitive, so mappings are keyed in lowercase. */
export function repositoryKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase()
}
