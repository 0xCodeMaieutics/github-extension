import { EDITORS, type Editor } from "@/lib/file-opener/editor"
import { toCodeSelection, type CodeSelection } from "@/lib/file-opener/selection"
import { CHECK_ICON, COPIED_FEEDBACK_MS, COPY_ICON, EDITOR_ICONS, T3_ICON } from "./affordance"

export const SELECTION_AFFORDANCE_ATTRIBUTE = "data-gvfo-t3-selection"

const KEYBOARD_DEBOUNCE_MS = 250
const SELECTION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])

const STYLES = `
  :host { all: initial; }
  .toolbar { display: flex; gap: 4px; }
  button {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; padding: 0;
    border: 1px solid #d1d9e0; border-radius: 6px;
    background: #ffffff; color: #1f2328; cursor: pointer;
    box-shadow: 0 1px 3px rgba(31, 35, 40, 0.12), 0 8px 24px rgba(66, 74, 83, 0.12);
  }
  button:hover { background: #f6f8fa; }
  button:focus-visible { outline: 2px solid #0969da; outline-offset: 1px; }
  button.editor.vscode { color: #007acc; }
  @media (prefers-color-scheme: dark) {
    button { background: #151b23; border-color: #3d444d; color: #f0f6fc; box-shadow: 0 8px 24px #010409; }
    button:hover { background: #212830; }
  }
`

export interface SelectionAffordanceOptions {
  /** Whether the current page is a pull request changes view. */
  isActive: () => boolean
  /** Deleted-only files have no head path to reference. */
  isReferenceable: (container: HTMLElement) => boolean
  onOpen: (selection: CodeSelection) => void
  /** The editor the open button targets; read each time the toolbar is shown. */
  editor: () => Editor
  /** `repair` is true when the user alt/option-clicks to change the mapping. */
  onOpenInEditor: (selection: CodeSelection, options: { repair: boolean }) => void
  /** Copies the prompt the T3 icon would send; resolves false when nothing was copied. */
  onCopy: (selection: CodeSelection) => Promise<boolean>
}

function sameRange(a: Range, b: Range): boolean {
  return (
    a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0
  )
}

/**
 * Floating editor (VS Code or Zed), T3 and copy icons shown just past the end of a code selection. It appears once
 * a mouse (or debounced keyboard) selection settles, stays anchored to the page
 * while scrolling, and hides when the selection changes or on Escape.
 */
export function installSelectionAffordance(options: SelectionAffordanceOptions): void {
  const host = document.createElement("div")
  host.setAttribute(SELECTION_AFFORDANCE_ATTRIBUTE, "")
  Object.assign(host.style, { position: "absolute", zIndex: "2147483646" } satisfies Partial<CSSStyleDeclaration>)
  const shadow = host.attachShadow({ mode: "closed" })
  shadow.innerHTML = `<style>${STYLES}</style>
    <div class="toolbar">
      <button type="button" class="editor"></button>
      <button type="button" class="open">${T3_ICON}</button>
      <button type="button" class="copy">${COPY_ICON}</button>
    </div>`
  const editorButton = shadow.querySelector<HTMLButtonElement>(".editor")!
  const openButton = shadow.querySelector<HTMLButtonElement>(".open")!
  const copyButton = shadow.querySelector<HTMLButtonElement>(".copy")!

  let shown: { range: Range; selection: CodeSelection } | null = null
  let keyboardTimer: ReturnType<typeof setTimeout> | undefined

  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  const hide = () => {
    shown = null
    clearTimeout(copiedTimer)
    copyButton.innerHTML = COPY_ICON
    host.remove()
  }

  const evaluate = () => {
    const selection = document.getSelection()
    if (!options.isActive() || !selection || selection.rangeCount === 0 || selection.isCollapsed) return hide()

    const range = selection.getRangeAt(0)
    const code = toCodeSelection(range)
    if (!code || !options.isReferenceable(code.container)) return hide()

    const rects = range.getClientRects()
    const end = rects[rects.length - 1] ?? range.getBoundingClientRect()
    const left = Math.min(end.right + 4, document.documentElement.clientWidth - 96)
    host.style.left = `${left + window.scrollX}px`
    host.style.top = `${end.top + end.height / 2 - 14 + window.scrollY}px`

    const lines = code.startLine === code.endLine ? `line ${code.startLine}` : `lines ${code.startLine}–${code.endLine}`
    const editor = options.editor()
    const { label } = EDITORS[editor]
    editorButton.innerHTML = EDITOR_ICONS[editor].icon
    editorButton.className = `editor ${editor}`
    editorButton.title = `Open line ${code.startLine} in ${label} (⌥/Alt-click to change the local folder)`
    editorButton.setAttribute("aria-label", `Open line ${code.startLine} in ${label}`)
    openButton.title = `Reference ${lines} in T3 Code chat`
    openButton.setAttribute("aria-label", openButton.title)
    copyButton.title = `Copy the prompt for ${lines}`
    copyButton.setAttribute("aria-label", copyButton.title)

    shown = { range: range.cloneRange(), selection: code }
    if (!host.isConnected) document.documentElement.append(host)
  }

  // Keep the page selection alive while an icon is pressed.
  shadow.addEventListener("mousedown", (event) => event.preventDefault())
  editorButton.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    const current = shown
    hide()
    if (current) options.onOpenInEditor(current.selection, { repair: event.altKey })
  })
  openButton.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    const current = shown
    hide()
    if (current) options.onOpen(current.selection)
  })
  copyButton.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    const current = shown
    if (!current) return
    void options.onCopy(current.selection).then((copied) => {
      if (!copied || shown !== current) return
      copyButton.innerHTML = CHECK_ICON
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => (copyButton.innerHTML = COPY_ICON), COPIED_FEEDBACK_MS)
    })
  })

  document.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host)) return
    // Let the browser finish updating the selection for this click first.
    setTimeout(evaluate, 0)
  })
  document.addEventListener("keyup", (event) => {
    if (event.key !== "Shift" && !(event.shiftKey && SELECTION_KEYS.has(event.key))) return
    clearTimeout(keyboardTimer)
    keyboardTimer = setTimeout(evaluate, KEYBOARD_DEBOUNCE_MS)
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shown) hide()
  })
  document.addEventListener("selectionchange", () => {
    if (!shown) return
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || !sameRange(selection.getRangeAt(0), shown.range)) hide()
  })
}
