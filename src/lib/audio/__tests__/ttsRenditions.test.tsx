// Rejestr kanonicznych nagrań TTS w panelu redakcyjnym (`AudioSection` ->
// `TtsVoiceCard`). Plik stał na zerze pokrycia, a to z niego redakcja wie, czy
// wpis MA już nagranie w danym języku, jakim głosem i ile razy było płacone.
//
// Czego pilnuje ten plik:
//   1. KSZTAŁT MAPY. Wiersze trafiają pod klucz języka; wiersz z językiem
//      spoza `pl`/`en` jest pomijany, zamiast udawać trzeci język karty.
//   2. ZAKRES ZAPYTANIA. Odczyt jest zawężony do JEDNEGO wpisu i jawnej listy
//      kolumn (bez `*` - tabela może dostać kolumny techniczne).
//   3. BRAK ZAPYTANIA BEZ ID. Nowy, niezapisany wpis nie strzela zapytaniem
//      o pusty identyfikator przy każdym otwarciu formularza.
//   4. BŁĄD JEST BŁĘDEM. Odmowa RLS nie może wyglądać jak „brak nagrań".
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const stub = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

import { usePostTtsRenditions, type PostTtsRendition } from "@/lib/audio/ttsRenditions";

const POST = "11111111-1111-1111-1111-111111111111";

function row(lang: string, overrides: Partial<PostTtsRendition> = {}) {
  return {
    lang,
    voice_id: "JBFqnCBsd6RMkjVDRZzb",
    model: "eleven_multilingual_v2",
    content_hash: `hash-${lang}`,
    byte_size: 120_000,
    char_count: 4200,
    synth_count: 1,
    synthesized_at: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  stub.reset();
});

describe("usePostTtsRenditions", () => {
  it("układa nagrania pod kluczem języka i pomija języki spoza karty", async () => {
    stub.setResponse(
      "post_tts_renditions",
      ok([row("pl"), row("en", { synth_count: 3 }), row("de")]),
    );
    const { result } = renderHookWithQueryClient(() => usePostTtsRenditions(POST));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.keys(result.current.data ?? {}).sort()).toEqual(["en", "pl"]);
    expect(result.current.data?.pl).toEqual(row("pl"));
    expect(result.current.data?.en?.synth_count).toBe(3);
  });

  it("czyta JEDEN wpis i jawną listę kolumn, nie `*`", async () => {
    stub.setResponse("post_tts_renditions", ok([]));
    const { result } = renderHookWithQueryClient(() => usePostTtsRenditions(POST));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = stub.lastChain("post_tts_renditions");
    expect(chain?.argsOf("eq")).toEqual(["post_id", POST]);
    expect(chain?.argsOf("select")).toEqual([
      "lang, voice_id, model, content_hash, byte_size, char_count, synth_count, synthesized_at",
    ]);
  });

  it("wpis bez nagrań (albo `data: null`) to PUSTA mapa, nie błąd", async () => {
    stub.setResponse("post_tts_renditions", ok(null));
    const { result } = renderHookWithQueryClient(() => usePostTtsRenditions(POST));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
    expect(result.current.isError).toBe(false);
  });

  it("błąd odczytu (np. odmowa RLS) jest stanem BŁĘDU, nie pustą mapą", async () => {
    stub.setResponse("post_tts_renditions", fail("permission denied", "42501"));
    const { result } = renderHookWithQueryClient(() => usePostTtsRenditions(POST));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied");
    expect(result.current.data).toBeUndefined();
  });

  it.each([null, undefined, ""])(
    "brak id wpisu (%j) NIE wysyła zapytania i nie zostawia wpisu w cache",
    async (postId) => {
      const { result, queryClient } = renderHookWithQueryClient(() => usePostTtsRenditions(postId));

      expect(result.current.fetchStatus).toBe("idle");
      expect(stub.chains).toHaveLength(0);
      expect(queryClient.getQueryData(["post-tts-renditions", ""])).toBeUndefined();
    },
  );

  it("drugi konsument tego wpisu w oknie świeżości bierze cache, nie pyta bazy drugi raz", async () => {
    // Karta głosu i sekcja audio czytają ten sam rejestr - bez `staleTime`
    // każde rozwinięcie sekcji byłoby kolejnym zapytaniem.
    stub.setResponse("post_tts_renditions", ok([row("pl")]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => usePostTtsRenditions(POST), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => usePostTtsRenditions(POST), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(second.result.current.data).toEqual({ pl: row("pl") });
    expect(queryClient.getQueryData(["post-tts-renditions", POST])).toEqual({ pl: row("pl") });
    expect(stub.chainsFor("post_tts_renditions")).toHaveLength(1);
  });
});
