"""GitHub -> Slack DM notifier for a single user.

Receives GitHub webhooks, verifies their signature, and DMs the configured
Slack user about review requests and feedback on PRs they opened, and about
CI results (all checks green, or the first failure) on those PRs.
Deliveries are deduplicated in SQLite by X-GitHub-Delivery.
"""

import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

log = logging.getLogger("github-slack-dm")

WEBHOOK_PATH = "/webhooks/github"
MAX_BODY_BYTES = 25 * 1024 * 1024  # GitHub caps payloads at 25 MB
EXCERPT_CHARS = 280
DELIVERY_RETENTION_DAYS = 30


# --- Formatting helpers -----------------------------------------------------


def slack_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def excerpt(body):
    """Short single-line excerpt, without HTML comments/tags (Bugbot embeds both)."""
    if not body:
        return ""
    text = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = " ".join(text.split())
    if len(text) > EXCERPT_CHARS:
        text = text[: EXCERPT_CHARS - 1].rstrip() + "…"
    return text


def same_user(a, b):
    return bool(a) and bool(b) and a.lower() == b.lower()


def login(obj):
    return (obj or {}).get("login") or ""


def format_message(actor, verb, url, repo, pr):
    title = slack_escape(f"{repo}#{pr.get('number')}: {pr.get('title', '')}")
    return f"*{slack_escape(actor)}* {verb} <{url}|{title}>"


# --- Event handlers ---------------------------------------------------------
# Each handler returns the Slack message text, or None to skip the event.


def on_pull_request(payload, me):
    if payload.get("action") != "review_requested":
        return None
    # Team review requests carry requested_team instead; only direct requests count.
    if not same_user(login(payload.get("requested_reviewer")), me):
        return None
    actor = login(payload.get("sender"))
    if same_user(actor, me):
        return None
    pr = payload["pull_request"]
    return format_message(
        actor, "requested your review on", pr["html_url"], payload["repository"]["full_name"], pr
    )


REVIEW_VERBS = {
    "approved": "approved",
    "changes_requested": "requested changes on",
    "commented": "reviewed",
    "dismissed": "dismissed a review on",
}


def on_pull_request_review(payload, me):
    if payload.get("action") != "submitted":
        return None
    pr = payload["pull_request"]
    review = payload["review"]
    actor = login(review.get("user")) or login(payload.get("sender"))
    if not same_user(login(pr.get("user")), me) or same_user(actor, me):
        return None
    state = (review.get("state") or "").lower()
    # A "commented" review with no summary is just a container for inline
    # comments (e.g. Cursor Bugbot); those arrive as pull_request_review_comment
    # events and are notified individually.
    if state == "commented" and not excerpt(review.get("body")):
        return None
    verb = REVIEW_VERBS.get(state, "reviewed")
    url = review.get("html_url") or pr["html_url"]
    return format_message(actor, verb, url, payload["repository"]["full_name"], pr)


def on_pull_request_review_comment(payload, me):
    if payload.get("action") != "created":
        return None
    pr = payload["pull_request"]
    comment = payload["comment"]
    actor = login(comment.get("user")) or login(payload.get("sender"))
    if not same_user(login(pr.get("user")), me) or same_user(actor, me):
        return None
    return format_message(
        actor,
        "left an inline comment on",
        comment.get("html_url") or pr["html_url"],
        payload["repository"]["full_name"],
        pr,
    )


def on_issue_comment(payload, me):
    if payload.get("action") != "created":
        return None
    issue = payload["issue"]
    if "pull_request" not in issue:  # plain issue, not a PR
        return None
    comment = payload["comment"]
    actor = login(comment.get("user")) or login(payload.get("sender"))
    if not same_user(login(issue.get("user")), me) or same_user(actor, me):
        return None
    return format_message(
        actor,
        "commented on",
        comment.get("html_url") or issue["html_url"],
        payload["repository"]["full_name"],
        issue,
    )


def on_pull_request_review_thread(payload, me):
    action = payload.get("action")
    if action not in ("resolved", "unresolved"):
        return None
    pr = payload["pull_request"]
    actor = login(payload.get("sender"))
    if not same_user(login(pr.get("user")), me) or same_user(actor, me):
        return None
    comments = (payload.get("thread") or {}).get("comments") or []
    first = comments[0] if comments else {}
    return format_message(
        actor,
        f"{action} a review thread on",
        first.get("html_url") or pr["html_url"],
        payload["repository"]["full_name"],
        pr,
    )


HANDLERS = {
    "pull_request": on_pull_request,
    "pull_request_review": on_pull_request_review,
    "pull_request_review_comment": on_pull_request_review_comment,
    "pull_request_review_thread": on_pull_request_review_thread,
    "issue_comment": on_issue_comment,
}


def build_message(event, payload, me):
    handler = HANDLERS.get(event)
    if handler is None:
        return None
    if same_user(login(payload.get("sender")), me):
        return None
    return handler(payload, me)


# --- CI results -------------------------------------------------------------
# GitHub has no "all checks passed" event, so the bot keeps its own record of
# every check run and commit status per commit, built from the webhooks, and
# looks at the whole set each time one changes. The result is DMed once per
# commit and outcome: the first failure, and all checks green. PR author and
# title come from the pull_request* events, which carry the full PR.

CI_EVENTS = ("check_run", "status")
CHECK_OK = ("success", "neutral", "skipped")


def ci_update(event, payload):
    """(repo, sha, key, name, run id, state, url) for a check change, or None.

    state is "pending", "passed" or "failed".
    """
    repo = payload["repository"]["full_name"]
    if event == "check_run":
        if payload.get("action") not in ("created", "rerequested", "completed"):
            return None
        run = payload["check_run"]
        if run.get("status") != "completed":
            state = "pending"
        elif run.get("conclusion") in CHECK_OK:
            state = "passed"
        else:
            state = "failed"
        app_id = (run.get("app") or {}).get("id") or ""
        name = run.get("name") or "check"
        return (repo, run["head_sha"], f"run:{app_id}:{name}", name, run.get("id") or 0,
                state, run.get("details_url") or run.get("html_url"))
    # status
    state = {"pending": "pending", "success": "passed"}.get(payload.get("state"), "failed")
    context = payload.get("context") or "status"
    # Statuses have no ordering; their ids increase like check run ids.
    return (repo, payload["sha"], f"status:{context}", context, payload.get("id") or 0,
            state, payload.get("target_url"))


def ci_outcome(checks):
    """("failed", [(name, url)]), ("passed", []), or None while checks are still running."""
    failed = [(name, url) for name, state, url in checks if state == "failed"]
    if failed:
        return "failed", failed
    if not checks or any(state == "pending" for _, state, _ in checks):
        return None
    return "passed", []


def format_ci_message(outcome, failed, repo, pr):
    title = slack_escape(f"{repo}#{pr['number']}: {pr['title']}")
    link = f"<{pr['html_url']}/checks|{title}>"
    if outcome == "passed":
        return f":white_check_mark: All checks passed on {link}"
    names = ", ".join(
        f"<{url}|{slack_escape(name)}>" if url else slack_escape(name) for name, url in failed
    )
    return f":x: CI failed on {link}: {names}"


# --- Infrastructure ---------------------------------------------------------


def verify_signature(secret, body, header):
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):])


class DeliveryStore:
    def __init__(self, path):
        if os.path.dirname(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS deliveries ("
            " id TEXT PRIMARY KEY, event TEXT, received_at INTEGER NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS ci_notifications ("
            " key TEXT PRIMARY KEY, notified_at INTEGER NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS pull_requests ("
            " repo TEXT, number INTEGER, head_sha TEXT, author TEXT, title TEXT,"
            " html_url TEXT, open INTEGER, updated_at INTEGER NOT NULL,"
            " PRIMARY KEY (repo, number))"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS checks ("
            " repo TEXT, sha TEXT, key TEXT, name TEXT, run_id INTEGER, state TEXT,"
            " url TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (repo, sha, key))"
        )
        cutoff = int(time.time()) - DELIVERY_RETENTION_DAYS * 86400
        self.db.execute("DELETE FROM deliveries WHERE received_at < ?", (cutoff,))
        self.db.execute("DELETE FROM ci_notifications WHERE notified_at < ?", (cutoff,))
        self.db.execute("DELETE FROM pull_requests WHERE updated_at < ?", (cutoff,))
        self.db.execute("DELETE FROM checks WHERE updated_at < ?", (cutoff,))

    def claim(self, delivery_id, event):
        """Record a delivery; False if it was already processed."""
        try:
            self.db.execute(
                "INSERT INTO deliveries (id, event, received_at) VALUES (?, ?, ?)",
                (delivery_id, event, int(time.time())),
            )
            return True
        except sqlite3.IntegrityError:
            return False

    def release(self, delivery_id):
        """Forget a delivery so a GitHub redelivery can retry it."""
        self.db.execute("DELETE FROM deliveries WHERE id = ?", (delivery_id,))

    def claim_ci(self, key):
        """Record a CI notification (repo, commit, outcome); False if already sent."""
        try:
            self.db.execute(
                "INSERT INTO ci_notifications (key, notified_at) VALUES (?, ?)",
                (key, int(time.time())),
            )
            return True
        except sqlite3.IntegrityError:
            return False

    def release_ci(self, key):
        self.db.execute("DELETE FROM ci_notifications WHERE key = ?", (key,))

    def save_pr(self, repo, pr):
        self.db.execute(
            "INSERT OR REPLACE INTO pull_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (repo, pr["number"], pr["head"]["sha"], login(pr.get("user")), pr.get("title") or "",
             pr["html_url"], int(pr.get("state") == "open"), int(time.time())),
        )

    def open_prs_at(self, repo, sha):
        rows = self.db.execute(
            "SELECT number, author, title, html_url FROM pull_requests"
            " WHERE repo = ? AND head_sha = ? AND open = 1 ORDER BY number",
            (repo, sha),
        )
        return [dict(zip(("number", "author", "title", "html_url"), row)) for row in rows]

    def record_check(self, repo, sha, key, name, run_id, state, url):
        """Store a check's latest state, ignoring deliveries that arrive out of order."""
        row = self.db.execute(
            "SELECT run_id, state FROM checks WHERE repo = ? AND sha = ? AND key = ?",
            (repo, sha, key),
        ).fetchone()
        if row:
            old_id, old_state = row
            # An older run, or a late "created" for a run that already finished.
            if run_id < old_id or (run_id == old_id and state == "pending" and old_state != "pending"):
                return
        self.db.execute(
            "INSERT OR REPLACE INTO checks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (repo, sha, key, name, run_id, state, url, int(time.time())),
        )

    def checks_at(self, repo, sha):
        return self.db.execute(
            "SELECT name, state, url FROM checks WHERE repo = ? AND sha = ? ORDER BY name",
            (repo, sha),
        ).fetchall()


class SlackError(Exception):
    pass


def send_slack_dm(token, user_id, text):
    # Posting to a user ID delivers to the DM between that user and the bot.
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=json.dumps(
            {"channel": user_id, "text": text, "unfurl_links": False, "unfurl_media": False}
        ).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            result = json.load(resp)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise SlackError(str(exc)) from exc
    if not result.get("ok"):
        raise SlackError(result.get("error", "unknown_error"))


class App:
    def __init__(self, webhook_secret, github_username, slack_token, slack_user_id, store,
                 send=send_slack_dm):
        self.webhook_secret = webhook_secret
        self.github_username = github_username
        self.slack_token = slack_token
        self.slack_user_id = slack_user_id
        self.store = store
        self.send = send

    def handle_webhook(self, headers, body):
        """Returns (status, response text)."""
        if not verify_signature(self.webhook_secret, body, headers.get("X-Hub-Signature-256")):
            return 401, "invalid signature"
        event = headers.get("X-GitHub-Event") or ""
        delivery = headers.get("X-GitHub-Delivery") or ""
        if not delivery:
            return 400, "missing X-GitHub-Delivery"
        if event == "ping":
            return 200, "pong"
        try:
            payload = json.loads(body)
        except ValueError:
            return 400, "body must be JSON (set content type to application/json)"

        ci_key = None
        try:
            pr = payload.get("pull_request")
            if isinstance(pr, dict) and "head" in pr:
                self.store.save_pr(payload["repository"]["full_name"], pr)
            if event in CI_EVENTS:
                message, ci_key = self.ci_message(event, payload)
            elif event == "pull_request" and payload.get("action") in ("opened", "reopened"):
                # CI on a pushed branch can finish before its PR is opened.
                message, ci_key = self.ci_result(payload["repository"]["full_name"],
                                                 pr["head"]["sha"])
            else:
                message = build_message(event, payload, self.github_username)
        except (KeyError, TypeError, AttributeError):
            log.exception("delivery=%s event=%s: unexpected payload shape", delivery, event)
            return 400, "unexpected payload"

        if not self.store.claim(delivery, event):
            log.info("delivery=%s event=%s: duplicate, skipped", delivery, event)
            return 200, "duplicate"
        if message is None:
            log.info("delivery=%s event=%s action=%s: ignored",
                     delivery, event, payload.get("action"))
            return 200, "ignored"
        if ci_key and not self.store.claim_ci(ci_key):
            log.info("delivery=%s event=%s: %s already notified", delivery, event, ci_key)
            return 200, "already notified"
        try:
            self.send(self.slack_token, self.slack_user_id, message)
        except SlackError as exc:
            self.store.release(delivery)
            if ci_key:
                self.store.release_ci(ci_key)
            log.error("delivery=%s event=%s: Slack send failed: %s", delivery, event, exc)
            return 502, "slack send failed"
        log.info("delivery=%s event=%s: notified", delivery, event)
        return 200, "notified"

    def ci_message(self, event, payload):
        """(message, dedupe key) for a CI result on one of my open PRs, or (None, None).

        Unlike the other events, the sender doesn't matter: a check run on your
        own push is exactly what you want to hear about.
        """
        update = ci_update(event, payload)
        if update is None:
            return None, None
        self.store.record_check(*update)
        return self.ci_result(update[0], update[1])

    def ci_result(self, repo, sha):
        pr = next(
            (p for p in self.store.open_prs_at(repo, sha)
             if same_user(p["author"], self.github_username)),
            None,
        )
        if pr is None:
            return None, None
        result = ci_outcome(self.store.checks_at(repo, sha))
        if result is None:
            return None, None
        outcome, failed = result
        return format_ci_message(outcome, failed, repo, pr), f"{repo}@{sha}:{outcome}"


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "github-slack-dm"
        timeout = 10  # per-connection socket timeout so a slow client cannot stall the server

        def _reply(self, status, text):
            data = (text + "\n").encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/healthz":
                self._reply(200, "ok")
            else:
                self._reply(404, "not found")

        def do_POST(self):
            if self.path.split("?", 1)[0] != WEBHOOK_PATH:
                return self._reply(404, "not found")
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                return self._reply(411, "length required")
            if length < 0 or length > MAX_BODY_BYTES:
                return self._reply(413, "payload too large")
            body = self.rfile.read(length)
            self._reply(*app.handle_webhook(self.headers, body))

        def log_message(self, fmt, *args):
            log.debug("%s %s", self.address_string(), fmt % args)

    return Handler


def require_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"missing required environment variable {name}")
    return value


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    app = App(
        webhook_secret=require_env("GITHUB_WEBHOOK_SECRET"),
        github_username=require_env("GITHUB_USERNAME"),
        slack_token=require_env("SLACK_BOT_TOKEN"),
        slack_user_id=require_env("SLACK_USER_ID"),
        store=DeliveryStore(os.environ.get("DB_PATH", "/data/deliveries.sqlite3")),
    )
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8083"))
    # Single-threaded on purpose: one user's webhook volume is tiny, and it
    # keeps the SQLite claim/send/release sequence free of races.
    server = HTTPServer((host, port), make_handler(app))
    log.info("listening on %s:%d%s for GitHub user %s", host, port, WEBHOOK_PATH, app.github_username)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
