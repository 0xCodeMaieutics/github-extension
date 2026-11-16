import { storage } from 'wxt/utils/storage';

export interface ChannelRef {
  id: string;
  name: string;
}

export interface MemberRef {
  id: string;
  name: string;
}

// `local:` keeps the token on this device only; `sync:` would copy it to every signed-in browser.
export const slackToken = storage.defineItem<string>('local:slackToken', { fallback: '' });

export const defaultChannel = storage.defineItem<ChannelRef | null>('local:defaultChannel', {
  fallback: null,
});

export const developers = storage.defineItem<MemberRef[]>('local:developers', { fallback: [] });

/** Carries over the members saved as "Default Reviewers" before they became Developers. */
export async function migrateDefaultReviewers(): Promise<void> {
  const legacy = await storage.getItem<MemberRef[]>('local:defaultReviewers');
  if (!legacy) return;
  if ((await developers.getValue()).length === 0) await developers.setValue(legacy);
  await storage.removeItem('local:defaultReviewers');
}
