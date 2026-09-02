// Edytor odcinka: pola formularza, obsada z bazy, zestaw warstw przy zapisie.
//
// CO DOWODZI TEN PLIK. „Zapisz" w edytorze odcinka wysyła JEDEN zestaw:
// wiersz odcinka plus cztery warstwy plus obsadę. Wszystko, co do tego zestawu
// nie dojedzie, jest pracą redakcji wyrzuconą bez ostrzeżenia:
//   * pole podłączone do złej właściwości zapisuje tytuł PL w kolumnie EN
//     (i publiczna strona pokazuje polski tytuł anglojęzycznemu czytelnikowi);
//   * obsada wczytana PO pierwszym renderze i nieprzeniesiona do stanu znika
//     przy zapisie - strategia „zastąp wszystko" wymazuje wtedy prowadzącego;
//   * czas trwania wpisywany po ludzku (MM:SS), a zapisywany w sekundach -
//     pomyłka w tej parze przestawia odcinek o rzędy wielkości;
//   * przełącznik publikacji, który zmienia tylko status bez daty, wypuszcza
//     odcinek do kanału RSS bez `pubDate`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: czterech edytorów warstw (mają własny plik),
// kontraktu zapytań (`queries.test.ts`), kształtu payloadu (`shape.test.ts`)
// ani mechaniki Radiksa.
//
// SPROSTOWANIE. Stało tu wcześniej, że automatycznego wykrywania czasu trwania
// z pliku audio ten plik nie dubluje, „bo to `Audio` przeglądarki - ma sens
// tylko w teście end-to-end". To była błędna ocena: `Audio` jest konstruktorem
// na obiekcie globalnym i daje się podmienić atrapą, a cała logika wokół niego
// (sprzątanie nasłuchów, odrzucenie `Infinity`, zakaz nadpisywania czasu
// wpisanego przez redakcję) jest nasza. Dowód mieszka w
// `EpisodeEditorPaneAudio.test.tsx` - osobnym pliku, bo wymaga własnej atrapy
// globalnej, której nie chcemy zakładać na wszystkie testy edytora.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Podcast, PodcastShow } from "@/lib/podcast/types";
import type { EpisodeBundle } from "@/lib/podcast/shape";
import { newEpisodeDraft } from "@/lib/podcast/shape";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Biblioteka mediów ma własne testy; tu wystawiamy jeden przycisk per okno,
// który oddaje wybrany adres - żeby sprawdzić PODŁĄCZENIE `onPick`.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ accept, onPick }: { accept: string; onPick: (url: string) => void }) => (
    <button
      type="button"
      data-testid={`media-pick-${accept}`}
      onClick={() => onPick(`https://cdn.example.org/wybrany-${accept}`)}
    />
  ),
}));
vi.mock("@/components/atoms/PodcastPlayer", () => ({
  PodcastPlayer: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="podcast-player" data-src={src} data-title={title} />
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => (
    <button type="button" data-tab-trigger={value}>
      {children}
    </button>
  ),
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-tab-content={value}>{children}</div>
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (next: string) => void;
    children?: ReactNode;
  }) => (
    <div data-testid="select" data-value={value}>
      <button type="button" data-testid="select-bonus" onClick={() => onValueChange?.("bonus")} />
      <button
        type="button"
        data-testid="select-nonsense"
        onClick={() => onValueChange?.("cokolwiek")}
      />
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const { EpisodeEditorPane } = await import("@/components/admin/podcasts/EpisodeEditorPane");

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const EPISODE_ID = "22222222-2222-4222-8222-222222222222";

const SHOWS: PodcastShow[] = [
  {
    id: "s1",
    tenant_id: "t1",
    slug: "raport-baltycki",
    title_pl: "Raport Baltycki",
    title_en: "Baltic report",
    description_pl: "",
    description_en: "",
    cover_image_url: null,
    spotify_url: null,
    apple_url: null,
    youtube_url: null,
    sort_order: 1,
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

function episode(overrides: Partial<Podcast> = {}): Podcast {
  return {
    ...newEpisodeDraft("2026-01-01T00:00:00.000Z"),
    id: EPISODE_ID,
    slug: "odc-1",
    title_pl: "Odcinek pierwszy",
    title_en: "Episode one",
    excerpt_pl: "Zapowiedz PL",
    excerpt_en: "Excerpt EN",
    show_notes_pl: "<p>Notatki PL</p>",
    show_notes_en: "<p>Notes EN</p>",
    audio_url: "https://cdn.example.org/odc-1.mp3",
    duration_seconds: 1830,
    season: 2,
    episode_number: 7,
    show_id: "s1",
    ...overrides,
  };
}

/** Ostatni zestaw przekazany do `onSave` - przedmiot dowodu zamiast DOM. */
function mount(p: Podcast = episode(), people: unknown[] = []) {
  db().setResponse("podcast_episode_people", ok(people));
  db().setResponse("categories", ok([{ id: "c1", name_pl: "Obronnosc", name_en: "Defence" }]));
  db().setResponse("profiles", ok([{ id: "u1", display_name: "Ewa Cis", slug: "ewa-cis" }]));
  const onSave = vi.fn<(bundle: EpisodeBundle) => void>();
  const onCancel = vi.fn();
  return {
    onSave,
    onCancel,
    ...renderWithQueryClient(
      <EpisodeEditorPane p={p} shows={SHOWS} onSave={onSave} onCancel={onCancel} saving={false} />,
    ),
  };
}

beforeEach(() => {
  db().reset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("otwarcie edytora", () => {
  it("pokazuje wartosci odcinka, w tym czas trwania po ludzku", () => {
    mount();
    expect(screen.getByText("adminPodcasts.editor.editTitle")).toBeTruthy();
    expect(screen.getByDisplayValue("odc-1")).toBeTruthy();
    expect(screen.getByDisplayValue("Odcinek pierwszy")).toBeTruthy();
    expect(screen.getByDisplayValue("Episode one")).toBeTruthy();
    expect(screen.getByDisplayValue("Zapowiedz PL")).toBeTruthy();
    // 1830 s = 30:30 - pole pokazuje format, stan trzyma sekundy.
    expect(screen.getByDisplayValue("30:30")).toBeTruthy();
  });

  it("nowy szkic ma naglowek nowego odcinka, nie edycji", () => {
    mount({ ...newEpisodeDraft("2026-01-01T00:00:00.000Z") });
    expect(screen.getByText("adminPodcasts.editor.newTitle")).toBeTruthy();
  });

  it("selektor programu bierze opcje z propsa, a kategorii z bazy", async () => {
    mount();
    expect(screen.getByText("Raport Baltycki")).toBeTruthy();
    expect(await screen.findByText("Obronnosc")).toBeTruthy();
    // Obie listy mają opcję „bez przypisania" - inaczej nie da się odpiąć
    // odcinka od serii ani od specjalizacji.
    expect(screen.getByText("adminPodcasts.editor.noShow")).toBeTruthy();
    expect(screen.getByText("adminPodcasts.editor.noCategory")).toBeTruthy();
  });

  it("nowy szkic (bez id) NIE pyta bazy o obsade", async () => {
    mount({ ...newEpisodeDraft("2026-01-01T00:00:00.000Z") });
    await waitFor(() => expect(db().chainsFor("categories")).toHaveLength(1));
    expect(db().chainsFor("podcast_episode_people")).toEqual([]);
  });
});

describe("obsada wczytana z bazy", () => {
  it("wchodzi do formularza i DOJEZDZA do zestawu zapisu", async () => {
    // To jest sedno: gdyby obsada trafiała do stanu po pierwszym renderze
    // (efekt na `data`), „Zapisz" w tym oknie wysłałby pustą listę,
    // a warstwa danych zastępuje CAŁĄ obsadę odcinka.
    const { onSave } = mount(episode(), [
      {
        id: "p1",
        profile_id: "u1",
        display_name: "Ewa Cis",
        role: "host",
        url: null,
        sort_order: 0,
      },
    ]);
    // Nazwisko sprawdzamy po POLU obsady - ta sama wartość jest też etykietą
    // opcji w selektorze profilu, więc szukanie po wartości trafiałoby w dwa
    // elementy i test mówiłby o czymś innym, niż zamierza.
    const nameField = await screen.findByPlaceholderText(
      "adminPodcasts.people.displayNamePlaceholder",
    );
    expect((nameField as HTMLInputElement).value).toBe("Ewa Cis");
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].people).toEqual([
      { id: "p1", profile_id: "u1", display_name: "Ewa Cis", role: "host", url: "" },
    ]);
  });

  it("odcinek bez obsady zapisuje sie z pusta lista, a nie z undefined", async () => {
    const { onSave } = mount(episode(), []);
    await waitFor(() => expect(db().chainsFor("podcast_episode_people")).toHaveLength(1));
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].people).toEqual([]);
  });
});

describe("zestaw zapisu", () => {
  it("kazde zmienione pole dojezdza do zestawu, PL i EN osobno", () => {
    const { onSave } = mount();
    fireEvent.change(screen.getByDisplayValue("Odcinek pierwszy"), {
      target: { value: "Odcinek poprawiony" },
    });
    fireEvent.change(screen.getByDisplayValue("Episode one"), {
      target: { value: "Episode fixed" },
    });
    fireEvent.change(screen.getByDisplayValue("odc-1"), { target: { value: "odc-1-poprawka" } });
    fireEvent.change(screen.getByDisplayValue("30:30"), { target: { value: "45:00" } });
    fireEvent.click(screen.getByText("common.save"));
    const bundle = onSave.mock.calls[0][0];
    expect(bundle.episode).toMatchObject({
      title_pl: "Odcinek poprawiony",
      title_en: "Episode fixed",
      slug: "odc-1-poprawka",
      // 45:00 = 2700 s. Pole tekstowe i stan liczbowy muszą iść w parze.
      duration_seconds: 2700,
    });
  });

  it("przelacznik publikacji ustawia status ORAZ date publikacji", () => {
    const { onSave } = mount(episode({ status: "draft", published_at: null }));
    const publishRow = screen
      .getByText("adminPodcasts.editor.publishNow")
      .closest("div.rounded-md");
    const publishSwitch = publishRow?.querySelector('[role="switch"]');
    if (!(publishSwitch instanceof HTMLElement)) throw new Error("test: brak przelacznika");
    fireEvent.click(publishSwitch);
    fireEvent.click(screen.getByText("common.save"));
    const bundle = onSave.mock.calls[0][0];
    expect(bundle.episode.status).toBe("published");
    // Bez daty kanał RSS nie ma po czym sortować odcinków.
    expect(bundle.episode.published_at).not.toBeNull();
  });

  it("wycofanie publikacji wraca do szkicu i ZOSTAWIA date", () => {
    // Data zostaje świadomie: cofnięcie publikacji nie ma kasować informacji,
    // kiedy odcinek był w kanale.
    const { onSave } = mount(
      episode({ status: "published", published_at: "2026-02-01T00:00:00.000Z" }),
    );
    const publishRow = screen
      .getByText("adminPodcasts.editor.publishNow")
      .closest("div.rounded-md");
    const publishSwitch = publishRow?.querySelector('[role="switch"]');
    if (!(publishSwitch instanceof HTMLElement)) throw new Error("test: brak przelacznika");
    fireEvent.click(publishSwitch);
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode).toMatchObject({
      status: "draft",
      published_at: "2026-02-01T00:00:00.000Z",
    });
  });

  it("przelacznik tresci dla doroslych trafia do zestawu", () => {
    const { onSave } = mount(episode({ explicit: false }));
    fireEvent.click(screen.getByLabelText("adminPodcasts.editor.explicit"));
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode.explicit).toBe(true);
  });

  it("odpiecie od programu i przypiecie kategorii dojezdzaja jako id albo null", async () => {
    const { onSave } = mount();
    // Kategorie wchodzą z bazy - bez czekania na opcję zmiana `select`
    // nie miałaby czego wybrać i test byłby zielony o niczym.
    await screen.findByText("Obronnosc");
    const selects = screen.getAllByRole("combobox");
    // Kolejność pól formularza: [status, program, kategoria].
    fireEvent.change(selects[1], { target: { value: "" } });
    fireEvent.change(selects[2], { target: { value: "c1" } });
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode).toMatchObject({
      show_id: null,
      category_id: "c1",
    });
  });

  it("Anuluj nie zapisuje niczego", () => {
    const { onSave, onCancel } = mount();
    fireEvent.click(screen.getByText("common.cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("podglad na zywo", () => {
  it("przelacznik PL/EN zmienia jezyk podgladu tytulu i zapowiedzi", () => {
    mount();
    // Podgląd startuje po polsku (redakcja pisze najpierw PL).
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Odcinek pierwszy");
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Episode one");
    // Zapowiedź EN jest w podglądzie ORAZ w polu formularza - liczy się to,
    // że podgląd ją w ogóle pokazuje, a nie w ilu miejscach stoi.
    expect(screen.getAllByText("Excerpt EN").length).toBeGreaterThan(0);
  });

  it("pusty tytul daje zapas ze slownika, a nie pusty naglowek", () => {
    mount(episode({ title_pl: "", title_en: "" }));
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "adminPodcasts.editor.previewTitleFallback",
    );
  });

  it("odtwarzacz pojawia sie tylko z plikiem audio", () => {
    mount();
    expect(screen.getByTestId("podcast-player").getAttribute("data-src")).toBe(
      "https://cdn.example.org/odc-1.mp3",
    );
    cleanup();
    mount(episode({ audio_url: "" }));
    expect(screen.queryByTestId("podcast-player")).toBeNull();
    expect(screen.getByText("adminPodcasts.editor.addAudioHint")).toBeTruthy();
  });

  it("notatki w podgladzie sa SANITYZOWANE, nie wstawiane surowo", () => {
    // `dangerouslySetInnerHTML` bez sanitacji robi z podglądu panelu wektor
    // XSS-a na własnej redakcji (notatki bywają wklejane z maila).
    mount(episode({ show_notes_pl: "<p>Notatki</p><script>window.x=1</script>" }));
    expect(screen.getByText("Notatki")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("plakietka sezonu i numeru sklada sie z obu wartosci", () => {
    mount(episode({ season: 3, episode_number: 12 }));
    expect(screen.getByText("S3 · E12")).toBeTruthy();
  });
});

describe("pozostale pola i warstwy", () => {
  it("sezon, numer, okladka i pola EN dojezdzaja do zestawu", () => {
    // Jedna interakcja na sekcję zamiast klikania osiemnastu pól po kolei -
    // dowodem jest to, że wersja robocza formularza jedzie do zestawu, a nie
    // procent z klikania.
    const { onSave } = mount(episode({ season: null, episode_number: null }));
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0], { target: { value: "4" } });
    fireEvent.change(numbers[1], { target: { value: "11" } });
    fireEvent.change(screen.getByPlaceholderText("adminPodcasts.editor.coverPlaceholder"), {
      target: { value: "https://cdn.example.org/cover.png" },
    });
    fireEvent.change(screen.getByDisplayValue("Excerpt EN"), { target: { value: "New excerpt" } });
    fireEvent.change(screen.getByDisplayValue("<p>Notes EN</p>"), {
      target: { value: "<p>Fixed</p>" },
    });
    fireEvent.change(screen.getByDisplayValue("<p>Notatki PL</p>"), {
      target: { value: "<p>Poprawione</p>" },
    });
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode).toMatchObject({
      season: 4,
      episode_number: 11,
      cover_image_url: "https://cdn.example.org/cover.png",
      excerpt_en: "New excerpt",
      show_notes_en: "<p>Fixed</p>",
      show_notes_pl: "<p>Poprawione</p>",
    });
  });

  it("wyczyszczenie okladki i numerow zapisuje NULL, nie pusty ciag", () => {
    // `""` w kolumnie liczbowej i w adresie okładki to dwa różne błędy o tym
    // samym źródle: brak zamiany pustego pola na NULL.
    const { onSave } = mount(episode({ cover_image_url: "https://cdn.example.org/c.png" }));
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0], { target: { value: "" } });
    fireEvent.change(numbers[1], { target: { value: "" } });
    fireEvent.change(screen.getByDisplayValue("https://cdn.example.org/c.png"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode).toMatchObject({
      season: null,
      episode_number: null,
      cover_image_url: null,
    });
  });

  it("dodanie wpisu w KAZDEJ z czterech warstw jedzie w tym samym zestawie", () => {
    // Warstwy są czterema osobnymi tablicami, ale zapis jest JEDEN - stan musi
    // mieszkać w edytorze, inaczej „Zapisz" wysyła warstwy z różnych chwil.
    const { onSave } = mount(episode());
    fireEvent.click(screen.getByText("adminPodcasts.people.add"));
    fireEvent.click(screen.getByText("adminPodcasts.chapters.add"));
    fireEvent.click(screen.getByText("adminPodcasts.quotes.add"));
    fireEvent.click(screen.getByText("adminPodcasts.resources.add"));
    fireEvent.click(screen.getByText("common.save"));
    const bundle = onSave.mock.calls[0][0];
    expect(bundle.people).toHaveLength(1);
    expect(bundle.chapters).toEqual([{ start: 0, title_pl: "", title_en: "" }]);
    expect(bundle.quotes).toEqual([{ text_pl: "", text_en: "", attribution: "" }]);
    expect(bundle.resources).toEqual([{ label_pl: "", label_en: "", url: "", kind: "source" }]);
  });

  it("warstwy istniejacego odcinka wchodza PRZEZ PARSERY, a nie surowo", () => {
    // Kolumny jsonb bywają zaśmiecone (import, ręczna edycja w bazie); edytor
    // nie ma prawa pokazać ani odesłać wpisu, którego parser nie uznał.
    const { onSave } = mount(
      episode({
        chapters: [{ start: 30, title_pl: "Drugi", title_en: "" }, { nonsens: true }],
        quotes: [{ text_pl: "", text_en: "", attribution: "x" }],
        resources: [{ label_pl: "Bez adresu", label_en: "", url: "", kind: "source" }],
      }),
    );
    fireEvent.click(screen.getByText("common.save"));
    const bundle = onSave.mock.calls[0][0];
    expect(bundle.chapters).toHaveLength(1);
    expect(bundle.quotes).toEqual([]);
    expect(bundle.resources).toEqual([]);
  });

  it("przyciski biblioteki mediow otwieraja wybor, a nie zmieniaja pol", () => {
    const { onSave } = mount(episode());
    const buttons = screen.getAllByTitle(/uploadFromLibrary|uploadCoverLibraryTitle/);
    expect(buttons.length).toBe(2);
    for (const button of buttons) fireEvent.click(button);
    fireEvent.click(screen.getByText("common.save"));
    // Otwarcie okna wyboru nie może samo nic wpisać do odcinka.
    expect(onSave.mock.calls[0][0].episode).toMatchObject({
      audio_url: "https://cdn.example.org/odc-1.mp3",
      cover_image_url: null,
    });
  });

  it("adres audio wpisany recznie dojezdza do zestawu", () => {
    const { onSave } = mount(episode());
    fireEvent.change(screen.getByDisplayValue("https://cdn.example.org/odc-1.mp3"), {
      target: { value: "https://cdn.example.org/inny.mp3" },
    });
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode.audio_url).toBe("https://cdn.example.org/inny.mp3");
  });
});

describe("biblioteka mediow i rodzaj odcinka", () => {
  it("wybor okladki z biblioteki wpisuje adres do zestawu", () => {
    const { onSave } = mount(episode({ cover_image_url: null }));
    fireEvent.click(screen.getByTestId("media-pick-image"));
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode.cover_image_url).toBe(
      "https://cdn.example.org/wybrany-image",
    );
  });

  it("wybor pliku audio wpisuje adres I uruchamia wykrywanie czasu", async () => {
    // Wykrywanie czasu z metadanych pliku dzieje się w przeglądarce; tutaj
    // dowodzimy TYLKO, że wybór pliku je uruchamia (kręcące się kółko) i że
    // adres jest już w wersji roboczej - reszta jest poza zasięgiem happy-dom.
    const { onSave } = mount(episode({ audio_url: "", duration_seconds: 0 }));
    fireEvent.click(screen.getByTestId("media-pick-all"));
    await waitFor(() => expect(document.querySelector(".animate-spin")).toBeTruthy());
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode.audio_url).toBe("https://cdn.example.org/wybrany-all");
  });

  it("rodzaj odcinka poza enumem wraca do „full”, a nie leci do bazy", () => {
    const { onSave } = mount(episode({ episode_type: "full" }));
    fireEvent.click(screen.getByTestId("select-bonus"));
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave.mock.calls[0][0].episode.episode_type).toBe("bonus");
    cleanup();
    const second = mount(episode({ episode_type: "trailer" }));
    fireEvent.click(screen.getByTestId("select-nonsense"));
    fireEvent.click(screen.getByText("common.save"));
    expect(second.onSave.mock.calls[0][0].episode.episode_type).toBe("full");
  });
});
