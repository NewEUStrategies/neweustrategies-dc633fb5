// BYPASS NES Edge Cache zapada PRZED walidacją hosta (2026-10-22).
//
// CO PSUJE SIĘ BEZ TEGO TESTU. Na produkcji każde żądanie trafia w zimny izolat,
// a walidacja hosta (`trustedPublicHost`) to na zimnym izolacie pełny odczyt
// katalogu tenantów planem service-role. Ścieżki, których cache dokumentów i tak
// nie obsługuje - `/media/*` (obraz LCP strony głównej), `/api`, panel - płaciły
// ten odczyt przed odpowiedzią, choć klucz z hostem nie był im do niczego
// potrzebny. Test pilnuje obu stron: BYPASS nie pyta o host, a dokument
// cache'owalny nadal dostaje klucz prefiksowany ZWALIDOWANYM hostem (izolacja
// tenantów - klucz nie może przyjąć hosta wskazanego nagłówkiem).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDocumentRequest, resetDocumentCacheForTests } from "../documentCache.server";

const hoisted = vi.hoisted(() => ({ hostLookups: [] as string[] }));

vi.mock("@/lib/http/requestHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/requestHost")>();
  return {
    ...actual,
    trustedPublicHost: async (request: Request) => {
      hoisted.hostLookups.push(new URL(request.url).pathname);
      return actual.trustedPublicHost(request);
    },
  };
});

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => void work.catch(() => undefined),
}));

function get(path: string): Request {
  return new Request(`https://tenant-a.eu${path}`, { headers: { accept: "text/html" } });
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=900",
    },
  });
}

beforeEach(() => {
  hoisted.hostLookups.length = 0;
  resetDocumentCacheForTests();
});

afterEach(() => {
  resetDocumentCacheForTests();
});

describe("handleDocumentRequest - BYPASS bez walidacji hosta", () => {
  it.each([
    "/media/07167e87/wp-import/okladka.webp",
    "/api/public/vitals",
    "/admin/posts",
    "/szukaj?q=nato",
  ])("%s: odpowiedź bez odczytu katalogu tenantów", async (path) => {
    const next = vi.fn(async () => new Response("ok", { status: 200 }));
    const response = (await handleDocumentRequest(get(path), next)) as Response;

    expect(await response.text()).toBe("ok");
    expect(next).toHaveBeenCalledTimes(1);
    expect(hoisted.hostLookups).toEqual([]);
    expect(response.headers.get("x-nes-cache")).toBeNull();
  });

  it("dokument cache'owalny nadal waliduje host (klucz prefiksowany hostem)", async () => {
    const response = (await handleDocumentRequest(get("/"), async () =>
      html("<html>home</html>"),
    )) as Response;

    expect(await response.text()).toBe("<html>home</html>");
    expect(response.headers.get("x-nes-cache")).toBe("MISS");
    expect(hoisted.hostLookups).toEqual(["/"]);
  });
});
