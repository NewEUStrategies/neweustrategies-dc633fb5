# Rejestr własnicielstwa technicznego

`ownership.json` odpowiada na jedno pytanie: **kto odpowiada za tę trasę i za tę
migrację.** Audyt z 2026-08-29 zmierzył **193 trasy administracyjne** i **918
migracji bazy** bez wskazanego właściciela - a 631 z tych migracji (68,7%) nazywa
się UUID-em nadanym przez platformę, więc z nazwy pliku nie da się odczytać
niczego.

To jest rejestr, a nie dokument, z jednego powodu: dokument o własnicielstwie
zdezaktualizowałby się przy pierwszej nowej trasie i **nikt by tego nie
zauważył**. Rejestr pilnuje bramka `bun run check:ownership`, wpięta w
`.github/workflows/ci.yml` - nowa trasa albo migracja poza zakresem rejestru
przewraca CI tak samo jak błąd typów.

---

## 1. Mapa plików

| Plik                                     | Rola                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `governance/ownership.json`              | **Rejestr** - jedyne źródło prawdy. To tu się edytuje                |
| `governance/README.md`                   | Ten plik. Jego brak przewraca bramkę                                 |
| `src/lib/ci/ownership.ts`                | Inwariant: parsowanie, atrybucja, raport. Warstwa czysta, bez IO     |
| `src/lib/ci/__tests__/ownership.test.ts` | 59 testów inwariantu                                                 |
| `scripts/check-ownership.ts`             | Cienki runner - odczyt katalogów i kod wyjścia                       |
| `scripts/generate-codeowners.ts`         | Generator `.github/CODEOWNERS` (+ tryb `--check` bajt w bajt)        |
| `.github/CODEOWNERS`                     | **Plik generowany.** Nie edytuj ręcznie                              |
| `docs/UMOWA_UTRZYMANIOWA.md`             | Poziom usługi (SLA/OLA) dla zakresu z rejestru                       |
| `docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md`     | Co zrobić, gdy wykonawca przestaje odpowiadać                        |
| `.github/workflows/ci.yml`               | Kroki „Własnicielstwo…" i „CODEOWNERS zgodny…" w bloku tanich bramek |

---

## 2. Struktura `ownership.json`

### 2.1 Pola najwyższego poziomu

| Pole                        | Znaczenie                                                                     |
| --------------------------- | ----------------------------------------------------------------------------- |
| `meta`                      | Wersja i data rejestru. Nieczytane przez bramkę, czytane przez ludzi          |
| `kontraktUtrzymaniowy`      | Strony, daty ważności, okno ostrzegania, klasy SLA, ścieżki do obu dokumentów |
| `osoby`                     | Słownik ról i osób. Domeny wskazują **klucze** z tego słownika, nie napisy    |
| `progi`                     | Trzy zapadki (§4)                                                             |
| `identyfikatoryPrzekrojowe` | `tier2`: identyfikatory bazy, które same nie wskazują domeny (§5, warstwa 2)  |
| `domeny`                    | Tablica domen. **Kolejność jest znacząca** (§2.3)                             |

### 2.2 Pola domeny

```jsonc
{
  "slug": "wydarzenia", // identyfikator, unikalny
  "nazwa": "Wydarzenia", // nazwa dla ludzi
  "zakres": "Katalog wydarzeń, studio …", // jedno zdanie: co tu wchodzi
  "wlasciciel": "wt-nieobsadzony", // KLUCZ z `osoby`
  "zastepca": "zastepca-nieobsadzony", // KLUCZ z `osoby`, MUSI być inny niż właściciel
  "eskalacja": "organizacja-nes", // KLUCZ z `osoby`
  "klasaSla": "sla-1", // klucz z `kontraktUtrzymaniowy.klasySla`
  "zespolGithub": "@NewEUStrategies/utrzymanie-wydarzenia",
  "trasy": ["admin.events_.$eventId.*", "admin.events.*"], // wzorce nazw plików
  "obiektyBazy": ["event_", "meeting_", "rsvp_"], // prefiksy identyfikatorów SQL
}
```

### 2.3 KOLEJNOŚĆ DOMEN JEST ZNACZĄCA

Kolejność w tablicy `domeny` rozstrzyga **dwie różne rzeczy naraz**:

1. **nakładające się wzorce tras** - wygrywa pierwsza domena, która trafi;
2. **remisy punktacji migracji** - przy równym wyniku wygrywa domena wcześniejsza.

Stąd dwie zasady:

- **domeny wąskie stoją PRZED szerokimi.** `zgodnosc-i-prywatnosc` (wzorce
  dokładne `admin.settings.privacy.tsx`, `admin.settings.cookie-banner.tsx`)
  musi stać przed `tozsamosc-i-uprawnienia` (wzorzec `admin.settings.*`).
  Przy odwrotnej kolejności - zmierzone - `zgodnosc-i-prywatnosc` dostaje **0 tras**;
- **domena przekrojowa stoi OSTATNIA.** `platforma-i-baza` jest jednocześnie
  kubłem dla migracji, w których nic konkretnego nie trafiło (§5, warstwa 3).

### 2.4 Semantyka wzorców

**Trasy** (`trasy`) - dopasowanie do **całej nazwy pliku** w `src/routes/`:

| Zapis                 | Znaczenie                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| `*`                   | dowolny ciąg znaków                                                     |
| `.` `$` `_` `-`       | **znaki literalne**, nie metaznaki                                      |
| `admin.events.*`      | łapie `admin.events.list.tsx`, **nie** łapie `admin.events_.$eventId.…` |
| `admin.billing*`      | bez kropki - łapie też `admin.billing-audit.tsx`                        |
| `admin.users.$id.tsx` | wzorzec dokładny; `$` to część nazwy trasy dynamicznej                  |

Kropka jest literalna, bo w routingu plikowym TanStack Start kropka to separator
segmentu URL - gdyby była metaznakiem, `admin.events.*` połknęłoby studio
wydarzenia, które celowo siedzi pod `admin.events_.`.

**Obiekty bazy** (`obiektyBazy`) - dopasowanie do identyfikatorów SQL:

| Zapis            | Znaczenie                                                     |
| ---------------- | ------------------------------------------------------------- |
| `club_`          | dopasowanie **prefiksowe**: `club_members`, `club_threads`, … |
| `plan_interval$` | dopasowanie **dokładne** (dolar na końcu)                     |
| —                | **najdłuższy klucz wygrywa**: `post_gift_` bije `post_`       |

Przed dopasowaniem z identyfikatora zdejmowane są ogólne opakowania czasownikowe
(`admin_`, `get_`, `is_`, `tg_`, `backfill_`, …), żeby `admin_get_post_stats`
trafiło w `post_`. Ten sam prefiks **nie może** należeć do dwóch domen - bramka
odrzuca taki rejestr.

---

## 3. Najczęstsze sytuacje

### 3.1 Dodaję trasę admina, bramka mówi „TRASY BEZ WŁAŚCICIELA"

Dopisz wzorzec do `trasy` właściwej domeny. Jeśli trasa pasuje do istniejącego
wzorca z gwiazdką - nie musisz robić nic; komunikat oznacza, że nie pasuje.
Wybierz domenę po tym, **kto ma naprawiać tę stronę o 3 w nocy**, nie po tym,
gdzie plik leży alfabetycznie.

### 3.2 Dodaję migrację

Zwykle nic nie robisz: migracja dotykająca istniejących tabel trafia w istniejący
prefiks. Prefiks dopisujesz do `obiektyBazy`, gdy **wprowadzasz nową rodzinę
tabel** (np. `webinar_*`) - inaczej migracja albo wpadnie do kubła
`platforma-i-baza`, albo, co gorsza, zostanie przypisana do przypadkowej domeny
przez poboczne odwołanie. Po dopisaniu uruchom `bun run check:ownership` i
sprawdź, czy liczba migracji w Twojej domenie wzrosła o tyle, ile oczekujesz.

### 3.3 Obsadzam właściciela domeny

Cztery kroki, wszystkie wymagane:

1. w `osoby` uzupełnij wpis: `rola`, `organizacja`, `kontakt`, `github`,
   `zrodlo`, a `obsadzone` ustaw na `true`;
2. wskaż ten klucz w `wlasciciel` domeny (i osobny klucz w `zastepca` -
   **właściciel nie może być własnym zastępcą**, bramka to odrzuca);
3. **OBNIŻ** `progi.domenyBezWlasciciela` o tyle, ile domen właśnie obsadziłeś;
4. `bun run generate:codeowners` - reguły obsadzonych domen przestaną być
   zakomentowane.

Krok 3 jest istotą zapadki: bez niego obsadzenie nie zostawia śladu i liczba może
po cichu wrócić w górę.

Bramka odrzuca **obsadzenie pozorne**: wpis z `obsadzone: true` musi mieć
niepuste `kontakt` i organizację inną niż `NIEOBSADZONE`. Bez tego samo
przestawienie booleana przy wpisie-zaślepce oznaczyłoby wszystkie 9 domen jako
mające właściciela, bo wszystkie wskazują ten jeden wpis.

### 3.4 Dodaję domenę

Nowy wpis w `domeny` musi mieć **niepustą** listę tras albo obiektów bazy -
domena, która nie pokrywa niczego, jest odrzucana przy parsowaniu. Wstaw ją we
właściwym miejscu kolejności (§2.3) i pamiętaj, że jeśli nie obsadzasz od razu
właściciela, `progi.domenyBezWlasciciela` musi wzrosnąć - a **podniesienie progu
jest regresją własnicielstwa**, nie rutynową zmianą.

### 3.5 Usuwam trasę, bramka mówi „MARTWE REGUŁY"

Wzorzec, który nie trafia już w żaden plik, jest zgnilizną rejestru. Usuń go z
`trasy` (albo prefiks z `obiektyBazy`) i przegeneruj CODEOWNERS. To jedno
usunięcie linii, a chroni przed rejestrem opisującym system sprzed roku.

---

## 4. Progi (zapadki)

| Próg                            |             Dziś | Co znaczy                                                                                                                                              | Wolno ruszać     |
| ------------------------------- | ---------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `domenyBezWlasciciela`          |            **9** | Ile domen może nie mieć obsadzonego właściciela                                                                                                        | **tylko w dół**  |
| `migracjeBezAtrybucjiDozwolone` | **lista 5 nazw** | Migracje, o których wiadomo, że heurystyka ich nie rozstrzygnie (§5.1). **Lista, nie liczba** - dzięki temu komunikat pokazuje wyłącznie migracje NOWE | **tylko krócej** |
| `martweWzorceTras`              |            **0** | Ile wzorców TRAS może nie trafiać w żaden plik. Prefiksy bazy są tylko ostrzeżeniem - patrz niżej                                                      | **tylko w dół**  |

Martwy **prefiks bazy** NIE blokuje - jest tylko ostrzeżeniem. Prefiks opisuje
rodzinę tabel, a nie plik: po spłaszczeniu albo przycięciu historii migracji
reguła przestaje trafiać, choć tabele istnieją i mają właściciela. Kasowanie jej
na polecenie bramki niszczyłoby poprawną informację.

**Czego zapadki NIE robią:** nic w repo nie porównuje ich z wartością z gałęzi
bazowej, więc podniesienie progu w tym samym commicie, który psuje pokrycie,
przejdzie przez bramkę. Zapadka jest konwencją wspartą przeglądem PR-a, nie
inwariantem maszynowym.

To ta sama zasada, którą repo stosuje do progów pokrycia w `vitest.config.ts`
(„ten próg wolno wyłącznie podnosić" - tam wyżej znaczy lepiej, tu niżej).
Podniesienie któregokolwiek z tych progów jest **regresją własnicielstwa** i
wymaga decyzji Zamawiającego opisanej w `docs/UMOWA_UTRZYMANIOWA.md`.

---

## 5. Jak działa atrybucja migracji

Cztery warstwy; każda uruchamia się dopiero wtedy, gdy poprzednia nic nie znalazła.

| Warstwa            | Co robi                                                                                  | Dziś |
| ------------------ | ---------------------------------------------------------------------------------------- | ---: |
| 1 `identyfikatory` | Identyfikatory specyficzne, ważone rzadkością `1/log2(1+df)`; wygrywa domena z max. sumą |  893 |
| 1.5 `literaly`     | Skan surowego tekstu po nazwach ≥ 8 znaków - dla `DO $$` i dynamicznego SQL              |    3 |
| 2 `przekrojowe`    | Dopiero teraz `tier2` (`profiles`, `tenants`, `has_role`, …) jako sygnał słaby           |   18 |
| 3 `brak`           | Brak trafienia → ostatnia domena rejestru                                                |    5 |

Identyfikatory występujące w ponad 20% migracji są w warstwie 1 **pomijane** -
inaczej `profiles` (329 plików) przegłosowałby wszystko. Nie są jednak
wyrzucane, tylko odłożone do warstwy 2: migracja robiąca wyłącznie
`GRANT … ON public.profiles` należy do tożsamości, a nie do kubła „nie wiadomo".

### 5.1 Czego bramka NIE gwarantuje

**Gwarantuje pokrycie, nie trafność.** Reguła jest heurystyką po identyfikatorach
SQL. Dziś **221 z 918** atrybucji jest „słabych" - rozstrzygniętych jednym
identyfikatorem. Raport podaje tę liczbę w każdym przebiegu właśnie po to, żeby
nie chować jej za zieloną bramką.

Ręczna weryfikacja pojedynczego pliku: zobacz, jakie obiekty rusza
(`grep -oE '(public|storage|auth)\.[a-z_]+' supabase/migrations/<plik>.sql | sort -u`),
i sprawdź, do której domeny należą ich prefiksy.

---

## 6. `.github/CODEOWNERS` - dlaczego wszystko jest zakomentowane

Bo zespoły `@NewEUStrategies/utrzymanie-*` **nie istnieją jeszcze w
organizacji**, a aktywna reguła CODEOWNERS wskazująca nieistniejący zespół
zablokowałaby **każdy** merge przy ochronie gałęzi z opcją „Require review from
Code Owners". Bramka własnicielska nie ma prawa zatrzymać wydania.

Kolejność aktywacji: załóż zespół → `obsadzone: true` w rejestrze →
`bun run generate:codeowners` → obniż próg (§3.3).

**Domeny są w tym pliku wypisane w kolejności ODWROTNEJ niż w rejestrze i nie
jest to pomyłka.** GitHub rozstrzyga nakładające się wzorce regułą OSTATNIEGO
trafienia, a rejestr regułą PIERWSZEGO. Emisja „po kolei" dałaby plik kierujący
przeglądy dokładnie odwrotnie, niż mówi rejestr. Nie sortuj CODEOWNERS.

Plik pokrywa **wyłącznie trasy**. Migracji nie da się w nim wyrazić: nazwy to
znaczniki czasu i UUID-y, więc nie istnieje wzorzec ścieżki oddzielający domeny.
Własnicielstwo migracji egzekwuje `check:ownership`, nie CODEOWNERS.

### 6.1 Wzorzec-łapacz

Bramka odrzuca pojedynczy wzorzec tras biorący ponad **40%** wszystkich tras.
Bez tego progu całą bramkę tras da się uciszyć jedną linią (`admin.*` w dowolnej
domenie: 100% pokrycia, zero informacji). Najszerszy uczciwy wzorzec w tym
rejestrze (`admin.events_.$eventId.*`) bierze 20,2%, więc zapas jest dwukrotny.

---

## 7. Komendy

| Komenda                       | Co robi                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `bun run check:ownership`     | Bramka. ~0,6 s, czyta wyłącznie pliki repo                         |
| `bun run generate:codeowners` | Przegenerowuje `.github/CODEOWNERS` z rejestru                     |
| `bun run check:codeowners`    | Sprawdza CODEOWNERS bajt w bajt względem rejestru                  |
| `bun run verify:static`       | Cały zestaw tanich bramek - obie powyższe wchodzą tu automatycznie |

**Nowa bramka `check:*` MUSI zostać wpięta krokiem w `.github/workflows/ci.yml`** -
inaczej oblewa meta-bramka `check:gate-coverage`, i to w każdym innym przebiegu,
w którym jeszcze jest. Wpięcie dwa razy w tym samym jobie oblewa tak samo.
