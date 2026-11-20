// Rozpoznanie SYGNAŁU w wierszu powiadomienia i treść okienka w aplikacji -
// CZYSTY moduł (bez Supabase, bez Reacta), testowalny jednostkowo.
//
// Sygnał = powiadomienie skierowane do osoby z imienia: @wzmianka albo prośba
// o zdanie w wątku klubu. Tylko one dostają wyskakujące okienko w aplikacji;
// reszta (zaproszenia do sieci, wyświetlenia profilu, treści) zostaje cicho
// w dzwonku, żeby okienko nie stało się szumem.
//
// Rozpoznanie opiera się na znacznikach, które producenci w bazie zapisują
// dziś (bez zmiany schematu):
//   - wzmianka: ikona `at-sign` (`process_mentions`, każde źródło wzmianki),
//   - prośba o zdanie: rodzaj `club` i stały tytuł EN z
//     `club_thread_expert_ping` („You were asked to weigh in").
// Gdy wiersz niesie jawny znacznik `meta.signal`, ma on pierwszeństwo.
import { isInternalHref } from "./notificationLink";
import { pickBody, pickTitle } from "./notificationText";
import { isNotificationSignal, type NotificationSignal } from "./signals";
import type { AppLang } from "@/lib/i18n/localePath";

/** Tytuł EN prośby o zdanie - literał z `club_thread_expert_ping`. */
export const EXPERT_PING_TITLE_EN = "You were asked to weigh in";

/**
 * Okienko tylko dla świeżych wierszy. Realtime nie odtwarza starych zdarzeń,
 * ale zegar klienta i ponowne połączenie potrafią podać wiersz sprzed chwili;
 * powiadomienie sprzed kilku minut nie jest już "teraz".
 */
export const SIGNAL_TOAST_MAX_AGE_MS = 2 * 60 * 1000;

export interface SignalNotificationRow {
  id?: unknown;
  user_id?: unknown;
  kind?: unknown;
  icon?: unknown;
  href?: unknown;
  read_at?: unknown;
  created_at?: unknown;
  meta?: unknown;
  title_pl?: unknown;
  title_en?: unknown;
  body_pl?: unknown;
  body_en?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function notificationSignalOf(row: SignalNotificationRow): NotificationSignal | null {
  const meta = row.meta;
  if (meta && typeof meta === "object" && "signal" in meta) {
    const signal = (meta as { signal: unknown }).signal;
    if (isNotificationSignal(signal)) return signal;
  }
  if (row.icon === "at-sign") return "mention";
  if (row.kind === "club" && str(row.title_en)?.trim() === EXPERT_PING_TITLE_EN) {
    return "expert_ping";
  }
  return null;
}

export interface SignalToastContent {
  /** Identyfikator okienka - jedno na powiadomienie, bez piętrzenia. */
  toastId: string;
  notificationId: string;
  signal: NotificationSignal;
  title: string;
  description: string | null;
  /** Wyłącznie ścieżka wewnętrzna; obcy adres = okienko bez akcji. */
  href: string | null;
}

export function signalToastFromRow(input: {
  row: SignalNotificationRow;
  userId: string;
  lang: AppLang;
  nowMs: number;
}): SignalToastContent | null {
  const { row } = input;
  const id = str(row.id);
  if (!id || row.user_id !== input.userId) return null;
  if (row.read_at !== null && row.read_at !== undefined) return null;
  const signal = notificationSignalOf(row);
  if (!signal) return null;
  const createdAt = Date.parse(str(row.created_at) ?? "");
  if (Number.isNaN(createdAt) || input.nowMs - createdAt > SIGNAL_TOAST_MAX_AGE_MS) return null;

  const titlePl = str(row.title_pl);
  if (!titlePl) return null;
  const text = {
    title_pl: titlePl,
    title_en: str(row.title_en),
    body_pl: str(row.body_pl),
    body_en: str(row.body_en),
  };
  const href = str(row.href);
  return {
    toastId: `signal:${id}`,
    notificationId: id,
    signal,
    title: pickTitle(text, input.lang),
    description: pickBody(text, input.lang),
    href: href && isInternalHref(href) ? href : null,
  };
}
