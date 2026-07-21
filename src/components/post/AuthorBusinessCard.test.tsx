import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { AuthorBusinessCard } from "./AuthorBusinessCard";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

describe("AuthorBusinessCard", () => {
  it("renderuje wizytówkę autora z avatarem, bio i linkami social", () => {
    renderWithQueryClient(
      <AuthorBusinessCard
        lang="pl"
        name="Anna Kowalska"
        avatarUrl="https://example.com/avatar.jpg"
        href="/author/anna-kowalska"
        jobTitle="Redaktor"
        company="New European Strategies"
        bio="Ekspertka od polityki międzynarodowej."
        email="anna@example.com"
        linkedinUrl="https://linkedin.com/in/anna"
        xUrl="https://x.com/anna"
      />,
    );

    expect(screen.getByRole("img", { name: "Anna Kowalska" })).toHaveAttribute(
      "src",
      "https://example.com/avatar.jpg",
    );
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("Redaktor · New European Strategies")).toBeInTheDocument();
    // Kontrakt po redesignie: bio jest przyjmowane (kompatybilnosc propow),
    // ale karta go NIE wyswietla - pelne bio zyje na profilu autora.
    expect(screen.queryByText("Ekspertka od polityki międzynarodowej.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("LinkedIn")).toHaveAttribute(
      "href",
      "https://linkedin.com/in/anna",
    );
    expect(screen.getByLabelText("X")).toHaveAttribute("href", "https://x.com/anna");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("href", "mailto:anna@example.com");
    expect(screen.getByText("Zobacz profil")).toHaveAttribute("href", "/author/anna-kowalska");
  });

  it("fallbackuje do inicjałów, gdy brak avatara", () => {
    renderWithQueryClient(<AuthorBusinessCard lang="en" name="John Doe" />);
    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("nie renderuje sekcji social, gdy brak jakichkolwiek danych kontaktowych", () => {
    renderWithQueryClient(<AuthorBusinessCard lang="pl" name="Jan Nowak" bio="Krótkie bio." />);
    expect(screen.getByText("Jan Nowak")).toBeInTheDocument();
    // Bio jest zdeprecjonowane w karcie (nie renderuje sie), a sekcja social
    // bez danych kontaktowych w ogole nie powstaje.
    expect(screen.queryByText("Krótkie bio.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("E-mail")).not.toBeInTheDocument();
  });

  it("używa angielskich etykiet dla języka en", () => {
    renderWithQueryClient(
      <AuthorBusinessCard
        lang="en"
        name="Jane Smith"
        href="/author/jane"
        email="jane@example.com"
      />,
    );
    expect(screen.getByLabelText("About the author")).toBeInTheDocument();
    expect(screen.getByText("View profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
