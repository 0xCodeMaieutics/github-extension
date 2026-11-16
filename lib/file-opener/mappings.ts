import { browser } from "wxt/browser"

/** `owner/name` (lowercase) → absolute local repository root. */
export type RepositoryMappings = Record<string, string>

const STORAGE_KEY = "repositoryMappings"

export async function getRepositoryMappings(): Promise<RepositoryMappings> {
  const stored = await browser.storage.local.get(STORAGE_KEY)
  const value = stored[STORAGE_KEY]
  return value && typeof value === "object" ? (value as RepositoryMappings) : {}
}

export async function getRepositoryMapping(key: string): Promise<string | undefined> {
  return (await getRepositoryMappings())[key]
}

export async function setRepositoryMapping(key: string, localRoot: string): Promise<void> {
  const mappings = await getRepositoryMappings()
  mappings[key] = localRoot
  await browser.storage.local.set({ [STORAGE_KEY]: mappings })
}

export async function deleteRepositoryMapping(key: string): Promise<void> {
  const mappings = await getRepositoryMappings()
  delete mappings[key]
  await browser.storage.local.set({ [STORAGE_KEY]: mappings })
}
