import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RenderErrorBoundary, isDevEnv } from "./RenderErrorBoundary";

vi.mock("@/lib/lovable-error-reporting", () => ({ reportLovableError: vi.fn() }));
import { reportLovableError } from "@/lib/lovable-error-reporting";

function Boom({ message = "kaboom" }: { message?: string }): never {
  throw new Error(message);
}

describe("RenderErrorBoundary", () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // React logs caught boundary errors to console.error; silence the noise.
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(reportLovableError).mockClear();
  });
  afterEach(() => consoleErr.mockRestore());

  it("renders children when nothing throws", () => {
    render(
      <RenderErrorBoundary label="section:s1">
        <p>healthy</p>
      </RenderErrorBoundary>,
    );
    expect(screen.getByText("healthy")).toBeTruthy();
  });

  it("leaves a hidden, zero-layout diagnostic breadcrumb in production", () => {
    const { container } = render(
      <RenderErrorBoundary label="widget:heading:w1" dev={false}>
        <Boom message="prod boom" />
      </RenderErrorBoundary>,
    );
    const marker = container.querySelector("[data-render-error]") as HTMLElement | null;
    // Present (so a crash is detectable) but invisible (no broken box for users).
    expect(marker).not.toBeNull();
    expect(marker?.hidden).toBe(true);
    expect(marker?.getAttribute("data-render-error")).toBe("widget:heading:w1");
    expect(marker?.getAttribute("data-render-error-message")).toBe("prod boom");
    expect(container.textContent).toBe("");
  });

  it("renders a compact diagnostic in dev mode", () => {
    render(
      <RenderErrorBoundary label="widget:heading:w1" dev>
        <Boom message="bad data" />
      </RenderErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-render-error")).toBe("widget:heading:w1");
    expect(alert.textContent).toContain("widget:heading:w1");
    expect(alert.textContent).toContain("bad data");
  });

  it("prefers an explicit fallback over the dev/prod default", () => {
    render(
      <RenderErrorBoundary label="x" dev fallback={<span>custom fallback</span>}>
        <Boom />
      </RenderErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("invokes a provided onError with the thrown error", () => {
    const onError = vi.fn();
    render(
      <RenderErrorBoundary label="x" dev={false} onError={onError}>
        <Boom message="reported" />
      </RenderErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe("reported");
  });

  it("falls back to reportLovableError when no onError is given", () => {
    render(
      <RenderErrorBoundary label="section:s9" dev={false}>
        <Boom message="defaulted" />
      </RenderErrorBoundary>,
    );
    expect(reportLovableError).toHaveBeenCalledTimes(1);
    const [err, ctx] = vi.mocked(reportLovableError).mock.calls[0];
    expect((err as Error).message).toBe("defaulted");
    expect(ctx).toMatchObject({ boundary: "builder_render_boundary", label: "section:s9" });
  });

  it("uses isDevEnv() to pick the default fallback when dev is unset", () => {
    const dev = isDevEnv();
    expect(typeof dev).toBe("boolean");
    const { container } = render(
      <RenderErrorBoundary label="auto">
        <Boom />
      </RenderErrorBoundary>,
    );
    // Both branches leave a `[data-render-error]` node; dev shows a visible
    // alert, prod a hidden breadcrumb.
    const marker = container.querySelector("[data-render-error='auto']") as HTMLElement | null;
    expect(marker).not.toBeNull();
    if (dev) {
      expect(marker?.getAttribute("role")).toBe("alert");
      expect(marker?.hidden).toBe(false);
    } else {
      expect(marker?.hidden).toBe(true);
    }
  });
});
