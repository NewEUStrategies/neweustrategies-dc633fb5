// Dwie trasy raportu dla sponsorów:
//   * `/events/$slug_/sponsor-report` - strona dla sponsora BEZ konta,
//   * `/admin/events_/$eventId/sponsor-report` - ekran studia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. STRONA Z POŚWIADCZENIEM W INDEKSIE albo w `Referer`. `noindex,
//      nofollow` i `no-referrer` nie są ozdobą: adres niesie token.
//   2. RENDER SERWERA. Token siedzi we fragmencie, którego serwer nie widzi -
//      `ssr: false` jest konieczne, a strona z danymi sponsora nie ma istnieć
//      w żadnej kopii poza przeglądarką odbiorcy.
//   3. NAGŁÓWEK DOKUMENTU W ZŁYM JĘZYKU albo z surowym kluczem.
//   4. `?sponsor=` Z CZYMKOLWIEK - identyfikator spoza kształtu uuid nie
//      dociera do zapytania raportu.
//   5. EKRAN STUDIA RYSUJE SIĘ BEZ WIERSZA WYDARZENIA (drugi spinner pod
//      spinnerem ramy) albo gubi filtr sponsora z adresu.
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";

const h = vi.hoisted(() => ({
  requestUrl: "/events/kongres/sponsor-report",
  detail: undefined as unknown,
  detailIds: [] as string[],
  panels: [] as { row: unknown; initialSponsorId: string | null }[],
}));

// Język nagłówka bierze się z ADRESU żądania (`activeLang`), jak w całym serwisie.
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));
vi.mock("@/components/events/sponsor-report/SponsorReportPublicPanel", () => ({
  SponsorReportPublicPanel: () => <div data-testid="public-panel" />,
}));
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: ({ variant }: { variant?: string }) => (
    <div data-testid="error-page">{variant ?? "page"}</div>
  ),
}));
vi.mock("@/components/admin/events/organisms/SponsorReportPanel", () => ({
  SponsorReportPanel: (props: { row: unknown; initialSponsorId: string | null }) => {
    h.panels.push(props);
    return <div data-testid="admin-panel" />;
  },
}));
vi.mock("@/lib/events/useAdminEventDetail", () => ({
  useAdminEventDetail: (eventId: string) => {
    h.detailIds.push(eventId);
    return { data: h.detail };
  },
}));

import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import {
  eventSponsorReportHeadEn,
  eventSponsorReportHeadPl,
} from "@/lib/i18n-event-sponsor-report-head";
import { Route as PublicRoute } from "@/routes/events.$slug_.sponsor-report";
import { Route as AdminRoute } from "@/routes/admin.events_.$eventId.sponsor-report";

const SPONSOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function meta(entries: Record<string, unknown>[] | undefined, name: string): string {
  const found = (entries ?? []).find((entry) => entry.name === name)?.content;
  if (typeof found !== "string") throw new Error(`brak meta ${name}`);
  return found;
}

beforeEach(() => {
  cleanup();
  h.requestUrl = "/events/kongres/sponsor-report";
  h.detail = undefined;
  h.detailIds = [];
  h.panels = [];
});

describe("strona raportu dla sponsora", () => {
  it("bez renderu serwera, poza indeksem i bez nagłówka odesłania", () => {
    expect(PublicRoute.options.ssr).toBe(false);
    const head = routeHead(PublicRoute);
    expect(meta(head.meta, "robots")).toBe("noindex, nofollow");
    expect(meta(head.meta, "referrer")).toBe("no-referrer");
  });

  it("tytuł i opis w języku strony, z nazwą serwisu", async () => {
    let head = routeHead(PublicRoute);
    const title = String(head.meta?.find((entry) => "title" in entry)?.title);
    expect(title.startsWith(`${eventSponsorReportHeadPl.eventSponsorReportHead.title} - `)).toBe(
      true,
    );
    expect(meta(head.meta, "description")).toBe(
      eventSponsorReportHeadPl.eventSponsorReportHead.description,
    );
    h.requestUrl = "/en/events/kongres/sponsor-report";
    head = routeHead(PublicRoute);
    expect(meta(head.meta, "description")).toBe(
      eventSponsorReportHeadEn.eventSponsorReportHead.description,
    );
  });

  it("montuje organizm raportu w głównym obszarze strony", async () => {
    await renderRoute({
      route: PublicRoute,
      path: "/events/$slug_/sponsor-report",
      initialEntry: "/events/kongres/sponsor-report",
    });
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByTestId("public-panel")).toBeTruthy();
  });

  it("błąd i brak strony mają zwięzłą stronę błędu", () => {
    const ErrorScreen = PublicRoute.options.errorComponent;
    const NotFoundScreen = PublicRoute.options.notFoundComponent;
    if (!ErrorScreen || !NotFoundScreen) throw new Error("trasa bez ekranów błędu");
    render(<ErrorScreen error={new Error("padło")} reset={() => undefined} />);
    render(<NotFoundScreen isNotFound routeId="/events/$slug_/sponsor-report" />);
    expect(screen.getAllByTestId("error-page").map((node) => node.textContent)).toEqual([
      "compact",
      "compact",
    ]);
  });
});

describe("ekran studia", () => {
  const validate = routeSearchValidator(AdminRoute);

  it("`?sponsor=` przepuszcza tylko uuid", () => {
    expect(validate({ sponsor: SPONSOR })).toEqual({ sponsor: SPONSOR });
    expect(validate({ sponsor: "nie-uuid" })).toEqual({});
    expect(validate({ sponsor: 7 })).toEqual({});
    expect(validate({})).toEqual({});
  });

  it("nagłówek panelu jest poza indeksem", () => {
    const head = routeHead(AdminRoute);
    expect(meta(head.meta, "robots")).toBe("noindex, nofollow");
    expect(head.meta).toContainEqual({ title: "Sponsor report · Event · Admin" });
  });

  it("bez wiersza wydarzenia nie rysuje niczego (spinner należy do ramy studia)", async () => {
    await renderRoute({
      route: AdminRoute,
      path: "/admin/events_/$eventId/sponsor-report",
      initialEntry: "/admin/events_/ev-1/sponsor-report",
    });
    expect(h.detailIds).toContain("ev-1");
    expect(screen.queryByTestId("admin-panel")).toBeNull();
  });

  it("z wierszem montuje panel z filtrem sponsora z adresu", async () => {
    h.detail = { id: "ev-1", slug: "kongres" };
    await renderRoute({
      route: AdminRoute,
      path: "/admin/events_/$eventId/sponsor-report",
      initialEntry: `/admin/events_/ev-1/sponsor-report?sponsor=${SPONSOR}`,
    });
    expect(screen.getByTestId("admin-panel")).toBeTruthy();
    expect(h.panels.at(-1)).toEqual({ row: h.detail, initialSponsorId: SPONSOR });
  });

  it("zły filtr w adresie NIE dociera do panelu - panel dostaje `null`", async () => {
    h.detail = { id: "ev-1", slug: "kongres" };
    await renderRoute({
      route: AdminRoute,
      path: "/admin/events_/$eventId/sponsor-report",
      initialEntry: "/admin/events_/ev-1/sponsor-report?sponsor=zly",
    });
    expect(h.panels.at(-1)?.initialSponsorId).toBeNull();
  });
});
