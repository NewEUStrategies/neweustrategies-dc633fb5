// Organizm „SPONSORZY I REKLAMA" - tablica sekcji sponsorów wydarzenia (karty
// z kolejnością), boczny panel edycji sekcji, okno dodawania sekcji, okno
// przypięcia sponsora i pod spodem reklamy strony głównej.
//
// CO TEN PLIK DOWODZI.
//   1. KOLEJNOŚĆ NA TABLICY TO `sort_order`, NIE KOLEJNOŚĆ Z BAZY - dotyczy
//      zarówno sekcji, jak i logotypów w sekcji. Logotyp trafia do SWOJEJ
//      sekcji, a obraz i nazwa biorą najpierw migawkę przypięcia, potem CRM.
//   2. TYTUŁ SEKCJI JEST W JĘZYKU PANELU, a pusta nazwa w tym języku spada na
//      drugą, zamiast rysować kartę bez tytułu.
//   3. UKŁAD SEKCJI POCHODZI Z OSOBNEGO ZAPYTANIA; sekcja, której tam nie ma
//      (albo zapytanie jeszcze w locie), jest siatką.
//   4. ZMIANA KOLEJNOŚCI WYSYŁA CAŁĄ LISTĘ na nowo ponumerowaną (co 10, ranga
//      od 1), bo RPC przestawia wszystkie wiersze naraz; odmowa kończy się
//      komunikatem. Ruch poza krawędź listy nie wysyła niczego.
//   5. NOWA SEKCJA DOSTAJE MIEJSCE NA KOŃCU i wielkość logo z układu (baner =
//      duże, siatka = średnie). Limitu firm tablica NIE wysyła (w obu układach
//      „bez limitu"): limit 1 banera ustawia baza przy zapisie układu, więc awaria
//      tego zapisu zostawia spójną siatkę, a nie siatkę z ukrytym limitem 1.
//      „Na końcu" liczy się od NAJWIĘKSZEJ kolejności i rangi (+10 / +1, ranga
//      nie ponad 1000), a nie od liczby sekcji - po usunięciu sekcji liczba
//      spada, a zajęte wartości zostają. Sekcja dostaje też klucz techniczny
//      z tytułu (bez diakrytyków, wolny w tym wydarzeniu), bez którego baza
//      odmawia (`invalid_key`).
//      Układ zapisuje się osobnym RPC, po nim odświeża się lista sekcji (limit
//      banera) i układy, i DOPIERO WTEDY otwiera się panel nowej sekcji -
//      inaczej panel pokazałby baner jako siatkę.
//      Odmowa zapisu SEKCJI zostawia okno dodawania otwarte. Gdy sekcja już
//      powstała, okno zamyka się OD RAZU (jeszcze przed zapisem układu), a awaria
//      układu kończy się panelem nowej sekcji i zdaniem „utworzona, układu nie
//      zapisano" - ponowne wysłanie okna tworzyło DRUGĄ sekcję o tym tytule.
//   6. PANEL SEKCJI DOSTAJE DANE TEJ SEKCJI: wiersz, układ, logotypy i mapę
//      przekierowań (pustą, gdy zapytanie w locie).
//   7. OKNO SPONSORA WIE, DLA KTÓREJ SEKCJI JEST: domyślna sekcja z panelu,
//      kolejność na końcu tej sekcji (za NAJWIĘKSZĄ kolejnością logotypów, nie
//      za ich liczbą), edytowany wiersz albo „nowy". Zapis zamyka okno, odmowa
//      zostawia je otwarte i mówi zdaniem z mapy odmów sponsorów (`tier_full`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Wnętrza okna dodawania sekcji
// (`AddSponsorSectionDialog`), panelu sekcji (`SponsorSectionDrawer`), okna
// sponsora (`EventSponsorDialog.test.tsx`) i reklam strony głównej
// (`EventHomeAdsPanel`) - mają własne testy; tutaj są atrapami i liczy się STYK:
// z jakimi danymi tablica je otwiera i co robi z tym, co oddają.
// (2) Rysowania karty - `molecules/__tests__/SponsorSectionCard.test.tsx`; tutaj
// karta jest PRAWDZIWA, bo przez jej przyciski organizator zmienia kolejność.
// (3) Warstwy RPC - hooki bazy i `setTierLayout` są atrapami. (4) Słownika odmów
// bazy (`lib/events/__tests__/adminSponsorErrors.test.ts`) - mapa jest atrapą
// oddającą `odmowa:<komunikat>`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";
import type { SponsorLogo } from "@/components/admin/events/molecules/SponsorSectionCard";
import type { NewSectionInput } from "@/components/admin/events/organisms/AddSponsorSectionDialog";
import type { SponsorLink, SponsorSectionLayout } from "@/lib/events/sponsorBoardApi";
import type {
  EventSponsorRow,
  EventSponsorTierRow,
  SponsorInput,
  SponsorOrderItem,
  SponsorTierInput,
  SponsorsQuery,
} from "@/lib/events/sponsorsApi";

/** Ksztalt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => unknown;
  onError?: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  /** Argumenty, z którymi tablica woła hooki bazy. */
  hooki: [] as string[],
  zapytaniaSponsorow: [] as SponsorsQuery[],
  sekcje: [] as EventSponsorTierRow[] | undefined,
  sponsorzy: [] as EventSponsorRow[] | undefined,
  uklady: undefined as Map<string, SponsorSectionLayout> | undefined,
  przekierowania: undefined as Map<string, SponsorLink> | undefined,
  /** Kolejność kroków tworzenia sekcji - zapis, układ, odświeżenia. */
  dziennik: [] as string[],
  zapisySekcji: [] as SponsorTierInput[],
  zapisSekcjiBlad: null as Error | null,
  zapisSekcjiPending: false,
  /** Wiersz, który „wraca z bazy" po zapisie nowej sekcji. */
  nowaSekcja: null as EventSponsorTierRow | null,
  /** Obietnica z `onSuccess` zapisu sekcji - test na nią czeka. */
  poZapisieSekcji: null as Promise<void> | null,
  ukladyZapisane: [] as { id: string; layout: SponsorSectionLayout }[],
  ukladBlad: null as Error | null,
  /** Gdy ustawione, zapis układu czeka na tę obietnicę (odpowiedź „w locie"). */
  ukladCzeka: null as Promise<void> | null,
  odswiezenieBlad: null as Error | null,
  kolejnosci: [] as SponsorOrderItem[][],
  kolejnoscBlad: null as Error | null,
  zapisySponsora: [] as SponsorInput[],
  zapisSponsoraBlad: null as Error | null,
  zapisSponsoraPending: false,
  /** Wejście z okna dodawania sekcji. */
  wejscieSekcji: { layout: "grid", namePl: "Partnerzy", nameEn: "Partners" } as NewSectionInput,
  /** Identyfikator, o którego edycję prosi szuflada „spoza" listy logotypów. */
  edycjaSpoza: "s-obcy",
  /** Karta-nakładka dokłada przycisk ruchu z pominięciem blokady krawędzi. */
  ruchPozaKrawedz: false,
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

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsorTiers: (eventId: string) => {
    h.hooki.push(`sekcje:${eventId}`);
    return {
      data: h.sekcje,
      refetch: async () => {
        h.dziennik.push("odswiezenie-sekcji");
        return { data: h.sekcje };
      },
    };
  },
  useSponsors: (query: SponsorsQuery) => {
    h.zapytaniaSponsorow.push(query);
    return { data: h.sponsorzy };
  },
  useSaveSponsorTier: (eventId: string) => {
    h.hooki.push(`zapisSekcji:${eventId}`);
    return {
      mutate: (input: SponsorTierInput, wynik?: Wynik<string>) => {
        h.dziennik.push("zapis-sekcji");
        h.zapisySekcji.push(input);
        if (h.zapisSekcjiBlad !== null) {
          wynik?.onError?.(h.zapisSekcjiBlad);
          return;
        }
        const nowa = h.nowaSekcja;
        if (nowa === null) throw new Error("test nie podał wiersza nowej sekcji");
        // Unieważnienie listy sekcji po zapisie: następny render widzi nowy wiersz.
        h.sekcje = [...(h.sekcje ?? []), nowa];
        h.poZapisieSekcji = Promise.resolve(wynik?.onSuccess?.(nowa.id)).then(() => undefined);
      },
      isPending: h.zapisSekcjiPending,
    };
  },
  useReorderSponsorTiers: (eventId: string) => {
    h.hooki.push(`kolejnosc:${eventId}`);
    return {
      mutate: (items: SponsorOrderItem[], wynik?: Wynik<number>) => {
        h.kolejnosci.push(items);
        if (h.kolejnoscBlad === null) wynik?.onSuccess?.(items.length);
        else wynik?.onError?.(h.kolejnoscBlad);
      },
    };
  },
  useSaveSponsor: (eventId: string) => {
    h.hooki.push(`zapisSponsora:${eventId}`);
    return {
      mutate: (input: SponsorInput, wynik?: Wynik<string>) => {
        h.zapisySponsora.push(input);
        if (h.zapisSponsoraBlad === null) wynik?.onSuccess?.("s-nowy");
        else wynik?.onError?.(h.zapisSponsoraBlad);
      },
      isPending: h.zapisSponsoraPending,
    };
  },
}));

vi.mock("@/lib/events/sponsorBoardApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/sponsorBoardApi")>()),
  useTierLayouts: (eventId: string) => {
    h.hooki.push(`uklady:${eventId}`);
    return {
      data: h.uklady,
      refetch: async () => {
        h.dziennik.push("odswiezenie-ukladow");
        if (h.odswiezenieBlad !== null) throw h.odswiezenieBlad;
        // Odświeżenie przynosi układ zapisany przed chwilą.
        const nowe = new Map(h.uklady ?? []);
        for (const zapis of h.ukladyZapisane) {
          nowe.set(zapis.id, zapis.layout);
        }
        h.uklady = nowe;
        return { data: nowe };
      },
    };
  },
  useSponsorLinks: (eventId: string) => {
    h.hooki.push(`przekierowania:${eventId}`);
    return { data: h.przekierowania };
  },
  setTierLayout: async (input: { id: string; layout: SponsorSectionLayout }) => {
    h.dziennik.push(`uklad:${input.id}:${input.layout}`);
    if (h.ukladCzeka !== null) await h.ukladCzeka;
    if (h.ukladBlad !== null) throw h.ukladBlad;
    h.ukladyZapisane.push(input);
    return true;
  },
}));

// Karta jest PRAWDZIWA. Nakładka dokłada - tylko na żądanie testu - przycisk,
// który woła ruch z pominięciem blokady krawędzi (zgaszonych przycisków karty),
// żeby sprawdzić, że tablica sama pilnuje granic listy.
vi.mock("@/components/admin/events/molecules/SponsorSectionCard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/admin/events/molecules/SponsorSectionCard")>();
  return {
    ...actual,
    SponsorSectionCard: (props: ComponentProps<typeof actual.SponsorSectionCard>) => (
      <>
        <actual.SponsorSectionCard {...props} />
        {h.ruchPozaKrawedz ? (
          <button type="button" onClick={() => props.onMove(props.isFirst ? -1 : 1)}>
            {`ruch poza krawędź: ${props.title}`}
          </button>
        ) : null}
      </>
    ),
  };
});

vi.mock("@/components/admin/events/organisms/EventHomeAdsPanel", () => ({
  EventHomeAdsPanel: ({ eventId }: { eventId: string }) => (
    <div data-testid="reklamy" data-wydarzenie={eventId} />
  ),
}));

vi.mock("@/components/admin/events/organisms/AddSponsorSectionDialog", () => ({
  AddSponsorSectionDialog: ({
    open,
    onOpenChange,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isSaving: boolean;
    onSubmit: (input: NewSectionInput) => void;
  }) =>
    !open ? null : (
      <div role="dialog" aria-label="dodawanie-sekcji" data-zapis={String(isSaving)}>
        <button type="button" onClick={() => onSubmit(h.wejscieSekcji)}>
          dodawanie-zapisz
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          dodawanie-zamknij
        </button>
      </div>
    ),
}));

// Panel sekcji jest atrapą zawsze obecną w drzewie (jak `Sheet`, który trzyma
// treść w portalu także w trakcie zamykania) - liczy się, z czym tablica go
// karmi i co robi z jego prośbami.
vi.mock("@/components/admin/events/organisms/SponsorSectionDrawer", () => ({
  SponsorSectionDrawer: ({
    eventId,
    tier,
    layout,
    logos,
    links,
    onOpenChange,
    onAddSponsor,
    onEditSponsor,
  }: {
    eventId: string;
    tier: EventSponsorTierRow | null;
    layout: SponsorSectionLayout;
    logos: SponsorLogo[];
    links: Map<string, SponsorLink>;
    onOpenChange: (open: boolean) => void;
    onAddSponsor: (tierId: string) => void;
    onEditSponsor: (sponsorId: string) => void;
  }) => (
    <aside
      aria-label="panel-sekcji"
      data-wydarzenie={eventId}
      data-sekcja={tier === null ? "brak" : tier.id}
      data-uklad={layout}
      data-logotypy={logos.map((l) => `${l.id}=${l.name}=${l.logoUrl}`).join("|")}
      data-przekierowania={[...links.keys()].join("|")}
    >
      <button type="button" onClick={() => onOpenChange(false)}>
        panel-zamknij
      </button>
      <button type="button" onClick={() => onOpenChange(true)}>
        panel-sygnal-otwarcia
      </button>
      {tier === null ? null : (
        <button type="button" onClick={() => onAddSponsor(tier.id)}>
          panel-dodaj-sponsora
        </button>
      )}
      {logos.map((l) => (
        <button key={l.id} type="button" onClick={() => onEditSponsor(l.id)}>
          {`panel-edytuj ${l.name}`}
        </button>
      ))}
      <button type="button" onClick={() => onEditSponsor(h.edycjaSpoza)}>
        panel-edytuj-spoza
      </button>
    </aside>
  ),
}));

vi.mock("@/components/admin/events/molecules/EventSponsorDialog", () => ({
  EventSponsorDialog: ({
    open,
    onOpenChange,
    eventId,
    sponsor,
    tiers,
    defaultTierId,
    nextSortOrder,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    sponsor: EventSponsorRow | null;
    tiers: EventSponsorTierRow[];
    defaultTierId?: string;
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: SponsorInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="okno-sponsora"
        data-wydarzenie={eventId}
        data-sponsor={sponsor === null ? "nowy" : sponsor.id}
        data-sekcja={defaultTierId ?? "brak"}
        data-kolejnosc={String(nextSortOrder)}
        data-sekcje={tiers.map((tier) => tier.id).join("|")}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          onClick={() =>
            onSubmit({ eventId, tierId: defaultTierId, sortOrder: nextSortOrder, companyId: "c9" })
          }
        >
          sponsor-zapisz
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          sponsor-zamknij
        </button>
        <button type="button" onClick={() => onOpenChange(true)}>
          sponsor-sygnal-otwarcia
        </button>
      </div>
    ),
}));

const { SponsorSectionsBoard } =
  await import("@/components/admin/events/organisms/SponsorSectionsBoard");

// Fixture'y niosą znaczniki czasu wyliczone od `FIXED_NOW` - zegar zamrożony.
freezeClock();

const S = "sponsorBoard.sponsors";
const WYDARZENIE = "ev-forum";

function sekcja(patch: Partial<EventSponsorTierRow> = {}): EventSponsorTierRow {
  return {
    accent_color: "#FA9346",
    benefits: [],
    created_at: relativeIso(-30 * DZIEN),
    description_en: "",
    description_pl: "",
    event_id: WYDARZENIE,
    id: "t-zloto",
    is_active: true,
    key: "zloto",
    logo_size: "md",
    max_companies: 5,
    name_en: "Gold partners",
    name_pl: "Złoci partnerzy",
    published_sponsors_count: 0,
    rank: 1,
    slots_left: 5,
    sort_order: 10,
    sponsors_count: 0,
    updated_at: relativeIso(-DZIEN),
    ...patch,
  };
}

function sponsor(patch: Partial<EventSponsorRow> = {}): EventSponsorRow {
  return {
    booth_label: "",
    company_id: "c1",
    contacts_count: 0,
    created_at: relativeIso(-10 * DZIEN),
    crm_city: "",
    crm_country: "PL",
    crm_drift: false,
    crm_drift_fields: [],
    crm_logo_url: "https://cdn.example.org/crm-alfa.png",
    crm_name: "Alfa (CRM)",
    crm_website: "https://alfa.example.org",
    event_id: WYDARZENIE,
    id: "s-alfa",
    is_published: true,
    materials_count: 0,
    published_materials_count: 0,
    role: "sponsor",
    snapshot_country: "PL",
    snapshot_description_en: "",
    snapshot_description_pl: "",
    snapshot_logo_url: "https://cdn.example.org/alfa.png",
    snapshot_name: "Alfa Energia",
    snapshot_source: "crm",
    snapshot_taken_at: relativeIso(-10 * DZIEN),
    snapshot_website: "https://alfa.example.org",
    sort_order: 10,
    tier_accent_color: "#FA9346",
    tier_id: "t-zloto",
    tier_key: "zloto",
    tier_logo_size: "md",
    tier_name_en: "Gold partners",
    tier_name_pl: "Złoci partnerzy",
    tier_rank: 1,
    total_count: 1,
    updated_at: relativeIso(-DZIEN),
    ...patch,
  };
}

/** Trzy sekcje podane z bazy NIE w kolejności `sort_order`. */
function trzySekcje(): EventSponsorTierRow[] {
  return [
    sekcja({
      id: "t-media",
      name_pl: "Patroni medialni",
      name_en: "Media partners",
      sort_order: 30,
    }),
    sekcja(),
    sekcja({
      id: "t-srebro",
      name_pl: "Srebrni partnerzy",
      name_en: "Silver partners",
      sort_order: 20,
    }),
  ];
}

function tablica() {
  return render(<SponsorSectionsBoard eventId={WYDARZENIE} />);
}

const tytulyKart = (): string[] =>
  screen.queryAllByRole("heading", { level: 4 }).map((el) => el.textContent ?? "");

const karta = (tytul: string): HTMLElement => {
  const naglowek = screen.getByRole("heading", { level: 4, name: tytul });
  const found = naglowek.closest("section");
  if (found === null) throw new Error(`brak karty „${tytul}"`);
  return found;
};

const przycisk = (nazwa: string, w: HTMLElement = document.body): HTMLElement =>
  within(w).getByRole("button", { name: nazwa });

const panel = (): HTMLElement => screen.getByRole("complementary", { name: "panel-sekcji" });
const oknoSponsora = (): HTMLElement => screen.getByRole("dialog", { name: "okno-sponsora" });
const oknoDodawania = (): HTMLElement => screen.getByRole("dialog", { name: "dodawanie-sekcji" });

function kliknij(element: HTMLElement): void {
  act(() => {
    fireEvent.click(element);
  });
}

/** Kliknięcie „zapisz" w oknie dodawania i odczekanie całego `onSuccess`. */
async function utworzSekcje(): Promise<void> {
  await act(async () => {
    fireEvent.click(przycisk("dodawanie-zapisz"));
    await h.poZapisieSekcji;
  });
}

function otworzPanel(tytul: string): void {
  kliknij(przycisk(`${S}.edit: ${tytul}`));
}

beforeEach(() => {
  h.lang = "pl";
  h.hooki = [];
  h.zapytaniaSponsorow = [];
  h.sekcje = [sekcja()];
  h.sponsorzy = [];
  h.uklady = new Map();
  h.przekierowania = new Map();
  h.dziennik = [];
  h.zapisySekcji = [];
  h.zapisSekcjiBlad = null;
  h.zapisSekcjiPending = false;
  h.nowaSekcja = sekcja({
    id: "t-nowa",
    name_pl: "Partnerzy",
    name_en: "Partners",
    sort_order: 20,
  });
  h.poZapisieSekcji = null;
  h.ukladyZapisane = [];
  h.ukladBlad = null;
  h.ukladCzeka = null;
  h.odswiezenieBlad = null;
  h.kolejnosci = [];
  h.kolejnoscBlad = null;
  h.zapisySponsora = [];
  h.zapisSponsoraBlad = null;
  h.zapisSponsoraPending = false;
  h.wejscieSekcji = { layout: "grid", namePl: "Partnerzy", nameEn: "Partners" };
  h.edycjaSpoza = "s-obcy";
  h.ruchPozaKrawedz = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("lista sekcji", () => {
  it("wszystkie zapytania i mutacje dotyczą TEGO wydarzenia, a reklamy dostają jego identyfikator", () => {
    tablica();
    expect(new Set(h.hooki)).toEqual(
      new Set([
        `sekcje:${WYDARZENIE}`,
        `uklady:${WYDARZENIE}`,
        `przekierowania:${WYDARZENIE}`,
        `zapisSekcji:${WYDARZENIE}`,
        `kolejnosc:${WYDARZENIE}`,
        `zapisSponsora:${WYDARZENIE}`,
      ]),
    );
    expect(h.zapytaniaSponsorow[0]).toEqual({ eventId: WYDARZENIE, limit: 500 });
    expect(screen.getByTestId("reklamy").getAttribute("data-wydarzenie")).toBe(WYDARZENIE);
    expect(screen.getByRole("heading", { level: 3, name: `${S}.title` })).toBeTruthy();
    expect(screen.getByText(`${S}.lead`)).toBeTruthy();
  });

  it("brak sekcji mówi, że ich nie ma, i nie rysuje żadnej karty", () => {
    h.sekcje = [];
    tablica();
    expect(screen.getByText(`${S}.empty`)).toBeTruthy();
    expect(tytulyKart()).toEqual([]);
  });

  it("zapytanie w locie (brak danych) to też pusta tablica, a nie awaria", () => {
    h.sekcje = undefined;
    h.sponsorzy = undefined;
    h.uklady = undefined;
    h.przekierowania = undefined;
    tablica();
    expect(screen.getByText(`${S}.empty`)).toBeTruthy();
    expect(panel().getAttribute("data-przekierowania")).toBe("");
  });

  it("sekcje stoją w kolejności `sort_order`, a nie w kolejności z bazy", () => {
    h.sekcje = trzySekcje();
    tablica();
    expect(screen.queryByText(`${S}.empty`)).toBeNull();
    expect(tytulyKart()).toEqual(["Złoci partnerzy", "Srebrni partnerzy", "Patroni medialni"]);
  });

  it("po angielsku tytuły sekcji są angielskie", () => {
    h.lang = "en";
    h.sekcje = trzySekcje();
    tablica();
    expect(tytulyKart()).toEqual(["Gold partners", "Silver partners", "Media partners"]);
  });

  it("pusta nazwa polska spada na angielską", () => {
    h.sekcje = [sekcja({ name_pl: "" })];
    tablica();
    expect(tytulyKart()).toEqual(["Gold partners"]);
  });

  it("po angielsku pusta nazwa angielska spada na polską", () => {
    h.lang = "en";
    h.sekcje = [sekcja({ name_en: "" })];
    tablica();
    expect(tytulyKart()).toEqual(["Złoci partnerzy"]);
  });

  it("układ sekcji pochodzi z zapytania układów, a sekcja spoza niego jest siatką", () => {
    h.sekcje = trzySekcje();
    h.uklady = new Map([["t-srebro", "banner"]]);
    tablica();
    expect(within(karta("Srebrni partnerzy")).getByText(`${S}.banner`)).toBeTruthy();
    expect(within(karta("Złoci partnerzy")).getByText(`${S}.grid`)).toBeTruthy();
    expect(within(karta("Patroni medialni")).getByText(`${S}.grid`)).toBeTruthy();
  });

  it("zapytanie układów w locie rysuje każdą sekcję jako siatkę", () => {
    h.sekcje = trzySekcje();
    h.uklady = undefined;
    tablica();
    expect(screen.getAllByText(`${S}.grid`)).toHaveLength(3);
    expect(screen.queryByText(`${S}.banner`)).toBeNull();
  });

  it("logotypy trafiają do SWOICH sekcji w kolejności `sort_order`", () => {
    h.sekcje = trzySekcje();
    h.sponsorzy = [
      sponsor({ id: "s-beta", snapshot_name: "Beta Logistyka", sort_order: 30 }),
      sponsor({ id: "s-media", snapshot_name: "Radio Wschód", tier_id: "t-media" }),
      sponsor({ id: "s-alfa", snapshot_name: "Alfa Energia", sort_order: 10 }),
      sponsor({ id: "s-gamma", snapshot_name: "Gamma Bank", sort_order: 20 }),
    ];
    tablica();
    const alt = (tytul: string) =>
      within(karta(tytul))
        .queryAllByRole("img")
        .map((el) => el.getAttribute("alt"));
    expect(alt("Złoci partnerzy")).toEqual(["Alfa Energia", "Gamma Bank", "Beta Logistyka"]);
    expect(alt("Patroni medialni")).toEqual(["Radio Wschód"]);
    expect(within(karta("Srebrni partnerzy")).getByText(`${S}.noLogos`)).toBeTruthy();
  });

  it("logotyp bierze nazwę i obraz z migawki, a gdy migawka pusta - z CRM", () => {
    h.sponsorzy = [
      sponsor(),
      sponsor({ id: "s-crm", snapshot_name: "", snapshot_logo_url: "", sort_order: 20 }),
    ];
    tablica();
    const obrazy = within(karta("Złoci partnerzy")).getAllByRole("img");
    expect(obrazy.map((el) => [el.getAttribute("alt"), el.getAttribute("src")])).toEqual([
      ["Alfa Energia", "https://cdn.example.org/alfa.png"],
      ["Alfa (CRM)", "https://cdn.example.org/crm-alfa.png"],
    ]);
  });

  it("brak listy sponsorów (zapytanie w locie) zostawia każdą sekcję bez logotypów", () => {
    h.sekcje = trzySekcje();
    h.sponsorzy = undefined;
    tablica();
    expect(screen.getAllByText(`${S}.noLogos`)).toHaveLength(3);
  });

  it("pierwsza sekcja nie jedzie wyżej, ostatnia nie zjeżdża niżej", () => {
    h.sekcje = trzySekcje();
    tablica();
    const zgaszone = (tytul: string) =>
      [`${S}.moveUp`, `${S}.moveDown`].map((nazwa) =>
        przycisk(nazwa, karta(tytul)).hasAttribute("disabled"),
      );
    expect(zgaszone("Złoci partnerzy")).toEqual([true, false]);
    expect(zgaszone("Srebrni partnerzy")).toEqual([false, false]);
    expect(zgaszone("Patroni medialni")).toEqual([false, true]);
  });

  it("tablica z kartami nie ma naruszeń dostępności", async () => {
    h.sekcje = trzySekcje();
    h.sponsorzy = [sponsor(), sponsor({ id: "s-bez", snapshot_logo_url: "", crm_logo_url: "" })];
    const { container } = tablica();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("zmiana kolejności sekcji", () => {
  it("zjazd pierwszej sekcji wysyła CAŁĄ listę na nowo ponumerowaną", () => {
    h.sekcje = trzySekcje();
    tablica();
    kliknij(przycisk(`${S}.moveDown`, karta("Złoci partnerzy")));
    expect(h.kolejnosci).toEqual([
      [
        { id: "t-srebro", sortOrder: 10, rank: 1 },
        { id: "t-zloto", sortOrder: 20, rank: 2 },
        { id: "t-media", sortOrder: 30, rank: 3 },
      ],
    ]);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("podjazd ostatniej sekcji zamienia ją z poprzednią", () => {
    h.sekcje = trzySekcje();
    tablica();
    kliknij(przycisk(`${S}.moveUp`, karta("Patroni medialni")));
    expect(h.kolejnosci).toEqual([
      [
        { id: "t-zloto", sortOrder: 10, rank: 1 },
        { id: "t-media", sortOrder: 20, rank: 2 },
        { id: "t-srebro", sortOrder: 30, rank: 3 },
      ],
    ]);
  });

  it("odmowa zmiany kolejności kończy się komunikatem błędu", () => {
    h.sekcje = trzySekcje();
    h.kolejnoscBlad = new Error("rpc");
    tablica();
    kliknij(przycisk(`${S}.moveUp`, karta("Srebrni partnerzy")));
    expect(h.kolejnosci).toHaveLength(1);
    expect(h.toastError).toHaveBeenCalledWith("sponsorBoard.toasts.error");
  });

  it("ruch poza krawędź listy (z pominięciem zgaszonych przycisków) nie wysyła niczego", () => {
    h.sekcje = trzySekcje();
    h.ruchPozaKrawedz = true;
    tablica();
    kliknij(przycisk("ruch poza krawędź: Złoci partnerzy"));
    kliknij(przycisk("ruch poza krawędź: Patroni medialni"));
    expect(h.kolejnosci).toEqual([]);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("dodawanie sekcji", () => {
  it("przycisk tworzenia otwiera okno, a okno widzi stan zapisu", () => {
    h.zapisSekcjiPending = true;
    tablica();
    expect(screen.queryByRole("dialog", { name: "dodawanie-sekcji" })).toBeNull();
    kliknij(przycisk(`${S}.create`));
    expect(oknoDodawania().getAttribute("data-zapis")).toBe("true");
  });

  it("zamknięcie okna dodawania nie zapisuje niczego", () => {
    tablica();
    kliknij(przycisk(`${S}.create`));
    kliknij(przycisk("dodawanie-zamknij"));
    expect(screen.queryByRole("dialog", { name: "dodawanie-sekcji" })).toBeNull();
    expect(h.zapisySekcji).toEqual([]);
  });

  it("siatka ląduje na końcu listy ze średnim logo i bez limitu firm", async () => {
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toEqual([
      {
        eventId: WYDARZENIE,
        key: "partnerzy",
        namePl: "Partnerzy",
        nameEn: "Partners",
        rank: 2,
        sortOrder: 20,
        logoSize: "md",
        maxCompanies: null,
      },
    ]);
    expect(h.ukladyZapisane).toEqual([{ id: "t-nowa", layout: "grid" }]);
  });

  // ZMIANA: ten przypadek twierdził, że baner wysyła `maxCompanies: 1`. Limit
  // banera ustawia dziś BAZA przy zapisie układu (`admin_event_sponsor_tier_set_layout`,
  // 20260923100100). Wysłany z tablicy zostawał w wierszu także wtedy, gdy zapis
  // układu padł - a wtedy sekcja była siatką z ukrytym limitem 1 i druga firma
  // odbijała się od `tier_full` (patrz przypadek z awarią układu banera niżej).
  it("baner dostaje duże logo, a limit JEDNEJ firmy zostawia bazie (zapis układu)", async () => {
    h.sekcje = trzySekcje();
    h.wejscieSekcji = { layout: "banner", namePl: "Sponsor główny", nameEn: "Main sponsor" };
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toEqual([
      {
        eventId: WYDARZENIE,
        key: "sponsor_glowny",
        namePl: "Sponsor główny",
        nameEn: "Main sponsor",
        // ZMIANA: było 4 (liczba sekcji + 1). Ranga idzie dziś od NAJWIĘKSZEJ
        // rangi, a wszystkie trzy sekcje z `trzySekcje()` mają rangę 1.
        rank: 2,
        sortOrder: 40,
        logoSize: "lg",
        maxCompanies: null,
      },
    ]);
    expect(h.ukladyZapisane).toEqual([{ id: "t-nowa", layout: "banner" }]);
  });

  it("pierwsza sekcja wydarzenia dostaje rangę 1 i kolejność 10", async () => {
    h.sekcje = [];
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toMatchObject([{ rank: 1, sortOrder: 10 }]);
  });

  // REGRESJA: numeracja szła od LICZBY sekcji (`(n + 1) * 10`, ranga `n + 1`).
  // Po usunięciu sekcji ze środka dwie pozostałe (10 i 30, rangi 1 i 3) dawały
  // nowej kolejność 30 i rangę 3 - te same, co ostatnia istniejąca.
  it("po usunięciu sekcji ze środka nowa staje ZA największą kolejnością i rangą", async () => {
    h.sekcje = [
      sekcja({ id: "t-a", key: "a_1", sort_order: 30, rank: 3 }),
      sekcja({ id: "t-b", key: "b_1", sort_order: 10, rank: 1 }),
    ];
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toMatchObject([{ rank: 4, sortOrder: 40 }]);
  });

  it("największa kolejność i ranga liczą się niezależnie (sekcje spoza tablicy)", async () => {
    h.sekcje = [
      sekcja({ id: "t-a", key: "a_1", sort_order: 90, rank: 2 }),
      sekcja({ id: "t-b", key: "b_1", sort_order: 20, rank: 70 }),
    ];
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toMatchObject([{ rank: 71, sortOrder: 100 }]);
  });

  it("ranga nowej sekcji nie przekracza górnej granicy bazy (1000)", async () => {
    h.sekcje = [sekcja({ rank: 1000 })];
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toMatchObject([{ rank: 1000, sortOrder: 20 }]);
  });

  // REGRESJA: tablica nie wysyłała klucza, a `admin_event_sponsor_tier_save`
  // odmawia nowego poziomu bez klucza `^[a-z][a-z0-9_]{1,48}$` (`invalid_key`).
  it.each<[string, string, string[], string]>([
    ["tytuł z diakrytykami", "Złoci Partnerzy 2026!", [], "zloci_partnerzy_2026"],
    ["klucz zajęty w wydarzeniu", "Partnerzy", ["partnerzy"], "partnerzy_2"],
    ["kolejne zajęte klucze", "Partnerzy", ["partnerzy", "partnerzy_2"], "partnerzy_3"],
    ["tytuł od cyfry", "2026", [], "sekcja_2026"],
    ["jednoliterowy tytuł", "A", [], "sekcja_a"],
    ["tytuł bez liter i cyfr", "!!!", [], "sekcja"],
    ["zajęty klucz zastępczy", "***", ["sekcja"], "sekcja_2"],
    [
      "długi tytuł",
      "Partnerzy strategiczni programu gospodarczego",
      [],
      "partnerzy_strategiczni_programu",
    ],
  ])("%s daje klucz techniczny, który baza przyjmie", async (_nazwa, tytul, zajete, klucz) => {
    h.sekcje = zajete.map((key, i) => sekcja({ id: `t-${key}`, key, sort_order: (i + 1) * 10 }));
    h.wejscieSekcji = { layout: "grid", namePl: tytul, nameEn: "Partners" };
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toMatchObject([{ key: klucz }]);
    expect(klucz).toMatch(/^[a-z][a-z0-9_]{1,48}$/);
  });

  // ZMIANA: dziennik dostał krok „odswiezenie-sekcji". Zapis banera ustawia
  // w bazie limit 1, a lista sekcji odświeżona po samym zapisie sekcji (jeszcze
  // bez limitu) pokazywałaby w panelu poziomów „bez limitu" dla banera.
  it("po zapisie: układ, odświeżenie sekcji i układów, komunikat - i DOPIERO WTEDY panel nowej sekcji", async () => {
    h.wejscieSekcji = { layout: "banner", namePl: "Partnerzy", nameEn: "Partners" };
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.dziennik).toEqual([
      "zapis-sekcji",
      "uklad:t-nowa:banner",
      "odswiezenie-sekcji",
      "odswiezenie-ukladow",
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("sponsorBoard.toasts.sectionCreated");
    expect(screen.queryByRole("dialog", { name: "dodawanie-sekcji" })).toBeNull();
    expect(panel().getAttribute("data-sekcja")).toBe("t-nowa");
    expect(panel().getAttribute("data-uklad")).toBe("banner");
    expect(tytulyKart()).toEqual(["Złoci partnerzy", "Partnerzy"]);
  });

  it("odmowa zapisu sekcji zostawia okno otwarte i nie rusza układu", async () => {
    h.zapisSekcjiBlad = new Error("duplicate");
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.toastError).toHaveBeenCalledWith("sponsorBoard.toasts.error");
    expect(h.dziennik).toEqual(["zapis-sekcji"]);
    expect(oknoDodawania()).toBeTruthy();
    expect(panel().getAttribute("data-sekcja")).toBe("brak");
  });

  // ZMIANA (REGRESJA): te dwa przypadki twierdziły, że po awarii układu okno
  // dodawania ZOSTAJE otwarte, bez panelu i z ogólnym błędem. Sekcja była wtedy
  // już zapisana, więc ponowne „Dodaj" tworzyło DRUGĄ sekcję o tym samym tytule.
  // Dziś okno znika, otwiera się panel nowej sekcji (tam przełącza się układ),
  // a komunikat mówi, że sekcja powstała, ale układu nie zapisano.
  it("odmowa zapisu układu: okno znika, panel nowej sekcji, zdanie „utworzona, bez układu”", async () => {
    h.ukladBlad = new Error("rpc");
    h.wejscieSekcji = { layout: "banner", namePl: "Partnerzy", nameEn: "Partners" };
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.dziennik).toEqual(["zapis-sekcji", "uklad:t-nowa:banner"]);
    expect(h.toastError).toHaveBeenCalledWith("sponsorBoard.toasts.sectionCreatedLayoutFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "dodawanie-sekcji" })).toBeNull();
    expect(panel().getAttribute("data-sekcja")).toBe("t-nowa");
    // Układ w bazie to nadal domyślna siatka - panel mówi prawdę.
    expect(panel().getAttribute("data-uklad")).toBe("grid");
    expect(h.zapisySekcji).toHaveLength(1);
  });

  // REGRESJA: baner szedł do bazy z `maxCompanies: 1` jeszcze PRZED zapisem
  // układu. Gdy ten zapis padł, w bazie zostawała siatka z limitem 1 - panel
  // pokazywał siatkę (wiele logotypów), a druga firma odbijała się od
  // `tier_full`. Kliknięcie „siatka" limitu nie czyściło, bo baza zdejmuje go
  // tylko przy przejściu Z banera. Tablica nie wysyła więc limitu wcale - limit
  // 1 powstaje w bazie razem z układem banera albo nie powstaje w ogóle.
  it("awaria zapisu układu banera nie zostawia siatki z ukrytym limitem 1", async () => {
    h.ukladBlad = new Error("rpc");
    h.wejscieSekcji = { layout: "banner", namePl: "Sponsor główny", nameEn: "Main sponsor" };
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.zapisySekcji).toHaveLength(1);
    expect(h.zapisySekcji[0]?.maxCompanies).toBeNull();
    expect(h.zapisySekcji[0]?.logoSize).toBe("lg");
    expect(panel().getAttribute("data-uklad")).toBe("grid");
  });

  it("awaria odświeżenia układów: okno znika, panel nowej sekcji, zdanie „utworzona, bez układu”", async () => {
    h.odswiezenieBlad = new Error("network");
    tablica();
    kliknij(przycisk(`${S}.create`));
    await utworzSekcje();
    expect(h.dziennik).toEqual([
      "zapis-sekcji",
      "uklad:t-nowa:grid",
      "odswiezenie-sekcji",
      "odswiezenie-ukladow",
    ]);
    expect(h.toastError).toHaveBeenCalledWith("sponsorBoard.toasts.sectionCreatedLayoutFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "dodawanie-sekcji" })).toBeNull();
    expect(panel().getAttribute("data-sekcja")).toBe("t-nowa");
    expect(h.zapisySekcji).toHaveLength(1);
  });

  it("okno dodawania znika, zanim zapis układu wróci - drugiego wysłania nie ma skąd zrobić", async () => {
    let wypusc: () => void = () => {};
    h.ukladCzeka = new Promise<void>((resolve) => {
      wypusc = resolve;
    });
    tablica();
    kliknij(przycisk(`${S}.create`));
    act(() => {
      fireEvent.click(przycisk("dodawanie-zapisz"));
    });
    expect(h.dziennik).toEqual(["zapis-sekcji", "uklad:t-nowa:grid"]);
    expect(screen.queryByRole("dialog", { name: "dodawanie-sekcji" })).toBeNull();
    expect(panel().getAttribute("data-sekcja")).toBe("brak");
    await act(async () => {
      wypusc();
      await h.poZapisieSekcji;
    });
    expect(h.zapisySekcji).toHaveLength(1);
    expect(panel().getAttribute("data-sekcja")).toBe("t-nowa");
    expect(h.toastSuccess).toHaveBeenCalledWith("sponsorBoard.toasts.sectionCreated");
  });
});

describe("panel sekcji", () => {
  beforeEach(() => {
    h.sekcje = trzySekcje();
    h.uklady = new Map([["t-srebro", "banner"]]);
    h.przekierowania = new Map([
      ["s-alfa", { mode: "external", url: "https://alfa.example.org" }],
      ["s-beta", { mode: "none", url: "" }],
    ]);
    h.sponsorzy = [
      sponsor({
        id: "s-beta",
        tier_id: "t-srebro",
        snapshot_name: "Beta Logistyka",
        snapshot_logo_url: "https://cdn.example.org/beta.png",
        sort_order: 20,
      }),
      sponsor({ id: "s-alfa", tier_id: "t-srebro", sort_order: 10 }),
      sponsor({ id: "s-media", tier_id: "t-media", snapshot_name: "Radio Wschód" }),
    ];
  });

  it("zamknięty panel nie dostaje sekcji ani logotypów, ale ma przekierowania wydarzenia", () => {
    tablica();
    expect(panel().getAttribute("data-wydarzenie")).toBe(WYDARZENIE);
    expect(panel().getAttribute("data-sekcja")).toBe("brak");
    expect(panel().getAttribute("data-uklad")).toBe("grid");
    expect(panel().getAttribute("data-logotypy")).toBe("");
    expect(panel().getAttribute("data-przekierowania")).toBe("s-alfa|s-beta");
  });

  it("edycja karty otwiera panel z TĄ sekcją, jej układem i logotypami w kolejności", () => {
    tablica();
    otworzPanel("Srebrni partnerzy");
    expect(panel().getAttribute("data-sekcja")).toBe("t-srebro");
    expect(panel().getAttribute("data-uklad")).toBe("banner");
    expect(panel().getAttribute("data-logotypy")).toBe(
      [
        "s-alfa=Alfa Energia=https://cdn.example.org/alfa.png",
        "s-beta=Beta Logistyka=https://cdn.example.org/beta.png",
      ].join("|"),
    );
  });

  it("sekcja bez firm otwiera panel siatki bez logotypów", () => {
    tablica();
    otworzPanel("Złoci partnerzy");
    expect(panel().getAttribute("data-sekcja")).toBe("t-zloto");
    expect(panel().getAttribute("data-uklad")).toBe("grid");
    expect(panel().getAttribute("data-logotypy")).toBe("");
  });

  it("prośba o zamknięcie zamyka panel, a sygnał otwarcia go nie zamyka", () => {
    tablica();
    otworzPanel("Patroni medialni");
    kliknij(przycisk("panel-sygnal-otwarcia"));
    expect(panel().getAttribute("data-sekcja")).toBe("t-media");
    kliknij(przycisk("panel-zamknij"));
    expect(panel().getAttribute("data-sekcja")).toBe("brak");
  });
});

describe("okno sponsora", () => {
  beforeEach(() => {
    h.sekcje = trzySekcje();
    h.sponsorzy = [
      sponsor({ id: "s-alfa", tier_id: "t-srebro", sort_order: 10 }),
      sponsor({
        id: "s-beta",
        tier_id: "t-srebro",
        snapshot_name: "Beta Logistyka",
        sort_order: 20,
      }),
      sponsor({ id: "s-media", tier_id: "t-media", snapshot_name: "Radio Wschód" }),
    ];
  });

  it("dodanie sponsora z panelu otwiera NOWE przypięcie w tej sekcji, na jej końcu", () => {
    h.zapisSponsoraPending = true;
    tablica();
    expect(screen.queryByRole("dialog", { name: "okno-sponsora" })).toBeNull();
    otworzPanel("Srebrni partnerzy");
    kliknij(przycisk("panel-dodaj-sponsora"));
    const okno = oknoSponsora();
    expect(okno.getAttribute("data-wydarzenie")).toBe(WYDARZENIE);
    expect(okno.getAttribute("data-sponsor")).toBe("nowy");
    expect(okno.getAttribute("data-sekcja")).toBe("t-srebro");
    expect(okno.getAttribute("data-kolejnosc")).toBe("30");
    expect(okno.getAttribute("data-sekcje")).toBe("t-zloto|t-srebro|t-media");
    expect(okno.getAttribute("data-zapis")).toBe("true");
  });

  // REGRESJA: kolejność szła od LICZBY logotypów (`n * 10 + 10`). Po odpięciu
  // pierwszej firmy dwie pozostałe (20 i 30) dawały nowej 30 - kolejność
  // ostatniej, zamiast miejsca za nią.
  it("po odpięciu firmy nowe przypięcie staje ZA największą kolejnością sekcji", () => {
    h.sponsorzy = [
      sponsor({ id: "s-beta", tier_id: "t-srebro", snapshot_name: "Beta", sort_order: 30 }),
      sponsor({ id: "s-gamma", tier_id: "t-srebro", snapshot_name: "Gamma", sort_order: 20 }),
      sponsor({ id: "s-media", tier_id: "t-media", snapshot_name: "Radio", sort_order: 90 }),
    ];
    tablica();
    otworzPanel("Srebrni partnerzy");
    kliknij(przycisk("panel-dodaj-sponsora"));
    expect(oknoSponsora().getAttribute("data-kolejnosc")).toBe("40");
  });

  it("w pustej sekcji nowe przypięcie jest pierwsze (kolejność 10)", () => {
    tablica();
    otworzPanel("Złoci partnerzy");
    kliknij(przycisk("panel-dodaj-sponsora"));
    expect(oknoSponsora().getAttribute("data-sekcja")).toBe("t-zloto");
    expect(oknoSponsora().getAttribute("data-kolejnosc")).toBe("10");
  });

  it("edycja logotypu z panelu otwiera okno z TYM przypięciem", () => {
    tablica();
    otworzPanel("Srebrni partnerzy");
    kliknij(przycisk("panel-edytuj Beta Logistyka"));
    expect(oknoSponsora().getAttribute("data-sponsor")).toBe("s-beta");
    expect(oknoSponsora().getAttribute("data-sekcja")).toBe("t-srebro");
    expect(oknoSponsora().getAttribute("data-zapis")).toBe("false");
  });

  it("identyfikator spoza listy otwiera okno jako nowe przypięcie w otwartej sekcji", () => {
    h.edycjaSpoza = "s-nieznany";
    tablica();
    otworzPanel("Patroni medialni");
    kliknij(przycisk("panel-edytuj-spoza"));
    expect(oknoSponsora().getAttribute("data-sponsor")).toBe("nowy");
    expect(oknoSponsora().getAttribute("data-sekcja")).toBe("t-media");
    expect(oknoSponsora().getAttribute("data-kolejnosc")).toBe("20");
  });

  it("prośba o edycję przy zamkniętym panelu nie podsuwa żadnej sekcji domyślnej", () => {
    h.edycjaSpoza = "s-media";
    tablica();
    kliknij(przycisk("panel-edytuj-spoza"));
    expect(oknoSponsora().getAttribute("data-sponsor")).toBe("s-media");
    expect(oknoSponsora().getAttribute("data-sekcja")).toBe("");
    expect(oknoSponsora().getAttribute("data-kolejnosc")).toBe("10");
  });

  it("zapis idzie do mutacji z ładunkiem okna i zamyka okno", () => {
    tablica();
    otworzPanel("Srebrni partnerzy");
    kliknij(przycisk("panel-dodaj-sponsora"));
    kliknij(przycisk("sponsor-zapisz"));
    expect(h.zapisySponsora).toEqual([
      { eventId: WYDARZENIE, tierId: "t-srebro", sortOrder: 30, companyId: "c9" },
    ]);
    expect(screen.queryByRole("dialog", { name: "okno-sponsora" })).toBeNull();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  // ZMIANA: odmowa `tier_full` (pełna sekcja) kończyła się ogólnym
  // `toasts.error`; dziś idzie przez mapę odmów sponsorów, która mówi ile miejsc
  // ma sekcja i ile jest zajętych.
  it("odmowa zapisu zostawia okno otwarte i mówi zdaniem z mapy odmów (tier_full)", () => {
    h.zapisSponsoraBlad = new Error("tier_full: tier allows 1 company(ies), 1 already pinned");
    tablica();
    otworzPanel("Srebrni partnerzy");
    kliknij(przycisk("panel-dodaj-sponsora"));
    kliknij(przycisk("sponsor-zapisz"));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:tier_full: tier allows 1 company(ies), 1 already pinned",
    );
    expect(h.toastError).not.toHaveBeenCalledWith("sponsorBoard.toasts.error");
    expect(oknoSponsora()).toBeTruthy();
  });

  it("prośba o zamknięcie zamyka okno, a sygnał otwarcia go nie zamyka", () => {
    tablica();
    otworzPanel("Srebrni partnerzy");
    kliknij(przycisk("panel-dodaj-sponsora"));
    kliknij(przycisk("sponsor-sygnal-otwarcia"));
    expect(oknoSponsora()).toBeTruthy();
    kliknij(przycisk("sponsor-zamknij"));
    expect(screen.queryByRole("dialog", { name: "okno-sponsora" })).toBeNull();
    expect(h.zapisySponsora).toEqual([]);
  });
});
