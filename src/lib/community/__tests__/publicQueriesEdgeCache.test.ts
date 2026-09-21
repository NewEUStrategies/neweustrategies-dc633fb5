// @vitest-environment node
//
// CO DOWODZI TEN PLIK
//
// Dwie fabryki opcji z `publicQueries.ts` (lista /events i strona wydarzenia)
// stawiają PRZED odczytem z Supabase per-izolatowy cache TTL (`edgeTtlCache`).
// Cache jest wspólny dla całego izolata Workers, a izolat obsługuje żądania
// WSZYSTKICH najemców tej samej instalacji - więc źle zakresowany wpis nie
// byłby "starą treścią", tylko treścią CUDZEJ domeny wydaną na naszej.
//
// Siostrzany plik `publicQueries.test.ts` atrapuje `@/lib/ssrCache` i dowodzi
// KONTRAKTU WYWOŁANIA: jaki klucz i jaki TTL podaje miejsce wywołania. Tu
// dokładamy brakującą połowę - `edgeTtlCache` jest PRAWDZIWY, a atrapą jest
// host żądania. Dzięki temu widać SKUTEK: ile razy naprawdę poszliśmy do bazy
// i czy wpis rozgrzany na jednej domenie może wyjść na drugiej.
//
// GRANICA DOWODU. Sam mechanizm zakresowania (serve-stale, single-flight,
// generacje, limit wpisów) ma własny plik `src/lib/__tests__/ssrCacheHostScope.test.ts`
// i nie jest tu powtarzany. Tutaj pytamy wyłącznie o to, czy TE DWA miejsca
// wywołania korzystają z niego poprawnie. Izolacji danych i tak pilnuje RLS
// przez `public_tenant_id()` - cache jest drugą warstwą, nie pierwszą.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseFromStub } from "@/test/supabase";

const host = vi.hoisted(() => ({ value: null as string | null }));
const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(host.value),
  requestPublicHost: () => host.value,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  sb.from = fromStub;
  return {
    supabase: { from: fromStub.from, rpc: () => Promise.resolve({ data: null, error: null }) },
  };
});

import { ok } from "@/test/supabase";
import { publicEventRow } from "@/test/events/publicEventRow";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import {
  publicEventBySlugQueryOptions,
  publicEventsQueryOptions,
  type PublicEvent,
} from "@/lib/community/publicQueries";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("atrapa `from` nie została utworzona");
  return sb.from;
}

function runQueryFn<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

/** Odpowiedź "wydarzenie tego najemcy" - tytuł niesie host, żeby było widać czyje. */
function eventsOfHost(): void {
  db().setResponse("events", () => ok([publicEventRow({ title_pl: `Wydarzenie ${host.value}` })]));
}

beforeEach(() => {
  db().reset();
  clearEdgeTtlCache();
  host.value = null;
});

describe("TTL cache listy /events pod prawdziwym zakresowaniem po hoście", () => {
  it("drugi odczyt w oknie TTL nie idzie do bazy", async () => {
    host.value = "a.example";
    eventsOfHost();

    await runQueryFn<PublicEvent[]>(publicEventsQueryOptions());
    await runQueryFn<PublicEvent[]>(publicEventsQueryOptions());

    expect(db().chainsFor("events")).toHaveLength(1);
  });

  it("wpis rozgrzany na domenie A nie wychodzi na domenie B", async () => {
    eventsOfHost();

    host.value = "a.example";
    const forA = await runQueryFn<PublicEvent[]>(publicEventsQueryOptions());

    host.value = "b.example";
    const forB = await runQueryFn<PublicEvent[]>(publicEventsQueryOptions());

    expect(forA[0].title_pl).toBe("Wydarzenie a.example");
    expect(forB[0].title_pl).toBe("Wydarzenie b.example");
    expect(db().chainsFor("events")).toHaveLength(2);
  });

  it("praca w tle (bez hosta) ma własny zakres, nie zakres ostatniego najemcy", async () => {
    eventsOfHost();

    host.value = "a.example";
    await runQueryFn<PublicEvent[]>(publicEventsQueryOptions());

    host.value = null;
    const background = await runQueryFn<PublicEvent[]>(publicEventsQueryOptions());

    expect(background[0].title_pl).toBe("Wydarzenie null");
    expect(db().chainsFor("events")).toHaveLength(2);
  });
});

describe("TTL cache strony wydarzenia: klucz per slug I per host", () => {
  beforeEach(() => {
    db().setResponse("events", (chain) => {
      const slug = chain.argsOf("eq")?.[1];
      return ok(
        publicEventRow({
          slug: typeof slug === "string" ? slug : "nieznany",
          title_pl: `${String(slug)} @ ${String(host.value)}`,
        }),
      );
    });
  });

  it("dwa różne slugi to dwa wpisy, nie jeden nadpisany", async () => {
    host.value = "a.example";

    const first = await runQueryFn<PublicEvent | null>(
      publicEventBySlugQueryOptions("kongres-strategii"),
    );
    const second = await runQueryFn<PublicEvent | null>(
      publicEventBySlugQueryOptions("brukselskie-sniadanie"),
    );

    expect(first?.slug).toBe("kongres-strategii");
    expect(second?.slug).toBe("brukselskie-sniadanie");
    expect(db().chainsFor("events")).toHaveLength(2);
  });

  it("ten sam slug na dwóch domenach to dwa odczyty i dwie różne treści", async () => {
    host.value = "a.example";
    const forA = await runQueryFn<PublicEvent | null>(
      publicEventBySlugQueryOptions("kongres-strategii"),
    );

    host.value = "b.example";
    const forB = await runQueryFn<PublicEvent | null>(
      publicEventBySlugQueryOptions("kongres-strategii"),
    );

    expect(forA?.title_pl).toBe("kongres-strategii @ a.example");
    expect(forB?.title_pl).toBe("kongres-strategii @ b.example");
    expect(db().chainsFor("events")).toHaveLength(2);
  });

  it("powtórzony odczyt tego samego slugu na tej samej domenie idzie z cache'u", async () => {
    host.value = "a.example";

    await runQueryFn<PublicEvent | null>(publicEventBySlugQueryOptions("kongres-strategii"));
    await runQueryFn<PublicEvent | null>(publicEventBySlugQueryOptions("kongres-strategii"));

    expect(db().chainsFor("events")).toHaveLength(1);
  });
});
