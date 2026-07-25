# Audyt funkcjonalny modułów - niedociągnięcia i luki (2026-07-25)

**Data:** 2026-07-25 · **HEAD:** `5dbb216` · **Gałąź:** `claude/modules-functional-audit-zes8yo`

Audyt szuka **wyłącznie defektów**: rzeczy, które nie działają, działają cicho źle albo nie
skalują się. Nie jest to ocena punktowa - tę rolę pełnią `OCENA_FUNKCJI_2026-07-24.md` (werdykt
8,0/10) i `OCENA_MODULOW_2026-07-20.md`. Dokument uwzględnia stan **po**
`WDROZENIE_POPRAWEK_2026-07-25.md` (7 defektów zamkniętych), więc nie powtarza tamtych ustaleń.

## Metodyka - co realnie uruchomiono

Każde ustalenie ma dowód w postaci ścieżki `plik:linia`, wyniku uruchomionego narzędzia albo
odtworzonego zachowania. Zakres mechanicznej weryfikacji:

| Sprawdzenie                                                               | Pokrycie                                            | Wynik                             |
| ------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------- |
| Kontrakt nazw RPC klient↔baza                                             | 161 nazw z `.rpc()` vs 430 funkcji w 466 migracjach | **czysto**                        |
| Kontrakt **argumentów** RPC (ze świadomością przeciążeń i komentarzy SQL) | 184 wywołania                                       | **czysto**                        |
| Kontrakt tabel/widoków                                                    | 177 referencji `.from()` vs 205 definicji           | **czysto**                        |
| Zapis tabel-singletonów per tenant                                        | 13 tabel z `tenant_id PRIMARY KEY`                  | **1 defekt** (§3)                 |
| Ścieżki zapisu bez kontroli błędu                                         | 772 wywołania `insert/update/upsert/delete`         | **82 bez kontroli** (§1, §2, §6)  |
| Sprzątanie kanałów Realtime                                               | wszystkie pliki z `.channel()`                      | **czysto** (0 wycieków)           |
| Sanityzacja SSR (`ssrSanitizeHtml`)                                       | 7 wektorów XSS                                      | **czysto** (7/7 blokuje)          |
| Typecheck (`tsc --noEmit`)                                                | całość                                              | **czysto**                        |
| Testy (`vitest run`) na zapiętym lockfile                                 | 329 plików / 2888 testów                            | **zielone** (2834 pass, 50 skip)  |
| `knip` (martwy kod)                                                       | całość                                              | **5 plików + 214 eksportów** (§8) |
| Znaczniki długu (`TODO/FIXME/HACK`)                                       | całość `src/`                                       | 2 wystąpienia - brak długu        |

Uwaga metodyczna: pierwsze przebiegi testów pokazywały 121 padających plików - to **artefakt
środowiska** (prywatny rejestr GAR z `bun.lock` jest nieosiągalny publicznie, część zależności
się nie zainstalowała). Po odtworzeniu instalacji zgodnie ze sztuczką z `.github/workflows/ci.yml`
(przepięcie hosta w lockfile) suite jest zielony. **Repozytorium nie ma czerwonych testów.**

## Tabela zbiorcza ustaleń

Status wdrożenia: **§1 i §2 są zamknięte** - patrz
`WDROZENIE_KRYTYCZNE_MONETYZACJA_2026-07-25.md`. Opisy poniżej zachowano w formie
diagnozy (stan przed poprawką), bo dokumentują mechanizm defektu.

| #   | Moduł                              | Ustalenie                                                                                             | Waga          |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Monetyzacja - checkout/subskrypcje | `grantEntitlement` gubi błędy zapisu - opłacony klient bez dostępu, bez retry ✅ **wdrożone**         | **Krytyczna** |
| 2   | Monetyzacja - webhook Stripe       | 12 zapisów bez kontroli błędu; anulowanie i refund mogą cicho nie zadziałać ✅ **wdrożone**           | **Krytyczna** |
| 3   | Wpisy - powiązane wpisy            | Zapis konfiguracji to cichy no-op dla tenantów bez zasianego wiersza                                  | **Wysoka**    |
| 4   | Wpisy - spis treści / kotwice      | 4 implementacje slugify, 3 zachowania - polskie `ł` daje inne id per silnik                           | **Średnia**   |
| 5   | Silniki treści / platforma         | Zakres `^3.4.7` dopuszcza `dompurify@3.4.12`, pod którym sanityzacja w przeglądarce przestaje działać | **Średnia**   |
| 6   | Przekrojowo (14 modułów)           | 82 zapisy `await` bez kontroli błędu - systemowa klasa cichej porażki                                 | **Średnia**   |
| 7   | CRM, profil, header                | 54 lokalne helpery `t(pl, en)` poza bundlami i18n - niewidoczne dla testów parytetu                   | **Niska**     |
| 8   | Platforma                          | `knip` skonfigurowany, ale nie egzekwowany w CI: 5 martwych plików, 214 martwych eksportów            | **Niska**     |
| 9   | Admin - autorzy, listy             | Agregacja po stronie klienta i niepaginowane listy w 23 trasach admina                                | **Niska**     |

---

# 1. KRYTYCZNA - `grantEntitlement` gubi błędy zapisu

**Plik:** `src/lib/billing/grant.server.ts:59`, `:64`, `:77`
**Moduł:** 13 (monetyzacja - cennik/checkout/subskrypcje/billing)

Funkcja jest opisana we własnym komentarzu jako **jedyny punkt zamiany płatności na dostęp**:

> `This is what has_content_access() reads, so it is the single point that turns payment into access.`

Wszystkie trzy zapisy w tym punkcie ignorują kanał `error`:

```ts
// grant.server.ts:59 - odświeżenie subskrypcji
await supabaseAdmin.from("user_subscriptions")
  .update({ status: "active", current_period_end: periodEnd, canceled_at: null })
  .eq("id", existing.id);                                    // brak { error }

// grant.server.ts:64 - nowa subskrypcja
await supabaseAdmin.from("user_subscriptions").insert({ ... });   // brak { error }

// grant.server.ts:77 - zakup jednorazowy
await supabaseAdmin.from("user_purchases").upsert({ ... });       // brak { error }
```

Klient `supabaseAdmin` (`src/integrations/supabase/client.server.ts:22`) nie ma `throwOnError`,
a `supabase-js` **nie rzuca** przy błędzie zapisu - zwraca go w `error`. Sygnatura
`grantEntitlement(): Promise<void>` nie propaguje więc niczego dalej.

## Dlaczego to jest krytyczne, a nie kosmetyczne

Ten defekt **unieważnia udokumentowane zabezpieczenie retry** webhooka. Komentarz w
`src/routes/api/public/webhooks.stripe.ts:184-188` opisuje dokładnie ten scenariusz jako
naprawiony bug:

> „Gating the _grant_ on «did this delivery flip the status to paid» was a bug: if
> `grantEntitlement` **threw** after the status was already flipped, the Stripe retry found the
> order paid, matched zero rows, and skipped the grant forever - **customer charged, no access**."

Cała architektura „grant-before-flip" zakłada, że **nieudany grant rzuca wyjątek** - wtedy
handler wpada w `catch` (`webhooks.stripe.ts:536`), zwraca 500 i Stripe ponawia dostawę.
Ponieważ grant nie może rzucić przy błędzie bazy, przepływ jest taki:

1. Klient płaci, Stripe wysyła `checkout.session.completed`.
2. `grantEntitlement` próbuje wstawić `user_subscriptions` - zapis pada (naruszenie ograniczenia,
   błąd przejściowy, brak uprawnienia po zmianie polityki). Błąd trafia do `error`, nikt go nie czyta.
3. Funkcja wraca normalnie. Handler flipuje zamówienie na `paid` (`:287`).
4. Handler zwraca **200** (`:541`). **Stripe nigdy nie ponowi.**
5. Stan końcowy: zamówienie `paid`, brak wiersza uprawnienia, `has_content_access()` = false.
   **Klient obciążony, bez dostępu, bez śladu błędu w logach.**

Kontrast w tym samym pliku pokazuje, że dyscyplina istnieje, ale nie została zastosowana do
zapisów: odczyt zamówienia tuż wyżej **jest** sprawdzany - `webhooks.stripe.ts:198`
(`if (orderErr) throw orderErr;`).

Ta sama ścieżka obsługuje tryb mock (`src/lib/billing/checkout.functions.ts:367`), więc luka
dotyczy obu trybów płatności.

**Rekomendacja:** destrukturyzować `{ error }` przy każdym z trzech zapisów i rzucać
(`if (error) throw new Error(error.message)`). To jednocześnie przywraca zamierzone zachowanie
retry - bez żadnej zmiany w webhooku. Warto dodać test jednostkowy, w którym zamockowany
klient zwraca `error` i asercja sprawdza, że `grantEntitlement` rzuca.

---

# 2. KRYTYCZNA - webhook Stripe: 12 zapisów bez kontroli błędu

**Plik:** `src/routes/api/public/webhooks.stripe.ts` - linie `287`, `314`, `422`, `430`, `449`,
`463`, `470`, `474`, `486`, `498`, `522`, `524`
**Moduł:** 13/14 (monetyzacja)

Ten sam mechanizm co §1, ale w samym handlerze. Handler zwraca 200 (`:541`) dla wszystkiego, co
nie rzuciło, więc **każdy nieudany zapis jest trwały i niewidoczny** - Stripe uznaje zdarzenie
za dostarczone i nie ponawia. Trzy najkosztowniejsze przypadki:

| Linia          | Zdarzenie                                                            | Skutek cichej porażki                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:287`         | `checkout.session.completed` → `payment_orders.status = 'paid'`      | Zamówienie zostaje nieopłacone. `applyCouponEffectsForOrder` (`:298`) jest udokumentowane jako **fail-closed wymagające `status='paid'`**, więc efekty kuponu B2B (warstwa członkowska + CRM) są pomijane - przy zerowym śladzie błędu. |
| `:422`, `:430` | `customer.subscription.updated` / `.deleted` → `status='canceled'`   | Anulowana subskrypcja zostaje `active` **na zawsze**. Uprawnienie nie jest odbierane - wyciek dostępu po rezygnacji.                                                                                                                    |
| `:449`, `:463` | `charge.refunded` → `donations`/`payment_orders` `status='refunded'` | Klient po zwrocie pieniędzy **zachowuje dostęp**; rejestr dokumentów pokazuje nieprawdę.                                                                                                                                                |

**Rekomendacja:** ujednolicić na jednym wzorcu - albo `{ error }` + `throw` przy każdym zapisie
(wtedy Stripe ponawia, co jest właściwym zachowaniem dla zdarzeń pieniężnych), albo lokalny
helper `mustWrite(promise, ctx)`, który rzuca z kontekstem zdarzenia. Wariant drugi ma tę zaletę,
że da się nim objąć wszystkie 12 miejsc bez rozdmuchania handlera.

---

# 3. WYSOKA - zapis „Powiązanych wpisów" to cichy no-op

**Plik:** `src/routes/admin.related-posts.tsx:44-56`
**Moduł:** 1 (wpisy - doświadczenie czytelnika / silnik rekomendacji)

```ts
const save = useMutation({
  mutationFn: async (next: RelatedPostsConfig) => {
    const { error } = await supabase
      .from("related_posts_config")
      .update(next)
      .neq("tenant_id", "00000000-0000-0000-0000-000000000000");   // „dopasuj wszystko"
    if (error) throw error;
  },
  onSuccess: () => { ...; toast.success(t("admin.saved", ...)); },
});
```

Dwa problemy w jednym zapytaniu:

1. **`UPDATE` zamiast `UPSERT` na tabeli, której wiersz może nie istnieć.** Wiersz jest zasiewany
   **jednorazowo**, w migracji `20260624192250_2896cad7...sql:49`:
   ```sql
   INSERT INTO public.related_posts_config (tenant_id)
   SELECT id FROM public.tenants ON CONFLICT (tenant_id) DO NOTHING;
   ```
   Nie ma triggera ani funkcji provisioningu, która dosypywałaby wiersz nowym tenantom
   (potwierdzone: brak `provision_tenant`/`create_tenant`/`seed_tenant` w 466 migracjach, brak
   innego `INSERT` do tej tabeli). **Każdy tenant utworzony po 2026-06-24 nie ma wiersza.**
2. **Brak weryfikacji liczby dotkniętych wierszy.** `UPDATE` bez dopasowania to dla PostgREST
   sukces (204, `error === null`), więc `onSuccess` odpala i użytkownik widzi **„Zapisano"** przy
   zerowej zmianie stanu. Konfiguracja silnika rekomendacji - w tym wagi v2, IDF i `min_score` -
   nie zapisuje się nigdy, a UI twierdzi, że tak.

To dokładnie ta klasa defektu („cichy no-op z toastem sukcesu"), którą `WDROZENIE_POPRAWEK_2026-07-25.md`
§1 zamknął dla rekomendacji sieciowych. Tutaj pozostała otwarta.

**Kontekst - to jedyny wyjątek w kodzie.** Przegląd wszystkich 13 tabel z `tenant_id PRIMARY KEY`
pokazuje, że **każda inna** używa poprawnego `.upsert()`:

| Tabela                                                                                                                                                                                 | Zapis                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `post_layout_settings`, `podcast_settings`, `contact_form_settings`, `expert_layout_settings`, `metering_settings`, `checkout_settings`, `gift_article_settings`, `retention_settings` | `.upsert()` ✔                                                                                            |
| `newsletter_settings`                                                                                                                                                                  | `.update()`, ale z jawnym `if (existing) … else insert` (`src/hooks/useNewsletterSettings.ts:157-167`) ✔ |
| **`related_posts_config`**                                                                                                                                                             | **`.update()` + `.neq()`, bez fallbacku** ✘                                                              |

**Rekomendacja:** `.upsert(next, { onConflict: "tenant_id" })` bez filtra `.neq` - `tenant_id`
ma `DEFAULT public.current_tenant_id()`, a polityka RLS `WITH CHECK` i tak zamyka zapis do
własnego tenanta, więc klient nie musi (i zgodnie z doktryną `tenant_id` nie powinien) podawać
go jawnie. Dodatkowo warto dorzucić `.select()` i sprawdzić, że wróciła dokładnie jedna
kolumna - to zamyka całą klasę „no-op z sukcesem".

---

# 4. ŚREDNIA - cztery implementacje slugify nagłówków, trzy różne zachowania

**Pliki:** `src/lib/manualToc.ts:35`, `src/lib/toc/settings.ts:112`,
`src/components/blocks/renderer/data.ts:108`, `src/components/share/FloatingShareBar.tsx:132`
**Moduł:** 1 (wpisy - spis treści, kotwice, share bar)

| Implementacja                                           | Mapa PL (`ł`,`ø`,`đ`,`ß`) | Ucięcie      | Fallback dla pustego |
| ------------------------------------------------------- | ------------------------- | ------------ | -------------------- |
| `manualToc.slugifyHeading` (ścieżka richtext/HTML)      | **tak**                   | 80 znaków    | `"section"`          |
| `toc/settings.slugifyHeading` (spis treści dla bloków)  | nie                       | brak         | brak (`""`)          |
| `blocks/renderer/data.slugify` (id nagłówków w blokach) | nie                       | brak         | brak (`""`)          |
| `FloatingShareBar.slugifyHeading` (lokalna)             | nie                       | **64 znaki** | `"section"`          |

Odtworzone wyjścia dla tych samych nagłówków:

```
"Wyzwania małych firm"
  manualToc (richtext) : wyzwania-malych-firm
  renderer bloków      : wyzwania-ma-ych-firm      ← inne id
"Łączność energetyczna"
  manualToc (richtext) : lacznosc-energetyczna
  renderer bloków      : acznosc-energetyczna      ← inne id
"Ł"
  manualToc (richtext) : l
  renderer bloków      : ""                        ← pusty id, niepoprawna kotwica
```

Przyczyna: `ł` i `Ł` **nie rozkładają się** pod `NFKD` (to osobne znaki, nie litera + diakryt),
więc `[^a-z0-9]+` zamienia je w `-`. Tylko `manualToc` ma jawną mapę `PL_MAP`.

**Konsekwencje funkcjonalne** (a nie tylko stylistyczne):

- **Kotwice nie są stabilne przy migracji między silnikami.** Platforma wspiera konwersję
  wpisów w obie strony (bloki ↔ richtext, `docs/ARCHITECTURE.md` §2). Ten sam nagłówek dostaje
  po konwersji inne `id`, więc **wcześniej udostępnione linki głębokie przestają działać** -
  cicho, bo przeglądarka po prostu nie skacze.
- **Pusty `id`** dla nagłówka złożonego wyłącznie ze znaków poza ASCII (`id=""` to niepoprawna
  kotwica) w dwóch z czterech implementacji.
- **Zdegradowane slugi w języku podstawowym platformy.** `wyzwania-ma-ych-firm` jest widoczne
  w URL-u i indeksowane.

Ryzyko jest **ograniczone** przez to, że `FloatingShareBar` przypisuje brakujące `id` do DOM
(`:207`, `if (!h.id) h.id = id;`) i preferuje istniejące `h.id`, więc w obrębie jednego
renderu linki są spójne. Rozjazd ujawnia się między silnikami i po migracji treści.

**Rekomendacja:** wydzielić jedną `slugifyHeading` (wariant z `PL_MAP` z `manualToc` - jest
najbardziej poprawny i ma już test w `src/lib/__tests__/manualToc.test.ts:6`), zaimportować ją
w pozostałych trzech miejscach i dodać test parytetu, który przepuszcza ten sam zestaw
nagłówków przez wszystkie ścieżki renderowania.

---

# 5. ŚREDNIA - zakres `^3.4.7` dopuszcza `dompurify`, pod którym sanityzacja nie działa

**Pliki:** `package.json:76`, `src/lib/sanitize.ts:26-32`
**Moduł:** 3 (silniki treści) / 20 (platforma)

`sanitizeHtml()` ma dwa silniki: `ssrSanitizeHtml` na serwerze i **DOMPurify w przeglądarce**.
Sprawdzenie obu:

- `ssrSanitizeHtml` - **czysto**, blokuje wszystkie 7 przetestowanych wektorów
  (`<script>`, `<SCRIPT>`, `onerror`, `<iframe src=javascript:>`, `href=javascript:`, `<svg onload>`).
- DOMPurify - zachowanie **zależy od wersji w zakresie `^3.4.7`**. Odtworzone w tym samym
  środowisku (jsdom, `window` obecny, `isSupported === true`), dla wejścia
  `"<p>a</p><script>x=1</script>"`:

| Wersja                         | Wynik `DOMPurify.sanitize(...)` | Ocena                                           |
| ------------------------------ | ------------------------------- | ----------------------------------------------- |
| `3.4.7` (zapięta w `bun.lock`) | `"<p>a</p>"`                    | poprawnie - `<script>` usunięty                 |
| `3.4.12` (w zakresie `^3.4.7`) | `"a<script>x=1</script>"`       | **`<script>` przechodzi**, a `<p>` jest usuwany |

Wynik dla `3.4.12` nie zmienia się nawet przy jawnym `FORBID_TAGS: ["script"]`, co wskazuje na
niezgodność sposobu użycia API w tym kodzie z nowszym wydaniem (a nie na lukę w samym
DOMPurify). Efekt dla aplikacji jest jednak jednoznaczny: **`sanitizeHtml()` w przeglądarce
przestaje sanityzować**, a to funkcja opisana jako „use everywhere we render values coming out
of `builder_data` JSONB or any other user-controlled field".

**Co już chroni:** własny test repozytorium
(`src/components/admin/builder/ui/organisms/widget-view/__tests__/widgetBehavior.test.tsx:124`,
„strips dangerous markup but keeps safe content") **wyłapuje ten regres** - to on zapalił się
na czerwono i doprowadził do tego ustalenia. CI jest dodatkowo bezpieczne, bo krok „Repoint
lockfile to the public npm registry" (`.github/workflows/ci.yml:37-40`) przepina tylko **host**,
zachowując zapięte wersje i sumy integralności.

**Realna ekspozycja:** każda instalacja poza CI oraz każdy bump zależności - `bun update`,
PR od bota, nowy współpracownik bez lockfile. Projekt już traktuje dryf zależności jako ryzyko
do zarządzania (`bunfig.toml`: `minimumReleaseAge = 86400` plus jawna lista wyjątków), więc
domknięcie tego jest spójne z jego własną polityką.

**Rekomendacja:** zapiąć sanityzator dokładnie (`"dompurify": "3.4.7"`, bez karety) i dopisać
`--frozen-lockfile` do kroków `bun install` w trzech workflow - wtedy rozjazd `package.json`
↔ `bun.lock` przestaje się rozwiązywać po cichu, a zaczyna wywalać build. Test sanityzacji
zostawić - jest jedynym miejscem, które ten regres wykrywa.

---

# 6. ŚREDNIA - systemowa klasa cichej porażki zapisu

Poza §1 i §2 wzorzec „`await` zapisu bez odczytu `error`" powtarza się w **82 z 772** wywołań
`insert/update/upsert/delete`. Rozkład (pliki z ≥3 wystąpieniami):

| Plik                                                       | Liczba | Moduł                        |
| ---------------------------------------------------------- | ------ | ---------------------------- |
| `src/routes/api/public/webhooks.stripe.ts`                 | 12     | 13/14 - monetyzacja (§2)     |
| `src/lib/admin/invitations.functions.ts`                   | 8      | 19 - użytkownicy/zaproszenia |
| `src/lib/content.functions.ts`                             | 7      | 2 - edytor wpisów            |
| `src/lib/crm-companies.functions.ts`                       | 5      | 18 - CRM                     |
| `src/lib/crm.functions.ts`                                 | 5      | 18 - CRM                     |
| `src/lib/newsletter-campaigns.functions.ts`                | 4      | 11 - newsletter              |
| `src/lib/server/linkCheck.server.ts`                       | 3      | 8 - SEO/monitor linków       |
| `src/lib/billing/grant.server.ts`                          | 3      | 13 - monetyzacja (§1)        |
| `src/lib/builder/templates.ts`, `popups.ts`                | 3 + 3  | 3 - builder                  |
| `src/components/profile/sections/ProfileExtraSections.tsx` | 3      | 15 - profil                  |

Dla odróżnienia: **odczyty** publiczne bez `error` (205 z 1074) są w większości **zamierzone** -
repozytorium świadomie degraduje publiczne ścieżki do stanu pustego zamiast błędu
(`docs/OCENA_SSR_2026-07-24.md`). Zapisy to inna sprawa: cicha porażka zapisu oznacza, że
operator albo użytkownik dostaje potwierdzenie operacji, która się nie wykonała.

**Rekomendacja:** nie traktować tego jako 82 osobnych poprawek. Najtaniej domyka się to regułą
lintera - `no-floating-supabase-write`: wywołanie kończące się na `insert|update|upsert|delete`
musi mieć destrukturyzowany `error` albo `.throwOnError()`. Zaczynając od ścieżek pieniężnych
i zaproszeń (`invitations.functions.ts` - nieudane zaproszenie bez sygnału to użytkownik, który
nigdy nie dostanie dostępu).

---

# 7. NISKA - 54 lokalne helpery `t(pl, en)` poza warstwą i18n

**Moduł:** 18 (CRM) głównie, dalej 15 (profil), chrome mobilny

54 wystąpienia w 17+ plikach definiują lokalnie:

```ts
const t = (pl: string, en: string): string => (lang === "pl" ? pl : en);
```

Przykłady: `src/components/admin/crm/NewCompanyDialog.tsx:62`, `CompanyFilterChips.tsx`,
`LeadMembershipCard.tsx`, `MeteringUsageCard.tsx`, `CompanyColumnManager.tsx`,
`ProfileSyncCard.tsx`, `admin/pricing/ConfluenceReconciliationCard.tsx`,
`admin/newsletter/builder/PropertiesPanel.tsx`, `components/FollowButton.tsx`,
`header/mobile/MobileTopTools.tsx`.

Funkcjonalnie te teksty **są** dwujęzyczne - to nie jest bug widoczny dla użytkownika. Koszt
jest inny i realny:

- teksty są **niewidoczne dla testów parytetu PL/EN** (`src/lib/__tests__/i18n-key-parity.test.ts`
  i 11 testów bundlowych sprawdzają tylko `locale/{pl,en}.ts` oraz overlaye `lib/i18n-*.ts`),
  więc brak tłumaczenia w jednym języku nie zapala się nigdzie,
- nie da się ich nadpisać ani zlokalizować per tenant, w przeciwieństwie do 100 z 122 tras
  admina, które używają bundli,
- ta sama etykieta bywa zdublowana w kilku plikach i rozjeżdża się przy zmianie.

**Rekomendacja:** przenieść do overlayów `lib/i18n-crm.ts` / `i18n-admin-*.ts` (wzorzec jest już
w repozytorium 56 razy) i objąć testem parytetu. To domyka dług, który
`OCENA_FUNKCJI_2026-07-24.md` odnotował jako „i18n inline" w modułach 15/16/18.

---

# 8. NISKA - martwy kod: `knip` skonfigurowany, ale nie egzekwowany

`knip.json` istnieje, ale **żaden z trzech workflow nie uruchamia `knip`** - CI gate'uje
typecheck, testy z progami pokrycia, budżet bundla, acykliczność grafu chunków, lint i dwa
inwarianty SQL, ale nie martwy kod. Efekt (`bunx knip`):

| Kategoria                      | Liczba  |
| ------------------------------ | ------- |
| Nieużywane pliki               | **5**   |
| Nieużywane eksporty            | **214** |
| Nieużywane wyeksportowane typy | **171** |
| Zdublowane eksporty            | **7**   |

Nieużywane pliki: `scripts/generate-geo-maps.ts`, `scripts/migrate-cv-to-private.ts`,
`src/components/ui/alert.tsx`, `src/components/ui/download-button.tsx`,
`src/lib/i18n-download-button.ts`. Ostatnie dwa są parą - komponent i jego bundle i18n -
czyli funkcja wycofana bez sprzątnięcia. Zdublowane eksporty to głównie aliasy w
`src/lib/lucide-shim.tsx` (`ChevronDown|ChevronDownIcon`, `Undo|Undo2`), gdzie dwie nazwy tego
samego ikonu pozwalają na niespójne importy.

**Rekomendacja:** dodać `bunx knip` jako krok CI (najpierw ostrzegawczo, potem blokująco po
sprzątnięciu bieżącego zaległego stanu). Bez gate'u ta lista rośnie - repozytorium ma już
własne bespoke gate'y, więc wzorzec jest ustalony.

---

# 9. NISKA - agregacja po stronie klienta i niepaginowane listy admina

**Moduł:** 4/19 (panele admina)

**a) Zliczanie w JS zamiast w SQL.** `src/routes/admin.authors.tsx:75-84` ściąga **po jednym
wierszu na każdy opublikowany wpis**, żeby policzyć wpisy per autor:

```ts
const { data: postRows } = await supabase
  .from("posts")
  .select("author_id")
  .in("author_id", ids)
  .eq("status", "published")
  .is("deleted_at", null);
for (const row of postRows ?? []) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
```

Przy 50 tys. wpisów to 50 tys. wierszy przez sieć do przeglądarki dla liczby, którą baza policzy
jednym `GROUP BY`. Dodatkowo, jeśli API ma ustawiony limit `db-max-rows` (typowa konfiguracja
hostowanego PostgRESTa - w tym repozytorium nie jest jawnie ustawiony, więc obowiązuje wartość
środowiska), odpowiedź zostaje ucięta bez błędu i **liczniki cicho zaniżają się** zamiast
zgłosić problem. Warto to potwierdzić na środowisku docelowym.

**b) Niepaginowane listy.** 23 trasy admina wykonują `select()` listowy bez `.range()`/`.limit()`.
Część jest bezpieczna (słowniki: `categories`, `membership_tiers`, `tags`), ale rosnące bez
ograniczeń są: `admin.podcasts.tsx` (`media`, `podcasts` - 6 zapytań),
`admin.research-programs.tsx` (`profiles` - 7), `admin.programs.tsx` (`profiles`),
`admin.tracker.tsx` (`eu_policy_links`, `eu_policy_positions`), `admin.live-blog.tsx`
(`live_blog_entries`), `admin.users.index.tsx` (`user_subscriptions`), `admin.ads.tsx`
(`ad_placements`, `ad_slots`).

**Kontekst pozytywny:** dwie najważniejsze listy - `admin.posts.tsx` i `admin.pages.tsx` -
**mają już paginację serwerową** (`.range(from, to)`, `admin.posts.tsx:112-155`), więc dług
zgłoszony w `OCENA_MODULOW_2026-07-20.md` §1.2 („listy adminowe bez paginacji serwerowej") jest
w rdzeniu **zamknięty**. Zostały panele obrzeżne.

**Rekomendacja:** (a) zamienić na RPC z `GROUP BY` albo widok zmaterializowany z licznikami;
(b) dołożyć `.range()` + kontrolkę stron w panelach, których tabele rosną z treścią i liczbą
użytkowników - wzorzec jest już gotowy w `admin.posts.tsx`.

---

# Co sprawdzono i jest czyste (wyniki negatywne)

Warte zapisania, bo to najtwardsza część obrazu - te klasy defektów **nie występują**:

- **Kontrakt klient↔baza jest szczelny.** Wszystkie 161 nazw RPC z `.rpc()` mają definicję w
  migracjach; wszystkie 177 referencji `.from()` mają tabelę/widok. Po uwzględnieniu przeciążeń
  funkcji i komentarzy SQL w listach parametrów **wszystkie 184 wywołania RPC mają zgodne nazwy
  argumentów** - klasa defektu z `WDROZENIE_POPRAWEK_2026-07-25.md` §1 nie ma już innych
  wystąpień.
- **Brak wycieków Realtime.** Każdy plik tworzący `.channel()` sprząta przez `removeChannel`
  lub `.unsubscribe()` - zero wyjątków. To nietypowo dobry wynik dla kodu z czatem, powiadomieniami
  i presence współedycji.
- **Sanityzacja SSR trzyma.** `ssrSanitizeHtml` blokuje wszystkie testowane wektory XSS.
- **Zapis tabel-singletonów** jest poprawny w 12 z 13 przypadków (§3 to jedyny wyjątek).
- **Typecheck bez błędów**, suite testów zielony na zapiętym lockfile (2834 przechodzące),
  brak długu w postaci `TODO`/`FIXME` (2 wystąpienia w całym `src/`).

# Priorytetyzacja

| Kolejność | Ustalenie                           | Uzasadnienie                                                                                                                                                                                                                                                     |
| --------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | §1 + §2 (monetyzacja)               | Jedyne ustalenia z bezpośrednim skutkiem finansowym: obciążony klient bez dostępu, brak odbierania uprawnień po refundzie. Poprawka jest mała i lokalna (destrukturyzacja `error` + `throw`), a przywraca zabezpieczenie, które kod już opisuje jako działające. |
| 2         | §3 (powiązane wpisy)                | Cały panel nie zapisuje dla części tenantów, a UI potwierdza sukces. Poprawka to jedna linia (`.upsert`).                                                                                                                                                        |
| 3         | §5 (zakres dompurify)               | Tanie do domknięcia (zapięcie wersji + `--frozen-lockfile`), a chroni sanityzator przed cichym wyłączeniem przy następnym bumpie.                                                                                                                                |
| 4         | §4 (slugify)                        | Wymaga refaktoru czterech miejsc i testu parytetu; skutek to niestabilne kotwice po migracji treści.                                                                                                                                                             |
| 5         | §6 (reguła lintera), §9 (paginacja) | Systemowe, ale najlepiej domykane regułą/wzorcem niż listą poprawek.                                                                                                                                                                                             |
| 6         | §7 (i18n inline), §8 (knip w CI)    | Dług utrzymaniowy bez skutku dla użytkownika.                                                                                                                                                                                                                    |

Ustalenia §1-§5 mają odtworzone scenariusze awarii i dowody w kodzie - są gotowe do wdrożenia
bez dalszej analizy.
