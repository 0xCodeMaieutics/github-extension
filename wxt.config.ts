import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: 'Github Gio',
    description:
      'Open GitHub pull request files in your editor or T3 Code, and request reviews from colleagues on Slack.',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://slack.com/*'],
    action: { default_title: 'Github Gio settings' },
  },
});
