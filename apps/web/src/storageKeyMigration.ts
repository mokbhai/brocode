// FILE: storageKeyMigration.ts
// Purpose: Migrates legacy browser storage keys to the BroCode namespace.
// Layer: Web bootstrap utility
// Exports: migrateBroCodeLocalStorageKeys

const STORAGE_KEY_MIGRATIONS = [
  ["t3code:renderer-state:v8", "brocode:renderer-state:v8"],
  ["dpcode:renderer-state:v8", "brocode:renderer-state:v8"],
  ["t3code:composer-drafts:v1", "brocode:composer-drafts:v1"],
  ["dpcode:composer-drafts:v1", "brocode:composer-drafts:v1"],
  ["t3code:split-view-state:v1", "brocode:split-view-state:v1"],
  ["dpcode:split-view-state:v1", "brocode:split-view-state:v1"],
  ["t3code:sidebar-ui:v1", "brocode:sidebar-ui:v1"],
  ["dpcode:sidebar-ui:v1", "brocode:sidebar-ui:v1"],
  ["t3code:single-chat-panel-state:v1", "brocode:single-chat-panel-state:v1"],
  ["dpcode:single-chat-panel-state:v1", "brocode:single-chat-panel-state:v1"],
  ["t3code:terminal-state:v1", "brocode:terminal-state:v1"],
  ["dpcode:terminal-state:v1", "brocode:terminal-state:v1"],
  ["t3code:latest-project:v1", "brocode:latest-project:v1"],
  ["dpcode:latest-project:v1", "brocode:latest-project:v1"],
  ["t3code:app-settings:v1", "brocode:app-settings:v1"],
  ["dpcode:app-settings:v1", "brocode:app-settings:v1"],
  ["t3code:pinned-threads:v1", "brocode:pinned-threads:v1"],
  ["dpcode:pinned-threads:v1", "brocode:pinned-threads:v1"],
  ["t3code:browser-state:v1", "brocode:browser-state:v1"],
  ["dpcode:browser-state:v1", "brocode:browser-state:v1"],
  ["t3code:workspace-pages:v2", "brocode:workspace-pages:v2"],
  ["dpcode:workspace-pages:v2", "brocode:workspace-pages:v2"],
  ["t3code:theme", "brocode:theme"],
  ["dpcode:theme", "brocode:theme"],
  ["t3code:last-editor", "brocode:last-editor"],
  ["dpcode:last-editor", "brocode:last-editor"],
  ["t3code:last-invoked-script-by-project", "brocode:last-invoked-script-by-project"],
  ["dpcode:last-invoked-script-by-project", "brocode:last-invoked-script-by-project"],
] as const;

export function migrateBroCodeLocalStorageKeys(): void {
  // Prefer globalThis.localStorage so this works identically in browsers (where
  // globalThis === window) and in node-based unit tests that stub the global.
  let storage: Storage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    return;
  }
  if (!storage) {
    return;
  }

  try {
    for (const [legacyKey, nextKey] of STORAGE_KEY_MIGRATIONS) {
      if (storage.getItem(nextKey) !== null) {
        continue;
      }
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue !== null) {
        storage.setItem(nextKey, legacyValue);
      }
    }
  } catch {
    // Storage can be unavailable in private/sandboxed contexts; the app should still boot.
  }
}

// Run during bootstrap before stores hydrate from localStorage.
migrateBroCodeLocalStorageKeys();
