import { describe, expect, it } from "vitest";
import { parseSpeakerDetail } from "../speakerDetail";

describe("speaker detail fields", () => {
  it("preserves populated bio in both languages", () => {
    expect(parseSpeakerDetail({ bio_pl: "Biogram", bio_en: "Biography" })).toMatchObject({
      bioPl: "Biogram",
      bioEn: "Biography",
    });
  });
  it("only accepts http(s) social links", () => {
    expect(
      parseSpeakerDetail({
        social_links: {
          linkedin: "https://example.org/person",
          website: "javascript:alert(1)",
          x: "not a URL",
        },
      }).socials,
    ).toEqual({ linkedin: "https://example.org/person" });
  });
  it("does not invent contact when the safe projection withholds it", () => {
    expect(parseSpeakerDetail({ email: null, phone: null })).toMatchObject({
      email: "",
      phone: "",
    });
  });
  it("preserves valid provided contact", () => {
    expect(
      parseSpeakerDetail({ email: "speaker@example.org", phone: "+48 123 456 789" }),
    ).toMatchObject({ email: "speaker@example.org", phone: "+48 123 456 789" });
  });
});
