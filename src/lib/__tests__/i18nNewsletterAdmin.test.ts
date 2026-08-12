// Parytet PL/EN slownika newslettera + pokrycie kluczy wolanych w kodzie.
//
// STAN ZASTANY. Slownik `i18n-newsletter-admin.ts` ISTNIAL, ale trasy kampanii
// nigdy nie zostaly do niego podlaczone: 91 kluczy, z czego 54 martwe, a same
// trasy trzymaly 60 wyrazen `isPl ? "PL" : "EN"`. Dwa rownolegle slowniki -
// jeden w pliku i18n, drugi rozsypany po JSX - z czego bramka parytetu widziala
// tylko pierwszy.
//
// Konwersja polegala wiec na UZGODNIENIU, nie na dopisaniu: kazde wyrazenie
// zostalo dopasowane do istniejacego klucza po OBU jezykach, a nowy klucz
// powstawal tylko wtedy, gdy zadny nie pasowal. Dwa przypadki wymagaly decyzji:
//   * `Odbiorcy` mialo w slowniku EN "Recipients", a w trasie "Audience" -
//     to dwa rozne uzycia (liczba odbiorcow vs naglowek karty segmentu), wiec
//     `audience` powstalo osobno, zamiast po cichu zmienic widoczny tekst;
//   * `campaigns.cancelEdit` bylo martwe, wiec zostalo przemianowane na
//     `cancel` - nazwa "cancelEdit" klamalaby w dialogu potwierdzenia.
//
// Bramka pilnuje calego modulu /admin/newsletter i dziala w OBIE strony:
//   * kazdy klucz wolany w kodzie musi istniec (inaczej ekran renderuje sciezke),
//   * kazdy klucz zadeklarowany musi byc wolany (inaczej rosnie druga, niewidoczna
//     kopia slownika - tak powstalo 50 martwych kluczy, ktore tu odpadly),
//   * skonwertowane pliki nie wracaja do literalow, par `{ pl, en }`,
//     twardych znacznikow BCP-47 ani wlasnych kopii `startsWith("pl")`,
//   * sub-nav montuje sie dokladnie raz - z trasy-layoutu, nie z panelu.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { newsletterAdminPl, newsletterAdminEn } from "@/lib/i18n-newsletter-admin";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: readonly string[]): string[] => [
  ...new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, ""))),
];

/** Pliki, ktore MAJA byc juz wolne od recznych wyrazen jezykowych. */
const CONVERTED = [
  "src/routes/admin.newsletter.campaigns.$id.tsx",
  "src/routes/admin.newsletter.campaigns.index.tsx",
  "src/routes/admin.newsletter.overview.tsx",
  "src/components/admin/newsletter/CampaignContentBuilder.tsx",
  "src/components/admin/newsletter/CampaignBlockProperties.tsx",
  "src/components/admin/newsletter/NewsletterSubNav.tsx",
  "src/components/admin/newsletter/PopupEventsPanel.tsx",
  "src/components/admin/newsletter/SubscribersPanel.tsx",
  "src/components/admin/newsletter/system-emails/SystemEmailsPanel.tsx",
  "src/components/admin/newsletter/system-emails/TxEmailContentPanel.tsx",
  "src/components/admin/newsletter/system-emails/AuthEmailPreviewPanel.tsx",
  "src/components/admin/newsletter/auth-logs/AuthEmailLogsPanel.tsx",
  "src/components/admin/newsletter/deliverability/DeliverabilityPanel.tsx",
] as const;

const SOURCES = CONVERTED.map((path) => ({ path, src: readFileSync(path, "utf8") }));

/** Kod bez komentarzy - komentarze WOLNO opisywac stary wzorzec. */
function code(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const pl = flatten(newsletterAdminPl as unknown as Tree);
const en = flatten(newsletterAdminEn as unknown as Tree);

/**
 * Klucze `adminNewsletter.*` wolane literalnie gdziekolwiek w `src` - z pominieciem
 * samego pliku slownika (inaczej kazda deklaracja "uzywalaby" siebie).
 */
function usedInSrc(): Set<string> {
  const DICTIONARY = join("src", "lib", "i18n-newsletter-admin.ts");
  const used = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry) || path === DICTIONARY) continue;
      for (const m of readFileSync(path, "utf8").matchAll(/"(adminNewsletter\.[A-Za-z0-9_.]+)"/g)) {
        used.add(m[1]);
      }
    }
  };
  walk("src");
  return used;
}

describe("i18n-newsletter-admin", () => {
  it("ma identyczny zestaw kluczy w PL i EN", () => {
    expect(baseKeys(pl).sort()).toEqual(baseKeys(en).sort());
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = (tree: Tree): string[] =>
      Object.values(tree).flatMap((v) => (typeof v === "string" ? [v] : values(v)));
    const all = [
      ...values(newsletterAdminPl as unknown as Tree),
      ...values(newsletterAdminEn as unknown as Tree),
    ];
    expect(all.filter((v) => v.trim() === "")).toEqual([]);
    expect(all.filter((v) => v.includes("—"))).toEqual([]);
  });

  it("pokrywa KAZDY klucz adminNewsletter.* wolany gdziekolwiek w kodzie", () => {
    // Skan calego `src`, nie tylko skonwertowanych plikow: brakujacy klucz
    // renderuje surowa sciezke w interfejsie, wiec bramka ma widziec wszystko.
    const declared = new Set([...pl, ...baseKeys(pl)]);
    expect([...usedInSrc()].filter((key) => !declared.has(key)).sort()).toEqual([]);
  });

  it("nie trzyma ani jednego martwego klucza", () => {
    // Druga strona tej samej monety. Slownik istnial przed trasami i mial
    // 50 kluczy, ktorych NIC nie renderowalo - w tym `campaigns.title` obok
    // zywego `listHeading` i caly blok `newsletterUnsubscribe`, ktory byl
    // duplikatem zywego `newsletter.unsubscribePage` z `lib/locale`. Martwy
    // klucz nie psuje ekranu, wiec sam z siebie nigdy sie nie ujawni -
    // dlatego pilnuje go bramka, a nie czyjas uwaznosc.
    //
    // UWAGA przy rozbudowie: bramka widzi tylko klucze wolane LITERALNIE.
    // Klucz skladany szablonem (`t(\`…\${x}\`)`) wyglada tu jak martwy - i tak
    // ma byc, bo mapa `Record<…, "pelna.sciezka">` jest w tym module wzorcem
    // (patrz `TYPE_LABEL_KEYS`), wlasnie po to, by bramka miala co sprawdzac.
    const used = usedInSrc();
    const dead = pl.filter((key) => !used.has(key) && !used.has(key.replace(PLURAL_SUFFIX, "")));
    expect(dead.sort()).toEqual([]);
  });

  it("zachowuje interpolacje wolane przez kod", () => {
    for (const tree of [newsletterAdminPl, newsletterAdminEn]) {
      expect(tree.adminNewsletter.campaigns.testResult).toContain("{{sent}}");
      expect(tree.adminNewsletter.campaigns.testResult).toContain("{{failed}}");
      expect(tree.adminNewsletter.campaigns.sendConfirmCount).toContain("{{count}}");
      expect(tree.adminNewsletter.subscribers.capWarning).toContain("{{count}}");
    }
  });

  it("rozrozznia liczbe odbiorcow od naglowka segmentu", () => {
    // Po polsku oba brzmia "Odbiorcy" - po angielsku NIE, i to jest cala
    // przyczyna istnienia dwoch kluczy zamiast jednego.
    expect(newsletterAdminPl.adminNewsletter.campaigns.recipients).toBe("Odbiorcy");
    expect(newsletterAdminPl.adminNewsletter.campaigns.audience).toBe("Odbiorcy");
    expect(newsletterAdminEn.adminNewsletter.campaigns.recipients).toBe("Recipients");
    expect(newsletterAdminEn.adminNewsletter.campaigns.audience).toBe("Audience");
  });

  it("skonwertowane pliki nie maja ani jednego `isPl`", () => {
    for (const { path, src } of SOURCES) {
      expect({ path, occurrences: (code(src).match(/isPl/g) ?? []).length }).toEqual({
        path,
        occurrences: 0,
      });
    }
  });

  it("zadna struktura danych nie trzyma pary `{ pl, en }` z napisami", () => {
    // Pary `{ pl, en }` w tablicach `PALETTE`, `EVENT_META`, `TYPE_LABELS`
    // i `FIELDS` byly rownoleglym slownikiem - poza zasiegiem bramki parytetu,
    // bo nie mieszkaly w pliku i18n. Po konwersji struktury niosa `labelKey`.
    const offenders: string[] = [];
    for (const { path, src } of SOURCES) {
      for (const m of code(src).matchAll(/\b(?:pl|en|labelPl|labelEn):\s*["'`]/g)) {
        offenders.push(`${path}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("mapy etykiet wskazuja klucze widoczne dla bramki pokrycia", () => {
    // Klucz skladany szablonem (`types.${type}`) przechodzi typowanie, ale
    // znika z bramki pokrycia - brak tlumaczenia ujawnilby sie dopiero
    // w interfejsie. Dlatego mapy wypisuja pelne sciezki literalnie.
    for (const name of ["PopupEventsPanel.tsx", "TxEmailContentPanel.tsx"]) {
      const { src } = SOURCES.find((s) => s.path.endsWith(name))!;
      expect({ name, hasLabelKey: src.includes("labelKey:") }).toEqual({ name, hasLabelKey: true });
    }
    const preview = SOURCES.find((s) => s.path.endsWith("AuthEmailPreviewPanel.tsx"))!.src;
    expect(preview).toContain("TYPE_LABEL_KEYS");
    for (const { path, src } of SOURCES) {
      const templated = [...code(src).matchAll(/`adminNewsletter\.[^`]*\$\{/g)].map((m) => m[0]);
      expect({ path, templated }).toEqual({ path, templated: [] });
    }
  });

  it("nie tlumaczy jezyka na kod ani na znacznik BCP-47 w komponencie", () => {
    for (const { path, src } of SOURCES) {
      expect({
        path,
        bcp47: code(src).includes('"pl-PL"') || code(src).includes('"en-GB"'),
      }).toEqual({ path, bcp47: false });
    }
  });

  it("wyprowadza jezyk interfejsu helperem, nie kopia warunku", () => {
    // Ta sama linia `(i18n.language ?? "pl").startsWith(...)` powtarzala sie
    // w kazdym komponencie - `uiLang`/`uiLocale` z `lib/i18n/format` sa jedynym
    // miejscem tej normalizacji.
    const offenders: string[] = [];
    for (const { path, src } of SOURCES) {
      if (/i18n\.language[^\n]*\.startsWith\(/.test(code(src))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("sub-nav newslettera renderuje sie DOKLADNIE raz - z trasy-layoutu", () => {
    // `TxEmailContentPanel` i `AuthEmailPreviewPanel` montowaly `NewsletterSubNav`
    // same, a sa dziecmi trasy `/admin/newsletter`, ktora robi to samo. Efekt:
    // dwa sticky paski jeden pod drugim (oba `top-0 z-30`) na dwoch ekranach.
    const layout = readFileSync("src/routes/admin.newsletter.tsx", "utf8");
    expect(layout).toContain("<NewsletterSubNav />");
    const offenders = SOURCES.filter(({ src }) => code(src).includes("<NewsletterSubNav")).map(
      ({ path }) => path,
    );
    expect(offenders).toEqual([]);
  });
});
