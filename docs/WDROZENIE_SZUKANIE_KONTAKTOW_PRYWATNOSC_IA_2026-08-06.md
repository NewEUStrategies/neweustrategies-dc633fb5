# Wdrożenie §8, §9, §10, §11 i §13 - 2026-08-06

Pięć pozycji z rewizji 2 wydania 06.08 (`OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`),
domkniętych w jednej gałęzi, bo trzy z nich schodzą się w tym samym miejscu:
w prywatności czatu i w tym, gdzie użytkownik jej szuka.

| §   | Pozycja                                                          | Rozstrzygnięcie                                                                                                            |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 8   | escapowanie i indeks w `search_chat_contacts` (7 × surowy ILIKE) | RPC przepisane na `discovery_search` + escapowany `LIKE`, wspólne prymitywy z katalogiem osób                              |
| 9   | fantomowe `'contacts'` w bramce (wymaga decyzji produktowej)     | `contacts` staje się realnym, czwartym poziomem prywatności; bramka ROZSTRZYGA wartość zamiast dopasowywać literał         |
| 10  | IA prywatności                                                   | trzy powierzchnie scalone w hub `/profile/privacy`; `/profile/security` zostaje przy bezpieczeństwie konta                 |
| 11  | IA finansów                                                      | grupa nawigacji „Płatności i bezpieczeństwo" (8 pozycji) rozbita: finanse 4 + nowa grupa prywatności 2; dwie trasy scalone |
| 13  | trzy przedawnione `as never`                                     | usunięte 25 castów + bramka CI, która nie pozwoli im wrócić                                                                |

---

## §8 - `search_chat_contacts`: escapowanie wzorca i indeks

**Migracja:** `20260806220000_search_chat_contacts_indexed.sql`

Stan zastany: fraza z pola wyszukiwarki szła wprost do siedmiu osobnych
predykatów `ILIKE '%' || p_query || '%'`.

Dwie wady, obie realne:

1. **Brak escapowania.** `%`, `_` i `\` trafiały do wzorca jako METAZNAKI.
   Fraza `100%` pasowała do **każdego** kontaktu (`%…%` z gołym `%` w środku to
   wzorzec „cokolwiek"), `a_b` łapało `aXb`. Ta sama klasa wady była naprawiona
   w `search_people` (20260711100000) - RPC czatu powstało miesiąc później
   i skopiowało **stary** wzorzec.
2. **Brak indeksu.** Siedem `ILIKE '%…%'` na kolumnach bazowych = siedem skanów
   sekwencyjnych `profiles` na każde naciśnięcie klawisza (zapytanie leci
   z każdą zmianą frazy w `NewChatSearch`).

Rozstrzygnięcie: czat przechodzi na tę samą ścieżkę co katalog osób - kolumnę
`profiles.discovery_search` (unaccent + lower, utrzymywana triggerem) pokrytą
częściowym indeksem GIN `pg_trgm` `WHERE discoverable`. Jedno dopasowanie
zamiast siedmiu, wzorzec escapowany, indeks używany, ranking taki sam jak
w katalogu (prefiks → podobieństwo trigramowe → alfabet).

**Międzymodułowość.** Normalizacja i escapowanie przestały być skopiowanym
wyrażeniem: `public.discovery_search_norm(text)` i `public.like_escape(text)` są
jedynym źródłem obu operacji, a `search_people` została przedefiniowana tak, by
z nich czytała. Nie ma już dwóch miejsc do rozjechania.

**Efekt uboczny, którego nie było:** diakrytyki przestają mieć znaczenie -
„Zolw" znajduje „Żółw". Katalog osób to potrafił, wyszukiwarka odbiorców czatu
nie.

**Domknięta niespójność typów.** `PersonHit` wyprowadza kształt z `search_people`
i od 20260801162647 oczekuje pola `verified`, którego `search_chat_contacts` nie
zwracało - różnicę zasłaniał cast `as PersonHit[]`. Zestaw kolumn obu RPC jest
teraz identyczny, cast zniknął, a `NewChatSearch` i `GroupMemberPicker`
pokazują odznakę weryfikacji tym samym atomem co reszta produktu.

## §9 - koniec fantomowego `'contacts'`

**Migracja:** `20260806221000_chat_privacy_contacts_level.sql`

`get_or_create_direct_conversation` przepuszczała odbiorcę, gdy jego preferencja
była w zbiorze `('everyone','contacts')` - tyle że `'contacts'` **nie było**
dozwoloną wartością: CHECK dopuszczał wyłącznie `everyone | existing | nobody`.
Literał wisiał w bramce siedem wydań, nie mógł się zapalić, a bramka była
**nieweryfikująca**: gdyby wartość kiedykolwiek trafiła do wiersza (zapis
`service_role`, rozluźnienie CHECK-a, import), rozmowa otworzyłaby się **bez
sprawdzenia jakiegokolwiek kontaktu**.

### Decyzja produktowa

Fantom nazywał funkcję, której platforma naprawdę nie miała, więc zamiast
kasować literał - domykamy go. `contacts` staje się czwartym poziomem, a cała
czwórka układa się w jeden malejący porządek:

| poziom         | kto może zacząć nowy wątek                                   |
| -------------- | ------------------------------------------------------------ |
| `everyone`     | ktokolwiek z obszaru roboczego                               |
| **`contacts`** | **wyłącznie zaakceptowana sieć kontaktów**                   |
| `existing`     | wyłącznie osoby, z którymi wątek już istnieje                |
| `nobody`       | nikt (dodatkowo wycisza przychodzące w istniejących wątkach) |

Trzy powody, dla których to zmiana produktowa, a nie kosmetyka:

1. **Kręgi dostają brakujący środek.** `filter_group_candidates` nie wymaga
   połączenia w sieci - dopraszanie do kręgu przepuszcza każdego z tenanta, o ile
   odbiorca ma `everyone`. Jedyną obroną było zejście na `existing`, czyli
   odcięcie także własnych kontaktów.
2. **Rozmowy bezpośrednie przestają kłamać etykietą.** DM i tak wymaga
   `is_connected_pair`, więc `everyone` od zawsze znaczyło tam „moja sieć".
   Teraz ustawienie mówi to, co robi, a różnica jest widoczna tam, gdzie jest
   realna: w kręgach.
3. **Bramka przestaje ufać napisowi.** Jeden predykat
   `public.chat_accepts_new_thread(_initiator, _peer)` **rozstrzyga** wartość
   (sprawdza połączenie / wspólny wątek) i jest czytany przez **obu** konsumentów -
   rozmowy bezpośrednie i kręgi. Nieznana wartość zamyka bramkę (fail-closed).

Wartość domyślna bez zmian (`everyone`) - migracja nikomu nie zacieśnia ustawień,
dokłada wybór, którego nie było. Opcja w UI, i18n PL/EN, pgTAP.

## §10 - IA prywatności

Nazwa „centrum prywatności" była na wyrost: `/profile/privacy` zawierało
wyłącznie **zgody**, a właściwe ustawienia prywatności mieszkały gdzie indziej.

| Co                                                                                                                                                             | Gdzie było                                                                               | Gdzie jest                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| widoczność w katalogu, zapytania do eksperta, kto może zacząć rozmowę, kto może zaprosić do sieci, potwierdzenia odczytu, wskaźnik pisania, status dostępności | **w środku formularza** `/profile/edit`, pod przyciskiem „Zapisz", którego nie dotyczyły | `/profile/privacy`, blok 1 |
| zgody cookie/komunikacja + rejestr RODO + GPC                                                                                                                  | `/profile/privacy`                                                                       | `/profile/privacy`, blok 2 |
| eksport danych (art. 15/20) i usunięcie konta (art. 17)                                                                                                        | `/profile/security`, między hasłem a 2FA                                                 | `/profile/privacy`, blok 3 |

Trzy bloki w kolejności rosnącej nieodwracalności: kogo wpuszczam (codziennie) →
na co się godzę (rzadko, audytowane) → co mi wydacie i jak mnie usuniecie (raz).
`/profile/security` zostaje przy bezpieczeństwie **konta**: hasło, e-mail, sesje,
dwuskładnikowe. Obie strony linkują do siebie, bo granica nie jest oczywista.

Atomic design: nowa molekuła `SettingRow` (etykieta + podpowiedź + kontrolka,
jeden zestaw odstępów i progów responsywności), dwa organizmy
`VisibilityAndContactSection` i `DataRightsSection`.

## §11 - IA finansów

Grupa nawigacji nazywała się dosłownie **„Płatności i bezpieczeństwo"** i miała
osiem pozycji, z czego dwie (`security`, `privacy`) nie mają z płatnościami nic
wspólnego, a dwie kolejne prowadziły do tej samej treści:

- `/profile/subscription` renderowało **wyłącznie** `SubscriptionManagerSection` -
  komponent, który jest już częścią huba członkostwa, a którego pełniejszy
  odpowiednik żyje na `/profile/plan`;
- `/profile/orders` i `/profile/payments` to były dwie listy tych samych
  transakcji, obie z `InvoiceLookupCard`.

| Przed                                                                                     | Po                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| jedna grupa: membership, plan, billing, subscription, orders, payments, security, privacy | **Płatności i plan**: membership, [organization], plan, payments, billing |
|                                                                                           | **Prywatność i bezpieczeństwo**: privacy, security                        |

`/profile/subscription` → przekierowanie na `/profile/plan`,
`/profile/orders` → przekierowanie na `/profile/payments` (które wchłonęło
tabelę zamówień jako `OrdersTableCard` i rejestr dokumentów - nic nie zniknęło).

Adresy w powiadomieniach, e-mailach transakcyjnych, wyszukiwarce wewnętrznej
i menu konta celują teraz w trasy **kanoniczne**, nie w przekierowania: nowy
czysty moduł `src/lib/profile/routes.ts` jest jedynym źródłem tych ścieżek.
Link wklejony w e-mailu żyje miesiącami - nie ma prawa kosztować przeskoku.

## §13 - przedawnione casty `as never`

Cast `as never` jest sankcjonowaną w repo ucieczką na czas okna między migracją
a regeneracją `src/integrations/supabase/types.ts`. Problem zaczyna się **po**
regeneracji: cast nie przestaje kompilować się sam z siebie.

Usunięte **25 castów** w 23 plikach - wszystkie na nazwy, które są w typach od
kilku wydań, część pod komentarzem „do usunięcia przy regeneracji types.ts".
Przy okazji wyszły dwa rozjazdy, które cast trzymał w ukryciu:

- `record_job_run` / `email_suppression_add` dostawały `null` tam, gdzie
  sygnatura ma argument opcjonalny - teraz przekazujemy `undefined` (PostgREST
  pomija klucz, działa `DEFAULT NULL`),
- `p_result` jest kolumną `jsonb`, a przekazywana wartość miała typ `unknown` -
  konwersja przez `toJson()` zamiast castu.

**Bramka `check:stale-never-casts`** (moduł czysty + runner + 17 testów
jednostkowych, wpięta w job `verify`) porównuje nazwę w cascie z zawartością
wygenerowanych typów: cast na nazwę **nieznaną** typom jest legalny (okno przed
regeneracją) i przechodzi, cast na nazwę **znaną** - pada z plikiem i linią.
Świadomie nie dotyka castów payloadu (granica jsonb), castów poza klientem
Supabase (router, CSS) ani plików testowych.

---

## Weryfikacja

```
vitest run                       6967 pass / 0 fail / 50 skip (636 plików)
tsc --noEmit                     czysto
eslint .                         0 błędów (137 ostrzeżeń)
bun run build                    ✓
check:bundle                     ✓ (1904,1 / 3151,2 KB gzip, największy chunk 436,1 KB)
check:chunks                     ✓ (556 chunków, acykliczny)
check:chunk-parity               ✓
check:entry-purity               ✓
check:widget-fidelity            ✓
check:stale-never-casts          ✓ (2152 pliki, 220 relacji i 393 funkcje w typach)
check:sql-tenant-scope           ✓ (570 funkcji)
check:sql-anon-insert            ✓
check:sql-migration-replay       ✓ (641 plików, zero kolizji wersji)
check:sql-owner-tenant-scope     ✓
check:sql-app-role               ✓
check:rpc-contract               ✓ (222 nazwy wołane przez klienta, 551 funkcji)
check:authz-snapshot             ✓ (po regeneracji - dryf był czysto provenance)
check:permissions-parity         ✓
check:i18n-parity                ✓
check:legacy-payment-refs        ✓
check:public-assets              ✓
check:workflow-env-contract      ✓
pgTAP plan                       ✓ (78 plików)
```

`check:db-contract` i suita pgTAP wymagają żywej bazy - nie były uruchamiane
w tej sesji. Nowy plik `supabase/tests/chat_contacts_search_and_privacy_test.sql`
(19 asercji) przechodzi statyczną bramkę planu.

**Poza zakresem, naprawione przy okazji:** jedna pusta linia w
`src/routes/profile.expert-requests.tsx` - ostatni błąd `prettier/prettier`
w repozytorium. Bramka lintu jest teraz zielona.
