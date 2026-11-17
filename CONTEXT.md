# Github Extension

A Chromium browser extension for working on GitHub.com pull requests. It has two features, each with its own tab on the options page:

- **File opener**: jump from a pull request's changed files into the same file on disk, in a desktop editor or in T3 Code chat.
- **Slack**: ask Reviewers on Slack to review a pull request, straight from its PR Page.

## File opener

Scope: **GitHub.com** pull requests only (not GitHub Enterprise Server or other hosts). **Chromium-based** browsers (Chrome, Edge, Brave, etc.) for v1.

### Language

**Open target**:
The desktop editor chosen on the options page, Visual Studio Code (default) or Zed, opened through its `vscode://file` or `zed://file` URL handler (not vscode.dev or other in-browser editors). The **open affordance** and the selection affordance's open icon show the chosen editor's icon.
_Avoid_: Web editor, github.dev, Codespaces (unless we explicitly add them later)

**Pull request changes view**:
GitHub’s per-file diff experience for a pull request (the “Files changed” tab), regardless of whether the URL path is `/files`, `/changes`, or equivalent routing.
_Avoid_: Conversation tab, commit view, blame view, compare view without a PR

**Repository mapping**:
A user-maintained association between a GitHub.com repository identity (`owner/name`) and the absolute path of that repository’s root on disk. Used by **local open**; a **chat file reference** does not need one. The user is trusted to supply a correct path; the extension does not validate against `git remote` in v1.
_Avoid_: Auto-discovery, guessed paths, workspace guess, server-side clone detection

**Mapping prompt**:
An in-page flow triggered when the user activates an affordance for a repository that has no mapping yet; the user types an absolute filesystem path to the repository root, the extension persists the repository mapping, then continues the pending **local open**.
_Avoid_: Silent failure, options-only setup (as the only path), in-page folder picker (not available on v1)

**Mapping repair**:
Updating an existing repository mapping when the stored local root is missing or invalid, using the same in-page prompt flow as the initial mapping prompt, then continuing the open.
_Avoid_: Permanent error state, forced trip to options only

**Local open**:
Opening a repository-relative file path inside the mapped local root, without changing git branch or checkout state.
_Avoid_: Auto-checkout, sync to PR head, branch switch

**Diff anchor**:
The line number in a changed file that corresponds to the first meaningful change shown in that file’s diff on the pull request changes view; a local open uses this as the editor cursor position when available.
_Avoid_: Random line, always line 1, base-branch line (for v1)

**Line selection**:
The lines a user selected in a file's diff, carried in the URL hash as `#diff-<sha256(path)>R<start>-R<end>`. When the selection belongs to the file being opened and includes head-side (`R`) lines, the local open places the cursor on its first head-side line instead of the diff anchor. Base-only (`L`) selections are ignored.
_Avoid_: Highlighting the range in VS Code (the `vscode://file` handler only accepts a line and column)

**Code selection**:
A mouse text selection inside one openable file's diff on the pull request changes view, reduced to the inclusive range from its first to last head-side line. A selection with no head-side lines, or one that crosses into another file's diff, is not a code selection.
_Avoid_: Line selection (the URL-hash range), base-side (`L`) lines, selections outside the changes view

**Selection affordance**:
A T3 Code icon shown beside a code selection; activating it starts a chat file reference for that range. A copy button beside it puts the same prompt on the clipboard instead, and a VS Code icon before it starts a local open at the selection's first head-side line. It coexists with the header-row **T3 context affordance** and **open affordance**.
_Avoid_: Replacing the T3 context affordance, showing the icon for base-only or cross-file selections

**Bugbot copy affordance**:
A "Copy for AI" button after the "Fix in Cursor" / "Fix in Web" links of each Cursor Bugbot issue comment, on any pull request tab. It copies the same shape of prompt Bugbot's "Fix in Cursor" opens: `Verify this issue exists and fix it:`, the issue description, then `Affected files: path:start-end, …`. Description and locations come from the comment's raw markdown (GitHub's "Copy Markdown" value); without it the rendered body is used and the affected file falls back to the commented line.
_Avoid_: Bugbot's review summary comment, the title or severity line in the prompt, code excerpts (the agent reads the files itself)

**Openable file**:
A file entry on the pull request changes view that represents a path present on the pull request head (added or modified), eligible for **local open**, **chat file reference**, and diff anchor.
_Avoid_: Deleted-only files, base-only paths, binary-only rows without a meaningful head path

**Anchor fallback**:
When no diff anchor can be determined for an otherwise openable file, the local open uses the start of the file (line 1) as the cursor position.
_Avoid_: Hiding the icon, blocking the open, using a guessed line

**Open affordance**:
A VS Code icon in each openable file’s header row on the pull request changes view; activating it starts a local open (or mapping prompt / mapping repair when needed).
_Avoid_: Per-hunk buttons, icons on deleted-only rows, icons outside the file diff list

**T3 context affordance**:
A T3 Code icon beside the open affordance on each openable file’s header row; activating it starts a chat file reference for the whole file: the path alone, with no line position and no excerpt.
_Avoid_: Per-hunk buttons, icons on deleted-only rows, a single icon that mixes VS Code and T3 actions, line suffixes from the line selection or diff anchor

**Chat file reference**:
Placing a line naming the pull request (`PR #72: <url>`), a **reference location** and, when lines are in scope, a **reference excerpt** into a T3 Code draft for the pull request's repository, so the user can add notes and discuss that code in chat. T3 Code decides which project and chat receive the draft.
_Avoid_: Local open, auto-sending a message, opening the file in an external editor as the primary outcome

**Reference location**:
A repository-relative path to the pull request head file, with optional position: a single head-side line (`path:line`) or an inclusive range (`path:start~end`) derived from **code selection**. A **T3 context affordance** reference is the bare path.
_Avoid_: Absolute paths in the user-visible reference, base-side (`L`) line numbers, column suffixes in v1

**Reference excerpt**:
The head-side text of the lines at **reference location**, as rendered in the pull request diff, formatted as a fenced code block immediately below the location line in the chat composer (for example `src/foo.ts:19~26` followed by the snippet). A single-line reference uses the same shape with one line in the fence.
_Avoid_: Reading from the local checkout, partial excerpts with missing lines, diff markup (`+`/`-`) inside the excerpt, excerpts for deleted-only content

**Excerpt fallback**:
When not every line of the **reference location** is rendered in the diff (for example, lines collapsed between hunks), or the prompt would be too long for a T3 Code prompt link, the composer receives the location line without a fenced block.
_Avoid_: Blocking the whole **chat file reference**, partial excerpts, placeholder code

## Slack

### Language

**PR Page**:
A GitHub pull request page on github.com (`github.com/<owner>/<repo>/pull/<number>`).
_Avoid_: PR view, PR screen

**Request Review Button**:
The Slack-branded button the extension adds to a PR Page whose pull request is open (including drafts), regardless of who authored it.
_Avoid_: Slack button, share button

**Review Request**:
A Slack message asking one or more Reviewers to review a specific pull request. It lives only in Slack and is independent of GitHub's own requested reviewers.
_Avoid_: Ping, notification, share

**Reviewer**:
A Slack workspace member who is asked to review the pull request.
_Avoid_: Colleague, teammate

**Destination**:
Where a Review Request is delivered: either a Slack channel (with Reviewers mentioned) or a separate one-to-one direct message to each Reviewer. Chosen each time a Review Request is sent.
_Avoid_: Target, recipient

**Default Channel**:
The Slack channel the user sets in the extension's settings to be preselected as the Destination. Review Requests themselves are never remembered.
_Avoid_: Last channel, recent channel

**Developers**:
The Slack workspace members the user sets in the extension's settings as the options offered on every Review Request. None is preselected: the user clicks the Developers who should be Reviewers each time, and only Developers can be picked.
_Avoid_: Default reviewers, saved reviewers, favourite reviewers
