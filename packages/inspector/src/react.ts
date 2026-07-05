import type { SourceInfo } from "./types";

type FiberNode = {
  return: FiberNode | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
  type?: unknown;
  elementType?: unknown;
  displayName?: string;
  name?: string;
};

function getFiberKey(element: Element): string | null {
  const record = element as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith("__reactFiber$")) {
      return key;
    }
  }
  return null;
}

function getDisplayName(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { displayName?: string; name?: string };
  return candidate.displayName ?? candidate.name ?? null;
}

function getFiber(element: Element): FiberNode | null {
  const key = getFiberKey(element);
  if (!key) {
    return null;
  }

  const record = element as unknown as Record<string, unknown>;
  const fiber = record[key] as FiberNode | undefined;
  return fiber ?? null;
}

export function getReactSourceInfo(element: Element): SourceInfo | null {
  let current = getFiber(element);

  while (current) {
    const source = current._debugSource;
    const componentName = getDisplayName(current.type) ?? getDisplayName(current.elementType);

    if (source?.fileName) {
      return {
        filePath: source.fileName,
        lineNumber: source.lineNumber ?? null,
        componentName,
      };
    }

    current = current.return;
  }

  return null;
}

export function getReactStackContext(element: Element): string[] {
  const stack: string[] = [];
  let current = getFiber(element);

  while (current) {
    const name = getDisplayName(current.type) ?? getDisplayName(current.elementType);
    if (name && name !== "Fragment") {
      stack.push(name);
    }

    current = current.return;
  }

  return stack;
}
