// Odmowy bazy w panelu gieldy 1-1 -> zdanie po ludzku.
//
// DLACZEGO OSOBNO OD `meetingsErrors.ts`. Tamten modul obsluguje plaszczyzne
// UCZESTNIKA i ma zamknieta liste kluczy, bo uczestnik widzi dokladnie te
// kilkanascie odmow. Panel organizatora dostaje INNY zestaw - o stolikach,
// pojemnosciach, regulach i frekwencji - i te komunikaty maja inny ton: mowia,
// co ZROBIC z konfiguracja, a nie co sie nie udalo klikajacemu.
//
// KLUCZ WYCIAGAMY Z GLOWY KOMUNIKATU, TAK JAK RZUCA GO PLPGSQL:
// `table_in_use: table is used by 3 meetings`. Czlon przed dwukropkiem to
// kontrakt bazy; reszta zdania jest dla logow, nie dla czlowieka.
//
// LICZBY Z KOMUNIKATU TRAFIAJA DO INTERPOLACJI. Slownik mowi „Miejsce {{seat}}
// jest zajete" i „Stolik jest uzywany przez {{count}} spotkan" - bez liczby
// z bazy zdanie klamie albo pokazuje pusty nawias. Bierzemy je z ogona
// komunikatu, bo PL/pgSQL nie ma innego kanalu na parametry wyjatku.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO. Gdy w slowniku nie ma zdania, wracamy do
// `unknown` zamiast pokazac surowe `42501` albo techniczny angielski.
import i18n from "@/lib/i18n";

const PREFIX = "adminEventMeetings.errors.";

/** `table_label_taken` -> `tableLabelTaken`. Slownik jest camelCase, baza snake_case. */
function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/** Parametry interpolacji wyjete z ogona komunikatu - liczby i strefa czasowa. */
export type AdminMeetingErrorParams = Record<string, string | number>;

function paramsOf(tail: string): AdminMeetingErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const first = numbers[0] === undefined ? undefined : Number(numbers[0]);
  const second = numbers[1] === undefined ? undefined : Number(numbers[1]);
  // Strefa czasowa jest jedynym parametrem tekstowym w tym module; baza wysyla
  // ja jako pierwsze slowo ogona ("Europe/Nowhere is not a known time zone").
  const zone = /^([A-Za-z]+\/[A-Za-z_+\-0-9]+)/.exec(tail.trim());
  // Klucze o wartosci `undefined` sa POMINIETE: i18next wstawilby je jako pusty
  // napis, a zdanie "Stolik jest uzywany przez  spotkan" wyglada jak awaria.
  const out: AdminMeetingErrorParams = {};
  if (first !== undefined) {
    out.count = first;
    out.seat = first;
  }
  if (second !== undefined) out.capacity = second;
  if (zone !== null && zone[1] !== undefined) out.timezone = zone[1];
  return out;
}

export interface AdminMeetingFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminMeetingErrorParams;
}

/**
 * Odmowa -> klucz slownika i jego parametry.
 *
 * Rozpoznajemy WYLACZNIE glowe wygladajaca na klucz techniczny (male litery
 * i podkreslenia). Bez tego warunku komunikat „Failed to fetch" oddalby klucz
 * „Failed" i pokazal go organizatorowi jako etykiete bledu.
 */
export function adminMeetingFailure(error: unknown): AdminMeetingFailure {
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  const tail = separator === -1 ? "" : message.slice(separator + 1);

  if (!/^[a-z][a-z0-9_]*$/.test(head)) return { key: `${PREFIX}unknown`, params: {} };

  const candidate = `${PREFIX}${camel(head)}`;
  if (!i18n.exists(candidate)) return { key: `${PREFIX}unknown`, params: {} };
  return { key: candidate, params: paramsOf(tail) };
}
