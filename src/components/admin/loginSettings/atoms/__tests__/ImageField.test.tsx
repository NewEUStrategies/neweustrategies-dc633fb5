import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageField } from "@/components/admin/loginSettings/atoms/ImageField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { label?: string }) =>
      values?.label ? `${key}:${values.label}` : key,
  }),
}));

vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    title,
    onPick,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    onPick: (url: string) => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => onPick("https://example.test/picked.jpg")}>
          pick-test
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          close-test
        </button>
      </div>
    ) : null,
}));

afterEach(cleanup);

describe("ImageField", () => {
  it("wiąże pole URL z etykietą i pokazuje stan bez obrazu", () => {
    render(<ImageField label="Obraz jasny" value="" onChange={vi.fn()} hint="WebP" />);

    expect(screen.getByRole("textbox", { name: "Obraz jasny" })).toBeInTheDocument();
    expect(screen.getByText("adminLoginSettings.noImage")).toBeInTheDocument();
    expect(screen.getByText("WebP")).toBeInTheDocument();
  });

  it("pokazuje obraz wartości i pozwala go wyczyścić", () => {
    const onChange = vi.fn();
    render(
      <ImageField
        label="Obraz ciemny"
        value="https://example.test/dark.jpg"
        onChange={onChange}
        previewBg="dark"
        icon="dark"
      />,
    );

    expect(screen.getByRole("img", { name: "Obraz ciemny" })).toHaveAttribute(
      "src",
      "https://example.test/dark.jpg",
    );
    fireEvent.click(screen.getByRole("button", { name: /adminLoginSettings.clear/ }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("oznacza obraz zapasowy i zachowuje proporcje podglądu", () => {
    const { container } = render(
      <ImageField
        label="Hero"
        value=""
        fallbackUrl="/fallback.jpg"
        aspect="4 / 3"
        previewBg="light"
        icon="light"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Hero" })).toHaveAttribute("src", "/fallback.jpg");
    expect(screen.getByText("adminLoginSettings.defaultBadge")).toBeInTheDocument();
    expect(container.querySelector('[style*="4 / 3"]')).toBeInTheDocument();
  });

  it("przekazuje ręcznie wpisany URL", () => {
    const onChange = vi.fn();
    render(<ImageField label="Tło" value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Tło" }), {
      target: { value: "https://example.test/new.jpg" },
    });

    expect(onChange).toHaveBeenCalledWith("https://example.test/new.jpg");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("otwiera picker, przyjmuje wybór i zamyka dialog", () => {
    const onChange = vi.fn();
    render(<ImageField label="Tło" value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /adminLoginSettings.pick$/ }));
    expect(
      screen.getByRole("dialog", { name: "adminLoginSettings.pickImage:Tło" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "pick-test" }));
    expect(onChange).toHaveBeenCalledWith("https://example.test/picked.jpg");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stan wyłączony blokuje pole i przycisk wyboru", () => {
    render(<ImageField label="Tło" value="" onChange={vi.fn()} disabled />);

    expect(screen.getByRole("textbox", { name: "Tło" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /adminLoginSettings.pick$/ })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
