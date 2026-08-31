// Cala strona panelu reklam: naglowek plus trzy zakladki.
//
// PO CO TEN PLIK ISTNIEJE, SKORO KAZDA ZAKLADKA MA WLASNY PLIK. Bo tutaj
// mieszkaja trzy rzeczy, ktorych zaden z tamtych plikow nie widzi:
//   1. REJESTRACJA SLOWNIKA. `ensureAdsAdminI18n()` wola sie w komponencie,
//      a nie w punkcie wejscia aplikacji - to swiadoma decyzja o podziale
//      pakietow (slownik jedzie w chunku trasy). Jesli to wywolanie zniknie,
//      panel wyrenderuje same KLUCZE zamiast napisow, i to dopiero na
//      produkcji, bo w tescie zakladki slownik bywa dociagniety skadinad.
//   2. ZAKLADKA ODMONTOWUJE PANEL. Radix renderuje wylacznie aktywna zakladke,
//      wiec przejscie na „Statystyki" MONTUJE `StatsPanel` i uruchamia jego
//      zapytania. To jedyne miejsce, w ktorym widac, ze zakladki nie czytaja
//      bazy zawczasu (trzy panele naraz = trzy razy wiecej zapytan przy
//      kazdym wejsciu na strone).
//   3. DOMYSLNA ZAKLADKA. Panel ma sie otwierac na „Sloty" - to od nich
//      zaczyna sie kazda konfiguracja; otwarcie na „Statystykach" pokazuje
//      pusta tabele osobie, ktora dopiero ma cokolwiek zalozyc.
//
// GRANICE vs SASIEDZI. Trzy panele biegna PRAWDZIWE - to sasiedzi z
// `@/components/admin/ads/*` i zamiana ich na atrapy zamienilaby ten plik
// w test wlasnych atrap. Atrapowane sa: powloka administracyjna (router, auth,
// motyw - infrastruktura spoza modulu reklam), klient Supabase, toasty,
// dialogi, i18n oraz prymitywy Radiksa nieklikalne pod happy-dom.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
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

// GRANICA i18n: sprawdzamy WYWOLANIE rejestracji, nie jej srodek.
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: h.ensureI18n }));

// Powloka administracyjna ciagnie router, sesje i motyw - to infrastruktura
// spoza modulu reklam. Atrapa zachowuje to, co ten organizm faktycznie do niej
// wysyla: przelacznik ukrycia bocznego menu.
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

vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);
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

import { AdsAdmin } from "../AdsAdmin";

const db = () => h.from as SupabaseFromStub;

function withEmptyDatabase(): void {
  db().setResponse("ad_slots", ok([]));
  db().setResponse("ad_placements", ok([]));
  db().setResponse("ad_events", () => okCount(0));
  db().setResponse("categories", ok([]));
  db().setResponse("tags", ok([]));
}

beforeEach(() => {
  db().reset();
  (h.rt as { reset(): void }).reset();
  h.ensureI18n.mockClear();
  h.shellProps.length = 0;
  withEmptyDatabase();
});

describe("AdsAdmin", () => {
  it("REJESTRUJE slownik reklam przy renderze strony", () => {
    // Bez tego wywolania caly panel pokazuje surowe klucze i18n. Rejestracja
    // celowo NIE stoi w punkcie wejscia aplikacji - patrz komentarz w kodzie.
    renderWithQueryClient(<AdsAdmin />);
    expect(h.ensureI18n).toHaveBeenCalled();
  });

  it("naglowek i podtytul pochodza ze slownika", () => {
    renderWithQueryClient(<AdsAdmin />);
    expect(screen.getByRole("heading", { name: "adsAdmin.title" })).toBeInTheDocument();
    expect(screen.getByText("adsAdmin.subtitle")).toBeInTheDocument();
  });

  it("chowa boczne menu powloki - panel reklam potrzebuje pelnej szerokosci", () => {
    renderWithQueryClient(<AdsAdmin />);
    expect(h.shellProps[0]).toEqual({ hideSidebar: true });
  });

  it("ma DOKLADNIE trzy zakladki, opisane kluczami slownika", () => {
    renderWithQueryClient(<AdsAdmin />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "adsAdmin.tabs.slots",
      "adsAdmin.tabs.placements",
      "adsAdmin.tabs.stats",
    ]);
  });

  it("otwiera sie na zakladce SLOTY", async () => {
    renderWithQueryClient(<AdsAdmin />);
    expect(screen.getByRole("tab", { name: "adsAdmin.tabs.slots" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("adsAdmin.slots.empty")).toBeInTheDocument();
  });

  it("zakladki NIEAKTYWNE nie czytaja bazy - montuja sie dopiero po kliknieciu", async () => {
    // Trzy panele zamontowane naraz to trzy komplety zapytan przy kazdym
    // wejsciu na strone - w tym po jednej parze liczacej na KAZDY slot.
    renderWithQueryClient(<AdsAdmin />);
    await waitFor(() => expect(db().chainsFor("ad_slots").length).toBe(1));
    expect(db().chainsFor("ad_placements")).toHaveLength(0);
    expect(db().chainsFor("ad_events")).toHaveLength(0);
  });

  it("przejscie na POZYCJE montuje panel pozycji i uruchamia jego odczyt", async () => {
    renderWithQueryClient(<AdsAdmin />);
    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.placements" }));
    expect(await screen.findByText("adsAdmin.placements.empty")).toBeInTheDocument();
    await waitFor(() => expect(db().chainsFor("ad_placements").length).toBe(1));
  });

  it("przejscie na STATYSTYKI montuje raport i ODMONTOWUJE panel pozycji", async () => {
    // Radix trzyma w drzewie tylko aktywna zakladke. Gdyby panele zostawaly
    // zamontowane, formularz slotu zachowywalby niezapisany szkic w tle -
    // i wracalby do niego przy nastepnym wejsciu na zakladke.
    renderWithQueryClient(<AdsAdmin />);
    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.placements" }));
    await screen.findByText("adsAdmin.placements.empty");
    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.stats" }));
    expect(await screen.findByText("adsAdmin.stats.empty")).toBeInTheDocument();
    expect(screen.queryByText("adsAdmin.placements.empty")).toBeNull();
  });

  it("powrot na SLOTY czysci niezapisany szkic formularza", async () => {
    // Konsekwencja odmontowania - warto ja przybic, bo to jedyna ochrona przed
    // zapisaniem kreacji, ktora redaktor porzucil dwie zakladki wczesniej.
    renderWithQueryClient(<AdsAdmin />);
    const nazwa = await screen.findByLabelText("adsAdmin.slots.fieldName");
    fireEvent.change(nazwa, { target: { value: "Szkic porzucony" } });
    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.stats" }));
    await screen.findByText("adsAdmin.stats.empty");
    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.slots" }));
    expect(await screen.findByLabelText("adsAdmin.slots.fieldName")).toHaveValue("");
  });
});
