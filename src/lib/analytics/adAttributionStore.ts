// Magazyn atrybucji kampanii - PAMIEC do chwili decyzji o zgodzie, potem
// `localStorage` wylacznie w zakresie, na ktory zgoda pozwala.
//
// DLACZEGO PAMIEC NAJPIERW. Baner zgod pojawia sie z opoznieniem, wiec na
// stronie wejscia z `?gclid=...` decyzji zwykle jeszcze nie ma. Zapis do
// magazynu przegladarki przed zgoda to dostep do urzadzenia z art. 5 ust. 3
// dyrektywy ePrivacy - dotkniecie czeka wiec w zmiennej modulu (zyje tyle,
// co karta) i trafia do magazynu dopiero, gdy zgoda na to pozwala:
//   * marketing  -> pelna atrybucja, z identyfikatorem klikniecia;
//   * sama analityka -> kopia BEZ identyfikatora klikniecia (kanal i UTM);
//   * brak zgody albo jej cofniecie -> klucz KASOWANY.
// Sygnal GPC klamruje obie kategorie juz w `useEffectiveConsent`
// i `hasCategoryConsent`, wiec tu dociera jako "brak zgody".
//
// DECYZJA BEZ MARKETINGU CZYSCI TEZ PAMIEC. Przed decyzja identyfikator
// klikniecia czeka w pamieci karty; po decyzji bez zgody marketingowej (takze
// cofnieciu w innej karcie albo w innym miejscu serwisu - `consent.ts` wola
// `pruneAdAttributionForConsent`) pamiec traci go na dobre, inaczej ponowna
// zgoda przywrocilaby identyfikator zebrany przed cofnieciem.
//
// KARTY DZIELA MAGAZYN, NIE PAMIEC. Kazdy odczyt laczy pamiec karty z magazynem
// (`combineAttribution`: wczesniejsze pierwsze, pozniejsze ostatnie), a zapis
// z tym samym napisem, ktory juz lezy w magazynie, jest pomijany - zapis
// rozglasza `storage` do innych kart, a one tez wolaja zapis.
//
// ODCZYT TEZ JEST BRAMKOWANY. Beacon lejka i przypiecie do zgloszenia dostaja
// identyfikator klikniecia tylko przy zgodzie marketingowej - nawet jesli
// pamiec karty go ma (wejscie przed decyzja).
//
// KAZDY DOSTEP DO MAGAZYNU JEST BEZPIECZNY. `readStoredValue`/`writeStoredValue`
// /`removeStoredValue` nigdy nie rzucaja (tryb prywatny, zablokowany magazyn) -
// brak trwalosci to stan, nie awaria.
import {
  combineAttribution,
  freshAttribution,
  mergeAttribution,
  parseAdTouch,
  parseStoredAttribution,
  withoutClickIds,
  type LandingInput,
  type StoredAttribution,
} from "@/lib/analytics/adAttribution";
import {
  AD_ATTRIBUTION_STORAGE_KEY,
  browserStorage,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from "@/lib/storageKeys";

export interface AttributionConsent {
  analytics: boolean;
  marketing: boolean;
  /**
   * Czy decyzja o zgodzie JEST podjeta. Brak zgody marketingowej przed decyzja
   * znaczy "jeszcze nie wiadomo" (identyfikator czeka w pamieci), po decyzji -
   * odmowe (pamiec go traci). Bez pola: decyzja jest, gdy ktoras kategoria
   * jest udzielona.
   */
  decided?: boolean;
}

let memory: StoredAttribution | null = null;
// Odsylacz `document.referrer` jest staly przez cale zycie dokumentu - liczy
// sie tylko przy PIERWSZYM przechwyceniu. Nawigacja SPA po zakladkach
// wydarzenia z tym samym odsylaczem nadpisywalaby kampanie wizyta organiczna.
let referrerConsumed = false;

function stored(): StoredAttribution | null {
  return parseStoredAttribution(
    readStoredValue(browserStorage("local"), AD_ATTRIBUTION_STORAGE_KEY),
  );
}

/** Pamiec karty z magazynem wspolnym dla kart (nowszy magazyn nie ginie). */
function current(): StoredAttribution | null {
  return combineAttribution(memory, stored());
}

function forgetMemoryClickIds(): void {
  if (memory !== null) memory = withoutClickIds(memory);
}

/**
 * Przechwycenie adresu wejscia (tylko pamiec - bez zapisu do magazynu).
 * Wejscie bez sygnalu kampanii niczego nie zmienia.
 */
export function captureAdLanding(input: LandingInput): void {
  const touch = parseAdTouch({ ...input, referrer: referrerConsumed ? null : input.referrer });
  referrerConsumed = true;
  if (touch === null) return;
  memory = mergeAttribution(current(), touch, input.nowMs);
}

/** Zapis (albo skasowanie) klucza wedlug AKTUALNEJ zgody. */
export function persistAdAttribution(consent: AttributionConsent, nowMs: number): void {
  const storage = browserStorage("local");
  if (!consent.marketing && (consent.decided ?? consent.analytics)) forgetMemoryClickIds();
  const attribution =
    consent.analytics || consent.marketing ? freshAttribution(current(), nowMs) : null;
  if (attribution === null) {
    removeStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY);
    return;
  }
  const value = JSON.stringify(consent.marketing ? attribution : withoutClickIds(attribution));
  if (readStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY) === value) return;
  writeStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY, value);
}

/**
 * Sprzatanie po DECYZJI o zgodzie (wola `consent.ts` przy kazdym zapisie
 * i skasowaniu decyzji - na kazdej stronie, nie tylko tam, gdzie stoi
 * `AdAttributionCapture`): bez obu kategorii klucz znika, bez marketingu
 * identyfikatory klikniec znikaja z magazynu i z pamieci karty.
 */
export function pruneAdAttributionForConsent(consent: AttributionConsent): void {
  if (consent.marketing) return;
  forgetMemoryClickIds();
  const storage = browserStorage("local");
  const kept = consent.analytics ? stored() : null;
  if (kept === null) {
    removeStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY);
    return;
  }
  const value = JSON.stringify(withoutClickIds(kept));
  if (readStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY) === value) return;
  writeStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY, value);
}

/**
 * Atrybucja do wyslania: `null` bez zgody na pomiar; bez zgody marketingowej -
 * bez identyfikatorow klikniec.
 */
export function readAdAttribution(
  consent: AttributionConsent,
  nowMs: number,
): StoredAttribution | null {
  if (!consent.analytics && !consent.marketing) return null;
  const attribution = freshAttribution(current(), nowMs);
  if (attribution === null) return null;
  return consent.marketing ? attribution : withoutClickIds(attribution);
}
