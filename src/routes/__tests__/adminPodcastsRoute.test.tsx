// Trasa `/admin/podcasts` ZAMONTOWANA - powłoka panelu podcastów po
// wyciągnięciu warstwy danych do `lib/podcast/queries.ts`.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// Kontrakt zapytań i zapisów ma własne asercje (`lib/podcast/__tests__/
// queries.test.ts`), a czyste reguły payloadów swoje (`shape.test.ts`).
// Tutaj sprawdzamy WYŁĄCZNIE SKLEJENIE, którego tamte dwa pliki nie widzą:
//
//   1. GDZIE JEST BRAMKA ROLI. Panel podcastów NIE MA własnej - przepuszcza
//      każdą rolę sztabową, bo bramkę trzyma layout `/admin`. Ten plik montuje
//      TEN layout i dowodzi, że konto bez `isStaff` nie dostaje panelu, tylko
//      przekierowanie. Dublowanie bramki w każdej trasie panelu byłoby
//      farmą, o której mówi `adminRouteAuthority.gate.test.ts`.
//   2. PRZEŁĄCZANIE WIDOKÓW. Trzy panele (odcinki / programy / ustawienia)
//      wykluczają się przez stan, a nie przez `Tabs`, więc żaden test
//      komponentu tego nie łapie.
//   3. GDZIE MIESZKA FILTR LISTY. Fraza wyszukiwania została w trasie
//      świadomie: gdyby zeszła do listy, wyjście do ustawień i powrót
//      czyściłyby zawężenie, na którym redakcja pracuje. To jest asercja
//      pilnująca DECYZJI z ekstrakcji.
//   4. PUBLIKACJA ODCINKA ROBI JEDNO I DRUGIE: zapisuje `status: "published"`
//      ORAZ unieważnia trzy klucze cache (panel + dwa prefiksy publiczne).
//      Brak inwalidacji publicznego prefiksu to odcinek opublikowany, którego
//      czytelnik nie widzi do wygaśnięcia `staleTime`.
//   5. USUNIĘCIE PROGRAMU WYMAGA POTWIERDZENIA. Program niesie odcinki,
//      a panel nie ma ekranu przywracania - kliknięcie „Usuń" bez pytania
//      zdejmuje z publicznej strony całą serię.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: pól edytora (osiemnaście pól i cztery warstwy
// mają asercje przy komponentach), kształtu payloadu (`shape.test.ts`),
// autorytetu zapisu (RLS/pgTAP) ani mechaniki Radiksa (atrapy niżej oddają
// kontrakt: stan + wywołanie ze nową wartością).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  isStaff: true,
  authLoading: false,
  session: {} as object | null,
  tenantId: "11111111-1111-4111-8111-111111111111" as string | null,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-extras", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    saved: () => "adminToast.saved",
    deleted: () => "adminToast.deleted",
    settingsSaved: () => "adminToast.settingsSaved",
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isStaff: h.isStaff,
    isAdmin: h.isStaff,
    isSuperAdmin: false,
    loading: h.authLoading,
    session: h.session,
    tenantId: h.tenantId,
    signOut: () => undefined,
  }),
}));
// Rama panelu ciągnie nawigację, motyw, liczniki klubów i ustawienia witryny -
// przedmiotem dowodu jest treść panelu, nie rama.
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children?: ReactNode }) => (
    <div data-testid="admin-shell">{children}</div>
  ),
}));
// Biblioteka mediów sięga do funkcji serwerowych i wymaga tenanta; wybór pliku
// ma własne asercje przy `MediaPickerDialog`.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));
vi.mock("@/components/atoms/PodcastPlayer", () => ({
  PodcastPlayer: () => <div data-testid="podcast-player" />,
}));
vi.mock("@/components/admin/podcasts/ApplePodcastMetaFields", () => ({
  ApplePodcastMetaFields: () => <div data-testid="apple-meta" />,
}));
vi.mock("@/components/admin/podcasts/PodcastFeedReadinessCard", () => ({
  PodcastFeedReadinessCard: () => <div data-testid="feed-readiness" />,
}));
// Radix Tabs/Switch/Select/Tooltip nie działają pod happy-dom bez pełnego
// pointer API. Atrapy oddają kontrakt (stan + wywołanie z nową wartością).
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div data-testid="tabs">{children}</div>,
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
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const state = { open: false };
  return {
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      state.open = open;
      return (
        <div data-testid="alert" data-open={String(open)}>
          {children}
        </div>
      );
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      state.open ? <div data-testid="alert-content">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" data-testid="alert-cancel">
        {children}
      </button>
    ),
    AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" data-testid="alert-confirm" onClick={onClick}>
        {children}
      </button>
    ),
  };
});
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderRoute } from "@/test/routeHarness";
import { Route as PodcastsRoute } from "@/routes/admin.podcasts";
import { Route as AdminLayoutRoute } from "@/routes/admin";

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const PATH = "/admin/podcasts";
const EPISODE_ID = "22222222-2222-4222-8222-222222222222";
const SHOW_ID = "33333333-3333-4333-8333-333333333333";

const LIST_ROW = {
  id: EPISODE_ID,
  slug: "sondaz-na-baltyku",
  title_pl: "Sondaz na Baltyku",
  title_en: "Baltic poll",
  status: "draft",
  duration_seconds: 600,
  episode_number: 1,
  season: 2,
  audio_url: "https://cdn.example.org/odc-1.mp3",
  cover_image_url: null,
  published_at: null,
  show_id: SHOW_ID,
};

const FULL_EPISODE = {
  ...LIST_ROW,
  tenant_id: h.tenantId,
  excerpt_pl: "",
  excerpt_en: "",
  show_notes_pl: "",
  show_notes_en: "",
  transcript_pl: "",
  transcript_en: "",
  author_id: null,
  category_id: null,
  chapters: [],
  quotes: [],
  resources: [],
  explicit: false,
  episode_type: "full",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const SHOW_ROW = {
  id: SHOW_ID,
  tenant_id: h.tenantId,
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
};

/** Odpowiedzi bazy dla drogi szczęśliwej panelu (lista, edytor, zapis). */
function planDatabase() {
  db().setResponse("podcasts", (chain) => {
    if (chain.has("update") || chain.has("insert")) return ok(null);
    // `maybeSingle` = odczyt jednego odcinka do edytora.
    if (chain.has("maybeSingle")) return ok(FULL_EPISODE);
    return ok([LIST_ROW]);
  });
  db().setResponse("podcast_shows", (chain) =>
    chain.has("update") || chain.has("insert") ? ok(null) : ok([SHOW_ROW]),
  );
  db().setResponse("podcast_episode_people", ok([]));
  db().setResponse("categories", ok([]));
  db().setResponse("profiles", ok([]));
  db().setResponse("podcast_settings", ok(null));
  db().setResponse("media", ok([]));
}

async function mountPanel(queryClient?: QueryClient) {
  return renderRoute({ route: PodcastsRoute, path: PATH, initialEntry: PATH, queryClient });
}

/** Klucze przekazane do `invalidateQueries`, w kolejności wywołań. */
function invalidatedKeys(spy: { mock: { calls: readonly unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

/** Ogniwa wybranej nazwy w łańcuchach tabeli - do asercji, CO poleciało. */
function callsOf(table: string, method: string): unknown[][] {
  return db()
    .chainsFor(table)
    .flatMap((chain) => chain.calls)
    .filter((call) => call.method === method)
    .map((call) => [...call.args]);
}

beforeEach(() => {
  db().reset();
  h.isStaff = true;
  h.authLoading = false;
  h.session = {};
  h.tenantId = "11111111-1111-4111-8111-111111111111";
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  planDatabase();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Dostęp
// ---------------------------------------------------------------------------

describe("dostep do panelu", () => {
  it("konto BEZ roli sztabowej nie dostaje panelu, tylko przekierowanie", async () => {
    // Bramka stoi w layoucie `/admin` - dlatego montujemy JEGO, a nie samą
    // trasę podcastów. Ukrycie pozycji w nawigacji niczego nie chroni, bo
    // adres wpisuje się z ręki.
    h.isStaff = false;
    const view = await renderRoute({
      route: AdminLayoutRoute,
      path: "/admin",
      initialEntry: "/admin",
    });
    await waitFor(() => expect(view.currentPath()).toBe("/login"));
    expect(screen.queryByTestId("admin-shell")).toBeNull();
    expect(screen.queryByText("adminPodcasts.title")).toBeNull();
  });

  it("dopoki rola sie nie rozstrzygnela, layout nie renderuje panelu", async () => {
    // Render „bez uprawnień" w trakcie ładowania roli mrugnąłby przekierowaniem
    // każdemu członkowi redakcji wchodzącemu z zimnego startu.
    h.authLoading = true;
    h.isStaff = false;
    const view = await renderRoute({
      route: AdminLayoutRoute,
      path: "/admin",
      initialEntry: "/admin",
    });
    expect(view.currentPath()).toBe("/admin");
    expect(screen.queryByTestId("admin-shell")).toBeNull();
  });

  it("KONTROLA DODATNIA: sama trasa podcastow nie ma wlasnej bramki roli", async () => {
    // To jest ZAPIS DECYZJI, nie luka: panel podcastów przepuszcza każdą rolę
    // sztabową (super_admin, admin, editor, author), bo tak działa layout.
    // Gdyby ktoś dołożył tu własną bramkę, ten test padnie i wymusi decyzję,
    // czy podcasty naprawdę mają być wąższe niż reszta panelu.
    h.isStaff = false;
    await mountPanel();
    expect(screen.getByText("adminPodcasts.title")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Przełączanie widoków
// ---------------------------------------------------------------------------

describe("przelaczanie widokow panelu", () => {
  it("startuje na liscie odcinkow i pokazuje wiersz z bazy", async () => {
    await mountPanel();
    await waitFor(() => expect(screen.getByText("Sondaz na Baltyku")).toBeTruthy());
    expect(screen.getByText("adminPodcasts.statAll")).toBeTruthy();
    expect(screen.queryByText("adminPodcasts.shows.title")).toBeNull();
  });

  it("przycisk Programy wchodzi w panel serii, a Wroc wraca na liste", async () => {
    await mountPanel();
    fireEvent.click(screen.getByText("adminPodcasts.showsBtn"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.shows.title")).toBeTruthy());
    // Lista odcinków i pasek przycisków znikają - trzy widoki wykluczają się.
    expect(screen.queryByText("adminPodcasts.statAll")).toBeNull();
    expect(screen.queryByText("adminPodcasts.showsBtn")).toBeNull();

    fireEvent.click(screen.getByText("adminPodcasts.shows.back"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.statAll")).toBeTruthy());
  });

  it("przycisk Ustawienia wchodzi w panel kanalu i wraca przyciskiem powrotu", async () => {
    await mountPanel();
    fireEvent.click(screen.getByText("adminPodcasts.settingsBtn"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.settings.title")).toBeTruthy());
    expect(screen.getByTestId("feed-readiness")).toBeTruthy();
    expect(screen.getByTestId("apple-meta")).toBeTruthy();

    fireEvent.click(screen.getByText("adminPodcasts.settings.back"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.statAll")).toBeTruthy());
  });

  it("fraza wyszukiwania PRZEZYWA wyjscie do ustawien i powrot", async () => {
    // Sedno decyzji z ekstrakcji: filtr mieszka w trasie, nie w liście.
    // Gdyby zszedł do listy, każde zajrzenie w ustawienia czyściłoby zawężenie.
    await mountPanel();
    const search = screen.getByPlaceholderText("adminPodcasts.searchPlaceholder");
    fireEvent.change(search, { target: { value: "baltyku" } });
    await waitFor(() => expect(screen.getByText("Sondaz na Baltyku")).toBeTruthy());

    fireEvent.click(screen.getByText("adminPodcasts.settingsBtn"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.settings.title")).toBeTruthy());
    fireEvent.click(screen.getByText("adminPodcasts.settings.back"));

    const restored = await waitFor(() =>
      screen.getByPlaceholderText("adminPodcasts.searchPlaceholder"),
    );
    expect((restored as HTMLInputElement).value).toBe("baltyku");
  });

  it("filtr statusu odsiewa odcinek, ktory nie pasuje", async () => {
    await mountPanel();
    await waitFor(() => expect(screen.getByText("Sondaz na Baltyku")).toBeTruthy());
    fireEvent.click(screen.getByText("adminPodcasts.filterPublished"));
    // Szkic wypada z listy, a puste miejsce dostaje komunikat o FILTRZE,
    // a nie o braku odcinków - inaczej redakcja tworzy duplikaty.
    await waitFor(() => expect(screen.queryByText("Sondaz na Baltyku")).toBeNull());
    expect(screen.getByText("adminPodcasts.emptyFiltered")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Publikacja odcinka
// ---------------------------------------------------------------------------

describe("publikacja odcinka", () => {
  it("zapisuje status opublikowany I uniewaznia trzy klucze cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountPanel(queryClient);
    // Wejście w edytor przez kliknięcie tytułu (mutacja wczytania odcinka).
    fireEvent.click(await waitFor(() => screen.getByText("Sondaz na Baltyku")));
    await waitFor(() => expect(screen.getByText("adminPodcasts.editor.editTitle")).toBeTruthy());

    // Przełącznik bierzemy po etykiecie SEKCJI, a nie po kolejności pól -
    // dodanie osiemnastego pola do edytora nie może przestawiać tego testu.
    const publishRow = screen
      .getByText("adminPodcasts.editor.publishNow")
      .closest("div.rounded-md");
    const publishSwitch = publishRow?.querySelector('[role="switch"]');
    if (!(publishSwitch instanceof HTMLElement)) {
      throw new Error("test: nie znaleziono przelacznika publikacji");
    }
    fireEvent.click(publishSwitch);

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved"));
    const updates = callsOf("podcasts", "update");
    expect(updates).toHaveLength(1);
    const payload = updates[0][0] as { status: string; published_at: string | null };
    expect(payload.status).toBe("published");
    // Publikacja bez daty domyka się bieżącą chwilą - kanał RSS bez `pubDate`
    // nie ma po czym sortować odcinków.
    expect(payload.published_at).not.toBeNull();
    expect(invalidatedKeys(spy)).toEqual([
      ["admin", "podcasts"],
      ["podcasts"],
      ["podcast-people"],
    ]);
  });

  it("brak tenanta odmawia zapisu komunikatem i NIE pisze do bazy", async () => {
    h.tenantId = null;
    await mountPanel();
    fireEvent.click(await waitFor(() => screen.getByText("Sondaz na Baltyku")));
    await waitFor(() => expect(screen.getByText("adminPodcasts.editor.editTitle")).toBeTruthy());
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminPodcasts.errors.tenant"),
    );
    expect(callsOf("podcasts", "update")).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Usuwanie
// ---------------------------------------------------------------------------

describe("usuwanie wymaga potwierdzenia", () => {
  it("Usun przy programie tylko OTWIERA pytanie - nic nie idzie do bazy", async () => {
    await mountPanel();
    fireEvent.click(screen.getByText("adminPodcasts.showsBtn"));
    await waitFor(() => expect(screen.getByText("Raport Baltycki")).toBeTruthy());
    fireEvent.click(screen.getByText("adminPodcasts.remove"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.shows.confirmTitle")).toBeTruthy());
    // To jest cała treść tego testu: soft-delete jeszcze NIE poleciał.
    expect(callsOf("podcast_shows", "update")).toEqual([]);
  });

  it("potwierdzenie kasuje program miekko i uniewaznia oba klucze", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountPanel(queryClient);
    fireEvent.click(screen.getByText("adminPodcasts.showsBtn"));
    await waitFor(() => expect(screen.getByText("Raport Baltycki")).toBeTruthy());
    fireEvent.click(screen.getByText("adminPodcasts.remove"));
    await waitFor(() => expect(screen.getByTestId("alert-content")).toBeTruthy());

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByTestId("alert-confirm"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.deleted"));
    const updates = callsOf("podcast_shows", "update");
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0][0] as Record<string, unknown>)).toEqual(["deleted_at"]);
    expect(callsOf("podcast_shows", "eq")).toEqual([["id", SHOW_ID]]);
    expect(invalidatedKeys(spy)).toEqual([
      ["admin", "podcast-shows"],
      ["podcast-shows"],
    ]);
  });

  it("Usun przy odcinku takze najpierw pyta, a potwierdzenie kasuje miekko", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountPanel(queryClient);
    await waitFor(() => expect(screen.getByText("Sondaz na Baltyku")).toBeTruthy());
    fireEvent.click(screen.getAllByText("adminPodcasts.remove")[0]);
    await waitFor(() =>
      expect(screen.getByText("adminPodcasts.confirmEpisodeTitle")).toBeTruthy(),
    );
    expect(callsOf("podcasts", "update")).toEqual([]);

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByTestId("alert-confirm"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.deleted"));
    expect(Object.keys(callsOf("podcasts", "update")[0][0] as Record<string, unknown>)).toEqual([
      "deleted_at",
    ]);
    // Soft-delete odcinka unieważnia TYLKO listę panelu - tak było przed
    // ekstrakcją i tak zostaje (strona publiczna czyta po statusie).
    expect(invalidatedKeys(spy)).toEqual([["admin", "podcasts"]]);
  });
});

// ---------------------------------------------------------------------------
// Powłoka: trasa nie zna bazy
// ---------------------------------------------------------------------------

describe("powloka trasy", () => {
  it("plik trasy NIE importuje klienta supabase (warstwa danych jest w lib)", async () => {
    // Regresja architektury: to jedno zdanie pilnuje, żeby 2072 linie zapytań
    // nie wróciły do trasy przy najbliższej „szybkiej poprawce".
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/routes/admin.podcasts.tsx", "utf8");
    expect(source).not.toContain("@/integrations/supabase/client");
    expect(source).toContain("@/lib/podcast/queries");
    // Powłoka ma zostać powłoką - próg wielkości zamiast dobrych intencji.
    expect(source.split("\n").length).toBeLessThan(400);
  });
});
