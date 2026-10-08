// @vitest-environment node
// DRUGA ZAPORA NONCE'A: DRIVER REWALIDACJI W `src/server.ts` (fala 3, P3.6a, runda 10).
//
// Planowanie odświeżenia w `documentCache.server.ts` nie wystawia go bez nonce'a. Driver
// w `src/server.ts` sprawdza to drugi raz: bez losowości syntetyczne żądanie nie dostałoby
// znacznika, byłoby zwykłą wizytą (podałoby własny wpis STALE) i kosztowałoby render na nic.
// Plik jest osobny, bo moduł cache'u musi tu być świeży (nonce jeszcze niewylosowany), a driver
// da się przechwycić wyłącznie atrapą `setDocumentRevalidator` - jak w revalidationUserAgent.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentRevalidator } from "../documentCache.server";

const hoisted = vi.hoisted(() => ({
  /** Żądania, z którymi `src/server.ts` zawołał entry frameworka. */
  requests: [] as Request[],
  /** Driver rewalidacji przechwycony z `setDocumentRevalidator`. */
  revalidator: null as DocumentRevalidator | null,
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: {
    fetch: (request: Request) => {
      hoisted.requests.push(request);
      return new Response("<html>render</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  },
}));

vi.mock("@/lib/http/documentCache.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/documentCache.server")>();
  return {
    ...actual,
    setDocumentRevalidator: (revalidator: DocumentRevalidator | null): void => {
      hoisted.revalidator = revalidator;
      actual.setDocumentRevalidator(revalidator);
    },
  };
});

// Import w „zakresie globalnym": losowanie rzuca - driver i moduł cache'u niczego nie losują.
const forbidden = () => {
  throw new Error("Disallowed operation called within global scope");
};
const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(forbidden);
const getRandomValues = vi
  .spyOn(globalThis.crypto, "getRandomValues")
  .mockImplementation(forbidden);
await import("../../../server");
const { isRevalidationRequest } = await import("../documentCache.server");

const trigger = () =>
  new Request("https://tenant-a.eu/blog", { headers: { "x-forwarded-host": "tenant-a.eu" } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("driver rewalidacji (`src/server.ts`) a nonce izolatu", () => {
  it("bez losowości nie renderuje; z losowością wystawia żądanie ze znacznikiem izolatu", async () => {
    expect(hoisted.revalidator).toBeTypeOf("function");
    expect(randomUUID).not.toHaveBeenCalled();
    expect(getRandomValues).not.toHaveBeenCalled();

    await expect(hoisted.revalidator!(trigger())).resolves.toBe(false);
    expect(hoisted.requests).toHaveLength(0);

    // Zakres żądania z losowością: nonce powstaje teraz i jedzie na syntetycznym żądaniu.
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await hoisted.revalidator!(trigger());
    expect(hoisted.requests).toHaveLength(1);
    const synthetic = hoisted.requests[0]!;
    const marker = synthetic.headers.get("x-nes-revalidate");
    expect(marker).toMatch(/^[0-9a-f-]{36}$/);
    expect(isRevalidationRequest(synthetic)).toBe(true);
    // Podróbka z zewnątrz nadal nie jest znacznikiem.
    expect(
      isRevalidationRequest(
        new Request("https://x/", { headers: { "x-nes-revalidate": "nes-0" } }),
      ),
    ).toBe(false);
  });
});
