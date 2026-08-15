// Rozgrzewanie chunków widgetów: kontrakt pojedynczego zaplanowania, respekt
// dla Save-Data i faktyczne wykonanie dynamicznych importów (mockowanych na
// lekkie stuby - test mierzy, że import() się WYDARZYŁ, nie treść modułów).
import { describe, it, expect, vi, beforeEach } from "vitest";

const loaded = vi.hoisted(() => ({ rich: 0, postList: 0, dynamicTags: 0 }));

vi.mock("../RichHtmlView", () => {
  loaded.rich += 1;
  return { RichHtmlView: () => null };
});
vi.mock("../PostListView", () => {
  loaded.postList += 1;
  return { PostListView: () => null };
});
vi.mock("../DynamicTagWidgets", () => {
  loaded.dynamicTags += 1;
  return { DynamicTagWidget: () => null };
});

import { warmCommonWidgetChunks, resetWarmWidgetChunksForTests } from "../warmWidgetChunks";

/** Defer wykonujący natychmiast - test nie czeka na requestIdleCallback. */
const immediate = (run: () => void) => run();

function setSaveData(value: boolean | undefined): void {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: value === undefined ? undefined : { saveData: value },
  });
}

describe("warmCommonWidgetChunks", () => {
  beforeEach(() => {
    resetWarmWidgetChunksForTests();
    setSaveData(undefined);
    loaded.rich = 0;
    loaded.postList = 0;
    loaded.dynamicTags = 0;
  });

  it("dociąga chunki tekstu, listingów i tagów wpisu dokładnie raz", async () => {
    warmCommonWidgetChunks(immediate);
    warmCommonWidgetChunks(immediate);
    await vi.waitFor(() => {
      expect(loaded.rich).toBe(1);
      expect(loaded.postList).toBe(1);
      expect(loaded.dynamicTags).toBe(1);
    });
  });

  it("szanuje Save-Data: nie planuje żadnego importu", async () => {
    setSaveData(true);
    warmCommonWidgetChunks(immediate);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loaded.rich).toBe(0);
    expect(loaded.postList).toBe(0);
    expect(loaded.dynamicTags).toBe(0);
  });

  it("po odmowie przez Save-Data kolejne wywołanie też nic nie dociąga (jedno zaplanowanie na proces)", async () => {
    setSaveData(true);
    warmCommonWidgetChunks(immediate);
    setSaveData(false);
    warmCommonWidgetChunks(immediate);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loaded.rich).toBe(0);
  });
});
