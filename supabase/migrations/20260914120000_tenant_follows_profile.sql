-- ============================================================================
-- Najemca stanu konta PODĄŻA za profilem (moduł 12, druga połowa)
-- ============================================================================
--
-- PO CO TA MIGRACJA.
--
-- 20260914090000 naprawiło `push_subscriptions`: najemca subskrypcji przestał
-- być funkcją hosta, a stał się funkcją profilu właściciela, i podąża za nim
-- przy przeniesieniu konta. Ten sam defekt siedzi w BLIŹNIACZEJ tabeli tego
-- samego modułu - `notification_preferences` - tylko w ostrzejszej postaci.
--
-- CO JEST ZEPSUTE. `notification_preferences_pin_identity`
-- (20260712190000:181-205, ostatnie nadpisanie 20260712192421:105) na gałęzi
-- UPDATE robi BEZWARUNKOWO:
--
--     NEW.tenant_id := OLD.tenant_id;
--
-- Zamrożenie miało sens jako obrona przed przepięciem wiersza do obcego
-- najemcy przez klienta. Ale przeniesienie konta jest LEGALNE i realnie
-- zachodzi: `profiles_pin_tenant_id` zwalnia `is_service_role_caller()`, a tą
-- furtką chodzi przyjęcie zaproszenia (src/lib/admin/invitations.functions.ts:
-- 401-406, `supabaseAdmin.from("profiles").upsert({ tenant_id: inv.tenant_id })`).
-- Po takim przeniesieniu wiersz preferencji zostaje w STARYM najemcy, a
-- zamrożenie gwarantuje, że nigdy z niego nie wyjdzie.
--
-- SKUTEK JEST CICHY I TOTALNY. WSZYSTKIE CZTERY polityki tej tabeli wiążą
-- najemcę już w USING (`own prefs select/update/delete`) albo w WITH CHECK
-- (`own prefs insert`), porównując go z `profiles.tenant_id` WOŁAJĄCEGO. Dla
-- przeniesionego użytkownika osierocony wiersz staje się więc:
--   * NIEWIDOCZNY  - ekran ustawień powiadomień pokazuje wartości DOMYŚLNE,
--                    a nie jego prawdziwe preferencje;
--   * NIEZAPISYWALNY - UPDATE zwraca 0 wierszy, BEZ BŁĘDU (USING nie dopuszcza
--                    wiersza, więc nie ma czego odrzucić) - przełącznik w UI
--                    wygląda, jakby zadziałał;
--   * NIEUSUWALNY  - DELETE też zwraca 0, a UNIQUE (user_id) blokuje wstawienie
--                    wiersza zastępczego. Klient nie ma ŻADNEJ drogi naprawy.
--
-- A jednocześnie serwer ten wiersz WIDZI: `enqueue_notification` czyta
-- `notification_preferences` po SAMYM `user_id` (SECURITY DEFINER omija RLS),
-- więc doręczaniem steruje konfiguracja zamrożona w chwili przeniesienia.
-- Licznik należnych digestów liczy takiego użytkownika w STARYM najemcy
-- (20260731210000:515-524, `WHERE np.tenant_id = v_tenant`).
--
-- CO ROBIMY. Najemca stanu konta ma być funkcją PROFILU - wszędzie tam, gdzie
-- wiersz opisuje BIEŻĄCĄ konfigurację konta. Zamrożenie zostaje dla pól
-- tożsamości (`user_id`, `created_at`), bo tam jest na miejscu; najemca
-- przestaje być zamrażany i zaczyna być WYPROWADZANY z profilu, dokładnie jak
-- w `push_subscriptions_pin_tenant`. Do tego jeden wspólny trigger przepinający
-- po przeniesieniu konta, zamiast osobnego na każdą tabelę.
--
-- CZEGO ŚWIADOMIE NIE ROBIMY.
--   * Nie ruszamy zapisów HISTORYCZNYCH. Najemca w dowodzie zgody RODO
--     (`user_consents`, `user_consent_events`), w płatności, w dzienniku
--     zdarzeń czy w WYSŁANYM powiadomieniu jest najemcą Z CHWILI ZDARZENIA i
--     przepisanie go byłoby fałszowaniem zapisu, a nie naprawą.
--   * Nie luzujemy polityk `own prefs *`. Po tej migracji warunek najemcy w
--     USING jest tautologią (wiersz zawsze niesie najemcę profilu wołającego),
--     więc niczego nie blokuje, a luzowanie RLS bez potrzeby to większe ryzyko
--     niż zysk. Zostaje jeden wąski przypadek brzegowy: konto BEZ wiersza w
--     `profiles` - tam pin nie ma skąd wziąć wartości i wiersz pozostaje
--     niewidoczny. Takie konto i tak nie przechodzi przez resztę RLS aplikacji.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) notification_preferences: najemca wyprowadzany z profilu, nie zamrażany
-- ----------------------------------------------------------------------------
-- Różnica wobec stanu zastanego jest JEDNA: `NEW.tenant_id := OLD.tenant_id`
-- ustępuje miejsca temu samemu wyprowadzeniu z profilu, którego gałąź INSERT
-- używała od początku. `user_id` i `created_at` zostają zamrożone - to są pola
-- tożsamości wiersza i nie mają powodu podążać za czymkolwiek.
--
-- Dzięki temu zapis klienta NADAL nie może przepiąć wiersza do obcego najemcy
-- (wartość jest NADPISYWANA wyprowadzeniem, a nie brana z wejścia), ale
-- przeniesienie konta przestaje osierocać preferencje.
CREATE OR REPLACE FUNCTION public.notification_preferences_pin_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id    := OLD.user_id;
    NEW.created_at := OLD.created_at;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_tenant IS NOT NULL THEN
    NEW.tenant_id := v_tenant;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notification_preferences_pin_identity() IS
  'Przypina notification_preferences do tożsamości właściciela: user_id i created_at są niezmienne, a tenant_id jest WYPROWADZANY z profiles.tenant_id (nie zamrażany), żeby przeniesienie konta między najemcami nie osierociło wiersza pod politykami own prefs *, które wiążą najemcę w USING.';

-- ----------------------------------------------------------------------------
-- 2) Jeden trigger przepinający zamiast osobnego na każdą tabelę
-- ----------------------------------------------------------------------------
-- 20260914090000 wprowadziło `tg_profiles_repin_push_subscriptions` dla jednej
-- tabeli. Skoro tabel jest więcej, zastępujemy go jednym miejscem - inaczej
-- każda kolejna tabela w tej klasie oznacza kolejny trigger na `profiles` i
-- rozjazd między nimi jest kwestią czasu.
--
-- Lista jest CELOWO JAWNA (osobne UPDATE, nie pętla po katalogu): dopisanie
-- tabeli ma być świadomą decyzją, poprzedzoną rozstrzygnięciem "stan bieżący
-- czy zapis historyczny". Automat po `information_schema` przepisałby przy
-- okazji dowody zgód i płatności.
CREATE OR REPLACE FUNCTION public.tg_profiles_repin_account_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.push_subscriptions ps
     SET tenant_id = NEW.tenant_id
   WHERE ps.user_id = NEW.id
     AND ps.tenant_id IS DISTINCT FROM NEW.tenant_id;

  UPDATE public.notification_preferences np
     SET tenant_id = NEW.tenant_id
   WHERE np.user_id = NEW.id
     AND np.tenant_id IS DISTINCT FROM NEW.tenant_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_repin_account_tenant() IS
  'Po przeniesieniu konta między najemcami przepina wiersze STANU BIEŻĄCEGO konta (push_subscriptions, notification_preferences), żeby klucze zakresu najemcy nadal zgadzały się z profilem. Zapisy historyczne (zgody, płatności, dzienniki, wysłane powiadomienia) są tu CELOWO pominięte - tam najemca z chwili zdarzenia jest prawdą.';

-- Poprzednik z 20260914090000 (jedna tabela) ustępuje miejsca powyższemu.
DROP TRIGGER IF EXISTS profiles_repin_push_subscriptions ON public.profiles;
DROP FUNCTION IF EXISTS public.tg_profiles_repin_push_subscriptions();

DROP TRIGGER IF EXISTS profiles_repin_account_tenant ON public.profiles;
CREATE TRIGGER profiles_repin_account_tenant
  AFTER UPDATE OF tenant_id ON public.profiles
  FOR EACH ROW
  WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.tg_profiles_repin_account_tenant();

-- ----------------------------------------------------------------------------
-- 3) Backfill: wiersze osierocone przed tą migracją
-- ----------------------------------------------------------------------------
-- Bez tego naprawa działa tylko dla PRZYSZŁYCH przeniesień, a niewidoczne dla
-- swoich właścicieli są dokładnie wiersze JUŻ OSIEROCONE. UPDATE przechodzi
-- przez trigger z punktu 1, który liczy tę samą wartość z tego samego profilu.
UPDATE public.notification_preferences np
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = np.user_id
   AND p.tenant_id IS NOT NULL
   AND np.tenant_id IS DISTINCT FROM p.tenant_id;
