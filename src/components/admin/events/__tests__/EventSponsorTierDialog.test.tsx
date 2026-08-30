// Molekula „POZIOM SPONSORSKI” - formularz, w ktorym zapada kolejnosc firm na
// stronie wydarzenia i limit miejsc na kazdym poziomie.
//
// CO TEN PLIK DOWODZI.
//   1. KLUCZ JEST ZAMROZONY PO ZAPISIE. Pole klucza w trybie edycji jest
//      WYLACZONE, a ladunek edycji klucza NIE NIESIE - RPC go nie czyta, wiec
//      edytowalne pole obiecywaloby zmiane, ktora nigdy sie nie stanie.
//   2. UNIKALNOSC KLUCZA PILNUJE BAZA, A KSZTALT - FORMULARZ. Wielkie litery,
//      myslnik i cyfra na poczatku nie przechodza; komunikat pokazuje sie
//      dopiero po probie zapisu, nie przy pierwszej literze.
//   3. PUSTY LIMIT FIRM TO BRAK LIMITU, a nie zero. To dwa rozne zdania
//      i ladunek musi je rozroznic (`null` kontra liczba).
//   4. KOREJNOSC I RANGA TO DWIE ROZNE LICZBY. Ranga ustawia miejsce poziomu
//      na stronie, kolejnosc - miejsce w panelu; obie ida w ladunku osobno.
//   5. KORZYSCI SA LISTA W FORMULARZU: da sie je dodac, poprawic w obu
//      jezykach, wyroznic i usunac, a korzysc bez jednego z jezykow zatrzymuje
//      zapis (baza wymaga obu).
//   6. TRYB TWORZENIA I TRYB EDYCJI TO DWA ROZNE ZADANIA: nowy poziom niesie
//      `eventId` i `key`, poprawiany niesie `id` i NIE niesie tamtych dwoch.
//   7. ZAPIS W TOKU GASI OBA PRZYCISKI - drugie klikniecie to drugi poziom
//      o tym samym kluczu, czyli odmowa unikalnosci zamiast zapisu.
//   8. OTWARCIE DLA INNEGO POZIOMU NIE NIESIE POPRZEDNIEGO.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabel konwersji szkicu - sa
// w `lib/events/sponsorDraft.test.ts`. (2) Parytetu slownikow i limitow z bazą -
// to bramka `lib/events/__tests__/sponsorEnumParity.test.ts`. (3) Zapisu RPC -
// molekula dostaje `onSubmit` w propsie.
//
// Radix Dialog, Select i Switch nie dzialaja pod happy-dom bez pelnego pointer
// API - wszystkie trzy sa podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import type { EventSponsorTierRow, SponsorTierInput } from "@/lib/events/sponsorsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Klient bazy nie jest przedmiotem dowodu, a jego modul domaga sie konfiguracji
// srodowiska przy imporcie - okno bierze z `sponsorsApi` wylacznie SLOWNIKI.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog-root">{children}</div>;
    },
    // Radix wiaze okno z `DialogTitle` przez `aria-labelledby`; atrapa nie ma
    // jak odtworzyc tamtego identyfikatora, wiec daje oknu wlasna nazwe -
    // inaczej axe zglaszalby brak nazwy ATRAPY, a nie produkcji.
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-label="formularz-poziomu">
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

const { EventSponsorTierDialog } =
  await import("@/components/admin/events/molecules/EventSponsorTierDialog");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const POZIOM = "22222222-2222-4222-8222-222222222222";
const INNY_POZIOM = "33333333-3333-4333-8333-333333333333";

const D = "adminEventSponsors.tiers.dialog.";
const BLAD = "adminEventSponsors.errors.";

/**
 * Kolumna NULL-owalna, ktora GENERATOR typuje jako `string`/`number`.
 *
 * `admin_event_sponsor_tiers_list` oddaje `accent_color` jako NULL (poziom bez
 * koloru akcentu) i `max_companies` jako NULL („bez limitu firm” jest tu
 * WARTOSCIA, nie brakiem danych), a wygenerowany typ obiecuje `string`
 * i `number`. `tierDraftFromRow` ma na to jawne warunki, wiec fixtura musi
 * umiec oddac `null`.
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
    slots_left: 2,
    sort_order: 10,
    sponsors_count: 2,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function renderuj(
  props: {
    open?: boolean;
    tier?: EventSponsorTierRow | null;
    nextSortOrder?: number;
    nextRank?: number;
    isSaving?: boolean;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: SponsorTierInput) => void>();
  const stan = {
    open: props.open ?? true,
    tier: props.tier ?? null,
    nextSortOrder: props.nextSortOrder ?? 20,
    nextRank: props.nextRank ?? 2,
    isSaving: props.isSaving ?? false,
  };
  const drzewo = () => (
    <EventSponsorTierDialog
      open={stan.open}
      onOpenChange={onOpenChange}
      eventId={WYDARZENIE}
      tier={stan.tier}
      nextSortOrder={stan.nextSortOrder}
      nextRank={stan.nextRank}
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

const klucz = () => screen.getByLabelText(`${D}key`);
const nazwaPl = () => screen.getByLabelText(`${D}namePl`);
const nazwaEn = () => screen.getByLabelText(`${D}nameEn`);
const opisPl = () => screen.getByLabelText(`${D}descriptionPl`);
const opisEn = () => screen.getByLabelText(`${D}descriptionEn`);
const ranga = () => screen.getByLabelText(`${D}rank`);
const kolejnosc = () => screen.getByLabelText(`${D}sortOrder`);
const limitFirm = () => screen.getByLabelText(`${D}maxCompanies`);
const rozmiarLogo = () => screen.getByLabelText(`${D}logoSize`);
const kolor = () => screen.getByLabelText("adminEventSponsors.labels.accentColor");
const aktywny = () => screen.getByLabelText(`${D}isActive`);
const zapisz = () => screen.getByRole("button", { name: `${D}saveAction` });
const anuluj = () => screen.getByRole("button", { name: `${D}cancelAction` });
const dodajKorzysc = () => screen.getByRole("button", { name: `${D}addBenefit` });
const korzysciPl = () => screen.queryAllByLabelText(`${D}benefitPl`);
const korzysciEn = () => screen.queryAllByLabelText(`${D}benefitEn`);
const usunKorzysc = () => screen.getAllByRole("button", { name: `${D}removeBenefit` });

/** Minimum, ktore przepuszcza walidacje NOWEGO poziomu. */
function wypelnijMinimum(key = "gold", pl = "Zloty", en = "Gold") {
  fireEvent.change(klucz(), { target: { value: key } });
  fireEvent.change(nazwaPl(), { target: { value: pl } });
  fireEvent.change(nazwaEn(), { target: { value: en } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("otwarcie, tryb i pozostalosc po poprzednim poziomie", () => {
  it("okno ZAMKNIETE nie renderuje formularza", () => {
    renderuj({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nowy poziom ma tytul tworzenia i puste pola, a ranga i kolejnosc sa PODPOWIEDZIANE", () => {
    renderuj({ nextSortOrder: 30, nextRank: 4 });

    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeTruthy();
    expect(klucz()).toHaveValue("");
    expect(nazwaPl()).toHaveValue("");
    // Podpowiedz z panelu: nowy poziom laduje na koncu listy, a nie na zerze,
    // ktore wskoczyloby przed wszystkie istniejace.
    expect(ranga()).toHaveValue("4");
    expect(kolejnosc()).toHaveValue("30");
  });

  it("edycja pokazuje tytul edycji i CALY wiersz - razem z korzysciami", () => {
    renderuj({ tier: poziom() });

    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeTruthy();
    expect(klucz()).toHaveValue("gold");
    expect(nazwaPl()).toHaveValue("Zloty");
    expect(nazwaEn()).toHaveValue("Gold");
    expect(opisPl()).toHaveValue("Poziom najwyzszy");
    expect(opisEn()).toHaveValue("Top tier");
    expect(kolor()).toHaveValue("#FA9346");
    expect(limitFirm()).toHaveValue("3");
    expect(rozmiarLogo()).toHaveValue("lg");
    expect(korzysciPl()[0]).toHaveValue("Logo na scenie");
    expect(korzysciEn()[0]).toHaveValue("Logo on stage");
  });

  it("poziom BEZ limitu firm pokazuje puste pole, a nie zero", () => {
    // Zero i pustka to dwa rozne zdania: „nie przyjme zadnej firmy” kontra
    // „przyjme dowolna liczbe”.
    renderuj({ tier: poziom({ max_companies: BEZ_LIMITU }) });

    expect(limitFirm()).toHaveValue("");
  });

  it("poziom bez koloru akcentu nie wklada `null` do pola tekstowego", () => {
    renderuj({ tier: poziom({ accent_color: BRAK_NAPISU }) });

    expect(kolor()).toHaveValue("");
  });

  it("otwarcie dla INNEGO poziomu nie niesie poprzedniego", () => {
    const { przerysuj } = renderuj({ tier: poziom() });
    przerysuj({
      tier: poziom({ id: INNY_POZIOM, key: "silver", name_pl: "Srebrny", benefits: [] }),
    });

    expect(klucz()).toHaveValue("silver");
    expect(nazwaPl()).toHaveValue("Srebrny");
    expect(korzysciPl()).toHaveLength(0);
  });

  it("przejscie z edycji na NOWY poziom czysci formularz do konca", () => {
    const { przerysuj } = renderuj({ tier: poziom() });
    przerysuj({ tier: null });

    expect(klucz()).toHaveValue("");
    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeTruthy();
  });
});

describe("klucz techniczny", () => {
  it("w trybie edycji pole klucza jest WYLACZONE - RPC i tak go nie przeczyta", () => {
    renderuj({ tier: poziom() });

    expect(klucz()).toBeDisabled();
  });

  it("w trybie tworzenia klucz jest do wpisania", () => {
    renderuj();

    expect(klucz()).toBeEnabled();
  });

  it.each([
    ["Gold", "wielka litera"],
    ["1gold", "cyfra na poczatku"],
    ["gold-plus", "myslnik"],
    ["g", "jeden znak"],
    ["", "pustka"],
  ])("klucz %s nie przechodzi walidacji (%s) i zapis nie rusza", (wartosc) => {
    const { onSubmit } = renderuj();
    fireEvent.change(klucz(), { target: { value: wartosc } });
    fireEvent.change(nazwaPl(), { target: { value: "Zloty" } });
    fireEvent.change(nazwaEn(), { target: { value: "Gold" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidKey`)).toBeTruthy();
  });

  it("komunikat o kluczu pojawia sie DOPIERO po probie zapisu", () => {
    // Czerwien przy pierwszej literze uczy redaktora ignorowac komunikaty.
    renderuj();
    fireEvent.change(klucz(), { target: { value: "G" } });

    expect(screen.queryByText(`${BLAD}invalidKey`)).toBeNull();

    fireEvent.click(zapisz());
    expect(screen.getByText(`${BLAD}invalidKey`)).toBeTruthy();
  });

  it("bledny klucz przy EDYCJI nie blokuje zapisu - pola i tak nie da sie zmienic", () => {
    const { onSubmit } = renderuj({ tier: poziom({ key: "gold" }) });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("walidacja pozostalych pol", () => {
  it("brak nazwy w ktorymkolwiek jezyku zatrzymuje zapis", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(klucz(), { target: { value: "gold" } });
    fireEvent.change(nazwaPl(), { target: { value: "Zloty" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidNames`)).toBeTruthy();
  });

  it("kolor spoza wzoru #RRGGBB zatrzymuje zapis", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(kolor(), { target: { value: "pomaranczowy" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidColor`)).toBeTruthy();
  });

  it("pusty kolor jest POPRAWNY i jedzie do bazy jako brak koloru", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].accentColor).toBeNull();
  });

  it("limit firm, ktory nie jest liczba, zatrzymuje zapis", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(limitFirm(), { target: { value: "duzo" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidNumber`)).toBeTruthy();
  });

  it("ranga, ktora nie jest liczba, zatrzymuje zapis", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(ranga(), { target: { value: "pierwsza" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("korzysci poziomu", () => {
  it("nowa korzysc pojawia sie pusta i da sie ja wypelnic w obu jezykach", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(dodajKorzysc());

    expect(korzysciPl()).toHaveLength(1);
    fireEvent.change(korzysciPl()[0], { target: { value: "Stoisko 12 m2" } });
    fireEvent.change(korzysciEn()[0], { target: { value: "12 sqm booth" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].benefits).toEqual([
      { labelPl: "Stoisko 12 m2", labelEn: "12 sqm booth", isHighlighted: false },
    ]);
  });

  it("korzysc bez jednego z jezykow zatrzymuje zapis - baza wymaga obu", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(dodajKorzysc());
    fireEvent.change(korzysciPl()[0], { target: { value: "Stoisko" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidBenefits`)).toBeTruthy();
  });

  it("wyroznienie korzysci jedzie w ladunku", () => {
    const { onSubmit } = renderuj({ tier: poziom() });
    const przelacznik = screen.getAllByLabelText(`${D}benefitHighlighted`)[0];
    fireEvent.click(przelacznik);
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].benefits?.[0].isHighlighted).toBe(false);
  });

  it("poprawka DRUGIEJ korzysci nie rusza pierwszej - w obu jezykach i w wyroznieniu", () => {
    // Kazdy wiersz korzysci przepisuje CALA liste przez `map`. Pomylony indeks
    // znaczy, ze redaktor poprawia „Stoisko 12 m2", a zmienia sie „Logo na
    // scenie" - i to jedzie na strone publiczna razem z cennikiem pakietu.
    const { onSubmit } = renderuj({
      tier: poziom({
        benefits: [
          { label_pl: "Pierwsza", label_en: "First", is_highlighted: false },
          { label_pl: "Druga", label_en: "Second", is_highlighted: false },
        ],
      }),
    });
    fireEvent.change(korzysciPl()[1], { target: { value: "Druga poprawiona" } });
    fireEvent.change(korzysciEn()[1], { target: { value: "Second fixed" } });
    fireEvent.click(screen.getAllByLabelText(`${D}benefitHighlighted`)[1]);
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].benefits).toEqual([
      { labelPl: "Pierwsza", labelEn: "First", isHighlighted: false },
      { labelPl: "Druga poprawiona", labelEn: "Second fixed", isHighlighted: true },
    ]);
  });

  it("usuniecie dotyka DOKLADNIE tej korzysci, nie sasiadki", () => {
    const { onSubmit } = renderuj({
      tier: poziom({
        benefits: [
          { label_pl: "Pierwsza", label_en: "First", is_highlighted: false },
          { label_pl: "Druga", label_en: "Second", is_highlighted: false },
          { label_pl: "Trzecia", label_en: "Third", is_highlighted: false },
        ],
      }),
    });
    fireEvent.click(usunKorzysc()[1]);
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].benefits?.map((benefit) => benefit.labelPl)).toEqual([
      "Pierwsza",
      "Trzecia",
    ]);
  });
});

describe("ladunek: tworzenie kontra edycja", () => {
  it("NOWY poziom niesie wydarzenie i klucz", () => {
    const { onSubmit } = renderuj({ nextSortOrder: 30, nextRank: 4 });
    wypelnijMinimum("platinum", "Platynowy", "Platinum");
    fireEvent.change(limitFirm(), { target: { value: "5" } });
    fireEvent.change(rozmiarLogo(), { target: { value: "sm" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: undefined,
      eventId: WYDARZENIE,
      key: "platinum",
      namePl: "Platynowy",
      nameEn: "Platinum",
      logoSize: "sm",
      maxCompanies: 5,
      rank: 4,
      sortOrder: 30,
      isActive: true,
    });
  });

  it("EDYCJA niesie `id`, a NIE niesie ani wydarzenia, ani klucza", () => {
    const { onSubmit } = renderuj({ tier: poziom() });
    fireEvent.change(nazwaPl(), { target: { value: "Zloty plus" } });
    fireEvent.click(zapisz());

    const ladunek = onSubmit.mock.calls[0][0];
    expect(ladunek.id).toBe(POZIOM);
    expect(ladunek.eventId).toBeUndefined();
    expect(ladunek.key).toBeUndefined();
    expect(ladunek.namePl).toBe("Zloty plus");
  });

  it("PUSTY limit firm jedzie jako brak limitu, a nie jako zero", () => {
    const { onSubmit } = renderuj({ tier: poziom({ max_companies: 3 }) });
    fireEvent.change(limitFirm(), { target: { value: "" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].maxCompanies).toBeNull();
  });

  it("przelacznik „poziom aktywny” wchodzi do ladunku", () => {
    const { onSubmit } = renderuj({ tier: poziom({ is_active: true }) });
    fireEvent.click(aktywny());
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].isActive).toBe(false);
  });

  it("opis ANGIELSKI i KOLEJNOSC wpisane recznie jada w ladunku", () => {
    // Opis angielski jedzie na strone /en, a kolejnosc ustawia miejsce poziomu
    // w panelu. Podpowiedz z listy wolno nadpisac - pole, ktore nie dojezdza do
    // ladunku, cichcem przywracalby podpowiedziana wartosc.
    const { onSubmit } = renderuj({ nextSortOrder: 30 });
    wypelnijMinimum();
    fireEvent.change(opisEn(), { target: { value: "Top tier package" } });
    fireEvent.change(kolejnosc(), { target: { value: "70" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      descriptionEn: "Top tier package",
      sortOrder: 70,
    });
  });

  it("nazwy i opisy jada PRZYCIETE - spacja na koncu nie jest trescia", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum("gold", "  Zloty  ", " Gold ");
    fireEvent.change(opisPl(), { target: { value: "  Opis  " } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      namePl: "Zloty",
      nameEn: "Gold",
      descriptionPl: "Opis",
    });
  });
});

describe("zapis w toku i wyjscie z okna", () => {
  it("zapis w toku GASI oba przyciski - drugie kliknieciem powstalby drugi poziom", () => {
    const { onSubmit } = renderuj({ isSaving: true });

    expect(zapisz()).toBeDisabled();
    expect(anuluj()).toBeDisabled();
    fireEvent.click(zapisz());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("„Anuluj” zamyka okno i nie wysyla niczego", () => {
    const { onOpenChange, onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(anuluj());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: efekt czyszczacy szkic ma w tablicy zaleznosci `nextSortOrder`
  // i `nextRank`, a te licza sie z listy poziomow. Kazde odswiezenie listy
  // (przelacznik „aktywny” w innym wierszu, powrot fokusa do okna przegladarki,
  // zapis innego uzytkownika) zmienia te liczby i CZYSCI wypelniony formularz.
  // Redaktor traci wpisane nazwy i korzysci bez zadnego komunikatu.
  // Podpowiedzi porzadkowe powinny wchodzic do szkicu przy OTWARCIU okna,
  // a nie przy kazdej zmianie propa.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: odswiezenie listy poziomow w tle (zmiana `nextRank`) CZYSCI wypelniony formularz",
    () => {
      const { przerysuj } = renderuj({ nextSortOrder: 20, nextRank: 2 });
      wypelnijMinimum("platinum", "Platynowy", "Platinum");

      przerysuj({ nextRank: 3 });

      expect(klucz()).toHaveValue("platinum");
      expect(nazwaPl()).toHaveValue("Platynowy");
    },
  );
});

describe("dostepnosc", () => {
  it("formularz nowego poziomu nie ma naruszen axe", async () => {
    const { container } = renderuj();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("formularz z komunikatami bledow nadal nie ma naruszen axe", async () => {
    const { container } = renderuj();
    fireEvent.click(dodajKorzysc());
    fireEvent.click(zapisz());

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("komunikat bledu jest ogloszony jako `alert`, nie tylko pokolorowany", () => {
    renderuj();
    fireEvent.click(zapisz());

    const alerty = screen.getAllByRole("alert").map((element) => element.textContent);
    expect(alerty).toContain(`${BLAD}invalidKey`);
  });

  it("okno ma naglowek, ktory nazywa czynnosc", () => {
    renderuj({ tier: poziom() });

    // Pierwszy naglowek okna nazywa CZYNNOSC (edycja kontra tworzenie);
    // kolejne naleza juz do sekcji formularza.
    expect(within(screen.getByRole("dialog")).getAllByRole("heading")[0]).toHaveTextContent(
      `${D}editTitle`,
    );
  });
});
