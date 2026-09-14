// Bramka: NAJEMCA NIE POCHODZI Z CLAIMÓW TOKENU, BO ŻADEN CLAIM GO NIE NIESIE.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// `listStaffUsers` (src/lib/crm.functions.ts) czytał najemcę z
// `context.claims.tenant_id`. Takiego claimu w tym repo nie ma i nie da się go
// mieć: `requireSupabaseAuth` (auth-middleware.ts - plik generowany) wkłada do
// kontekstu DOSŁOWNY wynik `supabase.auth.getClaims(token)`, a jedynym
// miejscem, w którym Supabase dokłada do tokenu własne pola, jest
// `custom_access_token_hook`. Hooka nie ma ani w `supabase/config.toml`, ani
// w żadnej z 958 migracji. Odczyt był więc ZAWSZE `undefined`, gałąź z filtrem
// martwa, a gałąź bez filtru szła spod `supabaseAdmin`, który omija RLS - czyli
// oddawała role i profile staffu wszystkich najemców każdemu zalogowanemu
// CRM-owcowi.
//
// ── DLACZEGO NIE ZŁAPAŁ TEGO ANI KOMPILATOR, ANI TEST ──────────────────────
// `JwtPayload` z supabase-js ma `[key: string]: any`, więc DOWOLNY claim
// type-checkuje się poprawnie - nazwa literówki też. A test jednostkowy
// mintował sobie `claims: { tenant_id: TENANT }` w fixture kontekstu
// (crmFunctions.test.ts) i asercją na tym fixture „dowodził" zawężenia, którego
// produkcja nigdy nie wykonywała. Dlatego skan obejmuje TAKŻE pliki testowe:
// fixture nie był skutkiem ubocznym defektu, tylko mechanizmem, którym defekt
// przeszedł review.
//
// ── KONTRAKT JEST DWUSTRONNY ───────────────────────────────────────────────
// Asercja „nikt nie wyprowadza najemcy z claimów" ma sens wyłącznie dopóki
// prawdziwa jest asercja „nie ma hooka na access token" - stąd obie tutaj.
// Jeśli ktoś kiedyś naprawdę dowiezie migrację z `custom_access_token_hook`
// i blok w `config.toml`, pierwszy test zrobi się czerwony, a poprawną
// odpowiedzią jest ŚWIADOME skasowanie tej bramki (i zasłużenie na claim od
// nowa), nie dopisanie wyjątku obok.
//
// Bramka nie ma wpisu w `package.json` - to zwykły plik vitesta, zbierany przez
// `bun run test` razem z resztą `src/`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maskComments } from "@/lib/ci/i18nKeyUsage";
import { stripSqlComments } from "../../../../scripts/lib/sqlMigrations";

const CONFIG = "supabase/config.toml";
const MIGRATIONS_DIR = "supabase/migrations";
const SELF = "src/integrations/supabase/__tests__/tenantClaimAbsence.gate.test.ts";
const GENERATED_TYPES = "src/integrations/supabase/types.ts";

/**
 * Dwa pliki wypadają ze skanu i ŻADEN z nich nie jest zgodą na odczyt claimu
 * w kodzie: `types.ts` jest generowany z bazy, a jego jedyne trafienie to nazwa
 * klucza obcego `plan_ticket_claims_tenant_id_fkey` (napis, nie odczyt); ten
 * plik cytuje ścigany wzorzec w detektorze, więc trafiłby sam w siebie. Poza
 * nimi bramka stoi na ZEROWEJ liście wyjątków - i taka ma zostać.
 */
const NOT_SCANNED = new Set([GENERATED_TYPES, SELF]);

/**
 * Ślady hooka na access token. Trzy, bo hook można dowieźć pod dowolną nazwą:
 * zostaje sygnatura `(event jsonb)` wymagana przez Supabase Auth i grant
 * wykonania dla roli `supabase_auth_admin`, bez którego hook nigdy nie ruszy.
 */
const HOOK_MARKERS: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  { label: "custom_access_token", re: /custom_access_token/i },
  { label: "sygnatura (event jsonb)", re: /\(\s*event\s+jsonb\s*\)/i },
  { label: "supabase_auth_admin", re: /supabase_auth_admin/i },
];

/** Najemca wyprowadzony z claimów - w obie strony, bo kolejność zapisu bywa dowolna. */
const TENANT_FROM_CLAIMS = /claims[^\n]{0,80}tenant_id|tenant_id[^\n]{0,80}claims/;

/**
 * Linia, która SAMA jest komentarzem. Odsiewamy ją niezależnie od
 * `maskComments`, bo ten helper wchodzi w tryb łańcucha na pierwszym
 * niesparowanym apostrofie w PROZIE (polskie „TanStacka'a", „don't") i od tego
 * miejsca nie maskuje już nic do końca pliku - w `crm.functions.ts` gubi w ten
 * sposób cały ogon pliku razem z nagłówkiem, który OPISUJE naprawiany defekt.
 * Kod produkcyjny nie zaczyna się od `//` ani od `*`, więc reguła nie może
 * ukryć naruszenia; `maskComments` zostaje, bo łapie to, czego ta reguła nie
 * widzi: komentarz doklejony na końcu linii z kodem.
 */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name).replaceAll("\\", "/"));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** `plik:linia` dla każdej linii pasującej do wzorca (komentarze już zamaskowane). */
function hits(file: string, source: string, re: RegExp, skipComments = false): string[] {
  return source
    .split("\n")
    .map((line, index) => {
      if (skipComments && COMMENT_LINE.test(line)) return null;
      return re.test(line) ? `${file}:${index + 1}` : null;
    })
    .filter((hit): hit is string => hit !== null);
}

describe("brak claimu tenant_id - hook i jego czytelnicy", () => {
  const migrations = migrationFiles();
  const scanned = sourceFiles("src").filter((file) => !NOT_SCANNED.has(file));

  it("skan widzi migracje i źródła - kanarek zasięgu", () => {
    // Zmieniona ścieżka albo glob robi z obu asercji niżej ciche „zero trafień".
    expect({
      migracje: migrations.length >= 900,
      zrodla: scanned.length >= 2000,
    }).toEqual({ migracje: true, zrodla: true });
    // Wyjęte ze skanu pliki muszą istnieć - inaczej wyjątek przeżył plik.
    for (const file of NOT_SCANNED) expect(statSync(file).isFile()).toBe(true);
  });

  it("w repo nie ma hooka na access token - ani w config.toml, ani w migracjach", () => {
    const sources = [
      { file: CONFIG, source: readFileSync(CONFIG, "utf8") },
      ...migrations.map((file) => ({
        file,
        source: stripSqlComments(readFileSync(file, "utf8")),
      })),
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      HOOK_MARKERS.flatMap(({ label, re }) =>
        hits(file, source, re).map((hit) => `${hit} - ${label}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("żaden kod ani fixture nie wyprowadza najemcy z claimów tokenu", () => {
    const offenders = scanned.flatMap((file) =>
      hits(file, maskComments(readFileSync(file, "utf8")), TENANT_FROM_CLAIMS, true),
    );
    expect(offenders).toEqual([]);
  });
});
