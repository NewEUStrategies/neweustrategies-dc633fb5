# Słownik wskaźników: definicje, interpretacja i przedziały benchmarkowe

**Data:** 2026-10-18 · **Zastosowanie:** tooltipy, okna szczegółów i oceny w module panelu „Przychód i lejek” oraz w warstwie semantycznej BI.

## Metodologia

Sześć grup wskaźników zbadano na podstawie źródeł zewnętrznych, przede wszystkim z lat 2025–2026: Reuters Institute, INMA, Piano, Zuora, ChartMogul, Recurly, Paddle, SaaS Capital, KeyBanc, Benchmarkit, Mailchimp, Klaviyo, GetResponse, MailerLite, Validity, wymagania nadawców Google/Yahoo, Baymard, Bizzabo, Cvent, HubSpot, Bain i inne.

Każde źródło sprawdził osobny weryfikator: otworzył URL i porównał liczby. Status weryfikacji jest podany przy źródle. Poprawki weryfikatorów są wypisane przy wskaźnikach i zostaną naniesione na przedziały w rejestrze w kodzie.

**Skala ocen:** krytyczny → słaby → normalny → dobry → optymalny. Tam, gdzie źródło podaje kwartyle, przyjęto zasadę: poniżej P25 słaby, P25–P50 normalny, P50–P75 dobry, powyżej P75 optymalny. Metoda jest podana przy każdym kontekście. Przedziały oznaczone jako heurystyka nie mają twardego źródła i należy je kalibrować na własnych danych.

**Zakres:** 77 wskaźników; liczba źródeł: 172.

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

**Poprawki weryfikacji (do naniesienia):**

- Bez zmian. Definicja, normalizacja i zasady dotyczące rabatów zgodne z ChartMogul (08.09.2026).

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

**Kontekst:** Subskrypcje o niskim ARPA (< 25 USD/mies., typowo B2C) – wzrost ARR r/r (%) · okres: rocznie · metoda: kwartyle źródła (ChartMogul, LTM do 03.2023): dolny 2%, mediana 24%, górny 70% · źródła: S3

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–2       |       |
| normalny  | 2–24      |       |
| dobry     | 24–70     |       |
| optymalny | ≥ 70      |       |

**Kontekst:** Wydawcy cyfrowi / media subskrypcyjne – wzrost przychodu lub bazy subskrypcji cyfrowych r/r (%) · okres: rocznie · metoda: heurystyka z punktów odniesienia: Mather (USA, cyfrowe subskrypcje ok. −6% r/r), Zuora (+25% subskrybentów w 2 lata), NYT/WSJ +13% r/r, 100k Club +21% · źródła: S27, S26, S14

| Ocena     | Przedział | Uwagi                                                                    |
| --------- | --------- | ------------------------------------------------------------------------ |
| krytyczny | < -5      | poziom spadku cyfrowych subskrypcji w USA (Mather, Q2 2025)              |
| słaby     | -5–0      |                                                                          |
| normalny  | 0–10      | ok. 11–12% r/r to średnie tempo przyrostu subskrybentów w indeksie Zuora |
| dobry     | 10–20     | NYT i WSJ: +13% r/r                                                      |
| optymalny | ≥ 20      | agregat 100k Club: +21% (część danych nieaktualna)                       |

**Zastrzeżenia:**

- Ogólna mediana wzrostu prywatnych firm B2B SaaS spadła do 22% za 2025 r. (SaaS Capital 2026); kwartyle wg wielkości ARR pochodzą z edycji 2025 (dane za 2024), bo pełny raport 2026 jest dostępny po rejestracji.
- Benchmarki SaaS są w USD – porównując wzrost, przeliczaj ARR po stałym kursie, aby wahania PLN/USD nie fałszowały wyniku.
- Dla think tanku z przewagą B2C bardziej adekwatne są konteksty niskiego ARPA i mediów niż B2B SaaS.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst wydawców cyfrowych: (1) notę 'optymalny' ('agregat 100k Club: +21%') zmienić na 'porównanie list o różnym składzie (59 → 62 wydawców) i częściowo nieaktualnych danych – nie jest to wzrost organiczny'. Oprzeć próg 20% na heurystyce ok. 1,5 × NYT/WSJ (+13%) albo zostawić bez kotwicy. (2) Przy krytycznym −5% dopisać 'wydawcy prasowi USA, Q2 2025; nowszy raport Mather Q1 2026 (05.2026) jest za formularzem – zweryfikuj'. (3) Przy normalnym dopisać, że indeks Zuora obejmuje wszystkie branże, nie media. Kontekst niskiego ARPA (S3): dopisać w method 'dane LTM do 03.2023 – brak nowszych publicznych kwartyli wg ARPA'. Granice bez zmian.

### ARPA: Średni przychód na konto (klienta) (Average Revenue Per Account)

- **Rozwinięcie:** Average Revenue Per Account – średni miesięczny przychód powtarzalny na jedno konto klienta / Average Revenue Per Account
- **Wzór:** ARPA = MRR ÷ liczba aktywnych płatnych kont na koniec okresu (instytucja z wieloma licencjami = 1 konto); zmiana r/r = (ARPA_t − ARPA_t−12) ÷ ARPA_t−12 × 100%
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Średni miesięczny przychód na konto, kluczowy w B2B: rosnące ARPA oznacza skuteczny upsell, większe pakiety licencji lub lepszą realizację ceny. Czytaj w podziale na segmenty i razem z medianą – średnią łatwo zawyża kilka dużych instytucji. Pułapka: zmiana miksu (np. napływ tanich kont studenckich) obniża ARPA mimo zdrowego biznesu.
- **Interpretation (EN):** Average monthly revenue per account, key in B2B: rising ARPA signals successful upsell, larger seat packages or better price realisation. Read it by segment and alongside the median – a few large institutions easily inflate the mean. Pitfall: mix shifts (e.g. an influx of cheap student accounts) lower ARPA even when the business is healthy.

**Kontekst:** B2B – firmy i instytucje: zmiana ARPA r/r (%) · okres: rocznie · metoda: heurystyka; punkty odniesienia: ARPA firm najszybciej rosnących +82% (564→1 024 USD) na drodze 1→20 mln USD ARR, pozostałych +63%, 72% firm poprawiło ARPA o >10% (ChartMogul); rosnące ACV koreluje z szybszym wzrostem (SaaS Capital) · źródła: S4, S1

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < -10     |       |
| słaby     | -10–0     |       |
| normalny  | 0–5       |       |
| dobry     | 5–15      |       |
| optymalny | ≥ 15      |       |

**Kontekst:** Mieszany portfel B2C + B2B: zmiana ARPA r/r przy stałym miksie segmentów (%) · okres: rocznie · metoda: heurystyka; punkty odniesienia: standardowe ceny cyfrowe w UK +3% r/r (2026), ARPU NYT +0,7%, Newsquest −9% · źródła: S13, S14

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

**Poprawki weryfikacji (do naniesienia):**

- W method kontekstu B2B zmienić 'ARPA firm najszybciej rosnących +82%… pozostałych +63%' na 'ARPA firm, które doszły do 20 mln USD ARR (outliers), +82% (564 → 1 024 USD); u firm, które utknęły między 1 a 20 mln USD (normies), +63%'. Przedziały bez zmian.

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

**Kontekst:** Media cyfrowe B2C, Polska – ARPU na płacącego subskrybenta (PLN/mies.) · okres: miesięcznie · metoda: heurystyka; jedyny polski punkt odniesienia: szacunek górnej granicy dla Gazety Wyborczej ok. 19 zł/mies. (przychody cyfrowe z reklamą ÷ prenumeraty) oraz 78% subskrybentów w PL poniżej pełnej ceny · źródła: S25, S12

| Ocena     | Przedział | Uwagi                                                               |
| --------- | --------- | ------------------------------------------------------------------- |
| krytyczny | < 8       |                                                                     |
| słaby     | 8–12      |                                                                     |
| normalny  | 12–18     |                                                                     |
| dobry     | 18–25     | powyżej szacunku dla największego polskiego wydawcy cyfrowego       |
| optymalny | ≥ 25      | realne dla niszowych treści eksperckich z mocną propozycją wartości |

**Kontekst:** Zmiana ARPU r/r – B2C (%) · okres: rocznie · metoda: heurystyka z punktów odniesienia: NYT +0,7%, ceny standardowe UK +3%, Newsquest −9%, USA Today Co +27% (Q4) · źródła: S14, S13

| Ocena     | Przedział | Uwagi                                              |
| --------- | --------- | -------------------------------------------------- |
| krytyczny | < -10     |                                                    |
| słaby     | -10–0     | Newsquest −9%                                      |
| normalny  | 0–5       | NYT +0,7%; ceny standardowe UK +3%                 |
| dobry     | 5–15      |                                                    |
| optymalny | ≥ 15      | USA Today Co +27% w Q4 – efekt wygaszania promocji |

**Zastrzeżenia:**

- Przedziały poziomu ARPU to heurystyka z pojedynczych punktów odniesienia – kwartyle INMA są dostępne tylko w płatnym serwisie benchmarkowym.
- Szacunek polski jest zawyżony: licznik obejmuje reklamę cyfrową, mianownik to stan prenumerat na koniec kwartału.
- W Polsce 78% subskrybentów nie płaci pełnej ceny (DNR 2024), więc ARPU jest naturalnie niższe od cen katalogowych.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst Polski: w method usunąć '(przychody cyfrowe z reklamą ÷ prenumeraty)' i zastąpić: '18,1 mln zł przychodów cyfrowych dziennika w Q3 2025 ÷ 317,6 tys. prenumerat ÷ 3 ≈ 19 zł/mies.; Agora w tym komunikacie nie definiuje przychodów cyfrowych'. W caveats zmienić 'licznik obejmuje reklamę cyfrową' na 'licznik może obejmować reklamę cyfrową (definicja niezweryfikowana), a mianownik to stan na koniec kwartału'. Przedziały bez zmian, confidence 'niska'. Opcjonalnie dodać kontekst rynkowy z DNR 2026: za wiadomości online płaci w Polsce 11% (−2 pp r/r).

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

**Kontekst:** Subskrypcje B2C, ARPA < 25 USD/mies. (% m/m) · okres: miesięcznie (średnia 3-miesięczna) · metoda: kwartyle ChartMogul r/r (2% / 24% / 70%) przeliczone: 0,17% / 1,81% / 4,52% m/m · źródła: S3

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0       |       |
| słaby     | 0–0,17    |       |
| normalny  | 0,17–1,8  |       |
| dobry     | 1,8–4,5   |       |
| optymalny | ≥ 4,5     |       |

**Kontekst:** Wydawcy cyfrowi / media subskrypcyjne (% m/m) · okres: miesięcznie (średnia 3-miesięczna) · metoda: heurystyka: −5% / 10% / 20% r/r przeliczone na miesiąc (Mather −6% r/r; NYT +13%; 100k Club +21%) · źródła: S27, S14

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < -0,4    |       |
| słaby     | -0,4–0    |       |
| normalny  | 0–0,8     |       |
| dobry     | 0,8–1,5   |       |
| optymalny | ≥ 1,5     |       |

**Zastrzeżenia:**

- Sezonowość: Q1 jest najsilniejszy dla akwizycji, Q4 najsłabszy (ChartMogul Billing Report 2025) – porównuj także r/r.
- Wzrost m/m naturalnie spada ze skalą: u firm najszybciej rosnących z 16,7% przy 1 mln USD ARR do 5,1% przy 20 mln USD (ChartMogul Growth Levers).
- Przy małej bazie pojedyncza umowa instytucjonalna zmienia wynik o kilka punktów procentowych.

**Poprawki weryfikacji (do naniesienia):**

- W caveats zmienić 'u firm najszybciej rosnących z 16,7%… do 5,1%' na 'u firm, które doszły do 20 mln USD ARR (outliers ChartMogul): z 16,7% przy 1 mln USD do 5,1% przy 20 mln USD; normies przy 1 mln USD: 8,7% m/m'. W kontekście mediów i B2C dopisać, że kwartyle ChartMogul pochodzą z 2023 r. Granice bez zmian.

### NNMRR: Przyrost netto MRR (Net New MRR)

- **Rozwinięcie:** Net New MRR – przyrost netto miesięcznego przychodu powtarzalnego po uwzględnieniu utraty / Net New Monthly Recurring Revenue
- **Wzór:** Net New MRR = New MRR + Expansion MRR + Reactivation MRR − Contraction MRR − Churned MRR; względnie: Net New MRR ÷ MRR z początku miesiąca × 100%; efektywność: Net New MRR ÷ (New + Expansion + Reactivation MRR) × 100% = 1 − 1/QR
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Bilans przyrostu bazy w złotych: ile MRR faktycznie przybyło po odjęciu utraty. Wartość diagnostyczna leży w rozbiciu – ten sam wynik może wynikać z mocnej akwizycji i dużego churnu albo ze słabej akwizycji i świetnej retencji. Pułapka: raportowanie samej sumy bez składowych oraz liczenie zmian planów o tej samej cenie (MRR neutralny) jako ekspansji.
- **Interpretation (EN):** Net balance of the recurring base in currency: how much MRR was actually added after subtracting losses. Its diagnostic value lies in the decomposition – the same total can come from strong acquisition with heavy churn or weak acquisition with excellent retention. Pitfall: reporting only the total without components, or counting same-price plan switches (neutral MRR) as expansion.

**Kontekst:** Wczesny etap subskrypcji, ARR < 300 tys. USD – Net New MRR jako % MRR z początku miesiąca · okres: miesięcznie (średnia 3-miesięczna) · metoda: kwartyle ChartMogul r/r (−5% / 37% / 153%) przeliczone na miesiąc: −0,43% / 2,66% / 8,04%; granica słaby/normalny (1%) heurystyczna · źródła: S3

| Ocena     | Przedział | Uwagi                                      |
| --------- | --------- | ------------------------------------------ |
| krytyczny | < -0,43   | poniżej dolnego kwartyla – baza się kurczy |
| słaby     | -0,43–1   |                                            |
| normalny  | 1–2,66    |                                            |
| dobry     | 2,66–8    |                                            |
| optymalny | ≥ 8       |                                            |

**Kontekst:** Efektywność wzrostu – Net New MRR ÷ brutto pozyskany MRR (%) – wszystkie segmenty · okres: kwartalnie · metoda: przeliczenie progów SaaS Quick Ratio wg ChartMogul (<2 niski, 2–4 przeciętny, ≥4 wysoki) wzorem 1 − 1/QR · źródła: S8

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | < 0       | utrata większa niż pozyskanie (QR < 1) |
| słaby     | 0–30      | QR ok. 1–1,4                           |
| normalny  | 30–50     | QR 1,4–2                               |
| dobry     | 50–75     | QR 2–4                                 |
| optymalny | ≥ 75      | QR > 4                                 |

**Zastrzeżenia:**

- Reaktywacje raportuj osobno – u firm 1–20 mln USD ARR stanowiły 1,7–3,8% net-new MRR (ChartMogul); wysoki udział może oznaczać sezonowe powroty zamiast ciągłej subskrypcji.
- Przy planach rocznych churn ujawnia się skokowo w miesiącach odnowień – oceniaj sumy 3- lub 12-miesięczne.
- Klasyfikację ruchów (new/expansion/contraction/churn/reactivation/neutral) stosuj zgodnie z definicją ChartMogul, inaczej porównania z benchmarkami są niemiarodajne.

**Poprawki weryfikacji (do naniesienia):**

- (1) W kontekście efektywności (1 − 1/QR) zaznaczyć, że progi QR ChartMogul liczono bez reaktywacji, więc efektywność z reaktywacją w mianowniku nie jest w pełni porównywalna. (2) Caveat o reaktywacjach uzupełnić nowszymi danymi: ChartMogul Winbacks Report (21.04.2026): mediana winback 7% przy ARR < 500 tys. USD, 9% przy 0,5–10 mln USD; 45% powrotów w 30 dni, 66% w 90 dni. ChartMogul '30-day upsell window' (30.09.2026): 2,67% reaktywacji w 1. miesiącu po rezygnacji, > 5% w 3 miesiące. Recurly 2026: w B2C ok. 1 na 4 nowe zapisy to powracający subskrybenci. Wysoki udział reaktywacji w B2C jest więc normalny, nie musi być sygnałem alarmowym. Granice bez zmian.

### QR: Wskaźnik szybkości wzrostu SaaS (Quick Ratio) (SaaS Quick Ratio)

- **Rozwinięcie:** SaaS Quick Ratio – stosunek pozyskanego MRR do utraconego MRR (nie mylić z księgowym wskaźnikiem płynności szybkiej) / SaaS Quick Ratio (growth efficiency, not the accounting acid-test ratio)
- **Wzór:** QR = (New MRR + Expansion MRR [+ Reactivation MRR]) ÷ (Churned MRR + Contraction MRR); przy zerowej utracie wynik nieokreślony – pokazuj 'n/d'
- **Jednostka:** ratio · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Ile złotych nowego MRR przypada na każdy utracony złoty – mierzy jakość wzrostu, nie jego skalę. Wartość 4 to klasyczny próg zdrowego wzrostu młodej firmy B2B, ale wysoki wzrost potrafi maskować churn: przy QR = 4 i wzroście 15% m/m churn może sięgać 5% miesięcznie. Pułapka: QR z jednego miesiąca przy rocznych odnowieniach skacze – używaj okna kwartalnego lub rocznego.
- **Interpretation (EN):** How many units of new MRR are gained per unit lost – measures growth quality, not scale. A value of 4 is the classic threshold for healthy growth in a young B2B company, but fast growth can mask churn: with QR = 4 and 15% monthly growth, churn can still be 5% per month. Pitfall: a single-month QR jumps around with annual renewals – use a quarterly or annual window.

**Kontekst:** B2B SaaS / subskrypcje firm i instytucji (okno kwartalne) · okres: kwartalnie · metoda: progi ChartMogul (<2 niski, 2–4 przeciętny, ≥4 wysoki) i próg inwestycyjny 4 (M. Hamid); kontrola: przy wzroście ok. 20% r/r i GRR ok. 90% (KeyBanc/Sapphire 2025) QR ≈ 1 + 0,20/0,10 = 3 · źródła: S8, S9, S28

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

**Poprawki weryfikacji (do naniesienia):**

- (1) W method kontekstu B2B dopisać, że 20% wzrostu w KeyBanc/Sapphire to prognoza na 2025, nie wynik. (2) We wzorze zaznaczyć, że progi ChartMogul (< 2, 2–4, ≥ 4) liczono BEZ Reactivation MRR. Jeśli panel dodaje reaktywacje do licznika, pokazywać wariant zgodny z definicją ChartMogul do porównań z progami. Granice bez zmian.

### EXP %: Udział ekspansji w nowym MRR (Expansion Share of New MRR)

- **Rozwinięcie:** Expansion share – udział przychodu z rozszerzeń u obecnych klientów w całym pozyskanym MRR / Expansion MRR share of total new MRR
- **Wzór:** Udział ekspansji = Expansion MRR ÷ (New MRR + Expansion MRR [+ Reactivation MRR]) × 100% w okresie (Benchmarkit: Expansion ARR ÷ Total New ARR)
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Jaka część nowego przychodu pochodzi od istniejących klientów (wyższy plan, więcej licencji instytucjonalnych, dodatki, przejście z planu indywidualnego na firmowy). Rośnie naturalnie ze skalą i szerokością oferty; zbyt niski oznacza brak ścieżki rozwoju klienta, zbyt wysoki – słabnącą akwizycję nowych. Pułapka: liczenie zmiany z planu miesięcznego na roczny o tej samej wartości miesięcznej jako ekspansji.
- **Interpretation (EN):** Share of new revenue coming from existing customers (higher tier, more institutional seats, add-ons, moving from individual to corporate plans). It rises naturally with scale and product breadth; too low means no customer growth path, too high means weakening new-customer acquisition. Pitfall: counting a monthly-to-annual switch at the same monthly value as expansion.

**Kontekst:** B2B SaaS ogółem (%) · okres: rocznie · metoda: mediana Benchmarkit 2025 (40%, N=81; 25% w 2022) + heurystyka zakresu docelowego · źródła: S10, S11

| Ocena     | Przedział | Uwagi                                                         |
| --------- | --------- | ------------------------------------------------------------- |
| krytyczny | 0–10      |                                                               |
| słaby     | 10–25     | poniżej mediany z 2022 r. (25%)                               |
| normalny  | 25–40     |                                                               |
| dobry     | 40–55     | mediana 2024: 40%                                             |
| optymalny | 55–70     | poziom firm 50–100 mln USD ARR (58%) i >100 mln USD (67%)     |
| normalny  | 70–100    | ryzyko zależności od bazy – sprawdź akwizycję nowych klientów |

**Kontekst:** Mała firma subskrypcyjna, ok. 1 mln USD ARR (%) · okres: kwartalnie · metoda: heurystyka wokół punktów ChartMogul: 15,4% przy 1 mln USD ARR i 34,7% przy 20 mln USD ARR (firmy najszybciej rosnące) · źródła: S4, S3

| Ocena     | Przedział | Uwagi                                               |
| --------- | --------- | --------------------------------------------------- |
| krytyczny | 0–5       |                                                     |
| słaby     | 5–10      |                                                     |
| normalny  | 10–15     |                                                     |
| dobry     | 15–25     | najszybciej rosnące firmy przy 1 mln USD ARR: 15,4% |
| optymalny | 25–40     | poziom tych firm przy 20 mln USD ARR: 34,7%         |
| normalny  | 40–100    | na tym etapie zwykle sygnał słabej akwizycji        |

**Kontekst:** Media / B2C (upgrade planu, dodatki, przejście na plan instytucjonalny) (%) · okres: kwartalnie · metoda: heurystyka – brak publicznych benchmarków dla wydawców; uzasadnienie: w B2C o niskim ARPA ekspansja jest strukturalnie mała · źródła: S7

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

**Poprawki weryfikacji (do naniesienia):**

- (1) Kontekst B2B SaaS ogółem: w nocie 'optymalny' dopisać, że kohorta > 100 mln USD ARR (67%) to tylko 6 firm (Benchmarkit), a mediana 40% pochodzi z N = 81. (2) Kontekst małej firmy: nazwać '15,4% przy 1 mln USD ARR' jako dane firm, które później doszły do 20 mln USD (outliers). (3) Rozważyć zmianę okresu z kwartalnego na roczny lub kroczący 12-miesięczny. ChartMogul '30-day upsell window' (30.09.2026) pokazuje, że ok. 40% upgrade'ów planu w 1. roku następuje przy odnowieniu w 12. miesiącu, więc okno kwartalne będzie skokowe. Granice bez zmian.

### PR: Realizacja ceny (Price Realization)

- **Rozwinięcie:** Price Realization – odsetek ceny katalogowej faktycznie zrealizowany w przychodzie / Price Realization
- **Wzór:** PR = Σ przychód zafakturowany netto (po rabatach, kuponach, promocjach) ÷ Σ przychód według cennika katalogowego dla tych samych planów i okresów × 100%; wariant: realizacja podwyżki = faktyczny wzrost średniej ceny ÷ planowany wzrost × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Jaki procent ceny katalogowej faktycznie trafia do firmy – syntetyczna miara wycieku przez rabaty, oferty wejściowe i negocjacje. Spadek przy rosnącej sprzedaży oznacza kupowanie wolumenu ceną; rozbijaj na segmenty i kohorty (oferta wejściowa vs odnowienie po pełnej cenie). Pułapka: porównywanie z cennikiem sztucznie zawyżonym lub pomijanie rabatu za płatność roczną.
- **Interpretation (EN):** Share of the list price that actually reaches the company – a summary measure of leakage through discounts, introductory offers and negotiation. A decline while sales grow means buying volume with price; break it down by segment and cohort (introductory offer vs full-price renewal). Pitfall: benchmarking against an artificially inflated list price or ignoring the annual-prepay discount.

**Kontekst:** Media cyfrowe B2C (PL/UE) – cała aktywna baza (%) · okres: miesięcznie · metoda: heurystyka: miks rekomendowany przez Mather (50% pełna cena, 25% oferty wejściowe, 25% roczne) przy typowych rabatach daje ok. 72–75%; DNR 2024: 78% subskrybentów w Polsce i 41% w 20 krajach poniżej pełnej ceny; rabaty 1. roku w UK 17–89% · źródła: S16, S12, S13

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | < 50      |                                        |
| słaby     | 50–65     | np. FT w 1. roku: 279 vs 468 GBP ≈ 60% |
| normalny  | 65–75     |                                        |
| dobry     | 75–85     |                                        |
| optymalny | ≥ 85      |                                        |

**Kontekst:** B2B – umowy z firmami i instytucjami (%) · okres: kwartalnie · metoda: heurystyka z punktów odniesienia: średni rabat negocjacyjny ok. 10% (Vendr; 10–15% typowo) i 33,8% od cennika w korporacyjnych zakupach oprogramowania (Vertice, Q2 2026) · źródła: S19, S20

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

**Poprawki weryfikacji (do naniesienia):**

- Kontekst mediów B2C: w method zmienić 'miks rekomendowany przez Mather' na 'miks 50/25/25 cytowany przez Mather za N. Hunshikattim (Mather zastrzega: no one-size-fits-all)'. Zaznaczyć, że wynik 72–75% zakłada rabat ofert wejściowych rzędu 70–80%, typowy dla UK (S13); przy rabatach wejściowych ok. 50% ten sam miks daje ok. 79–82%. Granice bez zmian.

### ADD: Średni rabat (głębokość rabatu) (Average Discount Depth)

- **Rozwinięcie:** Average Discount Depth – średnia głębokość rabatu w transakcjach objętych rabatem lub kuponem / Average Discount Depth
- **Wzór:** ADD = Σ (cena katalogowa − cena zapłacona) ÷ Σ cena katalogowa, dla transakcji z rabatem lub kuponem w okresie × 100%; osobno: penetracja rabatów = transakcje z rabatem ÷ wszystkie transakcje × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Jak głęboko obniżamy cenę, gdy już dajemy rabat. Głębokie rabaty wejściowe przyspieszają akwizycję, ale przyciągają klientów o niższej wartości: na danych gazety rabat akwizycyjny 35% dawał klientów o ok. połowę niższej wartości długoterminowej. Pułapka: uśrednianie strukturalnego rabatu za płatność roczną z promocjami i ignorowanie penetracji – 10% dla wszystkich kosztuje więcej niż 50% dla nielicznych.
- **Interpretation (EN):** How deep the price cut is when a discount is granted. Deep introductory discounts speed up acquisition but attract lower-value customers: in newspaper data a 35% acquisition discount produced customers worth about half as much over the long term. Pitfall: averaging the structural annual-prepay discount with promotions and ignoring penetration – 10% for everyone costs more than 50% for a few.

**Kontekst:** Oferty wejściowe B2C – media i subskrypcje indywidualne (%) · okres: na kampanię / miesięcznie · metoda: heurystyka: Lewis 2006 (rabat 35% ≈ połowa wartości klienta), mediana rabatu kuponowego B2C ok. 30% (Recurly, dane 2017), rabaty 1. roku dużych wydawców UK 70–89% (2026) · źródła: S21, S22, S13

| Ocena     | Przedział | Uwagi                                                              |
| --------- | --------- | ------------------------------------------------------------------ |
| krytyczny | ≥ 50      | duzi wydawcy UK dają 70–89%, ale przy masowej skali i silnej marce |
| słaby     | 35–50     | ≥35%: ok. połowa wartości długoterminowej klienta                  |
| normalny  | 25–35     | mediana B2C ok. 30% (Recurly, 2017)                                |
| dobry     | 15–25     |                                                                    |
| optymalny | 0–15      |                                                                    |

**Kontekst:** B2B – rabaty negocjowane dla firm i instytucji (%) · okres: kwartalnie · metoda: heurystyka z punktów odniesienia: ok. 10% (Vendr, typowo 10–15%) i 33,8% od cennika w korporacyjnych zakupach IT (Vertice, Q2 2026) · źródła: S19, S20

| Ocena     | Przedział | Uwagi                                         |
| --------- | --------- | --------------------------------------------- |
| krytyczny | ≥ 30      | poziom korporacyjnych działów zakupów (33,8%) |
| słaby     | 20–30     |                                               |
| normalny  | 12–20     |                                               |
| dobry     | 5–12      | typowo 10–15% (Vendr/SaaStr)                  |
| optymalny | 0–5       |                                               |

**Kontekst:** Rabat za płatność roczną – strukturalny (%) · okres: przy zmianie cennika · metoda: heurystyka z przykładów: 'Save 20%' (ChartMogul), pogłębiony rabat 33% (FT Strategies), TechCrunch 150→99 USD ≈ 34% (Piano) · źródła: S5, S17, S15

| Ocena     | Przedział | Uwagi                                                                        |
| --------- | --------- | ---------------------------------------------------------------------------- |
| krytyczny | ≥ 40      |                                                                              |
| słaby     | 33–40     |                                                                              |
| normalny  | 25–33     | przykład pogłębionego rabatu 33–34%                                          |
| dobry     | 17–25     | typowe 'Save 20%'                                                            |
| optymalny | 0–17      | ≈ 2 miesiące gratis; jeśli udział planów rocznych spada, rozważ wyższy rabat |

**Zastrzeżenia:**

- Mediany rabatów Recurly (B2C 30%, Media & Entertainment 43%) pochodzą z badania z 2017 r.; strona źródłowa obecnie przekierowuje, a liczby odczytano z indeksu wyszukiwarki – traktuj je pomocniczo.
- Vendr mierzy różnicę między pierwszą ofertą a ceną końcową, Vertice – rabat od cennika; to różne definicje.
- Ceny dla studentów/NGO raportuj jako osobne plany cenowe, nie jako rabat promocyjny.

**Poprawki weryfikacji (do naniesienia):**

- (1) Kontekst 'Rabat za płatność roczną': usunąć z method i z noty przedziału 'normalny' kotwicę 'TechCrunch 150→99 USD ≈ 34% (Piano)'. To obniżka ceny planu rocznego, nie rabat względem 12 × ceny miesięcznej. Zostają 'Save 20%' (ChartMogul S5) i 'pogłębiony rabat 33%' (FT, S17). Opcjonalna nota przy 'optymalny': TechCrunch po obniżce ceny planu rocznego podwoił konwersję na plan roczny i zwiększył przychód z planów rocznych o 28% (Piano 2026). (2) Kontekst B2C: S22 (Recurly 2017) jest niesprawdzalny, bo URL nie zawiera badania. Usunąć S22 z source_ids, a notę przedziału 'normalny' 25–35 zmienić z 'mediana B2C ok. 30% (Recurly, 2017)' na 'heurystyka między rabatami 17–89% wydawców UK (S13) a progiem 35% z badania Lewisa (S21)'. Granice bez zmian, confidence 'niska'. (3) W caveats zastąpić zdanie 'Vendr mierzy różnicę między pierwszą ofertą a ceną końcową' zdaniem: 'SaaStr nie podaje definicji rabatu Vendr (dane z 2023 r.); Vertice mierzy rabat od cennika (Q2 2026)'. Usunąć lub oznaczyć jako niezweryfikowany caveat o medianach Recurly. (4) W interpretacji zmienić 'na danych gazety' na 'na danych gazety i internetowego sklepu spożywczego (Lewis 2006)'.

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
- Dla porównania: w masowej dystrybucji kuponów CPG w USA wykorzystano 1,3% wydanych kuponów (Inmar, 2024).
- W mianowniku licz także kody wygasłe; w przeciwnym razie wskaźnik jest zawyżony. Skrót CpRR celowo odróżnia od CRR (Customer Retention Rate).

**Poprawki weryfikacji (do naniesienia):**

- Bez zmian liczbowych; S23 i S24 potwierdzone. Opcjonalnie dopisać w caveats, że zakresy Yotpo dotyczą e-commerce, nie subskrypcji.

### APS: Udział planów rocznych (Annual Plan Share)

- **Rozwinięcie:** Annual Plan Share – udział subskrypcji z okresem rozliczeniowym 12 miesięcy lub dłuższym / Annual Plan Share
- **Wzór:** APS = aktywne płatne subskrypcje z okresem rozliczeniowym ≥ 12 mies. ÷ wszystkie aktywne płatne subskrypcje × 100%; wariant przychodowy: MRR z planów ≥ 12 mies. ÷ MRR całkowity × 100%
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Jaka część bazy jest zobowiązana na rok lub dłużej – wskaźnik stabilności przychodu i gotówki z przedpłat. Plany roczne retencjonują znacznie lepiej (Piano: po 4 latach aktywnych 18,0% subskrypcji rocznych vs 4,4% miesięcznych), ale zwykle konwertują wolniej i bywają tańsze. Pułapka: wymuszanie planów rocznych głębokimi rabatami kupuje retencję kosztem realizacji ceny, a na wczesnym etapie zbyt wysoki udział rocznych spowalnia wzrost.
- **Interpretation (EN):** Share of the base committed for a year or longer – an indicator of revenue stability and prepaid cash. Annual plans retain far better (Piano: after 4 years 18.0% of annual vs 4.4% of monthly subscriptions remain active) but usually convert more slowly and can be cheaper. Pitfall: pushing annual plans with deep discounts buys retention at the cost of price realisation, and at an early stage too high an annual share slows growth.

**Kontekst:** Media cyfrowe B2C – udział w aktywnej bazie subskrybentów (%) · okres: miesięcznie · metoda: średnie źródeł (Piano 2026: 49%, 181 serwisów; FT Strategies: 46%) + heurystyka zakresu docelowego · źródła: S15, S17, S16

| Ocena     | Przedział | Uwagi                                                         |
| --------- | --------- | ------------------------------------------------------------- |
| krytyczny | 0–15      |                                                               |
| słaby     | 15–30     |                                                               |
| normalny  | 30–40     |                                                               |
| dobry     | 40–45     |                                                               |
| optymalny | 45–60     | Piano 2026: 49% aktywnych i 49% przychodu; FT Strategies: 46% |
| dobry     | 60–75     |                                                               |
| normalny  | 75–100    | sprawdź ARPU i tempo akwizycji                                |

**Kontekst:** B2B – firmy i instytucje: udział ARR z planów rocznych (%) · okres: kwartalnie · metoda: punkty ChartMogul Billing Report 2025: wzrost stabilizuje się powyżej 25% ARR z planów rocznych; przy ARPA ≥ 1 tys. USD 55% ARR z rocznych · źródła: S5

| Ocena     | Przedział | Uwagi                                                                           |
| --------- | --------- | ------------------------------------------------------------------------------- |
| krytyczny | 0–10      |                                                                                 |
| słaby     | 10–25     |                                                                                 |
| normalny  | 25–45     | powyżej 25% wzrost się stabilizuje                                              |
| dobry     | 45–55     | szczyt 47% przy 3–8 mln USD ARR                                                 |
| optymalny | 55–100    | ARPA ≥ 1 tys. USD: 55% ARR z planów rocznych; instytucje preferują roczne umowy |

**Kontekst:** Wczesny etap, ARR < 1 mln USD, miks planów – udział ARR z planów rocznych (%) · okres: kwartalnie · metoda: heurystyka na podstawie ChartMogul Billing Report 2025 (mediana wzrostu firm opartych w 50–75% / ≥75% na planach rocznych spadła do 15% / 18%) · źródła: S5

| Ocena     | Przedział | Uwagi                                                                           |
| --------- | --------- | ------------------------------------------------------------------------------- |
| słaby     | 0–10      |                                                                                 |
| normalny  | 10–25     |                                                                                 |
| optymalny | 25–50     |                                                                                 |
| normalny  | 50–75     | mediana wzrostu takich firm: 15%                                                |
| słaby     | 75–100    | mediana wzrostu takich firm: 18%; najszybciej rosną firmy z <25% ARR z rocznych |

**Zastrzeżenia:**

- Udział wśród nowych subskrypcji jest dużo niższy niż w aktywnej bazie (Mather: 14% nowych subskrypcji to plany roczne, 71% miesięczne) – raportuj oba warianty.
- ARPU planów rocznych bywa niższe (Mather: 7,36 vs 12,64 USD), choć w danych Piano 2026 jest zbliżone (6,62 vs 6,57 USD).
- Najwięcej przejść z planu miesięcznego na roczny następuje w 2.–4. miesiącu subskrypcji (ChartMogul) – wtedy kieruj ofertę upgrade'u.

**Poprawki weryfikacji (do naniesienia):**

- (1) Kontekst mediów B2C, nota 'optymalny' 45–60: 'FT Strategies: 46%' zmienić na 'FT Strategies: 46% (próba 4 europejskich wydawców prasowych)'. (2) Kontekst wczesnego etapu (< 1 mln USD ARR): dopisać do method, że zdanie 'wzrost stabilizuje się powyżej 25%' ChartMogul odnosi do firm 1–10 mln USD ARR, a w górnym kwartylu firm wczesnego etapu najszybciej rosły te z < 25% ARR z planów rocznych. Etykietę 'słaby' dla 0–10% uzasadnić retencją: przy ARPA < 25 USD retencja klientów wynosi 62% (roczne) vs 41% (miesięczne), S5. Granice bez zmian. (3) Do caveats dodać sprzeczny punkt odniesienia: Recurly 2026 State of Subscriptions podaje, że plany roczne dają 50–60% wyższy przychód na użytkownika, podczas gdy Mather 2024 podaje ARPU niższe (7,36 vs 12,64 USD), a Piano 2026 zbliżone (6,62 vs 6,57 USD). Wynik zależy od cennika.

### Źródła grupy: Subskrypcje i przychód

| Id  | Źródło                                                                                                                                                                                                                                             | Wydawca                                                 | Data                                 | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | [2025 B2B Benchmarking Private SaaS Company Growth Rates (Research Brief 33)](https://www.saas-capital.com/wp-content/uploads/2025/06/RB33WS5-2025-B2B-Benchmarking-Private-SaaS-Company-Growth-Rates.pdf)                                         | SaaS Capital                                            | 2025-06                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S2  | [2026 Private B2B SaaS Company Growth Rate Benchmarks](https://www.saas-capital.com/research/private-saas-company-growth-rate-benchmarks/)                                                                                                         | SaaS Capital                                            | 2026-07-22                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S3  | [SaaS Benchmarks Report 2023 (2nd edition)](https://chartmogul.com/reports/saas-benchmarks-report/saas-benchmarks-report-2023.pdf)                                                                                                                 | ChartMogul                                              | 2023-05                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S4  | [Growth Levers: The Path from $1M to $20M ARR](https://chartmogul.com/reports/saas-growth-levers/)                                                                                                                                                 | ChartMogul (Kyle Poyar)                                 | 2025-11-05                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S5  | [SaaS Billing Report 2025: Billing is the invisible force behind your growth](https://chartmogul.com/reports/saas-billing-report/saas-billing-report-2025.pdf)                                                                                     | ChartMogul                                              | 2025-03                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S6  | [MRR (Monthly Recurring Revenue) – SaaS metrics](https://chartmogul.com/saas-metrics/mrr/)                                                                                                                                                         | ChartMogul                                              | 2026-09-08                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S7  | [Retention benchmarks and insights](https://chartmogul.com/blog/retention-benchmarks-and-insights/)                                                                                                                                                | ChartMogul (Sid Jain)                                   | 2023-03-01                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S8  | [SaaS Quick Ratio](https://chartmogul.com/blog/saas-quick-ratio/)                                                                                                                                                                                  | ChartMogul                                              | 2016-03-09                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S9  | [What is the optimal quick ratio for your SaaS startup? Is it 4?](https://tomtunguz.com/what-is-quick-ratio-hiding/)                                                                                                                               | Tomasz Tunguz                                           | 2015-11-03                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S10 | [2025 B2B SaaS Performance Metrics Benchmarks](https://www.hibob.com/wp-content/uploads/2025-SaaS-Performance-Metrics-Benchmarks.pdf)                                                                                                              | Benchmarkit (Ray Rike)                                  | 2025-06                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S11 | [What are the Latest SaaS Metrics Benchmarks Telling Us? 'The Trends are the Insights'](https://www.maxio.com/blog/2025-saas-benchmark-report-trends)                                                                                              | Maxio (Ray Rike)                                        | 2025-07-03                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S12 | [How much do people pay for online news and what might encourage others to pay (Digital News Report 2024)](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2024/how-much-do-people-pay-online-news-what-might-encourage-others-pay) | Reuters Institute for the Study of Journalism           | 2024-06-17                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S13 | [News subscription prices 2026 (UK digital subscription price tracker)](https://pressgazette.co.uk/media-audience-and-business-data/news-subcriptions-prices-2026/)                                                                                | Press Gazette                                           | 2026-02-12                           | częściowo: Potwierdzone: średnia zmiana cen standardowych 23 tytułów +3%, Telegraph i Mail+ 89%, Business Insider 81%, WSJ 80%, FT 279 vs 468 GBP, Bloomberg 115 vs 299 GBP. Błąd w excerpt: tekst mówi o 'six OTHER publications with discounts of at least 70%', czyli łącznie 10 tytułów z rabatem ≥ 70%, 'and ten more with discounts of at least 17%'. Excerpt należy poprawić na 'dziesięć tytułów ≥ 70% (cztery wymienione + sześć innych) i dziesięć kolejnych ≥ 17%'. Zakresy '70–89%' i '17–89%' w przedziałach pozostają poprawne. |
| S14 | [100k Club: biggest subscription news websites 2026](https://pressgazette.co.uk/paywalls/biggest-subscription-news-websites-2026/)                                                                                                                 | Press Gazette                                           | 2026-03-12 (aktualizacja 2026-06-25) | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S15 | [Monthly vs. annual subscriptions: why the answer isn't either-or](https://www.piano.io/resources/monthly-vs-annual-subscriptions-why-the-answer-isnt-either-or)                                                                                   | Piano                                                   | 2026-10-14                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S16 | [Decoding Subscription Value: Annual vs. Monthly Terms](https://www.mathereconomics.com/2024/07/08/decoding-subscription-value-annual-vs-monthly-terms/)                                                                                           | Mather Economics                                        | 2024-07                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S17 | [Are monthly subscribers practically worthless? (Part 2)](https://www.ftstrategies.com/en-gb/insights/part-2-are-monthly-subscribers-practically-worthless/)                                                                                       | FT Strategies                                           | 2024-06                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S18 | [Global Pricing Study 2025 (brochure)](https://www.simon-kucher.com/sites/default/files/media-document/2025-06/COR_GPS_2025_Brochure_Digital_Final.pdf)                                                                                            | Simon-Kucher                                            | 2025-06                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S19 | [Vendr: The Average SaaS Discount is About 10% (and Trending Down)](https://www.saastr.com/vendr-the-average-saas-discount-is-about-10-and-trending-down)                                                                                          | SaaStr (dane Vendr)                                     | 2023-07                              | częściowo: Potwierdzone: średni rabat ok. 10% 'and coming down', '10%-15% is where most of us land, typically', szczyt w 2020 i spadek od połowy 2022. Strona nie ma daty; dane z raportu Vendr za Q2 2023, więc są przestarzałe. Strona NIE definiuje rabatu Vendr, więc zdanie z caveats average_discount ('Vendr mierzy różnicę między pierwszą ofertą a ceną końcową') nie ma oparcia w źródle.                                                                                                                                           |
| S20 | [Average discount from list price (software pricing benchmarks)](https://www.vertice.one/insights/average-discount-from-list-price)                                                                                                                | Vertice                                                 | 2026-07                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S21 | [Customer Acquisition Promotions and Customer Asset Value](https://doi.org/10.1509/jmkr.43.2.195)                                                                                                                                                  | Journal of Marketing Research 43(2): 195–203 (M. Lewis) | 2006-05                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S22 | [Subscriber Acquisition Benchmarks (coupons and free trials)](https://recurly.com/research/subscriber-acquisition-benchmarks)                                                                                                                      | Recurly Research                                        | 2017-10                              | nie da się sprawdzić (link niedostępny): URL (z ukośnikiem i bez) zwraca ogólną stronę 'Subscription management resources, guides & reports'. Badania tam nie ma, a URL bloga z 2017 r. zwraca 404. Mediany rabatów kuponowych (B2C 30%, SaaS/OTT 37%, B2B 42%, Media & Entertainment 43%) są niesprawdzalne, pochodzą z 2017 r. i nie powinny kotwiczyć przedziałów. Limit wyszukiwań w tej turze się wyczerpał, więc nie dało się szukać kopii archiwalnej.                                                                                 |
| S23 | [What is redemption rate? (benchmarks and formula)](https://www.yotpo.com/blog/redemption-rate/)                                                                                                                                                   | Yotpo                                                   | 2025-09-29                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S24 | [As grocery costs increase, coupon use rises for the second straight year](https://couponsinthenews.com/2025/02/24/as-grocery-costs-increase-coupon-use-rises-for-the-second-straight-year/)                                                       | Coupons in the News (raport Inmar Intelligence)         | 2025-02-24                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S25 | [Wyniki finansowe Grupy Agora w 3 kwartale 2025 r.](https://strefainwestorow.pl/wiadomosci/20251119/wyniki-finansowe-grupy-agora-w-3-kwartale-2025-r)                                                                                              | Strefa Inwestorów                                       | 2025-11-19                           | częściowo: Potwierdzone (19.11.2025): blisko 317,6 tys. aktywnych płatnych prenumerat cyfrowych i blisko 18,1 mln zł przychodów cyfrowych dziennika w Q3 2025. NIEPOTWIERDZONE: tekst nie definiuje 'przychodów cyfrowych'. Dopisek '(z reklamą cyfrową)' nie ma oparcia w źródle, a 'wzrost o 1,8 p.p.' nie ma podanej bazy. Wyliczenie 18,1 mln ÷ 317,6 tys. ÷ 3 ≈ 19 zł/mies. jest arytmetycznie poprawne. Status 'górnej granicy ARPU' zależy od definicji, której nie zweryfikowano; strona agora.pl jest niedostępna dla narzędzia.     |
| S26 | [Zuora Subscription Economy Index 2025 (komunikat prasowy)](https://www.zuora.com/company/news/zuora-subscription-economy-index/)                                                                                                                  | Zuora                                                   | 2025-04-15                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S27 | [Q2 2025 U.S. Subscription Benchmarking Report (strona pobierania)](https://www.mathereconomics.com/download-mathers-q2-2025-u-s-benchmarking-report-2/)                                                                                           | Mather Economics                                        | 2025-08                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S28 | [2025 KeyBanc Capital Markets & Sapphire Ventures SaaS Survey](https://info.sapphireventures.com/2025-keybanc-capital-markets-sapphire-ventures-saas-survey)                                                                                       | KeyBanc Capital Markets / Sapphire Ventures             | 2025-11                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 2. Retencja i churn

### Logo churn (M): Miesięczny churn klientów (logo churn) (Monthly logo (customer) churn rate)

- **Rozwinięcie:** Churn – odpływ, utrata klientów. 'Logo' oznacza, że liczymy klientów lub konta, a nie przychód. M – okres miesięczny. / Churn – customer attrition. 'Logo' means it is counted in customers/accounts, not revenue. M – monthly period.
- **Wzór:** Płacący klienci aktywni na początku miesiąca, którzy odeszli w tym miesiącu (anulowanie, wygaśnięcie, nieodzyskana płatność), podzieleni przez płacących klientów na początku miesiąca, × 100%. Klienci pozyskani w trakcie miesiąca nie wchodzą ani do licznika, ani do mianownika. Przeliczenie na rok: 1 − (1 − churn_M)^12.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jaki odsetek płacącej bazy tracisz co miesiąc. Churn się składa: 2% miesięcznie to ok. 22% rocznie, a 4% miesięcznie to ok. 39% rocznie. Typowe pułapki: wliczanie trialistów i ofert za 1 zł zawyża wskaźnik. Średnia z całej bazy ukrywa wysoki odpływ nowych kohort. Przy planach rocznych churn jest 'schodkowy' (skupia się w miesiącach odnowień), dlatego oceniaj go na średniej kroczącej z 3–12 miesięcy i zawsze osobno dla każdego segmentu.
- **Interpretation (EN):** Shows what share of the paying base you lose each month. Churn compounds: 2% a month is about 22% a year, and 4% a month is about 39% a year. Common pitfalls: counting trialists and 1-unit intro offers inflates the rate, and a whole-base average hides the high attrition of new cohorts. With annual plans churn comes in steps (it clusters in renewal months), so judge it on a 3–12 month rolling average and always per segment.

**Kontekst:** Cyfrowe subskrypcje news/media B2C (płatne plany miesięczne, sprzedaż web, bez trialu) · okres: miesięcznie · metoda: Mediany i wartości 'best-in-class' Mather Economics (USA, 2022–2025), potwierdzone medianą Recurly (2026) i średnią ważoną Antenna (2025). Granica słaby/krytyczny to heurystyka. · źródła: mather_sep_2022, mather_q3_2023, mather_q1_2025, recurly_churn_benchmarks_2026, recurly_docs_churn_benchmarks, antenna_svod_2025, digiday_monthly_annual_2023, beehiiv_pressgazette_2026, inma_churn_growth_engine

| Ocena     | Przedział | Uwagi                                                                                                      |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| optymalny | < 2,7     | poziom 'Best-in-Class' według Mathera (2,70%/mies., 2022)                                                  |
| dobry     | 2,7–3,5   | 'Leading publisher' według Mathera to 3,1%/mies. (2023)                                                    |
| normalny  | 3,5–4,7   | mediany: Mather 3,53% (2022), 3,8% (2023), 4,62% (Q1 2025); Recurly digital media 4,14%; Antenna SVOD 4,6% |
| słaby     | 4,7–7     | powyżej median rynkowych; rocznie 44–58%                                                                   |
| krytyczny | ≥ 7       | heurystyka: powyżej 58% rocznie; poziom 'nieszczelnych' kategorii newsletterów (sport 7,76%, AI 13,33%)    |

**Kontekst:** SaaS / subskrypcje B2B SMB (ARPA poniżej ok. 1 tys. USD/mies., płatność kartą, plan miesięczny) · okres: miesięcznie · metoda: Górny kwartyl i mediana Recurly (lipiec 2026), mediany ChartMogul według ARPA (2022) i średnia Stripe za 2024 (via Churnkey). Granica krytyczna to heurystyka. · źródła: recurly_churn_benchmarks_2026, recurly_docs_churn_benchmarks, chartmogul_good_churn_2022, churnkey_involuntary_2025

| Ocena     | Przedział | Uwagi                                                                                 |
| --------- | --------- | ------------------------------------------------------------------------------------- |
| optymalny | < 1,8     | górny kwartyl Recurly dla SaaS: 1,78% lub mniej                                       |
| dobry     | 1,8–3     |                                                                                       |
| normalny  | 3–4,5     | mediany Recurly: SaaS 3,04–3,22%, usługi B2B 3,21–3,44%; średnia Stripe dla B2B 3,82% |
| słaby     | 4,5–6,5   | mediana ChartMogul przy ARPA < 25 USD to 6,1%                                         |
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
- Wartość INMA (mediana 4,6%/mies. dla krajowych marek newsowych w 4Q 2024) potwierdzono tylko w wynikach wyszukiwania, bo strona zwraca HTTP 403. Ma charakter pomocniczy.

**Poprawki weryfikacji (do naniesienia):**

- News B2C: wyrównaj granicę normalny/słaby z wersją roczną. 4,7%/mies. to 43,9%/rok, a logo_churn_annual ma tę granicę na 45% (≈4,86%/mies.). Zmień max 'normalny' na 4,9 i min 'słaby' na 4,9 (albo w wersji rocznej 45 → 44). W notatce 'normalny' dopisz, że Antenna 4,6% nie ma okresu na stronie, a INMA 4,6% jest niezweryfikowana (403). W metodzie dodaj, że Mather 'Best-in-Class' to średnia najlepszych rynków, a nie P75. Oznacz do aktualizacji po pobraniu raportu Mather Q1 2026 (V 2026). SaaS SMB: bez zmian, ale oznacz ChartMogul 6,1% jako dane z 2021/22.

### Logo churn (R): Roczny churn klientów (logo churn) (Annual logo (customer) churn rate)

- **Rozwinięcie:** Churn – odpływ klientów liczony w sztukach (logo). R – okres 12 miesięcy. Dla członkostw to 1 − wskaźnik odnowień (renewal rate). / Churn – customer attrition counted in accounts (logos). R – 12-month period. For memberships it equals 1 − renewal rate.
- **Wzór:** Klienci aktywni na początku 12-miesięcznego okresu, którzy nie są aktywni na jego końcu, podzieleni przez klientów aktywnych na początku okresu, × 100%. Alternatywnie: 1 − (1 − churn_M)^12. Dla członkostw: 1 − (odnowieni członkowie / członkowie, którym wygasła składka).
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Odsetek klientów z początku roku, których po 12 miesiącach nie ma w bazie. To główny wskaźnik dla umów rocznych B2B i składek członkowskich, gdzie churn miesięczny jest mało czytelny. Typowe pułapki: mieszanie planów miesięcznych i rocznych, liczenie od średniej bazy zamiast od bazy początkowej oraz 'netowanie' odejść powracającymi klientami. Reaktywacje raportuj osobno (winback).
- **Interpretation (EN):** Share of customers present at the start of the year who are gone 12 months later. It is the primary measure for annual B2B contracts and membership dues, where monthly churn is hard to read. Common pitfalls: mixing monthly and annual plans, dividing by an average instead of the opening base, and netting losses against returning customers. Report reactivations separately (winback).

**Kontekst:** News/media cyfrowe B2C – cała baza (mieszanka planów miesięcznych i rocznych) · okres: rocznie (kroczące 12M) · metoda: Przeliczenie progów miesięcznych 1 − (1 − m)^12, zweryfikowane danymi o kohortach (Piano 2021, FTI 2023). · źródła: mather_sep_2022, mather_q3_2023, mather_q1_2025, digiday_monthly_annual_2023

| Ocena     | Przedział | Uwagi                                                                  |
| --------- | --------- | ---------------------------------------------------------------------- |
| optymalny | < 28      | odpowiada poniżej 2,7%/mies.                                           |
| dobry     | 28–35     |                                                                        |
| normalny  | 35–45     | przeliczone mediany Mathera 3,53–4,62%/mies., czyli ok. 35–43% rocznie |
| słaby     | 45–58     | po 1. roku zostaje 45–46% subskrybentów miesięcznych (Piano 2021)      |
| krytyczny | ≥ 58      |                                                                        |

**Kontekst:** News/media cyfrowe B2C – plany roczne (churn przy pierwszym odnowieniu) · okres: rocznie (na odnowienie) · metoda: Mediana Piano (2021) i zakres FTI Consulting (2022/23). Granice słaby/krytyczny to heurystyka. · źródła: digiday_monthly_annual_2023, reporterzy_dnr2025, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                             |
| --------- | --------- | ----------------------------------------------------------------- |
| optymalny | < 20      | górny zakres FTI: 80% retencji po 52 tyg.                         |
| dobry     | 20–26     | mediana Piano 2021: po roku zostaje 74–75% subskrybentów rocznych |
| normalny  | 26–35     | FTI: 65–80%; Aftenposten: 71% nowych zostaje dłużej niż rok       |
| słaby     | 35–50     |                                                                   |
| krytyczny | ≥ 50      | heurystyka                                                        |

**Kontekst:** SaaS / subskrypcje B2B SMB (plany miesięczne, karta) · okres: rocznie · metoda: Przeliczenie kwartyli i median miesięcznych (Recurly 2026, ChartMogul 2022) oraz średnia roczna Stripe 2024. · źródła: recurly_churn_benchmarks_2026, chartmogul_good_churn_2022, churnkey_involuntary_2025

| Ocena     | Przedział | Uwagi                                                                    |
| --------- | --------- | ------------------------------------------------------------------------ |
| optymalny | < 20      | odpowiada górnemu kwartylowi Recurly (≤1,78%/mies.)                      |
| dobry     | 20–31     |                                                                          |
| normalny  | 31–43     | mediana Recurly SaaS 3,22%/mies. to ok. 32,5% rocznie; Stripe B2B: 38%   |
| słaby     | 43–55     | mediana ChartMogul przy ARPA < 25 USD: 6,1%/mies., czyli ok. 53% rocznie |
| krytyczny | ≥ 55      |                                                                          |

**Kontekst:** B2B mid-market (ACV ok. 12–100 tys. USD) · okres: rocznie · metoda: Heurystyka zakotwiczona w churnie ARR według długości umowy (KeyBanc 2024) i medianach GRR według ACV (SaaS Capital 2025). · źródła: keybanc_sapphire_2024, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                                                   |
| --------- | --------- | ----------------------------------------------------------------------- |
| optymalny | < 6       |                                                                         |
| dobry     | 6–10      | churn ARR przy umowach rocznych: 10%; ogółem: 7% (KeyBanc 2024)         |
| normalny  | 10–15     | mediana GRR 90–91% oznacza 9–10% utraty przychodu brutto (SaaS Capital) |
| słaby     | 15–22     |                                                                         |
| krytyczny | ≥ 22      |                                                                         |

**Kontekst:** B2B enterprise (ACV powyżej 100 tys. USD, umowy wieloletnie) · okres: rocznie · metoda: Heurystyka zakotwiczona w KeyBanc 2024 (churn według długości kontraktu) i SaaS Capital 2025 (GRR według ACV). · źródła: keybanc_sapphire_2024, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                 |
| --------- | --------- | ------------------------------------- |
| optymalny | < 3       | churn ARR przy umowach 3+ letnich: 3% |
| dobry     | 3–5       | GRR 95% dla ACV powyżej 250 tys. USD  |
| normalny  | 5–8       | churn ARR przy umowach 2-letnich: 6%  |
| słaby     | 8–12      |                                       |
| krytyczny | ≥ 12      |                                       |

**Kontekst:** Członkostwa / memberships (stowarzyszenia, kluby, płatne członkostwo think tanku) · okres: rocznie · metoda: Mediany MGI (2025 i 2026) jako środek przedziału 'normalny'. Pozostałe granice to heurystyka oparta na zakresach i4a. · źródła: mgi_2025_memberjungle, mgi_2026_i4a

| Ocena     | Przedział | Uwagi                                                        |
| --------- | --------- | ------------------------------------------------------------ |
| optymalny | < 10      | odnowienia 90%+ (top stowarzyszeń branżowych według i4a)     |
| dobry     | 10–15     |                                                              |
| normalny  | 15–20     | mediana MGI: 84% odnowień (2025) i 82% (2026)                |
| słaby     | 20–28     | poziom churnu nowych członków (odnowienia po 1. roku 72–74%) |
| krytyczny | ≥ 28      | niżej niż organizacje non-profit (typowo 60–75% odnowień)    |

**Zastrzeżenia:**

- Benchmarki MGI dotyczą głównie stowarzyszeń w USA. Członkostwo w think tanku z wydarzeniami i klubami jest bliższe towarzystwom zawodowym (typowo 75–85% odnowień według i4a).
- Dane MGI 2026 (82%/72%) pochodzą ze źródła wtórnego (i4a), bo oryginalnego raportu nie udało się otworzyć.
- Długie promocje (np. 52 tygodnie) przesuwają churn na moment powrotu do pełnej ceny. Według Mathera po 80 tygodniach aktywnych zostaje ok. 33% takiej kohorty.
- Planów miesięcznych i rocznych nie łącz w jednej liczbie bez wagi przychodowej. Raportuj je osobno.

**Poprawki weryfikacji (do naniesienia):**

- (1) W notatkach news B2C i plany roczne podaj dokładne wartości Piano 2021: 46% (miesięczne) i 74% (roczne) zamiast '45–46%' i '74–75%'. (2) Notatka 'słaby' (cała baza) miesza retencję nowej kohorty miesięcznej z churnem całej bazy. Dopisz '(kohorta nowych, nie cała baza)'. (3) Członkostwa, 'krytyczny': zmień 'niżej niż organizacje non-profit (typowo 60–75% odnowień)' na 'w zakresie typowym dla non-profit (60–75% odnowień według i4a)', bo 72% odnowień mieści się w tym zakresie. (4) Caveat o Matherze przeformułuj: kohorta 52-tygodniowa jest najlepsza spośród promocji, a mimo to ma ok. 33% aktywnych w 80. tygodniu. (5) Mediana ARR w próbie KeyBanc to 22,5 mln USD (2022) i 26 mln USD (2023), a dane churnu są za 2023.

### GRC (gross MRR churn): Churn przychodowy brutto (revenue churn) (Gross revenue churn (gross MRR churn))

- **Rozwinięcie:** GRC – Gross Revenue Churn: utrata przychodu powtarzalnego (MRR – Monthly Recurring Revenue, ARR – Annual Recurring Revenue) przez rezygnacje i obniżki planów, bez uwzględniania rozszerzeń. / GRC – Gross Revenue Churn: loss of recurring revenue (MRR – Monthly Recurring Revenue, ARR – Annual Recurring Revenue) from cancellations and downgrades, excluding expansion.
- **Wzór:** (MRR utracony przez anulacje + MRR utracony przez downgrade lub nowe rabaty) w okresie, podzielony przez MRR na początku okresu, × 100%. Dla B2B w ujęciu rocznym: GRC = 1 − GRR.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jaka część powtarzalnego przychodu z istniejących klientów znika przez rezygnacje i obniżki planów, zanim zadziałają upselle. Uzupełnia logo churn: jeśli odchodzą głównie mali klienci, churn przychodowy jest niższy od logo churnu, i odwrotnie. Typowe pułapki: podwyżki cen przy odnowieniu maskują odpływ klientów. Jednorazowe przychody (wydarzenia, sponsoring, raporty na zamówienie) nie powinny trafiać do MRR.
- **Interpretation (EN):** Shows what share of recurring revenue from existing customers is lost to cancellations and downgrades before any upsell. It complements logo churn: if mainly small customers leave, revenue churn is lower than logo churn, and vice versa. Common pitfalls: renewal price step-ups mask customer losses, and one-off revenue (events, sponsorship, commissioned reports) must not be booked as MRR.

**Kontekst:** B2B SaaS / subskrypcje instytucjonalne (ARR, ujęcie roczne) · okres: rocznie · metoda: Kwartyle GRR z KeyBanc 2024 (P25 82, mediana 89–91, P75 93–95) i Aleph×Benchmarkit CY2025 (76/84/91), przeliczone jako 1 − GRR. Kontrola: mediana SaaS Capital 2025 to 91%. · źródła: keybanc_sapphire_2024, aleph_benchmarkit_grr_2026, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                                    |
| --------- | --------- | -------------------------------------------------------- |
| optymalny | < 8       | powyżej P75 GRR (91–95%)                                 |
| dobry     | 8–12      | między P50 a P75: mediana GRR 88–91%                     |
| normalny  | 12–18     | między P25 a P50: Aleph×Benchmarkit 84%, KeyBanc P25 82% |
| słaby     | 18–25     | poniżej P25 (Aleph×Benchmarkit P25 GRR: 76%)             |
| krytyczny | ≥ 25      | heurystyka                                               |

**Kontekst:** B2C subskrypcje cyfrowe (niskie ARPA, MRR, ujęcie miesięczne) · okres: miesięcznie · metoda: Heurystyka: mediany logo churn news (Mather) powiększone o typowy downgrade. Górna granica według mediany gross MRR churn ChartMogul (2022) dla najniższego ARPA. · źródła: chartmogul_churn_cheatsheet_2022, mather_q3_2023, mather_q1_2025, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                        |
| --------- | --------- | ------------------------------------------------------------ |
| optymalny | < 3       |                                                              |
| dobry     | 3–4       |                                                              |
| normalny  | 4–5,5     | zbliżone do median logo churn news (3,5–4,6%) plus downgrade |
| słaby     | 5,5–8     |                                                              |
| krytyczny | ≥ 8       | mediana ChartMogul przy ARPA 0–10 USD to 8,9%/mies.          |

**Zastrzeżenia:**

- Dane ChartMogul o gross MRR churn pochodzą z 2022 r. Nowszych median dla B2C nie znaleziono.
- Piano: podwyżka ceny przy odnowieniu o 15–20% obniżała retencję o 5–8%, a podnosiła przychód o 6–14%. Spadek GRC może więc współistnieć z rosnącym logo churnem.
- Mediany KeyBanc (n=52–55, firmy o medianie ARR ok. 22,5 mln USD) i Aleph×Benchmarkit (n=226, dużo firm AI/PLG) różnią się o 5–7 pp. Przedziały je uśredniają.

**Poprawki weryfikacji (do naniesienia):**

- B2B: notatka 'dobry' podaje 'mediana GRR 88–91%', ale Aleph×Benchmarkit CY2025 ma medianę 84%, a 88% to ich wartość za 2024 i dla sales-led. Zmień na '89–91% (KeyBanc 2024E, SaaS Capital 2025); Aleph sales-led 88%'. W metodzie dodaj nowsze źródło: KeyBanc/Sapphire 2025 (16. edycja, 13.11.2025): GRR spadł do 86% (2023) i ma się zbliżać do 90%. Wspiera to granicę normalny/dobry przy GRC 12%. Liczby progów bez zmian. B2C: bez zmian, ale oznacz ChartMogul 8,9% jako dane z I–III 2022.

### NRR (NDR): Retencja przychodu netto (Net Revenue Retention (Net Dollar Retention))

- **Rozwinięcie:** NRR – Net Revenue Retention, NDR – Net Dollar Retention: dwie nazwy tego samego wskaźnika. To przychód zachowany od istniejących klientów, łącznie z rozszerzeniami i podwyżkami, po odjęciu obniżek i odejść. / NRR – Net Revenue Retention, NDR – Net Dollar Retention: two names for the same metric. Revenue retained from existing customers including expansion and price increases, net of downgrades and churn.
- **Wzór:** (ARR na początku okresu + ARR z rozszerzeń, upsellu, cross-sellu i podwyżek − ARR z downgrade − ARR utracony przez odejścia), licząc tylko klientów obecnych na początku okresu, podzielone przez ARR na początku okresu, × 100%. Standardowe okno to 12 miesięcy (np. MRR w grudniu wobec grudnia roku poprzedniego).
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Mówi, ile przychodu z kohorty klientów sprzed 12 miesięcy masz dziś. Wartość powyżej 100% oznacza, że baza rośnie bez nowej sprzedaży. NRR silnie koreluje ze wzrostem: według SaaS Capital 2025 firmy z NRR 110–120% rosły o ok. 30% r/r, a z NRR 100–110% o 21%. Typowe pułapki: wskaźnik nie obejmuje nowych klientów i bywa zawyżany jednorazową podwyżką lub jednym dużym klientem. W B2C rzadko przekracza 100%, dlatego porównuj go tylko w obrębie segmentu i przy tym samym oknie.
- **Interpretation (EN):** Tells you how much of the revenue from the customer cohort of 12 months ago you still have today. Above 100% means the base grows without new sales. NRR is strongly tied to growth: per SaaS Capital 2025, companies with 110–120% NRR grew about 30% YoY versus 21% at 100–110%. Common pitfalls: it excludes new customers and can be inflated by a one-off price rise or a single large account. In B2C it rarely exceeds 100%, so compare it only within a segment and over the same window.

**Kontekst:** B2B SaaS / subskrypcje B2B – ogółem · okres: rocznie (okno 12M) · metoda: Kwartyle Aleph×Benchmarkit CY2025 (P25 92, P50 102, P75 110), zweryfikowane z KeyBanc 2024E (96/101/109) i medianą SaaS Capital 2025 (101%). · źródła: aleph_benchmarkit_nrr_2026, keybanc_sapphire_2024, saascapital_retention_2025

| Ocena     | Przedział | Uwagi                                                                     |
| --------- | --------- | ------------------------------------------------------------------------- |
| krytyczny | < 85      | heurystyka; firmy z NRR poniżej 90% rosły w medianie o 15% (SaaS Capital) |
| słaby     | 85–92     | poniżej P25 (Aleph×Benchmarkit CY2025: 92%)                               |
| normalny  | 92–102    | P25–P50; mediana 101–102% (SaaS Capital, KeyBanc, Aleph×Benchmarkit)      |
| dobry     | 102–110   | P50–P75                                                                   |
| optymalny | ≥ 110     | powyżej P75 (110%)                                                        |

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

**Kontekst:** B2C subskrypcje cyfrowe (niskie ARPA) · okres: rocznie (okno 12M) · metoda: Heurystyka wokół górnego kwartyla ChartMogul 2023 (65,1% przy ARPA < 10 USD/mies.). Tylko 2,7% takich firm przekracza 100%. · źródła: chartmogul_retention_report_2023, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                      |
| --------- | --------- | ---------------------------------------------------------- |
| krytyczny | < 45      |                                                            |
| słaby     | 45–55     |                                                            |
| normalny  | 55–65     |                                                            |
| dobry     | 65–80     | górny kwartyl ChartMogul przy ARPA < 10 USD: 65,1%         |
| optymalny | ≥ 80      | osiągalne przy podwyżkach przy odnowieniu i niskim churnie |

**Zastrzeżenia:**

- Wysoka pewność dotyczy kontekstów B2B (SaaS Capital, KeyBanc, Aleph×Benchmarkit). Kontekst B2C to heurystyka o niskiej pewności.
- Mediany różnią się metodyką: SaaS Capital liczy na MRR grudzień do grudnia, KeyBanc na ARR. Aleph×Benchmarkit pokazuje, że model cenowy usage-based ma medianę 108%, a seat-based 98%.
- Dla think tanku NRR B2B rośnie głównie przez dodatkowe licencje, pakiety wydarzeń i raporty w abonamencie. Jednorazowe sponsoringi nie powinny podnosić NRR.

**Poprawki weryfikacji (do naniesienia):**

- (1) B2B ogółem: przy P75 Aleph zaznacz niespójność strony (110% vs 108%). Granicę 'optymalny' zostaw na 110 (zbieżna z KeyBanc 109 i SaaS Capital), ale w notatce wpisz 'P75 108–110%'. (2) B2C: dodaj nowsze źródło ChartMogul AI Retention Report (10.12.2025): mediana NRR dla B2C SaaS 49% (B2B SaaS 82%). Obecny przedział 'słaby' 45–55 zawiera medianę rynkową. Proponowane: krytyczny <40, słaby 40–50, normalny 50–65 (mediana B2C 49%; wydawca z churnem ok. 3,8–4,6%/mies. i podwyżkami ma ok. 57–65%), dobry 65–80 (P75 ChartMogul 2023 dla ARPA <10 USD: 65,1%), optymalny ≥80. Metoda: mediana ChartMogul 2025 i P75 ChartMogul 2023, pewność niska.

### GRR (GDR): Retencja przychodu brutto (Gross Revenue Retention (Gross Dollar Retention))

- **Rozwinięcie:** GRR – Gross Revenue Retention, GDR – Gross Dollar Retention: przychód zachowany od istniejących klientów po odjęciu odejść i obniżek, bez rozszerzeń. Maksimum to 100%. / GRR – Gross Revenue Retention, GDR – Gross Dollar Retention: revenue kept from existing customers after churn and downgrades, excluding expansion. Capped at 100%.
- **Wzór:** (ARR na początku okresu − ARR utracony przez odejścia − ARR utracony przez downgrade) / ARR na początku okresu × 100%. Rozszerzeń, upsellu i podwyżek nie wliczasz, więc wynik nie przekracza 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Odsetek przychodu powtarzalnego zachowanego po odjęciu odejść i obniżek, bez upselli. To miara 'szczelności' bazy i jakości produktu oraz obsługi. SaaS Capital traktuje GRR co najmniej 90% jako warunek konieczny ('table stakes') porównywalnych wyników w B2B. Typowe pułapki: wynik powyżej 100% oznacza, że liczysz NRR. W umowach wieloletnich odpływ ujawnia się skokowo przy końcu kontraktu, więc patrz na trend z kilku lat.
- **Interpretation (EN):** Share of recurring revenue kept after churn and downgrades, ignoring upsell. It measures how 'leak-proof' the base is and reflects product and service quality. SaaS Capital treats GRR of at least 90% as table stakes for peer-level B2B performance. Common pitfalls: a result above 100% means you are computing NRR, and with multi-year contracts losses show up in steps at contract end, so read the multi-year trend.

**Kontekst:** B2B SaaS / subskrypcje B2B – ogółem · okres: rocznie · metoda: Kwartyle Aleph×Benchmarkit CY2025 (76/84/91) i KeyBanc 2024E (82/91/95) oraz mediana SaaS Capital 2025 (91%). · źródła: aleph_benchmarkit_grr_2026, keybanc_sapphire_2024, saascapital_retention_2025

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

**Kontekst:** B2C subskrypcje cyfrowe (niskie ARPA) · okres: rocznie · metoda: Heurystyka wokół górnego kwartyla GRR ChartMogul 2023 dla ARPA < 50 USD/mies. (60–70%). · źródła: chartmogul_retention_report_2023

| Ocena     | Przedział | Uwagi                                               |
| --------- | --------- | --------------------------------------------------- |
| krytyczny | < 45      |                                                     |
| słaby     | 45–55     |                                                     |
| normalny  | 55–65     |                                                     |
| dobry     | 65–75     | górny kwartyl ChartMogul przy ARPA < 50 USD: 60–70% |
| optymalny | ≥ 75      |                                                     |

**Zastrzeżenia:**

- Aleph×Benchmarkit (CY2025) pokazuje spadek mediany GRR z 88% do 84%, a KeyBanc (2024E) 91%. Różnica wynika z próby: Aleph×Benchmarkit ma więcej firm PLG i AI-native, KeyBanc więcej firm z dużą sprzedażą enterprise.
- Kontekst B2C to heurystyka (pewność niska).
- SaaS Capital: umowy wieloletnie mają GRR 94%, roczne 90%, a miesięczne 89%. Długość kontraktu w ofercie B2B think tanku istotnie wpływa na GRR.

**Poprawki weryfikacji (do naniesienia):**

- (1) B2C: górny kwartyl (60–70%) leży dziś w przedziale 'dobry' (65–75) i 'normalny' (55–65), co jest sprzeczne z konwencją P75 = próg 'optymalny'. Mediany churnu news (3,8–4,62%/mies.) dają GRR ok. 57–63%. Proponowane: krytyczny <40, słaby 40–50, normalny 50–60, dobry 60–70, optymalny ≥70. W notatce dodaj ChartMogul 2025: GRR AI-native <50 USD 23%, 'o 20 pkt gorzej' niż SaaS B2B/B2C. (2) B2B ogółem: dodaj KeyBanc/Sapphire 2025 (GRR 86% w 2023, oczekiwane ok. 90%) jako nowszą kontrolę. Progi bez zmian.

### Invol. churn %: Udział churnu mimowolnego (Involuntary churn share)

- **Rozwinięcie:** Churn mimowolny (involuntary, pasywny) to utrata subskrypcji wskutek nieudanej płatności (wygasła lub zablokowana karta, brak środków, odmowa banku), a nie decyzji klienta. / Involuntary (passive) churn is losing a subscription because a payment failed (expired or blocked card, insufficient funds, bank decline), not because the customer chose to leave.
- **Wzór:** Subskrypcje zakończone z powodu nieodzyskanej płatności w okresie / wszystkie subskrypcje zakończone w okresie × 100%. Uzupełniająco: miesięczny churn mimowolny = odejścia z powodu płatności / baza płacących na początku miesiąca.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jaka część odejść wynika z nieudanych płatności, a nie z decyzji klienta. Wysoki udział to zwykle problem operacyjny (ponowienia, aktualizacja kart, przypomnienia), który naprawia się szybciej i taniej niż wartość produktu. Typowe pułapki: przy płatnościach bez automatycznego odnowienia (przelew, jednorazowy BLIK, faktura) churn mimowolny 'przebiera się' za brak odnowienia. Niski udział może też wynikać po prostu z bardzo wysokiego churnu dobrowolnego.
- **Interpretation (EN):** Shows what part of churn comes from failed payments rather than customer decisions. A high share is usually an operational problem (retries, card updating, reminders) that is faster and cheaper to fix than product value. Common pitfalls: with non-recurring payment methods (bank transfer, one-off BLIK, invoices) involuntary churn masquerades as non-renewal, and a low share may simply reflect very high voluntary churn.

**Kontekst:** News/media cyfrowe B2C (płatności kartowe cykliczne) · okres: miesięcznie lub kwartalnie (udział w odejściach okresu) · metoda: Rozkład udziałów z Piano (2024 i 2026; udział pasywny wyliczony z podanego udziału churnu aktywnego), Recurly 2026 (wyliczone: mimowolny / całkowity), Stripe 2024 (via Churnkey) i przypadków wydawców (WAN-IFRA 2018). · źródła: piano_benchmarks_2024, piano_benchmark_update_2026, recurly_churn_benchmarks_2026, churnkey_involuntary_2025, twipe_wanifra_2018

| Ocena     | Przedział | Uwagi                                                                                                                            |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| optymalny | < 15      |                                                                                                                                  |
| dobry     | 15–22     | Boston Globe obniżył udział z 50% do 20% (2018)                                                                                  |
| normalny  | 22–32     | Piano 2024: 29% churnu pasywnego; Stripe: digital goods 29%, B2C 24%; Piano 2026: ok. 25% w serwisach z aktywną prewencją churnu |
| słaby     | 32–45     | Recurly digital media: 1,59/4,14 ≈ 38%; Piano 2026: ok. 42% w serwisach bez aktywnej prewencji                                   |
| krytyczny | ≥ 45      | Seattle Times: 62% churnu cyfrowego to awarie kart (2018)                                                                        |

**Kontekst:** B2B SaaS / subskrypcje B2B (karta) · okres: miesięcznie lub kwartalnie · metoda: Średnie Stripe 2024 (via Churnkey) według modelu i ceny oraz udziały wyliczone z median Recurly 2026. Granice to heurystyka. · źródła: churnkey_involuntary_2025, recurly_churn_benchmarks_2026

| Ocena     | Przedział | Uwagi                                           |
| --------- | --------- | ----------------------------------------------- |
| optymalny | < 10      | Recurly ARPC powyżej 250 USD: 0,18/3,07 ≈ 6%    |
| dobry     | 10–16     | Stripe: B2B 16%, cena 1–10 tys. USD 15%         |
| normalny  | 16–24     | Stripe: SaaS 22%                                |
| słaby     | 24–35     | Recurly SaaS: 1,06/3,22 ≈ 33%                   |
| krytyczny | ≥ 35      | heurystyka; Stripe: produkty poniżej 10 USD 35% |

**Zastrzeżenia:**

- Recurly szacuje udział churnu mimowolnego na 20–40% całego churnu, a Churnkey twierdzi, że 'może łatwo przekroczyć 40%'. Rozrzut zależy od metod płatności i ceny.
- W Polsce popularne są BLIK, przelew i faktura. Bez tokenizacji karty lub cyklicznego BLIK churn mimowolny trzeba mierzyć jako 'nieopłacone odnowienie' albo 'przeterminowana faktura'. Publicznego benchmarku PL brak.
- Dane WAN-IFRA (Seattle Times, Boston Globe) są z 2018 r. i mają charakter historyczny.

**Poprawki weryfikacji (do naniesienia):**

- (1) Usuń z caveats zdanie 'Churnkey twierdzi, że może łatwo przekroczyć 40%'. Na stronie Churnkey go nie ma, a zakres 20–40% potwierdza Recurly 2026. (2) B2B, 'optymalny': udział dla ARPC >250 USD wynosi 5–6%, bo strona Recurly podaje łączny churn 3,07% albo 3,54%. (3) W notatkach Stripe zamień 'cena/produkty' na 'AOV (średnia wartość zamówienia)'. (4) Wartości Piano 2026 (25% i 42%) oznacz jako wyliczone (100 − udział aktywny). Progi bez zmian.

### Recovery rate: Skuteczność odzyskiwania nieudanych płatności (dunning recovery rate) (Dunning (failed-payment) recovery rate)

- **Rozwinięcie:** Dunning to proces odzyskiwania nieudanych płatności cyklicznych: ponowienia obciążeń (retries), automatyczna aktualizacja kart (account updater), e-maile i SMS-y oraz komunikat w produkcie. / Dunning is the process of recovering failed recurring payments: charge retries, card account updater, emails/SMS and in-product payment walls.
- **Wzór:** Wartość (lub liczba) nieudanych płatności cyklicznych odzyskanych w oknie odzyskiwania (np. 30 dni) / wartość (lub liczba) wszystkich nieudanych płatności cyklicznych w tym okresie × 100%. Licz kohortowo po zamknięciu okna i podawaj, czy liczysz po wartości, czy po liczbie.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Odsetek nieudanych płatności cyklicznych odzyskanych przed utratą subskrypcji. Według Recurly ok. 90% odzysków następuje w pierwszych 10 dniach, więc liczy się szybkość i inteligentne terminy ponowień. Typowe pułapki: dostawcy liczą różnie (wartość lub liczba, okno 14/30/60 dni, czy wliczać 'miękkie' odmowy rozwiązane przed kontaktem z klientem). Porównuj tylko przy tej samej definicji.
- **Interpretation (EN):** Share of failed recurring payments recovered before the subscription is lost. Per Recurly about 90% of recoveries happen in the first 10 days, so speed and smart retry timing matter. Common pitfalls: vendors define it differently (value vs count, 14/30/60-day window, whether soft declines resolved before contacting the customer count), so compare only like-for-like definitions.

**Kontekst:** Subskrypcje kartowe B2C i B2B (wszystkie metody łącznie: retries, account updater, e-mail/SMS, komunikat w produkcie) · okres: miesięcznie (kohorta nieudanych płatności, okno 30 dni) · metoda: Średnie deklarowane przez dostawców (Stripe, Churnkey/Stripe 2024, Recurly 2026) i przypadek FT (2025). Granice słaby/krytyczny to heurystyka. · źródła: stripe_billing, churnkey_involuntary_2025, recurly_failed_payment_2026, ftstrategies_retention_2025, churnkey_sor_2025

| Ocena     | Przedział | Uwagi                                                                                         |
| --------- | --------- | --------------------------------------------------------------------------------------------- |
| krytyczny | < 30      | heurystyka: brak inteligentnych ponowień lub komunikacji                                      |
| słaby     | 30–45     | heurystyka; poniżej poziomu samych domyślnych ponowień                                        |
| normalny  | 45–60     | Stripe: średnio 55%; same Smart Retries 51%; punkt wyjścia 'low-to-mid 50s' (Recurly)         |
| dobry     | 60–70     | FT: 66%                                                                                       |
| optymalny | ≥ 70      | Recurly: 71% po optymalizacji ('high 60s to low 70s'); Churnkey: ok. 70% przy trzech metodach |

**Zastrzeżenia:**

- Prawie wszystkie liczby pochodzą od dostawców narzędzi (Stripe, Recurly, Churnkey) i są deklaracjami bez pełnej metodologii.
- Churnkey (State of Retention 2025): kampanie e-mail/SMS same w sobie odzyskują średnio 42%, a kolejne e-maile dunningowe pojedynczo tylko 1,5–2,8%.
- Dla faktur B2B (przelew) zamiast tego wskaźnika licz odsetek faktur opłaconych w ciągu 30/60 dni od terminu.
- Publicznych benchmarków dla polskich operatorów płatności (PayU, Przelewy24, cykliczny BLIK) nie znaleziono.

**Poprawki weryfikacji (do naniesienia):**

- Usuń z caveats wartość '1,5–2,8% pojedyncze e-maile dunningowe' (nie ma jej na stronie Churnkey SOR 2025) albo oznacz ją jako niezweryfikowaną. Przy 'optymalny' dopisz, że 71% Recurly to jeden przypadek dużego detalisty, a nie średnia. Opcjonalnie dodaj do notatek: Stripe odzyskał 8,2 mld USD nieudanych płatności w 2025. Progi bez zmian.

### Save rate: Wskaźnik zatrzymań w ścieżce anulowania (save rate) (Cancellation-flow save rate)

- **Rozwinięcie:** Save rate to odsetek osób, które rozpoczęły rezygnację (cancellation flow) i zostały zatrzymane ofertą: pauzą, downgrade'em, rabatem lub zmianą planu. / Save rate is the share of people who started cancelling (cancellation flow) and were retained by an offer: pause, downgrade, discount or plan change.
- **Wzór:** Sesje anulowania zakończone przyjęciem oferty, po których klient jest nadal aktywny po 30 (lub 60) dniach / wszystkie rozpoczęte sesje anulowania × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
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

**Kontekst:** SaaS i aplikacje subskrypcyjne z dedykowanym narzędziem cancel flow (B2C, B2B SMB) · okres: miesięcznie · metoda: Heurystyka. Jedyne dane to deklaracje dostawców narzędzi (Churnkey: ratowanie 20–40% przychodu zagrożonego churnem), bez niezależnej weryfikacji. · źródła: churnkey_sor_2025

| Ocena     | Przedział | Uwagi                                                                                         |
| --------- | --------- | --------------------------------------------------------------------------------------------- |
| krytyczny | < 5       |                                                                                               |
| słaby     | 5–10      |                                                                                               |
| normalny  | 10–20     |                                                                                               |
| dobry     | 20–30     |                                                                                               |
| optymalny | ≥ 30      | deklaracje dostawców: Churnkey 'saving nearly two million subscriptions' przy ok. 3 mln sesji |

**Zastrzeżenia:**

- Kontekst SaaS/aplikacje ma niską pewność, bo opiera się wyłącznie na deklaracjach dostawców.
- Churnkey: wśród przyjętych ofert dominują rabaty (ok. 54%), pauza to ok. 19%, a zmiana planu ok. 7%. Rabaty obniżają ARPU, więc mierz też przychód netto z zatrzymanych.
- Prawo UE i PL ogranicza utrudnianie rezygnacji (zakaz dark patterns, np. art. 25 DSA dla platform; prawo konsumenckie, UOKiK). Ścieżkę anulowania warto skonsultować z prawnikiem.
- Według Recurly użycie pauzy wzrosło o 337% u czołowych sprzedawców. Pauzę warto mierzyć osobno (odsetek powrotów po pauzie).

**Poprawki weryfikacji (do naniesienia):**

- SaaS/aplikacje, 'optymalny': usuń kotwicę 'Churnkey nearly two million przy ok. 3 mln sesji'. Proporcja ok. 65% nie jest save rate według definicji wskaźnika (netto, aktywni po 30–60 dniach), a strona nie podaje save rate. Zostaw próg ≥30 jako 'heurystyka' (pewność niska). W caveats udział rabatów zapisz jako '53–54%' (strona podaje 53,9% i 53%). Progi news bez zmian, wszystkie kotwice zweryfikowane (FT 3→6%, Piano 6–16%, Star Tribune 18,5%).

### Winback rate: Wskaźnik odzyskania byłych klientów (winback / reaktywacja w 12 mies.) (Winback (reactivation) rate within 12 months)

- **Rozwinięcie:** Winback to odzyskanie klienta, który odszedł. Reaktywacja to ponowny zakup płatnej subskrypcji przez byłego subskrybenta. / Winback means recovering a churned customer. Reactivation is a former subscriber buying a paid subscription again.
- **Wzór:** Byli subskrybenci z kohorty odejść w miesiącu M, którzy ponownie wykupili płatną subskrypcję w ciągu 12 miesięcy / liczba odejść w kohorcie M × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, jaki odsetek osób, które odeszły w danym miesiącu, wraca do płatnej subskrypcji w ciągu roku. Byli subskrybenci to często największa pula potencjalnych klientów: według INMA mediana marka newsowa straciła 1,7 raza więcej subskrypcji, niż ma aktywnych. Typowe pułapki: powroty na głęboki rabat i 'seryjni churnerzy' zawyżają wynik, więc raportuj osobno powracających, którzy płacą pełną cenę po promocji.
- **Interpretation (EN):** Shows what share of a month's churned customers return to a paid subscription within a year. Former subscribers are often the biggest prospect pool: per INMA the median news brand has lost 1.7x more subscriptions than it has active. Common pitfalls: returns on deep discounts and serial churners inflate the rate, so report separately those who pay full price after the promo.

**Kontekst:** Subskrypcje cyfrowe B2C – plany miesięczne · okres: kohorta odejść; okno do 12 mies. · metoda: Średnie RevenueCat (SOSA 2025 i 2026) dla aplikacji subskrypcyjnych. Granice niższe niż średnia to heurystyka. · źródła: revenuecat_reactivation_2026, inma_past_subscribers_2025

| Ocena     | Przedział | Uwagi                                                        |
| --------- | --------- | ------------------------------------------------------------ |
| krytyczny | < 5       |                                                              |
| słaby     | 5–10      |                                                              |
| normalny  | 10–18     | RevenueCat SOSA 2025: 13,7%                                  |
| dobry     | 18–25     | RevenueCat SOSA 2026: 20,1% (zwykle 18–24%)                  |
| optymalny | ≥ 25      | np. aplikacje drogie: 28,9%; kategoria produktywności: 36,1% |

**Kontekst:** Subskrypcje cyfrowe B2C – plany roczne · okres: kohorta odejść; okno do 12 mies. · metoda: Zakres typowy RevenueCat (SOSA 2026). Pozostałe granice to heurystyka. · źródła: revenuecat_reactivation_2026

| Ocena     | Przedział | Uwagi                                       |
| --------- | --------- | ------------------------------------------- |
| krytyczny | < 2       |                                             |
| słaby     | 2–4       |                                             |
| normalny  | 4–6       | RevenueCat: typowo 4–6% dla planów rocznych |
| dobry     | 6–9       |                                             |
| optymalny | ≥ 9       |                                             |

**Zastrzeżenia:**

- RevenueCat dotyczy aplikacji mobilnych i web i nie podaje okna czasowego reaktywacji. Dla wydawców news brak publicznego benchmarku winback.
- INMA w modelowaniu użyło miesięcznej reaktywacji 4,8% zaczerpniętej z telekomunikacji, a nie z danych wydawców. Wartość potwierdzona tylko w wynikach wyszukiwania (strona zwraca HTTP 403).
- Do deduplikacji 'byłych' klientów potrzebna jest identyfikacja osoby (e-mail, login, token karty) w CRM.

**Poprawki weryfikacji (do naniesienia):**

- (1) Plany miesięczne B2C: 13,7% (SOSA 2025) zastąpiło 20,1% (SOSA 2026, typowo 18–24%). Przy konwencji 'średnia = granica normalny/dobry' proponowane: krytyczny <6, słaby 6–12, normalny 12–20, dobry 20–28, optymalny ≥28 (drogie plany miesięczne 28,9%). (2) Dodaj kontekst B2B SaaS z nowego źródła: ChartMogul 'The SaaS Winbacks Report' (O. Berezovsky, 21.04.2026, chartmogul.com/reports/saas-winbacks-report/): mediana winback rate 7–13% zależnie od ARR (<500 tys. USD 7%, 0,5–10 mln 9%, 10–30 mln 11%, >30 mln 13%); mediana czasu powrotu 38 dni; 66% powracających w 90 dni; ok. 10% po roku. Proponowane: krytyczny <4, słaby 4–7, normalny 7–10, dobry 10–13, optymalny ≥13 (heurystyka wokół median według ARR; raport nie definiuje okna ani mianownika, pewność niska). (3) INMA 1,7x pozostaje niezweryfikowane (403).

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

- Recurly nie podaje rozkładu według branż na stronie publicznej. Wartość 1 na 4 dotyczy całej sieci (ok. 76 mln subskrybentów).
- Brak publicznych danych dla wydawców news i dla Polski.

**Poprawki weryfikacji (do naniesienia):**

- Liczby zgodne (Recurly 2026: 'ok. 1 na 4'). Dopisz w caveats, że strona nie podaje okresu ani bazy tej wartości. Progi bez zmian.

### M1 retention: Retencja kohorty po 1 miesiącu (Month-1 cohort retention)

- **Rozwinięcie:** M1 to pierwszy miesiąc życia kohorty, czyli moment pierwszego odnowienia. Kohorta to grupa klientów, którzy zaczęli płacić w tym samym miesiącu. / M1 is the first month of a cohort's life (the first renewal). A cohort is the group of customers who started paying in the same month.
- **Wzór:** Subskrybenci z kohorty startu (miesiąc pierwszej płatnej transakcji) nadal aktywni i płacący po pierwszym odnowieniu (dzień 30–35) / liczebność kohorty × 100%. Triale i oferty wprowadzające licz jako osobne kohorty.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Odsetek nowej kohorty płacących, którzy przeszli pierwsze odnowienie. To najwcześniejszy sygnał dopasowania oferty i onboardingu. Churn jest najwyższy na samym początku: według Piano 13% wszystkich wyłączeń automatycznego odnowienia przypada na pierwszy dzień, a 40% na pierwsze 60 dni. Typowe pułapki: kohortę definiuj od pierwszej płatnej transakcji, a triale i oferty za 1 zł/1 € analizuj osobno, bo ich retencja jest wielokrotnie niższa.
- **Interpretation (EN):** Share of a new paying cohort that survives the first renewal. It is the earliest signal of offer fit and onboarding quality. Churn peaks at the very start: per Piano, 13% of all auto-renew disablements happen on day one and 40% within 60 days. Common pitfalls: define the cohort from the first paid transaction, and analyse trials and 1-unit intro offers separately because their retention is many times lower.

**Kontekst:** News/media cyfrowe B2C – plan miesięczny, sprzedaż web, cena pełna lub umiarkowany rabat · okres: kohorta miesięczna · metoda: Heurystyka: churn steady-state 3,5–4,7%/mies. (Mather) powiększony o typowo wyższy odpływ w pierwszych tygodniach (Piano 2024; WAN-IFRA/Die Welt 2018). Brak publicznej mediany M1 dla wydawców. · źródła: mather_q3_2023, mather_q1_2025, piano_benchmarks_2024, twipe_wanifra_2018, ftstrategies_retention_2025

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

**Poprawki weryfikacji (do naniesienia):**

- Kotwice zweryfikowane (RevenueCat M&E 41/58/72; Piano 13% i 40%; Piano 2026 triale ponad 60%; Reuters 2023). Progi bez zmian. Kontekst news pozostaje heurystyką o niskiej pewności.

### M3 retention: Retencja kohorty po 3 miesiącach (Month-3 cohort retention)

- **Rozwinięcie:** M3 to trzeci miesiąc życia kohorty, czyli udział klientów nadal aktywnych po 3 odnowieniach miesięcznych lub po ok. 90 dniach. / M3 is the third month of a cohort's life: the share still active after 3 monthly renewals or about 90 days.
- **Wzór:** Subskrybenci z kohorty startu nadal aktywni i płacący po 3 miesiącach (ok. 90. dzień) / liczebność kohorty × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Odsetek kohorty nadal aktywnej po 3 miesiącach. Po tym okresie odpływ zwykle się stabilizuje: w Die Welt ok. połowa nowych odchodziła w ciągu 3 miesięcy, potem churn spadał do 1–2% miesięcznie. Wskaźnik mierzy, czy subskrybent zbudował nawyk (newsletter, aplikacja, regularne wizyty). Typowe pułapki: porównuj kohorty z tą samą ofertą wejściową i kanałem, bo koniec 3-miesięcznej promocji tworzy sztuczny klif retencji.
- **Interpretation (EN):** Share of a cohort still active after 3 months. Attrition usually stabilises afterwards: at Die Welt about half of new subscribers left within 3 months, after which churn fell to 1–2% a month. It measures whether the subscriber built a habit (newsletter, app, regular visits). Common pitfalls: compare cohorts with the same entry offer and channel, because the end of a 3-month promo creates an artificial retention cliff.

**Kontekst:** News/media cyfrowe B2C – plan miesięczny (płatni) · okres: kohorta miesięczna · metoda: Heurystyka zakotwiczona w przypadku Die Welt (WAN-IFRA 2018), churnie steady-state wydawców (Mather) i rozkładzie wyłączeń auto-odnowienia (Piano 2024). · źródła: twipe_wanifra_2018, mather_q3_2023, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                                                          |
| --------- | --------- | -------------------------------------------------------------- |
| krytyczny | < 50      | Die Welt 2018: ok. połowa odchodziła w 3 mies. (oferty próbne) |
| słaby     | 50–65     |                                                                |
| normalny  | 65–75     |                                                                |
| dobry     | 75–85     |                                                                |
| optymalny | ≥ 85      |                                                                |

**Kontekst:** B2B SaaS / subskrypcje B2B – nowi klienci (logo) · okres: kohorta miesięczna · metoda: Górny kwartyl ChartMogul 2023 jako próg 'optymalny'. Pozostałe granice to heurystyka. · źródła: chartmogul_retention_report_2023

| Ocena     | Przedział | Uwagi                                                                              |
| --------- | --------- | ---------------------------------------------------------------------------------- |
| krytyczny | < 70      |                                                                                    |
| słaby     | 70–80     |                                                                                    |
| normalny  | 80–87     | ARPA < 10 USD: 87% (dla porównania)                                                |
| dobry     | 87–90     |                                                                                    |
| optymalny | ≥ 90      | górny kwartyl ChartMogul: 90%; 93% przy ARR 15–30 mln USD; 98% przy ARPA > 500 USD |

**Zastrzeżenia:**

- Brak aktualnej (2024–2026) publicznej mediany M3 dla wydawców news. Dane Die Welt są z 2018 r.
- Raport ChartMogul obejmuje kohorty 2021–2022.
- Dla B2B z umowami rocznymi M3 jest mało informatywny. Lepiej mierzyć aktywację i użycie licencji w pierwszych 90 dniach.

**Poprawki weryfikacji (do naniesienia):**

- (1) Notatka 'krytyczny' (news): usuń '(oferty próbne)', bo Twipe/WAN-IFRA o tym nie mówi. Zostaw 'Die Welt 2018: ok. połowa nowych odchodziła w 3 mies.'. (2) B2B: wartości 98% i 87% to segmenty według ASP (>500 i <10 USD/mies.), nie według ARPA. Popraw etykiety w notatkach. Progi bez zmian (P75 90% = próg 'optymalny', spójne).

### M12 retention: Retencja kohorty po 12 miesiącach (Month-12 cohort retention)

- **Rozwinięcie:** M12 to dwunasty miesiąc życia kohorty, czyli udział klientów nadal aktywnych po roku. Dla planów rocznych i członkostw to wynik pierwszego odnowienia (first-year renewal). / M12 is the twelfth month of a cohort's life: the share still active after a year. For annual plans and memberships it equals the first-year renewal rate.
- **Wzór:** Subskrybenci z kohorty startu nadal aktywni i płacący po 12 miesiącach / liczebność kohorty × 100%. Dla planów rocznych i członkostw: odnowieni po 1. roku / wszyscy, którym upłynął 1. rok.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Odsetek kohorty aktywnej po roku. To kluczowy wskaźnik dla LTV i jakości pozyskania. W news B2C plany roczne utrzymują po roku ok. 1,6 raza więcej subskrybentów niż miesięczne (Piano 2021: 74–75% wobec 45–46%). Typowe pułapki: przy planach rocznych M12 to wynik pierwszego odnowienia, więc nie porównuj go 1:1 z planami miesięcznymi. Długie promocje przesuwają klif retencji na moment powrotu do pełnej ceny.
- **Interpretation (EN):** Share of a cohort still active after a year, a key driver of LTV and acquisition quality. In B2C news, annual plans keep about 1.6x more subscribers after a year than monthly plans (Piano 2021: 74–75% vs 45–46%). Common pitfalls: for annual plans M12 is the first renewal outcome, so do not compare it 1:1 with monthly plans, and long promos push the retention cliff to the return to full price.

**Kontekst:** News/media cyfrowe B2C – plan miesięczny · okres: kohorta miesięczna, pomiar po 12 mies. · metoda: Mediana Piano (2021) i zakres FTI Consulting (2022/23). Skrajne granice to heurystyka. · źródła: digiday_monthly_annual_2023, piano_benchmarks_2024

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | < 30      |                            |
| słaby     | 30–40     |                            |
| normalny  | 40–50     | mediana Piano 2021: 45–46% |
| dobry     | 50–60     | FTI: ok. 50–60%            |
| optymalny | ≥ 60      |                            |

**Kontekst:** News/media cyfrowe B2C – plan roczny (pierwsze odnowienie) · okres: rocznie (pierwsze odnowienie) · metoda: Mediana Piano (2021), zakres FTI Consulting i przypadek Aftenposten (DNR 2025 via Reporterzy.info). · źródła: digiday_monthly_annual_2023, reporterzy_dnr2025

| Ocena     | Przedział | Uwagi                         |
| --------- | --------- | ----------------------------- |
| krytyczny | < 50      |                               |
| słaby     | 50–65     |                               |
| normalny  | 65–74     | FTI: od 65%; Aftenposten: 71% |
| dobry     | 74–80     | mediana Piano 2021: 74–75%    |
| optymalny | ≥ 80      | górny zakres FTI: 80%         |

**Kontekst:** Członkostwa – odnowienie po pierwszym roku (first-year renewal) · okres: rocznie · metoda: Mediany MGI (2025 i 2026) jako górna granica przedziału 'normalny'. Pozostałe granice to heurystyka. · źródła: mgi_2025_memberjungle, mgi_2026_i4a

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| krytyczny | < 55      |                                                  |
| słaby     | 55–65     |                                                  |
| normalny  | 65–74     | mediany MGI: 72% (2026), 74% (2025)              |
| dobry     | 74–82     |                                                  |
| optymalny | ≥ 82      | na poziomie mediany odnowień całej bazy (82–84%) |

**Kontekst:** B2B SaaS / subskrypcje B2B – nowi klienci (logo) · okres: kohorta miesięczna, pomiar po 12 mies. · metoda: Górne kwartyle ChartMogul 2023 jako progi 'dobry' i 'optymalny'. Niższe granice to heurystyka. · źródła: chartmogul_retention_report_2023

| Ocena     | Przedział | Uwagi                                     |
| --------- | --------- | ----------------------------------------- |
| krytyczny | < 50      |                                           |
| słaby     | 50–60     |                                           |
| normalny  | 60–70     |                                           |
| dobry     | 70–77     | górny kwartyl ChartMogul: 70%             |
| optymalny | ≥ 77      | górny kwartyl przy ARR 15–30 mln USD: 77% |

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
- Mather (Q2 2025, 86 marek): kohorta z 52-tygodniową ofertą wprowadzającą ma ok. 33% aktywnych w 80. tygodniu. Długie promocje mierz w horyzoncie powyżej 12 mies.
- Dane z aplikacji (RevenueCat) są znacznie niższe niż dla subskrypcji web wydawców i służą tylko jako dolny punkt odniesienia.
- Według INMA (wynik wyszukiwania, strona zwraca HTTP 403) mediana czasu życia subskrypcji news wynosi ok. 21 mies. Według Beehiiv średni czas życia subskrybenta płatnego newslettera newsowego to 18 mies.

**Poprawki weryfikacji (do naniesienia):**

- (1) News, plan miesięczny i roczny: podaj Piano 2021 jako 46% i 74%, a nie 45–46% i 74–75%. (2) B2B SaaS (logo): górny kwartyl ChartMogul (70%) jest dziś dolną granicą 'dobry', co jest sprzeczne z konwencją P75 = próg 'optymalny' stosowaną w M3. Proponowane: krytyczny <45, słaby 45–55, normalny 55–62, dobry 62–70, optymalny ≥70 (77% przy ARR 15–30 mln USD jako poziom ambitny). (3) Caveat o Matherze: kohorta 52-tygodniowa jest najlepsza spośród promocji (ok. 33% aktywnych w 80. tygodniu). (4) Wartość INMA (21 mies.) jest niezweryfikowana (403), a Beehiiv 18 mies. jest potwierdzone.

### Źródła grupy: Retencja i churn

| Id                               | Źródło                                                                                                                                                                                                                                   | Wydawca                                                                        | Data                                                            | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recurly_churn_benchmarks_2026    | [Churn rate benchmarks (Explore the data)](https://www.recurly.com/research/churn-rate-benchmarks)                                                                                                                                       | Recurly Research                                                               | 2026-07 (dane sieci Recurly, lipiec 2026)                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| recurly_docs_churn_benchmarks    | [Subscriber churn benchmarks](https://docs.recurly.com/docs/subscriber-churn-benchmarks)                                                                                                                                                 | Recurly Docs                                                                   | b.d. (dostęp 2026-10-18)                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| saascapital_retention_2025       | [2025 B2B SaaS Retention Benchmarks (Research Brief 32)](https://www.saas-capital.com/wp-content/uploads/2025/09/RB32WS1-2025-B2B-SaaS-Retention-Benchmarks.pdf)                                                                         | SaaS Capital                                                                   | 2025-09-18                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| keybanc_sapphire_2024            | [2024 KeyBanc Capital Markets & Sapphire Ventures SaaS Survey (15th Annual)](https://www.cfodesk.co.il/wp-content/uploads/2024/10/2024_kbcm_sapphire_saas_survey.pdf)                                                                    | KeyBanc Capital Markets / Sapphire Ventures                                    | 2024-10                                                         | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| aleph_benchmarkit_grr_2026       | [Gross revenue retention (GRR) benchmarks (2026) – 2026 Aleph × Benchmarkit SaaS & AI Performance Benchmarks](https://www.getaleph.com/answers/gross-revenue-retention-saas-2026)                                                        | Aleph / Benchmarkit                                                            | 2026-06-01 (raport); strona aktualizowana 2026-10               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| aleph_benchmarkit_nrr_2026       | [Net revenue retention (NRR) benchmarks (2026) – 2026 Aleph × Benchmarkit SaaS & AI Performance Benchmarks](https://www.getaleph.com/answers/net-revenue-retention-saas-2026)                                                            | Aleph / Benchmarkit                                                            | 2026-06-01 (raport); strona aktualizowana 2026-10               | częściowo: Potwierdzone: n=230, CY2025, mediana 102%, P25 92% (2024: 95%), usage-based 108% vs seat-based 98%, ACV <5 tys. USD 98%, 25–50 tys. USD 105%, <5 mln USD ARR 94%, >100 mln USD 103%. Niespójność na stronie: raz 'Top-quartile companies reach 110%', a raz 'the 75th percentile eased from 110–111% to 108%'. Przy P75 trzeba to zaznaczyć ('108–110%') albo przyjąć ostrożniej 108%.                                                                                                                                                                                                                                                                                                             |
| chartmogul_retention_report_2023 | [SaaS Retention Report](https://chartmogul.com/saas-retention-report/)                                                                                                                                                                   | ChartMogul (Sid Jain)                                                          | 2023-11-01                                                      | częściowo: Potwierdzone: ponad 2100 firm, 1.11.2023; górny kwartyl NRR 65,1% (ARPA <10 USD) i 109,3% (>500 USD); 2,7% firm z ARPA <10 USD ma NRR >100%; górny kwartyl GRR 60–70% (ARPA <50 USD) i 90%+ (>500 USD); nowi klienci, górny kwartyl: 90% po 3 mies. i 70% po 12 mies.; przy ARR 15–30 mln USD 93% i 77%. Poprawka: wartości 98% i 87% po 3 mies. raport podaje według ASP (średniej ceny sprzedaży) >500 i <10 USD, a nie według ARPA. NOWSZE ŹRÓDŁO: ChartMogul 'AI Retention Report' (Kyle Poyar, 10.12.2025, chartmogul.com/reports/saas-retention-the-ai-churn-wave/): mediana NRR dla B2C SaaS 49%, dla B2B SaaS 82% (górny kwartyl 97%), firmy z co najmniej 250 tys. USD ARR, dane za 2025. |
| chartmogul_good_churn_2022       | [What's a good customer churn rate?](https://chartmogul.com/blog/good-customer-churn-rate/)                                                                                                                                              | ChartMogul (Sid Jain)                                                          | 2022-02-23                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| chartmogul_churn_cheatsheet_2022 | [Churn cheat sheet](https://chartmogul.com/resources/churn-cheat-sheet)                                                                                                                                                                  | ChartMogul                                                                     | 2022-04-27                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_q3_2023                   | [U.S. Subscriber Benchmark Report Q3 2023](https://www.mathereconomics.com/wp-content/uploads/2023/11/US-Subscriber-Benchmark-Report_Mather-Economics_2023.pdf)                                                                          | Mather Economics                                                               | 2023-11                                                         | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_sep_2022                  | [Subscription Digital Audience Mini Benchmarking Report – September 2022](https://www.mathereconomics.com/wp-content/uploads/2022/11/Mather-Economics-Subscription-Digital-Audience-Mini-Benchmarking-Report-September-2022.pdf)         | Mather Economics                                                               | 2022-11 (dane IX 2022)                                          | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_q1_2025                   | [Download Mather's Q1 2025 U.S. Benchmarking Report](https://www.mathereconomics.com/download-mathers-q1-2025-u-s-benchmarking-report/)                                                                                                  | Mather Economics                                                               | 2025-05-13                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_q2_2025_promo             | [What Q2 2025 promotional offer benchmarks reveal about digital subscription growth](https://www.mathereconomics.com/what-q2-2025-promotional-offer-benchmarks-reveal-about-digital-subscription-growth/)                                | Mather Economics (Dustin Tetley, Chris Mateer)                                 | 2025-08 (data przybliżona)                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| piano_benchmarks_2024            | [Subscription Performance Benchmarks 2024 Report](https://www.piano.io/marketing/content/subscription-performance-benchmarks-2024)                                                                                                       | Piano                                                                          | 2024 (strona zaktualizowana 2026-10-13)                         | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| piano_benchmark_update_2026      | [Benchmark update: Growing revenue with declining traffic](https://www.piano.io/resources/benchmark-update-growing-revenue-with-declining-traffic)                                                                                       | Piano (Michael Silberman)                                                      | 2026-10-14                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| digiday_monthly_annual_2023      | [Media Briefing: The case for and against monthly and annual subscriptions in the battle for retention](https://digiday.com/media/media-briefing-the-case-for-and-against-monthly-and-annual-subscriptions-in-the-battle-for-retention/) | Digiday (Kayleigh Barber)                                                      | 2023-02-02                                                      | częściowo: Potwierdzone: Piano 2021 'only 46% of monthly subscribers are left while 74% of annual subscribers remain'; FTI: churn 3–4% (2021) → 4–5% (2022), roczni 65–80% po 52 tyg., miesięczni 'closer to 50-60%'; K. Barber, 2.02.2023. Poprawki: (1) Źródło podaje 46% i 74%, a nie '45–46%' i '74–75%' (dotyczy logo_churn_annual i cohort_retention_m12). (2) Okres churnu FTI 3–5% nie jest podany. Nie opisuj go jako miesięcznego.                                                                                                                                                                                                                                                                  |
| ftstrategies_retention_2025      | [Lessons on retention from the FT (and beyond)](https://www.ftstrategies.com/en-gb/insights/lessons-on-retention-from-the-ft)                                                                                                            | FT Strategies (Lamberto Lambertini)                                            | 2025-01-27                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| stripe_billing                   | [Stripe Billing](https://stripe.com/billing)                                                                                                                                                                                             | Stripe                                                                         | b.d. (dostęp 2026-10-18)                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| churnkey_involuntary_2025        | [Involuntary churn benchmarks and tactical advice](https://churnkey.co/blog/involuntary-churn-benchmarks)                                                                                                                                | Churnkey (dane Stripe 2024 i Churnkey)                                         | 2025-11-14 (aktualizacja 2025-12-12)                            | częściowo: Potwierdzone: dane Stripe (1,4 bln USD, 200 mln subskrypcji, 2024); udział mimowolnego churnu: B2C 24%, B2B 16%, digital goods 29%, SaaS 22%, AOV <10 USD 35%, AOV 1–10 tys. USD 15%; churn miesięczny B2C 4% i B2B 3,82% (rocznie 39% i 38%); Smart Retries 51% (5,5 dnia); trzy metody łącznie 70%; publikacja 14.11.2025, aktualizacja 12.12.2025. Poprawki: (1) Zwrotu 'może łatwo przekroczyć 40%' NIE ma na stronie (40,5% dotyczy udziału 'insufficient funds' w nieudanych płatnościach), więc usuń go z caveats involuntary_churn_share. (2) Progi cenowe to AOV (średnia wartość zamówienia), a nie 'cena produktu'.                                                                     |
| churnkey_sor_2025                | [State of Retention 2025](https://churnkey.co/reports/state-of-retention-2025)                                                                                                                                                           | Churnkey                                                                       | 2025-06 (dane 2024)                                             | częściowo: Potwierdzone: ponad 1000 firm, ok. 3 mln sesji, 'nearly two million' uratowanych subskrypcji, 70% odzysku mimowolnego churnu, e-mail/SMS 42%, 20–40% przychodu (w ciągu 4 lat); oferty: rabat 53,9% (w tekście 53%), pauza 19,2%, zmiana planu 6,7%. Poprawki: (1) Wartości '1,5–2,8% na pojedynczy e-mail dunningowy' NIE ma na stronie, więc usuń ją lub oznacz jako niezweryfikowaną (caveat dunning_recovery_rate). (2) Proporcja 2 mln / 3 mln (ok. 65%) nie jest save rate w sensie definicji i nie powinna być kotwicą progu 'optymalny' w cancellation_save_rate. (3) Strona ma metadata last_updated 2026-09-11, a raport obejmuje dane z 2024 r.                                         |
| recurly_failed_payment_2026      | [Failed payment recovery: a data-based strategy](https://recurly.com/blog/failed-payment-recovery-data-based-strategy/)                                                                                                                  | Recurly (Matthew Calhoun)                                                      | 2026-04-30                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| prosperstack_startribune         | [How Star Tribune reduced call center strain and improved their save rate](https://info.prosperstack.com/hubfs/Case%20Studies/ProsperStack%20-%20Star%20Tribune%20Case%20Study.pdf)                                                      | ProsperStack (case study)                                                      | b.d. (ok. 2022)                                                 | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| revenuecat_reactivation_2026     | [20% of your churned users will come back – but are you ready?](https://www.revenuecat.com/blog/growth/20-of-your-churned-users-will-come-back-but-are-you-ready)                                                                        | RevenueCat (Daphne Tideman)                                                    | 2026-05-28                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| recurly_sos_2026                 | [State of Subscriptions (industry report 2026)](https://recurly.com/resources/report/state-of-subscriptions/)                                                                                                                            | Recurly                                                                        | 2026-01 (©2026; dane 2021–2025)                                 | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| revenuecat_renewal_rates_2026    | [What's a good renewal rate? Average subscription renewal rates by app category](https://www.revenuecat.com/blog/growth/average-subscription-renewal-rates-by-app-category/)                                                             | RevenueCat                                                                     | 2026-04-24 (aktualizacja; dane State of Subscription Apps 2026) | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mgi_2025_memberjungle            | [The 5 lessons we learnt from the 2025 Membership Marketing Benchmarking Report (Marketing General Inc.)](https://www.memberjungle.com/blog/the-5-lessons-we-learnt-from-the-2025-membership-marketing-benchmarking-report)              | Member Jungle (omówienie raportu MGI)                                          | 2025-07-10                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mgi_2026_i4a                     | [How to Calculate Membership Retention Rate (With Benchmarks)](https://www.i4a.com/blog/retention-rate-calculation/)                                                                                                                     | i4a (cytuje MGI 2026 Membership Marketing Benchmarking Report)                 | 2026-08-11 (aktualizacja)                                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| twipe_wanifra_2018               | [Why half of new subscribers churn in the first 3 months](https://www.twipemobile.com/why-half-new-subscribers-churn-first-3-months/)                                                                                                    | Twipe (cytuje WAN-IFRA 'Engaged Readers Don't Churn', 2018)                    | 2018-08-29                                                      | częściowo: Potwierdzone: Die Welt, połowa nowych odchodzi w 3 mies., potem churn 1–2%/mies.; Seattle Times 62%; Boston Globe 50% → 20%; 29.08.2018. Poprawka: artykuł NIE mówi, że chodziło o oferty próbne, więc usuń '(oferty próbne)' z notatki przy progu 'krytyczny' w cohort_retention_m3.                                                                                                                                                                                                                                                                                                                                                                                                              |
| dnr_2026_poland                  | [Digital News Report 2026 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                                          | Reuters Institute for the Study of Journalism (Vadim Makarenko)                | 2026-06-16                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| rasp_inma_2026                   | [How Poland's Biggest Portal Learned to Think Small(er) and Built a Subscription That Keeps On Giving](https://www.inma.org/modules/event/2026SubscriptionsSummit/presentations/RASP_INMASUBSUMMIT26.pdf)                                | Ringier Axel Springer Polska / INMA Media Subscriptions Summit 2026            | 2026                                                            | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| antenna_svod_2025                | [Q1'26 State of Subscriptions: Premium SVOD 2025 Year in Review](https://www.antenna.live/insights/antenna-q126-state-of-subscriptions-report-premium-svod-2025-year-in-review)                                                          | Antenna                                                                        | 2026-02 (ok. 24.02.2026)                                        | częściowo: Potwierdzone: 'the Weighted Average Churn Rate for the category hit a steady 4.6%' (2025). Strona NIE podaje okresu (miesięczny) ani wartości za 2024. Liczby 4,8% (MediaPost) nie zweryfikowano. Strona nie ma też daty, poza webinarami 24–25 II i copyright 2026. Oznacz 4,6% jako 'miesięczna według metodologii Antenna (niepotwierdzone na stronie)' albo usuń 4,8%.                                                                                                                                                                                                                                                                                                                         |
| beehiiv_pressgazette_2026        | [Newsletters 2026: prices, retention and churn (Beehiiv State of Paid Newsletters)](https://pressgazette.co.uk/newsletters/newsletters-2026-prices-retention-churn/)                                                                     | Press Gazette (Charlotte Tobitt)                                               | 2026-06-22                                                      | częściowo: Potwierdzone: AI 13,33%, sport 7,76%, czas życia subskrybenta: news 18 mies., food & drink prawie 20, money ok. 6; Ch. Tobitt, 22.06.2026. Poprawka: artykuł mówi o 'more than 2,500 newsletters', a nie o ponad 2500 PŁATNYCH newsletterach.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| inma_past_subscribers_2025       | [Past subscribers are news brands' biggest growth pool](https://www.inma.org/blogs/reader-revenue/post.cfm/past-subscribers-are-news-brands-biggest-growth-pool)                                                                         | INMA (Readers First)                                                           | 2025-06                                                         | nie da się sprawdzić (link niedostępny): HTTP 403, potwierdzone ponownie. Liczb 1,7x, ok. 21 mies. i 136 marek nie da się zweryfikować. Wyszukiwanie zastępcze było niemożliwe, bo w tej turze wyczerpał się limit WebSearch. Zostaw jako źródło pomocnicze o niskiej pewności i nie opieraj na nim żadnej granicy przedziału.                                                                                                                                                                                                                                                                                                                                                                                |
| inma_churn_growth_engine         | [News companies can turn subscriber churn into a growth engine](https://www.inma.org/blogs/reader-revenue/post.cfm/news-companies-can-turn-subscriber-churn-into-a-growth-engine)                                                        | INMA (Reader Revenue)                                                          | 2025 (dokładna data nieustalona)                                | nie da się sprawdzić (link niedostępny): HTTP 403, potwierdzone ponownie. Liczb 4,6%/mies. (95 marek, 4Q 2024) i 4,8% reaktywacji nie da się zweryfikować, a wyszukiwanie zastępcze było niemożliwe (limit WebSearch). Wartość 4,6% jest zbieżna z Antenna (4,6%) i Mather Q1 2025 (4,62%), więc nie zmienia progów. Zostaw jako pomocniczą.                                                                                                                                                                                                                                                                                                                                                                  |
| reporterzy_dnr2025               | [Paid journalistic content market](https://reporterzy.info/en/5124,paid-journalistic-content-market.html)                                                                                                                                | Reporterzy.info (Krzysztof Fiedorek)                                           | 2025-07-28                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| reuters_paying_news_2023         | [Paying for news: price-conscious consumers look for value amid cost-of-living crisis](https://reutersinstitute.politics.ox.ac.uk/sites/default/files/2023-09/Newman_and_Robertson_Paying_for_News.pdf)                                  | Reuters Institute for the Study of Journalism (Nic Newman, Craig T. Robertson) | 2023-09                                                         | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 3. Ekonomika jednostkowa

### LTV / CLV: Wartość klienta w cyklu życia (Customer Lifetime Value)

- **Rozwinięcie:** LTV – Lifetime Value; CLV/CLTV – Customer Lifetime Value: wartość (na marży brutto), jaką przeciętny płacący klient wnosi przez cały okres relacji / LTV – Lifetime Value; CLV/CLTV – Customer Lifetime Value: the gross-margin value an average paying customer generates over the whole relationship
- **Wzór:** LTV = ARPU miesięczne (netto, po rabatach) × marża brutto % ÷ miesięczny churn klientów. Wariant B2B (Benchmarkit): (średni ARR na konto × marża brutto przychodów powtarzalnych ÷ roczny churn). Oczekiwany czas życia ≈ 1 ÷ miesięczny churn (Lenfest).
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, ile marży brutto przyniesie przeciętny płacący klient przez cały okres subskrypcji – to górna granica tego, ile można wydać na jego pozyskanie i utrzymanie. Licz w kohortach (miesiąc startu, kanał, plan, segment: osoby / instytucje / studenci-NGO) i zawsze na marży, nie na przychodzie. Pułapki: wzór 1/churn przy krótkiej historii i niskim, niestabilnym churnie młodego produktu daje zawyżone LTV, a promocyjne ceny pierwszego okresu zniekształcają ARPU – dlatego czytaj LTV razem z CAC (LTV/CAC).
- **Interpretation (EN):** Shows how much gross margin an average paying customer generates over the subscription lifetime – the ceiling for what you can spend to acquire and retain them. Compute it by cohort (start month, channel, plan, segment: individuals / institutions / students-NGOs) and always on margin, not revenue. Pitfalls: the 1/churn shortcut inflates LTV when churn history is short and unstable, and introductory prices distort ARPU – so read LTV together with CAC (LTV/CAC).

**Kontekst:** media cyfrowe B2C – indywidualna subskrypcja treści eksperckich (Polska), LTV na marży brutto w zł · okres: na klienta (cały cykl życia) · metoda: heurystyka: LTV = ARPU ≈22,5 zł (środek typowego przedziału 15–20 zł i mediany ‘uczciwej ceny’ 20 zł) × marża ≈85% ÷ churn mies. ok. 13% / 6% / 3% / 2%; progi skalują się proporcjonalnie do ARPU · źródła: wm_anatomia_2026, pie_2021, lenfest_2019, stripe_pl_pricing

| Ocena     | Przedział | Uwagi                                                            |
| --------- | --------- | ---------------------------------------------------------------- |
| krytyczny | < 150     | odpowiada churnowi >~13%/mies. – klient zostaje średnio <8 mies. |
| słaby     | 150–300   | churn ~6–13%/mies.                                               |
| normalny  | 300–600   | churn ~3–6%/mies.                                                |
| dobry     | 600–1000  | churn ~2–3%/mies.                                                |
| optymalny | ≥ 1000    | churn <~2%/mies. lub wyraźnie wyższe ARPU (plany roczne/premium) |

**Zastrzeżenia:**

- Brak publicznych, aktualnych benchmarków LTV dla polskich wydawców cyfrowych; progi w zł to heurystyka wyprowadzona z ARPU i churnu – przy innym ARPU przeskaluj je proporcjonalnie.
- Punkt odniesienia (stary, USA): Lenfest Institute 2019 – wydawca z 80. percentyla (dziennik z aktywną sprzedażą subskrypcji) miał CLV ok. 217 USD na subskrybenta cyfrowego.
- Dla kohort z historią <12 mies. ogranicz horyzont LTV (np. do 24–36 mies.), bo wzór 1/churn ekstrapoluje zbyt optymistycznie.
- Segment B2B (licencje instytucjonalne) oceniaj przez LTV/CAC i CAC payback, nie przez progi w zł – wartości kontraktów są zbyt zróżnicowane.
- Licz osobno dla planów miesięcznych i rocznych oraz dla taryf studenckich/NGO, inaczej średnia ukryje problem.

**Poprawki weryfikacji (do naniesienia):**

- Uzasadnienie bazy ARPU jest arytmetycznie błędne. 22,5 zł nie jest ani środkiem przedziału 15–20 zł (17,5), ani medianą PIE (20). Do tego ARPU B2C w słowniku jest liczone brutto, a LTV na marży powinno być liczone od przychodu netto (bez VAT). Polska ma też najwyższy w DNR 2024 udział płacących poniżej ceny katalogowej (78%), więc realne ARPU będzie raczej poniżej 15–20 zł. Proponuję zdefiniować progi jako krotność miesięcznej marży z klienta m, czyli oczekiwany czas życia w miesiącach: krytyczny <8×m (churn >12,5%/mies.), słaby 8–17×m, normalny 17–33×m, dobry 33–50×m, optymalny >50×m (churn <2%). Przykład w zł przy ARPU netto ok. 17–18 zł (20 zł brutto po odjęciu VAT) i marży 85%, czyli m ≈ 15 zł: krytyczny <120, słaby 120–250, normalny 250–500, dobry 500–750, optymalny >750. W caveats dopisz, że CLV 217 USD z Lenfest 2019 jest liczone na przychodzie, nie na marży.

### CAC: Koszt pozyskania klienta (Customer Acquisition Cost)

- **Rozwinięcie:** CAC – Customer Acquisition Cost: średni koszt sprzedaży i marketingu poniesiony na pozyskanie jednego nowego płacącego klienta / CAC – Customer Acquisition Cost: average sales and marketing cost incurred to win one new paying customer
- **Wzór:** CAC = (koszty marketingu i sprzedaży przypisane do pozyskania w okresie: media płatne, kampanie, narzędzia, wynagrodzenia zespołu proporcjonalnie, prowizje partnerów) ÷ liczba nowych płacących klientów w tym samym okresie. Warianty: blended (wszyscy nowi płacący, także organiczni) i paid (tylko z kanałów płatnych).
- **Jednostka:** PLN · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mówi, ile kosztuje zdobycie jednego nowego płacącego subskrybenta lub instytucji; sam w sobie nie mówi, czy to drogo – trzeba go odnieść do ARPU i marży (CAC payback, LTV/CAC). Licz osobno per kanał (newsletter, wydarzenia, social, płatne media, partnerzy) i per segment. Pułapki: pomijanie wynagrodzeń i narzędzi (zaniża CAC), liczenie przejść z darmowego triala jako ‘organicznych’ oraz mieszanie okresów (koszty z kwartału, konwersje z miesiąca).
- **Interpretation (EN):** Tells you how much it costs to win one new paying subscriber or institution; on its own it does not say whether that is expensive – relate it to ARPU and margin (CAC payback, LTV/CAC). Track it per channel (newsletter, events, social, paid media, partners) and per segment. Pitfalls: leaving out salaries and tools (understates CAC), counting trial conversions as ‘organic’, and mismatching periods (costs per quarter, conversions per month).

**Kontekst:** media cyfrowe B2C – nowy płacący subskrybent indywidualny (Polska), zł · okres: na nowego płacącego klienta · metoda: heurystyka: CAC = docelowy okres zwrotu (3 / 6 / 9 / 12 mies.) × miesięczna marża brutto z klienta ≈19 zł (ARPU ≈22,5 zł × marża ≈85%) · źródła: wm_anatomia_2026, pie_2021, bvp_2021

| Ocena     | Przedział | Uwagi                                                                            |
| --------- | --------- | -------------------------------------------------------------------------------- |
| optymalny | < 60      | zwrot ≤~3 mies.                                                                  |
| dobry     | 60–115    | zwrot ~3–6 mies.                                                                 |
| normalny  | 115–170   | zwrot ~6–9 mies.                                                                 |
| słaby     | 170–230   | zwrot ~9–12 mies.                                                                |
| krytyczny | ≥ 230     | zwrot >12 mies. – przy typowym churnie B2C wielu klientów odejdzie przed zwrotem |

**Zastrzeżenia:**

- Brak wiarygodnych, publicznych benchmarków CAC dla wydawców w PLN; progi są pochodną ARPU i marży – przy innym ARPU przelicz je wzorem CAC = miesiące zwrotu × ARPU × marża.
- Dla B2B/instytucji używaj znormalizowanych miar: New CAC Ratio (koszt S&M na 1 zł nowego ARR) i CAC payback – absolutny CAC zależy od wartości kontraktu.
- Często cytowany przedział CAC wydawców informacyjnych ok. 40–60 USD (INMA, 2021) nie został zweryfikowany w źródle pierwotnym (strona zwraca 403) – nie używać jako progu.
- Koszt rabatów i darmowych okresów próbnych księguj konsekwentnie (obniżka przychodu albo koszt pozyskania) – zmiana konwencji zmienia CAC skokowo.

**Poprawki weryfikacji (do naniesienia):**

- Ta sama korekta bazy co w LTV (netto, m ≈ 15 zł zamiast 19 zł). Progi zapisz jako miesiące zwrotu × m, spójnie z cac_payback_months B2C (3/6/9/12): optymalny ≤45 zł, dobry 45–90, normalny 90–135, słaby 135–180, krytyczny >180 zł. Alternatywnie zachowaj obecne kwoty, ale popraw opis bazy: ARPU 22,5 zł to założenie, a nie środek przedziału 15–20 zł, i to kwota brutto.

### New CAC Ratio: Wskaźnik kosztu pozyskania nowego ARR (New Customer CAC Ratio)

- **Rozwinięcie:** New CAC Ratio – stosunek wydatków na sprzedaż i marketing do nowego rocznego przychodu powtarzalnego (ARR – Annual Recurring Revenue) od nowych klientów / New CAC Ratio – sales & marketing expense divided by new Annual Recurring Revenue (ARR) from new customers
- **Wzór:** New CAC Ratio = koszty sprzedaży i marketingu w okresie ÷ nowy ARR od nowych klientów w tym okresie (Benchmarkit). Blended CAC Ratio = S&M ÷ (nowy ARR + ARR z rozszerzeń).
- **Jednostka:** ratio · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Ile złotych wydatków na sprzedaż i marketing trzeba ponieść, by pozyskać 1 zł nowego rocznego przychodu powtarzalnego od nowych klientów; normalizuje CAC do wartości kontraktu, więc pozwala porównywać segmenty o różnych cenach (np. licencje instytucjonalne vs. indywidualne). Mediana B2B SaaS w 2024 r. to 2,00 zł na 1 zł nowego ARR. Pułapki: nie dodawaj ARR z rozszerzeń u obecnych klientów (to osobny Expansion CAC Ratio, mediana 1,00) i stosuj ten sam okres dla kosztów i ARR.
- **Interpretation (EN):** How many units of sales & marketing spend are needed to win one unit of new ARR from new customers; it normalises CAC by contract value, so segments with different prices (institutional vs individual licences) can be compared. The 2024 B2B SaaS median was $2.00 per $1.00 of new ARR. Pitfalls: do not mix in expansion ARR from existing customers (that is the separate Expansion CAC Ratio, median $1.00) and use the same period for costs and ARR.

**Kontekst:** SaaS B2B / subskrypcje instytucjonalne (prywatne firmy, głównie USA) · okres: rocznie (CY-2024) · metoda: kwartyle źródła: P25 1,50 / mediana 2,00 / P75 2,82 (N=73); optymalny ≤P25, dobry P25–P50, normalny P50–P75, słaby P75–4,0; krytyczny >4,0 – heurystyka (przy marży 80% zwrot >5 lat) · źródła: bm2025

| Ocena     | Przedział | Uwagi      |
| --------- | --------- | ---------- |
| optymalny | < 1,5     |            |
| dobry     | 1,5–2     |            |
| normalny  | 2–2,82    |            |
| słaby     | 2,82–4    |            |
| krytyczny | ≥ 4       | heurystyka |

**Zastrzeżenia:**

- Mała próba (N=73) i dane deklaratywne; wartości kwartyli odczytane z wykresu w raporcie.
- Silna zależność od ACV: dla ACV 1–5 tys. USD P25 0,46 / mediana 2,00 / P75 2,46; dla 5–10 tys. USD 1,50 / 1,60 / 1,80.
- Dla czysto konsumenckiej subskrypcji (B2C) wskaźnik ma mniejszy sens – użyj CAC payback.

**Poprawki weryfikacji (do naniesienia):**

- Kwartyle 1,50/2,00/2,82 potwierdzone, ale to dane CY-2024. Publicznie dostępnych kwartyli za CY-2025 nie znalazłem: strona Benchmarkit 2026 podaje jedynie Blended CAC Ratio 1,30 USD. Dopisz w caveats, że progi nie są mechanicznie spójne z CAC payback: z mediany 2,00 ÷ marża 81% × 12 wychodzi ok. 30 mies., a raportowana mediana zwrotu to 18 mies. Wynika to z innych podprób (N=73 vs N=148). Rozważ obniżenie progu krytycznego z >4,0 (≈60 mies. zwrotu przy marży 80%) do >3,0 (≈45 mies.), bo próg krytyczny dla CAC payback (>36 mies.) odpowiada ratio ≈2,4.

### LTV/CAC: Relacja wartości klienta do kosztu pozyskania (LTV to CAC Ratio)

- **Rozwinięcie:** LTV/CAC (CLTV:CAC) – stosunek wartości klienta w cyklu życia (Lifetime Value) do kosztu jego pozyskania (Customer Acquisition Cost) / LTV/CAC (CLTV:CAC) – ratio of Customer Lifetime Value to Customer Acquisition Cost
- **Wzór:** LTV/CAC = LTV (na marży brutto) ÷ CAC; w Benchmarkit: (średni ARR na konto × marża brutto przychodów powtarzalnych ÷ churn) ÷ CAC na nowego klienta
- **Jednostka:** ratio · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Ile razy wartość klienta (na marży) przewyższa koszt jego pozyskania; poniżej 1 każdy nowy klient pogłębia stratę. Za próg minimalny uznaje się 3:1, mediana B2B SaaS w 2025 r. to 4,1x, a górny kwartyl 7,8x. Pułapki: to wskaźnik złożony – zawsze rozbijaj go na ARPU, churn, marżę i CAC; bardzo wysoki wynik (8x+) bywa sygnałem niedoinwestowania wzrostu albo zbyt krótkiej historii churnu.
- **Interpretation (EN):** How many times the customer’s gross-margin value exceeds the cost to acquire them; below 1 every new customer deepens the loss. 3:1 is the accepted floor, the 2025 B2B SaaS median was 4.1x and the top quartile 7.8x. Pitfalls: it is a compound metric – always decompose it into ARPU, churn, margin and CAC; very high values (8x+) can signal under-investment in growth or a too-short churn history.

**Kontekst:** SaaS B2B / subskrypcje instytucjonalne (prywatne firmy B2B SaaS i AI, globalnie) · okres: rocznie (CY-2025) · metoda: kwartyle źródła: P25 ≈1,1x / mediana 4,1x / P75 7,8x (n=146) + próg 3:1 (Skok, Bessemer) + granica 8x jako sygnał niedoinwestowania (Aleph) · źródła: aleph_ltvcac_2026, bm2025, skok_saasmetrics, bvp_2021

| Ocena     | Przedział | Uwagi                                                                                     |
| --------- | --------- | ----------------------------------------------------------------------------------------- |
| krytyczny | < 1       | klient nie zwraca kosztu pozyskania                                                       |
| słaby     | 1–3       | poniżej progu 3:1; P25 ≈1,1x                                                              |
| normalny  | 3–4       | od progu 3:1 do okolic mediany 4,1x                                                       |
| dobry     | 4–5       |                                                                                           |
| optymalny | 5–8       | P75 = 7,8x; ‘7x+ best-in-class’                                                           |
| dobry     | ≥ 8       | wysoka efektywność, ale sprawdź niedoinwestowanie wzrostu lub zbyt krótką historię churnu |

**Kontekst:** media cyfrowe B2C / członkostwa indywidualne (Polska) · okres: na kohortę miesięczną · metoda: heurystyka: te same progi co B2B (3:1 jako minimum), LTV liczone konserwatywnie (horyzont ≤36 mies. dla młodych kohort) · źródła: skok_saasmetrics, lenfest_2019

| Ocena     | Przedział | Uwagi                                                    |
| --------- | --------- | -------------------------------------------------------- |
| krytyczny | < 1       |                                                          |
| słaby     | 1–2       |                                                          |
| normalny  | 2–3       |                                                          |
| dobry     | 3–5       |                                                          |
| optymalny | 5–8       |                                                          |
| dobry     | ≥ 8       | sprawdź, czy LTV nie jest zawyżone przez krótką historię |

**Zastrzeżenia:**

- Rozbieżność źródeł: w raporcie Benchmarkit 2025 (CY-2024) P25 wg przedziałów ARR wynosił 2,2–3,0x, a w edycji 2026 dolny kwartyl całej próby to ok. 1,1x (strona Aleph nie precyzuje wprost, że to P25).
- Wczesne firmy (<1 mln USD ARR) raportują zawyżone LTV/CAC (Benchmarkit 2025: P25 3,0 / mediana 5,0 / P75 9,5) – krótka historia churnu.
- Mediana 2022–2024 stała na poziomie 3,6–3,7x; wzrost do 4,1x w 2025 r. wynika głównie z cięcia kosztów, nie z poprawy retencji.
- Dla B2C brak publicznych benchmarków wydawców – kontekst B2C to heurystyka.

**Poprawki weryfikacji (do naniesienia):**

- (1) Usuń z caveats lub oznacz jako własną interpretację zdanie, że wzrost mediany do 4,1x 'wynika głównie z cięcia kosztów, nie z poprawy retencji'. Źródło (Aleph) nie podaje przyczyny. (2) Kontekst B2C przeczy własnej metodzie: metoda mówi 'te same progi co B2B (3:1 jako minimum)', a przedziały oceniają 1–2 jako słaby i 2–3 jako normalny, czyli poniżej minimum 3:1. Wyrównaj do B2B: krytyczny <1; słaby 1–3; normalny 3–4; dobry 4–5; optymalny 5–8; ≥8 'dobry, sprawdź' (z ostrzeżeniem o zawyżonym LTV). Albo zmień opis metody i uzasadnij łagodniejsze progi. (3) Przy P25 ≈1,1x dopisz, że Aleph mówi o 'bottom quartile' bez definicji granicy. (4) Opcjonalnie rozróżnij dwie etykiety 'dobry' w UI (np. 'dobry – sprawdź niedoinwestowanie' dla ≥8).

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

**Kontekst:** subskrypcje instytucjonalne / B2B o niskiej wartości kontraktu (ACV <5 tys. USD, ok. <20 tys. zł rocznie) · okres: rocznie (CY-2024/CY-2025) · metoda: kwartyle Benchmarkit 2025 dla ACV <1 tys. USD (5/8/10) i 1–5 tys. USD (6/8/12) + mediana 2026 dla ACV <5 tys. USD = 11 mies. + cel Bessemer dla SMB <12 mies.; krytyczny >18 – heurystyka · źródła: bm2025, aleph_payback_2026, bvp_2021

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| optymalny | < 6       |       |
| dobry     | 6–9       |       |
| normalny  | 9–12      |       |
| słaby     | 12–18     |       |
| krytyczny | ≥ 18      |       |

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

**Poprawki weryfikacji (do naniesienia):**

- Przedziały B2B (10/16/24/36) są poprawne. W excerpcie aleph_payback_2026 usuń 'górny kwartyl ≤6 mies.' albo oznacz go jako niespójny ze źródłem: ta sama strona podaje P25 = 10 mies. Kontekst niskiego ACV: mediana 2025 dla ACV <5 tys. USD wynosi 11 mies. (2024: 8), więc wg przyjętej metody granica dobry/normalny powinna przesunąć się bliżej 11. Opcjonalnie zmień na: optymalny ≤6, dobry 6–11, normalny 11–14, słaby 14–18, krytyczny >18 (14 to heurystyka, bo brak P75 za 2025). Albo zostaw obecne progi z adnotacją, że oparto je na CY-2024.

### GM: Marża brutto subskrypcji cyfrowych (Subscription Gross Margin)

- **Rozwinięcie:** GM – Gross Margin: udział przychodu z subskrypcji, który zostaje po odjęciu kosztów bezpośredniego dostarczenia usługi (COGS – Cost of Goods Sold) / GM – Gross Margin: share of subscription revenue left after direct cost of delivery (COGS – Cost of Goods Sold)
- **Wzór:** Marża brutto subskrypcji = (przychody z subskrypcji netto − koszty bezpośrednie: opłaty płatnicze i billing, hosting/CDN, licencje paywall/CRM/e-mail proporcjonalnie, prowizje platform/sklepów aplikacji, obsługa klienta) ÷ przychody z subskrypcji × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Jaka część przychodu z subskrypcji zostaje po pokryciu kosztów bezpośredniego dostarczenia usługi; wysoka marża oznacza, że wzrost skali poprawia rentowność. Mediana marży oprogramowania B2B SaaS w 2025 r. to 80%, górny kwartyl 86%+. Pułapki: niespójne księgowanie kosztów redakcyjnych (w mediach zwykle koszt operacyjny, nie COGS) – trzymaj jedną definicję; stała opłata za transakcję (np. 1 zł) mocno obniża marżę tanich planów miesięcznych.
- **Interpretation (EN):** The share of subscription revenue left after direct delivery costs; a high margin means scale improves profitability. The 2025 B2B SaaS software gross-margin median was 80%, top quartile 86%+. Pitfalls: inconsistent treatment of editorial costs (in media usually opex, not COGS) – keep one definition; fixed per-transaction fees (e.g. PLN 1) heavily erode the margin of cheap monthly plans.

**Kontekst:** SaaS B2B – marża brutto przychodów z oprogramowania/subskrypcji · okres: rocznie (CY-2025) · metoda: kwartyle źródła: dolny kwartyl 50% / mediana 80% / górny kwartyl 86%+ (n=228–232); granica 70% – heurystyka (średnia chmury wg Bessemer 65–70%, mediana firm <5 mln USD ARR 72%) · źródła: aleph_gm_2026, bm2025, bvp_2021

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 50      |       |
| słaby     | 50–70     |       |
| normalny  | 70–80     |       |
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

- Benchmarkit 2025 (CY-2024): marża subskrypcji 81% (mediana, N=76), całkowita 77%, usługi profesjonalne 30%; wg ARR 1–5 mln USD P25 40% / mediana 77% / P75 90%; 5–20 mln USD 75/81/86%.
- Modele rozliczane wyłącznie za użycie mają medianę 62% (koszty mocy obliczeniowej/AI) – funkcje AI w produkcie mogą obniżać marżę.
- Jeśli koszty redakcyjne (autorzy, eksperci) są ujmowane w COGS, marża wydawcy będzie znacznie niższa i progi SaaS nie mają zastosowania.
- Platformy patronackie pobierają prowizję (Patronite 6,5% netto + operator płatności) – uwzględnij przy kanałach pośrednich.

**Poprawki weryfikacji (do naniesienia):**

- (1) Popraw cytat Bessemer: zamiast 'najlepsi 80–85%+' wpisz 'top performerzy: 85%+ przy 1–10 mln USD ARR, 80%+ przy 50 mln+ ARR'. (2) Dopisz do caveats kwartyle marży subskrypcji dla całej próby Benchmarkit CY-24: P25 72% / mediana 81% / P75 86% (wykres s. 44). Zaznacz, że 'Bottom quartile: 50%' w Aleph 2026 nie jest zdefiniowany (granica czy średnia) i mocno odstaje od 72%. Opcjonalnie przesuń granicę słaby/normalny z 70% na 72% (P25 CY-24), a 50–72% zostaw jako słaby.

### R40: Reguła 40 (Rule of 40)

- **Rozwinięcie:** Rule of 40 – reguła, według której suma tempa wzrostu przychodów i marży zysku powinna wynosić co najmniej 40% / Rule of 40 – the principle that revenue growth rate plus profit margin should be at least 40%
- **Wzór:** R40 = roczna dynamika przychodów lub ARR (%) + marża EBITDA (%) [alternatywnie marża FCF – wolnych przepływów pieniężnych]
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy równowagę między wzrostem a rentownością: szybki wzrost może usprawiedliwiać stratę, a wolny wzrost wymaga wysokiej marży. Wynik ≥40% uchodzi za wzorcowy, ale mediana prywatnych firm B2B SaaS w 2025 r. to 25%, a próg 40 przekracza ok. 15% spółek publicznych (na bazie EBITDA). Pułapki: zawsze podawaj, którą marżę użyto (EBITDA vs FCF różni medianę spółek publicznych o ok. 16 pp), a w małych organizacjach wskaźnik jest niestabilny i ma głównie charakter informacyjny.
- **Interpretation (EN):** Measures the balance between growth and profitability: fast growth can justify losses, slow growth needs high margins. 40%+ is the reference bar, but the 2025 private B2B SaaS median was 25% and only about 15% of public SaaS companies clear 40 on an EBITDA basis. Pitfalls: always state which margin is used (EBITDA vs FCF shifts the public median by ~16 pp), and in small organisations the metric is volatile and mostly informational.

**Kontekst:** prywatne firmy B2B SaaS i AI (globalnie) · okres: rocznie (CY-2025) · metoda: kwartyle źródła: P25 7% / mediana 25% / P75 43% (n=110); optymalny od klasycznego progu 40%; krytyczny <0% – heurystyka (wzrost nie pokrywa straty) · źródła: aleph_r40_2026, bm2025

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

**Poprawki weryfikacji (do naniesienia):**

- Brak poprawek. Wszystkie liczby (Aleph 7/25/43, Benchmarkit CY-24 −4/15/35, EMEA −9/25/38, USA −19/9/35, Aventis 22,6%/39,1%, 15%/46%, 4,8x/2,7x) potwierdzone.

### ARPU: Średni przychód na użytkownika (płacącego) (Average Revenue Per User)

- **Rozwinięcie:** ARPU – Average Revenue Per User: średni przychód z jednego płacącego subskrybenta w okresie (zwykle miesiąc); w B2B także ARPA – Average Revenue Per Account (na konto/instytucję) lub na stanowisko (seat) / ARPU – Average Revenue Per User: average revenue per paying subscriber per period (usually a month); in B2B also ARPA – Average Revenue Per Account, or per seat
- **Wzór:** ARPU = przychody subskrypcyjne w okresie (po rabatach) ÷ średnia liczba płacących subskrybentów w okresie; normalizuj do miesiąca (NYT: przychód kwartału ÷ średnia liczba subskrybentów ÷ liczba dni × 28)
- **Jednostka:** PLN · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje realną, a nie cennikową cenę, jaką płaci przeciętny subskrybent po promocjach i rabatach. Wzrost ARPU przy stabilnej bazie to zwykle efekt wychodzenia klientów z cen promocyjnych, podwyżek dla stałych klientów lub upsellu (np. NYT: 9,94 USD za 28 dni w II kw. 2026, +3,1% r/r). Pułapki: liczenie na wszystkich zarejestrowanych zamiast na płacących, mieszanie segmentów (osoby, firmy, studenci/NGO) i kwot brutto/netto VAT; wzrost ARPU kosztem wolumenu (USA Today: −30% subskrybentów, +27% ARPU) nie zawsze jest korzystny.
- **Interpretation (EN):** Shows the real, not list, price the average subscriber pays after promotions and discounts. ARPU growth on a stable base usually comes from subscribers rolling off introductory prices, price increases for tenured subscribers or upsell (e.g. NYT: $9.94 per 28 days in Q2 2026, +3.1% YoY). Pitfalls: dividing by all registered users instead of payers, mixing segments (individuals, companies, students/NGOs) and gross/net of VAT; raising ARPU at the expense of volume (USA Today: −30% subscribers, +27% ARPU) is not always a win.

**Kontekst:** media cyfrowe B2C – indywidualna subskrypcja cyfrowa (Polska), zł brutto/mies. po rabatach · okres: miesięcznie · metoda: heurystyka zakotwiczona w cenach rynkowych: promocja Wyborcza 89 zł/rok ≈7,4 zł/mies.; RP.PL promo 9,90 zł vs cena 39 zł; ‘uczciwa cena’ – dominanta 10 zł, mediana 20 zł (PIE); typowa subskrypcja 15–20 zł (wirtualnemedia 2026); Radio Nowy Świat ≈27 zł/patrona (obliczenie własne: ~800 tys. zł ÷ >30 tys.); średnia cena katalogowa najtańszego planu w CEE 7,84 EUR ≈33 zł (przeliczenie własne ~4,25 PLN/EUR) · źródła: wyborcza_blik_2026, rp_offer_2026, pie_2021, wm_anatomia_2026, mfm_pricing_2025, risj_dnr2024_pay

| Ocena     | Przedział | Uwagi                                              |
| --------- | --------- | -------------------------------------------------- |
| krytyczny | < 8       | baza zdominowana przez głębokie promocje           |
| słaby     | 8–15      |                                                    |
| normalny  | 15–25     | typowy poziom rynkowy 15–20 zł                     |
| dobry     | 25–35     | blisko średniej ceny katalogowej w CEE             |
| optymalny | ≥ 35      | blisko pełnej ceny RP.PL (39 zł) lub plany premium |

**Kontekst:** B2B / profesjonalne – licencja na stanowisko (seat) lub dostęp ekspercki, zł netto/mies. · okres: miesięcznie · metoda: heurystyka zakotwiczona w cennikach: PRO.RP.PL od 39 zł/mies.; e-prenumerata ‘Rzeczpospolitej’ od 174,50 zł/mies.; DGP Premium 196 zł/mies. po pierwszym miesiącu; członkostwo indywidualne Chatham House 345 GBP/rok · źródła: rp_offer_2026, wm_anatomia_2026, chatham_membership

| Ocena     | Przedział | Uwagi                                  |
| --------- | --------- | -------------------------------------- |
| krytyczny | < 40      | brak premii B2B ponad cenę konsumencką |
| słaby     | 40–80     |                                        |
| normalny  | 80–150    |                                        |
| dobry     | 150–250   | poziom DGP Premium / e-prenumeraty RP  |
| optymalny | ≥ 250     |                                        |

**Zastrzeżenia:**

- Polscy wydawcy nie ujawniają ARPU (Agora nie podaje osobno przychodów z prenumerat Wyborczej) – progi w zł to heurystyka oparta na cennikach i badaniach postaw.
- Polska wyróżnia się rabatowaniem: 78% płacących w Polsce nie płaci pełnej ceny wobec 41% średnio w 20 krajach (DNR 2024) – ARPU będzie wyraźnie niższe od cen katalogowych.
- Za newsy online płaci w Polsce 11% internautów (DNR 2026, −2 pp; 2025: 13%) wobec 17% średnio w 20 krajach; 10–20% to praktyczny sufit w większości rynków.
- Europa 2025: średnia cena najtańszego planu 10,08 EUR (CEE 7,84 EUR, Europa Zachodnia 13,01 EUR); plany roczne średnio ok. 22% taniej; ceny wyłącznie katalogowe, bez rabatów.
- Segmenty studenci/NGO i licencje grupowe licz jako osobne ARPU – 21 na 101 europejskich wydawców ma zniżki studenckie, 35 rabaty wielostanowiskowe.
- Kwoty B2C są brutto (jak w cennikach konsumenckich); do porównań księgowych odejmij VAT.

**Poprawki weryfikacji (do naniesienia):**

- (1) Kotwica Chatham House (345 GBP) jest niezweryfikowana: strona zwraca 403. Oznacz ją jako niezweryfikowaną albo zastąp sprawdzalnym cennikiem, a przy okazji zaznacz, że to członkostwo indywidualne, nie licencja na stanowisko. (2) Caveat MFM: '35 rabaty wielostanowiskowe' zmień na '35 ma rabaty dla wielu kont (plany firmowe i rodzinne)'. (3) PIE 2021 (badanie z XII 2020) oznacz jako historyczną kotwicę sprzed inflacji 2022–2023. Jej wartości (10/20 zł) nie powinny wyznaczać progów. (4) '15–20 zł' z wirtualnemedia to opinia eksperta, a nie zmierzona średnia, więc zaznacz to. (5) W interpretacji EN/PL USA Today: źródło mówi 'an end to heavy discounting'. (6) Progi B2C są brutto, a LTV i CAC wymagają netto. Dodaj w UI przelicznik albo podawaj obie wartości, żeby LTV i CAC nie były liczone od kwot z VAT.

### Źródła grupy: Ekonomika jednostkowa

| Id                 | Źródło                                                                                                                                                                                                                                                                                    | Wydawca                                                                                      | Data                                                                            | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bm2025             | [2025 B2B SaaS Performance Metrics Benchmarks](https://www.hibob.com/wp-content/uploads/2025-SaaS-Performance-Metrics-Benchmarks.pdf)                                                                                                                                                     | Benchmarkit (PDF udostępniony przez partnera badania HiBob)                                  | 2025 (II kw.; dane CY-2024, N=583)                                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| aleph_payback_2026 | [CAC payback period benchmarks: what's good for SaaS in 2026? (2026 SaaS & AI Performance Benchmarks)](https://www.getaleph.com/answers/cac-payback-period-saas-2026)                                                                                                                     | Aleph × Benchmarkit                                                                          | 2026-06-01 (strona aktualizowana 2026-10)                                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| aleph_ltvcac_2026  | [CLTV:CAC ratio benchmarks for SaaS in 2026](https://getaleph.com/answers/cltv-cac-ratio-saas-2026)                                                                                                                                                                                       | Aleph × Benchmarkit                                                                          | 2026-06-01                                                                      | częściowo: Potwierdzone: mediana 4,1x, P75 wzrósł z 6,0x do 7,8x, 'the bottom quartile sits at just 1.1x', mediana 3,6–3,7x w latach 2022–2024, 'at least 3:1, with 4–5x healthy and 7x+ best-in-class', 8x+ jako sygnał niedoinwestowania, n=146, CY-2025, publikacja 1.06.2026. Dwie rzeczy NIE są w źródle. (1) Strona nie podaje przyczyny wzrostu mediany do 4,1x. Teza z caveats, że wzrost 'wynika głównie z cięcia kosztów, nie z poprawy retencji', jest niepoparta: jedyne zdanie przyczynowe dotyczy liderów ('efficiency gains compound on strong retention'). (2) Strona nie mówi, czy 1,1x to granica P25, czy średnia dolnego kwartyla, i nie podaje P25 za 2024. Etykietę 'P25 ≈1,1x' zostaw z zastrzeżeniem. |
| aleph_gm_2026      | [SaaS gross margin benchmarks 2026](https://www.getaleph.com/answers/saas-gross-margin-2026)                                                                                                                                                                                              | Aleph × Benchmarkit                                                                          | 2026-06-01                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| aleph_r40_2026     | [Rule of 40 benchmarks for SaaS in 2026](https://getaleph.com/answers/rule-of-40-saas-2026)                                                                                                                                                                                               | Aleph × Benchmarkit                                                                          | 2026-06-01                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| bvp_2021           | [Scaling to $100 Million](https://www.bvp.com/atlas/scaling-to-100-million)                                                                                                                                                                                                               | Bessemer Venture Partners (Atlas)                                                            | 2021-09-21                                                                      | częściowo: Potwierdzone: SMB 'target CAC payback <12 months', mid-market <18, enterprise <24; inwestowanie w pozyskanie przy CLTV/CAC 3x+; 'the average gross margin for a cloud business regardless of maturity is 65-70%'; publikacja 21.09.2021; dane portfela BVP 2010–1H21. Do poprawy: w tekście nie ma sformułowania 'najlepsi 80–85%+'. Benchmarki top performerów to 'Gross Margins of 85%+' przy 1–10 mln USD ARR i '80%+' przy 50 mln+ ARR. Źródło ma 5 lat i pochodzi z portfela VC, a nie z losowej próby, co źródło samo zaznacza.                                                                                                                                                                              |
| skok_saasmetrics   | [SaaS Metrics 2.0 – A Guide to Measuring and Improving What Matters](https://www.forentrepreneurs.com/saas-metrics-2/)                                                                                                                                                                    | David Skok, For Entrepreneurs                                                                | aktualizacja 2016-05 (strona ©2000–2021)                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| aventis_r40_2026   | [Rule of 40 in SaaS (2026)](https://aventis-advisors.com/rule-of-40-in-saas-2026/)                                                                                                                                                                                                        | Aventis Advisors                                                                             | 2026-05-06                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| risj_dnr2026_exec  | [Digital News Report 2026 – Executive summary](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/dnr-executive-summary)                                                                                                                                                 | Reuters Institute for the Study of Journalism                                                | 2026-06-16                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| risj_dnr2026_pl    | [Digital News Report 2026 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                                                                                           | Reuters Institute for the Study of Journalism (Vadim Makarenko)                              | 2026-06-16                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| risj_dnr2025_pl    | [Digital News Report 2025 – Poland](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/poland)                                                                                                                                                                           | Reuters Institute for the Study of Journalism                                                | 2025-06-17                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| risj_dnr2024_pay   | [How much do people pay for online news? And what might encourage others to pay?](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2024/how-much-do-people-pay-online-news-what-might-encourage-others-pay)                                                                 | Reuters Institute for the Study of Journalism (Craig T. Robertson), Digital News Report 2024 | 2024-06-17                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mfm_pricing_2025   | [2025 European Digital News Pricing Report](https://www.funds4media.org/p/2025-european-digital-news-pricing)                                                                                                                                                                             | Media Finance Monitor / Center for Sustainable Media (P. Erdelyi i in.)                      | 2025-07-03                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| nyt_q2_2026        | [The New York Times Company Reports Second-Quarter 2026 Results](https://static.poder360.com.br/uploads/2026/08/New-York-Times-2Q26.pdf)                                                                                                                                                  | The New York Times Company (kopia komunikatu na poder360.com.br)                             | 2026-08-05                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| rp_offer_2026      | [Oferta subskrypcji Rzeczpospolitej (czytaj.rp.pl)](https://czytaj.rp.pl/)                                                                                                                                                                                                                | Gremi Media / Rzeczpospolita                                                                 | dostęp 2026-10-18                                                               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| wyborcza_blik_2026 | [Regulamin Akcji Marketingowej ‘Wyborcza.pl Wiosna z BLIKIEM 2026’](<https://www.blik.com/media/regulaminy/Płatności%20powtarzalne%20BLIK/regulamin%20Wyborcza%20x%20BLIK%202026%20(1).pdf>)                                                                                              | Wyborcza sp. z o.o. / BLIK                                                                   | 2026-04-14 (promocja 27.04–31.05.2026)                                          | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| wm_anatomia_2026   | [Anatomia subskrypcji. Dlaczego Polacy wciąż nie chcą płacić za treści](https://www.wirtualnemedia.pl/anatomia-subskrypcji-dlaczego-polacy-wciaz-nie-chca-placic-za-tresci,7269873205061760a)                                                                                             | Wirtualnemedia.pl (Rafał Badowski)                                                           | 2026-05-13                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| pie_2021           | [76 proc. internautów nie rozumie, czemu miałoby płacić za dostęp do artykułów w sieci (raport ‘Modele biznesowe mediów po pandemii’)](https://pie.net.pl/wp-content/uploads/2021/12/2021_06_08_76-proc.-internautow-nie-rozumie-czemu-mialoby-placic-za-dostep-do-artykulow-w-sieci.pdf) | Polski Instytut Ekonomiczny                                                                  | 2021-06-08 (badanie CAWI 7–10.12.2020, N=1017)                                  | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| stripe_pl_pricing  | [Stripe Pricing – Poland](https://stripe.com/en-pl/pricing)                                                                                                                                                                                                                               | Stripe                                                                                       | dostęp 2026-10-18                                                               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| lenfest_2019       | [One subscriber or 48,000 page views? Why journalists should know the ‘unit economics’ of digital news](https://www.lenfestinstitute.org/?p=2690)                                                                                                                                         | The Lenfest Institute for Journalism (Matt Skibinski)                                        | 2019-10-07                                                                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| chatham_membership | [Individual membership – Chatham House](https://www.chathamhouse.org/become-member/individual-membership)                                                                                                                                                                                 | Chatham House (Royal Institute of International Affairs)                                     | dostęp 2026-10 (odczyt z wyników wyszukiwania; strona zwraca 403 dla automatów) | nie da się sprawdzić (link niedostępny): Strona i /become-member zwracają 403 dla WebFetch i curl. Weryfikacja przez wyszukiwarkę była niemożliwa, bo wyczerpał się budżet wyszukiwań. Kwot 345/195/220/190 GBP i wpisowego 50 GBP nie potwierdziłem. Oznacz kotwicę jako niezweryfikowaną (confidence niska) albo zastąp ją sprawdzalnym cennikiem, np. polskiego think tanku lub serwisu eksperckiego. Uwaga merytoryczna: to członkostwo INDYWIDUALNE, a nie licencja B2B na stanowisko.                                                                                                                                                                                                                                   |

## 4. Lejek i konwersja

### V2R: Konwersja odwiedzający → rejestracja (Visitor-to-registration conversion rate)

- **Rozwinięcie:** V2R – Visitor-to-Registration Rate: odsetek odwiedzających, którzy zakładają bezpłatne konto (registration wall, konto freemium, rejestracja do newslettera z kontem) / V2R – Visitor-to-Registration Rate: share of visitors who create a free account (registration wall, freemium account)
- **Wzór:** Przepływ: nowe rejestracje w okresie / unikalni odwiedzający w okresie × 100%. Wariant stanu (known users): rozpoznani/zalogowani unikalni użytkownicy w miesiącu / wszyscy unikalni użytkownicy w miesiącu × 100%. Wariant regwall: rejestracje / unikalne wyświetlenia modalu rejestracji × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jak skutecznie zamieniamy anonimowy ruch w rozpoznanych czytelników, z którymi da się budować relację (newsletter, CRM) i którzy wg Piano kupują 30–45 razy częściej niż anonimowi. Zawsze czytaj go z mianownikiem: udział rozpoznanych wśród wszystkich użytkowników (zwykle 1–3%) to inna wielkość niż konwersja samego modalu rejestracji (kilka procent). Pułapki: rejestracje jednorazowe (zakładanie kont na różne maile dla dostępu do jednego tekstu), boty w mianowniku oraz regwall przed paywallem, który obniża ekspozycję ofert płatnych.
- **Interpretation (EN):** Shows how well anonymous traffic is turned into known readers who can be nurtured (newsletter, CRM) and who, per Piano, buy 30–45 times more often than anonymous users. Always read it with its denominator: the known-user share of all users (typically 1–3%) is a different quantity from the conversion of the registration modal itself (a few percent). Pitfalls: throwaway registrations, bots in the denominator, and a registration wall placed before the paywall that reduces paid-offer exposure.

**Kontekst:** Wydawca cyfrowy (metered/freemium) – udział rozpoznanych (zarejestrowanych/zalogowanych) wśród miesięcznych unikalnych użytkowników · okres: miesięcznie · metoda: mediany Piano (IX 2024: 1,2%) i Mather (Q2 2022: 1,5%) oraz best-in-class Mather (3,3%); próg krytyczny heurystyczny · źródła: piano_2024, mather_2022, piano_nypa_2025

| Ocena     | Przedział | Uwagi                                                   |
| --------- | --------- | ------------------------------------------------------- |
| krytyczny | < 0,5     | praktycznie brak identyfikacji czytelników – heurystyka |
| słaby     | 0,5–1,2   | poniżej mediany Piano 2024                              |
| normalny  | 1,2–1,5   | między medianą Piano a medianą Mather                   |
| dobry     | 1,5–3,3   | powyżej mediany, poniżej best-in-class Mather           |
| optymalny | ≥ 3,3     | poziom best-in-class Mather                             |

**Kontekst:** Registration wall – unikalne wyświetlenia modalu rejestracji → rejestracja · okres: miesięcznie / cały okres działania regwalla · metoda: heurystyka zakotwiczona w studium przypadku Mather (3,14% średnio, mały wydawca z Ameryki Płn.); brak publicznego przekrojowego benchmarku · źródła: mather_regwall, piano_inma_2023

| Ocena     | Przedział | Uwagi                                                      |
| --------- | --------- | ---------------------------------------------------------- |
| krytyczny | < 1       | heurystyka                                                 |
| słaby     | 1–2       | heurystyka                                                 |
| normalny  | 2–4       | okolice 3,14% z case study Mather                          |
| dobry     | 4–8       | heurystyka                                                 |
| optymalny | ≥ 8       | heurystyka – typowe dla ruchu bezpośredniego/z newslettera |

**Kontekst:** SaaS B2B / konto freemium lub trial (np. konto instytucjonalne) – odwiedzający → założenie konta · okres: miesięcznie · metoda: ChartMogul 2026: 9% dla freemium, 4,5% dla triali, 3,5% dla triali z kartą; First Page Sage 2025: 13,3% odwiedzający→freemium (organic) jako górna kotwica; dolne progi heurystyczne · źródła: chartmogul_2026, fps_2025

| Ocena     | Przedział | Uwagi                                               |
| --------- | --------- | --------------------------------------------------- |
| krytyczny | < 2       | heurystyka                                          |
| słaby     | 2–5       | poziom triali bez karty (4,5%) – dla freemium słabo |
| normalny  | 5–9       | do wartości typowej freemium ChartMogul (9%)        |
| dobry     | 9–13,3    | między ChartMogul a First Page Sage                 |
| optymalny | ≥ 13,3    | powyżej średniej First Page Sage (organic)          |

**Zastrzeżenia:**

- Piano (2023): wprowadzenie registration wall przed paywallem obniżyło odsetek użytkowników widzących ofertę płatną średnio o 36% – mierz V2R razem z odsetkiem trafiających na paywall.
- Kontekst registration wall opiera się na jednym studium przypadku Mather (ok. 2022) – przedziały mają charakter heurystyczny.
- Benchmarki SaaS (ChartMogul, First Page Sage) dotyczą stron produktowych, nie serwisów treściowych – stosuj je do ścieżek B2B (konto instytucjonalne, trial dla firm).
- Brak publicznych danych dla Polski; mediany Piano i Mather pochodzą głównie z rynków USA/globalnego.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst wydawcy (udział rozpoznanych): przedział normalny 1,2–1,5 jest sztucznie wąski, bo jego obie granice to mediany z różnych prób (Piano global 2022–2024 i Mather, głównie prasa lokalna USA, 2022). Dla spójności z V2P (mediana jako granica normalny/dobry): krytyczny <0,5; słaby 0,5–0,8; normalny 0,8–1,2 (do mediany Piano); dobry 1,2–3,3; optymalny ≥3,3. W notatce dopisać, że 3,3% to „best-in-class” Mather (średnia rynków wzorcowych wybranych indeksem, nie percentyl). Okres danych Piano 2024 poprawić na I 2022 – IX 2024. Kontekst SaaS: ChartMogul 9% / 4,5% / 3,5% to przykład ilustracyjny, nie mediana, więc oznaczyć jako heurystykę z confidence 'niska'. Rozdzielić modele, bo dla triala z kartą 2–3,5% to norma (FPS 2,5% organic / 2,2% paid, ChartMogul 3,5%), a obecny zestaw oznacza ją jako słabą. Proponowane osobne progi: freemium normalny 5–9, dobry 9–13,3, optymalny ≥13,3 (FPS: 13,3% organic, 15,9% paid); trial opt-in normalny 4,5–8,5 i dobry ≥8,5 (FPS 8,5%); trial opt-out normalny 2,5–3,5 i dobry ≥3,5.

### R2P: Konwersja zarejestrowany → płacący (Registered-to-paid conversion rate)

- **Rozwinięcie:** R2P – Registered-to-Paid Rate: odsetek zarejestrowanych (bezpłatnych) użytkowników, którzy kupują płatny dostęp / R2P – Registered-to-Paid Rate: share of registered (free) users who purchase paid access
- **Wzór:** Kohortowo: zarejestrowani w miesiącu M, którzy kupili płatny dostęp w ciągu 12 mies. / wszyscy zarejestrowani w miesiącu M × 100%. Wariant stanu (newsletter freemium): płacący subskrybenci / wszyscy subskrybenci newslettera × 100%.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, czy rejestracja jest realnym pomostem do płatności, a nie tylko zbieraniem adresów. Wg Piano zarejestrowani kupują 30–45 razy częściej niż anonimowi, ale średnio tylko ok. 3% z nich kupuje w ciągu roku, a konwersja rozkłada się w czasie (ok. 21% konwersji w 1. miesiącu, ponad 40% w miesiącach 2–12). Pułapki: mieszanie wskaźnika kohortowego ze stanem, zbyt krótkie okno pomiaru oraz traktowanie mnożnika vs anonimowi jako efektu przyczynowego (zarejestrowani są z definicji bardziej zaangażowani).
- **Interpretation (EN):** Measures whether registration is a real bridge to payment rather than mere address collection. Per Piano, registered users buy 30–45 times more often than anonymous ones, yet on average only about 3% buy within a year, and conversions are spread over time (about 21% in month 1, over 40% in months 2–12). Pitfalls: mixing cohort and stock definitions, too short a measurement window, and reading the multiplier vs anonymous users as causal (registered users are self-selected and more engaged).

**Kontekst:** Wydawca cyfrowy – kohorta zarejestrowanych, zakup w ciągu 12 miesięcy od rejestracji · okres: kohorta 12-miesięczna · metoda: średnia ok. 3% (Piano 2022 via Digiday) i zakres od ok. 0,5% do ponad 12% między wydawcami (Piano 2022); progi pośrednie interpolowane heurystycznie · źródła: digiday_2022, piano_2022_pr, piano_nypa_2025, piano_inma_2023

| Ocena     | Przedział | Uwagi                                    |
| --------- | --------- | ---------------------------------------- |
| krytyczny | < 0,5     | poniżej dolnego krańca zakresu Piano     |
| słaby     | 0,5–1,5   | heurystyka                               |
| normalny  | 1,5–3     | do średniej Piano (ok. 3%)               |
| dobry     | 3–8       | powyżej średniej                         |
| optymalny | ≥ 8       | zbliżenie do najlepszych serwisów (>12%) |

**Kontekst:** Newsletter freemium – płacący / wszyscy subskrybenci listy (stan) · okres: stan na koniec miesiąca · metoda: kwartyle beehiiv 2026: mediana 0,62%, górne 25% ok. 2–5%, górne 10% w kategoriach finanse/ekonomia 20–31%; próg krytyczny heurystyczny · źródła: beehiiv_2026

| Ocena     | Przedział | Uwagi                                |
| --------- | --------- | ------------------------------------ |
| krytyczny | < 0,2     | heurystyka                           |
| słaby     | 0,2–0,62  | poniżej mediany beehiiv              |
| normalny  | 0,62–2    | mediana – dolna granica P75          |
| dobry     | 2–5       | zakres P75 (top 25%)                 |
| optymalny | ≥ 5       | powyżej P75; P90 w ekonomii do 30,8% |

**Zastrzeżenia:**

- Dane kohortowe Piano pochodzą z raportu 2022 – nowszej publicznej liczby R2P w okresie 12 mies. nie znaleziono; Piano 2024/2025 podaje jedynie mnożnik 30× względem anonimowych.
- W teście Piano (2023) zarejestrowani konwertowali 12,52% vs 0,07% anonimowych na tej samej ofercie – to efekt selekcji, nie dowód, że wymuszenie rejestracji podniesie sprzedaż (w 2 z 4 testów ścieżka przez rejestrację przegrała).
- Benchmark beehiiv dotyczy płatnych newsletterów na platformie beehiiv (głównie anglojęzycznych), a nie think tanków; liczy stan, nie kohortę.
- Do panelu: pokazuj rozkład czasu do konwersji (0–30, 31–90, 91–365 dni), bo okno pomiaru zmienia wynik.

**Poprawki weryfikacji (do naniesienia):**

- Poprawić caveat: w teście Piano/INMA 2023 ścieżka przez rejestrację przegrała w 3 z 4 testów (3× „Result: NO”, 1× „YES”), nie w 2 z 4. W metodzie zaznaczyć, że 3% to średnia/odsetek ogólny (Digiday), nie mediana, a rozkład 0,5–12% jest prawoskośny, więc mediana jest prawdopodobnie niższa. Granica 3% między normalnym a dobrym może zostać, ale z notatką „średnia, nie mediana” i confidence 'średnia/niska'. Kontekst newslettera: P90 dla finansów/ekonomii zapisać jako 18,7–30,8% (Investing 18,69%, Finance 20,00%, Economy 30,80%); progi bez zmian.

### V2P: Konwersja odwiedzający → płacący (paid conversion rate wydawcy) (Visitor-to-paid conversion rate (publisher paid conversion rate))

- **Rozwinięcie:** V2P – Visitor-to-Paid Rate: relacja płacących subskrybentów do zasięgu (stan, definicja INMA) lub nowych płatnych subskrypcji do miesięcznych użytkowników (przepływ) / V2P – Visitor-to-Paid Rate: paying subscribers relative to reach (stock, INMA definition) or new paid subscriptions relative to monthly users (flow)
- **Wzór:** Stan (INMA): aktywni płacący subskrybenci cyfrowi / średni miesięczny zasięg unikalnych użytkowników × 100%. Przepływ: nowe płatne subskrypcje w miesiącu / unikalni użytkownicy w miesiącu × 100% (Mather raportuje to jako konwersje na 1 mln użytkowników).
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Główny wskaźnik efektywności modelu reader revenue: jaka część zasięgu płaci. Stan pokazuje skumulowany efekt (akwizycja minus churn), przepływ – bieżącą skuteczność sprzedaży. Pułapki: wskaźnik rośnie także wtedy, gdy spada ruch (mniejszy mianownik), definicje się różnią (unikalni vs sesje, triale i mocno przecenione subskrypcje w liczniku), a małe, celowe zasięgi niszowych marek eksperckich dają naturalnie wyższe wartości niż media masowe.
- **Interpretation (EN):** The core efficiency metric of a reader-revenue model: what share of reach pays. The stock view shows the cumulative effect (acquisition minus churn), the flow view shows current selling effectiveness. Pitfalls: the ratio also rises when traffic falls (smaller denominator), definitions differ (uniques vs sessions, trials and deeply discounted subs in the numerator), and small targeted audiences of niche expert brands naturally yield higher values than mass media.

**Kontekst:** Wydawca cyfrowy – stan: płacący subskrybenci / miesięczni unikalni użytkownicy (definicja INMA) · okres: stan miesięczny · metoda: mediana 0,6% i górny kwartyl ≥1,4% (INMA, 166 wydawców, koniec 2022, via Press Gazette 2024): P50–P75 = dobry, >P75 = optymalny; progi poniżej mediany heurystyczne · źródła: pressgazette_2024, dnr_2026, dnr_2026_pl

| Ocena     | Przedział | Uwagi                                                                        |
| --------- | --------- | ---------------------------------------------------------------------------- |
| krytyczny | < 0,2     | heurystyka                                                                   |
| słaby     | 0,2–0,4   | heurystyka                                                                   |
| normalny  | 0,4–0,6   | do mediany INMA                                                              |
| dobry     | 0,6–1,4   | mediana – górny kwartyl INMA                                                 |
| optymalny | ≥ 1,4     | górny kwartyl INMA; liderzy specjalistyczni (Barron's, The Athletic) ok. 20% |

**Kontekst:** Wydawca cyfrowy – przepływ: nowe płatne subskrypcje w miesiącu / miesięczni unikalni użytkownicy · okres: miesięcznie · metoda: Mather Q2 2022: mediana 513 konwersji na 1 mln użytkowników (0,051%), best-in-class 1263 (0,126%); iloczyn ekspozycji i konwersji Piano XII 2024 (16,3% × 0,20% ≈ 0,033%) jako kotwica przedziału normalnego (wyliczenie własne) · źródła: mather_2022, piano_nypa_2025

| Ocena     | Przedział   | Uwagi                                                    |
| --------- | ----------- | -------------------------------------------------------- |
| krytyczny | < 0,01      | poniżej 100 konwersji na 1 mln użytkowników – heurystyka |
| słaby     | 0,01–0,03   | heurystyka                                               |
| normalny  | 0,03–0,051  | od poziomu wynikającego z danych Piano do mediany Mather |
| dobry     | 0,051–0,126 | mediana – best-in-class Mather                           |
| optymalny | ≥ 0,126     | best-in-class Mather (1263 / mln)                        |

**Zastrzeżenia:**

- Sufit popytu w Polsce jest niższy: wg Reuters Institute DNR 2026 za newsy online płaci 11% Polaków (−2 pp r/r) wobec 17% średnio w 20 krajach.
- Najnowsza publiczna mediana INMA dotyczy końca 2022 r.; nowsze dane INMA Subscription Benchmarks są dostępne tylko dla członków.
- Nie porównuj wariantu stanu z przepływem – różnią się o rząd wielkości.
- Dla think tanku z małym, eksperckim zasięgiem wartość >1,4% stanu jest osiągalna; oceniaj trend razem z liczbą unikalnych użytkowników.

**Poprawki weryfikacji (do naniesienia):**

- Usunąć etykietę „definicja INMA” z formuły stanu: Press Gazette nie podaje definicji INMA, a jej własny ranking liczy subskrybentów do średniej miesięcznej liczby odwiedzających (Similarweb). Zapis: „subskrybenci cyfrowi / średni miesięczny zasięg (definicje wydawców się różnią)”. Do caveatu o Polsce dopisać, że według metodologii DNR zmiana o −2 pp nie jest istotna statystycznie, a 17% to pay basket 20 krajów z powszechnymi paywallami. Progi bez zmian. Zaznaczyć, że mediana INMA pochodzi z końca 2022 r. (najnowsza publicznie dostępna).

### PSCR: Konwersja paywalla (trafienie na paywall → subskrypcja) (Paywall conversion rate (paywall stop to subscription))

- **Rozwinięcie:** PSCR – Paywall Stop Conversion Rate: odsetek użytkowników zatrzymanych przez paywall lub ofertę płatną, którzy kupują subskrypcję (u Piano: paid conversion rate) / PSCR – Paywall Stop Conversion Rate: share of users stopped by the paywall or a paid offer who buy a subscription (Piano: paid conversion rate)
- **Wzór:** unikalni użytkownicy, którzy kupili subskrypcję po zobaczeniu paywalla/oferty płatnej / unikalni użytkownicy, którzy zobaczyli ≥1 paywall lub ofertę płatną × 100% (miesięcznie)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Efektywność samego momentu sprzedaży: typowo ok. 0,2%, czyli ok. 2 zakupy na 1000 zatrzymanych; w badaniu Notre Dame/Georgia Tech 59,2% czytelników po trafieniu na paywall od razu opuszczało serwis. Wskaźnik spada mechanicznie, gdy zaostrzamy paywall (zatrzymujemy też mniej zaangażowanych), choć łączna sprzedaż może rosnąć – oceniaj go zawsze razem z odsetkiem trafiających na paywall i konwersją na 1 mln użytkowników. Nie mieszaj konwersji na unikalnego użytkownika z konwersją na wyświetlenie.
- **Interpretation (EN):** Effectiveness of the selling moment itself: typically about 0.2%, i.e. roughly 2 purchases per 1,000 users stopped; in the Notre Dame/Georgia Tech study 59.2% of readers left the site immediately after hitting the paywall. The rate falls mechanically when the paywall is tightened (less engaged users get stopped too) even if total sales grow, so always read it together with paywall hit rate and conversions per million users. Do not mix per-user and per-impression conversion.

**Kontekst:** Paywall metered/freemium/hybrydowy wydawcy cyfrowego – unikalni zatrzymani → zakup · okres: miesięcznie · metoda: mediany: Piano XII 2024 0,20% globalnie (Europa 0,15%, USA 0,34%), Mather Q2 2022 0,22%, best-in-class Mather 0,58%; potwierdzenie: Notre Dame/Georgia Tech 2026 (~0,2% zatrzymań kończy się zakupem); próg krytyczny heurystyczny · źródła: piano_nypa_2025, mather_2022, notre_dame_2026, piano_inma_2023

| Ocena     | Przedział | Uwagi                                               |
| --------- | --------- | --------------------------------------------------- |
| krytyczny | < 0,05    | heurystyka; dolny decyl Piano 2023 ok. 0,02%        |
| słaby     | 0,05–0,15 | poniżej mediany europejskiej Piano                  |
| normalny  | 0,15–0,22 | mediana Europa – mediana Mather/Piano global        |
| dobry     | 0,22–0,58 | powyżej mediany do best-in-class Mather             |
| optymalny | ≥ 0,58    | best-in-class Mather; najlepsi u Piano do ok. 3,95% |

**Zastrzeżenia:**

- Piano (dane II 2025), mediana konwersji wg szablonu oferty: landing page 2,73%, hard paywall 0,11%, soft paywall 0,011%, ribbon (pasek) 0,005% – inne szablony wymagają osobnych progów.
- Europa konwertuje słabiej niż USA (Piano XII 2024: 0,15% vs 0,34%) – dla polskiego wydawcy realistyczny punkt odniesienia to mediana europejska.
- Mather (2024, 118 serwisów): zaostrzenie paywalla podwoiło liczbę prób sprzedaży (+100%) przy spadku konwersji o 20%, co netto dało więcej subskrypcji.
- INMA: najszybciej rosnące marki (dane 2019–2021) miały średnio 0,36% – dane historyczne.
- Badanie Notre Dame/Georgia Tech: ok. 10% zatrzymań kończy się obejściem paywalla (81% obejść przez nową tożsamość przeglądarki) – szczelność paywalla wpływa na mianownik.

**Poprawki weryfikacji (do naniesienia):**

- Notatkę przedziału krytycznego zmienić z „dolny decyl Piano 2023 ok. 0,02%” na „najniższa wartość (Bottom) w rozkładzie Piano, I 2023: 0,02%”. Analogicznie 3,95% to wartość „Top”, nie decyl. Dodać kontekst: mediana paid conversion u Piano w I 2023 spadła do ok. 0,11–0,12%, a do XII 2024 odbiła do 0,20%. Usunąć caveat „INMA: najszybciej rosnące marki (2019–2021) 0,36%” albo dodać do niego źródło, bo nie ma go na liście sources. Datę Mather intercept poprawić na 24.06.2024. Same progi są poprawne.

### T2P: Konwersja okresu próbnego na płatny (trial → paid) (Trial-to-paid conversion rate)

- **Rozwinięcie:** T2P – Trial-to-Paid Rate: odsetek użytkowników okresu próbnego, którzy przechodzą na płatny plan; opt-in = trial bez karty, opt-out = karta wymagana z góry i automatyczne obciążenie po trialu / T2P – Trial-to-Paid Rate: share of trial users who convert to a paid plan; opt-in = no card required, opt-out = card required upfront with automatic charge after the trial
- **Wzór:** użytkownicy, którzy po zakończeniu trialu dokonali pierwszej płatności / użytkownicy, którzy rozpoczęli trial w kohorcie × 100% (osobno dla opt-in i opt-out)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** Pokazuje, czy trial przekonuje do zapłaty. Trial z kartą konwertuje kilkukrotnie lepiej (ChartMogul 2026: ponad 5×), ale zbiera mniej rejestracji, więc porównuj też liczbę płacących na 1000 odwiedzających. Pułapki: opt-out liczy często jako konwersję już jedną płatność (zestawiaj z churnem 2.–3. miesiąca), a mieszanie kohort opt-in/opt-out w jednym wskaźniku daje bezużyteczną średnią.
- **Interpretation (EN):** Shows whether the trial persuades users to pay. Card-required trials convert several times better (ChartMogul 2026: over 5x) but attract fewer sign-ups, so also compare paying customers per 1,000 visitors. Pitfalls: opt-out conversion often counts a single payment (pair it with month 2–3 churn), and blending opt-in and opt-out cohorts yields a meaningless average.

**Kontekst:** Trial opt-in (bez karty) – SaaS/B2B, w tym dostęp instytucjonalny · okres: kohorta trialu (pomiar do 6 mies. od rejestracji) · metoda: ChartMogul 2026 (200 produktów B2B): good 4–6%, great 10–15%, mediana wszystkich modeli 8%, 20% produktów <2,5%; First Page Sage 2025: 18,2% (organic) jako pułap · źródła: chartmogul_2026, fps_2025

| Ocena     | Przedział | Uwagi                                 |
| --------- | --------- | ------------------------------------- |
| krytyczny | < 2,5     | najsłabsze 20% produktów (ChartMogul) |
| słaby     | 2,5–4     | poniżej progu good                    |
| normalny  | 4–8       | good 4–6% do mediany ogólnej 8%       |
| dobry     | 8–15      | do górnej granicy great               |
| optymalny | ≥ 15      | poziom First Page Sage (18,2%)        |

**Kontekst:** Trial opt-out (karta wymagana z góry) · okres: kohorta trialu · metoda: ChartMogul 2026: mediana 30%, good 25–35%, great 50–60%; First Page Sage 2025: 48,8% organic / 51% paid; RevenueCat 2026 (aplikacje): 25,5–42,5% wg długości trialu · źródła: chartmogul_2026, fps_2025, revenuecat_2026

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | < 15      | heurystyka                 |
| słaby     | 15–25     | poniżej progu good         |
| normalny  | 25–35     | good; mediana 30%          |
| dobry     | 35–50     | do poziomu First Page Sage |
| optymalny | ≥ 50      | great (50–60%)             |

**Zastrzeżenia:**

- W mediach triale to wyjątek: wg Piano (2025) darmowy trial oferuje tylko 8% klientów-wydawców, a subskrypcje bez triala mają lepszą retencję.
- First Page Sage liczy konwersję opt-out już po jednym płatnym miesiącu – wynik zawyżony względem trwałej konwersji.
- Europa Zachodnia (RevenueCat 2026, aplikacje): mediana trial→paid 29,7%, niżej niż Ameryka Płn. (34,2%); triale 17–32 dni: 42,5% vs ≤4 dni: 25,5%.
- Karta z góry zmniejsza rejestracje (ChartMogul: 3,5% vs 4,5% odwiedzających), ale daje 10,5 vs 3,6 płacących na 1000 odwiedzających.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst opt-in trzeba przebudować, bo w ChartMogul good = P50 (4–6%), a great = P75 (10–15%), a 8% to mediana wszystkich modeli łącznie z trialami z kartą. Nowe progi: krytyczny <2,5 (dolne 20% ChartMogul); słaby 2,5–4; normalny 4–6 (przedział P50); dobry 6–12 (P50–P75); optymalny ≥12 (środek przedziału P75 10–15%). FPS 18,2% traktować tylko jako górną kotwicę (klienci agencji). Kontekst opt-out bez zmian, ale w metodzie dopisać good = P50 (25–35%, mediana 30%) i great = P75 (50–60%). W źródle poprawić „200 produktów B2B” na „200 produktów (22% B2C/hybrydowe)”. Caveat Piano uściślić do brzmienia: „subskrypcje bez triala mają lepszą retencję niż płatne triale”. RevenueCat: dane za 2025, data publikacji niepotwierdzona.

### CAR: Wskaźnik porzucenia checkoutu / koszyka (Checkout / cart abandonment rate)

- **Rozwinięcie:** CAR – Checkout (Cart) Abandonment Rate: odsetek rozpoczętych procesów zakupu (checkout lub koszyk), które nie kończą się płatnością / CAR – Checkout (Cart) Abandonment Rate: share of started purchase flows (checkout or cart) that do not end in payment
- **Wzór:** Checkout subskrypcji: (1 − zakończone płatności / rozpoczęte checkouty) × 100%. E-commerce/bilety (Baymard): (1 − złożone zamówienia / utworzone koszyki) × 100%.
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, ile osób z gotową intencją zakupu gubimy w formularzu i płatności – to zwykle najtańsza do odzyskania strata w lejku. Wynik zależy krytycznie od definicji startu (klik Subskrybuj, wejście na stronę płatności, dodanie do koszyka), więc w panelu trzymaj jedną definicję. Pułapki: płatności odroczone (przelew, faktura pro forma w B2B) liczone jako porzucenia oraz wymuszanie zakładania konta/hasła w trakcie płatności.
- **Interpretation (EN):** Shows how many people with clear purchase intent are lost in the form and payment step – usually the cheapest funnel leak to fix. The value depends heavily on how a start is defined (Subscribe click, payment page view, add-to-cart), so keep one definition in the dashboard. Pitfalls: deferred payments (bank transfer, B2B pro-forma invoice) counted as abandonments, and forcing account/password creation mid-checkout.

**Kontekst:** Checkout subskrypcji cyfrowej (start checkoutu → brak płatności) · okres: miesięcznie · metoda: odwrotność mediany INMA Q2 2026 (38% ukończeń → 62% porzuceń; 149 marek); mediana INMA ok. 2024 (18% ukończeń → 82%) jako granica słabego; Piano 2022 desktop 42,4% ukończeń; skrajne progi heurystyczne · źródła: inma_checkout_2026, inma_7reasons, piano_2022_pr

| Ocena     | Przedział | Uwagi                                             |
| --------- | --------- | ------------------------------------------------- |
| optymalny | < 45      | heurystyka – poziom dobrych checkoutów e-commerce |
| dobry     | 45–62     | lepiej niż mediana INMA 2026                      |
| normalny  | 62–75     | okolice mediany INMA 2026                         |
| słaby     | 75–85     | poziom mediany branży sprzed 2 lat (82%)          |
| krytyczny | ≥ 85      | heurystyka                                        |

**Kontekst:** E-commerce / sprzedaż biletów i publikacji – porzucenie koszyka (definicja Baymard) · okres: miesięcznie · metoda: średnia 70,22% z 50 badań (zakres 55,00–84,27%), Baymard IX 2025; progi wokół średniej i skrajnych wartości badań · źródła: baymard_2025

| Ocena     | Przedział | Uwagi                                            |
| --------- | --------- | ------------------------------------------------ |
| optymalny | < 55      | poniżej najniższego wyniku w zestawieniu Baymard |
| dobry     | 55–65     | lepiej niż średnia                               |
| normalny  | 65–75     | okolice średniej 70,22%                          |
| słaby     | 75–84,27  | do najwyższego wyniku w zestawieniu              |
| krytyczny | ≥ 84,27   | powyżej najwyższego wyniku w zestawieniu         |

**Zastrzeżenia:**

- Dane INMA 2026 pochodzą z fragmentu artykułu dostępnego w wyszukiwarce (strona INMA odrzuca pobranie, HTTP 403) – zweryfikuj przy aktualizacji.
- Baymard: 18% porzuca z powodu wymogu założenia konta, 17% przez zbyt długi/skomplikowany proces, 19% przez brak zaufania do podania karty, 40% przez dodatkowe koszty; naprawa użyteczności checkoutu może podnieść konwersję o 35,26%.
- INMA: w amerykańskim badaniu z 2019 r. 85% użytkowników rezygnowało, gdy checkout prosił o hasło.
- Mobile porzuca znacznie częściej: Piano 2022 – 19,7% ukończeń na mobile vs 42,4% na desktopie.
- Brak benchmarków dla polskich metod płatności (BLIK, szybkie przelewy) – heurystyka: brak lokalnych metod podnosi porzucenia.

**Poprawki weryfikacji (do naniesienia):**

- Kotwice kontekstu subskrypcji (INMA 38% → 62% porzuceń, INMA 18% → 82%) są niezweryfikowalne (403 Cloudflare), dlatego confidence tego kontekstu trzeba obniżyć do 'niska'. Jako jedyną zweryfikowaną kotwicę podać Piano 2022: 42,4% ukończeń na desktopie (57,6% porzuceń) i 19,7% na mobile (80,3% porzuceń). Progi mogą zostać, ale do weryfikacji. Kontekst Baymard: w metodzie dopisać, że 55–84,27% to rozrzut średnich z 50 badań (część sprzed ponad 10 lat), a nie percentyle sklepów.

### CCR: Konwersja checkoutu (Checkout conversion rate)

- **Rozwinięcie:** CCR – Checkout Conversion Rate (u INMA: check-out flow efficiency): odsetek rozpoczętych checkoutów zakończonych płatnością / CCR – Checkout Conversion Rate (INMA: check-out flow efficiency): share of started checkouts that end in a completed payment
- **Wzór:** zakończone płatności / rozpoczęte checkouty (np. klik Subskrybuj na paywallu lub wejście na stronę płatności) × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy sprawność ostatniego kroku lejka: formularza, logowania i bramki płatniczej. Wg INMA mediana dla serwisów informacyjnych wzrosła z 18% do 38% w dwa lata, więc wynik poniżej 25% oznacza wyraźne tarcie (np. wymuszone konto, brak płatności mobilnych). Pułapki: liczenie startu od wyświetlenia strony oferty (zaniża wynik) albo od wpisania karty (zawyża) oraz brak podziału na urządzenia.
- **Interpretation (EN):** Measures the efficiency of the last funnel step: form, login and payment gateway. Per INMA the median for news sites rose from 18% to 38% in two years, so a value under 25% signals clear friction (forced account, no mobile wallets). Pitfalls: counting the start from an offer page view (understates) or from card entry (overstates), and not splitting by device.

**Kontekst:** Checkout subskrypcji cyfrowej (start checkoutu → płatność) · okres: miesięcznie · metoda: mediana INMA Q2 2026: 38% (149 marek z 318); Piano 2022: 42,4% desktop / 19,7% mobile; górne progi heurystyczne, zakotwiczone w kwartylach e-commerce (Cartylabs) · źródła: inma_checkout_2026, inma_7reasons, piano_2022_pr, cartylabs_2026

| Ocena     | Przedział | Uwagi                                                |
| --------- | --------- | ---------------------------------------------------- |
| krytyczny | < 15      | heurystyka                                           |
| słaby     | 15–25     | okolice mediany z ok. 2024 (18%) i mobile Piano 2022 |
| normalny  | 25–38     | do mediany INMA Q2 2026                              |
| dobry     | 38–55     | mediana – górny kwartyl (heurystyka)                 |
| optymalny | ≥ 55      | poziom górnego kwartyla checkoutów e-commerce        |

**Kontekst:** E-commerce (np. sklep z publikacjami, bilety) – rozpoczęcie checkoutu → zamówienie · okres: miesięcznie · metoda: kwartyle Cartylabs V 2026 (dane z >5000 sklepów Shopify): dolny kwartyl 28–38%, mediana 38–48%, górny kwartyl 52–60%, top 10% 60–75% · źródła: cartylabs_2026, baymard_2025

| Ocena     | Przedział | Uwagi               |
| --------- | --------- | ------------------- |
| krytyczny | < 28      | dolne 10%           |
| słaby     | 28–38     | dolny kwartyl       |
| normalny  | 38–48     | przedział mediany   |
| dobry     | 48–60     | do górnego kwartyla |
| optymalny | ≥ 60      | top 10%             |

**Zastrzeżenia:**

- Cartylabs to źródło dostawcy, bez pełnej metodologii; wartości podane jako przedziały.
- Dane INMA 2026 z fragmentu artykułu (strona za zabezpieczeniem) – potwierdź przy aktualizacji.
- INMA 2026: na odcinku zatrzymanie przez paywall → zakup najlepsze 10% marek konwertuje 5× większy odsetek zatrzymanych niż najsłabsze 10%.
- Raportuj osobno desktop/mobile oraz B2C/B2B (faktura, przelew odroczony).

**Poprawki weryfikacji (do naniesienia):**

- Jak dla CAR: obniżyć confidence kontekstu subskrypcji do 'niska' do czasu weryfikacji INMA Q2 2026 (38%) i INMA ok. 2024 (18%). Zweryfikowane kotwice: Piano 2022 desktop 42,4% i mobile 19,7%. Kontekst e-commerce zgadza się z Cartylabs: słaby 28–38 to pasmo „bottom 25%” (ok. P10–P25), a krytyczny <28 to dolne 10%. Dopisać, że źródło jest dostawcą bez metodologii.

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

**Kontekst:** SaaS B2B / oferta instytucjonalna – strona cennika → trial, rejestracja lub zapytanie demo · okres: miesięcznie · metoda: heurystyka zakotwiczona w SaasDash V 2026: mediana 3–6%, górny kwartyl 8–12% (źródło bez metodologii); enterprise z CTA demo 1–3% · źródła: saasdash_2026

| Ocena     | Przedział | Uwagi                              |
| --------- | --------- | ---------------------------------- |
| krytyczny | < 1       | heurystyka                         |
| słaby     | 1–3       | poziom enterprise z samym CTA demo |
| normalny  | 3–6       | przedział mediany wg SaasDash      |
| dobry     | 6–10      | do górnego kwartyla                |
| optymalny | ≥ 10      | górny kwartyl 8–12% i wyżej        |

**Zastrzeżenia:**

- Brak niezależnego, publicznego badania konwersji stron cennika; SaasDash nie podaje metodologii ani próby – traktuj jako heurystykę.
- Mediana Piano 2,73% dotyczy szablonu landing page w narzędziu Piano (mianownik: unikalni, którzy zobaczyli ofertę), a nie dowolnej strony cennika.
- Dla oferty B2B z ceną na zapytanie mierz osobno konwersję do zapytania i zapytanie → umowa (CRM).

**Poprawki weryfikacji (do naniesienia):**

- Kontekst SaaS B2B rozbić według typu sprzedaży, bo obecny zestaw ocenia medianę enterprise (1–3%) jako „słabą”. Dla oferty instytucjonalnej NES z ceną na zapytanie (CTA demo/kontakt): krytyczny <0,5; słaby 0,5–1; normalny 1–3 (mediana enterprise wg SaasDash); dobry 3–6 (do górnego kwartyla 4–6%); optymalny ≥6. Dla self-serve: normalny 4–6, dobry 6–10, optymalny ≥10 (top quartile 10–14%). Confidence pozostaje 'niska' (SaasDash bez źródeł).

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

**Zastrzeżenia:**

- Dane Omnisend i Wisepops pochodzą głównie z e-commerce (zachętą bywa rabat); u wydawcy zachętą jest treść, więc wyniki mogą być niższe.
- Omnisend 2025: tylko desktop 1,4% vs mobile 2,2%; koło fortuny 3,5%; Wisepops: exit-intent 3,94%, wieloetapowe 5,17% vs jednoetapowe 4,62%.
- Top 10% Wisepops (57,7%) obejmuje popupy otwierane kliknięciem – nie porównuj z popupami automatycznymi.
- Klaviyo od 1 IV 2025 zmieniło filtrowanie botów w analityce formularzy – wyniki sprzed i po zmianie są nieporównywalne (zasada ogólna: oczyszczaj mianownik z botów).

**Poprawki weryfikacji (do naniesienia):**

- Poprawić caveat i excerpt Omnisend: 2,2% to popupy wyświetlane jednocześnie na desktopie i mobile, a nie „mobile 2,2%”; tylko desktop to 1,4% (wykres: 1,3%). Usunąć albo uźródłowić caveat o zmianie filtrowania botów w Klaviyo (1 IV 2025), bo nie ma go na liście sources. Progi bez zmian.

### AR: Wskaźnik aktywacji (Activation rate)

- **Rozwinięcie:** AR – Activation Rate: odsetek nowych użytkowników (zarejestrowanych lub nowych subskrybentów), którzy w zadanym oknie osiągnęli zdefiniowany moment pierwszej wartości / AR – Activation Rate: share of new users (registered users or new subscribers) who reach a defined first-value milestone within a set window
- **Wzór:** nowi użytkownicy w kohorcie, którzy w ciągu X dni wykonali zdarzenie aktywacji (np. 3 artykuły premium + zapis do newslettera; rejestracja na wydarzenie; dołączenie do klubu) / wszyscy nowi zarejestrowani w kohorcie × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mówi, jaka część nowych kont dochodzi do realnej wartości, a więc ma szansę zostać i zapłacić. Najważniejsze jest dobranie zdarzenia aktywacji, które przewiduje retencję co najmniej 2× lepiej niż jego brak (Lenny's Newsletter). Pułapki: zbyt łatwe zdarzenie (samo zalogowanie) zawyża wynik, a benchmarki o innej definicji (Amplitude: powrót w 7. dniu; Userpilot: wykonanie kluczowej akcji) nie są porównywalne.
- **Interpretation (EN):** Shows what share of new accounts reach real value and are therefore likely to stay and pay. The key is choosing an activation event that predicts retention at least 2x better than not reaching it (Lenny's Newsletter). Pitfalls: an event that is too easy (a mere login) inflates the result, and benchmarks with different definitions (Amplitude: day-7 return; Userpilot: key action completed) are not comparable.

**Kontekst:** Produkt cyfrowy / SaaS B2B – nowi użytkownicy, którzy osiągnęli kamień milowy wartości · okres: kohorta (okno 7–14 dni) · metoda: mediana Lenny 2022 (25% ogółem, 30% SaaS) i Userpilot 2025 (mediana 37,04%, średnia 37,5%; 62 firmy B2B); górny próg = najlepsza branża Userpilot (AI&ML 54,8%); próg krytyczny heurystyczny (najsłabsze branże 5–8,3%) · źródła: userpilot_2025, lenny_2022

| Ocena     | Przedział | Uwagi                               |
| --------- | --------- | ----------------------------------- |
| krytyczny | < 10      | poziom najsłabszych branż Userpilot |
| słaby     | 10–25     | poniżej mediany Lenny               |
| normalny  | 25–37     | mediana Lenny – mediana Userpilot   |
| dobry     | 37–55     | powyżej mediany Userpilot           |
| optymalny | ≥ 55      | powyżej najlepszej branży Userpilot |

**Kontekst:** Aktywacja mierzona powrotem w 7. dniu (definicja Amplitude: odsetek kohorty nowych użytkowników aktywnych w D7) · okres: kohorta D7 · metoda: Amplitude 2025 (ponad 2600 firm): 7% = próg górnego kwartyla; mediana produktów enterprise 2,1%, top 10% enterprise 12,4% · źródła: amplitude_2025

| Ocena     | Przedział | Uwagi                           |
| --------- | --------- | ------------------------------- |
| krytyczny | < 1       | heurystyka                      |
| słaby     | 1–2,1     | poniżej mediany enterprise      |
| normalny  | 2,1–7     | mediana – próg górnego kwartyla |
| dobry     | 7–12,4    | górny kwartyl                   |
| optymalny | ≥ 12,4    | top 10% (enterprise)            |

**Zastrzeżenia:**

- Userpilot to dane własne klientów (62 firmy B2B), Lenny – ankieta z 2022 r. (ponad 500 odpowiedzi, samodeklaracje); oba nie dotyczą wydawców.
- Amplitude: 69% produktów z najlepszą aktywacją D7 było też w czołówce retencji po 3 miesiącach – aktywacja jest wczesnym predyktorem retencji.
- Dla think tanku zdefiniuj osobne zdarzenia aktywacji dla czytelnika zarejestrowanego, subskrybenta płatnego i członka klubu; brak publicznych benchmarków dla tych definicji.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst Amplitude D7 miesza populacje: 7% to przekrojowy próg P75, a 2,1% (mediana) i 12,4% (top 10%) dotyczą tylko produktów enterprise. Albo opisać to wprost w notatkach („2,1 i 12,4 – produkty enterprise; 7 – P75 wszystkich branż”) i obniżyć confidence do 'niska', albo zostawić tylko pewny próg: dobry ≥7 (P75), a resztę oznaczyć jako heurystykę. Kontekst SaaS: dla B2B użyć mediany Lenny dla SaaS (30%), a nie ogólnej (25%), i oznaczyć dane Lenny jako ankietę z 2022 r.

### TTV: Czas do wartości (Time to value)

- **Rozwinięcie:** TTV – Time to Value: czas od rejestracji lub zakupu do pierwszego momentu, w którym użytkownik otrzymuje obiecaną wartość / TTV – Time to Value: time from sign-up or purchase to the first moment the user receives the promised value
- **Wzór:** mediana (czas zdarzenia wartości − czas rejestracji/zakupu) w kohorcie, w godzinach; użytkownicy bez zdarzenia wartości raportowani osobno jako odsetek
- **Jednostka:** hours · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Im szybciej nowy czytelnik lub subskrybent dostaje wartość (pełny tekst premium, pierwszy newsletter, zaproszenie na wydarzenie), tym mniejsze ryzyko wczesnej rezygnacji – wg Piano 13% wyłączeń automatycznego odnowienia następuje już pierwszego dnia, a 40% w ciągu 60 dni. Raportuj medianę, nie średnią, bo rozkład ma długi ogon. Pułapka: osoby, które nigdy nie doszły do wartości, wypadają ze średniej i sztucznie poprawiają wynik.
- **Interpretation (EN):** The faster a new reader or subscriber gets value (full premium article, first newsletter, event invite), the lower the risk of early cancellation – per Piano, 13% of auto-renew disablements happen on day one and 40% within 60 days. Report the median, not the mean, because the distribution has a long tail. Pitfall: users who never reach value drop out of the average and artificially improve it.

**Kontekst:** SaaS B2B / dostęp instytucjonalny – rejestracja → pierwsze zdarzenie wartości · okres: kohorta · metoda: średnia Userpilot 2025: 1 d 12 h 23 min (ok. 36,4 h; 62 firmy B2B); najlepsza branża CRM 1 d 4 h 43 min, najsłabsza HR 3 d 18 h 59 min; granica 7 dni wg zalecenia Amplitude (wartość najlepiej w pierwszym tygodniu) – heurystyka · źródła: userpilot_2025, amplitude_media_2025

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

- Userpilot nie podaje mediany ani metodologii pomiaru TTV; dane z 62 firm B2B – niska porównywalność z serwisem treściowym.
- Kontekst wydawcy jest w całości heurystyczny – brak publicznego benchmarku TTV dla mediów i think tanków.
- Zdarzenie wartości musi być spójne z definicją aktywacji (activation_rate).

**Poprawki weryfikacji (do naniesienia):**

- Dopisać do metody, że strona Userpilot obok średniej 36,4 h pokazuje nieopisaną wartość 1 d 1 h 54 min (ok. 25,9 h), być może medianę. Przy potwierdzeniu granicę optymalny/dobry (24 h) można zostawić, a granicę dobry/normalny przesunąć na ok. 26 h. Na razie progi bez zmian, confidence 'niska'.

### PHR: Odsetek użytkowników trafiających na paywall (Paywall hit rate (share of users hitting the paywall))

- **Rozwinięcie:** PHR – Paywall Hit Rate (także stop rate u INMA, exposure rate u Piano): odsetek miesięcznych unikalnych użytkowników, którzy co najmniej raz zobaczyli paywall lub płatną ofertę / PHR – Paywall Hit Rate (INMA: stop rate; Piano: exposure rate): share of monthly unique users who saw the paywall or a paid offer at least once
- **Wzór:** unikalni użytkownicy, którzy w miesiącu co najmniej raz zobaczyli paywall/płatną ofertę / wszyscy unikalni użytkownicy w miesiącu × 100%
- **Jednostka:** % · **Kierunek:** optimum w przedziale · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, jak szeroko otwieramy drzwi do sprzedaży: zbyt niski oznacza brak okazji do konwersji (Mather 2022: 85% użytkowników omijało paywalle), zbyt wysoki w modelu freemium oznacza utratę zasięgu, ruchu z wyszukiwarek i przyszłych subskrybentów. To wskaźnik docelowego przedziału – optimum zależy od modelu (freemium/hybryda vs twardy paywall) i od tego, czy wzrost PHR zwiększa łączną liczbę sprzedaży. Pułapka: podnoszenie PHR obniża konwersję paywalla, więc oceniaj oba wskaźniki razem.
- **Interpretation (EN):** Measures how widely the door to a sale is opened: too low means no conversion opportunities (Mather 2022: 85% of users eluded paywalls), too high in a freemium model means lost reach, search traffic and future subscribers. It is a target-range metric – the optimum depends on the model (freemium/hybrid vs hard wall) and on whether a higher PHR increases total sales. Pitfall: raising PHR lowers paywall conversion, so evaluate both together.

**Kontekst:** Wydawca freemium/metered/hybrydowy (model NES) · okres: miesięcznie · metoda: mediany: Mather VI 2025 22,8% (VI 2024: 15,1%), INMA 2026 31% (317 marek), Piano XII 2024 16,3% (Europa 20,4%); INMA Q2 2026: większość serwisów freemium/hybrydowych zatrzymuje ≤25%, twarde ≥56%; przedział optymalny – heurystyka · źródła: mather_q2_2025, inma_nyt_reach, inma_shadow_2026, inma_ceiling_2026, piano_nypa_2025, mather_2022, mather_intercept_2024

| Ocena     | Przedział | Uwagi                                                                                |
| --------- | --------- | ------------------------------------------------------------------------------------ |
| krytyczny | < 5       | paywall praktycznie niewidoczny – brak okazji do sprzedaży                           |
| słaby     | 5–12      | znacznie poniżej median 2024–2026                                                    |
| normalny  | 12–18     | okolice mediany Piano XII 2024 (16,3%)                                               |
| optymalny | 18–30     | mediana Mather 2025 (22,8%); INMA: freemium/hybryda ≤25%, mediana <30% widzi paywall |
| dobry     | 30–40     | powyżej mediany INMA (31%) – monitoruj utratę zasięgu                                |
| słaby     | ≥ 40      | dla freemium zbyt szczelnie – zbliżenie do twardego paywalla (≥56%)                  |

**Kontekst:** Twardy paywall (hard wall) · okres: miesięcznie · metoda: INMA Q2 2026 (318 marek): większość serwisów z twardym paywallem zatrzymuje ≥56% użytkowników miesięcznie; paywalle uruchomione przed 2019 r. zatrzymują ok. 50% · źródła: inma_shadow_2026, inma_nyt_reach

| Ocena    | Przedział | Uwagi                                                            |
| -------- | --------- | ---------------------------------------------------------------- |
| słaby    | < 30      | nietypowo nisko dla twardego paywalla – sprawdź reguły i wycieki |
| normalny | 30–56     | heurystyka                                                       |
| dobry    | ≥ 56      | typowe dla twardego paywalla wg INMA                             |

**Zastrzeżenia:**

- Dane INMA 2026 (31%, ≥56%, ≤25%) pochodzą z fragmentów artykułów INMA dostępnych w wyszukiwarce (strona odrzuca pobranie, HTTP 403) – zweryfikuj przy aktualizacji.
- INMA Q2 2026: serwisy freemium/hybrydowe miały o 67% wyższy zasięg (penetracja gospodarstw domowych) niż twarde paywalle.
- Mather 2024: zaostrzenie paywalla dało +100% prób sprzedaży przy −20% konwersji; obniżenie limitu z 3 do 2 darmowych artykułów dotyka więcej czytelników niż podniesienie z 3 do 4.
- Piano 2023: rozrzut ekspozycji między wydawcami od 0,01% do 87,4% – mediana ma sens tylko w obrębie tego samego modelu paywalla.
- Europa (Piano XII 2024: 20,4%) eksponuje oferty częściej niż USA (13,8%).

**Poprawki weryfikacji (do naniesienia):**

- Etykieta „słaby” występuje w dwóch pasmach (5–12 i ≥40), co psuje rozróżnienie w UI. Zmienić je na „słaby (za mało ekspozycji)” i „słaby (zbyt szczelnie)”. Kotwice INMA (31%, ≤25%, ≥56%, <30%) są niezweryfikowalne (403), więc kontekst „Twardy paywall” oprzeć na nich z confidence 'niska'. W kontekście freemium zweryfikowane kotwice to Mather VI 2025 22,8% (VI 2024 15,1%), Piano XII 2024 16,3% (Europa 20,4%) i Mather Q2 2022 14,3% / best-in-class 20,3%. Przedział optymalny 18–30 jest z nimi zgodny. Nowsze dane: Mather Q1 2026 North America (26.05.2026) oraz miesięczne German/UK Audience Benchmarks 2026, wszystkie za formularzem. Pozyskać je przy aktualizacji, bo niemieckie są bliższe rynkowi PL.

### Źródła grupy: Lejek i konwersja

| Id                    | Źródło                                                                                                                                                                                                                               | Wydawca                                                                                         | Data                             | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| piano_nypa_2025       | [Piano Benchmarks – prezentacja na NYPA Spring Conference (Mar2025_NYPA_Benchmarks_Belyus)](https://nynewspapers.com/wp-content/uploads/2025/04/Mar2025_NYPA_Benchmarks_Belyus.pdf)                                                  | Piano / New York Press Association                                                              | 2025-03                          | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| piano_inma_2023       | [Maximising subscription performance: insights from 500+ publishers worldwide (A. Kreybig)](https://www.inma.org/files/docs/article/2023subsummit/Piano-SubscriptionSummit-Workshops.pdf)                                            | Piano / INMA Media Subscriptions Summit                                                         | 2023-03                          | częściowo: Potwierdzone: obie definicje (exposure rate, paid conversion rate), exposure Top 87,4% / Bottom 0,01% oraz paid conversion Top 3,95% / Bottom 0,02% (I 2023), test 12,52% vs 0,07% i spadek ekspozycji o 36% po wprowadzeniu regwalla. BŁĄD w caveacie R2P: deck pokazuje 4 testy, z których 3 kończą się wynikiem „Result: NO” (duży serwis; drogi serwis B2B; średni/duży serwis, gdzie regwall offer 0,11% vs paywall offer 0,15%), a tylko 1 wynikiem „YES”. Ścieżka przez rejestrację przegrała więc w 3 z 4 testów, nie w 2 z 4. Etykiety Top/Bottom to krańce rozkładu, nie decyle, więc 0,02% nie jest „dolnym decylem”. Brakujący kontekst: mediana paid conversion spadła w I 2023 do ok. 0,11–0,12% (z 0,44% na początku 2021), a mediana ekspozycji wynosiła ok. 8,8%. |
| piano_2024            | [Subscription Performance Benchmarks 2024 Report](https://www.piano.io/marketing/content/subscription-performance-benchmarks-2024)                                                                                                   | Piano                                                                                           | 2024 (dane Q3 2022–Q3 2024)      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| piano_2022_pr         | [Piano Releases 2022 Subscription Performance Benchmark Report](https://resources.piano.io/resources/piano-releases-2022-subscription-performance-benchmark-report/)                                                                 | Piano                                                                                           | 2022-07-13                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| digiday_2022          | [Media Briefing: Publishers use registration walls as subscription bridges](https://digiday.com/media/media-briefing-publishers-use-registration-walls-as-subscription-bridges/)                                                     | Digiday                                                                                         | 2022-07-21                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_2022           | [Listener Digital Audience Benchmarking Report – September 2022 (Q2 2022)](https://www.mathereconomics.com/wp-content/uploads/2022/11/Mather-Economics-Subscription-Digital-Audience-Mini-Benchmarking-Report-September-2022.pdf)    | Mather Economics                                                                                | 2022-09                          | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_q2_2025        | [Essential Insights for Publishers: Q2 2025 U.S. Subscription Benchmarking Report](https://www.mathereconomics.com/download-mathers-q2-2025-u-s-benchmarking-report-2/)                                                              | Mather Economics                                                                                | 2025-08 (data przybliżona)       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_regwall        | [How Registration Walls Impact Subscriber Growth](https://www.mathereconomics.com/?p=5461)                                                                                                                                           | Mather Economics                                                                                | 2022-02 (data przybliżona)       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| mather_intercept_2024 | [Paywall Intercept Rates on Closed and Open News Sites Yield Revenue Optimization Insights](https://www.mathereconomics.com/2024/06/17/paywall-intercept-rates-on-closed-and-open-news-sites-yield-revenue-optimisation-insights/)   | Mather Economics                                                                                | 2024-06-17                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| pressgazette_2024     | [Newsbrand subscriber conversion rates: biggest reader-funded newsbrands ranked](https://pressgazette.co.uk/media-audience-and-business-data/newsbrand-subscriber-conversion-rates-biggest-reader-funded-newsbrands-ranked/)         | Press Gazette                                                                                   | 2024-07-11                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| inma_checkout_2026    | [News check-outs have overtaken online retail (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/news-check-outs-have-overtaken-online-retail)                                                                        | INMA – Readers First blog                                                                       | 2026-09-08                       | nie da się sprawdzić (link niedostępny): Strona zwraca HTTP 403 z wyzwaniem Cloudflare (WebFetch i bezpośredni curl), więc nie świadczy to o martwym linku. Limit wyszukiwań w tej turze był wyczerpany i nie dało się ponownie sprawdzić fragmentu z wyszukiwarki. Liczby 38% (Q2 2026), 149 z 318 marek i 5× pozostają niezweryfikowane. Do czasu weryfikacji w przeglądarce obniżyć confidence kontekstów checkoutu subskrypcji do 'niska'.                                                                                                                                                                                                                                                                                                                                                |
| inma_7reasons         | [Here are 7 reasons digital news subscriptions are stagnating](https://www.inma.org/blogs/reader-revenue/post.cfm/here-are-7-reasons-digital-news-subscriptions-are-stagnating)                                                      | INMA – Readers First blog                                                                       | 2024-02 (data przybliżona)       | nie da się sprawdzić (link niedostępny): HTTP 403 (Cloudflare). Mediana 18%, porównanie z 30% w e-commerce (Baymard) i dane z 2019 r. (85%) są niezweryfikowane, data artykułu też (2024-02 jest przybliżona). Spójność pośrednia: 30% e-commerce zgadza się z odwrotnością 70,22% porzuceń wg Baymard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| inma_nyt_reach        | [New York Times shares its strategy of reach, free content in subscription growth (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/new-york-times-shares-its-strategy-of-reach-free-content-in-subscription-growth) | INMA – Readers First blog                                                                       | 2026 (data dokładna nieustalona) | nie da się sprawdzić (link niedostępny): HTTP 403 (Cloudflare). Mediana stop rate 31% (317 marek) i 50% dla paywalli sprzed 2019 r. są niezweryfikowane, data publikacji nieustalona.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| inma_shadow_2026      | [How long is the shadow of The New York Times' paywall? (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/how-long-is-the-shadow-of-the-new-york-times-paywall)                                                      | INMA – Readers First blog                                                                       | 2026-08 (data przybliżona)       | nie da się sprawdzić (link niedostępny): HTTP 403 (Cloudflare). Wartości ≥56% (hard wall), ≤25% (freemium/hybryda) i +67% zasięgu są niezweryfikowane. Cały kontekst „Twardy paywall” w PHR opiera się wyłącznie na tym źródle, więc należy mu dać confidence 'niska'.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| inma_ceiling_2026     | [There is no subscription ceiling – there is a Web site ceiling (G. Piechota)](https://www.inma.org/blogs/reader-revenue/post.cfm/there-is-no-subscription-ceiling-there-is-a-web-site-ceiling)                                      | INMA – Readers First blog                                                                       | 2026-10-04                       | nie da się sprawdzić (link niedostępny): HTTP 403 (Cloudflare). Źródłem liczby „<30%” jest zapowiedź artykułu w serwisie X, czyli najsłabszy typ źródła. Nie używać jej jako kotwicy przedziału, najwyżej jako kontekst.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| notre_dame_2026       | [Subscription required: Newspaper paywalls scatter most readers but provide surprising value](https://news.nd.edu/news/subscription-required-newspaper-paywalls-scatter-most-readers-but-provide-surprising-value/)                  | University of Notre Dame News (badanie Kanuri, Overby, Pattabhiramaiah; MIS Quarterly, w druku) | 2026-06-16                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| dnr_2026              | [Digital News Report 2026 – Executive summary](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/dnr-executive-summary)                                                                                            | Reuters Institute for the Study of Journalism                                                   | 2026-06-16                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| dnr_2026_pl           | [Digital News Report 2026 – Poland (V. Makarenko)](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/poland)                                                                                                       | Reuters Institute for the Study of Journalism                                                   | 2026-06-16                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| beehiiv_2026          | [The State of Paid Newsletters 2026](https://www.beehiiv.com/blog/the-state-of-paid-newsletters-2026)                                                                                                                                | beehiiv                                                                                         | 2026-06-22                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| chartmogul_2026       | [The SaaS Conversion Report](https://chartmogul.com/reports/saas-conversion-report/)                                                                                                                                                 | ChartMogul / ProductLed (K. Poyar)                                                              | 2026-02-04                       | częściowo: Potwierdzone (04.02.2026, badanie z I 2026, okno 6 miesięcy): mediana 8% dla wszystkich modeli, trial z kartą 30% (>5×), good/great: trial bez karty 4–6%/10–15%, z kartą 25–35%/50–60%, freemium 3–5%/8–12%, 20% produktów z trialem <2,5%, 10,5 vs 3,6 płacących na 1000. Trzy korekty: (1) good = P50, a great = P75 (według opisu wykresu), więc mediana triala bez karty to 4–6%, a 8% (wszystkie modele, łącznie z trialami z kartą) nie może być kotwicą opt-in. (2) Wartości odwiedzający→rejestracja (9% / 4,5% / 3,5%) to przykład ilustracyjny („Freemium products see 90 free signups…”), a nie mediana. (3) Próba to 200 produktów, w tym 22% głównie B2C lub hybrydowych, więc nie wyłącznie B2B.                                                                    |
| fps_2025              | [SaaS Free Trial Conversion Rate Benchmarks](https://firstpagesage.com/seo-blog/saas-free-trial-conversion-rate-benchmarks/)                                                                                                         | First Page Sage                                                                                 | 2025-09-05                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| revenuecat_2026       | [State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps)                                                                                                                                             | RevenueCat                                                                                      | 2026-03                          | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| baymard_2025          | [Cart Abandonment Rate Statistics](https://baymard.com/lists/cart-abandonment-rate)                                                                                                                                                  | Baymard Institute                                                                               | 2025-09-22                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| cartylabs_2026        | [Shopify Checkout Conversion Benchmarks 2026: What's Actually Good?](https://cartylabs.com/blog/shopify-checkout-conversion-benchmarks/)                                                                                             | Cartylabs                                                                                       | 2026-05-13                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| omnisend_2026         | [Email popup statistics](https://www.omnisend.com/blog/email-popup-statistics/)                                                                                                                                                      | Omnisend                                                                                        | 2026-02-09                       | częściowo: Potwierdzone (09.02.2026): 1,24 mld wyświetleń, średnia 2,1% (2,3% w 2024), progi <1,5 / 1,5–3 / 3–5 / 5%+, koło fortuny 3,5%. BŁĄD w caveacie i w excerpcie: 2,2% dotyczy popupów wyświetlanych jednocześnie na desktopie i mobile („shown on both desktop and mobile”), a nie samego mobile. Tylko desktop to 1,4% (wykres: 1,3%). Infografika podaje 2,0% / 1,21 mld, więc w tekście są drobne rozbieżności.                                                                                                                                                                                                                                                                                                                                                                    |
| wisepops_2025         | [Popup Statistics (Based on 1B Displays) – raport 2026](https://wisepops.com/blog/popup-stats)                                                                                                                                       | Wisepops                                                                                        | 2025-09-30                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| userpilot_2025        | [SaaS Product Metrics Benchmark Report](https://userpilot.com/saas-product-metrics/)                                                                                                                                                 | Userpilot                                                                                       | 2025-09-12                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| lenny_2022            | [What is a good activation rate](https://www.lennysnewsletter.com/p/what-is-a-good-activation-rate)                                                                                                                                  | Lenny's Newsletter (L. Rachitsky, Y. Timen)                                                     | 2022-10-25                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| amplitude_2025        | [The 7% retention rule](https://www.amplitude.com/blog/7-percent-retention-rule)                                                                                                                                                     | Amplitude (M. Morales)                                                                          | 2025-09-30                       | częściowo: Potwierdzone (30.09.2025, M. Morales): 7% powrotów w D7 to próg górnego kwartyla (przekrojowo, ponad 2600 firm), a 69% najlepszych w D7 było też najlepszych po 3 miesiącach. ROZBIEŻNOŚĆ METODY: mediana 2,1% i top 10% 12,4% dotyczą wyłącznie produktów enterprise, a 7% to próg dla wszystkich branż. Przedziały mieszają więc dwie populacje. Artykuł nie podaje mediany przekrojowej ani wartości D7 dla mediów i B2B.                                                                                                                                                                                                                                                                                                                                                       |
| amplitude_media_2025  | [Media & entertainment product benchmarks](https://amplitude.com/blog/media-entertainment-product-benchmarks)                                                                                                                        | Amplitude                                                                                       | 2025-12-23                       | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| saasdash_2026         | [SaaS Pricing Page Conversion: Benchmarks, Anatomy, and a Testing Framework](https://saasdash.ai/blog/pricing-page-conversion-saas)                                                                                                  | SaasDash.ai                                                                                     | 2026-05-10                       | częściowo: Potwierdzone (10.05.2026): mediana ogólna 3–6% i top quartile 8–12% (cennik → trial/demo), brak źródeł i metodologii. Uzupełnienie wartości segmentowych: self-serve mediana 4–6% / top 10–14%, mid-market 3–5% / 7–10%, enterprise z samym CTA demo 1–3% / 4–6%, freemium 8–15% / 20–30%. Przy obecnych przedziałach mediana segmentu enterprise (1–3%) dostaje ocenę „słaby”.                                                                                                                                                                                                                                                                                                                                                                                                    |

## 5. E-mail i newsletter

### OR: Wskaźnik otwarć (Open Rate)

- **Rozwinięcie:** Open Rate: odsetek dostarczonych wiadomości, które zarejestrowano jako otwarte (unikalne otwarcia) / Open Rate: share of delivered emails registered as opened (unique opens)
- **Wzór:** unikalne otwarcia / (wysłane − odbicia) × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mówi, jaka część dostarczonych e-maili została zarejestrowana jako otwarta. Mierzy więc rozpoznawalność nadawcy, siłę tematu i pośrednio dostarczalność. Od iOS 15 Apple Mail Privacy Protection (MPP) z góry pobiera piksel śledzący, przez co otwarcia są zawyżone. Według Litmus Apple Mail to ok. 77% śledzonych otwarć (IX 2026), a MPP dotyczy ok. 55–60% otwarć. OR czytaj więc jako trend wewnętrzny i sygnał ostrzegawczy dostarczalności, a decyzje opieraj na CTR/CTOR i konwersji. Pułapki: różne mianowniki (wysłane vs dostarczone), różne filtrowanie botów u dostawców usług e-mail (ESP) i skok OR bez wzrostu kliknięć, który zwykle wynika z MPP lub skanerów, a nie z realnego zainteresowania.
- **Interpretation (EN):** Shows what share of delivered emails registered an open: a proxy for sender recognition, subject-line strength and, indirectly, deliverability. Since iOS 15, Apple Mail Privacy Protection (MPP) preloads tracking pixels and inflates opens (Litmus: Apple Mail ~77% of tracked opens in Sep 2026; MPP affects ~55–60% of opens), so treat OR as an internal trend and deliverability warning signal and base decisions on CTR/CTOR and conversions. Pitfalls: different denominators (sent vs delivered), different bot filtering across ESPs, and OR spikes without click growth, which usually come from MPP or scanners rather than real interest.

**Kontekst:** Newslettery wydawców mediowych (B2B + B2C), bez korekty MPP · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 24,6%, P50 31,6%, P75 38,5%); próg krytyczny = P25 − (P50 − P25) (heurystyka) · źródła: src_omeda_h1_2026, src_litmus_market_share_2026

| Ocena     | Przedział | Uwagi                                     |
| --------- | --------- | ----------------------------------------- |
| krytyczny | < 17,6    | poniżej P25 − (P50−P25)                   |
| słaby     | 17,6–24,6 | poniżej P25                               |
| normalny  | 24,6–31,6 | P25–P50                                   |
| dobry     | 31,6–38,5 | P50–P75; mediana B2B media 30,9%          |
| optymalny | ≥ 38,5    | powyżej P75; mediana B2C/enthusiast 40,2% |

**Kontekst:** Polska, wszystkie branże (dane ESP) · okres: na kampanię · metoda: mediana ± heurystyka: mediana PL 36,05% (MailerLite, XII 2024–XI 2025), średnia PL 38,07% (GetResponse, dane 2023); próg optymalny ≈ mediana Europy 45,08% · źródła: src_mailerlite_2025, src_getresponse_2024

| Ocena     | Przedział | Uwagi                        |
| --------- | --------- | ---------------------------- |
| krytyczny | < 20      |                              |
| słaby     | 20–30     |                              |
| normalny  | 30–38     | obejmuje medianę PL          |
| dobry     | 38–46     |                              |
| optymalny | ≥ 46      | powyżej mediany europejskiej |

**Kontekst:** Non-profit / think tank / NGO · okres: na kampanię · metoda: zakres median/średnich źródeł (Mailchimp 40,04% [dane do XII 2023], MailerLite 52,38% [2025], GetResponse 54,54% [dane 2023]) + heurystyka · źródła: src_mailerlite_2025, src_getresponse_2024, src_mailchimp_2023

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 25      |       |
| słaby     | 25–35     |       |
| normalny  | 35–48     |       |
| dobry     | 48–55     |       |
| optymalny | ≥ 55      |       |

**Kontekst:** B2B, edukacja wyższa, doradztwo, biznes i finanse · okres: na kampanię · metoda: mediana ± heurystyka: MailerLite 2025 (biznes i finanse 43,34%, konsulting 45,96%, szkolnictwo wyższe 43,98%); GetResponse (edukacja 41,33%, dane 2023); Mailchimp (biznes+finanse 31,35%, edukacja 35,64%) · źródła: src_mailerlite_2025, src_getresponse_2024, src_mailchimp_2023

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 20      |       |
| słaby     | 20–30     |       |
| normalny  | 30–40     |       |
| dobry     | 40–47     |       |
| optymalny | ≥ 47      |       |

**Kontekst:** Newslettery treściowe (kreatorzy, niezależni wydawcy; próba GlueLetter, bez filtrowania MPP) · okres: na wysyłkę (Q1 2025) · metoda: kwartyle źródła (P25 37,40%, P50 49,33%, P75 61,50%, P90 68,96%); próg krytyczny = P25 − (P50 − P25) · źródła: src_glueletter_open_q1_2025

| Ocena     | Przedział | Uwagi        |
| --------- | --------- | ------------ |
| krytyczny | < 25,5    |              |
| słaby     | 25,5–37,4 |              |
| normalny  | 37,4–49,3 |              |
| dobry     | 49,3–61,5 |              |
| optymalny | ≥ 61,5    | P90 = 68,96% |

**Zastrzeżenia:**

- Apple MPP zawyża otwarcia (Litmus: Apple Mail 76,56% udziału w otwarciach, IX 2026). Przy liście z dużym udziałem iPhone'ów OR może rosnąć bez zmiany zachowań czytelników.
- Benchmarki ESP (MailerLite, GetResponse, Mailchimp) nie są korygowane o MPP. Omnisend i Klaviyo raportują wyraźnie niższe OR (ok. 30–31%), co najpewniej wynika z innej metodologii. Porównuj tylko w obrębie tej samej metodologii.
- GetResponse publikuje edycję „Updated for 2024” z danymi z 2023 r. Nowszej edycji nie znaleziono.
- W panelu warto liczyć równolegle OR z wyłączeniem otwarć oznaczonych jako Apple MPP, jeśli ESP to umożliwia.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst Omeda: notatkę „mediana B2B media 30,9%” przenieść z przedziału „dobry” do „normalny”, bo 30,9% < P50 31,6%. Zmienić etykietę kontekstu „bez korekty MPP” na „Omeda nie podaje, czy wyklucza otwarcia MPP i botów”. Kontekst PL: metoda mówi „próg optymalny ≈ mediana Europy 45,08%”, a przedział zaczyna się od 46. Ustawić dobry 38–45 i optymalny ≥45, albo zmienić opis metody. W interpretacji PL i EN napisać „MPP dotyczy ok. 55–60% otwarć według badań cytowanych przez Litmus”, bo to nie są dane Litmusa. Mailchimp (dane do XII 2023) oznaczyć jako najstarsze źródło o najniższej wadze. Kontekst non-profit i B2B to heurystyka: mediany MailerLite (52,38% oraz 43–46%) wypadają w „dobry”, a nie na granicy normalny/dobry jak w konwencji kwartylowej. Opisać to w polu method.

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

**Kontekst:** Non-profit / think tank: newslettery i komunikacja ogólna · okres: na kampanię · metoda: zakres źródeł: MailerLite non-profit 2,90% (2025), Mailchimp 3,27% (dane do XII 2023), GetResponse 6,70% (dane 2023) + heurystyka · źródła: src_mailerlite_2025, src_mailchimp_2023, src_getresponse_2024

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,8     |       |
| słaby     | 0,8–1,5   |       |
| normalny  | 1,5–3     |       |
| dobry     | 3–5       |       |
| optymalny | ≥ 5       |       |

**Kontekst:** B2B, edukacja wyższa, doradztwo, biznes i finanse · okres: na kampanię · metoda: mediana ± heurystyka: MailerLite 2025 (biznes i finanse 2,37%, konsulting 2,41%, szkolnictwo wyższe 2,15%); Mailchimp (biznes+finanse 2,78%, edukacja 3,02%); GetResponse (edukacja 3,17%) · źródła: src_mailerlite_2025, src_mailchimp_2023, src_getresponse_2024

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,7     |       |
| słaby     | 0,7–1,3   |       |
| normalny  | 1,3–2,4   |       |
| dobry     | 2,4–3,5   |       |
| optymalny | ≥ 3,5     |       |

**Kontekst:** Apele zbiórkowe / sprzedażowe w non-profit (fundraising) · okres: na wysyłkę (średnia roczna 2025) · metoda: średnia M+R (CTR fundraising 0,59%; advocacy 2,3%) ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                  |
| --------- | --------- | ---------------------- |
| krytyczny | < 0,2     |                        |
| słaby     | 0,2–0,4   |                        |
| normalny  | 0,4–0,75  | obejmuje średnią 0,59% |
| dobry     | 0,75–1,2  |                        |
| optymalny | ≥ 1,2     |                        |

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
- Mediany Omeda dla mediów (3,8%) są wyraźnie niższe od median ESP (6–13%). To efekt innej próby (duzi wydawcy, częste wysyłki), a nie błąd.

**Poprawki weryfikacji (do naniesienia):**

- Przedziały bez zmian. W caveacie „Mediany Omeda... efekt innej próby (duzi wydawcy, częste wysyłki)” oznaczyć wyjaśnienie jako hipotezę, bo żadne źródło go nie podaje. Dodać cytat MailerLite: przez MPP realny CTOR jest wyższy od raportowanego.

### UR: Wskaźnik wypisań (Unsubscribe Rate)

- **Rozwinięcie:** Unsubscribe Rate: odsetek dostarczonych wiadomości, po których odbiorca wypisał się z listy / Unsubscribe Rate: share of delivered emails that led the recipient to unsubscribe
- **Wzór:** wypisania / dostarczone × 100% (na wysyłkę); wariant roczny: wypisani w roku / lista na początku roku × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy dopasowanie częstotliwości i treści do oczekiwań odbiorców. Niewielka liczba wypisań jest zdrowa, bo oczyszcza listę z nieaktywnych. Kłopotem jest trend wzrostowy lub skok po konkretnej wysyłce. Pułapki: bardzo niski wskaźnik może znaczyć, że wypisanie jest trudne i ludzie klikają „spam”, co jest dużo groźniejsze (patrz spam_complaint_rate). Od 2024 r. jednoklikowe wypisanie wymagane przez Gmail i Yahoo podniosło wypisania, ale chroni reputację nadawcy.
- **Interpretation (EN):** Measures fit of cadence and content to subscriber expectations; a small number of unsubscribes is healthy list hygiene, a rising trend or a spike after a specific send is the problem. Pitfalls: a very low rate may mean opting out is hard and people hit 'spam' instead, which is far worse (see spam_complaint_rate); since 2024 Gmail/Yahoo one-click unsubscribe has raised unsubscribe rates but protects sender reputation.

**Kontekst:** Newslettery wydawców mediowych (B2B + B2C) · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 0,05%, P50 0,09%, P75 0,13%); próg krytyczny ≈ 2× mediana (heurystyka) · źródła: src_omeda_h1_2026

| Ocena     | Przedział | Uwagi       |
| --------- | --------- | ----------- |
| krytyczny | ≥ 0,2     |             |
| słaby     | 0,13–0,2  | powyżej P75 |
| normalny  | 0,09–0,13 | P50–P75     |
| dobry     | 0,05–0,09 | P25–P50     |
| optymalny | < 0,05    | poniżej P25 |

**Kontekst:** Polska i rynek ogólny, kampanie (newsletter, non-profit, B2B, edukacja) · okres: na kampanię · metoda: mediana ± heurystyka: MailerLite 2025 (ogółem 0,22%, PL 0,17%, media 0,10%, wydawnictwa 0,20%, non-profit 0,19%); GetResponse (ogółem 0,15%, PL 0,16%, newsletter 0,12%; dane 2023); Mailchimp 0,22%; Validity: 0,3% to poziom, z którym nadawcy „bywają komfortowi”, choć eroduje listę · źródła: src_mailerlite_2025, src_getresponse_2024, src_mailchimp_2023, src_validity_2026

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

**Kontekst:** Non-profit / think tank, odpływ roczny przez wypisania · okres: rocznie (% listy z początku roku) · metoda: średnia M+R 12% (2025), sektor z najwyższym odpływem 21% ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                                                                      |
| --------- | --------- | -------------------------------------------------------------------------- |
| krytyczny | ≥ 20      | poziom sektora pomocy humanitarnej, który jako jedyny notował spadek listy |
| słaby     | 13–20     |                                                                            |
| normalny  | 9–13      | obejmuje średnią 12%                                                       |
| dobry     | 6–9       |                                                                            |
| optymalny | < 6       |                                                                            |

**Zastrzeżenia:**

- MailerLite odnotował wzrost mediany wypisań z 0,08% (2024) do 0,22% (2025) i łączy go z jednoklikowym wypisem w Gmailu. Nie traktuj tego jako pogorszenia jakości treści.
- Wypisy z e-maili automatycznych są naturalnie wyższe niż z kampanii, dlatego raportuj je osobno.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst Omeda: w opisie progu krytycznego podać „≈2× mediana (0,18%), zaokrąglone do 0,2%”. Caveat MailerLite: zamiast „łączy go z jednoklikowym wypisem w Gmailu” napisać „wiąże go prawdopodobnie ze zmianami w Gmailu ułatwiającymi wypis z poziomu skrzynki”. MailerLite nie używa słowa „one-click” i pisze „likely”. Kontekst M+R: zamiast „średnia M+R 12%” napisać „wartość typowa M+R 12% (metodologia: mediany per wskaźnik)”.

### HBR: Wskaźnik twardych odbić (Hard Bounce Rate)

- **Rozwinięcie:** Hard Bounce Rate: odsetek wiadomości trwale odrzuconych (adres nie istnieje, domena nieprawidłowa) / Hard Bounce Rate: share of emails permanently rejected (address does not exist, invalid domain)
- **Wzór:** twarde odbicia / wysłane × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje jakość bazy adresowej i procesu zapisu. Dostawcy skrzynek traktują wysyłkę na nieistniejące adresy jako sygnał złych praktyk, co obniża reputację i trafianie do skrzynki odbiorczej. Każdy twardy bounce trzeba natychmiast wyciszyć (suppress). Pułapki: skoki po imporcie starych kontaktów z CRM lub z wydarzeń. Konta nieaktywne są zamykane (Yahoo po 12, Gmail po 24 miesiącach), więc listy uśpione „gniją” szybciej.
- **Interpretation (EN):** Reflects address-data quality and the sign-up process; mailbox providers treat sending to non-existent addresses as a bad-practice signal that lowers reputation and inbox placement. Every hard bounce must be suppressed immediately. Pitfalls: spikes after importing old CRM/event contacts; inactive accounts get closed (Yahoo after 12, Gmail after 24 months), so dormant lists decay faster.

**Kontekst:** Każda wysyłka marketingowa do listy z opt-in (newsletter, kampanie) · okres: na wysyłkę · metoda: progi dostawcy + średnia rynkowa + heurystyka: AWS SES zaleca <2%, ≥5% = przegląd konta, ≥10% = możliwe wstrzymanie wysyłki; średni odsetek nieistniejących adresów (unknown users) w 2025 r. wg Validity 1,46%; Validity: 0,1% twardych odbić to poziom „komfortowy” · źródła: src_aws_ses_enforcement, src_validity_2026

| Ocena     | Przedział | Uwagi                                              |
| --------- | --------- | -------------------------------------------------- |
| krytyczny | ≥ 2       | ≥5% = przegląd konta w AWS SES, ≥10% = wstrzymanie |
| słaby     | 1,5–2     |                                                    |
| normalny  | 0,5–1,5   | obejmuje średnią Validity 1,46%                    |
| dobry     | 0,2–0,5   |                                                    |
| optymalny | < 0,2     |                                                    |

**Kontekst:** Non-profit / think tank, roczny odpływ przez odbicia · okres: rocznie (% listy z początku roku) · metoda: średnia M+R 4% (2025), sektor z najwyższym odpływem 6% ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi               |
| --------- | --------- | ------------------- |
| krytyczny | ≥ 7       |                     |
| słaby     | 5–7       |                     |
| normalny  | 3–5       | obejmuje średnią 4% |
| dobry     | 2–3       |                     |
| optymalny | < 2       |                     |

**Zastrzeżenia:**

- GetResponse podaje łączny bounce (twarde i miękkie) średnio 2,33%, a dla Polski 1,13% (dane 2023). Nie porównuj go 1:1 z twardymi odbiciami.
- ZeroBounce: co najmniej 23% adresów na liście degraduje się w ciągu roku (dane 2025). Przed wysyłką do kontaktów nieaktywnych dłużej niż 12 miesięcy zweryfikuj adresy.

**Poprawki weryfikacji (do naniesienia):**

- Przedziały bez zmian. Doprecyzować, że AWS SES liczy do bounce rate tylko twarde odbicia do niezweryfikowanych domen, z okna „representative volume”. Do method dodać DeBounce (2026-02-04, bez źródła danych): „Hard bounces should stay under 0.5-1%”. Wspiera to granicę dobry/normalny przy 0,5%. Caveat GetResponse: zamiast „łączny bounce (twarde i miękkie)” napisać „bounce bez definicji, nie wiadomo, czy obejmuje miękkie”. Caveat ZeroBounce: dodać, że FAQ tej samej strony podaje 25,74% wobec 23% w treści.

### SBR: Wskaźnik miękkich odbić (Soft Bounce Rate)

- **Rozwinięcie:** Soft Bounce Rate: odsetek wiadomości czasowo niedoręczonych (pełna skrzynka, chwilowa blokada, ograniczanie przepustowości przez dostawcę) / Soft Bounce Rate: share of emails temporarily undelivered (full mailbox, temporary block, provider throttling)
- **Wzór:** miękkie odbicia / wysłane × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Sygnalizuje przejściowe problemy z doręczeniem: pełne skrzynki, przerwy serwerów, a najczęściej ograniczanie przepustowości lub czasowe blokady przy słabnącej reputacji. Pojedyncze miękkie odbicia są normalne. Groźny jest skok skupiony u jednego dostawcy (np. Outlook, WP, Onet, Interia), który zwykle oznacza problem reputacyjny, a nie jakość listy. Pułapka: adres odbijający miękko w 3–5 kolejnych wysyłkach należy traktować jak twardy bounce i wyciszyć.
- **Interpretation (EN):** Signals transient delivery issues: full mailboxes, server outages and, most often, throttling or temporary blocks as reputation weakens. Isolated soft bounces are normal; a spike concentrated at one provider (e.g., Outlook, WP, Onet, Interia) usually means a reputation problem, not list quality. Pitfall: an address soft-bouncing across 3–5 consecutive sends should be treated as a hard bounce and suppressed.

**Kontekst:** Każda wysyłka marketingowa (rynek ogólny) · okres: na wysyłkę · metoda: heurystyka oparta na wytycznych dostawców narzędzi weryfikacji (1–3% zwykle nie jest problemem; <2% jako cel) i na łącznym bounce GetResponse 2,33% (dane 2023); brak publicznego, aktualnego benchmarku pierwotnego · źródła: src_debounce_bounce, src_bounceless_bounce, src_getresponse_2024

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | ≥ 3       |       |
| słaby     | 2–3       |       |
| normalny  | 1–2       |       |
| dobry     | 0,5–1     |       |
| optymalny | < 0,5     |       |

**Zastrzeżenia:**

- Brak wiarygodnych, aktualnych benchmarków pierwotnych dla miękkich odbić. Przedziały są heurystyką ekspercką.
- Analizuj soft bounce osobno dla każdej domeny odbiorcy. Polscy dostawcy (WP, Onet, Interia, o2) nie należą do grupy MAGY (Microsoft, Apple, Gmail, Yahoo), a Validity podaje, że u dostawców regionalnych w Europie trafianie do skrzynki jest o ok. 10–25 p.p. niższe.

**Poprawki weryfikacji (do naniesienia):**

- Usunąć src_bounceless_bounce (HTTP 410). Method: „heurystyka; DeBounce (2026-02-04, bez metodologii): soft bounce 1–3% »without immediate concern«; cel <2% i próg słaby 2–3% są ostrzejsze od DeBounce, to heurystyka ekspercka”. Caveat Validity poprawić na: „regionalni dostawcy w Europie mają średni IPR 79,7%, czyli ok. 11,4 p.p. mniej niż MAGY; 10–25 p.p. to rozpiętość globalna dla wszystkich regionów”. Regułę „3–5 kolejnych miękkich odbić = twarde” oznaczyć jako heurystykę bez źródła. Confidence pozostaje „niska”.

### SCR: Wskaźnik zgłoszeń spamu (Spam Complaint Rate)

- **Rozwinięcie:** Spam Complaint Rate: odsetek wiadomości oznaczonych przez odbiorców przyciskiem „to spam” / „zgłoś jako spam” / Spam Complaint Rate: share of emails that recipients marked as spam / junk
- **Wzór:** zgłoszenia spamu / wiadomości dostarczone do skrzynki odbiorczej × 100% (definicja Google Postmaster Tools / Yahoo Sender Hub); w ESP: zgłoszenia z pętli zwrotnych (FBL) / dostarczone
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** wysoka
- **Interpretacja (PL):** To najsilniejszy sygnał reputacyjny dla Gmaila, Yahoo i Microsoftu, który bezpośrednio decyduje o trafianiu do skrzynki odbiorczej lub do spamu. Od 1 lutego 2024 r. Google wymaga utrzymania wskaźnika poniżej 0,3% i zaleca poniżej 0,10%, a Yahoo wymaga poniżej 0,3%. Pułapki: panel ESP zaniża wskaźnik, bo Gmail nie przekazuje zgłoszeń per odbiorca, więc rzeczywisty poziom sprawdzaj w Google Postmaster Tools. Zgłoszenia rosną na początku roku i przy nagłych skokach wolumenu.
- **Interpretation (EN):** The strongest reputation signal for Gmail, Yahoo and Microsoft, directly deciding inbox vs spam placement. Since 1 Feb 2024 Google requires staying below 0.3% and recommends below 0.10%; Yahoo requires below 0.3%. Pitfalls: ESP dashboards understate it because Gmail does not pass per-recipient complaints, so check the real level in Google Postmaster Tools; complaints rise at the start of the year and on sudden volume spikes.

**Kontekst:** Pomiar dostawcy skrzynek (Google Postmaster Tools / Yahoo Sender Hub), wszyscy nadawcy · okres: dziennie / kroczący 7–30 dni · metoda: progi regulacyjne Google i Yahoo (0,10% zalecane, 0,30% limit) + średnia rynkowa Validity 0,06% (2025) + heurystyka dla dolnych przedziałów; AWS SES: ≥0,1% = przegląd konta, ≥0,5% = wstrzymanie · źródła: src_google_sender_guidelines, src_yahoo_sender_hub, src_validity_2026, src_aws_ses_enforcement

| Ocena     | Przedział | Uwagi                                        |
| --------- | --------- | -------------------------------------------- |
| krytyczny | ≥ 0,3     | twardy limit Google/Yahoo; ryzyko blokad     |
| słaby     | 0,1–0,3   | powyżej zalecenia Google; przegląd w AWS SES |
| normalny  | 0,05–0,1  | obejmuje średnią Validity 0,06%              |
| dobry     | 0,02–0,05 |                                              |
| optymalny | < 0,02    |                                              |

**Kontekst:** Raport ESP z pętli FBL: newslettery wydawców mediowych · okres: na wysyłkę (mediana wydawcy, H1 2026) · metoda: kwartyle źródła (P25 0,001%, P50 0,002%, P75 0,004%); próg krytyczny 0,01% = średnia GetResponse ze wszystkich branż (heurystyka) · źródła: src_omeda_h1_2026, src_getresponse_2024

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

**Poprawki weryfikacji (do naniesienia):**

- Kontekst Omeda/FBL: notatkę progu krytycznego „0,01% = średnia GetResponse ze wszystkich branż” zmienić na „0,01% = wartość GetResponse dla newslettera, Publishing, Non-profits, Polski i Europy (ogółem <0,01%)”. Do source_ids kontekstu Postmaster dodać src_validity_2025, bo caveat cytuje ten raport w sprawie 25% respondentów. Zaznaczyć, że Validity nie podaje, że średnia 0,06% pochodzi z Postmaster Tools. AWS SES liczy skargi tylko z domen z FBL, więc bez Gmaila. Przedziały bez zmian.

### LGR: Tempo wzrostu listy (netto) (List Growth Rate (net))

- **Rozwinięcie:** List Growth Rate: procentowa zmiana liczby aktywnych, potwierdzonych subskrybentów w okresie po odjęciu odpływu / List Growth Rate: percentage change in active, confirmed subscribers over a period after subtracting attrition
- **Wzór:** (nowe potwierdzone zapisy − wypisy − adresy usunięte po odbiciach i skargach) / aktywni subskrybenci na początku okresu × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, czy pozyskiwanie subskrybentów nadąża za naturalnym odpływem. Organizacje non-profit tracą rocznie ok. 16% listy (12% wypisów i 4% odbić, M+R), a ZeroBounce szacuje degradację adresów na co najmniej 23% rocznie. Czytaj go razem z jakością nowych zapisów (CTR kohort, potwierdzenia DOI). Pułapki: liczenie zapisów brutto bez odpływu, doliczanie kontaktów importowanych bez zgody marketingowej oraz porównywanie młodej listy, która rośnie naturalnie szybko, z dojrzałymi organizacjami.
- **Interpretation (EN):** Shows whether acquisition keeps pace with natural attrition: nonprofits lose ~16% of the list per year (12% unsubscribes + 4% bounces, M+R) and ZeroBounce estimates address decay at ≥23% per year. Read together with the quality of new sign-ups (cohort CTR, DOI confirmations). Pitfalls: counting gross sign-ups without attrition, adding imported contacts without marketing consent, and comparing a young (naturally fast-growing) list with mature organisations.

**Kontekst:** Dojrzałe organizacje non-profit / think tanki (dane USA) · okres: rocznie · metoda: średnia M+R ± heurystyka: wzrost netto 5% w 2025 r. (4% w 2024, 9% w 2023); media publiczne 12% jako próg optymalny · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| krytyczny | < 0       | lista się kurczy          |
| słaby     | 0–3       |                           |
| normalny  | 3–7       | obejmuje średnią 5%       |
| dobry     | 7–12      |                           |
| optymalny | ≥ 12      | poziom mediów publicznych |

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
- Limit wyszukiwań w tej sesji wyczerpał się przed weryfikacją danych platform newsletterowych (np. beehiiv, Kit), więc kontekst „młoda lista” jest heurystyką.
- Do wzrostu wliczaj wyłącznie kontakty z ważną zgodą marketingową (RODO, prawo komunikacji elektronicznej).

**Poprawki weryfikacji (do naniesienia):**

- Zmienić „4% w 2024, 9% w 2023” na „4% i 9% w dwóch poprzednich latach (M+R nie przypisuje lat)”. „Średnia M+R” zastąpić określeniem „wartość typowa M+R (mediana lub średnia)”. Usunąć z caveatów notatkę procesową „Limit wyszukiwań w tej sesji wyczerpał się...”, bo nie jest to treść dla użytkownika panelu. Zamiast niej napisać: „kontekst młodej listy to heurystyka bez benchmarku platform newsletterowych”. W interpretacji przy ZeroBounce dopisać „(FAQ tej samej strony: 25,74%)”. Przeliczenia miesięczne 0,25%, 0,57% i 0,95% zweryfikowane jako poprawne.

### DOI CR: Wskaźnik potwierdzeń podwójnej zgody (Double Opt-In Confirmation Rate)

- **Rozwinięcie:** Double Opt-In Confirmation Rate: odsetek zapisów potwierdzonych kliknięciem w link aktywacyjny (podwójna zgoda) / Double Opt-In Confirmation Rate: share of sign-ups confirmed by clicking the activation link
- **Wzór:** potwierdzone zapisy (w oknie 7 dni) / wszystkie zapisy wymagające potwierdzenia × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Pokazuje, ile zapisów z formularzy staje się realnymi subskrybentami. Niski poziom zwykle oznacza, że e-mail potwierdzający trafia do spamu lub zakładki „Oferty”, przychodzi z opóźnieniem albo ma niejasny komunikat. Podwójna zgoda obniża konwersję formularza, ale podnosi jakość listy: w danych GetResponse listy DOI miały OR 35,72% wobec 27,36% i CTR 4,19% wobec 2,36%. Ułatwia też wykazanie zgody (art. 7 ust. 1 RODO). Pułapki: skanery linków w skrzynkach firmowych potrafią automatycznie „potwierdzić” zapis, co zawyża wskaźnik, dlatego stosuj ochronę przed kliknięciami botów.
- **Interpretation (EN):** Shows how many form sign-ups become real subscribers. A low level usually means the confirmation email lands in spam/promotions, arrives late or is unclear. DOI lowers form conversion but raises list quality (GetResponse data: DOI lists 35.72% OR vs 27.36% and CTR 4.19% vs 2.36%) and helps demonstrate consent (GDPR Art. 7(1)). Pitfalls: corporate link scanners can auto-'confirm' sign-ups and inflate the rate, so use bot-click protection.

**Kontekst:** Formularze zapisu na newsletter (B2C + B2B) · okres: na kohortę zapisów (okno 7 dni) · metoda: heurystyka oparta na zakresach dostawców (65–90%, 70–90% jako „solidny”; odpływ 10–35%); brak niezależnych benchmarków pierwotnych · źródła: src_truelist_doi_2025, src_getresponse_doi_2024, src_aws_ses_enforcement

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 45      |       |
| słaby     | 45–60     |       |
| normalny  | 60–75     |       |
| dobry     | 75–85     |       |
| optymalny | ≥ 85      |       |

**Zastrzeżenia:**

- Zakresy pochodzą od dostawców narzędzi (vendor blogs), dlatego zaufanie do nich jest niskie. Własna mediana kohort po 3 miesiącach będzie lepszym punktem odniesienia.
- GetResponse (2022): konwersja odwiedzający→subskrybent 0,33% dla DOI vs 1,28% dla SOI (pojedyncza zgoda), czyli koszt DOI w wolumenie bywa duży.
- AWS SES rekomenduje podwójną zgodę jako sposób ograniczania odbić i skarg.
- Limit wyszukiwań uniemożliwił znalezienie niezależnego badania wskaźnika potwierdzeń.

**Poprawki weryfikacji (do naniesienia):**

- Usunąć caveat procesowy „Limit wyszukiwań uniemożliwił znalezienie niezależnego badania...”. Zamiast niego napisać: „brak niezależnego badania odsetka potwierdzeń DOI”. Przedziały dopasować do typowego zakresu Truelist/Nutshell (65–90%): krytyczny <50, słaby 50–65, normalny 65–75, dobry 75–85, optymalny ≥85. W obecnym układzie normalny zaczyna się od 60, czyli poniżej typowego zakresu. Opcjonalnie dodać do interpretacji src_validity_2026: najwyższy IPR Niemiec (97,5%) Validity tłumaczy m.in. „widespread use of double opt-in”.

### Welcome OR: Wskaźnik otwarć e-maila powitalnego (Welcome Email Open Rate)

- **Rozwinięcie:** Welcome Open Rate: odsetek dostarczonych e-maili powitalnych (pierwszy e-mail po zapisie), które zarejestrowano jako otwarte / Welcome Open Rate: share of delivered welcome emails (first email after sign-up) registered as opened
- **Wzór:** unikalne otwarcia e-maila powitalnego / dostarczone e-maile powitalne × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** E-mail powitalny trafia do osoby w szczycie zainteresowania, więc powinien mieć wyraźnie wyższy OR niż zwykły newsletter: GetResponse 83,63% wobec 40,08%, Omnisend 35,53% wobec 30,41%. Niski OR powitalnego to najczęściej problem dostarczalności (spam lub zakładka „Oferty”) albo zbyt późna wysyłka. Pułapki: MPP najsilniej zawyża właśnie powitalne, bo proxy Apple pobiera piksel tuż po zapisie. Stripo pokazuje, że raportowane wartości wahają się od 35% do 84% zależnie od źródła, dlatego decyzje opieraj na CTR/CTOR i konwersji powitalnych.
- **Interpretation (EN):** The welcome email reaches people at peak interest, so its OR should clearly exceed a regular newsletter (GetResponse 83.63% vs 40.08%; Omnisend 35.53% vs 30.41%). A low welcome OR usually signals deliverability issues (spam/promotions tab) or a delayed send. Pitfalls: MPP inflates welcome opens the most because Apple's proxy prefetches right after sign-up; Stripo shows reported values range from 35% to 84% depending on the source, so base decisions on welcome CTR/CTOR and conversion.

**Kontekst:** ESP bez korekty MPP (np. GetResponse, MailerLite): listy treściowe i newsletterowe · okres: na wysyłkę · metoda: średnia GetResponse 83,63% (dane 2023) ± heurystyka; średnia umieszczona w przedziale „normalny” · źródła: src_getresponse_2024, src_stripo_welcome_2026, src_litmus_market_share_2026

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

**Poprawki weryfikacji (do naniesienia):**

- Przedziały bez zmian. W interpretacji PL i EN dopasować rekomendację Stripo do źródła: Stripo zaleca CTOR, konwersję i przychód na odbiorcę (RPR), a nie CTR. Zaznaczyć, że 83,63% to średnia GetResponse z danych 2023, a nie mediana.

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
- **Interpretacja (PL):** Mówi, ile razy więcej przychodu na odbiorcę generują wiadomości wyzwalane zachowaniem (powitanie, porzucony checkout, wygasająca subskrypcja) niż wysyłki masowe. W e-commerce to ok. 16–22× (Omnisend) i ok. 18× (Klaviyo). Niski mnożnik oznacza słabe lub źle wyzwalane automatyzacje albo braki w śledzeniu atrybucji. Pułapki: automatyzacje trafiają do osób o najwyższej intencji, więc mnożnik nie jest przyczynowy (mierz przyrost grupą kontrolną). Różne okna atrybucji, np. domyślne 5 dni w Klaviyo, zawyżają wartości bezwzględne.
- **Interpretation (EN):** Says how many times more revenue per recipient behaviour-triggered messages (welcome, abandoned checkout, expiring subscription) generate than bulk sends; in e-commerce ~16–22x (Omnisend) and ~18x (Klaviyo). A low multiple means weak or poorly triggered automations or attribution tracking gaps. Pitfalls: automations target the highest-intent people, so the multiple is not causal (measure lift with a holdout); different attribution windows (e.g., Klaviyo's 5-day default) inflate absolute values.

**Kontekst:** E-commerce / sprzedaż online (dane Klaviyo i Omnisend) · okres: rocznie / kwartalnie · metoda: średnie źródeł ± heurystyka: Omnisend 16× (2,87 vs 0,18 USD na wysyłkę, raport 2026) i ok. 22× (3,41 vs 0,155 USD, benchmarki 2026); Klaviyo „prawie 18×” · źródła: src_omnisend_report_2026, src_omnisend_benchmarks_2026, src_klaviyo_benchmarks_2026

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| krytyczny | < 3       |                           |
| słaby     | 3–8       |                           |
| normalny  | 8–15      |                           |
| dobry     | 15–20     | obejmuje 16–18× ze źródeł |
| optymalny | ≥ 20      |                           |

**Kontekst:** Wydawca subskrypcyjny / think tank (subskrypcje, bilety na wydarzenia, członkostwo) · okres: rocznie / kwartalnie · metoda: heurystyka: brak publicznych benchmarków dla wydawców; przyjęto ok. 2/3 progów e-commerce ze względu na mniejszą liczbę wyzwalaczy zakupowych i rzadsze transakcje · źródła: src_klaviyo_benchmarks_2026, src_omnisend_report_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 2       |       |
| słaby     | 2–5       |       |
| normalny  | 5–10      |       |
| dobry     | 10–15     |       |
| optymalny | ≥ 15      |       |

**Zastrzeżenia:**

- Klaviyo: flowy to 5,3% wysyłek i prawie 41% przychodu e-mail. Omnisend: automatyzacje to 2% wysyłek i 30% przychodu (dane 2025).
- Porównuj wyłącznie przy tym samym oknie i modelu atrybucji.
- Kontekst wydawcy i think tanku jest heurystyką (niska pewność).

**Poprawki weryfikacji (do naniesienia):**

- Spójność z resztą słownika: w innych wskaźnikach średnia źródłowa leży w przedziale „normalny”, tu wartości 16–18× trafiają do „dobry”, a 22× do „optymalny”. Proponowane przedziały dla e-commerce: krytyczny <5, słaby 5–12, normalny 12–20 (16–18×), dobry 20–28 (22× Omnisend), optymalny ≥28. Dla wydawcy (ok. 2/3, heurystyka): krytyczny <3, słaby 3–8, normalny 8–13, dobry 13–19, optymalny ≥19. Dopisać, że wartości Omnisend liczone są na wysłany e-mail, a nie ściśle na odbiorcę. Twierdzenie o domyślnym 5-dniowym oknie Klaviyo jest potwierdzone, ale wymaga własnego źródła: Klaviyo Help Center, „Understanding message attribution”, aktualizacja 2026-03-26, https://help.klaviyo.com/hc/en-us/articles/115005248128. Cytat: „For new customers after 10/9/2024 the default window is 5 days for email and SMS”.

### CVR (e-mail): Współczynnik konwersji z e-maila (na odbiorcę) (Email Conversion Rate (per recipient))

- **Rozwinięcie:** Conversion Rate: odsetek odbiorców, którzy po e-mailu wykonali cel (zakup, subskrypcja, darowizna, rejestracja) / Conversion Rate: share of recipients who completed the goal after the email (purchase, subscription, donation, registration)
- **Wzór:** konwersje przypisane do wysyłki / dostarczone × 100% (osobno dla kampanii i automatyzacji)
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Łączy jakość listy, treści i ścieżki zakupu w jedną liczbę biznesową. Automatyzacje konwertują rząd wielkości lepiej niż kampanie: według Omnisend 1,49% wobec 0,08%. Pułapki: różne definicje celu (płatny vs bezpłatny), różne okna atrybucji i liczenie od kliknięć zamiast od dostarczonych (to click-to-conversion, np. 39,46% dla porzuconego koszyka).
- **Interpretation (EN):** Combines list, content and checkout quality into one business number; automations convert an order of magnitude better than campaigns (Omnisend: 1.49% vs 0.08%). Pitfalls: different goal definitions (paid vs free), different attribution windows, and computing from clicks instead of delivered (that is click-to-conversion, e.g., 39.46% for abandoned cart).

**Kontekst:** Kampanie masowe: sprzedaż płatna (dane e-commerce) · okres: na kampanię · metoda: średnia Omnisend 0,08% (2025) ± heurystyka · źródła: src_omnisend_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,02    |       |
| słaby     | 0,02–0,05 |       |
| normalny  | 0,05–0,1  |       |
| dobry     | 0,1–0,2   |       |
| optymalny | ≥ 0,2     |       |

**Kontekst:** Automatyzacje ogółem: sprzedaż płatna (dane e-commerce) · okres: na wysyłkę · metoda: średnie Omnisend (automatyzacje 1,49%, powitalne 2,11%, porzucony koszyk 1,72%; 2025) ± heurystyka · źródła: src_omnisend_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,4     |       |
| słaby     | 0,4–0,9   |       |
| normalny  | 0,9–1,5   |       |
| dobry     | 1,5–2,5   |       |
| optymalny | ≥ 2,5     |       |

**Kontekst:** Non-profit: apele o darowiznę · okres: na wysyłkę (średnia 2025) · metoda: średnia M+R (response rate fundraising 0,05%) ± heurystyka · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,02    |       |
| słaby     | 0,02–0,04 |       |
| normalny  | 0,04–0,07 |       |
| dobry     | 0,07–0,12 |       |
| optymalny | ≥ 0,12    |       |

**Kontekst:** Działania bezpłatne (petycje, rejestracje na bezpłatne wydarzenia online; analog M+R „advocacy”) · okres: na wysyłkę (średnia 2025) · metoda: średnia M+R (response rate advocacy 1,4%) ± heurystyka; analogia do bezpłatnych rejestracji to założenie eksperckie · źródła: src_mr_benchmarks_2026

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | < 0,4     |       |
| słaby     | 0,4–0,9   |       |
| normalny  | 0,9–1,8   |       |
| dobry     | 1,8–3     |       |
| optymalny | ≥ 3       |       |

**Zastrzeżenia:**

- Dane dotyczą USA lub rynków globalnych (e-commerce, non-profit). Dla sprzedaży subskrypcji eksperckich w Polsce brak publicznych benchmarków.
- M+R: średnio 54 USD przychodu na 1000 e-maili fundraisingowych i 2,40 USD na subskrybenta rocznie (2025).

**Poprawki weryfikacji (do naniesienia):**

- Przedziały bez zmian. Do interpretacji dodać źródło src_omnisend_cart_2026 dla click-to-conversion 39,46%, bo pochodzi z bloga o koszykach, a nie z benchmarków. Odnotować w caveacie niespójność Omnisend: sekcja branżowa podaje dla kampanii OR 30,22% i CTR 0,88%. Dla M+R zamiast „średnia” pisać „wartość typowa (M+R: mediany per wskaźnik)”.

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

- W ESP bez korekty MPP (GetResponse, MailerLite) wartości będą wyższe o ok. 10–20 p.p. Przeskaluj progi względem własnego OR newslettera.
- Brak benchmarków dla porzuconego checkoutu subskrypcji wydawców. Przyjęto dane e-commerce.

**Poprawki weryfikacji (do naniesienia):**

- Przedziały bez zmian. Caveat „+10–20 p.p. w ESP bez korekty MPP” oznaczyć jako heurystykę z porównania GetResponse z Omnisend: newsletter 40,08% wobec kampanii 30,41% (+10 p.p.), triggered 45,38% wobec automatyzacji 30,21% (+15 p.p.). Żadne źródło nie podaje tej wartości wprost.

### AC CTR: Współczynnik kliknięć e-maili o porzuconym koszyku (Abandoned Cart Email Click Rate)

- **Rozwinięcie:** Abandoned Cart Click-Through Rate: odsetek dostarczonych e-maili sekwencji porzuconego koszyka z co najmniej jednym kliknięciem / Abandoned Cart Click-Through Rate: share of delivered abandoned cart sequence emails with at least one click
- **Wzór:** unikalne kliknięcia / dostarczone e-maile sekwencji × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Mierzy, ilu odbiorców wraca do porzuconego zakupu. Klaviyo podaje średnio 6,0%, a górne 10% marek 11,3%. Niski CTR przy normalnym OR oznacza słabe przypomnienie (brak podglądu produktu, ceny, korzyści) albo zepsuty link do odtworzenia koszyka. Pułapki: CTR liczony od otwarć (to CTOR, ok. 11% według Omnisend) i kliknięcia botów.
- **Interpretation (EN):** Measures how many recipients come back to the abandoned purchase (Klaviyo average 6.0%, top 10% 11.3%). Low CTR with normal OR means a weak reminder (no product preview, price or benefits) or a broken cart-restore link. Pitfalls: CTR computed on opens (that is CTOR, ~11% per Omnisend) and bot clicks.

**Kontekst:** Sekwencje porzuconego koszyka (dane e-commerce) · okres: na wysyłkę · metoda: średnia i top 10% Klaviyo (6,0% / 11,3%, X 2026) + Omnisend CTR 4,13% (dane 2025) ± heurystyka · źródła: src_klaviyo_abandoned_cart_2026, src_omnisend_benchmarks_2026

| Ocena     | Przedział | Uwagi               |
| --------- | --------- | ------------------- |
| krytyczny | < 2       |                     |
| słaby     | 2–4       |                     |
| normalny  | 4–6       | Omnisend 4,13%      |
| dobry     | 6–11,3    | od średniej Klaviyo |
| optymalny | ≥ 11,3    | top 10% Klaviyo     |

**Zastrzeżenia:**

- Klaviyo zaleca sekwencję 3 wiadomości (ok. 2–4 h, 24 h, 48 h). Omnisend: pierwsza po 30–60 min, kolejne po 24 h i 72 h. Raportuj CTR per pozycja w sekwencji.

**Poprawki weryfikacji (do naniesienia):**

- Poprawić caveat o sekwencji: Klaviyo podaje przykład („a common sequence might involve 3 messages”), a nie zalecenie 3 e-maili. Przykład to e-mail po 2–4 h, SMS z rabatem po 24 h i ostatnia wiadomość po 48 h. Omnisend w tekście podaje 30–60 min, 24 h i 72 h, ale diagram pokazuje trzecią po 48 h. Przedziały bez zmian.

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
- **Interpretacja (PL):** To realna dostarczalność. Wskaźnik „delivered” w ESP to tylko „wysłane minus odbite” i nie mówi, czy wiadomość trafiła do spamu. Spadek IPR poprzedza spadek OR, CTR i przychodu, więc to wskaźnik wyprzedzający dla całego programu e-mail. Pułapki: mierzy się go na próbie adresów testowych (seed), więc wynik zależy od składu dostawców. Validity nie raportuje Polski, a polscy dostawcy (WP, Onet, Interia) filtrują inaczej niż Gmail czy Microsoft.
- **Interpretation (EN):** This is real deliverability: an ESP's 'delivered' is just 'sent minus bounced' and does not say whether mail went to spam. A drop in IPR precedes drops in OR, CTR and revenue, so it is a leading indicator for the whole email programme. Pitfalls: measured on seed samples, so results depend on provider mix; Validity does not report Poland, and Polish providers (WP, Onet, Interia) filter differently than Gmail/Microsoft.

**Kontekst:** Nadawcy wysyłający do odbiorców w Europie · okres: kwartalnie / miesięcznie (test seed) · metoda: średnie Validity 2025 ± heurystyka: Europa 91,1%, Niemcy 97,5%, Francja 94,0%, UK 91,5%; regionalni dostawcy w Europie 79,7% · źródła: src_validity_2026

| Ocena     | Przedział | Uwagi                                 |
| --------- | --------- | ------------------------------------- |
| krytyczny | < 80      | poziom regionalnych dostawców (79,7%) |
| słaby     | 80–87     |                                       |
| normalny  | 87–91     | do średniej Europy 91,1%              |
| dobry     | 91–95     |                                       |
| optymalny | ≥ 95      | Niemcy 97,5%                          |

**Kontekst:** Lista mieszana globalnie (różne kraje i dostawcy) · okres: kwartalnie / miesięcznie (test seed) · metoda: średnia globalna Validity 87,2% (2025; 83,5% w 2024) i rozkład sektorów 80,1–97,2% ± heurystyka · źródła: src_validity_2026, src_validity_2025

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

**Poprawki weryfikacji (do naniesienia):**

- Przedziały bez zmian, wszystkie liczby Validity potwierdzone. Polska nie jest raportowana; wybrane kraje to tylko FR, DE i UK. Notatkę „poziom regionalnych dostawców (79,7%)” uzupełnić o „−11,4 p.p. względem MAGY w Europie”. W metodzie dopisać: dane z adresów testowych (seed) klientów Validity, z wyłączeniem nadawców, którzy nie zgodzili się na agregację.

### DR: Wskaźnik zniechęcenia listy (Disaffection Rate)

- **Rozwinięcie:** Disaffection Rate: stosunek sygnałów utraty subskrybentów (wypisy, skargi, odbicia) do pozytywnych reakcji (kliknięć) / Disaffection Rate: ratio of subscriber-loss signals (unsubscribes, complaints, bounces) to positive responses (clicks)
- **Wzór:** (wypisy + skargi na spam + odbicia) / kliknięcia × 100%
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Wskaźnik promowany przez Validity na 2026 r. W jednej liczbie pokazuje, czy wysyłki budują listę, czy ją erodują. Przy 0,3% wypisów, 0,1% skarg, 0,1% twardych odbić i CTR 1% wynosi 50%, czyli na każde dwa kliknięcia tracisz jednego subskrybenta. Validity opisuje taki poziom jako sytuację kryzysową. Pułapki: przy MPP i kliknięciach botów mianownik bywa zawyżony, więc wskaźnik wychodzi zbyt optymistycznie.
- **Interpretation (EN):** A KPI promoted by Validity for 2026 that shows in one number whether sends build or erode the list. With 0.3% unsubscribes, 0.1% complaints, 0.1% hard bounces and 1% CTR it equals 50%: one subscriber lost for every two clicks, which Validity describes as a crisis level. Pitfalls: bot clicks can inflate the denominator and make the metric look too optimistic.

**Kontekst:** Każda wysyłka marketingowa (newsletter, kampanie) · okres: na wysyłkę / miesięcznie · metoda: próg kryzysowy ze źródła (przykład Validity 50% opisany jako kryzys; DR powyżej CTR = lista eroduje) + heurystyka dla niższych przedziałów · źródła: src_validity_2026

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | ≥ 50      | Validity: poziom kryzysowy |
| słaby     | 35–50     |                            |
| normalny  | 20–35     |                            |
| dobry     | 10–20     |                            |
| optymalny | < 10      |                            |

**Zastrzeżenia:**

- Tekst Validity jest niejednoznaczny: kryzys opisuje zarówno przykład 50%, jak i sytuację, gdy zniechęcenie przekracza kliknięcia. Przyjęto ostrożniejszy próg 50%.
- Przedziały poniżej 50% to heurystyka (brak rozkładu w źródle).

**Poprawki weryfikacji (do naniesienia):**

- Interpretacja PL i EN: zdanie „Validity opisuje taki poziom (50%) jako sytuację kryzysową” zmienić. Validity wiąże „crisis situation” z sytuacją, gdy zniechęcenie przewyższa kliknięcia („disaffection rate is larger than its click rate”). Przykład 50% opisuje jako „one subscriber lost for every two clicks” i utratę połowy listy w niecały rok przy 2 wysyłkach tygodniowo. Notatkę przedziału krytycznego zmienić na „≥50%: przykład Validity (1 utracony na 2 kliknięcia); ≥100% = utraty przewyższają kliknięcia, Validity: kryzys”. Próg 50% zostaje jako ostrożna heurystyka. Z pułapek w PL usunąć „przy MPP”, bo MPP zawyża otwarcia, a nie kliknięcia, a mianownikiem DR są kliknięcia. Wersja EN słusznie wymienia tylko kliknięcia botów.

### Źródła grupy: E-mail i newsletter

| Id                              | Źródło                                                                                                                                                                                                                                      | Wydawca                                      | Data                                                    | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src_mailerlite_2025             | [Email Marketing Benchmarks 2025: Is Your Open Rate on Track? (wersja PL: /pl/blog/compare-your-email-performance-metrics-industry-benchmarks)](https://www.mailerlite.com/blog/compare-your-email-performance-metrics-industry-benchmarks) | MailerLite                                   | 2025-12-03 (aktualizacja 2026-04-07)                    | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_getresponse_2024            | [Email Marketing Benchmarks & Statistics (Updated for 2024)](https://www.getresponse.com/resources/reports/email-marketing-benchmarks)                                                                                                      | GetResponse                                  | 2024 (dane z 2023 r.; brak nowszej edycji)              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_getresponse_doi_2024        | [Single Opt-In vs Double Opt-In](https://www.getresponse.com/blog/single-opt-in-vs-double-opt-in)                                                                                                                                           | GetResponse                                  | 2024-06-04 (aktualizacja)                               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_mailchimp_2023              | [Email Marketing Benchmarks and Statistics by Industry](https://mailchimp.com/resources/email-marketing-benchmarks/)                                                                                                                        | Mailchimp (Intuit)                           | 2023-12 (ostatnia aktualizacja danych)                  | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_omeda_h1_2026               | [Newsletter Statistics for Media & Publishing (2026): Open, Click & Click-to-Open Benchmarks (Newsletter Benchmark Report for Media H1 2026)](https://www.omeda.com/blog/newsletter-benchmarks-media/)                                      | Omeda                                        | 2026-08-18 (ostatnia aktualizacja; dane I–VI 2026)      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_glueletter_open_q1_2025     | [What's a normal open rate for newsletters in Q1 2025?](https://glueletter.com/newsletter-open-rate-benchmark-2025/)                                                                                                                        | GlueLetter                                   | 2025 (dane 01.01–31.03.2025; data publikacji niepodana) | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_glueletter_click_q1_2025    | [What's a normal click rate for newsletters in Q1 2025?](https://glueletter.com/newsletter-click-rate-benchmark-2025/)                                                                                                                      | GlueLetter                                   | 2025 (dane 01.01–31.03.2025; data publikacji niepodana) | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_validity_2026               | [2026 Email Deliverability Benchmark Report](https://www.validity.com/wp-content/uploads/2026/03/2026-Benchmark-Report.pdf)                                                                                                                 | Validity                                     | 2026-03 (dane 2025)                                     | częściowo: PDF zweryfikowany po ekstrakcji tekstu. Potwierdzone: IPR globalny 87,2% (+3,7), Europa 91,1%, Niemcy 97,5%, Francja 94,0%, UK 91,5%. Dostawcy: Gmail 89,8%, Microsoft 77,4%, Yahoo 87,3%, Apple 82%. Sektory: Media & Internet 88,1%, Organizations 87,7%, Education 87,6%, Government 91,4%, zakres 80,1% (Real Estate) – 97,2% (Transportation). Średni complaint rate 0,06%. Cytat: „below 0.2-0.3 percent, under 0.1 percent is now the expectation”. Unknown users 1,46%, rejected 3,20%. Yahoo zamyka nieaktywne konta po 12 mies., Gmail po 24. Zdanie „comfortable with a 0.3 percent opt-out rate, and 0.1 percent for complaints and hard bounces” jest w raporcie. Wzór DR i przykład 50% zgodne. Polska nie jest raportowana; wybrane kraje to tylko FR, DE i UK. Rozbieżności: (1) Regionalni dostawcy w Europie mają 79,7%, czyli −11,4 p.p. względem MAGY. Przedział „10–25 p.p.” to ogólna rozpiętość dla wszystkich regionów (Azja −10,8, Ameryka Płn. −9,3, Oceania −19,4, Ameryka Płd. −25,3), a nie wartość dla Europy. (2) Zdanie „A score this high will indicate a crisis situation” stoi w akapicie o sytuacji, gdy „disaffection rate is larger than its click rate”, a nie bezpośrednio przy przykładzie 50%. Przykład 50% opisano jako „one subscriber lost for every two clicks” oraz utratę połowy listy w niecały rok przy 2 wysyłkach tygodniowo. (3) Raport nie mówi, że średnia 0,06% pochodzi z Google Postmaster Tools. Dodatkowo, przydatne dla DOI: wysoki IPR Niemiec Validity tłumaczy m.in. „widespread use of double opt-in”. |
| src_validity_2025               | [2025 Email Deliverability Benchmark Report (strona raportu)](https://www.validity.com/email-deliverability-benchmark-report/)                                                                                                              | Validity                                     | 2025 (dane 2024)                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_google_sender_guidelines    | [Email sender guidelines](https://support.google.com/a/answer/81126?hl=en)                                                                                                                                                                  | Google (Gmail / Google Workspace Admin Help) | wymogi obowiązujące od 2024-02-01 (dostęp 2026-10-18)   | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_yahoo_sender_hub            | [Sender Best Practices](https://senders.yahooinc.com/best-practices/)                                                                                                                                                                       | Yahoo Sender Hub                             | brak daty na stronie (dostęp 2026-10-18)                | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_aws_ses_enforcement         | [Amazon SES Sending review process FAQs](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html)                                                                                                                                   | Amazon Web Services                          | brak daty (dokumentacja bieżąca, dostęp 2026-10-18)     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_klaviyo_benchmarks_2026     | [2026 email marketing benchmarks](https://www.klaviyo.com/products/email-marketing/benchmarks)                                                                                                                                              | Klaviyo                                      | 2026 (strona bez daty; dostęp 2026-10-18)               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_klaviyo_abandoned_cart_2026 | [2026 Abandoned Cart Benchmark Report](https://www.klaviyo.com/blog/abandoned-cart-benchmarks)                                                                                                                                              | Klaviyo                                      | 2026-10-02                                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_omnisend_benchmarks_2026    | [Email marketing benchmarks](https://www.omnisend.com/blog/email-marketing-benchmarks/)                                                                                                                                                     | Omnisend                                     | 2026-05-12 (dane 2025)                                  | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_omnisend_report_2026        | [2026 Ecommerce Marketing Report](https://www.omnisend.com/resources/reports/2026-ecommerce-marketing-report/)                                                                                                                              | Omnisend                                     | 2026 (dane 2025)                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_omnisend_cart_2026          | [Cart abandonment emails](https://www.omnisend.com/blog/cart-abandonment-emails/)                                                                                                                                                           | Omnisend                                     | 2026-02-19                                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_baymard_2025                | [Cart Abandonment Rate Statistics](https://baymard.com/lists/cart-abandonment-rate)                                                                                                                                                         | Baymard Institute                            | 2025-09-22 (aktualizacja)                               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_stripo_welcome_2026         | [Stripo Research Report No. 06: Welcome Emails](https://research.stripo.email/welcome-email-open-rates)                                                                                                                                     | Stripo                                       | 2026-08                                                 | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_litmus_market_share_2026    | [Email Client Market Share](https://www.litmus.com/email-client-market-share)                                                                                                                                                               | Litmus                                       | 2026-10-01 (dane za wrzesień 2026)                      | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_mr_benchmarks_2026          | [M+R Benchmarks 2026: Email Messaging](https://mrbenchmarks.com/email-messaging/)                                                                                                                                                           | M+R                                          | 2026 (dane 2025)                                        | częściowo: Potwierdzone: edycja 2026 z danymi 2025. Wzrost netto list 5% („an average net increase of 5%”), media publiczne 12%. Odpływ: 12% wypisów i 4% odbić. Disaster/International Aid: 21% wypisów i 6% odbić, a cytat „The only sector to report a decline in list size was Disaster/International Aid” się zgadza. CTR: fundraising 0,59%, advocacy 2,3%. Response rate: 0,05% i 1,4%. 50 wiadomości na subskrybenta, 54 USD na 1000 e-maili, 2,40 USD na subskrybenta (wcześniej 1,87 USD). Rozbieżności: (1) Strona pisze „after 4% and 9% growth in the previous two years”, ale nie przypisuje lat. Zapis „4% w 2024, 9% w 2023” jest więc niepotwierdzony. (2) Metodologia mówi „we calculate the median for each metric separately”, a tekst nazywa wartości średnimi. Etykieta „średnia” jest niepewna. Należy pisać „wartość typowa (mediana lub średnia wg M+R)”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| src_zerobounce_decay_2026       | [The Email List Decay Report for 2026](https://zerobounce.net/email-list-decay)                                                                                                                                                             | ZeroBounce                                   | 2026 (dane I–XII 2025)                                  | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_truelist_doi_2025           | [What Is Double Opt-In and Why It Matters for Your Email List](https://truelist.io/blog/what-is-double-opt-in)                                                                                                                              | Truelist                                     | 2025-12-28                                              | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_debounce_bounce             | [Average Bounce Rate by Industry](https://debounce.com/blog/average-bounce-rate-by-industry/)                                                                                                                                               | DeBounce                                     | brak daty (dostęp 2026-10-18)                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| src_bounceless_bounce           | [Email Bounce Rate](https://blog.bounceless.io/email-bounce-rate)                                                                                                                                                                           | Bounceless                                   | brak daty (dostęp 2026-10-18)                           | nie da się sprawdzić (link niedostępny): Martwy link: https://blog.bounceless.io/email-bounce-rate zwraca HTTP 410 Gone, a alternatywny adres bounceless.io/blog/email-bounce-rate zwraca 404. Twierdzenia „soft bounce <2%, hard <0,5%” nie da się zweryfikować. Źródło trzeba usunąć z source_ids dla soft_bounce_rate, a próg „<2% jako cel” oznaczyć jako heurystykę. DeBounce 2026 daje 1–3% i <0,5–1% dla twardych. Zastępczego źródła nie dało się wyszukać, bo wyczerpał się limit wyszukiwań.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 6. Zaangażowanie, wydarzenia, społeczność i CRM

### DAU/MAU: Lepkość (stickiness) DAU/MAU (Stickiness (DAU/MAU))

- **Rozwinięcie:** Daily Active Users / Monthly Active Users – dzienni aktywni użytkownicy podzieleni przez miesięcznych aktywnych użytkowników / Daily Active Users / Monthly Active Users
- **Wzór:** DAU/MAU = (średnia dzienna liczba unikalnych aktywnych użytkowników w miesiącu) / (liczba unikalnych aktywnych użytkowników w tym miesiącu) × 100%. Pomocniczo: DAU/MAU × 30 ≈ średnia liczba dni aktywności aktywnego użytkownika w miesiącu.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, jak często aktywny użytkownik wraca: 20% oznacza średnio ok. 6 dni aktywności w miesiącu, 33% ok. 10 dni. Dla think tanku z treściami eksperckimi naturalny rytm to kilka wizyt w miesiącu, więc nie porównuj wyniku z mediami społecznościowymi ani z grami. Typowe pułapki: wynik zależy od definicji aktywności (sama odsłona, przeczytany artykuł albo logowanie). Anonimowe cookies zawyżają MAU i zaniżają wskaźnik, a sezonowość (wakacje, kalendarz wydarzeń) zmienia go z miesiąca na miesiąc.
- **Interpretation (EN):** Shows how often an active user returns: 20% means roughly 6 active days per month, 33% roughly 10 days. For an expert-content think tank the natural rhythm is a few visits per month, so do not compare it with social or gaming apps. Pitfalls: the result depends on how 'active' is defined (pageview vs. article read vs. login), anonymous cookies inflate MAU and depress the ratio, and seasonality (holidays, event calendar) moves it month to month.

**Kontekst:** Serwis treści eksperckich / media cyfrowe (zalogowani czytelnicy, subskrybenci, członkowie) · okres: miesięcznie (średnia z dni miesiąca kalendarzowego) · metoda: Heurystyka zakotwiczona w źródłach: próg 'dobry' = 20% (A. Chen), próg 'optymalny' = średnia Mixpanel dla Media & Entertainment 36% (produkty instrumentowane, głównie aplikacje). Dolne pasma wyprowadzono z rytmu użycia (10% ≈ 3 dni aktywności w miesiącu). Przedziały lewostronnie domknięte [min, max). · źródła: S1, S3, S2

| Ocena     | Przedział | Uwagi                                                                                                                  |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| krytyczny | 0–5       | <1,5 dnia aktywności w miesiącu na aktywnego użytkownika – ruch głównie jednorazowy                                    |
| słaby     | 5–10      | 1,5–3 dni w miesiącu                                                                                                   |
| normalny  | 10–20     | 3–6 dni w miesiącu, rytm mniej więcej tygodniowy                                                                       |
| dobry     | 20–36     | ≥20% to próg 'dobry' wg A. Chena                                                                                       |
| optymalny | 36–100    | poziom średniej Mixpanel dla Media & Entertainment (36%, dane 2023), osiągany zwykle przez aplikacje o dziennym rytmie |

**Kontekst:** Portal/produkt B2B (panel klienta instytucjonalnego, narzędzia dla członków firmowych) · okres: miesięcznie · metoda: Punkty odniesienia ze źródeł: Mixpanel 2026 – B2B w Ameryce Płn. 31%, Mixpanel 2024 – Technology 41%, D. Sacks – ok. 40% jako doskonały poziom w SaaS. Dolne pasma (<20%) to heurystyka. · źródła: S2, S1, S4

| Ocena     | Przedział | Uwagi                                                                                          |
| --------- | --------- | ---------------------------------------------------------------------------------------------- |
| krytyczny | 0–10      |                                                                                                |
| słaby     | 10–20     |                                                                                                |
| normalny  | 20–31     | do poziomu Mixpanel B2B Ameryka Płn. (31%, 2025)                                               |
| dobry     | 31–40     |                                                                                                |
| optymalny | 40–100    | ~40% DAU/MAU płacących klientów = 'excellent engagement' wg D. Sacksa; Mixpanel Technology 41% |

**Zastrzeżenia:**

- Średnie Mixpanel dotyczą produktów z pełną instrumentacją (często aplikacji z logowaniem), więc dla serwisu WWW z ruchem anonimowym będą zawyżone.
- Dane europejskie (Mixpanel 2026): e-commerce w EMEA 21%, agencje kreatywne (Media & Entertainment) w EMEA 31%. Nie znaleziono polskich benchmarków.
- Próg 50%+ ('world class' wg A. Chena) dotyczy aplikacji społecznościowych. Sam Chen zastrzega, że dla produktów używanych rzadziej DAU/MAU nie jest właściwą miarą.
- Dla treści o rytmie tygodniowym (newsletter, kluby) lepiej równolegle śledzić WAU/MAU i rozkład dni aktywności (power user curve / L30).

**Poprawki weryfikacji (do naniesienia):**

- Kontekst B2B, pasmo 'normalny' (20–31): zmień notatkę '(31%, 2025)' na '(Mixpanel, raport 2026; rok danych i definicja niepodane)'. Pasmo 'optymalny' (≥40): dopisz za Sacksem 'u płacących klientów szczyty 40–45%, ok. 8 dni roboczych w miesiącu'. Kontekst treści: pasma bez zmian, liczby S1 potwierdzone (M&E 36%, Technology 41%, średnia 37%, dane 2023). Do zastrzeżeń dopisz, że DAU/MAU ma matematyczne minimum ok. 3,3% (1/30), więc pasmo 'krytyczny' obejmuje faktycznie 3,3–5%.

### WAU/MAU: Tygodniowa lepkość WAU/MAU (Weekly stickiness (WAU/MAU))

- **Rozwinięcie:** Weekly Active Users / Monthly Active Users – tygodniowi aktywni użytkownicy podzieleni przez miesięcznych aktywnych użytkowników / Weekly Active Users / Monthly Active Users
- **Wzór:** WAU/MAU = (średnia liczba unikalnych aktywnych użytkowników w tygodniach miesiąca lub w kroczącym oknie 7 dni) / (unikalni aktywni użytkownicy w miesiącu lub w kroczącym oknie 28–30 dni) × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy, jaka część miesięcznej publiczności wraca co tydzień, i lepiej niż DAU/MAU pasuje do rytmu think tanku (tygodniowy newsletter, cykle debat, spotkania klubów). Matematyczny punkt odniesienia: jeśli każdy użytkownik przychodzi dokładnie raz w miesiącu, WAU/MAU ≈ 7/30 ≈ 23%, a gdy wszyscy wracają co tydzień, wskaźnik zbliża się do 100%. Pułapki: różne okna (kalendarzowe vs. kroczące 7/28 dni) dają różne wyniki, a boty i anonimowe cookies zaniżają wskaźnik.
- **Interpretation (EN):** Measures what share of the monthly audience returns every week, and fits a think tank's rhythm (weekly newsletter, debate series, club meetings) better than DAU/MAU. Mathematical anchor: if every user visits exactly once a month, WAU/MAU ≈ 7/30 ≈ 23%; if everyone returns weekly it approaches 100%. Pitfalls: calendar vs. rolling 7/28-day windows give different values, and bots or anonymous cookies depress the ratio.

**Kontekst:** Serwis treści eksperckich / media cyfrowe o rytmie tygodniowym (newsletter, kluby, cykle wydarzeń) · okres: miesięcznie (kroczące okna 7/28 dni) · metoda: Heurystyka: dolny próg wyprowadzony matematycznie (7/30 ≈ 23%). Górne pasma to ocena ekspercka spójna z relacją Sacksa (DAU/WAU ≈ 60% przy doskonałym zaangażowaniu w SaaS). · źródła: S4, S3

| Ocena     | Przedział | Uwagi                                                    |
| --------- | --------- | -------------------------------------------------------- |
| krytyczny | 0–23      | poniżej poziomu 'każdy użytkownik raz w miesiącu' (7/30) |
| słaby     | 23–35     |                                                          |
| normalny  | 35–50     |                                                          |
| dobry     | 50–65     | większość miesięcznej publiczności wraca co tydzień      |
| optymalny | 65–100    |                                                          |

**Kontekst:** Portal/produkt B2B używany w dni robocze (klienci instytucjonalni) · okres: miesięcznie · metoda: Heurystyka ekspercka. Punktem odniesienia jest opis Sacksa (produkt SaaS powinien być używany we wszystkie 5 dni roboczych; DAU/WAU ≈ 60% = doskonale). · źródła: S4

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | 0–30      |       |
| słaby     | 30–45     |       |
| normalny  | 45–60     |       |
| dobry     | 60–75     |       |
| optymalny | 75–100    |       |

**Zastrzeżenia:**

- Nie znaleziono wiarygodnego, publicznego benchmarku WAU/MAU od Mixpanel, Amplitude ani Sequoii. Blogi dostawców podają sprzeczne przedziały (20–40% i 60–80%), więc ich nie użyto.
- Wskaźnik najlepiej traktować jako trend wewnętrzny (miesiąc do miesiąca, kohorty), a nie do porównań z rynkiem.
- Zawsze WAU/MAU ≥ DAU/MAU, a WAU/MAU w okolicach 23% oznacza publiczność odwiedzającą serwis raz w miesiącu.

**Poprawki weryfikacji (do naniesienia):**

- Błąd logiczny w kontekście treści eksperckich: pasmo 'krytyczny' [0, 23) jest praktycznie nieosiągalne. Każdy aktywny w miesiącu użytkownik wpada w co najmniej 7 z 30 kroczących okien 7-dniowych, więc średnie WAU/MAU ≥ ok. 23%. Proponuję: krytyczny [0, 30) z notatką 'prawie wszyscy aktywni tylko w jednym tygodniu miesiąca; wartości <23% wskazują błąd definicji lub okien', słaby [30, 38), normalny [38, 50) (ok. 2 wizyty w różnych tygodniach daje ok. 47%), dobry [50, 65), optymalny ≥65. Kontekst B2B: dodaj kotwicę wyprowadzoną z Sacksa (DAU/MAU 40% / DAU/WAU 60% ≈ WAU/MAU 67% przy 'excellent engagement', wyliczenie własne) i przesuń granicę: dobry [60, 67), optymalny ≥67 zamiast ≥75. Confidence pozostaje 'niska'.

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

**Kontekst:** B2B: usługi eksperckie/doradcze, klienci instytucjonalni i firmowi · okres: na falę badania (półrocznie/rocznie, relacyjny) · metoda: Kwartyle SurveyMonkey 2025 dla usług profesjonalnych (P25 = 42, P50 = 48, P75 = 72). Kontrola krzyżowa: Survicate 2025 (B2B 38, Agency & Consulting 59, Software 30) i Retently 2026 (Consulting 68, B2B SaaS 41). Próg krytyczny to heurystyka. · źródła: S6, S7, S8

| Ocena     | Przedział | Uwagi                                                   |
| --------- | --------- | ------------------------------------------------------- |
| krytyczny | -100–20   | heurystyka: wyraźnie poniżej mediany B2B (Survicate 38) |
| słaby     | 20–42     | poniżej P25 usług profesjonalnych (SurveyMonkey 42)     |
| normalny  | 42–48     | P25–P50 usług profesjonalnych                           |
| dobry     | 48–72     | P50–P75; Survicate Agency & Consulting 59               |
| optymalny | 72–100    | ≥ P75 usług profesjonalnych; Retently Consulting 68     |

**Zastrzeżenia:**

- Bain (nps.bain.com) definiuje promotorów, pasywnych i krytyków, ale nie podaje progów absolutnych, tylko porównania względne z konkurencją. Pasma 0/20/50/80 to 'bands in common use' (HelloCustomer 2026), na stronie Bain ich nie zweryfikowano.
- Benchmarki dostawców różnią się metodą, np. Software: 30 (Survicate) vs 41 (Retently), Consulting: 59 vs 68.
- Nie znaleziono polskich ani europejskich benchmarków NPS dla mediów i think tanków.
- Przy n < 100 odpowiedzi pokazuj NPS z liczbą odpowiedzi i nie oceniaj pasma przy bardzo małej próbie.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst B2B: pasmo 'normalny' 42–48 ma tylko 6 pkt szerokości, czyli mniej niż błąd próby przy kilkudziesięciu odpowiedziach. Do tego mediana B2B wg Survicate (38) wpada w 'słaby'. Proponuję: krytyczny [−100, 0), słaby [0, 30), normalny [30, 48) (obejmuje Survicate B2B 38 i P25 SurveyMonkey dla usług profesjonalnych 42), dobry [48, 72), optymalny ≥72 (P75 SurveyMonkey; Retently Consulting 68). Dopisz, że kwartyle SurveyMonkey dla usług profesjonalnych to 'consultancy as proxy'. Kontekst międzybranżowy i medialny: bez zmian, liczby potwierdzone. Zastrzeżenie o HelloCustomer zamień na dosłowny cytat ('above 20 is favourable, above 50 is excellent, above 80 is world class'; 'anything above 0' = good).

### AR: Wskaźnik obecności (frekwencja) na wydarzeniu (Event attendance rate)

- **Rozwinięcie:** Attendance Rate – odsetek zarejestrowanych, którzy faktycznie przyszli (check-in) lub dołączyli do transmisji / Attendance Rate – share of registrants who actually checked in or joined the stream
- **Wzór:** AR = obecni (check-in / dołączenie do transmisji na żywo) / ważne rejestracje (bez anulowanych) × 100%. Dla online raportuj osobno 'live' oraz 'live + on-demand'.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje, ile rejestracji zamienia się w realny udział. Wynik zależy od intencji publiczności, ceny biletu, przypomnień i dopasowania terminu. Wydarzeń bezpłatnych, płatnych i online nie należy oceniać jedną skalą. Pułapki: różne definicje obecności (check-in vs. odbiór identyfikatora; online: tylko live czy także on-demand, bo ON24 liczy oba), zaproszenia VIP i bilety grupowe w mianowniku, wielokrotne rejestracje tej samej osoby.
- **Interpretation (EN):** Shows how many registrations turn into real participation; it reflects audience intent, ticket price, reminders and timing. Free, paid and online events must not share one scale. Pitfalls: differing attendance definitions (check-in vs. badge pickup; online live-only vs. live + on-demand, as ON24 counts both), comps/VIP and group tickets in the denominator, duplicate registrations.

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

**Kontekst:** Wydarzenia online / webinary B2B – obecność na żywo (live) · okres: na webinar (agregat kwartalny) · metoda: Mediana/średnia ze źródeł: Contrast (Q3'25–Q1'26, ponad 1 mln rejestracji) – mediana live 41,6%, średnia 46,2%. Goldcast 2025 – średnio 33% (19 tys. webinarów, dane 2024). Goldcast 2026 – ok. 32% zagregowane (2,2 mln / 6,8 mln, wyliczenie własne). ON24 – 57% (2024) i 60% (2025), łącznie z on-demand. · źródła: S15, S13, S14, S16

| Ocena     | Przedział | Uwagi                                                     |
| --------- | --------- | --------------------------------------------------------- |
| krytyczny | 0–20      |                                                           |
| słaby     | 20–30     |                                                           |
| normalny  | 30–42     | Goldcast: średnio 33% (2024); mediana live Contrast 41,6% |
| dobry     | 42–55     | średnia live Contrast 46,2%                               |
| optymalny | 55–100    | poziom ON24 (57–60%), choć ON24 liczy też on-demand       |

**Kontekst:** Wydarzenia online – obecność łączna (live + odtworzenie on-demand) · okres: na webinar (z oknem on-demand np. 30 dni) · metoda: Średnia platformy ON24 (57% w raporcie 2025, 60% w raporcie 2026) jako granica normalny/dobry. Pozostałe pasma to heurystyka. · źródła: S16, S15

| Ocena     | Przedział | Uwagi                                |
| --------- | --------- | ------------------------------------ |
| krytyczny | 0–30      |                                      |
| słaby     | 30–45     |                                      |
| normalny  | 45–57     |                                      |
| dobry     | 57–65     | średnia ON24: 57% (2024), 60% (2025) |
| optymalny | 65–100    |                                      |

**Zastrzeżenia:**

- Zbiór PheedLoop to dane jednej platformy (ponad 1 070 wydarzeń), bez podziału geograficznego. Nie znaleziono polskich ani europejskich benchmarków frekwencji.
- Według PheedLoop (raport #06) różnica między płacącymi a niepłacącymi na tym samym wydarzeniu to tylko 2–4 pkt proc., więc większość luki między wydarzeniami bezpłatnymi a płatnymi wynika z typu wydarzenia, a nie z samej opłaty.
- Średnia Goldcast 33% może być średnią wskaźników per webinar. Iloraz sum (51/238) daje ok. 21%.
- Liczby ON24 to dane platformy enterprise o wysokiej intencji odbiorców i obejmują on-demand. Nie porównuj ich z obecnością tylko live.
- Dane Eventbrite (2018) są anegdotyczne, bez metodologii.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst 'Webinary B2B – live': usuń wartości Contrast 41,6% (mediana) i 46,2% (średnia). Nie ma ich na stronie Contrast, którą Voxbooster podaje jako źródło. Zastąp je danymi pierwotnymi Contrast (aktualizacja 16.04.2026, ponad 1 mln rejestrujących, własna platforma): obecność live 44–50%, start o 14:00 55%. Pasma: krytyczny [0, 20), słaby [20, 30), normalny [30, 44) (Goldcast 33%, dane ok. 2024; Goldcast 2026 ok. 32% z ilorazu sum), dobry [44, 55) (Contrast 44–50%), optymalny ≥55. Kontekst 'live + on-demand': dodaj potwierdzoną kotwicę Contrast 61% ('watch either live or on-demand') w paśmie 'dobry' [57, 65). ON24 57%/60% oznacz jako niezweryfikowane (403 na on24.com i marketingprofs.com). Konteksty stacjonarne (PheedLoop, Eventbrite): bez zmian, liczby potwierdzone.

### NSR: Wskaźnik nieobecności (no-show) (No-show rate)

- **Rozwinięcie:** No-Show Rate – odsetek zarejestrowanych, którzy nie pojawili się na wydarzeniu / No-Show Rate – share of registrants who did not attend
- **Wzór:** NSR = (ważne rejestracje − obecni) / ważne rejestracje × 100% = 100% − wskaźnik obecności (AR)
- **Jednostka:** % · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** To lustrzane odbicie frekwencji, przydatne operacyjnie do planowania sali, cateringu i nadrezerwacji (overbookingu). Przy oczekiwanym no-show 28% trzeba zebrać ok. 1,4 rejestracji na każde miejsce, żeby wypełnić salę. Pułapki: nie licz anulacji zgłoszonych przed wydarzeniem jako no-show, a wydarzeń bezpłatnych, płatnych i online nie oceniaj jedną skalą.
- **Interpretation (EN):** The mirror of attendance rate, used operationally for venue, catering and overbooking planning: with an expected 28% no-show you need about 1.4 registrations per seat. Pitfalls: do not count pre-event cancellations as no-shows; never judge free, paid and online events on a single scale.

**Kontekst:** Wydarzenia stacjonarne bezpłatne · okres: na wydarzenie · metoda: PheedLoop (2026): mediana ~28%, najgorsze 25% ≥47%. Eventbrite: do 50%. · źródła: S10, S12

| Ocena     | Przedział | Uwagi                                       |
| --------- | --------- | ------------------------------------------- |
| krytyczny | 47–100    | najgorsze 25% wydarzeń bezpłatnych          |
| słaby     | 38–47     |                                             |
| normalny  | 28–38     | od mediany (~28%) w górę                    |
| dobry     | 17–28     |                                             |
| optymalny | 0–17      | poziom mediany wydarzeń płatnych lub lepszy |

**Kontekst:** Wydarzenia stacjonarne płatne · okres: na wydarzenie · metoda: PheedLoop (2026): mediana ~17%, najgorsze 25% ≥32%. Eventbrite: 'as low as 10%'. · źródła: S10, S12

| Ocena     | Przedział | Uwagi                           |
| --------- | --------- | ------------------------------- |
| krytyczny | 32–100    | najgorsze 25% wydarzeń płatnych |
| słaby     | 25–32     |                                 |
| normalny  | 17–25     | od mediany (~17%) w górę        |
| dobry     | 10–17     |                                 |
| optymalny | 0–10      |                                 |

**Kontekst:** Małe spotkania bezpłatne (10–49 osób, kluby dyskusyjne) · okres: na spotkanie · metoda: PheedLoop (2026): mediana dla małych bezpłatnych wydarzeń ~37%. Pasma: mediana ± heurystyka. · źródła: S10

| Ocena     | Przedział | Uwagi        |
| --------- | --------- | ------------ |
| krytyczny | 50–100    |              |
| słaby     | 42–50     |              |
| normalny  | 32–42     | mediana ~37% |
| dobry     | 20–32     |              |
| optymalny | 0–20      |              |

**Kontekst:** Webinary / wydarzenia online B2B (nieobecność na żywo) · okres: na webinar · metoda: Dopełnienie benchmarków obecności live (Contrast, Goldcast) i ON24 dla poziomu optymalnego. · źródła: S15, S13, S16

| Ocena     | Przedział | Uwagi                                         |
| --------- | --------- | --------------------------------------------- |
| krytyczny | 80–100    |                                               |
| słaby     | 70–80     |                                               |
| normalny  | 58–70     | Goldcast: średnia obecność 33% → no-show ~67% |
| dobry     | 45–58     | mediana live Contrast 41,6% → no-show ~58%    |
| optymalny | 0–45      |                                               |

**Zastrzeżenia:**

- Wskaźnik liczony jest z tych samych danych co frekwencja, więc w panelu pokazuj go jako drugą stronę tej samej miary, a nie jako osobną ocenę.
- Brak polskich ani europejskich danych o no-show. PheedLoop to dane jednej platformy.
- PheedLoop (raport #06): wydarzenia bezpłatne mają wyższy odsetek dokończonych rejestracji (~96% vs ~86%) i wyższy no-show. Łatwiejsza rejestracja przyciąga też mniej zdecydowanych.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst webinarów (lustro poprawki frekwencji): krytyczny [80, 100], słaby [70, 80), normalny [56, 70) (Goldcast, obecność 33%, czyli no-show ok. 67%), dobry [45, 56) (Contrast, live 44–50%, czyli no-show 50–56%), optymalny [0, 45). Usuń notatkę 'mediana live Contrast 41,6% → no-show ~58%'. Konteksty stacjonarne: bez zmian. Opcjonalnie dopisz z PheedLoop #05, że wielkości 50–149 / 150–499 / 500–999 / 1 000+ mają no-show ok. 23 / 19 / 18 / 19%.

### RCR: Konwersja strony rejestracji na wydarzenie (Event registration page conversion rate)

- **Rozwinięcie:** Registration Conversion Rate – odsetek unikalnych odwiedzających stronę wydarzenia, którzy dokończyli rejestrację / Registration Conversion Rate – share of unique visitors to the event page who completed registration
- **Wzór:** RCR = zakończone rejestracje / unikalni odwiedzający stronę rejestracji (landing page wydarzenia) × 100%. Raportuj osobno według źródła ruchu.
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy atrakcyjność oferty wydarzenia (temat, prelegenci, termin), jakość strony i tarcie formularza. Pułapki: wynik zależy przede wszystkim od miksu ruchu, bo ciepły ruch z newslettera konwertuje wielokrotnie lepiej niż reklamy. Wynik zniekształca też liczenie sesji zamiast unikalnych osób i mylenie rozpoczętych rejestracji z zakończonymi. Wydarzenia płatne mają niższy odsetek dokończonych rejestracji.
- **Interpretation (EN):** Measures the appeal of the event offer (topic, speakers, date), page quality and form friction. Pitfalls: traffic mix dominates the result (warm newsletter traffic converts many times better than ads), counting sessions instead of unique people, confusing started with completed registrations; paid events have lower completion.

**Kontekst:** Ruch mieszany (social media, wyszukiwarka, reklamy, polecenia) · okres: na wydarzenie / kampanię · metoda: Mediany Unbounce 2024: wszystkie branże 6,6% (mediany branż 3,8–12,3%), Entertainment 12,3%, Publishing 9,8%. ON24 2025 (przez MarketingProfs): spersonalizowane landing page'e ok. 25%. Pasma: mediana i odchylenia heurystyczne. · źródła: S17, S18, S16

| Ocena     | Przedział | Uwagi                                                             |
| --------- | --------- | ----------------------------------------------------------------- |
| krytyczny | 0–3       | poniżej najniższej mediany branżowej Unbounce (3,8%)              |
| słaby     | 3–6,6     | poniżej mediany wszystkich branż (6,6%)                           |
| normalny  | 6,6–12    | Publishing 9,8%                                                   |
| dobry     | 12–25     | Entertainment 12,3%                                               |
| optymalny | 25–100    | poziom spersonalizowanych landing page'y webinarowych ON24 (~25%) |

**Kontekst:** Ruch z własnej bazy (newsletter, CRM, imienne zaproszenia do członków i klientów) · okres: na wysyłkę / wydarzenie · metoda: Heurystyka zakotwiczona w medianie Unbounce 2024 dla ruchu e-mail na stronach z kategorii Entertainment (46,2%). · źródła: S18

| Ocena     | Przedział | Uwagi                                                |
| --------- | --------- | ---------------------------------------------------- |
| krytyczny | 0–10      |                                                      |
| słaby     | 10–20     |                                                      |
| normalny  | 20–35     |                                                      |
| dobry     | 35–50     | mediana ruchu e-mail na stronach Entertainment 46,2% |
| optymalny | 50–100    |                                                      |

**Zastrzeżenia:**

- Nie znaleziono pierwotnego benchmarku konwersji 'odwiedzający → rejestracja' dla wydarzeń (Eventbrite, Cvent, Bizzabo nie publikują go otwarcie). Wartości to konwersje landing page'y Unbounce, a kategoria Entertainment obejmuje loterie z medianą 47,5%.
- Limit wyszukiwań w tej sesji wyczerpał się przed dalszym szukaniem danych Eventbrite, Splash i Cvent o konwersji stron wydarzeń. Warto to uzupełnić w kolejnym kroku.
- Dane ON24 o landing page'ach (25%) pochodzą z omówienia MarketingProfs, a strona źródłowa blokowała pobranie, więc liczbę zweryfikowano tylko przez fragment w wyszukiwarce.
- Brak danych polskich i europejskich.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst 'Ruch z własnej bazy': notatka 'mediana ruchu e-mail na stronach Entertainment 46,2%' musi zawierać zastrzeżenie samego Unbounce, że wynik ten napędzają głównie loterie (sweepstakes) promowane e-mailem. To nie jest kotwica dla rejestracji na wydarzenia. Zostaw pasma jako 'heurystyka' z confidence 'niska' albo obniż górę: dobry [30, 45), optymalny ≥45. Kontekst mieszany: kotwica optymalna ON24 25% (personalizowane landing page'e) jest niezweryfikowana (403). Pasmo 'optymalny ≥25' oznacz jako heurystykę.

### Event NPS: NPS wydarzenia (Event Net Promoter Score)

- **Rozwinięcie:** Net Promoter Score uczestników (lub partnerów) konkretnego wydarzenia: % promotorów (9–10) − % krytyków (0–6) w pytaniu o polecenie wydarzenia / Net Promoter Score of a specific event's attendees (or partners): % promoters (9–10) minus % detractors (0–6)
- **Wzór:** Event NPS = % promotorów − % krytyków wśród respondentów ankiety po wydarzeniu (wysyłka 24–72 h po zakończeniu). Osobno dla uczestników, prelegentów i partnerów/sponsorów.
- **Jednostka:** score · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mówi, czy wydarzenie generuje rekomendacje i powroty na kolejne edycje. U partnerów i sponsorów wyższy NPS koreluje ze wzrostem liczby wystawców i przychodów (UFI/Explori). Pułapki: niska stopa odpowiedzi i autoselekcja (odpowiadają najbardziej zadowoleni lub najbardziej rozczarowani), małe próby przy kameralnych debatach oraz porównywanie wydarzeń online ze stacjonarnymi.
- **Interpretation (EN):** Indicates whether the event generates recommendations and repeat attendance; for partners/sponsors a higher NPS correlates with growth in exhibitors and revenue (UFI/Explori). Pitfalls: low response rates and self-selection, small samples at intimate debates, comparing online with in-person events.

**Kontekst:** Uczestnicy wydarzeń stacjonarnych (konferencje, debaty, prezentacje raportów) · okres: na wydarzenie · metoda: Heurystyka: NPS odwiedzających targi +11 / +17 (UFI/Explori 2017, zależnie od strategii nowości), wzrost średniej NPS targów o prawie 20 pkt od 2021 r. (Explori 2022), ogólna mediana NPS 42–44 (Survicate/SurveyMonkey). · źródła: S19, S20, S6, S7

| Ocena     | Przedział | Uwagi                                                         |
| --------- | --------- | ------------------------------------------------------------- |
| krytyczny | -100–0    |                                                               |
| słaby     | 0–15      | okolice przedpandemicznego NPS odwiedzających targi (+11…+17) |
| normalny  | 15–35     | po wzroście średniej o ~20 pkt od 2021 r. (Explori)           |
| dobry     | 35–55     | okolice ogólnej mediany NPS (42–44)                           |
| optymalny | 55–100    |                                                               |

**Kontekst:** Uczestnicy wydarzeń online (webinary, debaty transmitowane) · okres: na wydarzenie · metoda: Heurystyka: pasma przesunięte o +5 pkt względem stacjonarnych, bo Explori raportuje, że 'advocacy is higher for virtual events than live events' (bez liczb). Odniesieniem jest ogólna mediana NPS. · źródła: S21, S7

| Ocena     | Przedział | Uwagi |
| --------- | --------- | ----- |
| krytyczny | -100–0    |       |
| słaby     | 0–20      |       |
| normalny  | 20–40     |       |
| dobry     | 40–60     |       |
| optymalny | 60–100    |       |

**Kontekst:** Partnerzy, sponsorzy, wystawcy · okres: na wydarzenie / edycję · metoda: Kwartyle UFI & Explori 2017 dla NPS wystawców: globalnie −17, 25% wydarzeń poniżej −36 i 25% powyżej 0. Dla Europy również −17. · źródła: S19, S20

| Ocena     | Przedział | Uwagi                                     |
| --------- | --------- | ----------------------------------------- |
| krytyczny | -100–-36  | dolny kwartyl wydarzeń (P25 ≈ −36)        |
| słaby     | -36–-17   | P25–mediana (−17)                         |
| normalny  | -17–0     | mediana–P75 (25% wydarzeń ma NPS dodatni) |
| dobry     | 0–20      | górny kwartyl                             |
| optymalny | 20–100    |                                           |

**Zastrzeżenia:**

- Brak aktualnych, publicznych benchmarków NPS konferencji. Bazy Explori są dostępne tylko dla klientów, a dostępne liczby dotyczą targów (2017) i trendu (2022).
- Dane partnerów i sponsorów pochodzą sprzed pandemii (2017). Explori raportuje późniejszy wzrost NPS, więc progi mogą być dziś zaniżone.
- Targi branżowe to inny format niż debaty think tanku. Traktuj pasma jako orientacyjne i oceniaj głównie trend między edycjami tego samego cyklu.

**Poprawki weryfikacji (do naniesienia):**

- Źródło S21: zmień datę 'b.d.' na 'VI 2020'. Kontekst 'Partnerzy, sponsorzy, wystawcy': pasma kwartylowe potwierdzone. Rozkład UFI/Explori 2017: 25% < −36, 50% < −17, 25% > 0, więc notatki 'P25 ≈ −36' i 'mediana −17' są poprawne. Dopisz jednak w nazwie metody 'baseline 2017 (targi, wystawcy)'. Explori 2022 ('+prawie 20 pkt od 2021') nie wskazuje, czy chodzi o wystawców, czy o odwiedzających, więc nie przesuwaj pasm o +20 jako faktu. Ewentualne przesunięcie (np. o +15) oznacz jako heurystykę.

### AMR: Odsetek aktywnych członków społeczności (klubu) (Active community member rate)

- **Rozwinięcie:** Active Member Rate – odsetek członków z dostępem do klubu lub społeczności, którzy w okresie byli aktywni (zalogowali się, czytali wątki, wzięli udział w spotkaniu) / Active Member Rate – share of members with access to the club/community who were active in the period (logged in, read threads, attended a meeting)
- **Wzór:** AMR = unikalni aktywni członkowie w okresie (miesiąc lub 120 dni) / wszyscy członkowie z aktywnym dostępem na koniec okresu × 100%
- **Jednostka:** % · **Kierunek:** wyżej = lepiej · **Pewność:** niska
- **Interpretacja (PL):** Mierzy, czy członkostwo jest żywe, czy tylko opłacone lub założone. To wczesny sygnał ryzyka nieodnowienia. Pułapki: mianownik zawyżają nigdy niedezaktywowane konta (Higher Logic: 69,9 tys. kont, z czego 9,3 tys. aktywnych w 120 dni). Część członków korzysta tylko z digestu e-mail (otwarcia 44–56%), więc miara oparta na logowaniu zaniża realne zaangażowanie.
- **Interpretation (EN):** Shows whether membership is alive or merely paid/created, and is an early non-renewal risk signal. Pitfalls: never-deactivated accounts inflate the denominator (Higher Logic: 69.9k accounts vs 9.3k active in 120 days); some members only consume the email digest (44–56% opens), so login-based measures understate engagement.

**Kontekst:** Duża, otwarta społeczność online (tysiące kont), aktywność miesięczna · okres: miesięcznie (pomocniczo 120 dni) · metoda: Heurystyka zakotwiczona w Higher Logic 2025: w społecznościach XL (>50 tys. kont) 10% użytkowników loguje się w miesiącu, a średnio 13% kont jest aktywnych w 120 dni. · źródła: S23

| Ocena     | Przedział | Uwagi                                                   |
| --------- | --------- | ------------------------------------------------------- |
| krytyczny | 0–2       |                                                         |
| słaby     | 2–5       |                                                         |
| normalny  | 5–10      |                                                         |
| dobry     | 10–15     | społeczności XL: 10% użytkowników loguje się w miesiącu |
| optymalny | 15–100    |                                                         |

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

**Poprawki weryfikacji (do naniesienia):**

- Kontekst 'Duża, otwarta społeczność': kotwica 'XL: 10% loguje się w miesiącu' jest wewnętrznie sprzeczna w samym raporcie (1 297 unikalnych logowań przy ponad 50 tys. kont daje ≤2,6%). Średnio 563 unikalnych logujących miesięcznie przy medianie 12 040 kont daje rząd kilku procent, a w 120 dniach aktywnych jest 13% kont. Przy mianowniku 'wszystkie konta' obecne pasma (normalny 5–10, dobry 10–15) są zbyt optymistyczne. Propozycja (heurystyka): krytyczny [0, 1), słaby [1, 3), normalny [3, 6), dobry [6, 10), optymalny ≥10. Alternatywnie zostaw pasma, ale zmień mianownik na 'konta z aktywnością w ostatnich 120 dniach' (563/9,3 tys. ≈ 6%, czyli normalny ok. 5–10%). W panelu trzeba jednoznacznie wybrać jeden mianownik. Kontekst małego klubu: bez zmian (heurystyka).

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

**Poprawki weryfikacji (do naniesienia):**

- Pasma bez zmian. Liczby potwierdzone (68/563 ≈ 12%, '6% of the average monthly login base', S 36%, S/M 21%, M 17%, 3–5 lat 7–10%, <2 lata 16%). Dopisz zastrzeżenie, że Higher Logic nie definiuje jednoznacznie mianownika dla wartości per rozmiar i wiek ('44 logins, but 36% of those are contributors'), więc mogą to być logowania, a nie unikalni logujący.

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

- Jedno źródło: dane klientów jednej agencji (ok. 70% B2B, głównie SEO, rynek USA). Raport ma niespójności liczby branż (30 / 15 / 29).
- Brak polskich ani europejskich benchmarków. Wskaźnik ma sens dopiero po spisaniu definicji MQL w CRM (np. scoring dopasowania i zachowania).

**Poprawki weryfikacji (do naniesienia):**

- Pasma bez zmian, liczby potwierdzone. W zastrzeżeniach dopisz, że raport nie podaje okresu danych ('built over 10 years'). Ta sama agencja podaje dla Entertainment Lead→MQL 34% (S24) i 19% (S26), co dodatkowo uzasadnia confidence 'średnia/niska'.

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
| krytyczny | ≥ 1440    | >24 h – według HBR >60 razy mniejsza szansa kwalifikacji niż przy kontakcie w ciągu godziny |
| słaby     | 480–1440  | kontakt następnego dnia roboczego                                                           |
| normalny  | 60–480    | ten sam dzień roboczy                                                                       |
| dobry     | 5–60      | w ciągu godziny (37% firm w badaniu HBR)                                                    |
| optymalny | 0–5       | standard 'pięciu minut'; 74% firm go nie spełnia (Blazeo 2026)                              |

**Zastrzeżenia:**

- Kluczowe dane HBR pochodzą z 2011 r. i z rynku USA. Pełny tekst jest za paywallem, a liczby potwierdzono w streszczeniu SmartCompany (2011).
- Reguła pięciu minut opiera się na starszych badaniach dostawców (InsideSales) i bywa kwestionowana. Dane Blazeo 2026 to raport dostawcy znany z komunikatu prasowego i omówienia LeanData.
- Brak polskich danych. Dla klientów sektora publicznego szybki kontakt nie skraca procedur zamówień, ale nadal wpływa na kwalifikację.

**Poprawki weryfikacji (do naniesienia):**

- Pasma bez zmian. W zastrzeżeniach dopisz, że analiza 1,25 mln leadów (mnożniki 7× i 60×) objęła 29 firm B2C i tylko 13 B2B. Dane Blazeo 2026 (74%, SLA 54,9% vs 29,5%) są potwierdzone wyłącznie w omówieniu LeanData, bo raportu pierwotnego nie zweryfikowano.

### SCL: Długość cyklu sprzedaży B2B (B2B sales cycle length)

- **Rozwinięcie:** Sales Cycle Length – liczba dni od utworzenia szansy sprzedażowej (SQL/opportunity) do jej wygrania (closed-won) / Sales Cycle Length – days from opportunity (SQL) creation to closed-won
- **Wzór:** SCL = mediana (data wygranej − data utworzenia szansy) w dniach dla transakcji wygranych w okresie, osobno dla nowych klientów i rozszerzeń oraz według wielkości transakcji. Pomocniczo: % otwartych szans starszych niż 2× typowy cykl.
- **Jednostka:** days · **Kierunek:** niżej = lepiej · **Pewność:** średnia
- **Interpretacja (PL):** Pokazuje tempo zamieniania szans w przychód i pomaga planować przepływy oraz pipeline, np. sprzedaż sponsoringu z wyprzedzeniem przed wydarzeniem. Ebsta pokazuje, że szanse otwarte dłużej niż dwukrotność typowego cyklu mają ok. 3% szans na wygraną, a poślizg późnych etapów o ponad 2 miesiące drastycznie obniża skuteczność. Pułapki: średnia zamiast mediany (zawyżają ją pojedyncze długie transakcje) oraz mieszanie małych i dużych umów. Cykl skrócony rabatem może obniżyć wartość transakcji.
- **Interpretation (EN):** Shows how fast opportunities turn into revenue and supports cash-flow and pipeline planning (e.g., selling sponsorship well ahead of an event). Ebsta shows opportunities open longer than twice the typical cycle have about a 3% chance of closing, and late-stage slippage beyond 2 months sharply cuts win rates. Pitfalls: mean instead of median (skewed by a few long deals), mixing small and large deals; shortening the cycle via discounts can erode deal value.

**Kontekst:** Małe transakcje B2B (np. subskrypcje firmowe, pojedyncze pakiety) · okres: kwartalnie (mediana transakcji wygranych) · metoda: Ebsta 2023 (3,2 mln szans): 'złoty okres' zamknięcia małych transakcji to 31–60 dni (win rate wyższy o 165%), a szanse otwarte >2× dłużej niż średni cykl mają ok. 3% szans. Pasma to heurystyka wokół tych punktów. · źródła: S28

| Ocena     | Przedział | Uwagi                                                    |
| --------- | --------- | -------------------------------------------------------- |
| krytyczny | ≥ 120     | ≈2× górna granica 'złotego okresu' – szansa wygranej ~3% |
| słaby     | 90–120    |                                                          |
| normalny  | 60–90     |                                                          |
| dobry     | 45–60     | w 'złotym okresie' 31–60 dni                             |
| optymalny | 0–45      |                                                          |

**Kontekst:** Średnie transakcje z nowymi klientami (np. pakiety sponsorskie, członkostwa instytucjonalne) · okres: kwartalnie · metoda: Ebsta x Pavilion 2025: nowi klienci średnio 91 dni, a top performerzy mają cykl krótszy o 42%. Ebsta 2023: 'złoty okres' 61–90 dni dla średnich transakcji. · źródła: S27, S28

| Ocena     | Przedział | Uwagi                                               |
| --------- | --------- | --------------------------------------------------- |
| krytyczny | ≥ 180     | ≈2× średni cykl                                     |
| słaby     | 120–180   |                                                     |
| normalny  | 91–120    | od średniej Ebsta 2025 dla nowych klientów (91 dni) |
| dobry     | 75–91     | 'złoty okres' 61–90 dni                             |
| optymalny | 0–75      |                                                     |

**Kontekst:** Duże transakcje (partnerstwa strategiczne, projekty badawcze na zlecenie) · okres: półrocznie / rocznie · metoda: Ebsta 2023: 'złoty okres' 150–180 dni dla dużych transakcji. Próg krytyczny to heurystyka 2× cyklu. · źródła: S28

| Ocena     | Przedział | Uwagi                     |
| --------- | --------- | ------------------------- |
| krytyczny | ≥ 360     | ≈2× 'złoty okres'         |
| słaby     | 240–360   |                           |
| normalny  | 180–240   |                           |
| dobry     | 150–180   | 'złoty okres' 150–180 dni |
| optymalny | 0–150     |                           |

**Kontekst:** Rozszerzenia i odnowienia u obecnych klientów · okres: kwartalnie · metoda: Ebsta x Pavilion 2025: rozszerzenia zamykane średnio w 52 dni (vs 91 dni dla nowych klientów). Pasma to heurystyka. · źródła: S27

| Ocena     | Przedział | Uwagi                      |
| --------- | --------- | -------------------------- |
| krytyczny | ≥ 104     | 2× średni cykl rozszerzeń  |
| słaby     | 75–104    |                            |
| normalny  | 52–75     | od średniej Ebsta (52 dni) |
| dobry     | 40–52     |                            |
| optymalny | 0–40      |                            |

**Zastrzeżenia:**

- Ebsta segmentuje transakcje według wartości w USD na rynku głównie technologicznym. Przypisanie produktów think tanku do segmentów małe, średnie i duże jest heurystyczne.
- Klienci z sektora publicznego (zamówienia publiczne) i budżety roczne instytucji mogą wydłużać cykl niezależnie od jakości sprzedaży. Warto mieć dla nich osobny kontekst.
- Brak danych polskich. Ebsta 2025 raportuje skrócenie cykli o 9% r/r i 36% transakcji z poślizgiem.

**Poprawki weryfikacji (do naniesienia):**

- Kontekst 'Małe transakcje': obecne pasma rozcinają złoty okres Ebsta (31–60 dni) na 'dobry' 45–60 i 'optymalny' <45. Proponuję: optymalny [0, 60) (do końca złotego okresu), dobry [60, 75), normalny [75, 90), słaby [90, 120), krytyczny ≥120. Notatkę progu krytycznego popraw z '≈2× górna granica złotego okresu' na: 'Ebsta: szanse otwarte >2× ŚREDNIEGO cyklu mają ok. 3% szans; licz próg dynamicznie jako 2× własna mediana'. Kontekst średnich transakcji: dopisz kotwicę top performerów (cykl krótszy o 42% od 91 dni ≈ 53 dni, wyliczenie własne) jako uzasadnienie pasma 'optymalny'.

### Źródła grupy: Zaangażowanie, wydarzenia, społeczność i CRM

| Id  | Źródło                                                                                                                                                                           | Wydawca                                                             | Data                                           | Weryfikacja                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | [2024 Mixpanel Benchmarks Report](https://mixpanel.com/wp-content/uploads/2024/01/2024_Benchmarks_Report.pdf)                                                                    | Mixpanel                                                            | 2024-01                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S2  | [State of Digital Analytics 2026](https://mixpanel.com/content/benchmarks-2026)                                                                                                  | Mixpanel                                                            | 2026-10-13                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S3  | [DAU/MAU is an important metric to measure engagement, but here's where it fails](https://andrewchen.com/dau-mau-is-an-important-metric/)                                        | andrewchen.com (Andrew Chen, a16z)                                  | 2018-07 (data wywnioskowana z archiwum strony) | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S4  | [Measuring SaaS Engagement](https://sacks.substack.com/p/measuring-saas-engagement)                                                                                              | David Sacks (Substack)                                              | 2020-11-23                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S5  | [Measuring Your Net Promoter Score](https://nps.bain.com/about/measuring-your-net-promoter-score/)                                                                               | Bain & Company (nps.bain.com)                                       | b.d.                                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S6  | [What is a good Net Promoter Score?](https://uk.surveymonkey.com/curiosity/what-is-a-good-net-promoter-score/)                                                                   | SurveyMonkey                                                        | 2025 (dane benchmarkowe 2025)                  | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S7  | [NPS Benchmarks](https://survicate.com/nps-benchmarks/)                                                                                                                          | Survicate                                                           | 2025-12-03                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S8  | [What Is a Good Net Promoter Score? (NPS benchmarks by industry)](https://www.retently.com/blog/good-net-promoter-score/)                                                        | Retently (Greg Raileanu)                                            | 2026-04-15                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S9  | [Don't use NPS for industry benchmarks](https://www.hellocustomer.com/blog/dont-use-nps-for-industry-benchmarks)                                                                 | HelloCustomer (Anna Pogrebniak)                                     | 2026-07-10                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S10 | [Event Data Lab Report #05: One in Five Registered Attendees Won't Show Up](https://pheedloop.com/blog/event-data-lab-report-5)                                                  | PheedLoop                                                           | 2026-04-29                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S11 | [Event Data Lab Report #06: Does Easier Registration Lead to More No-Shows?](https://pheedloop.com/blog/event-data-lab-report-06)                                                | PheedLoop                                                           | 2026-05-26 (addendum 2026-09-01)               | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S12 | [How to reduce no-shows at your event](https://www.eventbrite.com.au/blog/reduce-no-shows-ds0c/)                                                                                 | Eventbrite Blog (AU)                                                | 2018-08-28                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S13 | [40+ Webinar Statistics B2B Marketers Should Know for 2025](https://www.goldcast.io/blog-post/2025-webinar-statistics-b2b-marketers-should-know)                                 | Goldcast (Alexander Bleeker)                                        | 2025-07-08                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S14 | [2026 B2B Webinar Benchmark Report](https://www.goldcast.io/lp/webinar-benchmark-2026)                                                                                           | Goldcast                                                            | 2026                                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S15 | [Webinar Statistics 2026](https://voxbooster.com/blog/webinar-statistics-2026)                                                                                                   | Voxbooster                                                          | 2026                                           | częściowo: Voxbooster (11.07.2026, 'VoxBooster Team') faktycznie zawiera zdania o ON24 60% i o Contrast (mediana 41,6%, średnia 46,2%, Q3'25–Q1'26). Jako źródło Contrast linkuje jednak getcontrast.io/learn/webinar-benchmarks, a ta strona NIE zawiera liczb 41,6 ani 46,2. Nie wspomina też o danych ON24, GoTo ani BrightTALK. Podaje natomiast dane z własnej platformy: 'a good webinar attendance rate is between 44% and 50% of registrants attending live', średnia live na Contrast ok. 44–50%, '61% of registrants watch the webinar either live or on-demand', ok. 42% wyświetleń z on-demand (ponad 1 mln rejestrujących, aktualizacja 16.04.2026). Atrybucja 41,6/46,2 jest niepotwierdzona, prawdopodobnie błędna, i należy ją usunąć z pasm. ON24 60%: strona ON24 zwraca 403, więc nie potwierdzono tego w źródle pierwotnym. |
| S16 | [B2B Webinar Benchmarks: Conversion, Attendance, Personalization](https://www.marketingprofs.com/charts/2025/52917/b2b-webinar-benchmarks-conversion-attendance-personalization) | MarketingProfs (dane ON24 Webinar Benchmarks Report 2025)           | 2025                                           | nie da się sprawdzić (link niedostępny): MarketingProfs zwraca HTTP 403 zarówno dla WebFetch, jak i dla curl z nagłówkiem przeglądarki. Pierwotny blog ON24 (on24.com) też zwraca 403 dla całej domeny. Liczb 57% / 30% / 25% / 56% live / 45% on-demand nie da się potwierdzić. W przeglądarce link może działać, ale do czasu ręcznej weryfikacji oznacz te wartości jako 'niezweryfikowane' i nie używaj ich jako jedynej kotwicy pasma. Limit wyszukiwań w tej sesji był wyczerpany, więc nie szukałem alternatywnej kopii raportu ON24.                                                                                                                                                                                                                                                                                                    |
| S17 | [Conversion Benchmark Report (2024)](https://unbounce.com/conversion-benchmark-report/)                                                                                          | Unbounce                                                            | 2024                                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S18 | [Entertainment conversion rate – Conversion Benchmark Report 2024](https://unbounce.com/conversion-benchmark-report/entertainment-conversion-rate/)                              | Unbounce                                                            | 2024                                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S19 | [UFI & Explori Global Exhibitor Insights 2017](https://www.ufi.org/wp-content/uploads/2017/11/UFI_Explori_Global_Exhib_Insights-2017-members.pdf)                                | UFI – The Global Association of the Exhibition Industry / Explori   | 2017-11                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S20 | [Trade shows and the pandemic effect](https://www.explori.com/blog/trade-shows-and-the-pandemic-effect)                                                                          | Explori                                                             | 2022-11                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S21 | [What is NPS and why should event professionals care?](https://www.explori.com/blog/nps_for_events)                                                                              | Explori                                                             | b.d.                                           | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S22 | [Participation Inequality: The 90-9-1 Rule for Social Features](https://www.nngroup.com/articles/participation-inequality/)                                                      | Nielsen Norman Group (Jakob Nielsen)                                | 2006-10-08                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S23 | [2025 Association Community Benchmark Report](https://go.higherlogic.com/hubfs/Reports/2025-Association-Community-Benchmark-Report_Higher-Logic.pdf)                             | Higher Logic                                                        | 2025 (dane VI 2024 – V 2025)                   | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S24 | [Lead-to-MQL Conversion Rate Benchmarks by Industry & Channel](https://firstpagesage.com/reports/lead-to-mql-conversion-rate-benchmarks-by-industry-channel-fc/)                 | First Page Sage                                                     | 2025-08-01                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S25 | [MQL to SQL Conversion Rate By Industry: 2026 Report](https://firstpagesage.com/seo-blog/mql-to-sql-conversion-rate-by-industry/)                                                | First Page Sage                                                     | 2024-10-03 (modyfikacja 2025-12-23)            | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S26 | [Sales Funnel Conversion Rate Benchmarks: 2026 Report](https://firstpagesage.com/seo-blog/sales-funnel-conversion-rate-benchmarks-report/)                                       | First Page Sage (Evan Bailyn)                                       | 2026-08-10                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S27 | [GTM Benchmarks Report 2025](https://www.joinpavilion.com/hubfs/Ebsta%20x%20Pavilion%202025%20GTM%20Benchmarks%20Report.pdf?hsLang=en)                                           | Ebsta x Pavilion                                                    | 2025-03                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S28 | [2023 B2B Sales Benchmarks Report](https://www.ebsta.com/wp-content/uploads/2023/02/2023-B2B-Sales-Benchmark-Report.pdf)                                                         | Ebsta (we współpracy z Pavilion)                                    | 2023-02                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S29 | [Are you letting online leads go cold?](https://www.smartcompany.com.au/marketing/20110704-are-you-letting-online-leads-go-cold/)                                                | SmartCompany (streszczenie badania Harvard Business Review)         | 2011-07-01                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S30 | [The Short Life of Online Sales Leads](https://hbr.org/2011/03/the-short-life-of-online-sales-leads)                                                                             | Harvard Business Review (J. B. Oldroyd, K. McElheran, D. Elkington) | 2011-03                                        | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S31 | [Speed to Lead: Speed Is the Key to Lead Conversion](https://leandata.com/blog/speed-to-lead-speed-is-the-key-to-lead-conversion/)                                               | LeanData                                                            | 2026-04-15                                     | tak                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
