# Słownik wskaźników: definicje, interpretacja i przedziały benchmarkowe

**Data:** 2026-10-18 · **Zastosowanie:** tooltipy, okna szczegółów i oceny w module panelu „Przychód i lejek” oraz w warstwie semantycznej BI.

## Metodologia

Sześć grup wskaźników zbadano na podstawie źródeł zewnętrznych, przede wszystkim z lat 2025–2026: Reuters Institute, INMA, Piano, Zuora, ChartMogul, Recurly, Paddle, SaaS Capital, KeyBanc, Benchmarkit, Mailchimp, Klaviyo, GetResponse, MailerLite, Validity, wymagania nadawców Google/Yahoo, Baymard, Bizzabo, Cvent, HubSpot, Bain i inne.

Każde źródło sprawdził osobny weryfikator: otworzył URL i porównał liczby. Jego poprawki są już naniesione na przedziały (bez luk i nakładania). Status weryfikacji jest podany przy każdym źródle, a pełna lista zmian jest na końcu każdej grupy. Ten sam zestaw danych zasila rejestr wskaźników w kodzie.

**Skala ocen:** krytyczny → słaby → normalny → dobry → optymalny. Tam, gdzie źródło podaje kwartyle, przyjęto zasadę: poniżej P25 słaby, P25–P50 normalny, P50–P75 dobry, powyżej P75 optymalny. Metoda jest podana przy każdym kontekście. Przedziały oznaczone jako heurystyka nie mają twardego źródła i należy je kalibrować na własnych danych.

**Zakres:** 77 wskaźników; liczba źródeł: 189 (188 + 1 z uzupełnienia 2026-10-19, sekcja na końcu dokumentu).

## Spis grup

- Subskrypcje i przychód: 12 wskaźników
- Retencja i churn: 13 wskaźników
- Ekonomika jednostkowa: 8 wskaźników
- Lejek i konwersja: 12 wskaźników
- E-mail i newsletter: 18 wskaźników
- Zaangażowanie, wydarzenia, społeczność i CRM: 14 wskaźników

## 1. Subskrypcje i przychód

### MRR: Miesięczny przychód powtarzalny (Monthly Recurring Revenue)

- **Rozwinięcie:** Monthly Recurring Revenue – miesięczny przychód powtarzalny z aktywnych subskrypcji / Monthly Recurring Revenue
- **Wzór:** MRR = Σ (kwota fakturowana netto, bez VAT, po rabatach za aktywną płatną subskrypcję ÷ liczba miesięcy okresu rozliczeniowego); plan roczny 600 zł = 50 zł MRR; bez opłat jednorazowych (bilety, sponsoring, zlecenia raportów)
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Znormalizowany miesięczny przychód z aktywnych subskrypcji (osoby, firmy/instytucje, studenci/NGO) – baza dla wszystkich wskaźników przychodu. Czytaj go jako trend i w rozbiciu na ruchy: nowy, ekspansja, kontrakcja, churn, reaktywacja; sam poziom kwotowy nie ma uniwersalnego benchmarku. Pułapki: wliczanie biletów na wydarzenia lub całej kwoty planu rocznego w miesiącu zakupu, liczenie triali za 0 zł i pomijanie rabatów czasowych zawyżają MRR.
- **Interpretation (EN):** Normalised monthly revenue from active paid subscriptions (individual, corporate/institutional, student/NGO) – the base for every revenue metric. Read it as a trend and decomposed into new, expansion, contraction, churn and reactivation movements; the absolute level has no universal benchmark. Pitfalls: counting event tickets or the full annual-plan payment in the month of purchase, counting free trials and ignoring time-limited discounts all inflate MRR.

**Kontekst:** Realizacja planu MRR (MRR rzeczywisty ÷ MRR budżetowany, %) – wszystkie segmenty · okres: miesięcznie · metoda: heurystyka – brak zewnętrznych benchmarków poziomu MRR; definicja i normalizacja wg ChartMogul · źródła: S6

| Ocena     | Przedział | Uwagi                                                                                          |
| --------- | --------- | ---------------------------------------------------------------------------------------------- |
| krytyczny | < 85      | luka >15% – rewizja planu i lejka akwizycji                                                    |
| słaby     | 85–95     |                                                                                                |
| normalny  | 95–100    |                                                                                                |
| dobry     | 100–110   |                                                                                                |
| optymalny | ≥ 110     | sprawdź, czy nadwyżka nie wynika z wpływów jednorazowych lub złej normalizacji planów rocznych |

**Zastrzeżenia:**

- Poziom MRR oceniaj przez dynamikę (wzrost m/m, r/r) i Net New MRR – benchmarki zewnętrzne dotyczą tempa, nie kwoty.
- Przychody z wydarzeń, sponsoringu i zleceń raportów prezentuj osobno jako przychód niepowtarzalny.
- Raportuj MRR osobno dla B2C, B2B i planów ulgowych (studenci/NGO), aby efekt miksu nie maskował trendów.
- Przedziały realizacji planu to heurystyka – dostosuj je do historycznej trafności własnego budżetowania.

### ARR: Roczny przychód powtarzalny (run-rate) (Annual Recurring Revenue)

- **Rozwinięcie:** Annual Recurring Revenue – roczny przychód powtarzalny w ujęciu run-rate / Annual Recurring Revenue (run-rate)
- **Wzór:** ARR = MRR × 12 (stan na koniec okresu); przedziały dotyczą wzrostu ARR r/r = (ARR_t − ARR_t−12) ÷ ARR_t−12 × 100%
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Roczna wartość bieżącej bazy powtarzalnej – miara skali i podstawa porównań z benchmarkami wzrostu. Przedziały dotyczą tempa wzrostu ARR r/r, bo to ono różnicuje firmy podobnej wielkości; im mniejsza baza, tym wyższy wymagany wzrost (efekt mianownika). Pułapka: ARR to run-rate, nie przychód księgowy roku – nie dodawaj biletów ani jednorazowych projektów.
- **Interpretation (EN):** Annualised value of the current recurring base – a measure of scale and the basis for growth benchmarks. Bands apply to year-over-year ARR growth, because growth differentiates companies of similar size; the smaller the base, the higher the growth required (denominator effect). Pitfall: ARR is a run-rate, not booked annual revenue – never add tickets or one-off projects.

**Kontekst:** B2B SaaS prywatne, ARR < 1 mln USD – wzrost ARR r/r (%) · okres: rocznie · metoda: kwartyle źródła (SaaS Capital, dane za 2024): P25 20%, P50 40%, P75 100%; wzrost ≤ 0 = krytyczny · źródła: S1, S2

| Ocena     | Przedział | Uwagi                                                                   |
| --------- | --------- | ----------------------------------------------------------------------- |
| krytyczny | < 0       | 6,9% (2024) i 7,3% (2025) firm w badaniu miało wzrost płaski lub ujemny |
| słaby     | 0–20      |                                                                         |
| normalny  | 20–40     |                                                                         |
| dobry     | 40–100    |                                                                         |
| optymalny | ≥ 100     |                                                                         |

**Kontekst:** B2B SaaS prywatne, ARR 1–3 mln USD – wzrost ARR r/r (%) · okres: rocznie · metoda: kwartyle źródła (SaaS Capital, dane za 2024): P25 14%, P50 28%, P75 50% · źródła: S1

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–14      |       |
| normalny  | 14–28     |       |
| dobry     | 28–50     |       |
| optymalny | ≥ 50      |       |

**Kontekst:** Subskrypcje o niskim ARPA (< 25 USD/mies., typowo B2C) – wzrost ARR r/r (%) · okres: rocznie · metoda: kwartyle źródła (ChartMogul, LTM do 03.2023): dolny 2%, mediana 24%, górny 70%; dane LTM do 03.2023 – brak nowszych publicznych kwartyli wg ARPA (ChartMogul 2026, S100, to próba selekcjonowana firm rosnących ≥ 20% w 2024: mediana 65% → 28% w 2025 – nie zastępuje kwartyli) · źródła: S3, S100

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–2       |       |
| normalny  | 2–24      |       |
| dobry     | 24–70     |       |
| optymalny | ≥ 70      |       |

**Kontekst:** Wydawcy cyfrowi / media subskrypcyjne – wzrost przychodu lub bazy subskrypcji cyfrowych r/r (%) · okres: rocznie · metoda: heurystyka z punktów odniesienia: Mather (wydawcy prasowi USA, Q2 2025: cyfrowe subskrypcje ok. −6% r/r; nowszy raport Q1 2026 za formularzem – niezweryfikowany), Zuora (+25% subskrybentów w 2 lata; indeks wszystkich branż, nie mediów), NYT/WSJ +13% r/r; próg 20% = ok. 1,5 × NYT/WSJ (heurystyka). Agregat 100k Club (+21%) nie kotwiczy progu – porównuje listy o różnym składzie · źródła: S27, S104, S26, S14

| Ocena     | Przedział | Uwagi                                                                                                                                                                                     |
| --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | < -5      | poziom spadku cyfrowych subskrypcji (Mather: wydawcy prasowi USA, Q2 2025); nowszy raport Mather Q1 2026 (05.2026) jest za formularzem – zweryfikuj                                       |
| słaby     | -5–0      |                                                                                                                                                                                           |
| normalny  | 0–10      | ok. 11–12% r/r to średnie tempo przyrostu subskrybentów w indeksie Zuora – indeks obejmuje wszystkie branże, nie media                                                                    |
| dobry     | 10–20     | NYT i WSJ: +13% r/r                                                                                                                                                                       |
| optymalny | ≥ 20      | próg heurystyczny ok. 1,5 × NYT/WSJ (+13% r/r); 100k Club (+21%) to porównanie list o różnym składzie (59 → 62 wydawców) i częściowo nieaktualnych danych – nie jest to wzrost organiczny |

**Zastrzeżenia:**

- Ogólna mediana wzrostu prywatnych firm B2B SaaS spadła do 22% za 2025 r. (SaaS Capital 2026); kwartyle wg wielkości ARR pochodzą z edycji 2025 (dane za 2024), bo strona edycji 2026 nie publikuje percentyli wg ARR ani PDF – pozostają najnowszymi publicznymi.
- Benchmarki SaaS są w USD – porównując wzrost, przeliczaj ARR po stałym kursie, aby wahania PLN/USD nie fałszowały wyniku.
- Dla think tanku z przewagą B2C bardziej adekwatne są konteksty niskiego ARPA i mediów niż B2B SaaS.

### ARPA: Średni przychód na konto (klienta) (Average Revenue Per Account)

- **Rozwinięcie:** Average Revenue Per Account – średni miesięczny przychód powtarzalny na jedno konto klienta / Average Revenue Per Account
- **Wzór:** ARPA = MRR ÷ liczba aktywnych płatnych kont na koniec okresu (instytucja z wieloma licencjami = 1 konto); zmiana r/r = (ARPA_t − ARPA_t−12) ÷ ARPA_t−12 × 100%
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Średni miesięczny przychód na konto, kluczowy w B2B: rosnące ARPA oznacza skuteczny upsell, większe pakiety licencji lub lepszą realizację ceny. Czytaj w podziale na segmenty i razem z medianą – średnią łatwo zawyża kilka dużych instytucji. Pułapka: zmiana miksu (np. napływ tanich kont studenckich) obniża ARPA mimo zdrowego biznesu.
- **Interpretation (EN):** Average monthly revenue per account, key in B2B: rising ARPA signals successful upsell, larger seat packages or better price realisation. Read it by segment and alongside the median – a few large institutions easily inflate the mean. Pitfall: mix shifts (e.g. an influx of cheap student accounts) lower ARPA even when the business is healthy.

**Kontekst:** B2B – firmy i instytucje: zmiana ARPA r/r (%) · okres: rocznie · metoda: heurystyka; punkty odniesienia (ChartMogul): ARPA firm, które doszły do 20 mln USD ARR (outliers), +82% (564 → 1 024 USD); u firm, które utknęły między 1 a 20 mln USD (normies), +63%; 72% firm poprawiło ARPA o >10%. SaaS Capital (RB33): sam poziom ACV nie koreluje ze wzrostem – powyżej średniej rosną tylko firmy z ACV > 250 tys. USD (związek rosnącego ACV z szybszym wzrostem pochodzi z osobnej analizy SaaS Capital 'Changing ACVs', niepodpiętej tutaj) · źródła: S4, S1

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < -10     |       |
| słaby     | -10–0     |       |
| normalny  | 0–5       |       |
| dobry     | 5–15      |       |
| optymalny | ≥ 15      |       |

**Kontekst:** Mieszany portfel B2C + B2B: zmiana ARPA r/r przy stałym miksie segmentów (%) · okres: rocznie · metoda: heurystyka; punkty odniesienia: standardowe ceny cyfrowe w UK +3% r/r (2026), ARPU NYT +0,7%, Newsquest ok. −8,7% · źródła: S13, S14

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < -10     |       |
| słaby     | -10–-2    |       |
| normalny  | -2–3      |       |
| dobry     | 3–10      |       |
| optymalny | ≥ 10      |       |

**Zastrzeżenia:**

- Niskie ARPA ogranicza potencjał retencji przychodu: tylko 2,7% firm z ARPA < 10 USD/mies. ma NRR > 100%, wobec 41,1% przy ARPA > 500 USD/mies. (ChartMogul).
- ARPA liczy konta, ARPU – użytkowników; w B2B z wieloma licencjami ARPA jest wielokrotnie wyższe od ARPU.
- Brak wiarygodnych publicznych benchmarków poziomu ARPA dla członkostw instytucjonalnych think tanków – przedziały dotyczą wyłącznie dynamiki.

### ARPU: Średni przychód na płacącego użytkownika (Average Revenue Per User)

- **Rozwinięcie:** Average Revenue Per User – średni miesięczny przychód na płacącego użytkownika / Average Revenue Per User
- **Wzór:** ARPU = przychód powtarzalny z subskrypcji w okresie ÷ średnia liczba płacących użytkowników w okresie (na miesiąc); wariant medialny ARPU/MAU = przychód ÷ wszyscy aktywni użytkownicy – zawsze oznacz mianownik
- **Jednostka:** PLN/mies. · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Średni miesięczny przychód na płacącego użytkownika – mierzy skuteczność cennika i promocji w B2C. Spadek ARPU przy rosnącej bazie zwykle oznacza napływ subskrybentów z głębokimi ofertami wejściowymi, wzrost – wygasanie promocji lub podwyżki. Pułapka: mieszanie mianowników (płacący vs wszyscy zarejestrowani) i porównywanie z rynkami o innej sile nabywczej bez korekty.
- **Interpretation (EN):** Average monthly revenue per paying user – measures pricing and promotion effectiveness in B2C. Falling ARPU with a growing base usually means an influx of deeply discounted introductory subscribers; rising ARPU means promotions rolling off or price increases. Pitfall: mixing denominators (paying vs all registered users) and comparing with markets of different purchasing power without adjustment.

**Kontekst:** Media cyfrowe B2C, rynki rozwinięte – ARPU na płacącego subskrybenta (USD/mies.) · okres: miesięcznie · metoda: heurystyka z punktów odniesienia: Piano 2026 (6,57–9,69 USD wg okresu planu), NYT 9,72 USD, USA Today Co 10,22 USD, Newsquest 5,67 USD, Mather (12,64 USD plany miesięczne) · źródła: S15, S14, S16

| Ocena     | Przedział | Uwagi                                                 |
| --------- | --------- | ----------------------------------------------------- |
| krytyczny | < 4       |                                                       |
| słaby     | 4–6       | Newsquest 5,67 USD                                    |
| normalny  | 6–8       | Piano 2026: 6,57 USD (miesięczne) i 6,62 USD (roczne) |
| dobry     | 8–11      | NYT 9,72 USD; USA Today Co 10,22 USD                  |
| optymalny | ≥ 11      | Mather: ARPU planów miesięcznych 12,64 USD            |

**Kontekst:** Media cyfrowe B2C, Polska – ARPU na płacącego subskrybenta (PLN/mies.) · okres: miesięcznie · metoda: heurystyka; jedyny polski punkt odniesienia: 18,1 mln zł przychodów cyfrowych dziennika w Q3 2025 ÷ 317,6 tys. prenumerat ÷ 3 ≈ 19 zł/mies.; Agora w tym komunikacie nie definiuje przychodów cyfrowych; 78% subskrybentów w PL poniżej pełnej ceny (DNR 2024); kontekst rynkowy: DNR 2026 · źródła: S25, S12, S105

| Ocena     | Przedział | Uwagi                                                                                                    |
| --------- | --------- | -------------------------------------------------------------------------------------------------------- |
| krytyczny | < 8       |                                                                                                          |
| słaby     | 8–12      |                                                                                                          |
| normalny  | 12–18     |                                                                                                          |
| dobry     | 18–25     | obejmuje szacunek ok. 19 zł/mies. dla Gazety Wyborczej (definicja przychodów cyfrowych niezweryfikowana) |
| optymalny | ≥ 25      | realne dla niszowych treści eksperckich z mocną propozycją wartości                                      |

**Kontekst:** Zmiana ARPU r/r – B2C (%) · okres: rocznie · metoda: heurystyka z punktów odniesienia: NYT +0,7%, ceny standardowe UK +3%, Newsquest ok. −8,7%, USA Today Co +27% (Q4) · źródła: S14, S13

| Ocena     | Przedział | Uwagi                                              |
| --------- | --------- | -------------------------------------------------- |
| krytyczny | < -10     |                                                    |
| słaby     | -10–0     | Newsquest ok. −8,7%                                |
| normalny  | 0–5       | NYT +0,7%; ceny standardowe UK +3%                 |
| dobry     | 5–15      |                                                    |
| optymalny | ≥ 15      | USA Today Co +27% w Q4 – efekt wygaszania promocji |

**Zastrzeżenia:**

- Przedziały poziomu ARPU to heurystyka z pojedynczych punktów odniesienia – kwartyle INMA są dostępne tylko w płatnym serwisie benchmarkowym.
- Szacunek polski jest niepewny: licznik może obejmować reklamę cyfrową (definicja niezweryfikowana), a mianownik to stan na koniec kwartału.
- W Polsce 78% subskrybentów nie płaci pełnej ceny (DNR 2024), więc ARPU jest naturalnie niższe od cen katalogowych.
- Rynek płacących jest w Polsce wąski: za wiadomości online płaci 11% (−2 pp r/r; DNR 2026).

### MoM MRR: Wzrost MRR miesiąc do miesiąca (Month-over-Month MRR Growth)

- **Rozwinięcie:** Month-over-Month MRR growth – miesięczna dynamika przychodu powtarzalnego / Month-over-Month Monthly Recurring Revenue growth
- **Wzór:** Wzrost m/m = (MRR_koniec − MRR_początek) ÷ MRR_początek × 100%; trend: CMGR = (MRR_t ÷ MRR_t−n)^(1/n) − 1; ekwiwalent miesięczny wzrostu rocznego g = (1+g)^(1/12) − 1
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Tempo zmiany bazy przychodu powtarzalnego miesiąc do miesiąca. Pojedynczy miesiąc jest zaszumiony (sezonowość, odnowienia roczne, kampanie), dlatego oceniaj średnią z 3 miesięcy (CMGR). Pułapka: porównywanie z wartościami rocznymi bez procentu składanego – 2% m/m to ok. 27% r/r, nie 24%.
- **Interpretation (EN):** Month-over-month rate of change of the recurring revenue base. A single month is noisy (seasonality, annual renewals, campaigns), so judge the 3-month compounded average (CMGR). Pitfall: comparing with annual figures without compounding – 2% MoM is about 27% YoY, not 24%.

**Kontekst:** B2B SaaS prywatne, ARR < 1 mln USD (% m/m) · okres: miesięcznie (średnia 3-miesięczna) · metoda: kwartyle SaaS Capital r/r (P25 20%, P50 40%, P75 100%) przeliczone na ekwiwalent miesięczny: 1,53% / 2,84% / 5,95% · źródła: S1

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–1,5     |       |
| normalny  | 1,5–2,8   |       |
| dobry     | 2,8–6     |       |
| optymalny | ≥ 6       |       |

**Kontekst:** B2B SaaS prywatne, ARR 1–3 mln USD (% m/m) · okres: miesięcznie (średnia 3-miesięczna) · metoda: kwartyle SaaS Capital r/r (14% / 28% / 50%) przeliczone: 1,10% / 2,08% / 3,44% m/m · źródła: S1

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–1,1     |       |
| normalny  | 1,1–2,1   |       |
| dobry     | 2,1–3,4   |       |
| optymalny | ≥ 3,4     |       |

**Kontekst:** Subskrypcje B2C, ARPA < 25 USD/mies. (% m/m) · okres: miesięcznie (średnia 3-miesięczna) · metoda: kwartyle ChartMogul r/r (2% / 24% / 70%) przeliczone: 0,17% / 1,81% / 4,52% m/m; kwartyle pochodzą z 2023 r. (LTM do 03.2023) – brak nowszych publicznych kwartyli wg ARPA (S100 to próba selekcjonowana) · źródła: S3, S100

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–0,17    |       |
| normalny  | 0,17–1,8  |       |
| dobry     | 1,8–4,5   |       |
| optymalny | ≥ 4,5     |       |

**Kontekst:** Wydawcy cyfrowi / media subskrypcyjne (% m/m) · okres: miesięcznie (średnia 3-miesięczna) · metoda: heurystyka: −5% / 10% / 20% r/r przeliczone na miesiąc (Mather: wydawcy prasowi USA, Q2 2025, cyfrowe −6% r/r; NYT/WSJ +13%; próg 20% ≈ 1,5 × NYT/WSJ – 100k Club +21% to porównanie list o różnym składzie, nie kotwica); nowszy raport Mather Q1 2026 za formularzem – zweryfikuj · źródła: S27, S104, S14

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < -0,4    |       |
| słaby     | -0,4–0    |       |
| normalny  | 0–0,8     |       |
| dobry     | 0,8–1,5   |       |
| optymalny | ≥ 1,5     |       |

**Zastrzeżenia:**

- Sezonowość: Q1 jest najsilniejszy dla akwizycji, Q4 najsłabszy (ChartMogul Billing Report 2025) – porównuj także r/r.
- Wzrost m/m naturalnie spada ze skalą: u firm, które doszły do 20 mln USD ARR (outliers ChartMogul), z 16,7% przy 1 mln USD do 5,1% przy 20 mln USD; normies przy 1 mln USD: 8,7% m/m (ChartMogul Growth Levers).
- Przy małej bazie pojedyncza umowa instytucjonalna zmienia wynik o kilka punktów procentowych.

### NNMRR: Przyrost netto MRR (Net New MRR)

- **Rozwinięcie:** Net New MRR – przyrost netto miesięcznego przychodu powtarzalnego po uwzględnieniu utraty / Net New Monthly Recurring Revenue
- **Wzór:** Net New MRR = New MRR + Expansion MRR + Reactivation MRR − Contraction MRR − Churned MRR; względnie: Net New MRR ÷ MRR z początku miesiąca × 100%; efektywność: Net New MRR ÷ (New + Expansion + Reactivation MRR) × 100% = 1 − 1/QR (równość zachodzi, gdy QR zawiera reaktywacje; progi QR ChartMogul liczono bez nich)
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Bilans przyrostu bazy w złotych: ile MRR faktycznie przybyło po odjęciu utraty. Wartość diagnostyczna leży w rozbiciu – ten sam wynik może wynikać z mocnej akwizycji i dużego churnu albo ze słabej akwizycji i świetnej retencji. Pułapka: raportowanie samej sumy bez składowych oraz liczenie zmian planów o tej samej cenie (MRR neutralny) jako ekspansji.
- **Interpretation (EN):** Net balance of the recurring base in currency: how much MRR was actually added after subtracting losses. Its diagnostic value lies in the decomposition – the same total can come from strong acquisition with heavy churn or weak acquisition with excellent retention. Pitfall: reporting only the total without components, or counting same-price plan switches (neutral MRR) as expansion.

**Kontekst:** Wczesny etap subskrypcji, ARR < 300 tys. USD – Net New MRR jako % MRR z początku miesiąca · okres: miesięcznie (średnia 3-miesięczna) · metoda: kwartyle ChartMogul r/r (LTM do 03.2023: −5% / 37% / 153%) przeliczone na miesiąc: −0,43% / 2,66% / 8,04%; granica słaby/normalny (1%) heurystyczna · źródła: S3

| Ocena     | Przedział | Uwagi                                      |
| --------- | --------- | ------------------------------------------ |
| krytyczny | < -0,43   | poniżej dolnego kwartyla – baza się kurczy |
| słaby     | -0,43–1   |                                            |
| normalny  | 1–2,66    |                                            |
| dobry     | 2,66–8    |                                            |
| optymalny | ≥ 8       |                                            |

**Kontekst:** Efektywność wzrostu – Net New MRR ÷ brutto pozyskany MRR (%) – wszystkie segmenty · okres: kwartalnie · metoda: przeliczenie progów SaaS Quick Ratio wg ChartMogul (<2 niski, 2–4 przeciętny, ≥4 wysoki) wzorem 1 − 1/QR; progi QR ChartMogul liczono BEZ Reactivation MRR, więc efektywność z reaktywacją w mianowniku nie jest w pełni porównywalna – do porównań z progami licz wariant bez reaktywacji; skala reaktywacji: S101–S103 (zob. zastrzeżenia) · źródła: S8, S101, S102, S103

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | < 0       | utrata większa niż pozyskanie (QR < 1) |
| słaby     | 0–30      | QR ok. 1–1,4                           |
| normalny  | 30–50     | QR 1,4–2                               |
| dobry     | 50–75     | QR 2–4                                 |
| optymalny | ≥ 75      | QR > 4                                 |

**Zastrzeżenia:**

- Reaktywacje raportuj osobno. U firm, które doszły do 20 mln USD ARR (outliers ChartMogul), stanowiły 1,7% net-new MRR przy 1 mln USD i 3,8% przy 20 mln USD ARR. Nowsze dane: ChartMogul Winbacks Report (21.04.2026) – mediana winback 7% przy ARR < 500 tys. USD, 9% przy 0,5–10 mln USD; 45% powrotów w 30 dni, 66% w 90 dni. ChartMogul '30-day upsell window' (30.09.2026) – 2,67% reaktywacji w 1. miesiącu po rezygnacji, > 5% w 3 miesiące. Recurly 2026 – w B2C ok. 1 na 4 nowe zapisy to powracający subskrybenci. Wysoki udział reaktywacji w B2C jest więc normalny i nie musi być sygnałem alarmowym.
- Przy planach rocznych churn ujawnia się skokowo w miesiącach odnowień – oceniaj sumy 3- lub 12-miesięczne.
- Klasyfikację ruchów (new/expansion/contraction/churn/reactivation/neutral) stosuj zgodnie z definicją ChartMogul, inaczej porównania z benchmarkami są niemiarodajne.

### QR: Wskaźnik szybkości wzrostu SaaS (Quick Ratio) (SaaS Quick Ratio)

- **Rozwinięcie:** SaaS Quick Ratio – stosunek pozyskanego MRR do utraconego MRR (nie mylić z księgowym wskaźnikiem płynności szybkiej) / SaaS Quick Ratio (growth efficiency, not the accounting acid-test ratio)
- **Wzór:** QR = (New MRR + Expansion MRR [+ Reactivation MRR]) ÷ (Churned MRR + Contraction MRR); progi ChartMogul (< 2, 2–4, ≥ 4) liczono BEZ Reactivation MRR – jeśli panel dodaje reaktywacje do licznika, do porównań z progami pokazuj wariant zgodny z definicją ChartMogul (bez reaktywacji); przy zerowej utracie wynik nieokreślony – pokazuj 'n/d'
- **Jednostka:** ratio · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Ile złotych nowego MRR przypada na każdy utracony złoty – mierzy jakość wzrostu, nie jego skalę. Wartość 4 to klasyczny próg zdrowego wzrostu młodej firmy B2B, ale wysoki wzrost potrafi maskować churn: przy QR = 4 i wzroście 15% m/m churn może sięgać 5% miesięcznie. Pułapka: QR z jednego miesiąca przy rocznych odnowieniach skacze – używaj okna kwartalnego lub rocznego.
- **Interpretation (EN):** How many units of new MRR are gained per unit lost – measures growth quality, not scale. A value of 4 is the classic threshold for healthy growth in a young B2B company, but fast growth can mask churn: with QR = 4 and 15% monthly growth, churn can still be 5% per month. Pitfall: a single-month QR jumps around with annual renewals – use a quarterly or annual window.

**Kontekst:** B2B SaaS / subskrypcje firm i instytucji (okno kwartalne) · okres: kwartalnie · metoda: progi ChartMogul (<2 niski, 2–4 przeciętny, ≥4 wysoki; definicja bez Reactivation MRR) i próg 4 jako poziom inwestycyjny (parafraza stanowiska M. Hamida we wpisie ChartMogul); kontrola: przy wzroście ok. 20% r/r i GRR ok. 90% (KeyBanc/Sapphire 2025) QR ≈ 1 + 0,20/0,10 = 3 – 20% to prognoza KeyBanc/Sapphire na 2025, nie wynik; przy wyniku za 2024 (15%) QR ≈ 2,5 · źródła: S8, S9, S28

| Ocena     | Przedział | Uwagi           |
| --------- | --------- | --------------- |
| krytyczny | < 1       | baza się kurczy |
| słaby     | 1–2       |                 |
| normalny  | 2–4       |                 |
| dobry     | 4–6       |                 |
| optymalny | ≥ 6       |                 |

**Kontekst:** B2C subskrypcje / media cyfrowe (okno roczne) · okres: rocznie · metoda: heurystyka wyprowadzona ze wzoru QR = 1 + wzrost ÷ utrata: przy rocznej utracie 35–45% przychodu (dane Piano: 12-miesięczna przeżywalność 34% planów miesięcznych i 70% rocznych) i wzroście 10–20% r/r QR ≈ 1,2–1,6 · źródła: S17, S15, S14

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 1       |       |
| słaby     | 1–1,2     |       |
| normalny  | 1,2–1,5   |       |
| dobry     | 1,5–2     |       |
| optymalny | ≥ 2       |       |

**Zastrzeżenia:**

- Brak publicznych kwartyli QR z badań pierwotnych; krążące w sieci 'mediany' (np. 2,5) pochodzą z nieweryfikowalnych agregatorów.
- W pierwszym roku działania wskaźnik jest mało informatywny (ChartMogul).
- Zawsze pokazuj obok QR churn brutto – ten sam QR może oznaczać 1% albo 6% churnu miesięcznie (Tunguz).

### EXP %: Udział ekspansji w nowym MRR (Expansion Share of New MRR)

- **Rozwinięcie:** Expansion share – udział przychodu z rozszerzeń u obecnych klientów w całym pozyskanym MRR / Expansion MRR share of total new MRR
- **Wzór:** Udział ekspansji = Expansion MRR ÷ (New MRR + Expansion MRR [+ Reactivation MRR]) × 100% w okresie (Benchmarkit: Expansion ARR ÷ Total New ARR)
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Jaka część nowego przychodu pochodzi od istniejących klientów (wyższy plan, więcej licencji instytucjonalnych, dodatki, przejście z planu indywidualnego na firmowy). Rośnie naturalnie ze skalą i szerokością oferty; zbyt niski oznacza brak ścieżki rozwoju klienta, zbyt wysoki – słabnącą akwizycję nowych. Pułapka: liczenie zmiany z planu miesięcznego na roczny o tej samej wartości miesięcznej jako ekspansji.
- **Interpretation (EN):** Share of new revenue coming from existing customers (higher tier, more institutional seats, add-ons, moving from individual to corporate plans). It rises naturally with scale and product breadth; too low means no customer growth path, too high means weakening new-customer acquisition. Pitfall: counting a monthly-to-annual switch at the same monthly value as expansion.

**Kontekst:** B2B SaaS ogółem (%) · okres: rocznie · metoda: mediana Benchmarkit 2025 (40%, N=81; 25% w 2022) + heurystyka zakresu docelowego · źródła: S10, S11

| Ocena     | Przedział | Uwagi                                                                                                                                                    |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–10      |                                                                                                                                                          |
| słaby     | 10–25     | poniżej mediany z 2022 r. (25%)                                                                                                                          |
| normalny  | 25–40     |                                                                                                                                                          |
| dobry     | 40–55     | mediana 2024: 40%                                                                                                                                        |
| optymalny | 55–70     | poziom firm 50–100 mln USD ARR (58%) i >100 mln USD (67% – kohorta tylko 6 firm, statystycznie słaba; Benchmarkit); mediana ogółem 40% pochodzi z N = 81 |
| normalny  | 70–100    | ryzyko zależności od bazy – sprawdź akwizycję nowych klientów                                                                                            |

**Kontekst:** Mała firma subskrypcyjna, ok. 1 mln USD ARR (%) · okres: kroczące 12 miesięcy · metoda: heurystyka wokół punktów ChartMogul dla firm, które później doszły do 20 mln USD ARR (outliers): 15,4% przy 1 mln USD ARR i 34,7% przy 20 mln USD ARR; okres kroczący 12 mies., bo ok. 40% upgrade'ów planu w 1. roku następuje przy odnowieniu w 12. miesiącu (ChartMogul/Growth Unhinged 2026) – okno kwartalne byłoby skokowe · źródła: S4, S3, S102

| Ocena     | Przedział | Uwagi                                                                              |
| --------- | --------- | ---------------------------------------------------------------------------------- |
| krytyczny | 0–5       |                                                                                    |
| słaby     | 5–10      |                                                                                    |
| normalny  | 10–15     |                                                                                    |
| dobry     | 15–25     | outliers (firmy, które później doszły do 20 mln USD ARR) przy 1 mln USD ARR: 15,4% |
| optymalny | 25–40     | outliers przy 20 mln USD ARR: 34,7%                                                |
| normalny  | 40–100    | na tym etapie zwykle sygnał słabej akwizycji                                       |

**Kontekst:** Media / B2C (upgrade planu, dodatki, przejście na plan instytucjonalny) (%) · okres: kroczące 12 miesięcy · metoda: heurystyka – brak publicznych benchmarków dla wydawców; uzasadnienie: w B2C o niskim ARPA ekspansja jest strukturalnie mała; okres kroczący 12 mies., bo upgrade'y kumulują się przy odnowieniu rocznym (ChartMogul/Growth Unhinged 2026: ok. 40% upgrade'ów w 1. roku w 12. miesiącu) · źródła: S7, S102

| Ocena     | Przedział | Uwagi                                                   |
| --------- | --------- | ------------------------------------------------------- |
| krytyczny | 0–2       | brak ścieżki ekspansji w ofercie                        |
| słaby     | 2–5       |                                                         |
| normalny  | 5–10      |                                                         |
| dobry     | 10–20     |                                                         |
| optymalny | 20–40     |                                                         |
| normalny  | 40–100    | sprawdź, czy akwizycja nowych subskrybentów nie zamiera |

**Zastrzeżenia:**

- Starsze dane ChartMogul (2023): ekspansja stanowiła 32,3% pozyskanego ARR w firmach 1–30 mln USD ARR (28,8% w 2020).
- Tylko 2,7% firm z ARPA < 10 USD/mies. ma NRR > 100% (ChartMogul) – w B2C nie oczekuj poziomów B2B.
- Pełne dane KeyBanc/Sapphire 2025 o podziale nowy/ekspansja są dostępne po rejestracji – nieuwzględnione liczbowo.

### PR: Realizacja ceny (Price Realization)

- **Rozwinięcie:** Price Realization – odsetek ceny katalogowej faktycznie zrealizowany w przychodzie / Price Realization
- **Wzór:** PR = Σ przychód zafakturowany netto (po rabatach, kuponach, promocjach) ÷ Σ przychód według cennika katalogowego dla tych samych planów i okresów × 100%; wariant: realizacja podwyżki = faktyczny wzrost średniej ceny ÷ planowany wzrost × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Jaki procent ceny katalogowej faktycznie trafia do firmy – syntetyczna miara wycieku przez rabaty, oferty wejściowe i negocjacje. Spadek przy rosnącej sprzedaży oznacza kupowanie wolumenu ceną; rozbijaj na segmenty i kohorty (oferta wejściowa vs odnowienie po pełnej cenie). Pułapka: porównywanie z cennikiem sztucznie zawyżonym lub pomijanie rabatu za płatność roczną.
- **Interpretation (EN):** Share of the list price that actually reaches the company – a summary measure of leakage through discounts, introductory offers and negotiation. A decline while sales grow means buying volume with price; break it down by segment and cohort (introductory offer vs full-price renewal). Pitfall: benchmarking against an artificially inflated list price or ignoring the annual-prepay discount.

**Kontekst:** Media cyfrowe B2C (PL/UE) – cała aktywna baza (%) · okres: miesięcznie · metoda: heurystyka: miks 50/25/25 (50% pełna cena, 25% oferty wejściowe, 25% roczne) cytowany przez Mather za N. Hunshikattim (Mather zastrzega: no one-size-fits-all) daje ok. 72–75% przy rabatach ofert wejściowych rzędu 70–80%, typowych dla UK (S13); przy rabatach wejściowych ok. 50% ten sam miks daje ok. 79–82%; DNR 2024: 78% subskrybentów w Polsce i 41% w 20 krajach poniżej pełnej ceny (deklaracje ankietowe); rabaty 1. roku w UK 17–89% · źródła: S16, S12, S13

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | < 50      |                                        |
| słaby     | 50–65     | np. FT w 1. roku: 279 vs 468 GBP ≈ 60% |
| normalny  | 65–75     |                                        |
| dobry     | 75–85     |                                        |
| optymalny | ≥ 85      |                                        |

**Kontekst:** B2B – umowy z firmami i instytucjami (%) · okres: kwartalnie · metoda: heurystyka z punktów odniesienia: średni rabat ok. 10% (Vendr wg SaaStr, dane z 2023 r., definicja rabatu niepodana; typowo 10–15%) i 33,8% od cennika w korporacyjnych zakupach oprogramowania (Vertice, Q2 2026) · źródła: S19, S20

| Ocena     | Przedział | Uwagi                                                 |
| --------- | --------- | ----------------------------------------------------- |
| krytyczny | < 65      | gorzej niż średnia korporacyjnych zakupów IT (−33,8%) |
| słaby     | 65–80     |                                                       |
| normalny  | 80–88     |                                                       |
| dobry     | 88–95     | odpowiada typowemu rabatowi 10–15%                    |
| optymalny | ≥ 95      |                                                       |

**Kontekst:** Realizacja planowanej podwyżki cen – dowolny segment (%) · okres: na kampanię cenową · metoda: średnia źródła (Simon-Kucher 2025: 43%, spadek o 5 pp w 2 lata) ± heurystyka · źródła: S18

| Ocena     | Przedział | Uwagi                |
| --------- | --------- | -------------------- |
| krytyczny | < 20      |                      |
| słaby     | 20–35     |                      |
| normalny  | 35–50     | średnia globalna 43% |
| dobry     | 50–70     |                      |
| optymalny | ≥ 70      |                      |

**Zastrzeżenia:**

- DNR mierzy odsetek subskrybentów poniżej pełnej ceny, a nie poziom realizacji – przedziały B2C to heurystyka.
- Podwyżki niosą ryzyko churnu: 47% rezygnujących z subskrypcji wskazało podwyżkę ceny jako powód (Zuora/Harris Poll, USA, 2024).
- Realizacja zaplanowanej podwyżki (Simon-Kucher) to inna definicja niż realizacja ceny katalogowej – nie mieszaj wariantów na jednym wykresie.

### ADD: Średni rabat (głębokość rabatu) (Average Discount Depth)

- **Rozwinięcie:** Average Discount Depth – średnia głębokość rabatu w transakcjach objętych rabatem lub kuponem / Average Discount Depth
- **Wzór:** ADD = Σ (cena katalogowa − cena zapłacona) ÷ Σ cena katalogowa, dla transakcji z rabatem lub kuponem w okresie × 100%; osobno: penetracja rabatów = transakcje z rabatem ÷ wszystkie transakcje × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Jak głęboko obniżamy cenę, gdy już dajemy rabat. Głębokie rabaty wejściowe przyspieszają akwizycję, ale przyciągają klientów o niższej wartości: na danych gazety i internetowego sklepu spożywczego (Lewis 2006) rabat akwizycyjny 35% dawał klientów o ok. połowę niższej wartości długoterminowej. Pułapka: uśrednianie strukturalnego rabatu za płatność roczną z promocjami i ignorowanie penetracji – 10% dla wszystkich kosztuje więcej niż 50% dla nielicznych.
- **Interpretation (EN):** How deep the price cut is when a discount is granted. Deep introductory discounts speed up acquisition but attract lower-value customers: in newspaper and online grocery data (Lewis 2006) a 35% acquisition discount produced customers worth about half as much over the long term. Pitfall: averaging the structural annual-prepay discount with promotions and ignoring penetration – 10% for everyone costs more than 50% for a few.

**Kontekst:** Oferty wejściowe B2C – media i subskrypcje indywidualne (%) · okres: na kampanię / miesięcznie · metoda: heurystyka: Lewis 2006 (rabat 35% ≈ połowa wartości klienta) oraz rabaty 1. roku wydawców UK 17–89% (dziesięć tytułów ≥ 70%, 2026); mediany kuponowe Recurly (2017) odpięte – źródło niesprawdzalne · źródła: S21, S13

| Ocena     | Przedział | Uwagi                                                                                    |
| --------- | --------- | ---------------------------------------------------------------------------------------- |
| krytyczny | ≥ 50      | duzi wydawcy UK dają 70–89%, ale przy masowej skali i silnej marce                       |
| słaby     | 35–50     | ≥35%: ok. połowa wartości długoterminowej klienta                                        |
| normalny  | 25–35     | heurystyka między rabatami 17–89% wydawców UK (S13) a progiem 35% z badania Lewisa (S21) |
| dobry     | 15–25     |                                                                                          |
| optymalny | 0–15      |                                                                                          |

**Kontekst:** B2B – rabaty negocjowane dla firm i instytucji (%) · okres: kwartalnie · metoda: heurystyka z punktów odniesienia: ok. 10% (Vendr wg SaaStr, dane z 2023 r., definicja rabatu niepodana; typowo 10–15%) i 33,8% od cennika w korporacyjnych zakupach IT (Vertice, Q2 2026) · źródła: S19, S20

| Ocena     | Przedział | Uwagi                                         |
| --------- | --------- | --------------------------------------------- |
| krytyczny | ≥ 30      | poziom korporacyjnych działów zakupów (33,8%) |
| słaby     | 20–30     |                                               |
| normalny  | 12–20     |                                               |
| dobry     | 5–12      | typowo 10–15% (SaaStr/Vendr, dane z 2023 r.)  |
| optymalny | 0–5       |                                               |

**Kontekst:** Rabat za płatność roczną – strukturalny (%) · okres: przy zmianie cennika · metoda: heurystyka z przykładów: 'Save 20%' (ChartMogul) i pogłębiony rabat roczny 33% (FT Strategies) · źródła: S5, S17, S15

| Ocena     | Przedział | Uwagi                                                                                                                                                                                                                                                                                            |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | ≥ 40      |                                                                                                                                                                                                                                                                                                  |
| słaby     | 33–40     |                                                                                                                                                                                                                                                                                                  |
| normalny  | 25–33     | przykład pogłębionego rabatu rocznego 33% (FT Strategies)                                                                                                                                                                                                                                        |
| dobry     | 17–25     | typowe 'Save 20%'                                                                                                                                                                                                                                                                                |
| optymalny | 0–17      | ≈ 2 miesiące gratis; jeśli udział planów rocznych spada, rozważ wyższy rabat. TechCrunch po obniżce ceny planu rocznego (150 → 99 USD – obniżka ceny planu, nie rabat względem 12 × ceny miesięcznej) podwoił konwersję na plan roczny i zwiększył przychód z planów rocznych o 28% (Piano 2026) |

**Zastrzeżenia:**

- Mediany rabatów kuponowych Recurly (badanie z 2017 r.) są niesprawdzalne – URL nie zawiera badania – i nie kotwiczą przedziałów; nowszy raport Recurly 2026 nie publikuje danych o rabatach kuponowych.
- SaaStr nie podaje definicji rabatu Vendr (dane z 2023 r.); Vertice mierzy rabat od cennika (Q2 2026).
- Ceny dla studentów/NGO raportuj jako osobne plany cenowe, nie jako rabat promocyjny.

### CpRR: Wskaźnik realizacji kuponów (Coupon Redemption Rate)

- **Rozwinięcie:** Coupon Redemption Rate – odsetek wydanych kodów rabatowych wykorzystanych przy zakupie / Coupon Redemption Rate
- **Wzór:** CpRR = liczba wykorzystanych kodów ÷ liczba wydanych (doręczonych) kodów × 100%, w kohorcie kampanii i stałym oknie (np. 30 dni); uzupełniająco: udział zamówień z kuponem
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Jaka część rozesłanych kodów rabatowych zamienia się w zakup – miara trafności oferty i kanału. Kody spersonalizowane (win-back, oferta B2B, uczestnicy wydarzeń) powinny realizować się kilkukrotnie lepiej niż kody masowe. Pułapka: wysoka realizacja kodu publicznego może oznaczać wyciek do serwisów kuponowych i kanibalizację sprzedaży po pełnej cenie.
- **Interpretation (EN):** Share of distributed discount codes that turn into a purchase – a measure of offer and channel fit. Personalised codes (win-back, B2B offers, event attendees) should redeem several times better than mass codes. Pitfall: high redemption of a public code may signal leakage to coupon sites and cannibalisation of full-price sales.

**Kontekst:** Kupony w e-mailu masowym / newsletterze (%) · okres: na kampanię · metoda: typowy zakres źródła 1–5% (Yotpo) podzielony heurystycznie · źródła: S23

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,5     |       |
| słaby     | 0,5–1     |       |
| normalny  | 1–3       |       |
| dobry     | 3–5       |       |
| optymalny | ≥ 5       |       |

**Kontekst:** Kupony on-site (pop-up, paywall, exit intent) (%) · okres: na kampanię · metoda: zakres źródła 2–10% (Yotpo) podzielony heurystycznie · źródła: S23

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 1       |       |
| słaby     | 1–2       |       |
| normalny  | 2–5       |       |
| dobry     | 5–10      |       |
| optymalny | ≥ 10      |       |

**Kontekst:** Kody spersonalizowane 1:1 (win-back, oferty B2B, polecenia, program lojalnościowy) (%) · okres: na kampanię · metoda: zakresy źródła: polecenia 5–20%, SMS 5–15%, programy lojalnościowe 10–30%+ (Yotpo) + heurystyka · źródła: S23

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 3       |       |
| słaby     | 3–5       |       |
| normalny  | 5–10      |       |
| dobry     | 10–20     |       |
| optymalny | ≥ 20      |       |

**Zastrzeżenia:**

- Źródła to materiały dostawców, nie niezależne badania – Yotpo sam zaznacza, że zakresy są orientacyjne, a najlepszym punktem odniesienia jest własna historia.
- Zakresy Yotpo pochodzą z kontekstu e-commerce, nie subskrypcji – w subskrypcjach traktuj je kierunkowo.
- Dla porównania: w masowej dystrybucji kuponów CPG w USA wykorzystano 1,3% wydanych kuponów (Inmar, 2024).
- W mianowniku licz także kody wygasłe; w przeciwnym razie wskaźnik jest zawyżony. Skrót CpRR celowo odróżnia od CRR (Customer Retention Rate).

### APS: Udział planów rocznych (Annual Plan Share)

- **Rozwinięcie:** Annual Plan Share – udział subskrypcji z okresem rozliczeniowym 12 miesięcy lub dłuższym / Annual Plan Share
- **Wzór:** APS = aktywne płatne subskrypcje z okresem rozliczeniowym ≥ 12 mies. ÷ wszystkie aktywne płatne subskrypcje × 100%; wariant przychodowy: MRR z planów ≥ 12 mies. ÷ MRR całkowity × 100%
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Jaka część bazy jest zobowiązana na rok lub dłużej – wskaźnik stabilności przychodu i gotówki z przedpłat. Plany roczne retencjonują znacznie lepiej (Piano: po 4 latach aktywnych 18,0% subskrypcji rocznych vs 4,4% miesięcznych), ale zwykle konwertują wolniej i bywają tańsze. Pułapka: wymuszanie planów rocznych głębokimi rabatami kupuje retencję kosztem realizacji ceny, a na wczesnym etapie zbyt wysoki udział rocznych spowalnia wzrost.
- **Interpretation (EN):** Share of the base committed for a year or longer – an indicator of revenue stability and prepaid cash. Annual plans retain far better (Piano: after 4 years 18.0% of annual vs 4.4% of monthly subscriptions remain active) but usually convert more slowly and can be cheaper. Pitfall: pushing annual plans with deep discounts buys retention at the cost of price realisation, and at an early stage too high an annual share slows growth.

**Kontekst:** Media cyfrowe B2C – udział w aktywnej bazie subskrybentów (%) · okres: miesięcznie · metoda: średnie źródeł (Piano 2026: 49%, 181 serwisów; FT Strategies: 46%, próba 4 europejskich wydawców prasowych) + heurystyka zakresu docelowego; ARPU planów rocznych vs miesięcznych – sprzeczne punkty odniesienia (Mather 2024, Piano 2026, Recurly 2026), zob. zastrzeżenia · źródła: S15, S17, S16, S103

| Ocena     | Przedział | Uwagi                                                                                                   |
| --------- | --------- | ------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–15      |                                                                                                         |
| słaby     | 15–30     |                                                                                                         |
| normalny  | 30–40     |                                                                                                         |
| dobry     | 40–45     |                                                                                                         |
| optymalny | 45–60     | Piano 2026: 49% aktywnych i 49% przychodu; FT Strategies: 46% (próba 4 europejskich wydawców prasowych) |
| dobry     | 60–75     |                                                                                                         |
| normalny  | 75–100    | sprawdź ARPU i tempo akwizycji                                                                          |

**Kontekst:** B2B – firmy i instytucje: udział ARR z planów rocznych (%) · okres: kwartalnie · metoda: punkty ChartMogul Billing Report 2025: wzrost stabilizuje się powyżej 25% ARR z planów rocznych (dotyczy firm 1–10 mln USD ARR); przy ARPA ≥ 1 tys. USD 55% ARR z rocznych · źródła: S5

| Ocena     | Przedział | Uwagi                                                                           |
| --------- | --------- | ------------------------------------------------------------------------------- |
| krytyczny | 0–10      |                                                                                 |
| słaby     | 10–25     |                                                                                 |
| normalny  | 25–45     | powyżej 25% wzrost się stabilizuje (firmy 1–10 mln USD ARR)                     |
| dobry     | 45–55     | szczyt 47% przy 3–8 mln USD ARR                                                 |
| optymalny | 55–100    | ARPA ≥ 1 tys. USD: 55% ARR z planów rocznych; instytucje preferują roczne umowy |

**Kontekst:** Wczesny etap, ARR < 1 mln USD, miks planów – udział ARR z planów rocznych (%) · okres: kwartalnie · metoda: heurystyka na podstawie ChartMogul Billing Report 2025: mediana wzrostu firm < 1 mln USD ARR opartych w 50–75% / ≥ 75% na planach rocznych spadła do 15% / 18%; zdanie 'wzrost stabilizuje się powyżej 25%' ChartMogul odnosi do firm 1–10 mln USD ARR, a w górnym kwartylu firm wczesnego etapu najszybciej rosły te z < 25% ARR z planów rocznych (zakres 25–50% to heurystyczny kompromis między retencją a tempem wzrostu); etykieta 'słaby' dla 0–10% wynika z retencji: przy ARPA < 25 USD retencja klientów 62% (roczne) vs 41% (miesięczne) · źródła: S5

| Ocena     | Przedział | Uwagi                                                                                                                       |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| słaby     | 0–10      | przy ARPA < 25 USD retencja klientów: 62% (roczne) vs 41% (miesięczne)                                                      |
| normalny  | 10–25     |                                                                                                                             |
| optymalny | 25–50     |                                                                                                                             |
| normalny  | 50–75     | mediana wzrostu takich firm: 15%                                                                                            |
| słaby     | 75–100    | mediana wzrostu takich firm: 18%; w górnym kwartylu firm wczesnego etapu najszybciej rosły te z < 25% ARR z planów rocznych |

**Zastrzeżenia:**

- Udział wśród nowych subskrypcji jest dużo niższy niż w aktywnej bazie (Mather: 14% nowych subskrypcji to plany roczne, 71% miesięczne) – raportuj oba warianty.
- Sprzeczne punkty odniesienia dla ARPU planów rocznych: Recurly 2026 State of Subscriptions podaje, że plany roczne dają 50–60% wyższy przychód na użytkownika, Mather 2024 – ARPU niższe (7,36 vs 12,64 USD), Piano 2026 – zbliżone (6,62 vs 6,57 USD). Wynik zależy od cennika.
- Najwięcej przejść z planu miesięcznego na roczny następuje w 2.–4. miesiącu subskrypcji (ChartMogul) – wtedy kieruj ofertę upgrade'u.

### Źródła grupy: Subskrypcje i przychód

| Id   | Źródło                                                                                                                                                                                                                                             | Wydawca                                                      | Data                                                               | Weryfikacja          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------- |
| S1   | [2025 B2B Benchmarking Private SaaS Company Growth Rates (Research Brief 33)](https://www.saas-capital.com/wp-content/uploads/2025/06/RB33WS5-2025-B2B-Benchmarking-Private-SaaS-Company-Growth-Rates.pdf)                                         | SaaS Capital                                                 | 2025-06                                                            | tak                  |
| S2   | [2026 Private B2B SaaS Company Growth Rate Benchmarks](https://www.saas-capital.com/research/private-saas-company-growth-rate-benchmarks/)                                                                                                         | SaaS Capital                                                 | 2026 (strona bez daty publikacji; widoczne tylko 'Copyright 2026') | tak                  |
| S3   | [SaaS Benchmarks Report 2023 (2nd edition)](https://chartmogul.com/reports/saas-benchmarks-report/saas-benchmarks-report-2023.pdf)                                                                                                                 | ChartMogul                                                   | 2023-05                                                            | tak                  |
| S4   | [Growth Levers: The Path from $1M to $20M ARR](https://chartmogul.com/reports/saas-growth-levers/)                                                                                                                                                 | ChartMogul (Kyle Poyar)                                      | 2025-11-05                                                         | tak                  |
| S5   | [SaaS Billing Report 2025: Billing is the invisible force behind your growth](https://chartmogul.com/reports/saas-billing-report/saas-billing-report-2025.pdf)                                                                                     | ChartMogul                                                   | 2025-03                                                            | tak                  |
| S6   | [MRR (Monthly Recurring Revenue) – SaaS metrics](https://chartmogul.com/saas-metrics/mrr/)                                                                                                                                                         | ChartMogul                                                   | 2026-09-08                                                         | tak                  |
| S7   | [Retention benchmarks and insights](https://chartmogul.com/blog/retention-benchmarks-and-insights/)                                                                                                                                                | ChartMogul (Sid Jain)                                        | 2023-03-01                                                         | tak                  |
| S8   | [SaaS Quick Ratio](https://chartmogul.com/blog/saas-quick-ratio/)                                                                                                                                                                                  | ChartMogul                                                   | 2016-03-09                                                         | tak                  |
| S9   | [What is the optimal quick ratio for your SaaS startup? Is it 4?](https://tomtunguz.com/what-is-quick-ratio-hiding/)                                                                                                                               | Tomasz Tunguz                                                | 2015-11-03                                                         | tak                  |
| S10  | [2025 B2B SaaS Performance Metrics Benchmarks](https://www.hibob.com/wp-content/uploads/2025-SaaS-Performance-Metrics-Benchmarks.pdf)                                                                                                              | Benchmarkit (Ray Rike)                                       | 2025-06                                                            | tak                  |
| S11  | [What are the Latest SaaS Metrics Benchmarks Telling Us? 'The Trends are the Insights'](https://www.maxio.com/blog/2025-saas-benchmark-report-trends)                                                                                              | Maxio (Ray Rike)                                             | 2025-07-03                                                         | tak                  |
| S12  | [How much do people pay for online news and what might encourage others to pay (Digital News Report 2024)](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2024/how-much-do-people-pay-online-news-what-might-encourage-others-pay) | Reuters Institute for the Study of Journalism                | 2024-06-17                                                         | tak                  |
| S13  | [News subscription prices 2026 (UK digital subscription price tracker)](https://pressgazette.co.uk/media-audience-and-business-data/news-subcriptions-prices-2026/)                                                                                | Press Gazette                                                | 2026-02-12                                                         | częściowo            |
| S14  | [100k Club: biggest subscription news websites 2026](https://pressgazette.co.uk/paywalls/biggest-subscription-news-websites-2026/)                                                                                                                 | Press Gazette                                                | 2026-03-12 (aktualizacja 2026-06-25)                               | tak                  |
| S15  | [Monthly vs. annual subscriptions: why the answer isn't either-or](https://www.piano.io/resources/monthly-vs-annual-subscriptions-why-the-answer-isnt-either-or)                                                                                   | Piano                                                        | 2026-10-14                                                         | tak                  |
| S16  | [Decoding Subscription Value: Annual vs. Monthly Terms](https://www.mathereconomics.com/2024/07/08/decoding-subscription-value-annual-vs-monthly-terms/)                                                                                           | Mather Economics                                             | 2024-07-08 (wg URL; strona bez daty)                               | tak                  |
| S17  | [Are monthly subscribers practically worthless? (Part 2)](https://www.ftstrategies.com/en-gb/insights/part-2-are-monthly-subscribers-practically-worthless/)                                                                                       | FT Strategies                                                | 2024-06 (niepotwierdzona – strona bez daty)                        | tak                  |
| S18  | [Global Pricing Study 2025 (brochure)](https://www.simon-kucher.com/sites/default/files/media-document/2025-06/COR_GPS_2025_Brochure_Digital_Final.pdf)                                                                                            | Simon-Kucher                                                 | 2025-06                                                            | tak                  |
| S19  | [Vendr: The Average SaaS Discount is About 10% (and Trending Down)](https://www.saastr.com/vendr-the-average-saas-discount-is-about-10-and-trending-down)                                                                                          | SaaStr (dane Vendr)                                          | 2023-07 (niepotwierdzona – strona bez daty; dane Vendr za Q2 2023) | częściowo            |
| S20  | [Average discount from list price (software pricing benchmarks)](https://www.vertice.one/insights/average-discount-from-list-price)                                                                                                                | Vertice                                                      | 2026-07                                                            | tak                  |
| S21  | [Customer Acquisition Promotions and Customer Asset Value](https://doi.org/10.1509/jmkr.43.2.195)                                                                                                                                                  | Journal of Marketing Research 43(2): 195–203 (M. Lewis)      | 2006-05                                                            | tak                  |
| S22  | [Subscriber Acquisition Benchmarks (coupons and free trials)](https://recurly.com/research/subscriber-acquisition-benchmarks)                                                                                                                      | Recurly Research                                             | 2017-10                                                            | nie da się sprawdzić |
| S23  | [What is redemption rate? (benchmarks and formula)](https://www.yotpo.com/blog/redemption-rate/)                                                                                                                                                   | Yotpo                                                        | 2025-09-29                                                         | tak                  |
| S24  | [As grocery costs increase, coupon use rises for the second straight year](https://couponsinthenews.com/2025/02/24/as-grocery-costs-increase-coupon-use-rises-for-the-second-straight-year/)                                                       | Coupons in the News (raport Inmar Intelligence)              | 2025-02-24                                                         | tak                  |
| S25  | [Wyniki finansowe Grupy Agora w 3 kwartale 2025 r.](https://strefainwestorow.pl/wiadomosci/20251119/wyniki-finansowe-grupy-agora-w-3-kwartale-2025-r)                                                                                              | Strefa Inwestorów                                            | 2025-11-19                                                         | częściowo            |
| S26  | [Zuora Subscription Economy Index 2025 (komunikat prasowy)](https://www.zuora.com/company/news/zuora-subscription-economy-index/)                                                                                                                  | Zuora                                                        | 2025-04-15                                                         | tak                  |
| S27  | [Q2 2025 U.S. Subscription Benchmarking Report (strona pobierania)](https://www.mathereconomics.com/download-mathers-q2-2025-u-s-benchmarking-report-2/)                                                                                           | Mather Economics                                             | 2025-08 (niepotwierdzona – strona bez daty; dane za Q2 2025)       | tak                  |
| S28  | [2025 KeyBanc Capital Markets & Sapphire Ventures SaaS Survey](https://info.sapphireventures.com/2025-keybanc-capital-markets-sapphire-ventures-saas-survey)                                                                                       | KeyBanc Capital Markets / Sapphire Ventures                  | 2025-11 (niepotwierdzona – strona bez daty)                        | tak                  |
| S100 | [The Slow Decay of Growth (SaaS Growth Decay Report)](https://chartmogul.com/reports/saas-growth-decay-report/)                                                                                                                                    | ChartMogul                                                   | 2026-04-15                                                         | tak                  |
| S101 | [The SaaS Winbacks Report: Why Winbacks Signal Growth](https://chartmogul.com/reports/saas-winbacks-report/)                                                                                                                                       | ChartMogul (Olga Berezovsky)                                 | 2026-04-21                                                         | tak                  |
| S102 | [The 30-day upsell window](https://www.growthunhinged.com/p/the-30-day-upsell-window)                                                                                                                                                              | Growth Unhinged (Kyle Poyar, dane ChartMogul)                | 2026-09-30                                                         | tak                  |
| S103 | [2026 State of Subscriptions](https://recurly.com/research/state-of-subscriptions/)                                                                                                                                                                | Recurly                                                      | 2026                                                               | tak                  |
| S104 | [Q1 2026 Audience & Subscription Benchmarking Report](https://www.mathereconomics.com/north-america-media-benchmarking-report-q1-2026/)                                                                                                            | Mather Economics                                             | 2026-05-26                                                         | nie da się sprawdzić |
| S105 | [Digital News Report 2026 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                                                    | Reuters Institute for the Study of Journalism (V. Makarenko) | 2026-06-16                                                         | tak                  |

### Zmiany po weryfikacji: Subskrypcje i przychód

- S1: poprawiono excerpt – sam poziom ACV nie koreluje ze wzrostem (tylko ACV > 250 tys. USD); 'rosnące ACV → szybszy wzrost' przypisano osobnej analizie SaaS Capital 'Changing ACVs'; dopisano, że kwartyle wg ARR z edycji 2025 pozostają najnowszymi publicznymi.
- S2: data '2026-07-22' niesprawdzalna – zmieniono published na '2026' z adnotacją; dopisano brak percentyli wg ARR na stronie.
- S3: dopisano w excerpt przestarzałość danych (LTM do 03.2023) i brak nowszych publicznych kwartyli wg ARPA; wskazano S100.
- S4: excerpt – 'firmy najszybciej rosnące'/'pozostałe' zastąpiono definicjami raportu: outliers (doszły do 20 mln USD ARR) i normies (utknęły między 1 a 20 mln USD); dodano 8,7% m/m normies.
- S5: doprecyzowano w excerpt, że próg 25% ('growth stabilizes') dotyczy firm 1–10 mln USD ARR, a w górnym kwartylu wczesnego etapu najszybciej rosły firmy z < 25% ARR z planów rocznych.
- S8: excerpt – fraza o progu 4 oznaczona jako parafraza autora, nie cytat M. Hamida; dopisano, że wzór i progi ChartMogul nie zawierają Reactivation MRR.
- S10: excerpt uzupełniony o N = 149 dla median wzrostu, '5 pp' w opisie i zastrzeżenie, że kohorta > 100 mln USD ARR (67%) to tylko 6 firm.
- S12: dopisano w excerpt, że to deklaracje ankietowe z 2024 r. bez nowszych danych o pełnej cenie; wskazano S105 (DNR 2026).
- S13: poprawiono błąd w excerpt – 'sześć tytułów ≥70%, dziesięć ≥17%' → 'dziesięć tytułów ≥ 70% (cztery wymienione + sześć innych) i dziesięć kolejnych ≥ 17%'.
- S14: excerpt – +21% oznaczono jako porównanie list o różnym składzie (59 → 62 wydawców), nie wzrost organiczny; Newsquest −9% → ok. −8,7%.
- S15: excerpt – TechCrunch 150→99 USD opisano jako obniżkę ceny planu rocznego (nie rabat roczny) z efektem 2× konwersji i +28% przychodu z planów rocznych; dopisano małe próby planów kwartalnych/dwuletnich.
- S16: miks 50/25/25 przypisano N. Hunshikattiemu (nie rekomendacja Mather, 'no one-size-fits-all'); published doprecyzowano jako 2024-07-08 wg URL.
- S17: excerpt – 54/46% i ok. 75% przychodu przypisano próbie 4 anonimowych europejskich wydawców (nie FT); oznaczono brak daty na stronie.
- S19: oznaczono brak daty i definicji rabatu Vendr oraz przestarzałość danych (Q2 2023); wskazano nowsze S20.
- S21: excerpt – 'sklep internetowy' doprecyzowano jako internetowy sklep spożywczy; dopisano sposób weryfikacji (Crossref).
- S22: martwy link (brak badania pod URL) – źródło oznaczone jako niezweryfikowane i odpięte od wszystkich przedziałów (pozostawione w sources tylko dla przejrzystości).
- S23: dopisano w excerpt, że to materiał dostawcy z kontekstu e-commerce, nie subskrypcji.
- S25: usunięto nieoparty dopisek '(z reklamą cyfrową)'; wyliczenie ≈ 19 zł/mies. zostaje, a status 'górnej granicy ARPU' oznaczono jako zależny od niezweryfikowanej definicji.
- S26: dopisano, że indeks Zuora obejmuje wszystkie branże, nie media.
- S27: oznaczono brak daty na stronie (dane za Q2 2025) i wskazano nowszy raport Mather Q1 2026 (S104).
- S28: oznaczono 20% jako prognozę na 2025 (nie wynik) i brak daty na stronie.
- Dodano nowsze źródła wskazane przez weryfikatora: S100 (ChartMogul Slow Decay of Growth, 04.2026), S101 (ChartMogul Winbacks Report, 04.2026), S102 (Growth Unhinged/ChartMogul '30-day upsell window', 09.2026), S103 (Recurly 2026 State of Subscriptions), S104 (Mather Q1 2026 – za formularzem, 'nie da się sprawdzić'), S105 (Reuters DNR 2026 – Polska).
- arr: caveat o SaaS Capital 2026 – zamiast 'pełny raport dostępny po rejestracji' wpisano, że strona 2026 nie publikuje percentyli wg ARR, więc kwartyle 2025 są najnowszymi publicznymi.
- arr / niskie ARPA: dopisano w method 'dane LTM do 03.2023 – brak nowszych publicznych kwartyli wg ARPA'; podpięto S100 jako kontekst (bez zmiany granic).
- arr / wydawcy cyfrowi: nota 'optymalny' – usunięto kotwicę 100k Club +21% (listy o różnym składzie 59 → 62, nie wzrost organiczny), próg 20% oparto na heurystyce ok. 1,5 × NYT/WSJ (+13%).
- arr / wydawcy cyfrowi: nota 'krytyczny' – doprecyzowano 'wydawcy prasowi USA, Q2 2025' i dopisano, że nowszy raport Mather Q1 2026 jest za formularzem (podpięto S104).
- arr / wydawcy cyfrowi: nota 'normalny' i method – indeks Zuora obejmuje wszystkie branże, nie media.
- arpa / B2B: method – 'firmy najszybciej rosnące/pozostałe' zastąpiono outliers (+82%, 564 → 1 024 USD) i normies (+63%).
- arpa / B2B: method – usunięto przypisanie RB33 tezy 'rosnące ACV koreluje z szybszym wzrostem'; wpisano, że w RB33 sam poziom ACV nie koreluje ze wzrostem (poza ACV > 250 tys. USD).
- arpa / portfel mieszany: Newsquest −9% → ok. −8,7% (wartość z weryfikacji S14).
- arpu / Polska: method – usunięto '(przychody cyfrowe z reklamą ÷ prenumeraty)', wpisano wyliczenie 18,1 mln zł ÷ 317,6 tys. ÷ 3 ≈ 19 zł/mies. i brak definicji przychodów cyfrowych u Agory.
- arpu / Polska: nota 'dobry' – 'powyżej szacunku dla największego wydawcy' zastąpiono 'obejmuje szacunek ok. 19 zł/mies. (definicja niezweryfikowana)', bo status górnej granicy jest niepotwierdzony.
- arpu: caveat – 'licznik obejmuje reklamę cyfrową' → 'licznik może obejmować reklamę cyfrową (definicja niezweryfikowana), a mianownik to stan na koniec kwartału'.
- arpu: dodano caveat z DNR 2026 (11% płacących w Polsce, −2 pp r/r) i podpięto S105 do kontekstu polskiego.
- arpu / zmiana r/r: Newsquest −9% → ok. −8,7% w method i nocie 'słaby'.
- mrr_growth_mom / B2C: dopisano, że kwartyle ChartMogul pochodzą z 2023 r.; podpięto S100 jako kontekst.
- mrr_growth_mom / wydawcy cyfrowi: spójnie z arr – usunięto kotwicę 100k Club +21% (próg 20% ≈ 1,5 × NYT/WSJ), doprecyzowano Mather Q2 2025 i podpięto S104.
- mrr_growth_mom: caveat – 'firmy najszybciej rosnące' → outliers (16,7% → 5,1%), dodano normies 8,7% m/m przy 1 mln USD ARR.
- net_new_mrr: we wzorze zaznaczono, że równość z 1 − 1/QR zachodzi przy QR z reaktywacjami, a progi ChartMogul liczono bez nich.
- net_new_mrr / wczesny etap: oznaczono datę kwartyli ChartMogul (LTM do 03.2023).
- net_new_mrr / efektywność: method – zaznaczono, że progi QR ChartMogul liczono bez reaktywacji, więc wariant z reaktywacją w mianowniku nie jest w pełni porównywalny; podpięto S101–S103.
- net_new_mrr: caveat o reaktywacjach – przypisano 1,7–3,8% do outliers ChartMogul i uzupełniono nowszymi danymi (Winbacks 04.2026: 7%/9%, 45%/66%; '30-day upsell window' 09.2026: 2,67%, >5%; Recurly 2026: ok. 1 na 4 zapisy w B2C); usunięto tezę o alarmowym charakterze wysokiego udziału.
- saas_quick_ratio: we wzorze zaznaczono, że progi ChartMogul liczono bez Reactivation MRR i do porównań trzeba pokazywać wariant bez reaktywacji.
- saas_quick_ratio / B2B: method – 20% wzrostu KeyBanc/Sapphire oznaczono jako prognozę na 2025 (przy wyniku 2024, 15%, QR ≈ 2,5); próg 4 opisano jako parafrazę stanowiska M. Hamida.
- expansion_share_new_mrr / B2B ogółem: nota 'optymalny' – dopisano, że kohorta > 100 mln USD (67%) to 6 firm, a mediana 40% pochodzi z N = 81.
- expansion_share_new_mrr / mała firma: 15,4% i 34,7% nazwano danymi outliers (firm, które doszły do 20 mln USD ARR) w method i notach.
- expansion_share_new_mrr / mała firma: okres 'kwartalnie' → 'kroczące 12 miesięcy' (ok. 40% upgrade'ów w 1. roku przy odnowieniu w 12. mies.); podpięto S102.
- expansion_share_new_mrr / media B2C: okres 'kwartalnie' → 'kroczące 12 miesięcy' z uzasadnieniem z S102.
- price_realization / media B2C: 'miks rekomendowany przez Mather' → miks 50/25/25 cytowany za N. Hunshikattim (no one-size-fits-all); dopisano, że 72–75% zakłada rabaty wejściowe 70–80% (UK), a przy ok. 50% wynik to ok. 79–82%.
- price_realization / B2B: usunięto nieoparte określenie 'rabat negocjacyjny' dla Vendr; oznaczono dane z 2023 r. i brak definicji.
- average_discount: interpretacja PL/EN – 'na danych gazety' → 'na danych gazety i internetowego sklepu spożywczego (Lewis 2006)'.
- average_discount / B2C: usunięto S22 (martwy link, liczby niesprawdzalne) z source_ids i method; nota 'normalny' 25–35 oparta na heurystyce S13/S21 zamiast 'mediana B2C ok. 30% (Recurly, 2017)'; granice bez zmian, confidence pozostaje 'niska'.
- average_discount / B2B: oznaczono dane Vendr jako z 2023 r. bez definicji rabatu (method, nota 'dobry').
- average_discount / rabat roczny: usunięto kotwicę 'TechCrunch 150→99 USD ≈ 34%' z method i noty 'normalny' (to obniżka ceny planu, nie rabat roczny); zostają 'Save 20%' (S5) i 33% (FT, S17).
- average_discount / rabat roczny: do noty 'optymalny' dodano efekt obniżki ceny planu rocznego TechCrunch (2× konwersja, +28% przychodu z planów rocznych, Piano 2026).
- average_discount: caveat o medianach Recurly oznaczono jako niesprawdzalny i usunięto z niego liczby.
- average_discount: caveat 'Vendr mierzy różnicę między pierwszą ofertą a ceną końcową' (bez oparcia w źródle) zastąpiono 'SaaStr nie podaje definicji rabatu Vendr (dane z 2023 r.); Vertice mierzy rabat od cennika (Q2 2026)'.
- coupon_redemption_rate: dodano caveat, że zakresy Yotpo dotyczą e-commerce, nie subskrypcji.
- annual_plan_share / media B2C: 'FT Strategies: 46%' → '46% (próba 4 europejskich wydawców prasowych)' w nocie 'optymalny' i method; podpięto S103.
- annual_plan_share / B2B: doprecyzowano, że próg 25% ('wzrost się stabilizuje') dotyczy firm 1–10 mln USD ARR.
- annual_plan_share / wczesny etap: method – dopisano, że próg 25% dotyczy firm 1–10 mln USD ARR, a w górnym kwartylu wczesnego etapu najszybciej rosły firmy z < 25% ARR z rocznych; granice bez zmian.
- annual_plan_share / wczesny etap: etykietę 'słaby' dla 0–10% uzasadniono retencją 62% vs 41% przy ARPA < 25 USD (nota i method).
- annual_plan_share: caveat o ARPU planów rocznych zastąpiono zestawieniem sprzecznych punktów odniesienia (Recurly 2026 +50–60%, Mather 2024 niższe, Piano 2026 zbliżone).

## 2. Retencja i churn

### Logo churn (M): Miesięczny churn klientów (logo churn) (Monthly logo (customer) churn rate)

- **Rozwinięcie:** Churn – odpływ, utrata klientów. 'Logo' oznacza, że liczymy klientów lub konta, a nie przychód. M – okres miesięczny. / Churn – customer attrition. 'Logo' means it is counted in customers/accounts, not revenue. M – monthly period.
- **Wzór:** Płacący klienci aktywni na początku miesiąca, którzy odeszli w tym miesiącu (anulowanie, wygaśnięcie, nieodzyskana płatność), podzieleni przez płacących klientów na początku miesiąca, × 100%. Klienci pozyskani w trakcie miesiąca nie wchodzą ani do licznika, ani do mianownika. Przeliczenie na rok: 1 − (1 − churn_M)^12.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jaki odsetek płacącej bazy tracisz co miesiąc. Churn się składa: 2% miesięcznie to ok. 22% rocznie, a 4% miesięcznie to ok. 39% rocznie. Typowe pułapki: wliczanie trialistów i ofert za 1 zł zawyża wskaźnik. Średnia z całej bazy ukrywa wysoki odpływ nowych kohort. Przy planach rocznych churn jest 'schodkowy' (skupia się w miesiącach odnowień), dlatego oceniaj go na średniej kroczącej z 3–12 miesięcy i zawsze osobno dla każdego segmentu.
- **Interpretation (EN):** Shows what share of the paying base you lose each month. Churn compounds: 2% a month is about 22% a year, and 4% a month is about 39% a year. Common pitfalls: counting trialists and 1-unit intro offers inflates the rate, and a whole-base average hides the high attrition of new cohorts. With annual plans churn comes in steps (it clusters in renewal months), so judge it on a 3–12 month rolling average and always per segment.

**Kontekst:** Cyfrowe subskrypcje news/media B2C (płatne plany miesięczne, sprzedaż web, bez trialu) · okres: miesięcznie · metoda: Mediany Mather Economics (USA, 2022–2025) i poziom 'Best-in-Class' Mathera (średnia rynków o najwyższym 'subscription success index', a nie percentyl P75), potwierdzone medianą Recurly (2026) i średnią ważoną Antenna (2025; okres niepodany na stronie). Granica słaby/krytyczny to heurystyka. Do aktualizacji po pobraniu raportu Mather Q1 2026 (V 2026). · źródła: mather_sep_2022, mather_q3_2023, mather_q1_2025, recurly_churn_benchmarks_2026, recurly_docs_churn_benchmarks, antenna_svod_2025, digiday_monthly_annual_2023, beehiiv_pressgazette_2026, mather_q1_2026

| Ocena     | Przedział | Uwagi                                                                                                                                                                                                                                                                 |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| optymalny | < 2,7     | poziom 'Best-in-Class' według Mathera (2,70%/mies., 2022; średnia rynków o najwyższym 'subscription success index', nie percentyl)                                                                                                                                    |
| dobry     | 2,7–3,5   | 'Leading publisher' według Mathera to 3,1%/mies. (2023)                                                                                                                                                                                                               |
| normalny  | 3,5–4,9   | mediany: Mather 3,53% (2022), 3,8% (2023), 4,62% (Q1 2025); Recurly digital media 4,14%; Antenna SVOD 4,6% (średnia ważona 2025; strona nie podaje okresu, miesięczny według metodologii Antenna – niepotwierdzone na stronie); INMA 4,6% niezweryfikowana (HTTP 403) |
| słaby     | 4,9–7     | powyżej median rynkowych; rocznie ok. 45–58%                                                                                                                                                                                                                          |
| krytyczny | ≥ 7       | heurystyka: powyżej 58% rocznie; poziom 'nieszczelnych' kategorii newsletterów (sport 7,76%, AI 13,33%)                                                                                                                                                               |

**Kontekst:** SaaS / subskrypcje B2B SMB (ARPA poniżej ok. 1 tys. USD/mies., płatność kartą, plan miesięczny) · okres: miesięcznie · metoda: Górny kwartyl i mediana Recurly (lipiec 2026), mediany ChartMogul według ARPA (dane historyczne XI 2021–I 2022) i średnia Stripe za 2024 (via Churnkey). Granica krytyczna to heurystyka. · źródła: recurly_churn_benchmarks_2026, recurly_docs_churn_benchmarks, chartmogul_good_churn_2022, churnkey_involuntary_2025

| Ocena     | Przedział | Uwagi                                                                                 |
| --------- | --------- | ------------------------------------------------------------------------------------- |
| optymalny | < 1,8     | górny kwartyl Recurly dla SaaS: 1,78% lub mniej                                       |
| dobry     | 1,8–3     |                                                                                       |
| normalny  | 3–4,5     | mediany Recurly: SaaS 3,04–3,22%, usługi B2B 3,21–3,44%; średnia Stripe dla B2B 3,82% |
| słaby     | 4,5–6,5   | mediana ChartMogul przy ARPA < 25 USD to 6,1% (dane historyczne XI 2021–I 2022)       |
| krytyczny | ≥ 6,5     | heurystyka: powyżej 55% rocznie                                                       |

**Kontekst:** B2B mid-market (ACV ok. 12–100 tys. USD, umowy roczne); ekwiwalent miesięczny · okres: miesięcznie (ekwiwalent; oceniaj jako średnią kroczącą 12M) · metoda: Heurystyka: przeliczenie progów rocznych 6/10/15/22% na miesięczne. Progi zakotwiczone w churnie ARR 10% dla umów rocznych (KeyBanc 2024) i medianie GRR 90–91% dla ACV 12–250 tys. USD (SaaS Capital 2025). Logo churn bywa wyższy niż churn dolarowy, bo częściej odchodzą mniejsi klienci. · źródła: keybanc_sapphire_2024, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                                                |
| --------- | --------- | -------------------------------------------------------------------- |
| optymalny | < 0,5     | poniżej ok. 6% rocznie                                               |
| dobry     | 0,5–0,9   | ok. 6–10% rocznie                                                    |
| normalny  | 0,9–1,3   | ok. 10–15% rocznie; churn ARR przy umowach rocznych to 10% (KeyBanc) |
| słaby     | 1,3–2     | ok. 15–22% rocznie                                                   |
| krytyczny | ≥ 2       | powyżej ok. 22% rocznie                                              |

**Kontekst:** B2B enterprise (ACV powyżej 100 tys. USD, umowy wieloletnie); ekwiwalent miesięczny · okres: miesięcznie (ekwiwalent; oceniaj jako średnią kroczącą 12M) · metoda: Heurystyka: przeliczenie progów rocznych 3/5/8/12% na miesięczne. Kotwice: GRR 95% dla ACV powyżej 250 tys. USD (SaaS Capital 2025) oraz churn ARR 6% przy umowach 2-letnich i 3% przy 3+ letnich (KeyBanc 2024). · źródła: saascapital_retention_2025, keybanc_sapphire_2024

| Ocena     | Przedział | Uwagi                                                      |
| --------- | --------- | ---------------------------------------------------------- |
| optymalny | < 0,25    | poniżej 3% rocznie (churn ARR przy umowach 3+ letnich: 3%) |
| dobry     | 0,25–0,43 | 3–5% rocznie (mediana GRR powyżej 250 tys. USD ACV: 95%)   |
| normalny  | 0,43–0,7  | 5–8% rocznie                                               |
| słaby     | 0,7–1,06  | 8–12% rocznie                                              |
| krytyczny | ≥ 1,06    | powyżej 12% rocznie                                        |

**Kontekst:** Członkostwa / memberships (składka roczna); ekwiwalent miesięczny · okres: miesięcznie (ekwiwalent; przy składce rocznej licz kroczące 12M) · metoda: Przeliczenie progów rocznych 10/15/20/28% na miesięczne. Progi zakotwiczone w medianach odnowień MGI (2025: 84% ogółem i 74% po 1. roku; 2026: 82% i 72%). Pozostałe granice to heurystyka. · źródła: mgi_2025_memberjungle, mgi_2026_i4a

| Ocena     | Przedział | Uwagi                                                                       |
| --------- | --------- | --------------------------------------------------------------------------- |
| optymalny | < 0,87    | poniżej 10% rocznie (odnowienia 90%+ to poziom top stowarzyszeń branżowych) |
| dobry     | 0,87–1,35 | 10–15% rocznie                                                              |
| normalny  | 1,35–1,84 | 15–20% rocznie; mediana MGI to 82–84% odnowień, czyli 16–18% churnu         |
| słaby     | 1,84–2,7  | 20–28% rocznie, poziom churnu członków w 1. roku (odnowienia 72–74%)        |
| krytyczny | ≥ 2,7     | powyżej 28% rocznie                                                         |

**Zastrzeżenia:**

- Strona Recurly opisuje benchmarki jako 'annual', ale dokumentacja Recurly mówi wprost: 'Benchmarks apply only to monthly periods'. Wartości 3–5% są realistyczne tylko jako miesięczne, więc tak je traktujemy.
- Raport Mather za Q1 2025 (4,62%) nie podaje okresu. Wcześniejsze raporty Mathera mierzą churn miesięczny, więc przyjęto okres miesięczny.
- Dane news B2C pochodzą głównie z USA. Brak publicznego benchmarku churnu dla polskich wydawców. RASP/Onet podaje tylko, że obniżył churn 'o ponad połowę r/r', bez wartości bezwzględnych. Za newsy online płaci w Polsce 11% osób (DNR 2026, −2 pp), więc baza jest mniejsza i bardziej wrażliwa na cenę.
- Progi dla mid-market, enterprise i członkostw to heurystyki przeliczone z wartości rocznych i rewenue'owych (GRR, churn ARR). Bezpośrednich median logo churn dla tych segmentów nie znaleziono w źródłach pierwotnych.
- Wartość INMA (mediana 4,6%/mies. dla krajowych marek newsowych w 4Q 2024) jest niezweryfikowana: strona zwraca HTTP 403 (potwierdzone ponownie), liczba pochodzi tylko z wyników wyszukiwania. Jest zbieżna z Antenna (4,6%) i Mather Q1 2025 (4,62%), ale nie opiera się na niej żadna granica przedziału.

### Logo churn (R): Roczny churn klientów (logo churn) (Annual logo (customer) churn rate)

- **Rozwinięcie:** Churn – odpływ klientów liczony w sztukach (logo). R – okres 12 miesięcy. Dla członkostw to 1 − wskaźnik odnowień (renewal rate). / Churn – customer attrition counted in accounts (logos). R – 12-month period. For memberships it equals 1 − renewal rate.
- **Wzór:** Klienci aktywni na początku 12-miesięcznego okresu, którzy nie są aktywni na jego końcu, podzieleni przez klientów aktywnych na początku okresu, × 100%. Alternatywnie: 1 − (1 − churn_M)^12. Dla członkostw: 1 − (odnowieni członkowie / członkowie, którym wygasła składka).
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Odsetek klientów z początku roku, których po 12 miesiącach nie ma w bazie. To główny wskaźnik dla umów rocznych B2B i składek członkowskich, gdzie churn miesięczny jest mało czytelny. Typowe pułapki: mieszanie planów miesięcznych i rocznych, liczenie od średniej bazy zamiast od bazy początkowej oraz 'netowanie' odejść powracającymi klientami. Reaktywacje raportuj osobno (winback).
- **Interpretation (EN):** Share of customers present at the start of the year who are gone 12 months later. It is the primary measure for annual B2B contracts and membership dues, where monthly churn is hard to read. Common pitfalls: mixing monthly and annual plans, dividing by an average instead of the opening base, and netting losses against returning customers. Report reactivations separately (winback).

**Kontekst:** News/media cyfrowe B2C – cała baza (mieszanka planów miesięcznych i rocznych) · okres: rocznie (kroczące 12M) · metoda: Przeliczenie progów miesięcznych 1 − (1 − m)^12, zweryfikowane danymi o kohortach (Piano 2021, FTI 2023). · źródła: mather_sep_2022, mather_q3_2023, mather_q1_2025, digiday_monthly_annual_2023

| Ocena     | Przedział | Uwagi                                                                                         |
| --------- | --------- | --------------------------------------------------------------------------------------------- |
| optymalny | < 28      | odpowiada poniżej 2,7%/mies.                                                                  |
| dobry     | 28–35     |                                                                                               |
| normalny  | 35–45     | przeliczone mediany Mathera 3,53–4,62%/mies., czyli ok. 35–43% rocznie                        |
| słaby     | 45–58     | po 1. roku zostaje 46% subskrybentów miesięcznych (Piano 2021; kohorta nowych, nie cała baza) |
| krytyczny | ≥ 58      |                                                                                               |

**Kontekst:** News/media cyfrowe B2C – plany roczne (churn przy pierwszym odnowieniu) · okres: rocznie (na odnowienie) · metoda: Mediana Piano (2021) i zakres FTI Consulting (2022/23). Granice słaby/krytyczny to heurystyka. · źródła: digiday_monthly_annual_2023, reporterzy_dnr2025, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                          |
| --------- | --------- | -------------------------------------------------------------- |
| optymalny | < 20      | górny zakres FTI: 80% retencji po 52 tyg.                      |
| dobry     | 20–26     | mediana Piano 2021: po roku zostaje 74% subskrybentów rocznych |
| normalny  | 26–35     | FTI: 65–80%; Aftenposten: 71% nowych zostaje dłużej niż rok    |
| słaby     | 35–50     |                                                                |
| krytyczny | ≥ 50      | heurystyka                                                     |

**Kontekst:** SaaS / subskrypcje B2B SMB (plany miesięczne, karta) · okres: rocznie · metoda: Przeliczenie kwartyli i median miesięcznych (Recurly 2026, ChartMogul – dane historyczne XI 2021–I 2022) oraz średnia roczna Stripe 2024. · źródła: recurly_churn_benchmarks_2026, chartmogul_good_churn_2022, churnkey_involuntary_2025

| Ocena     | Przedział | Uwagi                                                                                                      |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| optymalny | < 20      | odpowiada górnemu kwartylowi Recurly (≤1,78%/mies.)                                                        |
| dobry     | 20–31     |                                                                                                            |
| normalny  | 31–43     | mediana Recurly SaaS 3,22%/mies. to ok. 32,5% rocznie; Stripe B2B: 38%                                     |
| słaby     | 43–55     | mediana ChartMogul przy ARPA < 25 USD: 6,1%/mies. (dane historyczne XI 2021–I 2022), czyli ok. 53% rocznie |
| krytyczny | ≥ 55      |                                                                                                            |

**Kontekst:** B2B mid-market (ACV ok. 12–100 tys. USD) · okres: rocznie · metoda: Heurystyka zakotwiczona w churnie ARR według długości umowy (KeyBanc 2024: dane churnu za 2023; mediana ARR próby 22,5 mln USD w 2022 i 26 mln USD w 2023) i medianach GRR według ACV (SaaS Capital 2025). · źródła: keybanc_sapphire_2024, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                                                                |
| --------- | --------- | ------------------------------------------------------------------------------------ |
| optymalny | < 6       |                                                                                      |
| dobry     | 6–10      | churn ARR przy umowach rocznych: 10%; ogółem: 7% (KeyBanc 2024; dane churnu za 2023) |
| normalny  | 10–15     | mediana GRR 90–91% oznacza 9–10% utraty przychodu brutto (SaaS Capital)              |
| słaby     | 15–22     |                                                                                      |
| krytyczny | ≥ 22      |                                                                                      |

**Kontekst:** B2B enterprise (ACV powyżej 100 tys. USD, umowy wieloletnie) · okres: rocznie · metoda: Heurystyka zakotwiczona w KeyBanc 2024 (churn według długości kontraktu, dane za 2023) i SaaS Capital 2025 (GRR według ACV). · źródła: keybanc_sapphire_2024, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                 |
| --------- | --------- | ------------------------------------- |
| optymalny | < 3       | churn ARR przy umowach 3+ letnich: 3% |
| dobry     | 3–5       | GRR 95% dla ACV powyżej 250 tys. USD  |
| normalny  | 5–8       | churn ARR przy umowach 2-letnich: 6%  |
| słaby     | 8–12      |                                       |
| krytyczny | ≥ 12      |                                       |

**Kontekst:** Członkostwa / memberships (stowarzyszenia, kluby, płatne członkostwo think tanku) · okres: rocznie · metoda: Mediany MGI (2025 i 2026) jako środek przedziału 'normalny'. Pozostałe granice to heurystyka oparta na zakresach i4a. · źródła: mgi_2025_memberjungle, mgi_2026_i4a

| Ocena     | Przedział | Uwagi                                                          |
| --------- | --------- | -------------------------------------------------------------- |
| optymalny | < 10      | odnowienia 90%+ (top stowarzyszeń branżowych według i4a)       |
| dobry     | 10–15     |                                                                |
| normalny  | 15–20     | mediana MGI: 84% odnowień (2025) i 82% (2026)                  |
| słaby     | 20–28     | poziom churnu nowych członków (odnowienia po 1. roku 72–74%)   |
| krytyczny | ≥ 28      | w zakresie typowym dla non-profit (60–75% odnowień według i4a) |

**Zastrzeżenia:**

- Benchmarki MGI dotyczą głównie stowarzyszeń w USA. Członkostwo w think tanku z wydarzeniami i klubami jest bliższe towarzystwom zawodowym (typowo 75–85% odnowień według i4a).
- Dane MGI 2026 (82%/72%) pochodzą ze źródła wtórnego (i4a), bo oryginalnego raportu nie udało się otworzyć.
- Długie promocje (np. 52 tygodnie) przesuwają churn na moment powrotu do pełnej ceny. Według Mathera (Q2 2025, 86 marek) nawet najlepsza spośród promocji kohorta 52-tygodniowa ma ok. 33% aktywnych w 80. tygodniu.
- Planów miesięcznych i rocznych nie łącz w jednej liczbie bez wagi przychodowej. Raportuj je osobno.

### GRC (gross MRR churn): Churn przychodowy brutto (revenue churn) (Gross revenue churn (gross MRR churn))

- **Rozwinięcie:** GRC – Gross Revenue Churn: utrata przychodu powtarzalnego (MRR – Monthly Recurring Revenue, ARR – Annual Recurring Revenue) przez rezygnacje i obniżki planów, bez uwzględniania rozszerzeń. / GRC – Gross Revenue Churn: loss of recurring revenue (MRR – Monthly Recurring Revenue, ARR – Annual Recurring Revenue) from cancellations and downgrades, excluding expansion.
- **Wzór:** (MRR utracony przez anulacje + MRR utracony przez downgrade lub nowe rabaty) w okresie, podzielony przez MRR na początku okresu, × 100%. Dla B2B w ujęciu rocznym: GRC = 1 − GRR.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jaka część powtarzalnego przychodu z istniejących klientów znika przez rezygnacje i obniżki planów, zanim zadziałają upselle. Uzupełnia logo churn: jeśli odchodzą głównie mali klienci, churn przychodowy jest niższy od logo churnu, i odwrotnie. Typowe pułapki: podwyżki cen przy odnowieniu maskują odpływ klientów. Jednorazowe przychody (wydarzenia, sponsoring, raporty na zamówienie) nie powinny trafiać do MRR.
- **Interpretation (EN):** Shows what share of recurring revenue from existing customers is lost to cancellations and downgrades before any upsell. It complements logo churn: if mainly small customers leave, revenue churn is lower than logo churn, and vice versa. Common pitfalls: renewal price step-ups mask customer losses, and one-off revenue (events, sponsorship, commissioned reports) must not be booked as MRR.

**Kontekst:** B2B SaaS / subskrypcje instytucjonalne (ARR, ujęcie roczne) · okres: rocznie · metoda: Kwartyle GRR z KeyBanc 2024 (P25 82, mediana 89–91, P75 93–95) i Aleph×Benchmarkit CY2025 (76/84/91), przeliczone jako 1 − GRR. Kontrola: mediana SaaS Capital 2025 to 91%. Nowsza kontrola: KeyBanc/Sapphire 2025 (16. edycja, 13.11.2025) – mediana GRR spadła do 86% (2023) i ma zbliżać się do 90%, co wspiera granicę normalny/dobry przy GRC 12%. Progi bez zmian. · źródła: keybanc_sapphire_2024, aleph_benchmarkit_grr_2026, saascapital_retention_2025, keybanc_sapphire_2025

| Ocena     | Przedział | Uwagi                                                                                        |
| --------- | --------- | -------------------------------------------------------------------------------------------- |
| optymalny | < 8       | powyżej P75 GRR (91–95%)                                                                     |
| dobry     | 8–12      | między P50 a P75: mediana GRR 89–91% (KeyBanc 2024E, SaaS Capital 2025); Aleph sales-led 88% |
| normalny  | 12–18     | między P25 a P50: Aleph×Benchmarkit 84%, KeyBanc P25 82%                                     |
| słaby     | 18–25     | poniżej P25 (Aleph×Benchmarkit P25 GRR: 76%)                                                 |
| krytyczny | ≥ 25      | heurystyka                                                                                   |

**Kontekst:** B2C subskrypcje cyfrowe (niskie ARPA, MRR, ujęcie miesięczne) · okres: miesięcznie · metoda: Heurystyka: mediany logo churn news (Mather) powiększone o typowy downgrade. Górna granica według mediany gross MRR churn ChartMogul (2022) dla najniższego ARPA. · źródła: chartmogul_churn_cheatsheet_2022, mather_q3_2023, mather_q1_2025, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                                             |
| --------- | --------- | --------------------------------------------------------------------------------- |
| optymalny | < 3       |                                                                                   |
| dobry     | 3–4       |                                                                                   |
| normalny  | 4–5,5     | zbliżone do median logo churn news (3,5–4,6%) plus downgrade                      |
| słaby     | 5,5–8     |                                                                                   |
| krytyczny | ≥ 8       | mediana ChartMogul przy ARPA 0–10 USD to 8,9%/mies. (dane historyczne I–III 2022) |

**Zastrzeżenia:**

- Dane ChartMogul o gross MRR churn pochodzą z 2022 r. Nowszych median dla B2C nie znaleziono.
- Piano: podwyżka ceny przy odnowieniu o 15–20% obniżała retencję o 5–8%, a podnosiła przychód o 6–14%. Spadek GRC może więc współistnieć z rosnącym logo churnem.
- Mediany KeyBanc (n=52–55; mediana ARR próby 22,5 mln USD w 2022 i 26 mln USD w 2023) i Aleph×Benchmarkit (n=226, dużo firm AI/PLG) różnią się o 5–7 pp. Przedziały je uśredniają. W edycji 2025 KeyBanc/Sapphire mediana GRR za 2023 wynosi 86%.

### NRR (NDR): Retencja przychodu netto (Net Revenue Retention (Net Dollar Retention))

- **Rozwinięcie:** NRR – Net Revenue Retention, NDR – Net Dollar Retention: dwie nazwy tego samego wskaźnika. To przychód zachowany od istniejących klientów, łącznie z rozszerzeniami i podwyżkami, po odjęciu obniżek i odejść. / NRR – Net Revenue Retention, NDR – Net Dollar Retention: two names for the same metric. Revenue retained from existing customers including expansion and price increases, net of downgrades and churn.
- **Wzór:** (ARR na początku okresu + ARR z rozszerzeń, upsellu, cross-sellu i podwyżek − ARR z downgrade − ARR utracony przez odejścia), licząc tylko klientów obecnych na początku okresu, podzielone przez ARR na początku okresu, × 100%. Standardowe okno to 12 miesięcy (np. MRR w grudniu wobec grudnia roku poprzedniego).
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Mówi, ile przychodu z kohorty klientów sprzed 12 miesięcy masz dziś. Wartość powyżej 100% oznacza, że baza rośnie bez nowej sprzedaży. NRR silnie koreluje ze wzrostem: według SaaS Capital 2025 firmy z NRR 110–120% rosły o ok. 30% r/r, a z NRR 100–110% o 21%. Typowe pułapki: wskaźnik nie obejmuje nowych klientów i bywa zawyżany jednorazową podwyżką lub jednym dużym klientem. W B2C rzadko przekracza 100%, dlatego porównuj go tylko w obrębie segmentu i przy tym samym oknie.
- **Interpretation (EN):** Tells you how much of the revenue from the customer cohort of 12 months ago you still have today. Above 100% means the base grows without new sales. NRR is strongly tied to growth: per SaaS Capital 2025, companies with 110–120% NRR grew about 30% YoY versus 21% at 100–110%. Common pitfalls: it excludes new customers and can be inflated by a one-off price rise or a single large account. In B2C it rarely exceeds 100%, so compare it only within a segment and over the same window.

**Kontekst:** B2B SaaS / subskrypcje B2B – ogółem · okres: rocznie (okno 12M) · metoda: Kwartyle Aleph×Benchmarkit CY2025 (P25 92, P50 102, P75 108–110 – strona niespójna), zweryfikowane z KeyBanc 2024E (96/101/109) i medianą SaaS Capital 2025 (101%). Granicę 'optymalny' pozostawiono na 110 (zbieżna z KeyBanc 109 i SaaS Capital). KeyBanc/Sapphire 2025: NRR nadal 'above 100%'. · źródła: aleph_benchmarkit_nrr_2026, keybanc_sapphire_2024, saascapital_retention_2025, keybanc_sapphire_2025

| Ocena     | Przedział | Uwagi                                                                                               |
| --------- | --------- | --------------------------------------------------------------------------------------------------- |
| krytyczny | < 85      | heurystyka; firmy z NRR poniżej 90% rosły w medianie o 15% (SaaS Capital)                           |
| słaby     | 85–92     | poniżej P25 (Aleph×Benchmarkit CY2025: 92%)                                                         |
| normalny  | 92–102    | P25–P50; mediana 101–102% (SaaS Capital, KeyBanc, Aleph×Benchmarkit)                                |
| dobry     | 102–110   | P50–P75                                                                                             |
| optymalny | ≥ 110     | powyżej P75 (Aleph×Benchmarkit P75 108–110% – strona podaje raz 110%, raz 108%; KeyBanc 2024E 109%) |

**Kontekst:** B2B ACV poniżej 12 tys. USD (SMB; typowe abonamenty instytucjonalne think tanku) · okres: rocznie (okno 12M) · metoda: Kwartyle SaaS Capital 2025 dla ACV < 12 tys. USD (P25 90, P50 98, P75 106). · źródła: saascapital_retention_2025, aleph_benchmarkit_nrr_2026

| Ocena     | Przedział | Uwagi                                                                      |
| --------- | --------- | -------------------------------------------------------------------------- |
| krytyczny | < 85      | heurystyka                                                                 |
| słaby     | 85–90     | poniżej P25 (90%)                                                          |
| normalny  | 90–98     | P25–P50; mediana 98% (Aleph×Benchmarkit dla ACV < 5 tys. USD: również 98%) |
| dobry     | 98–106    | P50–P75                                                                    |
| optymalny | ≥ 106     | powyżej P75 (106%)                                                         |

**Kontekst:** B2B mid-market (ACV 12–100 tys. USD) · okres: rocznie (okno 12M) · metoda: Uśrednione kwartyle SaaS Capital 2025: ACV 12–25 tys. (98/103/115), 25–50 tys. (97/102/111) i 50–100 tys. USD (96/104/110). · źródła: saascapital_retention_2025

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | < 90      | heurystyka                 |
| słaby     | 90–97     | poniżej P25 (96–98%)       |
| normalny  | 97–103    | P25–P50 (mediany 102–104%) |
| dobry     | 103–111   | P50–P75                    |
| optymalny | ≥ 111     | powyżej P75 (110–115%)     |

**Kontekst:** B2B enterprise (ACV powyżej 100 tys. USD) · okres: rocznie (okno 12M) · metoda: Kwartyle SaaS Capital 2025: ACV 100–250 tys. (94/102/109) i powyżej 250 tys. USD (102/106/110). · źródła: saascapital_retention_2025

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | < 92      | heurystyka                 |
| słaby     | 92–98     | poniżej P25 (94–102%)      |
| normalny  | 98–104    | P25–P50 (mediany 102–106%) |
| dobry     | 104–110   | P50–P75                    |
| optymalny | ≥ 110     | powyżej P75 (109–110%)     |

**Kontekst:** B2C subskrypcje cyfrowe (niskie ARPA) · okres: rocznie (okno 12M) · metoda: Mediana NRR B2C SaaS z ChartMogul AI Retention Report (dane 2025: 49%; dla porównania B2B SaaS 82%) i górny kwartyl ChartMogul 2023 (65,1% przy ARPA < 10 USD/mies.; tylko 2,7% takich firm przekracza 100%). Pozostałe granice to heurystyka; pewność niska. · źródła: chartmogul_ai_retention_2025, chartmogul_retention_report_2023, mather_q3_2023, mather_q1_2025, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                                                                                                                  |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | < 40      | heurystyka                                                                                                                                             |
| słaby     | 40–50     | heurystyka                                                                                                                                             |
| normalny  | 50–65     | mediana ChartMogul 2025 dla B2C SaaS: 49% (na granicy słaby/normalny); wydawca z churnem ok. 3,8–4,6%/mies. i podwyżkami przy odnowieniu ma ok. 57–65% |
| dobry     | 65–80     | górny kwartyl ChartMogul 2023 przy ARPA < 10 USD: 65,1%                                                                                                |
| optymalny | ≥ 80      | osiągalne przy podwyżkach przy odnowieniu i niskim churnie                                                                                             |

**Zastrzeżenia:**

- Wysoka pewność dotyczy kontekstów B2B (SaaS Capital, KeyBanc, Aleph×Benchmarkit). Kontekst B2C to heurystyka o niskiej pewności.
- Mediany różnią się metodyką: SaaS Capital liczy na MRR grudzień do grudnia, KeyBanc na ARR. Aleph×Benchmarkit pokazuje, że model cenowy usage-based ma medianę 108%, a seat-based 98%.
- Dla think tanku NRR B2B rośnie głównie przez dodatkowe licencje, pakiety wydarzeń i raporty w abonamencie. Jednorazowe sponsoringi nie powinny podnosić NRR.
- ChartMogul AI Retention Report (2025) obejmuje firmy z co najmniej 250 tys. USD ARR; mediana B2C SaaS 49% to najnowszy publiczny punkt odniesienia dla B2C.
- SaaS Capital 2025: dane według ACV i kwartyle wykluczają firmy poniżej 1 mln USD ARR; okno pomiaru to MRR XII 2023 → XII 2024 (dane za 2024, publikacja 18.09.2025).

### GRR (GDR): Retencja przychodu brutto (Gross Revenue Retention (Gross Dollar Retention))

- **Rozwinięcie:** GRR – Gross Revenue Retention, GDR – Gross Dollar Retention: przychód zachowany od istniejących klientów po odjęciu odejść i obniżek, bez rozszerzeń. Maksimum to 100%. / GRR – Gross Revenue Retention, GDR – Gross Dollar Retention: revenue kept from existing customers after churn and downgrades, excluding expansion. Capped at 100%.
- **Wzór:** (ARR na początku okresu − ARR utracony przez odejścia − ARR utracony przez downgrade) / ARR na początku okresu × 100%. Rozszerzeń, upsellu i podwyżek nie wliczasz, więc wynik nie przekracza 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Odsetek przychodu powtarzalnego zachowanego po odjęciu odejść i obniżek, bez upselli. To miara 'szczelności' bazy i jakości produktu oraz obsługi. SaaS Capital traktuje GRR co najmniej 90% jako warunek konieczny ('table stakes') porównywalnych wyników w B2B. Typowe pułapki: wynik powyżej 100% oznacza, że liczysz NRR. W umowach wieloletnich odpływ ujawnia się skokowo przy końcu kontraktu, więc patrz na trend z kilku lat.
- **Interpretation (EN):** Share of recurring revenue kept after churn and downgrades, ignoring upsell. It measures how 'leak-proof' the base is and reflects product and service quality. SaaS Capital treats GRR of at least 90% as table stakes for peer-level B2B performance. Common pitfalls: a result above 100% means you are computing NRR, and with multi-year contracts losses show up in steps at contract end, so read the multi-year trend.

**Kontekst:** B2B SaaS / subskrypcje B2B – ogółem · okres: rocznie · metoda: Kwartyle Aleph×Benchmarkit CY2025 (76/84/91) i KeyBanc 2024E (82/91/95) oraz mediana SaaS Capital 2025 (91%). Nowsza kontrola: KeyBanc/Sapphire 2025 (16. edycja, 13.11.2025) – mediana GRR spadła do 86% (2023) i ma zbliżać się do 90%. Progi bez zmian. · źródła: aleph_benchmarkit_grr_2026, keybanc_sapphire_2024, saascapital_retention_2025, keybanc_sapphire_2025

| Ocena     | Przedział | Uwagi                                                           |
| --------- | --------- | --------------------------------------------------------------- |
| krytyczny | < 75      | heurystyka; poniżej dolnego kwartyla Aleph×Benchmarkit          |
| słaby     | 75–82     | P25: 76% (Aleph×Benchmarkit), 82% (KeyBanc)                     |
| normalny  | 82–88     | P25–P50: mediana 84% (Aleph×Benchmarkit CY2025), sales-led 88%  |
| dobry     | 88–92     | mediana 89–91% (KeyBanc, SaaS Capital); próg 90% 'table stakes' |
| optymalny | ≥ 92      | P75: 91% (Aleph×Benchmarkit), 93–95% (KeyBanc)                  |

**Kontekst:** B2B ACV poniżej 12 tys. USD (SMB, abonamenty instytucjonalne) · okres: rocznie · metoda: Mediany SaaS Capital 2025 i Aleph×Benchmarkit CY2025 dla najniższych ACV. Granice to heurystyka, bo kwartyli dla tego przedziału nie publikowano. · źródła: saascapital_retention_2025, aleph_benchmarkit_grr_2026

| Ocena     | Przedział | Uwagi                                                 |
| --------- | --------- | ----------------------------------------------------- |
| krytyczny | < 72      | heurystyka                                            |
| słaby     | 72–80     | mediana dla ACV < 5 tys. USD: 80% (Aleph×Benchmarkit) |
| normalny  | 80–88     |                                                       |
| dobry     | 88–92     | mediana SaaS Capital dla ACV < 12 tys. USD: 90%       |
| optymalny | ≥ 92      |                                                       |

**Kontekst:** B2B enterprise (ACV powyżej 100 tys. USD) · okres: rocznie · metoda: Mediany SaaS Capital 2025 według ACV i górny kwartyl KeyBanc 2024. Skrajne granice to heurystyka. · źródła: saascapital_retention_2025, keybanc_sapphire_2024, aleph_benchmarkit_grr_2026

| Ocena     | Przedział | Uwagi                                                                          |
| --------- | --------- | ------------------------------------------------------------------------------ |
| krytyczny | < 85      |                                                                                |
| słaby     | 85–90     |                                                                                |
| normalny  | 90–93     | mediana 91% (ACV 100–250 tys. USD); Aleph×Benchmarkit dla 50–100 tys. USD: 91% |
| dobry     | 93–96     | mediana 95% (ACV powyżej 250 tys. USD); P75 KeyBanc 93–95%                     |
| optymalny | ≥ 96      |                                                                                |

**Kontekst:** B2C subskrypcje cyfrowe (niskie ARPA) · okres: rocznie · metoda: Górny kwartyl GRR ChartMogul 2023 dla ARPA < 50 USD/mies. (60–70%) wyznacza przedział 'dobry', a jego górna granica (70%) próg 'optymalny' (konwencja P75 = próg 'optymalny'). Mediany churnu news Mather (3,8–4,62%/mies.) przeliczone na rok dają GRR ok. 57–63%. Heurystyka, pewność niska. · źródła: chartmogul_retention_report_2023, chartmogul_ai_retention_2025, mather_q3_2023, mather_q1_2025

| Ocena     | Przedział | Uwagi                                                                                          |
| --------- | --------- | ---------------------------------------------------------------------------------------------- |
| krytyczny | < 40      | heurystyka; ChartMogul 2025: GRR AI-native < 50 USD to 23%, 'o 20 pkt gorzej' niż SaaS B2B/B2C |
| słaby     | 40–50     | heurystyka                                                                                     |
| normalny  | 50–60     | mediany churnu news (3,8–4,62%/mies.) dają GRR ok. 57–63%                                      |
| dobry     | 60–70     | górny kwartyl ChartMogul 2023 przy ARPA < 50 USD: 60–70%                                       |
| optymalny | ≥ 70      | od górnej granicy górnego kwartyla ChartMogul 2023 (70%)                                       |

**Zastrzeżenia:**

- Aleph×Benchmarkit (CY2025) pokazuje spadek mediany GRR z 88% do 84%, a KeyBanc (2024E) 91%. Różnica wynika z próby: Aleph×Benchmarkit ma więcej firm PLG i AI-native, KeyBanc więcej firm z dużą sprzedażą enterprise.
- Kontekst B2C to heurystyka (pewność niska). Mediany churnu news (3,8–4,62%/mies.) odpowiadają GRR ok. 57–63%, czyli granicy normalny/dobry.
- SaaS Capital: umowy wieloletnie mają GRR 94%, roczne 90%, a miesięczne 89%. Długość kontraktu w ofercie B2B think tanku istotnie wpływa na GRR.
- KeyBanc/Sapphire 2025 (13.11.2025): mediana GRR za 2023 to 86% (wobec 89% w edycji 2024), z oczekiwanym powrotem w okolice 90%.
- SaaS Capital 2025: mediany według ACV wykluczają firmy poniżej 1 mln USD ARR; okno pomiaru to MRR XII 2023 → XII 2024 (dane za 2024).

### Invol. churn %: Udział churnu mimowolnego (Involuntary churn share)

- **Rozwinięcie:** Churn mimowolny (involuntary, pasywny) to utrata subskrypcji wskutek nieudanej płatności (wygasła lub zablokowana karta, brak środków, odmowa banku), a nie decyzji klienta. / Involuntary (passive) churn is losing a subscription because a payment failed (expired or blocked card, insufficient funds, bank decline), not because the customer chose to leave.
- **Wzór:** Subskrypcje zakończone z powodu nieodzyskanej płatności w okresie / wszystkie subskrypcje zakończone w okresie × 100%. Uzupełniająco: miesięczny churn mimowolny = odejścia z powodu płatności / baza płacących na początku miesiąca.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jaka część odejść wynika z nieudanych płatności, a nie z decyzji klienta. Wysoki udział to zwykle problem operacyjny (ponowienia, aktualizacja kart, przypomnienia), który naprawia się szybciej i taniej niż wartość produktu. Typowe pułapki: przy płatnościach bez automatycznego odnowienia (przelew, jednorazowy BLIK, faktura) churn mimowolny 'przebiera się' za brak odnowienia. Niski udział może też wynikać po prostu z bardzo wysokiego churnu dobrowolnego.
- **Interpretation (EN):** Shows what part of churn comes from failed payments rather than customer decisions. A high share is usually an operational problem (retries, card updating, reminders) that is faster and cheaper to fix than product value. Common pitfalls: with non-recurring payment methods (bank transfer, one-off BLIK, invoices) involuntary churn masquerades as non-renewal, and a low share may simply reflect very high voluntary churn.

**Kontekst:** News/media cyfrowe B2C (płatności kartowe cykliczne) · okres: miesięcznie lub kwartalnie (udział w odejściach okresu) · metoda: Rozkład udziałów z Piano (2024 i 2026; udział pasywny wyliczony z podanego udziału churnu aktywnego), Recurly 2026 (wyliczone: mimowolny / całkowity), Stripe 2024 (via Churnkey) i przypadków wydawców (WAN-IFRA 2018). · źródła: piano_benchmarks_2024, piano_benchmark_update_2026, recurly_churn_benchmarks_2026, churnkey_involuntary_2025, twipe_wanifra_2018

| Ocena     | Przedział | Uwagi                                                                                                                                                                    |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| optymalny | < 15      |                                                                                                                                                                          |
| dobry     | 15–22     | Boston Globe obniżył udział z 50% do 20% (2018)                                                                                                                          |
| normalny  | 22–32     | Piano 2024: 29% churnu pasywnego; Stripe: digital goods 29%, B2C 24%; Piano 2026: ok. 25% w serwisach z aktywną prewencją churnu (wyliczone: 100 − 75% churnu aktywnego) |
| słaby     | 32–45     | Recurly digital media: 1,59/4,14 ≈ 38%; Piano 2026: ok. 42% w serwisach bez aktywnej prewencji (wyliczone: 100 − 58% churnu aktywnego)                                   |
| krytyczny | ≥ 45      | Seattle Times: 62% churnu cyfrowego to awarie kart (2018)                                                                                                                |

**Kontekst:** B2B SaaS / subskrypcje B2B (karta) · okres: miesięcznie lub kwartalnie · metoda: Średnie Stripe 2024 (via Churnkey) według modelu i AOV (średniej wartości zamówienia) oraz udziały wyliczone z median Recurly 2026. Granice to heurystyka. · źródła: churnkey_involuntary_2025, recurly_churn_benchmarks_2026

| Ocena     | Przedział | Uwagi                                                                                                 |
| --------- | --------- | ----------------------------------------------------------------------------------------------------- |
| optymalny | < 10      | Recurly ARPC powyżej 250 USD: 0,18/3,07–3,54 ≈ 5–6% (strona podaje łączny churn raz 3,07%, raz 3,54%) |
| dobry     | 10–16     | Stripe: B2B 16%, AOV (średnia wartość zamówienia) 1–10 tys. USD 15%                                   |
| normalny  | 16–24     | Stripe: SaaS 22%                                                                                      |
| słaby     | 24–35     | Recurly SaaS: 1,06/3,22 ≈ 33%                                                                         |
| krytyczny | ≥ 35      | heurystyka; Stripe: AOV (średnia wartość zamówienia) poniżej 10 USD 35%                               |

**Zastrzeżenia:**

- Recurly (2026) szacuje udział churnu mimowolnego na 20–40% całego churnu. Rozrzut zależy od metod płatności i ceny.
- W Polsce popularne są BLIK, przelew i faktura. Bez tokenizacji karty lub cyklicznego BLIK churn mimowolny trzeba mierzyć jako 'nieopłacone odnowienie' albo 'przeterminowana faktura'. Publicznego benchmarku PL brak.
- Dane WAN-IFRA (Seattle Times, Boston Globe) są z 2018 r. i mają charakter historyczny.

### Recovery rate: Skuteczność odzyskiwania nieudanych płatności (dunning recovery rate) (Dunning (failed-payment) recovery rate)

- **Rozwinięcie:** Dunning to proces odzyskiwania nieudanych płatności cyklicznych: ponowienia obciążeń (retries), automatyczna aktualizacja kart (account updater), e-maile i SMS-y oraz komunikat w produkcie. / Dunning is the process of recovering failed recurring payments: charge retries, card account updater, emails/SMS and in-product payment walls.
- **Wzór:** Wartość (lub liczba) nieudanych płatności cyklicznych odzyskanych w oknie odzyskiwania (np. 30 dni) / wartość (lub liczba) wszystkich nieudanych płatności cyklicznych w tym okresie × 100%. Licz kohortowo po zamknięciu okna i podawaj, czy liczysz po wartości, czy po liczbie.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Odsetek nieudanych płatności cyklicznych odzyskanych przed utratą subskrypcji. Według Recurly ok. 90% odzysków następuje w pierwszych 10 dniach, więc liczy się szybkość i inteligentne terminy ponowień. Typowe pułapki: dostawcy liczą różnie (wartość lub liczba, okno 14/30/60 dni, czy wliczać 'miękkie' odmowy rozwiązane przed kontaktem z klientem). Porównuj tylko przy tej samej definicji.
- **Interpretation (EN):** Share of failed recurring payments recovered before the subscription is lost. Per Recurly about 90% of recoveries happen in the first 10 days, so speed and smart retry timing matter. Common pitfalls: vendors define it differently (value vs count, 14/30/60-day window, whether soft declines resolved before contacting the customer count), so compare only like-for-like definitions.

**Kontekst:** Subskrypcje kartowe B2C i B2B (wszystkie metody łącznie: retries, account updater, e-mail/SMS, komunikat w produkcie) · okres: miesięcznie (kohorta nieudanych płatności, okno 30 dni) · metoda: Średnie deklarowane przez dostawców (Stripe, Churnkey/Stripe 2024), zakresy Recurly 2026 oraz przypadki: FT (2025) i duży detalista enterprise u Recurly (71%). Granice słaby/krytyczny to heurystyka. · źródła: stripe_billing, churnkey_involuntary_2025, recurly_failed_payment_2026, ftstrategies_retention_2025, churnkey_sor_2025

| Ocena     | Przedział | Uwagi                                                                                                                                                                                      |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | < 30      | heurystyka: brak inteligentnych ponowień lub komunikacji                                                                                                                                   |
| słaby     | 30–45     | heurystyka; poniżej poziomu samych domyślnych ponowień                                                                                                                                     |
| normalny  | 45–60     | Stripe: średnio 55%; same Smart Retries 51%; punkt wyjścia 'low-to-mid 50s' (Recurly)                                                                                                      |
| dobry     | 60–70     | FT: 66%                                                                                                                                                                                    |
| optymalny | ≥ 70      | Recurly: 71% po optymalizacji to jeden przypadek dużego detalisty enterprise, a nie średnia; osiągalny poziom według Recurly 'high 60s to low 70s'; Churnkey: ok. 70% przy trzech metodach |

**Zastrzeżenia:**

- Prawie wszystkie liczby pochodzą od dostawców narzędzi (Stripe, Recurly, Churnkey) i są deklaracjami bez pełnej metodologii.
- Churnkey (State of Retention 2025): kampanie e-mail/SMS same w sobie odzyskują średnio 42%.
- Dla faktur B2B (przelew) zamiast tego wskaźnika licz odsetek faktur opłaconych w ciągu 30/60 dni od terminu.
- Publicznych benchmarków dla polskich operatorów płatności (PayU, Przelewy24, cykliczny BLIK) nie znaleziono.
- Stripe: w 2025 r. odzyskano 8,2 mld USD nieudanych płatności (wartość bezwzględna, nie wskaźnik odzysku).

### Save rate: Wskaźnik zatrzymań w ścieżce anulowania (save rate) (Cancellation-flow save rate)

- **Rozwinięcie:** Save rate to odsetek osób, które rozpoczęły rezygnację (cancellation flow) i zostały zatrzymane ofertą: pauzą, downgrade'em, rabatem lub zmianą planu. / Save rate is the share of people who started cancelling (cancellation flow) and were retained by an offer: pause, downgrade, discount or plan change.
- **Wzór:** Sesje anulowania zakończone przyjęciem oferty, po których klient jest nadal aktywny po 30 (lub 60) dniach / wszystkie rozpoczęte sesje anulowania × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Odsetek osób w ścieżce rezygnacji zatrzymanych ofertą. Mierzy jakość ścieżki anulowania i dopasowanie ofert do powodów odejścia. Typowe pułapki: osoby zatrzymane rabatem często odchodzą przy kolejnym odnowieniu, więc licz save rate netto (aktywni po 60–90 dniach) razem z kosztem w ARPU. Utrudnianie rezygnacji (dark patterns) podnosi wskaźnik krótkoterminowo, ale niesie ryzyko prawne i reputacyjne.
- **Interpretation (EN):** Share of people in the cancellation flow who were retained by an offer. It measures the quality of the cancel flow and how well offers match churn reasons. Common pitfalls: discount-saved customers often leave at the next renewal, so track net save rate (still active after 60–90 days) together with its ARPU cost. Making cancellation hard (dark patterns) inflates the rate short-term but carries legal and reputational risk.

**Kontekst:** News/media cyfrowe B2C (samoobsługowe anulowanie online) · okres: miesięcznie (kohorta sesji anulowania) · metoda: Punkty odniesienia wydawców: FT (2025), Piano (2024) i Star Tribune (case study ProsperStack). Granice łączą te wartości. · źródła: ftstrategies_retention_2025, piano_benchmarks_2024, prosperstack_startribune

| Ocena     | Przedział | Uwagi                                                                |
| --------- | --------- | -------------------------------------------------------------------- |
| krytyczny | < 3       | poziom FT przed przebudową ścieżki (3%); Piano: sama ankieta daje 0% |
| słaby     | 3–6       |                                                                      |
| normalny  | 6–12      | FT po przebudowie: 6%; Piano: oferta downgrade 6–16%                 |
| dobry     | 12–18     | Piano: do 16% zatrzymanych                                           |
| optymalny | ≥ 18      | Star Tribune: 18,5% po 15 testach A/B                                |

**Kontekst:** SaaS i aplikacje subskrypcyjne z dedykowanym narzędziem cancel flow (B2C, B2B SMB) · okres: miesięcznie · metoda: Heurystyka (pewność niska). Brak niezależnych danych o save rate netto (aktywni po 30–60 dniach). Churnkey podaje tylko wartości łączne (ok. 3 mln sesji anulowania, 'nearly two million' uratowanych subskrypcji; ratowanie 20–40% przychodu zagrożonego churnem). Te proporcje nie są save rate w sensie definicji wskaźnika, więc nie kotwiczą progów. · źródła: churnkey_sor_2025

| Ocena     | Przedział | Uwagi                                                               |
| --------- | --------- | ------------------------------------------------------------------- |
| krytyczny | < 5       |                                                                     |
| słaby     | 5–10      |                                                                     |
| normalny  | 10–20     |                                                                     |
| dobry     | 20–30     |                                                                     |
| optymalny | ≥ 30      | heurystyka (pewność niska); brak publicznej kotwicy save rate netto |

**Zastrzeżenia:**

- Kontekst SaaS/aplikacje to heurystyka bez kotwicy w danych (pewność niska). Kontekst news opiera się na zweryfikowanych, ale pojedynczych punktach odniesienia (FT 3% → 6%, Piano 6–16%, Star Tribune 18,5%).
- Churnkey: wśród przyjętych ofert dominują rabaty (53–54%; strona podaje 53,9% i 53%), pauza to ok. 19%, a zmiana planu ok. 7%. Rabaty obniżają ARPU, więc mierz też przychód netto z zatrzymanych.
- Prawo UE i PL ogranicza utrudnianie rezygnacji (zakaz dark patterns, np. art. 25 DSA dla platform; prawo konsumenckie, UOKiK). Ścieżkę anulowania warto skonsultować z prawnikiem.
- Według Recurly użycie pauzy wzrosło o 337% u czołowych sprzedawców (strona nie podaje okresu ani bazy porównania). Pauzę warto mierzyć osobno (odsetek powrotów po pauzie).

### Winback rate: Wskaźnik odzyskania byłych klientów (winback / reaktywacja w 12 mies.) (Winback (reactivation) rate within 12 months)

- **Rozwinięcie:** Winback to odzyskanie klienta, który odszedł. Reaktywacja to ponowny zakup płatnej subskrypcji przez byłego subskrybenta. / Winback means recovering a churned customer. Reactivation is a former subscriber buying a paid subscription again.
- **Wzór:** Byli subskrybenci z kohorty odejść w miesiącu M, którzy ponownie wykupili płatną subskrypcję w ciągu 12 miesięcy / liczba odejść w kohorcie M × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, jaki odsetek osób, które odeszły w danym miesiącu, wraca do płatnej subskrypcji w ciągu roku. Byli subskrybenci to często największa pula potencjalnych klientów: według INMA (wartość niezweryfikowana, strona zwraca HTTP 403) mediana marka newsowa straciła 1,7 raza więcej subskrypcji, niż ma aktywnych. Typowe pułapki: powroty na głęboki rabat i 'seryjni churnerzy' zawyżają wynik, więc raportuj osobno powracających, którzy płacą pełną cenę po promocji.
- **Interpretation (EN):** Shows what share of a month's churned customers return to a paid subscription within a year. Former subscribers are often the biggest prospect pool: per INMA (unverified, the page returns HTTP 403) the median news brand has lost 1.7x more subscriptions than it has active. Common pitfalls: returns on deep discounts and serial churners inflate the rate, so report separately those who pay full price after the promo.

**Kontekst:** Subskrypcje cyfrowe B2C – plany miesięczne · okres: kohorta odejść; okno do 12 mies. · metoda: Średnia RevenueCat SOSA 2026 (20,1%) jako granica normalny/dobry, poziom drogich planów miesięcznych (28,9%) jako próg 'optymalny'. Wartość SOSA 2025 (13,7%) mieści się w przedziale 'normalny'. Granice poniżej średniej to heurystyka. · źródła: revenuecat_reactivation_2026

| Ocena     | Przedział | Uwagi                                                                   |
| --------- | --------- | ----------------------------------------------------------------------- |
| krytyczny | < 6       | heurystyka                                                              |
| słaby     | 6–12      | heurystyka                                                              |
| normalny  | 12–20     | RevenueCat SOSA 2025: 13,7% (poprzedni poziom średni)                   |
| dobry     | 20–28     | RevenueCat SOSA 2026: 20,1% (typowo 18–24%) jako granica normalny/dobry |
| optymalny | ≥ 28      | drogie plany miesięczne: 28,9%; kategoria produktywności: 36,1%         |

**Kontekst:** Subskrypcje cyfrowe B2C – plany roczne · okres: kohorta odejść; okno do 12 mies. · metoda: Zakres typowy RevenueCat (SOSA 2026). Pozostałe granice to heurystyka. · źródła: revenuecat_reactivation_2026

| Ocena     | Przedział | Uwagi                                       |
| --------- | --------- | ------------------------------------------- |
| krytyczny | < 2       |                                             |
| słaby     | 2–4       |                                             |
| normalny  | 4–6       | RevenueCat: typowo 4–6% dla planów rocznych |
| dobry     | 6–9       |                                             |
| optymalny | ≥ 9       |                                             |

**Kontekst:** B2B SaaS (logo; kohorta odejść) · okres: kohorta odejść; okno niezdefiniowane w źródle (porównuj z oknem do 12 mies.) · metoda: Heurystyka wokół median winback rate według ARR (ChartMogul, The SaaS Winbacks Report 2026: 7/9/11/13%). Raport nie definiuje okna ani mianownika; mediana czasu powrotu to 38 dni, 66% powracających wraca w ciągu 90 dni, ok. 10% po roku. Pewność niska. · źródła: chartmogul_saas_winbacks_2026

| Ocena     | Przedział | Uwagi                                                            |
| --------- | --------- | ---------------------------------------------------------------- |
| krytyczny | < 4       | heurystyka                                                       |
| słaby     | 4–7       | heurystyka                                                       |
| normalny  | 7–10      | mediany ChartMogul: ARR < 500 tys. USD 7%, ARR 0,5–10 mln USD 9% |
| dobry     | 10–13     | mediana ChartMogul przy ARR 10–30 mln USD: 11%                   |
| optymalny | ≥ 13      | mediana ChartMogul przy ARR > 30 mln USD: 13%                    |

**Zastrzeżenia:**

- RevenueCat dotyczy aplikacji mobilnych i web i nie podaje okna czasowego reaktywacji. Dla wydawców news brak publicznego benchmarku winback.
- INMA w modelowaniu użyło miesięcznej reaktywacji 4,8% zaczerpniętej z telekomunikacji, a nie z danych wydawców. Wartość niezweryfikowana (strona zwraca HTTP 403, potwierdzone ponownie).
- Do deduplikacji 'byłych' klientów potrzebna jest identyfikacja osoby (e-mail, login, token karty) w CRM.
- Wartości INMA (1,7x, ok. 21 mies., 136 marek) są niezweryfikowane (HTTP 403); nie opiera się na nich żadna granica przedziału.
- ChartMogul (The SaaS Winbacks Report, 2026) nie definiuje okna ani mianownika winback rate, więc kontekst B2B SaaS to heurystyka o niskiej pewności.

### Returning share: Udział powracających w nowych subskrypcjach (Returning subscribers' share of new sign-ups)

- **Rozwinięcie:** Odsetek nowych płatnych aktywacji pochodzących od byłych subskrybentów (reaktywacje) wśród wszystkich nowych aktywacji. / Share of new paid activations that come from former subscribers (reactivations) among all new activations.
- **Wzór:** Nowe płatne aktywacje od osób, które wcześniej miały płatną subskrypcję / wszystkie nowe płatne aktywacje w okresie × 100%.
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, jaka część nowej sprzedaży pochodzi od byłych subskrybentów. Umiarkowany udział świadczy o skutecznym winbacku, a bardzo wysoki o uzależnieniu od 'seryjnych churnerów' i słabej akwizycji nowych osób. Typowe pułapki: wskaźnik wymaga deduplikacji osób między kontami, bez niej jest zaniżony. Porównuj go razem z churnem i ceną płaconą przez powracających.
- **Interpretation (EN):** Shows how much of new sales comes from former subscribers. A moderate share signals effective winback, while a very high one signals dependence on serial churners and weak acquisition of new people. Common pitfalls: it needs cross-account identity deduplication (otherwise it is understated); read it together with churn and the price returning users pay.

**Kontekst:** Subskrypcje cyfrowe B2C (media, news, treści eksperckie) · okres: miesięcznie lub kwartalnie · metoda: Średnia sieci Recurly (State of Subscriptions 2026, wszystkie branże) jako środek przedziału docelowego. Pozostałe granice to heurystyka. · źródła: recurly_sos_2026

| Ocena     | Przedział | Uwagi                                                            |
| --------- | --------- | ---------------------------------------------------------------- |
| słaby     | < 10      | niewykorzystana pula byłych klientów                             |
| normalny  | 10–18     |                                                                  |
| optymalny | 18–30     | Recurly 2026: ok. 1 na 4 nowe zapisy to powracający subskrybenci |
| dobry     | 30–40     | sprawdź, czy rośnie udział seryjnych churnerów                   |
| słaby     | ≥ 40      | uzależnienie od powrotów; słaba akwizycja nowych                 |

**Zastrzeżenia:**

- Recurly nie podaje rozkładu według branż na stronie publicznej. Wartość 1 na 4 dotyczy całej sieci (ok. 76 mln subskrybentów), a strona nie podaje jej okresu ani bazy.
- Brak publicznych danych dla wydawców news i dla Polski.

### M1 retention: Retencja kohorty po 1 miesiącu (Month-1 cohort retention)

- **Rozwinięcie:** M1 to pierwszy miesiąc życia kohorty, czyli moment pierwszego odnowienia. Kohorta to grupa klientów, którzy zaczęli płacić w tym samym miesiącu. / M1 is the first month of a cohort's life (the first renewal). A cohort is the group of customers who started paying in the same month.
- **Wzór:** Subskrybenci z kohorty startu (miesiąc pierwszej płatnej transakcji) nadal aktywni i płacący po pierwszym odnowieniu (dzień 30–35) / liczebność kohorty × 100%. Triale i oferty wprowadzające licz jako osobne kohorty.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Odsetek nowej kohorty płacących, którzy przeszli pierwsze odnowienie. To najwcześniejszy sygnał dopasowania oferty i onboardingu. Churn jest najwyższy na samym początku: według Piano 13% wszystkich wyłączeń automatycznego odnowienia przypada na pierwszy dzień, a 40% na pierwsze 60 dni. Typowe pułapki: kohortę definiuj od pierwszej płatnej transakcji, a triale i oferty za 1 zł/1 € analizuj osobno, bo ich retencja jest wielokrotnie niższa.
- **Interpretation (EN):** Share of a new paying cohort that survives the first renewal. It is the earliest signal of offer fit and onboarding quality. Churn peaks at the very start: per Piano, 13% of all auto-renew disablements happen on day one and 40% within 60 days. Common pitfalls: define the cohort from the first paid transaction, and analyse trials and 1-unit intro offers separately because their retention is many times lower.

**Kontekst:** News/media cyfrowe B2C – plan miesięczny, sprzedaż web, cena pełna lub umiarkowany rabat · okres: kohorta miesięczna · metoda: Heurystyka: churn steady-state 3,8–4,62%/mies. (mediany Mather 2023–2025) powiększony o typowo wyższy odpływ w pierwszych tygodniach (Piano 2024; WAN-IFRA/Die Welt 2018). Brak publicznej mediany M1 dla wydawców. · źródła: mather_q3_2023, mather_q1_2025, piano_benchmarks_2024, twipe_wanifra_2018, ftstrategies_retention_2025

| Ocena     | Przedział | Uwagi                                        |
| --------- | --------- | -------------------------------------------- |
| krytyczny | < 70      |                                              |
| słaby     | 70–80     |                                              |
| normalny  | 80–88     |                                              |
| dobry     | 88–93     |                                              |
| optymalny | ≥ 93      | bliskie churnowi 'steady-state' (3–5%/mies.) |

**Kontekst:** Aplikacje subskrypcyjne Media & Entertainment – plan miesięczny, pierwsze odnowienie (punkt odniesienia) · okres: kohorta miesięczna · metoda: Kwartyle RevenueCat (SOSA 2026): P25 41%, mediana 58%, P75 72%. Granica krytyczna to heurystyka. · źródła: revenuecat_renewal_rates_2026

| Ocena     | Przedział | Uwagi       |
| --------- | --------- | ----------- |
| krytyczny | < 30      | heurystyka  |
| słaby     | 30–41     | poniżej P25 |
| normalny  | 41–58     | P25–P50     |
| dobry     | 58–72     | P50–P75     |
| optymalny | ≥ 72      | powyżej P75 |

**Zastrzeżenia:**

- Dane RevenueCat dotyczą aplikacji (często z ofertami wprowadzającymi) i są punktem odniesienia dolnego, nie normą dla subskrypcji web wydawcy.
- Piano 2026: płatne triale to ponad 60% ofert miesięcznych (typowo 1 USD/1 € za miesiąc). Ich M1 licz do pierwszej płatności po pełnej cenie.
- Reuters Institute (2023): niskie oferty wprowadzające skutecznie przyciągają, ale wielu subskrybentów nie widzi wartości przy odnowieniu po pełnej cenie.

### M3 retention: Retencja kohorty po 3 miesiącach (Month-3 cohort retention)

- **Rozwinięcie:** M3 to trzeci miesiąc życia kohorty, czyli udział klientów nadal aktywnych po 3 odnowieniach miesięcznych lub po ok. 90 dniach. / M3 is the third month of a cohort's life: the share still active after 3 monthly renewals or about 90 days.
- **Wzór:** Subskrybenci z kohorty startu nadal aktywni i płacący po 3 miesiącach (ok. 90. dzień) / liczebność kohorty × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Odsetek kohorty nadal aktywnej po 3 miesiącach. Po tym okresie odpływ zwykle się stabilizuje: w Die Welt ok. połowa nowych odchodziła w ciągu 3 miesięcy, potem churn spadał do 1–2% miesięcznie. Wskaźnik mierzy, czy subskrybent zbudował nawyk (newsletter, aplikacja, regularne wizyty). Typowe pułapki: porównuj kohorty z tą samą ofertą wejściową i kanałem, bo koniec 3-miesięcznej promocji tworzy sztuczny klif retencji.
- **Interpretation (EN):** Share of a cohort still active after 3 months. Attrition usually stabilises afterwards: at Die Welt about half of new subscribers left within 3 months, after which churn fell to 1–2% a month. It measures whether the subscriber built a habit (newsletter, app, regular visits). Common pitfalls: compare cohorts with the same entry offer and channel, because the end of a 3-month promo creates an artificial retention cliff.

**Kontekst:** News/media cyfrowe B2C – plan miesięczny (płatni) · okres: kohorta miesięczna · metoda: Heurystyka zakotwiczona w przypadku Die Welt (WAN-IFRA 2018), churnie steady-state wydawców (Mather) i rozkładzie wyłączeń auto-odnowienia (Piano 2024). · źródła: twipe_wanifra_2018, mather_q3_2023, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                 |
| --------- | --------- | ----------------------------------------------------- |
| krytyczny | < 50      | Die Welt 2018: ok. połowa nowych odchodziła w 3 mies. |
| słaby     | 50–65     |                                                       |
| normalny  | 65–75     |                                                       |
| dobry     | 75–85     |                                                       |
| optymalny | ≥ 85      |                                                       |

**Kontekst:** B2B SaaS / subskrypcje B2B – nowi klienci (logo) · okres: kohorta miesięczna · metoda: Górny kwartyl ChartMogul 2023 jako próg 'optymalny'. Pozostałe granice to heurystyka. · źródła: chartmogul_retention_report_2023

| Ocena     | Przedział | Uwagi                                                                                                              |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| krytyczny | < 70      |                                                                                                                    |
| słaby     | 70–80     |                                                                                                                    |
| normalny  | 80–87     | ASP (średnia cena sprzedaży) < 10 USD/mies.: 87% (dla porównania)                                                  |
| dobry     | 87–90     |                                                                                                                    |
| optymalny | ≥ 90      | górny kwartyl ChartMogul: 90%; 93% przy ARR 15–30 mln USD; 98% przy ASP (średniej cenie sprzedaży) > 500 USD/mies. |

**Zastrzeżenia:**

- Brak aktualnej (2024–2026) publicznej mediany M3 dla wydawców news. Dane Die Welt są z 2018 r.
- Raport ChartMogul obejmuje kohorty 2021–2022.
- Dla B2B z umowami rocznymi M3 jest mało informatywny. Lepiej mierzyć aktywację i użycie licencji w pierwszych 90 dniach.

### M12 retention: Retencja kohorty po 12 miesiącach (Month-12 cohort retention)

- **Rozwinięcie:** M12 to dwunasty miesiąc życia kohorty, czyli udział klientów nadal aktywnych po roku. Dla planów rocznych i członkostw to wynik pierwszego odnowienia (first-year renewal). / M12 is the twelfth month of a cohort's life: the share still active after a year. For annual plans and memberships it equals the first-year renewal rate.
- **Wzór:** Subskrybenci z kohorty startu nadal aktywni i płacący po 12 miesiącach / liczebność kohorty × 100%. Dla planów rocznych i członkostw: odnowieni po 1. roku / wszyscy, którym upłynął 1. rok.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Odsetek kohorty aktywnej po roku. To kluczowy wskaźnik dla LTV i jakości pozyskania. W news B2C plany roczne utrzymują po roku ok. 1,6 raza więcej subskrybentów niż miesięczne (Piano 2021: 74% wobec 46%). Typowe pułapki: przy planach rocznych M12 to wynik pierwszego odnowienia, więc nie porównuj go 1:1 z planami miesięcznymi. Długie promocje przesuwają klif retencji na moment powrotu do pełnej ceny.
- **Interpretation (EN):** Share of a cohort still active after a year, a key driver of LTV and acquisition quality. In B2C news, annual plans keep about 1.6x more subscribers after a year than monthly plans (Piano 2021: 74% vs 46%). Common pitfalls: for annual plans M12 is the first renewal outcome, so do not compare it 1:1 with monthly plans, and long promos push the retention cliff to the return to full price.

**Kontekst:** News/media cyfrowe B2C – plan miesięczny · okres: kohorta miesięczna, pomiar po 12 mies. · metoda: Mediana Piano (2021) i zakres FTI Consulting (2022/23). Skrajne granice to heurystyka. · źródła: digiday_monthly_annual_2023, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                   |
| --------- | --------- | ----------------------- |
| krytyczny | < 30      |                         |
| słaby     | 30–40     |                         |
| normalny  | 40–50     | mediana Piano 2021: 46% |
| dobry     | 50–60     | FTI: ok. 50–60%         |
| optymalny | ≥ 60      |                         |

**Kontekst:** News/media cyfrowe B2C – plan roczny (pierwsze odnowienie) · okres: rocznie (pierwsze odnowienie) · metoda: Mediana Piano (2021), zakres FTI Consulting i przypadek Aftenposten (DNR 2025 via Reporterzy.info). · źródła: digiday_monthly_annual_2023, reporterzy_dnr2025

| Ocena     | Przedział | Uwagi                         |
| --------- | --------- | ----------------------------- |
| krytyczny | < 50      |                               |
| słaby     | 50–65     |                               |
| normalny  | 65–74     | FTI: od 65%; Aftenposten: 71% |
| dobry     | 74–80     | mediana Piano 2021: 74%       |
| optymalny | ≥ 80      | górny zakres FTI: 80%         |

**Kontekst:** Członkostwa – odnowienie po pierwszym roku (first-year renewal) · okres: rocznie · metoda: Mediany MGI (2025 i 2026) jako górna granica przedziału 'normalny'. Pozostałe granice to heurystyka. · źródła: mgi_2025_memberjungle, mgi_2026_i4a

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| krytyczny | < 55      |                                                  |
| słaby     | 55–65     |                                                  |
| normalny  | 65–74     | mediany MGI: 72% (2026), 74% (2025)              |
| dobry     | 74–82     |                                                  |
| optymalny | ≥ 82      | na poziomie mediany odnowień całej bazy (82–84%) |

**Kontekst:** B2B SaaS / subskrypcje B2B – nowi klienci (logo) · okres: kohorta miesięczna, pomiar po 12 mies. · metoda: Górny kwartyl ChartMogul 2023 (70%) jako próg 'optymalny' (konwencja P75 = próg 'optymalny', jak w M3); 77% przy ARR 15–30 mln USD to poziom ambitny. Niższe granice to heurystyka. · źródła: chartmogul_retention_report_2023

| Ocena     | Przedział | Uwagi                                                                                        |
| --------- | --------- | -------------------------------------------------------------------------------------------- |
| krytyczny | < 45      |                                                                                              |
| słaby     | 45–55     |                                                                                              |
| normalny  | 55–62     |                                                                                              |
| dobry     | 62–70     |                                                                                              |
| optymalny | ≥ 70      | górny kwartyl ChartMogul (nowi klienci): 70%; 77% przy ARR 15–30 mln USD jako poziom ambitny |

**Kontekst:** Aplikacje Media & Entertainment – plan roczny, pierwsze odnowienie (punkt odniesienia) · okres: rocznie · metoda: Kwartyle RevenueCat SOSA 2026 (P25 20%, mediana 37%, P75 56%). · źródła: revenuecat_renewal_rates_2026

| Ocena     | Przedział | Uwagi       |
| --------- | --------- | ----------- |
| krytyczny | < 12      | heurystyka  |
| słaby     | 12–20     | poniżej P25 |
| normalny  | 20–37     | P25–P50     |
| dobry     | 37–56     | P50–P75     |
| optymalny | ≥ 56      | powyżej P75 |

**Zastrzeżenia:**

- Mediana Piano pochodzi z raportu 2021. Raport 2024 potwierdza tylko jakościowo, że plany roczne po pierwszym roku mają 'prawie dwukrotnie' wyższą retencję.
- Mather (Q2 2025, 86 marek): nawet najlepsza spośród promocji kohorta z 52-tygodniową ofertą wprowadzającą ma ok. 33% aktywnych w 80. tygodniu. Długie promocje mierz w horyzoncie powyżej 12 mies.
- Dane z aplikacji (RevenueCat) są znacznie niższe niż dla subskrypcji web wydawców i służą tylko jako dolny punkt odniesienia.
- Według INMA mediana czasu życia subskrypcji news wynosi ok. 21 mies. (wartość niezweryfikowana: strona zwraca HTTP 403). Według Beehiiv (wartość potwierdzona) średni czas życia subskrybenta płatnego newslettera newsowego to 18 mies.

### Źródła grupy: Retencja i churn

| Id                               | Źródło                                                                                                                                                                                                                                                                                | Wydawca                                                                        | Data                                                            | Weryfikacja          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------- |
| recurly_churn_benchmarks_2026    | [Churn rate benchmarks (Explore the data)](https://www.recurly.com/research/churn-rate-benchmarks)                                                                                                                                                                                    | Recurly Research                                                               | 2026-07 (dane sieci Recurly, lipiec 2026)                       | tak                  |
| recurly_docs_churn_benchmarks    | [Subscriber churn benchmarks](https://docs.recurly.com/docs/subscriber-churn-benchmarks)                                                                                                                                                                                              | Recurly Docs                                                                   | b.d. (dostęp 2026-10-18)                                        | tak                  |
| saascapital_retention_2025       | [2025 B2B SaaS Retention Benchmarks (Research Brief 32)](https://www.saas-capital.com/wp-content/uploads/2025/09/RB32WS1-2025-B2B-SaaS-Retention-Benchmarks.pdf)                                                                                                                      | SaaS Capital                                                                   | 2025-09-18                                                      | tak                  |
| keybanc_sapphire_2024            | [2024 KeyBanc Capital Markets & Sapphire Ventures SaaS Survey (15th Annual)](https://www.cfodesk.co.il/wp-content/uploads/2024/10/2024_kbcm_sapphire_saas_survey.pdf)                                                                                                                 | KeyBanc Capital Markets / Sapphire Ventures                                    | 2024-10                                                         | tak                  |
| aleph_benchmarkit_grr_2026       | [Gross revenue retention (GRR) benchmarks (2026) – 2026 Aleph × Benchmarkit SaaS & AI Performance Benchmarks](https://www.getaleph.com/answers/gross-revenue-retention-saas-2026)                                                                                                     | Aleph / Benchmarkit                                                            | 2026-06-01 (raport); strona aktualizowana 2026-10               | tak                  |
| aleph_benchmarkit_nrr_2026       | [Net revenue retention (NRR) benchmarks (2026) – 2026 Aleph × Benchmarkit SaaS & AI Performance Benchmarks](https://www.getaleph.com/answers/net-revenue-retention-saas-2026)                                                                                                         | Aleph / Benchmarkit                                                            | 2026-06-01 (raport); strona aktualizowana 2026-10               | częściowo            |
| chartmogul_retention_report_2023 | [SaaS Retention Report](https://chartmogul.com/saas-retention-report/)                                                                                                                                                                                                                | ChartMogul (Sid Jain)                                                          | 2023-11-01                                                      | częściowo            |
| chartmogul_good_churn_2022       | [What's a good customer churn rate?](https://chartmogul.com/blog/good-customer-churn-rate/)                                                                                                                                                                                           | ChartMogul (Sid Jain)                                                          | 2022-02-23                                                      | tak                  |
| chartmogul_churn_cheatsheet_2022 | [Churn cheat sheet](https://chartmogul.com/resources/churn-cheat-sheet)                                                                                                                                                                                                               | ChartMogul                                                                     | 2022-04-27                                                      | tak                  |
| mather_q3_2023                   | [U.S. Subscriber Benchmark Report Q3 2023](https://www.mathereconomics.com/wp-content/uploads/2023/11/US-Subscriber-Benchmark-Report_Mather-Economics_2023.pdf)                                                                                                                       | Mather Economics                                                               | 2023-11                                                         | tak                  |
| mather_sep_2022                  | [Subscription Digital Audience Mini Benchmarking Report – September 2022](https://www.mathereconomics.com/wp-content/uploads/2022/11/Mather-Economics-Subscription-Digital-Audience-Mini-Benchmarking-Report-September-2022.pdf)                                                      | Mather Economics                                                               | 2022-11 (dane IX 2022)                                          | tak                  |
| mather_q1_2025                   | [Download Mather's Q1 2025 U.S. Benchmarking Report](https://www.mathereconomics.com/download-mathers-q1-2025-u-s-benchmarking-report/)                                                                                                                                               | Mather Economics                                                               | 2025-05-13                                                      | tak                  |
| mather_q2_2025_promo             | [What Q2 2025 promotional offer benchmarks reveal about digital subscription growth](https://www.mathereconomics.com/what-q2-2025-promotional-offer-benchmarks-reveal-about-digital-subscription-growth/)                                                                             | Mather Economics (Dustin Tetley, Chris Mateer)                                 | 2025-08 (data przybliżona, wywnioskowana z nazw plików)         | tak                  |
| piano_benchmarks_2024            | [Subscription Performance Benchmarks 2024 Report](https://www.piano.io/marketing/content/subscription-performance-benchmarks-2024)                                                                                                                                                    | Piano                                                                          | 2024 (strona zaktualizowana 2026-10-13)                         | tak                  |
| piano_benchmark_update_2026      | [Benchmark update: Growing revenue with declining traffic](https://www.piano.io/resources/benchmark-update-growing-revenue-with-declining-traffic)                                                                                                                                    | Piano (Michael Silberman)                                                      | 2026-10-14                                                      | tak                  |
| digiday_monthly_annual_2023      | [Media Briefing: The case for and against monthly and annual subscriptions in the battle for retention](https://digiday.com/media/media-briefing-the-case-for-and-against-monthly-and-annual-subscriptions-in-the-battle-for-retention/)                                              | Digiday (Kayleigh Barber)                                                      | 2023-02-02                                                      | częściowo            |
| ftstrategies_retention_2025      | [Lessons on retention from the FT (and beyond)](https://www.ftstrategies.com/en-gb/insights/lessons-on-retention-from-the-ft)                                                                                                                                                         | FT Strategies (Lamberto Lambertini)                                            | 2025-01-27                                                      | tak                  |
| stripe_billing                   | [Stripe Billing](https://stripe.com/billing)                                                                                                                                                                                                                                          | Stripe                                                                         | b.d. (dostęp 2026-10-18)                                        | tak                  |
| churnkey_involuntary_2025        | [Involuntary churn benchmarks and tactical advice](https://churnkey.co/blog/involuntary-churn-benchmarks)                                                                                                                                                                             | Churnkey (dane Stripe 2024 i Churnkey)                                         | 2025-11-14 (aktualizacja 2025-12-12)                            | częściowo            |
| churnkey_sor_2025                | [State of Retention 2025](https://churnkey.co/reports/state-of-retention-2025)                                                                                                                                                                                                        | Churnkey                                                                       | 2025-06 (dane 2024; strona aktualizowana 2026-09-11)            | częściowo            |
| recurly_failed_payment_2026      | [Failed payment recovery: a data-based strategy](https://recurly.com/blog/failed-payment-recovery-data-based-strategy/)                                                                                                                                                               | Recurly (Matthew Calhoun)                                                      | 2026-04-30                                                      | tak                  |
| prosperstack_startribune         | [How Star Tribune reduced call center strain and improved their save rate](https://info.prosperstack.com/hubfs/Case%20Studies/ProsperStack%20-%20Star%20Tribune%20Case%20Study.pdf)                                                                                                   | ProsperStack (case study)                                                      | b.d. (dokument bez daty)                                        | tak                  |
| revenuecat_reactivation_2026     | [20% of your churned users will come back – but are you ready?](https://www.revenuecat.com/blog/growth/20-of-your-churned-users-will-come-back-but-are-you-ready)                                                                                                                     | RevenueCat (Daphne Tideman)                                                    | 2026-05-28                                                      | tak                  |
| recurly_sos_2026                 | [State of Subscriptions (industry report 2026)](https://recurly.com/resources/report/state-of-subscriptions/)                                                                                                                                                                         | Recurly                                                                        | 2026-01 (©2026; dane 2021–2025)                                 | tak                  |
| revenuecat_renewal_rates_2026    | [What's a good renewal rate? Average subscription renewal rates by app category](https://www.revenuecat.com/blog/growth/average-subscription-renewal-rates-by-app-category/)                                                                                                          | RevenueCat                                                                     | 2026-04-24 (aktualizacja; dane State of Subscription Apps 2026) | tak                  |
| mgi_2025_memberjungle            | [The 5 lessons we learnt from the 2025 Membership Marketing Benchmarking Report (Marketing General Inc.)](https://www.memberjungle.com/blog/the-5-lessons-we-learnt-from-the-2025-membership-marketing-benchmarking-report)                                                           | Member Jungle (omówienie raportu MGI)                                          | 2025-07-10                                                      | tak                  |
| mgi_2026_i4a                     | [How to Calculate Membership Retention Rate (With Benchmarks)](https://www.i4a.com/blog/retention-rate-calculation/)                                                                                                                                                                  | i4a (cytuje MGI 2026 Membership Marketing Benchmarking Report)                 | 2026-08-11 (aktualizacja)                                       | tak                  |
| twipe_wanifra_2018               | [Why half of new subscribers churn in the first 3 months](https://www.twipemobile.com/why-half-new-subscribers-churn-first-3-months/)                                                                                                                                                 | Twipe (cytuje WAN-IFRA 'Engaged Readers Don't Churn', 2018)                    | 2018-08-29                                                      | częściowo            |
| dnr_2026_poland                  | [Digital News Report 2026 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                                                                                       | Reuters Institute for the Study of Journalism (Vadim Makarenko)                | 2026-06-16                                                      | tak                  |
| rasp_inma_2026                   | [How Poland's Biggest Portal Learned to Think Small(er) and Built a Subscription That Keeps On Giving](https://www.inma.org/modules/event/2026SubscriptionsSummit/presentations/RASP_INMASUBSUMMIT26.pdf)                                                                             | Ringier Axel Springer Polska / INMA Media Subscriptions Summit 2026            | 2026                                                            | tak                  |
| antenna_svod_2025                | [Q1'26 State of Subscriptions: Premium SVOD 2025 Year in Review](https://www.antenna.live/insights/antenna-q126-state-of-subscriptions-report-premium-svod-2025-year-in-review)                                                                                                       | Antenna                                                                        | b.d. na stronie (webinary 24–25.02.2026; ©2026)                 | częściowo            |
| beehiiv_pressgazette_2026        | [Newsletters 2026: prices, retention and churn (Beehiiv State of Paid Newsletters)](https://pressgazette.co.uk/newsletters/newsletters-2026-prices-retention-churn/)                                                                                                                  | Press Gazette (Charlotte Tobitt)                                               | 2026-06-22                                                      | częściowo            |
| inma_past_subscribers_2025       | [Past subscribers are news brands' biggest growth pool](https://www.inma.org/blogs/reader-revenue/post.cfm/past-subscribers-are-news-brands-biggest-growth-pool)                                                                                                                      | INMA (Readers First)                                                           | 2025-06                                                         | nie da się sprawdzić |
| inma_churn_growth_engine         | [News companies can turn subscriber churn into a growth engine](https://www.inma.org/blogs/reader-revenue/post.cfm/news-companies-can-turn-subscriber-churn-into-a-growth-engine)                                                                                                     | INMA (Reader Revenue)                                                          | 2025 (dokładna data nieustalona)                                | nie da się sprawdzić |
| reporterzy_dnr2025               | [Paid journalistic content market](https://reporterzy.info/en/5124,paid-journalistic-content-market.html)                                                                                                                                                                             | Reporterzy.info (Krzysztof Fiedorek)                                           | 2025-07-28                                                      | tak                  |
| reuters_paying_news_2023         | [Paying for news: price-conscious consumers look for value amid cost-of-living crisis](https://reutersinstitute.politics.ox.ac.uk/sites/default/files/2023-09/Newman_and_Robertson_Paying_for_News.pdf)                                                                               | Reuters Institute for the Study of Journalism (Nic Newman, Craig T. Robertson) | 2023-09                                                         | tak                  |
| keybanc_sapphire_2025            | [2025 KeyBanc Capital Markets & Sapphire Ventures SaaS Survey (16th Annual) – komunikat prasowy](https://sapphireventures.com/press/keybanc-capital-markets-and-sapphire-ventures-private-saas-company-survey-reveals-ai-driven-transformation-and-sustained-operational-excellence/) | Sapphire Ventures / KeyBanc Capital Markets                                    | 2025-11-13                                                      | tak                  |
| chartmogul_ai_retention_2025     | [AI Retention Report (SaaS retention: the AI churn wave)](https://chartmogul.com/reports/saas-retention-the-ai-churn-wave/)                                                                                                                                                           | ChartMogul (Kyle Poyar)                                                        | 2025-12-10                                                      | tak                  |
| chartmogul_saas_winbacks_2026    | [The SaaS Winbacks Report](https://chartmogul.com/reports/saas-winbacks-report/)                                                                                                                                                                                                      | ChartMogul (O. Berezovsky)                                                     | 2026-04-21                                                      | tak                  |
| mather_q1_2026                   | [Q1 2026 Audience & Subscription Benchmarking Report](https://mathereconomics.com/north-america-media-benchmarking-report-q1-2026/)                                                                                                                                                   | Mather Economics                                                               | 2026-05                                                         | nie da się sprawdzić |

### Zmiany po weryfikacji: Retencja i churn

- Dodano 4 nowe źródła wskazane przez weryfikatora: keybanc_sapphire_2025 (GRR 86% za 2023, NRR >100%), chartmogul_ai_retention_2025 (NRR B2C 49%, B2B 82%), chartmogul_saas_winbacks_2026 (winback B2B 7–13% według ARR), mather_q1_2026 (raport za formularzem, liczby niezweryfikowane).
- logo_churn_monthly / news B2C: granica normalny/słaby 4,7 → 4,9%/mies. (≈45% rocznie), spójnie z granicą 45% w logo_churn_annual; notatka 'słaby' 44–58% → ok. 45–58% rocznie.
- logo_churn_monthly / news B2C: w notatce 'normalny' dopisano, że Antenna 4,6% nie ma okresu na stronie, a INMA 4,6% jest niezweryfikowana (HTTP 403).
- logo_churn_monthly / news B2C: w metodzie i notatce 'optymalny' doprecyzowano, że Mather 'Best-in-Class' to średnia najlepszych rynków, a nie P75; oznaczono do aktualizacji po pobraniu raportu Mather Q1 2026.
- logo_churn_monthly / news B2C: usunięto inma_churn_growth_engine z source_ids (HTTP 403, liczby nie do sprawdzenia; żadna granica na nim nie opierała się), podpięto mather_q1_2026 jako źródło do aktualizacji.
- logo_churn_monthly / SaaS SMB: ChartMogul 6,1% oznaczono jako dane historyczne z XI 2021–I 2022 (notatka i metoda).
- logo_churn_monthly: caveat INMA przeformułowano – wartość niezweryfikowana, pomocnicza, bez wpływu na granice.
- logo_churn_annual / news cała baza: notatka 'słaby' – Piano 2021 46% zamiast 45–46% i dopisek '(kohorta nowych, nie cała baza)'.
- logo_churn_annual / news plany roczne: notatka 'dobry' – Piano 2021 74% zamiast 74–75%.
- logo_churn_annual / SaaS SMB: ChartMogul 6,1% oznaczono jako dane historyczne XI 2021–I 2022 (spójnie z wersją miesięczną).
- logo_churn_annual / B2B mid-market i enterprise: doprecyzowano, że dane churnu KeyBanc są za 2023, a mediana ARR próby to 22,5 mln USD (2022) i 26 mln USD (2023).
- logo_churn_annual / członkostwa: notatka 'krytyczny' poprawiona na 'w zakresie typowym dla non-profit (60–75% odnowień według i4a)'.
- logo_churn_annual: caveat o Matherze przeformułowany – kohorta 52-tygodniowa jest najlepsza spośród promocji, a mimo to ma ok. 33% aktywnych w 80. tygodniu.
- gross_revenue_churn / B2B: notatka 'dobry' – mediana GRR 89–91% (KeyBanc 2024E, SaaS Capital 2025), Aleph sales-led 88% (zamiast 88–91%).
- gross_revenue_churn / B2B: dodano nowsze źródło KeyBanc/Sapphire 2025 (GRR 86% za 2023, oczekiwane ok. 90%) do metody i source_ids; progi bez zmian.
- gross_revenue_churn / B2C: ChartMogul 8,9% oznaczono jako dane z I–III 2022.
- gross_revenue_churn: caveat KeyBanc – mediana ARR próby 22,5 mln USD (2022) i 26 mln USD (2023) zamiast 'ok. 22,5 mln USD'; dopisano GRR 86% z edycji 2025.
- net_revenue_retention / B2B ogółem: zaznaczono niespójność P75 Aleph (110% vs 108%) – notatka i metoda 'P75 108–110%'; granica 110 bez zmian; dodano KeyBanc/Sapphire 2025 (NRR >100%) jako nowszą kontrolę.
- net_revenue_retention / B2C: przebudowano przedziały (krytyczny <40, słaby 40–50, normalny 50–65, dobry 65–80, optymalny ≥80), bo stary 'słaby' 45–55 zawierał medianę rynkową 49% (ChartMogul 2025); metoda: mediana ChartMogul 2025 + P75 ChartMogul 2023, pewność niska; podpięto chartmogul_ai_retention_2025 i Mather.
- net_revenue_retention: dodano caveats o zakresie próby ChartMogul 2025 (≥250 tys. USD ARR) i SaaS Capital (bez firm < 1 mln USD ARR, okno XII 2023 → XII 2024).
- gross_revenue_retention / B2B ogółem: dodano KeyBanc/Sapphire 2025 (GRR 86% za 2023, oczekiwane ok. 90%) jako nowszą kontrolę w metodzie i source_ids; progi bez zmian.
- gross_revenue_retention / B2C: przesunięto przedziały (krytyczny <40, słaby 40–50, normalny 50–60, dobry 60–70, optymalny ≥70), bo górny kwartyl ChartMogul 60–70% leżał w 'normalny'/'dobry'; dodano notatkę ChartMogul 2025 (GRR AI-native < 50 USD 23%) i podpięto chartmogul_ai_retention_2025 oraz Mather.
- gross_revenue_retention: caveats uzupełniono o GRR 86% z KeyBanc/Sapphire 2025 oraz zakres próby i okno SaaS Capital.
- involuntary_churn_share / news: wartości Piano 2026 (25% i 42%) oznaczono jako wyliczone (100 − udział churnu aktywnego).
- involuntary_churn_share / B2B: notatka 'optymalny' – udział dla ARPC > 250 USD to 5–6% (Recurly podaje łączny churn 3,07% albo 3,54%), a nie dokładnie 6%.
- involuntary_churn_share / B2B: w notatkach i metodzie Stripe 'cena/produkty' zamieniono na 'AOV (średnia wartość zamówienia)'.
- involuntary_churn_share: usunięto z caveats niepotwierdzone zdanie 'Churnkey twierdzi, że może łatwo przekroczyć 40%' (nie ma go na stronie; 40,5% dotyczy udziału 'insufficient funds').
- dunning_recovery_rate: przy 'optymalny' i w metodzie dopisano, że 71% Recurly to jeden przypadek dużego detalisty, a nie średnia; progi bez zmian.
- dunning_recovery_rate: usunięto z caveats niezweryfikowaną wartość '1,5–2,8% na pojedynczy e-mail dunningowy' (brak na stronie Churnkey SOR 2025).
- dunning_recovery_rate: dodano caveat Stripe – 8,2 mld USD odzyskanych nieudanych płatności w 2025 r.
- cancellation_save_rate / SaaS i aplikacje: usunięto kotwicę progu 'optymalny' (Churnkey ok. 2 mln / 3 mln sesji ≈ 65% to nie save rate według definicji); próg ≥30 pozostaje jako heurystyka o niskiej pewności.
- cancellation_save_rate: obniżono confidence średnia → niska (przedział 'optymalny' w kontekście SaaS stracił podstawę; kontekst news opiera się na pojedynczych przypadkach).
- cancellation_save_rate: udział rabatów w caveats zapisano jako 53–54% (strona podaje 53,9% i 53%).
- cancellation_save_rate: przy wzroście użycia pauzy o 337% (Recurly) dopisano brak okresu i bazy porównania.
- winback_rate_12m / B2C plany miesięczne: przedziały przesunięte do aktualnej średniej SOSA 2026 = 20,1% (krytyczny <6, słaby 6–12, normalny 12–20, dobry 20–28, optymalny ≥28); usunięto inma_past_subscribers_2025 z source_ids (HTTP 403, nie do sprawdzenia).
- winback_rate_12m: dodano kontekst B2B SaaS z nowego źródła ChartMogul 'The SaaS Winbacks Report' (21.04.2026): krytyczny <4, słaby 4–7, normalny 7–10, dobry 10–13, optymalny ≥13 (heurystyka wokół median według ARR, pewność niska).
- winback_rate_12m: INMA 1,7x oznaczono jako niezweryfikowane (403) w interpretacji PL/EN i caveats; dodano caveat o braku definicji okna i mianownika w raporcie ChartMogul.
- returning_subscriber_share: w caveats dopisano, że Recurly nie podaje okresu ani bazy wartości '1 na 4'; progi bez zmian.
- cohort_retention_m1 / news: w metodzie zakres 3,5–4,7% (stara granica przedziału) zastąpiono medianami Mather 3,8–4,62%/mies. ze źródeł kontekstu; progi bez zmian.
- cohort_retention_m3 / news: z notatki 'krytyczny' usunięto '(oferty próbne)' – Twipe/WAN-IFRA tego nie podaje.
- cohort_retention_m3 / B2B: wartości 98% i 87% przypisano segmentom według ASP (> 500 i < 10 USD/mies.), a nie ARPA.
- cohort_retention_m12 / news: Piano 2021 podano jako 46% (miesięczne) i 74% (roczne) zamiast 45–46% i 74–75% (notatki i interpretacja PL/EN).
- cohort_retention_m12 / B2B SaaS: przedziały przesunięte do konwencji P75 = próg 'optymalny' (krytyczny <45, słaby 45–55, normalny 55–62, dobry 62–70, optymalny ≥70; 77% jako poziom ambitny).
- cohort_retention_m12: caveat o Matherze przeformułowany – kohorta 52-tygodniowa jest najlepsza spośród promocji (ok. 33% aktywnych w 80. tygodniu).
- cohort_retention_m12: w caveats INMA 21 mies. oznaczono jako niezweryfikowane (403), a Beehiiv 18 mies. jako potwierdzone.
- Źródło recurly_churn_benchmarks_2026: 3,60% opisano jako 'Overall churn rate' (nie mediana), dopisano pełne wartości Education i wszystkie niespójności strony (SaaS, B2B, ARPC > 250 USD 3,54% vs 3,07%).
- Źródło keybanc_sapphire_2024: mediana ARR próby 22,5 mln USD (2022) i 26,0 mln USD (2023), dane churnu za 2023.
- Źródło saascapital_retention_2025: dopisano wykluczenie firm < 1 mln USD ARR z danych według ACV i okno pomiaru XII 2023 → XII 2024.
- Źródło aleph_benchmarkit_nrr_2026: górny kwartyl zapisany jako 108–110% z opisem niespójności strony.
- Źródło chartmogul_retention_report_2023: wartości 98%/87% po 3 mies. przypisano segmentom ASP, nie ARPA.
- Źródła chartmogul_good_churn_2022 i chartmogul_churn_cheatsheet_2022: oznaczono jako dane historyczne; doprecyzowano 3,7% przy MRR 1–3 mln USD.
- Źródła Mather: przy IX 2022 dopisano definicję Best-in-Class (średnia najlepszych rynków), przy Q1 2025 odesłanie do nowszego raportu Q1 2026.
- Źródło mather_q2_2025_promo: dopisano, że kohorta 52-tygodniowa ma najlepszą retencję spośród promocji; data oznaczona jako wywnioskowana z nazw plików.
- Źródła Piano: dopisano okres danych 2024 (I 2022–IX 2024) oraz to, że udziały pasywne 25%/42% w update 2026 są wyliczone.
- Źródło digiday_monthly_annual_2023: dopisano, że okres churnu FTI 3–5% nie jest podany.
- Źródło stripe_billing: dodano 8,2 mld USD odzyskanych w 2025 r. i ostrzeżenie, że panel z 44% to makieta.
- Źródło churnkey_involuntary_2025: progi cenowe opisano jako AOV; dopisano, czego dotyczy 40,5%.
- Źródło churnkey_sor_2025: dokładne udziały ofert (53,9%/53%, 19,2%, 6,7%), data aktualizacji strony, zastrzeżenie, że 2 mln / 3 mln to nie save rate, i brak wartości 1,5–2,8%.
- Źródło recurly_failed_payment_2026: 71% oznaczono jako jeden przypadek, nie średnią.
- Źródło prosperstack_startribune: data 'b.d. (dokument bez daty)' zamiast szacunku 'ok. 2022'.
- Źródła revenuecat_reactivation_2026 i recurly_sos_2026: dopisano brak definicji okna reaktywacji oraz brak okresu i bazy dla '1 in 4' i 337%.
- Źródło mgi_2026_i4a: dopisano progi top dla izb (85%+) i non-profit (80%+) oraz to, że raportu MGI 2026 nie sprawdzono u źródła.
- Źródła twipe_wanifra_2018 i reporterzy_dnr2025: dopisano brak informacji o ofertach próbnych oraz że 18% to średnia dla wielu rynków.
- Źródło antenna_svod_2025: usunięto niezweryfikowaną wartość 4,8% (MediaPost), 4,6% oznaczono jako miesięczną według metodologii Antenna (niepotwierdzone na stronie), poprawiono datę.
- Źródło beehiiv_pressgazette_2026: 'ponad 2500 płatnych newsletterów' poprawiono na 'ponad 2500 newsletterów'.
- Źródła INMA (oba): oznaczono jako pomocnicze, niezweryfikowane (HTTP 403), bez podpięcia do przedziałów.

## 3. Ekonomika jednostkowa

### LTV / CLV: Wartość klienta w cyklu życia (Customer Lifetime Value)

- **Rozwinięcie:** LTV – Lifetime Value; CLV/CLTV – Customer Lifetime Value: wartość (na marży brutto), jaką przeciętny płacący klient wnosi przez cały okres relacji / LTV – Lifetime Value; CLV/CLTV – Customer Lifetime Value: the gross-margin value an average paying customer generates over the whole relationship
- **Wzór:** LTV = ARPU miesięczne (netto, po rabatach) × marża brutto % ÷ miesięczny churn klientów. Wariant B2B (Benchmarkit): (średni ARR na konto × marża brutto przychodów powtarzalnych ÷ roczny churn). Oczekiwany czas życia ≈ 1 ÷ miesięczny churn (Lenfest).
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, ile marży brutto przyniesie przeciętny płacący klient przez cały okres subskrypcji – to górna granica tego, ile można wydać na jego pozyskanie i utrzymanie. Licz w kohortach (miesiąc startu, kanał, plan, segment: osoby / instytucje / studenci-NGO) i zawsze na marży, nie na przychodzie. Pułapki: wzór 1/churn przy krótkiej historii i niskim, niestabilnym churnie młodego produktu daje zawyżone LTV, a promocyjne ceny pierwszego okresu zniekształcają ARPU – dlatego czytaj LTV razem z CAC (LTV/CAC).
- **Interpretation (EN):** Shows how much gross margin an average paying customer generates over the subscription lifetime – the ceiling for what you can spend to acquire and retain them. Compute it by cohort (start month, channel, plan, segment: individuals / institutions / students-NGOs) and always on margin, not revenue. Pitfalls: the 1/churn shortcut inflates LTV when churn history is short and unstable, and introductory prices distort ARPU – so read LTV together with CAC (LTV/CAC).

**Kontekst:** media cyfrowe B2C – indywidualna subskrypcja treści eksperckich (Polska), LTV na marży brutto w zł · okres: na klienta (cały cykl życia) · metoda: heurystyka: progi jako krotność miesięcznej marży brutto z klienta m (krotność = oczekiwany czas życia w mies.): krytyczny <8×m (churn >12,5%/mies.), słaby 8–17×m, normalny 17–33×m, dobry 33–50×m, optymalny >50×m (churn <2%/mies.); kwoty w zł dla m ≈ 15 zł netto (założenie: ARPU netto ok. 17–18 zł, tj. ok. 20 zł brutto po odjęciu VAT, × marża ≈85%). ARPU liczone netto, bez VAT; realne ARPU może być niższe od opinii ‘15–20 zł’, bo 78% płacących w Polsce nie płaci pełnej ceny (DNR 2024) · źródła: wm_anatomia_2026, risj_dnr2024_pay, lenfest_2019, stripe_pl_pricing

| Ocena     | Przedział | Uwagi                                                                   |
| --------- | --------- | ----------------------------------------------------------------------- |
| krytyczny | < 120     | <8×m – churn >12,5%/mies., klient zostaje średnio <8 mies.              |
| słaby     | 120–250   | 8–17×m – churn ~6–12,5%/mies.                                           |
| normalny  | 250–500   | 17–33×m – churn ~3–6%/mies.                                             |
| dobry     | 500–750   | 33–50×m – churn ~2–3%/mies.                                             |
| optymalny | ≥ 750     | >50×m – churn <2%/mies. lub wyraźnie wyższe ARPU (plany roczne/premium) |

**Zastrzeżenia:**

- Brak publicznych, aktualnych benchmarków LTV dla polskich wydawców cyfrowych; progi to heurystyka – krotność miesięcznej marży brutto z klienta m (8/17/33/50 × m). Kwoty w zł podano dla m ≈ 15 zł; przy innym m przelicz progi tą samą krotnością.
- Punkt odniesienia (stary, USA): Lenfest Institute 2019 – wydawca z 80. percentyla (dziennik z aktywną sprzedażą subskrypcji) miał CLV ok. 217 USD na subskrybenta cyfrowego; CLV Lenfest liczone jest na PRZYCHODZIE (ARPU × czas życia), nie na marży brutto – nie porównuj go wprost z progami LTV na marży.
- Dla kohort z historią <12 mies. ogranicz horyzont LTV (np. do 24–36 mies.), bo wzór 1/churn ekstrapoluje zbyt optymistycznie.
- Segment B2B (licencje instytucjonalne) oceniaj przez LTV/CAC i CAC payback, nie przez progi w zł – wartości kontraktów są zbyt zróżnicowane.
- Licz osobno dla planów miesięcznych i rocznych oraz dla taryf studenckich/NGO, inaczej średnia ukryje problem.
- Licz LTV od ARPU netto (bez VAT), nie od cen brutto z cenników B2C; przy stawce 23% 20 zł brutto to ok. 16,3 zł netto (m ≈ 13,8 zł przy marży 85%) – wtedy przelicz progi krotnością m.

### CAC: Koszt pozyskania klienta (Customer Acquisition Cost)

- **Rozwinięcie:** CAC – Customer Acquisition Cost: średni koszt sprzedaży i marketingu poniesiony na pozyskanie jednego nowego płacącego klienta / CAC – Customer Acquisition Cost: average sales and marketing cost incurred to win one new paying customer
- **Wzór:** CAC = (koszty marketingu i sprzedaży przypisane do pozyskania w okresie: media płatne, kampanie, narzędzia, wynagrodzenia zespołu proporcjonalnie, prowizje partnerów) ÷ liczba nowych płacących klientów w tym samym okresie. Warianty: blended (wszyscy nowi płacący, także organiczni) i paid (tylko z kanałów płatnych).
- **Jednostka:** PLN · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mówi, ile kosztuje zdobycie jednego nowego płacącego subskrybenta lub instytucji; sam w sobie nie mówi, czy to drogo – trzeba go odnieść do ARPU i marży (CAC payback, LTV/CAC). Licz osobno per kanał (newsletter, wydarzenia, social, płatne media, partnerzy) i per segment. Pułapki: pomijanie wynagrodzeń i narzędzi (zaniża CAC), liczenie przejść z darmowego triala jako ‘organicznych’ oraz mieszanie okresów (koszty z kwartału, konwersje z miesiąca).
- **Interpretation (EN):** Tells you how much it costs to win one new paying subscriber or institution; on its own it does not say whether that is expensive – relate it to ARPU and margin (CAC payback, LTV/CAC). Track it per channel (newsletter, events, social, paid media, partners) and per segment. Pitfalls: leaving out salaries and tools (understates CAC), counting trial conversions as ‘organic’, and mismatching periods (costs per quarter, conversions per month).

**Kontekst:** media cyfrowe B2C – nowy płacący subskrybent indywidualny (Polska), zł · okres: na nowego płacącego klienta · metoda: heurystyka: CAC = docelowy okres zwrotu (3 / 6 / 9 / 12 mies., spójnie z kontekstem B2C wskaźnika cac_payback_months) × miesięczna marża brutto z klienta m ≈ 15 zł netto (założenie: ARPU netto ok. 17–18 zł, tj. ok. 20 zł brutto po odjęciu VAT, × marża ≈85%) · źródła: wm_anatomia_2026, risj_dnr2024_pay, bvp_2021

| Ocena     | Przedział | Uwagi                                                                            |
| --------- | --------- | -------------------------------------------------------------------------------- |
| optymalny | < 45      | zwrot ≤~3 mies.                                                                  |
| dobry     | 45–90     | zwrot ~3–6 mies.                                                                 |
| normalny  | 90–135    | zwrot ~6–9 mies.                                                                 |
| słaby     | 135–180   | zwrot ~9–12 mies.                                                                |
| krytyczny | ≥ 180     | zwrot >12 mies. – przy typowym churnie B2C wielu klientów odejdzie przed zwrotem |

**Zastrzeżenia:**

- Brak wiarygodnych, publicznych benchmarków CAC dla wydawców w PLN; progi są pochodną ARPU netto i marży – przy innym ARPU przelicz je wzorem CAC = miesiące zwrotu × ARPU netto (bez VAT) × marża.
- Dla B2B/instytucji używaj znormalizowanych miar: New CAC Ratio (koszt S&M na 1 zł nowego ARR) i CAC payback – absolutny CAC zależy od wartości kontraktu.
- Często cytowany przedział CAC wydawców informacyjnych ok. 40–60 USD (INMA, 2021) nie został zweryfikowany w źródle pierwotnym (strona zwraca 403) – nie używać jako progu.
- Koszt rabatów i darmowych okresów próbnych księguj konsekwentnie (obniżka przychodu albo koszt pozyskania) – zmiana konwencji zmienia CAC skokowo.
- Licz od ARPU netto: przy stawce VAT 23% 20 zł brutto to ok. 16,3 zł netto (m ≈ 13,8 zł) – progi spadają proporcjonalnie.

### New CAC Ratio: Wskaźnik kosztu pozyskania nowego ARR (New Customer CAC Ratio)

- **Rozwinięcie:** New CAC Ratio – stosunek wydatków na sprzedaż i marketing do nowego rocznego przychodu powtarzalnego (ARR – Annual Recurring Revenue) od nowych klientów / New CAC Ratio – sales & marketing expense divided by new Annual Recurring Revenue (ARR) from new customers
- **Wzór:** New CAC Ratio = koszty sprzedaży i marketingu w okresie ÷ nowy ARR od nowych klientów w tym okresie (Benchmarkit). Blended CAC Ratio = S&M ÷ (nowy ARR + ARR z rozszerzeń).
- **Jednostka:** ratio · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Ile złotych wydatków na sprzedaż i marketing trzeba ponieść, by pozyskać 1 zł nowego rocznego przychodu powtarzalnego od nowych klientów; normalizuje CAC do wartości kontraktu, więc pozwala porównywać segmenty o różnych cenach (np. licencje instytucjonalne vs. indywidualne). Mediana B2B SaaS w 2024 r. to 2,00 zł na 1 zł nowego ARR. Pułapki: nie dodawaj ARR z rozszerzeń u obecnych klientów (to osobny Expansion CAC Ratio, mediana 1,00) i stosuj ten sam okres dla kosztów i ARR.
- **Interpretation (EN):** How many units of sales & marketing spend are needed to win one unit of new ARR from new customers; it normalises CAC by contract value, so segments with different prices (institutional vs individual licences) can be compared. The 2024 B2B SaaS median was $2.00 per $1.00 of new ARR. Pitfalls: do not mix in expansion ARR from existing customers (that is the separate Expansion CAC Ratio, median $1.00) and use the same period for costs and ARR.

**Kontekst:** SaaS B2B / subskrypcje instytucjonalne (prywatne firmy, głównie USA) · okres: rocznie (CY-2024) · metoda: kwartyle źródła (CY-2024): P25 1,50 / mediana 2,00 / P75 2,82 (N=73); optymalny ≤P25, dobry P25–P50, normalny P50–P75, słaby P75–3,0; krytyczny >3,0 – heurystyka (przy marży 80% zwrot ≈45 mies.; obniżono z 4,0 ≈60 mies., bo próg krytyczny CAC payback >36 mies. odpowiada ratio ≈2,4). Publicznych kwartyli za CY-2025 brak – Benchmarkit 2026 (S100) podaje tylko Blended CAC Ratio 1,30 USD · źródła: bm2025, S100

| Ocena     | Przedział | Uwagi                                                |
| --------- | --------- | ---------------------------------------------------- |
| optymalny | < 1,5     |                                                      |
| dobry     | 1,5–2     |                                                      |
| normalny  | 2–2,82    |                                                      |
| słaby     | 2,82–3    |                                                      |
| krytyczny | ≥ 3       | heurystyka – przy marży 80% zwrot ≈45 mies. i dłużej |

**Zastrzeżenia:**

- Mała próba (N=73) i dane deklaratywne; wartości kwartyli odczytane z wykresu w raporcie.
- Silna zależność od ACV: dla ACV 1–5 tys. USD P25 0,46 / mediana 2,00 / P75 2,46; dla 5–10 tys. USD 1,50 / 1,60 / 1,80.
- Dla czysto konsumenckiej subskrypcji (B2C) wskaźnik ma mniejszy sens – użyj CAC payback.
- Kwartyle dotyczą CY-2024; publicznych kwartyli New CAC Ratio za CY-2025 nie ma – strona Benchmarkit 2026 (S100) podaje jedynie Blended CAC Ratio 1,30 USD (inna definicja: S&M ÷ (nowy ARR + ARR z rozszerzeń)).
- Progi nie są mechanicznie spójne z CAC payback: z mediany 2,00 ÷ marża 81% × 12 wychodzi ok. 30 mies., a raportowana mediana zwrotu to 18 mies. – wynika to z innych podprób (N=73 vs N=148).
- Przedział słaby (2,82–3,0) jest wąski: granica krytyczna 3,0 to heurystyka dopasowana do progów CAC payback, nie kwartyl źródła.

### LTV/CAC: Relacja wartości klienta do kosztu pozyskania (LTV to CAC Ratio)

- **Rozwinięcie:** LTV/CAC (CLTV:CAC) – stosunek wartości klienta w cyklu życia (Lifetime Value) do kosztu jego pozyskania (Customer Acquisition Cost) / LTV/CAC (CLTV:CAC) – ratio of Customer Lifetime Value to Customer Acquisition Cost
- **Wzór:** LTV/CAC = LTV (na marży brutto) ÷ CAC; w Benchmarkit: (średni ARR na konto × marża brutto przychodów powtarzalnych ÷ churn) ÷ CAC na nowego klienta
- **Jednostka:** ratio · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Ile razy wartość klienta (na marży) przewyższa koszt jego pozyskania; poniżej 1 każdy nowy klient pogłębia stratę. Za próg minimalny uznaje się 3:1, mediana B2B SaaS w 2025 r. to 4,1x, a górny kwartyl 7,8x. Pułapki: to wskaźnik złożony – zawsze rozbijaj go na ARPU, churn, marżę i CAC; bardzo wysoki wynik (8x+) bywa sygnałem niedoinwestowania wzrostu albo zbyt krótkiej historii churnu.
- **Interpretation (EN):** How many times the customer’s gross-margin value exceeds the cost to acquire them; below 1 every new customer deepens the loss. 3:1 is the accepted floor, the 2025 B2B SaaS median was 4.1x and the top quartile 7.8x. Pitfalls: it is a compound metric – always decompose it into ARPU, churn, margin and CAC; very high values (8x+) can signal under-investment in growth or a too-short churn history.

**Kontekst:** SaaS B2B / subskrypcje instytucjonalne (prywatne firmy B2B SaaS i AI, globalnie) · okres: rocznie (CY-2025) · metoda: kwartyle źródła: dolny kwartyl ≈1,1x (Aleph: ‘bottom quartile’ – bez definicji, czy to granica P25, czy średnia dolnego kwartyla) / mediana 4,1x / P75 7,8x (n=146) + próg 3:1 (Skok – heurystyka klasyczna bez daty; Bessemer 2021) + granica 8x jako sygnał niedoinwestowania (Aleph) · źródła: aleph_ltvcac_2026, bm2025, skok_saasmetrics, bvp_2021

| Ocena     | Przedział | Uwagi                                                                                          |
| --------- | --------- | ---------------------------------------------------------------------------------------------- |
| krytyczny | < 1       | klient nie zwraca kosztu pozyskania                                                            |
| słaby     | 1–3       | poniżej progu 3:1; dolny kwartyl ≈1,1x (Aleph – granica kwartyla niezdefiniowana)              |
| normalny  | 3–4       | od progu 3:1 do okolic mediany 4,1x                                                            |
| dobry     | 4–5       |                                                                                                |
| optymalny | 5–8       | P75 = 7,8x; ‘7x+ best-in-class’                                                                |
| dobry     | ≥ 8       | dobry – sprawdź niedoinwestowanie wzrostu lub zbyt krótką historię churnu (wysoka efektywność) |

**Kontekst:** media cyfrowe B2C / członkostwa indywidualne (Polska) · okres: na kohortę miesięczną · metoda: heurystyka: te same progi co B2B (3:1 jako minimum), LTV liczone konserwatywnie (horyzont ≤36 mies. dla młodych kohort) · źródła: skok_saasmetrics, lenfest_2019

| Ocena     | Przedział | Uwagi                                                                   |
| --------- | --------- | ----------------------------------------------------------------------- |
| krytyczny | < 1       | klient nie zwraca kosztu pozyskania                                     |
| słaby     | 1–3       | poniżej minimum 3:1                                                     |
| normalny  | 3–4       |                                                                         |
| dobry     | 4–5       |                                                                         |
| optymalny | 5–8       |                                                                         |
| dobry     | ≥ 8       | dobry – sprawdź, czy LTV nie jest zawyżone przez krótką historię churnu |

**Zastrzeżenia:**

- Rozbieżność źródeł: w raporcie Benchmarkit 2025 (CY-2024) P25 wg przedziałów ARR wynosił 2,2–3,0x (np. 5–20 mln USD 3,0/4,0/6,5; 50–100 mln USD 2,5/2,9/5,0), a w edycji 2026 dolny kwartyl całej próby to ok. 1,1x – Aleph mówi o ‘bottom quartile’ bez definicji, czy to granica P25, czy średnia dolnego kwartyla, i nie podaje P25 za 2024.
- Wczesne firmy (<1 mln USD ARR) raportują zawyżone LTV/CAC (Benchmarkit 2025: P25 3,0 / mediana 5,0 / P75 9,5) – krótka historia churnu.
- Mediana 2022–2024 stała na poziomie 3,6–3,7x, w 2025 r. wzrosła do 4,1x; źródło (Aleph) nie podaje przyczyny wzrostu – nie przypisuj go ani cięciu kosztów, ani poprawie retencji.
- Dla B2C brak publicznych benchmarków wydawców – kontekst B2C to heurystyka z progami jak w B2B.
- Skok (For Entrepreneurs) to heurystyka klasyczna bez daty publikacji, nie benchmark z próby.

### CAC Payback: Okres zwrotu kosztu pozyskania klienta (CAC Payback Period)

- **Rozwinięcie:** CAC Payback (CPP) – liczba miesięcy potrzebna, by marża brutto z nowych klientów zwróciła koszt ich pozyskania (Customer Acquisition Cost) / CAC Payback Period (CPP) – months needed for gross margin from new customers to recover their Customer Acquisition Cost
- **Wzór:** CAC payback (mies.) = CAC ÷ (ARPU miesięczne × marża brutto %). Wariant Benchmarkit: koszty S&M ÷ (ARR od nowych klientów × marża brutto subskrypcji) × 12
- **Jednostka:** months · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Po ilu miesiącach nowy klient ‘spłaca’ koszt swojego pozyskania z marży brutto; im krócej, tym mniej kapitału zamrożonego we wzroście i mniejsze ryzyko, że klient odejdzie przed zwrotem. Mediana B2B SaaS w 2025 r. to 16 mies., ale silnie zależy od wartości kontraktu (dla ACV <5 tys. USD ok. 8–11 mies.). Pułapki: liczenie na przychodzie zamiast na marży, wliczanie ARR z rozszerzeń oraz porównywanie z firmami publicznymi, które liczą zwrot na ‘net new ARR’ (inna metodologia).
- **Interpretation (EN):** How many months it takes a new customer to ‘repay’ their acquisition cost from gross margin; shorter means less capital tied up in growth and less risk of churn before payback. The 2025 B2B SaaS median was 16 months, but it depends heavily on contract value (about 8–11 months for ACV under $5K). Pitfalls: computing on revenue instead of margin, mixing in expansion ARR, and comparing with public companies that use ‘net new ARR’ (different methodology).

**Kontekst:** SaaS B2B – cała próba (prywatne firmy B2B SaaS i AI) · okres: rocznie (CY-2025) · metoda: kwartyle źródła: P25 10 / mediana 16 / P75 24 mies. (n=198); optymalny ≤P25, dobry P25–P50, normalny P50–P75, słaby 24–36; krytyczny >36 – heurystyka · źródła: aleph_payback_2026, bm2025

| Ocena     | Przedział | Uwagi                                 |
| --------- | --------- | ------------------------------------- |
| optymalny | < 10      |                                       |
| dobry     | 10–16     |                                       |
| normalny  | 16–24     |                                       |
| słaby     | 24–36     |                                       |
| krytyczny | ≥ 36      | heurystyka – zwrot dłuższy niż 3 lata |

**Kontekst:** subskrypcje instytucjonalne / B2B o niskiej wartości kontraktu (ACV <5 tys. USD, ok. <20 tys. zł rocznie) · okres: rocznie (CY-2024/CY-2025) · metoda: kwartyle Benchmarkit 2025 (CY-2024) dla ACV <1 tys. USD (5/8/10) i 1–5 tys. USD (6/8/12) + mediana CY-2025 dla ACV <5 tys. USD = 11 mies. (Aleph 2026; CY-2024: 8) + cel Bessemer dla SMB <12 mies.; optymalny ≤6 (P25 CY-2024), dobry 6–11 (do mediany CY-2025), normalny 11–14 – heurystyka (brak P75 za 2025), słaby 14–18, krytyczny >18 – heurystyka · źródła: bm2025, aleph_payback_2026, bvp_2021

| Ocena     | Przedział | Uwagi                                      |
| --------- | --------- | ------------------------------------------ |
| optymalny | < 6       |                                            |
| dobry     | 6–11      | do mediany CY-2025 dla ACV <5 tys. USD     |
| normalny  | 11–14     | granica 14 – heurystyka (brak P75 za 2025) |
| słaby     | 14–18     |                                            |
| krytyczny | ≥ 18      | heurystyka                                 |

**Kontekst:** media cyfrowe B2C – subskrypcja indywidualna (Polska) · okres: na kohortę miesięczną · metoda: heurystyka: B2C ma krótszy czas życia klienta niż SMB B2B, więc próg musi być ostrzejszy niż cel Bessemer dla SMB (<12 mies.); zwrot powinien nastąpić w pierwszej 1/3 oczekiwanego czasu życia · źródła: bvp_2021, skok_saasmetrics

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| optymalny | < 3       |       |
| dobry     | 3–6       |       |
| normalny  | 6–9       |       |
| słaby     | 9–12      |       |
| krytyczny | ≥ 12      |       |

**Zastrzeżenia:**

- Kwartyle 2024 (CY-2024, N=148): P25 12 / mediana 18 / P75 24 mies.; w 2025 r. mediana spadła do 16, P25 do 10.
- Benchmarkit 2025 wg ACV (P25/mediana/P75): 5–10 tys. USD 13/14/18; 10–25 tys. 15/18/22; 25–50 tys. 13/22/26; 50–100 tys. 16/24/33; 100–250 tys. 20/24/37 mies. – odczyt z wykresu.
- Cele Bessemer (2021, portfel VC): SMB <12, mid-market <18, enterprise <24 mies.
- Kontekst B2C to heurystyka – brak publicznych benchmarków zwrotu CAC dla wydawców.
- Strona Aleph 2026 podaje też ‘Top-quartile companies do it in 6 months or fewer’, co przeczy P25 = 10 mies. na tej samej stronie – nie używaj ‘≤6 mies.’ jako górnego kwartyla całej próby.
- Kontekst niskiego ACV: progi oparto na medianie CY-2025 (11 mies.; CY-2024: 8 mies.), granica 14 mies. to heurystyka; cel Bessemer dla SMB (<12 mies.) mieści się w przedziale normalnym.
- Skok (próg 12 mies. w kontekście B2C) to heurystyka klasyczna bez daty publikacji, nie benchmark z próby.

### GM: Marża brutto subskrypcji cyfrowych (Subscription Gross Margin)

- **Rozwinięcie:** GM – Gross Margin: udział przychodu z subskrypcji, który zostaje po odjęciu kosztów bezpośredniego dostarczenia usługi (COGS – Cost of Goods Sold) / GM – Gross Margin: share of subscription revenue left after direct cost of delivery (COGS – Cost of Goods Sold)
- **Wzór:** Marża brutto subskrypcji = (przychody z subskrypcji netto − koszty bezpośrednie: opłaty płatnicze i billing, hosting/CDN, licencje paywall/CRM/e-mail proporcjonalnie, prowizje platform/sklepów aplikacji, obsługa klienta) ÷ przychody z subskrypcji × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Jaka część przychodu z subskrypcji zostaje po pokryciu kosztów bezpośredniego dostarczenia usługi; wysoka marża oznacza, że wzrost skali poprawia rentowność. Mediana marży oprogramowania B2B SaaS w 2025 r. to 80%, górny kwartyl 86%+. Pułapki: niespójne księgowanie kosztów redakcyjnych (w mediach zwykle koszt operacyjny, nie COGS) – trzymaj jedną definicję; stała opłata za transakcję (np. 1 zł) mocno obniża marżę tanich planów miesięcznych.
- **Interpretation (EN):** The share of subscription revenue left after direct delivery costs; a high margin means scale improves profitability. The 2025 B2B SaaS software gross-margin median was 80%, top quartile 86%+. Pitfalls: inconsistent treatment of editorial costs (in media usually opex, not COGS) – keep one definition; fixed per-transaction fees (e.g. PLN 1) heavily erode the margin of cheap monthly plans.

**Kontekst:** SaaS B2B – marża brutto przychodów z oprogramowania/subskrypcji · okres: rocznie (CY-2025) · metoda: kwartyle źródła: dolny kwartyl 50% (Aleph 2026 – bez definicji granicy) / mediana 80% / górny kwartyl 86%+ (n=228–232, CY-2025); granica słaby/normalny 72% = P25 marży subskrypcji całej próby Benchmarkit CY-2024 (72/81/86%), zbieżna z medianą firm <5 mln USD ARR wg Aleph (72%); kontekst: średnia marża chmury wg Bessemer 65–70% · źródła: aleph_gm_2026, bm2025, bvp_2021

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 50      |       |
| słaby     | 50–72     |       |
| normalny  | 72–80     |       |
| dobry     | 80–86     |       |
| optymalny | ≥ 86      |       |

**Kontekst:** wydawca cyfrowy / think tank – subskrypcje treści (koszty redakcyjne poza COGS) · okres: miesięcznie / kwartalnie · metoda: heurystyka: obciążenie opłatami Stripe PL (1,5% + 1 zł karta EEA, BLIK 1,6% + 1 zł, Billing 0,7%) to ok. 7% przy płatności 20 zł i ok. 2,7% przy 200 zł rocznie; po narzędziach i obsłudze klienta realna marża 80–90% · źródła: stripe_pl_pricing, wm_anatomia_2026

| Ocena     | Przedział | Uwagi                                                                      |
| --------- | --------- | -------------------------------------------------------------------------- |
| krytyczny | < 70      | np. dominująca sprzedaż przez platformy pośredniczące lub sklepy aplikacji |
| słaby     | 70–80     |                                                                            |
| normalny  | 80–85     |                                                                            |
| dobry     | 85–90     |                                                                            |
| optymalny | ≥ 90      |                                                                            |

**Zastrzeżenia:**

- Benchmarkit 2025 (CY-2024): marża subskrypcji – cała próba P25 72% / mediana 81% / P75 86% (N=76, wykres s. 44), całkowita 77%, usługi profesjonalne 30%; wg ARR 1–5 mln USD P25 40% / mediana 77% / P75 90%; 5–20 mln USD 75/81/86%.
- Modele rozliczane wyłącznie za użycie mają medianę 62% (koszty mocy obliczeniowej/AI) – funkcje AI w produkcie mogą obniżać marżę.
- Jeśli koszty redakcyjne (autorzy, eksperci) są ujmowane w COGS, marża wydawcy będzie znacznie niższa i progi SaaS nie mają zastosowania.
- Platformy patronackie pobierają prowizję (Patronite 6,5% netto + operator płatności) – uwzględnij przy kanałach pośrednich.
- ‘Bottom quartile: 50%’ w Aleph 2026 nie jest zdefiniowany (granica P25 czy średnia dolnego kwartyla) i mocno odstaje od P25 = 72% w Benchmarkit CY-2024 – granica krytyczny/słaby 50% jest przez to niepewna.

### R40: Reguła 40 (Rule of 40)

- **Rozwinięcie:** Rule of 40 – reguła, według której suma tempa wzrostu przychodów i marży zysku powinna wynosić co najmniej 40% / Rule of 40 – the principle that revenue growth rate plus profit margin should be at least 40%
- **Wzór:** R40 = roczna dynamika przychodów lub ARR (%) + marża EBITDA (%) [alternatywnie marża FCF – wolnych przepływów pieniężnych]
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy równowagę między wzrostem a rentownością: szybki wzrost może usprawiedliwiać stratę, a wolny wzrost wymaga wysokiej marży. Wynik ≥40% uchodzi za wzorcowy, ale mediana prywatnych firm B2B SaaS w 2025 r. to 25%, a próg 40 przekracza ok. 15% spółek publicznych (na bazie EBITDA). Pułapki: zawsze podawaj, którą marżę użyto (EBITDA vs FCF różni medianę spółek publicznych o ok. 16 pp), a w małych organizacjach wskaźnik jest niestabilny i ma głównie charakter informacyjny.
- **Interpretation (EN):** Measures the balance between growth and profitability: fast growth can justify losses, slow growth needs high margins. 40%+ is the reference bar, but the 2025 private B2B SaaS median was 25% and only about 15% of public SaaS companies clear 40 on an EBITDA basis. Pitfalls: always state which margin is used (EBITDA vs FCF shifts the public median by ~16 pp), and in small organisations the metric is volatile and mostly informational.

**Kontekst:** prywatne firmy B2B SaaS i AI (globalnie) · okres: rocznie (CY-2025) · metoda: kwartyle źródła: P25 7% / mediana 25% / P75 43% (n=110); optymalny od klasycznego progu 40%; krytyczny <0% – heurystyka (wzrost nie pokrywa straty); mediana 25% i górny kwartyl 43% potwierdzone w Benchmarkit 2026 (S100) · źródła: aleph_r40_2026, bm2025, S100

| Ocena     | Przedział | Uwagi     |
| --------- | --------- | --------- |
| krytyczny | < 0       |           |
| słaby     | 0–7       |           |
| normalny  | 7–25      |           |
| dobry     | 25–40     |           |
| optymalny | ≥ 40      | P75 = 43% |

**Kontekst:** spółki publiczne SaaS – marża EBITDA · okres: LTM, stan na 5.05.2026 · metoda: mediana źródła 22,6%, 15% spółek ≥40; słaby 0–10% – heurystyka · źródła: aventis_r40_2026

| Ocena     | Przedział | Uwagi          |
| --------- | --------- | -------------- |
| krytyczny | < 0       |                |
| słaby     | 0–10      |                |
| normalny  | 10–22,6   |                |
| dobry     | 22,6–40   |                |
| optymalny | ≥ 40      | ok. 15% spółek |

**Zastrzeżenia:**

- Wskaźnik staje się miarodajny od ok. 15–20 mln USD ARR (Benchmarkit, Aleph); dla think tanku/wydawcy niewielkiej skali traktuj go informacyjnie i licz tylko dla komercyjnej linii (subskrypcje + wydarzenia płatne).
- Benchmarkit 2025 (CY-2024): cała próba P25 −4% / mediana 15% / P75 35%; firmy z EMEA −9% / 25% / 38%, z USA −19% / 9% / 35%.
- Na bazie FCF mediana spółek publicznych to 39,1%, a próg 40 przekracza 46% – nie mieszaj definicji.
- Spółki przekraczające 40 (FCF) wyceniane są na medianę 4,8x EV/przychody wobec 2,7x pozostałych.
- Dla organizacji non-profit zamiast EBITDA użyj marży nadwyżki operacyjnej i oznacz to w panelu.

### ARPU: Średni przychód na użytkownika (płacącego) (Average Revenue Per User)

- **Rozwinięcie:** ARPU – Average Revenue Per User: średni przychód z jednego płacącego subskrybenta w okresie (zwykle miesiąc); w B2B także ARPA – Average Revenue Per Account (na konto/instytucję) lub na stanowisko (seat) / ARPU – Average Revenue Per User: average revenue per paying subscriber per period (usually a month); in B2B also ARPA – Average Revenue Per Account, or per seat
- **Wzór:** ARPU = przychody subskrypcyjne w okresie (po rabatach) ÷ średnia liczba płacących subskrybentów w okresie; normalizuj do miesiąca (NYT: przychód kwartału ÷ średnia liczba subskrybentów ÷ liczba dni × 28)
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje realną, a nie cennikową cenę, jaką płaci przeciętny subskrybent po promocjach i rabatach. Wzrost ARPU przy stabilnej bazie to zwykle efekt wychodzenia klientów z cen promocyjnych, podwyżek dla stałych klientów lub upsellu (np. NYT: 9,94 USD za 28 dni w II kw. 2026, +3,1% r/r). Pułapki: liczenie na wszystkich zarejestrowanych zamiast na płacących, mieszanie segmentów (osoby, firmy, studenci/NGO) i kwot brutto/netto VAT; wzrost ARPU kosztem wolumenu (USA Today: −30% subskrybentów, +27% ARPU po zakończeniu intensywnego rabatowania – ‘an end to heavy discounting’) nie zawsze jest korzystny.
- **Interpretation (EN):** Shows the real, not list, price the average subscriber pays after promotions and discounts. ARPU growth on a stable base usually comes from subscribers rolling off introductory prices, price increases for tenured subscribers or upsell (e.g. NYT: $9.94 per 28 days in Q2 2026, +3.1% YoY). Pitfalls: dividing by all registered users instead of payers, mixing segments (individuals, companies, students/NGOs) and gross/net of VAT; raising ARPU at the expense of volume (USA Today: −30% subscribers, +27% ARPU after ‘an end to heavy discounting’) is not always a win.

**Kontekst:** media cyfrowe B2C – indywidualna subskrypcja cyfrowa (Polska), zł brutto/mies. po rabatach · okres: miesięcznie · metoda: heurystyka zakotwiczona w cenach rynkowych: promocja Wyborcza 89 zł/rok ≈7,4 zł/mies.; RP.PL promo 9,90 zł ‘zamiast 39 zł’ (strona nie wskazuje wprost produktu; ceny ‘od’ mogą dotyczyć planów rocznych); ‘15–20 zł’ jako typowa subskrypcja – opinia eksperta (Wirtualnemedia 2026), nie zmierzona średnia; Radio Nowy Świat ≤ ok. 26,7 zł na osobę (obliczenie własne: prawie 800 tys. zł ÷ ponad 30 tys. osób); średnia cena katalogowa najtańszego planu w CEE 7,84 EUR ≈33 zł (przeliczenie własne ~4,25 PLN/EUR); PIE 2021 (‘uczciwa cena’: dominanta 10 zł, mediana 20 zł; badanie z XII 2020, sprzed inflacji 2022–2023) – wyłącznie historyczna kotwica, nie wyznacza progów · źródła: wyborcza_blik_2026, rp_offer_2026, pie_2021, wm_anatomia_2026, mfm_pricing_2025, risj_dnr2024_pay

| Ocena     | Przedział | Uwagi                                                                          |
| --------- | --------- | ------------------------------------------------------------------------------ |
| krytyczny | < 8       | baza zdominowana przez głębokie promocje                                       |
| słaby     | 8–15      |                                                                                |
| normalny  | 15–25     | 15–20 zł – opinia eksperta (Wirtualnemedia 2026), nie zmierzony poziom rynkowy |
| dobry     | 25–35     | blisko średniej ceny katalogowej w CEE                                         |
| optymalny | ≥ 35      | blisko ceny ‘zamiast 39 zł’ RP.PL lub plany premium                            |

**Kontekst:** B2B / profesjonalne – licencja na stanowisko (seat) lub dostęp ekspercki, zł netto/mies. · okres: miesięcznie · metoda: heurystyka zakotwiczona w cennikach (ceny brutto ‘od’ – mogą dotyczyć planów rocznych przeliczonych na miesiąc): PRO.RP.PL od 39 zł/mies.; e-prenumerata ‘Rzeczpospolitej’ od 174,50 zł/mies.; DGP Premium 196 zł/mies. po pierwszym miesiącu. Kotwicę Chatham House (345 GBP/rok) usunięto – niezweryfikowana (strona zwraca 403) i dotyczy członkostwa indywidualnego, nie licencji na stanowisko · źródła: rp_offer_2026, wm_anatomia_2026

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | < 40      | brak premii B2B ponad cenę konsumencką |
| słaby     | 40–80     |                                        |
| normalny  | 80–150    |                                        |
| dobry     | 150–250   | poziom DGP Premium / e-prenumeraty RP  |
| optymalny | ≥ 250     |                                        |

**Zastrzeżenia:**

- Polscy wydawcy nie ujawniają ARPU (Agora nie podaje osobno przychodów z prenumerat Wyborczej) – progi w zł to heurystyka oparta na cennikach i badaniach postaw.
- Polska wyróżnia się rabatowaniem: 78% płacących w Polsce nie płaci pełnej ceny wobec 41% średnio w 20 krajach (DNR 2024; dane sprzed ponad 2 lat, nowszego pomiaru brak) – ARPU będzie wyraźnie niższe od cen katalogowych.
- Za newsy online płaci w Polsce 11% internautów (DNR 2026, −2 pp – zmiana nieistotna statystycznie; 2025: 13%) wobec 17% średnio w 20 krajach; 10–20% to praktyczny sufit w większości rynków.
- Europa 2025: średnia cena najtańszego planu 10,08 EUR (CEE 7,84 EUR, Europa Zachodnia 13,01 EUR); plany roczne średnio ok. 22% taniej; ceny wyłącznie katalogowe, bez rabatów.
- Segmenty studenci/NGO i licencje grupowe licz jako osobne ARPU – 21 na 101 europejskich wydawców ma zniżki studenckie, 35 ma rabaty dla wielu kont (plany firmowe i rodzinne).
- Kwoty B2C są brutto (jak w cennikach konsumenckich), a LTV i CAC wymagają ARPU netto – w UI pokazuj obie wartości lub przelicznik (netto = brutto ÷ (1 + stawka VAT)), żeby LTV i CAC nie były liczone od kwot z VAT.
- Kontekst B2B jest w zł netto, a kotwice (RP.PL, DGP) to ceny brutto ‘od’; kotwicę Chatham House usunięto jako niezweryfikowaną – do zastąpienia sprawdzalnym cennikiem polskiego think tanku lub serwisu eksperckiego.
- PIE 2021 (badanie z XII 2020) to historyczna kotwica sprzed inflacji 2022–2023 – jej wartości (10/20 zł) nie wyznaczają progów.

### Źródła grupy: Ekonomika jednostkowa

| Id                 | Źródło                                                                                                                                                                                                                                                                                    | Wydawca                                                                                                 | Data                                                                                | Weryfikacja          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| bm2025             | [2025 B2B SaaS Performance Metrics Benchmarks](https://www.hibob.com/wp-content/uploads/2025-SaaS-Performance-Metrics-Benchmarks.pdf)                                                                                                                                                     | Benchmarkit (PDF udostępniony przez partnera badania HiBob)                                             | 2025 (PDF bez daty publikacji – ‘II kw. 2025’ to przybliżenie; dane CY-2024, N=583) | tak                  |
| aleph_payback_2026 | [CAC payback period benchmarks: what's good for SaaS in 2026? (2026 SaaS & AI Performance Benchmarks)](https://www.getaleph.com/answers/cac-payback-period-saas-2026)                                                                                                                     | Aleph × Benchmarkit                                                                                     | 2026-06-01 (strona aktualizowana 2026-10)                                           | tak                  |
| aleph_ltvcac_2026  | [CLTV:CAC ratio benchmarks for SaaS in 2026](https://getaleph.com/answers/cltv-cac-ratio-saas-2026)                                                                                                                                                                                       | Aleph × Benchmarkit                                                                                     | 2026-06-01                                                                          | częściowo            |
| aleph_gm_2026      | [SaaS gross margin benchmarks 2026](https://www.getaleph.com/answers/saas-gross-margin-2026)                                                                                                                                                                                              | Aleph × Benchmarkit                                                                                     | 2026-06-01                                                                          | tak                  |
| aleph_r40_2026     | [Rule of 40 benchmarks for SaaS in 2026](https://getaleph.com/answers/rule-of-40-saas-2026)                                                                                                                                                                                               | Aleph × Benchmarkit                                                                                     | 2026-06-01                                                                          | tak                  |
| bvp_2021           | [Scaling to $100 Million](https://www.bvp.com/atlas/scaling-to-100-million)                                                                                                                                                                                                               | Bessemer Venture Partners (Atlas)                                                                       | 2021-09-21                                                                          | częściowo            |
| skok_saasmetrics   | [SaaS Metrics 2.0 – A Guide to Measuring and Improving What Matters](https://www.forentrepreneurs.com/saas-metrics-2/)                                                                                                                                                                    | David Skok, For Entrepreneurs                                                                           | brak daty publikacji (‘Update 05/2016’ dotyczy innego artykułu; stopka ©2000–2021)  | tak                  |
| aventis_r40_2026   | [Rule of 40 in SaaS (2026)](https://aventis-advisors.com/rule-of-40-in-saas-2026/)                                                                                                                                                                                                        | Aventis Advisors                                                                                        | 2026-05-06                                                                          | tak                  |
| risj_dnr2026_exec  | [Digital News Report 2026 – Executive summary](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/dnr-executive-summary)                                                                                                                                                 | Reuters Institute for the Study of Journalism                                                           | 2026-06-16                                                                          | tak                  |
| risj_dnr2026_pl    | [Digital News Report 2026 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                                                                                           | Reuters Institute for the Study of Journalism (Vadim Makarenko)                                         | 2026-06-16                                                                          | tak                  |
| risj_dnr2025_pl    | [Digital News Report 2025 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/poland)                                                                                                                                                                           | Reuters Institute for the Study of Journalism (Vadim Makarenko)                                         | 2025-06-17                                                                          | tak                  |
| risj_dnr2024_pay   | [How much do people pay for online news? And what might encourage others to pay?](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2024/how-much-do-people-pay-online-news-what-might-encourage-others-pay)                                                                 | Reuters Institute for the Study of Journalism (Craig T. Robertson), Digital News Report 2024            | 2024-06-17                                                                          | tak                  |
| mfm_pricing_2025   | [2025 European Digital News Pricing Report](https://www.funds4media.org/p/2025-european-digital-news-pricing)                                                                                                                                                                             | Media Finance Monitor / Center for Sustainable Media (P. Erdelyi i in.)                                 | 2025-07-03                                                                          | tak                  |
| nyt_q2_2026        | [The New York Times Company Reports Second-Quarter 2026 Results](https://static.poder360.com.br/uploads/2026/08/New-York-Times-2Q26.pdf)                                                                                                                                                  | The New York Times Company (kopia komunikatu na poder360.com.br; oficjalne źródło: investors.nytco.com) | 2026-08-05                                                                          | tak                  |
| rp_offer_2026      | [Oferta subskrypcji Rzeczpospolitej (czytaj.rp.pl)](https://czytaj.rp.pl/)                                                                                                                                                                                                                | Gremi Media / Rzeczpospolita                                                                            | dostęp 2026-10-18                                                                   | tak                  |
| wyborcza_blik_2026 | [Regulamin Akcji Marketingowej ‘Wyborcza.pl Wiosna z BLIKIEM 2026’](<https://www.blik.com/media/regulaminy/Płatności%20powtarzalne%20BLIK/regulamin%20Wyborcza%20x%20BLIK%202026%20(1).pdf>)                                                                                              | Wyborcza sp. z o.o. / BLIK                                                                              | 2026-04-14 (promocja 27.04–31.05.2026)                                              | tak                  |
| wm_anatomia_2026   | [Anatomia subskrypcji. Dlaczego Polacy wciąż nie chcą płacić za treści](https://www.wirtualnemedia.pl/anatomia-subskrypcji-dlaczego-polacy-wciaz-nie-chca-placic-za-tresci,7269873205061760a)                                                                                             | Wirtualnemedia.pl (Rafał Badowski)                                                                      | 2026-05-13                                                                          | tak                  |
| pie_2021           | [76 proc. internautów nie rozumie, czemu miałoby płacić za dostęp do artykułów w sieci (raport ‘Modele biznesowe mediów po pandemii’)](https://pie.net.pl/wp-content/uploads/2021/12/2021_06_08_76-proc.-internautow-nie-rozumie-czemu-mialoby-placic-za-dostep-do-artykulow-w-sieci.pdf) | Polski Instytut Ekonomiczny                                                                             | 2021-06-08 (badanie CAWI 7–10.12.2020, N=1017)                                      | tak                  |
| stripe_pl_pricing  | [Stripe Pricing – Poland](https://stripe.com/en-pl/pricing)                                                                                                                                                                                                                               | Stripe                                                                                                  | dostęp 2026-10-18                                                                   | tak                  |
| lenfest_2019       | [One subscriber or 48,000 page views? Why journalists should know the ‘unit economics’ of digital news](https://www.lenfestinstitute.org/solutions-resources/one-subscriber-or-48000-page-views-why-journalists-should-know-the-unit-economics-of-digital-news/)                          | The Lenfest Institute for Journalism (Matt Skibinski)                                                   | 2019-10-07                                                                          | tak                  |
| chatham_membership | [Individual membership – Chatham House](https://www.chathamhouse.org/become-member/individual-membership)                                                                                                                                                                                 | Chatham House (Royal Institute of International Affairs)                                                | dostęp 2026-10 (odczyt z wyników wyszukiwania; strona zwraca 403 dla automatów)     | nie da się sprawdzić |
| S100               | [2026 B2B SaaS & AI-Native Metrics](https://www.benchmarkit.ai/2026-saas-ai-native-metrics)                                                                                                                                                                                               | Benchmarkit                                                                                             | 2026 (dane CY-2025)                                                                 | tak                  |

### Zmiany po weryfikacji: Ekonomika jednostkowa

- Wszystkie źródła: dodano pole verification zgodnie z numbers_confirmed weryfikatora (tak: 18, częściowo: aleph_ltvcac_2026 i bvp_2021, nie da się sprawdzić: chatham_membership).
- bm2025: published oznaczono jako przybliżenie (PDF bez daty); excerpt uzupełniono o kwartyle marży subskrypcji całej próby 72/81/86% (s. 44), CLTV:CAC dla 5–20 mln (3,0/4,0/6,5) i 50–100 mln USD ARR (2,5/2,9/5,0), New CAC Ratio wg ACV, Expansion CAC Ratio 1,00, brakujące przedziały ACV dla CAC payback i R40 USA; dopisano odesłanie do nowszej edycji S100.
- aleph_payback_2026: usunięto z excerptu ‘górny kwartyl ≤6 mies.’ jako górny kwartyl i oznaczono to zdanie strony jako niespójne z P25 = 10 mies.; dopisano P25 15 mies. dla ACV 50–100 tys. USD.
- aleph_ltvcac_2026 (częściowo): dopisano w excerpt, że źródło nie podaje przyczyny wzrostu mediany i nie definiuje granicy dolnego kwartyla 1,1x ani P25 za 2024.
- aleph_gm_2026: dopisano w excerpt, że ‘Bottom quartile: 50%’ nie jest zdefiniowany (granica P25 czy średnia) i odstaje od P25 = 72% w bm2025.
- bvp_2021 (częściowo): poprawiono cytat – zamiast ‘najlepsi 80–85%+’ wpisano ‘Gross Margins of 85%+’ przy 1–10 mln USD ARR i ‘80%+’ przy 50 mln+ ARR; dopisano, że to portfel VC sprzed 5 lat, nie losowa próba.
- skok_saasmetrics: published zmieniono na ‘brak daty publikacji’ (‘Update 05/2016’ dotyczy innego artykułu); źródło oznaczono jako heurystykę klasyczną, nie benchmark.
- aventis_r40_2026: dopisano rozbieżność premii wyceny (artykuł 74%, z liczb 4,8x/2,7x ok. 78%).
- risj_dnr2026_exec: poprawiono cytat – ‘an end to heavy discounting’ zamiast ‘głębokiego (deep) rabatowania’; dopisano 18% w 2025.
- risj_dnr2025_pl: dopisano autora (V. Makarenko) i doprecyzowano start XYZ.pl (październik, freemium; paywall od stycznia 2025).
- risj_dnr2024_pay: oznaczono wiek danych (2024) i brak nowszego pomiaru dla Polski.
- mfm_pricing_2025: ‘35 rabaty wielostanowiskowe’ zmieniono na ‘35 ma rabaty dla wielu kont (plany firmowe i rodzinne)’; dopisano brak listy polskich tytułów.
- nyt_q2_2026: dodano dosłowny cytat o przyczynach wzrostu ARPU; oznaczono URL poder360 jako kopię zapasową i wskazano oficjalne źródło investors.nytco.com (bez zmyślania dokładnego adresu).
- rp_offer_2026: dopisano, że strona nie wskazuje produktu ceny 39 zł, a ceny ‘od’ mogą dotyczyć planów rocznych przeliczonych na miesiąc.
- wm_anatomia_2026: ‘15–20 zł’ oznaczono jako opinię eksperta, nie zmierzoną średnią; Radio Nowy Świat doprecyzowano do ≤ ok. 26,7 zł na osobę.
- pie_2021: oznaczono jako przestarzałą, historyczną kotwicę sprzed inflacji 2022–2023, która nie wyznacza progów.
- stripe_pl_pricing: doprecyzowano, że Billing 0,7% dotyczy modelu pay-as-you-go (alternatywa: plan od 2500 zł/mies.); dopisano potwierdzone wyliczenia narzutu 7,2% / 2,7%.
- lenfest_2019: URL zmieniono na kanoniczny; dopisano, że CLV 217 USD jest liczone na przychodzie, nie na marży, i że to dane USA z 2019 r.
- chatham_membership (url_ok=false, nie da się sprawdzić): excerpt oznaczono jako NIEZWERYFIKOWANY i jako członkostwo indywidualne, nie licencję na stanowisko.
- Dodano źródło S100 (Benchmarkit, 2026 B2B SaaS & AI-Native Metrics, CY-2025) wskazane przez weryfikatora jako nowsza edycja bm2025.
- ltv: usunięto błędne uzasadnienie bazy (22,5 zł nie jest środkiem przedziału 15–20 zł ani medianą PIE 20 zł, a było kwotą brutto); metodę przepisano na krotność miesięcznej marży netto m (8/17/33/50 × m) z m ≈ 15 zł.
- ltv: z source_ids usunięto pie_2021 (historyczna kotwica, nie wyznacza progów) i dodano risj_dnr2024_pay (78% płacących poniżej ceny katalogowej – argument za niższym ARPU).
- ltv: przedziały zmieniono z 150/300/600/1000 zł na 120/250/500/750 zł (m ≈ 15 zł) wg propozycji weryfikatora; notatki opisują krotność m i odpowiadający churn.
- ltv: caveat o Lenfest 2019 uzupełniono – CLV 217 USD liczone na przychodzie, nie na marży; caveat o skalowaniu progów przepisano na krotność m.
- ltv: dodano caveat o liczeniu LTV od ARPU netto i o wpływie stawki VAT na m.
- cac: bazę zmieniono na m ≈ 15 zł netto (zamiast ≈19 zł z ARPU 22,5 zł brutto); przedziały 60/115/170/230 zł zmieniono na 45/90/135/180 zł (3/6/9/12 × m), spójnie z cac_payback_months B2C.
- cac: z source_ids usunięto pie_2021 (historyczna kotwica) i dodano risj_dnr2024_pay – jak w ltv.
- cac: caveats – wzór przeliczenia oparto na ARPU netto; dodano caveat o wpływie stawki VAT.
- new_cac_ratio: próg krytyczny obniżono z >4,0 (≈60 mies. zwrotu) do >3,0 (≈45 mies.) wg sugestii weryfikatora; słaby = 2,82–3,0.
- new_cac_ratio: podpięto S100 (Benchmarkit 2026) – w metodzie zaznaczono, że daje tylko Blended CAC Ratio 1,30 USD, a kwartyle pozostają z CY-2024.
- new_cac_ratio: dodano caveats o braku kwartyli CY-2025, o niespójności z CAC payback (≈30 vs 18 mies., różne podpróby) i o wąskim przedziale słabym.
- ltv_cac_ratio (B2B): przy ‘P25 ≈1,1x’ dopisano w metodzie i notatce, że Aleph mówi o ‘bottom quartile’ bez definicji granicy; Skok oznaczony jako heurystyka klasyczna bez daty.
- ltv_cac_ratio: drugi przedział ‘dobry’ (≥8x) w obu kontekstach rozróżniono notatką ‘dobry – sprawdź …’ (etykietę zostawiono ze standardowego słownika, by nie łamać mapowania w UI).
- ltv_cac_ratio (B2C): przedziały wyrównano do B2B zgodnie z metodą ‘te same progi co B2B’ – słaby 1–3 (był 1–2), normalny 3–4 (był 2–3), dobry 4–5 (był 3–5); poprzednie progi oceniały wyniki poniżej minimum 3:1 jako normalne.
- ltv_cac_ratio: usunięto niepopartą tezę, że wzrost mediany do 4,1x ‘wynika głównie z cięcia kosztów, nie z poprawy retencji’ – źródło nie podaje przyczyny.
- ltv_cac_ratio: caveat o rozbieżności źródeł uzupełniono o CLTV:CAC 5–20 mln i 50–100 mln USD ARR (bm2025) i brak definicji dolnego kwartyla; dodano caveat o Skoku jako heurystyce bez daty.
- cac_payback_months (niskie ACV): granicę dobry/normalny przesunięto z 9 na 11 mies. (mediana CY-2025 dla ACV <5 tys. USD), normalny/słaby z 12 na 14 (heurystyka – brak P75 za 2025); optymalny ≤6 i krytyczny >18 bez zmian.
- cac_payback_months: dodano caveats o niespójnym ‘≤6 mies.’ w Aleph, o podstawie nowych progów dla niskiego ACV i o Skoku jako heurystyce bez daty.
- subscription_gross_margin (SaaS): granicę słaby/normalny przesunięto z 70% (heurystyka) na 72% (P25 marży subskrypcji Benchmarkit CY-2024); słaby = 50–72%.
- subscription_gross_margin: dopisano kwartyle marży subskrypcji całej próby CY-2024 (72/81/86%) i caveat o niezdefiniowanym ‘Bottom quartile: 50%’ w Aleph.
- rule_of_40: podpięto S100 (Benchmarkit 2026) do kontekstu firm prywatnych – potwierdza medianę 25% i górny kwartyl 43%; liczby i przedziały bez zmian (weryfikator: brak poprawek).
- arpu: w interpretacji PL/EN dopisano przyczynę wzrostu ARPU USA Today wg źródła – ‘an end to heavy discounting’.
- arpu (B2C): w metodzie i notatce ‘15–20 zł’ oznaczono jako opinię eksperta; PIE 2021 oznaczono jako historyczną kotwicę niewyznaczającą progów; Radio Nowy Świat poprawiono z ≈27 na ≤ ok. 26,7 zł; dopisano niejednoznaczność ceny 39 zł RP.PL.
- arpu (B2B): usunięto chatham_membership z source_ids i z metody (url_ok=false, kwoty niezweryfikowane, członkostwo indywidualne, nie licencja na stanowisko); przedziały zachowują podstawę w rp_offer_2026 i wm_anatomia_2026, metoda pozostaje heurystyką, confidence już ‘niska’.
- arpu: caveat MFM poprawiono na ‘35 ma rabaty dla wielu kont (plany firmowe i rodzinne)’; caveat brutto/netto rozszerzono o wymóg pokazania w UI obu wartości lub przelicznika dla LTV/CAC.
- arpu: caveats DNR 2024 i DNR 2026 uzupełniono o wiek danych i nieistotność zmiany −2 pp; dodano caveats o brutto ‘od’ w kontekście B2B (usunięty Chatham) i o PIE 2021 jako historycznej kotwicy.

## 4. Lejek i konwersja

### V2R: Konwersja odwiedzający → rejestracja (Visitor-to-registration conversion rate)

- **Rozwinięcie:** V2R – Visitor-to-Registration Rate: odsetek odwiedzających, którzy zakładają bezpłatne konto (registration wall, konto freemium, rejestracja do newslettera z kontem) / V2R – Visitor-to-Registration Rate: share of visitors who create a free account (registration wall, freemium account)
- **Wzór:** Przepływ: nowe rejestracje w okresie / unikalni odwiedzający w okresie × 100%. Wariant stanu (known users): rozpoznani/zalogowani unikalni użytkownicy w miesiącu / wszyscy unikalni użytkownicy w miesiącu × 100%. Wariant regwall: rejestracje / unikalne wyświetlenia modalu rejestracji × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jak skutecznie zamieniamy anonimowy ruch w rozpoznanych czytelników, z którymi da się budować relację (newsletter, CRM) i którzy wg Piano kupują 30–45 razy częściej niż anonimowi. Zawsze czytaj go z mianownikiem: udział rozpoznanych wśród wszystkich użytkowników (zwykle 1–3%) to inna wielkość niż konwersja samego modalu rejestracji (kilka procent). Pułapki: rejestracje jednorazowe (zakładanie kont na różne maile dla dostępu do jednego tekstu), boty w mianowniku oraz regwall przed paywallem, który obniża ekspozycję ofert płatnych.
- **Interpretation (EN):** Shows how well anonymous traffic is turned into known readers who can be nurtured (newsletter, CRM) and who, per Piano, buy 30–45 times more often than anonymous users. Always read it with its denominator: the known-user share of all users (typically 1–3%) is a different quantity from the conversion of the registration modal itself (a few percent). Pitfalls: throwaway registrations, bots in the denominator, and a registration wall placed before the paywall that reduces paid-offer exposure.

**Kontekst:** Wydawca cyfrowy (metered/freemium) – udział rozpoznanych (zarejestrowanych/zalogowanych) wśród miesięcznych unikalnych użytkowników · okres: miesięcznie · metoda: mediana Piano 1,2% (dane I 2022–IX 2024, globalnie) jako granica normalny/dobry – spójnie z V2P (mediana = granica normalny/dobry); mediana Mather Q2 2022 1,5% (103 rynki, głównie prasa lokalna USA) mieści się w przedziale dobrym; best-in-class Mather 3,3% (średnia rynków wzorcowych wybranych indeksem sukcesu subskrypcyjnego, nie percentyl) jako próg optymalny; progi 0,5 i 0,8 heurystyczne · źródła: piano_2024, mather_2022, piano_nypa_2025

| Ocena     | Przedział | Uwagi                                                                                                             |
| --------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| krytyczny | < 0,5     | praktycznie brak identyfikacji czytelników – heurystyka                                                           |
| słaby     | 0,5–0,8   | heurystyka                                                                                                        |
| normalny  | 0,8–1,2   | do mediany Piano (1,2%; dane I 2022–IX 2024)                                                                      |
| dobry     | 1,2–3,3   | od mediany Piano do best-in-class Mather; mediana Mather Q2 2022 (1,5%) mieści się w tym przedziale               |
| optymalny | ≥ 3,3     | best-in-class Mather (3,3%) – średnia rynków wzorcowych wybranych indeksem sukcesu subskrypcyjnego, nie percentyl |

**Kontekst:** Registration wall – unikalne wyświetlenia modalu rejestracji → rejestracja · okres: miesięcznie / cały okres działania regwalla · metoda: heurystyka zakotwiczona w studium przypadku Mather (3,14% średnio, mały wydawca z Ameryki Płn.); brak publicznego przekrojowego benchmarku · źródła: mather_regwall, piano_inma_2023

| Ocena     | Przedział | Uwagi                                                      |
| --------- | --------- | ---------------------------------------------------------- |
| krytyczny | < 1       | heurystyka                                                 |
| słaby     | 1–2       | heurystyka                                                 |
| normalny  | 2–4       | okolice 3,14% z case study Mather                          |
| dobry     | 4–8       | heurystyka                                                 |
| optymalny | ≥ 8       | heurystyka – typowe dla ruchu bezpośredniego/z newslettera |

**Kontekst:** SaaS B2B / konto freemium (np. bezpłatne konto instytucjonalne) – odwiedzający → założenie konta freemium · okres: miesięcznie · metoda: heurystyka (pewność kontekstu: niska): górna granica normalnego = przykład ilustracyjny ChartMogul 2026 dla freemium (9%; nie mediana); First Page Sage 2025: odwiedzający→freemium 13,3% organic / 15,9% paid (86 firm, klienci agencji – próba niereprezentatywna) jako próg optymalny; dolne progi heurystyczne · źródła: chartmogul_2026, fps_2025

| Ocena     | Przedział | Uwagi                                                                             |
| --------- | --------- | --------------------------------------------------------------------------------- |
| krytyczny | < 2       | heurystyka                                                                        |
| słaby     | 2–5       | heurystyka                                                                        |
| normalny  | 5–9       | heurystyka; do przykładu ilustracyjnego ChartMogul dla freemium (9%, nie mediana) |
| dobry     | 9–13,3    | do średniej First Page Sage odwiedzający→freemium (organic 13,3%)                 |
| optymalny | ≥ 13,3    | co najmniej średnia First Page Sage organic (13,3%; paid 15,9%; klienci agencji)  |

**Kontekst:** SaaS B2B / trial opt-in (bez karty, np. testowy dostęp instytucjonalny) – odwiedzający → rozpoczęcie triala · okres: miesięcznie · metoda: heurystyka (pewność kontekstu: niska): dolna granica normalnego = przykład ilustracyjny ChartMogul 2026 dla triala (4,5%; nie mediana); First Page Sage 2025: odwiedzający→trial opt-in 8,5% organic / 7,1% paid (klienci agencji) jako granica dobrego; próg krytyczny <2 przeniesiony heurystycznie z dotychczasowego zestawu SaaS; brak podstawy do progu optymalnego · źródła: chartmogul_2026, fps_2025

| Ocena     | Przedział | Uwagi                                                                          |
| --------- | --------- | ------------------------------------------------------------------------------ |
| krytyczny | < 2       | heurystyka                                                                     |
| słaby     | 2–4,5     | heurystyka; poniżej przykładu ilustracyjnego ChartMogul dla triala (4,5%)      |
| normalny  | 4,5–8,5   | od przykładu ChartMogul (4,5%) do średniej First Page Sage organic (8,5%)      |
| dobry     | ≥ 8,5     | co najmniej średnia First Page Sage organic (8,5%; paid 7,1%; klienci agencji) |

**Kontekst:** SaaS B2B / trial opt-out (karta wymagana z góry) – odwiedzający → rozpoczęcie triala · okres: miesięcznie · metoda: heurystyka (pewność kontekstu: niska): First Page Sage 2025 odwiedzający→trial opt-out 2,5% organic / 2,2% paid (klienci agencji) jako dolna granica normalnego; przykład ilustracyjny ChartMogul 2026 dla triala z kartą (3,5%; nie mediana) jako granica dobrego; brak podstawy do progów krytycznego i optymalnego · źródła: chartmogul_2026, fps_2025

| Ocena    | Przedział | Uwagi                                                                                        |
| -------- | --------- | -------------------------------------------------------------------------------------------- |
| słaby    | < 2,5     | poniżej średniej First Page Sage organic (2,5%); paid 2,2% – heurystyka                      |
| normalny | 2,5–3,5   | od średniej First Page Sage organic (2,5%) do przykładu ChartMogul dla triala z kartą (3,5%) |
| dobry    | ≥ 3,5     | co najmniej przykład ChartMogul dla triala z kartą (3,5%)                                    |

**Zastrzeżenia:**

- Piano (2023): wprowadzenie registration wall przed paywallem obniżyło odsetek użytkowników widzących ofertę płatną średnio o 36% – mierz V2R razem z odsetkiem trafiających na paywall.
- Kontekst registration wall opiera się na jednym studium przypadku Mather (artykuł z 10.02.2022) – przedziały mają charakter heurystyczny.
- Benchmarki SaaS (ChartMogul, First Page Sage) dotyczą stron produktowych, nie serwisów treściowych – stosuj je do ścieżek B2B (konto instytucjonalne, trial dla firm).
- Brak publicznych danych dla Polski; mediany Piano i Mather pochodzą głównie z rynków USA/globalnego.
- Konteksty SaaS (freemium, trial opt-in, trial opt-out) mają pewność niską: wartości ChartMogul 9% / 4,5% / 3,5% to przykład ilustracyjny, nie mediana, a First Page Sage opiera się na klientach agencji (próba niereprezentatywna).

### R2P: Konwersja zarejestrowany → płacący (Registered-to-paid conversion rate)

- **Rozwinięcie:** R2P – Registered-to-Paid Rate: odsetek zarejestrowanych (bezpłatnych) użytkowników, którzy kupują płatny dostęp / R2P – Registered-to-Paid Rate: share of registered (free) users who purchase paid access
- **Wzór:** Kohortowo: zarejestrowani w miesiącu M, którzy kupili płatny dostęp w ciągu 12 mies. / wszyscy zarejestrowani w miesiącu M × 100%. Wariant stanu (newsletter freemium): płacący subskrybenci / wszyscy subskrybenci newslettera × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, czy rejestracja jest realnym pomostem do płatności, a nie tylko zbieraniem adresów. Wg Piano zarejestrowani kupują 30–45 razy częściej niż anonimowi, ale średnio tylko ok. 3% z nich kupuje w ciągu roku, a konwersja rozkłada się w czasie (ok. 21% konwersji w 1. miesiącu, ponad 40% w miesiącach 2–12). Pułapki: mieszanie wskaźnika kohortowego ze stanem, zbyt krótkie okno pomiaru oraz traktowanie mnożnika vs anonimowi jako efektu przyczynowego (zarejestrowani są z definicji bardziej zaangażowani).
- **Interpretation (EN):** Measures whether registration is a real bridge to payment rather than mere address collection. Per Piano, registered users buy 30–45 times more often than anonymous ones, yet on average only about 3% buy within a year, and conversions are spread over time (about 21% in month 1, over 40% in months 2–12). Pitfalls: mixing cohort and stock definitions, too short a measurement window, and reading the multiplier vs anonymous users as causal (registered users are self-selected and more engaged).

**Kontekst:** Wydawca cyfrowy – kohorta zarejestrowanych, zakup w ciągu 12 miesięcy od rejestracji · okres: kohorta 12-miesięczna · metoda: heurystyka zakotwiczona w średniej ok. 3% (Piano 2022 via Digiday – średnia/odsetek ogólny, nie mediana; przy prawoskośnym rozkładzie 0,5–12% mediana jest prawdopodobnie niższa) i zakresie od ok. 0,5% do ponad 12% między wydawcami (komunikat Piano 2022 nie mówi wprost, że zakres dotyczy kohorty zarejestrowanych); progi pośrednie interpolowane heurystycznie; pewność kontekstu: średnia/niska · źródła: digiday_2022, piano_2022_pr, piano_nypa_2025, piano_inma_2023

| Ocena     | Przedział | Uwagi                                                 |
| --------- | --------- | ----------------------------------------------------- |
| krytyczny | < 0,5     | poniżej dolnego krańca zakresu Piano                  |
| słaby     | 0,5–1,5   | heurystyka                                            |
| normalny  | 1,5–3     | do średniej Piano (ok. 3%) – średnia, nie mediana     |
| dobry     | 3–8       | powyżej średniej Piano (ok. 3%; średnia, nie mediana) |
| optymalny | ≥ 8       | zbliżenie do najlepszych serwisów (>12%)              |

**Kontekst:** Newsletter freemium – płacący / wszyscy subskrybenci listy (stan) · okres: stan na koniec miesiąca · metoda: kwartyle beehiiv 2026: mediana 0,62%, górne 25% ok. 2–5%, górne 10% w finansach/ekonomii 18,7–30,8% (Investing 18,69%, Finance 20,00%, Economy 30,80%); wzór płacący / wszyscy subskrybenci jest dorozumiany; próg krytyczny heurystyczny · źródła: beehiiv_2026

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| krytyczny | < 0,2     | heurystyka                                       |
| słaby     | 0,2–0,62  | poniżej mediany beehiiv                          |
| normalny  | 0,62–2    | mediana – dolna granica P75                      |
| dobry     | 2–5       | zakres P75 (top 25%)                             |
| optymalny | ≥ 5       | powyżej P75; P90 w finansach/ekonomii 18,7–30,8% |

**Zastrzeżenia:**

- Dane kohortowe Piano pochodzą z raportu 2022 – nowszej publicznej liczby R2P w okresie 12 mies. nie znaleziono; prezentacja Piano z 2025 r. (NYPA) podaje jedynie mnożnik 30× względem anonimowych (przypisany danym Piano 2024; na stronie raportu Piano 2024 go nie ma).
- W teście Piano (INMA, 2023) zarejestrowani konwertowali 12,52% vs 0,07% anonimowych na tej samej ofercie – to efekt selekcji, nie dowód, że wymuszenie rejestracji podniesie sprzedaż: ścieżka przez rejestrację przegrała w 3 z 4 testów (3× „Result: NO”, 1× „YES”).
- Benchmark beehiiv dotyczy płatnych newsletterów na platformie beehiiv (głównie anglojęzycznych), a nie think tanków; liczy stan, nie kohortę.
- Do panelu: pokazuj rozkład czasu do konwersji (0–30, 31–90, 91–365 dni), bo okno pomiaru zmienia wynik.

### V2P: Konwersja odwiedzający → płacący (paid conversion rate wydawcy) (Visitor-to-paid conversion rate (publisher paid conversion rate))

- **Rozwinięcie:** V2P – Visitor-to-Paid Rate: relacja płacących subskrybentów do zasięgu (stan; definicje wydawców się różnią) lub nowych płatnych subskrypcji do miesięcznych użytkowników (przepływ) / V2P – Visitor-to-Paid Rate: paying subscribers relative to reach (stock; publisher definitions vary) or new paid subscriptions relative to monthly users (flow)
- **Wzór:** Stan: aktywni płacący subskrybenci cyfrowi / średni miesięczny zasięg unikalnych użytkowników × 100% (definicje wydawców się różnią). Przepływ: nowe płatne subskrypcje w miesiącu / unikalni użytkownicy w miesiącu × 100% (Mather raportuje to jako konwersje na 1 mln użytkowników).
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Główny wskaźnik efektywności modelu reader revenue: jaka część zasięgu płaci. Stan pokazuje skumulowany efekt (akwizycja minus churn), przepływ – bieżącą skuteczność sprzedaży. Pułapki: wskaźnik rośnie także wtedy, gdy spada ruch (mniejszy mianownik), definicje się różnią (unikalni vs sesje, triale i mocno przecenione subskrypcje w liczniku), a małe, celowe zasięgi niszowych marek eksperckich dają naturalnie wyższe wartości niż media masowe.
- **Interpretation (EN):** The core efficiency metric of a reader-revenue model: what share of reach pays. The stock view shows the cumulative effect (acquisition minus churn), the flow view shows current selling effectiveness. Pitfalls: the ratio also rises when traffic falls (smaller denominator), definitions differ (uniques vs sessions, trials and deeply discounted subs in the numerator), and small targeted audiences of niche expert brands naturally yield higher values than mass media.

**Kontekst:** Wydawca cyfrowy – stan: płacący subskrybenci cyfrowi / średni miesięczny zasięg (definicje wydawców się różnią) · okres: stan miesięczny · metoda: mediana 0,6% i górny kwartyl ≥1,4% (INMA, 166 wydawców, koniec 2022 r. – najnowsze publicznie dostępne; via Press Gazette 2024, artykuł nie podaje definicji INMA): P50–P75 = dobry, >P75 = optymalny; progi poniżej mediany heurystyczne · źródła: pressgazette_2024, dnr_2026, dnr_2026_pl

| Ocena     | Przedział | Uwagi                                                                                                                                                                                                 |
| --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | < 0,2     | heurystyka                                                                                                                                                                                            |
| słaby     | 0,2–0,4   | heurystyka                                                                                                                                                                                            |
| normalny  | 0,4–0,6   | do mediany INMA                                                                                                                                                                                       |
| dobry     | 0,6–1,4   | mediana – górny kwartyl INMA                                                                                                                                                                          |
| optymalny | ≥ 1,4     | górny kwartyl INMA; liderzy specjalistyczni w rankingu Press Gazette (subskrybenci / średnia miesięczna liczba odwiedzających wg Similarweb – inna definicja): The Athletic ok. 26%, Barron's ok. 19% |

**Kontekst:** Wydawca cyfrowy – przepływ: nowe płatne subskrypcje w miesiącu / miesięczni unikalni użytkownicy · okres: miesięcznie · metoda: Mather Q2 2022: mediana 513 konwersji na 1 mln użytkowników (0,051%), best-in-class 1263 (0,126%; średnia rynków wzorcowych, nie percentyl; próba głównie prasa lokalna USA); iloczyn ekspozycji i konwersji Piano XII 2024 (16,3% × 0,20% ≈ 0,033%) jako kotwica przedziału normalnego (wyliczenie własne) · źródła: mather_2022, piano_nypa_2025

| Ocena     | Przedział   | Uwagi                                                                       |
| --------- | ----------- | --------------------------------------------------------------------------- |
| krytyczny | < 0,01      | poniżej 100 konwersji na 1 mln użytkowników – heurystyka                    |
| słaby     | 0,01–0,03   | heurystyka                                                                  |
| normalny  | 0,03–0,051  | od poziomu wynikającego z danych Piano do mediany Mather                    |
| dobry     | 0,051–0,126 | mediana – best-in-class Mather                                              |
| optymalny | ≥ 0,126     | best-in-class Mather (1263 / mln; średnia rynków wzorcowych, nie percentyl) |

**Zastrzeżenia:**

- Sufit popytu w Polsce jest niższy: wg Reuters Institute DNR 2026 za newsy online płaci 11% Polaków (−2 pp r/r, ale wg metodologii DNR zmiana o 2 pp lub mniej nie jest istotna statystycznie) wobec 17% w tzw. pay basket 20 krajów, w których paywalle są powszechne (18% w 2025).
- Najnowsza publiczna mediana INMA dotyczy końca 2022 r.; nowsze dane INMA Subscription Benchmarks są dostępne tylko dla członków.
- Nie porównuj wariantu stanu z przepływem – różnią się o rząd wielkości.
- Dla think tanku z małym, eksperckim zasięgiem wartość >1,4% stanu jest osiągalna; oceniaj trend razem z liczbą unikalnych użytkowników.

### PSCR: Konwersja paywalla (trafienie na paywall → subskrypcja) (Paywall conversion rate (paywall stop to subscription))

- **Rozwinięcie:** PSCR – Paywall Stop Conversion Rate: odsetek użytkowników zatrzymanych przez paywall lub ofertę płatną, którzy kupują subskrypcję (u Piano: paid conversion rate) / PSCR – Paywall Stop Conversion Rate: share of users stopped by the paywall or a paid offer who buy a subscription (Piano: paid conversion rate)
- **Wzór:** unikalni użytkownicy, którzy kupili subskrypcję po zobaczeniu paywalla/oferty płatnej / unikalni użytkownicy, którzy zobaczyli ≥1 paywall lub ofertę płatną × 100% (miesięcznie)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Efektywność samego momentu sprzedaży: typowo ok. 0,2%, czyli ok. 2 zakupy na 1000 zatrzymanych; w badaniu Notre Dame/Georgia Tech 59,2% czytelników po trafieniu na paywall od razu opuszczało serwis. Wskaźnik spada mechanicznie, gdy zaostrzamy paywall (zatrzymujemy też mniej zaangażowanych), choć łączna sprzedaż może rosnąć – oceniaj go zawsze razem z odsetkiem trafiających na paywall i konwersją na 1 mln użytkowników. Nie mieszaj konwersji na unikalnego użytkownika z konwersją na wyświetlenie.
- **Interpretation (EN):** Effectiveness of the selling moment itself: typically about 0.2%, i.e. roughly 2 purchases per 1,000 users stopped; in the Notre Dame/Georgia Tech study 59.2% of readers left the site immediately after hitting the paywall. The rate falls mechanically when the paywall is tightened (less engaged users get stopped too) even if total sales grow, so always read it together with paywall hit rate and conversions per million users. Do not mix per-user and per-impression conversion.

**Kontekst:** Paywall metered/freemium/hybrydowy wydawcy cyfrowego – unikalni zatrzymani → zakup · okres: miesięcznie · metoda: mediany: Piano XII 2024 0,20% globalnie (Europa 0,15%, USA 0,34%), Mather Q2 2022 0,22%, best-in-class Mather 0,58% (średnia rynków wzorcowych, nie percentyl); trend: mediana Piano spadła w I 2023 do ok. 0,11–0,12% (z 0,44% na początku 2021) i odbiła do 0,20% w XII 2024; potwierdzenie: Notre Dame/Georgia Tech 2026 (~0,2% zatrzymań kończy się zakupem); próg krytyczny heurystyczny · źródła: piano_nypa_2025, mather_2022, notre_dame_2026, piano_inma_2023

| Ocena     | Przedział | Uwagi                                                                                   |
| --------- | --------- | --------------------------------------------------------------------------------------- |
| krytyczny | < 0,05    | heurystyka; najniższa wartość (Bottom) w rozkładzie Piano, I 2023: 0,02%                |
| słaby     | 0,05–0,15 | poniżej mediany europejskiej Piano                                                      |
| normalny  | 0,15–0,22 | mediana Europa – mediana Mather/Piano global                                            |
| dobry     | 0,22–0,58 | powyżej mediany do best-in-class Mather                                                 |
| optymalny | ≥ 0,58    | best-in-class Mather (0,58%); najwyższa wartość (Top) w rozkładzie Piano, I 2023: 3,95% |

**Zastrzeżenia:**

- Piano (dane II 2025), mediana konwersji wg szablonu oferty: landing page 2,73%, hard paywall 0,11%, soft paywall 0,011%, ribbon (pasek) 0,005% – inne szablony wymagają osobnych progów.
- Europa konwertuje słabiej niż USA (Piano XII 2024: 0,15% vs 0,34%) – dla polskiego wydawcy realistyczny punkt odniesienia to mediana europejska.
- Mather (24.06.2024, 118 serwisów po zmianie paywalla w III 2023): zaostrzenie paywalla podwoiło liczbę prób sprzedaży (+100%) przy spadku konwersji o 20%, co netto dało więcej subskrypcji.
- Badanie Notre Dame/Georgia Tech: ok. 1 na 10 zatrzymanych skutecznie obchodzi paywall, z czego 81% przez nową tożsamość przeglądarki (81% to udział wśród skutecznych obejść, nie wśród wszystkich zatrzymań) – szczelność paywalla wpływa na mianownik.
- Trend Piano: mediana konwersji paywalla spadła z 0,44% (początek 2021) do ok. 0,11–0,12% (I 2023), a w XII 2024 wynosiła 0,20% – porównuj wynik z medianą z tego samego okresu.

### T2P: Konwersja okresu próbnego na płatny (trial → paid) (Trial-to-paid conversion rate)

- **Rozwinięcie:** T2P – Trial-to-Paid Rate: odsetek użytkowników okresu próbnego, którzy przechodzą na płatny plan; opt-in = trial bez karty, opt-out = karta wymagana z góry i automatyczne obciążenie po trialu / T2P – Trial-to-Paid Rate: share of trial users who convert to a paid plan; opt-in = no card required, opt-out = card required upfront with automatic charge after the trial
- **Wzór:** użytkownicy, którzy po zakończeniu trialu dokonali pierwszej płatności / użytkownicy, którzy rozpoczęli trial w kohorcie × 100% (osobno dla opt-in i opt-out)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Pokazuje, czy trial przekonuje do zapłaty. Trial z kartą konwertuje kilkukrotnie lepiej (ChartMogul 2026: ponad 5×), ale zbiera mniej rejestracji, więc porównuj też liczbę płacących na 1000 odwiedzających. Pułapki: opt-out liczy często jako konwersję już jedną płatność (zestawiaj z churnem 2.–3. miesiąca), a mieszanie kohort opt-in/opt-out w jednym wskaźniku daje bezużyteczną średnią.
- **Interpretation (EN):** Shows whether the trial persuades users to pay. Card-required trials convert several times better (ChartMogul 2026: over 5x) but attract fewer sign-ups, so also compare paying customers per 1,000 visitors. Pitfalls: opt-out conversion often counts a single payment (pair it with month 2–3 churn), and blending opt-in and opt-out cohorts yields a meaningless average.

**Kontekst:** Trial opt-in (bez karty) – SaaS/B2B, w tym dostęp instytucjonalny · okres: kohorta trialu (pomiar do 6 mies. od rejestracji) · metoda: ChartMogul 2026 (200 produktów, w tym 22% głównie B2C/hybrydowych; I 2026, okno 6 mies.): trial bez karty good = P50 4–6%, great = P75 10–15%; 20% produktów z trialem <2,5%; mediana 8% dotyczy wszystkich modeli łącznie z trialami z kartą i nie jest kotwicą dla opt-in; First Page Sage 2025 (18,2% organic / 17,4% paid; klienci agencji) tylko jako górna kotwica · źródła: chartmogul_2026, fps_2025

| Ocena     | Przedział | Uwagi                                                                                                         |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| krytyczny | < 2,5     | dolne 20% produktów z trialem (<2,5%, ChartMogul)                                                             |
| słaby     | 2,5–4     | poniżej przedziału P50 ChartMogul (good 4–6%)                                                                 |
| normalny  | 4–6       | przedział P50 ChartMogul (good 4–6%)                                                                          |
| dobry     | 6–12      | od P50 do P75 ChartMogul (great 10–15%)                                                                       |
| optymalny | ≥ 12      | środek przedziału P75 ChartMogul (10–15%) i wyżej; First Page Sage 18,2% jako górna kotwica (klienci agencji) |

**Kontekst:** Trial opt-out (karta wymagana z góry) · okres: kohorta trialu · metoda: ChartMogul 2026: good = P50 (25–35%, mediana 30%), great = P75 (50–60%); First Page Sage 2025: 48,8% organic / 51% paid (klienci agencji; konwersja liczona po jednym płatnym miesiącu); RevenueCat (aplikacje, dane za 2025, data publikacji niepotwierdzona): 25,5–42,5% wg długości trialu · źródła: chartmogul_2026, fps_2025, revenuecat_2026

| Ocena     | Przedział | Uwagi                                       |
| --------- | --------- | ------------------------------------------- |
| krytyczny | < 15      | heurystyka                                  |
| słaby     | 15–25     | poniżej progu good                          |
| normalny  | 25–35     | good = P50 ChartMogul (25–35%); mediana 30% |
| dobry     | 35–50     | do poziomu First Page Sage                  |
| optymalny | ≥ 50      | great = P75 ChartMogul (50–60%)             |

**Zastrzeżenia:**

- W mediach triale to wyjątek: wg Piano (prezentacja z 2025 r.) darmowy trial oferuje tylko 8% klientów-wydawców, a subskrypcje bez triala mają lepszą retencję niż płatne triale.
- First Page Sage liczy konwersję opt-out już po jednym płatnym miesiącu – wynik zawyżony względem trwałej konwersji.
- Europa Zachodnia (RevenueCat, aplikacje, dane za 2025): mediana trial→paid 29,7%, niżej niż Ameryka Płn. (34,2%); triale 17–32 dni: 42,5% vs ≤4 dni: 25,5%.
- Karta z góry zmniejsza rejestracje (przykład ilustracyjny ChartMogul, nie mediana: 3,5% vs 4,5% odwiedzających), ale daje 10,5 vs 3,6 płacących na 1000 odwiedzających.

### CAR: Wskaźnik porzucenia checkoutu / koszyka (Checkout / cart abandonment rate)

- **Rozwinięcie:** CAR – Checkout (Cart) Abandonment Rate: odsetek rozpoczętych procesów zakupu (checkout lub koszyk), które nie kończą się płatnością / CAR – Checkout (Cart) Abandonment Rate: share of started purchase flows (checkout or cart) that do not end in payment
- **Wzór:** Checkout subskrypcji: (1 − zakończone płatności / rozpoczęte checkouty) × 100%. E-commerce/bilety (Baymard): (1 − złożone zamówienia / utworzone koszyki) × 100%.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, ile osób z gotową intencją zakupu gubimy w formularzu i płatności – to zwykle najtańsza do odzyskania strata w lejku. Wynik zależy krytycznie od definicji startu (klik Subskrybuj, wejście na stronę płatności, dodanie do koszyka), więc w panelu trzymaj jedną definicję. Pułapki: płatności odroczone (przelew, faktura pro forma w B2B) liczone jako porzucenia oraz wymuszanie zakładania konta/hasła w trakcie płatności.
- **Interpretation (EN):** Shows how many people with clear purchase intent are lost in the form and payment step – usually the cheapest funnel leak to fix. The value depends heavily on how a start is defined (Subscribe click, payment page view, add-to-cart), so keep one definition in the dashboard. Pitfalls: deferred payments (bank transfer, B2B pro-forma invoice) counted as abandonments, and forcing account/password creation mid-checkout.

**Kontekst:** Checkout subskrypcji cyfrowej (start checkoutu → brak płatności) · okres: miesięcznie · metoda: heurystyka do weryfikacji (pewność kontekstu: niska): odwrotność mediany INMA Q2 2026 (38% ukończeń → 62% porzuceń; 149 marek) i mediany INMA ok. 2024 (18% ukończeń → 82%) – obie niezweryfikowane (strona INMA zwraca HTTP 403, Cloudflare); jedyna zweryfikowana kotwica: Piano 2022 – 42,4% ukończeń na desktopie (57,6% porzuceń) i 19,7% na mobile (80,3% porzuceń); skrajne progi heurystyczne · źródła: inma_checkout_2026, inma_7reasons, piano_2022_pr

| Ocena     | Przedział | Uwagi                                                                                  |
| --------- | --------- | -------------------------------------------------------------------------------------- |
| optymalny | < 45      | heurystyka – poziom dobrych checkoutów e-commerce                                      |
| dobry     | 45–62     | lepiej niż mediana INMA 2026 (62%, niezweryfikowana); desktop Piano 2022: 57,6%        |
| normalny  | 62–75     | okolice mediany INMA 2026 (62%, niezweryfikowana)                                      |
| słaby     | 75–85     | poziom mediany INMA sprzed ok. 2 lat (82%, niezweryfikowana); mobile Piano 2022: 80,3% |
| krytyczny | ≥ 85      | heurystyka                                                                             |

**Kontekst:** E-commerce / sprzedaż biletów i publikacji – porzucenie koszyka (definicja Baymard) · okres: miesięcznie · metoda: średnia 70,22% z 50 badań, Baymard (aktualizacja 22.09.2025); zakres 55,00% (Forrester 2010) – 84,27% (SaleCycle 2020) to rozrzut średnich z różnych badań (część sprzed ponad 10 lat), a nie percentyle sklepów; progi wokół średniej i skrajnych wartości badań · źródła: baymard_2025

| Ocena     | Przedział | Uwagi                                                      |
| --------- | --------- | ---------------------------------------------------------- |
| optymalny | < 55      | poniżej najniższej średniej w zestawieniu Baymard (55,00%) |
| dobry     | 55–65     | lepiej niż średnia                                         |
| normalny  | 65–75     | okolice średniej 70,22%                                    |
| słaby     | 75–84,27  | do najwyższej średniej w zestawieniu (84,27%)              |
| krytyczny | ≥ 84,27   | powyżej najwyższej średniej w zestawieniu (84,27%)         |

**Zastrzeżenia:**

- Dane INMA (ok. 2024: 18%, Q2 2026: 38% ukończeń) pochodzą z fragmentów artykułów dostępnych w wyszukiwarce; strona INMA zwraca HTTP 403 (Cloudflare), więc liczby są niezweryfikowane – potwierdź je w przeglądarce przy aktualizacji progów.
- Baymard: 18% porzuca z powodu wymogu założenia konta, 17% przez zbyt długi/skomplikowany proces, 19% przez brak zaufania do podania karty, 40% przez dodatkowe koszty; naprawa użyteczności checkoutu może podnieść konwersję o 35,26%.
- INMA (niezweryfikowane, HTTP 403): w amerykańskim badaniu z 2019 r. 85% użytkowników rezygnowało, gdy checkout prosił o hasło.
- Mobile porzuca znacznie częściej: Piano 2022 – 19,7% ukończeń na mobile vs 42,4% na desktopie.
- Brak benchmarków dla polskich metod płatności (BLIK, szybkie przelewy) – heurystyka: brak lokalnych metod podnosi porzucenia.

### CCR: Konwersja checkoutu (Checkout conversion rate)

- **Rozwinięcie:** CCR – Checkout Conversion Rate (u INMA: check-out flow efficiency): odsetek rozpoczętych checkoutów zakończonych płatnością / CCR – Checkout Conversion Rate (INMA: check-out flow efficiency): share of started checkouts that end in a completed payment
- **Wzór:** zakończone płatności / rozpoczęte checkouty (np. klik Subskrybuj na paywallu lub wejście na stronę płatności) × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy sprawność ostatniego kroku lejka: formularza, logowania i bramki płatniczej. Wg INMA (dane niezweryfikowane – strona zwraca HTTP 403) mediana dla serwisów informacyjnych wzrosła z 18% do 38% w dwa lata, a zweryfikowane dane Piano 2022 to 42,4% ukończeń na desktopie i 19,7% na mobile, więc wynik poniżej 25% oznacza wyraźne tarcie (np. wymuszone konto, brak płatności mobilnych). Pułapki: liczenie startu od wyświetlenia strony oferty (zaniża wynik) albo od wpisania karty (zawyża) oraz brak podziału na urządzenia.
- **Interpretation (EN):** Measures the efficiency of the last funnel step: form, login and payment gateway. Per INMA (unverified – the site returns HTTP 403) the median for news sites rose from 18% to 38% in two years, while verified Piano 2022 data show 42.4% completion on desktop and 19.7% on mobile, so a value under 25% signals clear friction (forced account, no mobile wallets). Pitfalls: counting the start from an offer page view (understates) or from card entry (overstates), and not splitting by device.

**Kontekst:** Checkout subskrypcji cyfrowej (start checkoutu → płatność) · okres: miesięcznie · metoda: heurystyka do weryfikacji (pewność kontekstu: niska): mediana INMA Q2 2026 38% (149 marek z 318) i ok. 2024 18% – niezweryfikowane (HTTP 403, Cloudflare); zweryfikowane kotwice: Piano 2022 42,4% desktop / 19,7% mobile; górne progi heurystyczne, zakotwiczone w kwartylach e-commerce Cartylabs (źródło dostawcy bez metodologii) · źródła: inma_checkout_2026, inma_7reasons, piano_2022_pr, cartylabs_2026

| Ocena     | Przedział | Uwagi                                                                               |
| --------- | --------- | ----------------------------------------------------------------------------------- |
| krytyczny | < 15      | heurystyka                                                                          |
| słaby     | 15–25     | okolice mediany INMA z ok. 2024 (18%, niezweryfikowana) i mobile Piano 2022 (19,7%) |
| normalny  | 25–38     | do mediany INMA Q2 2026 (38%, niezweryfikowana)                                     |
| dobry     | 38–55     | mediana – górny kwartyl (heurystyka); desktop Piano 2022: 42,4%                     |
| optymalny | ≥ 55      | poziom górnego kwartyla checkoutów e-commerce (Cartylabs 52–60%; źródło dostawcy)   |

**Kontekst:** E-commerce (np. sklep z publikacjami, bilety) – rozpoczęcie checkoutu → zamówienie · okres: miesięcznie · metoda: kwartyle Cartylabs V 2026 (deklarowane >5000 sklepów Shopify; źródło dostawcy bez okresu, próby i metody percentyli – „aggregated 2026 medians”): dolne 10% <28%, dolne 25% 28–38% (pasmo ok. P10–P25), mediana 38–48%, górne 25% 52–60%, top 10% 60–75% · źródła: cartylabs_2026, baymard_2025

| Ocena     | Przedział | Uwagi                            |
| --------- | --------- | -------------------------------- |
| krytyczny | < 28      | dolne 10% (<28%)                 |
| słaby     | 28–38     | pasmo „bottom 25%” (ok. P10–P25) |
| normalny  | 38–48     | przedział mediany                |
| dobry     | 48–60     | do górnego kwartyla              |
| optymalny | ≥ 60      | top 10%                          |

**Zastrzeżenia:**

- Cartylabs to źródło dostawcy bez okresu, próby i metody percentyli („aggregated 2026 medians”); wartości podane jako przedziały – pewność niska.
- Dane INMA (Q2 2026: 38%; ok. 2024: 18%) pochodzą z fragmentów artykułów; strona INMA zwraca HTTP 403 (Cloudflare) – liczby niezweryfikowane, potwierdź je w przeglądarce przy aktualizacji.
- INMA 2026 (niezweryfikowane, HTTP 403): na odcinku zatrzymanie przez paywall → zakup najlepsze 10% marek konwertuje 5× większy odsetek zatrzymanych niż najsłabsze 10%.
- Raportuj osobno desktop/mobile oraz B2C/B2B (faktura, przelew odroczony).

### PPCR: Konwersja strony cennika / strony oferty (Pricing page / offer page conversion rate)

- **Rozwinięcie:** PPCR – Pricing Page Conversion Rate: odsetek odwiedzających stronę cennika lub strony oferty subskrypcji, którzy kupują (B2C) albo rozpoczynają trial/zapytanie ofertowe (B2B) / PPCR – Pricing Page Conversion Rate: share of pricing or subscription offer page visitors who buy (B2C) or start a trial / request a quote (B2B)
- **Wzór:** unikalni odwiedzający stronę cennika, którzy w tej samej sesji (lub oknie atrybucji, np. 7 dni) kupili / rozpoczęli trial / wysłali zapytanie / unikalni odwiedzający stronę cennika × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy, czy oferta, ceny i układ pakietów przekonują osoby, które już szukają zakupu. Ruch na cenniku jest silnie samoselekcyjny: wejścia z paywalla i newslettera konwertują wyżej niż z wyszukiwarki, więc porównuj wynik w podziale na źródła. Pułapki: CTA typu kontakt/zapytanie dla oferty instytucjonalnej obniża konwersję bezpośrednią, a zmiany cen bez testu A/B utrudniają ocenę.
- **Interpretation (EN):** Measures whether the offer, prices and plan layout convince people who are already looking to buy. Pricing-page traffic is heavily self-selected: visits from the paywall and newsletter convert better than from search, so compare by source. Pitfalls: contact/quote CTAs for institutional plans lower direct conversion, and price changes without A/B tests make the result hard to interpret.

**Kontekst:** Wydawca – strona ofertowa / landing page subskrypcji (unikalni widzący ofertę → zakup) · okres: miesięcznie · metoda: mediana Piano (dane II 2025) dla szablonu landing page: 2,73%; pozostałe progi heurystyczne (ok. 0,25×, 0,5× i ok. 2× mediany) · źródła: piano_nypa_2025

| Ocena     | Przedział | Uwagi                       |
| --------- | --------- | --------------------------- |
| krytyczny | < 0,75    | heurystyka                  |
| słaby     | 0,75–1,5  | heurystyka                  |
| normalny  | 1,5–2,73  | do mediany Piano            |
| dobry     | 2,73–5    | powyżej mediany             |
| optymalny | ≥ 5       | heurystyka – ok. 2× mediany |

**Kontekst:** SaaS B2B / oferta instytucjonalna z ceną na zapytanie (CTA demo/kontakt, np. pakiety instytucjonalne NES) – strona cennika → zapytanie lub demo · okres: miesięcznie · metoda: heurystyka zakotwiczona w SaasDash V 2026 (źródło bez źródeł i metodologii): segment enterprise z samym CTA demo – mediana 1–3%, górny kwartyl 4–6%; progi 0,5 i 6 heurystyczne; pewność kontekstu: niska · źródła: saasdash_2026

| Ocena     | Przedział | Uwagi                                                            |
| --------- | --------- | ---------------------------------------------------------------- |
| krytyczny | < 0,5     | heurystyka                                                       |
| słaby     | 0,5–1     | heurystyka                                                       |
| normalny  | 1–3       | przedział mediany enterprise z samym CTA demo wg SaasDash (1–3%) |
| dobry     | 3–6       | do górnego kwartyla enterprise wg SaasDash (4–6%)                |
| optymalny | ≥ 6       | powyżej górnego kwartyla enterprise – heurystyka                 |

**Kontekst:** SaaS B2B / oferta self-serve (zakup lub trial bez kontaktu z handlowcem) – strona cennika → trial, rejestracja lub zakup · okres: miesięcznie · metoda: heurystyka zakotwiczona w SaasDash V 2026 (źródło bez źródeł i metodologii): self-serve – mediana 4–6%, górny kwartyl 10–14%; dla porównania mid-market 3–5% / 7–10%, freemium 8–15% / 20–30%; progi krytyczny i słaby przeniesione heurystycznie z dotychczasowego zestawu; pewność kontekstu: niska · źródła: saasdash_2026

| Ocena     | Przedział | Uwagi                                                     |
| --------- | --------- | --------------------------------------------------------- |
| krytyczny | < 1       | heurystyka                                                |
| słaby     | 1–4       | poniżej przedziału mediany self-serve (4–6%) – heurystyka |
| normalny  | 4–6       | przedział mediany self-serve wg SaasDash (4–6%)           |
| dobry     | 6–10      | do dolnej granicy górnego kwartyla self-serve (10–14%)    |
| optymalny | ≥ 10      | górny kwartyl self-serve wg SaasDash (10–14%) i wyżej     |

**Zastrzeżenia:**

- Brak niezależnego, publicznego badania konwersji stron cennika; SaasDash nie podaje metodologii ani próby – traktuj jako heurystykę.
- Mediana Piano 2,73% dotyczy szablonu landing page w narzędziu Piano (mianownik: unikalni, którzy zobaczyli ofertę), a nie dowolnej strony cennika.
- Dla oferty B2B z ceną na zapytanie mierz osobno konwersję do zapytania i zapytanie → umowa (CRM).
- Mediana SaasDash zależy od typu sprzedaży – nie oceniaj oferty z ceną na zapytanie progami self-serve (mediana enterprise z samym CTA demo 1–3% wypadałaby tam jako słaba).

### SFCR: Konwersja popupów / modali zapisu (formularze zapisu) (Signup form / popup conversion rate)

- **Rozwinięcie:** SFCR – Signup Form Conversion Rate: odsetek wyświetleń formularza zapisu (popup, modal, flyout), które kończą się zapisem adresu e-mail / SFCR – Signup Form Conversion Rate: share of signup form displays (popup, modal, flyout) that end in an email signup
- **Wzór:** zebrane zapisy (adresy e-mail) / wyświetlenia formularza × 100% (definicja Wisepops i Omnisend: e-maile / wyświetlenia)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, czy obietnica wartości (newsletter, raport, zaproszenie na wydarzenie) i moment wyświetlenia trafiają w potrzebę czytelnika. Dla popupów wyświetlanych automatycznie typowe są 2–5%, dla modali otwieranych kliknięciem – kilkadziesiąt procent, więc nigdy nie uśredniaj tych typów. Pułapki: boty zawyżające wyświetlenia, podwójne opt-in (raportuj osobno zapis i potwierdzenie) oraz agresywne popupy na mobile, które psują doświadczenie i zasięg.
- **Interpretation (EN):** Shows whether the value promise (newsletter, report, event invite) and display timing match reader needs. Auto-triggered popups typically convert 2–5%, click-triggered modals tens of percent, so never average these types together. Pitfalls: bots inflating displays, double opt-in (report signup and confirmation separately), and aggressive mobile popups hurting experience and reach.

**Kontekst:** Popup/modal zapisu wyświetlany automatycznie (wejście, scroll, czas, exit-intent) · okres: miesięcznie · metoda: progi oceny Omnisend 2026 (<1,5% słabo, 1,5–3% średnio, 3–5% dobrze, ≥5% doskonale) przy średniej 2,1% z 1,24 mld wyświetleń w 2025; Wisepops średnia 4,82%; próg krytyczny heurystyczny · źródła: omnisend_2026, wisepops_2025

| Ocena     | Przedział | Uwagi                                    |
| --------- | --------- | ---------------------------------------- |
| krytyczny | < 0,75    | heurystyka – połowa progu słabego        |
| słaby     | 0,75–1,5  | underperforming wg Omnisend              |
| normalny  | 1,5–3     | average wg Omnisend; średnia 2,1%        |
| dobry     | 3–5       | good wg Omnisend; średnia Wisepops 4,82% |
| optymalny | ≥ 5       | excellent wg Omnisend                    |

**Kontekst:** Modal zapisu otwierany kliknięciem (np. przycisk Zapisz się do newslettera) · okres: miesięcznie · metoda: Wisepops (IX 2025): średnia CVR dla wyzwalacza click 54,42%, top 10% 63,35%; dolne progi heurystyczne · źródła: wisepops_2025

| Ocena     | Przedział   | Uwagi                                          |
| --------- | ----------- | ---------------------------------------------- |
| krytyczny | < 15        | heurystyka – formularz zniechęca po kliknięciu |
| słaby     | 15–35       | heurystyka                                     |
| normalny  | 35–54,42    | do średniej Wisepops                           |
| dobry     | 54,42–63,35 | średnia – top 10%                              |
| optymalny | ≥ 63,35     | top 10% Wisepops                               |

**Kontekst:** LinkedIn Lead Gen Forms – formularz w feedzie z ofertą treści (raport, analiza do pobrania); ukończenie = wysłane / otwarcia formularza · okres: na kampanię (mediana kont, 8 IX 2025 – 7 IX 2026) · metoda: kwartyle źródła (Kiin Labs 2026: 173 konta ze 100+ otwarciami formularza): P25 4,6%, P50 10,8%, P75 18,7%, P90 31,6%; poniżej P25 słaby, P25–P50 normalny, P50–P75 dobry, powyżej P75 optymalny; próg krytyczny = połowa P25 (heurystyka). Kontekst dodany 2026-10-19 z pakietu Insider marketingowy (przedział b-lgf-content) · źródła: kiin_lgf_benchmarks_2026

| Ocena     | Przedział | Uwagi                                    |
| --------- | --------- | ---------------------------------------- |
| krytyczny | < 2,3     | heurystyka: połowa P25 (4,6%)            |
| słaby     | 2,3–4,6   | poniżej P25                              |
| normalny  | 4,6–10,8  | P25–P50 (od dolnego kwartyla do mediany) |
| dobry     | 10,8–18,7 | P50–P75 (mediana kont 10,8%)             |
| optymalny | ≥ 18,7    | powyżej P75; P90 = 31,6%                 |

**Kontekst:** LinkedIn Lead Gen Forms – formularz w feedzie z prośbą o demo lub kontakt handlowy (np. zapytanie o ofertę instytucjonalną); ukończenie = wysłane / otwarcia formularza · okres: na kampanię (mediana kont, 8 IX 2025 – 7 IX 2026) · metoda: kwartyle źródła (Kiin Labs 2026: 87 kont ze 100+ otwarciami formularza): P25 1,0%, P50 2,2%, P75 4,2%, P90 9,5%; poniżej P25 słaby, P25–P50 normalny, P50–P75 dobry, powyżej P75 optymalny; próg krytyczny = połowa P25 (heurystyka). Kontekst dodany 2026-10-19 z pakietu Insider marketingowy (przedział b-lgf-demo) · źródła: kiin_lgf_benchmarks_2026

| Ocena     | Przedział | Uwagi                                    |
| --------- | --------- | ---------------------------------------- |
| krytyczny | < 0,5     | heurystyka: połowa P25 (1,0%)            |
| słaby     | 0,5–1     | poniżej P25                              |
| normalny  | 1–2,2     | P25–P50 (od dolnego kwartyla do mediany) |
| dobry     | 2,2–4,2   | P50–P75 (mediana kont 2,2%)              |
| optymalny | ≥ 4,2     | powyżej P75; P90 = 9,5%                  |

**Zastrzeżenia:**

- Dane Omnisend i Wisepops pochodzą głównie z e-commerce (zachętą bywa rabat); u wydawcy zachętą jest treść, więc wyniki mogą być niższe.
- Omnisend 2025: popupy wyświetlane jednocześnie na desktopie i mobile 2,2%, tylko na desktopie 1,4% (na wykresie 1,3%); koło fortuny 3,5%; Wisepops: exit-intent 3,94%, wieloetapowe 5,17% vs jednoetapowe 4,62%.
- Top 10% Wisepops (57,7%) obejmuje popupy otwierane kliknięciem – nie porównuj z popupami automatycznymi.
- Konteksty LinkedIn Lead Gen Forms (Kiin Labs 2026) mierzą formularz w serwisie reklamowym: otwiera się po kliknięciu reklamy i jest wypełniony danymi z profilu, a mianownikiem są otwarcia formularza, nie wyświetlenia popupu w serwisie. Porównuj je tylko z danymi z LinkedIn Campaign Manager (Leady / Otwarcia formularza), osobno dla oferty treści (mediana 10,8%) i prośby o demo (mediana 2,2%). Wysokie ukończenie przy danych z profilu nie oznacza jakości leadów – czytaj je razem z konwersją lead → MQL.

### AR: Wskaźnik aktywacji (Activation rate)

- **Rozwinięcie:** AR – Activation Rate: odsetek nowych użytkowników (zarejestrowanych lub nowych subskrybentów), którzy w zadanym oknie osiągnęli zdefiniowany moment pierwszej wartości / AR – Activation Rate: share of new users (registered users or new subscribers) who reach a defined first-value milestone within a set window
- **Wzór:** nowi użytkownicy w kohorcie, którzy w ciągu X dni wykonali zdarzenie aktywacji (np. 3 artykuły premium + zapis do newslettera; rejestracja na wydarzenie; dołączenie do klubu) / wszyscy nowi zarejestrowani w kohorcie × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mówi, jaka część nowych kont dochodzi do realnej wartości, a więc ma szansę zostać i zapłacić. Najważniejsze jest dobranie zdarzenia aktywacji, które przewiduje retencję co najmniej 2× lepiej niż jego brak (Lenny's Newsletter). Pułapki: zbyt łatwe zdarzenie (samo zalogowanie) zawyża wynik, a benchmarki o innej definicji (Amplitude: powrót w 7. dniu; Userpilot: wykonanie kluczowej akcji) nie są porównywalne.
- **Interpretation (EN):** Shows what share of new accounts reach real value and are therefore likely to stay and pay. The key is choosing an activation event that predicts retention at least 2x better than not reaching it (Lenny's Newsletter). Pitfalls: an event that is too easy (a mere login) inflates the result, and benchmarks with different definitions (Amplitude: day-7 return; Userpilot: key action completed) are not comparable.

**Kontekst:** Produkt cyfrowy / SaaS B2B – nowi użytkownicy, którzy osiągnęli kamień milowy wartości · okres: kohorta (okno 7–14 dni) · metoda: mediana Lenny 2022 dla SaaS 30% (ankieta z 2022 r., samodeklaracje; ogółem 25%) i Userpilot 2025 (mediana 37,04%, średnia 37,5%; 62 firmy B2B); górny próg = najlepsza branża Userpilot (AI&ML 54,8%); próg krytyczny heurystyczny (najsłabsze branże 5–8,3%) · źródła: userpilot_2025, lenny_2022

| Ocena     | Przedział | Uwagi                                                     |
| --------- | --------- | --------------------------------------------------------- |
| krytyczny | < 10      | poziom najsłabszych branż Userpilot                       |
| słaby     | 10–30     | poniżej mediany Lenny dla SaaS (30%)                      |
| normalny  | 30–37     | mediana Lenny dla SaaS (30%) – mediana Userpilot (37,04%) |
| dobry     | 37–55     | powyżej mediany Userpilot                                 |
| optymalny | ≥ 55      | powyżej najlepszej branży Userpilot                       |

**Kontekst:** Aktywacja mierzona powrotem w 7. dniu (definicja Amplitude: odsetek kohorty nowych użytkowników aktywnych w D7) · okres: kohorta D7 · metoda: Amplitude 2025 (ponad 2600 firm): 7% = próg górnego kwartyla (P75) dla wszystkich branż – jedyny pewny próg; mediana 2,1% i top 10% 12,4% dotyczą wyłącznie produktów enterprise (inna populacja); artykuł nie podaje mediany przekrojowej ani wartości D7 dla mediów i B2B; pozostałe progi heurystyczne; pewność kontekstu: niska · źródła: amplitude_2025

| Ocena     | Przedział | Uwagi                                                             |
| --------- | --------- | ----------------------------------------------------------------- |
| krytyczny | < 1       | heurystyka                                                        |
| słaby     | 1–2,1     | heurystyka; poniżej mediany produktów enterprise (2,1)            |
| normalny  | 2,1–7     | od mediany produktów enterprise (2,1) do P75 wszystkich branż (7) |
| dobry     | 7–12,4    | P75 wszystkich branż (7) – jedyny pewny próg                      |
| optymalny | ≥ 12,4    | top 10% produktów enterprise (12,4) – inna populacja, heurystyka  |

**Zastrzeżenia:**

- Userpilot to dane własne klientów (62 firmy B2B), Lenny – ankieta z 2022 r. (ponad 500 odpowiedzi, samodeklaracje); oba nie dotyczą wydawców.
- Amplitude: 69% produktów z najlepszą aktywacją D7 było też w czołówce retencji po 3 miesiącach – aktywacja jest wczesnym predyktorem retencji.
- Dla think tanku zdefiniuj osobne zdarzenia aktywacji dla czytelnika zarejestrowanego, subskrybenta płatnego i członka klubu; brak publicznych benchmarków dla tych definicji.

### TTV: Czas do wartości (Time to value)

- **Rozwinięcie:** TTV – Time to Value: czas od rejestracji lub zakupu do pierwszego momentu, w którym użytkownik otrzymuje obiecaną wartość / TTV – Time to Value: time from sign-up or purchase to the first moment the user receives the promised value
- **Wzór:** mediana (czas zdarzenia wartości − czas rejestracji/zakupu) w kohorcie, w godzinach; użytkownicy bez zdarzenia wartości raportowani osobno jako odsetek
- **Jednostka:** hours · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Im szybciej nowy czytelnik lub subskrybent dostaje wartość (pełny tekst premium, pierwszy newsletter, zaproszenie na wydarzenie), tym mniejsze ryzyko wczesnej rezygnacji – wg Piano 13% wyłączeń automatycznego odnowienia następuje już pierwszego dnia, a 40% w ciągu 60 dni. Raportuj medianę, nie średnią, bo rozkład ma długi ogon. Pułapka: osoby, które nigdy nie doszły do wartości, wypadają ze średniej i sztucznie poprawiają wynik.
- **Interpretation (EN):** The faster a new reader or subscriber gets value (full premium article, first newsletter, event invite), the lower the risk of early cancellation – per Piano, 13% of auto-renew disablements happen on day one and 40% within 60 days. Report the median, not the mean, because the distribution has a long tail. Pitfall: users who never reach value drop out of the average and artificially improve it.

**Kontekst:** SaaS B2B / dostęp instytucjonalny – rejestracja → pierwsze zdarzenie wartości · okres: kohorta · metoda: średnia Userpilot 2025: 1 d 12 h 23 min (ok. 36,4 h; 62 firmy B2B); najlepsza branża CRM 1 d 4 h 43 min, najsłabsza HR 3 d 18 h 59 min; granica 7 dni wg zalecenia Amplitude (wartość najlepiej w pierwszym tygodniu) – heurystyka; strona Userpilot obok średniej 36,4 h pokazuje nieopisaną wartość 1 d 1 h 54 min (ok. 25,9 h), być może medianę – po jej potwierdzeniu granicę dobry/normalny przesunąć z 36,4 h na ok. 26 h (granica optymalny/dobry 24 h bez zmian); na razie progi bez zmian · źródła: userpilot_2025, amplitude_media_2025

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| optymalny | < 24      | poniżej najlepszej branży Userpilot (ok. 28,7 h) |
| dobry     | 24–36,4   | do średniej Userpilot                            |
| normalny  | 36,4–72   | średnia – ok. 3 dni                              |
| słaby     | 72–168    | 3–7 dni; poziom najsłabszej branży (HR)          |
| krytyczny | ≥ 168     | ponad tydzień                                    |

**Kontekst:** Wydawca / think tank – rejestracja lub zakup → pierwszy moment wartości (pełny artykuł premium, otwarty newsletter powitalny, zapis na wydarzenie) · okres: kohorta · metoda: heurystyka ekspercka; uzasadnienie: dane Piano 2024 o wczesnych rezygnacjach (13% wyłączeń auto-odnowienia 1. dnia, 40% w 60 dni) · źródła: piano_2024

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| optymalny | < 1       | wartość w tej samej sesji |
| dobry     | 1–24      | w ciągu doby              |
| normalny  | 24–72     | 1–3 dni                   |
| słaby     | 72–168    | 3–7 dni                   |
| krytyczny | ≥ 168     | ponad tydzień             |

**Zastrzeżenia:**

- Userpilot nie podaje opisanej mediany ani metodologii pomiaru TTV (nieopisana wartość ok. 25,9 h może być medianą); dane z 62 firm B2B – niska porównywalność z serwisem treściowym.
- Kontekst wydawcy jest w całości heurystyczny – brak publicznego benchmarku TTV dla mediów i think tanków.
- Zdarzenie wartości musi być spójne z definicją aktywacji (activation_rate).

### PHR: Odsetek użytkowników trafiających na paywall (Paywall hit rate (share of users hitting the paywall))

- **Rozwinięcie:** PHR – Paywall Hit Rate (także stop rate u INMA, exposure rate u Piano): odsetek miesięcznych unikalnych użytkowników, którzy co najmniej raz zobaczyli paywall lub płatną ofertę / PHR – Paywall Hit Rate (INMA: stop rate; Piano: exposure rate): share of monthly unique users who saw the paywall or a paid offer at least once
- **Wzór:** unikalni użytkownicy, którzy w miesiącu co najmniej raz zobaczyli paywall/płatną ofertę / wszyscy unikalni użytkownicy w miesiącu × 100%
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, jak szeroko otwieramy drzwi do sprzedaży: zbyt niski oznacza brak okazji do konwersji (Mather 2022: 85% użytkowników omijało paywalle), zbyt wysoki w modelu freemium oznacza utratę zasięgu, ruchu z wyszukiwarek i przyszłych subskrybentów. To wskaźnik docelowego przedziału – optimum zależy od modelu (freemium/hybryda vs twardy paywall) i od tego, czy wzrost PHR zwiększa łączną liczbę sprzedaży. Pułapka: podnoszenie PHR obniża konwersję paywalla, więc oceniaj oba wskaźniki razem.
- **Interpretation (EN):** Measures how widely the door to a sale is opened: too low means no conversion opportunities (Mather 2022: 85% of users eluded paywalls), too high in a freemium model means lost reach, search traffic and future subscribers. It is a target-range metric – the optimum depends on the model (freemium/hybrid vs hard wall) and on whether a higher PHR increases total sales. Pitfall: raising PHR lowers paywall conversion, so evaluate both together.

**Kontekst:** Wydawca freemium/metered/hybrydowy (model NES) · okres: miesięcznie · metoda: zweryfikowane mediany: Mather VI 2025 22,8% (VI 2024: 15,1%), Piano XII 2024 16,3% (Europa 20,4%), Mather Q2 2022 14,3% (best-in-class 20,3% – średnia rynków wzorcowych, nie percentyl); pomocniczo, niezweryfikowane (INMA, HTTP 403): mediana 31% (317 marek), freemium/hybryda ≤25%, twarde ≥56%; przedział optymalny 18–30 – heurystyka zgodna ze zweryfikowanymi kotwicami; nowsze raporty Mather (Q1 2026 Ameryka Płn., miesięczne German/UK Audience Benchmarks 2026; za formularzem) do pozyskania przy aktualizacji – niemieckie są bliższe rynkowi PL · źródła: mather_q2_2025, piano_nypa_2025, mather_2022, mather_intercept_2024, inma_nyt_reach, inma_shadow_2026, mather_q1_2026, mather_de_2026_07, mather_uk_2026_07

| Ocena                      | Przedział | Uwagi                                                                                                                                            |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny                  | < 5       | paywall praktycznie niewidoczny – brak okazji do sprzedaży                                                                                       |
| słaby (za mało ekspozycji) | 5–12      | znacznie poniżej zweryfikowanych median Mather/Piano 2022–2025 (14,3–22,8%)                                                                      |
| normalny                   | 12–18     | okolice mediany Piano XII 2024 (16,3%), Mather VI 2024 (15,1%) i Q2 2022 (14,3%)                                                                 |
| optymalny                  | 18–30     | mediana Mather VI 2025 (22,8%), Piano Europa XII 2024 (20,4%), best-in-class Mather 2022 (20,3%); INMA: freemium/hybryda ≤25% (niezweryfikowane) |
| dobry                      | 30–40     | powyżej mediany INMA (31%, niezweryfikowana) – monitoruj utratę zasięgu                                                                          |
| słaby (zbyt szczelnie)     | ≥ 40      | dla freemium zbyt szczelnie – zbliżenie do twardego paywalla (INMA ≥56%, niezweryfikowane)                                                       |

**Kontekst:** Twardy paywall (hard wall) · okres: miesięcznie · metoda: heurystyka oparta wyłącznie na niezweryfikowanych danych INMA (strona zwraca HTTP 403, Cloudflare; pewność kontekstu: niska): Q2 2026 (318 marek) większość serwisów z twardym paywallem zatrzymuje ≥56% użytkowników miesięcznie; paywalle uruchomione przed 2019 r. zatrzymują ok. 50% · źródła: inma_shadow_2026, inma_nyt_reach

| Ocena    | Przedział | Uwagi                                                            |
| -------- | --------- | ---------------------------------------------------------------- |
| słaby    | < 30      | nietypowo nisko dla twardego paywalla – sprawdź reguły i wycieki |
| normalny | 30–56     | heurystyka                                                       |
| dobry    | ≥ 56      | typowe dla twardego paywalla wg INMA (niezweryfikowane)          |

**Zastrzeżenia:**

- Dane INMA (31%, ≥56%, ≤25%, +67% zasięgu) pochodzą z fragmentów artykułów dostępnych w wyszukiwarce (strona INMA zwraca HTTP 403, Cloudflare) – niezweryfikowane; liczba „mniej niż 30% użytkowników mediany serwisów kiedykolwiek widzi paywall” (inma_ceiling_2026) pochodzi z zapowiedzi w serwisie X i służy wyłącznie jako kontekst, nie kotwica przedziału.
- INMA Q2 2026 (niezweryfikowane): serwisy freemium/hybrydowe miały o 67% wyższy zasięg (penetracja gospodarstw domowych) niż twarde paywalle.
- Mather 2024: zaostrzenie paywalla dało +100% prób sprzedaży przy −20% konwersji; obniżenie limitu z 3 do 2 darmowych artykułów dotyka więcej czytelników niż podniesienie z 3 do 4.
- Piano (I 2023): rozrzut ekspozycji między wydawcami od 0,01% (Bottom) do 87,4% (Top), mediana ok. 8,8% – mediana ma sens tylko w obrębie tego samego modelu paywalla.
- Europa (Piano XII 2024: 20,4%) eksponuje oferty częściej niż USA (13,8%).

### Źródła grupy: Lejek i konwersja

| Id                       | Źródło                                                                                                                                                                                                                               | Wydawca                                                                                         | Data                                                                         | Weryfikacja          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| piano_nypa_2025          | [Piano Benchmarks – prezentacja na NYPA Spring Conference (Mar2025_NYPA_Benchmarks_Belyus)](https://nynewspapers.com/wp-content/uploads/2025/04/Mar2025_NYPA_Benchmarks_Belyus.pdf)                                                  | Piano / New York Press Association                                                              | 2025-03                                                                      | tak                  |
| piano_inma_2023          | [Maximising subscription performance: insights from 500+ publishers worldwide (A. Kreybig)](https://www.inma.org/files/docs/article/2023subsummit/Piano-SubscriptionSummit-Workshops.pdf)                                            | Piano / INMA Media Subscriptions Summit                                                         | 2023-03                                                                      | częściowo            |
| piano_2024               | [Subscription Performance Benchmarks 2024 Report](https://www.piano.io/marketing/content/subscription-performance-benchmarks-2024)                                                                                                   | Piano                                                                                           | 2024 (dane I 2022–IX 2024)                                                   | tak                  |
| piano_2022_pr            | [Piano Releases 2022 Subscription Performance Benchmark Report](https://resources.piano.io/resources/piano-releases-2022-subscription-performance-benchmark-report/)                                                                 | Piano                                                                                           | 2022-07-13                                                                   | tak                  |
| digiday_2022             | [Media Briefing: Publishers use registration walls as subscription bridges](https://digiday.com/media/media-briefing-publishers-use-registration-walls-as-subscription-bridges/)                                                     | Digiday                                                                                         | 2022-07-21                                                                   | tak                  |
| mather_2022              | [Listener Digital Audience Benchmarking Report – September 2022 (Q2 2022)](https://www.mathereconomics.com/wp-content/uploads/2022/11/Mather-Economics-Subscription-Digital-Audience-Mini-Benchmarking-Report-September-2022.pdf)    | Mather Economics                                                                                | 2022-09                                                                      | tak                  |
| mather_q2_2025           | [Essential Insights for Publishers: Q2 2025 U.S. Subscription Benchmarking Report](https://www.mathereconomics.com/download-mathers-q2-2025-u-s-benchmarking-report-2/)                                                              | Mather Economics                                                                                | 2025 (data publikacji niepodana; VIII 2025 wywnioskowane ze ścieżki obrazka) | tak                  |
| mather_regwall           | [How Registration Walls Impact Subscriber Growth](https://www.mathereconomics.com/2022/02/10/an-inside-look-on-how-registration-walls-impact-subscriber-growth/)                                                                     | Mather Economics                                                                                | 2022-02-10                                                                   | tak                  |
| mather_intercept_2024    | [Paywall Intercept Rates on Closed and Open News Sites Yield Revenue Optimization Insights](https://www.mathereconomics.com/2024/06/17/paywall-intercept-rates-on-closed-and-open-news-sites-yield-revenue-optimisation-insights/)   | Mather Economics                                                                                | 2024-06-24                                                                   | tak                  |
| pressgazette_2024        | [Newsbrand subscriber conversion rates: biggest reader-funded newsbrands ranked](https://pressgazette.co.uk/media-audience-and-business-data/newsbrand-subscriber-conversion-rates-biggest-reader-funded-newsbrands-ranked/)         | Press Gazette                                                                                   | 2024-07-11                                                                   | tak                  |
| inma_checkout_2026       | [News check-outs have overtaken online retail (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/news-check-outs-have-overtaken-online-retail)                                                                        | INMA – Readers First blog                                                                       | 2026-09-08                                                                   | nie da się sprawdzić |
| inma_7reasons            | [Here are 7 reasons digital news subscriptions are stagnating](https://www.inma.org/blogs/reader-revenue/post.cfm/here-are-7-reasons-digital-news-subscriptions-are-stagnating)                                                      | INMA – Readers First blog                                                                       | 2024-02 (data przybliżona)                                                   | nie da się sprawdzić |
| inma_nyt_reach           | [New York Times shares its strategy of reach, free content in subscription growth (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/new-york-times-shares-its-strategy-of-reach-free-content-in-subscription-growth) | INMA – Readers First blog                                                                       | 2026 (data dokładna nieustalona)                                             | nie da się sprawdzić |
| inma_shadow_2026         | [How long is the shadow of The New York Times' paywall? (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/how-long-is-the-shadow-of-the-new-york-times-paywall)                                                      | INMA – Readers First blog                                                                       | 2026-08 (data przybliżona)                                                   | nie da się sprawdzić |
| inma_ceiling_2026        | [There is no subscription ceiling – there is a Web site ceiling (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/there-is-no-subscription-ceiling-there-is-a-web-site-ceiling)                                      | INMA – Readers First blog                                                                       | 2026-10-04                                                                   | nie da się sprawdzić |
| notre_dame_2026          | [Subscription required: Newspaper paywalls scatter most readers but provide surprising value](https://news.nd.edu/news/subscription-required-newspaper-paywalls-scatter-most-readers-but-provide-surprising-value/)                  | University of Notre Dame News (badanie Kanuri, Overby, Pattabhiramaiah; MIS Quarterly, w druku) | 2026-06-16                                                                   | tak                  |
| dnr_2026                 | [Digital News Report 2026 – Executive summary](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/dnr-executive-summary)                                                                                            | Reuters Institute for the Study of Journalism                                                   | 2026-06-16                                                                   | tak                  |
| dnr_2026_pl              | [Digital News Report 2026 – Poland (V. Makarenko)](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                       | Reuters Institute for the Study of Journalism                                                   | 2026-06-16                                                                   | tak                  |
| beehiiv_2026             | [The State of Paid Newsletters 2026](https://www.beehiiv.com/blog/the-state-of-paid-newsletters-2026)                                                                                                                                | beehiiv                                                                                         | 2026-06-22                                                                   | tak                  |
| chartmogul_2026          | [The SaaS Conversion Report](https://chartmogul.com/reports/saas-conversion-report/)                                                                                                                                                 | ChartMogul / ProductLed (K. Poyar)                                                              | 2026-02-04                                                                   | częściowo            |
| fps_2025                 | [SaaS Free Trial Conversion Rate Benchmarks](https://firstpagesage.com/seo-blog/saas-free-trial-conversion-rate-benchmarks/)                                                                                                         | First Page Sage                                                                                 | 2025-09-05                                                                   | tak                  |
| revenuecat_2026          | [State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps)                                                                                                                                             | RevenueCat                                                                                      | 2026 (data publikacji niepodana na stronie; dane za 2025)                    | tak                  |
| baymard_2025             | [Cart Abandonment Rate Statistics](https://baymard.com/lists/cart-abandonment-rate)                                                                                                                                                  | Baymard Institute                                                                               | 2025-09-22 (aktualizacja)                                                    | tak                  |
| cartylabs_2026           | [Shopify Checkout Conversion Benchmarks 2026: What's Actually Good?](https://cartylabs.com/blog/shopify-checkout-conversion-benchmarks/)                                                                                             | Cartylabs                                                                                       | 2026-05-13                                                                   | tak                  |
| omnisend_2026            | [Email popup statistics](https://www.omnisend.com/blog/email-popup-statistics/)                                                                                                                                                      | Omnisend                                                                                        | 2026-02-09                                                                   | częściowo            |
| wisepops_2025            | [Popup Statistics (Based on 1B Displays) – raport 2026](https://wisepops.com/blog/popup-stats)                                                                                                                                       | Wisepops                                                                                        | 2025-09-30                                                                   | tak                  |
| userpilot_2025           | [SaaS Product Metrics Benchmark Report](https://userpilot.com/saas-product-metrics/)                                                                                                                                                 | Userpilot                                                                                       | 2025-09-12 (wg metadanych strony)                                            | tak                  |
| lenny_2022               | [What is a good activation rate](https://www.lennysnewsletter.com/p/what-is-a-good-activation-rate)                                                                                                                                  | Lenny's Newsletter (L. Rachitsky, Y. Timen)                                                     | 2022-10-25                                                                   | tak                  |
| amplitude_2025           | [The 7% retention rule](https://www.amplitude.com/blog/7-percent-retention-rule)                                                                                                                                                     | Amplitude (M. Morales)                                                                          | 2025-09-30                                                                   | częściowo            |
| amplitude_media_2025     | [Media & entertainment product benchmarks](https://amplitude.com/blog/media-entertainment-product-benchmarks)                                                                                                                        | Amplitude                                                                                       | 2025-12-23                                                                   | tak                  |
| saasdash_2026            | [SaaS Pricing Page Conversion: Benchmarks, Anatomy, and a Testing Framework](https://saasdash.ai/blog/pricing-page-conversion-saas)                                                                                                  | SaasDash.ai                                                                                     | 2026-05-10                                                                   | częściowo            |
| mather_q1_2026           | [Q1 2026 Audience & Subscription Benchmarking Report (North America)](https://www.mathereconomics.com/north-america-media-benchmarking-report-q1-2026/)                                                                              | Mather Economics                                                                                | 2026-05-26                                                                   | nie da się sprawdzić |
| mather_de_2026_07        | [German Audience Benchmarks: July 2026 Report](https://www.mathereconomics.com/german-audience-benchmarks-july-2026-report/)                                                                                                         | Mather Economics                                                                                | 2026-08-20                                                                   | nie da się sprawdzić |
| mather_uk_2026_07        | [UK Audience Benchmarks: July 2026 Report](https://www.mathereconomics.com/uk-audience-benchmarks-july-2026-report/)                                                                                                                 | Mather Economics                                                                                | 2026-09-01                                                                   | nie da się sprawdzić |
| kiin_lgf_benchmarks_2026 | [LinkedIn Lead Gen Forms Benchmarks 2026](https://kiin.co/research/linkedin-lead-gen-forms-benchmarks)                                                                                                                               | Kiin Labs (Kiin; autor: Phil Ilic)                                                              | 2026-09-15                                                                   | tak                  |

### Zmiany po weryfikacji: Lejek i konwersja

- visitor_to_registration_rate / wydawca (udział rozpoznanych): przebudowano przedziały – krytyczny <0,5; słaby 0,5–0,8; normalny 0,8–1,2 (do mediany Piano); dobry 1,2–3,3; optymalny ≥3,3 – zamiast sztucznie wąskiego normalnego 1,2–1,5 opartego na medianach z dwóch różnych prób; mediana jako granica normalny/dobry, spójnie z V2P.
- visitor_to_registration_rate / wydawca: w notatce i metodzie opisano best-in-class Mather (3,3%) jako średnią rynków wzorcowych wybranych indeksem, nie percentyl; okres danych Piano 2024 poprawiono na I 2022 – IX 2024.
- visitor_to_registration_rate: caveat o registration wall – datę studium Mather doprecyzowano na 10.02.2022 (kanoniczny artykuł źródłowy).
- visitor_to_registration_rate / SaaS: jeden kontekst rozdzielono na trzy modele – freemium (krytyczny <2, słaby 2–5, normalny 5–9, dobry 9–13,3, optymalny ≥13,3), trial opt-in (krytyczny <2, słaby 2–4,5, normalny 4,5–8,5, dobry ≥8,5) i trial opt-out (słaby <2,5, normalny 2,5–3,5, dobry ≥3,5), bo dotychczasowy zestaw oceniał normę triala z kartą (2–3,5%) jako słabą.
- visitor_to_registration_rate / SaaS: wartości ChartMogul 9% / 4,5% / 3,5% opisano jako przykład ilustracyjny, nie medianę; wszystkie trzy konteksty SaaS oznaczono jako heurystykę o pewności niskiej; First Page Sage opisano jako klientów agencji (organic/paid: 13,3/15,9; 8,5/7,1; 2,5/2,2).
- visitor_to_registration_rate: dodano caveat o niskiej pewności kontekstów SaaS (przykład ilustracyjny ChartMogul, próba agencyjna First Page Sage).
- registered_to_paid_rate / kohorta wydawcy: w metodzie i notatkach zaznaczono, że 3% to średnia/odsetek ogólny (Digiday), nie mediana, a rozkład 0,5–12% jest prawoskośny (mediana prawdopodobnie niższa); granica 3% bez zmian, pewność kontekstu: średnia/niska.
- registered_to_paid_rate / kohorta wydawcy: dopisano, że komunikat Piano 2022 nie wiąże wprost zakresu 0,5–12% z kohortą zarejestrowanych.
- registered_to_paid_rate / newsletter: P90 dla finansów/ekonomii zapisano jako 18,7–30,8% (Investing 18,69%, Finance 20,00%, Economy 30,80%) zamiast 20–31%; progi bez zmian.
- registered_to_paid_rate: caveat o mnożniku 30× przypisano prezentacji Piano NYPA 2025 (na stronie Piano 2024 go nie ma).
- registered_to_paid_rate: poprawiono caveat – w teście Piano/INMA 2023 ścieżka przez rejestrację przegrała w 3 z 4 testów (3× „Result: NO”, 1× „YES”), nie w 2 z 4.
- visitor_to_paid_rate: usunięto etykietę „definicja INMA” z formuły i rozwinięć PL/EN (Press Gazette nie podaje definicji INMA) – zapis: subskrybenci cyfrowi / średni miesięczny zasięg, definicje wydawców się różnią.
- visitor_to_paid_rate / stan: nazwa kontekstu i metoda bez „definicji INMA”; zaznaczono, że mediana INMA z końca 2022 r. jest najnowszą publicznie dostępną; progi bez zmian.
- visitor_to_paid_rate / stan: w notatce 'optymalny' liderów Press Gazette podano dokładnie (The Athletic ok. 26%, Barron's ok. 19%) z zaznaczeniem innej definicji (Similarweb) zamiast „ok. 20%”.
- visitor_to_paid_rate / przepływ: best-in-class Mather opisano jako średnią rynków wzorcowych (nie percentyl) z próby głównie prasy lokalnej USA.
- visitor_to_paid_rate: caveat o Polsce – dopisano, że zmiana −2 pp jest nieistotna statystycznie wg metodologii DNR, a 17% dotyczy pay basket 20 krajów z powszechnymi paywallami, nie średniej 20 krajów ogółem.
- paywall_conversion_rate: notatkę 'krytyczny' zmieniono z „dolny decyl Piano 2023 ok. 0,02%” na „najniższa wartość (Bottom) w rozkładzie Piano, I 2023: 0,02%”; w 'optymalny' 3,95% opisano jako wartość Top, nie decyl; progi bez zmian.
- paywall_conversion_rate: do metody dodano trend mediany Piano (0,44% na początku 2021 → ok. 0,11–0,12% w I 2023 → 0,20% w XII 2024) i definicję best-in-class Mather.
- paywall_conversion_rate: usunięto caveat „INMA: najszybciej rosnące marki (2019–2021) 0,36%” – brak źródła na liście sources.
- paywall_conversion_rate: w caveacie Mather intercept podano datę 24.06.2024 i okres zmian (III 2023).
- paywall_conversion_rate: caveat Notre Dame – 81% opisano jako udział wśród skutecznych obejść (nowa tożsamość przeglądarki), a nie wśród wszystkich zatrzymań.
- paywall_conversion_rate: dodano caveat o trendzie mediany Piano 2021–2024.
- trial_to_paid_rate / opt-in: przebudowano przedziały (krytyczny <2,5; słaby 2,5–4; normalny 4–6; dobry 6–12; optymalny ≥12), bo w ChartMogul good = P50 (4–6%), great = P75 (10–15%), a 8% to mediana wszystkich modeli łącznie z trialami z kartą; First Page Sage 18,2% tylko jako górna kotwica.
- trial_to_paid_rate / opt-out: w metodzie i notatkach dopisano good = P50 (25–35%, mediana 30%) i great = P75 (50–60%); RevenueCat oznaczono jako dane za 2025 z niepotwierdzoną datą publikacji; progi bez zmian.
- trial_to_paid_rate: caveat Piano uściślono – subskrypcje bez triala mają lepszą retencję niż płatne triale (nie triale w ogóle).
- trial_to_paid_rate: caveats – RevenueCat oznaczono jako dane za 2025; 3,5% vs 4,5% rejestracji opisano jako przykład ilustracyjny ChartMogul, nie medianę.
- checkout_abandonment_rate / subskrypcje: kotwice INMA (62% i 82% porzuceń) oznaczono jako niezweryfikowane (HTTP 403); jako jedyną zweryfikowaną kotwicę podano Piano 2022 (desktop 57,6%, mobile 80,3% porzuceń); metoda: heurystyka do weryfikacji, pewność kontekstu niska; progi bez zmian.
- checkout_abandonment_rate / e-commerce: w metodzie i notatkach dopisano, że 55–84,27% to rozrzut średnich z 50 badań (część sprzed ponad 10 lat), a nie percentyle sklepów.
- checkout_abandonment_rate: caveats INMA (18%/38%, 85% z 2019 r.) oznaczono jako niezweryfikowane (HTTP 403, Cloudflare).
- checkout_abandonment_rate: obniżono confidence średnia → niska (kotwice głównego kontekstu subskrypcji niezweryfikowalne do czasu sprawdzenia INMA w przeglądarce).
- checkout_conversion_rate: w interpretacji PL/EN oznaczono dane INMA (18% → 38%) jako niezweryfikowane i dodano zweryfikowane kotwice Piano 2022 (desktop 42,4%, mobile 19,7%).
- checkout_conversion_rate / subskrypcje: kotwice INMA Q2 2026 (38%) i ok. 2024 (18%) oznaczono jako niezweryfikowane; zweryfikowane kotwice Piano 2022 (42,4% / 19,7%) przypisano do notatek; metoda: heurystyka do weryfikacji, pewność kontekstu niska; progi bez zmian.
- checkout_conversion_rate / e-commerce: potwierdzono zgodność progów z Cartylabs (słaby 28–38 = pasmo „bottom 25%”, ok. P10–P25; krytyczny <28 = dolne 10%) i dopisano, że źródło to dostawca bez okresu, próby i metodologii.
- checkout_conversion_rate: caveats Cartylabs i INMA (38%/18%, 5×) uzupełnione o brak metodologii i status niezweryfikowany.
- checkout_conversion_rate: obniżono confidence średnia → niska do czasu weryfikacji INMA Q2 2026 (38%) i INMA ok. 2024 (18%).
- pricing_page_conversion_rate / SaaS B2B: kontekst rozbito według typu sprzedaży – oferta instytucjonalna z ceną na zapytanie (krytyczny <0,5; słaby 0,5–1; normalny 1–3 = mediana enterprise; dobry 3–6; optymalny ≥6) i self-serve (krytyczny <1; słaby 1–4; normalny 4–6; dobry 6–10; optymalny ≥10), bo dotychczasowy zestaw oceniał medianę enterprise (1–3%) jako „słabą”; confidence pozostaje niska.
- pricing_page_conversion_rate: dodano caveat o nieprzenoszeniu progów self-serve na ofertę z ceną na zapytanie.
- signup_form_conversion_rate: poprawiono caveat Omnisend – 2,2% dotyczy popupów wyświetlanych jednocześnie na desktopie i mobile (nie „mobile”), tylko desktop 1,4% (wykres: 1,3%).
- signup_form_conversion_rate: usunięto nieuźródłowiony caveat o zmianie filtrowania botów w Klaviyo (1 IV 2025) – brak źródła na liście sources (zasada czyszczenia botów pozostaje w interpretacji); progi bez zmian.
- activation_rate / SaaS: granicę słaby/normalny przesunięto z 25 na 30 (mediana Lenny dla SaaS zamiast ogólnej); dane Lenny oznaczono jako ankietę z 2022 r. (samodeklaracje).
- activation_rate / Amplitude D7: w notatkach i metodzie rozdzielono populacje (7 = P75 wszystkich branż; 2,1 i 12,4 = tylko produkty enterprise); progi poza 7 oznaczono jako heurystykę, pewność kontekstu niska; progi bez zmian.
- time_to_value / SaaS B2B: do metody dopisano nieopisaną wartość Userpilot 1 d 1 h 54 min (ok. 25,9 h, być może mediana) i warunkową zmianę granicy dobry/normalny na ok. 26 h; progi bez zmian, confidence niska.
- time_to_value: caveat Userpilot uzupełniono o nieopisaną wartość ok. 25,9 h.
- paywall_hit_rate / freemium: podwójną etykietę „słaby” zmieniono na „słaby (za mało ekspozycji)” (5–12) i „słaby (zbyt szczelnie)” (≥40), aby UI rozróżniał oba pasma.
- paywall_hit_rate / freemium: kotwice oparto na zweryfikowanych medianach (Mather VI 2025 22,8% i VI 2024 15,1%, Piano XII 2024 16,3% / Europa 20,4%, Mather Q2 2022 14,3% / best-in-class 20,3%); INMA (31%, ≤25%, ≥56%) oznaczono jako pomocnicze i niezweryfikowane; przedział optymalny 18–30 bez zmian.
- paywall_hit_rate / freemium: usunięto inma_ceiling_2026 z source_ids i z notatki 'optymalny' (źródłem „<30%” jest zapowiedź w serwisie X – tylko kontekst, nie kotwica).
- paywall_hit_rate / freemium: podpięto nowsze źródła wskazane przez weryfikatora – mather_q1_2026 (Ameryka Płn., 26.05.2026), mather_de_2026_07 i mather_uk_2026_07 (miesięczne benchmarki DE/UK 2026, za formularzem) – do pozyskania przy aktualizacji progów.
- paywall_hit_rate / twardy paywall: kontekst oznaczono jako heurystykę opartą wyłącznie na niezweryfikowanych danych INMA (HTTP 403), pewność kontekstu niska; progi bez zmian.
- paywall_hit_rate: caveats – INMA oznaczono jako niezweryfikowane (w tym +67% zasięgu), „<30%” jako kontekst bez roli kotwicy; do rozrzutu Piano 2023 dopisano Top/Bottom i medianę ok. 8,8%.
- Źródło piano_nypa_2025: dopisano okresy danych (XII 2024 dla ekspozycji i konwersji, II 2025 dla szablonów), przypisanie 30× do Piano 2024 i dokładne brzmienie slajdu o trialach (porównanie z płatnymi trialami).
- Źródło piano_inma_2023: Top/Bottom opisano jako krańce rozkładu (nie decyle), dodano mediany I 2023 (konwersja ok. 0,11–0,12%, ekspozycja ok. 8,8%) i wynik testów regwalla 3× NO / 1× YES.
- Źródło piano_2024: okres danych poprawiono z Q3 2022–Q3 2024 na I 2022–IX 2024; dopisano, że mnożnika 30× na tej stronie nie ma.
- Źródło piano_2022_pr: dopisano, że komunikat nie wiąże zakresu 0,5–12% wprost z kohortą zarejestrowanych i nie podaje średniej 3%.
- Źródło digiday_2022: 3% opisano jako średnią/odsetek ogólny, nie medianę; doprecyzowano 21,4% jako udział konwersji z pierwszego roku.
- Źródło mather_2022: dopisano skład próby (100 rynków USA + 3 międzynarodowe, głównie prasa lokalna) i definicję best-in-class (średnia rynków wzorcowych, nie percentyl).
- Źródło mather_q2_2025: data publikacji oznaczona jako niepodana (VIII 2025 wywnioskowane ze ścieżki obrazka); dopisano brak liczbowych wartości konwersji.
- Źródło mather_regwall: URL zastąpiono kanonicznym adresem artykułu źródłowego (…/2022/02/10/an-inside-look-on-how-registration-walls-impact-subscriber-growth/), data 2022-02-10 zamiast przybliżonej.
- Źródło mather_intercept_2024: datę poprawiono z 2024-06-17 na 2024-06-24 (data w tekście); dopisano 91/27 serwisów i efekt zmiany limitu 3→2.
- Źródło pressgazette_2024: dopisano brak definicji INMA, definicję rankingu Press Gazette (Similarweb) oraz The Athletic ok. 26% i Barron's ok. 19%.
- Źródło inma_checkout_2026: oznaczono jako niezweryfikowane (HTTP 403 Cloudflare, nie martwy link) – nie usunięto z source_ids, obniżono pewność kontekstów checkoutu.
- Źródło inma_7reasons: oznaczono jako niezweryfikowane (HTTP 403); dopisano pośrednią spójność 30% e-commerce z Baymard.
- Źródło inma_nyt_reach: oznaczono jako niezweryfikowane (HTTP 403), data publikacji nieustalona.
- Źródło inma_shadow_2026: oznaczono jako niezweryfikowane (HTTP 403); jedyna podstawa kontekstu „twardy paywall” w PHR.
- Źródło inma_ceiling_2026: oznaczono jako niezweryfikowane i najsłabsze (zapowiedź w serwisie X) – wyłącznie kontekst, odpięte od przedziałów PHR.
- Źródło notre_dame_2026: doprecyzowano, że 81% to udział wśród skutecznych obejść (nowa tożsamość przeglądarki), oraz że 84× liczone jest względem podobnych czytelników bez paywalla.
- Źródło dnr_2026: 17% opisano jako pay basket 20 krajów z powszechnymi paywallami, a nie średnią 20 krajów ogółem.
- Źródło dnr_2026_pl: dopisano, że wg metodologii DNR zmiana o 2 pp lub mniej nie jest istotna statystycznie.
- Źródło beehiiv_2026: dopisano dokładne wartości Finance (20,00% / mediana 0,78%) i Investing (18,69% / 0,84%), zakres P90 18,7–30,8%, dorozumiany wzór i aktualizację strony.
- Źródło chartmogul_2026: „200 produktów B2B” poprawiono na „200 produktów (22% B2C/hybrydowe)”; dopisano good = P50, great = P75, okno 6 mies., charakter mediany 8% i ilustracyjny charakter 9% / 4,5% / 3,5%.
- Źródło fps_2025: dopisano pary wartości organic/paid i zastrzeżenie, że to klienci agencji (próba niereprezentatywna).
- Źródło revenuecat_2026: data publikacji oznaczona jako niepotwierdzona (zamiast 2026-03); dopisano, że dane dotyczą 2025 r.
- Źródło baymard_2025: zakres 55–84,27% opisano jako rozrzut średnich z badań (Forrester 2010 – SaleCycle 2020), nie percentyle; data jako aktualizacja 22.09.2025.
- Źródło cartylabs_2026: dopisano brak okresu, próby i metody percentyli (pewność niska).
- Źródło omnisend_2026: poprawiono błąd – 2,2% to popupy na desktopie i mobile jednocześnie (nie „mobile”), tylko desktop 1,4% (wykres 1,3%); dopisano rozbieżność infografiki 2,0% / 1,21 mld.
- Źródło wisepops_2025: dopisano edycję „2026” z 30.09.2025 i to, że „1B” wyświetleń pojawia się tylko w tytule.
- Źródło userpilot_2025: dopisano nieopisaną wartość TTV 1 d 1 h 54 min (ok. 25,9 h) i datę wg metadanych.
- Źródło lenny_2022: dopisano, że to ankieta z 2022 r. (samodeklaracje), a progi good/great (P60/P80) nie mają podanych wartości.
- Źródło amplitude_2025: rozdzielono populacje – 7% = P75 wszystkich branż, 2,1% i 12,4% = tylko produkty enterprise; brak mediany przekrojowej.
- Źródło amplitude_media_2025: 13,4% opisano jako wartość najlepszych produktów medialnych, nie medianę; doprecyzowano okres i próbę.
- Źródło saasdash_2026: uzupełniono wartości segmentowe (self-serve, mid-market, enterprise z CTA demo, freemium).
- Dodano 3 nowe źródła wskazane przez weryfikatora (wszystkie za formularzem, liczby niezweryfikowane): mather_q1_2026 (Ameryka Płn., 26.05.2026), mather_de_2026_07 (Niemcy, lipiec 2026, publ. 20.08.2026), mather_uk_2026_07 (Wielka Brytania, lipiec 2026, publ. 01.09.2026); podpięte do kontekstu freemium w paywall_hit_rate.
- Wszystkim 31 dotychczasowym źródłom nadano pole verification wg weryfikatora (tak: 21, częściowo: 5, nie da się sprawdzić: 5 – strony INMA z HTTP 403); żadne źródło nie miało wyniku „nie” ani martwego linku, więc żadnego nie usunięto z source_ids poza odpięciem inma_ceiling_2026 od przedziałów PHR.
- signup_form_conversion_rate (2026-10-19): dodano konteksty linkedin_lgf_content i linkedin_lgf_demo z pakietu Insider marketingowy (decyzja właściciela „uspójnij”); źródło kiin_lgf_benchmarks_2026 (Kiin Labs 2026, B) i zastrzeżenie o mianowniku (otwarcia formularza); szczegóły w sekcji „Uzupełnienie 2026-10-19”.

## 5. E-mail i newsletter

### OR: Wskaźnik otwarć (Open Rate)

- **Rozwinięcie:** Open Rate: odsetek dostarczonych wiadomości, które zarejestrowano jako otwarte (unikalne otwarcia) / Open Rate: share of delivered emails registered as opened (unique opens)
- **Wzór:** unikalne otwarcia / (wysłane − odbicia) × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mówi, jaka część dostarczonych e-maili została zarejestrowana jako otwarta. Mierzy więc rozpoznawalność nadawcy, siłę tematu i pośrednio dostarczalność. Od iOS 15 Apple Mail Privacy Protection (MPP) z góry pobiera piksel śledzący, przez co otwarcia są zawyżone. Według Litmus Apple Mail to ok. 77% śledzonych otwarć (IX 2026), a według badań cytowanych przez Litmus MPP dotyczy ok. 55–60% otwarć. OR czytaj więc jako trend wewnętrzny i sygnał ostrzegawczy dostarczalności, a decyzje opieraj na CTR/CTOR i konwersji. Pułapki: różne mianowniki (wysłane vs dostarczone), różne filtrowanie botów u dostawców usług e-mail (ESP) i skok OR bez wzrostu kliknięć, który zwykle wynika z MPP lub skanerów, a nie z realnego zainteresowania.
- **Interpretation (EN):** Shows what share of delivered emails registered an open: a proxy for sender recognition, subject-line strength and, indirectly, deliverability. Since iOS 15, Apple Mail Privacy Protection (MPP) preloads tracking pixels and inflates opens (Litmus: Apple Mail ~77% of tracked opens in Sep 2026; according to studies cited by Litmus, MPP affects ~55–60% of opens), so treat OR as an internal trend and deliverability warning signal and base decisions on CTR/CTOR and conversions. Pitfalls: different denominators (sent vs delivered), different bot filtering across ESPs, and OR spikes without click growth, which usually come from MPP or scanners rather than real interest.

**Kontekst:** Newslettery wydawców mediowych (B2B + B2C); Omeda nie podaje, czy wyklucza otwarcia MPP i botów · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 24,6%, P50 31,6%, P75 38,5%); próg krytyczny = P25 − (P50 − P25) (heurystyka) · źródła: src_omeda_h1_2026, src_litmus_market_share_2026

| Ocena     | Przedział | Uwagi                                     |
| --------- | --------- | ----------------------------------------- |
| krytyczny | < 17,6    | poniżej P25 − (P50−P25)                   |
| słaby     | 17,6–24,6 | poniżej P25                               |
| normalny  | 24,6–31,6 | P25–P50; mediana B2B media 30,9%          |
| dobry     | 31,6–38,5 | P50–P75                                   |
| optymalny | ≥ 38,5    | powyżej P75; mediana B2C/enthusiast 40,2% |

**Kontekst:** Polska, wszystkie branże (dane ESP) · okres: na kampanię · metoda: mediana ± heurystyka: mediana PL 36,05% (MailerLite, XII 2024–XI 2025), średnia PL 38,07% (GetResponse, dane 2023); próg optymalny ≈ mediana Europy 45,08% · źródła: src_mailerlite_2025, src_getresponse_2024

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | < 20      |                            |
| słaby     | 20–30     |                            |
| normalny  | 30–38     | obejmuje medianę PL        |
| dobry     | 38–45     |                            |
| optymalny | ≥ 45      | od ≈ mediany Europy 45,08% |

**Kontekst:** Non-profit / think tank / NGO · okres: na kampanię · metoda: heurystyka: zakres median/średnich źródeł (Mailchimp 40,04% [dane do XII 2023; najstarsze źródło, najniższa waga], MailerLite 52,38% [mediana 2025], GetResponse 54,54% [średnia, dane 2023]); mediana MailerLite 52,38% wypada w przedziale „dobry”, a nie na granicy normalny/dobry jak w kontekstach kwartylowych (Omeda, GlueLetter) · źródła: src_mailerlite_2025, src_getresponse_2024, src_mailchimp_2023

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 25      |       |
| słaby     | 25–35     |       |
| normalny  | 35–48     |       |
| dobry     | 48–55     |       |
| optymalny | ≥ 55      |       |

**Kontekst:** B2B, edukacja wyższa, doradztwo, biznes i finanse · okres: na kampanię · metoda: heurystyka: MailerLite 2025 (mediany: biznes i finanse 43,34%, konsulting 45,96%, szkolnictwo wyższe 43,98%); GetResponse (edukacja 41,33%, dane 2023); Mailchimp (biznes+finanse 31,35%, edukacja 35,64%; dane do XII 2023 – najstarsze źródło, najniższa waga); mediany MailerLite (43–46%) wypadają w przedziale „dobry”, a nie na granicy normalny/dobry jak w kontekstach kwartylowych · źródła: src_mailerlite_2025, src_getresponse_2024, src_mailchimp_2023

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 20      |       |
| słaby     | 20–30     |       |
| normalny  | 30–40     |       |
| dobry     | 40–47     |       |
| optymalny | ≥ 47      |       |

**Kontekst:** Newslettery treściowe (kreatorzy, niezależni wydawcy; próba GlueLetter, bez filtrowania MPP) · okres: na wysyłkę (Q1 2025) · metoda: kwartyle źródła (P25 37,40%, P50 49,3%, P75 61,50%, P90 68,96%; tekst strony podaje środkowe 50% jako 38,9–60,2% – niespójność niewyjaśniona przez źródło, przyjęto tabelę); próg krytyczny = P25 − (P50 − P25) (heurystyka) · źródła: src_glueletter_open_q1_2025

| Ocena     | Przedział | Uwagi        |
| --------- | --------- | ------------ |
| krytyczny | < 25,5    |              |
| słaby     | 25,5–37,4 |              |
| normalny  | 37,4–49,3 |              |
| dobry     | 49,3–61,5 |              |
| optymalny | ≥ 61,5    | P90 = 68,96% |

**Zastrzeżenia:**

- Apple MPP zawyża otwarcia (Litmus: Apple Mail 76,56% udziału w otwarciach, IX 2026). Przy liście z dużym udziałem iPhone'ów OR może rosnąć bez zmiany zachowań czytelników.
- Benchmarki ESP (MailerLite, GetResponse, Mailchimp) nie są korygowane o MPP (MailerLite sam zaznacza, że „real open rates are lower”). Omnisend i Klaviyo raportują wyraźnie niższe OR (ok. 30–31%), co najpewniej wynika z innej metodologii. Porównuj tylko w obrębie tej samej metodologii.
- GetResponse publikuje edycję „Updated for 2024” z danymi z 2023 r. Nowszej edycji nie znaleziono.
- W panelu warto liczyć równolegle OR z wyłączeniem otwarć oznaczonych jako Apple MPP, jeśli ESP to umożliwia.
- Mailchimp (dane do XII 2023) to najstarsze źródło w grupie i ma najniższą wagę względem MailerLite 2025 i Omeda 2026; jego FAQ przeczy tabeli (ogółem 34,23% wobec 35,63%).
- Omeda nie podaje, czy wyklucza otwarcia MPP i botów („privacy features and automated inbox activity load images and register opens”), i wskazuje, że „Click-to-open and click rate are the most reliable comparison points”.

### CTR: Współczynnik kliknięć (Click-Through Rate)

- **Rozwinięcie:** Click-Through Rate: odsetek dostarczonych wiadomości, w których odbiorca kliknął co najmniej jeden link / Click-Through Rate: share of delivered emails in which the recipient clicked at least one link
- **Wzór:** unikalne kliknięcia / dostarczone × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Po wprowadzeniu MPP to podstawowa i najbardziej wiarygodna miara realnego zaangażowania: pokazuje, ilu odbiorców przeszło do treści, oferty lub rejestracji. Czytaj go razem z CTOR (czy problemem jest zasięg otwarć, czy treść) i z konwersją. Pułapki: automatyczne kliknięcia skanerów bezpieczeństwa (częste w skrzynkach firmowych B2B i instytucjach), wliczanie kliknięć w link wypisu oraz mylenie CTR liczonego od dostarczonych z „click rate” liczonym od otwarć (to CTOR).
- **Interpretation (EN):** After MPP, this is the primary and most reliable measure of real engagement: how many recipients went through to content, an offer or a registration. Read it together with CTOR (reach of opens vs content quality) and conversion. Pitfalls: automated clicks by security scanners (common in B2B/institutional inboxes), counting unsubscribe-link clicks, and confusing CTR on delivered with 'click rate' on opens (that is CTOR).

**Kontekst:** Newslettery wydawców mediowych (B2B + B2C) · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 0,6%, P50 1,16%, P75 2,0%); próg krytyczny = połowa P25 (heurystyka) · źródła: src_omeda_h1_2026

| Ocena     | Przedział | Uwagi                            |
| --------- | --------- | -------------------------------- |
| krytyczny | < 0,3     |                                  |
| słaby     | 0,3–0,6   | poniżej P25                      |
| normalny  | 0,6–1,16  | P25–P50; mediana B2B media 1,01% |
| dobry     | 1,16–2    | P50–P75                          |
| optymalny | ≥ 2       | powyżej P75; mediana B2C 2,86%   |

**Kontekst:** Polska, wszystkie branże (dane ESP) · okres: na kampanię · metoda: mediana ± heurystyka: mediana PL 1,46% i globalna 2,09% (MailerLite 2025); GetResponse PL 5,38% (dane 2023, inna próba) jako górny punkt odniesienia · źródła: src_mailerlite_2025, src_getresponse_2024

| Ocena     | Przedział | Uwagi               |
| --------- | --------- | ------------------- |
| krytyczny | < 0,5     |                     |
| słaby     | 0,5–1     |                     |
| normalny  | 1–2       | obejmuje medianę PL |
| dobry     | 2–3,5     |                     |
| optymalny | ≥ 3,5     |                     |

**Kontekst:** Non-profit / think tank: newslettery i komunikacja ogólna · okres: na kampanię · metoda: zakres źródeł: MailerLite non-profit 2,90% (2025), Mailchimp 3,27% (dane do XII 2023; najstarsze źródło, najniższa waga), GetResponse 6,70% (dane 2023) + heurystyka · źródła: src_mailerlite_2025, src_mailchimp_2023, src_getresponse_2024

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,8     |       |
| słaby     | 0,8–1,5   |       |
| normalny  | 1,5–3     |       |
| dobry     | 3–5       |       |
| optymalny | ≥ 5       |       |

**Kontekst:** B2B, edukacja wyższa, doradztwo, biznes i finanse · okres: na kampanię · metoda: mediana ± heurystyka: MailerLite 2025 (biznes i finanse 2,37%, konsulting 2,41%, szkolnictwo wyższe 2,15%); Mailchimp (biznes+finanse 2,78%, edukacja 3,02%; dane do XII 2023 – najstarsze źródło, najniższa waga); GetResponse (edukacja 3,17%) · źródła: src_mailerlite_2025, src_mailchimp_2023, src_getresponse_2024

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,7     |       |
| słaby     | 0,7–1,3   |       |
| normalny  | 1,3–2,4   |       |
| dobry     | 2,4–3,5   |       |
| optymalny | ≥ 3,5     |       |

**Kontekst:** Apele zbiórkowe / sprzedażowe w non-profit (fundraising) · okres: na wysyłkę (wartość typowa M+R za 2025) · metoda: wartość typowa M+R (metodologia M+R: mediany per wskaźnik; CTR fundraising 0,59%, advocacy 2,3%) ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                         |
| --------- | --------- | ----------------------------- |
| krytyczny | < 0,2     |                               |
| słaby     | 0,2–0,4   |                               |
| normalny  | 0,4–0,75  | obejmuje wartość typową 0,59% |
| dobry     | 0,75–1,2  |                               |
| optymalny | ≥ 1,2     |                               |

**Zastrzeżenia:**

- GetResponse (dane 2023) podaje dla Polski CTR 5,38%, a MailerLite (2025) 1,46%. Rozbieżność wynika z innej próby i metodologii, dlatego jako bazę przyjęto medianę MailerLite.
- W listach instytucjonalnych i B2B włącz filtrowanie kliknięć botów (np. kliknięcia w ciągu kilku sekund od doręczenia).
- Kontekst „apele zbiórkowe” dotyczy wysyłek z prośbą o wpłatę lub zakup. Nie porównuj go z CTR newslettera treściowego.

### CTOR: Współczynnik kliknięć do otwarć (Click-to-Open Rate)

- **Rozwinięcie:** Click-to-Open Rate: odsetek otwierających, którzy kliknęli co najmniej jeden link / Click-to-Open Rate: share of openers who clicked at least one link
- **Wzór:** unikalne kliknięcia / unikalne otwarcia × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Ocenia jakość treści i wezwań do działania wśród tych, którzy e-mail otworzyli, niezależnie od tematu i dostarczalności. Niski CTOR przy dobrym OR oznacza, że temat „obiecał” więcej niż treść dowiozła albo linki są słabo wyeksponowane. Pułapki: MPP zawyża mianownik (otwarcia), więc CTOR jest zaniżony i spada wraz ze wzrostem udziału Apple Mail. Niektóre narzędzia (np. GlueLetter) nazywają CTOR „click rate”.
- **Interpretation (EN):** Evaluates content and call-to-action quality among those who opened, independent of subject line and deliverability. Low CTOR with a good OR means the subject over-promised or links are poorly placed. Pitfalls: MPP inflates the denominator (opens), so CTOR is understated and falls as Apple Mail share grows; some tools (e.g., GlueLetter) call CTOR 'click rate'.

**Kontekst:** Newslettery wydawców mediowych (B2B + B2C) · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 2,3%, P50 3,8%, P75 5,8%); próg krytyczny = połowa P25 (heurystyka) · źródła: src_omeda_h1_2026

| Ocena     | Przedział | Uwagi                  |
| --------- | --------- | ---------------------- |
| krytyczny | < 1,15    |                        |
| słaby     | 1,15–2,3  |                        |
| normalny  | 2,3–3,8   | mediana B2B media 3,4% |
| dobry     | 3,8–5,8   |                        |
| optymalny | ≥ 5,8     | mediana B2C 7,6%       |

**Kontekst:** Newslettery treściowe (kreatorzy, niezależni wydawcy; GlueLetter: kliknięcia/otwierający, boty wykluczone) · okres: na wysyłkę (Q1 2025) · metoda: kwartyle źródła (P25 4,45%, P50 7,65%, P75 12,67%, P90 19,60%); próg krytyczny = połowa P25 · źródła: src_glueletter_click_q1_2025

| Ocena     | Przedział  | Uwagi |
| --------- | ---------- | ----- |
| krytyczny | < 2,2      |       |
| słaby     | 2,2–4,45   |       |
| normalny  | 4,45–7,65  |       |
| dobry     | 7,65–12,67 |       |
| optymalny | ≥ 12,67    |       |

**Kontekst:** Polska i rynek ogólny (non-profit, edukacja, B2B, wydawnictwa) · okres: na kampanię · metoda: mediana ± heurystyka: MailerLite 2025 (ogółem 6,81%, PL 6,63%, media 12,92%, wydawnictwa 9,12%, non-profit 8,24%, szkolnictwo wyższe 9,15%, biznes i finanse 7,96%); GetResponse (ogółem 8,62%, PL 14,12%, publishing 14,43%; dane 2023) · źródła: src_mailerlite_2025, src_getresponse_2024

| Ocena     | Przedział | Uwagi                        |
| --------- | --------- | ---------------------------- |
| krytyczny | < 2,5     |                              |
| słaby     | 2,5–4,5   |                              |
| normalny  | 4,5–8     | obejmuje mediany PL i ogólną |
| dobry     | 8–12      |                              |
| optymalny | ≥ 12      |                              |

**Zastrzeżenia:**

- Przy rosnącym udziale Apple Mail CTOR spada mechanicznie. Porównuj okresy tylko przy podobnym udziale klientów pocztowych.
- Mediany Omeda dla mediów (3,8%) są wyraźnie niższe od median ESP (6–13%). Hipoteza (żadne źródło jej nie podaje): to efekt innej próby (duzi wydawcy, częste wysyłki), a nie błąd.
- MailerLite: przez MPP realny CTOR jest wyższy od raportowanego, bo zawyżone otwarcia trafiają do mianownika.

### UR: Wskaźnik wypisań (Unsubscribe Rate)

- **Rozwinięcie:** Unsubscribe Rate: odsetek dostarczonych wiadomości, po których odbiorca wypisał się z listy / Unsubscribe Rate: share of delivered emails that led the recipient to unsubscribe
- **Wzór:** wypisania / dostarczone × 100% (na wysyłkę); wariant roczny: wypisani w roku / lista na początku roku × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy dopasowanie częstotliwości i treści do oczekiwań odbiorców. Niewielka liczba wypisań jest zdrowa, bo oczyszcza listę z nieaktywnych. Kłopotem jest trend wzrostowy lub skok po konkretnej wysyłce. Pułapki: bardzo niski wskaźnik może znaczyć, że wypisanie jest trudne i ludzie klikają „spam”, co jest dużo groźniejsze (patrz spam_complaint_rate). Od 2024 r. Gmail i Yahoo wymagają jednoklikowego wypisania; ułatwienie wypisu prawdopodobnie podniosło wypisania (MailerLite: „likely”), ale chroni reputację nadawcy.
- **Interpretation (EN):** Measures fit of cadence and content to subscriber expectations; a small number of unsubscribes is healthy list hygiene, a rising trend or a spike after a specific send is the problem. Pitfalls: a very low rate may mean opting out is hard and people hit 'spam' instead, which is far worse (see spam_complaint_rate); since 2024 Gmail/Yahoo have required one-click unsubscribe; easier opt-out has likely raised unsubscribe rates (MailerLite: 'likely') but protects sender reputation.

**Kontekst:** Newslettery wydawców mediowych (B2B + B2C) · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 0,05%, P50 0,09%, P75 0,13%); próg krytyczny ≈ 2× mediana (0,18%), zaokrąglone do 0,2% (heurystyka) · źródła: src_omeda_h1_2026

| Ocena     | Przedział | Uwagi       |
| --------- | --------- | ----------- |
| krytyczny | ≥ 0,2     |             |
| słaby     | 0,13–0,2  | powyżej P75 |
| normalny  | 0,09–0,13 | P50–P75     |
| dobry     | 0,05–0,09 | P25–P50     |
| optymalny | < 0,05    | poniżej P25 |

**Kontekst:** Polska i rynek ogólny, kampanie (newsletter, non-profit, B2B, edukacja) · okres: na kampanię · metoda: mediana ± heurystyka: MailerLite 2025 (ogółem 0,22%, PL 0,17%, media 0,10%, wydawnictwa 0,20%, non-profit 0,19%); GetResponse (ogółem 0,15%, PL 0,16%, newsletter 0,12%; dane 2023); Mailchimp 0,22% (dane do XII 2023; najstarsze źródło, najniższa waga); Validity: 0,3% to poziom, z którym nadawcy „bywają komfortowi”, choć eroduje listę · źródła: src_mailerlite_2025, src_getresponse_2024, src_mailchimp_2023, src_validity_2026

| Ocena     | Przedział | Uwagi                          |
| --------- | --------- | ------------------------------ |
| krytyczny | ≥ 0,4     |                                |
| słaby     | 0,25–0,4  |                                |
| normalny  | 0,17–0,25 | obejmuje mediany PL i globalną |
| dobry     | 0,1–0,17  |                                |
| optymalny | < 0,1     |                                |

**Kontekst:** E-maile automatyczne (powitalne, porzucony koszyk, autorespondery) · okres: na wysyłkę · metoda: średnie źródeł ± heurystyka: GetResponse powitalne 0,94%, autoresponder 0,37% (dane 2023); Omnisend automatyzacje 0,59%, powitalne 0,87%, porzucony koszyk 0,45% (dane 2025) · źródła: src_getresponse_2024, src_omnisend_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | ≥ 1,5     |       |
| słaby     | 0,95–1,5  |       |
| normalny  | 0,6–0,95  |       |
| dobry     | 0,35–0,6  |       |
| optymalny | < 0,35    |       |

**Kontekst:** Non-profit / think tank, odpływ roczny przez wypisania · okres: rocznie (% listy z początku roku) · metoda: wartość typowa M+R 12% (2025; metodologia: mediany per wskaźnik), sektor z najwyższym odpływem 21% (Disaster/International Aid) ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                                                                      |
| --------- | --------- | -------------------------------------------------------------------------- |
| krytyczny | ≥ 20      | poziom sektora pomocy humanitarnej, który jako jedyny notował spadek listy |
| słaby     | 13–20     |                                                                            |
| normalny  | 9–13      | obejmuje wartość typową 12%                                                |
| dobry     | 6–9       |                                                                            |
| optymalny | < 6       |                                                                            |

**Zastrzeżenia:**

- MailerLite odnotował wzrost mediany wypisań z 0,08% (2024) do 0,22% (2025) i wiąże go prawdopodobnie („likely”) ze zmianami w Gmailu ułatwiającymi wypis z poziomu skrzynki. Nie traktuj tego jako pogorszenia jakości treści.
- Wypisy z e-maili automatycznych są naturalnie wyższe niż z kampanii, dlatego raportuj je osobno.

### HBR: Wskaźnik twardych odbić (Hard Bounce Rate)

- **Rozwinięcie:** Hard Bounce Rate: odsetek wiadomości trwale odrzuconych (adres nie istnieje, domena nieprawidłowa) / Hard Bounce Rate: share of emails permanently rejected (address does not exist, invalid domain)
- **Wzór:** twarde odbicia / wysłane × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje jakość bazy adresowej i procesu zapisu. Dostawcy skrzynek traktują wysyłkę na nieistniejące adresy jako sygnał złych praktyk, co obniża reputację i trafianie do skrzynki odbiorczej. Każdy twardy bounce trzeba natychmiast wyciszyć (suppress). Pułapki: skoki po imporcie starych kontaktów z CRM lub z wydarzeń. Konta nieaktywne są zamykane (Yahoo po 12, Gmail po 24 miesiącach), więc listy uśpione „gniją” szybciej.
- **Interpretation (EN):** Reflects address-data quality and the sign-up process; mailbox providers treat sending to non-existent addresses as a bad-practice signal that lowers reputation and inbox placement. Every hard bounce must be suppressed immediately. Pitfalls: spikes after importing old CRM/event contacts; inactive accounts get closed (Yahoo after 12, Gmail after 24 months), so dormant lists decay faster.

**Kontekst:** Każda wysyłka marketingowa do listy z opt-in (newsletter, kampanie) · okres: na wysyłkę · metoda: progi dostawcy + średnia rynkowa + heurystyka: AWS SES zaleca <2%, ≥5% = przegląd konta, ≥10% = możliwe wstrzymanie wysyłki (AWS wlicza do bounce rate tylko twarde odbicia do niezweryfikowanych domen, z okna „representative volume”); średni odsetek nieistniejących adresów (unknown users) w 2025 r. wg Validity 1,46%; Validity: 0,1% twardych odbić to poziom „komfortowy”; DeBounce (2026-02-04, bez źródła danych): „Hard bounces should stay under 0.5-1%”, co wspiera granicę dobry/normalny przy 0,5% · źródła: src_aws_ses_enforcement, src_validity_2026, src_debounce_bounce, src_getresponse_2024, src_zerobounce_decay_2026

| Ocena     | Przedział | Uwagi                                              |
| --------- | --------- | -------------------------------------------------- |
| krytyczny | ≥ 2       | ≥5% = przegląd konta w AWS SES, ≥10% = wstrzymanie |
| słaby     | 1,5–2     |                                                    |
| normalny  | 0,5–1,5   | obejmuje średnią Validity 1,46%                    |
| dobry     | 0,2–0,5   |                                                    |
| optymalny | < 0,2     |                                                    |

**Kontekst:** Non-profit / think tank, roczny odpływ przez odbicia · okres: rocznie (% listy z początku roku) · metoda: wartość typowa M+R 4% (2025; metodologia: mediany per wskaźnik), sektor z najwyższym odpływem 6% (Disaster/International Aid) ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | ≥ 7       |                            |
| słaby     | 5–7       |                            |
| normalny  | 3–5       | obejmuje wartość typową 4% |
| dobry     | 2–3       |                            |
| optymalny | < 2       |                            |

**Zastrzeżenia:**

- GetResponse podaje bounce bez definicji (nie wiadomo, czy obejmuje miękkie odbicia): średnio 2,33%, dla Polski 1,13% (dane 2023). Nie porównuj go 1:1 z twardymi odbiciami.
- ZeroBounce: co najmniej 23% adresów na liście degraduje się w ciągu roku (dane 2025; FAQ tej samej strony podaje 25,74%). Przed wysyłką do kontaktów nieaktywnych dłużej niż 12 miesięcy zweryfikuj adresy.

### SBR: Wskaźnik miękkich odbić (Soft Bounce Rate)

- **Rozwinięcie:** Soft Bounce Rate: odsetek wiadomości czasowo niedoręczonych (pełna skrzynka, chwilowa blokada, ograniczanie przepustowości przez dostawcę) / Soft Bounce Rate: share of emails temporarily undelivered (full mailbox, temporary block, provider throttling)
- **Wzór:** miękkie odbicia / wysłane × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Sygnalizuje przejściowe problemy z doręczeniem: pełne skrzynki, przerwy serwerów, a najczęściej ograniczanie przepustowości lub czasowe blokady przy słabnącej reputacji. Pojedyncze miękkie odbicia są normalne. Groźny jest skok skupiony u jednego dostawcy (np. Outlook, WP, Onet, Interia), który zwykle oznacza problem reputacyjny, a nie jakość listy. Pułapka: adres odbijający miękko w 3–5 kolejnych wysyłkach warto traktować jak twardy bounce i wyciszyć (reguła praktyków – heurystyka bez źródła).
- **Interpretation (EN):** Signals transient delivery issues: full mailboxes, server outages and, most often, throttling or temporary blocks as reputation weakens. Isolated soft bounces are normal; a spike concentrated at one provider (e.g., Outlook, WP, Onet, Interia) usually means a reputation problem, not list quality. Pitfall: an address soft-bouncing across 3–5 consecutive sends is worth treating as a hard bounce and suppressing (practitioner rule of thumb – a heuristic with no source).

**Kontekst:** Każda wysyłka marketingowa (rynek ogólny) · okres: na wysyłkę · metoda: heurystyka; DeBounce (2026-02-04, bez metodologii): soft bounce 1–3% „without immediate concern”; cel <2% i próg słaby 2–3% są ostrzejsze od DeBounce, to heurystyka ekspercka; bounce GetResponse 2,33% (dane 2023) bez definicji – nie wiadomo, czy obejmuje miękkie odbicia; brak publicznego, aktualnego benchmarku pierwotnego · źródła: src_debounce_bounce, src_getresponse_2024, src_validity_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | ≥ 3       |       |
| słaby     | 2–3       |       |
| normalny  | 1–2       |       |
| dobry     | 0,5–1     |       |
| optymalny | < 0,5     |       |

**Zastrzeżenia:**

- Brak wiarygodnych, aktualnych benchmarków pierwotnych dla miękkich odbić. Przedziały są heurystyką ekspercką. Źródło Bounceless (miękkie <2%) usunięto – martwy link (HTTP 410).
- Analizuj soft bounce osobno dla każdej domeny odbiorcy. Polscy dostawcy (WP, Onet, Interia, o2) nie należą do grupy MAGY (Microsoft, Apple, Gmail, Yahoo). Według Validity regionalni dostawcy w Europie mają średni IPR 79,7%, czyli ok. 11,4 p.p. mniej niż MAGY; 10–25 p.p. to rozpiętość globalna dla wszystkich regionów.

### SCR: Wskaźnik zgłoszeń spamu (Spam Complaint Rate)

- **Rozwinięcie:** Spam Complaint Rate: odsetek wiadomości oznaczonych przez odbiorców przyciskiem „to spam” / „zgłoś jako spam” / Spam Complaint Rate: share of emails that recipients marked as spam / junk
- **Wzór:** zgłoszenia spamu / wiadomości dostarczone do skrzynki odbiorczej × 100% (definicja Google Postmaster Tools / Yahoo Sender Hub); w ESP: zgłoszenia z pętli zwrotnych (FBL) / dostarczone
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** To najsilniejszy sygnał reputacyjny dla Gmaila, Yahoo i Microsoftu, który bezpośrednio decyduje o trafianiu do skrzynki odbiorczej lub do spamu. Od 1 lutego 2024 r. Google wymaga utrzymania wskaźnika poniżej 0,3% i zaleca poniżej 0,10%, a Yahoo wymaga poniżej 0,3%. Pułapki: panel ESP zaniża wskaźnik, bo Gmail nie przekazuje zgłoszeń per odbiorca, więc rzeczywisty poziom sprawdzaj w Google Postmaster Tools. Zgłoszenia rosną na początku roku i przy nagłych skokach wolumenu.
- **Interpretation (EN):** The strongest reputation signal for Gmail, Yahoo and Microsoft, directly deciding inbox vs spam placement. Since 1 Feb 2024 Google requires staying below 0.3% and recommends below 0.10%; Yahoo requires below 0.3%. Pitfalls: ESP dashboards understate it because Gmail does not pass per-recipient complaints, so check the real level in Google Postmaster Tools; complaints rise at the start of the year and on sudden volume spikes.

**Kontekst:** Pomiar dostawcy skrzynek (Google Postmaster Tools / Yahoo Sender Hub), wszyscy nadawcy · okres: dziennie / kroczący 7–30 dni · metoda: progi regulacyjne Google i Yahoo (0,10% zalecane, 0,30% limit) + średnia rynkowa Validity 0,06% (2025; raport nie podaje, że pochodzi z Postmaster Tools) + heurystyka dla dolnych przedziałów; AWS SES: ≥0,1% = przegląd konta, ≥0,5% = wstrzymanie (AWS liczy skargi tylko z domen z pętlą FBL, a więc bez Gmaila) · źródła: src_google_sender_guidelines, src_yahoo_sender_hub, src_validity_2026, src_aws_ses_enforcement, src_validity_2025

| Ocena     | Przedział | Uwagi                                                      |
| --------- | --------- | ---------------------------------------------------------- |
| krytyczny | ≥ 0,3     | twardy limit Google/Yahoo; ryzyko blokad                   |
| słaby     | 0,1–0,3   | powyżej zalecenia Google; przegląd w AWS SES               |
| normalny  | 0,05–0,1  | obejmuje średnią Validity 0,06% (źródło pomiaru niepodane) |
| dobry     | 0,02–0,05 |                                                            |
| optymalny | < 0,02    |                                                            |

**Kontekst:** Raport ESP z pętli FBL: newslettery wydawców mediowych · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 0,001%, P50 0,002%, P75 0,004%); próg krytyczny 0,01% = wartość GetResponse dla newslettera, Publishing, Non-profits, Polski i Europy (ogółem <0,01%) (heurystyka) · źródła: src_omeda_h1_2026, src_getresponse_2024

| Ocena     | Przedział   | Uwagi       |
| --------- | ----------- | ----------- |
| krytyczny | ≥ 0,01      |             |
| słaby     | 0,004–0,01  | powyżej P75 |
| normalny  | 0,002–0,004 | P50–P75     |
| dobry     | 0,001–0,002 | P25–P50     |
| optymalny | < 0,001     | poniżej P25 |

**Zastrzeżenia:**

- Validity (dane 2024): tylko 25% ankietowanych nadawców utrzymywało zgłoszenia poniżej 0,1%. Validity (2026): dawniej mówiono o 0,2–0,3%, dziś oczekiwaniem jest poniżej 0,1%.
- Nadawcy wysyłający ponad 5000 wiadomości dziennie do Gmaila muszą mieć SPF, DKIM, DMARC i jednoklikowe wypisanie (List-Unsubscribe-Post). Yahoo wymaga realizacji wypisu w ciągu 2 dni.
- Wartości z ESP i z Postmaster Tools różnią się o rząd wielkości. W panelu pokazuj je jako osobne wskaźniki.

### LGR: Tempo wzrostu listy (netto) (List Growth Rate (net))

- **Rozwinięcie:** List Growth Rate: procentowa zmiana liczby aktywnych, potwierdzonych subskrybentów w okresie po odjęciu odpływu / List Growth Rate: percentage change in active, confirmed subscribers over a period after subtracting attrition
- **Wzór:** (nowe potwierdzone zapisy − wypisy − adresy usunięte po odbiciach i skargach) / aktywni subskrybenci na początku okresu × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, czy pozyskiwanie subskrybentów nadąża za naturalnym odpływem. Organizacje non-profit tracą rocznie ok. 16% listy (12% wypisów i 4% odbić, M+R), a ZeroBounce szacuje degradację adresów na co najmniej 23% rocznie (FAQ tej samej strony: 25,74%). Czytaj go razem z jakością nowych zapisów (CTR kohort, potwierdzenia DOI). Pułapki: liczenie zapisów brutto bez odpływu, doliczanie kontaktów importowanych bez zgody marketingowej oraz porównywanie młodej listy, która rośnie naturalnie szybko, z dojrzałymi organizacjami.
- **Interpretation (EN):** Shows whether acquisition keeps pace with natural attrition: nonprofits lose ~16% of the list per year (12% unsubscribes + 4% bounces, M+R) and ZeroBounce estimates address decay at ≥23% per year (the same page's FAQ: 25.74%). Read together with the quality of new sign-ups (cohort CTR, DOI confirmations). Pitfalls: counting gross sign-ups without attrition, adding imported contacts without marketing consent, and comparing a young (naturally fast-growing) list with mature organisations.

**Kontekst:** Dojrzałe organizacje non-profit / think tanki (dane USA) · okres: rocznie · metoda: wartość typowa M+R (mediana lub średnia) ± heurystyka: wzrost netto 5% w 2025 r. (4% i 9% w dwóch poprzednich latach; M+R nie przypisuje lat); media publiczne 12% jako próg optymalny · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | < 0       | lista się kurczy           |
| słaby     | 0–3       |                            |
| normalny  | 3–7       | obejmuje wartość typową 5% |
| dobry     | 7–12      |                            |
| optymalny | ≥ 12      | poziom mediów publicznych  |

**Kontekst:** Dojrzałe organizacje non-profit / think tanki, ujęcie miesięczne · okres: miesięcznie · metoda: przeliczenie geometryczne progów rocznych ((1+r)^(1/12) − 1): 3% → 0,25%, 7% → 0,57%, 12% → 0,95% · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–0,25    |       |
| normalny  | 0,25–0,57 |       |
| dobry     | 0,57–0,95 |       |
| optymalny | ≥ 0,95    |       |

**Kontekst:** Młoda lista w fazie budowy (pierwsze 24 miesiące) · okres: rocznie · metoda: heurystyka: pozyskanie musi wyraźnie przewyższać naturalny odpływ (M+R ok. 16% rocznie, ZeroBounce ≥23% degradacji adresów rocznie) · źródła: src_mr_benchmarks_2026, src_zerobounce_decay_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–10      |       |
| normalny  | 10–25     |       |
| dobry     | 25–50     |       |
| optymalny | ≥ 50      |       |

**Zastrzeżenia:**

- Dane M+R dotyczą amerykańskich organizacji non-profit. Brak publicznych polskich benchmarków wzrostu listy.
- Kontekst młodej listy to heurystyka bez benchmarku platform newsletterowych.
- Do wzrostu wliczaj wyłącznie kontakty z ważną zgodą marketingową (RODO, prawo komunikacji elektronicznej).

### DOI CR: Wskaźnik potwierdzeń podwójnej zgody (Double Opt-In Confirmation Rate)

- **Rozwinięcie:** Double Opt-In Confirmation Rate: odsetek zapisów potwierdzonych kliknięciem w link aktywacyjny (podwójna zgoda) / Double Opt-In Confirmation Rate: share of sign-ups confirmed by clicking the activation link
- **Wzór:** potwierdzone zapisy (w oknie 7 dni) / wszystkie zapisy wymagające potwierdzenia × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, ile zapisów z formularzy staje się realnymi subskrybentami. Niski poziom zwykle oznacza, że e-mail potwierdzający trafia do spamu lub zakładki „Oferty”, przychodzi z opóźnieniem albo ma niejasny komunikat. Podwójna zgoda obniża konwersję formularza, ale podnosi jakość listy: w danych GetResponse listy DOI miały OR 35,72% wobec 27,36% i CTR 4,19% wobec 2,36%. Ułatwia też wykazanie zgody (art. 7 ust. 1 RODO). Validity tłumaczy najwyższy w raporcie IPR Niemiec (97,5%) m.in. „widespread use of double opt-in”. Pułapki: skanery linków w skrzynkach firmowych potrafią automatycznie „potwierdzić” zapis, co zawyża wskaźnik, dlatego stosuj ochronę przed kliknięciami botów.
- **Interpretation (EN):** Shows how many form sign-ups become real subscribers. A low level usually means the confirmation email lands in spam/promotions, arrives late or is unclear. DOI lowers form conversion but raises list quality (GetResponse data: DOI lists 35.72% OR vs 27.36% and CTR 4.19% vs 2.36%) and helps demonstrate consent (GDPR Art. 7(1)); Validity attributes Germany's top inbox placement (97.5%) partly to the 'widespread use of double opt-in'. Pitfalls: corporate link scanners can auto-'confirm' sign-ups and inflate the rate, so use bot-click protection.

**Kontekst:** Formularze zapisu na newsletter (B2C + B2B) · okres: na kohortę zapisów (okno 7 dni) · metoda: heurystyka oparta na zakresach dostawców: 65–90% (Truelist z powołaniem na Nutshell), 70–90% jako „solidny” i odpływ 10–35% (Truelist, bez podanego źródła); przedział „normalny” zaczyna się od dolnej granicy typowego zakresu 65%; brak niezależnych benchmarków pierwotnych · źródła: src_truelist_doi_2025, src_getresponse_doi_2024, src_aws_ses_enforcement, src_validity_2026

| Ocena     | Przedział | Uwagi                                     |
| --------- | --------- | ----------------------------------------- |
| krytyczny | < 50      |                                           |
| słaby     | 50–65     |                                           |
| normalny  | 65–75     | od dolnej granicy typowego zakresu 65–90% |
| dobry     | 75–85     |                                           |
| optymalny | ≥ 85      |                                           |

**Zastrzeżenia:**

- Zakresy pochodzą od dostawców narzędzi (vendor blogs), dlatego zaufanie do nich jest niskie. Własna mediana kohort po 3 miesiącach będzie lepszym punktem odniesienia.
- GetResponse (2022): konwersja odwiedzający→subskrybent 0,33% dla DOI vs 1,28% dla SOI (pojedyncza zgoda), czyli koszt DOI w wolumenie bywa duży.
- AWS SES rekomenduje podwójną zgodę jako sposób ograniczania odbić i skarg.
- Brak niezależnego badania odsetka potwierdzeń DOI.
- GetResponse zaznacza, że skargi na spam przy DOI były w wielu przypadkach wyższe niż przy SOI (bez liczb).

### Welcome OR: Wskaźnik otwarć e-maila powitalnego (Welcome Email Open Rate)

- **Rozwinięcie:** Welcome Open Rate: odsetek dostarczonych e-maili powitalnych (pierwszy e-mail po zapisie), które zarejestrowano jako otwarte / Welcome Open Rate: share of delivered welcome emails (first email after sign-up) registered as opened
- **Wzór:** unikalne otwarcia e-maila powitalnego / dostarczone e-maile powitalne × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** E-mail powitalny trafia do osoby w szczycie zainteresowania, więc powinien mieć wyraźnie wyższy OR niż zwykły newsletter: GetResponse 83,63% wobec 40,08% (średnie z danych 2023, nie mediany), Omnisend 35,53% wobec 30,41%. Niski OR powitalnego to najczęściej problem dostarczalności (spam lub zakładka „Oferty”) albo zbyt późna wysyłka. Pułapki: MPP najsilniej zawyża właśnie powitalne, bo proxy Apple pobiera piksel tuż po zapisie. Stripo pokazuje, że raportowane wartości wahają się od ok. 35% do 84% zależnie od źródła, i zaleca oceniać powitalne po CTOR, konwersji i przychodzie na odbiorcę (RPR).
- **Interpretation (EN):** The welcome email reaches people at peak interest, so its OR should clearly exceed a regular newsletter (GetResponse 83.63% vs 40.08% – averages from 2023 data, not medians; Omnisend 35.53% vs 30.41%). A low welcome OR usually signals deliverability issues (spam/promotions tab) or a delayed send. Pitfalls: MPP inflates welcome opens the most because Apple's proxy prefetches right after sign-up; Stripo shows reported values range from ~35% to 84% depending on the source and recommends judging welcome emails by CTOR, conversion and revenue per recipient (RPR).

**Kontekst:** ESP bez korekty MPP (np. GetResponse, MailerLite): listy treściowe i newsletterowe · okres: na wysyłkę · metoda: średnia GetResponse 83,63% (dane 2023; średnia, nie mediana) ± heurystyka; średnia umieszczona w przedziale „normalny” · źródła: src_getresponse_2024, src_stripo_welcome_2026, src_litmus_market_share_2026

| Ocena     | Przedział | Uwagi                   |
| --------- | --------- | ----------------------- |
| krytyczny | < 55      |                         |
| słaby     | 55–70     |                         |
| normalny  | 70–85     | obejmuje średnią 83,63% |
| dobry     | 85–92     |                         |
| optymalny | ≥ 92      |                         |

**Kontekst:** Platformy z inną metodologią otwarć (Omnisend, Klaviyo; e-commerce) · okres: na wysyłkę · metoda: średnia Omnisend 35,53% (2025) ± heurystyka; Klaviyo: „dobry” OR flowów 32,2%, top 10% 45,8% · źródła: src_omnisend_benchmarks_2026, src_klaviyo_benchmarks_2026

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| krytyczny | < 20      |                           |
| słaby     | 20–28     |                           |
| normalny  | 28–36     | obejmuje średnią Omnisend |
| dobry     | 36–45     |                           |
| optymalny | ≥ 45      | top 10% flowów Klaviyo    |

**Zastrzeżenia:**

- Dodatkowo monitoruj relację OR powitalnego do OR newslettera na tym samym koncie. Stosunek poniżej ok. 1,2× sugeruje problem z dostarczalnością pierwszej wiadomości (wyprowadzone ze źródeł: Omnisend 1,17×, GetResponse 2,09×).
- Wysyłaj powitalny natychmiast po zapisie (lub po potwierdzeniu DOI).

### Welcome CTR: Współczynnik kliknięć e-maila powitalnego (Welcome Email Click-Through Rate)

- **Rozwinięcie:** Welcome Click-Through Rate: odsetek dostarczonych e-maili powitalnych z co najmniej jednym kliknięciem / Welcome Click-Through Rate: share of delivered welcome emails with at least one click
- **Wzór:** unikalne kliknięcia w e-mailu powitalnym / dostarczone e-maile powitalne × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** To wiarygodniejsza od OR miara skuteczności powitania: pokazuje, czy nowy subskrybent podjął pierwszy krok, np. przeczytał flagowy raport, ustawił preferencje albo zarejestrował się na wydarzenie. Pułapki: kliknięcia skanerów w skrzynkach instytucjonalnych i jeden dominujący link (np. „potwierdź”), który zawyża CTR bez wartości biznesowej.
- **Interpretation (EN):** A more reliable measure than OR of how well onboarding works: did the new subscriber take a first step (e.g., read a flagship report, set preferences, register for an event)? Pitfalls: scanner clicks in institutional inboxes and one dominant link (e.g., 'confirm') that inflates CTR without business value.

**Kontekst:** E-maile powitalne (rynek ogólny, dane platform e-mail) · okres: na wysyłkę · metoda: średnia i top 10% Klaviyo (6,5% / 13,3%, 2026) + Omnisend 3,94% (2025) + GetResponse 16,60% (dane 2023) ± heurystyka · źródła: src_klaviyo_abandoned_cart_2026, src_omnisend_benchmarks_2026, src_getresponse_2024

| Ocena     | Przedział | Uwagi                         |
| --------- | --------- | ----------------------------- |
| krytyczny | < 2       |                               |
| słaby     | 2–4       |                               |
| normalny  | 4–7       | obejmuje średnią Klaviyo 6,5% |
| dobry     | 7–13      |                               |
| optymalny | ≥ 13      | top 10% Klaviyo 13,3%         |

**Zastrzeżenia:**

- Benchmarki pochodzą głównie z e-commerce. W wydawnictwie eksperckim CTR powitalnego może być wyższy, jeśli e-mail zawiera link do obiecanego materiału (lead magnet).

### RPR A/C: Mnożnik przychodu na odbiorcę: automatyzacje vs kampanie (Automation vs Campaign Revenue-per-Recipient Ratio)

- **Rozwinięcie:** RPR (Revenue per Recipient): przychód przypisany do e-maila na jednego odbiorcę; wskaźnik porównuje RPR automatyzacji (flowów) z RPR kampanii masowych / RPR (Revenue per Recipient): email-attributed revenue per recipient; the ratio compares automation (flow) RPR to bulk campaign RPR
- **Wzór:** (przychód automatyzacji / odbiorcy automatyzacji) ÷ (przychód kampanii / odbiorcy kampanii)
- **Jednostka:** ratio · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mówi, ile razy więcej przychodu na odbiorcę generują wiadomości wyzwalane zachowaniem (powitanie, porzucony checkout, wygasająca subskrypcja) niż wysyłki masowe. W e-commerce to ok. 16–22× (Omnisend, liczone na wysłany e-mail, a nie ściśle na odbiorcę) i prawie 18× (Klaviyo, RPR). Niski mnożnik oznacza słabe lub źle wyzwalane automatyzacje albo braki w śledzeniu atrybucji. Pułapki: automatyzacje trafiają do osób o najwyższej intencji, więc mnożnik nie jest przyczynowy (mierz przyrost grupą kontrolną). Różne okna atrybucji, np. domyślne 5 dni dla e-maili i SMS w Klaviyo (Klaviyo Help Center: dla nowych klientów po 10/9/2024), zawyżają wartości bezwzględne.
- **Interpretation (EN):** Says how many times more revenue per recipient behaviour-triggered messages (welcome, abandoned checkout, expiring subscription) generate than bulk sends; in e-commerce ~16–22x (Omnisend, computed per sent email rather than strictly per recipient) and nearly 18x (Klaviyo, RPR). A low multiple means weak or poorly triggered automations or attribution tracking gaps. Pitfalls: automations target the highest-intent people, so the multiple is not causal (measure lift with a holdout); different attribution windows (e.g., Klaviyo's 5-day default for email and SMS for new customers after 10/9/2024, per Klaviyo Help Center) inflate absolute values.

**Kontekst:** E-commerce / sprzedaż online (dane Klaviyo i Omnisend) · okres: rocznie / kwartalnie · metoda: średnie źródeł ± heurystyka: Omnisend 16× (2,87 vs 0,18 USD na wysłany e-mail, raport 2026) i ok. 22× (3,41 vs 0,155 USD na wysłany e-mail, benchmarki 2026) – Omnisend liczy na wysłany e-mail, a nie ściśle na odbiorcę; Klaviyo „prawie 18×” (RPR); wartości źródłowe 16–18× umieszczono w przedziale „normalny”, a 22× w „dobry”, spójnie z resztą słownika · źródła: src_omnisend_report_2026, src_omnisend_benchmarks_2026, src_klaviyo_benchmarks_2026, src_klaviyo_attribution_2026

| Ocena     | Przedział | Uwagi                                        |
| --------- | --------- | -------------------------------------------- |
| krytyczny | < 5       |                                              |
| słaby     | 5–12      |                                              |
| normalny  | 12–20     | obejmuje 16–18× ze źródeł                    |
| dobry     | 20–28     | obejmuje ok. 22× (Omnisend, benchmarki 2026) |
| optymalny | ≥ 28      |                                              |

**Kontekst:** Wydawca subskrypcyjny / think tank (subskrypcje, bilety na wydarzenia, członkostwo) · okres: rocznie / kwartalnie · metoda: heurystyka: brak publicznych benchmarków dla wydawców; przyjęto ok. 2/3 progów e-commerce (5/12/20/28× → 3/8/13/19×) ze względu na mniejszą liczbę wyzwalaczy zakupowych i rzadsze transakcje · źródła: src_klaviyo_benchmarks_2026, src_omnisend_report_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 3       |       |
| słaby     | 3–8       |       |
| normalny  | 8–13      |       |
| dobry     | 13–19     |       |
| optymalny | ≥ 19      |       |

**Zastrzeżenia:**

- Klaviyo: flowy to 5,3% wysyłek i prawie 41% przychodu e-mail. Omnisend: automatyzacje to 2% wysyłek i 30% przychodu (dane 2025).
- Porównuj wyłącznie przy tym samym oknie i modelu atrybucji.
- Kontekst wydawcy i think tanku jest heurystyką (niska pewność).
- Wartości Omnisend (16× i 22×) liczone są na wysłany e-mail, a nie ściśle na odbiorcę (RPR).

### CVR (e-mail): Współczynnik konwersji z e-maila (na odbiorcę) (Email Conversion Rate (per recipient))

- **Rozwinięcie:** Conversion Rate: odsetek odbiorców, którzy po e-mailu wykonali cel (zakup, subskrypcja, darowizna, rejestracja) / Conversion Rate: share of recipients who completed the goal after the email (purchase, subscription, donation, registration)
- **Wzór:** konwersje przypisane do wysyłki / dostarczone × 100% (osobno dla kampanii i automatyzacji)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Łączy jakość listy, treści i ścieżki zakupu w jedną liczbę biznesową. Automatyzacje konwertują rząd wielkości lepiej niż kampanie: według Omnisend 1,49% wobec 0,08%. Pułapki: różne definicje celu (płatny vs bezpłatny), różne okna atrybucji i liczenie od kliknięć zamiast od dostarczonych (to click-to-conversion, np. 39,46% dla porzuconego koszyka według bloga Omnisend o porzuconych koszykach z II 2026, a nie raportu benchmarków).
- **Interpretation (EN):** Combines list, content and checkout quality into one business number; automations convert an order of magnitude better than campaigns (Omnisend: 1.49% vs 0.08%). Pitfalls: different goal definitions (paid vs free), different attribution windows, and computing from clicks instead of delivered (that is click-to-conversion, e.g., 39.46% for abandoned cart per Omnisend's cart-abandonment blog post of Feb 2026, not its benchmark report).

**Kontekst:** Kampanie masowe: sprzedaż płatna (dane e-commerce) · okres: na kampanię · metoda: średnia Omnisend 0,08% (2025) ± heurystyka · źródła: src_omnisend_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,02    |       |
| słaby     | 0,02–0,05 |       |
| normalny  | 0,05–0,1  |       |
| dobry     | 0,1–0,2   |       |
| optymalny | ≥ 0,2     |       |

**Kontekst:** Automatyzacje ogółem: sprzedaż płatna (dane e-commerce) · okres: na wysyłkę · metoda: średnie Omnisend (automatyzacje 1,49%, powitalne 2,11%, porzucony koszyk 1,72%; 2025) ± heurystyka · źródła: src_omnisend_benchmarks_2026, src_omnisend_cart_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,4     |       |
| słaby     | 0,4–0,9   |       |
| normalny  | 0,9–1,5   |       |
| dobry     | 1,5–2,5   |       |
| optymalny | ≥ 2,5     |       |

**Kontekst:** Non-profit: apele o darowiznę · okres: na wysyłkę (wartość typowa M+R za 2025) · metoda: wartość typowa M+R (metodologia M+R: mediany per wskaźnik; response rate fundraising 0,05%) ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,02    |       |
| słaby     | 0,02–0,04 |       |
| normalny  | 0,04–0,07 |       |
| dobry     | 0,07–0,12 |       |
| optymalny | ≥ 0,12    |       |

**Kontekst:** Działania bezpłatne (petycje, rejestracje na bezpłatne wydarzenia online; analog M+R „advocacy”) · okres: na wysyłkę (wartość typowa M+R za 2025) · metoda: wartość typowa M+R (metodologia M+R: mediany per wskaźnik; response rate advocacy 1,4%) ± heurystyka; analogia do bezpłatnych rejestracji to założenie eksperckie · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,4     |       |
| słaby     | 0,4–0,9   |       |
| normalny  | 0,9–1,8   |       |
| dobry     | 1,8–3     |       |
| optymalny | ≥ 3       |       |

**Zastrzeżenia:**

- Dane dotyczą USA lub rynków globalnych (e-commerce, non-profit). Dla sprzedaży subskrypcji eksperckich w Polsce brak publicznych benchmarków.
- M+R (wartości typowe, 2025): 54 USD przychodu na 1000 e-maili fundraisingowych i 2,40 USD na subskrybenta rocznie (wcześniej 1,87 USD).
- Strona benchmarków Omnisend jest wewnętrznie niespójna: sekcja branżowa podaje dla kampanii OR 30,22% i CTR 0,88% (wobec 30,41% i 0,74% w zestawieniu głównym); konwersję kampanii 0,08% przyjęto z zestawienia głównego.

### AC OR: Wskaźnik otwarć e-maili o porzuconym koszyku (Abandoned Cart Email Open Rate)

- **Rozwinięcie:** Abandoned Cart Open Rate: odsetek dostarczonych e-maili z sekwencji porzuconego koszyka lub checkoutu, które otwarto / Abandoned Cart Open Rate: share of delivered abandoned cart/checkout sequence emails that were opened
- **Wzór:** unikalne otwarcia e-maili sekwencji / dostarczone e-maile sekwencji × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** W NES dotyczy porzuconego zakupu subskrypcji, biletu na wydarzenie lub członkostwa w klubie. Średnio ok. 70% koszyków jest porzucanych (Baymard), więc sekwencja to jedna z najbardziej dochodowych automatyzacji. OR wyraźnie niższy niż w newsletterze sugeruje problem z dostarczalnością lub tematem. Pułapki: MPP, zawyżanie przez wielokrotne wysyłki do tej samej osoby oraz brak wyjścia z sekwencji po zakupie.
- **Interpretation (EN):** At NES this covers abandoned purchases of subscriptions, event tickets or club memberships. About 70% of carts are abandoned (Baymard), so this sequence is one of the highest-earning automations. An OR clearly below newsletter level suggests deliverability or subject issues. Pitfalls: MPP, inflation from multiple sends to the same person, and missing exit-on-purchase logic.

**Kontekst:** Sekwencje porzuconego koszyka (dane e-commerce, Omnisend/Klaviyo) · okres: na wysyłkę · metoda: średnie Omnisend (37,12% benchmarki 2026; 35,75% blog II 2026; dane 2025) ± heurystyka; próg optymalny ≈ top 10% open rate flowów Klaviyo (45,8%) · źródła: src_omnisend_benchmarks_2026, src_omnisend_cart_2026, src_klaviyo_benchmarks_2026, src_baymard_2025

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| krytyczny | < 20      |                           |
| słaby     | 20–30     |                           |
| normalny  | 30–40     | obejmuje średnie Omnisend |
| dobry     | 40–46     |                           |
| optymalny | ≥ 46      |                           |

**Zastrzeżenia:**

- W ESP bez korekty MPP (GetResponse, MailerLite) wartości mogą być wyższe o ok. 10–20 p.p. To heurystyka z porównania GetResponse z Omnisend: newsletter 40,08% wobec kampanii 30,41% (+10 p.p.), triggered 45,38% wobec automatyzacji 30,21% (+15 p.p.); żadne źródło nie podaje tej wartości wprost. Przeskaluj progi względem własnego OR newslettera.
- Brak benchmarków dla porzuconego checkoutu subskrypcji wydawców. Przyjęto dane e-commerce.

### AC CTR: Współczynnik kliknięć e-maili o porzuconym koszyku (Abandoned Cart Email Click Rate)

- **Rozwinięcie:** Abandoned Cart Click-Through Rate: odsetek dostarczonych e-maili sekwencji porzuconego koszyka z co najmniej jednym kliknięciem / Abandoned Cart Click-Through Rate: share of delivered abandoned cart sequence emails with at least one click
- **Wzór:** unikalne kliknięcia / dostarczone e-maile sekwencji × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, ilu odbiorców wraca do porzuconego zakupu. Klaviyo podaje średnio 6,0%, a górne 10% marek 11,3%. Niski CTR przy normalnym OR oznacza słabe przypomnienie (brak podglądu produktu, ceny, korzyści) albo zepsuty link do odtworzenia koszyka. Pułapki: CTR liczony od otwarć (to CTOR, ok. 11% według Omnisend) i kliknięcia botów.
- **Interpretation (EN):** Measures how many recipients come back to the abandoned purchase (Klaviyo average 6.0%, top 10% 11.3%). Low CTR with normal OR means a weak reminder (no product preview, price or benefits) or a broken cart-restore link. Pitfalls: CTR computed on opens (that is CTOR, ~11% per Omnisend) and bot clicks.

**Kontekst:** Sekwencje porzuconego koszyka (dane e-commerce) · okres: na wysyłkę · metoda: średnia i top 10% Klaviyo (6,0% / 11,3%, X 2026) + Omnisend CTR 4,13% (dane 2025) ± heurystyka · źródła: src_klaviyo_abandoned_cart_2026, src_omnisend_benchmarks_2026, src_omnisend_cart_2026

| Ocena     | Przedział | Uwagi               |
| --------- | --------- | ------------------- |
| krytyczny | < 2       |                     |
| słaby     | 2–4       |                     |
| normalny  | 4–6       | Omnisend 4,13%      |
| dobry     | 6–11,3    | od średniej Klaviyo |
| optymalny | ≥ 11,3    | top 10% Klaviyo     |

**Zastrzeżenia:**

- Klaviyo podaje przykład („a common sequence might involve 3 messages”), a nie zalecenie 3 e-maili: e-mail po 2–4 h, SMS z rabatem po 24 h i ostatnia wiadomość po 48 h. Omnisend w tekście podaje 30–60 min, 24 h i 72 h, ale diagram pokazuje trzecią wiadomość po 48 h (źródło niespójne). Raportuj CTR per pozycja w sekwencji.

### AC CVR: Konwersja sekwencji porzuconego koszyka (Abandoned Cart Email Conversion Rate)

- **Rozwinięcie:** Abandoned Cart Conversion Rate (placed order rate): odsetek odbiorców sekwencji, którzy sfinalizowali zakup przypisany do e-maila / Abandoned Cart Conversion Rate (placed order rate): share of sequence recipients who completed an email-attributed purchase
- **Wzór:** zamówienia przypisane do sekwencji / odbiorcy (dostarczone) sekwencji × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** To bezpośredni miernik odzyskanego przychodu. Omnisend podaje średnio 1,72% na wysyłkę i click-to-conversion ok. 39,5%, a Klaviyo średni przychód na odbiorcę 6,77 USD (top 10%: 13,70 USD). Niska konwersja przy dobrym CTR to zwykle problem strony płatności: koszty dodatkowe, wymóg konta, brak metody płatności. Według Baymard dodatkowe koszty to 40% powodów porzuceń. Pułapki: atrybucja zakupów, które i tak by nastąpiły, oraz brak grupy kontrolnej.
- **Interpretation (EN):** Direct measure of recovered revenue (Omnisend: 1.72% per send average, click-to-conversion ~39.5%; Klaviyo: average RPR $6.77, top 10% $13.70). Low conversion with good CTR usually points to the checkout page (extra costs, forced account creation, missing payment methods; Baymard: extra costs are 40% of abandonment reasons). Pitfalls: attributing purchases that would have happened anyway and no holdout group.

**Kontekst:** Sekwencje porzuconego koszyka (dane e-commerce) · okres: na wysyłkę · metoda: średnie Omnisend (1,72% benchmarki 2026; 1,51% blog II 2026; dane 2025) ± heurystyka · źródła: src_omnisend_benchmarks_2026, src_omnisend_cart_2026, src_klaviyo_abandoned_cart_2026, src_baymard_2025

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| krytyczny | < 0,5     |                           |
| słaby     | 0,5–1     |                           |
| normalny  | 1–2       | obejmuje średnie Omnisend |
| dobry     | 2–3       |                           |
| optymalny | ≥ 3       |                           |

**Zastrzeżenia:**

- Baymard: średni wskaźnik porzucenia koszyka to 70,22% (50 badań, aktualizacja IX 2025). To punkt odniesienia dla lejka checkoutu, a nie wskaźnik e-mailowy.
- Dla subskrypcji B2B i faktur pro forma konwersja może następować poza e-mailem (np. przez opiekuna w CRM). Uwzględnij to w atrybucji.

### IPR: Wskaźnik trafiania do skrzynki odbiorczej (Inbox Placement Rate)

- **Rozwinięcie:** Inbox Placement Rate: odsetek wysłanych wiadomości, które trafiły do folderu odbiorczego (nie do spamu i nie zaginęły) / Inbox Placement Rate: share of sent emails that reached the inbox (not spam folder, not missing)
- **Wzór:** wiadomości w folderze odbiorczym / wysłane (pomiar na adresach testowych seed lub na panelu) × 100% = 100% − spam% − brakujące%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** To realna dostarczalność. Wskaźnik „delivered” w ESP to tylko „wysłane minus odbite” i nie mówi, czy wiadomość trafiła do spamu. Spadek IPR poprzedza spadek OR, CTR i przychodu, więc to wskaźnik wyprzedzający dla całego programu e-mail. Pułapki: mierzy się go na próbie adresów testowych (seed), więc wynik zależy od składu dostawców. Validity nie raportuje Polski (z krajów europejskich podaje tylko Francję, Niemcy i UK), a polscy dostawcy (WP, Onet, Interia) filtrują inaczej niż Gmail czy Microsoft.
- **Interpretation (EN):** This is real deliverability: an ESP's 'delivered' is just 'sent minus bounced' and does not say whether mail went to spam. A drop in IPR precedes drops in OR, CTR and revenue, so it is a leading indicator for the whole email programme. Pitfalls: measured on seed samples, so results depend on provider mix; Validity does not report Poland (of European countries it covers only France, Germany and the UK), and Polish providers (WP, Onet, Interia) filter differently than Gmail/Microsoft.

**Kontekst:** Nadawcy wysyłający do odbiorców w Europie · okres: kwartalnie / miesięcznie (test seed) · metoda: średnie Validity 2025 ± heurystyka: Europa 91,1%, Niemcy 97,5%, Francja 94,0%, UK 91,5% (z krajów europejskich raport podaje tylko te trzy; Polska nieraportowana); regionalni dostawcy w Europie 79,7% (−11,4 p.p. względem MAGY); dane z adresów testowych (seed) klientów Validity, z wyłączeniem nadawców, którzy nie zgodzili się na agregację · źródła: src_validity_2026

| Ocena     | Przedział | Uwagi                                                                     |
| --------- | --------- | ------------------------------------------------------------------------- |
| krytyczny | < 80      | poziom regionalnych dostawców (79,7%; −11,4 p.p. względem MAGY w Europie) |
| słaby     | 80–87     |                                                                           |
| normalny  | 87–91     | do średniej Europy 91,1%                                                  |
| dobry     | 91–95     |                                                                           |
| optymalny | ≥ 95      | Niemcy 97,5%                                                              |

**Kontekst:** Lista mieszana globalnie (różne kraje i dostawcy) · okres: kwartalnie / miesięcznie (test seed) · metoda: średnia globalna Validity 87,2% (2025; 83,5% w 2024) i rozkład sektorów 80,1–97,2% ± heurystyka; dane z adresów testowych (seed) klientów Validity, z wyłączeniem nadawców, którzy nie zgodzili się na agregację · źródła: src_validity_2026, src_validity_2025

| Ocena     | Przedział | Uwagi                  |
| --------- | --------- | ---------------------- |
| krytyczny | < 75      |                        |
| słaby     | 75–83     |                        |
| normalny  | 83–89     | obejmuje średnią 87,2% |
| dobry     | 89–94     |                        |
| optymalny | ≥ 94      |                        |

**Zastrzeżenia:**

- Validity 2025 według dostawców: Gmail 89,8%, Microsoft 77,4% (najtrudniejszy), Yahoo 87,3%, Apple 82,0%. Według sektorów: Media & Internet 88,1%, organizacje 87,7%, edukacja 87,6%, administracja publiczna 91,4%.
- Bez narzędzia do testów seed (Validity, GlockApps itp.) używaj wskaźników zastępczych: Google Postmaster Tools (reputacja domeny, spam rate), Microsoft SNDS oraz soft bounce per domena.

### DR: Wskaźnik zniechęcenia listy (Disaffection Rate)

- **Rozwinięcie:** Disaffection Rate: stosunek sygnałów utraty subskrybentów (wypisy, skargi, odbicia) do pozytywnych reakcji (kliknięć) / Disaffection Rate: ratio of subscriber-loss signals (unsubscribes, complaints, bounces) to positive responses (clicks)
- **Wzór:** (wypisy + skargi na spam + odbicia) / kliknięcia × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Wskaźnik promowany przez Validity na 2026 r. W jednej liczbie pokazuje, czy wysyłki budują listę, czy ją erodują. Przy 0,3% wypisów, 0,1% skarg, 0,1% twardych odbić i CTR 1% wynosi 50%, czyli na każde dwa kliknięcia tracisz jednego subskrybenta; Validity zauważa, że przy 2 wysyłkach tygodniowo oznacza to utratę połowy listy w niecały rok. Mianem sytuacji kryzysowej („crisis situation”) Validity określa stan, w którym zniechęcenie przewyższa kliknięcia („disaffection rate is larger than its click rate”). Pułapki: kliknięcia botów zawyżają mianownik, więc wskaźnik wychodzi zbyt optymistycznie.
- **Interpretation (EN):** A KPI promoted by Validity for 2026 that shows in one number whether sends build or erode the list. With 0.3% unsubscribes, 0.1% complaints, 0.1% hard bounces and 1% CTR it equals 50%: one subscriber lost for every two clicks, which at 2 sends a week Validity says means losing half the list in under a year; Validity reserves 'crisis situation' for when the disaffection rate is larger than the click rate. Pitfalls: bot clicks can inflate the denominator and make the metric look too optimistic.

**Kontekst:** Każda wysyłka marketingowa (newsletter, kampanie) · okres: na wysyłkę / miesięcznie · metoda: heurystyka: ostrożny próg 50% z przykładu Validity (0,3% wypisów + 0,1% skarg + 0,1% odbić przy CTR 1% = 50%, czyli 1 utracony subskrybent na 2 kliknięcia); Validity nazywa kryzysem sytuację, gdy zniechęcenie przewyższa kliknięcia (DR ≥100%); niższe przedziały to heurystyka (brak rozkładu w źródle) · źródła: src_validity_2026

| Ocena     | Przedział | Uwagi                                                                                                          |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| krytyczny | ≥ 50      | ≥50%: przykład Validity (1 utracony na 2 kliknięcia); ≥100% = utraty przewyższają kliknięcia, Validity: kryzys |
| słaby     | 35–50     |                                                                                                                |
| normalny  | 20–35     |                                                                                                                |
| dobry     | 10–20     |                                                                                                                |
| optymalny | < 10      |                                                                                                                |

**Zastrzeżenia:**

- Validity wiąże „crisis situation” z sytuacją, gdy zniechęcenie przewyższa kliknięcia (DR ≥100%), a przykład 50% opisuje jako utratę 1 subskrybenta na 2 kliknięcia i połowy listy w niecały rok przy 2 wysyłkach tygodniowo. Próg krytyczny 50% to ostrożna heurystyka, a nie próg ze źródła.
- Przedziały poniżej 50% to heurystyka (brak rozkładu w źródle).

### Źródła grupy: E-mail i newsletter

| Id                              | Źródło                                                                                                                                                                                                                                      | Wydawca                                      | Data                                                                                 | Weryfikacja          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------- |
| src_mailerlite_2025             | [Email Marketing Benchmarks 2025: Is Your Open Rate on Track? (wersja PL: /pl/blog/compare-your-email-performance-metrics-industry-benchmarks)](https://www.mailerlite.com/blog/compare-your-email-performance-metrics-industry-benchmarks) | MailerLite                                   | 2025-12-03 (modyfikacja 2026-04-07 widoczna tylko w metadanych strony)               | tak                  |
| src_getresponse_2024            | [Email Marketing Benchmarks & Statistics (Updated for 2024)](https://www.getresponse.com/resources/reports/email-marketing-benchmarks)                                                                                                      | GetResponse                                  | 2024 (dane z 2023 r.; strona nadal „Updated for 2024”, brak edycji 2025 i 2026)      | tak                  |
| src_getresponse_doi_2024        | [Single Opt-In vs Double Opt-In](https://www.getresponse.com/blog/single-opt-in-vs-double-opt-in)                                                                                                                                           | GetResponse                                  | 2024-06-04 (aktualizacja)                                                            | tak                  |
| src_mailchimp_2023              | [Email Marketing Benchmarks and Statistics by Industry](https://mailchimp.com/resources/email-marketing-benchmarks/)                                                                                                                        | Mailchimp (Intuit)                           | 2023-12 (ostatnia aktualizacja danych; dane przestarzałe – ok. 2 lata i 10 miesięcy) | tak                  |
| src_omeda_h1_2026               | [Newsletter Statistics for Media & Publishing (2026): Open, Click & Click-to-Open Benchmarks (Newsletter Benchmark Report for Media H1 2026)](https://www.omeda.com/blog/newsletter-benchmarks-media/)                                      | Omeda                                        | 2026-08-18 (ostatnia aktualizacja; dane I–VI 2026)                                   | tak                  |
| src_glueletter_open_q1_2025     | [What's a normal open rate for newsletters in Q1 2025?](https://glueletter.com/newsletter-open-rate-benchmark-2025/)                                                                                                                        | GlueLetter                                   | brak daty publikacji (dane 01.01–31.03.2025, ok. 1,5 roku – umiarkowanie świeże)     | tak                  |
| src_glueletter_click_q1_2025    | [What's a normal click rate for newsletters in Q1 2025?](https://glueletter.com/newsletter-click-rate-benchmark-2025/)                                                                                                                      | GlueLetter                                   | 2025 (dane 01.01–31.03.2025; data publikacji niepodana)                              | tak                  |
| src_validity_2026               | [2026 Email Deliverability Benchmark Report](https://www.validity.com/wp-content/uploads/2026/03/2026-Benchmark-Report.pdf)                                                                                                                 | Validity                                     | 2026-03 (dane 2025)                                                                  | częściowo            |
| src_validity_2025               | [6 Email Marketing Trends… 2025 (strona promocyjna raportu 2025 Email Deliverability Benchmark Report)](https://www.validity.com/email-deliverability-benchmark-report/)                                                                    | Validity                                     | 2025 (dane 2024; zastąpione przez raport 2026 – src_validity_2026)                   | tak                  |
| src_google_sender_guidelines    | [Email sender guidelines](https://support.google.com/a/answer/81126?hl=en)                                                                                                                                                                  | Google (Gmail / Google Workspace Admin Help) | wymogi obowiązujące od 2024-02-01 (dostęp 2026-10-18)                                | tak                  |
| src_yahoo_sender_hub            | [Sender Best Practices](https://senders.yahooinc.com/best-practices/)                                                                                                                                                                       | Yahoo Sender Hub                             | brak daty na stronie (dostęp 2026-10-18)                                             | tak                  |
| src_aws_ses_enforcement         | [Amazon SES Sending review process FAQs](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html)                                                                                                                                   | Amazon Web Services                          | brak daty (dokumentacja bieżąca, dostęp 2026-10-18)                                  | tak                  |
| src_klaviyo_benchmarks_2026     | [2026 email marketing benchmarks](https://www.klaviyo.com/products/email-marketing/benchmarks)                                                                                                                                              | Klaviyo                                      | 2026 (strona bez daty; dostęp 2026-10-18)                                            | tak                  |
| src_klaviyo_abandoned_cart_2026 | [2026 Abandoned Cart Benchmark Report](https://www.klaviyo.com/blog/abandoned-cart-benchmarks)                                                                                                                                              | Klaviyo                                      | 2026-10-02                                                                           | tak                  |
| src_omnisend_benchmarks_2026    | [Email marketing benchmarks](https://www.omnisend.com/blog/email-marketing-benchmarks/)                                                                                                                                                     | Omnisend                                     | 2026-05-12 (dane 2025)                                                               | tak                  |
| src_omnisend_report_2026        | [2026 Ecommerce Marketing Report](https://www.omnisend.com/resources/reports/2026-ecommerce-marketing-report/)                                                                                                                              | Omnisend                                     | 2026 (dane 2025; brak dokładnej daty publikacji)                                     | tak                  |
| src_omnisend_cart_2026          | [Cart abandonment emails](https://www.omnisend.com/blog/cart-abandonment-emails/)                                                                                                                                                           | Omnisend                                     | 2026-02-19                                                                           | tak                  |
| src_baymard_2025                | [Cart Abandonment Rate Statistics](https://baymard.com/lists/cart-abandonment-rate)                                                                                                                                                         | Baymard Institute                            | 2025-09-22 (aktualizacja)                                                            | tak                  |
| src_stripo_welcome_2026         | [Stripo Research Report No. 06: Welcome Emails](https://research.stripo.email/welcome-email-open-rates)                                                                                                                                     | Stripo                                       | 2026-08 („Published August 2026”)                                                    | tak                  |
| src_litmus_market_share_2026    | [Email Client Market Share](https://www.litmus.com/email-client-market-share)                                                                                                                                                               | Litmus                                       | brak daty publikacji; „current as of October 1, 2026” (dane za wrzesień 2026)        | tak                  |
| src_mr_benchmarks_2026          | [M+R Benchmarks 2026: Email Messaging](https://mrbenchmarks.com/email-messaging/)                                                                                                                                                           | M+R                                          | 2026 (dane 2025)                                                                     | częściowo            |
| src_zerobounce_decay_2026       | [The Email List Decay Report for 2026](https://zerobounce.net/email-list-decay)                                                                                                                                                             | ZeroBounce                                   | 2026 (dane I–XII 2025)                                                               | tak                  |
| src_truelist_doi_2025           | [What Is Double Opt-In and Why It Matters for Your Email List](https://truelist.io/blog/what-is-double-opt-in)                                                                                                                              | Truelist                                     | 2025-12-28                                                                           | tak                  |
| src_debounce_bounce             | [Average Bounce Rate by Industry](https://debounce.com/blog/average-bounce-rate-by-industry/)                                                                                                                                               | DeBounce                                     | 2026-02-04                                                                           | tak                  |
| src_bounceless_bounce           | [Email Bounce Rate](https://blog.bounceless.io/email-bounce-rate)                                                                                                                                                                           | Bounceless                                   | brak daty (dostęp 2026-10-18)                                                        | nie da się sprawdzić |
| src_klaviyo_attribution_2026    | [Understanding message attribution](https://help.klaviyo.com/hc/en-us/articles/115005248128)                                                                                                                                                | Klaviyo Help Center                          | 2026-03-26 (aktualizacja)                                                            | tak                  |

### Zmiany po weryfikacji: E-mail i newsletter

- Źródło src_mailerlite_2025: doprecyzowano datę modyfikacji (tylko metadane), dopisano błędny nagłówek „Click rate” w tabeli regionów, zastrzeżenie o wyższym realnym CTOR oraz ostrożne („likely”) wiązanie wzrostu wypisów ze zmianami w Gmailu.
- Źródło src_getresponse_2024: dopisano, że spam 0,01% dotyczy newslettera, Publishing, Non-profits, PL i Europy (ogółem <0,01%), że bounce rate nie ma definicji oraz że nadal brak edycji 2025/2026.
- Źródło src_getresponse_doi_2024: dopisano jakościową uwagę źródła o wyższych skargach przy DOI w wielu przypadkach (bez liczb).
- Źródło src_mailchimp_2023: oznaczono jako przestarzałe i o najniższej wadze; dopisano, że Government jest tylko w FAQ, a FAQ przeczy tabeli (34,23%/2,66% vs 35,63%/2,62%).
- Źródło src_omeda_h1_2026: dopisano mianownik (dostarczone), brak informacji o wykluczaniu MPP i botów oraz cytat o CTOR/CTR jako najpewniejszych punktach porównania.
- Źródło src_glueletter_open_q1_2025: P50 zapisano jako 49,3% zgodnie z tabelą potwierdzoną przez weryfikatora, dopisano 255 mln otwarć, ok. 500 newsletterów, brak daty publikacji i niewyjaśnioną niespójność tekst/tabela.
- Źródło src_validity_2026: poprawiono excerpt – Europa regionalni dostawcy −11,4 p.p. względem MAGY (10–25 p.p. to rozpiętość globalna), kontekst cytatu o „crisis situation” (DR > CTR, nie przykład 50%), brak przypisania 0,06% do Postmaster Tools, +3,7 p.p. zamiast %, tylko FR/DE/UK; dopisano cytat o DOI w Niemczech i metodę seed.
- Źródło src_validity_2025: tytuł urealniono (strona promocyjna odsyłająca do raportu), poprawiono cytat „1 in 6…”, dodano dosłowny cytat o 25% respondentów i oznaczono jako zastąpione przez nowsze src_validity_2026 (tylko porównania r/r).
- Źródło src_google_sender_guidelines: dopisano, że strona nie opisuje egzekwowania z XI 2025 ani zmian 2025–2026.
- Źródło src_yahoo_sender_hub: doprecyzowano status metod wypisu (POST „highly recommended”, mailto „acceptable”).
- Źródło src_aws_ses_enforcement: doprecyzowano zakres bounce rate (twarde do niezweryfikowanych domen, okno „representative volume”) i complaint rate (tylko domeny z FBL, bez Gmaila).
- Źródło src_klaviyo_abandoned_cart_2026: sekwencję oznaczono jako przykład (e-mail, SMS z rabatem, wiadomość), nie zalecenie 3 e-maili; dopisano top 10% dla porzuconego przeglądania i brak OR/placed order rate dla koszyka.
- Źródło src_omnisend_benchmarks_2026: dopisano wewnętrzną niespójność (sekcja branżowa: kampanie OR 30,22%, CTR 0,88%).
- Źródło src_omnisend_report_2026: dopisano, że wartości są na wysłany e-mail, a nie ściśle RPR, oraz brak dokładnej daty.
- Źródło src_omnisend_cart_2026: dopisano niespójność tekst (72 h) vs diagram (48 h) dla trzeciej wiadomości.
- Źródło src_stripo_welcome_2026: zalecenie oddano dosłownym cytatem (CTOR, konwersja, RPR – nie CTR).
- Źródło src_litmus_market_share_2026: 55–60% przypisano „badaniom cytowanym przez Litmus”, nie danym Litmusa; poprawiono datę (brak daty publikacji, stan na 1.10.2026) i dodano wielkość próby.
- Źródło src_mr_benchmarks_2026: usunięto nieprzypisane przez M+R lata przy wzroście 4% i 9%, opisano wartości jako typowe (mediany per wskaźnik), dodano cytat o jedynym sektorze ze spadkiem listy i poprzednią wartość 1,87 USD.
- Źródło src_zerobounce_decay_2026: dopisano rozbieżną liczbę z FAQ (25,74%).
- Źródło src_truelist_doi_2025: dopisano, że zakresy 70–90% i 10–35% nie mają podanego źródła (tylko 65–90% linkuje do Nutshell).
- Źródło src_debounce_bounce: pełny tekst zweryfikowany – usunięto dopisek o parafrazie, data publikacji 2026-02-04 zamiast „brak daty”, wstawiono dokładne cytaty i brak metodologii.
- Źródło src_bounceless_bounce: oznaczono jako martwy link (HTTP 410/404), weryfikacja „nie da się sprawdzić”, źródło nieużywane w przedziałach.
- Dodano nowe źródło src_klaviyo_attribution_2026 (Klaviyo Help Center, „Understanding message attribution”, 2026-03-26) dla domyślnego 5-dniowego okna atrybucji; podpięto w automation_vs_campaign_rpr_ratio.
- Wszystkim źródłom dodano pole verification z werdyktem weryfikatora (tak / częściowo / nie da się sprawdzić).
- open_rate / Omeda: etykietę „bez korekty MPP” zastąpiono „Omeda nie podaje, czy wyklucza otwarcia MPP i botów”.
- open_rate / Omeda: notatkę „mediana B2B media 30,9%” przeniesiono z „dobry” do „normalny” (30,9% < P50 31,6%).
- open_rate / Polska: granica dobry/optymalny 46 → 45 (dobry 38–45, optymalny ≥45), zgodnie z metodą „próg optymalny ≈ mediana Europy 45,08%”.
- open_rate / non-profit: metodę oznaczono jako heurystykę, opisano, że mediana MailerLite 52,38% wypada w „dobry” (nie na granicy kwartylowej), a Mailchimp jako najstarsze źródło o najniższej wadze.
- open_rate / B2B: metodę oznaczono jako heurystykę, opisano, że mediany MailerLite 43–46% wypadają w „dobry”, Mailchimp oznaczono jako najstarsze źródło o najniższej wadze.
- open_rate / GlueLetter: w metodzie P50 49,33% → 49,3% (tabela potwierdzona), dopisano niespójność tekst/tabela i oznaczenie heurystyki dla progu krytycznego.
- open_rate: w interpretacji PL i EN 55–60% przypisano „badaniom cytowanym przez Litmus”, a nie danym Litmusa.
- open_rate: dodano caveaty o Mailchimp (najstarsze, najniższa waga, FAQ vs tabela) i o Omeda (brak informacji o MPP/botach, cytat o CTOR/CTR); do caveatu ESP dopisano cytat MailerLite „real open rates are lower”.
- click_through_rate / non-profit i B2B: Mailchimp oznaczono jako najstarsze źródło o najniższej wadze.
- click_through_rate / apele zbiórkowe: „średnia M+R” → „wartość typowa M+R (mediany per wskaźnik)” w okresie, metodzie i notatce.
- click_to_open_rate: wyjaśnienie niższych median Omeda oznaczono jako hipotezę bez źródła.
- click_to_open_rate: dodano caveat MailerLite – realny CTOR wyższy od raportowanego przez MPP.
- unsubscribe_rate / Omeda: opis progu krytycznego „≈2× mediana (0,18%), zaokrąglone do 0,2%”.
- unsubscribe_rate / rynek ogólny: Mailchimp oznaczono jako najstarsze źródło o najniższej wadze.
- unsubscribe_rate / M+R: „średnia M+R 12%” → „wartość typowa M+R 12% (metodologia: mediany per wskaźnik)” w metodzie i notatce.
- unsubscribe_rate: caveat MailerLite złagodzony – „wiąże go prawdopodobnie ze zmianami w Gmailu ułatwiającymi wypis z poziomu skrzynki” zamiast „jednoklikowy wypis”.
- unsubscribe_rate: w interpretacji PL i EN wpływ jednoklikowego wypisu na wzrost wypisów złagodzono do „prawdopodobnie”.
- hard_bounce_rate / opt-in: doprecyzowano zakres AWS SES (twarde do niezweryfikowanych domen, okno „representative volume”), dodano DeBounce „Hard bounces should stay under 0.5-1%” i podpięto src_debounce_bounce.
- hard_bounce_rate / M+R: „średnia M+R 4%” → „wartość typowa M+R 4% (mediany per wskaźnik)” w metodzie i notatce.
- hard_bounce_rate: caveat GetResponse – „bounce bez definicji, nie wiadomo, czy obejmuje miękkie” zamiast „łączny bounce”; caveat ZeroBounce – dopisano 25,74% z FAQ; cytowane w caveatach src_getresponse_2024 i src_zerobounce_decay_2026 podpięto do kontekstu opt-in.
- soft_bounce_rate: usunięto src_bounceless_bounce z source_ids (martwy link HTTP 410).
- soft_bounce_rate: metodę przepisano jako heurystykę (DeBounce 1–3% „without immediate concern”; cel <2% i próg 2–3% ostrzejsze od źródła), bounce GetResponse opisano jako niezdefiniowany.
- soft_bounce_rate: caveat Validity poprawiony – Europa 79,7%, ok. 11,4 p.p. mniej niż MAGY; 10–25 p.p. to rozpiętość globalna; cytowane src_validity_2026 podpięto do kontekstu.
- soft_bounce_rate: regułę „3–5 kolejnych miękkich odbić = twarde” oznaczono w PL i EN jako heurystykę bez źródła; confidence pozostaje „niska” (minimum skali).
- spam_complaint_rate / Postmaster: dopisano, że Validity nie przypisuje 0,06% do Postmaster Tools, a AWS SES liczy skargi tylko z domen z FBL (bez Gmaila); podpięto src_validity_2025 (caveat o 25% respondentów).
- spam_complaint_rate / FBL: opis progu krytycznego 0,01% poprawiony – wartość GetResponse dla newslettera, Publishing, Non-profits, PL i Europy (ogółem <0,01%), nie średnia wszystkich branż.
- list_growth_rate / non-profit rocznie: „4% w 2024, 9% w 2023” → „4% i 9% w dwóch poprzednich latach (M+R nie przypisuje lat)”; „średnia M+R” → „wartość typowa M+R (mediana lub średnia)”.
- list_growth_rate: usunięto procesowy caveat o limicie wyszukiwań, zastąpiono „kontekst młodej listy to heurystyka bez benchmarku platform newsletterowych”.
- list_growth_rate: w interpretacji PL i EN przy ZeroBounce dopisano 25,74% z FAQ tej samej strony.
- double_opt_in_confirmation_rate: przedziały dopasowano do typowego zakresu 65–90% (krytyczny <50, słaby 50–65, normalny 65–75, dobry 75–85, optymalny ≥85; wcześniej <45/45–60/60–75).
- double_opt_in_confirmation_rate: w metodzie rozróżniono zakres 65–90% (Nutshell) od zakresów Truelist bez źródła.
- double_opt_in_confirmation_rate: procesowy caveat o limicie wyszukiwań zastąpiono „brak niezależnego badania odsetka potwierdzeń DOI”.
- double_opt_in_confirmation_rate: dodano caveat GetResponse o wyższych skargach przy DOI w wielu przypadkach (bez liczb).
- double_opt_in_confirmation_rate: do interpretacji PL i EN dodano argument Validity (IPR Niemiec 97,5%, „widespread use of double opt-in”), podpięto src_validity_2026.
- welcome_email_open_rate: rekomendację Stripo w PL i EN dopasowano do źródła (CTOR, konwersja, RPR zamiast CTR); 83,63% oznaczono jako średnią GetResponse z danych 2023, nie medianę (interpretacja i metoda).
- automation_vs_campaign_rpr_ratio / e-commerce: przedziały przesunięte dla spójności ze słownikiem (krytyczny <5, słaby 5–12, normalny 12–20 [16–18×], dobry 20–28 [22×], optymalny ≥28; wcześniej <3/3–8/8–15/15–20/≥20); dopisano, że Omnisend liczy na wysłany e-mail.
- automation_vs_campaign_rpr_ratio / wydawca: przedziały przeliczone jako ok. 2/3 nowych progów e-commerce (krytyczny <3, słaby 3–8, normalny 8–13, dobry 13–19, optymalny ≥19; wcześniej <2/2–5/5–10/10–15/≥15).
- automation_vs_campaign_rpr_ratio: w interpretacji PL i EN oraz w nowym caveacie zaznaczono, że Omnisend liczy na wysłany e-mail; 5-dniowe okno Klaviyo podparto nowym źródłem (Help Center).
- email_conversion_rate: click-to-conversion 39,46% przypisano w PL i EN do bloga Omnisend o koszykach (src_omnisend_cart_2026) i podpięto to źródło do kontekstu automatyzacji.
- email_conversion_rate / M+R: „średnia” → „wartość typowa (M+R: mediany per wskaźnik)” w okresach, metodach i caveacie.
- email_conversion_rate: dodano caveat o niespójności Omnisend (sekcja branżowa: OR 30,22%, CTR 0,88%).
- abandoned_cart_email_open_rate: caveat „+10–20 p.p. w ESP bez korekty MPP” oznaczono jako heurystykę z porównania GetResponse/Omnisend (+10 i +15 p.p.).
- abandoned_cart_email_click_rate: caveat o sekwencji poprawiony (Klaviyo – przykład e-mail/SMS/wiadomość, nie zalecenie 3 e-maili; Omnisend – niespójność 72 h vs 48 h); cytowane src_omnisend_cart_2026 podpięto do kontekstu.
- inbox_placement_rate: notatkę 79,7% uzupełniono o −11,4 p.p. względem MAGY; w metodach dopisano dane seed klientów Validity (bez nadawców bez zgody na agregację); w metodzie i interpretacji PL/EN – tylko FR, DE, UK, Polska nieraportowana.
- disaffection_rate: w interpretacji PL i EN „crisis situation” powiązano z sytuacją, gdy zniechęcenie przewyższa kliknięcia; przykład 50% opisano jako 1 utracony na 2 kliknięcia i połowę listy w niecały rok przy 2 wysyłkach tygodniowo; z pułapek PL usunięto „przy MPP”.
- disaffection_rate: notatkę przedziału krytycznego zmieniono na „≥50%: przykład Validity (1 utracony na 2 kliknięcia); ≥100% = utraty przewyższają kliknięcia, Validity: kryzys”; metodę i caveat przepisano – próg 50% to ostrożna heurystyka, nie próg źródłowy; confidence pozostaje „niska” (minimum skali).

## 6. Zaangażowanie, wydarzenia, społeczność i CRM

### DAU/MAU: Lepkość (stickiness) DAU/MAU (Stickiness (DAU/MAU))

- **Rozwinięcie:** Daily Active Users / Monthly Active Users – dzienni aktywni użytkownicy podzieleni przez miesięcznych aktywnych użytkowników / Daily Active Users / Monthly Active Users
- **Wzór:** DAU/MAU = (średnia dzienna liczba unikalnych aktywnych użytkowników w miesiącu) / (liczba unikalnych aktywnych użytkowników w tym miesiącu) × 100%. Pomocniczo: DAU/MAU × 30 ≈ średnia liczba dni aktywności aktywnego użytkownika w miesiącu.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jak często aktywny użytkownik wraca: 20% oznacza średnio ok. 6 dni aktywności w miesiącu, 33% ok. 10 dni. Dla think tanku z treściami eksperckimi naturalny rytm to kilka wizyt w miesiącu, więc nie porównuj wyniku z mediami społecznościowymi ani z grami. Typowe pułapki: wynik zależy od definicji aktywności (sama odsłona, przeczytany artykuł albo logowanie). Anonimowe cookies zawyżają MAU i zaniżają wskaźnik, a sezonowość (wakacje, kalendarz wydarzeń) zmienia go z miesiąca na miesiąc.
- **Interpretation (EN):** Shows how often an active user returns: 20% means roughly 6 active days per month, 33% roughly 10 days. For an expert-content think tank the natural rhythm is a few visits per month, so do not compare it with social or gaming apps. Pitfalls: the result depends on how 'active' is defined (pageview vs. article read vs. login), anonymous cookies inflate MAU and depress the ratio, and seasonality (holidays, event calendar) moves it month to month.

**Kontekst:** Serwis treści eksperckich / media cyfrowe (zalogowani czytelnicy, subskrybenci, członkowie) · okres: miesięcznie (średnia z dni miesiąca kalendarzowego) · metoda: Heurystyka zakotwiczona w źródłach: próg 'dobry' = 20% (A. Chen), próg 'optymalny' = średnia Mixpanel dla Media & Entertainment 36% (produkty instrumentowane, głównie aplikacje). Dolne pasma wyprowadzono z rytmu użycia (10% ≈ 3 dni aktywności w miesiącu). Przedziały lewostronnie domknięte [min, max). · źródła: S1, S3, S2

| Ocena     | Przedział | Uwagi                                                                                                                                                                 |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–5       | <1,5 dnia aktywności w miesiącu na aktywnego użytkownika – ruch głównie jednorazowy; minimum matematyczne DAU/MAU ≈3,3% (1/30), więc pasmo obejmuje w praktyce 3,3–5% |
| słaby     | 5–10      | 1,5–3 dni w miesiącu                                                                                                                                                  |
| normalny  | 10–20     | 3–6 dni w miesiącu, rytm mniej więcej tygodniowy                                                                                                                      |
| dobry     | 20–36     | ≥20% to próg 'dobry' wg A. Chena                                                                                                                                      |
| optymalny | 36–100    | poziom średniej Mixpanel dla Media & Entertainment (36%, dane 2023), osiągany zwykle przez aplikacje o dziennym rytmie                                                |

**Kontekst:** Portal/produkt B2B (panel klienta instytucjonalnego, narzędzia dla członków firmowych) · okres: miesięcznie · metoda: Punkty odniesienia ze źródeł: Mixpanel 2026 – B2B w Ameryce Płn. 31% (rok danych i definicja niepodane), Mixpanel 2024 – Technology 41% (dane 2023), D. Sacks – ok. 40% jako doskonały poziom w SaaS (u płacących klientów szczyty 40–45%, ok. 8 dni roboczych w miesiącu). Dolne pasma (<20%) to heurystyka. · źródła: S2, S1, S4

| Ocena     | Przedział | Uwagi                                                                                                                                                                            |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–10      |                                                                                                                                                                                  |
| słaby     | 10–20     |                                                                                                                                                                                  |
| normalny  | 20–31     | do poziomu Mixpanel B2B Ameryka Płn. 31% (Mixpanel, raport 2026; rok danych i definicja niepodane)                                                                               |
| dobry     | 31–40     |                                                                                                                                                                                  |
| optymalny | 40–100    | ~40% DAU/MAU płacących klientów = 'excellent engagement' wg D. Sacksa – u płacących klientów szczyty 40–45%, ok. 8 dni roboczych w miesiącu; Mixpanel Technology 41% (dane 2023) |

**Zastrzeżenia:**

- Średnie Mixpanel dotyczą produktów z pełną instrumentacją (często aplikacji z logowaniem), więc dla serwisu WWW z ruchem anonimowym będą zawyżone.
- Dane europejskie (Mixpanel 2026, rok danych i definicja niepodane): e-commerce w EMEA 21%, agencje kreatywne (Media & Entertainment) w EMEA 31%. Nie znaleziono polskich benchmarków.
- Próg 50%+ ('world class' wg A. Chena) dotyczy aplikacji społecznościowych. Sam Chen zastrzega, że dla produktów używanych rzadziej DAU/MAU nie jest właściwą miarą.
- Dla treści o rytmie tygodniowym (newsletter, kluby) lepiej równolegle śledzić WAU/MAU i rozkład dni aktywności (power user curve / L30).
- DAU/MAU ma matematyczne minimum ok. 3,3% (1/30): każdy użytkownik aktywny w miesiącu był aktywny co najmniej jeden dzień, więc pasmo 'krytyczny' obejmuje faktycznie 3,3–5%. Wartość niższa oznacza niespójne definicje DAU i MAU.

### WAU/MAU: Tygodniowa lepkość WAU/MAU (Weekly stickiness (WAU/MAU))

- **Rozwinięcie:** Weekly Active Users / Monthly Active Users – tygodniowi aktywni użytkownicy podzieleni przez miesięcznych aktywnych użytkowników / Weekly Active Users / Monthly Active Users
- **Wzór:** WAU/MAU = (średnia liczba unikalnych aktywnych użytkowników w tygodniach miesiąca lub w kroczącym oknie 7 dni) / (unikalni aktywni użytkownicy w miesiącu lub w kroczącym oknie 28–30 dni) × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy, jaka część miesięcznej publiczności wraca co tydzień, i lepiej niż DAU/MAU pasuje do rytmu think tanku (tygodniowy newsletter, cykle debat, spotkania klubów). Matematyczny punkt odniesienia: jeśli każdy użytkownik przychodzi dokładnie raz w miesiącu, WAU/MAU ≈ 7/30 ≈ 23%, a gdy wszyscy wracają co tydzień, wskaźnik zbliża się do 100%. Pułapki: różne okna (kalendarzowe vs. kroczące 7/28 dni) dają różne wyniki, a boty i anonimowe cookies zaniżają wskaźnik.
- **Interpretation (EN):** Measures what share of the monthly audience returns every week, and fits a think tank's rhythm (weekly newsletter, debate series, club meetings) better than DAU/MAU. Mathematical anchor: if every user visits exactly once a month, WAU/MAU ≈ 7/30 ≈ 23%; if everyone returns weekly it approaches 100%. Pitfalls: calendar vs. rolling 7/28-day windows give different values, and bots or anonymous cookies depress the ratio.

**Kontekst:** Serwis treści eksperckich / media cyfrowe o rytmie tygodniowym (newsletter, kluby, cykle wydarzeń) · okres: miesięcznie (kroczące okna 7/28 dni) · metoda: Heurystyka. Minimum matematyczne: każdy aktywny w miesiącu użytkownik wpada w co najmniej 7 z 30 kroczących okien 7-dniowych, więc średnie WAU/MAU ≥ ok. 23% (7/30); wartości niższe wskazują błąd definicji lub okien. Pasmo 'krytyczny' sięga 30% (prawie wszyscy aktywni tylko w jednym tygodniu miesiąca), a ok. 2 wizyty w różnych tygodniach dają ok. 47% (14/30). Górne pasma to ocena ekspercka spójna z relacją Sacksa (DAU/WAU ≈ 60% przy doskonałym zaangażowaniu w SaaS). · źródła: S4, S3

| Ocena     | Przedział | Uwagi                                                                                                    |
| --------- | --------- | -------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–30      | prawie wszyscy aktywni tylko w jednym tygodniu miesiąca; wartości <23% wskazują błąd definicji lub okien |
| słaby     | 30–38     |                                                                                                          |
| normalny  | 38–50     | ok. 2 wizyty w różnych tygodniach daje ok. 47% (14/30)                                                   |
| dobry     | 50–65     | większość miesięcznej publiczności wraca co tydzień                                                      |
| optymalny | 65–100    |                                                                                                          |

**Kontekst:** Portal/produkt B2B używany w dni robocze (klienci instytucjonalni) · okres: miesięcznie · metoda: Heurystyka ekspercka z kotwicą wyprowadzoną z Sacksa: u płacących klientów SaaS DAU/MAU ok. 40% i DAU/WAU ok. 60% ('excellent engagement') dają WAU/MAU ≈ 0,40/0,60 ≈ 67% (wyliczenie własne; Sacks nie podaje WAU/MAU) – próg 'optymalny'. Produkt SaaS powinien być używany we wszystkie 5 dni roboczych. Progi poniżej 60% to heurystyka. · źródła: S4

| Ocena     | Przedział | Uwagi                                                                                                                                      |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | 0–30      |                                                                                                                                            |
| słaby     | 30–45     |                                                                                                                                            |
| normalny  | 45–60     |                                                                                                                                            |
| dobry     | 60–67     |                                                                                                                                            |
| optymalny | 67–100    | WAU/MAU ≈ 67% wyprowadzone z Sacksa: DAU/MAU ~40% / DAU/WAU ~60% przy 'excellent engagement' (wyliczenie własne; Sacks nie podaje WAU/MAU) |

**Zastrzeżenia:**

- Nie znaleziono wiarygodnego, publicznego benchmarku WAU/MAU od Mixpanel, Amplitude ani Sequoii. Blogi dostawców podają sprzeczne przedziały (20–40% i 60–80%), więc ich nie użyto.
- Wskaźnik najlepiej traktować jako trend wewnętrzny (miesiąc do miesiąca, kohorty), a nie do porównań z rynkiem.
- Zawsze WAU/MAU ≥ DAU/MAU. Przy kroczących oknach 7-dniowych praktycznym minimum jest ok. 23% (7/30) – tyle wychodzi, gdy każdy użytkownik jest aktywny raz w miesiącu; wartości niższe wskazują błąd definicji lub okien.

### NPS: Wskaźnik rekomendacji netto (Net Promoter Score)

- **Rozwinięcie:** Net Promoter Score – odsetek promotorów (oceny 9–10) minus odsetek krytyków (oceny 0–6) w pytaniu: „Jak prawdopodobne jest, że polecisz nas znajomemu lub współpracownikowi?” (skala 0–10) / Net Promoter Score – % promoters (9–10) minus % detractors (0–6) on the 0–10 'How likely are you to recommend us to a friend or colleague?' question
- **Wzór:** NPS = % promotorów (9–10) − % krytyków (0–6). Pasywni (7–8) są tylko w mianowniku. Zakres od −100 (sami krytycy) do +100 (sami promotorzy).
- **Jednostka:** score · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy skłonność do polecania marki, czyli przybliżenie lojalności i wzrostu z poleceń. To liczba punktów, nie procent: +30 to np. 50% promotorów i 20% krytyków. Pułapki: wynik silnie zależy od kanału i momentu ankiety, a przy próbie kilkudziesięciu odpowiedzi waha się o kilkanaście punktów. NPS relacyjny (cykliczny) i transakcyjny (po zdarzeniu) nie są porównywalne, więc porównuj się przede wszystkim z własnym trendem i z benchmarkiem branżowym.
- **Interpretation (EN):** Measures willingness to recommend, a proxy for loyalty and referral-driven growth. It is a point score, not a percentage: +30 might be 50% promoters minus 20% detractors. Pitfalls: strongly dependent on channel and survey timing; with a few dozen responses it swings by 10+ points; relationship (periodic) and transactional (post-event) NPS are not comparable, so compare primarily with your own trend and an industry benchmark.

**Kontekst:** Międzybranżowo (wszystkie sektory, punkt odniesienia ogólny) · okres: na falę badania (kwartalnie/półrocznie) lub kroczące 90 dni · metoda: Kwartyle SurveyMonkey 2025 (P25 = 0, P50 = +44, P75 = +72) połączone z powszechnie stosowanymi pasmami 0/20/50/80, które dzielą dolną połowę rozkładu. Kontrola krzyżowa: Survicate 2025 (P10 = −4, mediana 42, P90 = 78). · źródła: S6, S7, S9, S5

| Ocena     | Przedział | Uwagi                                                                                             |
| --------- | --------- | ------------------------------------------------------------------------------------------------- |
| krytyczny | -100–0    | więcej krytyków niż promotorów; dolny kwartyl SurveyMonkey (P25 = 0), ok. P10 Survicate (−4)      |
| słaby     | 0–20      | dodatni, ale poniżej progu 'favourable' (20) z powszechnie stosowanych pasm                       |
| normalny  | 20–44     | do mediany (SurveyMonkey +44, Survicate 42)                                                       |
| dobry     | 44–72     | mediana – górny kwartyl                                                                           |
| optymalny | 72–100    | górny kwartyl SurveyMonkey (≥ +72); P90 Survicate = 78; 'world class' w pasmach powszechnych > 80 |

**Kontekst:** Media cyfrowe / wydawcy treści (czytelnicy, subskrybenci indywidualni B2C) · okres: na falę badania (kwartalnie/półrocznie) · metoda: Mediana ±20 pkt: Survicate 2025 – Media mediana 40, B2C mediana 49; Retently 2026 – Communication & Media 39 (średnia 5-letnia 19). · źródła: S7, S8

| Ocena     | Przedział | Uwagi                                                              |
| --------- | --------- | ------------------------------------------------------------------ |
| krytyczny | -100–0    |                                                                    |
| słaby     | 0–20      | okolice 5-letniej średniej Retently dla Communication & Media (19) |
| normalny  | 20–40     | do mediany branży (Survicate Media 40, Retently 39)                |
| dobry     | 40–60     | powyżej mediany mediów; mediana B2C ogółem 49 (Survicate)          |
| optymalny | 60–100    |                                                                    |

**Kontekst:** B2B: usługi eksperckie/doradcze, klienci instytucjonalni i firmowi · okres: na falę badania (półrocznie/rocznie, relacyjny) · metoda: Kwartyle SurveyMonkey 2025 dla usług profesjonalnych (w tabeli 'consultancy as proxy': P25 = 42, P50 = 48, P75 = 72) wyznaczają granice pasm 'dobry' (48) i 'optymalny' (72). Pasmo 'normalny' 30–48 jest celowo szerokie: obejmuje medianę B2B Survicate 2025 (38) i P25 SurveyMonkey (42), a przy kilkudziesięciu odpowiedziach błąd próby przekracza kilka punktów. Kontrola krzyżowa: Survicate 2025 (B2B 38, Agency & Consulting 59, Software 30) i Retently 2026 (Consulting 68, B2B SaaS 41). Progi 0 i 30 to heurystyka. · źródła: S6, S7, S8

| Ocena     | Przedział | Uwagi                                                                                                                    |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | -100–0    | więcej krytyków niż promotorów                                                                                           |
| słaby     | 0–30      | heurystyka: dodatni, ale wyraźnie poniżej mediany B2B (Survicate 38)                                                     |
| normalny  | 30–48     | obejmuje medianę B2B (Survicate 38) i P25 usług profesjonalnych (SurveyMonkey 42), do mediany usług profesjonalnych (48) |
| dobry     | 48–72     | P50–P75 usług profesjonalnych (SurveyMonkey, 'consultancy as proxy'); Survicate Agency & Consulting 59                   |
| optymalny | 72–100    | ≥ P75 usług profesjonalnych (SurveyMonkey 72); Retently Consulting 68                                                    |

**Zastrzeżenia:**

- Bain (nps.bain.com) definiuje promotorów, pasywnych i krytyków, ale nie podaje progów absolutnych, tylko porównania względne z konkurencją. Pasma powszechnie stosowane cytuje HelloCustomer (2026): 'A good NPS score is anything above 0, because it means promoters outnumber detractors.' oraz 'The bands in common use run on from there: above 20 is favourable, above 50 is excellent, above 80 is world class.' Artykuł nie przypisuje tych pasm Bain.
- Benchmarki dostawców różnią się metodą, np. Software: 30 (Survicate) vs 41 (Retently), Consulting: 59 vs 68.
- Nie znaleziono polskich ani europejskich benchmarków NPS dla mediów i think tanków.
- Przy n < 100 odpowiedzi pokazuj NPS z liczbą odpowiedzi i nie oceniaj pasma przy bardzo małej próbie.
- Kwartyle SurveyMonkey dla usług profesjonalnych (42 / 48 / 72) to w tabeli 'consultancy as proxy' – przybliżenie przez doradztwo, a nie osobna kategoria dla think tanków.

### AR: Wskaźnik obecności (frekwencja) na wydarzeniu (Event attendance rate)

- **Rozwinięcie:** Attendance Rate – odsetek zarejestrowanych, którzy faktycznie przyszli (check-in) lub dołączyli do transmisji / Attendance Rate – share of registrants who actually checked in or joined the stream
- **Wzór:** AR = obecni (check-in / dołączenie do transmisji na żywo) / ważne rejestracje (bez anulowanych) × 100%. Dla online raportuj osobno 'live' oraz 'live + on-demand'.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, ile rejestracji zamienia się w realny udział. Wynik zależy od intencji publiczności, ceny biletu, przypomnień i dopasowania terminu. Wydarzeń bezpłatnych, płatnych i online nie należy oceniać jedną skalą. Pułapki: różne definicje obecności (check-in vs. odbiór identyfikatora; online: tylko live czy także on-demand, np. Contrast podaje osobno obecność live 44–50% i oglądalność live lub on-demand 61%), zaproszenia VIP i bilety grupowe w mianowniku, wielokrotne rejestracje tej samej osoby.
- **Interpretation (EN):** Shows how many registrations turn into real participation; it reflects audience intent, ticket price, reminders and timing. Free, paid and online events must not share one scale. Pitfalls: differing attendance definitions (check-in vs. badge pickup; online live-only vs. live + on-demand, e.g. Contrast reports 44–50% live attendance and 61% watching live or on-demand separately), comps/VIP and group tickets in the denominator, duplicate registrations.

**Kontekst:** Wydarzenia stacjonarne bezpłatne (debaty, prezentacje raportów) · okres: na wydarzenie (agregat kwartalny jako mediana wydarzeń) · metoda: Kwartyl i mediana PheedLoop Event Data Lab (2026): mediana no-show dla wydarzeń bezpłatnych ~28% (N = 389), najgorsze 25% ≥47%. Próg optymalny to mediana wydarzeń płatnych (83%). Eventbrite: no-show 'as high as 50%' przy bezpłatnych. · źródła: S10, S12

| Ocena     | Przedział | Uwagi                                               |
| --------- | --------- | --------------------------------------------------- |
| krytyczny | 0–53      | ≈ najgorsze 25% wydarzeń bezpłatnych (no-show ≥47%) |
| słaby     | 53–62     |                                                     |
| normalny  | 62–72     | do mediany (no-show ~28% → obecność ~72%)           |
| dobry     | 72–83     |                                                     |
| optymalny | 83–100    | poziom mediany wydarzeń płatnych lub lepszy         |

**Kontekst:** Wydarzenia stacjonarne płatne (konferencje, gale, szkolenia) · okres: na wydarzenie · metoda: Kwartyl i mediana PheedLoop (2026): mediana no-show dla płatnych ~17% (N = 683), najgorsze 25% ≥32%. Górny próg według Eventbrite (no-show płatnych nawet ~10%). · źródła: S10, S12

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| krytyczny | 0–68      | ≈ najgorsze 25% wydarzeń płatnych (no-show ≥32%) |
| słaby     | 68–75     |                                                  |
| normalny  | 75–83     | do mediany (no-show ~17% → obecność ~83%)        |
| dobry     | 83–90     |                                                  |
| optymalny | 90–100    | no-show ≤10% (Eventbrite: 'as low as 10%')       |

**Kontekst:** Małe spotkania bezpłatne (10–49 osób, np. spotkania klubów dyskusyjnych) · okres: na spotkanie (agregat miesięczny) · metoda: Mediana PheedLoop (2026) dla małych bezpłatnych wydarzeń: no-show ~37%, czyli obecność ~63%. Pozostałe pasma: mediana ± heurystyka. · źródła: S10

| Ocena     | Przedział | Uwagi                       |
| --------- | --------- | --------------------------- |
| krytyczny | 0–50      |                             |
| słaby     | 50–58     |                             |
| normalny  | 58–68     | mediana ~63% (no-show ~37%) |
| dobry     | 68–80     |                             |
| optymalny | 80–100    |                             |

**Kontekst:** Wydarzenia online / webinary B2B – obecność na żywo (live) · okres: na webinar (agregat kwartalny) · metoda: Contrast (dane własnej platformy, ponad 1 mln rejestrujących, aktualizacja 16.04.2026): dobra obecność live 44–50% rejestrujących – pasmo 'dobry'; start o 14:00 – 55% – próg 'optymalny'. Goldcast 2025: średnio 33% (19 tys. webinarów, dane opisane głównie jako 2024; metoda liczenia niepodana). Goldcast 2026: ok. 32% z ilorazu sum (2,2 mln / 6,8 mln, wyliczenie własne). ON24 57% / 60% niezweryfikowane (403 na on24.com i marketingprofs.com) – nie są kotwicą pasm. Progi 20 i 30 to heurystyka. · źródła: S100, S13, S14

| Ocena     | Przedział | Uwagi                                                                                                               |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–20      |                                                                                                                     |
| słaby     | 20–30     |                                                                                                                     |
| normalny  | 30–44     | Goldcast: średnio 33% (dane ok. 2024); Goldcast 2026: ok. 32% z ilorazu sum (wyliczenie własne)                     |
| dobry     | 44–55     | Contrast: obecność live 44–50% rejestrujących ('a good webinar attendance rate', aktualizacja 16.04.2026)           |
| optymalny | 55–100    | Contrast: webinary startujące o 14:00 – 55%; ON24 (57–60%) niezweryfikowane i obejmuje on-demand – nie jest kotwicą |

**Kontekst:** Wydarzenia online – obecność łączna (live + odtworzenie on-demand) · okres: na webinar (z oknem on-demand np. 30 dni) · metoda: Heurystyka (pewność kontekstu niska). Granica normalny/dobry 57% pochodziła ze średniej ON24 (57% w raporcie 2025, 60% w raporcie 2026), której nie da się zweryfikować (on24.com i marketingprofs.com zwracają 403, Voxbooster to źródło wtórne). Potwierdzona kotwica: Contrast (dane własnej platformy, aktualizacja 16.04.2026) – 61% rejestrujących ogląda live lub on-demand, w paśmie 'dobry'. Pozostałe progi to heurystyka. · źródła: S100

| Ocena     | Przedział | Uwagi                                                                                                                                   |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–30      |                                                                                                                                         |
| słaby     | 30–45     |                                                                                                                                         |
| normalny  | 45–57     |                                                                                                                                         |
| dobry     | 57–65     | Contrast: 61% rejestrujących ogląda live lub on-demand (aktualizacja 16.04.2026); ON24 57% (2024) / 60% (2025) – niezweryfikowane (403) |
| optymalny | 65–100    |                                                                                                                                         |

**Zastrzeżenia:**

- Zbiór PheedLoop to dane jednej platformy (ponad 1 070 wydarzeń), bez podziału geograficznego. Nie znaleziono polskich ani europejskich benchmarków frekwencji.
- Według PheedLoop (raport #06) różnica między płacącymi a niepłacącymi na tym samym wydarzeniu to tylko 2–4 pkt proc., więc większość luki między wydarzeniami bezpłatnymi a płatnymi wynika z typu wydarzenia, a nie z samej opłaty.
- Średnia Goldcast 33% może być średnią wskaźników per webinar. Iloraz sum (51/238) daje ok. 21%. Rok danych nie jest jednoznaczny – wiele liczb raport opisuje jako 2024.
- Liczby ON24 (57% w raporcie 2025, 60% w raporcie 2026) są niezweryfikowane: on24.com i marketingprofs.com zwracają 403, a Voxbooster to źródło wtórne. Dotyczą platformy enterprise o wysokiej intencji odbiorców i obejmują on-demand. Nie są kotwicą pasm i nie porównuj ich z obecnością tylko live.
- Dane Eventbrite (2018) są anegdotyczne, bez metodologii.
- Wartości Contrast 41,6% (mediana) i 46,2% (średnia) przytaczane przez Voxbooster nie występują na stronie Contrast, którą Voxbooster podaje jako źródło – usunięto je z pasm. Dane Contrast (live 44–50%, live lub on-demand 61%) pochodzą z jednej platformy (ponad 1 mln rejestrujących).

### NSR: Wskaźnik nieobecności (no-show) (No-show rate)

- **Rozwinięcie:** No-Show Rate – odsetek zarejestrowanych, którzy nie pojawili się na wydarzeniu / No-Show Rate – share of registrants who did not attend
- **Wzór:** NSR = (ważne rejestracje − obecni) / ważne rejestracje × 100% = 100% − wskaźnik obecności (AR)
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** To lustrzane odbicie frekwencji, przydatne operacyjnie do planowania sali, cateringu i nadrezerwacji (overbookingu). Przy oczekiwanym no-show 28% trzeba zebrać ok. 1,4 rejestracji na każde miejsce, żeby wypełnić salę. Pułapki: nie licz anulacji zgłoszonych przed wydarzeniem jako no-show, a wydarzeń bezpłatnych, płatnych i online nie oceniaj jedną skalą.
- **Interpretation (EN):** The mirror of attendance rate, used operationally for venue, catering and overbooking planning: with an expected 28% no-show you need about 1.4 registrations per seat. Pitfalls: do not count pre-event cancellations as no-shows; never judge free, paid and online events on a single scale.

**Kontekst:** Wydarzenia stacjonarne bezpłatne · okres: na wydarzenie · metoda: PheedLoop (2026): mediana ~28%, najgorsze 25% ≥47%. Eventbrite: do 50%. · źródła: S10, S12

| Ocena     | Przedział | Uwagi                                       |
| --------- | --------- | ------------------------------------------- |
| optymalny | 0–17      | poziom mediany wydarzeń płatnych lub lepszy |
| dobry     | 17–28     |                                             |
| normalny  | 28–38     | od mediany (~28%) w górę                    |
| słaby     | 38–47     |                                             |
| krytyczny | 47–100    | najgorsze 25% wydarzeń bezpłatnych          |

**Kontekst:** Wydarzenia stacjonarne płatne · okres: na wydarzenie · metoda: PheedLoop (2026): mediana ~17%, najgorsze 25% ≥32%. Eventbrite: 'as low as 10%'. · źródła: S10, S12

| Ocena     | Przedział | Uwagi                           |
| --------- | --------- | ------------------------------- |
| optymalny | 0–10      |                                 |
| dobry     | 10–17     |                                 |
| normalny  | 17–25     | od mediany (~17%) w górę        |
| słaby     | 25–32     |                                 |
| krytyczny | 32–100    | najgorsze 25% wydarzeń płatnych |

**Kontekst:** Małe spotkania bezpłatne (10–49 osób, kluby dyskusyjne) · okres: na spotkanie · metoda: PheedLoop (2026): mediana dla małych bezpłatnych wydarzeń ~37%. Pasma: mediana ± heurystyka. · źródła: S10

| Ocena     | Przedział | Uwagi        |
| --------- | --------- | ------------ |
| optymalny | 0–20      |              |
| dobry     | 20–32     |              |
| normalny  | 32–42     | mediana ~37% |
| słaby     | 42–50     |              |
| krytyczny | 50–100    |              |

**Kontekst:** Webinary / wydarzenia online B2B (nieobecność na żywo) · okres: na webinar · metoda: Dopełnienie benchmarków obecności live: Contrast (dane własnej platformy, aktualizacja 16.04.2026) – obecność live 44–50%, czyli no-show 50–56%; Goldcast 2025 – obecność 33%, czyli no-show ok. 67%. Progi 70 i 80 oraz próg 'optymalny' (<45%, lustro obecności ≥55%) to heurystyka. ON24 niezweryfikowane (403) – nie jest kotwicą. · źródła: S100, S13

| Ocena     | Przedział | Uwagi                                                                         |
| --------- | --------- | ----------------------------------------------------------------------------- |
| optymalny | 0–45      | lustro progu 'optymalny' obecności live (≥55%; Contrast: start o 14:00 – 55%) |
| dobry     | 45–56     | Contrast: obecność live 44–50% → no-show 50–56%                               |
| normalny  | 56–70     | Goldcast: średnia obecność 33% → no-show ok. 67%                              |
| słaby     | 70–80     |                                                                               |
| krytyczny | 80–100    |                                                                               |

**Zastrzeżenia:**

- Wskaźnik liczony jest z tych samych danych co frekwencja, więc w panelu pokazuj go jako drugą stronę tej samej miary, a nie jako osobną ocenę.
- Brak polskich ani europejskich danych o no-show. PheedLoop to dane jednej platformy.
- PheedLoop (raport #06): wydarzenia bezpłatne mają wyższy odsetek dokończonych rejestracji (~96% vs ~86%) i wyższy no-show. Łatwiejsza rejestracja przyciąga też mniej zdecydowanych.
- PheedLoop (raport #05) według wielkości wydarzenia: 50–149 / 150–499 / 500–999 / 1 000+ uczestników – no-show ok. 23 / 19 / 18 / 19%.

### RCR: Konwersja strony rejestracji na wydarzenie (Event registration page conversion rate)

- **Rozwinięcie:** Registration Conversion Rate – odsetek unikalnych odwiedzających stronę wydarzenia, którzy dokończyli rejestrację / Registration Conversion Rate – share of unique visitors to the event page who completed registration
- **Wzór:** RCR = zakończone rejestracje / unikalni odwiedzający stronę rejestracji (landing page wydarzenia) × 100%. Raportuj osobno według źródła ruchu.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy atrakcyjność oferty wydarzenia (temat, prelegenci, termin), jakość strony i tarcie formularza. Pułapki: wynik zależy przede wszystkim od miksu ruchu, bo ciepły ruch z newslettera konwertuje wielokrotnie lepiej niż reklamy. Wynik zniekształca też liczenie sesji zamiast unikalnych osób i mylenie rozpoczętych rejestracji z zakończonymi. Wydarzenia płatne mają niższy odsetek dokończonych rejestracji.
- **Interpretation (EN):** Measures the appeal of the event offer (topic, speakers, date), page quality and form friction. Pitfalls: traffic mix dominates the result (warm newsletter traffic converts many times better than ads), counting sessions instead of unique people, confusing started with completed registrations; paid events have lower completion.

**Kontekst:** Ruch mieszany (social media, wyszukiwarka, reklamy, polecenia) · okres: na wydarzenie / kampanię · metoda: Mediany Unbounce 2024: wszystkie branże 6,6% (mediany branż 3,8–12,3%), Entertainment 12,3%, Publishing 9,8%; Unbounce nie ma kategorii wydarzeń ani webinarów. Próg 'optymalny' 25% to heurystyka: ON24 2025 (przez MarketingProfs) podaje ok. 25% dla spersonalizowanych landing page'y, ale liczby nie da się zweryfikować (403). Pozostałe pasma: mediana i odchylenia heurystyczne. · źródła: S17, S18

| Ocena     | Przedział | Uwagi                                                                                                                       |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–3       | poniżej najniższej mediany branżowej Unbounce (3,8%)                                                                        |
| słaby     | 3–6,6     | poniżej mediany wszystkich branż (6,6%)                                                                                     |
| normalny  | 6,6–12    | Publishing 9,8%                                                                                                             |
| dobry     | 12–25     | Entertainment 12,3%                                                                                                         |
| optymalny | 25–100    | heurystyka; ON24 (przez MarketingProfs): spersonalizowane landing page'e webinarowe ok. 25% – liczba niezweryfikowana (403) |

**Kontekst:** Ruch z własnej bazy (newsletter, CRM, imienne zaproszenia do członków i klientów) · okres: na wysyłkę / wydarzenie · metoda: Heurystyka (pewność niska), bez benchmarku dla wydarzeń. Mediana Unbounce 2024 dla ruchu e-mail na stronach Entertainment (46,2%) według samego Unbounce wynika głównie z loterii (sweepstakes) promowanych do list mailingowych, więc nie jest kotwicą dla rejestracji na wydarzenia; górne progi ustawiono poniżej tej wartości (dobry 30–45, optymalny ≥45). · źródła: S18

| Ocena     | Przedział | Uwagi                                                                                                                                                                                            |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | 0–10      |                                                                                                                                                                                                  |
| słaby     | 10–20     |                                                                                                                                                                                                  |
| normalny  | 20–30     |                                                                                                                                                                                                  |
| dobry     | 30–45     | heurystyka                                                                                                                                                                                       |
| optymalny | 45–100    | heurystyka; Unbounce: mediana ruchu e-mail na stronach Entertainment 46,2%, napędzana głównie przez loterie (sweepstakes) promowane e-mailem – to nie jest kotwica dla rejestracji na wydarzenia |

**Zastrzeżenia:**

- Nie znaleziono pierwotnego benchmarku konwersji 'odwiedzający → rejestracja' dla wydarzeń (Eventbrite, Cvent, Bizzabo nie publikują go otwarcie). Wartości to konwersje landing page'y Unbounce, a kategoria Entertainment obejmuje loterie z medianą 47,5%.
- Limit wyszukiwań w tej sesji wyczerpał się przed dalszym szukaniem danych Eventbrite, Splash i Cvent o konwersji stron wydarzeń. Warto to uzupełnić w kolejnym kroku.
- Dane ON24 o landing page'ach (25%) pochodzą z omówienia MarketingProfs; marketingprofs.com i on24.com zwracają 403, więc liczba jest niezweryfikowana, a próg 'optymalny' w ruchu mieszanym to heurystyka.
- Brak danych polskich i europejskich.
- Unbounce przypisuje medianę ruchu e-mail w kategorii Entertainment (46,2%) głównie loteriom (sweepstakes) promowanym e-mailem. Pasma dla ruchu z własnej bazy to heurystyka.

### Event NPS: NPS wydarzenia (Event Net Promoter Score)

- **Rozwinięcie:** Net Promoter Score uczestników (lub partnerów) konkretnego wydarzenia: % promotorów (9–10) − % krytyków (0–6) w pytaniu o polecenie wydarzenia / Net Promoter Score of a specific event's attendees (or partners): % promoters (9–10) minus % detractors (0–6)
- **Wzór:** Event NPS = % promotorów − % krytyków wśród respondentów ankiety po wydarzeniu (wysyłka 24–72 h po zakończeniu). Osobno dla uczestników, prelegentów i partnerów/sponsorów.
- **Jednostka:** score · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mówi, czy wydarzenie generuje rekomendacje i powroty na kolejne edycje. U partnerów i sponsorów wyższy NPS koreluje ze wzrostem liczby wystawców i przychodów (UFI/Explori). Pułapki: niska stopa odpowiedzi i autoselekcja (odpowiadają najbardziej zadowoleni lub najbardziej rozczarowani), małe próby przy kameralnych debatach oraz porównywanie wydarzeń online ze stacjonarnymi.
- **Interpretation (EN):** Indicates whether the event generates recommendations and repeat attendance; for partners/sponsors a higher NPS correlates with growth in exhibitors and revenue (UFI/Explori). Pitfalls: low response rates and self-selection, small samples at intimate debates, comparing online with in-person events.

**Kontekst:** Uczestnicy wydarzeń stacjonarnych (konferencje, debaty, prezentacje raportów) · okres: na wydarzenie · metoda: Heurystyka: NPS odwiedzających targi +11 / +17 (UFI/Explori 2017, zależnie od strategii nowości), wzrost średniej NPS targów o prawie 20 pkt od 2021 r. (Explori 2022 – bez wskazania grupy respondentów i wartości absolutnych, więc przesunięcie pasm to heurystyka, nie fakt), ogólna mediana NPS 42–44 (Survicate/SurveyMonkey). · źródła: S19, S20, S6, S7

| Ocena     | Przedział | Uwagi                                                                                                                                      |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | -100–0    |                                                                                                                                            |
| słaby     | 0–15      | okolice przedpandemicznego NPS odwiedzających targi (+11…+17)                                                                              |
| normalny  | 15–35     | heurystyka; Explori 2022: średni NPS targów wzrósł o prawie 20 pkt od 2021 r., bez wskazania, czy chodzi o wystawców, czy o odwiedzających |
| dobry     | 35–55     | okolice ogólnej mediany NPS (42–44)                                                                                                        |
| optymalny | 55–100    |                                                                                                                                            |

**Kontekst:** Uczestnicy wydarzeń online (webinary, debaty transmitowane) · okres: na wydarzenie · metoda: Heurystyka: pasma przesunięte o +5 pkt względem stacjonarnych, bo Explori raportuje, że 'advocacy is higher for virtual events than live events' (bez liczb). Odniesieniem jest ogólna mediana NPS. · źródła: S21, S7

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | -100–0    |       |
| słaby     | 0–20      |       |
| normalny  | 20–40     |       |
| dobry     | 40–60     |       |
| optymalny | 60–100    |       |

**Kontekst:** Partnerzy, sponsorzy, wystawcy · okres: na wydarzenie / edycję · metoda: Baseline 2017 (targi, wystawcy): kwartyle UFI & Explori 2017 dla NPS wystawców – 25% wydarzeń poniżej −36, 50% poniżej −17 (mediana; w Europie również −17), 25% powyżej 0. Explori 2022 ('wzrost o prawie 20 pkt od 2021') nie wskazuje, czy chodzi o wystawców, czy o odwiedzających, i nie podaje wartości absolutnych, więc pasm nie przesunięto; ewentualne przesunięcie (np. o +15) byłoby heurystyką. · źródła: S19, S20

| Ocena     | Przedział | Uwagi                                                        |
| --------- | --------- | ------------------------------------------------------------ |
| krytyczny | -100–-36  | dolny kwartyl wydarzeń (P25 ≈ −36)                           |
| słaby     | -36–-17   | P25–mediana (−17; 50% wydarzeń ma NPS wystawców poniżej −17) |
| normalny  | -17–0     | mediana–P75 (25% wydarzeń ma NPS dodatni)                    |
| dobry     | 0–20      | górny kwartyl                                                |
| optymalny | 20–100    |                                                              |

**Zastrzeżenia:**

- Brak aktualnych, publicznych benchmarków NPS konferencji. Bazy Explori są dostępne tylko dla klientów, a dostępne liczby dotyczą targów (2017) i trendu (2022).
- Dane partnerów i sponsorów pochodzą sprzed pandemii (2017). Explori raportuje późniejszy wzrost średniego NPS targów o prawie 20 pkt, ale nie precyzuje, czy dotyczy on wystawców, czy odwiedzających, i nie podaje wartości absolutnych – progi mogą być dziś zaniżone, lecz ich nie przesunięto; ewentualne przesunięcie (np. o +15) byłoby heurystyką.
- Targi branżowe to inny format niż debaty think tanku. Traktuj pasma jako orientacyjne i oceniaj głównie trend między edycjami tego samego cyklu.

### AMR: Odsetek aktywnych członków społeczności (klubu) (Active community member rate)

- **Rozwinięcie:** Active Member Rate – odsetek członków z dostępem do klubu lub społeczności, którzy w okresie byli aktywni (zalogowali się, czytali wątki, wzięli udział w spotkaniu) / Active Member Rate – share of members with access to the club/community who were active in the period (logged in, read threads, attended a meeting)
- **Wzór:** AMR = unikalni aktywni członkowie w okresie (miesiąc lub 120 dni) / wszyscy członkowie z aktywnym dostępem na koniec okresu × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy, czy członkostwo jest żywe, czy tylko opłacone lub założone. To wczesny sygnał ryzyka nieodnowienia. Pułapki: mianownik zawyżają nigdy niedezaktywowane konta (Higher Logic: 69,9 tys. kont, z czego 9,3 tys. aktywnych w 120 dni). Część członków korzysta tylko z digestu e-mail (otwarcia 44–56%), więc miara oparta na logowaniu zaniża realne zaangażowanie.
- **Interpretation (EN):** Shows whether membership is alive or merely paid/created, and is an early non-renewal risk signal. Pitfalls: never-deactivated accounts inflate the denominator (Higher Logic: 69.9k accounts vs 9.3k active in 120 days); some members only consume the email digest (44–56% opens), so login-based measures understate engagement.

**Kontekst:** Duża, otwarta społeczność online (tysiące kont), aktywność miesięczna; mianownik: wszystkie konta z dostępem · okres: miesięcznie (pomocniczo 120 dni) · metoda: Heurystyka (mianownik: wszystkie konta z dostępem, zgodnie ze wzorem). Higher Logic 2025: średnio 563 unikalnych logujących miesięcznie przy medianie 12 040 kont (średnia 69 982) – rząd kilku procent; 13% kont aktywnych w 120 dniach. Deklaracja raportu 'XL: 10% użytkowników loguje się w miesiącu' jest wewnętrznie sprzeczna (1 297 unikalnych logowań przy ponad 50 tys. kont daje ≤2,6%), więc nie jest kotwicą. Przy mianowniku 'konta aktywne w ostatnich 120 dniach' (563 / 9,3 tys. ≈ 6%) obowiązywałaby inna skala – w panelu wybierz jeden mianownik. · źródła: S23

| Ocena     | Przedział | Uwagi                                                                                                                                |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| krytyczny | 0–1       |                                                                                                                                      |
| słaby     | 1–3       |                                                                                                                                      |
| normalny  | 3–6       | rząd wielkości Higher Logic: średnio 563 unikalnych logujących miesięcznie przy medianie 12 040 kont (≈4,7%, wyliczenie przybliżone) |
| dobry     | 6–10      |                                                                                                                                      |
| optymalny | 10–100    | heurystyka; dla porównania 13% kont aktywnych w oknie 120 dni (Higher Logic)                                                         |

**Kontekst:** Mały, płatny lub kuratorowany klub dyskusyjny (do ok. 100 członków); aktywność = logowanie, udział w wątku lub spotkaniu · okres: miesięcznie · metoda: Heurystyka ekspercka bez bezpośredniego benchmarku. Uzasadnienie: członkostwo jest płatne i selektywne, a Higher Logic pokazuje, że mniejsze społeczności mają wyższy względny udział aktywnych. · źródła: S23

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | 0–20      |       |
| słaby     | 20–35     |       |
| normalny  | 35–50     |       |
| dobry     | 50–70     |       |
| optymalny | 70–100    |       |

**Zastrzeżenia:**

- Higher Logic obejmuje ok. 1 500 stowarzyszeń i organizacji non-profit z USA, Kanady i regionu APAC (VI 2024 – V 2025). To nie są europejskie think tanki.
- Do aktywności klubu włącz także udział w spotkaniach stacjonarnych, których platforma online nie widzi.
- Brak polskich danych.
- Raport Higher Logic jest wewnętrznie niespójny dla społeczności XL ('10% of users' wobec 1 297 unikalnych logowań przy ponad 50 tys. kont, czyli ≤2,6%). Pasma dużej społeczności to heurystyka przy mianowniku 'wszystkie konta z dostępem'; w panelu trzeba jednoznacznie wybrać jeden mianownik.

### CR 90-9-1: Odsetek współtworzących (reguła 90-9-1) (Contributor rate (90-9-1 rule))

- **Rozwinięcie:** Contributor Rate – odsetek aktywnych członków, którzy sami coś wnieśli (wątek, odpowiedź, komentarz, pytanie, materiał). Reguła 90-9-1: 90% obserwuje, 9% udziela się okazjonalnie, 1% tworzy większość treści. / Contributor Rate – share of active members who contributed (thread, reply, comment, question, resource); the 90-9-1 rule: 90% lurk, 9% contribute occasionally, 1% create most content
- **Wzór:** CR = unikalni współtwórcy w miesiącu (nowy wątek, odpowiedź, komentarz, wystąpienie) / unikalni aktywni (zalogowani) członkowie w miesiącu × 100%. Pomocniczo: udział top 1% autorów w liczbie wpisów.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, czy społeczność jest rozmową, czy tylko widownią. Według reguły 90-9-1 współtworzy ok. 10% aktywnych, a dobrze zaprojektowane społeczności zbliżają się do 80-16-4 (ok. 20%). Pułapki: inny mianownik zmienia wynik dwukrotnie (Higher Logic podaje 6% wobec wszystkich logowań, a wobec unikalnych logujących wychodzi ok. 12%). Obserwatorzy też czerpią wartość, a zbyt wysoki odsetek w dużej społeczności może oznaczać spam lub sztuczne nabijanie aktywności.
- **Interpretation (EN):** Shows whether the community is a conversation or just an audience. Under 90-9-1 about 10% of actives contribute; well-designed communities approach 80-16-4 (about 20%). Pitfalls: the denominator can halve or double the result (Higher Logic reports 6% of all logins vs about 12% of unique logins); lurkers still get value; an unusually high rate in a large community may signal spam or gamification.

**Kontekst:** Społeczność online średniej lub dużej skali (powyżej ok. 1 tys. kont) · okres: miesięcznie · metoda: Reguła 90-9-1 (Nielsen 2006): ~10% współtworzących, cel 80-16-4 (~20%), blogi 95-5-0,1 (~5%). Higher Logic 2025: średnio 68 współtwórców na 563 unikalnych logujących (~12%, wyliczenie własne), społeczności 3–5-letnie 7–10%, społeczności M 17%. · źródła: S22, S23

| Ocena     | Przedział | Uwagi                                          |
| --------- | --------- | ---------------------------------------------- |
| krytyczny | 0–5       | poziom blogów (95-5-0,1)                       |
| słaby     | 5–8       | dojrzałe społeczności 3–5 lat: 7–10%           |
| normalny  | 8–12      | reguła 90-9-1 ≈ 10%; Higher Logic średnio ~12% |
| dobry     | 12–20     | społeczności M (Higher Logic) 17%              |
| optymalny | 20–100    | cel 80-16-4 (Nielsen)                          |

**Kontekst:** Mały klub dyskusyjny (do kilkuset członków) · okres: miesięcznie · metoda: Higher Logic 2025: współtwórcy jako odsetek logujących – społeczności S 36%, S/M 21%, M 17%, nowe (<2 lata) 16%. Pasma dla mniejszych klubów to ekstrapolacja heurystyczna. · źródła: S23, S22

| Ocena     | Przedział | Uwagi                                |
| --------- | --------- | ------------------------------------ |
| krytyczny | 0–10      |                                      |
| słaby     | 10–17     |                                      |
| normalny  | 17–25     | społeczności S/M 21%                 |
| dobry     | 25–36     |                                      |
| optymalny | 36–100    | społeczności S (500–1 tys. kont) 36% |

**Zastrzeżenia:**

- Reguła 90-9-1 to heurystyka z 2006 r., a nie prawo. Nielsen podkreśla, że nierówności udziału nie da się usunąć, można jedynie spłaszczyć krzywą, np. do 80-16-4.
- Higher Logic: 'Unique Contributors… represents just 6% of the average monthly login base' (68 / 1 156 wszystkich logowań). Względem unikalnych logujących jest to ok. 12%, więc w panelu trzeba jednoznacznie zdefiniować mianownik.
- Dane dotyczą społeczności stowarzyszeń (USA, Kanada, APAC). Społeczności czatowe i wydarzeniowe mogą mieć inny rozkład. Brak danych polskich.
- Higher Logic nie definiuje jednoznacznie mianownika dla wartości według rozmiaru i wieku społeczności ('44 logins, but 36% of those are contributors'), więc mogą to być logowania, a nie unikalni logujący.

### Lead→MQL: Konwersja leadów do MQL (Lead-to-MQL conversion rate)

- **Rozwinięcie:** Lead → MQL (Marketing Qualified Lead – lead zakwalifikowany przez marketing: pasuje do profilu idealnego klienta i wykazał zainteresowanie ofertą) / Lead to Marketing Qualified Lead (a lead that fits the ideal customer profile and showed interest)
- **Wzór:** Lead→MQL = leady z kohorty miesiąca M, które uzyskały status MQL (w oknie np. 90 dni) / wszystkie nowe leady z miesiąca M × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje jakość pozyskiwanych kontaktów i trafność targetowania, np. ilu zapisanych na raport lub wydarzenie to decydenci z firm i instytucji pasujących do oferty. Pułapki: wynik zależy od definicji MQL, którą każda organizacja ustala sama. Zbyt wysoki odsetek może oznaczać zbyt luźne kryteria, a liczenie bez kohort miesza leady z różnych okresów.
- **Interpretation (EN):** Shows the quality of captured contacts and targeting accuracy, e.g. how many report/event sign-ups are decision-makers from organisations that fit the offer. Pitfalls: entirely dependent on your own MQL definition; a very high rate may mean overly loose criteria; non-cohort counting mixes periods.

**Kontekst:** B2B ogólnie (oferta instytucjonalna, członkostwa firmowe, partnerstwa) · okres: miesięcznie (kohortowo) · metoda: Średnia First Page Sage 31% (wszystkie branże i kanały) jako granica normalny/dobry. Branże: B2B SaaS 39%, doradztwo biznesowe 28%, usługi finansowe 29%, szkolnictwo wyższe 45%. Dolne pasma to heurystyka. · źródła: S24, S26

| Ocena     | Przedział | Uwagi                                                       |
| --------- | --------- | ----------------------------------------------------------- |
| krytyczny | 0–10      |                                                             |
| słaby     | 10–20     |                                                             |
| normalny  | 20–31     | do średniej wszystkich branż (31%); doradztwo biznesowe 28% |
| dobry     | 31–45     | B2B SaaS 39%                                                |
| optymalny | 45–100    | szkolnictwo wyższe 45%                                      |

**Kontekst:** Leady z wydarzeń i webinarów · okres: na wydarzenie / miesięcznie · metoda: Benchmarki kanałowe First Page Sage: webinar 19%, konferencje 28%, targi 24%, executive events 54%, e-mail 38%, polecenia klientów 56%. · źródła: S24

| Ocena     | Przedział | Uwagi                                                     |
| --------- | --------- | --------------------------------------------------------- |
| krytyczny | 0–8       |                                                           |
| słaby     | 8–14      |                                                           |
| normalny  | 14–24     | webinary 19%, targi 24%                                   |
| dobry     | 24–40     | konferencje 28%                                           |
| optymalny | 40–100    | wydarzenia dla kadry zarządzającej (executive events) 54% |

**Zastrzeżenia:**

- Jedno źródło: dane klientów jednej agencji (ok. 70% B2B, głównie SEO, rynek USA). Raport ma niespójności liczby branż (30 / 15 / 29) i nie podaje okresu danych ('Our data has been built over 10 years').
- Brak polskich ani europejskich benchmarków. Wskaźnik ma sens dopiero po spisaniu definicji MQL w CRM (np. scoring dopasowania i zachowania).
- Ta sama agencja podaje dla Entertainment Lead→MQL 34% (raport Lead-to-MQL 2025, S24) i 19% (Sales Funnel Benchmarks 2026, S26), co dodatkowo uzasadnia ostrożność: pewność średnia, na granicy niskiej.

### MQL→SQL: Konwersja MQL do SQL (MQL-to-SQL conversion rate)

- **Rozwinięcie:** MQL → SQL (Sales Qualified Lead – lead przyjęty przez sprzedaż: zweryfikowany jako dopasowany, z intencją zakupu i umówionym spotkaniem) / Marketing Qualified Lead to Sales Qualified Lead (vetted by sales as a fit, with buying intent and a booked meeting)
- **Wzór:** MQL→SQL = MQL z kohorty miesiąca M zaakceptowane przez sprzedaż jako SQL / wszystkie MQL z miesiąca M × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy jakość MQL i zgodność marketingu ze sprzedażą: niski wynik oznacza, że marketing przekazuje kontakty, których sprzedaż nie chce, albo że sprzedaż nie podejmuje kontaktu. Pułapki: rzetelne źródła podają od 13% do 68% zależnie od definicji MQL. Porównuj się więc z benchmarkiem o tej samej definicji i śledź osobno MQL odrzucone i MQL bez kontaktu.
- **Interpretation (EN):** Measures MQL quality and marketing–sales alignment: a low value means marketing hands over contacts sales does not want, or sales does not follow up. Pitfalls: reputable sources range from 13% to 68% depending on the MQL definition, so compare only with a same-definition benchmark and track rejected vs. never-contacted MQLs separately.

**Kontekst:** Szeroka definicja MQL (scoring zachowań: pobranie raportu, zapis, udział w webinarze + dopasowanie profilu) · okres: miesięcznie (kohortowo) · metoda: First Page Sage, raport MQL→SQL 2026 (dane 2019–2025): zakres median branżowych 10–26%, B2B SaaS 13%, Entertainment 16%, Higher Education 21%. Średnia prosta 30 branż ≈ 16% (wyliczenie własne). · źródła: S25

| Ocena     | Przedział | Uwagi                                                     |
| --------- | --------- | --------------------------------------------------------- |
| krytyczny | 0–5       |                                                           |
| słaby     | 5–10      | poniżej najniższej mediany branżowej (10%)                |
| normalny  | 10–16     | B2B SaaS 13%, usługi finansowe 13%, średnia 30 branż ≈16% |
| dobry     | 16–26     | szkolnictwo wyższe 21%                                    |
| optymalny | 26–100    | najwyższe mediany branżowe 26%                            |

**Kontekst:** Wąska definicja MQL (deklarowana intencja: prośba o ofertę, demo, kontakt handlowy, zapytanie o partnerstwo) · okres: miesięcznie (kohortowo) · metoda: First Page Sage, Sales Funnel Benchmarks 2026: zakres 32–58% (B2B SaaS 38%, Financial Services 38%, Higher Education 46%). Ebsta x Pavilion 2025: MQL→SQL 68% (dane CRM ponad 655 tys. szans). · źródła: S26, S27

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| krytyczny | 0–20      |                                                  |
| słaby     | 20–32     | poniżej najniższej wartości w tabeli lejka (32%) |
| normalny  | 32–40     | B2B SaaS 38%, usługi finansowe 38%               |
| dobry     | 40–58     | szkolnictwo wyższe 46%                           |
| optymalny | 58–100    | Ebsta x Pavilion 2025: 68%                       |

**Zastrzeżenia:**

- Ta sama agencja (First Page Sage) podaje dla B2B SaaS 13% w jednym raporcie i 38% w drugim, co dowodzi zależności od definicji. Wybierz w panelu jeden kontekst zgodny z własną definicją.
- Ebsta 68% pochodzi z danych firm technologicznych z dojrzałym procesem SDR. Dla think tanku z małym wolumenem leadów wynik będzie bardzo zmienny.
- Brak danych polskich.

### Win rate: Skuteczność domykania (SQL → klient) (Win rate (SQL-to-customer))

- **Rozwinięcie:** Win Rate – odsetek szans sprzedażowych (SQL/opportunity) zakończonych wygraną (closed-won) / Win Rate – share of sales opportunities (SQL/opportunity) that end closed-won
- **Wzór:** Win rate = wygrane / (wygrane + przegrane, w tym 'brak decyzji') wśród szans zamkniętych w okresie × 100%. Wariant kohortowy: wygrane z SQL utworzonych w miesiącu M / wszystkie SQL z miesiąca M.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy skuteczność sprzedaży i jakość kwalifikacji: ile wartościowych rozmów kończy się umową (członkostwo instytucjonalne, sponsoring, zlecenie). Pułapki: pomijanie szans 'bez decyzji' i zawieszonych zawyża wynik, a mieszanie nowych klientów z rozszerzeniami i odnowieniami (te mają ok. 2,5 razy wyższą skuteczność) zniekształca obraz. Przy kilkunastu szansach na kwartał wynik jest bardzo niestabilny.
- **Interpretation (EN):** Measures sales effectiveness and qualification quality: how many qualified conversations end in a contract (institutional membership, sponsorship, commission). Pitfalls: dropping 'no decision'/stalled deals inflates it; mixing new logos with expansions/renewals (about 2.5× higher win rate) distorts it; with a dozen opportunities per quarter it is very noisy.

**Kontekst:** Nowi klienci B2B (new logo: członkostwa instytucjonalne, sponsoring, zlecenia badawcze) · okres: kwartalnie (kroczące 12 miesięcy przy małym wolumenie) · metoda: Ebsta x Pavilion 2025: win rate nowych klientów 19% (na s. 22: 18%), top performerzy mają win rate wyższy o 43% rel. (≈27%, wyliczenie własne). First Page Sage 2026 dla B2B SaaS: SQL→szansa 42% × szansa→wygrana 37% ≈ 16% (wyliczenie własne). Ebsta 2023: typowe oczekiwanie 20–25% szans na zamknięcie. Dolne pasma to heurystyka. · źródła: S27, S26, S28

| Ocena     | Przedział | Uwagi                                                  |
| --------- | --------- | ------------------------------------------------------ |
| krytyczny | 0–8       |                                                        |
| słaby     | 8–14      |                                                        |
| normalny  | 14–19     | FPS B2B SaaS SQL→klient ≈16% (wyliczenie)              |
| dobry     | 19–27     | od średniej Ebsta 2025 (19%)                           |
| optymalny | 27–100    | ≈ poziom top performerów (+43% rel. względem średniej) |

**Kontekst:** Rozszerzenia i odnowienia u obecnych klientów (upsell, cross-sell, kolejne edycje sponsoringu) · okres: kwartalnie · metoda: Ebsta x Pavilion 2025: win rate rozszerzeń 45% ('Selling to existing customers is 2.5x easier'). Pasma to heurystyka wokół tej wartości. · źródła: S27

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | 0–20      |                                        |
| słaby     | 20–35     |                                        |
| normalny  | 35–45     |                                        |
| dobry     | 45–60     | od średniej Ebsta dla rozszerzeń (45%) |
| optymalny | 60–100    |                                        |

**Zastrzeżenia:**

- Ebsta to dane firm technologicznych i usługowych (transakcje w USD), a nie think tanków. Brak danych polskich i europejskich.
- Raport Ebsta 2025 podaje spadek win rate o 10% rel. r/r. Inne źródła wtórne podają rozbieżne wartości dla 2024 r., więc liczby r/r traktuj ostrożnie.
- Raporty Gong i HubSpot (ok. 21%) znane są tylko ze streszczeń wtórnych i nie zostały użyte.

### STL: Czas reakcji na lead (speed to lead) (Lead response time (speed to lead))

- **Rozwinięcie:** Speed To Lead / Lead Response Time – czas od zgłoszenia leada (formularz, e-mail, telefon) do pierwszego merytorycznego kontaktu człowieka / Speed To Lead / Lead Response Time – time from lead submission to the first meaningful human contact
- **Wzór:** STL = mediana (czas pierwszego kontaktu − czas utworzenia leada) w minutach roboczych dla leadów o wysokiej intencji w okresie. Dodatkowo raportuj % leadów obsłużonych w ≤5 min, ≤60 min i odsetek bez kontaktu.
- **Jednostka:** minutes · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, czy organizacja kontaktuje się z zainteresowanymi, póki temat jest gorący (zapytanie o sponsoring, ofertę instytucjonalną, partnerstwo przy wydarzeniu). Według HBR firmy kontaktujące się w ciągu godziny miały niemal 7 razy większą szansę zakwalifikować lead niż te, które czekały godzinę dłużej. Pułapki: automatyczny e-mail potwierdzający to nie kontakt. Mierz w godzinach roboczych, a leady o niskiej intencji (zapis na newsletter) obsługuj automatycznie zamiast wliczać je do wskaźnika.
- **Interpretation (EN):** Measures whether the organisation reaches interested parties while the topic is hot (sponsorship, institutional offer, event partnership enquiries); per HBR, firms contacting within an hour were nearly 7× more likely to qualify the lead than those waiting one hour longer. Pitfalls: an auto-reply is not contact; measure in business hours; route low-intent leads (newsletter sign-ups) to automated nurture rather than this KPI.

**Kontekst:** Leady przychodzące o wysokiej intencji (zapytanie ofertowe, sponsoring, subskrypcja instytucjonalna), w godzinach pracy · okres: miesięcznie (mediana + odsetki w progach) · metoda: Progi czasowe ze źródeł. HBR 2011 (2 241 firm z USA): 37% odpowiada w ciągu godziny, 16% w 1–24 h, 24% po >24 h, 23% wcale, średnia 42 h. Kontakt w ciągu godziny daje ≈7 razy większą szansę kwalifikacji, a >60 razy większą niż po 24 h. Blazeo 2026 (573 firmy): 74% nie mieści się w 5 min, a przy SLA 54,9% odpowiada w 15 min (vs 29,5% bez SLA). · źródła: S29, S30, S31

| Ocena     | Przedział | Uwagi                                                                                       |
| --------- | --------- | ------------------------------------------------------------------------------------------- |
| optymalny | 0–5       | standard 'pięciu minut'; 74% firm go nie spełnia (Blazeo 2026, dane z omówienia LeanData)   |
| dobry     | 5–60      | w ciągu godziny (37% firm w badaniu HBR)                                                    |
| normalny  | 60–480    | ten sam dzień roboczy                                                                       |
| słaby     | 480–1440  | kontakt następnego dnia roboczego                                                           |
| krytyczny | ≥ 1440    | >24 h – według HBR >60 razy mniejsza szansa kwalifikacji niż przy kontakcie w ciągu godziny |

**Zastrzeżenia:**

- Kluczowe dane HBR pochodzą z 2011 r. i z rynku USA. Pełny tekst jest za paywallem, a liczby potwierdzono w streszczeniu SmartCompany (2011).
- Reguła pięciu minut opiera się na starszych badaniach dostawców (InsideSales) i bywa kwestionowana. Dane Blazeo 2026 (74% poza oknem 5 minut; SLA 54,9% vs 29,5% w 15 min) są potwierdzone wyłącznie w omówieniu LeanData (15.04.2026) – raportu pierwotnego nie zweryfikowano.
- Brak polskich danych. Dla klientów sektora publicznego szybki kontakt nie skraca procedur zamówień, ale nadal wpływa na kwalifikację.
- Analiza 1,25 mln leadów (mnożniki ≈7× i >60×) objęła 29 firm B2C i tylko 13 B2B, a wskaźnik dotyczy leadów B2B.

### SCL: Długość cyklu sprzedaży B2B (B2B sales cycle length)

- **Rozwinięcie:** Sales Cycle Length – liczba dni od utworzenia szansy sprzedażowej (SQL/opportunity) do jej wygrania (closed-won) / Sales Cycle Length – days from opportunity (SQL) creation to closed-won
- **Wzór:** SCL = mediana (data wygranej − data utworzenia szansy) w dniach dla transakcji wygranych w okresie, osobno dla nowych klientów i rozszerzeń oraz według wielkości transakcji. Pomocniczo: % otwartych szans starszych niż 2× własna mediana cyklu (Ebsta: szanse otwarte >2× średniego cyklu mają ok. 3% szans).
- **Jednostka:** days · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje tempo zamieniania szans w przychód i pomaga planować przepływy oraz pipeline, np. sprzedaż sponsoringu z wyprzedzeniem przed wydarzeniem. Ebsta pokazuje, że szanse otwarte dłużej niż dwukrotność średniego cyklu mają ok. 3% szans na wygraną, a poślizg późnych etapów o ponad 2 miesiące drastycznie obniża skuteczność. Pułapki: średnia zamiast mediany (zawyżają ją pojedyncze długie transakcje) oraz mieszanie małych i dużych umów. Cykl skrócony rabatem może obniżyć wartość transakcji.
- **Interpretation (EN):** Shows how fast opportunities turn into revenue and supports cash-flow and pipeline planning (e.g., selling sponsorship well ahead of an event). Ebsta shows opportunities open longer than twice the average cycle have about a 3% chance of closing, and late-stage slippage beyond 2 months sharply cuts win rates. Pitfalls: mean instead of median (skewed by a few long deals), mixing small and large deals; shortening the cycle via discounts can erode deal value.

**Kontekst:** Małe transakcje B2B (np. subskrypcje firmowe, pojedyncze pakiety) · okres: kwartalnie (mediana transakcji wygranych) · metoda: Ebsta 2023 (3,2 mln szans): 'złoty okres' zamknięcia małych transakcji to 31–60 dni (win rate wyższy o 165%) – mieści się w całości w paśmie 'optymalny'. Szanse otwarte dłużej niż 2× ŚREDNI cykl mają ok. 3% szans na zamknięcie; próg 'krytyczny' licz dynamicznie jako 2× własna mediana (120 dni to wartość domyślna). Progi 75 i 90 to heurystyka. · źródła: S28

| Ocena     | Przedział | Uwagi                                                                                                     |
| --------- | --------- | --------------------------------------------------------------------------------------------------------- |
| optymalny | 0–60      | do końca 'złotego okresu' 31–60 dni (Ebsta 2023: win rate wyższy o 165%)                                  |
| dobry     | 60–75     | tuż po 'złotym okresie' – heurystyka                                                                      |
| normalny  | 75–90     |                                                                                                           |
| słaby     | 90–120    |                                                                                                           |
| krytyczny | ≥ 120     | Ebsta: szanse otwarte >2× ŚREDNIEGO cyklu mają ok. 3% szans; licz próg dynamicznie jako 2× własna mediana |

**Kontekst:** Średnie transakcje z nowymi klientami (np. pakiety sponsorskie, członkostwa instytucjonalne) · okres: kwartalnie · metoda: Ebsta x Pavilion 2025: nowi klienci średnio 91 dni, a top performerzy mają cykl krótszy o 42% (≈53 dni, wyliczenie własne) – uzasadnienie pasma 'optymalny'. Ebsta 2023: 'złoty okres' 61–90 dni dla średnich transakcji. · źródła: S27, S28

| Ocena     | Przedział | Uwagi                                                                                 |
| --------- | --------- | ------------------------------------------------------------------------------------- |
| optymalny | 0–75      | top performerzy Ebsta 2025: cykl krótszy o 42% od 91 dni ≈ 53 dni (wyliczenie własne) |
| dobry     | 75–91     | 'złoty okres' 61–90 dni                                                               |
| normalny  | 91–120    | od średniej Ebsta 2025 dla nowych klientów (91 dni)                                   |
| słaby     | 120–180   |                                                                                       |
| krytyczny | ≥ 180     | ≈2× średni cykl                                                                       |

**Kontekst:** Duże transakcje (partnerstwa strategiczne, projekty badawcze na zlecenie) · okres: półrocznie / rocznie · metoda: Ebsta 2023: 'złoty okres' 150–180 dni dla dużych transakcji. Próg krytyczny to heurystyka 2× cyklu. · źródła: S28

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| optymalny | 0–150     |                           |
| dobry     | 150–180   | 'złoty okres' 150–180 dni |
| normalny  | 180–240   |                           |
| słaby     | 240–360   |                           |
| krytyczny | ≥ 360     | ≈2× 'złoty okres'         |

**Kontekst:** Rozszerzenia i odnowienia u obecnych klientów · okres: kwartalnie · metoda: Ebsta x Pavilion 2025: rozszerzenia zamykane średnio w 52 dni (vs 91 dni dla nowych klientów). Pasma to heurystyka. · źródła: S27

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| optymalny | 0–40      |                            |
| dobry     | 40–52     |                            |
| normalny  | 52–75     | od średniej Ebsta (52 dni) |
| słaby     | 75–104    |                            |
| krytyczny | ≥ 104     | 2× średni cykl rozszerzeń  |

**Zastrzeżenia:**

- Ebsta segmentuje transakcje według wartości w USD na rynku głównie technologicznym. Przypisanie produktów think tanku do segmentów małe, średnie i duże jest heurystyczne.
- Klienci z sektora publicznego (zamówienia publiczne) i budżety roczne instytucji mogą wydłużać cykl niezależnie od jakości sprzedaży. Warto mieć dla nich osobny kontekst.
- Brak danych polskich. Ebsta 2025 raportuje skrócenie cykli o 9% r/r i 36% transakcji z poślizgiem.

### Źródła grupy: Zaangażowanie, wydarzenia, społeczność i CRM

| Id   | Źródło                                                                                                                                                                           | Wydawca                                                             | Data                                                                         | Weryfikacja          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| S1   | [2024 Mixpanel Benchmarks Report](https://mixpanel.com/wp-content/uploads/2024/01/2024_Benchmarks_Report.pdf)                                                                    | Mixpanel                                                            | 2024-01                                                                      | tak                  |
| S2   | [State of Digital Analytics 2026](https://mixpanel.com/content/benchmarks-2026)                                                                                                  | Mixpanel                                                            | 2026-10-13 (data z metadanych strony)                                        | tak                  |
| S3   | [DAU/MAU is an important metric to measure engagement, but here's where it fails](https://andrewchen.com/dau-mau-is-an-important-metric/)                                        | andrewchen.com (Andrew Chen, a16z)                                  | 2018-07 (data wywnioskowana; strona nie podaje daty, rok ze ścieżek obrazów) | tak                  |
| S4   | [Measuring SaaS Engagement](https://sacks.substack.com/p/measuring-saas-engagement)                                                                                              | David Sacks (Substack)                                              | 2020-11-23                                                                   | tak                  |
| S5   | [Measuring Your Net Promoter Score](https://nps.bain.com/about/measuring-your-net-promoter-score/)                                                                               | Bain & Company (nps.bain.com)                                       | b.d.                                                                         | tak                  |
| S6   | [What is a good Net Promoter Score?](https://uk.surveymonkey.com/curiosity/what-is-a-good-net-promoter-score/)                                                                   | SurveyMonkey                                                        | b.d. (dane benchmarkowe 2025; autor Jon Gitlin)                              | tak                  |
| S7   | [NPS Benchmarks](https://survicate.com/nps-benchmarks/)                                                                                                                          | Survicate                                                           | 2025-12-03                                                                   | tak                  |
| S8   | [What Is a Good Net Promoter Score? (NPS benchmarks by industry)](https://www.retently.com/blog/good-net-promoter-score/)                                                        | Retently (Greg Raileanu)                                            | 2026-04-15                                                                   | tak                  |
| S9   | [Don't use NPS for industry benchmarks](https://www.hellocustomer.com/blog/dont-use-nps-for-industry-benchmarks)                                                                 | HelloCustomer (Anna Pogrebniak)                                     | 2026-07-10                                                                   | tak                  |
| S10  | [Event Data Lab Report #05: One in Five Registered Attendees Won't Show Up](https://pheedloop.com/blog/event-data-lab-report-5)                                                  | PheedLoop                                                           | 2026-04-29                                                                   | tak                  |
| S11  | [Event Data Lab Report #06: Does Easier Registration Lead to More No-Shows?](https://pheedloop.com/blog/event-data-lab-report-06)                                                | PheedLoop                                                           | 2026-05-26 (addendum 2026-09-01)                                             | tak                  |
| S12  | [How to reduce no-shows at your event](https://www.eventbrite.com.au/blog/reduce-no-shows-ds0c/)                                                                                 | Eventbrite Blog (AU)                                                | 2018-08-28                                                                   | tak                  |
| S13  | [40+ Webinar Statistics B2B Marketers Should Know for 2025](https://www.goldcast.io/blog-post/2025-webinar-statistics-b2b-marketers-should-know)                                 | Goldcast (Alexander Bleeker)                                        | 2025-07-08                                                                   | tak                  |
| S14  | [2026 B2B Webinar Benchmark Report](https://www.goldcast.io/lp/webinar-benchmark-2026)                                                                                           | Goldcast                                                            | b.d. (strona bez daty publikacji, © 2026; dane 2025)                         | tak                  |
| S15  | [Webinar Statistics 2026](https://voxbooster.com/blog/webinar-statistics-2026)                                                                                                   | Voxbooster (VoxBooster Team)                                        | 2026-07-11                                                                   | częściowo            |
| S16  | [B2B Webinar Benchmarks: Conversion, Attendance, Personalization](https://www.marketingprofs.com/charts/2025/52917/b2b-webinar-benchmarks-conversion-attendance-personalization) | MarketingProfs (dane ON24 Webinar Benchmarks Report 2025)           | 2025                                                                         | nie da się sprawdzić |
| S17  | [Conversion Benchmark Report (2024)](https://unbounce.com/conversion-benchmark-report/)                                                                                          | Unbounce                                                            | 2024                                                                         | tak                  |
| S18  | [Entertainment conversion rate – Conversion Benchmark Report 2024](https://unbounce.com/conversion-benchmark-report/entertainment-conversion-rate/)                              | Unbounce                                                            | 2024                                                                         | tak                  |
| S19  | [UFI & Explori Global Exhibitor Insights 2017](https://www.ufi.org/wp-content/uploads/2017/11/UFI_Explori_Global_Exhib_Insights-2017-members.pdf)                                | UFI – The Global Association of the Exhibition Industry / Explori   | 2017-11                                                                      | tak                  |
| S20  | [Trade shows and the pandemic effect](https://www.explori.com/blog/trade-shows-and-the-pandemic-effect)                                                                          | Explori                                                             | 2022-11                                                                      | tak                  |
| S21  | [What is NPS and why should event professionals care?](https://www.explori.com/blog/nps_for_events)                                                                              | Explori                                                             | 2020-06                                                                      | tak                  |
| S22  | [Participation Inequality: The 90-9-1 Rule for Social Features](https://www.nngroup.com/articles/participation-inequality/)                                                      | Nielsen Norman Group (Jakob Nielsen)                                | 2006-10-08                                                                   | tak                  |
| S23  | [2025 Association Community Benchmark Report](https://go.higherlogic.com/hubfs/Reports/2025-Association-Community-Benchmark-Report_Higher-Logic.pdf)                             | Higher Logic                                                        | 2025 (dane VI 2024 – V 2025)                                                 | tak                  |
| S24  | [Lead-to-MQL Conversion Rate Benchmarks by Industry & Channel](https://firstpagesage.com/reports/lead-to-mql-conversion-rate-benchmarks-by-industry-channel-fc/)                 | First Page Sage                                                     | 2025-08-01                                                                   | tak                  |
| S25  | [MQL to SQL Conversion Rate By Industry: 2026 Report](https://firstpagesage.com/seo-blog/mql-to-sql-conversion-rate-by-industry/)                                                | First Page Sage                                                     | 2024-10-03 (modyfikacja 2025-12-23)                                          | tak                  |
| S26  | [Sales Funnel Conversion Rate Benchmarks: 2026 Report](https://firstpagesage.com/seo-blog/sales-funnel-conversion-rate-benchmarks-report/)                                       | First Page Sage (Evan Bailyn)                                       | 2026-08-10                                                                   | tak                  |
| S27  | [GTM Benchmarks Report 2025](https://www.joinpavilion.com/hubfs/Ebsta%20x%20Pavilion%202025%20GTM%20Benchmarks%20Report.pdf?hsLang=en)                                           | Ebsta x Pavilion                                                    | 2025-03                                                                      | tak                  |
| S28  | [2023 B2B Sales Benchmarks Report](https://www.ebsta.com/wp-content/uploads/2023/02/2023-B2B-Sales-Benchmark-Report.pdf)                                                         | Ebsta (we współpracy z Pavilion)                                    | 2023-02                                                                      | tak                  |
| S29  | [Are you letting online leads go cold?](https://www.smartcompany.com.au/marketing/20110704-are-you-letting-online-leads-go-cold/)                                                | SmartCompany (streszczenie badania Harvard Business Review)         | 2011-07-01                                                                   | tak                  |
| S30  | [The Short Life of Online Sales Leads](https://hbr.org/2011/03/the-short-life-of-online-sales-leads)                                                                             | Harvard Business Review (J. B. Oldroyd, K. McElheran, D. Elkington) | 2011-03                                                                      | tak                  |
| S31  | [Speed to Lead: Speed Is the Key to Lead Conversion](https://leandata.com/blog/speed-to-lead-speed-is-the-key-to-lead-conversion/)                                               | LeanData (Kim Peterson)                                             | 2026-04-15                                                                   | tak                  |
| S100 | [Webinar Benchmarks (Contrast Webinar Stats Report 2026)](https://www.getcontrast.io/learn/webinar-benchmarks)                                                                   | Contrast                                                            | 2026-04-16 (aktualizacja)                                                    | tak                  |

### Zmiany po weryfikacji: Zaangażowanie, wydarzenia, społeczność i CRM

- dau_mau / treści eksperckie: w notatce pasma 'krytyczny' dopisano minimum matematyczne ≈3,3% (1/30) – pasmo obejmuje w praktyce 3,3–5%; granice bez zmian (liczby S1 potwierdzone).
- dau_mau / B2B: notatkę pasma 'normalny' zmieniono z '(31%, 2025)' na '31% (Mixpanel, raport 2026; rok danych i definicja niepodane)'.
- dau_mau / B2B: w paśmie 'optymalny' i w metodzie dopisano za Sacksem 'u płacących klientów szczyty 40–45%, ok. 8 dni roboczych w miesiącu'; przy Mixpanel Technology 41% dopisano rok danych 2023, przy Mixpanel 2026 brak roku danych i definicji.
- dau_mau: caveat o danych europejskich Mixpanel 2026 uzupełniono o brak roku danych i definicji; dodano caveat o minimum matematycznym ≈3,3% (1/30).
- wau_mau / treści eksperckie: usunięto błąd logiczny (pasmo 'krytyczny' [0, 23) było praktycznie nieosiągalne, bo średnie WAU/MAU ≥ ok. 23%); nowe przedziały: krytyczny 0–30, słaby 30–38, normalny 38–50 (2 wizyty w różnych tygodniach ≈ 47%), dobry 50–65, optymalny ≥65; metoda opisuje minimum 7/30.
- wau_mau / B2B: dodano kotwicę wyprowadzoną z Sacksa (DAU/MAU 40% / DAU/WAU 60% ≈ WAU/MAU 67%, wyliczenie własne) i przesunięto granicę: dobry 60–67, optymalny ≥67 (zamiast ≥75); confidence pozostaje 'niska'.
- wau_mau: caveat o relacji do DAU/MAU uzupełniono – ok. 23% to praktyczne minimum, wartości niższe wskazują błąd definicji lub okien.
- nps / B2B: przebudowano przedziały – krytyczny −100–0, słaby 0–30, normalny 30–48 (obejmuje Survicate B2B 38 i P25 SurveyMonkey 42), dobry 48–72, optymalny ≥72 – bo dawne pasmo 'normalny' 42–48 było węższe niż błąd próby, a mediana B2B (38) wpadała w 'słaby'.
- nps / B2B: w notatkach i metodzie dopisano, że kwartyle SurveyMonkey dla usług profesjonalnych to 'consultancy as proxy'.
- nps: caveat o pasmach HelloCustomer zastąpiono dosłownym cytatem ('anything above 0' = good; 'above 20 is favourable, above 50 is excellent, above 80 is world class'); dodano caveat 'consultancy as proxy'.
- event_attendance_rate: w interpretacji PL/EN przykład niezweryfikowanego ON24 ('liczy oba') zastąpiono potwierdzonymi danymi Contrast (live 44–50% vs live lub on-demand 61%).
- event_attendance_rate / webinary live: usunięto wartości Contrast 41,6% (mediana) i 46,2% (średnia) – nie ma ich na stronie Contrast, którą Voxbooster (S15) podaje jako źródło; zastąpiono danymi pierwotnymi Contrast (S100: live 44–50%, start o 14:00 55%).
- event_attendance_rate / webinary live: nowe przedziały – krytyczny 0–20, słaby 20–30, normalny 30–44 (Goldcast 33%; Goldcast 2026 ok. 32%), dobry 44–55 (Contrast 44–50%), optymalny ≥55; source_ids: S15 i S16 zastąpiono S100 (S16 – HTTP 403, liczby ON24 niezweryfikowane).
- event_attendance_rate / live + on-demand: dodano potwierdzoną kotwicę Contrast 61% ('watch either live or on-demand') w paśmie 'dobry' 57–65; ON24 57%/60% oznaczono jako niezweryfikowane; metoda zmieniona na heurystykę o niskiej pewności kontekstu; source_ids S16 i S15 zastąpiono S100; granice bez zmian.
- event_attendance_rate: caveat o ON24 przepisano jako 'niezweryfikowane (403), nie jest kotwicą'; caveat Goldcast uzupełniono o niejednoznaczny rok danych; dodano caveat o usunięciu atrybucji Contrast 41,6/46,2 i o jednoplatformowym charakterze danych Contrast.
- no_show_rate / webinary: przedziały zsynchronizowano z poprawioną frekwencją live – krytyczny 80–100, słaby 70–80, normalny 56–70 (Goldcast ≈67%), dobry 45–56 (Contrast 44–50% → 50–56%), optymalny 0–45; usunięto notatkę 'mediana live Contrast 41,6% → no-show ~58%'; source_ids S15 i S16 zastąpiono S100.
- no_show_rate: dodano caveat z PheedLoop #05 o no-show według wielkości wydarzenia (50–149 / 150–499 / 500–999 / 1 000+: ok. 23 / 19 / 18 / 19%).
- event_registration_conversion / ruch mieszany: pasmo 'optymalny' ≥25 oznaczono jako heurystykę (kotwica ON24 25% niezweryfikowana, 403); usunięto S16 z source_ids; granice bez zmian.
- event_registration_conversion / własna baza: dodano zastrzeżenie Unbounce, że mediana ruchu e-mail 46,2% wynika głównie z loterii (sweepstakes); obniżono górę skali – normalny 20–30, dobry 30–45, optymalny ≥45 (zamiast 20–35 / 35–50 / ≥50); metoda: heurystyka o niskiej pewności.
- event_registration_conversion: caveat ON24 przepisano jako niezweryfikowany (403); dodano caveat o loteriach zawyżających medianę e-mail Unbounce.
- event_nps / uczestnicy stacjonarni: w notatce pasma 'normalny' i w metodzie zaznaczono, że wzrost o prawie 20 pkt (Explori 2022) nie wskazuje grupy respondentów – przesunięcie pasm to heurystyka; granice bez zmian.
- event_nps / partnerzy i wystawcy: metodę oznaczono 'Baseline 2017 (targi, wystawcy)' i dopisano potwierdzony rozkład (25% < −36, 50% < −17, 25% > 0) oraz zakaz przesuwania pasm o +20 jako faktu; pasma kwartylowe bez zmian.
- event_nps: caveat o danych 2017 uzupełniono o niejednoznaczność grupy respondentów w Explori 2022.
- community_active_member_rate / duża społeczność: usunięto wewnętrznie sprzeczną kotwicę 'XL: 10% loguje się w miesiącu' (1 297 logowań przy >50 tys. kont ≤2,6%); przy mianowniku 'wszystkie konta' nowe przedziały (heurystyka): krytyczny 0–1, słaby 1–3, normalny 3–6, dobry 6–10, optymalny ≥10 (zamiast 0–2 / 2–5 / 5–10 / 10–15 / ≥15); mianownik dopisano do nazwy kontekstu.
- community_active_member_rate: dodano caveat o niespójności danych XL w raporcie Higher Logic i o konieczności wyboru jednego mianownika.
- community_contributor_rate: dodano caveat o niejednoznacznym mianowniku wartości Higher Logic według rozmiaru i wieku (logowania vs unikalni logujący); pasma bez zmian.
- lead_response_time: dopisano caveat, że analiza 1,25 mln leadów (7× i 60×) objęła 29 firm B2C i tylko 13 B2B; caveat i notatka o Blazeo 2026 wskazują, że dane potwierdzono wyłącznie w omówieniu LeanData; pasma bez zmian.
- sales_cycle_length: we wzorze i interpretacji PL/EN doprecyzowano, że 3% szans dotyczy szans otwartych >2× ŚREDNIEGO cyklu (Ebsta), a próg pomocniczy liczy się jako 2× własna mediana.
- sales_cycle_length / małe transakcje: przedziały nie rozcinają już złotego okresu 31–60 dni – optymalny 0–60, dobry 60–75, normalny 75–90, słaby 90–120, krytyczny ≥120 (zamiast optymalny <45, dobry 45–60, normalny 60–90); notatkę progu krytycznego poprawiono z '≈2× górna granica złotego okresu' na '>2× ŚREDNIEGO cyklu ≈ 3% szans; licz dynamicznie jako 2× własna mediana'.
- sales_cycle_length / średnie transakcje: dopisano kotwicę top performerów (cykl krótszy o 42% od 91 dni ≈ 53 dni, wyliczenie własne) jako uzasadnienie pasma 'optymalny'; granice bez zmian.
- lead_to_mql_rate: caveat o jednym źródle uzupełniono o brak okresu danych ('built over 10 years'); dodano caveat o rozbieżności Entertainment 34% (S24) vs 19% (S26); pasma bez zmian, confidence 'średnia'.
- lower_better (no_show_rate, lead_response_time, sales_cycle_length): kolejność przedziałów znormalizowano rosnąco po wartościach (optymalny → krytyczny), tak by max jednego = min następnego; wartości bez zmian poza opisanymi poprawkami.
- S2 (Mixpanel 2026): datę oznaczono jako pochodzącą z metadanych strony.
- S2: excerpt uzupełniono o brak roku danych, definicji i metodologii segmentów.
- S3 (A. Chen): doprecyzowano, że data jest wywnioskowana ze ścieżek obrazów (strona jej nie podaje).
- S4 (Sacks): excerpt uzupełniono o 'all users at paid customers', 8 dni roboczych i zakres 40–45%.
- S5 (Bain): excerpt uzupełniono o NPS 'two times higher than the average company'.
- S6 (SurveyMonkey): '2025' opisano jako rok danych – artykuł nie ma daty publikacji.
- S6: w excerpt dopisano 'consultancy as proxy' przy kwartylach usług profesjonalnych.
- S9 (HelloCustomer): parafrazę w excerpt zastąpiono dosłownym cytatem.
- S10 (PheedLoop #05): excerpt uzupełniono o podział 17% (bezpłatne 22%, płatne 14%) i no-show według wielkości wydarzenia.
- S13 (Goldcast 2025): rok danych opisano jako niejednoznaczny ('głównie 2024') i dopisano brak metody liczenia 33%.
- S14 (Goldcast 2026): datę opisano jako brak daty publikacji (© 2026, dane 2025).
- S15 (Voxbooster): weryfikacja 'częściowo' – w excerpt oznaczono atrybucję Contrast 41,6/46,2 jako niepotwierdzoną i ON24 60% jako niepotwierdzone w źródle pierwotnym; uzupełniono datę 2026-07-11 i autora; źródło usunięte ze wszystkich source_ids.
- S16 (MarketingProfs/ON24): oznaczono jako 'nie da się sprawdzić' (HTTP 403, link niedostępny) i usunięto ze wszystkich source_ids (frekwencja, no-show, konwersja rejestracji).
- S17 (Unbounce): excerpt uzupełniono o brak kategorii wydarzeń i webinarów.
- S18 (Unbounce Entertainment): excerpt uzupełniono o zastrzeżenie, że mediana e-mail 46,2% wynika głównie z loterii.
- S19 (UFI/Explori 2017): excerpt uzupełniono o medianę −17 z wykresu rozkładu.
- S20 (Explori 2022): excerpt uzupełniono o brak wskazania grupy respondentów i wartości absolutnych.
- S21 (Explori): datę 'b.d.' zmieniono na '2020-06'.
- S23 (Higher Logic): excerpt uzupełniono o niespójność danych XL, medianę 12 040 kont i niejednoznaczne mianowniki.
- S24 (First Page Sage Lead→MQL): excerpt uzupełniono o brak okresu danych.
- S26 (First Page Sage 2026): excerpt uzupełniono o rozbieżność Entertainment 19% vs 34% (S24).
- S27 (Ebsta x Pavilion 2025): excerpt uzupełniono o wartość 18% z wykresu i liczbę ankietowanych.
- S28 (Ebsta 2023): excerpt doprecyzowano – 3% dotyczy szans >2× średniego cyklu.
- S29 (SmartCompany/HBR): excerpt uzupełniono o skład próby 1,25 mln leadów (29 B2C, 13 B2B).
- S31 (LeanData): dopisano autorkę i status źródła wtórnego (raport Blazeo niezweryfikowany).
- Dodano źródło S100 (Contrast, 'Webinar Benchmarks', aktualizacja 2026-04-16): live 44–50%, 61% live lub on-demand, start o 14:00 55%; podpięto do event_attendance_rate (live, live + on-demand) i no_show_rate (webinary).

## Uzupełnienie 2026-10-19: konteksty z pakietu Insider

Właściciel zdecydował 2026-10-19 („uspójnij”), jak pogodzić rejestr z pakietem wiedzy „Insider marketingowy” (`docs/benchmarki/insider-2026-10-19`, porównanie w `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md` §5.1.4). Zasada: ocenę w panelu daje wyłącznie kontekst tego rejestru. Przedział Insidera zostaje nowym kontekstem tylko wtedy, gdy opisuje inny kontekst istotny dla NES i ma rozkład, z którego da się wyprowadzić 5 pasm tą samą metodą (kwartyle; heurystyki oznaczone). W kontekście wspólnym wygrywa źródło o lepszej zgodności definicji, wiarygodności, świeżości i próbie. W pakiecie Insidera każdy rozstrzygnięty rekord ma pole `hub` (status, kontekst S6, powód).

Wynik dla 29 par i par pominiętych:

- **Nowe konteksty (2)**, wskaźnik SFCR (`signup_form_conversion_rate`):
  - `signup_form_conversion_rate.linkedin_lgf_content` – LinkedIn Lead Gen Forms, oferta treści: krytyczny < 2,3 · słaby 2,3–4,6 · normalny 4,6–10,8 · dobry 10,8–18,7 · optymalny ≥ 18,7;
  - `signup_form_conversion_rate.linkedin_lgf_demo` – LinkedIn Lead Gen Forms, prośba o demo lub kontakt handlowy: krytyczny < 0,5 · słaby 0,5–1 · normalny 1–2,2 · dobry 2,2–4,2 · optymalny ≥ 4,2.

  Granice to kwartyle Kiin Labs 2026 (P25, P50, P75; P90 w nocie), a próg krytyczny to połowa P25 (heurystyka, jak w CTR i CTOR). Insider podaje P50, P75 i P90 (przedziały `b-lgf-content`, `b-lgf-demo`, źródło Insidera 1196). P25 i liczbę kont odczytano ze strony źródła 2026-10-19. Etykiety Insidera (P50–P75 „normalny”) zastąpiono konwencją rejestru (P50–P75 „dobry”). Konteksty nie są domyślne dla żadnego segmentu: wybiera się je w panelu dla danych z LinkedIn Campaign Manager.

- **Zmienione konteksty: 0.** W każdym wspólnym kontekście (16 par) pasma rejestru zostają: MQL→SQL, win rate, cykl sprzedaży, czas reakcji na lead, NRR, churn miesięczny (i roczny po przeliczeniu 1 − (1 − m)^12), Quick Ratio, LTV/CAC, CAC payback, wypisy, odbicia twarde, skargi na spam, trial → płatny, aktywacja, DAU/MAU, NPS.
- **Punkty odniesienia:** pozostałe rekordy Insidera pokazuje się tylko jako odniesienie, bez oceny. Powody: inna definicja lub mianownik, kontekst spoza profilu NES, pojedynczy punkt bez rozkładu albo wartość zgodna z pasmem rejestru.

Nowe źródło w rejestrze grupy Lejek i konwersja (licznik źródeł: 189):

| Id                       | Źródło                                                                                                 | Wydawca                            | Data       | Weryfikacja      | Wiarygodność           | Pochodzenie                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------- | ---------- | ---------------- | ---------------------- | ---------------------------------------------- |
| kiin_lgf_benchmarks_2026 | [LinkedIn Lead Gen Forms Benchmarks 2026](https://kiin.co/research/linkedin-lead-gen-forms-benchmarks) | Kiin Labs (Kiin; autor: Phil Ilic) | 2026-09-15 | tak (2026-10-19) | B (dostawca narzędzia) | pakiet Insider, źródło 1196, dostęp 2026-10-09 |

## Uzupełnienie 2026-10-20: współczynnik zaangażowania GA4 i przegląd PPCR (I9b)

Decyzje właściciela 2026-10-20 (zgoda delegowana): Z-14-03 i Z-14-04 z dziennika wdrożenia huba (`docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` §14.5, wykonanie §22).

**Nowy wpis rejestru (Z-14-03): ER (GA4), `engagement_rate`, grupa Lejek i konwersja.** BI ma dziś źródło danych: warstwa semantyczna liczy metrykę `engagement_rate` z GA4 Data API (`semantic/snapshot.functions.ts`, metryka GA4 `engagementRate`), więc przedział `b-engr` pakietu Insidera dostał wpis z oceną zamiast samego punktu odniesienia. Wpis wskazuje metrykę BI (`metricId: engagement_rate`), kontekst domyślny dla segmentu `all`.

- `engagement_rate.site_all` – cała witryna, wszystkie sesje (GA4), miesięcznie: krytyczny < 25 · słaby 25–50 · normalny 50–55 · dobry 55–60 · optymalny ≥ 60.

  Granice 50 i 55 pochodzą z pakietu Insidera (`b-engr`: poniżej 50% słaby, 50–55% normalny, powyżej 55% dobry; źródło Insidera 1352) i ze źródła pierwotnego (Siege Media: mediana 51%, „50% i więcej – dobrze, powyżej 55% – mocno”). Źródło nie podaje kwartyli, więc dwa progi są heurystyką oznaczoną w nocie pasma: krytyczny 25 (połowa dolnej granicy normalnego, jak próg krytyczny kontekstów LinkedIn; poziom median kanałów niskiej intencji: social płatny 20,2%, nieprzypisany 20,8%) i optymalny 60 (poziom median kanałów wysokiej intencji w tym samym badaniu: wyszukiwanie płatne 60,4%, asystenci AI 60,3%, wyszukiwanie organiczne 63,4%). Pewność: średnia. Liczby i metodykę źródła odczytano ze strony 2026-10-20.

Nowe źródło w rejestrze grupy Lejek i konwersja (licznik źródeł: 190):

| Id                        | Źródło                                                                     | Wydawca     | Data       | Weryfikacja      | Wiarygodność                        | Pochodzenie                                    |
| ------------------------- | -------------------------------------------------------------------------- | ----------- | ---------- | ---------------- | ----------------------------------- | ---------------------------------------------- |
| siege_ga4_engagement_2026 | [What Is a Good GA4 Engagement Rate?](https://www.siegemedia.com/?p=46485) | Siege Media | 2026-08-26 | tak (2026-10-20) | B (agencja, dane własnych klientów) | pakiet Insider, źródło 1352, dostęp 2026-10-09 |

Rejestr po zmianie: 77 wpisów, 194 konteksty, 973 pasma, 174 źródła kanoniczne (`import-benchmarks.ts --check`: 8 plików zgodnych).

**Przegląd PPCR self-serve (Z-14-04), 2026-10-20: kontekst zostaje na źródle C (SaasDash).** Szukano pierwotnego benchmarku konwersji strony cennika self-serve SaaS ze źródła klasy A/B (badanie z metodologią, próbą i datą). Przejrzane:

- HockeyStack, „The State of Pricing, Demo, and Case Study Pages” (2025-12-15; 80 firm B2B SaaS, ponad 31 mln unikalnych odwiedzających): średnia konwersja stron cennika 3,8%, przy jawnej cenie 2,8%, bez jawnej ceny 4,6%. Odrzucone: średnia, nie mediana i nie kwartyle; licznik konwersji niezdefiniowany (w raporcie konwersja witryny = wysłany formularz), więc mierzy zapytania i dema, a nie trial, rejestrację ani zakup; strona cennika rozpoznawana po słowie „pricing” lub „quote”.
- ProductLed (ponad 600 firm, dane deklarowane) oraz ChartMogul 2026 i Lenny/OpenView/Pendo cytowane wtórnie przez Userpilot i Kirro: konwersja trialu do płatnego, inny wskaźnik i mianownik.
- Orbix Studio, SaaSHero, Daydream, Kirro, shno.co (zestawienia), SaasDash: dane dostawców lub kompilacje bez metodologii i próby.

Żadne źródło nie daje liczby weryfikowalnej dla tej samej definicji (odwiedzający cennik → trial, rejestracja lub zakup bez handlowca), więc pasma kontekstu `pricing_page_conversion_rate` (self-serve) zostają bez zmian. Następny przegląd: przy aktualizacji rejestru (`reviewBy`).
