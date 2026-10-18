# Subskrypcje w najemcy domyślnym: naprawa, optymalizacja i testy (2026-10-18)

Zlecenie: „napraw, optymalizuj, wdrażaj testy” dla zgłoszenia „Subskrypcje mogą
trafiać do najemcy domyślnego” (`src/lib/billing/webhookDispatch.server.ts:515`).

## 1. Defekt

`subscriptions.tenant_id` ma `DEFAULT public_tenant_id()`
(`20260729072626:3`). Jedynym pisarzem tabeli jest webhook operatora płatności
(`insertSubscriptionRow`), który zapisywał wiersz kluczem serwisowym BEZ
`tenant_id`. Pod rolą serwisową nie ma nagłówka hosta, więc DEFAULT oddaje
najemcę DOMYŚLNEGO. Poprawką był trigger `subscriptions_pin_tenant`
(`20261007140300_subscriptions_tenant_from_owner`), który przypina najemcę
z profilu właściciela - ale istniał WYŁĄCZNIE w pasie supabase.

Produkcję zasila dziennik pasa drizzle (`drizzle/migrations/meta/_journal.json`;
`docs/PROMPT_ZAPROSZENIE_GRANICA_NAJEMCY.md:341-347`,
`docs/WDROZENIE_KOD_KWOTOWY_NA_BILET_2026-09-26.md:16-17`). Pas drizzle nie
miał ani triggera, ani uzgodnienia istniejących wierszy, a żadna bramka CI nie
sprawdzała kierunku supabase -> drizzle.

Stanu produkcji repozytorium nie dowodzi. Pliki dziennika wołają funkcje
zdefiniowane wyłącznie w plikach, których w dzienniku nie ma: na przykład
`_require_server_identity` (20261007120600) wołają 0227, 0231, 0242, 0244
i 0288, a `_access_code_probe_guard` (20261007140400) wołają 0190, 0230 i inne.
Część serii `20261007*` mogła więc dotrzeć na produkcję inną drogą (narzędziem,
z panelu). Poprawka działa w obu przypadkach. Kod nie polega już na triggerze,
a 0305 jest idempotentne, więc na bazie, która trigger ma, niczego nie psuje.

Skutki dla konta spoza najemcy domyślnego, gdy triggera nie ma:

- admin najemcy domyślnego widział cudze subskrypcje (`AdminBillingPanel`)
  i pobierał cudze faktury (`invoice.server.ts`, ścieżki po
  `subscriptions.tenant_id`);
- właściwy najemca nie widział subskrypcji w panelach, uzgadnianiu
  (`reconcile.server.ts`), windykacji (`dunning.server.ts`), przypomnieniach,
  zwrotach i porządkowaniu nieopłaconych dostępów;
- właściciel nie widział własnej subskrypcji (RLS `Users can view own
subscription` wiąże ją z najemcą jego profilu): zmiana planu, rezygnacja,
  wznowienie i liczba miejsc kończyły się `no_active_subscription`;
- każde kolejne zdarzenie operatora rozwiązywało plan w najemcy WIERSZA, czyli
  domyślnym: brak planu = odnowienia i rezygnacje nie trafiały do uprawnienia;
  plan o tym samym `tier_key` = `user_subscriptions.plan_id` obcego najemcy;
- zdarzenia operatora bez płatnika (`invoice.*`, `charge.*`) szły za
  subskrypcją do puli domyślnej dziennika webhooków.

## 2. Zmiany

| Zmiana                     | Plik                                                                                                                              | Co robi                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Najemca jawnie w zapisie   | `src/lib/billing/webhookDispatch.server.ts` (`ownerTenant`, `createSubscription`, `insertSubscriptionRow`)                        | Webhook czyta `profiles.tenant_id` właściciela i wpisuje go do wstawianego wiersza. Nie zależy już od tego, czy trigger dojechał do bazy. Konto bez profilu: wiersz bez `tenant_id` (wartość awaryjną zostawia baza - ta sama reguła co trigger). Porażka odczytu rzuca, zanim powstanie wiersz: odpowiedź 500, operator ponawia. |
| Wspólny odczyt             | `src/lib/server/userTenant.server.ts` (`readUserTenantId`)                                                                        | Ten sam odczyt profilu co `resolveUserTenantId`, ale odróżnia „brak profilu” (`null`) od porażki zapytania (wyjątek). `resolveUserTenantId` deleguje do niego bez zmiany zachowania.                                                                                                                                              |
| Optymalizacja              | jw.                                                                                                                               | Najemca jest czytany RAZ, przed skutkami zakupu, i przekazywany do `applyPurchaseEffects` / `resolvePlanForPrice` (`PurchaseContext.tenantId`). Dotąd profil czytał `scopeTenant`, a wynik przepadał. Ścieżka płatna ma tyle samo zapytań co przed poprawką, a ślad księgowy piaskownicy jedno więcej.                            |
| Trigger w pasie drizzle    | `drizzle/migrations/0305_subscriptions_tenant_from_owner.sql`                                                                     | Bajt w bajt `20261007140300`: trigger + uzgodnienie istniejących wierszy. Idempotentny, więc późniejsza kopia z panelu Lovable jest bezpieczna.                                                                                                                                                                                   |
| Zdarzenia za subskrypcją   | `supabase/migrations/20261018100000_payment_webhook_events_follow_subscription_tenant.sql` + bliźniak `drizzle/migrations/0306_…` | Po przepięciu subskrypcji ponownie rozstrzyga pulę domyślną `payment_webhook_events` tą samą kaskadą (`payment_webhook_event_tenant`). To ten sam backfill co `20260913100000` (sekcja 3).                                                                                                                                        |
| Bramka supabase -> drizzle | `src/lib/ci/migrationLaneParity.ts`, `scripts/check-migration-lanes.ts`                                                           | `check:migration-lanes` sprawdza teraz także kierunek odwrotny: plik `supabase/migrations/` od startu pasa drizzle bez kopii w dzienniku drizzle oblewa CI. Wyjątkiem jest plik z wpisem w rejestrze: skonsolidowany w innym pliku drizzle albo znany brak, wypisywany przy każdym przebiegu.                                     |

## 3. Testy

| Test                                                                             | Dowodzi                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webhookDispatch.server.test.ts` › „najemca zakładanej subskrypcji…” (5)         | Wiersz, uprawnienie i nagrobek w najemcy PROFILU. Plan rozwiązywany w tym samym zakresie. Jeden odczyt profilu na ścieżce zakładania. Ślad księgowy piaskownicy też w najemcy profilu. Konto bez profilu nie wywraca zapisu. Porażka odczytu nie zostawia wiersza. |
| `duplicateSubscriptionAlert.server.test.ts`                                      | Atrapy bazy zachowują się jak baza BEZ triggera (DEFAULT = najemca domyślny). Zakres alarmu o drugim planie jest poprawny tylko dzięki zapisowi webhooka.                                                                                                          |
| `supabase/tests/payment_webhook_events_follow_subscription_tenant_test.sql` (10) | Odtwarza produkcję „tylko drizzle”: bez triggera subskrypcja i zdarzenia bez płatnika trafiają do najemcy domyślnego. Uzgodnienia 0305 -> 0306 przepinają je do najemcy profilu, nie ruszają wierszy spoza puli domyślnej i są idempotentne.                       |
| `migrationLaneParity.test.ts`                                                    | Bramka odwrotna: brak kopii, pokrycie spoza dziennika, nieaktualny wpis. Prawdziwe repozytorium przechodzi, a `20261007140300` i `20261018100000` mają bliźniaka w dzienniku.                                                                                      |

Mutacja: na `webhookDispatch.server.ts` sprzed poprawki oblewa 9 testów (5
nowych i 4 testy alarmu). Z poprawką przechodzą wszystkie.

## 4. Wdrożenie

Kolejność dowolna. Kod sam naprawia NOWE subskrypcje, a migracje naprawiają
istniejące wiersze. W pasie drizzle `0305` musi poprzedzać `0306` (dziennik
to gwarantuje).

Przed `0305` (kopia tabeli i licznik):

```sql
SELECT count(*) AS subskrypcje_w_zlym_najemcy
  FROM public.subscriptions s
  JOIN public.profiles p ON p.id = s.user_id
 WHERE s.tenant_id IS DISTINCT FROM p.tenant_id;
```

Po `0305`, przed `0306` (zdarzenia do przepięcia):

```sql
WITH resolved AS (
  SELECT e.id, e.tenant_id,
         public.payment_webhook_event_tenant(
           e.user_id, e.customer_id, e.subscription_id, e.environment, e.payload) AS nowy
    FROM public.payment_webhook_events e
   WHERE e.tenant_id = public.email_default_tenant_id()
)
SELECT count(*) FROM resolved WHERE nowy IS NOT NULL AND nowy IS DISTINCT FROM tenant_id;
```

Po wdrożeniu oba zapytania mają zwrócić 0, a `subscriptions_pin_tenant` ma
istnieć (`SELECT tgname FROM pg_trigger WHERE tgname = 'subscriptions_pin_tenant'`).

## 5. Czego migracje celowo NIE naprawiają (decyzja właściciela)

Kopie najemcy zrobione, gdy subskrypcja stała w najemcy domyślnym:

1. **Uprawnienia z planem obcego najemcy albo zamrożone.** Kolejne zdarzenie
   operatora (najpóźniej odnowienie) rozwiąże plan już w najemcy profilu
   i nadpisze `plan_id` oraz okres. Żeby naprawić od razu, trzeba wyrównać
   konto stanem z API operatora (uzgodnienie w panelu albo
   `syncMyBillingFromProvider`). Lista:

   ```sql
   SELECT us.id, us.user_id, us.tenant_id, ap.tenant_id AS najemca_planu, us.status, us.current_period_end
     FROM public.user_subscriptions us
     JOIN public.access_plans ap ON ap.id = us.plan_id
    WHERE ap.tenant_id IS DISTINCT FROM us.tenant_id;

   SELECT us.id, us.user_id, us.status, us.current_period_end,
          s.status AS status_lustra, s.current_period_end AS okres_lustra
     FROM public.user_subscriptions us
     JOIN public.subscriptions s ON s.provider_subscription_id = us.external_ref
    WHERE s.status IN ('active', 'trialing')
      AND us.current_period_end < s.current_period_end - interval '1 day';
   ```

   SQL-em tego nie zmieniamy. Zmiana `plan_id` emituje zdarzenia
   (`tg_user_subscriptions_emit_events`), a okresu i statusu nie da się
   odtworzyć bez operatora.

2. **Dokumenty rozliczeniowe w najemcy domyślnym.** `billing_documents`
   dostawał najemcę z wiersza subskrypcji, a migawka sprzedawcy i nabywcy jest
   zapisywana raz (`billing_documents_snapshot_write_once`). Przeniesienie
   dokumentu z migawką sprzedawcy innego najemcy to decyzja księgowa (korekta),
   nie migracja:

   ```sql
   SELECT bd.id, bd.number, bd.provider_document_id, bd.tenant_id,
          p.tenant_id AS najemca_profilu, bd.issued_at
     FROM public.billing_documents bd
     JOIN public.profiles p ON p.id = bd.user_id
    WHERE bd.provider = 'stripe' AND bd.tenant_id IS DISTINCT FROM p.tenant_id;
   ```

3. **Zgody na newsletter z zakupu.** Ścieżka pierwszego uprawnienia
   istniejącego wiersza (`incomplete` -> `active`, 3DS i przelew) zapisywała je
   w najemcy planu. To rejestr zgód, więc do przeglądu, a nie do hurtowej
   zmiany:

   ```sql
   SELECT ns.id, ns.email, ns.tenant_id, p.tenant_id AS najemca_profilu, ns.source, ns.created_at
     FROM public.newsletter_subscribers ns
     JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.tenant_id IS DISTINCT FROM p.tenant_id;
   ```

## 6. Ryzyka poza zakresem

- **Przeniesienie konta do innego najemcy.** `tg_profiles_repin_account_tenant`
  (`20260914200000`, w pasie drizzle `0018`) celowo pomija płatności, a
  `subscriptions_pin_tenant` odpala tylko przy INSERT i UPDATE OF user_id.
  Subskrypcja zostaje więc w starym najemcy, a RLS właściciela i
  `scopeTenant` zakładają najemcę BIEŻĄCEGO profilu. To ten sam zestaw
  objawów, tylko z innej przyczyny. Wymaga decyzji, czy subskrypcja to
  „historia”, czy „stan bieżący konta”.
- **Inne migracje tylko w pasie supabase.** Bramka odwrotna wypisuje je
  z nazwy przy każdym przebiegu `check:migration-lanes`. Większość serii
  `20261007*` to poprawki bezpieczeństwa, których dziennik drizzle nie niesie
  (najpilniejsza: `20261007140000_email_queue_service_only`). Przed
  przeniesieniem trzeba sprawdzić na produkcji, czy już tam są (patrz wyżej:
  dziennik woła ich funkcje). Każda wymaga osobnego przeniesienia z
  zachowaniem kolejności „najpierw kod” (`docs/HARDENING_FOLLOWUP_2026-10-07.md`,
  sekcja 2).
