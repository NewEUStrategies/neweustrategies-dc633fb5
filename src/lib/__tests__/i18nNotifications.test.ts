// Parzystosc PL/EN slownika powiadomien + pokrycie kluczy uzywanych w kodzie.
//
// Ta powierzchnia stala kiedys na `t(key, { defaultValue: "<polski tekst>" })`
// bez wpisu w zadnym bundlu, czyli EN dostawal polskie napisy - i ZADNA bramka
// tego nie widziala, bo `check:i18n-parity` porownuje drzewa kluczy, a brak
// wpisu to nie rozjazd. Dlatego mierzymy od strony KODU.
//
// CO SIE ZMIENILO 2026-09-01 I DLACZEGO TO JEST WAZNE.
//
// Poprzednia wersja tego pliku mierzyla WYLACZNIE nakladke
// (`notificationsResources`). To okazalo sie mylace na tyle, ze doprowadzilo do
// realnej pomylki: skan nakladki pokazal brak `settings.kinds.*`
// i `consents.items.*`, wiec wygladalo to na luke w tlumaczeniach - a te klucze
// od dawna sa w RDZENIU (`src/lib/locale/{pl,en}.ts`) i renderuja sie poprawnie
// w obu jezykach. Nakladka jest WARSTWA, nie calym slownikiem; pomiar samej
// warstwy odpowiada na pytanie, ktorego nikt nie zadaje.
//
// Ten plik mierzy wiec SLOWNIK EFEKTYWNY (rdzen + nakladka) przez to samo `t`,
// ktorego uzywa aplikacja - czyli to, co realnie zobaczy uzytkownik.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { notificationsResources } from "@/lib/i18n-notifications";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { realT } from "@/test/i18nReal";
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_GROUPS } from "@/lib/notifications/preferences";
import { CONSENT_CATALOG } from "@/lib/notifications/consentCatalog";
import type { AppLang } from "@/lib/i18n/localePath";

type Tree = { [key: string]: string | Tree };

const LANGS: readonly AppLang[] = ["pl", "en"];

/**
 * Zwezenie zasobu i18next do `Tree` BEZ rzutowania.
 *
 * Rzutowanie przez `unknown` przeszloby kompilacje, ale przepuscilo by tez
 * wartosc, ktora drzewem NIE jest - a wtedy splaszczenie zwrocilby niepelna
 * liste kluczy i test parytetu bylby zielony na niekompletnym drzewie.
 * Ta funkcja SPRAWDZA ksztalt w czasie wykonania i przy okazji jest asercja.
 */
function asTree(value: unknown, path = "resources"): Tree {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`test: ${path} nie jest drzewem zasobow i18next`);
  }
  const out: Tree = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = typeof child === "string" ? child : asTree(child, `${path}.${key}`);
  }
  return out;
}

/**
 * Splaszczenie TOLERANCYJNE - dla RDZENIA, ktory nie jest czystym drzewem
 * napisow: sa w nim takze tablice (np. `admin.themeOptions.locations.mainItems`).
 * Zbieramy wylacznie liscie tekstowe, bo tylko one moga zostac nadpisane
 * napisem z nakladki; wszystko inne pomijamy zamiast wywracac test na ksztalcie,
 * ktory nie ma z ta bramka nic wspolnego.
 */
function flattenLoose(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return prefix === "" ? [] : [[prefix, value]];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenLoose(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/** Splaszczenie do par [sciezka, napis]. */
function flatten(node: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]): Array<[string, string]> => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [[path, value]] : flatten(value, path);
  });
}

// Polszczyzna ma cztery formy liczby mnogiej, angielszczyzna dwie - `_few`
// i `_many` NIE MAJA odpowiednika w EN i ich brak nie jest rozjazdem. Ta sama
// regula co w `src/lib/ci/i18nParity.ts` (PL_ONLY_PLURAL).
const PL_ONLY_PLURAL = /_(few|many)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" ? [] : walk(full);
    }
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

/** Klucze `notifications.*` realnie wolane w kodzie powierzchni powiadomien. */
function usedKeys(): string[] {
  const roots = [
    "src/components/notifications",
    "src/lib/notifications",
    "src/routes/profile.notifications.tsx",
  ];
  const files = roots.flatMap((root) => (statSync(root).isDirectory() ? walk(root) : [root]));
  const keys = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"(notifications\.[A-Za-z0-9_.]+)"/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

/**
 * Czy klucz renderuje sie na PRAWDZIWY napis, a nie na siebie samego?
 *
 * i18next przy braku klucza zwraca sam klucz, wiec `t(k) === k` jest jedynym
 * pewnym sygnalem „tego napisu nie ma w slowniku". Interpolacje podajemy, zeby
 * klucze z `{{count}}` / `{{date}}` nie wygladaly na brakujace.
 */
function renders(lang: AppLang, key: string): boolean {
  const value = realT(lang)(key, { count: 2, date: "2026-01-01", name: "X", version: "1.0" });
  return typeof value === "string" && value.length > 0 && value !== key;
}

describe("i18n powiadomien - SLOWNIK EFEKTYWNY (rdzen + nakladka)", () => {
  it("kazdy klucz notifications.* wolany w kodzie renderuje sie w PL i EN", () => {
    const missing = usedKeys().flatMap((key) =>
      LANGS.filter((lang) => !renders(lang, key)).map((lang) => `${lang}:${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("PL i EN roznia sie trescia - inaczej jeden z jezykow jest kopia drugiego", () => {
    // Regresja na sedno pierwotnej luki: bundle mogly powstac przez skopiowanie
    // polskiego drzewa i podmiane samych kluczy.
    const probes = [
      "notifications.title",
      "notifications.settings.digestOff",
      "notifications.filters.unread",
      "notifications.settings.kinds.crm_task",
      "notifications.consents.items.marketing_email.title",
    ];
    for (const key of probes) {
      expect(realT("pl")(key), key).not.toBe(realT("en")(key));
    }
  });

  describe("klucze DYNAMICZNE, sklejane z katalogow", () => {
    // Skan regexem widzi wylacznie klucze DOSLOWNE. Panel ustawien renderuje
    // etykiety przez t(`notifications.settings.kinds.${kind}`), a panel zgod
    // przez t(`notifications.consents.items.${key}.title`). Gdyby ktos usunal
    // te galezie ze slownika albo dopisal rodzaj do katalogu bez tlumaczenia,
    // zaden inny test tego nie zauwazy - uzytkownik zobaczylby surowy slug
    // z bazy w OBU jezykach naraz.
    const dynamicKeys = [
      ...NOTIFICATION_KINDS.map((kind) => `notifications.settings.kinds.${kind}`),
      ...NOTIFICATION_KIND_GROUPS.flatMap((group) => [
        `notifications.settings.kindGroups.${group.id}`,
        `notifications.settings.kindGroups.${group.id}Hint`,
      ]),
      ...CONSENT_CATALOG.flatMap((definition) => [
        `notifications.consents.items.${definition.key}.title`,
        `notifications.consents.items.${definition.key}.description`,
      ]),
      ...[...new Set(CONSENT_CATALOG.map((definition) => definition.category))].map(
        (category) => `notifications.consents.categories.${category}`,
      ),
    ];

    it("kazdy klucz z katalogu renderuje sie w PL i EN", () => {
      const missing = dynamicKeys.flatMap((key) =>
        LANGS.filter((lang) => !renders(lang, key)).map((lang) => `${lang}:${key}`),
      );
      expect(missing).toEqual([]);
    });

    it("etykieta nie jest surowym slugiem z katalogu", () => {
      // Wpis `crm_task: "crm_task"` przeszedlby test obecnosci wyzej i nadal
      // pokazywalby uzytkownikowi nazwe kolumny z bazy.
      const slugs: string[] = [];
      for (const kind of NOTIFICATION_KINDS) {
        const key = `notifications.settings.kinds.${kind}`;
        for (const lang of LANGS) if (realT(lang)(key) === kind) slugs.push(`${lang}:${kind}`);
      }
      for (const definition of CONSENT_CATALOG) {
        const key = `notifications.consents.items.${definition.key}.title`;
        for (const lang of LANGS) {
          if (realT(lang)(key) === definition.key) slugs.push(`${lang}:${definition.key}`);
        }
      }
      expect(slugs).toEqual([]);
    });
  });
});

describe("nakladka notifications - WARSTWA, nie caly slownik", () => {
  const plOverlay = asTree(notificationsResources.pl, "notificationsPl");
  const enOverlay = asTree(notificationsResources.en, "notificationsEn");
  const comparable = (entries: Array<[string, string]>) =>
    entries
      .map(([key]) => key)
      .filter((key) => !PL_ONLY_PLURAL.test(key))
      .sort();

  it("ma identyczny zestaw kluczy w PL i EN (poza formami mnogimi wylacznie polskimi)", () => {
    expect(comparable(flatten(plOverlay))).toEqual(comparable(flatten(enOverlay)));
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [notificationsResources.pl, notificationsResources.en]
      .map((tree) => JSON.stringify(tree))
      .join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BRAMKA, KTORA POWSTALA Z REALNEJ POMYLKI (2026-09-01, uwaga P1 z przegladu).
  //
  // Nakladka rejestruje sie przez `addResourceBundle(lang, ns, tree, true, true)`
  // - ostatnie `true` znaczy NADPISZ. Wpis o kluczu, ktory rdzen juz definiuje,
  // po cichu PODMIENIA napis widziany przez uzytkownika od chwili wejscia na
  // trase powiadomien. Dla wiekszosci napisow to rozjazd redakcyjny.
  //
  // Dla `notifications.consents.items.*` to zmiana TRESCI OSWIADCZENIA WOLI:
  // `CONSENT_CATALOG` zapisuje decyzje z wersja `1.0`, wiec dwa materialnie
  // rozne brzmienia zgody trafialyby do rejestru RODO pod JEDNA wersja,
  // a wpisy sprzed podmiany przestaja odpowiadac temu, co uzytkownik przeczytal.
  // Dokladnie to sie tu wydarzylo: nakladka skasowala z opisu zgody
  // marketingowej pouczenie „Mozesz wycofac zgode w kazdej chwili".
  //
  // Kontrakt: nakladka moze DOKLADAC klucze, ale nie moze zmieniac tych, ktore
  // rdzen juz ma. Zmiana kanonicznego brzmienia nalezy do rdzenia, a przy
  // zgodach dodatkowo do bumpa wersji w `consentCatalog.ts`.
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * DLUG ZASTANY: 24 klucze, ktore nakladka podmienia wzgledem rdzenia -
   * wszystkie w EN, zaden w `consents.items.*`. Lista moze tylko MALEC.
   * Nie czyszcze jej w tej zmianie, bo redakcja angielskiej wersji tych
   * napisow to decyzja tresciowa, nie zakres kampanii testowej.
   */
  const KNOWN_OVERLAY_OVERRIDES: ReadonlySet<string> = new Set([
    "en:notifications.consents.given",
    "en:notifications.consents.saveError",
    "en:notifications.consents.subtitle",
    "en:notifications.consents.title",
    "en:notifications.consents.versionOutdated",
    "en:notifications.consents.withdrawn",
    "en:notifications.deleteGroup",
    "en:notifications.inboxSubtitle",
    "en:notifications.markAllRead",
    "en:notifications.markGroupRead",
    "en:notifications.markGroupUnread",
    "en:notifications.noMatches",
    "en:notifications.searchPlaceholder",
    "en:notifications.settings.autoMarkOnOpen",
    "en:notifications.settings.autoMarkOnOpenHint",
    "en:notifications.settings.channelsSubtitle",
    "en:notifications.settings.chatBell",
    "en:notifications.settings.chatBellHint",
    "en:notifications.settings.digest",
    "en:notifications.settings.digestHint",
    "en:notifications.settings.groupByConversationHint",
    "en:notifications.settings.pushDenied",
    "en:notifications.settings.pushHint",
    "en:notifications.settings.subtitle",
  ]);

  /** Wszystkie miejsca, w ktorych nakladka podmienia napis z rdzenia. */
  function overlayOverrides(): string[] {
    const cores: Record<AppLang, unknown> = { pl: corePl, en: coreEn };
    const overlays: Record<AppLang, Tree> = { pl: plOverlay, en: enOverlay };
    const found: string[] = [];
    for (const lang of LANGS) {
      const coreByKey = new Map(flattenLoose(cores[lang]));
      for (const [key, overlayValue] of flatten(overlays[lang])) {
        const coreValue = coreByKey.get(key);
        if (coreValue !== undefined && coreValue !== overlayValue) found.push(`${lang}:${key}`);
      }
    }
    return found.sort();
  }

  // ───────────────────────────────────────────────────────────────────────
  // BRAMKA PRAWNA. Powstala z realnej pomylki popelnionej w tej samej
  // kampanii i zlapanej dopiero w przegladzie (uwaga P1).
  //
  // `notifications.consents.items.*` i `.categories.*` to TRESC OSWIADCZENIA
  // WOLI, nie etykieta interfejsu. `CONSENT_CATALOG` zapisuje decyzje z wersja
  // (dzis `1.0`), wiec podmiana napisu bez bumpa wersji sprawia, ze dwa
  // materialnie rozne brzmienia zgody trafiaja do rejestru RODO pod JEDNA
  // wersja, a wpisy sprzed podmiany przestaja odpowiadac temu, co uzytkownik
  // faktycznie przeczytal. Dokladnie to sie tu wydarzylo: nakladka skasowala
  // z opisu zgody marketingowej pouczenie „Mozesz wycofac zgode w kazdej
  // chwili" i zostalo to cofniete.
  //
  // Ta bramka NIE MA listy wyjatkow i mieć jej nie powinna. Zmiana
  // kanonicznego brzmienia zgody nalezy do rdzenia ORAZ do bumpa wersji
  // w `consentCatalog.ts`.
  // ───────────────────────────────────────────────────────────────────────
  it("NIE podmienia tresci zgody RODO zdefiniowanej w rdzeniu", () => {
    const consentOverrides = overlayOverrides().filter((entry) =>
      /notifications\.consents\.(items|categories)\./.test(entry),
    );
    expect(
      consentOverrides,
      "nakladka podmienia tresc oswiadczenia zgody - to zmiana materialna wymagajaca bumpa wersji w consentCatalog.ts, nie wpisu w nakladce",
    ).toEqual([]);
  });

  // Reszta rozjazdow to dlug redakcyjny, nie prawny - ale rowniez oznacza,
  // ze uzytkownik widzi INNY napis po wejsciu na trase powiadomien niz przed
  // nim. Ratchet: lista moze tylko malec.
  it("nie dokłada nowych rozjazdow nakladka-rdzen (ratchet)", () => {
    const unexpected = overlayOverrides().filter((entry) => !KNOWN_OVERLAY_OVERRIDES.has(entry));
    expect(unexpected, "nowy klucz nakladki podmienia napis z rdzenia").toEqual([]);
  });

  it("lista znanego dlugu nie zawiera pozycji juz naprawionych", () => {
    const current = new Set(overlayOverrides());
    const stale = [...KNOWN_OVERLAY_OVERRIDES].filter((entry) => !current.has(entry));
    expect(stale, "wpis na liscie dlugu, ktorego juz nie ma - usun go z listy").toEqual([]);
  });
});
