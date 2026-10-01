# Naprawa: kody wydarzeń i kupony - limit prób i jedna odpowiedź dla pudła (2026-10-01)

Zamyka pozycję 16.15 pkt 6 audytu wydania 12 (`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md:9298`), czyli defekt 16.8 (`:8805-8810`, wiersz tabeli `:8831`). HEAD pomiaru: `3830690`.

Kryterium akceptacji z audytu brzmi: „trzydziesta pierwsza próba z jednego IP w oknie kończy się odmową, a odpowiedź dla kodu z innego wydarzenia jest nieodróżnialna od pudła”.

## 1. Mechanizm defektu (stan przed naprawą)

| Droga | Kto mógł wołać | Co zdradzała |
| --- | --- | --- |
| `validate_b2b_coupon` (`20260922220000:61-87`) | PUBLIC i anon (GRANT `20260919094000:92`, PUBLIC nigdy nie odebrany), authenticated | Wszystkie odmowy oddawały `coupon_id`, nazwę, rodzaj i procent. `event_not_eligible` (`:80-81`) różniło kod wydarzenia od pudła, `inactive` - kod wyłączony. |
| `validate_event_ticket_coupon` (`:89-118`) | authenticated | Kod innego wydarzenia i kod tylko planowy dawały powód różny od pudła, z id i nazwą. |
| `event_coupon_revealed_tickets(uuid, text)` (`:122-147`) | anon | Pusta lista albo lista biletów, czyli wprost: kod istnieje albo nie. |
| `event_admission_quote` (`20260926110001:177-215`) | authenticated | `coupon_other_event` różne od `coupon_unknown`. Sprawdzane po ważności, więc wygasły kod innego wydarzenia odpowiadał `coupon_expired`. |
| `resolveStripeDiscount` (`src/utils/payments.functions.ts`) | każdy, bez sesji | Kluczem serwisowym zwracała surowy powód z bazy, a przy trafieniu tworzyła obiekty rabatu u dostawcy. |
| `quoteEventTicketCheckout`, `createCheckoutOrder`, `createPlanCheckoutSession` | zalogowany | Surowy powód z bazy. |

Żadna z tych dróg nie przechodziła przez limiter, więc nic nie ograniczało zgadywania.

Przy okazji wyszedł drugi problem. `redeem_b2b_coupon_with_effects` została wycofana w `20260725090300:192-198`, ale `20260725181430:15,34` przywróciła jej EXECUTE dla `authenticated`. Funkcja nadaje warstwę członkowską bez płatności każdemu, kto zna `coupon_id`, a `coupon_id` wyciekał z odmów opisanych wyżej.

## 2. Co zmienia naprawa

### Baza

Migracja `supabase/migrations/20261001100000_event_code_guessing_lockdown.sql` ma bliźniaka w pasie drizzle (`0116_event_code_guessing_lockdown.sql`, wpis w dzienniku idx 116, `when` 1790848800000) i wpis w `MIGRATION_LANES`. Robi siedem rzeczy.

1. **Kubełek pudeł na użytkownika.**
   - Funkcje: `_coupon_probe_bucket`, `_coupon_probe_guard`, `_coupon_probe_miss`.
   - Limit to 30 pudeł na 10 minut. Okno liczone jest tak samo jak w `rate_limit_hit`, a obie liczby żyją w jednym miejscu.
   - Strażnik tylko podgląda licznik, niczego nie dolicza. Pudło dolicza `rate_limit_hit`.
   - Trzydzieste pierwsze wywołanie w oknie dostaje `rate_limited: too many code attempts, try again later` (P0001). Dotyczy to także poprawnego kodu, więc zablokowany użytkownik nie ma wyroczni.
   - Trafienia nie zużywają kubełka.
   - Ścieżki `service_role` (bez `auth.uid()`) mają limiter po stronie TS i strażnik ich nie liczy.
2. **`_b2b_coupon_evaluate`.** Odmowa nie zawiera id, nazwy, rodzaju ani procentu. `inactive` zamienia się w `not_found`.
3. **`validate_b2b_coupon` i `validate_event_ticket_coupon`.**
   - Są teraz VOLATILE, bo PostgREST wykonuje funkcje STABLE w transakcji tylko do odczytu, a zapis pudła jest zapisem.
   - Strażnik działa przed wyszukaniem kodu.
   - Kod nieznany, wyłączony, z obcego najemcy, przypięty do innego zakresu albo do innego wydarzenia daje ten sam wiersz `not_found` i jest liczony jako pudło.
   - Odróżnialne powody zostają tylko tam, gdzie kupujący ma kod w ręku i potrzebuje zdania: `not_yet_valid`, `expired`, `limit_reached`, `per_user_limit_reached`, `plan_not_eligible` (na ścieżce planu), `ticket_not_eligible` (na ścieżce biletu), `no_discount`, `currency_mismatch`. Żaden z nich nie niesie danych kodu.
   - `validate_b2b_coupon` traci EXECUTE dla PUBLIC i anon.
   - `authenticated` zachowuje EXECUTE: kasa woła walidację klientem z JWT kupującego, bo potrzebuje `auth.uid()` (limit na osobę) i najemcy z profilu. Ten sam JWT pozwala przeglądarce wołać ją bezpośrednio, dlatego limit siedzi w bazie.
4. **`event_coupon_revealed_tickets(p_tenant, p_event_id, p_code)`.** Wykonuje ją wyłącznie `service_role`, a najemca jest podawany jawnie. Wersja dwuargumentowa jest usunięta.
5. **`event_admission_quote`.** Pełne ciało z `20260926110001`, zmienione tylko w trzech miejscach:
   - VOLATILE zamiast STABLE;
   - strażnik przed wyszukaniem kodu;
   - kod innego wydarzenia daje `coupon_unknown` z pudłem i jest sprawdzany przed ważnością.
6. **`redeem_b2b_coupon_with_effects`.** Ponownie traci EXECUTE dla PUBLIC, anon i authenticated. REVOKE jest warunkowy (`to_regprocedure`), bo baza harnessu wydarzeń tej funkcji nie modeluje.
7. **Idempotencja.** CREATE OR REPLACE, DROP ... IF EXISTS i bezstanowe REVOKE/GRANT, więc ponowne zastosowanie niczego nie zmienia.

### Serwer (TS)

- **`src/lib/events/codeProbeLimit.server.ts`.** Limit 30 prób na 10 minut na kubełek, oba kubełki z `failClosed: true`. Najpierw kubełek IP, potem kubełek konta, gdy jest sesja. Podmiotem jest solony skrót, nie surowy adres. Limiter stoi wyłącznie przed endpointami, które istnieją po to, żeby zapytać o kod:
  - odsłonięcie biletów;
  - podgląd kuponu planu;
  - `resolveStripeDiscount`.

  Wycena i kasa wielokrotnie ponawiają walidację w jednej legalnej sesji. Tam pilnuje kubełek pudeł w bazie, który nie liczy trafień.
- **`eventCodeReveal.functions.ts` / `.server.ts`.** Publiczna funkcja POST. Najemca pochodzi z zaufanego hosta i trafia do RPC jawnie. Odmowa limitu i awaria mają osobne powody, nigdy nie wracają jako pusta lista.
- **`couponPreview.functions.ts` / `.server.ts`.** Funkcja POST za `requireSupabaseAuth`. Walidację wykonuje klient z JWT kupującego, czyli ten sam najemca i ten sam limit na osobę co w `createPlanCheckoutSession`. Do przeglądarki wraca wynik bez `coupon_id` i bez nazwy, także przy sukcesie.
- **DB-owe `rate_limited` w wycenie i kasie.** Normalizuje je `codeProbeRpcError` / `isCodeProbeRateLimited` w `src/lib/billing/coupons.ts`. Kończy się wyjątkiem o stałej treści albo, w kasie planu, własnym powodem. Nigdy nie wraca jako odmowa kodu (`mode: "coupon"`), bo po takiej odmowie kasa zdejmuje kod z pamięci i płaci pełną cenę.

### Przeglądarka

- **`useValidateCoupon`** woła serwerowy podgląd zamiast RPC.
- **`RegistrationTicketPicker`** woła serwerowe odsłonięcie. Ma osobne zdania dla limitu (`revealRateLimited`) i awarii (`revealError`). Przycisk jest wyłączony, dopóki pytanie jest w drodze, więc podwójne kliknięcie nie zużywa dwóch prób. Kod dłuższy niż 64 znaki nie trafia do serwera.
- **Komunikat o limicie zamiast mylących komunikatów:**
  - `RegistrationPayAction` pokazuje limit przez `ticketCheckoutRefusal` i powód `rate_limited`. Kod zostaje w polu, a płatności bez kodu nie ma.
  - `checkout.$planId` pokazuje limit zamiast „płatności nieskonfigurowane”.
  - `EventTicketPurchase` i `CartPanel` pokazują limit zamiast ogólnej awarii.
  - `EventPackagesPurchase` pokazuje błąd wyceny zdaniem zamiast wiecznego ładowania, a limit przy zakupie zdaniem o limicie.
- **Ekran kuponu ma zdania dla trzech powodów,** których wcześniej nie znał i przy których nie mówił nic: `per_user_limit_reached`, `no_discount`, `rate_limited`. Teksty są w PL i EN.

## 3. Kolejność wdrożenia

Kod i migracja idą razem. Między nimi odsłanianie biletów odpowiada błędem, nigdy złymi danymi:

- stary kod przeglądarki woła wersję dwuargumentową, której po migracji już nie ma;
- nowy kod serwera woła wersję z `p_tenant`, której przed migracją jeszcze nie ma.

Walidacja z JWT zalogowanego działa w obu układach.

## 4. Pomiary i granice weryfikacji

| Sprawdzenie | Wynik |
| --- | --- |
| `supabase/tests/event_code_guessing_test.sql` (lokalny runner pgTAP na pełnym schemacie) | 37/37 |
| Pozostałe pliki pgTAP z kuponami i ACL (`coupon_effects_after_payment`, `security_definer_tenant_scope`, `event_participant_foundation`, `member_slug_non_author_visibility`) | zielone |
| Pełna suita pgTAP (lokalnie) | 110 plików OK, 6 czerwonych. Wszystkie 6 to braki tego środowiska: `unaccent`, `pg_net`, atrapa `pgvector`, RLS atrapy storage. Nie dotyczą funkcji kodów. |
| `scripts/events-harness/run.sh` | OK, 172 migracje i 3855 asercji. Asercja 71 przepisana z `coupon_other_event` na `coupon_unknown`. |
| Migracja zastosowana ponownie na tej samej bazie (oba pasy) | bez błędów |
| vitest: dotknięte moduły i bramki (lane parity, rozmiar migracji, plan pgTAP, i18n key drift / parity, mapy błędów wydarzeń) | zielone |
| Pokrycie plików z progiem 98%, które zmieniłem | `RegistrationPayAction` 99,29/99,37/100/100, `checkout.functions` 100, `eventTicketPricing.server` 100, `EventPackagesPurchase` 100, `EventTicketPurchase` 100. Nowe moduły dostały własne progi. |

Granice weryfikacji:

- Nie sprawdzałem zachowania na produkcji.
- Tryb transakcji PostgREST dla funkcji STABLE i VOLATILE jest udokumentowanym zachowaniem PostgREST. Lokalnie go nie odtwarzam, bo ten kontener nie ma Supabase CLI ani dockera.
- `xlsx` zastąpiłem lokalnie wersją 0.18.5 z npm, bo proxy blokuje `cdn.sheetjs.com`. Nie ma to związku z tą zmianą, a manifesty zostały bez zmian.

`scripts/audit/verify-edition-12.mjs` daje teraz 93 zielone i 21 czerwonych asercji:

- 3 opisują ten defekt jako istniejący, więc ich czerwień jest oczekiwana: późniejsza redefinicja funkcji kodów, `useValidateCoupon.ts` i `eventCodesApi.ts` nie wołają już RPC wprost.
- 18 to liczniki migawki (pliki, migracje, asercje pgTAP, progi, README), które rośnie każdy PR.

Zgodnie z konwencją weryfikatora i dokumentu audytu nie ruszam. Rozdział 16.8 trzeba przepisać w następnym wydaniu.

## 5. Czego świadomie nie zrobiłem (osobne pozycje)

- **Ukryte bilety są w publicznym ładunku i da się je kupić bez kodu.** `event_registration_form` (`20260923110000:95-102`) oddaje anonimowi także bilety z `is_hidden`. Ukrywa je dopiero przeglądarka (`registrationFormSurface.ts`, `?ticket=<klucz>`), a `event_register` nie sprawdza `is_hidden` ani `reveals_hidden`. Odsłanianie chroni więc tajemnicę kodu, nie samych biletów. To osobny defekt modelu dostępu.
- **`redeem_b2b_coupon` przyjmuje dowolne `coupon_id` od zalogowanego**, także bez zamówienia. Posiadacz ważnego kodu może z sukcesu walidacji wziąć `coupon_id` i wyczerpać `max_redemptions`. Pakietowa wycena (`event_admission_quote`) oddaje `coupon_id` przy sukcesie wprost do przeglądarki. Rezerwacja powinna wymagać zamówienia wołającego w stanie `pending`.
- **Ten sam adres IP to wspólny kubełek.** Sieć konferencyjna albo NAT biura dzielą 30 prób na 10 minut na odsłanianie i podgląd. Kasa i wycena tego kubełka nie używają, więc legalny zakup z kodem go nie zjada.
