import { findBugbotBodies, findFixLinks } from "@/lib/file-opener/bugbot"
import { CHECK_ICON, COPIED_FEEDBACK_MS, COPY_ICON } from "./affordance"

export const BUGBOT_COPY_ATTRIBUTE = "data-gvfo-bugbot-copy"

const LABEL = "Copy for AI"

function render(button: HTMLButtonElement, copied: boolean): void {
  button.innerHTML = `${copied ? CHECK_ICON : COPY_ICON}<span>${copied ? "Copied" : LABEL}</span>`
}

function createCopyButton(onCopy: () => Promise<boolean>): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute(BUGBOT_COPY_ATTRIBUTE, "")
  button.title = "Copy a prompt asking an AI agent to verify and fix this issue"
  button.setAttribute("aria-label", button.title)
  render(button, false)
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    boxSizing: "border-box",
    height: "28px",
    margin: "0 0 0 4px",
    padding: "0 10px",
    verticalAlign: "top",
    font: "500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
    color: "var(--button-default-fgColor-rest, var(--fgColor-default, #25292e))",
    background: "var(--button-default-bgColor-rest, #f6f8fa)",
    border: "1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d1d9e0))",
    borderRadius: "6px",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>)

  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    void onCopy().then((copied) => {
      if (!copied) return
      render(button, true)
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => render(button, false), COPIED_FEEDBACK_MS)
    })
  })
  return button
}

/** Adds a copy button after the "Fix in Cursor" / "Fix in Web" links of each Bugbot issue comment. */
export function injectBugbotCopyButtons(onCopy: (body: Element) => Promise<boolean>, root: ParentNode = document): void {
  for (const body of findBugbotBodies(root)) {
    if (body.querySelector(`[${BUGBOT_COPY_ATTRIBUTE}]`)) continue
    findFixLinks(body)?.after(createCopyButton(() => onCopy(body)))
  }
}
