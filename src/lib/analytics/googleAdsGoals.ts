// Konfiguracja Google Ads (identyfikator tagu i etykiety konwersji) - jedno
// źródło dla schematu ustawień (Pixels -> Google Ads), formularza panelu
// i wysyłki konwersji z przeglądarki.
//
// Moduł czysty (bez DOM): wartości domyślne to akcje WEBPAGE konta
// 251-385-9854, więc strona liczy konwersje także przed odczytem ustawień,
// a pusty wpis w panelu świadomie wyłącza daną konwersję.
import { GOOGLE_ADS_ID } from "./tagIds";

/** Cele zgłaszane bezpośrednio tagiem strony (kolejność = kolejność w panelu). */
export const GOOGLE_ADS_GOALS = [
  "contact_form",
  "club_application",
  "account_signup",
  "newsletter",
  "event_registration",
  "purchase",
] as const;
export type GoogleAdsGoal = (typeof GOOGLE_ADS_GOALS)[number];

/** Sposób liczenia akcji w Google Ads (Ad Grants: leady raz na kliknięcie). */
export const GOOGLE_ADS_GOAL_COUNTING: Readonly<Record<GoogleAdsGoal, "one" | "every">> = {
  contact_form: "one",
  club_application: "one",
  account_signup: "one",
  newsletter: "one",
  event_registration: "one",
  purchase: "every",
};

/** Etykiety akcji z fragmentów zdarzeń Google Ads (konto 251-385-9854). */
export const DEFAULT_GOOGLE_ADS_LABELS: Readonly<Record<GoogleAdsGoal, string>> = {
  contact_form: "p9kvCLTkwbwdEMD6kM5B",
  club_application: "7VqPCLfkwbwdEMD6kM5B",
  account_signup: "I7B9CLrkwbwdEMD6kM5B",
  newsletter: "YsEPCL3kwbwdEMD6kM5B",
  event_registration: "zi3kCMDkwbwdEMD6kM5B",
  purchase: "n02PCIG0wLwdEMD6kM5B",
};

export const DEFAULT_GOOGLE_ADS_ID = GOOGLE_ADS_ID;

const LABEL_RE = /^[A-Za-z0-9_-]{4,40}$/;
const SEND_TO_RE = /AW-\d{9,12}\/([A-Za-z0-9_-]{4,40})/i;
const ADS_ID_RE = /(?<![\w-])AW-(\d{9,12})(?![\w-])/i;
const BARE_ADS_DIGITS_RE = /^\d{9,12}$/;

/**
 * Etykieta konwersji z samej etykiety albo z fragmentu zdarzenia
 * (`'send_to': 'AW-123456789/AbC-123'`); cokolwiek innego -> "".
 */
export function extractGoogleAdsLabel(raw: string): string {
  const value = raw.trim();
  const fromSnippet = SEND_TO_RE.exec(value);
  if (fromSnippet?.[1]) return fromSnippet[1];
  if (/^AW-/i.test(value)) return "";
  return LABEL_RE.test(value) ? value : "";
}

/** `AW-` + 9..12 cyfr z wpisu, samych cyfr albo fragmentu tagu; inaczej "". */
export function extractGoogleAdsId(raw: string): string {
  const value = raw.trim();
  if (BARE_ADS_DIGITS_RE.test(value)) return `AW-${value}`;
  const match = ADS_ID_RE.exec(value);
  return match?.[1] ? `AW-${match[1]}` : "";
}

export interface GoogleAdsRuntimeConfig {
  id: string;
  labels: Partial<Record<GoogleAdsGoal, string>>;
}

let runtimeId: string = DEFAULT_GOOGLE_ADS_ID;
let runtimeLabels: Record<GoogleAdsGoal, string> = { ...DEFAULT_GOOGLE_ADS_LABELS };

/** Przekazuje ustawienia z panelu (ConsentScriptInjector, po odczycie `marketing`). */
export function configureGoogleAds(config: GoogleAdsRuntimeConfig): void {
  runtimeId = extractGoogleAdsId(config.id);
  const next = { ...DEFAULT_GOOGLE_ADS_LABELS };
  for (const goal of GOOGLE_ADS_GOALS) {
    next[goal] = extractGoogleAdsLabel(config.labels[goal] ?? "");
  }
  runtimeLabels = next;
}

/** Bieżący identyfikator tagu Google Ads albo "" (Ads wyłączone w panelu). */
export function googleAdsId(): string {
  return runtimeId;
}

/** Bieżąca etykieta konwersji albo "" (konwersja wyłączona w panelu). */
export function googleAdsLabel(goal: GoogleAdsGoal): string {
  return runtimeLabels[goal];
}

/** Powrót do wartości wbudowanych (testy). */
export function resetGoogleAdsConfig(): void {
  runtimeId = DEFAULT_GOOGLE_ADS_ID;
  runtimeLabels = { ...DEFAULT_GOOGLE_ADS_LABELS };
}
