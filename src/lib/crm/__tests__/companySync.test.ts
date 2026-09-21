// Kartoteka firmy jest źródłem prawdy o nazwie: po edycji nazwa musi trafić do
// profili członków i kontaktów CRM, a przed usunięciem relacje muszą zniknąć.
import { describe, it, expect } from "vitest";
import { syncCompanyToMembers, detachCompanyFromMembers } from "../companySync.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

interface Call {
  table: string;
  op: "update" | "select";
  payload: Record<string, unknown> | null;
}

function fakeClient(candidates: Array<{ id: string; current_company: string | null }>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const builder = {
        update(payload: Record<string, unknown>) {
          calls.push({ table, op: "update", payload });
          return builder;
        },
        select() {
          if (calls[calls.length - 1]?.op !== "update") {
            calls.push({ table, op: "select", payload: null });
          }
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        not: () => builder,
        limit: () => Promise.resolve({ data: candidates, error: null }),
        then(resolve: (value: { data: Array<{ id: string }>; error: null }) => unknown) {
          return Promise.resolve({ data: [{ id: "r1" }], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("syncCompanyToMembers", () => {
  it("zapisuje nową nazwę na profilach i kontaktach", async () => {
    const { client, calls } = fakeClient([]);
    const res = await syncCompanyToMembers(client, {
      tenantId: "t1",
      companyId: "c1",
      name: "  Nowa Nazwa  ",
    });
    expect(res.profiles).toBe(1);
    expect(res.leads).toBe(1);
    const updates = calls.filter((c) => c.op === "update");
    expect(updates[0]).toMatchObject({
      table: "profiles",
      payload: { current_company: "Nowa Nazwa" },
    });
    expect(updates[1]).toMatchObject({ table: "crm_leads", payload: { company: "Nowa Nazwa" } });
  });

  it("dopina profile z tą samą nazwą wpisaną ręcznie", async () => {
    const { client, calls } = fakeClient([
      { id: "p1", current_company: "acme sp. z o.o." },
      { id: "p2", current_company: "Inna firma" },
    ]);
    const res = await syncCompanyToMembers(client, {
      tenantId: "t1",
      companyId: "c1",
      name: "ACME",
    });
    expect(res.linked).toBe(1);
    const link = calls.filter((c) => c.op === "update").at(-1);
    expect(link?.payload).toMatchObject({ current_company_id: "c1" });
  });

  it("pusta nazwa nie uruchamia zapisów", async () => {
    const { client, calls } = fakeClient([]);
    const res = await syncCompanyToMembers(client, { tenantId: "t1", companyId: "c1", name: "  " });
    expect(res).toEqual({ profiles: 0, leads: 0, linked: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("detachCompanyFromMembers", () => {
  it("zeruje relacje na profilach i kontaktach", async () => {
    const { client, calls } = fakeClient([]);
    const res = await detachCompanyFromMembers(client, {
      tenantId: "t1",
      companyIds: ["c1", "c1"],
    });
    expect(res).toEqual({ profiles: 1, leads: 1 });
    const updates = calls.filter((c) => c.op === "update");
    expect(updates[0]).toMatchObject({ table: "profiles", payload: { current_company_id: null } });
    expect(updates[1]).toMatchObject({ table: "crm_leads", payload: { company_id: null } });
  });

  it("brak identyfikatorów nie dotyka bazy", async () => {
    const { client, calls } = fakeClient([]);
    expect(await detachCompanyFromMembers(client, { tenantId: "t1", companyIds: [] })).toEqual({
      profiles: 0,
      leads: 0,
    });
    expect(calls).toHaveLength(0);
  });
});
