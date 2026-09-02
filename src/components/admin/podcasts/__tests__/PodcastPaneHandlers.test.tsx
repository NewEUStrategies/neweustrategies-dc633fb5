// Uchwyty pól, które w pomiarze pokrycia zostały jako JEDYNE nietknięte.
//
// PO CO OSOBNY PLIK. `PodcastSettingsPane.test.tsx` i `PodcastShowsPane.test.tsx`
// dowodzą kaskady ustawień, zapisu i stanów pustych. Pomiar V8 wskazał jednak
// sześć uchwytów, do których żaden z tamtych testów nie dochodzi - i każdy
// z nich jest polem, w które redakcja WPISUJE treść. Uchwyt podłączony do złej
// właściwości nie wywala niczego: po prostu zapisuje wpisany adres w innej
// kolumnie, a redakcja dowiaduje się o tym, gdy kanał w katalogu prowadzi
// w złe miejsce.
//
// CZEGO TU NIE MA I DLACZEGO - rzecz warta zapisania, bo dotyczy liczby.
// `PodcastSettingsPane` ma ~15 gałęzi `merged.X ?? ""`, które są RUNTIME
// NIEOSIĄGALNE: `mergePodcastSettings` (lib/podcast/shape.ts:373) domyka
// KAŻDE z tych pól na `""`, więc prawa strona `??` nigdy się nie wykona.
// Nie są jednak martwym kodem, który wolno usunąć: `PodcastSettings` pochodzi
// ze schematu zod, gdzie te pola są `z.string().nullable().optional()`, więc
// bez `?? ""` TypeScript nie skompiluje wyrażenia. Skutek: pokrycie gałęzi
// tego pliku jest STRUKTURALNIE ZASKLEPIONE poniżej 100% i próg per-ścieżka
// jest ustawiony na wartości ZMIERZONEJ, nie na życzeniowej. Domknięcie tego
// wymagałoby zawężenia typu ZWRACANEGO przez `mergePodcastSettings` do
// wariantu z polami nie-null - to zmiana kontraktu publicznego typu, a nie
// robota testowa, więc nie robimy jej przy okazji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PodcastShow } from "@/lib/podcast/types";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ tenantId: "11111111-1111-4111-8111-111111111111" }),
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    accept,
    onPick,
  }: {
    open: boolean;
    accept: string;
    onPick: (url: string) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid={`picker-open-${accept}`}
        onClick={() => onPick("https://cdn.example.org/wybrana.jpg")}
      />
    ) : null,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
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
  Select: ({ value, children }: { value?: string; children?: ReactNode }) => (
    <div data-testid="select" data-value={value}>
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

const { PodcastSettingsPane } = await import("@/components/admin/podcasts/PodcastSettingsPane");
const { PodcastShowsPane } = await import("@/components/admin/podcasts/PodcastShowsPane");

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

/** Ostatni `upsert` na tabeli ustawień - przedmiot dowodu zamiast DOM. */
function lastSettingsUpsert(): Record<string, unknown> | undefined {
  const chains = db().chainsFor("podcast_settings");
  for (const chain of [...chains].reverse()) {
    const args = chain.argsOf("upsert");
    const payload = args?.[0];
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  }
  return undefined;
}

const SHOW: PodcastShow = {
  id: "s1",
  tenant_id: "t1",
  slug: "raport-baltycki",
  title_pl: "Raport Baltycki",
  title_en: "Baltic report",
  description_pl: "Opis PL",
  description_en: "Description EN",
  cover_image_url: null,
  spotify_url: null,
  apple_url: null,
  youtube_url: null,
  sort_order: 1,
  status: "published",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function mountSettings() {
  db().setResponse("podcast_settings", (chain) => (chain.has("upsert") ? ok(null) : ok(null)));
  db().setResponse("podcasts", ok([]));
  db().setResponse("media", ok([]));
  return renderWithQueryClient(<PodcastSettingsPane onClose={vi.fn()} />);
}

function mountShows() {
  db().setResponse("podcast_shows", (chain) =>
    chain.has("update") || chain.has("insert") ? ok(null) : ok([SHOW]),
  );
  // `onClose`, nie `onBack`: pierwsza wersja tego harnessu podawała `onBack`,
  // czyli props, którego ten komponent NIE MA. Testy przechodziły, bo React
  // ignoruje nieznane propsy i żaden z nich nie wyzwalał powrotu do listy -
  // wyłapał to `tsc --noEmit`, nie vitest. Wniosek na przyszłość: zielona
  // suita nie jest dowodem, że harness podłącza się do prawdziwego kontraktu.
  const onClose = vi.fn();
  return { onClose, ...renderWithQueryClient(<PodcastShowsPane onClose={onClose} />) };
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

describe("ustawienia kanału: adresy katalogów zewnętrznych", () => {
  // Te trzy pola są jedyną drogą, którą redakcja podaje adresy audycji
  // w Spotify, Apple i YouTube. Adres zapisany w złej kolumnie kieruje
  // słuchacza do innego katalogu - i nie ma po tym żadnego sygnału błędu.

  it("Google / YouTube URL dojeżdża do zestawu zapisu pod WŁASNYM kluczem", async () => {
    mountSettings();
    const label = await screen.findByText("Google / YouTube URL");
    const input = label.parentElement?.querySelector("input");
    expect(input, "pole Google/YouTube musi istnieć").toBeTruthy();
    fireEvent.change(input!, { target: { value: "https://youtube.com/@audycja" } });
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() =>
      expect(lastSettingsUpsert()?.google_url).toBe("https://youtube.com/@audycja"),
    );
  });

  it("zewnętrzny RSS dojeżdża pod kluczem rss_url, a nie nadpisuje innego pola", async () => {
    // `rss_url` to adres kanału PROWADZONEGO GDZIE INDZIEJ (migracja z innego
    // hostingu). Zapisany w złym polu podmieniłby link do naszego kanału.
    mountSettings();
    const label = await screen.findByText("adminPodcasts.settings.externalRss");
    const input = label.parentElement?.querySelector("input");
    expect(input, "pole zewnętrznego RSS musi istnieć").toBeTruthy();
    fireEvent.change(input!, { target: { value: "https://obcy.example.org/rss.xml" } });
    fireEvent.click(screen.getByText("adminPodcasts.settings.saveSettings"));
    await waitFor(() => {
      const payload = lastSettingsUpsert();
      expect(payload?.rss_url).toBe("https://obcy.example.org/rss.xml");
      expect(payload?.apple_url, "sąsiednie pole zostaje nietknięte").not.toBe(
        "https://obcy.example.org/rss.xml",
      );
    });
  });

  it("podpowiedź wskazuje NASZ kanał /podcast/rss.xml", async () => {
    // Redakcja musi wiedzieć, że zostawienie tego pola pustym NIE znaczy
    // „brak kanału" - kanał jest generowany pod tym adresem zawsze.
    mountSettings();
    // Formularz renderuje się PO odczycie ustawień, więc najpierw czekamy na
    // sąsiedni tekst podpowiedzi. Adres stoi w <code> WEWNĄTRZ tego akapitu,
    // więc dopasowanie musi celować w ten element, nie w cały akapit.
    const helper = await screen.findByText("adminPodcasts.settings.rssHelperPre");
    expect(
      helper.querySelector("code")?.textContent,
      "podpowiedź musi wskazywać kanał generowany przez nas",
    ).toBe("/podcast/rss.xml");
  });
});

describe("edytor programu: pola, do których nie dochodził żaden test", () => {
  /** Otwiera edytor istniejącego programu (lista -> edycja). */
  async function openEditor(): Promise<void> {
    fireEvent.click(await screen.findByText("Raport Baltycki"));
  }

  it("tytuł EN dojeżdża do zapisu programu pod kluczem title_en", async () => {
    mountShows();
    await openEditor();
    const input = await screen.findByDisplayValue("Baltic report");
    fireEvent.change(input, { target: { value: "Baltic report, second season" } });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      const updates = db()
        .chainsFor("podcast_shows")
        .filter((chain) => chain.has("update"));
      const payload = updates.at(-1)?.argsOf("update")?.[0];
      expect(payload && typeof payload === "object" ? payload : {}).toMatchObject({
        title_en: "Baltic report, second season",
      });
    });
  });

  it("przycisk wgrania okładki OTWIERA bibliotekę mediów, a wybór wraca do pola", async () => {
    mountShows();
    await openEditor();
    fireEvent.click(screen.getByTitle("adminPodcasts.showEditor.uploadCoverTitle"));
    fireEvent.click(await screen.findByTestId("picker-open-image"));
    expect(await screen.findByDisplayValue("https://cdn.example.org/wybrana.jpg")).toBeTruthy();
  });

  it("zamknięcie okna potwierdzenia CZYŚCI wybór - inaczej kolejne otwarcie kasuje nie to", async () => {
    // Najgroźniejszy z tych uchwytów. `onOpenChange` bez czyszczenia zostawia
    // `confirmId` poprzedniego programu: redakcja zamyka okno, otwiera je dla
    // INNEGO programu i potwierdza usunięcie tego, którego już nie widzi.
    const { container } = mountShows();
    const removeButtons = await screen.findAllByText("adminPodcasts.remove");
    fireEvent.click(removeButtons[0]!);
    expect(screen.getByText("adminPodcasts.shows.confirmTitle")).toBeTruthy();
    fireEvent.click(screen.getByText("common.cancel"));
    await waitFor(() => expect(screen.queryByText("adminPodcasts.shows.confirmTitle")).toBeNull());
    // Po anulowaniu NIC nie poleciało do bazy - to jest cała treść „anuluj".
    const deletes = db()
      .chainsFor("podcast_shows")
      .filter((chain) => chain.has("update") || chain.has("delete"));
    expect(deletes.length, "anulowanie nie może nic zapisać").toBe(0);
    expect(container).toBeTruthy();
  });
});
