// Cztery edytory warstw odcinka: obsada, rozdziały, cytaty, źródła.
//
// CO DOWODZI TEN PLIK. Warstwy odcinka są tablicami edytowanymi PO INDEKSIE,
// a operacje na indeksie to najcichszy rodzaj defektu w panelu redakcyjnym:
//   * zła arytmetyka w `update` przepisuje CUDZY wiersz (redaktor poprawia
//     nazwisko gościa, a zmienia się prowadzący);
//   * `filter` po tożsamości obiektu zamiast po indeksie gubi jeden z dwóch
//     wierszy o identycznej treści (dwa źródła bez etykiety);
//   * pominięta normalizacja pola `kind`/`role` wysyła do bazy wartość poza
//     enumem i CAŁY zapis odcinka pada na CHECK.
// Do 02.09.2026 te cztery edytory mieszkały w pliku trasy o 2072 liniach
// i nie miały ani jednego wykonania.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: parserów warstw (`lib/podcast/types`), zapisu
// do bazy (`lib/podcast/queries`) ani składania zestawu warstw przy „Zapisz"
// (to robi `EpisodeEditorPane`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { PodcastChapter, PodcastQuote, PodcastResource } from "@/lib/podcast/types";
import type { PersonDraft, ProfileOption } from "@/lib/podcast/shape";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));

const { ChaptersEditor, PeopleEditor, QuotesEditor, ResourcesEditor, RowShell, SectionCard } =
  await import("@/components/admin/podcasts/EpisodeLayerEditors");

const PROFILES: ProfileOption[] = [
  { id: "p1", display_name: "Ewa Cis", slug: "ewa-cis" },
  { id: "p2", display_name: null, slug: "igor-nowak" },
];

/** Ostatni stan wystawiony przez harness - przedmiot dowodu zamiast DOM. */
interface Spy<T> {
  value: T[];
}

function PeopleHarness({ initial, spy }: { initial: PersonDraft[]; spy: Spy<PersonDraft> }) {
  const [people, setPeople] = useState<PersonDraft[]>(initial);
  spy.value = people;
  return <PeopleEditor people={people} setPeople={setPeople} profiles={PROFILES} />;
}

function ChaptersHarness({
  initial,
  spy,
}: {
  initial: PodcastChapter[];
  spy: Spy<PodcastChapter>;
}) {
  const [chapters, setChapters] = useState<PodcastChapter[]>(initial);
  spy.value = chapters;
  return <ChaptersEditor chapters={chapters} setChapters={setChapters} />;
}

function QuotesHarness({ initial, spy }: { initial: PodcastQuote[]; spy: Spy<PodcastQuote> }) {
  const [quotes, setQuotes] = useState<PodcastQuote[]>(initial);
  spy.value = quotes;
  return <QuotesEditor quotes={quotes} setQuotes={setQuotes} />;
}

function ResourcesHarness({
  initial,
  spy,
}: {
  initial: PodcastResource[];
  spy: Spy<PodcastResource>;
}) {
  const [resources, setResources] = useState<PodcastResource[]>(initial);
  spy.value = resources;
  return <ResourcesEditor resources={resources} setResources={setResources} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Wspólny szkielet
// ---------------------------------------------------------------------------

describe("SectionCard i RowShell", () => {
  it("karta pokazuje tytul, podpowiedz i wola dodawanie", () => {
    const onAdd = vi.fn();
    render(
      <SectionCard title="Tytul sekcji" hint="Podpowiedz" onAdd={onAdd} addLabel="Dodaj">
        <p>zawartosc</p>
      </SectionCard>,
    );
    expect(screen.getByText("Tytul sekcji")).toBeTruthy();
    expect(screen.getByText("Podpowiedz")).toBeTruthy();
    expect(screen.getByText("zawartosc")).toBeTruthy();
    fireEvent.click(screen.getByText("Dodaj"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("kosz ma DOSTEPNA etykiete, bo sama ikona nic nie mowi czytnikowi ekranu", () => {
    const onRemove = vi.fn();
    render(
      <RowShell onRemove={onRemove}>
        <span>wiersz</span>
      </RowShell>,
    );
    fireEvent.click(screen.getByLabelText("adminPodcasts.rowRemove"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Obsada
// ---------------------------------------------------------------------------

describe("PeopleEditor", () => {
  it("pusta obsada pokazuje komunikat, a nie pusta karte", () => {
    render(<PeopleHarness initial={[]} spy={{ value: [] }} />);
    expect(screen.getByText("adminPodcasts.people.empty")).toBeTruthy();
  });

  it("dodaje wiersz jako GOSCIA bez profilu (najczestszy przypadek redakcji)", () => {
    const spy: Spy<PersonDraft> = { value: [] };
    render(<PeopleHarness initial={[]} spy={spy} />);
    fireEvent.click(screen.getByText("adminPodcasts.people.add"));
    expect(spy.value).toEqual([{ profile_id: null, display_name: "", role: "guest", url: "" }]);
  });

  it("wybor profilu UZUPELNIA puste nazwisko, ale NIE nadpisuje wpisanego", () => {
    // Nadpisywanie wpisanego nazwiska zabierałoby redakcji świadome
    // nadpisanie („gen. w st. spocz." przy nazwisku z profilu).
    const spy: Spy<PersonDraft> = { value: [] };
    render(
      <PeopleHarness
        initial={[
          { profile_id: null, display_name: "", role: "guest", url: "" },
          { profile_id: null, display_name: "Wlasne nazwisko", role: "host", url: "" },
        ]}
        spy={spy}
      />,
    );
    const selects = screen.getAllByRole("combobox");
    // Układ wiersza: [rola, profil] - profil to co drugi select.
    fireEvent.change(selects[1], { target: { value: "p1" } });
    expect(spy.value[0]).toMatchObject({ profile_id: "p1", display_name: "Ewa Cis" });
    fireEvent.change(selects[3], { target: { value: "p1" } });
    expect(spy.value[1]).toMatchObject({ profile_id: "p1", display_name: "Wlasne nazwisko" });
  });

  it("profil bez nazwiska nie kasuje pustego pola (fallback na slug tylko w etykiecie)", () => {
    const spy: Spy<PersonDraft> = { value: [] };
    render(
      <PeopleHarness
        initial={[{ profile_id: null, display_name: "", role: "guest", url: "" }]}
        spy={spy}
      />,
    );
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "p2" } });
    expect(spy.value[0]).toMatchObject({ profile_id: "p2", display_name: "" });
    // Etykieta opcji spada na slug, bo profil nie ma nazwiska wyświetlanego.
    expect(screen.getByText("igor-nowak")).toBeTruthy();
  });

  it("zmiana roli i pol tekstowych trafia do WLASCIWEGO wiersza", () => {
    const spy: Spy<PersonDraft> = { value: [] };
    render(
      <PeopleHarness
        initial={[
          { profile_id: null, display_name: "Pierwszy", role: "guest", url: "" },
          { profile_id: null, display_name: "Drugi", role: "guest", url: "" },
        ]}
        spy={spy}
      />,
    );
    // Selekty idą parami [rola, profil] na wiersz, więc indeks 2 to ROLA
    // drugiego wiersza - i tylko on ma się zmienić.
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "host" } });
    const names = screen.getAllByPlaceholderText("adminPodcasts.people.displayNamePlaceholder");
    fireEvent.change(names[1], { target: { value: "Drugi poprawiony" } });
    const urls = screen.getAllByPlaceholderText("adminPodcasts.people.urlPlaceholder");
    fireEvent.change(urls[0], { target: { value: "https://example.org/a" } });
    expect(spy.value[0]).toMatchObject({
      role: "guest",
      display_name: "Pierwszy",
      url: "https://example.org/a",
    });
    expect(spy.value[1]).toMatchObject({
      role: "host",
      display_name: "Drugi poprawiony",
      url: "",
    });
  });

  it("usuwa DOKLADNIE wskazany wiersz, takze gdy dwa sa identyczne", () => {
    const spy: Spy<PersonDraft> = { value: [] };
    const twin: PersonDraft = { profile_id: null, display_name: "Bliznak", role: "guest", url: "" };
    render(<PeopleHarness initial={[{ ...twin }, { ...twin }]} spy={spy} />);
    fireEvent.click(screen.getAllByLabelText("adminPodcasts.rowRemove")[0]);
    // `filter` po tożsamości obiektu zabrałby oba wiersze.
    expect(spy.value).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rozdziały
// ---------------------------------------------------------------------------

describe("ChaptersEditor", () => {
  it("pusta lista pokazuje komunikat", () => {
    render(<ChaptersHarness initial={[]} spy={{ value: [] }} />);
    expect(screen.getByText("adminPodcasts.chapters.empty")).toBeTruthy();
  });

  it("dodaje rozdzial od zera sekundy", () => {
    const spy: Spy<PodcastChapter> = { value: [] };
    render(<ChaptersHarness initial={[]} spy={spy} />);
    fireEvent.click(screen.getByText("adminPodcasts.chapters.add"));
    expect(spy.value).toEqual([{ start: 0, title_pl: "", title_en: "" }]);
  });

  it("czas wpisuje sie po ludzku (MM:SS), a zapisuje w sekundach", () => {
    // Pole pokazuje `formatDuration`, a stan trzyma sekundy - pomyłka w tej
    // parze daje rozdziały przesunięte o rzędy wielkości.
    const spy: Spy<PodcastChapter> = { value: [] };
    render(<ChaptersHarness initial={[{ start: 0, title_pl: "", title_en: "" }]} spy={spy} />);
    const time = screen.getByLabelText("adminPodcasts.chapters.startTime");
    expect((time as HTMLInputElement).value).toBe("0:00");
    fireEvent.change(time, { target: { value: "12:30" } });
    expect(spy.value[0].start).toBe(750);
  });

  it("bzdura w polu czasu daje zero, a nie NaN w bazie", () => {
    const spy: Spy<PodcastChapter> = { value: [] };
    render(<ChaptersHarness initial={[{ start: 90, title_pl: "", title_en: "" }]} spy={spy} />);
    fireEvent.change(screen.getByLabelText("adminPodcasts.chapters.startTime"), {
      target: { value: "abc" },
    });
    expect(spy.value[0].start).toBe(0);
  });

  it("tytuly PL i EN ida do wlasciwego rozdzialu, a kosz usuwa jeden", () => {
    const spy: Spy<PodcastChapter> = { value: [] };
    render(
      <ChaptersHarness
        initial={[
          { start: 0, title_pl: "Wstep", title_en: "Intro" },
          { start: 60, title_pl: "Druga", title_en: "Second" },
        ]}
        spy={spy}
      />,
    );
    fireEvent.change(screen.getAllByPlaceholderText("Title (EN)")[1], {
      target: { value: "Second part" },
    });
    expect(spy.value[1].title_en).toBe("Second part");
    fireEvent.click(screen.getAllByLabelText("adminPodcasts.rowRemove")[1]);
    expect(spy.value.map((c) => c.title_pl)).toEqual(["Wstep"]);
  });
});

// ---------------------------------------------------------------------------
// Cytaty
// ---------------------------------------------------------------------------

describe("QuotesEditor", () => {
  it("pusta lista pokazuje komunikat, a dodanie daje trzy puste pola", () => {
    const spy: Spy<PodcastQuote> = { value: [] };
    render(<QuotesHarness initial={[]} spy={spy} />);
    expect(screen.getByText("adminPodcasts.quotes.empty")).toBeTruthy();
    fireEvent.click(screen.getByText("adminPodcasts.quotes.add"));
    expect(spy.value).toEqual([{ text_pl: "", text_en: "", attribution: "" }]);
  });

  it("tresc PL, tresc EN i atrybucja trafiaja do wlasciwego cytatu", () => {
    const spy: Spy<PodcastQuote> = { value: [] };
    render(
      <QuotesHarness
        initial={[
          { text_pl: "", text_en: "", attribution: "" },
          { text_pl: "", text_en: "", attribution: "" },
        ]}
        spy={spy}
      />,
    );
    fireEvent.change(screen.getAllByPlaceholderText("adminPodcasts.quotes.quotePlPlaceholder")[1], {
      target: { value: "Cytat drugi" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("Quote (EN)")[0], {
      target: { value: "First quote" },
    });
    fireEvent.change(
      screen.getAllByPlaceholderText("adminPodcasts.quotes.attributionPlaceholder")[0],
      { target: { value: "gen. Zmyslony" } },
    );
    expect(spy.value[0]).toEqual({
      text_pl: "",
      text_en: "First quote",
      attribution: "gen. Zmyslony",
    });
    expect(spy.value[1].text_pl).toBe("Cytat drugi");
  });

  it("kosz usuwa wskazany cytat", () => {
    const spy: Spy<PodcastQuote> = { value: [] };
    render(
      <QuotesHarness
        initial={[
          { text_pl: "Pierwszy", text_en: "", attribution: "" },
          { text_pl: "Drugi", text_en: "", attribution: "" },
        ]}
        spy={spy}
      />,
    );
    fireEvent.click(screen.getAllByLabelText("adminPodcasts.rowRemove")[0]);
    expect(spy.value.map((q) => q.text_pl)).toEqual(["Drugi"]);
  });
});

// ---------------------------------------------------------------------------
// Źródła
// ---------------------------------------------------------------------------

describe("ResourcesEditor", () => {
  it("pusta lista pokazuje komunikat, a dodanie daje wpis typu „zrodlo”", () => {
    const spy: Spy<PodcastResource> = { value: [] };
    render(<ResourcesHarness initial={[]} spy={spy} />);
    expect(screen.getByText("adminPodcasts.resources.empty")).toBeTruthy();
    fireEvent.click(screen.getByText("adminPodcasts.resources.add"));
    expect(spy.value).toEqual([{ label_pl: "", label_en: "", url: "", kind: "source" }]);
  });

  it("rodzaj spoza enuma wraca do „zrodla”, a nie leci do bazy", () => {
    // `<select>` w DOM da się ustawić na dowolny ciąg (rozszerzenie
    // przeglądarki, autofill, test) - bez normalizacji wpadłby prosto
    // w kolumnę z ograniczeniem i wywrócił zapis CAŁEGO odcinka.
    const spy: Spy<PodcastResource> = { value: [] };
    render(
      <ResourcesHarness
        initial={[{ label_pl: "", label_en: "", url: "", kind: "source" }]}
        spy={spy}
      />,
    );
    const kind = screen.getByRole("combobox");
    fireEvent.change(kind, { target: { value: "related" } });
    expect(spy.value[0].kind).toBe("related");
    fireEvent.change(kind, { target: { value: "cokolwiek" } });
    expect(spy.value[0].kind).toBe("source");
  });

  it("adres i etykiety trafiaja do wlasciwego wiersza, kosz usuwa jeden", () => {
    const spy: Spy<PodcastResource> = { value: [] };
    render(
      <ResourcesHarness
        initial={[
          { label_pl: "Pierwsze", label_en: "", url: "", kind: "source" },
          { label_pl: "Drugie", label_en: "", url: "", kind: "related" },
        ]}
        spy={spy}
      />,
    );
    fireEvent.change(screen.getAllByPlaceholderText("https://…")[1], {
      target: { value: "https://example.org/raport" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("Label (EN)")[0], {
      target: { value: "First" },
    });
    expect(spy.value[1].url).toBe("https://example.org/raport");
    expect(spy.value[0].label_en).toBe("First");
    fireEvent.click(screen.getAllByLabelText("adminPodcasts.rowRemove")[1]);
    expect(spy.value.map((r) => r.label_pl)).toEqual(["Pierwsze"]);
  });
});
