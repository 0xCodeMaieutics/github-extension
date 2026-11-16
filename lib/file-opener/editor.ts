import { browser } from "wxt/browser"

/** Desktop editors a local open can target. */
export type Editor = "vscode" | "zed"

export const EDITORS: Record<Editor, { label: string; scheme: string }> = {
  vscode: { label: "VS Code", scheme: "vscode" },
  zed: { label: "Zed", scheme: "zed" },
}

export const DEFAULT_EDITOR: Editor = "vscode"
export const EDITOR_STORAGE_KEY = "openEditor"

export function isEditor(value: unknown): value is Editor {
  return typeof value === "string" && Object.hasOwn(EDITORS, value)
}

export async function getEditor(): Promise<Editor> {
  const stored = (await browser.storage.local.get(EDITOR_STORAGE_KEY))[EDITOR_STORAGE_KEY]
  return isEditor(stored) ? stored : DEFAULT_EDITOR
}

export async function setEditor(editor: Editor): Promise<void> {
  await browser.storage.local.set({ [EDITOR_STORAGE_KEY]: editor })
}
