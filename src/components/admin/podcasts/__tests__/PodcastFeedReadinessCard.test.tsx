// CO DOWODZI TEN PLIK
//
// Karta gotowości kanału podcastowego jest jedynym miejscem w panelu, które
// mówi redakcji „Apple tego nie przyjmie". Awaria jest CICHA: feed wychodzi
// składniowo poprawny (builder RSS podstawia domyślne wartości), więc bez tej
// karty nikt nie dowie się o braku, dopóki ktoś nie zauważy, że audycji nie ma
// w katalogu. Karta świecąca zielono nad listą braków jest gorsza niż jej brak.
//
// Przedmiot dowodu po przepisaniu karty na cienki render:
//   1. GOTOWOŚĆ LICZY REGUŁA, nie flaga z propsów. Niespójne wejście
//      (`ready: true` obok listy braków) nie może dać zielonej ramki - przed
//      przepisaniem dawało zieloną ramkę I listę braków naraz.
//   2. TRZY DROGI WEJŚCIA renderują ten sam kształt: gotowa lista braków,
//      metadane kanału (karta woła regułę) i wynik starszej checklisty
//      `podcastFeedReadiness`, którą podaje dzisiejszy panel sieciowy.
//   3. NA EKRANIE STOI ZDANIE ZE SŁOWNIKA, a nie klucz i18n - tłumacz jest
//      prawdziwy, więc zniknięcie klucza z PL/EN oblewa ten plik.
//
// CZEGO NIE DUBLUJE: samej reguły (`src/lib/podcast/__tests__/applePodcast.test.ts`)
// ani parytetu słownika (`src/lib/__tests__/i18nAdminPodcasts.test.ts`).
//
// RODO: adresy wyłącznie na `example.com` / `example.org`, nazwa audycji zmyślona.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import "@/test/i18nReal";
// Nakładka rejestruje klucze `adminPodcasts.*` efektem ubocznym importu -
// komponent nie importuje jej sam (robi to trasa panelu).
import "@/lib/i18n-admin-podcasts";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ApplePodcastChannelMeta, ApplePodcastGap } from "@/lib/podcast/applePodcast";
import { PodcastFeedReadinessCard } from "../PodcastFeedReadinessCard";

const t = realT("pl");
const napis = (kod: string): string => t(`adminPodcasts.settings.apple.${kod}`);

const KOMPLETNY: ApplePodcastChannelMeta = {
  title: "Bruksela na Wschodzie",
  description: "Cotygodniowy przeglad polityki europejskiej.",
  language: "pl",
  category: "News",
  explicit: false,
  author: "Instytut Spraw Zmyslonych",
  ownerName: "Redakcja Brukseli na Wschodzie",
  ownerEmail: "redakcja@example.com",
  imageUrl: "https://cdn.example.org/okladka-3000.jpg",
  imageWidth: 3000,
  imageHeight: 3000,
};

/** Ramka karty - jej kolor jest jedynym sygnałem gotowości „na pierwszy rzut oka". */
function ramka(container: HTMLElement): string {
  const section = container.querySelector("section");
  if (section === null) throw new Error("test: karta nie wyrenderowala sekcji");
  return section.className;
}

/** Wiersze listy braków w kolejności renderu. */
function wiersze(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

const GAP_IMAGE: ApplePodcastGap = {
  field: "imageUrl",
  severity: "blocking",
  messageKey: "adminPodcasts.settings.apple.blocking.image",
};
const GAP_AUTHOR: ApplePodcastGap = {
  field: "author",
  severity: "warning",
  messageKey: "adminPodcasts.settings.apple.warnings.author",
};

describe("PodcastFeedReadinessCard - kanał gotowy", () => {
  it("pokazuje potwierdzenie ze słownika i zieloną ramkę, bez listy braków", () => {
    const { container } = renderWithQueryClient(<PodcastFeedReadinessCard gaps={[]} />);
    expect(screen.getByText(napis("readinessTitle"))).toBeInTheDocument();
    expect(screen.getByText(napis("readinessOk"))).toBeInTheDocument();
    expect(ramka(container)).toContain("border-emerald-500/40");
    // Żadnej listy: nagłówki „Braki blokujące" i „Zalecane uzupełnienia" nie
    // mogą wisieć nad pustą listą.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(napis("readinessBlocking"))).toBeNull();
    expect(screen.queryByText(napis("readinessWarnings"))).toBeNull();
  });

  it("kompletne metadane kanału też dają stan gotowy", () => {
    renderWithQueryClient(<PodcastFeedReadinessCard channel={KOMPLETNY} />);
    expect(screen.getByText(napis("readinessOk"))).toBeInTheDocument();
  });

  it("bez ŻADNEJ drogi wejścia karta nie renderuje NICZEGO", () => {
    // SPROSTOWANIE 2026-09-02 (przegląd adwersarialny). Stało tu, że „brak
    // informacji o brakach renderuje się jak brak braków", z uzasadnieniem, że
    // straszenie redakcji pustą listą byłoby fałszywym alarmem. Pierwsza połowa
    // tego uzasadnienia jest słuszna, wniosek nie: wszystkie cztery propsy są
    // opcjonalne, więc `<PodcastFeedReadinessCard />` KOMPILUJE SIĘ, a reguła
    // dla pustego wejścia zwraca zero braków - karta rysowała ZIELONĄ ramkę
    // „kanał spełnia wymagania Apple", nie wiedząc o kanale nic.
    //
    // KONSEKWENCJA: jedynym zadaniem tej karty jest wyłapać awarię CICHĄ (brak
    // wymaganego tagu = odrzucenie kanału z katalogu, o którym nikt się nie
    // dowie, dopóki ktoś nie zauważy, że audycja się nie pojawiła). Fałszywe
    // „gotowe" jest tą samą awarią cichą, tylko wprowadzoną przez mechanizm,
    // który miał jej zapobiegać.
    //
    // Brak wejścia to teraz BRAK KARTY - co zaspokaja oba argumenty naraz:
    // nie ma fałszywego alarmu ANI fałszywej zgody, a rodzic, który zapomniał
    // podać dane, widzi dziurę w panelu.
    const { container } = renderWithQueryClient(<PodcastFeedReadinessCard />);
    expect(container.querySelector("section"), "brak danych to brak karty").toBeNull();
  });

  it("propsy podane jako null też nie dają zielonej ramki", () => {
    // `null` jest realnym stanem, nie teorią: `useAdminPodcastSettings()`
    // oddaje `undefined` przed odczytem, a wołający przepisuje to na `null`.
    const { container } = renderWithQueryClient(
      <PodcastFeedReadinessCard gaps={null} channel={null} readiness={null} />,
    );
    expect(container.querySelector("section")).toBeNull();
  });

  it("kontrola dodatnia: PUSTA lista braków (a nie brak wejścia) DAJE zieloną kartę", () => {
    // Rozróżnienie, na którym stoi cała ta naprawa: „policzyłem i nie ma
    // braków" jest wynikiem, a „nie mam czego policzyć" nie jest. Pierwsze
    // musi dalej dawać zieloną kartę - inaczej naprawa zabrałaby ścieżkę zdrową.
    renderWithQueryClient(<PodcastFeedReadinessCard gaps={[]} />);
    expect(screen.getByText(napis("readinessOk"))).toBeInTheDocument();
  });
});

describe("PodcastFeedReadinessCard - braki na ekranie", () => {
  it("braki blokujące renderuje pod swoim nagłówkiem, w kolejności z reguły", () => {
    const { container } = renderWithQueryClient(
      <PodcastFeedReadinessCard
        gaps={[
          GAP_IMAGE,
          {
            field: "ownerEmail",
            severity: "blocking",
            messageKey: "adminPodcasts.settings.apple.blocking.ownerEmailShape",
          },
        ]}
      />,
    );
    expect(ramka(container)).toContain("border-amber-500/50");
    expect(screen.getByText(napis("readinessBlocking"))).toBeInTheDocument();
    expect(wiersze()).toEqual([napis("blocking.image"), napis("blocking.ownerEmailShape")]);
    // Potwierdzenie gotowości NIE MOŻE stać nad listą braków.
    expect(screen.queryByText(napis("readinessOk"))).toBeNull();
  });

  it("zalecenia mają osobny nagłówek i nie odbierają gotowości", () => {
    const { container } = renderWithQueryClient(<PodcastFeedReadinessCard gaps={[GAP_AUTHOR]} />);
    expect(screen.getByText(napis("readinessWarnings"))).toBeInTheDocument();
    expect(wiersze()).toEqual([napis("warnings.author")]);
    // Same zalecenia = kanał przejdzie, więc ramka zostaje zielona.
    expect(ramka(container)).toContain("border-emerald-500/40");
    expect(screen.getByText(napis("readinessOk"))).toBeInTheDocument();
    expect(screen.queryByText(napis("readinessBlocking"))).toBeNull();
  });

  it("blokujące i zalecenia naraz idą do DWÓCH list, bez mieszania", () => {
    renderWithQueryClient(<PodcastFeedReadinessCard gaps={[GAP_IMAGE, GAP_AUTHOR]} />);
    const listy = screen.getAllByRole("list");
    expect(listy).toHaveLength(2);
    expect(listy[0].textContent).toBe(napis("blocking.image"));
    expect(listy[1].textContent).toBe(napis("warnings.author"));
  });

  it("dwa braki tego samego pola renderują dwa wiersze", () => {
    // Klucz `<li>` musi rozróżniać komunikaty, nie tylko pola - okładka po
    // http o złych proporcjach to dwa różne braki jednego pola.
    renderWithQueryClient(
      <PodcastFeedReadinessCard
        channel={{
          ...KOMPLETNY,
          imageUrl: "http://cdn.example.org/banner.jpg",
          imageWidth: 1600,
          imageHeight: 900,
        }}
      />,
    );
    expect(wiersze()).toEqual([napis("blocking.imageProtocol"), napis("blocking.imageSquare")]);
  });
});

describe("PodcastFeedReadinessCard - drogi wejścia", () => {
  it("z metadanych kanału karta woła regułę sama", () => {
    renderWithQueryClient(<PodcastFeedReadinessCard channel={{}} />);
    expect(wiersze()).toEqual([
      napis("blocking.title"),
      napis("blocking.description"),
      napis("blocking.language"),
      napis("blocking.category"),
      napis("blocking.explicit"),
      napis("blocking.image"),
      napis("blocking.ownerEmail"),
      napis("warnings.author"),
      napis("warnings.ownerName"),
    ]);
  });

  it("nadpisania programu liczą się razem z kanałem", () => {
    // Kanał sieciowy jest kompletny, a program przesłania jego e-mail
    // adresem, na który Apple nie wyśle kodu weryfikacyjnego.
    renderWithQueryClient(
      <PodcastFeedReadinessCard channel={KOMPLETNY} show={{ ownerEmail: "redakcja@example" }} />,
    );
    expect(wiersze()).toEqual([napis("blocking.ownerEmailShape")]);
  });

  it("wynik starszej checklisty panelu renderuje się tymi samymi zdaniami", () => {
    // To kontrakt, którym woła dzisiejszy `/admin/podcasts` - nie wolno go
    // zgubić przy przejściu karty na listę braków.
    renderWithQueryClient(
      <PodcastFeedReadinessCard
        readiness={{
          ready: false,
          blocking: ["image", "episodes"],
          warnings: ["copyright", "duration"],
        }}
      />,
    );
    expect(wiersze()).toEqual([
      napis("blocking.image"),
      napis("blocking.episodes"),
      napis("warnings.copyright"),
      napis("warnings.duration"),
    ]);
  });

  it("NIESPÓJNA checklista nie daje już zielonej ramki nad listą braków", () => {
    // Regresja przepisania: karta liczy gotowość predykatem reguły, więc
    // `ready: true` obok braku blokującego nie ma jak przejść.
    const { container } = renderWithQueryClient(
      <PodcastFeedReadinessCard readiness={{ ready: true, blocking: ["image"], warnings: [] }} />,
    );
    expect(ramka(container)).toContain("border-amber-500/50");
    expect(screen.queryByText(napis("readinessOk"))).toBeNull();
    expect(wiersze()).toEqual([napis("blocking.image")]);
  });

  it("gotowa lista braków ma pierwszeństwo nad checklistą", () => {
    renderWithQueryClient(
      <PodcastFeedReadinessCard
        gaps={[GAP_AUTHOR]}
        readiness={{ ready: false, blocking: ["image"], warnings: [] }}
      />,
    );
    expect(wiersze()).toEqual([napis("warnings.author")]);
  });
});

describe("PodcastFeedReadinessCard - słownik i dostępność", () => {
  it("nie zostawia surowego klucza i18n na ekranie dla znanych kodów", () => {
    const { container } = renderWithQueryClient(<PodcastFeedReadinessCard channel={{}} />);
    expect(container.textContent ?? "").not.toContain("adminPodcasts.");
  });

  it("kod bez klucza w słowniku pokazuje surowy klucz, a nie pusty wiersz", () => {
    // Dzisiejsze, świadome zachowanie: brak nie może zniknąć z ekranu tylko
    // dlatego, że ktoś zapomniał dopisać tłumaczenie. Widoczny klucz jest
    // zgłoszeniem błędu, pusty wiersz nie jest.
    renderWithQueryClient(
      <PodcastFeedReadinessCard
        readiness={{ ready: false, blocking: ["transcript"], warnings: [] }}
      />,
    );
    expect(wiersze()).toEqual(["adminPodcasts.settings.apple.blocking.transcript"]);
  });

  it("nagłówek i listy nie mają naruszeń dostępności", async () => {
    const { container } = renderWithQueryClient(
      <PodcastFeedReadinessCard gaps={[GAP_IMAGE, GAP_AUTHOR]} />,
    );
    const violations = await axeViolations(container);
    expect(summarize(violations)).toBe("");
  });
});
