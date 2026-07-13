# Desin Inspector

Local web inspector for selection, style preview, notes, and copyable Change Bundles.

## Install in a Vite React project

Install the single public package in the website where you want to use the inspector:

```bash
npm install @design-bypupila/inspector
```

Add the Vite plugin to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { desinInspectorVite } from "@design-bypupila/inspector/vite";

export default defineConfig({
  plugins: [react(), desinInspectorVite()],
});
```

Initialize the inspector only in development, usually in `src/main.tsx`:

```ts
import { initDesinInspector } from "@design-bypupila/inspector";
import { createProjectStorage } from "@design-bypupila/inspector/vite/client";
import { getReactSourceInfo } from "@design-bypupila/inspector/react";

if (import.meta.env.DEV) {
  initDesinInspector({
    framework: "react",
    storage: createProjectStorage(),
    sourceResolver: getReactSourceInfo,
  });
}
```

The inspector is development-only when guarded by `import.meta.env.DEV`. The Vite plugin stores project comments in:

```txt
.desin-inspector/state.json
```

Keep `.desin-inspector` ignored if comments are local working notes. Commit selected files from that folder only if the team intentionally wants to share review state through the repository.

## Package release

Run the full local release validation before publishing:

```bash
npm run release:dry-run
```

That command cleans previous builds, rebuilds all workspaces, runs TypeScript checks, and verifies the publishable package contents for:

- `@design-bypupila/inspector` - paquete público único con runtime, Vite y React

Publish after npm login and after confirming the package scope:

```bash
npm login
npm run release:publish
```

The packages are configured with `publishConfig.access: "public"`. If the packages must be private, change `publishConfig.access` to `restricted` in each package before publishing and confirm the npm organization supports private scoped packages.

## Updating installed websites

For the first launch, update websites through normal dependency updates:

```bash
npm update @design-bypupila/inspector
```

The recommended automatic path is controlled automation, not silent production changes:

1. Publish a new package version.
2. Let Dependabot or Renovate open dependency update PRs in each website.
3. Run build/typecheck for each site.
4. Merge the PR after visual verification in development.

This keeps updates fast without pushing inspector changes into several pages without review.

## Change bundle format

The copied instruction bundle is intentionally structured for LLM editing workflows:

- `Instruction` keeps the user text and inline element badges.
- `Context` records the route, breakpoint scope, exact target count, reference contract, and safe change boundary. This prevents an editing agent from treating captured HTML or screen coordinates as implementation instructions.
- `Selected elements` expands each target with DOM path, parent path, position, component, and HTML.
- `Structure` summarizes the shared ancestor, layout, DOM order, and sibling context when more than one element is selected.
- `Adjustments` stays focused on the style diffs or extracted rules.
- Copying from the inspector menu exports all saved comments for the current route as one message, separated by comment. Copying an individual saved comment also includes its target mapping and structural context, rather than copying unresolved `[E#]` tokens alone.
- If any saved comment has no breakpoint scope, the inspector opens that comment so the breakpoint can be defined before copying.
- Clipboard writes use the modern Clipboard API with a local fallback for development contexts where clipboard permissions are restricted.

## Interaction behavior

- Selecting an element inserts its inline badge and leaves the instruction editor focused with the caret after the badge, so typing can continue immediately.
- Inspector state saves are coalesced to avoid repeated server/file writes during rapid style changes, typing, pointer movement, or scrolling.
- The editor keeps native spelling assistance enabled and exposes a textbox label for assistive technology.

## Structure

- `packages/inspector` - core overlay runtime
- `packages/inspector-vite` - Vite dev-server storage plugin
- `packages/inspector-react` - React source metadata adapter
- `examples/vite-react` - validation app

## Local validation

Use the example app when changing inspector behavior:

```bash
npm install
npm run dev
```

Use these checks before release:

```bash
npm run check
npm run build
npm run release:dry-run
```
