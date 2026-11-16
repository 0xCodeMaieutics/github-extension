import { createHash } from "node:crypto"

export const diffId = (path: string) => `diff-${createHash("sha256").update(path).digest("hex")}`

type Row =
  | { hunk: string }
  | { context: [number, number] }
  | { add: number }
  | { del: number }

function classicRow(row: Row): string {
  if ("hunk" in row) {
    return `<tr class="js-expandable-line"><td class="blob-num blob-num-expandable" colspan="2"><a href="#">↑</a></td><td class="blob-code blob-code-inner blob-code-hunk">${row.hunk}</td></tr>`
  }
  if ("context" in row) {
    const [left, right] = row.context
    return `<tr><td data-line-number="${left}" class="blob-num blob-num-context"></td><td data-line-number="${right}" class="blob-num blob-num-context js-blob-rnum"></td><td class="blob-code blob-code-context"><span class="blob-code-inner blob-code-marker" data-code-marker=" ">ctx</span></td></tr>`
  }
  if ("add" in row) {
    return `<tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="${row.add}" class="blob-num blob-num-addition js-blob-rnum"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker" data-code-marker="+">added</span></td></tr>`
  }
  return `<tr><td data-line-number="${row.del}" class="blob-num blob-num-deletion"></td><td class="blob-num blob-num-deletion empty-cell"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner blob-code-marker" data-code-marker="-">removed</span></td></tr>`
}

/** Mirrors the classic `/files` markup observed on github.com. */
export function classicFile(options: { path: string; deleted?: boolean; rows?: Row[]; title?: string }): string {
  const id = diffId(options.path)
  const deleted = String(options.deleted ?? false)
  const body = options.rows
    ? `<table class="diff-table" data-diff-anchor="${id}"><tbody>${options.rows.map(classicRow).join("")}</tbody></table>`
    : `<div class="js-diff-load-container">Load diff</div>`
  return `
    <copilot-diff-entry data-file-path="${options.path}">
      <div id="${id}" class="file js-file" data-file-deleted="${deleted}" data-tagsearch-path="${options.path}">
        <div class="file-header js-file-header" data-path="${options.path}" data-anchor="${id}" data-file-deleted="${deleted}">
          <div class="file-info">
            <span class="Truncate"><a title="${options.title ?? options.path}" class="Link--primary Truncate-text" href="#${id}">${options.title ?? options.path}</a></span>
          </div>
          <div class="file-actions"></div>
        </div>
        <div class="js-file-content">${body}</div>
      </div>
    </copilot-diff-entry>`
}

/** Approximates the React `/changes` UI: hashed id, module-class header, no data-path attributes. */
export function reactFile(options: { path: string; label?: string; rows?: string; status?: string }): string {
  const id = diffId(options.path)
  return `
    <div id="${id}" role="region">
      <div class="DiffFileHeader-module__diff-file-header--abc12">
        ${options.status ?? ""}
        <h3 class="DiffFileHeader-module__file-name--x"><a href="#${id}"><code>\u200e${options.label ?? options.path}\u200e</code></a></h3>
      </div>
      <table><tbody>${options.rows ?? ""}</tbody></table>
    </div>`
}
