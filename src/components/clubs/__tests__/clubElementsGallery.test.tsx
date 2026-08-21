// Galeria ŻYWYCH elementów klubu (`ClubElementsGallery`) z katalogu
// /club/elements.
//
// CO TEN PLIK DOWODZI. Katalog istnieje po to, żeby pokazywać PRAWDZIWE
// komponenty z prawdziwymi propsami (nagłówek `ClubElementsGallery.tsx`), więc
// test renderuje je BEZ atrap - podmieniony jest tylko router (`Link` bez
// kontekstu trasy rzuca) i słowniki i18n. Gdyby galeria rozjechała się
// z produktem, ten plik ma to zobaczyć jako pierwszy.
//
// (1) PRZEŁĄCZNIK UKŁADU JEST ŻYWY: kliknięcie w miniaturę zmienia układ listy
//     tematów I podpis pod nią (`layoutWhy.<układ>`). Statyczna galeria
//     pokazywałaby jeden układ i kłamała o dwóch pozostałych.
// (2) PASEK STANOWISK PRZELICZA GŁOSY DOKŁADNIE JAK PRODUKT: stanowiska
//     wykluczają się wzajemnie, więc przy zmianie licznik SCHODZI ze starego
//     i wchodzi na nowe, a ponowne kliknięcie tego samego stanowiska niczego
//     nie dodaje. To jest jedyne miejsce w katalogu z prawdziwą arytmetyką
//     i dlatego jedyne, które może cicho pokazać sumę wyższą niż liczba osób.
// (3) TRZY STANY OBSERWOWANIA STOJĄ RAZEM (brak wpisu / obserwuję / wyciszony),
//     bo różnica między "brak wpisu" a "wyciszony" jest niewidoczna, dopóki
//     nie stoją obok siebie. Cztery przyciski: trzy zablokowane okazy i JEDEN
//     żywy, który przechodzi po tej samej drodze co produkt.
// (4) OKŁADKA MA DWA WARIANTY I ZASTĘPNIK: `banner` bez zdjęcia nie rysuje
//     nic, `card` bez zdjęcia rysuje blok - inaczej siatka katalogu
//     rozjeżdża się pionowo.
// (5) KAŻDY STAN DOSTĘPU DO HUBA MA WŁASNY ZNACZNIK - cztery, nie trzy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) Wnętrza pokazywanych komponentów: `ClubThreadList` (układy, wiersz
//     dossier), `ClubStanceBar` (tony, proporcja), `ClubFollowButton`,
//     `ClubCover`, `ClubHubAccessBadge`, `ClubLayoutPicker` - wszystkie mają
//     własne pliki testowe. Tutaj asercje dotyczą tego, CO galeria im podaje
//     i jak reaguje na ich zwrotki.
// (b) `toStanceTallies` - kolejność i domknięcie zer to czysta funkcja
//     z własnym testem; tu widać wyłącznie SKUTEK przełączenia stanowiska.
// (c) Zawartości słowników - asercje idą na KLUCZE i18n.
//
// JEDNA FUNKCJA ŚWIADOMIE NIEDOBITA (nie jest luką w testach):
// `onChange={() => undefined}` przy trzech OKAZACH stanu obserwowania. Okazy
// są `disabled`, a React nie dostarcza kliknięcia do zablokowanego przycisku
// (test "kliknięcie okazu jest bez skutku" dowodzi tego z drugiej strony),
// więc ten handler jest martwy Z DEFINICJI - i taki ma być: katalog pokazuje
// stan, nie przełącza go. Jedyna droga do jego wywołania prowadziłaby przez
// zdarzenie, którego przeglądarka nie wysyła.
//
// PRZY OKAZJI TEJ PRACY: `Specimen` dostał `hint` WYMAGANY zamiast
// opcjonalnego. Wszystkie okazy tej strony podawały podpowiedź od początku,
// więc `hint !== undefined` było martwą gałęzią renderu, a nie obroną - zmiana
// jest zachowaniowo neutralna (identyczny render dla wszystkich pięciu okazów).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubElementsGallery } from "@/components/clubs/organisms/ClubElementsGallery";

beforeEach(() => {
  cleanup();
});

/** Sekcja okazu po podpisie - każdy okaz ma jeden podpis. */
function specimen(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const box = heading.closest("div")?.parentElement;
  if (box === null || box === undefined) throw new Error(`Brak okazu ${label}`);
  return box;
}

/** Przycisk stanowiska po kluczu i18n - pasek rysuje trzy. */
function stance(name: "support" | "oppose" | "abstain"): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`club\\.stance\\.${name}`) });
}

describe("ClubElementsGallery - układy listy tematów", () => {
  it("startuje na układzie kart i wypisuje uzasadnienie TEGO układu", () => {
    render(<ClubElementsGallery />);

    expect(screen.getByText("clubElements.gallery.layouts")).toBeInTheDocument();
    expect(screen.getByText("clubElements.gallery.layoutWhy.cards")).toBeInTheDocument();
    expect(screen.queryByText("clubElements.gallery.layoutWhy.list")).not.toBeInTheDocument();
  });

  it("pokazuje TRZY przykładowe tematy z niepustymi tytułami i autorem albo aliasem", () => {
    render(<ClubElementsGallery />);

    // Bez niepustej listy przełącznik układu nie miałby czego układać -
    // a to jest jedyna rzecz, którą ten okaz pokazuje.
    expect(
      screen.getByRole("link", { name: /Czy pakiet gazowy przetrwa trilog/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Kto ma dane o kosztach bilansowania/ }),
    ).toHaveAttribute("href", "/club/przyklad/t/przyklad-22222222-2222-2222-2222-222222222222");
    // Trzeci temat jedzie z aliasem zamiast nazwiska, więc wiersz podpisuje go
    // etykietą uczestnika anonimowego - a nie kontem usuniętym.
    expect(screen.getByText("club.anonymousAuthor")).toBeInTheDocument();
    expect(screen.getAllByText("Anna Kowalska")).toHaveLength(2);
    expect(screen.queryByText("club.deletedAuthor")).not.toBeInTheDocument();
  });

  it("kliknięcie miniatury przestawia układ i podpis pod listą", () => {
    render(<ClubElementsGallery />);

    fireEvent.click(screen.getByRole("radio", { name: /adminClubs\.layout\.magazine/ }));

    expect(screen.getByText("clubElements.gallery.layoutWhy.magazine")).toBeInTheDocument();
    expect(screen.queryByText("clubElements.gallery.layoutWhy.cards")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /adminClubs\.layout\.list/ }));
    expect(screen.getByText("clubElements.gallery.layoutWhy.list")).toBeInTheDocument();
  });
});

describe("ClubElementsGallery - pasek stanowisk", () => {
  it("startuje z moim głosem na sprzeciwie i sumą dziewięć-cztery-dwa", () => {
    render(<ClubElementsGallery />);

    expect(stance("oppose")).toHaveAttribute("aria-pressed", "true");
    expect(stance("support")).toHaveAttribute("aria-pressed", "false");
    expect(stance("support")).toHaveTextContent("9");
    expect(stance("oppose")).toHaveTextContent("4");
    expect(stance("abstain")).toHaveTextContent("2");
    expect(screen.getByText("club.stance.total(count=15)")).toBeInTheDocument();
  });

  it("zmiana stanowiska ZDEJMUJE głos ze starego i dokłada do nowego", () => {
    render(<ClubElementsGallery />);

    fireEvent.click(stance("support"));

    expect(stance("support")).toHaveAttribute("aria-pressed", "true");
    expect(stance("oppose")).toHaveAttribute("aria-pressed", "false");
    expect(stance("support")).toHaveTextContent("10");
    expect(stance("oppose")).toHaveTextContent("3");
    // Stanowisko, którego nie dotknięto, nie ma prawa się zmienić.
    expect(stance("abstain")).toHaveTextContent("2");
    expect(screen.getByText("club.stance.total(count=15)")).toBeInTheDocument();
  });

  it("ponowne kliknięcie własnego stanowiska nie podbija licznika", () => {
    render(<ClubElementsGallery />);

    fireEvent.click(stance("support"));
    fireEvent.click(stance("support"));

    expect(stance("support")).toHaveTextContent("10");
    expect(stance("support")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("club.stance.total(count=15)")).toBeInTheDocument();
  });

  it("głos przeniesiony na wstrzymanie się schodzi z poparcia, a nie sumuje się", () => {
    render(<ClubElementsGallery />);

    fireEvent.click(stance("support"));
    fireEvent.click(stance("abstain"));

    expect(stance("abstain")).toHaveAttribute("aria-pressed", "true");
    expect(stance("abstain")).toHaveTextContent("3");
    expect(stance("support")).toHaveTextContent("9");
    expect(stance("oppose")).toHaveTextContent("3");
  });
});

describe("ClubElementsGallery - obserwowanie", () => {
  it("wystawia trzy zablokowane okazy stanu i jeden żywy przycisk", () => {
    render(<ClubElementsGallery />);

    const box = specimen("clubElements.gallery.follow");
    const buttons = within(box).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons.filter((button) => (button as HTMLButtonElement).disabled)).toHaveLength(3);

    // Podpisy okazów (akapity pod przyciskami): brak wpisu ma WŁASNY klucz,
    // a nie klucz jednego ze stanów zapisanych w bazie.
    const captions = Array.from(box.querySelectorAll("p")).map((node) => node.textContent);
    expect(captions).toEqual([
      "clubElements.gallery.follow",
      "clubElements.gallery.followHint",
      "clubElements.gallery.followDefault",
      "club.subscription.subscribed",
      "club.subscription.muted",
      "clubElements.gallery.followLive",
    ]);
  });

  it("kliknięcie okazu jest bez skutku - okaz pokazuje stan, nie przełącza go", () => {
    render(<ClubElementsGallery />);

    const box = specimen("clubElements.gallery.follow");
    const okaz = within(box)
      .getAllByRole("button")
      .filter((button) => (button as HTMLButtonElement).disabled)[0];

    fireEvent.click(okaz);

    // Okaz "brak wpisu" ma zostać na braku wpisu, a żywy przycisk obok nie ma
    // prawa drgnąć - katalog nie jest panelem sterowania.
    expect(okaz).toHaveTextContent("club.subscription.follow");
    const live = within(box)
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(live[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("żywy przycisk przechodzi z braku wpisu na obserwowanie i dalej na wyciszenie", () => {
    render(<ClubElementsGallery />);

    const box = specimen("clubElements.gallery.follow");
    const live = within(box)
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(live[0]);
    expect(live[0]).toHaveAttribute("aria-pressed", "true");
    expect(live[0]).toHaveTextContent("club.subscription.subscribed");

    fireEvent.click(live[0]);
    expect(live[0]).toHaveAttribute("aria-pressed", "false");
    expect(live[0]).toHaveTextContent("club.subscription.muted");
  });
});

describe("ClubElementsGallery - okładka i stany dostępu", () => {
  it("banner i karta dostają zdjęcie z data URI, a trzeci okaz - zastępnik bez obrazka", () => {
    render(<ClubElementsGallery />);

    const box = specimen("clubElements.gallery.cover");
    const images = within(box).getAllByRole("presentation", { hidden: true });
    // Dwa okazy ze zdjęciem (banner + karta) i ANI JEDNEGO obrazka
    // w zastępniku - to jest cała różnica między wariantami.
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("src") ?? "").toContain("data:image/svg+xml");
    }
    expect(within(box).getByText("clubElements.gallery.coverBanner")).toBeInTheDocument();
    expect(within(box).getByText("clubElements.gallery.coverCard")).toBeInTheDocument();
    expect(within(box).getByText("clubElements.gallery.coverFallback")).toBeInTheDocument();
    expect(within(box).getByText("clubElements.gallery.coverRule")).toBeInTheDocument();
  });

  it("wypisuje wszystkie CZTERY stany dostępu do huba", () => {
    render(<ClubElementsGallery />);

    for (const access of ["member", "invited", "entitled", "locked"]) {
      expect(screen.getByText(`club.hub.access.${access}`)).toBeInTheDocument();
    }
  });
});
