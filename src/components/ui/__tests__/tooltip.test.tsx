// Atom kontraktowy: Tooltip nie może wysadzić strony tylko dlatego, że ktoś nie
// owinął go w TooltipProvider. Radix rzuca wtedy wyjątkiem renderowania, który
// przez globalny ErrorBoundary zamienia się w pełnoekranowy błąd - tak padał
// czat po kliknięciu reakcji na wiadomości.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../tooltip";

afterEach(cleanup);

function TooltipSample() {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button type="button">Trigger</button>
      </TooltipTrigger>
      <TooltipContent>Treść podpowiedzi</TooltipContent>
    </Tooltip>
  );
}

describe("Tooltip", () => {
  it("renders standalone, without any TooltipProvider ancestor", () => {
    expect(() => render(<TooltipSample />)).not.toThrow();
    expect(screen.getByText("Trigger")).toBeTruthy();
  });

  it("still renders under an explicit provider (no double mounting)", () => {
    render(
      <TooltipProvider delayDuration={200}>
        <TooltipSample />
      </TooltipProvider>,
    );
    expect(screen.getAllByText("Trigger")).toHaveLength(1);
  });
});
