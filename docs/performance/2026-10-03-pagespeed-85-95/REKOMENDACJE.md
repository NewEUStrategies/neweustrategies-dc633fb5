# Rekomendacje orkiestratora po fazie 1 (stan: 26 werdyktów kontradyktoryjnych, 2026-10-03 wieczorem)

Dokument roboczy Fable 5.1 dla właściciela produktu. Szczegółowy plan fal, własność plików i
arytmetyka wyniku powstają w syntezie (`faza1/PLAN.md`, `faza1/CRITIQUE.md`); tu są wnioski,
które już nie zależą od brakujących werdyktów.

## 1. Czy budowanie strony z widgetów wpływa na to, co poprawiamy?

Tak, znacząco, ale nie jest to jedyna ani największa przyczyna.

Co wynika wprost z architektury widgetowej (builder):

- Dokument: 50-51 bloków inline `<style>` (ok. 133 KB) to typografia i nadpisania per instancja
  widgetu (`[data-w-id]` z `!important`); 107 KB stanu dehydratacji to dokumenty buildera
  nagłówka, stopki i strony głównej; 70 KB `srcset` pochodzi z 72 obrazów widgetów. Łącznie ok.
  60 % surowej wagi HTML (raport `html-weight`).
- Hydratacja: ok. 48 widgetów hydratuje się na starcie, potem następuje ponowny render całego
  drzewa przy przełączeniu klasy urządzenia (25 podmian `<style>`, 166-198 ms przy 4× CPU) i
  pełne przeliczenie stylów po zapisie `--sticky-header-h` na `:root` (874 elementów, 137-177 ms).
  To największe pojedyncze zadania w TBT (raport `hydration`, werdykty H5/H6).
- Hero to widget slidera z `opacity: 0` do czasu hydratacji i `fetchpriority` zależnym od stanu
  JS, więc LCP czeka na JavaScript (`sliderVariants.tsx`, raport `boot-js`, werdykt C3).
- CSS widgetów renderuje się na każdej trasie, więc arkusza nie da się podzielić na „treść” i
  „resztę” (werdykt css:C6 obalony wykonalnościowo).
- Preloady chunków widgetów są potrzebne: bez nich leniwe granice widgetów dają CLS (0,42 w
  1 z 5 przebiegów, `boot-js` F6).

Co nie ma związku z widgetami:

- Największa dźwignia mobile: model symulacji Lighthouse (Lantern) zalicza każdy skrypt modułowy o
  wysokim priorytecie zakończony przed FCP jako blokujący render. To polityka preloadów
  frameworka (manifest TanStack + nagłówek `Link`), nie treść strony. Boot po LCP daje na
  fixture FCP i LCP −2,55 s (werdykt boot-js:C3).
- Największa dźwignia TBT na PSI: gtag.js to ok. 76 % TBT na śladzie mobile i przesuwa TTI z 7,1
  na 10,6 s. To polityka ładowania analityki (raport `third-party`, werdykty TP-1/TP-2).
- Chunk wejściowy JS: 30 % to powłoki ok. 380 tras (213 admina) i tabela tras, 9 % to tablice
  preloadów Vite; w domknięciu bootu siedzą SDK Supabase, zod i słownik admina. To
  architektura aplikacji, nie widgety (raport `boot-js`).
- TTFB i cache dokumentu (tylko Speed Index), przekierowanie 302 `/` → `/en`, wariant botowy
  dokumentu: infrastruktura (raporty `server-cache`, `measurement`).

Wniosek: widgety odpowiadają za szerokość hydratacji i wagę dokumentu, czyli za część TBT i za
sprzężenie, które ujawni się po przeniesieniu bootu za LCP. Dwie największe dźwignie wyniku
(kolejność ładowania JS względem obrazu hero oraz moment ładowania gtag) są od nich niezależne.
Plan nie wymaga rezygnacji z buildera, tylko trzech zmian w sposobie jego renderowania:
statyczny CSS per typ widgetu z wartościami instancji w zmiennych CSS, hydratacja wyspowa dla
widgetów pod zgięciem i elementów nagłówka, hero malowany bez JS.

## 2. Rekomendowane kolejne kroki

1. **Fala 1, wynik PSI**: boot po LCP (wyzwalacz z `PerformanceObserver` dla
   `largest-contentful-paint` + ok. 50 ms, przepisanie manifestu preloadów w buildzie,
   wstrzyknięcie bootstrapu po stronie serwera, tylko publiczne trasy SSR z kandydatem LCP)
   razem z cięciami TBT, bez których sprzężenie zjada zysk: brak ponownego renderu przy
   przełączeniu urządzenia (H6), pomiar nagłówka bez inwalidacji całego dokumentu (H5), jedno
   zapytanie o tokeny projektu i realne rozgrzanie ustawień (H2), skracanie zadań hydratacji
   (LA-C1). Prognoza po werdyktach: mobile 86-90; desktop 95 zależy od TBT ≤ 110 ms na wolnym
   hoście PSI.
2. **Fala 1 równolegle**: polityka gtag z oknem ciszy 5 s po `load` i GA4 bez tagu Ads do zgody
   marketingowej (TP-1/TP-2: +4 do +8 pkt mobile, +2 do +6 desktop). Wymaga decyzji o utracie
   `page_view` od odbić bez interakcji (mitygacja przez Measurement Protocol to osobny projekt).
3. **Fala 2, trwałość**: bramki jako zapadki (waga dokumentu już jest w repo; budżet boot
   579 → 481 KB gzip; pula JS High przed LCP), hero bez `opacity: 0` i bez zdublowanych
   preloadów, dieta stanu dehydratacji (HW-3), statyczny CSS widgetów (HW-2 z css:C8), etap 1
   diety arkusza (wykresy, druk, admin poza rdzeniem) jako porządek przy `check:bundle`.
4. **Poza wynikiem PSI, dla czytelników**: cache dokumentu (snapshot między colo, soft purge),
   deterministyczny wariant dokumentu dla botów i przeglądarek, obserwowalność TTFB. Zero punktów
   w PSI (TTFB nie wchodzi do symulowanych FCP/LCP), realny TTFB i Speed Index.
5. **Decyzje właściciela**: polityka analityki (pkt 2); 302 na `/en` przy pierwszej wizycie EN i
   pomiar PSI wyłącznie z `hl=pl`; UX banera zgód jako powłoka SSR z przełącznikiem przed
   malowaniem; `/~flock.js` (analityka hosta); próg przeglądarek dla usunięcia fallbacku
   `color-mix` (css:C5, −5 KB gzip).

## 3. Co zostało obalone (nie wracać bez nowych dowodów)

- H1 (świeżość zasiewów liczona od hydratacji): 0 zapytań i 0 ms w kanonicznym harnessie.
- H3 (dane widgetów pod zgięciem na żądanie): −3 zapytania, ale ok. 0 pkt.
- HW-1 (CSS z literałów JS do arkusza): ok. 0 pkt dziś, −25..30 ms po boot-js:C3 (CSS rośnie).
- css:C6 (CSS „tras treściowych”): mechanizm niewykonalny bez regresji na `/`; +0,1..0,2 pkt.
- SC-2, SC-3 (snapshot L2, soft purge): 0 pkt w PSI; zostają jako wartość dla czytelników.
- PA-C2 (nowy szósty budżet bootRaw): zamiast tego zacisk istniejącego budżetu boot.
