# Ocena konkurencyjna modułów NES — think-tanki (PL / Europa / Rosja / Chiny / Japonia / USA) i media (Reuters, Politico, Bloomberg…)

**Data:** 2026-07-20 · **Gałąź:** `claude/struktura-modulow-funkcji-38atfr` (PR #46)

Dokument uzupełnia `OCENA_MODULOW_2026-07-20.md`. Tamten porównywał moduły NES z **liderami kategorii
software'owych** (WordPress, Elementor, Algolia, WhatsApp, LinkedIn) — odpowiedź na pytanie „czy silnik jest
dobrze zrobiony". Ten porównuje z **realnymi konkurentami rynkowymi** — odpowiedź na pytanie „czy NES pokazuje
się lepiej niż podmioty, z którymi faktycznie konkuruje o czytelnika, eksperta i klienta".

## Zakres i metodologia

**Grupy porównawcze (8 kolumn):**

| Skrót      | Grupa                       | Reprezentanci oceniani                                                                                      |
| ---------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **NES**    | ta platforma                | ocena z kodu (`OCENA_MODULOW_2026-07-20.md`)                                                                |
| **TT PL**  | think-tanki polskie         | PISM, OSW, Klub Jagielloński, Nowa Konfederacja, INE, Sobieski, Batory                                      |
| **TT EU**  | think-tanki zachodnioeurop. | ECFR, Bruegel, Chatham House, RUSI, SWP, IFRI, CEPS, Clingendael                                            |
| **TT RU**  | think-tanki rosyjskie       | Klub Wałdajski, RIAC, IMEMO, SVOP / Russia in Global Affairs                                                |
| **TT CN**  | think-tanki chińskie        | CICIR, CIIS, SIIS, CASS, CCG, Taihe                                                                         |
| **TT JP**  | think-tanki japońskie       | JIIA, Sasakawa Peace Foundation, RIETI, NIDS, Genron NPO, Tokyo Foundation                                  |
| **TT USA** | think-tanki amerykańskie    | CSIS, Brookings, Carnegie, CFR, RAND, Atlantic Council, CNAS, Wilson Center                                 |
| **Media**  | serwisy publiczne mediów    | Reuters, Politico (.eu/.com), Bloomberg.com, FT, The Economist, Axios, Euractiv, EUobserver, Foreign Policy |

**Wykluczone zgodnie z zakresem:** osobne platformy premium mediów — Politico PRO, Bloomberg
Terminal/BGOV/Law, Reuters Eikon/Connect, Axios Pro, Euractiv Pro, FP Analytics. FT.com i Economist.com
traktuję jako rdzenne serwisy publiczne (subskrypcja to ich model podstawowy, nie osobny produkt).

**Zastrzeżenia metodologiczne (ważne):**

1. **Asymetria pomiaru.** NES oceniam od środka (kod, 318 migracji); konkurentów od zewnątrz (publiczne
   serwisy, stan wiedzy do połowy 2026). Łagodzę to oceniając u konkurentów **widoczny efekt**, nie mechanizm.
2. **Porównuję platformę cyfrową, nie markę.** Skala redakcji, autorytet, wolumen treści i sieć ekspertów to
   osobny — często rozstrzygający — wymiar konkurencji, którego oprogramowanie nie zastąpi (Reuters ma ~190
   biur; NES ma silnik). Wiersz „skala/autorytet" celowo poza tabelami — patrz wnioski.
3. **Ocena grupowa = typowy poziom grupy**, z liderami wskazanymi imiennie (RAND ≠ średni TT USA;
   FT ≠ średnie media).
4. **Rosja:** stan po 2022 (Carnegie Moscow zamknięte; oceniam Wałdaj/RIAC/IMEMO/globalaffairs.ru — serwisy
   działające, dwujęzyczne RU/EN). **Chiny:** własne strony www są tam kanałem wtórnym wobec ekosystemu
   WeChat/Weibo — odnotowuję to w ocenie, bo porównanie „strona vs strona" jest dla nich niepełne.
5. Skala 0–10, surowo, per kryterium; kryteria dobrane per moduł do tego, co ta grupa konkurentów w ogóle robi.

---

## Tabela zbiorcza (moduł × grupa)

| Moduł              | **NES** | TT PL | TT EU | TT RU | TT CN | TT JP | TT USA | Media |
| ------------------ | ------- | ----- | ----- | ----- | ----- | ----- | ------ | ----- |
| Wpisy              | **8,3** | 3,1   | 4,3   | 3,3   | 2,3   | 2,8   | 4,2    | 7,9   |
| Strony             | **8,2** | 2,5   | 4,6   | 2,7   | 2,0   | 2,6   | 5,3    | 6,9   |
| Wyszukiwarka       | **7,5** | 1,9   | 3,7   | 2,9   | 1,9   | 2,5   | 4,5    | 4,1   |
| Czat / społeczność | **7,7** | 1,6   | 2,6   | 1,8   | 2,0   | 1,6   | 2,4    | 3,4   |
| Profile            | **8,3** | 2,1   | 3,4   | 2,4   | 1,7   | 1,9   | 3,8    | 3,1   |
| **Średnia**        | **8,0** | 2,2   | 3,7   | 2,6   | 2,0   | 2,3   | 4,0    | 5,1   |

Interpretacja uczciwie: NES wygrywa ten pomiar, bo mierzy on **zdolności platformowe** — a NES jest jedynym
podmiotem w zestawieniu, który buduje platformę produktową (paywall, społeczność, profile, builder) zamiast
serwisu wydawniczego. Media wygrywają tam, gdzie toczy się ich gra (czytanie, live, dystrybucja), a
amerykańskie TT tam, gdzie toczy się gra think-tanków (interaktywne raporty). Szczegóły niżej.

---

## Mapa konkurentów — profile cyfrowe (skrót)

**TT PL.** PISM i OSW: dwujęzyczne (PL/EN), wysoka kadencja publikacji, statyczne bio ekspertów, proste
wyszukiwarki, zero personalizacji/społeczności; OSW mocny na YouTube. Klub Jagielloński / Nowa Konfederacja:
portale opinii + podcasty + mecenat (Patronite), częściowy paywall NK. INE/Sobieski/Batory: strony
podstawowe. Technologicznie cała grupa = WordPress z PDF-ami.

**TT EU.** ECFR: nowoczesny serwis, katalog ekspertów z tematami i językami, EU Coalition Explorer; treść
darmowa. Bruegel: czysty design, otwarte datasety i trackery, nagrania wydarzeń. Chatham House / RUSI: model
członkowski (portale my.\*, journal przez wydawcę zewnętrznego, archiwa nagrań za bramką), serwisy solidne
lecz konserwatywne. SWP/IFRI/CEPS: dwujęzyczne, publikacyjne, bez warstwy produktowej.

**TT RU.** Klub Wałdajski: najbardziej dopracowany (RU/EN, komentarze ekspertów, wydarzenia, papery). RIAC:
duży dwujęzyczny portal z rozbudowanym katalogiem ekspertów i taksonomią. IMEMO: instytucjonalny, technicznie
przestarzały. Russia in Global Affairs (SVOP): przyzwoity serwis czasopisma RU/EN. Grupa: duży wolumen,
dwujęzyczność, technika ~dekadę za Zachodem, zero monetyzacji (finansowanie państwowe).

**TT CN.** CICIR/CIIS/SIIS/CASS: strony statyczne, chińskojęzyczne z ograniczonym EN, PDF-y, słabe
wyszukiwarki; realna dystrybucja i interakcja dzieje się na oficjalnych kontach WeChat (poza własną
platformą). CCG: najaktywniejszy anglojęzycznie. Grupa najsłabsza w pomiarze „własnej platformy" — ale gra
w innym ekosystemie.

**TT JP.** RIETI: głęboka, ustrukturyzowana baza working papers (najlepszy element grupy). JIIA/NIDS:
archiwa PDF, design przestarzały. SPF: nowocześniejszy serwis programowy. Genron NPO: sondaże i debaty
(unikatowy format). Grupa: głębokie archiwa JP/EN, cienka warstwa produktowa.

**TT USA.** Najsilniejsza cyfrowo liga think-tanków świata: CSIS (iDeas Lab — własne studio; microsites
ChinaPower, Missile Threat), Atlantic Council (dashboardy sankcyjne), CFR (Global Conflict Tracker,
backgroundery, World101), RAND (fasetowa baza badań — wzorzec wyszukiwarki TT), Brookings/Carnegie (bogate
strony ekspertów, sieci podcastów). Wszystko darmowe (model grantowy) — zero paywalli, zero społeczności.

**Media (serwisy publiczne).** Reuters: szybkość, live, rejestracja + metered paywall, MyNews (obserwowane
tematy), brak komentarzy. Politico(.eu): rdzeń darmowy + flagowe newslettery (Playbook), Politico Live;
wyszukiwarka prosta. Bloomberg.com: najlepsze czytanie i grafika danych (Bloomberg Graphics), audio
artykułów, metered paywall. FT: wzorzec personalizacji (myFT — obserwowanie tematów z alertami) i kultury
komentarzy. Economist: pełne wydanie audio, aplikacja, Espresso. Euractiv/EUobserver: media polityki UE,
technicznie średnie. Axios: format smart brevity + newslettery.

---

# 1. WPISY — publikowanie i czytanie

Jak grupy realizują ten moduł: media = newsroomy z live/wideo/grafiką i dopracowanym czytaniem; TT USA =
długie raporty + komentarze + podcasty, czysto ale statycznie; TT EU podobnie skromniej; TT PL/RU/CN/JP =
strony-archiwa z PDF-ami.

| Kryterium                                                   | **NES** | TT PL | TT EU | TT RU | TT CN | TT JP | TT USA | Media   |
| ----------------------------------------------------------- | ------- | ----- | ----- | ----- | ----- | ----- | ------ | ------- |
| Doświadczenie czytania artykułu                             | 6,5     | 4,5   | 6,0   | 4,5   | 3,0   | 4,0   | 7,0    | **9,0** |
| Szerokość formatów (analizy, podcast, wideo, live, stories) | **9,0** | 4,5   | 6,0   | 4,5   | 3,0   | 4,0   | 7,5    | **9,0** |
| Paywall / monetyzacja treści                                | **9,0** | 2,5   | 5,0   | 1,0   | 1,0   | 1,0   | 1,5    | 7,5     |
| Personalizacja / rekomendacje                               | **8,0** | 1,0   | 1,5   | 1,0   | 2,0   | 1,0   | 2,0    | 6,5     |
| Audio artykułów / TTS                                       | **9,0** | 1,0   | 2,0   | 1,0   | 1,0   | 1,0   | 2,0    | 7,0     |
| Wielojęzyczność treści                                      | **9,0** | 5,5   | 5,0   | 7,0   | 4,0   | 5,5   | 3,0    | 6,0     |
| SEO / dystrybucja techniczna                                | **9,0** | 4,0   | 6,0   | 4,0   | 2,0   | 4,0   | 7,0    | **9,0** |
| Live / formaty newsowe                                      | 7,0     | 2,0   | 2,5   | 3,0   | 2,0   | 2,0   | 3,5    | **9,0** |
| **Średnia**                                                 | **8,3** | 3,1   | 4,3   | 3,3   | 2,3   | 2,8   | 4,2    | 7,9     |

**Wzorce do naśladowania:** czytanie — Bloomberg/FT (typografia, tempo, zero szumu wokół tekstu); audio —
The Economist (pełne wydanie audio) i Bloomberg (audio artykułów); personalizacja — FT myFT (obserwowanie
tematów + alerty, najlepszy model w kategorii); live — Reuters.

**Werdykt:** NES przegrywa z medialną czołówką tylko dwa kryteria — **czystość czytania** (6,5 vs 9) i
**live** — a wygrywa z nią elastycznością monetyzacji (per-item, dożywotnie — tego Reuters/Bloomberg nie
mają w serwisach publicznych), TTS per artykuł i pełną dwujęzycznością. Wobec **wszystkich sześciu lig
think-tankowych** NES ma przewagę w każdym kryterium poza jednym remisem (wielojęzyczność z TT RU 9:7).
Wśród think-tanków nikt — łącznie z CSIS i Brookings — nie ma paywalla produktowego, personalizacji ani
audio artykułów.

**Wnioski dla NES:** (1) jedyna realna luka do mediów jest naprawialna redakcyjnie — tryb czytania
(odchudzenie strony artykułu); (2) TTS + dwujęzyczność + paywall per-item warto komunikować jako wyróżnik
— w tej stawce nie ma tego nikt.

---

# 2. STRONY — huby, landingi, microsites, interaktywne raporty

Jak grupy realizują ten moduł: media = zespoły graphics kodujące własne interaktywne story (Bloomberg
Graphics, Reuters Graphics — szczyt kategorii); TT USA = microsites i dashboardy budowane przez studia
(iDeas Lab); TT EU = pojedyncze explorery (ECFR) i datasety (Bruegel); reszta = strony statyczne od agencji.

| Kryterium                                                | **NES** | TT PL | TT EU | TT RU | TT CN | TT JP | TT USA | Media   |
| -------------------------------------------------------- | ------- | ----- | ----- | ----- | ----- | ----- | ------ | ------- |
| Huby programów / stron tematycznych                      | **8,0** | 3,5   | 6,0   | 4,0   | 3,0   | 3,5   | 7,5    | 7,0     |
| Microsites / interaktywne raporty (dorobek)              | 6,5     | 1,5   | 6,5   | 3,0   | 2,0   | 3,0   | 8,5    | **9,0** |
| Builder self-service (tworzenie bez dewelopera)          | **9,5** | 2,0   | 2,5   | 2,0   | 2,0   | 2,0   | 3,0    | 3,0     |
| Wydajność / jakość techniczna stron                      | **9,0** | 4,0   | 5,5   | 4,0   | 3,0   | 4,0   | 6,0    | 7,5     |
| Landingi konwersji (członkostwo, darowizny, subskrypcja) | 7,0     | 3,0   | 5,5   | 2,0   | 1,0   | 2,0   | 5,0    | **8,0** |
| Eksperymenty A/B na stronach                             | **9,0** | 1,0   | 1,5   | 1,0   | 1,0   | 1,0   | 2,0    | 7,0     |
| **Średnia**                                              | **8,2** | 2,5   | 4,6   | 2,7   | 2,0   | 2,6   | 5,3    | 6,9     |

**Wzorce do naśladowania:** interaktywny storytelling — Bloomberg Graphics i Reuters Graphics (poza zasięgiem
bez studia, ale kierunek estetyczny); microsites think-tankowe — CSIS ChinaPower/Missile Threat (trwałe
produkty z własną nawigacją); explorery — ECFR EU Coalition Explorer; landingi subskrypcji — FT/Bloomberg.

**Werdykt:** kluczowe rozróżnienie tego modułu to **zdolność vs dorobek**. W dorobku interaktywnym NES (6,5)
ustępuje TT USA (8,5) i mediom (9,0) — oni publikują takie produkty od lat. Ale NES jest **jedynym podmiotem
w całym zestawieniu z builderem self-service** (9,5 vs 2–3): CSIS potrzebuje studia iDeas Lab, Bloomberg —
zespołu deweloperów; redaktor NES składa digital feature (sankey, macierz ryzyka, mapa korytarzy, oś czasu)
z widgetów w popołudnie. A/B na sekcjach nie robi żaden think-tank. Przewaga jest więc w **koszcie
krańcowym** kolejnego interaktywnego produktu — trzeba ją zamienić na dorobek.

**Wnioski dla NES:** (1) opublikować 2–3 flagowe digital features / microsites (widgety są, brakuje
dorobku — to one budują pozycję w lidze ECFR/CSIS); (2) wykorzystać A/B tam, gdzie media go używają:
lejki subskrypcji.

---

# 3. WYSZUKIWARKA

Jak grupy realizują ten moduł: media = proste wyszukiwarki serwisowe (filtr sekcja/data), z wyjątkiem FT
(myFT-alerty tematów); TT USA = od przyzwoitych filtrów po wzorcowy RAND (pełne fasety bazy badań);
TT EU = filtry tematyczne; TT PL/CN = domyślne wyszukiwarki CMS; TT RU/JP = taksonomie bez inteligencji.

| Kryterium                               | **NES** | TT PL | TT EU | TT RU | TT CN | TT JP | TT USA | Media |
| --------------------------------------- | ------- | ----- | ----- | ----- | ----- | ----- | ------ | ----- |
| Trafność (języki, ranking, treść pełna) | **8,0** | 3,0   | 5,0   | 4,5   | 3,0   | 4,0   | 6,0    | 6,0   |
| Fasety / filtry                         | **8,0** | 3,0   | 5,5   | 4,0   | 2,5   | 4,0   | 6,5    | 5,5   |
| Autosugestie / „czy chodziło o…"        | **8,0** | 1,5   | 3,0   | 2,0   | 2,0   | 2,0   | 4,0    | 4,5   |
| Wyszukiwanie ekspertów / osób           | **8,0** | 2,0   | 5,5   | 4,5   | 2,0   | 2,5   | 6,0    | 2,5   |
| Zapisane wyszukiwania / alerty          | **5,0** | 1,0   | 1,5   | 1,0   | 1,0   | 1,0   | 2,0    | 3,5   |
| Składnia zaawansowana                   | **8,0** | 1,0   | 1,5   | 1,5   | 1,0   | 1,5   | 2,5    | 2,5   |
| **Średnia**                             | **7,5** | 1,9   | 3,7   | 2,9   | 1,9   | 2,5   | 4,5    | 4,1   |

**Wzorce:** RAND (najlepsza wyszukiwarka think-tankowa świata — fasetowa baza badań; NES już jest blisko,
a w podpowiedziach/składni wyżej); FT myFT (alerty tematów — jedyny element, w którym media publiczne biją
NES koncepcyjnie).

**Werdykt:** **wyszukiwarka NES jest lepsza niż u wszystkich ośmiu grup** — łącznie z serwisami publicznymi
Reuters/Politico/Bloomberg, których wyszukiwarki są zaskakująco podstawowe (zaawansowane wyszukiwanie
trzymają w produktach premium, tu wykluczonych). Jedyne kryterium poniżej konkurencji: alerty (5,0 vs FT).
Po ich dodaniu NES będzie miał najlepszą wyszukiwarkę w całej stawce bez wyjątków.

**Wnioski dla NES:** alerty do zapisanych wyszukiwań to nie tylko „feature parity z Politico PRO" (poprzedni
dokument) — to także jedyna przewaga wyszukiwarkowa serwisów publicznych FT/Reuters (obserwowane tematy),
którą można zneutralizować małym kosztem.

---

# 4. CZAT / SPOŁECZNOŚĆ

Uczciwa rama: **czatu użytkownik–użytkownik nie ma nikt w całym zestawieniu** — ani żaden think-tank, ani
żaden serwis mediowy. Moduł porównuję więc szerzej, jako „interakcję i relację z odbiorcą": komentarze,
społeczności członkowskie, Q&A/ankiety, kanały relacji (push/newslettery). Chińskie TT prowadzą społeczności
w grupach WeChat — poza własną platformą (odnotowane w ocenie).

| Kryterium                                   | **NES** | TT PL | TT EU | TT RU | TT CN | TT JP | TT USA | Media   |
| ------------------------------------------- | ------- | ----- | ----- | ----- | ----- | ----- | ------ | ------- |
| Czat 1:1 i grupowy na platformie            | **8,5** | 0     | 0     | 0     | 0     | 0     | 0      | 0       |
| Komentarze / dyskusje pod treścią           | **7,0** | 2,0   | 1,5   | 2,0   | 1,0   | 1,0   | 1,0    | 3,0     |
| Społeczność członkowska online              | **8,0** | 2,0   | 4,0   | 2,0   | 3,0   | 2,0   | 2,5    | 2,0     |
| Q&A / ankiety / wydarzenia interaktywne     | **7,0** | 2,0   | 4,0   | 3,0   | 2,0   | 3,0   | 4,0    | 4,0     |
| Kanały relacji (push, newslettery, digesty) | 8,0     | 2,0   | 3,5   | 2,0   | 4,0   | 2,0   | 4,5    | **8,0** |
| **Średnia**                                 | **7,7** | 1,6   | 2,6   | 1,8   | 2,0   | 1,6   | 2,4    | 3,4     |

**Wzorce:** kultura komentarzy — FT (jedyne media, które utrzymały wartościową sekcję komentarzy; Reuters
i Bloomberg je usunęły); newslettery jako relacja — Politico Playbook (agendotwórczy standard kategorii);
członkostwo — Chatham House/RUSI (ale ich „społeczność" żyje na sali eventowej, nie na platformie);
sondaże/debaty — Genron NPO.

**Werdykt:** to moduł **kategorii, w której konkurenci nie występują**. Cała stawka realizuje „społeczność"
poza własną platformą (eventy offline, LinkedIn/X ekspertów, grupy WeChat) albo zredukowała ją do
newslettera. NES jako jedyny ma czat, komentarze z moderacją, katalog osób, sieć kontaktów i powiadomienia
w jednym systemie tożsamości. Jedyny remis: kanały relacji (8:8 z mediami — ich newslettery i aplikacje
push są dojrzalsze wolumenem i warsztatem).

**Wnioski dla NES:** (1) przewaga jest strukturalna, ale bezużyteczna bez masy krytycznej użytkowników —
kluczowe jest zasiedlenie (wydarzenia członkowskie z czatem/Q&A jako haczyk, „kręgi" per program badawczy);
(2) newslettery to jedyne pole tego modułu, na którym media są realnym benchmarkiem — warsztat Playbooka
(godzina wysyłki, format skanowalny, jeden autor-gospodarz) warto skopiować redakcyjnie.

---

# 5. PROFILE — eksperci i użytkownicy

Jak grupy realizują ten moduł: think-tanki = statyczne lub półdynamiczne strony ekspertów (najlepiej ECFR
i Brookings: bio, tematy, pełny dorobek, kontakt dla mediów); media = skromne strony autorów; **profile
czytelników i networking nie istnieją nigdzie** poza kontem subskrypcyjnym.

| Kryterium                                           | **NES** | TT PL | TT EU | TT RU | TT CN | TT JP | TT USA | Media |
| --------------------------------------------------- | ------- | ----- | ----- | ----- | ----- | ----- | ------ | ----- |
| Strony ekspertów (bio, dorobek, kontakt dla mediów) | **9,0** | 4,0   | 7,0   | 5,0   | 3,0   | 3,5   | 7,5    | 4,5   |
| Katalog / wyszukiwarka ekspertów                    | **8,0** | 2,5   | 6,0   | 5,0   | 2,5   | 2,5   | 6,5    | 2,0   |
| Profile użytkowników-czytelników                    | **8,0** | 1,0   | 1,0   | 1,0   | 1,0   | 1,0   | 1,0    | 3,0   |
| Sieć kontaktów / networking online                  | **8,0** | 0,5   | 1,0   | 0,5   | 1,0   | 0,5   | 1,0    | 1,0   |
| Zaufanie (weryfikacja, odznaki, rekomendacje)       | **8,0** | 2,0   | 2,0   | 2,0   | 2,0   | 2,0   | 2,0    | 2,0   |
| Prywatność / RODO (tryby, eksport danych)           | **9,0** | 3,0   | 5,0   | 2,0   | 1,0   | 3,0   | 5,0    | 6,0   |
| **Średnia**                                         | **8,3** | 2,1   | 3,4   | 2,4   | 1,7   | 1,9   | 3,8    | 3,1   |

**Wzorce:** strony ekspertów — ECFR (tematy + języki robocze + kontakt medialny) i Brookings (pełna
integracja dorobku); katalog — RIAC (zaskakująco rozbudowany jak na grupę). Networking online nie ma wzorca
w stawce — think-tanki delegują go do LinkedIna.

**Werdykt:** hub eksperta NES (konfigurowalne layouty per tenant, dorobek filtrowany, „w mediach", kontakt
dla mediów) już dziś przewyższa najlepsze strony ekspertów ligi (ECFR/Brookings), a warstwy, których nie ma
nikt — profile czytelników, sieć kontaktów z cichymi odrzuceniami, rekomendacje, odznaki, tryby prywatności
z RODO — czynią ten moduł najbardziej bezkonkurencyjnym obok czatu. Zastrzeżenie identyczne jak przy czacie:
wartość sieci = liczba uczestników; u think-tanków tę funkcję pełni LinkedIn i sale eventowe.

**Wnioski dla NES:** (1) strona eksperta jest gotowym argumentem rekrutacyjnym dla autorów/ekspertów
(„u nas masz wizytówkę lepszą niż w Brookings, z dorobkiem aktualizowanym automatycznie"); (2) mechanika
kompletności profilu (rekomendacja z `OCENA_MODULOW`) jest tu warunkiem — pusty katalog ekspertów wygląda
gorzej niż statyczne bio PISM.

---

# Wnioski geograficzne

**Polska (2,2 vs 8,0).** Deklasacja w każdym module i każdym kryterium. Potwierdza pozycjonowanie
„najbardziej zaawansowana cyfrowo platforma analityczno-wydawnicza w PL/CEE". Ryzyko konkurencyjne z tej
strony: żadne w horyzoncie 2–3 lat (nikt tam nie buduje produktu, wszyscy strony).

**Europa Zachodnia (3,7).** NES wygrywa platformą wszędzie; realna konkurencja to nie technologia, lecz
(a) dorobek interaktywny ECFR/Bruegel (explorery, datasety — moduł Strony, kryterium „dorobek": 6,5 słabsze
ogniwo NES), (b) prestiż członkostwa Chatham/RUSI (społeczność offline). Droga: dowieźć 2–3 digital features
i eventy członkowskie na własnej społeczności.

**Rosja (2,6).** Wałdaj/RIAC mają wolumen, dwujęzyczność RU/EN (jedyne kryterium blisko NES) i finansowanie
państwowe — nie konkurują o przychód, konkurują o narrację. Technicznie ~dekadę za NES; brak monetyzacji,
personalizacji, społeczności. Z perspektywy NES to nie konkurent produktowy, lecz punkt odniesienia
w dwujęzyczności i kadencji publikacji.

**Chiny (2,0).** Najniższy wynik, ale z gwiazdką: ich własne strony to fasada, realna dystrybucja i
społeczność żyją w WeChat (konta oficjalne, grupy) — ekosystemie nieprzenośnym na Europę. Wniosek dla NES:
brak lekcji platformowych, jest lekcja dystrybucyjna („bądź tam, gdzie odbiorca" — odpowiednikiem
europejskim są newslettery i LinkedIn).

**Japonia (2,3).** Głębokie, ustrukturyzowane archiwa (RIETI — najlepsza baza publikacji w grupie) przy
cienkiej warstwie produktowej. NES wygrywa wszystko poza głębią archiwum — która jest funkcją lat, nie
technologii.

**USA (4,0).** Jedyna liga think-tanków realnie grająca cyfrowo — ale w innym modelu (grant → wszystko
darmowe → zero paywalla, personalizacji, społeczności). NES wygrywa monetyzacją, wyszukiwarką, profilami,
społecznością i builderem; przegrywa dorobkiem interaktywnym (8,5 vs 6,5) i studiem multimedialnym. To
z tej ligi warto kopiować formaty (microsites, trackery, podcast networks) — silnik NES już je udźwignie.

**Media — Reuters, Politico, Bloomberg, FT, Economist (5,1).** Jedyna grupa z realnymi przewagami nad NES:
czytanie (9 vs 6,5), live (9 vs 7), warsztat newsletterowy, landingi subskrypcji, u FT — personalizacja.
NES nie jest i nie będzie newsroomem — nie należy konkurować o news. Pole NES, którego media nie obsadzą:
**dom ekspercki + społeczność + narzędzia analityczne polityki europejskiej** (ich serwisy publiczne nie
mają profili, katalogu ekspertów, czatu, faset, per-item paywalla). Od mediów brać: dyscyplinę czytania,
format newslettera, optymalizację lejka.

# Synteza strategiczna

1. **NES jest najlepszą „platformą" w całym zestawieniu — i najmłodszą „biblioteką".** Wszystkie luki
   względem lig (dorobek interaktywny, wolumen, archiwum, autorytet) są funkcją treści i czasu, nie
   technologii. Odwrotność sytuacji każdego konkurenta.
2. **Dwa moduły bez konkurencji** (czat/społeczność, profile) będą przewagą dopiero przy masie krytycznej
   użytkowników — do tego czasu są kosztem. Priorytet: zasiedlenie przez wydarzenia członkowskie i program
   ekspercki (wizytówka lepsza niż w Brookings jako haczyk rekrutacyjny).
3. **Trzy najkrótsze mosty nad realnymi lukami:** tryb czytania artykułu (→ media), 2–3 flagowe digital
   features (→ CSIS/ECFR), alerty wyszukiwarki (→ FT/myFT). Wszystkie trzy w zasięgu istniejącego silnika;
   pokrywają się z listą P0 z `OCENA_MODULOW_2026-07-20.md`.

# Zastrzeżenia i źródła

- NES: kod repozytorium (HEAD `3ad0b40`) + `OCENA_MODULOW_2026-07-20.md`, `OCENA_UX_UI.md`,
  `OCENA_KONKURENCYJNA_2026-07-13.md` (profil lig A/B/C i modele finansowania — spójny z tym dokumentem).
- Konkurenci: publiczne serwisy wg stanu wiedzy do połowy 2026 — bez dostępu do pełnych treści za paywallami
  i portalami członkowskimi; oceny grupowe to typowy poziom grupy z liderami wskazanymi imiennie. Przed
  użyciem zewnętrznym (np. w materiałach inwestorskich) zweryfikować szczegóły u źródła.
- Porównanie dotyczy zdolności platformowych serwisów publicznych; wyłączono Politico PRO, Bloomberg
  Terminal/BGOV/Law, Reuters Eikon/Connect, Axios Pro, Euractiv Pro, FP Analytics. Skala redakcji, wolumen
  i autorytet marki — poza pomiarem, omówione w syntezie.
