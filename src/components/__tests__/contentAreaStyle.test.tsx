// `ContentAreaStyle` - typografia treści z `post_layout_settings`, montowana
// raz w korzeniu (`routes/__root.tsx`).
//
// CO TEN PLIK DOWODZI (P3.8, poprawka #3). Korzeń zasiewa klucz
// `["post-layout-settings"]` domyślnymi z `updatedAt: 0`, więc zwykły
// `refetchOnMount` wysyłał GET `post_layout_settings` + preflight w efekcie
// hydratacji KAŻDEJ trasy bez własnej rozgrzewki - także `/`, gdzie żaden
// selektor tego arkusza nie ma elementu. Od P3.8:
//   - zasiew NIE odświeża się przy montażu (hydratacji);
//   - wartości najemcy dociąga zatrzask „pierwsza interakcja ALBO punkt ciszy";
//   - wiersz już świeży (rozgrzany przez `$.tsx`) nie idzie do sieci wcale;
//   - brak wpisu i inwalidacja (zapis w panelu) pobierają jak dotąd.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (sieć) i detektor ciszy (czas
// przeglądarki). Zapytanie, zatrzask i `StyleSink` biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const stubs = vi.hoisted(() => ({ from: null as unknown }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});
vi.mock("@/lib/performance/whenQuiescent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/performance/whenQuiescent")>()),
  onQuiescent: () => () => {},
}));

import { ContentAreaStyle } from "@/components/ContentAreaStyle";
import { defaultPostLayoutSettings } from "@/lib/postLayouts";
import {
  __openInteractionOrQuietForTests,
  __resetInteractionOrQuietForTests,
} from "@/lib/performance/interactionOrQuiet";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";

const from = () => stubs.from as SupabaseFromStub;
const KEY = ["post-layout-settings"] as const;
const TENANT_ROW = { ...defaultPostLayoutSettings(), paragraph_spacing_rem: 2.25 };

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ContentAreaStyle />
    </QueryClientProvider>,
  );
}

const css = () => document.querySelector("style[data-content-area]")?.textContent ?? "";
const fetches = () => from().chainsFor("post_layout_settings").length;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

let client: QueryClient;
beforeEach(() => {
  from().reset();
  from().setResponse("post_layout_settings", ok(TENANT_ROW));
  __resetInteractionOrQuietForTests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  __resetInteractionOrQuietForTests();
});

describe("ContentAreaStyle: bez pobrania w hydratacji (P3.8 #3)", () => {
  it("zasiew korzenia (`updatedAt: 0`) NIE idzie do sieci przy montażu", async () => {
    client.setQueryData(KEY, defaultPostLayoutSettings(), { updatedAt: 0 });

    mount(client);
    await settle();

    expect(fetches()).toBe(0);
    // Pierwsze malowanie: blok z domyślnych, ten sam co w SSR.
    expect(css()).toContain("margin-bottom: 1.5rem");
  });

  it("zatrzask interakcji/ciszy dociąga wartości najemcy - raz", async () => {
    client.setQueryData(KEY, defaultPostLayoutSettings(), { updatedAt: 0 });
    mount(client);
    await settle();

    act(() => __openInteractionOrQuietForTests());

    await waitFor(() => expect(css()).toContain("margin-bottom: 2.25rem"));
    expect(fetches()).toBe(1);
  });

  it("wiersz świeży (rozgrzany przez trasę wpisu) nie idzie do sieci ani przy montażu, ani przy zatrzasku", async () => {
    client.setQueryData(KEY, TENANT_ROW, { updatedAt: Date.now() });
    mount(client);
    act(() => __openInteractionOrQuietForTests());
    await settle();

    expect(fetches()).toBe(0);
    expect(css()).toContain("margin-bottom: 2.25rem");
  });

  it("bez wpisu w cache'u pobiera przy montażu, jak dotąd", async () => {
    mount(client);

    await waitFor(() => expect(fetches()).toBe(1));
    await waitFor(() => expect(css()).toContain("margin-bottom: 2.25rem"));
  });

  it("zapis w panelu (inwalidacja) odświeża od razu, także przed zatrzaskiem", async () => {
    client.setQueryData(KEY, defaultPostLayoutSettings(), { updatedAt: 0 });
    mount(client);
    await settle();
    expect(fetches()).toBe(0);

    await act(() => client.invalidateQueries({ queryKey: KEY }));

    expect(fetches()).toBe(1);
    await waitFor(() => expect(css()).toContain("margin-bottom: 2.25rem"));
  });
});
