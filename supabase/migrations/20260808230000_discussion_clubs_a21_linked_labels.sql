-- ============================================================================
-- Kluby dyskusyjne - etap A21: etykiety krawedzi grafu powiazan
--
-- BLAD, KTORY TO NAPRAWIA. Migracja A12 zbudowala `club_linked_item_label` -
-- poprawna, przemyslana funkcje, ktora rozwiazuje identyfikator klubu, watku
-- albo odpowiedzi na czytelna nazwe, respektujac przy tym widocznosc klubu.
-- Nie wpiela jej jednak DO NICZEGO. W jej miejscu stoi blok DO, ktory czyta
-- definicje kanonicznej `linked_item_label` do zmiennej `v_src`, po czym tej
-- zmiennej nigdy nie uzywa i konczy sie RAISE NOTICE:
--
--     SELECT pg_get_functiondef(p.oid) INTO v_src ...
--     IF v_src IS NULL THEN RAISE NOTICE '...'; END IF;
--
-- Nie modyfikuje wiec niczego. Efekt: `linked_item_label` nadal zna osiem
-- typow (post, page, crm_lead, crm_note, comment, profile, message,
-- newsletter_subscriber) i ZADNEGO klubowego, wiec krawedzie dokladane przez
-- szwy z A12 - `club_thread -> belongs_to -> club`, `club_thread -> discusses
-- -> eu_policy_item`, `club_reply -> belongs_to -> club_thread` - renderuja
-- sie w panelu powiazan z pustym miejscem zamiast nazwy. Redaktor widzi
-- krawedz do "czegos", czego nazwy system nie chce mu powiedziec, mimo ze ja
-- zna.
--
-- Wpiecie jest tu przepisaniem kanonicznej funkcji w calosci z trzema nowymi
-- galeziami. Innej drogi nie ma: `CASE` w plpgsql nie ma skladni "dopisz
-- galaz", a delegacja calosci do modulu klubow odwrocilaby zaleznosc (rdzen
-- platformy zaczalby zalezec od modulu, ktory moze nie istniec).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.linked_item_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  CASE p_type
    WHEN 'post' THEN
      SELECT COALESCE(NULLIF(title_pl, ''), NULLIF(title_en, ''), slug)
        INTO v_label FROM public.posts WHERE id = p_id::uuid;
    WHEN 'page' THEN
      SELECT COALESCE(NULLIF(title_pl, ''), NULLIF(title_en, ''), slug)
        INTO v_label FROM public.pages WHERE id = p_id::uuid;
    WHEN 'crm_lead' THEN
      SELECT COALESCE(
               NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
               email
             )
        INTO v_label FROM public.crm_leads WHERE id = p_id::uuid;
    WHEN 'crm_note' THEN
      SELECT left(body, 80) INTO v_label FROM public.crm_lead_notes WHERE id = p_id::uuid;
    WHEN 'comment' THEN
      SELECT left(body, 80) INTO v_label FROM public.comments WHERE id = p_id::uuid;
    WHEN 'profile' THEN
      SELECT COALESCE(NULLIF(display_name, ''), NULLIF(email, ''), slug)
        INTO v_label FROM public.profiles WHERE id = p_id::uuid;
    WHEN 'message' THEN
      v_label := NULL;
    WHEN 'newsletter_subscriber' THEN
      SELECT email INTO v_label FROM public.newsletter_subscribers WHERE id = p_id::uuid;
    -- Kluby: cala reguła widocznosci siedzi w `club_linked_item_label`, a nie
    -- tutaj. Panel powiazan czyta KAZDY is_staff(), a redaktor nie musi byc
    -- czlonkiem klubu - dlatego tytul watku wychodzi wylacznie z klubu
    -- public/members, dla prywatnego zostaje sama nazwa klubu, a dla `secret`
    -- nie ma czego rozwiazywac, bo krawedz w ogole nie powstaje.
    WHEN 'club' THEN
      v_label := public.club_linked_item_label('club', p_id);
    WHEN 'club_thread' THEN
      v_label := public.club_linked_item_label('club_thread', p_id);
    WHEN 'club_reply' THEN
      v_label := public.club_linked_item_label('club_reply', p_id);
    ELSE
      v_label := NULL;
  END CASE;
  RETURN v_label;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.linked_item_label(text, text) IS
  'Etykieta wierzcholka grafu powiazan. Galezie klubowe deleguja do club_linked_item_label, ktore trzyma regule widocznosci - panel czyta kazdy is_staff(), a to inna bramka niz czlonkostwo w klubie.';

REVOKE EXECUTE ON FUNCTION public.linked_item_label(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linked_item_label(text, text) TO service_role;
