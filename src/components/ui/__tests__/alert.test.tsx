// Alert ogłasza komunikat czytnikowi ekranu przez `role="alert"`. Wariant
// `destructive` ma osobną klasę dla ciemnego motywu (`dark:border-destructive`):
// w jasnym motywie ramka jest półprzezroczysta, w ciemnym pełna, bo inaczej
// znika na ciemnym tle. Test pilnuje obu wariantów i tej klasy.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Alert, AlertDescription } from "../alert";

afterEach(cleanup);

describe("Alert", () => {
  it("ogłasza komunikat rolą alert i domyślnie stosuje neutralne tokeny motywu", () => {
    render(
      <Alert>
        <AlertDescription>Zmiany zapisano.</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Zmiany zapisano.");
    expect(alert).toHaveClass("bg-background", "text-foreground", "rounded-lg", "border");
    expect(alert).not.toHaveClass("text-destructive");
  });

  it("wariant domyślny podany jawnie daje te same klasy co brak wariantu", () => {
    render(<Alert variant="default">Info</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("bg-background", "text-foreground");
  });

  it("wariant destrukcyjny ma pełną ramkę w ciemnym motywie i półprzezroczystą w jasnym", () => {
    render(
      <Alert variant="destructive">
        <svg data-testid="ikona" />
        <AlertDescription>Nie udało się zapisać.</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass(
      "text-destructive",
      "border-destructive/50",
      "dark:border-destructive",
      "[&>svg]:text-destructive",
    );
    expect(alert).not.toHaveClass("bg-background");
    expect(screen.getByTestId("ikona").parentElement).toBe(alert);
  });

  it("opis ma klasy typografii i przyjmuje klasę oraz ref wywołującego", () => {
    const alertRef = createRef<HTMLDivElement>();
    const descriptionRef = createRef<HTMLParagraphElement>();
    render(
      <Alert ref={alertRef} className="mb-4" aria-live="assertive">
        <AlertDescription ref={descriptionRef} className="font-medium">
          Treść
        </AlertDescription>
      </Alert>,
    );
    expect(alertRef.current).toHaveAttribute("role", "alert");
    expect(alertRef.current).toHaveAttribute("aria-live", "assertive");
    expect(alertRef.current).toHaveClass("mb-4");
    expect(descriptionRef.current).toHaveClass("text-sm", "[&_p]:leading-relaxed", "font-medium");
  });
});
