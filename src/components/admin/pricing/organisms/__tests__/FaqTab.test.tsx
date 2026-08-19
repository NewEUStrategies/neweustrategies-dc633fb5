// Zakładka „FAQ cennika" - 0 z 8 funkcji pokrytych do 18.08.2026
// (mieszkała w pliku trasy `/admin/pricing`, 1821 linii).
//
// FAQ pod cennikiem odpowiada na pytania, które klient zadaje PRZED zakupem:
// „czy mogę zrezygnować", „czy dostanę fakturę". Reguła zapisu wymaga PEŁNEJ
// pary językowej - pytanie bez odpowiedzi po angielsku zniknęłoby w wersji
// angielskiej strony, zostawiając klienta bez odpowiedzi w chwili decyzji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  ok,
  pricingAudience,
  pricingFaqItem,
  radixSelectStub,
  radixSwitchStub,
  reactI18nextStub,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;
let lang = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const confirmStub = vi.fn(() => true);
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { FaqTab } = await import("@/components/admin/pricing/organisms/FaqTab");

const AUDIENCES = [
  pricingAudience({ key: "individual" }),
  pricingAudience({ id: "a2", key: "b2b", name_pl: "Firmy", name_en: "Companies" }),
];

function renderTab(items = [pricingFaqItem()], audiences = AUDIENCES) {
  return renderWithQueryClient(<FaqTab audiences={audiences} items={items} />);
}

/** Pola nowego pytania stoją PRZED polami pytań istniejących. */
function newQuestionField(index: number): HTMLElement {
  return screen.getAllByRole("textbox")[index];
}

function lastFaqCall() {
  return chain.lastChain("pricing_faq_items")!;
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("pricing_faq_items", ok([]));
  lang = "pl";
  toastSuccess.mockClear();
  toastError.mockClear();
  confirmStub.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmStub);
});

describe("FaqTab - lista pytań", () => {
  it("pokazuje pytanie w języku panelu", () => {
    renderTab();

    expect(screen.getByText("Czy mogę zrezygnować w każdej chwili?")).toBeInTheDocument();
  });

  it("po przełączeniu na angielski nagłówek pokazuje wersję angielską", () => {
    lang = "en";
    renderTab();

    expect(screen.getByText("Can I cancel at any time?")).toBeInTheDocument();
    expect(screen.queryByText("Czy mogę zrezygnować w każdej chwili?")).not.toBeInTheDocument();
  });

  it("brak pytań daje OGŁOSZONY komunikat", () => {
    renderTab([]);

    expect(screen.getByRole("status")).toHaveTextContent("adminPricing.faq.empty");
  });

  it("segment pytania wybiera się z listy z pozycją „globalne”", () => {
    renderTab();

    const options = screen.getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toContain("global");
    expect(options).toContain("b2b");
  });
});

describe("FaqTab - DODANIE pytania", () => {
  it("przycisk „dodaj” jest wyłączony, dopóki brakuje którejkolwiek z czterech treści", () => {
    renderTab([]);

    expect(screen.getByRole("button", { name: /faq\.add/ })).toBeDisabled();

    fireEvent.change(newQuestionField(0), { target: { value: "Pytanie" } });
    fireEvent.change(newQuestionField(1), { target: { value: "Question" } });
    fireEvent.change(newQuestionField(2), { target: { value: "Odpowiedź" } });
    expect(screen.getByRole("button", { name: /faq\.add/ })).toBeDisabled();

    fireEvent.change(newQuestionField(3), { target: { value: "Answer" } });
    expect(screen.getByRole("button", { name: /faq\.add/ })).toBeEnabled();
  });

  it("pytanie GLOBALNE zapisuje `audience_key` jako `null`", async () => {
    renderTab([pricingFaqItem()]);

    fireEvent.change(newQuestionField(0), { target: { value: " Pytanie " } });
    fireEvent.change(newQuestionField(1), { target: { value: "Question" } });
    fireEvent.change(newQuestionField(2), { target: { value: "Odpowiedź" } });
    fireEvent.change(newQuestionField(3), { target: { value: "Answer" } });
    fireEvent.click(screen.getByRole("button", { name: /faq\.add/ }));

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items")).toHaveLength(1));
    const inserted = lastFaqCall().argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted.audience_key).toBeNull();
    expect(inserted.question_pl).toBe("Pytanie");
  });

  it("nowe pytanie idzie na KONIEC listy (ostatnia kolejność + 10)", async () => {
    renderTab([pricingFaqItem({ sort_order: 40 })]);

    fireEvent.change(newQuestionField(0), { target: { value: "P" } });
    fireEvent.change(newQuestionField(1), { target: { value: "Q" } });
    fireEvent.change(newQuestionField(2), { target: { value: "O" } });
    fireEvent.change(newQuestionField(3), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: /faq\.add/ }));

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items")).toHaveLength(1));
    expect((lastFaqCall().argsOf("insert")?.[0] as { sort_order: number }).sort_order).toBe(50);
  });

  it("przypisanie nowego pytania do SEGMENTU zapisuje jego klucz, nie „global”", async () => {
    renderTab([pricingFaqItem()]);

    fireEvent.change(newQuestionField(0), { target: { value: "Pytanie" } });
    fireEvent.change(newQuestionField(1), { target: { value: "Question" } });
    fireEvent.change(newQuestionField(2), { target: { value: "Odpowiedź" } });
    fireEvent.change(newQuestionField(3), { target: { value: "Answer" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "b2b" } });
    fireEvent.click(screen.getByRole("button", { name: /faq\.add/ }));

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items")).toHaveLength(1));
    expect((lastFaqCall().argsOf("insert")?.[0] as Record<string, unknown>).audience_key).toBe(
      "b2b",
    );
  });

  it("BŁĄD dodania trafia do komunikatu, a wpisany tekst zostaje", async () => {
    chain.setResponse("pricing_faq_items", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    renderTab([pricingFaqItem()]);

    fireEvent.change(newQuestionField(0), { target: { value: "Pytanie" } });
    fireEvent.change(newQuestionField(1), { target: { value: "Question" } });
    fireEvent.change(newQuestionField(2), { target: { value: "Odpowiedź" } });
    fireEvent.change(newQuestionField(3), { target: { value: "Answer" } });
    fireEvent.click(screen.getByRole("button", { name: /faq\.add/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
    expect(newQuestionField(0)).toHaveValue("Pytanie");
  });

  it("udane dodanie CZYŚCI formularz nowego pytania", async () => {
    renderTab([pricingFaqItem()]);

    fireEvent.change(newQuestionField(0), { target: { value: "Pytanie" } });
    fireEvent.change(newQuestionField(1), { target: { value: "Question" } });
    fireEvent.change(newQuestionField(2), { target: { value: "Odpowiedź" } });
    fireEvent.change(newQuestionField(3), { target: { value: "Answer" } });
    fireEvent.click(screen.getByRole("button", { name: /faq\.add/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.faqAdded"));
    expect(newQuestionField(0)).toHaveValue("");
  });

  it("bez pytań I bez segmentów nie ma skąd wziąć tenanta - zapis odmawia", async () => {
    renderTab([], []);

    fireEvent.change(newQuestionField(0), { target: { value: "P" } });
    fireEvent.change(newQuestionField(1), { target: { value: "Q" } });
    fireEvent.change(newQuestionField(2), { target: { value: "O" } });
    fireEvent.change(newQuestionField(3), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: /faq\.add/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("adminPricing.toast.noTenant"));
    expect(chain.chainsFor("pricing_faq_items")).toHaveLength(0);
  });
});

describe("FaqTab - ZAPIS istniejącego pytania", () => {
  it("zapisuje przycięte treści pod właściwym identyfikatorem", async () => {
    renderTab([pricingFaqItem({ id: "faq-7" })]);

    fireEvent.click(screen.getAllByRole("button", { name: /faq\.save/ })[0]);

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items")).toHaveLength(1));
    expect(lastFaqCall().argsOf("eq")).toEqual(["id", "faq-7"]);
    expect(lastFaqCall().has("update")).toBe(true);
  });

  it("wyczyszczenie odpowiedzi angielskiej BLOKUJE zapis", () => {
    renderTab();

    const english = screen.getByDisplayValue("Yes, access runs until the end of the paid period.");
    fireEvent.change(english, { target: { value: "" } });

    expect(screen.getAllByRole("button", { name: /faq\.save/ })[0]).toBeDisabled();
  });

  it("przypisanie istniejącego pytania do segmentu i jego WYŁĄCZENIE zapisują się razem", async () => {
    renderTab([pricingFaqItem({ id: "faq-3", active: true })]);

    const rowSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(rowSelect, { target: { value: "individual" } });
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /faq\.save/ })[0]);

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items")).toHaveLength(1));
    const patch = lastFaqCall().argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ audience_key: "individual", active: false });
  });

  it("udany zapis pytania potwierdza komunikatem", async () => {
    renderTab();

    fireEvent.click(screen.getAllByRole("button", { name: /faq\.save/ })[0]);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.faqSaved"));
  });

  it("błąd zapisu trafia do komunikatu", async () => {
    chain.setResponse("pricing_faq_items", {
      data: null,
      error: Object.assign(new Error("row level security"), { name: "PostgrestError" }),
    });
    renderTab();

    fireEvent.click(screen.getAllByRole("button", { name: /faq\.save/ })[0]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("row level security"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("FaqTab - usunięcie i kolejność", () => {
  it("usuwa pytanie po potwierdzeniu", async () => {
    renderTab([pricingFaqItem({ id: "faq-9" })]);

    fireEvent.click(screen.getByRole("button", { name: /faq\.deleteTitle/ }));

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items")).toHaveLength(1));
    expect(lastFaqCall().has("delete")).toBe(true);
  });

  it("odwołane potwierdzenie nie usuwa niczego", async () => {
    confirmStub.mockReturnValue(false);
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /faq\.deleteTitle/ }));

    await waitFor(() => expect(confirmStub).toHaveBeenCalled());
    expect(chain.chainsFor("pricing_faq_items")).toHaveLength(0);
  });

  it("BŁĄD usunięcia trafia do komunikatu", async () => {
    chain.setResponse("pricing_faq_items", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    renderTab([pricingFaqItem()]);

    fireEvent.click(screen.getByRole("button", { name: /faq\.deleteTitle/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
  });

  it("udane usunięcie potwierdza komunikatem", async () => {
    renderTab([pricingFaqItem()]);

    fireEvent.click(screen.getByRole("button", { name: /faq\.deleteTitle/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.faqDeleted"));
  });

  it("jedno pytanie nie może iść ani w górę, ani w dół", () => {
    renderTab([pricingFaqItem()]);

    expect(screen.getByRole("button", { name: /faq\.moveUp/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /faq\.moveDown/ })).toBeDisabled();
  });

  it("przesunięcie zapisuje nową kolejność", async () => {
    renderTab([
      pricingFaqItem({ id: "f1", sort_order: 0 }),
      pricingFaqItem({ id: "f2", sort_order: 10, question_pl: "Drugie?" }),
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: /faq\.moveDown/ })[0]);

    await waitFor(() => expect(chain.chainsFor("pricing_faq_items").length).toBeGreaterThan(0));
    const ids = chain.chainsFor("pricing_faq_items").map((c) => c.argsOf("eq")?.[1]);
    expect(ids).toEqual(["f2", "f1"]);
  });
});

describe("FaqTab - DOSTĘPNOŚĆ pól (bramka po defekcie)", () => {
  // Do 19.08.2026 pytania i odpowiedzi nie miały dostępnych nazw - w formularzu,
  // który odpowiada klientowi na pytania zadawane PRZED zakupem.
  it("cztery pola treści i wybór segmentu mają dostępne nazwy", () => {
    renderTab([pricingFaqItem()]);

    for (const key of [
      "faq.questionPl",
      "faq.questionEn",
      "faq.answerPl",
      "faq.answerEn",
      "faq.audience",
    ]) {
      expect(screen.getAllByLabelText(`adminPricing.${key}`).length).toBeGreaterThan(0);
    }
  });

  it("pola nowego pytania i pola pytania istniejącego to OSOBNE pola", () => {
    renderTab([pricingFaqItem()]);

    const questions = screen.getAllByLabelText("adminPricing.faq.questionPl");
    expect(questions).toHaveLength(2);
    expect(questions[0].id).not.toBe(questions[1].id);
  });
});
