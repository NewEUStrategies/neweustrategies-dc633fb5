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
// ODCZYT TEZ JEST BRAMKOWANY. Beacon lejka i przypiecie do zgloszenia dostaja
// identyfikator klikniecia tylko przy zgodzie marketingowej - nawet jesli
// pamiec karty go ma (wejscie przed decyzja).
//
// KAZDY DOSTEP DO MAGAZYNU JEST BEZPIECZNY. `readStoredValue`/`writeStoredValue`
// /`removeStoredValue` nigdy nie rzucaja (tryb prywatny, zablokowany magazyn) -
// brak trwalosci to stan, nie awaria.
import {
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

/**
 * Przechwycenie adresu wejscia (tylko pamiec - bez zapisu do magazynu).
 * Wejscie bez sygnalu kampanii niczego nie zmienia.
 */
export function captureAdLanding(input: LandingInput): void {
  const touch = parseAdTouch({ ...input, referrer: referrerConsumed ? null : input.referrer });
  referrerConsumed = true;
  if (touch === null) return;
  memory = mergeAttribution(memory ?? stored(), touch, input.nowMs);
}

/** Zapis (albo skasowanie) klucza wedlug AKTUALNEJ zgody. */
export function persistAdAttribution(consent: AttributionConsent, nowMs: number): void {
  const storage = browserStorage("local");
  const attribution =
    consent.analytics || consent.marketing ? freshAttribution(memory ?? stored(), nowMs) : null;
  if (attribution === null) {
    removeStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY);
    return;
  }
  const value = consent.marketing ? attribution : withoutClickIds(attribution);
  writeStoredValue(storage, AD_ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
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
  const attribution = freshAttribution(memory ?? stored(), nowMs);
  if (attribution === null) return null;
  return consent.marketing ? attribution : withoutClickIds(attribution);
}
