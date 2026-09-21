// Kontekst notatki: publikacja materiału, czyszczenie po opuszczeniu widoku
// i odrzucanie identyfikatorów, których baza (uuid) nie przyjmie.
import { describe, expect, it, beforeEach } from "vitest";
import {
  clearNoteContext,
  getNoteContext,
  isNoteEntityType,
  isStorableEntityId,
  setNoteContext,
} from "../noteContext";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("noteContext", () => {
  beforeEach(() => setNoteContext(null));

  it("przechowuje materiał, do którego można przypiąć notatkę", () => {
    setNoteContext({ entityType: "post", entityId: UUID, title: "Raport", url: "/raport" });
    expect(getNoteContext()).toEqual({
      entityType: "post",
      entityId: UUID,
      title: "Raport",
      url: "/raport",
    });
  });

  it("czyści kontekst tylko dla tego samego materiału", () => {
    setNoteContext({ entityType: "podcast", entityId: UUID, title: "Odcinek", url: null });
    clearNoteContext("inny-id");
    expect(getNoteContext()?.entityId).toBe(UUID);
    clearNoteContext(UUID);
    expect(getNoteContext()).toBeNull();
  });

  it("waliduje rodzaj materiału i identyfikator", () => {
    expect(isNoteEntityType("podcast")).toBe(true);
    expect(isNoteEntityType("newsletter")).toBe(false);
    expect(isStorableEntityId(UUID)).toBe(true);
    expect(isStorableEntityId("slug-artykulu")).toBe(false);
  });
});
