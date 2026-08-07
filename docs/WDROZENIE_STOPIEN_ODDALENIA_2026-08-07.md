# Wdrożenie: stopień oddalenia w sieci kontaktów (luka #6)

Data: 2026-08-07 · Zakres: baza (2 RPC), warstwa danych, atomic design UI, i18n PL/EN, testy.

## Problem (z audytu)

| Funkcja                      | Ocena | Stan faktyczny                                            | Luka                                                                            |
| ---------------------------- | ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Stopień oddalenia (1./2./3.) | 0     | 2. stopień jest liczony wewnątrz `connection_suggestions` | ...i nigdzie nie pokazany. Brak etykiety „2°", brak ścieżki „Ty → Anna → Marek" |

Drugi stopień istniał w bazie od `20260717170000` (agregat `mutual` w scoringu sugestii), ale
nie wychodził na żadną powierzchnię: karta osoby wiedziała „ilu macie wspólnych znajomych",
nie wiedziała „jak daleko" ani „którędy". Trzeci stopień nie istniał w ogóle, więc katalog
osób nie umiał odróżnić kogoś z obrzeża własnej sieci od zupełnie obcej osoby.

## Co wdrożono

### 1. Baza - `supabase/migrations/20260807100000_connection_degree.sql`

Stopień oddalenia jako **kolumna zwracana przez RPC**, a nie wyliczenie w kliencie -
jedno źródło prawdy dla wszystkich powierzchni.

- **`connection_statuses` v3** (+5 kolumn): `degree smallint`, `bridge_id`, `bridge_name`,
  `bridge_avatar`, `bridge_slug`. Batchowo dla partii do 200 profili - zero N+1.
- **`connection_suggestions` v3** (+te same 5 kolumn). Trzeci stopień dokłada **1 punkt**
  w rankingu, ale nigdy nie przebija wspólnego kontaktu (waga 3).
- **Indeksy częściowe** `idx_user_connections_accepted_from/to` na `status = 'accepted'`
  z drugim końcem krawędzi w kluczu - spacer po grafie idzie index-only w obie strony pary.

Semantyka (graf **wyłącznie zaakceptowanych** relacji):

| `degree` | Znaczenie                                     | Most                   |
| -------- | --------------------------------------------- | ---------------------- |
| 1        | jesteście połączeni                           | brak (zbędny)          |
| 2        | macie wspólny kontakt                         | wspólny kontakt        |
| 3        | kontakt kontaktu Twojego kontaktu             | wejście do mojej sieci |
| 0        | poza zasięgiem (dalej niż 3° albo brak drogi) | brak                   |

Zaproszenie w toku (`pending`) **nie** robi 1. stopnia - stopień opisuje relacje, nie intencje.

**Prywatność.** Most nazywamy wyłącznie wtedy, gdy jest to **mój własny kontakt 1. stopnia**
z opt-inem `discoverable` (ta sama zasada, co lista wspólnych kontaktów `mutual_connections`).
Środkowy węzeł ścieżki 3. stopnia - kontakt mojego kontaktu - **nie jest ujawniany w ogóle**:
pokazujemy, że droga istnieje, nie czyjąś listę znajomych. Sam **dystans** jest liczony
niezależnie od `discoverable`, bo inaczej „2°" znikałoby wybiórczo i nie dałoby się na nim
oprzeć produktowo.

Wydajność: koszt to `mine` (moje krawędzie) + `second_pairs` (krawędzie moich kontaktów) +
krawędzie pytanych profili. Trzeci stopień w `connection_statuses` idzie przez `LATERAL … LIMIT 1`,
więc nie materializuje całego obrzeża grafu.

### 2. Warstwa danych

- **`src/lib/network/degree.ts`** - nowy moduł domenowy (bez react-query, bez Supabase):
  `ConnectionDegree`, `ConnectionBridge`, `normalizeDegree`, `toBridge`, `readDegree`,
  `isDegreeVisible`, `DEGREE_I18N_SUFFIX`. Dzięki temu atomy prezentacyjne rozumieją stopień
  bez ciągnięcia klienta bazy do każdego testu i chunka.
  Wartość spoza zakresu (starsza funkcja w bazie, `NULL` z `LEFT JOIN`) **degraduje się do 0**,
  więc do UI nigdy nie trafi „NaN°".
- **`useConnections.ts`** - `ConnectionState` zyskuje `degree` i `bridge`;
  `NO_CONNECTION` startuje z `degree: 0`.
- **`src/integrations/supabase/types.ts`** - dopisane kolumny obu funkcji.

### 3. UI - atomic design (`src/components/network`)

| Warstwa  | Komponent                       | Rola                                                              |
| -------- | ------------------------------- | ----------------------------------------------------------------- |
| atom     | `atoms/DegreeBadge`             | „1°/2°/3°" + pełny opis dla czytnika ekranu i `title`             |
| atom     | `atoms/PathNode`                | węzeł ścieżki: `you` / `person` / `hidden`                        |
| molekuła | `molecules/ConnectionPathTrail` | „Ty → Anna → Marek" (`full` z awatarami, `compact` typograficzna) |
| molekuła | `molecules/ConnectionDistance`  | odznaka + droga w jednym wierszu                                  |
| organizm | `organisms/NetworkDistance`     | wersja samowystarczalna na profil (batchowany RPC)                |
| hook     | `useDegreeLabels`               | jedyne miejsce styku tego pojęcia ze słownikiem i18n              |

Dostępność: cyfra jest skrótem wizualnym (`aria-hidden`), pełne zdanie idzie do czytnika
ekranu; ścieżka jest `role="group"` z etykietą, więc link mostu zachowuje fokus.
Wewnątrz linku całej karty most renderuje się jako tekst (`interactive={false}`) - `<a>` w `<a>`
to nieprawidłowy HTML.

### 4. Powierzchnie

- `/people` - odznaka przy nazwisku + ścieżka pod wierszem wspólnych kontaktów.
- `/network` - odznaka i ścieżka we wspólnym `PersonRow`: zakładka „Połączenia" (1°),
  „Sugestie" (2°/3° prosto z RPC). Zaproszenia świadomie bez stopnia.
- `/network/mutual/$userId` - podsumowanie drogi w nagłówku + „1°" przy każdym moście.
- profil autora (`/author/$slug`) - `NetworkDistance` obok `MutualConnectionsHint`
  („jak daleko" + „którędy" + „ilu"), wszystko z **jednego** batchowanego RPC.

### 5. i18n

Gałąź `network.degree.*` w PL i EN (`short`, `description`, `you`, `hiddenNode`, `pathAria`,
`via`, `legend`). Podgałęzie `short`/`description` mają identyczny zbiór podkluczy w obu
językach - komponenty czytają je przez template literal, a bramka `networkI18nKeys.gate`
pilnuje parytetu gałęzi. Zero `defaultValue` w kodzie.

## Testy

| Plik                                                            | Co przybija                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/tests/connection_degree_test.sql` (pgTAP, 24 asercje) | semantyka 1/2/3/0, most przy 1° i 3°, prywatność ukrytego mostu, `pending` bez stopnia, obcy tenant, ranking sugestii, anon (0 wierszy + brak EXECUTE) |
| `src/lib/network/__tests__/degree.test.ts`                      | degradacja wartości spoza zakresu, kompletność mostu, zerowanie mostu przy 1°/0                                                                        |
| `src/lib/network/__tests__/useConnections.test.tsx`             | przeniesienie `degree`/`bridge_*` z RPC do stanu relacji                                                                                               |
| `src/components/network/__tests__/DegreeBadge.test.tsx`         | brak renderu przy 0, skrót vs zdanie, `title`, warianty rozmiaru                                                                                       |
| `src/components/network/__tests__/ConnectionPathTrail.test.tsx` | nienazwany węzeł przy 3°, brak ścieżki bez mostu, brak `<a>` w `<a>`                                                                                   |
| `src/components/network/__tests__/NetworkDistance.test.tsx`     | bramki (moduł/anon/self), zero dodatkowych zapytań                                                                                                     |

## Uwaga poza zakresem

`src/lib/authz/authzSnapshot.generated.ts` przeliczony (`bun run generate:authz-snapshot`) -
bramka parytetu była czerwona **przed** tą zmianą (dryf proweniencji dwóch bramek czatu
z migracji `20260807054859` i przesunięcie liczników). Diff jest wyłącznie mechaniczny:
zmiana pliku źródłowego dwóch wpisów i statystyki skanu, bez zmiany kręgu uprawnionych.
