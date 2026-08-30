// Organizm „GRUPY UCZESTNIKOW" - lista, na ktorej widac, KTO CO MOZE
// w wydarzeniu, i z ktorej te uprawnienia sie zmienia.
//
// CO TEN PLIK DOWODZI.
//   1. GRUPA SYSTEMOWA NIE MA PRZYCISKU USUNIECIA, a zwykla go ma. To jest
//      para: baza odmawia `group_system`, wiec przycisk przy grupie systemowej
//      obiecywalby operacje konczaca sie zawsze odmowa, a jego brak przy
//      zwyklej grupie odbieralby organizatorowi legalna akcje.
//   2. LICZNIKI STOJA W WIERSZU, bo bez nich organizator nie wie ani ilu ludzi
//      dotknie zmiana uprawnien, ani czy usuniecie ma szanse przejsc
//      (`group_in_use` liczy zapisy, bilety i czlonkostwa).
//   3. GRUPA DOMYSLNA JEST OZNACZONA. Ona wchodzi do KAZDEGO nowego zapisu bez
//      biletu, wiec jej uprawnienia sa uprawnieniami domyslnymi wydarzenia.
//   4. USUNIECIE IDZIE Z IDENTYFIKATOREM TEGO wiersza (nie pierwszego z listy)
//      i wylacznie po potwierdzeniu.
//   5. CZTERY STANY LISTY MAJA CZTERY WIDOKI, a awaria NIE MOZE mowic „nie ma
//      zadnych grup": to nieprawda o stanie uprawnien, po ktorej ktos zaklada
//      komplet grup drugi raz.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Szuflady edycji - `EventGroupDialog` ma
// wlasny plik i jest tu ATRAPA; dowodzimy, Z CZYM organizm ja otwiera i co
// robi z oddanym szkicem. (2) Warstwy danych i kluczy pamieci podrecznej -
// `termsGroupsApi` i `useEventTermsGroups` maja wlasne pliki. (3) Slownika
// odmow bazy (`adminTermsErrors`) - tutaj liczy sie tylko to, ze odmowa
// DOCHODZI zdaniem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type { EventGroupRow, GroupInput } from "@/lib/events/termsGroupsApi";

/** Ksztalt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  language: "pl",
  rows: undefined as unknown,
  isLoading: false,
  listError: null as Error | null,
  /** Wydarzenia, o ktorych grupy organizm pytal. */
  zapytania: [] as string[],
  saveInputs: [] as unknown[],
  saveFails: null as string | null,
  savePending: false,
  deleteIds: [] as string[],
  deleteFails: null as string | null,
  /** Kolejne zestawy wlasciwosci, z ktorymi otwarto szuflade edycji. */
  szuflada: [] as { open: boolean; groupId: string | null; nextSortOrder: number }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Slownik odmow bazy ma wlasny plik testowy i ciagnie realny i18next; tutaj
// potrzebny jest wylacznie dowod, ze odmowa DOCHODZI zdaniem.
vi.mock("@/lib/events/adminTermsErrors", () => ({
  adminTermsErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix wiaze `AlertDialogContent` z `AlertDialogTitle` przez
// `aria-labelledby`; atrapa robi to samo, zeby asercja dostepnosci mierzyla
// organizm, a nie brak w atrapie.
const TYTUL_PYTANIA = "pytanie-o-usuniecie-tytul";

vi.mock("@/components/ui/alert-dialog", () => {
  let open = false;
  let setOpen: ((next: boolean) => void) | null = null;
  return {
    AlertDialog: ({
      open: isOpen,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      open = isOpen;
      setOpen = onOpenChange;
      return <div>{children}</div>;
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) =>
      open ? (
        <div role="alertdialog" aria-labelledby={TYTUL_PYTANIA}>
          {children}
        </div>
      ) : null,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2 id={TYTUL_PYTANIA}>{children}</h2>
    ),
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button" onClick={() => setOpen?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Szuflada edycji jest osobna molekula z wlasnym plikiem testowym. Tutaj liczy
// sie WYLACZNIE to, z czym organizm ja otwiera i co robi z oddanym szkicem.
vi.mock("@/components/admin/events/molecules/EventGroupDialog", () => ({
  EventGroupDialog: (props: {
    open: boolean;
    group: EventGroupRow | null;
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: GroupInput) => void;
  }) => {
    h.szuflada.push({
      open: props.open,
      groupId: props.group === null ? null : props.group.id,
      nextSortOrder: props.nextSortOrder,
    });
    if (!props.open) return null;
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onSubmit({ namePl: "Nowa grupa", nameEn: "New group" })}
        >
          atrapa-zapisz
        </button>
        <span>{`atrapa-zapis-trwa:${String(props.isSaving)}`}</span>
      </div>
    );
  },
}));

vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: (eventId: string) => {
    h.zapytania.push(eventId);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useSaveEventGroup: () => ({
    isPending: h.savePending,
    mutate: (input: GroupInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.("grupa-1");
    },
  }),
  useDeleteEventGroup: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.deleteIds.push(id);
      if (h.deleteFails !== null) res.onError?.(new Error(h.deleteFails));
      else res.onSuccess?.(true);
    },
  }),
}));

const { EventGroupsPanel } = await import("@/components/admin/events/organisms/EventGroupsPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const G = "adminEventTerms.groups.";

/**
 * Wiersz `admin_event_groups_list`.
 *
 * `color` przychodzi z RPC jako `NULL` („grupa bez koloru"), a sygnatura
 * generowana z bazy opisuje kolumne jako `string`. Rzutowanie jest wierne
 * bazie: organizm te pustke ROZROZNIA (belka w kolorze domyslnym).
 */
const BRAK_KOLORU = null as unknown as string;

function groupRow(overrides: Partial<EventGroupRow> = {}): EventGroupRow {
  return {
    attendee_visibility: "registered",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: true,
    color: "#2563eb",
    created_at: "2026-08-01T09:00:00.000Z",
    description_en: "",
    description_pl: "",
    event_id: EVENT_ID,
    extra_members_count: 0,
    id: "grupa-a",
    is_default: false,
    is_system: false,
    key: "attendees",
    members_count: 0,
    min_tier_rank: 0,
    name_en: "Attendees",
    name_pl: "Uczestnicy",
    primary_members_count: 0,
    sort_order: 10,
    tickets_count: 0,
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function renderuj() {
  return render(<EventGroupsPanel eventId={EVENT_ID} />);
}

/** Wiersz listy po widocznej nazwie grupy. */
function wiersz(nazwa: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(nazwa) === true);
  if (li === undefined) throw new Error(`brak wiersza „${nazwa}” na ekranie`);
  return li;
}

/** Ostatni zestaw wlasciwosci szuflady edycji. */
function ostatniaSzuflada() {
  const last = h.szuflada.at(-1);
  if (last === undefined) throw new Error("organizm nie zamontowal szuflady edycji");
  return last;
}

beforeEach(() => {
  h.language = "pl";
  h.rows = [];
  h.isLoading = false;
  h.listError = null;
  h.zapytania = [];
  h.saveInputs = [];
  h.saveFails = null;
  h.savePending = false;
  h.deleteIds = [];
  h.deleteFails = null;
  h.szuflada = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy grup", () => {
  it("wczytywanie pokazuje postep i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText(`${G}loading`)).toBeTruthy();
    expect(screen.queryByText(`${G}empty`)).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // NA EKRANIE UPRAWNIEN TO JEST NAJDROZSZA POMYLKA: „nie ma zadnych grup" po
  // nieudanym zapytaniu to nieprawda o stanie uprawnien. Organizator zaklada
  // wtedy komplet grup drugi raz - i pierwsza z nich lamie unikalnosc klucza.
  it("awaria mowi trescia odmowy i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: editor role required");
    renderuj();
    expect(screen.getByText("odmowa:forbidden: editor role required")).toBeTruthy();
    expect(screen.queryByText(`${G}empty`)).toBeNull();
    expect(screen.queryByText(`${G}loading`)).toBeNull();
  });

  it("wczytywanie po nieudanej probie bije awarie", () => {
    h.rows = undefined;
    h.isLoading = true;
    h.listError = new Error("groups_failed");
    renderuj();
    expect(screen.getByText(`${G}loading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:groups_failed")).toBeNull();
  });

  it("pustka mowi to wprost i nie rysuje ani jednego wiersza", () => {
    renderuj();
    expect(screen.getByText(`${G}empty`)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("organizm pyta o grupy TEGO wydarzenia", () => {
    renderuj();
    expect(h.zapytania).toContain(EVENT_ID);
  });
});

describe("wiersz grupy mowi, co ta grupa moze", () => {
  it("wiersz niesie nazwe, klucz i zasieg widocznosci", () => {
    h.rows = [groupRow({ name_pl: "Uczestnicy", key: "attendees" })];
    renderuj();
    const li = wiersz("Uczestnicy");
    expect(within(li).getByText("attendees")).toBeTruthy();
    expect(within(li).getByText("adminEventTerms.visibilities.registered")).toBeTruthy();
  });

  // ZASIEG JEST NAZWANY W KAZDYM WIERSZU. Bez tego dwie grupy o roznych
  // uprawnieniach wygladaja na liscie identycznie.
  it("kazdy zasieg ma wlasny napis w wierszu", () => {
    h.rows = [
      groupRow({ id: "a", name_pl: "Bez listy", attendee_visibility: "none" }),
      groupRow({ id: "b", name_pl: "Wlasna grupa", attendee_visibility: "own_group" }),
      groupRow({ id: "c", name_pl: "Wszyscy", attendee_visibility: "everyone" }),
    ];
    renderuj();
    expect(within(wiersz("Bez listy")).getByText("adminEventTerms.visibilities.none")).toBeTruthy();
    expect(
      within(wiersz("Wlasna grupa")).getByText("adminEventTerms.visibilities.own_group"),
    ).toBeTruthy();
    expect(
      within(wiersz("Wszyscy")).getByText("adminEventTerms.visibilities.everyone"),
    ).toBeTruthy();
  });

  // LICZNIKI MOWIA, ILU LUDZI DOTKNIE ZMIANA UPRAWNIEN - i czy usuniecie ma
  // szanse przejsc (`group_in_use` liczy dokladnie te trzy zrodla).
  it("wiersz niesie trzy liczniki: zapisani, dodatkowi, bilety", () => {
    h.rows = [groupRow({ primary_members_count: 12, extra_members_count: 4, tickets_count: 3 })];
    renderuj();
    const li = wiersz("Uczestnicy");
    expect(within(li).getByText("12")).toBeTruthy();
    expect(within(li).getByText("4")).toBeTruthy();
    expect(within(li).getByText("3")).toBeTruthy();
  });

  it("grupa bez koloru nie wywraca wiersza", () => {
    h.rows = [groupRow({ color: BRAK_KOLORU })];
    renderuj();
    expect(wiersz("Uczestnicy")).toBeTruthy();
  });

  it("po angielsku wiersz bierze nazwe angielska", () => {
    h.language = "en";
    h.rows = [groupRow({ name_pl: "Uczestnicy", name_en: "Attendees" })];
    renderuj();
    expect(screen.getByText("Attendees")).toBeTruthy();
  });
});

describe("plakietki - para „domyslna / zwykla” i „systemowa / zwykla”", () => {
  // GRUPA DOMYSLNA WCHODZI DO KAZDEGO NOWEGO ZAPISU BEZ BILETU. Jej
  // uprawnienia sa uprawnieniami domyslnymi wydarzenia, wiec organizator musi
  // widziec na liscie, KTORA to grupa.
  it("grupa domyslna ma plakietke domyslnosci", () => {
    h.rows = [groupRow({ is_default: true })];
    renderuj();
    expect(within(wiersz("Uczestnicy")).getByText("adminEventTerms.labels.default")).toBeTruthy();
  });

  it("grupa niedomyslna NIE ma tej plakietki", () => {
    h.rows = [groupRow({ is_default: false })];
    renderuj();
    expect(within(wiersz("Uczestnicy")).queryByText("adminEventTerms.labels.default")).toBeNull();
  });

  it("grupa systemowa ma plakietke systemowosci, a zwykla nie", () => {
    h.rows = [
      groupRow({ id: "a", name_pl: "Systemowa", is_system: true }),
      groupRow({ id: "b", name_pl: "Wlasna", is_system: false }),
    ];
    renderuj();
    expect(within(wiersz("Systemowa")).getByText("adminEventTerms.labels.system")).toBeTruthy();
    expect(within(wiersz("Wlasna")).queryByText("adminEventTerms.labels.system")).toBeNull();
  });
});

describe("usuniecie grupy - para „zwykla moze / systemowa nie moze”", () => {
  // BAZA ODMAWIA `group_system`. Przycisk przy grupie systemowej obiecywalby
  // operacje, ktora ZAWSZE konczy sie odmowa - a odmowa czyta sie jak awaria
  // ekranu, nie jak regula.
  it("grupa systemowa NIE MA przycisku usuniecia", () => {
    h.rows = [groupRow({ is_system: true })];
    renderuj();
    expect(within(wiersz("Uczestnicy")).queryByLabelText(`${G}deleteAction`)).toBeNull();
  });

  it("grupa zwykla MA przycisk usuniecia", () => {
    h.rows = [groupRow({ is_system: false })];
    renderuj();
    expect(within(wiersz("Uczestnicy")).getByLabelText(`${G}deleteAction`)).toBeTruthy();
  });

  // OBIE GRUPY ZOSTAJA EDYTOWALNE. Systemowej nie da sie usunac, ale jej
  // uprawnienia zmienia sie tak samo jak kazdej innej - brak olowka
  // zamrozilby uprawnienia czterech grup startowych na zawsze.
  it("grupa systemowa NADAL ma przycisk edycji", () => {
    h.rows = [groupRow({ is_system: true })];
    renderuj();
    expect(within(wiersz("Uczestnicy")).getByText(`${G}editAction`)).toBeTruthy();
  });

  it("przycisk OTWIERA pytanie i sam z siebie niczego nie kasuje", () => {
    h.rows = [groupRow()];
    renderuj();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(wiersz("Uczestnicy")).getByLabelText(`${G}deleteAction`));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(h.deleteIds).toEqual([]);
  });

  // IDENTYFIKATOR MUSI BYC Z TEGO WIERSZA. Pomylka na tym ekranie kasuje
  // uprawnienia innej grupy - razem z przypisaniem wszystkich jej ludzi.
  it("potwierdzenie kasuje TE grupe, nie pierwsza z listy", () => {
    h.rows = [
      groupRow({ id: "grupa-a", name_pl: "Uczestnicy" }),
      groupRow({ id: "grupa-b", name_pl: "Prelegenci" }),
    ];
    renderuj();
    fireEvent.click(within(wiersz("Prelegenci")).getByLabelText(`${G}deleteAction`));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: `${G}deleteAction` }),
    );
    expect(h.deleteIds).toEqual(["grupa-b"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventTerms.toasts.groupDeleted");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("wycofanie sie z pytania nie woła warstwy danych", () => {
    h.rows = [groupRow()];
    renderuj();
    fireEvent.click(within(wiersz("Uczestnicy")).getByLabelText(`${G}deleteAction`));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventTerms.groups.dialog.cancelAction",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.deleteIds).toEqual([]);
  });

  // GRUPA UZYWANA PRZEZ ZAPISY NIE ZNIKA. Odmowa `group_in_use` niesie LICZBE
  // uzyc - i to ona tlumaczy organizatorowi, dlaczego nie przeszlo.
  it("odmowa `group_in_use` dochodzi zdaniem i zostawia wiersz na liscie", () => {
    h.rows = [groupRow()];
    h.deleteFails = "group_in_use: 12 registration(s), ticket(s) or membership(s) use this group";
    renderuj();
    fireEvent.click(within(wiersz("Uczestnicy")).getByLabelText(`${G}deleteAction`));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: `${G}deleteAction` }),
    );
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:group_in_use: 12 registration(s), ticket(s) or membership(s) use this group",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(wiersz("Uczestnicy")).toBeTruthy();
  });

  // DEFEKT (`it.fails`). Organizm gasi przycisk usuniecia WYLACZNIE przy
  // `is_system`. Grupa zalozona recznie i oznaczona jako DOMYSLNA jest
  // `is_system = false`, wiec przycisk zostaje - a baza takiego usuniecia nie
  // blokuje (`admin_event_group_delete` sprawdza tylko `is_system` i liczbe
  // uzyc). Po skasowaniu wydarzenie nie ma grupy domyslnej, a wtedy KAZDY nowy
  // zapis bez biletu dostaje `group_id = NULL`
  // (`admin_event_registration_submit`: „IF v_group_id IS NULL THEN SELECT ...
  // WHERE g.is_default"), czyli uczestnika bez zadnych uprawnien wydarzenia.
  // Poprawka nalezy do produkcji: warunek `row.is_system || row.is_default`.
  it.fails("grupa domyslna nie ma przycisku usuniecia", () => {
    h.rows = [groupRow({ is_default: true, is_system: false })];
    renderuj();
    expect(within(wiersz("Uczestnicy")).queryByLabelText(`${G}deleteAction`)).toBeNull();
  });
});

describe("szuflada edycji", () => {
  it("na starcie szuflada jest zamknieta", () => {
    h.rows = [groupRow()];
    renderuj();
    expect(ostatniaSzuflada().open).toBe(false);
  });

  it("„Dodaj grupe” otwiera szuflade BEZ wiersza (tryb zakladania)", () => {
    h.rows = [groupRow()];
    renderuj();
    fireEvent.click(screen.getByText(`${G}createAction`));
    expect(ostatniaSzuflada()).toMatchObject({ open: true, groupId: null });
  });

  // OLOWEK OTWIERA TEN wiersz. Pomylka tutaj daje edycje uprawnien cudzej
  // grupy pod naglowkiem tej, ktora organizator kliknal.
  it("olowek otwiera szuflade nad TYM wierszem", () => {
    h.rows = [
      groupRow({ id: "grupa-a", name_pl: "Uczestnicy" }),
      groupRow({ id: "grupa-b", name_pl: "Prelegenci" }),
    ];
    renderuj();
    fireEvent.click(within(wiersz("Prelegenci")).getByText(`${G}editAction`));
    expect(ostatniaSzuflada()).toMatchObject({ open: true, groupId: "grupa-b" });
  });

  // KOLEJNOSC NOWEJ GRUPY TO NAJWIEKSZA Z LISTY PLUS DZIESIEC. Bez tego kazda
  // nowa grupa ladowalaby na tej samej pozycji co poprzednia.
  it("nowa grupa dostaje kolejnosc o dziesiec wieksza niz najdalsza", () => {
    h.rows = [groupRow({ id: "a", sort_order: 10 }), groupRow({ id: "b", sort_order: 40 })];
    renderuj();
    expect(ostatniaSzuflada().nextSortOrder).toBe(50);
  });

  it("pusta lista daje pierwszej grupie kolejnosc dziesiec", () => {
    h.rows = [];
    renderuj();
    expect(ostatniaSzuflada().nextSortOrder).toBe(10);
  });

  it("udany zapis zamyka szuflade i mowi o tym", () => {
    h.rows = [groupRow()];
    renderuj();
    fireEvent.click(screen.getByText(`${G}createAction`));
    fireEvent.click(screen.getByText("atrapa-zapisz"));
    expect(h.saveInputs).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventTerms.toasts.groupSaved");
    expect(ostatniaSzuflada().open).toBe(false);
  });

  // ODMOWA NIE MOZE KASOWAC PRACY. Szuflada zostaje otwarta z wpisanymi
  // wartosciami, a powod odmowy dochodzi zdaniem.
  it("odmowa zapisu zostawia szuflade otwarta i mowi trescia odmowy", () => {
    h.rows = [groupRow()];
    h.saveFails = "invalid_names: the name is required in both languages";
    renderuj();
    fireEvent.click(screen.getByText(`${G}createAction`));
    fireEvent.click(screen.getByText("atrapa-zapisz"));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:invalid_names: the name is required in both languages",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(ostatniaSzuflada().open).toBe(true);
  });

  it("trwajacy zapis dochodzi do szuflady", () => {
    h.rows = [groupRow()];
    h.savePending = true;
    renderuj();
    fireEvent.click(screen.getByText(`${G}createAction`));
    expect(screen.getByText("atrapa-zapis-trwa:true")).toBeTruthy();
  });
});

describe("dostepnosc", () => {
  it("lista grup nie ma naruszen dostepnosci", async () => {
    h.rows = [
      groupRow({ id: "a", name_pl: "Uczestnicy", is_default: true }),
      groupRow({ id: "b", name_pl: "Organizatorzy", is_system: true }),
    ];
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("pytanie o usuniecie nie ma naruszen dostepnosci", async () => {
    h.rows = [groupRow()];
    const { container } = renderuj();
    fireEvent.click(within(wiersz("Uczestnicy")).getByLabelText(`${G}deleteAction`));
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan awarii nie ma naruszen dostepnosci", async () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: editor role required");
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
