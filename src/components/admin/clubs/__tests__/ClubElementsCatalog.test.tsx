// Katalog elementów Klubu w panelu - SKLEJENIE katalogu operacyjnego.
//
// CO TEN PLIK DOWODZI. To nie jest strona poglądowa, tylko materiał, z którego
// pisze się SQL-a i odpowiedzi na zgłoszenia. Katalog, który pokazuje pięć
// z siedmiu kodów odmowy, jest gorszy niż jego brak - wygląda na kompletny.
// Dlatego:
//
//   1. KAŻDA SEKCJA RENDERUJE PEŁNY SŁOWNIK. Test jedzie po stałych z `types.ts`
//      (`CLUB_VISIBILITIES`, `CLUB_THREAD_KINDS`, `CLUB_ACCESS_REASONS`,
//      `CLUB_INVITE_ERRORS`, `CLUB_SAVE_ERRORS`, `CAPABILITY_KEYS`, …) i żąda
//      KAŻDEJ wartości na ekranie - nie „jakiejś liczby znaczników”. Gdyby
//      w widoku pojawiła się lokalna kopia słownika, ten test padnie przy
//      pierwszej wartości dopisanej do stałej.
//   2. LICZNIKI ZGADZAJĄ SIĘ ZE ZBIORAMI - przy zakładce i przy skrócie do
//      sekcji. Licznik to jedyna rzecz, po której operator widzi, czy szukanie
//      coś znalazło.
//   3. ZAKŁADKA POKAZUJE SWOJE SEKCJE I TYLKO SWOJE, a przełączenie działa.
//   4. SZUKANIE FILTRUJE PO SUROWEJ WARTOŚCI I PO TŁUMACZENIU, znika to, co ma
//      zniknąć (zbiory) i NIE znika to, co ma zostać (narzędzia: podgląd
//      dostępu, galeria, macierz).
//   5. KLIKNIĘCIE ZNACZNIKA KOPIUJE SUROWĄ WARTOŚĆ - nie etykietę. Trzy drogi:
//      sukces, odmowa schowka i BRAK API schowka (starsza przeglądarka) - żadna
//      nie może wywalić katalogu.
//   6. NARZĘDZIA POGLĄDOWE ODDAJĄ ZDARZENIA: przełączenie reakcji przelicza
//      liczniki, zmiana w podglądzie dostępu wraca do wersji roboczej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) REGUŁ katalogu - tabele przypadków
// (normalizacja, filtr osi, liczniki, co znika pod filtrem, przeliczenie
// reakcji) są w `lib/clubs/__tests__/adminElementsCatalog.test.ts`; tutaj
// dowodzimy, że organizm ich UŻYWA. (2) TONÓW I ETYKIET znaczników - atom
// `ClubBadges` ma 100% pokrycia i własny plik; tu sprawdzamy wyłącznie KOMPLET
// wartości. (3) ZAWARTOŚCI macierzy uprawnień - `capabilityMatrix` jest
// dokumentacją zachowania bazy i ma test kontraktowy; tutaj liczy się to, że
// każda komórka ma nazwę dla czytnika ekranu. (4) GALERII komponentów
// publicznych i ZAKŁADKI DOSTĘPU - mają własne pliki, tu są atrapami, bo
// przedmiotem dowodu jest sklejenie, nie ich wnętrze.
//
// Radix Tabs nie działa pod happy-dom bez pełnego pointer API - podmieniony na
// natywne odpowiedniki, w których treść zakładki istnieje TYLKO dla aktywnej
// wartości (tak jak w Radiksie bez `forceMount`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  activeTab: "vocab" as string,
  onTabChange: null as ((value: string) => void) | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  writeText: vi.fn(),
  /** Ostatnie liczniki reakcji, jakie organizm podał paskowi. */
  tallies: [] as { kind: string; total: number; mine: boolean }[],
  /** Ostatnia wersja robocza podglądu dostępu. */
  draft: { visibility: "", joinPolicy: "" },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/i18n-club-elements", () => ({ ensureClubElementsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => {
    h.activeTab = value;
    h.onTabChange = onValueChange;
    return (
      <div data-testid="tabs" data-value={value}>
        {children}
      </div>
    );
  },
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => (
    <button type="button" data-tab-trigger={value} onClick={() => h.onTabChange?.(value)}>
      {children}
    </button>
  ),
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) =>
    value === h.activeTab ? <div data-tab-content={value}>{children}</div> : null,
}));

// Atrapa zakładki dostępu: pokazuje wersję roboczą i oddaje JEDNĄ zmianę -
// tyle wystarczy, żeby dowieść, że łatka wraca do stanu organizmu.
vi.mock("@/components/admin/clubs/organisms/ClubAccessTab", () => ({
  ClubAccessTab: ({
    draft,
    onChange,
  }: {
    draft: { visibility: string; joinPolicy: string };
    onChange: (patch: { visibility: string }) => void;
  }) => {
    h.draft = { visibility: draft.visibility, joinPolicy: draft.joinPolicy };
    return (
      <div data-testid="access-tab" data-visibility={draft.visibility}>
        <button type="button" onClick={() => onChange({ visibility: "public" })}>
          otwórz klub
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/organisms/ClubElementsGallery", () => ({
  ClubElementsGallery: () => <div data-testid="gallery" />,
}));

// Atrapa paska reakcji: przycisk na rodzaj, każdy oddaje `onToggle` z aktualnym
// stanem własnej reakcji - tak sprawdzamy przeliczenie liczników.
vi.mock("@/components/clubs/molecules/ClubReactionBar", () => ({
  ClubReactionBar: ({
    tallies,
    variant,
    onToggle,
  }: {
    tallies: readonly { kind: string; total: number; mine: boolean }[];
    variant?: string;
    onToggle: (kind: string, active: boolean) => void;
  }) => {
    h.tallies = tallies.map((tally) => ({ ...tally }));
    return (
      <div data-testid={`reactions-${variant ?? "full"}`}>
        {tallies.map((tally) => (
          <button
            key={tally.kind}
            type="button"
            data-kind={tally.kind}
            data-total={String(tally.total)}
            data-mine={String(tally.mine)}
            onClick={() => onToggle(tally.kind, tally.mine)}
          >
            {tally.kind}
          </button>
        ))}
      </div>
    );
  },
}));

import { ClubElementsCatalog } from "@/components/admin/clubs/organisms/ClubElementsCatalog";
import {
  CATALOG_SECTION_SIZE,
  CATALOG_VOCAB_CARDS,
  catalogGroupSize,
} from "@/lib/clubs/adminElementsCatalog";
import { CAPABILITY_KEYS, CAPABILITY_ROLES } from "@/lib/clubs/capabilityMatrix";
import {
  CLUB_ACCESS_REASONS,
  CLUB_GROUP_STATUSES,
  CLUB_INVITE_ERRORS,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_REACTION_KINDS,
  CLUB_SAVE_ERRORS,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
} from "@/lib/clubs/types";

/** Sekcja katalogu po kotwicy - asercje idą po sekcji, nie po całej stronie. */
function sekcja(id: string): HTMLElement {
  const node = document.getElementById(`club-elements-${id}`);
  if (!node) throw new Error(`test: brak sekcji ${id}`);
  return node;
}

function pole(): HTMLElement {
  return screen.getByLabelText("clubElements.ui.searchLabel");
}

function szukaj(value: string): void {
  fireEvent.change(pole(), { target: { value } });
}

function zakladka(id: string): void {
  fireEvent.click(document.querySelector(`[data-tab-trigger="${id}"]`) as HTMLElement);
}

/** Surowe wartości widoczne w sekcji - znacznik renderuje je w `<code>`. */
function wartosci(id: string): string[] {
  return [...sekcja(id).querySelectorAll("code")].map((node) => node.textContent ?? "");
}

beforeEach(() => {
  cleanup();
  h.activeTab = "vocab";
  h.onTabChange = null;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: h.writeText },
  });
  render(<ClubElementsCatalog />);
});

// --- 1. komplet słowników --------------------------------------------------

describe("słowniki bazy - PEŁNE zbiory, nie podzbiory", () => {
  it("sekcja słowników klubu pokazuje KAŻDĄ wartość KAŻDEJ osi", () => {
    const widoczne = wartosci("vocab");
    for (const axis of CATALOG_VOCAB_CARDS.vocab.flat()) {
      for (const value of axis.values) expect(widoczne, axis.labelKey).toContain(value);
    }
    expect(widoczne).toHaveLength(CATALOG_SECTION_SIZE.vocab);
  });

  it("sekcja słowników wątku pokazuje komplet - w tym OBIE grupy reakcji", () => {
    const widoczne = wartosci("threadVocab");
    for (const axis of CATALOG_VOCAB_CARDS.threadVocab.flat()) {
      for (const value of axis.values) expect(widoczne, axis.labelKey).toContain(value);
    }
    expect(widoczne).toHaveLength(CATALOG_SECTION_SIZE.threadVocab);
  });

  it("sekcja słowników operacyjnych pokazuje komplet", () => {
    const widoczne = wartosci("opsVocab");
    for (const axis of CATALOG_VOCAB_CARDS.opsVocab.flat()) {
      for (const value of axis.values) expect(widoczne, axis.labelKey).toContain(value);
    }
    expect(widoczne).toHaveLength(CATALOG_SECTION_SIZE.opsVocab);
  });

  it("wartość niesie SUROWY kod i klucz tłumaczenia obok siebie", () => {
    const znacznik = within(sekcja("vocab")).getByText("chatham").closest("button");
    expect(znacznik).not.toBeNull();
    expect(znacznik?.textContent).toContain("club.attribution.chatham");
  });

  it("znaczniki stanu pokazują PEŁNE pięć słowników", () => {
    zakladka("components");
    const sekcjaZnacznikow = sekcja("badges");
    for (const value of CLUB_STATUSES) {
      expect(within(sekcjaZnacznikow).getByText(`club.status.${value}`)).toBeInTheDocument();
    }
    for (const value of CLUB_GROUP_STATUSES) {
      expect(within(sekcjaZnacznikow).getByText(`club.groupStatus.${value}`)).toBeInTheDocument();
    }
    for (const value of CLUB_VISIBILITIES) {
      expect(within(sekcjaZnacznikow).getByText(`club.visibility.${value}`)).toBeInTheDocument();
    }
    for (const value of CLUB_MEMBER_ROLES) {
      expect(within(sekcjaZnacznikow).getByText(`club.role.${value}`)).toBeInTheDocument();
    }
    for (const value of CLUB_MEMBER_STATUSES) {
      expect(within(sekcjaZnacznikow).getByText(`club.memberStatus.${value}`)).toBeInTheDocument();
    }
  });

  it("kody odmowy dostępu są WSZYSTKIE, każdy ze swoim zdaniem", () => {
    zakladka("codes");
    const sekcjaPowodow = sekcja("reasons");
    for (const code of CLUB_ACCESS_REASONS) {
      expect(within(sekcjaPowodow).getByText(code)).toBeInTheDocument();
      expect(within(sekcjaPowodow).getByText(`club.reason.${code}`)).toBeInTheDocument();
    }
  });

  it("kody błędów zaproszeń i zapisu są WSZYSTKIE, w dwóch kartach", () => {
    zakladka("codes");
    const sekcjaBledow = sekcja("errors");
    for (const code of CLUB_INVITE_ERRORS) {
      expect(
        within(sekcjaBledow).getByText(`adminClubs.invitations.error.${code}`),
      ).toBeInTheDocument();
    }
    for (const code of CLUB_SAVE_ERRORS) {
      expect(within(sekcjaBledow).getByText(`adminClubs.create.error.${code}`)).toBeInTheDocument();
    }
    expect(within(sekcjaBledow).getByText("clubElements.errors.invite")).toBeInTheDocument();
    expect(within(sekcjaBledow).getByText("clubElements.errors.save")).toBeInTheDocument();
  });

  it("macierz uprawnień ma wiersz na KAŻDĄ zdolność i kolumnę na KAŻDĄ rolę", () => {
    zakladka("rules");
    const macierz = sekcja("matrix");
    for (const key of CAPABILITY_KEYS) {
      expect(within(macierz).getByText(key)).toBeInTheDocument();
    }
    for (const role of CAPABILITY_ROLES) {
      expect(within(macierz).getByText(role)).toBeInTheDocument();
    }
    // Komórek dokładnie tyle, ile iloczyn - żadna nie została pominięta.
    expect(macierz.querySelectorAll("tbody td").length).toBe(
      CAPABILITY_KEYS.length * (CAPABILITY_ROLES.length + 1),
    );
  });

  it("każda komórka macierzy ma nazwę dla czytnika ekranu", () => {
    zakladka("rules");
    const macierz = sekcja("matrix");
    const legendy = [...macierz.querySelectorAll("tbody .sr-only")].map(
      (node) => node.textContent ?? "",
    );
    expect(legendy).toHaveLength(CAPABILITY_KEYS.length * CAPABILITY_ROLES.length);
    // Wszystkie trzy stany występują - macierz nie jest jednolita.
    expect(new Set(legendy)).toEqual(
      new Set([
        "clubElements.matrix.legendYes",
        "clubElements.matrix.legendCond",
        "clubElements.matrix.legendNo",
      ]),
    );
  });
});

// --- 2. liczniki i zakładki ------------------------------------------------

describe("liczniki i zakładki", () => {
  it("licznik przy zakładce to suma jej sekcji", () => {
    for (const group of ["vocab", "components", "rules", "codes"]) {
      const trigger = document.querySelector(`[data-tab-trigger="${group}"]`);
      expect(trigger?.textContent, group).toContain(String(catalogGroupSize(group)));
    }
  });

  it("skrót do sekcji niesie licznik jej zbioru", () => {
    const skroty = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(skroty.map((link) => link.getAttribute("href"))).toEqual([
      "#club-elements-vocab",
      "#club-elements-threadVocab",
      "#club-elements-opsVocab",
    ]);
    expect(skroty[0].textContent).toContain(String(CATALOG_SECTION_SIZE.vocab));
  });

  it("zakładka pokazuje SWOJE sekcje i tylko swoje", () => {
    expect(document.getElementById("club-elements-vocab")).not.toBeNull();
    expect(document.getElementById("club-elements-matrix")).toBeNull();

    zakladka("rules");
    expect(document.getElementById("club-elements-matrix")).not.toBeNull();
    expect(document.getElementById("club-elements-vocab")).toBeNull();
    const skroty = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(skroty.map((link) => link.getAttribute("href"))).toEqual([
      "#club-elements-access",
      "#club-elements-matrix",
    ]);
  });

  it("zakładka komponentów niesie znaczniki, galerię i pasek reakcji", () => {
    zakladka("components");
    expect(document.getElementById("club-elements-badges")).not.toBeNull();
    expect(screen.getByTestId("gallery")).toBeInTheDocument();
    expect(screen.getByTestId("reactions-full")).toBeInTheDocument();
    expect(screen.getByTestId("reactions-compact")).toBeInTheDocument();
  });
});

// --- 3. szukanie ----------------------------------------------------------

describe("szukanie", () => {
  it("filtruje po SUROWEJ wartości - zostaje jedna oś", () => {
    szukaj("chatham");
    expect(wartosci("vocab")).toEqual(["chatham"]);
  });

  it("filtruje po TŁUMACZENIU (klucz i18n) bez akcentów i wielkości liter", () => {
    szukaj("JOINPOLICY");
    expect(wartosci("vocab")).toEqual([...CATALOG_VOCAB_CARDS.vocab[0][1].values]);
  });

  it("trafienie w etykietę osi zostawia CAŁĄ oś", () => {
    szukaj("clubElements.vocab.layout");
    expect(wartosci("vocab")).toEqual(["list", "cards", "magazine", "editorial"]);
  });

  it("czyszczenie pola przywraca pełny katalog", () => {
    szukaj("chatham");
    expect(wartosci("vocab")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("clubElements.ui.clear"));
    expect(pole()).toHaveValue("");
    expect(wartosci("vocab")).toHaveLength(CATALOG_SECTION_SIZE.vocab);
  });

  it("przycisk czyszczenia pojawia się TYLKO przy niepustym szukaniu", () => {
    expect(screen.queryByLabelText("clubElements.ui.clear")).not.toBeInTheDocument();
    szukaj("x");
    expect(screen.getByLabelText("clubElements.ui.clear")).toBeInTheDocument();
  });

  it("brak trafień pokazuje kartę „nic nie znaleziono” z drogą powrotu", () => {
    szukaj("zzz");
    expect(screen.getByText("clubElements.ui.noResults")).toBeInTheDocument();
    expect(screen.getByText("clubElements.ui.noResultsHint")).toBeInTheDocument();
    fireEvent.click(screen.getByText("clubElements.ui.clear"));
    expect(screen.queryByText("clubElements.ui.noResults")).not.toBeInTheDocument();
    expect(wartosci("vocab")).toHaveLength(CATALOG_SECTION_SIZE.vocab);
  });

  it.fails("trafienie w SŁOWNIKU nie powinno ogłaszać pustki w całym katalogu", () => {
    szukaj("chatham");
    // Wartość jest na ekranie…
    expect(within(sekcja("vocab")).getByText("chatham")).toBeInTheDocument();
    // …a katalog RÓWNOCZEŚNIE mówi „nic nie znaleziono”, bo `catalogNothingFound`
    // dostaje liczniki wyłącznie z kodów odmowy i macierzy - sekcje słownikowe
    // nie biorą udziału w tej decyzji. Operator widzi jedno i drugie naraz.
    expect(screen.queryByText("clubElements.ui.noResults")).not.toBeInTheDocument();
  });

  it("sekcja kodów odmowy ZNIKA, gdy filtr nic w niej nie zostawił", () => {
    zakladka("codes");
    szukaj("slug");
    expect(document.getElementById("club-elements-reasons")).toBeNull();
    // Karta błędów zapisu zostaje, karta zaproszeń znika - to dwa różne zbiory.
    const sekcjaBledow = sekcja("errors");
    expect(within(sekcjaBledow).getByText("clubElements.errors.save")).toBeInTheDocument();
    expect(within(sekcjaBledow).queryByText("clubElements.errors.invite")).not.toBeInTheDocument();
  });

  it("cała sekcja błędów znika, gdy filtr nie zostawił ŻADNEGO kodu", () => {
    zakladka("codes");
    szukaj("zzz");
    expect(document.getElementById("club-elements-errors")).toBeNull();
    expect(document.getElementById("club-elements-reasons")).toBeNull();
  });

  it("sekcja znaczników znika pod filtrem, który nie trafia w jej tytuł", () => {
    zakladka("components");
    szukaj("zzz");
    expect(document.getElementById("club-elements-badges")).toBeNull();
    // …i wraca, gdy filtr trafia w tytuł sekcji.
    szukaj("section.badges");
    expect(document.getElementById("club-elements-badges")).not.toBeNull();
  });

  it("NARZĘDZIA nie znikają pod filtrem - galeria, dostęp i macierz zostają", () => {
    szukaj("zzz");
    zakladka("components");
    expect(document.getElementById("club-elements-gallery")).not.toBeNull();
    expect(document.getElementById("club-elements-reactions")).not.toBeNull();
    zakladka("rules");
    expect(document.getElementById("club-elements-access")).not.toBeNull();
    expect(document.getElementById("club-elements-matrix")).not.toBeNull();
  });

  it("macierz filtruje się po nazwie zdolności, nagłówek zostaje", () => {
    zakladka("rules");
    szukaj("moderate");
    const macierz = sekcja("matrix");
    expect(macierz.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(within(macierz).getByText("can_moderate")).toBeInTheDocument();
    expect(within(macierz).getByText("clubElements.matrix.capability")).toBeInTheDocument();
  });

  it.fails("karta słownika BEZ ANI JEDNEGO widocznego wiersza nadal renderuje pustą ramkę", () => {
    szukaj("zzz");
    // `ClubInboxCatalogVocabCard` sprawdza `children.every(child => child === null)`,
    // ale `children` to ELEMENTY Reacta (obiekty zawsze prawdziwe), a nie ich
    // wynik - warunek nigdy się tu nie domyka. Skutkiem jest pusta ramka pod
    // filtrem, dokładnie tam, gdzie komentarz obiecuje, że karta znika.
    // Sam warunek działa dla wejść z `null` - dowód w
    // `ClubInboxCatalogVocabCard.test.tsx`. Defekt jest w SPOSOBIE użycia:
    // karta powinna dostawać DANE wierszy, nie gotowe elementy.
    expect(sekcja("vocab").querySelectorAll(".rounded-xl")).toHaveLength(0);
  });
});

// --- 4. kopiowanie do schowka ---------------------------------------------

describe("kopiowanie wartości", () => {
  it("kopiuje SUROWĄ wartość, nie etykietę, i potwierdza toastem", async () => {
    fireEvent.click(within(sekcja("vocab")).getByText("chatham"));
    expect(h.writeText).toHaveBeenCalledWith("chatham");
    await vi.waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("clubElements.ui.copied(value=chatham)"),
    );
  });

  it("odmowa schowka mówi o błędzie, a nie udaje sukcesu", async () => {
    h.writeText.mockRejectedValueOnce(new Error("odmowa"));
    fireEvent.click(within(sekcja("vocab")).getByText("secret"));
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith("clubElements.ui.copyFailed"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("BRAK API schowka nie wywala katalogu i nie kłamie o skopiowaniu", () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    fireEvent.click(within(sekcja("vocab")).getByText("digest"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
    expect(within(sekcja("vocab")).getByText("digest")).toBeInTheDocument();
  });
});

// --- 5. narzędzia poglądowe ------------------------------------------------

describe("narzędzia poglądowe", () => {
  it("pasek reakcji startuje z KOMPLETEM rodzajów i niezerowymi licznikami", () => {
    zakladka("components");
    expect(h.tallies.map((tally) => tally.kind)).toEqual([...CLUB_REACTION_KINDS]);
    expect(h.tallies.find((tally) => tally.kind === "insightful")).toEqual({
      kind: "insightful",
      total: 7,
      mine: true,
    });
  });

  it("postawienie reakcji podnosi licznik, cofnięcie go obniża", () => {
    zakladka("components");
    const pasek = screen.getByTestId("reactions-full");
    // `agree` nie jest postawiona - kliknięcie ją stawia.
    fireEvent.click(within(pasek).getByText("agree"));
    expect(h.tallies.find((tally) => tally.kind === "agree")).toEqual({
      kind: "agree",
      total: 6,
      mine: true,
    });
    // `insightful` jest postawiona - kliknięcie ją cofa.
    fireEvent.click(within(screen.getByTestId("reactions-full")).getByText("insightful"));
    expect(h.tallies.find((tally) => tally.kind === "insightful")).toEqual({
      kind: "insightful",
      total: 6,
      mine: false,
    });
  });

  it("oba warianty paska dostają TEN SAM stan liczników", () => {
    zakladka("components");
    fireEvent.click(within(screen.getByTestId("reactions-compact")).getByText("thanks"));
    const pelny = screen.getByTestId("reactions-full").querySelector('[data-kind="thanks"]');
    const zwarty = screen.getByTestId("reactions-compact").querySelector('[data-kind="thanks"]');
    expect(pelny?.getAttribute("data-total")).toBe("1");
    expect(zwarty?.getAttribute("data-total")).toBe("1");
  });

  it("podgląd dostępu startuje z zamkniętego klubu i przyjmuje łatkę", () => {
    zakladka("rules");
    expect(screen.getByTestId("access-tab")).toHaveAttribute("data-visibility", "members");
    fireEvent.click(screen.getByText("otwórz klub"));
    expect(screen.getByTestId("access-tab")).toHaveAttribute("data-visibility", "public");
    // Łatka NADPISUJE jedno pole, a nie całą wersję roboczą.
    expect(h.draft.joinPolicy).toBe("invite");
  });
});
