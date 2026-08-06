// Adres zewnętrznej zbiórki - AWARYJNY tryb modułu darowizn.
//
// Historia (istotna, bo tłumaczy dwa tryby w konfiguracji): przy operatorze
// typu Merchant of Record darowizny/crowdfunding były poza katalogiem
// wspieranych kategorii (AUP Paddle), więc serwis nie mógł ich w ogóle
// przyjmować u siebie i cała zbiórka żyła na zrzutka.pl. Po przejściu na
// Stripe (zwykły acquirer, darowizny dozwolone) domyślnym trybem jest własna
// kasa `/donate`; ta stała jest wyłącznie domyślką dla trybu `external`
// i fallbackiem, gdy administrator zostawi puste pole adresu.
//
// Podstawa zmiany modelu: docs/WDROZENIE_DAROWIZNY_WLASNY_CHECKOUT_2026-08-06.md.
// Moduł jest czysty (client-safe).
export const EXTERNAL_DONATIONS_URL = "https://zrzutka.pl/sfrxme";
