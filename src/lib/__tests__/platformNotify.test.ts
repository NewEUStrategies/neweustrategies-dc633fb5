import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("sonner");
});
describe("lazy notifications", () => {
  it("preserves FIFO while loading and calls synchronously once loaded", async () => {
    vi.doMock("sonner", () => ({ toast: h }));
    const { notifySuccess, notifyError } = await import("../notify");
    notifySuccess("saved");
    notifyError("failed");
    await vi.dynamicImportSettled();
    expect(h.success).toHaveBeenCalledWith("saved");
    expect(h.error).toHaveBeenCalledWith("failed");
    expect(h.success.mock.invocationCallOrder[0]).toBeLessThan(h.error.mock.invocationCallOrder[0]);
    notifySuccess("again");
    expect(h.success).toHaveBeenLastCalledWith("again");
  });
  it("caps the pending queue rather than retaining an unbounded history", async () => {
    let release!: () => void;
    vi.doMock("sonner", async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { toast: h };
    });
    const { notifySuccess } = await import("../notify");
    for (let i = 0; i < 35; i++) notifySuccess(String(i));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await vi.dynamicImportSettled();
    expect(h.success).toHaveBeenCalledTimes(20);
    expect(h.success).toHaveBeenLastCalledWith("19");
  });
  it("drops failed imports and retries on the next notification", async () => {
    vi.doMock("sonner", () => {
      throw new Error("chunk unavailable");
    });
    const { notifyError } = await import("../notify");
    notifyError("lost");
    await vi.dynamicImportSettled();
    vi.doMock("sonner", () => ({ toast: h }));
    notifyError("retry");
    await vi.dynamicImportSettled();
    expect(h.error).toHaveBeenCalledOnce();
    expect(h.error).toHaveBeenCalledWith("retry");
  });
  it("is a no-op during SSR", async () => {
    vi.stubGlobal("window", undefined);
    vi.doMock("sonner", () => ({ toast: h }));
    const { notifySuccess, notifyError } = await import("../notify");
    notifySuccess("x");
    notifyError("y");
    await vi.dynamicImportSettled();
    expect(h.success).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });
});
