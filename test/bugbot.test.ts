import { beforeEach, describe, expect, it } from "vitest"
import { injectBugbotCopyButtons } from "../entrypoints/file-opener.content/bugbot-affordance"
import {
  findBugbotBodies,
  formatBugbotPrompt,
  parseBugbotMarkdown,
  readBugbotIssue,
  threadLocationOf,
} from "../lib/file-opener/bugbot"
import { classicFile, diffId } from "./fixtures"

const DESCRIPTION =
  "`allow-set-title` is a tmux 3.5+ pane option, and a failed `set-option` aborts the spawn."

const MARKDOWN = `### Title setup requires tmux 3.5

**Medium Severity**

<!-- DESCRIPTION START -->
${DESCRIPTION}
<!-- DESCRIPTION END -->

<!-- BUGBOT_BUG_ID: f1d456fe-cf17-4f21-bbdd-a3bda40b4774 -->

<!-- LOCATIONS START
bin/fm-spawn.sh#L6145-L6150
LOCATIONS END -->
<div><a href="https://cursor.com/open?link=x"><picture><img alt="Fix in Cursor"></picture></a>&nbsp;<a href="https://cursor.com/agents?link=y"><picture><img alt="Fix in Web"></picture></a></div>


<sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit fa5e8f7d5a5811a5ca0dc27de2e63b4627535d55. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
`

/** happy-dom does not decode `&lt;` in attribute values, so only `&` and `"` are escaped. */
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

/** Rendered body as GitHub shows it: HTML comments, and with them the locations, are stripped. */
const RENDERED_BODY = `
  <h3 dir="auto">Title setup requires tmux 3.5</h3>
  <p dir="auto"><strong>Medium Severity</strong></p>
  <p dir="auto"><code class="notranslate">allow-set-title</code> is a tmux 3.5+ pane option, and a failed <code class="notranslate">set-option</code> aborts the spawn.</p>
  <div dir="auto"><a href="https://cursor.com/open?link=x"><themed-picture><picture><img alt="Fix in Cursor"></picture></themed-picture></a>&nbsp;<a href="https://cursor.com/agents?link=y"><themed-picture><picture><img alt="Fix in Web"></picture></themed-picture></a></div>
  <p dir="auto"><sup>Reviewed by <a href="https://cursor.com/bugbot">Cursor Bugbot</a> for commit <a class="commit-link" href="https://github.com/pearson-tfl/firstmate/commit/fa5e8f7d5a5811a5ca0dc27de2e63b4627535d55"><tt>fa5e8f7</tt></a>.</sup></p>`

function reviewComment(options: { id: string; markdown?: string }): string {
  const copy = options.markdown
    ? `<details-menu><clipboard-copy data-dd-action-name="comment.copy_markdown" value="${escapeAttribute(options.markdown)}">Copy Markdown</clipboard-copy></details-menu>`
    : ""
  return `
    <div id="${options.id}" class="timeline-comment-group js-comment review-comment">
      <div class="timeline-comment-header">${copy}</div>
      <div class="edit-comment-hide"><task-lists>
        <div class="comment-body markdown-body js-comment-body">${RENDERED_BODY}</div>
      </task-lists></div>
    </div>`
}

function additionRow(line: number): string {
  return `<tr><td class="blob-num blob-num-addition empty-cell"></td><td data-line-number="${line}" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner blob-code-marker-addition">line ${line}</span></td></tr>`
}

/** Conversation tab: thread header links the file, a snippet ends at the commented line, then the comments. */
function conversationThread(lines: number[]): string {
  return `
    <review-thread-collapsible class="review-thread-component js-resolvable-timeline-thread-container">
      <div><span><a href="/pearson-tfl/firstmate/pull/18/files/fa5e8f7#${diffId("bin/fm-spawn.sh")}">bin/fm-spawn.sh</a></span></div>
      <div>
        <div class="blob-wrapper"><deferred-diff-lines><table class="diff-table"><tbody>
          ${lines.map(additionRow).join("")}
        </tbody></table></deferred-diff-lines></div>
        <div class="js-inline-comments-container"><div class="js-comments-holder">
          ${reviewComment({ id: "discussion_r4491377677" })}
        </div></div>
      </div>
    </review-thread-collapsible>`
}

const body = () => findBugbotBodies()[0]!

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("parseBugbotMarkdown", () => {
  it("reads the description and locations", () => {
    expect(parseBugbotMarkdown(MARKDOWN)).toEqual({
      description: DESCRIPTION,
      locations: [{ path: "bin/fm-spawn.sh", range: { startLine: 6145, endLine: 6150 } }],
    })
  })

  it("reads single-line and line-less locations", () => {
    const markdown = MARKDOWN.replace("bin/fm-spawn.sh#L6145-L6150", "src/a.ts#L12\nsrc/b.ts#L3-L4\nREADME.md")
    expect(parseBugbotMarkdown(markdown)?.locations).toEqual([
      { path: "src/a.ts", range: { startLine: 12, endLine: 12 } },
      { path: "src/b.ts", range: { startLine: 3, endLine: 4 } },
      { path: "README.md", range: null },
    ])
  })

  it("rejects markdown without a description block", () => {
    expect(parseBugbotMarkdown("### Just a heading\n\nSome text")).toBeNull()
  })
})

describe("findBugbotBodies", () => {
  it("finds issue comments but not the review summary", () => {
    document.body.innerHTML = `
      ${reviewComment({ id: "discussion_r1" })}
      <div class="markdown-body"><p>Bugbot found 1 issue.</p><a><img alt="Fix All in Cursor"></a></div>`
    expect(findBugbotBodies()).toHaveLength(1)
  })
})

describe("readBugbotIssue", () => {
  it("prefers the raw markdown from the Copy Markdown menu item", () => {
    document.body.innerHTML = reviewComment({ id: "discussion_r1", markdown: MARKDOWN })
    expect(readBugbotIssue(body())?.locations).toHaveLength(1)
  })

  it("falls back to the rendered body without the title and severity", () => {
    document.body.innerHTML = reviewComment({ id: "discussion_r1" })
    expect(readBugbotIssue(body())).toEqual({ description: DESCRIPTION, locations: [] })
  })

  it("ignores another comment's markdown in the same review", () => {
    document.body.innerHTML = `
      <div class="timeline-comment-group js-comment">
        <clipboard-copy data-dd-action-name="comment.copy_markdown" value="<!-- DESCRIPTION START -->Other<!-- DESCRIPTION END -->"></clipboard-copy>
        ${reviewComment({ id: "discussion_r1" })}
      </div>`
    expect(readBugbotIssue(body())?.description).toBe(DESCRIPTION)
  })
})

describe("threadLocationOf", () => {
  it("uses the conversation thread's file and last snippet line", async () => {
    document.body.innerHTML = conversationThread([6147, 6148, 6149, 6150])
    expect(await threadLocationOf(body())).toEqual({
      path: "bin/fm-spawn.sh",
      range: { startLine: 6150, endLine: 6150 },
    })
  })

  it("uses the diff row the comment hangs under on the changes view", async () => {
    document.body.innerHTML = classicFile({
      path: "a.ts",
      rows: [{ hunk: "@@ -1,1 +1,3 @@" }, { context: [1, 1] }, { add: 2 }, { add: 3 }],
    })
    const row = document.createElement("tr")
    row.className = "inline-comments"
    row.insertCell().innerHTML = reviewComment({ id: "r1" })
    document.querySelector(`#${diffId("a.ts")} tbody`)!.append(row)
    expect(await threadLocationOf(body())).toEqual({ path: "a.ts", range: { startLine: 3, endLine: 3 } })
  })
})

describe("formatBugbotPrompt", () => {
  it("asks to verify and fix the issue, then lists the affected files", () => {
    expect(
      formatBugbotPrompt({
        description: DESCRIPTION,
        locations: [
          { path: "bin/fm-spawn.sh", range: { startLine: 6145, endLine: 6150 } },
          { path: "src/a.ts", range: { startLine: 12, endLine: 12 } },
          { path: "README.md", range: null },
        ],
      }),
    ).toBe(
      [
        "Verify this issue exists and fix it:",
        "",
        DESCRIPTION,
        "",
        "Affected files: bin/fm-spawn.sh:6145-6150, src/a.ts:12, README.md",
      ].join("\n"),
    )
  })

  it("omits the affected files line when no location is known", () => {
    expect(formatBugbotPrompt({ description: DESCRIPTION, locations: [] })).toBe(
      `Verify this issue exists and fix it:\n\n${DESCRIPTION}`,
    )
  })
})

describe("injectBugbotCopyButtons", () => {
  it("adds one button after the Fix in Web link", () => {
    document.body.innerHTML = reviewComment({ id: "r1" })
    injectBugbotCopyButtons(async () => true)
    injectBugbotCopyButtons(async () => true)
    const buttons = document.querySelectorAll("[data-gvfo-bugbot-copy]")
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.previousElementSibling?.querySelector("img")?.alt).toBe("Fix in Web")
  })
})
