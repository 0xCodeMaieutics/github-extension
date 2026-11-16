# Chat file reference via T3 Code prompt links

On a pull request changes view, the **T3 context affordance** and the **selection affordance** start a **chat file reference**: the user should land in T3 Code with a **reference location** and, when possible, a **reference excerpt** in the composer, ready to add notes and send.

The extension builds the whole prompt itself and opens T3 Code's existing prompt link, `t3code://new?prompt=…&repo=owner/name`. The location is repository-relative; the excerpt is the head-side text of the referenced lines as rendered in GitHub's diff. No **repository mapping** is needed, because nothing in the link points at the local disk.

**Considered:** a dedicated `t3code://reference` route where T3 Code reads the excerpt from the mapped local file and routes to the focused thread (originally chosen; abandoned because T3 Code has no such handler, so the link opened an empty composer). Embedding diff text was rejected under that design to keep one source of truth; with prompt links it is the only source available to the browser.

**Consequences:**
- The excerpt matches what the user saw on GitHub, not necessarily their local checkout.
- When the referenced lines are not all rendered (for example, a range spanning lines collapsed between hunks), or the prompt would exceed T3 Code's 8,000-character link limit, only the location is sent.
- T3 Code, not the extension, picks the chat: the draft opens in the most recently used project for `repo`, not necessarily the focused thread. `pr=` is deliberately omitted because it makes T3 Code check out the pull request branch in a new worktree.
