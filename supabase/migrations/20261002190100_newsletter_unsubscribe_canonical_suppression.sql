-- ============================================================================
-- Wypis z newslettera stawia blokadę na KANONICZNEJ liście wykluczeń.
--
-- PRZYCZYNA ŹRÓDŁOWA. Wypis z newslettera (endpoint
-- /api/public/newsletter/unsubscribe, wołany ze strony /newsletter/unsubscribe,
-- a od tej poprawki także wprost z nagłówka List-Unsubscribe kampanii) zmieniał
-- WYŁĄCZNIE `newsletter_subscribers.status`. Do `email_suppressions` - jedynej
-- listy, o którą pytają digesty, dren kolejki pocztowej i brama zapisu
-- (migracja 20260731120000) - nie trafiało nic. Odbiorca wycofywał zgodę, a:
--   * digesty i każda inna wysyłka „za zgodą" nadal na niego szły,
--   * import CSV albo ręczna zmiana statusu w CRM po cichu przywracały go do
--     audiencji kampanii, bo nic poza flagą statusu go nie chroniło.
--
-- Drugi tor wypisu (/email/unsubscribe -> `email_unsubscribe_by_token`) stawiał
-- blokadę, ale miał trzy usterki tej samej klasy:
--   * status subskrybenta zmieniał wyłącznie trigger synchronizacji, który
--     NIE odpala, gdy adres ma już mocniejszą blokadę (skarga, twarde odbicie -
--     gałąź `kept_stronger` w email_record_suppression aktualizuje tylko
--     liczniki), i który połyka własne błędy (EXCEPTION WHEN OTHERS) - wypis
--     potrafił zwrócić sukces przy subskrybencie nadal `subscribed`;
--   * dla tokenu per subskrybent `already_unsubscribed` było ZAWSZE false
--     (v_claimed := v_email IS NOT NULL), więc ponowny klik raportował świeży
--     wypis;
--   * wynik email_record_suppression był ignorowany - nieudany zapis blokady
--     kończył się `ok: true`, a token globalny zostawał już zużyty.
--
-- Ta migracja:
--   1) redefiniuje `email_unsubscribe_by_token` jako JEDEN mechanizm wypisu dla
--      obu torów: najpierw same odczyty (z blokadą wiersza), potem w jednej
--      transakcji zapis statusu subskrybenta (+ unieważnienie tokenu
--      potwierdzenia), zużycie tokenu globalnego i blokada `unsubscribe`
--      w tenancie WŁAŚCICIELA wiersza. Nieudana blokada wycofuje wszystko -
--      status i lista wykluczeń są spójne albo nie zmieniają się wcale.
--      Sygnatura i kształt odpowiedzi bez zmian (typy wygenerowane aktualne);
--   2) dopisuje brakujące blokady dla subskrybentów wypisanych PRZED poprawką
--      (idempotentnie, per tenant subskrybenta, bez osłabiania mocniejszych
--      blokad i bez nadpisywania świadomego odblokowania przez operatora).
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Wypis jednym kliknięciem - wspólny dla tokenu globalnego i per subskrybent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_unsubscribe_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_email text;
  v_tenant uuid;
  v_global boolean := false;
  v_subscriber uuid;
  v_status text;
  v_claimed boolean := false;
  v_result jsonb;
BEGIN
  IF v_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;

  -- (a) Token globalny poczty systemowej (email_unsubscribe_tokens). Odczyt z
  -- blokadą wiersza zamiast UPDATE ... RETURNING: zużycie tokenu zapisujemy
  -- dopiero razem z blokadą, żeby wypis, który się nie udał, nie zostawiał
  -- tokenu „już użytego" (kolejny klik raportowałby fałszywe "już wypisany").
  SELECT lower(btrim(t.email)), t.used_at IS NULL
    INTO v_email, v_claimed
    FROM public.email_unsubscribe_tokens t
   WHERE t.token = v_token
   FOR UPDATE;
  v_global := FOUND;

  -- (b) Token per subskrybent newslettera (kampanie, RFC 8058 one-click).
  -- Blokada wiersza serializuje równoległe one-clicki (klient pocztowy potrafi
  -- POST-ować kilka razy) - drugi czeka i widzi już status `unsubscribed`.
  IF NOT v_global THEN
    SELECT ns.id, lower(btrim(ns.email)), ns.tenant_id, ns.status
      INTO v_subscriber, v_email, v_tenant, v_status
      FROM public.newsletter_subscribers ns
     WHERE ns.unsubscribe_token = v_token
     FOR UPDATE;
    -- "Już wypisany" mówi STAN wiersza, a nie fakt znalezienia tokenu.
    v_claimed := v_subscriber IS NOT NULL AND v_status IS DISTINCT FROM 'unsubscribed';
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  -- Tenant subskrybenta jest pewny (wiersz go niesie); dla tokenu globalnego
  -- rozstrzygamy jak wcześniej. Wszystko powyżej było odczytem, więc wczesny
  -- powrót niczego nie zostawia w połowie.
  v_tenant := COALESCE(v_tenant, public.email_resolve_tenant_for_address(v_email));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tenant');
  END IF;

  -- Status PRZED blokadą: trigger synchronizacji (tg_email_suppression_sync_
  -- subscriber) widzi wtedy wiersz już wypisany i nic nie robi, a my zapisujemy
  -- świeży `unsubscribed_at` i unieważniamy token potwierdzenia (inaczej stary
  -- link z maila double opt-in reaktywowałby subskrypcję). Robimy to sami, bo
  -- trigger nie odpala przy mocniejszej blokadzie i połyka własne błędy.
  IF v_subscriber IS NOT NULL THEN
    IF v_claimed THEN
      UPDATE public.newsletter_subscribers
         SET status = 'unsubscribed',
             unsubscribed_at = now(),
             confirmation_token = NULL,
             confirmation_expires_at = NULL
       WHERE id = v_subscriber;
    END IF;
  ELSE
    -- Token globalny: wypis z poczty systemowej zdejmuje też subskrypcję
    -- newslettera tego adresu - w tym samym tenancie co blokada, ten sam
    -- warunek dopasowania co trigger synchronizacji.
    UPDATE public.newsletter_subscribers ns
       SET status = 'unsubscribed',
           unsubscribed_at = now(),
           confirmation_token = NULL,
           confirmation_expires_at = NULL
     WHERE ns.tenant_id = v_tenant
       AND lower(ns.email) = v_email
       AND ns.status <> 'unsubscribed';

    IF v_claimed THEN
      UPDATE public.email_unsubscribe_tokens
         SET used_at = now()
       WHERE token = v_token AND used_at IS NULL;
    END IF;
  END IF;

  -- Blokada stawiana ZAWSZE, także przy ponownym kliknięciu: dzięki temu
  -- wiersze wypisane przed tą poprawką (bez wpisu na liście) dostają go przy
  -- pierwszym powtórnym kliknięciu, a email_record_suppression sam pilnuje,
  -- żeby nie osłabić mocniejszej blokady.
  v_result := public.email_record_suppression(
    p_tenant => v_tenant,
    p_email => v_email,
    p_reason => 'unsubscribe',
    p_source => 'system',
    p_provider => 'self_service',
    p_subscriber => v_subscriber,
    p_meta => jsonb_build_object(
      'channel', 'unsubscribe_link',
      'token_kind', CASE WHEN v_global THEN 'global' ELSE 'newsletter' END)
  );

  -- Wypis bez blokady to dokładnie ten stan, który ta funkcja ma wykluczać.
  -- Wyjątek wycofuje status i zużycie tokenu z tej samej transakcji; wołający
  -- dostaje błąd (500), a klient pocztowy ponowi żądanie.
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'suppression_not_recorded: %', COALESCE(v_result ->> 'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_unsubscribed', NOT v_claimed,
    'tenant_id', v_tenant);
END;
$fn$;

COMMENT ON FUNCTION public.email_unsubscribe_by_token(text) IS
  'Wypis jednym kliknieciem (token globalny lub per subskrybent): w JEDNEJ transakcji wypisuje subskrybenta (status + uniewaznienie tokenu potwierdzenia), zuzywa token globalny i stawia blokade unsubscribe w tenancie wlasciciela wiersza. Nieudana blokada wycofuje calosc. Idempotentny; already_unsubscribed odzwierciedla stan sprzed wywolania.';

REVOKE ALL ON FUNCTION public.email_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_by_token(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Backfill: subskrybenci wypisani przed poprawką, bez blokady na liście
--
-- Jeden wiersz na (tenant, adres) - tenant z WIERSZA subskrybenta, nigdy
-- zgadywany. Istniejący wpis zmieniamy tylko wtedy, gdy nie jest aktywną
-- blokadą trwałą:
--   * aktywna blokada trwała (skarga, odbicie, wypis, ręczna) zostaje - nie
--     osłabiamy jej i nie dublujemy,
--   * blokada czasowa (soft bounce, aktywna lub wygasła) ustępuje trwałemu
--     wypisowi - inaczej po jej wygaśnięciu adres wróciłby do wysyłki,
--   * blokada zdjęta przez operatora zostaje zdjęta, CHYBA że wypis jest od
--     odblokowania świeższy: wtedy to wola odbiorcy jest nowszą decyzją.
-- DISTINCT ON chroni ON CONFLICT DO UPDATE przed dwoma propozycjami dla tego
-- samego klucza w jednym poleceniu (adresy różniące się wielkością liter).
-- ----------------------------------------------------------------------------
INSERT INTO public.email_suppressions AS es (
  tenant_id, email, reason, scope, source, provider, subscriber_id,
  occurrences, diagnostic, expires_at, first_seen_at, last_seen_at, meta
)
SELECT DISTINCT ON (ns.tenant_id, lower(btrim(ns.email)))
  ns.tenant_id,
  lower(btrim(ns.email)),
  'unsubscribe'::text,
  'permanent'::text,
  'import'::text,
  'newsletter_status'::text,
  ns.id,
  1,
  'migracja 20261002190100: wypis z newslettera bez blokady na liscie kanonicznej'::text,
  NULL::timestamptz,
  COALESCE(ns.unsubscribed_at, ns.updated_at, now()),
  now(),
  -- `unsubscribed_at` w meta: ślad audytowy i - poniżej - jedyna data, po
  -- której wolno porównać wypis z odblokowaniem (brak daty = nie nadpisujemy).
  jsonb_build_object(
    'backfill', '20261002190100',
    'channel', 'newsletter_status',
    'unsubscribed_at', ns.unsubscribed_at)
FROM public.newsletter_subscribers ns
WHERE ns.status = 'unsubscribed'
  AND btrim(ns.email) <> ''
  AND position('@' in ns.email) > 0
ORDER BY ns.tenant_id, lower(btrim(ns.email)), ns.unsubscribed_at DESC NULLS LAST
ON CONFLICT (tenant_id, email_norm) DO UPDATE
   SET reason = EXCLUDED.reason,
       scope = EXCLUDED.scope,
       source = EXCLUDED.source,
       provider = EXCLUDED.provider,
       subscriber_id = COALESCE(es.subscriber_id, EXCLUDED.subscriber_id),
       occurrences = 1,
       expires_at = NULL,
       released_at = NULL,
       released_by = NULL,
       last_seen_at = now(),
       meta = es.meta || EXCLUDED.meta
 WHERE (es.released_at IS NULL AND es.scope <> 'permanent')
    OR (es.released_at IS NOT NULL
        AND es.released_at < (EXCLUDED.meta ->> 'unsubscribed_at')::timestamptz);
