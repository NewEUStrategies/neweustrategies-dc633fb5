// Molekula „PRZYPIECIE FIRMY" - formularz, w ktorym firma z CRM staje sie
// sponsorem konkretnego wydarzenia.
//
// CO TEN PLIK DOWODZI.
//   1. FIRMA JEST WYBIERANA Z CRM, NIE WPISYWANA. W trybie tworzenia okno
//      pokazuje wyszukiwarke firm; bez wskazania firmy zapis nie rusza. Pole
//      tekstowe „nazwa firmy” tworzyloby duplikaty poza CRM-em.
//   2. FIRMA JEST NIEZMIENNA PO ZAPISIE. W trybie edycji wyszukiwarki NIE MA,
//      a ladunek nie niesie `companyId` - RPC i tak go nie przeczyta.
//   3. WYBOR FIRMY PODPOWIADA MIGAWKE, ALE JEJ NIE NADPISUJE. To, co redaktor
//      juz wpisal, zostaje - migawka jedzie na strone publiczna.
//   4. OPUBLIKOWANY SPONSOR MUSI MIEC POZIOM (`event_sponsors_published_*`),
//      a „bez poziomu” ma wlasny znacznik, bo Radix Select odrzuca pusty string
//      jako wartosc pozycji i cale okno przestawaloby sie renderowac.
//   5. NOTATKA WEWNETRZNA NIE JEDZIE Z LISTA. Dialog dobiera ja osobnym
//      zapytaniem, a dopoki jej NIE ZNA, klucz `internal_note` nie ma prawa
//      wejsc do ladunku - inaczej SQL nadpisuje istniejaca notatke NULL-em.
//      To jest udokumentowana regresja tego modulu i ma tu wlasne przypadki.
//   6. ODMOWA ZAPISU ZOSTAWIA WYPELNIONE POLA - okno zamyka dopiero panel,
//      po sukcesie (dowod styku jest w tescie organizmu).
//   7. ZAPIS W TOKU GASI OBA PRZYCISKI - drugie klikniecie to drugie przypiecie.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabel konwersji szkicu
// (`lib/events/sponsorDraft.test.ts`). (2) Parytetu slownikow i limitow z baza
// (`lib/events/__tests__/sponsorEnumParity.test.ts`). (3) Warstwy zapytan -
// hooki sa zaslepione, a ich umowa ma wlasny plik
// (`lib/events/__tests__/useEventSponsors.test.ts`).
//
// RODO: firmy i domeny sa wymyslone, adresy wylacznie `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import type {
  EventSponsorRow,
  EventSponsorTierRow,
  SponsorCompanyRow,
  SponsorInput,
} from "@/lib/events/sponsorsApi";

const h = vi.hoisted(() => ({
  lang: "pl",
  firmy: [] as unknown[] | undefined,
  szukaneFrazy: [] as string[],
  szczegolWlaczony: [] as boolean[],
  notatka: null as string | null,
  szczegolGotowy: false,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsorCompanySearch: (_eventId: string, q: string, enabled: boolean) => {
    if (enabled) h.szukaneFrazy.push(q);
    return { data: h.firmy, isLoading: false, error: null };
  },
  useSponsorDetail: (_sponsorId: string, enabled: boolean) => {
    h.szczegolWlaczony.push(enabled);
    return {
      data: h.szczegolGotowy ? { internal_note: h.notatka } : undefined,
      isSuccess: h.szczegolGotowy,
      isLoading: false,
      error: null,
    };
  },
}));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog-root">{children}</div>;
    },
    // Radix wiaze okno z `DialogTitle` przez `aria-labelledby`; atrapa nie ma
    // jak odtworzyc tamtego identyfikatora, wiec nazywa okno sama.
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-label="formularz-przypiecia">
          {children}
        </div>
      ) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

const { EventSponsorDialog } =
  await import("@/components/admin/events/molecules/EventSponsorDialog");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PRZYPIECIE = "22222222-2222-4222-8222-222222222222";
const INNE_PRZYPIECIE = "33333333-3333-4333-8333-333333333333";
const FIRMA = "44444444-4444-4444-8444-444444444444";
const POZIOM = "55555555-5555-4555-8555-555555555555";
const DRUGI_POZIOM = "66666666-6666-4666-8666-666666666666";

const S = "adminEventSponsors.sponsors.";
const D = "adminEventSponsors.sponsors.dialog.";
const BLAD = "adminEventSponsors.errors.";
const TIER_NONE = "__none__";

/**
 * Kolumny NULL-owalne, ktore GENERATOR typuje jako `string`.
 *
 * `admin_event_sponsors_list` oddaje `tier_id`, `booth_label`, `snapshot_*`
 * i pola CRM jako NULL (sponsor bez poziomu, bez stanowiska, firma bez strony),
 * a wygenerowany typ obiecuje `string`. Szkic ma na to jawne warunki, wiec
 * fixtura musi umiec oddac `null`.
 */
const BRAK_NAPISU = null as unknown as string;

function poziom(overrides: Partial<EventSponsorTierRow> = {}): EventSponsorTierRow {
  return {
    accent_color: "#FA9346",
    benefits: [],
    created_at: "2026-08-01T10:00:00.000Z",
    description_en: "",
    description_pl: "",
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
    slots_left: 2,
    sort_order: 10,
    sponsors_count: 2,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function firma(overrides: Partial<SponsorCompanyRow> = {}): SponsorCompanyRow {
  return {
    city: "Warszawa",
    country: "PL",
    domain: "alfa.example.com",
    events_count: 2,
    id: FIRMA,
    is_pinned: false,
    logo_url: "https://alfa.example.com/logo.png",
    name: "Alfa sp. z o.o.",
    pinned_sponsor_id: BRAK_NAPISU,
    website: "https://alfa.example.com",
    ...overrides,
  };
}

/**
 * Wiersz LISTY sponsorow - i to jest tu istotne: lista CELOWO nie oddaje
 * `internal_note`, wiec fixtura tez jej nie ma. Przypadki notatki opieraja sie
 * dokladnie na tym braku.
 */
function przypiecie(overrides: Partial<EventSponsorRow> = {}): EventSponsorRow {
  return {
    booth_label: "A12",
    company_id: FIRMA,
    contacts_count: 1,
    created_at: "2026-08-01T10:00:00.000Z",
    crm_city: "Warszawa",
    crm_country: "PL",
    crm_drift: false,
    crm_drift_fields: [],
    crm_logo_url: "https://alfa.example.com/logo.png",
    crm_name: "Alfa sp. z o.o.",
    crm_website: "https://alfa.example.com",
    event_id: WYDARZENIE,
    id: PRZYPIECIE,
    is_published: true,
    materials_count: 2,
    published_materials_count: 1,
    role: "sponsor",
    snapshot_country: "PL",
    snapshot_description_en: "Leading logistics",
    snapshot_description_pl: "Lider logistyki",
    snapshot_logo_url: "https://alfa.example.com/logo.png",
    snapshot_name: "Alfa",
    snapshot_source: "crm",
    snapshot_taken_at: "2026-08-01T10:00:00.000Z",
    snapshot_website: "https://alfa.example.com",
    sort_order: 10,
    tier_accent_color: "#FA9346",
    tier_id: POZIOM,
    tier_key: "gold",
    tier_logo_size: "lg",
    tier_name_en: "Gold",
    tier_name_pl: "Zloty",
    tier_rank: 1,
    total_count: 1,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function renderuj(
  props: {
    open?: boolean;
    sponsor?: EventSponsorRow | null;
    tiers?: EventSponsorTierRow[];
    nextSortOrder?: number;
    isSaving?: boolean;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: SponsorInput) => void>();
  const stan = {
    open: props.open ?? true,
    sponsor: props.sponsor ?? null,
    tiers: props.tiers ?? [poziom()],
    nextSortOrder: props.nextSortOrder ?? 20,
    isSaving: props.isSaving ?? false,
  };
  const drzewo = () => (
    <EventSponsorDialog
      open={stan.open}
      onOpenChange={onOpenChange}
      eventId={WYDARZENIE}
      sponsor={stan.sponsor}
      tiers={stan.tiers}
      nextSortOrder={stan.nextSortOrder}
      isSaving={stan.isSaving}
      onSubmit={onSubmit}
    />
  );
  const wynik = render(drzewo());
  const przerysuj = (zmiana: Partial<typeof stan>) => {
    Object.assign(stan, zmiana);
    wynik.rerender(drzewo());
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const szukajFirmy = () => screen.getByLabelText(`${S}companySearch`);
const poziomPola = () => screen.getByLabelText(`${D}tier`);
const rola = () => screen.getByLabelText(`${D}role`);
const stanowisko = () => screen.getByLabelText(`${D}booth`);
const kolejnosc = () => screen.getByLabelText(`${D}sortOrder`);
const widocznosc = () => screen.getByLabelText(`${D}isPublished`);
const nazwaNaStronie = () => screen.getByLabelText(`${D}snapshotName`);
const kraj = () => screen.getByLabelText(`${D}snapshotCountry`);
const strona = () => screen.getByLabelText(`${D}snapshotWebsite`);
const logo = () => screen.getByLabelText(`${D}snapshotLogoUrl`);
const opisPl = () => screen.getByLabelText(`${D}snapshotDescriptionPl`);
const opisEn = () => screen.getByLabelText(`${D}snapshotDescriptionEn`);
const notatka = () => screen.getByLabelText(`${D}internalNote`);
const zapisz = () => screen.getByRole("button", { name: `${D}saveAction` });
const anuluj = () => screen.getByRole("button", { name: `${D}cancelAction` });
const wybierzFirme = (nazwa: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(nazwa) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.firmy = [firma()];
  h.szukaneFrazy = [];
  h.szczegolWlaczony = [];
  h.notatka = null;
  h.szczegolGotowy = false;
});

describe("otwarcie okna i tryb", () => {
  it("okno ZAMKNIETE nie renderuje formularza", () => {
    renderuj({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nowe przypiecie ma tytul tworzenia, wyszukiwarke firm i PODPOWIEDZIANA kolejnosc", () => {
    renderuj({ nextSortOrder: 40 });

    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeTruthy();
    expect(szukajFirmy()).toBeTruthy();
    expect(kolejnosc()).toHaveValue("40");
  });

  it("edycja NIE POKAZUJE wyszukiwarki - firmy nie da sie podmienic po zapisie", () => {
    renderuj({ sponsor: przypiecie() });

    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeTruthy();
    expect(screen.queryByLabelText(`${S}companySearch`)).toBeNull();
    expect(screen.getByText(`${D}company: Alfa sp. z o.o.`)).toBeTruthy();
  });

  it("edycja wypelnia migawke z wiersza listy", () => {
    renderuj({ sponsor: przypiecie() });

    expect(nazwaNaStronie()).toHaveValue("Alfa");
    expect(kraj()).toHaveValue("PL");
    expect(strona()).toHaveValue("https://alfa.example.com");
    expect(opisPl()).toHaveValue("Lider logistyki");
    expect(stanowisko()).toHaveValue("A12");
    expect(poziomPola()).toHaveValue(POZIOM);
  });

  it("sponsor BEZ poziomu pokazuje znacznik „bez poziomu”, a nie pusta wartosc", () => {
    // Radix Select odrzuca pusty string jako wartosc pozycji i wywraca okno -
    // stad wlasny znacznik tlumaczony na "" w szkicu.
    renderuj({ sponsor: przypiecie({ tier_id: BRAK_NAPISU, is_published: false }) });

    expect(poziomPola()).toHaveValue(TIER_NONE);
  });

  it("otwarcie dla INNEGO przypiecia nie niesie poprzedniego", () => {
    const { przerysuj } = renderuj({ sponsor: przypiecie() });
    przerysuj({
      sponsor: przypiecie({
        id: INNE_PRZYPIECIE,
        snapshot_name: "Beta",
        crm_name: "Beta S.A.",
        booth_label: BRAK_NAPISU,
      }),
    });

    expect(nazwaNaStronie()).toHaveValue("Beta");
    expect(stanowisko()).toHaveValue("");
  });
});

describe("wyszukiwarka firm z CRM", () => {
  // ---------------------------------------------------------------------------
  // DEFEKT: `isNew` czyta sie ze SZKICU (`draft.id === null`), a szkic startuje
  // pusty i dopiero EFEKT wpisuje do niego wiersz sponsora. Przez jeden render
  // okno edycji uchodzi wiec za „nowe przypiecie” i odpala wyszukiwarke firm
  // w CRM - zapytanie, ktorego nikt nie zobaczy, bo lista wynikow w trybie
  // edycji sie nie renderuje. Przy liscie dwudziestu sponsorow to dwadziescia
  // zbednych zapytan do CRM-u na jedna sesje redakcyjna. Tryb powinien wynikac
  // z PROPA `sponsor`, a nie ze stanu, ktory dopiero ma zostac ustawiony.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: okno EDYCJI odpala jedno zapytanie do wyszukiwarki firm CRM, zanim efekt wpisze szkic",
    () => {
      renderuj({ sponsor: przypiecie() });

      expect(h.szukaneFrazy).toEqual([]);
    },
  );

  it("wpisana fraza jedzie do warstwy zapytan", () => {
    renderuj();
    fireEvent.change(szukajFirmy(), { target: { value: "alfa" } });

    expect(h.szukaneFrazy).toContain("alfa");
  });

  it("brak wynikow to zdanie, a nie pusta ramka", () => {
    h.firmy = [];
    renderuj();

    expect(screen.getByText(`${S}noCompanies`)).toBeTruthy();
  });

  it("zapytanie JESZCZE W DRODZE nie wywraca listy - okno pokazuje to samo zdanie co przy pustce", () => {
    // `useQuery` oddaje `undefined`, dopoki nie ma odpowiedzi. Rozroznienie
    // „ladujemy" od „nic nie znaleziono" nalezy do panelu; okno ma sie po prostu
    // wyrenderowac, a nie polec na `undefined.length`.
    h.firmy = undefined;
    renderuj();

    expect(screen.getByText(`${S}noCompanies`)).toBeTruthy();
  });

  it("firma BEZ domeny w CRM nie rysuje pustego napisu obok nazwy", () => {
    h.firmy = [firma({ domain: BRAK_NAPISU })];
    renderuj();

    const pozycja = screen.getByRole("button", { name: /Alfa/ });
    expect(pozycja.textContent).toBe("Alfa sp. z o.o.");
  });

  it("firma JUZ PRZYPIETA jest oznaczona - inaczej redaktor probuje przypiac ja drugi raz", () => {
    h.firmy = [firma({ is_pinned: true })];
    renderuj();

    expect(screen.getByText(`${S}companyPinned`)).toBeTruthy();
  });

  it("wybor firmy PODPOWIADA migawke z CRM", () => {
    renderuj();
    wybierzFirme("Alfa");

    expect(nazwaNaStronie()).toHaveValue("Alfa sp. z o.o.");
    expect(logo()).toHaveValue("https://alfa.example.com/logo.png");
    expect(strona()).toHaveValue("https://alfa.example.com");
    expect(kraj()).toHaveValue("PL");
  });

  it("wybor firmy NIE NADPISUJE tego, co redaktor juz wpisal", () => {
    // Migawka jedzie na strone publiczna - recznie wpisana nazwa jest decyzja.
    renderuj();
    fireEvent.change(nazwaNaStronie(), { target: { value: "Alfa Logistyka" } });
    wybierzFirme("Alfa");

    expect(nazwaNaStronie()).toHaveValue("Alfa Logistyka");
  });

  it("firma bez danych w CRM nie wklada `null` do pol migawki", () => {
    h.firmy = [firma({ logo_url: BRAK_NAPISU, website: BRAK_NAPISU, country: BRAK_NAPISU })];
    renderuj();
    wybierzFirme("Alfa");

    expect(logo()).toHaveValue("");
    expect(strona()).toHaveValue("");
    expect(kraj()).toHaveValue("");
  });

  it("bez wskazania firmy zapis nie rusza i mowi, czego brakuje", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(nazwaNaStronie(), { target: { value: "Alfa" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidCompany`)).toBeTruthy();
  });
});

describe("poziom, rola i widocznosc", () => {
  it("droplista poziomow zaczyna sie od „bez poziomu”", () => {
    renderuj({ tiers: [poziom(), poziom({ id: DRUGI_POZIOM, name_pl: "Srebrny" })] });

    const wartosci = Array.from(poziomPola().querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(wartosci).toEqual([TIER_NONE, POZIOM, DRUGI_POZIOM]);
  });

  it("nazwa poziomu idzie za jezykiem interfejsu", () => {
    h.lang = "en";
    renderuj({ tiers: [poziom()] });

    expect(within(poziomPola()).getByText("Gold")).toBeTruthy();
  });

  it("pusta nazwa angielska poziomu spada na polska", () => {
    h.lang = "en";
    renderuj({ tiers: [poziom({ name_en: "" })] });

    expect(within(poziomPola()).getByText("Zloty")).toBeTruthy();
  });

  it("pusta nazwa POLSKA poziomu spada na angielska", () => {
    // Poziomy zakladane przez zespol miedzynarodowy potrafia miec wypelniona
    // wylacznie kolumne angielska - droplista bez tego zapasu pokazywalaby
    // pozycje bez etykiety.
    renderuj({ tiers: [poziom({ name_pl: "" })] });

    expect(within(poziomPola()).getByText("Gold")).toBeTruthy();
  });

  it("OPUBLIKOWANY sponsor bez poziomu nie przechodzi - baza tego nie przyjmie", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie({ tier_id: BRAK_NAPISU }) });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}sponsorTierRequired`)).toBeTruthy();
  });

  it("SZKIC bez poziomu przechodzi - ograniczenie dotyczy tylko publikacji", () => {
    const { onSubmit } = renderuj({
      sponsor: przypiecie({ tier_id: BRAK_NAPISU, is_published: false }),
    });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].tierId).toBeNull();
  });

  it("odpiecie poziomu jedzie JAWNYM `null`, a nie pominietym kluczem", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie({ is_published: false }) });
    fireEvent.change(poziomPola(), { target: { value: TIER_NONE } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].tierId).toBeNull();
  });

  it("wybrana rola jedzie w ladunku", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(rola(), { target: { value: "media_partner" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].role).toBe("media_partner");
  });

  it("wycofanie ze strony publicznej jedzie jako `false`", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie({ is_published: true }) });
    expect(widocznosc()).toBeChecked();

    fireEvent.click(widocznosc());
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].isPublished).toBe(false);
  });
});

describe("walidacja migawki", () => {
  it("pusta nazwa na stronie zatrzymuje zapis - to ona jedzie do uczestnikow", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(nazwaNaStronie(), { target: { value: "  " } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidName`)).toBeTruthy();
  });

  it("bledny adres strony firmy zatrzymuje zapis", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(strona(), { target: { value: "alfa.example.com" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("bledny adres logotypu zatrzymuje zapis", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(logo(), { target: { value: "logo.png" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("pusty adres strony i logotypu jest POPRAWNY i jedzie jako brak wartosci", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(strona(), { target: { value: "" } });
    fireEvent.change(logo(), { target: { value: "" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      snapshotWebsite: null,
      snapshotLogoUrl: null,
    });
  });

  it("kolejnosc, ktora nie jest liczba, zatrzymuje zapis", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(kolejnosc(), { target: { value: "pierwszy" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidNumber`)).toBeTruthy();
  });

  it("komunikaty pojawiaja sie DOPIERO po probie zapisu", () => {
    renderuj({ sponsor: przypiecie() });
    fireEvent.change(nazwaNaStronie(), { target: { value: "" } });

    expect(screen.queryByText(`${BLAD}invalidName`)).toBeNull();

    fireEvent.click(zapisz());
    expect(screen.getByText(`${BLAD}invalidName`)).toBeTruthy();
  });
});

describe("notatka wewnetrzna - regresja `internal_note`", () => {
  it("dla NOWEGO przypiecia szczegol nie jest pobierany", () => {
    renderuj();

    expect(h.szczegolWlaczony.every((wlaczony) => wlaczony === false)).toBe(true);
  });

  it("notatka dojezdza OSOBNYM zapytaniem i wchodzi do pola", () => {
    // `admin_event_sponsors_list` celowo nie oddaje notatki, wiec bez tego
    // zapytania redaktor widzialby puste pole tam, gdzie notatka istnieje.
    h.szczegolGotowy = true;
    h.notatka = "Faktura po wydarzeniu, termin 30 dni.";
    renderuj({ sponsor: przypiecie() });

    expect(notatka()).toHaveValue("Faktura po wydarzeniu, termin 30 dni.");
  });

  it("dopoki notatka NIE JEST ZNANA, klucz nie wchodzi do ladunku - inaczej SQL nadpisuje ja NULL-em", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.click(zapisz());

    // `undefined` znika w `payload()` po stronie API, wiec klucz nie trafia do
    // ladunku, a zachowawcza galaz SQL-a zostawia notatke bez zmian.
    expect(onSubmit.mock.calls[0][0].internalNote).toBeUndefined();
  });

  it("znana PUSTA notatka jedzie jako `null` - to jest skasowanie, a nie brak wiedzy", () => {
    h.szczegolGotowy = true;
    h.notatka = null;
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].internalNote).toBeNull();
  });

  it("notatka wpisana ZANIM wrocilo zapytanie NIE JEST nadpisywana odpowiedzia", () => {
    const { przerysuj } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(notatka(), { target: { value: "Ustalenia z rozmowy" } });

    h.szczegolGotowy = true;
    h.notatka = "Stara notatka z bazy";
    przerysuj({});

    expect(notatka()).toHaveValue("Ustalenia z rozmowy");
  });

  it("wpisana notatka jedzie w ladunku PRZYCIETA", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(notatka(), { target: { value: "  Ustalenia  " } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].internalNote).toBe("Ustalenia");
  });
});

describe("ladunek: tworzenie kontra edycja", () => {
  it("NOWE przypiecie niesie wydarzenie i firme", () => {
    const { onSubmit } = renderuj({ nextSortOrder: 40 });
    wybierzFirme("Alfa");
    fireEvent.change(poziomPola(), { target: { value: POZIOM } });
    fireEvent.change(stanowisko(), { target: { value: " A12 " } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: undefined,
      eventId: WYDARZENIE,
      companyId: FIRMA,
      tierId: POZIOM,
      boothLabel: "A12",
      sortOrder: 40,
      isPublished: false,
    });
  });

  it("EDYCJA niesie `id`, a NIE niesie ani wydarzenia, ani firmy", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(nazwaNaStronie(), { target: { value: "Alfa Logistyka" } });
    fireEvent.click(zapisz());

    const ladunek = onSubmit.mock.calls[0][0];
    expect(ladunek.id).toBe(PRZYPIECIE);
    expect(ladunek.eventId).toBeUndefined();
    expect(ladunek.companyId).toBeUndefined();
    expect(ladunek.snapshotName).toBe("Alfa Logistyka");
  });

  it("kraj i opis ANGIELSKI migawki jada w ladunku - to jest tresc strony /en", () => {
    // Angielska wersja strony wydarzenia czyta `snapshot_description_en`.
    // Pole, ktore nie dojezdza do ladunku, znaczy pusta ramke przy logotypie.
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(kraj(), { target: { value: "DE" } });
    fireEvent.change(opisEn(), { target: { value: "Logistics leader" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      snapshotCountry: "DE",
      snapshotDescriptionEn: "Logistics leader",
    });
  });

  it("puste stanowisko jedzie jako brak wartosci, a nie jako pusty napis", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(stanowisko(), { target: { value: "" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].boothLabel).toBeNull();
  });
});

describe("zapis w toku i wyjscie z okna", () => {
  it("zapis w toku GASI oba przyciski - drugie klikniecie to drugie przypiecie", () => {
    const { onSubmit } = renderuj({ sponsor: przypiecie(), isSaving: true });

    expect(zapisz()).toBeDisabled();
    expect(anuluj()).toBeDisabled();
    fireEvent.click(zapisz());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("„Anuluj” zamyka okno i nie wysyla niczego", () => {
    const { onOpenChange, onSubmit } = renderuj({ sponsor: przypiecie() });
    fireEvent.click(anuluj());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: `nextSortOrder` liczy sie z listy sponsorow, a lista odswieza sie
  // po kazdej mutacji modulu i przy powrocie fokusa do okna przegladarki.
  // Efekt czyszczacy szkic ma ja w tablicy zaleznosci, wiec taka zmiana kasuje
  // wybrana firme i cala wpisana migawke - bez zadnego komunikatu.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: odswiezenie listy sponsorow w tle (zmiana `nextSortOrder`) CZYSCI wybrana firme i migawke",
    () => {
      const { przerysuj } = renderuj({ nextSortOrder: 20 });
      wybierzFirme("Alfa");
      fireEvent.change(opisPl(), { target: { value: "Opis na strone" } });

      przerysuj({ nextSortOrder: 30 });

      expect(nazwaNaStronie()).toHaveValue("Alfa sp. z o.o.");
      expect(opisPl()).toHaveValue("Opis na strone");
    },
  );
});

describe("dostepnosc", () => {
  it("formularz nowego przypiecia nie ma naruszen axe", async () => {
    const { container } = renderuj();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("formularz edycji z komunikatami bledow nie ma naruszen axe", async () => {
    const { container } = renderuj({ sponsor: przypiecie() });
    fireEvent.change(nazwaNaStronie(), { target: { value: "" } });
    fireEvent.click(zapisz());

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("komunikat o braku firmy jest ogloszony jako `alert`", () => {
    renderuj();
    fireEvent.click(zapisz());

    const alerty = screen.getAllByRole("alert").map((element) => element.textContent);
    expect(alerty).toContain(`${BLAD}invalidCompany`);
  });
});
