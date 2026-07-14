# Ocena platformy i pozycjonowanie konkurencyjne

**Przedmiot:** platforma New European Strategies (NES) — moduły, funkcjonalności, rodzaje publikacji, wydarzenia.
**Benchmark:** Politico, Politico PRO, Reuters, Bloomberg (Terminal / BGOV / Bloomberg Law), RUSI, think-tank,
Nowa Konfederacja, Klub Jagielloński, Instytut Nowej Europy — oraz dla kontekstu: Chatham House, Bruegel,
ECFR, Carnegie Europe, Atlantic Council, Brookings, CEPA, PISM, OSW, Instytut Sobieskiego, Fundacja Batorego, WEI.
**Data:** 2026-07-13 · **Autor oceny:** audyt wewnętrzny.

> **Uwaga metodologiczna.** Ta ocena łączy dwa różne pomiary. (1) *Inwentaryzację i dojrzałość samej platformy*
> opieram na kodzie i dwóch wewnętrznych audytach (`docs/OCENA_PLATFORMY.md`, `docs/AUDYT_PLATFORMY_2026-07-13.md`) —
> to twarde dane. (2) *Profile konkurentów* pochodzą z publicznych źródeł (strony produktowe, dokumentacja,
> rzetelne opracowania) zebranych na potrzeby tego dokumentu w lipcu 2026; liczby cenowe konkurentów są
> szacunkowe (oznaczone „szac."), bo Politico PRO, Bloomberg i większość think-tanków nie publikują cenników.
> Porównanie dotyczy **produktu cyfrowego i modelu wydawniczego** — nie skali redakcji ani autorytetu marki,
> które omawiam osobno jako czynnik, którego oprogramowanie nie zastąpi.

---

## 1. Streszczenie zarządcze

**Werdykt jednym zdaniem:** NES zbudował platformę wydawniczą, której **inżynieria i szerokość funkcji plasują ją
znacznie powyżej całej polskiej konkurencji think-tankowej i realnie w lidze zachodnich instytucji** — ale jej
**głębia danych, narzędzia interaktywne i skala redakcyjna** nie dorównują liderom „policy intelligence"
(Politico PRO, Bloomberg), a części modułów społecznościowych dziś fizycznie nie działają.

Trzy tezy:

1. **Wobec think-tanków polskich (Nowa Konfederacja, Klub Jagielloński, INE, Sobieski, WEI) NES jest o kategorię
   wyżej technologicznie.** Wszystkie polskie podmioty to w praktyce portale typu WordPress z darmowymi PDF-ami,
   bez paywalla klasy produktowej, bez warstw członkostwa, bez personalizacji, bez narzędzi interaktywnych.
   NES ma to wszystko naraz w jednym, spójnym systemie. **To jest realna przewaga i najłatwiejsze do obronienia
   pole gry.**

2. **Wobec think-tanków zachodnich (RUSI, think-tank, Chatham House, ECFR, Bruegel, Atlantic Council) NES wygrywa
   „instalacją" (paywall, członkostwo, newsletter double opt-in, CRM, personalizacja, społeczność, SEO/GEO), ale
   przegrywa „treścią danych"** — bo pole, na którym ta liga faktycznie konkuruje, to **ciągle aktualizowane
   narzędzia interaktywne i zbiory danych** (think-tank ChinaPower/Missile Threat, ECFR EU Coalition Explorer, Bruegel
   datasets, Atlantic Council sanctions dashboards). Tu NES ma dopiero zalążek (EU Policy Tracker + wykresy).

3. **Wobec Politico PRO i Bloomberg BGOV NES nie jest — i nie powinien próbować być — „terminalem policy
   intelligence".** Ich fosa to strukturalne, stale zasilane dane (teksty ustaw, poprawki, głosowania, rulemaking,
   dockety) spięte z newsroomem, wyszukiwarka AI, alerty i raportowanie sprzedawane per-fotel korporacyjnie.
   EU Policy Tracker NES to ręcznie kurowane dossier — właściwa kategoria, ale o rząd wielkości płytsza.

**Ocena pozycjonująca platformy jako produktu cyfrowego:** **8,5/10 względem polskiej ligi think-tankowej**,
**~6,5/10 względem zachodniej ligi think-tankowej**, **~4/10 względem Politico PRO / Bloomberg** (inna kategoria
produktu). Wewnętrzny audyt jakości inżynierskiej platformy: **~7,3/10** (pułap ~8,3 po naprawie czterech
zweryfikowanych defektów krytycznych).

---

## 2. Co NES faktycznie ma — inwentaryzacja (na podstawie kodu)

### 2.1 Rodzaje publikacji

| Typ publikacji | Stan | Odpowiednik u konkurencji |
| --- | --- | --- |
| **Artykuły / analizy** (edytor bloków Gutenberg 99 typów + builder Elementor 60 widgetów, workflow redakcyjny draft→review→published, rewizje, publikacja planowana, przypisy, key-takeaways, TOC, reading-time) | Produkcyjny (9/10) | rdzeń każdego z konkurentów |
| **Strony** (visual builder, rewizje) | Produkcyjny | landing/programy think-tank, Politico |
| **Podcasty** (CRUD, RSS z `<enclosure>`, globalny odtwarzacz, Media Session) | Beta (6/10) | RUSI (sieć podcastów), think-tank, Brookings, Nowa Konfederacja, OSW |
| **Web Stories** (AMP pod `/web-stories/$slug/amp`, kwalifikacja do karuzeli Google) | Produkcyjny (7/10) | rzadkie w tej lidze — potencjalny wyróżnik |
| **Live blog / relacja na żywo** (`/live`, realtime, SSR-prefetch) | Produkcyjny (7/10) | Politico/Reuters (live coverage) |
| **EU Policy Tracker** (dossier legislacyjne: 6 etapów procedury UE proposal→parliament→council→trilogue→adopted→in_force, 10 obszarów polityki, kamienie milowe, oś czasu zmian, obserwujący + powiadomienia) | Beta (7/10) | **Politico PRO Legislative Compass, Bloomberg BGOV** (kategoria) — ale znacznie płytszy |
| **Sesje Q&A** (pytania, upvote, moderacja) | 🔴 Zepsuty end-to-end (3/10) | AMA/członkowskie sesje eksperckie |
| **Ankiety / sondaże** | 🔴 Zepsuty end-to-end (2/10) | narzędzia zaangażowania |
| **Newsletter / kampanie** (double opt-in RFC 8058, wysyłka porcjami, tracking open/click) | Produkcyjny rdzeń + beta kampanii (7–9/10) | Politico Playbook, wszystkie think-tanki |
| **Text-to-speech** (narracja AI artykułów, ElevenLabs, cache) | Beta (6/10) | rzadkie — wyróżnik dostępnościowy |

**Wniosek:** szerokość typów publikacji **przewyższa większość konkurentów** (mało kto ma naraz artykuły w dwóch
silnikach, podcasty, web stories, live blog, tracker i newsletter w jednym systemie). Ale **głębia jest
nierówna**: trzy formaty społecznościowe (Q&A, ankiety, wydarzenia) są dziś zepsute na poziomie odczytu/zapisu.

### 2.2 Moduły i funkcjonalności (fundamenty produktu)

- **Silnik treści** — dwa edytory (bloki + builder), jeden punkt decyzyjny renderu, izolacja błędów per-węzeł, realne A/B (bucketing FNV-1a + z-test). **Klasa 8–9/10.**
- **Paywall / dostęp** — egzekwowany na **grantach kolumn Postgresa** (treść fizycznie odcięta od klienta, RPC `SECURITY DEFINER`), hasła bcrypt. Rzadkość — twardszy niż paywalle większości komercyjnych CMS-ów. (Uwaga audytu: obejście przez TTS do naprawy.)
- **Członkostwo i monetyzacja** — warstwy członkostwa (ranga + bramki funkcji), plany sprzedażowe: **subskrypcja** (dzień/tydzień/miesiąc/rok), **jednorazowy zakup dożywotni**, **zakup pojedynczej publikacji** (paywall per-encja); Stripe z serwerową weryfikacją cen i webhookiem klasy podręcznikowej.
- **Multi-tenant** — izolacja RLS na 115/115 tabel, plan anon fail-open / crawler fail-closed, cache SSR skopowany po hoście. (Uwaga: warstwa *prezentacji* — `site_settings` — nie jest jeszcze multi-tenant.)
- **Personalizacja** — realny ważony rekomender SQL (autor 4 / kategoria 3 / tag 2 / historia 1 / świeżość), followed-feed, test Big Five, merge danych gościa po zalogowaniu.
- **Społeczność** — czat 1:1 realtime (9/10), komentarze, obserwowanie, katalog osób z weryfikacją zawodową i odznakami, program kontrybutorów, powiadomienia in-app + **Web Push + e-mail digest**.
- **CRM i integracje** — skrzynka leadów, pipeline etapów, oś czasu, webhooki wychodzące HMAC, szyna zdarzeń domenowych (intermodularność **8,5/10** — najmocniejszy element architektury).
- **SEO / GEO** — klasa agencyjna: sitemapy z hreflang, news-sitemap 48 h, robots fail-closed z polityką AI-crawlerów, `llms.txt`, JSON-LD (NewsArticle/FAQ/Review/Breadcrumb), menedżer przekierowań, karty OG. **Poziom rzadki nawet w komercyjnych CMS-ach.**
- **i18n PL/EN** — dwujęzyczność łącznie z treścią (kolumny `_pl`/`_en`, FTS obu języków).
- **Analityka** — lejek członka, retencja kohortowa, RUM/Web Vitals, CTR reklam/popupów.
- **Panel admina** — 83 trasy, importer WordPress, role z audytem, impersonacja, serwer MCP.

### 2.3 Wydarzenia

Model wydarzeń jest zaprojektowany **wprost pod think-tank**, nie „pod eventy w ogóle":

- typy: **webinaria, panele, briefingi na żywo, spotkania tylko dla społeczności**;
- **RSVP z blokadą pojemności**, statusy „going/interested";
- **bramkowanie warstwą członkostwa** (`min_tier_rank`) i widocznością;
- **flaga „Chatham House Rule"** (`chatham_house`) — cecha wprost z kultury think-tankowej;
- **link do transmisji + nagranie** odcięte grantem kolumnowym, wydawane tylko przez RPC `get_event_access` (transmisja i archiwum nagrań dla uprawnionych);
- przypomnienia.

**To backend klasy RUSI/Chatham House** (członkowskie wydarzenia + archiwum nagrań za bramką). **Ale:** wg audytu
z 2026-07-13 moduł wydarzeń jest **zepsuty end-to-end (2/10)** — publiczne `/events` nie renderuje niczego, bo
zapytanie żąda kolumn odciętych grantem, a RSVP omija RPC. **Najpilniejsza naprawa funkcjonalna**, bo to
bezpośrednio przychodowy, członkowski format, a dziś się nie wyświetla.

---

## 3. Mapa konkurencji — trzy różne ligi

Konkurenci nie grają w jednej lidze. Traktowanie ich razem jest mylące; rozdzielam je, bo NES konkuruje z każdą
inaczej.

### Liga A — media i „policy intelligence" (Politico, Politico PRO, Reuters, Bloomberg)
Model: **subskrypcja / licencja korporacyjna per-fotel + wydarzenia + (agencje) licencjonowanie treści.** Fosa:
newsroom o dużej skali spięty ze **strukturalnymi, stale aktualizowanymi danymi** (ustawy, rulemaking, dockety,
głosowania, spending) i narzędziami (trackery, alerty, wyszukiwarka AF, wizualizacje).

- **Politico / Politico Europe** — darmowe dziennikarstwo + newslettery Playbook (agendotwórcze) + **Politico Live** (szczyty, debaty sponsorowane). Reklama + sponsoring wydarzeń + subskrypcje (Politico Europe szac. od ~€7 000/rok).
- **Politico PRO** — premium B2B: **Legislative Compass** (śledzenie ustaw, teksty, głosowania), **Regulatory Compass + Dialogue Tracking**, **alerty i dzienne digesty**, **DataPoint** (biblioteka gotowych wizualizacji budowanych przez analityków), **Pro Analysis** (Issue/Data/Bill). Subskrypcja per-fotel wg wertykału (szac. ~$35 tys.–$85 tys./rok).
- **Reuters** — globalny wire (≈190+ biur), **Reuters Connect** (licencjonowanie treści dla mediów), metered paywall (2024, szac. od ~$1/tydz.).
- **Bloomberg** — Terminal (szac. ~$32 tys./fotel/rok); **BGOV** — śledzenie legislacji federalnej + 50 stanów, **wyszukiwarka legislacyjna AI z „diff" wersji**, CRS, transkrypty, katalogi; **Bloomberg Law Dockets** z AI.

### Liga B — think-tanki zachodnie (RUSI, think-tank + Chatham House, Bruegel, ECFR, Carnegie, Atlantic Council, Brookings, CEPA)
Dwa podmodele. **Brytyjsko-europejski członkowski** (RUSI, Chatham House, Bruegel): **członkostwo indywidualne +
korporacyjne**, bramkowany portal członkowski, journal, archiwum nagrań. **Amerykański grantowy** (think-tank,
Atlantic Council, Brookings, CEPA): **darmowy, otwarty dostęp**, finansowanie z grantów/filantropii, ciężkie
inwestycje w **narzędzia interaktywne i studia multimedialne**.

- **RUSI** — *RUSI Journal* (od 1857, przez Taylor & Francis), Whitehall Papers/Reports, Occasional Papers, sieć podcastów, badania **OSINT/geoprzestrzenne**; portal członkowski `my.rusi.org` z archiwum nagrań; członkostwo od ~£85/rok (indywidualne), korporacyjne od ~£1 350+VAT.
- **think-tank** — otwarty dostęp; **iDeas Lab** (własne studio cyfrowe/multimedialne); flagowe interaktywne mikroserwisy-trackery: **ChinaPower**, **Missile Threat / Missile Defense Project**, **AMTI Island Tracker** (zdjęcia satelitarne). Finansowanie: granty korporacyjne/rządowe/fundacyjne, filantropia.
- **Chatham House** — *International Affairs*; 250+ wydarzeń/rok (wiele wg reguły Chatham House); członkostwo indywidualne + korporacyjne (duże korporacyjne ~£20 tys.).
- **Bruegel** — working papers + **duża biblioteka otwartych, pobieralnych zbiorów danych i trackerów** (np. European Clean Tech Tracker); członkowie-państwa + korporacyjni (stała opłata ~€50 tys.).
- **ECFR** — raporty + **EU Coalition Explorer** i European Foreign Policy Scorecard (interaktywne); finansowanie fundacyjne, treść darmowa.
- **Atlantic Council** — **GeoEconomics Center** (Global Sanctions Dashboard, Russia Sanctions Database, trackery dolara/CBDC), **DFRLab**; treść darmowa.

### Liga C — think-tanki polskie (Nowa Konfederacja, Klub Jagielloński, INE + Sobieski, WEI, PISM, OSW, Batory)
Model: **darczyńcy/członkowie/Patronite/1,5% podatku/granty** (część — budżet państwa). **Cyfrowo jednolicie
słabe** — niemal wszystkie to portale WordPress z darmowymi PDF-ami, **bez narzędzi interaktywnych, baz danych,
trackerów, warstw członkostwa klasy produktowej**. Wyróżniki to multimedia i dwujęzyczność, nie technologia.

- **Nowa Konfederacja** — „thinkzine"; **mecenat obywatelski** (darczyńcy/Patronite) + częściowy paywall + miesięcznik + mocne podcast/YouTube. Portal konwencjonalny.
- **Klub Jagielloński** — stowarzyszenie członkowskie + **Centrum Analiz KJ** + pismo *Pressje*; raporty darmowe (PDF); finansowanie mieszane (składki, 1,5%, darowizny, granty publiczne). Cyfrowo podstawowy.
- **INE (Instytut Nowej Europy)** — młody, mały, **dwujęzyczny** (PL/EN), nisza bezpieczeństwo/polityka zagraniczna; Patronite + granty (m.in. MSZ). Strona podstawowa.
- **OSW** — instytut państwowy, darmowy, bardzo produktywny, **YouTube 260 tys.+**; budżet państwa.
- **PISM** — instytut państwowy MSZ; raporty, biblioteka cyfrowa.

---

## 4. Porównanie po wymiarach

Skala: ✅ przewaga NES · ➖ parytet / porównywalne · ❌ NES w tyle.

### 4.1 Rodzaje publikacji (szerokość formatów)

| | Liga A (media/PRO) | Liga B (TT zachodnie) | Liga C (TT polskie) |
| --- | --- | --- | --- |
| Szerokość formatów w JEDNYM systemie | ➖ (mają szerzej, ale rozproszone / kupione) | ✅ (NES ma więcej formatów natywnie) | ✅✅ (nieporównywalnie szerzej) |
| Live blog / relacje | ➖ | ✅ | ✅ |
| Web Stories (AMP) | ✅ (rzadkie) | ✅ | ✅ |
| Podcasty | ➖ | ❌ (RUSI/think-tank mają sieci) | ➖ |
| Tracker legislacyjny jako format | ❌ (PRO/BGOV głębsze) | ➖ (ECFR/Bruegel: inne dane) | ✅✅ (żaden polski nie ma) |

**Podsumowanie:** NES ma **najszerszy natywny zestaw formatów w polskiej lidze i konkurencyjny w zachodniej**.
Przewagą jest *integracja* (jeden system, jeden paywall, jedna personalizacja), nie liczba formatów sama w sobie.

### 4.2 Moduły i funkcjonalności (dojrzałość produktu cyfrowego)

| Moduł | NES | Liga A | Liga B | Liga C |
| --- | --- | --- | --- | --- |
| Paywall / kontrola dostępu | grant kolumnowy (twardy) | ✅ zaawansowany | zwykle brak/prosty | brak lub prosty |
| Warstwy członkostwa + Stripe + zakup per-item | ✅ elastyczne | ➖ (per-fotel enterprise) | ➖ (członkostwo, mniej elastyczne) | ✅ (Patronite ≠ produkt) |
| Personalizacja / rekomender | ✅ realny SQL | ✅ (feedy) | ❌ zwykle brak | ❌ brak |
| Newsletter double opt-in + kampanie | ✅ | ✅ | ✅ | ➖ (proste) |
| Społeczność (czat, komentarze, follow, katalog osób) | ✅ bogata | ❌ (media tego nie robią) | ➖ (portale członkowskie) | ❌ brak |
| SEO / GEO | ✅ klasa agencyjna | ✅ | ➖ | ❌ podstawowe |
| Multi-tenant / white-label | ✅ (silnik gotowy) | n/d | n/d | ❌ |
| **Narzędzia interaktywne / dane** | ➖ zalążek (tracker + wykresy) | ✅✅ (PRO DataPoint, BGOV) | ✅✅ (iDeas Lab, Explorer, datasety) | ❌ |

**Kluczowy wniosek strategiczny:** jedyny wymiar, na którym NES jest **jednocześnie słaby i który jest realnym
polem gry całej ligi B** to **narzędzia interaktywne i dane**. Cała czołówka think-tanków różnicuje się dziś
**ciągle aktualizowanymi trackerami/dashboardami/zbiorami danych**, a nie PDF-ami. NES ma tu jeden atut
(EU Policy Tracker) i infrastrukturę wykresów — to jest **najlepsza dźwignia rozwoju**.

### 4.3 Wydarzenia

| | NES (projekt) | NES (stan realny) | Liga A | Liga B | Liga C |
| --- | --- | --- | --- | --- | --- |
| Webinary/panele/briefingi | ✅ | 🔴 nie renderuje | ✅ (Politico Live) | ✅✅ (rdzeń RUSI/CH) | ➖ (konferencje) |
| RSVP + pojemność | ✅ | 🔴 pada | ✅ | ✅ | ➖ |
| Bramka członkostwa na wydarzenie | ✅ | 🔴 | ➖ | ✅ | ❌ |
| **Reguła Chatham House** (flaga) | ✅ | ✅ (pole) | ❌ | ✅ | ❌ |
| Transmisja + **archiwum nagrań za bramką** | ✅ | 🔴 (RPC gotowe, UI pada) | ➖ | ✅✅ (RUSI/CH) | ❌ |

**Podsumowanie:** *projekt* modułu wydarzeń jest **na poziomie RUSI/Chatham House** (członkowskie, Chatham House
Rule, gated recordings) i **przewyższa wszystkie polskie podmioty**. Ale dopóki `/events` nie renderuje, jest to
przewaga wyłącznie na papierze. **Naprawa tego modułu daje największy skok konkurencyjny przy najmniejszym
nakładzie** (wg audytu to „przepięcie na RPC", nie przebudowa).

### 4.4 Model monetyzacji i członkostwa

| Mechanizm | NES | Kto jeszcze |
| --- | --- | --- |
| Subskrypcja cykliczna | ✅ | Politico, Reuters, Nowa Konfederacja (częściowo) |
| Zakup jednorazowy / dożywotni | ✅ | rzadkie |
| Zakup pojedynczej publikacji (per-item paywall) | ✅ | rzadkie (przewaga) |
| Warstwy członkostwa z bramkami funkcji | ✅ | RUSI, Chatham House |
| Licencja korporacyjna per-fotel | ❌ | Politico PRO, Bloomberg |
| Darowizny / mecenat / Patronite | ➖ (możliwe do dodania) | Nowa Konfederacja, INE, Sobieski |
| Granty / budżet państwa | n/d (model komercyjny) | KJ, PISM, OSW, Batory, think-tank |

**NES ma najbardziej elastyczny zestaw mechanizmów spośród polskiej ligi** i porównywalny z zachodnimi
członkowskimi. Brakuje **sprzedaży korporacyjnej per-fotel** (klucz do modelu Politico PRO/Bloomberg) i
**gotowego kanału darowizn/mecenatu** (klucz do modelu polskiego). Oba są do dodania niskim kosztem na obecnym
silniku.

---

## 5. Werdykt pozycjonujący

### Gdzie NES realnie wygrywa
1. **Technologicznie deklasuje polską ligę think-tankową.** Żaden polski konkurent nie ma paywalla klasy
   produktowej, warstw członkostwa, personalizacji, społeczności ani SEO/GEO na tym poziomie. To najłatwiejsze
   do obronienia pole gry i naturalne pozycjonowanie: **„najbardziej zaawansowana cyfrowo platforma
   analityczno-wydawnicza o UE w Polsce/CEE".**
2. **Integracja.** Konkurenci sklejają journal (Taylor & Francis), członkostwo (osobny portal), newsletter i
   eventy z różnych narzędzi. NES ma to w jednym silniku ze wspólną tożsamością, paywallem i szyną zdarzeń.
3. **Dwujęzyczność (PL/EN) łącznie z treścią** — realny atut wobec anglojęzycznej ligi B i polskiej ligi C
   (tylko INE/PISM/OSW są dwujęzyczne).
4. **Elastyczna monetyzacja** (subskrypcja + dożywotni + per-item + warstwy) — szersza niż u kogokolwiek w lidze C.
5. **EU Policy Tracker jako format** — kategoria, której **nie ma żaden polski think-tank** i mało który europejski.

### Gdzie jest parytet
- **Wydarzenia członkowskie** (projekt = RUSI/Chatham House) — pod warunkiem naprawy.
- **Formaty publikacji** wobec ligi B (NES ma więcej natywnie, oni głębszą treść).
- **Newsletter/SEO** wobec ligi A/B.

### Gdzie NES przegrywa (i częściowo nie powinien walczyć)
1. **Głębia danych i narzędzia „policy intelligence" (Politico PRO, Bloomberg BGOV).** Ich fosa — strukturalne,
   stale zasilane dane + newsroom + AI-search + alerty + sprzedaż per-fotel — jest **poza zasięgiem** platformy
   tej wielkości i **nie jest właściwym celem**. EU Policy Tracker to „tracker w sensie think-tankowym", nie terminal.
2. **Narzędzia interaktywne / studia danych (think-tank iDeas Lab, ECFR Explorer, Bruegel datasets, Atlantic Council
   dashboards).** To jest **realna luka na polu, na którym liga B konkuruje** — i jednocześnie **najlepszy kierunek
   inwestycji**, bo NES ma już infrastrukturę wykresów i tracker jako punkt startu.
3. **Skala i autorytet redakcyjny.** Platforma to naczynie; fosa Politico/Reuters/RUSI/think-tank to **dziennikarstwo,
   badania, marka i sieć ekspertów**. Najlepsze oprogramowanie **nie zastąpi** wolumenu i wiarygodności treści.
   To najważniejsze zastrzeżenie całej oceny.
4. **Gotowość produkcyjna.** Trzy formaty (wydarzenia, ankiety, Q&A) zepsute end-to-end + zweryfikowane defekty
   bezpieczeństwa + brak wymuszonego MFA i eksportu danych RODO. Odbiorca „policy" to dokładnie ta grupa, która
   audytuje ochronę danych — te braki są reputacyjnie kosztowne w tym segmencie.

---

## 6. Rekomendacje strategiczne (priorytetyzowane)

**P0 — odblokować to, co już zbudowano (tygodnie, nie miesiące).**
1. **Naprawić moduł wydarzeń** (przepięcie UI na RPC `rsvp_event`/`get_event_access`, przycięcie `select` do
   przyznanych kolumn). To członkowski, przychodowy format klasy RUSI/Chatham House, dziś nierenderujący się.
2. **Naprawić ankiety i Q&A** (ten sam wzorzec „UI omija RPC/granty"). Formaty zaangażowania, których nie ma liga C.
3. **Domknąć cztery defekty krytyczne bezpieczeństwa** z audytu (XSS w builderze, SSRF w CRM, obejście paywalla
   przez TTS, wyciek cross-tenant moderacji) — warunek udostępniania pół-zaufanym autorom/najemcom.

**P1 — zbudować wyróżnik na polu, na którym konkuruje liga B.**
4. **Pogłębić EU Policy Tracker w stronę produktu danych:** alerty i dzienne/tygodniowe digesty per-dossier
   (mechanika newslettera już jest), więcej pól strukturalnych (instytucja prowadząca, sprawozdawca, powiązane
   akty), widok osi czasu i „co się zmieniło". To krok w kierunku Politico PRO Legislative Compass — w skali NES.
5. **Jeden interaktywny „explorer" na wzór ECFR/think-tank** (np. mapa koalicji/stanowisk państw UE albo dashboard
   wybranej polityki) — zbudowany na istniejącej infrastrukturze wykresów. To jest to, co **odróżnia** czołowe
   think-tanki od portali z PDF-ami.
6. **Kanał darowizn/mecenatu** (model Nowej Konfederacji) obok subskrypcji — tani dodatek na silniku Stripe,
   otwiera finansowanie „obywatelskie" niezależne od reklamy.

**P2 — domknięcia jakościowe.**
7. Wymuszenie MFA dla staffu, eksport danych RODO (Art. 15/20), naprawa dryfu szyny zdarzeń, multi-tenant
   warstwy prezentacji (`site_settings` PK), sprzedaż korporacyjna per-fotel (jeśli cel to klienci instytucjonalni).

---

## 7. Tabela zbiorcza — NES vs. benchmark

| Wymiar | NES | Politico/PRO | Reuters/Bloomberg | RUSI/think-tank/Chatham | ECFR/Bruegel/AtlanticC. | Polska liga C |
| --- | --- | --- | --- | --- | --- | --- |
| Silnik wydawniczy / paywall | **9** | 8 | 9 | 5 | 5 | 3 |
| Szerokość formatów publikacji | **8** | 8 | 7 | 6 | 6 | 4 |
| Tracker legislacyjny / dane strukturalne | 4 | **9** | **9** | 5 | 6 | 1 |
| Narzędzia interaktywne / wizualizacje | 4 | 8 | 8 | 7 | **8** | 2 |
| Wydarzenia (projekt / realny) | 8 / **2** | 7 | 6 | **9** | 7 | 4 |
| Członkostwo / monetyzacja | **8** | 8 (enterprise) | 8 | 7 | 5 (grant) | 4 |
| Społeczność / personalizacja | **8** | 5 | 4 | 5 | 4 | 2 |
| SEO / GEO / dystrybucja | **9** | 8 | 8 | 6 | 6 | 4 |
| Skala i autorytet redakcyjny | 3 | **9** | **9** | 8 | 7 | 5 |
| Dwujęzyczność PL/EN | **8** | 6 | 7 | 5 | 6 | 3 |

*(Skala 0–10, względem dojrzałej platformy komercyjnej. Wiersz „wydarzenia" NES: 8 projektowo / 2 w realnym
stanie kodu na 2026-07-13.)*

---

## 7a. Status wdrożenia rekomendacji (2026-07-13, ta sama gałąź)

| Rekomendacja | Status | Gdzie |
| --- | --- | --- |
| P0.1-P0.2 Naprawa wydarzeń / ankiet / Q&A (UI → RPC) | ✅ **było już wdrożone** przed tą oceną (rundy napraw po audycie) | `publicQueries.ts` (rpc `rsvp_event`/`vote_poll`/`ask_qa_question`), migracja `20260713200000_community_rpc_alignment` |
| P0.3 Cztery defekty krytyczne (XSS buildera, SSRF CRM, TTS-paywall, moderacja cross-tenant) | ✅ **było już wdrożone** | `hardenStyleCss` w `BuilderRenderer`, `egressGuard.server.ts`, `has_content_access` w `post-tts.ts`, migracja `20260713200000_chat_admin_tenant_scope_fix` |
| P1.4 Pogłębienie trackera (pola strukturalne) | ✅ wdrożone w tej rundzie | migracja `20260714110000` (rapporteur/committee/lead_dg), admin + strona dossier |
| P1.5 Explorer stanowisk państw UE | ✅ wdrożone w tej rundzie | `eu_policy_positions` + `PolicyPositionsMap` (mapa choropletowa na dossier), edytor 27 państw w adminie |
| P1.6 Kanał darowizn / mecenatu | ✅ wdrożone w tej rundzie | `/support`, `donations.functions.ts` (rate-limit per-IP), tabela `donations` + webhook Stripe, `/admin/donations` |
| P2 Eksport danych RODO (art. 15/20) | ✅ wdrożone w tej rundzie | `exportMyData` + karta na `/profile/security` |
| P2 Wymuszenie MFA (aal2) dla staffu | ✅ wdrożone w tej rundzie | `has_verified_mfa()` (migracja `20260714112000`) + guard w `require-staff.ts` |
| P2 Multi-tenant warstwy prezentacji | ✅ wdrożone w tej rundzie | PK `(tenant_id, key)` na `site_settings` (migracja `20260714113000`) + 16 upsertów na `onConflict: "tenant_id,key"` |
| P2 Sprzedaż korporacyjna per-fotel | ⏳ świadomie odłożone | wymaga decyzji produktowej (model licencji), nie kodu |
| P1.4b Digesty per-dossier | ⏳ częściowo | alerty obserwujących działają (trigger → notyfikacje → push/digest); dedykowany digest trackera do osobnej rundy |

Bramki rundy wdrożeniowej: testy **1615 przechodzą** (+34 nowe), lint **0 błędów**, `tsc` bez nowych błędów
(baseline środowiska bez zmian), drzewo tras zregenerowane. Nowe migracje wymagają `supabase db push` przy wdrożeniu.

## 8. Zastrzeżenia i źródła

- **Stan platformy** — z kodu i audytów `docs/OCENA_PLATFORMY.md`, `docs/AUDYT_PLATFORMY_2026-07-13.md`; oceny
  modułów i defekty odzwierciedlają HEAD gałęzi z 13.07.2026.
- **Profile konkurentów** — publiczne strony produktowe i rzetelne opracowania (lipiec 2026). Ceny konkurentów są
  **szacunkowe** (Politico PRO, Bloomberg, większość think-tanków nie publikują cenników); część stron (RUSI,
  think-tank, INE, Nowa Konfederacja) blokuje automatyczne pobieranie, więc szczegóły pochodzą z treści indeksowanej i
  źródeł wtórnych. Liczby użyte w profilach należy przed publikacją zewnętrzną zweryfikować u źródła.
- **Zakres porównania** — produkt cyfrowy i model wydawniczy, **nie** skala redakcji, wolumen ani autorytet marki
  (omówione jako osobny, nadrzędny czynnik konkurencyjny w §5).

Główne źródła: politicopro.com, about.bgov.com, pro.bloomberglaw.com, professional.bloomberg.com,
thomsonreuters.com; rusi.org, think-tank.org (+ chinapower/missilethreat/AMTI), chathamhouse.org, bruegel.org, ecfr.eu,
atlanticcouncil.org, brookings.edu, cepa.org; nowakonfederacja.pl, klubjagiellonski.pl, ine.org.pl, pism.pl,
osw.waw.pl, sobieski.org.pl, batory.org.pl, wei.org.pl.
