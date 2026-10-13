// Znacznik kolejki urządzenia (OPS-12): odczyt z odpowiedzi bazy, wybór
// najnowszego i sejf na dysku - reguła czysta plus szyfrowanie.
//
// PO CO. Po terminie poświadczenia baza przyjmuje skan z kolejki jeszcze przez
// 72 h WYŁĄCZNIE ze znacznikiem (`_event_scanner_device_auth_sync`): znacznik
// musi zweryfikować się podpisem TEGO urządzenia, a chwila skanu mieścić się
// w [wydanie − 15 min, wydanie + 24 h] i przed terminem. Bez znacznika każda
// pozycja wysłana po terminie wraca jako `device_expired` i ląduje na liście
// odrzuconych - obecność i leady nie trafiają do bazy (recenzja R0/R11).
//
// STEMPEL W CHWILI KOLEJKOWANIA, NIE WYSYŁKI. Baza sprawdza, czy skan zapadł
// najwyżej kwadrans PRZED wydaniem znacznika. Znacznik doklejony dopiero przy
// wysyłce (świeży, sprzed minuty) odrzuciłby każdy skan sprzed godzin - dlatego
// środowisko stempluje pozycję znacznikiem aktualnym w chwili, w której trafia
// do kolejki (`useScanner` -> `queue`), a pozycja niesie go do końca, w części
// tajnej sejfu (`scannerStorage.ts`).
//
// NAJNOWSZY WYGRYWA. Znacznik przychodzi z konfiguracji (`event_scanner_bootstrap`),
// z każdej strony listy offline (`event_scanner_roster`) i z każdego zapisu
// (`event_checkin_record`, `event_lead_scan_record`). Odpowiedzi potrafią
// dojechać w innej kolejności, niż wyszły, więc o tym, który jest nowszy,
// decyduje `queue_marker_valid_until` (= LEAST(termin, wydanie + 24 h)),
// a nie kolejność odbioru. Odpowiedź BEZ znacznika (poświadczenie po terminie
// dostaje pusty obiekt) niczego nie kasuje - ostatni znacznik zostaje.
//
// ZNACZNIK JEST NIEPRZEZROCZYSTY. Klient nie czyta z niego daty ani podpisu -
// sprawdza tylko, że to napis bez znaków spoza base64url, i odsyła go bez zmian.
// O ważności decyduje baza.
//
// NA DYSKU TYLKO W SEJFIE. Znacznik nie jest poświadczeniem wejścia, ale razem
// z przechwyconym tokenem pozwala dopisać skany po terminie - leży więc obok
// kodów z biletów: w bloku AES-GCM z kluczem z tokenu (`scannerVault.ts`), a AAD
// wiąże blok z urządzeniem. Przeglądarka bez WebCrypto trzyma go wyłącznie
// w pamięci karty.
//
// DEKLARACJA ZDOLNOŚCI. Klient, który umie stemplować kolejkę, mówi o tym bazie
// w `event_scanner_bootstrap` i `event_scanner_roster` (`client_caps`). Baza od
// tej chwili odrzuca po terminie pozycje bez znacznika; urządzenie, które nigdy
// się nie zadeklarowało (stara wersja aplikacji), zostaje przy dawnej regule
// 72 h, dopóki się nie zaktualizuje.
import { openJson, sealJson, type SealedBlob } from "@/lib/events/scannerVault";

/** Zdolności tego klienta deklarowane bazie (`client_caps`). */
export const SCANNER_CLIENT_CAPS = ["queue_marker"] as const;

export interface QueueMarker {
  /** Nieprzezroczysty napis bazy - odsyłany bez zmian jako `queue_marker`. */
  value: string;
  /** Do tej chwili skan z kolejki może się na ten znacznik powołać (`null` = nieznana). */
  validUntil: string | null;
}

/** Znacznik należy do urządzenia - nigdy nie jedzie z pozycją innego. */
export interface DeviceQueueMarker {
  deviceId: string;
  marker: QueueMarker;
}

/** Kształt napisu: base64url bez dopełnienia; długość z zapasem wobec dzisiejszych 54 znaków. */
const MARKER_SHAPE = /^[A-Za-z0-9_-]{16,512}$/;

/**
 * Pola `queue_marker` i `queue_marker_valid_until` z odpowiedzi bazy. `null`,
 * gdy odpowiedź nie niesie znacznika albo niesie coś, co nim nie jest.
 */
export function parseQueueMarker(response: unknown): QueueMarker | null {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
  const row = response as Record<string, unknown>;
  const value = typeof row.queue_marker === "string" ? row.queue_marker.trim() : "";
  if (!MARKER_SHAPE.test(value)) return null;
  const until = row.queue_marker_valid_until;
  const validUntil = typeof until === "string" && !Number.isNaN(Date.parse(until)) ? until : null;
  return { value, validUntil };
}

/**
 * Który znacznik trzymać: nowy, chyba że jego termin jest WCZEŚNIEJSZY niż
 * terminu trzymanego (spóźniona odpowiedź na starsze żądanie). Brak nowego =
 * trzymany zostaje.
 */
export function newerQueueMarker(
  current: QueueMarker | null,
  next: QueueMarker | null,
): QueueMarker | null {
  if (next === null) return current;
  if (current === null) return next;
  const held = current.validUntil === null ? Number.NaN : Date.parse(current.validUntil);
  const fresh = next.validUntil === null ? Number.NaN : Date.parse(next.validUntil);
  if (!Number.isNaN(held) && !Number.isNaN(fresh) && fresh < held) return current;
  return next;
}

/** Napis znacznika dla pozycji urządzenia `deviceId` - `null`, gdy znacznik jest cudzy albo go nie ma. */
export function queueMarkerFor(
  held: DeviceQueueMarker | null,
  deviceId: string | null | undefined,
): string | null {
  if (held === null || deviceId === null || deviceId === undefined) return null;
  return held.deviceId === deviceId ? held.marker.value : null;
}

/**
 * Co ile (po terminie znacznika) zapisywać nowszy znacznik na dysk. Znacznik
 * z dysku jest potrzebny tylko po starcie bez sieci; kwadrans opóźnienia
 * kosztuje najwyżej kwadrans z dwudziestu czterech godzin horyzontu, a zapis
 * przy KAŻDEJ odpowiedzi to szyfrowanie i zapis IndexedDB przy każdym skanie.
 */
export const QUEUE_MARKER_PERSIST_STEP_MS = 5 * 60_000;

/** Czy nowy znacznik wart jest zapisu na dysk wobec tego, który już tam leży. */
export function shouldPersistQueueMarker(
  persisted: DeviceQueueMarker | null,
  next: DeviceQueueMarker,
): boolean {
  if (persisted === null || persisted.deviceId !== next.deviceId) return true;
  if (persisted.marker.value === next.marker.value) return false;
  const held =
    persisted.marker.validUntil === null ? Number.NaN : Date.parse(persisted.marker.validUntil);
  const fresh = next.marker.validUntil === null ? Number.NaN : Date.parse(next.marker.validUntil);
  if (Number.isNaN(held) || Number.isNaN(fresh)) return true;
  return fresh - held >= QUEUE_MARKER_PERSIST_STEP_MS;
}

/* ---------------------------------------------------------------- sejf --- */

/** AAD bloku znacznika: przestrzeń nazw inna niż pozycje kolejki + urządzenie. */
function markerAad(deviceId: string): string {
  return `queue-marker:${deviceId}`;
}

/** Znacznik -> blok sejfu związany z urządzeniem. */
export function sealQueueMarker(
  key: CryptoKey,
  deviceId: string,
  marker: QueueMarker,
): Promise<SealedBlob> {
  return sealJson(key, markerAad(deviceId), {
    value: marker.value,
    validUntil: marker.validUntil,
  });
}

/** Blok -> znacznik; `null` = cudzy klucz, cudze urządzenie albo uszkodzony zapis. */
export async function openQueueMarker(
  key: CryptoKey,
  deviceId: string,
  blob: SealedBlob,
): Promise<QueueMarker | null> {
  const opened = await openJson(key, markerAad(deviceId), blob);
  if (typeof opened !== "object" || opened === null) return null;
  const row = opened as Record<string, unknown>;
  return parseQueueMarker({
    queue_marker: row.value,
    queue_marker_valid_until: row.validUntil,
  });
}
