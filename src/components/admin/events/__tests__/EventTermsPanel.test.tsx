// Organizm „ZGODY I REGULAMINY" - lista, ktora jest REJESTREM DOWODOW zgody.
//
// CO TEN PLIK DOWODZI.
//   1. AKCEPTACJI SIE NIE KASUJE. Zgoda z choc jedna akceptacja NIE MA
//      przycisku usuniecia (baza odmawia `term_in_use`), a zgoda bez
//      akceptacji go ma. To jest para: bez pierwszej polowy ekran obiecuje
//      skasowanie dowodu, bez drugiej odbiera legalna akcje. Poprawna operacja
//      przy zgodzie z akceptacjami to WYLACZENIE.
//   2. WERSJA STOI PRZY KAZDEJ ZGODZIE. Akceptacja zapisuje numer wersji, nie
//      tresc - bez wersji na ekranie nie da sie powiedziec, CO uczestnik
//      zaakceptowal. Numer jest wiec elementem wiersza, nie ozdoba.
//   3. ROZNICA DWOCH LICZNIKOW MIERZY SKUTEK PODNIESIENIA WERSJI: ilu ludzi
//      trzeba poprosic ponownie. Zero roznicy nie moze wygladac jak ostrzezenie.
//   4. WYMAGANA vs OPCJONALNA i MIEJSCE WYSWIETLENIA sa nazwane w wierszu -
//      to one rozstrzygaja, czy i gdzie uczestnik w ogole zobaczy zgode.
//   5. CZTERY STANY LISTY MAJA CZTERY WIDOKI, a awaria NIE MOZE mowic „nie ma
//      zadnych zgod": to nieprawda o rejestrze dowodow.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Formularza zgody - `EventTermDialog` ma
// wlasny plik i jest tu ATRAPA. (2) Warstwy danych i kluczy pamieci podrecznej.
// (3) Slownika odmow bazy - tutaj liczy sie, ze odmowa DOCHODZI zdaniem.
// (4) Reguly `staleAcceptances` - ma tabele w `termsGroupsDraft.test.ts`;
// tutaj dowodzimy WYNIKU na ekranie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type { EventTermRow, TermInput } from "@/lib/events/termsGroupsApi";

interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  language: "pl",
  rows: undefined as unknown,
  isLoading: false,
  listError: null as Error | null,
  zapytania: [] as string[],
  saveInputs: [] as unknown[],
  saveFails: null as string | null,
  savePending: false,
  deleteIds: [] as string[],
  deleteFails: null as string | null,
  okno: [] as { open: boolean; termId: string | null; nextSortOrder: number }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminTermsErrors", () => ({
  adminTermsErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix wiaze `AlertDialogContent` z `AlertDialogTitle` przez `aria-labelledby`;
// atrapa robi to samo, zeby asercja dostepnosci mierzyla organizm.
const TYTUL_PYTANIA = "pytanie-o-usuniecie-zgody";

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

// Formularz zgody jest osobna molekula z wlasnym plikiem testowym.
vi.mock("@/components/admin/events/molecules/EventTermDialog", () => ({
  EventTermDialog: (props: {
    open: boolean;
    term: EventTermRow | null;
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: TermInput) => void;
  }) => {
    h.okno.push({
      open: props.open,
      termId: props.term === null ? null : props.term.id,
      nextSortOrder: props.nextSortOrder,
    });
    if (!props.open) return null;
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onSubmit({ labelPl: "Nowa zgoda", labelEn: "New consent" })}
        >
          atrapa-zapisz
        </button>
        <span>{`atrapa-zapis-trwa:${String(props.isSaving)}`}</span>
      </div>
    );
  },
}));

vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventTerms: (eventId: string) => {
    h.zapytania.push(eventId);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useSaveEventTerm: () => ({
    isPending: h.savePending,
    mutate: (input: TermInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.("zgoda-1");
    },
  }),
  useDeleteEventTerm: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.deleteIds.push(id);
      if (h.deleteFails !== null) res.onError?.(new Error(h.deleteFails));
      else res.onSuccess?.(true);
    },
  }),
}));

const { EventTermsPanel } = await import("@/components/admin/events/organisms/EventTermsPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const T = "adminEventTerms.terms.";
const L = "adminEventTerms.labels.";

/**
 * Wiersz `admin_event_terms_list`.
 *
 * `external_url` przychodzi z RPC jako `NULL` („zgoda bez odnosnika"), a
 * sygnatura generowana z bazy opisuje kolumne jako `string` - organizm te
 * pustke ROZROZNIA (`row.external_url === null ? null : <a>`).
 */
const BRAK_ODNOSNIKA = null as unknown as string;

function termRow(overrides: Partial<EventTermRow> = {}): EventTermRow {
  return {
    acceptances_current: 0,
    acceptances_total: 0,
    body_en: "Consent body.",
    body_pl: "Tresc zgody.",
    created_at: "2026-08-01T09:00:00.000Z",
    display: "registration",
    event_id: EVENT_ID,
    external_url: BRAK_ODNOSNIKA,
    id: "zgoda-a",
    is_active: true,
    is_required: true,
    key: "rodo",
    label_en: "Data processing consent",
    label_pl: "Zgoda na przetwarzanie danych",
    sort_order: 10,
    updated_at: "2026-08-02T09:00:00.000Z",
    version: 1,
    withdrawn_count: 0,
    ...overrides,
  };
}

function renderuj() {
  return render(<EventTermsPanel eventId={EVENT_ID} />);
}

function wiersz(etykieta: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(etykieta) === true);
  if (li === undefined) throw new Error(`brak wiersza „${etykieta}” na ekranie`);
  return li;
}

function ostatnieOkno() {
  const last = h.okno.at(-1);
  if (last === undefined) throw new Error("organizm nie zamontowal formularza zgody");
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
  h.okno = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy zgod", () => {
  it("wczytywanie pokazuje postep i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText(`${T}loading`)).toBeTruthy();
    expect(screen.queryByText(`${T}empty`)).toBeNull();
  });

  // „NIE MA ZADNYCH ZGOD" PO ODMOWIE TO NIEPRAWDA O REJESTRZE DOWODOW.
  // Organizator zaklada wtedy regulamin drugi raz - i wydarzenie ma dwa
  // dokumenty o tej samej tresci, kazdy z wlasna lista akceptacji.
  it("awaria mowi trescia odmowy i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: editor role required");
    renderuj();
    expect(screen.getByText("odmowa:forbidden: editor role required")).toBeTruthy();
    expect(screen.queryByText(`${T}empty`)).toBeNull();
  });

  it("wczytywanie po nieudanej probie bije awarie", () => {
    h.rows = undefined;
    h.isLoading = true;
    h.listError = new Error("terms_failed");
    renderuj();
    expect(screen.getByText(`${T}loading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:terms_failed")).toBeNull();
  });

  it("pustka mowi to wprost i nie rysuje ani jednego wiersza", () => {
    renderuj();
    expect(screen.getByText(`${T}empty`)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("organizm pyta o zgody TEGO wydarzenia", () => {
    renderuj();
    expect(h.zapytania).toContain(EVENT_ID);
  });
});

describe("wersja zgody stoi przy kazdym wierszu", () => {
  // AKCEPTACJA ZAPISUJE NUMER WERSJI, NIE TRESC. Bez numeru na ekranie
  // organizator nie ma jak powiedziec, CO dokladnie zaakceptowali uczestnicy -
  // a wtedy akceptacja przestaje byc dowodem.
  it("wiersz niesie numer wersji", () => {
    h.rows = [termRow({ version: 3 })];
    renderuj();
    expect(within(wiersz("Zgoda na przetwarzanie danych")).getByText(`${L}version 3`)).toBeTruthy();
  });

  it("zgoda swiezo zalozona pokazuje wersje pierwsza, a nie pusty znacznik", () => {
    h.rows = [termRow({ version: 1 })];
    renderuj();
    expect(within(wiersz("Zgoda na przetwarzanie danych")).getByText(`${L}version 1`)).toBeTruthy();
  });

  // ROZNICA DWOCH LICZNIKOW MIERZY SKUTEK PODNIESIENIA WERSJI: tylu ludzi
  // trzeba poprosic ponownie. To jedyna liczba na tym ekranie, ktora mowi
  // organizatorowi, ile pracy kosztowala zmiana regulaminu.
  it("po podniesieniu wersji wiersz ostrzega, ilu akceptacji brakuje", () => {
    h.rows = [termRow({ version: 2, acceptances_total: 52, acceptances_current: 40 })];
    renderuj();
    expect(
      within(wiersz("Zgoda na przetwarzanie danych")).getByText(`${L}staleAcceptances(count=12)`),
    ).toBeTruthy();
  });

  it("komplet aktualnych akceptacji NIE pokazuje ostrzezenia", () => {
    h.rows = [termRow({ acceptances_total: 52, acceptances_current: 52 })];
    renderuj();
    expect(
      within(wiersz("Zgoda na przetwarzanie danych")).queryByText(/staleAcceptances/),
    ).toBeNull();
  });

  it("wiersz niesie oba liczniki akceptacji i liczbe wycofanych", () => {
    h.rows = [termRow({ acceptances_current: 40, acceptances_total: 52, withdrawn_count: 3 })];
    renderuj();
    const tekst = wiersz("Zgoda na przetwarzanie danych").textContent ?? "";
    expect(tekst).toContain(`${L}acceptancesCurrent: 40`);
    expect(tekst).toContain(`${L}acceptancesTotal: 52`);
    expect(tekst).toContain(`${L}withdrawn: 3`);
  });
});

describe("wymagalnosc i miejsce wyswietlenia - pary w wierszu", () => {
  it("zgoda WYMAGANA jest tak opisana", () => {
    h.rows = [termRow({ is_required: true })];
    renderuj();
    const li = wiersz("Zgoda na przetwarzanie danych");
    expect(within(li).getByText(`${L}required`)).toBeTruthy();
    expect(within(li).queryByText(`${L}optional`)).toBeNull();
  });

  it("zgoda OPCJONALNA jest tak opisana", () => {
    h.rows = [termRow({ is_required: false })];
    renderuj();
    const li = wiersz("Zgoda na przetwarzanie danych");
    expect(within(li).getByText(`${L}optional`)).toBeTruthy();
    expect(within(li).queryByText(`${L}required`)).toBeNull();
  });

  // MIEJSCE WYSWIETLENIA ROZSTRZYGA, KIEDY UCZESTNIK ZOBACZY ZGODE. Trzy
  // wartosci to trzy rozne momenty - wiersz musi je rozrozniac, bo inaczej
  // organizator nie wie, czy regulamin wejscia w ogole komukolwiek sie pokaze.
  it.each([
    ["registration", "przy zapisie"],
    ["access", "przy wejsciu"],
    ["registration_and_access", "w obu miejscach"],
    // Drugi element krotki nie jest asercja - wchodzi w nazwe przypadku (`%s`),
    // zeby raport mowil PO POLSKU, ktory moment opisuje dana wartosc. Callback
    // musi go przyjac, bo `it.each` podaje CALA krotke.
  ] as const)("miejsce `%s` jest nazwane w wierszu (%s)", (display, _moment) => {
    h.rows = [termRow({ display })];
    renderuj();
    expect(wiersz("Zgoda na przetwarzanie danych").textContent).toContain(
      `adminEventTerms.displays.${display}`,
    );
  });

  it("zgoda WYLACZONA jest tak oznaczona, a wlaczona nie", () => {
    h.rows = [
      termRow({ id: "a", label_pl: "Wylaczona", is_active: false }),
      termRow({ id: "b", label_pl: "Wlaczona", is_active: true }),
    ];
    renderuj();
    expect(within(wiersz("Wylaczona")).getByText(`${L}inactive`)).toBeTruthy();
    expect(within(wiersz("Wlaczona")).queryByText(`${L}inactive`)).toBeNull();
  });

  it("po angielsku wiersz bierze etykiete angielska", () => {
    h.language = "en";
    h.rows = [termRow({ label_pl: "Zgoda RODO", label_en: "GDPR consent" })];
    renderuj();
    expect(screen.getByText("GDPR consent")).toBeTruthy();
  });
});

describe("odnosnik do dokumentu - para „jest / nie ma”", () => {
  // REGULAMIN BYWA OSOBNYM DOKUMENTEM. Odnosnik musi byc klikalny, otwierac
  // sie obok (uczestnik nie traci ekranu) i nie oddawac referrera.
  it("zgoda z odnosnikiem ma klikalny link do dokumentu", () => {
    h.rows = [termRow({ external_url: "https://example.org/regulamin" })];
    renderuj();
    const link = within(wiersz("Zgoda na przetwarzanie danych")).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.org/regulamin");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("zgoda bez odnosnika nie ma w wierszu zadnego linku", () => {
    h.rows = [termRow({ external_url: BRAK_ODNOSNIKA })];
    renderuj();
    expect(within(wiersz("Zgoda na przetwarzanie danych")).queryByRole("link")).toBeNull();
  });
});

describe("usuniecie zgody - para „bez akceptacji moze / z akceptacjami nie moze”", () => {
  // AKCEPTACJA JEST DOWODEM, a dowodu sie nie kasuje. Baza odmawia
  // `term_in_use`, wiec przycisk przy zgodzie z akceptacjami obiecywalby
  // operacje konczaca sie zawsze odmowa. Poprawna operacja to WYLACZENIE.
  it("zgoda z akceptacjami NIE MA przycisku usuniecia", () => {
    h.rows = [termRow({ acceptances_total: 1 })];
    renderuj();
    expect(
      within(wiersz("Zgoda na przetwarzanie danych")).queryByLabelText(`${T}deleteAction`),
    ).toBeNull();
  });

  it("zgoda bez ani jednej akceptacji MA przycisk usuniecia", () => {
    h.rows = [termRow({ acceptances_total: 0 })];
    renderuj();
    expect(
      within(wiersz("Zgoda na przetwarzanie danych")).getByLabelText(`${T}deleteAction`),
    ).toBeTruthy();
  });

  // AKCEPTACJA WYCOFANA TEZ JEST AKCEPTACJA. `acceptances_total` liczy zgody
  // niewycofane, ale `withdrawn_count` to slad, ktory zostaje w bazie - i to
  // on decyduje o odmowie `term_in_use`. Dopoki licznik calkowity jest wiekszy
  // od zera, przycisku nie ma.
  it("zgoda z jedna akceptacja w starej wersji tez nie ma przycisku", () => {
    h.rows = [termRow({ version: 2, acceptances_total: 1, acceptances_current: 0 })];
    renderuj();
    expect(
      within(wiersz("Zgoda na przetwarzanie danych")).queryByLabelText(`${T}deleteAction`),
    ).toBeNull();
  });

  it("obie zgody zostaja EDYTOWALNE - wylaczenie jest alternatywa dla usuniecia", () => {
    h.rows = [termRow({ acceptances_total: 41 })];
    renderuj();
    expect(
      within(wiersz("Zgoda na przetwarzanie danych")).getByText(`${T}editAction`),
    ).toBeTruthy();
  });

  it("przycisk OTWIERA pytanie i sam z siebie niczego nie kasuje", () => {
    h.rows = [termRow()];
    renderuj();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(
      within(wiersz("Zgoda na przetwarzanie danych")).getByLabelText(`${T}deleteAction`),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(h.deleteIds).toEqual([]);
  });

  it("potwierdzenie kasuje TE zgode, nie pierwsza z listy", () => {
    h.rows = [
      termRow({ id: "zgoda-a", label_pl: "RODO" }),
      termRow({ id: "zgoda-b", label_pl: "Regulamin wydarzenia" }),
    ];
    renderuj();
    fireEvent.click(within(wiersz("Regulamin wydarzenia")).getByLabelText(`${T}deleteAction`));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: `${T}deleteAction` }),
    );
    expect(h.deleteIds).toEqual(["zgoda-b"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventTerms.toasts.termDeleted");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("wycofanie sie z pytania nie woła warstwy danych", () => {
    h.rows = [termRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Zgoda na przetwarzanie danych")).getByLabelText(`${T}deleteAction`),
    );
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText(`${T}dialog.cancelAction`));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.deleteIds).toEqual([]);
  });

  // WYSCIG Z RZECZYWISTOSCIA: akceptacja mogla powstac miedzy odczytem listy
  // a klikniciem. Odmowa `term_in_use` musi dojsc zdaniem, a wiersz zostac.
  it("odmowa `term_in_use` dochodzi zdaniem i zostawia wiersz na liscie", () => {
    h.rows = [termRow()];
    h.deleteFails = "term_in_use: 41 acceptance(s) recorded - deactivate instead";
    renderuj();
    fireEvent.click(
      within(wiersz("Zgoda na przetwarzanie danych")).getByLabelText(`${T}deleteAction`),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: `${T}deleteAction` }),
    );
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:term_in_use: 41 acceptance(s) recorded - deactivate instead",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(wiersz("Zgoda na przetwarzanie danych")).toBeTruthy();
  });
});

describe("formularz zgody", () => {
  it("na starcie formularz jest zamkniety", () => {
    h.rows = [termRow()];
    renderuj();
    expect(ostatnieOkno().open).toBe(false);
  });

  it("„Dodaj zgode” otwiera formularz BEZ wiersza (tryb zakladania)", () => {
    h.rows = [termRow()];
    renderuj();
    fireEvent.click(screen.getByText(`${T}createAction`));
    expect(ostatnieOkno()).toMatchObject({ open: true, termId: null });
  });

  it("olowek otwiera formularz nad TYM wierszem", () => {
    h.rows = [
      termRow({ id: "zgoda-a", label_pl: "RODO" }),
      termRow({ id: "zgoda-b", label_pl: "Regulamin wydarzenia" }),
    ];
    renderuj();
    fireEvent.click(within(wiersz("Regulamin wydarzenia")).getByText(`${T}editAction`));
    expect(ostatnieOkno()).toMatchObject({ open: true, termId: "zgoda-b" });
  });

  it("nowa zgoda dostaje kolejnosc o dziesiec wieksza niz najdalsza", () => {
    h.rows = [termRow({ id: "a", sort_order: 10 }), termRow({ id: "b", sort_order: 70 })];
    renderuj();
    expect(ostatnieOkno().nextSortOrder).toBe(80);
  });

  it("udany zapis zamyka formularz i mowi o tym", () => {
    h.rows = [termRow()];
    renderuj();
    fireEvent.click(screen.getByText(`${T}createAction`));
    fireEvent.click(screen.getByText("atrapa-zapisz"));
    expect(h.saveInputs).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventTerms.toasts.termSaved");
    expect(ostatnieOkno().open).toBe(false);
  });

  it("odmowa zapisu zostawia formularz otwarty i mowi trescia odmowy", () => {
    h.rows = [termRow()];
    h.saveFails = "invalid_labels: the label is required in both languages";
    renderuj();
    fireEvent.click(screen.getByText(`${T}createAction`));
    fireEvent.click(screen.getByText("atrapa-zapisz"));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:invalid_labels: the label is required in both languages",
    );
    expect(ostatnieOkno().open).toBe(true);
  });

  it("trwajacy zapis dochodzi do formularza", () => {
    h.rows = [termRow()];
    h.savePending = true;
    renderuj();
    fireEvent.click(screen.getByText(`${T}createAction`));
    expect(screen.getByText("atrapa-zapis-trwa:true")).toBeTruthy();
  });
});

describe("dostepnosc", () => {
  it("lista zgod nie ma naruszen dostepnosci", async () => {
    h.rows = [
      termRow({
        id: "a",
        label_pl: "RODO",
        external_url: "https://example.org/rodo",
        acceptances_total: 52,
        acceptances_current: 40,
        version: 2,
      }),
      termRow({ id: "b", label_pl: "Regulamin", is_required: false, is_active: false }),
    ];
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("pytanie o usuniecie nie ma naruszen dostepnosci", async () => {
    h.rows = [termRow()];
    const { container } = renderuj();
    fireEvent.click(
      within(wiersz("Zgoda na przetwarzanie danych")).getByLabelText(`${T}deleteAction`),
    );
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
