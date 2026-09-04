// ZAPAMIĘTANE WYDARZENIA - druga połowa gwiazdki.
//
// Przełącznik na stronie wydarzenia bez miejsca, w którym widać wynik, jest
// przyciskiem donikąd. Ten ekran jest tym miejscem i do dziś nie miał ani
// jednej wykonanej linii - a rozstrzyga sześć rzeczy, których złamania
// uczestnik nie zgłosi, tylko przestanie zapamiętywać:
//
// 1. LISTA JEST PRYWATNA I MÓWI O TYM WPROST. `event_bookmarks_mine` czyta
//    wyłącznie własne wiersze (`auth.uid()`), więc zdanie o prywatności musi
//    paść na ekranie - „zapamiętane” bywa mylone z „polubione publicznie”.
// 2. GOŚĆ NIE STRZELA W BAZĘ. RPC wymaga sesji, więc zapytanie bez niej
//    wróciłoby odmową uprawnień - czyli awarią w oczach czytelnika.
// 3. PUSTA LISTA JEST NORMALNYM STANEM, NIE BŁĘDEM, i każdy z trzech zakresów
//    ma własne zdanie: jedno „brak wyników” nie mówiłoby, czy zły jest filtr,
//    czy naprawdę nic nie ma.
// 4. ZMIANA ZAKRESU WRACA NA PIERWSZĄ STRONĘ. Bez tego przejście z drugiej
//    strony „wszystkie” do „nadchodzące” pokazuje pustkę mimo zapamiętań.
// 5. WIERSZ PROWADZI DO WYDARZENIA. Zapamiętanie ma sens tylko wtedy, gdy da
//    się z niego wrócić na stronę wydarzenia.
// 6. DATA ZAPAMIĘTANIA TO NIE DATA WYDARZENIA - dwie kolumny, dwa zdania,
//    a ich zamiana jest niewidoczna w przeglądzie kodu.
//
// ATRAPA STOI NA GRANICY: podmieniony jest klient Supabase, tożsamość widza
// i trasa docelowa. Warstwa danych (`fetchMyBookmarks`), hook `useMyBookmarks`
// i sam komponent jadą kodem produkcyjnym. Wzorzec atrap (Link, useAuth, i18n)
// przejęty z `eventAttendeesList.test.tsx` z tego samego katalogu, a atrapa RPC
// z `src/lib/events/__tests__/publicEventApi.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

/** Tozsamosc widza jest granica - test przestawia ja miedzy przypadkami. */
interface ViewerState {
  user: { id: string } | null;
}
const authState: ViewerState = { user: { id: "u-uczestnik" } };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

// Trasa wydarzenia jest cudzą powierzchnią - w teście listy wystarczy, że
// odnośnik powstaje ze slugiem tego wiersza.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={`${to}:${JSON.stringify(params ?? {})}`} {...rest}>
      {children}
    </a>
  ),
}));

const { SavedEventsList } = await import("@/components/events/public/organisms/SavedEventsList");

/** Wiersz `event_bookmarks_mine` w kształcie sieciowym (NULL-e są osiągalne). */
type Wire = Record<string, unknown>;

function bookmarkWire(over: Wire = {}): Wire {
  return {
    event_id: "ev-kongres",
    slug: "kongres-strategii",
    title_pl: "Kongres Strategii Europejskiej",
    title_en: "European Strategy Congress",
    type_name_pl: "Kongres",
    type_name_en: "Congress",
    starts_at: "2026-06-11T08:00:00Z",
    ends_at: "2026-06-11T16:00:00Z",
    timezone: "Europe/Warsaw",
    location: "Bruksela",
    cover_url: null,
    format: "onsite",
    kind: "conference",
    has_ended: false,
    cancelled_at: null,
    min_tier_rank: 0,
    seats_left: 120,
    bookmarked_at: "2025-11-02T09:30:00Z",
    total_count: 1,
    ...over,
  };
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SavedEventsList />
    </QueryClientProvider>,
  );
}

/** Ostatni akapit ekranu - tam ląduje zdanie o odmowie. */
function lastParagraph(container: HTMLElement): string {
  const paragraphs = [...container.querySelectorAll("p")];
  return paragraphs.length < 2 ? "" : (paragraphs.at(-1)?.textContent ?? "");
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  authState.user = { id: "u-uczestnik" };
});

describe("SavedEventsList - prywatna lista uczestnika", () => {
  it("mówi WPROST, że listy nie widzi nikt inny", async () => {
    h.rpc?.setData("event_bookmarks_mine", []);
    renderList();

    expect(screen.getByText("eventFront.bookmarks.title")).toBeInTheDocument();
    // Bez tego zdania „zapamiętane” czyta się jak publiczne polubienie.
    expect(screen.getByText("eventFront.bookmarks.subtitle")).toBeInTheDocument();
    await screen.findByText("eventFront.bookmarks.emptyUpcoming");
  });

  it("gość NIE pyta bazy - RPC wymaga sesji, więc odmowa wyglądałaby jak awaria", async () => {
    authState.user = null;
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    renderList();

    await screen.findByLabelText("eventFront.bookmarks.loading");
    expect(h.rpc?.callsFor("event_bookmarks_mine")).toHaveLength(0);
    expect(screen.queryByText("Kongres Strategii Europejskiej")).not.toBeInTheDocument();
  });

  it("pyta o zakres, stronę i rozmiar strony (zawężenie użytkownikiem siedzi w SQL)", async () => {
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    renderList();

    await screen.findByText("Kongres Strategii Europejskiej");
    // Wołający NIE jest argumentem: `event_bookmarks_mine` czyta `auth.uid()`,
    // a najemcę bierze z nagłówka hosta - pilnuje tego bramka
    // `check:sql-tenant-scope`. Front podaje wyłącznie zakres i okno.
    expect(h.rpc?.names()).toEqual(["event_bookmarks_mine"]);
    const call = h.rpc?.lastCall("event_bookmarks_mine");
    expect(call?.arg("p_scope")).toBe("upcoming");
    expect(call?.arg("p_limit")).toBe(24);
    expect(call?.arg("p_offset")).toBe(0);
  });

  it("pusta lista jest NORMALNYM stanem, a każdy zakres ma własne zdanie", async () => {
    h.rpc?.setData("event_bookmarks_mine", []);
    const { container } = renderList();

    expect(await screen.findByText("eventFront.bookmarks.emptyUpcoming")).toBeInTheDocument();
    // Nie „brak wyników” i nie karta błędu: pustka nadchodzących mówi coś
    // innego niż pustka minionych.
    expect(screen.queryByText("eventFront.bookmarks.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("eventFront.bookmarks.emptyPast")).not.toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(0);

    fireEvent.click(screen.getByRole("tab", { name: "eventFront.scope.past" }));
    expect(await screen.findByText("eventFront.bookmarks.emptyPast")).toBeInTheDocument();
    await waitFor(() =>
      expect(h.rpc?.lastCall("event_bookmarks_mine")?.arg("p_scope")).toBe("past"),
    );
    expect(screen.getByRole("tab", { name: "eventFront.scope.past" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "eventFront.scope.upcoming" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("wiersz prowadzi na stronę wydarzenia i niesie rodzaj oraz miejsce", async () => {
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    renderList();

    const link = await screen.findByRole("link");
    // Zapamiętanie bez drogi powrotnej jest bezużyteczne.
    expect(link).toHaveAttribute("href", '/events/$slug:{"slug":"kongres-strategii"}');
    expect(within(link).getByText("Kongres Strategii Europejskiej")).toBeInTheDocument();
    expect(within(link).getByText("Kongres")).toBeInTheDocument();
    expect(within(link).getByText("Bruksela")).toBeInTheDocument();
  });

  it("data zapamiętania to INNA data niż początek wydarzenia", async () => {
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    renderList();

    await screen.findByText("Kongres Strategii Europejskiej");
    const saved = screen.getByText(/^eventFront\.bookmarks\.savedAt:/);
    // Zamiana kolumn `bookmarked_at` i `starts_at` jest niewidoczna w kodzie,
    // a na ekranie mówi uczestnikowi nieprawdę o obu.
    expect(saved.textContent).toContain("2025");
    expect(saved.textContent).not.toContain("2026");
  });

  it("wydarzenie bez miejsca, rodzaju i strefy nie zostawia pustych ozdobników", async () => {
    h.rpc?.setData("event_bookmarks_mine", [
      bookmarkWire({
        title_pl: "Debata o rozszerzeniu",
        location: null,
        timezone: null,
        type_name_pl: null,
        type_name_en: null,
      }),
    ]);
    renderList();

    const link = await screen.findByRole("link");
    // Podpis strefy bez strefy byłby pustym nawiasem, plakietka rodzaju bez
    // rodzaju - pustą ramką, a ikona miejsca bez miejsca - ikoną donikąd.
    expect(link.textContent).not.toContain("(");
    expect(within(link).queryByText("Kongres")).not.toBeInTheDocument();
    expect(within(link).queryByText("Bruksela")).not.toBeInTheDocument();
    expect(within(link).getByText("Debata o rozszerzeniu")).toBeInTheDocument();
  });

  it("godzina jest PRZELICZONA na strefę wydarzenia i podpisana jej skrótem", async () => {
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    renderList();

    const link = await screen.findByRole("link");
    const row = link.textContent ?? "";
    // Wiersz niesie 08:00 UTC, a kongres zaczyna się o 10:00 w Warszawie.
    // Pokazanie surowej godziny UTC wysłałoby uczestnika dwie godziny za
    // wcześnie - i to jest cała stawka tej konwersji, nie sam nawias.
    expect(row).toContain("10:00");
    expect(row).not.toContain("08:00");
    // Podpis to SKRÓT strefy, a nie identyfikator IANA: „Europe/Warsaw" obok
    // godziny czyta się jak awaria formatowania, a nie jak informacja.
    expect(row).toMatch(/\((?:CEST|GMT\+2)\)/);
    expect(row).not.toContain("Europe/Warsaw");
  });

  it("wydarzenie zakończone i odwołane niosą swoje plakietki, zwykłe - żadnej", async () => {
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    const plain = renderList();
    await screen.findByText("Kongres Strategii Europejskiej");
    expect(
      within(plain.container).queryByText("eventFront.header.endedBanner"),
    ).not.toBeInTheDocument();
    expect(
      within(plain.container).queryByText("eventFront.header.cancelledBanner"),
    ).not.toBeInTheDocument();

    h.rpc?.setData("event_bookmarks_mine", [
      bookmarkWire({ has_ended: true, cancelled_at: "2026-05-01T10:00:00Z" }),
    ]);
    const flagged = renderList();
    // Odwołane wydarzenie w zapamiętanych MUSI być podpisane - inaczej
    // uczestnik pojedzie na kongres, którego nie ma.
    expect(
      await within(flagged.container).findByText("eventFront.header.cancelledBanner"),
    ).toBeInTheDocument();
    expect(
      within(flagged.container).getByText("eventFront.header.endedBanner"),
    ).toBeInTheDocument();
  });

  it("jedna strona wyników nie dostaje paginacji", async () => {
    h.rpc?.setData("event_bookmarks_mine", [bookmarkWire()]);
    renderList();

    await screen.findByText("Kongres Strategii Europejskiej");
    expect(screen.queryByText("eventFront.list.prevPage")).not.toBeInTheDocument();
    expect(screen.queryByText("eventFront.list.nextPage")).not.toBeInTheDocument();
  });

  it("licznik bierze się z CAŁOŚCI, a „dalej” przesuwa okno o pełną stronę", async () => {
    const page = Array.from({ length: 24 }, (_, i) =>
      bookmarkWire({
        event_id: `ev-${i}`,
        slug: `wydarzenie-${i}`,
        title_pl: `Wydarzenie ${i}`,
        total_count: 50,
      }),
    );
    h.rpc?.setData("event_bookmarks_mine", page);
    renderList();

    await screen.findByText("Wydarzenie 0");
    // Licznik z okna analitycznego, a nie z długości strony - inaczej
    // uczestnik z 50 zapamiętaniami widziałby „24”.
    expect(screen.getByText("1-24 / 50")).toBeInTheDocument();
    // Na pierwszej stronie „wstecz” nie ma dokąd prowadzić.
    expect(screen.getByText("eventFront.list.prevPage").closest("button")).toBeDisabled();

    fireEvent.click(screen.getByText("eventFront.list.nextPage"));
    await waitFor(() => expect(h.rpc?.lastCall("event_bookmarks_mine")?.arg("p_offset")).toBe(24));
    // Licznik idzie za oknem, a nie za numerem strony.
    expect(await screen.findByText("25-48 / 50")).toBeInTheDocument();
    expect(screen.getByText("eventFront.list.prevPage").closest("button")).not.toBeDisabled();

    fireEvent.click(screen.getByText("eventFront.list.prevPage"));
    // Powrót ma wrócić na pierwszą stronę, a nie zejść poniżej zera.
    expect(await screen.findByText("1-24 / 50")).toBeInTheDocument();
    await waitFor(() => expect(h.rpc?.lastCall("event_bookmarks_mine")?.arg("p_offset")).toBe(0));
  });

  it("zmiana zakresu WRACA na pierwszą stronę", async () => {
    const page = Array.from({ length: 24 }, (_, i) =>
      bookmarkWire({
        event_id: `ev-${i}`,
        slug: `wydarzenie-${i}`,
        title_pl: `Wydarzenie ${i}`,
        total_count: 50,
      }),
    );
    h.rpc?.setData("event_bookmarks_mine", page);
    renderList();

    await screen.findByText("Wydarzenie 0");
    fireEvent.click(screen.getByText("eventFront.list.nextPage"));
    await waitFor(() => expect(h.rpc?.lastCall("event_bookmarks_mine")?.arg("p_offset")).toBe(24));

    fireEvent.click(screen.getByRole("tab", { name: "eventFront.scope.all" }));
    // Bez zerowania offsetu „wszystkie” otwierałyby się od drugiej strony -
    // czyli pustką u kogoś, kto ma mniej niż 25 zapamiętań w tym zakresie.
    await waitFor(() => {
      const call = h.rpc?.lastCall("event_bookmarks_mine");
      expect(call?.arg("p_scope")).toBe("all");
      expect(call?.arg("p_offset")).toBe(0);
    });
  });

  it("odmowa bazy zamienia się w zdanie, a nie w pustą listę ani surowy kod", async () => {
    h.rpc?.setError("event_bookmarks_mine", "auth_required: sign in", "28000");
    const first = renderList();

    // Zdanie o odmowie stoi POD zakładkami, czyli jako ostatni akapit ekranu
    // (pierwszym jest podpis o prywatności listy).
    await waitFor(() => expect(lastParagraph(first.container)).not.toBe(""));
    const message = lastParagraph(first.container);
    // Ani surowa głowa komunikatu plpgsql, ani goły klucz słownika: jedno
    // straszy uczestnika, drugie wygląda jak niewdrożone tłumaczenie.
    expect(message).not.toContain("auth_required");
    expect(message).not.toContain("eventFront.errors.");
    expect(message.trim()).not.toBe("");
    // Awaria to nie pustka: „nic nie zapamiętałeś” po utracie sesji byłoby
    // zdaniem nieprawdziwym.
    expect(screen.queryByText("eventFront.bookmarks.emptyUpcoming")).not.toBeInTheDocument();

    h.rpc?.setError("event_bookmarks_mine", "invalid_scope: nope", "22023");
    const second = renderList();
    await waitFor(() => expect(lastParagraph(second.container)).not.toBe(""));
    expect(lastParagraph(second.container)).not.toBe(message);
  });
});
