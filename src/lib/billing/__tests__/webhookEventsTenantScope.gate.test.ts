// Bramka: dziennik webhooków płatniczych nie może być czytany spod klucza
// serwisowego bez jawnej granicy najemcy.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// `payment_webhook_events` ma kolumnę `tenant_id` (NOT NULL, nadawaną triggerem
// `payment_webhook_events_bind_tenant`) i politykę RLS `tenant_id =
// current_tenant_id() AND is_super_admin()`. Ta polityka nie chroni jednak
// NICZEGO na ścieżkach serwerowych, bo wszystkie czytają `supabaseAdmin` -
// klienta service-role, którego własny nagłówek mówi „bypasses RLS". Dla tych
// zapytań polityka nie biegnie, a jedyną granicą obszaru roboczego zostaje
// filtr wpisany ręcznie w łańcuchu.
//
// Do 13.09.2026 `webhookRetry.functions.ts` filtrował WYŁĄCZNIE po `id` wiersza
// wziętym z ciała żądania. Skutek nie był teoretyczny: kolumna `payload` trzyma
// surowe zdarzenie operatora (adres, e-mail i kwoty kupującego), a ponowienie
// ODTWARZA jego skutki - nadaje uprawnienie i wysyła mail w cudzym obszarze,
// zostawiając w cudzym audycie własne `retried_by`. Identyfikatory nie były przy
// tym barierą: RPC `admin_payment_webhook_health` oddaje `recent_failures[].id`
// każdemu adminowi, bez filtra najemcy.
//
// ── CZEGO NIE DUBLUJE ──────────────────────────────────────────────────────
// `check:sql-tenant-scope` i `check:sql-owner-tenant-scope` czytają wyłącznie
// SQL; pgTAP dowodzi polityk, które service role omija. Bramka
// `src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` pokrywa dokładnie
// ten inwariant, ale skanuje `src/lib/server/**` i `src/lib/*.server.ts` - i mówi
// wprost, że `lib/billing/**` zostawia poza zakresem. Dla tej tabeli nie było
// więc w CI niczego.
//
// ── DLACZEGO JEDNA TABELA, A NIE CAŁY KATALOG ──────────────────────────────
// Rozszerzenie tamtej bramki na `src/lib/billing` wygląda na tańsze, ale
// mierzone jej własnym analizatorem katalog ma 138 zapytań service-role, z czego
// 114 bez filtru najemcy - i większość z nich jest globalna ZE SŁUSZNYCH powodów
// (uzgadnianie z operatorem, synchronizacja katalogu cen, numeracja faktur).
// Bramka ze 114 wyjątkami nie jest bramką, tylko listą wymówek. Zakres zawężony
// do jednej tabeli - tej, której wiersze mają ładunek i są adresowalne
// identyfikatorem od klienta - broni się sam i zostaje czerwony tam, gdzie boli.
//
// ── WYJĄTKI SĄ DECYZJĄ ─────────────────────────────────────────────────────
// Klucz wyjątku to para plik+tabela, nie sama tabela: zgoda na brak filtru
// dotyczy JEDNEGO miejsca. Dwa ostatnie testy pilnują higieny listy - wpis bez
// trafienia i wpis dla zapytania, które MA filtr, są błędem, bo martwy wyjątek
// to przyszła furtka dla następnego zapytania na tej tabeli w tym pliku.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  exemptionKey,
  tableQueries,
  usesServiceRole,
  type ScannedSource,
  type TableQuery,
} from "@/lib/ci/serviceRoleTenantScope";

const DIR = "src/lib/billing";
const TABLE = "payment_webhook_events";

/**
 * Pliki katalogu, które sięgają po `supabaseAdmin`. Podkatalog `__tests__`
 * odpada na filtrze rozszerzenia - atrapy testowe nie są powierzchnią zapytań.
 */
function billingSources(): ScannedSource[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => ({ file: `${DIR}/${name}`, source: readFileSync(`${DIR}/${name}`, "utf8") }))
    .filter((s) => usesServiceRole(s.source));
}

/**
 * REJESTR PLIKÓW SIĘGAJĄCYCH PO DZIENNIK. Przypięty, bo dopisanie kolejnego
 * czytnika tej tabeli jest momentem, w którym trzeba świadomie zdecydować
 * o zakresie najemcy. Rozjazd w OBIE strony jest błędem: plik, który zniknął,
 * albo przestał czytać dziennik (wpis do usunięcia), albo bramka go już nie
 * widzi - na przykład po zmianie nazwy `supabaseAdmin`.
 */
const READERS = [
  `${DIR}/audit.server.ts`,
  `${DIR}/diagnostics.server.ts`,
  `${DIR}/reconcile.server.ts`,
  `${DIR}/webhookLog.server.ts`,
  `${DIR}/webhookRetry.functions.ts`,
] as const;

/**
 * Zapytania świadomie bez filtru najemcy. Każde z trzech miejsc ma inny powód
 * i w żadnym nie chodzi o „nie zdążyliśmy" - dopisanie tu filtru byłoby
 * defektem, a nie utwardzeniem.
 */
const EXEMPTIONS: Readonly<Record<string, string>> = {
  [exemptionKey(`${DIR}/webhookLog.server.ts`, TABLE)]:
    "pisarz dziennika: klucz naturalny (event_id, environment) jest unikalny globalnie, a najemcę nadaje trigger payment_webhook_events_bind_tenant; nie ma tu identyfikatora od klienta, a filtr mógłby ukryć duplikat i rozbić idempotencję",
  [exemptionKey(`${DIR}/reconcile.server.ts`, TABLE)]:
    "uzgadnianie z operatorem: konto Stripe jest per ŚRODOWISKO, nie per najemca (stripe.server.ts), więc zawężenie do jednego najemcy oznaczyłoby cudze zdarzenia jako event_missing i zaproponowało ich „naprawę”",
  [exemptionKey(`${DIR}/diagnostics.server.ts`, TABLE)]:
    "sonda zdrowia odbiornika operatora: liczniki, lastEventAt i średni czas obsługi - bez ładunku i bez identyfikatorów wierszy",
};

function keyOf(query: TableQuery): string {
  return exemptionKey(query.file, query.table);
}

describe("zakres najemcy dla dziennika payment_webhook_events", () => {
  const sources = billingSources();
  const queries = sources.flatMap((s) => tableQueries(s)).filter((q) => q.table === TABLE);
  const seen = new Set(queries.map(keyOf));
  const unscoped = queries.filter((q) => q.verdict === "UNSCOPED");

  const gaps = unscoped.filter((q) => !(keyOf(q) in EXEMPTIONS));
  const usedExemptions = [...new Set(unscoped.filter((q) => keyOf(q) in EXEMPTIONS).map(keyOf))];
  const redundantExemptions = [
    ...new Set(queries.filter((q) => q.verdict === "SCOPED" && keyOf(q) in EXEMPTIONS).map(keyOf)),
  ];
  const staleExemptions = Object.keys(EXEMPTIONS).filter((k) => !seen.has(k));

  it("skan realnie widzi zapytania do dziennika - kanarek zasięgu", () => {
    // Bez kanarka bramka po zmianie nazwy klienta serwisowego albo po
    // przeniesieniu modułu robi się pusta i zielona - czyli najgorszy możliwy
    // stan: dowód, którego nie ma, ale który wygląda jak dowód.
    expect(queries.length).toBeGreaterThanOrEqual(10);
    expect([...new Set(queries.map((q) => q.file))].sort()).toEqual([...READERS]);
  });

  it("każde zapytanie do dziennika ma granicę najemcy albo jawny wyjątek", () => {
    expect(
      gaps.map((g) => `${g.file}:${g.line} from("${g.table}") - brak granicy najemcy`),
    ).toEqual([]);
  });

  it("lista wyjątków nie zawiera wpisów bez trafienia", () => {
    // Martwy wyjątek to przyszła furtka: nazwa zostaje, a wraz z nią zgoda na
    // brak filtru dla miejsca, którego już nikt nie pamięta.
    expect(staleExemptions).toEqual([]);
    expect(usedExemptions.sort()).toEqual(Object.keys(EXEMPTIONS).sort());
  });

  it("lista wyjątków nie zwalnia zapytań, które MAJĄ filtr", () => {
    // Wyjątek dla pliku, który już filtruje, osłabia bramkę na przyszłość:
    // kolejne zapytanie na tej tabeli w tym pliku przejdzie bez filtru
    // i nikt tego nie zobaczy.
    expect(redundantExemptions).toEqual([]);
  });

  it("ponowienie i podgląd ładunku filtrują po najemcy - trzy zapytania, trzy filtry", () => {
    // Przypięte osobno od raportu zbiorczego, bo to JEST naprawiony defekt:
    // wszystkie trzy zapytania `webhookRetry.functions.ts` (odczyt wiersza,
    // zapis wyniku ponowienia, podgląd ładunku) muszą nieść granicę. Wartość
    // filtru ma pochodzić z `tenantId` przypiętego z profilu wywołującego -
    // analizator odrzuca `.eq("tenant_id", row.tenant_id)`, bo porównanie
    // wiersza z samym sobą nie jest granicą.
    const retry = queries.filter((q) => q.file === `${DIR}/webhookRetry.functions.ts`);
    expect(retry).toHaveLength(3);
    expect(retry.map((q) => q.verdict)).toEqual(["SCOPED", "SCOPED", "SCOPED"]);
    expect(retry.map((q) => q.evidence)).toEqual([
      '.eq("tenant_id", tenantId)',
      '.eq("tenant_id", tenantId)',
      '.eq("tenant_id", tenantId)',
    ]);
  });
});
