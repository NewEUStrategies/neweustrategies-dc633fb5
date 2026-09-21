// Panel programów (serii) podcastowych: lista, formularz, zapis.
//
// CO DOWODZI TEN PLIK. Program jest pojemnikiem na odcinki i na metadane
// kanału, więc jego formularz decyduje o tym, co widzi czytelnik katalogu:
//   * pole, które nie dojeżdża do payloadu, to zmiana wpisana i „zapisana",
//     której po odświeżeniu nie ma (redakcja wpisuje ją drugi raz);
//   * `sort_order` nowego programu poza końcem listy wrzuca świeżą serię
//     w środek katalogu;
//   * kolejność zakładek językowych bez odseparowanych pól PL/EN zapisuje
//     polski opis w kolumnie angielskiej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: kształtu payloadu (`shape.test.ts`), kontraktu
// zapytań i kluczy inwalidacji (`queries.test.ts`) ani ścieżki potwierdzenia
// usunięcia (`routes/__tests__/adminPodcastsRoute.test.tsx` przechodzi ją
// przez całą powłokę panelu).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  tenantId: "11111111-1111-4111-8111-111111111111" as string | null,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { saved: () => "adminToast.saved", deleted: () => "adminToast.deleted" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.tenantId }) }));
// Biblioteka mediów ma własne testy; tu jeden przycisk oddający adres -
// sprawdzamy PODŁĄCZENIE `onPick`, nie okno wyboru.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ onPick }: { onPick: (url: string) => void }) => (
    <button
      type="button"
      data-testid="media-pick"
      onClick={() => onPick("https://cdn.example.org/okladka.png")}
    />
  ),
}));
// Radix Tabs nie działa pod happy-dom bez pointer API; przedmiotem dowodu jest
// zawartość zakładek, nie mechanika biblioteki - dlatego oba panele są w DOM.
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
vi.mock("@/components/ui/alert-dialog", () => {
  const state = { open: false };
  return {
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      state.open = open;
      return <div data-testid="alert">{children}</div>;
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      state.open ? <div data-testid="alert-content">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button">{children}</button>
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
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const { PodcastShowsPane } = await import("@/components/admin/podcasts/PodcastShowsPane");

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const SHOW = {
  id: "s1",
  tenant_id: h.tenantId,
  slug: "raport-baltycki",
  title_pl: "Raport Baltycki",
  title_en: "Baltic report",
  description_pl: "Opis PL",
  description_en: "Description EN",
  cover_image_url: null,
  spotify_url: null,
  apple_url: null,
  youtube_url: null,
  sort_order: 3,
  status: "published",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

/** Ogniwa wybranej nazwy we wszystkich łańcuchach tabeli. */
function callsOf(table: string, method: string): unknown[][] {
  return db()
    .chainsFor(table)
    .flatMap((chain) => chain.calls)
    .filter((call) => call.method === method)
    .map((call) => [...call.args]);
}

function mount(rows: unknown[]) {
  db().setResponse("podcast_shows", (chain) =>
    chain.has("update") || chain.has("insert") ? ok(null) : ok(rows),
  );
  const onClose = vi.fn();
  return { onClose, ...renderWithQueryClient(<PodcastShowsPane onClose={onClose} />) };
}

beforeEach(() => {
  db().reset();
  h.tenantId = "11111111-1111-4111-8111-111111111111";
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("lista programow", () => {
  it("pusta lista pokazuje komunikat, a nie pusty pojemnik", async () => {
    mount([]);
    expect(await screen.findByText("adminPodcasts.shows.empty")).toBeTruthy();
  });

  it("pokazuje program z bazy razem z plakietka statusu", async () => {
    mount([SHOW]);
    expect(await screen.findByText("Raport Baltycki")).toBeTruthy();
    expect(screen.getByText("raport-baltycki")).toBeTruthy();
    expect(screen.getByText("adminPodcasts.status.published")).toBeTruthy();
  });

  it("przycisk powrotu oddaje sterowanie powloce panelu", async () => {
    const { onClose } = mount([SHOW]);
    fireEvent.click(await screen.findByText("adminPodcasts.shows.back"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("formularz nowego programu", () => {
  it("wchodzi z tytulem domyslnym i kolejnoscia NA KONCU listy", async () => {
    mount([SHOW]);
    // Czekamy na WCZYTANA liste: `sort_order` liczy się z jej długości, więc
    // to jest jedyny moment, w którym ta asercja cokolwiek znaczy.
    await screen.findByText("Raport Baltycki");
    fireEvent.click(screen.getByText("adminPodcasts.shows.newShow"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.showEditor.newTitle")).toBeTruthy());
    // Jeden program w bazie -> nowy dostaje `sort_order` 2, czyli za nim.
    expect(screen.getByDisplayValue("2")).toBeTruthy();
    expect(screen.getByDisplayValue("Nowy program")).toBeTruthy();
  });

  it("zapis nowego programu wysyla INSERT z tenantem i wraca na liste", async () => {
    const { queryClient } = mount([]);
    fireEvent.click(await screen.findByText("adminPodcasts.shows.newShow"));
    await waitFor(() => expect(screen.getByText("common.save")).toBeTruthy());
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved"));
    const inserts = callsOf("podcast_shows", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toMatchObject({
      tenant_id: h.tenantId,
      slug: "nowy-program",
      sort_order: 1,
      status: "draft",
    });
    expect(spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey)).toEqual([
      ["admin", "podcast-shows"],
      ["podcast-shows"],
    ]);
    // Po zapisie formularz się zamyka - inaczej redakcja zapisuje drugi raz
    // ten sam program i dostaje duplikat sluga.
    await waitFor(() => expect(screen.getByText("adminPodcasts.shows.title")).toBeTruthy());
  });

  it("nowy program bez tenanta jest odrzucany komunikatem, bez zapytania", async () => {
    h.tenantId = null;
    mount([]);
    fireEvent.click(await screen.findByText("adminPodcasts.shows.newShow"));
    await waitFor(() => expect(screen.getByText("common.save")).toBeTruthy());
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPodcasts.errors.tenant"));
    expect(callsOf("podcast_shows", "insert")).toEqual([]);
  });
});

describe("formularz istniejacego programu", () => {
  it("otwiera sie na wartosciach z bazy, z rozdzielonymi polami PL i EN", async () => {
    mount([SHOW]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() =>
      expect(screen.getByText("adminPodcasts.showEditor.editTitle")).toBeTruthy(),
    );
    expect(screen.getByDisplayValue("raport-baltycki")).toBeTruthy();
    expect(screen.getByDisplayValue("Raport Baltycki")).toBeTruthy();
    expect(screen.getByDisplayValue("Baltic report")).toBeTruthy();
    expect(screen.getByDisplayValue("Opis PL")).toBeTruthy();
    expect(screen.getByDisplayValue("Description EN")).toBeTruthy();
  });

  it("KAZDE zmienione pole dojezdza do payloadu UPDATE", async () => {
    mount([SHOW]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() => expect(screen.getByText("common.save")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("Raport Baltycki"), {
      target: { value: "Raport Baltycki 2" },
    });
    fireEvent.change(screen.getByDisplayValue("Description EN"), {
      target: { value: "Second season" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://open.spotify.com/show/…"), {
      target: { value: "https://open.spotify.example.org/show/9" },
    });
    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "archived" } });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved"));
    const [[payload]] = callsOf("podcast_shows", "update");
    expect(payload).toMatchObject({
      title_pl: "Raport Baltycki 2",
      description_en: "Second season",
      spotify_url: "https://open.spotify.example.org/show/9",
      sort_order: 5,
      status: "archived",
      // Slug NIE regeneruje się z nowego tytułu, dopóki pole sluga jest
      // wypełnione - inaczej edycja tytułu zmieniałaby publiczny adres serii.
      slug: "raport-baltycki",
    });
    expect(callsOf("podcast_shows", "eq")).toEqual([["id", "s1"]]);
  });

  it("edycja istniejacego programu NIE wymaga tenanta (asymetria zamierzona)", async () => {
    // Odcinek wymaga tenanta zawsze, program tylko przy tworzeniu - RLS
    // przepuszcza tę edycję, więc panel nie ma jej blokować.
    h.tenantId = null;
    mount([SHOW]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() => expect(screen.getByText("common.save")).toBeTruthy());
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved"));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("program bez tytulu i bez sluga jest odrzucany PRZED zapytaniem", async () => {
    mount([SHOW]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() => expect(screen.getByText("common.save")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("raport-baltycki"), { target: { value: "" } });
    fireEvent.change(screen.getByDisplayValue("Raport Baltycki"), { target: { value: "" } });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPodcasts.errors.slug"));
    expect(callsOf("podcast_shows", "update")).toEqual([]);
  });

  it("Anuluj wraca na liste bez zapisu", async () => {
    mount([SHOW]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() => expect(screen.getByText("common.cancel")).toBeTruthy());
    fireEvent.click(screen.getByText("common.cancel"));
    await waitFor(() => expect(screen.getByText("adminPodcasts.shows.title")).toBeTruthy());
    expect(callsOf("podcast_shows", "update")).toEqual([]);
  });
});

describe("okladka i adresy platform", () => {
  it("wybor okladki z biblioteki wpisuje adres do payloadu", async () => {
    mount([SHOW]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() => expect(screen.getByTestId("media-pick")).toBeTruthy());
    fireEvent.click(screen.getByTestId("media-pick"));
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved"));
    const [[payload]] = callsOf("podcast_shows", "update");
    expect(payload).toMatchObject({ cover_image_url: "https://cdn.example.org/okladka.png" });
  });

  it("wyczyszczona okladka idzie jako NULL, a Apple i YouTube dojezdzaja", async () => {
    mount([{ ...SHOW, cover_image_url: "https://cdn.example.org/stara.png" }]);
    fireEvent.click(await screen.findByText("Raport Baltycki"));
    await waitFor(() => expect(screen.getByText("common.save")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("https://cdn.example.org/stara.png"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://podcasts.apple.com/…"), {
      target: { value: "https://podcasts.example.org/seria" },
    });
    const youtube = screen
      .getAllByRole("textbox")
      .find((field) => field.getAttribute("value") === null && !field.getAttribute("placeholder"));
    if (youtube) fireEvent.change(youtube, { target: { value: "https://youtube.example.org/c" } });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved"));
    const [[payload]] = callsOf("podcast_shows", "update");
    expect(payload).toMatchObject({
      cover_image_url: null,
      apple_url: "https://podcasts.example.org/seria",
    });
  });

  it("potwierdzenie usuniecia programu kasuje go miekko", async () => {
    // Ścieżka przez całą powłokę panelu ma własny test; tutaj chodzi o to,
    // że sam komponent listy podłącza potwierdzenie do soft-delete.
    mount([SHOW]);
    fireEvent.click(await screen.findByText("adminPodcasts.remove"));
    await waitFor(() => expect(screen.getByTestId("alert-content")).toBeTruthy());
    fireEvent.click(screen.getByTestId("alert-confirm"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.deleted"));
    expect(
      Object.keys(callsOf("podcast_shows", "update")[0][0] as Record<string, unknown>),
    ).toEqual(["deleted_at"]);
  });
});
