# Local open without changing git checkout

On a pull request changes view, users expect a fast jump from a GitHub file row to the same path in desktop VS Code. We deliberately **do not** check out the PR head branch (or any branch) as part of that action.

A browser extension cannot reliably run `git` against the user’s disk from a content script alone, and silently switching branches would surprise people who are mid-edit on another branch. **Local open** is therefore **navigation only**: mapped repository root + repository-relative path + optional diff anchor line, using whatever checkout is already present.

**Considered:** auto-checkout to PR head (rejected for v1 — needs a native companion and risky UX); soft warnings when branch differs (deferred).

**Consequences:** Opened file content may not match the PR diff until the user checks out the right branch themselves. Document this in user-facing help if confusion appears in testing.
