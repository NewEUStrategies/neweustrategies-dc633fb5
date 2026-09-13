-- Najemca KONTA o danym adresie - rozstrzygnięcie własnościowe dla poczty
-- autoryzacyjnej.
--
-- PRZYCZYNA ŹRÓDŁOWA. Webhook poczty autoryzacyjnej stemplował wiersz dziennika
-- najemcą z `email_resolve_tenant_for_address` (20260731120000:84-122), a ta
-- funkcja NIE JEST rozstrzygnięciem własności i nie do tego powstała. Robi dwie
-- rzeczy, które na ścieżce autoryzacyjnej są błędem:
--
--   * pyta NAJPIERW o `newsletter_subscribers`, a dopiero potem o `profiles`,
--     więc subskrypcja newslettera bije KONTO. Adres zapisany na newsletter
--     u najemcy A, mający konto u B, dostawał stempel A - a mail autoryzacyjny
--     dotyczy konta, nie subskrypcji;
--   * dla adresu nierozstrzygniętego zwraca `email_default_tenant_id()`, a NIE
--     NULL. To zamyka każdą ścieżkę zapasową: wołający, który chciał przy braku
--     odpowiedzi sięgnąć po hosta powrotu, nigdy do niej nie dochodzi, bo
--     dostaje tenanta domyślnego. Świeża rejestracja na serwisie B lądowała
--     więc u najemcy domyślnego zamiast u B.
--
-- Skutek był konkretny: wiersz `email_send_log` niesie SUROWY adres odbiorcy,
-- a panel raportu systemowego filtruje po `tenant_id`. Zły stempel to cudzy
-- operator widzący, że ten adres istnieje i właśnie prosił o reset hasła.
-- Dodatkowo stempel jawny OMIJA trigger `email_send_log_bind_tenant`
-- (20260913140000:152), więc baza nie ma już jak tego poprawić.
--
-- CO ROBI TA FUNKCJA: wyłącznie `profiles`, wyłącznie jednoznacznie, bez
-- fallbacku na tenanta domyślnego. Brak odpowiedzi to NULL - i to jest
-- odpowiedź, bo dopiero NULL pozwala wołającemu sięgnąć po host powrotu.
--
-- CZEGO NIE ROBI: nie zastępuje `email_resolve_tenant_for_address`. Tamta
-- zostaje dla wypisu, webhooka dostarczalności i poczty transakcyjnej, gdzie
-- pierwszeństwo subskrypcji i tenant domyślny są zamierzone.
CREATE OR REPLACE FUNCTION public.email_account_tenant_for_address(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_tenant uuid;
  v_count integer;
BEGIN
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT p.tenant_id) INTO v_count
    FROM public.profiles p
   WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;

  IF v_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT DISTINCT p.tenant_id INTO v_tenant
    FROM public.profiles p
   WHERE lower(btrim(p.email)) = v_email AND p.tenant_id IS NOT NULL;

  RETURN v_tenant;
END;
$fn$;

COMMENT ON FUNCTION public.email_account_tenant_for_address(text) IS
  'Najemca KONTA o tym adresie: wylacznie profiles, wylacznie jednoznacznie, bez fallbacku na tenanta domyslnego. NULL znaczy "nie wiadomo" i jest odpowiedzia - pozwala wolajacemu siegnac po host powrotu. Do poczty autoryzacyjnej; wypis i poczta transakcyjna zostaja przy email_resolve_tenant_for_address.';

REVOKE ALL ON FUNCTION public.email_account_tenant_for_address(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_account_tenant_for_address(text)
  TO service_role;
