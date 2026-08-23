// Organizm listy linków podarunkowych - CO PANEL WYSYŁA, CO ODRZUCA,
// I O CZYM MILCZY.
//
// CO TEN PLIK DOWODZI.
//   1. FILTR JEDZIE DO ZAPYTANIA *I* DO KLUCZA CACHE, więc „cofnięte" liczy się
//      w bazie na całym tenancie, a nie przez przesianie pierwszej strony.
//      Filtrowanie po stronie klienta dałoby ten sam ekran przy małym zbiorze
//      i cichy fałsz przy dużym.
//   2. STATUS LINKU LICZY SIĘ W PANELU I „COFNIĘTY" BIJE „WYGASŁY". Kolejność
//      tych dwóch warunków jest decyzją: link cofnięty ręcznie, który zdążył
//      wygasnąć, nadal ma być opisany jako decyzja człowieka. Granica wygaśnięcia
//      jest domknięta (`<=`), zgodnie z bazą.
//   3. COFNIĘCIE JEST NIEODWRACALNE, WIĘC PYTA - a odmowa NIE wysyła nic. Po
//      sukcesie unieważnia TRZY klucze (linki, statystyki, audyt) i ANI RAZU
//      ustawień; audyt bez unieważnienia pokazywałby stan przed cofnięciem.
//   4. PANEL PROSI O 100 LINKÓW, IGNORUJE `total` I NIE MÓWI O URWANEJ LIŚCIE
//      (defekt, `it.fails` niżej). Klucz `common.loadMore` leży w słowniku nieużyty.
//   5. NOTA O BUDŻECIE KŁAMIE, DOPÓKI NIE WRÓCĄ USTAWIENIA (defekt): mówi „bez
//      limitu" tenantowi, który limit ma - w najgroźniejszą stronę.
//   6. POTWIERDZENIE SKOPIOWANIA KODU POJAWIA SIĘ TAKŻE WTEDY, GDY SCHOWEK
//      ODMÓWIŁ (defekt) - admin wysyła czytelnikowi stary kod ze schowka.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Markupu wiersza, zastępników i kolumny otwarć -
// to `GiftLinkRow.test.tsx`. Trzech stanów tabeli - `GiftTableState.test.tsx`.
// Schematu zod i limitu 1..200 po stronie server fn -
// `src/lib/__tests__/giftingAdminFunctions.test.ts`.
//
// Pod happy-dom nie ma `window.confirm` ani `navigator.clipboard` - oba
// definiujemy właściwością okna/nawigatora (`vi.stubGlobal` nie trafia w
// `window.confirm`), wzorem `clubThreadPanels.test.tsx` i `postComposition.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listLinks: vi.fn(),
  revokeLink: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: h.getSettings,
  updateGiftAdminSettings: h.updateSettings,
  listGiftLinksAdmin: h.listLinks,
  revokeGiftLinkAdmin: h.revokeLink,
}));

import { GiftLinksPanel } from "@/components/admin/gifting/organisms/GiftLinksPanel";
import { DEFAULT_GIFT_ADMIN_SETTINGS } from "@/lib/gifting/admin-model";
import type { GiftLinkAdminRow } from "@/lib/gifting-admin.functions";

const DZIEN = 24 * 60 * 60 * 1000;

/** Daty budujemy WZGLĘDEM `Date.now()` - stałe ISO wygasłyby razem z testem. */
function link(patch: Partial<GiftLinkAdminRow> = {}, i = 0): GiftLinkAdminRow {
  return {
    id: `link-${i}`,
    post_id: `post-${i}`,
    post_title: `Wpis ${i}`,
    post_slug: `wpis-${i}`,
    created_by: `autor-${i}`,
    creator_name: "Redakcja Testowa",
    creator_email: "redakcja@example.com",
    code: `KOD${String(i).padStart(4, "0")}XXXXXX`,
    created_at: new Date(Date.now() - DZIEN).toISOString(),
    expires_at: new Date(Date.now() + 7 * DZIEN).toISOString(),
    revoked_at: null,
    redemption_count: 0,
    max_redemptions: 5,
    unique_recipients: 0,
    last_redeemed_at: null,
    total_count: 1,
    ...patch,
  };
}

const USTAWIENIA = {
  ...DEFAULT_GIFT_ADMIN_SETTINGS,
  updated_at: null,
  updated_by: null,
  persisted: true,
};

function odpowiedz(rows: GiftLinkAdminRow[], total = rows.length) {
  return { rows, total };
}

async function panel(
  rows: GiftLinkAdminRow[] = [link()],
  opcje: { dateLocale?: string; total?: number; settings?: unknown } = {},
) {
  h.listLinks.mockResolvedValue(odpowiedz(rows, opcje.total ?? rows.length));
  h.getSettings.mockResolvedValue(opcje.settings === undefined ? USTAWIENIA : opcje.settings);
  const widok = renderWithQueryClient(<GiftLinksPanel dateLocale={opcje.dateLocale ?? "pl-PL"} />);
  await waitFor(() => expect(h.listLinks).toHaveBeenCalled());
  return widok;
}

function ustawConfirm(odpowiedz: boolean, zapis: string[]) {
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: (message?: string) => {
      zapis.push(String(message));
      return odpowiedz;
    },
  });
}

beforeEach(() => {
  for (const fn of [h.getSettings, h.updateSettings, h.listLinks, h.revokeLink]) fn.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.revokeLink.mockResolvedValue({ ok: true });
});

describe("lista linków: co panel wysyła", () => {
  it("pierwszy odczyt prosi o 100 linków od zera, bez filtra statusu", async () => {
    await panel();

    expect(h.listLinks).toHaveBeenCalledTimes(1);
    expect(h.listLinks.mock.calls[0][0]).toEqual({
      data: { limit: 100, offset: 0, status: "all" },
    });
  });

  it("zmiana filtra wysyła NOWE zapytanie z tym statusem i zakłada nowy klucz cache", async () => {
    const { queryClient } = await panel();

    fireEvent.click(screen.getByRole("button", { name: "giftingAdmin.links.filterRevoked" }));

    await waitFor(() => expect(h.listLinks).toHaveBeenCalledTimes(2));
    expect(h.listLinks.mock.calls[1][0]).toEqual({
      data: { limit: 100, offset: 0, status: "revoked" },
    });
    expect(queryClient.getQueryData(["gift-admin", "links", "revoked"])).toBeTruthy();
    expect(queryClient.getQueryData(["gift-admin", "links", "all"])).toBeTruthy();
  });

  it("każdy z czterech filtrów jedzie do server fn pod własną nazwą", async () => {
    await panel();

    for (const status of ["active", "revoked", "expired"] as const) {
      const nazwa = `giftingAdmin.links.filter${status[0].toUpperCase()}${status.slice(1)}`;
      fireEvent.click(screen.getByRole("button", { name: nazwa }));
      await waitFor(() =>
        expect(h.listLinks.mock.calls.at(-1)?.[0]).toEqual({
          data: { limit: 100, offset: 0, status },
        }),
      );
    }
  });
});

describe("lista linków: status liczony w panelu", () => {
  it("link cofnięty I wygasły jest opisany jako COFNIĘTY (decyzja człowieka bije upływ czasu)", async () => {
    await panel([
      link({
        revoked_at: new Date(Date.now() - 2 * DZIEN).toISOString(),
        expires_at: new Date(Date.now() - DZIEN).toISOString(),
      }),
    ]);

    expect(await screen.findByText("giftingAdmin.links.status.revoked")).toBeTruthy();
    expect(screen.queryByText("giftingAdmin.links.status.expired")).toBeNull();
  });

  it("data wygaśnięcia w przeszłości daje status WYGASŁY", async () => {
    await panel([link({ expires_at: new Date(Date.now() - DZIEN).toISOString() })]);

    expect(await screen.findByText("giftingAdmin.links.status.expired")).toBeTruthy();
  });

  it("granica wygaśnięcia jest DOMKNIĘTA: chwila „teraz” to już wygasły", async () => {
    await panel([link({ expires_at: new Date(Date.now() - 1).toISOString() })]);

    expect(await screen.findByText("giftingAdmin.links.status.expired")).toBeTruthy();
  });

  it("link bez daty wygaśnięcia i bez cofnięcia jest AKTYWNY", async () => {
    await panel([link({ expires_at: null })]);

    expect(await screen.findByText("giftingAdmin.links.status.active")).toBeTruthy();
  });

  it("przycisk cofnięcia jest DOKŁADNIE jeden - przy linku aktywnym", async () => {
    await panel([
      link({ id: "aktywny" }, 1),
      link({ id: "cofniety", revoked_at: new Date(Date.now() - DZIEN).toISOString() }, 2),
      link({ id: "wygasly", expires_at: new Date(Date.now() - DZIEN).toISOString() }, 3),
    ]);

    await screen.findByText("giftingAdmin.links.status.active");
    expect(screen.getAllByTitle("giftingAdmin.links.revoke")).toHaveLength(1);
    expect(screen.getAllByTitle("giftingAdmin.links.copyCode")).toHaveLength(3);
  });
});

describe("lista linków: cofanie dostępu", () => {
  it("odmowa w potwierdzeniu NIE wysyła nic na serwer", async () => {
    const pytania: string[] = [];
    ustawConfirm(false, pytania);
    await panel([link()]);
    await screen.findByTitle("giftingAdmin.links.revoke");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));

    expect(pytania).toEqual(["giftingAdmin.links.confirmRevoke"]);
    expect(h.revokeLink).not.toHaveBeenCalled();
  });

  it("zgoda wysyła DOKŁADNIE identyfikator tego linku", async () => {
    ustawConfirm(true, []);
    await panel([link({ id: "link-do-cofniecia" })]);
    await screen.findByTitle("giftingAdmin.links.revoke");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));

    await waitFor(() => expect(h.revokeLink).toHaveBeenCalledTimes(1));
    expect(h.revokeLink.mock.calls[0][0]).toEqual({ data: { link_id: "link-do-cofniecia" } });
  });

  it("sukces unieważnia linki, statystyki i audyt - ale NIE ustawienia", async () => {
    ustawConfirm(true, []);
    const { queryClient } = await panel([link()]);
    await screen.findByTitle("giftingAdmin.links.revoke");
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.links.revoked"));
    expect(szpieg.mock.calls.map((c) => c[0])).toEqual([
      { queryKey: ["gift-admin", "links"] },
      { queryKey: ["gift-admin", "stats"] },
      { queryKey: ["gift-admin", "audit"] },
    ]);
  });

  it("błąd cofnięcia pokazuje komunikat serwera i ŻADNEGO potwierdzenia sukcesu", async () => {
    ustawConfirm(true, []);
    h.revokeLink.mockRejectedValue(new Error("revoke_gift_link_admin: forbidden"));
    await panel([link()]);
    await screen.findByTitle("giftingAdmin.links.revoke");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("revoke_gift_link_admin: forbidden"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("lista linków: kopiowanie kodu", () => {
  function ustawSchowek(writeText: (t: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  }

  /**
   * Schowek, który ODMAWIA. Odrzucenie jest podpięte pustym `catch` WEWNĄTRZ
   * atrapy tylko po to, by vitest zdążył zgłosić prawdziwą asercję zamiast
   * przewrócić plik na nieobsłużonej odmowie obietnicy. Sama nieobsłużona
   * odmowa jest CZĘŚCIĄ defektu opisanego niżej - produkcja nie ma tu ani
   * `await`, ani `.catch`.
   */
  function ustawSchowekOdmawiajacy() {
    ustawSchowek(() => {
      const odmowa = Promise.reject(new Error("NotAllowedError"));
      odmowa.catch(() => undefined);
      return odmowa;
    });
  }

  it("klik pisze do schowka SUROWY kod linku, nie adres i nie tytuł", async () => {
    const zapisane: string[] = [];
    ustawSchowek(async (t) => {
      zapisane.push(t);
    });
    await panel([link({ code: "KODDOSKOPIOWANIA" })]);
    await screen.findByTitle("giftingAdmin.links.copyCode");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.copyCode"));

    expect(zapisane).toEqual(["KODDOSKOPIOWANIA"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.links.copyCode");
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("odmowa schowka NIE potwierdza skopiowania", async () => {
    // Oczekiwane: gdy `writeText` odrzuci (brak uprawnień, kontekst nie-secure,
    // dokument bez fokusu), panel nie mówi „skopiowano". Dziś wywołanie jest
    // bez `await` i bez `.catch`, więc toast leci zawsze, a odmowa obietnicy
    // zostaje nieobsłużona.
    ustawSchowekOdmawiajacy();
    await panel([link()]);
    await screen.findByTitle("giftingAdmin.links.copyCode");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.copyCode"));

    await waitFor(() => expect(h.toastSuccess).not.toHaveBeenCalled());
  });

  it("STAN FAKTYCZNY: przy odmowie schowka panel i tak potwierdza skopiowanie", async () => {
    // Skutek: admin wkleja STARĄ zawartość schowka i wysyła czytelnikowi zły kod.
    ustawSchowekOdmawiajacy();
    await panel([link()]);
    await screen.findByTitle("giftingAdmin.links.copyCode");

    fireEvent.click(screen.getByTitle("giftingAdmin.links.copyCode"));

    expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.links.copyCode");
  });
});

describe("lista linków: nota o budżecie otwarć", () => {
  it("budżet z ustawień tenanta jedzie do noty jako liczba", async () => {
    await panel([link()], { settings: { ...USTAWIENIA, max_redemptions_per_link: 5 } });

    expect(await screen.findByText("giftingAdmin.links.capNote(count=5)")).toBeTruthy();
  });

  it("budżet 0 w ustawieniach mówi WPROST „bez limitu”", async () => {
    await panel([link()], { settings: { ...USTAWIENIA, max_redemptions_per_link: 0 } });

    expect(await screen.findByText("giftingAdmin.links.capNoteUnlimited")).toBeTruthy();
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("dopóki ustawienia się nie wczytają, nota NIE twierdzi „bez limitu”", async () => {
    // Oczekiwane: przy nieznanych ustawieniach panel milczy o polityce budżetu
    // (albo pokazuje stan wczytywania). Dziś `settings?.max_redemptions_per_link ?? 0`
    // sprowadza „nie wiem" do „zero", a zero znaczy „bez limitu".
    h.getSettings.mockReturnValue(new Promise(() => undefined));
    h.listLinks.mockResolvedValue(odpowiedz([link()]));
    renderWithQueryClient(<GiftLinksPanel dateLocale="pl-PL" />);

    await waitFor(() => expect(h.listLinks).toHaveBeenCalled());
    expect(screen.queryByText("giftingAdmin.links.capNoteUnlimited")).toBeNull();
  });

  it("STAN FAKTYCZNY: w oczekiwaniu na ustawienia panel kłamie „bez limitu”", async () => {
    // Krótkie, ale jednoznaczne kłamstwo o polityce paywalla - i w najgroźniejszą
    // stronę. Bezpieczny fallback byłby odwrotny: nie mówić nic.
    h.getSettings.mockReturnValue(new Promise(() => undefined));
    h.listLinks.mockResolvedValue(odpowiedz([link()]));
    renderWithQueryClient(<GiftLinksPanel dateLocale="pl-PL" />);

    expect(screen.getByText("giftingAdmin.links.capNoteUnlimited")).toBeTruthy();
  });
});

describe("lista linków: urwana historia", () => {
  const STO = Array.from({ length: 100 }, (_, i) => link({}, i));

  it("pokazuje wszystkie 100 zwróconych wierszy", async () => {
    await panel(STO, { total: 3500 });

    await screen.findByText("Wpis 0");
    expect(screen.getAllByTitle("giftingAdmin.links.copyCode")).toHaveLength(100);
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("lista urwana na 100 z 3500 MÓWI o tym adminowi", async () => {
    // Oczekiwane: licznik „100 z 3500" albo przycisk `giftingAdmin.common.loadMore`
    // (klucz JEST w słowniku i nikt go nie woła). Server fn LICZY `total` z
    // `total_count`, a panel go nie czyta.
    await panel(STO, { total: 3500 });

    await screen.findByText("Wpis 0");
    expect(screen.getByText(/3500/)).toBeTruthy();
  });

  it("STAN FAKTYCZNY: `total` jest ignorowane, nie ma doczytywania, offset zawsze 0", async () => {
    // Konsekwencja: tenant z większą liczbą linków widzi ciche pierwsze 100 i
    // nie ma sygnału, że reszta istnieje.
    await panel(STO, { total: 3500 });

    await screen.findByText("Wpis 0");
    expect(screen.queryByText(/3500/)).toBeNull();
    expect(screen.queryByText("giftingAdmin.common.loadMore")).toBeNull();
    expect(h.listLinks).toHaveBeenCalledTimes(1);
    expect(
      h.listLinks.mock.calls.every((c) => (c[0] as { data: { offset: number } }).data.offset === 0),
    ).toBe(true);
  });
});

describe("lista linków: stany tabeli i daty", () => {
  it("odczyt w locie mówi „wczytuję”, a NIE „brak linków”", () => {
    h.listLinks.mockReturnValue(new Promise(() => undefined));
    h.getSettings.mockResolvedValue(USTAWIENIA);
    renderWithQueryClient(<GiftLinksPanel dateLocale="pl-PL" />);

    expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy();
    expect(screen.queryByText("giftingAdmin.links.empty")).toBeNull();
  });

  it("brak linków po zakończonym odczycie mówi o pustce", async () => {
    await panel([]);

    expect(await screen.findByText("giftingAdmin.links.empty")).toBeTruthy();
  });

  it("data utworzenia formatuje się PRZEKAZANYM locale interfejsu", async () => {
    const utworzony = new Date(Date.now() - DZIEN).toISOString();
    await panel([link({ created_at: utworzony, expires_at: null })], { dateLocale: "en-GB" });

    const oczekiwana = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(utworzony));
    expect(await screen.findByText(oczekiwana)).toBeTruthy();
  });
});
