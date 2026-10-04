import { describe, expect, it } from "vitest";
import { altMarksLogo } from "../logoAlt";

describe("altMarksLogo", () => {
  it.each([
    "Logo",
    "LOGO",
    "logo",
    "Logo NES",
    "NES logo",
    "NES-logo",
    "Logo: New European Strategies",
    "(logo)",
    "Logotyp NES",
    "logotypu NES",
    "Partner logos",
    "Company logotype",
    "Logo 2",
  ])("rozpoznaje logo w %j", (alt) => {
    expect(altMarksLogo(alt)).toBe(true);
  });

  it.each([
    "Zegar analogowy",
    "analogowy",
    "Ekologowie protestują",
    "Ekran logowania",
    "logowanie",
    "Dialog społeczny",
    "Apologia",
    "Katalog wystaw",
    "neologizm",
    "Złogo",
    "Monolog",
    // Cyfra należy do słowa, tak jak litera: „Logo2” to inny wyraz niż „logo”.
    "Logo2",
    "",
  ])("nie traktuje %j jako logo", (alt) => {
    expect(altMarksLogo(alt)).toBe(false);
  });

  it("odrzuca brak tekstu", () => {
    expect(altMarksLogo(undefined)).toBe(false);
    expect(altMarksLogo(null)).toBe(false);
  });
});
