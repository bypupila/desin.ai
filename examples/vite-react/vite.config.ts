import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { desinInspectorVite } from "@design-bypupila/inspector/vite";

export default defineConfig({
  plugins: [react(), desinInspectorVite()],
});
