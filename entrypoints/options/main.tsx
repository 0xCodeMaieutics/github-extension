import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { SlackIcon } from '@/components/SlackIcon';
import { FileOpenerSettings } from './FileOpenerSettings';
import { SlackSettings } from './SlackSettings';
import './style.css';

const TABS = [
  { id: 'file-opener', label: 'File opener', Panel: FileOpenerSettings },
  { id: 'slack', label: 'Slack', icon: <SlackIcon />, Panel: SlackSettings },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const id = location.hash.slice(1);
  return TABS.find((tab) => tab.id === id)?.id ?? TABS[0].id;
}

function Options() {
  const [active, setActive] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const onHashChange = () => setActive(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = (id: TabId) => {
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  return (
    <main>
      <h1>
        <img src="/icon/48.png" width={32} height={32} alt="" /> Github Gio settings
      </h1>

      <div class="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            aria-selected={active === tab.id}
            class="tab"
            onClick={() => select(tab.id)}
          >
            {'icon' in tab && tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panels stay mounted so switching tabs keeps the Slack connection and unsaved input. */}
      {TABS.map(({ id, Panel }) => (
        <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id}>
          <Panel />
        </div>
      ))}
    </main>
  );
}

render(<Options />, document.getElementById('app')!);
