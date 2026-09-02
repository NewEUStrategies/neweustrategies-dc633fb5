// Panel ustawień kanału podcastowego: guard odczytu, kaskada pól, upsert.
//
// CO DOWODZI TEN PLIK. Ustawienia kanału są SINGLETONEM per tenant, a zapis
// jest upsertem - czyli nadpisuje wiersz w całości i nie ma cofnięcia:
//   * formularz wyrenderowany PRZED odczytem pokazuje wartości domyślne
//     i zaprasza redakcję do zapisania ich na wierzch metadanych, których
//     panel jeszcze nie przeczytał (kanał traci autora i właściciela);
//   * pole, które nie dojeżdża do payloadu, wraca do poprzedniej wartości
//     przy pierwszym odświeżeniu - a redakcja zdąży zgłosić kanał do Apple;
//   * łatka z sekcji Apple wpisana do złej kolumny (`itunes_author` kontra
//     `itunes_owner_name`) przechodzi walidację Apple i wraca odrzuceniem
//     po tygodniu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: kaskady i payloadu (`shape.test.ts`), upsertu
// i kluczy inwalidacji (`queries.test.ts`), treści karty gotowości
// (`PodcastFeedReadinessCard` i `podcastFeedReadiness` mają własne testy).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PodcastFeedReadiness } from "@/lib/seo/podcastFeedReadiness";

const h = vi.hoisted(() => ({
  tenantId: "11111111-1111-4111-8111-111111111111" as string | null,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  /** Ostatnia gotowość feedu przekazana do karty - dowód, że karta ją dostaje. */
  readiness: null as PodcastFeedReadiness | null,
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { settingsSaved: () => "adminToast.settingsSaved" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.tenantId }) }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));
// Karta gotowości ma własne testy; tutaj interesuje nas WYŁĄCZNIE to, że
// dostaje policzoną gotowość, a nie jak ją rysuje.
vi.mock("@/components/admin/podcasts/PodcastFeedReadinessCard", () => ({
  PodcastFeedReadinessCard: ({ readiness }: { readiness: PodcastFeedReadiness }) => {
    h.readiness = readiness;
    return <div data-testid="feed-readiness" />;
  },
}));
// Sekcja Apple to osiemnaście pól z własnymi testami - tu podstawiamy jeden
// przycisk, który udaje zmianę autora, żeby sprawdzić PODŁĄCZENIE łatki.
vi.mock("@/components/admin/podcasts/ApplePodcastMetaFields", () => ({
  ApplePodcastMetaFields: ({
    value,
    onChange,
  }: {
    value: { author: string; ownerEmail: string };
    onChange: (patch: { author?: string; ownerEmail?: string }) => void;
  }) => (
    <div data-testid="apple-meta" data-author={value.author} data-owner-email={value.ownerEmail}>
      <button
        type="button"
        data-testid="apple-set-author"
        onClick={() => onChange({ author: "Redakcja NES" })}
      />
      <button
        type="button"
        data-testid="apple-set-owner-email"
        onClick={() => onChange({ ownerEmail: "kanal@example.org" })}
      />
    </div>
  ),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const { PodcastSettingsPane } = await import("@/components/admin/podcasts/PodcastSettingsPane");

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const SAVED_ROW = {
  tenant_id: h.tenantId,
  default_player_variant: "mini",
  autoplay_next: false,
  show_speed_control: true,
  spotify_url: "https://open.spotify.example.org/show/1",
  apple_url: null,
  google_url: null,
  rss_url: null,
  itunes_author: "Stara redakcja",
  itunes_owner_name: "Wlasciciel",
  itunes_owner_email: "stary@example.org",
  itunes_category: "News",
  itunes_subcategory: "Politics",
  itunes_explicit: false,
  itunes_type: "episodic",
  itunes_image_url: "https://cdn.example.org/cover.png",
  itunes_copyright: "(c) 2026",
};

function callsOf(table: string, method: string): unknown[][] {
  return db()
    .chainsFor(table)
    .flatMap((chain) => chain.calls)
    .filter((call) => call.method === method)
    .map((call) => [...call.args]);
}

/** Ostatni payload upsertu ustawień. */
function lastPayload(): Record<string, unknown> | undefined {
  const upserts = callsOf("podcast_settings", "upsert");
  return upserts.at(-1)?.[0] as Record<string, unknown> | undefined;
}

function mount(row: Record<string, unknown> | null, episodes: unknown[] = []) {
  db().setResponse("podcast_settings", (chain) => (chain.has("upsert") ? ok(null) : ok(row)));
  db().setResponse("podcasts", ok(episodes));
  db().setResponse("media", ok([]));
  const onClose = vi.fn();
  return { onClose, ...renderWithQueryClient(<PodcastSettingsPane onClose={onClose} />) };
}

beforeEach(() => {
  db().reset();
  h.tenantId = "11111111-1111-4111-8111-111111111111";
  h.readiness = null;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("guard odczytu", () => {
  it("dopoki odczyt trwa, NIE MA formularza ani przycisku zapisu", () => {
    // Sedno: upsert nadpisuje cały wiersz, więc formularz przed odczytem to
    // zaproszenie do zapisania domyślnych na wierzch metadanych kanału.
    mount(SAVED_ROW);
    expect(screen.getByText("adminPodcasts.settings.loading")).toBeTruthy();
    expect(screen.queryByText("adminPodcasts.settings.saveSettings")).toBeNull();
  });

  it("po odczycie formularz pokazuje ZAPISANE wartosci, nie domyslne", async () => {
    mount(SAVED_ROW);
    expect(await screen.findByText("adminPodcasts.settings.title")).toBeTruthy();
    expect(screen.getByDisplayValue("https://open.spotify.example.org/show/1")).toBeTruthy();
    expect(screen.getByTestId("apple-meta").getAttribute("data-author")).toBe("Stara redakcja");
  });

  it("brak wiersza (tenant bez ustawien) daje formularz na wartosciach domyslnych", async () => {
    mount(null);
    expect(await screen.findByText("adminPodcasts.settings.title")).toBeTruthy();
    expect(screen.getByTestId("apple-meta").getAttribute("data-author")).toBe("");
  });
});

describe("karta gotowosci feedu", () => {
  it("dostaje gotowosc policzona z ustawien I z liczby odcinkow", async () => {
    mount(SAVED_ROW, [{ audio_url: "https://cdn.example.org/a.mp3", duration_seconds: 600 }]);
    await screen.findByTestId("feed-readiness");
    await waitFor(() => expect(h.readiness?.blocking).not.toContain("episodes"));
    expect(h.readiness?.blocking).toEqual([]);
  });

  it("kanal bez odcinkow i bez e-maila wlasciciela jest ZABLOKOWANY", async () => {
    mount({ ...SAVED_ROW, itunes_owner_email: "" }, []);
    await screen.findByTestId("feed-readiness");
    await waitFor(() => expect(h.readiness?.blocking).toContain("episodes"));
    expect(h.readiness?.blocking).toContain("ownerEmail");
    expect(h.readiness?.ready).toBe(false);
  });
});

describe("zapis ustawien", () => {
  it("wariant odtwarzacza, przelacznik i adres dojezdzaja do payloadu", async () => {
    const { queryClient } = mount(SAVED_ROW);
    await screen.findByText("adminPodcasts.settings.title");
    fireEvent.click(screen.getByText("adminPodcasts.settings.variantSticky"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByPlaceholderText("https://podcasts.apple.com/…"), {
      target: { value: "https://podcasts.example.org/kanal" },
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.settingsSaved"));
    expect(lastPayload()).toMatchObject({
      tenant_id: h.tenantId,
      default_player_variant: "sticky",
      // Przełącznik był włączony w bazie - kliknięcie ma go WYŁĄCZYĆ, a nie
      // zgubić się w kaskadzie (`||` zjadłby fałsz).
      show_speed_control: false,
      apple_url: "https://podcasts.example.org/kanal",
      // Pola nietknięte zachowują zapisane wartości.
      itunes_author: "Stara redakcja",
    });
    expect(spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey)).toEqual([
      ["admin", "podcast-settings"],
      ["podcast-settings"],
    ]);
  });

  it("latka z sekcji Apple wpisuje sie do WLASCIWYCH kolumn itunes_*", async () => {
    mount(SAVED_ROW);
    await screen.findByText("adminPodcasts.settings.title");
    fireEvent.click(screen.getByTestId("apple-set-author"));
    fireEvent.click(screen.getByTestId("apple-set-owner-email"));
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.settingsSaved"));
    expect(lastPayload()).toMatchObject({
      itunes_author: "Redakcja NES",
      itunes_owner_email: "kanal@example.org",
      // Nazwa właściciela NIE mogła się zmienić - to inna kolumna.
      itunes_owner_name: "Wlasciciel",
    });
  });

  it("pusty adres platformy idzie jako NULL, nie jako pusty ciag", async () => {
    mount(SAVED_ROW);
    await screen.findByText("adminPodcasts.settings.title");
    fireEvent.change(screen.getByDisplayValue("https://open.spotify.example.org/show/1"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.settingsSaved"));
    expect(lastPayload()?.spotify_url).toBeNull();
  });

  it("udany zapis ZAMYKA panel, zeby nie zapisac drugi raz tego samego", async () => {
    const { onClose } = mount(SAVED_ROW);
    await screen.findByText("adminPodcasts.settings.title");
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("brak tenanta odmawia zapisu komunikatem i NIE puka do bazy", async () => {
    h.tenantId = null;
    const { onClose } = mount(SAVED_ROW);
    await screen.findByText("adminPodcasts.settings.title");
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPodcasts.errors.tenant"));
    expect(callsOf("podcast_settings", "upsert")).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Anuluj oraz przycisk powrotu zamykaja panel bez zapisu", async () => {
    const { onClose } = mount(SAVED_ROW);
    await screen.findByText("adminPodcasts.settings.title");
    fireEvent.click(screen.getByText("common.cancel"));
    fireEvent.click(screen.getByText("adminPodcasts.settings.back"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(callsOf("podcast_settings", "upsert")).toEqual([]);
  });
});
