import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster } from "../sonner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("mounts the real notification host without forcing a document style read", () => {
  const styles = vi.spyOn(window, "getComputedStyle");
  const { container } = render(<Toaster />);
  expect(container.querySelector("section")).not.toBeNull();
  expect(styles.mock.calls.filter(([element]) => element === document.documentElement)).toEqual([]);
});
