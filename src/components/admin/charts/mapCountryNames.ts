// NAZWY KRAJÓW Z ZASOBÓW GEOMETRII, których nie zna nic poza samym zasobem.
//
// Siatka mapy zamienia nazwę wpisaną w komórkę kodu na kod ISO-2. Najpierw
// pyta skorowidz WCZYTANEGO zasobu regionu, potem tabelę aliasów
// (`countryAliases.ts`), na końcu nazwy CLDR z `Intl`. Ta droga miała dziurę:
// nazwy FORMALNE zasobu („Czech Republic", „Russian Federation", „Moldova,
// Republic of") zna wyłącznie zasób - tabela aliasów celowo ich nie
// powtarza, a CLDR mówi „Czechia" i „Russia". Przed wczytaniem zasobu
// (świeżo wstawiony blok) i w regionie, którego zasób danego kraju nie ma
// („Czech Republic" na mapie Azji), wpis zostawał w komórce jako nieznany
// kod, zamiast stać się CZ z uwagą „poza regionem". Rozwiązanie działa raz,
// przy zatwierdzeniu, więc wczytanie zasobu niczego już nie naprawiało.
//
// Tu stoją dokładnie te nazwy zasobów (pl i en), których nie rozpoznaje ani
// tabela aliasów, ani CLDR - lista jest krótka, bo resztę nazw CLDR zna
// sam. Bramka `mapGridStateReview.test.ts` czyta WSZYSTKIE zasoby
// z `public/geo` i sprawdza, że każda ich nazwa daje bez skorowidza swój
// kod; nowy zasób z nazwą spoza CLDR zatrzyma ją, zanim autor trafi na dziurę.
//
// Do tego dwa kody spoza ISO, które zasoby świata, Europy, Azji i Afryki
// rysują: Cypr Północny (XN) i Somaliland (XS). `Intl` ich nie nazwie, więc
// nazwy wyświetlane idą stąd.
//
// Moduł czysty i mały (bez zasobu geometrii w paczce): jedzie z chunkiem
// panelu razem z siatką mapy.

/** Kody użytkownika z zasobów geometrii - kraje, których `Intl` nie zna. */
export const UNOFFICIAL_COUNTRY_NAMES: Readonly<Record<string, { pl: string; en: string }>> = {
  XN: { pl: "Cypr Północny", en: "Northern Cyprus" },
  XS: { pl: "Somaliland", en: "Somaliland" },
};

/** Nazwa kraju spoza `Intl` (XN, XS) w danym języku; pusty napis dla każdego innego kodu. */
export function unofficialCountryName(id: string, lang: "pl" | "en"): string {
  return Object.hasOwn(UNOFFICIAL_COUNTRY_NAMES, id) ? UNOFFICIAL_COUNTRY_NAMES[id][lang] : "";
}

/** Nazwa zasobu -> ISO-2 (nazwy tak, jak stoją w zasobie; normalizuje wołający). */
export const ASSET_ONLY_COUNTRY_NAMES: ReadonlyArray<readonly [string, string]> = [
  // Afryka
  ["Democratic Republic of the Congo", "CD"],
  ["Republic of the Congo", "CG"],
  ["Wybrzeże Kości Słoniowej", "CI"],
  ["Republic of The Gambia", "GM"],
  ["Saint Helena", "SH"],
  ["Wyspa Świętej Heleny, Wyspa Wniebowstąpienia i Tristan da Cunha", "SH"],
  ["United Republic of Tanzania", "TZ"],
  ["Południowa Afryka", "ZA"],
  // Azja
  ["Brunei Darussalam", "BN"],
  ["People's Republic of China", "CN"],
  ["Hong Kong", "HK"],
  ["Hongkong", "HK"],
  ["Islamic Republic of Iran", "IR"],
  ["Lao People's Democratic Republic", "LA"],
  ["Myanmar", "MM"],
  ["Mjanma", "MM"],
  ["Macao", "MO"],
  ["Makau", "MO"],
  ["State of Palestine", "PS"],
  ["Palestyna", "PS"],
  ["Syrian Arab Republic", "SY"],
  ["Taiwan, Province of China", "TW"],
  // Europa
  ["Czech Republic", "CZ"],
  ["Russian Federation", "RU"],
  ["Moldova, Republic of", "MD"],
  ["The Republic of North Macedonia", "MK"],
  ["Holy See (Vatican City State)", "VA"],
  // Ameryki
  ["Saint Kitts and Nevis", "KN"],
  ["Saint Martin (French part)", "MF"],
  ["Saint Pierre and Miquelon", "PM"],
  ["Sint Maarten (Dutch part)", "SX"],
  ["United States of America", "US"],
  ["Saint Vincent and the Grenadines", "VC"],
  ["Virgin Islands, British", "VG"],
  ["Virgin Islands, U.S.", "VI"],
  ["Falkland Islands (Malvinas)", "FK"],
  ["South Georgia and the South Sandwich Islands", "GS"],
  // Oceania
  ["Micronesia, Federated States of", "FM"],
];
