// PRYMITYWY EKRANU STUDIA - ZACHOWANIE, nie sam uklad.
//
// PLIK SIOSTRZANY DO `EventStudioSection.test.tsx`, ktory przypina kontrakt
// WIZUALNY (licznik CSS, zaokraglenie 6 px). Tutaj stoi to, co ten sam plik
// zrodlowy ROBI - i co jest w nim faktycznie zepsuwalne:
//   1. PASEK ZAPISU JEST JEDYNA DROGA DO ZAPISU EKRANU. Zapis jest JAWNY,
//      bo ekrany studia zmieniaja adres publiczny, termin i strefe - czyli
//      rzeczy, ktore zaraz po zapisie ida do przypomnien i do kalendarzy
//      uczestnikow. Pasek, ktory pokazuje sie zawsze, uczy, zeby go nie
//      zauwazac; pasek, ktory nie wylacza przyciskow na czas zapisu, wysyla
//      ten sam formularz drugi raz.
//   2. RZAD ZAKLADEK REKORDU MOWI, GDZIE JESTESMY. Zakladka bez `aria-selected`
//      albo zaznaczona podwojnie zabiera jedyna odpowiedz na pytanie „ktora
//      zakladke rekordu ogladam"; `onSelect` bez klucza przenosi na inna.
//   3. NAGLOWEK MA DWA WARIANTY I NIE WOLNO ICH ZLEPIC. Ekran z samym H1 nie
//      moze dostac pustego akapitu (tabela zjezdza nizej niz na siostrzanym
//      ekranie), a rekord bez zakladek nie moze dostac kreski, ktora obiecuje
//      rzad zakladek.
//   4. PIGULKA POMOCY WYCHODZI NA OBCY SERWIS. Bez `rel="noreferrer"` obcy
//      serwis dostaje w naglowku adres panelu razem z identyfikatorem
//      wydarzenia; bez `target="_blank"` redaktor traci niezapisany szkic,
//      bo artykul pomocy otwiera sie W MIEJSCU formularza.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Numeracji sekcji na `EventStudioPage`
// i zaokraglenia 6 px - stoja w `EventStudioSection.test.tsx` i powtorzone
// tutaj rozjechalyby sie przy pierwszej korekcie. Reset licznika na WARIANCIE
// REKORDU jest tu mimo to, bo tamten plik go nie zna: `EventStudioRecordPage`
// ma wlasna powloke tresci i wlasny reset, wiec gubi sie osobno.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRecordPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

const POMOC = "adminEvents.studio.help.learnHow";

/** Zwezenie `Element | null` bez rzutowania - brak wezla to blad testu. */
function wymagany(wezel: Element | null, opis: string): HTMLElement {
  if (!(wezel instanceof HTMLElement)) throw new Error(`test: brak wezla ${opis}`);
  return wezel;
}

afterEach(cleanup);

describe("EventStudioPage - naglowek ekranu", () => {
  it("ekran z samym tytulem nie dostaje pustego akapitu", () => {
    // Pusty wiersz pod H1 przesuwa tabele nizej niz na siostrzanym ekranie,
    // a wtedy przejscie miedzy dwiema listami wyglada jak przeskok ukladu.
    const { container } = render(
      <EventStudioPage title="Kanaly feedu">
        <p>tresc</p>
      </EventStudioPage>,
    );

    expect(container.querySelectorAll("header p")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "Kanaly feedu" })).toBeInTheDocument();
  });

  it("pigulka pomocy konczy ZDANIE opisu i otwiera sie poza panelem", () => {
    // Odsylacz czyta sie jako „a jesli to za malo, przeczytaj" i dlatego stoi
    // w akapicie, a nie w pasku narzedzi obok akcji glownej. Otwarcie
    // W MIEJSCU formularza kosztowaloby redaktora niezapisany szkic.
    render(
      <EventStudioPage
        title="Osoby"
        description="Kto ma dostep do wydarzenia."
        helpHref="https://example.org/pomoc/osoby"
      >
        <p>tresc</p>
      </EventStudioPage>,
    );

    const odsylacz = screen.getByRole("link", { name: POMOC });
    expect(odsylacz).toHaveAttribute("href", "https://example.org/pomoc/osoby");
    expect(odsylacz).toHaveAttribute("target", "_blank");
    // Bez `noreferrer` obcy serwis dostaje adres panelu z identyfikatorem
    // wydarzenia w naglowku odeslania.
    expect(odsylacz).toHaveAttribute("rel", "noreferrer");
    expect(odsylacz.closest("p")).toHaveTextContent("Kto ma dostep do wydarzenia.");
  });

  it("bez adresu pomocy pigulki nie ma wcale, a opis zostaje", () => {
    render(
      <EventStudioPage title="Osoby" description="Kto ma dostep do wydarzenia.">
        <p>tresc</p>
      </EventStudioPage>,
    );

    expect(screen.queryByRole("link", { name: POMOC })).toBeNull();
    expect(screen.getByText("Kto ma dostep do wydarzenia.")).toBeInTheDocument();
  });

  it("sam adres pomocy, bez zdania opisu, tez rysuje pigulke", () => {
    // Opis i pigulka sa opcjonalne OSOBNO - ekran, ktory nie potrzebuje
    // zdania, nie moze przez to stracic odsylacza do artykulu.
    render(
      <EventStudioPage title="Osoby" helpHref="https://example.org/pomoc/osoby">
        <p>tresc</p>
      </EventStudioPage>,
    );

    const odsylacz = screen.getByRole("link", { name: POMOC });
    expect(odsylacz).toHaveAttribute("href", "https://example.org/pomoc/osoby");
    // Akapit niesie WYLACZNIE pigulke. Gdyby wariant „bez opisu" renderowal
    // pusty `description`, redaktor dostalby przed odsylaczem pusty wiersz -
    // czyli dokladnie ten przeskok ukladu, ktoremu ma zapobiegac warunek
    // z sasiedniego testu.
    expect(wymagany(odsylacz.closest("p"), "akapit opisu").textContent).toBe(POMOC);
  });
});

describe("EventStudioRow - opis jest czescia kontrolki", () => {
  it("zdanie wyjasniajace stoi przy polu, ktorego dotyczy", () => {
    // Pole bez wyjasnienia zostaje puste albo wypelnione czyms, co nie ma
    // sensu - dlatego opis jest czescia wiersza ustawien, a nie ozdoba.
    render(
      <EventStudioPage title="Informacje ogolne">
        <EventStudioRow
          label="Adres publiczny"
          description="Twoi odbiorcy zostana przekierowani na ten adres."
          hint={<span>Zmiana adresu zrywa stare odnosniki.</span>}
        >
          <input aria-label="slug" />
        </EventStudioRow>
      </EventStudioPage>,
    );

    const wiersz = wymagany(
      screen.getByRole("heading", { level: 2, name: "Adres publiczny" }).closest("section"),
      "wiersz ustawien",
    );
    expect(wiersz).toHaveTextContent("Twoi odbiorcy zostana przekierowani na ten adres.");
    // Dopisek pod opisem (ostrzezenie albo odsylacz) nalezy do TEGO wiersza -
    // wyniesiony poza niego traci pole, o ktorym mowi.
    expect(wiersz).toHaveTextContent("Zmiana adresu zrywa stare odnosniki.");
    expect(within(wiersz).getByLabelText("slug")).toBeInTheDocument();
  });
});

describe("EventStudioChoiceCard - wybor ze zdaniem wyjasniajacym", () => {
  function wybor(zaznaczony: "onsite" | "online") {
    const onSelect = vi.fn<(wartosc: string) => void>();
    render(
      <>
        <EventStudioChoiceCard
          id="format-onsite"
          name="format"
          checked={zaznaczony === "onsite"}
          label="Na miejscu"
          description="Uczestnicy przychodza pod wskazany adres."
          onSelect={() => onSelect("onsite")}
        />
        <EventStudioChoiceCard
          id="format-online"
          name="format"
          checked={zaznaczony === "online"}
          label="Online"
          onSelect={() => onSelect("online")}
        />
      </>,
    );
    return { onSelect };
  }

  it("karta niesie zdanie wyjasniajace - i dlatego nie jest droplista", () => {
    // Droplista chowa te zdania i zmusza do zgadywania, czym rozni sie
    // „Na miejscu" od „Online" w zapisie wydarzenia.
    wybor("onsite");

    // Zdanie nalezy do TEJ karty, a nie stoi luzem obok obu - inaczej nie
    // wiadomo, ktorego wariantu dotyczy.
    const naMiejscu = wymagany(
      screen.getByLabelText(/Na miejscu/).closest("label"),
      "karta wyboru: na miejscu",
    );
    expect(naMiejscu).toHaveTextContent("Uczestnicy przychodza pod wskazany adres.");

    // Wariant BEZ zdania nie dostaje pustego wiersza pod etykieta: karta
    // „Online" ma w tresci sama etykiete. Pusty akapit podnosilby ja o wiersz
    // wzgledem sasiadki i rzad kart rozjechalby sie w pionie.
    const online = wymagany(
      screen.getByLabelText("Online").closest("label"),
      "karta wyboru: online",
    );
    expect(online.textContent).toBe("Online");
  });

  it("zaznaczenie idzie z ekranu, a wybor oddaje sterowanie z powrotem", () => {
    // Karta jest kontrolowana: gdyby trzymala wlasny stan, zaznaczenie
    // rozjechaloby sie ze szkicem formularza i zapis poszedlby z innym
    // formatem, niz redaktor widzi na ekranie.
    const { onSelect } = wybor("onsite");

    const naMiejscu = screen.getByLabelText(/Na miejscu/);
    const online = screen.getByLabelText("Online");
    expect(naMiejscu).toBeChecked();
    expect(online).not.toBeChecked();

    fireEvent.click(online);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("online");
    // Bez zmiany propsa zaznaczenie NIE przeskakuje samo.
    expect(screen.getByLabelText(/Na miejscu/)).toBeChecked();
  });
});

describe("EventStudioRecordPage - naglowek rekordu", () => {
  function rekord(zZakladkami: boolean) {
    const onSelect = vi.fn<(key: string) => void>();
    const { container } = render(
      <EventStudioRecordPage
        title="Sesja otwierajaca"
        badge="12"
        tabs={
          zZakladkami
            ? {
                items: [
                  { key: "detale", label: "Szczegoly" },
                  { key: "uczestnicy", label: "Uczestnicy", count: 3 },
                ],
                active: "detale",
                onSelect,
              }
            : undefined
        }
      >
        <EventStudioRow label="Termin sesji">
          <p>pole terminu</p>
        </EventStudioRow>
      </EventStudioRecordPage>,
    );
    return { onSelect, container };
  }

  it("rzad zakladek nalezy do TEGO rekordu i wskazuje jedna aktywna", () => {
    // Czytnik ekranu musi powiedziec, CZYJE to zakladki - inaczej „Uczestnicy"
    // brzmi tak samo w sesji, w spotkaniu i na liscie zgloszen.
    rekord(true);

    const naglowek = screen.getByRole("heading", { level: 1, name: "Sesja otwierajaca" });
    const rzad = screen.getByRole("tablist");
    expect(rzad).toHaveAttribute("aria-labelledby", naglowek.id);

    const zakladki = within(rzad).getAllByRole("tab");
    expect(zakladki.map((z) => z.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("wybor zakladki oddaje JEJ klucz, a nie etykiete ani numer", () => {
    // Rekord przelacza zakladke po kluczu; etykieta jest tlumaczona i nie jest
    // unikalna, wiec przekazana zamiast klucza otwieralaby zla zakladke.
    const { onSelect } = rekord(true);

    fireEvent.click(screen.getByRole("tab", { name: /Uczestnicy/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("uczestnicy");
  });

  it("licznik zakladki jest opcjonalny i nie dorabia sie zeru", () => {
    // „Uczestnicy (3)" niesie informacje; „Szczegoly (0)" klamaloby, ze rekord
    // ma zero czegos, czego w ogole nie liczy.
    rekord(true);

    expect(screen.getByRole("tab", { name: "Uczestnicy (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Szczegoly" })).toBeInTheDocument();
  });

  it("rekord bez zakladek nie dostaje ani rzedu, ani kreski pod naglowkiem", () => {
    // Kreska bez zakladek obiecuje rzad, ktorego nie ma - redaktor szuka go
    // wzrokiem i przewija ekran w gore.
    const { container } = rekord(false);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(container.querySelectorAll(".border-b")).toHaveLength(0);
  });

  it("numeracja sekcji zaczyna sie na kazdym rekordzie od nowa", () => {
    // Numer jest adresem sekcji w obrebie EKRANU („wroc do 03"); licznik
    // ciagnacy sie miedzy rekordami dawalby dwa rozne numery tej samej sekcji.
    const { container } = rekord(false);

    expect(container.querySelector('[class*="counter-reset"]')).not.toBeNull();
    expect(container.querySelectorAll('[class*="counter-increment"]')).toHaveLength(1);
  });

  it("pigulka przy nazwie rekordu jest opcjonalna", () => {
    // Rekord bez licznika nie moze dostac PUSTEJ pigulki: szara plamka bez
    // tresci czyta sie jak licznik, ktory nie doliczyl - a redaktor odswieza
    // wtedy ekran w poszukiwaniu liczby, ktorej nigdy nie bedzie.
    render(
      <EventStudioRecordPage title="Sesja bez zgloszen">
        <p>tresc</p>
      </EventStudioRecordPage>,
    );

    const naglowek = screen.getByRole("heading", { level: 1 });
    expect(naglowek).toHaveTextContent("Sesja bez zgloszen");
    const rzad = wymagany(naglowek.parentElement, "rzad naglowka rekordu");
    expect(rzad.children).toHaveLength(1);
    expect(rzad.textContent).toBe("Sesja bez zgloszen");
    expect(screen.getByText("tresc")).toBeInTheDocument();
  });

  it("rekord z zakladkami nie ma naruszen axe", async () => {
    const { container } = rekord(true);

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("EventStudioSaveBar - jawny zapis ekranu", () => {
  interface Stan {
    dirty?: boolean;
    saving?: boolean;
    disabled?: boolean;
    zLewa?: boolean;
  }

  function pasek(stan: Stan = {}) {
    const onSave = vi.fn<() => void>();
    const onDiscard = vi.fn<() => void>();
    const { container } = render(
      <EventStudioSaveBar
        dirty={stan.dirty ?? true}
        saving={stan.saving ?? false}
        saveLabel="Zapisz zmiany"
        discardLabel="Odrzuc"
        savingLabel="Zapisywanie..."
        onSave={onSave}
        onDiscard={onDiscard}
        disabled={stan.disabled}
        leading={stan.zLewa === true ? <button type="button">Przywroc branding</button> : undefined}
      />,
    );
    return { onSave, onDiscard, container };
  }

  it("bez zmian paska nie ma wcale", () => {
    // Pasek stojacy zawsze uczy, zeby go nie zauwazac - a wtedy nie zauwaza
    // sie go takze wtedy, gdy naprawde jest cos do zapisania.
    const { container } = pasek({ dirty: false, saving: false });

    expect(container).toBeEmptyDOMElement();
  });

  it("przy niezapisanej zmianie daje OBIE drogi: zapis i porzucenie", () => {
    const { onSave, onDiscard } = pasek({ dirty: true });

    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Odrzuc" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("w trakcie zapisu pasek ZOSTAJE, mowi o tym i nie przyjmuje klikniec", () => {
    // Formularz przestaje byc „brudny" w chwili wyslania, ale zapis jeszcze
    // trwa. Znikajacy pasek wygladalby jak zapis zakonczony, a odblokowane
    // przyciski wyslalyby ten sam ekran drugi raz.
    const { onSave, onDiscard } = pasek({ dirty: false, saving: true });

    expect(screen.getByText("Zapisywanie...")).toBeInTheDocument();

    const zapisz = screen.getByRole("button", { name: "Zapisz zmiany" });
    const odrzuc = screen.getByRole("button", { name: "Odrzuc" });
    expect(zapisz).toBeDisabled();
    expect(odrzuc).toBeDisabled();

    fireEvent.click(zapisz);
    fireEvent.click(odrzuc);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("poza zapisem napisu o zapisywaniu nie ma", () => {
    pasek({ dirty: true, saving: false });

    expect(screen.queryByText("Zapisywanie...")).toBeNull();
  });

  it("ekran niepoprawny blokuje ZAPIS, ale nadal daje sie porzucic", () => {
    // `disabled` niesie „tego stanu nie wolno zapisac" (pusty slug, zly
    // termin). Zablokowanie przy okazji porzucenia zamykaloby redaktora
    // w formularzu, ktorego nie da sie ani zapisac, ani opuscic bez utraty.
    const { onSave, onDiscard } = pasek({ dirty: true, disabled: true });

    expect(screen.getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Odrzuc" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("dodatkowa akcja ekranu stoi po lewej, obok zapisu", () => {
    // „Przywroc branding spolecznosci" nalezy do TEGO paska, bo dotyczy tego
    // samego szkicu - wyniesiona wyzej dzialalaby na stan juz zapisany.
    // I stoi PRZED zapisem: postawiona za nim konkurowalaby z akcja glowna
    // ekranu, a przywrocenie brandingu kasuje wlasnie to, co redaktor zebral.
    pasek({ dirty: true, zLewa: true });

    const dodatkowa = screen.getByRole("button", { name: "Przywroc branding" });
    const zapisz = screen.getByRole("button", { name: "Zapisz zmiany" });
    expect(dodatkowa.parentElement).toBe(zapisz.parentElement);
    expect(dodatkowa.compareDocumentPosition(zapisz)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("pasek zapisu nie ma naruszen axe", async () => {
    const { container } = pasek({ dirty: true, saving: true });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
