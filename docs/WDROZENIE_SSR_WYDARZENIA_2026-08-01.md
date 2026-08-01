# Wdrożenie: loader SSR listy wydarzeń (2026-08-01)

Domyka rekomendację audytu `OCENA_FUNKCJI_TABELE_2026-07-30.md` (MODUŁ 7,
"Wydarzenia", ocena 8): _"Brak SSR listy (`events.tsx` bez loadera) → Dodać
loader SSR"_. Mocne strony modułu (waitlist FIFO serwerowy, RSVP-mail
idempotentny, ICS RFC 5545, przypomnienia cron) pozostają nienaruszone.

## Stan przed

`/events` renderował listę wyłącznie po hydratacji: komponent trzymał goły
`useQuery(["public-events"])` bez loadera trasy, więc SSR wysyłał nagłówek
strony i "Ładowanie...", a crawler (i czytelnik na wolnym łączu) nie widział
ani jednej karty wydarzenia. Meta tytuł/opis istniały, ale bez danych
strukturalnych listy.

## Stan po

### Warstwa danych (`lib/community/publicQueries.ts`)

- `publicEventsQueryOptions()` - współdzielone `queryOptions` z kluczem
  `["public-events"]`, IDENTYCZNYM z rejestrem inwalidacji realtime
  (`lib/realtime/eventInvalidationMap.ts`): zmiana wiersza `events`
  unieważnia listę na żywo, SSR i klient dzielą jeden wpis cache.
- Na serwerze odczyt stoi za `edgeTtlCache("public:events-list", 60 s)` -
  per-tenantowy TTL cache kluczowany hostem żądania (izolację danych i tak
  egzekwuje RLS przez `public_tenant_id()`); w przeglądarce cache'em jest
  sam React Query (`staleTime` 60 s, `gcTime` 10 min).
- `fetchPublicEvents` przestał być eksportowany - jedynym wejściem są
  queryOptions, więc nie da się ominąć cache ani rozjechać klucza.

### Trasa `/events` (`routes/events.tsx`)

- Loader: bramka modułu `community_modules.events_enabled` rozstrzygana
  serwerowo i fail-soft (odczyt `site_settings` dedupuje się z root loaderem;
  błąd degraduje do bezpiecznych domyślnych "włączone"), sama lista fail-loud
  przez `ensureQueryData(publicEventsQueryOptions())` - awaria backendu
  renderuje `errorComponent` z retry zamiast pustej strony.
- Komponent: bramka `CommunityDisabled` w rodzicu, body na `useSuspenseQuery`
  (markup listy schodzi z serwera; stany przejściowe przejęły
  `pendingComponent`/`errorComponent`, więc lista nie miga komunikatami).
  Tło refetchu po inwalidacji realtime nie chowa już listy - poprzednio
  `isError` tła zasłaniał dane.
- `pendingComponent`: nowa molekuła `EventsListSkeleton`
  (`components/community/`) odwzorowująca siatkę strony (nagłówek + karty
  `md:grid-cols-2` z okładką `aspect-video`), dekoracyjna (`aria-hidden`).
- `errorComponent`: wspólna molekuła `RouteErrorFallback` z tytułem PL/EN.

### SEO / GEO (`lib/seo/jsonld.ts` + `head()` trasy)

- Nowy builder `eventsCollectionJsonLd`: `CollectionPage` + `ItemList`
  PEŁNYCH węzłów `schema.org/Event` (nazwa, url, `startDate`/`endDate`,
  `eventStatus`, `eventAttendanceMode` mapowany z `events.kind` - Online dla
  webinar/ama/online/briefing, Offline dla in_person, Mixed dla hybrid,
  nieznane rodzaje uczciwie bez trybu; `Place` dla sali, `VirtualLocation`
  wskazujący stronę wydarzenia dla zdalnych - link do transmisji zostaje za
  bramką RSVP i nigdy nie trafia do markupu; okładka jako `image`;
  `organizer` referencją do węzła organizacji).
- Loader zwraca lekką projekcję maks. 30 NADCHODZĄCYCH wydarzeń pod head()
  (pełne wiersze jadą raz - w dehydratowanym cache React Query), `head()`
  emituje kolekcję + `BreadcrumbList` przez `safeJsonLd`, per język PL/EN
  (`localizedPath`).
- Tytuł ujednolicony z resztą list: krótki `og:title` + brandowany
  `documentTitle` (`... - New European Strategies`).

## Testy

- `src/lib/seo/__tests__/eventsJsonld.test.ts` (nowy, 4 przypadki) - pełne
  węzły Event z URL-ami per język, mapowanie trybów uczestnictwa (bez
  zgadywania dla nieznanych rodzajów), `Place`/`VirtualLocation`/oba dla
  hybrydy/brak lokalizacji, opcjonalna emisja `endDate`/`image`.
- Pełny pakiet: 420 plików / 3670 testów zielone; `tsc --noEmit` i ESLint
  czyste; build produkcyjny przechodzi.

## Pliki

- `src/lib/community/publicQueries.ts` (queryOptions + cache SSR)
- `src/lib/seo/jsonld.ts` (`eventsCollectionJsonLd`)
- `src/routes/events.tsx` (loader, head z JSON-LD, suspense, pending/error)
- `src/components/community/EventsListSkeleton.tsx` (nowy)
- `src/lib/seo/__tests__/eventsJsonld.test.ts` (nowy)
