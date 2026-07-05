import type {
  ChangeBundlePayload,
  InspectorNote,
  RectLike,
  SelectionTarget,
  SourceInfo,
  StructureContext,
  StructureElementSummary,
  StructureSiblingSummary,
  StyleDraft,
  StyleScope,
} from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBadge(label: string): string {
  return `<span class="desin-badge">${escapeHtml(label)}</span>`;
}

export function getTextPreview(text: string, limit = 80): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 3)}...` : trimmed;
}

export function buildDomPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      segments.unshift(selector);
      break;
    }

    if (current.classList.length > 0) {
      selector += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    segments.unshift(selector);
    current = current.parentElement;
  }

  return segments.join(" > ");
}

export function buildElementSnapshot(element: Element, source: SourceInfo | null = null): SelectionTarget {
  const rect = element.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }

  const computedStyles = captureComputedStyles(element);

  return {
    id: `${element.tagName.toLowerCase()}-${Math.round(rect.x)}-${Math.round(rect.y)}`,
    selector: element.id ? `#${element.id}` : buildDomPath(element),
    domPath: buildDomPath(element),
    tagName: element.tagName.toLowerCase(),
    text: getTextPreview(element.textContent ?? ""),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    componentName: source?.componentName ?? null,
    source,
    attributes,
    computedStyles,
    outerHTML: element.outerHTML,
  };
}

export function captureComputedStyles(element: Element): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const styles: Record<string, string> = {};
  for (const property of [
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
    "font-family",
    "text-align",
    "text-transform",
    "font-style",
    "border-color",
    "fill",
    "stroke",
  ]) {
    styles[property] = computed.getPropertyValue(property).trim();
  }
  return styles;
}

export function buildStructureContext(selections: SelectionTarget[]): StructureContext | null {
  if (selections.length === 0) {
    return null;
  }

  const selectedDomOrder = selections.map((selection) => selection.domPath);
  const commonAncestor = selections[0] ?? null;
  const siblingContext: StructureSiblingSummary[] = selections.map((selection, index) => ({
    ...selection,
    relation: index === 0 ? "selected" : index % 2 === 0 ? "next" : "previous",
  }));

  return {
    relationship: selections.length > 1 ? "grouped" : "single",
    commonAncestor: commonAncestor
      ? {
          selector: commonAncestor.selector,
          domPath: commonAncestor.domPath,
          tagName: commonAncestor.tagName,
          classes: [],
          text: commonAncestor.text,
          position: commonAncestor.rect,
        }
      : null,
    commonAncestorSelector: commonAncestor?.selector ?? null,
    commonAncestorLayout: {},
    currentDomOrder: selectedDomOrder,
    selectedDomOrder,
    selectedVisualOrder: [...selectedDomOrder],
    siblingContext,
    likelyEditTarget: selections[0]?.selector ?? "",
  };
}

export function renderReferenceDetails(reference: SelectionTarget | InspectorNote): string {
  const selector = "selector" in reference ? reference.selector : reference.references?.[0]?.selector ?? "";
  const domPath = "domPath" in reference ? reference.domPath : reference.references?.[0]?.domPath ?? selector;
  const text = "text" in reference ? reference.text : reference.text;
  return [selector, domPath, text].filter(Boolean).join(" | ");
}

export function serializeComposerHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}

export function renderChangeBundle(payload: ChangeBundlePayload): string {
  const lines: string[] = [];
  lines.push(`Instruction`);
  if (payload.instructionHtml) {
    lines.push(payload.instructionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  lines.push("");
  lines.push(`Selected elements`);
  for (const selection of payload.selections) {
    lines.push(`- ${selection.selector} ${renderBadge(selection.tagName)}`);
  }
  lines.push("");
  if (payload.structureContext) {
    lines.push(`Structure`);
    lines.push(payload.structureContext.relationship);
  }
  lines.push("");
  lines.push(`Adjustments`);
  for (const draft of payload.drafts) {
    lines.push(`- ${draft.property}: ${draft.value}`);
  }
  return lines.join("\n");
}
