import type {
  ChangeBundlePayload,
  NoteReference,
  RectLike,
  SelectionTarget,
  StyleDraft,
  StructureContext,
  StructureElementSummary,
  StructureSiblingSummary,
  SourceInfo,
} from "./types";

const COMPARISON_PROPERTIES = [
  "display",
  "position",
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
  "background-color",
  "color",
  "border-radius",
  "border-width",
  "border-style",
  "border-color",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "font-style",
  "gap",
  "align-items",
  "justify-content",
] as const;

const STRUCTURE_LAYOUT_PROPERTIES = [
  "display",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "flex-direction",
  "gap",
  "row-gap",
  "column-gap",
  "align-items",
  "justify-content",
] as const;

function clampValue(value: string): string {
  return value.replaceAll("\n", " ").trim();
}

function formatClassSegment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  const classes = Array.from(element.classList).filter(Boolean);
  const [firstClass, ...restClasses] = classes;
  const idSuffix = id ? `#${id}` : "";
  const primaryClass = firstClass ? `.${firstClass}` : "";
  const restSuffix = restClasses.length > 0 ? ` ${restClasses.join(" ")}` : "";
  return `${tag}${idSuffix}${primaryClass}${restSuffix}`;
}

function formatElementLabel(element: Element): string {
  const classes = Array.from(element.classList).filter(Boolean);
  const primaryClass = classes[0] ? `.${classes[0]}` : "";
  return `${element.tagName.toLowerCase()}${primaryClass}`;
}

function elementSiblingIndex(element: Element): number | null {
  const parent = element.parentElement;
  if (!parent) {
    return null;
  }

  const sameTagSiblings = Array.from(parent.children).filter(
    (candidate) => candidate.tagName === element.tagName,
  );

  if (sameTagSiblings.length <= 1) {
    return null;
  }

  return sameTagSiblings.indexOf(element);
}

export function buildDomPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.tagName.toLowerCase() !== "html") {
    if (current.tagName.toLowerCase() === "body" || current.getAttribute("id") === "root") {
      current = current.parentElement;
      continue;
    }

    const index = elementSiblingIndex(current);
    const segment = `${formatClassSegment(current)}${index !== null && !current.getAttribute("id") ? `[${index}]` : ""}`;
    segments.unshift(segment);
    current = current.parentElement;
  }

  return segments.join(" > ");
}

function getParentDomPath(domPath: string): string | null {
  const segments = domPath.split(" > ").filter(Boolean);
  if (segments.length <= 1) {
    return null;
  }

  return segments.slice(0, -1).join(" > ");
}

function findSelectedElement(selection: SelectionTarget): HTMLElement | null {
  try {
    const allElements = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const byGlobalDomPath = allElements.find((element) => buildDomPath(element) === selection.domPath);
    if (byGlobalDomPath) {
      return byGlobalDomPath;
    }

    const matches = Array.from(document.querySelectorAll<HTMLElement>(selection.selector));
    if (matches.length === 1) {
      const onlyMatch = matches[0] ?? null;
      if (!onlyMatch) {
        return null;
      }
      const rect = onlyMatch.getBoundingClientRect();
      const distance =
        Math.abs(rect.x - selection.rect.x) +
        Math.abs(rect.y - selection.rect.y) +
        Math.abs(rect.width - selection.rect.width) +
        Math.abs(rect.height - selection.rect.height);
      return distance < 8 ? onlyMatch : null;
    }

    const byDomPath = matches.find((element) => buildDomPath(element) === selection.domPath);
    if (byDomPath) {
      return byDomPath;
    }

    const nearest = matches
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const distance =
          Math.abs(rect.x - selection.rect.x) +
          Math.abs(rect.y - selection.rect.y) +
          Math.abs(rect.width - selection.rect.width) +
          Math.abs(rect.height - selection.rect.height);
        return { element, distance };
      })
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest && nearest.distance < 8 ? nearest.element : null;
  } catch {
    return null;
  }
}

function summarizeElement(element: Element): StructureElementSummary {
  const rect = element.getBoundingClientRect();
  return {
    selector: createStableSelector(element),
    domPath: buildDomPath(element),
    tagName: element.tagName.toLowerCase(),
    classes: Array.from(element.classList).filter(Boolean),
    text: getTextPreview(element),
    position: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

function summarizeLayout(element: Element | null): Record<string, string> {
  if (!element) {
    return {};
  }

  const styles = window.getComputedStyle(element);
  const result: Record<string, string> = {};
  for (const property of STRUCTURE_LAYOUT_PROPERTIES) {
    const value = styles.getPropertyValue(property).trim();
    if (value) {
      result[property] = value;
    }
  }
  return result;
}

function findCommonAncestor(elements: HTMLElement[]): HTMLElement | null {
  const [first, ...rest] = elements;
  if (!first) {
    return null;
  }

  let current: HTMLElement | null = first;
  while (current) {
    if (current === document.body || current === document.documentElement) {
      return null;
    }

    if (rest.every((element) => current?.contains(element))) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function directChildWithinAncestor(element: HTMLElement, ancestor: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current?.parentElement && current.parentElement !== ancestor) {
    current = current.parentElement;
  }
  return current?.parentElement === ancestor ? current : null;
}

function uniqueElements(elements: Array<HTMLElement | null>): HTMLElement[] {
  return Array.from(new Set(elements.filter((element): element is HTMLElement => Boolean(element))));
}

function buildSiblingContext(commonAncestor: HTMLElement, selectedChildren: HTMLElement[]): StructureSiblingSummary[] {
  const children = Array.from(commonAncestor.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const selectedSet = new Set(selectedChildren);
  const selectedIndexes = selectedChildren
    .map((child) => children.indexOf(child))
    .filter((index) => index >= 0);

  if (selectedIndexes.length === 0) {
    return [];
  }

  const min = Math.max(0, Math.min(...selectedIndexes) - 1);
  const max = Math.min(children.length - 1, Math.max(...selectedIndexes) + 1);

  return children.slice(min, max + 1).map((child) => {
    const relation: StructureSiblingSummary["relation"] = selectedSet.has(child)
      ? "selected"
      : children.indexOf(child) < Math.min(...selectedIndexes)
        ? "previous"
        : "next";
    return {
      ...summarizeElement(child),
      relation,
    };
  });
}

function orderLabels(elements: HTMLElement[]): string[] {
  return elements.map((element) => formatElementLabel(element));
}

function formatStructureElement(summary: StructureElementSummary | null): string {
  if (!summary) {
    return "none within selected region";
  }

  const classes = summary.classes.length > 0 ? `.${summary.classes.join(".")}` : "none";
  return `${summary.domPath} | selector: ${summary.selector} | tag: ${summary.tagName} | classes: ${classes}`;
}

function formatLayout(layout: Record<string, string>): string {
  const entries = Object.entries(layout);
  if (entries.length === 0) {
    return "unknown";
  }

  return entries.map(([property, value]) => `${property}: ${value}`).join(" | ");
}

function formatOrder(values: string[]): string {
  return values.length > 0 ? values.join(" > ") : "unknown";
}

function formatSiblingContext(siblings: StructureSiblingSummary[]): string {
  if (siblings.length === 0) {
    return "none";
  }

  return siblings
    .map((sibling) => {
      const text = sibling.text ? ` | text: "${sibling.text}"` : "";
      return `${sibling.relation}: ${sibling.domPath}${text}`;
    })
    .join("\n");
}

function inferRequestedOrder(instructionText: string, selections: SelectionTarget[]): string | null {
  if (selections.length !== 2 || !instructionText) {
    return null;
  }

  const normalized = instructionText.toLowerCase();
  const [first, second] = selections;
  const firstLabel = first?.tagName ?? first?.selector ?? "first selection";
  const secondLabel = second?.tagName ?? second?.selector ?? "second selection";

  if (/\b(below|under|after)\b|debajo|por debajo|despues|después/.test(normalized)) {
    return `${secondLabel} before ${firstLabel}`;
  }

  if (/\b(above|over|before)\b|encima|arriba|por encima|antes/.test(normalized)) {
    return `${firstLabel} before ${secondLabel}`;
  }

  return null;
}

function extractInstructionElementIndexes(instructionText: string, selections: SelectionTarget[]): number[] {
  if (!instructionText) {
    return [];
  }

  const indexes: number[] = [];
  const seen = new Set<number>();
  for (const match of instructionText.matchAll(/\[E(\d+)\]/gi)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < selections.length && !seen.has(index)) {
      seen.add(index);
      indexes.push(index);
    }
  }
  return indexes;
}

function getSelectionElement(selection: SelectionTarget): HTMLElement | null {
  return typeof document === "undefined" ? null : findSelectedElement(selection);
}

function describeInstructionSelection(selection: SelectionTarget, index: number): string {
  const text = selection.text ? ` | text: "${selection.text}"` : "";
  return `E${index + 1} exact ${selection.tagName} | selector: ${selection.selector} | DOM Path: ${selection.domPath}${text}`;
}

function inferInstructionAnchorIndex(instructionText: string, referencedIndexes: number[]): number | null {
  if (!instructionText || referencedIndexes.length === 0) {
    return null;
  }

  const anchorPattern = /(?:below|under|after|beneath|debajo|por debajo|despues|después|justo debajo|justo despues|justo después)\s+(?:de\s+)?(?:este|esta|this|the)?\s*\[E(\d+)\]/i;
  const match = instructionText.match(anchorPattern);
  if (!match) {
    return null;
  }

  const index = Number(match[1]) - 1;
  return referencedIndexes.includes(index) ? index : null;
}

function formatElementRefs(indexes: number[]): string {
  return indexes.map((index) => `[E${index + 1}]`).join(", ");
}

function formatPlainElementRefs(indexes: number[]): string {
  return indexes.map((index) => `E${index + 1}`).join(", ");
}

function inferInstructionContainerIndex(
  instructionText: string,
  selections: SelectionTarget[],
  referencedIndexes: number[],
): number | null {
  if (!instructionText || referencedIndexes.length === 0) {
    return null;
  }

  const normalized = instructionText.toLowerCase();
  const mentionsInsideTarget = /\binside\b|\bwithin\b|\bin(?:to)?\b|dentro|adentro|en este componente|este componente/.test(normalized);
  if (!mentionsInsideTarget) {
    return null;
  }

  const referencedElements = referencedIndexes.map((index) => ({
    index,
    element: getSelectionElement(selections[index] as SelectionTarget),
  }));

  const containingCandidate = referencedElements.find(({ element }, candidateIndex) => {
    if (!element) {
      return false;
    }

    return referencedElements.some(({ element: other }, otherIndex) => (
      candidateIndex !== otherIndex && Boolean(other) && element.contains(other)
    ));
  });

  if (containingCandidate) {
    return containingCandidate.index;
  }

  const firstReferencedIndex = referencedIndexes[0] ?? null;
  return firstReferencedIndex;
}

function renderInstructionPrecisionGuide(instructionText: string, selections: SelectionTarget[]): string | null {
  const referencedIndexes = extractInstructionElementIndexes(instructionText, selections);
  if (referencedIndexes.length === 0) {
    return null;
  }

  const containerIndex = inferInstructionContainerIndex(instructionText, selections, referencedIndexes);
  const anchorIndex = inferInstructionAnchorIndex(instructionText, referencedIndexes);
  const placementItemIndexes = anchorIndex !== null
    ? referencedIndexes.filter((index) => index !== anchorIndex && index !== containerIndex)
    : [];
  const referencedLines = referencedIndexes.map((index) =>
    `- ${describeInstructionSelection(selections[index] as SelectionTarget, index)}`,
  );
  const guardrails = [
    "Precision rules:",
    ...referencedLines,
    anchorIndex !== null && containerIndex === null && placementItemIndexes.length > 0
      ? `- Place only ${formatElementRefs(placementItemIndexes)} immediately below [E${anchorIndex + 1}]. These are the exact selected elements, not their parent cards, wrappers, or section.`
      : null,
    containerIndex !== null
      ? `- Treat [E${containerIndex + 1}] as the exact destination element, not its parent, ancestor, or surrounding layout block.`
      : "- Apply the request only to the referenced [E#] elements, not to their common ancestor unless the instruction explicitly says so.",
    anchorIndex !== null
      ? `- Use [E${anchorIndex + 1}] as the exact placement anchor; insert requested elements immediately relative to that element.`
      : null,
    "- Do not rewrite or move sibling sections, wrapper layout, or unrelated content unless one of those exact elements is explicitly referenced.",
  ];

  return guardrails.filter(Boolean).join("\n");
}

function renderTaskContext(payload: ChangeBundlePayload): string {
  const scope = payload.scope.breakpoints.length > 0
    ? payload.scope.breakpoints.join(", ")
    : "not defined";
  const targetCount = payload.selections.length;

  return [
    `Route: ${payload.route}`,
    `Breakpoint scope: ${scope}`,
    `Selected targets: ${targetCount}`,
    targetCount > 0
      ? "Reference contract: every [E#] token points to the exact matching element in Selected elements. Use its source/component first; use the selector and DOM Path as fallbacks."
      : "Reference contract: no element target is attached to this request.",
    "Snapshot contract: HTML and position describe the captured state for identification; do not copy the snapshot verbatim or hardcode its screen coordinates.",
    "Change boundary: preserve unrelated content, behavior, and layout unless the instruction explicitly requests otherwise.",
  ].join("\n");
}

function inferPreciseLikelyEditTarget(instructionText: string, selections: SelectionTarget[]): string | null {
  const referencedIndexes = extractInstructionElementIndexes(instructionText, selections);
  if (referencedIndexes.length === 0) {
    return null;
  }

  const containerIndex = inferInstructionContainerIndex(instructionText, selections, referencedIndexes);
  const anchorIndex = inferInstructionAnchorIndex(instructionText, referencedIndexes);
  const placementItemIndexes = anchorIndex !== null
    ? referencedIndexes.filter((index) => index !== anchorIndex && index !== containerIndex)
    : [];

  if (containerIndex !== null && anchorIndex !== null && containerIndex !== anchorIndex) {
    const container = selections[containerIndex] as SelectionTarget;
    const anchor = selections[anchorIndex] as SelectionTarget;
    return `Precise edit target: E${containerIndex + 1} (${container.selector}) contents, placing relative to E${anchorIndex + 1} (${anchor.selector}); avoid editing the common ancestor layout.`;
  }

  if (anchorIndex !== null && placementItemIndexes.length > 0) {
    const anchor = selections[anchorIndex] as SelectionTarget;
    return `Precise edit target: place ${formatPlainElementRefs(placementItemIndexes)} immediately after E${anchorIndex + 1} (${anchor.selector}) inside E${anchorIndex + 1}'s parent; move only the exact selected elements, not their parent wrappers or the common ancestor layout.`;
  }

  if (containerIndex !== null) {
    const container = selections[containerIndex] as SelectionTarget;
    return `Precise edit target: E${containerIndex + 1} (${container.selector}) contents; avoid editing the common ancestor layout.`;
  }

  if (referencedIndexes.length > 0) {
    return `Precise edit target: referenced elements ${referencedIndexes.map((index) => `E${index + 1}`).join(", ")} only; avoid editing the common ancestor layout.`;
  }

  return null;
}

function renderStructureContext(
  context: StructureContext | null | undefined,
  instructionText: string,
  selections: SelectionTarget[],
): string {
  if (!context) {
    return "none";
  }

  const requestedOrder = inferRequestedOrder(instructionText, selections);
  const preciseTarget = inferPreciseLikelyEditTarget(instructionText, selections);
  const likelyEditTarget = preciseTarget
    ? `General fallback only if exact placement requires parent markup: ${context.likelyEditTarget.replace(/^Likely edit target:\s*/i, "")}`
    : context.likelyEditTarget;

  return [
    `Relationship: ${context.relationship}`,
    `Common ancestor: ${formatStructureElement(context.commonAncestor)}`,
    `Common ancestor selector: ${context.commonAncestorSelector ?? "none"}`,
    `Parent layout: ${formatLayout(context.commonAncestorLayout)}`,
    `Current DOM order: ${formatOrder(context.currentDomOrder)}`,
    `Selected DOM order: ${formatOrder(context.selectedDomOrder)}`,
    `Selected visual order: ${formatOrder(context.selectedVisualOrder)}`,
    requestedOrder ? `Requested order from instruction: ${requestedOrder}` : null,
    preciseTarget,
    likelyEditTarget,
    `Sibling context:\n${formatSiblingContext(context.siblingContext)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderSelectionHierarchy(
  selection: SelectionTarget,
  index: number,
  context: StructureContext | null | undefined,
): string {
  const domPath = selection.domPath || selection.selector;
  const parentDomPath = getParentDomPath(domPath);
  const inside = context?.commonAncestor?.domPath
    ? `Inside: ${context.commonAncestor.domPath}`
    : parentDomPath
      ? `Parent DOM Path: ${parentDomPath}`
      : "Parent DOM Path: none";

  return [
    `E${index + 1}: ${selection.componentName ?? selection.tagName}`,
    `  ${inside}`,
    `  DOM Path: ${domPath}`,
    `  Selector: ${selection.selector}`,
    `  Position: ${formatPosition(selection.rect)}`,
    `  React Component: ${selection.componentName ?? selection.tagName}`,
    `  HTML Element: ${selection.outerHTML}`,
  ].join("\n");
}

export function buildStructureContext(selections: SelectionTarget[]): StructureContext | null {
  if (selections.length < 2) {
    return null;
  }

  const selectedElements = selections
    .map((selection) => findSelectedElement(selection))
    .filter((element): element is HTMLElement => Boolean(element));

  if (selectedElements.length < 2) {
    return {
      relationship: "selected elements not found",
      commonAncestor: null,
      commonAncestorSelector: null,
      commonAncestorLayout: {},
      currentDomOrder: [],
      selectedDomOrder: selections.map((selection) => selection.domPath || selection.selector),
      selectedVisualOrder: selections.map((selection) => selection.domPath || selection.selector),
      siblingContext: [],
      likelyEditTarget: "Unable to resolve live elements; search by DOM Path or selector.",
    };
  }

  const commonAncestor = findCommonAncestor(selectedElements);
  if (!commonAncestor) {
    return {
      relationship: "common ancestor: none within selected region",
      commonAncestor: null,
      commonAncestorSelector: null,
      commonAncestorLayout: {},
      currentDomOrder: [],
      selectedDomOrder: orderLabels(selectedElements),
      selectedVisualOrder: orderLabels(
        [...selectedElements].sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.y === bRect.y ? aRect.x - bRect.x : aRect.y - bRect.y;
        }),
      ),
      siblingContext: [],
      likelyEditTarget: "No useful common ancestor found; inspect selected component boundaries.",
    };
  }

  const selectedChildren = uniqueElements(
    selectedElements.map((element) => directChildWithinAncestor(element, commonAncestor)),
  );
  const parentSet = new Set(selectedElements.map((element) => element.parentElement));
  const relationship = parentSet.size === 1 ? "same parent" : "shared ancestor";
  const ancestorChildren = Array.from(commonAncestor.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const selectedChildSet = new Set(selectedChildren);
  const currentDomOrder = ancestorChildren.map((child) =>
    selectedChildSet.has(child) ? `${formatElementLabel(child)} [selected]` : formatElementLabel(child),
  );
  const selectedDomOrder = selectedChildren.length > 0
    ? orderLabels(selectedChildren)
    : orderLabels(selectedElements);
  const selectedVisualOrder = [...(selectedChildren.length > 0 ? selectedChildren : selectedElements)]
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.y === bRect.y ? aRect.x - bRect.x : aRect.y - bRect.y;
    })
    .map((element) => formatElementLabel(element));
  const ancestorSummary = summarizeElement(commonAncestor);
  const ancestorClass = ancestorSummary.classes[0] ? `.${ancestorSummary.classes[0]}` : ancestorSummary.tagName;

  return {
    relationship,
    commonAncestor: ancestorSummary,
    commonAncestorSelector: createStableSelector(commonAncestor),
    commonAncestorLayout: summarizeLayout(commonAncestor),
    currentDomOrder,
    selectedDomOrder,
    selectedVisualOrder,
    siblingContext: buildSiblingContext(commonAncestor, selectedChildren),
    likelyEditTarget: `Likely edit target: ${ancestorClass} layout or markup order`,
  };
}

function formatPosition(rect: RectLike | null | undefined): string {
  if (!rect) {
    return "unknown";
  }

  const { x, y, width, height } = rect;
  return `top=${Math.round(y)}px, left=${Math.round(x)}px, width=${Math.round(width)}px, height=${Math.round(height)}px`;
}

function isBlockElement(tagName: string): boolean {
  return [
    "div",
    "p",
    "section",
    "article",
    "aside",
    "header",
    "footer",
    "main",
    "nav",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ].includes(tagName);
}

function findSelectionForComposerToken(node: HTMLElement, selections: SelectionTarget[]): SelectionTarget | null {
  const byKey = node.dataset.selectionKey
    ? selections.find((selection) => selectionKey(selection) === node.dataset.selectionKey)
    : null;
  if (byKey) {
    return byKey;
  }

  const byId = node.dataset.selectionId
    ? selections.find((selection) => selection.id === node.dataset.selectionId)
    : null;
  if (byId) {
    return byId;
  }

  const selectorMatches = node.dataset.selector
    ? selections.filter((selection) => selection.selector === node.dataset.selector)
    : [];
  return selectorMatches.length === 1 ? selectorMatches[0] ?? null : null;
}

function renderComposerTokenReference(node: HTMLElement, selections: SelectionTarget[]): string {
  if (node.dataset.styleInstruction) {
    return node.dataset.styleInstruction;
  }

  const selection = findSelectionForComposerToken(node, selections);
  if (!selection) {
    const fallback = clampValue(node.querySelector("strong")?.textContent ?? node.getAttribute("title") ?? node.dataset.selector ?? node.textContent ?? "");
    return fallback ? `[Unresolved element: ${fallback}]` : "[Unresolved element]";
  }

  const index = selections.findIndex((item) => selectionKey(item) === selectionKey(selection)) + 1;
  return `[E${index}]`;
}

function serializeComposerHtml(html: string, selections: SelectionTarget[] = []): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const chunks: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = clampValue(node.textContent ?? "");
      if (text) {
        chunks.push(text);
      }
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.dataset.noteToken === "true") {
      chunks.push(renderComposerTokenReference(node, selections));
      return;
    }

    const tagName = node.tagName.toLowerCase();
    const shouldSeparate = isBlockElement(tagName);
    if (shouldSeparate && chunks.length > 0) {
      chunks.push("\n");
    }

    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }

    if (shouldSeparate && chunks.length > 0) {
      const last = chunks[chunks.length - 1];
      if (last !== "\n") {
        chunks.push("\n");
      }
    }
  };

  for (const child of Array.from(container.childNodes)) {
    visit(child);
  }

  return chunks
    .join(" ")
    .replace(/\s+\n\s+/g, "\n")
    .replace(/\n\s+\n/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export { serializeComposerHtml };

function renderStyleDraft(draft: StyleDraft): string {
  if (!draft.property.startsWith("extract:")) {
    return `- ${draft.property}: ${draft.value} [${draft.scope.mode === "global" ? "global" : draft.scope.breakpoints.join(", ")}]`;
  }

  const kind = draft.property.replace("extract:", "");
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(draft.value) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const label = String(payload.label ?? kind);
  const component = String(payload.componentName ?? payload.domPath ?? payload.tagName ?? "component");
  const breakpoint = String(payload.breakpoint ?? (draft.scope.mode === "global" ? "global" : draft.scope.breakpoints.join(", ")));
  const summary = String(payload.summary ?? "");
  const propertyEntries = Object.entries((payload.properties as Record<string, string>) ?? {});
  const styleLines = propertyEntries.map(([name, value]) => `    ${name}: ${value}`);

  return [
    `- ${label} for ${component} [${breakpoint}]`,
    summary ? `  ${summary}` : null,
    styleLines.length > 0 ? `  Styles:\n${styleLines.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function selectionKey(selection: SelectionTarget): string {
  return selection.domPath || `${selection.selector}:${Math.round(selection.rect.x)}:${Math.round(selection.rect.y)}`;
}

export function renderReferenceDetails(reference: {
  domPath?: string;
  selector: string;
  rect?: RectLike | null;
  componentName?: string | null;
  tagName: string;
  outerHTML?: string;
  source?: SourceInfo | null;
}): string {
  const domPath = reference.domPath ?? reference.selector;
  const htmlElement = reference.outerHTML ?? reference.selector;
  const parentDomPath = getParentDomPath(domPath);
  return [
    `DOM Path: ${domPath}`,
    parentDomPath ? `Parent DOM Path: ${parentDomPath}` : null,
    `Position: ${formatPosition(reference.rect)}`,
    `React Component: ${reference.componentName ?? reference.tagName}`,
    `HTML Element: ${htmlElement}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function rectToString(rect: RectLike): string {
  const { x, y, width, height } = rect;
  return `${Math.round(x)} ${Math.round(y)} ${Math.round(width)}x${Math.round(height)}`;
}

export function getTextPreview(element: Element): string {
  const text = clampValue(element.textContent ?? "");
  if (!text) {
    return "";
  }

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function createStableSelector(element: Element): string {
  const testAttribute = ["data-testid", "data-test", "data-qa"].find((name) =>
    element.hasAttribute(name),
  );

  if (testAttribute) {
    const value = element.getAttribute(testAttribute) ?? "";
    return `[${testAttribute}="${CSS.escape(value)}"]`;
  }

  const id = element.getAttribute("id");
  if (id) {
    return `#${CSS.escape(id)}`;
  }

  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList)
    .filter(Boolean)
    .slice(0, 3)
    .map((value) => `.${CSS.escape(value)}`)
    .join("");

  const parent = element.parentElement;
  if (!parent) {
    return `${tag}${classes}`;
  }

  const siblings = Array.from(parent.children).filter(
    (candidate) => candidate.tagName === element.tagName,
  );
  const index = siblings.indexOf(element) + 1;
  const indexed = siblings.length > 1 ? `:nth-of-type(${index})` : "";
  return `${tag}${classes}${indexed}`;
}

export function describeAttributes(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["aria-label", "role", "name", "type", "href", "for"]) {
    const value = element.getAttribute(name);
    if (value) {
      result[name] = value;
    }
  }
  return result;
}

export function captureComputedStyles(element: Element): Record<string, string> {
  const styles = window.getComputedStyle(element);
  const result: Record<string, string> = {};

  for (const property of COMPARISON_PROPERTIES) {
    const value = styles.getPropertyValue(property);
    if (value) {
      result[property] = value.trim();
    }
  }

  return result;
}

export function buildElementSnapshot(
  element: Element,
  source: SelectionTarget["source"] = null,
): SelectionTarget {
  const rect = element.getBoundingClientRect();
  return {
    id: crypto.randomUUID(),
    selector: createStableSelector(element),
    domPath: buildDomPath(element),
    tagName: element.tagName.toLowerCase(),
    text: getTextPreview(element),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    componentName: source?.componentName ?? null,
    source,
    attributes: describeAttributes(element),
    computedStyles: captureComputedStyles(element),
    outerHTML: clampValue(element.outerHTML).slice(0, 3000),
  };
}

export function renderChangeBundle(payload: ChangeBundlePayload): string {
  const instructionText = payload.instructionHtml
    ? serializeComposerHtml(payload.instructionHtml, payload.selections)
    : "";
  const instructionPrecisionGuide = renderInstructionPrecisionGuide(instructionText, payload.selections);

  const blocks = [
    [
      "Instruction",
      [instructionText || "none", instructionPrecisionGuide].filter(Boolean).join("\n\n"),
    ].join("\n"),
    [
      "Context",
      renderTaskContext(payload),
    ].join("\n"),
  ];

  if (payload.selections.length > 0) {
    blocks.push([
      "Selected elements",
      payload.selections
        .map((selection, index) => renderSelectionHierarchy(selection, index, payload.structureContext))
        .join("\n\n"),
    ].join("\n"));
  }

  if (payload.structureContext) {
    blocks.push([
      "Structure",
      renderStructureContext(payload.structureContext, instructionText, payload.selections),
    ].join("\n"));
  }

  if (payload.drafts.length > 0) {
    blocks.push([
      "Adjustments",
      payload.drafts.map((draft) => renderStyleDraft(draft)).join("\n"),
    ].join("\n"));
  }

  return blocks.join("\n\n");
}
