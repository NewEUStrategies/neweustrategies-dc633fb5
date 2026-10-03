// HoverCard pokazuje podgląd po najechaniu myszą ALBO po ustawieniu ogniska
// klawiaturą na wyzwalaczu - ta druga droga jest jedyną dla użytkownika bez
// myszy. Dotyk jest celowo pomijany (stuknięcie ma przejść do linku). Escape
// zamyka podgląd. Domyślne wyrównanie `start` i odstęp 6 px to gałęzie
// opakowania. Kolory z tokenów `popover`, wspólnych dla motywów.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../hover-card";

afterEach(cleanup);

function Sample({ align }: { align?: "start" | "center" | "end" }) {
  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger href="/eksperci/anna">Anna Nowak</HoverCardTrigger>
      <HoverCardContent align={align} data-testid="podglad">
        Ekspertka ds. energetyki
      </HoverCardContent>
    </HoverCard>
  );
}

const trigger = () => screen.getByRole("link", { name: "Anna Nowak" });

describe("HoverCard", () => {
  it("wyzwalacz pozostaje zwykłym linkiem, a podgląd jest zamknięty", () => {
    render(<Sample />);
    expect(trigger()).toHaveAttribute("href", "/eksperci/anna");
    expect(trigger()).toHaveAttribute("data-state", "closed");
    expect(screen.queryByTestId("podglad")).toBeNull();
  });

  it("otwiera podgląd po najechaniu myszą i zamyka po zjechaniu", async () => {
    render(<Sample />);
    fireEvent.pointerEnter(trigger(), { pointerType: "mouse" });
    const card = await screen.findByTestId("podglad");
    expect(card).toHaveTextContent("Ekspertka ds. energetyki");
    expect(trigger()).toHaveAttribute("data-state", "open");
    fireEvent.pointerLeave(trigger(), { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByTestId("podglad")).toBeNull());
  });

  it("nie otwiera podglądu przy dotyku, żeby stuknięcie przeszło do linku", async () => {
    render(<Sample />);
    fireEvent.pointerEnter(trigger(), { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId("podglad")).toBeNull();
  });

  it("otwiera podgląd z klawiatury po ustawieniu ogniska i zamyka po jego utracie", async () => {
    render(<Sample />);
    fireEvent.focus(trigger());
    expect(await screen.findByTestId("podglad")).toBeInTheDocument();
    fireEvent.blur(trigger());
    await waitFor(() => expect(screen.queryByTestId("podglad")).toBeNull());
  });

  it("zamyka podgląd klawiszem Escape", async () => {
    render(<Sample />);
    fireEvent.focus(trigger());
    const card = await screen.findByTestId("podglad");
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("podglad")).toBeNull());
  });

  it("domyślnie wyrównuje podgląd do początku wyzwalacza i rysuje go tokenami motywu", async () => {
    render(<Sample />);
    fireEvent.focus(trigger());
    const card = await screen.findByTestId("podglad");
    await waitFor(() => expect(card).toHaveAttribute("data-align", "start"));
    expect(card).toHaveClass(
      "z-50",
      "w-72",
      "border-border",
      "bg-popover",
      "text-popover-foreground",
      "shadow-lg",
    );
  });

  it("przyjmuje jawne wyrównanie, klasę wywołującego i ref", async () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <HoverCard defaultOpen>
        <HoverCardTrigger href="#">X</HoverCardTrigger>
        <HoverCardContent ref={ref} align="end" sideOffset={2} className="w-96">
          Treść
        </HoverCardContent>
      </HoverCard>,
    );
    await waitFor(() => expect(ref.current).toHaveAttribute("data-align", "end"));
    expect(ref.current).toHaveClass("w-96", "bg-popover");
    expect(ref.current).not.toHaveClass("w-72");
  });
});
