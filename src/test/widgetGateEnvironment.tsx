import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { afterAll, beforeAll, expect, vi } from "vitest";
import { GEO_ASSET_URL } from "@/lib/charts/types";

/** Real routing context without mounting the application's routes/loaders. */
export function WidgetGateRouter({ children }: { children: ReactNode }) {
  const [router] = useState(() =>
    createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    }),
  );
  return <RouterContextProvider router={router}>{children}</RouterContextProvider>;
}

/** Serve only the checked-in map assets; unexpected network requests fail the gate. */
export function installWidgetGateFetch(): void {
  const unexpectedRequests: string[] = [];
  beforeAll(() => {
    const fetchAsset: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const asset = Object.values(GEO_ASSET_URL).find(
        (path) => url === path || url === new URL(path, window.location.href).href,
      );
      if (!asset) {
        unexpectedRequests.push(url);
        throw new Error(`Unexpected widget gate request: ${url}`);
      }
      return new Response(readFileSync(resolve("public", asset.slice(1)), "utf8"), {
        headers: { "Content-Type": "application/json" },
      });
    };
    vi.stubGlobal("fetch", fetchAsset);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    expect(unexpectedRequests, "Widget gates must not make unhandled network requests").toEqual([]);
  });
}
