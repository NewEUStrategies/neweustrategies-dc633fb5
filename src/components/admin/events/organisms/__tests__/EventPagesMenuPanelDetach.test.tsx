// Ekran „Strony i menu" - ODMOWA ODPIECIA DOJEZDZA DO REDAKTORA JAKO ZDANIE.
//
// PO CO OSOBNY PLIK OBOK `EventPagesMenuPanel.test.tsx`. Tamten dowodzi, ze
// pozycja MODULOWA nie ma przycisku odpiecia - i to jest pierwsza linia obrony.
// Ten dowodzi drugiej: co widzi redaktor, gdy odmowa mimo wszystko przyjdzie.
//
// TAKI PRZYPADEK ISTNIEJE I NIE JEST HIPOTEZA. `eventPageModule` zweza znacznik
// do PIATKI ZNANEJ KLIENTOWI - szosty modul dopisany w migracji przyjdzie do
// panelu jako `null`, czyli jako „zwykla pozycja", i dostanie przycisk
// odpiecia, ktorego baza nie wykona (`module_page`, migracja 20260826181500,
// krok 5; asercja 90/(d) w `runtime_test.d/90_module_pages.sql`). To samo
// zdarzy sie przy karcie otwartej przed migracja.
//
// I WLASNIE DLATEGO POWOD MUSI BYC WIDOCZNY. `module_page` niesie odpowiedz, co
// zrobic zamiast odpiecia („schowaj ja, wylaczajac widocznosc w menu"). Zdanie
// awaryjne (`unknown`) tej odpowiedzi nie ma - redaktor probuje wtedy drugi
// i trzeci raz, bo nic nie mowi mu, ze ta akcja nie uda sie nigdy.
//
// DLATEGO MAPPER ODMOW NIE JEST TU ZAMOCKOWANY - inaczej test dowodzilby
// wylacznie tego, ze panel wola jakas funkcje. Slownik jest PRAWDZIWY
// (`@/lib/i18n-admin-events`), a asercja porownuje z `i18n.t(<klucz>)`, a nie
// z przepisanym recznie zdaniem.
//
// PARA „ODMOWA / SUKCES": pozycja redakcyjna odpina sie bez przeszkod i mowi
// o tym innym komunikatem. Bez tego kontrapunktu asercja odmowy przechodzilaby
// takze wtedy, gdyby odpiecie padalo zawsze.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { adminEventDetailRow } from "@/test/events/adminEventStudioRows";
import type { EventPageRow } from "@/lib/events/eventPagesApi";

/** Odmowa bazy w postaci, w ktorej podnosi ja `admin_event_page_detach`. */
const ODMOWA_MODULOWA = "module_page: hide it with in_menu = false instead";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  /** Blad, ktorym odpowiada mutacja odpiecia (null = sukces). */
  detachError: null as Error | null,
  detachIds: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => () => undefined,
}));

vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

vi.mock("@/components/admin/events/studio/EventStudioPreviewContext", () => ({
  useSyncEventPreview: () => undefined,
}));
vi.mock("@/components/admin/events/molecules/EventPageCreateDialog", () => ({
  EventPageCreateDialog: () => null,
}));
vi.mock("@/components/admin/events/molecules/EventPageEntrySheet", () => ({
  EventPageEntrySheet: () => null,
}));

vi.mock("@/lib/events/useEventTermsGroups", () => ({ useEventGroups: () => ({ data: [] }) }));
vi.mock("@/lib/events/useAdminEventDetail", () => ({
  useSaveEventGeneral: () => ({ mutate: () => undefined, isPending: false }),
}));

vi.mock("@/lib/events/useAdminEventPages", () => ({
  useAdminEventPages: () => ({
    data: h.rows,
    isLoading: false,
    isError: false,
    refetch: async () => ({ data: h.rows }),
  }),
  useEventRootPage: () => ({ data: null }),
  useEventPageDocument: () => ({ data: null, isPending: false }),
  useSaveEventPage: () => ({ mutate: () => undefined, isPending: false }),
  useDetachEventPage: () => ({
    mutate: (
      id: string,
      opts?: { onSuccess?: (value: boolean) => void; onError?: (error: Error) => void },
    ) => {
      h.detachIds.push(id);
      if (h.detachError === null) opts?.onSuccess?.(true);
      else opts?.onError?.(h.detachError);
    },
    isPending: false,
  }),
  useReorderEventPages: () => ({ mutate: () => undefined, isPending: false }),
  useCreateEventPage: () => ({ mutate: () => undefined, isPending: false }),
}));

const { EventPagesMenuPanel } =
  await import("@/components/admin/events/organisms/EventPagesMenuPanel");

/** Wiersz listy podstron. `module: null` = pozycja, ktora klient zna jako zwykla. */
function page(overrides: Partial<EventPageRow> & { page_slug: string }): EventPageRow {
  return {
    id: `entry-${overrides.page_slug}`,
    page_id: `page-${overrides.page_slug}`,
    page_path: `kongres/${overrides.page_slug}`,
    page_status: "published",
    title_pl: overrides.page_slug,
    title_en: overrides.page_slug,
    menu_label_pl: null,
    menu_label_en: null,
    icon: "file-text",
    color: null,
    in_menu: true,
    sort_order: 10,
    visible_to_groups: [],
    module: null,
    updated_at: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz listy po widocznej etykiecie. */
function wiersz(label: string): HTMLElement {
  const found = screen.getAllByText(label).find((node) => node.closest("li") !== null);
  const li = found?.closest("li") ?? null;
  if (li === null) throw new Error(`brak wiersza „${label}” na ekranie`);
  return li;
}

beforeEach(() => {
  h.rows = [];
  h.detachError = null;
  h.detachIds = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("odmowa odpiecia strony modulowej", () => {
  // TO JEST GLOWNA ASERCJA TEGO PLIKU: powod z bazy zostaje NAZWANY.
  it("pokazuje ZDANIE o stronie modulowej, a nie awarie ogolna", async () => {
    h.rows = [page({ page_slug: "dyskusje" })];
    h.detachError = new Error(ODMOWA_MODULOWA);
    render(<EventPagesMenuPanel row={adminEventDetailRow()} />);

    within(wiersz("dyskusje"))
      .getByLabelText(/rowActions\.detach/)
      .click();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const komunikat = h.toastError.mock.calls[0][0];
    expect(komunikat).toBe(i18n.t("adminEvents.studio.errors.modulePage"));
    // ...i NIE jest to zdanie awaryjne. Bez tej polowy asercja przechodzilaby
    // takze wtedy, gdyby oba klucze mialy ten sam tekst.
    expect(komunikat).not.toBe(i18n.t("adminEvents.studio.errors.unknown"));
  });

  it("zdanie niesie DROGE, ktora zostaje - wylaczenie widocznosci w menu", () => {
    // Powod odmowy bez odpowiedzi „co zamiast" konczy sie druga i trzecia
    // proba tej samej akcji. Slownik ma o tym mowic, i to w obu jezykach.
    for (const lng of ["pl", "en"]) {
      const zdanie = i18n.t("adminEvents.studio.errors.modulePage", { lng });
      expect(zdanie.length, lng).toBeGreaterThan(20);
      expect(zdanie, lng).toMatch(/menu/i);
    }
  });

  // ODMOWA NIE JEST SUKCESEM. Toast sukcesu obok toastu bledu znaczylby dla
  // redaktora, ze pozycja zniknela - a ona stoi na miejscu.
  it("odmowa NIE mowi jednoczesnie, ze odpieto", async () => {
    h.rows = [page({ page_slug: "dyskusje" })];
    h.detachError = new Error(ODMOWA_MODULOWA);
    render(<EventPagesMenuPanel row={adminEventDetailRow()} />);

    within(wiersz("dyskusje"))
      .getByLabelText(/rowActions\.detach/)
      .click();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Wiersz zostaje na ekranie - lista czyta stan z bazy, nie z klikniecia.
    expect(wiersz("dyskusje")).toBeTruthy();
  });

  // KONTRAPUNKT: pozycja ZALOZONA PRZEZ REDAKCJE odpina sie bez przeszkod
  // i mowi o tym wlasnym komunikatem.
  it("pozycja redakcyjna odpina sie i mowi o tym", async () => {
    h.rows = [page({ page_slug: "prasa" })];
    render(<EventPagesMenuPanel row={adminEventDetailRow()} />);

    within(wiersz("prasa"))
      .getByLabelText(/rowActions\.detach/)
      .click();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.detachIds).toEqual(["entry-prasa"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.pageDetached");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  // Odmowa NIEZNANA nadal ma zdanie - tyle ze ogolne. Ta asercja pilnuje, ze
  // mapper nie oddaje surowego komunikatu plpgsql („violates check constraint")
  // ani samej kropkowanej sciezki klucza.
  it("odmowa spoza slownika spada na zdanie awaryjne, a nie na tekst z bazy", async () => {
    h.rows = [page({ page_slug: "prasa" })];
    h.detachError = new Error('new row violates check constraint "event_pages_icon_check"');
    render(<EventPagesMenuPanel row={adminEventDetailRow()} />);

    within(wiersz("prasa"))
      .getByLabelText(/rowActions\.detach/)
      .click();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const komunikat = h.toastError.mock.calls[0][0];
    expect(komunikat).toBe(i18n.t("adminEvents.studio.errors.unknown"));
    expect(komunikat).not.toContain("check constraint");
    expect(komunikat).not.toContain("adminEvents.");
  });
});
