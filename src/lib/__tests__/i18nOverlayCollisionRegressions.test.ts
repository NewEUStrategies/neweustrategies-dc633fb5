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

// Zdjęcie rdzenia ZANIM zarejestruje się jakakolwiek nakładka - bezpiecznik:
// i18next scala nakładki w miejscu, w obiekt przekazany do `init`, a eksport
// `locale/pl.ts` chroni przed tym tylko kopia `storeCopy` w `i18n.ts`
// (szczegóły w nagłówku bramki integralności).
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

describe("admin-media: słownik panelu i drugi język dociągnięte PO nakładce", () => {
  it("dialog usuwania i toast wgrania mówią zdaniem właściciela, nie kopią z nakładki", async () => {
    // Właścicielem `admin.*` był rdzeń języka; od 2026-10-17 jest nim słownik
    // panelu `i18n-admin-core` (rejestruje go `AdminSession`), a w rdzeniu
    // zostały tylko cztery klucze dialogu niezapisanych zmian. Scenariusz
    // zostaje ten sam, tylko z nowym właścicielem: chunk ekranu mediów może
    // zarejestrować swoją nakładkę ZANIM `AdminSession` zarejestruje słownik
    // panelu, a drugi język (EN) i tak przychodzi jeszcze później.
    //
    // Warunek scenariusza: ani słownika panelu, ani rdzenia EN nie ma jeszcze
    // w magazynie - a rdzeń PL nie niesie już tych kluczy wcale.
    for (const lang of ["pl", "en"] as const) {
      expect(i18n.getResource(lang, "translation", "admin.confirmDelete"), lang).toBeUndefined();
    }

    // Nakładka rejestruje się z overwrite=false („nie ruszamy właściciela")...
    await import("@/lib/i18n-admin-media");
    // Zdjęcie magazynu w oknie, w którym stoi WYŁĄCZNIE nakładka. Słownik
    // panelu rejestruje się z overwrite=true, więc po jego imporcie końcowe
    // `t()` zgadza się zawsze - sama asercja na końcu przeszłaby nawet wtedy,
    // gdyby nakładka znów niosła „Potwierdź usunięcie". A ten tekst admin
    // widział naprawdę: w oknie przed `AdminSession` i przy każdej przyszłej
    // ścieżce, która zarejestruje nakładkę bez słownika panelu. Kopia
    // głęboka, bo i18next scala kolejne paczki w ten sam obiekt magazynu.
    const overlayOnly = {
      pl: structuredClone(i18n.getResource("pl", "translation", "admin") as unknown),
      en: structuredClone(i18n.getResource("en", "translation", "admin") as unknown),
    } as const;
    // ...ale właściciel i rdzeń EN przychodzą DOPIERO TERAZ. Gdyby nakładka
    // niosła pod tymi kluczami INNE zdania niż właściciel, administrator
    // widziałby napis zależny od kolejności chunków - na danych pilnuje tego
    // bramka `i18nOverlayIntegrity.gate.test.ts`, tu - skutku na ekranie.
    const { adminCorePl, adminCoreEn } = await import("@/lib/i18n-admin-core");
    await ensureCoreLanguage("en");

    const owner = { pl: adminCorePl, en: adminCoreEn } as const;
    // Każdy liść `admin.*`, który nakładka zostawiła w magazynie, a który ma
    // też właściciel, musi nieść zdanie właściciela - inaczej ekran mówi czym
    // innym przed rejestracją słownika panelu i po niej.
    const walk = (node: unknown, path: string, out: Array<[string, unknown]>): void => {
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
      } else out.push([path, node]);
    };
    let compared = 0;
    for (const lang of ["pl", "en"] as const) {
      const leaves: Array<[string, unknown]> = [];
      walk(overlayOnly[lang], "admin", leaves);
      for (const [path, value] of leaves) {
        const ownerLeaf = path
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              node !== null && typeof node === "object" ? Reflect.get(node, part) : undefined,
            owner[lang],
          );
        if (ownerLeaf === undefined) continue;
        compared += 1;
        expect(value, `${lang}:${path} (nakładka przed właścicielem)`).toBe(ownerLeaf);
      }
    }
    // Bezpiecznik samego testu: nakładka mediów dzieli z właścicielem wspólne
    // przyciski (`admin.save`, `admin.cancel`…), więc zero porównań znaczy, że
    // zdjęcie wyżej nie widzi magazynu - a nie, że kolizji brak.
    expect(compared).toBeGreaterThan(0);
    const ownerValue = (lang: "pl" | "en", path: string): unknown =>
      path
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node !== null && typeof node === "object" ? Reflect.get(node, part) : undefined,
          owner[lang],
        );
    const en = i18n.getFixedT("en");
    const pl = i18n.getFixedT("pl");
    for (const key of ["admin.confirmDelete", "admin.media.uploaded"]) {
      expect(ownerValue("en", key), key).toEqual(expect.any(String));
      expect(en(key), key).toBe(ownerValue("en", key));
      expect(pl(key), key).toBe(ownerValue("pl", key));
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
    // `ConsentsPanel` (/profile/privacy) i dzwonek w nagłówku renderują się
    // bez nakładki (`NotificationsCenter` importuje ją od 2026-10-03, więc
    // /messages ją ładuje). Przed poprawką te ekrany
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

describe("nav.account i builder.sectionLoading: właścicielem jest rdzeń", () => {
  it("publiczni czytelnicy mają napis bez żadnej nakładki, a panel/builder go nie podmienia", async () => {
    // `AccountMenuWidget` i `sectionStreaming` renderują się na stronach
    // PUBLICZNYCH bez własnej nakładki. Gdy te dwa klucze żyły tylko
    // w admin-extras/builderze, publiczne strony czytały goły klucz, a /profile
    // dostawał napis przypadkiem (import słownika panelu z dialogu firmy).
    // `coreValue` czyta zdjęcie rdzenia sprzed rejestracji nakładek, więc
    // asercje padają, gdy klucz wyjdzie z `locale/*.ts` - samo załadowanie
    // `i18n-builder` niżej by tego nie wykryło (stąd kolejność).
    expect(coreValue("pl", "nav.account")).toBe("Menu konta");
    expect(coreValue("en", "nav.account")).toBe("Account menu");
    expect(coreValue("pl", "builder.sectionLoading")).toBe("Wczytywanie sekcji…");
    expect(coreValue("en", "builder.sectionLoading")).toBe("Loading the section…");

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
