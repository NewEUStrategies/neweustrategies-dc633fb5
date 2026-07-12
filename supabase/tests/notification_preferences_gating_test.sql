-- pgTAP: każdy przełącznik preferencji powiadomień REALNIE tłumi swój rodzaj.
--
-- Blokuje regresję "martwych przełączników": enqueue_notification (wspólny
-- producent wołany przez wszystkie triggery: message/comment/follow/
-- subscription/content/system) musi pominąć wstawienie, gdy odbiorca wyłączył
-- dany rodzaj, a 'security' ma docierać ZAWSZE (przełącznik always-on).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(13);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-1111111100ff', 'prefs-tenant', 'Prefs Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000ff', 'prefs@test.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000ff', 'prefs@test.test', 'Prefs User',
   'c1111111-1111-1111-1111-1111111100ff');

INSERT INTO public.notification_preferences (
  user_id, tenant_id,
  enabled_message, enabled_comment, enabled_follow, enabled_subscription,
  enabled_content, enabled_system, enabled_security
) VALUES (
  'c0000000-0000-0000-0000-0000000000ff', 'c1111111-1111-1111-1111-1111111100ff',
  true, true, true, true, true, true, true
);

-- Helper wołany jako właściciel (enqueue_notification jest SECURITY DEFINER,
-- bierze odbiorcę wprost i czyta jego tenant z profilu).
-- Każde wywołanie ma UNIKALNY href, by ominąć 5-min dedup po (user,kind,href).

-- Dla każdego rodzaju: włączony -> wstawia; wyłączony -> pomija (NULL).
-- message
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'message',
    't', 't', 'b', 'b', '/m-on', 'i'),
  NULL, 'message włączony: powiadomienie wstawione');
UPDATE public.notification_preferences SET enabled_message = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'message',
    't', 't', 'b', 'b', '/m-off', 'i'),
  NULL, 'message wyłączony: powiadomienie pominięte');

-- comment
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'comment',
    't', 't', 'b', 'b', '/c-on', 'i'),
  NULL, 'comment włączony: wstawione');
UPDATE public.notification_preferences SET enabled_comment = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'comment',
    't', 't', 'b', 'b', '/c-off', 'i'),
  NULL, 'comment wyłączony: pominięte');

-- follow
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'follow',
    't', 't', 'b', 'b', '/f-on', 'i'),
  NULL, 'follow włączony: wstawione');
UPDATE public.notification_preferences SET enabled_follow = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'follow',
    't', 't', 'b', 'b', '/f-off', 'i'),
  NULL, 'follow wyłączony: pominięte');

-- subscription
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'subscription',
    't', 't', 'b', 'b', '/s-on', 'i'),
  NULL, 'subscription włączony: wstawione');
UPDATE public.notification_preferences SET enabled_subscription = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'subscription',
    't', 't', 'b', 'b', '/s-off', 'i'),
  NULL, 'subscription wyłączony: pominięte');

-- content
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'content',
    't', 't', 'b', 'b', '/ct-on', 'i'),
  NULL, 'content włączony: wstawione');
UPDATE public.notification_preferences SET enabled_content = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'content',
    't', 't', 'b', 'b', '/ct-off', 'i'),
  NULL, 'content wyłączony: pominięte');

-- system
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'system',
    't', 't', 'b', 'b', '/sys-on', 'i'),
  NULL, 'system włączony: wstawione');
UPDATE public.notification_preferences SET enabled_system = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'system',
    't', 't', 'b', 'b', '/sys-off', 'i'),
  NULL, 'system wyłączony: pominięte');

-- security: always-on - dociera nawet przy wyłączonym enabled_security.
UPDATE public.notification_preferences SET enabled_security = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'security',
    't', 't', 'b', 'b', '/sec', 'i'),
  NULL, 'security dociera ZAWSZE, nawet przy wyłączonym przełączniku');

SELECT * FROM finish();
ROLLBACK;
