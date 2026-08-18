# Ocena funkcji — konkurenci (PL / UE / międzynarodowi) w strukturze 20 modułów (2026-07-24)

Data: 2026-07-24 · Dokument towarzyszący `OCENA_FUNKCJI_2026-07-24.md` (ocena własnej platformy). Ta sama
struktura 20 modułów, zastosowana do konkurentów, z **twardym reżimem realizmu i „b/d"**.

## Metodyka i reżim „b/d" (przeczytaj najpierw)

Konkurentów da się ocenić **wyłącznie po publicznie obserwowalnym efekcie serwisu** — nie mamy dostępu do ich
kodu, adminów, CRM-a, analityki, bazy danych ani testów. Dlatego:

- **Moduły obserwowalne (11)** — oceniam realnie 0–10: 1 (czytelnik), 5 (strona główna/archiwa/chrome),
  6 (wyszukiwarka), 7 (typy treści specjalne), 8 (SEO/feedy), 9 (czat), 10 (sieć), 11 (newsletter),
  13 (monetyzacja — paywall), 14 (monetyzacja — konwersja: darowizny/subskrypcja/reklamy), 15 (profil).
  Oceny są **przemapowaniem zbadanych wyników z `OCENA_KONKURENCI_INDYWIDUALNIE_2026-07-20.md`** (skala 0–10,
  krok 0,5, stan wiedzy do poł. 2026) na tę strukturę modułów.
- **Moduły wewnętrzne (9) → `b/d` dla WSZYSTKICH konkurentów** — z zewnątrz niewidoczne: 2 (edytor/workflow),
  3 (silniki treści: bloki+builder), 4 (wygląd/motyw/media/import), 12 (realtime/powiadomienia/infra),
  16 (zarządzanie społecznością), 17 (analityka i BI), 18 (CRM), 19 (ustawienia/users/multi-tenant/RODO),
  20 (backend/RLS/testy/CI). **`b/d` ≠ „nie mają"** — to znaczy „brak danych z zewnątrz". NES ma tu ocenę,
  bo oceniano go **z kodu**; konkurentów nie da się.

**Rozróżnienie krytyczne (żeby było realnie):** gdy funkcja jest **obserwowalnie nieobecna**, to jest **dana**,
nie „b/d":

- Moduł 9 (czat) → **żaden z 38 konkurentów nie ma czatu na platformie** → 0 / „brak" (nie b/d).
- Moduł 10 (sieć) → wszyscy delegują networking do LinkedIna/sal eventowych → ~0,5–1,0 (nie b/d).

**Mapowanie modułów obserwowalnych na kryteria z badania 07-20:**

| Moduł (ten dokument)           | Źródło oceny (07-20)                               |
| ------------------------------ | -------------------------------------------------- |
| 1 Wpisy — czytelnik            | „Wpisy: czytanie" (+ audio)                        |
| 5 Strona główna/archiwa/chrome | „Strony: huby + wydajność"                         |
| 6 Wyszukiwarka                 | „Wyszukiwarka" (agregat)                           |
| 7 Typy treści specjalne        | „Wpisy: formaty + live" + „Strony: microsites"     |
| 8 SEO/feedy/dane strukturalne  | „Wpisy: SEO"                                       |
| 9 Czat                         | „Czat: czat" (= 0 u wszystkich)                    |
| 10 Sieć/networking             | „Profile: networking"                              |
| 11 Newsletter                  | „Czat: kanały" (newsletter/digest — proxy)         |
| 13 Monetyzacja — paywall       | „Wpisy: paywall"                                   |
| 14 Monetyzacja — konwersja     | „Strony: landingi" (darowizny/subskrypcja/reklamy) |
| 15 Profil i konto              | „Profile" (agregat)                                |

> NES w tabelach = pełne oceny 20-modułowe z `OCENA_FUNKCJI_2026-07-24.md` (oceniane z kodu, więc bez „b/d").
> Wartość porównawcza to nie „NES vs 1 konkurent w module", lecz **obraz: na ~połowie platformy porównanie
> jest niemożliwe, bo tych zdolności nikt w sektorze nie wystawia publicznie (a ich wnętrza są niewidoczne).**

---

# 1. Konkurenci w Polsce

Roster (5): PISM, OSW, Klub Jagielloński (KJ), Nowa Konfederacja (NK), INE. (Sobieski/WEI/Batory cyfrowo ≈ KJ/NK.)

| #   | Moduł                                           | NES     | PISM    | OSW     | KJ      | NK      | INE     |
| --- | ----------------------------------------------- | ------- | ------- | ------- | ------- | ------- | ------- |
| 1   | Wpisy — czytelnik                               | **7,8** | 4,5     | 5,0     | 4,5     | 4,5     | 4,0     |
| 2   | Edytor + workflow redakcyjny                    | **8,2** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 3   | Silniki treści (bloki + builder)                | **8,6** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 4   | Wygląd, motyw, media, import                    | **7,3** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 5   | Strona główna / archiwa / chrome                | **8,0** | 3,5     | 4,0     | 3,5     | 3,0     | 3,0     |
| 6   | Wyszukiwarka                                    | **8,3** | 2,1     | 2,3     | 1,6     | 1,6     | 1,3     |
| 7   | Typy treści specjalne                           | **7,5** | 2,5     | 3,0     | 2,5     | 2,5     | 2,0     |
| 8   | SEO / feedy / dane strukturalne                 | **7,9** | 4,5     | 5,0     | 4,0     | 3,5     | 3,0     |
| 9   | Czat / komunikator                              | **8,0** | brak    | brak    | brak    | brak    | brak    |
| 10  | Sieć / networking                               | **7,6** | 0,5     | 0,5     | 0,5     | 0,5     | 0,5     |
| 11  | Newsletter                                      | **7,7** | 2,5     | 3,0     | 2,5     | 2,5     | 2,0     |
| 12  | Realtime / powiadomienia / push                 | **8,4** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 13  | Monetyzacja — paywall                           | **8,4** | 1,0     | 1,0     | 2,5     | 4,0     | 1,5     |
| 14  | Monetyzacja — konwersja (darowizny/sub/reklamy) | **6,9** | 1,5     | 1,5     | 3,0     | 3,5     | 2,5     |
| 15  | Profil i konto                                  | **8,0** | 2,3     | 2,3     | 1,9     | 1,9     | 1,8     |
| 16  | Zarządzanie społecznością                       | **7,6** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 17  | Analityka i BI                                  | **8,7** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 18  | CRM                                             | **8,1** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 19  | Ustawienia / multi-tenant / RODO                | **8,5** | b/d     | b/d     | b/d     | b/d     | b/d     |
| 20  | Platforma / backend / infrastruktura            | **8,7** | b/d     | b/d     | b/d     | b/d     | b/d     |
| —   | **Śr. z 5 modułów publicznych (07-20)**         | **8,0** | **2,3** | **2,4** | **2,1** | **2,1** | **1,8** |

**Polska — synteza:** najsłabsza cyfrowo liga w zestawieniu. Najsilniejsi to PISM i OSW dzięki pełnym
lustrom językowym (PL/EN) i przyzwoitemu SEO (OSW 5,0), ale **żaden** nie ma paywalla klasy produkcyjnej
(NK 4,0 to najwyżej — darowizny/prosta bramka), wyszukiwarki ponad podstawową (max OSW 2,3), typów treści
poza PDF/wideo, ani jakiejkolwiek warstwy społecznościowej/profilowej. Na 9 modułach wewnętrznych — b/d
(brak wglądu), ale obserwowalny efekt (statyczne WordPressy) sugeruje brak self-service buildera, CRM-a
czy analityki na poziomie NES.

---

# 2. Konkurenci w UE (Europa Zachodnia)

Roster (6): ECFR, Bruegel, Chatham House (CH), RUSI, CEPS, SWP. (IFRI/Clingendael ≈ SWP.)

| #   | Moduł                                   | NES     | ECFR    | Bruegel | CH      | RUSI    | CEPS    | SWP     |
| --- | --------------------------------------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| 1   | Wpisy — czytelnik                       | **7,8** | 6,5     | 6,5     | 6,0     | 5,5     | 5,0     | 5,0     |
| 2   | Edytor + workflow redakcyjny            | **8,2** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 3   | Silniki treści (bloki + builder)        | **8,6** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 4   | Wygląd, motyw, media, import            | **7,3** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 5   | Strona główna / archiwa / chrome        | **8,0** | 6,0     | 6,0     | 5,0     | 5,0     | 4,5     | 4,5     |
| 6   | Wyszukiwarka                            | **8,3** | 3,8     | 3,7     | 3,3     | 3,0     | 3,0     | 3,1     |
| 7   | Typy treści specjalne                   | **7,5** | 5,0     | 5,0     | 4,0     | 4,0     | 3,5     | 3,0     |
| 8   | SEO / feedy / dane strukturalne         | **7,9** | 6,0     | 6,0     | 5,5     | 5,0     | 5,0     | 5,0     |
| 9   | Czat / komunikator                      | **8,0** | brak    | brak    | brak    | brak    | brak    | brak    |
| 10  | Sieć / networking                       | **7,6** | 1,0     | 1,0     | 1,0     | 1,0     | 0,5     | 0,5     |
| 11  | Newsletter                              | **7,7** | 4,0     | 3,5     | 3,5     | 3,5     | 3,0     | 3,0     |
| 12  | Realtime / powiadomienia / push         | **8,4** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 13  | Monetyzacja — paywall                   | **8,4** | 1,0     | 2,0     | 5,5     | 6,0     | 2,5     | 1,0     |
| 14  | Monetyzacja — konwersja                 | **6,9** | 4,0     | 4,0     | 6,0     | 6,0     | 4,0     | 2,0     |
| 15  | Profil i konto                          | **8,0** | 3,8     | 3,7     | 3,7     | 3,5     | 3,2     | 3,3     |
| 16  | Zarządzanie społecznością               | **7,6** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 17  | Analityka i BI                          | **8,7** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 18  | CRM                                     | **8,1** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 19  | Ustawienia / multi-tenant / RODO        | **8,5** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| 20  | Platforma / backend / infrastruktura    | **8,7** | b/d     | b/d     | b/d     | b/d     | b/d     | b/d     |
| —   | **Śr. z 5 modułów publicznych (07-20)** | **8,0** | **3,6** | **3,5** | **3,6** | **3,4** | **2,9** | **2,8** |

**UE — synteza:** wyraźnie mocniejsi od PL w treści (czytelnik 5–6,5), microsites (ECFR/Bruegel „interaktywne
raporty" 6,5–7,0 → moduł 7) i profilach ekspertów (ECFR 7,5 str. ekspertów). **Chatham House i RUSI wyróżniają
się paywallem/członkostwem** (5,5–6,0) — jedyne TT w UE z realną bramką i konwersją (6,0). Ale wyszukiwarka
pozostaje podstawowa (max ECFR 3,8), a warstwa społeczność/sieć praktycznie zerowa. Moduły wewnętrzne — b/d.

---

# 3. Konkurenci międzynarodowi

Grupa najliczniejsza (USA 7, media globalne 7, Rosja 4, Chiny 4, Japonia 5). Dla czytelności podzielona na
trzy pod-zestawienia. To tu są jedyni realni rywale NES (globalne media), ale nadal **wyłącznie na modułach
publicznych** — 9 modułów wewnętrznych pozostaje „b/d" u każdego.

## 3A. Think-tanki USA

| #   | Moduł                             | NES     | Brookings | CSIS    | CFR     | RAND    | Carnegie | Atl.Council | CNAS    |
| --- | --------------------------------- | ------- | --------- | ------- | ------- | ------- | -------- | ----------- | ------- |
| 1   | Wpisy — czytelnik                 | **7,8** | 7,0       | 7,0     | 7,5     | 6,5     | 7,0      | 6,5         | 6,0     |
| 2   | Edytor + workflow                 | **8,2** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 3   | Silniki treści (bloki+builder)    | **8,6** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 4   | Wygląd/motyw/media/import         | **7,3** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 5   | Strona główna/archiwa/chrome      | **8,0** | 6,5       | 6,5     | 7,0     | 6,0     | 6,5      | 6,0         | 5,5     |
| 6   | Wyszukiwarka                      | **8,3** | 4,6       | 4,4     | 4,3     | 5,6     | 4,1      | 3,9         | 3,5     |
| 7   | Typy treści specjalne             | **7,5** | 5,5       | 7,0     | 6,5     | 5,0     | 5,0      | 6,0         | 4,0     |
| 8   | SEO / feedy / dane strukt.        | **7,9** | 7,5       | 7,0     | 7,5     | 7,5     | 7,0      | 6,5         | 6,0     |
| 9   | Czat / komunikator                | **8,0** | brak      | brak    | brak    | brak    | brak     | brak        | brak    |
| 10  | Sieć / networking                 | **7,6** | 1,0       | 1,0     | 1,0     | 1,0     | 1,0      | 1,0         | 1,0     |
| 11  | Newsletter                        | **7,7** | 5,0       | 5,0     | 5,0     | 4,5     | 4,5      | 4,5         | 4,0     |
| 12  | Realtime / powiadomienia          | **8,4** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 13  | Monetyzacja — paywall             | **8,4** | 1,5       | 1,5     | 2,0     | 1,5     | 1,0      | 1,5         | 1,5     |
| 14  | Monetyzacja — konwersja           | **6,9** | 5,0       | 5,0     | 4,5     | 4,5     | 4,5      | 4,5         | 4,0     |
| 15  | Profil i konto                    | **8,0** | 4,0       | 3,8     | 3,7     | 3,8     | 3,8      | 3,7         | 3,5     |
| 16  | Zarządzanie społecznością         | **7,6** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 17  | Analityka i BI                    | **8,7** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 18  | CRM                               | **8,1** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 19  | Ustawienia/multi-tenant/RODO      | **8,5** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| 20  | Platforma / backend / infra       | **8,7** | b/d       | b/d     | b/d     | b/d     | b/d      | b/d         | b/d     |
| —   | **Śr. z 5 modułów publ. (07-20)** | **8,0** | **4,0**   | **4,1** | **4,1** | **4,0** | **3,8**  | **3,7**     | **3,2** |

**USA — synteza:** najlepsze TT świata w treści i **microsites/trackerach** (CSIS ChinaPower/Missile Threat →
moduł 7 = 7,0; CFR trackery → 6,5) oraz SEO (7,0–7,5). **RAND ma najlepszą wyszukiwarkę think-tankową świata**
(5,6 — jedyny z fasetami klasy zbliżonej do NES). Ale wszystko to budują **studiami deweloperów**, nie
self-service — a paywall (≤2,0), sieć (~1,0) i czat (brak) są u nich śladowe lub zerowe. Na 9 modułach
wewnętrznych — b/d.

## 3B. Media globalne

Serwisy publiczne (bez Politico PRO / Bloomberg Terminal / Reuters Eikon — osobne platformy).

| #   | Moduł                             | NES     | FT      | Bloomberg | Reuters | Economist | Politico | Axios   | Euractiv |
| --- | --------------------------------- | ------- | ------- | --------- | ------- | --------- | -------- | ------- | -------- |
| 1   | Wpisy — czytelnik                 | **7,8** | 9,0     | 9,0       | 8,0     | 8,5       | 7,0      | 7,5     | 5,5      |
| 2   | Edytor + workflow                 | **8,2** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 3   | Silniki treści (bloki+builder)    | **8,6** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 4   | Wygląd/motyw/media/import         | **7,3** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 5   | Strona główna/archiwa/chrome      | **8,0** | 7,0     | 7,5       | 7,0     | 6,5       | 6,5      | 6,0     | 5,0      |
| 6   | Wyszukiwarka                      | **8,3** | 4,8     | 4,0       | 3,6     | 3,6       | 3,4      | 2,8     | 2,7      |
| 7   | Typy treści specjalne             | **7,5** | 8,0     | 9,0       | 8,5     | 6,0       | 7,5      | 5,5     | 4,5      |
| 8   | SEO / feedy / dane strukt.        | **7,9** | 8,5     | 8,5       | 9,0     | 8,0       | 8,5      | 7,5     | 7,0      |
| 9   | Czat / komunikator                | **8,0** | brak    | brak      | brak    | brak      | brak     | brak    | brak     |
| 10  | Sieć / networking                 | **7,6** | 1,0     | 1,0       | 1,0     | 1,0       | 1,0      | 1,0     | 1,0      |
| 11  | Newsletter                        | **7,7** | 8,0     | 8,0       | 7,5     | 7,5       | 8,0      | 7,5     | 6,0      |
| 12  | Realtime / powiadomienia          | **8,4** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 13  | Monetyzacja — paywall             | **8,4** | 9,0     | 8,0       | 7,0     | 8,5       | 4,0      | 3,0     | 4,5      |
| 14  | Monetyzacja — konwersja           | **6,9** | 8,5     | 8,0       | 7,0     | 8,0       | 5,5      | 5,0     | 4,5      |
| 15  | Profil i konto                    | **8,0** | 3,7     | 3,2       | 3,2     | 2,7       | 3,2      | 2,9     | 2,8      |
| 16  | Zarządzanie społecznością         | **7,6** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 17  | Analityka i BI                    | **8,7** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 18  | CRM                               | **8,1** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 19  | Ustawienia/multi-tenant/RODO      | **8,5** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| 20  | Platforma / backend / infra       | **8,7** | b/d     | b/d       | b/d     | b/d       | b/d      | b/d     | b/d      |
| —   | **Śr. z 5 modułów publ. (07-20)** | **8,0** | **5,5** | **4,9**   | **4,7** | **4,4**   | **4,2**  | **3,6** | **3,3**  |

**Media — synteza:** to **jedyni realni rywale NES** i jedyni, którzy biją go w pojedynczych modułach:
czytanie (Bloomberg/FT 9,0 vs NES 7,8), typy/storytelling (Bloomberg Graphics 9,0 — światowy benchmark),
SEO (Reuters 9,0), paywall (FT 9,0 — parytet, choć NES ma per-item i dożywotni, których serwisy publiczne
nie mają). FT dodatkowo ma żywą kulturę komentarzy (7,0 — parytet) i myFT. **Ale:** wyszukiwarka słabsza
(max FT 4,8 vs 8,3), profil czytelnika szczątkowy (max FT 3,7 vs 8,0), czat/sieć zerowe, a 9 modułów
wewnętrznych — b/d (ich zaplecza redakcyjnego/CMS nie widać, choć bez wątpienia jest zaawansowane).

## 3C. Think-tanki Azja i Rosja (skrót)

Wszystkie w przedziale agregatu 1,7–2,9 (07-20) — cyfrowo najsłabsza część stawki międzynarodowej. Poniżej
moduły różnicujące; pozostałe: **M9 czat = brak, M10 sieć ≈ 0,5, M5/M7/M11/M14 = niskie (2–4), M2/M3/M4/M12/M16/M17/M18/M19/M20 = b/d.**

| Podmiot               | Region  | M1 czyt. | M6 szuk. | M7 typy | M8 SEO | M13 paywall | M15 profil | Śr.(07-20) |
| --------------------- | ------- | -------- | -------- | ------- | ------ | ----------- | ---------- | ---------- |
| Klub Wałdajski        | Rosja   | 5,5      | 2,9      | 4,0     | 4,0    | 1,0         | 2,7        | **2,8**    |
| RIAC                  | Rosja   | 4,5      | 3,3      | 3,5     | 4,0    | 1,0         | 3,2        | **2,9**    |
| Russia in Global Aff. | Rosja   | 4,5      | 2,1      | 2,0     | 3,5    | 1,5         | 1,9        | **2,1**    |
| IMEMO                 | Rosja   | 3,0      | 2,0      | 2,0     | 3,0    | 1,0         | 2,1        | **1,9**    |
| CCG                   | Chiny   | 3,5      | 1,8      | 2,5     | 2,5    | 1,0         | 1,8        | **2,0**    |
| CICIR / CIIS / SIIS   | Chiny   | 2,5      | 1,7      | 2,0     | 2,0    | 1,0         | 1,6        | **1,7**    |
| SPF (Sasakawa)        | Japonia | 4,5      | 2,2      | 3,0     | 4,0    | 1,0         | 2,2        | **2,3**    |
| RIETI                 | Japonia | 4,0      | 3,0      | 3,0     | 4,5    | 1,0         | 2,3        | **2,4**    |
| Genron NPO            | Japonia | 3,5      | 1,6      | 3,0     | 3,0    | 1,0         | 1,8        | **2,1**    |
| JIIA                  | Japonia | 3,5      | 1,8      | 2,0     | 3,5    | 1,0         | 1,9        | **1,9**    |
| NIDS                  | Japonia | 3,0      | 1,6      | 2,0     | 3,0    | 1,0         | 1,7        | **1,7**    |

**Azja/Rosja — synteza:** wspólny mianownik to **wielojęzyczność** (rosyjskie i japońskie TT prowadzą pełne
lustra językowe — Wałdaj/RIAC 7,0–7,5 w kryterium „języki", jedyny obszar zbliżający się do NES 9,0) oraz
całkowity brak monetyzacji, wyszukiwarki zaawansowanej, społeczności i profili użytkownika. Chińskie TT
prowadzą społeczności w grupach WeChat — **poza własnymi platformami** (niewidoczne w serwisie → nie
punktowane). Reszta modułów wewnętrznych: b/d.

---

# Wnioski przekrojowe (konkurenci)

## Co pokazuje wzór „b/d"

Na **9 z 20 modułów** (2, 3, 4, 12, 16, 17, 18, 19, 20) porównanie jest **strukturalnie niemożliwe**: to
zaplecze (edytor, builder, realtime-infra, analityka, CRM, multi-tenant, backend/RLS/testy), którego żaden
konkurent nie wystawia publicznie. NES ma tam 7,3–8,7 (oceniane z kodu). To nie „przewaga w module" — to
**cała warstwa produktu, na której nie ma z kim się porównać**. Dla think-tanku/serwisu treści taki backend
(własny CMS + membership + CRM + BI) jest ewenementem; konkurenci albo kupują to jako osobne SaaS-y
(niewidoczne z zewnątrz), albo nie mają wcale.

## Gdzie konkurenci realnie grają (moduły publiczne)

- **Treść i storytelling (M1, M7):** jedyne pole, gdzie ktoś bije NES — globalne media (Bloomberg/FT
  czytanie 9,0; Bloomberg Graphics 9,0). Najlepsze TT (CSIS/CFR) dorównują NES w microsites/trackerach.
- **SEO/dystrybucja (M8):** media 8,0–9,0 (parytet/lekka przewaga nad NES 7,9); najlepsze TT 7,0–7,5.
- **Paywall (M13):** tylko media (FT 9,0, Economist 8,5, Bloomberg 8,0) i dwa TT (RUSI 6,0, Chatham House
  5,5) grają realnie; reszta TT ≤ 2,5. NES 8,4 z per-item i dożywotnim — czego serwisy publiczne nie mają.

## Gdzie NES jest bezkonkurencyjny (obserwowalnie)

- **Czat/komunikator (M9):** 0 u wszystkich 38. Przewaga kategorialna.
- **Sieć/profil użytkownika (M10, M15):** networking ≈ 0,5–1,0 u wszystkich (delegują do LinkedIn);
  profil czytelnika szczątkowy (max FT 3,7 vs NES 8,0).
- **Wyszukiwarka (M6):** NES 8,3; najbliżej RAND 5,6 i FT 4,8 — nikt inny nie przekracza 4,6.
- **Newsletter jako system (M11):** media mają silne kanały (8,0), ale NES ma własny kreator + kampanie
  - segmentację (u konkurentów niewidoczne / kupowane w Mailchimp-ach).

## Ranking realnych rywali (agregat publiczny 07-20)

1. **Financial Times 5,5** — jedyny bijący NES w >1 module (czytanie, paywall-parytet, myFT-alerty).
2. **Bloomberg.com 4,9** · **Reuters 4,7** · **The Economist 4,4** · **Politico 4,2** — media.
3. **Najlepszy think-tank: CSIS / CFR 4,1** — o ~3,9 pkt za NES; żaden TT nie ma paywalla, sieci ani czatu.
4. Polska liga (2,3 max) i Azja/Rosja (1,7–2,9) — cyfrowo najdalej.

**Zastrzeżenie:** oceny konkurentów to stan wiedzy do poł. 2026 (`OCENA_KONKURENCI_INDYWIDUALNIE_2026-07-20`),
przemapowany na 20 modułów. Im mniejszy podmiot, tym niższa pewność. „b/d" oznacza brak danych z zewnątrz, nie
brak funkcji. Pełne rozbicie 5 modułów na sub-kryteria (31 kryteriów × 38 konkurentów) — w dokumencie 07-20.
