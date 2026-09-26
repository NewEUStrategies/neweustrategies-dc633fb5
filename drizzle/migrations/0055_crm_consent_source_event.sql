-- Rejestr zgod CRM zna zrodlo 'event' (zgoda marketingowa z formularza wydarzenia).
-- Osobny plik: nowej wartosci enuma nie wolno uzyc w transakcji, ktora ja dodaje.
-- Blizniak: supabase/migrations/20260926085900_crm_consent_source_event.sql.
ALTER TYPE public.crm_source_type ADD VALUE IF NOT EXISTS 'event';
