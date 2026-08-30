// Molekula „MATERIAL SPONSORA" - formularz jednej pozycji, ktora uczestnik albo
// zobaczy na stronie wydarzenia, albo nie zobaczy nigdy.
//
// CO TEN PLIK DOWODZI.
//   1. WIDOCZNOSC PUBLICZNA JEST DECYZJA, NIE DOMYSLNA. Nowy material rodzi sie
//      WEWNETRZNY (`isPublished === false`); przelacznik jest jedynym miejscem,
//      w ktorym zapada zgoda na pokazanie pliku uczestnikom. Domyslnie
//      opublikowany material znaczylby, ze cennik wrzucony do panelu na probe
//      stoi na stronie publicznej.
//   2. RODZAJ PLIKU JEDZIE W LADUNKU I MA PELNY SLOWNIK. `logo_pack` to paczka
//      do pobrania, `link` to wyjscie na zewnatrz, `video` odtwarzacz - rodzaj
//      steruje ikona i zachowaniem odnosnika, wiec nie jest ozdoba.
//   3. ADRES JEST WYMAGANY I SPRAWDZANY. Dopuszczamy `https://` oraz sciezke
//      wewnetrzna (paczki logotypow leza w naszym magazynie), ale nie `http://`
//      ani adresu bezprotokolowego `//...`, ktory na stronie po HTTPS
//      prowadzilby w nieoczekiwane miejsce.
//   4. TYTUL W OBU JEZYKACH - inaczej angielska wersja strony pokazuje pusta
//      pozycje z samym przyciskiem pobrania.
//   5. TRYB TWORZENIA I TRYB EDYCJI TO DWA ROZNE ZADANIA: nowy material niesie
//      `sponsorId`, poprawiany niesie `id` i NIE niesie tamtego.
//   6. ZAPIS W TOKU GASI OBA PRZYCISKI - drugie klikniecie to drugi wiersz
//      materialu o tym samym adresie.
//   7. NIEZNANY RODZAJ Z BAZY NIE WYWRACA FORMULARZA, tylko spada na `document`.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabel konwersji szkicu
// (`lib/events/sponsorDraft.test.ts`). (2) Parytetu slownika rodzajow z CHECK-iem
// bazy (`lib/events/__tests__/sponsorEnumParity.test.ts`). (3) Zapisu RPC -
// molekula dostaje `onSubmit` w propsie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import { SPONSOR_MATERIAL_KINDS, type SponsorMaterialInput } from "@/lib/events/sponsorsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Okno bierze z `sponsorsApi` wylacznie SLOWNIK rodzajow - klient bazy nie jest
// przedmiotem dowodu, a jego modul domaga sie konfiguracji przy imporcie.
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
    // jak odtworzyc tamtego identyfikatora, wiec nazywa okno sama.
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-label="formularz-materialu">
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

const { SponsorMaterialDialog } =
  await import("@/components/admin/events/molecules/SponsorMaterialDialog");

const SPONSOR = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "22222222-2222-4222-8222-222222222222";
const INNY_MATERIAL = "33333333-3333-4333-8333-333333333333";

const D = "adminEventSponsors.sponsors.materials.dialog.";
const BLAD = "adminEventSponsors.errors.";

/**
 * Material tak, jak przychodzi ze szczegolu przypiecia: kolumna `materials`
 * jest typu `Json`, wiec molekula dostaje LUZNY rekord, a nie wiersz o znanym
 * ksztalcie. Fixtura celowo trzyma ten sam luzny typ.
 */
function material(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MATERIAL,
    kind: "presentation",
    title_pl: "Prezentacja firmowa",
    title_en: "Company deck",
    url: "https://przyklad.example.com/deck.pdf",
    sort_order: 20,
    is_published: true,
    ...overrides,
  };
}

function renderuj(
  props: {
    open?: boolean;
    material?: Record<string, unknown> | null;
    nextSortOrder?: number;
    isSaving?: boolean;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: SponsorMaterialInput) => void>();
  const stan = {
    open: props.open ?? true,
    material: props.material ?? null,
    nextSortOrder: props.nextSortOrder ?? 30,
    isSaving: props.isSaving ?? false,
  };
  const drzewo = () => (
    <SponsorMaterialDialog
      open={stan.open}
      onOpenChange={onOpenChange}
      sponsorId={SPONSOR}
      material={stan.material}
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

const rodzaj = () => screen.getByLabelText(`${D}kind`);
const tytulPl = () => screen.getByLabelText(`${D}titlePl`);
const tytulEn = () => screen.getByLabelText(`${D}titleEn`);
const adres = () => screen.getByLabelText(`${D}url`);
const kolejnosc = () => screen.getByLabelText(`${D}sortOrder`);
const widocznosc = () => screen.getByLabelText(`${D}isPublished`);
const zapisz = () => screen.getByRole("button", { name: `${D}saveAction` });
const anuluj = () => screen.getByRole("button", { name: `${D}cancelAction` });

/** Minimum, ktore przepuszcza walidacje NOWEGO materialu. */
function wypelnijMinimum(url = "https://przyklad.example.com/materialy.zip") {
  fireEvent.change(tytulPl(), { target: { value: "Paczka logotypow" } });
  fireEvent.change(tytulEn(), { target: { value: "Logo pack" } });
  fireEvent.change(adres(), { target: { value: url } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("otwarcie, tryb i pozostalosc", () => {
  it("okno ZAMKNIETE nie renderuje formularza", () => {
    renderuj({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nowy material ma tytul tworzenia, puste pola i PODPOWIEDZIANA kolejnosc", () => {
    renderuj({ nextSortOrder: 40 });

    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeTruthy();
    expect(tytulPl()).toHaveValue("");
    expect(adres()).toHaveValue("");
    expect(kolejnosc()).toHaveValue("40");
  });

  it("edycja pokazuje tytul edycji i caly wiersz materialu", () => {
    renderuj({ material: material() });

    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeTruthy();
    expect(rodzaj()).toHaveValue("presentation");
    expect(tytulPl()).toHaveValue("Prezentacja firmowa");
    expect(tytulEn()).toHaveValue("Company deck");
    expect(adres()).toHaveValue("https://przyklad.example.com/deck.pdf");
    expect(kolejnosc()).toHaveValue("20");
  });

  it("otwarcie dla INNEGO materialu nie niesie poprzedniego", () => {
    const { przerysuj } = renderuj({ material: material() });
    przerysuj({
      material: material({ id: INNY_MATERIAL, kind: "link", title_pl: "Regulamin stoiska" }),
    });

    expect(rodzaj()).toHaveValue("link");
    expect(tytulPl()).toHaveValue("Regulamin stoiska");
  });

  it("nieznany rodzaj z bazy spada na `document`, a nie wywraca droplisty", () => {
    // Kolumna `materials` jest JSON-em - wartosc spoza CHECK-u moze tam trafic
    // z migracji danych albo ze starszej wersji panelu.
    renderuj({ material: material({ kind: "webinar" }) });

    expect(rodzaj()).toHaveValue("document");
  });

  it("material bez tytulu angielskiego pokazuje puste pole, a nie `undefined`", () => {
    renderuj({ material: material({ title_en: null }) });

    expect(tytulEn()).toHaveValue("");
  });
});

describe("rodzaj materialu", () => {
  it("droplista oferuje DOKLADNIE slownik bazy", () => {
    renderuj();

    const wartosci = Array.from(rodzaj().querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(wartosci).toEqual([...SPONSOR_MATERIAL_KINDS]);
  });

  it("nowy material rodzi sie DOKUMENTEM", () => {
    renderuj();

    expect(rodzaj()).toHaveValue("document");
  });

  it("wybrany rodzaj jedzie w ladunku", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(rodzaj(), { target: { value: "logo_pack" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].kind).toBe("logo_pack");
  });
});

describe("widocznosc publiczna - to ona decyduje, co zobaczy uczestnik", () => {
  it("nowy material jest WEWNETRZNY, dopoki nikt nie zdecyduje inaczej", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(zapisz());

    expect(widocznosc()).not.toBeChecked();
    expect(onSubmit.mock.calls[0][0].isPublished).toBe(false);
  });

  it("wlaczenie przelacznika publikuje material", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(widocznosc());
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].isPublished).toBe(true);
  });

  it("wycofanie opublikowanego materialu jedzie w ladunku jako `false`", () => {
    // Wycofanie musi byc JAWNE - pominiety klucz zostawilby material na stronie.
    const { onSubmit } = renderuj({ material: material({ is_published: true }) });
    expect(widocznosc()).toBeChecked();

    fireEvent.click(widocznosc());
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].isPublished).toBe(false);
  });

  it("material z bazy bez flagi publikacji jest traktowany jak wewnetrzny", () => {
    renderuj({ material: material({ is_published: null }) });

    expect(widocznosc()).not.toBeChecked();
  });
});

describe("adres materialu", () => {
  it.each([
    ["", "pustka - pozycja nie prowadzilaby nigdzie"],
    ["materialy.zip", "brak protokolu i brak sciezki"],
    ["http://przyklad.example.com/a.pdf", "HTTP na stronie po HTTPS"],
    ["//przyklad.example.com/a.pdf", "adres bezprotokolowy"],
    ["https://bezkropki", "adres bez domeny"],
  ])("adres %s nie przechodzi walidacji (%s)", (wartosc) => {
    const { onSubmit } = renderuj();
    fireEvent.change(tytulPl(), { target: { value: "Paczka" } });
    fireEvent.change(tytulEn(), { target: { value: "Pack" } });
    fireEvent.change(adres(), { target: { value: wartosc } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidUrl`)).toBeTruthy();
  });

  it.each([
    ["https://przyklad.example.com/paczka.zip", "pelny adres zewnetrzny"],
    ["/magazyn/paczka-logotypow.zip", "sciezka we wlasnym magazynie"],
  ])("adres %s przechodzi (%s)", (wartosc) => {
    const { onSubmit } = renderuj();
    wypelnijMinimum(wartosc);
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].url).toBe(wartosc);
  });

  it("komunikat o adresie pojawia sie DOPIERO po probie zapisu", () => {
    renderuj();
    fireEvent.change(adres(), { target: { value: "nie-adres" } });

    expect(screen.queryByText(`${BLAD}invalidUrl`)).toBeNull();

    fireEvent.click(zapisz());
    expect(screen.getByText(`${BLAD}invalidUrl`)).toBeTruthy();
  });
});

describe("tytuly i kolejnosc", () => {
  it("brak tytulu w ktorymkolwiek jezyku zatrzymuje zapis", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(tytulPl(), { target: { value: "Paczka" } });
    fireEvent.change(adres(), { target: { value: "https://przyklad.example.com/p.zip" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidTitles`)).toBeTruthy();
  });

  it("kolejnosc, ktora nie jest liczba, zatrzymuje zapis", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(kolejnosc(), { target: { value: "pierwszy" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidNumber`)).toBeTruthy();
  });

  it("tytuly jada PRZYCIETE", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(tytulPl(), { target: { value: "  Paczka  " } });
    fireEvent.change(tytulEn(), { target: { value: " Pack " } });
    fireEvent.change(adres(), { target: { value: " https://przyklad.example.com/p.zip " } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      titlePl: "Paczka",
      titleEn: "Pack",
      url: "https://przyklad.example.com/p.zip",
    });
  });
});

describe("ladunek: tworzenie kontra edycja", () => {
  it("NOWY material niesie przypiecie sponsora, a nie wlasny identyfikator", () => {
    const { onSubmit } = renderuj({ nextSortOrder: 40 });
    wypelnijMinimum();
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: undefined,
      sponsorId: SPONSOR,
      sortOrder: 40,
    });
  });

  it("EDYCJA niesie `id`, a NIE niesie przypiecia - materialu nie da sie przepiac", () => {
    const { onSubmit } = renderuj({ material: material() });
    fireEvent.change(tytulPl(), { target: { value: "Prezentacja 2026" } });
    fireEvent.click(zapisz());

    const ladunek = onSubmit.mock.calls[0][0];
    expect(ladunek.id).toBe(MATERIAL);
    expect(ladunek.sponsorId).toBeUndefined();
    expect(ladunek.titlePl).toBe("Prezentacja 2026");
  });
});

describe("zapis w toku i wyjscie z okna", () => {
  it("zapis w toku GASI oba przyciski", () => {
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
  // DEFEKT: `nextSortOrder` liczy sie z listy materialow, ktora odswieza sie
  // po KAZDEJ mutacji modulu (zapis innego materialu, publikacja sponsora,
  // powrot fokusa do okna przegladarki). Efekt czyszczacy szkic ma ja w tablicy
  // zaleznosci, wiec taka zmiana kasuje wpisany adres i tytuly bez slowa.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: odswiezenie listy materialow w tle (zmiana `nextSortOrder`) CZYSCI wypelniony formularz",
    () => {
      const { przerysuj } = renderuj({ nextSortOrder: 30 });
      wypelnijMinimum();

      przerysuj({ nextSortOrder: 40 });

      expect(tytulPl()).toHaveValue("Paczka logotypow");
      expect(adres()).toHaveValue("https://przyklad.example.com/materialy.zip");
    },
  );
});

describe("dostepnosc", () => {
  it("pusty formularz nie ma naruszen axe", async () => {
    const { container } = renderuj();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("formularz z komunikatami bledow nadal nie ma naruszen axe", async () => {
    const { container } = renderuj();
    fireEvent.click(zapisz());

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("komunikaty bledow sa ogloszone jako `alert`", () => {
    renderuj();
    fireEvent.click(zapisz());

    const alerty = screen.getAllByRole("alert").map((element) => element.textContent);
    expect(alerty).toContain(`${BLAD}invalidTitles`);
    expect(alerty).toContain(`${BLAD}invalidUrl`);
  });
});
