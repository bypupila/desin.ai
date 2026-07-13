import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import type { PersistedInspectorState } from "../types";

export { createProjectStorage } from "./client";

const DEFAULT_ROUTE = "/__desin-inspector/state";

async function ensureDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile(filePath: string): Promise<PersistedInspectorState | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PersistedInspectorState;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, state: PersistedInspectorState): Promise<void> {
  await ensureDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export interface DesinInspectorViteOptions {
  stateFile?: string;
  route?: string;
}

export function desinInspectorVite(options: DesinInspectorViteOptions = {}): Plugin {
  const route = options.route ?? DEFAULT_ROUTE;
  return {
    name: "desin-inspector-vite",
    enforce: "pre",
    configureServer(server) {
      const filePath = path.resolve(server.config.root, options.stateFile ?? ".desin-inspector/state.json");
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(route)) {
          next();
          return;
        }
        if (req.method === "GET") {
          const state = await readJsonFile(filePath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ state }));
          return;
        }
        if (req.method === "POST") {
          const parsed = JSON.parse(await readRequestBody(req)) as { state?: PersistedInspectorState };
          if (parsed.state) await writeJsonFile(filePath, parsed.state);
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    },
  };
}
