// Molekuła „OBSADA SESJI" - kto występuje w sesji, w jakiej roli i w jakiej
// kolejności. Zapis podmienia CAŁĄ obsadę, więc edytor trzyma stan docelowy.
//
// CO TEN PLIK DOWODZI.
//   1. NOWA SESJA NIE PYTA O NIC. Bez identyfikatora sesji RPC nie ma czego
//      zapisać - sekcja mówi, co zrobić, i NIE odpala żadnego zapytania.
//   2. TRZY STANY SZCZEGÓŁU MAJĄ TRZY WIDOKI. Awaria nie może mówić „nikt nie
//      jest przypisany" - to nieprawda o stanie bazy.
//   3. OBSADA IDZIE ZA KOLEJNOŚCIĄ Z BAZY i pokazuje osobę BEZ KONTA oraz
//      ostrzeżenie o profilu niepublicznym.
//   4. ZAPIS NIESIE POZYCJĘ NA LIŚCIE (10, 20, 30…), a nie `sort_order`
//      z serwera - przestawienie w edytorze jest przestawieniem w programie.
//   5. KANDYDACI to prelegenci wydarzenia spoza obsady, BEZ wierszy legacy
//      (pusty `speaker_profile_id` - baza przyjmuje wyłącznie nakładkę).
//   6. „ZAPISZ" ŻYJE TYLKO PRZY ZMIANACH, a powrót do stanu z serwera gasi go
//      z powrotem. Trwający zapis blokuje przycisk.
//   7. ODMOWA BAZY dochodzi zdaniem ze słownika (`role=alert`) i NIE kasuje
//      pracy; sukces daje toast i oddaje listę serwerowi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Czystej warstwy obsady (`parseSessionCast`,
// `castCandidates`, `moveCastMember`…) - tabele w `lib/events/__tests__`.
// (2) Hooków szczegółu i zapisu - zamockowane na poziomie MODUŁU, bo przedmiotem
// dowodu jest, CO molekuła wysyła i co robi z odpowiedzią. Słownik odmów
// (`adminAgendaFailure`) jest PRAWDZIWY - to on mapuje głowę komunikatu
// plpgsql na klucz, a asercja stoi na kluczu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { radixSelectStub } from "@/test/reactStubs";
import type { EventSpeakerEntry } from "@/lib/admin/community";
import type { SessionSpeakerInput } from "@/lib/events/sessionsApi";

/** Drugi argument `mutate` - tylko to, co molekuła przekazuje. */
interface Wynik {
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

interface Zapis {
  sessionId: string;
  speakers: readonly SessionSpeakerInput[];
}

interface StanSzczegolu {
  isPending: boolean;
  isError: boolean;
  data?: { speakers: unknown } | null;
}

const h = vi.hoisted(() => ({
  language: "pl",
  detail: { isPending: true, isError: false } as StanSzczegolu,
  detailQueries: [] as (string | null)[],
  mutationEvents: [] as string[],
  saves: [] as Zapis[],
  callbacks: [] as Wynik[],
  savePending: false,
  fetchEventSpeakers: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Radix Select nie renderuje opcji bez pointer API - natywny `<select>` niesie
// wartość tą samą drogą (`onValueChange`), a nazwę z `aria-label` wyzwalacza.
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/lib/admin/community", () => ({ fetchEventSpeakers: h.fetchEventSpeakers }));
vi.mock("@/lib/events/useEventSessions", () => ({
  useSessionDetail: (sessionId: string | null) => {
    h.detailQueries.push(sessionId);
    return h.detail;
  },
  useSetSessionSpeakers: (eventId: string) => {
    h.mutationEvents.push(eventId);
    return {
      isPending: h.savePending,
      mutate: (variables: Zapis, callbacks: Wynik) => {
        h.saves.push(variables);
        h.callbacks.push(callbacks);
      },
    };
  },
}));

const { SessionSpeakersEditor } =
  await import("@/components/admin/events/molecules/SessionSpeakersEditor");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const K = "adminEventAgenda.sessionSpeakers";

/** Surowy `speakers jsonb` ze szczegółu sesji - celowo NIE w kolejności. */
function surowaObsada(): unknown[] {
  return [
    {
      speaker_profile_id: "sp-anna",
      user_id: "user-anna",
      person_id: null,
      display_name: "Anna Nowak",
      avatar_url: null,
      headline_pl: "Dyrektorka programowa",
      job_title: "Dyrektorka",
      is_public: true,
      role: "moderator",
      allow_overlap: true,
      sort_order: 20,
    },
    {
      // OSOBA BEZ KONTA: nakładka sceniczna wisi na osobie, nie na profilu.
      speaker_profile_id: "sp-jan",
      user_id: null,
      person_id: "person-jan",
      display_name: "Jan Kowalski",
      avatar_url: null,
      headline_pl: null,
      job_title: null,
      is_public: false,
      role: "speaker",
      allow_overlap: false,
      sort_order: 10,
    },
    {
      speaker_profile_id: "sp-bez-nazwy",
      user_id: null,
      person_id: "person-x",
      display_name: null,
      avatar_url: null,
      headline_pl: null,
      job_title: null,
      is_public: true,
      role: "host",
      allow_overlap: false,
      sort_order: 30,
    },
  ];
}

function wpis(overrides: Partial<EventSpeakerEntry>): EventSpeakerEntry {
  return {
    entry_id: "entry",
    speaker_profile_id: "sp",
    user_id: null,
    person_id: null,
    display_name: null,
    avatar_url: null,
    job_title: null,
    company: null,
    email: null,
    is_public: true,
    sort_order: 10,
    is_legacy: false,
    ...overrides,
  };
}

/** Rejestr prelegentów wydarzenia: dwie osoby z obsady, dwie spoza, jeden legacy. */
function rejestr(): EventSpeakerEntry[] {
  return [
    wpis({ entry_id: "e-anna", speaker_profile_id: "sp-anna", display_name: "Anna Nowak" }),
    wpis({ entry_id: "e-jan", speaker_profile_id: "sp-jan", display_name: "Jan Kowalski" }),
    wpis({
      entry_id: "e-piotr",
      speaker_profile_id: "sp-piotr",
      display_name: "Piotr Zieliński",
      job_title: "Analityk",
      headline_pl: "Analityk rynku energii",
      is_public: false,
    }),
    wpis({ entry_id: "e-anon", speaker_profile_id: "sp-anon", display_name: null }),
    wpis({
      entry_id: null,
      speaker_profile_id: "",
      display_name: "Stary Wpis Legacy",
      is_legacy: true,
    }),
  ];
}

function gotowyStan(speakers: unknown = surowaObsada()): StanSzczegolu {
  return { isPending: false, isError: false, data: { speakers } };
}

function renderuj(
  props: {
    sessionId?: string | null;
    trackName?: string | null;
    onDirtyChange?: (dirty: boolean) => void;
  } = {},
): {
  queryClient: QueryClient;
  rerender: () => void;
  unmount: () => void;
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <SessionSpeakersEditor
        eventId={EVENT_ID}
        sessionId={props.sessionId === undefined ? SESSION_ID : props.sessionId}
        trackName={props.trackName === undefined ? "Ścieżka Cyfrowa" : props.trackName}
        onDirtyChange={props.onDirtyChange}
      />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { queryClient, rerender: () => view.rerender(ui()), unmount: () => view.unmount() };
}

/** Nazwy osób w kolejności wierszy obsady. */
function kolejnosc(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => within(item).getByRole("combobox").getAttribute("aria-label") ?? "");
}

const rola = (name: string): HTMLSelectElement =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: `${K}.roleLabel(name=${name})` });
const wyzej = (name: string): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: `${K}.moveUp(name=${name})` });
const nizej = (name: string): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: `${K}.moveDown(name=${name})` });
const usun = (name: string): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: `${K}.remove(name=${name})` });
const zapisz = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: `${K}.saveAction` });
const dodaj = (): Promise<HTMLSelectElement> =>
  screen.findByRole<HTMLSelectElement>("combobox", { name: `${K}.addLabel` });

const UNNAMED = `${K}.unnamed`;

beforeEach(() => {
  h.language = "pl";
  h.detail = gotowyStan();
  h.detailQueries = [];
  h.mutationEvents = [];
  h.saves = [];
  h.callbacks = [];
  h.savePending = false;
  h.fetchEventSpeakers.mockReset();
  h.fetchEventSpeakers.mockResolvedValue(rejestr());
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SessionSpeakersEditor - nowa sesja", () => {
  it("bez identyfikatora sesji pokazuje tylko wskazówkę i nie odpala żadnego zapytania", () => {
    const { queryClient } = renderuj({ sessionId: null });

    expect(screen.getByRole("heading", { name: `${K}.title` })).toBeInTheDocument();
    expect(screen.getByText(`${K}.hint`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.newSessionHint`)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    expect(h.detailQueries).toEqual([]);
    expect(h.mutationEvents).toEqual([]);
    expect(h.fetchEventSpeakers).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("SessionSpeakersEditor - stany szczegółu sesji", () => {
  it("w trakcie wczytywania mówi, że wczytuje, i nie pokazuje listy ani zapisu", () => {
    h.detail = { isPending: true, isError: false };
    renderuj();

    expect(screen.getByText(`${K}.loading`)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${K}.saveAction` })).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.empty`)).not.toBeInTheDocument();
    expect(h.detailQueries).toContain(SESSION_ID);
    expect(h.mutationEvents).toContain(EVENT_ID);
  });

  it("awaria szczegółu to komunikat w role=alert, a nie pusta obsada", () => {
    h.detail = { isPending: false, isError: true };
    renderuj();

    expect(screen.getByRole("alert")).toHaveTextContent(`${K}.loadFailed`);
    expect(screen.queryByText(`${K}.empty`)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("pyta rejestr prelegentów TEGO wydarzenia wspólnym kluczem ekranu prelegentów", async () => {
    const { queryClient } = renderuj();
    await dodaj();

    expect(h.fetchEventSpeakers).toHaveBeenCalledWith(EVENT_ID);
    expect(queryClient.getQueryData(["admin-event-speakers", EVENT_ID])).toEqual(rejestr());
  });
});

describe("SessionSpeakersEditor - ścieżka sesji", () => {
  it("sesja w ścieżce mówi, do której ścieżki trafią prelegenci", async () => {
    renderuj({ trackName: "Ścieżka Cyfrowa" });
    await dodaj();

    expect(screen.getByText(`${K}.trackNote(name=Ścieżka Cyfrowa)`)).toBeInTheDocument();
    expect(screen.queryByText(`${K}.noTrack`)).not.toBeInTheDocument();
  });

  it("sesja bez ścieżki mówi, że ścieżki z niej nie będzie", async () => {
    renderuj({ trackName: null });
    await dodaj();

    expect(screen.getByText(`${K}.noTrack`)).toBeInTheDocument();
    expect(screen.queryByText(/trackNote/)).not.toBeInTheDocument();
  });
});

describe("SessionSpeakersEditor - lista obsady", () => {
  it("układa obsadę według kolejności z bazy i ustawia role z serwera", async () => {
    renderuj();
    await dodaj();

    expect(kolejnosc()).toEqual([
      `${K}.roleLabel(name=Jan Kowalski)`,
      `${K}.roleLabel(name=Anna Nowak)`,
      `${K}.roleLabel(name=${UNNAMED})`,
    ]);
    expect(rola("Jan Kowalski")).toHaveValue("speaker");
    expect(rola("Anna Nowak")).toHaveValue("moderator");
    expect(rola(UNNAMED)).toHaveValue("host");
    expect(
      within(rola("Anna Nowak"))
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["speaker", "moderator", "panelist", "host"]);
    expect(
      within(rola("Anna Nowak")).getByRole("option", { name: "adminEventAgenda.roles.panelist" }),
    ).toBeInTheDocument();
  });

  it("pokazuje osobę bez konta, nagłówek sceniczny i ostrzeżenie o profilu niepublicznym", async () => {
    renderuj();
    await dodaj();

    const [jan, anna, bezNazwy] = screen.getAllByRole("listitem");
    // Osoba bez konta (user_id null) stoi w obsadzie jak każda inna.
    expect(within(jan).getByText("Jan Kowalski")).toBeInTheDocument();
    expect(within(jan).getByText(`${K}.notPublic`)).toBeInTheDocument();

    expect(within(anna).getByText("Anna Nowak")).toBeInTheDocument();
    expect(within(anna).getByText("Dyrektorka programowa")).toBeInTheDocument();
    expect(within(anna).queryByText(`${K}.notPublic`)).not.toBeInTheDocument();

    expect(within(bezNazwy).getByText(UNNAMED)).toBeInTheDocument();
    expect(within(bezNazwy).queryByText(`${K}.notPublic`)).not.toBeInTheDocument();
    expect(screen.getAllByText(`${K}.notPublic`)).toHaveLength(1);
  });

  it("pusta obsada mówi, że nikt nie jest przypisany", async () => {
    h.detail = gotowyStan([]);
    renderuj();
    await dodaj();

    expect(screen.getByText(`${K}.empty`)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("szczegół bez tablicy obsady (null) to też pusta obsada", async () => {
    h.detail = { isPending: false, isError: false, data: null };
    renderuj();
    await dodaj();

    expect(screen.getByText(`${K}.empty`)).toBeInTheDocument();
  });
});

describe("SessionSpeakersEditor - zmiany i przycisk zapisu", () => {
  it("bez zmian przycisk zapisu jest zablokowany i nie ma napisu o niezapisanych zmianach", async () => {
    renderuj();
    await dodaj();

    expect(zapisz()).toBeDisabled();
    expect(screen.queryByText(`${K}.unsaved`)).not.toBeInTheDocument();
    fireEvent.click(zapisz());
    expect(h.saves).toEqual([]);
  });

  it("zmiana roli oznacza zmiany, a zapis wysyła całą obsadę z pozycjami 10, 20, 30", async () => {
    renderuj();
    await dodaj();

    fireEvent.change(rola("Anna Nowak"), { target: { value: "panelist" } });

    expect(rola("Anna Nowak")).toHaveValue("panelist");
    expect(screen.getByText(`${K}.unsaved`)).toBeInTheDocument();
    expect(zapisz()).toBeEnabled();

    fireEvent.click(zapisz());
    expect(h.saves).toEqual([
      {
        sessionId: SESSION_ID,
        speakers: [
          { speakerProfileId: "sp-jan", role: "speaker", sortOrder: 10, allowOverlap: false },
          { speakerProfileId: "sp-anna", role: "panelist", sortOrder: 20, allowOverlap: true },
          { speakerProfileId: "sp-bez-nazwy", role: "host", sortOrder: 30, allowOverlap: false },
        ],
      },
    ]);
  });

  it("powrót do roli z serwera gasi zmiany - porównanie idzie po treści, nie po dotknięciu", async () => {
    renderuj();
    await dodaj();

    fireEvent.change(rola("Anna Nowak"), { target: { value: "host" } });
    expect(zapisz()).toBeEnabled();
    fireEvent.change(rola("Anna Nowak"), { target: { value: "moderator" } });

    expect(zapisz()).toBeDisabled();
    expect(screen.queryByText(`${K}.unsaved`)).not.toBeInTheDocument();
  });

  it("trwający zapis blokuje przycisk, zmienia jego napis i chowa napis o zmianach", async () => {
    const { rerender } = renderuj();
    await dodaj();
    fireEvent.change(rola("Jan Kowalski"), { target: { value: "moderator" } });
    expect(screen.getByText(`${K}.unsaved`)).toBeInTheDocument();

    h.savePending = true;
    rerender();

    const przycisk = screen.getByRole("button", { name: `${K}.saving` });
    expect(przycisk).toBeDisabled();
    expect(screen.queryByRole("button", { name: `${K}.saveAction` })).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.unsaved`)).not.toBeInTheDocument();
    // Edycja przeżyła przerender - trzyma własną kopię.
    expect(rola("Jan Kowalski")).toHaveValue("moderator");
  });
});

describe("SessionSpeakersEditor - kolejność i usuwanie", () => {
  it("pierwsza osoba nie idzie wyżej, ostatnia nie idzie niżej", async () => {
    renderuj();
    await dodaj();

    expect(wyzej("Jan Kowalski")).toBeDisabled();
    expect(nizej("Jan Kowalski")).toBeEnabled();
    expect(wyzej("Anna Nowak")).toBeEnabled();
    expect(nizej("Anna Nowak")).toBeEnabled();
    expect(wyzej(UNNAMED)).toBeEnabled();
    expect(nizej(UNNAMED)).toBeDisabled();
  });

  it("przestawienie niżej i wyżej zmienia kolejność, a zapis niesie nowe pozycje", async () => {
    renderuj();
    await dodaj();

    fireEvent.click(nizej("Jan Kowalski"));
    expect(kolejnosc()).toEqual([
      `${K}.roleLabel(name=Anna Nowak)`,
      `${K}.roleLabel(name=Jan Kowalski)`,
      `${K}.roleLabel(name=${UNNAMED})`,
    ]);
    expect(wyzej("Anna Nowak")).toBeDisabled();

    fireEvent.click(wyzej(UNNAMED));
    expect(kolejnosc()).toEqual([
      `${K}.roleLabel(name=Anna Nowak)`,
      `${K}.roleLabel(name=${UNNAMED})`,
      `${K}.roleLabel(name=Jan Kowalski)`,
    ]);
    expect(nizej("Jan Kowalski")).toBeDisabled();

    fireEvent.click(zapisz());
    expect(h.saves[0]?.speakers.map((s) => [s.speakerProfileId, s.sortOrder])).toEqual([
      ["sp-anna", 10],
      ["sp-bez-nazwy", 20],
      ["sp-jan", 30],
    ]);
  });

  it("przestawienie tam i z powrotem nie zostawia niezapisanych zmian", async () => {
    renderuj();
    await dodaj();

    fireEvent.click(nizej("Jan Kowalski"));
    expect(zapisz()).toBeEnabled();
    fireEvent.click(wyzej("Jan Kowalski"));

    expect(zapisz()).toBeDisabled();
  });

  it("usunięcie zdejmuje osobę z obsady i oddaje ją kandydatom", async () => {
    renderuj();
    const przed = await dodaj();
    expect(within(przed).queryByRole("option", { name: "Jan Kowalski" })).not.toBeInTheDocument();

    fireEvent.click(usun("Jan Kowalski"));

    expect(screen.queryByText("Jan Kowalski", { selector: "li *" })).not.toBeInTheDocument();
    expect(kolejnosc()).toEqual([
      `${K}.roleLabel(name=Anna Nowak)`,
      `${K}.roleLabel(name=${UNNAMED})`,
    ]);
    expect(wyzej("Anna Nowak")).toBeDisabled();
    expect(within(await dodaj()).getByRole("option", { name: "Jan Kowalski" })).toBeInTheDocument();

    fireEvent.click(zapisz());
    expect(h.saves[0]?.speakers).toEqual([
      { speakerProfileId: "sp-anna", role: "moderator", sortOrder: 10, allowOverlap: true },
      { speakerProfileId: "sp-bez-nazwy", role: "host", sortOrder: 20, allowOverlap: false },
    ]);
  });

  it("usunięcie wszystkich pokazuje pustą obsadę, a zapis wysyła pustą listę", async () => {
    renderuj();
    await dodaj();

    fireEvent.click(usun("Jan Kowalski"));
    fireEvent.click(usun("Anna Nowak"));
    fireEvent.click(usun(UNNAMED));

    expect(screen.getByText(`${K}.empty`)).toBeInTheDocument();
    fireEvent.click(zapisz());
    expect(h.saves).toEqual([{ sessionId: SESSION_ID, speakers: [] }]);
  });
});

describe("SessionSpeakersEditor - dodawanie z rejestru prelegentów", () => {
  it("kandydaci to prelegenci wydarzenia spoza obsady, bez wierszy legacy", async () => {
    renderuj();
    const lista = await dodaj();

    expect(
      within(lista)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Piotr Zieliński", UNNAMED]);
    expect(
      within(lista)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["sp-piotr", "sp-anon"]);
    expect(screen.queryByText("Stary Wpis Legacy")).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.noCandidates`)).not.toBeInTheDocument();
  });

  it("dodanie kandydata dopisuje go na koniec z rolą prelegenta i znika z listy kandydatów", async () => {
    renderuj();
    fireEvent.change(await dodaj(), { target: { value: "sp-piotr" } });

    expect(kolejnosc()).toEqual([
      `${K}.roleLabel(name=Jan Kowalski)`,
      `${K}.roleLabel(name=Anna Nowak)`,
      `${K}.roleLabel(name=${UNNAMED})`,
      `${K}.roleLabel(name=Piotr Zieliński)`,
    ]);
    expect(rola("Piotr Zieliński")).toHaveValue("speaker");
    const piotr = screen.getAllByRole("listitem")[3];
    expect(within(piotr).getByText("Analityk rynku energii")).toBeInTheDocument();
    expect(within(piotr).getByText(`${K}.notPublic`)).toBeInTheDocument();
    expect(
      within(await dodaj())
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["sp-anon"]);

    expect(screen.getByText(`${K}.unsaved`)).toBeInTheDocument();
    fireEvent.click(zapisz());
    expect(h.saves[0]?.speakers.at(-1)).toEqual({
      speakerProfileId: "sp-piotr",
      role: "speaker",
      sortOrder: 40,
      allowOverlap: false,
    });
  });

  it("gdy wszyscy prelegenci są już w obsadzie, zamiast listy stoi napis noCandidates", async () => {
    renderuj();
    fireEvent.change(await dodaj(), { target: { value: "sp-piotr" } });
    fireEvent.change(await dodaj(), { target: { value: "sp-anon" } });

    expect(screen.queryByRole("combobox", { name: `${K}.addLabel` })).not.toBeInTheDocument();
    expect(screen.getByText(`${K}.noCandidates`)).toBeInTheDocument();
    // Osoba bez nazwy z rejestru dostaje w obsadzie napis „bez nazwy".
    expect(screen.getAllByText(UNNAMED)).toHaveLength(2);
  });

  it("identyfikator spoza kandydatów niczego nie dopisuje", async () => {
    renderuj();
    fireEvent.change(await dodaj(), { target: { value: "sp-anna" } });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(zapisz()).toBeDisabled();
  });

  it("dopóki rejestr nie dojechał, nie ma ani listy kandydatów, ani napisu noCandidates", () => {
    h.fetchEventSpeakers.mockReturnValue(new Promise<never>(() => {}));
    renderuj();

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("combobox", { name: `${K}.addLabel` })).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.noCandidates`)).not.toBeInTheDocument();
  });

  it("pusty rejestr wydarzenia daje napis noCandidates", async () => {
    h.fetchEventSpeakers.mockResolvedValue([]);
    renderuj();

    expect(await screen.findByText(`${K}.noCandidates`)).toBeInTheDocument();
  });

  it("awaria rejestru mówi o niej w role=alert, a nie milczy ani nie udaje braku kandydatów", async () => {
    h.fetchEventSpeakers.mockRejectedValue(new Error("rpc down"));
    renderuj();

    const alert = await screen.findByText(`${K}.registryFailed`);
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.queryByText(`${K}.noCandidates`)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: `${K}.addLabel` })).not.toBeInTheDocument();
    // Obsada z serwera zostaje - awaria rejestru nie zabiera tego, co już jest.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("SessionSpeakersEditor - wynik zapisu", () => {
  it("sukces daje toast i oddaje listę serwerowi - bez niezapisanych zmian", async () => {
    renderuj();
    await dodaj();
    fireEvent.click(nizej("Jan Kowalski"));
    fireEvent.click(zapisz());
    expect(h.callbacks).toHaveLength(1);

    // Po unieważnieniu szczegół wraca z nową kolejnością.
    h.detail = gotowyStan([
      { ...(surowaObsada()[0] as object), sort_order: 10 },
      { ...(surowaObsada()[1] as object), sort_order: 20 },
      surowaObsada()[2],
    ]);
    act(() => h.callbacks[0].onSuccess());

    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.sessions.toasts.speakersSaved");
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText(`${K}.unsaved`)).not.toBeInTheDocument();
    expect(zapisz()).toBeDisabled();
    expect(kolejnosc()).toEqual([
      `${K}.roleLabel(name=Anna Nowak)`,
      `${K}.roleLabel(name=Jan Kowalski)`,
      `${K}.roleLabel(name=${UNNAMED})`,
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("odmowa nachodzenia godzin dochodzi zdaniem ze słownika i nie kasuje edycji", async () => {
    renderuj();
    await dodaj();
    fireEvent.change(rola("Anna Nowak"), { target: { value: "speaker" } });
    fireEvent.click(zapisz());

    act(() =>
      h.callbacks[0].onError(new Error("speaker_overlap: speaker already has a session then")),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("adminEventAgenda.errors.speakerOverlap");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(rola("Anna Nowak")).toHaveValue("speaker");
    expect(screen.getByText(`${K}.unsaved`)).toBeInTheDocument();
    expect(zapisz()).toBeEnabled();
  });

  it("nieznana odmowa nie pokazuje surowego SQL-a, tylko zdanie unknown", async () => {
    renderuj();
    await dodaj();
    fireEvent.click(usun(UNNAMED));
    fireEvent.click(zapisz());

    act(() => h.callbacks[0].onError(new Error('23514: new row violates check constraint "x"')));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("adminEventAgenda.errors.unknown");
    expect(alert).not.toHaveTextContent("23514");
  });

  it("następna zmiana w obsadzie zdejmuje komunikat odmowy", async () => {
    renderuj();
    await dodaj();
    fireEvent.change(rola("Anna Nowak"), { target: { value: "speaker" } });
    fireEvent.click(zapisz());
    act(() => h.callbacks[0].onError(new Error("speaker_overlap: busy")));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(nizej("Jan Kowalski"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ponowny zapis po odmowie wysyła aktualny stan edycji", async () => {
    renderuj();
    await dodaj();
    fireEvent.change(rola("Anna Nowak"), { target: { value: "speaker" } });
    fireEvent.click(zapisz());
    act(() => h.callbacks[0].onError(new Error("speaker_overlap: busy")));

    fireEvent.click(usun("Anna Nowak"));
    fireEvent.click(zapisz());

    expect(h.saves).toHaveLength(2);
    expect(h.saves[1]?.speakers.map((s) => s.speakerProfileId)).toEqual(["sp-jan", "sp-bez-nazwy"]);
  });
});

describe("SessionSpeakersEditor - niezapisane zmiany i formularz sesji", () => {
  it("zmiana melduje formularzowi sesji niezapisane zmiany, a „Cofnij” je gasi i wraca do serwera", async () => {
    const onDirty = vi.fn<(dirty: boolean) => void>();
    renderuj({ onDirtyChange: onDirty });
    await dodaj();
    expect(onDirty).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("button", { name: `${K}.discardAction` })).toBeNull();

    fireEvent.change(rola("Anna Nowak"), { target: { value: "speaker" } });
    expect(onDirty).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: `${K}.discardAction` }));
    expect(onDirty).toHaveBeenLastCalledWith(false);
    expect(rola("Anna Nowak").value).toBe("moderator");
    expect(zapisz()).toBeDisabled();
    expect(screen.queryByText(`${K}.unsaved`)).toBeNull();
  });

  it("odmontowanie (zamkniecie dialogu) melduje brak zmian - blokada zapisu sesji nie zostaje", async () => {
    const onDirty = vi.fn<(dirty: boolean) => void>();
    const { unmount } = renderuj({ onDirtyChange: onDirty });
    await dodaj();
    fireEvent.change(rola("Anna Nowak"), { target: { value: "speaker" } });
    expect(onDirty).toHaveBeenLastCalledWith(true);

    unmount();
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });

  it("panel po angielsku pokazuje naglowek EN, a bez niego stanowisko - nigdy naglowka PL", async () => {
    h.language = "en";
    const [anna, jan, ...rest] = surowaObsada() as Record<string, unknown>[];
    h.detail = gotowyStan([
      { ...anna, headline_en: "Programme Director" },
      { ...jan, headline_pl: "Ekspert", job_title: "Analyst" },
      ...rest,
    ]);
    renderuj();
    await dodaj();

    expect(screen.getByText("Programme Director")).toBeInTheDocument();
    expect(screen.queryByText("Dyrektorka programowa")).toBeNull();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.queryByText("Ekspert")).toBeNull();
  });
});
