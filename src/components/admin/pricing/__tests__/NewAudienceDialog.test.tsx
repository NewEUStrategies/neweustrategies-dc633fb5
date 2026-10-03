// Okno „nowy segment odbiorców" w panelu Cennika.
//
// RYZYKO. Klucz segmentu trafia do adresu (`/pricing?audience=...`) i do
// `membership_tiers.audience_key`. Segment o kluczu ZAJĘTYM przez istniejący
// zlałby dwie zakładki cennika w jedną (warstwy jednego segmentu pokazałyby
// się w drugim), a klucz w złym formacie odpada przy walidacji adresu - czyli
// zakładka, której nie da się otworzyć linkiem z kampanii. Okno ma więc
// wyłącznie trzy obowiązki: nie wypuścić złego klucza, nie wypuścić segmentu
// bez nazwy w OBU językach i nie utworzyć niczego, gdy redakcja się wycofa.
//
// Atrapowany jest wyłącznie słownik (echo klucza). Reguła klucza
// (`audienceKeyValid`) i okno Radiksa biegną prawdziwe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());

import { NewAudienceDialog } from "@/components/admin/pricing/molecules/NewAudienceDialog";

type CreatePayload = { key: string; name_pl: string; name_en: string };
let onCreate: ReturnType<typeof vi.fn<(v: CreatePayload) => void>>;

beforeEach(() => {
  onCreate = vi.fn<(v: CreatePayload) => void>();
});

function renderDialog({ existing = ["individual", "business"], isPending = false } = {}) {
  return render(
    <NewAudienceDialog existingKeys={existing} onCreate={onCreate} isPending={isPending} />,
  );
}

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "adminPricing.audiences.new" }));
  return screen.findByRole("dialog");
}

function fill(dialog: HTMLElement, values: { key?: string; pl?: string; en?: string }) {
  if (values.key !== undefined)
    fireEvent.change(within(dialog).getByLabelText("adminPricing.audiences.key"), {
      target: { value: values.key },
    });
  if (values.pl !== undefined)
    fireEvent.change(within(dialog).getByLabelText("adminPricing.audiences.namePl"), {
      target: { value: values.pl },
    });
  if (values.en !== undefined)
    fireEvent.change(within(dialog).getByLabelText("adminPricing.audiences.nameEn"), {
      target: { value: values.en },
    });
}

function createButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("button", { name: "adminPricing.audiences.create" });
}

describe("NewAudienceDialog - klucz segmentu", () => {
  it("klucz wpisany wielkimi literami jest sprowadzany do małych - tak jak w adresie", async () => {
    renderDialog();
    const dialog = await openDialog();

    fill(dialog, { key: "Media", pl: "Media", en: "Media" });
    fireEvent.click(createButton(dialog));

    expect(onCreate).toHaveBeenCalledWith({ key: "media", name_pl: "Media", name_en: "Media" });
  });

  it("klucz ZAJĘTY przez istniejący segment blokuje utworzenie", async () => {
    renderDialog({ existing: ["individual", "business"] });
    const dialog = await openDialog();

    fill(dialog, { key: "business", pl: "Firmy", en: "Business" });

    expect(createButton(dialog)).toBeDisabled();
  });

  it("klucz w złym formacie (spacja, jeden znak) blokuje utworzenie", async () => {
    renderDialog();
    const dialog = await openDialog();

    fill(dialog, { key: "dla firm", pl: "Firmy", en: "Business" });
    expect(createButton(dialog)).toBeDisabled();

    fill(dialog, { key: "b" });
    expect(createButton(dialog)).toBeDisabled();
  });
});

describe("NewAudienceDialog - nazwy w obu językach", () => {
  it("brak nazwy angielskiej (same spacje) blokuje utworzenie", async () => {
    renderDialog();
    const dialog = await openDialog();

    fill(dialog, { key: "media", pl: "Media", en: "   " });

    expect(createButton(dialog)).toBeDisabled();
  });

  it("komplet danych odblokowuje utworzenie, a trwający zapis znów je blokuje", async () => {
    const view = renderDialog();
    const dialog = await openDialog();
    fill(dialog, { key: "media", pl: "Media", en: "Media" });
    expect(createButton(dialog)).toBeEnabled();

    view.rerender(
      <NewAudienceDialog existingKeys={["individual"]} onCreate={onCreate} isPending />,
    );

    expect(createButton(screen.getByRole("dialog"))).toBeDisabled();
  });
});

describe("NewAudienceDialog - zamknięcie okna", () => {
  it("udane utworzenie zamyka okno i czyści pola przed następnym segmentem", async () => {
    renderDialog();
    let dialog = await openDialog();
    fill(dialog, { key: "media", pl: "Media", en: "Media" });

    fireEvent.click(createButton(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    dialog = await openDialog();
    expect(within(dialog).getByLabelText("adminPricing.audiences.key")).toHaveValue("");
    expect(within(dialog).getByLabelText("adminPricing.audiences.namePl")).toHaveValue("");
    expect(within(dialog).getByLabelText("adminPricing.audiences.nameEn")).toHaveValue("");
  });

  it("„anuluj” zamyka okno i NIE tworzy segmentu, nawet z kompletem danych", async () => {
    renderDialog();
    const dialog = await openDialog();
    fill(dialog, { key: "media", pl: "Media", en: "Media" });

    fireEvent.click(within(dialog).getByRole("button", { name: "adminPricing.audiences.cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onCreate).not.toHaveBeenCalled();
  });
});
