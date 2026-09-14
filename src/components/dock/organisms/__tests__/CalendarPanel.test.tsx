// MINI-KALENDARZ DOKU - do tej pory 0% pokrycia, przy pięciu obietnicach
// panelu, których nie pilnuje NIC innego w repozytorium:
//
//   1. „DZIŚ” JEST DNIEM REDAKCJI, A NIE DNIEM MASZYNY CZYTELNIKA. Kursor
//      startowy i klucz dnia bieżącego idą przez `siteMonth`/`siteDayKey`
//      (strefa serwisu), a etykieta miesiąca przez `formatDateOnly`, czyli
//      UTC. `calendarTime.test.ts` dowodzi tego jednostkowo, na dwóch
//      strefach procesu; tutaj sprawdzamy rzecz, której tamten plik nie widzi
//      - czy PANEL naprawdę z tych funkcji korzysta, a nie z gołego `new
//      Date()` obok nich.
//   2. PRZEWIJANIE MIESIĄCA NIE GASI SIATKI. Zmiana miesiąca zmienia klucz
//      zapytania, więc bez `placeholderData` siatka gubiła wszystkie kropki,
//      a lista dnia twierdziła „brak wydarzeń tego dnia”, zanim cokolwiek
//      wiedziała. Dowód jest z konieczności synchroniczny: asercja pada
//      między kliknięciem a przyjściem odpowiedzi.
//   3. PANEL NIE ZGADUJE PRZY PIERWSZYM POBRANIU. Dopóki trwa pierwsze
//      pobranie miesiąca, na dole stoi szkielet, a nie zdanie o pustym dniu.
//   4. JĘZYK TREŚCI TO NIE JĘZYK INTERFEJSU. Prop `lang` steruje WYŁĄCZNIE
//      tytułami wpisów i etykietą miesiąca; chrome panelu (tytuł, strzałki,
//      skróty dni, komunikaty) idzie przez i18n, które w teście stoi na
//      polskim. To kontrakt, nie przeoczenie - i jedyne miejsce, gdzie widać
//      go na ekranie.
//   5. BŁĄD NIE ODBIERA NAWIGACJI. Komunikat zastępuje listę dnia, ale
//      strzałki miesięcy zostają klikalne (komentarz przy `aria-busy`
//      w panelu mówi o tym wprost).
//
// ZEGAR JEST ZAMROŻONY NA KANONICZNYM „TERAZ” (`@/test/time`), bo panel czyta
// `Date.now()` przez `siteDayKey`, a plik niesie literały kalendarzowe.
// Przy 15 czerwca 2099 siatka jest wyjątkowo czysta: 1 czerwca wypada
// w poniedziałek, więc 42 komórki to dokładnie 2099-06-01 .. 2099-07-12, bez
// ani jednego dnia z maja. Strefa procesu w CI jest pusta (UTC) i tyle samo
// zakłada `dayKey` siatki, dlatego klucze komórek porównujemy dodatkowo
// z wynikiem PRAWDZIWEGO `monthGrid` - gdyby ktoś ustawił `TZ`, oblewa się
// ta jedna asercja i od razu wiadomo dlaczego.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { dockEn, dockPl } from "@/lib/i18n-dock";
import { fail, ok, supabaseFromStub, type TableResponder } from "@/test/supabaseChain";
import { freezeClock } from "@/test/time";
import { monthGrid } from "@/lib/dock/calendarGrid";
import type { UserTodo } from "@/lib/dock/types";
import { axeViolations, summarize } from "@/test/axe";

freezeClock();

const auth = vi.hoisted(() => ({ user: { id: "member" } as { id: string } | null }));
const db = supabaseFromStub();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

import { CalendarPanel } from "../CalendarPanel";

/** Dzień bieżący w strefie serwisu przy zamrożonym zegarze. */
const TODAY = "2099-06-15";

/** Wiersz `public.events` w kształcie, w jakim czyta go warstwa danych. */
interface EventRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string;
}

// Treść wymyślona - kalendarz doku nie niesie żadnych prawdziwych danych.
const FORUM: EventRow = {
  id: "ev-forum",
  slug: "forum-czerwcowe",
  title_pl: "Forum czerwcowe",
  title_en: "June forum",
  starts_at: `${TODAY}T12:00:00.000Z`,
};
const KOLACJA: EventRow = {
  id: "ev-kolacja",
  slug: "kolacja-na-koniec-miesiaca",
  title_pl: "Kolacja na koniec miesiąca",
  title_en: "End of month dinner",
  starts_at: "2099-06-29T12:00:00.000Z",
};
const WARSZTAT: EventRow = {
  id: "ev-warsztat",
  slug: "warsztat-lipcowy",
  title_pl: "Warsztat lipcowy",
  title_en: "July workshop",
  starts_at: "2099-07-03T12:00:00.000Z",
};
const NARADA: EventRow = {
  id: "ev-narada",
  slug: "narada-kwietniowa",
  title_pl: "Narada kwietniowa",
  title_en: "April briefing",
  starts_at: "2099-04-07T12:00:00.000Z",
};

const todo = (id: string, patch: Partial<UserTodo> = {}): UserTodo => ({
  id,
  title: id,
  priority: "medium",
  due_at: null,
  done: false,
  done_at: null,
  source_task_id: null,
  created_at: "2099-06-01T00:00:00.000Z",
  ...patch,
});

/**
 * Odpowiedź tabeli `events` ZALEŻNA od okna, o które panel poprosił.
 *
 * Dzięki temu przewijanie miesięcy jest deterministyczne: test nie zgaduje,
 * które pobranie było które, tylko czyta `gte("starts_at", ...)` z łańcucha -
 * czyli dokładnie ten argument, którym panel wybiera miesiąc.
 */
function eventsByMonth(rows: Record<string, EventRow[]>): TableResponder {
  return (chain) => {
    const from = String(chain.argsOf("gte")?.[1] ?? "");
    return ok(rows[from.slice(0, 7)] ?? []);
  };
}

function renderPanel(lang: "pl" | "en" = "pl") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <CalendarPanel onClose={onClose} lang={lang} />
    </QueryClientProvider>,
  );
  return { ...view, client, onClose };
}

/** Czeka, aż pierwsze pobranie miesiąca się domknie (szkielet znika). */
async function settle(): Promise<void> {
  await waitFor(() => expect(document.querySelector(".skeleton-shimmer")).toBeNull());
}

function dayCell(key: string): HTMLElement {
  return screen.getByLabelText(key);
}

/** Kontener 42 komórek - po nim poznajemy przygaszenie na czas dociągania. */
function dayGrid(): HTMLElement {
  const grid = document.querySelector<HTMLElement>("button[aria-label^='2099-']")?.parentElement;
  if (!grid) throw new Error("brak siatki dni");
  return grid;
}

function dayKeys(): (string | null)[] {
  return Array.from(document.querySelectorAll("button[aria-label^='2099-']")).map((cell) =>
    cell.getAttribute("aria-label"),
  );
}

/** Kropka „tego dnia coś jest” - `<span aria-hidden>` wewnątrz komórki. */
function hasDot(key: string): boolean {
  return dayCell(key).querySelector("span[aria-hidden]") !== null;
}

function dotCount(): number {
  return document.querySelectorAll("button[aria-label^='2099-'] span[aria-hidden]").length;
}

function monthLabel(): string {
  return screen.getByLabelText(dockPl.dock.calendar.prev).nextElementSibling?.textContent ?? "";
}

/**
 * NIEZALEŻNE wyliczenie etykiety miesiąca: ta sama chwila w UTC i locale
 * interfejsu. Świadomie NIE wołamy `formatDateOnly` - test sprawdzałby wtedy
 * sam siebie, a pytanie brzmi, czy panel formatuje miesiąc BEZ strefy
 * czytelnika (miesiąc nie ma chwili, tak samo jak kolumna DATE).
 */
function intlMonth(isoDate: string, lang: "pl" | "en"): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

beforeEach(() => {
  auth.user = { id: "member" };
  db.reset();
  // Każda tabela, której panel dotyka, musi mieć zaplanowaną odpowiedź -
  // atrapa zwraca BŁĄD dla tabeli bez plany, żeby cichy `[]` nie udawał
  // poprawnego odczytu.
  for (const table of ["events", "user_todos"]) db.setResponse(table, ok([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CalendarPanel - siatka miesiąca", () => {
  it("otwiera się na miesiącu bieżącym strefy serwisu, z dniem dzisiejszym wybranym", async () => {
    renderPanel();
    await settle();

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", dockPl.dock.calendar.title);
    expect(monthLabel()).toBe(intlMonth("2099-06-01", "pl"));
    expect(dayCell(TODAY)).toHaveAttribute("aria-pressed", "true");
  });

  it("rysuje 42 komórki od poniedziałku, a dni spoza miesiąca są wyszarzone", async () => {
    renderPanel();
    await settle();

    // Porównanie z PRAWDZIWYM `monthGrid` zamiast z listą literałów: gdyby
    // maszyna miała ustawione `TZ`, oblewa się druga asercja, nie pierwsza,
    // i od razu widać, że to strefa, a nie panel.
    expect(dayKeys()).toEqual(monthGrid(2099, 5, []).map((day) => day.key));
    expect(dayKeys()).toHaveLength(42);
    expect(dayKeys()[0]).toBe("2099-06-01");
    expect(dayKeys().at(-1)).toBe("2099-07-12");
    expect(dayCell("2099-07-01").className).toContain("text-muted-foreground/50");
    expect(dayCell("2099-06-30").className).not.toContain("text-muted-foreground/50");
  });

  it("skróty dni tygodnia biorą się ze słownika, w kolejności od poniedziałku", async () => {
    const { container } = renderPanel();
    await settle();

    // Jedyne w doku wywołanie `returnObjects: true` - tablica ze słownika,
    // a nie siedem osobnych kluczy. Bez tej asercji zamiana tablicy na napis
    // wywróciłaby panel dopiero w przeglądarce.
    const strip = container.querySelector(".grid-cols-7");
    expect(Array.from(strip?.children ?? []).map((cell) => cell.textContent)).toEqual(
      dockPl.dock.calendar.weekdays,
    );
  });

  it("obwódka „dziś” zostaje na dzisiejszej komórce po wybraniu innego dnia", async () => {
    renderPanel();
    await settle();

    fireEvent.click(dayCell("2099-06-16"));

    expect(dayCell("2099-06-16")).toHaveAttribute("aria-pressed", "true");
    expect(dayCell(TODAY)).toHaveAttribute("aria-pressed", "false");
    expect(dayCell(TODAY).className).toContain("ring-primary");
    expect(dayCell("2099-06-16").className).not.toContain("ring-primary");
  });
});

describe("CalendarPanel - lista wybranego dnia", () => {
  it("przed pierwszą odpowiedzią pokazuje szkielet, a NIE zdanie o pustym dniu", async () => {
    const { container } = renderPanel();

    // Asercja przed jakimkolwiek `await`: zapytanie miesiąca rozwiązuje się
    // w mikrozadaniu, więc to jest dokładnie ta klatka, w której panel nic
    // jeszcze nie wie.
    expect(container.querySelectorAll(".skeleton-shimmer")).toHaveLength(2);
    expect(screen.queryByText(dockPl.dock.calendar.dayEmpty)).toBeNull();

    await settle();
    expect(screen.getByText(dockPl.dock.calendar.dayEmpty)).toBeInTheDocument();
  });

  it("wydarzenie ląduje w komórce swojego dnia i na liście dnia jako odnośnik", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM] }));
    renderPanel();
    await settle();

    expect(hasDot(TODAY)).toBe(true);
    expect(hasDot("2099-06-16")).toBe(false);
    const link = screen.getByText(FORUM.title_pl);
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", `/events/${FORUM.slug}`);
  });

  it("wybranie dnia bez wpisów mówi wprost, że nic w nim nie ma", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM] }));
    renderPanel();
    await settle();
    expect(screen.getByText(FORUM.title_pl)).toBeInTheDocument();

    fireEvent.click(dayCell("2099-06-16"));

    expect(screen.getByText(dockPl.dock.calendar.dayEmpty)).toBeInTheDocument();
    expect(screen.queryByText(FORUM.title_pl)).toBeNull();
  });

  it("zadanie z terminem jest wpisem BEZ odnośnika, a zrobione i bezterminowe nie wchodzą", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM] }));
    db.setResponse(
      "user_todos",
      ok([
        todo("t-open", { title: "Dopiąć budżet zespołu", due_at: "2099-06-20T12:00:00.000Z" }),
        todo("t-done", {
          title: "Rozliczyć delegację",
          due_at: "2099-06-21T12:00:00.000Z",
          done: true,
          done_at: "2099-06-21T13:00:00.000Z",
        }),
        todo("t-undated", { title: "Przejrzeć zaległe wątki" }),
      ]),
    );
    renderPanel();
    await settle();

    expect(hasDot("2099-06-20")).toBe(true);
    expect(hasDot("2099-06-21")).toBe(false);
    // Dwie kropki w całym miesiącu: wydarzenie i JEDNO zadanie. Zadanie bez
    // terminu nie ma gdzie usiąść, a zrobione nie wraca zza terminu.
    expect(dotCount()).toBe(2);

    fireEvent.click(dayCell("2099-06-20"));
    const row = screen.getByText("Dopiąć budżet zespołu");
    expect(row.tagName).toBe("SPAN");
    expect(row.closest("a")).toBeNull();
    expect(screen.queryByText("Przejrzeć zaległe wątki")).toBeNull();
  });
});

describe("CalendarPanel - przewijanie miesięcy", () => {
  it("następny miesiąc przestawia etykietę i pyta o okno NOWEGO miesiąca", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM], "2099-07": [WARSZTAT] }));
    renderPanel();
    await settle();

    fireEvent.click(screen.getByLabelText(dockPl.dock.calendar.next));
    await waitFor(() => expect(hasDot("2099-07-03")).toBe(true));

    expect(monthLabel()).toBe(intlMonth("2099-07-01", "pl"));
    expect(db.lastChain("events")?.argsOf("gte")).toEqual([
      "starts_at",
      "2099-07-01T00:00:00.000Z",
    ]);
    expect(db.lastChain("events")?.argsOf("lt")).toEqual(["starts_at", "2099-08-01T00:00:00.000Z"]);
    // Wybór dnia PRZEŻYWA zmianę miesiąca, choć komórka 15 czerwca znika
    // z siatki - żadna komórka nie jest wtedy wciśnięta. Stan bieżący,
    // przypięty świadomie: to jedyne miejsce, gdzie widać, że wybór żyje
    // dłużej niż kursor miesiąca.
    expect(screen.queryByLabelText(TODAY)).toBeNull();
    expect(document.querySelectorAll("button[aria-pressed='true']")).toHaveLength(0);
  });

  it("podczas dociągania nowego miesiąca siatka NIE GAŚNIE, tylko przygasa", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM, KOLACJA], "2099-07": [WARSZTAT] }));
    renderPanel();
    await settle();
    expect(hasDot("2099-06-29")).toBe(true);

    fireEvent.click(screen.getByLabelText(dockPl.dock.calendar.next));

    // Klik jest synchroniczny, odpowiedź lipca jeszcze nie przyszła: 29
    // czerwca należy do siatki lipca (wiersz wiodący) i NADAL ma kropkę -
    // to jest cały sens `placeholderData`. Wcześniej siatka gubiła tu
    // wszystkie kropki naraz.
    expect(hasDot("2099-06-29")).toBe(true);
    expect(hasDot("2099-07-03")).toBe(false);
    expect(dayGrid().parentElement).toHaveAttribute("aria-busy", "true");
    expect(dayGrid().className).toContain("opacity-60");

    await waitFor(() => expect(hasDot("2099-07-03")).toBe(true));
    expect(hasDot("2099-06-29")).toBe(false);
    expect(dayGrid().parentElement).not.toHaveAttribute("aria-busy");
    expect(dayGrid().className).not.toContain("opacity-60");
  });

  it("dwa kroki wstecz cofają o dwa miesiące i pytają o kwietniowe okno", async () => {
    db.setResponse("events", eventsByMonth({ "2099-04": [NARADA] }));
    renderPanel();
    await settle();

    const prev = screen.getByLabelText(dockPl.dock.calendar.prev);
    fireEvent.click(prev);
    await waitFor(() => expect(monthLabel()).toBe(intlMonth("2099-05-01", "pl")));
    fireEvent.click(prev);
    await waitFor(() => expect(monthLabel()).toBe(intlMonth("2099-04-01", "pl")));

    expect(db.lastChain("events")?.argsOf("gte")).toEqual([
      "starts_at",
      "2099-04-01T00:00:00.000Z",
    ]);
    await waitFor(() => expect(hasDot("2099-04-07")).toBe(true));
    fireEvent.click(dayCell("2099-04-07"));
    expect(screen.getByText(NARADA.title_pl)).toBeInTheDocument();
  });
});

describe("CalendarPanel - język, błąd i zamknięcie", () => {
  it("prop `lang` przełącza TREŚĆ i etykietę miesiąca, ale nie chrome panelu", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM] }));
    renderPanel("en");
    await settle();

    expect(monthLabel()).toBe(intlMonth("2099-06-01", "en"));
    expect(screen.getByText(FORUM.title_en)).toBeInTheDocument();
    expect(screen.queryByText(FORUM.title_pl)).toBeNull();

    // Chrome idzie przez i18n (w teście: polski), a nie przez prop. To jest
    // kontrakt panelu, nie przeoczenie: `lang` niesie język TREŚCI - wybór
    // jednej z dwóch kolumn tytułu, który świadomie wypadł z klucza cache.
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", dockPl.dock.calendar.title);
    expect(screen.getByLabelText(dockPl.dock.calendar.prev)).toBeInTheDocument();
    expect(screen.queryByLabelText(dockEn.dock.calendar.prev)).toBeNull();
  });

  it("błąd miesiąca pokazuje komunikat i NIE odbiera nawigacji", async () => {
    db.setResponse("events", fail("permission denied"));
    renderPanel();

    expect(await screen.findByText(dockPl.dock.error)).toBeInTheDocument();
    expect(screen.queryByText(dockPl.dock.calendar.dayEmpty)).toBeNull();

    // Strzałki zostają klikalne: poprzedni miesiąc jest nadal poprawną
    // treścią, a błąd jednego okna nie może zamknąć drogi do drugiego.
    fireEvent.click(screen.getByLabelText(dockPl.dock.calendar.next));
    await waitFor(() => expect(monthLabel()).toBe(intlMonth("2099-07-01", "pl")));
    expect(await screen.findByText(dockPl.dock.error)).toBeInTheDocument();
  });

  it("zamknięcie panelu woła `onClose` dokładnie raz", async () => {
    const { onClose } = renderPanel();
    await settle();

    fireEvent.click(screen.getByLabelText(dockPl.dock.close));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("nie ma naruszeń dostępności po wczytaniu miesiąca", async () => {
    db.setResponse("events", eventsByMonth({ "2099-06": [FORUM] }));
    const { container } = renderPanel();
    await settle();

    expect(summarize(await axeViolations(container))).toBe("");
  });

  // DEFEKT PRODUKCYJNY, nie usterka testu.
  //
  // `useDockCalendar` bierze `isPending`/`isError` WYŁĄCZNIE z zapytania
  // wydarzeń (useDockCalendar.ts:134-136), a zadania z terminem dokłada
  // z drugiego, niezależnego zapytania. Gdy `user_todos` odpadnie (RLS,
  // sieć), panel nie ma o tym pojęcia: rysuje pewny siebie pusty dzień,
  // choć połowa jego źródeł właśnie się nie wczytała. To jest dokładnie
  // ta klasa nieprawdy, którą nagłówki obu plików nazywają po imieniu
  // („lista dnia twierdziła »brak wydarzeń tego dnia«, zanim cokolwiek
  // wiedziała”) - tyle że zdjęta tylko po stronie wydarzeń.
  //
  // Naprawa jest jednolinijkowa i należy do PRODUKCJI, nie do testu:
  // `isError: eventsQ.isError || todosQ.isError` (albo osobny znacznik
  // częściowej awarii, jeśli wydarzenia mają nadal być pokazywane).
  it.fails(
    "DEFEKT: awaria zadań jest przemilczana - panel rysuje pewny siebie pusty dzień",
    async () => {
      db.setResponse("events", ok([]));
      db.setResponse("user_todos", fail("permission denied"));
      renderPanel();
      await settle();

      expect(screen.queryByText(dockPl.dock.error)).not.toBeNull();
    },
  );
});
