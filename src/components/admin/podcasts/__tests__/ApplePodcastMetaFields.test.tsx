// CO DOWODZI TEN PLIK
//
// Formularz metadanych Apple Podcasts Connect. To jedyne miejsce, w którym
// redakcja wpisuje tagi wymagane przez katalog: kategorię, `explicit`, e-mail
// właściciela, wydawcę i okładkę. Komponent jest w PEŁNI STEROWANY - nie ma
// stanu wewnętrznego - więc przedmiotem dowodu jest ŁATKA, którą oddaje do
// góry (`onChange`), a nie wygląd pola. Zgubiona albo pomylona nazwa pola
// w łatce znaczy, że redakcja wpisuje wartość, która nigdy nie dojedzie do
// bazy, a kanał zostaje odrzucony przez Apple z powodem „brak tagu".
//
// Trzy rzeczy poza samą łatką:
//   1. WARTOŚĆ DZIEDZICZONA / NIEZNANA. Kategoria z bazy poza taksonomią Apple
//      renderuje się jako domyślna („News"), ale `onChange` NIE jest wołany -
//      więc panel pokazuje jedno, a baza trzyma drugie. To rozjazd UI-baza
//      i jest tu PRZYPIĘTY jako dzisiejsze zachowanie.
//   2. STAN WYŁĄCZONY. Cztery kategorie Apple nie mają podkategorii; select
//      podkategorii musi być wtedy wyłączony, a nie pusty i klikalny.
//   3. ZERO SUROWYCH KLUCZY i18n na ekranie (tłumacz prawdziwy, więc
//      zniknięcie klucza z PL/EN oblewa ten plik).
//
// Radixowy Select i Switch nie otwierają się pod happy-dom, więc jadą wspólne
// atrapy z `@/test/reactStubs` - reguła siedzi w `onValueChange`/`onCheckedChange`
// i to ona jest tu mierzona.
//
// CZEGO NIE DUBLUJE: taksonomii kategorii (`applePodcastCategories.test.ts`),
// reguły gotowości (`src/lib/podcast/__tests__/applePodcast.test.ts`) ani
// parytetu słownika (`src/lib/__tests__/i18nAdminPodcasts.test.ts`).
//
// RODO: adresy wyłącznie na `example.com` / `example.org`, nazwy audycji
// i wydawcy zmyślone.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

import "@/test/i18nReal";
// Nakładka rejestruje klucze `adminPodcasts.*` efektem ubocznym importu -
// komponent nie importuje jej sam (robi to trasa panelu).
import "@/lib/i18n-admin-podcasts";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { APPLE_CATEGORY_NAMES, appleSubcategories } from "@/lib/seo/applePodcastCategories";
import { ApplePodcastMetaFields, type ApplePodcastMetaValue } from "../ApplePodcastMetaFields";

const t = realT("pl");
const napis = (kod: string): string => t(`adminPodcasts.settings.apple.${kod}`);

const PELNA: ApplePodcastMetaValue = {
  author: "Instytut Spraw Zmyslonych",
  ownerName: "Redakcja Brukseli na Wschodzie",
  ownerEmail: "redakcja@example.com",
  category: "News",
  subcategory: "Politics",
  explicit: false,
  showType: "episodic",
  imageUrl: "https://cdn.example.org/okladka-3000.jpg",
  copyright: "(c) Instytut Spraw Zmyslonych",
};

function render(patch: Partial<ApplePodcastMetaValue> = {}) {
  const onChange = vi.fn();
  const wynik = renderWithQueryClient(
    <ApplePodcastMetaFields value={{ ...PELNA, ...patch }} onChange={onChange} />,
  );
  return { ...wynik, onChange };
}

/** Kontrolka spod etykiety - dokładnie tak, jak znajduje ją redakcja. */
function pole(kod: string): HTMLElement {
  return screen.getByLabelText(napis(kod));
}

function opcje(kod: string): string[] {
  const select = pole(kod);
  return [...select.querySelectorAll("option")].map((o) => o.textContent ?? "");
}

describe("ApplePodcastMetaFields - pola tekstowe oddają łatkę z właściwą nazwą", () => {
  const POLA: ReadonlyArray<[string, keyof ApplePodcastMetaValue, string]> = [
    ["author", "author", "Fundacja Analiz Zmyslonych"],
    ["ownerName", "ownerName", "Zespol podcastu"],
    ["ownerEmail", "ownerEmail", "podcast@example.org"],
    ["image", "imageUrl", "https://cdn.example.org/nowa-3000.jpg"],
    ["copyright", "copyright", "(c) 2026 Fundacja Analiz Zmyslonych"],
  ];

  it.each(POLA)("pole %s zmienia wyłącznie klucz %s", (kod, klucz, wartosc) => {
    const { onChange } = render();
    fireEvent.change(pole(kod), { target: { value: wartosc } });
    // Łatka musi być JEDNOPOLOWA - nadmiarowy klucz nadpisałby wartość, której
    // redakcja w tym momencie nie tknęła.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ [klucz]: wartosc });
  });

  it("pole e-maila jest polem e-maila, nie zwykłym tekstem", () => {
    // `type="email"` i `inputMode` to jedyna walidacja, jaką formularz w ogóle
    // ma; kształt adresu sprawdza reguła gotowości, nie to pole.
    render();
    const email = pole("ownerEmail");
    expect(email.getAttribute("type")).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("email");
  });

  it("pole okładki podpowiada wymagany kwadrat w podpowiedzi adresu", () => {
    render();
    expect(pole("image").getAttribute("placeholder")).toContain("3000x3000");
  });

  it("puste pole tekstowe oddaje pusty napis, a nie brak klucza", () => {
    // Wyczyszczenie pola MUSI dojechać do bazy jako „wymaż", inaczej redakcja
    // nie ma jak usunąć błędnej wartości.
    const { onChange } = render();
    fireEvent.change(pole("author"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ author: "" });
  });
});

describe("ApplePodcastMetaFields - kategoria i podkategoria", () => {
  it("wystawia PEŁNĄ taksonomię Apple i nic poza nią", () => {
    render();
    expect(opcje("category")).toEqual([...APPLE_CATEGORY_NAMES]);
  });

  it("zmiana kategorii ZERUJE podkategorię w tej samej łatce", () => {
    // Apple odrzuca podkategorię obcą wobec kategorii, więc obie wartości
    // muszą zmienić się jednym zapisem - inaczej między dwoma zapisami
    // istnieje stan, którego katalog nie przyjmie.
    const { onChange } = render();
    fireEvent.change(pole("category"), { target: { value: "Business" } });
    expect(onChange).toHaveBeenCalledWith({ category: "Business", subcategory: "" });
  });

  it("podkategorie pochodzą z wybranej kategorii, a przed nimi stoi opcja braku", () => {
    render();
    expect(opcje("subcategory")).toEqual([napis("subcategoryNone"), ...appleSubcategories("News")]);
  });

  it("wybór podkategorii oddaje jej nazwę", () => {
    const { onChange } = render({ subcategory: "" });
    fireEvent.change(pole("subcategory"), { target: { value: "Daily News" } });
    expect(onChange).toHaveBeenCalledWith({ subcategory: "Daily News" });
  });

  it("opcja braku podkategorii oddaje PUSTY napis, a nie wartownika", () => {
    // `__none__` w kolumnie `itunes_subcategory` pojechałoby do feedu jako
    // nazwa podkategorii, której Apple nie zna.
    const { onChange } = render();
    fireEvent.change(pole("subcategory"), { target: { value: "__none__" } });
    expect(onChange).toHaveBeenCalledWith({ subcategory: "" });
  });

  it("kategoria bez podkategorii WYŁĄCZA select i zostawia samą opcję braku", () => {
    render({ category: "History", subcategory: "" });
    const select = pole("subcategory");
    expect(select).toBeDisabled();
    expect(opcje("subcategory")).toEqual([napis("subcategoryNone")]);
  });

  it("nieznana kategoria z bazy pokazuje domyślną, ale NIE zapisuje jej", () => {
    // PRZYPIĘTE dzisiejsze zachowanie i rozjazd, który z niego wynika: panel
    // pokazuje „News", baza trzyma „Polityka europejska", a feed emituje
    // kategorię domyślną. Reguła gotowości (`applePodcastGaps`) jest jedynym
    // czujnikiem, który to wygaduje - dlatego karta gotowości musi istnieć.
    const { onChange } = render({ category: "Polityka europejska", subcategory: "Politics" });
    expect((pole("category") as HTMLSelectElement).value).toBe("News");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("podkategoria obca wobec kategorii spada na opcję braku, bez zapisu", () => {
    const { onChange } = render({ category: "Business", subcategory: "Politics" });
    expect((pole("subcategory") as HTMLSelectElement).value).toBe("__none__");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ApplePodcastMetaFields - typ kanału i explicit", () => {
  it.each([
    ["serial", "serial"],
    ["episodic", "episodic"],
  ])("typ kanału %s oddaje %s", (wybor, oczekiwany) => {
    const { onChange } = render({ showType: wybor === "serial" ? "episodic" : "serial" });
    fireEvent.change(pole("showType"), { target: { value: wybor } });
    expect(onChange).toHaveBeenCalledWith({ showType: oczekiwany });
  });

  it("typ kanału wystawia dokładnie dwie nazwane opcje ze słownika", () => {
    render();
    expect(opcje("showType")).toEqual([napis("showTypeEpisodic"), napis("showTypeSerial")]);
  });

  it("przełącznik explicit oddaje true, gdy był wyłączony", () => {
    const { onChange } = render({ explicit: false });
    const przelacznik = screen.getByRole("switch");
    expect(przelacznik).not.toBeChecked();
    fireEvent.click(przelacznik);
    expect(onChange).toHaveBeenCalledWith({ explicit: true });
  });

  it("przełącznik explicit oddaje false, gdy był włączony", () => {
    // Zła deklaracja treści to zdjęcie audycji z katalogu, więc droga POWROTNA
    // musi działać tak samo pewnie jak zapalenie flagi.
    const { onChange } = render({ explicit: true });
    const przelacznik = screen.getByRole("switch");
    expect(przelacznik).toBeChecked();
    fireEvent.click(przelacznik);
    expect(onChange).toHaveBeenCalledWith({ explicit: false });
  });

  it("przełącznik ma nazwę dostępną, mimo że etykieta nie jest polem `label for`", () => {
    render();
    expect(screen.getByRole("switch").getAttribute("aria-label")).toBe(napis("explicit"));
  });
});

describe("ApplePodcastMetaFields - słownik i dostępność", () => {
  it("pokazuje nagłówek sekcji i podpowiedzi tylko tam, gdzie są przewidziane", () => {
    const { container } = render();
    expect(screen.getByRole("heading", { name: napis("heading") })).toBeInTheDocument();
    expect(screen.getByText(napis("intro"))).toBeInTheDocument();
    expect(screen.getByText(napis("ownerEmailHint"))).toBeInTheDocument();
    expect(screen.getByText(napis("imageHint"))).toBeInTheDocument();
    // MARTWY KLUCZ: `authorHint` żyje w PL i EN, ale żadne pole go nie
    // renderuje. Parytet PL/EN tego nie łapie, bo klucz jest w obu bundlach.
    expect(container.textContent ?? "").not.toContain(napis("authorHint"));
  });

  it("nie zostawia surowego klucza i18n na ekranie", () => {
    const { container } = render();
    expect(container.textContent ?? "").not.toContain("adminPodcasts.");
  });

  it("każde pole formularza ma etykietę - bez naruszeń dostępności", async () => {
    const { container } = render();
    const violations = await axeViolations(container);
    expect(summarize(violations)).toBe("");
  });
});
