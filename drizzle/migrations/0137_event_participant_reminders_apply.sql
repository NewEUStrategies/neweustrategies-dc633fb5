-- Zastosowanie oczekującej migracji 0136_event_participant_reminders (PR #460); ten krok tylko dokumentuje jej wykonanie.
COMMENT ON FUNCTION public.run_event_reminders() IS 'Przypomnienia uczestnika F2: kolejkuje rodzaj event wg ustawien organizatora (20261003140000 / drizzle 0136).';
