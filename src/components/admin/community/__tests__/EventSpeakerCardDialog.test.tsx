// Dialog „Karta" przy wpisie na liscie prelegentow - kontrakt zasiewu,
// podgladu i ZAPISU.
//
// CO TEN PLIK DOWODZI.
//
//   1. ZASIEW Z WPISU przy otwarciu i przy zmianie OSOBY - ale NIE przy
//      odswiezeniu listy w tle, ktore nadpisaloby to, co redaktor wpisuje.
//   2. PODGLAD TO PRAWDZIWA KARTA (`SpeakerProfileCard`) karmiona szkicem:
//      napis redakcji widac na przycisku, zanim cokolwiek pojdzie do bazy,
//      a klik w zdjecie rozwija karte tak, jak zrobi to uczestnik.
//   3. SCIEZKI SA TYLKO DO ODCZYTU - chipy albo zdanie „brak sesji", nigdy pole.
//   4. ZAPIS WYSYLA WSZYSTKIE PIEC POL, takze PUSTE: pusty napis znaczy
//      „wyczysc", wiec skasowany adres przycisku musi dojechac do bazy.
//   5. PO ZAPISIE: oba klucze cache (lista panelu i podglad studia), toast
//      i zamkniecie; BLAD BAZY na ekranie w `role="alert"`, dialog otwarty.
//
// `EventImageDropzone` jest atrapowany (prawdziwy wchodzi do Storage i ma
// wlasny test); `saveEventSpeakerCard` tez - test nie wychodzi do sieci.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EventSpeakerEntry } from "@/lib/admin/community";
import type { SpeakerTrack } from "@/lib/events/speakerCard";

const saveEventSpeakerCard = vi.fn();

vi.mock("@/lib/admin/community", () => ({
  saveEventSpeakerCard: (...args: unknown[]) => saveEventSpeakerCard(...args),
}));

vi.mock("@/components/admin/events/atoms/EventImageDropzone", () => ({
  EventImageDropzone: ({
    label,
    value,
    onValueChange,
  }: {
    label: string;
    value: string;
    onValueChange: (value: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)} />,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import i18n from "@/lib/i18n";
import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

const { EventSpeakerCardDialog } =
  await import("@/components/admin/community/EventSpeakerCardDialog");

ensureCommunityEventsI18n();

const TRACKS: SpeakerTrack[] = [
  {
    id: "tr-1",
    key: "econ",
    namePl: "Ekonomia",
    nameEn: "Economy",
    accentColor: "#0a7d3b",
    sessionsCount: 2,
  },
  {
    id: "tr-2",
    key: "energy",
    namePl: "Energetyka",
    nameEn: "Energy",
    accentColor: null,
    sessionsCount: 1,
  },
];

/** Wpis osoby BEZ konta - przypadek typowy (21 z 21 w danych referencyjnych). */
function entry(overrides: Partial<EventSpeakerEntry> = {}): EventSpeakerEntry {
  return {
    entry_id: "en-1",
    speaker_profile_id: "sp-1",
    user_id: null,
    person_id: "pe-1",
    display_name: "Halszka Borowik",
    avatar_url: "https://cdn.example.com/halszka.jpg",
    job_title: "Profesor",
    company: "Wyższa Szkoła Spraw Zmyślonych",
    email: "halszka.borowik@example.com",
    is_public: true,
    sort_order: 0,
    is_legacy: false,
    headline_pl: null,
    headline_en: null,
    card_photo_url: null,
    card_cta_label_pl: null,
    card_cta_label_en: null,
    card_cta_url: null,
    card_cta_color: null,
    tracks: [],
    ...overrides,
  };
}

const onOpenChange = vi.fn<(open: boolean) => void>();

function tree(client: QueryClient, speaker: EventSpeakerEntry | null, open = true) {
  return (
    <QueryClientProvider client={client}>
      <EventSpeakerCardDialog
        eventId="ev-1"
        speaker={speaker}
        open={open}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>
  );
}

function renderDialog(speaker: EventSpeakerEntry | null = entry(), open = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const utils = render(tree(client, speaker, open));
  return {
    ...utils,
    client,
    invalidate,
    rerenderWith: (next: EventSpeakerEntry | null, nextOpen = true) =>
      utils.rerender(tree(client, next, nextOpen)),
  };
}

function input(label: string): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`test: "${label}" to nie input`);
  return element;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Zapisz kartę" });
}

function cancelButton(): HTMLElement {
  return screen.getByRole("button", { name: "Anuluj" });
}

/** Sekcja sciezek - po naglowku, bo chipy stoja tez na karcie podgladu. */
function tracksSection(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Ścieżki (automatycznie)" });
  const section = heading.closest("section");
  if (section === null) throw new Error("test: brak sekcji sciezek");
  return section;
}

/** Karta podgladu - prawdziwa `SpeakerProfileCard` (element `article`). */
function previewCard(): HTMLElement {
  const card = screen.getByRole("dialog").querySelector("article");
  if (!(card instanceof HTMLElement)) throw new Error("test: brak karty podgladu");
  return card;
}

describe("EventSpeakerCardDialog - zasiew i widocznosc", () => {
  beforeEach(() => {
    saveEventSpeakerCard.mockReset().mockResolvedValue(undefined);
    onOpenChange.mockReset();
    toasts.success.mockReset();
    toasts.error.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("bez osoby nie rysuje NIC - ani dialogu, ani pol", () => {
    const { container } = renderDialog(null);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Adres przycisku")).toBeNull();
  });

  it("otwarcie zasiewa szkic polami karty z wpisu", () => {
    renderDialog(
      entry({
        card_photo_url: "https://cdn.example.com/karta.jpg",
        card_cta_label_pl: "Zapisz się",
        card_cta_label_en: "Sign up",
        card_cta_url: "https://example.com/zapisy",
        card_cta_color: "#0a7d3b",
      }),
    );

    expect(
      screen.getByRole("dialog", { name: "Karta prelegenta: Halszka Borowik" }),
    ).toBeInTheDocument();
    expect(input("Zdjęcie rozwiniętej karty").value).toBe("https://cdn.example.com/karta.jpg");
    expect(input("Napis na przycisku PL").value).toBe("Zapisz się");
    expect(input("Napis na przycisku EN").value).toBe("Sign up");
    expect(input("Adres przycisku").value).toBe("https://example.com/zapisy");
    expect(input("Kolor przycisku").value).toBe("#0a7d3b");
    expect(saveButton()).toBeEnabled();
  });

  it("wpis bez pol karty (wiersz sprzed kolumn) zasiewa puste pola", () => {
    const bare = entry();
    delete bare.card_photo_url;
    delete bare.card_cta_label_pl;
    delete bare.card_cta_url;
    renderDialog(bare);
    expect(input("Zdjęcie rozwiniętej karty").value).toBe("");
    expect(input("Napis na przycisku PL").value).toBe("");
    expect(input("Adres przycisku").value).toBe("");
  });

  it("zamkniety dialog nie rysuje sie, a otwarcie zasiewa szkic dopiero wtedy", () => {
    const speaker = entry({ card_cta_label_pl: "Program" });
    const { rerenderWith } = renderDialog(speaker, false);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerenderWith(speaker, true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(input("Napis na przycisku PL").value).toBe("Program");
  });

  it("odswiezenie listy w tle NIE nadpisuje tego, co redaktor wpisuje", () => {
    const { rerenderWith } = renderDialog(entry({ card_cta_label_pl: "Stary" }));
    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Wpisywany" } });

    // Ten sam `speaker_profile_id`, nowy obiekt z innymi polami - tak wyglada
    // refetch listy po 15 s `staleTime`.
    rerenderWith(entry({ card_cta_label_pl: "Z bazy", card_cta_url: "/experts/x" }));

    expect(input("Napis na przycisku PL").value).toBe("Wpisywany");
    expect(input("Adres przycisku").value).toBe("");
  });

  it("zmiana OSOBY zasiewa szkic od nowa", () => {
    const { rerenderWith } = renderDialog(entry({ card_cta_label_pl: "Pierwsza" }));
    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Niezapisane" } });

    rerenderWith(
      entry({
        speaker_profile_id: "sp-2",
        display_name: "Bogumił Trawka",
        card_cta_label_pl: "Druga",
      }),
    );

    expect(
      screen.getByRole("dialog", { name: "Karta prelegenta: Bogumił Trawka" }),
    ).toBeInTheDocument();
    expect(input("Napis na przycisku PL").value).toBe("Druga");
  });

  it("wpis bez nazwy i bez sciezek (pola nieobecne) nie wywraca dialogu", () => {
    const bare = entry({ display_name: null });
    delete bare.tracks;
    delete bare.headline_pl;
    delete bare.headline_en;
    renderDialog(bare);
    // Bez nazwiska tytul bierze identyfikator wpisu - jak etykieta wiersza na
    // liscie - zamiast konczyc sie samym dwukropkiem.
    expect(screen.getByRole("dialog", { name: "Karta prelegenta: sp-1" })).toBeInTheDocument();
    expect(
      within(tracksSection()).getByText(
        "Prelegent nie występuje jeszcze w żadnej sesji ze ścieżką.",
      ),
    ).toBeInTheDocument();
  });
});

describe("EventSpeakerCardDialog - sciezki i podglad", () => {
  beforeEach(() => {
    saveEventSpeakerCard.mockReset().mockResolvedValue(undefined);
    onOpenChange.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sciezki z obsady sesji sa chipami TYLKO do odczytu", () => {
    renderDialog(entry({ tracks: TRACKS }));
    const section = tracksSection();
    expect(within(section).getByText("Ekonomia")).toBeInTheDocument();
    expect(within(section).getByText("Energetyka")).toBeInTheDocument();
    // Zadnego pola wyboru: sciezki wynikaja z sesji, nie z tego dialogu.
    expect(within(section).queryByRole("textbox")).toBeNull();
    expect(within(section).queryByRole("checkbox")).toBeNull();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(
      within(section).getByText(/Ścieżki wynikają z sesji, w których prelegent występuje/),
    ).toBeInTheDocument();
    expect(within(section).queryByText(/nie występuje jeszcze/)).toBeNull();
  });

  it("bez sciezek sekcja mowi to wprost zamiast pustego miejsca", () => {
    renderDialog(entry({ tracks: [] }));
    expect(
      within(tracksSection()).getByText(
        "Prelegent nie występuje jeszcze w żadnej sesji ze ścieżką.",
      ),
    ).toBeInTheDocument();
  });

  it("podglad to prawdziwa karta: nazwisko, rola, instytucja i sciezki wpisu", () => {
    renderDialog(entry({ tracks: TRACKS, headline_pl: "Analityczka rynków zmyślonych" }));
    const card = previewCard();
    expect(within(card).getByText("Halszka Borowik")).toBeInTheDocument();
    // Rola sceniczna wygrywa ze stanowiskiem - jak na stronie prelegentow.
    expect(within(card).getByText("Analityczka rynków zmyślonych")).toBeInTheDocument();
    expect(within(card).getByText("Wyższa Szkoła Spraw Zmyślonych")).toBeInTheDocument();
    expect(within(card).getByText("Ekonomia")).toBeInTheDocument();
    expect(card).toHaveAttribute("data-state", "collapsed");
  });

  it("napis i adres redakcji widac na przycisku podgladu, zanim cokolwiek pojdzie do bazy", () => {
    renderDialog();
    expect(within(previewCard()).queryByRole("link")).toBeNull();

    fireEvent.change(input("Adres przycisku"), {
      target: { value: "https://example.com/zapisy" },
    });
    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Zapisz się" } });

    const link = within(previewCard()).getByRole("link", { name: /Zapisz się: Halszka Borowik/ });
    expect(link).toHaveAttribute("href", "https://example.com/zapisy");
    expect(link).toHaveTextContent("Zapisz się");
    // Link poza serwis otwiera sie w nowej karcie - i mowi to czytnikowi.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("aria-label") ?? "").toContain("otwiera się w nowej karcie");
    expect(saveEventSpeakerCard).not.toHaveBeenCalled();
  });

  it("pusty napis w szkicu = napis domyslny karty („Więcej”)", () => {
    renderDialog(entry({ card_cta_url: "https://example.com/x", card_cta_label_pl: "   " }));
    expect(within(previewCard()).getByRole("link")).toHaveTextContent("Więcej");
  });

  it("klik w zdjecie podgladu rozwija karte i zwija ja drugim kliknieciem", () => {
    renderDialog(entry({ card_photo_url: "https://cdn.example.com/karta.jpg" }));
    const photo = within(previewCard()).getByRole("button", {
      name: "Powiększ zdjęcie: Halszka Borowik",
    });
    expect(photo).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(photo);
    expect(previewCard()).toHaveAttribute("data-state", "expanded");
    const expanded = within(previewCard()).getByRole("button", {
      name: "Zmniejsz zdjęcie: Halszka Borowik",
    });
    expect(expanded).toHaveAttribute("aria-expanded", "true");
    // Rozwinieta karta laduje zdjecie KARTY od redakcji, nie zdjecie osoby.
    const sources = Array.from(previewCard().querySelectorAll("img")).map((img) => img.src);
    expect(sources.some((src) => src.includes("karta.jpg"))).toBe(true);

    fireEvent.click(expanded);
    expect(previewCard()).toHaveAttribute("data-state", "collapsed");
  });

  it("osoba BEZ konta i bez adresu: podglad nie ma przycisku akcji", () => {
    // Osoba bez konta nie ma dialogu profilu na stronie, wiec przycisk
    // „Profil" bylby martwy - karta go nie rysuje.
    renderDialog(entry({ avatar_url: null }));
    const card = previewCard();
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("osoba Z KONTEM bez adresu: podglad pokazuje przycisk profilu (i nic nie psuje)", () => {
    renderDialog(entry({ user_id: "u-1", person_id: null, display_name: "Anna Konto" }));
    const profile = within(previewCard()).getByRole("button", { name: "Profil: Anna Konto" });
    // Podglad nie nawiguje nigdzie - klik nie zamyka dialogu i nie zapisuje.
    fireEvent.click(profile);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(saveEventSpeakerCard).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("nie wypuszcza surowych kluczy i18n (pola, sciezki i podglad)", () => {
    renderDialog(entry({ tracks: TRACKS, card_cta_url: "https://example.com/x" }));
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("adminCommunityEvents.");
    expect(text).not.toContain("eventFront.");
  });
});

describe("EventSpeakerCardDialog - zapis", () => {
  beforeEach(() => {
    saveEventSpeakerCard.mockReset().mockResolvedValue(undefined);
    onOpenChange.mockReset();
    toasts.success.mockReset();
    toasts.error.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("blad w szkicu blokuje zapis, a poprawka go odblokowuje", () => {
    renderDialog();
    expect(saveButton()).toBeEnabled();

    fireEvent.change(input("Adres przycisku"), { target: { value: "javascript:alert(1)" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("https://");

    fireEvent.click(saveButton());
    expect(saveEventSpeakerCard).not.toHaveBeenCalled();

    fireEvent.change(input("Adres przycisku"), { target: { value: "/experts/halszka" } });
    expect(saveButton()).toBeEnabled();
  });

  it.each([
    ["Zdjęcie rozwiniętej karty", "http://cdn.example.com/x.jpg"],
    ["Napis na przycisku EN", "y".repeat(41)],
    ["Kolor przycisku", "#abc"],
  ])("blad w polu „%s” tez blokuje zapis", (label, value) => {
    renderDialog();
    fireEvent.change(input(label), { target: { value } });
    expect(saveButton()).toBeDisabled();
  });

  it("zapis wysyla WSZYSTKIE piec pol - puste jako pusty napis, nie brak klucza", async () => {
    renderDialog();
    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Zapisz się" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveEventSpeakerCard).toHaveBeenCalledTimes(1));
    expect(saveEventSpeakerCard).toHaveBeenCalledWith({
      speakerProfileId: "sp-1",
      cardPhotoUrl: "",
      cardCtaLabelPl: "Zapisz się",
      cardCtaLabelEn: "",
      cardCtaUrl: "",
      cardCtaColor: "",
    });
  });

  it("skasowany adres i kolor jada do bazy jako pusty napis - czyli „wyczysc”", async () => {
    renderDialog(
      entry({
        card_photo_url: "https://cdn.example.com/karta.jpg",
        card_cta_label_pl: "Zapisz się",
        card_cta_label_en: "Sign up",
        card_cta_url: "https://example.com/zapisy",
        card_cta_color: "#0a7d3b",
      }),
    );
    fireEvent.change(input("Adres przycisku"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Kolor marki" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveEventSpeakerCard).toHaveBeenCalledTimes(1));
    expect(saveEventSpeakerCard).toHaveBeenCalledWith({
      speakerProfileId: "sp-1",
      cardPhotoUrl: "https://cdn.example.com/karta.jpg",
      cardCtaLabelPl: "Zapisz się",
      cardCtaLabelEn: "Sign up",
      cardCtaUrl: "",
      cardCtaColor: "",
    });
  });

  it("po zapisie wietrzy liste panelu i podglad studia, potwierdza toastem i zamyka", async () => {
    const { invalidate } = renderDialog();
    fireEvent.click(saveButton());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-event-speakers", "ev-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "event", "ev-1", "speakers"] });
    expect(toasts.success).toHaveBeenCalledWith("Zapisano kartę prelegenta");
  });

  it("blad bazy trafia na ekran w role=alert, a dialog zostaje otwarty", async () => {
    saveEventSpeakerCard.mockRejectedValue(
      new Error(
        'new row for relation "speaker_profiles" violates check constraint "speaker_profiles_card_cta_url_shape"',
      ),
    );
    const { invalidate } = renderDialog();
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("speaker_profiles_card_cta_url_shape");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
    // Zapis mozna ponowic - blad bazy nie jest bledem szkicu.
    expect(saveButton()).toBeEnabled();
  });

  it("ponowne otwarcie czysci stary komunikat bledu bazy", async () => {
    saveEventSpeakerCard.mockRejectedValue(new Error("row level security"));
    const speaker = entry();
    const { rerenderWith } = renderDialog(speaker);
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("row level security");

    rerenderWith(speaker, false);
    rerenderWith(speaker, true);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("w trakcie zapisu oba przyciski sa zablokowane - drugi klik nie zapisuje drugi raz", async () => {
    let release: () => void = () => undefined;
    saveEventSpeakerCard.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    renderDialog();
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(cancelButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(saveEventSpeakerCard).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("„Anuluj” zamyka dialog bez zapisu", () => {
    renderDialog();
    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Niezapisane" } });
    fireEvent.click(cancelButton());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(saveEventSpeakerCard).not.toHaveBeenCalled();
  });

  it("Escape zamyka dialog bez zapisu", () => {
    renderDialog();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(saveEventSpeakerCard).not.toHaveBeenCalled();
  });
});

describe("EventSpeakerCardDialog - klawiatura i jezyk podgladu", () => {
  beforeEach(() => {
    saveEventSpeakerCard.mockReset().mockResolvedValue(undefined);
    onOpenChange.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Escape na ROZWINIETEJ karcie podgladu zwija karte, a NIE zamyka dialogu", () => {
    // Zamkniecie dialogu tym klawiszem przepadloby niezapisane pola karty.
    renderDialog(entry({ card_cta_label_pl: "Niezapisane" }));
    fireEvent.click(
      within(previewCard()).getByRole("button", { name: "Powiększ zdjęcie: Halszka Borowik" }),
    );
    const expanded = within(previewCard()).getByRole("button", {
      name: "Zmniejsz zdjęcie: Halszka Borowik",
    });
    expect(previewCard()).toHaveAttribute("data-state", "expanded");

    fireEvent.keyDown(expanded, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(previewCard()).toHaveAttribute("data-state", "collapsed");
    expect(input("Napis na przycisku PL").value).toBe("Niezapisane");
    // Fokus zostaje na zdjeciu - klawiatura nie gubi miejsca.
    expect(document.activeElement).toBe(
      within(previewCard()).getByRole("button", { name: "Powiększ zdjęcie: Halszka Borowik" }),
    );

    // Na ZWINIETEJ karcie Escape znow zamyka dialog.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Escape przy rozwinietym podgladzie, gdy fokus jest na samym dialogu (Safari), zwija karte", () => {
    // Safari i Firefox na macOS nie daja fokusu przyciskowi po kliknieciu - cel
    // klawisza to wtedy dialog, nie karta. Dialog i tak nie moze sie zamknac.
    renderDialog(entry({ card_cta_label_pl: "Niezapisane" }));
    fireEvent.click(
      within(previewCard()).getByRole("button", { name: "Powiększ zdjęcie: Halszka Borowik" }),
    );
    expect(previewCard()).toHaveAttribute("data-state", "expanded");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(previewCard()).toHaveAttribute("data-state", "collapsed");
    expect(input("Napis na przycisku PL").value).toBe("Niezapisane");
  });

  it("wewnetrzny link w podgladzie nie nawiguje - niezapisany szkic zostaje w panelu", () => {
    renderDialog(
      entry({ card_cta_url: "/eksperci/halszka", card_cta_label_pl: "Profil eksperta" }),
    );
    const marker = previewCard().closest('[data-builder-renderer="widget-props-preview"]');
    expect(marker).not.toBeNull();
    const link = within(previewCard()).getByRole("link", { name: /Profil eksperta/ });
    expect(link).toHaveAttribute("href", "/eksperci/halszka");
    // `false` = klikniecie mialo `preventDefault` - `AppLink` nie ruszyl routera.
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("zewnetrzny link w podgladzie tez nie nawiguje - bez otwierania obcej strony", () => {
    renderDialog(
      entry({ card_cta_url: "https://example.com/zapisy", card_cta_label_pl: "Zapisy" }),
    );
    const link = within(previewCard()).getByRole("link", { name: /Zapisy/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(fireEvent.click(link)).toBe(false);
  });

  it("trwajacy zapis trzyma dialog: Escape go nie zamyka, a odmowa bazy trafia na ekran", async () => {
    let reject: (reason: Error) => void = () => undefined;
    saveEventSpeakerCard.mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    renderDialog(entry());
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveEventSpeakerCard).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    reject(new Error("event_speakers: speaker profile not found in tenant"));
    expect(await screen.findByRole("alert")).toHaveTextContent("speaker profile not found");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("podglad mowi jezykiem interfejsu: po angielsku napis EN i nazwy sciezek EN", async () => {
    await i18n.changeLanguage("en");
    try {
      renderDialog(
        entry({
          tracks: [TRACKS[0], { ...TRACKS[1], nameEn: null }],
          card_cta_label_pl: "Zapisz się",
          card_cta_label_en: "Sign up",
          card_cta_url: "https://example.com/signup",
        }),
      );
      const card = previewCard();
      expect(
        within(card).getByRole("link", { name: /Sign up: Halszka Borowik/ }),
      ).toHaveTextContent("Sign up");
      expect(within(card).queryByText("Zapisz się")).toBeNull();
      expect(within(card).getByText("Economy")).toBeInTheDocument();
      // Sciezka bez nazwy EN nie znika - pokazuje nazwe PL.
      expect(within(card).getByText("Energetyka")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save the card" })).toBeEnabled();
      expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
    } finally {
      // Odmontowanie PRZED powrotem do polskiego - zmiana jezyka przerenderowuje
      // wszystko, co jest zamontowane.
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });

  it("przelacznik PL/EN przestawia TYLKO podglad - pola i sekcja sciezek zostaja w jezyku panelu", () => {
    renderDialog(
      entry({
        tracks: [TRACKS[0]],
        card_cta_label_pl: "Zapisz się",
        card_cta_label_en: "Sign up",
        card_cta_url: "https://example.com/signup",
      }),
    );
    const group = screen.getByRole("group", { name: "Język podglądu" });
    const pl = within(group).getByRole("button", { name: "PL" });
    const en = within(group).getByRole("button", { name: "EN" });
    // Start w jezyku panelu.
    expect(pl).toHaveAttribute("aria-pressed", "true");
    expect(en).toHaveAttribute("aria-pressed", "false");
    expect(within(previewCard()).getByRole("link", { name: /Zapisz się/ })).toBeInTheDocument();
    expect(within(previewCard()).getByText("Ekonomia")).toBeInTheDocument();

    fireEvent.click(en);

    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(pl).toHaveAttribute("aria-pressed", "false");
    const card = previewCard();
    expect(within(card).getByRole("link", { name: /Sign up: Halszka Borowik/ })).toHaveTextContent(
      "Sign up",
    );
    expect(within(card).queryByText("Zapisz się")).toBeNull();
    expect(within(card).getByText("Economy")).toBeInTheDocument();
    // Napisy samej karty tez po angielsku - nie tylko tresc redakcji.
    expect(
      within(card).getByRole("button", { name: "Enlarge photo: Halszka Borowik" }),
    ).toBeInTheDocument();
    // Sekcja sciezek w formularzu i pola mowia dalej jezykiem panelu.
    expect(within(tracksSection()).getByText("Ekonomia")).toBeInTheDocument();
    expect(within(tracksSection()).queryByText("Economy")).toBeNull();
    expect(input("Napis na przycisku PL").value).toBe("Zapisz się");
    expect(saveButton()).toBeEnabled();
  });

  it("podglad EN bez napisu EN pokazuje napis PL (jak uczestnik), a bez obu - „More”", () => {
    renderDialog(
      entry({
        card_cta_label_pl: "Zapisz się",
        card_cta_label_en: null,
        card_cta_url: "https://example.com/signup",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Język podglądu" })).getByRole("button", {
        name: "EN",
      }),
    );
    const link = (): HTMLElement =>
      within(previewCard()).getByRole("link", { name: /Halszka Borowik/ });
    // Redaktor widzi przed zapisem, ze brak tlumaczenia = polski napis na EN.
    expect(link()).toHaveTextContent("Zapisz się");

    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "" } });
    expect(link()).toHaveTextContent("More");
    expect(link()).not.toHaveTextContent("Więcej");
  });

  it("ponowne otwarcie wraca do jezyka panelu, nawet gdy ostatnio ogladano EN", () => {
    const { rerenderWith } = renderDialog(entry({ tracks: [TRACKS[0]] }));
    const group = (): HTMLElement => screen.getByRole("group", { name: "Język podglądu" });
    fireEvent.click(within(group()).getByRole("button", { name: "EN" }));
    expect(within(previewCard()).getByText("Economy")).toBeInTheDocument();

    rerenderWith(entry({ tracks: [TRACKS[0]] }), false);
    rerenderWith(entry({ tracks: [TRACKS[0]] }), true);

    expect(within(group()).getByRole("button", { name: "PL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(previewCard()).getByText("Ekonomia")).toBeInTheDocument();
  });
});
