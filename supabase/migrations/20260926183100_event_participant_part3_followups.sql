-- ============================================================================
-- Funkcje uczestnika wydarzenia: dopiecie kontraktow Fundamentu do nowego kodu
-- z 20260926180000 (braki modulu Wydarzen, czesc 3).
-- events-harness: include
--
-- PO CO TA MIGRACJA
-- 20260926180000 przenosi wszystkie naprawy D0 z 20260926153200 (kod QR i
-- zwolnienie przy zwrocie, `pg_temp`, ACL), ale jej NOWY kod omija trzy reguly
-- Fundamentu (20260926153100):
--   * R-1/S1 - jezyk odbiorcy czytamy WYLACZNIE przez
--     `_event_registration_lang` (`lang` zgloszenia -> profil -> newsletter ->
--     `lang` prowadzacego grupy -> pl). Wydanie biletu i zawiadomienie
--     o odwolanym bilecie mialy wlasna, krotsza kaskade (profil -> newsletter
--     -> pl), wiec gosc bez konta zapisany po angielsku dostawal oba maile po
--     polsku (hunki `issue-codes-lang`, `revoked-notice-lang`);
--   * D0-2 - kazda sciezka, ktora zamyka gosciowi bilet, zwalnia jego konto:
--     zapisy na sesje (z awansem kolejki sesji), zakladki planu i starsza
--     rezerwacje RSVP (`_event_participant_release`). Kaskada statusu
--     prowadzacego zamyka od 20260926120000 takze gosci JUZ przyjetych, ale
--     nikogo nie zwalniala (hunk `cascade-releases-guests`);
--   * A.3 - `event_sessions` to ostatni szczebel drabiny blokad. Zwrot grupy
--     zwalnial konta gosci W petli, a awans kolejki za ich miejsca (nowy
--     w 20260926180000) biegl PO petli - z powrotem w gore drabiny (hunk
--     `group-release-after-promote`).
--
-- KONTRAKT STRAZNIKA `_event_participant_release`: wolac PO odwolaniu /
-- przepieciu zgloszenia tracacego miejsce - samo nie liczy sie juz jako
-- aktywne, a konto z INNYM aktywnym zgloszeniem na to wydarzenie zostaje
-- nietkniete. Obie nowe sciezki wolaja go po zamknieciu wiersza goscia i po
-- awansie kolejki.
--
-- CIALA SKOPIOWANE W CALOSCI z 20260926180000 (ostatnia definicja wygrywa,
-- a ta migracja biegnie po niej): `_event_issue_ticket_codes` 810-910,
-- `_event_ticket_revoked_notices_claim` 651-734,
-- `_tg_event_group_follow_lead_status` 403-489,
-- `_event_apply_outcome_to_group` 507-637. Kazda zmiana jest oznaczona
-- `-- ZMIANA (PF-F): <slug>`, kazdy slug ma nazwana asercje `PF-F ZMIANA <slug>`
-- w `scripts/events-harness/runtime_test.d/77_participant_part3_followups.sql`.
-- Warunek rozliczenia `paid|partially_refunded|not_required` i cala reszta
-- cial - bez zmian. Tor B nie redefiniuje tych czterech funkcji; gdyby zmiana
-- stala sie konieczna, zaczyna od cial z TEJ migracji i zachowuje znaczniki.
--
-- KOLEJNOSC WDROZENIA: 20260926153100 -> 153200 -> 153300 -> 180000 -> ta
-- migracja. Wymaga `_event_participant_release(uuid, uuid, uuid, text)`
-- i `_event_registration_lang(uuid, uuid)` z 20260926153100.
--
-- MIGRACJA NIKOGO NIE POWIADAMIA i nie zmienia danych - tylko ciala funkcji,
-- ich komentarze i ACL (bez zmian: service_role; trigger bez GRANT-u).
-- ============================================================================

-- ============================================================================
-- 1) WYDANIE BILETOW: JEZYK ODBIORCY (issue-codes-lang)
-- ============================================================================
-- Cialo: 20260926180000:810-910. LOCKS: event_registrations (FOR UPDATE OF reg,
-- jak dotad); `_event_registration_lang` tylko czyta.
CREATE OR REPLACE FUNCTION public._event_issue_ticket_codes(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  v_root public.event_registrations;
  r record;
  v_qr text;
  v_manage text;
  v_claim timestamptz := clock_timestamp();
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_root FROM public.event_registrations reg
  WHERE reg.id = p_registration_id;
  IF v_root.id IS NULL THEN RETURN v_out; END IF;

  FOR r IN
    SELECT reg.id, reg.tenant_id, reg.manage_token_hash,
           (reg.group_lead_registration_id IS NOT NULL) AS is_guest,
           p.email, p.first_name,
           lp.first_name AS lead_first_name, lp.last_name AS lead_last_name,
           e.slug AS event_slug, e.title_pl AS event_title_pl, e.title_en AS event_title_en,
           e.starts_at AS event_starts_at, e.timezone AS event_timezone, e.location AS event_location,
           tt.name_pl AS ticket_name_pl, tt.name_en AS ticket_name_en,
           -- ZMIANA (PF-F): issue-codes-lang - jezyk odbiorcy WYLACZNIE przez
           -- `_event_registration_lang` (R-1): `lang` zgloszenia -> profil ->
           -- newsletter najemcy -> `lang` prowadzacego grupy -> pl. Kaskada
           -- z 20260926180000 pomijala dwa pierwsze i ostatni szczebel, wiec gosc
           -- bez konta zapisany po angielsku dostawal bilet po polsku.
           public._event_registration_lang(reg.tenant_id, reg.id) AS lang
    FROM public.event_registrations reg
    JOIN public.event_people p ON p.id = reg.person_id AND p.tenant_id = reg.tenant_id
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    LEFT JOIN public.event_ticket_types tt ON tt.id = reg.ticket_type_id AND tt.tenant_id = reg.tenant_id
    LEFT JOIN public.event_registrations lr
      ON lr.id = reg.group_lead_registration_id AND lr.tenant_id = reg.tenant_id
    LEFT JOIN public.event_people lp ON lp.id = lr.person_id AND lp.tenant_id = lr.tenant_id
    WHERE reg.tenant_id = v_root.tenant_id
      AND (reg.id = v_root.id OR reg.group_lead_registration_id = v_root.id)
      AND reg.status IN ('approved', 'attended')
      AND reg.payment_status IN ('paid', 'partially_refunded', 'not_required')
      AND reg.ticket_code_sent_at IS NULL
      AND (reg.ticket_code_claimed_at IS NULL
           OR reg.ticket_code_claimed_at < now() - interval '15 minutes')
    ORDER BY (reg.id = v_root.id) DESC, reg.created_at, reg.id
    FOR UPDATE OF reg
  LOOP
    v_qr := public._event_new_qr_token();
    -- Klucz samoobslugi wydajemy gosciowi grupy (przy kazdym zajeciu - klucz
    -- z nieudanej wysylki nigdzie nie dotarl) i temu, kto go nie ma. Klucza
    -- z `event_register` nie rotujemy: uniewaznilby link z potwierdzenia zapisu.
    v_manage := CASE WHEN r.is_guest OR r.manage_token_hash IS NULL
                     THEN public._event_new_qr_token() END;
    UPDATE public.event_registrations reg SET
      qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex'),
      qr_issued_at = now(),
      manage_token_hash = CASE WHEN v_manage IS NOT NULL
        THEN encode(digest(v_manage, 'sha256'), 'hex') ELSE reg.manage_token_hash END,
      ticket_code_claimed_at = v_claim,
      updated_at = now()
    WHERE reg.id = r.id AND reg.tenant_id = v_root.tenant_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'registration_id', r.id,
      'tenant_id', r.tenant_id,
      'claimed_at', v_claim,
      'is_guest', r.is_guest,
      'qr_token', v_qr,
      'manage_token', v_manage,
      'email', r.email,
      'first_name', r.first_name,
      'lang', r.lang,
      'lead_first_name', CASE WHEN r.is_guest THEN r.lead_first_name END,
      'lead_last_name', CASE WHEN r.is_guest THEN r.lead_last_name END,
      'event_slug', r.event_slug,
      'event_title_pl', r.event_title_pl,
      'event_title_en', r.event_title_en,
      'event_starts_at', r.event_starts_at,
      'event_timezone', r.event_timezone,
      'event_location', r.event_location,
      'ticket_name_pl', r.ticket_name_pl,
      'ticket_name_en', r.ticket_name_en));
  END LOOP;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public._event_issue_ticket_codes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_issue_ticket_codes(uuid) TO service_role;

-- ZMIANA (PF-F): issue-codes-lang - funkcja nie miala komentarza; opis
-- kontraktu, w tym warunku rozliczenia z 20260926180000 i jezyka (R-1).
COMMENT ON FUNCTION public._event_issue_ticket_codes(uuid) IS
  'Wydanie biletow zgloszenia i jego gosci grupy (kod QR, klucz samoobslugi gosciom i temu, kto go nie ma): wiersze approved/attended z payment_status paid, partially_refunded albo not_required, bez znacznika wysylki, poza zywa dzierzawa (15 min); rotuje skrot kodu i stawia dzierzawe. Zwraca tresc maili, jezyk odbiorcy z _event_registration_lang (R-1). Wylacznie service_role.';

-- ============================================================================
-- 2) ZAWIADOMIENIE O ODWOLANYM BILECIE: JEZYK ODBIORCY (revoked-notice-lang)
-- ============================================================================
-- Cialo: 20260926180000:651-734. LOCKS: bez zmian (FOR UPDATE OF reg SKIP LOCKED).
CREATE OR REPLACE FUNCTION public._event_ticket_revoked_notices_claim(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_claim timestamptz := clock_timestamp();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_notices jsonb;
BEGIN
  WITH picked AS (
    SELECT reg.id,
           (COALESCE(e.ends_at, e.starts_at + interval '1 day') <= now()
            OR reg.notify_email IS FALSE) AS closes_silently
    FROM public.event_registrations reg
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    WHERE reg.ticket_revoked_at IS NOT NULL
      AND (reg.ticket_revoked_notice_claimed_at IS NULL
           OR reg.ticket_revoked_notice_claimed_at < now() - interval '15 minutes')
      AND (reg.status NOT IN ('approved', 'attended', 'no_show')
           OR COALESCE(e.ends_at, e.starts_at + interval '1 day') <= now())
    ORDER BY reg.ticket_revoked_at, reg.id
    LIMIT v_limit
    FOR UPDATE OF reg SKIP LOCKED
  ), marked AS (
    UPDATE public.event_registrations reg SET
      ticket_revoked_at = CASE WHEN p.closes_silently THEN NULL ELSE reg.ticket_revoked_at END,
      ticket_revoked_notice_claimed_at = CASE WHEN p.closes_silently THEN NULL ELSE v_claim END
    FROM picked p
    WHERE reg.id = p.id
    RETURNING reg.id, reg.tenant_id, reg.event_id, reg.person_id, reg.ticket_type_id,
              reg.group_lead_registration_id, reg.ticket_revoked_at, p.closes_silently
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'registration_id', m.id,
           'tenant_id', m.tenant_id,
           'revoked_at', m.ticket_revoked_at,
           'email', p.email,
           'first_name', p.first_name,
           -- ZMIANA (PF-F): revoked-notice-lang - jezyk jak przy wydaniu biletu,
           -- wylacznie przez `_event_registration_lang` (R-1).
           'lang', public._event_registration_lang(m.tenant_id, m.id),
           'lead_first_name', lp.first_name,
           'lead_last_name', lp.last_name,
           'event_slug', e.slug,
           'event_title_pl', e.title_pl,
           'event_title_en', e.title_en,
           'event_starts_at', e.starts_at,
           'event_timezone', e.timezone,
           'ticket_name_pl', tt.name_pl,
           'ticket_name_en', tt.name_en)
         ORDER BY m.ticket_revoked_at, m.id), '[]'::jsonb)
  INTO v_notices
  FROM marked m
  JOIN public.event_people p ON p.id = m.person_id AND p.tenant_id = m.tenant_id
  JOIN public.events e ON e.id = m.event_id AND e.tenant_id = m.tenant_id
  LEFT JOIN public.event_ticket_types tt ON tt.id = m.ticket_type_id AND tt.tenant_id = m.tenant_id
  LEFT JOIN public.event_registrations lr
    ON lr.id = m.group_lead_registration_id AND lr.tenant_id = m.tenant_id
  LEFT JOIN public.event_people lp ON lp.id = lr.person_id AND lp.tenant_id = lr.tenant_id
  WHERE NOT m.closes_silently;

  RETURN jsonb_build_object('claimed_at', v_claim, 'notices', v_notices);
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_revoked_notices_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_revoked_notices_claim(integer) TO service_role;

-- ZMIANA (PF-F): revoked-notice-lang - komentarz z 20260926180000
-- uzupelniony o regule jezyka (R-1).
COMMENT ON FUNCTION public._event_ticket_revoked_notices_claim(integer) IS
  'Zajmuje do p_limit (1-200, domyslnie 20) zawiadomien o biletach odwolanych razem z grupa (ticket_revoked_at), najstarsze pierwsze, SKIP LOCKED, dzierzawa 15 min; pomija wiersze znow przyjete, dopoki wydarzenie trwa; po wydarzeniu i przy notify_email = false zamyka znacznik bez maila. Zwraca {claimed_at, notices:[...]} z trescia maila; jezyk odbiorcy z _event_registration_lang (R-1). Wylacznie service_role.';

-- ============================================================================
-- 3) KASKADA STATUSU ZWALNIA KONTA ZAMKNIETYCH GOSCI (cascade-releases-guests)
-- ============================================================================
-- Cialo: 20260926180000:403-489. LOCKS: event_registrations gosci (FOR UPDATE,
-- kolejnosc wydania) -> awans kolejki (event_ticket_types, event_registrations)
-- -> event_sessions (w `_event_participant_release`, ostatni szczebel).
CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_restamp boolean;
  v_freed uuid[];
  v_users uuid[];   -- ZMIANA (PF-F): cascade-releases-guests
  v_u uuid;
BEGIN
  -- PRZYJECIE. Z oczekiwania - i z odrzucenia albo anulowania: wtedy wracaja
  -- takze goscie zamknieci RAZEM z prowadzacym (od tej migracji - takze ci,
  -- ktorzy byli juz przyjeci). Pomylkowe odrzucenie i ponowne zatwierdzenie
  -- to zwykly przebieg pracy organizatora.
  IF NEW.status = 'approved'
     AND OLD.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled') THEN
    PERFORM public._event_group_admit_guests(NEW, OLD);

  -- ODRZUCENIE I ANULOWANIE. Goscie, ktorzy czekaja, i goscie JUZ przyjeci -
  -- grupa idzie za decyzja o prowadzacym, a bilet odwolanej grupy nie moze
  -- wpuszczac. `attended`/`no_show` zostaja (fakt z sali). Kolumny ustawiamy
  -- pod CHECK-i: odrzucenie przez organizatora wymaga powodu
  -- (`rejection_has_reason`), anulowanie - daty (`cancelled_dated`). Data
  -- anulowania i chwila decyzji sa STEMPLEM prowadzacego - po nim
  -- `_event_guest_closed_with_lead` rozpozna tych gosci przy ponownym przyjeciu.
  --
  -- KTO ZAMKNAL GOSCIA - tylko ten, kto WLASNIE podjal decyzje (patrz
  -- 20260926100000): bez nowego stempla decyzji gosc dostaje `system` bez
  -- autora i zachowuje wlasna notatke.
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    v_restamp := NEW.status = 'rejected' OR NEW.decided_at IS DISTINCT FROM OLD.decided_at;

    -- Bilety przyjetych gosci PRZED zamknieciem - po nim status juz ich nie
    -- odroznia od czekajacych. Blokada w kolejnosci wydania biletow.
    SELECT array_agg(r.ticket_type_id ORDER BY r.created_at, r.id) INTO v_freed
    FROM (
      SELECT g.ticket_type_id, g.created_at, g.id
      FROM public.event_registrations g
      WHERE g.tenant_id = NEW.tenant_id
        AND g.group_lead_registration_id = NEW.id
        AND g.status = 'approved'
      ORDER BY g.created_at, g.id
      FOR UPDATE
    ) r;

    -- ZMIANA (PF-F): cascade-releases-guests - ta sama instrukcja zamkniecia
    -- (SET i WHERE bez zmian), ktora teraz ZWRACA osoby zamknietych gosci.
    WITH closed AS (
    UPDATE public.event_registrations r SET
      status = NEW.status,
      decision_note = CASE
        WHEN v_restamp THEN COALESCE(NEW.decision_note, r.decision_note)
        ELSE r.decision_note
      END,
      decided_by = CASE WHEN v_restamp THEN NEW.decided_by END,
      decided_at = now(),
      decision_source = CASE
        WHEN v_restamp THEN COALESCE(NEW.decision_source, 'system')
        ELSE 'system'
      END,
      cancelled_at = CASE
        WHEN NEW.status = 'cancelled' THEN NEW.cancelled_at
        ELSE r.cancelled_at
      END,
      waitlist_position = NULL,
      qr_token_hash = NULL,
      qr_issued_at = NULL,
      -- ZAWIADOMIENIE (20260926180000): gosc, do ktorego bilet dotarl albo
      -- byl w drodze. Wyrazenie widzi wiersz SPRZED zamkniecia.
      ticket_revoked_at = CASE
        WHEN public._event_guest_ticket_reached(r) THEN now() ELSE r.ticket_revoked_at
      END,
      -- Nowe zawiadomienie zdejmuje dzierzawe starego: rozliczenie starego
      -- zajecia zamknelloby nowe.
      ticket_revoked_notice_claimed_at = CASE
        WHEN public._event_guest_ticket_reached(r) THEN NULL
        ELSE r.ticket_revoked_notice_claimed_at
      END,
      updated_at = now()
    WHERE r.tenant_id = NEW.tenant_id
      AND r.group_lead_registration_id = NEW.id
      AND r.status IN ('draft', 'pending', 'waitlist', 'approved')
    RETURNING r.person_id
    )
    SELECT array_agg(DISTINCT p.user_id) FILTER (WHERE p.user_id IS NOT NULL)
      INTO v_users
      FROM closed c
      JOIN public.event_people p ON p.id = c.person_id AND p.tenant_id = NEW.tenant_id;

    PERFORM public._event_group_promote_freed(NEW.tenant_id, NEW.event_id, v_freed);

    -- ZMIANA (PF-F): cascade-releases-guests - zamkniety gosc traci zapisy na sesje,
    -- zakladki i starsza RSVP (D0-2). PO zamknieciu (kontrakt straznika) i PO awansie
    -- (event_sessions ostatnia blokada, A.3). Straznik `_event_participant_release`
    -- pomija konto, ktore nadal trzyma inne aktywne zgloszenie na to wydarzenie;
    -- `attended`/`no_show` nie sa zamykani, wiec nie trafiaja do listy.
    FOREACH v_u IN ARRAY COALESCE(v_users, ARRAY[]::uuid[]) LOOP
      PERFORM public._event_participant_release(NEW.tenant_id, NEW.event_id, v_u, 'group_closed');
    END LOOP;
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead_status() FROM PUBLIC, anon, authenticated;

-- ZMIANA (PF-F): cascade-releases-guests - komentarz z 20260926180000 uzupelniony
-- o zwolnienie kont zamknietych gosci (D0-2).
COMMENT ON FUNCTION public._tg_event_group_follow_lead_status() IS
  'Kaskada statusu prowadzacego grupy na gosci: zatwierdzenie przyjmuje gosci rozliczonych (albo stawia ich w kolejce, gdy brak miejsca) i przywraca gosci zamknietych razem z prowadzacym (_event_group_admit_guests), odrzucenie i anulowanie zamyka gosci czekajacych i przyjetych (kod QR przestaje wpuszczac; attended/no_show zostaja) - ze sladem decydujacego tylko wtedy, gdy ta instrukcja stemplowala decyzje prowadzacego - i promuje kolejke za zwolnione miejsca. Gosciom, do ktorych bilet dotarl, stempluje zawiadomienie o odwolanym bilecie (ticket_revoked_at). Po awansie konta zamknietych gosci traca zapisy na sesje, zakladki i starsza rezerwacje RSVP (_event_participant_release, D0-2; konto z innym aktywnym zgloszeniem zostaje). Nieoplaconych gosci przyjmuje trigger platnosci.';

-- ============================================================================
-- 4) ZWROT GRUPY: ZWOLNIENIE KONT PO AWANSIE KOLEJKI (group-release-after-promote)
-- ============================================================================
-- Cialo: 20260926180000:507-637. LOCKS: event_registrations gosci (FOR UPDATE)
-- -> awans kolejki -> event_sessions (w `_event_participant_release`).
CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_lead public.event_registrations;
  v_tenant uuid;
  v_token text;
  v_n integer := 0;
  v_freed uuid[] := ARRAY[]::uuid[];
  v_seated boolean;
  v_guest_user uuid;
  v_release uuid[] := ARRAY[]::uuid[];   -- ZMIANA (PF-F): group-release-after-promote
BEGIN
  SELECT * INTO v_lead FROM public.event_registrations l WHERE l.id = p_lead_id;
  v_tenant := v_lead.tenant_id;
  -- GOSCIE NIE WCHODZA PRZED PROWADZACYM (pozycja 5). Wplata bez miejsca stawia
  -- prowadzacego w kolejce, a bilet z akceptacja - w oczekiwaniu na decyzje.
  -- Goscie sa wtedy tylko rozliczani; przyjmie ich kaskada statusu, gdy
  -- prowadzacy wejdzie na miejsce (awans z kolejki albo decyzja organizatora).
  v_seated := v_lead.status IN ('approved', 'attended', 'no_show');

  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id AND r.tenant_id = v_tenant
    ORDER BY r.created_at, r.id
    FOR UPDATE LOOP
    IF p_outcome IN ('refunded', 'partial_refund')
       AND g.payment_status NOT IN ('paid', 'partially_refunded') THEN
      CONTINUE;
    END IF;
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      IF g.status IN ('draft','pending','waitlist') THEN
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
        IF v_seated THEN
          UPDATE public.event_ticket_types t SET sold_count = c.cnt
          FROM (
            SELECT count(*)::integer AS cnt
            FROM public.event_registrations x
            WHERE x.tenant_id = v_tenant
              AND x.ticket_type_id = g.ticket_type_id
              AND x.status IN ('approved', 'attended', 'no_show')
          ) c
          WHERE t.id = g.ticket_type_id AND t.tenant_id = v_tenant AND t.sold_count <> c.cnt;
          PERFORM public._event_group_admit_guest(v_lead, g);
        END IF;
      ELSE
        -- Gosc juz przyjety albo obecny: tylko rozliczenie. Kod zostaje (albo
        -- powstaje, gdy przyjecie przyszlo bez niego).
        v_token := public._event_new_qr_token();
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          waitlist_position = NULL,
          decided_at = COALESCE(r.decided_at, now()),
          decision_source = COALESCE(r.decision_source, 'system'),
          qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
          qr_issued_at = COALESCE(r.qr_issued_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
      END IF;
    ELSIF p_outcome = 'refunded' THEN
      -- Miejsce zajmowal gosc przyjety albo juz na sali - te same statusy,
      -- ktore liczy `_event_seats_left`. Gosc oplacony w kolejce, wycofany
      -- albo odrzucony miejsca nie trzymal.
      IF g.status IN ('approved', 'attended', 'no_show') THEN
        v_freed := array_append(v_freed, g.ticket_type_id);
      END IF;
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        -- ZMIANA (PF-F): group-refund-clears-qr - kod wejscia goscia traci
        -- waznosc razem z biletem prowadzacego (D0-2).
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        -- Zawiadomienie o odwolanym bilecie (sekcja 1) - wyrazenie widzi
        -- wiersz SPRZED zwrotu, jak w kaskadzie statusu.
        ticket_revoked_at = CASE
          WHEN public._event_guest_ticket_reached(r) THEN now() ELSE r.ticket_revoked_at
        END,
        ticket_revoked_notice_claimed_at = CASE
          WHEN public._event_guest_ticket_reached(r) THEN NULL
          ELSE r.ticket_revoked_notice_claimed_at
        END,
        updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
      -- ZMIANA (PF-F): group-refund-releases-guests - konto goscia (jesli jest)
      -- traci zapisy na sesje, zakladki i starsza rezerwacje RSVP. Tylko gosc,
      -- ktory zaplacil (warunek na poczatku petli), wiec zwalniamy dokladnie
      -- tych, ktorych zwrot odwolal.
      SELECT p.user_id INTO v_guest_user
        FROM public.event_people p
       WHERE p.id = g.person_id AND p.tenant_id = v_tenant;
      -- ZMIANA (PF-F): group-release-after-promote - konto trafia na liste,
      -- a zwolnienie biegnie PO awansie kolejki (event_sessions ostatnia
      -- blokada, A.3). Nadal PO anulowaniu wiersza goscia (kontrakt straznika).
      IF v_guest_user IS NOT NULL THEN
        v_release := array_append(v_release, v_guest_user);
      END IF;
    ELSIF p_outcome = 'partial_refund' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'partially_refunded', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
    ELSE
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'unpaid', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant AND r.payment_status <> 'paid';
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- AWANS ZA MIEJSCA ZWOLNIONE ZWROTEM - PO PETLI, bez wlasnej grupy (patrz
  -- naglowek). Miejsce prowadzacego awansuje wolajacy, po kaskadzie statusu.
  IF cardinality(v_freed) > 0 THEN
    PERFORM public._event_group_promote_freed(v_tenant, v_lead.event_id, v_freed, p_lead_id);
  END IF;

  -- ZMIANA (PF-F): group-release-after-promote - zwolnienie kont zwroconych
  -- gosci (group-refund-releases-guests) na ostatnim szczeblu drabiny blokad.
  FOREACH v_guest_user IN ARRAY v_release LOOP
    PERFORM public._event_participant_release(v_tenant, v_lead.event_id, v_guest_user, 'refunded');
  END LOOP;

  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) TO service_role;

-- ZMIANA (PF-F): group-release-after-promote - komentarz z 20260926180000
-- uzupelniony o kolejnosc zwolnienia (A.3).
COMMENT ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) IS
  'Wynik platnosci prowadzacego na gosciach grupy: paid rozlicza czekajacych i - gdy prowadzacy jest na miejscu - przyjmuje ich z kontrola miejsc (_event_group_admit_guest - miejsce albo kolejka, takze na sciezce Stripe), przyjetym tylko rozlicza; refunded anuluje oplaconych, czysci ich kody QR, stawia znacznik zawiadomienia tym, do ktorych bilet dotarl, awansuje kolejke za miejsca, ktore zajmowali, z pominieciem wlasnej grupy, a PO awansie zwalnia zapisy na sesje, zakladki i starsza rezerwacje RSVP ich kont (D0-2; event_sessions ostatnia blokada, A.3); partial_refund i unpaid tylko rozliczaja. Zamowienie trafia do goscia tylko, gdy wynik je przyniosl.';
