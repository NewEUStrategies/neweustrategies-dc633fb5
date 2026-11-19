import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveLeadAccount, type LeadAccountReaders } from "../leadAccount";

const LEAD = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";

function readers(overrides: Partial<LeadAccountReaders> = {}): LeadAccountReaders {
  return {
    readLead: vi.fn(async () => ({ user_id: USER, tenant_id: TENANT })),
    profileInTenant: vi.fn(async () => true),
    ...overrides,
  };
}

describe("resolveLeadAccount", () => {
  it("zwraca konto z systemowego powiązania leada w jego najemcy", async () => {
    const r = readers();
    await expect(resolveLeadAccount(r, LEAD)).resolves.toEqual({
      userId: USER,
      tenantId: TENANT,
    });
    expect(r.readLead).toHaveBeenCalledWith(LEAD);
    expect(r.profileInTenant).toHaveBeenCalledWith(USER, TENANT);
  });

  it("lead bez powiązanego konta nie szuka profilu (np. po e-mailu)", async () => {
    const r = readers({ readLead: vi.fn(async () => ({ user_id: null, tenant_id: TENANT })) });
    await expect(resolveLeadAccount(r, LEAD)).resolves.toBeNull();
    expect(r.profileInTenant).not.toHaveBeenCalled();
  });

  it("lead niewidoczny pod RLS sesji daje null", async () => {
    const r = readers({ readLead: vi.fn(async () => null) });
    await expect(resolveLeadAccount(r, LEAD)).resolves.toBeNull();
    expect(r.profileInTenant).not.toHaveBeenCalled();
  });

  it("konto spoza najemcy leada jest odrzucane", async () => {
    const r = readers({ profileInTenant: vi.fn(async () => false) });
    await expect(resolveLeadAccount(r, LEAD)).resolves.toBeNull();
  });
});

describe("karty leada nie dopasowują konta po edytowalnym e-mailu", () => {
  const source = readFileSync(resolve(__dirname, "../../crm.functions.ts"), "utf8");

  it("wspólny pomocnik leadAccountFor deleguje do resolveLeadAccount", () => {
    const start = source.indexOf("async function leadAccountFor(");
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, start + 400)).toContain("resolveLeadAccount(");
  });

  it.each(["getCrmLeadMonthlyMetering", "getCrmLeadMembership", "getCrmLeadProfileSync"])(
    "%s korzysta z leadAccountFor (resolveLeadAccount)",
    (name) => {
      const start = source.indexOf(`export const ${name}`);
      expect(start).toBeGreaterThan(-1);
      const next = source.indexOf("export const ", start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      expect(body).toContain("leadAccountFor(");
      expect(body).not.toMatch(/email\.ilike/);
    },
  );
});
