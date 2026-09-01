// Selektory tekstu powiadomienia (PL/EN) - wspólne dla dzwonka i skrzynki.
//
// PO CO WYDZIELENIE. `pickTitle`/`pickBody` istniały w dwóch kopiach
// (`NotificationsBell.tsx:61,65` i `NotificationsCenter.tsx:85,88`), zapisanych
// RÓŻNĄ składnią przy identycznym zachowaniu - czyli dokładnie w kształcie,
// w którym poprawka języka trafia do jednej kopii, a druga cicho zostaje.
// Obie były na zerze pokrycia, bo wywołać je dało się wyłącznie renderem
// organizmu.
//
// REGUŁA JĘZYKA jest tu jedna i wypowiedziana raz: przy EN bierzemy wersję
// angielską, a gdy jej nie ma - polską (i odwrotnie). Powiadomienie BEZ tytułu
// nie istnieje (`title_pl` jest NOT NULL w bazie), więc tytuł zawsze coś zwraca;
// treść bywa pusta i wtedy zwracamy null, żeby wywołujący nie renderował
// pustego akapitu.
import { formatDateShort } from "@/lib/i18n/format";
import type { AppLang } from "@/lib/i18n/localePath";

/**
 * Minimalny kształt wiersza, jakiego potrzebują selektory tekstu.
 *
 * Świadomie strukturalny, a nie `NotificationRow`: ten moduł ma zostać czysty
 * (zero importów warstwy danych, zero React Query), a każdy wiersz powiadomienia
 * jest przypisywalny do tego kształtu. Testy mogą więc podać sam tekst zamiast
 * budować pełny wiersz z tenantem i znacznikami czasu.
 */
export interface LocalizedNotificationText {
  title_pl: string;
  title_en?: string | null;
  body_pl?: string | null;
  body_en?: string | null;
}

/** Tytuł w języku interfejsu; brak wersji EN spada na PL. */
export function pickTitle(row: LocalizedNotificationText, lang: AppLang): string {
  if (lang === "en" && row.title_en) return row.title_en;
  return row.title_pl;
}

/** Treść w języku interfejsu; brak obu wersji to null, nie pusty napis. */
export function pickBody(row: LocalizedNotificationText, lang: AppLang): string | null {
  const [preferred, fallback] =
    lang === "en" ? [row.body_en, row.body_pl] : [row.body_pl, row.body_en];
  return preferred ?? fallback ?? null;
}

/**
 * Data i godzina dla wiersza skrzynki. Locale jest JAWNE (`pl-PL` / `en-GB`),
 * bo `toLocaleString()` bez niego czyta ustawienia przeglądarki - a wtedy SSR
 * i klient renderują różny tekst i React zgłasza rozjazd hydracji.
 */
export function fmtDate(iso: string, lang: AppLang): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Czas względny dla dzwonka („2 minuty temu"), z progami sekunda -> minuta ->
 * godzina -> dzień. Powyżej tygodnia względność przestaje nieść informację
 * („37 dni temu" nikt nie czyta jako daty), więc wracamy do daty krótkiej.
 *
 * `nowMs` jest parametrem, a nie odczytem `Date.now()` w środku, żeby test
 * mógł ustalić chwilę odniesienia bez zamrażania zegara całego pliku.
 */
export function relTime(iso: string, lang: AppLang, nowMs: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(lang === "en" ? "en-GB" : "pl-PL", { numeric: "auto" });
  const diff = (new Date(iso).getTime() - nowMs) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diff / 86400), "day");
  return formatDateShort(iso, lang);
}
