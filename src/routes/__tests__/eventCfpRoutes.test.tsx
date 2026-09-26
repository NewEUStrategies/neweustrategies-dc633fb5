// Trasy naboru prelegentów po stronie uczestnika: `/events/<slug>/cfp`,
// `/events/<slug>/cfp-submit`, `/events/<slug>/speaker`, `/events/<slug>/review`.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   1. Strona naboru traci nazwę wydarzenia w tytule (loader nie bierze
//      `headEvent` z powłoki) albo trafia do indeksu z tytułem zastępczym.
//   2. Strony prywatne wchodzą do wyszukiwarki albo wysyłają `?id=` w nagłówku
//      `Referer` (brak `noindex` / `no-referrer`).
//   3. Formularz i panel recenzenta renderują się na serwerze (`ssr: false`
//      zgubione) - treść konta w HTML-u z cache krawędzi.
//   4. `?id=` z literówką dojeżdża do bazy zamiast wrócić jako „nowe
//      zgłoszenie" / „kolejka".
//   5. Trasa nie przekazuje sluga i identyfikatora do organizmu.
import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => "" }));
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: ({ variant }: { variant: string }) => (
    <div data-testid="friendly-error" data-variant={variant} />
  ),
}));

vi.mock("@/components/events/cfp/organisms/EventCfpPage", () => ({
  EventCfpPage: ({ slug }: { slug: string }) => (
    <div data-testid="organism" data-slug={slug} data-kind="cfp" />
  ),
}));
vi.mock("@/components/events/cfp/organisms/CfpSubmitPage", () => ({
  CfpSubmitPage: ({ slug, submissionId }: { slug: string; submissionId: string | null }) => (
    <div
      data-testid="organism"
      data-slug={slug}
      data-id={submissionId ?? "none"}
      data-kind="submit"
    />
  ),
}));
vi.mock("@/components/events/cfp/organisms/SpeakerPanelPage", () => ({
  SpeakerPanelPage: ({ slug }: { slug: string }) => (
    <div data-testid="organism" data-slug={slug} data-kind="speaker" />
  ),
}));
vi.mock("@/components/events/cfp/organisms/ReviewerPanelPage", () => ({
  ReviewerPanelPage: ({ slug, submissionId }: { slug: string; submissionId: string | null }) => (
    <div
      data-testid="organism"
      data-slug={slug}
      data-id={submissionId ?? "none"}
      data-kind="review"
    />
  ),
}));

const { Route: CfpRoute } = await import("@/routes/events.$slug.cfp");
const { Route: SubmitRoute } = await import("@/routes/events.$slug_.cfp-submit");
const { Route: SpeakerRoute } = await import("@/routes/events.$slug.speaker");
const { Route: ReviewRoute } = await import("@/routes/events.$slug_.review");

const ID = "11111111-1111-4111-8111-111111111111";

type LoaderFn = (ctx: {
  parentMatchPromise: Promise<{ loaderData?: { headEvent?: unknown } }>;
}) => Promise<{ headEvent: unknown }>;

/** STRAŻNIK, nie rzutowanie (wzorzec `adminEventCfpRoutes.test.tsx`). */
function isLoader(value: unknown): value is LoaderFn {
  return typeof value === "function";
}

function metaValue(meta: Record<string, unknown>[] | undefined, key: string): unknown {
  const list = meta ?? [];
  if (key === "title") return list.find((entry) => "title" in entry)?.title;
  return list.find((entry) => entry.name === key || entry.property === key)?.content;
}

afterEach(cleanup);

describe("/events/$slug/cfp", () => {
  it("loader bierze `headEvent` powłoki; nagłówek niesie nazwę wydarzenia", async () => {
    const loader: unknown = CfpRoute.options.loader;
    if (!isLoader(loader)) throw new Error("test: trasa nie ma loadera");
    const headEvent = { titlePl: "Kongres", titleEn: "Congress", cover: null };
    expect(
      await loader({ parentMatchPromise: Promise.resolve({ loaderData: { headEvent } }) }),
    ).toEqual({ headEvent });
    expect(await loader({ parentMatchPromise: Promise.resolve({}) })).toEqual({ headEvent: null });

    const head = routeHead(CfpRoute, { params: { slug: "kongres" }, loaderData: { headEvent } });
    expect(metaValue(head.meta, "og:title")).toBe("Nabór prelegentów - Kongres");
    expect(metaValue(head.meta, "title")).toBe(
      "Nabór prelegentów - Kongres - New European Strategies",
    );
    // Bez danych powłoki tytuł jest uczciwym zastępczym, nie pustką.
    expect(metaValue(routeHead(CfpRoute, { params: { slug: "kongres" } }).meta, "og:title")).toBe(
      "Nabór prelegentów - Wydarzenie",
    );
  });

  it("organizm dostaje slug", async () => {
    await renderRoute({
      route: CfpRoute,
      path: "/events/$slug/cfp",
      initialEntry: "/events/kongres/cfp",
    });
    await waitFor(() =>
      expect(screen.getByTestId("organism")).toHaveAttribute("data-slug", "kongres"),
    );
  });
});

describe("strony prywatne naboru", () => {
  it.each([
    [SubmitRoute, "Zgłoszenie wystąpienia"],
    [SpeakerRoute, "Panel prelegenta"],
    [ReviewRoute, "Panel recenzenta"],
  ] as const)("%#: noindex i no-referrer", (route, title) => {
    const head = routeHead(route, { params: { slug: "kongres" } });
    expect(metaValue(head.meta, "robots")).toBe("noindex, nofollow");
    expect(metaValue(head.meta, "referrer")).toBe("no-referrer");
    expect(metaValue(head.meta, "title")).toBe(`${title} - New European Strategies`);
  });

  it("formularz i panel recenzenta nie renderują się na serwerze; panel prelegenta jest w powłoce", () => {
    expect(SubmitRoute.options.ssr).toBe(false);
    expect(ReviewRoute.options.ssr).toBe(false);
    expect(SpeakerRoute.options.ssr).toBeUndefined();
  });

  it("`?id=` przechodzi tylko w kształcie UUID", () => {
    for (const route of [SubmitRoute, ReviewRoute]) {
      const validate = routeSearchValidator(route);
      expect(validate({ id: ID })).toEqual({ id: ID });
      expect(validate({ id: "nie-uuid" })).toEqual({});
      expect(validate({ id: 5 })).toEqual({});
      expect(validate({})).toEqual({});
    }
  });

  it.each([
    [SubmitRoute, "/events/$slug/cfp-submit", "submit"],
    [ReviewRoute, "/events/$slug/review", "review"],
  ] as const)("%#: organizm dostaje slug i identyfikator z adresu", async (route, path, kind) => {
    await renderRoute({
      route,
      path,
      initialEntry: `${path.replace("$slug", "kongres")}?id=${ID}`,
    });
    const node = await screen.findByTestId("organism");
    expect(node).toHaveAttribute("data-kind", kind);
    expect(node).toHaveAttribute("data-slug", "kongres");
    expect(node).toHaveAttribute("data-id", ID);
    cleanup();
    await renderRoute({ route, path, initialEntry: path.replace("$slug", "kongres") });
    expect(await screen.findByTestId("organism")).toHaveAttribute("data-id", "none");
  });

  it("panel prelegenta dostaje slug", async () => {
    await renderRoute({
      route: SpeakerRoute,
      path: "/events/$slug/speaker",
      initialEntry: "/events/kongres/speaker",
    });
    expect(await screen.findByTestId("organism")).toHaveAttribute("data-kind", "speaker");
  });

  it("granica błędu trasy to przyjazna strona, nie biały ekran", () => {
    for (const route of [SubmitRoute, ReviewRoute]) {
      for (const boundary of [route.options.errorComponent, route.options.notFoundComponent]) {
        if (typeof boundary !== "function") throw new Error("test: brak granicy błędu");
        const Boundary = boundary as () => ReactElement;
        render(<Boundary />);
        expect(screen.getByTestId("friendly-error")).toHaveAttribute("data-variant", "compact");
        cleanup();
      }
    }
  });
});
