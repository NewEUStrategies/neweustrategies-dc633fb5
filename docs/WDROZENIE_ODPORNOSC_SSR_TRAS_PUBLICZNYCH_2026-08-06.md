# Wdrożenie: odporność SSR tras publicznych - 2026-08-06

Zgłoszenie: podgląd platformy pokazywał stronę „Coś poszło nie tak - Wystąpił
nieoczekiwany błąd serwera". Zamiast zgadywać przyczynę pojedynczego incydentu,
zmierzyliśmy zachowanie CAŁEJ powierzchni publicznej przy niedostępnym backendzie
i znaleźliśmy klasę defektu, która produkuje dokładnie taki obraz.

| Wynik                                    | Przed                     | Po                            |
| ---------------------------------------- | ------------------------- | ----------------------------- |
| Trasy publiczne oddające 5xx przy blipie | **7**                     | **0**                         |
| Fałszywy 404 przy awarii bazy            | możliwy (`/author/$slug`) | niemożliwy z konstrukcji      |
| Bramka CI na tę klasę regresji           | brak                      | `e2e/ssr-degradation.spec.ts` |
| Zdegradowany render w cache'u wspólnym   | możliwy                   | wykluczony (`no-store`)       |

---

## 1. Pomiar, nie hipoteza

Aplikacja uruchomiona z placeholderowymi poświadczeniami Supabase (ten sam
warunek, w którym pracuje CI), przemiatanie wszystkich tras publicznych:

```
/                    200      /experts       500
/en                  200      /events        500
/blog                200      /live          500
/en/blog             200      /podcasts      500
/cookies             200      /programs      500
/admin               200      /web-stories   500
/nie-istnieje-404    404      /author/$slug  500
```

Siedem tras publicznych oddawało **HTTP 500** zawsze, gdy backend nie odpowiadał
w budżecie. Strona główna, `/blog` i `/tracker` przeżywały - bo miały tę samą
logikę obronną **wklejoną ręcznie**.

## 2. Mechanizm

```
loader: await ensureQueryData(...)
   ↓ backend wolny (>5 s) albo błąd PostgREST
watchdog SSR anuluje zapytanie  →  ensureQueryData odrzuca
   ↓
loader rzuca  →  TanStack Start ustawia status 500
```

Dokument renderował się przy tym w CAŁOŚCI (errorComponent trasy), więc
w przeglądarce wyglądało to znośnie. Status 500 niesie jednak skutki, których
w przeglądarce nie widać:

- **CDN nie zapisuje 5xx** - każdy kolejny czytelnik płaci ten sam błąd,
- **monitory** (w tym operatora płatności) raportują serwis jako offline,
- **crawler** traktuje 500 jak awarię serwera i wypycha adres z indeksu.

Doktryna obronna istniała w repo od dawna (`index.tsx`, `blog.index.tsx`,
`tracker.index.tsx`), ale **nie była wyodrębniona w prymityw** - każda nowa
trasa musiała ją odtworzyć z pamięci. Dlatego siedem tras jej nie miało.

## 3. Prymityw: `src/lib/ssr/resilientLoad.ts`

Cztery kroki doktryny w jednym, otestowanym module:

1. **Budżet** krótszy niż watchdog SSR (4 s < 5 s) - loader degraduje się SAM,
   zanim watchdog zamieni zapytanie w rzut.
2. **Anulowanie** spóźnionego fetcha PRZED zasiewem. Gdyby rozstrzygnął się
   między renderem a dehydracją, klient hydratowałby się z innymi danymi niż
   HTML serwera, a React 19 odpowiada na to przebudową całego drzewa.
3. **Zasiew** fallbacku z `updatedAt: 0` - dane natychmiast przeterminowane,
   więc przeglądarka refetchuje po zamontowaniu i strona sama się leczy.
   `useSuspenseQuery` widzi stan `success`, więc nie rzuca w fazie renderu.
4. **Sygnał `degraded`** w górę → `resilientCacheControl()` zdejmuje nagłówek
   cache'a wspólnego, żeby pusta powłoka nie zamarzła na brzegu CDN.

Zapytania równoległe składa `anyDegraded(...)`; budżety biegną współbieżnie,
więc N wolnych zapytań kosztuje tyle co jedno (13 testów w
`src/lib/ssr/__tests__/resilientLoad.test.ts`, w tym asercja czasu).

## 4. Uczciwość treści, nie tylko transportu

Sam fallback naprawia transport, ale **kłamie w warstwie treści**: pusta lista
wygląda dokładnie jak „nie ma jeszcze wydarzeń". Trasa, która dostała
`degraded: true`, renderuje więc `DegradedDataNotice` (molekuła) zamiast pustego
stanu - prawdziwy komunikat i przycisk ponowienia, PL/EN, ze wspólnej warstwy
`errorCopy`.

Osobny scenariusz `degraded` (nie alias `network`) jest celowy: `network` każe
czytelnikowi sprawdzić WŁASNE łącze, a tu zawiodła nasza strona. Nadlinia karty
pokazuje `200` i „Strona załadowana", nie „Nie udało się załadować strony" -
bo strona załadowała się w całości.

## 5. Zapytania tożsamościowe: degradacja NIE MOŻE dać 404

`/author/$slug` i `/podcasts/$show` pytają „czy ten zasób istnieje?". Zasianie
`null` przy awarii zamieniłoby blip bazy w **404 na realnie istniejącej,
indeksowanej stronie** - a 404 wyrzuca adres z wyników wyszukiwania. Te trasy
rozróżniają więc trzy rozłączne stany:

| Wynik zapytania     | Odpowiedź                               |
| ------------------- | --------------------------------------- |
| wiersz              | render                                  |
| `null`              | `notFound()` - 404 jest PRAWDĄ          |
| awaria / brak czasu | HTTP 200 `no-store` + uczciwy komunikat |

## 6. Bramka - i dowód, że failuje

`e2e/ssr-degradation.spec.ts` (14 testów) sprawdza trzy rzeczy: brak 5xx,
obecność realnego dokumentu (`<main`) oraz uczciwą treść przy degradacji (PL i EN).
Osobny test pilnuje, że profil eksperta nie fabrykuje 404.

Bramka działa w CI **dlatego, że** suita startuje z placeholderowymi
poświadczeniami Supabase - warunek brzegowy regresji jest tam stanem domyślnym,
nie sztucznym scenariuszem.

Dowód wykonany, nie zadeklarowany - `src/routes/experts.tsx` cofnięty do stanu
sprzed naprawy:

```
✘ katalog ekspertów (/experts) nie oddaje 5xx przy martwym backendzie
  Received: 500
```

Po przywróceniu naprawy: `14 passed`.

**Dodając trasę publiczną z zapytaniem w loaderze - dopisz ją do listy `ROUTES`
w tej bramce.** To jedyne miejsce, które pilnuje, że nowa trasa przeszła przez
`loadResilient()` zamiast rzucać.

## 7. TTFB: menu chrome'u wyprzedza falę ustawień

Rozgrzewka w `__root.tsx` szła dwiema falami SEKWENCYJNIE: najpierw ustawienia,
potem - dopiero po ich rozstrzygnięciu - menu, ticker i widgety chrome'u.
Ticker i widgety faktycznie zależą od ustawień (konfiguracja siedzi w
`header`/`footer`), ale menu `main` i `footer` mają **stałe klucze i nie zależą
od niczego**. Trzymanie ich w drugiej fali dokładało jeden pełny round-trip do
TTFB każdej strony z chrome'em.

Menu startuje teraz równolegle z ustawieniami; druga fala dostaje rozgrzane
obietnice i czeka wyłącznie na to, co naprawdę wymagało ustawień. Budżety,
strażnik stanu `pending` po HMR i pochłanianie odrzuceń - bez zmian.

---

## Pliki

| Plik                                                | Rola                                      |
| --------------------------------------------------- | ----------------------------------------- |
| `src/lib/ssr/resilientLoad.ts`                      | prymityw (nowy)                           |
| `src/components/molecules/DegradedDataNotice.tsx`   | uczciwy komunikat degradacji (nowy)       |
| `e2e/ssr-degradation.spec.ts`                       | bramka CI (nowa)                          |
| `src/lib/errorCopy.ts`                              | scenariusz `degraded` PL/EN               |
| `src/components/error/FriendlyErrorPage.tsx`        | ikona/kod/nadlinia dla `degraded`         |
| `src/routes/{experts,events,live,programs}.tsx`     | przejście na `loadResilient`              |
| `src/routes/{podcasts.index,web-stories.index}.tsx` | j.w.                                      |
| `src/routes/{podcasts.$show,author.$slug}.tsx`      | j.w. + kontrakt zapytania tożsamościowego |
| `src/routes/__root.tsx`                             | menu chrome'u równolegle z ustawieniami   |
