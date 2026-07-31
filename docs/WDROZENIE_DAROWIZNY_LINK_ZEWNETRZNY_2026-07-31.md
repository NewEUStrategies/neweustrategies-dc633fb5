# Wdrożenie: wycięcie panelu /admin/donations + link zewnętrzny do zbiórki - 2026-07-31

**Źródło zadania:** `docs/OCENA_FUNKCJI_TABELE_2026-07-30.md` (wiersz „Darowizny",
ocena 3) oraz `docs/AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-07-30.md` (poz. 227-228,
rekomendacja 7): panel `/admin/donations` był **trwale pustą wydmuszką** -
deklarował „Zapisuje je webhook Stripe", podczas gdy darowizny zostały uczciwie
przeniesione na zewnętrzną zbiórkę zrzutka.pl (AUP Paddle wyklucza
darowizny/crowdfunding u operatora płatności) i **nic nie pisze** do tabeli
`donations`. Rekomendacja: wyciąć panel i oznaczyć pozycję jako link zewnętrzny.

**Weryfikacja na tej sesji:** `tsc --noEmit` czysty; ESLint na zmienionych
plikach czysty; pełny suite jednostkowy zielony (408 plików / 3548 testów,
w tym 5 nowych testów atomu linku zewnętrznego); `routeTree.gen.ts`
zregenerowany generatorem projektowym (`scripts/gen-routes.mjs`), diff obejmuje
wyłącznie usuniętą trasę.

---

## 1. Co się zmieniło

### Wycięty martwy panel

- **Usunięto** `src/routes/admin.donations.tsx` - pusty read-only rejestr
  z 2 KPI i fałszywą deklaracją synchronizacji „Stripe -> webhook -> tabela
  donations -> widget". Trasa zniknęła z `routeTree.gen.ts` (regeneracja,
  -21 linii).
- **Usunięto** martwy klucz `billingKeys.admin.donations()`
  (`src/lib/billing/keys.ts`) - po wycięciu panelu nie miał żadnego konsumenta.
- `donationKeys()` w `src/lib/realtime/eventInvalidationMap.ts` inwaliduje
  teraz wyłącznie rejestr darowizn w profilu użytkownika
  (`billingKeys.myDonationsAll()`); zdarzenia `donation.recorded.v1` /
  `donation.refunded.v1` pozostają obsłużone (rejestr historyczny w profilu
  i widget CMS czytają dalej z `public.donations` - filtr `tenant_id` +
  `status='paid'` bez zmian, patrz `donations.functions.ts`).

### Pozycja nawigacji jako jawny link zewnętrzny

- Model nawigacji `AdminShell` rozszerzony o **dyskryminowaną unię**: pozycja
  wewnętrzna (`to`, TanStack `<Link>`) lub zewnętrzna (`href`, nowa karta).
  Zwężanie przez `"href" in item` - zero `any`, zero rzutowań.
- Nowy współlokowany atom **`SidebarExternalNavLink`** (wzorzec identyczny jak
  `SidebarRowButton` - jedno miejsce na rytm wiersza sidebara):
  - ten sam layout/typografia co wewnętrzne pozycje (`py-1`, `text-[13px]`,
    warianty compact z tooltipem po prawej),
  - `target="_blank"` + `rel="noopener noreferrer"` (twarde atrybuty
    bezpieczeństwa nowej karty),
  - glif „external" po prawej stronie etykiety - wyjście z panelu jest
    odróżnialne od tras wewnętrznych na pierwszy rzut oka,
  - dostępność: `sr-only` z dopiskiem „Otwiera się w nowej karcie" oraz
    `title` łączony zwykłym dywizem („Etykieta - dopisek"),
  - spread `...rest` + `ref` w propsach (React 19) - pełna kompatybilność
    z Radix Slot (tooltip trybu compact),
  - `data-external-link="true"` + `data-sidebar="menu-button"` - spójne
    hooki stylistyczne z resztą sidebara.
- Pozycja „Darowizny" w grupie Monetyzacja wskazuje `EXTERNAL_DONATIONS_URL`
  (`src/lib/billing/donationsExternal.ts` - moduł client-safe, jedyne źródło
  prawdy o adresie zbiórki, współdzielone z `/support` i `DonationCta`).

### i18n (PL/EN, parzystość kluczy zachowana)

| Klucz                             | PL                         | EN                     |
| --------------------------------- | -------------------------- | ---------------------- |
| `admin.nav.donations`             | Darowizny (zrzutka.pl)     | Donations (zrzutka.pl) |
| `admin.nav.externalNewTab` (nowy) | Otwiera się w nowej karcie | Opens in a new tab     |

`externalNewTab` jest generyczny - każda przyszła zewnętrzna pozycja nawigacji
używa tego samego dopisku dostępności.

### Uporządkowane komentarze domenowe

- `DonationsWidgetView.tsx` - nagłówek nie odsyła już do `/admin/donations`;
  opisuje rzeczywisty przepływ (rejestr historyczny + zbiórka na zrzutka.pl).
- `donations.functions.ts` - usunięte odwołanie do skasowanego pliku trasy.

## 2. Czego celowo NIE zmieniono

- **Tabela `public.donations` zostaje** - to rejestr historycznych wpłat
  i wpisów administracyjnych; widget CMS „Darowizny / Mecenat" (6 wariantów)
  dalej czyta z niej zagregowane sumy przez server fn
  `getDonationsPublicStats` (service role, tenant-scoped, bez PII).
- **`/support` i `DonationCta` bez zmian** - już wcześniej linkowały wprost
  do zbiórki zewnętrznej.
- **Rejestr darowizn w profilu użytkownika** (`profile.membership`,
  `billingKeys.myDonations`) zostaje - pokazuje historyczne wpłaty.
- Dokumenty audytowe z 2026-07-30 pozostają nietknięte (są migawką stanu);
  ten dokument jest zapisem wdrożenia rekomendacji.

## 3. Testy

Nowy `src/components/admin/__tests__/SidebarExternalNavLink.test.tsx`
(konwencja jak `SidebarRowButton.test.tsx`):

1. twarde atrybuty nowej karty (`href`, `target`, `rel`, `data-external-link`),
2. `title` = „Etykieta - dopisek" (zwykły dywiz),
3. dopisek dostępności wyłącznie dla czytników (`sr-only`),
4. tryb compact: etykieta ukryta, brak natywnego `title` (tooltip przejmuje
   etykietę), wyśrodkowanie ikony,
5. merge wstrzykiwanych propsów i `className` (kompatybilność z Radix Slot).
