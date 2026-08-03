// Bramka inwariantu z audytu 2026-08-03 (moduł 1, "Audio artykułu"):
// na (wpis, język) istnieje DOKŁADNIE JEDNA kanoniczna para (głos, model) i
// DOKŁADNIE JEDEN plik audio, a klient nie ma wpływu na żaden z tych wymiarów.
//
// Testy celują w tę własność wprost: klucz cache jest niezmienny wobec
// konfiguracji, allowlisty nie da się obejść, a nieświeżość jest wykrywana w
// każdym wymiarze (treść, głos, model).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_TTS_SETTINGS,
  DEFAULT_TTS_VOICE_ID,
  TTS_MODELS,
  TTS_VOICES,
  findTtsModel,
  findTtsVoice,
  isAllowedTtsModelId,
  isAllowedTtsVoiceId,
  isTtsRenditionFresh,
  parseTtsSettings,
  resolveCanonicalTtsPin,
  ttsCacheObjectPath,
  ttsRenditionEtag,
  type TtsCanonicalSettings,
} from "@/lib/audio/ttsCanonical";

const TENANT = "11111111-1111-1111-1111-111111111111";
const POST = "22222222-2222-2222-2222-222222222222";
const SARAH = "EXAVITQu4vr4xnSDxMaL";
const MATILDA = "XrExE9yKIg1WjnnlVkGX";

const settings = (over: Partial<TtsCanonicalSettings> = {}): TtsCanonicalSettings => ({
  ...DEFAULT_TTS_SETTINGS,
  ...over,
});

describe("allowlisty głosów i modeli", () => {
  it("domyślne wartości należą do allowlisty (konfiguracja startowa jest legalna)", () => {
    expect(isAllowedTtsVoiceId(DEFAULT_TTS_VOICE_ID)).toBe(true);
    expect(isAllowedTtsModelId(DEFAULT_TTS_MODEL_ID)).toBe(true);
  });

  it("odrzuca id spoza listy, puste i nie-stringi", () => {
    expect(isAllowedTtsVoiceId("nieistniejacy")).toBe(false);
    expect(isAllowedTtsVoiceId("")).toBe(false);
    expect(isAllowedTtsVoiceId(null)).toBe(false);
    expect(isAllowedTtsVoiceId(42)).toBe(false);
    expect(isAllowedTtsModelId("eleven_super_expensive_v9")).toBe(false);
    expect(isAllowedTtsModelId(undefined)).toBe(false);
  });

  it("katalog jest wolny od duplikatów id (klucz cache musi być jednoznaczny)", () => {
    expect(new Set(TTS_VOICES.map((v) => v.id)).size).toBe(TTS_VOICES.length);
    expect(new Set(TTS_MODELS.map((m) => m.id)).size).toBe(TTS_MODELS.length);
  });

  it("findTtsVoice / findTtsModel zwracają metadane albo null, nigdy nie rzucają", () => {
    expect(findTtsVoice(SARAH)?.name).toBe("Sarah");
    expect(findTtsVoice("obcy")).toBeNull();
    expect(findTtsVoice(null)).toBeNull();
    expect(findTtsModel(DEFAULT_TTS_MODEL_ID)?.tier).toBe("quality");
    expect(findTtsModel("obcy")).toBeNull();
  });
});

describe("parseTtsSettings (wiersz site_settings jest wejściem niezaufanym)", () => {
  it("brak wartości / zły typ => platformowe wartości domyślne", () => {
    expect(parseTtsSettings(null)).toEqual(DEFAULT_TTS_SETTINGS);
    expect(parseTtsSettings(undefined)).toEqual(DEFAULT_TTS_SETTINGS);
    expect(parseTtsSettings("reading")).toEqual(DEFAULT_TTS_SETTINGS);
    expect(parseTtsSettings([1, 2, 3])).toEqual(DEFAULT_TTS_SETTINGS);
  });

  it("czyta wyłącznie pola TTS z całego wiersza ustawień czytania", () => {
    const parsed = parseTtsSettings({
      posts_per_page: 10,
      homepage_mode: "latest_posts",
      tts_voice_pl: SARAH,
      tts_voice_en: MATILDA,
      tts_model: "eleven_turbo_v2_5",
    });
    expect(parsed).toEqual({
      tts_voice_pl: SARAH,
      tts_voice_en: MATILDA,
      tts_model: "eleven_turbo_v2_5",
    });
  });

  it("wartość spoza allowlisty degraduje do domyślnej, nie do błędu", () => {
    const parsed = parseTtsSettings({
      tts_voice_pl: "wstrzyknieta-wartosc",
      tts_voice_en: 7,
      tts_model: "eleven_super_expensive_v9",
    });
    expect(parsed).toEqual(DEFAULT_TTS_SETTINGS);
  });
});

describe("resolveCanonicalTtsPin (kolejność: wpis -> najemca -> platforma)", () => {
  it("bez nadpisania używa głosu najemcy dla właściwego języka", () => {
    const s = settings({ tts_voice_pl: SARAH, tts_voice_en: MATILDA });
    expect(resolveCanonicalTtsPin({ settings: s, lang: "pl", overrides: null })).toEqual({
      voiceId: SARAH,
      model: DEFAULT_TTS_MODEL_ID,
      voiceSource: "tenant",
    });
    expect(resolveCanonicalTtsPin({ settings: s, lang: "en", overrides: null })).toEqual({
      voiceId: MATILDA,
      model: DEFAULT_TTS_MODEL_ID,
      voiceSource: "tenant",
    });
  });

  it("nadpisanie redakcyjne wygrywa z ustawieniem najemcy - tylko w swoim języku", () => {
    const s = settings({ tts_voice_pl: SARAH, tts_voice_en: SARAH });
    const overrides = { pl: MATILDA, en: null };
    expect(resolveCanonicalTtsPin({ settings: s, lang: "pl", overrides })).toEqual({
      voiceId: MATILDA,
      model: DEFAULT_TTS_MODEL_ID,
      voiceSource: "post",
    });
    expect(resolveCanonicalTtsPin({ settings: s, lang: "en", overrides }).voiceId).toBe(SARAH);
  });

  it("nadpisanie spoza allowlisty jest ignorowane (baza i tak by go nie przyjęła)", () => {
    const pin = resolveCanonicalTtsPin({
      settings: settings({ tts_voice_pl: SARAH }),
      lang: "pl",
      overrides: { pl: "../../etc/passwd", en: null },
    });
    expect(pin).toEqual({ voiceId: SARAH, model: DEFAULT_TTS_MODEL_ID, voiceSource: "tenant" });
  });

  it("model pochodzi zawsze od najemcy - nie ma nadpisania per wpis", () => {
    const pin = resolveCanonicalTtsPin({
      settings: settings({ tts_model: "eleven_turbo_v2_5" }),
      lang: "en",
      overrides: { pl: MATILDA, en: MATILDA },
    });
    expect(pin.model).toBe("eleven_turbo_v2_5");
  });

  it("jest totalna: uszkodzone ustawienia nadal dają parę z allowlisty", () => {
    const broken = { tts_voice_pl: "x", tts_voice_en: "y", tts_model: "z" } as TtsCanonicalSettings;
    const pin = resolveCanonicalTtsPin({ settings: broken, lang: "pl", overrides: null });
    expect(isAllowedTtsVoiceId(pin.voiceId)).toBe(true);
    expect(isAllowedTtsModelId(pin.model)).toBe(true);
  });
});

describe("ttsCacheObjectPath (dowód usunięcia amplifikacji plików)", () => {
  it("klucz to (tenant, wpis, język) - bez głosu i modelu", () => {
    expect(ttsCacheObjectPath(TENANT, POST, "pl")).toBe(`${TENANT}/${POST}/pl.mp3`);
    expect(ttsCacheObjectPath(TENANT, POST, "en")).toBe(`${TENANT}/${POST}/en.mp3`);
  });

  it("cała allowlista głosów i modeli mapuje się na 2 pliki na wpis, nie na 24", () => {
    const paths = new Set<string>();
    for (const voice of TTS_VOICES) {
      for (const model of TTS_MODELS) {
        for (const lang of ["pl", "en"] as const) {
          // Ścieżka nie ma nawet PARAMETRU na głos i model - to inwariant
          // typu, nie konwencja: 6 głosów × 2 modele × 2 języki => 2 pliki.
          void voice;
          void model;
          paths.add(ttsCacheObjectPath(TENANT, POST, lang));
        }
      }
    }
    expect(paths.size).toBe(2);
  });

  it("różne najemcy i wpisy nie dzielą klucza (izolacja w warstwie storage)", () => {
    const other = "33333333-3333-3333-3333-333333333333";
    expect(ttsCacheObjectPath(other, POST, "pl")).not.toBe(ttsCacheObjectPath(TENANT, POST, "pl"));
    expect(ttsCacheObjectPath(TENANT, other, "pl")).not.toBe(
      ttsCacheObjectPath(TENANT, POST, "pl"),
    );
  });

  it("tryb degradacji (brak rejestru) dokłada tylko hash treści", () => {
    expect(ttsCacheObjectPath(TENANT, POST, "pl", "abc123")).toBe(
      `${TENANT}/${POST}/pl-abc123.mp3`,
    );
  });
});

describe("ttsRenditionEtag", () => {
  const pin = { voiceId: SARAH, model: DEFAULT_TTS_MODEL_ID, voiceSource: "tenant" } as const;

  it("zmiana treści zmienia ETag", () => {
    expect(ttsRenditionEtag("hash-a", pin)).not.toBe(ttsRenditionEtag("hash-b", pin));
  });

  it("zmiana głosu unieważnia cache przeglądarki (inaczej 304 grałoby starym lektorem)", () => {
    const other = { ...pin, voiceId: MATILDA };
    expect(ttsRenditionEtag("hash-a", pin)).not.toBe(ttsRenditionEtag("hash-a", other));
  });

  it("zmiana modelu też zmienia ETag", () => {
    const other = { ...pin, model: "eleven_turbo_v2_5" };
    expect(ttsRenditionEtag("hash-a", pin)).not.toBe(ttsRenditionEtag("hash-a", other));
  });

  it("jest poprawnym, cytowanym ETagiem", () => {
    expect(ttsRenditionEtag("hash-a", pin)).toMatch(/^"tts-.+"$/);
  });
});

describe("isTtsRenditionFresh (każdy wymiar musi się zgadzać)", () => {
  const pin = { voiceId: SARAH, model: DEFAULT_TTS_MODEL_ID, voiceSource: "tenant" } as const;
  const row = { voice_id: SARAH, model: DEFAULT_TTS_MODEL_ID, content_hash: "hash-a" };

  it("zgodne treść + głos + model => świeże", () => {
    expect(isTtsRenditionFresh(row, "hash-a", pin)).toBe(true);
  });

  it("brak wiersza => nieświeże (brak dowodu nie jest trafieniem)", () => {
    expect(isTtsRenditionFresh(null, "hash-a", pin)).toBe(false);
    expect(isTtsRenditionFresh(undefined, "hash-a", pin)).toBe(false);
  });

  it("zmieniona treść => nieświeże", () => {
    expect(isTtsRenditionFresh(row, "hash-b", pin)).toBe(false);
  });

  it("zmieniony kanoniczny głos => nieświeże (decyzja redakcji wygrywa z plikiem)", () => {
    expect(isTtsRenditionFresh(row, "hash-a", { ...pin, voiceId: MATILDA })).toBe(false);
  });

  it("zmieniony model => nieświeże", () => {
    expect(isTtsRenditionFresh(row, "hash-a", { ...pin, model: "eleven_turbo_v2_5" })).toBe(false);
  });
});
