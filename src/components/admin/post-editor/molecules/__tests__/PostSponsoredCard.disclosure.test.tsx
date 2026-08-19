// CO DOWODZI TEN PLIK: karta „Oznaczenie komercyjne" pozwala ZŁOŻYĆ KOMPLETNĄ
// deklarację ujawnienia i pokazuje redaktorowi, czego w niej jeszcze brakuje.
// Istniejący `PostSponsoredCard.test.tsx` pilnuje atomowości patcha przy
// przełączniku; tutaj domykamy pozostałe reguły - każde pole ujawnienia, bramki
// widoczności sekcji, reżim reklamy politycznej, ślad oznaczenia i podgląd.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA (i dlaczego to nie jest kwestia gustu):
// deklaracja komercyjna jest obowiązkiem USTAWOWYM - Prawo prasowe art. 36
// ust. 3, UPNPR art. 7 pkt 11, uśude art. 9 ust. 1 pkt 1 (podmiot zlecający
// ORAZ jego adres elektroniczny), DSA art. 26 ust. 1 lit. b-c, a dla reklamy
// politycznej rozp. (UE) 2024/900 art. 11 ust. 1 (informacja o charakterze
// reklamy, sponsor, podmiot go kontrolujący i PROCES, którego dotyczy).
// Gdy reguła w tej karcie pęknie:
//   * pole, które nie trafia do patcha, znaczy deklarację bez elementu wymaganego
//     ustawą - a serwer odrzuci publikację całego wpisu (`disclosureGaps`),
//   * niepokazany BRAK znaczy, że redaktor dowiaduje się o nim dopiero przy
//     próbie publikacji, i to komunikatem z serwera, nie przy polu,
//   * sekcja polityczna ukryta przy włączonym znaczniku znaczy materiał wyborczy
//     bez sponsora i procesu - naruszenie, którego nie da się naprawić inaczej
//     niż zdjęciem wpisu,
//   * podgląd rozjechany z komponentem czytelnika znaczy, że redakcja zatwierdza
//     inne brzmienie oświadczenia niż to, które zobaczy czytelnik.
//
// Asercje idą po KLUCZACH i18n (stub `reactI18nextStub`), nie po polskim copy -
// brzmienia są treścią oświadczenia prawnego i mają własne bramki parytetu.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { postForm } from "@/test/post-editor/fixtures";
import type { PostForm } from "../../types";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));
vi.mock("@/lib/i18n-sponsored", () => ({}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { PostSponsoredCard } from "../PostSponsoredCard";

const P = "adminPostPanes.sponsored";
const K = {
  title: `${P}.title`,
  toggle: `${P}.toggle`,
  kind: `${P}.kindLabel`,
  kindOption: (kind: string) => `${P}.kindOption.${kind}`,
  barterWarning: `${P}.barterWarning`,
  advertiser: `${P}.advertiserLabel`,
  advertiserFromOrg: `${P}.advertiserFromOrg`,
  advertiserUrl: `${P}.advertiserUrlLabel`,
  payer: `${P}.payerLabel`,
  orderRef: `${P}.orderRefLabel`,
  notePl: `${P}.notePlLabel`,
  noteEn: `${P}.noteEnLabel`,
  political: `${P}.politicalLabel`,
  politicalProcess: `${P}.politicalProcessLabel`,
  politicalProcessPlaceholder: `${P}.politicalProcessPlaceholder`,
  sponsorController: `${P}.sponsorControllerLabel`,
  affiliate: `${P}.affiliateLabel`,
  previewHeading: `${P}.previewHeading`,
  markedBy: (when: string) => `${P}.markedBy {"when":${JSON.stringify(when)}}`,
} as const;

/** Materiał komercyjny z kompletną deklaracją - baza dla wariantów. */
function sponsored(overrides: Partial<PostForm> = {}): Partial<PostForm> {
  return {
    is_sponsored: true,
    sponsored_kind: "sponsored",
    sponsored_advertiser_name: "ACME Europe",
    sponsored_advertiser_url: "https://acme.example",
    ...overrides,
  };
}

function renderCard(overrides: Partial<PostForm> = {}, uiLang = "pl") {
  const onPatch = vi.fn();
  render(
    <TooltipProvider>
      <PostSponsoredCard form={postForm(overrides)} uiLang={uiLang} onPatch={onPatch} />
    </TooltipProvider>,
  );
  return onPatch;
}

/**
 * Wiersz pola o danej etykiecie. Szukamy przez ETYKIETĘ, bo karta nie wiąże
 * etykiet z kontrolkami przez `htmlFor` (patrz SWIADEK DEFEKTU na końcu pliku),
 * więc `getByLabelText` tu nie działa.
 */
function fieldRow(labelKey: string): HTMLElement {
  const label = screen.getByText(labelKey);
  const box = label.parentElement;
  if (!box) throw new Error(`brak wiersza pola dla etykiety ${labelKey}`);
  return box;
}

function control(labelKey: string): HTMLInputElement | HTMLTextAreaElement {
  const el = fieldRow(labelKey).querySelector("input, textarea");
  if (!el) throw new Error(`brak kontrolki w wierszu ${labelKey}`);
  return el as HTMLInputElement | HTMLTextAreaElement;
}

/** Czy etykieta jest oznaczona jako BRAK wymagany do publikacji (gwiazdka). */
function marksMissing(labelKey: string): boolean {
  return within(fieldRow(labelKey)).queryByText("*") !== null;
}

const toggleSwitch = (name: string) => screen.getByRole("switch", { name });

function openKinds(): HTMLElement {
  // Pointer events nie działają w happy-dom - listę Radiksa otwieramy klawiaturą.
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

afterEach(cleanup);

describe("PostSponsoredCard - bramki widoczności sekcji", () => {
  it("bez flagi komercyjnej nie ma pól deklaracji, ale JEST przełącznik afiliacji", () => {
    // Afiliacja stoi poza sponsoringiem świadomie: prowizja to korzyść majątkowa
    // podlegająca ujawnieniu także w materiale, za który nikt nie zapłacił.
    renderCard();
    expect(screen.queryByText(K.kind)).toBeNull();
    expect(screen.queryByText(K.advertiser)).toBeNull();
    expect(toggleSwitch(K.affiliate)).toBeInTheDocument();
  });

  it("włączona flaga odsłania WSZYSTKIE pola ujawnienia z uśude/DSA", () => {
    renderCard(sponsored());
    for (const label of [
      K.kind,
      K.advertiser,
      K.advertiserUrl,
      K.payer,
      K.orderRef,
      K.notePl,
      K.noteEn,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("sekcja reklamy politycznej pojawia się dopiero po włączeniu znacznika", () => {
    renderCard(sponsored());
    expect(screen.queryByText(K.politicalProcess)).toBeNull();
    cleanup();
    renderCard(sponsored({ sponsored_political: true }));
    expect(screen.getByText(K.politicalProcess)).toBeInTheDocument();
    expect(screen.getByText(K.sponsorController)).toBeInTheDocument();
  });

  it("podgląd etykiety pojawia się przy sponsoringu ALBO przy samej afiliacji", () => {
    renderCard();
    expect(screen.queryByText(K.previewHeading)).toBeNull();
    cleanup();
    renderCard({ sponsored_affiliate: true });
    expect(screen.getByText(K.previewHeading)).toBeInTheDocument();
    cleanup();
    renderCard(sponsored());
    expect(screen.getByText(K.previewHeading)).toBeInTheDocument();
  });

  it("nagłówek karty i podpowiedź kontekstowa są zawsze dostępne", () => {
    renderCard();
    expect(screen.getByText(K.title)).toBeInTheDocument();
    // Podpowiedź „?" musi mieć nazwę dostępną - inaczej dla czytnika ekranu
    // jest anonimowym przyciskiem obok nagłówka.
    expect(screen.getByRole("button", { name: `${P}.hint` })).toBeInTheDocument();
  });
});

describe("PostSponsoredCard - włączanie i wyłączanie flagi", () => {
  it("włączenie NIE nadpisuje wcześniej ustalonego rodzaju relacji ani reklamodawcy", () => {
    // Redakcja przełącza flagę tam i z powrotem w trakcie ustalania szczegółów;
    // podpowiedź nie może zdeptać tego, co już ustalone.
    const onPatch = renderCard({
      is_sponsored: false,
      sponsored_kind: "partner",
      sponsored_advertiser_name: "Ustalony reklamodawca",
      sponsored_advertiser_url: "https://ustalony.example",
      organization_name: "Inna organizacja",
      organization_website: "https://inna.example",
    });
    fireEvent.click(toggleSwitch(K.toggle));
    expect(onPatch).toHaveBeenCalledWith({
      is_sponsored: true,
      sponsored_kind: "partner",
      sponsored_advertiser_name: "Ustalony reklamodawca",
      sponsored_advertiser_url: "https://ustalony.example",
    });
  });

  it("wyłączenie flagi patchuje DOKŁADNIE dwa pola: flagę i reżim polityczny", () => {
    // Wyłączenie nie może czyścić ustalonej deklaracji (redakcja przełącza flagę
    // w trakcie ustaleń), ale MUSI zdjąć znacznik reklamy politycznej - wiersz
    // „polityczny, ale niekomercyjny" jest wewnętrznie sprzeczny i odrzuca go
    // CHECK `posts_sponsored_political_check`.
    const onPatch = renderCard(
      sponsored({
        sponsored_political: true,
        sponsored_political_process: "Wybory do PE",
        sponsored_payer_name: "Dom mediowy",
      }),
    );
    fireEvent.click(toggleSwitch(K.toggle));
    expect(onPatch).toHaveBeenCalledWith({ is_sponsored: false, sponsored_political: false });
    expect(Object.keys(onPatch.mock.calls[0][0] as object)).toEqual([
      "is_sponsored",
      "sponsored_political",
    ]);
  });

  it("bez przypisanej organizacji patch zostawia pola reklamodawcy puste (null)", () => {
    const onPatch = renderCard();
    fireEvent.click(toggleSwitch(K.toggle));
    // Klucze MUSZĄ być w patchu (jedno wejście historii), ale bez wymyślonej
    // wartości - inaczej karta wpisałaby reklamodawcę, którego nikt nie ustalił.
    expect(onPatch).toHaveBeenCalledWith({
      is_sponsored: true,
      sponsored_kind: "sponsored",
      sponsored_advertiser_name: null,
      sponsored_advertiser_url: null,
    });
  });
});

describe("PostSponsoredCard - rodzaj relacji", () => {
  it("słownik rodzajów jest domknięty i w stałej kolejności (od reklamy do barteru)", () => {
    // Kolejność to rosnąca niezależność redakcyjna - tak czyta ją redakcja.
    // Domknięcie listy jest lustrem CHECK-a `posts_sponsored_kind_check`.
    renderCard(sponsored());
    expect(
      within(openKinds())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      K.kindOption("advertisement"),
      K.kindOption("sponsored"),
      K.kindOption("partner"),
      K.kindOption("barter"),
      K.kindOption("self_promo"),
    ]);
  });

  it("wybór rodzaju trafia do patcha jako `sponsored_kind`", () => {
    const onPatch = renderCard(sponsored());
    fireEvent.click(within(openKinds()).getByRole("option", { name: K.kindOption("barter") }));
    expect(onPatch).toHaveBeenCalledWith({ sponsored_kind: "barter" });
  });

  it("puste `sponsored_kind` pokazuje rodzaj domyślny, a nie pustą kontrolkę", () => {
    // Stan „komercyjny bez rodzaju" jest nieosiągalny z UI (patch atomowy), ale
    // wiersze sprzed migracji istnieją - kontrolka musi pokazać, co poleci do bazy.
    renderCard(sponsored({ sponsored_kind: null }));
    expect(screen.getByRole("combobox")).toHaveTextContent(K.kindOption("sponsored"));
  });

  it("ostrzeżenie „to nie barter” stoi TYLKO przy barterze", () => {
    // Rekomendacje UOKiK: powtarzalne świadczenia od tego samego podmiotu to
    // współpraca reklamowa. Ostrzeżenie stoi przy wyborze, bo tam podejmowana
    // jest zła decyzja.
    renderCard(sponsored({ sponsored_kind: "barter" }));
    expect(screen.getByText(K.barterWarning)).toBeInTheDocument();
    cleanup();
    renderCard(sponsored({ sponsored_kind: "partner" }));
    expect(screen.queryByText(K.barterWarning)).toBeNull();
  });
});

describe("PostSponsoredCard - pola deklaracji trafiają do patcha", () => {
  const CASES: ReadonlyArray<readonly [string, keyof PostForm, string]> = [
    [K.advertiser, "sponsored_advertiser_name", "ACME Polska"],
    [K.advertiserUrl, "sponsored_advertiser_url", "https://acme.pl"],
    [K.payer, "sponsored_payer_name", "Dom mediowy XYZ"],
    [K.orderRef, "sponsored_order_ref", "ZL/2026/08/17"],
    [K.notePl, "sponsored_note_pl", "Materiał powstał bez wpływu na treść."],
    [K.noteEn, "sponsored_note_en", "Produced without editorial influence."],
  ];

  it.each(CASES)("wpisana wartość w polu %s jedzie jako %s", (label, field, value) => {
    const onPatch = renderCard(sponsored());
    fireEvent.change(control(label), { target: { value } });
    expect(onPatch).toHaveBeenCalledWith({ [field]: value });
  });

  it.each(CASES)("wyczyszczenie pola %s zapisuje NULL, nie pusty napis (%s)", (label, field) => {
    // Pusty napis w kolumnie oznaczałby „ujawnienie jest, tylko puste" - render
    // publiczny pokazałby wtedy zdanie bez nazwy podmiotu.
    const onPatch = renderCard(
      sponsored({
        sponsored_payer_name: "X",
        sponsored_order_ref: "X",
        sponsored_note_pl: "X",
        sponsored_note_en: "X",
      }),
    );
    fireEvent.change(control(label), { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith({ [field]: null });
  });

  it("pola reżimu politycznego trafiają do patcha i czyszczą się do NULL", () => {
    const onPatch = renderCard(
      sponsored({
        sponsored_political: true,
        sponsored_political_process: "Nowelizacja ustawy o OZE",
        sponsored_sponsor_controller: "Fundacja Kontrolująca",
      }),
    );
    fireEvent.change(control(K.politicalProcess), { target: { value: "Wybory do PE 2029" } });
    expect(onPatch).toHaveBeenCalledWith({ sponsored_political_process: "Wybory do PE 2029" });

    fireEvent.change(control(K.sponsorController), { target: { value: "Holding SA" } });
    expect(onPatch).toHaveBeenCalledWith({ sponsored_sponsor_controller: "Holding SA" });

    fireEvent.change(control(K.politicalProcess), { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith({ sponsored_political_process: null });
    fireEvent.change(control(K.sponsorController), { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith({ sponsored_sponsor_controller: null });
  });

  it("pole procesu podpowiada przykład (podpowiedź, nie wartość)", () => {
    renderCard(sponsored({ sponsored_political: true }));
    expect(control(K.politicalProcess)).toHaveAttribute(
      "placeholder",
      K.politicalProcessPlaceholder,
    );
    // Placeholder NIE jest wartością - inaczej deklaracja kłamałaby o procesie.
    expect(control(K.politicalProcess)).toHaveValue("");
  });

  it("kontrolki pokazują wartości już zapisane w wierszu", () => {
    renderCard(
      sponsored({
        sponsored_payer_name: "Dom mediowy",
        sponsored_order_ref: "ZL/1",
        sponsored_note_pl: "Nota PL",
        sponsored_note_en: "Note EN",
      }),
    );
    expect(control(K.advertiser)).toHaveValue("ACME Europe");
    expect(control(K.advertiserUrl)).toHaveValue("https://acme.example");
    expect(control(K.payer)).toHaveValue("Dom mediowy");
    expect(control(K.orderRef)).toHaveValue("ZL/1");
    expect(control(K.notePl)).toHaveValue("Nota PL");
    expect(control(K.noteEn)).toHaveValue("Note EN");
  });
});

describe("PostSponsoredCard - braki są WIDOCZNE dla redaktora", () => {
  it("brak reklamodawcy i jego adresu jest oznaczony przy TYCH etykietach", () => {
    // Adres elektroniczny zlecającego jest elementem ustawowym oznaczenia
    // (uśude art. 9 ust. 1 pkt 1), a nie udogodnieniem - stąd oba braki.
    renderCard({ is_sponsored: true, sponsored_kind: "sponsored" });
    expect(marksMissing(K.advertiser)).toBe(true);
    expect(marksMissing(K.advertiserUrl)).toBe(true);
  });

  it("uzupełnienie pola zdejmuje oznaczenie braku", () => {
    renderCard(sponsored());
    expect(marksMissing(K.advertiser)).toBe(false);
    expect(marksMissing(K.advertiserUrl)).toBe(false);
  });

  it("pola nieobowiązkowe (płatnik, numer zlecenia) NIE są oznaczane jako braki", () => {
    // Fałszywe „brakujące" pola uczą redakcję ignorowania gwiazdek - a wtedy
    // przestaje działać sygnał przy polach naprawdę wymaganych.
    renderCard({ is_sponsored: true, sponsored_kind: "sponsored" });
    expect(marksMissing(K.payer)).toBe(false);
    expect(marksMissing(K.orderRef)).toBe(false);
    expect(marksMissing(K.notePl)).toBe(false);
  });

  it("brak procesu przy reklamie politycznej jest oznaczony (rozp. 2024/900)", () => {
    renderCard(sponsored({ sponsored_political: true, sponsored_political_process: null }));
    expect(marksMissing(K.politicalProcess)).toBe(true);
    // Podmiot kontrolujący sponsora nie jest w bramce publikacji, więc nie
    // udaje braku blokującego.
    expect(marksMissing(K.sponsorController)).toBe(false);
    cleanup();
    renderCard(sponsored({ sponsored_political: true, sponsored_political_process: "Wybory" }));
    expect(marksMissing(K.politicalProcess)).toBe(false);
  });
});

describe("PostSponsoredCard - podpowiedź reklamodawcy z przypisanej organizacji", () => {
  const ORG = { organization_name: "ACME Europe", organization_website: "https://acme.example" };

  it("przycisk przepisania pojawia się, gdy reklamodawca różni się od organizacji", () => {
    const onPatch = renderCard(sponsored({ ...ORG, sponsored_advertiser_name: "Ktoś inny" }));
    fireEvent.click(screen.getByRole("button", { name: K.advertiserFromOrg }));
    expect(onPatch).toHaveBeenCalledWith({ sponsored_advertiser_name: "ACME Europe" });
  });

  it("przy zgodnych nazwach przycisku nie ma (nie ma czego przepisywać)", () => {
    renderCard(sponsored({ ...ORG, sponsored_advertiser_name: ORG.organization_name }));
    expect(screen.queryByRole("button", { name: K.advertiserFromOrg })).toBeNull();
  });

  it("bez przypisanej organizacji przycisku nie ma", () => {
    renderCard(sponsored({ organization_name: null, sponsored_advertiser_name: null }));
    expect(screen.queryByRole("button", { name: K.advertiserFromOrg })).toBeNull();
  });
});

describe("PostSponsoredCard - afiliacja i reżim polityczny jako przełączniki", () => {
  it("afiliację da się włączyć i wyłączyć bez flagi komercyjnej", () => {
    const onPatch = renderCard({ sponsored_affiliate: false });
    fireEvent.click(toggleSwitch(K.affiliate));
    expect(onPatch).toHaveBeenCalledWith({ sponsored_affiliate: true });
    cleanup();
    const onPatch2 = renderCard({ sponsored_affiliate: true });
    fireEvent.click(toggleSwitch(K.affiliate));
    expect(onPatch2).toHaveBeenCalledWith({ sponsored_affiliate: false });
  });

  it("znacznik reklamy politycznej patchuje wyłącznie własne pole", () => {
    const onPatch = renderCard(sponsored());
    fireEvent.click(toggleSwitch(K.political));
    expect(onPatch).toHaveBeenCalledWith({ sponsored_political: true });
    cleanup();
    const onPatch2 = renderCard(sponsored({ sponsored_political: true }));
    fireEvent.click(toggleSwitch(K.political));
    expect(onPatch2).toHaveBeenCalledWith({ sponsored_political: false });
  });

  it("przełączniki mają nazwy dostępne (to same kontrolki bez etykiety `for`)", () => {
    renderCard(sponsored());
    expect(toggleSwitch(K.toggle)).toHaveAttribute("aria-label", K.toggle);
    expect(toggleSwitch(K.political)).toHaveAttribute("aria-label", K.political);
    expect(toggleSwitch(K.affiliate)).toHaveAttribute("aria-label", K.affiliate);
  });
});

describe("PostSponsoredCard - ślad oznaczenia", () => {
  const MARKED = "2026-08-17T14:30:00.000Z";

  it("data oznaczenia jest pokazana w formacie języka interfejsu", () => {
    renderCard(sponsored({ sponsored_marked_at: MARKED }), "pl");
    expect(screen.getByText(K.markedBy(new Date(MARKED).toLocaleString("pl")))).toBeInTheDocument();
  });

  it("przy interfejsie angielskim ta sama data jest formatowana po angielsku", () => {
    // Ślad czyta redakcja, więc idzie za językiem PANELU (etykieta czytelnika
    // idzie osobno za językiem materiału - patrz podgląd niżej).
    renderCard(sponsored({ sponsored_marked_at: MARKED }), "en");
    expect(screen.getByText(K.markedBy(new Date(MARKED).toLocaleString("en")))).toBeInTheDocument();
  });

  it("bez śladu oznaczenia nie ma wiersza z datą", () => {
    renderCard(sponsored({ sponsored_marked_at: null }));
    expect(screen.queryByText(new RegExp(`${P}\\.markedBy`))).toBeNull();
  });
});

describe("PostSponsoredCard - podgląd pokazuje PRAWDZIWY komponent czytelnika", () => {
  it("podgląd niesie rodzaj relacji, więc widać, jaką etykietę dostanie czytelnik", () => {
    renderCard(sponsored({ sponsored_kind: "advertisement" }));
    // `data-sponsored-disclosure` jest kontraktem komponentu publicznego -
    // podgląd używa GO, nie makiety „na oko".
    expect(screen.getByRole("note")).toHaveAttribute("data-sponsored-disclosure", "advertisement");
  });

  it("sama afiliacja daje pasek afiliacyjny, bez etykiety sponsoringu", () => {
    renderCard({ is_sponsored: false, sponsored_affiliate: true });
    expect(screen.getByRole("note")).toHaveAttribute("data-sponsored-disclosure", "affiliate");
  });

  it("język podglądu idzie za językiem PANELU podanym w `uiLang`", () => {
    // `uiLang` przekłada się na `lang` przekazany komponentowi publicznemu,
    // a ten przypina `lng` do tłumaczeń - bez tego angielska wersja materiału
    // dostałaby polską etykietę ujawnienia.
    renderCard(sponsored(), "en");
    expect(screen.getByRole("note")).toHaveAttribute(
      "aria-label",
      'sponsored.regionLabel {"lng":"en"}',
    );
    cleanup();
    renderCard(sponsored(), "pl");
    expect(screen.getByRole("note")).toHaveAttribute(
      "aria-label",
      'sponsored.regionLabel {"lng":"pl"}',
    );
  });

  it("nieznany kod języka interfejsu spada na polski, nie na pusty locale", () => {
    renderCard(sponsored(), "de");
    expect(screen.getByRole("note")).toHaveAttribute(
      "aria-label",
      'sponsored.regionLabel {"lng":"pl"}',
    );
  });
});

describe("PostSponsoredCard - stan obecny dostępności pól", () => {
  // SWIADEK DEFEKTU (D1). `FieldRow` przyjmuje prop `htmlFor`, ale karta go NIE
  // podaje, a kontrolki nie mają `id` - żadne z ośmiu pól deklaracji nie jest
  // powiązane ze swoją etykietą. Dla osoby korzystającej z czytnika ekranu to
  // ciąg NIENAZWANYCH pól tekstowych: nie da się rozpoznać, gdzie wpisać
  // reklamodawcę, a gdzie numer zlecenia - a to pola oświadczenia ustawowego.
  // Jest gorzej niż „brak nazwy": ponieważ `InfoHint` renderuje PRZYCISK wewnątrz
  // elementu `<label>`, etykieta wiąże się z przyciskiem podpowiedzi, więc pole
  // pomocy przejmuje nazwę należącą do pola formularza. Ten sam defekt naprawiono
  // już raz w `OrganizationCreateForm` (osiem pól bez `htmlFor`).
  // Test opisuje stan OBECNY, żeby naprawa była widoczna jako zmiana zachowania.
  it("SWIADEK DEFEKTU: etykieta pola wskazuje przycisk podpowiedzi, nie kontrolkę", () => {
    renderCard(sponsored());
    for (const label of [K.advertiser, K.advertiserUrl, K.payer, K.orderRef, K.notePl]) {
      const labelled = screen.queryByLabelText(label);
      // Etykieta JEST wyrenderowana i coś opisuje...
      expect(screen.getByText(label)).toBeInTheDocument();
      // ...ale to „coś" jest przyciskiem „?", a nie polem do wpisania wartości.
      expect(labelled?.tagName).toBe("BUTTON");
      expect(labelled).not.toBe(control(label));
      expect(control(label)).not.toHaveAttribute("id");
    }
  });

  it("SWIADEK DEFEKTU: pole bez podpowiedzi nie ma ŻADNEJ nazwy dostępnej", () => {
    // Nota EN nie ma dymka, więc etykieta nie wiąże się nawet z przyciskiem -
    // dla czytnika ekranu to pole tekstowe bez nazwy.
    renderCard(sponsored());
    expect(screen.queryByLabelText(K.noteEn)).toBeNull();
    expect(control(K.noteEn)).not.toHaveAttribute("aria-label");
  });
});
