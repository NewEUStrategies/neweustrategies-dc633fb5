// Atomy panelu „Automatyzacje": odznaka statusu, chip typu zdarzenia,
// data i podsumowanie kroków przepisu. Wszystkie stały na 0%.
//
// To warstwa, z której administrator czyta, CO i KIEDY zrobił silnik. Jej
// awarie są ciche: nieznany status pokazuje surową wartość z bazy, brak daty
// wygląda jak data zerowa, a zgubiony krok w podsumowaniu każe wierzyć, że
// przepis robi mniej, niż robi naprawdę.
import "@/lib/i18n-admin-workflows";
import i18n from "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Json } from "@/integrations/supabase/types";
import { serializeWorkflowSteps } from "@/lib/admin/workflows";
import { DateTimeText, EventTypeChip, RunStatusBadge, StepChips } from "../atoms";

const t = i18n.getFixedT("pl");

describe("RunStatusBadge", () => {
  it("nazywa status ze słownika, a nie surową wartością z bazy", () => {
    render(<RunStatusBadge status="delivered" />);
    expect(screen.getByText(t("adminWorkflows.runs.statusDelivered"))).toBeInTheDocument();
  });

  it("REGRESJA: statusy 'queued' i 'delivering' mają etykiety, nie surowy tekst", () => {
    // Oba są dopuszczone CHECK-iem `integration_deliveries.status`, a mapa
    // w komponencie ich nie znała - trafiały do gałęzi domyślnej, więc polski
    // panel pokazywał angielską wartość z bazy dokładnie w dwóch stanach,
    // w których administrator PATRZY, czy webhook wyszedł.
    const queued = render(<RunStatusBadge status="queued" />);
    expect(screen.getByText(t("adminWorkflows.runs.statusQueued"))).toBeInTheDocument();
    queued.unmount();

    render(<RunStatusBadge status="delivering" />);
    expect(screen.getByText(t("adminWorkflows.runs.statusDelivering"))).toBeInTheDocument();
  });

  it("status spoza katalogu pokazuje się SUROWO, zamiast dostać wymyśloną etykietę", () => {
    render(<RunStatusBadge status="cos_nowego" />);
    expect(screen.getByText("cos_nowego")).toBeInTheDocument();
  });

  it("powodzenie i porażka wyglądają RÓŻNIE", () => {
    const ok = render(<RunStatusBadge status="succeeded" />);
    const okClass = screen.getByText(t("adminWorkflows.runs.statusSucceeded")).className;
    ok.unmount();

    render(<RunStatusBadge status="failed" />);
    expect(screen.getByText(t("adminWorkflows.runs.statusFailed")).className).not.toBe(okClass);
  });
});

describe("EventTypeChip", () => {
  it("pokazuje typ zdarzenia dosłownie - to identyfikator techniczny, nie copy", () => {
    // Typ zdarzenia jest kluczem kontraktu (`post.published.v1`) i musi dać się
    // przepisać jeden do jednego do definicji przepisu.
    render(<EventTypeChip type="post.published.v1" />);
    expect(screen.getByText("post.published.v1")).toBeInTheDocument();
  });

  it("renderuje się jako `code` - identyfikator ma być odróżnialny od zdania", () => {
    const { container } = render(<EventTypeChip type="comment.created.v1" />);
    expect(container.querySelector("code")).toBeTruthy();
  });
});

describe("DateTimeText", () => {
  it("brak daty mówi „nigdy”, zamiast pokazać pustkę albo epokę", () => {
    // `null` w kolumnie czasu znaczy „to się nie wydarzyło". Pusty tekst
    // wyglądałby jak błąd renderu, a data zerowa - jak zdarzenie z 1970 roku.
    render(<DateTimeText iso={null} />);
    expect(screen.getByText(t("adminWorkflows.common.never"))).toBeInTheDocument();
  });

  it("data jest maszynowo odczytywalna przez `datetime`, nie tylko wizualna", () => {
    // Sformatowany tekst zależy od języka panelu; `dateTime` niesie wartość
    // kanoniczną, którą rozumie czytnik ekranu i narzędzia.
    const iso = "2026-08-18T10:30:00.000Z";
    const { container } = render(<DateTimeText iso={iso} />);
    const time = container.querySelector("time");
    expect(time).toBeTruthy();
    expect(time).toHaveAttribute("datetime", iso);
    expect(time?.textContent).toMatch(/26/);
  });
});

describe("StepChips", () => {
  const steps = serializeWorkflowSteps([
    { action: "notify_staff", params: {} },
    { action: "create_crm_task", params: {} },
  ]) as Json;

  it("numeruje kroki w KOLEJNOŚCI wykonania", () => {
    // Silnik wykonuje kroki po kolei, więc podsumowanie bez numeracji nie
    // odpowiada na pytanie „co się stanie najpierw".
    const { container } = render(<StepChips steps={steps} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("1.")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("2.")).toBeGreaterThan(text.indexOf("1."));
  });

  it("nazywa akcje ze słownika, nie kluczem technicznym", () => {
    render(<StepChips steps={steps} />);
    expect(
      screen.getByText(new RegExp(t("adminWorkflows.actions.notify_staff.name"))),
    ).toBeInTheDocument();
  });

  it("pusta lista kroków nie renderuje żadnego chipa", () => {
    const { container } = render(<StepChips steps={[] as unknown as Json} />);
    expect(container.textContent).toBe("");
  });

  it("zdeformowany zapis kroków nie wywala widoku", () => {
    // `steps` to kolumna `jsonb` - wiersz sprzed zmiany kształtu albo wpis
    // wprowadzony ręcznie nie może zabrać całego panelu historii.
    const { container } = render(<StepChips steps={{ nonsens: true } as unknown as Json} />);
    expect(container.textContent).toBe("");
  });
});
