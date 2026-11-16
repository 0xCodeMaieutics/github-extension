import { headLineOf } from "./diff"
import { findFileContainerOf, resolveHeadPath } from "./files"
import type { LineRange } from "./reference"

export interface BugbotLocation {
  path: string
  /** Null when only the file is known. */
  range: LineRange | null
}

export interface BugbotIssue {
  /** Markdown when read from the raw comment; text with backticked code when read from the rendered body. */
  description: string
  locations: BugbotLocation[]
}

/** Issue comments end with "Fix in Cursor" / "Fix in Web"; the review summary's "Fix All in Cursor" does not match. */
const FIX_IN_CURSOR_SELECTOR = 'img[alt="Fix in Cursor"]'
const FIX_LINK_IMAGE_SELECTOR = 'img[alt^="Fix in "]'
const BODY_SELECTOR = ".markdown-body"
const COMMENT_GROUP_SELECTOR = ".timeline-comment-group, .review-comment, .js-comment"
const RAW_MARKDOWN_SELECTOR = 'clipboard-copy[data-dd-action-name="comment.copy_markdown"][value]'
const THREAD_SELECTOR = "review-thread-collapsible, .review-thread-component, .js-resolvable-timeline-thread-container"
const THREAD_SNIPPET_SELECTOR = ".blob-wrapper table, deferred-diff-lines table"

const DESCRIPTION = /<!-- DESCRIPTION START -->([\s\S]*?)<!-- DESCRIPTION END -->/
const LOCATIONS = /<!-- LOCATIONS START([\s\S]*?)LOCATIONS END -->/
const LOCATION = /^(.+)#L(\d+)(?:-L(\d+))?$/
const SEVERITY_TEXT = /^.+ Severity$/

/** Rendered bodies of Bugbot issue comments under `root`. */
export function findBugbotBodies(root: ParentNode = document): Element[] {
  const bodies = [...root.querySelectorAll(FIX_IN_CURSOR_SELECTOR)].flatMap((image) => image.closest(BODY_SELECTOR) ?? [])
  return [...new Set(bodies)]
}

/** The last "Fix in …" link, after which the copy button goes. */
export function findFixLinks(body: Element): Element | null {
  return [...body.querySelectorAll(FIX_LINK_IMAGE_SELECTOR)].flatMap((image) => image.closest("a") ?? []).at(-1) ?? null
}

function parseLocation(line: string): BugbotLocation | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const match = LOCATION.exec(trimmed)
  if (!match) return { path: trimmed, range: null }
  const [, path, start, end = start] = match
  const startLine = Number(start)
  const endLine = Number(end)
  return { path: path!, range: { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) } }
}

/** Reads the raw comment markdown, whose HTML comments carry the description bounds and the locations. */
export function parseBugbotMarkdown(markdown: string): BugbotIssue | null {
  const description = DESCRIPTION.exec(markdown)?.[1]?.trim()
  if (description === undefined) return null
  return {
    description,
    locations: (LOCATIONS.exec(markdown)?.[1] ?? "").split("\n").flatMap((line) => parseLocation(line) ?? []),
  }
}

/** Text of rendered markdown with inline code backticked, code blocks fenced and list items bulleted. */
function readableText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll("pre").forEach((pre) => pre.replaceWith(`\n\`\`\`\n${pre.textContent?.replace(/\n$/, "")}\n\`\`\`\n`))
  copy.querySelectorAll("code").forEach((code) => code.replaceWith(`\`${code.textContent}\``))
  copy.querySelectorAll("li").forEach((item) => item.prepend("- "))
  return (copy.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Fallback when the raw markdown is not on the page: the blocks between the
 * title and the Fix links, minus the severity line. No locations, since they
 * only live in an HTML comment.
 */
export function readRenderedBugbotIssue(body: Element): BugbotIssue | null {
  const heading = body.querySelector("h1, h2, h3, h4, h5, h6")
  if (!heading) return null

  const blocks = [...body.children]
  const description: string[] = []
  for (const block of blocks.slice(blocks.findIndex((block) => block.contains(heading)) + 1)) {
    if (block.querySelector(FIX_LINK_IMAGE_SELECTOR)) break
    const text = block.textContent?.trim() ?? ""
    const isSeverity = SEVERITY_TEXT.test(text) && block.querySelector("strong")?.textContent?.trim() === text
    if (text && !isSeverity) description.push(readableText(block))
  }
  return { description: description.join("\n\n"), locations: [] }
}

function commentGroupOf(node: Element): Element | null {
  return node.closest(COMMENT_GROUP_SELECTOR)
}

/** GitHub's "Copy Markdown" menu item carries the comment's raw body. */
export function rawMarkdownOf(body: Element): string | null {
  const group = commentGroupOf(body)
  if (!group) return null
  const copy = [...group.querySelectorAll(RAW_MARKDOWN_SELECTOR)].find((item) => commentGroupOf(item) === group)
  return copy?.getAttribute("value") ?? null
}

export function readBugbotIssue(body: Element): BugbotIssue | null {
  const markdown = rawMarkdownOf(body)
  return (markdown && parseBugbotMarkdown(markdown)) || readRenderedBugbotIssue(body)
}

async function threadPathOf(body: Element): Promise<string | null> {
  const container = findFileContainerOf(body)
  if (container) return resolveHeadPath(container)
  const link = body.closest(THREAD_SELECTOR)?.querySelector('a[href*="#diff-"]')
  return link?.textContent?.trim() || null
}

/**
 * The commented line: the last head line of the diff snippet GitHub shows above
 * the comment on the conversation tab, else the diff row the comment hangs under.
 */
function threadLineOf(body: Element): number | null {
  const snippet = body.closest(THREAD_SELECTOR)?.querySelector(THREAD_SNIPPET_SELECTOR)
  if (snippet) return [...snippet.querySelectorAll("tr")].flatMap((row) => headLineOf(row) ?? []).at(-1) ?? null

  for (let row = body.closest("tr")?.previousElementSibling; row; row = row.previousElementSibling) {
    const line = headLineOf(row)
    if (line !== null) return line
  }
  return null
}

/** Where the comment sits, for when the issue's own locations are unknown. */
export async function threadLocationOf(body: Element): Promise<BugbotLocation | null> {
  const path = await threadPathOf(body)
  if (!path) return null
  const line = threadLineOf(body)
  return { path, range: line === null ? null : { startLine: line, endLine: line } }
}

function formatLocation({ path, range }: BugbotLocation): string {
  if (range === null) return path
  return range.endLine > range.startLine ? `${path}:${range.startLine}-${range.endLine}` : `${path}:${range.startLine}`
}

/** Mirrors the prompt Bugbot's own "Fix in Cursor" link opens. */
export function formatBugbotPrompt(issue: BugbotIssue): string {
  const affected = issue.locations.length > 0 ? `Affected files: ${issue.locations.map(formatLocation).join(", ")}` : ""
  return ["Verify this issue exists and fix it:", issue.description, affected].filter(Boolean).join("\n\n")
}
