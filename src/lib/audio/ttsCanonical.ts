// Kanoniczny lektor artykułu (TTS) - CZYSTA logika domenowa (zero React,
// zero Supabase, zero I/O). Jedno źródło prawdy dla:
//   * allowlisty głosów i modeli ElevenLabs (lustro CHECK-ów z migracji
//     20260803120000 - baza, serwer i UI nie mogą się rozjechać),
//   * rozstrzygania KANONICZNEJ pary (głos, model) dla wpisu w danym języku,
//   * deterministycznej ścieżki obiektu w prywatnym buckecie `tts-cache`,
//   * detekcji nieświeżości nagrania (stale rendition).
//
// PRZYCZYNA ZRODLOWA (audyt 2026-08-03, moduł 1, pozycja "Audio artykułu"):
// endpoint `/api/public/post-tts` przyjmował `voiceId` i `model` OD KLIENTA i
// kluczował cache po `(post, lang, voice, model, hash)`. Sześć głosów × dwa
// modele × dwa języki = do 24 PŁATNYCH syntez i 24 plików na jeden wpis, a
// wyzwalał je dowolny anonimowy czytelnik pętlą po allowliście. Allowlista
// ograniczała więc tylko KSZTAŁT nadużycia, nie jego koszt.
//
// INWARIANT (egzekwowany łącznie tu, w kluczu głównym `post_tts_renditions`
// i w ścieżce obiektu): dla wpisu i języka istnieje DOKŁADNIE JEDNA kanoniczna
// para (głos, model) i DOKŁADNIE JEDEN plik audio. Klient nie ma wpływu na
// żaden z tych wymiarów - wybiera go redakcja (nadpisanie per wpis) albo
// ustawienia najemcy, a serwer jest jedynym rozstrzygającym.

/** Języki, w których renderujemy narrację (parytet z resztą platformy). */
export type TtsLang = "pl" | "en";

/** Barwy głosu - klucz i18n `admin.reading.ttsTimbre.<timbre>` w obu językach. */
export type TtsTimbre =
  | "warmBaritone"
  | "softAlto"
  | "newsAnchor"
  | "brightYouthful"
  | "energeticUpbeat"
  | "calmFriendly";

export interface TtsVoice {
  /** Publiczny identyfikator głosu ElevenLabs. */
  readonly id: string;
  /** Nazwa własna głosu (nie tłumaczymy - to nazwa produktowa dostawcy). */
  readonly name: string;
  /** Barwa do opisu w UI; tekst pochodzi z i18n, nie z tego modułu. */
  readonly timbre: TtsTimbre;
}

/**
 * Allowlista głosów. Rozszerzenie tej listy WYMAGA migracji aktualizującej
 * CHECK-i `posts_tts_voice_*_check` - inaczej redakcja wybierze w panelu głos,
 * którego baza nie przyjmie.
 */
export const TTS_VOICES: readonly TtsVoice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", timbre: "warmBaritone" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", timbre: "softAlto" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", timbre: "newsAnchor" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", timbre: "brightYouthful" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", timbre: "energeticUpbeat" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", timbre: "calmFriendly" },
] as const;

/** Poziom modelu - klucz i18n `admin.reading.ttsModelTier.<tier>`. */
export type TtsModelTier = "quality" | "turbo";

export interface TtsModel {
  readonly id: string;
  readonly tier: TtsModelTier;
}

/**
 * Allowlista modeli. `eleven_multilingual_v2` to jakość referencyjna dla PL,
 * `eleven_turbo_v2_5` jest tańszy i szybszy (krótsze materiały, podglądy).
 * Model jest wymiarem KOSZTOWYM, więc pozostaje decyzją najemcy - nie ma
 * nadpisania per wpis, żeby jeden artykuł nie mnożył wariantów cenowych.
 */
export const TTS_MODELS: readonly TtsModel[] = [
  { id: "eleven_multilingual_v2", tier: "quality" },
  { id: "eleven_turbo_v2_5", tier: "turbo" },
] as const;

export const DEFAULT_TTS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
export const DEFAULT_TTS_MODEL_ID = "eleven_multilingual_v2";

/** Górny limit znaków jednej syntezy (lustro limitu endpointu i kosztu). */
export const TTS_MAX_CHARS = 5000;

const VOICE_IDS: ReadonlySet<string> = new Set(TTS_VOICES.map((v) => v.id));
const MODEL_IDS: ReadonlySet<string> = new Set(TTS_MODELS.map((m) => m.id));

export function isAllowedTtsVoiceId(value: unknown): value is string {
  return typeof value === "string" && VOICE_IDS.has(value);
}

export function isAllowedTtsModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_IDS.has(value);
}

/** Metadane głosu do prezentacji w panelu (null dla id spoza allowlisty). */
export function findTtsVoice(id: string | null | undefined): TtsVoice | null {
  if (typeof id !== "string") return null;
  return TTS_VOICES.find((v) => v.id === id) ?? null;
}

/** Metadane modelu do prezentacji w panelu (null dla id spoza allowlisty). */
export function findTtsModel(id: string | null | undefined): TtsModel | null {
  if (typeof id !== "string") return null;
  return TTS_MODELS.find((m) => m.id === id) ?? null;
}

/**
 * Kanoniczne ustawienia lektora najemcy. Trzymane w `site_settings` pod
 * kluczem `reading` (sekcja "Czytanie" w panelu), więc dziedziczą tenant-RLS
 * i historię rewizji tej tabeli - bez osobnej tabeli konfiguracji.
 */
export interface TtsCanonicalSettings {
  readonly tts_voice_pl: string;
  readonly tts_voice_en: string;
  readonly tts_model: string;
}

export const DEFAULT_TTS_SETTINGS: TtsCanonicalSettings = {
  tts_voice_pl: DEFAULT_TTS_VOICE_ID,
  tts_voice_en: DEFAULT_TTS_VOICE_ID,
  tts_model: DEFAULT_TTS_MODEL_ID,
};

function pickAllowed(
  source: Record<string, unknown>,
  key: keyof TtsCanonicalSettings,
  isAllowed: (value: unknown) => value is string,
  fallback: string,
): string {
  const raw = source[key];
  return isAllowed(raw) ? raw : fallback;
}

/**
 * Wyciąga ustawienia lektora z DOWOLNEJ wartości wiersza `site_settings`
 * (wartość jest JSON-em edytowanym w panelu, więc traktujemy ją jako wejście
 * niezaufane). Każde pole spoza allowlisty degraduje do domyślnej wartości -
 * literówka w konfiguracji nigdy nie przepycha do ElevenLabs modelu, którego
 * nie zamierzaliśmy płacić.
 */
export function parseTtsSettings(raw: unknown): TtsCanonicalSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_TTS_SETTINGS;
  }
  const source = raw as Record<string, unknown>;
  return {
    tts_voice_pl: pickAllowed(
      source,
      "tts_voice_pl",
      isAllowedTtsVoiceId,
      DEFAULT_TTS_SETTINGS.tts_voice_pl,
    ),
    tts_voice_en: pickAllowed(
      source,
      "tts_voice_en",
      isAllowedTtsVoiceId,
      DEFAULT_TTS_SETTINGS.tts_voice_en,
    ),
    tts_model: pickAllowed(
      source,
      "tts_model",
      isAllowedTtsModelId,
      DEFAULT_TTS_SETTINGS.tts_model,
    ),
  };
}

/** Redakcyjne nadpisanie głosu per wpis (kolumny `posts.tts_voice_pl/_en`). */
export interface TtsVoiceOverrides {
  readonly pl: string | null;
  readonly en: string | null;
}

/** Kanoniczna para (głos, model) - jedyna, którą serwer wolno zsyntezować. */
export interface TtsCanonicalPin {
  readonly voiceId: string;
  readonly model: string;
  /** Skąd wziął się głos - do telemetrii i podpowiedzi w panelu. */
  readonly voiceSource: "post" | "tenant";
}

/**
 * Rozstrzyga kanoniczną parę dla wpisu w danym języku. Kolejność:
 *   1. nadpisanie redakcyjne wpisu (jeśli mieści się w allowliście),
 *   2. ustawienie najemcy dla tego języka,
 *   3. platformowa wartość domyślna.
 * Funkcja jest TOTALNA i deterministyczna - nie ma wejścia, dla którego
 * zwróciłaby głos/model spoza allowlisty, więc żadna ścieżka wywołania nie
 * potrzebuje własnej walidacji.
 */
export function resolveCanonicalTtsPin(input: {
  readonly settings: TtsCanonicalSettings;
  readonly lang: TtsLang;
  readonly overrides?: TtsVoiceOverrides | null;
}): TtsCanonicalPin {
  const { settings, lang, overrides } = input;
  const override = lang === "en" ? overrides?.en : overrides?.pl;
  const tenantVoice = lang === "en" ? settings.tts_voice_en : settings.tts_voice_pl;
  const model = isAllowedTtsModelId(settings.tts_model) ? settings.tts_model : DEFAULT_TTS_MODEL_ID;

  if (isAllowedTtsVoiceId(override)) {
    return { voiceId: override, model, voiceSource: "post" };
  }
  return {
    voiceId: isAllowedTtsVoiceId(tenantVoice) ? tenantVoice : DEFAULT_TTS_VOICE_ID,
    model,
    voiceSource: "tenant",
  };
}

/**
 * Ścieżka obiektu w buckecie `tts-cache`.
 *
 * Klucz to `(tenant, wpis, język)` - BEZ głosu i modelu. To właśnie ta zmiana
 * domyka audytowaną amplifikację: kanoniczny plik jest jeden, a zmiana głosu
 * albo treści NADPISUJE go (upsert), zamiast dokładać kolejny wariant. Górna
 * granica liczby obiektów na wpis to 2 (PL + EN) - na zawsze, niezależnie od
 * liczby edycji i zmian konfiguracji.
 *
 * `contentHash` podajemy WYŁĄCZNIE w trybie degradacji (brak tabeli
 * `post_tts_renditions`, np. środowisko przed migracją): świeżość nie ma wtedy
 * gdzie być zapisana, więc wraca do ścieżki. Głosu i modelu nie ma tam nigdy.
 */
export function ttsCacheObjectPath(
  tenantId: string,
  postId: string,
  lang: TtsLang,
  contentHash?: string,
): string {
  const suffix = contentHash ? `${lang}-${contentHash}` : lang;
  return `${tenantId}/${postId}/${suffix}.mp3`;
}

/**
 * ETag odpowiedzi audio. Obejmuje treść ORAZ kanoniczną parę, więc zmiana
 * głosu przez redakcję unieważnia także cache przeglądarki (przy samym haszu
 * treści czytelnik dostawałby 304 i słuchał starego lektora).
 */
export function ttsRenditionEtag(contentHash: string, pin: TtsCanonicalPin): string {
  return `"tts-${contentHash}-${pin.voiceId}-${pin.model}"`;
}

/** Wiersz `post_tts_renditions` w zakresie istotnym dla decyzji o cache. */
export interface TtsRenditionState {
  readonly voice_id: string;
  readonly model: string;
  readonly content_hash: string;
}

/**
 * Czy zapisane nagranie wolno podać czytelnikowi. Świeże = zgodne w KAŻDYM
 * wymiarze: treść (hash), głos i model. Brak wiersza = brak dowodu świeżości,
 * więc traktujemy jak nieświeże (ponowna synteza), a nie jak trafienie.
 */
export function isTtsRenditionFresh(
  rendition: TtsRenditionState | null | undefined,
  contentHash: string,
  pin: TtsCanonicalPin,
): boolean {
  if (!rendition) return false;
  return (
    rendition.content_hash === contentHash &&
    rendition.voice_id === pin.voiceId &&
    rendition.model === pin.model
  );
}
