// Kontrakt hierarchii działów: rodzic wynika ze slugu, nie z kolumny w bazie.
import { describe, expect, it } from "vitest";
import {
  buildClubGroupTree,
  clubGroupPath,
  findClubGroupNode,
  flattenClubGroupTree,
} from "../groupTree";
import type { ClubGroupRow } from "../types";

function group(slug: string, threads = 1): ClubGroupRow {
  return {
    id: slug,
    slug,
    name_pl: slug,
    name_en: slug,
    description_pl: null,
    description_en: null,
    icon: null,
    accent_color: null,
    thread_count: threads,
    can_read: true,
  } as unknown as ClubGroupRow;
}

describe("buildClubGroupTree", () => {
  it("zagnieżdża podgrupy po prefiksie slugu i wybiera najdłuższy prefiks", () => {
    const tree = buildClubGroupTree([
      group("bezpieczenstwo"),
      group("bezpieczenstwo-cyber"),
      group("bezpieczenstwo-cyber-nis2"),
      group("energetyka"),
    ]);
    expect(tree.map((n) => n.group.slug)).toEqual(["bezpieczenstwo", "energetyka"]);
    expect(tree[0].children[0].group.slug).toBe("bezpieczenstwo-cyber");
    expect(tree[0].children[0].children[0].group.slug).toBe("bezpieczenstwo-cyber-nis2");
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it("sumuje wątki gałęzi w totalThreads", () => {
    const tree = buildClubGroupTree([group("a", 2), group("a-b", 3), group("a-b-c", 4)]);
    expect(tree[0].totalThreads).toBe(9);
    expect(tree[0].children[0].totalThreads).toBe(7);
  });

  it("zostaje płaskie, gdy slugi nie niosą konwencji", () => {
    const tree = buildClubGroupTree([group("alfa"), group("beta")]);
    expect(tree).toHaveLength(2);
    expect(flattenClubGroupTree(tree)).toHaveLength(2);
  });

  it("zwraca ścieżkę i węzeł wybranego działu", () => {
    const tree = buildClubGroupTree([group("a"), group("a-b")]);
    expect(clubGroupPath(tree, "a-b").map((n) => n.group.slug)).toEqual(["a", "a-b"]);
    expect(findClubGroupNode(tree, "a-b")?.group.slug).toBe("a-b");
    expect(findClubGroupNode(tree, null)).toBeNull();
  });
});
