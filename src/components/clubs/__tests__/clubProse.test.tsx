// Typografia treści klubowej.
//
// CO PILNUJE. Że akapit jest jednostką (pusta linia rozdziela, pojedyncze
// złamanie zostaje w środku) i że wołacz porządkujący pisany wersalikami
// dostaje wyróżnienie śródtytułu - to dwie reguły, na których stoi czytelność
// najdłuższych tekstów w produkcie.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClubProse, isLeadIn, splitParagraphs } from "@/components/clubs/atoms/ClubProse";

describe("splitParagraphs", () => {
  it("dzieli po pustej linii i przycina białe znaki", () => {
    expect(splitParagraphs("Pierwszy\n\n  Drugi  \n\n\nTrzeci")).toEqual([
      "Pierwszy",
      "Drugi",
      "Trzeci",
    ]);
  });

  it("pojedyncze złamanie zostaje wewnątrz akapitu", () => {
    expect(splitParagraphs("Punkt 1\nPunkt 2")).toEqual(["Punkt 1\nPunkt 2"]);
  });

  it("pusta treść nie produkuje pustych akapitów", () => {
    expect(splitParagraphs("\n\n   \n")).toEqual([]);
  });
});

describe("isLeadIn", () => {
  it("rozpoznaje wołacz wersalikami", () => {
    expect(isLeadIn("PO PIERWSZE: korytarz nie ma finansowania.")).toBe(true);
  });

  it("zwykłe zdanie z dwukropkiem nie jest śródtytułem", () => {
    expect(isLeadIn("Komisja stwierdziła: brak danych o ruchu towarowym.")).toBe(false);
  });

  it("akapit bez dwukropka nigdy nie jest śródtytułem", () => {
    expect(isLeadIn("WNIOSEK KOŃCOWY")).toBe(false);
  });
});

describe("ClubProse", () => {
  it("renderuje jeden <p> na akapit", () => {
    const { container } = render(<ClubProse body={"Alfa\n\nBeta"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("pusta treść nie renderuje kontenera", () => {
    const { container } = render(<ClubProse body="   " />);
    expect(container.firstChild).toBeNull();
  });
});
