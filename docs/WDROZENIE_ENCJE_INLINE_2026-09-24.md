# Wdrożenie: encje inline (firma / osoba) w edytorze bloków - 2026-09-24

Wzbogacone nazwy w treści akapitu - wzorzec „Inline Testimonials" (21st.dev /
SmoothUI), przerobiony z cytatu na **kartę firmy albo osoby**. Nazwa w tekście
dostaje awatar/logo (zaokrąglenie **6 px**) i cienką linię pod spodem, a po
najechaniu, fokusie z klawiatury albo tapnięciu otwiera się karta z danymi
i ikonami przy każdym polu.

## Co widzi redakcja

- **Pasek akapitu**: dwa nowe przyciski - _Wstaw firmę (dane z CRM)_
  (ikona budynku) i _Wstaw osobę_ (ikona osoby). Zaznaczony tekst staje się
  nazwą i jest zastępowany odwołaniem.
- **Firma**: wyszukiwarka kartoteki CRM - nazwa, kraj pochodzenia (rozpoznany
  do kodu ISO + nazwy PL/EN), branża, **specjalizacja**, strona www, **media
  społecznościowe**, logo. Dwa ostatnie pola CRM są nowe (migracja
  `20260924120000`) i edytuje się je na karcie firmy w `/admin/companies/$id`.
- **Osoba**: wyszukiwarka użytkowników o roli redakcyjnej (author / editor /
  admin / super_admin - ten sam zbiór co katalog „Autorzy") albo wpis ręczny:
  imię, nazwisko, stanowisko, firma, strona zewnętrzna, media społecznościowe,
  zdjęcie.
- **Kopia w materiale, nie odwołanie do źródła**. Dane zaciągnięte z CRM albo
  z profilu autora trafiają do rejestru dokumentu. Każda zmiana w artykule
  dotyczy **wyłącznie tego materiału** - kartoteka CRM i profil autora nie są
  nigdy zapisywane. „Odśwież z CRM / z profilu" pobiera źródło ponownie,
  świadomie.
- **Obraz**: wgranie z dysku albo z biblioteki mediów, kadrowanie w oknie:
  rozmiar (suwak, +/−), przesuwanie w lewo / prawo / górę / dół (przeciąganie,
  przyciski, strzałki; Shift = większy krok), podgląd 24 px i 44 px z
  zaokrągleniem 6 px, zapis. Wynik to kwadrat 256 px WebP w bibliotece mediów;
  oryginał i parametry kadru są zapamiętane, więc ponowne kadrowanie startuje
  z pełnej jakości.
- **Kopiuj-wklej = synchronizacja**. Gotowe odwołanie można skopiować i wkleić
  w dowolne inne miejsce materiału. Oba miejsca wskazują **ten sam rekord**,
  więc edycja w jednym (klik w nazwę) zmienia wszystkie wystąpienia naraz,
  a publikują się razem z wpisem. Okno edycji pokazuje liczbę wystąpień.
- **Menedżer** „Firmy i osoby" (pasek edytora bloków): lista rekordów materiału
  z licznikiem użyć, edycja, usuwanie nieużywanych.

## Model danych

| Gdzie                                     | Co                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| treść bloku (`data.html`)                 | `<span data-nes-entity="ie_…" data-nes-entity-kind="company">Nazwa</span>` - samo odwołanie; tekst to etykieta zastępcza dla RSS, wyszukiwarki i TTS |
| `blocks_data.{pl,en}.meta.inlineEntities` | rejestr `{ [id]: InlineEntity }` - identyczna kopia w obu wersjach językowych                                                                        |

- Pola tekstowe zależne od języka (branża, specjalizacja, stanowisko) mają
  wartości PL i EN; kraj ma kod ISO i obie nazwy - renderer nie ładuje
  słownika krajów.
- Lustro PL↔EN: `mirrorInlineEntities` przy każdej propagacji edytora
  (`PostBlockEditor`). Rekord używany tylko w drugiej wersji językowej nigdy
  nie znika.
- Wklejenie odwołania do **innego** materiału: rekordy jadą w schowku
  (`application/x-nes-inline-entities` + localStorage jako kanał awaryjny)
  i po wklejeniu stają się kopią materiału docelowego.
- Warstwa czysta: `src/lib/blocks/inlineEntities/` (model, rejestr, dekorator
  renderu, schowek, źródła).

## Render publiczny: SSR, hydratacja, Core Web Vitals

- **Zero zapytań przy SSR**: dane są częścią dokumentu, więc pre-pass
  `precomputeFootnotes` rozwija odwołania w statyczny HTML (po sanityzacji,
  w tych samych polach co przypisy: akapit, nagłówek, lista, cytat, tabela,
  zagnieżdżenia). Budżet sześciu ramion prefetchu trasy się nie zmienia.
- **Hydratacja bez rozjazdów**: dekorator jest czysty i deterministyczny -
  serwer i klient produkują bajt w bajt ten sam HTML. Karta nie renderuje nic
  przy SSR ani przy pierwszym renderze klienta.
- **CLS = 0**: awatar ma `width`/`height`, `aspect-square` i rozmiar w `em`;
  karta jest nakładką `position: fixed` w portalu.
- **LCP**: awatary `loading="lazy"`, `decoding="async"`, `fetchpriority="low"`,
  serwerowo zmniejszone warianty 1x/2x/3x (nigdy oryginał).
- **INP / JS**: jedna delegacja zdarzeń na kontenerze artykułu; kod karty to
  osobny, leniwy chunk ładowany tylko przez artykuły, które mają encje.
- **Dostępność**: prawdziwy `<button>` z `aria-haspopup="dialog"`,
  `aria-expanded`, `aria-controls`; Tab wchodzi do linków karty, Tab z
  ostatniego wraca do tekstu, Escape zamyka i oddaje fokus;
  `prefers-reduced-motion` wyłącza animację. Odwołanie wewnątrz linku
  renderuje się bez przycisku (brak zagnieżdżonych elementów interaktywnych).

## Baza danych

- `20260924120000_crm_company_inline_entities.sql` - `crm_companies.specialization`,
  `crm_companies.social_links` (jsonb, CHECK obiektu) + RPC
  `crm_company_inline_lookup` (SECURITY DEFINER, tenant z `current_tenant_id()`,
  rola redakcyjna, wyłącznie pola publikowalne).
- `20260924120100_editor_inline_author_lookup.sql` - RPC
  `editor_inline_author_lookup` (tylko odczyt, pola publiczne profilu, z
  poszanowaniem `hide_avatar`).

## Testy

- `src/lib/blocks/inlineEntities/__tests__/*` - model, rejestr i lustro,
  dekorator (escaping, linki, determinizm), schowek, źródła.
- `src/components/blocks/__tests__/inlineEntities.test.tsx` - SSR = klient,
  leniwa nakładka, mysz / dotyk / klawiatura, pozycjonowanie.
- `src/components/admin/blocks/inlineEntities/__tests__/*` - węzeł TipTap
  w prawdziwym akapicie, okno (CRM, autorzy, ręcznie, odświeżanie), kadrowanie
  i pole obrazu, provider (schowek między materiałami), pełny `PostBlockEditor`
  (edycja jednego rekordu aktualizuje wszystkie wystąpienia w PL i EN, undo).
