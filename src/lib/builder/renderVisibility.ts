import type { Device, SectionNode, WidgetNode } from "./types";
import { evaluateAccess, type AccessContext } from "./accessControl";
import { isKnownWidgetType } from "./schema";
import { hiddenOnDevice } from "@/components/builder/organisms/widget-view/frame";

export interface SectionRenderContext {
  device: Device;
  accessContext: AccessContext;
}

/** The server and the renderer's first render must choose the same tab. */
export function initialSectionTabId(section: SectionNode): string {
  const tabs = section.tabs;
  if (!tabs?.enabled || !tabs.items?.length) return "";
  return tabs.defaultTabId && tabs.items.some((tab) => tab.id === tabs.defaultTabId)
    ? tabs.defaultTabId
    : tabs.items[0].id;
}

export function isRenderedWidget(widget: WidgetNode, context: SectionRenderContext): boolean {
  return (
    isKnownWidgetType(widget.type) &&
    !hiddenOnDevice(widget.advanced, context.device) &&
    evaluateAccess(widget.advanced?.access, context.accessContext)
  );
}

/** Mirror RenderSection/RenderInner/RenderColumn, including ancestor access. */
export function collectRenderedSectionWidgets(
  section: SectionNode,
  context: SectionRenderContext,
): WidgetNode[] {
  if (!evaluateAccess(section.advanced?.access, context.accessContext)) return [];
  const tabsEnabled = !!(section.tabs?.enabled && section.tabs.items?.length);
  const tabId = initialSectionTabId(section);
  const widgets: WidgetNode[] = [];
  for (const child of section.children ?? []) {
    if (!child || !evaluateAccess(child.advanced?.access, context.accessContext)) continue;
    if (tabsEnabled && child.tabId && child.tabId !== tabId) continue;
    const columns = child.kind === "column" ? [child] : child.columns;
    for (const column of columns ?? []) {
      if (!column || !evaluateAccess(column.advanced?.access, context.accessContext)) continue;
      for (const widget of column.children ?? []) {
        if (widget && isRenderedWidget(widget, context)) widgets.push(widget);
      }
    }
  }
  return widgets;
}
