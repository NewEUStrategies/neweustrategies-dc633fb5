// `updatePost` - główna ścieżka zapisu wpisu (ok. 300 linii, najgęstsza
// funkcja sekcji treści). Osobny plik, bo to osobna maszyna stanowa: siedem
// bramek po kolei, z których KAŻDA potrafi przerwać zapis.
//
// CO MA TU DOWÓD:
//   1. pre-read idzie przez service_role, ale ZAWSZE z filtrem tenanta -
//      inaczej autozapis czytałby ciało cudzego wpisu,
//   2. optimistic-lock w DWÓCH warstwach (wczesny na pre-readzie + atomowy
//      `.eq("updated_at")` na UPDATE) i w obu porównanie INSTANTÓW, nie ciągów,
//      z awaryjnym powrotem do porównania tekstowego dla nieparsowalnej daty,
//   3. cicha odmowa RLS (0 wierszy, error=null) jest ODRÓŻNIANA od konfliktu
//      edycji i w obu przypadkach kończy się wyjątkiem, nie fałszywym „Zapisano",
//   4. izolacja najemcy dla `organization_id` przyniesionego OD KLIENTA,
//   5. bramka ujawnienia komercyjnego czyta STAN PO SCALENIU (existing + patch),
//      wyłącznie dla materiału publicznie czytelnego (published/scheduled),
//   6. `published_at` stemplowany DOKŁADNIE RAZ, `publish_at` zerowany przy
//      zejściu z harmonogramu,
//   7. best-effort: migawka rewizji i zapis przekierowania 301 mogą PADAĆ, a
//      zapis treści MUSI się udać (to jest kontrakt, nie niedoróbka),
//   8. czteropozycyjny wybór akcji audytu (update / publish / schedule /
//      review.submit).
//
// CZEGO TU NIE MA. RLS-a nie dowodzimy atrapą - atrapa dowiodłaby tylko, że
// atrapa działa; polityki mają pgTAP w `supabase/tests`. Reguł domenowych
// (`evaluateTransition`, `isFirstPublish`, `disclosureGaps`, `shouldSnapshot`)
// nie powtarzamy - mają własne testy jednostkowe; tutaj biegną PRAWDZIWE i
// sprawdzamy WYWOŁANIE ich w odpowiednim momencie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_VOICE_ID,
  BASE_TS,
  NEXT_TS,
  ORG_ID,
  OTHER_PARENT_ID,
  OTHER_POST_ID,
  PARENT_PAGE_ID,
  POST_ID,
  TENANT,
  USER,
  contentClient,
  entityTable,
  fail,
  ok,
  postRow,
  taxonomyTables,
  type ContentClient,
  type ServerFnSpec,
} from "./contentFunctionsHarness";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("./contentFunctionsHarness");
  return { createServerFn: createServerFnStub, createMiddleware: () => ({}) };
});
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));

const server = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock("@/lib/server/rate-limit.server", async () => {
  const { vi: v } = await import("vitest");
  return { rateLimit: v.fn(async (_opts: unknown) => true) };
});
vi.mock("@/lib/server/audit.server", async () => {
  const { vi: v } = await import("vitest");
  return { recordAudit: v.fn(async (_client: unknown, _params: unknown) => undefined) };
});
// Kolumny ciała są odebrane roli `authenticated`, więc pre-read idzie przez
// service_role. Atrapa musi to odwzorować, bo inaczej test nie zobaczyłby, że
// odczyt biegnie INNĄ drogą niż zapis. Kod importuje ten moduł DYNAMICZNIE i
// dwa razy (pre-read + sprawdzenie organizacji) - atrapa musi to znieść.
vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const admin = supabaseFromStub();
  server.admin = admin;
  return { supabaseAdmin: { from: admin.from } };
});

import { rateLimit as rateLimitFn } from "@/lib/server/rate-limit.server";
import { recordAudit as recordAuditFn } from "@/lib/server/audit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const rateLimit = rateLimitFn as unknown as ReturnType<typeof vi.fn>;
const recordAudit = recordAuditFn as unknown as ReturnType<typeof vi.fn>;
const admin = server.admin as SupabaseFromStub;

type PostRow = Database["public"]["Tables"]["posts"]["Row"];
type PostFields = Record<string, unknown>;

async function updatePostSpec(): Promise<ServerFnSpec> {
  const mod = await import("@/lib/content.functions");
  return mod.updatePost as unknown as ServerFnSpec;
}

interface RunInput {
  id?: string;
  fields?: PostFields;
  categories?: string[];
  tags?: string[];
  programs?: string[];
  regions?: string[];
  baseUpdatedAt?: string;
}

async function run(input: RunInput, client: ContentClient) {
  const spec = await updatePostSpec();
  const data = spec.validator?.({ id: POST_ID, fields: {}, ...input });
  // `context` to dokładnie to, co wstrzykuje middleware `requireStaff`.
  return spec.handler?.({ data, context: { supabase: client.supabase, userId: USER } });
}

/** Migawki rewizji: cztery różne zapytania do jednej tabeli. */
function revisionsTable(
  cfg: { last?: string | null; overflow?: string[]; insertResult?: SupabaseResult } = {},
) {
  return (chain: RecordedChain): SupabaseResult => {
    if (chain.has("delete")) return ok(null);
    if (chain.has("insert")) return cfg.insertResult ?? ok(null);
    if (chain.has("range")) return ok((cfg.overflow ?? []).map((id) => ({ id })));
    return ok(cfg.last ? { created_at: cfg.last } : null);
  };
}

/** Domyślne, ZDROWE otoczenie: wpis istnieje, RLS przepuszcza, limity wolne. */
function scene(
  opts: {
    existing?: Partial<PostRow>;
    canPublish?: boolean;
    posts?: Parameters<typeof entityTable>[0];
    revisions?: Parameters<typeof revisionsTable>[0];
  } = {},
) {
  const client = contentClient({ canPublish: opts.canPublish });
  const existing = postRow(opts.existing);
  admin.setResponse("posts", ok(existing));
  admin.setResponse("crm_companies", ok({ id: ORG_ID }));
  client.db.setResponse("posts", entityTable(opts.posts));
  client.db.setResponse("content_revisions", revisionsTable(opts.revisions));
  client.db.setResponse("redirects", ok(null));
  taxonomyTables(client.db);
  return { client, existing };
}

function auditParams(): Record<string, unknown> {
  const call = recordAudit.mock.calls.at(-1) as [unknown, Record<string, unknown>] | undefined;
  return call?.[1] ?? {};
}

/** Patch faktycznie wysłany do UPDATE-a wpisu (bez „touch" taksonomii). */
function savedPatch(db: SupabaseFromStub): Record<string, unknown> {
  const chain = db
    .chainsFor("posts")
    .filter((c) => c.has("update"))
    .find((c) => {
      const patch = c.argsOf("update")?.[0] as Record<string, unknown> | undefined;
      return !(patch && Object.keys(patch).length === 1 && "updated_at" in patch);
    });
  return (chain?.argsOf("update")?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  admin.reset();
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
  recordAudit.mockReset();
  recordAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe("bramki wstępne", () => {
  it("przekroczony rate limit RZUCA i nie dotyka bazy", async () => {
    rateLimit.mockResolvedValue(false);
    const { client } = scene();
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow("Rate limit exceeded");
    expect(client.db.chainsFor("profiles")).toHaveLength(0);
    expect(admin.chainsFor("posts")).toHaveLength(0);
  });

  it("woła limiter z zakresem post.update i pułapem 120", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A" } }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "post.update", subjectId: USER, max: 120 });
  });

  it("brak tenanta w profilu przerywa PRZED odczytem wpisu", async () => {
    const client = contentClient({ tenant: null });
    admin.setResponse("posts", ok(postRow()));
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow(
      "No tenant for current user",
    );
    expect(admin.chainsFor("posts")).toHaveLength(0);
  });

  it("błąd zapytania o profil też przerywa (nie zakłada braku tenanta)", async () => {
    const client = contentClient({ tenantError: true });
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow(
      "No tenant for current user",
    );
  });
});

describe("pre-read przez service_role", () => {
  it("czyta CAŁY wiersz z filtrem id ORAZ tenanta", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A" } }, client);
    const chain = admin.lastChain("posts");
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", POST_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("wpis z innego obszaru roboczego = brak wiersza = odmowa", async () => {
    const { client } = scene();
    admin.setResponse("posts", ok(null));
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow(
      "Post not found or access denied",
    );
    expect(client.db.chainsFor("posts")).toHaveLength(0);
  });

  it("błąd pre-readu propaguje komunikatem bazy", async () => {
    const { client } = scene();
    admin.setResponse("posts", fail("body columns denied"));
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow("body columns denied");
  });
});

describe("optimistic-lock", () => {
  it("ten sam INSTANT w innym zapisie tekstowym NIE jest konfliktem", async () => {
    // Postgres serializuje timestamptz różnie zależnie od drogi odczytu
    // (RPC vs PostgREST). Porównanie surowych ciągów dawało tu fałszywe
    // EDIT_CONFLICT jeszcze przed próbą atomowego UPDATE-a.
    const { client } = scene({ existing: { updated_at: "2026-08-20T10:00:00.000Z" } });
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: "2026-08-20T12:00:00+02:00" }, client),
    ).resolves.toMatchObject({ ok: true });
  });

  it("inny instant to EDIT_CONFLICT jeszcze przed UPDATE-em", async () => {
    const { client } = scene();
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: NEXT_TS }, client),
    ).rejects.toThrow("EDIT_CONFLICT");
    expect(client.db.chainsFor("posts").filter((c) => c.has("update"))).toHaveLength(0);
  });

  it("nieparsowalny znacznik spada do porównania SUROWYCH ciągów", async () => {
    const nieData = "wersja-3";
    const zgodny = scene({ existing: { updated_at: nieData } });
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: nieData }, zgodny.client),
    ).resolves.toMatchObject({ ok: true });

    const rozny = scene({ existing: { updated_at: nieData } });
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: "wersja-2" }, rozny.client),
    ).rejects.toThrow("EDIT_CONFLICT");
  });

  it("UPDATE dokłada ATOMOWY guard .eq(updated_at) tylko gdy klient podał bazę", async () => {
    const zBaza = scene();
    await run({ fields: { title_pl: "A" }, baseUpdatedAt: BASE_TS }, zBaza.client);
    const guarded = zBaza.client.db.chainsFor("posts").find((c) => c.has("update"));
    expect(guarded?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", POST_ID],
      ["updated_at", BASE_TS],
    ]);

    const bezBazy = scene();
    await run({ fields: { title_pl: "A" } }, bezBazy.client);
    const plain = bezBazy.client.db.chainsFor("posts").find((c) => c.has("update"));
    expect(plain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", POST_ID],
    ]);
  });

  it("0 wierszy + wiersz NADAL widoczny = konflikt edycji (wyścig)", async () => {
    const { client } = scene({
      posts: { updated: ok([]), stillVisible: ok({ id: POST_ID }) },
    });
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: BASE_TS }, client),
    ).rejects.toThrow("EDIT_CONFLICT");
  });

  it("0 wierszy + wiersz NIEwidoczny = odmowa RLS, nie konflikt", async () => {
    const { client } = scene({ posts: { updated: ok([]), stillVisible: ok(null) } });
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: BASE_TS }, client),
    ).rejects.toThrow("you do not have permission to edit this post");
  });

  it("0 wierszy bez baseUpdatedAt to od razu odmowa (bez dodatkowego odczytu)", async () => {
    const { client } = scene({ posts: { updated: ok([]) } });
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow(
      "you do not have permission to edit this post",
    );
    expect(client.db.chainsFor("posts").filter((c) => c.has("maybeSingle"))).toHaveLength(0);
  });

  it("błąd UPDATE-a propaguje komunikatem bazy", async () => {
    const { client } = scene({ posts: { updated: fail("posts_slug_key") } });
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow("posts_slug_key");
  });

  it("zwraca updatedAt z zapisu, by klient przesunął bazę locka", async () => {
    const { client } = scene({ posts: { updated: ok([{ id: POST_ID, updated_at: NEXT_TS }]) } });
    await expect(run({ fields: { title_pl: "A" } }, client)).resolves.toEqual({
      ok: true,
      slug: "stary-slug",
      updatedAt: NEXT_TS,
    });
  });
});

describe("slug", () => {
  it("kolizja slugu daje sufiks numeryczny i KANONICZNY slug w odpowiedzi", async () => {
    const { client } = scene({ posts: { slugTaken: (c) => c === "nowy-slug" } });
    await expect(run({ fields: { slug: "Nowy slug" } }, client)).resolves.toMatchObject({
      slug: "nowy-slug-2",
    });
    expect(savedPatch(client.db).slug).toBe("nowy-slug-2");
  });

  it("sonda unikalności POMIJA własny wiersz (neq id) i filtruje po tenancie", async () => {
    const { client } = scene();
    await run({ fields: { slug: "nowy-slug" } }, client);
    const probe = client.db.chainsFor("posts").find((c) => c.has("limit"));
    expect(probe?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["slug", "nowy-slug"],
    ]);
    expect(probe?.argsOf("neq")).toEqual(["id", POST_ID]);
  });

  it("po 50 zajętych kandydatach spada do sufiksu base36 (bez pętli w nieskończoność)", async () => {
    const { client } = scene({ posts: { slugTaken: () => true } });
    const out = (await run({ fields: { slug: "zajety" } }, client)) as { slug: string };
    expect(out.slug).toMatch(/^zajety-[0-9a-z]+$/);
    expect(out.slug).not.toBe("zajety-51");
    expect(client.db.chainsFor("posts").filter((c) => c.has("limit"))).toHaveLength(50);
  });

  it("błąd sondy unikalności przerywa zapis", async () => {
    const { client } = scene();
    client.db.setResponse("posts", (chain) =>
      chain.has("limit") ? fail("slug probe denied") : ok([{ id: POST_ID, updated_at: NEXT_TS }]),
    );
    await expect(run({ fields: { slug: "nowy" } }, client)).rejects.toThrow("slug probe denied");
  });
});

describe("izolacja najemcy dla organizacji", () => {
  it("organizacja z INNEGO obszaru roboczego jest odrzucana przed zapisem", async () => {
    const { client } = scene();
    admin.setResponse("crm_companies", ok(null));
    await expect(run({ fields: { organization_id: ORG_ID } }, client)).rejects.toThrow(
      "Organization not found in this workspace",
    );
    expect(client.db.chainsFor("posts").filter((c) => c.has("update"))).toHaveLength(0);
  });

  it("czyta crm_companies przez service_role z filtrem id ORAZ tenanta", async () => {
    const { client } = scene();
    await run({ fields: { organization_id: ORG_ID } }, client);
    const chain = admin.lastChain("crm_companies");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", ORG_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("błąd odczytu organizacji propaguje", async () => {
    const { client } = scene();
    admin.setResponse("crm_companies", fail("crm denied"));
    await expect(run({ fields: { organization_id: ORG_ID } }, client)).rejects.toThrow(
      "crm denied",
    );
  });

  it("patch BEZ organization_id nie odpytuje crm_companies", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A" } }, client);
    expect(admin.chainsFor("crm_companies")).toHaveLength(0);
  });
});

describe("ślad rozliczalności deklaracji sponsoringu", () => {
  const komplet = {
    is_sponsored: true,
    sponsored_kind: "sponsored",
    sponsored_advertiser_name: "Fundacja Przykład",
    sponsored_advertiser_url: "https://example.org/fundacja",
  };

  it("PRZEJŚCIE w stan oznaczony stempluje sponsored_marked_by/at", async () => {
    const { client } = scene();
    await run({ fields: komplet }, client);
    const patch = savedPatch(client.db);
    expect(patch.sponsored_marked_by).toBe(USER);
    expect(typeof patch.sponsored_marked_at).toBe("string");
  });

  it("kolejny autozapis JUŻ oznaczonego materiału NIE przepisuje daty deklaracji", async () => {
    const { client } = scene({
      existing: { ...komplet, sponsored_marked_by: USER, sponsored_marked_at: BASE_TS },
    });
    await run({ fields: { is_sponsored: true, title_pl: "Nowy tytuł" } }, client);
    const patch = savedPatch(client.db);
    expect(patch).not.toHaveProperty("sponsored_marked_by");
    expect(patch).not.toHaveProperty("sponsored_marked_at");
  });
});

describe("bramka kompletności ujawnienia komercyjnego", () => {
  it("SZKIC z niekompletną deklaracją zapisuje się (to ścieżka autozapisu)", async () => {
    const { client } = scene();
    await expect(run({ fields: { is_sponsored: true } }, client)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("PUBLIKACJA niekompletnej deklaracji jest odrzucana KODEM braków", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    await expect(
      run({ fields: { is_sponsored: true, status: "published" } }, client),
    ).rejects.toThrow("sponsored_disclosure_incomplete:kind,advertiser,advertiserUrl");
    expect(client.db.chainsFor("posts").filter((c) => c.has("update"))).toHaveLength(0);
  });

  it("bramka czyta STAN PO SCALENIU: patch samej flagi przechodzi, gdy wiersz ma reklamodawcę", async () => {
    const { client } = scene({
      existing: {
        status: "published",
        published_at: BASE_TS,
        sponsored_kind: "partner",
        sponsored_advertiser_name: "Instytut Przykład",
        sponsored_advertiser_url: "https://example.org/instytut",
      },
    });
    await expect(
      run({ fields: { is_sponsored: true, status: "published" } }, client),
    ).resolves.toMatchObject({ ok: true });
  });

  it("wyczyszczenie nazwy reklamodawcy przy włączonej fladze OBLEWA (patch nadpisuje wiersz)", async () => {
    const { client } = scene({
      existing: {
        status: "published",
        published_at: BASE_TS,
        is_sponsored: true,
        sponsored_kind: "partner",
        sponsored_advertiser_name: "Instytut Przykład",
        sponsored_advertiser_url: "https://example.org/instytut",
      },
    });
    await expect(
      run({ fields: { sponsored_advertiser_name: null, status: "published" } }, client),
    ).rejects.toThrow("sponsored_disclosure_incomplete:advertiser");
  });

  it("status scheduled też jest publicznie czytelny, więc też podlega bramce", async () => {
    const { client } = scene();
    await expect(
      run(
        {
          fields: {
            is_sponsored: true,
            status: "scheduled",
            publish_at: "2026-09-01T10:00:00.000Z",
          },
        },
        client,
      ),
    ).rejects.toThrow("sponsored_disclosure_incomplete:");
  });

  it("reklama POLITYCZNA bez wskazania procesu nie przechodzi publikacji", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    await expect(
      run(
        {
          fields: {
            status: "published",
            is_sponsored: true,
            sponsored_kind: "advertisement",
            sponsored_advertiser_name: "Komitet Przykład",
            sponsored_advertiser_url: "https://example.org/komitet",
            sponsored_political: true,
          },
        },
        client,
      ),
    ).rejects.toThrow("sponsored_disclosure_incomplete:politicalProcess");
  });

  it("statusy niepubliczne (archived, pending_review) omijają bramkę", async () => {
    for (const status of ["archived", "pending_review"]) {
      const { client } = scene();
      await expect(
        run({ fields: { is_sponsored: true, status } }, client),
        status,
      ).resolves.toMatchObject({ ok: true });
    }
  });
});

describe("bramka workflow", () => {
  it("bez prawa publikacji przejście do published jest odrzucane komunikatem redakcyjnym", async () => {
    const { client } = scene({ canPublish: false });
    await expect(run({ fields: { status: "published" } }, client)).rejects.toThrow(
      "only an administrator can publish or schedule - submit for review instead",
    );
  });

  it("harmonogram bez daty publikacji jest odrzucany INNYM komunikatem", async () => {
    const { client } = scene({ canPublish: true });
    await expect(run({ fields: { status: "scheduled" } }, client)).rejects.toThrow(
      "a scheduled post needs a publish date",
    );
  });

  it("harmonogram z datą przechodzi", async () => {
    const { client } = scene({ canPublish: true });
    await expect(
      run({ fields: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" } }, client),
    ).resolves.toMatchObject({ ok: true });
  });

  it("zapis BEZ zmiany statusu nie pyta o uprawnienia publikacji", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    await run({ fields: { status: "published", title_pl: "Poprawka" } }, client);
    expect(client.rpcCalls.filter((c) => c.fn === "can_publish_content")).toHaveLength(0);
  });

  it("błąd RPC uprawnień NIE jest interpretowany jako brak uprawnień", async () => {
    const { client } = scene();
    client.setRpc("can_publish_content", fail("rpc down"));
    await expect(run({ fields: { status: "published" } }, client)).rejects.toThrow(
      "Could not verify publishing permissions",
    );
  });

  it("dziedziczy publish_at z wiersza, gdy patch go nie niesie", async () => {
    // Wpis już zaplanowany; zmiana samego statusu na scheduled->scheduled nie
    // jest przejściem, więc bramka nie rusza. Tu: draft -> scheduled z datą
    // ZAPISANĄ WCZEŚNIEJ w wierszu.
    const { client } = scene({ existing: { publish_at: "2026-09-01T10:00:00.000Z" } });
    await expect(run({ fields: { status: "scheduled" } }, client)).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("daty publikacji", () => {
  it("PIERWSZA publikacja stempluje published_at", async () => {
    const { client } = scene();
    await run({ fields: { status: "published" } }, client);
    expect(typeof savedPatch(client.db).published_at).toBe("string");
  });

  it("ponowny zapis opublikowanego wpisu NIE przestempluje published_at", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    await run({ fields: { status: "published", title_pl: "Poprawka" } }, client);
    expect(savedPatch(client.db)).not.toHaveProperty("published_at");
  });

  it("ponowna publikacja po cofnięciu zachowuje pierwotną datę (parytet z WordPressem)", async () => {
    const { client } = scene({ existing: { status: "archived", published_at: BASE_TS } });
    await run({ fields: { status: "published" } }, client);
    expect(savedPatch(client.db)).not.toHaveProperty("published_at");
  });

  it("zejście z harmonogramu ZERUJE publish_at", async () => {
    const { client } = scene({
      existing: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
    });
    await run({ fields: { status: "draft" } }, client);
    expect(savedPatch(client.db).publish_at).toBeNull();
  });

  it("publikacja natychmiastowa z harmonogramu stempluje datę i czyści plan", async () => {
    const { client } = scene({
      existing: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
    });
    await run({ fields: { status: "published" } }, client);
    const patch = savedPatch(client.db);
    expect(typeof patch.published_at).toBe("string");
    expect(patch.publish_at).toBeNull();
  });

  it("pozostanie w scheduled NIE czyści publish_at", async () => {
    const { client } = scene({
      existing: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
    });
    await run({ fields: { title_pl: "Poprawka" } }, client);
    expect(savedPatch(client.db)).not.toHaveProperty("publish_at");
  });
});

describe("migawka rewizji jest BEST-EFFORT", () => {
  it("patch dotykający treści tworzy migawkę wiersza SPRZED zapisu", async () => {
    const { client } = scene({ existing: { title_pl: "Wersja poprzednia" } });
    await run({ fields: { title_pl: "Wersja nowa" } }, client);
    const insert = client.db.chainsFor("content_revisions").find((c) => c.has("insert"));
    const row = insert?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(row.entity_type).toBe("post");
    expect(row.tenant_id).toBe(TENANT);
    expect(row.note).toBe("autosave");
    expect((row.snapshot as Record<string, unknown>).title_pl).toBe("Wersja poprzednia");
  });

  it("patch NIEdotykający pól treści (samo SEO) migawki nie tworzy", async () => {
    const { client } = scene();
    await run({ fields: { seo_title_pl: "Meta" } }, client);
    expect(client.db.chainsFor("content_revisions")).toHaveLength(0);
  });

  it("świeża migawka i brak zmiany statusu = pominięcie (throttle 5 min)", async () => {
    const { client } = scene({ revisions: { last: new Date().toISOString() } });
    await run({ fields: { title_pl: "A" } }, client);
    expect(client.db.chainsFor("content_revisions").filter((c) => c.has("insert"))).toHaveLength(0);
  });

  it("zmiana statusu WYMUSZA migawkę mimo świeżej poprzedniej", async () => {
    const { client } = scene({ revisions: { last: new Date().toISOString() } });
    await run({ fields: { title_pl: "A", status: "pending_review" } }, client);
    expect(client.db.chainsFor("content_revisions").filter((c) => c.has("insert"))).toHaveLength(1);
  });

  it("BŁĄD zapisu migawki NIE psuje zapisu treści", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = scene({ revisions: { insertResult: fail("revisions insert denied") } });
    await expect(run({ fields: { title_pl: "A" } }, client)).resolves.toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("WYJĄTEK w torze migawki też nie psuje zapisu treści", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = scene();
    client.db.setResponse("content_revisions", () => {
      throw new Error("revisions unreachable");
    });
    await expect(run({ fields: { title_pl: "A" } }, client)).resolves.toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("nadwyżka nad limitem historii jest przycinana", async () => {
    const { client } = scene({ revisions: { overflow: [OTHER_POST_ID] } });
    await run({ fields: { title_pl: "A" } }, client);
    const del = client.db.chainsFor("content_revisions").find((c) => c.has("delete"));
    expect(del?.argsOf("in")).toEqual(["id", [OTHER_POST_ID]]);
  });

  it("brak nadwyżki = brak DELETE", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A" } }, client);
    expect(client.db.chainsFor("content_revisions").filter((c) => c.has("delete"))).toHaveLength(0);
  });
});

describe("automatyczne 301 po zmianie permalinku", () => {
  function withPaths(client: ContentClient, paths: Record<string, string | null>) {
    client.setRpc("page_full_path", (args) => {
      const id = (args as { _page_id?: string } | undefined)?._page_id ?? "";
      return ok(paths[id] ?? null);
    });
  }

  it("OPUBLIKOWANY wpis ze zmienionym slugiem zostawia regułę 301 bez wildcardu", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    withPaths(client, { [PARENT_PAGE_ID]: "blog" });
    await run({ fields: { slug: "nowy-slug" } }, client);
    const upsert = client.db.chainsFor("redirects").find((c) => c.has("upsert"));
    const rows = upsert?.argsOf("upsert")?.[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      status_code: 301,
      source: "slug_change",
      created_by: USER,
      is_enabled: true,
      source_path: "/blog/stary-slug",
      target_path: "/blog/nowy-slug",
    });
    // Reguła, która przechwytywała NOWY (już żywy) adres, jest usuwana...
    const del = client.db.chainsFor("redirects").find((c) => c.has("delete"));
    expect(del?.argsOf("in")).toEqual(["source_path", ["/blog/nowy-slug"]]);
    // ...a łańcuchy są spłaszczane do jednego skoku.
    const flat = client.db.chainsFor("redirects").find((c) => c.has("update"));
    expect(flat?.argsOf("update")).toEqual([{ target_path: "/blog/nowy-slug" }]);
  });

  it("SZKIC ze zmienionym slugiem nie tworzy przekierowania (stary adres nigdy nie żył)", async () => {
    const { client } = scene();
    withPaths(client, { [PARENT_PAGE_ID]: "blog" });
    await run({ fields: { slug: "nowy-slug" } }, client);
    expect(client.db.chainsFor("redirects")).toHaveLength(0);
  });

  it("zmiana RODZICA liczy nową ścieżkę z NOWEGO rodzica", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    withPaths(client, { [PARENT_PAGE_ID]: "blog", [OTHER_PARENT_ID]: "analizy/2026" });
    await run({ fields: { parent_page_id: OTHER_PARENT_ID } }, client);
    const rows = client.db
      .chainsFor("redirects")
      .find((c) => c.has("upsert"))
      ?.argsOf("upsert")?.[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      source_path: "/blog/stary-slug",
      target_path: "/analizy/2026/stary-slug",
    });
  });

  it("nieznana ścieżka rodzica = brak źródła = brak reguły (nie pusta reguła)", async () => {
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    withPaths(client, {});
    await run({ fields: { slug: "nowy-slug" } }, client);
    expect(client.db.chainsFor("redirects")).toHaveLength(0);
  });

  it("źródło identyczne z celem nie produkuje reguły w kółko", async () => {
    const { client } = scene({
      existing: { status: "published", published_at: BASE_TS, parent_page_id: PARENT_PAGE_ID },
    });
    withPaths(client, { [PARENT_PAGE_ID]: "blog", [OTHER_PARENT_ID]: "blog" });
    await run({ fields: { parent_page_id: OTHER_PARENT_ID } }, client);
    expect(client.db.chainsFor("redirects").filter((c) => c.has("upsert"))).toHaveLength(0);
  });

  it("BŁĄD zapisu przekierowania NIE psuje zapisu treści", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = scene({ existing: { status: "published", published_at: BASE_TS } });
    withPaths(client, { [PARENT_PAGE_ID]: "blog" });
    client.db.setResponse("redirects", (chain) =>
      chain.has("upsert") ? fail("redirects upsert denied") : ok(null),
    );
    await expect(run({ fields: { slug: "nowy-slug" } }, client)).resolves.toMatchObject({
      ok: true,
      slug: "nowy-slug",
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("taksonomie", () => {
  it("zapis SAMYCH taksonomii wymusza guarded touch wpisu", async () => {
    const { client } = scene();
    await run({ fields: {}, categories: [OTHER_POST_ID] }, client);
    const touch = client.db
      .chainsFor("posts")
      .find((c) => c.has("update") && "updated_at" in ((c.argsOf("update")?.[0] ?? {}) as object));
    expect(touch).toBeDefined();
    expect(touch?.argsOf("select")).toEqual(["id, updated_at"]);
  });

  it("odmowa RLS na wymuszonym touchu blokuje przepisanie CUDZEJ taksonomii", async () => {
    const { client } = scene({ posts: { touched: ok([]) } });
    await expect(run({ fields: {}, categories: [OTHER_POST_ID] }, client)).rejects.toThrow(
      "you do not have permission to edit this post",
    );
    expect(client.db.chainsFor("post_categories")).toHaveLength(0);
  });

  it("błąd wymuszonego touchu propaguje", async () => {
    const { client } = scene({ posts: { touched: fail("touch denied") } });
    await expect(run({ fields: {}, tags: [OTHER_POST_ID] }, client)).rejects.toThrow(
      "touch denied",
    );
  });

  it("patch NIEpusty nie potrzebuje osobnego touchu", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A" }, categories: [OTHER_POST_ID] }, client);
    const touches = client.db
      .chainsFor("posts")
      .filter(
        (c) => c.has("update") && "updated_at" in ((c.argsOf("update")?.[0] ?? {}) as object),
      );
    expect(touches).toHaveLength(0);
  });

  it("każda z czterech taksonomii jest podmieniana w całości (delete + insert)", async () => {
    const { client } = scene();
    await run(
      {
        fields: { title_pl: "A" },
        categories: [OTHER_POST_ID],
        tags: [OTHER_POST_ID],
        programs: [OTHER_POST_ID],
        regions: [OTHER_POST_ID],
      },
      client,
    );
    for (const table of ["post_categories", "post_tags", "post_programs", "post_regions"]) {
      const chains = client.db.chainsFor(table);
      expect(
        chains.filter((c) => c.has("delete")),
        table,
      ).toHaveLength(1);
      expect(
        chains.filter((c) => c.has("insert")),
        table,
      ).toHaveLength(1);
    }
    expect(client.db.lastChain("post_regions")?.argsOf("insert")).toEqual([
      [{ post_id: POST_ID, region_id: OTHER_POST_ID }],
    ]);
  });

  it("PUSTA tablica to świadome wyczyszczenie: sam delete, bez insertu - w KAŻDEJ z czterech", async () => {
    const { client } = scene();
    await run(
      { fields: { title_pl: "A" }, categories: [], tags: [], programs: [], regions: [] },
      client,
    );
    for (const table of ["post_categories", "post_tags", "post_programs", "post_regions"]) {
      const chains = client.db.chainsFor(table);
      expect(
        chains.filter((c) => c.has("delete")),
        table,
      ).toHaveLength(1);
      expect(
        chains.filter((c) => c.has("insert")),
        table,
      ).toHaveLength(0);
    }
  });

  it("błąd insertu taksonomii przerywa zapis (nie cicha połowa)", async () => {
    for (const table of ["post_categories", "post_tags", "post_programs", "post_regions"]) {
      const { client } = scene();
      client.db.setResponse(table, (chain) =>
        chain.has("insert") ? fail(`${table} insert denied`) : ok(null),
      );
      const key = table.replace("post_", "");
      await expect(
        run({ fields: { title_pl: "A" }, [key]: [OTHER_POST_ID] }, client),
        table,
      ).rejects.toThrow(`${table} insert denied`);
    }
  });

  it("brak kluczy taksonomii = zero zapytań do tabel relacji", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A" } }, client);
    expect(client.db.chainsFor("post_categories")).toHaveLength(0);
    expect(client.db.chainsFor("post_tags")).toHaveLength(0);
  });
});

describe("akcja audytu (czteropozycyjny wybór)", () => {
  const cases: Array<[string, PostFields, Partial<PostRow>, string]> = [
    ["bez zmiany statusu", { title_pl: "A" }, {}, "post.update"],
    ["publikacja", { status: "published" }, {}, "post.publish"],
    [
      "harmonogram",
      { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
      {},
      "post.schedule",
    ],
    ["zgłoszenie do recenzji", { status: "pending_review" }, {}, "post.review.submit"],
    ["archiwizacja", { status: "archived" }, { status: "published" }, "post.update"],
  ];

  it.each(cases)("%s -> %s", async (_label, fields, existing, action) => {
    const { client } = scene({ existing });
    await run({ fields }, client);
    const [, params] = recordAudit.mock.calls.at(-1) as [unknown, Record<string, unknown>];
    expect(params.action).toBe(action);
  });

  it("zmiana statusu dopisuje from/to, harmonogram dodatkowo publish_at", async () => {
    const { client } = scene();
    await run({ fields: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" } }, client);
    expect(auditParams()).toMatchObject({
      entityType: "post",
      entityId: POST_ID,
      metadata: { from: "draft", to: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
    });
  });

  it("audyt niesie LISTĘ zapisanych kolumn (a nie ich wartości)", async () => {
    const { client } = scene();
    await run({ fields: { title_pl: "A", tts_voice_pl: ALLOWED_VOICE_ID } }, client);
    const metadata = auditParams().metadata as { fields: string[] };
    expect([...metadata.fields].sort()).toEqual(["title_pl", "tts_voice_pl"]);
    expect(JSON.stringify(metadata)).not.toContain(ALLOWED_VOICE_ID);
  });

  it("zapis pustego patcha bez taksonomii nie rusza wiersza, ale zostawia ślad audytu", async () => {
    const { client } = scene();
    await expect(run({ fields: {} }, client)).resolves.toEqual({
      ok: true,
      slug: "stary-slug",
      updatedAt: BASE_TS,
    });
    expect(client.db.chainsFor("posts")).toHaveLength(0);
    expect(auditParams().metadata).toEqual({ fields: [] });
  });
});

// ---------------------------------------------------------------------------
// Odporność na nietypowe, ale legalne odpowiedzi PostgREST.
// ---------------------------------------------------------------------------

describe("odporność na data:null i brak updated_at", () => {
  it("UPDATE zwracający data:null zamiast pustej tablicy to nadal odmowa, nie awaria", async () => {
    const { client } = scene({ posts: { updated: ok(null) } });
    await expect(run({ fields: { title_pl: "A" } }, client)).rejects.toThrow(
      "you do not have permission to edit this post",
    );
  });

  it("wiersz bez updated_at nie zeruje bazy optimistic-locka po stronie klienta", async () => {
    const { client } = scene({ posts: { updated: ok([{ id: POST_ID, updated_at: null }]) } });
    await expect(run({ fields: { title_pl: "A" } }, client)).resolves.toMatchObject({
      updatedAt: BASE_TS,
    });
  });

  it("wymuszony touch bez updated_at też zachowuje poprzednią bazę", async () => {
    const { client } = scene({ posts: { touched: ok([{ id: POST_ID, updated_at: null }]) } });
    await expect(run({ fields: {}, categories: [] }, client)).resolves.toMatchObject({
      updatedAt: BASE_TS,
    });
  });

  it("pre-read bez updated_at nie wywraca zapisu (wiersz sprzed triggera)", async () => {
    const { client } = scene({ posts: { updated: ok([{ id: POST_ID, updated_at: null }]) } });
    admin.setResponse("posts", ok({ ...postRow(), updated_at: null }));
    await expect(run({ fields: { title_pl: "A" } }, client)).resolves.toEqual({
      ok: true,
      slug: "stary-slug",
      updatedAt: null,
    });
  });

  it("NIEparsowalna baza locka przy poprawnym updated_at wiersza to konflikt", async () => {
    // Druga strona alternatywy `Number.isNaN(existingTime) || Number.isNaN(baseTime)`:
    // to KLIENT przysłał śmieć, nie baza.
    const { client } = scene();
    await expect(
      run({ fields: { title_pl: "A" }, baseUpdatedAt: "wersja-klienta" }, client),
    ).rejects.toThrow("EDIT_CONFLICT");
  });
});

// Kontrola higieny atrap: `supabaseAdmin` w kodzie produkcyjnym musi być TĄ
// atrapą, po której testy wyżej czytają zapisane łańcuchy. Kod importuje ten
// moduł DYNAMICZNIE (dwa razy w jednym przebiegu), więc inna instancja
// przechodziłaby obok wszystkich asercji „odczyt idzie przez service_role".
describe("higiena atrap", () => {
  it("supabaseAdmin to ta sama atrapa, którą czytają testy", () => {
    expect(supabaseAdmin.from).toBe(admin.from);
  });
});
