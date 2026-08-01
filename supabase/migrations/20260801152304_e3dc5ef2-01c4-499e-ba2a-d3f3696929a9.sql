-- Seed legacy WordPress / English-URL redirect rules for the NES tenant.
-- Rules are authored on the canonical (un-prefixed) path; the request matcher
-- re-applies the "/en" prefix, so "/en/about-us" lands on "/en/o-nas".
insert into public.redirects (tenant_id, source_path, target_path, status_code, source, note)
select '07167e87-2e0f-42e8-ac5e-72445a2d4b0a'::uuid, s, t, c, 'migration', n
from (values
  ('/about-us', '/o-nas', 301, 'legacy EN page'),
  ('/about-us/*', '/o-nas', 301, 'legacy EN team subpages'),
  ('/o-nas/*', '/o-nas', 301, 'legacy WP team subpages'),
  ('/contact', '/kontakt', 301, 'legacy EN page'),
  ('/contact-us', '/kontakt', 301, 'legacy EN page'),
  ('/conferences', '/konferencje', 301, 'legacy EN page'),
  ('/analysis', '/analizy', 301, 'legacy EN page'),
  ('/analyses', '/analizy', 301, 'legacy EN page'),
  ('/events', '/wydarzenia', 301, 'legacy EN page'),
  ('/support-us', '/wspieraj-nas', 301, 'legacy EN page'),
  ('/support-us-2', '/wspieraj-nas', 301, 'legacy WP duplicate'),
  ('/donate', '/wspieraj-nas', 301, 'legacy EN page'),
  ('/join-our-newsletter', '/dolacz-do-newslettera', 301, 'legacy EN page'),
  ('/subscribe', '/dolacz-do-newslettera', 301, 'legacy EN page'),
  ('/subscribe/sign-up', '/dolacz-do-newslettera', 301, 'legacy EN page'),
  ('/subksrybuj', '/dolacz-do-newslettera', 301, 'legacy WP typo slug'),
  ('/newsletter-signup', '/dolacz-do-newslettera', 301, 'legacy EN page'),
  ('/advertise', '/reklamuj-sie-u-nas', 301, 'legacy EN page'),
  ('/advertise-with-us', '/reklamuj-sie-u-nas', 301, 'legacy EN page'),
  ('/advertising', '/reklamuj-sie-u-nas', 301, 'legacy EN page'),
  ('/advertising-guidelines', '/wytyczne-dotyczace-reklam', 301, 'legacy EN page'),
  ('/careers', '/zatrudniamy', 301, 'legacy EN page'),
  ('/we-are-hiring', '/zatrudniamy', 301, 'legacy EN page'),
  ('/privacy-policy', '/polityka-prywatnosci', 301, 'legacy EN page'),
  ('/terms', '/regulamin', 301, 'legacy EN page'),
  ('/terms-of-service', '/regulamin', 301, 'legacy EN page'),
  ('/refunds', '/zwroty-i-reklamacje', 301, 'legacy EN page'),
  ('/chatham-house-meetings', '/spotkania-chatham-house', 301, 'legacy EN page'),
  ('/statut', '/o-nas', 301, 'legacy WP page'),
  ('/najnowsze-wpisy', '/blog', 301, 'legacy WP archive'),
  ('/latest', '/blog', 301, 'legacy EN archive'),
  ('/latest-posts', '/blog', 301, 'legacy EN archive'),
  ('/shop', '/pricing', 301, 'legacy WooCommerce shop'),
  ('/cart', '/koszyk', 301, 'legacy WooCommerce cart'),
  ('/checkout', '/zamowienie', 301, 'legacy WooCommerce checkout'),
  ('/purchase-order', '/zamowienie', 301, 'legacy WooCommerce order'),
  ('/my-account', '/moje-konto', 301, 'legacy WooCommerce account'),
  ('/my-bookmarks', '/reading-list', 301, 'legacy EN page'),
  ('/membership-login-2/*', '/membership-login', 301, 'legacy WP duplicate'),
  ('/membership-login/password-reset', '/password-reset', 301, 'legacy WP subpage'),
  ('/membership-login/membership-profile', '/moje-konto', 301, 'legacy WP subpage'),
  ('/membership-join/membership-registration', '/membership-registration', 301, 'legacy WP subpage'),
  ('/kategoria/*', '/category/*', 301, 'legacy WP PL taxonomy base'),
  ('/tagi/*', '/tag/*', 301, 'legacy WP PL tag base'),
  ('/comments/feed', '/rss.xml', 301, 'legacy WP comments feed'),
  ('/wp-admin/*', '/', 410, 'retired WordPress surface'),
  ('/wp-includes/*', '/', 410, 'retired WordPress surface'),
  ('/wp-content/*', '/', 410, 'retired WordPress surface'),
  ('/wp-json/*', '/', 410, 'retired WordPress surface')
) as v(s, t, c, n)
where not exists (
  select 1 from public.redirects r
  where r.tenant_id = '07167e87-2e0f-42e8-ac5e-72445a2d4b0a'::uuid
    and r.source_path = v.s
);