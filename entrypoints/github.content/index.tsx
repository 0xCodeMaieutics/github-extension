import { render } from 'preact';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isPrPagePath, readPullRequestState } from '@/lib/pull-request';
import { App } from './App';
import './style.css';

function shouldShowButton(): boolean {
  if (!isPrPagePath(location.pathname)) return false;
  const state = readPullRequestState();
  return state === 'open' || state === 'draft' || state === 'unknown';
}

export default defineContentScript({
  // All of github.com, because GitHub navigates to PR pages without a full page load.
  matches: ['https://github.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'slack-review-request',
      position: 'inline',
      isolateEvents: true,
      anchor: () => document.body,
      onMount: (container) => {
        render(<App />, container);
        return container;
      },
      onRemove: (container) => {
        if (container) render(null, container);
      },
    });

    const sync = () => {
      const host = ui.shadowHost;
      if (!shouldShowButton()) {
        if (host.isConnected) ui.remove();
        return;
      }
      if (!host.isConnected) ui.mount();
    };

    let scheduled = false;
    const scheduleSync = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        sync();
      });
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    ctx.onInvalidated(() => observer.disconnect());
    ctx.addEventListener(window, 'wxt:locationchange', scheduleSync);
    sync();
  },
});
