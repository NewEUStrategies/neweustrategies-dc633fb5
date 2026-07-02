// Global-widget payload parsing and instance <-> global merging.
import { describe, expect, it } from "vitest";
import {
  makeGlobalInstance,
  mergeGlobalIntoInstance,
  parseGlobalWidgetData,
  widgetToGlobalData,
} from "../globalWidgets";
import type { WidgetNode } from "../types";

const widget: WidgetNode = {
  id: "w1",
  kind: "widget",
  type: "button",
  content: { label_pl: "Kup", label_en: "Buy" },
  style: { bgColor: "#111" },
  advanced: { cssClass: "cta" },
};

describe("parseGlobalWidgetData", () => {
  it("rejects garbage and unknown widget types", () => {
    expect(parseGlobalWidgetData(null)).toBeNull();
    expect(parseGlobalWidgetData({ type: "not-a-widget", content: {} })).toBeNull();
  });

  it("coerces a valid payload and drops non-object style/advanced", () => {
    const parsed = parseGlobalWidgetData({
      type: "button",
      content: { label_pl: "x" },
      style: "red",
      advanced: 3,
    });
    expect(parsed).toEqual({ type: "button", content: { label_pl: "x" } });
  });
});

describe("widgetToGlobalData", () => {
  it("extracts a deep-cloned synchronized payload without the instance id", () => {
    const data = widgetToGlobalData(widget);
    expect(data).toEqual({
      type: "button",
      content: { label_pl: "Kup", label_en: "Buy" },
      style: { bgColor: "#111" },
      advanced: { cssClass: "cta" },
    });
    // Deep clone - mutating the payload never touches the source node.
    (data.content as Record<string, unknown>).label_pl = "Zmienione";
    expect(widget.content.label_pl).toBe("Kup");
  });
});

describe("makeGlobalInstance / mergeGlobalIntoInstance", () => {
  it("creates an instance with a fresh id, snapshot and globalId", () => {
    const data = widgetToGlobalData(widget);
    const instance = makeGlobalInstance({ id: "g1", data });
    expect(instance.globalId).toBe("g1");
    expect(instance.id).not.toBe(widget.id);
    expect(instance.type).toBe("button");
    expect(instance.content).toEqual(widget.content);
  });

  it("overlays the live payload while keeping instance identity", () => {
    const instance = makeGlobalInstance({ id: "g1", data: widgetToGlobalData(widget) });
    const merged = mergeGlobalIntoInstance(instance, {
      type: "button",
      content: { label_pl: "Nowy" },
      style: { bgColor: "#222" },
    });
    expect(merged.id).toBe(instance.id);
    expect(merged.globalId).toBe("g1");
    expect(merged.content).toEqual({ label_pl: "Nowy" });
    expect(merged.style).toEqual({ bgColor: "#222" });
    // Stale advanced from the snapshot must not leak into the merged node.
    expect(merged.advanced).toBeUndefined();
  });
});
