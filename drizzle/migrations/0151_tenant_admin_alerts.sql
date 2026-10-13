-- ============================================================================
-- ALARM DLA ADMINISTRATOROW NAJEMCY (dzwonek `billing`, zawsze doreczany).
-- events-harness: include
--
-- PO CO
--   Audyt rozliczen (INV-05, INV-19c) pokazal dwa zdarzenia o pieniadzach
--   klienta, ktore organizator widzial WYLACZNIE wtedy, gdy sam otworzyl
--   dziennik: zwrot po wystawieniu faktury (korekta z art. 106j ust. 1 nie
--   powstawala) i zlecenie zwrotu, ktore wyczerpalo proby albo odrzucil je
--   operator. Oba potrzebuja tego samego: sygnalu do KAZDEGO administratora
--   najemcy, ktory nie zginie w tlumie i nie zalezy od preferencji
--   powiadomien (rodzaj `billing` jest always-on, 20260926153300).
--
-- DLACZEGO JEDNA FUNKCJA
--   Kazdy producent alarmu wybieralby odbiorcow po swojemu (raz z redaktorami,
--   raz z super_adminem z obcego najemcy). Tu jest jedna regula, ZNAK W ZNAK
--   ta sama co `notifyTenantAdmins` (src/lib/events/tenantAdminAlert.server.ts,
--   S24): rola `admin` albo `super_admin` W TYM najemcy (`user_roles.tenant_id`)
--   I profil w tym najemcy (`profiles.tenant_id`). Bez redaktorow i autorow -
--   decyzja o korekcie i zwrocie nalezy do administratora (ta sama granica co
--   `assert_event_admin_tenant()`). Tresc niesie wylacznie numery dokumentow
--   i identyfikatory - zadnych danych osobowych nabywcy.
--
-- KONTRAKT
--   * zwraca liczbe administratorow, do ktorych trafil alarm (0 = nikt - np.
--     najemca bez administratora albo deduplikacja 5 minut po href);
--   * NIGDY nie rzuca: alarm wola sie z triggerow i z wystawienia korekty,
--     a awaria dzwonka nie moze wycofac zwrotu ani dokumentu;
--   * href rozroznia sygnaly (deduplikacja `enqueue_notification` dziala po
--     (uzytkownik, rodzaj, href)) - wolajacy podaje adres konkretnego obiektu.
--
-- PLASZCZYZNA: wylacznie z cial SECURITY DEFINER (EXECUTE: service_role).
-- Testy: scripts/events-harness/runtime_test.d/27_invoices_compliance.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._tenant_admins_alert(
  p_tenant uuid,
  p_title_pl text,
  p_title_en text,
  p_body_pl text,
  p_body_en text,
  p_href text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
  v_sent integer := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN 0;
  END IF;
  FOR v_admin IN
    SELECT DISTINCT r.user_id
      FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = p_tenant
     WHERE r.tenant_id = p_tenant
       AND r.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
     ORDER BY r.user_id
  LOOP
    IF public.enqueue_notification(
         v_admin, 'billing', p_title_pl, p_title_en, p_body_pl, p_body_en, p_href, 'credit-card'
       ) IS NOT NULL THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  RETURN v_sent;
EXCEPTION WHEN OTHERS THEN
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public._tenant_admins_alert(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tenant_admins_alert(uuid, text, text, text, text, text)
  TO service_role;
COMMENT ON FUNCTION public._tenant_admins_alert(uuid, text, text, text, text, text) IS
  'Alarm (powiadomienie billing, always-on) do kazdego administratora najemcy; zwraca liczbe doreczen, nigdy nie rzuca. Tylko z cial SECURITY DEFINER.';