import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  observabilityEndpoint,
  buildErrorPayload,
  sendBeaconPayload,
  reportClientError,
  reportBoundaryError,
  INTERNAL_ERROR_ENDPOINT,
} from "./report";

describe("observabilityEndpoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("falls back to the internal ingest route when unconfigured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    expect(observabilityEndpoint()).toBe(INTERNAL_ERROR_ENDPOINT);
  });

  it("prefers the external endpoint when configured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.com/collect");
    expect(observabilityEndpoint()).toBe("https://rum.example.com/collect");
  });
});

describe("buildErrorPayload", () => {
  it("maps an Error with its stack", () => {
    const err = new Error("boom");
    const p = buildErrorPayload(err, "onerror", "/x", 123);
    expect(p).toMatchObject({
      type: "error",
      message: "boom",
      source: "onerror",
      path: "/x",
      ts: 123,
    });
    expect(p.stack).toBeTypeOf("string");
  });

  it("coerces a string error", () => {
    expect(buildErrorPayload("a string failure", "unhandledrejection", "/y", 1).message).toBe(
      "a string failure",
    );
  });

  it("coerces a non-error object to a generic message", () => {
    expect(buildErrorPayload({ weird: true }, "onerror", "/z", 1).message).toBe(
      "Unknown client error",
    );
  });

  it("attaches structured meta when provided", () => {
    const p = buildErrorPayload(new Error("boom"), "react_error_boundary", "/x", 1, {
      boundary: "builder_render_boundary",
      label: "widget:heading:w3",
    });
    expect(p.meta).toEqual({ boundary: "builder_render_boundary", label: "widget:heading:w3" });
  });

  it("omits meta when it is undefined or empty", () => {
    expect(buildErrorPayload(new Error("x"), "onerror", "/x", 1).meta).toBeUndefined();
    expect(buildErrorPayload(new Error("x"), "onerror", "/x", 1, {}).meta).toBeUndefined();
  });
});

describe("sendBeaconPayload", () => {
  const original = navigator.sendBeacon;
  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("returns false when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(sendBeaconPayload("https://x", { a: 1 })).toBe(false);
  });

  it("sends a JSON blob and returns the beacon result", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(sendBeaconPayload("https://x", { a: 1 })).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("https://x");
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
  });

  it("swallows a throwing sendBeacon", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => {
        throw new Error("nope");
      },
      configurable: true,
      writable: true,
    });
    expect(sendBeaconPayload("https://x", {})).toBe(false);
  });
});

describe("reportClientError", () => {
  const original = navigator.sendBeacon;
  beforeEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn(() => true),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, "sendBeacon", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("beacons to the internal endpoint when no external endpoint is configured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(reportClientError(new Error("x"), "onerror")).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe(INTERNAL_ERROR_ENDPOINT);
  });

  it("beacons the error when an external endpoint is configured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.com");
    expect(reportClientError(new Error("x"), "unhandledrejection")).toBe(true);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });
});

describe("reportBoundaryError", () => {
  const original = navigator.sendBeacon;
  beforeEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn(() => true),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, "sendBeacon", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("beacons to the internal endpoint by default (no external config)", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(reportBoundaryError(new Error("x"), { label: "section:s1" })).toBe(true);
    expect(beacon.mock.calls[0][0]).toBe(INTERNAL_ERROR_ENDPOINT);
  });

  it("beacons a react_error_boundary payload with structured meta", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.com");
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(
      reportBoundaryError(new Error("crash"), {
        boundary: "builder_render_boundary",
        label: "widget:w1",
      }),
    ).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("https://rum.example.com");
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
  });
});
