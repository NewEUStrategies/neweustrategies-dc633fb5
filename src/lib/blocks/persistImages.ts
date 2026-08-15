// Wklejone grafiki (Word / Google Docs / zrzuty ekranu) trafiają do treści
// jako `data:image/...;base64,...`. Przy zapisie wpisu takie obrazy MUSZĄ
// zostać wgrane do biblioteki mediów (bucket `media` + rejestracja w tabeli),
// a URL-e w dokumencie bloków podmienione na publiczne adresy storage:
//   1. baza nie puchnie od base64 w jsonb,
//   2. grafika jest widoczna w /admin/media jak każdy inny plik,
//   3. render publiczny serwuje ją z CDN-a storage, nie z dokumentu.
//
// Moduł jest czysty: skan/podmiana to funkcje na JSON-ie, a sam upload
// dostarcza wołający (hook edytora ma tenant/usera/server-fn). Dzięki temu
// całość jest testowalna bez Supabase.

import type { Json } from "./types";

/** Pełny data-URL obrazu jako samodzielna wartość pola (np. image.data.url). */
const DATA_URL_VALUE = /^data:image\/[a-z0-9.+-]+;base64,/i;
/** Data-URL-e osadzone w HTML-u bloku (np. `<img src="data:...">` w bloku html). */
const DATA_URL_IN_HTML = /(["'(])(data:image\/[a-z0-9.+-]+;base64,[^"')\s]+)/gi;

/** Zbiera wszystkie unikalne data-URL-e obrazów z dokumentu bloków. */
export function collectDataUrlImages(doc: Json): string[] {
  const found = new Set<string>();
  const visit = (value: Json): void => {
    if (typeof value === "string") {
      if (DATA_URL_VALUE.test(value)) {
        found.add(value);
        return;
      }
      DATA_URL_IN_HTML.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DATA_URL_IN_HTML.exec(value)) !== null) found.add(m[2]);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value && typeof value === "object") {
      for (const v of Object.values(value)) visit(v);
    }
  };
  visit(doc);
  return Array.from(found);
}

/**
 * Podmienia data-URL-e wg mapy (wartości pól i osadzenia w HTML-u).
 * Generyk zachowuje typ dokumentu wołającego (LocalizedBlocks, BuilderDocument…)
 * bez rzutowań po jego stronie - struktura wartości nie zmienia kształtu.
 *
 * DLACZEGO OGRANICZENIE `T extends Json` ZNIKŁO. Zdanie wyżej opisywało
 * intencję, której sygnatura NIE POZWALAŁA spełnić: `BuilderDocument` i
 * `LocalizedBlocks` to INTERFEJSY, a TypeScript nie nadaje interfejsom
 * domyślnej sygnatury indeksu - więc żaden z nich nie jest przypisywalny do
 * `Json`, choćby był w stu procentach serializowalny. Każdy wołający obchodził
 * to podwójnym rzutowaniem w obie strony (`doc as unknown as Json`, potem
 * `wynik as unknown as typeof doc`) - dziewięć takich par w samym haku edytora
 * wpisu. Jedno udokumentowane `as Json` wewnątrz jest uczciwsze niż dziewięć
 * nienazwanych na zewnątrz.
 *
 * KONTRAKT: `doc` ma być dokumentem SERIALIZOWALNYM DO JSON-a. Wartości spoza
 * tego zbioru (`Date`, `Map`, klasa) przejdą przez obchód drzewa jak zwykły
 * obiekt i stracą tożsamość - tak samo jak przy `JSON.parse(JSON.stringify(x))`.
 */
export function replaceDataUrlImages<T>(doc: T, replacements: Map<string, string>): T {
  if (replacements.size === 0) return doc;
  let mutations = 0;
  const visit = (value: Json): Json => {
    if (typeof value === "string") {
      const direct = replacements.get(value);
      if (direct) {
        mutations += 1;
        return direct;
      }
      DATA_URL_IN_HTML.lastIndex = 0;
      return value.replace(DATA_URL_IN_HTML, (whole, prefix: string, url: string) => {
        const mapped = replacements.get(url);
        if (!mapped) return whole;
        mutations += 1;
        return `${prefix}${mapped}`;
      });
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const out: Record<string, Json> = {};
      for (const [k, v] of Object.entries(value as Record<string, Json>)) out[k] = visit(v);
      return out;
    }
    return value;
  };
  const next = visit(doc as Json) as T;
  // Identyczność referencji, gdy mapa nie trafiła w żaden URL - wołający
  // (autosave, synchronizacja formularza) nie widzi wtedy pozornej zmiany.
  return mutations > 0 ? next : doc;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/apng": "apng",
};

export interface DecodedDataUrl {
  mime: string;
  bytes: Uint8Array;
  filename: string;
}

/** Dekoduje data-URL do bajtów + proponowanej nazwy pliku. `null` gdy nie-obraz/uszkodzony. */
export function decodeDataUrlImage(dataUrl: string, index: number): DecodedDataUrl | null {
  const m = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = EXT_BY_MIME[mime] ?? "png";
    return { mime, bytes, filename: `wklejony-obraz-${index + 1}.${ext}` };
  } catch {
    return null;
  }
}

export interface PersistImagesResult<T = Json> {
  doc: T;
  uploaded: number;
  failed: number;
  changed: boolean;
  /** dataUrl -> publiczny URL; wołający synchronizuje nią stan formularza. */
  replacements: Map<string, string>;
}

/**
 * Wgrywa wszystkie data-URL-e z dokumentu przez `upload` i zwraca dokument
 * z podmienionymi adresami. `cache` (dataUrl -> URL) chroni przed ponownym
 * uploadem tej samej grafiki przy kolejnych autosave'ach.
 */
export async function persistDataUrlImages<T>(
  doc: T,
  upload: (decoded: DecodedDataUrl) => Promise<string>,
  cache?: Map<string, string>,
): Promise<PersistImagesResult<T>> {
  const urls = collectDataUrlImages(doc as Json);
  if (urls.length === 0) {
    return { doc, uploaded: 0, failed: 0, changed: false, replacements: new Map() };
  }
  const replacements = new Map<string, string>();
  let uploaded = 0;
  let failed = 0;
  for (const [i, dataUrl] of urls.entries()) {
    const cached = cache?.get(dataUrl);
    if (cached) {
      replacements.set(dataUrl, cached);
      continue;
    }
    const decoded = decodeDataUrlImage(dataUrl, i);
    if (!decoded) {
      failed += 1;
      continue;
    }
    try {
      const publicUrl = await upload(decoded);
      if (publicUrl) {
        replacements.set(dataUrl, publicUrl);
        cache?.set(dataUrl, publicUrl);
        uploaded += 1;
      } else {
        failed += 1;
      }
    } catch {
      // Zapis wpisu NIE może się wywrócić przez jedną grafikę - zostaje
      // data-URL, spróbujemy przy kolejnym zapisie.
      failed += 1;
    }
  }
  return {
    doc: replaceDataUrlImages(doc, replacements),
    uploaded,
    failed,
    changed: replacements.size > 0,
    replacements,
  };
}
