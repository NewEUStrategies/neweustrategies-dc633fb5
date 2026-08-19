// Sekcja workflow w sidebarze edytora i karta tagów. Obie stały na 0%.
//
// Sekcja workflow jest JEDYNYM miejscem, w którym redaktor bez prawa publikacji
// widzi, co może zrobić ze swoim wpisem - i jedynym, z którego publikujący
// zatwierdza cudzą pracę. Pomylenie warunku widoczności któregokolwiek
// przycisku nie wywala się na typach: po prostu znika ścieżka procesu.
import "@/lib/i18n-admin-post-panes";
import i18n from "@/lib/i18n";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { statusOptionsFor } from "@/lib/content/workflow";
import { WorkflowStatusSection } from "../WorkflowStatusSection";
import { TagsCard } from "../TagsCard";

/** Etykiety liczone ze SŁOWNIKA, nie wpisane w test - zmiana copy nie ma
 *  wywalać asercji o zachowaniu, a brak klucza ma. */
const t = i18n.getFixedT("pl");

type SectionProps = ComponentProps<typeof WorkflowStatusSection>;

function section(over: Partial<SectionProps> = {}) {
  const props: SectionProps = {
    status: "draft",
    publishAt: null,
    publishedAt: null,
    canPublish: false,
    busy: false,
    statusOptions: statusOptionsFor({ canPublish: over.canPublish ?? false }),
    scheduledInPast: false,
    uiLang: "pl",
    onStatusChange: vi.fn(),
    onPublishAtChange: vi.fn(),
    onApplyStatus: vi.fn(),
    ...over,
  };
  return { props, view: render(<WorkflowStatusSection {...props} />) };
}

describe("WorkflowStatusSection - ścieżka autora bez prawa publikacji", () => {
  it("szkic dostaje przycisk WYŚLIJ DO RECENZJI, który zgłasza pending_review", () => {
    // To jedyne wyjście autora z szkicu. Zniknięcie tego przycisku zamyka
    // proces redakcyjny bez żadnego sygnału błędu.
    const onApplyStatus = vi.fn();
    section({ status: "draft", canPublish: false, onApplyStatus });

    fireEvent.click(screen.getByRole("button"));
    expect(onApplyStatus).toHaveBeenCalledWith("pending_review");
  });

  it("autor widzi podpowiedź o ograniczeniu, publikujący nie", () => {
    const { view } = section({ canPublish: false });
    expect(screen.getByText(t("admin.workflow.writerHint"))).toBeInTheDocument();
    view.unmount();

    section({ canPublish: true });
    expect(screen.queryByText(t("admin.workflow.writerHint"))).not.toBeInTheDocument();
  });

  it("wpis w recenzji nie daje autorowi żadnego przycisku, tylko informację", () => {
    section({ status: "pending_review", canPublish: false });
    expect(screen.getByText(t("admin.workflow.awaitingReview"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(
          `${t("admin.workflow.approvePublish")}|${t("admin.workflow.rejectToDraft")}`,
        ),
      }),
    ).toBeNull();
  });

  it("zajętość blokuje wysłanie do recenzji", () => {
    section({ status: "draft", canPublish: false, busy: true });
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("WorkflowStatusSection - ścieżka publikującego", () => {
  it("wpis w recenzji daje DWA rozstrzygnięcia: zatwierdź i odeślij do szkicu", () => {
    const onApplyStatus = vi.fn();
    section({ status: "pending_review", canPublish: true, onApplyStatus });

    fireEvent.click(screen.getByText(t("admin.workflow.approvePublish")));
    expect(onApplyStatus).toHaveBeenCalledWith("published");

    fireEvent.click(screen.getByText(t("admin.workflow.rejectToDraft")));
    expect(onApplyStatus).toHaveBeenCalledWith("draft");
    expect(onApplyStatus).toHaveBeenCalledTimes(2);
  });

  it("publikujący nie dostaje przycisku „wyślij do recenzji” dla szkicu", () => {
    // Publikujący ma publikować wprost - dodatkowy krok recenzji byłby dla
    // niego tylko obejściem samego siebie.
    section({ status: "draft", canPublish: true });
    expect(screen.queryByText(t("admin.workflow.submitReview"))).not.toBeInTheDocument();
  });
});

describe("WorkflowStatusSection - termin publikacji", () => {
  it("pole terminu pojawia się WYŁĄCZNIE dla statusu zaplanowanego", () => {
    const { view } = section({ status: "draft" });
    expect(screen.queryByText(t("admin.workflow.publishAt"))).not.toBeInTheDocument();
    view.unmount();

    section({ status: "scheduled" });
    expect(screen.getByText(t("admin.workflow.publishAt"))).toBeInTheDocument();
  });

  it("bez terminu mówi, że jest WYMAGANY - baza odrzuci taki zapis", () => {
    // Trigger `enforce_post_workflow` rzuca 23514 dla `scheduled` bez
    // `publish_at`, więc brak tej podpowiedzi kończyłby się surowym błędem.
    section({ status: "scheduled", publishAt: null });
    expect(screen.getByText(t("admin.workflow.publishAtRequired"))).toBeInTheDocument();
  });

  it("termin w przeszłości dostaje INNY komunikat niż termin przyszły", () => {
    // Wpis zaplanowany wstecz czeka na przebieg `publish_due_posts()`,
    // a nie jest opublikowany - bez rozróżnienia wygląda jak zgubiony.
    const { view } = section({
      status: "scheduled",
      publishAt: "2026-01-01T10:00:00.000Z",
      scheduledInPast: true,
    });
    expect(screen.getByText(t("admin.workflow.publishAtPast"))).toBeInTheDocument();
    view.unmount();

    section({ status: "scheduled", publishAt: "2027-01-01T10:00:00.000Z", scheduledInPast: false });
    expect(screen.getByText(t("admin.workflow.publishAtHint"))).toBeInTheDocument();
  });

  it("zmiana pola terminu oddaje ISO, nie surową wartość kontrolki", () => {
    // Kontrolka `datetime-local` mówi czasem LOKALNYM, a kolumna trzyma UTC.
    // Przekazanie wartości wprost przesunęłoby publikację o offset strefy.
    const onPublishAtChange = vi.fn();
    section({ status: "scheduled", publishAt: null, onPublishAtChange });

    const input = screen.getByLabelText(t("admin.workflow.publishAt"));
    fireEvent.change(input, { target: { value: "2026-09-01T14:30" } });

    expect(onPublishAtChange).toHaveBeenCalledTimes(1);
    const iso = onPublishAtChange.mock.calls[0][0] as string;
    expect(iso).toMatch(/Z$/);
    const back = new Date(iso);
    expect(back.getHours()).toBe(14);
    expect(back.getMinutes()).toBe(30);
  });

  it("pusta wartość kontrolki oznacza BRAK terminu, nie datę zerową", () => {
    const onPublishAtChange = vi.fn();
    section({ status: "scheduled", publishAt: "2026-09-01T10:00:00.000Z", onPublishAtChange });

    fireEvent.change(screen.getByLabelText(t("admin.workflow.publishAt")), {
      target: { value: "" },
    });
    expect(onPublishAtChange).toHaveBeenCalledWith(null);
  });

  it("wpis opublikowany pokazuje datę publikacji, a nie pole terminu", () => {
    section({ status: "published", publishedAt: "2026-08-18T10:00:00.000Z" });
    expect(screen.queryByText(t("admin.workflow.publishAt"))).not.toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          t("admin.workflow.publishedAt", { date: "" }).split("{{")[0].trim().slice(0, 12),
        ),
      ),
    ).toBeInTheDocument();
  });
});

type TagsProps = ComponentProps<typeof TagsCard>;

function tags(over: Partial<TagsProps> = {}) {
  const props: TagsProps = {
    allTags: [
      { id: "t1", name: "Handel" },
      { id: "t2", name: "Energia" },
    ],
    selectedTags: [],
    onSelectedTagsChange: vi.fn(),
    newTagName: "",
    onNewTagNameChange: vi.fn(),
    taxonomyBusy: null,
    onAddTag: vi.fn(),
    ...over,
  };
  return { props, view: render(<TagsCard {...props} />) };
}

describe("TagsCard", () => {
  it("kliknięcie niezaznaczonego taga DODAJE go do zaznaczenia", () => {
    // Aktualizacja idzie funkcją, nie wartością - dwa szybkie kliknięcia
    // na wartości zgubiłyby pierwsze z nich.
    const onSelectedTagsChange = vi.fn();
    tags({ selectedTags: [], onSelectedTagsChange });

    fireEvent.click(screen.getByText("Handel"));
    const updater = onSelectedTagsChange.mock.calls[0][0] as (s: string[]) => string[];
    expect(updater([])).toEqual(["t1"]);
  });

  it("kliknięcie zaznaczonego taga USUWA go, nie duplikuje", () => {
    const onSelectedTagsChange = vi.fn();
    tags({ selectedTags: ["t1"], onSelectedTagsChange });

    fireEvent.click(screen.getByText("Handel"));
    const updater = onSelectedTagsChange.mock.calls[0][0] as (s: string[]) => string[];
    expect(updater(["t1", "t2"])).toEqual(["t2"]);
  });

  it("pusta lista tagów mówi o tym wprost, zamiast pokazać pustkę", () => {
    tags({ allTags: [] });
    expect(screen.getByText(t("admin.posts.noTags"))).toBeInTheDocument();
  });

  it("nieznana lista (jeszcze się ładuje) też nie renderuje przycisków", () => {
    tags({ allTags: undefined });
    expect(screen.getByText(t("admin.posts.noTags"))).toBeInTheDocument();
  });

  it("Enter w polu nazwy dodaje tag - bez sięgania po przycisk", () => {
    const onAddTag = vi.fn();
    tags({ newTagName: "Rynek", onAddTag });

    fireEvent.keyDown(
      screen.getByPlaceholderText(t("adminPostPanes.taxonomy.tagNamePlaceholder")),
      {
        key: "Enter",
      },
    );
    expect(onAddTag).toHaveBeenCalledTimes(1);
  });

  it("inny klawisz nie tworzy taga", () => {
    const onAddTag = vi.fn();
    tags({ newTagName: "Rynek", onAddTag });

    fireEvent.keyDown(
      screen.getByPlaceholderText(t("adminPostPanes.taxonomy.tagNamePlaceholder")),
      {
        key: "a",
      },
    );
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("przycisk dodania jest wyłączony przy pustej nazwie i przy samych spacjach", () => {
    const empty = tags({ newTagName: "" });
    expect(
      screen.getByRole("button", { name: t("adminPostPanes.taxonomy.addTagShort") }),
    ).toBeDisabled();
    empty.view.unmount();

    tags({ newTagName: "   " });
    expect(
      screen.getByRole("button", { name: t("adminPostPanes.taxonomy.addTagShort") }),
    ).toBeDisabled();
  });

  it("w trakcie dodawania przycisk jest zablokowany i zmienia etykietę", () => {
    tags({ newTagName: "Rynek", taxonomyBusy: "tag" });
    const button = screen.getByRole("button", { name: t("adminPostPanes.taxonomy.addingShort") });
    expect(button).toBeDisabled();
  });

  it("zajętość PRZY KATEGORII nie blokuje dodawania taga", () => {
    // Dwie niezależne ścieżki w jednym sidebarze - wspólna blokada
    // zatrzymywałaby pracę bez powodu.
    tags({ newTagName: "Rynek", taxonomyBusy: "cat" });
    expect(
      screen.getByRole("button", { name: t("adminPostPanes.taxonomy.addTagShort") }),
    ).toBeEnabled();
  });
});
