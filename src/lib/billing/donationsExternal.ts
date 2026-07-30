// Darowizny są zbierane w zewnętrznym serwisie zbiórkowym (zrzutka.pl),
// NIE przez wbudowanego operatora płatności. Wymóg zgodności z Acceptable
// Use Policy Paddle (Merchant of Record): darowizny/crowdfunding są poza
// katalogiem wspieranych kategorii, więc żaden przycisk darowizny w serwisie
// nie może otwierać checkoutu operatora. Moduł jest czysty (client-safe).
export const EXTERNAL_DONATIONS_URL = "https://zrzutka.pl/sfrxme";
