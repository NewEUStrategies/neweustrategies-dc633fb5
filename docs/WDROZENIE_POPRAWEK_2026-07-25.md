# Wdrożenie poprawek - 7 defektów (2026-07-25)

> Zakres: rekomendacje sieciowe (kontrakt klient↔DB), inwersja `applied_cents`,
> martwy grant warstwy z kuponu, ciche gubienie treści EN w imporcie WP, podcast
> RSS niespełniający wymogów Apple Podcasts Connect, bifurkacja uploadu
> (wektor SVG-XSS), utajony defekt enuma `tenant_admin`.

## Zasady wdrożenia (spełnione)

- **Bez `any` / `as any`** - nowy kod nie wprowadza żadnego. Tam, gdzie kolumny
  z nowych migracji nie są jeszcze w wygenerowanym `types.ts`, użyto
  `as unknown as` / `as never` z komentarzem „do usunięcia przy regeneracji" -
  identycznie jak istniejący kod (`publicQueries.ts`).
- **i18n PL/EN** - wszystkie nowe teksty w obu językach
  (`network.recommendations.*`, `adminPodcasts.settings.apple.*`, komunikaty
  importu). Dodano test parytetu kluczy dla bundla `i18n-admin-podcasts`
  (dotąd nie miał żadnego), bundle `i18n-network` pilnuje istniejący test.
- **tenant_id / izolacja** - poprawki wzmacniają izolację: `list_recommendations`
  skalowane tenantem właściciela profilu (nie wołającego), `write_recommendation`
  odrzuca parę autor/odbiorca z różnych tenantów, `apply_b2b_coupon_effects`
  skalowane tenantem wiersza realizacji (nie nagłówkiem hosta).
- **Atomic design** - nowe pola panelu podcastu jako komponenty w feature-folderze
  (`components/admin/podcasts/`), z lokalnym atomem `Field`; zgodnie z
  `docs/ARCHITECTURE.md` (§1) nie wprowadzamy globalnej hierarchii atomic.
- **„-" zamiast „—"** - nowe teksty i komentarze używają dywizu; wyczyszczono też
  3 istniejące pauzy w `admin.coupons.redemptions.tsx`.
- **Responsywność / grid** - nowe formularze: `grid-cols-1 sm:grid-cols-2`,
  tabela realizacji w kontenerze `overflow-x-auto`.

---

## 1. Rekomendacje sieciowe - trzy niezgodności kontraktu klient↔DB

`supabase/migrations/20260725090000_fix_recommendations_client_db_contract.sql`,
`src/lib/network/useRecommendations.ts`, `src/components/network/RecommendationsSection.tsx`,
`src/lib/i18n-network.ts`, `supabase/tests/recommendations_contract_test.sql`

| #   | Niezgodność                                                                                          | Skutek                                                                                                                                                                                | Naprawa                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | status: klient filtrował `visible`, baza zapisuje `published`                                        | zatwierdzona rekomendacja NIGDY nie trafiała na profil („brak publicznych rekomendacji" na zawsze)                                                                                    | klient używa słownika bazy (`pending\|published\|declined\|hidden`)                                                                                           |
| 2   | akcja: klient wysyłał `approve` / `delete`, baza rozpoznawała `publish` / `decline` / `hide`         | **cichy no-op z toastem sukcesu** - `CASE` spadał do `ELSE status`, UPDATE trafiał we wiersz (brak `NOT FOUND`), więc UI mówił „Opublikowano" / „Usunięto" przy zerowej zmianie stanu | RPC przyjmuje oba warianty czasownika i **fail-closed** podnosi `invalid_action` dla nieznanego; `delete` realizuje prawdziwy `DELETE` (dotąd nieobsługiwany) |
| 3   | relacja: dialog zbierał wolny tekst 2..120 znaków, kolumna ma domknięty `CHECK IN (colleague…other)` | każdy realny wpis kończył się naruszeniem `CHECK` (surowy błąd 23514 w toaście)                                                                                                       | `<Select>` z 7 opcjami ze słownika + walidacja w RPC z kodem `invalid_relationship`; słownik wystawiony jako `recommendation_relationships()`                 |

Dodatkowo (ta sama funkcja, ten sam przepływ):

- `list_recommendations` skalowane tenantem **właściciela profilu** - dotąd
  tenantem wołającego, więc dla anonima `_caller_tenant()` = NULL → zero
  wierszy na publicznym profilu; RPC dostało też `GRANT` dla `anon`,
- egzekwowana udokumentowana **prywatność moderacji**: autor nie widzi odmowy
  (`hidden` / `declined` prezentują mu się jako `pending`) - dotąd komentarz w
  kodzie to obiecywał, a SQL zwracał prawdziwy status,
- kody błędów RPC tłumaczone na komunikaty PL/EN (`errors.*`) - użytkownik nie
  widzi już surowego `invalid_relationship`.

## 2. Inwersja `applied_cents` - kolumny Przychód ↔ Rabat

`supabase/migrations/20260725090200_fix_coupon_analytics_applied_cents_inversion.sql`,
`src/lib/billing/couponMoney.ts` (+ testy), `src/routes/admin.coupons.{analytics,redemptions}.tsx`

`b2b_coupon_redemptions.applied_cents` to **rabat**, nie kwota zapłacona
(pisarzem jest `redeem_b2b_coupon(_applied_cents := couponDiscountCents)`; tak
też czyta to `monetization_dashboard`). `b2b_coupons_analytics` i panel realizacji
czytały odwrotnie, więc kupon o najwyższym rabacie wyglądał na najbardziej
dochodowy, a obie liczby rozjeżdżały się w PRZECIWNYCH kierunkach.

- SQL: `revenue_cents = SUM(original - applied)`, `discount_cents_total = SUM(applied)`,
- niezmiennik utrwalony w `COMMENT ON COLUMN` obu kolumn,
- obliczenia klienta w jednym, przetestowanym module (`couponMoney.ts`) -
  6 testów, w tym regresja inwersji i zacisk do zera przy niespójnych danych,
- tabela realizacji rozdziela teraz „Przed rabatem / Rabat / Zapłacono",
- nagłówki CSV nazywają kolumny po znaczeniu (`discount;paid`) - poprzedni
  `applied` utrwalał inwersję w każdym wyeksportowanym arkuszu.

## 3. Martwy grant warstwy z kuponu

`supabase/migrations/20260725090300_apply_coupon_effects_after_payment.sql`,
`src/lib/billing/couponEffects.server.ts`, `webhooks.stripe.ts`, `checkout.functions.ts`,
`supabase/tests/coupon_effects_after_payment_test.sql`

`b2b_coupons.grants_tier_key` jest edytowalne w panelu i pokazywane w kolumnie
„Plan", a `redeem_b2b_coupon_with_effects` je realizuje - ale **nikt jej nie
wołał** (checkout woła `redeem_b2b_coupon`). Kupon „nadaj warstwę" nie nadawał
niczego.

Przepięcie checkoutu na wariant `_with_effects` byłoby gorsze niż brak funkcji:
nadawał warstwę przy **składaniu** zamówienia (`status='pending'`), czyli przed
płatnością - kod kuponu stawał się darmowym tokenem premium (ryzyko P2 z audytu
2026-07-23). Rozdzieliliśmy więc:

1. **rezerwacja** użycia kuponu (limity, atomowo) - zostaje w `redeem_b2b_coupon`,
2. **efekty** (warstwa członkowska + notatka/score CRM) - `apply_b2b_coupon_effects`,
   fail-closed na `payment_orders.status = 'paid'`, wołane ze ścieżki księgującej
   płatność (webhook Stripe + finalizacja trybu mock).

Idempotencja: zatrzask `b2b_coupon_redemptions.effects_applied_at` ustawiany
atomowym `UPDATE … WHERE effects_applied_at IS NULL RETURNING`, więc ponowna
dostawa webhooka nie dubluje nadania ani punktów CRM (i samonaprawia po
nieudanej próbie). Nadanie ma pochodzenie `source='coupon'` + `source_coupon_id`
(dotąd wpisywało mylące `'manual'`). Zły `tier_key` (FK do `membership_tiers`)
nie wywraca księgowania - efekt jest pomijany i raportowany. Panel realizacji
pokazuje teraz „nadano / czeka na płatność". `redeem_b2b_coupon_with_effects`
zostało wycofane (`REVOKE` dla `anon`/`authenticated` + `COMMENT`).

## 4. Ciche gubienie treści EN w imporcie WP

`src/lib/wp-import/buildPage.ts` (+ 8 testów), `src/lib/wp-import.functions.ts`,
`WxrUploadPanel.tsx`, `WordPressImportDialog.tsx`

- ścieżka WXR konwertowała `content_en_html`, a potem **wyrzucała** wynik
  (`void convEn`) - komentarz obok obiecywał zapis do `content_en`, którego nikt
  nie robił; cała gałąź EN żyła dodatkowo wewnątrz `if (mirror)`, więc przy
  wyłączonym ściąganiu mediów EN nie był nawet konwertowany,
- ścieżka konektora WP.com brała z pary EN wyłącznie tytuł i zapowiedź,
- oba importy raportowały czyste „zaimportowano".

Obie ścieżki idą teraz jedną drogą (`buildPageFromHtmlPair`): konwersja PL i EN
zawsze, mirror mediów z **obu** wersji w jednym przebiegu (media z treści EN
przestają być hotlinkiem do starego WordPressa), zapis do `content_pl` /
`content_en` i jawny `enBody` (`none` / `persisted` / `empty`) w wyniku importu,
pokazywany w obu panelach. `builder_data` pozostaje kanonicznym UKŁADEM strony
(jeden na stronę); `content_pl` / `content_en` to warstwa językowa czytana przez
silnik `html`, skan użycia mediów, kontrolę linków i przepływ tłumaczeń.

## 5. Podcast RSS - wymogi Apple Podcasts Connect

`supabase/migrations/20260725090500_podcast_apple_connect_metadata.sql`,
`src/lib/seo/{podcastRss,applePodcastCategories,podcastChannelMeta,podcastFeedReadiness}.ts`,
oba route'y RSS, `components/admin/podcasts/*`, `admin.podcasts.tsx`

Kanał emitował z listy tagów wymaganych przez Apple tylko `<title>`,
`<description>` i `<language>`, więc **nie przechodził walidacji**:

| Tag                                                                  | Stan wyjściowy                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `<itunes:category>`                                                  | brak całkowicie (twardy wymóg)                                         |
| `<itunes:explicit>`                                                  | brak całkowicie (twardy wymóg)                                         |
| `<itunes:image>`                                                     | pole opcjonalne w builderze, a `/podcast/rss.xml` nie podawał go WCALE |
| `<itunes:owner>`                                                     | brak e-maila = brak możliwości weryfikacji własności kanału            |
| `<itunes:author>`                                                    | brak nazwy wydawcy w katalogu                                          |
| `<itunes:episodeType>`, `<itunes:explicit>`, `<itunes:title>` (item) | brak                                                                   |

- schema: `itunes_*` na `podcast_settings` (kanał sieciowy) i `podcast_shows`
  (nadpisania per program), `explicit` + `episode_type` na `podcasts`,
- builder jest **fail-safe**: kategoria i `explicit` mają wartości domyślne, a
  okładka kanału degraduje do pierwszej okładki odcinka - feed nigdy nie
  wychodzi bez tagu, którego Apple wymaga,
- kategorie z zamkniętej taksonomii Apple (`applePodcastCategories.ts`);
  nieznana degraduje do domyślnej, obca podkategoria jest pomijana (Apple
  odrzuca parę `Government` + `Politics`),
- dziedziczenie PROGRAM → KANAŁ → DOMYŚLNE MARKI w jednej czystej funkcji
  (`podcastChannelMeta.ts`, 7 testów), w tym reguła „podkategoria zawsze z tej
  samej warstwy co kategoria",
- panel `/admin/podcasts` dostał formularz tych pól i **kartę gotowości**
  (`podcastFeedReadiness`) - braki blokujące i zalecane, PL/EN, widoczne ZANIM
  redakcja zgłosi kanał do Apple,
- edytor odcinka: `<itunes:episodeType>` (full / trailer / bonus) + `explicit`.

## 6. Bifurkacja uploadu - wektor SVG-XSS

`src/lib/media/upload.ts` (+ 15 testów),
`supabase/migrations/20260725090400_harden_media_bucket_mime_allowlist.sql`,
`useMediaMutations.ts`, `MediaPickerDialog.tsx`, `builder/…/ImageSlot.tsx`

Upload jest dwufazowy: przeglądarka wrzuca bajty PROSTO do publicznego bucketu,
a serwer waliduje je dopiero przy **rejestracji** wiersza w `media`. Trzy
implementacje tego przepływu rozjechały się dokładnie w obsłudze **odrzuconej
rejestracji**:

- `builder/ImageSlot` - kasował obiekt ze storage (poprawnie),
- `MediaManager` - tylko `toastError`,
- `MediaPickerDialog` - tylko `toastError`.

W dwóch ostatnich odrzucony plik **zostawał żywy** w publicznym buckecie, pod
znanym wgrywającemu URL-em. Bucket nie miał `allowed_mime_types`, a polityka
storage bramkuje tylko rolę - więc każdy członek redakcji (także `author`) mógł
wgrać `image/svg+xml` z osadzonym `<script>`, zobaczyć czerwony toast
„Disallowed mime type" i mimo to dostać serwowany z bajtów adres = stored XSS.
Serwerowa allowlista blokowała WIERSZ w tabeli, nie plik. Builder dodatkowo
oferował SVG w `accept` i we własnej liście MIME.

Naprawa w dwóch warstwach:

1. jedna ścieżka klienta (`uploadAndRegisterMedia`): walidacja przed uploadem z
   tej samej listy → upload → rejestracja → **obowiązkowe** sprzątnięcie
   obiektu przy odrzuceniu; `accept` to jawna lista zamiast `image/*` (wildcard
   obejmował `image/svg+xml`),
2. storage jako autorytet: bucket `media` dostał `allowed_mime_types` (bez SVG)
   i `file_size_limit`, więc ręcznie skrojony klient też nie ma wektora.

## 7. Utajony defekt enuma `tenant_admin`

`supabase/migrations/20260725090100_fix_metering_preview_app_role_enum.sql`,
`scripts/check-sql-app-role-literals.ts`, `scripts/lib/sqlMigrations.ts`, `ci.yml`

`has_role(uuid, app_role)` ma jeden podpis, a enum `app_role` to
`admin | editor | author | user | super_admin` - wartości `'tenant_admin'`
nigdy w nim nie było. Ciała funkcji plpgsql nie są parsowane przy
`CREATE FUNCTION`, więc literal przeżył 9 wystąpień w repo (5 jako realne
wywołanie w kolejnych definicjach `metering_impact_preview`) i wywalał się
dopiero w RUNTIME jako `22P02 invalid input value for enum app_role`.

**Dlaczego utajony:** trzecia gałąź `OR` jest osiągalna wyłącznie dla wołającego,
który nie jest ani `admin`, ani `editor` - a więc nigdy w testach dymnych na
koncie administratora. Zwykły członek dostawał 500 zamiast czystego
`insufficient_privilege` (42501), co dodatkowo maskowało powód odmowy.

- bramka wyrównana do kanonicznej trójki z funkcji siostrzanej
  (`admin | editor | super_admin`), z **jawnym** `::app_role`,
- nowa bramka CI `check:sql-app-role` porównuje każdy literal `has_role(...)`
  z enumem odtworzonym z migracji (weryfikowana na wstrzykniętej regresji).

### Efekt uboczny: naprawiona bramka `check:sql-tenant-scope`

Wspólny parser migracji (`scripts/lib/sqlMigrations.ts`, używany przez obie
bramki) usuwa teraz komentarze SQL **przed** analizą. Bez tego bramka
tenant-scope raportowała 4 fałszywe naruszenia we WŁASNYCH notatkach
naprawczych (`-- FIX: był public_tenant_id()` w `20260724100000`) - czyli była
**czerwona na mainie**. Po zmianie: `✓ 432 funkcji zbadanych`.

---

## Weryfikacja

| Krok                             | Wynik                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `tsc --noEmit`                   | ✓ czysto                                                                                  |
| `vitest run`                     | ✓ 2667 pass / 0 fail / 50 skipped (316 plików)                                            |
| `eslint` na plikach z tej zmiany | ✓ czysto                                                                                  |
| `check:sql-tenant-scope`         | ✓ (naprawiona - patrz §7)                                                                 |
| `check:sql-app-role`             | ✓ (nowa bramka)                                                                           |
| `check:chunks`                   | ✓ graf acykliczny                                                                         |
| `bun run build`                  | ✓                                                                                         |
| pgTAP                            | 2 nowe pliki (`recommendations_contract`, `coupon_effects_after_payment`) - weryfikuje CI |

**Nowe testy:** 39 przypadków w 5 plikach (`couponMoney`, `media/upload`,
`wp-import/buildPage`, `seo/podcastChannelMeta`, `i18nAdminPodcasts`) +
rozszerzone `seo/podcastRss` (26) i asercje efektów kuponu w teście webhooka.

### Bramki czerwone JUŻ NA MAINIE (nie w zakresie tej zmiany)

Zweryfikowane przez `git stash` + przebieg na czystym HEAD:

- `check:bundle` - `public 1546.0 KB > 1475 KB`, `largest chunk 379.0 KB > 350 KB`,
  `overall 2616.6 KB > 2518 KB`. Ta zmiana dodaje +2.1 KB public / +6.0 KB
  overall (teksty PL+EN, `<Select>` w dialogu rekomendacji, komponenty panelu
  podcastu). Ocena gotowości feedu została wydzielona z buildera RSS
  (`podcastFeedReadiness.ts`), żeby panel nie wciągał generatora XML.
  Nadrobienie ~71 KB zaległości budżetowej to osobna praca.
- `test:coverage` - progi per-ścieżka dla `widget-view/**` (94.03% vs 94.5%)
  i `webhooks.stripe.ts` (88.81% vs 90%). Ta zmiana podnosi pokrycie webhooka
  do 88.88% (nowa asercja efektów kuponu), nie obniża go.
- `eslint` - 296 błędów `prettier/prettier` w plikach nietkniętych tą zmianą
  (dryf formatowania na mainie). Pliki z tej zmiany są czyste.
