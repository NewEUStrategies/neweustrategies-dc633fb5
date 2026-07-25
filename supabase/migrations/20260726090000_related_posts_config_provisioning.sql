-- Provisioning wiersza `related_posts_config` dla KAŻDEGO tenanta.
--
-- PRZYCZYNA ŹRÓDŁOWA (błąd klasy "cichy zapis"):
-- `related_posts_config` jest tabelą-singletonem per tenant (`tenant_id` jako
-- PRIMARY KEY). Jej wiersz był zasiewany JEDNORAZOWO w migracji z 24.06
-- (`INSERT ... SELECT id FROM tenants`), bez żadnego provisioningu dla tenantów
-- zakładanych PÓŹNIEJ. Panel administracyjny zapisywał konfigurację przez
-- `UPDATE ... WHERE tenant_id <> '000…0'` - a UPDATE, który nie dopasował
-- ŻADNEGO wiersza, jest dla PostgREST pełnym sukcesem (HTTP 204). Efekt: nowy
-- tenant otwierał /admin/related-posts, klikał „Zapisz", dostawał toast
-- „Zapisano" i nic się nie zapisywało. Był to jedyny wyjątek wśród 13
-- tabel-singletonów - pozostałe 12 używa `upsert`.
--
-- Ta migracja domyka warstwę bazodanową (klient przechodzi na `upsert`):
--   1. BACKFILL - wiersze dla tenantów, które ich dziś nie mają;
--   2. TRIGGER  - każdy nowy tenant dostaje wiersz w momencie utworzenia, więc
--      „brak wiersza" przestaje być stanem osiągalnym;
--   3. FUNKCJA `seed_related_posts_config(uuid)` - idempotentny punkt zaczepienia
--      dla backfillu, triggera i testów pgTAP (ten sam wzorzec, co
--      `seed_membership_tiers`).
--
-- IZOLACJA TENANTÓW: funkcja jest SECURITY DEFINER, ale NIE czyta tenanta z
-- nagłówka (`public_tenant_id()`) ani nie autoryzuje po roli - przyjmuje
-- `tenant_id` jawnym argumentem i wstawia wyłącznie wiersz tego tenanta. Nie ma
-- tu więc możliwości skrzyżowania płaszczyzny nagłówkowej z rolą (inwariant
-- pilnowany przez scripts/check-sql-tenant-scope.ts).

-- 1) Idempotentny zasiew jednego tenanta.
CREATE OR REPLACE FUNCTION public.seed_related_posts_config(_tenant_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.related_posts_config (tenant_id)
  VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.seed_related_posts_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_related_posts_config(uuid) TO service_role;

-- 2) Backfill istniejących tenantów (w tym tych utworzonych po 24.06).
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_related_posts_config(v_t);
  END LOOP;
END $$;

-- 3) Provisioning nowych tenantów.
CREATE OR REPLACE FUNCTION public.tg_tenants_seed_related_posts_config()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_related_posts_config(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_seed_related_posts_config ON public.tenants;
CREATE TRIGGER tenants_seed_related_posts_config
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenants_seed_related_posts_config();

-- 4) Twardy inwariant kolumny: `tenant_id` nie może być NULL.
--    Kolumna jest PRIMARY KEY, więc NOT NULL obowiązuje już dziś; jawne
--    ustawienie DEFAULT-u zostaje, bo klient wysyła `tenant_id` explicite, a
--    default chroni ścieżki serwerowe (SQL editor, seed) przed pominięciem go.
ALTER TABLE public.related_posts_config
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

-- 5) Zapis z panelu: `upsert` = INSERT ... ON CONFLICT, więc rola musi mieć
--    INSERT (miała) ORAZ polityka musi przepuścić INSERT (`FOR ALL` ją
--    obejmuje). Poniższy komentarz jest kontraktem dla przyszłych zmian.
COMMENT ON TABLE public.related_posts_config IS
  'Singleton konfiguracji silnika rekomendacji per tenant. Zapis WYŁĄCZNIE przez '
  'upsert z jawnym tenant_id (onConflict: tenant_id) - UPDATE bez dopasowania '
  'jest dla PostgREST sukcesem i maskuje brak wiersza. Wiersz jest zasiewany '
  'triggerem tenants_seed_related_posts_config przy tworzeniu tenanta.';

-- 6) DETERMINISTYCZNY ODCZYT PUBLICZNY (izolacja tenantów).
--
-- PROBLEM: polityki SELECT sumują się (OR). Na tabeli są dwie:
--   A) publiczna:  tenant_id = public_tenant_id()          -- tenant PRZEGLĄDANY
--   B) edytorska:  tenant_id = current_tenant_id() AND rola -- tenant DOMOWY
-- Zalogowany admin/edytor tenanta A, który przegląda domenę tenanta B, spełnia
-- OBIE - więc `select(...).limit(1)` widział DWA wiersze i wybierał dowolny.
-- Publiczna strona tenanta B mogła się wtedy wyrenderować konfiguracją tenanta A.
--
-- ROZWIĄZANIE: jedna funkcja zwracająca WYŁĄCZNIE wiersz tenanta przeglądanego.
-- Używa tylko `public_tenant_id()` - żadnego `has_role`/`is_staff`, więc nie łamie
-- inwariantu tenant-scope (scripts/check-sql-tenant-scope.ts) i nie da się przez
-- nią podejrzeć cudzej konfiguracji przez podrobiony nagłówek: nagłówek wskazuje
-- tenanta, którego dane i tak są publiczne.
CREATE OR REPLACE FUNCTION public.get_related_posts_config()
RETURNS SETOF public.related_posts_config
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.related_posts_config
  WHERE tenant_id = public.public_tenant_id()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_related_posts_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_related_posts_config() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_related_posts_config() IS
  'Konfiguracja rekomendacji tenanta PRZEGLĄDANEGO (public_tenant_id()). '
  'Kanoniczny odczyt publiczny - zastępuje select().limit(1), który dla '
  'zalogowanego edytora obcego tenanta mógł zwrócić wiersz JEGO tenanta.';
