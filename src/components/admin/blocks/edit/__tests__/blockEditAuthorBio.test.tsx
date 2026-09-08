// BIO AUTORA I POWIĄZANE WPISY (`author-bio`, `related-posts`) - STANY PUSTE,
// ODMOWY I WARTOŚCI SPOZA KATALOGU.
//
// PO CO OSOBNY PLIK. Przejazd tabeli (`blockEditMatrix.*`) montuje `author-bio`
// w JEDNYM, BOGATYM kształcie: autor inline z nazwiskiem, ze zdjęciem i z dwoma
// własnymi linkami, w wariancie „Karta profilu" (patrz `ALT_OVERRIDES` tamże).
// To świadoma decyzja tamtego pliku - bez niej połowa edytora w ogóle się nie
// montuje. Skutkiem ubocznym jest jednak to, że KAŻDA gałąź „czegoś NIE MA"
// pozostawała bez dowodu: autor bez zdjęcia, autor bez nazwiska, lista linków
// pusta, autor wskazany z bazy zamiast wpisanego ręcznie. A to są dokładnie te
// stany, w których redaktor pracuje NAJCZĘŚCIEJ - blok wstawiony z palety nie
// ma ani zdjęcia, ani linków.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * podgląd MÓWI, czym są pokazane dane: „przykładowe" przy autorze
//    z bieżącego wpisu, „uzupełnij dane" przy pustym autorze inline,
//    „(autor inline)" przy wypełnionym - i MILCZY, gdy autor jest wskazany
//    z bazy, bo wtedy widać jego prawdziwe dane,
//  * ustawienia karty profilu przyjmują liczbę ZAPISANĄ JAKO NAPIS (tak
//    wracają z formularza po zapisie dokumentu), a wyczyszczenie pola oznacza
//    POWRÓT DO DOMYŚLNEJ, nie zero pikseli,
//  * `authorId` w kształcie innym niż napis nie udaje wyboru autora,
//  * wyczyszczone pole liczby powiązanych wpisów wraca do 3, a nie do zera
//    (blok z zerem wpisów renderuje się na stronie jako pusta sekcja).
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch`, `<Link>` routera, klient Supabase,
// kontekst najemcy, `fetch`. i18n PRAWDZIWE (`realT`). Dane osobowe w
// fixture'ach są WYMYŚLONE, a wszystkie adresy wskazują `example.com`.
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { PROFILE_CARD_DEFAULTS } from "@/components/ui/profile-card";
import { AuthorBioBlock, RelatedPostsBlock } from "../PostContextBlocks";

const t = realT("pl");
const pc = (key: string) => t(`blocks.editors.postContextBlocks.${key}`) as string;

function bio(data: Record<string, Json>): Block {
  return { id: "ab1", type: "author-bio", data };
}

function powiazane(data: Record<string, Json>): Block {
  return { id: "rp1", type: "related-posts", data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

function poEtykiecie(container: HTMLElement, etykieta: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((l) =>
    (l.querySelector("span")?.textContent ?? "").trim().startsWith(etykieta),
  );
  const pole = label?.querySelector("input");
  if (!(pole instanceof HTMLInputElement)) throw new Error(`brak pola „${etykieta}"`);
  return pole;
}

function przyciskZTekstem(container: HTMLElement, tekst: string): HTMLElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(tekst),
  );
  if (!btn) throw new Error(`brak przycisku „${tekst}"`);
  return btn;
}

/** Etykieta podglądu - to ona mówi redaktorowi, CZYJE dane widzi. */
function etykietaPodgladu(container: HTMLElement): string {
  const naglowek = Array.from(container.querySelectorAll("div")).find((d) =>
    (d.textContent ?? "").includes(pc("previewPrefix")),
  );
  return naglowek?.textContent ?? "";
}

/** Wymyślony autor inline - żadnych danych realnej osoby, adresy na example.com. */
const AUTOR_INLINE: Record<string, Json> = {
  name: "Testowa Redaktorka",
  jobTitle: "Redaktorka prowadząca",
  contactEmail: "redakcja@example.com",
};

describe("bio autora - autor inline w stanie PUSTYM", () => {
  it("autor inline BEZ zdjęcia pokazuje zaproszenie do wgrania, nie pusty kadr", () => {
    // Blok wstawiony z palety i przełączony na autora własnego nie ma jeszcze
    // żadnego zdjęcia - przycisk musi wtedy mówić „wgraj", a nie „zmień".
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "inline", inlineAuthor: AUTOR_INLINE }),
    );
    expect(przyciskZTekstem(container, pc("uploadPhoto"))).toBeTruthy();
    expect(container.textContent).toContain(pc("none"));
    expect(
      Array.from(container.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes(pc("changePhoto")),
      ),
    ).toBe(false);
  });

  it("autor inline BEZ własnych linków wyjaśnia, po co one są", () => {
    // Pusta lista to nie brak sekcji: bez wyjaśnienia redaktor nie wie, że
    // brakującą ikonę platformy można wgrać samodzielnie.
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "inline", inlineAuthor: AUTOR_INLINE }),
    );
    expect(container.textContent).toContain(pc("noCustomLinks"));
    expect(container.querySelectorAll(`input[placeholder="${pc("linkName")}"]`)).toHaveLength(0);
  });

  it("`customSocials` w kształcie NIE-TABLICY daje pustą listę zamiast awarii", () => {
    // Złe wejście wymuszone przez `as unknown as Json` - taki kształt wychodzi
    // z ręcznie poprawianego dokumentu albo ze starszej wersji schematu.
    // Autor BEZ nazwiska, żeby przedmiotem asercji był sam FORMULARZ (podgląd
    // sięga po dane inline dopiero wtedy, gdy nazwisko jest wpisane).
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({
        authorSource: "inline",
        inlineAuthor: { customSocials: "brak" } as unknown as Json,
      }),
    );
    expect(container.textContent).toContain(pc("noCustomLinks"));
    expect(przyciskZTekstem(container, pc("addLink"))).toBeTruthy();
  });

  // DEFEKT: `customSocials` W ZŁYM KSZTAŁCIE WYWRACA CAŁY EDYTOR WPISU.
  //
  // WEJŚCIE: blok `author-bio` ze źródłem `inline`, autorem, który MA nazwisko,
  //   i polem `customSocials` w kształcie innym niż tablica (napis - tak wygląda
  //   dokument po ręcznej korekcie JSON-a albo po migracji ze starszego
  //   schematu, w którym linki trzymało się jako tekst).
  // CO PSUJE: formularz edytora broni się poprawnie
  //   (`Array.isArray(author.customSocials) ? … : []`,
  //   src/components/admin/blocks/edit/PostContextBlocks.tsx:74), ale ten sam
  //   obiekt idzie DALEJ - do podglądu `AuthorBioView` jako `authorOverride`
  //   (:540). Tam zabezpieczenia już nie ma: `(author.customSocials ?? [])
  //   .forEach(…)` (src/components/blocks/PostContextViews.tsx:179) wywołuje
  //   `forEach` na napisie i rzuca `TypeError`.
  // KONSEKWENCJA: wyjątek leci w RENDERZE, więc gaśnie nie sam blok, ale całe
  //   drzewo edytora wpisu - redaktor dostaje biały ekran i traci niezapisaną
  //   pracę. Dokładnie tej klasy awarii ma zapobiegać przejazd
  //   `blockEditRendererMatrix`, tyle że on montuje bloki na danych z palety,
  //   a ten kształt przychodzi z importu.
  // WYMAGANA POPRAWKA: `AuthorBioView` musi czytać `customSocials` tym samym
  //   strażnikiem, co formularz (`Array.isArray(...) ? ... : []`) - albo
  //   kształt autora musi być normalizowany raz, w jednym miejscu, zanim
  //   trafi do obu warstw.
  it.fails("DEFEKT: zły kształt `customSocials` NIE może wywracać podglądu bloku", () => {
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({
        authorSource: "inline",
        inlineAuthor: { ...AUTOR_INLINE, customSocials: "brak" } as unknown as Json,
      }),
    );
    expect(container.textContent).toContain(pc("noCustomLinks"));
  });

  it("autor inline BEZ nazwiska prosi o uzupełnienie danych, zamiast udawać podgląd", () => {
    // To jest stan tuż po przełączeniu źródła. Gdyby etykieta milczała,
    // redaktor widziałby kartę z danymi przykładowymi i uznał, że gotowe.
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "inline", inlineAuthor: {} }),
    );
    expect(etykietaPodgladu(container)).toContain(pc("previewFillInline"));
  });

  it("autor inline Z nazwiskiem mówi wprost, że podgląd bierze dane inline", () => {
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "inline", inlineAuthor: AUTOR_INLINE }),
    );
    expect(etykietaPodgladu(container)).toContain(pc("previewInline"));
  });

  it("ZAMKNIĘCIE wyboru ikony bez wskazania pliku nie zmienia danych linku", () => {
    // Odmowa w oknie mediów: redaktor otwiera wybór ikony i się rozmyśla.
    // Edytor musi wtedy wrócić do stanu „nic nie wybrano" (żaden link nie
    // zostaje w trybie edycji ikony) i NIE zapisać niczego do dokumentu.
    const { container, changes, baseElement } = renderEditor(
      AuthorBioBlock,
      bio({
        authorSource: "inline",
        inlineAuthor: {
          customSocials: [{ label: "Biuletyn", url: "https://example.com/biuletyn", iconUrl: "" }],
        } as unknown as Json,
      }),
    );
    const przyciskIkony = container.querySelector<HTMLElement>(
      `button[title="${pc("uploadIcon")}"]`,
    );
    fireEvent.click(przyciskIkony as HTMLElement);
    const okno = baseElement.querySelector('[role="dialog"]');
    expect(okno, "wybór ikony ma otworzyć okno mediów").not.toBeNull();
    fireEvent.keyDown(okno as Element, { key: "Escape" });
    expect(baseElement.querySelector('[role="dialog"]')).toBeNull();
    expect(changes).toEqual([]);
  });

  it("dodanie własnego linku dokłada PUSTĄ pozycję na koniec listy", () => {
    const { container, changes } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "inline", inlineAuthor: AUTOR_INLINE }),
    );
    fireEvent.click(przyciskZTekstem(container, pc("addLink")));
    const zapis = ostatniZapis(changes);
    const autor = zapis.data.inlineAuthor as Record<string, Json>;
    expect(autor.customSocials).toEqual([{ label: "", url: "", iconUrl: "" }]);
    // Reszta danych autora zostaje nietknięta - dodanie linku nie jest
    // nadpisaniem profilu.
    expect(autor.name).toBe(AUTOR_INLINE.name);
  });
});

describe("bio autora - autor wskazany z bazy", () => {
  it("BEZ wyboru autora podgląd zapowiada dane PRZYKŁADOWE", () => {
    const { container } = renderEditor(AuthorBioBlock, bio({}));
    expect(etykietaPodgladu(container)).toContain(pc("previewSample"));
  });

  it("PO wyborze autora podgląd nie dokleja już żadnego zastrzeżenia", () => {
    // Gdy autor jest wskazany, w podglądzie widać jego prawdziwe dane -
    // dopisek „(przykładowe dane)" byłby wtedy nieprawdą.
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "existing", authorId: "ekspert-1" }),
    );
    const etykieta = etykietaPodgladu(container);
    expect(etykieta).not.toContain(pc("previewSample"));
    expect(etykieta).not.toContain(pc("previewInline"));
    expect(etykieta).not.toContain(pc("previewFillInline"));
  });

  it("`authorId` w kształcie LICZBY nie udaje wyboru autora", () => {
    // Dokument po ręcznej edycji potrafi mieć tu liczbę. Taka wartość nie może
    // przejść dalej jako identyfikator - podgląd musi wrócić do danych
    // przykładowych, a nie odpytywać bazy o „12".
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "existing", authorId: 12 as unknown as Json }),
    );
    expect(etykietaPodgladu(container)).toContain(pc("previewSample"));
  });

  it("`inlineAuthor` jako TABLICA jest odrzucone - formularz startuje pusty", () => {
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ authorSource: "inline", inlineAuthor: [] as unknown as Json }),
    );
    expect(poEtykiecie(container, pc("fName")).value).toBe("");
    expect(etykietaPodgladu(container)).toContain(pc("previewFillInline"));
  });
});

describe("bio autora - ustawienia wariantu „Karta profilu”", () => {
  const kartaProfilu = (extra: Record<string, Json> = {}) => bio({ variant: "profile", ...extra });

  it("bez własnych ustawień pola pokazują wartości DOMYŚLNE karty", () => {
    // Panel i renderer publiczny mają jedno źródło domyślnych - gdyby panel
    // miał własne, redaktor widziałby inne liczby niż strona.
    const { container } = renderEditor(AuthorBioBlock, kartaProfilu());
    expect(poEtykiecie(container, pc("fImageSize")).value).toBe(
      String(PROFILE_CARD_DEFAULTS.imageSize),
    );
    expect(poEtykiecie(container, pc("fMaxWidth")).value).toBe(
      String(PROFILE_CARD_DEFAULTS.maxWidth),
    );
  });

  it("liczba zapisana w dokumencie ma pierwszeństwo przed domyślną", () => {
    const { container } = renderEditor(AuthorBioBlock, kartaProfilu({ imageSize: 320 }));
    expect(poEtykiecie(container, pc("fImageSize")).value).toBe("320");
  });

  it("liczba zapisana jako NAPIS jest przyjęta, a nie zamieniona na domyślną", () => {
    // Formularz HTML oddaje wartości jako napisy, więc po zapisie i odczycie
    // dokumentu w danych bywa "320" zamiast 320. Odrzucenie tego kształtu
    // cofałoby redaktorowi ustawienie przy każdym wejściu w blok.
    const { container } = renderEditor(
      AuthorBioBlock,
      kartaProfilu({ imageSize: "320" as unknown as Json }),
    );
    expect(poEtykiecie(container, pc("fImageSize")).value).toBe("320");
  });

  it("NAPIS niebędący liczbą wraca do wartości domyślnej, a nie do `NaN`", () => {
    const { container } = renderEditor(
      AuthorBioBlock,
      kartaProfilu({ imageSize: "duże" as unknown as Json }),
    );
    expect(poEtykiecie(container, pc("fImageSize")).value).toBe(
      String(PROFILE_CARD_DEFAULTS.imageSize),
    );
    expect(container.textContent).not.toContain("NaN");
  });

  it("WYCZYSZCZENIE pola liczbowego zapisuje powrót do domyślnej, a nie 0 px", () => {
    // Zero to legalna liczba, więc gdyby puste pole zapisywało `0`, karta
    // dostawałaby zdjęcie o boku 0 px zamiast wrócić do ustawienia domyślnego.
    const { container, changes } = renderEditor(AuthorBioBlock, kartaProfilu({ imageSize: 320 }));
    fireEvent.change(poEtykiecie(container, pc("fImageSize")), { target: { value: "" } });
    expect(ostatniZapis(changes).data.imageSize).toBe("");
  });

  it("cień zapisany w dokumencie jest pokazany, a nie nadpisany domyślnym", () => {
    const { container } = renderEditor(AuthorBioBlock, kartaProfilu({ shadow: "md" }));
    const wybor = Array.from(container.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "md"),
    );
    expect(wybor?.value).toBe("md");
  });

  it("przełącznik animacji zapisuje WYŁĄCZENIE, a nie tylko włączenie", () => {
    // `animate` jest kodowane idiomem „domyślnie włączone" (`!== false`),
    // więc jedyną zmianą, jaką da się zapisać, jest wyłączenie.
    const { container, changes } = renderEditor(AuthorBioBlock, kartaProfilu());
    const etykieta = Array.from(container.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").includes(pc("toggleAnimate")),
    );
    const przelacznik = etykieta?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(przelacznik?.checked, "animacja jest domyślnie włączona").toBe(true);
    fireEvent.click(przelacznik as HTMLInputElement);
    expect(ostatniZapis(changes).data.animate).toBe(false);
  });

  it("wariant SPOZA katalogu nie odsłania ustawień karty profilu", () => {
    const { container } = renderEditor(
      AuthorBioBlock,
      bio({ variant: "kosmiczny" as unknown as Json }),
    );
    expect(container.textContent).not.toContain(pc("profileStyleTitle"));
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("powiązane wpisy - liczba, strategia i układ", () => {
  it("bez danych pole liczby pokazuje domyślne 3", () => {
    const { container } = renderEditor(RelatedPostsBlock, powiazane({}));
    const liczba = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(liczba?.value).toBe("3");
  });

  it("WYCZYSZCZENIE pola liczby wraca do 3, a nie zapisuje zera", () => {
    // Zero powiązanych wpisów to sekcja, która renderuje się na stronie jako
    // pusty nagłówek bez treści - i nikt tego nie zauważa w panelu.
    const { container, changes } = renderEditor(RelatedPostsBlock, powiazane({ limit: 6 }));
    const liczba = container.querySelector<HTMLInputElement>('input[type="number"]');
    fireEvent.change(liczba as HTMLInputElement, { target: { value: "" } });
    expect(ostatniZapis(changes).data.limit).toBe(3);
  });

  it("wpisana liczba trafia do dokumentu jako LICZBA, nie napis", () => {
    const { container, changes } = renderEditor(RelatedPostsBlock, powiazane({}));
    const liczba = container.querySelector<HTMLInputElement>('input[type="number"]');
    fireEvent.change(liczba as HTMLInputElement, { target: { value: "8" } });
    expect(ostatniZapis(changes).data.limit).toBe(8);
  });

  it("nagłówek sekcji zapisuje się osobno i nie rusza pozostałych ustawień", () => {
    const { container, changes } = renderEditor(
      RelatedPostsBlock,
      powiazane({ strategy: "tag", layout: "compact" }),
    );
    const naglowek = container.querySelector<HTMLInputElement>(
      `input[placeholder="${pc("relatedHeading")}"]`,
    );
    fireEvent.change(naglowek as HTMLInputElement, { target: { value: "Czytaj dalej" } });
    const zapis = ostatniZapis(changes);
    expect(zapis.data.heading).toBe("Czytaj dalej");
    expect(zapis.data.strategy).toBe("tag");
    expect(zapis.data.layout).toBe("compact");
  });
});
