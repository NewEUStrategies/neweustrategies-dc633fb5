# Porównanie NES z think-tankami — funkcje WWW i budowa społeczności

**Data:** 2026-07-16 · **Zakres:** funkcjonalności stron WWW + budowanie społeczności · **Skala:** 0–10

## Metodologia i zastrzeżenia

Profil NES pochodzi z bezpośredniej lektury kodu (audyt `OCENA_MODULOW_2026-07-16.md`). Dane o
think-tankach zebrano przez badanie WWW (lipiec 2026). **Zastrzeżenia:** część witryn (RAND, CFR,
CSIS, Bruegel, ECFR, PISM, OSW, Polityka Insight, Batory) blokuje boty (403/Cloudflare), więc ustalenia
o nich opierają się na indeksie wyszukiwarki i podstronach, nie na „klikaniu" po zalogowanych panelach.
Liczby obserwujących w social są orientacyjne. Oceny mierzą **dojrzałość funkcji**, nie autorytet treści
ani markę (o które w tym porównaniu nie chodzi).

## Jak czytać tabele — dwie osie „społeczności"

Kluczowe rozróżnienie, bez którego porównanie wprowadza w błąd:

- **Funkcje społ. on-site** — realne, dwukierunkowe funkcje społecznościowe **na stronie**: komentarze,
  fora, Q&A, ankiety, czat, powiadomienia. To zdolność **platformy**.
- **Siła audytorium/społeczności** — dojrzałość modelu budowania wspólnoty **poza** interaktywnością
  strony: płatne członkostwo, sieci ekspertów, darczyńcy, zasięg w social/YouTube, wydarzenia. To
  **dorobek** instytucji.

Ta różnica jest sednem porównania: **NES ma maszynerię społeczności online, której nie ma praktycznie
nikt w branży — ale maszyneria ≠ społeczność.** Think-tanki mają odwrotnie: zero funkcji on-site, za to
dojrzałe, sprawdzone audytorium (członkowie, darczyńcy, subskrybenci, miliony wyświetleń). NES jako nowa
platforma ma tę drugą oś nieudowodnioną.

Kolumny: **Interakt. dane** = interaktywne narzędzia/trackery/wizualizacje; **Funkcje WWW** = kompozyt
(formaty, dataviz, multimedia, wyszukiwarka, newsletter, wydarzenia, wielojęzyczność, mobile).

## NES — punkt odniesienia (stały we wszystkich tabelach)

| Wymiar | NES | Komentarz |
|--------|:---:|-----------|
| Interaktywne dane / trackery | 8 | Silnik widgetów `feature-*` (timeline/sankey/compare/network/corridor-map), choropleta, EU Policy Tracker (mapa 27 państw). Engine mocny; **głębia/kuracja pojedynczego flagowca ustępuje CSIS/ECFR** |
| Wielojęzyczność | 9 | Pełne PL/EN, hreflang, per-request SSR — na poziomie najlepszych (Carnegie/SWP) |
| Multimedia (podcast/wideo) | 8 | Sieć programów, RSS per-show, TTS |
| Konta / personalizacja | 8 | Zainteresowania, rekomendacje, reading list, onboarding — **rzadkość w branży** |
| Newsletter / e-mail | 8 | Kampanie, double opt-in, tracking, RFC 8058 |
| Wydarzenia / RSVP | 8 | Limit miejsc, tier-gating, reminders |
| Członkostwo / monetyzacja | 8 | Rangi reader→partner, Stripe, paywall na przywilejach kolumn, darowizny |
| Mobile / push | 8 | Web push (VAPID); responsywność (bez natywnej appki — tu PI wyprzedza) |
| SEO / GEO / AEO | 9 | JSON-LD, sitemap, llms.txt, polityka AI — benchmark |
| **Funkcje WWW (kompozyt)** | **8,5** | **Wiodąca SZEROKOŚĆ funkcji; ustępuje liderom głębią flagowych narzędzi danych** |
| **Funkcje społ. ON-SITE** | **9** | Komentarze, Q&A (anonimowość Chatham House), ankiety (anti-anchoring), **czat 1:1+grupy**, powiadomienia, web push, badges — **niemal unikat w całej branży** |
| **Siła audytorium** | **3** | Nowa platforma — audytorium/społeczność **nieudowodnione** (uczciwie) |

---

## Tabela 1 — Liga ŚWIATOWA

| Podmiot | Interakt. dane | Konta/pers. | Mobile/push | **Funkcje WWW** | **Funkcje społ. on-site** | **Siła audytorium** | Flagowe narzędzie / model społeczności |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **NES** | 8 | 8 | 8 | **8,5** | **9** | **3** | Czat/Q&A/ankiety/push + silnik features; audytorium nieudowodnione |
| CSIS | 10 | 2 | 2 | **9** | 1 | 7 | iDeas Lab: ChinaPower, AMTI (zdjęcia satelitarne), Missile Threat |
| Atlantic Council | 9 | 2 | 2 | **9** | 1 | 7 | GeoEconomics: CBDC Tracker (146 krajów), Sanctions Dashboard; DFRLab |
| CFR | 9 | 4 | 3 | **9** | 3 | 9 | Global Conflict Tracker; Model Diplomacy (symulator); płatne członkostwo + Foreign Affairs |
| Brookings | 8 | 3 | 2 | **8** | 1 | 7 | Hamilton Project (Vitality Index, Trade Tracker) |
| RAND | 8 | 2 | 2 | **8** | 1 | 6 | Gun Policy suite, RDWTI; biblioteka 10 000+ |
| Chatham House | 5 | 4 | 2 | **7** | **6** | 8 | **Common Futures Conversations** (2000+ młodych, 120+ krajów); płatne członkostwo tiered |
| Carnegie | 6 | 2 | 2 | **7** | 1 | 7 | Global Protest Tracker; sieć centrów AR/RU/ZH/FR |
| Heritage | 6 | 3 | 2 | **7** | 2 | 8 | Index of Economic Freedom; masowy model darczyńczy |
| PIIE | 6 | 2 | 2 | **6** | 1 | 5 | PIIE Charts / Trackers |

**Odczyt:** liderzy (CSIS, Atlantic Council, CFR) biją NES **głębią flagowych narzędzi danych** — lata
kuracji + zespół produkcyjny (CSIS iDeas Lab). NES dorównuje im **szerokością funkcji WWW** i przewyższa
w kontach/personalizacji, mobile/push oraz **zdecydowanie w funkcjach społeczności on-site** (jedynie
Chatham House ma realny wyjątek — Common Futures Conversations). Na osi **siły audytorium** cała czołówka
bije NES — mają płatne członkostwo (CFR/Chatham House), masę darczyńców (Heritage) i milionowe zasięgi.

---

## Tabela 2 — Liga EUROPEJSKA (EU-policy)

| Podmiot | Interakt. dane | Konta/pers. | Mobile/push | **Funkcje WWW** | **Funkcje społ. on-site** | **Siła audytorium** | Flagowe narzędzie / model społeczności |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **NES** | 8 | 8 | 8 | **8,5** | **9** | **3** | Czat/Q&A/ankiety/push + features + tracker EU; audytorium nieudowodnione |
| ECFR | 10 | 2 | 2 | **9** | 2 | 7 | **EU Coalition Explorer**, Sovereignty Index, Power Atlas; Rada >300 (elitarna, offline) |
| Bruegel | 9 | 2 | 2 | **8,5** | 1 | 7 | Sekcja **Datasets** (~15/rok, żywe trackery gazu/energii/handlu) |
| IISS | 8 (płatne) | 7 | 4 | **7,5** | 2 | 7 | **Military Balance+** (subskrypcyjny dashboard z logowaniem); Shangri-La/Manama Dialogue |
| Friends of Europe | 5 | 3 | 2 | **6,5** | **7** | 6 | **Debating Europe** (obywatele × politycy — realna społeczność online) |
| Carnegie Europe | 3 | 1 | 2 | **6,5** | 1 | 6 | Strategic Europe (blog); brak flagowego narzędzia |
| CEPS | 4 | 4 | 2 | **6** | 1 | 6 | Portal członkowski; CEPS Ideas Lab |
| Clingendael | 5 | 2 | 2 | **6** | 1 | 5 | Global Security Pulse; Clingendael Spectator |
| Jacques Delors | 3 | 1 | 2 | **5** | 1 | 5 | Pełna dwujęzyczność FR/EN; PDF-centryczny |
| SWP | 2 | 1 | 2 | **5** | 1 | 5 | Dwujęzyczność DE/EN; „fabryka" recenzowanych PDF |
| Egmont | 2 | 1 | 2 | **4,5** | 1 | 4 | Egmont Papers; minimalna interaktywność |

**Odczyt:** ECFR (EU Coalition Explorer) i Bruegel (Datasets) są **liderami narzędzi danych** — NES
ustępuje im głębią pojedynczego flagowca, ale bije **całą ligę** szerokością funkcji, kontami,
mobile/push i funkcjami społeczności on-site (jedyny realny wyjątek: Debating Europe). IISS to jedyny
z prawdziwym paywallem + kontami (Military Balance+). Na osi siły audytorium wygrywają elitarne sieci
członkowskie (ECFR Council, CEPS) i sztandarowe konferencje.

---

## Tabela 3 — Liga POLSKA

| Podmiot | Interakt. dane | Konta/pers. | Mobile/push | **Funkcje WWW** | **Funkcje społ. on-site** | **Siła audytorium** | Flagowe / model społeczności |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **NES** | 8 | 8 | 8 | **8,5** | **9** | **3** | Czat/Q&A/ankiety/push + features + tracker EU; audytorium nieudowodnione |
| Polityka Insight | 3 | 8 | 8 | **8–9** | 1 | 6 | Subskrypcja B2B (PI Premium/Finance/Energy), **aplikacje iOS+Android z push**, ~1000 abonentów |
| WEI | 5 | 1 | 1 | **7** | 1 | 5 | **Raport Cwanego Mikołaja** (kalkulator), portal „Plusy Ujemne", wizualizacje Indeksu Wolności Gosp. |
| PISM | 1 | 2 | 1 | **7** | 1 | 6 | Biblioteka cyfrowa (dLibra), e-księgarnia; X ~57 tys. |
| OSW | 1 | 1 | 1 | **7** | 1 | **7** | **YouTube ~254 tys. subskr.** (~59 mln wyśw.) — największa społeczność w PL |
| Klub Jagielloński | 1 | 2 | 1 | **6,5** | 1 | **7,5** | Realne członkostwo stowarzyszenia + Patronite/1,5%/FaniMani; FB ~68 tys.; najbogatsze podcasty |
| Nowa Konfederacja | 1 | 3 | 1 | **6,5** | 1 | 7 | Najlepszy model patronacki (Patronite progi, „Współwydawca", konta czytelnika, zamknięte grupy) |
| Fund. Batorego | 5 | 2 | 1 | **6,5** | 1 | 6 | **Indeks codziennej demokracji lokalnej** (interaktywna mapa gmin); sieć grantobiorców; FB ~41 tys. |
| Instytut Kościuszki | 1 | 1 | 1 | **5,5** | 1 | 5 | CYBERSEC (osobny serwis eventowy z biletowaniem) |
| WiseEuropa | 2 | 1 | 1 | **6** | 1 | 3 | Mikrosite'y projektowe; WordPress |
| CASE | 1 | 1 | 1 | **5** | 1 | 3 | Najstarszy technologicznie serwis; biblioteka PDF |

**Odczyt:** w polskiej lidze NES byłby **technologicznie w czołówce**. Jedyny realny rywal produktowy
to **Polityka Insight** (konta, natywne aplikacje z push, sprawdzony paywall B2B) — ale PI to zamknięty,
tekstowy serwis bez interaktywnych danych i bez społeczności on-site; NES bije go szerokością
(interaktywne dane, wielojęzyczność publiczna, features, tracker) i funkcjami społeczności. Realne
narzędzia interaktywne w PL mają tylko **WEI** („Raport Cwanego Mikołaja", „Plusy Ujemne") i **Fundacja
Batory** (Indeks demokracji lokalnej) — reszta to PDF/tekst. Najsilniejsze audytorium: **OSW**
(YouTube 254 tys.) i modele członkowsko-darczyńcze **Klubu Jagiellońskiego** (członkostwo + FB ~68 tys.)
oraz **Nowej Konfederacji** (dopracowany patronat). Społeczność on-site to w całej lidze **pusta przestrzeń**.

---

## Synteza — gdzie stoi NES

### Gdzie NES wygrywa (we wszystkich trzech ligach)
1. **Funkcje społeczności on-site — praktycznie unikat.** Komentarze, Q&A, ankiety, **czat 1:1/grupowy**,
   powiadomienia i web push to zestaw, którego nie ma niemal żaden think-tank na świecie. Realne wyjątki
   to tylko wydzielone platformy: Chatham House **Common Futures Conversations** i **Debating Europe**
   (Friends of Europe) — i żadna nie ma czatu ani tak głębokiej integracji z treścią jak NES.
2. **Szerokość funkcji platformy.** NES łączy w jednym produkcie to, co u think-tanków jest rozproszone
   lub nieobecne: hybrydowy CMS + builder, silnik danych, wielojęzyczność, personalizacja/konta,
   newsletter, wydarzenia, monetyzację (paywall/darowizny), SEO/GEO/AEO i mobile push.
3. **Konta / personalizacja / mobile push** — obszary, w których nawet światowi liderzy interaktywności
   (CSIS, Atlantic Council) mają 2/10. W PL dorównuje tu tylko Polityka Insight.

### Gdzie NES ustępuje (uczciwie)
1. **Głębia flagowych narzędzi danych.** CSIS (ChinaPower/AMTI), ECFR (EU Coalition Explorer), Bruegel
   (Datasets) mają markowe produkty danych budowane latami przez dedykowane zespoły. Silnik NES jest
   sprawny, ale generyczny — nie ma jeszcze jednego rozpoznawalnego „flagowca" tej klasy.
2. **Siła i dowód audytorium.** Cała czołówka ma sprawdzoną społeczność: płatne członkostwo (CFR,
   Chatham House, IISS), masę darczyńców (Heritage, Nowa Konfederacja, KJ), milionowe zasięgi
   (OSW 254 tys. YouTube). NES ma **narzędzia**, nie **udowodnioną wspólnotę** — to największe ryzyko.
3. **Autorytet treści i marka** — poza zakresem tego porównania, ale to fundament, na którym think-tanki
   budują wszystko powyżej.

### Wniosek jednym zdaniem
> Na osi **funkcjonalności WWW + zdolności społecznościowych platformy** NES plasuje się w czołówce
> każdej z trzech lig i jest **niemal bezkonkurencyjny w funkcjach społeczności on-site**; przegrywa
> natomiast tam, gdzie liczą się **lata kuracji danych i dowód realnego audytorium** — czyli w tym,
> czego nie da się „zbudować w kodzie".

## Rekomendacje strategiczne (jak przekuć przewagę platformową w realną przewagę)

1. **Zbudować 1–2 markowe „flagowe" narzędzia danych** na istniejącym silniku (np. rozbudować EU Policy
   Tracker do poziomu ECFR Coalition Explorer / CSIS ChinaPower) — to jedyny obszar, gdzie liderzy WWW
   realnie wyprzedzają NES. Głębia i kuracja > liczba widgetów.
2. **Aktywować unikatowe funkcje społeczności on-site jako wyróżnik produktowy** — Q&A z ekspertami
   (model Chatham House/Debating Europe, ale wbudowany w treść), ankiety przy dossier, czat wokół
   wydarzeń. To przestrzeń, której branża praktycznie nie zajmuje — ale wymaga strategii moderacji
   i masy krytycznej użytkowników, inaczej funkcje pozostaną puste.
3. **Uruchomić mierzalny model członkostwa/audytorium** (rangi reader→partner już istnieją) i zamknąć
   defekt „mock-mode" billing przed produkcją — to warunek monetyzacji na wzór PI / CFR.
4. **Wykorzystać przewagę mobile/push** (natywna appka lub PWA + push), której w Europie i w rdzeniu
   światowej ligi nie ma niemal nikt (poza Polityką Insight i Foreign Affairs).
5. **Domknąć defekty z audytu obniżające funkcje WWW** — zwłaszcza pozorny code-splitting (wydajność
   każdej strony) i martwy menedżer przekierowań (SEO) — bo to bezpośrednio obniża ocenę „Funkcje WWW".

---

*Kontekst: pełny audyt techniczny platformy w `docs/OCENA_MODULOW_2026-07-16.md` (werdykt ~7,8/10).*
