// Trasa `/network/mutual/$userId` ZAMONTOWANA - lista wspólnych kontaktów.
//
// STAN WYJŚCIOWY: 24 wiersze instrukcji na ZERZE. Ta trasa jest celem
// podpowiedzi „N wspólnych kontaktów" z profilu, więc jej pustka w dowodzie
// znaczyła, że rozjazd między LICZBĄ a LISTĄ nie miał gdzie się zapalić.
//
// CZEGO TEN PLIK DOWODZI.
//
//   1. STRONICOWANIE ISTNIEJE PO STRONIE KLIENTA. `p_limit: 100, p_offset: 0`
//      było wpisane na sztywno, a nagłówek i tak pokazywał `total_count`
//      z wiersza: przy 150 wspólnych kontaktach strona pisała "150" i
//      wyświetlała 100, bez śladu obcięcia. RPC obsługuje `p_offset` i klamruje
//      limit do 100, więc brakowało WYŁĄCZNIE strony klienta.
//   2. LICZBA W NAGŁÓWKU I DŁUGOŚĆ LISTY TO JEDNO TWIERDZENIE. Dopóki są
//      strony do dociągnięcia, użytkownik ma kontrolkę; gdy ich nie ma,
//      kontrolka znika (a nie wisi nieaktywna).
//   3. KAŻDY WIERSZ TEJ LISTY JEST MOIM KONTAKTEM 1. STOPNIA - to właśnie czyni
//      z niej listę REALNYCH DRÓG, a nie katalog osób. Stąd `DegreeBadge`
//      z jedynką i stan relacji `connected` podany przyciskowi wiadomości.
//   4. TRASA JEST `noindex` I NIE RENDERUJE SIĘ BEZ SESJI - to lista powiązań
//      między konkretnymi ludźmi.
//   5. STANY PUSTY / ŁADOWANIA / BŁĘDU SĄ ROZRÓŻNIALNE. „Brak wspólnych
//      kontaktów" i „nie udało się wczytać" to dla użytkownika dwa różne fakty.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: reguł odsiewu `mutual_connections`
// (`tenant_id`, `discoverable`) - te mają pgTAP (`connection_degree_test.sql`),
// a atrapa RPC nie odtwarza polityk bazy, tylko argumenty wywołania.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { NETWORK_IDS, PEER_NAME } from "@/test/network/fixtures";

interface MutualRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  slug: string | null;
  verified: boolean;
  total_count: number;
}

const h = vi.hoisted(() => ({
  // Wartość startowa musi być LITERAŁEM: `vi.hoisted` wykonuje się PRZED
  // importami, więc stała z `@/test/network/fixtures` jeszcze tu nie istnieje.
  // `beforeEach` nadpisuje to identyfikatorem ze wspólnych stałych.
  user: { id: "user-me" } as { id: string } | null,
  target: null as Record<string, unknown> | null,
  /** Odpowiedź RPC per offset - dowód, że klient o ten offset w ogóle prosi. */
  pages: new Map<number, MutualRow[]>(),
  rpcCalls: [] as Array<Record<string, unknown> | undefined>,
  rpcFails: false,
  rpcPending: false,
  connectionStates: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));

vi.mock("@/hooks/useAuth", () => {
  const session = {};
  const auth = {
    get user() {
      return h.user;
    },
    get session() {
      return h.user ? session : null;
    },
    loading: false,
  };
  return { useAuth: () => auth };
});

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => new Set<string>() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: h.target, error: null }),
        }),
      }),
    }),
    rpc: (_fn: string, args?: Record<string, unknown>) => {
      h.rpcCalls.push(args);
      if (h.rpcPending) return new Promise(() => undefined);
      if (h.rpcFails) return Promise.resolve({ data: null, error: new Error("rpc down") });
      const offset = Number(args?.["p_offset"] ?? 0);
      return Promise.resolve({ data: h.pages.get(offset) ?? [], error: null });
    },
  },
}));

// Przycisk wiadomości: atrapa zapisuje STAN, jaki podała mu trasa (reguła 3).
vi.mock("@/components/network/DirectMessageButton", () => ({
  DirectMessageButton: ({
    userId,
    connectionState,
  }: {
    userId: string;
    connectionState?: Record<string, unknown>;
  }) => {
    if (connectionState) h.connectionStates.push({ userId, ...connectionState });
    return <button type="button" data-dm={userId} />;
  },
}));
vi.mock("@/components/network/organisms/NetworkDistance", () => ({
  NetworkDistance: () => <div data-testid="network-distance" />,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { renderRoute, routeHead } from "@/test/routeHarness";
import { Route as MutualRoute } from "@/routes/network.mutual.$userId";

const TARGET_ID = NETWORK_IDS.peer;
const PAGE_SIZE = 48;

// Mosty HURTOWE mają identyfikatory wyprowadzone z indeksu (stronicowanie
// potrzebuje ich 48+), a tożsamości POJEDYNCZE - ja i osoba docelowa - biorą
// się ze wspólnych stałych `NETWORK_IDS`.
function mutualRow(i: number, total: number): MutualRow {
  return {
    user_id: `bridge-${i}`,
    display_name: `Most ${i}`,
    avatar_url: null,
    job_title: "Analityk",
    current_company: "NES",
    location: "Warszawa",
    slug: `most-${i}`,
    verified: false,
    total_count: total,
  };
}

function page(offset: number, size: number, total: number): MutualRow[] {
  return Array.from({ length: size }, (_, i) => mutualRow(offset + i, total));
}

async function mount() {
  return renderRoute({
    route: MutualRoute,
    path: "/network/mutual/$userId",
    initialEntry: `/network/mutual/${TARGET_ID}`,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: NETWORK_IDS.me };
  h.target = {
    id: TARGET_ID,
    slug: "anna-nowak",
    display_name: PEER_NAME,
    first_name: null,
    last_name: null,
    avatar_url: null,
  };
  h.pages = new Map();
  h.rpcCalls = [];
  h.rpcFails = false;
  h.rpcPending = false;
  h.connectionStates = [];
});

afterEach(() => cleanup());

describe("/network/mutual/$userId - bramki wejścia", () => {
  it("trasa jest noindex - to lista powiązań między konkretnymi ludźmi", () => {
    const meta = routeHead(MutualRoute).meta ?? [];
    expect(meta.find((m) => m["name"] === "robots")?.["content"]).toBe("noindex");
  });

  it("anon: nic z listy nie wychodzi", async () => {
    h.user = null;
    h.pages.set(0, page(0, 3, 3));
    await mount();
    expect(screen.queryByText("Most 0")).not.toBeInTheDocument();
  });
});

describe("/network/mutual/$userId - stany listy", () => {
  it("ładowanie pokazuje szkielet, nie pustą listę", async () => {
    h.rpcPending = true;
    const { container } = await mount();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("błąd RPC ma własny komunikat, inny niż brak wyników", async () => {
    h.rpcFails = true;
    await mount();
    await waitFor(() => expect(screen.getByText("network.loadError")).toBeInTheDocument());
    expect(screen.queryByText("network.mutualEmpty")).not.toBeInTheDocument();
  });

  it("brak wspólnych kontaktów to komunikat, nie pusty ekran", async () => {
    h.pages.set(0, []);
    await mount();
    await waitFor(() => expect(screen.getByText("network.mutualEmpty")).toBeInTheDocument());
  });
});

describe("/network/mutual/$userId - stronicowanie", () => {
  it("pierwsze zapytanie idzie z offsetem zero i rozmiarem strony", async () => {
    h.pages.set(0, page(0, 3, 3));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    const call = h.rpcCalls.at(-1);
    expect(call?.["p_user_id"]).toBe(TARGET_ID);
    expect(call?.["p_limit"]).toBe(PAGE_SIZE);
    expect(call?.["p_offset"]).toBe(0);
  });

  it("komplet na jednej stronie: kontrolki dociągania NIE MA", async () => {
    h.pages.set(0, page(0, 3, 3));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /network\.loadMoreOf/ })).not.toBeInTheDocument();
  });

  it("nagłówek mówi o 150, strona pokazuje 48 - i JEST droga po resztę", async () => {
    h.pages.set(0, page(0, PAGE_SIZE, 150));
    h.pages.set(PAGE_SIZE, page(PAGE_SIZE, PAGE_SIZE, 150));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    // Liczba w nagłówku pochodzi z `total_count`, czyli mówi o CAŁYM zbiorze.
    expect(screen.getByText("network.mutual(count=150)")).toBeInTheDocument();
    expect(document.querySelectorAll("li").length).toBe(PAGE_SIZE);

    const more = screen.getByRole("button", { name: /network\.loadMoreOf/ });
    expect(more).toHaveTextContent("loaded=48");
    expect(more).toHaveTextContent("total=150");

    fireEvent.click(more);
    await waitFor(() => expect(document.querySelectorAll("li").length).toBe(PAGE_SIZE * 2));
    expect(h.rpcCalls.at(-1)?.["p_offset"]).toBe(PAGE_SIZE);
  });

  it("ostatnia porcja domyka zbiór i kontrolka znika", async () => {
    h.pages.set(0, page(0, PAGE_SIZE, 50));
    h.pages.set(PAGE_SIZE, page(PAGE_SIZE, 2, 50));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /network\.loadMoreOf/ }));

    await waitFor(() => expect(document.querySelectorAll("li").length).toBe(50));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /network\.loadMoreOf/ })).not.toBeInTheDocument(),
    );
  });
});

describe("/network/mutual/$userId - wiersz mostu", () => {
  it("każdy most jest kontaktem 1. STOPNIA - to czyni listę listą dróg", async () => {
    h.pages.set(0, page(0, 1, 1));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    expect(h.connectionStates.at(-1)).toMatchObject({
      userId: "bridge-0",
      status: "connected",
      degree: 1,
    });
  });

  it("most bez sluga nie dostaje linku prowadzącego donikąd", async () => {
    h.pages.set(0, [{ ...mutualRow(0, 1), slug: null }]);
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Most 0/ })).not.toBeInTheDocument();
  });

  it("rola i instytucja łączą się w jeden wiersz, lokalizacja stoi osobno", async () => {
    h.pages.set(0, page(0, 1, 1));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    expect(screen.getByText("Analityk - NES")).toBeInTheDocument();
    expect(screen.getByText("Warszawa")).toBeInTheDocument();
  });

  it("brak profilu osoby docelowej nie wywraca strony ani nie gubi listy", async () => {
    h.target = null;
    h.pages.set(0, page(0, 1, 1));
    await mount();

    await waitFor(() => expect(screen.getByText("Most 0")).toBeInTheDocument());
    expect(screen.getByText("network.mutualPageSubtitleGeneric")).toBeInTheDocument();
  });
});
