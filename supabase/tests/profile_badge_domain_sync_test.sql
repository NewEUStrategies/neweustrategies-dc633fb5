-- pgTAP: kanoniczne odznaki, RPC admina, izolacja tenantów, event bus
-- i automatyczne nadawanie contributor po progu reputacji.

BEGIN;
SELECT plan(28);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('b6111111-1111-1111-1111-111111111111', 'badge-domain-a', 'Badge Domain A'),
  ('b6222222-2222-2222-2222-222222222222', 'badge-domain-b', 'Badge Domain B');

INSERT INTO auth.users (id, email) VALUES
  ('b6000000-0000-0000-0000-0000000000aa', 'admin-a@badge-domain.test'),
  ('b6000000-0000-0000-0000-0000000000bb', 'member-a@badge-domain.test'),
  ('b6000000-0000-0000-0000-0000000000cc', 'member-b@badge-domain.test'),
  ('b6000000-0000-0000-0000-0000000000dd', 'author-a@badge-domain.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('b6000000-0000-0000-0000-0000000000aa', 'admin-a@badge-domain.test', 'Admin A',
   'b6111111-1111-1111-1111-111111111111', true),
  ('b6000000-0000-0000-0000-0000000000bb', 'member-a@badge-domain.test', 'Member A',
   'b6111111-1111-1111-1111-111111111111', true),
  ('b6000000-0000-0000-0000-0000000000cc', 'member-b@badge-domain.test', 'Member B',
   'b6222222-2222-2222-2222-222222222222', true),
  ('b6000000-0000-0000-0000-0000000000dd', 'author-a@badge-domain.test', 'Author A',
   'b6111111-1111-1111-1111-111111111111', true);

INSERT INTO public.user_roles (tenant_id, user_id, role) VALUES
  ('b6111111-1111-1111-1111-111111111111',
   'b6000000-0000-0000-0000-0000000000aa', 'admin');

INSERT INTO public.qa_sessions (
  id, tenant_id, slug, title_pl, title_en, host_user_id, status
) VALUES (
  'b6333333-3333-3333-3333-333333333333',
  'b6111111-1111-1111-1111-111111111111',
  'badge-reputation', 'Reputacja', 'Reputation',
  'b6000000-0000-0000-0000-0000000000aa', 'closed'
);

-- Admin nadaje każdą odznakę przez RPC bez klientowego tenant_id.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b6000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$ SELECT public.admin_grant_profile_badge(
       'b6000000-0000-0000-0000-0000000000bb', 'staff', 'Zespół programu'
     ) $$,
  'admin nadaje staff przez kontrolowane RPC'
);

RESET ROLE;
SELECT is(
  (SELECT tenant_id FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb' AND badge = 'staff'),
  'b6111111-1111-1111-1111-111111111111'::uuid,
  'RPC wyprowadza tenant z sesji admina'
);
SELECT is(
  (SELECT grant_source FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb' AND badge = 'staff'),
  'manual',
  'ręczne nadanie zapisuje pochodzenie manual'
);
SELECT is(
  (SELECT granted_by FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb' AND badge = 'staff'),
  'b6000000-0000-0000-0000-0000000000aa'::uuid,
  'ręczne nadanie zapisuje aktora administracyjnego'
);
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE tenant_id = 'b6111111-1111-1111-1111-111111111111'
      AND event_type = 'profile_badge.granted.v1'
      AND actor_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND payload ->> 'badge' = 'staff'),
  1,
  'nadanie emituje zdarzenie z odbiorcą jako aktorem'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.domain_events
     WHERE event_type = 'profile_badge.granted.v1'
       AND payload ->> 'badge' = 'staff'
       AND payload ? 'note'
  ),
  'zdarzenie nie ujawnia notatki administracyjnej'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b6000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*)::integer FROM public.admin_list_profile_badges(100)
    WHERE tenant_id = 'b6111111-1111-1111-1111-111111111111'
      AND member_display_name = 'Member A'
      AND badge = 'staff'),
  1,
  'lista admina zwraca wzbogacony rekord wyłącznie aktywnego tenantu'
);
SELECT throws_ok(
  $$ SELECT public.admin_grant_profile_badge(
       'b6000000-0000-0000-0000-0000000000cc', 'verified', NULL
     ) $$,
  'P0002', NULL,
  'admin nie nadaje odznaki użytkownikowi obcego tenantu'
);
SELECT throws_ok(
  $$ SELECT public.admin_grant_profile_badge(
       'b6000000-0000-0000-0000-0000000000bb', 'moderator', NULL
     ) $$,
  '22023', NULL,
  'RPC odrzuca typ spoza kanonicznej czwórki'
);
SELECT throws_ok(
  $$ INSERT INTO public.profile_badges (tenant_id, user_id, badge)
     VALUES ('b6111111-1111-1111-1111-111111111111',
             'b6000000-0000-0000-0000-0000000000bb', 'expert') $$,
  '42501', NULL,
  'nawet admin nie zapisuje bezpośrednio do tabeli'
);
SELECT throws_ok(
  $$ DELETE FROM public.profile_badges
      WHERE tenant_id = 'b6111111-1111-1111-1111-111111111111'
        AND user_id = 'b6000000-0000-0000-0000-0000000000bb' $$,
  '42501', NULL,
  'nawet admin nie usuwa bezpośrednio z tabeli'
);
SELECT ok(
  public.admin_revoke_user_profile_badge(
    'b6000000-0000-0000-0000-0000000000bb', 'staff'
  ),
  'admin odbiera staff przez RPC'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb' AND badge = 'staff'),
  0,
  'odebrana odznaka znika z materializowanego stanu'
);
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'profile_badge.revoked.v1'
      AND actor_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND payload ->> 'badge' = 'staff'),
  1,
  'odebranie emituje profile_badge.revoked.v1'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b6000000-0000-0000-0000-0000000000bb","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$ SELECT * FROM public.admin_list_profile_badges(100) $$,
  '42501', NULL,
  'zwykły użytkownik nie odczytuje listy administracyjnej'
);
SELECT throws_ok(
  $$ SELECT public.admin_grant_profile_badge(
       'b6000000-0000-0000-0000-0000000000bb', 'verified', NULL
     ) $$,
  '42501', NULL,
  'zwykły użytkownik nie nadaje odznak przez RPC'
);

-- 14 odpowiedzianych pytań = 140 punktów, jeszcze bez automatycznej odznaki.
RESET ROLE;
INSERT INTO public.qa_questions (
  tenant_id, session_id, user_id, author_display, body, status, answer_body
)
SELECT 'b6111111-1111-1111-1111-111111111111',
       'b6333333-3333-3333-3333-333333333333',
       'b6000000-0000-0000-0000-0000000000bb',
       'Member A',
       'Pytanie reputacyjne ' || n::text,
       'answered',
       'Odpowiedź'
  FROM generate_series(1, 14) AS n;

SELECT is(
  (SELECT count(*)::integer FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND badge = 'contributor'),
  0,
  '140 punktów nie przekracza progu automatycznego contributor'
);

INSERT INTO public.qa_questions (
  tenant_id, session_id, user_id, author_display, body, status, answer_body
) VALUES (
  'b6111111-1111-1111-1111-111111111111',
  'b6333333-3333-3333-3333-333333333333',
  'b6000000-0000-0000-0000-0000000000bb',
  'Member A', 'Pytanie reputacyjne 15', 'answered', 'Odpowiedź'
);

SELECT is(
  (SELECT count(*)::integer FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND badge = 'contributor'),
  1,
  '150 punktów automatycznie nadaje contributor'
);
SELECT is(
  (SELECT grant_source FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND badge = 'contributor'),
  'reputation',
  'automatyczne nadanie zapisuje pochodzenie reputation'
);
SELECT ok(
  (SELECT granted_by IS NULL FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND badge = 'contributor'),
  'automatyczne nadanie nie fałszuje granted_by'
);
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'profile_badge.granted.v1'
      AND actor_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND payload ->> 'badge' = 'contributor'
      AND payload ->> 'grant_source' = 'reputation'),
  1,
  'automatyczne nadanie również emituje zdarzenie domenowe'
);
SELECT is(
  public.profile_badge_activity_points(
    'b6111111-1111-1111-1111-111111111111',
    'b6000000-0000-0000-0000-0000000000bb',
    now() - interval '90 days'
  ),
  150,
  'kwalifikacja liczy aktywność bez punktów z nowej odznaki'
);
SELECT is(
  (SELECT count(*)::integer FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000bb'
      AND badge IN ('verified', 'expert', 'staff')),
  0,
  'reputacja nie nadaje sygnałów weryfikacji, ekspertyzy ani afiliacji'
);

INSERT INTO public.contributor_submissions (
  tenant_id, user_id, title, pitch, language
) VALUES (
  'b6111111-1111-1111-1111-111111111111',
  'b6000000-0000-0000-0000-0000000000dd',
  'Materiał testowy',
  'To jest wystarczająco długi opis materiału testowego do sprawdzenia źródła odznaki.',
  'pl'
);
UPDATE public.contributor_submissions
   SET status = 'accepted'
 WHERE user_id = 'b6000000-0000-0000-0000-0000000000dd';

SELECT is(
  (SELECT grant_source FROM public.profile_badges
    WHERE user_id = 'b6000000-0000-0000-0000-0000000000dd'
      AND badge = 'contributor'),
  'contributor_submission',
  'akceptacja materiału zapisuje źródło przed emisją zdarzenia'
);
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'profile_badge.granted.v1'
      AND actor_id = 'b6000000-0000-0000-0000-0000000000dd'
      AND payload ->> 'badge' = 'contributor'
      AND payload ->> 'grant_source' = 'contributor_submission'),
  1,
  'event akceptacji materiału niesie ostateczne źródło nadania'
);

SELECT throws_ok(
  $$ INSERT INTO public.profile_badges (tenant_id, user_id, badge, grant_source)
     VALUES ('b6111111-1111-1111-1111-111111111111',
             'b6000000-0000-0000-0000-0000000000cc', 'expert', 'system') $$,
  '23514', NULL,
  'guard tabeli blokuje relację odznaki cross-tenant także dla systemu'
);
SELECT throws_ok(
  $$ INSERT INTO public.profile_badges (tenant_id, user_id, badge, grant_source)
     VALUES ('b6111111-1111-1111-1111-111111111111',
             'b6000000-0000-0000-0000-0000000000bb', 'moderator', 'system') $$,
  '23514', NULL,
  'CHECK bazy dopuszcza dokładnie kanoniczne cztery typy'
);
SELECT is(
  public.reconcile_profile_badge_for_user(
    'b6111111-1111-1111-1111-111111111111',
    'b6000000-0000-0000-0000-0000000000bb'
  ),
  false,
  'ponowne uzgodnienie jest idempotentne'
);

SELECT * FROM finish();
ROLLBACK;
