// Karta ankiety - DOSTĘPNOŚĆ WYBORU i ANTI-ANCHORING.
//
// PO CO TEN PLIK ISTNIEJE. `PollCard` ma pokrycie liniowe z testów strony
// i bloku wpisu, ale ani jeden z nich nie mówi nic o tym, co w tym komponencie
// jest naprawdę trudne: to jest KONTROLKA WYBORU JEDNOKROTNEGO zbudowana
// z listy przycisków. Dwie rzeczy zepsute w takiej konstrukcji nie dają ani
// wyjątku, ani złego wyglądu:
//
//   1. SEMANTYKA GRUPY. Lista `<button aria-pressed>` czyta się w czytniku
//      ekranu jak zbiór niezależnych przełączników: nie ma informacji, że
//      opcje są ALTERNATYWAMI, nie ma nazwy grupy (pytania ankiety!), nie ma
//      liczby „1 z 4" i nie działa strzałka jako przejście między opcjami.
//      Użytkownik klawiatury dostaje cztery odrębne przyciski bez kontekstu -
//      a pytanie stoi w nagłówku, poza jakimkolwiek powiązaniem z kontrolkami.
//      ZNALEZISKO: takiej semantyki tu nie było; test niżej jest jej dowodem
//      (bez naprawy `getByRole("radiogroup")` nie ma czego znaleźć - sprawdzone
//      przez uruchomienie testu przed zmianą komponentu).
//   2. ANTI-ANCHORING. Dopóki serwer nie odda `visible: true`, rozkład głosów
//      NIE MOŻE być widoczny - inaczej pierwszy słupek zakotwicza wybór
//      i ankieta mierzy własną prezentację. To jest reguła PRODUKTOWA, zapisana
//      w komentarzu komponentu i egzekwowana przez RPC `vote_poll`, więc
//      warstwa widoku ma ją respektować także wtedy, gdy dane są niekompletne.
//
// CO JEST ATRAPOWANE I DLACZEGO.
//   * `@/lib/community/publicQueries` - `votePoll` woła RPC Supabase. Test nie
//     wychodzi do sieci, a jednocześnie przedmiotem dowodu jest ARGUMENT tego
//     wywołania (indeks opcji), bo przestawiony indeks oddaje głos na cudzą
//     odpowiedź i nie widać tego na ekranie.
//   * `sonner` - toast błędu; asercja mierzy TREŚĆ ze słownika.
//   * Tłumaczenia PRAWDZIWE (`@/test/i18nReal`): każdy napis jest sprawdzany
//     w PL i w EN, więc klucz bez pary językowej oblewa test. Żadnego
//     `defaultValue` w komponencie nie ma i być nie może (bramka repo).
//
// GRANICA DOWODU. Kto ma prawo zobaczyć wyniki (autor głosu, staff, ankieta
// zamknięta) rozstrzyga RPC i to jego dowód; tutaj `visible` jest WEJŚCIEM.
// Kontrastu barw happy-dom nie mierzy (patrz `@/test/axe`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

const votePoll = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/community/publicQueries", () => ({
  votePoll: (...args: unknown[]) => votePoll(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { PollResults, PublicPoll } from "@/lib/community/publicQueries";
import { PollCard } from "../PollCard";

const tPl = realT("pl");
const tEn = realT("en");

const QUESTION_PL = "Czy Unia powinna przyspieszyć rozszerzenie?";
const QUESTION_EN = "Should the EU speed up enlargement?";

const POLL: PublicPoll = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  question_pl: QUESTION_PL,
  question_en: QUESTION_EN,
  options: [
    { pl: "Tak, do 2030", en: "Yes, by 2030" },
    { pl: "Tak, ale bez terminu", en: "Yes, but without a date" },
    { pl: "Nie", en: "No" },
  ],
  status: "open",
  ends_at: null,
};

const HIDDEN: PollResults = { visible: false, my_vote: null, total: 0, counts: [] };
const VISIBLE: PollResults = { visible: true, my_vote: 1, total: 40, counts: [10, 26, 4] };

function renderCard(
  over: {
    poll?: Partial<PublicPoll>;
    results?: PollResults | undefined;
    lang?: "pl" | "en";
    userId?: string | null;
  } = {},
) {
  return renderWithQueryClient(
    <PollCard
      poll={{ ...POLL, ...over.poll }}
      results={"results" in over ? over.results : HIDDEN}
      lang={over.lang ?? "pl"}
      userId={over.userId === undefined ? "user-1" : over.userId}
    />,
  );
}

/**
 * Widoczne WSKAŹNIKI rozkładu głosów („12% · 34"). Świadomie nie liczymy
 * wszystkich cyfr na karcie: cyfra bywa częścią samej odpowiedzi („Tak, do
 * 2030"), a jej obecność nie jest defektem - defektem jest podanie ROZKŁADU.
 */
function distributionsOnCard(): string[] {
  return screen.queryAllByText(/^\d+% · \d+$/).map((el) => el.textContent ?? "");
}

beforeEach(() => {
  votePoll.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("semantyka grupy wyboru jednokrotnego", () => {
  it("opcje stoją w JEDNEJ grupie radiowej nazwanej pytaniem ankiety", () => {
    renderCard();
    // Nazwa grupy = pytanie. Bez tego powiązania czytnik ogłasza „grupa" i trzy
    // opcje bez informacji, na co właściwie odpowiadają.
    const group = screen.getByRole("radiogroup", { name: QUESTION_PL });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("każda opcja ma dostępną nazwę ze swojej etykiety", () => {
    renderCard();
    for (const option of POLL.options) {
      expect(screen.getByRole("radio", { name: new RegExp(option.pl) })).toBeInTheDocument();
    }
  });

  it("stan wyboru jedzie przez `aria-checked`, i wybrana jest DOKŁADNIE jedna", () => {
    renderCard({ results: VISIBLE });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("przed głosowaniem żadna opcja nie jest zaznaczona", () => {
    renderCard();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
  });

  it("nie wnosi naruszeń dostępności - przed głosowaniem i po nim", async () => {
    const before = renderCard();
    const beforeViolations = await axeViolations(before.container);
    expect(beforeViolations, summarize(beforeViolations)).toEqual([]);
    cleanup();

    const after = renderCard({ results: VISIBLE });
    const afterViolations = await axeViolations(after.container);
    expect(afterViolations, summarize(afterViolations)).toEqual([]);
  });

  it("ankieta zamknięta też jest poprawną grupą radiową", async () => {
    const { container } = renderCard({
      poll: { status: "closed" },
      results: VISIBLE,
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    expect(screen.getByRole("radiogroup", { name: QUESTION_PL })).toBeInTheDocument();
  });
});

describe("anti-anchoring: stan przed oddaniem głosu", () => {
  it("mówi wprost, że wyniki pojawią się po głosowaniu", () => {
    renderCard();
    expect(screen.getByText(tPl("community.polls.resultsHidden"))).toBeInTheDocument();
    // Suma głosów to też rozkład - jedno zdanie mniej, a zakotwiczenie takie samo.
    expect(document.body.textContent ?? "").not.toContain(
      tPl("community.polls.totalVotes", { count: 40 }),
    );
  });

  it.fails("DEFEKT: przy ukrytych wynikach karta i tak pokazuje „0% · 0” przy każdej opcji", () => {
    renderCard();
    // KONSEKWENCJA. `AnimatedCount` renderuje `{pct}% · {n}` BEZ WARUNKU na
    // `visible`, więc przed oddaniem głosu obok każdej odpowiedzi stoi „0% · 0".
    // To nie jest neutralny placeholder: czytelnik dostaje LICZBĘ, i to liczbę
    // FAŁSZYWĄ - „na tę opcję nikt nie zagłosował" o ankiecie z setką głosów.
    // Zakotwiczenie na zerze jest zakotwiczeniem: opcja „bez głosów" wygląda
    // na porzuconą. Serwer po to odmawia podania rozkładu (`visible: false`),
    // żeby widok NIE MIAŁ czego pokazać - a widok pokazuje własne zero.
    // Naprawa: `AnimatedCount` renderowany wyłącznie gdy `visible`.
    expect(
      distributionsOnCard(),
      "przed głosowaniem na karcie nie ma prawa być rozkładu głosów",
    ).toEqual([]);
    expect(document.body.textContent ?? "", "ani znaku procentu").not.toContain("%");
  });

  it("kontrola dodatnia: „0% · 0” JEST dziś na ekranie (naprawa wywali it.fails wyżej)", () => {
    renderCard();
    expect(distributionsOnCard()).toEqual(["0% · 0", "0% · 0", "0% · 0"]);
  });

  it("kontrola dodatnia: gdy wyniki SĄ widoczne, liczby są prawdziwe", () => {
    // Ten sam pomiar na stanie jawnym - dowód, że asercja wyżej mierzy
    // widoczność, a nie „czy komponent umie liczyć".
    renderCard({ results: VISIBLE });
    expect(screen.getByText("25% · 10")).toBeInTheDocument();
    expect(screen.getByText("65% · 26")).toBeInTheDocument();
    expect(screen.getByText("10% · 4")).toBeInTheDocument();
  });
});

describe("oddanie głosu", () => {
  it("kliknięcie opcji wysyła DOKŁADNIE jej indeks i odświeża wyniki", async () => {
    votePoll.mockResolvedValue({ visible: true, my_vote: 2, total: 1, counts: [0, 0, 1] });
    const { queryClient } = renderCard();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("radio", { name: /Nie/ }));

    await waitFor(() => expect(votePoll).toHaveBeenCalledTimes(1));
    // Trzecia opcja = indeks 2. Przestawiony indeks oddaje głos na inną
    // odpowiedź, a ekran wygląda identycznie.
    expect(votePoll).toHaveBeenCalledWith(POLL.id, 2);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["public-poll-results"] }),
    );
  });

  it("zmiana głosu jest możliwa - klik w INNĄ opcję niż własna", async () => {
    votePoll.mockResolvedValue(VISIBLE);
    renderCard({ results: VISIBLE });
    fireEvent.click(screen.getByRole("radio", { name: /Tak, do 2030/ }));
    await waitFor(() => expect(votePoll).toHaveBeenCalledWith(POLL.id, 0));
  });

  it("odmowa zapisu daje komunikat ze słownika, nie ciszę", async () => {
    votePoll.mockRejectedValue(new Error("poll_closed"));
    renderCard();
    fireEvent.click(screen.getByRole("radio", { name: /Nie/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(tPl("community.polls.voteError")));
    // Surowy komunikat bazy nie jedzie na ekran - to nazwa warunku RPC,
    // nie zdanie dla czytelnika.
    expect(document.body.textContent ?? "").not.toContain("poll_closed");
  });
});

describe("kto NIE może zagłosować", () => {
  it("gość widzi zaproszenie do logowania i nie oddaje głosu", () => {
    renderCard({ userId: null });
    expect(screen.getByText(tPl("community.polls.signInHint"))).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
      fireEvent.click(radio);
    }
    expect(votePoll).not.toHaveBeenCalled();
  });

  it("ankieta zamknięta: plakietka, wyłączone opcje i BRAK zaproszenia do logowania", () => {
    renderCard({ poll: { status: "closed" }, results: VISIBLE, userId: null });
    expect(screen.getByText(tPl("community.polls.closed"))).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
      fireEvent.click(radio);
    }
    expect(votePoll).not.toHaveBeenCalled();
    // Logowanie nic już nie zmieni - podpowiedź byłaby zaproszeniem w pustkę.
    expect(screen.queryByText(tPl("community.polls.signInHint"))).toBeNull();
  });

  it("termin zakończenia widać TYLKO w ankiecie otwartej", () => {
    const endsAt = "2099-10-01T12:00:00.000Z";
    // Data liczona TAK JAK w komponencie - format zależy od locale platformy,
    // więc wpisany na sztywno napis dowodziłby wersji ICU, nie zachowania karty.
    const expected = tPl("community.polls.endsIn", {
      when: new Date(endsAt).toLocaleDateString("pl-PL"),
    });
    renderCard({ poll: { ends_at: endsAt } });
    expect(screen.getByText(expected)).toBeInTheDocument();
    cleanup();

    renderCard({ poll: { status: "closed", ends_at: endsAt } });
    expect(screen.queryByText(expected)).toBeNull();
  });
});

describe("dane niekompletne i język", () => {
  it("brak wyników w cache czyta się jak wyniki ukryte, nie jak zero głosów", () => {
    renderCard({ results: undefined });
    expect(screen.getByText(tPl("community.polls.resultsHidden"))).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("krótsza tablica liczników nie wysypuje karty ani nie gubi opcji", () => {
    renderCard({ results: { visible: true, my_vote: null, total: 4, counts: [4] } });
    expect(screen.getByText("100% · 4")).toBeInTheDocument();
    // Dwie opcje bez licznika: zero, a nie „NaN%" ani puste miejsce.
    expect(screen.getAllByText("0% · 0")).toHaveLength(2);
  });

  it("suma zero nie dzieli przez zero", () => {
    renderCard({ results: { visible: true, my_vote: null, total: 0, counts: [0, 0, 0] } });
    expect(screen.getAllByText("0% · 0")).toHaveLength(3);
    expect(document.body.textContent ?? "").not.toContain("NaN");
  });

  it("EN bierze wersję angielską pytania i opcji, z awaryjnym przejściem na PL", () => {
    renderCard({ lang: "en" });
    expect(screen.getByRole("radiogroup", { name: QUESTION_EN })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Yes, by 2030/ })).toBeInTheDocument();
    cleanup();

    renderCard({
      lang: "en",
      poll: { question_en: "", options: [{ pl: "Tylko po polsku", en: "" }] },
    });
    expect(screen.getByRole("radiogroup", { name: QUESTION_PL })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tylko po polsku/ })).toBeInTheDocument();
  });

  it("PL bierze wersję polską, z awaryjnym przejściem na EN", () => {
    renderCard({ poll: { question_pl: "", options: [{ pl: "", en: "English only" }] } });
    expect(screen.getByRole("radiogroup", { name: QUESTION_EN })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /English only/ })).toBeInTheDocument();
  });

  it("prop `lang` przestawia FORMAT DATY, a nie język interfejsu", () => {
    // Rozróżnienie jest tu istotne i łatwe do przeoczenia: napisy karty biorą
    // się z AKTYWNEGO języka i18next, a `lang` wybiera treść wydarzenia i locale
    // formatowania. Dla `lang="en"` przy interfejsie PL data jest brytyjska
    // (01/10/2099), a zdanie wokół niej polskie - i tak właśnie ta karta jedzie
    // w bloku wpisu, którego język treści bywa inny niż język panelu.
    const endsAt = "2099-10-01T12:00:00.000Z";
    renderCard({ lang: "en", poll: { ends_at: endsAt } });
    const british = new Date(endsAt).toLocaleDateString("en-GB");
    expect(british).not.toBe(new Date(endsAt).toLocaleDateString("pl-PL"));
    expect(screen.getByText(tPl("community.polls.endsIn", { when: british }))).toBeInTheDocument();
  });

  it("zmiana licznika po odświeżeniu wyników odpala krótką animację wartości", () => {
    const { rerender, queryClient } = renderCard();
    expect(document.querySelector(".animate-fade-in")).toBeNull();

    // Wyniki dojechały (unieważnienie po głosie) - liczba się ZMIENIŁA, więc
    // wartość dostaje wejście animowane. To jedyny sposób odróżnienia „nowa
    // liczba" od „ta sama liczba" bez czytania implementacji.
    rerender(
      <QueryClientProvider client={queryClient}>
        <PollCard poll={POLL} results={VISIBLE} lang="pl" userId="user-1" />
      </QueryClientProvider>,
    );
    expect(document.querySelectorAll(".animate-fade-in").length).toBe(3);
  });

  it("wszystkie napisy karty mają parę PL/EN w słowniku", () => {
    for (const key of [
      "community.polls.closed",
      "community.polls.resultsHidden",
      "community.polls.signInHint",
      "community.polls.voteError",
      "community.polls.endsIn",
    ]) {
      expect(tPl(key), `brak klucza PL: ${key}`).not.toBe(key);
      expect(tEn(key), `brak klucza EN: ${key}`).not.toBe(key);
    }
    // Licznik głosów ma FORMY MNOGIE (pl: głos/głosy/głosów), więc klucz bazowy
    // nie istnieje - sprawdzamy go z `count`, tak jak woła go komponent.
    for (const count of [1, 2, 5, 40]) {
      const key = "community.polls.totalVotes";
      expect(tPl(key, { count }), `brak formy PL dla count=${count}`).not.toBe(key);
      expect(tEn(key, { count }), `brak formy EN dla count=${count}`).not.toBe(key);
    }
    renderCard({ results: VISIBLE });
    expect(document.body.textContent ?? "").not.toContain("community.polls.");
  });
});

describe("ankieta bez opcji", () => {
  it("pusta lista wariantów nie zostawia grupy radiowej naruszającej ARIA", async () => {
    // Blok „poll" na stronie wpisu dostaje czasem wiersz bez wariantów (ankieta
    // w przygotowaniu, uszkodzony JSON w kolumnie `options`). Grupa radiowa BEZ
    // ani jednej opcji jest kontenerem, który obiecuje wybór i go nie daje -
    // sprawdzamy, że axe nie ma do niej zastrzeżeń, a karta nadal niesie pytanie.
    const { container } = renderCard({ poll: { options: [] } });
    expect(screen.getByRole("heading", { name: QUESTION_PL })).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
