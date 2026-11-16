import t3IconUrl from "@/assets/t3-icon.png?inline"
import { EDITORS, type Editor } from "@/lib/file-opener/editor"

export const AFFORDANCE_ATTRIBUTE = "data-gvfo-open"
export const T3_AFFORDANCE_ATTRIBUTE = "data-gvfo-t3"

export const VSCODE_ICON = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 100 100" fill="currentColor">
  <path d="M96.46 10.8 75.86.87a6.23 6.23 0 0 0-7.1 1.2L29.33 38.04 12.15 25a4.16 4.16 0 0 0-5.32.24l-5.5 5a4.17 4.17 0 0 0 0 6.16L16.23 50 1.33 63.6a4.17 4.17 0 0 0 0 6.16l5.5 5a4.16 4.16 0 0 0 5.32.24l17.18-13.04 39.43 35.97a6.22 6.22 0 0 0 7.1 1.2l20.6-9.92A6.25 6.25 0 0 0 100 83.6V16.4a6.25 6.25 0 0 0-3.54-5.6ZM75.01 72.7 45.1 50l29.92-22.7v45.4Z"/>
</svg>`

export const ZED_ICON = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
  <path d="M2 2.75C2 2.336 2.336 2 2.75 2h10.5a.75.75 0 0 1 .53 1.28L5.06 12h7.44V9H14v3.25a.75.75 0 0 1-.75.75H2.75a.75.75 0 0 1-.53-1.28L10.94 3.5H3.5v3H2Z"/>
</svg>`

/** Icon markup and color for each editor's open affordance. */
export const EDITOR_ICONS: Record<Editor, { icon: string; color: string }> = {
  vscode: { icon: VSCODE_ICON, color: "#007acc" },
  zed: { icon: ZED_ICON, color: "var(--fgColor-default, #1f2328)" },
}

export const T3_ICON = `<img src="${t3IconUrl}" alt="" aria-hidden="true" width="16" height="16" style="display:block;border-radius:3px" />`

export const COPY_ICON = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>`
export const CHECK_ICON = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="#1a7f37"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`
export const COPIED_FEEDBACK_MS = 1200

export interface AffordanceHandlers {
  /** `repair` is true when the user alt/option-clicks to change the mapping. */
  onActivate: (options: { repair: boolean }) => void
}

function createHeaderButton(
  attribute: string,
  icon: string,
  color: string,
  labels: { title: string; ariaLabel: string },
  handlers: AffordanceHandlers,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute(attribute, "")
  button.className = "btn-octicon"
  button.title = labels.title
  button.setAttribute("aria-label", labels.ariaLabel)
  button.innerHTML = icon
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "4px",
    padding: "4px",
    color,
    background: "transparent",
    border: "0",
    borderRadius: "6px",
    cursor: "pointer",
    verticalAlign: "middle",
  } satisfies Partial<CSSStyleDeclaration>)

  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    handlers.onActivate({ repair: event.altKey })
  })
  return button
}

export function createOpenAffordance(path: string, editor: Editor, handlers: AffordanceHandlers): HTMLButtonElement {
  const { label } = EDITORS[editor]
  const { icon, color } = EDITOR_ICONS[editor]
  return createHeaderButton(
    AFFORDANCE_ATTRIBUTE,
    icon,
    color,
    { title: `Open ${path} in ${label} (⌥/Alt-click to change the local folder)`, ariaLabel: `Open ${path} in ${label}` },
    handlers,
  )
}

export function createT3ContextAffordance(path: string, handlers: AffordanceHandlers): HTMLButtonElement {
  return createHeaderButton(
    T3_AFFORDANCE_ATTRIBUTE,
    T3_ICON,
    "var(--fgColor-default, #1f2328)",
    {
      title: `Reference ${path} in T3 Code chat`,
      ariaLabel: `Reference ${path} in T3 Code chat`,
    },
    handlers,
  )
}
