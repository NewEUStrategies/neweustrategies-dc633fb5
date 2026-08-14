# Audyt platformy NES — moduły, funkcje, połączenia międzymodułowe — 2026-08-14

**HEAD:** `0fd4108` (gałąź `claude/audyt-modulow-funkcji-xfsq1o`)
**Poprzedni audyt:** `docs/AUDYT_PLATFORMY_MODULY_FUNKCJE_2026-08-13.md` na `94eb31a`
**Delta `94eb31a..0fd4108`:** 157 commitów, 347 plików, +20 056 / −2 711 linii

Ten audyt jest **pomiarem, nie przeglądem**. Każda liczba niżej pochodzi z komendy
uruchomionej na tym HEAD w tej sesji — łącznie z pełnym `bun install` (przepięcie
lockfile na publiczny npm, dokładnie tak jak robi to CI), `tsc --noEmit`, `eslint .`,
`vitest run --coverage`, pełnym `vite build` i 17 bramkami `check:*`. Tam, gdzie
pomiaru **nie dało się** wykonać w tym kontenerze, jest to napisane wprost zamiast
przepisania progu z kodu.

**Najważniejsze zdanie tego audytu:** poprzedni audyt zamknął swoją rekomendację
numer jeden (martwy kod: 171 → 0, flagi `tsc` włączone) i numer dwa (chunk wejściowy:
słownik klubów wyjęty, −44 KB gzip na największym chunku). W tym samym czasie **CI
zrobiło się czerwone na czterech blokujących krokach** — wszystkie trzy przyczyny
weszły dzisiaj, z modułem rekrutacji.

---

## 0. Korekta do wcześniejszych ustaleń

Audyt, który nie poprawia własnych błędów, jest kolejnym źródłem dryfu. Jedna liczba
podawana wczoraj — i powtarzana jako wskaźnik jakości — była nieprawdziwa.

### 0.1. „439 371 linii kodu produkcyjnego" — testy odjęte DWA RAZY

Wczorajszy audyt podał: *„Kod produkcyjny | 439 371 linii (537 283 − 97 912 testów)"*.
Odtworzyłem obie składowe na `94eb31a`:

| Metoda liczenia na `94eb31a` | Wynik |
|---|---:|
`src/**/*.{ts,tsx}`, wszystkie pliki | 628 573 |
`src/**/*.{ts,tsx}` **bez katalogów `__tests__`** | **537 283** ← liczba z tamtego audytu |
`src/**/*.{ts,tsx}` bez `__tests__` **i** bez `*.test.*` / `*.spec.*` | **530 661** |
linie plików testowych łącznie | 97 912 |
z tego linie testów **wewnątrz** katalogów `__tests__` | 91 290 |

Składnik `537 283` **już nie zawierał** testów — 91 290 ze 97 912 linii testowych
siedzi w katalogach `__tests__`, które ta metoda pomija. Odjęcie od niej pełnych
`97 912` usunęło drugi raz linie, których tam nigdy nie było.

**Stan faktyczny: 530 661 linii produkcyjnych na `94eb31a`, 539 919 na tym HEAD.**
Zaniżenie wynosiło 91 290 linii, czyli 17%.

Skutek dla wniosku: stosunek testów do produkcji to nie **0,22**, tylko **0,185**
wczoraj i **0,187** dzisiaj. Kierunek wniosku z §4 tamtego audytu („nierówno
rozłożone") się nie zmienia — poziom tak, i to w gorszą stronę.

Przyczyna błędu jest ta sama, co w trzech korektach z tamtego dokumentu: **dwie
miary policzone różnymi filtrami zostały odjęte tak, jakby miały wspólną podstawę.**

### 0.2. Trzy różnice, które NIE są korektami — tylko inną metodą

Zapisuję je, żeby następny audyt nie zgłosił „regresji", która jest artefaktem
parsera:

| Miara | Wczoraj | Dzisiaj (moja metoda) | Skąd różnica |
|---|---:|---:|---|
Tabele | 252 | **244 żywe** (254 `CREATE`) | odejmuję `DROP TABLE`; forward-only migracje tworzą i kasują |
Funkcje SQL | 732 | **790** | liczę ostatnią definicję każdej nazwy, także funkcji triggerowych |
`SECURITY DEFINER` | 624 | **709** | j.w.; **obie metody zgodne w tym, co ważne: 0 bez przypiętego `search_path`** |

---

## 1. Skala platformy — stan zmierzony

| Wymiar | Liczba | Zmiana od 13.08 |
|---|---:|---|
Trasy (`src/routes/*.tsx`) | **244** (142 admin, 20 kluby, 82 pozostałe) | +3 |
Trasy-endpointy (`src/routes/**/*.ts`) | 22 (w tym 4 pod `api/`) | — |
Komponenty `.tsx` (bez testów) | 1 101 | +16 |
Moduły `src/lib/*.ts` (bez testów) | 977 | +22 |
Hooki | 39 | 0 |
Pliki `*.functions.ts` | 82 | 0 |
Wywołania `createServerFn` | **349** | 0 |
Moduły `*.server.ts` | 98 | +1 |
Unikalne nazwy RPC wołane z klienta | **380** (wg `check:rpc-contract`) | −2 |
Migracje SQL | **769** (138 587 linii) | +9 |
Tabele (żywe) | 244 | — |
Funkcje SQL (ostatnia definicja) | **790** | — |
Polityki RLS | 570 unikalnych nazw, **556 w stanie końcowym** | — |
Triggery / indeksy / widoki | 356 / 535 / 16 | — |
Zadania `pg_cron` | **19** | — |
Testy pgTAP | 91 plików | +1 |
Pliki testowe vitest (w `src`) | **758** | +21 |
Słowniki i18n (`src/lib/i18n-*.ts`) | 87 | +1 |
Bramki `check:*` | **25** | **+4** |
Workflow CI | 5 | 0 |
**Kod produkcyjny** | **539 919 linii** | +9 258 |
**Linie testów** | **101 109** | +3 197 |

Stosunek testów do produkcji: **0,187**. Patrz §0.1 — poprzednia wartość 0,22 była
policzona na zaniżonym mianowniku.

Cztery nowe bramki od wczoraj: `check:careers-harness`, `check:db-row-casts`,
`check:i18n-hardcoded`, `check:types-freshness`. Żadna nie została usunięta.

---

## 2. Mapa modułów i połączeń — zmierzony graf importów

Graf zbudowany z faktycznych krawędzi `from "@/…"` w **2 491 plikach produkcyjnych**,
39 warstw: **473 unikalne pary warstw, 6 491 importów międzywarstwowych** z 8 328
importów `@/` ogółem.

### 2.1. Najsilniejsze zależności (warstwowo)

```
450  trasy admin        -> design system
233  kluby              -> design system
205  builder            -> design system
200  trasy publiczne    -> seo
175  trasy publiczne    -> lib (wspólne)
164  admin (reszta)     -> design system
146  trasy publiczne    -> design system
138  trasy kluby        -> kluby
133  bloki              -> design system
128  trasy admin        -> lib (wspólne)
121  trasy admin        -> admin (reszta)
104  monetyzacja        -> design system
 95  kluby              -> i18n (rdzeń)
 85  trasy publiczne    -> monetyzacja
```

Kształt jest ten sam, co wczoraj i nadal zdrowy: **wszystko ciąży do design systemu
i do `lib`**, czyli do warstw bez własnej domeny. Nie ma modułu domenowego, od
którego zależy pół platformy.

### 2.2. Zależności między modułami DOMENOWYMI

```
 95  kluby        -> i18n (rdzeń)     10  builder -> monetyzacja
 28  bloki        -> builder          10  reklamy/popupy -> builder
 18  bloki        -> treść            10  newsletter -> i18n
 17  builder      -> typy specjalne    9  kluby -> seo
 16  builder      -> bloki             9  reklamy/popupy -> newsletter
 15  treść        -> builder           8  kluby -> społeczność
 14  treść        -> bloki             7  kluby -> sieć
 13  mail         -> i18n (rdzeń)      7  sieć -> społeczność
 12  motyw        -> builder           6  sieć -> czat
 10  builder      -> motyw             6  monetyzacja -> mail
```

### 2.3. Sprzężenia dwukierunkowe (24 pary — było 11)

Liczba par urosła, ale **nie dlatego, że przybyło cykli** — dlatego, że mój podział
na warstwy jest drobniejszy niż wczorajszy (39 warstw zamiast 22; `sieć` i `eksperci`
osobno, `realtime` osobno od `powiadomień`, `typy specjalne` wydzielone). Istotne są
cztery:

| Para | Kierunki | Ocena |
|---|---|---|
`bloki ↔ builder` | **28 / 16** | **Nadal jedyny realny cykl i nadal rośnie** (13.08: 23/17). Dwa silniki treści dzielą typy widgetów i renderery; żaden nie jest jednoznacznie „niżej". |
`bloki ↔ treść` | **18 / 14** | **Nowa pozycja do rozstrzygnięcia.** Wczoraj było 11/2 przy jasnym kierunku dominującym. Dziś obie strony ważą tyle samo — to przestało być importem typu. |
`builder ↔ typy specjalne` | 17 / 4 | Widgety wydarzeń/trackera w builderze; kierunek dominujący jasny. |
`builder ↔ motyw` | 10 / 12 | Symetryczne. Do obserwacji — jeszcze nie problem, ale przestało być jednostronne. |

Pozostałe 20 par ma wagę 1–5 w słabszym kierunku, czyli import typu albo jednej
stałej.

**Wniosek:** `bloki ↔ builder` jest wskazywany do rozstrzygnięcia od wydania z 30.07
i przez te dwa tygodnie urósł, zamiast zmaleć; `bloki ↔ treść` dołączył do niego
w ciągu jednej doby. To ten sam koszt, tylko płacony w drugim miejscu.

### 2.4. Naruszenia warstwowości — stan bez zmian

1. **`.server.ts` importowane z komponentu: 0.** Sprawdzone bezpośrednio na
   `src/components` — zero trafień.
2. **Dwie trasy importują `.server`** — obie przez `import type`, czyli znikają przy
   kompilacji. Nie ma przecieku serwera do klienta.
3. **Pięć tras publicznych importuje z `@/components/admin/…`** — dokładnie ten sam
   zestaw, co wczoraj: `index.tsx` i `checkout.success.tsx` (zamierzone — widoki
   składane builderem) oraz `club.$clubSlug.{about,members,new}.tsx → ClubEnumSelect`
   (**błąd ulokowania**: komponent jest liściem, ale mieszka pod
   `components/admin/clubs/molecules/`, choć obsługuje powierzchnię publiczną).

   **R6 z poprzedniego audytu nie została wykonana.** Koszt jej niewykonania jest
   nadal zerowy bundlowo i nadal rośnie tylko w wymiarze „ktoś kiedyś dołoży do tego
   pliku zależność, która nie będzie liściem".

---

## 3. Stan bramek — CI jest CZERWONE na czterech blokujących krokach

Wszystko zmierzone na tym HEAD, w środowisku odtworzonym procedurą z `ci.yml`
(przepięcie `bun.lock` na `registry.npmjs.org` + `bun install`).

| Bramka | Stan | Uwaga |
|---|---|---|
`tsc --noEmit` | **0 błędów** ✅ | i to **z włączonymi** `noUnusedLocals` + `noUnusedParameters` |
`vitest run --coverage` | **2 testy czerwone** ❌ | 8 258 zielonych, 50 pominiętych, 755/758 plików zielonych |
Pokrycie | **32,69% instr. / 28,44% gał. / 25,24% funkcji / 33,27% linii** ✅ | progi 29 / 25 / 22 / 29 — margines 3,2–4,3 pp; 26 progów per-ścieżka |
`eslint .` | **115 błędów** ❌, 176 ostrzeżeń | wszystkie 115 to `prettier/prettier`; lint **blokuje merge** (`ci.yml:186`) |
`check:sql-migration-replay` | **CZERWONA** ❌ | dwie pary bliźniaków treści |
`check:legacy-payment-refs` | **CZERWONA** ❌ | 1 żywa referencja do poprzedniego operatora |
`check:bundle` | zielona ⚠️ | ale zapas 0,76% / 0,93% — patrz §5 |
`check:chunks` | zielona | 674 chunki, 3 384 krawędzi, graf acykliczny |
`check:chunk-parity` | zielona | 3 asercje |
`check:entry-purity` | **niemierzalna w tym kontenerze** | patrz §3.2 — istota sprawdzona ręcznie i jest czysta |
`check:sql-tenant-scope` | zielona | 835 funkcji zbadanych, 4 uzasadnione ścieżki publiczne |
`check:sql-app-role` | zielona | 962 literały `has_role` |
`check:sql-anon-insert` | zielona | 556 polityk w stanie końcowym, 8 tabel intake chronionych |
`check:sql-owner-tenant-scope` | zielona | 153 polityki właściciela z 556 |
`check:sql-emit-actor` | zielona | 769 plików |
`check:rpc-contract` | zielona | 380 nazw z klienta ⇄ 794 funkcje w stanie końcowym |
`check:authz-snapshot` | zielona | snapshot zgodny z migracjami |
`check:types-freshness` | zielona | 28 znanych kolumn poza typami (baseline 28) |
`check:db-row-casts` | zielona | 22 wyjątki na liście (ratchet) |
`check:i18n-hardcoded` | zielona | 1 593 znane wystąpienia w 156 plikach (ratchet) |
`check:stale-never-casts` | zielona | 2 489 plików |
`check:workflow-env-contract` | zielona | 45 deklaracji ⇄ 108 nazw |
`check:public-assets` | zielona | brak plików przesłaniających trasy |
CI `ci.yml` | 4 joby + post-deploy | **47 nazwanych kroków** |

### 3.1. Trzy przyczyny czterech czerwonych kroków — wszystkie z dzisiaj

**Przyczyna 1: dwie migracje rekrutacji wjechały dwa razy.** To zapala jednocześnie
`check:sql-migration-replay` **i** dwa testy w suicie (`migrationReplay.test.ts`),
czyli dwa blokujące kroki z jednego defektu:

```
20260814100000_careers_tenant_scope.sql              (a75db79, "Rekrutacja: …")
20260814122639_37dcf7c4-…-e5d17f909f1d.sql           (5d08f50, "Work in progress")

20260814110000_careers_pipeline_and_cv_retention.sql (a75db79)
20260814123014_97f305de-…-e5d17f909f1d.sql           (5d08f50)
```

Pliki nie są bajtowo identyczne — **duplikat jest oryginałem pozbawionym nagłówka
komentarza.** W parze pierwszej: 207 linii vs 153, a 27 usuniętych linii to dokładnie
ten opis przyczyny, który §8 poprzedniego audytu wskazywał jako mocną stronę repo
(„komentarze zapisują PRZYCZYNĘ, nie treść"). Zginął opis tego, że `career_roles`
nie miało `tenant_id`, że `slug` był unikalny globalnie i że polityka bucketu
`career-cv` pozwalała redaktorowi najemcy A odczytać KAŻDE CV każdego najemcy.

Baza to przeżyje (migracje są idempotentne). Przeżyje też człowiek, który za miesiąc
będzie datował regresję — ale zrobi to na podstawie historii, która kłamie o tym,
kiedy zmiana weszła.

Warto rozdzielić dwie rzeczy, które łatwo pomylić: **sam gate pokrycia jest zielony**
(32,69 / 28,44 / 25,24 / 33,27 przy progach 29 / 25 / 22 / 29 — margines 3,2–4,3 pp).
Suita jest czerwona wyłącznie na tych dwóch testach; po ich wyłączeniu przechodzi
w całości: 8 235 zielonych, 755 plików, `EXIT=0`. Czyli to nie jest erozja pokrycia,
tylko jeden defekt w migracjach, który zapala dwie bramki naraz — właśnie dlatego,
że repo ma na tę klasę **i** bramkę statyczną, **i** test.

**Przyczyna 2: 115 błędów formatowania.** Wszystkie to `prettier/prettier`, czyli
klasa w 100% naprawialna przez `--fix`. Rozkład pokazuje, skąd przyszły:

| Plik | Błędów |
|---|---:|
`src/lib/careers/applicationSchema.ts` | **48** |
`src/lib/builder/__tests__/animatedHeadingLinks.test.ts` | 10 |
`src/components/careers/organisms/CareersRoles.tsx` | 4 |
`src/routes/admin.hiring.tsx` | 3 |
pozostałe (~25 plików) | ~50 |

Warto zestawić z commitem `96e25b3` sprzed kilku dni: *„Naprawiono odziedziczoną
czerwień bramki lintu: 201 błędów formatowania"*. Bramka została wyczyszczona
i w ciągu kilku dni zebrała 115 nowych błędów w większości z jednego modułu. To nie
jest problem lintu — to jest problem tego, że **moduł rekrutacji wszedł bez
przepuszczenia przez bramki, które istnieją**.

**Przyczyna 3: jedna żywa referencja do poprzedniego operatora płatności.**

```
scripts/check-generated-types-freshness.ts:41  "member_organizations.paddle_subscription_id",
```

To wpis na liście `BASELINE` **innej** bramki (`check:types-freshness`). Dopóki stoi,
`check:legacy-payment-refs` jest czerwona — a to bramka, której jedynym zadaniem jest
pilnowanie, że migracja z Paddle na Stripe nie ma żywych ogonów.

**Ta naprawa NIE jest jednolinijkowa i wygląda na pułapkę.** Dwie bramki trzymają ten
sam string w przeciwnych kierunkach:

1. `member_organizations.paddle_subscription_id` został dodany
   (`20260729204314`), a potem **przemianowany** na `provider_subscription_id`
   (`20260805134721_f2e69df5…`) — nigdy nie `DROP`-nięty.
2. `scanColumnEvents()` w `src/lib/ci/generatedTypesFreshness.ts:89` czyta
   **wyłącznie `ADD COLUMN` i `DROP COLUMN`** — `RENAME COLUMN` nie występuje
   w tym pliku w ogóle. Stara nazwa zostaje więc na liście kolumn „żywych".
3. W `src/integrations/supabase/types.ts` starej nazwy nie ma (jest za to
   `provider_subscription_id`, 12 wystąpień), więc `findStaleColumns()` raportuje
   ją jako dług typów.
4. `compareWithBaseline()` wymaga **dokładnej** zgodności: `freshnessFailed()` jest
   prawdziwe zarówno gdy `fresh.length > 0` (nowa nieznana kolumna), jak i gdy
   `resolved.length > 0` (wpis w baseline, który przestał być długiem).

Skutek: **usunięcie albo zakomentowanie tego wpisu zamienia jedną czerwoną bramkę
na drugą.** `check:legacy-payment-refs` zzielenieje, a `check:types-freshness`
zapali się na `fresh`. Bramka `check:legacy-payment-refs` nie ma też listy wyjątków —
ma wyłącznie `SKIP_DIRS` do pomijania katalogów przy skanie.

Poprawna naprawa jest dwuczęściowa i musi wejść razem: **nauczyć `scanColumnEvents()`
składni `RENAME COLUMN`** (stara nazwa znika z „żywych", nowa wchodzi), a następnie
**usunąć zdezaktualizowany wpis z `BASELINE`**. Wtedy obie bramki są zielone
z właściwego powodu, a nie przez przesunięcie stringa. `provider_subscription_id`
jest już w wygenerowanych typach, więc nie pojawi się jako nowy dług.

### 3.2. `check:entry-purity` — czego NIE dało się zmierzyć i co zmierzyłem zamiast tego

Bramka szuka manifestu TanStack Start w `.output/server`, żeby ustalić chunki
ścieżki bootowania. W tym kontenerze `vite build` przechodzi obie fazy (klient
1 m 04 s, SSR 46 s), ale nitro nie składa finalnego `.output/server` — katalog jest
pusty, więc bramka kończy się komunikatem „nie udało się ustalić chunku startowego".
**To jest ograniczenie środowiska, nie czerwona bramka.**

Istotę sprawdziłem ręcznie, bo to jedno grep: marker `js.stripe.com` występuje
w **dokładnie jednym chunku klienta** (`index-DNxVuv8d.js`) i **nie ma go w żadnym
z dwóch chunków `index-*` ścieżki wejściowej**. Inwariant, którego bramka pilnuje —
SDK płatności poza ścieżką bootowania — jest zachowany.

### 3.3. Co bramki naprawdę pilnują

Zestaw pozostaje nietypowo mocny: 9 z 25 bramek pilnuje inwariantów SQL i uprawnień
(wielodostępność, zakres właściciela, wstawianie przez anonima, pozycja aktora
w zdarzeniach domenowych, kontrakt RPC klient⇄migracje, świeżość typów, kształty
wierszy za rzutowaniami). Cztery nowe bramki od wczoraj idą w tę samą stronę.

**Luka, która została zamknięta:** wczorajsze „nie ma bramki na martwy kod" już nie
obowiązuje — `tsconfig.json` ma `noUnusedLocals: true` i `noUnusedParameters: true`,
a `tsc` przechodzi na zero. Patrz §6.2.

**Luka, która pozostaje:** `check:entry-purity` nadal pilnuje **obecności** SDK
płatności, a nie **rozmiaru** chunku wejściowego.

---

## 4. Moduły — rozmiar, gęstość testów, powierzchnia serwerowa

Kolumna **T/P** to linie testów na linię kodu produkcyjnego. Taksonomia jest moja
i jawna (wzorce ścieżek w §9), więc kolumna „T/P 13.08" pochodzi z **tego samego
skryptu puszczonego na `94eb31a`**, a nie z przepisania tabeli z tamtego dokumentu —
inaczej porównywałbym dwie różne definicje modułu.

| Moduł | Plików | Linii | Δ linii | Testów | Linii T | **T/P** | T/P 13.08 | `.fn` | `.srv` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
builder | 257 | 72 516 | +717 | 144 | 25 416 | 0,35 | 0,35 | 0 | 0 |
kluby | 204 | 48 602 | **+3 273** | 47 | 5 212 | **0,11** | 0,11 | 4 | 0 |
bloki | 207 | 36 273 | −169 | 44 | 4 942 | **0,14** | 0,14 | 0 | 0 |
monetyzacja | 169 | 28 248 | +349 | 51 | 9 005 | 0,32 | 0,32 | 13 | 39 |
profil | 70 | 16 307 | −8 | 23 | 2 851 | 0,17 | 0,17 | 3 | 1 |
analityka | 79 | 16 126 | −2 | 19 | 2 210 | **0,14** | 0,14 | 9 | 2 |
platforma | 81 | 14 993 | +208 | 35 | 4 492 | 0,30 | 0,30 | 1 | 27 |
newsletter | 52 | 13 088 | +804 | 10 | 1 082 | **0,08** | 0,08 | 0 | 2 |
czat | 64 | 12 995 | −2 | 17 | 1 733 | **0,13** | 0,13 | 0 | 0 |
sieć + eksperci | 53 | 10 105 | +27 | 30 | 6 326 | **0,63** | 0,63 | 1 | 0 |
design system | 98 | 9 546 | +41 | 8 | 720 | 0,08 | 0,07 | 0 | 0 |
crm | 32 | 8 986 | **+1 163** | 9 | 1 036 | **0,12** | 0,11 | 0 | 0 |
treść / wpisy | 66 | 8 502 | +59 | 31 | 3 093 | 0,36 | 0,36 | 5 | 0 |
seo | 48 | 7 181 | +107 | 35 | 3 622 | **0,50** | 0,49 | 1 | 2 |
typy specjalne | 48 | 6 385 | −22 | 14 | 1 424 | 0,22 | 0,22 | 2 | 2 |
mail / email | 34 | 6 376 | −13 | 12 | 1 249 | 0,20 | 0,20 | 0 | 13 |
wygląd / motyw | 61 | 6 233 | 0 | 17 | 1 109 | 0,18 | 0,18 | 1 | 0 |
bramki CI | 21 | 5 782 | +793 | 24 | 4 440 | **0,77** | 0,80 | 0 | 0 |
i18n rdzeń | 14 | 5 706 | +4 | 5 | 459 | 0,08 | 0,08 | 0 | 0 |
powiadomienia | 26 | 5 264 | −69 | 13 | 1 655 | 0,31 | 0,31 | 1 | 2 |
**kariera / rekrutacja** | 26 | 5 001 | **NOWY** | 7 | 1 142 | 0,23 | — | 0 | 0 |
media / import | 38 | 4 722 | 0 | 15 | 1 006 | 0,21 | 0,21 | 0 | 0 |
wyszukiwarka | 23 | 4 439 | −2 | 8 | 672 | 0,15 | 0,15 | 3 | 0 |
reklamy / popupy | 28 | 4 145 | +134 | 7 | 831 | 0,20 | 0,21 | 0 | 0 |
społeczność | 22 | 3 441 | 0 | 6 | 688 | 0,20 | 0,20 | 0 | 1 |
uprawnienia | 31 | 3 246 | +2 | 4 | 818 | 0,25 | 0,25 | 1 | 1 |
RODO / consent | 25 | 3 202 | 0 | 7 | 1 158 | 0,36 | 0,36 | 0 | 1 |

### 4.1. Wnioski z tabeli

**Dwadzieścia dwa moduły z dwudziestu siedmiu nie drgnęły ani o punkt T/P.** To nie
jest stagnacja — to znaczy, że 157 commitów poszło w cztery miejsca, a reszta
platformy stała.

**Cały przyrost kodu siedzi w czterech modułach:** kluby (+3 273), crm (+1 163),
newsletter (+804), bramki CI (+793), plus nowy moduł rekrutacji (+5 001). Razem
+11 034 z +9 258 netto (reszta to ubytki).

**Lista ryzyka jest ta sama, co wczoraj, i w dwóch miejscach się pogłębiła:**

1. **kluby — 48 602 linie, T/P 0,11.** Największa nieprzetestowana masa w repo,
   i **urosła o 3 273 linie bez ani jednej linii testu więcej w tej proporcji**
   (testy +187 linii przy +3 273 kodu, czyli przyrost testowany na 0,06).
   Wczoraj ten moduł miał 45 329 linii; miesiąc temu 31 039. To najszybciej rosnący
   duży moduł platformy i jednocześnie najsłabiej otestowany.
2. **newsletter — 13 088 linii, T/P 0,08.** Najniższe pokrycie w repo. Urósł
   o 804 linie, testy o 90.
3. **bloki — 36 273 linie, T/P 0,14.** Silnik treści renderujący każdy wpis.
4. **analityka — 16 126 linii, T/P 0,14** przy 9 funkcjach serwerowych.
5. **czat — 12 995 linii, T/P 0,13.**
6. **crm — 8 986 linii, T/P 0,12** — urósł o 1 163 linie (integracja rekrutacji),
   testy o 186.

**Najlepiej otestowane pozostają warstwy, które same są bramkami** (`bramki CI` 0,77;
`sieć+eksperci` 0,63; `seo` 0,50). Spadek `bramek CI` z 0,80 na 0,77 to efekt
dopisania 793 linii kodu bramek przy 456 liniach testów — nadal najwyższa proporcja
w repo.

**Moduł rekrutacji wchodzi z T/P 0,23** — powyżej mediany platformy, z własnym
harnessem CI (`check:careers-harness`) i pięcioma plikami testów w `lib/careers`.
Inżyniersko to dobry debiut. Problem z nim jest procesowy, nie jakościowy: to on
przyniósł wszystkie trzy przyczyny czerwonego CI (§3.1).

### 4.2. Dziura funkcjonalna: 158 z 244 tras nie jest wspomniana w żadnym teście

| Grupa | Tras bez wzmianki w testach | 13.08 |
|---|---:|---:|
`admin.*` | **108** | 111 |
`club.*` | 16 | 16 |
`profile.*` | 16 | 16 |
`tracker.*` | 4 | 4 |
`checkout.*` | **3** | 3 |
pozostałe | 11 | 11 |
| **razem** | **158 / 244** | 161 / 241 |

Trzy trasy `checkout.*` (`checkout.$planId`, `checkout.cancel`, `checkout.success`)
są w tej tabeli **czternasty dzień z rzędu** i pozostają najpoważniejszą pozycją —
to ścieżka pieniężna. Kontekst łagodzący bez zmian: warstwa pod nimi jest testowana
przyzwoicie, więc dziura dotyczy sklejenia trasy, nie logiki.

**Trasy rekrutacji (`zatrudniamy`, `admin.hiring`, `admin.careers`) są wspomniane
w testach** — nowy moduł nie dołożył do tej listy.

### 4.3. Ścieżki pieniężne — pliki produkcyjne vs testowe

| Obszar | Prod | Testy | Stosunek | 13.08 |
|---|---:|---:|---:|---:|
invoice | 40 | 13 | 0,33 | — |
stripe | 99 | 29 | 0,29 | 0,33 |
subscription | 174 | 47 | 0,27 | 0,34 |
entitlement | 15 | 4 | 0,27 | — |
gifting | 17 | 4 | 0,24 | 0,29 |
checkout | 108 | 22 | 0,20 | 0,24 |
donation | 61 | 12 | 0,20 | 0,23 |
paddle | 19 | 3 | 0,16 | — |
webhook | 103 | 15 | **0,15** | 0,18 |
coupon | 53 | 8 | **0,15** | 0,21 |
paywall | 48 | **6** | **0,12** | 0,16 |

**Każdy obszar pieniężny ma dziś gorszy stosunek niż wczoraj** — i w żadnym nie
ubyło testów. Ubyło proporcji, bo przybyło plików produkcyjnych (paywall 38 → 48,
webhook 82 → 103, coupon 39 → 53) przy **stałej liczbie plików testowych**.

`paywall` z 6 plikami testowymi na 48 produkcyjnych jest najsłabszym punktem
monetyzacji, tak jak wczoraj — tylko o 4 punkty procentowe gorszym. Paywall decyduje,
kto widzi treść: błąd w jedną stronę oddaje treść płatną za darmo, w drugą blokuje
płacącego.

---

## 5. Bundle — R2 z poprzedniego audytu wykonana

| Miara | Wartość | Próg | Zapas | 13.08 |
|---|---:|---:|---:|---:|
Największy chunk (gzip) | **467,6 KB** | 513 | **45,4 KB (8,9%)** | 511,3 / 513 |
PUBLIC (gzip) | 2 485,9 KB | 2 505 | **19,1 KB (0,76%)** | 2 462,0 / 2 475 |
OVERALL (gzip) | 3 799,1 KB | 3 835 | **35,9 KB (0,93%)** | 3 752,8 / 3 790 |

Największe pojedyncze chunki (surowo, nie gzip):

```
1482 KB  index-CMp0Yfke.js        <- chunk wejściowy
 791 KB  EChartClient-*.js
 681 KB  PostBlockEditor-*.js
 546 KB  Builder-*.js
 439 KB  lucideIconNodes.generated-*.js
 419 KB  xlsx-*.js
 395 KB  index-BiKTBrIE.js
 273 KB  vendor-radix-*.js
 107 KB  i18n-club-*.js           <- NOWY, własny chunk
```

### 5.1. Słownik klubów wyszedł z chunku wejściowego

Sonda na tej samej wartości, której użył poprzedni audyt
(`"Kluby dyskusyjne są dostępne po zalogowaniu"`) — **nie występuje w żadnym
z chunków `index-*`**, występuje wyłącznie w `i18n-club-CldgwxAk.js` (107 KB).

To jest wykonana **R2** z poprzedniego audytu, i widać ją w liczbie: największy
chunk spadł z 511,3 na **467,6 KB gzip**, czyli zapas na tej bramce urósł z 1,7 KB
(0,33%) na 45,4 KB (8,9%). Bramka przestała kłamać o autorstwie regresji.

### 5.2. Ale problem przeniósł się na dwa pozostałe budżety

Sam `check:check-bundle-size.ts` to raportuje w swoim wyjściu:

```
! ZAPAS BUDŻETU PONIŻEJ 2% - następny wzrost zapali bramkę:
!   public total: zostało 19.1 KB z 2505 KB (0.76%)
!   overall total: zostało 35.9 KB z 3835 KB (0.93%)
!
! Ruchy względem baseline'u (0761984, 2026-08-13):
!   +   12.3 KB  catalog (NOWY)
!   +   10.4 KB  zatrudniamy (NOWY)
!   +    5.3 KB  admin.hiring (NOWY)
!   +    3.3 KB  index  (567.6 -> 570.9)
!   +    1.5 KB  admin.crm._id
```

Progi zostały w międzyczasie podniesione (PUBLIC 2 475 → 2 505, OVERALL 3 790 →
3 835), a mimo to zapas jest **węższy niż 2% na obu**. Moduł rekrutacji dołożył
28 KB gzip do powierzchni publicznej w jeden dzień.

Wniosek jest ten sam, co wczoraj, tylko przeniesiony o jeden budżet dalej: **0,76%
zapasu znaczy, że następna regresja zostanie przypisana przypadkowemu commitowi.**
Skrypt sam podpowiada właściwy ruch (`BUNDLE_INVENTORY=1 bun run build &&
bun run report:chunk-inventory index`) i sam pisze, że to **nie** jest powód do
podniesienia progu.

---

## 6. Dług, który da się policzyć

### 6.1. Warstwa językowa — konsekwentnie w dół

| Miara | Stan | 13.08 | Zmiana |
|---|---:|---:|---|
Ternaria `isPl ?` | **135** w 26 plikach | 155 w 33 | **−20** |
Twarde znaczniki BCP-47 | **297** | 321 | −24 |
Ręczne bliźniaki `? x_pl : x_en` | **110** | 112 | −2 |
`defaultValue:` w wywołaniach `t()` | **1 398** | 1 568 | **−170** |
Słowniki z `ensure*I18n()` | **52 / 87** | 47 / 85 | +5 |
Importy side-effect słowników | 316 | — | — |
Parytet PL/EN | 0 brakujących w bramkowanych prefiksach | j.w. | — |

**To jedyny obszar długu, który spadł we wszystkich pięciu wymiarach naraz.**
Największa pozycja — 1 398 wywołań `defaultValue:` — zeszła o 170 w jeden dzień
i pozostaje największym pojedynczym długiem językowym. Mechanizm szkody bez zmian:
fallback wpisany w kod sprawia, że brakujący klucz nigdy się nie ujawnia, więc
bramka parytetu go nie widzi.

Doszła bramka `check:i18n-hardcoded` (ratchet: 1 593 znane wystąpienia w 156
plikach, lista może tylko maleć) — czyli obszar, który dotąd był mierzony, zaczął
być **pilnowany**.

### 6.2. Martwy kod — luka zamknięta

| Miara | Stan | 13.08 |
|---|---:|---:|
`tsc --noUnusedLocals --noUnusedParameters` | **0 martwych deklaracji** | 156 w 67 plikach |
`noUnusedLocals` w `tsconfig.json` | **`true`** | `false` |
`noUnusedParameters` w `tsconfig.json` | **`true`** | `false` |

**R1 z poprzedniego audytu jest wykonana w całości** — commit `6b989b6`
(*„fix(dead-code): 171 → 0 martwych deklaracji, flagi tsc włączone — i cztery zerwane
ścieżki funkcji pod nimi"*). Wdrożenie poszło dokładnie tą dwustopniową drogą, którą
tamten audyt rekomendował: najpierw wyczyszczenie całości, potem włączenie flag.
Bramka weszła zielona i taka jest.

Warto zapisać wtrącenie z tytułu tamtego commita: przy czyszczeniu 171 martwych
deklaracji znalazły się **cztery zerwane ścieżki funkcji** pod nimi. Martwy kod nie
był tylko kosmetyką — przykrywał cztery realne defekty.

`@typescript-eslint/no-unused-vars` pozostaje `off` w `eslint.config.js`, ale to już
nie ma znaczenia: `tsc` łapie tę klasę i CI go odpala.

### 6.3. Typowanie

| Miara | Stan | 13.08 | Ocena |
|---|---:|---:|---|
`as any` ręcznie | **5** (5 plików) | 7 | czysto |
`as any` w `routeTree.gen.ts` | 298 | 295 | plik generowany |
`: any` | 5 | 9 | czysto |
`as unknown as` (produkcja) | **359** | 350 | **do przeglądu** |
`as unknown as` (testy) | 219 | 205 | — |
`@ts-expect-error` | 4 | 3 | czysto |
`@ts-ignore` | **0** | 0 | czysto |
`TODO` / `FIXME` / `HACK` | **0 / 0 / 0** | 0/0/0 | czysto |
`@deprecated` | 1 | 1 | czysto |
`eslint-disable` | 46 | 45 | do przeglądu |

**359 rzutowań `as unknown as` w kodzie produkcyjnym** to jedyna pozycja typowania
warta uwagi i jedyna, która **rośnie** (+9). Doszły za to dwie bramki, które atakują
tę klasę od strony bazy: `check:db-row-casts` (22 wyjątki, ratchet) i
`check:types-freshness` (28 znanych kolumn poza wygenerowanymi typami). Część rzutowań
jest nieunikniona na granicy Supabase — te dwie bramki mierzą dokładnie tę część
i trzymają ją w miejscu.

### 6.4. Dostępność — sygnały

| Miara | Stan | 13.08 |
|---|---:|---:|
`aria-label` | 1 266 | 1 230 |
`aria-pressed` | 159 | 157 |
`aria-live` | 85 | 80 |
`role="dialog"` / `alertdialog` | 20 | 19 |
`onClick` na `<div>` | **2** | 2 |
`<img>` bez `alt` | **0** | 0 |

Wynik utrzymany; przyrosty proporcjonalne do przyrostu kodu. Dwa `onClick` na
`<div>` stoją niezmienione od wczoraj — to jedyna otwarta pozycja i jest drobna.

---

## 7. Rekomendacje — uszeregowane po iloczynie ryzyka i kosztu

### R1. Zdjąć czerwień z CI (koszt: godzina, ryzyko regresji: zero)

Cztery blokujące kroki, trzy przyczyny, wszystkie z dzisiaj (§3.1):

1. **Usunąć dwa wygenerowane duplikaty migracji** —
   `20260814122639_*.sql` i `20260814123014_*.sql`. Zostawić wersje z PR-a, bo to
   one niosą nagłówki z opisem przyczyny. Jeśli obie wersje są już zastosowane na
   środowisku, bramka podpowiada drugą drogę: dopisać parę do `KNOWN_CONTENT_TWINS`
   z decyzją operatora. To zamyka **dwa** kroki naraz (`check:sql-migration-replay`
   i suitę).
2. **`bunx prettier --write`** na 29 plikach z §3.1. 115 błędów, wszystkie
   automatycznie naprawialne.
3. **Nauczyć `scanColumnEvents()` składni `RENAME COLUMN`**
   (`src/lib/ci/generatedTypesFreshness.ts:89`) **i dopiero wtedy usunąć wpis**
   `"member_organizations.paddle_subscription_id"` z `BASELINE`
   (`scripts/check-generated-types-freshness.ts:41`). Oba kroki muszą wejść razem —
   samo usunięcie wpisu zapala `check:types-freshness`, bo skaner nadal uważa starą
   nazwę za żywą (szczegóły w §3.1). To jedyny punkt R1, który wymaga zmiany w kodzie
   bramki, a nie w danych.

To jest pierwsza pozycja, bo dopóki CI jest czerwone, **żadna inna bramka nikogo nie
ostrzega** — czerwień staje się tłem i następny realny defekt wjedzie niezauważony.
Dokładnie ten tryb awarii opisuje kronika w `check-bundle-size.ts` i dokładnie on
zdarzył się tu wczoraj po raz drugi (`96e25b3`: 201 błędów formatowania → 0 → 115).

### R2. Testy klubów — moduł urósł o 3 273 linie przy T/P 0,11

Największa nieprzetestowana masa w repo i najszybciej rosnąca. 48 602 linie kodu na
5 212 linii testów. Priorytet w obrębie modułu: ścieżki, które dotykają uprawnień
i wielodostępności (wejście do klubu, role, dokumenty), bo to tam błąd nie jest
usterką UI, tylko wyciekiem.

### R3. Zatrzymać erozję pokrycia ścieżek pieniężnych (ryzyko: pieniądze)

Wszystkie 11 obszarów pieniężnych ma dziś gorszy stosunek niż wczoraj, przy
**zerowym ubytku testów** — rośnie sam kod. `paywall` 0,12, `coupon` 0,15,
`webhook` 0,15. Plus trzy trasy `checkout.*` bez wzmianki w jakimkolwiek teście,
czternasty dzień.

Najtańsze domknięcie: kilka testów integracyjnych na sklejenie tras `checkout.*`
(warstwa pod nimi jest testowana przyzwoicie) i podniesienie `paywall` do proporcji
reszty monetyzacji.

### R4. Zmierzyć skład chunku wejściowego, nie podnosić progu

PUBLIC ma 0,76% zapasu, OVERALL 0,93% — mimo że oba progi już raz podniesiono.
Skrypt bramki sam podaje komendę (`BUNDLE_INVENTORY=1 bun run build &&
bun run report:chunk-inventory index`) i sam pisze, że wąski zapas **nie** jest
powodem do podniesienia progu. Precedens `i18n-club` z §5.1 pokazuje, że ta praca
działa: −44 KB gzip na największym chunku, kryterium sukcesu jednoznaczne.

### R5. Rozstrzygnąć `bloki ↔ builder` (28/16) — i zatrzymać `bloki ↔ treść` (18/14)

Pierwszy cykl był rekomendacją R5 wczoraj i **urósł** (23/17 → 28/16). Drugi
w ciągu doby przeszedł z 11/2 (jednoznaczny kierunek) na 18/14 (dwa równoważne
kierunki), czyli przestał być importem typu i stał się drugim realnym sprzężeniem.

Decyzja jest jedna i ta sama dla obu: albo wspólna warstwa `lib/content-model` pod
silnikami treści, albo jasny kierunek zależności z adapterem w drugą stronę. Koszt
rośnie liniowo z każdym nowym widgetem — a od wczoraj przybyło ich w dwóch miejscach.

### R6. Przenieść `ClubEnumSelect` do `components/clubs/molecules/`

Powtórzenie R6 z poprzedniego audytu — niewykonana, koszt nadal godzinowy,
szkoda nadal wyłącznie przyszła.

### R7. Dokończyć warstwę językową: 135 ternariów, 1 398 `defaultValue`

Jedyny obszar długu spadający we wszystkich wymiarach — warto go dowieźć, bo tempo
jest ustalone (−170 `defaultValue` w jeden dzień). Bramka `check:i18n-hardcoded`
już trzyma kierunek ratchetem.

### R8. Przegląd 359 rzutowań `as unknown as` w produkcji

Jedyna pozycja typowania, która rośnie (+9). Obchodzą kontrolę typów tak samo
skutecznie jak `as any`, ale nie zapalają `no-explicit-any`. Dwie nowe bramki
(`db-row-casts`, `types-freshness`) pilnują części granicznej z Supabase — reszta
jest niepilnowana.

---

## 8. Co ta platforma robi dobrze

Audyt, który wymienia wyłącznie długi, daje fałszywy obraz i prowokuje złe decyzje
remontowe. Pięć rzeczy jest tu zrobionych lepiej niż standard:

1. **Rekomendacje z poprzedniego audytu zostały wykonane, i to w kolejności.**
   R1 (martwy kod 171 → 0 + włączone flagi) i R2 (słownik klubów poza chunkiem
   wejściowym, −44 KB gzip) — obie w ciągu doby, obie dokładnie tą drogą, którą
   audyt rekomendował. To rzadkie: zwykle audyt jest czytany, a nie wykonywany.
2. **25 bramek `check:*`, z czego 9 pilnuje inwariantów SQL i uprawnień** — plus
   cztery nowe od wczoraj, wszystkie w tę samą stronę (świeżość typów, kształty
   wierszy, twardy tekst, harness rekrutacji). Wielodostępność, zakres właściciela,
   wstawianie przez anonima, pozycja aktora w zdarzeniach, kontrakt RPC — rzeczy,
   które w większości projektów wychodzą dopiero z incydentu produkcyjnego.
3. **709 funkcji `SECURITY DEFINER`, wszystkie z przypiętym `search_path`; 244 tabele,
   wszystkie z RLS.** Zero wyjątków w obu wymiarach, sprawdzone z uwzględnieniem
   późniejszych `ALTER`-ów.
4. **Zero `TODO`, `FIXME`, `HACK`, `@ts-ignore`; 5 ręcznych `as any`; 0 martwych
   deklaracji.** Przy 540 tysiącach linii produkcyjnych to nie jest przypadek, tylko
   wymuszona dyscyplina — od wczoraj wymuszona także maszynowo.
5. **Nowy moduł wchodzi z własnym harnessem CI.** `check:careers-harness`
   (`scripts/careers-harness/`: migracje + asercje runtime) powstał razem z modułem
   rekrutacji, a nie po pierwszym incydencie. T/P 0,23 powyżej mediany platformy.

---

## 9. Metoda — żeby ten audyt dał się powtórzyć

Każda liczba pochodzi z komendy uruchomionej na `0fd4108`. Rzeczy warte zapisania
jako metoda:

- **Środowisko trzeba odtworzyć procedurą z CI, nie „jakimś" installem.** Prywatne
  lustro npm (`europe-west*-npm.pkg.dev`) jest w tym kontenerze zablokowane przez
  politykę egress — 292 pakiety wracały z 403, a `tsc` dawał **4 243 błędy**, z czego
  1 963 to `TS2307 Cannot find module` i kolejne 2 111 to kaskada `any` po nich.
  Właściwe rozwiązanie stoi w `ci.yml`: `sed` przepinający `bun.lock` na
  `registry.npmjs.org`, który zachowuje **przypięte wersje** i zmienia tylko host.
  Po tym: 0 błędów. **Audyt uruchomiony na niekompletnym `node_modules` zmierzyłby
  4 243 nieistniejące defekty.**
- **Liczby z dwóch różnych filtrów nie odejmują się od siebie.** §0.1: 537 283 (bez
  katalogów `__tests__`) minus 97 912 (wszystkie linie testów) to nie jest kod
  produkcyjny, tylko kod produkcyjny minus 91 290 linii policzonych drugi raz.
  Przed odjęciem trzeba odtworzyć, jakim filtrem powstał odjemnik.
- **Tabelę porównawczą trzeba liczyć tym samym skryptem na obu HEAD-ach.** Kolumna
  „T/P 13.08" w §4 pochodzi z mojego skryptu puszczonego na `94eb31a`, nie
  z przepisania tabeli z tamtego dokumentu — taksonomie modułów się różnią i porównanie
  byłoby fikcją. Wzorce ścieżek: `scratchpad/modules.py`, jeden regex per moduł,
  pierwszy trafiony wygrywa.
- **Bramkę, której nie da się uruchomić, trzeba oznaczyć jako niezmierzoną —
  i zmierzyć jej istotę ręcznie.** `check:entry-purity` nie znajduje manifestu, bo
  nitro nie składa `.output/server` w tym kontenerze (§3.2). Napisanie „zielona" na
  podstawie tego, że wczoraj była zielona, byłoby tym samym błędem, który rewizja
  z 06.08 nazwała najgorszym trybem porażki audytu: przepisaniem progu zamiast
  uruchomienia bramki. Marker `js.stripe.com` sprawdzony gerpem: 1 chunk, nie
  wejściowy.
- **Bliźniaki treści nie są bajtowo identyczne.** Duplikaty migracji z §3.1 mają
  różne sumy MD5 — różnią się o nagłówek komentarza. Porównanie po `md5sum` dałoby
  fałszywy negatyw; bramka normalizuje treść i dlatego je widzi.
- **Sondowanie bundla robi się na WARTOŚCIACH, nie na kluczach** (zasada przejęta
  z poprzedniego audytu, potwierdzona w §5.1).

---

*Dokument towarzyszy `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md` (oceny poglądowe
funkcja po funkcji) i kontynuuje serię `AUDYT_PLATFORMY_MODULY_FUNKCJE_*`.*
