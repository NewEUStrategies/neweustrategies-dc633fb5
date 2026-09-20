// PRZEDMIOT DOWODU: `accept` przestaje być dekoracją przy UPUSZCZENIU pliku.
//
// Przeglądarka egzekwuje `accept` wyłącznie w oknie systemowym wyboru pliku.
// Ujednolicenie obszarów wgrywania dało wszystkim polom platformy przyjmowanie
// upuszczonego pliku, więc ta funkcja jest jedynym miejscem, w którym „wolno
// tylko obrazy" zaczyna cokolwiek znaczyć dla gestu przeciągnij-i-upuść.
// Zgłoszenia Codeksa (P2) do `CoverImagePicker` i `ImageSlot` mówiły dokładnie
// o tej luce: upuszczony PDF szedł wprost do publicznego bucketu.
import { describe, expect, it } from "vitest";

import { matchesAccept } from "../acceptMatch";

const plik = (name: string, type = ""): File => new File(["x"], name, { type });

describe("matchesAccept", () => {
  it("bez `accept` przepuszcza wszystko - tak jak brak atrybutu w HTML", () => {
    expect(matchesAccept(plik("cokolwiek.bin"), undefined)).toBe(true);
    expect(matchesAccept(plik("cokolwiek.bin"), "")).toBe(true);
    expect(matchesAccept(plik("cokolwiek.bin"), "   ,  ")).toBe(true);
  });

  it("rodzina typów (`image/*`) bierze każdy obraz i odrzuca resztę", () => {
    expect(matchesAccept(plik("a.png", "image/png"), "image/*")).toBe(true);
    expect(matchesAccept(plik("a.avif", "image/avif"), "image/*")).toBe(true);
    expect(matchesAccept(plik("a.pdf", "application/pdf"), "image/*")).toBe(false);
    // `image/*` NIE łapie `imagex/...` - gwiazdka zastępuje podtyp, nie sufiks.
    expect(matchesAccept(plik("a.x", "imagex/png"), "image/*")).toBe(false);
  });

  it("pełny typ MIME dopasowuje się dokładnie i bez względu na wielkość liter", () => {
    expect(matchesAccept(plik("a.pdf", "application/pdf"), "application/pdf")).toBe(true);
    expect(matchesAccept(plik("a.pdf", "APPLICATION/PDF"), "application/pdf")).toBe(true);
    expect(matchesAccept(plik("a.png", "image/png"), "application/pdf")).toBe(false);
  });

  it("rozszerzenie działa TAKŻE dla pliku bez typu - systemy bywają milczące", () => {
    // Windows bez skojarzonego typu oddaje pusty `file.type`; wtedy jedynym
    // sygnałem jest nazwa i bez tej gałęzi font albo CSV z upuszczenia odpadał.
    expect(matchesAccept(plik("krój.woff2"), ".woff2,.woff,.ttf,.otf")).toBe(true);
    expect(matchesAccept(plik("LISTA.CSV"), ".csv")).toBe(true);
    expect(matchesAccept(plik("lista.tsv"), ".csv")).toBe(false);
  });

  it("pusty typ NIE jest uniwersalnym kluczem do pozycji z pełnym MIME", () => {
    // Inaczej plik bez typu przechodziłby przez każdą allowlistę MIME.
    expect(matchesAccept(plik("zagadka"), "application/pdf")).toBe(false);
    expect(matchesAccept(plik("zagadka"), "image/*")).toBe(false);
  });

  it("lista pozycji jest alternatywą - wystarczy jedno trafienie", () => {
    const accept = "image/jpeg,image/png,.webp";
    expect(matchesAccept(plik("a.jpg", "image/jpeg"), accept)).toBe(true);
    expect(matchesAccept(plik("a.webp"), accept)).toBe(true);
    expect(matchesAccept(plik("a.gif", "image/gif"), accept)).toBe(false);
  });

  it("znosi spacje i wielkie litery w samym `accept`", () => {
    expect(matchesAccept(plik("a.png", "image/png"), " IMAGE/PNG , .WEBP ")).toBe(true);
    expect(matchesAccept(plik("a.webp"), " IMAGE/PNG , .WEBP ")).toBe(true);
  });
});
