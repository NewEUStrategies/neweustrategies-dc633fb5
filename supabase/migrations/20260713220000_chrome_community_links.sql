-- ============================================================================
-- Nawigacja: podlinkowanie powierzchni Community w PRZECHOWYWANYCH dokumentach
-- buildera chrome (site_settings: header / footer / menu_primary).
--
-- Audyt discoverability: /events, /qa, /polls, /tracker, /contribute i /people
-- istnieją jako strony, ale nie prowadzi do nich żaden link w publicznej
-- nawigacji ("trzeba znać URL" - ten sam błąd co wcześniej z live-blogiem).
-- Kodowe defaulty (chromeDefaults.ts) dostają linki równolegle, ale tenant z
-- już zapisanym dokumentem buildera nigdy defaultów nie zobaczy - stąd ta
-- migracja danych:
--
--   1) Naprawa placeholderów: każdy obiekt {label_pl, href} z href '#'/''
--      i etykietą z mapy poniżej dostaje właściwy adres (dotyczy zarówno
--      widgetów nav-link, jak i linków w kolumnach mega-menu, na dowolnej
--      głębokości dokumentu).
--   2) Stopka: jeżeli dokument stopki nigdzie nie linkuje /events, doklejamy
--      na końcu sekcję "Społeczność/Community" z kompletem linków (stopka to
--      projektowo bezpieczne miejsce na katalog linków; nagłówka celowo nie
--      przebudowujemy automatycznie - to decyzja redakcyjna w adminie).
--
-- Idempotentne: fixer omija ustawione już adresy, doklejka jest strzeżona
-- obecnością '/events' w dokumencie.
-- ============================================================================

-- Rekurencyjny fixer placeholderów (pg_temp: znika po sesji migracji).
CREATE FUNCTION pg_temp.nes_fix_nav_hrefs(j jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_type text := jsonb_typeof(j);
  v_out jsonb;
  v_key text;
  v_val jsonb;
  v_idx integer;
  v_label text;
  v_href text;
  v_new text;
BEGIN
  IF v_type = 'object' THEN
    v_label := j ->> 'label_pl';
    v_href := COALESCE(j ->> 'href', '');
    IF v_label IS NOT NULL AND j ? 'href' AND v_href IN ('#', '') THEN
      v_new := CASE v_label
        WHEN 'Wydarzenia' THEN '/events'
        WHEN 'Tracker UE' THEN '/tracker'
        WHEN 'Tracker legislacyjny UE' THEN '/tracker'
        WHEN 'Sesje Q&A' THEN '/qa'
        WHEN 'Q&A' THEN '/qa'
        WHEN 'Ankiety' THEN '/polls'
        WHEN 'Katalog osób' THEN '/people'
        WHEN 'Zostań kontrybutorem' THEN '/contribute'
        ELSE NULL
      END;
      IF v_new IS NOT NULL THEN
        j := jsonb_set(j, '{href}', to_jsonb(v_new));
      END IF;
    END IF;
    v_out := '{}'::jsonb;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(j) LOOP
      v_out := v_out || jsonb_build_object(v_key, pg_temp.nes_fix_nav_hrefs(v_val));
    END LOOP;
    RETURN v_out;
  ELSIF v_type = 'array' THEN
    v_out := '[]'::jsonb;
    FOR v_idx IN 0 .. jsonb_array_length(j) - 1 LOOP
      v_out := v_out || jsonb_build_array(pg_temp.nes_fix_nav_hrefs(j -> v_idx));
    END LOOP;
    RETURN v_out;
  END IF;
  RETURN j;
END;
$$;

-- 1) Placeholdery we wszystkich dokumentach chrome wszystkich tenantów.
UPDATE public.site_settings ss
   SET value = pg_temp.nes_fix_nav_hrefs(ss.value),
       updated_at = now()
 WHERE ss.key IN ('header', 'footer', 'menu_primary')
   AND ss.value ? 'builder_data'
   AND pg_temp.nes_fix_nav_hrefs(ss.value) IS DISTINCT FROM ss.value;

-- 2) Sekcja "Społeczność" w stopce - tylko gdy stopka nie linkuje /events.
UPDATE public.site_settings ss
   SET value = jsonb_set(
         ss.value,
         '{builder_data,sections}',
         (ss.value -> 'builder_data' -> 'sections') || jsonb_build_array(
           jsonb_build_object(
             'id', 'community-links-s0',
             'kind', 'section',
             'layout', jsonb_build_object('contentWidth', 'boxed', 'width', 1400, 'htmlTag', 'nav'),
             'children', jsonb_build_array(
               jsonb_build_object(
                 'id', 'community-links-s0-c0',
                 'kind', 'column',
                 'span', jsonb_build_object('desktop', 12),
                 'children', jsonb_build_array(
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w0', 'kind', 'widget', 'type', 'heading',
                     'content', jsonb_build_object('text_pl', 'Społeczność', 'text_en', 'Community', 'tag', 'h4')
                   ),
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w1', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Wydarzenia', 'label_en', 'Events', 'href', '/events', 'variant', 'text')
                   ),
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w2', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Sesje Q&A', 'label_en', 'Q&A sessions', 'href', '/qa', 'variant', 'text')
                   ),
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w3', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Ankiety', 'label_en', 'Polls', 'href', '/polls', 'variant', 'text')
                   ),
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w4', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Tracker legislacyjny UE', 'label_en', 'EU policy tracker', 'href', '/tracker', 'variant', 'text')
                   ),
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w5', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Katalog osób', 'label_en', 'People directory', 'href', '/people', 'variant', 'text')
                   ),
                   jsonb_build_object(
                     'id', 'community-links-s0-c0-w6', 'kind', 'widget', 'type', 'nav-link',
                     'content', jsonb_build_object('label_pl', 'Zostań kontrybutorem', 'label_en', 'Become a contributor', 'href', '/contribute', 'variant', 'text')
                   )
                 )
               )
             )
           )
         ),
         false
       ),
       updated_at = now()
 WHERE ss.key = 'footer'
   AND jsonb_typeof(ss.value -> 'builder_data' -> 'sections') = 'array'
   AND ss.value::text NOT LIKE '%/events%';

DROP FUNCTION pg_temp.nes_fix_nav_hrefs(jsonb);
