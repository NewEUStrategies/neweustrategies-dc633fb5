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
  // SYGNAŁ „PIERWSZE UŻYCIE" - `__root.tsx` montuje na nim `<Toaster/>`
  // (chunk sonnera poza commitem hydratacji, audyt CWV F19). Musi paść ZANIM
  // chunk dojedzie: inaczej pierwszy toast trafiałby w niezamontowany Toaster,
  // a sonner nie odtwarza historii nowym subskrybentom.
  it("zgłasza pierwsze użycie SYNCHRONICZNIE, zanim chunk sonnera dojedzie", async () => {
    vi.doMock("sonner", () => ({ toast: h }));
    const { notifySuccess, onFirstToast } = await import("../notify");
    const montuj = vi.fn();
    onFirstToast(montuj);

    expect(montuj).not.toHaveBeenCalled();
    notifySuccess("pierwszy");
    expect(montuj).toHaveBeenCalledTimes(1);

    notifySuccess("drugi");
    expect(montuj).toHaveBeenCalledTimes(1);
    await vi.dynamicImportSettled();
  });

  it("subskrypcja po pierwszym toaście odpala się natychmiast (nie ma na co czekać)", async () => {
    vi.doMock("sonner", () => ({ toast: h }));
    const { notifyError, onFirstToast } = await import("../notify");
    notifyError("byl");

    const montuj = vi.fn();
    onFirstToast(montuj);
    expect(montuj).toHaveBeenCalledTimes(1);
    await vi.dynamicImportSettled();
  });

  it("odsubskrybowanie działa, a rzut subskrybenta nie wywraca nadawcy toasta", async () => {
    vi.doMock("sonner", () => ({ toast: h }));
    const { notifySuccess, onFirstToast } = await import("../notify");
    const zerwany = vi.fn();
    const stop = onFirstToast(zerwany);
    stop();
    onFirstToast(() => {
      throw new Error("montaż Toastera padł");
    });

    expect(() => notifySuccess("saved")).not.toThrow();
    expect(zerwany).not.toHaveBeenCalled();
    await vi.dynamicImportSettled();
    expect(h.success).toHaveBeenCalledWith("saved");
  });

  it("SSR nie zgłasza pierwszego użycia - nie ma czego montować", async () => {
    vi.stubGlobal("window", undefined);
    vi.doMock("sonner", () => ({ toast: h }));
    const { notifySuccess, onFirstToast } = await import("../notify");
    const montuj = vi.fn();
    onFirstToast(montuj);
    notifySuccess("x");
    expect(montuj).not.toHaveBeenCalled();
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
