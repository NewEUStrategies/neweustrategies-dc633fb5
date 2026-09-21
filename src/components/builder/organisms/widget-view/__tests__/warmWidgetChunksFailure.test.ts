import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ loaded: [] as string[], rejected: 0 }));
vi.mock("../RichHtmlView", () => {
  h.loaded.push("rich");
  return {};
});
vi.mock("../PostListView", () => {
  h.rejected += 1;
  throw new Error("offline chunk");
});
vi.mock("../DynamicTagWidgets", () => {
  h.loaded.push("tags");
  return {};
});
vi.mock("../PostsSliderWidget", () => {
  h.loaded.push("slider");
  return {};
});
vi.mock("@/lib/builder/sliderVariants", () => {
  h.loaded.push("variants");
  return {};
});
vi.mock("@/lib/builder/sectionLabelVariants", () => {
  h.loaded.push("labels");
  return {};
});
import { warmCommonWidgetChunks } from "../warmWidgetChunks";

it("settles an optional chunk failure while warming the remaining widgets", async () => {
  warmCommonWidgetChunks((run) => run());
  await vi.dynamicImportSettled();
  expect(h.rejected).toBe(1);
  expect(h.loaded.sort()).toEqual(["labels", "rich", "slider", "tags", "variants"]);
  // Vitest's unhandled-rejection gate remains active throughout this test.
});
