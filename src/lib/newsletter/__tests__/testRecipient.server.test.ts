// Odbiorca wysyłki testowej kampanii - tylko potwierdzone adresy redakcji
// tego najemcy. Granica chroni reputację nadawczą najemcy przed użyciem
// wysyłki testowej jako bramki do dowolnych adresów.
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import {
  CAMPAIGN_TEST_RECIPIENT_ROLES,
  isAllowedCampaignTestRecipient,
} from "@/lib/newsletter/testRecipient.server";

type AuthUser = { email: string | null; email_confirmed_at: string | null };

const db = supabaseFromStub();
let users: Record<string, AuthUser>;

function admin(): SupabaseClient<Database> {
  const client = {
    from: db.from,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const user = users[id];
          return user
            ? { data: { user: { id, ...user } }, error: null }
            : { data: { user: null }, error: { message: "not found" } };
        },
      },
    },
  };
  return client as unknown as SupabaseClient<Database>;
}

const TENANT = "tenant-1";
const CONFIRMED = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  db.reset();
  users = {
    caller: { email: "Redaktor@Example.Test", email_confirmed_at: CONFIRMED },
    kolega: { email: "kolega@example.test", email_confirmed_at: CONFIRMED },
    niepotwierdzony: { email: "nowy@example.test", email_confirmed_at: null },
  };
  db.setResponse(
    "user_roles",
    ok([{ user_id: "caller" }, { user_id: "kolega" }, { user_id: "niepotwierdzony" }]),
  );
});

const check = (toEmail: string) =>
  isAllowedCampaignTestRecipient(admin(), { tenantId: TENANT, callerId: "caller", toEmail });

describe("isAllowedCampaignTestRecipient", () => {
  it("własny potwierdzony adres wołającego przechodzi bez skanu redakcji", async () => {
    expect(await check("  redaktor@example.test ")).toBe(true);
    expect(db.chainsFor("user_roles")).toHaveLength(0);
  });

  it("potwierdzony adres innej osoby z redakcji TEGO najemcy przechodzi", async () => {
    expect(await check("kolega@example.test")).toBe(true);
    const chain = db.lastChain("user_roles");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("in")).toEqual(["role", [...CAMPAIGN_TEST_RECIPIENT_ROLES]]);
  });

  it("dowolny adres spoza redakcji jest odrzucany", async () => {
    expect(await check("obcy@example.test")).toBe(false);
  });

  it("niepotwierdzona skrzynka konta redakcji nie jest odbiorcą", async () => {
    expect(await check("nowy@example.test")).toBe(false);
  });

  it("błąd odczytu ról = odmowa (fail-closed)", async () => {
    db.setResponse("user_roles", fail("odmowa"));
    expect(await check("kolega@example.test")).toBe(false);
  });

  it("pusty adres jest odrzucany od razu", async () => {
    expect(await check("   ")).toBe(false);
  });
});
