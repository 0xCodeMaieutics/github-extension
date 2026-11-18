import { EDITORS, type Editor } from "./editor"

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC = /^\\\\[^\\]+\\[^\\]+/

/**
 * The extension cannot touch the filesystem, so a stored local root is
 * "valid" when it is syntactically an absolute path. `~` is rejected because
 * the editors' `<scheme>://file` handlers do not expand it.
 */
export function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_DRIVE.test(path) || WINDOWS_UNC.test(path)
}

/** Trims whitespace, surrounding quotes and trailing separators from a typed local root. */
export function normalizeLocalRoot(input: string): string {
  let path = input.trim()
  if (path.length >= 2 && /^(["']).*\1$/.test(path)) path = path.slice(1, -1).trim()
  path = path.replace(/\\/g, "/")
  while (path.length > 1 && path.endsWith("/") && !/^[A-Za-z]:\/$/.test(path)) {
    path = path.slice(0, -1)
  }
  return path
}

export function joinRepoPath(localRoot: string, repoRelativePath: string): string {
  const root = normalizeLocalRoot(localRoot).replace(/\/+$/, "")
  const relative = repoRelativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  return `${root}/${relative}`
}

/**
 * Builds `<scheme>://file/<absolute path>:<line>:<column>` (`vscode://` or `zed://`;
 * both accept this shape), or just the path when `line` is null. Windows paths gain a
 * leading slash (`/C:/...`) as VS Code expects; path segments are percent-encoded so
 * spaces and `#`/`?` survive the URL handler.
 */
export function buildEditorFileUrl(editor: Editor, absolutePath: string, line: number | null, column = 1): string {
  const forward = absolutePath.replace(/\\/g, "/")
  const withLeadingSlash = forward.startsWith("/") ? forward : `/${forward}`
  const encoded = withLeadingSlash
    .split("/")
    .map((segment, index) => {
      const isDrive = /^[A-Za-z]:$/.test(segment) && index === 1
      return isDrive ? segment : encodeURIComponent(segment)
    })
    .join("/")
  if (line === null) return `${EDITORS[editor].scheme}://file${encoded}`
  const safeLine = Number.isInteger(line) && line > 0 ? line : 1
  const safeColumn = Number.isInteger(column) && column > 0 ? column : 1
  return `${EDITORS[editor].scheme}://file${encoded}:${safeLine}:${safeColumn}`
}
