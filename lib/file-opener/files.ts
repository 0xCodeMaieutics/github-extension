import { isWholeFileDeletion, renderedHunks } from "./diff"

const DIFF_ID = /^diff-([0-9a-f]{64})$/
const HEADER_SELECTOR = '.file-header, [class*="DiffFileHeader" i], [class*="diff-file-header" i]'
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g
const DELETED_STATUS_SELECTOR =
  '.octicon-file-removed, .octicon-diff-removed, [aria-label="deleted" i], [aria-label="file deleted" i], [title="deleted" i]'

/**
 * Per-file diff containers on a pull request changes view. Both the classic and
 * the React UI give each file an element with `id="diff-<sha256(path)>"`.
 */
export function findFileContainers(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[id^="diff-"]')].filter((element) => DIFF_ID.test(element.id))
}

/** The file container a node sits in; line-number cells reuse the `diff-<hash>` prefix, so match the exact id. */
export function findFileContainerOf(node: Node | null): HTMLElement | null {
  for (let element = node instanceof Element ? node : node?.parentElement; element; element = element.parentElement) {
    if (element instanceof HTMLElement && DIFF_ID.test(element.id)) return element
  }
  return null
}

export function findFileHeader(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(HEADER_SELECTOR)
}

function cleanPath(value: string | null | undefined): string | null {
  const cleaned = value?.replace(INVISIBLE_CHARS, "").trim()
  return cleaned ? cleaned : null
}

/** Attributes GitHub sets to the head path; trusted even if hash verification fails. */
function attributePaths(container: HTMLElement, header: HTMLElement | null): string[] {
  return [
    container.getAttribute("data-tagsearch-path"),
    header?.getAttribute("data-path"),
    container.closest("[data-file-path]")?.getAttribute("data-file-path"),
  ].flatMap((value) => cleanPath(value) ?? [])
}

/** Path-looking strings in the header; renames render as `old → new`, so both halves are candidates. */
function headerTextPaths(header: HTMLElement | null): string[] {
  if (!header) return []
  const raw = [
    ...[...header.querySelectorAll("clipboard-copy[value]")].map((el) => el.getAttribute("value")),
    ...[...header.querySelectorAll("[title]")].map((el) => el.getAttribute("title")),
    ...[...header.querySelectorAll("a, code, h3")].map((el) => el.textContent),
  ]
  return raw.flatMap((value) => {
    const cleaned = cleanPath(value)
    if (!cleaned) return []
    return [cleaned, ...cleaned.split("→").flatMap((part) => cleanPath(part) ?? [])]
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Resolves the repository-relative head path for a file container. Candidates
 * are verified against the SHA-256 in the container id so a rename's old path
 * or a stray label is never opened by mistake.
 */
export async function resolveHeadPath(container: HTMLElement): Promise<string | null> {
  const expectedHash = DIFF_ID.exec(container.id)?.[1]
  const header = findFileHeader(container)
  const fromAttributes = attributePaths(container, header)
  const candidates = [...new Set([...fromAttributes, ...headerTextPaths(header)])]

  if (expectedHash) {
    for (const candidate of candidates) {
      if ((await sha256Hex(candidate)) === expectedHash) return candidate
    }
  }
  return fromAttributes[0] ?? null
}

export type FileStatus = "deleted" | "openable" | "unknown"

/**
 * Deleted-only files have no head path and therefore no open affordance.
 * "unknown" means GitHub has not rendered enough to tell yet (e.g. a lazily
 * loaded diff); such files are treated as openable until proven otherwise.
 */
export function getFileStatus(container: HTMLElement): FileStatus {
  const header = findFileHeader(container)
  const deletedAttribute = container.getAttribute("data-file-deleted") ?? header?.getAttribute("data-file-deleted")
  if (deletedAttribute === "true") return "deleted"
  if (header?.querySelector(DELETED_STATUS_SELECTOR)) return "deleted"
  if (deletedAttribute === "false") return "openable"

  const hunks = renderedHunks(container)
  if (isWholeFileDeletion(hunks)) return "deleted"
  return hunks.length > 0 ? "openable" : "unknown"
}

/** Where the open affordance goes: right after the file name in the header row. */
export function findAffordanceSlot(container: HTMLElement): { parent: Element; before: Node | null } | null {
  const header = findFileHeader(container)
  if (!header) return null

  const classicInfo = header.querySelector(".file-info")
  if (classicInfo) return { parent: classicInfo, before: null }

  const nameLink = header.querySelector(`a[href="#${container.id}"]`)
  const nameBlock = nameLink?.closest("h3, h4, .Truncate") ?? nameLink ?? header.querySelector("h3, h4")
  if (nameBlock?.parentElement) return { parent: nameBlock.parentElement, before: nameBlock.nextSibling }

  return { parent: header, before: null }
}
