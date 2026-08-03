import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageComposerField } from "@/components/forms/MessageComposerField";

function Harness() {
  return (
    <MessageComposerField
      label="Wiadomość"
      value="tekst"
      onChange={() => undefined}
      maxLength={100}
    />
  );
}

describe("MessageComposerField", () => {
  it("renderuje pasek formatowania i licznik znaków", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Wiadomość")).toBeInTheDocument();
    expect(screen.getByText("5/100")).toBeInTheDocument();
  });

  it("nie renderuje przycisku załączania plików", () => {
    render(<Harness />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("czyści treść przyciskiem kosza", () => {
    let value = "abc";
    const onChange = (next: string) => {
      value = next;
    };
    render(
      <MessageComposerField label="Wiadomość" value="abc" onChange={onChange} maxLength={50} />,
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(value).toBe("");
  });
});
