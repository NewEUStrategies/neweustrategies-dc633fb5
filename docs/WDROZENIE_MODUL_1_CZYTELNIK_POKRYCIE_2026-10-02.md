# Moduł 1 „Wpisy: doświadczenie czytelnika": naprawy defektów i domknięcie pokrycia (2026-10-02)

Zamknięcie tabeli pokrycia modułu 1 z wydania 12 audytu
(`AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 16.6): **363 linie bez testu
z 2 620**, 12 plików na zerze. Cztery najsłabsze funkcjonalności (Paywall, Układy wpisu + render,
Powiązane wpisy, Audio TTS) niosły ~359 z tych 363 linii.

Praca szła sześcioma torami (paywall, układy A i B, rekomendacje, audio, reszta modułu). Każdy tor:
naprawa defektów z testem, który pada na starym kodzie → adwersaryjny przegląd diffu → poprawki
po przeglądzie. Każdy naprawiony defekt sprawdzono podmianą pliku na wersję sprzed naprawy.

---

## 1. Pomiar: przed i po

Metoda identyczna po obu stronach: istanbul, mianownik zawężony do plików modułu 1 (`classifyPath`
z `scripts/taxonomy/moduleMap.mjs`), numerator z plików testów, które importują pliki modułu
(118 przed, 142 po). Pełna suita w CI może liczby wyłącznie podnieść.

| Funkcjonalność                                           | Pliki (na zerze) przed → po | Linie przed |   Linie po | Funkcje przed | Funkcje po | Gałęzie przed | Gałęzie po | Niepokryte linie |
| -------------------------------------------------------- | --------------------------: | ----------: | ---------: | ------------: | ---------: | ------------: | ---------: | ---------------: |
| Paywall / bramka dostępu                                 |               6 (2) → 6 (0) |       68,5% | **100,0%** |         76,5% | **100,0%** |         72,0% |  **96,8%** |           51 → 0 |
| Układy wpisu + render                                    |             14 (5) → 15 (0) |       63,0% | **100,0%** |         56,5% | **100,0%** |         51,8% |  **97,3%** |          161 → 0 |
| Powiązane wpisy / rekomendacje                           |             13 (3) → 13 (0) |       80,5% | **100,0%** |         70,0% | **100,0%** |         63,0% |  **95,2%** |           63 → 0 |
| Audio wpisu (TTS)                                        |             16 (1) → 16 (0) |       87,4% | **100,0%** |         84,7% | **100,0%** |         79,8% |  **93,7%** |           95 → 0 |
| Reszta (TOC/przypisy, cytowania, czas czytania, odsłony) |               8 (2) → 8 (0) |       93,1% |  **99,0%** |         89,8% |  **97,9%** |         83,4% |  **97,0%** |           26 → 4 |
| **Moduł 1 razem**                                        |      **107 (13) → 108 (0)** |   **84,9%** |  **99,9%** |     **81,8%** |  **99,7%** |     **75,1%** |  **95,4%** |      **396 → 4** |

Cztery niepokryte linie to `isLegacyFootnoteReferenceHtml` i `processHtmlFootnotes`
w `lib/footnotes.ts`. Konsumentami są `BlocksRenderer` i `htmlToBuilder` (moduł 3), więc w pełnej
suicie te linie są wykonywane. To nie jest martwy kod.

Każdy plik doprowadzony do pełnego pokrycia dostał podłogę w `vitest.config.ts` (blok
„MODUŁ 1, WYDANIE 2026-10-02"). Istniejące podłogi zostały podniesione, m.in. `api/tts.ts`
z 22/50/27/37 do 100/100/100/100.

## 2. Naprawione defekty

Z rejestru audytu (otwarte w wydaniu 12):

- **Paywall ignorował błędy obu zapytań** (`access_plans`, `get_password_hint`): teraz stan
  błędu z ponowieniem zamiast ściany bez oferty.
- **Widget „Karta autora" renderował zaślepkę**: teraz prawdziwa wizytówka z danych wpisu, bez
  nowego zapytania.
- **`AutoLoadNextPost` trwale podmieniał adres i tytuł**: teraz podążają za wpisem w widoku,
  liczone z bieżącej geometrii (także przy skoku bez przewijania), i wracają do pierwotnych.
- **Beacon `related-click` bez bramki Origin (CSRF)**: POST odrzuca obcy origin
  i `Sec-Fetch-Site: cross-site`. Preflight nie odbija już cudzych `*.pages.dev`/`*.workers.dev`.
- **Zgoda personalizacji czytana przed konfiguracją najemcy** oraz **zdublowany `alt` okładki**
  w kartach-linkach rekomendacji.
- **`/api/tts` bez testu handlera**: trasa ma teraz 100% pokrycia.

Znalezione w tej pracy:

- `usePasswordUnlock`: treść odblokowana hasłem na wpisie A renderowała się na wpisie B
  po nawigacji SPA. Spóźniona odpowiedź wypierała odblokowane body innego wpisu. Zablokowany
  `sessionStorage` wywracał stronę. Awaria RPC i limit prób były pokazywane jako „złe hasło"
  i paliły lokalne próby.
- `getVisitorId` bez `crypto.randomUUID` zwracał `null`, więc metering anonimów nie działał.
- 301 z `/post/$slug` wychodziło bez `Cache-Control`. `planDefaultCacheControl` przepuszcza teraz
  dyrektywę trasy dla 301/308 z `Location`. Bariera sesji i deny-lista bez zmian, a 302/307
  pozostają nietknięte.
- CV autora:
  - portal arkusza druku psuł hydratację,
  - podwójne kliknięcie zostawiało tytuł „CV - …",
  - druk odpalał się po odmontowaniu,
  - daty DATE były liczone w strefie maszyny,
  - odwrócony zakres dat drukował się nie po kolei,
  - link nagrody `javascript:` renderował się jako link.
- Sidebar: niewidoczny układ per wpis spadał do twardego układu awaryjnego zamiast do domyślnego
  układu najemcy.
- Audio:
  - `/api/stt` buforował całe ciało przed limitem i przyjmował dowolny typ pliku,
  - w `/api/stt`, `/api/tts` i `post-tts` brakowało terminu dostawcy,
  - `/api/tts` odpowiadał z `Cache-Control: public` przy `Authorization`,
  - odtwarzacz pokazywał czytelnikowi surowy JSON albo komunikat sieci przeglądarki,
  - odmontowanie nie przerywało pobierania.
- `useRecordPostView`: w StrictMode (domyślny klient TanStack Start) odsłona i historia czytania
  nie zapisywały się wcale.
- Skok do przypisu i kliknięcie w spis treści zerowały `history.state` routera.
- `CitationBox`: data dostępu była liczona w UTC.
- Czas czytania wpisów z buildera był zawyżony ok. dwukrotnie, a strona EN liczyła polską zajawkę.
- Przypisy dwujęzycznego dokumentu: w sekcji końcowej pojawiały się noty z drugiego języka.

## 3. Otwarte - poza zakresem tego wdrożenia

- `src/routes/api/public/experiment-event.ts` (moduł 17) ma ten sam brak bramki Origin co
  `related-click`. Do przeniesienia: `isAllowedOrigin` / `isForgedCrossSite`.
- `AutoLoadNextPost`: router nadal stoi na artykule otwartym. Zapis do historii przez łatane
  `window.history.replaceState` w czasie, gdy pasek pokazuje doładowany wpis, ładuje trasę tego
  wpisu. Granica jest opisana przy `writeAddress`. Pełne rozwiązanie wymaga decyzji o nawigacji
  routera.
- Komunikaty 402/429 odtwarzacza są nadal sklejone dwujęzycznie, a nie pobierane ze słownika.
