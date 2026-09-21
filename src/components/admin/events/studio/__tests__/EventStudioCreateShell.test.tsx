// RAMA STUDIA DLA WYDARZENIA, KTOREGO JESZCZE NIE MA.
//
// PO CO TEN PLIK ISTNIEJE. Kreator jest JEDYNYM ekranem studia bez wiersza
// w bazie, a mimo to ma wygladac i zachowywac sie jak studio. Wszystko, co
// w `EventStudioShell` liczy sie z `admin_event_detail`, tutaj musi byc
// podstawione ze SZKICU FORMULARZA - i dokladnie na tym styku psuje sie
// po cichu:
//   1. NAGLOWEK SIDEBARA POKAZUJE PUSTY WIERSZ. Tytul i termin plyna tu
//      z niezapisanego formularza; pusty tytul ma dostac zastepnik, bo pusty
//      wiersz w naglowku czyta sie jak blad wczytania, a nie jak „jeszcze nie
//      nazwalem".
//   2. RAIL ZACZYNA OBIECYWAC EKRANY, KTORYCH NIE MA. `EVENT_STUDIO_ROUTES`
//      wymaga `eventId`; odnosnik zlozony bez niego prowadzi donikad, dlatego
//      jedyna pozycja kreatora jest `<span aria-current="page">`, a nie link.
//      Jeden wiersz, nie dwadziescia dziewiec wyszarzonych - przejscie
//      z kreatora do studia nie ma przesunac nawigacji.
//   3. PASEK GORNY ZMIENIA SKLAD MIEDZY EKRANAMI. Publikacja ma ZOSTAC na
//      swoim miejscu wyszarzona; akcja, ktora znika i wraca, kaze szukac jej
//      od nowa po zapisie szkicu.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Zachowania samego paska - ma wlasny plik
// (`EventStudioTopBar.test.tsx`). Tutaj pasek stoi PRAWDZIWY, bo przedmiotem
// dowodu jest to, ze kreator podaje mu `createMode`, a nie to, jak pasek
// wyszarza swoje przyciski.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { EventStudioCreateShell } from "@/components/admin/events/studio/EventStudioCreateShell";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const TYTUL_ZASTEPCZY = "adminEvents.list.create.title";
const BEZ_TERMINU = "adminEvents.list.row.noDate";
const NAWIGACJA = "adminEvents.studio.nav.label";
const POWROT = "adminEvents.studio.nav.backToList";
const PUBLIKUJ = "adminEvents.studio.topBar.publish";
const PODGLAD = "adminEvents.studio.topBar.preview";
const SZKIC = "adminEvents.list.status.draft";

/** Zwezenie `Element | null` bez rzutowania - brak wezla to blad testu. */
function wymagany(wezel: Element | null, opis: string): HTMLElement {
  if (!(wezel instanceof HTMLElement)) throw new Error(`test: brak wezla ${opis}`);
  return wezel;
}

function kreator(eventTitle = "", startsAtLabel = "") {
  return render(
    <EventStudioCreateShell eventTitle={eventTitle} startsAtLabel={startsAtLabel}>
      <form aria-label="formularz">
        <input aria-label="tytul" />
      </form>
    </EventStudioCreateShell>,
  );
}

afterEach(cleanup);

describe("EventStudioCreateShell - naglowek szkicu", () => {
  it("pokazuje tytul i termin WPISYWANE w formularzu, zanim cokolwiek zapisano", () => {
    // To jest cala wartosc tej ramy: redaktor widzi w naglowku to, co wlasnie
    // pisze, wiec wie, ze pracuje nad TYM wydarzeniem, a nie nad poprzednim.
    kreator("Forum Bezpieczenstwa 2027", "12 maja 2027, 09:00");

    expect(screen.getByText("Forum Bezpieczenstwa 2027")).toBeInTheDocument();
    expect(screen.getByText("12 maja 2027, 09:00")).toBeInTheDocument();
    expect(screen.queryByText(TYTUL_ZASTEPCZY)).toBeNull();
    expect(screen.queryByText(BEZ_TERMINU)).toBeNull();
  });

  it("pusty tytul i pusty termin dostaja zastepnik, a nie pusty wiersz", () => {
    // Pusty wiersz w naglowku sidebara nie odroznia sie od nieudanego
    // wczytania - a kreator zaczyna wlasnie od pustych pol.
    kreator("", "");

    expect(screen.getByText(TYTUL_ZASTEPCZY)).toBeInTheDocument();
    expect(screen.getByText(BEZ_TERMINU)).toBeInTheDocument();
  });

  it("same spacje licza sie jako brak tytulu i terminu", () => {
    // Pole „wyczyszczone" spacja jest w praktyce puste, a naglowek zlozony
    // z bialych znakow wyglada dokladnie tak, jak wiersz, ktory nie dojechal.
    kreator("   ", "  ");

    expect(screen.getByText(TYTUL_ZASTEPCZY)).toBeInTheDocument();
    expect(screen.getByText(BEZ_TERMINU)).toBeInTheDocument();
  });

  it("zamiast odnosnika do strony publicznej stoi zdanie o szkicu", () => {
    // Szkic nie ma strony publicznej - odnosnik prowadzilby na 404, a jego
    // brak bez slowa wygladalby jak zgubiona pozycja naglowka.
    const { container } = kreator("Zjazd delegatow");

    const sidebar = wymagany(container.querySelector('[data-sidebar="sidebar"]'), "sidebar");
    expect(within(sidebar).getByText("adminEvents.studio.nav.openEventDraft")).toBeInTheDocument();
    // Druga polowa tego samego zdania: zdanie STOI ZAMIAST odnosnika. Caly
    // sidebar kreatora ma dokladnie jedno wyjscie - powrot do listy. Kazdy
    // dodatkowy odnosnik w tym miejscu prowadzilby pod adres wydarzenia,
    // ktorego jeszcze nie ma.
    expect(
      within(sidebar)
        .getAllByRole("link")
        .map((odnosnik) => odnosnik.getAttribute("href")),
    ).toEqual(["/admin/events/list"]);
  });
});

describe("EventStudioCreateShell - nawigacja kreatora", () => {
  it("rail pokazuje DOKLADNIE jedna pozycje i nie udaje odnosnika", () => {
    // `EVENT_STUDIO_ROUTES` wymaga `eventId`, ktorego jeszcze nie ma. Pozycja
    // klikalna prowadzilaby donikad, a dwadziescia dziewiec wyszarzonych
    // przesunelaby cala nawigacje przy przejsciu do studia.
    const { container } = kreator("Zjazd delegatow");

    const nawigacja = screen.getByRole("navigation", { name: NAWIGACJA });
    expect(within(nawigacja).queryAllByRole("link")).toHaveLength(0);

    const aktywne = container.querySelectorAll('[aria-current="page"]');
    expect(aktywne).toHaveLength(1);
    expect(aktywne[0]?.tagName).toBe("SPAN");
    expect(aktywne[0]?.textContent).toBe("adminEvents.studio.sections.general");
  });

  it("powrot do listy jest jednoczesnie wyjsciem z kreatora", () => {
    // Formularz nie ma drugiego „Anuluj" w innym miejscu ekranu - ten jeden
    // odnosnik jest cala droga wyjscia.
    kreator();

    expect(screen.getByRole("link", { name: POWROT })).toHaveAttribute(
      "href",
      "/admin/events/list",
    );
  });

  it("tresc kreatora stoi w glownym obszarze, obok railu", () => {
    // Rama, ktora zjada dzieci, daje ekran z samym sidebarem - a formularz
    // wydarzenia jest jedyna rzecza, po ktora redaktor tu przyszedl.
    const { container } = kreator();

    const glowna = wymagany(container.querySelector("main"), "main");
    expect(within(glowna).getByRole("form", { name: "formularz" })).toBeVisible();
  });
});

describe("EventStudioCreateShell - pasek gorny w trybie kreatora", () => {
  it("akcje wydarzenia stoja na swoim miejscu, ale sa nieczynne", () => {
    // Wydarzenia nie ma w bazie: nie ma czego publikowac ani podgladac.
    // Znikajace przyciski kazalyby szukac ich od nowa po pierwszym zapisie.
    kreator("Zjazd delegatow");

    expect(screen.getByRole("button", { name: PUBLIKUJ })).toBeDisabled();
    expect(screen.getByRole("button", { name: PODGLAD })).toBeDisabled();
  });

  it("stan wydarzenia jest plakietka szkicu, a nie droplista", () => {
    // Droplista nie mialaby czego przestawic - a wygladalaby na czynna.
    kreator("Zjazd delegatow");

    expect(screen.getByText(SZKIC)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SZKIC })).toBeNull();
  });
});

describe("EventStudioCreateShell - dostepnosc", () => {
  it("rama kreatora nie ma naruszen axe", async () => {
    const { container } = kreator("Zjazd delegatow", "1 marca 2027");

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
