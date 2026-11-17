// Regenerates the README screenshots in docs/screenshots/ (light and dark) from the built extension.
// Usage: pnpm build && pnpm screenshots
// Loads .output/chrome-mv3 into Chromium, opens this repository's PR #4 on github.com (logged out) and fakes
// the Slack Web API with fictional teammates, so no token or account is needed.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = `${root}.output/chrome-mv3`;
const OUT = `${root}docs/screenshots`;
mkdirSync(OUT, { recursive: true });
const PR = 'https://github.com/0xCodeMaieutics/github-extension/pull/4';

const avatar = (initials, bg) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" fill="${bg}"/><text x="24" y="31" font-family="Helvetica,Arial" font-size="19" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`);
const people = [
  ['U01', 'maya', 'Maya Chen', 'maya', '#2eb67d'],
  ['U02', 'jonas', 'Jonas Weber', 'jonas', '#36c5f0'],
  ['U03', 'priya', 'Priya Raman', 'priya', '#e01e5a'],
  ['U04', 'leo', 'Leo Martins', 'leo', '#ecb22e'],
];
const members = people.map(([id, name, real_name, display_name, bg]) => ({ id, name, real_name, profile: { real_name, display_name, image_48: avatar(real_name.split(' ').map(s => s[0]).join(''), bg) } }));
const channels = [
  { id: 'C01', name: 'code-review', is_member: true, is_private: false },
  { id: 'C02', name: 'frontend', is_member: true, is_private: false },
  { id: 'C03', name: 'platform-team', is_member: true, is_private: true },
];
const slack = {
  'auth.test': { ok: true, user: 'you', user_id: 'U00', team: 'Acme' },
  'conversations.list': { ok: true, channels },
  'users.list': { ok: true, members },
  'chat.postMessage': { ok: true },
  'conversations.open': { ok: true, channel: { id: 'D01' } },
};

// GitHub's CSP blocks cursor.com images (real comments go through its camo proxy), so inline them.
const dataUrl = async (url) => `data:image/png;base64,${Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64')}`;
const fixImages = {};
for (const slug of ['fix-in-cursor', 'fix-in-web']) for (const s of ['light', 'dark']) fixImages[`${slug}-${s}`] = await dataUrl(`https://cursor.com/assets/images/${slug}-${s}.png`);
const bugbotAvatar = await dataUrl('https://avatars.githubusercontent.com/in/1210556?s=80');
const fixLink = (label, slug, width, href) => `<a href="${href}"><picture><source media="(prefers-color-scheme: dark)" srcset="${fixImages[`${slug}-dark`]}"><source media="(prefers-color-scheme: light)" srcset="${fixImages[`${slug}-light`]}"><img alt="${label}" width="${width}" height="28" src="${fixImages[`${slug}-dark`]}"></picture></a>`;
const bugbotComment = `<h3>Renamed files open at the old path</h3>
<p><strong>Medium Severity</strong></p>
<p><code>resolveHeadPath</code> reads the first path in a renamed file's header, which is the path before the rename. Clicking the editor icon on a renamed file then opens a file that no longer exists in the local clone.</p>
<div>${fixLink('Fix in Cursor', 'fix-in-cursor', 115, 'https://cursor.com/open')}&nbsp;${fixLink('Fix in Web', 'fix-in-web', 99, 'https://cursor.com/agents')}</div>
<p><sup>Reviewed by <a href="https://cursor.com/bugbot">Cursor Bugbot</a> for commit 1a2b3c4. Configure <a href="https://www.cursor.com/dashboard/bugbot">here</a>.</sup></p>`;

for (const scheme of ['light', 'dark']) {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: scheme,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('https://slack.com/api/**', (route) => {
    const method = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ json: slack[method] ?? { ok: false, error: 'unknown_method' } });
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  await sw.evaluate(async ([m]) => chrome.storage.local.set({
    slackToken: 'xoxp-demo',
    defaultChannel: { id: 'C01', name: 'code-review' },
    developers: m.map(x => ({ id: x.id, name: x.profile.real_name })),
    repositoryMappings: { '0xcodemaieutics/github-extension': '/Users/you/code/github-extension' },
    openEditor: 'vscode',
  }), [members]);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const suffix = scheme === 'dark' ? '-dark' : '';

  // 1. File opener: header icons + floating toolbar on a code selection.
  await page.goto(`${PR}/files`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-gvfo-open]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  // Scroll so the App.tsx header sits near the top.
  const header = page.locator('[data-gvfo-open]').nth(1);
  await header.evaluate(e => window.scrollBy(0, e.getBoundingClientRect().top - 120));
  await page.waitForTimeout(300);
  // Select from the start of "export" to the end of the next line, then fire the mouseup the toolbar listens for.
  await page.evaluate(() => {
    const cell = (re) => [...document.querySelectorAll('td, div')].filter(e => re.test(e.textContent ?? '')).at(-1);
    const texts = (e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) out.push(w.currentNode); return out; };
    const a = texts(cell(/^\+?\s*export function App\(\) \{\s*$/)).find(t => t.data.includes('export'));
    const bs = texts(cell(/^\+?\s*const \[open, setOpen\] = useState\(false\);\s*$/)).filter(t => t.data.trim());
    const b = bs.at(-1);
    const range = document.createRange();
    range.setStart(a, a.data.indexOf('export'));
    range.setEnd(b, b.data.length);
    const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.waitForSelector('[data-gvfo-t3-selection]', { state: 'attached' });
  await page.waitForTimeout(300);
  const diff = await page.locator('[data-gvfo-open]').nth(1).evaluate(e => {
    let c = e; while (c && c.getBoundingClientRect().width < 900) c = c.parentElement;
    const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width };
  });
  const tb = await page.locator('[data-gvfo-t3-selection]').evaluate(e => e.getBoundingClientRect().bottom);
  await page.screenshot({ path: `${OUT}/file-opener${suffix}.png`, clip: { x: diff.x - 12, y: diff.y - 12, width: diff.w + 24, height: tb + 60 - (diff.y - 12) } });

  // 2. Slack: the Review Request dialog and the floating button.
  await page.goto(PR, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // PR #4 is merged and the button only shows on open PRs, so present it as open (state is read, not displayed in the crop).
  await page.evaluate(() => {
    document.querySelectorAll('[data-component="StateLabel"][data-status]').forEach(e => e.setAttribute('data-status', 'pullOpened'));
    document.querySelectorAll('.gh-header-meta .State, span.State[title^="Status"]').forEach(e => { e.textContent = 'Open'; });
    document.body.append(document.createElement('span'));
  });
  const trigger = page.locator('[aria-label="Request PR review"]');
  await trigger.waitFor({ timeout: 15000 });
  await trigger.click();
  await page.getByRole('checkbox', { name: /Maya Chen/ }).click();
  await page.getByRole('checkbox', { name: /Jonas Weber/ }).click();
  await page.getByPlaceholder('e.g. small one, ~50 lines').fill('Small one, mostly CSS. Thanks!');
  await page.waitForTimeout(400);
  const d = await page.locator('dialog').evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.bottom }; });
  // Crop from the dialog to the floating button, leaving out the PR's (merged) state label.
  await page.screenshot({ path: `${OUT}/slack-dialog${suffix}.png`, clip: { x: d.x - 40, y: d.y - 24, width: 1280 - (d.x - 40), height: 860 - (d.y - 24) } });

  // 3. Bugbot: PR #4 has no Bugbot comments, so its description is restyled as a fictional Bugbot issue comment.
  await page.goto(PR, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.timeline-comment .markdown-body');
  await page.evaluate(([body, avatarSrc]) => {
    const comment = document.querySelector('.timeline-comment');
    comment.querySelector('.markdown-body').innerHTML = body;
    comment.querySelectorAll('.author').forEach(e => { e.textContent = 'cursor'; });
    comment.querySelectorAll('.Label, .timeline-comment-label').forEach(e => e.remove());
    comment.closest('.TimelineItem')?.querySelectorAll('img.avatar').forEach(e => { e.removeAttribute('srcset'); e.src = avatarSrc; });
  }, [bugbotComment, bugbotAvatar]);
  await page.waitForSelector('[data-gvfo-bugbot-copy]', { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.TimelineItem img')].every(i => i.complete));
  const item = page.locator('.timeline-comment').first().locator('xpath=ancestor::*[contains(@class, "TimelineItem")][1]');
  await page.locator('[data-gvfo-bugbot-copy]').evaluate(e => Object.assign(e.style, { outline: '2px solid #fb8f44', outlineOffset: '3px', borderRadius: '6px' }));
  await item.evaluate(e => window.scrollBy(0, e.getBoundingClientRect().top - 80));
  await page.waitForTimeout(300);
  const c = await page.locator('.timeline-comment').first().boundingBox();
  const left = await item.evaluate(e => Math.min(...[...e.querySelectorAll('img.avatar')].map(i => i.getBoundingClientRect().left), e.getBoundingClientRect().left));
  await page.screenshot({ path: `${OUT}/bugbot${suffix}.png`, clip: { x: left - 12, y: c.y - 12, width: c.x + c.width + 12 - (left - 12), height: c.height + 24 } });

  // 4. Settings tabs.
  for (const tab of ['file-opener', 'slack']) {
    await page.goto(`chrome-extension://${extId}/options.html#${tab}`);
    await page.waitForTimeout(1500);
    const m = await page.locator('main').boundingBox();
    await page.screenshot({ path: `${OUT}/settings-${tab}${suffix}.png`, clip: { x: m.x - 32, y: Math.max(0, m.y - 24), width: m.width + 64, height: m.height + 48 } });
  }
  await ctx.close();
}
