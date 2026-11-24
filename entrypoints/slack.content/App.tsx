import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CursorIcon } from '@/components/CursorIcon';
import { SlackIcon } from '@/components/SlackIcon';
import { request, type SendResult } from '@/lib/messaging';
import { postPageComment } from '@/lib/page-comment';
import { readPullRequest, type PullRequest } from '@/lib/pull-request';
import { formatReviewRequest, type Destination } from '@/lib/review-request';
import type { SlackChannel, SlackMember } from '@/lib/slack';

type Load =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'error'; error: string }
  | { status: 'ready'; channels: SlackChannel[]; developers: SlackMember[]; defaultChannelId: string | null };

type Send = { status: 'idle' } | { status: 'sending' } | { status: 'sent'; result: SendResult } | { status: 'error'; error: string };

const resolveMentions = (text: string, members: SlackMember[]) =>
  text.replace(/<@(\w+)>/g, (_, id) => `@${members.find((m) => m.id === id)?.realName ?? id}`);

const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Slack mrkdwn shown as plain text, with mentions and links resolved to names. */
function toPreview(text: string, members: SlackMember[]): string {
  return unescape(
    resolveMentions(text, members)
      .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(':eyes:', '👀'),
  );
}

/** Slack mrkdwn as clipboard text: HTML (keeps the link and bold when pasted into Slack) and a plain fallback. */
function toClipboard(text: string, members: SlackMember[]): { html: string; plain: string } {
  const resolved = resolveMentions(text, members).trim();
  const html = resolved
    .replace(/<([^|>]+)\|([^>]+)>/g, (_, url, label) => `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .split('\n')
    .join('<br>');
  const plain = unescape(resolved.replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)').replace(/\*([^*\n]+)\*/g, '$1'));
  return { html, plain };
}

async function copyToClipboard({ html, plain }: { html: string; plain: string }): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(plain);
  }
}

export function App() {
  const [open, setOpen] = useState(false);
  const [cursorOpen, setCursorOpen] = useState(false);

  return (
    <div class="root">
      <button
        type="button"
        class="trigger"
        aria-label="Start Cursor review"
        title="Start Cursor review"
        aria-haspopup="dialog"
        aria-expanded={cursorOpen}
        onClick={() => setCursorOpen(true)}
      >
        <CursorIcon size={24} />
      </button>
      {cursorOpen && <CursorReviewDialog onClose={() => setCursorOpen(false)} />}
      <button
        type="button"
        class="trigger"
        aria-label="Request PR review"
        title="Request PR review"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SlackIcon size={24} />
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A native modal `<dialog>`, which traps focus, closes on Escape and returns focus to the trigger. */
function Dialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      class="dialog"
      aria-label="Request PR review on Slack"
      onClose={onClose}
      onClick={(event) => event.target === dialogRef.current && onClose()}
    >
      <Panel onClose={onClose} />
    </dialog>
  );
}

const CURSOR_REVIEW_COMMENT = '@cursor review';

type Post = { status: 'idle' } | { status: 'posting' } | { status: 'error'; error: string };

/** Asks for confirmation, then comments `@cursor review` on the PR so Cursor Bugbot starts a review. */
function CursorReviewDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [post, setPost] = useState<Post>({ status: 'idle' });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const confirm = async () => {
    setPost({ status: 'posting' });
    try {
      await postPageComment(CURSOR_REVIEW_COMMENT);
      onClose();
    } catch (error) {
      setPost({ status: 'error', error: String((error as Error).message ?? error) });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      class="dialog dialog--confirm"
      aria-label="Start Cursor review"
      onClose={onClose}
      onClick={(event) => event.target === dialogRef.current && onClose()}
    >
      <div class="panel">
        <header class="panel__header">
          <CursorIcon size={18} />
          <strong>Start Cursor review</strong>
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div class="panel__body">
          <p class="confirm__text">
            Are you sure you want to start a Cursor review? This comments <code>{CURSOR_REVIEW_COMMENT}</code> on this
            pull request.
          </p>
          {post.status === 'error' && <p class="notice notice--error">{post.error}</p>}
          <div class="confirm__actions">
            <button type="button" class="btn" onClick={onClose}>
              No
            </button>
            <button type="button" class="btn btn--primary" disabled={post.status === 'posting'} onClick={confirm}>
              {post.status === 'posting' ? 'Posting…' : 'Yes'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const pullRequest = useMemo<PullRequest | null>(() => readPullRequest(), []);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [destinationType, setDestinationType] = useState<Destination['type']>('direct');
  const [channelId, setChannelId] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [send, setSend] = useState<Send>({ status: 'idle' });
  const [copy, setCopy] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const setup = await request('getSetup');
        if (!setup.configured) return !cancelled && setLoad({ status: 'unconfigured' });
        const [channels, members] = await Promise.all([request('listChannels'), request('listMembers')]);
        if (cancelled) return;
        const defaultChannelId = channels.some((c) => c.id === setup.defaultChannel?.id) ? setup.defaultChannel!.id : null;
        setChannelId(defaultChannelId ?? '');
        const developers = setup.developers.flatMap((d) => members.find((m) => m.id === d.id) ?? []);
        setLoad({ status: 'ready', channels, developers, defaultChannelId });
      } catch (error) {
        if (!cancelled) setLoad({ status: 'error', error: String((error as Error).message ?? error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const developers = load.status === 'ready' ? load.developers : [];

  const destination: Destination | null =
    destinationType === 'direct' ? { type: 'direct' } : channelId ? { type: 'channel', channelId } : null;
  const reviewRequest = pullRequest && destination ? { pullRequest, destination, reviewerIds, note } : null;
  const canSend = reviewRequest !== null && reviewerIds.length > 0 && send.status !== 'sending';

  const toggleReviewer = (id: string) =>
    setReviewerIds(reviewerIds.includes(id) ? reviewerIds.filter((x) => x !== id) : [...reviewerIds, id]);

  const copyMessage = async () => {
    if (!reviewRequest) return;
    try {
      await copyToClipboard(toClipboard(formatReviewRequest(reviewRequest), developers));
      setCopy('copied');
    } catch {
      setCopy('error');
    }
    setTimeout(() => setCopy('idle'), 2000);
  };

  const submit = async () => {
    if (!reviewRequest || !canSend) return;
    setSend({ status: 'sending' });
    try {
      const result = await request('sendReviewRequest', { reviewRequest });
      setSend({ status: 'sent', result });
      if (result.failures.length === 0) {
        setReviewerIds([]);
        setNote('');
      }
    } catch (error) {
      setSend({ status: 'error', error: String((error as Error).message ?? error) });
    }
  };

  return (
    <div class="panel">
      <header class="panel__header">
        <SlackIcon size={18} />
        <strong>Request PR review</strong>
        <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {load.status === 'loading' && <p class="muted">Loading Slack channels and members…</p>}

      {load.status === 'unconfigured' && (
        <div class="notice">
          <p>Connect Slack first: paste your Slack user token in the extension settings.</p>
          <button type="button" class="btn btn--primary" onClick={() => request('openSettings')}>
            Open settings
          </button>
        </div>
      )}

      {load.status === 'error' && (
        <div class="notice notice--error">
          <p>{load.error}</p>
          <button type="button" class="btn" onClick={() => request('openSettings')}>
            Open settings
          </button>
        </div>
      )}

      {load.status === 'ready' && (
        <form
          class="panel__body"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div class="segmented" role="radiogroup" aria-label="Destination">
            {(['direct', 'channel'] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={destinationType === type}
                class={destinationType === type ? 'segmented__option is-selected' : 'segmented__option'}
                onClick={() => setDestinationType(type)}
              >
                {type === 'channel' ? 'Channel' : 'Direct messages'}
              </button>
            ))}
          </div>

          {destinationType === 'channel' && (
            <label class="field">
              <span class="field__label">Channel</span>
              <select value={channelId} onChange={(e) => setChannelId(e.currentTarget.value)}>
                <option value="">Choose a channel…</option>
                {load.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.isPrivate ? '🔒 ' : '#'}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div class="field">
            <span class="field__label">Reviewers</span>
            {developers.length === 0 ? (
              <div class="notice">
                <p>Add Developers in the extension settings to choose Reviewers from them.</p>
                <button type="button" class="btn" onClick={() => request('openSettings')}>
                  Open settings
                </button>
              </div>
            ) : (
              <ul class="developers" aria-label="Developers">
                {developers.map((m) => {
                  const selected = reviewerIds.includes(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        class={selected ? 'developer is-selected' : 'developer'}
                        onClick={() => toggleReviewer(m.id)}
                      >
                        <span class="developer__check" aria-hidden="true">
                          {selected ? '✓' : ''}
                        </span>
                        {m.avatar && <img src={m.avatar} alt="" />}
                        <span>{m.realName}</span>
                        {m.displayName && m.displayName !== m.realName && <span class="muted">@{m.displayName}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <label class="field">
            <span class="field__label">Note (optional)</span>
            <textarea rows={2} value={note} placeholder="e.g. small one, ~50 lines" onInput={(e) => setNote(e.currentTarget.value)} />
          </label>

          {reviewRequest && reviewerIds.length > 0 && (
            <div class="field">
              <span class="field__label">Preview</span>
              <pre class="preview">{toPreview(formatReviewRequest(reviewRequest), developers)}</pre>
            </div>
          )}

          {send.status === 'sent' && (
            <p class={send.result.failures.length ? 'notice notice--error' : 'notice notice--success'}>
              {describeResult(send.result, destinationType, developers)}
            </p>
          )}
          {send.status === 'error' && <p class="notice notice--error">{send.error}</p>}

          <div class="panel__actions">
            <button type="button" class="btn" disabled={!reviewRequest || reviewerIds.length === 0} onClick={copyMessage}>
              {copy === 'copied' ? 'Copied!' : copy === 'error' ? 'Copy failed' : 'Copy message'}
            </button>
            <button type="submit" class="btn btn--primary" disabled={!canSend}>
              {send.status === 'sending'
                ? 'Sending…'
                : destinationType === 'direct' && reviewerIds.length > 1
                  ? `Send ${reviewerIds.length} direct messages`
                  : 'Send review request'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function describeResult(result: SendResult, destinationType: Destination['type'], members: SlackMember[]): string {
  if (result.failures.length === 0) {
    return destinationType === 'channel'
      ? 'Review request posted.'
      : `Review request sent to ${result.delivered} ${result.delivered === 1 ? 'Reviewer' : 'Reviewers'}.`;
  }
  const failed = result.failures
    .map((f) => `${members.find((m) => m.id === f.reviewerId)?.realName ?? 'Unknown'}: ${f.error}`)
    .join('; ');
  return `Sent ${result.delivered}, failed ${result.failures.length}. ${failed}`;
}
