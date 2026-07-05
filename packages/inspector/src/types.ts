export type InspectorFramework = "auto" | "react" | "vanilla";

export type InspectorMode = "idle" | "select" | "style" | "note" | "idea" | "breakpoints" | "bundle";

export type BreakpointName = "mobile" | "tablet" | "desktop" | string;

export interface BreakpointRange {
  name: BreakpointName;
  min: number;
  max?: number;
}

export interface SourceInfo {
  filePath: string;
  lineNumber: number | null;
  componentName: string | null;
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionTarget {
  id: string;
  selector: string;
  domPath: string;
  tagName: string;
  text: string;
  rect: RectLike;
  componentName?: string | null;
  source?: SourceInfo | null;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  outerHTML: string;
}

export interface StructureElementSummary {
  selector: string;
  domPath: string;
  tagName: string;
  classes: string[];
  text: string;
  position?: RectLike;
}

export interface StructureSiblingSummary extends StructureElementSummary {
  relation: "previous" | "selected" | "next";
}

export interface StructureContext {
  relationship: string;
  commonAncestor: StructureElementSummary | null;
  commonAncestorSelector: string | null;
  commonAncestorLayout: Record<string, string>;
  currentDomOrder: string[];
  selectedDomOrder: string[];
  selectedVisualOrder: string[];
  siblingContext: StructureSiblingSummary[];
  likelyEditTarget: string;
}

export interface StyleScope {
  mode: "global" | "scoped";
  breakpoints: BreakpointName[];
}

export interface StyleDraft {
  id: string;
  property: string;
  value: string;
  scope: StyleScope;
  targetIds: string[];
  createdAt: number;
}

export interface NoteReference {
  selector: string;
  domPath?: string;
  label: string;
  tagName: string;
  rect?: RectLike;
  componentName?: string | null;
  source?: SourceInfo | null;
  outerHTML?: string;
}

export interface InspectorNote {
  id: string;
  route: string;
  selector: string;
  kind?: "comment" | "idea";
  category?: string;
  text: string;
  contentHtml?: string;
  references?: NoteReference[];
  selections?: SelectionTarget[];
  drafts?: StyleDraft[];
  scope?: StyleScope;
  instructionHtml?: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  source?: SourceInfo | null;
}

export interface PersistedInspectorState {
  hidden: boolean;
  collapsed: boolean;
  extractCollapsed?: boolean;
  active?: boolean;
  activeMode: InspectorMode;
  stylePanel?: "edit" | "extract";
  activeSelectionId?: string | null;
  activeNoteId?: string | null;
  activeIdeaCategory?: string;
  ideasCollapsed?: boolean;
  scope: StyleScope;
  notes: InspectorNote[];
  selections?: SelectionTarget[];
  drafts?: StyleDraft[];
  activeNoteText?: string;
}

export interface InspectorStorage {
  load(): Promise<PersistedInspectorState | null> | PersistedInspectorState | null;
  save(state: PersistedInspectorState): Promise<void> | void;
}

export interface InspectorTheme {
  accent: string;
  accentSoft: string;
  accentMuted: string;
}

export interface InspectorOptions {
  enabled?: boolean;
  framework?: InspectorFramework;
  breakpoints?: BreakpointRange[];
  storage?: InspectorStorage;
  theme?: Partial<InspectorTheme>;
  sourceResolver?: (element: Element) => SourceInfo | null;
  onChangeBundle?: (bundle: string, targets: SelectionTarget[]) => void;
}

export interface InspectorState {
  hidden: boolean;
  collapsed: boolean;
  extractCollapsed: boolean;
  active: boolean;
  mode: InspectorMode;
  stylePanel: "edit" | "extract";
  scope: StyleScope;
  hoverTarget: SelectionTarget | null;
  selections: SelectionTarget[];
  notes: InspectorNote[];
  drafts: StyleDraft[];
  toast: string | null;
  dragRect: RectLike | null;
  pointerMode: "idle" | "selecting" | "dragging";
  activeNoteText: string;
  bundleText: string;
  activeSelectionId: string | null;
  activeNoteId: string | null;
  activeIdeaCategory: string;
  ideasCollapsed: boolean;
}

export interface InspectorAPI {
  activate(): void;
  deactivate(): void;
  toggle(): void;
  hide(): void;
  show(): void;
  setMode(mode: InspectorMode): void;
  selectElement(element: Element, additive?: boolean): void;
  clearSelections(): void;
  addNote(text: string): void;
  toggleNote(noteId: string): void;
  removeNote(noteId: string): void;
  applyStyle(property: string, value: string): void;
  clearStylePreview(): void;
  copyBundle(): Promise<string>;
  getState(): InspectorState;
  dispose(): void;
}

export interface ChangeBundlePayload {
  route: string;
  scope: StyleScope;
  selections: SelectionTarget[];
  notes: InspectorNote[];
  drafts: StyleDraft[];
  structureContext?: StructureContext | null;
  instructionHtml?: string;
}
