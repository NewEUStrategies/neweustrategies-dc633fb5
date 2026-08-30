// MÓJ HARMONOGRAM - lista sesji, na które uczestnik JEST ZAPISANY.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. „NIE WIEM” TO INNA ODPOWIEDŹ NIŻ „PUSTO”. Dopóki RPC nie odpowie,
//     ekran pokazuje szkielety; dopiero pusta odpowiedź uprawnia do zdania
//     „nie masz jeszcze żadnych zapisów”. Zlanie tych dwóch stanów mówi
//     uczestnikowi, że nie ma nic zaplanowane - w chwili, w której trwa
//     wczytywanie jego własnego planu dnia.
//
//  2. PUSTA AGENDA NIE JEST AWARIĄ. Zdanie „pusto” to normalny stan uczestnika,
//     który jeszcze nic sobie nie wybrał, a nie komunikat błędu.
//
//  3. KOLEJNOŚĆ JEST Z BAZY, NIE Z KOMPONENTU. `event_my_agenda` sortuje po
//     `starts_at NULLS LAST` - lista renderuje wiersze w KOLEJNOŚCI OTRZYMANEJ.
//     Własne sortowanie na froncie rozjechałoby się z tym, co widzi uczestnik
//     na innym urządzeniu po innym zapytaniu.
//
//  4. JĘZYK WYBIERA POLE, NIE TŁUMACZY TREŚCI. Ta sama sesja ma osobny tytuł,
//     salę i ścieżkę po polsku i po angielsku; przełączenie interfejsu ma sięgać
//     po DRUGĄ KOLUMNĘ, a nie pokazywać polską nazwę w angielskim ekranie.
//
//  5. BRAK DANYCH NIE ROBI DZIURY W WIERSZU. Sesja bez sali, bez ścieżki, bez
//     transmisji i bez godziny nadal ma się wyświetlić - z zastępczym tytułem
//     i zdaniem „bez godziny” zamiast pustego miejsca albo „Invalid Date”.
//
//  6. TRANSMISJA WYCHODZI NA ZEWNĄTRZ BEZPIECZNIE. Odnośnik do streamu otwiera
//     się w nowej karcie z `rel="noreferrer noopener"` - bez tego obca strona
//     dostaje uchwyt `window.opener` do karty uczestnika.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Warstwy odczytu (`fetchMyAgenda`) - to jej
// testy mówią, jak wiersz RPC zamienia się w `MyAgendaSession`. (2) Programu
// wydarzenia (zakładka „Agenda”) - to inna powierzchnia i inne dane.
//
// Asercje idą po KLUCZACH i18n; parytetu słowników pilnują osobne bramki.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { MyAgendaSession } from "@/lib/events/myEventProfileApi";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({ jezyk: { current: "pl" } }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk.current),
);

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

const { MyAgendaList } = await import("@/components/events/participant/molecules/MyAgendaList");

/** Sesja w kształcie, jaki oddaje `fetchMyAgenda` - wszystko opcjonalne poza id. */
function sesja(over: Partial<MyAgendaSession> = {}): MyAgendaSession {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    titlePl: "Panel: energetyka jądrowa",
    titleEn: "Panel: nuclear energy",
    startsAt: "2026-09-15T08:30:00.000Z",
    endsAt: "2026-09-15T09:30:00.000Z",
    format: "panel",
    streamUrl: null,
    roomNamePl: "Sala Bałtycka",
    roomNameEn: "Baltic Hall",
    trackNamePl: "Ścieżka: Energia",
    trackNameEn: "Track: Energy",
    signupStatus: "registered",
    ...over,
  };
}

describe("MyAgendaList - wczytywanie kontra pustka", () => {
  it("dopóki dane nie przyszły, pokazuje szkielety i ANI JEDNEGO zdania o pustej agendzie", () => {
    const { container } = render(<MyAgendaList sessions={[]} loading />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("eventMe.agendaEmpty")).toBeNull();
    // Stan oczekiwania nie może udawać listy: żadnego `li` z sesją.
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("pusta odpowiedź to zdanie o braku zapisów, a nie awaria ani szkielet", () => {
    const { container } = render(<MyAgendaList sessions={[]} loading={false} />);

    expect(screen.getByText("eventMe.agendaEmpty")).toBeTruthy();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("dane, które już przyszły, wypierają szkielety - `loading` przegrywa z listą tylko wtedy, gdy jest fałszem", () => {
    const { container } = render(<MyAgendaList sessions={[sesja()]} loading={false} />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(screen.getByText("Panel: energetyka jądrowa")).toBeTruthy();
  });
});

describe("MyAgendaList - wiersz sesji", () => {
  it("pokazuje tytuł, ścieżkę, salę i godzinę z pola JĘZYKA POLSKIEGO", () => {
    h.jezyk.current = "pl";
    render(<MyAgendaList sessions={[sesja()]} loading={false} />);

    const wiersz = screen.getByRole("listitem");
    expect(within(wiersz).getByText("Panel: energetyka jądrowa")).toBeTruthy();
    expect(within(wiersz).getByText("Ścieżka: Energia")).toBeTruthy();
    expect(within(wiersz).getByText("Sala Bałtycka")).toBeTruthy();
    // Godzina jest sformatowana, a nie zastąpiona zdaniem „bez godziny”.
    expect(within(wiersz).queryByText("eventMe.noTime")).toBeNull();
    expect(wiersz.textContent).toContain("2026");
  });

  it("angielski interfejs sięga po DRUGĄ KOLUMNĘ, a nie tłumaczy polskiej", () => {
    h.jezyk.current = "en";
    render(<MyAgendaList sessions={[sesja()]} loading={false} />);

    const wiersz = screen.getByRole("listitem");
    expect(within(wiersz).getByText("Panel: nuclear energy")).toBeTruthy();
    expect(within(wiersz).getByText("Track: Energy")).toBeTruthy();
    expect(within(wiersz).getByText("Baltic Hall")).toBeTruthy();
    expect(within(wiersz).queryByText("Panel: energetyka jądrowa")).toBeNull();
    h.jezyk.current = "pl";
  });

  it("sesja bez tytułu w bieżącym języku dostaje ZASTĘPCZY tytuł, a nie pusty nagłówek", () => {
    h.jezyk.current = "en";
    render(<MyAgendaList sessions={[sesja({ titleEn: null })]} loading={false} />);

    expect(screen.getByText("eventMe.sessionFallbackTitle")).toBeTruthy();
    h.jezyk.current = "pl";
  });

  it("brak sali i brak ścieżki nie rysują pustych plakietek", () => {
    render(
      <MyAgendaList
        sessions={[
          sesja({ roomNamePl: null, roomNameEn: null, trackNamePl: null, trackNameEn: null }),
        ]}
        loading={false}
      />,
    );

    const wiersz = screen.getByRole("listitem");
    expect(within(wiersz).queryByText("Sala Bałtycka")).toBeNull();
    expect(within(wiersz).queryByText("Ścieżka: Energia")).toBeNull();
    // Sam wiersz nadal istnieje - to sesja, nie błąd.
    expect(within(wiersz).getByText("Panel: energetyka jądrowa")).toBeTruthy();
  });

  it("brak godziny mówi to WPROST, zamiast zostawiać puste miejsce", () => {
    render(<MyAgendaList sessions={[sesja({ startsAt: null })]} loading={false} />);

    expect(screen.getByText("eventMe.noTime")).toBeTruthy();
  });

  it("niedającej się odczytać daty nie pokazujemy jako Invalid Date - zostaje zdanie o braku godziny", () => {
    render(<MyAgendaList sessions={[sesja({ startsAt: "nie-data" })]} loading={false} />);

    expect(screen.getByText("eventMe.noTime")).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("transmisja online otwiera się w nowej karcie BEZ uchwytu `window.opener`", () => {
    render(
      <MyAgendaList
        sessions={[sesja({ streamUrl: "https://stream.example.org/sesja-1" })]}
        loading={false}
      />,
    );

    const link = screen.getByRole("link", { name: "eventMe.joinStream" });
    expect(link.getAttribute("href")).toBe("https://stream.example.org/sesja-1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("sesja bez transmisji nie dostaje martwego odnośnika", () => {
    render(<MyAgendaList sessions={[sesja()]} loading={false} />);

    expect(screen.queryByRole("link", { name: "eventMe.joinStream" })).toBeNull();
  });
});

describe("MyAgendaList - dwie sesje w tym samym czasie", () => {
  /**
   * KOLIZJA JEST FAKTEM Z BAZY. `event_session_signups` nie zabrania zapisu na
   * dwie sesje o nachodzących godzinach (unikalność jest per sesja, nie per
   * przedział czasu), więc agenda MUSI umieć pokazać obie - ukrycie jednej
   * zabrałoby uczestnikowi informację, którą sam wprowadził.
   */
  const pierwsza = sesja({
    sessionId: "22222222-2222-4222-8222-222222222222",
    titlePl: "Warsztat: sieci przesyłowe",
    startsAt: "2026-09-15T10:00:00.000Z",
    endsAt: "2026-09-15T11:30:00.000Z",
  });
  const nakladajaca = sesja({
    sessionId: "33333333-3333-4333-8333-333333333333",
    titlePl: "Debata: bezpieczeństwo dostaw",
    startsAt: "2026-09-15T11:00:00.000Z",
    endsAt: "2026-09-15T12:00:00.000Z",
  });

  it("obie nachodzące sesje zostają na liście - agenda nie wybiera za uczestnika", () => {
    render(<MyAgendaList sessions={[pierwsza, nakladajaca]} loading={false} />);

    const wiersze = screen.getAllByRole("listitem");
    expect(wiersze).toHaveLength(2);
    expect(wiersze[0]?.textContent).toContain("Warsztat: sieci przesyłowe");
    expect(wiersze[1]?.textContent).toContain("Debata: bezpieczeństwo dostaw");
  });

  it("kolejność jest DOKŁADNIE ta z bazy - komponent nie sortuje po swojemu", () => {
    // Wejście celowo odwrócone względem czasu: gdyby lista sortowała sama,
    // pierwszy wiersz byłby wcześniejszy. `event_my_agenda` sortuje po
    // `starts_at NULLS LAST` i to JEGO kolejność ma dojechać na ekran.
    render(<MyAgendaList sessions={[nakladajaca, pierwsza]} loading={false} />);

    const wiersze = screen.getAllByRole("listitem");
    expect(wiersze[0]?.textContent).toContain("Debata: bezpieczeństwo dostaw");
    expect(wiersze[1]?.textContent).toContain("Warsztat: sieci przesyłowe");
  });

  it.fails(
    "DEFEKT: sesja z listy rezerwowej rysuje się ZNAK W ZNAK jak sesja z miejscem - `signupStatus` nie dociera na ekran",
    () => {
      // `event_session_signups.status` przyjmuje `waitlist` (migracja
      // 20260823140000), a `event_my_agenda` odsiewa wyłącznie `cancelled` -
      // wiersz rezerwowy wraca razem z `signup_status`. Warstwa odczytu
      // przepisuje go do `MyAgendaSession.signupStatus`, ale lista nigdzie tego
      // pola nie czyta, więc uczestnik z listy rezerwowej widzi sesję w swoim
      // harmonogramie tak samo jak ktoś, kto ma miejsce - i przychodzi pod
      // salę, do której nie zostanie wpuszczony. Ekran odpowiadający na pytanie
      // „gdzie mam być” nie ma prawa milczeć o tej różnicy.
      const zMiejscem = render(
        <MyAgendaList sessions={[sesja({ signupStatus: "registered" })]} loading={false} />,
      );
      const tekstZMiejscem = zMiejscem.getByRole("listitem").textContent;
      zMiejscem.unmount();

      const rezerwowa = render(
        <MyAgendaList sessions={[sesja({ signupStatus: "waitlist" })]} loading={false} />,
      );
      const tekstRezerwowej = rezerwowa.getByRole("listitem").textContent;

      // ASERCJA DOCELOWA: dwa różne stany zapisu muszą dać różny ekran.
      expect(tekstRezerwowej).not.toBe(tekstZMiejscem);
    },
  );
});

describe("MyAgendaList - dostępność", () => {
  it("lista sesji nie ma naruszeń axe", async () => {
    const { container } = render(
      <MyAgendaList
        sessions={[
          sesja(),
          sesja({
            sessionId: "44444444-4444-4444-8444-444444444444",
            streamUrl: "https://stream.example.org/sesja-2",
            roomNamePl: null,
            trackNamePl: null,
          }),
        ]}
        loading={false}
      />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zdanie o pustej agendzie nie ma naruszeń axe", async () => {
    const { container } = render(<MyAgendaList sessions={[]} loading={false} />);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
