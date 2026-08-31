// Organizm: zakladka AUDYT panelu prezentow - log zdarzen.
//
// PO CO TEN PLIK ISTNIEJE. Audyt jest jedynym miejscem, w ktorym redakcja
// odtwarza HISTORIE: kto wygenerowal link, ile razy go otwarto i kto odbil sie
// od wyczerpanego budzetu. Trzy rzeczy, ktore latwo cicho zepsuc:
//
//   1. FILTR, KTORY NIE JEDZIE DO SERWERA. Stan filtra jest jednoczesnie
//      czescia klucza pamieci podrecznej i argumentem server fn. Zgubienie
//      jednego z dwoch daje log wygladajacy na przefiltrowany, ktory pokazuje
//      wszystko - albo stare dane pod nowa etykieta.
//   2. NIEZNANY TYP ZDARZENIA WYWRACAJACY CALY LOG. `event_type` jest CELOWO
//      otwartym stringiem (`GiftEventAdminRow`), zeby audyt pokazywal takze
//      zdarzenia, ktorych ten build nie zna. Jedyna oslona jest `isKnownEventType`
//      w `EventPill`. Gdyby przestala dzialac, JEDEN nieznany wiersz zabralby
//      redakcji CALA historie - dokladnie w chwili, w ktorej wdrozono cos
//      nowego po stronie bazy. Sam straznik ma test jawny w
//      `src/components/admin/gifting/__tests__/model.test.ts`.
//   3. ANONIMOWY ODBIORCA POKAZANY JAKO MYSLNIK. Otwarcie linku przez goscia
//      NIE MA aktora - i to jest informacja ("anonimowy odbiorca"), a nie brak
//      danych. Myslnik w tym miejscu sugerowalby awarie zapisu audytu.
//
// UWAGA O ZAKRESIE FILTROW. Panel oferuje piec przyciskow (wszystkie, created,
// redeemed, revoked, exhausted) przy szesciu wartosciach przyjmowanych przez
// server fn - brakuje `expired`. To zawezenie jest zgodne z baza: zaden trigger
// ani zadne RPC nie zapisuje dzis zdarzenia `expired` (CHECK je dopuszcza,
// nic go nie emituje), wiec filtr zawsze zwracalby pustke. Test nizej
// utrwala te liczbe, zeby zmiana byla DECYZJA, a nie przeoczeniem.
//
// ATRAPY: granice - server fn, `useServerFn`, i18n. `EventPill` i `model`
// biegna PRAWDZIWE (sasiedzi).
//
// RODO: adresy wylacznie example.com / example.org, nazwiska wymyslone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { EVENT_PILL_CLS } from "@/components/admin/gifting/model";
import type { GiftEventAdminRow } from "@/lib/gifting-admin.functions";
import type { EventFilter } from "@/components/admin/gifting/organisms/AuditPanel";

const h = vi.hoisted(() => ({ listEvents: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/gifting-admin.functions", () => ({
  listGiftEventsAdmin: (...args: unknown[]) => h.listEvents(...args),
}));

const { AuditPanel } = await import("@/components/admin/gifting/organisms/AuditPanel");

function event(overrides: Partial<GiftEventAdminRow> = {}): GiftEventAdminRow {
  return {
    id: "00000000-0000-4000-8000-00000000ee01",
    event_type: "created",
    post_id: "00000000-0000-4000-8000-00000000bbb1",
    post_title: "Reforma rynku energii w CEE",
    actor_id: "00000000-0000-4000-8000-00000000ccc1",
    actor_name: "Redaktor Testowy",
    actor_email: "redaktor@example.com",
    code: "abcDEF123_-xyzABC456pqr",
    created_at: "2026-08-01T10:30:00.000Z",
    total_count: 1,
    ...overrides,
  };
}

function lastFilter(): EventFilter {
  const call = h.listEvents.mock.calls.at(-1);
  return (call?.[0] as { data: { event_type: EventFilter } }).data.event_type;
}

function filterButton(key: string): HTMLButtonElement {
  return screen.getByRole("button", { name: `giftingAdmin.audit.${key}` }) as HTMLButtonElement;
}

beforeEach(() => {
  h.listEvents.mockReset();
});

async function renderPanel(rows: GiftEventAdminRow[] = [event()]) {
  h.listEvents.mockResolvedValue({ rows, total: rows.length });
  const utils = renderWithQueryClient(<AuditPanel dateLocale="pl-PL" />);
  await waitFor(() => expect(h.listEvents).toHaveBeenCalled());
  return utils;
}

describe("AuditPanel - filtrowanie po typie zdarzenia", () => {
  it("startuje z filtrem 'wszystkie'", async () => {
    await renderPanel();
    expect(lastFilter()).toBe("all");
  });

  it.each([
    ["filterCreated", "created"],
    ["filterRedeemed", "redeemed"],
    ["filterRevoked", "revoked"],
    ["filterExhausted", "exhausted"],
    ["filterAll", "all"],
  ] as const)("%s wysyla event_type=%s do server fn", async (buttonKey, expected) => {
    await renderPanel();
    fireEvent.click(filterButton(buttonKey));
    await waitFor(() => expect(lastFilter()).toBe(expected));
  });

  it("kazdy filtr ma WLASNY wpis w pamieci podrecznej", async () => {
    const { queryClient } = await renderPanel();
    fireEvent.click(filterButton("filterExhausted"));
    await waitFor(() => expect(lastFilter()).toBe("exhausted"));
    expect(queryClient.getQueryData(["gift-admin", "audit", "all"])).toBeTruthy();
    expect(queryClient.getQueryData(["gift-admin", "audit", "exhausted"])).toBeTruthy();
  });

  it("aktywny filtr jest wyrozniony wizualnie", async () => {
    await renderPanel();
    expect(filterButton("filterAll").className).toContain("bg-brand");
    fireEvent.click(filterButton("filterCreated"));
    await waitFor(() => expect(filterButton("filterCreated").className).toContain("bg-brand"));
    expect(filterButton("filterAll").className).not.toContain("bg-brand");
  });

  it("panel oferuje DOKLADNIE piec filtrow (zawezenie wzgledem server fn)", async () => {
    // Utrwalone swiadomie: server fn przyjmuje szesc wartosci, bo CHECK bazy
    // zna takze `expired` - ale nic tego zdarzenia nie emituje, wiec filtr
    // zawsze zwracalby pustke. Dolozenie szostego przycisku ma byc decyzja.
    await renderPanel();
    expect(screen.queryByRole("button", { name: /filterExpired/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("lista jedzie ze stronicowaniem zadeklarowanym przez panel", async () => {
    await renderPanel();
    const call = h.listEvents.mock.calls.at(-1);
    expect((call?.[0] as { data: { limit: number; offset: number } }).data).toMatchObject({
      limit: 200,
      offset: 0,
    });
  });
});

describe("AuditPanel - stany listy", () => {
  it("pokazuje wiersz ladowania, zanim serwer odpowie", () => {
    h.listEvents.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<AuditPanel dateLocale="pl-PL" />);
    expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy();
  });

  it("pusty log mowi 'brak zdarzen'", async () => {
    await renderPanel([]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.audit.empty")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.common.loading")).toBeNull();
  });

  it("odmowa serwera nie zostawia wiecznego ladowania", async () => {
    h.listEvents.mockRejectedValue(new Error("forbidden"));
    renderWithQueryClient(<AuditPanel dateLocale="pl-PL" />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.audit.empty")).toBeTruthy());
  });

  it("tabela ma komplet naglowkow kolumn", async () => {
    await renderPanel();
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(5));
  });
});

describe("AuditPanel - wiersz zdarzenia", () => {
  it("pokazuje tytul wpisu, a przy jego braku myslnik", async () => {
    await renderPanel([
      event({ id: "e-1", post_title: "Tytul wpisu" }),
      event({ id: "e-2", post_title: "" }),
    ]);
    await waitFor(() => expect(screen.getByText("Tytul wpisu")).toBeTruthy());
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("kod jest SKROCONY - pelny kod nie moze wyciec z ekranu audytu", async () => {
    // Pelny kod w logu daje redakcji (i komukolwiek za jej plecami) dzialajacy
    // klucz do platnej tresci. Skrot ma wystarczyc do sparowania z wierszem.
    const full = "abcDEF123_-xyzABC456pqr";
    await renderPanel([event({ code: full })]);
    await waitFor(() => expect(screen.getByText(`${full.slice(0, 10)}...`)).toBeTruthy());
    expect(screen.queryByText(full)).toBeNull();
  });

  it("data jest formatowana wedlug przekazanej lokalizacji, a nie surowa z ISO", async () => {
    await renderPanel([event({ created_at: "2026-08-01T10:30:00.000Z" })]);
    await waitFor(() => expect(screen.getByText("Reforma rynku energii w CEE")).toBeTruthy());
    expect(screen.queryByText("2026-08-01T10:30:00.000Z")).toBeNull();
  });

  it("dwie rozne lokalizacje daja rozny zapis daty", async () => {
    const { unmount } = await renderPanel([event()]);
    const pl = screen.getAllByRole("row")[1].textContent;
    unmount();
    h.listEvents.mockResolvedValue({ rows: [event()], total: 1 });
    renderWithQueryClient(<AuditPanel dateLocale="en-GB" />);
    await waitFor(() => expect(screen.getByText("Reforma rynku energii w CEE")).toBeTruthy());
    expect(screen.getAllByRole("row")[1].textContent).not.toBe(pl);
  });
});

describe("AuditPanel - aktor zdarzenia", () => {
  it("otwarcie BEZ aktora to 'anonimowy odbiorca', a nie myslnik", async () => {
    await renderPanel([
      event({ event_type: "redeemed", actor_id: null, actor_name: null, actor_email: null }),
    ]);
    await waitFor(() => expect(screen.getByText("giftingAdmin.audit.anonymous")).toBeTruthy());
  });

  it("otwarcie Z aktorem pokazuje jego nazwe", async () => {
    await renderPanel([event({ event_type: "redeemed", actor_name: "Czytelnik Testowy" })]);
    await waitFor(() => expect(screen.getByText("Czytelnik Testowy")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.audit.anonymous")).toBeNull();
  });

  it("aktor bez nazwy spada na adres e-mail", async () => {
    await renderPanel([event({ actor_name: null, actor_email: "autor@example.org" })]);
    await waitFor(() => expect(screen.getByText("autor@example.org")).toBeTruthy());
  });

  it("brak aktora przy zdarzeniu INNYM niz otwarcie to myslnik, nie 'anonimowy'", async () => {
    // "Anonimowy odbiorca" ma sens wylacznie przy otwarciu linku przez goscia.
    // Utworzenie bez aktora znaczy, ze audyt zgubil dane - i tak ma wygladac.
    await renderPanel([
      event({ event_type: "created", actor_id: null, actor_name: null, actor_email: null }),
    ]);
    await waitFor(() => expect(screen.getByText("-")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.audit.anonymous")).toBeNull();
  });
});

describe("AuditPanel - pigulka typu zdarzenia", () => {
  it.each(["created", "redeemed", "revoked", "expired", "exhausted"] as const)(
    "znany typ %s dostaje swoja tonacje i swoj klucz etykiety",
    async (type) => {
      await renderPanel([event({ event_type: type })]);
      const label = await screen.findByText(`giftingAdmin.audit.type.${type}`);
      expect(label.className).toContain(EVENT_PILL_CLS[type]);
    },
  );

  it("NIEZNANY typ zdarzenia NIE wywraca renderu calego logu", async () => {
    // To jest sedno tego pliku. Wiersz z typem spoza unii ma sie narysowac
    // neutralnie, a sasiednie wiersze maja zostac widoczne.
    await renderPanel([
      event({ id: "e-1", event_type: "throttled", post_title: "Wiersz nieznany" }),
      event({ id: "e-2", event_type: "created", post_title: "Wiersz znany" }),
    ]);
    await waitFor(() => expect(screen.getByText("Wiersz nieznany")).toBeTruthy());
    expect(screen.getByText("Wiersz znany")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("nieznany typ dostaje neutralna tonacje, a nie `undefined` w klasie", async () => {
    await renderPanel([event({ event_type: "throttled" })]);
    const label = await screen.findByText("giftingAdmin.audit.type.throttled");
    expect(label.className).toContain(EVENT_PILL_CLS.expired);
    expect(label.className).not.toContain("undefined");
  });

  it("pusty typ zdarzenia tez sie renderuje", async () => {
    await renderPanel([event({ event_type: "", post_title: "Wiersz z pustym typem" })]);
    await waitFor(() => expect(screen.getByText("Wiersz z pustym typem")).toBeTruthy());
  });

  it("kilka nieznanych typow naraz nie kumuluje sie w awarie", async () => {
    await renderPanel([
      event({ id: "e-1", event_type: "throttled", post_title: "A" }),
      event({ id: "e-2", event_type: "quarantined", post_title: "B" }),
      event({ id: "e-3", event_type: "rotated", post_title: "C" }),
    ]);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});

describe("AuditPanel - dostepnosc", () => {
  it("nie wnosi naruszen dostepnosci", async () => {
    const { container } = await renderPanel([
      event({ id: "e-1", event_type: "created" }),
      event({ id: "e-2", event_type: "redeemed", actor_id: null }),
      event({ id: "e-3", event_type: "throttled" }),
    ]);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
