// Dwa organizmy liczące DYNAMIKĘ z danych, które lista już ma: pasek aktywności
// klubu (14 dni z wierszy wątków) i puls jednej dyskusji (rozkład odpowiedzi
// w czasie plus cztery liczby).
//
// CO TEN PLIK DOWODZI.
//  (1) OBA LICZĄ Z ZAŁADOWANEJ STRONY, NIE Z CAŁEGO KLUBU - i przy pustym
//      zbiorze nie renderują pustej ramki, bo „zero ruchu” to nie to samo, co
//      „nie ma o czym mówić”.
//  (2) SŁUPEK ZEROWY MA WYGLĄDAĆ INACZEJ NIŻ SŁUPEK Z RUCHEM. To jedyna treść
//      tego wykresu, więc rozróżnienie klasy jest asercją.
//  (3) OKNO CZTERNASTU DNI JEST TWARDĄ GRANICĄ: wątek starszy niż okno i wątek
//      z datą Z PRZYSZŁOŚCI (rozjazd zegara serwera) nie wchodzą do słupków,
//      ale nadal liczą się do stanu „żywy/uśpiony” - to dwie różne miary.
//  (4) DATA NIE DO ODCZYTANIA NIE WYWRACA PASKA. Wiersz z uszkodzonym
//      znacznikiem czasu jest pomijany w rozkładzie, a nie zamienia całą
//      sekcję w awarię.
//  (5) PRZY BRAKU RUCHU W OKNIE (szczyt = 0) słupki mają wysokość minimalną,
//      a nie zerową - pasek bez ani jednego piksela wygląda jak usterka
//      renderowania.
//  (6) PULS BEZ ANI JEDNEJ ODPOWIEDZI MÓWI TO WPROST („brak aktywności”) i
//      stawia kreskę w miejscu czasu do pierwszej odpowiedzi - nie „0 min”,
//      bo pierwszej odpowiedzi po prostu nie było.
//  (7) LICZBA GŁOSÓW TO NIE LICZBA WPISÓW: te dwie metryki stoją obok siebie
//      i muszą się różnić, gdy jedna osoba napisała dwa razy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  (a) `computeThreadPulse` (`src/lib/clubs/threadPulse.ts`) i
//      `computeThreadDynamics`/`formatDurationShort`
//      (`src/lib/clubs/threadDynamics.ts`) mają własne tabele przypadków -
//      progów poziomów ani median nie liczymy tu po raz drugi. Przedmiotem
//      dowodu jest to, że molekuła te reguły WOŁA z właściwym „teraz” i pokazuje
//      ich wynik.
//  (b) Formatów `Intl` - asercje omijają separator i locale (regexp na godzinie,
//      nie na pełnym napisie).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { ClubActivityStrip } from "@/components/clubs/molecules/ClubActivityStrip";
import { ClubThreadPulse } from "@/components/clubs/molecules/ClubThreadPulse";
import type { ThreadPulseInput } from "@/lib/clubs/threadPulse";
import type { ThreadDynamicsReply } from "@/lib/clubs/threadDynamics";
import { WS_BASE_ISO, wsIsoOffset } from "@/test/clubs/threadWorkspaceFixtures";

const GODZINA_W_MINUTACH = 60;
const DOBA_W_MINUTACH = 60 * 24;

function watek(overrides: Partial<ThreadPulseInput> = {}): ThreadPulseInput {
  return {
    created_at: wsIsoOffset(-DOBA_W_MINUTACH),
    last_reply_at: WS_BASE_ISO,
    reply_count: 12,
    participant_count: 5,
    ...overrides,
  };
}

/** Słupki rozkładu - pasek rysuje je jako `<span>` w elemencie `role="img"`. */
function slupki(container: HTMLElement): HTMLSpanElement[] {
  return [...container.querySelectorAll<HTMLSpanElement>('[role="img"] > span')];
}

/** Kafel metryki pulsu: wartość i podpis stoją w jednym pudełku. */
function metryka(podpis: string): HTMLElement {
  const caption = screen.getByText(podpis);
  const root = caption.parentElement;
  if (root === null) throw new Error(`Metryka „${podpis}” nie ma pudełka`);
  return root;
}

beforeEach(() => {
  // Oba organizmy pytają o `Date.now()` w środku - bez zamrożonego zegara test
  // mierzyłby chwilę uruchomienia, a nie regułę.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(WS_BASE_ISO) });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// ClubActivityStrip
// ---------------------------------------------------------------------------

describe("ClubActivityStrip - 14 dni ruchu w klubie", () => {
  it("bez wątków pasek nie powstaje", () => {
    const { container } = render(<ClubActivityStrip threads={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("dane pełne: słupek dnia z ruchem różni się od pustego, a liczby zgadzają się z oknem", () => {
    const { container } = render(
      <ClubActivityStrip
        className="moja-klasa"
        threads={[
          // dziś, żywy: tempo 12/dobę, pięć głosów, świeża odpowiedź
          watek(),
          // trzy dni temu, ani żywy, ani uśpiony
          watek({
            created_at: wsIsoOffset(-10 * DOBA_W_MINUTACH),
            last_reply_at: wsIsoOffset(-3 * DOBA_W_MINUTACH),
            reply_count: 6,
            participant_count: 2,
          }),
          // sprzed roku, bez ani jednej odpowiedzi - uśpiony i POZA oknem
          watek({
            created_at: wsIsoOffset(-400 * DOBA_W_MINUTACH),
            last_reply_at: null,
            reply_count: 0,
            participant_count: 1,
          }),
          // znacznik z przyszłości (rozjazd zegara) - poza oknem, ale żywy
          watek({
            created_at: wsIsoOffset(-2 * DOBA_W_MINUTACH),
            last_reply_at: wsIsoOffset(DOBA_W_MINUTACH),
            reply_count: 1,
            participant_count: 1,
          }),
          // data nie do odczytania - pomijana w rozkładzie, nie wywraca paska
          watek({
            created_at: "termin nieznany",
            last_reply_at: null,
            reply_count: 0,
            participant_count: 0,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("club-activity-strip")).toHaveClass("moja-klasa");
    const bars = slupki(container);
    expect(bars).toHaveLength(14);
    // Dwa dni z ruchem (dziś i trzy dni temu) - reszta okna pusta.
    expect(bars.filter((bar) => bar.className.includes("bg-primary/70"))).toHaveLength(2);
    expect(bars.filter((bar) => bar.className.includes("bg-muted"))).toHaveLength(12);
    // Szczyt to jeden wątek na dzień, więc słupek z ruchem stoi na 100%.
    expect(bars[13]).toHaveStyle({ height: "100%" });

    const label = screen.getByRole("img", { name: "club.activity.chartLabel(days=14)" });
    expect(label).toBeInTheDocument();

    // Tygodniowe okno to siedem ostatnich słupków: dziś + trzy dni temu.
    expect(screen.getByText("club.activity.week").parentElement).toHaveTextContent("2");
    // Żywe: dzisiejszy i ten z przyszłym znacznikiem. Uśpione: sprzed roku
    // i ten z uszkodzoną datą.
    expect(screen.getByText("club.activity.live").parentElement).toHaveTextContent("2");
    expect(screen.getByText("club.activity.dormant").parentElement).toHaveTextContent("2");
  });

  it("wątki wyłącznie sprzed okna dają słupki o wysokości minimalnej, a nie zerowej", () => {
    const { container } = render(
      <ClubActivityStrip
        threads={[
          watek({
            created_at: wsIsoOffset(-90 * DOBA_W_MINUTACH),
            last_reply_at: wsIsoOffset(-40 * DOBA_W_MINUTACH),
            reply_count: 4,
            participant_count: 2,
          }),
        ]}
      />,
    );
    const bars = slupki(container);
    expect(bars).toHaveLength(14);
    for (const bar of bars) {
      expect(bar).toHaveStyle({ height: "12%" });
      expect(bar.className).toContain("bg-muted");
    }
    expect(screen.getByText("club.activity.week").parentElement).toHaveTextContent("0");
  });

  it("wątek bez odpowiedzi kotwiczy słupek na dacie założenia", () => {
    const { container } = render(
      <ClubActivityStrip
        threads={[
          watek({
            created_at: wsIsoOffset(-2 * DOBA_W_MINUTACH),
            last_reply_at: null,
            reply_count: 0,
            participant_count: 1,
          }),
        ]}
      />,
    );
    const bars = slupki(container);
    // Dwa dni temu to trzeci słupek od prawej.
    expect(bars[11]?.className).toContain("bg-primary/70");
    expect(bars[13]?.className).toContain("bg-muted");
  });
});

// ---------------------------------------------------------------------------
// ClubThreadPulse
// ---------------------------------------------------------------------------

describe("ClubThreadPulse - puls jednej dyskusji", () => {
  it("wątek bez odpowiedzi mówi o braku aktywności i stawia kreskę zamiast zera", () => {
    const { container } = render(
      <ClubThreadPulse createdAt={WS_BASE_ISO} replies={[]} lang="pl" />,
    );
    expect(screen.getByText("club.pulse.noActivity")).toBeInTheDocument();
    expect(metryka("club.pulse.firstReply")).toHaveTextContent("-");
    expect(metryka("club.pulse.participants")).toHaveTextContent("0");
    expect(screen.getByRole("img", { name: "club.pulse.chartLabel(count=0)" })).toBeInTheDocument();

    const bars = [...container.querySelectorAll<HTMLSpanElement>('[data-testid="club-thread-sparkline"] > span')];
    expect(bars).toHaveLength(24);
    for (const bar of bars) {
      expect(bar).toHaveStyle({ height: "6%" });
      expect(bar.className).toContain("bg-muted");
    }
  });

  it("dane pełne: liczba głosów różni się od liczby wpisów, a wykres ma słupki niezerowe", () => {
    const replies: ThreadDynamicsReply[] = [
      { created_at: wsIsoOffset(-21 * GODZINA_W_MINUTACH), author_id: "user-a" },
      { created_at: wsIsoOffset(-2 * GODZINA_W_MINUTACH), author_id: "user-b" },
      { created_at: wsIsoOffset(-30), author_id: null, author_alias: "Uczestnik 3" },
      // Wpis z uszkodzoną datą wypada z rozkładu, ale nadal jest osobnym głosem.
      { created_at: "brak daty", author_id: null, author_name: null },
    ];
    const { container } = render(
      <ClubThreadPulse
        createdAt={wsIsoOffset(-DOBA_W_MINUTACH)}
        replies={replies}
        lang="pl"
        className="moja-klasa"
      />,
    );
    expect(screen.getByRole("img", { name: "club.pulse.chartLabel(count=3)" })).toBeInTheDocument();
    expect(metryka("club.pulse.replies")).toHaveTextContent("3");
    expect(metryka("club.pulse.participants")).toHaveTextContent("4");
    expect(metryka("club.pulse.last24h")).toHaveTextContent("3");
    // Trzy godziny od otwarcia wątku do pierwszej odpowiedzi.
    expect(metryka("club.pulse.firstReply")).toHaveTextContent("3 h");
    expect(screen.getByText(/club\.pulse\.lastActivity\(date=.*2026/)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("moja-klasa");

    const bars = [...container.querySelectorAll<HTMLSpanElement>('[data-testid="club-thread-sparkline"] > span')];
    expect(bars.filter((bar) => bar.className.includes("bg-primary/70"))).toHaveLength(3);
    expect(bars.filter((bar) => bar.className.includes("bg-muted"))).toHaveLength(21);
  });

  it("jedna osoba pisząca kilka razy to nadal jeden głos", () => {
    render(
      <ClubThreadPulse
        createdAt={wsIsoOffset(-3 * GODZINA_W_MINUTACH)}
        replies={[
          { created_at: wsIsoOffset(-2 * GODZINA_W_MINUTACH), author_id: "user-a" },
          { created_at: wsIsoOffset(-GODZINA_W_MINUTACH), author_id: "user-a" },
        ]}
        lang="en"
      />,
    );
    expect(metryka("club.pulse.replies")).toHaveTextContent("2");
    expect(metryka("club.pulse.participants")).toHaveTextContent("1");
    // Godzina od otwarcia do pierwszej odpowiedzi - skrót, nie surowe minuty.
    expect(metryka("club.pulse.firstReply")).toHaveTextContent("1 h");
  });
});
