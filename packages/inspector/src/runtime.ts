import {
  buildDomPath,
  buildElementSnapshot,
  buildStructureContext,
  captureComputedStyles,
  getTextPreview,
  renderChangeBundle,
  renderReferenceDetails,
  serializeComposerHtml,
} from "./bundle";
import { gsap } from "gsap";
import type {
  BreakpointRange,
  ChangeBundlePayload,
  InspectorAPI,
  InspectorMode,
  InspectorOptions,
  InspectorState,
  InspectorNote,
  NoteReference,
  InspectorStorage,
  InspectorTheme,
  RectLike,
  SelectionTarget,
  StyleDraft,
  StyleScope,
} from "./types";
import { createLocalStorageStorage, createNoopStorage } from "./storage";

const DEFAULT_BREAKPOINTS: BreakpointRange[] = [
  { name: "mobile", min: 0, max: 639 },
  { name: "tablet", min: 640, max: 1023 },
  { name: "desktop", min: 1024 },
];

const DEFAULT_THEME: InspectorTheme = {
  accent: "#111111",
  accentSoft: "rgba(17, 17, 17, 0.06)",
  accentMuted: "#787774",
};

const IDEA_CATEGORIES = [
  { id: "ux", label: "UX" },
  { id: "content", label: "Contenido" },
  { id: "seo", label: "SEO" },
  { id: "conversion", label: "Conversion" },
  { id: "performance", label: "Performance" },
  { id: "accessibility", label: "Accesibilidad" },
  { id: "visual", label: "Visual" },
  { id: "platform", label: "Plataforma" },
] as const;

const DEFAULT_IDEA_CATEGORY = IDEA_CATEGORIES[0]?.id ?? "ux";

const PREVIEW_PROPERTIES = [
  "width",
  "height",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "background-color",
  "color",
  "border-radius",
  "font-size",
  "font-weight",
  "gap",
  "line-height",
  "letter-spacing",
] as const;

const STYLE_LABELS: Record<string, string> = {
  width: "width",
  height: "height",
  padding: "padding",
  "padding-top": "padding top",
  "padding-right": "padding right",
  "padding-bottom": "padding bottom",
  "padding-left": "padding left",
  margin: "margin",
  "background-color": "background",
  color: "text color",
  "border-radius": "radius",
  "font-size": "font size",
  "font-weight": "weight",
  gap: "Gap",
  "line-height": "Line height",
  "letter-spacing": "tracking",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function uid(prefix = "desin"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getDocumentElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll("body *")).filter(isVisible);
}

function intersects(a: RectLike, b: RectLike): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function rectFromDom(rect: DOMRect): RectLike {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function normalizeScope(scope: StyleScope | undefined): StyleScope {
  if (!scope) {
    return { mode: "global", breakpoints: [] };
  }

  return {
    mode: scope.mode,
    breakpoints: [...scope.breakpoints],
  };
}

function scopeLabel(scope: StyleScope): string {
  if (scope.breakpoints.length === 0) {
    return "none selected";
  }

  return scope.mode === "global" ? "global" : scope.breakpoints.join(", ");
}

function hasActiveBreakpointScope(scope: StyleScope): boolean {
  return scope.breakpoints.length > 0;
}

function emptyBreakpointScope(): StyleScope {
  return { mode: "global", breakpoints: [] };
}

function resolveViewportBreakpoint(
  ranges: BreakpointRange[],
  width: number = window.innerWidth,
): string {
  const match = ranges.find((range) => {
    const withinMin = width >= range.min;
    const withinMax = range.max === undefined ? true : width <= range.max;
    return withinMin && withinMax;
  });

  return match?.name ?? "desktop";
}

function pickPopoverPosition(bounds: RectLike): { x: number; y: number } {
  const padding = 16;
  const width = 360;
  const height = 332;
  const preferredX = bounds.x + bounds.width + 14;
  const preferredY = bounds.y - 8;

  const x = clamp(preferredX, padding, window.innerWidth - width - padding);
  const y = clamp(preferredY, padding, window.innerHeight - height - padding);
  return { x, y };
}

function getElementTextPreview(element: Element): string {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function selectorToLabel(selector: string): string {
  if (selector.length <= 36) {
    return selector;
  }
  return `${selector.slice(0, 33)}...`;
}

function shortenDomPath(path: string): string {
  const segments = path.split(" > ").filter(Boolean);
  if (segments.length <= 2) {
    return selectorToLabel(path);
  }

  return `... > ${segments.slice(-2).join(" > ")}`;
}

function inferTagNameFromSelector(selector: string): string {
  const match = selector.match(/^[a-z0-9-]+/i);
  return match?.[0]?.toLowerCase() ?? "div";
}

function compactElementSummary(selection: SelectionTarget): string {
  return selection.tagName;
}

function createNoteReference(selection: SelectionTarget): NoteReference {
  return {
    selector: selection.selector,
    domPath: selection.domPath,
    label: compactElementSummary(selection),
    tagName: selection.tagName,
    rect: selection.rect,
    componentName: selection.componentName ?? null,
    source: selection.source ?? null,
    outerHTML: selection.outerHTML,
  };
}

function fallbackNoteReference(note: Pick<InspectorNote, "selector" | "source">): NoteReference {
  return {
    selector: note.selector,
    domPath: note.selector,
    label: note.source?.componentName ? note.source.componentName : selectorToLabel(note.selector),
    tagName: inferTagNameFromSelector(note.selector),
    componentName: note.source?.componentName ?? null,
    source: note.source ?? null,
  };
}

function normalizeNoteReferences(note: InspectorNote): NoteReference[] {
  if (note.references && note.references.length > 0) {
    return note.references;
  }

  return [fallbackNoteReference(note)];
}

function editorHtmlToPlainText(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const styleTokens = Array.from(container.querySelectorAll<HTMLElement>('[data-note-token="true"][data-style-instruction]'));
  for (const token of styleTokens) {
    token.replaceWith(document.createTextNode(token.dataset.styleInstruction ?? ""));
  }
  container.querySelectorAll('[data-note-token="true"], .desin-badge').forEach((element) => element.remove());
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

function cleanInstructionText(html: string): string {
  return editorHtmlToPlainText(html).replace(/\s{2,}/g, " ").trim();
}

function createFragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.cloneNode(true) as DocumentFragment;
}

function getComputedPreviewValue(element: Element, property: string): string {
  const value = window.getComputedStyle(element).getPropertyValue(property).trim();
  return value || "";
}

function querySelectorAllSafe(selector: string): HTMLElement[] {
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function rectDistance(a: RectLike, b: RectLike): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.width - b.width) +
    Math.abs(a.height - b.height)
  );
}

function findElementForSnapshot(selection: Pick<SelectionTarget, "selector" | "domPath" | "rect" | "text">): HTMLElement | null {
  const allElements = getDocumentElements();
  const byDomPath = allElements.find((element) => buildDomPath(element) === selection.domPath);
  if (byDomPath) {
    return byDomPath;
  }

  const selectorMatches = querySelectorAllSafe(selection.selector);
  if (selectorMatches.length === 1) {
    const onlyMatch = selectorMatches[0] ?? null;
    if (!onlyMatch) {
      return null;
    }
    const distance = rectDistance(rectFromDom(onlyMatch.getBoundingClientRect()), selection.rect);
    return distance < 8 ? onlyMatch : null;
  }

  const candidates = selectorMatches.length > 0 ? selectorMatches : allElements;
  const sortedByRect = candidates
    .map((element) => ({ element, distance: rectDistance(rectFromDom(element.getBoundingClientRect()), selection.rect) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = sortedByRect[0];
  return nearest && nearest.distance < 8 ? nearest.element : null;
}

function selectorForNote(note: { selector: string; references?: NoteReference[] }): Element | null {
  const reference = note.references?.[0];
  if (reference?.domPath && reference.rect) {
    return findElementForSnapshot({
      selector: reference.selector,
      domPath: reference.domPath,
      rect: reference.rect,
      text: reference.label,
    });
  }

  return querySelectorAllSafe(note.selector)[0] ?? null;
}

function parseNumericStyleValue(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumericStyleValue(property: string, value: number): string {
  if (property === "line-height") {
    return (value / 100).toFixed(2).replace(/\.00$/, "");
  }

  return `${Math.round(value)}px`;
}

function colorToHex(value: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    return `#${normalized
      .slice(1)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`
      .toLowerCase();
  }

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }

  const match = normalized.match(/rgba?\(([^)]+)\)/i);
  if (!match) {
    return "#111111";
  }

  const rgbParts = (match[1] ?? "")
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseInt(part.trim(), 10));
  const [r = 17, g = 17, b = 17] = rgbParts;

  const hex = [r, g, b]
    .map((component) => {
      const safe = clamp(Number.isFinite(component) ? component : 17, 0, 255);
      return safe.toString(16).padStart(2, "0");
    })
    .join("");
  return `#${hex}`;
}

function getSliderConfig(property: string) {
  switch (property) {
    case "width":
    case "height":
      return { min: 0, max: 960, step: 1 };
    case "padding":
    case "margin":
      return { min: 0, max: 72, step: 1 };
    case "padding-top":
    case "padding-right":
    case "padding-bottom":
    case "padding-left":
      return { min: 0, max: 72, step: 1 };
    case "border-radius":
      return { min: 0, max: 56, step: 1 };
    case "font-size":
      return { min: 10, max: 52, step: 1 };
    case "gap":
      return { min: 0, max: 48, step: 1 };
    case "line-height":
      return { min: 100, max: 240, step: 1 };
    case "letter-spacing":
      return { min: -4, max: 12, step: 0.1 };
    default:
      return { min: 0, max: 100, step: 1 };
  }
}

function isColorProperty(property: string): boolean {
  return property === "background-color" || property === "color";
}

function isSliderProperty(property: string): boolean {
  return (
    property === "width" ||
    property === "height" ||
    property === "padding" ||
    property === "margin" ||
    property === "padding-top" ||
    property === "padding-right" ||
    property === "padding-bottom" ||
    property === "padding-left" ||
    property === "border-radius" ||
    property === "font-size" ||
    property === "gap" ||
    property === "line-height" ||
    property === "letter-spacing"
  );
}

const TYPOGRAPHY_EXTRACTION_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "font-style",
];

const COLOR_EXTRACTION_PROPERTIES = [
  "color",
  "background-color",
  "border-color",
  "fill",
  "stroke",
];

const SIZE_EXTRACTION_PROPERTIES = [
  "width",
  "height",
  "min-width",
  "max-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-radius",
  "gap",
];

function getExtractionProperties(kind: "typography" | "color" | "size" | "all"): string[] {
  switch (kind) {
    case "typography":
      return TYPOGRAPHY_EXTRACTION_PROPERTIES;
    case "color":
      return COLOR_EXTRACTION_PROPERTIES;
    case "size":
      return SIZE_EXTRACTION_PROPERTIES;
    case "all":
      return Array.from(
        new Set([
          ...TYPOGRAPHY_EXTRACTION_PROPERTIES,
          ...COLOR_EXTRACTION_PROPERTIES,
          ...SIZE_EXTRACTION_PROPERTIES,
          ...PREVIEW_PROPERTIES,
        ]),
      );
    default:
      return [];
  }
}

function formatExtractionSummary(kind: "typography" | "color" | "size" | "all", styles: Record<string, string>): string {
  const parts: string[] = [];
  const pushGroup = (label: string, properties: string[]) => {
    const values = properties
      .map((property) => [property, styles[property]] as const)
      .filter(([, value]) => Boolean(value))
      .map(([property, value]) => `${property}: ${value}`);
    if (values.length > 0) {
      parts.push(`${label}: ${values.join(" · ")}`);
    }
  };

  if (kind === "all") {
    pushGroup("Typography", TYPOGRAPHY_EXTRACTION_PROPERTIES);
    pushGroup("Color", COLOR_EXTRACTION_PROPERTIES);
    pushGroup("Size", SIZE_EXTRACTION_PROPERTIES);
    const remainder = Object.entries(styles)
      .filter(([property]) => !getExtractionProperties("all").includes(property))
      .map(([property, value]) => `${property}: ${value}`);
    if (remainder.length > 0) {
      parts.push(`Other: ${remainder.join(" · ")}`);
    }
    return parts.join(" | ");
  }

  pushGroup(kind === "typography" ? "Typography" : kind === "color" ? "Color" : "Size", getExtractionProperties(kind));
  return parts.join(" | ");
}

class DesinInspectorRuntime {
  private readonly options: Required<
    Pick<InspectorOptions, "enabled" | "framework">
  > &
    InspectorOptions;

  private readonly storage: InspectorStorage;
  private readonly breakpoints: BreakpointRange[];
  private readonly theme: InspectorTheme;
  private readonly root: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly styleElement: HTMLStyleElement;
  private readonly state: InspectorState;
  private readonly originalInlineStyles = new WeakMap<HTMLElement, Map<string, string>>();
  private readonly noteLookup = new Map<string, HTMLElement>();
  private disposed = false;
  private renderQueued = false;
  private hiddenHandle: HTMLButtonElement | null = null;
  private overlayHost: HTMLElement | null = null;
  private lastActiveElement: HTMLElement | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private readonly handlePointerMove = (event: PointerEvent) => this.onPointerMove(event);
  private readonly handlePointerDown = (event: PointerEvent) => this.onPointerDown(event);
  private readonly handlePointerUp = (event: PointerEvent) => this.onPointerUp(event);
  private readonly handleKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
  private readonly handleResize = () => this.scheduleRender();
  private readonly handleScroll = () => this.scheduleRender();
  private readonly handleSelectionChange = () => this.onSelectionChange();
  private readonly handleClick = (event: Event) => this.onClick(event as MouseEvent);
  private readonly handleInput = (event: Event) => this.onInput(event);
  private readonly handleChange = (event: Event) => this.onChange(event);
  private readonly handleFocusOut = (event: Event) => this.onFocusOut(event as FocusEvent);
  private readonly handlePaste = (event: Event) => this.onPaste(event as ClipboardEvent);
  private readonly handleDragStart = (event: Event) => this.onDragStart(event as DragEvent);
  private readonly handleDragOver = (event: Event) => this.onDragOver(event as DragEvent);
  private readonly handleDrop = (event: Event) => this.onDrop(event as DragEvent);
  private readonly handleDragEnd = () => this.onDragEnd();
  private readonly handleNotePointerDown = (event: Event) => this.onNotePointerDown(event as PointerEvent);
  private readonly handleNotePointerUp = (event: Event) => this.onNotePointerUp(event as PointerEvent);
  private readonly handleNotePointerOver = (event: Event) => this.onNotePointerOver(event as PointerEvent);
  private readonly handleNotePointerOut = (event: Event) => this.onNotePointerOut(event as PointerEvent);
  private toastTimeout: number | null = null;
  private noteHoverTimeout: number | null = null;
  private noteEditorRange: Range | null = null;
  private draggedNoteElement: HTMLElement | null = null;
  private lastOverlayAnimationKey = "";
  private hoveredNoteId: string | null = null;
  private composerFocusPending = false;
  private colorPickerActive = false;
  private renderPendingAfterColorPicker = false;
  private colorPickerReleaseTimer: number | null = null;
  private breakpointWarningVisible = false;

  constructor(options: InspectorOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      framework: options.framework ?? "auto",
      ...options,
    };
    this.breakpoints = options.breakpoints ?? DEFAULT_BREAKPOINTS;
    this.theme = {
      ...DEFAULT_THEME,
      ...(options.theme ?? {}),
    };
    this.storage = options.storage ?? createLocalStorageStorage();
    this.state = {
      hidden: false,
      collapsed: true,
      extractCollapsed: false,
      active: Boolean(this.options.enabled),
      mode: "idle",
      stylePanel: "edit",
      activeSelectionId: null,
      activeNoteId: null,
      activeIdeaCategory: DEFAULT_IDEA_CATEGORY,
      ideasCollapsed: true,
      scope: { mode: "global", breakpoints: [] },
      hoverTarget: null,
      selections: [],
      notes: [],
      drafts: [],
      toast: null,
      dragRect: null,
      pointerMode: "idle",
      activeNoteText: "",
      bundleText: "",
    };
    this.root = document.createElement("div");
    this.root.className = "desin-inspector-root";
    this.shadow = this.root.attachShadow({ mode: "open" });
    this.styleElement = document.createElement("style");
    this.shadow.appendChild(this.styleElement);
    this.shadow.appendChild(document.createElement("div"));
    this.overlayHost = null;
    this.injectStyles();
    this.bindEvents();
    this.restorePersistedState();
    this.mount();
  }

  private mount(): void {
    if (document.body.contains(this.root)) {
      return;
    }

    document.body.appendChild(this.root);
    this.render();
  }

  private bindEvents(): void {
    document.addEventListener("pointermove", this.handlePointerMove, true);
    document.addEventListener("pointerdown", this.handlePointerDown, true);
    document.addEventListener("pointerup", this.handlePointerUp, true);
    document.addEventListener("selectionchange", this.handleSelectionChange, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
    document.addEventListener("scroll", this.handleScroll, { passive: true, capture: true });
    window.addEventListener("resize", this.handleResize, { passive: true });
    window.addEventListener("scroll", this.handleScroll, { passive: true });
    this.shadow.addEventListener("click", this.handleClick);
    this.shadow.addEventListener("input", this.handleInput);
    this.shadow.addEventListener("change", this.handleChange);
    this.shadow.addEventListener("focusout", this.handleFocusOut);
    this.shadow.addEventListener("paste", this.handlePaste);
    this.shadow.addEventListener("dragstart", this.handleDragStart);
    this.shadow.addEventListener("dragover", this.handleDragOver);
    this.shadow.addEventListener("drop", this.handleDrop);
    this.shadow.addEventListener("dragend", this.handleDragEnd);
    this.shadow.addEventListener("pointerdown", this.handleNotePointerDown as EventListener, true);
    this.shadow.addEventListener("pointerup", this.handleNotePointerUp as EventListener, true);
    this.shadow.addEventListener("pointerover", this.handleNotePointerOver);
    this.shadow.addEventListener("pointerout", this.handleNotePointerOut);
  }

  private unbindEvents(): void {
    document.removeEventListener("pointermove", this.handlePointerMove, true);
    document.removeEventListener("pointerdown", this.handlePointerDown, true);
    document.removeEventListener("pointerup", this.handlePointerUp, true);
    document.removeEventListener("selectionchange", this.handleSelectionChange, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    document.removeEventListener("scroll", this.handleScroll, true);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("scroll", this.handleScroll);
    this.shadow.removeEventListener("click", this.handleClick);
    this.shadow.removeEventListener("input", this.handleInput);
    this.shadow.removeEventListener("change", this.handleChange);
    this.shadow.removeEventListener("focusout", this.handleFocusOut);
    this.shadow.removeEventListener("paste", this.handlePaste);
    this.shadow.removeEventListener("dragstart", this.handleDragStart);
    this.shadow.removeEventListener("dragover", this.handleDragOver);
    this.shadow.removeEventListener("drop", this.handleDrop);
    this.shadow.removeEventListener("dragend", this.handleDragEnd);
    this.shadow.removeEventListener("pointerdown", this.handleNotePointerDown as EventListener, true);
    this.shadow.removeEventListener("pointerup", this.handleNotePointerUp as EventListener, true);
    this.shadow.removeEventListener("pointerover", this.handleNotePointerOver);
    this.shadow.removeEventListener("pointerout", this.handleNotePointerOut);
  }

  private injectStyles(): void {
    this.styleElement.textContent = `
      :host, .desin-inspector-root {
        all: initial;
      }

      .desin-shell {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
        font-family: "SF Pro Display", "Geist Sans", "Helvetica Neue", "Segoe UI", sans-serif;
        color: #111111;
      }

      .desin-shell * {
        box-sizing: border-box;
      }

      .desin-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
      }

      .desin-outline {
        position: absolute;
        border: 1px solid rgba(17, 17, 17, 0.8);
        background: rgba(255, 255, 255, 0.03);
        border-radius: 8px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45) inset;
        pointer-events: none;
      }

      .desin-outline__label {
        position: absolute;
        left: 0;
        top: -27px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(17, 17, 17, 0.08);
        color: #111111;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        pointer-events: none;
      }

      .desin-outline__label strong {
        font-weight: 600;
      }

      .desin-note-pin {
        position: absolute;
        min-width: 28px;
        max-width: min(320px, calc(100vw - 24px));
        pointer-events: auto;
        transform: translateZ(0);
        z-index: 2147483647;
      }

      .desin-note-pin[data-done="true"] {
        opacity: 0.72;
      }

      .desin-note-pin__stack {
        display: grid;
        justify-items: start;
        gap: 4px;
        max-width: min(320px, calc(100vw - 24px));
      }

      .desin-note-pin__summary {
        display: inline-flex;
        align-items: flex-start;
        gap: 8px;
        max-width: min(320px, calc(100vw - 24px));
        padding: 7px 10px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(255, 255, 255, 0.96);
        color: #111111;
        font: inherit;
        font-size: 11px;
        line-height: 1.35;
        cursor: pointer;
        text-align: left;
        white-space: normal;
      }

      .desin-note-pin__badge,
      .desin-note-reference-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9999px;
        background: #1f6c9f;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.04em;
        flex: 0 0 auto;
      }

      .desin-note-edit-icon {
        display: none;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        background: #111111;
        color: #ffffff;
        flex: 0 0 auto;
      }

      .desin-note-pin[data-hovered="true"] .desin-note-edit-icon,
      .desin-note-pin:focus-within .desin-note-edit-icon {
        display: inline-flex;
      }

      .desin-note-pin__content {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .desin-note-quick-actions {
        display: none;
        align-items: center;
        gap: 4px;
        justify-self: start;
        padding: 3px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 6px 16px rgba(17, 17, 17, 0.06);
      }

      .desin-note-pin[data-hovered="true"] .desin-note-quick-actions,
      .desin-note-pin:focus-within .desin-note-quick-actions {
        display: inline-flex;
      }

      .desin-note-quick-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
        color: #111111;
        cursor: pointer;
      }

      .desin-note-quick-button:hover {
        border-color: rgba(17, 17, 17, 0.18);
        background: #f7f6f3;
      }

      .desin-note-card__references {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .desin-note-content__text {
        display: inline;
      }

      .desin-note-card {
        position: fixed;
        left: var(--note-card-left, 12px);
        top: var(--note-card-top, 12px);
        display: none;
        width: var(--note-card-width, min(360px, calc(100vw - 24px)));
        max-height: calc(100vh - 24px);
        overflow: auto;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid rgba(17, 17, 17, 0.1);
        background: #ffffff;
        box-shadow: 0 12px 28px rgba(17, 17, 17, 0.08);
        color: #111111;
        font-size: 11px;
        line-height: 1.35;
        z-index: 2147483647;
      }

      .desin-note-pin[data-hovered="true"] .desin-note-card,
      .desin-note-pin:focus-within .desin-note-card {
        display: grid;
        gap: 8px;
      }

      .desin-note-edit {
        min-height: 44px;
        max-height: 120px;
        overflow: auto;
        padding: 7px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        border-radius: 7px;
        background: #fbfbfa;
        outline: none;
        font-size: 12px;
        line-height: 1.4;
      }

      .desin-note-meta {
        display: grid;
        gap: 4px;
        color: #787774;
      }

      .desin-note-meta div {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr);
        gap: 8px;
      }

      .desin-note-meta strong {
        color: #111111;
        font-weight: 600;
      }

      .desin-note-meta span {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .desin-note-meta pre {
        margin: 0;
        min-width: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 10px/1.4 "Geist Mono", "SFMono-Regular", "SF Mono", Consolas, monospace;
        color: #111111;
      }

      .desin-popover {
        position: fixed;
        width: 360px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        border: 1px solid rgba(17, 17, 17, 0.08);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 20px 40px rgba(17, 17, 17, 0.08);
        backdrop-filter: blur(14px);
        pointer-events: auto;
        overflow: hidden;
        z-index: 2147483647;
      }

      .desin-popover--dock {
        top: 120px;
        right: 18px;
        left: auto;
        bottom: auto;
      }

      .desin-popover__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 14px 10px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.06);
      }

      .desin-popover__title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .desin-popover__title strong {
        font-size: 13px;
        font-weight: 600;
      }

      .desin-popover__title span {
        font-size: 11px;
        color: #787774;
      }

      .desin-popover__body {
        padding: 12px 14px 14px;
        display: grid;
        gap: 12px;
        max-height: calc(100vh - 118px);
        overflow: auto;
      }

      .desin-row {
        display: grid;
        gap: 8px;
      }

      .desin-chat {
        display: grid;
        gap: 10px;
      }

      .desin-editor-wrap {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
      }

      .desin-editor {
        min-height: 140px;
        padding: 16px;
        border-radius: 12px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #fbfbfa;
        color: #111111;
        font-size: 18px;
        line-height: 1.45;
        outline: none;
        white-space: normal;
        word-break: break-word;
      }

      .desin-editor:empty::before {
        content: attr(data-placeholder);
        color: #787774;
      }

      .desin-bubble {
        display: grid;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #fbfbfa;
      }

      .desin-bubble--assistant {
        background: #ffffff;
      }

      .desin-bubble__title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: #787774;
      }

      .desin-bubble__title strong {
        color: #111111;
        font-weight: 600;
      }

      .desin-bubble__text {
        font-size: 12px;
        line-height: 1.45;
        color: #111111;
      }

      .desin-reference-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .desin-badge-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .desin-badge {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
        color: #111111;
        font-size: 11px;
        line-height: 1;
        cursor: default;
      }

      .desin-badge--editor {
        margin: 0 4px;
        vertical-align: middle;
        user-select: none;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .desin-badge--editor[data-active="true"] {
        background: #111111;
        border-color: #111111;
        color: #ffffff;
      }

      .desin-badge--style {
        background: #fbf3db;
        border-color: rgba(149, 100, 0, 0.24);
        color: #5f4200;
      }

      .desin-badge__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: #111111;
        color: #ffffff;
        flex: 0 0 auto;
      }

      .desin-badge__copy {
        display: grid;
        gap: 2px;
        text-align: left;
      }

      .desin-badge__copy strong {
        font-size: 11px;
        font-weight: 600;
      }

      .desin-badge__copy span {
        color: #787774;
      }

      .desin-badge__tooltip {
        position: absolute;
        left: 0;
        top: calc(100% + 8px);
        width: min(520px, calc(100vw - 48px));
        padding: 10px;
        border-radius: 14px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 40px rgba(17, 17, 17, 0.12);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-4px);
        transition: opacity 140ms ease, transform 140ms ease, visibility 140ms ease;
        pointer-events: none;
        z-index: 2;
      }

      .desin-badge:hover .desin-badge__tooltip,
      .desin-badge:focus-within .desin-badge__tooltip {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .desin-badge__tooltip-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: #787774;
        margin-bottom: 8px;
      }

      .desin-badge__tooltip-head strong {
        color: #111111;
        font-weight: 600;
      }

      .desin-badge__tooltip pre {
        margin: 0;
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font: 11px/1.45 "Geist Mono", "SFMono-Regular", "SF Mono", Consolas, monospace;
        color: #111111;
      }

      .desin-badge__tooltip code {
        display: block;
        margin-top: 8px;
        font: 11px/1.45 "Geist Mono", "SFMono-Regular", "SF Mono", Consolas, monospace;
        color: #787774;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .desin-reference-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 9px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
        color: #111111;
        font-size: 11px;
        line-height: 1;
      }

      .desin-reference-chip[data-active="true"] {
        background: #111111;
        color: #ffffff;
        border-color: #111111;
      }

      .desin-reference-chip code {
        font: inherit;
        color: #787774;
      }

      .desin-reference-chip[data-active="true"] code {
        color: rgba(255, 255, 255, 0.78);
      }

      .desin-reference-empty {
        font-size: 12px;
        color: #787774;
      }

      .desin-composer {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
      }

      .desin-row__label {
        font-size: 11px;
        color: #787774;
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }

      .desin-input,
      .desin-textarea {
        width: 100%;
        border: 1px solid rgba(17, 17, 17, 0.1);
        border-radius: 10px;
        background: #f7f6f3;
        color: #111111;
        font: inherit;
        font-size: 13px;
        padding: 10px 12px;
        outline: none;
      }

      .desin-textarea {
        min-height: 84px;
        resize: vertical;
      }

      .desin-chips,
      .desin-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .desin-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .desin-controls {
        display: grid;
        gap: 8px;
      }

      .desin-control {
        display: grid;
        gap: 8px;
        min-width: 168px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
      }

      .desin-control__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: #787774;
      }

      .desin-control__head strong {
        color: #111111;
        font-weight: 600;
      }

      .desin-control__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: #787774;
      }

      .desin-slider {
        width: 100%;
        appearance: none;
        height: 22px;
        background: transparent;
        cursor: pointer;
        touch-action: none;
      }

      .desin-slider-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 8px;
      }

      .desin-slider-reset {
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(17, 17, 17, 0.1);
        border-radius: 9999px;
        background: #ffffff;
        color: #111111;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        box-shadow: 0 1px 4px rgba(17, 17, 17, 0.08);
      }

      .desin-slider-reset:hover {
        background: rgba(17, 17, 17, 0.06);
      }

      .desin-slider::-webkit-slider-runnable-track {
        height: 6px;
        border-radius: 9999px;
        background: linear-gradient(90deg, rgba(17, 17, 17, 0.9), rgba(17, 17, 17, 0.18));
      }

      .desin-slider::-webkit-slider-thumb {
        appearance: none;
        width: 16px;
        height: 16px;
        margin-top: -5px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.12);
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(17, 17, 17, 0.12);
      }

      .desin-slider::-moz-range-track {
        height: 6px;
        border-radius: 9999px;
        background: linear-gradient(90deg, rgba(17, 17, 17, 0.9), rgba(17, 17, 17, 0.18));
      }

      .desin-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.12);
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(17, 17, 17, 0.12);
      }

      .desin-color-field {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .desin-icon-button--compact {
        width: 30px;
        height: 30px;
      }

      .desin-color-input {
        width: 34px;
        height: 34px;
        border: 1px solid rgba(17, 17, 17, 0.12);
        border-radius: 8px;
        background: transparent;
        padding: 0;
        cursor: pointer;
      }

      .desin-color-input::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      .desin-color-input::-webkit-color-swatch {
        border: 0;
        border-radius: 7px;
      }

      .desin-color-input::-moz-color-swatch {
        border: 0;
        border-radius: 7px;
      }

      .desin-chip,
      .desin-icon-button,
      .desin-primary-button,
      .desin-mini-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: #ffffff;
        color: #111111;
        border-radius: 10px;
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
      }

      .desin-chip:hover,
      .desin-icon-button:hover,
      .desin-primary-button:hover,
      .desin-mini-toggle:hover {
        transform: translateY(-1px);
        border-color: rgba(17, 17, 17, 0.16);
      }

      .desin-chip,
      .desin-mini-toggle {
        padding: 8px 10px;
      }

      .desin-chip[data-active="true"],
      .desin-mini-toggle[data-active="true"] {
        background: #111111;
        color: #ffffff;
        border-color: #111111;
      }

      .desin-chip:disabled,
      .desin-mini-toggle:disabled,
      .desin-primary-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
      }

      .desin-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        padding: 0;
      }

      .desin-icon-button--count {
        position: relative;
        overflow: visible;
      }

      .desin-icon-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 9999px;
        background: #111111;
        color: #ffffff;
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
        pointer-events: none;
      }

      .desin-primary-button {
        background: #111111;
        color: #ffffff;
        border-color: #111111;
        padding: 10px 12px;
      }

      .desin-kv {
        display: grid;
        gap: 6px;
        font-size: 12px;
      }

      .desin-kv__item {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 10px;
        border-radius: 10px;
        background: #fbfbfa;
        border: 1px solid rgba(17, 17, 17, 0.06);
      }

      .desin-kv__item span:last-child {
        color: #787774;
        text-align: right;
      }

      .desin-list {
        display: grid;
        gap: 8px;
        max-height: 180px;
        overflow: auto;
        padding-right: 2px;
      }

      .desin-note-row {
        display: grid;
        gap: 6px;
        padding: 10px;
        border-radius: 10px;
        background: #fbfbfa;
        border: 1px solid rgba(17, 17, 17, 0.06);
      }

      .desin-note-row__meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 11px;
        color: #787774;
      }

      .desin-note-content {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: flex-start;
        font-size: 12px;
        line-height: 1.45;
        color: #111111;
      }

      .desin-note-content[data-done="true"] {
        text-decoration: line-through;
        opacity: 0.72;
      }

      .desin-idea-panel {
        min-width: 0;
      }

      .desin-idea-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px 9px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
      }

      .desin-idea-head strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #4f4741;
        font-size: 13px;
        font-weight: 760;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .desin-idea-head span {
        flex: 0 0 auto;
        color: #5f574f;
        font-size: 12px;
        font-weight: 520;
        white-space: nowrap;
      }

      .desin-idea-composer {
        display: grid;
        gap: 0;
      }

      .desin-idea-selection {
        margin-right: auto;
        color: #787774;
        font-size: 11px;
      }

      .desin-idea-board {
        display: grid;
        gap: 0;
        max-height: 220px;
        overflow: auto;
      }

      .desin-idea-group {
        display: grid;
        gap: 0;
        padding: 8px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
      }

      .desin-idea-group__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 0 0 7px;
        color: #787774;
        font-size: 11px;
      }

      .desin-idea-group__head strong {
        color: #111111;
        font-size: 11px;
        font-weight: 680;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .desin-idea-list {
        display: grid;
        gap: 5px;
      }

      .desin-idea-row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) 24px;
        align-items: center;
        gap: 7px;
        min-height: 40px;
        padding: 6px 7px;
        border-radius: 8px;
        background: #f7f2ee;
      }

      .desin-idea-row[data-done="true"] .desin-idea-copy span {
        text-decoration: line-through;
        color: #6f675f;
      }

      .desin-idea-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 9999px;
        border: 1.5px solid #9a928a;
        background: transparent;
        color: #0f9f5f;
        cursor: pointer;
      }

      .desin-idea-row[data-done="true"] .desin-idea-check {
        border-color: #0fbd6b;
      }

      .desin-idea-copy {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: #111111;
        font: inherit;
        font-size: 12px;
        line-height: 1.35;
        text-align: left;
        cursor: pointer;
      }

      .desin-idea-copy span {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .desin-idea-copy small {
        color: #787774;
        font-size: 10px;
        white-space: nowrap;
      }

      .desin-capsule {
        position: fixed;
        left: 50%;
        right: auto;
        bottom: 18px;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 14px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 16px 30px rgba(17, 17, 17, 0.08);
        backdrop-filter: blur(14px);
        pointer-events: auto;
        z-index: 2147483647;
      }

      .desin-capsule__badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px 0 4px;
        height: 34px;
        border-radius: 9999px;
        background: #f7f6f3;
        border: 1px solid rgba(17, 17, 17, 0.06);
        font-size: 12px;
        color: #111111;
      }

      .desin-capsule__badge-dot {
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: rgba(17, 17, 17, 0.92);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
      }

      .desin-capsule__divider {
        width: 1px;
        height: 24px;
        background: rgba(17, 17, 17, 0.08);
      }

      .desin-handle {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 40px;
        height: 40px;
        border-radius: 12px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 10px 26px rgba(17, 17, 17, 0.08);
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2147483647;
      }

      .desin-launcher {
        position: fixed;
        left: 50%;
        right: auto;
        bottom: 18px;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 8px 8px;
        border-radius: 9999px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 16px 30px rgba(17, 17, 17, 0.08);
        backdrop-filter: blur(14px);
        pointer-events: auto;
        cursor: pointer;
        z-index: 2147483647;
      }

      .desin-launcher__badge {
        width: 30px;
        height: 30px;
        border-radius: 9999px;
        background: #111111;
        color: #ffffff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .desin-launcher__copy {
        display: grid;
        gap: 2px;
        text-align: left;
      }

      .desin-launcher__copy strong {
        font-size: 12px;
        font-weight: 600;
        color: #111111;
      }

      .desin-launcher__copy span {
        font-size: 11px;
        color: #787774;
      }

      .desin-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        padding: 10px 14px;
        border-radius: 9999px;
        background: rgba(17, 17, 17, 0.9);
        color: #ffffff;
        font-size: 12px;
        pointer-events: none;
        z-index: 2147483647;
      }

      .desin-drag {
        position: fixed;
        border: 1px solid rgba(17, 17, 17, 0.9);
        background: rgba(17, 17, 17, 0.06);
        border-radius: 8px;
        pointer-events: none;
      }

      .desin-hidden {
        opacity: 0;
      }

      .desin-popover {
        width: min(344px, calc(100vw - 20px));
        border-radius: 8px;
        border-color: rgba(17, 17, 17, 0.12);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 12px 28px rgba(17, 17, 17, 0.08);
      }

      .desin-popover--dock {
        top: auto;
        left: 50%;
        right: auto;
        bottom: 74px;
        transform: translateX(-50%);
      }

      .desin-popover__head {
        padding: 8px 10px 6px;
        gap: 8px;
      }

      .desin-popover__title {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: baseline;
        gap: 2px;
      }

      .desin-popover__title strong {
        font-size: 13px;
        letter-spacing: 0;
      }

      .desin-popover__title span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
      }

      .desin-popover__body {
        padding: 0;
        gap: 0;
        max-height: min(460px, calc(100vh - 112px));
      }

      .desin-palette {
        display: grid;
        gap: 0;
      }

      .desin-palette-tabs {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 8px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
      }

      .desin-palette-toolbar {
        display: none;
        align-items: center;
        justify-content: flex-start;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(17, 17, 17, 0.025);
      }

      .desin-breakpoint-strip {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        gap: 4px;
        min-width: 0;
      }

      .desin-panel {
        display: grid;
        gap: 0;
        padding: 0 8px 8px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
      }

      .desin-panel[data-collapsed="true"] {
        padding-bottom: 0;
      }

      .desin-design-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
        background: rgba(17, 17, 17, 0.025);
      }

      .desin-design-actions .desin-breakpoint-strip {
        margin-right: auto;
      }

      .desin-design-actions .desin-breakpoint-strip[data-missing-breakpoint="true"] {
        padding: 2px;
        border: 1px solid #ce2c2c;
        border-radius: 10px;
        box-shadow: 0 0 0 1px rgba(206, 44, 44, 0.16);
      }

      .desin-save-button {
        width: auto;
        min-width: 64px;
        padding: 0 10px;
      }

      .desin-panel__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 34px;
        padding: 0;
      }

      .desin-panel__title {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        min-height: 30px;
      }

      .desin-panel__title strong {
        font-size: 11px;
        font-weight: 620;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #111111;
      }

      .desin-panel__title span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #787774;
        font-size: 11px;
      }

      .desin-panel__toggle {
        flex: 0 0 auto;
      }

      .desin-panel__toggle svg {
        transition: transform 140ms ease;
      }

      .desin-panel[data-collapsed="false"] .desin-panel__toggle svg {
        transform: rotate(180deg);
      }

      .desin-idea-panel[data-collapsed="false"] .desin-panel__toggle svg {
        transform: rotate(180deg);
      }

      .desin-panel[data-collapsed="true"] .desin-panel__body {
        display: none;
      }

      .desin-editor-wrap {
        display: grid;
        gap: 0;
        padding: 8px;
        border: 0;
        border-radius: 0;
        background: #ffffff;
        border-bottom: 1px solid rgba(17, 17, 17, 0.08);
      }

      .desin-editor {
        min-height: 52px;
        max-height: 96px;
        overflow: auto;
        padding: 8px 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        font-size: 13px;
        line-height: 1.4;
        outline: none;
      }

      .desin-reference-list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        min-height: 24px;
        padding: 0 0 6px;
        border-bottom: 1px solid rgba(17, 17, 17, 0.06);
      }

      .desin-reference-chip {
        appearance: none;
        display: inline-flex;
        align-items: center;
        min-height: 21px;
        max-width: 92px;
        padding: 0 7px;
        border: 1px solid rgba(17, 17, 17, 0.08);
        border-radius: 9999px;
        background: #f7f6f3;
        color: #2f3437;
        font: inherit;
        font-size: 10px;
        font-weight: 620;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }

      .desin-reference-chip[data-active="true"] {
        background: #111111;
        border-color: #111111;
        color: #ffffff;
      }

      .desin-editor-actions {
        padding-top: 2px;
      }

      .desin-badge {
        gap: 4px;
        padding: 3px 6px;
        border-radius: 9999px;
        font-size: 10px;
        vertical-align: baseline;
      }

      .desin-badge__icon {
        display: none;
      }

      .desin-badge__copy span {
        display: none;
      }

      .desin-badge__copy strong {
        font-size: 10px;
      }

      .desin-extract-strip {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        padding: 0 0 2px;
      }

      .desin-extract-strip .desin-chip {
        height: 24px;
        padding: 0 7px;
        font-size: 10px;
      }

      .desin-text-format-toolbar {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 30px;
        align-items: center;
        gap: 6px;
        padding-bottom: 6px;
      }

      .desin-text-format-strip {
        display: flex;
        gap: 4px;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        scroll-snap-type: x proximity;
      }

      .desin-text-format-strip::-webkit-scrollbar {
        display: none;
      }

      .desin-format-button {
        flex: 0 0 32px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(17, 17, 17, 0.08);
        border-radius: 8px;
        background: #ffffff;
        color: #111111;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        scroll-snap-align: start;
      }

      .desin-format-button svg {
        width: 14px;
        height: 14px;
      }

      .desin-format-button[data-active="true"] {
        background: #111111;
        border-color: #111111;
        color: #ffffff;
      }

      .desin-controls {
        gap: 0;
      }

      .desin-control {
        display: grid;
        grid-template-columns: minmax(96px, 1fr) minmax(82px, 1.4fr) auto;
        align-items: center;
        min-width: 0;
        gap: 8px;
        min-height: 25px;
        padding: 2px 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        border-bottom: 1px solid rgba(17, 17, 17, 0.05);
      }

      .desin-control__label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #1f1f1f;
        font-size: 13px;
        font-weight: 610;
      }

      .desin-control__value {
        color: #787774;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      .desin-slider {
        height: 16px;
      }

      .desin-slider::-webkit-slider-runnable-track {
        height: 3px;
        background: rgba(17, 17, 17, 0.3);
      }

      .desin-slider::-webkit-slider-thumb {
        width: 12px;
        height: 12px;
        margin-top: -4.5px;
        box-shadow: 0 1px 3px rgba(17, 17, 17, 0.14);
      }

      .desin-slider::-moz-range-track {
        height: 3px;
      }

      .desin-slider::-moz-range-thumb {
        width: 12px;
        height: 12px;
      }

      .desin-color-input {
        justify-self: end;
        width: 18px;
        height: 18px;
        border-radius: 5px;
      }

      .desin-input {
        min-width: 0;
        height: 22px;
        padding: 2px 6px;
        border-radius: 5px;
        font-size: 12px;
      }

      .desin-chip,
      .desin-mini-toggle,
      .desin-primary-button {
        min-height: 24px;
        padding: 5px 7px;
        border-radius: 6px;
        font-size: 11px;
      }

      .desin-icon-button {
        width: 24px;
        height: 24px;
        border-radius: 7px;
      }

      .desin-icon-badge {
        top: -4px;
        right: -4px;
        min-width: 14px;
        height: 14px;
        font-size: 8px;
      }

      .desin-icon-button[data-active="true"],
      .desin-chip[data-active="true"],
      .desin-mini-toggle[data-active="true"] {
        background: #111111;
        color: #ffffff;
      }

      .desin-actions,
      .desin-chips {
        gap: 4px;
      }

      .desin-kv,
      .desin-list {
        gap: 4px;
      }

      .desin-note-row {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        padding: 3px 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        border-bottom: 1px solid rgba(17, 17, 17, 0.06);
      }

      .desin-note-content {
        width: 100%;
        border: 0;
        background: transparent;
        padding: 0;
        text-align: left;
        color: #111111;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }

      .desin-textarea {
        min-height: 118px;
        padding: 8px;
        border-radius: 6px;
        font-size: 11px;
      }

      .desin-capsule {
        left: 50%;
        right: auto;
        bottom: 18px;
        transform: translateX(-50%);
        gap: 3px;
        padding: 6px;
        border-radius: 9999px;
        background: rgba(17, 17, 17, 0.64);
        border-color: rgba(255, 255, 255, 0.18);
        box-shadow: 0 18px 34px rgba(17, 17, 17, 0.28);
      }

      .desin-capsule[data-selecting="true"] {
        opacity: 1;
        pointer-events: auto;
      }

      .desin-capsule .desin-icon-button {
        color: #ffffff;
        background: transparent;
        border-color: transparent;
      }

      .desin-capsule .desin-icon-button[data-active="true"] {
        color: #111111;
        background: #ffffff;
        border-color: rgba(255, 255, 255, 0.72);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.18), 0 6px 14px rgba(0, 0, 0, 0.22);
      }

      .desin-capsule .desin-icon-button:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      .desin-capsule .desin-icon-button[data-active="true"]:hover {
        background: #ffffff;
      }

      .desin-launcher {
        padding: 6px;
        border-radius: 9999px;
        background: rgba(17, 17, 17, 0.88);
      }

      .desin-launcher__badge {
        width: 24px;
        height: 24px;
        background: transparent;
      }

      .desin-toast {
        bottom: 62px;
        padding: 7px 10px;
        font-size: 11px;
      }
    `;
  }

  private restorePersistedState(): void {
    const persisted = this.storage.load();
    const applyPersisted = (value: Awaited<typeof persisted>) => {
      if (!value) {
        return;
      }
      this.state.hidden = value.hidden;
      this.state.collapsed = value.collapsed;
      this.state.extractCollapsed = value.extractCollapsed ?? false;
      this.state.active = value.active ?? this.state.active;
      this.state.mode = value.activeMode === "select" ? "idle" : value.activeMode === "bundle" ? "style" : value.activeMode;
      this.state.stylePanel = value.stylePanel ?? "edit";
      this.state.activeSelectionId = value.activeSelectionId ?? null;
      this.state.activeNoteId = value.activeNoteId ?? null;
      this.state.activeIdeaCategory = value.activeIdeaCategory ?? DEFAULT_IDEA_CATEGORY;
      this.state.ideasCollapsed = value.ideasCollapsed ?? true;
      this.state.scope = normalizeScope(value.scope);
      this.state.notes = value.notes.map((note) => ({
        kind: "comment",
        ...note,
        references: normalizeNoteReferences(note),
      }));
      this.state.selections = value.selections ?? [];
      this.state.drafts = value.drafts ?? [];
      this.state.activeNoteText = value.activeNoteText ?? "";
      if (this.state.activeSelectionId && !this.state.selections.some((selection) => selection.id === this.state.activeSelectionId)) {
        this.state.activeSelectionId = this.state.selections[0]?.id ?? null;
      }
      this.updateBundleText();
      if (this.state.active && this.state.drafts.length > 0) {
        requestAnimationFrame(() => {
          this.reapplyStyleDrafts();
          this.scheduleRender();
        });
      }
      this.scheduleRender();
    };

    if (persisted instanceof Promise) {
      persisted.then(applyPersisted).catch(() => undefined);
    } else {
      applyPersisted(persisted);
    }
  }

  private persistState(): void {
    const payload = this.getPersistedState();
    const saveResult = this.storage.save(payload);
    if (saveResult instanceof Promise) {
      saveResult.catch(() => undefined);
    }
  }

  private getPersistedState() {
    return {
      hidden: this.state.hidden,
      collapsed: this.state.collapsed,
      extractCollapsed: this.state.extractCollapsed,
      activeMode: this.state.mode,
      stylePanel: this.state.stylePanel,
      activeSelectionId: this.state.activeSelectionId,
      activeNoteId: this.state.activeNoteId,
      activeIdeaCategory: this.state.activeIdeaCategory,
      ideasCollapsed: this.state.ideasCollapsed,
      scope: this.state.scope,
      notes: this.state.notes,
      active: this.state.active,
      selections: this.state.selections,
      drafts: this.state.drafts,
      activeNoteText: this.state.activeNoteText,
    };
  }

  private scheduleRender(): void {
    if (this.renderQueued || this.disposed) {
      return;
    }
    if (this.colorPickerActive) {
      this.renderPendingAfterColorPicker = true;
      return;
    }
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private updateBundleText(): void {
    const payload: ChangeBundlePayload = {
      route: currentRoute(),
      scope: this.state.scope,
      selections: this.state.selections,
      notes: this.state.notes.filter((note) => note.route === currentRoute()),
      drafts: this.state.drafts,
      structureContext: buildStructureContext(this.state.selections),
      instructionHtml: this.state.activeNoteText,
    };
    this.state.bundleText = renderChangeBundle(payload);
  }

  private requireBreakpoint(action: "copiar" | "guardar"): boolean {
    if (hasActiveBreakpointScope(this.state.scope)) {
      return true;
    }

    this.breakpointWarningVisible = true;
    this.state.toast = `Defini un breakpoint antes de ${action}`;
    this.scheduleRender();
    return false;
  }

  private updateSelectionFromElement(element: Element, additive = false): void {
    const source = this.resolveSource(element);
    const snapshot = buildElementSnapshot(element, source);
    const existingSelection = this.state.selections.find((selection) => this.selectionKey(selection) === this.selectionKey(snapshot));
    const exists = Boolean(existingSelection);
    const shouldInsert = !additive || !exists;

    if (!additive) {
      this.state.selections = [snapshot];
      this.state.activeSelectionId = snapshot.id;
      this.state.scope = emptyBreakpointScope();
      this.breakpointWarningVisible = false;
    } else if (exists) {
      this.state.activeSelectionId = existingSelection?.id ?? this.state.activeSelectionId;
    } else {
      this.state.selections = [...this.state.selections, snapshot];
      this.state.scope = emptyBreakpointScope();
      this.breakpointWarningVisible = false;
      if (!this.state.activeSelectionId) {
        this.state.activeSelectionId = snapshot.id;
      }
    }

    this.syncActiveSelection();
    this.state.hoverTarget = null;
    this.state.toast = `${this.state.selections.length} selected`;
    if (this.state.mode === "idle") {
      this.state.mode = "style";
      this.state.stylePanel = "edit";
      this.state.collapsed = true;
    }
    this.updateBundleText();
    if (this.state.mode === "note" || this.state.mode === "idea") {
      this.queueComposerFocus(this.state.mode);
    }
    if (shouldInsert) {
      this.insertReferenceIntoNoteEditor(snapshot);
      return;
    }
    this.scheduleRender();
  }

  private queueComposerFocus(_mode?: "note" | "idea"): void {
    this.composerFocusPending = true;
  }

  private focusComposerEditor(): void {
    const editor = this.getNoteEditor();
    if (!editor) {
      return;
    }

    editor.focus();
    if (this.draggedNoteElement) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    this.noteEditorRange = range.cloneRange();
  }

  private resolveSource(element: Element) {
    if (this.options.sourceResolver) {
      return this.options.sourceResolver(element);
    }
    return null;
  }

  private selectionKey(selection: SelectionTarget): string {
    return selection.domPath || `${selection.selector}:${Math.round(selection.rect.x)}:${Math.round(selection.rect.y)}`;
  }

  private selectionMatchesTarget(selection: SelectionTarget, targetId: string): boolean {
    return targetId === this.selectionKey(selection);
  }

  private getActiveSelection(): SelectionTarget | null {
    if (this.state.selections.length === 0) {
      return null;
    }

    const activeSelection = this.state.activeSelectionId
      ? this.state.selections.find((selection) => selection.id === this.state.activeSelectionId)
      : null;

    return activeSelection ?? this.state.selections[0] ?? null;
  }

  private syncActiveSelection(): void {
    if (this.state.selections.length === 0) {
      this.state.activeSelectionId = null;
      return;
    }

    const firstSelection = this.state.selections[0];
    if (!firstSelection) {
      this.state.activeSelectionId = null;
      return;
    }

    if (!this.state.activeSelectionId || !this.state.selections.some((selection) => selection.id === this.state.activeSelectionId)) {
      this.state.activeSelectionId = firstSelection.id;
    }
  }

  private currentSelectionTargetIds(): string[] {
    return this.state.selections.map((selection) => this.selectionKey(selection));
  }

  private getDraftValueForSelection(selection: SelectionTarget, property: string): string | null {
    const draft = this.state.drafts.find(
      (item) =>
        item.property === property &&
        item.targetIds.some((targetId) => this.selectionMatchesTarget(selection, targetId)),
    );
    return draft?.value ?? null;
  }

  private draftTargetsCurrentSelection(draft: StyleDraft): boolean {
    return this.state.selections.some((selection) =>
      draft.targetIds.some((targetId) => this.selectionMatchesTarget(selection, targetId)),
    );
  }

  private draftTargetsSameSelection(draft: StyleDraft, targetIds: string[]): boolean {
    if (draft.targetIds.length !== targetIds.length) {
      return false;
    }
    return draft.targetIds.every((targetId) => targetIds.includes(targetId));
  }

  private findElementsForDraft(draft: StyleDraft): HTMLElement[] {
    return this.state.selections
      .filter((selection) => draft.targetIds.some((targetId) => this.selectionMatchesTarget(selection, targetId)))
      .map((selection) => findElementForSnapshot(selection))
      .filter((element): element is HTMLElement => Boolean(element));
  }

  private targetElementFromPoint(x: number, y: number): HTMLElement | null {
    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
      if (element === this.root || this.root.contains(element)) {
        continue;
      }
      if (element instanceof HTMLElement) {
        return element;
      }
    }
    return null;
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.draggedNoteElement && this.draggedNoteElement.closest<HTMLElement>('[data-note-editor="true"]')) {
      return;
    }

    if (
      this.disposed ||
      this.state.hidden ||
      (this.state.mode !== "select" && this.state.mode !== "note" && this.state.mode !== "idea")
    ) {
      return;
    }

    if (this.state.pointerMode === "dragging" && this.dragStart) {
      const dragRect: RectLike = {
        x: Math.min(this.dragStart.x, event.clientX),
        y: Math.min(this.dragStart.y, event.clientY),
        width: Math.abs(event.clientX - this.dragStart.x),
        height: Math.abs(event.clientY - this.dragStart.y),
      };
      this.state.dragRect = dragRect;
      this.scheduleRender();
      return;
    }

    const target = this.targetElementFromPoint(event.clientX, event.clientY);
    if (!target) {
      return;
    }

    const source = this.resolveSource(target);
    const snapshot = buildElementSnapshot(target, source);
    const isSelected = this.state.selections.some(
      (selection) => selection.selector === snapshot.selector,
    );
    const nextHoverTarget = isSelected ? null : snapshot;
    if (this.state.hoverTarget?.selector === nextHoverTarget?.selector) {
      return;
    }
    this.state.hoverTarget = nextHoverTarget;
    this.scheduleRender();
  }

  private onPointerDown(event: PointerEvent): void {
    if (
      this.disposed ||
      this.state.hidden ||
      (this.state.mode !== "select" && this.state.mode !== "note" && this.state.mode !== "idea")
    ) {
      return;
    }

    const path = event.composedPath();
    const clickedInsideOverlay = path.includes(this.root);
    if (clickedInsideOverlay) {
      return;
    }

    const target = this.targetElementFromPoint(event.clientX, event.clientY);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      this.state.pointerMode = "dragging";
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.state.dragRect = { x: event.clientX, y: event.clientY, width: 0, height: 0 };
      this.scheduleRender();
      return;
    }

    this.updateSelectionFromElement(target, true);
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.draggedNoteElement && this.draggedNoteElement.closest<HTMLElement>('[data-note-editor="true"]')) {
      return;
    }

    if (this.disposed || this.state.hidden) {
      return;
    }

    if (this.state.pointerMode !== "dragging" || !this.state.dragRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const dragRect = this.state.dragRect;
    const matched = getDocumentElements().filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return intersects(dragRect, rectFromDom(rect));
    });

    if (matched.length > 0) {
      const selectionIds = new Set(this.state.selections.map((item) => item.selector));
      const insertedSelections: SelectionTarget[] = [];
      for (const element of matched) {
        const snapshot = buildElementSnapshot(element, this.resolveSource(element));
        if (!selectionIds.has(snapshot.selector)) {
          this.state.selections.push(snapshot);
          insertedSelections.push(snapshot);
        }
      }
      this.syncActiveSelection();
      for (const selection of insertedSelections) {
        this.insertReferenceIntoNoteEditor(selection, { render: false });
      }
      this.state.toast = `${this.state.selections.length} selected`;
      this.updateBundleText();
      this.persistState();
    }

    this.dragStart = null;
    this.state.pointerMode = "idle";
    this.state.dragRect = null;
    this.scheduleRender();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const pathTarget = event.composedPath()[0];
    const target = pathTarget instanceof HTMLElement ? pathTarget : event.target as HTMLElement | null;
    if (
      target?.isContentEditable &&
      target.dataset.noteEditor === "true" &&
      (this.state.mode === "note" || this.state.mode === "idea") &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (this.state.mode === "idea") {
        this.submitCurrentIdea();
      } else {
        this.submitCurrentNote();
      }
      return;
    }

    if (event.key === "Escape") {
      if (this.state.hidden) {
        return;
      }
      if (this.state.selections.length > 0) {
        event.preventDefault();
        this.clearSelections();
      } else {
        this.hide();
      }
    }
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const actionTarget = target.closest<HTMLElement>("[data-action]");
    const action = actionTarget?.dataset.action;
    if (action) {
      event.preventDefault();
      switch (action) {
        case "hide-inspector":
          this.hideInspector();
          break;
        case "minimize-popover":
          this.setMode("idle");
          break;
        case "show-inspector":
          this.showInspector();
          break;
        case "style-step-decrease":
          if (actionTarget?.dataset.property) {
            this.stepStyleProperty(actionTarget.dataset.property, -1);
          }
          break;
        case "style-step-increase":
          if (actionTarget?.dataset.property) {
            this.stepStyleProperty(actionTarget.dataset.property, 1);
          }
          break;
        case "style-reset":
          if (actionTarget?.dataset.property) {
            this.resetStyleProperty(actionTarget.dataset.property);
          }
          break;
        case "text-format":
          if (actionTarget?.dataset.property && actionTarget.dataset.value !== undefined) {
            const nextValue = actionTarget.dataset.active === "true" && actionTarget.dataset.resetValue !== undefined
              ? actionTarget.dataset.resetValue
              : actionTarget.dataset.value;
            this.applyStyle(actionTarget.dataset.property, nextValue);
          }
          break;
        case "text-format-scroll":
          {
            const strip = actionTarget
              ?.closest<HTMLElement>(".desin-text-format-toolbar")
              ?.querySelector<HTMLElement>(".desin-text-format-strip");
            const direction = actionTarget?.dataset.direction === "right" ? 1 : -1;
            strip?.scrollBy({ left: direction * 124, behavior: "smooth" });
          }
          break;
        case "mode-select":
          this.enterSelectMode();
          break;
        case "mode-style":
          this.enterStyleMode("edit");
          break;
        case "mode-extract":
          this.enterStyleMode("extract");
          break;
        case "mode-note":
          this.enterNoteMode();
          break;
        case "mode-idea":
          this.enterIdeaMode();
          break;
        case "mode-breakpoints":
          this.enterBreakpointMode();
          break;
        case "style-panel-edit":
          this.enterStyleMode("edit");
          break;
        case "style-panel-extract":
          this.enterStyleMode("extract");
          break;
        case "toggle-style-panel":
          this.state.collapsed = !this.state.collapsed;
          this.persistState();
          this.scheduleRender();
          break;
        case "toggle-extract-panel":
          this.state.extractCollapsed = !this.state.extractCollapsed;
          this.persistState();
          this.scheduleRender();
          break;
        case "focus-selection":
          {
            const byKey = actionTarget?.dataset.selectionKey
              ? this.state.selections.find((selection) => this.selectionKey(selection) === actionTarget.dataset.selectionKey)
              : null;
            const byId = !byKey && actionTarget?.dataset.selectionId
              ? this.state.selections.find((selection) => selection.id === actionTarget.dataset.selectionId)
              : null;
            const selectorMatches = !byKey && !byId && actionTarget?.dataset.selector
              ? this.state.selections.filter((selection) => selection.selector === actionTarget.dataset.selector)
              : [];
            const selected = byKey ?? byId ?? (selectorMatches.length === 1 ? selectorMatches[0] : null);
            if (selected) {
              this.state.activeSelectionId = selected.id;
              this.persistState();
              this.scheduleRender();
            }
          }
          break;
        case "extract-style":
          if (actionTarget?.dataset.kind === "typography" || actionTarget?.dataset.kind === "color" || actionTarget?.dataset.kind === "size" || actionTarget?.dataset.kind === "all") {
            this.extractStylePreset(actionTarget.dataset.kind);
          }
          break;
        case "copy-instruction":
          void this.copyCurrentInstruction();
          break;
        case "toggle-adjustments":
        case "toggle-adjustments-visibility":
          this.toggleAdjustmentsVisibility();
          break;
        case "breakpoints-all":
          this.toggleAllBreakpoints();
          break;
        case "clear-selection":
          this.clearCurrentSelection();
          break;
        case "clear-adjustments":
          this.clearCurrentAdjustments();
          break;
        case "open-comments":
          this.enterNoteMode();
          break;
        case "open-ideas":
          this.enterIdeaMode();
          break;
        case "toggle-ideas-panel":
          this.state.ideasCollapsed = !this.state.ideasCollapsed;
          this.persistState();
          this.scheduleRender();
          break;
        case "open-note":
          if (actionTarget?.dataset.noteId) {
            this.openSavedNote(actionTarget.dataset.noteId);
          }
          break;
        case "add-note":
          if (!this.requireBreakpoint("guardar")) {
            return;
          }
          this.submitCurrentNote();
          break;
        case "add-idea":
          this.submitCurrentIdea();
          break;
        case "toggle-note":
          if (actionTarget?.dataset.noteId) {
            this.toggleNoteDone(actionTarget.dataset.noteId);
          }
          break;
        case "copy-note-instruction":
          if (actionTarget?.dataset.noteId) {
            void this.copySavedNoteInstruction(actionTarget.dataset.noteId);
          }
          break;
        case "remove-note":
          if (actionTarget?.dataset.noteId) {
            this.removeCurrentNote(actionTarget.dataset.noteId);
          }
          break;
        case "copy-bundle":
          void this.copyCurrentInstruction();
          break;
        default:
          break;
      }
      return;
    }

    const chip = target.closest<HTMLElement>("[data-breakpoint]");
    if (chip) {
      event.preventDefault();
      const name = chip.dataset.breakpoint;
      if (!name) {
        return;
      }

      const breakpoints = this.state.scope.breakpoints.includes(name)
        ? this.state.scope.breakpoints.filter((item) => item !== name)
        : [...this.state.scope.breakpoints, name];
      this.state.scope = {
        mode: breakpoints.length > 0 ? "scoped" : "global",
        breakpoints,
      };
      this.breakpointWarningVisible = false;
      this.persistState();
      this.updateBundleText();
      this.scheduleRender();
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement | null;
    if (!target) {
      return;
    }

    if (target instanceof HTMLElement && target.dataset.noteEditor === "true") {
      this.state.activeNoteText = target.innerHTML;
      this.updateBundleText();
      return;
    }

    if (target instanceof HTMLElement && target.dataset.noteEditId) {
      const noteId = target.dataset.noteEditId;
      const contentHtml = target.innerHTML;
      const text = cleanInstructionText(contentHtml);
      this.state.notes = this.state.notes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              text,
              contentHtml,
              instructionHtml: contentHtml,
              updatedAt: Date.now(),
            }
          : note,
      );
      this.persistState();
      this.updateBundleText();
      return;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      if (target.dataset.property) {
        if (target.dataset.control === "slider") {
          const value = Number.parseFloat(target.value);
          if (Number.isFinite(value)) {
            this.applyStyle(target.dataset.property, formatNumericStyleValue(target.dataset.property, value), {
              render: false,
            });
          }
          return;
        }

        if (target.dataset.control === "color") {
          this.beginColorPickerInteraction();
          this.applyStyle(target.dataset.property, target.value, { render: false });
          return;
        }

        this.applyStyle(target.dataset.property, target.value);
        return;
      }

      if (target.dataset.noteInput === "true") {
        this.state.activeNoteText = target.value;
        this.updateBundleText();
      }
    }
  }

  private onChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement | null;
    if (!target) {
      return;
    }

    if (target instanceof HTMLElement && target.dataset.noteEditor === "true") {
      this.state.activeNoteText = target.innerHTML;
      this.updateBundleText();
      return;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      if (target.dataset.property && (target.dataset.control === "slider" || target.dataset.control === "color")) {
        const value = target.dataset.control === "slider"
          ? Number.parseFloat(target.value)
          : target.value;
        if (typeof value === "number" && !Number.isFinite(value)) {
          return;
        }
        this.applyStyle(
          target.dataset.property,
          target.dataset.control === "slider"
            ? formatNumericStyleValue(target.dataset.property, Number(value))
            : target.value,
          target.dataset.control === "color" ? { render: false } : {},
        );
        if (target.dataset.control === "color") {
          this.releaseColorPickerInteraction();
        }
        return;
      }

      if (target.dataset.noteInput === "true") {
        this.state.activeNoteText = target.value;
        this.updateBundleText();
      }
    }
  }

  private onFocusOut(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.dataset.control === "color") {
      this.releaseColorPickerInteraction();
    }
  }

  private onSelectionChange(): void {
    if (this.state.mode !== "note" && this.state.mode !== "idea") {
      return;
    }

    const editor = this.getNoteEditor();
    if (!editor || !editor.isConnected) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const withinEditor =
      editor.contains(range.startContainer) || editor.contains(range.endContainer);

    if (!withinEditor) {
      return;
    }

    this.noteEditorRange = range.cloneRange();
    this.state.activeNoteText = editor.innerHTML;
    this.updateBundleText();
  }

  private onPaste(event: ClipboardEvent): void {
    const editor = this.getNoteEditor();
    if (!editor || !editor.contains(event.target as Node | null) || (this.state.mode !== "note" && this.state.mode !== "idea")) {
      return;
    }

    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) {
      return;
    }

    event.preventDefault();
    this.insertTextIntoNoteEditor(text);
  }

  private onDragStart(event: DragEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const token = target.closest<HTMLElement>('[data-note-token="true"]');
    if (!token) {
      return;
    }

    const editor = token.closest<HTMLElement>('[data-note-editor="true"]');
    if (!editor) {
      return;
    }

    this.draggedNoteElement = token;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", token.dataset.selector ?? token.textContent ?? "");
    }
  }

  private onDragOver(event: DragEvent): void {
    if (!this.draggedNoteElement) {
      return;
    }

    const editor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-note-editor="true"]');
    if (!editor) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  private onDrop(event: DragEvent): void {
    if (!this.draggedNoteElement) {
      return;
    }

    const editor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-note-editor="true"]');
    if (!editor) {
      return;
    }

    event.preventDefault();
    this.completeDraggedNoteDrop(event.clientX, event.clientY, editor);
  }

  private onDragEnd(): void {
    this.draggedNoteElement = null;
  }

  private beginColorPickerInteraction(): void {
    this.colorPickerActive = true;
    if (this.colorPickerReleaseTimer !== null) {
      window.clearTimeout(this.colorPickerReleaseTimer);
      this.colorPickerReleaseTimer = null;
    }
  }

  private releaseColorPickerInteraction(): void {
    if (this.colorPickerReleaseTimer !== null) {
      window.clearTimeout(this.colorPickerReleaseTimer);
    }

    this.colorPickerReleaseTimer = window.setTimeout(() => {
      this.colorPickerActive = false;
      this.colorPickerReleaseTimer = null;
      if (this.renderPendingAfterColorPicker) {
        this.renderPendingAfterColorPicker = false;
        this.scheduleRender();
      }
    }, 180);
  }

  private onNotePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.dataset.control === "color") {
      this.beginColorPickerInteraction();
      event.stopPropagation();
      return;
    }

    if (this.state.mode !== "note" && this.state.mode !== "idea") {
      return;
    }

    if (!target) {
      return;
    }

    const token = target.closest<HTMLElement>('[data-note-token="true"]');
    if (!token) {
      return;
    }

    const editor = token.closest<HTMLElement>('[data-note-editor="true"]');
    if (!editor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.draggedNoteElement = token;
  }

  private onNotePointerUp(event: PointerEvent): void {
    if (!this.draggedNoteElement) {
      return;
    }

    const editor = this.draggedNoteElement.closest<HTMLElement>('[data-note-editor="true"]');
    if (!editor) {
      this.draggedNoteElement = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.completeDraggedNoteDrop(event.clientX, event.clientY, editor);
  }

  private getNoteEditor(): HTMLDivElement | null {
    return this.shadow.querySelector<HTMLDivElement>('[data-note-editor="true"]');
  }

  private syncNoteEditorState(): void {
    const editor = this.getNoteEditor();
    if (!editor) {
      return;
    }

    this.state.activeNoteText = editor.innerHTML;
    this.updateBundleText();
  }

  private insertNodeAtRange(node: Node, range: Range, editor: HTMLElement): void {
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(node);
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);

    if (!lastNode) {
      return;
    }

    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    this.noteEditorRange = nextRange.cloneRange();
    editor.focus();
  }

  private insertTextIntoNoteEditor(text: string): void {
    const editor = this.getNoteEditor();
    if (!editor) {
      return;
    }

    const selection = window.getSelection();
    const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const withinEditor =
      currentRange !== null &&
      (editor.contains(currentRange.startContainer) || editor.contains(currentRange.endContainer));
    const range = withinEditor ? currentRange : document.createRange();

    if (!withinEditor) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    this.insertNodeAtRange(document.createTextNode(text), range, editor);
    this.syncNoteEditorState();
  }

  private insertHtmlIntoNoteEditor(html: string): void {
    const editor = this.getNoteEditor();
    if (!editor) {
      this.state.activeNoteText = this.state.activeNoteText
        ? `${this.state.activeNoteText} ${html}`
        : html;
      return;
    }

    const selection = window.getSelection();
    const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const withinEditor =
      currentRange !== null &&
      (editor.contains(currentRange.startContainer) || editor.contains(currentRange.endContainer));
    const range = withinEditor ? currentRange : document.createRange();

    if (!withinEditor) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const fragment = createFragmentFromHtml(html);
    const nodes = Array.from(fragment.childNodes);
    if (nodes.length === 0) {
      return;
    }

    range.deleteContents();
    range.insertNode(fragment);

    const lastNode = nodes[nodes.length - 1];
    if (lastNode) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(lastNode);
      nextRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
      this.noteEditorRange = nextRange.cloneRange();
    }

    editor.focus();
    this.syncNoteEditorState();
  }

  private insertReferenceIntoNoteEditor(selectionTarget: SelectionTarget, options: { render?: boolean } = {}): void {
    const shouldRender = options.render ?? true;
    const editor = this.getNoteEditor();
    const html = this.renderInstructionSelectionBadge(selectionTarget);

    if (!editor) {
      this.state.activeNoteText = this.state.activeNoteText
        ? `${this.state.activeNoteText} ${html}`
        : html;
      this.state.toast = "Elemento insertado";
      if (shouldRender) {
        this.scheduleRender();
      }
      return;
    }

    const selection = window.getSelection();
    const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const withinEditor =
      currentRange !== null &&
      (editor.contains(currentRange.startContainer) || editor.contains(currentRange.endContainer));
    const range = withinEditor ? currentRange : document.createRange();

    if (!withinEditor) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const fragment = createFragmentFromHtml(html);
    const nodes = Array.from(fragment.childNodes);
    if (nodes.length === 0) {
      return;
    }

    range.deleteContents();
    range.insertNode(fragment);

    const lastNode = nodes[nodes.length - 1];
    if (lastNode) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(lastNode);
      nextRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
      this.noteEditorRange = nextRange.cloneRange();
    }

    editor.focus();
    this.queueComposerFocus();
    this.syncNoteEditorState();
    this.state.toast = "Elemento insertado";
    if (shouldRender) {
      this.scheduleRender();
    }
  }

  private removeSelectionTokenFromInstruction(selectionTarget: SelectionTarget): void {
    const container = document.createElement("div");
    container.innerHTML = this.state.activeNoteText;
    const key = this.selectionKey(selectionTarget);
    container.querySelectorAll<HTMLElement>('[data-note-token="true"]').forEach((token) => {
      if (
        token.dataset.selectionId === selectionTarget.id ||
        token.dataset.selectionKey === key ||
        token.dataset.selector === selectionTarget.selector
      ) {
        token.remove();
      }
    });
    this.state.activeNoteText = container.innerHTML.trim();
  }

  private completeDraggedNoteDrop(x: number, y: number, editor: HTMLElement): void {
    if (!this.draggedNoteElement) {
      return;
    }

    const range = this.rangeFromPoint(x, y, editor);
    const selection = window.getSelection();

    if (range) {
      range.deleteContents();
      range.insertNode(this.draggedNoteElement);
      const nextRange = document.createRange();
      nextRange.setStartAfter(this.draggedNoteElement);
      nextRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
    } else {
      editor.appendChild(this.draggedNoteElement);
    }

    this.state.activeNoteText = editor.innerHTML;
    this.draggedNoteElement = null;
    this.scheduleRender();
  }

  private rangeFromPoint(x: number, y: number, editor: HTMLElement): Range | null {
    const doc = editor.ownerDocument ?? document;
    const anyDoc = doc as Document & {
      caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
      caretPositionFromPoint?: (clientX: number, clientY: number) => CaretPosition | null;
    };

    const caretRange = anyDoc.caretRangeFromPoint?.(x, y);
    if (caretRange && editor.contains(caretRange.startContainer)) {
      return caretRange;
    }

    const caretPosition = anyDoc.caretPositionFromPoint?.(x, y);
    if (caretPosition && editor.contains(caretPosition.offsetNode)) {
      const range = doc.createRange();
      range.setStart(caretPosition.offsetNode, caretPosition.offset);
      range.collapse(true);
      return range;
    }

    return null;
  }

  private hideInspector(): void {
    this.hide();
  }

  private showInspector(): void {
    this.show();
  }

  private enterSelectMode(): void {
    if (this.state.mode === "select") {
      this.setMode("idle");
      return;
    }

    this.state.collapsed = true;
    this.state.extractCollapsed = true;
    if (!this.state.active) {
      this.state.active = true;
      this.reapplyStyleDrafts();
    }
    this.setMode("select");
  }

  private enterStyleMode(panel: "edit" | "extract" = "edit"): void {
    this.state.stylePanel = panel;
    this.state.collapsed = true;
    this.setMode("style");
  }

  private enterNoteMode(): void {
    if (!this.state.active) {
      this.state.active = true;
      this.reapplyStyleDrafts();
    }
    this.queueComposerFocus("note");
    this.setMode("note");
  }

  private enterIdeaMode(): void {
    if (!this.state.active) {
      this.state.active = true;
      this.reapplyStyleDrafts();
    }
    this.queueComposerFocus("idea");
    this.setMode("idea");
  }

  private enterBreakpointMode(): void {
    this.setMode("breakpoints");
  }

  private extractStylePreset(kind: "typography" | "color" | "size" | "all"): void {
    const selected = this.getActiveSelection();
    if (!selected) {
      this.state.toast = "Select a component first";
      this.scheduleRender();
      return;
    }

    const liveElement = findElementForSnapshot(selected);
    if (!liveElement) {
      this.state.toast = "Element not found";
      this.scheduleRender();
      return;
    }

    const styles = window.getComputedStyle(liveElement);
    const propertyNames = getExtractionProperties(kind);
    const extracted: Record<string, string> = {};
    for (const property of propertyNames) {
      const value = styles.getPropertyValue(property).trim();
      if (value) {
        extracted[property] = value;
      }
    }

    const summary = formatExtractionSummary(kind, extracted);
    const payload = {
      label: kind === "typography" ? "Tipografia" : kind === "color" ? "Color" : kind === "size" ? "Tamaño" : "Todo",
      kind,
      selector: selected.selector,
      domPath: selected.domPath,
      componentName: selected.componentName,
      tagName: selected.tagName,
      breakpoint: scopeLabel(this.state.scope),
      summary,
      properties: extracted,
    };

    const targetIds = [this.selectionKey(selected)];
    this.state.drafts = [
      ...this.state.drafts.filter((draft) => draft.property !== `extract:${kind}` || !this.draftTargetsSameSelection(draft, targetIds)),
      {
        id: uid("draft"),
        property: `extract:${kind}`,
        value: JSON.stringify(payload),
        scope: this.resolveStyleScope(),
        targetIds,
        createdAt: Date.now(),
      },
    ];
    this.insertHtmlIntoNoteEditor(
      this.renderInstructionStyleBadge(payload.label, `${payload.label}: ${summary || selected.domPath}`),
    );
    this.state.toast = `${payload.label} extracted`;
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  private async copyCurrentInstruction(): Promise<string> {
    return this.copyAdjustmentDocuments();
  }

  private getRouteCommentNotes(): InspectorNote[] {
    return this.state.notes
      .filter((note) => note.route === currentRoute() && note.kind !== "idea")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private openFirstSavedNoteMissingBreakpoint(notes: InspectorNote[]): boolean {
    const missingBreakpointIndex = notes.findIndex((note) => !hasActiveBreakpointScope(normalizeScope(note.scope)));
    const missingBreakpointNote = missingBreakpointIndex >= 0 ? notes[missingBreakpointIndex] : null;
    if (!missingBreakpointNote) {
      return false;
    }

    this.openSavedNote(missingBreakpointNote.id);
    this.breakpointWarningVisible = true;
    this.state.toast = `Defini un breakpoint para el comentario ${missingBreakpointIndex + 1} antes de copiar todos`;
    this.scheduleRender();
    return true;
  }

  private renderSavedCommentDocument(note: InspectorNote, index: number): string {
    const selections = note.selections && note.selections.length > 0 ? note.selections : this.state.selections;
    const drafts = note.drafts ?? [];
    const scope = normalizeScope(note.scope ?? this.state.scope);
    const primarySelection = selections[0];
    const target = primarySelection?.domPath ?? primarySelection?.selector ?? note.selector;
    const updated = new Date(note.updatedAt).toLocaleString();
    const bundle = renderChangeBundle({
      route: currentRoute(),
      scope,
      selections,
      notes: [note],
      drafts,
      structureContext: buildStructureContext(selections),
      instructionHtml: note.instructionHtml ?? note.text,
    });

    return [
      `Comentario ${index + 1}`,
      `Ruta: ${currentRoute()}`,
      `Breakpoint: ${scopeLabel(scope)}`,
      target ? `Elemento: ${target}` : "",
      `Actualizado: ${updated}`,
      "",
      bundle,
    ].filter(Boolean).join("\n");
  }

  private async copySavedNoteInstruction(noteId: string): Promise<string> {
    const note = this.state.notes.find((item) => item.id === noteId);
    if (!note) {
      return "";
    }

    const instructionHtml = note.instructionHtml ?? note.contentHtml ?? note.text;
    const text = instructionHtml ? serializeComposerHtml(instructionHtml, note.selections ?? []) : "";
    if (!text) {
      this.state.toast = "Nada para copiar";
      this.scheduleRender();
      return "";
    }

    await navigator.clipboard.writeText(text);
    this.state.toast = "Instrucción copiada";
    this.scheduleRender();
    return text;
  }

  private renderAdjustmentDocuments(): string {
    const routeNotes = this.getRouteCommentNotes();
    const documents = routeNotes.map((note, index) => this.renderSavedCommentDocument(note, index));

    if (documents.length > 0) {
      return documents.join("\n\n---\n\n");
    }

    if (this.state.selections.length > 0 || this.state.drafts.length > 0 || cleanInstructionText(this.state.activeNoteText)) {
      return renderChangeBundle({
        route: currentRoute(),
        scope: this.state.scope,
        selections: this.state.selections,
        notes: [],
        drafts: this.state.drafts,
        structureContext: buildStructureContext(this.state.selections),
        instructionHtml: this.state.activeNoteText,
      });
    }

    return cleanInstructionText(this.state.activeNoteText);
  }

  private async copyAdjustmentDocuments(): Promise<string> {
    const routeNotes = this.getRouteCommentNotes();
    if (routeNotes.length > 0) {
      if (this.openFirstSavedNoteMissingBreakpoint(routeNotes)) {
        return "";
      }
    } else if (!this.requireBreakpoint("copiar")) {
      return "";
    }

    const text = this.renderAdjustmentDocuments();
    if (!text) {
      this.state.toast = "Nada para copiar";
      this.scheduleRender();
      return "";
    }

    await navigator.clipboard.writeText(text);
    this.state.toast = "Copiado";
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.scheduleRender();
    return text;
  }

  private clearCurrentSelection(): void {
    this.clearSelections();
  }

  private clearCurrentAdjustments(): void {
    this.clearStylePreview();
    this.state.activeNoteId = null;
    this.state.toast = "Ajustes eliminados; historial conservado";
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  private hasAllBreakpointsSelected(): boolean {
    return this.breakpoints.length > 0 && this.state.scope.breakpoints.length === this.breakpoints.length;
  }

  private toggleAllBreakpoints(): void {
    const nextBreakpoints = this.hasAllBreakpointsSelected()
      ? []
      : this.breakpoints.map((breakpoint) => breakpoint.name);
    this.state.scope = {
      mode: nextBreakpoints.length > 0 ? "scoped" : "global",
      breakpoints: nextBreakpoints,
    };
    this.breakpointWarningVisible = false;
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  private submitCurrentNote(): void {
    this.addNote(this.state.activeNoteText);
  }

  private submitCurrentIdea(): void {
    this.addNote(this.state.activeNoteText);
  }

  private setHoveredNote(noteId: string | null): void {
    if (this.hoveredNoteId === noteId) {
      return;
    }

    this.hoveredNoteId = noteId;
    this.scheduleRender();
  }

  private clearHoveredNoteSoon(noteId: string): void {
    if (this.noteHoverTimeout !== null) {
      window.clearTimeout(this.noteHoverTimeout);
      this.noteHoverTimeout = null;
    }

    this.noteHoverTimeout = window.setTimeout(() => {
      if (this.hoveredNoteId === noteId) {
        this.hoveredNoteId = null;
        this.scheduleRender();
      }
      this.noteHoverTimeout = null;
    }, 1200);
  }

  private onNotePointerOver(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const pin = target.closest<HTMLElement>(".desin-note-pin");
    const noteId = pin?.querySelector<HTMLElement>("[data-note-id]")?.dataset.noteId;
    if (!pin || !noteId) {
      return;
    }

    if (this.noteHoverTimeout !== null) {
      window.clearTimeout(this.noteHoverTimeout);
      this.noteHoverTimeout = null;
    }

    this.setHoveredNote(noteId);
  }

  private onNotePointerOut(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const pin = target.closest<HTMLElement>(".desin-note-pin");
    const relatedTarget = event.relatedTarget as Node | null;
    if (!pin) {
      return;
    }

    if (relatedTarget && pin.contains(relatedTarget)) {
      return;
    }

    const noteId = pin.querySelector<HTMLElement>("[data-note-id]")?.dataset.noteId;
    if (noteId) {
      this.clearHoveredNoteSoon(noteId);
    }
  }

  private openSavedNote(noteId: string): void {
    const note = this.state.notes.find((item) => item.id === noteId);
    if (!note) {
      return;
    }

    const selections = note.selections && note.selections.length > 0
      ? note.selections.map((selection) => ({ ...selection }))
      : [];
    const drafts = (note.drafts ?? []).map((draft) => ({
      ...draft,
      targetIds: [...draft.targetIds],
      scope: normalizeScope(draft.scope),
    }));

    this.restoreSelectionPreviewStyles();
    this.state.hidden = false;
    this.state.active = true;
    this.state.mode = note.kind === "idea" ? "idea" : "note";
    this.state.activeIdeaCategory = note.category ?? this.state.activeIdeaCategory;
    this.state.selections = selections;
    this.state.drafts = drafts;
    this.state.scope = normalizeScope(note.scope ?? this.state.scope);
    this.state.activeNoteText = note.instructionHtml ?? note.contentHtml ?? note.text;
    this.state.activeNoteId = note.id;
    this.state.activeSelectionId = selections[0]?.id ?? null;
    this.state.hoverTarget = null;
    this.state.dragRect = null;
    this.state.pointerMode = "idle";
    this.noteEditorRange = null;
    this.draggedNoteElement = null;
    this.reapplyStyleDrafts();
    this.queueComposerFocus(note.kind === "idea" ? "idea" : "note");
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  private toggleNoteDone(noteId: string): void {
    this.toggleNote(noteId);
  }

  private removeCurrentNote(noteId: string): void {
    this.removeNote(noteId);
  }

  private renderSelectionLayer(): string {
    const selectionBoxes = this.state.selections
      .map((selection) => {
        const liveElement = findElementForSnapshot(selection);
        const rect = liveElement ? rectFromDom(liveElement.getBoundingClientRect()) : selection.rect;
        const label = selection.domPath ? shortenDomPath(selection.domPath) : selectorToLabel(selection.selector);
        const labelLeft = clamp(rect.x, 12, window.innerWidth - 220);

        return `
          <div class="desin-outline" style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;">
            <div class="desin-outline__label" style="left:${labelLeft - rect.x}px;">
              <strong>${escapeHtml(selection.componentName ?? selection.tagName)}</strong>
              <span>${escapeHtml(label)}</span>
            </div>
          </div>
        `;
      })
      .join("");

    const hoverBox = this.state.hoverTarget
      ? `
        <div class="desin-outline" style="left:${this.state.hoverTarget.rect.x}px;top:${this.state.hoverTarget.rect.y}px;width:${this.state.hoverTarget.rect.width}px;height:${this.state.hoverTarget.rect.height}px;border-style:dashed;opacity:0.7;">
          <div class="desin-outline__label" style="left:${clamp(this.state.hoverTarget.rect.x, 12, window.innerWidth - 220) - this.state.hoverTarget.rect.x}px;">
            <strong>${escapeHtml(this.state.hoverTarget.componentName ?? this.state.hoverTarget.tagName)}</strong>
            <span>${escapeHtml(this.state.hoverTarget.domPath ? shortenDomPath(this.state.hoverTarget.domPath) : "hover")}</span>
          </div>
        </div>
      `
      : "";

    const notes = this.state.notes
      .filter((note) => this.state.active || !note.done)
      .map((note) => {
        const anchor = selectorForNote(note);
        if (!anchor) {
          return "";
        }

        const rect = anchor.getBoundingClientRect();
        const pinWidth = Math.min(320, Math.max(200, window.innerWidth - 24));
        const top = clamp(rect.top - 30, 12, window.innerHeight - 44);
        const left = clamp(rect.right + 12, 12, window.innerWidth - pinWidth - 12);
        const cardWidth = Math.min(360, Math.max(260, window.innerWidth - 24));
        const cardLeft = clamp(left, 12, window.innerWidth - cardWidth - 12);
        const cardTop = clamp(top - 12, 12, Math.max(12, window.innerHeight - 420));
        this.noteLookup.set(note.id, anchor as HTMLElement);

        return `
          <div
            class="desin-note-pin"
            data-done="${String(note.done)}"
            data-hovered="${String(this.hoveredNoteId === note.id)}"
            style="left:${left}px;top:${top}px;--note-card-left:${cardLeft}px;--note-card-top:${cardTop}px;--note-card-width:${cardWidth}px;"
            tabindex="0"
          >
            <div class="desin-note-pin__stack">
              <button class="desin-note-pin__summary" data-action="open-note" data-note-id="${escapeHtml(note.id)}" type="button" title="Abrir comentario">
                <span class="desin-note-pin__badge">${escapeHtml(String(note.selections?.length ?? normalizeNoteReferences(note).length))}</span>
                <span class="desin-note-pin__content">${this.renderSavedNoteContent(note)}</span>
                <span class="desin-note-edit-icon" aria-hidden="true">${this.renderIcon("pencil")}</span>
              </button>
              <div class="desin-note-quick-actions" aria-label="Acciones del comentario">
              <button class="desin-note-quick-button" data-action="toggle-note" data-note-id="${escapeHtml(note.id)}" type="button" title="${note.done ? "Marcar pendiente" : "Marcar resuelto"}">${this.renderIcon("check")}</button>
                <button class="desin-note-quick-button" data-action="copy-note-instruction" data-note-id="${escapeHtml(note.id)}" type="button" title="Copiar instrucción">${this.renderIcon("copy")}</button>
                <button class="desin-note-quick-button" data-action="remove-note" data-note-id="${escapeHtml(note.id)}" type="button" title="Eliminar comentario">${this.renderIcon("x")}</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    const dragRect = this.state.dragRect
      ? `
        <div
          class="desin-drag"
          style="
            left:${this.state.dragRect.x}px;
            top:${this.state.dragRect.y}px;
            width:${Math.max(0, this.state.dragRect.width)}px;
            height:${Math.max(0, this.state.dragRect.height)}px;
          "
        ></div>
      `
      : "";

    return `<div class="desin-layer">${selectionBoxes}${hoverBox}${notes}${dragRect}</div>`;
  }

  private renderNoteHoverCard(note: InspectorNote): string {
    const references = normalizeNoteReferences(note);
    const primaryReference = references[0];
    const targetLabel = primaryReference
      ? primaryReference.domPath ?? primaryReference.selector
      : note.selector;
    const scope = scopeLabel(normalizeScope(note.scope ?? this.state.scope));
    const updated = new Date(note.updatedAt).toLocaleString();
    const created = new Date(note.createdAt).toLocaleString();
    const rawContent = note.contentHtml ?? note.text;
    const hasInlineBadges = /[data-note-token="true"]|desin-badge/.test(rawContent);
    const contentHtml = this.renderSavedNoteContent(note);
    const details = references.map((reference, index) => {
      return `
        <div>
          <strong>Ref ${index + 1}</strong>
          <pre>${escapeHtml(renderReferenceDetails(reference))}</pre>
        </div>
      `;
    }).join("");

    return `
      <div class="desin-note-card">
        ${hasInlineBadges ? "" : `<div class="desin-note-card__references">${this.renderNoteReferenceBadges(note)}</div>`}
        <div
          class="desin-note-edit"
          data-note-edit-id="${escapeHtml(note.id)}"
          contenteditable="true"
          spellcheck="false"
        >${contentHtml}</div>
        <div class="desin-note-meta">
          <div><strong>Estado</strong><span>${note.done ? "realizado" : "pendiente"}</span></div>
          <div><strong>Scope</strong><span>${escapeHtml(scope)}</span></div>
          <div><strong>Target</strong><span>${escapeHtml(targetLabel)}</span></div>
          <div><strong>Creado</strong><span>${escapeHtml(created)}</span></div>
          <div><strong>Editado</strong><span>${escapeHtml(updated)}</span></div>
          ${details}
        </div>
        <div class="desin-actions">
          <button class="desin-chip" data-action="toggle-note" data-note-id="${escapeHtml(note.id)}" type="button">${note.done ? "Pendiente" : "Realizado"}</button>
          <button class="desin-chip" data-action="remove-note" data-note-id="${escapeHtml(note.id)}" type="button">Eliminar</button>
        </div>
      </div>
    `;
  }

  private renderPopover(): string {
    const selected = this.getActiveSelection() ?? this.state.selections[0];
    if (!selected && this.state.mode !== "idea") {
      return "";
    }

    const body = this.state.mode === "idea"
      ? this.renderIdeaPanel(selected ?? null)
      : selected
        ? this.renderPopoverBody(selected)
        : "";

    return `
      <div class="desin-popover desin-popover--dock">
        <div class="desin-popover__body">${body}</div>
      </div>
    `;
  }

  private renderModeButton(
    action: "mode-select" | "mode-style" | "mode-note" | "mode-breakpoints",
    label: string,
    icon: "cursor" | "sliders" | "note" | "device" | "copy" | "chevron" | "spark" | "trash" | "eye" | "comment" | "pencil" | "task-list" | "check" | "x" | "minimize" | "align-left" | "align-center" | "align-right",
    active = false,
  ): string {
    return `
      <button
        type="button"
        class="desin-icon-button"
        data-action="${action}"
        data-active="${String(active)}"
        title="${escapeHtml(label)}"
      >
        ${this.renderIcon(icon)}
      </button>
    `;
  }

  private renderIcon(
    kind: "cursor" | "sliders" | "note" | "device" | "copy" | "chevron" | "chevron-left" | "chevron-right" | "spark" | "refresh" | "trash" | "eye" | "eye-off" | "comment" | "pencil" | "task-list" | "check" | "x" | "minimize" | "align-left" | "align-center" | "align-right",
  ): string {
    const common = 'width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"';
    const stroke = 'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
    switch (kind) {
      case "cursor":
        return `<svg ${common}><path ${stroke} d="M5 4l10 6-6 2-2 6-2-14z" /></svg>`;
      case "sliders":
        return `<svg ${common}><path ${stroke} d="M4 6h7M4 14h12M12 6v8M8 10h8" /></svg>`;
      case "note":
        return `<svg ${common}><path ${stroke} d="M5 4h10v12H7l-2 2V4z" /><path ${stroke} d="M7 8h6M7 11h4" /></svg>`;
      case "device":
        return `<svg ${common}><rect ${stroke} x="4" y="5" width="12" height="10" rx="2" /><path ${stroke} d="M8 15h4" /></svg>`;
      case "copy":
        return `<svg ${common}><rect ${stroke} x="6" y="5" width="9" height="12" rx="2" /><path ${stroke} d="M8 5V4h5v1M8.5 9h4M8.5 12h4" /></svg>`;
      case "comment":
        return `<svg ${common}><path ${stroke} d="M4 5h12v8H8l-4 3V5z" /><path ${stroke} d="M7 8h6M7 11h4" /></svg>`;
      case "pencil":
        return `<svg ${common}><path ${stroke} d="M4 14.5V17h2.5L15 8.5 12.5 6 4 14.5z" /><path ${stroke} d="M11.5 7l2.5 2.5" /></svg>`;
      case "task-list":
        return `<svg ${common}><path ${stroke} d="M5 6h6M5 10h5M5 14h4" /><path ${stroke} d="M13.5 13.5V16h2.5l1.5-1.5-2.5-2.5-1.5 1.5z" /><path ${stroke} d="M14.5 12l2.5 2.5" /></svg>`;
      case "check":
        return `<svg ${common}><path ${stroke} d="M4 10.5l4 4L16 6" /></svg>`;
      case "x":
        return `<svg ${common}><path ${stroke} d="M6 6l8 8M14 6l-8 8" /></svg>`;
      case "minimize":
        return `<svg ${common}><path ${stroke} d="M5 10h10" /></svg>`;
      case "align-left":
        return `<svg ${common}><path ${stroke} d="M4 6h12M4 10h8M4 14h12" /></svg>`;
      case "align-center":
        return `<svg ${common}><path ${stroke} d="M4 6h12M6 10h8M4 14h12" /></svg>`;
      case "align-right":
        return `<svg ${common}><path ${stroke} d="M4 6h12M8 10h8M4 14h12" /></svg>`;
      case "spark":
        return `<svg ${common}><path ${stroke} d="M10 3l1.2 4.2L15 9l-3.8 1.8L10 15l-1.2-4.2L5 9l3.8-1.8L10 3z" /></svg>`;
      case "refresh":
        return `<svg ${common}><path ${stroke} d="M16 8V4h-4" /><path ${stroke} d="M16 4a6.5 6.5 0 1 0 2 8.3" /><path ${stroke} d="M16 4l2 2" /></svg>`;
      case "trash":
        return `<svg ${common}><path ${stroke} d="M5 6h10M8 6V4h4v2M7 8v7M10 8v7M13 8v7" /></svg>`;
      case "eye":
        return `<svg ${common}><path ${stroke} d="M2.5 10s2.6-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.6 4.5-7.5 4.5S2.5 10 2.5 10z" /><circle ${stroke} cx="10" cy="10" r="2.25" /></svg>`;
      case "eye-off":
        return `<svg ${common}><path ${stroke} d="M3 3l14 14" /><path ${stroke} d="M7.2 7.1C4.4 8.2 2.5 10 2.5 10s2.6 4.5 7.5 4.5c1.2 0 2.3-.3 3.2-.7" /><path ${stroke} d="M9.2 5.6c.3 0 .5-.1.8-.1 4.9 0 7.5 4.5 7.5 4.5s-.8 1.4-2.2 2.6" /><path ${stroke} d="M8.8 8.8A2.25 2.25 0 0 0 11.2 11.2" /></svg>`;
      case "chevron":
        return `<svg ${common}><path ${stroke} d="M6 8l4 4 4-4" /></svg>`;
      case "chevron-left":
        return `<svg ${common}><path ${stroke} d="M11 6l-4 4 4 4" /></svg>`;
      case "chevron-right":
        return `<svg ${common}><path ${stroke} d="M9 6l4 4-4 4" /></svg>`;
      default:
        return `<svg ${common}><path ${stroke} d="M6 8l4 4 4-4" /></svg>`;
    }
  }

  private renderPopoverBody(selected: SelectionTarget): string {
    const activeSelection = this.getActiveSelection() ?? selected;
    const canCopyInstruction = this.state.selections.length > 0;

    return `
      <div class="desin-palette">
        ${this.renderPopoverToolbar()}
        ${this.renderInstructionEditor()}
        ${this.renderExtractPanel()}
        ${this.renderDesignPanel(activeSelection)}
        ${this.renderDesignActions(canCopyInstruction)}
      </div>
    `;
  }

  private renderIdeaPanel(selected: SelectionTarget | null): string {
    const ideas = this.state.notes
      .filter((note) => note.route === currentRoute() && note.kind === "idea")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const openCount = ideas.filter((idea) => !idea.done).length;
    const doneCount = ideas.length - openCount;
    const progress = ideas.length > 0 ? Math.round((doneCount / ideas.length) * 100) : 0;

    return `
      <div class="desin-palette desin-idea-panel">
        <div class="desin-idea-head">
          <strong>Ideas (${escapeHtml(String(ideas.length))})</strong>
          <span>${escapeHtml(String(progress))}%</span>
        </div>
        <div class="desin-idea-composer">
          ${this.renderInstructionEditor("Escribe una idea para desarrollar")}
          <div class="desin-design-actions" aria-label="Acciones de idea">
            <span class="desin-idea-selection">${selected ? `${this.state.selections.length} elementos` : "Sin selección"}</span>
            <button class="desin-icon-button desin-save-button" data-action="add-idea" type="button" title="Guardar idea">
              Guardar
            </button>
            <button class="desin-icon-button" data-action="clear-selection" type="button" title="Limpiar">
              ${this.renderIcon("trash")}
            </button>
            <button class="desin-icon-button" data-action="minimize-popover" type="button" title="Minimizar">
              ${this.renderIcon("minimize")}
            </button>
          </div>
        </div>
        ${ideas.length > 0
          ? `<div class="desin-idea-board">${this.renderIdeasFlatList(ideas)}</div>`
          : ""
        }
      </div>
    `;
  }

  private renderIdeasFlatList(ideas: InspectorNote[]): string {
    if (ideas.length === 0) {
      return "";
    }

    return ideas.map((idea) => this.renderIdeaRow(idea)).join("");
  }

  private renderIdeaRow(idea: InspectorNote): string {
    const referenceCount = idea.selections?.length ?? 0;
    return `
      <div class="desin-idea-row" data-done="${String(idea.done)}">
        <button class="desin-idea-check" data-action="toggle-note" data-note-id="${escapeHtml(idea.id)}" type="button" title="${idea.done ? "Marcar pendiente" : "Marcar realizada"}">
          ${idea.done ? this.renderIcon("check") : ""}
        </button>
        <button class="desin-idea-copy" data-action="open-note" data-note-id="${escapeHtml(idea.id)}" type="button" title="Abrir idea">
          <span>${this.renderSavedNoteContent(idea)}</span>
          <small>${escapeHtml(String(referenceCount))} refs</small>
        </button>
        <button class="desin-note-quick-button" data-action="remove-note" data-note-id="${escapeHtml(idea.id)}" type="button" title="Eliminar idea">${this.renderIcon("x")}</button>
      </div>
    `;
  }

  private renderPopoverToolbar(): string {
    return `
      <div class="desin-palette-toolbar">
        <div class="desin-breakpoint-strip" aria-label="Breakpoints">
          ${this.renderBreakpointChips()}
        </div>
      </div>
    `;
  }

  private renderDesignActions(canCopyInstruction: boolean): string {
    const canCopy = canCopyInstruction && hasActiveBreakpointScope(this.state.scope);
    const showMissingBreakpoint = this.breakpointWarningVisible && !hasActiveBreakpointScope(this.state.scope);
    return `
      <div class="desin-design-actions" aria-label="Acciones de instrucción">
        <div class="desin-breakpoint-strip" data-missing-breakpoint="${String(showMissingBreakpoint)}" aria-label="Breakpoints">
          ${this.renderBreakpointChips()}
        </div>
        <button class="desin-icon-button desin-save-button" data-action="add-note" type="button" title="Guardar">
          Guardar
        </button>
        <button class="desin-icon-button" data-action="copy-instruction" type="button" ${canCopyInstruction ? "" : "disabled"} title="${canCopyInstruction && !hasActiveBreakpointScope(this.state.scope) ? "Defini un breakpoint antes de copiar" : "Copiar instrucción"}">
          ${this.renderIcon("copy")}
        </button>
        <button class="desin-icon-button" data-action="clear-selection" type="button" title="Limpiar">
          ${this.renderIcon("trash")}
        </button>
        <button class="desin-icon-button" data-action="minimize-popover" type="button" title="Minimizar">
          ${this.renderIcon("minimize")}
        </button>
      </div>
    `;
  }

  private renderExtractPanel(): string {
    const collapsed = this.state.extractCollapsed;
    return `
      <div class="desin-panel" data-panel="extract" data-collapsed="${String(collapsed)}">
        <div class="desin-panel__head">
          <div class="desin-panel__title">
            <strong>Estilo</strong>
          </div>
          <button class="desin-icon-button desin-panel__toggle" data-action="toggle-extract-panel" type="button" aria-expanded="${String(!collapsed)}" aria-label="${collapsed ? "Abrir estilo" : "Cerrar estilo"}">
            ${this.renderIcon("chevron")}
          </button>
        </div>
        <div class="desin-panel__body">
          <div class="desin-extract-strip">
            <button class="desin-chip" data-action="extract-style" data-kind="typography" type="button" title="Extraer tipografia">Tipografia</button>
            <button class="desin-chip" data-action="extract-style" data-kind="color" type="button" title="Extraer color">Color</button>
            <button class="desin-chip" data-action="extract-style" data-kind="size" type="button" title="Extraer tamaño">Tamaño</button>
            <button class="desin-chip" data-action="extract-style" data-kind="all" type="button" title="Extraer todo">Todo</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderTextFormatToolbar(selected: SelectionTarget): string {
    const options = [
      { label: "B", title: "Negrita", property: "font-weight", value: "700", resetValue: "400", active: (value: string) => Number.parseInt(value, 10) >= 600 },
      { label: "R", title: "Regular", property: "font-weight", value: "400", resetValue: "700", active: (value: string) => Number.parseInt(value, 10) < 600 },
      { label: "I", title: "Italica", property: "font-style", value: "italic", resetValue: "normal", active: (value: string) => value === "italic" },
      { label: "U", title: "Subrayado", property: "text-decoration-line", value: "underline", resetValue: "none", active: (value: string) => value.includes("underline") },
      { label: "AA", title: "Mayuscula", property: "text-transform", value: "uppercase", resetValue: "none", active: (value: string) => value === "uppercase" },
      { label: "aa", title: "Minuscula", property: "text-transform", value: "lowercase", resetValue: "none", active: (value: string) => value === "lowercase" },
      { label: "Aa", title: "Capitalizar", property: "text-transform", value: "capitalize", resetValue: "none", active: (value: string) => value === "capitalize" },
      { label: "", icon: "align-left", title: "Alinear izquierda", property: "text-align", value: "left", resetValue: "start", active: (value: string) => value === "left" || value === "start" },
      { label: "", icon: "align-center", title: "Centrar", property: "text-align", value: "center", resetValue: "left", active: (value: string) => value === "center" },
      { label: "", icon: "align-right", title: "Alinear derecha", property: "text-align", value: "right", resetValue: "left", active: (value: string) => value === "right" || value === "end" },
    ];

    return `
      <div class="desin-text-format-toolbar" aria-label="Formatos de texto">
        <button class="desin-icon-button desin-icon-button--compact" data-action="text-format-scroll" data-direction="left" type="button" title="Ver formatos anteriores">
          ${this.renderIcon("chevron-left")}
        </button>
        <div class="desin-text-format-strip">
          ${options
            .map((option) => {
              const currentValue = this.getCurrentStyleValue(selected, option.property);
              const active = option.active(currentValue);
              return `
                <button
                  class="desin-format-button"
                  data-action="text-format"
	                  data-property="${escapeHtml(option.property)}"
	                  data-value="${escapeHtml(option.value)}"
	                  data-reset-value="${escapeHtml(option.resetValue)}"
	                  data-active="${String(active)}"
                  type="button"
                  title="${escapeHtml(option.title)}"
	                >${option.icon ? this.renderIcon(option.icon as "align-left" | "align-center" | "align-right") : escapeHtml(option.label)}</button>
              `;
            })
            .join("")}
        </div>
        <button class="desin-icon-button desin-icon-button--compact" data-action="text-format-scroll" data-direction="right" type="button" title="Ver mas formatos">
          ${this.renderIcon("chevron-right")}
        </button>
      </div>
    `;
  }

  private renderDesignPanel(selected: SelectionTarget): string {
    const collapsed = this.state.collapsed;
    return `
      <div class="desin-panel" data-panel="design" data-collapsed="${String(collapsed)}">
        <div class="desin-panel__head">
          <div class="desin-panel__title">
            <strong>Diseño</strong>
          </div>
          <button class="desin-icon-button desin-panel__toggle" data-action="toggle-style-panel" type="button" aria-expanded="${String(!collapsed)}" aria-label="${collapsed ? "Abrir diseño" : "Cerrar diseño"}">
            ${this.renderIcon("chevron")}
          </button>
        </div>
        <div class="desin-panel__body">
          ${this.renderTextFormatToolbar(selected)}
          <div class="desin-controls">
            ${this.renderStyleControl(selected, "background-color")}
            ${this.renderStyleControl(selected, "color")}
            ${this.renderStyleControl(selected, "padding-top")}
            ${this.renderStyleControl(selected, "font-size")}
            ${this.renderStyleControl(selected, "line-height")}
            ${this.renderStyleControl(selected, "border-radius")}
            ${this.renderStyleControl(selected, "gap")}
            ${this.renderStyleControl(selected, "width")}
          </div>
        </div>
      </div>
    `;
  }

  private renderBreakpointPanel(canCopyBundle: boolean): string {
    return `
      <div class="desin-panel" data-panel="breakpoints">
        <div class="desin-row__label"><span>${escapeHtml(resolveViewportBreakpoint(this.breakpoints))}</span><span>${escapeHtml(scopeLabel(this.state.scope))}</span></div>
        <div class="desin-chips">${this.renderBreakpointChips()}</div>
      </div>
    `;
  }

  private renderInstructionEditor(placeholder = "Selecciona elementos y escribe instrucciones"): string {
    const editorHtml = this.decorateInstructionTokens(this.state.activeNoteText);

    return `
      <div class="desin-editor-wrap">
        <div
          class="desin-editor"
          data-note-editor="true"
          contenteditable="true"
          spellcheck="false"
          data-placeholder="${escapeHtml(placeholder)}"
        >${editorHtml}</div>
      </div>
    `;
  }

  private renderBreakpointChip(name: string): string {
    const active = this.state.scope.breakpoints.includes(name);
    return `
      <button
        type="button"
        class="desin-mini-toggle"
        data-breakpoint="${escapeHtml(name)}"
        data-active="${String(active)}"
        title="${escapeHtml(name)}"
      >
        ${this.renderBreakpointIcon(name)}
      </button>
    `;
  }

  private renderBreakpointAllChip(): string {
    const active = this.hasAllBreakpointsSelected();
    return `
      <button
        type="button"
        class="desin-mini-toggle"
        data-action="breakpoints-all"
        data-active="${String(active)}"
        title="Activar todos"
      >
        Todos
      </button>
    `;
  }

  private renderBreakpointIcon(name: string): string {
    const normalized = name.toLowerCase();
    const common = 'width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"';
    const stroke = 'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
    if (normalized.includes("mobile")) {
      return `<svg ${common}><rect ${stroke} x="7" y="3" width="6" height="14" rx="2" /><path ${stroke} d="M9 14h2" /></svg>`;
    }
    if (normalized.includes("tablet")) {
      return `<svg ${common}><rect ${stroke} x="5" y="3" width="10" height="14" rx="2" /><path ${stroke} d="M9 14h2" /></svg>`;
    }
    if (normalized.includes("desktop")) {
      return `<svg ${common}><rect ${stroke} x="3" y="4" width="14" height="10" rx="2" /><path ${stroke} d="M7 17h6M10 14v3" /></svg>`;
    }
    return `<svg ${common}><circle ${stroke} cx="10" cy="10" r="5" /></svg>`;
  }

  private renderBreakpointChips(): string {
    return [this.renderBreakpointAllChip(), ...this.breakpoints.map((breakpoint) => this.renderBreakpointChip(String(breakpoint.name)))].join("");
  }

  private getCurrentNoteReferences(): NoteReference[] {
    const unique = new Map<string, NoteReference>();
    const selections = this.state.selections.length > 0 ? this.state.selections : [];

    for (const selection of selections) {
      unique.set(selection.selector, createNoteReference(selection));
    }

    return [...unique.values()];
  }

  private noteMatchesCurrentThread(note: InspectorNote, selectors: string[]): boolean {
    const references = normalizeNoteReferences(note);
    return references.some((reference) => selectors.includes(reference.selector));
  }

  private renderReferenceBadge(reference: NoteReference, interactive = false): string {
    const title = reference.domPath ?? reference.selector;
    const displayLabel = reference.label;
    const sourceLabel = reference.componentName ?? reference.tagName;
    const details = renderReferenceDetails(reference);

    if (interactive) {
      return `<span class="desin-badge desin-badge--editor" data-note-token="true" data-selector="${escapeHtml(reference.selector)}" draggable="true" contenteditable="false" title="${escapeHtml(title)}"><span class="desin-badge__copy"><strong>${escapeHtml(displayLabel)}</strong></span></span>`;
    }

    return `<span class="desin-badge${interactive ? " desin-badge--editor" : ""}" ${interactive ? `data-note-token="true" data-selector="${escapeHtml(reference.selector)}" draggable="true" contenteditable="false"` : 'tabindex="0"'} title="${escapeHtml(title)}"><span class="desin-badge__icon">${this.renderIcon("copy")}</span><span class="desin-badge__copy"><strong>${escapeHtml(displayLabel)}</strong><span>${escapeHtml(sourceLabel)}</span></span><span class="desin-badge__tooltip" role="tooltip"><pre>${escapeHtml(details)}</pre></span></span>`;
  }

  private renderInstructionSelectionBadge(selection: SelectionTarget): string {
    const active = this.getActiveSelection()?.id === selection.id;
    const label = this.selectionBadgeLabel(selection);
    return `<span class="desin-badge desin-badge--editor" data-note-token="true" data-action="focus-selection" data-selector="${escapeHtml(selection.selector)}" data-selection-id="${escapeHtml(selection.id)}" data-selection-key="${escapeHtml(this.selectionKey(selection))}" data-reference-label="${escapeHtml(label)}" data-active="${String(active)}" draggable="true" contenteditable="false" title="${escapeHtml(selection.domPath || selection.selector)}"><span class="desin-badge__copy"><strong>${escapeHtml(label)}</strong></span></span>&nbsp;`;
  }

  private renderInstructionStyleBadge(label: string, instruction: string): string {
    return `<span class="desin-badge desin-badge--editor desin-badge--style" data-note-token="true" data-style-instruction="${escapeHtml(instruction)}" draggable="true" contenteditable="false" title="${escapeHtml(instruction)}"><span class="desin-badge__copy"><strong>${escapeHtml(label)}</strong></span></span>&nbsp;`;
  }

  private renderNoteReferenceBadges(note: InspectorNote): string {
    const references = note.selections && note.selections.length > 0
      ? note.selections
      : normalizeNoteReferences(note);

    if (references.length === 0) {
      return "";
    }

    return references
      .map((reference, index) => {
        const title = "domPath" in reference
          ? reference.domPath ?? reference.selector
          : reference.domPath ?? reference.selector;
        return `
          <span class="desin-note-reference-badge" title="${escapeHtml(title)}">
            <span>${escapeHtml(`E${index + 1}`)}</span>
          </span>
        `;
      })
      .join("");
  }

  private renderSavedNoteContent(note: InspectorNote): string {
    const content = note.contentHtml ?? note.text;
    if (/[data-note-token="true"]|desin-badge/.test(content)) {
      return content;
    }

    const badges = this.renderNoteReferenceBadges(note);
    const text = escapeHtml(note.text);
    return badges ? `${badges}<span class="desin-note-content__text">${text}</span>` : text;
  }

  private decorateInstructionTokens(html: string): string {
    if (!html) {
      return "";
    }

    const activeSelection = this.getActiveSelection();
    const container = document.createElement("div");
    container.innerHTML = html;
    container.querySelectorAll<HTMLElement>('[data-note-token="true"]').forEach((token) => {
      if (token.dataset.styleInstruction) {
        token.dataset.active = "false";
        token.setAttribute("contenteditable", "false");
        token.setAttribute("draggable", "true");
        return;
      }

      const selectedByKey = token.dataset.selectionKey
        ? this.state.selections.find((selection) => this.selectionKey(selection) === token.dataset.selectionKey)
        : null;
      const selectedById = !selectedByKey && token.dataset.selectionId
        ? this.state.selections.find((selection) => selection.id === token.dataset.selectionId)
        : null;
      const selectorMatches = !selectedByKey && !selectedById && token.dataset.selector
        ? this.state.selections.filter((selection) => selection.selector === token.dataset.selector)
        : [];
      const selected = selectedByKey ?? selectedById ?? (selectorMatches.length === 1 ? selectorMatches[0] : null);

      if (!selected) {
        token.dataset.active = "false";
        return;
      }

      token.dataset.action = "focus-selection";
      token.dataset.selector = selected.selector;
      token.dataset.selectionId = selected.id;
      token.dataset.selectionKey = this.selectionKey(selected);
      token.dataset.active = String(activeSelection?.id === selected.id);
      token.setAttribute("contenteditable", "false");
      token.setAttribute("draggable", "true");
      token.setAttribute("title", selected.domPath || selected.selector);
    });

    return container.innerHTML;
  }

  private selectionBadgeLabel(selection: SelectionTarget): string {
    const source = selection.text || selection.componentName || selection.tagName || selectorToLabel(selection.selector);
    const normalized = source
      .replace(/\s+/g, " ")
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .slice(0, 24);
    const base = normalized || "Elemento";
    const sameBaseSelections = this.state.selections.filter((item) => this.selectionBadgeBaseLabel(item) === base);
    if (sameBaseSelections.length <= 1) {
      return base;
    }

    const occurrence = sameBaseSelections.findIndex((item) => item.id === selection.id || this.selectionKey(item) === this.selectionKey(selection));
    return `${base} ${occurrence >= 0 ? occurrence + 1 : sameBaseSelections.length}`;
  }

  private selectionBadgeBaseLabel(selection: SelectionTarget): string {
    const source = selection.text || selection.componentName || selection.tagName || selectorToLabel(selection.selector);
    return source
      .replace(/\s+/g, " ")
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .slice(0, 24) || "Elemento";
  }

  private renderSelectionChip(selection: SelectionTarget): string {
    const active = this.getActiveSelection()?.id === selection.id;
    const label = this.selectionBadgeLabel(selection);
    return `
      <button
        type="button"
        class="desin-reference-chip"
        data-action="focus-selection"
        data-selection-id="${escapeHtml(selection.id)}"
        data-active="${String(active)}"
        title="${escapeHtml(selection.domPath || selection.selector)}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  private renderNoteComposer(selected: SelectionTarget): string {
    const references = this.getCurrentNoteReferences();
    const selectedSelectors = references.map((reference) => reference.selector);
    const threadNotes = this.state.notes.filter(
      (note) => note.route === currentRoute() && this.noteMatchesCurrentThread(note, selectedSelectors.length > 0 ? selectedSelectors : [selected.selector]),
    );

    return `
      <div class="desin-chat">
        <div class="desin-bubble desin-bubble--assistant">
          <div class="desin-bubble__title">
            <strong>Composer</strong>
            <span>${references.length} refs</span>
          </div>
          <div class="desin-bubble__text">
            Select one or more elements to insert badges into the editor. Drag badges to reorder them, then add text around them.
          </div>
        </div>

        <div class="desin-editor-wrap">
          <div
            class="desin-editor"
            data-note-editor="true"
            contenteditable="true"
            spellcheck="false"
            data-placeholder="Type the instruction here. Selected elements will appear inline as badges."
          >${this.state.activeNoteText}</div>
          <div class="desin-reference-empty">Hover a badge to inspect the full code. Drag it to move it anywhere in the sentence.</div>
          <div class="desin-actions">
            <button class="desin-primary-button" data-action="add-note" type="button">Save note</button>
            <button class="desin-chip" data-action="mode-extract" type="button">Estilo</button>
            <button class="desin-chip" data-action="clear-selection" type="button">Clear selection</button>
            <button class="desin-chip" data-action="copy-instruction" type="button">Copy instruction</button>
          </div>
        </div>

        <div class="desin-row">
          <div class="desin-row__label">
            <span>Thread</span>
            <span>${threadNotes.filter((note) => !note.done).length} open</span>
          </div>
          <div class="desin-list">
            ${
              threadNotes.length > 0
                ? threadNotes
                    .map((note) => {
                      const noteReferences = normalizeNoteReferences(note);
                      const noteTitle = noteReferences.map((reference) => reference.label).join(" + ");
                      return `
                        <div class="desin-note-row">
                          <div class="desin-note-row__meta">
                            <span>${escapeHtml(noteTitle)}</span>
                            <span>${note.done ? "done" : "todo"}</span>
                          </div>
                          <div class="desin-note-content" data-done="${String(note.done)}">
                            ${this.renderSavedNoteContent(note)}
                          </div>
                          <div class="desin-actions">
                            <button class="desin-chip" data-action="toggle-note" data-note-id="${escapeHtml(note.id)}" type="button">${note.done ? "Undo" : "Done"}</button>
                            <button class="desin-chip" data-action="remove-note" data-note-id="${escapeHtml(note.id)}" type="button">Remove</button>
                          </div>
                        </div>
                      `;
                    })
                    .join("")
                : `<div class="desin-reference-empty">No notes yet for this thread.</div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderStyleControl(selected: SelectionTarget, property: string): string {
    const liveElement = findElementForSnapshot(selected);
    const draftValue =
      this.getDraftValueForSelection(selected, property);
    const value = draftValue || selected.computedStyles[property] || (liveElement ? getComputedPreviewValue(liveElement, property) : "") || "";
    const label = STYLE_LABELS[property] ?? property;
    if (isColorProperty(property)) {
      const colorValue = colorToHex(value || "#111111");
      return `
        <label class="desin-control">
          <span class="desin-control__label">${escapeHtml(label)}</span>
          <input
            class="desin-color-input"
            data-property="${escapeHtml(property)}"
            data-control="color"
            type="color"
            value="${escapeHtml(colorValue)}"
            aria-label="${escapeHtml(label)}"
            title="${escapeHtml(colorValue)}"
          />
        </label>
      `;
    }

    if (isSliderProperty(property)) {
      const config = getSliderConfig(property);
      let rawValue = parseNumericStyleValue(value);
      if (property === "line-height") {
        const fontSize = liveElement
          ? parseNumericStyleValue(getComputedPreviewValue(liveElement, "font-size")) || 16
          : 16;
        rawValue = draftValue
          ? Math.round(parseNumericStyleValue(draftValue) * 100)
          : Math.round((rawValue / fontSize) * 100);
        if (!Number.isFinite(rawValue) || rawValue <= 0) {
          rawValue = 150;
        }
      }
      const sliderValue = clamp(rawValue || config.min, config.min, config.max);
      const displayValue = formatNumericStyleValue(property, sliderValue);
      const resetButton = draftValue
        ? `
          <button
            class="desin-slider-reset"
            data-action="style-reset"
            data-property="${escapeHtml(property)}"
            type="button"
            aria-label="Reiniciar ${escapeHtml(label)}"
            title="Reiniciar al valor original"
          >${this.renderIcon("refresh")}</button>
        `
        : "";
      return `
        <label class="desin-control">
          <span class="desin-control__label">${escapeHtml(label)}</span>
          <span class="desin-slider-row">
            ${resetButton}
            <input
              class="desin-slider"
              data-property="${escapeHtml(property)}"
              data-control="slider"
              type="range"
              min="${config.min}"
              max="${config.max}"
              step="${config.step}"
              value="${String(sliderValue)}"
              aria-label="${escapeHtml(label)}"
              title="${escapeHtml(displayValue)}"
            />
          </span>
          <span class="desin-control__value">${escapeHtml(displayValue)}</span>
        </label>
      `;
    }

    return `
      <label class="desin-control">
        <span class="desin-control__label">${escapeHtml(label)}</span>
        <input
          class="desin-input"
          data-property="${escapeHtml(property)}"
          value="${escapeHtml(
            draftValue ?? value,
          )}"
          placeholder="${escapeHtml(label)}"
        />
      </label>
    `;
  }

  private renderCapsule(): string {
    const selecting = this.state.mode === "select";
    const ideas = this.state.mode === "idea";
    const ideaCount = this.state.notes.filter((note) => note.route === currentRoute() && note.kind === "idea").length;
    const ideaBadge = ideaCount > 0 ? escapeHtml(String(ideaCount)) : "";
    return `
      <div class="desin-capsule" data-selecting="${String(selecting)}">
        <button class="desin-icon-button" data-action="mode-select" data-active="${String(selecting)}" type="button" title="Seleccionar">${this.renderIcon("cursor")}</button>
        <button class="desin-icon-button" data-action="toggle-adjustments" type="button" title="${this.state.active ? "Apagar ajustes" : "Encender ajustes"}">${this.renderIcon(this.state.active ? "eye" : "eye-off")}</button>
        <button class="desin-icon-button desin-icon-button--count" data-action="open-ideas" data-active="${String(ideas)}" type="button" title="Ideas">
          ${this.renderIcon("task-list")}
          ${ideaBadge ? `<span class="desin-icon-badge" aria-label="${escapeHtml(`${ideaCount} ideas guardadas`)}">${ideaBadge}</span>` : ""}
        </button>
        <button class="desin-icon-button" data-action="copy-instruction" type="button" title="Copiar">${this.renderIcon("copy")}</button>
        <button class="desin-icon-button" data-action="clear-adjustments" type="button" title="Eliminar ajustes">${this.renderIcon("trash")}</button>
      </div>
    `;
  }

  private renderLauncher(): string {
    return `
      <button class="desin-launcher" data-action="show-inspector" type="button" title="Show inspector">
        <span class="desin-launcher__badge">${this.renderIcon("cursor")}</span>
      </button>
    `;
  }

  private renderToast(): string {
    if (!this.state.toast) {
      return "";
    }

    return `<div class="desin-toast">${escapeHtml(this.state.toast)}</div>`;
  }

  private render(): void {
    if (this.disposed) {
      return;
    }

    this.updateBundleText();
    this.shadow.innerHTML = "";
    this.shadow.appendChild(this.styleElement);
    const shell = document.createElement("div");
    shell.className = "desin-shell";
    const activeOverlay = this.state.active
      ? `${this.renderSelectionLayer()}${this.state.mode === "idle" ? "" : this.renderPopover()}`
      : "";
    shell.innerHTML = this.state.hidden
      ? this.renderLauncher()
      : `${activeOverlay}${this.renderCapsule()}${this.renderToast()}`;
    this.shadow.appendChild(shell);
    this.overlayHost = shell;
    const animationKey = [
      this.state.hidden ? "hidden" : "open",
      this.state.mode,
      this.state.selections.map((selection) => selection.selector).join("|"),
    ].join(":");
    const shouldAnimateOverlay = animationKey !== this.lastOverlayAnimationKey;
    this.lastOverlayAnimationKey = animationKey;
    if (shouldAnimateOverlay) {
      requestAnimationFrame(() => this.animateOverlay());
    }

    if (this.state.toast && this.toastTimeout === null) {
      this.toastTimeout = window.setTimeout(() => {
        this.state.toast = null;
        this.toastTimeout = null;
        this.scheduleRender();
      }, 1400);
    }

    if (this.composerFocusPending && (this.state.mode === "note" || this.state.mode === "idea")) {
      this.focusComposerEditor();
      this.composerFocusPending = false;
    }

    this.persistState();
  }

  private animateOverlay(): void {
    if (!this.overlayHost || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const popover = this.overlayHost.querySelector<HTMLElement>(".desin-popover");
    const capsule = this.overlayHost.querySelector<HTMLElement>(".desin-capsule");
    const launcher = this.overlayHost.querySelector<HTMLElement>(".desin-launcher");
    const controls = Array.from(this.overlayHost.querySelectorAll<HTMLElement>(".desin-control, .desin-palette-tabs .desin-icon-button"));

    if (popover) {
      gsap.fromTo(
        popover,
        { autoAlpha: 0, xPercent: -50, y: 10, scale: 0.96, transformOrigin: "center bottom" },
        { autoAlpha: 1, xPercent: -50, y: 0, scale: 1, duration: 0.28, ease: "back.out(1.7)", overwrite: "auto" },
      );
    }

    if (capsule) {
      gsap.fromTo(
        capsule,
        { autoAlpha: 0, xPercent: -50, y: 8, scale: 0.92 },
        { autoAlpha: 1, xPercent: -50, y: 0, scale: 1, duration: 0.24, ease: "back.out(1.9)", overwrite: "auto" },
      );
    }

    if (launcher) {
      gsap.fromTo(
        launcher,
        { autoAlpha: 0, xPercent: -50, y: 8, scale: 0.85 },
        { autoAlpha: 1, xPercent: -50, y: 0, scale: 1, duration: 0.22, ease: "back.out(2)", overwrite: "auto" },
      );
    }

    if (controls.length > 0) {
      gsap.fromTo(
        controls,
        { autoAlpha: 0, y: 3 },
        { autoAlpha: 1, y: 0, duration: 0.18, ease: "power2.out", stagger: 0.012, overwrite: "auto" },
      );
    }

    for (const button of Array.from(this.overlayHost.querySelectorAll<HTMLElement>(".desin-icon-button, .desin-chip"))) {
      button.addEventListener("pointerenter", () => {
        gsap.to(button, { y: -1, scale: 1.08, duration: 0.16, ease: "power2.out", overwrite: "auto" });
      });
      button.addEventListener("pointerleave", () => {
        gsap.to(button, { y: 0, scale: 1, duration: 0.2, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
      });
    }
  }

  private clearOriginalPreviewStyles(element: HTMLElement): void {
    const backup = this.originalInlineStyles.get(element);
    if (!backup) {
      return;
    }

    for (const [property, value] of backup.entries()) {
      if (value) {
        element.style.setProperty(property, value);
      } else {
        element.style.removeProperty(property);
      }
    }
  }

  private restoreOriginalPreviewProperty(element: HTMLElement, property: string): void {
    const backup = this.originalInlineStyles.get(element);
    const originalValue = backup?.get(property) ?? "";
    if (originalValue) {
      element.style.setProperty(property, originalValue);
      return;
    }

    element.style.removeProperty(property);
  }

  private applyPreviewToElement(element: HTMLElement, property: string, value: string): void {
    const backup = this.originalInlineStyles.get(element) ?? new Map<string, string>();
    if (!this.originalInlineStyles.has(element)) {
      this.originalInlineStyles.set(element, backup);
    }

    if (!backup.has(property)) {
      backup.set(property, element.style.getPropertyValue(property));
    }

    element.style.setProperty(property, value, "important");
  }

  private clearSelectionPreviewStyles(): void {
    this.restoreSelectionPreviewStyles();
    this.state.drafts = [];
  }

  private restoreSelectionPreviewStyles(): void {
    for (const selection of this.state.selections) {
      const element = findElementForSnapshot(selection);
      if (element) {
        this.clearOriginalPreviewStyles(element);
      }
    }
  }

  private findSelectedElements(): HTMLElement[] {
    return this.state.selections
      .map((selection) => findElementForSnapshot(selection))
      .filter((element): element is HTMLElement => Boolean(element));
  }

  private resolveStyleScope(): StyleScope {
    return normalizeScope(this.state.scope);
  }

  private reapplyStyleDrafts(): void {
    for (const draft of this.state.drafts) {
      if (draft.property.startsWith("extract:")) {
        continue;
      }

      for (const element of this.findElementsForDraft(draft)) {
        this.applyPreviewToElement(element, draft.property, draft.value);
      }
    }
  }

  private toggleAdjustmentsVisibility(): void {
    this.state.active = !this.state.active;
    if (this.state.active) {
      this.reapplyStyleDrafts();
      this.state.toast = "Ajustes visibles";
    } else {
      this.restoreSelectionPreviewStyles();
      this.state.toast = "Ajustes ocultos";
    }
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  private setSelectionScope(scope: StyleScope): void {
    this.state.scope = normalizeScope(scope);
    this.persistState();
    this.scheduleRender();
  }

  private cleanupPreview(element: HTMLElement): void {
    this.clearOriginalPreviewStyles(element);
  }

  private onStatefulCopy(): void {
    this.state.toast = "Change Bundle copied";
    this.scheduleRender();
  }

  activate(): void {
    this.state.active = true;
    this.state.hidden = false;
    this.reapplyStyleDrafts();
    this.scheduleRender();
  }

  deactivate(): void {
    this.state.active = false;
    this.restoreSelectionPreviewStyles();
    this.scheduleRender();
  }

  toggle(): void {
    this.state.hidden = false;
    this.toggleAdjustmentsVisibility();
  }

  hide(): void {
    this.state.hidden = true;
    this.persistState();
    this.scheduleRender();
  }

  show(): void {
    this.state.hidden = false;
    this.persistState();
    this.scheduleRender();
  }

  setMode(mode: InspectorMode): void {
    this.state.mode = mode;
    if (mode !== "select") {
      this.state.hoverTarget = null;
      this.state.dragRect = null;
      this.state.pointerMode = "idle";
    }
    if (mode === "select") {
      this.state.toast = "Select an element";
    }
    this.persistState();
    this.scheduleRender();
  }

  selectElement(element: Element, additive = false): void {
    this.updateSelectionFromElement(element, additive);
  }

  clearSelections(): void {
    this.clearSelectionPreviewStyles();
    this.state.selections = [];
    this.state.activeSelectionId = null;
    this.state.activeNoteId = null;
    this.state.hoverTarget = null;
    this.state.toast = "Selection cleared";
    this.state.activeNoteText = "";
    this.noteEditorRange = null;
    this.draggedNoteElement = null;
    this.updateBundleText();
    this.scheduleRender();
  }

  addNote(text: string): void {
    const trimmed = cleanInstructionText(text);
    const selection = this.getActiveSelection();
    const kind: InspectorNote["kind"] = this.state.mode === "idea" ? "idea" : "comment";
    if (!trimmed) {
      this.state.toast = kind === "idea" ? "Escribe la idea" : "Escribe el comentario";
      this.scheduleRender();
      return;
    }
    if (!selection && kind !== "idea") {
      this.state.toast = "Selecciona un elemento";
      this.scheduleRender();
      return;
    }
    const category = kind === "idea" ? this.state.activeIdeaCategory : undefined;
    const noteMeta = category ? { kind, category } : { kind };
    const selections = selection ? this.state.selections.map((item) => ({ ...item })) : [];
    const drafts = selection
      ? this.state.drafts
          .filter((draft) => this.draftTargetsCurrentSelection(draft))
          .map((draft) => ({
            ...draft,
            targetIds: [...draft.targetIds],
            scope: normalizeScope(draft.scope),
          }))
      : [];
    const references = selection ? this.getCurrentNoteReferences() : [];
    const selector = selection?.selector ?? "";
    const source = selection?.source ?? null;

    if (this.state.activeNoteId && this.state.notes.some((note) => note.id === this.state.activeNoteId)) {
      const activeNoteId = this.state.activeNoteId;
      this.state.notes = this.state.notes.map((note) =>
        note.id === activeNoteId
          ? {
              ...note,
              selector: selection?.selector ?? note.selector,
              ...noteMeta,
              text: trimmed,
              contentHtml: text,
              references: selection ? references : note.references ?? [],
              selections,
              drafts,
              scope: this.resolveStyleScope(),
              instructionHtml: text,
              updatedAt: Date.now(),
              source: source ?? note.source ?? null,
            }
          : note,
      );
      this.state.toast = kind === "idea" ? "Idea actualizada" : "Comentario actualizado";
      this.state.activeNoteId = null;
      this.state.activeNoteText = "";
      this.state.mode = "idle";
      this.noteEditorRange = null;
      this.draggedNoteElement = null;
      this.composerFocusPending = false;
      this.persistState();
      this.updateBundleText();
      this.scheduleRender();
      return;
    }

    const note: InspectorNote = {
      id: uid("note"),
      route: currentRoute(),
      selector,
      ...noteMeta,
      text: trimmed,
      contentHtml: text,
      references,
      selections,
      drafts,
      scope: this.resolveStyleScope(),
      instructionHtml: text,
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source,
    };

    this.state.notes = [note, ...this.state.notes];
    this.state.toast = kind === "idea" ? "Idea guardada" : "Comentario guardado";
    this.state.activeNoteId = null;
    this.state.activeNoteText = "";
    this.state.mode = "idle";
    this.noteEditorRange = null;
    this.draggedNoteElement = null;
    this.composerFocusPending = false;
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  toggleNote(noteId: string): void {
    this.state.notes = this.state.notes.map((note) =>
      note.id === noteId
        ? { ...note, done: !note.done, updatedAt: Date.now() }
        : note,
    );
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  removeNote(noteId: string): void {
    this.state.notes = this.state.notes.filter((note) => note.id !== noteId);
    if (this.state.activeNoteId === noteId) {
      this.state.activeNoteId = null;
      this.state.activeNoteText = "";
    }
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  applyStyle(property: string, value: string, options: { render?: boolean } = {}): void {
    const activeSelection = this.getActiveSelection();
    if (!activeSelection) {
      return;
    }

    const normalized = value.trim();
    const target = findElementForSnapshot(activeSelection);
    const targets = target ? [target] : [];
    const targetIds = [this.selectionKey(activeSelection)];
    for (const element of targets) {
      if (!normalized) {
        element.style.removeProperty(property);
        continue;
      }
      this.applyPreviewToElement(element, property, normalized);
    }

    this.state.drafts = [
      ...this.state.drafts.filter((draft) => draft.property !== property || !this.draftTargetsSameSelection(draft, targetIds)),
      {
        id: uid("draft"),
        property,
        value: normalized,
        scope: this.resolveStyleScope(),
        targetIds,
        createdAt: Date.now(),
      },
    ];
    this.state.toast = `${property} updated`;
    this.persistState();
    this.updateBundleText();
    if (options.render !== false) {
      this.scheduleRender();
    }
  }

  private resetStyleProperty(property: string): void {
    const activeSelection = this.getActiveSelection();
    if (!activeSelection) {
      return;
    }

    const targetIds = [this.selectionKey(activeSelection)];
    const target = findElementForSnapshot(activeSelection);
    if (target) {
      this.restoreOriginalPreviewProperty(target, property);
    }

    this.state.drafts = this.state.drafts.filter(
      (draft) => draft.property !== property || !this.draftTargetsSameSelection(draft, targetIds),
    );
    this.state.toast = `${property} reiniciado`;
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  private getCurrentStyleValue(selected: SelectionTarget, property: string): string {
    const draft = this.getDraftValueForSelection(selected, property);
    if (draft) {
      return draft;
    }

    const liveElement = findElementForSnapshot(selected);
    if (liveElement) {
      return getComputedPreviewValue(liveElement, property);
    }

    return selected.computedStyles[property] || "";
  }

  private stepStyleProperty(property: string, direction: -1 | 1): void {
    const selected = this.getActiveSelection();
    if (!selected || !isSliderProperty(property)) {
      return;
    }

    const control = this.shadow.querySelector<HTMLElement>(`[data-property="${CSS.escape(property)}"]`)?.closest(".desin-control");
    const range = control?.querySelector<HTMLInputElement>('input[type="range"]');
    const current = range ? Number.parseFloat(range.value) : Number.parseFloat(this.getCurrentStyleValue(selected, property));
    const config = getSliderConfig(property);
    const next = clamp((Number.isFinite(current) ? current : config.min) + direction * config.step, config.min, config.max);
    this.applyStyle(property, formatNumericStyleValue(property, next));
  }

  clearStylePreview(): void {
    this.clearSelectionPreviewStyles();
    this.persistState();
    this.updateBundleText();
    this.scheduleRender();
  }

  async copyBundle(): Promise<string> {
    const routeNotes = this.getRouteCommentNotes();
    if (routeNotes.length > 0) {
      if (this.openFirstSavedNoteMissingBreakpoint(routeNotes)) {
        return "";
      }
    } else if (!this.requireBreakpoint("copiar")) {
      return "";
    }

    const bundle = routeNotes.length > 0
      ? this.renderAdjustmentDocuments()
      : renderChangeBundle({
          route: currentRoute(),
          scope: this.state.scope,
          selections: this.state.selections,
          notes: routeNotes,
          drafts: this.state.drafts,
          structureContext: buildStructureContext(this.state.selections),
          instructionHtml: this.state.activeNoteText,
        });
    this.state.bundleText = bundle;

    await navigator.clipboard.writeText(bundle);
    this.state.toast = "Change Bundle copied";
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.onStatefulCopy();
    this.scheduleRender();
    this.options.onChangeBundle?.(bundle, this.state.selections);
    return bundle;
  }

  getState(): InspectorState {
    return {
      ...this.state,
      notes: [...this.state.notes],
      selections: [...this.state.selections],
      drafts: [...this.state.drafts],
      scope: normalizeScope(this.state.scope),
      hoverTarget: this.state.hoverTarget,
      dragRect: this.state.dragRect ? { ...this.state.dragRect } : null,
      activeSelectionId: this.state.activeSelectionId,
      activeNoteId: this.state.activeNoteId,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unbindEvents();
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    if (this.noteHoverTimeout !== null) {
      window.clearTimeout(this.noteHoverTimeout);
      this.noteHoverTimeout = null;
    }
    if (this.colorPickerReleaseTimer !== null) {
      window.clearTimeout(this.colorPickerReleaseTimer);
      this.colorPickerReleaseTimer = null;
    }
    this.root.remove();
  }
}

export function createDefaultStorage(): InspectorStorage {
  return typeof window !== "undefined" ? createLocalStorageStorage() : createNoopStorage();
}

export function initRuntime(options: InspectorOptions = {}): InspectorAPI {
  const runtime = new DesinInspectorRuntime(options);
  return runtime;
}
