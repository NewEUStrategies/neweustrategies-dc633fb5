// Regresja: każdy rodzaj wątku ma WŁASNY kształt ikony (żeby dyskusji nie dało
// się pomylić z sondażem bez czytania etykiety), a ikona własna wątku ma
// pierwszeństwo nad ikoną rodzaju.
import { describe, expect, it } from "vitest";
import { clubThreadKindIcon } from "@/components/clubs/atoms/ClubThreadKindIcon";

describe("clubThreadKindIcon", () => {
  it("daje różne ikony różnym rodzajom", () => {
    const kinds = ["discussion", "question", "position", "resource", "announcement", "poll"];
    const icons = kinds.map((k) => clubThreadKindIcon(k));
    expect(new Set(icons).size).toBe(kinds.length);
  });

  it("nieznany rodzaj degraduje się do dymka, nie wywraca listy", () => {
    expect(clubThreadKindIcon("legacy")).toBe(clubThreadKindIcon("discussion"));
    expect(clubThreadKindIcon(null)).toBe(clubThreadKindIcon(undefined));
  });
});
