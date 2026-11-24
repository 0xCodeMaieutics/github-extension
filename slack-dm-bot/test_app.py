import hashlib
import hmac
import json
import unittest

import app

ME = "octo-me"
SECRET = "test-secret"
REPO = {"full_name": "acme/widgets"}
MY_PR = {"number": 7, "title": "Add <widgets> & things", "html_url": "https://github.com/acme/widgets/pull/7",
         "user": {"login": ME}}
OTHER_PR = dict(MY_PR, user={"login": "someone-else"})


def sign(body):
    return "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


class FakeStore(app.DeliveryStore):
    def __init__(self):
        super().__init__(":memory:")


class WebhookTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.fail_send = False

        def send(token, user, text):
            if self.fail_send:
                raise app.SlackError("boom")
            self.sent.append((user, text))

        self.app = app.App(SECRET, ME, "xoxb-test", "U123", FakeStore(), send=send)

    def post(self, event, payload, delivery="d-1", signature=None):
        body = json.dumps(payload).encode()
        headers = {
            "X-GitHub-Event": event,
            "X-GitHub-Delivery": delivery,
            "X-Hub-Signature-256": signature if signature is not None else sign(body),
        }
        return self.app.handle_webhook(headers, body)

    # signature + dedupe

    def test_rejects_bad_signature(self):
        status, _ = self.post("ping", {}, signature="sha256=" + "0" * 64)
        self.assertEqual(status, 401)
        status, _ = self.post("ping", {}, signature="")
        self.assertEqual(status, 401)

    def test_ping(self):
        self.assertEqual(self.post("ping", {"zen": "hi"}), (200, "pong"))

    def test_duplicate_delivery_sends_once(self):
        payload = self.issue_comment("alice")
        self.assertEqual(self.post("issue_comment", payload)[1], "notified")
        self.assertEqual(self.post("issue_comment", payload)[1], "duplicate")
        self.assertEqual(len(self.sent), 1)

    def test_slack_failure_allows_redelivery(self):
        self.fail_send = True
        self.assertEqual(self.post("issue_comment", self.issue_comment("alice"))[0], 502)
        self.fail_send = False
        self.assertEqual(self.post("issue_comment", self.issue_comment("alice"))[1], "notified")

    # review requests

    def test_review_requested_for_me(self):
        payload = {"action": "review_requested", "pull_request": OTHER_PR, "repository": REPO,
                   "requested_reviewer": {"login": ME}, "sender": {"login": "bob"}}
        self.assertEqual(self.post("pull_request", payload)[1], "notified")
        text = self.sent[0][1]
        self.assertIn("*bob* requested your review on", text)
        self.assertIn("<https://github.com/acme/widgets/pull/7|acme/widgets#7: Add &lt;widgets&gt; &amp; things>", text)

    def test_review_requested_for_someone_else_ignored(self):
        payload = {"action": "review_requested", "pull_request": OTHER_PR, "repository": REPO,
                   "requested_reviewer": {"login": "carol"}, "sender": {"login": "bob"}}
        self.assertEqual(self.post("pull_request", payload)[1], "ignored")

    # reviews

    def review(self, user, state, body):
        return {"action": "submitted", "pull_request": MY_PR, "repository": REPO, "sender": {"login": user},
                "review": {"user": {"login": user}, "state": state, "body": body,
                           "html_url": "https://github.com/acme/widgets/pull/7#pullrequestreview-1"}}

    def test_review_with_body(self):
        self.post("pull_request_review", self.review("bob", "changes_requested", "Please fix <!-- x --> the tests"))
        text = self.sent[0][1]
        self.assertIn("*bob* requested changes on <https://github.com/acme/widgets/pull/7#pullrequestreview-1|", text)
        self.assertNotIn("Please fix", text)

    def test_approval_without_body_still_notifies(self):
        self.assertEqual(self.post("pull_request_review", self.review("bob", "APPROVED", None))[1], "notified")
        self.assertIn("approved", self.sent[0][1])

    def test_empty_commented_review_skipped(self):
        # Bugbot-style container review; its inline comments notify separately.
        self.assertEqual(self.post("pull_request_review", self.review("cursor[bot]", "commented", ""))[1], "ignored")

    def test_own_review_skipped(self):
        self.assertEqual(self.post("pull_request_review", self.review(ME, "commented", "note to self"))[1], "ignored")

    def test_review_on_others_pr_skipped(self):
        payload = self.review("bob", "approved", "lgtm")
        payload["pull_request"] = OTHER_PR
        self.assertEqual(self.post("pull_request_review", payload)[1], "ignored")

    # inline comments

    def test_bugbot_inline_comment(self):
        body = "### Bug: Off-by-one in loop\n\n<!-- **High Severity** -->\nThe loop skips the last item.\n<!-- BUGBOT_BUG_ID: abc -->"
        payload = {"action": "created", "pull_request": MY_PR, "repository": REPO,
                   "sender": {"login": "cursor[bot]"},
                   "comment": {"user": {"login": "cursor[bot]"}, "body": body, "path": "src/loop.py",
                               "html_url": "https://github.com/acme/widgets/pull/7#discussion_r9"}}
        self.assertEqual(self.post("pull_request_review_comment", payload)[1], "notified")
        text = self.sent[0][1]
        self.assertIn("*cursor[bot]* left an inline comment on <https://github.com/acme/widgets/pull/7#discussion_r9|", text)
        self.assertNotIn("src/loop.py", text)
        self.assertNotIn("Off-by-one", text)

    # review threads

    def thread(self, user, action="resolved", pr=MY_PR):
        return {"action": action, "pull_request": pr, "repository": REPO, "sender": {"login": user},
                "thread": {"comments": [{"path": "src/loop.py", "body": "Off-by-one here",
                                         "html_url": "https://github.com/acme/widgets/pull/7#discussion_r9"}]}}

    def test_thread_resolved(self):
        self.assertEqual(self.post("pull_request_review_thread", self.thread("bob"))[1], "notified")
        text = self.sent[0][1]
        self.assertIn("*bob* resolved a review thread on <https://github.com/acme/widgets/pull/7#discussion_r9|", text)
        self.assertNotIn("src/loop.py", text)
        self.assertNotIn("Off-by-one", text)

    def test_thread_unresolved(self):
        self.post("pull_request_review_thread", self.thread("bob", "unresolved"))
        self.assertIn("unresolved a review thread", self.sent[0][1])

    def test_thread_own_or_others_pr_ignored(self):
        self.assertEqual(self.post("pull_request_review_thread", self.thread(ME), "d-a")[1], "ignored")
        self.assertEqual(self.post("pull_request_review_thread", self.thread("bob", pr=OTHER_PR), "d-b")[1], "ignored")

    # top-level comments

    def issue_comment(self, user, on_pr=True):
        issue = {"number": 7, "title": "Add widgets", "html_url": MY_PR["html_url"], "user": {"login": ME}}
        if on_pr:
            issue["pull_request"] = {"url": "x"}
        return {"action": "created", "issue": issue, "repository": REPO, "sender": {"login": user},
                "comment": {"user": {"login": user}, "body": "x" * 500,
                            "html_url": "https://github.com/acme/widgets/pull/7#issuecomment-3"}}

    def test_top_level_comment_headline_only(self):
        self.post("issue_comment", self.issue_comment("alice"))
        text = self.sent[0][1]
        self.assertEqual(
            text,
            "*alice* commented on "
            "<https://github.com/acme/widgets/pull/7#issuecomment-3|acme/widgets#7: Add widgets>",
        )
        self.assertNotIn("x" * 500, text)

    def test_comment_on_plain_issue_ignored(self):
        self.assertEqual(self.post("issue_comment", self.issue_comment("alice", on_pr=False))[1], "ignored")

    def test_own_comment_ignored_case_insensitive(self):
        self.assertEqual(self.post("issue_comment", self.issue_comment(ME.upper()))[1], "ignored")

    def test_unhandled_event_ignored(self):
        self.assertEqual(self.post("push", {"ref": "refs/heads/main"})[1], "ignored")


if __name__ == "__main__":
    unittest.main()



SHA = "abc123"
OPEN_PR = dict(MY_PR, state="open", head={"sha": SHA})


class CITests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.fail_send = False

        def send(token, user, text):
            if self.fail_send:
                raise app.SlackError("boom")
            self.sent.append(text)

        self.app = app.App(SECRET, ME, "xoxb-test", "U123", FakeStore(), send=send)
        self.deliveries = 0
        self.run_ids = {}

    def post(self, event, payload):
        self.deliveries += 1
        body = json.dumps(dict(payload, repository=REPO)).encode()
        return self.app.handle_webhook({
            "X-GitHub-Event": event,
            "X-GitHub-Delivery": f"d-{self.deliveries}",
            "X-Hub-Signature-256": sign(body),
        }, body)

    def pr_event(self, action="synchronize", pr=OPEN_PR):
        return self.post("pull_request", {"action": action, "pull_request": pr,
                                          "sender": {"login": ME}})

    def check(self, name, conclusion=None, action=None, run_id=None, sha=SHA):
        """A check_run event; a new run id per name unless given."""
        if run_id is None:
            run_id = self.run_ids.setdefault(name, len(self.run_ids) + 1)
        done = conclusion is not None
        # Sender is me on purpose: CI on my own push must still notify.
        return self.post("check_run", {
            "action": action or ("completed" if done else "created"),
            "check_run": {"id": run_id, "name": name, "head_sha": sha, "app": {"id": 15368},
                          "status": "completed" if done else "queued", "conclusion": conclusion,
                          "details_url": f"https://ci.example/{name}"},
            "sender": {"login": ME},
        })

    def test_all_green_once_per_commit(self):
        self.pr_event()
        self.check("lint")
        self.check("test")
        self.assertEqual(self.check("lint", "success"), (200, "ignored"))  # test still queued
        self.assertEqual(self.check("test", "success"), (200, "notified"))
        self.assertEqual(self.check("test", "success"), (200, "already notified"))
        self.assertEqual(self.sent, [
            ":white_check_mark: All checks passed on "
            "<https://github.com/acme/widgets/pull/7/checks|acme/widgets#7: Add &lt;widgets&gt; &amp; things>"
        ])

    def test_first_failure_notifies_without_waiting(self):
        self.pr_event()
        self.check("test")
        self.assertEqual(self.check("lint", "failure"), (200, "notified"))
        self.assertEqual(self.sent[0],
                         ":x: CI failed on <https://github.com/acme/widgets/pull/7/checks|"
                         "acme/widgets#7: Add &lt;widgets&gt; &amp; things>: <https://ci.example/lint|lint>")
        self.assertEqual(self.check("test", "timed_out"), (200, "already notified"))

    def test_green_after_rerun_fixes_failure(self):
        self.pr_event()
        self.check("lint", "failure")
        self.check("lint", run_id=99)  # re-run is a new check run
        self.assertEqual(self.check("lint", "success", run_id=99), (200, "notified"))
        self.assertIn("All checks passed", self.sent[1])

    def test_out_of_order_deliveries(self):
        self.pr_event()
        self.check("lint", "success", run_id=5)
        self.assertEqual(self.check("lint", run_id=5), (200, "already notified"))  # late "created"
        self.assertEqual(self.check("lint", "failure", run_id=4), (200, "already notified"))  # older run
        self.assertEqual(len(self.sent), 1)

    def test_commit_statuses(self):
        self.pr_event()
        self.check("lint", "success")  # green so far
        self.post("status", {"id": 1, "sha": SHA, "context": "ci/legacy", "state": "pending"})
        self.assertEqual(
            self.post("status", {"id": 2, "sha": SHA, "context": "ci/legacy", "state": "error",
                                 "target_url": None}),
            (200, "notified"))
        self.assertEqual(len(self.sent), 2)
        self.assertTrue(self.sent[1].endswith(": ci/legacy"))

    def test_ci_done_before_pr_opened(self):
        self.check("lint", "success")
        self.assertEqual(self.pr_event("opened"), (200, "notified"))

    def test_unknown_pr_ignored(self):
        self.assertEqual(self.check("lint", "success"), (200, "ignored"))

    def test_skips_others_prs_stale_heads_and_closed(self):
        self.pr_event(pr=dict(OPEN_PR, user={"login": "someone-else"}))
        self.assertEqual(self.check("lint", "success"), (200, "ignored"))
        self.pr_event(pr=dict(OPEN_PR, head={"sha": "newer"}))
        self.assertEqual(self.check("test", "success"), (200, "ignored"))
        self.pr_event("closed", pr=dict(OPEN_PR, state="closed"))
        self.assertEqual(self.check("docs", "success"), (200, "ignored"))
        self.assertEqual(self.sent, [])

    def test_slack_failure_allows_retry(self):
        self.pr_event()
        self.fail_send = True
        self.assertEqual(self.check("lint", "success")[0], 502)
        self.fail_send = False
        self.assertEqual(self.check("lint", "success"), (200, "notified"))
