// KRYTERIUM SPEC §8.3 S1: „lost update" planu - dwie karty, jeden wiersz.
//
// SCENARIUSZ Z PRODUKCJI (def. 3). Karta A (paywall) otwiera plan, karta B
// (członkostwo) przypina go do warstwy, karta A zapisuje cenę. Do S1 zapis A
// szedł pełnym wierszem z `tier_key` z chwili otwarcia - przypięcie z B znikało
// bez śladu. Teraz zapis A z nieaktualnym tokenem dostaje 0 wierszy → `40001`,
// a przypięcie z B zostaje.
//
// Baza jest tu MAŁYM MODELEM wiersza, nie atrapą jednego wywołania: UPDATE
// zmienia wiersz tylko przy zgodnym `updated_at` i nadaje nowy token
// z mikrosekundami (jak trigger `set_updated_at` w Postgresie). Dzięki temu
// test dowodzi zachowania sekwencji zapisów, a nie kształtu jednego zapytania.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ db: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.db!.from(table) },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => null }));

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { isStaleWriteError, saveAccessPlanPatch, type AccessPlanRow } from "../planQueries";

const PLAN_ID = "22222222-2222-4222-a222-222222222222";
const T0 = "2026-10-19T10:00:00.100001+00:00";

/** Kolejne tokeny w tej samej milisekundzie - różnią się WYŁĄCZNIE mikrosekundami. */
let tick = 0;
const nextToken = () => `2026-10-19T10:00:00.1000${String(++tick + 1).padStart(2, "0")}+00:00`;

let row: AccessPlanRow;

/** UPDATE … WHERE id = $1 AND updated_at = $2 RETURNING * - semantyka Postgresa. */
function updateResponder(chain: RecordedChain) {
  const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
  const id = eqs.find(([col]) => col === "id")?.[1];
  const token = eqs.find(([col]) => col === "updated_at")?.[1];
  if (id !== row.id || token !== row.updated_at) return ok([]);
  const patch = chain.argsOf("update")![0] as Partial<AccessPlanRow>;
  row = { ...row, ...patch, updated_at: nextToken() };
  return ok([row]);
}

beforeEach(() => {
  tick = 0;
  h.db = supabaseFromStub();
  h.db.setResponse("access_plans", updateResponder);
  row = {
    id: PLAN_ID,
    tenant_id: "11111111-1111-4111-a111-111111111111",
    name_pl: "Członkostwo",
    name_en: "Membership",
    description_pl: null,
    description_en: null,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    sort_order: 0,
    price_cents: 1900,
    currency: "PLN",
    interval: "month",
    trial_days: 0,
    active: true,
    for_sale: true,
    tier_key: null,
    volume_price_cents: null,
    volume_threshold_seats: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: T0,
  };
});

describe("lost update planu - dwie karty z tym samym tokenem", () => {
  it("pierwsza mutacja przechodzi, druga z tym samym `updatedAt` dostaje 0 wierszy → 40001", async () => {
    const first = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { price_cents: 2900 },
    });
    expect(first.price_cents).toBe(2900);
    expect(first.updated_at).not.toBe(T0);

    const second = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { price_cents: 3900 },
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(second)).toBe(true);
    expect((second as { code: string }).code).toBe("40001");
    // Wygrywa zapis, który przyszedł pierwszy - nie ostatni.
    expect(row.price_cents).toBe(2900);
  });

  it("przypięcie warstwy z członkostwa przeżywa spóźniony zapis ceny z paywalla", async () => {
    // Karta A (paywall) i karta B (członkostwo) czytają wiersz z tokenem T0.
    await saveAccessPlanPatch("membership", {
      id: PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { tier_key: "premium" },
    });
    const stale = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { price_cents: 990 },
    }).catch((e: unknown) => e);

    expect(isStaleWriteError(stale)).toBe(true);
    expect(row.tier_key).toBe("premium");
    expect(row.price_cents).toBe(1900);
  });

  it("po wczytaniu aktualnego wiersza (nowy token) zapis przechodzi i NIE cofa cudzej kolumny", async () => {
    const afterB = await saveAccessPlanPatch("membership", {
      id: PLAN_ID,
      expectedUpdatedAt: T0,
      patch: { tier_key: "premium" },
    });
    await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: afterB.updated_at,
      patch: { price_cents: 990 },
    });
    expect(row).toMatchObject({ tier_key: "premium", price_cents: 990 });
  });

  it("token przepuszczony przez `Date` gubi mikrosekundy - dlatego mutator go nie dotyka", async () => {
    // Kontrprzykład: tak NIE wolno. Ten sam zapis z tokenem po `toISOString()`
    // byłby konfliktem zawsze, także bez żadnej drugiej karty.
    const viaDate = new Date(T0).toISOString();
    expect(viaDate).not.toBe(T0);
    const err = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: viaDate,
      patch: { price_cents: 1 },
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
    await expect(
      saveAccessPlanPatch("paywall", {
        id: PLAN_ID,
        expectedUpdatedAt: T0,
        patch: { price_cents: 1 },
      }),
    ).resolves.toMatchObject({ price_cents: 1 });
  });
});
