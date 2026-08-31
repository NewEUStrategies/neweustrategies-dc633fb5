// Zakladka POZYCJE panelu reklam: przypiecie slotu do konkretnego miejsca na
// stronie, z konfiguracja zalezna od tego miejsca i oknem czasowym emisji.
//
// PO CO TEN PLIK ISTNIEJE. Pozycja to jedyny obiekt w module reklam, ktory
// naprawde decyduje, GDZIE i KIEDY kreacja sie pojawi. Ryzyka sa tu inne niz
// przy slotach:
//   1. ZAPIS BEZ SLOTU - wiersz `ad_placements` bez `slot_id` to pozycja, ktora
//      nigdy nic nie wyswietli, a w tabeli wyglada jak dzialajaca (kolumna
//      „Slot" pokazuje wtedy dywiz).
//   2. POLE NIE OD TEJ POZYCJI - „co N kart" ma sens wylacznie w strumieniu
//      wpisow, „po ktorym paragrafie" wylacznie w srodku tekstu. Pokazanie ich
//      razem zbiera ustawienia, ktorych emisja nigdy nie odczyta.
//   3. OKNO CZASOWE ODWROCONE - koniec przed poczatkiem daje kampanie, ktora
//      nie leci ani jednego dnia, a panel nie zglasza nic.
//   4. USUNIECIE MIMO ANULOWANIA - pozycja znika ze strony bez sladu.
//
// WARTOSCI DOMYSLNE POKAZYWANE W FORMULARZU (4 paragraf, co 5 kart, 3000 ms,
// „zamykalne") sa tu asertowane celowo: emisja
// (`components/ads/MidPostAds`, `useInFeedAds`, `FooterSlideup`) ma DOKLADNIE
// te same zapasowe wartosci, a pozycja zapisana bez dotkniecia pola zostaje
// z pustym `config`. Rozjazd tych dwoch list zapasowych oznaczalby, ze panel
// obiecuje jedno, a czytelnik dostaje drugie - i nikt tego nie zobaczy.
//
// GRANICE vs SASIEDZI: atrapowany jest klient Supabase, toasty, dialog
// potwierdzenia, i18n i prymitywy Radiksa (Select/Switch/DateTimePicker), ktore
// pod happy-dom nie reaguja na klikniecie. `../model` i `@/lib/ads/types` biegna
// prawdziwe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";
import type { AdPlacement, AdSlot } from "@/lib/ads/types";

/** Ksztalt pytania, ktore panel zadaje przed usunieciem (patrz `@/lib/appDialogs`). */
type ConfirmDialogOptions = {
  title: string;
  description?: string;
  destructive?: boolean;
  confirmLabel?: string;
};

const h = vi.hoisted(() => ({
  from: null as unknown,
  // Sygnatura z argumentem, bo test asertuje TRESC pytania (tytul, wariant
  // destrukcyjny) - `vi.fn<() => ...>` dawal krotke zerowej dlugosci.
  confirm: vi.fn<(opts: ConfirmDialogOptions) => Promise<boolean>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { deleted: () => "adminToasts.deleted", saved: () => "adminToasts.saved" },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

// DateTimePicker stoi na Radiksowym Popoverze i kalendarzu `react-day-picker` -
// pod happy-dom (bez ukladu i bez pelnego API wskaznika) kalendarz sie nie
// otwiera, wiec okna czasowego nie dalo by sie ustawic. Atrapa jest wierna
// w tym, na czym stoja asercje: przyjmuje i oddaje ISO (albo `null`), nosi
// `placeholder` jako dostepna nazwe i WYSTAWIA `minDate`, bo wlasnie ta granica
// pilnuje, zeby koniec kampanii nie wypadl przed jej poczatkiem.
vi.mock("@/components/ui/datetime-picker", async () => {
  const React = await import("react");
  return {
    DateTimePicker: ({
      value,
      onChange,
      placeholder,
      minDate,
    }: {
      value: string | null;
      onChange: (iso: string | null) => void;
      placeholder?: string;
      minDate?: Date;
    }) =>
      React.createElement("input", {
        "aria-label": placeholder,
        value: value ?? "",
        "data-min": minDate ? minDate.toISOString() : "",
        onChange: (event: { target: { value: string } }) =>
          onChange(event.target.value === "" ? null : event.target.value),
      }),
  };
});

import { PlacementsPanel } from "../PlacementsPanel";

const db = () => h.from as SupabaseFromStub;

const SLOT: AdSlot = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  tenant_id: "tttttttt-1111-4111-8111-tttttttttttt",
  name: "Baner glowny",
  kind: "html",
  status: "active",
  html: "<div></div>",
  script: null,
  image_url: null,
  image_link: null,
  image_alt: null,
  width: null,
  height: null,
  requires_consent: true,
  targeting: {},
  notes: null,
  created_at: "2026-02-01T10:00:00.000Z",
  updated_at: "2026-02-01T10:00:00.000Z",
};

const PLACEMENT: AdPlacement = {
  id: "pppppppp-1111-4111-8111-pppppppppppp",
  tenant_id: SLOT.tenant_id,
  slot_id: SLOT.id,
  position: "mid_post",
  page_type: "post",
  page_id: null,
  config: { paragraph: 3 },
  sort_order: 10,
  active: true,
  starts_at: null,
  ends_at: null,
  created_at: "2026-02-01T10:00:00.000Z",
  updated_at: "2026-02-01T10:00:00.000Z",
};

async function renderPanel(slots: AdSlot[], placements: AdPlacement[]) {
  db().setResponse("ad_slots", ok(slots));
  db().setResponse("ad_placements", ok(placements));
  const utils = render(<PlacementsPanel />);
  await waitFor(() => expect(db().chainsFor("ad_placements").length).toBeGreaterThan(0));
  return utils;
}

/** Kolejnosc list wyboru w formularzu: slot, pozycja na stronie, typ strony. */
const SELECT_SLOT = 0;
const SELECT_POSITION = 1;
const SELECT_PAGE_TYPE = 2;

function selects(): HTMLSelectElement[] {
  return screen.getAllByRole("combobox") as HTMLSelectElement[];
}

/**
 * Zapytania ZAWEZONE do tabeli. Nazwy slotow i etykiety pozycji wystepuja
 * w dokumencie DWA razy - raz w wierszu listy, raz jako opcja w formularzu -
 * wiec zapytanie po calym ekranie mierzyloby formularz zamiast listy.
 */
function tabela() {
  return within(screen.getByRole("table"));
}

function insertPayload(): Record<string, unknown> {
  return db()
    .chainsFor("ad_placements")
    .find((c) => c.has("insert"))
    ?.argsOf("insert")?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  db().reset();
  h.confirm.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("PlacementsPanel - lista", () => {
  it("PUSTA lista mowi wprost, ze pozycji nie ma", async () => {
    await renderPanel([SLOT], []);
    expect(await screen.findByText(/Brak pozycji/)).toBeInTheDocument();
  });

  it("odczyt czyta OBIE tabele i sortuje pozycje po `sort_order`", async () => {
    // Kolejnosc emisji w jednym miejscu strony wynika wprost z tej kolumny -
    // sort po czymkolwiek innym zmienia to, ktora kreacja wygrywa.
    await renderPanel([SLOT], []);
    expect(db().lastChain("ad_slots")?.argsOf("order")).toEqual(["name"]);
    expect(db().lastChain("ad_placements")?.argsOf("order")).toEqual(["sort_order"]);
  });

  it("wiersz laczy pozycje z NAZWA slotu, a nie z jego identyfikatorem", async () => {
    // Identyfikator w tabeli nie mowi redakcji nic; nazwa jest jedynym
    // sposobem sprawdzenia, ze pod tekstem stoi ta kreacja, o ktorej mowa.
    await renderPanel([SLOT], [PLACEMENT]);
    const row = (await tabela().findByText("Baner glowny")).closest("tr");
    const cells = within(row as HTMLElement);
    expect(cells.getByText("adsAdmin.positions.midPost")).toBeInTheDocument();
    expect(cells.getByText("adsAdmin.pageTypes.post")).toBeInTheDocument();
  });

  it("pozycja wskazujaca NIEISTNIEJACY slot pokazuje dywiz, a nie pusta komorke", async () => {
    // Slot skasowany mimo przypietej pozycji (albo odciety przez RLS) zostawia
    // wiersz-sierote. Musi byc widoczny, bo to on zajmuje miejsce w emisji.
    await renderPanel([], [PLACEMENT]);
    const row = (await tabela().findByText("adsAdmin.positions.midPost")).closest("tr");
    expect(within(row as HTMLElement).getByText("-")).toBeInTheDocument();
  });

  it("kolumna `aktywne` rozroznia pozycje wlaczona od wylaczonej", async () => {
    await renderPanel(
      [SLOT],
      [PLACEMENT, { ...PLACEMENT, id: "inne", active: false, position: "sidebar" }],
    );
    const wlaczona = (await tabela().findByText("adsAdmin.positions.midPost")).closest("tr");
    const wylaczona = tabela().getByText("adsAdmin.positions.sidebar").closest("tr");
    expect(within(wlaczona as HTMLElement).getByText("✓")).toBeInTheDocument();
    expect(within(wylaczona as HTMLElement).getByText("-")).toBeInTheDocument();
  });
});

describe("PlacementsPanel - zapis", () => {
  it("BRAK wybranego slotu blokuje zapis i nic nie leci do bazy", async () => {
    // Szkic startuje z pustym `slot_id`, wiec to jest domyslny stan formularza:
    // klikniecie „Dodaj" od razu po wejsciu MUSI sie odbic.
    await renderPanel([SLOT], []);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(
      db()
        .chainsFor("ad_placements")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("wybor slotu odblokowuje zapis i INSERT niesie `slot_id`", async () => {
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_SLOT], { target: { value: SLOT.id } });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(insertPayload()).toMatchObject({
      slot_id: SLOT.id,
      position: "top_of_post",
      page_type: "post",
      active: true,
      sort_order: 0,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.saved");
  });

  it("ODMOWA bazy pokazuje komunikat i NIE czysci formularza", async () => {
    db().setResponse("ad_placements", (chain) =>
      chain.has("insert") ? fail("new row violates row-level security policy", "42501") : ok([]),
    );
    db().setResponse("ad_slots", ok([SLOT]));
    render(<PlacementsPanel />);
    await screen.findByText(/Brak pozycji/);
    fireEvent.change(selects()[SELECT_SLOT], { target: { value: SLOT.id } });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(selects()[SELECT_SLOT]).toHaveValue(SLOT.id);
  });

  it("EDYCJA zapisuje przez UPDATE ZAWEZONY do tego wiersza", async () => {
    await renderPanel([SLOT], [PLACEMENT]);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.save/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("ad_placements")
      .find((c) => c.has("update"));
    expect(update?.argsOf("eq")).toEqual(["id", PLACEMENT.id]);
  });

  it("ANULUJ wraca do pustego szkicu i chowa sie w trybie dodawania", async () => {
    await renderPanel([SLOT], [PLACEMENT]);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj" }))[0]);
    expect(screen.getByText("adsAdmin.placements.editTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.getByText("adsAdmin.placements.addTitle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj" })).toBeNull();
  });
});

describe("PlacementsPanel - pola zalezne od pozycji", () => {
  it("MID_POST pokazuje `po ktorym paragrafie` i domyslnie 4", async () => {
    // 4 to ta sama wartosc zapasowa, ktorej uzywa `MidPostAds` przy pustym
    // `config` - panel nie moze obiecywac innej liczby niz emisja.
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_POSITION], { target: { value: "mid_post" } });
    expect(await screen.findByLabelText("adsAdmin.placements.fieldAfterParagraph")).toHaveValue(4);
    expect(screen.queryByLabelText("Co N kart")).toBeNull();
    expect(screen.queryByLabelText("adsAdmin.placements.fieldDelayMs")).toBeNull();
  });

  it("IN_FEED pokazuje `co N kart` i domyslnie 5", async () => {
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_POSITION], { target: { value: "in_feed" } });
    expect(await screen.findByLabelText("Co N kart")).toHaveValue(5);
    expect(screen.queryByLabelText("adsAdmin.placements.fieldAfterParagraph")).toBeNull();
  });

  it("FOOTER_SLIDEUP pokazuje opoznienie 3000 ms ORAZ przelacznik zamykania", async () => {
    // Brak przelacznika „zamykalne" oznaczalby panel, ktorego czytelnik nie ma
    // jak zamknac - to jest kryterium akceptacji przegladarek dla reklam
    // przyklejonych do dolu ekranu.
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_POSITION], { target: { value: "footer_slideup" } });
    expect(await screen.findByLabelText("adsAdmin.placements.fieldDelayMs")).toHaveValue(3000);
    expect(screen.getByText("adsAdmin.placements.fieldDismissible")).toBeInTheDocument();
  });

  it("pozycja bez wlasnej konfiguracji (np. sidebar) nie pokazuje ZADNEGO z tych pol", async () => {
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_POSITION], { target: { value: "sidebar" } });
    await waitFor(() =>
      expect(screen.queryByLabelText("adsAdmin.placements.fieldAfterParagraph")).toBeNull(),
    );
    expect(screen.queryByLabelText("Co N kart")).toBeNull();
    expect(screen.queryByLabelText("adsAdmin.placements.fieldDelayMs")).toBeNull();
  });

  it("wpisana wartosc `paragraph` trafia do `config` jako LICZBA, nie napis", async () => {
    // PostgREST zapisze do jsonb dokladnie to, co dostanie. Napis "3" przejdzie
    // przez `Number(...)` w emisji, ale kazde porownanie w SQL-u i kazdy raport
    // zaczyna widziec dwa rozne typy w jednej kolumnie.
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_SLOT], { target: { value: SLOT.id } });
    fireEvent.change(selects()[SELECT_POSITION], { target: { value: "mid_post" } });
    fireEvent.change(await screen.findByLabelText("adsAdmin.placements.fieldAfterParagraph"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(insertPayload().config).toEqual({ paragraph: 2 });
  });

  it("przelacznik `zamykalne` zapisuje sie jako wartosc LOGICZNA w `config`", async () => {
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_SLOT], { target: { value: SLOT.id } });
    fireEvent.change(selects()[SELECT_POSITION], { target: { value: "footer_slideup" } });
    // Przelaczniki w kolejnosci renderu: „zamykalne", potem „aktywne".
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(insertPayload().config).toEqual({ dismissible: false });
  });

  it("EDYCJA wczytuje zapisany `config` zamiast pokazywac wartosc zapasowa", async () => {
    // Gdyby formularz pokazal „4" dla pozycji zapisanej z „3", pierwszy zapis
    // bez dotkniecia pola przesunalby kreacje o jeden paragraf.
    await renderPanel([SLOT], [PLACEMENT]);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edytuj" }))[0]);
    expect(screen.getByLabelText("adsAdmin.placements.fieldAfterParagraph")).toHaveValue(3);
  });

  it("lista pozycji i lista typow stron pochodza z map kluczy i18n", async () => {
    // Obie mapy sa typowane na `Record<Enum, string>`: nowy wariant bez klucza
    // nie skompiluje sie. Test pilnuje, ze formularz czyta wlasnie je, wiec
    // nowa pozycja pojawi sie w panelu sama.
    await renderPanel([SLOT], []);
    expect(Array.from(selects()[SELECT_POSITION].options).map((o) => o.value)).toEqual([
      "header_banner",
      "top_of_post",
      "mid_post",
      "bottom_of_post",
      "sidebar",
      "in_feed",
      "footer_slideup",
    ]);
    expect(Array.from(selects()[SELECT_PAGE_TYPE].options).map((o) => o.value)).toEqual([
      "all",
      "home",
      "post",
      "page",
      "category",
      "tag",
      "archive",
      "search",
      "event",
    ]);
  });
});

describe("PlacementsPanel - okno czasowe emisji", () => {
  it("obie granice sa PUSTE domyslnie - kampania bez ograniczen", async () => {
    await renderPanel([SLOT], []);
    expect(screen.getByLabelText("Od razu (bez ograniczenia)")).toHaveValue("");
    expect(screen.getByLabelText("Bezterminowo")).toHaveValue("");
  });

  it("ustawiona data POCZATKU trafia do `starts_at`", async () => {
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_SLOT], { target: { value: SLOT.id } });
    fireEvent.change(screen.getByLabelText("Od razu (bez ograniczenia)"), {
      target: { value: "2026-03-01T08:00:00.000Z" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(insertPayload().starts_at).toBe("2026-03-01T08:00:00.000Z");
  });

  it("data POCZATKU ogranicza od dolu wybor daty KONCA", async () => {
    // To jedyny hamulec przed oknem odwroconym (koniec przed poczatkiem),
    // czyli przed kampania, ktora nie leci ani jednego dnia.
    await renderPanel([SLOT], []);
    fireEvent.change(screen.getByLabelText("Od razu (bez ograniczenia)"), {
      target: { value: "2026-03-01T08:00:00.000Z" },
    });
    expect(screen.getByLabelText("Bezterminowo")).toHaveAttribute(
      "data-min",
      "2026-03-01T08:00:00.000Z",
    );
  });

  it("wyczyszczenie granicy zapisuje NULL, nie pusty napis", async () => {
    // Pusty napis w kolumnie `timestamptz` to blad zapisu; `null` znaczy
    // „bez ograniczenia" i tylko on jest poprawny.
    await renderPanel([SLOT], []);
    fireEvent.change(selects()[SELECT_SLOT], { target: { value: SLOT.id } });
    const od = screen.getByLabelText("Od razu (bez ograniczenia)");
    fireEvent.change(od, { target: { value: "2026-03-01T08:00:00.000Z" } });
    fireEvent.change(od, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    expect(insertPayload().starts_at).toBeNull();
  });
});

describe("PlacementsPanel - usuwanie", () => {
  it("POTWIERDZONE usuniecie kasuje TEN wiersz i melduje sukces", async () => {
    h.confirm.mockResolvedValue(true);
    await renderPanel([SLOT], [PLACEMENT]);
    fireEvent.click((await screen.findAllByRole("button", { name: "" }))[0]);
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_placements")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(
      db()
        .chainsFor("ad_placements")
        .find((c) => c.has("delete"))
        ?.argsOf("eq"),
    ).toEqual(["id", PLACEMENT.id]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted");
  });

  it("ANULOWANE potwierdzenie NIE kasuje niczego", async () => {
    h.confirm.mockResolvedValue(false);
    await renderPanel([SLOT], [PLACEMENT]);
    fireEvent.click((await screen.findAllByRole("button", { name: "" }))[0]);
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(
      db()
        .chainsFor("ad_placements")
        .some((c) => c.has("delete")),
    ).toBe(false);
  });

  it("dialog potwierdzenia jest oznaczony jako destrukcyjny", async () => {
    h.confirm.mockResolvedValue(true);
    await renderPanel([SLOT], [PLACEMENT]);
    fireEvent.click((await screen.findAllByRole("button", { name: "" }))[0]);
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.confirm.mock.calls[0]![0]).toMatchObject({
      destructive: true,
      title: "adsAdmin.placements.deleteTitle",
    });
  });

  it("ODMOWA usuniecia konczy sie komunikatem, nie cisza", async () => {
    h.confirm.mockResolvedValue(true);
    db().setResponse("ad_slots", ok([SLOT]));
    db().setResponse("ad_placements", (chain) =>
      chain.has("delete") ? fail("permission denied", "42501") : ok([PLACEMENT]),
    );
    render(<PlacementsPanel />);
    fireEvent.click((await screen.findAllByRole("button", { name: "" }))[0]);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("PlacementsPanel - dostepnosc", () => {
  it("panel nie ma strukturalnych naruszen dostepnosci", async () => {
    const { container } = await renderPanel([SLOT], [PLACEMENT]);
    await tabela().findByText("Baner glowny");
    const naruszenia = await axeViolations(container, {
      // Te trzy reguly mierzylyby ATRAPY prymitywow (natywny `<select>`,
      // `<input type=checkbox>` i pole daty), a nie produkcyjny DOM Radiksa.
      "select-name": { enabled: false },
      label: { enabled: false },
      "aria-input-field-name": { enabled: false },
      // Brak nazwy przycisku kosza i pusty naglowek kolumny akcji sa
      // zarejestrowane nizej jako defekty produkcyjne.
      "button-name": { enabled: false },
      "empty-table-header": { enabled: false },
    });
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZAREJESTROWANE, NIENAPRAWIONE (zakres pracy: wylacznie testy).
// ---------------------------------------------------------------------------
describe("PlacementsPanel - defekty (zarejestrowane)", () => {
  it.fails("BLAD odczytu list konczy sie komunikatem, a nie pusta tabela", async () => {
    // CO JEST ZLE. `load()` rozpakowuje wynik jako `[{ data: s }, { data: p }]`
    // i NIGDZIE nie zaglada do `error`. Odmowa RLS, awaria sieci i pusta tabela
    // daja dokladnie ten sam widok: „Brak pozycji."
    //
    // DLACZEGO TO RYZYKO. Panel slotow obok robi to poprawnie (`if (error)
    // toast.error(...)`), wiec redaktor uczy sie ufac, ze brak komunikatu
    // znaczy „wszystko przeczytane". Tutaj oznacza rowniez „nic nie
    // przeczytalem". Konsekwencja jest konkretna: administrator widzi „Brak
    // pozycji." i zaklada NOWA pozycje w miejscu, w ktorym juz jedna stoi -
    // dwie kreacje w jednym slocie na tej samej stronie.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka to zmiana kodu produkcyjnego (odczyt
    // `error` z obu zapytan i toast), a zakres tej pracy to wylacznie testy.
    db().setResponse("ad_slots", fail("permission denied for table ad_slots", "42501"));
    db().setResponse("ad_placements", fail("permission denied for table ad_placements", "42501"));
    render(<PlacementsPanel />);
    await waitFor(() => expect(db().chainsFor("ad_placements").length).toBeGreaterThan(0));
    // Krotki limit celowo: komunikat albo pojawia sie od razu po odczycie,
    // albo nie pojawi sie nigdy - dluzsze czekanie tylko spowalnia przebieg.
    await waitFor(() => expect(h.toastError).toHaveBeenCalled(), { timeout: 300 });
  });

  it.fails("komunikat o braku wybranego slotu pochodzi ze slownika", async () => {
    // Literal „Wybierz slot" wprost w kodzie - panel jest dwujezyczny, wiec
    // redaktor pracujacy po angielsku dostanie polski komunikat bledu.
    await renderPanel([SLOT], []);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.placements\.addAction/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError).not.toHaveBeenCalledWith("Wybierz slot");
  });

  it.fails("naglowki tabeli pozycji pochodza ze slownika", async () => {
    // „Slot", „Pozycja", „Strony", „Aktywne" - cztery literale w naglowku,
    // przy czym etykiety WARTOSCI w tych samych kolumnach ida juz przez `t()`.
    // Efekt w wersji angielskiej: polskie naglowki nad angielskimi wartosciami.
    await renderPanel([SLOT], [PLACEMENT]);
    await tabela().findByText("Baner glowny");
    expect(screen.queryByRole("columnheader", { name: "Pozycja" })).toBeNull();
  });

  it.fails("etykiety pol formularza pozycji pochodza ze slownika", async () => {
    // „Sortowanie", „Co N kart", „Aktywne od", „Aktywne do", „Typ strony",
    // „Pozycja na stronie" plus placeholdery obu pol daty.
    await renderPanel([SLOT], []);
    expect(screen.queryByLabelText("Sortowanie")).toBeNull();
  });

  it.fails("przycisk usuwania pozycji ma DOSTEPNA NAZWE", async () => {
    // Ten sam defekt, co w panelu slotow: `<Button>` z samym `<svg>` kosza.
    // Tutaj skutek jest o tyle grozniejszy, ze usuniecie pozycji zdejmuje
    // kreacje ze strony natychmiast, bez zadnego sladu w liscie slotow.
    const { container } = await renderPanel([SLOT], [PLACEMENT]);
    await tabela().findByText("Baner glowny");
    const naruszenia = await axeViolations(container, {
      "select-name": { enabled: false },
      label: { enabled: false },
    });
    expect(naruszenia.map((v) => v.id)).not.toContain("button-name");
  });
});
