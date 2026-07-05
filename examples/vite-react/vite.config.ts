import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { desinInspectorVite } from "@desin-ai/inspector-vite";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), desinInspectorVite()],
  resolve: {
    alias: {
      "@desin-ai/inspector": path.resolve(rootDir, "packages/inspector/src/index.ts"),
      "@desin-ai/inspector-vite/client": path.resolve(rootDir, "packages/inspector-vite/src/client.ts"),
      "@desin-ai/inspector-react": path.resolve(rootDir, "packages/inspector-react/src/index.ts"),
    },
  },
});
