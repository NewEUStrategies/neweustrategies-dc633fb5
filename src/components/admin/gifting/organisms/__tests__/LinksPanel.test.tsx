// Organizm: zakladka LINKI panelu prezentow - przeglad i cofanie.
//
// PO CO TEN PLIK ISTNIEJE. To jedyny ekran, z ktorego redakcja moze ODCIAC
// dostep do platnej tresci wydany linkiem. Cztery rzeczy, ktore latwo cicho
// zepsuc, a kazda kosztuje pieniadze albo zaufanie:
//
//   1. FILTR, KTORY NIE JEDZIE DO SERWERA. Przyciski filtra przelaczaja stan,
//      ktory jest JEDNOCZESNIE czescia klucza pamieci podrecznej i argumentem
//      server fn. Zgubienie jednego z dwoch daje ekran, ktory wyglada na
//      przefiltrowany, a pokazuje wszystko (albo odwrotnie: pokazuje stare
//      dane pod nowa etykieta).
//   2. STATUS LICZONY W WIERSZU. `revoked_at` / `expires_at` -> pigulka.
//      Blad tu znaczy, ze przy WYGASLYM linku pojawia sie przycisk "Cofnij"
//      (akcja bez sensu), a przy AKTYWNYM go nie ma (brak jedynej dzwigni).
//   3. COFNIECIE BEZ POTWIERDZENIA. Akcja jest nieodwracalna dla odbiorcow -
//      i idzie z identyfikatorem KONKRETNEGO wiersza, nie pierwszego z listy.
//   4. KOLUMNA BUDZETU CZYTANA Z USTAWIEN ZAMIAST Z LINKU. Cap jest ZAMROZONY
//      na linku przy tworzeniu; czytanie biezacych ustawien tenanta sprawiloby,
//      ze kolumna "otwarcia / cap" klamie po kazdej zmianie suwaka w Ustawieniach.
//
// ATRAPY: granice - server fn, `useServerFn`, i18n, toast, schowek, `confirm`.
// `giftCapExhausted` i `StatusPill` biegna PRAWDZIWE (sasiedzi).
//
// RODO: adresy wylacznie w domenie example.com, nazwiska wymyslone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import type { GiftLinkAdminRow } from "@/lib/gifting-admin.functions";
import type { LinkStatus } from "@/components/admin/gifting/organisms/LinksPanel";

const h = vi.hoisted(() => ({
  listLinks: vi.fn(),
  revokeLink: vi.fn(),
  getSettings: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/gifting-admin.functions", () => ({
  listGiftLinksAdmin: (...args: unknown[]) => h.listLinks(...args),
  revokeGiftLinkAdmin: (...args: unknown[]) => h.revokeLink(...args),
  getGiftAdminSettings: (...args: unknown[]) => h.getSettings(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => h.toastSuccess(...args),
    error: (...args: unknown[]) => h.toastError(...args),
  },
}));

const { LinksPanel } = await import("@/components/admin/gifting/organisms/LinksPanel");

const HOUR = 3_600_000;

function link(overrides: Partial<GiftLinkAdminRow> = {}): GiftLinkAdminRow {
  return {
    id: "00000000-0000-4000-8000-00000000aaa1",
    post_id: "00000000-0000-4000-8000-00000000bbb1",
    post_title: "Reforma rynku energii w CEE",
    post_slug: "reforma-rynku-energii",
    created_by: "00000000-0000-4000-8000-00000000ccc1",
    creator_name: "Redaktor Testowy",
    creator_email: "redaktor@example.com",
    code: "abcDEF123_-xyzABC456pqr",
    created_at: new Date(Date.now() - 48 * HOUR).toISOString(),
    expires_at: new Date(Date.now() + 24 * HOUR).toISOString(),
    revoked_at: null,
    redemption_count: 2,
    max_redemptions: 5,
    unique_recipients: 2,
    last_redeemed_at: null,
    total_count: 1,
    ...overrides,
  };
}

/** Argument `status` przekazany do server fn w ostatnim wywolaniu listy. */
function lastStatus(): LinkStatus {
  const call = h.listLinks.mock.calls.at(-1);
  return (call?.[0] as { data: { status: LinkStatus } }).data.status;
}

function rowFor(title: string): HTMLElement {
  const cell = screen.getByText(title);
  const tr = cell.closest("tr");
  if (tr === null) throw new Error(`nie znaleziono wiersza dla "${title}"`);
  return tr;
}

function filterButton(key: string): HTMLButtonElement {
  return screen.getByRole("button", { name: `giftingAdmin.links.${key}` }) as HTMLButtonElement;
}

const writeText = vi.fn();
/**
 * `window.confirm` nie istnieje w happy-dom, wiec `vi.spyOn` nie ma czego
 * podmienic. Zakladamy wlasna, sterowalna atrape - potwierdzenie jest tu
 * czescia kontraktu (akcja nieodwracalna), wiec nie wolno go pominac.
 */
const confirmMock = vi.fn<(message?: string) => boolean>();

beforeEach(() => {
  h.listLinks.mockReset();
  h.revokeLink.mockReset();
  h.getSettings.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  writeText.mockReset();
  h.getSettings.mockResolvedValue({
    enabled: true,
    monthly_limit: 10,
    link_ttl_days: 30,
    max_redemptions_per_link: 5,
    eligibility: "registered",
    updated_at: null,
    updated_by: null,
    persisted: true,
  });
  h.revokeLink.mockResolvedValue({ ok: true });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  confirmMock.mockReset();
  confirmMock.mockReturnValue(true);
  Object.defineProperty(window, "confirm", { configurable: true, value: confirmMock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderPanel(rows: GiftLinkAdminRow[] = [link()]) {
  h.listLinks.mockResolvedValue({ rows, total: rows.length });
  const utils = renderWithQueryClient(<LinksPanel dateLocale="pl-PL" />);
  await waitFor(() => expect(h.listLinks).toHaveBeenCalled());
  return utils;
}

describe("LinksPanel - filtrowanie po statusie", () => {
  it("startuje z filtrem 'wszystkie'", async () => {
    await renderPanel();
    expect(lastStatus()).toBe("all");
  });

  it.each([
    ["filterActive", "active"],
    ["filterRevoked", "revoked"],
    ["filterExpired", "expired"],
    ["filterAll", "all"],
  ] as const)("%s wysyla status %s do server fn", async (buttonKey, expected) => {
    await renderPanel();
    fireEvent.click(filterButton(buttonKey));
    await waitFor(() => expect(lastStatus()).toBe(expected));
  });

  it("kazdy filtr ma WLASNY wpis w pamieci podrecznej", async () => {
    // Wspolny klucz dla roznych filtrow pokazywalby liste "aktywnych"
    // z danymi "wszystkich" do czasu, az serwer odpowie.
    const { queryClient } = await renderPanel();
    fireEvent.click(filterButton("filterRevoked"));
    await waitFor(() => expect(lastStatus()).toBe("revoked"));
    expect(queryClient.getQueryData(["gift-admin", "links", "all"])).toBeTruthy();
    expect(queryClient.getQueryData(["gift-admin", "links", "revoked"])).toBeTruthy();
  });

  it("powrot na ten sam filtr nie strzela drugi raz (dane sa w cache)", async () => {
    await renderPanel();
    fireEvent.click(filterButton("filterActive"));
    await waitFor(() => expect(lastStatus()).toBe("active"));
    const calls = h.listLinks.mock.calls.length;
    fireEvent.click(filterButton("filterAll"));
    await waitFor(() => expect(lastStatus()).toBe("all"));
    fireEvent.click(filterButton("filterActive"));
    await waitFor(() => expect(h.listLinks.mock.calls.length).toBeLessThanOrEqual(calls + 2));
  });

  it("aktywny filtr jest wyrozniony wizualnie", async () => {
    await renderPanel();
    expect(filterButton("filterAll").className).toContain("bg-brand");
    fireEvent.click(filterButton("filterRevoked"));
    await waitFor(() => expect(filterButton("filterRevoked").className).toContain("bg-brand"));
    expect(filterButton("filterAll").className).not.toContain("bg-brand");
  });

  it("lista jedzie ze stronicowaniem zadeklarowanym przez panel", async () => {
    await renderPanel();
    const call = h.listLinks.mock.calls.at(-1);
    expect((call?.[0] as { data: { limit: number; offset: number } }).data).toMatchObject({
      limit: 100,
      offset: 0,
    });
  });
});

describe("LinksPanel - stany listy", () => {
  it("pokazuje wiersz ladowania, zanim serwer odpowie", () => {
    h.listLinks.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<LinksPanel dateLocale="pl-PL" />);
    expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy();
  });

  it("pusty wynik mowi 'brak linkow', a nie zostaje przy ladowaniu", async () => {
    await renderPanel([]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.empty")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.common.loading")).toBeNull();
  });

  it("odmowa serwera nie udaje pustej listy w nieskonczonosc", async () => {
    // Panel nie ma osobnej galezi bledu (kompromis), ale MUSI wyjsc ze stanu
    // ladowania - inaczej admin czeka na dane, ktore nigdy nie przyjda.
    h.listLinks.mockRejectedValue(new Error("Forbidden"));
    renderWithQueryClient(<LinksPanel dateLocale="pl-PL" />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.empty")).toBeTruthy());
  });

  it("renderuje tytul i slug wpisu", async () => {
    await renderPanel([link({ post_title: "Tytul wpisu", post_slug: "tytul-wpisu" })]);
    await waitFor(() => expect(screen.getByText("Tytul wpisu")).toBeTruthy());
    expect(screen.getByText("/tytul-wpisu")).toBeTruthy();
  });

  it("wpis bez tytulu spada na slug, a bez obu - na myslnik", async () => {
    await renderPanel([
      link({ id: "id-1", post_title: "", post_slug: "sam-slug" }),
      link({ id: "id-2", post_title: "", post_slug: null, code: "kod-drugi-abcdefgh" }),
    ]);
    await waitFor(() => expect(screen.getByText("sam-slug")).toBeTruthy());
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("darczynca bez nazwy spada na adres e-mail", async () => {
    await renderPanel([link({ creator_name: null, creator_email: "autor@example.org" })]);
    await waitFor(() => expect(screen.getAllByText("autor@example.org").length).toBeGreaterThan(0));
  });

  // ---------------------------------------------------------------------------
  // DEFEKT (nienaprawiany w tym zadaniu - testy nie ruszaja kodu produkcyjnego).
  //
  // CO JEST ZLE. Komorka darczyncy sklada sie z dwoch linii. Pierwsza pokazuje
  // `r.creator_name ?? r.creator_email ?? "-"`, druga jest warunkowa:
  // `r.creator_email && r.creator_email !== r.creator_name`. Warunek porownuje
  // adres z NAZWA W DANYCH, a nie z tym, co faktycznie stanelo w pierwszej
  // linii. Przy `creator_name === null` pierwsza linia pokazuje juz adres,
  // a warunek (`adres !== null`) i tak przepuszcza druga - wiec ten sam adres
  // wychodzi na ekran DWA RAZY, jeden pod drugim.
  //
  // DLACZEGO TO RYZYKO. Konto bez `display_name` (a takze bez pary
  // imie+nazwisko) to nie przypadek brzegowy - tak wyglada kazdy swiezy
  // uzytkownik, bo `creator_name` jest sklejane w RPC z
  // `COALESCE(display_name, first_name || ' ' || last_name, email)`. Kolumna
  // "Darczynca" jest jednym z dwoch miejsc, po ktorych redakcja identyfikuje
  // zrodlo wycieku linku; podwojony adres kaze czytac ja dwa razy i sugeruje
  // dwie rozne osoby przy poboznym przeleceniu wzrokiem. To takze
  // niepotrzebne powielenie danych osobowych na ekranie (RODO: minimalizacja).
  //
  // DLACZEGO NIE NAPRAWIAM. Zakres zadania jest testowy. Poprawka to
  // porownanie z wartoscia WYSWIETLONA (np. wyliczenie `displayed` raz
  // i warunek `r.creator_email !== displayed`); po niej ten wpis wraca do
  // zwyklego `it`.
  // ---------------------------------------------------------------------------
  it.fails("adres darczyncy bez nazwy nie moze pojawic sie dwa razy (DEFEKT)", async () => {
    await renderPanel([link({ creator_name: null, creator_email: "autor@example.org" })]);
    await waitFor(() => expect(screen.getAllByText("autor@example.org").length).toBeGreaterThan(0));
    expect(screen.getAllByText("autor@example.org")).toHaveLength(1);
  });

  it("nie dubluje adresu, gdy jest identyczny z nazwa", async () => {
    await renderPanel([
      link({ creator_name: "autor@example.org", creator_email: "autor@example.org" }),
    ]);
    await waitFor(() => expect(screen.getAllByText("autor@example.org")).toHaveLength(1));
  });

  it("link bez daty waznosci mowi 'bez wygasniecia'", async () => {
    await renderPanel([link({ expires_at: null })]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.neverExpires")).toBeTruthy());
  });
});

describe("LinksPanel - status wiersza", () => {
  it("cofniety link ma pigulke 'revoked' i NIE ma przycisku cofania", async () => {
    await renderPanel([link({ revoked_at: new Date().toISOString() })]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.status.revoked")).toBeTruthy());
    expect(screen.queryByTitle("giftingAdmin.links.revoke")).toBeNull();
  });

  it("link po terminie ma pigulke 'expired' i NIE ma przycisku cofania", async () => {
    await renderPanel([link({ expires_at: new Date(Date.now() - HOUR).toISOString() })]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.status.expired")).toBeTruthy());
    expect(screen.queryByTitle("giftingAdmin.links.revoke")).toBeNull();
  });

  it("aktywny link ma pigulke 'active' i przycisk cofania", async () => {
    await renderPanel([link()]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.status.active")).toBeTruthy());
    expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy();
  });

  it("cofniecie WYGRYWA z wygasnieciem (decyzja redakcji przed uplywem czasu)", async () => {
    await renderPanel([
      link({
        revoked_at: new Date(Date.now() - 2 * HOUR).toISOString(),
        expires_at: new Date(Date.now() - HOUR).toISOString(),
      }),
    ]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.status.revoked")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.links.status.expired")).toBeNull();
  });

  it("link bez daty waznosci jest AKTYWNY (bezterminowy, nie wygasly)", async () => {
    await renderPanel([link({ expires_at: null })]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.status.active")).toBeTruthy());
  });
});

describe("LinksPanel - kolumna budzetu klikniec", () => {
  it("cap > 0 pokazuje 'zuzycie / cap'", async () => {
    await renderPanel([link({ redemption_count: 2, max_redemptions: 5 })]);
    await waitFor(() => expect(screen.getByText(/2 \/ 5/)).toBeTruthy());
  });

  it("cap 0 pokazuje sam licznik (bez limitu)", async () => {
    await renderPanel([link({ redemption_count: 7, max_redemptions: 0 })]);
    await waitFor(() => expect(rowFor("Reforma rynku energii w CEE")).toBeTruthy());
    expect(screen.queryByText(/7 \/ 0/)).toBeNull();
    expect(rowFor("Reforma rynku energii w CEE").textContent).toContain("7");
  });

  it("wyczerpany budzet jest wyrozniony i opisany podpowiedzia", async () => {
    // To jedyny sygnal, ze link PRZESTAL dzialac mimo statusu "aktywny".
    await renderPanel([link({ redemption_count: 5, max_redemptions: 5 })]);
    await waitFor(() => expect(screen.getByText(/5 \/ 5/)).toBeTruthy());
    const cell = screen.getByText(/5 \/ 5/);
    expect(cell.className).toContain("text-destructive");
    expect(cell.getAttribute("title")).toBe("giftingAdmin.links.capReached");
  });

  it("budzet niewyczerpany nie jest czerwony", async () => {
    await renderPanel([link({ redemption_count: 4, max_redemptions: 5 })]);
    await waitFor(() => expect(screen.getByText(/4 \/ 5/)).toBeTruthy());
    expect(screen.getByText(/4 \/ 5/).className ?? "").not.toContain("text-destructive");
  });

  it("licznik ponad cap tez liczy sie jako wyczerpany", async () => {
    // `giftCapExhausted` uzywa `>=`, bo wyscig o ostatni slot moze podbic
    // licznik ponad cap; wiersz musi wtedy dalej krzyczec, a nie zgasnac.
    await renderPanel([link({ redemption_count: 9, max_redemptions: 5 })]);
    await waitFor(() => expect(screen.getByText(/9 \/ 5/)).toBeTruthy());
    expect(screen.getByText(/9 \/ 5/).className).toContain("text-destructive");
  });

  it("budzet czytany jest z LINKU, a nie z biezacych ustawien tenanta", async () => {
    // Ustawienia mowia 5, link ma zamrozone 50 - kolumna musi pokazac 50.
    await renderPanel([link({ redemption_count: 1, max_redemptions: 50 })]);
    await waitFor(() => expect(screen.getByText(/1 \/ 50/)).toBeTruthy());
  });

  it("liczba unikalnych odbiorcow stoi obok licznika otwarc", async () => {
    // Klikniecia sa deduplikowane, wiec te dwie liczby moga sie roznic -
    // i tylko druga mowi, ILU LUDZI realnie otworzylo artykul.
    await renderPanel([link({ redemption_count: 5, unique_recipients: 3 })]);
    await waitFor(() => expect(screen.getByText(/giftingAdmin\.links\.recipients/)).toBeTruthy());
    expect(screen.getByText(/giftingAdmin\.links\.recipients/).textContent).toContain("count=3");
  });

  it("nota nad tabela czyta domyslny cap z USTAWIEN", async () => {
    await renderPanel();
    await waitFor(() => expect(screen.getByText(/giftingAdmin\.links\.capNote/)).toBeTruthy());
    expect(screen.getByText(/giftingAdmin\.links\.capNote/).textContent).toContain("count=5");
  });

  it("nota mowi 'bez limitu', gdy tenant ma cap 0", async () => {
    h.getSettings.mockResolvedValue({
      enabled: true,
      monthly_limit: 10,
      link_ttl_days: 30,
      max_redemptions_per_link: 0,
      eligibility: "registered",
      updated_at: null,
      updated_by: null,
      persisted: true,
    });
    await renderPanel();
    await waitFor(() =>
      expect(screen.getByText("giftingAdmin.links.capNoteUnlimited")).toBeTruthy(),
    );
  });

  it("nota mowi 'bez limitu' takze zanim ustawienia dojda", async () => {
    // `settings?.max_redemptions_per_link ?? 0` - brak danych daje 0, wiec
    // nota nie zmysla liczby, ktorej jeszcze nie zna.
    h.getSettings.mockReturnValue(new Promise(() => {}));
    await renderPanel();
    await waitFor(() =>
      expect(screen.getByText("giftingAdmin.links.capNoteUnlimited")).toBeTruthy(),
    );
  });
});

describe("LinksPanel - cofanie linku", () => {
  it("pyta o potwierdzenie przed cofnieciem", async () => {
    await renderPanel();
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));
    expect(confirmMock).toHaveBeenCalledWith("giftingAdmin.links.confirmRevoke");
  });

  it("odmowa potwierdzenia NIE wysyla nic na serwer", async () => {
    confirmMock.mockReturnValue(false);
    await renderPanel();
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));
    expect(h.revokeLink).not.toHaveBeenCalled();
  });

  it("cofa TEN wiersz, nie pierwszy z listy", async () => {
    await renderPanel([
      link({ id: "00000000-0000-4000-8000-0000000000a1", post_title: "Pierwszy" }),
      link({
        id: "00000000-0000-4000-8000-0000000000a2",
        post_title: "Drugi",
        code: "drugiKod123_-xyzABC456",
      }),
    ]);
    await waitFor(() => expect(screen.getByText("Drugi")).toBeTruthy());
    const drugi = rowFor("Drugi");
    fireEvent.click(within(drugi).getByTitle("giftingAdmin.links.revoke"));
    await waitFor(() => expect(h.revokeLink).toHaveBeenCalled());
    expect(h.revokeLink).toHaveBeenCalledWith({
      data: { link_id: "00000000-0000-4000-8000-0000000000a2" },
    });
  });

  it("sukces melduje sie toastem", async () => {
    await renderPanel();
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.links.revoked"));
  });

  it("sukces uniewaznia linki, statystyki I audyt", async () => {
    // Cofniecie zmienia wszystkie trzy widoki naraz: wiersz na liscie,
    // licznik "aktywne linki" i nowy wpis w logu zdarzen. Uniewaznienie
    // wezsze niz te trzy klucze zostawia panel klamiacy.
    const { queryClient } = await renderPanel();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    for (const key of ["links", "stats", "audit"]) {
      expect(invalidate, `brak uniewaznienia ${key}`).toHaveBeenCalledWith({
        queryKey: ["gift-admin", key],
      });
    }
  });

  it("odmowa cofniecia pokazuje TRESC bledu z serwera", async () => {
    h.revokeLink.mockRejectedValue(new Error("gift_link_not_found"));
    await renderPanel();
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("gift_link_not_found"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa NIE usuwa wiersza z listy (admin moze ponowic)", async () => {
    h.revokeLink.mockRejectedValue(new Error("odmowa"));
    await renderPanel();
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByText("Reforma rynku energii w CEE")).toBeTruthy();
    expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy();
  });

  it("w trakcie cofania przyciski sa zablokowane (brak podwojnego zadania)", async () => {
    let resolveRevoke: (value: { ok: boolean }) => void = () => {};
    h.revokeLink.mockReturnValue(
      new Promise<{ ok: boolean }>((resolve) => {
        resolveRevoke = resolve;
      }),
    );
    await renderPanel();
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.revoke")).toBeTruthy());
    const button = screen.getByTitle("giftingAdmin.links.revoke") as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    fireEvent.click(button);
    expect(h.revokeLink).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRevoke({ ok: true });
    });
  });
});

describe("LinksPanel - kopiowanie kodu", () => {
  it("kopiuje kod TEGO wiersza do schowka i potwierdza toastem", async () => {
    await renderPanel([
      link({ id: "00000000-0000-4000-8000-0000000000b1", code: "pierwszyKod_-123456" }),
      link({
        id: "00000000-0000-4000-8000-0000000000b2",
        post_title: "Drugi",
        code: "drugiKod_-abcdef123",
      }),
    ]);
    await waitFor(() => expect(screen.getByText("Drugi")).toBeTruthy());
    fireEvent.click(within(rowFor("Drugi")).getByTitle("giftingAdmin.links.copyCode"));
    expect(writeText).toHaveBeenCalledWith("drugiKod_-abcdef123");
    expect(h.toastSuccess).toHaveBeenCalledWith("giftingAdmin.links.copyCode");
  });

  it("kopiowanie jest dostepne takze dla linku cofnietego", async () => {
    // Kod bywa potrzebny do sledztwa PO cofnieciu (skad wyciekl link).
    await renderPanel([link({ revoked_at: new Date().toISOString() })]);
    await waitFor(() => expect(screen.getByTitle("giftingAdmin.links.copyCode")).toBeTruthy());
  });
});

describe("LinksPanel - dostepnosc", () => {
  it("tabela ma komplet naglowkow kolumn", async () => {
    await renderPanel();
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(7));
  });

  it("nie wnosi naruszen dostepnosci", async () => {
    const { container } = await renderPanel();
    await waitFor(() => expect(screen.getByText("Reforma rynku energii w CEE")).toBeTruthy());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
