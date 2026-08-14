# Wdrożenie: odblokowanie CI + bramki na klasę „gate omijany przy wdrożeniu" (2026-08-14)

## Diagnoza

CI stało czerwone na czterech blokujących krokach - **trzecie wydanie z rzędu,
za każdym razem z innych powodów**. Poprzednio było to 481 błędów lintu
i czerwony bundle. To znaczy, że nie zmienia się wzorzec, a tylko jego objaw:
bramki istnieją, są dobre i **nie są uruchamiane przed wypchnięciem**.

Zmierzony stan wejściowy (nie przepisany - odtworzony lokalnie):

| Krok CI                       | Objaw                                              |
| ----------------------------- | -------------------------------------------------- |
| `Lint`                        | 291 problemów: **115 błędów**, wszystkie `prettier/prettier`, zero błędów logiki |
| `check:sql-migration-replay`  | 2 nowe pary bliźniaków treści (migracje rekrutacji) |
| `Test + coverage gate`        | 2 testy w `src/lib/ci/__tests__/migrationReplay.test.ts` - ta sama przyczyna |
| `check:legacy-payment-refs`   | 1 żywa referencja do poprzedniego operatora płatności |

Żadna z czterech nie była defektem produktu. Trzy pierwsze przyczyny kosztują
**razem poniżej minuty pomiaru**, a CI podawało je po ~8 minutach instalacji,
typów i suity z coverage - bo tanie bramki stały na końcu jobu.

### Przyczyna czwartego kroku: dwie dobre bramki stały sobie w gardle

`check:legacy-payment-refs` wskazywał JEDNO miejsce w repo:

    scripts/check-generated-types-freshness.ts:41  "member_organizations.paddle_subscription_id",

To nie był martwy kod płatności, a **wpis w zamrożonym długu bramki świeżości
typów**. Kolumny o tej nazwie NIE MA w bazie od `20260805134721`
(`ALTER TABLE … RENAME COLUMN paddle_subscription_id TO provider_subscription_id`,
migracja na Stripe). Skaner świeżości czytał wyłącznie `ADD COLUMN` i
`DROP COLUMN`, więc kolumny przemianowanej nie umiał wyprowadzić ze zbioru
żywych - i liczył fantom, którego druga bramka słusznie nie chciała w repo.

Ta sama luka miała **drugi, groźniejszy kierunek**: nazwa PO przemianowaniu nie
była mierzona wcale. `subscriptions.provider_subscription_id` powstało właśnie
z `RENAME COLUMN` (pierwotnie z `CREATE TABLE`), więc gdyby typy nie zdążyły za
tą migracją, bramka postawiona dokładnie po to milczałaby.

### Znalezisko przy okazji: izolację CV uratowała kolejność sortowania nazw

`20260814100000_careers_tenant_scope.sql` zawęziło trzy polityki bucketu
`career-cv` do najemcy - bez tego `is_staff()` bada WYŁĄCZNIE rolę, więc
redaktor najemcy A mógł podpisać i pobrać KAŻDE CV każdego najemcy. Trzy
godziny później platforma zapisała wygenerowany `20260814122512` (odpowiednik
stanu PRZED zawężeniem) i odtworzyła tę trójkę w kształcie:

    career_cv_staff_read  USING (bucket_id = 'career-cv' AND public.is_staff())

Stan końcowy bazy jest poprawny **wyłącznie dlatego**, że bliźniak migracji
zawężającej (`20260814122639`) sortuje się PO pliku cofającym i przywrócił
hardening. Gdyby platforma wygenerowała tylko ten pierwszy plik, izolacja
najemców na plikach CV byłaby dziś otwarta na produkcji - i **nie powiedziałaby
tego żadna bramka**: `check:sql-tenant-scope` patrzy na funkcje,
`check:sql-owner-tenant-scope` szuka asymetrii między klauzulami tej samej
tabeli (a tu cofnęły się wszystkie trzy razem), `check:sql-migration-replay`
porównuje treść plików (a ten nie był bliźniakiem niczego - różnił się brakiem
`INSERT`-a do `storage.buckets`), pgTAP i harnessy stawiają bazę ze stanu
końcowego, który był (przypadkiem) poprawny.

## Zmiany

### 1. Cztery czerwone kroki

1. **Format** - `bun run format` na kodzie: 43 pliki, 115 błędów do zera.
   Markdown celowo NIE był formatowany (prettier przepisałby tabele w 50
   dokumentach audytowych - 9 tys. linii szumu w commicie naprawczym).
   `src/integrations/supabase/types.ts`, `.lighthouseci/` i `reports/` doszły do
   `.prettierignore`: to pliki generowane, a `types.ts` ESLint pomijał od zawsze
   i przez tę asymetrię `prettier --check` nie dawał się wpiąć jako bramka.
2. **Bliźniaki migracji** - dwie pary dopisane do `KNOWN_CONTENT_TWINS`
   z jawną decyzją operatorską. Wersje bliźniaków są już w `schema_migrations`
   (to samo zastosowanie na hostowanej bazie, które je wygenerowało), więc
   skasowanie pliku wymagałoby `supabase migration repair` na każdym środowisku.
   To 43. i 44. para na liście, która może tylko maleć.
3. **Dwa testy** - ta sama przyczyna, zielone bez dotykania testu.
4. **Referencja operatora płatności** - naprawiona przez **poprawienie skanera
   świeżości typów**, nie przez obejście napisu: `scanColumnEvents` odtwarza
   teraz `RENAME COLUMN` (nowa nazwa staje się żywa nawet bez wcześniejszego
   `ADD COLUMN` - inaczej kolumny z `CREATE TABLE` po renamie zostają
   niemierzone) oraz `RENAME TO` dla tabel (przenosi zebrane wpisy, nie dokłada
   nowych). Efekt: dług 28 -> 27 wpisów, **zero nowych** pozycji, bramka
   płatności zielona.

### 2. `20260814194500_career_cv_policies_tenant_scope_reassert.sql`

Kanoniczne, idempotentne odtworzenie trzech polityk `career-cv` z wiązaniem
najemcy, 1:1 z sekcją C migracji `20260814100000`. Stan końcowy przestaje
zależeć od kolejności bliźniaków. Migracje są forward-only, więc naprawą jest
PÓŹNIEJSZY plik, nie edycja zastosowanego.

### 3. Nowa bramka: `check:sql-policy-tenant-regression`

Polityka, która raz związała wiersz z najemcą, nie może tego wiązania stracić
przy późniejszym odtworzeniu. Porównuje HISTORIĘ definicji ze STANEM KOŃCOWYM:

- **blokuje**, gdy definicja obowiązująca zgubiła wiązanie nadane wcześniej;
- **raportuje** cofnięcia zaleczone później (dokładnie kategoria `20260814122512`
  - audyt ma prawo je widzieć bez czytania 770 plików);
- **nie rusza** polityk, które nigdy najemcy nie wiązały (płaszczyzny globalne
  są poza zasięgiem z definicji - bramka jest samokalibrująca, bez listy tabel);
- **nie liczy** polityki skasowanej na końcu łańcucha (brak polityki nie
  wpuszcza nikogo).

Parser polityk jest WSPÓLNY z bramkami anonimowego `INSERT`-u i zakresu
właściciela (`src/lib/ci/rlsPolicies.ts` + nowe `extractPolicyHistory`), więc
poprawka w parserze wzmacnia trzy bramki naraz.

Pomiar przy wprowadzeniu: **556 polityk w stanie końcowym, 465 z wiązaniem
najemcy, 3 cofnięcia zaleczone** i **8 luk otwartych, starszych o miesiąc** -
patrz sekcja „Dług do zamknięcia".

### 4. Nowa bramka meta: `check:gate-coverage`

Każda bramka `check:*` z `package.json` MUSI być wpięta w workflow i nie może
jechać w jednym jobie dwa razy. Repo ma udokumentowaną historię bramek, które
istniały i nie były uruchamiane: `check:authz-snapshot` (zawężenie uprawnień
w `profiles_guard_verification()` przeszło bez sygnału, `main` czerwony czwartą
dobę), `check:pg-harness` i `check:careers-harness` (martwa ścieżka zgłoszeń
klubowych na produkcji przy zielonym CI). Bramka niewpięta wygląda w repo
identycznie jak wpięta - różnicę widać tylko w pliku workflow, którego przy
przeglądzie nikt nie czyta, „bo to konfiguracja".

Ten sam skan znalazł **`check:authz-snapshot` uruchamiany TRZY razy**
i **`check:permissions-parity` DWA razy** w jobie `verify` - te same komendy pod
różnymi nazwami kroków, zero dodatkowego pokrycia. Zdjęte w tej zmianie,
uzasadnienia z usuwanych komentarzy przeniesione do kroków, które zostają.

### 5. Kolejność kroków CI jako część bramki

Job `verify` przestawiony po KOSZCIE: najpierw wszystko, co czyta wyłącznie
pliki repo (format, `gate-coverage`, wszystkie `check:sql-*`, kontrakty typów
i i18n, snapshot autoryzacji, parytet chunków), potem typy i lint, potem suita
z coverage i bramki oparte o Vitest, na końcu build i bramki artefaktu (jedyne,
które go potrzebują). Nowy krok `Format (prettier)` stoi PIERWSZY.

Efekt dla klas z tego wydania: **czas do pierwszej informacji zwrotnej spada
z ~8 minut do ~50 sekund**. Nazwa joba (`verify`) się nie zmienia, więc reguły
ochrony gałęzi zostają nietknięte.

### 6. Jedna komenda przed wypchnięciem

    bun run verify:static     # 18 bramek, ~55 s (z czego 47 s to prettier)
    bun run verify:blocking   # + typy, lint i testy

`verify:static` NIE MA ręcznej listy: bierze wszystkie `check:*` z `package.json`
i odejmuje te, które wymagają buildu, bazy albo klastra Postgresa - każde
wykluczenie z powodem w `EXCLUDED` (`scripts/verify-static.ts`). Nowa bramka
wchodzi tam automatycznie; żeby jej nie było, trzeba ją jawnie wykluczyć.
Ręczna lista rozjechałaby się z CI w pierwszym tygodniu.

Przy porażce runner mówi, ile bramek NIE zostało uruchomionych i że dokładnie
ten sam krok przewróci CI. Przy sukcesie podaje trzy najdroższe bramki.

## Testy

| Plik                                                | Zakres                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/ci/__tests__/dbTypeBoundary.test.ts`       | +4: rename kolumny (stara/nowa nazwa), rename tabeli, `RENAME CONSTRAINT` jako nie-zdarzenie |
| `src/lib/ci/__tests__/policyTenantRegression.test.ts`| 10: sygnały wiązania, `WITH CHECK`, cofnięcie otwarte, cofnięcie zaleczone, polityka bez historii wiązania, polityka skasowana, ratchet długu, pusty skan |
| `src/lib/ci/__tests__/gateCoverage.test.ts`          | 8: przypisanie do joba i linii, bramka niewpięta, duplikat w jobie, ten sam skrypt w dwóch jobach, skrypt nieznany manifestowi, pusty skan |

Każda z trzech bramek oblewa też na **pustym skanie** (zero polityk, zero
bramek, zero definicji). Bramka, która po zmianie parsera przestaje cokolwiek
widzieć, wygląda w logu identycznie jak bramka przechodząca - i to jest jedyny
tryb awarii, którego nie zgłosi nikt inny.

## Dług do zamknięcia (osobna zmiana)

Bramka `check:sql-policy-tenant-regression` zamroziła **8 realnych, otwartych
luk izolacji najemców** starszych o miesiąc od tego wydania. Wszystkie z jednej
migracji: `20260714130000_expert_hub.sql` przepisało polityki sześciu tabel
ŁĄCZĄCYCH z predykatu „rodzic należy do przeglądanego najemcy" na `USING (true)`:

| Tabela                   | Polityki                              |
| ------------------------ | ------------------------------------- |
| `post_authors`           | `public read`                         |
| `post_programs`          | `public read`                         |
| `post_regions`           | `public read`                         |
| `event_speakers`         | `public read`, `staff manage`         |
| `program_members`        | `public read`, `staff write`          |
| `expert_expertise_areas` | `expert_areas public read`            |

Wiersze noszą wyłącznie pary UUID, więc nie wyciekają treści (rodzice mają
własne, zawężone polityki) - wycieka GRAF: kto jest autorem którego wpisu i kto
prelegentem którego wydarzenia u obcego najemcy. Dwa wpisy `staff` są cięższe:
predykat to sama rola, więc redaktor najemcy A może przypisać prelegenta do
wydarzenia najemcy B i edytować skład programu najemcy B.

Poprawny predykat każdej z ośmiu polityk jest zapisany W LIŚCIE DŁUGU
(`scripts/check-sql-policy-tenant-regression.ts`) - odtworzony z
`20260713201355`, czyli ze stanu przed regresją. Naprawa dotyka publicznego
odczytu wpisów, wydarzeń i programów, więc należy jej się własna migracja
z asercjami pgTAP na izolację, a nie doklejenie do commita odblokowującego CI.
Lista jest drukowana przy każdym przebiegu i może tylko maleć.
