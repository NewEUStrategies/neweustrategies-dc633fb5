// POMIAR OTWARĆ I KLIKNIĘĆ TYLKO ZA ZGODĄ (I9d-Y2) - adresy linków, napisy
// stopki maili i stan strony publicznej.
//
// Dwa linki prowadzą do jednej trasy (`/api/public/newsletter/measurement`):
//   * „Nie mierz moich otwarć i kliknięć" (stopka maili kampanii i ścieżek,
//     strona preferencji newslettera) - wycofanie SAMEGO pomiaru: wpis
//     `email_measurement` „nie", zgoda na newsletter bez zmian (wariant (a)
//     decyzji właściciela 2026-10-21);
//   * „Zgadzam się na pomiar" (jednorazowa prośba z panelu newslettera do
//     subskrybentów ze zgodą sprzed treści z pomiarem) - wpis zgody w bieżącej
//     wersji treści, baza dopisuje `email_measurement` „tak".
// Rodzaj akcji wynika z podpisanego tokenu (`measurementToken.server.ts`),
// nie z parametru adresu - nie da się zamienić wycofania w zgodę.
//
// LIŚĆ BEZ ZALEŻNOŚCI: czyta go strona publiczna (chunk czytelnika), render
// maili (serwer) i krok wysyłki prośby.

/** Publiczny endpoint linku (GET: walidacja/303, POST: zapis decyzji). */
export const NEWSLETTER_MEASUREMENT_API_PATH = "/api/public/newsletter/measurement";
/** Strona z przyciskiem, na którą GET z przeglądarki robi 303. */
export const NEWSLETTER_MEASUREMENT_PAGE_PATH = "/newsletter/measurement";

/**
 * Ważność linku „Zgadzam się na pomiar" z prośby (dni) - termin w podpisie
 * tokenu `mc:`. Jednorazowość daje nonce prośby w bazie; termin sprawia, że
 * mail sprzed miesięcy nie udziela zgody bez końca. Jedno źródło dla tokenu
 * i panelu (termin pokazany przy starcie prośby).
 */
export const MEASUREMENT_CONFIRM_LINK_DAYS = 60;

export type MeasurementLang = "pl" | "en";

/**
 * Skąd przyszło wycofanie (kolumna `form_id` wpisu rejestru zgód - dowód
 * kanału): stopka maila albo strona preferencji newslettera (wypis). Kanał
 * `account` (panel konta) ustawia wyłącznie funkcja serwerowa zalogowanego.
 */
export const MEASUREMENT_LINK_CHANNELS = ["email_footer", "preferences"] as const;
export type MeasurementLinkChannel = (typeof MEASUREMENT_LINK_CHANNELS)[number];

/** Kanał z adresu/ciała - wyłącznie z listy, inaczej stopka maila. */
export function measurementChannelOf(raw: unknown): MeasurementLinkChannel {
  return (MEASUREMENT_LINK_CHANNELS as readonly unknown[]).includes(raw)
    ? (raw as MeasurementLinkChannel)
    : "email_footer";
}

/**
 * Link wskazuje ENDPOINT, nie stronę (jak wypis i „Chcę dalej otrzymywać"):
 * strona może zmienić ścieżkę bez psucia maili już wysłanych. `lang` zmienia
 * wyłącznie napisy strony (ścieżki `/newsletter` nie mają prefiksu języka),
 * `via` - kanał zapisany przy wycofaniu (stopka maila domyślnie).
 */
export function newsletterMeasurementUrl(
  origin: string,
  token: string,
  lang?: MeasurementLang,
  via?: MeasurementLinkChannel,
): string {
  const base = `${origin.replace(/\/+$/, "")}${NEWSLETTER_MEASUREMENT_API_PATH}?token=${encodeURIComponent(token)}`;
  const withLang = lang ? `${base}&lang=${lang}` : base;
  return via && via !== "email_footer" ? `${withLang}&via=${via}` : withLang;
}

/**
 * Stopka maili marketingowych: zdanie o pomiarze i link wyłączenia. „Mogą"
 * jest prawdziwe dla każdego odbiorcy - mail bez zgody na pomiar nie ma
 * piksela ani linków z identyfikatorem, a link prowadzi wtedy do strony
 * „pomiar jest wyłączony".
 */
export const MEASUREMENT_FOOTER_COPY: Readonly<
  Record<MeasurementLang, { lead: string; link: string }>
> = {
  pl: {
    lead: "Nasze wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia.",
    link: "Nie mierz moich otwarć i kliknięć",
  },
  en: {
    lead: "Our emails may contain elements that measure opens and clicks.",
    link: "Don't measure my opens and clicks",
  },
};

/** Akcja tokenu (rozpoznana przez serwer z podpisu). */
export type MeasurementAction = "withdraw" | "confirm";

/** Stan strony `/newsletter/measurement`. */
export type MeasurementPageState =
  | "loading"
  | "confirmWithdraw"
  | "confirmGrant"
  | "withdrawn"
  | "granted"
  | "alreadyOff"
  | "alreadyOn"
  | "inactive"
  | "gone"
  | "expired"
  | "invalid"
  | "rateLimited"
  | "error";

/** Ciało odpowiedzi endpointu (bez danych osoby - patrz trasa API). */
export interface MeasurementResponseBody {
  ok?: boolean;
  action?: MeasurementAction;
  already?: boolean;
  /**
   * GET wycofania: czy osoba ma dziś zgodę na pomiar (odczyt bez mutacji).
   * `false` = nie ma czego wyłączać - strona od razu mówi, że pomiar jest
   * wyłączony. Brak pola (awaria odczytu) = przycisk jak zwykle.
   */
  consent?: boolean;
  error?: string;
}

/** Odpowiedź GET (walidacja tokenu) -> ekran przed decyzją. */
export function measurementPromptStateOf(
  status: number,
  body: MeasurementResponseBody,
): MeasurementPageState {
  if (!body.ok) return measurementErrorStateOf(status, body);
  if (body.action === "confirm") return "confirmGrant";
  return body.consent === false ? "alreadyOff" : "confirmWithdraw";
}

/** Odpowiedź POST (zapis decyzji) -> ekran wyniku. */
export function measurementResultStateOf(
  status: number,
  body: MeasurementResponseBody,
): MeasurementPageState {
  if (!body.ok) return measurementErrorStateOf(status, body);
  if (body.action === "confirm") return body.already ? "alreadyOn" : "granted";
  return body.already ? "alreadyOff" : "withdrawn";
}

/**
 * Kody błędów są kontraktem trasy API (`api.public.newsletter.measurement.ts`);
 * nieznany kod = ogólny błąd z ponowieniem.
 */
function measurementErrorStateOf(
  status: number,
  body: MeasurementResponseBody,
): MeasurementPageState {
  switch (body.error) {
    case "expired":
      return "expired";
    case "invalid_token":
      return "invalid";
    case "inactive":
      return "inactive";
    case "not_found":
      return "gone";
    case "rate_limited":
      return "rateLimited";
    default:
      return status === 429 ? "rateLimited" : "error";
  }
}
