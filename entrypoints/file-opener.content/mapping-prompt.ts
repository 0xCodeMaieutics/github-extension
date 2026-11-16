import { isAbsoluteLocalPath, normalizeLocalRoot } from "@/lib/file-opener/paths"

export interface MappingPromptOptions {
  repository: string
  /** Present for mapping repair; prefilled so the user can correct it. */
  currentPath?: string
  reason?: string
}

const STYLES = `
  :host { all: initial; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(1, 4, 9, 0.5);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  }
  .dialog {
    width: min(560px, calc(100vw - 32px));
    padding: 20px; border-radius: 12px;
    background: #ffffff; color: #1f2328;
    box-shadow: 0 8px 24px rgba(140, 149, 159, 0.3);
  }
  h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  p { margin: 0 0 12px; color: #59636e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  input {
    box-sizing: border-box; width: 100%; padding: 6px 10px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    border: 1px solid #d1d9e0; border-radius: 6px; color: inherit; background: #f6f8fa;
  }
  input:focus { outline: 2px solid #0969da; outline-offset: -1px; background: #ffffff; }
  .error { min-height: 18px; margin: 6px 0 0; color: #d1242f; font-size: 12px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  button {
    padding: 5px 16px; border-radius: 6px; font: inherit; font-weight: 500; cursor: pointer;
    border: 1px solid #d1d9e0; background: #f6f8fa; color: #25292e;
  }
  button.primary { border-color: rgba(31, 35, 40, 0.15); background: #1f883d; color: #ffffff; }
  @media (prefers-color-scheme: dark) {
    .dialog { background: #151b23; color: #f0f6fc; box-shadow: 0 8px 24px #010409; }
    p { color: #9198a1; }
    input { background: #0d1117; border-color: #3d444d; }
    input:focus { background: #0d1117; }
    button { background: #212830; border-color: #3d444d; color: #f0f6fc; }
    button.primary { background: #238636; }
  }
`

/**
 * In-page mapping prompt (also used for mapping repair). Resolves with the
 * normalized absolute local root, or null when the user cancels.
 */
export function promptForLocalRoot(options: MappingPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div")
    const shadow = host.attachShadow({ mode: "closed" })
    const isRepair = options.currentPath !== undefined

    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="backdrop">
        <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
          <h2 id="title"></h2>
          <p class="description"></p>
          <input name="path" type="text" autocomplete="off" spellcheck="false" />
          <div class="error" role="alert"></div>
          <div class="actions">
            <button type="button" class="cancel">Cancel</button>
            <button type="submit" class="primary">Save &amp; Open</button>
          </div>
        </form>
      </div>
    `

    const form = shadow.querySelector("form")!
    const input = shadow.querySelector("input")!
    const error = shadow.querySelector<HTMLElement>(".error")!
    shadow.querySelector("#title")!.textContent = isRepair
      ? `Update local folder for ${options.repository}`
      : `Where is ${options.repository} on this computer?`
    shadow.querySelector(".description")!.textContent =
      options.reason ??
      "Type the absolute path to the repository root. Files open from your current checkout; no branch is switched."
    input.placeholder = "/Users/you/code/" + (options.repository.split("/")[1] ?? "repository")
    input.value = options.currentPath ?? ""

    const close = (result: string | null) => {
      document.removeEventListener("keydown", onKeyDown, true)
      host.remove()
      resolve(result)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      close(null)
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const path = normalizeLocalRoot(input.value)
      if (!isAbsoluteLocalPath(path)) {
        error.textContent = "Enter an absolute path, e.g. /Users/you/code/repo or C:\\code\\repo (~ is not expanded)."
        input.focus()
        return
      }
      close(path)
    })
    shadow.querySelector(".cancel")!.addEventListener("click", () => close(null))
    shadow.querySelector(".backdrop")!.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) close(null)
    })
    // Keep GitHub's global keyboard shortcuts from firing while typing.
    form.addEventListener("keydown", (event) => event.stopPropagation())
    document.addEventListener("keydown", onKeyDown, true)

    document.documentElement.append(host)
    input.focus()
    input.select()
  })
}
