import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaticPageSeo } from "@/lib/queries/staticPageSeo";
const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  url: "",
  state: null as null | { categories: Record<string, boolean> },
  accept: vi.fn(),
  reject: vi.fn(),
  preferences: vi.fn(),
  buildHead: vi.fn(),
  legal: vi.fn(),
  friendly: vi.fn(),
}));
vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => h.url }));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => h.lang }));
vi.mock("@/lib/seo/meta", () => ({
  SITE_NAME: "NES",
  buildContentHead: (...args: unknown[]) => h.buildHead(...args),
}));
vi.mock("@/lib/ads/consent", () => ({
  useConsent: () => ({ state: h.state, acceptAll: h.accept, rejectAll: h.reject }),
  requestConsentPreferences: () => h.preferences(),
}));
vi.mock("@/lib/legal/useLegalDocument", () => ({
  useLegalDocumentCopy: (kind: string, copy: Record<string, unknown>, lang: string) => {
    h.legal(kind, lang);
    return copy[lang];
  },
}));
vi.mock("@/components/legal/LegalPage", () => ({
  LegalPage: ({ title, lead, sections }: { title: string; lead: string; sections: unknown[] }) => (
    <main>
      <h1>{title}</h1>
      <p>{lead}</p>
      <span data-testid="sections">{sections.length}</span>
    </main>
  ),
}));
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: (props: unknown) => {
    h.friendly(props);
    return <main>Error view</main>;
  },
}));
vi.mock("@/lib/errorCopy", () => ({
  errorCopy: () => ({ generic: { title: "Generic error", body: "Try again" } }),
}));
import { Route as Cookies } from "@/routes/cookies";
import { Route as Privacy } from "@/routes/polityka-prywatnosci";
import { Route as Terms } from "@/routes/regulamin";
import { Route as Refunds } from "@/routes/zwroty-i-reklamacje";
import { Route as ErrorRoute } from "@/routes/error";
type RouteOptions = { component?: React.ComponentType; loader?: unknown; head?: unknown };
const routes: [string, RouteOptions][] = [
  ["cookies", Cookies.options],
  ["polityka-prywatnosci", Privacy.options],
  ["regulamin", Terms.options],
  ["zwroty-i-reklamacje", Refunds.options],
];
beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.url = "";
  h.state = null;
  h.buildHead.mockImplementation((value: unknown) => value);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe.each(routes)("static route %s", (slug, options) => {
  it.each(["pl", "en"] as const)(
    "renders identical initial server and browser markup in %s",
    (lang) => {
      h.lang = lang;
      h.url = `/${lang === "en" ? "en/" : ""}${slug}`;
      const Component = options.component!;
      const browserMarkup = renderToString(<Component />);
      vi.stubGlobal("window", undefined);
      const serverMarkup = renderToString(<Component />);
      vi.unstubAllGlobals();
      expect(serverMarkup).toBe(browserMarkup);
      expect(serverMarkup).toContain("<h1");
      if (slug !== "cookies")
        expect(h.legal).toHaveBeenCalledWith(
          slug === "regulamin" ? "terms" : slug === "polityka-prywatnosci" ? "privacy" : "refunds",
          lang,
        );
    },
  );
  it.each([false, true])(
    "loads SEO and degrades safely on an unavailable metadata endpoint (failure=%s)",
    async (failure) => {
      const ensureQueryData = failure
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : vi.fn().mockResolvedValue({ slug });
      const loader = options.loader as (args: unknown) => Promise<unknown>;
      expect(await loader({ context: { queryClient: { ensureQueryData } } })).toEqual({
        seo: failure ? null : { slug },
      });
      expect(ensureQueryData).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["static-page-seo", slug] }),
      );
    },
  );
  it.each(["pl", "en"] as const)(
    "uses localized metadata fallbacks and explicit editorial overrides in %s",
    (lang) => {
      h.lang = lang;
      const head = options.head as (args: unknown) => { title: string; url: string; lang: string };
      const fallback = head({});
      expect(fallback.url).toBe(`/${slug}`);
      expect(fallback.lang).toBe(lang);
      expect(fallback.title.length).toBeGreaterThan(5);
      h.url = `/en/${slug}`;
      const seo = {
        slug,
        title_pl: null,
        title_en: null,
        excerpt_pl: null,
        excerpt_en: null,
        seo_title_pl: "PL custom",
        seo_title_en: "EN custom",
        seo_description_pl: "PL lead",
        seo_description_en: "EN lead",
        seo_canonical_url: "https://example.test/canonical",
        seo_noindex: true,
        seo_og_image_url: "https://example.test/image.jpg",
        og_image_generated_url: null,
      } satisfies NonNullable<StaticPageSeo>;
      head({ loaderData: { seo } });
      expect(h.buildHead).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "EN custom",
          description: "EN lead",
          lang: "en",
          robots: "noindex,nofollow",
          canonicalOverride: seo.seo_canonical_url,
          image: seo.seo_og_image_url,
        }),
      );
    },
  );
});

describe("cookie preferences", () => {
  it.each(["pl", "en"] as const)(
    "dispatches all three actions and displays mixed consent in %s",
    (lang) => {
      h.lang = lang;
      h.state = {
        categories: { necessary: true, functional: true, analytics: false, marketing: false },
      };
      const Component = Cookies.options.component!;
      render(<Component />);
      fireEvent.click(
        screen.getByRole("button", { name: lang === "pl" ? "Akceptuj wszystkie" : "Accept all" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: lang === "pl" ? "Tylko niezbędne" : "Necessary only" }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: lang === "pl" ? "Zarządzaj preferencjami" : "Manage preferences",
        }),
      );
      expect(h.accept).toHaveBeenCalledOnce();
      expect(h.reject).toHaveBeenCalledOnce();
      expect(h.preferences).toHaveBeenCalledOnce();
      expect(screen.getAllByText(lang === "pl" ? "Włączone" : "Enabled")).toHaveLength(2);
      expect(screen.getAllByText(lang === "pl" ? "Wyłączone" : "Disabled")).toHaveLength(2);
    },
  );
});

describe("addressable error route", () => {
  it.each([
    [{}, {}],
    [
      { kind: "network", title: "Custom", footer: "Help" },
      { kind: "network", title: "Custom", footer: "Help" },
    ],
    [{ kind: "invented" }, { kind: "generic" }],
    [{ title: 17 }, { kind: "generic" }],
  ])("validates search %#", (input, output) => {
    const validate = ErrorRoute.options.validateSearch as (input: unknown) => unknown;
    expect(validate(input)).toEqual(output);
  });
  it.each([
    ["unauthorized", 401],
    ["sessionExpired", 302],
    ["network", 0],
    ["generic", 500],
    [undefined, 500],
  ] as const)("maps %s to the friendly error classification", (kind, status) => {
    vi.spyOn(ErrorRoute, "useSearch").mockReturnValue({ kind, title: "A title", footer: "Footer" });
    const Component = ErrorRoute.options.component!;
    render(<Component />);
    expect(h.friendly).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ status }),
        title: "A title",
        footer: "Footer",
      }),
    );
  });
  it("keeps its generic error document out of search indexes", () => {
    const head = ErrorRoute.options.head as () => unknown;
    expect(head()).toEqual({
      meta: [
        { title: "Generic error - NES" },
        { name: "description", content: "Try again" },
        { name: "robots", content: "noindex, nofollow" },
      ],
    });
  });
});
