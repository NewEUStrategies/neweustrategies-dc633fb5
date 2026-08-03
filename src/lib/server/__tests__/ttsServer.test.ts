// Serwerowa warstwa kanonicznego lektora: rozstrzyganie planu syntezy,
// degradacja przy niedostępnym rejestrze nagrań i koalescencja równoległych
// syntez (jedna płatna synteza na klucz w izolacie).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  coalesceTtsSynthesis,
  inflightTtsSynthesisCount,
  invalidateTtsSettingsCache,
  recordTtsRendition,
  resolveCanonicalTtsPlan,
  resolveTenantTtsSettings,
  ttsContentHash,
} from "@/lib/server/tts.server";
import { DEFAULT_TTS_MODEL_ID, DEFAULT_TTS_VOICE_ID } from "@/lib/audio/ttsCanonical";

const TENANT = "11111111-1111-1111-1111-111111111111";
const POST = "22222222-2222-2222-2222-222222222222";
const SARAH = "EXAVITQu4vr4xnSDxMaL";
const MATILDA = "XrExE9yKIg1WjnnlVkGX";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

const state: {
  settings: QueryResult;
  rendition: QueryResult;
  renditionThrows: boolean;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  rpcError: { message: string } | null;
} = {
  settings: { data: null, error: null },
  rendition: { data: null, error: null },
  renditionThrows: false,
  rpcCalls: [],
  rpcError: null,
};

vi.mock("@/integrations/supabase/client.server", () => {
  /** Minimalny łańcuch PostgREST: .select().eq()...maybeSingle(). */
  const chain = (result: () => QueryResult) => {
    const node = {
      select: () => node,
      eq: () => node,
      maybeSingle: () => Promise.resolve(result()),
    };
    return node;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === "post_tts_renditions") {
          if (state.renditionThrows) throw new Error("relation does not exist");
          return chain(() => state.rendition);
        }
        return chain(() => state.settings);
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve({ data: null, error: state.rpcError });
      },
    },
  };
});

beforeEach(() => {
  invalidateTtsSettingsCache();
  state.settings = { data: null, error: null };
  state.rendition = { data: null, error: null };
  state.renditionThrows = false;
  state.rpcCalls = [];
  state.rpcError = null;
});

describe("ttsContentHash", () => {
  it("jest deterministyczny i wrażliwy na najmniejszą zmianę treści", () => {
    expect(ttsContentHash("Tekst artykułu")).toBe(ttsContentHash("Tekst artykułu"));
    expect(ttsContentHash("Tekst artykułu")).not.toBe(ttsContentHash("Tekst artykulu"));
  });

  it("ma 128 bitów (32 znaki hex) - klucz cache nie może kolidować przy edycji", () => {
    expect(ttsContentHash("cokolwiek")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("resolveTenantTtsSettings", () => {
  it("czyta pola TTS z wiersza site_settings.reading", async () => {
    state.settings = {
      data: { value: { posts_per_page: 10, tts_voice_pl: SARAH, tts_model: "eleven_turbo_v2_5" } },
      error: null,
    };
    const settings = await resolveTenantTtsSettings(TENANT);
    expect(settings.tts_voice_pl).toBe(SARAH);
    expect(settings.tts_model).toBe("eleven_turbo_v2_5");
    // Brak pola dla EN => platformowa wartość domyślna, nie undefined.
    expect(settings.tts_voice_en).toBe(DEFAULT_TTS_VOICE_ID);
  });

  it("keszuje wynik per najemca (endpoint publiczny nie dokłada round-tripu)", async () => {
    state.settings = { data: { value: { tts_voice_pl: SARAH } }, error: null };
    await resolveTenantTtsSettings(TENANT);
    state.settings = { data: { value: { tts_voice_pl: MATILDA } }, error: null };
    const second = await resolveTenantTtsSettings(TENANT);
    expect(second.tts_voice_pl).toBe(SARAH);
    invalidateTtsSettingsCache();
    const third = await resolveTenantTtsSettings(TENANT);
    expect(third.tts_voice_pl).toBe(MATILDA);
  });
});

describe("resolveCanonicalTtsPlan", () => {
  it("bez nagrania: kanoniczna para z ustawień + ścieżka bez głosu i modelu", async () => {
    state.settings = { data: { value: { tts_voice_pl: SARAH } }, error: null };
    const plan = await resolveCanonicalTtsPlan({
      tenantId: TENANT,
      postId: POST,
      lang: "pl",
      overrides: null,
      contentHash: "hash-a",
    });
    expect(plan.pin).toEqual({
      voiceId: SARAH,
      model: DEFAULT_TTS_MODEL_ID,
      voiceSource: "tenant",
    });
    expect(plan.storagePath).toBe(`${TENANT}/${POST}/pl.mp3`);
    expect(plan.rendition).toBeNull();
    expect(plan.fresh).toBe(false);
    expect(plan.registryAvailable).toBe(true);
  });

  it("nadpisanie redakcyjne wygrywa, a ścieżka pozostaje TA SAMA", async () => {
    const plan = await resolveCanonicalTtsPlan({
      tenantId: TENANT,
      postId: POST,
      lang: "pl",
      overrides: { pl: MATILDA, en: null },
      contentHash: "hash-a",
    });
    expect(plan.pin.voiceId).toBe(MATILDA);
    expect(plan.pin.voiceSource).toBe("post");
    expect(plan.storagePath).toBe(`${TENANT}/${POST}/pl.mp3`);
  });

  it("zgodne nagranie => trafienie w cache (bez płatnej syntezy)", async () => {
    state.rendition = {
      data: {
        voice_id: DEFAULT_TTS_VOICE_ID,
        model: DEFAULT_TTS_MODEL_ID,
        content_hash: "hash-a",
        storage_path: `${TENANT}/${POST}/pl.mp3`,
        byte_size: 1024,
        char_count: 500,
        synth_count: 1,
        synthesized_at: "2026-08-03T10:00:00.000Z",
      },
      error: null,
    };
    const plan = await resolveCanonicalTtsPlan({
      tenantId: TENANT,
      postId: POST,
      lang: "pl",
      overrides: null,
      contentHash: "hash-a",
    });
    expect(plan.fresh).toBe(true);
    expect(plan.rendition?.synth_count).toBe(1);
  });

  it("nagranie innym głosem => nieświeże, mimo zgodnej treści", async () => {
    state.rendition = {
      data: {
        voice_id: MATILDA,
        model: DEFAULT_TTS_MODEL_ID,
        content_hash: "hash-a",
        storage_path: `${TENANT}/${POST}/pl.mp3`,
        byte_size: 1024,
        char_count: 500,
        synth_count: 3,
        synthesized_at: "2026-08-03T10:00:00.000Z",
      },
      error: null,
    };
    const plan = await resolveCanonicalTtsPlan({
      tenantId: TENANT,
      postId: POST,
      lang: "pl",
      overrides: null,
      contentHash: "hash-a",
    });
    expect(plan.fresh).toBe(false);
  });

  it("rejestr niedostępny (środowisko przed migracją) => degradacja z hashem w ścieżce", async () => {
    state.renditionThrows = true;
    const plan = await resolveCanonicalTtsPlan({
      tenantId: TENANT,
      postId: POST,
      lang: "en",
      overrides: null,
      contentHash: "hash-a",
    });
    expect(plan.registryAvailable).toBe(false);
    expect(plan.storagePath).toBe(`${TENANT}/${POST}/en-hash-a.mp3`);
    // W degradacji o świeżości decyduje sama ścieżka - plik pod tym kluczem
    // powstał z tej treści, więc trafienie w storage jest trafieniem cache.
    expect(plan.fresh).toBe(true);
    // Nadal ANI głosu, ANI modelu w kluczu - amplifikacja z audytu nie wraca.
    expect(plan.storagePath).not.toContain(DEFAULT_TTS_VOICE_ID);
    expect(plan.storagePath).not.toContain(DEFAULT_TTS_MODEL_ID);
  });

  it("błąd odczytu rejestru też degraduje, zamiast wywalać żądanie", async () => {
    state.rendition = { data: null, error: { message: "permission denied" } };
    const plan = await resolveCanonicalTtsPlan({
      tenantId: TENANT,
      postId: POST,
      lang: "pl",
      overrides: null,
      contentHash: "hash-b",
    });
    expect(plan.registryAvailable).toBe(false);
    expect(plan.storagePath).toBe(`${TENANT}/${POST}/pl-hash-b.mp3`);
  });
});

describe("recordTtsRendition", () => {
  it("woła RPC z kanoniczną parą i telemetrią kosztu (tenant wyprowadza baza)", async () => {
    await recordTtsRendition({
      postId: POST,
      lang: "pl",
      pin: { voiceId: SARAH, model: DEFAULT_TTS_MODEL_ID, voiceSource: "tenant" },
      contentHash: "hash-a",
      storagePath: `${TENANT}/${POST}/pl.mp3`,
      byteSize: 2048,
      charCount: 900,
    });
    expect(state.rpcCalls).toHaveLength(1);
    const call = state.rpcCalls[0];
    expect(call.name).toBe("record_post_tts_rendition");
    expect(call.args).toEqual({
      _post_id: POST,
      _lang: "pl",
      _voice_id: SARAH,
      _model: DEFAULT_TTS_MODEL_ID,
      _content_hash: "hash-a",
      _storage_path: `${TENANT}/${POST}/pl.mp3`,
      _byte_size: 2048,
      _char_count: 900,
    });
    expect(Object.keys(call.args)).not.toContain("_tenant_id");
  });

  it("błąd zapisu nie rzuca (odpowiedź audio nie może paść z powodu telemetrii)", async () => {
    state.rpcError = { message: "rpc missing" };
    await expect(
      recordTtsRendition({
        postId: POST,
        lang: "en",
        pin: { voiceId: SARAH, model: DEFAULT_TTS_MODEL_ID, voiceSource: "post" },
        contentHash: "hash-a",
        storagePath: `${TENANT}/${POST}/en.mp3`,
        byteSize: 1,
        charCount: 1,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("coalesceTtsSynthesis (premiera artykułu = jedna płatna synteza)", () => {
  it("równoległe żądania tego samego klucza dzielą jedną syntezę", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const synthesize = async (): Promise<ArrayBuffer> => {
      calls += 1;
      await gate;
      return new ArrayBuffer(8);
    };

    const key = `${TENANT}/${POST}/pl.mp3`;
    const a = coalesceTtsSynthesis(key, synthesize);
    const b = coalesceTtsSynthesis(key, synthesize);
    const c = coalesceTtsSynthesis(key, synthesize);
    expect(inflightTtsSynthesisCount()).toBe(1);
    release();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(calls).toBe(1);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
    expect(inflightTtsSynthesisCount()).toBe(0);
  });

  it("różne klucze syntezują niezależnie", async () => {
    let calls = 0;
    const synthesize = async (): Promise<ArrayBuffer> => {
      calls += 1;
      return new ArrayBuffer(4);
    };
    await Promise.all([
      coalesceTtsSynthesis(`${TENANT}/${POST}/pl.mp3`, synthesize),
      coalesceTtsSynthesis(`${TENANT}/${POST}/en.mp3`, synthesize),
    ]);
    expect(calls).toBe(2);
  });

  it("nieudana synteza zwalnia klucz (kolejne żądanie może spróbować ponownie)", async () => {
    const boom = () => Promise.reject(new Error("upstream 500"));
    await expect(coalesceTtsSynthesis("k", boom)).rejects.toThrow("upstream 500");
    expect(inflightTtsSynthesisCount()).toBe(0);
    const ok = await coalesceTtsSynthesis("k", async () => new ArrayBuffer(2));
    expect(ok.byteLength).toBe(2);
  });
});
