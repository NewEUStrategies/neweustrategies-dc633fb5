// Sekcja statusu workflow w panelu edytora wpisu - BRAMKA PUBLIKACJI.
//
// CO TU DOWODZIMY:
//   * opcje zarezerwowane dla wydawcy (`publisherOnly`: „zaplanowany",
//     „opublikowany") są dla autora/redaktora NIEDOSTĘPNE i jawnie oznaczone,
//   * autor bez prawa publikacji dostaje ścieżkę „zgłoś do recenzji", a wydawca
//     w recenzji - parę „zatwierdź i opublikuj" / „odrzuć do szkicu",
//   * harmonogram: pole daty pojawia się TYLKO dla statusu „zaplanowany",
//     tłumaczy ISO na czas lokalny i z powrotem, a przeterminowany termin dostaje
//     OSTRZEŻENIE (inaczej wpis nigdy się nie opublikuje, a redakcja o tym nie wie),
//   * `busy` blokuje wszystkie akcje zmiany statusu (żadnego podwójnego wysłania).
//
// DLACZEGO TO WAŻNE: ta sekcja jest jedynym miejscem, w którym treść przechodzi
// z redakcji do świata. Przeciek opcji „opublikowany" do autora omija recenzję
// (kontrola redakcyjna to zapora reputacyjna i prawna); brak ostrzeżenia o
// terminie w przeszłości daje ciche „zaplanowane na zawsze"; zła konwersja daty
// publikuje wpis o innej godzinie, niż uzgodniono z embargiem.
//
// Asercje idą po KLUCZACH i18n (stub zwraca klucz + serializowane parametry).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BASE_ISO, isoOffset, statusOptions } from "@/test/post-editor/fixtures";
import type { PostWorkflowStatus, StatusOption } from "@/lib/content/workflow";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

// Radixowy <Select> nie otwiera listy w happy-dom (mierzy geometrię i chodzi po
// pointer events), a testowana reguła siedzi w opcjach i w `onValueChange`.
// Atrapa oddaje NATYWNY <select> z tą samą strukturą opcji, więc `disabled`
// z `publisherOnly` jest widoczny tak samo jak w produkcji.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Node = React.ReactNode;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children?: Node;
    }) =>
      React.createElement(
        "select",
        {
          value,
          onChange: (e: { target: { value: string } }) => onValueChange?.(e.target.value),
        },
        children as never,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: Node }) =>
      React.createElement(React.Fragment, null, children as never),
    SelectItem: ({
      value,
      disabled,
      children,
    }: {
      value: string;
      disabled?: boolean;
      children?: Node;
    }) => React.createElement("option", { value, disabled }, children as never),
  };
});

import { WorkflowStatusSection } from "../WorkflowStatusSection";

interface Overrides {
  status?: PostWorkflowStatus;
  publishAt?: string | null;
  publishedAt?: string | null;
  canPublish?: boolean;
  busy?: boolean;
  statusOptions?: StatusOption[];
  scheduledInPast?: boolean;
  uiLang?: string;
}

function renderSection(overrides: Overrides = {}) {
  const onStatusChange = vi.fn<(s: PostWorkflowStatus) => void>();
  const onPublishAtChange = vi.fn<(iso: string | null) => void>();
  const onApplyStatus = vi.fn<(s: PostWorkflowStatus) => void>();
  const canPublish = overrides.canPublish ?? true;
  const view = render(
    <WorkflowStatusSection
      status={overrides.status ?? "draft"}
      publishAt={overrides.publishAt ?? null}
      publishedAt={overrides.publishedAt ?? null}
      canPublish={canPublish}
      busy={overrides.busy ?? false}
      statusOptions={overrides.statusOptions ?? statusOptions(canPublish)}
      scheduledInPast={overrides.scheduledInPast ?? false}
      uiLang={overrides.uiLang ?? "pl-PL"}
      onStatusChange={onStatusChange}
      onPublishAtChange={onPublishAtChange}
      onApplyStatus={onApplyStatus}
    />,
  );
  return { ...view, onStatusChange, onPublishAtChange, onApplyStatus };
}

const statusSelect = () => screen.getByRole("combobox") as HTMLSelectElement;
const option = (status: PostWorkflowStatus) =>
  screen.getByRole("option", { name: new RegExp(`^admin\\.status\\.${status}`) }) as
    HTMLOptionElement | HTMLElement;
const dateField = (container: HTMLElement) =>
  container.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;

/** Niezależne od kodu produkcyjnego wyliczenie wartości `datetime-local`. */
function localInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("WorkflowStatusSection - bramka publikacji w liście statusów", () => {
  it("wydawca widzi wszystkie statusy odblokowane i bez adnotacji o uprawnieniach", () => {
    renderSection({ canPublish: true });

    expect(screen.getAllByRole("option")).toHaveLength(5);
    for (const s of ["draft", "pending_review", "scheduled", "published", "archived"] as const) {
      expect(option(s)).not.toBeDisabled();
    }
    expect(screen.queryByText(/admin\.workflow\.adminOnly/)).not.toBeInTheDocument();
  });

  it("autor NIE MOŻE wybrać publikacji ani harmonogramu - opcje są zablokowane", () => {
    renderSection({ canPublish: false });

    expect(option("published")).toBeDisabled();
    expect(option("scheduled")).toBeDisabled();
  });

  it("zablokowane opcje mówią WPROST, że są tylko dla wydawcy", () => {
    renderSection({ canPublish: false });

    expect(option("published")).toHaveTextContent("admin.workflow.adminOnly");
    expect(option("scheduled")).toHaveTextContent("admin.workflow.adminOnly");
  });

  it("autorowi zostają statusy w jego zasięgu (szkic, do recenzji, archiwum)", () => {
    renderSection({ canPublish: false });

    for (const s of ["draft", "pending_review", "archived"] as const) {
      expect(option(s)).not.toBeDisabled();
      expect(option(s)).not.toHaveTextContent("admin.workflow.adminOnly");
    }
  });

  it("autor dostaje wyjaśnienie, dlaczego część statusów jest niedostępna", () => {
    renderSection({ canPublish: false });

    expect(screen.getByText("admin.workflow.writerHint")).toBeInTheDocument();
  });

  it("wydawcy nie zaśmiecamy wyjaśnieniem dla autorów", () => {
    renderSection({ canPublish: true });

    expect(screen.queryByText("admin.workflow.writerHint")).not.toBeInTheDocument();
  });

  it("etykieta listy statusów jest brana z kluczy panelu", () => {
    renderSection();

    expect(screen.getByText("admin.posts.status")).toBeInTheDocument();
  });

  it("wybrany status jest wartością listy, a zmiana zgłasza nowy status", () => {
    const { onStatusChange } = renderSection({ status: "draft" });
    expect(statusSelect().value).toBe("draft");

    fireEvent.change(statusSelect(), { target: { value: "pending_review" } });

    expect(onStatusChange).toHaveBeenCalledWith("pending_review");
  });
});

describe("WorkflowStatusSection - harmonogram publikacji", () => {
  it("pole terminu istnieje TYLKO dla statusu zaplanowanego", () => {
    const { container, unmount } = renderSection({ status: "draft" });
    expect(dateField(container)).toBeNull();
    unmount();

    const scheduled = renderSection({ status: "scheduled", publishAt: BASE_ISO });
    expect(dateField(scheduled.container)).not.toBeNull();
    expect(screen.getByText("admin.workflow.publishAt")).toBeInTheDocument();
  });

  it("ISO z bazy pokazuje się jako czas LOKALNY redakcji", () => {
    const { container } = renderSection({ status: "scheduled", publishAt: BASE_ISO });

    expect(dateField(container)?.value).toBe(localInputValue(BASE_ISO));
  });

  it("brak terminu daje puste pole, a nie Invalid Date", () => {
    const { container } = renderSection({ status: "scheduled", publishAt: null });

    expect(dateField(container)?.value).toBe("");
  });

  it("wpisany czas lokalny wraca do rodzica jako ISO w UTC", () => {
    const { container, onPublishAtChange } = renderSection({
      status: "scheduled",
      publishAt: BASE_ISO,
    });
    const local = "2026-09-01T08:30";

    fireEvent.change(dateField(container) as HTMLInputElement, { target: { value: local } });

    expect(onPublishAtChange).toHaveBeenCalledWith(new Date(local).toISOString());
  });

  it("wyczyszczenie pola zgłasza brak terminu (null), nie pusty napis", () => {
    const { container, onPublishAtChange } = renderSection({
      status: "scheduled",
      publishAt: BASE_ISO,
    });

    fireEvent.change(dateField(container) as HTMLInputElement, { target: { value: "" } });

    expect(onPublishAtChange).toHaveBeenCalledWith(null);
  });

  it("bez terminu podpowiedź MÓWI, że termin jest wymagany", () => {
    renderSection({ status: "scheduled", publishAt: null });

    expect(screen.getByText("admin.workflow.publishAtRequired")).toBeInTheDocument();
  });

  it("termin w PRZESZŁOŚCI dostaje ostrzeżenie, nie zwykłą podpowiedź", () => {
    renderSection({
      status: "scheduled",
      publishAt: isoOffset(-60),
      scheduledInPast: true,
    });

    expect(screen.getByText("admin.workflow.publishAtPast")).toBeInTheDocument();
    expect(screen.queryByText("admin.workflow.publishAtHint")).not.toBeInTheDocument();
  });

  it("poprawny przyszły termin dostaje zwykłą podpowiedź", () => {
    renderSection({
      status: "scheduled",
      publishAt: isoOffset(60),
      scheduledInPast: false,
    });

    expect(screen.getByText("admin.workflow.publishAtHint")).toBeInTheDocument();
    expect(screen.queryByText("admin.workflow.publishAtPast")).not.toBeInTheDocument();
  });

  it("SWIADEK DEFEKTU: pole terminu publikacji nie ma dostępnej nazwy", () => {
    // `<Label>` renderuje się BEZ `htmlFor`, a pole bez `id`/`aria-label`, więc
    // etykieta „Data publikacji" nie jest z niczym powiązana. Dla czytnika ekranu
    // to bezimienne pole daty i godziny - a od jego zawartości zależy, kiedy wpis
    // stanie się publiczny. Test opisuje stan OBECNY; po dodaniu powiązania ma
    // pęknąć i zostać przepisany na `getByLabelText`.
    const { container } = renderSection({ status: "scheduled", publishAt: BASE_ISO });
    const field = dateField(container) as HTMLInputElement;

    expect(field.getAttribute("id")).toBeNull();
    expect(field.getAttribute("aria-label")).toBeNull();
    expect(screen.getByText("admin.workflow.publishAt").getAttribute("for")).toBeNull();
  });
});

describe("WorkflowStatusSection - data publikacji wpisu opublikowanego", () => {
  it("pokazuje datę publikacji w języku panelu (parametr trafia do tłumaczenia)", () => {
    renderSection({ status: "published", publishedAt: BASE_ISO, uiLang: "pl-PL" });

    const expected = new Date(BASE_ISO).toLocaleString("pl-PL");
    expect(
      screen.getByText(`admin.workflow.publishedAt ${JSON.stringify({ date: expected })}`),
    ).toBeInTheDocument();
  });

  it("ten sam wpis w panelu angielskim dostaje datę w formacie en-GB", () => {
    renderSection({ status: "published", publishedAt: BASE_ISO, uiLang: "en-GB" });

    const expected = new Date(BASE_ISO).toLocaleString("en-GB");
    expect(
      screen.getByText(`admin.workflow.publishedAt ${JSON.stringify({ date: expected })}`),
    ).toBeInTheDocument();
  });

  it("status opublikowany BEZ daty w bazie nie pokazuje pustej linii", () => {
    renderSection({ status: "published", publishedAt: null });

    expect(screen.queryByText(/admin\.workflow\.publishedAt/)).not.toBeInTheDocument();
  });

  it("data publikacji nie wyświetla się w szkicu, nawet gdy kolumna ma wartość", () => {
    renderSection({ status: "draft", publishedAt: BASE_ISO });

    expect(screen.queryByText(/admin\.workflow\.publishedAt/)).not.toBeInTheDocument();
  });
});

describe("WorkflowStatusSection - ścieżka autora (zgłoszenie do recenzji)", () => {
  it("autor w szkicu dostaje przycisk zgłoszenia do recenzji", () => {
    const { onApplyStatus } = renderSection({ canPublish: false, status: "draft" });

    fireEvent.click(screen.getByRole("button", { name: "admin.workflow.submitReview" }));

    expect(onApplyStatus).toHaveBeenCalledWith("pending_review");
  });

  it("wydawca w szkicu nie dostaje przycisku zgłoszenia (publikuje sam)", () => {
    renderSection({ canPublish: true, status: "draft" });

    expect(
      screen.queryByRole("button", { name: "admin.workflow.submitReview" }),
    ).not.toBeInTheDocument();
  });

  it("trwający zapis blokuje zgłoszenie (żadnego podwójnego wysłania)", () => {
    renderSection({ canPublish: false, status: "draft", busy: true });

    expect(screen.getByRole("button", { name: "admin.workflow.submitReview" })).toBeDisabled();
  });

  it("autor po zgłoszeniu widzi informację o oczekiwaniu, a nie przyciski decyzji", () => {
    renderSection({ canPublish: false, status: "pending_review" });

    expect(screen.getByText("admin.workflow.awaitingReview")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("WorkflowStatusSection - decyzja wydawcy w recenzji", () => {
  it("wydawca zatwierdza i publikuje jednym przyciskiem", () => {
    const { onApplyStatus } = renderSection({ canPublish: true, status: "pending_review" });

    fireEvent.click(screen.getByRole("button", { name: "admin.workflow.approvePublish" }));

    expect(onApplyStatus).toHaveBeenCalledWith("published");
  });

  it("wydawca odrzuca wpis z powrotem do szkicu", () => {
    const { onApplyStatus } = renderSection({ canPublish: true, status: "pending_review" });

    fireEvent.click(screen.getByRole("button", { name: "admin.workflow.rejectToDraft" }));

    expect(onApplyStatus).toHaveBeenCalledWith("draft");
  });

  it("trwający zapis blokuje OBIE decyzje wydawcy", () => {
    renderSection({ canPublish: true, status: "pending_review", busy: true });

    expect(screen.getByRole("button", { name: "admin.workflow.approvePublish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "admin.workflow.rejectToDraft" })).toBeDisabled();
  });

  it("wydawca w recenzji nie widzi komunikatu o oczekiwaniu (to on jest recenzentem)", () => {
    renderSection({ canPublish: true, status: "pending_review" });

    expect(screen.queryByText("admin.workflow.awaitingReview")).not.toBeInTheDocument();
  });

  it("w statusie zarchiwizowanym nie ma żadnych akcji workflow", () => {
    renderSection({ canPublish: true, status: "archived" });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
