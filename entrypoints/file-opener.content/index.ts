import { browser } from "wxt/browser"
import { defineContentScript } from "wxt/utils/define-content-script"
import {
  AFFORDANCE_ATTRIBUTE,
  createOpenAffordance,
  createT3ContextAffordance,
  T3_AFFORDANCE_ATTRIBUTE,
} from "./affordance"
import { injectBugbotCopyButtons } from "./bugbot-affordance"
import { promptForLocalRoot } from "./mapping-prompt"
import { installSelectionAffordance } from "./selection-affordance"
import { formatBugbotPrompt, readBugbotIssue, threadLocationOf } from "@/lib/file-opener/bugbot"
import { findDiffAnchor } from "@/lib/file-opener/diff"
import { DEFAULT_EDITOR, EDITOR_STORAGE_KEY, getEditor, isEditor, type Editor } from "@/lib/file-opener/editor"
import { findAffordanceSlot, findFileContainers, getFileStatus, resolveHeadPath, type FileStatus } from "@/lib/file-opener/files"
import {
  parseLineSelection,
  parsePullRequestChangesView,
  parsePullRequestPage,
  repositoryKey,
  type PullRequestRef,
} from "@/lib/file-opener/github"
import { getRepositoryMapping, setRepositoryMapping } from "@/lib/file-opener/mappings"
import { buildEditorFileUrl, isAbsoluteLocalPath, joinRepoPath } from "@/lib/file-opener/paths"
import { buildT3PromptUrl, formatReferencePrompt, readHeadLines, type LineRange } from "@/lib/file-opener/reference"
import {
  findThreadLinks,
  hasCodePath,
  resolveCodePath,
  threadFileOf,
  threadSnippetOf,
  type ThreadFile,
} from "@/lib/file-opener/threads"

const pendingContainers = new WeakSet<HTMLElement>()
const pendingThreadLinks = new WeakSet<HTMLAnchorElement>()
const threadFiles = new WeakMap<HTMLAnchorElement, ThreadFile | null>()
const settledStatuses = new WeakMap<HTMLElement, Exclude<FileStatus, "unknown">>()

let editor: Editor = DEFAULT_EDITOR
let editorLoaded: Promise<unknown> = Promise.resolve()

async function resolveLocalRoot(pullRequest: PullRequestRef, forceRepair: boolean): Promise<string | null> {
  const repository = `${pullRequest.owner}/${pullRequest.name}`
  const key = repositoryKey(pullRequest.owner, pullRequest.name)
  const stored = await getRepositoryMapping(key)

  if (stored && isAbsoluteLocalPath(stored) && !forceRepair) return stored

  const localRoot = await promptForLocalRoot({
    repository,
    currentPath: stored,
    reason:
      stored && !isAbsoluteLocalPath(stored)
        ? `The saved folder "${stored}" is not an absolute path. Type the absolute path to the repository root.`
        : undefined,
  })
  if (localRoot) await setRepositoryMapping(key, localRoot)
  return localRoot
}

/** `line` is null to open the file without moving to a line. */
async function openInEditor(headPath: string, line: number | null, forceRepair: boolean): Promise<void> {
  const pullRequest = parsePullRequestPage(location.href)
  if (!pullRequest) return

  const localRoot = await resolveLocalRoot(pullRequest, forceRepair)
  if (!localRoot) return

  location.href = buildEditorFileUrl(editor, joinRepoPath(localRoot, headPath), line)
}

/** Lines the header-row open affordance targets: the line selection for this file, else the diff anchor or line 1. */
function headerLines(container: HTMLElement): LineRange {
  const selection = parseLineSelection(location.hash)
  if (selection?.diffId === container.id) return selection
  const line = findDiffAnchor(container) ?? 1
  return { startLine: line, endLine: line }
}

/** `lines` is null for a whole-file reference. */
function referenceInT3(container: HTMLElement, headPath: string, lines: LineRange | null): void {
  const pullRequest = parsePullRequestPage(location.href)
  if (!pullRequest) return

  location.href = buildT3PromptUrl({
    repo: `${pullRequest.owner}/${pullRequest.name}`,
    prompt: referencePrompt(pullRequest, container, headPath, lines),
  })
}

function referencePrompt(
  pullRequest: PullRequestRef,
  container: HTMLElement,
  headPath: string,
  lines: LineRange | null,
): string {
  return formatReferencePrompt(pullRequest, headPath, lines, lines && readHeadLines(container, lines))
}

async function copyReferencePrompt(container: HTMLElement, lines: LineRange): Promise<boolean> {
  const pullRequest = parsePullRequestPage(location.href)
  const headPath = await resolveCodePath(container)
  if (!pullRequest || !headPath) return false
  try {
    await navigator.clipboard.writeText(referencePrompt(pullRequest, container, headPath, lines))
    return true
  } catch {
    return false
  }
}

async function copyBugbotPrompt(body: Element): Promise<boolean> {
  const issue = readBugbotIssue(body)
  if (!issue) return false

  const threadLocation = issue.locations.length > 0 ? null : await threadLocationOf(body)
  const located = threadLocation ? { ...issue, locations: [threadLocation] } : issue
  try {
    await navigator.clipboard.writeText(formatBugbotPrompt(located))
    return true
  } catch {
    return false
  }
}

function fileStatus(container: HTMLElement): FileStatus {
  const known = settledStatuses.get(container)
  if (known) return known
  const status = getFileStatus(container)
  if (status !== "unknown") settledStatuses.set(container, status)
  return status
}

const AFFORDANCE_SELECTOR = `[${AFFORDANCE_ATTRIBUTE}], [${T3_AFFORDANCE_ATTRIBUTE}]`

async function injectAffordance(container: HTMLElement): Promise<void> {
  const existing = container.querySelectorAll(AFFORDANCE_SELECTOR)
  if (fileStatus(container) === "deleted") {
    existing.forEach((button) => button.remove())
    return
  }
  if (existing.length > 0 || pendingContainers.has(container)) return

  pendingContainers.add(container)
  try {
    await editorLoaded
    const headPath = await resolveHeadPath(container)
    const slot = findAffordanceSlot(container)
    if (!headPath || !slot || container.querySelector(AFFORDANCE_SELECTOR)) return

    const openButton = createOpenAffordance(headPath, editor, {
      onActivate: ({ repair }) => void openInEditor(headPath, headerLines(container).startLine, repair),
    })
    const t3Button = createT3ContextAffordance(headPath, {
      onActivate: () => referenceInT3(container, headPath, null),
    })
    slot.parent.insertBefore(openButton, slot.before)
    slot.parent.insertBefore(t3Button, openButton.nextSibling)
  } finally {
    pendingContainers.delete(container)
  }
}

/** Header icons beside the file path of a review thread on the conversation tab; they open the whole file. */
async function injectThreadAffordance(link: HTMLAnchorElement): Promise<void> {
  if (pendingThreadLinks.has(link)) return

  pendingThreadLinks.add(link)
  try {
    await editorLoaded
    if (!threadFiles.has(link)) threadFiles.set(link, await threadFileOf(link))
    const file = threadFiles.get(link)
    if (!file || file.label.nextElementSibling?.matches(AFFORDANCE_SELECTOR)) return
    const snippet = threadSnippetOf(link)
    if (snippet && fileStatus(snippet) === "deleted") return

    const { path, label } = file
    const openButton = createOpenAffordance(path, editor, {
      onActivate: ({ repair }) => void openInEditor(path, null, repair),
    })
    const t3Button = createT3ContextAffordance(path, {
      onActivate: () => referenceInT3(link, path, null),
    })
    label.after(openButton, t3Button)
  } finally {
    pendingThreadLinks.delete(link)
  }
}

function scan(): void {
  if (!parsePullRequestPage(location.href)) return
  injectBugbotCopyButtons(copyBugbotPrompt)
  if (!parsePullRequestChangesView(location.href)) {
    for (const link of findThreadLinks()) void injectThreadAffordance(link)
    return
  }
  for (const container of findFileContainers()) void injectAffordance(container)
}

let scanQueued = false
function queueScan(): void {
  if (scanQueued) return
  scanQueued = true
  requestAnimationFrame(() => {
    scanQueued = false
    scan()
  })
}

export default defineContentScript({
  matches: ["https://github.com/*"],
  runAt: "document_idle",

  main() {
    editorLoaded = getEditor().then((stored) => (editor = stored))

    // GitHub is a SPA: file diffs load lazily and route changes do not reload the
    // page, so rescan on DOM mutations and navigation events.
    new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true })
    for (const event of ["turbo:load", "turbo:render", "popstate", "soft-nav:end"]) {
      document.addEventListener(event, queueScan)
      window.addEventListener(event, queueScan)
    }
    queueScan()

    // Swap the header icons when the editor preference changes on the options page.
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[EDITOR_STORAGE_KEY]
      if (area !== "local" || !change) return
      editor = isEditor(change.newValue) ? change.newValue : DEFAULT_EDITOR
      document.querySelectorAll(AFFORDANCE_SELECTOR).forEach((button) => button.remove())
      queueScan()
    })

    installSelectionAffordance({
      isActive: () => parsePullRequestPage(location.href) !== null,
      isReferenceable: (container) => fileStatus(container) !== "deleted" && hasCodePath(container),
      onOpen: ({ container, startLine, endLine }) => {
        void resolveCodePath(container).then((headPath) => {
          if (headPath) referenceInT3(container, headPath, { startLine, endLine })
        })
      },
      editor: () => editor,
      onOpenInEditor: ({ container, startLine }, { repair }) => {
        void resolveCodePath(container).then((headPath) => {
          if (headPath) void openInEditor(headPath, startLine, repair)
        })
      },
      onCopy: ({ container, startLine, endLine }) => copyReferencePrompt(container, { startLine, endLine }),
    })
  },
})
