# Wdrożenie: pokrycie `src/components/network` + bramka cichego rozjazdu słownika

Data: 2026-08-06 · Zakres: §12 audytu (pokrycie testowe modułu sieci kontaktów), dwa defekty i18n
wykryte przy okazji, nowa bramka CI, ratchet progów pokrycia

---

## 0. Stan zastany (zmierzony, nie zadeklarowany)

Fala poprawek testowych ominęła katalog `src/components/network`. Pomiar na HEAD przed tą zmianą:

```
 % Coverage report from v8 (--coverage.include='src/components/network/**')
-------------------|---------|----------|---------|---------|
File               | % Stmts | % Branch | % Funcs | % Lines |
-------------------|---------|----------|---------|---------|
All files          |    4.64 |     3.73 |    1.63 |    4.31 |
 AuthorMoreMenu    |       0 |        0 |       0 |       0 |
 ConnectButton     |       0 |        0 |       0 |       0 |
 DirectMessageBtn  |       0 |        0 |       0 |       0 |
 DossierFollowers  |       0 |        0 |       0 |       0 |
 EventGroupButton  |       0 |        0 |       0 |       0 |
 IntroductionsCard |       0 |        0 |       0 |       0 |
 MutualConnHint    |       0 |        0 |       0 |       0 |
 ProfileLinkButton |       0 |        0 |       0 |       0 |
 ProfileViewsCard  |       0 |        0 |       0 |       0 |
 RecommendationsS. |       0 |        0 |       0 |       0 |
 ReportUserDialog  |       0 |        0 |       0 |       0 |
 RequestIntroBtn   |      95 |    88.23 |     100 |     100 |
 RequestIntroDialog|       0 |        0 |       0 |       0 |
-------------------|---------|----------|---------|---------|
```

12 z 13 plików na zerze. Najgorszy pojedynczy przypadek: `ConnectButton.tsx` (423 linie) -
**jedna** maszyna stanów obsługująca trzy powierzchnie produktu (karta `/people`, pasek
profilu autora, sugestie `/network`), pięć stanów relacji, bramkę `canInvite` (polityka
adresata / obcy tenant / blokada), trzy dialogi potwierdzeń i mapowanie czterech wzorców
błędów RPC na osobne komunikaty. To ta warstwa, w której **prywatność cichej odmowy**
zaproszenia jest obietnicą produktu, a nie detalem UI.

To także dokładnie ta logika, w której już raz przeszedł **cichy rozjazd słownika**.

---

## 1. Dwa realne defekty i18n, znalezione przez nową bramkę

Bramka parytetu (`src/__tests__/i18nParity.gate.test.ts`) porównuje **dwa słowniki ze
sobą**: wyłapie klucz obecny w PL i brakujący w EN. Jest natomiast **strukturalnie
niezdolna** wyłapać przypadek, od którego rozjazd się zaczyna - klucza, którego nie ma
w ŻADNYM słowniku, bo w słownikach nie ma wtedy czego porównywać. Jeśli takie wywołanie
ma jeszcze `defaultValue`, nic nie wygląda na zepsute: PL renderuje polski tekst z kodu,
a EN renderuje **ten sam polski tekst**.

Dwa żywe przypadki na tej powierzchni:

| klucz                    | miejsce                                         | skutek dla `/en/*`                                                                 |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `network.mutualLinkAria` | `MutualConnectionsHint.tsx:26`                  | czytnik ekranu czytał anglojęzycznemu użytkownikowi „Zobacz 3 wspólnych kontaktów" |
| `common.more`            | `AuthorMoreMenu.tsx:35-36` (aria-label + title) | przycisk „trzy kropki" na profilu autora miał etykietę „Więcej"                    |

Naprawa:

- `network.mutualLinkAria` dodany do `src/lib/i18n-network.ts` w **pełnym zestawie form
  mnogich** (PL: `_one/_few/_many/_other`, EN: `_one/_other`) - klucz jest wołany z `count`,
  więc pojedyncza wartość byłaby drugim rozjazdem, tylko cichszym,
- `common.more` dodany do `src/lib/locale/{pl,en}.ts`,
- z wszystkich czterech wywołań na tej powierzchni usunięty `defaultValue` (także z dwóch,
  które trafiały w istniejące klucze: `common.cancel`, `network.viewProfile` - ich
  `defaultValue` nie szkodził, ale utrzymywał wzorzec, który raz już kosztował).

---

## 2. Bramka: `src/lib/ci/i18nKeyUsage.ts` + `networkI18nKeys.gate.test.ts`

Nowy, czysty moduł CI patrzy na słownik **od strony kodu** i domyka lukę opisaną wyżej.

**Skaner** (bez zależności, bez i18next, bez systemu plików - w pełni testowalny):

- `maskComments()` - zamienia komentarze na spacje z zachowaniem offsetów i linii, więc
  przykład `// t("network.old")` w komentarzu nie jest liczony jako użycie,
- `scanTranslationCalls()` - mini-parser wywołań `t(...)` z balansowaniem nawiasów: czyta
  klucz z literału, prefiks gałęzi z template literala (``t(`network.reportReasons.${r}`)``),
  a z opcji wyciąga `defaultValue` i obecność `count`. Rozpoznaje `i18n.t(...)`, nie łapie
  `at(`, `split(`, `filter(`, `fmt(`,
- `scanKeyReferences()` - ścieżki kluczy trzymane w stałych, mapach kodów RPC i propsach
  (`emptyKey="network.introductions.emptyBridge"`), ograniczone do zadanych korzeni,
- `auditKeyUsage()` - konfrontacja z drzewami PL/EN. Rozdziela trzy klasy:
  - `missing` - klucz nie istnieje w PL i/lub EN,
  - `masked` - to samo, ale **zamaskowane `defaultValue`** (klasa najgroźniejsza, bo
    przechodzi przez review niezauważona),
  - `branches` - gałąź klucza dynamicznego, której zbiory podkluczy PL i EN się różnią
    (formy mnogie normalizowane, bo PL ma `few`/`many`, a EN nie).

**Bramka** `src/components/network/__tests__/networkI18nKeys.gate.test.ts` skanuje
`src/components/network` i `src/lib/network` i wymaga trzech rzeczy:

1. każdy klucz użyty w kodzie istnieje w PL **i** w EN,
2. skan realnie widzi maszynę stanów `ConnectButton` (kanarek zasięgu - inaczej pusty skan
   byłby zielony i nic nie dowodził),
3. **żadne** wywołanie `t()` na tej powierzchni nie polega na `defaultValue`.

Bramka jest wpięta w `bun run check:i18n-parity`, czyli w istniejący, nazwany krok CI.

Dodatkowo prefiksy `network` i `directMessage` weszły do `GATED_PREFIXES` bramki parytetu:
od teraz brak wersji EN na tej powierzchni to **czerwone CI**, a nie ostrzeżenie w logu.

---

## 3. Pokrycie: 13 plików, 235 przypadków

```
 % Coverage report from v8 (po wdrożeniu)
-------------------|---------|----------|---------|---------|
All files          |   99.02 |    95.66 |     100 |     100 |
 ConnectButton.tsx |     100 |    98.82 |     100 |     100 |
-------------------|---------|----------|---------|---------|
Statements   : 99.02% ( 407/411 )   <- było 4.64%
Branches     : 95.66% ( 375/392 )   <- było 3.73%
Functions    :  100%  ( 123/123 )   <- było 1.63%
Lines        :  100%  ( 372/372 )   <- było 4.31%
```

### Architektura testów - atomic design zastosowany do warstwy testowej

`src/test/network/fixtures.ts` to zestaw **atomów** wspólnych dla trzynastu plików:

- stan relacji: `connectionState()`, `stateFor(status)`, `statusMap()`,
- atrapy zapytań: `queryStub()`, `pendingQueryStub()`, `errorQueryStub()`,
- atrapy mutacji jako **jawne wyniki**: `idleMutation()`, `pendingMutation()`,
  `succeedingMutation(data)`, `succeedingVoidMutation()`, `failingMutation(error)`,
  plus `structuralError()` do gałęzi obronnych `err instanceof Error`,
- wiersze RPC 1:1 z `Database["public"]["Functions"]`: `myConnectionRow()`,
  `policyFollowerRow()`, `introductionRow()`, `recommendationRow()`, `profileViewerRow()` -
  rozjazd kolumny w migracji wychodzi wtedy **na typach**, w każdym teście naraz,
- `translateKey()` + `reactI18nextStub()` - jedno echo klucza dla całej powierzchni, więc
  asercje trzymają się KLUCZY, a nie polskiego copy (za copy odpowiadają bramki i18n).

Efekt międzymodułowy: zmiana kontraktu warstwy danych psuje **jeden** plik atomów, nie
trzynaście plików testowych.

### Co konkretnie jest zabezpieczone (wybór)

- **Bramki widoczności** na każdej powierzchni: toggle `connections_enabled` /
  `chat_enabled` w tenancie (i to, że wyłączony moduł **nie odpytuje** RPC - zmarnowane
  zapytanie per karta listy to regresja wydajności), anon, własny profil, ładowanie.
- **`canInvite=false`** ukrywa wyłącznie ZAPROSZENIE. Nie może ukryć istniejącej relacji
  ani zaproszenia przychodzącego - trzy osobne przypadki, bo to najłatwiejsza do
  popełnienia pomyłka w tej maszynie stanów.
- **Prywatność cichej odmowy**: treść potwierdzeń („osoba nie zostanie powiadomiona"),
  filtr roli `target` w `IntroductionsCard` (widać WYŁĄCZNIE `forwarded` - prośba
  odrzucona przez most nie może wyciec do osoby docelowej), maskowanie widza w
  `ProfileViewsCard` (anonimowy widz nie dostaje nazwy, podpisu ani awatara w DOM).
- **Mapowanie błędów RPC** jako kontrakt, nie szczegół: `rate limited`, `blocked`,
  `peer not available`, `chat: expert requires request` (świadoma cisza - dialog otwiera
  bus), `chat: tier disabled` (toast z wyjściem na cennik), `no attendees`,
  8 kodów rekomendacji + nieznany kod pokazywany surowo.
- **Batch statusów**: `DossierFollowers` pyta o wszystkich obserwujących **jednym** RPC i
  nie renderuje przycisku relacji, dopóki mapy nie ma; `MutualConnectionsHint` dzieli cache
  z `ConnectButton`.
- **Layout i responsywność**: warianty `compact` (etykieta od `sm:`) i `iconOnly`
  (`h-8 w-8`), siatka `sm:grid-cols-2`, blokady przycisków w locie, `aria-busy`,
  zatrzymanie propagacji kliknięcia na kartach, które same są linkiem.

---

## 4. Poprawki produkcyjne wykonane po drodze

1. **`ConnectButton` → czat z prefillem odbiorcy.** `startChat.mutate(userId, ...)` (forma
   z gołym id) powodowała, że przy odmowie `chat: expert requires request`
   `ExpertRequestDialog` otwierał się **bez nazwy** osoby - `DirectMessageButton` w tym
   samym miejscu przekazywał `{ peerId, peerName }`. Ujednolicone do formy obiektowej;
   test tego pilnuje.
2. **Koniec rzutowań w mapperach błędów.** `(e as { message?: string })?.message ?? ""`
   w `ConnectButton`, `ReportUserDialog` i `EventGroupButton` zastąpione odczytem
   `e.message` - mutacje są typowane na `Error`, więc rzutowanie tylko zaciemniało kod
   i tworzyło martwą gałąź.
3. **Atom `ConfirmDialog` przyjmuje `onClose`, nie `onOpenChange`.** Dialog potwierdzenia
   nie otwiera się sam, więc `(open) => setConfirm(open ? "withdraw" : null)` miało ramię,
   którego Radix nigdy nie woła. Jeden kierunek zamiast trzech martwych gałęzi.
4. **Wspólny `RouterLinkStub` interpoluje `params`.** `href` w testach to teraz realny
   adres (`/author/anna-nowak`), a nie szablon (`/author/$slug`); jedna suita robiła to
   wcześniej lokalnie u siebie.

---

## 5. Progi (bramki blokujące)

```ts
// vitest.config.ts
"src/components/network/**": { statements: 97, functions: 98, lines: 98, branches: 92 },
```

Próg per-ścieżka stoi tuż pod osiągniętym poziomem. Niedobite gałęzie są **niewywoływalne**:
Radix nie woła `onOpenChange(true)` dla sterowanego dialogu, a `preventDefault` na już
zablokowanym przycisku nie ma jak się wykonać.

Ratchet globalny: floor repo podniesiony z `19.5 / 13 / 20 / 15.75` na
`29 / 22 / 29 / 25`. Pomiar całego `src/` na tym HEAD to
**32,97% / 25,77% / 33,62% / 28,49%** - stary próg był 13 pp pod rzeczywistością, więc
łapał katastrofę, a nie regresję. Margines ~4 pp zostawiony na dryf środowiska CI.
Zasada bez zmian: **ten próg wolno wyłącznie podnosić**.

---

## 6. Poza zakresem (stan zastany, nietknięty)

`src/lib/authz/__tests__/authzSnapshotParity.test.ts` jest czerwony na tym HEAD **przed**
tą zmianą: `provenance` snapshotu autoryzacji pochodzi ze starszego skanu migracji
(`migrations: 638 -> 639`, `functions: 566 -> 567`). Zamyka to regeneracja
`bun run generate:authz-snapshot` i commit wyniku - świadomie nie mieszamy tego do diffu
o pokryciu sieci kontaktów. Cała pozostała suita (646 plików, 7189 testów) jest zielona.
