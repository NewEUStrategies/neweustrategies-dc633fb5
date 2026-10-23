// POMIAR OTWARĆ I KLIKNIĘĆ TYLKO ZA OSOBNĄ ZGODĄ (I9d-Y2, I9d-Y2b) - adresy
// linków, napisy stopki maili i stan strony publicznej.
//
// Dwa linki prowadzą do jednej trasy (`/api/public/newsletter/measurement`):
//   * „Nie mierz moich otwarć i kliknięć" (stopka maili kampanii i ścieżek,
//     strona preferencji newslettera) - wycofanie SAMEGO pomiaru: wpis
//     `email_measurement` „nie", zgoda na newsletter bez zmian;
//   * „Zgadzam się / Potwierdzam zgodę na pomiar" (jednorazowa prośba z panelu
//     newslettera do subskrybentów bez zgody na pomiar albo prośba po zapisie
//     bez double opt-in z zaznaczonym osobnym polem pomiaru) - zapis OSOBNEJ
//     zgody na pomiar (treść i wersja pola pomiaru, wariant (b) decyzji
//     właściciela 2026-10-23); „tak" zapisuje wyłącznie baza
//     (`_email_measurement_grant`), a pomiar działa tylko dla aktywnego
//     subskrybenta, który sam potwierdził zgodę (D2).
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
 * tokenu `mc:` - i SEKRETU SKRZYNKI z maila double opt-in (`md:`, karta na
 * stronie potwierdzenia, I9d-Y2b R1): liczony od WYSŁANIA maila, nie od
 * deklaracji, którą każdy może odświeżyć formularzem. Jednorazowość prośby
 * daje nonce w bazie; termin sprawia, że mail sprzed miesięcy nie udziela
 * zgody bez końca. Jedno źródło dla tokenów i panelu (termin pokazany przy
 * starcie prośby); lustro SQL `c_offer_days` (`_newsletter_measurement_offer_state`,
 * `_newsletter_doi_measurement_offer_state`) - test parytetu.
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
   * Brak pola (awaria odczytu) = przycisk jak zwykle.
   */
  consent?: boolean;
  /**
   * GET wycofania (I9d-Y2b R1): czy ostatnia decyzja osoby to już odmowa
   * (stopka, preferencje, konto, strona DOI). Bez zgody i bez odmowy
   * (`refused: false`) przycisk zostaje - zapisuje odmowę, która wyklucza
   * z próśb o zgodę. Brak pola (stary serwer) = jak odmowa zapisana.
   */
  refused?: boolean;
  error?: string;
}

/** Odpowiedź GET (walidacja tokenu) -> ekran przed decyzją. */
export function measurementPromptStateOf(
  status: number,
  body: MeasurementResponseBody,
): MeasurementPageState {
  if (!body.ok) return measurementErrorStateOf(status, body);
  if (body.action === "confirm") return "confirmGrant";
  // Bez zgody: „pomiar jest wyłączony" tylko przy odmowie już zapisanej;
  // bez niej - przycisk zapisu odmowy (inaczej prośby nie omijałyby osoby).
  return body.consent === false && body.refused !== false ? "alreadyOff" : "confirmWithdraw";
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
