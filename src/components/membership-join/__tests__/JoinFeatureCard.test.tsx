// Karta korzyści / segmentu odbiorców na stronie „Dołącz do nas".
//
// RYZYKO. Karta jest wspólna dla filarów członkostwa i segmentów odbiorców,
// a numer porządkowy (`index`) steruje WYŁĄCZNIE opóźnieniem wejścia karty
// (kaskada animacji). Bez numeru (karta użyta pojedynczo) opóźnienie nie może
// stać się `NaNms` ani `undefinedms` - karta ma wtedy nie mieć żadnego stylu
// opóźnienia. Treść (nagłówek + opis) jest tym, co czyta osoba decydująca
// o członkostwie, więc nagłówek musi być nagłówkiem.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";

import { JoinFeatureCard } from "@/components/membership-join/molecules/JoinFeatureCard";

describe("JoinFeatureCard", () => {
  it("tytuł jest nagłówkiem trzeciego poziomu, a opis stoi pod nim", () => {
    render(<JoinFeatureCard icon={Users} title="Kluby dyskusyjne" body="Spotkania co miesiąc" />);

    expect(screen.getByRole("heading", { level: 3, name: "Kluby dyskusyjne" })).toBeInTheDocument();
    expect(screen.getByText("Spotkania co miesiąc")).toBeInTheDocument();
  });

  it("numer porządkowy przesuwa wejście karty o 60 ms na pozycję (kaskada)", () => {
    render(<JoinFeatureCard icon={Users} title="Trzecia" body="Opis" index={2} />);

    const card = screen.getByRole("article");
    expect(card.style.animationDelay).toBe("120ms");
  });

  it("pierwsza karta wchodzi bez opóźnienia", () => {
    render(<JoinFeatureCard icon={Users} title="Pierwsza" body="Opis" index={0} />);

    expect(screen.getByRole("article").style.animationDelay).toBe("0ms");
  });

  it("karta BEZ numeru nie dostaje żadnego stylu opóźnienia (żadnego „NaNms”)", () => {
    render(<JoinFeatureCard icon={Users} title="Samodzielna" body="Opis" />);

    const card = screen.getByRole("article");
    expect(card.getAttribute("style")).toBeNull();
    expect(card.outerHTML).not.toContain("NaN");
  });

  it("dodatkowa klasa z zewnątrz uzupełnia, a nie zastępuje wyglądu karty", () => {
    render(<JoinFeatureCard icon={Users} title="Z klasą" body="Opis" className="md:col-span-2" />);

    const card = screen.getByRole("article");
    expect(card.className).toContain("md:col-span-2");
    expect(card.className).toContain("rounded-[6px]");
  });
});
