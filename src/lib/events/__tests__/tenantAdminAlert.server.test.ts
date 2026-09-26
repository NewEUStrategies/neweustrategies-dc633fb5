// Alert administratorów JEDNEGO najemcy.
//
// STAWKA (S24, MS M-9): wzorzec sporów powiadamiał administratorów WSZYSTKICH
// najemców. Tu dwa najemcy w atrapie bazy i dowód, że dzwonek dostają
// wyłącznie `admin`/`super_admin` z rolą W NAJEMCY zdarzenia
// (`user_roles.tenant_id`) i z `profiles.tenant_id` = najemca zdarzenia.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ProfileRow {
  id: string;
  tenant_id: string;
}

const db = vi.hoisted(() => {
  const state = {
    roles: [] as { user_id: string; role: string; tenant_id: string }[],
    profiles: [] as ProfileRow[],
    rolesError: null as { message: string } | null,
    profilesError: null as { message: string } | null,
    /** Odpowiedź bez danych i bez błędu (PostgREST zwraca wtedy `data: null`). */
    rolesNull: false,
    profilesNull: false,
    broken: false,
    calls: [] as { table: string; filters: [string, string, unknown][] }[],
  };
  const rpc = vi.fn();
  function from(table: string) {
    const call = { table, filters: [] as [string, string, unknown][] };
    state.calls.push(call);
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        call.filters.push(["eq", column, value]);
        return builder;
      },
      in: (column: string, values: unknown) => {
        call.filters.push(["in", column, values]);
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "user_roles") {
          const roles = call.filters.find((f) => f[1] === "role")?.[2] as string[];
          // Atrapa odwzorowuje filtr najemcy TYLKO wtedy, gdy kod go wysłał -
          // bez `.eq("tenant_id")` wraca każda rola (tak jak zrobiłaby baza).
          const roleTenant = call.filters.find((f) => f[1] === "tenant_id")?.[2];
          return resolve({
            data:
              state.rolesError || state.rolesNull
                ? null
                : state.roles.filter(
                    (r) =>
                      roles.includes(r.role) &&
                      (roleTenant === undefined || r.tenant_id === roleTenant),
                  ),
            error: state.rolesError,
          });
        }
        const tenant = call.filters.find((f) => f[1] === "tenant_id")?.[2];
        const ids = call.filters.find((f) => f[1] === "id")?.[2] as string[];
        return resolve({
          data:
            state.profilesError || state.profilesNull
              ? null
              : state.profiles.filter((p) => p.tenant_id === tenant && ids.includes(p.id)),
          error: state.profilesError,
        });
      },
    };
    return builder;
  }
  return { state, rpc, from };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    if (db.state.broken) throw new Error("client unavailable");
    return { from: db.from, rpc: db.rpc };
  },
}));

import { notifyTenantAdmins } from "@/lib/events/tenantAdminAlert.server";

const A = "tenant-a";
const B = "tenant-b";
const INPUT = {
  tenantId: A,
  titlePl: "Zwrot nieudany",
  titleEn: "Refund failed",
  bodyPl: "Zgłoszenie r1, prośba q1",
  bodyEn: "Registration r1, request q1",
  href: "/admin/events/e1/registration",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.state.roles = [
    { user_id: "admin-a", role: "admin", tenant_id: A },
    { user_id: "admin-a", role: "editor", tenant_id: A },
    { user_id: "super-a", role: "super_admin", tenant_id: A },
    // Ta sama osoba z dwiema rolami administracyjnymi dostaje JEDEN dzwonek.
    { user_id: "super-a", role: "admin", tenant_id: A },
    { user_id: "admin-b", role: "admin", tenant_id: B },
    { user_id: "editor-a", role: "editor", tenant_id: A },
    // Profil w najemcy A, ale rola administratora wyłącznie w najemcy B:
    // NIE jest administratorem A (has_role sprawdza rolę w najemcy).
    { user_id: "moved-b", role: "admin", tenant_id: B },
  ];
  db.state.profiles = [
    { id: "admin-a", tenant_id: A },
    { id: "super-a", tenant_id: A },
    { id: "admin-b", tenant_id: B },
    { id: "editor-a", tenant_id: A },
    { id: "moved-b", tenant_id: A },
  ];
  db.state.rolesError = null;
  db.state.profilesError = null;
  db.state.rolesNull = false;
  db.state.profilesNull = false;
  db.state.broken = false;
  db.state.calls = [];
  db.rpc.mockResolvedValue({ data: "n1", error: null });
});

describe("notifyTenantAdmins", () => {
  it("powiadamia admina i super admina najemcy A - nigdy najemcy B ani redaktora", async () => {
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(2);
    const recipients = db.rpc.mock.calls.map(
      (call) => (call[1] as { p_user_id: string }).p_user_id,
    );
    expect(recipients.sort()).toEqual(["admin-a", "super-a"]);
    expect(db.rpc).toHaveBeenCalledWith("enqueue_notification", {
      p_user_id: "admin-a",
      p_kind: "billing",
      p_title_pl: INPUT.titlePl,
      p_title_en: INPUT.titleEn,
      p_body_pl: INPUT.bodyPl,
      p_body_en: INPUT.bodyEn,
      p_href: INPUT.href,
      p_icon: "credit-card",
    });
    const profilesCall = db.state.calls.find((c) => c.table === "profiles");
    expect(profilesCall?.filters).toContainEqual(["eq", "tenant_id", A]);
    const rolesCall = db.state.calls.find((c) => c.table === "user_roles");
    expect(rolesCall?.filters).toContainEqual(["eq", "tenant_id", A]);
  });

  it("rola administratora w INNYM najemcy nie wystarcza, nawet gdy profil wskazuje najemcę A", async () => {
    await notifyTenantAdmins(INPUT);
    const recipients = db.rpc.mock.calls.map(
      (call) => (call[1] as { p_user_id: string }).p_user_id,
    );
    expect(recipients).not.toContain("moved-b");
    // Kontrprzykład: dla najemcy B ta sama rola nie pomaga, bo profil jest w A.
    db.rpc.mockClear();
    await expect(notifyTenantAdmins({ ...INPUT, tenantId: B })).resolves.toBe(1);
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_user_id: "admin-b" });
  });

  it("dla najemcy B - wyłącznie admin B", async () => {
    await expect(notifyTenantAdmins({ ...INPUT, tenantId: B })).resolves.toBe(1);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_user_id: "admin-b" });
  });

  it("rodzaj i ikona wołającego", async () => {
    await notifyTenantAdmins({ ...INPUT, kind: "event", icon: "calendar-clock" });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_kind: "event", p_icon: "calendar-clock" });
  });

  it("brak ról administracyjnych -> 0 bez zapytania o profile", async () => {
    db.state.roles = [{ user_id: "editor-a", role: "editor", tenant_id: A }];
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(0);
    expect(db.state.calls.map((c) => c.table)).toEqual(["user_roles"]);
  });

  it("dzwonek wyciszony/duplikat albo błąd jednego nie zatrzymuje reszty", async () => {
    db.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: "", error: null });
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(0);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith("[tenantAdminAlert] bell failed", { error: "boom" });
  });

  it.each([
    ["błąd odczytu ról", () => (db.state.rolesError = { message: "roles down" })],
    ["błąd odczytu profili", () => (db.state.profilesError = { message: "profiles down" })],
    ["rzut klienta", () => (db.state.broken = true)],
  ])("%s -> 0 (nigdy nie rzuca)", async (_label, arrange) => {
    arrange();
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("puste odpowiedzi (`data: null` bez błędu) to zero odbiorców, nie wyjątek", async () => {
    db.state.rolesNull = true;
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(0);
    db.state.rolesNull = false;
    db.state.profilesNull = true;
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(0);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("wyjątek nie-Error też kończy się zerem", async () => {
    db.rpc.mockRejectedValue("offline");
    await expect(notifyTenantAdmins(INPUT)).resolves.toBe(0);
    expect(console.error).toHaveBeenCalledWith("[tenantAdminAlert] alert failed", {
      error: "offline",
    });
  });
});
