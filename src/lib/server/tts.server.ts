// Kanoniczny lektor artykułu - warstwa SERWEROWA (service role, zero React).
//
// Odpowiada za trzy rzeczy, których czysta logika z lib/audio/ttsCanonical.ts
// nie może zrobić sama:
//   1. odczyt kanonicznych ustawień najemcy (site_settings.reading) z cache
//      per-izolat, żeby publiczny endpoint nie dokładał round-tripu na żądanie,
//   2. odczyt i zapis rejestru `post_tts_renditions` (jedno nagranie na wpis
//      i język) wraz z DEGRADACJĄ na środowiskach przed migracją 20260803120000,
//   3. koalescencję równoległych syntez: dwóch czytelników, którzy trafią na
//      zimny wpis w tej samej sekundzie, płaci JEDNĄ syntezę, nie dwie.
//
// Wszystkie ścieżki są zawężane po `tenant_id` JAWNIE - service role omija RLS,
// więc bez tego filtra audio najemcy A dałoby się wygenerować z domeny B.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  DEFAULT_TTS_SETTINGS,
  isTtsRenditionFresh,
  parseTtsSettings,
  resolveCanonicalTtsPin,
  ttsCacheObjectPath,
  type TtsCanonicalPin,
  type TtsCanonicalSettings,
  type TtsLang,
  type TtsRenditionState,
  type TtsVoiceOverrides,
} from "@/lib/audio/ttsCanonical";

/** Prywatny bucket zsyntezowanych MP3 (migracja 20260711120100). */
export const TTS_CACHE_BUCKET = "tts-cache";

/**
 * Hash rewizji treści. SHA-256 skrócony do 128 bitów: dla klucza cache liczy
 * się brak kolizji przy edycji artykułu, a nie długość - poprzedni FNV-1a
 * (32 bity) dawał realne ryzyko, że zmieniona treść trafi w stary hash i
 * czytelnik dostanie audio poprzedniej wersji.
 */
export function ttsContentHash(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input))).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Ustawienia najemcy (site_settings.reading) - cache per izolat
// ---------------------------------------------------------------------------

const SETTINGS_TTL_MS = 60_000;

interface SettingsCacheEntry {
  readonly at: number;
  readonly settings: TtsCanonicalSettings;
}

const settingsCache = new Map<string, SettingsCacheEntry>();

/** Hook testowy / inwalidacja po zapisie w panelu. */
export function invalidateTtsSettingsCache(): void {
  settingsCache.clear();
}

/**
 * Kanoniczne ustawienia lektora najemcy. Awaria odczytu degraduje do
 * platformowych wartości domyślnych (czytelnik dostaje audio, nie 500) - to
 * bezpieczne, bo domyślne też są z allowlisty i też są JEDNĄ parą.
 */
export async function resolveTenantTtsSettings(tenantId: string): Promise<TtsCanonicalSettings> {
  const cached = settingsCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.at < SETTINGS_TTL_MS) return cached.settings;

  let settings = DEFAULT_TTS_SETTINGS;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", "reading")
      .maybeSingle();
    settings = parseTtsSettings(data?.value ?? null);
  } catch (e) {
    console.warn("[post-tts] tenant settings read failed, using defaults:", e);
  }
  settingsCache.set(tenantId, { at: now, settings });
  return settings;
}

// ---------------------------------------------------------------------------
// Rejestr kanonicznych nagrań
// ---------------------------------------------------------------------------

export interface TtsRenditionRow extends TtsRenditionState {
  readonly storage_path: string;
  readonly byte_size: number;
  readonly char_count: number;
  readonly synth_count: number;
  readonly synthesized_at: string;
}

export interface CanonicalTtsPlan {
  /** Kanoniczna para (głos, model) - jedyna dopuszczona do syntezy. */
  readonly pin: TtsCanonicalPin;
  /** Ścieżka obiektu w `tts-cache` (bez głosu i modelu w kluczu). */
  readonly storagePath: string;
  /** Zapisane nagranie, jeśli rejestr jest dostępny i wiersz istnieje. */
  readonly rendition: TtsRenditionRow | null;
  /** Czy zapisany obiekt wolno podać bez ponownej syntezy. */
  readonly fresh: boolean;
  /**
   * Tryb degradacji: rejestr niedostępny (środowisko przed migracją). Świeżość
   * wraca wtedy do ścieżki (hash w nazwie), a zapisu rejestru nie próbujemy.
   */
  readonly registryAvailable: boolean;
}

/**
 * Odczyt wiersza rejestru. `null` = brak wiersza; `undefined` = rejestr
 * niedostępny (brak tabeli / awaria) i wołający musi zdegradować.
 */
async function readRendition(
  tenantId: string,
  postId: string,
  lang: TtsLang,
): Promise<TtsRenditionRow | null | undefined> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("post_tts_renditions")
      .select(
        "voice_id, model, content_hash, storage_path, byte_size, char_count, synth_count, synthesized_at",
      )
      .eq("post_id", postId)
      .eq("lang", lang)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      console.warn(`[post-tts] rendition read failed (${postId}/${lang}): ${error.message}`);
      return undefined;
    }
    return data ?? null;
  } catch (e) {
    console.warn(`[post-tts] rendition read threw (${postId}/${lang}):`, e);
    return undefined;
  }
}

/**
 * Kompletny plan wygenerowania (albo podania z cache) audio dla wpisu w danym
 * języku. Klient NIE wnosi tu żadnego wejścia poza `postId` i `lang` - głos i
 * model pochodzą z nadpisania redakcyjnego albo ustawień najemcy.
 */
export async function resolveCanonicalTtsPlan(input: {
  readonly tenantId: string;
  readonly postId: string;
  readonly lang: TtsLang;
  readonly overrides: TtsVoiceOverrides | null;
  readonly contentHash: string;
}): Promise<CanonicalTtsPlan> {
  const { tenantId, postId, lang, overrides, contentHash } = input;
  const settings = await resolveTenantTtsSettings(tenantId);
  const pin = resolveCanonicalTtsPin({ settings, lang, overrides });

  const rendition = await readRendition(tenantId, postId, lang);
  const registryAvailable = rendition !== undefined;

  // Bez rejestru świeżość nie ma gdzie być zapisana, więc wraca do nazwy pliku.
  // Głos ani model NIGDY nie wchodzą do klucza - w obu trybach liczba plików
  // rośnie najwyżej z rewizjami treści, nie z liczbą kombinacji konfiguracji.
  const storagePath = registryAvailable
    ? ttsCacheObjectPath(tenantId, postId, lang)
    : ttsCacheObjectPath(tenantId, postId, lang, contentHash);

  const row = rendition ?? null;
  return {
    pin,
    storagePath,
    rendition: row,
    // W trybie degradacji o świeżości decyduje sama ścieżka: plik pod tym
    // kluczem powstał z tej treści, więc trafienie w storage = trafienie.
    fresh: registryAvailable ? isTtsRenditionFresh(row, contentHash, pin) : true,
    registryAvailable,
  };
}

/**
 * Utrwala fakt zsyntezowania kanonicznego nagrania. Wołane PO uploadzie, żeby
 * rejestr nigdy nie wskazywał obiektu, którego nie ma. Błąd nie przerywa
 * odpowiedzi - najwyżej kolejne żądanie zapłaci jeszcze jedną syntezę, a to
 * jest widoczne w `synth_count`.
 */
export async function recordTtsRendition(input: {
  readonly postId: string;
  readonly lang: TtsLang;
  readonly pin: TtsCanonicalPin;
  readonly contentHash: string;
  readonly storagePath: string;
  readonly byteSize: number;
  readonly charCount: number;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("record_post_tts_rendition", {
      _post_id: input.postId,
      _lang: input.lang,
      _voice_id: input.pin.voiceId,
      _model: input.pin.model,
      _content_hash: input.contentHash,
      _storage_path: input.storagePath,
      _byte_size: input.byteSize,
      _char_count: input.charCount,
    });
    if (error) {
      console.warn(
        `[post-tts] rendition write failed (${input.postId}/${input.lang}): ${error.message}`,
      );
    }
  } catch (e) {
    console.warn(`[post-tts] rendition write threw (${input.postId}/${input.lang}):`, e);
  }
}

// ---------------------------------------------------------------------------
// Koalescencja syntez w izolacie
// ---------------------------------------------------------------------------

const inflightSynthesis = new Map<string, Promise<ArrayBuffer>>();

/**
 * Jedna synteza na klucz w danym izolacie. Bez tego premiera artykułu (wielu
 * czytelników naraz na zimnym cache) mnożyła płatne wywołania ElevenLabs
 * dokładnie tyle razy, ile było równoległych żądań - cache zapisywał się
 * dopiero po pierwszej odpowiedzi.
 *
 * Świadomy zakres: koalescencja jest per izolat, nie globalna. Dedup między
 * izolatami wymagałby blokady w bazie i nie jest tu wart złożoności - twarde
 * limity kosztu trzymają rate-limity fail-closed w endpointcie.
 */
export async function coalesceTtsSynthesis(
  key: string,
  synthesize: () => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const pending = inflightSynthesis.get(key);
  if (pending) return pending;
  const run = synthesize().finally(() => {
    inflightSynthesis.delete(key);
  });
  inflightSynthesis.set(key, run);
  return run;
}

/** Hook testowy: liczba trwających syntez w tym izolacie. */
export function inflightTtsSynthesisCount(): number {
  return inflightSynthesis.size;
}
