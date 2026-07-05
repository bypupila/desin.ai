import type { InspectorStorage, PersistedInspectorState } from "./types";

const STORAGE_KEY = "desin-inspector-state";

export function createLocalStorageStorage(key = STORAGE_KEY): InspectorStorage {
  return {
    load() {
      if (typeof window === "undefined") {
        return null;
      }

      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as PersistedInspectorState;
      } catch {
        return null;
      }
    },
    save(state) {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.setItem(key, JSON.stringify(state));
    },
  };
}

export function createNoopStorage(): InspectorStorage {
  return {
    load() {
      return null;
    },
    save() {
      return;
    },
  };
}
