// Trasa `/admin/ads` - CIENKIE OPAKOWANIE panelu reklam. Do dziś: 0 instrukcji.
//
// CZEGO NIE DOWODZI TEST ORGANIZMU. `AdsAdmin.test.tsx` renderuje komponent
// WPROST (`render(<AdsAdmin />)`) i dowodzi wszystkiego o zawartości panelu:
// zakładek, słownika, odczytów bazy. Nie dotyka natomiast ANI JEDNEJ linii
// pliku `src/routes/admin.ads.tsx`, bo cały ten plik to jedno wyrażenie:
//
//     createFileRoute("/admin/ads")({ component: AdsAdmin })
//
// czyli SKLEJENIE adresu z organizmem. Trzy rzeczy mogą się w nim zepsuć bez
// jednego czerwonego testu w całym repo:
//   1. ZŁY ADRES. Literówka w argumencie `createFileRoute` daje trasę, której
//      generator drzewa podpina pod inną ścieżkę - panel istnieje, ale nie ma
//      go pod `/admin/ads`. Test renderujący komponent przechodzi dalej.
//   2. ZŁY ORGANIZM. Po rozbiciu czterech paneli modułu na katalogi
//      `@/components/admin/{ads,gifting,coupons,donations}` wszystkie cztery
//      trasy wyglądają identycznie i różnią się JEDNYM importem. Podmiana
//      importu to panel prezentów pod adresem reklam - i znowu: każdy test
//      organizmu nadal zielony.
//   3. NAGŁÓWEK SEO. Trasa panelu bez `noindex` to mapa administracji
//      w wynikach wyszukiwania. Tutaj jest to dziedziczone (patrz test niżej),
//      i test opisuje ten stan JAWNIE, żeby dziedziczenie było decyzją,
//      a nie przeoczeniem.
//
// GRANICE vs SĄSIEDZI. Organizm `AdsAdmin` i jego trzy panele biegną
// PRAWDZIWE - podmiana ich atrapą zamieniłaby ten plik w test własnej atrapy
// i nie dowiodła, że trasa montuje WŁAŚCIWY panel. Atrapowane są wyłącznie
// granice: powłoka administracyjna (router+sesja+motyw spoza modułu reklam),
// klient Supabase, toasty, dialogi i i18n.
//
// ZERO SIECI, ZERO SEKRETÓW: żadne zapytanie nie wychodzi poza atrapę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ok, okCount, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  from: null as unknown,
  rt: null as unknown,
  ensureI18n: vi.fn(),
  shellProps: [] as Array<{ hideSidebar?: boolean }>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: vi.fn(async () => false) }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { deleted: () => "adminToasts.deleted", saved: () => "adminToasts.saved" },
}));
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: h.ensureI18n }));

// Powłoka administracyjna ciągnie router, sesję i motyw - infrastruktura spoza
// modułu reklam, czyli granica. Atrapa zachowuje jedyną rzecz, którą organizm
// do niej wysyła: przełącznik ukrycia bocznego menu.
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children, hideSidebar }: { children?: ReactNode; hideSidebar?: boolean }) => {
    h.shellProps.push({ hideSidebar });
    return <div data-testid="powloka">{children}</div>;
  },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { realtimeStub } = await import("@/test/supabase/realtime");
  const from = supabaseFromStub();
  const rt = realtimeStub();
  h.from = from;
  h.rt = rt;
  return {
    supabase: {
      from: from.from,
      channel: rt.channel.bind(rt),
      removeChannel: rt.removeChannel.bind(rt),
    },
  };
});

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/datetime-picker", async () => {
  const React = await import("react");
  return {
    DateTimePicker: ({ placeholder }: { placeholder?: string }) =>
      React.createElement("input", { "aria-label": placeholder, readOnly: true, value: "" }),
  };
});

import { renderRoute } from "@/test/routeHarness";
import { AdsAdmin } from "@/components/admin/ads/organisms/AdsAdmin";
import { Route as AdsRoute } from "@/routes/admin.ads";

const PATH = "/admin/ads";

const db = () => h.from as SupabaseFromStub;

/** Panel startuje na zakładce Sloty - tylko jej odczyty muszą być zaplanowane. */
function pustaBaza(): void {
  db().setResponse("ad_slots", ok([]));
  db().setResponse("ad_placements", ok([]));
  db().setResponse("ad_events", () => okCount(0));
  db().setResponse("categories", ok([]));
  db().setResponse("tags", ok([]));
}

async function zamontuj() {
  return renderRoute({ route: AdsRoute, path: PATH, initialEntry: PATH });
}

beforeEach(() => {
  db().reset();
  (h.rt as { reset(): void }).reset();
  h.ensureI18n.mockClear();
  h.shellProps.length = 0;
  pustaBaza();
});

describe("trasa /admin/ads - sklejenie adresu z panelem", () => {
  it("montuje się POD SWOIM ADRESEM i pokazuje panel reklam", async () => {
    const view = await zamontuj();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByRole("heading", { name: "adsAdmin.title" })).toBeInTheDocument();
    // Dowód, że przez trasę przeszedł CAŁY organizm, a nie sam nagłówek:
    // pierwsza zakładka zdążyła odpytać bazę o sloty.
    await waitFor(() => expect(db().chainsFor("ad_slots").length).toBe(1));
    cleanup();
  });

  it("wskazuje DOKŁADNIE organizm panelu reklam, a nie sąsiedni panel modułu", async () => {
    // Cztery trasy tego modułu różnią się JEDNYM importem. Ta asercja jest
    // jedynym miejscem, w którym podmiana `AdsAdmin` na `GiftingAdmin`
    // (albo na organizm kuponów) zapala się na czerwono.
    expect(AdsRoute.options.component).toBe(AdsAdmin);
    cleanup();
  });

  it("panel dostaje powłokę BEZ bocznego menu - trasa nie zmienia tej decyzji", async () => {
    // Panel reklam potrzebuje pełnej szerokości i sam o to prosi powłokę.
    // Test trasy pilnuje, że sklejenie nie wsuwa własnej powłoki obok tamtej.
    await zamontuj();
    expect(h.shellProps).toEqual([{ hideSidebar: true }]);
    cleanup();
  });

  it("nie wnosi WŁASNEGO `head()` - bramka `noindex` jest dziedziczona z `/admin`", async () => {
    // STAN FAKTYCZNY, opisany jawnie. W produkcji ta trasa jest dzieckiem
    // `/admin`, a tamten layout ustawia `robots: noindex, nofollow` dla całego
    // panelu - dlatego brak `head()` tutaj NIE jest defektem. Zamontowana
    // samodzielnie (tak jak w tym teście) trasa nie wnosi żadnego `meta`,
    // i właśnie to widać niżej.
    //
    // RYZYKO, KTÓRE TEN TEST UTRWALA: gdyby ktoś dołożył tu `head()` z samym
    // tytułem, nadpisałby wpis rodzica TYLKO dla tytułu, ale gdyby przy okazji
    // przeniósł trasę spod `/admin` (własne drzewo, np. `/ads-studio`), bramka
    // znikłaby bez śladu. Wzorzec jawnego `robots` w pliku trasy stoi obok -
    // `src/routes/admin.donations.tsx`.
    const view = await zamontuj();
    expect(AdsRoute.options.head).toBeUndefined();
    expect(view.meta()).toEqual([]);
    cleanup();
  });
});
