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

import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { realT } from "@/test/i18nReal";
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_GROUPS } from "@/lib/notifications/preferences";
import { CONSENT_CATALOG } from "@/lib/notifications/consentCatalog";
import { PLURAL_SUFFIXES } from "@/lib/ci/i18nKeyUsage";
import type { AppLang } from "@/lib/i18n/localePath";

type Tree = { [key: string]: string | Tree };

const LANGS: readonly AppLang[] = ["pl", "en"];

// ZDJECIE RDZENIA SPRZED NAKLADKI - i dlatego nakladka idzie importem
// DYNAMICZNYM, nie statycznym (statyczny wykonalby sie przed cialem modulu).
//
// i18next trzyma zasoby z `init({ resources })` PRZEZ REFERENCJE, a nakladka
// scala sie w nie w miejscu (`deepExtend` na obiekcie z magazynu). Do
// 2026-10-03 `init` dostawal sam eksport `pl` z `locale/pl.ts`, wiec po
// imporcie nakladki byl on juz SCALONYM slownikiem. Poprzednia wersja tego
// pliku porownywala nakladke wlasnie z tym zywym eksportem, czyli sama ze
// soba: polska polowa ratchetu byla slepa i siedem polskich podmian przezylo
// ja niezauwazone (zlapala je dopiero bramka `i18nOverlayIntegrity.gate.test.ts`,
// ktora robi to samo zdjecie). Dzis `i18n.ts` podaje i18next kopie rdzenia
// (`storeCopy`, przypiete w `i18nCoreExportsPristine.test.ts`) - zdjecie
// zostaje jako bezpiecznik, gdyby kopia kiedys zniknela.
const CORE = structuredClone({ pl: corePl, en: coreEn });

/** Liscie `notifications.*` rdzenia danego jezyka (bez tablic - patrz `flattenLoose`). */
function coreNotificationKeys(lang: AppLang): string[] {
  return flattenLoose(CORE[lang].notifications, "notifications").map(([key]) => key);
}

// Co uzytkownik widzi tam, gdzie nakladki nie ma: w dzwonku naglowka i w panelu
// zgod na /profile/privacy (do 2026-10-03 takze w skrzynce na /messages).
const SEEN_BEFORE_OVERLAY = LANGS.flatMap((lang) =>
  coreNotificationKeys(lang).map((key) => ({ lang, key, text: realT(lang)(key) })),
);

const { notificationsResources } = await import("@/lib/i18n-notifications");

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

// Rytual rodzajow F1-F5 (spec B.7): `event` (przelaczalny, grupa `events`)
// i `billing` (zawsze doreczany). Dokladne brzmienie przypiete, bo etykieta
// `billing` stoi w filtrze skrzynki, a grupa `events` jest nowa sekcja ustawien.
describe("rodzaje event i billing - etykiety PL/EN", () => {
  it.each([
    ["notifications.settings.kinds.event", "Wydarzenia i przypomnienia", "Events and reminders"],
    ["notifications.settings.kinds.billing", "Płatności", "Payments"],
    ["notifications.settings.kindGroups.events", "Wydarzenia", "Events"],
  ])("%s", (key, plText, enText) => {
    expect(realT("pl")(key)).toBe(plText);
    expect(realT("en")(key)).toBe(enText);
  });

  it("podpis grupy events jest w obu jezykach i rozny", () => {
    const key = "notifications.settings.kindGroups.eventsHint";
    expect(realT("pl")(key)).not.toBe(key);
    expect(realT("en")(key)).not.toBe(key);
    expect(realT("pl")(key)).not.toBe(realT("en")(key));
  });

  it("katalog zawiera oba rodzaje, a grupa events tylko event", () => {
    expect(NOTIFICATION_KINDS).toContain("event");
    expect(NOTIFICATION_KINDS).toContain("billing");
    expect(NOTIFICATION_KIND_GROUPS.find((group) => group.id === "events")?.kinds).toEqual([
      "event",
    ]);
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
  /** Wszystkie miejsca, w ktorych nakladka podmienia napis z rdzenia (zdjecie `CORE`). */
  function overlayOverrides(): string[] {
    const overlays: Record<AppLang, Tree> = { pl: plOverlay, en: enOverlay };
    const found: string[] = [];
    for (const lang of LANGS) {
      const coreByKey = new Map(flattenLoose(CORE[lang]));
      for (const [key, overlayValue] of flatten(overlays[lang])) {
        const coreValue = coreByKey.get(key);
        if (coreValue !== undefined && coreValue !== overlayValue) found.push(`${lang}:${key}`);
      }
    }
    return found.sort();
  }

  /**
   * Klucze nakladki, ktore rdzen JUZ definiuje - z tym samym brzmieniem albo
   * innym, wprost albo formami mnogimi (`klucz_one`, `klucz_other`...).
   */
  function overlayDuplicates(): string[] {
    const overlays: Record<AppLang, Tree> = { pl: plOverlay, en: enOverlay };
    const found: string[] = [];
    for (const lang of LANGS) {
      const coreKeys = new Set(flattenLoose(CORE[lang]).map(([key]) => key));
      for (const [key] of flatten(overlays[lang])) {
        const plural = PLURAL_SUFFIXES.some((suffix) => coreKeys.has(`${key}${suffix}`));
        if (coreKeys.has(key) || plural) found.push(`${lang}:${key}`);
      }
    }
    return found.sort();
  }

  it("porownanie idzie do rdzenia SPRZED nakladki (kontrola narzedzia)", () => {
    // Gdyby zdjecie wzielo klucze nakladki (np. `i18n.ts` znow oddal i18next
    // sam eksport, w ktory nakladka scala sie w miejscu), kazde porownanie
    // nizej byloby slepe.
    for (const lang of LANGS) {
      const keys = new Set(flattenLoose(CORE[lang]).map(([key]) => key));
      expect(keys.has("notifications.title"), `${lang}: klucz rdzenia`).toBe(true);
      expect(keys.has("notifications.page.metaTitle"), `${lang}: klucz nakladki`).toBe(false);
      expect(keys.has("notifications.settings.subtitleLead"), `${lang}: klucz nakladki`).toBe(
        false,
      );
    }
  });

  it("kazdy klucz nakladki renderuje w swoim jezyku WLASNY napis, a PL i EN sie roznia", () => {
    // Sondy z testu „PL i EN roznia sie trescia" wyzej to dzis klucze RDZENIA,
    // wiec nie widza nakladki: zarejestrowanie polskiego drzewa pod `en`
    // (albo wklejenie polskich zdan do `notificationsEn`) przechodzilo zielono,
    // a angielski interfejs dostawal polski `subtitleLead` i `page.*`.
    for (const lang of LANGS) {
      const overlay = lang === "pl" ? plOverlay : enOverlay;
      for (const [key, text] of flatten(overlay)) {
        expect(realT(lang)(key), `${lang}:${key}`).toBe(text);
      }
    }
    const enByKey = new Map(flatten(enOverlay));
    const copied = flatten(plOverlay)
      .filter(([key, text]) => enByKey.get(key) === text)
      .map(([key]) => key);
    expect(copied, "napis EN jest kopia polskiego").toEqual([]);
  });

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

  // ZERO KOPII KLUCZY RDZENIA - lista 24 angielskich podmian, zamrozona tu do
  // 2026-10-03, jest zamknieta, a test nie ma juz listy wyjatkow. Nakladka nie
  // niesie zadnego klucza, ktory ma rdzen, NAWET z identycznym brzmieniem: kopia
  // zgodna dzis rozjezdza sie przy pierwszej poprawce rdzenia, a overwrite=true
  // przywraca wtedy stary napis od wejscia na /profile/notifications. Z takich
  // kopii wyrosly wszystkie 31 rozjazdow (24 EN + 7 PL). Forma mnoga liczy sie
  // tak samo: rdzen ma `grouped.moreMessages_one/_other`, wiec goly
  // `grouped.moreMessages` z nakladki nigdy sie nie renderowal (i18next przy
  // `count` bierze najpierw klucz z przyrostkiem) - byl martwa kopia z INNYM
  // brzmieniem („i 2 więcej").
  it("nie powtarza ZADNEGO klucza rdzenia - wprost ani przez formy mnogie", () => {
    expect(
      overlayDuplicates(),
      "klucz nalezy do rdzenia (`src/lib/locale/*.ts`) - zmiana brzmienia idzie tam, nie do nakladki",
    ).toEqual([]);
  });

  it("kazdy napis notifications.* rdzenia jest ten sam przed i po zaladowaniu nakladki", () => {
    // Skutek widoczny dla uzytkownika: dzwonek w naglowku i panel zgod na
    // /profile/privacy nie laduja nakladki (skrzynka na /messages nie ladowala
    // jej do 2026-10-03), wiec zmienialy napis po pierwszej wizycie na
    // /profile/notifications.
    expect(SEEN_BEFORE_OVERLAY.length).toBeGreaterThan(100);
    const changed = SEEN_BEFORE_OVERLAY.filter(
      ({ lang, key, text }) => realT(lang)(key) !== text,
    ).map(({ lang, key }) => `${lang}:${key}`);
    expect(changed).toEqual([]);
  });

  it.each([
    ["pl", 1, "moreMessages_one"],
    ["pl", 2, "moreMessages_few"],
    ["pl", 5, "moreMessages_many"],
    ["en", 1, "moreMessages_one"],
    ["en", 2, "moreMessages_other"],
  ] as const)(
    "grouped.moreMessages (%s, count=%i) bierze forme mnoga rdzenia",
    (lang, count, form) => {
      const grouped: unknown = Reflect.get(CORE[lang].notifications, "grouped");
      const template = new Map(flattenLoose(grouped)).get(form);
      expect(template).toBeTypeOf("string");
      expect(realT(lang)("notifications.grouped.moreMessages", { count })).toBe(
        template?.replace("{{count}}", String(count)),
      );
    },
  );
});
