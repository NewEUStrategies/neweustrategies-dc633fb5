-- Dane sprzed scalenia. Trzy przypadki, każdy istnieje w produkcji:
--
--   1. KOLIZJA  - `energia` jest i w słowniku, i w hubie redakcyjnym pod tym
--      samym slugiem. To jest ten sam program opisany dwa razy: dokładnie
--      defekt, przez który audyt zgłasza tę pozycję siódme wydanie.
--   2. TYLKO SŁOWNIK - `departament-analiz` (kind = 'department'), bez huba.
--   3. TYLKO HUB - `bezpieczenstwo-europejskie`, z pełną obstawą dzieci.
--
-- Plus drugi najemca (`tenant B`), żeby izolacja była mierzona, a nie zakładana.

INSERT INTO public.tenants (id) VALUES
  ('11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b');
INSERT INTO public.profiles (id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'admin');

INSERT INTO public.categories (id) VALUES ('cccccccc-0000-0000-0000-00000000000c');
INSERT INTO public.posts (id) VALUES ('dddddddd-0000-0000-0000-00000000000d');

-- 1 + 2: słownik
INSERT INTO public.programs (id, tenant_id, slug, name_pl, name_en, kind, description_pl, is_active, sort_order)
VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'energia', 'Energia (słownik)', 'Energy (dictionary)', 'program', 'Opis ze słownika', true, 1),
  ('e0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'departament-analiz', 'Departament analiz', 'Analysis department', 'department', NULL, false, 2),
  ('e0000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002',
   'energia', 'Energia najemcy B', 'Energy tenant B', 'program', NULL, true, 1);

INSERT INTO public.program_members (program_id, user_id, role_pl)
VALUES ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Kierownik'),
       ('e0000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Kierownik B');
INSERT INTO public.post_programs (post_id, program_id)
VALUES ('dddddddd-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-000000000001');

-- 1 + 3: hub redakcyjny
INSERT INTO public.research_programs
  (id, tenant_id, slug, name_pl, name_en, tagline_pl, scope_pl, research_questions,
   icon, accent_color, category_id, contact_email, status, sort_order, created_by)
VALUES
  ('f0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'energia', 'Energia (hub)', 'Energy (hub)', 'Transformacja energetyczna', 'Zakres huba',
   '[{"q_pl":"Pytanie"}]'::jsonb, 'Zap', '#0f172a', 'cccccccc-0000-0000-0000-00000000000c',
   'energia@example.org', 'published', 5, 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('f0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'bezpieczenstwo-europejskie', 'Bezpieczeństwo europejskie', 'European security',
   NULL, NULL, '[]'::jsonb, 'Shield', '#1e3a8a', NULL, NULL, 'published', 6, NULL),
  ('f0000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'szkic-programu', 'Szkic', 'Draft', NULL, NULL, '[]'::jsonb, 'Compass', '#1e3a8a',
   NULL, NULL, 'draft', 7, NULL);

INSERT INTO public.research_program_members (program_id, profile_id, member_role_pl, is_lead)
VALUES ('f0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Badacz', true),
       ('f0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Lider', true);
INSERT INTO public.research_program_projects (program_id, name_pl, name_en)
VALUES ('f0000000-0000-0000-0000-000000000001', 'Projekt A', 'Project A');
INSERT INTO public.research_program_partners (program_id, name)
VALUES ('f0000000-0000-0000-0000-000000000002', 'Partner X');
INSERT INTO public.research_program_items (program_id, item_type, post_id)
VALUES ('f0000000-0000-0000-0000-000000000001', 'flagship_post', 'dddddddd-0000-0000-0000-00000000000d');
