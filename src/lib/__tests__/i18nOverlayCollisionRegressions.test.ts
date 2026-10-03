// Kolizje kluczy między nakładkami - skutki WIDOCZNE dla użytkownika.
//
// Bramka `i18nOverlayIntegrity.gate.test.ts` liczy kolizje na danych (dwie
// wartości pod jednym kluczem). Ten plik odtwarza to, co z nich wynikało
// w działającej aplikacji: napis zależny od KOLEJNOŚCI ładowania chunków albo
// od tego, który rdzeń językowy dociągnął się później. Każdy test ustawia
// kolejność, w której kolizja była widoczna, i asertuje napis właściciela.
//
// Środowisko klienckie (happy-dom) celowo: `@/lib/i18n` ładuje wtedy tylko
// rdzeń aktywnego języka, a drugi dociąga leniwie - jak w przeglądarce.
// Dlatego NIE importujemy tu `@/test/i18nReal` (ten dociąga oba rdzenie
// z góry i zasłoniłby pierwszy scenariusz). Testy idą w kolejności pliku:
// pierwszy wymaga, żeby rdzeń EN nie był jeszcze załadowany, i sprawdza to sam.
import { describe, expect, it } from "vitest";
import i18n, { ensureCoreLanguage } from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";

// Zdjęcie rdzenia ZANIM zarejestruje się jakakolwiek nakładka: i18next scala
// nakładki w miejscu, na obiekcie przekazanym do `init`, czyli na eksporcie
// `locale/pl.ts` (szczegóły w nagłówku bramki integralności).
const CORE = structuredClone({ pl: corePl, en: coreEn });

function coreValue(lang: "pl" | "en", path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object" ? Reflect.get(node, part) : undefined,
      CORE[lang],
    );
}

describe("admin-media: drugi język dociągnięty PO nakładce", () => {
  it("dialog usuwania i toast wgrania mówią zdaniem rdzenia, nie kopią z nakładki", async () => {
    // Warunek scenariusza: rdzeń EN jeszcze nie stoi w magazynie.
    expect(i18n.getResource("en", "translation", "admin.confirmDelete")).toBeUndefined();

    // Nakładka rejestruje się z overwrite=false („nie ruszamy rdzenia")...
    await import("@/lib/i18n-admin-media");
    // ...ale rdzeń EN przychodzi DOPIERO TERAZ, też z overwrite=false, więc
    // kopia z nakładki zostawała w magazynie zamiast zdania rdzenia - a ten
    // sam administrator, który zaczął na stronie EN, widział inny napis.
    await ensureCoreLanguage("en");

    const en = i18n.getFixedT("en");
    const pl = i18n.getFixedT("pl");
    for (const key of ["admin.confirmDelete", "admin.media.uploaded"]) {
      expect(en(key), key).toBe(coreValue("en", key));
      expect(pl(key), key).toBe(coreValue("pl", key));
    }
  });
});

describe("giełda spotkań: komunikat odmowy uczestnika", () => {
  it("nie zależy od tego, czy wcześniej załadował się panel organizatora", async () => {
    const { eventMeetingsPl, eventMeetingsEn } = await import("@/lib/i18n-event-meetings");
    const { meetingErrorI18nKey } = await import("@/lib/events/meetingsErrors");
    // Kolejność, w której kolizja była widoczna: uczestnik, potem panel
    // (organizator przechodzi z panelu na front wydarzenia w tej samej karcie,
    // a na serwerze wystarczy, że isolate wyrenderował wcześniej panel).
    await import("@/lib/i18n-admin-event-meetings");

    const cases = [
      ["forbidden: authentication required", "forbidden"],
      ["Failed to fetch", "unknown"],
    ] as const;
    for (const [raw, key] of cases) {
      const i18nKey = meetingErrorI18nKey(new Error(raw));
      expect(i18nKey).toBe(`eventMeetings.errors.${key}`);
      expect(i18n.getFixedT("pl")(i18nKey)).toBe(eventMeetingsPl.eventMeetings.errors[key]);
      expect(i18n.getFixedT("en")(i18nKey)).toBe(eventMeetingsEn.eventMeetings.errors[key]);
    }
  });
});

describe("powiadomienia: nakładka nie podmienia polskiego rdzenia", () => {
  it("każdy napis notifications.* z rdzenia PL jest ten sam przed i po wejściu na trasę", async () => {
    // `NotificationsCenter` i `ConsentsPanel` renderują się też na /messages
    // i /profile/privacy, które nakładki nie ładują. Przed poprawką te ekrany
    // zmieniały siedem polskich zdań po pierwszej wizycie na
    // /profile/notifications - m.in. tytuł i opis panelu zgód tracił
    // wzmiankę o plikach cookie, choć panel nadal pokazuje przełączniki cookie.
    const corePaths = (node: unknown, prefix: string): string[] =>
      node !== null && typeof node === "object" && !Array.isArray(node)
        ? Object.entries(node).flatMap(([key, child]) => corePaths(child, `${prefix}.${key}`))
        : typeof node === "string"
          ? [prefix]
          : [];
    const keys = corePaths(coreValue("pl", "notifications"), "notifications");
    expect(keys.length).toBeGreaterThan(50);

    await import("@/lib/i18n-notifications");

    const pl = i18n.getFixedT("pl");
    const changed = keys.filter((key) => pl(key) !== coreValue("pl", key));
    expect(changed).toEqual([]);
  });
});

describe("admin-extras kontra builder: wspólne klucze", () => {
  it("panel nie podmienia napisów, których właścicielem jest słownik buildera", async () => {
    await import("@/lib/i18n-builder");
    const before = {
      pl: i18n.getFixedT("pl"),
      en: i18n.getFixedT("en"),
    };
    const snapshot = ["nav.account", "builder.sectionLoading", "linkPicker.newTab"].flatMap((key) =>
      (["pl", "en"] as const).map((lang) => [lang, key, before[lang](key)] as const),
    );

    // `/admin` ładuje admin-extras z overwrite=true. Przed poprawką czytnik
    // ekranu na PUBLICZNEJ stronie PL (AccountMenuWidget) dostawał po wizycie
    // w panelu angielskie „Account menu".
    await import("@/lib/i18n-admin-extras");

    for (const [lang, key, value] of snapshot) {
      expect(i18n.getFixedT(lang)(key), `${lang}:${key}`).toBe(value);
    }
    expect(i18n.getFixedT("pl")("nav.account")).toBe("Menu konta");
  });
});
