-- pgTAP: pole kodu promocyjnego Stripe jest DOMYŚLNIE wyłączone (audyt PAY-06).
--
-- Weryfikuje migrację 20261013100100_checkout_settings_promo_default_off.sql.
-- Kod wpisany w nakładce operatora omija zakres najemcy i limity kuponów B2B
-- z bazy, a konto Stripe jest wspólne dla instalacji - więc nowy wiersz
-- ustawień (pierwszy zapis panelu, nowy najemca) nie może go włączać sam.
--
-- Testy TS pilnują wyłącznie warstwy aplikacji (`DEFAULT_CHECKOUT_SETTINGS`,
-- domyślne przy awarii odczytu). Ten test pilnuje SKUTKU w zbudowanej bazie:
-- wiersz wstawiony BEZ nazwania kolumny - tak jak wstawia go każdy zapis,
-- który jej nie wymienia - dostaje `false`.
--
-- Istniejących wierszy migracja świadomie nie przepisuje (nagłówek migracji,
-- przegląd PAY-06 0.4) - ich przegląd jest krokiem operatora przy wdrożeniu.
BEGIN;
SELECT plan(3);

SELECT col_default_is(
  'public', 'checkout_settings', 'allow_promotion_codes', 'false',
  'checkout_settings.allow_promotion_codes ma DEFAULT false - pole kodu Stripe włącza się świadomie'
);

SELECT col_not_null(
  'public', 'checkout_settings', 'allow_promotion_codes',
  'checkout_settings.allow_promotion_codes jest NOT NULL - nie ma stanu "nie wiadomo"'
);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c0de0000-0000-4000-8000-0000000000aa', 'promo-default', 'Promo Default');

INSERT INTO public.checkout_settings (tenant_id, invoice_creation)
VALUES ('c0de0000-0000-4000-8000-0000000000aa', true);

SELECT is(
  (SELECT allow_promotion_codes FROM public.checkout_settings
    WHERE tenant_id = 'c0de0000-0000-4000-8000-0000000000aa'),
  false,
  'nowy wiersz ustawień bez nazwanej kolumny NIE włącza pola kodu Stripe'
);

SELECT * FROM finish();
ROLLBACK;
