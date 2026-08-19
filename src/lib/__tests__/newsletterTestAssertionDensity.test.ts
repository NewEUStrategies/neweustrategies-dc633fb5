// Bramka gęstości asercji w testach modułu 11 (newsletter, popupy, poczta).
//
// PO CO TO ISTNIEJE. Repo raz już straciło całą warstwę testów panelu, bo
// przypadki tylko renderowały komponent i sprawdzały, że nic nie rzuciło
// wyjątkiem. Takie testy podbijają pokrycie i NIE odpowiadają na pytanie, czy
// panel działa - a usunięcie ich jest jedynym wyjściem, kiedy nikt już nie wie,
// które z nich cokolwiek pilnują. Ślad po tym stoi w komentarzu przy progach
// globalnych w `vitest.config.ts`.
//
// Reguła projektu brzmi: MINIMUM DWIE ASERCJE NA PRZYPADEK. Pierwsza mówi „coś
// się stało", druga - „stało się TYLKO to" albo „to, co widać, naprawdę działa".
// Ta bramka pilnuje jej mechanicznie, żeby nie erodowała przy kolejnych zmianach.
//
// CZEGO BRAMKA NIE ROBI. Nie liczy asercji wykonanych w pętli (`for (const x of
// REGISTRY) expect(...)`), bo statycznie widzi tam jedno wywołanie `expect`.
// Przypadek z pętlą jest więc zwolniony - pętla po rejestrze albo po komplecie
// pól sprawdza z definicji wiele rzeczy naraz.
//
// DŁUG ZASTANY. `LEGACY` niżej to pliki, które istniały PRZED tą warstwą testów
// i mają razem 68 przypadków z jedną asercją. Nie są tu naprawiane, bo to reguły
// już pokryte gdzie indziej (tokeny śledzenia, `emailDoc`, `renderEmailHtml`,
// audiencja kampanii, projekt popupu) i przepisywanie ich nie dodałoby wiedzy o
// module, a rozmyłoby zmianę. Lista jest jawna z rozmysłu: nowy plik w tych
// katalogach jest objęty bramką automatycznie, a zdjęcie pozycji z listy jest
// świadomą decyzją, nie skutkiem ubocznym.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Katalogi testów modułu 11 objęte bramką. */
const ROOTS = [
  "src/components/admin/newsletter",
  "src/components/admin/popups",
  "src/components/popups",
  "src/lib/newsletter",
  "src/lib/newsletter-builder",
  "src/lib/email",
];

/** Pojedyncze pliki testów modułu, które leżą poza katalogami wyżej. */
const FILES = [
  "src/lib/__tests__/newsletter.functions.test.ts",
  "src/lib/__tests__/newsletter-deliverability.functions.test.ts",
  "src/lib/__tests__/newsletterCampaignCrud.test.ts",
  "src/lib/__tests__/newsletterCampaignSend.test.ts",
  "src/lib/__tests__/newsletterCampaignTick.test.ts",
  "src/lib/__tests__/newsletterPopupEvents.functions.test.ts",
  "src/routes/-api.public.newsletter.confirm.handler.test.ts",
  "src/routes/__tests__/newsletterConsentPages.test.tsx",
  "src/routes/api/public/-nl-tracking.test.ts",
  "src/routes/api/public/-popup-event.test.ts",
  "src/routes/api/public/-webhooks.resend.test.ts",
  "src/routes/email/-unsubscribe.test.ts",
  "src/routes/platform/email/auth/-webhook.test.ts",
  "src/routes/platform/email/transactional/-send.test.ts",
];

/**
 * Pliki sprzed tej warstwy testów, zwolnione z reguły dwóch asercji. Kolejność
 * alfabetyczna; liczba w komentarzu to cienkie przypadki w chwili wpisania.
 */
const LEGACY = new Set([
  "src/components/admin/newsletter/__tests__/CampaignEngagementCard.test.tsx", // 1
  "src/components/admin/popups/signup/__tests__/SignupPopupEditor.test.tsx", // 2
  "src/components/popups/__tests__/SignupPopupPanel.test.tsx", // 2
  "src/lib/email/__tests__/auth-preview.test.ts", // 1
  "src/lib/email/__tests__/runnerHealth.test.ts", // 5
  "src/lib/email/__tests__/suppressionPolicy.test.ts", // 3
  "src/lib/email/__tests__/txOverrides.test.ts", // 1
  "src/lib/email/__tests__/webhookSignature.test.ts", // 8
  "src/lib/email/auth-lang.test.ts", // 5
  "src/lib/newsletter-builder/__tests__/defaults.test.ts", // 1
  "src/lib/newsletter-builder/__tests__/sections.test.ts", // 4
  "src/lib/newsletter/__tests__/campaignAudience.test.ts", // 10
  "src/lib/newsletter/__tests__/emailDoc.test.ts", // 1
  "src/lib/newsletter/__tests__/engagementRate.test.ts", // 1
  "src/lib/newsletter/__tests__/newsletterFieldLabels.test.ts", // 1
  "src/lib/newsletter/__tests__/popupFieldTokens.test.ts", // 2
  "src/lib/newsletter/__tests__/renderEmailHtml.test.ts", // 3
  "src/lib/newsletter/__tests__/trackingEvents.test.ts", // 3
  "src/lib/newsletter/__tests__/trackingLinkSignature.test.ts", // 3
  "src/lib/newsletter/__tests__/trackingToken.test.ts", // 4
  "src/lib/newsletter/popupDesign.test.ts", // 5
  "src/lib/newsletter/popupFields.test.ts", // 2
]);

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else if (/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

interface Case {
  file: string;
  name: string;
  line: number;
  asserts: number;
  hasLoop: boolean;
}

/**
 * Rozbija plik na przypadki `it(...)`. Parser jest liniowy z rozmysłem: pełne
 * drzewo składniowe kosztowałoby więcej, niż bramka jest warta, a `it(` na
 * początku linii jest w tym repo jedyną formą zapisu przypadku.
 */
function casesIn(file: string): Case[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const cases: Case[] = [];
  let current: Case | null = null;
  lines.forEach((line, idx) => {
    const opened = /^\s*it(?:\.each\([^)]*\))?\(\s*[`"]/.exec(line);
    if (opened) {
      const name = line.replace(/^\s*it(?:\.each\([^)]*\))?\(\s*[`"]/, "").slice(0, 80);
      current = { file, name, line: idx + 1, asserts: 0, hasLoop: false };
      cases.push(current);
      return;
    }
    if (!current) return;
    current.asserts += (line.match(/expect\(/g) ?? []).length;
    if (/\b(for|forEach|\.map\()/.test(line)) current.hasLoop = true;
  });
  return cases;
}

const COVERED = [...ROOTS.flatMap(walk), ...FILES].filter((f) => !LEGACY.has(f));
const ALL_CASES = COVERED.flatMap(casesIn);

describe("bramka gęstości asercji - moduł 11", () => {
  it("bramka faktycznie coś obejmuje - inaczej milczałaby przy każdej regresji", () => {
    expect(ALL_CASES.length).toBeGreaterThan(900);
    expect(new Set(ALL_CASES.map((c) => c.file)).size).toBeGreaterThan(40);
  });

  it("lista długu zastanego nie rośnie o pliki, których nie ma", () => {
    const wszystkie = new Set([...ROOTS.flatMap(walk), ...FILES]);
    const martwe = [...LEGACY].filter((f) => !wszystkie.has(f));

    // Nieistniejąca pozycja na liście zwolnień to cichy sposób na wyłączenie
    // bramki dla pliku, który ktoś potem przeniósł.
    expect(martwe).toEqual([]);
    expect(LEGACY.size).toBeGreaterThan(0);
  });

  it("ŻADEN przypadek nie jest bez asercji - to reguła, którą repo raz złamało", () => {
    const bez = ALL_CASES.filter((c) => c.asserts === 0).map(
      (c) => `${c.file}:${c.line} ${c.name}`,
    );

    expect(bez).toEqual([]);
    expect(ALL_CASES.every((c) => c.asserts > 0)).toBe(true);
  });

  it("KAŻDY przypadek ma co najmniej dwie asercje albo pętlę po komplecie", () => {
    const cienkie = ALL_CASES.filter((c) => c.asserts < 2 && !c.hasLoop).map(
      (c) => `${c.file}:${c.line} ${c.name}`,
    );

    expect(cienkie).toEqual([]);
    expect(cienkie).toHaveLength(0);
  });

  it("średnia gęstość trzyma się progu 2,0", () => {
    const asercje = ALL_CASES.reduce((sum, c) => sum + c.asserts, 0);
    const gestosc = asercje / ALL_CASES.length;

    expect(gestosc).toBeGreaterThanOrEqual(2);
    // Sam licznik też musi być sensowny - zero asercji przy zerze przypadków
    // dałoby NaN i bramka przepuściłaby wszystko.
    expect(Number.isFinite(gestosc)).toBe(true);
  });
});
