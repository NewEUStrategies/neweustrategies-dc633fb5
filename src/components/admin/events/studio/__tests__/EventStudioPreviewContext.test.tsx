// KANAL PODGLADU NA ZYWO - jedyne polaczenie miedzy EKRANEM, ktory redaktor
// edytuje, a PODGLADEM, ktory stoi w ramie studia.
//
// PO CO TEN PLIK ISTNIEJE. Kontekst ma pietnascie linii kodu i trzy niezalezne
// stany, ktorych zepsucie nie wywala niczego na czerwono:
//   1. POZA STUDIEM. Powierzchnie podgladu (`EventPreviewCanvas`, panele
//      wnoszace szkic) montuja sie takze POZA rama studia - w kreatorze
//      i w testach samych paneli. Hook, ktory poza dostawca rzucalby wyjatkiem
//      albo oddawal `undefined`, wywracalby te ekrany calkowicie; kontrakt
//      mowi „pustka, nie wyjatek", i to jest zachowanie do przypiecia.
//   2. SZKIC WYGRYWA Z BAZA, ALE TYLKO W SWOICH POLACH. Cala wartosc podgladu
//      polega na tym, ze pokazuje wersje ROBOCZA; jednoczesnie sekcja, ktora
//      nic nie wnosi, musi pokazac stan ZAPISANY, a nie pustke. Zamiana
//      `{...base, ...overlay}` na `{...overlay, ...base}` daje podglad, ktory
//      ignoruje pisanie - i nikt tego nie zglosi jako bledu, tylko jako
//      „podglad sie nie odswieza".
//   3. POROWNANIE PO WARTOSCI. Szkic jest NOWYM obiektem przy kazdym
//      nacisnieciu klawisza. Zaleznosc efektu po referencji daje `setState`
//      w kazdym renderze, czyli petle - a wtedy studio zwiesza karte
//      przegladarki przy pisaniu tytulu.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Rysunku podgladu (`EventPreviewCanvas`) ani
// nakladki (`EventStudioPreview`) - maja wlasne pliki. Tutaj stoja sondy, bo
// przedmiotem dowodu jest sam kanal danych.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  EMPTY_EVENT_PREVIEW,
  EventStudioPreviewProvider,
  useEventPreviewModel,
  useSyncEventPreview,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";

/** Stan ZAPISANY, na ktory ekrany nakladaja swoje szkice. */
const ZAPISANY: EventPreviewModel = {
  ...EMPTY_EVENT_PREVIEW,
  titlePl: "Zapisany tytul",
  titleEn: "Saved title",
  slug: "zapisany-slug",
  supportEmail: "wsparcie@example.org",
  status: "published",
};

/** Ile razy obserwator zobaczyl nowy model - licznik obiegow kanalu. */
const obiegi: string[] = [];

/** Czytelnik podgladu: tylko odbiera model, sam nic nie wnosi. */
function Obserwator() {
  const model = useEventPreviewModel();
  obiegi.push(model.titlePl);
  return (
    <>
      <span data-testid="tytul-pl">{model.titlePl}</span>
      <span data-testid="tytul-en">{model.titleEn}</span>
      <span data-testid="slug">{model.slug}</span>
      <span data-testid="wsparcie">{model.supportEmail}</span>
      <span data-testid="status">{model.status}</span>
      <span data-testid="strefa">{model.timezone}</span>
    </>
  );
}

/** Ekran wnoszacy szkic - odpowiednik panelu „Informacje ogolne". */
function Ekran({ szkic }: { szkic: Partial<EventPreviewModel> }) {
  useSyncEventPreview(szkic);
  return null;
}

afterEach(() => {
  cleanup();
  obiegi.length = 0;
});

describe("EventStudioPreviewContext - poza dostawca", () => {
  it("model podgladu poza studiem jest PUSTKA, a nie wyjatkiem", () => {
    // Kontrakt jest jawny w zrodle („Poza studiem oddaje pustke, a nie
    // wyjatek") i trzyma przy zyciu kreator oraz testy samych paneli:
    // powierzchnia podgladu zamontowana bez ramy studia ma sie NARYSOWAC.
    render(<Obserwator />);

    // Pustka to CALY `EMPTY_EVENT_PREVIEW`, a nie `undefined` z jednym polem
    // podstawionym przypadkiem: powierzchnia podgladu czyta z modelu takze
    // `status` i `branding`, wiec brakujace pole wywracaloby ja tak samo, jak
    // rzucony wyjatek - tylko o jeden render pozniej i bez nazwy w sladzie.
    expect(screen.getByTestId("tytul-pl")).toBeEmptyDOMElement();
    expect(screen.getByTestId("slug")).toBeEmptyDOMElement();
    expect(screen.getByTestId("status")).toHaveTextContent(EMPTY_EVENT_PREVIEW.status);
    expect(obiegi).toEqual([EMPTY_EVENT_PREVIEW.titlePl]);
  });

  it("ekran wnoszacy szkic poza studiem nie wywraca sie i nie gubi tresci", () => {
    // Panele wydarzenia montuja sie takze w panelu bez ramy studia. Bez
    // bezpiecznego `patch === undefined` kazdy taki ekran padalby na starcie.
    render(
      <>
        <Ekran szkic={{ titlePl: "Szkic bez ramy" }} />
        <Obserwator />
        <p>tresc ekranu</p>
      </>,
    );

    expect(screen.getByText("tresc ekranu")).toBeInTheDocument();
    // Szkic nie ma dokad pojsc, wiec podglad zostaje pusty - ale efekt NIE
    // wola sie w kolko przy braku dostawcy. Jeden obieg na render; petla
    // zwiesilaby panel zamontowany poza rama studia zamiast go tylko wyciszyc.
    expect(screen.getByTestId("tytul-pl")).toBeEmptyDOMElement();
    expect(obiegi).toEqual([EMPTY_EVENT_PREVIEW.titlePl]);
  });
});

describe("EventStudioPreviewContext - szkic kontra stan zapisany", () => {
  it("sekcja, ktora nic nie wnosi, pokazuje stan ZAPISANY", () => {
    // Pusty szkic to nie „wyczysc podglad": ekran „Grupy" nie wie nic
    // o tytule, wiec podglad ma dalej pokazywac tytul z bazy.
    render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{}} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Zapisany tytul");
    expect(screen.getByTestId("slug")).toHaveTextContent("zapisany-slug");
  });

  it("szkic nadpisuje tylko SWOJE pola, reszta zostaje z bazy", () => {
    // Podglad, ktory przy pierwszym szkicu gubi pola spoza ekranu, pokazuje
    // wydarzenie bez adresu i bez poczty wsparcia - czyli stan, ktorego
    // uczestnik nigdy nie zobaczy.
    render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Roboczy tytul", timezone: "Europe/Warsaw" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Roboczy tytul");
    expect(screen.getByTestId("strefa")).toHaveTextContent("Europe/Warsaw");
    expect(screen.getByTestId("tytul-en")).toHaveTextContent("Saved title");
    expect(screen.getByTestId("wsparcie")).toHaveTextContent("wsparcie@example.org");
  });

  it("dwa ekrany wnoszace rozne pola dokladaja sie, a nie kasuja", () => {
    // Nakladka jest wspolna dla calego studia: gdyby kazdy `patch` ja
    // ZASTEPOWAL, ekran brandingu skasowalby tytul wniesiony przez ekran
    // informacji ogolnych, a podglad zaczalby migac miedzy dwoma stanami.
    render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Roboczy tytul" }} />
        <Ekran szkic={{ slug: "roboczy-slug" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Roboczy tytul");
    expect(screen.getByTestId("slug")).toHaveTextContent("roboczy-slug");
  });

  it("kolejne nacisniecie klawisza dojezdza do podgladu", () => {
    // Porownanie po wartosci ma odciac obiegi BEZ ZMIANY, a nie zmiany.
    // Klucz liczony raz (np. z pierwszego szkicu) albo za grubo zaokraglony
    // zamrozilby podglad na pierwszej literze - i redaktor ogladalby tytul,
    // ktorego juz nie pisze.
    const { rerender } = render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Rob" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );
    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Rob");

    rerender(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Robocz" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Robocz");
  });

  it("nowy stan zapisany nie kasuje niezapisanego szkicu", () => {
    // Odswiezenie zapytania w tle oddaje nowy `base`. Podglad ma dalej
    // pokazywac to, co redaktor wlasnie pisze - i jednoczesnie przyjac
    // zmiany w polach, ktorych ekran nie dotyka.
    const { rerender } = render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Roboczy tytul" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    rerender(
      <EventStudioPreviewProvider
        base={{ ...ZAPISANY, titlePl: "Tytul z bazy", supportEmail: "nowe@example.org" }}
      >
        <Ekran szkic={{ titlePl: "Roboczy tytul" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Roboczy tytul");
    expect(screen.getByTestId("wsparcie")).toHaveTextContent("nowe@example.org");
  });
});

describe("EventStudioPreviewContext - porownanie po wartosci", () => {
  it("szkic o tej samej TRESCI nie uruchamia kolejnego obiegu podgladu", () => {
    // Szkic jest nowym obiektem przy kazdym renderze ekranu. Zaleznosc po
    // referencji dawalaby `setState` w kazdym obiegu - czyli petle, ktora
    // zwiesza studio przy pisaniu. Liczba obiegow ma rosnac o JEDEN na
    // przerysowanie ekranu, a nie w nieskonczonosc.
    const { rerender } = render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Roboczy tytul" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    // Start: render z samym `base`, potem jeden obieg po wpisaniu szkicu.
    expect(obiegi).toEqual(["Zapisany tytul", "Roboczy tytul"]);

    for (let i = 0; i < 3; i += 1) {
      rerender(
        <EventStudioPreviewProvider base={ZAPISANY}>
          {/* Za kazdym razem NOWY obiekt o tej samej tresci. */}
          <Ekran szkic={{ titlePl: "Roboczy tytul" }} />
          <Obserwator />
        </EventStudioPreviewProvider>,
      );
    }

    expect(obiegi).toHaveLength(5);
    expect(new Set(obiegi.slice(1))).toEqual(new Set(["Roboczy tytul"]));
  });

  it("defekt: szkic ekranu ZOSTAJE w podgladzie po opuszczeniu tego ekranu", () => {
    // CO JEST ZLE: `useSyncEventPreview` nie ma sprzatania - przy odmontowaniu
    // ekranu jego szkic zostaje w nakladce dostawcy na zawsze, bo nakladke
    // czysci wylacznie kolejny `patch` w TE SAME pola.
    // DLACZEGO TO BOLI: redaktor pisze tytul na „Informacjach ogolnych",
    // NIE zapisuje i przechodzi na „Branding". Podglad - widoczny na kazdej
    // sekcji studia - dalej pokazuje tytul, ktorego nie ma ani w bazie, ani
    // w zadnym otwartym formularzu. Po odswiezeniu strony tytul znika, wiec
    // redaktor czyta to jako „studio zgubilo moj zapis".
    // Naprawa nalezy do kontekstu (cofniecie wniesionych pol w sprzataniu
    // efektu), nie do testu.
    const { rerender } = render(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Ekran szkic={{ titlePl: "Roboczy tytul" }} />
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    rerender(
      <EventStudioPreviewProvider base={ZAPISANY}>
        <Obserwator />
      </EventStudioPreviewProvider>,
    );

    expect(screen.getByTestId("tytul-pl")).toHaveTextContent("Zapisany tytul");
  });
});
