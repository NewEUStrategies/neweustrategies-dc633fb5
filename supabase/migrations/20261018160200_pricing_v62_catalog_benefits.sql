-- ============================================================================
-- CENNIK v6.2 (3/5): BENEFITY KART PL/EN
--
-- Karty na /pricing renderują się z `membership_tiers.benefits`, więc obietnica
-- widziana przez kupującego mieszka TUTAJ, nie w dokumencie katalogu. Funkcja
-- jest osobna od `pricing_catalog_v62_rows()` wyłącznie z powodu limitu
-- rozmiaru pliku migracji (45 KiB); seed i apply łączą je po kluczu.
--
-- ZASADA TREŚCI: karta mówi to, co v6.2, i NIC ponad to.
--   * Pozycje [B] (bramka w platformie) i [P] (zobowiązanie procesowe z liczbą
--     albo terminem w kalendarzu konwenignu) wchodzą w brzmieniu dokumentu.
--   * Pozycje [N] - „pytania do archiwum" 3 / 20 / bez limitu - są POMINIĘTE:
--     warstwa odpowiedzi na archiwum nie istnieje, a karta nie może sprzedawać
--     funkcji bez kodu. Rozjazd zgłoszony w raporcie wdrożenia.
--   * Pozycje z v3/v4 bez pokrycia w v6.2 znikają: karta VIP, Zjazd VIP,
--     pakiet drukowany, Career Path, wprowadzenia do sieci, wyróżnienie
--     partnera misyjnego i „publiczne uznanie" fundatorów (jawność
--     finansowania nie jest benefitem - v6.2, zakładka „Instytucje").
--   * Granica wpływu (sounding board, zgłoszenie tematu, agenda Kręgu) jest
--     treścią WIĄŻĄCĄ katalogu, więc stoi przy benefitach jako `detail_*`.
--
-- Kolejność Członka Pro: trzy pierwsze pozycje to klub, monitoring i cztery
-- briefingi - spotlight „Co wyróżnia ten plan" bierze pierwsze trzy pozycje
-- nieobecne w progu niżej, a v6.2 („Komunikacja karty") każe różnicę wobec
-- Członka komunikować dokładnie tymi trzema.
--
-- Rozjazdy v6.2 z bramkami - karta mówi, co daje bramka (raport wdrożenia):
--   * Zespół: v6.2 „pełny zakres Pro", próg bez `regulatory_monitoring`;
--   * NGO: v6.2 „zakres Partnera Instytucjonalnego -50%", próg ma rangę 20 -
--     karta niesie wyłącznie informację cenową z odesłaniem do Partnera;
--   * student / kadra: wyłącznie pozycje v6.2 (ten sam zakres TREŚCIOWY co
--     Członek, zniżka 50% zamiast biletu, licencja dydaktyczna [P]) - bez
--     EuroChallenge, słowniczka, „prawa cytowania" i priorytetu seminariów,
--     których v6.2 nie zna i których nie ma w kalendarzu zobowiązań.
--
-- `business`, `corporate`: treść bez zmian (karty ukryte; obecni klienci
-- Partnera Biznesowego widzą swoje benefity w profilu). `supporter`: bez
-- obietnicy benefitu - darowizna nim nie jest (v6.2).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pricing_catalog_v62_benefits()
RETURNS TABLE (key text, benefits jsonb)
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    ('reader', '[
      {"pl":"Konto NES: obserwowane tematy, zapisane analizy, historia lektury","en":"An NES account: followed topics, saved analyses, reading history"},
      {"pl":"5 analiz miesięcznie po rejestracji (bez konta: 0)","en":"5 analyses a month once you register (none without an account)"},
      {"pl":"Policy papers we fragmentach z kluczowymi wnioskami","en":"Policy paper excerpts with the key takeaways"},
      {"pl":"Cotygodniowy przegląd geopolityczny: 52 wydania rocznie","en":"The weekly geopolitical review: 52 issues a year"},
      {"pl":"Otwarte dyskusje społeczności","en":"Open community discussions"},
      {"pl":"Zaproszenia na wydarzenia otwarte","en":"Invitations to open events"}]'::jsonb),
    ('supporter', '[
      {"pl":"Wszystko z progu Czytelnik","en":"Everything in Reader"},
      {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb),
    ('member', '[
      {"pl":"Pełne archiwum analiz i policy papers, bez limitu","en":"The full archive of analyses and policy papers, no limits",
       "group_pl":"Wszystko z progu Czytelnik, oraz:","group_en":"All of Reader, plus:"},
      {"pl":"Wszystkie briefingi członkowskie online w roku, wraz z nagraniami","en":"Every online member briefing in the year, with recordings"},
      {"pl":"1 wliczony bilet rocznie na wydarzenie biletowane, w tym „Geopolityczna Gra Mocarstw”","en":"1 included ticket a year for a ticketed event, including „Geopolityczna Gra Mocarstw”"},
      {"pl":"Pogłębiony digest członkowski: 44 wydania rocznie","en":"The in-depth member digest: 44 issues a year"},
      {"pl":"1 zapytanie do eksperta miesięcznie","en":"1 expert request a month"},
      {"pl":"Czat i wiadomości z innymi członkami","en":"Chat and messages with other members"},
      {"pl":"Kluby: obserwator w jednym klubie otwartym","en":"Clubs: observer in one open club"},
      {"pl":"Panel „Analiza Tygodnia”: mapy, wykresy, dane","en":"The „Analysis of the Week” panel: maps, charts, data"},
      {"pl":"Podcast „Depesza Dyplomaty” w całości, wywiady i materiały wideo","en":"The full „Depesza Dyplomaty” podcast, interviews and video"},
      {"pl":"Narzędzia cytowania: Chicago, APA, BibTeX","en":"Citation tools: Chicago, APA, BibTeX"},
      {"pl":"Rezygnacja w każdej chwili, bez okresu wypowiedzenia","en":"Cancel at any time, with no notice period"}]'::jsonb),
    ('student', '[
      {"pl":"Ten sam zakres treściowy co Członek: pełne archiwum analiz i policy papers","en":"The same content scope as Member: the full archive of analyses and policy papers",
       "detail_pl":"Bez wliczonego biletu i bez zapytań do ekspertów - te pozycje należą do progu Członek.","detail_en":"No included ticket and no expert requests - those belong to the Member tier."},
      {"pl":"Wszystkie briefingi członkowskie online wraz z nagraniami","en":"All online member briefings, with recordings"},
      {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
      {"pl":"Cotygodniowy przegląd i pogłębiony digest członkowski","en":"The weekly review and the in-depth member digest"},
      {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; legitymacja wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; a student ID only for domains outside the list"}]'::jsonb),
    ('educator', '[
      {"pl":"Licencja na wykorzystanie analiz na zajęciach (licencja umowna)","en":"A licence to use analyses in class (a contractual licence)",
       "group_pl":"Wszystko ze stawki studenckiej, oraz:","group_en":"All of the Student rate, plus:"},
      {"pl":"Zniżka 50% na wydarzenia biletowane, zamiast biletu wliczonego","en":"50% off ticketed events, in place of an included ticket"},
      {"pl":"Weryfikacja automatyczna adresem w domenie uczelni; dokument afiliacyjny wyłącznie dla domen spoza listy","en":"Automatic verification with a university-domain address; an affiliation document only for domains outside the list"}]'::jsonb),
    ('pro', '[
      {"pl":"Kluby: pełne członkostwo w jednym klubie do wyboru","en":"Clubs: full membership of one club of your choice",
       "group_pl":"Wszystko z progu Członek - wraz z tym samym jednym biletem rocznie, nie drugim - oraz:","group_en":"All of Member - including the same single yearly ticket, not a second one - plus:"},
      {"pl":"Monitoring regulacyjny: tracker legislacyjny UE z alertami","en":"Regulatory monitoring: the EU legislative tracker with alerts"},
      {"pl":"4 zamknięte briefingi Pro rocznie: marzec, czerwiec, wrzesień, grudzień","en":"4 closed-door Pro briefings a year: March, June, September, December"},
      {"pl":"Onboarding klubowy: przypisanie w 48 godzin od zakupu, imienne powitanie w wątku, pytanie otwierające od moderatora","en":"Club onboarding: assignment within 48 hours of purchase, a personal welcome in the thread and an opening question from the moderator"},
      {"pl":"Kluby: wątki, dokumenty, ankiety, kalendarz klubu","en":"Clubs: threads, documents, polls and the club calendar"},
      {"pl":"4 noty foresightowe rocznie, w ostatnim tygodniu kwartału","en":"4 foresight notes a year, in the last week of each quarter"},
      {"pl":"3 zapytania do eksperta miesięcznie","en":"3 expert requests a month"},
      {"pl":"Priorytet pytań w sesjach Q&A z ekspertami","en":"Priority questions in expert Q&A sessions"},
      {"pl":"Linki podarunkowe: 3 pełne analizy miesięcznie dla osób spoza platformy","en":"Gift links: 3 full analyses a month for people outside the platform"},
      {"pl":"Wczesny dostęp do raportów: 72 godziny przed publikacją otwartą","en":"Early access to reports: 72 hours before open publication"},
      {"pl":"Spotkania prowadzone w regule Chatham House","en":"Meetings held under the Chatham House Rule"},
      {"pl":"Wydarzenia o ograniczonej liczbie miejsc, z kolejką rezerwową","en":"Limited-capacity events, with a waiting list"}]'::jsonb),
    ('vip', '[
      {"pl":"2 Decision Laby rocznie w roli obserwatora","en":"2 Decision Labs a year as an observer",
       "group_pl":"Wszystko z progu Członek Pro, oraz:","group_en":"All of Member Pro, plus:"},
      {"pl":"Zjazd Rady raz w roku oraz 2 kolacje eksperckie","en":"The Council Assembly once a year and 2 expert dinners"},
      {"pl":"Sounding board: rekomendacje udostępniane 10 dni roboczych przed publikacją, z prawem komentarza","en":"Sounding board: recommendations shared 10 working days before publication, with the right to comment",
       "detail_pl":"Komentarz jest rejestrowany i rozpatrywany przez zespół badawczy. Nie daje prawa do zmiany treści, usunięcia wniosku ani wstrzymania publikacji.","detail_en":"Comments are logged and considered by the research team. They give no right to change the text, remove a finding or stop publication."},
      {"pl":"Zgłoszenie tematu badawczego: nabór do 30 września, rozstrzygnięcie do 31 października, jeden temat rocznie wchodzi do agendy","en":"Research topic proposals: submissions by 30 September, decision by 31 October, one topic a year enters the agenda",
       "detail_pl":"Zgłoszenie jest wnioskiem, nie zleceniem - rada programowa może odmówić bez uzasadnienia.","detail_en":"A proposal is a request, not a commission - the programme board may decline without giving reasons."},
      {"pl":"Korespondencja z ekspertami bez limitu, kanałem bezpośrednim","en":"Unlimited correspondence with experts through a direct channel"},
      {"pl":"Kluby: członkostwo we wszystkich klubach otwartych dla Rady","en":"Clubs: membership of every club open to the Council"},
      {"pl":"4 godziny konsultacji analitycznych rocznie, jednostka 30 minut, reakcja 5 dni roboczych","en":"4 hours of analytical consultation a year, in 30-minute units, with a 5-working-day response"},
      {"pl":"Osobisty opiekun i onboarding w 7 dni od przystąpienia","en":"A personal account manager and onboarding within 7 days of joining"}]'::jsonb),
    ('team', '[
      {"pl":"Zakres progu Członek Pro dla każdego miejsca, bez monitoringu regulacyjnego","en":"The Member Pro scope for every seat, without regulatory monitoring"},
      {"pl":"Onboarding zespołowy: przypisanie wszystkich miejsc do klubów w 7 dni od zakupu","en":"Team onboarding: every seat assigned to a club within 7 days of purchase"},
      {"pl":"3 wliczone bilety rocznie na organizację, niezależnie od liczby miejsc","en":"3 included tickets a year per organisation, regardless of seat count"},
      {"pl":"Wejścia rangi 25: kluby i treści otwarte dla Rady Instytutu","en":"Rank 25 entries: clubs and content open to the Institute Council"},
      {"pl":"Korespondencja z ekspertami: 3 zapytania miesięcznie na miejsce","en":"Expert correspondence: 3 requests a month per seat"},
      {"pl":"Kluby: jedno członkostwo klubowe na miejsce","en":"Clubs: one club membership per seat"},
      {"pl":"Panel miejsc: zapraszanie, odbieranie i przenoszenie między osobami","en":"A seat panel: invite, revoke and reassign between people"},
      {"pl":"Wspólna biblioteka i archiwum organizacji","en":"A shared library and organisation archive"},
      {"pl":"Jedna zbiorcza faktura dla całego zespołu","en":"One consolidated invoice for the whole team"},
      {"pl":"Rabat wolumenowy od 11 miejsc: 79 zł za miejsce","en":"Volume discount from 11 seats: a lower rate for every seat"}]'::jsonb),
    ('ngo', '[
      {"pl":"Stawka preferencyjna: -50% ceny Partnera Instytucjonalnego (cena i zakres - na karcie Partnera)","en":"Preferential rate: 50% off the Institutional Partner price (price and scope on the Partner card)"},
      {"pl":"Dla organizacji pozarządowych i think-tanków non-profit, po weryfikacji KRS lub statutu","en":"For NGOs and non-profit think-tanks, after registry (KRS) or statute verification"},
      {"pl":"Faktura wystawiana na organizację, umowa roczna","en":"Invoice issued to the organisation, annual agreement"}]'::jsonb),
    ('business', '[
      {"pl":"Pełny zakres planu Pro dla konta firmowego - analizy, monitoring regulacyjny, briefingi","en":"The full Pro scope for the company account - analyses, regulatory monitoring, briefings"},
      {"pl":"Cykliczny briefing sektorowy dla firm","en":"A recurring sector briefing for business"},
      {"pl":"Status partnera biznesowego z wyróżnieniem w sekcji partnerów serwisu","en":"Business partner status with recognition in the site''s partners section"},
      {"pl":"Zaproszenia na wydarzenia i wybrane Decision Labs","en":"Invitations to events and selected Decision Labs"},
      {"pl":"Cykl rozliczeń do wyboru: 2 tygodnie, miesiąc lub kwartał - anulowanie w każdej chwili","en":"Choose your billing cycle: 2 weeks, monthly or quarterly - cancel anytime"}]'::jsonb),
    ('corporate', '[
      {"pl":"Pula miejsc z pełnym zakresem Pro dla każdego użytkownika","en":"A seat pool with the full Pro scope for every user"},
      {"pl":"Wspólna biblioteka materiałów i archiwum dla organizacji","en":"A shared library of materials and an organisation archive"},
      {"pl":"Kwartalny briefing dla organizacji","en":"A quarterly briefing for your organisation"},
      {"pl":"Panel administracyjny do zarządzania miejscami i uprawnieniami","en":"An admin panel for managing seats and permissions"},
      {"pl":"Faktura i umowa roczna z opiekunem wdrożenia","en":"Invoicing and an annual agreement with an onboarding manager"}]'::jsonb),
    ('partner', '[
      {"pl":"Do 10 osób nominowanych z pełnym zakresem Pro","en":"Up to 10 nominated people with the full Pro scope",
       "group_pl":"Wszystko z progu Członek Pro dla osób nominowanych, oraz:","group_en":"All of Member Pro for nominated people, plus:"},
      {"pl":"1 Decision Lab rocznie z dwoma miejscami dla osób nominowanych","en":"1 Decision Lab a year with two seats for nominated people"},
      {"pl":"Sounding board dla osób nominowanych, na zasadach i z granicą wpływu jak dla Rady Instytutu","en":"A sounding board for nominated people, on the same terms and with the same boundary of influence as the Institute Council"},
      {"pl":"4 briefingi zamknięte dla organizacji w roku","en":"4 closed-door briefings for the organisation a year"},
      {"pl":"Wszystkie kluby dyskusyjne dla osób nominowanych","en":"All discussion clubs for nominated people"},
      {"pl":"Korespondencja z ekspertami bez limitu dla osób nominowanych","en":"Unlimited expert correspondence for nominated people"},
      {"pl":"8 godzin konsultacji analitycznych rocznie, jednostka 30 minut, reakcja 5 dni roboczych","en":"8 hours of analytical consultation a year, in 30-minute units, with a 5-working-day response"},
      {"pl":"Faktura, umowa roczna, opiekun wdrożenia","en":"Invoice, annual agreement and an onboarding manager"},
      {"pl":"Organizacje pozarządowe i think-tanki non-profit: stawka preferencyjna -50%, po weryfikacji KRS lub statutu","en":"NGOs and non-profit think-tanks: a preferential rate of 50% off, after registry (KRS) or statute verification"}]'::jsonb),
    ('partner_general', '[
      {"pl":"Do 25 osób nominowanych","en":"Up to 25 nominated people",
       "group_pl":"Wszystko z progu Partner Instytucjonalny, oraz:","group_en":"All of Institutional Partner, plus:"},
      {"pl":"1 własna grupa zadaniowa rocznie: cykl 4 spotkań zakończony raportem sygnowanym wspólnie przez NES i partnera","en":"1 own task force a year: a cycle of 4 meetings closing with a report co-signed by NES and the partner"},
      {"pl":"2 dedykowane briefingi szyte na miarę w roku","en":"2 dedicated, tailor-made briefings a year"},
      {"pl":"20 godzin dostępu do analityka rocznie","en":"20 hours of analyst access a year"},
      {"pl":"Prywatny mikroserwis klubowy dla organizacji","en":"A private club micro-site for the organisation"},
      {"pl":"1 slot prelegencki na konferencji New European Strategies w roku","en":"1 speaking slot at the New European Strategies conference each year"},
      {"pl":"2 kolacje eksperckie na poziomie zarządu w roku","en":"2 board-level expert dinners a year"}]'::jsonb),
    ('presidents_circle', '[
      {"pl":"Bez limitu osób nominowanych","en":"No limit on nominated people"},
      {"pl":"Dedykowany analityk prowadzący","en":"A dedicated lead analyst"},
      {"pl":"Współsygnowane badania i publikacje","en":"Co-signed research and publications"},
      {"pl":"Miejsce w panelu recenzenckim publikacji","en":"A seat on the publications review panel"},
      {"pl":"Udział w dorocznym posiedzeniu agendy strategicznej instytutu","en":"Participation in the institute''s annual strategic agenda session",
       "detail_pl":"Fundatorzy zgłaszają obszary i priorytety badawcze. Wybór tematów, metodyka i wnioski pozostają wyłączną kompetencją zespołu badawczego i rady programowej; zapis nie podlega negocjacji w umowie indywidualnej.","detail_en":"Founders propose research areas and priorities. The choice of topics, methodology and findings remain solely with the research team and the programme board; this is not negotiable in individual agreements."}]'::jsonb)
  ) AS v(key, benefits);
$$;

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_v62_benefits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v62_benefits() TO service_role;

COMMENT ON FUNCTION public.pricing_catalog_v62_benefits() IS
  'Benefity kart progów wg katalogu v6.2 (PL/EN, format [{pl,en,group_*,detail_*}]). Łączona po kluczu z pricing_catalog_v62_rows() w seedzie i apply.';
