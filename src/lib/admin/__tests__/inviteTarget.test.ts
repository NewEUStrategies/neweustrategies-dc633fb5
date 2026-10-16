// Tabela decyzji o adresacie zaproszenia (`resolveInviteTarget`) - czysta
// funkcja, więc każdy wiersz zlecenia (docs/PROMPT_ZAPROSZENIE_GRANICA_NAJEMCY.md,
// A1) ma tu własny przypadek, bez atrapy katalogu i bazy. Orkiestrację - co
// `performSend` czyta, w jakiej kolejności i czego nie zapisuje przy odmowie -
// dowodzi `invitationsFunctions.test.ts`.
import { describe, expect, it } from "vitest";
import {
  INVITABLE_ROLES,
  appMetadataTenantId,
  isInvitableRole,
  resolveInviteTarget,
  type InviteAccount,
  type InviteTargetInput,
} from "@/lib/admin/inviteTarget";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEFAULT = "99999999-9999-4999-8999-999999999999";
const USER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Konto nigdy nieużyte (bez sesji w historii), o adresie zaproszenia. */
function account(overrides: Partial<InviteAccount> = {}): InviteAccount {
  return {
    id: USER,
    email: "nowa@example.org",
    appTenantId: null,
    everSignedIn: false,
    ...overrides,
  };
}

function input(overrides: Partial<InviteTargetInput> = {}): InviteTargetInput {
  return {
    invitationTenantId: TENANT,
    invitationEmail: "nowa@example.org",
    pinnedAccountId: null,
    account: account(),
    profileTenantId: TENANT,
    defaultTenantId: DEFAULT,
    ...overrides,
  };
}

describe("resolveInviteTarget - tabela A1", () => {
  it("brak konta o adresie - zakładamy nowe", () => {
    expect(resolveInviteTarget(input({ account: null, profileTenantId: null }))).toEqual({
      kind: "create",
    });
  });

  it("przypięty identyfikator, którego konto nie istnieje - odmowa, NIGDY `create`", () => {
    // `create` założyłoby drugie konto na adres zaproszenia, a wiersz dalej
    // wskazywałby identyfikator, którego nikt nie sprawdził.
    expect(
      resolveInviteTarget(input({ pinnedAccountId: USER, account: null, profileTenantId: null })),
    ).toEqual({ kind: "refuse", reason: "pinned_account_missing" });
  });

  it("przypięty identyfikator wskazuje inne konto niż pobrane - odmowa", () => {
    expect(resolveInviteTarget(input({ pinnedAccountId: OTHER }))).toEqual({
      kind: "refuse",
      reason: "pinned_account_mismatch",
    });
  });

  it.each([
    ["inny adres", "obca@example.org"],
    ["brak adresu konta", null],
  ])("konto z adresem niezgodnym z zaproszeniem (%s) - odmowa", (_label, email) => {
    expect(
      resolveInviteTarget(input({ account: account({ email, appTenantId: TENANT }) })),
    ).toEqual({ kind: "refuse", reason: "pinned_account_mismatch" });
  });

  it("adresy porównywane bez wielkości liter i spacji brzegowych", () => {
    expect(
      resolveInviteTarget(
        input({
          invitationEmail: " Nowa@Example.org",
          account: account({ email: "NOWA@example.ORG " }),
        }),
      ),
    ).toEqual({ kind: "attach", userId: USER });
  });

  it("profil w najemcy zaproszenia - dowiązanie (codzienne ponowienie)", () => {
    expect(resolveInviteTarget(input())).toEqual({ kind: "attach", userId: USER });
  });

  it("profil w najemcy zaproszenia nie potrzebuje poświadczenia ani najemcy domyślnego", () => {
    expect(resolveInviteTarget(input({ defaultTenantId: null }))).toEqual({
      kind: "attach",
      userId: USER,
    });
  });

  it("ZGŁOSZONY DEFEKT: profil z `handle_new_user` w najemcy domyślnym, konto narodzone dla TEGO najemcy - dowiązanie", () => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId: TENANT }),
          profileTenantId: DEFAULT,
        }),
      ),
    ).toEqual({ kind: "attach", userId: USER });
  });

  it("profil w najemcy domyślnym, konto narodzone dla TEGO najemcy, ale JUŻ UŻYWANE - odmowa", () => {
    // Przerwana wysyłka nie dała ani linku, ani hasła. Sesja w historii znaczy,
    // że właściciel dostał się do konta inną drogą i używa go jako czytelnik
    // najemcy domyślnego - konto należy już do tamtego najemcy.
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId: TENANT, everSignedIn: true }),
          profileTenantId: DEFAULT,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "profile_in_other_tenant" });
  });

  it("brak profilu, konto narodzone dla tego najemcy, ale już używane - odmowa", () => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId: TENANT, everSignedIn: true }),
          profileTenantId: null,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "profile_missing_unproven" });
  });

  it("używane konto z profilem w najemcy zaproszenia - dowiązanie (codzienne ponowienie)", () => {
    expect(resolveInviteTarget(input({ account: account({ everSignedIn: true }) }))).toEqual({
      kind: "attach",
      userId: USER,
    });
  });

  it.each([
    ["bez poświadczenia (czytelnik z rejestracji własnej)", null],
    ["narodzone dla innego najemcy", OTHER],
  ])("profil w najemcy domyślnym, konto %s - odmowa", (_label, appTenantId) => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId }),
          profileTenantId: DEFAULT,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "profile_in_other_tenant" });
  });

  it("najemca domyślny nieznany - wiersz narodzin się nie otwiera (fail closed)", () => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId: TENANT }),
          profileTenantId: DEFAULT,
          defaultTenantId: null,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "profile_in_other_tenant" });
  });

  it("poświadczenie narodzin NIE otwiera profilu w najemcy innym niż domyślny", () => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId: TENANT }),
          profileTenantId: OTHER,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "profile_in_other_tenant" });
  });

  it("brak profilu, konto narodzone dla tego najemcy - dowiązanie", () => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId: TENANT }),
          profileTenantId: null,
        }),
      ),
    ).toEqual({ kind: "attach", userId: USER });
  });

  it.each([null, OTHER])("brak profilu, poświadczenie %s - odmowa", (appTenantId) => {
    expect(
      resolveInviteTarget(
        input({
          account: account({ appTenantId }),
          profileTenantId: null,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "profile_missing_unproven" });
  });

  it("zaproszenie do najemcy domyślnego: profil tam jest profilem najemcy zaproszenia", () => {
    expect(
      resolveInviteTarget(
        input({ invitationTenantId: DEFAULT, profileTenantId: DEFAULT, defaultTenantId: null }),
      ),
    ).toEqual({ kind: "attach", userId: USER });
  });
});

describe("appMetadataTenantId", () => {
  it("czyta wyłącznie niepusty tekst `tenant_id`", () => {
    expect(appMetadataTenantId({ provider: "email", tenant_id: TENANT })).toBe(TENANT);
  });

  it.each([
    undefined,
    null,
    "tekst",
    7,
    {},
    { tenant_id: "" },
    { tenant_id: 42 },
    { tenant_id: null },
  ])("%j nie poświadcza najemcy", (value) => {
    expect(appMetadataTenantId(value)).toBeNull();
  });
});

describe("role zapraszalne", () => {
  it("zbiór jest dokładnie tym, który pokazuje formularz zaproszenia", () => {
    expect(INVITABLE_ROLES).toEqual(["admin", "editor", "author", "user"]);
  });

  it.each(["super_admin", "moderator", "", "ADMIN", null, undefined, 1])(
    "%j nie jest rolą zapraszalną",
    (role) => {
      expect(isInvitableRole(role)).toBe(false);
    },
  );

  it.each(INVITABLE_ROLES)("%s jest rolą zapraszalną", (role) => {
    expect(isInvitableRole(role)).toBe(true);
  });
});
