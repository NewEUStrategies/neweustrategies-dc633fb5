# Krajobraz produktowy — kto pokrywa które nasze moduły i ile kosztowałoby odtworzenie NES (2026-07-24)

Czwarty dokument serii (po `INWENTARZ_FUNKCJONALNOSCI`, `OCENA_FUNKCJI`, `OCENA_FUNKCJI_KONKURENCI`).
Odpowiada na pytanie: _czy istnieje platforma z takim zestawem funkcji jak nasza — a jeśli nie, ile kosztowałoby
złożenie jej z gotowych produktów._ Materiał pod pitch inwestorski/partnerski i decyzje „build vs buy".

**Werdykt:** nie istnieje **pojedyncza** platforma (ani think-tankowa, ani medialna, ani produktowa) łącząca to,
co NES ma w jednym systemie. Odpowiednik trzeba **złożyć z 5–7 osobnych SaaS-ów** — i nawet wtedy brakuje
modułów domenowych (tracker legislacyjny, huby ekspertów, digital features, PL/EN, multi-tenant) oraz **jednego
modelu danych i single sign-on**, które u nas są natywne.

**Zasada realizmu:** ceny publiczne podaję wprost (ze źródłami); enterprise bez cennika (Arc XP, Piano,
Salesforce) → **„wycena indywidualna"** z rzędem wielkości znanym z rynku. Kwoty są **poglądowe** (USD, rozliczenie
roczne gdzie tańsze), zależą od skali (kontakty/członkowie/ruch).

---

## 1. Mapa pokrycia — który produkt pokrywa który z 20 modułów NES

Pokrycie: **Pełne** (gotowy produkt ~dorównuje) · **Częściowe** (pokrywa część) · **API/Custom** (tylko klocki
do zbudowania) · **Brak** (nikt nie sprzedaje tego dla wydawcy).

| #   | Moduł NES                                         | Najbliższy produkt / kategoria                | Pokrycie           | Luka względem nas                                                |
| --- | ------------------------------------------------- | --------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| 1   | Wpisy — czytelnik                                 | Ghost, Arc XP                                 | Częściowe          | brak TTS per-artykuł, gift, quote-share, słowniczka, cytowań     |
| 2   | Edytor + workflow                                 | Arc XP (Composer/WebSked), WordPress          | Częściowe          | workflow tak; autosave-konflikt/4-tryby rzadkie                  |
| 3   | Silniki treści (bloki + builder)                  | WordPress+Gutenberg, Webflow                  | Częściowe          | brak interop bloki⇄builder i self-service dla redakcji           |
| 4   | Wygląd, motyw, media, import                      | dowolny CMS                                   | Częściowe          | standard                                                         |
| 5   | Strona główna / archiwa / chrome                  | dowolny CMS                                   | Pełne              | standard                                                         |
| 6   | Wyszukiwarka (FTS+semantyka+fasety)               | Algolia                                       | Częściowe (płatne) | u nas natywna (Postgres FTS+pgvector), koszt marginalny 0        |
| 7   | Typy specjalne (podcast/events/tracker/polls/Q&A) | podcast host + Eventbrite + …                 | Fragmentaryczne    | **tracker legislacyjny = brak produktu**                         |
| 8   | SEO / feedy / dane strukturalne                   | Ghost, Yoast (WP)                             | Pełne/Częściowe    | dobre w Ghost/WP                                                 |
| 9   | Czat / komunikator (DM/grupy in-app)              | Sendbird/Stream (API), Discord                | API/Custom         | brak gotowego „w platformie treściowej"                          |
| 10  | Sieć / networking (graf połączeń)                 | — (wszyscy: LinkedIn)                         | **Brak**           | nikt nie sprzedaje grafu połączeń dla wydawcy                    |
| 11  | Newsletter (kreator+kampanie+segmenty)            | Ghost native, Mailchimp, Beehiiv              | Pełne              | dojrzałe                                                         |
| 12  | Realtime / powiadomienia / push                   | Pusher/Ably + OneSignal                       | API/Custom         | infra, nie produkt end-user                                      |
| 13  | Monetyzacja — paywall / subskrypcje               | **Piano.io**, Ghost, Stripe Billing           | Pełne              | Piano lepszy w dynamicznym paywallu AI                           |
| 14  | Monetyzacja — kupony/darowizny/reklamy            | Stripe + Google Ad Manager                    | Częściowe          | rozproszone po narzędziach                                       |
| 15  | Profil i konto (ekspert + członek)                | Auth0/Clerk + custom, Circle                  | Częściowe          | profil eksperta+dorobek jak nasz = custom                        |
| 16  | Zarządzanie społecznością                         | Circle/Discourse (admin)                      | Częściowe          | tylko jeśli społeczność w osobnym produkcie                      |
| 17  | Analityka i BI                                    | GA4/Looker, **Piano Analytics**               | Pełne              | dojrzałe, ale **osobne** dashboardy                              |
| 18  | CRM + lead scoring                                | **HubSpot**, Salesforce                       | Pełne              | dojrzałe, ale **osobny** system; integracja z treścią = robota   |
| 19  | Ustawienia / multi-tenant / RODO                  | OneTrust/Cookiebot (consent); multi-tenant: — | Brak/Custom        | **multi-tenant (1 wdrożenie, wiele domen) — nikt nie sprzedaje** |
| 20  | Platforma / backend / MCP / event-bus             | własny stack                                  | **Custom**         | to jest „klej" spinający resztę — nie do kupienia                |

**Odczyt mapy:** _Pełne_ pokrycie mają głównie moduły „towarowe" (CMS, SEO, newsletter, paywall, CRM, BI) —
każdy u innego vendora. Moduły, które nas wyróżniają (czat in-app, graf sieci, tracker legislacyjny, digital
features, multi-tenant, event-bus), są **Brak/Custom** — nie istnieją jako produkt dla naszej branży.

---

## 2. Scenariusz A — „creator/mid" (najtańszy sensowny odpowiednik)

Dla organizacji chcącej zbliżyć się do NES bez enterprise:

| Warstwa                               | Produkt                   | Cena (poglądowo)                                            |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Publishing + membership + newsletter  | Ghost Pro **Business**    | **$199/mo**                                                 |
| Społeczność + kursy (+ czat forumowy) | Circle **Business**       | **$199/mo** (+0,5–2% transakcji, Email Hub osobno)          |
| CRM + lead scoring + marketing        | HubSpot **Marketing Pro** | **$890/mo** (+ $3 000 onboarding, +$250/5 000 kontaktów)    |
| Wizualizacje danych                   | Datawrapper **Teams**     | **~$50/mo** ($599/rok)                                      |
| Wyszukiwarka klasy premium            | Algolia (opcjonalnie)     | **~$300–500/mo**                                            |
| Push / realtime                       | OneSignal / Pusher        | **$0–100/mo**                                               |
| Analityka                             | GA4 + Looker Studio       | **$0**                                                      |
| **Razem SaaS**                        |                           | **≈ $1 650–2 150/mo → $20–26 tys./rok** + $3 tys. wdrożenie |

**Nie pokrywa (→ dobudować):** tracker legislacyjny, huby ekspertów, silnik digital features, graf połączeń,
multi-tenant, model PL/EN, czat DM in-app, gift/quote-share/słowniczek. To większość naszej wartości domenowej.

## 3. Scenariusz B — „enterprise/media" (blisko naszej głębi)

| Warstwa                                   | Produkt                         | Cena (poglądowo)                                                                   |
| ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Publishing + subskrypcje + identity + DAM | **Arc XP** (platforma WaPo)     | wycena indywidualna — **rząd sześciocyfrowy/rok** ($100k+)                         |
| Dynamiczny paywall + CDP + analityka      | **Piano.io**                    | wycena indywidualna — **~$30–120 tys./rok**                                        |
| Społeczność                               | Circle Enterprise / Discourse   | **$419/mo+**                                                                       |
| CRM                                       | Salesforce / HubSpot Enterprise | **$1 500–5 000+/mo**                                                               |
| Wizualizacje                              | Flourish Business               | wycena indywidualna (~$1–5 tys./rok)                                               |
| Czat DM/grupy (API)                       | Sendbird / Stream               | **$400–2 000+/mo**                                                                 |
| **Razem**                                 |                                 | **łatwo $200–500+ tys./rok**, wciąż bez modułów domenowych i jednego modelu danych |

## 4. Czego nie kupisz w żadnym scenariuszu (tylko custom)

Te moduły **nie istnieją jako produkt** — u nas są, bo je zbudowaliśmy:

- **Tracker legislacyjny UE** — dossier + pozycje państw + mapa + oś czasu + `Legislation` JSON-LD.
- **Huby ekspertów** — strona eksperta z conditional indexation i PII przez widok publiczny.
- **Silnik NES Digital Features** — Sankey / RiskMatrix / CorridorMap / Timeline / Network osadzane w builderze.
- **Dwujęzyczny model treści PL/EN** — 153 pary kolumn end-to-end (nie „wtyczka tłumacząca").
- **Multi-tenant** — jedno wdrożenie obsługujące wiele domen/tenantów z izolacją RLS.
- **Szyna zdarzeń domenowych + wspólny model danych + SSO** — „klej" spinający wszystkie moduły w jeden system.

**Szacunek custom-buildu (poglądowo):** te elementy to rdzeń własnej platformy — realnie **kilkanaście–kilkadziesiąt
osobo-miesięcy** inżynierii; przy stawkach dev w UE rząd **$200–600 tys.+ jednorazowo** plus utrzymanie.

## 5. „Podatek integracyjny" (ukryty koszt składania z klocków)

Nawet kupując 6–7 produktów, tracisz to, co u nas natywne:

- **Single sign-on** — u nas 1 konto = czytelnik + członek + uczestnik czatu + lead CRM. W stosie: 6 osobnych tożsamości do zszycia.
- **Jeden model danych** — członkostwo ↔ treść ↔ CRM ↔ analityka spójne. W stosie: ETL/webhooki między vendorami (ciągły koszt, typowo **0,5–1 etatu** inżyniera integracji).
- **Realtime-invalidacja cache między modułami** (nasz event-bus) — w stosie brak; dane rozjeżdżają się między systemami.
- **Wspólne RODO/consent** — u nas jeden audyt zgód; w stosie zgody rozproszone po 6 systemach.

## 6. Bottom line (TCO i wnioski)

|                                               | Scenariusz A (mid) | Scenariusz B (enterprise) | NES                            |
| --------------------------------------------- | ------------------ | ------------------------- | ------------------------------ |
| Koszt roczny SaaS                             | ~$20–26 tys.       | ~$200–500+ tys.           | własny hosting (rząd tys./rok) |
| Custom domenowy (jednorazowo)                 | ~$200 tys.+        | ~$200 tys.+               | już zbudowany                  |
| Integracja/utrzymanie                         | 0,5–1 etatu        | 1+ etat                   | natywna (jeden system)         |
| Moduły domenowe (tracker/huby/features/PL-EN) | ❌                 | ❌                        | ✅                             |
| Jeden model danych + SSO + multi-tenant       | ❌                 | ❌                        | ✅                             |

**Wnioski strategiczne:**

1. **Nie ma jednego odpowiednika** — ani w think-tankach, ani w mediach, ani jako produkt.
2. **Najbliżej filozofią:** Arc XP (media-first, publishing+subskrypcje) i Circle/Mighty (community-first,
   członkostwo+czat) — ale każde pokrywa tylko ~jedną trzecią naszych modułów.
3. **Nasza fosa to integracja, nie pojedyncza funkcja** — jeden system z 20 modułami na wspólnym modelu danych,
   multi-tenant, z formatami think-tankowymi, których nie da się kupić.
4. **Uczciwie:** w pojedynczych wycinkach specjaliści bywają dojrzalsi (dynamiczny paywall Piano, społeczność
   Circle, skala newsroomu Arc XP). Przewaga NES = szerokość + integracja + dopasowanie domenowe, nie głębia
   w każdym module z osobna.

---

## Źródła (ceny/funkcje, stan 2026-07)

- Arc XP — [Digital Subscriptions & Identity](https://www.arcxp.com/products/digital-subscriptions/) · [vs WordPress (rtCamp)](https://rtcamp.com/resources/arc-xp-vs-wordpress/)
- Piano — [Platform Overview](https://www.piano.io/product/platform-overview) (cennik: wycena indywidualna)
- Circle — [Pricing 2026 (SchoolMaker)](https://www.schoolmaker.com/blog/circle-so-pricing) · [Circle vs Mighty](https://www.mightynetworks.com/resources/circle-vs-mighty-networks)
- Ghost — [Pricing 2026 (Typeflo)](https://typeflo.io/blog/ghost-pricing-plans) · [vs Substack](https://newsletter.supply/compare/substack-vs-ghost.html)
- HubSpot — [Pricing 2026 (Forbes Advisor)](https://www.forbes.com/advisor/business/hubspot-crm-pricing/)
- Datawrapper / Flourish — [Flourish pricing](https://flourish.studio/pricing/)

_Kwoty poglądowe, zależne od skali; enterprise (Arc XP, Piano, Salesforce, Flourish Business) — wycena indywidualna. Stan: 2026-07-24._
