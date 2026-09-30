import type { ColumnNode, Device, SectionNode, WidgetNode } from "./types";
import { evaluateAccess, type AccessContext } from "./accessControl";
import { isKnownWidgetType } from "./schema";
import { hiddenOnDevice } from "@/components/builder/organisms/widget-view/frame";

/** One widget predicate for the renderer and the server's query collector. */
export function isRenderedWidget(
  widget: WidgetNode,
  device: Device,
  accessCtx: AccessContext,
): boolean {
  return (
    isKnownWidgetType(widget.type) &&
    !hiddenOnDevice(widget.advanced, device) &&
    evaluateAccess(widget.advanced?.access, accessCtx)
  );
}

/** Shared by the renderer's initial displayTabId and the server-only data gate. */
export function initialSectionTabId(section: SectionNode): string | undefined {
  const tabs = section.tabs;
  if (!tabs?.enabled || !tabs.items?.length) return undefined;
  return tabs.defaultTabId && tabs.items.some((tab) => tab.id === tabs.defaultTabId)
    ? tabs.defaultTabId
    : tabs.items[0].id;
}

/** Only widgets mounted by BuilderRenderer's initial render can suspend SSR. */
export function collectRenderableSectionWidgets(
  section: SectionNode,
  device: Device,
  accessCtx: AccessContext,
): WidgetNode[] {
  if (!evaluateAccess(section.advanced?.access, accessCtx)) return [];
  const displayTabId = initialSectionTabId(section);
  const widgets: WidgetNode[] = [];
  const collectColumn = (column: ColumnNode) => {
    if (!column || !evaluateAccess(column.advanced?.access, accessCtx)) return;
    for (const widget of Array.isArray(column.children) ? column.children : []) {
      if (widget && isRenderedWidget(widget, device, accessCtx)) {
        widgets.push(widget);
      }
    }
  };
  for (const child of Array.isArray(section.children) ? section.children : []) {
    if (!child || !evaluateAccess(child.advanced?.access, accessCtx)) continue;
    if (displayTabId !== undefined && child.tabId && child.tabId !== displayTabId) continue;
    if (child.kind === "column") {
      collectColumn(child);
    } else {
      for (const column of Array.isArray(child.columns) ? child.columns : []) collectColumn(column);
    }
  }
  return widgets;
}
