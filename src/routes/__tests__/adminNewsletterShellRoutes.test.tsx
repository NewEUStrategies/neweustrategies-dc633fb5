// Przegląd newslettera (`/admin/newsletter/overview`) i layout sekcji
// (`/admin/newsletter`) - dwie trasy, które stały na 0%.
//
// PRZEGLĄD NIE JEST ZWYKŁYM EKRANEM. To domyślna strona sekcji
// (`/admin/newsletter` przekierowuje tutaj), więc montuje się jako PIERWSZA -
// i dlatego to właśnie tu odpala się okazjonalny tick `processDueCampaigns`:
// zastępnik pg_cron, który dowozi zaplanowane kampanie zaległe względem
// harmonogramu. Konsekwencje pomyłki idą w obie strony i obie są nieodwracalne:
//   * tick, który NIE biegnie - zaplanowana kampania nie wychodzi wcale,
//     a nikt się o tym nie dowie, bo panel wygląda normalnie;
//   * tick, który biegnie WIELOKROTNIE na jednym montowaniu - ta sama kampania
//     rusza dwa razy, czyli dwudziestotysięczna lista dostaje maila podwójnie.
//     Maila nie da się wycofać.
// Stąd asercja na strażniku `useRef`, a nie tylko na tym, że tick w ogóle padł.
//
// DOSTĘPU te trasy nie pilnują: robi to wspólny layout `/admin` (`isStaff`),
// którego bramka żyje w `adminRouteAuthority.gate.test.ts`. Ten plik chroni
// STAN i SKLEJENIE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  processDue: vi.fn(),
  toastSuccess: vi.fn(),
  ensureI18n: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.processDue,
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/i18n-newsletter-admin", () => ({ ensureI18n: h.ensureI18n }));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({ processDueCampaigns: {} }));
vi.mock("@/components/admin/newsletter/OverviewPanel", () => ({
  OverviewPanel: () => <div data-testid="panel-overview" />,
}));
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children, hideSidebar }: { children: React.ReactNode; hideSidebar?: boolean }) => (
    <div data-testid="admin-shell" data-hide-sidebar={String(Boolean(hideSidebar))}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/admin/newsletter/NewsletterSubNav", () => ({
  NewsletterSubNav: () => <nav data-testid="sub-nav" />,
}));
// Prawdziwy hak i18n na atrapie słownika: asercje idą po KLUCZU, nie po napisie.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "count" in opts ? `${key}#${String(opts.count)}` : key,
    i18n: { language: "pl" },
  }),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as OverviewRoute } from "@/routes/admin.newsletter.overview";
import { Route as LayoutRoute } from "@/routes/admin.newsletter";

function renderOverview(queryClient?: QueryClient) {
  return renderRoute({
    route: OverviewRoute,
    path: "/admin/newsletter/overview",
    initialEntry: "/admin/newsletter/overview",
    queryClient,
  });
}

/**
 * Klient zapytań z podglądem unieważnień, ZAŁOŻONYM PRZED renderem. Tick biegnie
 * w efekcie montowania, więc szpieg założony po `renderRoute` przegapiłby jego
 * skutek i test „dowodziłby" braku odświeżenia, którego nie było.
 */
function klientZPodgladem() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  return { client, invalidate };
}

beforeEach(() => {
  h.processDue.mockReset();
  h.processDue.mockResolvedValue({ fired: 0 });
  h.toastSuccess.mockClear();
  h.ensureI18n.mockClear();
});

afterEach(cleanup);

describe("przegląd newslettera - okazjonalny tick zaległych kampanii", () => {
  it("montowanie odpala tick DOKŁADNIE RAZ", async () => {
    // Drugie wywołanie na jednym montowaniu to druga wysyłka tej samej
    // kampanii. React w trybie ścisłym montuje efekt dwa razy - strażnik
    // `useRef` jest tu jedyną rzeczą, która stoi między tym a dubletem.
    await renderOverview();

    await waitFor(() => expect(h.processDue).toHaveBeenCalledTimes(1));
  });

  it("brak zaległych kampanii NIE pokazuje komunikatu i nie unieważnia cache", async () => {
    // Dymek „wysłano 0" przy każdym wejściu do panelu uczy operatora ignorować
    // ten komunikat - a wtedy przestaje działać także wtedy, gdy coś naprawdę
    // poszło.
    h.processDue.mockResolvedValue({ fired: 0 });

    const { client, invalidate } = klientZPodgladem();
    await renderOverview(client);

    await waitFor(() => expect(h.processDue).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("wysłanie zaległych melduje to KLUCZEM i18n z liczbą", async () => {
    h.processDue.mockResolvedValue({ fired: 3 });

    await renderOverview();

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminNewsletter.campaigns.dueFired#3"),
    );
  });

  it("wysłanie zaległych odświeża listę kampanii", async () => {
    // Bez unieważnienia lista pokazuje stan sprzed wysyłki: kampania „czeka",
    // choć właśnie poszła. Operator wysyła ją ręcznie drugi raz.
    h.processDue.mockResolvedValue({ fired: 1 });

    const { client, invalidate } = klientZPodgladem();
    await renderOverview(client);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        invalidate.mock.calls.some(
          (call) =>
            JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey) ===
            JSON.stringify(["admin", "newsletter-campaigns"]),
        ),
      ).toBe(true),
    );
  });

  it("AWARIA ticku nie wywraca panelu - przegląd renderuje się mimo odrzucenia", async () => {
    // Tick jest dodatkiem, nie treścią strony. Nieobsłużone odrzucenie
    // zamieniłoby okazjonalną wysyłkę zaległych w białą stronę panelu.
    h.processDue.mockRejectedValue(new Error("brak połączenia"));

    const { getByTestId } = await renderOverview();

    expect(getByTestId("panel-overview")).toBeTruthy();
    await waitFor(() => expect(h.processDue).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("dociąga nakładkę i18n panelu newslettera przed renderem", async () => {
    // Bez tego pierwsze wejście pokazuje gołe klucze zamiast etykiet.
    await renderOverview();

    expect(h.ensureI18n).toHaveBeenCalled();
  });

  it("renderuje panel przeglądu, a nie własną treść", async () => {
    const { getByTestId } = await renderOverview();

    expect(getByTestId("panel-overview")).toBeTruthy();
  });
});

describe("layout sekcji /admin/newsletter", () => {
  it("chowa boczne menu panelu - sekcja ma własną podnawigację", async () => {
    // Dwa menu naraz zabierają szerokość buildera maila do tego stopnia, że
    // kanwa przestaje się mieścić.
    const { getByTestId } = await renderRoute({
      route: LayoutRoute,
      path: "/admin/newsletter",
      initialEntry: "/admin/newsletter",
    });

    expect(getByTestId("admin-shell").getAttribute("data-hide-sidebar")).toBe("true");
  });

  it("pokazuje podnawigację sekcji nad treścią podstrony", async () => {
    const { getByTestId } = await renderRoute({
      route: LayoutRoute,
      path: "/admin/newsletter",
      initialEntry: "/admin/newsletter",
    });

    expect(getByTestId("sub-nav")).toBeTruthy();
  });
});
