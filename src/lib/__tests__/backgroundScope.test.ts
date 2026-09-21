import { describe, expect, it, vi } from "vitest";
import { createBackgroundScope } from "../backgroundScope";

describe("background service lifetime", () => {
  it("cleans each started service once even when another cleanup fails", async () => {
    const report = vi.fn();
    const scope = createBackgroundScope(report);
    const cleanup = vi.fn();
    await scope.run(Promise.resolve(1), () => () => {
      throw new Error("cleanup failed");
    });
    await scope.run(Promise.resolve(2), () => cleanup);
    await scope.run(Promise.resolve(3), () => undefined);
    scope.dispose();
    scope.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });
  it("does not start a lazy service that resolves after unmount", async () => {
    const scope = createBackgroundScope();
    const start = vi.fn();
    let resolve!: (value: number) => void;
    const running = scope.run(
      new Promise<number>((r) => {
        resolve = r;
      }),
      start,
    );
    scope.dispose();
    resolve(1);
    await running;
    expect(start).not.toHaveBeenCalled();
  });
  it("reports active load errors but handles late rejections silently", async () => {
    const report = vi.fn();
    const scope = createBackgroundScope(report);
    await scope.run(Promise.reject(new Error("network")), vi.fn());
    expect(report).toHaveBeenCalledTimes(1);
    scope.dispose();
    await scope.run(Promise.reject(new Error("late")), vi.fn());
    expect(report).toHaveBeenCalledTimes(1);
  });
  it("reports initializer failures through the default warning handler", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await createBackgroundScope().run(Promise.resolve(1), () => {
        throw new Error("init");
      });
      expect(warning).toHaveBeenCalledWith("Background service failed", expect.any(Error));
    } finally {
      warning.mockRestore();
    }
  });
});
