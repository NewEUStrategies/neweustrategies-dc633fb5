// GWIAZDKA „zapamiętaj wydarzenie": jeden przycisk, ale trzy różne obietnice.
//
// CO SIĘ PSUJE BEZ TEGO PLIKU:
//
// 1. GOŚĆ DOSTAJE CISZĘ. `event_bookmark_toggle` wymaga sesji, więc klik bez
//    konta nie ma dokąd pójść. Kontrolka, która na klik nie robi NIC, czyta się
//    jak zepsuta strona - i wtedy bramka logowania nie zachęca do założenia
//    konta, tylko odstrasza. Zdanie „zaloguj się" jest tu całym sensem tego,
//    że przycisk w ogóle jest widoczny dla gościa.
//
// 2. GWIAZDKA ZOSTAJE ZAPALONA PO ODMOWIE. Przełączenie jest OPTYMISTYCZNE -
//    to jest cała jego wartość. Bez cofnięcia po błędzie uczestnik wychodzi
//    z przekonaniem, że wydarzenie ma zapisane, a na liście „zapisane" go nie
//    ma. Kłamstwo w interfejsie kosztuje tu udział w wydarzeniu.
//
// 3. DWIE KARTY POKAZUJĄ DWIE RÓŻNE GWIAZDKI. Prawda mieszka w nagłówku
//    (`event_page_header.is_bookmarked`) i przyjeżdża propsem po unieważnieniu
//    zapytania - stan lokalny musi się jej podporządkować, inaczej odświeżenie
//    nagłówka niczego nie naprawia.
//
// 4. DWA KLIKI, DWA ZAPISY. Zablokowany przycisk w trakcie zapisu jest jedyną
//    rzeczą, która trzyma jedno kliknięcie = jedna decyzja.
//
// 5. WYSYŁKA PRZEŁĄCZENIA ZAMIAST STANU. RPC przyjmuje `state`, więc dwie karty
//    tej samej strony klikające naraz muszą dojść do TEGO SAMEGO stanu, a nie
//    do dwóch przełączeń.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { BookmarkToggleResult } from "@/lib/events/publicEventApi";

interface BookmarkInput {
  eventSlug?: string;
  eventId?: string;
  state?: boolean;
}

const toggleBookmark = vi.fn<(input: BookmarkInput) => Promise<BookmarkToggleResult>>();
const successToast = vi.fn<(message: string) => void>();
const errorToast = vi.fn<(message: string) => void>();
const infoToast = vi.fn<(message: string) => void>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => successToast(message),
    error: (message: string) => errorToast(message),
    info: (message: string) => infoToast(message),
  },
}));

const authState = { user: null as { id: string } | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return { ...actual, toggleEventBookmark: (input: BookmarkInput) => toggleBookmark(input) };
});

const { EventBookmarkButton } =
  await import("@/components/events/public/molecules/EventBookmarkButton");
const i18n = (await import("@/lib/i18n")).default;

function renderButton(isBookmarked = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <EventBookmarkButton eventSlug="kongres" isBookmarked={isBookmarked} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    /** Ta sama instancja przycisku po zmianie prawdy z nagłówka. */
    rerenderWith: (next: boolean) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <EventBookmarkButton eventSlug="kongres" isBookmarked={next} />
        </QueryClientProvider>,
      ),
  };
}

function star(): HTMLElement {
  return screen.getByRole("button");
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: "u1" };
  toggleBookmark.mockResolvedValue({
    eventId: "e1",
    bookmarked: true,
    bookmarkedAt: "2026-09-01T08:00:00Z",
  });
});

describe("EventBookmarkButton - gość", () => {
  it("gość dostaje ZACHĘTĘ DO LOGOWANIA, a nie cichy brak reakcji", async () => {
    authState.user = null;
    renderButton();

    fireEvent.click(star());

    await waitFor(() => expect(infoToast).toHaveBeenCalledTimes(1));
    expect(infoToast).toHaveBeenCalledWith("eventFront.bookmarks.signInHint");
    // Baza nie dostaje żądania, którego i tak nie przyjmie od `anon`...
    expect(toggleBookmark).not.toHaveBeenCalled();
    // ...a gwiazdka NIE udaje, że coś zapamiętała.
    expect(star()).toHaveAttribute("aria-pressed", "false");
  });

  it("gość widzi przycisk CZYNNY, a nie pustkę i nie atrapę", () => {
    authState.user = null;
    renderButton();

    // Wyszarzona gwiazdka jest dla gościa tym samym, co jej brak: nie ma w co
    // kliknąć, więc nie ma jak trafić na zachętę do założenia konta - a to jest
    // tu jedyny powód, dla którego kontrolka w ogóle stoi na stronie.
    expect(star()).toBeEnabled();
    // Gość nie ma zakładek, więc gwiazdka nie może być zapalona: zapalona
    // obiecuje zapis, którego nikt nigdzie nie trzyma.
    expect(star()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("eventFront.bookmarks.add")).toBeInTheDocument();
    expect(screen.queryByText("eventFront.bookmarks.remove")).not.toBeInTheDocument();
  });
});

describe("EventBookmarkButton - zalogowany uczestnik", () => {
  it("gwiazdka zapala się OD RAZU, zanim baza odpowie", async () => {
    // Odpowiedź bazy trzymamy na bramce, żeby zobaczyć stan PRZED nią.
    const zwolnij: ((result: BookmarkToggleResult) => void)[] = [];
    toggleBookmark.mockReturnValue(
      new Promise<BookmarkToggleResult>((resolve) => {
        zwolnij.push(resolve);
      }),
    );
    renderButton();

    fireEvent.click(star());

    // Cała wartość tej kontrolki to „jeden klik i lecimy dalej" - czekanie na
    // sieć zamieniłoby ją w formularz.
    await waitFor(() => expect(star()).toHaveAttribute("aria-pressed", "true"));
    expect(star()).toBeDisabled();

    zwolnij[0]({ eventId: "e1", bookmarked: true, bookmarkedAt: null });
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith("eventFront.bookmarks.addedToast"),
    );
  });

  it("wysyła slug i STAN DOCELOWY, a nie prośbę o przełączenie", async () => {
    renderButton();

    fireEvent.click(star());
    await waitFor(() => expect(toggleBookmark).toHaveBeenCalledTimes(1));
    // Ładunek RPC `event_bookmark_toggle`: slug wskazuje WYDARZENIE, a `state`
    // stan docelowy - dwie karty tej samej strony klikające naraz dochodzą
    // wtedy do tego samego wyniku, a nie do dwóch przełączeń. Zawężenie
    // najemcem siedzi w SQL (pilnuje go bramka `check:sql-tenant-scope`).
    expect(toggleBookmark).toHaveBeenCalledWith({ eventSlug: "kongres", state: true });
  });

  it("odjęcie zakładki mówi o zdjęciu, a nie o dodaniu", async () => {
    toggleBookmark.mockResolvedValue({ eventId: "e1", bookmarked: false, bookmarkedAt: null });
    renderButton(true);

    expect(screen.getByText("eventFront.bookmarks.remove")).toBeInTheDocument();
    fireEvent.click(star());

    await waitFor(() =>
      expect(toggleBookmark).toHaveBeenCalledWith({
        eventSlug: "kongres",
        state: false,
      }),
    );
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith("eventFront.bookmarks.removedToast"),
    );
    expect(star()).toHaveAttribute("aria-pressed", "false");
  });

  it("odmowa bazy COFA gwiazdkę i mówi, czego zabrakło", async () => {
    toggleBookmark.mockRejectedValue(new Error("auth_required: sign in first"));
    renderButton();

    fireEvent.click(star());
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));

    expect(errorToast).toHaveBeenCalledWith(i18n.t("eventFront.errors.authRequired"));
    // Bez cofnięcia uczestnik zostaje z gwiazdką, której nikt nie zapisał.
    expect(star()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("eventFront.bookmarks.add")).toBeInTheDocument();
  });

  it("ostatnie słowo ma BAZA: odpowiedź „niezapisane” gasi gwiazdkę mimo kliknięcia w „dodaj”", async () => {
    // Tak wygląda wyścig dwóch kart tej samej strony: druga karta zdążyła
    // zdjąć zakładkę, więc nasze „dodaj" wraca jako „niezapisane".
    toggleBookmark.mockResolvedValue({ eventId: "e1", bookmarked: false, bookmarkedAt: null });
    renderButton();

    fireEvent.click(star());
    await waitFor(() => expect(star()).toHaveAttribute("aria-pressed", "false"));
    expect(successToast).toHaveBeenCalledWith("eventFront.bookmarks.removedToast");
  });

  it("prawda z nagłówka nadpisuje stan lokalny po unieważnieniu zapytania", async () => {
    const view = renderButton(false);
    expect(star()).toHaveAttribute("aria-pressed", "false");

    // Nagłówek przyjechał ponownie z `is_bookmarked = true` (np. po zapisaniu
    // z listy w drugiej karcie) - dwie powierzchnie nie mogą pokazywać dwóch
    // różnych gwiazdek.
    view.rerenderWith(true);
    expect(star()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("eventFront.bookmarks.remove")).toBeInTheDocument();
    expect(toggleBookmark).not.toHaveBeenCalled();
  });
});
