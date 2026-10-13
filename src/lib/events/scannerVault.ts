// Sejf kolejki skanera: szyfrowanie kodów z biletów na dysku urządzenia.
//
// PO CO. Kolejka skanów czekających na sieć (do 500 pozycji) i lista odrzuconych
// (do 2000) trzymały JAWNY kod z biletu - a kod to poświadczenie wejścia przy
// bramce. Telefon wolontariusza po wydarzeniu (zgubiony albo prywatny) zachowywał
// ważne kody na zawsze. Teraz kod leży na dysku wyłącznie w bloku AES-GCM,
// a listy, które nie muszą go wysłać (odrzucone, eksport), trzymają tylko skrót
// SHA-256 i kilka pierwszych znaków.
//
// KLUCZ Z TOKENU URZĄDZENIA. HKDF-SHA-256 z poświadczenia urządzenia (stała sól
// i etykieta `info`, wersjonowane) daje klucz AES-256-GCM jako NIEEKSPORTOWALNY
// `CryptoKey` - skrypt strony może nim szyfrować, ale nie wyciągnie go w postaci
// bajtów. Token ma 16-128 znaków base64url (zwykle 32, czyli 192 bity), więc
// stała sól nie osłabia wyprowadzenia. Odłączenie urządzenia kasuje token -
// i z nim jedyną drogę do odczytu tego, co mogło jeszcze zostać na dysku.
//
// KAŻDY BLOK MA WŁASNY 96-BITOWY IV, a identyfikator pozycji idzie jako dane
// uwierzytelnione (AAD): blok przeniesiony do innej pozycji nie da się otworzyć.
//
// BEZ WEBCRYPTO - ZAMKNIĘTE, NIE JAWNE. Strona po http (adres IP w sieci
// lokalnej) i stare WebView nie mają `crypto.subtle`. Wtedy `deriveVaultKey`
// oddaje `null`, a magazyn NIE zapisuje kodów wcale (kolejka żyje w pamięci
// karty, ekran ostrzega) - zamiast po cichu zapisać je jawnie.
//
// TEN SAM SEJF TRZYMA ZNACZNIK KOLEJKI URZĄDZENIA (OPS-12, `scannerQueueMarker.ts`):
// `sealJson`/`openJson` szyfrują dowolny obiekt, a AAD wiąże blok z miejscem
// (pozycja kolejki albo urządzenie), więc bloku nie da się przełożyć gdzie indziej.
//
// SKRÓT JEST TYM SAMYM SKRÓTEM CO W BAZIE. `sha256(btrim(kod))` to dokładnie
// `event_registrations.qr_token_hash` i klucz listy offline (`scannerHash.ts`),
// więc organizator odnajdzie zgłoszenie po skrócie z eksportu bez jawnego kodu.
import { sha256Hex } from "@/lib/events/scannerHash";

/** Ile pierwszych znaków kodu wolno pokazać operatorowi i zapisać w eksporcie. */
export const CODE_PREFIX_LENGTH = 6;

/** Wersjonowane etykiety HKDF - zmiana któregokolwiek to nowy format sejfu. */
const VAULT_SALT = "nes-scanner/outbox/salt/v1";
const VAULT_INFO = "nes-scanner/outbox/aes-256-gcm/v1";
const IV_BYTES = 12;

/** Zaszyfrowany ładunek pozycji: IV i szyfrogram (z tagiem GCM) w hex. */
export interface SealedBlob {
  iv: string;
  data: string;
}

/**
 * Część pozycji, która na dysku istnieje WYŁĄCZNIE zaszyfrowana. Obiekt, nie
 * lista pól: nowe pole tajne (np. znacznik kolejki od bazy) dochodzi bez
 * migracji formatu zapisu.
 */
export interface VaultSecret {
  code: string;
  note: string | null;
  queueMarker: string | null;
}

/** `btrim(code)` z bazy tnie WYŁĄCZNIE spacje - skrót musi liczyć się z tego samego. */
export function btrimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/** Skrót kodu w postaci, pod którą zna go baza i lista offline. */
export function scanCodeHash(code: string): Promise<string> {
  return sha256Hex(btrimSpaces(code));
}

/** Początek kodu do pokazania człowiekowi - nigdy cały kod. */
export function codePrefixOf(code: string): string {
  return btrimSpaces(code).slice(0, CODE_PREFIX_LENGTH);
}

function subtleCrypto(): SubtleCrypto | null {
  if (typeof crypto === "undefined") return null;
  const subtle = (crypto as Crypto | undefined)?.subtle;
  return subtle === undefined || subtle === null ? null : subtle;
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/**
 * Klucz sejfu dla poświadczenia urządzenia albo `null`, gdy przeglądarka nie
 * ma WebCrypto (patrz nagłówek: wtedy kod nie trafia na dysk wcale).
 */
export async function deriveVaultKey(token: string): Promise<CryptoKey | null> {
  const subtle = subtleCrypto();
  const clean = token.trim();
  if (subtle === null || clean === "") return null;
  try {
    const material = await subtle.importKey("raw", encoder.encode(clean), "HKDF", false, [
      "deriveKey",
    ]);
    return await subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(VAULT_SALT),
        info: encoder.encode(VAULT_INFO),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

export function isSealedBlob(value: unknown): value is SealedBlob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.iv === "string" &&
    row.iv.length === IV_BYTES * 2 &&
    typeof row.data === "string" &&
    row.data.length > 0
  );
}

/**
 * Szyfruje dowolną wartość JSON. `aad` (dane uwierzytelnione) wiąże blok
 * z miejscem, do którego należy - blok przeniesiony gdzie indziej się nie otworzy.
 */
export async function sealJson(key: CryptoKey, aad: string, value: unknown): Promise<SealedBlob> {
  const subtle = subtleCrypto();
  if (subtle === null) throw new Error("vault_unavailable: WebCrypto is missing");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { iv: toHex(iv), data: toHex(new Uint8Array(data)) };
}

/**
 * Otwiera blok `sealJson`. `undefined` = zły klucz (blok innego poświadczenia),
 * blok przeniesiony w inne miejsce (`aad`), uszkodzony zapis albo brak
 * WebCrypto. Nigdy nie rzuca.
 */
export async function openJson(key: CryptoKey, aad: string, blob: SealedBlob): Promise<unknown> {
  const subtle = subtleCrypto();
  const iv = fromHex(blob.iv);
  const data = fromHex(blob.data);
  if (subtle === null || iv === null || data === null || iv.length !== IV_BYTES) return undefined;
  try {
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
      key,
      data,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  } catch {
    return undefined;
  }
}

/** Szyfruje część tajną pozycji; `aad` (identyfikator pozycji) wiąże blok z pozycją. */
export function sealSecret(key: CryptoKey, aad: string, secret: VaultSecret): Promise<SealedBlob> {
  return sealJson(key, aad, secret);
}

/**
 * Otwiera blok pozycji. `null` = blok nie do otwarcia (patrz `openJson`) albo
 * bez kodu. Nigdy nie rzuca.
 */
export async function openSecret(
  key: CryptoKey,
  aad: string,
  blob: SealedBlob,
): Promise<VaultSecret | null> {
  const parsed = await openJson(key, aad, blob);
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.code !== "string" || row.code === "") return null;
  return {
    code: row.code,
    note: typeof row.note === "string" ? row.note : null,
    queueMarker: typeof row.queueMarker === "string" ? row.queueMarker : null,
  };
}
