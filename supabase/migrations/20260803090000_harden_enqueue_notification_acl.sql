-- Hardening: enqueue_notification przestaje być RPC dostępnym z przeglądarki.
--
-- Problem: funkcja jest SECURITY DEFINER i przyjmuje odbiorcę WPROST
-- (p_user_id) razem z tytułem, treścią, ikoną i href-em. Grant EXECUTE dla
-- roli `authenticated` (migracja 20260711081539) oznaczał, że dowolny
-- zalogowany użytkownik mógł przez PostgREST wstrzyknąć dowolne powiadomienie
-- do skrzynki DOWOLNEGO konta - także w obcym tenancie (funkcja stempluje
-- tenant z profilu ODBIORCY, więc bramka tenanta nie stawiała tu oporu) i
-- także jako rodzaj 'security', który obchodzi preferencje i zawsze dociera.
-- Renderowany href czynił z tego gotowy kanał phishingowy wewnątrz produktu.
--
-- Dlaczego revoke jest bezpieczny: wszystkie 22 funkcje-producenci
-- (tg_messages_notify_recipients, comments_notify_approved, notify_new_follower,
-- notify_post_published, tg_user_connections_notify, tg_eu_policy_update_applied,
-- run_saved_search_alerts, run_crm_task_reminders, run_workflow_step, ...) są
-- SECURITY DEFINER i wykonują się z prawami właściciela funkcji, więc nie
-- korzystają z grantu roli klienckiej. Frontend nie woła tego RPC nigdzie
-- (produkcja kolejkuje powiadomienia wyłącznie po stronie bazy).
--
-- service_role zachowuje EXECUTE - runnery zadań tła (jobs-tick,
-- community-cron) kolejkują powiadomienia poza kontekstem triggera.

REVOKE ALL ON FUNCTION public.enqueue_notification(
  uuid, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_notification(
  uuid, text, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.enqueue_notification(
  uuid, text, text, text, text, text, text, text
) IS
  'Kanoniczny producent powiadomień (SECURITY DEFINER). Bramkuje rodzaj po '
  'notification_preferences.enabled_<rodzaj> odbiorcy (''security'' zawsze '
  'dociera), stempluje tenant z profilu odbiorcy i deduplikuje po '
  '(user, kind, href) w oknie 5 minut. WYŁĄCZNIE serwerowa: wołana przez '
  'funkcje SECURITY DEFINER i service_role - bez grantu dla ról klienckich '
  '(wstrzykiwanie powiadomień cross-tenant). Kontrakt pilnuje '
  'supabase/tests/notification_preferences_gating_test.sql.';
