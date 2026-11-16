import { useEffect, useState } from 'preact/hooks';
import { defaultChannel, developers as developersSetting, slackToken, type ChannelRef, type MemberRef } from '@/lib/settings';
import {
  listChannels,
  listMembers,
  matchesMember,
  testConnection,
  type SlackChannel,
  type SlackIdentity,
  type SlackMember,
} from '@/lib/slack';

type Status =
  | { type: 'idle' }
  | { type: 'busy'; message: string }
  | { type: 'connected'; identity: SlackIdentity }
  | { type: 'error'; message: string };

const MAX_SUGGESTIONS = 8;

function errorMessage(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

export function SlackSettings() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState('');
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelRef | null>(null);
  const [members, setMembers] = useState<SlackMember[]>([]);
  const [developers, setDevelopers] = useState<MemberRef[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  const connect = async (value: string) => {
    setStatus({ type: 'busy', message: 'Checking token…' });
    try {
      const identity = await testConnection(value);
      const [nextChannels, nextMembers] = await Promise.all([listChannels(value), listMembers(value)]);
      setChannels(nextChannels);
      setMembers(nextMembers);
      setStatus({ type: 'connected', identity });
    } catch (error) {
      setChannels([]);
      setMembers([]);
      setStatus({ type: 'error', message: errorMessage(error) });
    }
  };

  useEffect(() => {
    (async () => {
      const [storedToken, storedChannel, storedDevelopers] = await Promise.all([
        slackToken.getValue(),
        defaultChannel.getValue(),
        developersSetting.getValue(),
      ]);
      setToken(storedToken);
      setSavedToken(storedToken);
      setSelectedChannel(storedChannel);
      setDevelopers(storedDevelopers);
      if (storedToken) connect(storedToken);
    })();
  }, []);

  const saveToken = async () => {
    const value = token.trim();
    await slackToken.setValue(value);
    setSavedToken(value);
    if (value) await connect(value);
    else setStatus({ type: 'idle' });
  };

  const saveDefaultChannel = async (id: string) => {
    const channel = channels.find((c) => c.id === id);
    const ref = channel ? { id: channel.id, name: channel.name } : null;
    setSelectedChannel(ref);
    await defaultChannel.setValue(ref);
  };

  const saveDevelopers = async (next: MemberRef[]) => {
    setDevelopers(next);
    await developersSetting.setValue(next);
  };

  const addDeveloper = (member: SlackMember) => {
    saveDevelopers([...developers, { id: member.id, name: member.realName }]);
    setQuery('');
  };

  const suggestions = query.trim()
    ? members.filter((m) => !developers.some((d) => d.id === m.id) && matchesMember(m, query.trim())).slice(0, MAX_SUGGESTIONS)
    : [];

  const disconnect = async () => {
    await Promise.all([slackToken.removeValue(), defaultChannel.removeValue(), developersSetting.removeValue()]);
    setToken('');
    setSavedToken('');
    setChannels([]);
    setSelectedChannel(null);
    setMembers([]);
    setDevelopers([]);
    setQuery('');
    setStatus({ type: 'idle' });
  };

  return (
    <>
      <section>
        <h2>1. Create the Slack app</h2>
        <ol>
          <li>
            Open <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">api.slack.com/apps</a>, choose{' '}
            <em>From a manifest</em>, pick your workspace and paste <code>slack-app-manifest.json</code> from this repository.
          </li>
          <li>Install the app to your workspace.</li>
          <li>
            Copy the <em>User OAuth Token</em> (starts with <code>xoxp-</code>) from <em>OAuth &amp; Permissions</em>.
          </li>
        </ol>
      </section>

      <section>
        <h2>2. Paste your user token</h2>
        <form
          class="row"
          onSubmit={(event) => {
            event.preventDefault();
            saveToken();
          }}
        >
          <input
            type="password"
            placeholder="xoxp-…"
            autoComplete="off"
            spellcheck={false}
            value={token}
            onInput={(e) => setToken(e.currentTarget.value)}
          />
          <button type="submit" class="primary" disabled={status.type === 'busy'}>
            {token.trim() === savedToken ? 'Test connection' : 'Save & test'}
          </button>
          {savedToken && (
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </form>
        <p class="hint">The token is stored only in this browser profile and is sent only to slack.com.</p>

        {status.type === 'busy' && <p class="status">{status.message}</p>}
        {status.type === 'error' && <p class="status status--error">{status.message}</p>}
        {status.type === 'connected' && (
          <p class="status status--success">
            Connected as <strong>{status.identity.user}</strong> in <strong>{status.identity.team}</strong>.
          </p>
        )}
      </section>

      <section>
        <h2>3. Default Channel (optional)</h2>
        <p class="hint">Preselected when you choose the Channel destination. Only channels you belong to are listed.</p>
        <select
          disabled={status.type !== 'connected'}
          value={selectedChannel?.id ?? ''}
          onChange={(e) => saveDefaultChannel(e.currentTarget.value)}
        >
          <option value="">No default channel</option>
          {selectedChannel && !channels.some((c) => c.id === selectedChannel.id) && (
            <option value={selectedChannel.id}>#{selectedChannel.name}</option>
          )}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.isPrivate ? '🔒 ' : '#'}
              {c.name}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>4. Developers</h2>
        <p class="hint">
          Offered as Reviewers on every Review Request. Nobody is preselected: you pick who should review each time.
        </p>
        {developers.length > 0 && (
          <ul class="chips">
            {developers.map((d) => {
              const avatar = members.find((m) => m.id === d.id)?.avatar;
              return (
                <li key={d.id} class="chip">
                  {avatar && <img src={avatar} alt="" />}
                  {d.name}
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    onClick={() => saveDevelopers(developers.filter((x) => x.id !== d.id))}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div class="row">
          <input
            type="search"
            placeholder="Search Slack members…"
            disabled={status.type !== 'connected'}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (suggestions[0]) addDeveloper(suggestions[0]);
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <ul class="suggestions" role="listbox">
            {suggestions.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => addDeveloper(m)}>
                  {m.avatar && <img src={m.avatar} alt="" />}
                  <span>{m.realName}</span>
                  {m.displayName && m.displayName !== m.realName && <span class="hint">@{m.displayName}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
