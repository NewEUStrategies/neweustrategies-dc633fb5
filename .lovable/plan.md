## Kontekst

Wszystkie 4 filary do wdrożenia (kolejność wg priorytetu). Kategorię kanoniczną wybieram na podstawie audytu bazy - żadna z 6 kategorii ekonomicznych nie ma jeszcze przypisanych wpisów (post_count=0), więc merge jest bezpieczny strukturalnie, ale trzeba zachować redirecty 301 na wypadek istniejących linków z zewnątrz.

## Faza 1: Scalenie kategorii (backend)

Obecny stan w `categories`:

- Ekonomia (`ekonomia`) - parent group
  - Finanse i Bankowość, Rynki finansowe (dzieci)
- Gospodarka (`gospodarka`) - parent group
  - Gospodarka światowa (dziecko)
- Finanse (`finanse`) - osobne, sierota

Rekomendacja (kanoniczna = `gospodarka`, bo szersza i naturalna po polsku dla analiz):

```text
Gospodarka (canonical)
├── Finanse i bankowość
├── Rynki finansowe
└── Gospodarka światowa
```

Akcje:

1. Migracja: przepiąć dzieci `Ekonomia` pod `Gospodarka`, przepiąć `Finanse` pod `Gospodarka`, przepiąć wpisy z usuwanych kategorii (jeśli pojawią się przed wdrożeniem).
2. Dodać wpisy do `redirects` (301): `/kategoria/ekonomia` → `/kategoria/gospodarka`, `/kategoria/finanse` → `/kategoria/gospodarka`.
3. Usunąć zduplikowane kategorie po migracji wpisów.
4. Panel admina `/admin/categories`: dodać akcję "Scal w..." (merge tool) dla przyszłych duplikatów - jeden dropdown, przenosi post_categories i tworzy redirect automatycznie.

## Faza 2: Walidator SEO w edytorze wpisów

W metaboxie edytora wpisu (`/admin/posts/:id`):

- Licznik znaków dla `seo_title` (38-68) i `seo_description` (120-160) z paskiem postępu (zielony/żółty/czerwony).
- Walidator struktury nagłówków w treści: dokładnie jeden H1, ostrzeżenie gdy H2 pomijane przed H3.
- Auto-fallback: gdy `seo_title` puste, użyj `title`; gdy `seo_description` puste, wygeneruj z pierwszego akapitu (max 155 znaków).
- Server-side w renderze wpisu (`src/routes/posts.$slug.tsx`) - już jest `head()` z title/description; dodać walidację długości w loaderze i logować ostrzeżenia do `audit_log`.

## Faza 3: Powiązane analizy (2-3 linki wewnętrzne)

- Widget "Powiązane analizy" pod treścią wpisu (już istnieje `related_posts_config` + `related_post_clicks`).
- Algorytm: 3 wpisy z tej samej kategorii + wspólne tagi (weight: kategoria 60%, tagi 40%), sortowane po `published_at DESC` z ostatnich 12 miesięcy.
- W edytorze: sekcja "Sugerowane linki wewnętrzne" pokazująca 5 kandydatów; jednym kliknięciem wstawia link do treści przy pierwszym wystąpieniu tytułu/hasła.
- Fallback gdy brak dopasowań: 3 najnowsze wpisy z tej samej kategorii.

## Faza 4: Google Search Console

- Connector Google Search Console (już dostępny w Lovable) - meta-tag verification przez `head()` w `__root.tsx` (token z `import.meta.env.VITE_GSC_VERIFICATION`).
- Widok `/admin/seo/search-console`: top 25 zapytań miesięcznie (impresje, kliknięcia, CTR, pozycja) - dane z gateway `standard_connectors--call_gateway_connection` (`/webmasters/v3/searchanalytics/query`).
- Widok "Top strony" + "Pages with drops" (spadek pozycji > 5 vs. poprzedni miesiąc) - proste tabele, filtr per data.
- i18n PL/EN dla całego panelu.

## Zakres poza tym planem

- Core Web Vitals: już zbierane w `web_vitals`. Dashboard kwartalny wdrożę w osobnym kroku - dajmy znać jak faza 1-4 przejdą.
- Kompresja obrazów WebP: to zmiana infrastrukturalna (transformer server-side) - osobny plan, wymaga decyzji o loaderze.

## Kolejność wdrożenia

1. Faza 1 (migracja + redirects) - 1 turn
2. Faza 2 (walidator meta) - 1 turn
3. Faza 3 (powiązane + sugestie) - 1 turn
4. Faza 4 (GSC connector + dashboard) - 1 turn, wymaga potwierdzenia i połączenia konta Google przez Ciebie

## Pytanie zamykające

Kanoniczna = `Gospodarka` (moja rekomendacja). Jeśli wolisz `Ekonomia` jako korzeń, powiedz - zamiana trywialna. Ruszam z Fazą 1?
