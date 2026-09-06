// Mostek realtime globalnego chrome'u (Header / Menu / Footer / AlertBar /
// CopyrightBar / ticker / tokeny motywu).
//
// Komponent zwraca `null`, więc KAŻDA jego regresja jest niewidoczna w testach
// renderujących: wycięcie hooka nie zmienia ani jednego piksela, a panel admina
// przestaje pokazywać własne zapisy. Dowodem muszą więc być KANAŁY na atrapie
// Realtime i realny przepływ zdarzenia do inwalidacji cache.
//
// Druga oś, równie ważna i równie niewidoczna: listenery postgres_changes są
// STAFF-ONLY. Otwarcie ich anonimowemu odwiedzającemu to trzy websockety na
// każdą wizytę - kwota połączeń Realtime pada przy pierwszym ruchu, a każdy
// zapis ustawień wywołuje burzę refetchów na całej witrynie. Ta odmowa ma tu
// własny test, bo w produkcji objawia się dopiero pod obciążeniem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { FakeChannel, RealtimeStub } from "@/test/supabase";

const h = vi.hoisted(() => ({ auth: { isStaff: true } }));
const stubs = vi.hoisted(() => ({ realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const atoms = await import("@/test/supabase");
  const realtime = atoms.realtimeStub();
  stubs.realtime = realtime;
  return {
    supabase: {
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: () => ({}),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isStaff: h.auth.isStaff }),
}));

import {
  SiteSettingsLiveSync,
  emitSiteSettingsInvalidate,
} from "@/lib/builder/siteSettingsLiveSync";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const rt = () => stubs.realtime as RealtimeStub;
const CHANNEL = "site-settings-live-sync";
const LOCAL_EVENT = "site-settings:invalidate";

/** Zarejestrowany filtr inwalidacji - albo klucz-prefiks, albo predykat. */
interface SeenFilter {
  queryKey?: QueryKey;
  predicate?: (query: { queryKey: QueryKey }) => boolean;
}

function trackInvalidations(queryClient: QueryClient): SeenFilter[] {
  const seen: SeenFilter[] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    seen.push((filters ?? {}) as SeenFilter);
  });
  return seen;
}

/** Odwzorowanie semantyki react-query: klucz filtra dopasowuje się PREFIKSEM. */
function isPrefixOf(prefix: QueryKey, key: QueryKey): boolean {
  return prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]));
}

function covers(seen: SeenFilter[], key: QueryKey): boolean {
  return seen.some((filter) => {
    if (filter.predicate) return filter.predicate({ queryKey: key });
    return filter.queryKey ? isPrefixOf(filter.queryKey, key) : false;
  });
}

function liveChannel(): FakeChannel {
  const found = rt().liveChannels(CHANNEL);
  expect(found, `brak żywego kanału ${CHANNEL}`).toHaveLength(1);
  return found[0];
}

beforeEach(() => {
  h.auth.isStaff = true;
  rt().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SiteSettingsLiveSync - montowanie", () => {
  it("nie renderuje NICZEGO - to mostek, nie widok", () => {
    const { container, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    expect(container).toBeEmptyDOMElement();
    unmount();
  });

  it("staff dostaje JEDEN kanał z trzema nasłuchami tabel", () => {
    // Jeden kanał na trzy tabele, a nie trzy kanały - to różnica jednego
    // websocketu kontra trzech na każdą kartę redakcji.
    const { unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);

    const channel = liveChannel();
    expect(rt().liveChannels(CHANNEL)).toHaveLength(1);
    expect(channel.subscribeCount).toBe(1);
    expect(channel.listeners.map((l) => l.filter)).toEqual([
      { event: "*", schema: "public", table: "site_settings" },
      { event: "*", schema: "public", table: "builder_templates" },
      { event: "*", schema: "public", table: "site_design_tokens" },
    ]);

    unmount();
  });

  it("wszystkie trzy nasłuchy idą po postgres_changes i po WSZYSTKICH zdarzeniach", () => {
    // `event: "*"` jest tu konieczne: usunięcie wiersza ustawień to DELETE,
    // a podpięcie samego INSERT/UPDATE zostawiłoby panel ze skasowaną sekcją.
    const { unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);

    for (const listener of liveChannel().listeners) {
      expect(listener.type).toBe("postgres_changes");
      expect(listener.filter.event).toBe("*");
      expect(listener.filter.schema).toBe("public");
    }

    unmount();
  });

  it("dla odwiedzającego BEZ uprawnień staffu nie otwiera ŻADNEGO kanału", () => {
    // Doktryna kwoty połączeń: anonimowy czytelnik dostaje świeżość ze
    // staleTime i ze zdarzenia lokalnego, nigdy z websocketu.
    h.auth.isStaff = false;
    const { container, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);

    expect(container).toBeEmptyDOMElement();
    expect(rt().channels).toEqual([]);

    unmount();
  });
});

describe("SiteSettingsLiveSync - zakres inwalidacji", () => {
  it("zmiana w site_settings odświeża zbiorczy odczyt ustawień", () => {
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel().emitPostgres("site_settings", { eventType: "UPDATE", new: { key: "header" } });
    });

    expect(covers(seen, siteSettingsQueryOptions.queryKey)).toBe(true);
    unmount();
  });

  it("odświeża też odczyty POJEDYNCZYCH kluczy z panelu admina", () => {
    // useSettings("header"/"footer"/...) żyje pod ["site_settings", key];
    // bez tego panel po zapisie pokazywałby stan sprzed edycji.
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel().emitPostgres("site_settings", { eventType: "UPDATE" });
    });

    expect(covers(seen, ["site_settings", "header"])).toBe(true);
    expect(covers(seen, ["site_settings", "footer"])).toBe(true);
    unmount();
  });

  it("odświeża szablony buildera - nagłówek i stopka potrafią je referować", () => {
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel().emitPostgres("builder_templates", { eventType: "INSERT" });
    });

    expect(covers(seen, ["builder_templates", "header-main"])).toBe(true);
    unmount();
  });

  it("odświeża WĄSKI zestaw kluczy publicznych, a nie cały korzeń [public]", () => {
    // Tryb strony głównej i liczba wpisów na stronę pochodzą z site_settings,
    // ale żyją pod ["public", ...] z 10-minutowym staleTime - bez tej
    // inwalidacji admin po przełączeniu trybu widziałby starą stronę.
    // Zrzucenie CAŁEGO korzenia ["public"] kasowałoby przy okazji cache
    // treści niezależnych od ustawień, więc lista jest jawna i krótka.
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel().emitPostgres("site_settings", { eventType: "UPDATE" });
    });

    expect(covers(seen, ["public", "home-mode"])).toBe(true);
    expect(covers(seen, ["public", "home-page", "o-nas"])).toBe(true);
    expect(covers(seen, ["public", "blog", "pl", 1])).toBe(true);

    // ...i granica: treści spoza tej trójki NIE są zrzucane.
    expect(covers(seen, ["public", "post", "jakis-wpis"])).toBe(false);
    expect(covers(seen, ["public"])).toBe(false);
    expect(covers(seen, ["builder-post-list", { lang: "pl" }])).toBe(false);

    unmount();
  });

  it("zmiana tokenów motywu unieważnia ten sam zestaw co zmiana ustawień", () => {
    // Tokeny motywu wchodzą do tego samego chrome'u, więc dzielą ścieżkę
    // inwalidacji - inaczej zmiana kolorów wymagałaby twardego przeładowania.
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel().emitPostgres("site_design_tokens", { eventType: "UPDATE" });
    });

    expect(covers(seen, siteSettingsQueryOptions.queryKey)).toBe(true);
    expect(covers(seen, ["builder_templates", "x"])).toBe(true);
    expect(covers(seen, ["public", "home-mode"])).toBe(true);
    unmount();
  });

  it("predykaty patrzą na PIERWSZY człon klucza i tylko na klucze tablicowe", () => {
    // Klucz nietablicowy (string) nie może wysadzić predykatu - inaczej jedno
    // zapytanie o nietypowym kluczu wywracałoby całą inwalidację.
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel().emitPostgres("site_settings", { eventType: "UPDATE" });
    });

    const oddKey = "site_settings" as unknown as QueryKey;
    for (const filter of seen) {
      if (!filter.predicate) continue;
      expect(() => filter.predicate?.({ queryKey: oddKey })).not.toThrow();
      expect(filter.predicate({ queryKey: oddKey })).toBe(false);
    }

    unmount();
  });
});

describe("SiteSettingsLiveSync - zdarzenie lokalne", () => {
  it("zdarzenie okna odświeża cache RÓWNIEŻ bez uprawnień staffu", () => {
    // Podpowiedź międzykartowa nie kosztuje sieci, więc dostaje ją każdy -
    // to jedyna droga świeżości dla anonimowej karty podglądu.
    h.auth.isStaff = false;
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
    });

    expect(covers(seen, siteSettingsQueryOptions.queryKey)).toBe(true);
    expect(covers(seen, ["public", "home-mode"])).toBe(true);
    unmount();
  });

  it("emitSiteSettingsInvalidate wywołuje dokładnie to zdarzenie", () => {
    // Zapisy w adminie wołają tę funkcję - gdyby rozjechała się nazwa
    // zdarzenia, panel odświeżałby się dopiero po staleTime.
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      emitSiteSettingsInvalidate();
    });

    expect(covers(seen, siteSettingsQueryOptions.queryKey)).toBe(true);
    unmount();
  });

  it("emitSiteSettingsInvalidate BEZ zamontowanego mostka nie rzuca", () => {
    // Zapis w adminie może wyprzedzić montowanie roota (albo mostek może być
    // wyłączony) - nadawca nie ma prawa się o to wywrócić.
    expect(() => emitSiteSettingsInvalidate()).not.toThrow();
  });
});

describe("SiteSettingsLiveSync - sprzątanie", () => {
  it("odmontowanie ZWALNIA kanał", () => {
    // Mostek żyje w root layoucie i odmontowuje się przy wylogowaniu.
    // Zostawiony websocket trzymałby subskrypcję poprzedniej sesji.
    const { unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    const channel = liveChannel();

    unmount();

    expect(channel.removed).toBe(true);
    expect(rt().liveChannels(CHANNEL)).toEqual([]);
  });

  it("odmontowanie ZDEJMUJE nasłuch zdarzenia lokalnego", () => {
    // Nieusunięty listener trzymałby referencję do martwego QueryClienta
    // i przy każdym zapisie próbowałby unieważniać jego cache.
    const { queryClient, unmount } = renderWithQueryClient(<SiteSettingsLiveSync />);
    unmount();
    const seen = trackInvalidations(queryClient);

    act(() => {
      emitSiteSettingsInvalidate();
    });

    expect(seen).toEqual([]);
  });

  it("utrata uprawnień staffu zamyka kanał bez odmontowania komponentu", () => {
    // Role dojeżdżają po pierwszym renderze, a wylogowanie w tej samej karcie
    // nie odmontowuje roota - kanał musi zniknąć na samej zmianie `isStaff`.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <SiteSettingsLiveSync />
      </QueryClientProvider>
    );
    const { rerender, unmount } = render(tree());
    const channel = liveChannel();

    h.auth.isStaff = false;
    rerender(tree());

    expect(channel.removed).toBe(true);
    expect(rt().liveChannels(CHANNEL)).toEqual([]);

    unmount();
  });
});
