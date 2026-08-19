// Komentarz gościa - `guest.functions.ts`, publiczny server fn, 0/2 funkcji.
//
// DLACZEGO TO JEST WARTE TESTU MIMO pgTAP-a. Trigger `comments_before_insert`
// jest źródłem prawdy dla ustawień dyskusji, podpisu, statusu moderacji
// i głębokości wątku - i ma własne asercje w bazie. Ale ta funkcja jest BRAMĄ
// WEJŚCIOWĄ dla ruchu ANONIMOWEGO i sama, po stronie serwera, rozstrzyga
// cztery rzeczy, których trigger nie widzi:
//
//   1. HONEYPOT. Bot, który wypełnił ukryte pole, dostaje ciche „ok" BEZ
//      zapisu. Cisza jest tu celem: komunikat o odrzuceniu powiedziałby
//      autorowi bota, że filtr istnieje i którym polem.
//   2. TENANT PINOWANY PO HOŚCIE. Wpis musi istnieć W TYM tenancie - bez tej
//      bramki host A dopisywałby komentarze do wpisów hosta B (trigger pinuje
//      tenant PO WPISIE, więc sam by tego nie złapał).
//   3. LIMIT PER IP, FAIL-CLOSED. Nieznane IP wpada do WSPÓLNEGO kubełka
//      zamiast omijać limit.
//   4. KOLEJNOŚĆ NAGŁÓWKÓW IP: `cf-connecting-ip` przed `x-forwarded-for`,
//      a z tego drugiego PIERWSZY wpis - reszta łańcucha jest sterowalna
//      przez klienta.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    tenantId: "tenant-alfa" as string | null,
    rateLimitOk: true,
    post: { id: "post-1" } as { id: string } | null,
    insertResult: { data: { status: "pending" }, error: null } as {
      data: { status: string } | null;
      error: { message: string } | null;
    },
    headers: new Map<string, string>(),
    throwOnRequest: false,
  },
  calls: {
    inserts: [] as Array<Record<string, unknown>>,
    rateLimits: [] as Array<{ scope: string; subjectId: string; max: number }>,
    postFilters: [] as Array<[string, unknown]>,
  },
  // Walidator i handler przechwycone z `createServerFn`. Muszą siedzieć
  // w bloku hoisted: fabryka `vi.mock` biegnie przy imporcie testowanego
  // modułu, czyli PRZED wykonaniem `let` w ciele pliku.
  fn: {
    validator: ((input: unknown) => input) as (input: unknown) => unknown,
    handler: (() => undefined) as (ctx: { data: unknown }) => unknown,
  },
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      validator(fn: (input: unknown) => unknown) {
        h.fn.validator = fn;
        return builder;
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        h.fn.handler = fn;
        return async (input: { data: unknown }) => fn({ data: h.fn.validator(input.data) });
      },
    };
    return builder;
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.state.throwOnRequest) throw new Error("brak kontekstu HTTP");
    return { headers: { get: (name: string) => h.state.headers.get(name) ?? null } };
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          if (table === "posts") h.calls.postFilters.push([column, value]);
          return chain;
        },
        is: () => chain,
        insert: (payload: Record<string, unknown>) => {
          h.calls.inserts.push(payload);
          return chain;
        },
        maybeSingle: async () => ({ data: h.state.post, error: null }),
        single: async () => h.state.insertResult,
      };
      return chain;
    },
  },
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => h.state.tenantId,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => "nes.test" }));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (args: { scope: string; subjectId: string; max: number }) => {
    h.calls.rateLimits.push(args);
    return h.state.rateLimitOk;
  },
}));

import "@/lib/comments/guest.functions";

const VALID = {
  postId: "11111111-1111-4111-8111-111111111111",
  body: "Treść komentarza gościa",
  authorName: "Jan Kowalski",
};

/** Wywołanie handlera po walidacji, tak jak zrobiłby to framework. */
async function submit(input: Record<string, unknown>) {
  return h.fn.handler({ data: h.fn.validator(input) }) as Promise<{ ok: true; status: string }>;
}

beforeEach(() => {
  h.state.tenantId = "tenant-alfa";
  h.state.rateLimitOk = true;
  h.state.post = { id: "post-1" };
  h.state.insertResult = { data: { status: "pending" }, error: null };
  h.state.headers = new Map();
  h.state.throwOnRequest = false;
  h.calls.inserts.length = 0;
  h.calls.rateLimits.length = 0;
  h.calls.postFilters.length = 0;
});

describe("walidacja wejścia", () => {
  it("odrzuca identyfikator wpisu, który nie jest UUID", () => {
    expect(() => h.fn.validator({ ...VALID, postId: "nie-uuid" })).toThrow();
  });

  it("odrzuca pustą treść i treść powyżej 5000 znaków", () => {
    expect(() => h.fn.validator({ ...VALID, body: "   " })).toThrow();
    expect(() => h.fn.validator({ ...VALID, body: "a".repeat(5001) })).toThrow();
  });

  it("odrzuca podpis krótszy niż dwa znaki i dłuższy niż 80", () => {
    expect(() => h.fn.validator({ ...VALID, authorName: "J" })).toThrow();
    expect(() => h.fn.validator({ ...VALID, authorName: "J".repeat(81) })).toThrow();
  });

  it("przycina treść i podpis", () => {
    const parsed = h.fn.validator({ ...VALID, body: "  Treść  ", authorName: "  Jan  " }) as {
      body: string;
      authorName: string;
    };

    expect(parsed.body).toBe("Treść");
    expect(parsed.authorName).toBe("Jan");
  });

  it("puste wejście odrzuca bez wyjątku typu (walidator dostaje `{}`)", () => {
    expect(() => h.fn.validator(undefined)).toThrow();
  });
});

describe("honeypot", () => {
  it("wypełnione ukryte pole daje ciche 'ok' BEZ zapisu", async () => {
    const result = await submit({ ...VALID, website: "https://spam.example" });

    // Cisza jest celem: komunikat o odrzuceniu powiedziałby autorowi bota,
    // że filtr istnieje i którym polem.
    expect(result).toEqual({ ok: true, status: "pending" });
    expect(h.calls.inserts).toHaveLength(0);
    expect(h.calls.rateLimits).toHaveLength(0);
  });

  it("PUSTE ukryte pole to zwykły człowiek - zapis idzie dalej", async () => {
    await submit({ ...VALID, website: "" });

    expect(h.calls.inserts).toHaveLength(1);
  });

  it("ukryte pole z samych spacji też przepuszcza (człowiek, nie bot)", async () => {
    await submit({ ...VALID, website: "   " });

    expect(h.calls.inserts).toHaveLength(1);
  });
});

describe("bramka tenanta", () => {
  it("nierozpoznany host przerywa PRZED limitem i przed zapisem", async () => {
    h.state.tenantId = null;

    await expect(submit(VALID)).rejects.toThrow("tenant unresolved");
    expect(h.calls.rateLimits).toHaveLength(0);
    expect(h.calls.inserts).toHaveLength(0);
  });

  it("wpis musi istnieć W TYM tenancie, być opublikowany i nieusunięty", async () => {
    await submit(VALID);

    // Trigger pinuje tenant PO WPISIE, więc bez tej bramki host A dopisywałby
    // komentarze do wpisów hosta B.
    expect(h.calls.postFilters).toContainEqual(["id", VALID.postId]);
    expect(h.calls.postFilters).toContainEqual(["tenant_id", "tenant-alfa"]);
    expect(h.calls.postFilters).toContainEqual(["status", "published"]);
  });

  it("wpis spoza tenanta (brak wiersza) przerywa bez zapisu", async () => {
    h.state.post = null;

    await expect(submit(VALID)).rejects.toThrow("post not found");
    expect(h.calls.inserts).toHaveLength(0);
  });
});

describe("limit per IP", () => {
  it("nagłówek cf-connecting-ip ma pierwszeństwo", async () => {
    h.state.headers.set("cf-connecting-ip", "203.0.113.7");
    h.state.headers.set("x-forwarded-for", "198.51.100.1, 10.0.0.1");

    await submit(VALID);

    expect(h.calls.rateLimits[0]).toEqual({
      scope: "comments.guest",
      subjectId: "203.0.113.7",
      max: 3,
    });
  });

  it("z x-forwarded-for bierze PIERWSZY wpis - reszta łańcucha jest sterowalna", async () => {
    h.state.headers.set("x-forwarded-for", "198.51.100.1, 10.0.0.1, 172.16.0.1");

    await submit(VALID);

    expect(h.calls.rateLimits[0]?.subjectId).toBe("198.51.100.1");
  });

  it("x-forwarded-for jest przycinany z białych znaków", async () => {
    h.state.headers.set("x-forwarded-for", "   198.51.100.9   , 10.0.0.1");

    await submit(VALID);

    expect(h.calls.rateLimits[0]?.subjectId).toBe("198.51.100.9");
  });

  it("BRAK nagłówków: wspólny kubełek 'unknown-ip' (fail-closed)", async () => {
    await submit(VALID);

    // Nieznane IP nie może OMIJAĆ limitu - wpada do jednego wspólnego wiadra
    // razem z resztą nierozpoznanego ruchu.
    expect(h.calls.rateLimits[0]?.subjectId).toBe("unknown-ip");
  });

  it("brak kontekstu HTTP też schodzi na wspólny kubełek, nie wywraca żądania", async () => {
    h.state.throwOnRequest = true;

    await expect(submit(VALID)).resolves.toBeDefined();
    expect(h.calls.rateLimits[0]?.subjectId).toBe("unknown-ip");
  });

  it("przekroczony limit przerywa PRZED zapytaniem o wpis i przed zapisem", async () => {
    h.state.rateLimitOk = false;

    await expect(submit(VALID)).rejects.toThrow("rate limited");
    expect(h.calls.postFilters).toHaveLength(0);
    expect(h.calls.inserts).toHaveLength(0);
  });
});

describe("zapis i status", () => {
  it("wiersz gościa ma user_id NULL i podpis z formularza", async () => {
    await submit({ ...VALID, parentId: "22222222-2222-4222-8222-222222222222" });

    expect(h.calls.inserts[0]).toEqual({
      post_id: VALID.postId,
      user_id: null,
      author_name: VALID.authorName,
      parent_id: "22222222-2222-4222-8222-222222222222",
      body: VALID.body,
    });
  });

  it("brak rodzica zapisuje się jako NULL", async () => {
    await submit(VALID);

    expect(h.calls.inserts[0]?.parent_id).toBeNull();
  });

  it("status 'approved' z triggera wraca jako approved", async () => {
    h.state.insertResult = { data: { status: "approved" }, error: null };

    expect(await submit(VALID)).toEqual({ ok: true, status: "approved" });
  });

  it("KAŻDY inny status z triggera wraca jako 'pending'", async () => {
    for (const status of ["pending", "spam", "cokolwiek"]) {
      h.state.insertResult = { data: { status }, error: null };
      expect((await submit(VALID)).status).toBe(status === "approved" ? "approved" : "pending");
    }
  });

  it("komunikat triggera wraca 1:1 - klient mapuje go na przyjazne copy", async () => {
    h.state.insertResult = { data: null, error: { message: "comments: auth required" } };

    await expect(submit(VALID)).rejects.toThrow("comments: auth required");
  });
});
