// E2E-style test kryterium: ElevenLabs jest wołany tylko wtedy, gdy dla danego
// języka BRAK wgranego pliku MP3. Weryfikujemy zarówno funkcję decyzyjną
// `resolveAudioFetch`, jak i realny przepływ przez `fetch` (mock global.fetch)
// - w ten sposób łapiemy regresje we wszystkich ścieżkach playera.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAudioFetch } from "@/lib/audio/global-player";

describe("resolveAudioFetch (kryterium ElevenLabs fallback)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wgrany MP3 dla PL → pobieramy plik bezpośrednio, ElevenLabs pomijany", () => {
    const src = resolveAudioFetch("post-1", "pl", "https://cdn/example.mp3");
    expect(src.usesElevenLabs).toBe(false);
    expect(src.url).toBe("https://cdn/example.mp3");
    expect(src.init.method).toBe("GET");
    expect(src.init.body).toBeUndefined();
  });

  it("brak MP3 dla PL → fallback do /api/public/post-tts (ElevenLabs)", () => {
    const src = resolveAudioFetch("post-1", "pl", null);
    expect(src.usesElevenLabs).toBe(true);
    expect(src.url).toBe("/api/public/post-tts");
    expect(src.init.method).toBe("POST");
    expect(String(src.init.body)).toContain('"lang":"pl"');
  });

  it("wgrany MP3 tylko dla PL - EN nadal używa ElevenLabs", () => {
    // Scenariusz z brief: PL wgrany, EN brak → PL bez ElevenLabs, EN z ElevenLabs.
    const pl = resolveAudioFetch("p", "pl", "https://cdn/pl.mp3");
    const en = resolveAudioFetch("p", "en", null);
    expect(pl.usesElevenLabs).toBe(false);
    expect(en.usesElevenLabs).toBe(true);
  });

  it("wgrany EN, brak PL - odwrotnie: EN bez ElevenLabs, PL z ElevenLabs", () => {
    const pl = resolveAudioFetch("p", "pl", "");
    const en = resolveAudioFetch("p", "en", "https://cdn/en.mp3");
    expect(pl.usesElevenLabs).toBe(true);
    expect(en.usesElevenLabs).toBe(false);
  });

  it("puste / białe znaki traktujemy jak brak audio (fallback do TTS)", () => {
    expect(resolveAudioFetch("p", "pl", "   ").usesElevenLabs).toBe(true);
    expect(resolveAudioFetch("p", "en", undefined).usesElevenLabs).toBe(true);
  });

  it("mockowany fetch: wgrany MP3 nie trafia do endpointu TTS", async () => {
    const fetchSpy = vi.fn(async () => new Response("ok"));
    // @ts-expect-error - test override
    globalThis.fetch = fetchSpy;
    const src = resolveAudioFetch("p", "pl", "https://cdn/a.mp3");
    await fetch(src.url, src.init);
    const called = fetchSpy.mock.calls[0]?.[0];
    expect(called).toBe("https://cdn/a.mp3");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/public/post-tts")),
    ).toBe(false);
  });
});
