ALTER TABLE public.club_threads
  ADD COLUMN IF NOT EXISTS poll_id uuid REFERENCES public.polls(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.club_threads.poll_id IS
  'Ankieta watku kind=poll. Reuzywa polls/poll_votes - modul klubow nie ma wlasnego glosowania i miec nie powinien.';

ALTER TABLE public.club_threads
  DROP CONSTRAINT IF EXISTS club_threads_poll_only_poll_kind;
ALTER TABLE public.club_threads
  ADD CONSTRAINT club_threads_poll_only_poll_kind
  CHECK (poll_id IS NULL OR kind = 'poll');

CREATE INDEX IF NOT EXISTS club_threads_poll_idx
  ON public.club_threads (poll_id) WHERE poll_id IS NULL IS FALSE;

DROP FUNCTION IF EXISTS public.club_thread_view(uuid, text);

CREATE FUNCTION public.club_thread_view(p_club_id uuid, p_slug text)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, slug text,
  title text, body text, kind text, status text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, locked_at timestamptz, resolved_reply_id uuid,
  created_at timestamptz, edited_at timestamptz,
  attribution_mode text, poll_id uuid,
  can_reply boolean, can_moderate boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.club_id, t.group_id, t.slug,
    t.title, t.body, t.kind, t.status,
    t.anchor_type, t.anchor_id,
    t.is_anonymous,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL ELSE t.author_id END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham'
         THEN public.club_author_alias(t.id, t.author_id) ELSE NULL END,
    NULLIF(btrim(pa.display_name), ''),
    t.reply_count, t.participant_count, t.reaction_count,
    t.pinned_at, t.locked_at, t.resolved_reply_id,
    t.created_at, t.edited_at,
    attr.mode,
    CASE WHEN t.kind = 'poll' THEN t.poll_id ELSE NULL END,
    (cap.can_reply AND t.locked_at IS NULL AND t.status NOT IN ('locked', 'hidden', 'deleted')),
    cap.can_moderate,
    cap.reason
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL (SELECT COALESCE(g.attribution_mode, c.attribution_mode) AS mode) attr
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  LEFT JOIN public.profiles p ON p.id = t.author_id
  LEFT JOIN public.profiles pa ON pa.id = t.posted_by_admin_id
  WHERE t.club_id = p_club_id
    AND t.slug = p_slug
    AND cap.can_read
    AND (
      t.status IN ('open', 'resolved', 'dormant', 'locked')
      OR cap.can_moderate
      OR (t.status = 'pending' AND t.author_id = auth.uid())
    )
$$;

COMMENT ON FUNCTION public.club_thread_view(uuid, text) IS
  'Widok watku. Warstwa projekcji reguly Chatham House. poll_id wychodzi wylacznie dla kind=poll.';

REVOKE EXECUTE ON FUNCTION public.club_thread_view(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_view(uuid, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_poll_create(
  p_group_id   uuid,
  p_title      text,
  p_body       text,
  p_question_pl text,
  p_question_en text,
  p_options    jsonb,
  p_ends_at    timestamptz DEFAULT NULL,
  p_author_id  uuid DEFAULT NULL
)
RETURNS TABLE (thread_id uuid, thread_slug text, poll_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_group  public.club_groups%ROWTYPE;
  v_poll   uuid;
  v_thread uuid;
  v_base   text;
  v_slug   text;
  v_n      integer := 0;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT g.* INTO v_group
    FROM public.club_groups g
    JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = p_group_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_options) <> 'array' OR jsonb_array_length(p_options) NOT BETWEEN 2 AND 8 THEN
    RAISE EXCEPTION 'clubs: poll needs 2-8 options' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.polls (tenant_id, question_pl, question_en, options, status, ends_at, created_by)
  VALUES (v_tenant, btrim(p_question_pl), btrim(p_question_en), p_options, 'open', p_ends_at, auth.uid())
  RETURNING id INTO v_poll;

  v_base := NULLIF(regexp_replace(
              lower(unaccent(btrim(p_title))), '[^a-z0-9]+', '-', 'g'
            ), '');
  v_base := btrim(COALESCE(v_base, 'sondaz'), '-');
  v_base := left(v_base, 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.club_threads
                 WHERE club_id = v_group.club_id AND club_threads.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status, poll_id
  ) VALUES (
    v_tenant, v_group.club_id, p_group_id,
    COALESCE(p_author_id, auth.uid()), auth.uid(),
    v_slug, btrim(p_title), btrim(p_body), 'poll', 'open', v_poll
  )
  RETURNING id INTO v_thread;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, v_group.club_id, auth.uid(), 'post_on_behalf', 'thread', v_thread, 'poll');

  RETURN QUERY SELECT v_thread, v_slug, v_poll;
END;
$$;

COMMENT ON FUNCTION public.admin_club_poll_create(uuid, text, text, text, text, jsonb, timestamptz, uuid) IS
  'Zaklada sondaz klubowy: ankieta w polls + watek kind=poll w JEDNEJ transakcji.';

REVOKE EXECUTE ON FUNCTION
  public.admin_club_poll_create(uuid, text, text, text, text, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_club_poll_create(uuid, text, text, text, text, jsonb, timestamptz, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_anonymity_salt(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions
AS $salt$
DECLARE
  v_salt text;
BEGIN
  SELECT salt INTO v_salt FROM public.club_anonymity_salts WHERE tenant_id = _tenant_id;
  IF v_salt IS NOT NULL THEN
    RETURN v_salt;
  END IF;
  INSERT INTO public.club_anonymity_salts (tenant_id, salt)
  VALUES (_tenant_id, encode(extensions.gen_random_bytes(32), 'hex'))
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT salt INTO v_salt FROM public.club_anonymity_salts WHERE tenant_id = _tenant_id;
  RETURN v_salt;
END;
$salt$;

DO $seed$
DECLARE
  v_tenant   uuid := public.public_tenant_id();
  v_owner    uuid;
  v_club     uuid;
  g_debata   uuid;
  g_dossier  uuid;
  g_stanowis uuid;
  g_biblio   uuid;
  g_kuluary  uuid;
  v_thread   uuid;
  v_reply    uuid;
  v_poll     uuid;
  v_anchor   text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'clubs: brak tenantu publicznego - seed klubu referencyjnego pominiety';
    RETURN;
  END IF;

  SELECT ur.user_id INTO v_owner
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE p.tenant_id = v_tenant
     AND ur.role IN ('super_admin', 'admin')
   ORDER BY ur.role = 'super_admin' DESC
   LIMIT 1;

  INSERT INTO public.clubs (
    tenant_id, slug, name_pl, name_en, tagline_pl, tagline_en,
    description_pl, description_en, icon, accent_color,
    visibility, join_policy, attribution_mode, who_can_post, moderation_mode,
    policy_area, rules_pl, rules_en, status, created_by
  ) VALUES (
    v_tenant,
    'bezpieczenstwo-europy-srodkowo-wschodniej',
    'Bezpieczeństwo Europy Środkowo-Wschodniej',
    'Central and Eastern European Security',
    'Trwała deliberacja o architekturze bezpieczeństwa regionu - w rytmie procesu legislacyjnego, nie w rytmie newsów.',
    'A standing deliberation on the region''s security architecture - paced by the legislative process, not by the news cycle.',
    E'Klub skupia osoby, które pracują nad bezpieczeństwem Europy Środkowo-Wschodniej zawodowo: w administracji, przemyśle, think-tankach i redakcjach.\n\nNie jest to forum. Wątek zakłada się wtedy, gdy ma prowadzić do rozstrzygnięcia: odpowiedzi na pytanie, wspólnego stanowiska, uporządkowanego materiału albo decyzji. Reakcje są tu danymi - "wnikliwe" i "poparte źródłem" zasilają ranking, a "zgadzam się" i "nie zgadzam się" budują mapę sporu, której nie da się odczytać z liczby postów.\n\nDyskusja jest zakotwiczona w treści platformy: wątek przypięty do aktu prawnego wraca do uczestników, gdy ten akt zmienia etap.',
    E'The club brings together people who work on Central and Eastern European security professionally: in government, industry, think tanks and newsrooms.\n\nThis is not a forum. A thread is opened when it is meant to reach an outcome: an answer, a shared position, an organised body of material, or a decision. Reactions are data here - "insightful" and "evidence" feed the ranking, while "agree" and "disagree" build a map of disagreement that no post count could show.\n\nDiscussion is anchored in platform content: a thread pinned to a policy file comes back to participants when that file changes stage.',
    'ShieldQuestion',
    '#1d4ed8',
    'members',
    'request',
    'anonymous_allowed',
    'members',
    'trusted',
    'security',
    E'1. Piszemy pod nazwiskiem. Tryb anonimowy jest dostępny dla wypowiedzi, których nie da się podpisać - nie dla wygody.\n\n2. Teza wymaga źródła. Reakcja "poparte źródłem" jest tu walutą i nie stawia się jej z uprzejmości.\n\n3. Nie streszczamy newsów. Wątek zaczyna się tam, gdzie kończy się doniesienie prasowe.\n\n4. Spór jest mile widziany, personalizacja nie. Zgłoszenie wpisu trafia do prowadzących klubu i do zespołu platformy.\n\n5. Treść zostaje. Usunięcie konta anonimizuje autorstwo, ale nie kasuje wypowiedzi - dyskusja jest dorobkiem zbiorowym i rozbijanie cudzych wątków byłoby stratą dla wszystkich. Wstępując, zgadzasz się na tę zasadę.',
    E'1. We write under our own names. Anonymous mode exists for statements that cannot be signed - not for convenience.\n\n2. A claim needs a source. The "evidence" reaction is the currency here and is not given out of politeness.\n\n3. We do not summarise the news. A thread starts where the press report ends.\n\n4. Disagreement is welcome, personal attacks are not. Reporting a post reaches the club leads and the platform team.\n\n5. Content stays. Deleting an account anonymises authorship but does not remove the statements - discussion is a collective asset and breaking other people''s threads would be a loss for everyone. By joining, you accept this rule.',
    'active',
    v_owner
  )
  ON CONFLICT (tenant_id, slug) DO NOTHING;

  SELECT id INTO v_club FROM public.clubs
   WHERE tenant_id = v_tenant AND slug = 'bezpieczenstwo-europy-srodkowo-wschodniej';
  IF v_club IS NULL THEN RETURN; END IF;

  INSERT INTO public.club_groups (
    tenant_id, club_id, slug, name_pl, name_en, description_pl, description_en,
    icon, sort_order, visibility, who_can_post, moderation_mode, attribution_mode,
    status, created_by
  ) VALUES
    (v_tenant, v_club, 'debata', 'Debata otwarta', 'Open debate',
     'Główna przestrzeń klubu. Wątek zakłada każdy członek.',
     'The club''s main space. Any member can open a thread.',
     'MessagesSquare', 10, NULL, 'members', NULL, NULL, 'active', v_owner),
    (v_tenant, v_club, 'dossier', 'Akty prawne', 'Policy files',
     'Wątki zakotwiczone w konkretnym akcie prawnym. Budzą się, gdy akt zmienia etap.',
     'Threads anchored to a specific policy file. They wake up when the file changes stage.',
     'Scale', 20, NULL, 'members', NULL, NULL, 'active', v_owner),
    (v_tenant, v_club, 'stanowiska', 'Stanowiska klubu', 'Club positions',
     'Wątki, które mają się skończyć wspólnym stanowiskiem. Zakłada prowadzący.',
     'Threads meant to end in a shared position. Opened by the leads.',
     'Vote', 30, NULL, 'moderators', NULL, NULL, 'active', v_owner),
    (v_tenant, v_club, 'biblioteka', 'Biblioteka', 'Library',
     'Materiały, raporty i dane. Premoderacja - biblioteka bez kuratora przestaje być biblioteką.',
     'Materials, reports and data. Pre-moderated - an uncurated library stops being a library.',
     'BookOpenCheck', 40, NULL, 'members', 'pre', NULL, 'active', v_owner),
    (v_tenant, v_club, 'kuluary', 'Kuluary', 'Corridor',
     'Reguła Chatham House: treść jest cytowalna, tożsamość nie.',
     'Chatham House rule: the content may be quoted, the identity may not.',
     'ShieldQuestion', 50, 'private', 'members', NULL, 'chatham', 'active', v_owner)
  ON CONFLICT (club_id, slug) DO NOTHING;

  SELECT id INTO g_debata   FROM public.club_groups WHERE club_id = v_club AND slug = 'debata';
  SELECT id INTO g_dossier  FROM public.club_groups WHERE club_id = v_club AND slug = 'dossier';
  SELECT id INTO g_stanowis FROM public.club_groups WHERE club_id = v_club AND slug = 'stanowiska';
  SELECT id INTO g_biblio   FROM public.club_groups WHERE club_id = v_club AND slug = 'biblioteka';
  SELECT id INTO g_kuluary  FROM public.club_groups WHERE club_id = v_club AND slug = 'kuluary';

  SELECT i.id::text INTO v_anchor
    FROM public.eu_policy_items i
   WHERE i.tenant_id = v_tenant AND i.status = 'published' AND i.policy_area = 'security'
   ORDER BY i.updated_at DESC NULLS LAST
   LIMIT 1;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status, pinned_at
  ) VALUES (
    v_tenant, v_club, g_debata, v_owner, v_owner,
    'jak-dziala-ten-klub',
    'Jak działa ten klub i czego się tu nie robi',
    E'Trzy rzeczy, których nie widać z interfejsu, a które decydują o tym, jak ten klub czyta się po miesiącu.\n\nPO PIERWSZE: RODZAJ WĄTKU NIE JEST ETYKIETĄ. "Pytanie" pozwala oznaczyć odpowiedź rozstrzygającą i zamyka wątek, gdy padnie. "Stanowisko" zbiera głosy za, przeciw i wstrzymujące się w mapę, którą widać nad dyskusją. "Materiał" wymaga źródła. Wybierając rodzaj, wybierasz cykl życia, nie kolor plakietki.\n\nPO DRUGIE: REAKCJE SĄ DANYMI. "Wnikliwe" i "poparte źródłem" podbijają wątek w rankingu; "zgadzam się" i "nie zgadzam się" NIE podbijają go wcale - i to jest decyzja, którą warto obronić najmocniej, bo ranking premiujący polaryzację produkuje kłótnie, nie wiedzę. "Wymaga wyjaśnienia" jest sygnałem dla autora, a nie oceną.\n\nPO TRZECIE: WĄTEK BEZ ODPOWIEDZI TO PORAŻKA KLUBU, NIE NEUTRALNY STAN. Dlatego sortowanie "bez odpowiedzi" stoi w droplistce obok "najgorętszych" - jeśli masz pięć minut, zacznij tam.',
    'announcement', 'open', now()
  )
  ON CONFLICT (club_id, slug) DO NOTHING;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status
  ) VALUES (
    v_tenant, v_club, g_debata, v_owner, v_owner,
    'zdolnosci-a-deklaracje-luka-wykonawcza',
    'Zdolności a deklaracje: gdzie realnie leży luka wykonawcza regionu',
    E'Deklarowane cele wydatkowe regionu i faktyczne zdolności rozjeżdżają się nie tam, gdzie zwykle się o tym pisze. Problemem nie jest procent PKB - ten w większości państw regionu jest osiągany - tylko struktura wydatku i czas dostawy.\n\nProponuję rozłożyć to na trzy pytania, bo mieszanie ich w jedno daje debatę, w której wszyscy mają rację:\n\n1. Ile z zakontraktowanego sprzętu ma potwierdzony harmonogram dostaw przed 2030, a ile ma opcję?\n2. Które zdolności są realnie regionalne (wspólne zamówienie, wspólna obsługa), a które są krajowe z regionalną etykietą?\n3. Gdzie wąskim gardłem jest przemysł, a gdzie procedura?\n\nInteresuje mnie zwłaszcza trzecie: mam wrażenie, że przypisujemy przemysłowi opóźnienia, które są opóźnieniami decyzyjnymi.',
    'discussion', 'open'
  )
  ON CONFLICT (club_id, slug) DO NOTHING;

  SELECT id INTO v_thread FROM public.club_threads
   WHERE club_id = v_club AND slug = 'zdolnosci-a-deklaracje-luka-wykonawcza';

  IF v_thread IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.club_replies WHERE thread_id = v_thread) THEN
    INSERT INTO public.club_replies (
      tenant_id, club_id, thread_id, parent_id, author_id, posted_by_admin_id, body, status
    ) VALUES (
      v_tenant, v_club, v_thread, NULL, v_owner, v_owner,
      E'Punkt trzeci jest kluczowy i da się go rozstrzygnąć danymi, a nie wrażeniem. Czas między decyzją a podpisaniem umowy jest publiczny w większości państw regionu; czas między podpisaniem a pierwszą dostawą - w części.\n\nGdy zestawić oba, wychodzi, że mediana opóźnienia decyzyjnego jest w kilku przypadkach dłuższa niż deklarowany przez producenta cykl produkcyjny. To nie jest argument przeciw przemysłowi ani za nim - to argument za tym, żeby liczyć osobno.',
      'visible'
    )
    RETURNING id INTO v_reply;

    INSERT INTO public.club_replies (
      tenant_id, club_id, thread_id, parent_id, author_id, posted_by_admin_id, body, status
    ) VALUES (
      v_tenant, v_club, v_thread, v_reply, v_owner, v_owner,
      E'Zgoda co do metody, z jednym zastrzeżeniem: "decyzja" nie jest jednym punktem w czasie. Między decyzją polityczną a decyzją budżetową bywa rok, a to właśnie w tym oknie znika większość różnicy, o której mowa.\n\nProponuję rozbić pierwszy odcinek na dwa i dopiero wtedy porównywać z cyklem produkcyjnym.',
      'visible'
    );
  END IF;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status
  ) VALUES (
    v_tenant, v_club, g_debata, v_owner, v_owner,
    'gdzie-szukac-danych-o-zapasach-amunicji',
    'Gdzie szukać porównywalnych danych o zapasach amunicji w regionie?',
    E'Szukam źródła, które pozwala PORÓWNYWAĆ, a nie tylko czytać. Dane krajowe są publikowane w różnych jednostkach, różnych przedziałach czasowych i z różną definicją zapasu (magazyn, zamówienie, opcja).\n\nCzy ktoś pracował z zestawieniem, które sprowadza to do wspólnej podstawy - choćby kosztem precyzji? Zależy mi na metodzie bardziej niż na konkretnej liczbie.',
    'question', 'open'
  )
  ON CONFLICT (club_id, slug) DO NOTHING;

  SELECT id INTO v_thread FROM public.club_threads
   WHERE club_id = v_club AND slug = 'gdzie-szukac-danych-o-zapasach-amunicji';

  IF v_thread IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.club_replies WHERE thread_id = v_thread) THEN
    INSERT INTO public.club_replies (
      tenant_id, club_id, thread_id, author_id, posted_by_admin_id, body, status
    ) VALUES (
      v_tenant, v_club, v_thread, v_owner, v_owner,
      E'Wspólnej podstawy nie ma i nie sądzę, żeby powstała - definicja zapasu jest w części państw regionu informacją niejawną z definicji, a nie z ostrożności.\n\nDaje się natomiast zrobić coś, co w praktyce wystarcza: porównanie ZMIANY zamiast poziomu. Roczne zamówienia i kontrakty ramowe są jawne prawie wszędzie, a ich dynamika mówi o zdolności odtwarzania zapasu więcej niż sam zapas - który bez tempa odtwarzania jest liczbą bez jednostki czasu.\n\nMetodę tę stosuje kilka ośrodków przy analizie przemysłu obronnego; przy zapasach działa tak samo, bo ograniczenie jest to samo.',
      'visible'
    )
    RETURNING id INTO v_reply;

    UPDATE public.club_threads
       SET resolved_reply_id = v_reply, status = 'resolved'
     WHERE id = v_thread;
  END IF;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status
  ) VALUES (
    v_tenant, v_club, g_stanowis, v_owner, v_owner,
    'wspolne-zamowienia-jako-domyslna-sciezka',
    'Stanowisko klubu: wspólne zamówienia jako ścieżka domyślna, nie wyjątkowa',
    E'PROPONOWANA TEZA: zamówienia obronne powyżej ustalonego progu wartości powinny mieć ścieżkę wspólną jako DOMYŚLNĄ, a zamówienie krajowe wymagać uzasadnienia - odwrotnie niż dziś.\n\nZA: efekt skali przy amunicji i częściach zamiennych jest mierzalny i duży; interoperacyjność przestaje być projektem, a staje się skutkiem ubocznym zakupu; mniejsze państwa regionu zyskują dostęp do cen, których samodzielnie nie osiągną.\n\nPRZECIW: dłuższy czas dojścia do umowy; ryzyko, że wspólny wymóg zostanie napisany pod największego uczestnika; utrata dźwigni przemysłowej tam, gdzie zamówienie krajowe utrzymuje własne zdolności produkcyjne.\n\nGłosowanie nie zamyka dyskusji - stanowisko można zmienić do czasu zamknięcia wątku, a uzasadnienie liczy się bardziej niż sam głos.',
    'position', 'open'
  )
  ON CONFLICT (club_id, slug) DO NOTHING;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status
  ) VALUES (
    v_tenant, v_club, g_biblio, v_owner, v_owner,
    'zestawienie-zrodel-o-przemysle-obronnym-regionu',
    'Zestawienie źródeł: przemysł obronny regionu, dane pierwotne',
    E'Uporządkowana lista źródeł PIERWOTNYCH - rejestry zamówień, sprawozdania spółek, dane celne - z notatką, co każde z nich realnie pokrywa i gdzie się kończy.\n\nCelowo bez opracowań wtórnych: te są łatwe do znalezienia i trudne do zweryfikowania. Jeśli dokładasz pozycję, dopisz jedno zdanie o tym, czego w niej NIE MA - to jest najbardziej użyteczna część takiego zestawienia i zwykle jej brakuje.\n\nWątek jest w Bibliotece, więc obowiązuje premoderacja: pozycja pojawia się po sprawdzeniu przez prowadzącego.',
    'resource', 'open'
  )
  ON CONFLICT (club_id, slug) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_threads
     WHERE club_id = v_club AND slug = 'priorytet-klubu-na-najblizszy-kwartal'
  ) THEN
    INSERT INTO public.polls (
      tenant_id, question_pl, question_en, options, status, created_by
    ) VALUES (
      v_tenant,
      'Który obszar klub powinien wziąć na warsztat w najbliższym kwartale?',
      'Which area should the club take on next quarter?',
      '[{"id":"industry","label_pl":"Przemysł i zdolności produkcyjne","label_en":"Industry and production capacity"},
        {"id":"infrastructure","label_pl":"Infrastruktura krytyczna","label_en":"Critical infrastructure"},
        {"id":"eastern","label_pl":"Wschodnia flanka i rozszerzenie","label_en":"Eastern flank and enlargement"},
        {"id":"cyber","label_pl":"Cyberbezpieczeństwo i odporność","label_en":"Cybersecurity and resilience"}]'::jsonb,
      'open',
      v_owner
    )
    RETURNING id INTO v_poll;

    INSERT INTO public.club_threads (
      tenant_id, club_id, group_id, author_id, posted_by_admin_id,
      slug, title, body, kind, status, poll_id
    ) VALUES (
      v_tenant, v_club, g_debata, v_owner, v_owner,
      'priorytet-klubu-na-najblizszy-kwartal',
      'Priorytet klubu na najbliższy kwartał',
      E'Sondaż porządkowy, nie wiążący. Wynik decyduje o tym, który obszar dostanie własną grupę i cykl spotkań - nie o tym, o czym wolno pisać.\n\nJeśli Twój obszar nie jest na liście, napisz w odpowiedzi: cztery opcje to ograniczenie ankiety, nie klubu.',
      'poll', 'open', v_poll
    );
  END IF;

  IF v_anchor IS NOT NULL THEN
    INSERT INTO public.club_threads (
      tenant_id, club_id, group_id, author_id, posted_by_admin_id,
      slug, title, body, kind, status, anchor_type, anchor_id
    ) VALUES (
      v_tenant, v_club, g_dossier, v_owner, v_owner,
      'czytanie-aktu-co-zmienia-sie-w-praktyce',
      'Czytanie aktu: co zmienia się w praktyce, a co tylko w preambule',
      E'Wątek zakotwiczony w konkretnym akcie z trackera. Interesuje mnie różnica między tym, co akt DEKLARUJE, a tym, co realnie zmienia w procedurze - bo to są dwie różne lektury tego samego dokumentu i mylenie ich jest najczęstszym błędem w komentarzu do legislacji.\n\nProponuję czytać artykułami, nie motywami. Motyw mówi, co autor chciał osiągnąć; artykuł mówi, co po wejściu w życie będzie trzeba zrobić inaczej.\n\nWątek jest przypięty do aktu, więc wróci do nas, gdy zmieni on etap - i wtedy warto sprawdzić, które z dzisiejszych ustaleń się obroniły.',
      'discussion', 'open', 'eu_policy_item', v_anchor
    )
    ON CONFLICT (club_id, slug) DO NOTHING;
  END IF;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, posted_by_admin_id,
    slug, title, body, kind, status
  ) VALUES (
    v_tenant, v_club, g_kuluary, v_owner, v_owner,
    'czego-nie-da-sie-powiedziec-pod-nazwiskiem',
    'Czego nie da się powiedzieć pod nazwiskiem, a trzeba powiedzieć',
    E'Ta grupa działa pod regułą Chatham House: treść wolno cytować, tożsamości nie. Autorstwo nie opuszcza bazy - interfejs pokazuje stabilny pseudonim, osolony osobno w każdym wątku, żeby nie dało się skorelować wypowiedzi między tematami.\n\nTo nie jest zaproszenie do anonimowego komentarza. Moderacja widzi tożsamość zawsze, przez osobne, audytowane wywołanie, którego każde użycie zostaje w dzienniku. Reguła służy temu, żeby dało się powiedzieć rzecz prawdziwą i niewygodną - a nie temu, żeby dało się powiedzieć wszystko.',
    'discussion', 'open'
  )
  ON CONFLICT (club_id, slug) DO NOTHING;

  RAISE NOTICE 'clubs: klub referencyjny gotowy (%).', v_club;
END;
$seed$;