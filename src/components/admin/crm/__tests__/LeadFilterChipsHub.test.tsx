// Chipy filtrów listy CRM dodane w hubie S4 (P23): właściciel (zespół CRM),
// tagi (podpowiedzi + własny tag, limit odrzucany), stare źródło widoczne
// wyłącznie dla widoku, który je niesie.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_LEAD_FILTER } from "@/lib/crm/leadViews";
import { LeadFilterChips } from "../LeadFilterChips";

const STAGE_LABELS = {
  new: "Nowy",
  contacted: "Kontakt",
  qualified: "Kwalifikowany",
  proposal: "Oferta",
  won: "Wygrany",
  lost: "Przegrany",
  archived: "Archiwum",
};
const OWNERS = [
  { id: "11111111-1111-4111-8111-111111111111", label: "Anna Admin" },
  { id: "22222222-2222-4222-8222-222222222222", label: "Bartek Redaktor" },
];

afterEach(() => cleanup());

const openChip = async (name: RegExp) => {
  fireEvent.click(screen.getAllByRole("button", { name })[0]);
  return (await waitFor(() => {
    const el = document.querySelector("[data-radix-popper-content-wrapper]");
    expect(el).not.toBeNull();
    return el;
  })) as HTMLElement;
};

function mount(value = DEFAULT_LEAD_FILTER, opts: { noOwners?: boolean } = {}) {
  const owners = opts.noOwners ? undefined : OWNERS;
  const onChange = vi.fn();
  render(
    <LeadFilterChips
      lang="pl"
      value={value}
      onChange={onChange}
      stageLabels={STAGE_LABELS}
      countries={[]}
      tagOptions={["vip", "webinar-2026"]}
      owners={owners}
    />,
  );
  return onChange;
}

describe("LeadFilterChips - filtry huba S4", () => {
  it("właściciel: zaznaczenie dodaje id, odznaczenie ostatniego zdejmuje filtr", async () => {
    const onChange = mount();
    const popover = await openChip(/^Właściciel/);
    fireEvent.click(within(popover).getByLabelText("Bartek Redaktor"));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_LEAD_FILTER,
      ownerIds: ["22222222-2222-4222-8222-222222222222"],
    });
    cleanup();

    const onChange2 = mount({
      ...DEFAULT_LEAD_FILTER,
      ownerIds: ["22222222-2222-4222-8222-222222222222"],
    });
    expect(screen.getByText("Bartek Redaktor")).toBeInTheDocument();
    const popover2 = await openChip(/^Właściciel/);
    fireEvent.click(within(popover2).getByLabelText("Bartek Redaktor"));
    expect(onChange2).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, ownerIds: undefined });
  });

  it("bez listy zespołu chip właściciela się nie pokazuje", () => {
    mount(DEFAULT_LEAD_FILTER, { noOwners: true });
    expect(screen.queryByRole("button", { name: /^Właściciel/ })).toBeNull();
  });

  it("tagi: podpowiedź i własny tag; tag ponad 40 znaków nie przechodzi", async () => {
    const onChange = mount();
    const popover = await openChip(/^Tagi/);
    fireEvent.click(within(popover).getByRole("button", { name: "vip" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, tags: ["vip"] });

    const input = within(popover).getByRole("textbox", { name: "Tagi" });
    fireEvent.change(input, { target: { value: "x".repeat(41) } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(popover).getByRole("button", { name: "Dodaj tag" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "  partner  " } });
    fireEvent.click(within(popover).getByRole("button", { name: "Dodaj tag" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, tags: ["partner"] });
  });

  it("aktywne tagi: chip pokazuje liczbę, usunięcie ostatniego zdejmuje filtr", async () => {
    const onChange = mount({ ...DEFAULT_LEAD_FILTER, tags: ["vip", "partner"] });
    expect(screen.getByText("2 wybr.")).toBeInTheDocument();
    cleanup();
    const onChange2 = mount({ ...DEFAULT_LEAD_FILTER, tags: ["vip"] });
    const popover = await openChip(/^Tagi/);
    fireEvent.click(within(popover).getByRole("button", { name: "Usuń vip" }));
    expect(onChange2).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTER, tags: undefined });
    void onChange;
  });

  it("stare źródło: chip tylko dla widoku, który je niesie", () => {
    mount();
    expect(screen.queryByRole("button", { name: /^Źródło \(stary widok\)/ })).toBeNull();
    cleanup();
    mount({ ...DEFAULT_LEAD_FILTER, source: "import" });
    expect(screen.getAllByRole("button", { name: /^Źródło \(stary widok\)/ }).length).toBe(1);
  });
});
