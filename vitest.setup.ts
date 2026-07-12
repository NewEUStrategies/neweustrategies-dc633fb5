import "@testing-library/jest-dom/vitest";

// Neutralise fire-and-forget beacons in unit tests. happy-dom implements
// `navigator.sendBeacon` by performing a REAL network request, so components
// that beacon telemetry on render (ad impressions, popup views, web-vitals,
// client-error capture) would otherwise emit an unhandled socket error after
// the test completes and flake the run. A no-op default keeps unit tests off
// the network; observability tests that assert beacon behaviour still override
// `navigator.sendBeacon` per-test (and restore the original) as before.
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: () => true,
  });
}
