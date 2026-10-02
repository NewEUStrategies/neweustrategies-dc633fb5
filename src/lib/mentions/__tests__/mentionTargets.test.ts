// Dekodowanie sluga firmy - `decodeOrganizationMentionSlug`.
//
// To jest JEDYNE miejsce w kliencie, które decyduje „ten slug to firma".
// Na nim stoją: podział katalogu (osoby kontra RPC firm), etykieta
// nierozwiązanej wzmianki („Firma" zamiast UUID) i trasa `/organization`.
// Wzorzec jest lustrem bazy (`get_mention_target`): `org-` + UUID.
import { describe, expect, it } from "vitest";
import { decodeOrganizationMentionSlug } from "@/lib/mentions/mentionTargets";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("decodeOrganizationMentionSlug", () => {
  it("oddaje identyfikator rekordu ze sluga `org-<uuid>`", () => {
    expect(decodeOrganizationMentionSlug(`org-${ID}`)).toBe(ID);
  });

  it("normalizuje identyfikator do małych liter", () => {
    expect(decodeOrganizationMentionSlug(`org-${ID.toUpperCase()}`)).toBe(ID);
  });

  it.each([
    ["slug osoby", "anna-nowak"],
    ["prefiks bez identyfikatora", "org-"],
    ["prefiks z nazwą zamiast id", "org-chart"],
    ["goły UUID bez prefiksu", ID],
    ["prefiks wielkimi literami (slug nie jest kanoniczny)", `ORG-${ID}`],
    ["UUID z doklejonym ogonem", `org-${ID}-x`],
    ["pusty napis", ""],
  ])("%s to NIE firma", (_opis, slug) => {
    expect(decodeOrganizationMentionSlug(slug)).toBeNull();
  });
});
