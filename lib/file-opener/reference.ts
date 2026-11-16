import { codeTextOf, headLineOf } from "./diff"
import type { PullRequestRef } from "./github"

/** T3 Code rejects prompt links longer than this. */
export const PROMPT_LINK_MAX_CHARS = 8000

export interface LineRange {
  startLine: number
  endLine: number
}

/**
 * Head-side text of every line in the range, read from the rendered diff.
 * Returns null unless each line is rendered, e.g. when the range spans lines
 * GitHub collapsed between hunks.
 */
export function readHeadLines(container: Element, range: LineRange): string | null {
  const lines = new Map<number, string>()
  for (const row of container.querySelectorAll("tr")) {
    const line = headLineOf(row)
    if (line === null || line < range.startLine || line > range.endLine || lines.has(line)) continue
    const text = codeTextOf(row)
    if (text !== null) lines.set(line, text)
  }
  if (lines.size !== range.endLine - range.startLine + 1) return null
  return [...lines.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join("\n")
}

export function formatReferenceLocation(path: string, range: LineRange | null): string {
  if (range === null) return path
  return range.endLine > range.startLine ? `${path}:${range.startLine}~${range.endLine}` : `${path}:${range.startLine}`
}

function fenceFor(code: string): string {
  const longestRun = Math.max(0, ...[...code.matchAll(/`+/g)].map((match) => match[0].length))
  return "`".repeat(Math.max(3, longestRun + 1))
}

export function formatPullRequestLine(pullRequest: PullRequestRef): string {
  const url = `https://github.com/${pullRequest.owner}/${pullRequest.name}/pull/${pullRequest.number}`
  return `PR #${pullRequest.number}: ${url}`
}

/**
 * Chat file reference prompt: the pull request, the reference location, then
 * the excerpt in a fenced block. A null range references the whole file. The
 * excerpt is dropped when unknown or when it would push the prompt past T3
 * Code's link limit.
 */
export function formatReferencePrompt(
  pullRequest: PullRequestRef,
  path: string,
  range: LineRange | null,
  excerpt: string | null,
): string {
  const header = `${formatPullRequestLine(pullRequest)}\n${formatReferenceLocation(path, range)}\n`
  if (excerpt === null) return header

  const fence = fenceFor(excerpt)
  const language = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""
  const prompt = `${header}${fence}${language}\n${excerpt}\n${fence}\n`
  return prompt.length <= PROMPT_LINK_MAX_CHARS ? prompt : header
}

/** `t3code://new` prompt link; `repo` makes T3 Code open the draft in that repository's project. */
export function buildT3PromptUrl(options: { repo: string; prompt: string }): string {
  return `t3code://new?prompt=${encodeURIComponent(options.prompt)}&repo=${encodeURIComponent(options.repo)}`
}
