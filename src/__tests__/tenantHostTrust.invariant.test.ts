/**
 * Bramka inwariantu: NAGŁÓWEK `x-tenant-host` NIE JEST DOWODEM NICZEGO.
 *
 * PRZYCZYNA ŹRÓDŁOWA (audyt 05.08, §4.1 - "utwardzenie opisane jak pełne,
 * a chroniące tylko SSR"). Utwardzenie z 02.08 postawiło walidację hosta na
 * KRAWĘDZI (`pickTrustedHost`) i to jest realne - ale obowiązuje wyłącznie dla
 * żądań idących przez SSR. `request_public_host()` w bazie czytał
 * `request.headers ->> 'x-tenant-host'` WPROST, więc klient z publicznym kluczem
 * anon wołał PostgREST bezpośrednio i podawał domenę innego tenanta.
 *
 * Naprawa (20260805090000) jest STRUKTURALNA i właśnie dlatego wymaga bramki:
 * jej sedno to jedna reguła w jednym miejscu (niepoświadczona deklaracja nie
 * przenosi ZALOGOWANEGO wołającego do obcego tenanta), a jedna migracja
 * `CREATE OR REPLACE` potrafi ją cofnąć bez śladu w diffie funkcji obok.
 * Migracje są forward-only, więc liczy się OSTATNIA definicja - nie fakt, że
 * migracja naprawcza istnieje.
 *
 * Test jest statyczny (bez bazy). Zachowanie runtime pilnuje pgTAP
 * (supabase/tests/tenant_host_assertion_test.sql).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { extractLatestDefinitions, type FnDef } from "../../scripts/lib/sqlMigrations";

const LATEST = extractLatestDefinitions();

function latest(name: string, arity = 0): FnDef {
  const def = LATEST.get(`public.${name}/${arity}`);
  expect(def, `brak funkcji public.${name}/${arity} w migracjach`).toBeDefined();
  return def!;
}

/** Surowy odczyt nagłówka hosta - dokładnie ten wzorzec, który był problemem. */
const RAW_HEADER_READ = /request\.headers[\s\S]{0,80}?x-tenant-host/i;

describe("szczeble zaufania hosta: stan końcowy migracji", () => {
  it("request_public_host() NIE czyta nagłówka wprost", () => {
    const def = latest("request_public_host");
    expect(
      RAW_HEADER_READ.test(def.body),
      `${def.file}: request_public_host() znów czyta x-tenant-host wprost. ` +
        "To jest dokładnie ustalenie §4.1: przez PostgREST klient z kluczem anon " +
        "podaje wtedy domenę innego tenanta. Surowa deklaracja ma zostać w " +
        "request_asserted_host(), a request_public_host() ma zwracać host ZAUFANY.",
    ).toBe(false);
  });

  it("request_public_host() opiera się na poświadczeniu i na katalogu domen", () => {
    const def = latest("request_public_host");
    expect(def.body).toMatch(/request_verified_host\s*\(/i);
    expect(
      def.body,
      "bez sprawdzenia w katalogu tenantów deklaracja spoza katalogu znów by przeszła",
    ).toMatch(/tenant_id_for_public_host\s*\(/i);
  });

  it("surowa deklaracja jest wydzielona i NAZWANA jako niezaufana", () => {
    // Nazwa jest częścią zabezpieczenia: `request_asserted_host()` czyta się
    // jako deklaracja, a `request_public_host()` jako host zaufany. Gate
    // check:sql-tenant-scope pilnuje, żeby żadna ścieżka autoryzacji nie mieszała
    // pierwszej z rolami.
    const def = latest("request_asserted_host");
    expect(def.body).toMatch(RAW_HEADER_READ);
  });

  it("public_tenant_id() PRZYPINA zalogowanego wołającego do tenanta domowego", () => {
    const def = latest("public_tenant_id");
    expect(def.attrs).toMatch(/SECURITY\s+DEFINER/i);
    expect(def.body).toMatch(/request_verified_host\s*\(/i);
    expect(
      def.body,
      "brak auth.uid() w ciele = brak rozróżnienia anon/zalogowany, czyli nagłówek " +
        "znów przenosi zalogowanego użytkownika do obcego tenanta",
    ).toMatch(/auth\.uid\s*\(/i);
    expect(
      def.body,
      "brak current_tenant_id() = nie ma do czego przypiąć zalogowanego wołającego",
    ).toMatch(/current_tenant_id\s*\(/i);
  });

  it("weryfikacja poświadczenia jest SECURITY DEFINER i nie rzuca", () => {
    const def = latest("verify_tenant_host_assertion", 1);
    expect(def.attrs).toMatch(/SECURITY\s+DEFINER/i);
    // Funkcja jest wołana z polityk RLS i z DEFAULT-ów kolumn: wyjątek zamieniłby
    // spoofowalny nagłówek na wektor DoS na cały plan anon.
    expect(def.body).toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    expect(def.attrs).toMatch(/search_path\s*=\s*public,\s*extensions/i);
  });

  it("sekret podpisujący nie jest dostępny rolom klienckim", () => {
    const migrationSql = readFileSync(
      "supabase/migrations/20260805090000_tenant_host_assertion_hardening.sql",
      "utf8",
    );
    expect(migrationSql).toMatch(
      /ALTER\s+TABLE\s+public\.tenant_host_assertion_keys\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    expect(migrationSql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.tenant_host_assertion_keys\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    // Materiał klucza leży w Vault, nie w kolumnie tekstowej tabeli.
    expect(migrationSql).toMatch(/vault\.create_secret/);
    expect(migrationSql).toMatch(/vault\.decrypted_secrets/);
  });
});

describe("plan anon wysyła poświadczenie", () => {
  const fetchWrapper = readFileSync("src/integrations/supabase/tenant-host-fetch.ts", "utf8");

  it("fetch klienta anon dokłada nagłówek poświadczenia", () => {
    // Bez tego szczebel VERIFIED byłby martwy: każde żądanie z przeglądarki
    // i z SSR trafiałoby do bazy jako sama deklaracja.
    expect(fetchWrapper).toMatch(/TENANT_ASSERTION_HEADER/);
    expect(fetchWrapper).toMatch(/currentTenantAssertion/);
  });

  it("nagłówki po stronie TS i SQL nazywają się tak samo", () => {
    const contract = readFileSync("src/lib/http/tenantAssertion.ts", "utf8");
    const migrationSql = readFileSync(
      "supabase/migrations/20260805090000_tenant_host_assertion_hardening.sql",
      "utf8",
    );
    const header = /TENANT_ASSERTION_HEADER\s*=\s*"([^"]+)"/.exec(contract)?.[1];
    expect(header, "brak stałej nagłówka w kontrakcie TS").toBeTruthy();
    expect(
      migrationSql.includes(`'${header}'`),
      `baza nie czyta nagłówka ${header} - kontrakt TS i SQL się rozjechały`,
    ).toBe(true);
  });

  it("cookie transportowe jest doklejane POWYŻEJ cache'a dokumentów", () => {
    // Ta sama doktryna co gpcMiddleware: Set-Cookie musi powstawać PO
    // odtworzeniu wpisu z cache'a, inaczej poświadczenie jednego hosta trafia
    // do dokumentu zapisanego dla innego.
    const start = readFileSync("src/start.ts", "utf8");
    const assertionAt = start.indexOf("tenantAssertionMiddleware,");
    const cacheAt = start.indexOf("documentCacheMiddleware,");
    expect(assertionAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(-1);
    expect(
      assertionAt,
      "tenantAssertionMiddleware musi być POWYŻEJ documentCacheMiddleware w liście",
    ).toBeLessThan(cacheAt);
  });
});
