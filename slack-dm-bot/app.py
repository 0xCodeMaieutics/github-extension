"""GitHub -> Slack DM notifier for a single user.

Receives GitHub webhooks, verifies their signature, and DMs the configured
Slack user about review requests and feedback on PRs they opened.
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
        cutoff = int(time.time()) - DELIVERY_RETENTION_DAYS * 86400
        self.db.execute("DELETE FROM deliveries WHERE received_at < ?", (cutoff,))

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

        try:
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
        try:
            self.send(self.slack_token, self.slack_user_id, message)
        except SlackError as exc:
            self.store.release(delivery)
            log.error("delivery=%s event=%s: Slack send failed: %s", delivery, event, exc)
            return 502, "slack send failed"
        log.info("delivery=%s event=%s: notified", delivery, event)
        return 200, "notified"


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
