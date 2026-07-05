import type { InspectorStorage, PersistedInspectorState } from "../../inspector/src/types";

const DEFAULT_ROUTE = "/__desin-inspector/state";

export function createProjectStorage(options: { route?: string; fallbackKey?: string } = {}): InspectorStorage {
  const route = options.route ?? DEFAULT_ROUTE;
  const fallbackKey = options.fallbackKey ?? "desin-inspector-state";

  return {
    async load() {
      if (typeof window === "undefined") {
        return null;
      }

      try {
        const response = await fetch(route);
        if (!response.ok) {
          throw new Error("failed to read inspector state");
        }
        const payload = (await response.json()) as { state?: PersistedInspectorState | null };
        return payload.state ?? null;
      } catch {
        const raw = window.localStorage.getItem(fallbackKey);
        return raw ? (JSON.parse(raw) as PersistedInspectorState) : null;
      }
    },
    async save(state) {
      if (typeof window === "undefined") {
        return;
      }

      try {
        await fetch(route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
        });
      } catch {
        window.localStorage.setItem(fallbackKey, JSON.stringify(state));
      }
    },
  };
}
