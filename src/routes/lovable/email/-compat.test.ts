// Pięć aliasów zgodności `/lovable/email/*` -> `/platform/email/*`.
//
// DLACZEGO TO MA TEST. Adres webhooka jest konfiguracją ZEWNĘTRZNĄ wobec
// repozytorium: siedzi w panelu dostawcy, a nie w kodzie. W oknie przepięcia
// (PR #168 przeniósł powierzchnie platformowe z `/lovable/*` na `/platform/*`)
// dostawca woła jeszcze stary adres. Brak trasy albo zły cel przekazania to
// 404 na odbiciach i skargach - lista wykluczeń przestaje rosnąć, reputacja
// nadawcy spada PO CICHU, a razem z nią przestaje dochodzić poczta
// transakcyjna, w tym reset hasła. Na hooku `auth/webhook` konsekwencja jest
// jeszcze bezpośredniejsza: 404 = brak maila rejestracyjnego i resetu hasła.
//
// Dowód jest tu wąski i celowo taki: każdy z pięciu plików ma dokładnie jedną
// decyzję - JAKI cel podaje do `forwardToPlatformRoute`. Literówka w tej
// jednej stałej jest jedynym sposobem, w jaki ten plik może być zepsuty, i to
// jest to, co pilnujemy. Zachowanie samego przekazania (bajty ciała, nagłówki,
// 502 na awarii) należy do `src/lib/email/__tests__/platformCompat.server.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routeServerHandlers } from "@/test/routeHarness";

const forwardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/platformCompat.server", () => ({
  forwardToPlatformRoute: forwardMock,
}));

import { Route as AuthPreviewRoute } from "@/routes/lovable/email/auth/preview";
import { Route as AuthWebhookRoute } from "@/routes/lovable/email/auth/webhook";
import { Route as QueueProcessRoute } from "@/routes/lovable/email/queue/process";
import { Route as SuppressionRoute } from "@/routes/lovable/email/suppression";
import { Route as TxPreviewRoute } from "@/routes/lovable/email/transactional/preview";

/** Alias zgodności: trasa, jej stary adres i kanoniczny cel przekazania. */
const ALIASES = [
  {
    nazwa: "webhook maili autoryzacyjnych",
    route: AuthWebhookRoute,
    stary: "https://example.test/lovable/email/auth/webhook",
    cel: "/platform/email/auth/webhook",
  },
  {
    nazwa: "podgląd maili autoryzacyjnych",
    route: AuthPreviewRoute,
    stary: "https://example.test/lovable/email/auth/preview",
    cel: "/platform/email/auth/preview",
  },
  {
    nazwa: "podgląd maili transakcyjnych",
    route: TxPreviewRoute,
    stary: "https://example.test/lovable/email/transactional/preview",
    cel: "/platform/email/transactional/preview",
  },
  {
    nazwa: "webhook wykluczeń",
    route: SuppressionRoute,
    stary: "https://example.test/lovable/email/suppression",
    cel: "/platform/email/suppression",
  },
  {
    nazwa: "dren kolejki pocztowej",
    route: QueueProcessRoute,
    stary: "https://example.test/lovable/email/queue/process",
    cel: "/platform/email/queue/process",
  },
] as const;

beforeEach(() => {
  forwardMock.mockReset();
  forwardMock.mockResolvedValue(Response.json({ ok: true }));
});

describe("aliasy zgodności /lovable/email/*", () => {
  it.each(ALIASES)("$nazwa przekazuje na kanoniczną ścieżkę", async ({ route, stary, cel }) => {
    const request = new Request(stary, { method: "POST", body: "{}" });

    await routeServerHandlers(route).POST({ request });

    expect(forwardMock).toHaveBeenCalledTimes(1);
    expect(forwardMock).toHaveBeenCalledWith(request, cel);
  });

  it.each(ALIASES)(
    "$nazwa oddaje odpowiedź kanonicznej trasy BEZ zmian",
    async ({ route, stary }) => {
      // Dostawca musi widzieć ten sam kontrakt na obu adresach - inaczej retry
      // po stronie dostawcy zachowuje się inaczej na starym i nowym adresie.
      const upstream = Response.json({ success: true, duplicate: false }, { status: 202 });
      forwardMock.mockResolvedValue(upstream);

      const response = await routeServerHandlers(route).POST({
        request: new Request(stary, { method: "POST", body: "{}" }),
      });

      expect(response).toBe(upstream);
      expect(response.status).toBe(202);
    },
  );

  it.each(ALIASES)(
    "$nazwa oddaje 502 z warstwy przekazania, gdy kanoniczna trasa nie odpowiada",
    async ({ route, stary }) => {
      // Alias nie ma własnej obsługi awarii i mieć jej nie powinien: jedno
      // miejsce decyduje, co widzi dostawca, gdy self-subrequest padnie.
      forwardMock.mockResolvedValue(
        Response.json({ error: "Upstream unavailable" }, { status: 502 }),
      );

      const response = await routeServerHandlers(route).POST({
        request: new Request(stary, { method: "POST", body: "{}" }),
      });

      expect(response.status).toBe(502);
    },
  );

  it("KAŻDY alias celuje w INNĄ ścieżkę - kanarek na skopiowanej stałej", async () => {
    // Te pliki powstały przez skopiowanie jednego wzorca. Zapomniana podmiana
    // celu przekazałaby np. odbicia na endpoint podglądu: 200 w odpowiedzi,
    // zero blokad na liście wykluczeń i żadnego sygnału, że coś nie działa.
    for (const alias of ALIASES) {
      await routeServerHandlers(alias.route).POST({
        request: new Request(alias.stary, { method: "POST", body: "{}" }),
      });
    }

    const cele = forwardMock.mock.calls.map((call) => call[1]);
    expect(cele).toEqual(ALIASES.map((a) => a.cel));
    expect(new Set(cele).size).toBe(ALIASES.length);
  });

  it("żaden alias nie wystawia metody innej niż POST", () => {
    // GET na webhooku dostawcy byłby powierzchnią bez podpisu HMAC.
    for (const alias of ALIASES) {
      expect(Object.keys(routeServerHandlers(alias.route))).toEqual(["POST"]);
    }
  });
});
