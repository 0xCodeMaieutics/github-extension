import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { EDITORS, getEditor, isEditor, setEditor, type Editor } from '@/lib/file-opener/editor';
import {
  deleteRepositoryMapping,
  getRepositoryMappings,
  setRepositoryMapping,
  type RepositoryMappings,
} from '@/lib/file-opener/mappings';
import { isAbsoluteLocalPath, normalizeLocalRoot } from '@/lib/file-opener/paths';

const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/;

function validatePath(input: string): string | null {
  const path = normalizeLocalRoot(input);
  return isAbsoluteLocalPath(path) ? path : null;
}

function MappingRow({ repository, localRoot }: { repository: string; localRoot: string }) {
  return (
    <tr>
      <td>
        <code>{repository}</code>
      </td>
      <td>
        <input
          class="mono"
          value={localRoot}
          spellcheck={false}
          aria-label={`Local folder for ${repository}`}
          onChange={async (e) => {
            const input = e.currentTarget;
            const path = validatePath(input.value);
            if (!path) {
              input.setCustomValidity('Enter an absolute path');
              input.reportValidity();
              return;
            }
            input.setCustomValidity('');
            input.value = path;
            await setRepositoryMapping(repository, path);
          }}
        />
      </td>
      <td>
        <button type="button" class="danger" onClick={() => deleteRepositoryMapping(repository)}>
          Remove
        </button>
      </td>
    </tr>
  );
}

export function FileOpenerSettings() {
  const [mappings, setMappings] = useState<RepositoryMappings>({});
  const [editor, setEditorState] = useState<Editor | null>(null);
  const [repository, setRepository] = useState('');
  const [path, setPath] = useState('');
  const [addError, setAddError] = useState('');

  useEffect(() => {
    const load = () => {
      getRepositoryMappings().then(setMappings);
      getEditor().then(setEditorState);
    };
    load();
    const onChanged = (_: unknown, area: string) => {
      if (area === 'local') load();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  const addMapping = async () => {
    const key = repository.trim().toLowerCase();
    const localRoot = validatePath(path);
    if (!REPOSITORY_PATTERN.test(key)) {
      setAddError('Repository must look like owner/name.');
      return;
    }
    if (!localRoot) {
      setAddError('Local folder must be an absolute path (~ is not expanded).');
      return;
    }
    setAddError('');
    await setRepositoryMapping(key, localRoot);
    setRepository('');
    setPath('');
  };

  const entries = Object.entries(mappings).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <section>
        <h2>Repository mappings</h2>
        <p class="hint">
          Each GitHub repository (<code>owner/name</code>) maps to the absolute path of its clone on this computer. Files
          open from whatever branch is checked out there.
        </p>
        {entries.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col">Local folder</th>
                <th scope="col">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, localRoot]) => (
                <MappingRow key={`${key}:${localRoot}`} repository={key} localRoot={localRoot} />
              ))}
            </tbody>
          </table>
        ) : (
          <p class="hint">
            No mappings yet. Click the editor icon on a pull request's Files changed tab to add one, or add it below.
          </p>
        )}
      </section>

      <section>
        <h2>Add mapping</h2>
        <form
          class="row"
          onSubmit={(event) => {
            event.preventDefault();
            addMapping();
          }}
        >
          <input
            class="mono"
            placeholder="owner/name"
            required
            autoComplete="off"
            spellcheck={false}
            value={repository}
            onInput={(e) => setRepository(e.currentTarget.value)}
          />
          <input
            class="mono"
            placeholder="/Users/you/code/repo"
            required
            autoComplete="off"
            spellcheck={false}
            value={path}
            onInput={(e) => setPath(e.currentTarget.value)}
          />
          <button type="submit" class="primary">
            Add
          </button>
        </form>
        {addError && (
          <p class="status status--error" role="alert">
            {addError}
          </p>
        )}
      </section>

      <section>
        <h2>Open files in</h2>
        <div class="choices" role="radiogroup">
          {(Object.keys(EDITORS) as Editor[]).map((id) => (
            <label key={id}>
              <input
                type="radio"
                name="editor"
                value={id}
                checked={editor === id}
                onChange={(e) => {
                  if (isEditor(e.currentTarget.value)) setEditor(e.currentTarget.value);
                }}
              />
              {EDITORS[id].label}
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
