# Handoff: GitHub PR → VS Code & T3 Code (Chromium extension)

> Written for the standalone `github-vscode-file-opener-extension`. Paths and build notes below describe that layout: `src/lib/` now lives in `lib/file-opener/`, `src/content*` in `entrypoints/file-opener.content/`, and WXT replaces the Vite + esbuild build.

This document captures product decisions from grill-with-docs sessions and implementation pointers for the next builder. Domain language lives in [CONTEXT.md](../CONTEXT.md). ADRs: [local open without checkout](./adr/0001-local-open-without-checkout.md), [chat file reference handoff](./adr/0002-chat-file-reference-handoff.md).

**Workspace state:** MV3 extension implemented for VS Code **local open** and T3 **chat file reference** (header **T3 context affordance** + **selection affordance**). T3 uses T3 Code's existing prompt link (`t3code://new?prompt=…&repo=…`); see [ADR 0002](./adr/0002-chat-file-reference-handoff.md).

---

## Problem statement

Developers review pull requests on GitHub.com and want to continue in **desktop Visual Studio Code** or **T3 Code chat** without manually hunting paths in a local clone.

## Target user flow (v1)

1. User opens a **pull request changes view** on **github.com** (Files changed tab — URL may be `/pull/<n>/files`, `/pull/<n>/changes`, or equivalent).
2. The extension injects a **VS Code icon** (**open affordance**) in each **openable file** header row (sticky file title area, not per diff hunk).
3. User clicks the icon.
4. Extension resolves `owner/name` from the page, looks up **repository mapping** (`owner/name` → absolute local repository root).
5. If mapping is missing or stored path is invalid → **mapping prompt** or **mapping repair**: user **types an absolute path**, mapping is saved, flow continues.
6. Extension computes **diff anchor** (first meaningful change line in that file’s PR diff) or **anchor fallback** (line 1) when parsing fails (binary, permission-only, etc.).
7. Extension triggers **local open** in desktop VS Code: file at `localRoot + repo-relative path` at the chosen line. **No git checkout** or branch sync (see ADR).

**Not shown / not opened:** deleted-only file rows (no affordances). Renames: treat the **new** head path as a normal openable file.

## Target user flow — T3 chat file reference

1. Same **pull request changes view** and **openable file** rows as VS Code.
2. Two T3 entry points, both building the same prompt:
   - **T3 context affordance** (header row, beside the VS Code icon): **line selection** range for that file, else **diff anchor** / **anchor fallback**.
   - **Selection affordance** (floating icon after a **code selection**): first→last head-side line of the selection, including lines collapsed between hunks. No icon for base-only or cross-file selections; appears on mouseup (or ~250 ms after a Shift+arrow selection), hides on selection change or Escape. A copy button next to it copies the same prompt to the clipboard (checkmark for ~1 s).
3. The extension builds the prompt: a `PR #<n>: <url>` line, then the repo-relative **reference location** (`path:line` or `path:start~end`) plus a fenced **reference excerpt** read from the rendered diff's head-side text.
4. **Excerpt fallback**: when any line in the range is not rendered, or the prompt would exceed 8,000 characters, only the location line is sent.
5. Opens `t3code://new?prompt=<encoded>&repo=owner/name`. T3 Code opens a draft in the most recently used project for that repo; the user adds notes and presses Send.

No **repository mapping**, mapping prompt, or ⌥/Alt-click repair on T3 icons; `pr=` is omitted because it triggers a worktree checkout of the PR branch.

---

## Decisions log (grill-with-docs)

| # | Topic | Decision |
|---|--------|----------|
| 1 | Open target | Desktop VS Code (not vscode.dev / web editors) |
| 2 | Local repo resolution | **A** User-configured **repository mapping** per `owner/name` |
| 3 | Git state on open | **A** Path only — **local open** does not change branch/checkout |
| 4 | Cursor position | **B** **Diff anchor** = first meaningful change in that file’s diff |
| 5 | Unmapped repo | **B** In-page **mapping prompt**, then open |
| 6 | Deleted files | **A** No icon / no open for deleted-only entries |
| 7 | GitHub host | **A** **github.com** only (no GHE in v1) |
| 8 | Stale mapping path | **A** **Mapping repair** (same prompt flow as initial mapping) |
| 9 | Unparseable diff line | **A** **Anchor fallback** to line 1, still show icon |
| 10 | Browser | **A** Chromium MV3 (Chrome, Edge, Brave, …) |
| 11 | URL scope | **A** Any PR **pull request changes view**, not only `/changes` |
| 12 | Mapping validation | **A** Trust typed path; no `git remote` verification in v1 |
| 13 | Icon placement | **A** File header row only |
| 14 | Mapping input | **A** Typed absolute path in prompt (no in-page folder picker) |
| 15 | T3 outcome | **Chat file reference** (not local open in an editor) |
| 16 | T3 integration | **A** Dedicated `reference` deep link; T3 owns routing + excerpt |
| 17 | Line params | Range when **line selection** applies; else single line from anchor/fallback |
| 18 | Excerpt source | **A** T3 reads mapped local file (extension sends path + lines only) |
| 19 | Composer shape | `path:line` or `path:start~end` + fenced excerpt (single-line uses one line in fence) |
| 20 | Mapping | **Shared** repository mapping for VS Code and T3 affordances |
| 21 | Read failure | **Excerpt fallback** (location + toast; no silent failure) |
| 22 | T3 affordance UX | **Parity** with open affordance (placement, prompt/repair, ⌥/Alt-click) |
| 23 | Release | **Lockstep** — no store-visible T3 icon until T3 handler ships |
| 24 | PR context on link | **Yes** — include `pr=owner/name/number` from the page |
| 25 | Route slug | **`reference`** on `t3code://` and `app.t3.codes` |
| 26 | Selection surface | **A** **Code selection** only inside the pull request changes view diff |
| 27 | Base-side lines in selection | **A** Keep head-side lines only (first→last); no icon for base-only selections |
| 28 | Cross-file selection | **B** No icon; user re-selects within one file |
| 29 | Affordance coexistence | **A** **Selection affordance** coexists with the header-row **T3 context affordance**; same mapping prompt/repair and ⌥/Alt-click |
| 30 | Selection icon lifecycle | **A** Appears on mouseup just past the end of the selection's last line; hides when the selection collapses/changes or on Escape; stays anchored while scrolling. Keyboard selections (Shift+arrows) also show it after a short debounce (assumed, confirm) |
| 31 | Selection excerpt source | **A** Unchanged from #18: T3 reads whole lines from disk; same `reference` deep link, no selected text in the URL; **excerpt fallback** on read failure. Content-hash mismatch warning deferred |
| 32 | Selection across hunks | **A** One continuous range first→last head-side line, including lines collapsed between hunks |
| 33 | T3 link (after testing: no `reference` handler in T3 Code) | **A** Use existing `t3code://new?prompt=…&repo=…`; extension builds location + excerpt from diff text; no mapping for T3; omit `pr=`. **Supersedes** #16, #18, #20–25, and the mapping parts of #29 and #31 |

### Explicitly out of v1

- GitHub Enterprise Server / custom hosts  
- Firefox / non-Chromium browsers  
- vscode.dev, Codespaces, in-browser editors  
- Auto-discovery of clone paths  
- PR head branch checkout or “sync to PR”  
- Icons on deleted-only or per-hunk controls  
- `git remote` validation (optional native helper later)  
- Cursor IDE as a separate product target (may still open if OS registers `vscode://`; product language stays VS Code)
- T3 icon before T3 `reference` handler is in a released desktop build

---

## Glossary

See [CONTEXT.md](../CONTEXT.md) for canonical terms, including **T3 context affordance**, **Chat file reference**, **Reference location**, **Reference excerpt**, **Active thread routing**, and **Excerpt fallback**.

---

## T3 prompt link (extension → desktop)

Uses T3 Code's existing [prompt links](https://github.com/pingdotgg/t3code/blob/main/docs/user/prompt-links.md):

```text
t3code://new?prompt=<encodeURIComponent(prompt)>&repo=owner/name
```

Prompt shape:

````text
PR #123: https://github.com/owner/name/pull/123
src/foo.ts:19~26
```ts
<head-side lines 19–26>
```
````

Implemented in `src/lib/reference.ts` (`readHeadLines`, `formatReferencePrompt`, `buildT3PromptUrl`) and `src/lib/selection.ts` (`toCodeSelection`).

---

## Reference project (tools + configs to mirror)

**Path:** `/Users/gioshara/development/projects/international-recruitement-gmbh/lazari-ways-apps-new/apps/sales-extension`

Use this as a **template for extension tooling**, not product behavior (sales-extension targets different hosts and features).

### Stack pattern

| Piece | sales-extension approach | Suggested for GitHub→VS Code |
|--------|---------------------------|------------------------------|
| Manifest | MV3 `manifest.json` at app root | MV3; narrow `content_scripts.matches` to `https://github.com/*/pull/*` (and refine in code for changes view) |
| UI shell | Vite + React 19 + `index.html` → side panel | Optional: minimal **options** page only; PR UI is injected in content script |
| Content script | `src/content.ts` — isolated from Vite bundle | Same split: DOM injection + messaging on GitHub |
| Content build | `postbuild`: **esbuild** bundles `src/content.ts` → `build/content.js` | Reuse pattern — content scripts should not depend on Vite chunk graph |
| App build | Vite `outDir: build` for panel HTML/JS | Same if you have options/side panel |
| Types | `chrome-types` devDependency | Same |
| CSS | Tailwind 4 + `@tailwindcss/vite` | Optional; keep injected icons lightweight (SVG + shadow DOM or small CSS) |
| Package manager | `pnpm` in monorepo (`workspace:*` for `@workspace/ui`) | Standalone scratch can use plain `pnpm` without monorepo packages unless you merge into lazari-ways |
| Scripts | `dev` / `build` / `postbuild` / `preview` | Same lifecycle; load unpacked from **`build/`** after `pnpm build` |

### Key files to read in sales-extension

```
apps/sales-extension/
├── manifest.json          # MV3 permissions, content_scripts entry
├── package.json           # vite + esbuild postbuild
├── vite.config.ts         # outDir: build, tailwind plugin
├── tsconfig.json          # strict TS for app
├── tsconfig.content.json  # optional split for content-only TS
├── scripts/post-build.js  # copy manifest, esbuild content.ts → build/content.js
├── index.html             # extension page entry (side panel there)
└── src/
    ├── content.ts         # content script (message listeners, DOM)
    ├── main.tsx / app.tsx # React UI for extension page
    └── declarations.d.ts
```

### manifest.json patterns from sales-extension

- Permissions used: `storage`, `scripting`, `activeTab`, `sidePanel`  
- For this project you will need at least: **`storage`** (repository mappings), **`scripting`** or static `content_scripts` for github.com PR pages. Side panel is **not** required unless you add a management UI there.  
- sales-extension uses `<all_urls>` for content — **do not copy that**; scope to GitHub PR file views.

### post-build.js pattern (important)

Vite builds the extension page; **content script is bundled separately** with esbuild so `manifest.json` can reference a single `content.js` in `build/`. Copy `manifest.json` into `build/` after build.

---

## Implementation notes (non-glossary)

These are build-time hints, not domain terms.

### Opening VS Code from the extension

- Typical protocol: `vscode://file/{absolutePath}:{line}:{column}` (normalize Windows paths to forward slashes where required).  
- Construct absolute path as `join(localRoot, repoRelativePath)` with consistent handling of leading slashes on GitHub paths.  
- Trigger via navigation (`window.location` / anchor click) or `chrome.tabs.create` from background if needed to satisfy browser security rules.  
- Test with VS Code installed and URL handler registered.

### GitHub DOM and SPA

- GitHub is a SPA: use a **MutationObserver** or GitHub’s navigation events to re-run injection when the file list changes (filter changes, lazy-loaded diffs).  
- Anchor parsing: read line numbers from the diff table for that file’s hunks; first added/changed line on the **head** side; fall back per **anchor fallback**.  
- Repo identity: parse `owner/name` from `github.com` URL on the PR page (fork PRs still use base repo path in the URL — mapping key is what appears in the address bar).  
- Detect **openable file** vs deleted-only from file header metadata / labels GitHub shows.

### Storage schema (suggested)

```ts
// chrome.storage.local
type RepositoryMappings = Record<`${owner}/${name}`, absolutePathString>
```

### Mapping prompt UI

- In-page modal on github.com (content script or shadow root) to avoid conflicting with GitHub styles.  
- Fields: absolute path text input, Save & Open, Cancel.  
- On success, persist mapping and immediately perform the pending **local open**.

### Permissions / security

- Minimal host permissions: `https://github.com/*`  
- No broad `<all_urls>`  
- Mappings are local-only; no telemetry assumed in v1.

### Testing checklist

- [ ] PR with `/files` and `/changes` URLs  
- [ ] Added file, modified file, renamed file (new path)  
- [ ] Deleted-only file (no icon)  
- [ ] Binary / unparseable diff (icon + line 1)  
- [ ] First visit mapping prompt → second visit instant open  
- [ ] Invalid stored path → mapping repair  
- [ ] Wrong branch locally (content mismatch) — expected per ADR  
- [ ] T3 icon → composer shows `path:start~end` + code for a selection, `path:line` for anchor-only  
- [ ] T3: excerpt present vs **excerpt fallback** (range across collapsed hunk gap)  
- [ ] Code selection: added-only, mixed red/green (head lines only), base-only (no icon), cross-file (no icon), across hunks (continuous range), split view, mid-line start/end (whole lines)  
- [ ] Selection icon hides on collapse, new selection, Escape  

---

## Suggested next steps

1. Manual QA on a real PR in the React `/changes` UI: confirm excerpt text (no `+`/`-` markers) in unified and split views.
2. Replace the placeholder "T3" badge with the real T3 Code logo.
3. Optional later: a T3 Code `reference` route that targets the focused thread and reads the excerpt from disk.

---

## Session metadata

- **Grill-with-docs** (VS Code v1): 2026-10-17.  
- **Grill-with-docs** (T3 chat file reference): 2026-10-20.  
- **Product name (working):** GitHub → local tools browser extension (see CONTEXT.md title).
