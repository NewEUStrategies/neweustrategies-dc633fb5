import { describe, it, expect } from "vitest";
import { EDIT_CONFLICT_CODE, editConflictError, isEditConflict } from "../saveConflict";

describe("saveConflict (optimistic-lock kontrakt)", () => {
  it("editConflictError koduje prefiks + czytelny opis per encja", () => {
    const post = editConflictError("post");
    const page = editConflictError("page");
    expect(post).toBeInstanceOf(Error);
    expect(post.message.startsWith(EDIT_CONFLICT_CODE)).toBe(true);
    expect(post.message).toContain("ten wpis");
    expect(page.message).toContain("tę stronę");
  });

  it("isEditConflict wykrywa błąd konfliktu (Error i string)", () => {
    expect(isEditConflict(editConflictError("post"))).toBe(true);
    expect(isEditConflict(editConflictError("page"))).toBe(true);
    expect(isEditConflict(new Error(`${EDIT_CONFLICT_CODE}: cokolwiek`))).toBe(true);
    expect(isEditConflict(`${EDIT_CONFLICT_CODE}: raw`)).toBe(true);
  });

  it("isEditConflict NIE reaguje na inne błędy", () => {
    expect(isEditConflict(new Error("Save rejected - you do not have permission"))).toBe(false);
    expect(isEditConflict("network error")).toBe(false);
    expect(isEditConflict(null)).toBe(false);
    expect(isEditConflict(undefined)).toBe(false);
  });
});
