// Zasoby i18n dla dashboardów BI w panelu analityki (/admin/analytics).
// Obejmuje wspólne prymitywy (ChartCard, TimeRangeFilter, InsightSection) oraz
// dashboardy: Related, Web Vitals, Audytorium, GSC i GA4 wraz z generatorami
// interpretacji (gscInsights / ga4Insights).
import i18n from "@/lib/i18n";

const pl = {
  adminAnalytics: {
    common: {
      refresh: "Odśwież",
      loading: "Ładowanie...",
      loadingData: "Ładowanie danych...",
      noDataWindow: "Brak danych w oknie.",
    },
    chartCard: {
      exportPng: "Eksport PNG",
      exportCsv: "Eksport CSV",
      fullscreen: "Pełny ekran",
      exitFullscreen: "Zamknij pełny ekran",
    },
    timeRange: {
      preset24h: "24 godz.",
      preset7d: "7 dni",
      preset14d: "14 dni",
      preset28d: "28 dni",
      preset30d: "30 dni",
      preset90d: "90 dni",
      range: "Zakres",
      pickHint: "Wybierz początek i koniec",
      apply: "Zastosuj",
    },
    insightSection: {
      defaultTitle: "Interpretacja i rekomendacje",
      emptyDefault: "Nie znaleziono krytycznych zagadnień - utrzymaj obecną strategię.",
      badgeCritical: "{{count}} krytycznych",
      badgeWarn: "{{count}} do poprawy",
      badgeInfo: "{{count}} obserwacji",
      badgeOk: "{{count}} OK",
    },
    related: {
      windowInfo: "Analiza per tenant, okno {{days}} dni",
      views: "Views",
      uniques: "Unikalnych",
      coocLabel: "wspólnych wpisów: ",
      clicksShort: "klik.",
      hubClicksLabel: "Klik.: ",
      hubSourcesLabel: "Źródeł: ",
      kpi: {
        posts: "Wpisy opublikowane",
        views: "Wyświetlenia (okno)",
        clicks: "Klik. w rekomendacje",
        reads: "Czytania (zalogowani)",
      },
      charts: {
        topCatsTitle: "Top kategorie",
        topCatsSubtitle: "Liczba opublikowanych wpisów w kategorii",
        topTagsTitle: "Top tagi",
        topTagsSubtitle: "Liczba opublikowanych wpisów z tagiem",
        coocTitle: "Współwystępowanie tagów",
        coocSubtitle:
          "Heatmapa: ile wpisów łączy dwa tagi (im ciemniej, tym silniejsza więź w grafie rekomendacji)",
        popularityTitle: "Popularność wpisów",
        popularitySubtitle:
          "Wyświetlenia vs unikalni odwiedzający - kandydaci do wzmocnienia w silniku",
        hubTitle: "Hub-posty (najczęstsze cele klików)",
        hubSubtitle: "Wpisy w które ludzie klikają z rekomendacji",
        sankeyTitle: "Ścieżki źródło → cel (klik w rekomendację)",
        sankeySubtitle:
          "Sankey top-25 par - pokazuje jak rekomendacje realnie kierują ruch między wpisami",
      },
      insightsTitle: "Interpretacja i rekomendacje - silnik rekomendacji",
      insightsSubtitle:
        "Diagnoza sygnałów per tenant + konkretne działania do zastosowania w konfiguracji",
      insights: {
        noClicks: {
          element: "Rekomendacje",
          title: "Brak klików w rekomendacje w oknie",
          detail:
            "Odnotowano {{views}} wyświetleń wpisów, ale 0 klików w powiązane. Sygnały nie działają lub nie są wyświetlane.",
          fixes: [
            "Sprawdź czy sekcja Powiązane wpisy jest włączona globalnie i pod wpisami.",
            "Zmniejsz próg `min_score` w zakładce Konfiguracja - być może wszystko jest odfiltrowane.",
            "Sprawdź czy strategia źródła nie jest zbyt restrykcyjna (spróbuj `Kategorie + Tagi`).",
          ],
        },
        ctr: {
          element: "KPI - CTR rekomendacji",
          title: "CTR rekomendacji: {{ctr}}%",
          detail: "{{clicks}} klik. na {{views}} wyświetleń. Benchmark redakcyjny: 1-3%.",
          fixesGood: [
            "Utrzymaj obecną konfigurację, testuj większy `items_limit` żeby zwiększyć zasięg.",
          ],
          fixesBad: [
            "Podnieś wagę `weight_tags` - tagi lepiej łączą niepowiązane kategorie.",
            "Włącz `use_idf` - rzadkie tagi tworzą trafniejsze pary.",
            "Zmień `layout` na slider - często zwiększa CTR na mobile.",
          ],
        },
        smallCats: {
          element: "Struktura - kategorie",
          title: "{{count}} kategorii z <3 wpisami",
          detail:
            "Kategorie o niskiej liczności generują ubogie rekomendacje. Silnik dopasuje 1-2 wpisy i skończy.",
          fixes: [
            "Scal małe kategorie w jedną (np. redirects + aktualizacja post_categories).",
            "Podnieś wagę `weight_tags` względem `weight_categories` - tagi pokryją większy graf.",
          ],
        },
        noReads: {
          element: "Personalizacja - historia czytania",
          title: "Brak sygnałów z historii czytania zalogowanych użytkowników",
          detail:
            "user_read_history jest puste w tym oknie - personalizacja nie ma na czym się oprzeć.",
          fixes: [
            "Wpięcie logowania czasu czytania (np. IntersectionObserver + timer) do user_read_history.",
            "Do czasu zebrania danych utrzymuj `weight_personalization` na 3 - nie zaszkodzi, a zacznie działać automatycznie.",
          ],
        },
        sparseTags: {
          element: "Otagowanie",
          title: "Rzadki graf współwystępowania tagów",
          detail:
            "Średnia liczba wspólnych wpisów w parze tagów to {{avg}}. Silnik ma mało punktów zaczepienia.",
          fixes: [
            "Dotaguj wpisy - cel: min. 3 tagi/wpis, każdy tag min. 5 wpisów.",
            "Zbuduj słownik tagów kanonicznych (unikaj duplikatów typu 'AI' vs 'ai' vs 'sztuczna inteligencja').",
          ],
        },
        healthyTags: {
          element: "Otagowanie",
          title: "Zdrowy graf tagów",
          detail: "Średnio {{avg}} wspólnych wpisów na parę - IDF ma z czego liczyć.",
        },
        hub: {
          element: "Hub - najsilniej rekomendowany",
          title: "Hub-post: {{name}}",
          detail: "{{clicks}} klik. z {{sources}} różnych źródeł. To wpis który wchłania ruch.",
          fixes: [
            "Zadbaj o CTA / konwersję na tej stronie - trafia tu dużo osób z rekomendacji.",
            "Rozważ dodanie tego wpisu do menu głównego lub sidebar 'Polecane'.",
          ],
        },
        mismatch: {
          element: "Popularność vs rekomendacja",
          title: "{{count}} popularnych wpisów spoza top-10 rekomendacji",
          detail:
            "Wpisy z dużym ruchem nie trafiają do rekomendacji - silnik nie promuje najsilniejszych treści.",
          fixes: [
            "Podnieś `weight_popularity` (np. 3-4) - popularność wzmocni ranking.",
            "Sprawdź otagowanie tych wpisów - być może są izolowane w grafie kategorii/tagów.",
          ],
        },
      },
    },
    vitals: {
      refreshAria: "Odśwież dane Web Vitals",
      lastRefresh: "Ostatnie odświeżenie: {{time}}",
      refreshing: "Odświeżanie…",
      samplesInWindow: "Próbek w oknie: {{count}}",
      cappedNote: " (agregacja z najnowszych 20 000)",
      noSamples:
        "Brak próbek RUM w wybranym oknie. Otwórz kilka podstron w prawdziwym trybie (nie w edytorze) - beacony trafią do tabeli i pojawią się tu automatycznie.",
      trendTitle: "{{metric}} - trend p75",
      trendSubtitle: "Pasma: zielone Good, żółte Needs, czerwone Poor",
      ratingsPerMetric: "Ratingi per metryka",
      ratingsSubtitle: "Liczba próbek Good / Needs / Poor",
      ratingOverall: "Rating ogółem",
      ratingOverallSubtitle: "Cały panel próbek w oknie",
      samplesWord: "próbek",
      samplesLabel: "Próbek",
      pathsBySamples: "Ścieżki wg liczby próbek",
      pathsSubtitle: "Wielkość = próbki, kolor = LCP p75 (zielony → czerwony)",
      allGood: "Wszystkie metryki w normie",
      allGoodDetail:
        "Web Vitals w wybranym oknie są w strefie Good. Utrzymaj obecną budżetyzację obrazów, lazy-loading widgetów i cache CDN.",
      scopePath: "ścieżka",
      scopeGlobal: "globalne",
      moreFindings:
        "Pokazano 12 z {{count}} znalezisk. Napraw najpierw krytyczne - reszta zwykle idzie za nimi.",
      globalDetail:
        "p75 = {{p75}}. W oknie: {{good}} Good · {{ni}} Needs · {{poor}} Poor (razem {{count}} próbek).",
      pathTitle: "{{metric}} na {{path}} = {{value}}",
      pathDetail: "Próbek dla ścieżki: {{total}}. Próg Poor: {{threshold}}.",
      playbook: {
        LCP: {
          ni: {
            title: "LCP w strefie ostrzegawczej",
            fixes: [
              'Preload obrazu bohatera (LCP) w head route\'a: rel="preload" as="image" fetchpriority="high".',
              "Konwertuj obraz LCP do AVIF/WebP (vite-imagetools) i podawaj srcset dla 1x/2x.",
              'Dodaj width/height + loading="eager" dla LCP; loading="lazy" reszcie.',
              "Skróć krytyczną ścieżkę CSS: załaduj fonty jako preload woff2 + font-display: swap.",
            ],
          },
          poor: {
            title: "LCP powyżej progu - widoczny lag ładowania",
            fixes: [
              'Sprawdź czy LCP to obraz - jeśli tak, wymuś fetchpriority="high" i preload w head().',
              "Odłóż niekrytyczne skrypty innych firm (analytics, chat) - defer/async lub po requestIdleCallback.",
              "Zmniejsz payload SSR: przenieś ciężkie widgety do React.lazy + Suspense.",
              "Włącz cache CDN na obrazy i statyki (Cache-Control: public, max-age=31536000, immutable).",
            ],
          },
        },
        INP: {
          ni: {
            title: "INP w strefie ostrzegawczej",
            fixes: [
              "Rozbij długie zadania JS (>50 ms) na chunki: scheduler.yield() lub setTimeout(0).",
              "Zredukuj rerendery: React.memo, useMemo, useCallback dla ciężkich list.",
              "Debounce inputów w formularzach i wyszukiwarce (150-250 ms).",
            ],
          },
          poor: {
            title: "INP wysokie - interakcje są odczuwalnie ślamazarne",
            fixes: [
              "Profiluj Long Tasks w Performance panelu - namierz handler powyżej 200 ms.",
              "Przenieś ciężką kalkulację do useDeferredValue lub web workera.",
              "Usuń synchroniczne setState w onClick - zamień na startTransition.",
            ],
          },
        },
        CLS: {
          ni: {
            title: "CLS w strefie ostrzegawczej - jest przeskakiwanie",
            fixes: [
              "Podaj width/height na każdym <img>, <video>, <iframe> aby zarezerwować miejsce.",
              "Dla dynamicznych banerów/reklam ustaw min-height kontenera zanim ad się załaduje.",
              "Wczytuj fonty przez preload woff2 + font-display: swap zamiast optional/block.",
            ],
          },
          poor: {
            title: "CLS wysokie - layout skacze przy renderze",
            fixes: [
              "Znajdź źródło shiftu: DevTools > Performance > Experience > Layout Shifts (zaznacz node).",
              "Przypnij wysokość skeletonów do finalnej wysokości kontentu.",
              "Nie wstrzykuj bannerów/notyfikacji nad treścią - używaj bottom sheet / toast overlay.",
            ],
          },
        },
        FCP: {
          ni: {
            title: "FCP wolniejszy niż zalecane 1.8 s",
            fixes: [
              "Skróć TTFB (patrz sekcja TTFB) - FCP idzie za nim.",
              "Preload krytycznego CSS (styles.css) i głównego fontu - już masz Red Hat Display, upewnij się że preload trafia.",
              "Zmniejsz blokujący JS w head - przenieś skrypty do defer.",
            ],
          },
          poor: {
            title: "FCP powyżej 3 s - pusty ekran zbyt długo",
            fixes: [
              "Włącz SSR streaming - fragmenty HTML lecą do klienta zanim skończy się loader.",
              "Wyeliminuj render-blocking third-party (fonty Google, tag manager przed critical CSS).",
              "Sprawdź czy CDN cache trafia (Cache-Status: HIT) - miss oznacza cold path do origin.",
            ],
          },
        },
        TTFB: {
          ni: {
            title: "TTFB powyżej 800 ms",
            fixes: [
              "Włącz cache SSR dla stron kategorii/wpisów (stale-while-revalidate).",
              "Skróć zapytania w loaderze - użyj context.queryClient.ensureQueryData zamiast wielu sekwencyjnych fetchy.",
              "Sprawdź czas RLS: przenieś ciężkie polityki do funkcji SECURITY DEFINER.",
            ],
          },
          poor: {
            title: "TTFB powyżej 1.8 s - serwer zbyt wolno odpowiada",
            fixes: [
              "Zprofiluj server functions: dodaj console.time w handler(), wyszukaj zapytania > 500 ms.",
              "Sprawdź slow_queries w Lovable Cloud - dodaj indeksy na kolumnach z WHERE / ORDER BY.",
              "Rozważ edge caching (Cache-Control: s-maxage=60, stale-while-revalidate=600) dla list publicznych.",
            ],
          },
        },
        FID: {
          ni: { title: "FID - legacy metric", fixes: [] },
          poor: { title: "FID - legacy metric", fixes: [] },
        },
      },
    },
    audience: {
      title: "Audytorium: zalogowani vs anonimowi",
      descPre: "Segmentacja odsłon z ",
      descPost: " per tenant. Wskaźniki liczone w oknie.",
      logged: "Zalogowani",
      anon: "Anonimowi",
      dailyViews: "Odsłony dziennie (stacked)",
      sampleTruncated: "próba przycięta",
      topLogged: "Top - zalogowani",
      topAnon: "Top - anonimowi",
      uniqueHint: "{{count}} unikalnych",
      uniqShort: "uniq",
      kpi: {
        viewsTotal: "Odsłony razem",
        logged: "Zalogowani",
        anon: "Anonimowi",
        uniqueReaders: "Unikalni czytelnicy",
      },
      insights: {
        empty: {
          element: "KPI",
          title: "Brak danych w oknie",
          detail: "W wybranym zakresie nie zapisano żadnej odsłony.",
          fixes: [
            "Sprawdź, czy skrypt zliczania odsłon (post_views) uruchamia się na stronach publicznych.",
            "Wydłuż zakres do 90 dni.",
          ],
        },
        lowLogged: {
          element: "Segment zalogowanych",
          title: "Zalogowani to tylko {{pct}}% odsłon",
          detail:
            "Ruch jest zdominowany przez anonimowych. Retencja i personalizacja mają ograniczony wpływ.",
          fixes: [
            "Rozważ CTA rejestracji przy topowych wpisach z segmentu anonimowego.",
            "Zaproponuj bookmarki / newsletter na końcu artykułów.",
          ],
        },
        highLogged: {
          element: "Segment zalogowanych",
          title: "Zalogowani dostarczają {{pct}}% odsłon",
          detail: "Baza użytkowników silnie wraca do treści - dobre podłoże pod rekomendacje.",
          fixes: [
            "Podnieś wagę personalizacji w silniku rekomendacji.",
            "Testuj sekcje 'Dalej dla Ciebie' pod topowymi wpisami zalogowanych.",
          ],
        },
        loyalLogged: {
          element: "Retencja zalogowanych",
          title: "Zalogowany czyta średnio {{count}} wpisów",
          detail: "Zaangażowanie w tym segmencie jest wysokie.",
          fixes: ["Zbuduj widok 'Ostatnio czytane' dla zalogowanych na stronie profilu."],
        },
        trunc: {
          element: "Dane wejściowe",
          title: "Wyniki przycięte do 50 000 rekordów",
          detail: "W wybranym oknie jest więcej odsłon niż limit. Wartości mogą być zaniżone.",
          fixes: ["Zawęź zakres do krótszego okna (np. 7 dni)."],
        },
      },
    },
    gsc: {
      property: "Właściwość",
      selectProperty: "Wybierz właściwość",
      window: "Okno",
      clicks: "Kliknięcia",
      impressions: "Wyświetlenia",
      ctrPct: "CTR %",
      avgPosition: "Śr. pozycja",
      other: "Inne",
      clicksShort: "klik.",
      clicksLabel: "Kliknięcia: ",
      impressionsLabel: "Wyświetlenia: ",
      ctrLabel: "CTR: ",
      positionLabel: "Pozycja: ",
      notConfiguredPre: "Search Console nie jest jeszcze podłączony. Wróć do zakładki ",
      notConfiguredTab: "Przegląd",
      notConfiguredPost: ' i użyj przycisku „Połącz Search Console".',
      csvTrendHeaders: ["data", "kliknięcia", "wyświetlenia", "ctr", "pozycja"],
      csvQueriesHeaders: ["zapytanie", "kliknięcia", "wyświetlenia", "ctr", "pozycja"],
      charts: {
        trendTitle: "Trend widoczności",
        trendSubtitle: "Kliknięcia i wyświetlenia w czasie + CTR (linia przerywana)",
        topQueriesTitle: "Top 15 zapytań",
        topQueriesSubtitle: "Rank wg kliknięć",
        positionTitle: "Rozkład pozycji SERP",
        positionSubtitle: "Wyświetlenia i kliknięcia wg przedziału pozycji",
        countriesTitle: "Kraje",
        countriesSubtitle: "Kliknięcia wg kraju",
        devicesTitle: "Urządzenia",
        devicesSubtitle: "Kliknięcia wg typu urządzenia",
        pagesTitle: "Strony wg wyświetleń",
        pagesSubtitle: "Treemap top 20 stron (wielkość = wyświetlenia)",
        calendarTitle: "Aktywność dzienna",
        calendarSubtitle: "Heatmapa kalendarzowa - kliknięcia per dzień",
      },
      insightsSubtitle: "Analiza dla właściwości {{site}} · okno {{days}} dni",
      insights: {
        clicks: {
          element: "KPI · Kliknięcia",
          titleNoDelta: "Kliknięcia w oknie: {{clicks}}",
          titleDelta: "Kliknięcia {{delta}}% vs poprzednie okno",
          detail:
            "W bieżącym oknie {{days}} dni: {{clicks}} klik. Poprzednio: {{prev}}. Wyświetlenia: {{impr}} (poprzednio {{prevImpr}}).",
          fixesDown: [
            "Sprawdź w GSC Coverage czy nie wypadły ważne strony (soft 404 / noindex).",
            "Zweryfikuj czy zmieniłeś tytuły/meta description na TOP stronach - CTR mogło spaść.",
            "Uruchom `/admin/seo` i przeindeksuj strony z największym spadkiem impressions.",
          ],
          fixesUp: [
            "Utrwal trend: dodaj wewnętrzne linki do stron, które ostatnio zyskały.",
            "Zbierz nowe frazy z Top zapytań i rozwiń content pod długi ogon.",
          ],
          fixesStable: ["Utrzymaj rytm publikacji - stabilny trend jest dobrą bazą do skalowania."],
        },
        ctr: {
          element: "KPI · CTR",
          title: "CTR {{ctr}}% przy pozycji {{pos}}",
          detail:
            "Oczekiwany CTR dla tej pozycji: ~{{exp}}%. Twój CTR jest {{cmp}} o {{gap}} pp. Zmiana vs poprzednie okno: {{dctr}} pp.",
          cmpHigher: "wyższy",
          cmpLower: "niższy",
          fixesLow: [
            "Przepisz meta title na TOP stronach: dodaj korzyść + rok + brand na końcu (≤ 60 znaków).",
            "Popraw meta description: konkretna wartość + CTA (≤ 155 znaków).",
            "Wdroż FAQ / HowTo schema.org - często dają rich results w SERP.",
            "Sprawdź faktyczny snippet w SERP (site:) - czasem Google generuje własny opis; wtedy popraw H1/pierwszy akapit.",
          ],
          fixesGood: [
            "Utrzymaj stylistykę tytułów - działa. Wprowadź ten sam wzorzec na słabszych stronach.",
          ],
        },
        position: {
          element: "KPI · Śr. pozycja",
          title: "Średnia pozycja: {{pos}} ({{delta}})",
          detailWorse: "Pozycja pogorszyła się o {{n}} miejsc - spadek widoczności.",
          detailBetter: "Pozycja poprawiła się o {{n}} miejsc.",
          detailStable: "Pozycja stabilna względem poprzedniego okna.",
          fixesWorse: [
            "Zbadaj konkurencję TOP-3 pod Twoje TOP frazy (SEMrush SERP analysis).",
            "Zaktualizuj najstarsze wpisy z najlepszymi frazami: refresh treści + data modyfikacji.",
            "Dodaj wewnętrzne linki z filarowych stron do artykułów tracących pozycje.",
          ],
          fixesStable: ["Utrzymaj tempo linkowania wewnętrznego i publikacji."],
        },
        trend: {
          element: "Trend widoczności",
          titleNoData: "Trend widoczności - brak dostatecznych danych",
          title: "Druga połowa okna: {{delta}}% klik. vs pierwsza",
          detail: "Kliknięcia H1: {{early}}, H2: {{late}}. Kierunek trendu w oknie {{days}} dni.",
          fixesDown: [
            "Sprawdź logi crawlowania w GSC - może pojawił się blok robots / 5xx.",
            "Zweryfikuj sitemap.xml (świeżość + brak 404).",
            "Uruchom URL Inspection dla stron które utraciły ruch.",
          ],
          fixesDefault: [
            "Analizuj korelację ze świętami / weekendami - w B2B typowy spadek weekendowy.",
          ],
        },
        topQueries: {
          element: "Top 15 zapytań",
          titleBranded: "Ruch mocno brandowy ({{pct}}%)",
          titleZeroClick: "{{count}} fraz z ≥20 wyśw. i 0 klik.",
          detailBranded:
            "Ponad połowa kliknięć pochodzi z fraz brandowych - brakuje widoczności generycznej.",
          detailZeroClick:
            "Wysokie impressions bez kliknięć = SERP snippet nie sprzedaje. Fraz: {{count}}.",
          fixesBranded: [
            "Zbuduj content pod generic long-tail (poradniki, case studies) w tematach z branży.",
            "Skorzystaj z SEMrush keyword research: filtruj KD < 30 i intent Informational.",
            "Zlinkuj artykuły filarowe (pillar page) z ich klastrami tematycznymi.",
          ],
          fixesZeroClick: [
            "Weź 5 fraz z 0-CTR i przepisz meta title + description z korzyścią / liczbą.",
            "Zbuduj FAQ na tych stronach - Google chętnie promuje snippet Q&A.",
          ],
        },
        positionHistogram: {
          element: "Rozkład pozycji SERP",
          title: "{{pct}}% wyświetleń w TOP 10",
          detail:
            'TOP3: {{top3}}, TOP4-10: {{top10}}, TOP11-20: {{top20}}, 21+: {{deep}}. Grupa 11-20 to "striking distance" - najłatwiejszy zysk.',
          fix1: "Wypisz wszystkie zapytania z pozycji 11-20 - to najlepszy ROI. Dodaj sekcje tematyczne + linki wewnętrzne.",
          fix2: "Do najbardziej dochodowych fraz z TOP4-10 dodaj FAQ / listę + zaktualizuj rok w tytule.",
          fix3Low: "Rozważ backlinki tematyczne - bez off-site trudno wskoczyć z 20+ do TOP10.",
          fix3High: "Utrzymuj świeżość - refresh co 6 miesięcy dla TOP fraz.",
        },
        countries: {
          element: "Kraje",
          title: "Dominujący kraj: {{country}} ({{pct}}%)",
          detail: "{{count}} krajów w wynikach. Top 3: {{top3}}.",
          fixesSingle: [
            "Jeden rynek = jedno ryzyko. Rozważ wersję EN dla najsilniejszych treści (i18n już masz).",
            "Ustaw hreflang na przetłumaczonych stronach - Google poda właściwą wersję per kraj.",
          ],
          fixesMulti: [
            "Podłącz country-specific meta description dla topowych rynków.",
            "Uruchom Merchant/Business Profile w krajach z ≥5% ruchu (jeśli B2C).",
          ],
        },
        devices: {
          element: "Urządzenia",
          title: "Mobile {{mobile}} klik., desktop {{desktop}} klik.",
          detail: "CTR: mobile {{mctr}}%, desktop {{dctr}}%. {{note}}",
          noteGap: "Desktop wyraźnie przoduje - mobilny snippet nie działa.",
          noteEven: "Równomierny rozkład CTR.",
          fixesGap: [
            "Skróć meta title do 50 znaków (mobile SERP ucina wcześniej).",
            "Sprawdź LCP mobile w Web Vitals - wolne mobile = niższy CTR.",
            "Zweryfikuj sticky headery i cookie bar - blokują first paint na mobile.",
          ],
          fixesEven: [
            "Utrzymuj responsywność. Warto przetestować AMP tylko jeśli publikujesz newsy.",
          ],
        },
        pages: {
          element: "Strony wg wyświetleń",
          title: "{{low}} stron znacząco poniżej benchmarku CTR, {{winners}} powyżej",
          detail:
            "Analiza {{count}} stron z ≥30 wyświetleń. Sortuj: kolor treemapy = CTR (zielone = mocne, czerwone = słabe).",
          fixes: [
            "Weź 3 najsłabsze strony i przepisz H1 + meta title - najszybszy efekt.",
            "Ze zwycięzców skopiuj wzorzec: układ H1 + CTA + FAQ na słabsze strony.",
            "Wewnętrzne linki: z winnerów podlinkuj strony z niską widocznością - transfer autorytetu.",
          ],
        },
        calendar: {
          element: "Aktywność dzienna",
          titleZeros: "{{zeros}}/{{total}} dni bez kliknięć",
          titleSpike: "Szczyt: {{clicks}} klik. {{date}}",
          detailZeros:
            "Duża liczba zerowych dni sugeruje wąską niszę lub problem z indeksacją długi czas.",
          detailSpike:
            "Największy szczyt aktywności w wybranym oknie: {{date}} ({{clicks}} klik.).",
          fixesZeros: [
            "Zwiększ częstotliwość publikacji - target 2-3 posty tygodniowo daje ciągły dopływ impressions.",
            "Uruchom URL Inspection dla zerowych dni w kluczowych URL.",
            "Rozważ syndication (LinkedIn / newsletter) - dywersyfikuje źródła ruchu.",
          ],
          fixesSpike: ["Zbadaj co spowodowało szczyt - powtórz format / temat / dystrybucję."],
        },
      },
    },
    ga4: {
      window: "Okno",
      modeOauth: "OAuth",
      modeServiceAccount: "Service Account",
      modeLabel: "Tryb: ",
      notConfiguredPre: "GA4 Data API nie jest jeszcze skonfigurowany. Wróć do zakładki ",
      notConfiguredTab: "GA4",
      notConfiguredPost: " i podłącz Service Account lub OAuth refresh token.",
      apiError: "Błąd Data API: {{error}}",
      sessions: "Sesje",
      activeUsers: "Aktywni użytkownicy",
      views: "Odsłony",
      engagement: "Zaangażowanie",
      other: "Inne",
      radar: {
        engagement: "Zaangażowanie",
        sessionTime: "Czas sesji",
        viewsPerSession: "Odsłon/sesja",
        retention: "Retencja (100 - bounce)",
        events: "Eventy",
        seriesName: "Ostatnie {{days}} dni",
      },
      charts: {
        trendTitle: "Trend ruchu",
        trendSubtitle: "Sesje, użytkownicy i odsłony w oknie",
        engagementTitle: "Zaangażowanie",
        engagementSubtitle: "5 wymiarów jakości ruchu",
        sourcesTitle: "Źródła ruchu",
        sourcesSubtitle: "Sesje wg sessionSource",
        countriesTitle: "Kraje",
        countriesSubtitle: "Sesje wg kraju",
        devicesTitle: "Urządzenia",
        devicesSubtitle: "Sesje wg typu urządzenia",
        topPagesTitle: "Top strony",
        topPagesSubtitle: "Rank wg odsłon",
      },
      insightsSubtitle: "Analiza GA4 · okno {{days}} dni · tryb: {{mode}}",
      insights: {
        sessions: {
          element: "KPI · Sesje",
          titleNoDelta: "Sesje: {{sessions}}",
          titleDelta: "Sesje {{delta}}% vs poprzednie {{days}} dni",
          detail: "Bieżące: {{sessions}}, poprzednie: {{prev}}. Aktywni: {{active}}.",
          fixesDown: [
            "Sprawdź GA4 > Acquisition > Traffic acquisition - który kanał spadł?",
            "Jeśli spadł organic - patrz GSC (Search Console).",
            "Jeśli spadł direct - sprawdź czy nie zniknął istotny backlink lub kampania.",
          ],
          fixesUp: [
            "Skaluj kanał który zyskał - powtórz publikacje w podobnym stylu.",
            "Dopracuj retencję: newsletter/RSS na stronach które zyskały ruch.",
          ],
          fixesStable: ["Trend stabilny - dobra baza do eksperymentów CRO."],
        },
        engagement: {
          element: "KPI · Zaangażowanie",
          title: "Engagement rate {{rate}}%",
          detail:
            "Benchmark: >60% świetnie, 40-60% średnio, <40% problem z jakością ruchu lub UX. Zmiana: {{delta}} pp.",
          fixesLow: [
            "Skróć LCP i INP w Web Vitals - wolne strony = odbicie w pierwszych 3 sekundach.",
            "Dopasuj intent: sprawdź czy landing page odpowiada na frazę, którą wpisał user.",
            "Zredukuj popupy/modale w pierwszej sesji - Google traktuje je jak intruzywne.",
          ],
          fixesGood: [
            "Utrzymuj obecny UX - dodaj mikroeventy (scroll depth 75%) do lepszej segmentacji.",
          ],
        },
        trend: {
          element: "Trend ruchu",
          titleNoData: "Trend - brak wystarczających danych",
          title: "Druga połowa okna: {{delta}}% sesji",
          detail: "Sesje H1: {{early}}, H2: {{late}}. Sygnalizuje kierunek w bieżącym oknie.",
          fixesDown: [
            "Zestaw z GSC: jeśli GSC bez spadku - to problem po stronie GA4 (filtry, blokada IP).",
            "Sprawdź integrację analytics w consent bannerze - blokujący consent = spadek sesji.",
          ],
          fixesDefault: ["Kontynuuj obecną strategię publikacji."],
        },
        sources: {
          element: "Źródła ruchu",
          title: "Direct {{direct}}%, Google {{organic}}%",
          detail: "{{count}} źródeł. TOP 3: {{top3}}.",
          fixesDirect: [
            "Wysoki direct = brak UTM w kampaniach lub problem z referrerem. Otaguj wszystkie linki (utm_source/medium/campaign).",
            "Sprawdź czy strona jest publikowana w social - dodaj UTM w każdym poście.",
          ],
          fixesOrganic: [
            "Niski organic - zainwestuj w GSC + content SEO (już masz GSC podłączone).",
            "Zbuduj cluster: 1 pillar + 5-8 supportujących artykułów per temat.",
          ],
          fixesDefault: ["Zdywersyfikuj: dodaj kanał referral (guest posts) i newsletter."],
        },
        countries: {
          element: "Kraje",
          title: "Dominuje: {{country}} ({{pct}}%)",
          detail: "{{count}} krajów w wynikach.",
          fixesSingle: [
            "Rozważ wersję językową dla drugiego rynku - system i18n (PL/EN) już masz.",
            "Dodaj hreflang w head - Google skieruje właściwy język per kraj.",
          ],
          fixesMulti: ["Zdywersyfikowany geograficznie ruch - dobrze. Utrzymaj hreflang."],
        },
        devices: {
          element: "Urządzenia",
          title: "Mobile {{pct}}% ruchu",
          detail: "Mobile: {{mobile}}, desktop: {{desktop}}.",
          fixesMobile: [
            "Priorytet mobile-first: LCP < 2.5 s i INP < 200 ms na 4G.",
            "Sprawdź czy sticky elementy nie zjadają viewportu na 360×640.",
          ],
          fixesDesktop: [
            "Desktop-heavy - zadbaj o czytelność na dużych ekranach (max-width contentu, line-length 60-75 znaków).",
          ],
        },
        engagementRadar: {
          element: "Zaangażowanie (radar)",
          title: "Śr. czas {{asd}}s · {{spv}} odsł./sesja · bounce {{bounce}}%",
          detail:
            "Radar sumuje 5 wymiarów: engagement, czas sesji, odsłony/sesja, retencję (100-bounce) i eventy.",
          fixesLowSpv: [
            "Dodaj related posts na końcu artykułu - podniesie odsłony/sesja.",
            "Skrócone CTA w połowie artykułu do powiązanych materiałów.",
          ],
          fixesHighBounce: [
            "Sprawdź LCP + CLS - najczęstszy powód bounce.",
            "Dodaj table of contents w długich wpisach - zatrzymuje usera dłużej.",
          ],
          fixesGood: ["Zaangażowanie w normie - dobra jakość ruchu."],
        },
        topPages: {
          element: "Top strony",
          title: "Top 10 stron: {{strong}} zaangażowanych, {{weak}} słabych",
          detail:
            "Słabe = engagement rate < 35%. Wysoki traffic + niski engagement = strona przyciąga zły intent.",
          fixesWeak: [
            "Przepisz H1 + pierwszy akapit tych stron - musi odpowiadać na frazę, którą wpisał user.",
            "Zbadaj GSC dla tych URL - może rankują na frazę, której nie chcesz.",
            "Dodaj CTA i internal links do powiązanych treści.",
          ],
          fixesDefault: ["Utrzymaj format zwycięskich stron - użyj go jako template."],
        },
      },
    },
    clientErrors: {
      title: "Błędy przeglądarki",
      subtitle:
        "Telemetria błędów JS z beaconów (onerror, unhandledrejection, error boundary). Komunikaty i stacki są redagowane z PII przed zapisem.",
      kpiTotal: "Błędy w oknie",
      kpiGroups: "Unikalne problemy",
      kpiPaths: "Dotknięte ścieżki",
      kpiLast24h: "Ostatnie 24 h",
      trendTitle: "Błędy dziennie",
      trendSubtitle: "Liczba zgłoszeń per dzień (UTC)",
      trendSeries: "Błędy",
      groupsTitle: "Problemy wg częstości",
      groupsSubtitle: "Grupowanie po znormalizowanym komunikacie (uuid/liczby/adresy sklejone)",
      colMessage: "Komunikat",
      colCount: "Wystąpienia",
      colShare: "Udział",
      colSources: "Źródła",
      colLastSeen: "Ostatnio",
      firstSeen: "Pierwszy raz",
      stack: "Stack (najświeższa próbka)",
      noStack: "Brak stacka w próbkach tej grupy.",
      topPaths: "Najczęstsze ścieżki",
      empty:
        "Brak błędów w wybranym oknie. To dobrze - beacony z przeglądarek trafiają tu automatycznie, gdy coś się wysypie.",
      cappedNote: "Agregacja z najnowszych {{cap}} zgłoszeń (w oknie było {{total}}).",
      sourceLabels: {
        onerror: "onerror",
        unhandledrejection: "promise",
        react_error_boundary: "boundary",
      },
      expand: "Pokaż szczegóły",
      collapse: "Zwiń szczegóły",
    },
  },
};

const en = {
  adminAnalytics: {
    common: {
      refresh: "Refresh",
      loading: "Loading...",
      loadingData: "Loading data...",
      noDataWindow: "No data in this window.",
    },
    chartCard: {
      exportPng: "Export PNG",
      exportCsv: "Export CSV",
      fullscreen: "Full screen",
      exitFullscreen: "Exit full screen",
    },
    timeRange: {
      preset24h: "24 h",
      preset7d: "7 days",
      preset14d: "14 days",
      preset28d: "28 days",
      preset30d: "30 days",
      preset90d: "90 days",
      range: "Range",
      pickHint: "Pick a start and end",
      apply: "Apply",
    },
    insightSection: {
      defaultTitle: "Interpretation and recommendations",
      emptyDefault: "No critical issues found - keep your current strategy.",
      badgeCritical: "{{count}} critical",
      badgeWarn: "{{count}} to improve",
      badgeInfo: "{{count}} observations",
      badgeOk: "{{count}} OK",
    },
    related: {
      windowInfo: "Per-tenant analysis, {{days}}-day window",
      views: "Views",
      uniques: "Unique",
      coocLabel: "shared posts: ",
      clicksShort: "clicks",
      hubClicksLabel: "Clicks: ",
      hubSourcesLabel: "Sources: ",
      kpi: {
        posts: "Published posts",
        views: "Views (window)",
        clicks: "Recommendation clicks",
        reads: "Reads (signed-in)",
      },
      charts: {
        topCatsTitle: "Top categories",
        topCatsSubtitle: "Number of published posts in the category",
        topTagsTitle: "Top tags",
        topTagsSubtitle: "Number of published posts with the tag",
        coocTitle: "Tag co-occurrence",
        coocSubtitle:
          "Heatmap: how many posts link two tags (the darker, the stronger the bond in the recommendation graph)",
        popularityTitle: "Post popularity",
        popularitySubtitle: "Views vs unique visitors - candidates to boost in the engine",
        hubTitle: "Hub posts (most frequent click targets)",
        hubSubtitle: "Posts people click through to from recommendations",
        sankeyTitle: "Source → target paths (recommendation click)",
        sankeySubtitle:
          "Sankey of the top 25 pairs - shows how recommendations actually route traffic between posts",
      },
      insightsTitle: "Interpretation and recommendations - recommendation engine",
      insightsSubtitle:
        "Per-tenant signal diagnosis + concrete actions to apply in the configuration",
      insights: {
        noClicks: {
          element: "Recommendations",
          title: "No recommendation clicks in the window",
          detail:
            "Recorded {{views}} post views, but 0 clicks on related. Signals are not working or not being shown.",
          fixes: [
            "Check whether the Related posts section is enabled globally and below posts.",
            "Lower the `min_score` threshold in the Configuration tab - everything may be filtered out.",
            "Check whether the source strategy isn't too restrictive (try `Categories + Tags`).",
          ],
        },
        ctr: {
          element: "KPI - recommendation CTR",
          title: "Recommendation CTR: {{ctr}}%",
          detail: "{{clicks}} clicks on {{views}} views. Editorial benchmark: 1-3%.",
          fixesGood: [
            "Keep the current configuration, test a larger `items_limit` to widen reach.",
          ],
          fixesBad: [
            "Increase `weight_tags` - tags connect unrelated categories better.",
            "Enable `use_idf` - rare tags create more relevant pairs.",
            "Switch `layout` to slider - it often increases CTR on mobile.",
          ],
        },
        smallCats: {
          element: "Structure - categories",
          title: "{{count}} categories with <3 posts",
          detail:
            "Low-count categories generate poor recommendations. The engine matches 1-2 posts and stops.",
          fixes: [
            "Merge small categories into one (e.g. redirects + post_categories update).",
            "Increase `weight_tags` relative to `weight_categories` - tags cover a larger graph.",
          ],
        },
        noReads: {
          element: "Personalization - reading history",
          title: "No reading-history signals from signed-in users",
          detail:
            "user_read_history is empty in this window - personalization has nothing to rely on.",
          fixes: [
            "Wire up reading-time logging (e.g. IntersectionObserver + timer) into user_read_history.",
            "Until data is collected keep `weight_personalization` at 3 - it won't hurt and will start working automatically.",
          ],
        },
        sparseTags: {
          element: "Tagging",
          title: "Sparse tag co-occurrence graph",
          detail:
            "The average number of shared posts per tag pair is {{avg}}. The engine has few anchor points.",
          fixes: [
            "Tag posts more - target: min. 3 tags/post, each tag min. 5 posts.",
            "Build a dictionary of canonical tags (avoid duplicates like 'AI' vs 'ai' vs 'artificial intelligence').",
          ],
        },
        healthyTags: {
          element: "Tagging",
          title: "Healthy tag graph",
          detail: "On average {{avg}} shared posts per pair - IDF has plenty to compute from.",
        },
        hub: {
          element: "Hub - most strongly recommended",
          title: "Hub post: {{name}}",
          detail:
            "{{clicks}} clicks from {{sources}} different sources. This post absorbs traffic.",
          fixes: [
            "Make sure this page has a CTA / conversion - lots of people from recommendations land here.",
            "Consider adding this post to the main menu or a 'Featured' sidebar.",
          ],
        },
        mismatch: {
          element: "Popularity vs recommendation",
          title: "{{count}} popular posts outside the top 10 recommendations",
          detail:
            "High-traffic posts don't reach recommendations - the engine isn't promoting the strongest content.",
          fixes: [
            "Increase `weight_popularity` (e.g. 3-4) - popularity strengthens the ranking.",
            "Check the tagging of these posts - they may be isolated in the category/tag graph.",
          ],
        },
      },
    },
    vitals: {
      refreshAria: "Refresh Web Vitals data",
      lastRefresh: "Last refresh: {{time}}",
      refreshing: "Refreshing…",
      samplesInWindow: "Samples in window: {{count}}",
      cappedNote: " (aggregated from the most recent 20,000)",
      noSamples:
        "No RUM samples in the selected window. Open a few sub-pages in real mode (not the editor) - beacons will land in the table and appear here automatically.",
      trendTitle: "{{metric}} - p75 trend",
      trendSubtitle: "Bands: green Good, yellow Needs, red Poor",
      ratingsPerMetric: "Ratings per metric",
      ratingsSubtitle: "Number of Good / Needs / Poor samples",
      ratingOverall: "Overall rating",
      ratingOverallSubtitle: "All samples in the window",
      samplesWord: "samples",
      samplesLabel: "Samples",
      pathsBySamples: "Paths by sample count",
      pathsSubtitle: "Size = samples, color = LCP p75 (green → red)",
      allGood: "All metrics within range",
      allGoodDetail:
        "Web Vitals in the selected window are in the Good zone. Keep your current image budgeting, widget lazy-loading and CDN cache.",
      scopePath: "path",
      scopeGlobal: "global",
      moreFindings:
        "Showing 12 of {{count}} findings. Fix the critical ones first - the rest usually follow.",
      globalDetail:
        "p75 = {{p75}}. In window: {{good}} Good · {{ni}} Needs · {{poor}} Poor ({{count}} samples total).",
      pathTitle: "{{metric}} on {{path}} = {{value}}",
      pathDetail: "Samples for path: {{total}}. Poor threshold: {{threshold}}.",
      playbook: {
        LCP: {
          ni: {
            title: "LCP in the warning zone",
            fixes: [
              'Preload the hero (LCP) image in the route head: rel="preload" as="image" fetchpriority="high".',
              "Convert the LCP image to AVIF/WebP (vite-imagetools) and provide srcset for 1x/2x.",
              'Add width/height + loading="eager" for the LCP; loading="lazy" for the rest.',
              "Shorten the critical CSS path: load fonts as preload woff2 + font-display: swap.",
            ],
          },
          poor: {
            title: "LCP above threshold - visible loading lag",
            fixes: [
              'Check whether the LCP is an image - if so, force fetchpriority="high" and preload in head().',
              "Defer non-critical third-party scripts (analytics, chat) - defer/async or after requestIdleCallback.",
              "Reduce SSR payload: move heavy widgets to React.lazy + Suspense.",
              "Enable CDN cache for images and static assets (Cache-Control: public, max-age=31536000, immutable).",
            ],
          },
        },
        INP: {
          ni: {
            title: "INP in the warning zone",
            fixes: [
              "Break up long JS tasks (>50 ms) into chunks: scheduler.yield() or setTimeout(0).",
              "Reduce re-renders: React.memo, useMemo, useCallback for heavy lists.",
              "Debounce inputs in forms and search (150-250 ms).",
            ],
          },
          poor: {
            title: "INP high - interactions feel noticeably sluggish",
            fixes: [
              "Profile Long Tasks in the Performance panel - find a handler above 200 ms.",
              "Move heavy computation to useDeferredValue or a web worker.",
              "Remove synchronous setState in onClick - replace with startTransition.",
            ],
          },
        },
        CLS: {
          ni: {
            title: "CLS in the warning zone - there is jumping",
            fixes: [
              "Set width/height on every <img>, <video>, <iframe> to reserve space.",
              "For dynamic banners/ads set the container min-height before the ad loads.",
              "Load fonts via preload woff2 + font-display: swap instead of optional/block.",
            ],
          },
          poor: {
            title: "CLS high - layout jumps on render",
            fixes: [
              "Find the shift source: DevTools > Performance > Experience > Layout Shifts (select the node).",
              "Pin skeleton heights to the final content height.",
              "Don't inject banners/notifications above content - use a bottom sheet / toast overlay.",
            ],
          },
        },
        FCP: {
          ni: {
            title: "FCP slower than the recommended 1.8 s",
            fixes: [
              "Shorten TTFB (see the TTFB section) - FCP follows it.",
              "Preload critical CSS (styles.css) and the main font - you already have Red Hat Display, make sure the preload lands.",
              "Reduce blocking JS in head - move scripts to defer.",
            ],
          },
          poor: {
            title: "FCP above 3 s - blank screen too long",
            fixes: [
              "Enable SSR streaming - HTML fragments reach the client before the loader finishes.",
              "Eliminate render-blocking third-party (Google fonts, tag manager before critical CSS).",
              "Check whether the CDN cache hits (Cache-Status: HIT) - a miss means a cold path to origin.",
            ],
          },
        },
        TTFB: {
          ni: {
            title: "TTFB above 800 ms",
            fixes: [
              "Enable SSR cache for category/post pages (stale-while-revalidate).",
              "Shorten queries in the loader - use context.queryClient.ensureQueryData instead of many sequential fetches.",
              "Check RLS time: move heavy policies to SECURITY DEFINER functions.",
            ],
          },
          poor: {
            title: "TTFB above 1.8 s - server responds too slowly",
            fixes: [
              "Profile server functions: add console.time in handler(), find queries > 500 ms.",
              "Check slow_queries in Lovable Cloud - add indexes on columns used in WHERE / ORDER BY.",
              "Consider edge caching (Cache-Control: s-maxage=60, stale-while-revalidate=600) for public lists.",
            ],
          },
        },
        FID: {
          ni: { title: "FID - legacy metric", fixes: [] },
          poor: { title: "FID - legacy metric", fixes: [] },
        },
      },
    },
    audience: {
      title: "Audience: signed-in vs anonymous",
      descPre: "Segmentation of views from ",
      descPost: " per tenant. Metrics computed within the window.",
      logged: "Signed-in",
      anon: "Anonymous",
      dailyViews: "Daily views (stacked)",
      sampleTruncated: "sample truncated",
      topLogged: "Top - signed-in",
      topAnon: "Top - anonymous",
      uniqueHint: "{{count}} unique",
      uniqShort: "uniq",
      kpi: {
        viewsTotal: "Views total",
        logged: "Signed-in",
        anon: "Anonymous",
        uniqueReaders: "Unique readers",
      },
      insights: {
        empty: {
          element: "KPI",
          title: "No data in the window",
          detail: "No views were recorded in the selected range.",
          fixes: [
            "Check whether the view-counting script (post_views) runs on public pages.",
            "Extend the range to 90 days.",
          ],
        },
        lowLogged: {
          element: "Signed-in segment",
          title: "Signed-in users are only {{pct}}% of views",
          detail:
            "Traffic is dominated by anonymous users. Retention and personalization have limited impact.",
          fixes: [
            "Consider a sign-up CTA on top posts from the anonymous segment.",
            "Offer bookmarks / newsletter at the end of articles.",
          ],
        },
        highLogged: {
          element: "Signed-in segment",
          title: "Signed-in users deliver {{pct}}% of views",
          detail:
            "The user base returns strongly to content - a good foundation for recommendations.",
          fixes: [
            "Increase the personalization weight in the recommendation engine.",
            "Test 'More for you' sections below top posts for signed-in users.",
          ],
        },
        loyalLogged: {
          element: "Signed-in retention",
          title: "A signed-in user reads {{count}} posts on average",
          detail: "Engagement in this segment is high.",
          fixes: ["Build a 'Recently read' view for signed-in users on the profile page."],
        },
        trunc: {
          element: "Input data",
          title: "Results truncated to 50,000 records",
          detail: "The selected window has more views than the limit. Values may be understated.",
          fixes: ["Narrow the range to a shorter window (e.g. 7 days)."],
        },
      },
    },
    gsc: {
      property: "Property",
      selectProperty: "Select a property",
      window: "Window",
      clicks: "Clicks",
      impressions: "Impressions",
      ctrPct: "CTR %",
      avgPosition: "Avg. position",
      other: "Other",
      clicksShort: "clicks",
      clicksLabel: "Clicks: ",
      impressionsLabel: "Impressions: ",
      ctrLabel: "CTR: ",
      positionLabel: "Position: ",
      notConfiguredPre: "Search Console isn't connected yet. Go back to the ",
      notConfiguredTab: "Overview",
      notConfiguredPost: ' tab and use the "Connect Search Console" button.',
      csvTrendHeaders: ["date", "clicks", "impressions", "ctr", "position"],
      csvQueriesHeaders: ["query", "clicks", "impressions", "ctr", "position"],
      charts: {
        trendTitle: "Visibility trend",
        trendSubtitle: "Clicks and impressions over time + CTR (dashed line)",
        topQueriesTitle: "Top 15 queries",
        topQueriesSubtitle: "Ranked by clicks",
        positionTitle: "SERP position distribution",
        positionSubtitle: "Impressions and clicks by position range",
        countriesTitle: "Countries",
        countriesSubtitle: "Clicks by country",
        devicesTitle: "Devices",
        devicesSubtitle: "Clicks by device type",
        pagesTitle: "Pages by impressions",
        pagesSubtitle: "Treemap of the top 20 pages (size = impressions)",
        calendarTitle: "Daily activity",
        calendarSubtitle: "Calendar heatmap - clicks per day",
      },
      insightsSubtitle: "Analysis for property {{site}} · {{days}}-day window",
      insights: {
        clicks: {
          element: "KPI · Clicks",
          titleNoDelta: "Clicks in window: {{clicks}}",
          titleDelta: "Clicks {{delta}}% vs previous window",
          detail:
            "In the current {{days}}-day window: {{clicks}} clicks. Previously: {{prev}}. Impressions: {{impr}} (previously {{prevImpr}}).",
          fixesDown: [
            "Check in GSC Coverage whether important pages dropped out (soft 404 / noindex).",
            "Verify whether you changed titles/meta descriptions on TOP pages - CTR may have dropped.",
            "Run `/admin/seo` and re-index the pages with the biggest impressions drop.",
          ],
          fixesUp: [
            "Cement the trend: add internal links to pages that recently gained.",
            "Collect new phrases from Top queries and expand content for the long tail.",
          ],
          fixesStable: [
            "Keep the publishing rhythm - a stable trend is a good base to scale from.",
          ],
        },
        ctr: {
          element: "KPI · CTR",
          title: "CTR {{ctr}}% at position {{pos}}",
          detail:
            "Expected CTR for this position: ~{{exp}}%. Your CTR is {{cmp}} by {{gap}} pp. Change vs previous window: {{dctr}} pp.",
          cmpHigher: "higher",
          cmpLower: "lower",
          fixesLow: [
            "Rewrite the meta title on TOP pages: add a benefit + year + brand at the end (≤ 60 chars).",
            "Improve the meta description: concrete value + CTA (≤ 155 chars).",
            "Implement FAQ / HowTo schema.org - they often produce rich results in SERP.",
            "Check the actual snippet in SERP (site:) - sometimes Google generates its own description; then fix the H1/first paragraph.",
          ],
          fixesGood: ["Keep the title style - it works. Apply the same pattern to weaker pages."],
        },
        position: {
          element: "KPI · Avg. position",
          title: "Average position: {{pos}} ({{delta}})",
          detailWorse: "Position worsened by {{n}} spots - visibility drop.",
          detailBetter: "Position improved by {{n}} spots.",
          detailStable: "Position stable versus the previous window.",
          fixesWorse: [
            "Study the TOP-3 competition for your TOP phrases (SEMrush SERP analysis).",
            "Update the oldest posts with the best phrases: content refresh + modification date.",
            "Add internal links from pillar pages to articles losing positions.",
          ],
          fixesStable: ["Keep up the internal linking and publishing pace."],
        },
        trend: {
          element: "Visibility trend",
          titleNoData: "Visibility trend - not enough data",
          title: "Second half of the window: {{delta}}% clicks vs the first",
          detail:
            "Clicks H1: {{early}}, H2: {{late}}. Trend direction over the {{days}}-day window.",
          fixesDown: [
            "Check crawl logs in GSC - a robots block / 5xx may have appeared.",
            "Verify sitemap.xml (freshness + no 404s).",
            "Run URL Inspection for pages that lost traffic.",
          ],
          fixesDefault: [
            "Analyze correlation with holidays / weekends - in B2B a typical weekend dip.",
          ],
        },
        topQueries: {
          element: "Top 15 queries",
          titleBranded: "Traffic heavily branded ({{pct}}%)",
          titleZeroClick: "{{count}} phrases with ≥20 impr. and 0 clicks",
          detailBranded:
            "Over half of clicks come from branded phrases - generic visibility is missing.",
          detailZeroClick:
            "High impressions with no clicks = the SERP snippet doesn't sell. Phrases: {{count}}.",
          fixesBranded: [
            "Build content for generic long-tail (guides, case studies) on industry topics.",
            "Use SEMrush keyword research: filter KD < 30 and Informational intent.",
            "Link pillar articles (pillar page) to their topic clusters.",
          ],
          fixesZeroClick: [
            "Take 5 phrases with 0-CTR and rewrite the meta title + description with a benefit / number.",
            "Build FAQ on those pages - Google readily promotes a Q&A snippet.",
          ],
        },
        positionHistogram: {
          element: "SERP position distribution",
          title: "{{pct}}% of impressions in the TOP 10",
          detail:
            'TOP3: {{top3}}, TOP4-10: {{top10}}, TOP11-20: {{top20}}, 21+: {{deep}}. The 11-20 group is the "striking distance" - the easiest gain.',
          fix1: "List all queries in positions 11-20 - the best ROI. Add topical sections + internal links.",
          fix2: "To the most profitable phrases in TOP4-10 add FAQ / a list + update the year in the title.",
          fix3Low:
            "Consider topical backlinks - without off-site it's hard to jump from 20+ into the TOP10.",
          fix3High: "Keep it fresh - refresh every 6 months for TOP phrases.",
        },
        countries: {
          element: "Countries",
          title: "Dominant country: {{country}} ({{pct}}%)",
          detail: "{{count}} countries in the results. Top 3: {{top3}}.",
          fixesSingle: [
            "One market = one risk. Consider an EN version for your strongest content (you already have i18n).",
            "Set hreflang on translated pages - Google will serve the right version per country.",
          ],
          fixesMulti: [
            "Wire up country-specific meta descriptions for top markets.",
            "Launch a Merchant/Business Profile in countries with ≥5% traffic (if B2C).",
          ],
        },
        devices: {
          element: "Devices",
          title: "Mobile {{mobile}} clicks, desktop {{desktop}} clicks",
          detail: "CTR: mobile {{mctr}}%, desktop {{dctr}}%. {{note}}",
          noteGap: "Desktop clearly leads - the mobile snippet isn't working.",
          noteEven: "Even CTR distribution.",
          fixesGap: [
            "Shorten the meta title to 50 chars (mobile SERP truncates earlier).",
            "Check mobile LCP in Web Vitals - slow mobile = lower CTR.",
            "Verify sticky headers and the cookie bar - they block first paint on mobile.",
          ],
          fixesEven: ["Keep it responsive. Testing AMP is only worth it if you publish news."],
        },
        pages: {
          element: "Pages by impressions",
          title: "{{low}} pages significantly below the CTR benchmark, {{winners}} above",
          detail:
            "Analysis of {{count}} pages with ≥30 impressions. Sort: treemap color = CTR (green = strong, red = weak).",
          fixes: [
            "Take the 3 weakest pages and rewrite the H1 + meta title - fastest effect.",
            "From the winners copy the pattern: H1 + CTA + FAQ layout onto weaker pages.",
            "Internal links: from the winners link pages with low visibility - authority transfer.",
          ],
        },
        calendar: {
          element: "Daily activity",
          titleZeros: "{{zeros}}/{{total}} days with no clicks",
          titleSpike: "Peak: {{clicks}} clicks {{date}}",
          detailZeros:
            "A large number of zero days suggests a narrow niche or a long-standing indexing problem.",
          detailSpike:
            "The biggest activity peak in the selected window: {{date}} ({{clicks}} clicks).",
          fixesZeros: [
            "Increase publishing frequency - a target of 2-3 posts weekly gives a steady flow of impressions.",
            "Run URL Inspection for zero days on key URLs.",
            "Consider syndication (LinkedIn / newsletter) - it diversifies traffic sources.",
          ],
          fixesSpike: [
            "Investigate what caused the peak - repeat the format / topic / distribution.",
          ],
        },
      },
    },
    ga4: {
      window: "Window",
      modeOauth: "OAuth",
      modeServiceAccount: "Service Account",
      modeLabel: "Mode: ",
      notConfiguredPre: "The GA4 Data API isn't configured yet. Go back to the ",
      notConfiguredTab: "GA4",
      notConfiguredPost: " tab and connect a Service Account or OAuth refresh token.",
      apiError: "Data API error: {{error}}",
      sessions: "Sessions",
      activeUsers: "Active users",
      views: "Views",
      engagement: "Engagement",
      other: "Other",
      radar: {
        engagement: "Engagement",
        sessionTime: "Session time",
        viewsPerSession: "Views/session",
        retention: "Retention (100 - bounce)",
        events: "Events",
        seriesName: "Last {{days}} days",
      },
      charts: {
        trendTitle: "Traffic trend",
        trendSubtitle: "Sessions, users and views in the window",
        engagementTitle: "Engagement",
        engagementSubtitle: "5 dimensions of traffic quality",
        sourcesTitle: "Traffic sources",
        sourcesSubtitle: "Sessions by sessionSource",
        countriesTitle: "Countries",
        countriesSubtitle: "Sessions by country",
        devicesTitle: "Devices",
        devicesSubtitle: "Sessions by device type",
        topPagesTitle: "Top pages",
        topPagesSubtitle: "Ranked by views",
      },
      insightsSubtitle: "GA4 analysis · {{days}}-day window · mode: {{mode}}",
      insights: {
        sessions: {
          element: "KPI · Sessions",
          titleNoDelta: "Sessions: {{sessions}}",
          titleDelta: "Sessions {{delta}}% vs the previous {{days}} days",
          detail: "Current: {{sessions}}, previous: {{prev}}. Active: {{active}}.",
          fixesDown: [
            "Check GA4 > Acquisition > Traffic acquisition - which channel dropped?",
            "If organic dropped - look at GSC (Search Console).",
            "If direct dropped - check whether an important backlink or campaign disappeared.",
          ],
          fixesUp: [
            "Scale the channel that gained - repeat publications in a similar style.",
            "Refine retention: newsletter/RSS on pages that gained traffic.",
          ],
          fixesStable: ["Trend stable - a good base for CRO experiments."],
        },
        engagement: {
          element: "KPI · Engagement",
          title: "Engagement rate {{rate}}%",
          detail:
            "Benchmark: >60% great, 40-60% average, <40% a traffic-quality or UX problem. Change: {{delta}} pp.",
          fixesLow: [
            "Shorten LCP and INP in Web Vitals - slow pages = bounce in the first 3 seconds.",
            "Match intent: check whether the landing page answers the phrase the user typed.",
            "Reduce popups/modals in the first session - Google treats them as intrusive.",
          ],
          fixesGood: [
            "Keep the current UX - add micro-events (scroll depth 75%) for better segmentation.",
          ],
        },
        trend: {
          element: "Traffic trend",
          titleNoData: "Trend - not enough data",
          title: "Second half of the window: {{delta}}% sessions",
          detail:
            "Sessions H1: {{early}}, H2: {{late}}. Signals the direction in the current window.",
          fixesDown: [
            "Cross-check with GSC: if GSC shows no drop - it's a GA4-side issue (filters, IP block).",
            "Check the analytics integration in the consent banner - blocking consent = session drop.",
          ],
          fixesDefault: ["Continue the current publishing strategy."],
        },
        sources: {
          element: "Traffic sources",
          title: "Direct {{direct}}%, Google {{organic}}%",
          detail: "{{count}} sources. TOP 3: {{top3}}.",
          fixesDirect: [
            "High direct = missing UTM in campaigns or a referrer problem. Tag all links (utm_source/medium/campaign).",
            "Check whether the site is published on social - add UTM in every post.",
          ],
          fixesOrganic: [
            "Low organic - invest in GSC + content SEO (you already have GSC connected).",
            "Build a cluster: 1 pillar + 5-8 supporting articles per topic.",
          ],
          fixesDefault: ["Diversify: add a referral channel (guest posts) and a newsletter."],
        },
        countries: {
          element: "Countries",
          title: "Dominant: {{country}} ({{pct}}%)",
          detail: "{{count}} countries in the results.",
          fixesSingle: [
            "Consider a language version for a second market - you already have the i18n system (PL/EN).",
            "Add hreflang in head - Google will route the right language per country.",
          ],
          fixesMulti: ["Geographically diversified traffic - good. Keep hreflang."],
        },
        devices: {
          element: "Devices",
          title: "Mobile {{pct}}% of traffic",
          detail: "Mobile: {{mobile}}, desktop: {{desktop}}.",
          fixesMobile: [
            "Mobile-first priority: LCP < 2.5 s and INP < 200 ms on 4G.",
            "Check whether sticky elements eat the viewport at 360×640.",
          ],
          fixesDesktop: [
            "Desktop-heavy - ensure readability on large screens (content max-width, line-length 60-75 chars).",
          ],
        },
        engagementRadar: {
          element: "Engagement (radar)",
          title: "Avg. time {{asd}}s · {{spv}} views/session · bounce {{bounce}}%",
          detail:
            "The radar sums 5 dimensions: engagement, session time, views/session, retention (100-bounce) and events.",
          fixesLowSpv: [
            "Add related posts at the end of the article - it raises views/session.",
            "A short mid-article CTA to related materials.",
          ],
          fixesHighBounce: [
            "Check LCP + CLS - the most common cause of bounce.",
            "Add a table of contents in long posts - it keeps the user longer.",
          ],
          fixesGood: ["Engagement within range - good traffic quality."],
        },
        topPages: {
          element: "Top pages",
          title: "Top 10 pages: {{strong}} engaged, {{weak}} weak",
          detail:
            "Weak = engagement rate < 35%. High traffic + low engagement = the page attracts the wrong intent.",
          fixesWeak: [
            "Rewrite the H1 + first paragraph of these pages - it must answer the phrase the user typed.",
            "Check GSC for these URLs - they may rank for a phrase you don't want.",
            "Add a CTA and internal links to related content.",
          ],
          fixesDefault: ["Keep the format of the winning pages - use it as a template."],
        },
      },
    },
    clientErrors: {
      title: "Browser errors",
      subtitle:
        "JS error telemetry from beacons (onerror, unhandledrejection, error boundary). Messages and stacks are PII-redacted before storage.",
      kpiTotal: "Errors in window",
      kpiGroups: "Unique issues",
      kpiPaths: "Affected paths",
      kpiLast24h: "Last 24 h",
      trendTitle: "Errors per day",
      trendSubtitle: "Reports per day (UTC)",
      trendSeries: "Errors",
      groupsTitle: "Issues by frequency",
      groupsSubtitle: "Grouped by normalized message (uuids/numbers/urls collapsed)",
      colMessage: "Message",
      colCount: "Occurrences",
      colShare: "Share",
      colSources: "Sources",
      colLastSeen: "Last seen",
      firstSeen: "First seen",
      stack: "Stack (latest sample)",
      noStack: "No stack captured for this group.",
      topPaths: "Most frequent paths",
      empty:
        "No errors in the selected window. Good news - browser beacons land here automatically whenever something breaks.",
      cappedNote: "Aggregated from the newest {{cap}} reports (the window held {{total}}).",
      sourceLabels: {
        onerror: "onerror",
        unhandledrejection: "promise",
        react_error_boundary: "boundary",
      },
      expand: "Show details",
      collapse: "Hide details",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
