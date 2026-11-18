import { headLineOf } from "./diff"
import { cleanPath, findFileContainerOf, resolveHeadPath, sha256Hex } from "./files"

const THREAD_LINK_SELECTOR = 'a[href*="#diff-"], a[href*="#r"]'
/** Line anchors such as `R15` or `L3-R9` can follow the file hash. */
const DIFF_LINK_HASH = /#diff-([0-9a-f]{64})(?:[LR]\d+(?:-[LR]\d+)?)?$/
/** The React conversation tab links a thread's file name to its comment in the diff. */
const COMMENT_LINK_HREF = /\/pull\/\d+\/(?:changes|files)(?:\/[^#]*)?#(r\d+)$/
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6"
/** Comment bodies can hold their own tables and links to diffs. */
const COMMENT_BODY_SELECTOR = ".markdown-body"
/** How far above a thread link to look for the element showing its path. */
const LABEL_SEARCH_DEPTH = 4
const MAX_PATH_LENGTH = 1024

export interface ThreadFile {
  path: string
  /** The element showing the path; header icons go right after it. */
  label: Element
}

function outsideComments(element: Element): boolean {
  return !element.closest(COMMENT_BODY_SELECTOR) && !findFileContainerOf(element)
}

function linkHash(link: Element): string | null {
  return DIFF_LINK_HASH.exec(link.getAttribute("href") ?? "")?.[1] ?? null
}

/**
 * The path a thread heading's file link shows. These links carry no file hash to
 * verify against, so only a heading link to a review comment counts; the icon
 * link beside it has no text.
 */
function commentLinkPath(link: Element): string | null {
  if (!COMMENT_LINK_HREF.test(link.getAttribute("href") ?? "") || !link.closest(HEADING_SELECTOR)) return null
  const path = cleanPath(link.textContent)
  return path && path.length <= MAX_PATH_LENGTH ? path : null
}

/** What tells one thread's link from another's: its file hash, or its comment id. */
function threadKey(link: Element): string | null {
  const hash = linkHash(link)
  if (hash) return hash
  return commentLinkPath(link) === null ? null : COMMENT_LINK_HREF.exec(link.getAttribute("href")!)![1]!
}

/** Candidate review thread links outside the changes view's file diffs and comment bodies. */
export function findThreadLinks(root: ParentNode = document): HTMLAnchorElement[] {
  return [...root.querySelectorAll<HTMLAnchorElement>(THREAD_LINK_SELECTOR)].filter(
    (link) => threadKey(link) !== null && outsideComments(link),
  )
}

/** Threads a scope's links belong to; one thread can link its file more than once. */
function threadKeysIn(root: ParentNode): Set<string> {
  return new Set(findThreadLinks(root).map((link) => threadKey(link)!))
}

function isThreadSnippet(table: Element): boolean {
  return outsideComments(table) && [...table.querySelectorAll("tr")].some((row) => headLineOf(row) !== null)
}

function snippetsIn(root: ParentNode): HTMLTableElement[] {
  return [...root.querySelectorAll("table")].filter(isThreadSnippet)
}

function pathCandidates(element: Element): string[] {
  return [element.textContent, element.getAttribute("title"), element.getAttribute("aria-label")].flatMap((value) => {
    const path = cleanPath(value)
    return path && path.length <= MAX_PATH_LENGTH && !/\s/.test(path) ? path : []
  })
}

/**
 * The file a review thread link points at. A comment link shows the path itself.
 * Otherwise it is the text near the link that hashes to the link's
 * `diff-<sha256(path)>` anchor. The link itself may be the path or an icon beside
 * it, so the search widens a few ancestors, stopping before it reaches another
 * thread.
 */
export async function threadFileOf(link: HTMLAnchorElement): Promise<ThreadFile | null> {
  const commentPath = commentLinkPath(link)
  if (commentPath) return { path: commentPath, label: link }

  const hash = linkHash(link)
  if (!hash) return null

  let scope: Element | null = link
  for (let depth = 0; scope && depth <= LABEL_SEARCH_DEPTH; scope = scope.parentElement, depth++) {
    if (threadKeysIn(scope).size > 1) return null
    for (const element of [scope, ...scope.querySelectorAll("*")]) {
      if (!outsideComments(element)) continue
      for (const path of pathCandidates(element)) {
        if ((await sha256Hex(path)) === hash) return { path, label: element.closest("a") ?? element }
      }
    }
  }
  return null
}

/**
 * The diff snippet GitHub shows in a link's thread, or null while it is
 * collapsed or not loaded. Stops at the first ancestor that reaches another
 * thread's link.
 */
export function threadSnippetOf(link: HTMLAnchorElement): HTMLTableElement | null {
  for (let element = link.parentElement; element; element = element.parentElement) {
    if (threadKeysIn(element).size > 1) return null
    const snippets = snippetsIn(element)
    if (snippets.length > 0) return snippets.length === 1 ? snippets[0]! : null
  }
  return null
}

/** The review thread snippet a node sits in. */
export function findThreadSnippetOf(node: Node | null): HTMLTableElement | null {
  const element = node instanceof Element ? node : node?.parentElement
  const table = element?.closest("table")
  return table && isThreadSnippet(table) ? table : null
}

function threadLinkOf(snippet: HTMLTableElement): HTMLAnchorElement | null {
  for (let element = snippet.parentElement; element; element = element.parentElement) {
    if (snippetsIn(element).length > 1) return null
    const links = findThreadLinks(element)
    if (links.length > 0) return threadKeysIn(element).size === 1 ? links[0]! : null
  }
  return null
}

/** False for a review thread snippet whose file link can't be found, so its path can't be resolved. */
export function hasCodePath(container: HTMLElement): boolean {
  return !(container instanceof HTMLTableElement && isThreadSnippet(container)) || threadLinkOf(container) !== null
}

/** Head path of a changes-view file container or a review thread snippet. */
export async function resolveCodePath(container: HTMLElement): Promise<string | null> {
  if (container instanceof HTMLTableElement && isThreadSnippet(container)) {
    const link = threadLinkOf(container)
    return link ? ((await threadFileOf(link))?.path ?? null) : null
  }
  return resolveHeadPath(container)
}
