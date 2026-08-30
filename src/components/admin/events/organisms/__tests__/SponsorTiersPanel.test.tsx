// Organizm „POZIOMY SPONSORSKIE" - lista, na ktorej zapada kolejnosc logotypow
// na stronie wydarzenia i liczba miejsc do sprzedania.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJA CZTERY WIDOKI, a awaria NIE MOZE mowic „nie ma
//      zadnego poziomu": organizator zaklada wtedy DRUGI poziom o tym samym
//      kluczu i dostaje odmowe unikalnosci zamiast listy.
//   2. LICZNIKI STOJA W WIERSZU. `sponsors_count` i `slots_left` sa jedynym
//      miejscem, z ktorego organizator dowiaduje sie, czy usuniecie ma szanse
//      sie udac i ile firm jeszcze wejdzie - bez nich odmowa `tier_in_use`
//      czyta sie jak awaria.
//   3. POZIOM BEZ LIMITU MOWI TO WPROST, zamiast pokazywac „wolne miejsca: 0".
//   4. PRZELACZNIK „AKTYWNY" WYSYLA CALY WIERSZ, bo RPC zapisu jest upsertem.
//      To jest miejsce, w ktorym jedno klikniecie po cichu gubi KORZYSCI,
//      LIMIT FIRM, KOLOR AKCENTU albo ROZMIAR LOGOTYPU - dowodzimy tego pelnym
//      ladunkiem, a nie pojedynczym polem.
//   5. USUNIECIE JEST ZA POTWIERDZENIEM i idzie z identyfikatorem TEGO wiersza,
//      a odmowa `tier_in_use` konczy sie zdaniem, nie cisza.
//   6. ODMOWA ZAPISU NIE ZAMYKA FORMULARZA - inaczej redaktor traci wpisane
//      korzysci razem z komunikatem.
//   7. PODPOWIEDZI PORZADKOWE (kolejnosc, ranga) licza sie Z LISTY, nie z zera.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) FORMULARZA poziomu - ma wlasny plik
// `EventSponsorTierDialog.test.tsx`; tutaj jest atrapa i liczy sie STYK.
// (2) Slownika odmow bazy (`adminSponsorErrors.test.ts`). (3) Tabel konwersji
// szkicu (`sponsorDraft.test.ts`) - tutaj dowodzimy, ze przelacznik przepuszcza
// przez nie CALY wiersz i nic po drodze nie ginie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import type { EventSponsorTierRow, SponsorTierInput } from "@/lib/events/sponsorsApi";

/** Ksztalt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  zapisy: [] as unknown[],
  zapisBlad: null as unknown,
  zapisPending: false,
  kasowania: [] as string[],
  kasowanieBlad: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminSponsorErrors", () => ({
  adminSponsorErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Switch nie przelacza sie pod happy-dom bez pelnego pointer API,
// a przelacznik „aktywny" jest tu glowna akcja zapisu.
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

vi.mock("@/components/ui/alert-dialog", () => {
  const stan: { open: boolean; onOpenChange?: (open: boolean) => void } = { open: false };
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.onOpenChange = onOpenChange;
      return <div>{children}</div>;
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="alertdialog" aria-label="potwierdzenie">
          {children}
        </div>
      ) : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" onClick={() => stan.onOpenChange?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children?: ReactNode;
      onClick?: MouseEventHandler<HTMLButtonElement>;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Formularz poziomu ma WLASNY plik testowy. Tutaj liczy sie STYK: z czym panel
// go otwiera i co robi z ladunkiem.
vi.mock("@/components/admin/events/molecules/EventSponsorTierDialog", () => ({
  EventSponsorTierDialog: ({
    open,
    onOpenChange,
    eventId,
    tier,
    nextSortOrder,
    nextRank,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    tier: EventSponsorTierRow | null;
    nextSortOrder: number;
    nextRank: number;
    isSaving: boolean;
    onSubmit: (input: SponsorTierInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-poziomu"
        data-poziom={tier === null ? "nowy" : tier.id}
        data-kolejnosc={String(nextSortOrder)}
        data-ranga={String(nextRank)}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit({
              id: tier === null ? undefined : tier.id,
              eventId: tier === null ? eventId : undefined,
              namePl: "Platynowy",
              nameEn: "Platinum",
            })
          }
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsorTiers: () => ({ data: h.rows, isLoading: h.isLoading, error: h.listError }),
  useSaveSponsorTier: () => ({
    mutate: (input: SponsorTierInput, wynik?: Wynik<string>) => {
      h.zapisy.push(input);
      if (h.zapisBlad === null) wynik?.onSuccess?.("ok");
      else wynik?.onError?.(h.zapisBlad);
    },
    isPending: h.zapisPending,
  }),
  useDeleteSponsorTier: () => ({
    mutate: (id: string, wynik?: Wynik<boolean>) => {
      h.kasowania.push(id);
      if (h.kasowanieBlad === null) wynik?.onSuccess?.(true);
      else wynik?.onError?.(h.kasowanieBlad);
    },
    isPending: false,
  }),
}));

const { SponsorTiersPanel } = await import("@/components/admin/events/organisms/SponsorTiersPanel");

const T = "adminEventSponsors";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const POZIOM = "22222222-2222-4222-8222-222222222222";
const INNY_POZIOM = "33333333-3333-4333-8333-333333333333";

/**
 * Kolumny NULL-owalne, ktore GENERATOR typuje jako `string`/`number`.
 *
 * `admin_event_sponsor_tiers_list` oddaje `accent_color` jako NULL (poziom bez
 * koloru) i `max_companies` jako NULL - „bez limitu firm" jest WARTOSCIA, nie
 * brakiem danych, i wiersz musi umiec ja oddac.
 */
const BRAK_NAPISU = null as unknown as string;
const BEZ_LIMITU = null as unknown as number;

function poziom(overrides: Partial<EventSponsorTierRow> = {}): EventSponsorTierRow {
  return {
    accent_color: "#FA9346",
    benefits: [{ label_pl: "Logo na scenie", label_en: "Logo on stage", is_highlighted: true }],
    created_at: "2026-08-01T10:00:00.000Z",
    description_en: "Top tier",
    description_pl: "Poziom najwyzszy",
    event_id: WYDARZENIE,
    id: POZIOM,
    is_active: true,
    key: "gold",
    logo_size: "lg",
    max_companies: 3,
    name_en: "Gold",
    name_pl: "Zloty",
    published_sponsors_count: 1,
    rank: 1,
    slots_left: 1,
    sort_order: 10,
    sponsors_count: 2,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function panel() {
  return render(<SponsorTiersPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liscie poziomow`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });
const przelacznik = (index = 0): HTMLElement => within(wiersz(index)).getByRole("switch");
const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-poziomu" });
const okno = (): HTMLElement => screen.getByRole("alertdialog");
const ostatniZapis = (): SponsorTierInput => h.zapisy[h.zapisy.length - 1] as SponsorTierInput;

beforeEach(() => {
  h.lang = "pl";
  h.rows = [poziom()];
  h.isLoading = false;
  h.listError = null;
  h.zapisy = [];
  h.zapisBlad = null;
  h.zapisPending = false;
  h.kasowania = [];
  h.kasowanieBlad = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy poziomow", () => {
  it("zapytanie w locie mowi „wczytywanie” i nie rysuje ani jednego poziomu", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.tiers.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.tiers.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowe bazy i NIE mowi, ze poziomow nie ma", () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: brak dostepu");
    panel();

    expect(screen.getByText("odmowa:forbidden: brak dostepu")).toBeTruthy();
    expect(screen.queryByText(`${T}.tiers.empty`)).toBeNull();
  });

  it("brak poziomow to „pusto”, a nie awaria", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.tiers.empty`)).toBeTruthy();
  });

  it("brak awarii wyrazony jako `undefined` (nie `null`) tez nie jest awaria", () => {
    h.listError = undefined;
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.tiers.empty`)).toBeTruthy();
  });
});

describe("wiersz poziomu", () => {
  it("mowi nazwe w jezyku interfejsu i pokazuje klucz techniczny", () => {
    panel();

    expect(within(wiersz()).getByText("Zloty")).toBeTruthy();
    expect(within(wiersz()).getByText("gold")).toBeTruthy();
  });

  it("po angielsku nazwa jest angielska, a przy pustej wraca polska", () => {
    h.lang = "en";
    h.rows = [poziom(), poziom({ id: INNY_POZIOM, name_en: "" })];
    panel();

    expect(within(wiersz(0)).getByText("Gold")).toBeTruthy();
    expect(within(wiersz(1)).getByText("Zloty")).toBeTruthy();
  });

  it("pusta polska nazwa spada na angielska", () => {
    h.rows = [poziom({ name_pl: "" })];
    panel();

    expect(within(wiersz()).getByText("Gold")).toBeTruthy();
  });

  it("liczba przypietych firm stoi w wierszu - bez niej odmowa `tier_in_use` czyta sie jak awaria", () => {
    panel();

    expect(within(wiersz()).getByText(`${T}.tiers.sponsorsCount(count=2)`)).toBeTruthy();
  });

  it("poziom z limitem pokazuje WOLNE MIEJSCA, a poziom bez limitu mowi to wprost", () => {
    h.rows = [poziom(), poziom({ id: INNY_POZIOM, max_companies: BEZ_LIMITU })];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.tiers.slotsLeft(count=1)`)).toBeTruthy();
    expect(within(wiersz(1)).getByText(`${T}.labels.noLimit`)).toBeTruthy();
    expect(within(wiersz(1)).queryByText(`${T}.tiers.slotsLeft(count=1)`)).toBeNull();
  });

  it("poziom bez koloru akcentu nie wywraca wiersza", () => {
    h.rows = [poziom({ accent_color: BRAK_NAPISU })];
    panel();

    expect(within(wiersz()).getByText("Zloty")).toBeTruthy();
  });

  it("kolejnosc wierszy jest kolejnoscia z bazy - panel jej nie przestawia", () => {
    // Sortowanie robi RPC (`rank`, `sort_order`); sortowanie w pamieci
    // rozjechaloby liste panelu ze strona publiczna.
    h.rows = [
      poziom({ id: INNY_POZIOM, name_pl: "Srebrny", key: "silver", rank: 2 }),
      poziom({ name_pl: "Zloty", key: "gold", rank: 1 }),
    ];
    panel();

    expect(within(wiersz(0)).getByText("Srebrny")).toBeTruthy();
    expect(within(wiersz(1)).getByText("Zloty")).toBeTruthy();
  });
});

describe("przelacznik „poziom aktywny” wysyla CALY wiersz", () => {
  it("wylaczenie niesie komplet pol, nie sama flage", () => {
    // RPC zapisu jest upsertem: pole pominiete w ladunku to pole wyczyszczone
    // w bazie. Jedno klikniecie moze wiec po cichu skasowac korzysci i limit.
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis()).toEqual({
      id: POZIOM,
      eventId: undefined,
      key: undefined,
      namePl: "Zloty",
      nameEn: "Gold",
      descriptionPl: "Poziom najwyzszy",
      descriptionEn: "Top tier",
      rank: 1,
      accentColor: "#FA9346",
      logoSize: "lg",
      maxCompanies: 3,
      sortOrder: 10,
      isActive: false,
      benefits: [{ labelPl: "Logo na scenie", labelEn: "Logo on stage", isHighlighted: true }],
    });
  });

  it("wlaczenie wylaczonego poziomu idzie ta sama droga", () => {
    h.rows = [poziom({ is_active: false })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().isActive).toBe(true);
  });

  it("poziom BEZ limitu zostaje bez limitu - przelacznik nie wpisuje mu zera", () => {
    h.rows = [poziom({ max_companies: BEZ_LIMITU })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().maxCompanies).toBeNull();
  });

  it("poziom bez koloru zostaje bez koloru, a nie z pustym napisem", () => {
    h.rows = [poziom({ accent_color: BRAK_NAPISU })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().accentColor).toBeNull();
  });

  it("odmowa bazy przy przelaczniku konczy sie ZDANIEM, nie cisza", () => {
    h.zapisBlad = new Error("forbidden: brak uprawnien");
    panel();
    fireEvent.click(przelacznik());

    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: brak uprawnien");
  });

  it("przelacznik dotyka DOKLADNIE swojego wiersza", () => {
    h.rows = [poziom(), poziom({ id: INNY_POZIOM, name_pl: "Srebrny", key: "silver" })];
    panel();
    fireEvent.click(przelacznik(1));

    expect(ostatniZapis().id).toBe(INNY_POZIOM);
  });
});

describe("formularz poziomu - styk z panelem", () => {
  it("„Dodaj poziom” otwiera PUSTY formularz z podpowiedziana kolejnoscia i ranga", () => {
    h.rows = [
      poziom({ sort_order: 10, rank: 1 }),
      poziom({ id: INNY_POZIOM, sort_order: 40, rank: 3 }),
    ];
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTier`));

    expect(formularz()).toHaveAttribute("data-poziom", "nowy");
    expect(formularz()).toHaveAttribute("data-kolejnosc", "50");
    expect(formularz()).toHaveAttribute("data-ranga", "4");
  });

  it("pusta lista daje podpowiedzi od zera - pierwszy poziom nie startuje w prozni", () => {
    h.rows = [];
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTier`));

    expect(formularz()).toHaveAttribute("data-kolejnosc", "10");
    expect(formularz()).toHaveAttribute("data-ranga", "1");
  });

  it("olowek otwiera formularz TEGO wiersza", () => {
    h.rows = [poziom(), poziom({ id: INNY_POZIOM })];
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.tiers.dialog.editTitle` }));

    expect(formularz()).toHaveAttribute("data-poziom", INNY_POZIOM);
  });

  it("zapis w toku dojezdza do formularza - to on gasi swoje przyciski", () => {
    h.zapisPending = true;
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTier`));

    expect(formularz()).toHaveAttribute("data-zapis", "true");
  });

  it("udany zapis zamyka formularz i mowi o tym", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTier`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.tiers.toasts.saved`);
    expect(screen.queryByRole("dialog", { name: "formularz-poziomu" })).toBeNull();
  });

  it("ODMOWA ZAPISU NIE ZAMYKA formularza - wpisane korzysci zostaja na ekranie", () => {
    h.zapisBlad = new Error("invalid_key: klucz zajety");
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTier`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_key: klucz zajety");
    expect(formularz()).toBeTruthy();
  });

  it("zamkniecie formularza przez uzytkownika nie wysyla niczego", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTier`));
    fireEvent.click(screen.getByTestId("formularz-zamknij"));

    expect(screen.queryByRole("dialog", { name: "formularz-poziomu" })).toBeNull();
    expect(h.zapisy).toHaveLength(0);
  });
});

describe("usuniecie poziomu", () => {
  it("kosz nie kasuje od razu - najpierw pyta", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.tiers.deleteConfirm` }));

    expect(okno()).toBeTruthy();
    expect(h.kasowania).toHaveLength(0);
  });

  it("potwierdzenie kasuje TEN wiersz i mowi o tym", () => {
    h.rows = [poziom(), poziom({ id: INNY_POZIOM })];
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.tiers.deleteConfirm` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.tiers.dialog.saveAction` }));

    expect(h.kasowania).toEqual([INNY_POZIOM]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.tiers.toasts.deleted`);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("POZIOM Z PRZYPIETYMI FIRMAMI nie znika po cichu - odmowa `tier_in_use` jest zdaniem", () => {
    // Baza odmawia, dopoki do poziomu przypieta jest choc jedna firma. Bez tego
    // zdania organizator widzi „nic sie nie stalo" i klika jeszcze raz.
    h.kasowanieBlad = new Error("tier_in_use: 2 company(ies)");
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.tiers.deleteConfirm` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.tiers.dialog.saveAction` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:tier_in_use: 2 company(ies)");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rezygnacja z potwierdzenia nie kasuje niczego", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.tiers.deleteConfirm` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.tiers.dialog.cancelAction` }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.kasowania).toHaveLength(0);
  });
});

describe("dostepnosc", () => {
  it("lista poziomow nie ma naruszen axe", async () => {
    h.rows = [poziom(), poziom({ id: INNY_POZIOM, name_pl: "Srebrny", key: "silver" })];
    const { container } = panel();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan pusty i stan awarii tez nie maja naruszen axe", async () => {
    h.rows = [];
    const pusty = panel();
    const bezPoziomow = await axeViolations(pusty.container);
    expect(bezPoziomow, summarize(bezPoziomow)).toEqual([]);
    pusty.unmount();

    h.rows = undefined;
    h.listError = new Error("forbidden: brak dostepu");
    const awaria = panel();
    const naruszenia = await axeViolations(awaria.container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("przyciski wiersza maja nazwy - inaczej czytnik oglasza trzy bezimienne ikony", () => {
    panel();

    expect(
      within(wiersz()).getByRole("button", { name: `${T}.tiers.dialog.editTitle` }),
    ).toBeTruthy();
    expect(within(wiersz()).getByRole("button", { name: `${T}.tiers.deleteConfirm` })).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: przelacznik „poziom aktywny" dostaje w kazdym wierszu TE SAMA
  // etykiete. Molekula `AdminFormSwitchRow` ma nad soba komentarz wprost o tym
  // ryzyku („przelacznik bez powiazania z etykieta czytnik ekranu przy szesciu
  // wierszach mowi szesc razy to samo") - lista poziomow to ryzyko realizuje.
  // Osoba korzystajaca z czytnika slyszy N razy „Poziom aktywny" i nie wie,
  // KTORY poziom wlasnie zdejmuje ze strony publicznej. axe tego nie zlapie:
  // formalnie kazdy przelacznik MA nazwe. Etykieta powinna niesc nazwe poziomu.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: przelaczniki „aktywny” w dwoch wierszach maja IDENTYCZNA nazwe - czytnik nie mowi, ktorego poziomu dotycza",
    () => {
      h.rows = [poziom(), poziom({ id: INNY_POZIOM, name_pl: "Srebrny", key: "silver" })];
      panel();

      expect(przelacznik(0).getAttribute("id")).not.toBe(przelacznik(1).getAttribute("id"));
      expect(screen.getAllByLabelText(`${T}.tiers.dialog.isActive`)).toHaveLength(1);
    },
  );
});
