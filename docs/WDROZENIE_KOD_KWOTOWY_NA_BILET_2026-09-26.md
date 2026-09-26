# Wdrożenie: kod kwotowy schodzi z KAŻDEGO biletu - notatka operacyjna

**Data:** 2026-09-26
**Zgłoszenie:** „kod na stałą kwotę odejmuje się raz od całego zamówienia, a nie od każdego biletu".
**Migracja:** `supabase/migrations/20260926110000_event_package_coupon_per_seat.sql`
**Harness:** `scripts/events-harness/runtime_test.d/71_package_coupons.sql`

Kod w repozytorium zamyka trzy drogi, które dawały ten objaw (pakiet grupowy
liczony w bazie, pole kodów w nakładce Stripe, ekran bez podglądu kwoty). Dwóch
rzeczy kod NIE zrobi sam - obie są krokami operacyjnymi poniżej.

---

## 1. Zastosowanie migracji na produkcji (PRZED wdrożeniem frontu)

Produkcja jest aplikowana z pasa Lovable/drizzle; plik w `supabase/migrations`
sam się tam nie wykona. Bliźniak jest już w repozytorium:
`drizzle/migrations/0056_event_package_coupon_per_seat.sql` (wpis w `_journal.json`,
`meta/0056_snapshot.json` i w `MIGRATION_LANES`). Trzeba go zastosować z panelu
Lovable RAZEM z `0055_event_group_guests_follow_lead.sql` z tej samej serii
(kolejność: 0055, potem 0056). Bez tego pakiet grupowy nadal zdejmuje kod raz,
a podgląd kasy w zapisie działa, ale kasa pakietu - nie.

## 2. Wyłączenie kopii kodów wydarzeń u operatora (sandbox I live)

**Dlaczego.** Przycisk „Zsynchronizuj kupony" wypychał dotąd do Stripe KAŻDY
aktywny kupon, także kody ze studia wydarzenia. Ich kopia w Stripe to kupon
`amount_off` zdejmowany RAZ z całej sesji, z pominięciem zakresu biletu,
limitu użyć i wiersza `b2b_coupon_redemptions`. KAŻDA sesja biletu ma już
`allow_promotion_codes: false` - wymusza je wspólny budowniczy sesji
(`createAdhocCheckoutSession` dla `purpose: "event_ticket"`), więc dotyczy to
zarówno kasy biletów (`createCheckoutOrder`), jak i server fn ad-hoc
(`stripeCheckout.functions.ts`), niezależnie od ustawień kasy. Sesje planu
i odblokowania treści NADAL mają pole kodu (jeśli włączono je w ustawieniach
kasy) - więc taka kopia działa tam dalej jako rabat, którego baza nie widzi.

Synchronizacja tych kopii NIE wyłącza sama: Stripe ma jedną przestrzeń kodów
dla wszystkich najemców, a kod o tej samej treści może być u innego najemcy
kodem ogólnym.

**Krok 1 - lista kodów do sprawdzenia** (każdy najemca osobno):

```sql
SELECT tenant_id, upper(code) AS code, event_ids, applies_discount
FROM public.b2b_coupons
WHERE active
  AND (cardinality(event_ids) > 0 OR applies_discount = false)
ORDER BY tenant_id, code;
```

**Krok 2 - kolizje między najemcami.** Kod z listy, który u INNEGO najemcy jest
aktywnym kodem ogólnym, zostaw i zgłoś - wyłączenie odebrałoby tamtemu
najemcy rabat:

```sql
SELECT upper(c.code) AS code, c.tenant_id
FROM public.b2b_coupons c
WHERE c.active AND cardinality(c.event_ids) = 0 AND c.applies_discount
  AND upper(c.code) IN (<kody z kroku 1>);
```

**Krok 3 - wyłączenie**, dla każdego pozostałego kodu, w `sandbox` i w `live`:

```bash
# znajdź AKTYWNY kod promocyjny o tej treści
stripe promotion_codes list --code "KONGRES-50" --active true --limit 1
# wyłącz go (kupon pod spodem może zostać - bez kodu nikt go nie wpisze)
stripe promotion_codes update promo_XXXXXXXX --active false
```

To samo przez SDK: `stripe.promotionCodes.list({ code, active: true, limit: 1 })`,
potem `stripe.promotionCodes.update(id, { active: false })`.

**Krok 4 - sprawdzenie.** Panel admina → Rozliczenia → Diagnostyka płatności,
tabela „Kupony B2B a rabaty u operatora", oba środowiska. Kod wydarzenia
z aktywną kopią ma plakietkę **„aktywna kopia u operatora - wyłącz"**; po
kroku 3 zmienia się na **„liczony w naszej kasie"** (tabela pyta operatora
wyłącznie o AKTYWNE kopie takich kodów).

## 3. Poza zakresem tej zmiany - do osobnych zadań

Oba punkty zrobione w tej serii (`docs/WDROZENIE_BRAKI_WYDARZEN_CZ2_2026-09-26.md`):

- ~~**Kod dostępu ukrytego biletu w kasie zgłoszenia.**~~ Formularz zapisu ma
  pole kodu dostępu wejściówki i wysyła `access_code` do `event_register`, a
  kasa zgłoszenia (`RegistrationPayAction`) wysyła go do podglądu i do kasy;
  bez kodu w pamięci karty odmowa kasy odsłania pole kodu.
- ~~**Benefit planu członka liczony na miejsce, a nie na członka.**~~ Benefit
  (zniżka albo bilet z puli) obejmuje tylko miejsce członka, goście płacą
  cennik; bilet z puli dla miejsca prowadzącego schodzi z puli w kasie
  (`20260926140000_event_group_lead_plan_seat.sql`, 0059).

## 4. Zrobione później w tej serii

- **Anulowanie zamówienia pakietu zwraca użycie kodu** - migracja
  `supabase/migrations/20260926130000_event_package_order_cancel_returns_coupon.sql`
  (bliźniak `drizzle/migrations/0058_event_package_order_cancel_returns_coupon.sql`,
  zastosować PO 0056), harness `72_package_order_cancel_coupon.sql`. Wiersz
  `b2b_coupon_redemptions` wskazuje teraz zamówienie (`package_order_id`),
  a `admin_event_package_order_set_status` przy wejściu w „anulowane” kasuje go
  i zdejmuje z `redemptions_count` (zatrzask `coupon_released_at`). Powrót
  z anulowania zużywa kod z powrotem albo odmawia (`coupon_restore_exhausted`,
  `coupon_restore_used_by_buyer`) i wtedy nie zmienia niczego; „zwrócone”
  zatrzymuje użycie. Stare dane dopina jednorazowo
  `_event_package_coupon_link_backfill()` (wołana przez migrację): pary
  jednoznaczne 1:1 są wiązane, zamówieniom już anulowanym użycie wraca.
  Realizacje niejednoznaczne zostają niepowiązane - anulowanie ich nie oddaje,
  a powrót nie zużywa drugi raz. Zwrot puli zestawów i miejsc przy anulowaniu
  nadal jest poza zakresem.
