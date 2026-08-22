-- ============================================================================
-- KATALOG v6.1 W KARTACH CENNIKA: BILET, CHATHAM HOUSE, WCZESNY DOSTĘP
--
-- Karty na /pricing renderują się z `membership_tiers.benefits`, więc obietnica
-- widziana przez klienta mieszka TUTAJ, nie w dokumencie katalogu. Dopóki
-- benefity zostają w brzmieniu seedu v3, wdrożenie bramek z migracji
-- 20260822091000-093000 byłoby niewidoczne dla kupującego, a dwie pozycje
-- kłamałyby wprost:
--
--   * próg Członek obiecywał „zniżkę na konferencję", której v6.1 nie ma -
--     została zastąpiona wliczonym biletem (zniżka jest obietnicą warunkową,
--     której członek musi użyć, żeby cokolwiek dostać; przy odnowieniu nie ma
--     jej w bilansie, jeżeli nie została wykorzystana),
--   * próg Członek obiecywał „wczesny dostęp do raportów przed publikacją
--     otwartą" bez liczby - a od 20260822093000 wczesny dostęp jest bramką
--     na fladze `early_access`, którą katalog v6 przeniósł na próg Pro.
--
-- Zmiany są WYŁĄCZNIE tam, gdzie audyt albo wdrożone bramki tego wymagają.
-- Nazwy progów, ceny i rangi zostają nietknięte - to osobna decyzja handlowa.
--
-- Wzorzec zapisu: podmieniamy CAŁĄ tablicę `benefits` warstwy, bo jsonb nie ma
-- sensownego „zamień element pasujący do wzorca", a punktowe operacje na
-- indeksach rozjeżdżają się przy pierwszej ręcznej edycji w panelu. Warunek
-- `WHERE` pilnuje idempotencji: migracja nie nadpisze karty, która ma już nową
-- treść, i nie odbierze redakcji późniejszych zmian.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Członek: wliczony bilet zamiast zniżki, bez wczesnego dostępu.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełne archiwum analiz i policy papers, bez limitów","en":"The full archive of analyses and policy papers, no limits",
         "group_pl":"Wszystko z progu Czytelnik, oraz:","group_en":"All of Reader, plus:"},
        {"pl":"Wszystkie briefingi członkowskie online w roku, wraz z nagraniami","en":"Every online member briefing in the year, with recordings"},
        {"pl":"1 wliczony bilet rocznie na wydarzenie biletowane, w tym „Geopolityczna Gra Mocarstw”","en":"1 included ticket a year for a ticketed event, including „Geopolityczna Gra Mocarstw”"},
        {"pl":"Pogłębiony digest członkowski: 44 wydania rocznie","en":"The in-depth member digest: 44 issues a year"},
        {"pl":"1 zapytanie do eksperta miesięcznie","en":"1 expert request a month"},
        {"pl":"Czat i wiadomości z innymi członkami","en":"Chat and messages with other members"},
        {"pl":"Narzędzia cytowania: Chicago, APA, BibTeX","en":"Citation tools: Chicago, APA, BibTeX"},
        {"pl":"Rezygnacja w każdej chwili, bez okresu wypowiedzenia","en":"Cancel at any time, with no notice period"}]'::jsonb
 WHERE key = 'member'
   AND benefits::text NOT LIKE '%wliczony bilet%';

-- ----------------------------------------------------------------------------
-- 2) Członek Pro: bilet dziedziczony (nie drugi), Chatham House, 72 godziny.
--
--    Doprecyzowanie z rozdziału 3 audytu: zapis „Wszystko z progu Członek,
--    wraz z wliczonym biletem" czytał się dwuznacznie - jakby Pro dostawał
--    bilet dodatkowy. Pula liczy MAKSIMUM z warstw (20260822091000), więc
--    bilet jest ten sam. Karta musi mówić to samo, co licznik.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełne członkostwo w jednym klubie dyskusyjnym do wyboru","en":"Full membership of one discussion club of your choice",
         "group_pl":"Wszystko z progu Członek - wraz z tym samym jednym biletem rocznie, nie drugim - oraz:","group_en":"All of Member - including the same single yearly ticket, not a second one - plus:"},
        {"pl":"Monitoring regulacyjny: tracker legislacyjny UE z alertami","en":"Regulatory monitoring: the EU legislative tracker with alerts"},
        {"pl":"4 zamknięte briefingi Pro rocznie: marzec, czerwiec, wrzesień, grudzień","en":"4 closed-door Pro briefings a year: March, June, September, December"},
        {"pl":"Spotkania prowadzone w regule Chatham House","en":"Meetings held under the Chatham House Rule"},
        {"pl":"4 noty foresightowe rocznie, w ostatnim tygodniu kwartału","en":"4 foresight notes a year, in the last week of each quarter"},
        {"pl":"Wczesny dostęp do raportów: 72 godziny przed publikacją otwartą","en":"Early access to reports: 72 hours before open publication"},
        {"pl":"3 zapytania do eksperta miesięcznie","en":"3 expert requests a month"},
        {"pl":"Priorytet pytań w sesjach Q&A z ekspertami","en":"Priority questions in expert Q&A sessions"},
        {"pl":"Linki podarunkowe: 3 pełne analizy miesięcznie dla osób spoza platformy","en":"Gift links: 3 full analyses a month for people outside the platform"}]'::jsonb
 WHERE key = 'pro'
   AND benefits::text NOT LIKE '%Chatham House%';

-- ----------------------------------------------------------------------------
-- 3) Stawki ulgowe: zniżka 50% zamiast biletu (korekta 2.4 audytu).
--
--    Bilet o cenie katalogowej 300 zł przy składce studenckiej 190 zł rocznie
--    to sprzedaż poniżej kosztu krańcowego uczestnictwa - a student jest
--    jednocześnie grupą, która skorzysta z niego najchętniej.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełny zakres progu Członek, bez limitów, na komputerze i telefonie","en":"The full Member scope, no limits, on desktop and mobile"},
        {"pl":"Wszystkie briefingi członkowskie online wraz z nagraniami","en":"All online member briefings, with recordings"},
        {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
        {"pl":"Cotygodniowy przegląd i pogłębiony digest członkowski","en":"The weekly review and the in-depth member digest"},
        {"pl":"Dostęp do materiałów edukacyjnych New European Strategies, w tym EuroChallenge","en":"Access to New European Strategies educational materials, including EuroChallenge"},
        {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; legitymacja wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; a student ID only for domains outside the list"}]'::jsonb
 WHERE key = 'student'
   AND benefits::text NOT LIKE '%Zniżka 50%';

UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Materiały dydaktyczne: kluczowe wnioski i słowniczek pojęć przy analizach","en":"Teaching materials: key takeaways and a glossary alongside analyses",
         "group_pl":"Wszystko ze stawki studenckiej, oraz:","group_en":"All of the Student rate, plus:"},
        {"pl":"Licencja do wykorzystania treści na zajęciach","en":"A licence to use content in class"},
        {"pl":"Prawo cytowania analiz w publikacjach naukowych","en":"The right to cite analyses in academic publications"},
        {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
        {"pl":"Priorytetowe zaproszenia na seminaria akademickie New European Strategies","en":"Priority invitations to New European Strategies academic seminars"},
        {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; dokument afiliacyjny wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; an affiliation document only for domains outside the list"}]'::jsonb
 WHERE key = 'educator'
   AND benefits::text NOT LIKE '%Zniżka 50%';

-- ----------------------------------------------------------------------------
-- 4) Zespół: pula organizacyjna, próg wolumenowy i jawna ranga.
--
--    Rozdział 3 audytu, rozstrzygnięcie zamknięte: ranga Zespołu zostaje 25,
--    ale przestaje być niezapisaną konsekwencją seedu. Karta mówi wprost, że
--    zakres to Pro PLUS wejścia rangi 25 - koniec rozjazdu między obietnicą
--    a bramką bez ruszania bazy.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Pełny zakres progu Członek Pro dla każdego miejsca","en":"The full Member Pro scope for every seat"},
        {"pl":"Wejścia rangi 25: kluby i treści otwarte dla Rady Instytutu","en":"Rank 25 entries: clubs and content open to the Institute Council"},
        {"pl":"3 wliczone bilety rocznie na organizację, niezależnie od liczby miejsc","en":"3 included tickets a year per organisation, regardless of seat count"},
        {"pl":"Onboarding zespołowy: przypisanie wszystkich miejsc do klubów w 7 dni od zakupu","en":"Team onboarding: every seat assigned to a club within 7 days of purchase"},
        {"pl":"Panel miejsc: zapraszanie, odbieranie i przenoszenie między osobami","en":"A seat panel: invite, revoke and reassign between people"},
        {"pl":"Wspólna biblioteka i archiwum organizacji","en":"A shared library and organisation archive"},
        {"pl":"Jedna zbiorcza faktura dla całego zespołu","en":"One consolidated invoice for the whole team"},
        {"pl":"Rabat wolumenowy od 11 miejsc: 79 zł za miejsce","en":"Volume discount from 11 seats: 79 zł per seat"}]'::jsonb
 WHERE key = 'team'
   AND benefits::text NOT LIKE '%3 wliczone bilety%';

-- ----------------------------------------------------------------------------
-- 5) Partner Instytucjonalny: jawność finansowania przestaje być benefitem.
--
--    Rozdział „Jawność finansowania" katalogu v6.1: wymienienie partnera na
--    liście finansujących nie jest korzyścią z tytułu składki, tylko wymogiem
--    jawności - lista jest publikowana niezależnie od jego woli. Sprzedawanie
--    tego jako benefitu obniża wiarygodność oferty u odbiorcy instytucjonalnego,
--    który tę różnicę rozpoznaje.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Do 10 osób nominowanych z pełnym zakresem Pro","en":"Up to 10 nominated people with the full Pro scope",
         "group_pl":"Wszystko z progu Członek Pro dla osób nominowanych, oraz:","group_en":"All of Member Pro for nominated people, plus:"},
        {"pl":"1 Decision Lab rocznie z dwoma miejscami dla osób nominowanych","en":"1 Decision Lab a year with two seats for nominated people"},
        {"pl":"Sounding board: rekomendacje do komentarza 10 dni roboczych przed publikacją","en":"Sounding board: recommendations for comment 10 working days before publication"},
        {"pl":"4 briefingi zamknięte dla organizacji w roku","en":"4 closed-door briefings for the organisation a year"},
        {"pl":"8 godzin konsultacji analitycznych rocznie, jednostka 30 minut","en":"8 hours of analytical consultation a year, in 30-minute units"},
        {"pl":"Wszystkie kluby dyskusyjne dla osób nominowanych","en":"All discussion clubs for nominated people"}]'::jsonb
 WHERE key = 'partner'
   AND benefits::text LIKE '%Wyróżnienie jako partner%';

-- ----------------------------------------------------------------------------
-- 6) Partner Strategiczny: własna grupa zadaniowa z liczbą spotkań.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET benefits = '[
        {"pl":"Do 25 osób nominowanych, bez dopłaty za miejsce","en":"Up to 25 nominated people, with no per-seat charge",
         "group_pl":"Wszystko z progu Partner Instytucjonalny, oraz:","group_en":"All of Institutional Partner, plus:"},
        {"pl":"1 własna grupa zadaniowa rocznie: cykl 4 spotkań zakończony raportem sygnowanym wspólnie","en":"1 own task force a year: a cycle of 4 meetings closing with a co-signed report"},
        {"pl":"2 dedykowane briefingi szyte na miarę w roku","en":"2 dedicated, tailor-made briefings a year"},
        {"pl":"20 godzin dostępu do analityka rocznie","en":"20 hours of analyst access a year"},
        {"pl":"Prywatny mikroserwis klubowy dla organizacji","en":"A private club micro-site for the organisation"},
        {"pl":"1 slot prelegencki na konferencji New European Strategies w roku","en":"1 speaking slot at the New European Strategies conference each year"},
        {"pl":"2 kolacje eksperckie na poziomie zarządu w roku","en":"2 board-level expert dinners a year"}]'::jsonb
 WHERE key = 'partner_general'
   AND benefits::text NOT LIKE '%mikroserwis klubowy%';
