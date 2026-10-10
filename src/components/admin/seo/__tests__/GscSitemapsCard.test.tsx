// Karta „Mapy witryn w Google" (zakładka Search Console).
//
// CO TEN PLIK DOWODZI:
//   1. STAN KAŻDEGO PLIKU TAK, JAK GO WIDZI GOOGLE: wiersz na mapę zgłoszoną
//      i na każdy plik z indeksu (wcięty), z tym samym porządkiem ważności co
//      Search Console (błędy > ostrzeżenia > oczekuje > nigdy nie pobrano > OK)
//      i z liczbą wykrytych adresów.
//   2. AKCJA TYLKO DLA ADMINA. Serwer przyjmuje zgłoszenie wyłącznie od roli
//      `admin`, więc redaktor nie widzi ani przycisku „Prześlij mapę do Google",
//      ani „Prześlij ponownie" - interfejs nie oferuje akcji, którą serwer
//      odrzuci. Pliki z indeksu nie mają własnego przycisku: Google pobiera je
//      przez indeks, a ich zgłoszenie osobno dublowałoby wpisy w raporcie.
//   3. ZGŁOSZENIE: przycisk woła serwer z adresem indeksu PUBLICZNEJ domeny
//      najemcy, po sukcesie pokazuje potwierdzenie i odświeża stan z Google;
//      brak uprawnień konektora to opisany komunikat, a nie surowy wyjątek.
//   4. STANY BRAKU: konektor niepodłączony, brak indeksu wśród zgłoszonych map,
//      najemca jeszcze nieustalony (karta nie pyta serwera).
//
// Warstwa serwerowa (`listGscSitemaps` / `submitGscSitemap`, rola, związanie
// z najemcą, lista dozwolonych plików) ma własne testy w
// `src/lib/analytics/__tests__/gscFunctions.test.ts` - tu są atrapami.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { GscSitemap, GscSubmitResult } from "@/lib/analytics/gsc.functions";

const ORIGIN = "https://example.com";
const SITE = "sc-domain:example.com";

interface ListResponse {
  sitemaps: GscSitemap[];
  configured: boolean;
}

interface SubmitInput {
  data: { siteUrl: string; feedpath: string };
}

const h = vi.hoisted(() => ({
  list: null as Mock<(input: { data: { siteUrl: string } }) => Promise<ListResponse>> | null,
  submit: null as Mock<(input: SubmitInput) => Promise<GscSubmitResult>> | null,
  toastSuccess: null as Mock<(message: string) => void> | null,
  toastErrorMsg: null as Mock<(message: string) => void> | null,
  toastError: null as Mock<(e: unknown) => void> | null,
  isAdmin: true,
  tenantId: "tenant-a" as string | null,
  origin: "https://example.com" as string | null,
  originStatus: "resolved" as "resolved" | "pending" | "failed",
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/analytics/gsc.functions", async () => {
  const { vi: v } = await import("vitest");
  h.list = v.fn(async () => ({ sitemaps: [], configured: true }));
  h.submit = v.fn(async () => ({ ok: true }) as GscSubmitResult);
  return { listGscSitemaps: h.list, submitGscSitemap: h.submit };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: h.isAdmin }) }));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));
vi.mock("@/lib/seo/useTenantPublicOrigin", () => ({
  useTenantPublicOriginState: () => ({ origin: h.origin, status: h.originStatus }),
}));

vi.mock("sonner", async () => {
  const { vi: v } = await import("vitest");
  h.toastSuccess = v.fn<(message: string) => void>();
  h.toastErrorMsg = v.fn<(message: string) => void>();
  return { toast: { success: h.toastSuccess, error: h.toastErrorMsg }, Toaster: () => null };
});

vi.mock("@/lib/toastError", async () => {
  const { vi: v } = await import("vitest");
  h.toastError = v.fn<(e: unknown) => void>();
  return { toastError: h.toastError };
});

import { GscSitemapsCard } from "@/components/admin/seo/GscSitemapsCard";

function must<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`atrapa ${name} nie została ustawiona`);
  return value;
}

const listMock = () => must(h.list, "listGscSitemaps");
const submitMock = () => must(h.submit, "submitGscSitemap");

function sitemap(path: string, overrides: Partial<GscSitemap> = {}): GscSitemap {
  return {
    path: `${ORIGIN}${path}`,
    lastSubmitted: "2026-10-01T08:00:00.000Z",
    lastDownloaded: "2026-10-01T08:05:00.000Z",
    isPending: false,
    isSitemapsIndex: false,
    errors: 0,
    warnings: 0,
    contents: [],
    children: [],
    ...overrides,
  };
}

/** Stan z raportu GSC, od którego zaczęła się ta karta (4.10 i 23.09). */
function reportFromGsc(): GscSitemap[] {
  return [
    sitemap("/sitemap.xml", {
      isSitemapsIndex: true,
      contents: [{ type: "web", submitted: 60 }],
      children: [
        sitemap("/sitemaps/core.xml", {
          errors: 1,
          contents: [{ type: "web", submitted: 47 }],
        }),
        sitemap("/sitemaps/posts.xml", { contents: [{ type: "web", submitted: 13 }] }),
      ],
    }),
    sitemap("/news-sitemap.xml", { errors: 1 }),
    sitemap("/sitemaps/pages.xml", { warnings: 2 }),
    sitemap("/sitemaps/tracker.xml", { isPending: true }),
    sitemap("/sitemaps/live.xml", { lastDownloaded: null }),
  ];
}

function given(sitemaps: GscSitemap[], configured = true): void {
  listMock().mockImplementation(async () => ({ sitemaps, configured }));
}

function row(path: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-gsc-sitemap="${path}"]`);
  if (!el) throw new Error(`brak wiersza ${path}`);
  return el;
}

function submitButtons(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-gsc-submit]")].map(
    (el) => el.dataset.gscSubmit ?? "",
  );
}

async function renderCard() {
  const view = renderWithQueryClient(<GscSitemapsCard siteUrl={SITE} />);
  await waitFor(() => expect(listMock()).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  h.isAdmin = true;
  h.tenantId = "tenant-a";
  h.origin = ORIGIN;
  h.originStatus = "resolved";
  listMock().mockReset();
  submitMock().mockReset();
  given([]);
  submitMock().mockImplementation(async () => ({ ok: true }));
  must(h.toastSuccess, "toast.success").mockReset();
  must(h.toastErrorMsg, "toast.error").mockReset();
  must(h.toastError, "toastError").mockReset();
});

describe("GscSitemapsCard - stan map w Google", () => {
  it("pyta serwer o mapy WYBRANEJ właściwości", async () => {
    await renderCard();

    expect(listMock()).toHaveBeenCalledWith({ data: { siteUrl: SITE } });
  });

  it("pokazuje wiersz na każdą mapę i na każdy plik z indeksu, ze stanem jak w GSC", async () => {
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");

    expect(row("/sitemap.xml").dataset.state).toBe("ok");
    expect(row("/sitemaps/core.xml").dataset.state).toBe("errors");
    expect(row("/sitemaps/posts.xml").dataset.state).toBe("ok");
    expect(row("/news-sitemap.xml").dataset.state).toBe("errors");
    expect(row("/sitemaps/pages.xml").dataset.state).toBe("warnings");
    expect(row("/sitemaps/tracker.xml").dataset.state).toBe("pending");
    expect(row("/sitemaps/live.xml").dataset.state).toBe("never");

    expect(
      within(row("/sitemaps/core.xml")).getByText("adminSeoHub.gscState_errors(n=1)"),
    ).toBeTruthy();
    expect(
      within(row("/sitemaps/pages.xml")).getByText("adminSeoHub.gscState_warnings(n=2)"),
    ).toBeTruthy();
    expect(within(row("/sitemaps/core.xml")).getByText("47")).toBeTruthy();
    expect(within(row("/sitemap.xml")).getByText("adminSeoHub.gscIndexLabel")).toBeTruthy();
  });

  it("pliki z indeksu stoją ZARAZ pod nim, w kolejności z Google", async () => {
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");

    const order = [...document.querySelectorAll<HTMLElement>("[data-gsc-sitemap]")].map(
      (el) => el.dataset.gscSitemap,
    );
    expect(order.slice(0, 4)).toEqual([
      "/sitemap.xml",
      "/sitemaps/core.xml",
      "/sitemaps/posts.xml",
      "/news-sitemap.xml",
    ]);
  });

  it("adresy map są linkami do plików, a raport prowadzi do GSC tej właściwości", async () => {
    given(reportFromGsc());
    await renderCard();
    const link = await screen.findByText("/news-sitemap.xml");

    expect(link.closest("a")?.getAttribute("href")).toBe(`${ORIGIN}/news-sitemap.xml`);
    const report = screen.getByText("adminSeoHub.gscOpenReport").closest("a");
    expect(report?.getAttribute("href")).toBe(
      `https://search.google.com/search-console/sitemaps?resource_id=${encodeURIComponent(SITE)}`,
    );
  });
});

describe("GscSitemapsCard - akcja tylko dla admina", () => {
  it("admin widzi „Prześlij mapę do Google” i „Prześlij ponownie” przy mapach zgłoszonych", async () => {
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");

    expect(screen.getByText("adminSeoHub.gscSubmitIndex")).toBeTruthy();
    // Pliki z indeksu (`core`, `posts`) nie mają własnego przycisku.
    expect(submitButtons().sort()).toEqual(
      [
        "/sitemap.xml",
        "/sitemap.xml",
        "/news-sitemap.xml",
        "/sitemaps/pages.xml",
        "/sitemaps/tracker.xml",
        "/sitemaps/live.xml",
      ].sort(),
    );
  });

  it("redaktor NIE widzi żadnego przycisku przesyłania", async () => {
    h.isAdmin = false;
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");

    expect(submitButtons()).toEqual([]);
    expect(screen.queryByText("adminSeoHub.gscSubmitIndex")).toBeNull();
    expect(screen.queryByText("adminSeoHub.gscResubmit")).toBeNull();
  });

  it.each(["pending", "failed"] as const)(
    "domena najemcy w stanie „%s”: brak przycisku indeksu (origin tymczasowy z hosta)",
    async (status) => {
      // Przegląd PR #492: w trakcie odczytu hook oddaje origin z hosta
      // przeglądarki - na wspólnym hoście byłby to adres cudzego serwisu.
      h.originStatus = status;
      given([sitemap("/news-sitemap.xml")]);
      await renderCard();
      await screen.findByText("/news-sitemap.xml");

      expect(screen.queryByText("adminSeoHub.gscSubmitIndex")).toBeNull();
      expect(document.querySelector("[data-gsc-index-missing]")).toBeNull();
    },
  );

  it("bez publicznej domeny najemcy nie ma czego zgłosić jako indeksu", async () => {
    h.origin = null;
    await renderCard();

    expect(screen.queryByText("adminSeoHub.gscSubmitIndex")).toBeNull();
  });
});

describe("GscSitemapsCard - zgłoszenie mapy", () => {
  it("„Prześlij mapę do Google” wysyła adres indeksu publicznej domeny i odświeża stan", async () => {
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");
    const callsBefore = listMock().mock.calls.length;

    fireEvent.click(screen.getByText("adminSeoHub.gscSubmitIndex"));

    await waitFor(() =>
      expect(submitMock()).toHaveBeenCalledWith({
        data: { siteUrl: SITE, feedpath: `${ORIGIN}/sitemap.xml` },
      }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminSeoHub.gscSubmitted(value=/sitemap.xml)"),
    );
    await waitFor(() => expect(listMock().mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("„Prześlij ponownie” w wierszu wysyła DOKŁADNIE adres tego pliku", async () => {
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/news-sitemap.xml");

    fireEvent.click(within(row("/news-sitemap.xml")).getByText("adminSeoHub.gscResubmit"));

    await waitFor(() =>
      expect(submitMock()).toHaveBeenCalledWith({
        data: { siteUrl: SITE, feedpath: `${ORIGIN}/news-sitemap.xml` },
      }),
    );
  });

  it("brak uprawnień konektora to opisany komunikat, bez odświeżania stanu", async () => {
    given(reportFromGsc());
    submitMock().mockImplementation(async () => ({ ok: false, reason: "permission" }));
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");
    const callsBefore = listMock().mock.calls.length;

    fireEvent.click(screen.getByText("adminSeoHub.gscSubmitIndex"));

    await waitFor(() =>
      expect(h.toastErrorMsg).toHaveBeenCalledWith("adminSeoHub.gscSubmit_permission"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(listMock().mock.calls.length).toBe(callsBefore);
  });

  it("wyjątek serwera trafia do wspólnego toastu błędów", async () => {
    const error = new Error("Forbidden: admin role required");
    submitMock().mockImplementation(async () => {
      throw error;
    });
    await renderCard();

    fireEvent.click(screen.getByText("adminSeoHub.gscSubmitIndex"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(error));
  });
});

describe("GscSitemapsCard - stany braku", () => {
  it("konektor niepodłączony: komunikat zamiast tabeli", async () => {
    given([], false);
    await renderCard();

    expect(await screen.findByText("adminSeoHub.gscSubmit_notConfigured")).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
  });

  it("indeks spoza zgłoszonych map podnosi notkę z jego adresem", async () => {
    given([sitemap("/news-sitemap.xml")]);
    await renderCard();
    await screen.findByText("/news-sitemap.xml");

    const note = document.querySelector("[data-gsc-index-missing]");
    expect(note?.textContent).toBe("adminSeoHub.gscIndexMissing(value=/sitemap.xml)");
  });

  it("zgłoszony indeks nie podnosi notki", async () => {
    given(reportFromGsc());
    await renderCard();
    await screen.findByText("/sitemaps/core.xml");

    expect(document.querySelector("[data-gsc-index-missing]")).toBeNull();
  });

  it("pusta lista map to komunikat „brak map”", async () => {
    await renderCard();

    expect(await screen.findByText("adminSeoHub.gscNoSitemaps")).toBeTruthy();
  });

  it("błąd odczytu to komunikat błędu, nie pusta tabela", async () => {
    listMock().mockImplementation(async () => {
      throw new Error("GSC 500: boom");
    });
    await renderCard();

    expect(await screen.findByText("adminSeoHub.gscSitemapsLoadFailed")).toBeTruthy();
  });

  it("bez ustalonego najemcy karta nie pyta serwera", async () => {
    h.tenantId = null;
    renderWithQueryClient(<GscSitemapsCard siteUrl={SITE} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listMock()).not.toHaveBeenCalled();
  });
});
