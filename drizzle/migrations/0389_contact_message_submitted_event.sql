-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9, Z-S5-01): ZDARZENIE `contact_message.submitted.v1`
-- - WIADOMOŚĆ Z FORMULARZA KONTAKTOWEGO NA SZYNIE (SZABLON ŚCIEŻKI B2B).
--
-- DEFEKT
--   1. Z-S5-01 (SPEC P25, §5.6): szablon ścieżki „Zapytanie o ofertę dla
--      instytucji" (`pricing_enquiry_b2b`) czekał na zdarzenie formularza.
--      Wyzwalacz CRM (`trg_contact_messages_to_lead`) zakłada leada bez śladu,
--      że chodzi o ofertę, więc jedyny dostępny wyzwalacz
--      (`crm_lead.created.v1`) łapałby KAŻDY nowy kontakt; instalacja szablonu
--      zwracała `template_unavailable`.
--
-- ZMIANA
--   A. `tg_contact_messages_submitted_emit()` (I9, trigger) - AFTER INSERT ON
--      `contact_messages`, wyzwalacz `trg_contact_messages_to_lead_submitted_emit`.
--      Nazwa sortuje się PO `trg_contact_messages_to_lead` (wyzwalacze AFTER
--      odpalają alfabetycznie), więc lead formularza już istnieje.
--      Ładunek BEZ danych osobowych: `message_id`, `lead_id` (lead najemcy po
--      `email_norm`, bez zanonimizowanych; NULL, gdy go brak), `form_kind`
--      z BIAŁEJ LISTY (`pricing` - formularz kasy cennika `pricing-contact-sales`
--      albo źródło `pricing`; `newsletter`, `join_us` z `form_type`; inaczej
--      `contact`) i `form_id`. `source` to wolny tekst klienta - nie trafia do
--      ładunku, służy tylko do rozpoznania cennika. Agregat `contact_message`,
--      id = wiadomość; aktor - brak (formularz publiczny).
--   B. Aplikacje do pracy (`form_id = 'careers'`) NIE wychodzą na szynę:
--      dane kandydatów mają własny moduł i retencję, a zdarzenie szyny
--      trafia też do integracji zewnętrznych i ścieżek marketingowych.
--   C. Awaria emitera nie wycofuje zapisu formularza (`_log_emit_error`).
--
-- careers-harness: exclude
-- HARNESS KARIERY: plik wspomina `public.contact_messages` (selektor), ale
-- sięga do CRM (`crm_leads`) i szyny (`emit_domain_event`, `_log_emit_error`),
-- których harness celowo nie modeluje; pełny dowód - pgTAP na komplecie
-- migracji (hub_i9_contact_message_event_test).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162700; wymaga szyny (20260808190000),
-- `_log_emit_error` (I0, 20261020090500) i kolumny `crm_leads.anonymized_at`
-- (I9c, 20261020161000). Kod: typ zdarzenia w katalogu szyny i mapie
-- inwalidacji (`domainEvents.ts`, `eventInvalidationMap.ts`), wyzwalacz
-- ścieżek i szablon - wdrożenie migracji przed kodem jest bezpieczne
-- (nieznane zdarzenie nikogo nie zapisuje, mapa zwraca [] - brak odświeżenia).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER, bezstanowe REVOKE.
-- DOWÓD: supabase/tests/hub_i9_contact_message_event_test.sql (formularz
-- cennika -> 1 zdarzenie z `lead_id` istniejącego leada, ładunek bez adresu
-- i imienia; biała lista `form_kind`; kandydat do pracy bez zdarzenia;
-- awaria emitera nie wycofuje zapisu; ACL funkcji).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_contact_messages_submitted_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_lead uuid;
BEGIN
  -- Kandydaci do pracy - poza szyną (nagłówek, B).
  IF COALESCE(NEW.form_id, '') = 'careers' THEN
    RETURN NEW;
  END IF;
  v_kind := CASE
    WHEN NEW.form_id = 'pricing-contact-sales' OR NEW.source = 'pricing' THEN 'pricing'
    WHEN NEW.form_type = 'newsletter' THEN 'newsletter'
    WHEN NEW.form_type = 'join_us' THEN 'join_us'
    ELSE 'contact'
  END;
  BEGIN
    SELECT l.id INTO v_lead
      FROM public.crm_leads l
     WHERE l.tenant_id = NEW.tenant_id
       AND l.email_norm = lower(btrim(NEW.email))
       AND l.anonymized_at IS NULL
     ORDER BY l.created_at
     LIMIT 1;
    PERFORM public.emit_domain_event(NEW.tenant_id, 'contact_message', NEW.id::text,
      'contact_message.submitted.v1',
      jsonb_build_object('message_id', NEW.id, 'lead_id', v_lead, 'form_kind', v_kind,
        'form_id', NEW.form_id),
      NULL);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(NEW.tenant_id, 'tg_contact_messages_submitted_emit',
      'contact_message.submitted.v1', SQLSTATE, SQLERRM);
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_contact_messages_submitted_emit() IS
  'Z-S5-01 (I9): wiadomosc z formularza kontaktowego -> contact_message.submitted.v1 (message_id, lead_id, form_kind z bialej listy pricing|newsletter|join_us|contact, form_id; bez danych osobowych). Kandydaci do pracy (form_id careers) poza szyna. Awaria emitera nie wycofuje zapisu formularza.';

SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_contact_messages_to_lead_submitted_emit ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_to_lead_submitted_emit
  AFTER INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_contact_messages_submitted_emit();

RESET lock_timeout;

REVOKE ALL ON FUNCTION public.tg_contact_messages_submitted_emit() FROM PUBLIC, anon, authenticated;
