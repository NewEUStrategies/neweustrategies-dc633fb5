// Pseudonimy per rozmowa: czyste grupowanie wierszy w indeks oraz reguła
// rozstrzygania nazw (pseudonim > profil > fallback) używana przez wszystkie
// powierzchnie czatu.
import { describe, expect, it } from "vitest";
import { conversationDisplay } from "../display";
import { buildNicknameIndex, nicknameFor, resolveMemberName } from "../nicknames";
import type { ConversationView, PeerProfile } from "../types";

const rows = [
  { conversation_id: "c1", user_id: "u1", nickname: "Szef" },
  { conversation_id: "c1", user_id: "u2", nickname: "  Analityk  " },
  { conversation_id: "c2", user_id: "u1", nickname: "Kolega" },
  { conversation_id: "c2", user_id: "u3", nickname: "   " },
];

function profile(id: string, name: string): PeerProfile {
  return {
    id,
    display_name: name,
    avatar_url: "",
    slug: "",
    current_company: "",
    job_title: "",
    specialization: "",
  };
}

const profiles = new Map<string, PeerProfile>([
  ["u1", profile("u1", "Ula Pierwsza")],
  ["u3", profile("u3", "Ola Trzecia")],
]);

describe("buildNicknameIndex", () => {
  it("groups rows by conversation and user", () => {
    const index = buildNicknameIndex(rows);
    expect(index.get("c1")?.get("u1")).toBe("Szef");
    expect(index.get("c2")?.get("u1")).toBe("Kolega");
    expect(index.get("c2")?.get("u2")).toBeUndefined();
  });

  it("keeps nicknames trimmed and drops whitespace-only entries", () => {
    const index = buildNicknameIndex(rows);
    expect(index.get("c1")?.get("u2")).toBe("Analityk");
    expect(index.get("c2")?.has("u3")).toBe(false);
  });

  it("returns an empty index for no rows", () => {
    expect(buildNicknameIndex([]).size).toBe(0);
  });
});

describe("nicknameFor / resolveMemberName", () => {
  const index = buildNicknameIndex(rows);

  it("resolves a nickname scoped to ONE conversation", () => {
    expect(nicknameFor(index, "c1", "u1")).toBe("Szef");
    expect(nicknameFor(index, "c2", "u1")).toBe("Kolega");
    expect(nicknameFor(index, "c3", "u1")).toBeNull();
    expect(nicknameFor(undefined, "c1", "u1")).toBeNull();
  });

  it("nickname wins over the profile display name", () => {
    expect(resolveMemberName(index, "c1", "u1", profiles)).toBe("Szef");
  });

  it("falls back to profile, then to the placeholder", () => {
    expect(resolveMemberName(index, "c1", "u3", profiles)).toBe("Ola Trzecia");
    expect(resolveMemberName(index, "c1", "u9", profiles)).toBe("...");
    expect(resolveMemberName(index, "c1", "u9", profiles, "?")).toBe("?");
  });
});

describe("conversationDisplay with nicknames", () => {
  const directView = {
    conversation: { id: "c1", kind: "direct", title: null },
    me: { user_id: "me" },
    peers: [{ user_id: "u1" }],
  } as unknown as ConversationView;

  it("direct thread: nickname overrides the peer's display name", () => {
    const withNick = conversationDisplay(directView, profiles, "…", new Map([["u1", "Szef"]]));
    expect(withNick.name).toBe("Szef");
    const withoutNick = conversationDisplay(directView, profiles, "…", undefined);
    expect(withoutNick.name).toBe("Ula Pierwsza");
  });

  it("group thread: the title stays authoritative", () => {
    const groupView = {
      conversation: { id: "c2", kind: "group", title: "Krąg energetyczny" },
      me: { user_id: "me" },
      peers: [{ user_id: "u1" }],
    } as unknown as ConversationView;
    const display = conversationDisplay(groupView, profiles, "…", new Map([["u1", "Szef"]]));
    expect(display.name).toBe("Krąg energetyczny");
    expect(display.isGroup).toBe(true);
  });
});
