// Model preferencji powiadomień - CZYSTY moduł (bez klienta Supabase, bez
// Reacta), więc importowalny wszędzie i testowalny jednostkowo.
//
// Trzyma jedno źródło prawdy dla trzech rzeczy, które wcześniej żyły osobno i
// zdążyły się rozjechać:
//   1. katalog rodzajów powiadomień (NOTIFICATION_KINDS) - musi pokrywać się z
//      CHECK-iem `notifications_kind_check` w bazie,
//   2. kształt wiersza preferencji (NotificationPreferences + wartości
//      domyślne) - odbicie kolumn `public.notification_preferences`,
//   3. listę kolumn pobieranych przez warstwę danych
//      (NOTIFICATION_PREFERENCE_SELECT) - wyprowadzoną z (2), a nie pisaną
//      ręcznie: ręczna lista gubiła `enabled_saved_search` i
//      `enabled_crm_task`, więc te dwa przełączniki po odświeżeniu wracały na
//      "włączone" mimo zapisanego `false` w bazie.
//
// Bramkowanie po stronie serwera pilnuje `public.enqueue_notification`
// (pgTAP: supabase/tests/notification_preferences_gating_test.sql) - tutejsze
// funkcje odpowiadają wyłącznie za spójny obraz w UI.

/** Rodzaje powiadomień - odpowiednik `notifications_kind_check` w bazie. */
export type NotificationKind =
  | "system"
  | "comment"
  | "follow"
  | "subscription"
  | "content"
  | "security"
  | "message"
  | "tracker"
  | "connection"
  | "saved_search"
  | "crm_task"
  | "expert_request";

/** Kto może ZACZĄĆ nową rozmowę z użytkownikiem (istniejące wątki żyją dalej). */
export type AllowMessagesFrom = "everyone" | "existing" | "nobody";

/** Kto może wysłać zaproszenie do sieci kontaktów (istniejące kontakty zostają). */
export type AllowConnectionsFrom = "everyone" | "mutual" | "nobody";

export type EmailDigestFrequency = "off" | "daily" | "weekly";

export interface NotificationPreferences {
  enabled_message: boolean;
  enabled_comment: boolean;
  enabled_follow: boolean;
  enabled_subscription: boolean;
  enabled_content: boolean;
  enabled_system: boolean;
  enabled_security: boolean;
  /** Zmiany etapu w obserwowanych dossier (producent: tg_eu_policy_update_applied). */
  enabled_tracker: boolean;
  /** Zaproszenia do sieci kontaktów (producent: tg_user_connections_notify). */
  enabled_connection: boolean;
  /** Alerty zapisanych wyszukiwań (producent: run_saved_search_alerts). */
  enabled_saved_search: boolean;
  /** Przypomnienia o follow-upach CRM (producent: run_crm_task_reminders). */
  enabled_crm_task: boolean;
  /**
   * Zapytania do ekspertów - obie strony wymiany (producent:
   * tg_expert_request_notify): odbiorca dostaje sygnał o NOWYM zapytaniu,
   * nadawca o decyzji eksperta (przyjęte / odpowiedziane / odrzucone).
   */
  enabled_expert_request: boolean;
  auto_mark_on_open: boolean;
  group_by_conversation: boolean;
  /**
   * Prywatność czatu (egzekwowana po stronie serwera, nie tylko w UI):
   * - read_receipts_enabled: wzajemne - wyłączenie ukrywa Twój stan odczytu
   *   przed rozmówcami ORAZ ich stan przed Tobą (RLS na uczestnikach),
   * - typing_indicators_enabled: przestaje nadawać pingi "pisze...",
   * - show_online_status: przestaje ogłaszać obecność na kanale presence,
   * - allow_messages_from: 'nobody' wycisza też przychodzące w istniejących
   *   wątkach (trigger w bazie), 'existing' blokuje tylko NOWE rozmowy.
   */
  read_receipts_enabled: boolean;
  typing_indicators_enabled: boolean;
  show_online_status: boolean;
  allow_messages_from: AllowMessagesFrom;
  /**
   * Sieć kontaktów: kto może wysłać zaproszenie (egzekwowane w DB przez
   * connection_request; 'mutual' wymaga co najmniej jednego wspólnego kontaktu).
   */
  allow_connections_from: AllowConnectionsFrom;
  /**
   * Kanały doręczeń (poza in-app):
   * - push_enabled: web push na tym i innych urządzeniach użytkownika
   *   (subskrypcje per przeglądarka w push_subscriptions),
   * - email_digest: zbiorczy e-mail z nieprzeczytanymi powiadomieniami.
   */
  push_enabled: boolean;
  email_digest: EmailDigestFrequency;
  /**
   * Toggle dla ikony czatu (bell) w nagłówku - per tenant (preferencje są
   * powiązane z tenantem użytkownika przez `tenant_id`). Wyłączenie ukrywa
   * dzwonek, ale rozmowy nadal działają w /messages i ChatDock.
   */
  chat_bell_enabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled_message: true,
  enabled_comment: true,
  enabled_follow: true,
  enabled_subscription: true,
  enabled_content: true,
  enabled_system: true,
  enabled_security: true,
  enabled_tracker: true,
  enabled_connection: true,
  enabled_saved_search: true,
  enabled_crm_task: true,
  enabled_expert_request: true,
  auto_mark_on_open: true,
  group_by_conversation: true,
  read_receipts_enabled: true,
  typing_indicators_enabled: true,
  show_online_status: true,
  allow_messages_from: "everyone",
  allow_connections_from: "everyone",
  push_enabled: false,
  email_digest: "off",
  chat_bell_enabled: true,
};

/**
 * Rodzaje, które użytkownik może przełączać w ustawieniach. `security` jest
 * celowo pominięty: alerty bezpieczeństwa docierają zawsze (baza wprost omija
 * dla nich bramkę) i renderujemy je jako przełącznik always-on.
 */
export const TOGGLEABLE_NOTIFICATION_KINDS = [
  "message",
  "expert_request",
  "comment",
  "follow",
  "connection",
  "subscription",
  "content",
  "saved_search",
  "crm_task",
  "tracker",
  "system",
] as const satisfies readonly NotificationKind[];

/**
 * Pełny katalog rodzajów w kolejności prezentacji - przełączalne + always-on
 * `security`. Filtry skrzynki jadą z tej listy, żeby żaden rodzaj realnie
 * lądujący w skrzynce (tracker, connection, security) nie był poza zasięgiem
 * filtra.
 */
export const NOTIFICATION_KINDS = [
  ...TOGGLEABLE_NOTIFICATION_KINDS,
  "security",
] as const satisfies readonly NotificationKind[];

/**
 * Kolumny wiersza preferencji - wprost z kluczy wartości domyślnych, więc nowe
 * pole wystarczy dodać w JEDNYM miejscu (interfejs + default), a warstwa danych
 * zacznie je pobierać sama.
 */
export const NOTIFICATION_PREFERENCE_COLUMNS = Object.keys(
  DEFAULT_NOTIFICATION_PREFERENCES,
) as ReadonlyArray<keyof NotificationPreferences>;

/** Lista kolumn dla `.select()` PostgREST-a (nigdy `*` - to wiersz per user). */
export const NOTIFICATION_PREFERENCE_SELECT = NOTIFICATION_PREFERENCE_COLUMNS.join(", ");

/**
 * Czy dany rodzaj powiadomień jest włączony. `security` jest włączony zawsze,
 * niezależnie od zapisanej flagi; pozostałe rodzaje czytają swoje
 * `enabled_<kind>`. Brakująca flaga oznacza "włączone" (fail-open) - tak samo
 * zachowuje się `enqueue_notification` przy braku wiersza preferencji.
 */
export function isNotificationKindEnabled(
  prefs: NotificationPreferences,
  kind: NotificationKind,
): boolean {
  if (kind === "security") return true;
  const value = prefs[`enabled_${kind}` as keyof NotificationPreferences];
  return typeof value === "boolean" ? value : true;
}
