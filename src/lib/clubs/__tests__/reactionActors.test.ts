import { describe, expect, it } from "vitest";
import { groupReactionActors, type ClubReactionActorRow } from "@/lib/clubs/types";

function row(over: Partial<ClubReactionActorRow>): ClubReactionActorRow {
  return {
    target_id: "t1",
    kind: "insightful",
    user_id: "u1",
    display_name: "Anna Kowalska",
    headline: "Analityczka",
    avatar_url: null,
    slug: "anna",
    is_me: false,
    actor_rank: 1,
    ...over,
  } as ClubReactionActorRow;
}

describe("groupReactionActors", () => {
  it("scala reakcje tej samej osoby w jedną twarz", () => {
    const map = groupReactionActors([row({}), row({ kind: "agree", actor_rank: 2 })]);
    const actors = map.get("t1") ?? [];
    expect(actors).toHaveLength(1);
    expect(actors[0]?.kinds).toEqual(["insightful", "agree"]);
  });

  it("stawia własną reakcję na początku", () => {
    const map = groupReactionActors([
      row({ user_id: "u1" }),
      row({ user_id: "u2", display_name: "Ja", is_me: true }),
    ]);
    expect(map.get("t1")?.[0]?.isMe).toBe(true);
  });

  it("nie scala anonimów bez id", () => {
    const map = groupReactionActors([
      row({ user_id: null, display_name: null, slug: null }),
      row({ user_id: null, display_name: null, slug: null, kind: "thanks" }),
    ]);
    expect(map.get("t1")).toHaveLength(2);
  });

  it("odrzuca nieznane rodzaje reakcji", () => {
    const map = groupReactionActors([row({ kind: "nonsense" })]);
    expect(map.size).toBe(0);
  });

  it("rozdziela cele", () => {
    const map = groupReactionActors([row({}), row({ target_id: "t2", user_id: "u3" })]);
    expect(map.get("t1")).toHaveLength(1);
    expect(map.get("t2")).toHaveLength(1);
  });
});
