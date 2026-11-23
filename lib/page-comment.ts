/** GitHub ships both a classic and a React comment box at the bottom of the Conversation tab. */
const TEXTAREA_SELECTORS = [
  '#new_comment_field',
  'form.js-new-comment-form textarea[name="comment[body]"]',
  '[data-testid="issue-comment-box"] textarea',
  'textarea[placeholder^="Use Markdown to format your comment"]',
];

export function findNewCommentBox(root: ParentNode = document): HTMLTextAreaElement | null {
  for (const selector of TEXTAREA_SELECTORS) {
    const textarea = root.querySelector<HTMLTextAreaElement>(selector);
    if (textarea) return textarea;
  }
  return null;
}

/** The "Comment" submit button nearest to the textarea: its form first, then wider containers. */
export function findCommentButton(textarea: HTMLTextAreaElement): HTMLButtonElement | null {
  let scope: Element | null = textarea.closest('form') ?? textarea.parentElement;
  while (scope) {
    const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Comment' && !b.disabled,
    );
    if (button) return button;
    scope = scope.parentElement;
  }
  return null;
}

/** Sets the value through the native setter so React-controlled textareas see the change. */
function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Posts `body` as a new PR comment through the page's own comment box, as the signed-in user. */
export async function postPageComment(body: string): Promise<void> {
  const textarea = findNewCommentBox();
  if (!textarea) throw new Error('No comment box found. Open the Conversation tab and try again.');
  if (textarea.value.trim()) throw new Error('The comment box already has a draft. Post or clear it first.');

  setTextareaValue(textarea, body);
  // Let the page enable its submit button after the input event.
  await nextFrame();
  const button = findCommentButton(textarea);
  if (!button) {
    setTextareaValue(textarea, '');
    throw new Error('Could not find the Comment button.');
  }
  button.click();
}
