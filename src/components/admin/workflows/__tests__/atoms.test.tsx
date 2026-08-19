// Atomy modułu „Automatyzacje" (`atoms.tsx`, 0 z 5 funkcji; `useActionName.ts`,
// 0 z 2 przed tą zmianą). Audyt 18.08 wymienił „Workflow draft→review→published"
// jako funkcjonalność MODUŁU 2 stojącą na okrągłym zerze — 0 z 82 funkcji.
//
// Te atomy są warstwą, w której redaktor CZYTA stan silnika automatyzacji.
// Trzy rzeczy są tu warte testu:
//
//   1. MAPOWANIE STATUSU NA ETYKIETĘ. Paleta jest wspólna dla przebiegów
//      workflow i dostaw outboxu, a status nieznany silnikowi musi się
//      wyrenderować, a nie zniknąć — inaczej wiersz historii pokazuje pustą
//      plakietkę i nie da się dojść, co się stało.
//   2. DATA W JĘZYKU PANELU. Ślad korelacji i historia przebiegów to narzędzia
//      diagnostyczne: „18.08.2026, 10:00:00" i „08/18/2026, 10:00:00 AM" to
//      różne odczyty tej samej chwili i pomyłka między nimi myli przy ustalaniu
//      kolejności zdarzeń.
//   3. PODSUMOWANIE KROKÓW. `StepChips` renderuje kroki przez `parseWorkflowSteps`,
//      który POMIJA wpisy nieznane silnikowi — chip dla obcej akcji sugerowałby,
//      że przepis coś robi, podczas gdy silnik ten krok zignoruje.
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const h = vi.hoisted(() => ({ language: "pl" as string }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-admin-workflows", () => ({}));

import {
  DateTimeText,
  EventTypeChip,
  RunStatusBadge,
  StepChips,
} from "@/components/admin/workflows/atoms";
import { useActionName } from "@/components/admin/workflows/useActionName";
import { WORKFLOW_ACTIONS } from "@/lib/admin/workflows";
import { renderHook } from "@testing-library/react";

afterEach(() => {
  cleanup();
  h.language = "pl";
});

// ---------------------------------------------------------------------------
// RunStatusBadge
// ---------------------------------------------------------------------------

describe("RunStatusBadge - statusy przebiegów", () => {
  it("udany i nieudany przebieg czytają etykietę ze słownika", () => {
    render(<RunStatusBadge status="succeeded" />);
    expect(screen.getByText("adminWorkflows.runs.statusSucceeded")).toBeInTheDocument();
    cleanup();

    render(<RunStatusBadge status="failed" />);
    expect(screen.getByText("adminWorkflows.runs.statusFailed")).toBeInTheDocument();
  });

  it("status NIEZNANY renderuje się dosłownie, zamiast znikać", () => {
    // Silnik może dopisać status, którego ta mapa jeszcze nie zna. Pusta
    // plakietka w historii przebiegów byłaby gorsza niż surowa nazwa: nie
    // dałoby się dojść, co się właściwie stało z przepisem.
    render(<RunStatusBadge status="quarantined" />);
    expect(screen.getByText("quarantined")).toBeInTheDocument();
  });

  it("każdy status z palety renderuje niepustą treść", () => {
    for (const status of ["succeeded", "failed", "delivered", "pending", "retry", "dead"]) {
      const { container } = render(<RunStatusBadge status={status} />);
      expect(container.textContent?.trim(), status).not.toBe("");
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // ŚWIADEK DEFEKTU: cztery statusy dostaw są ZASZYTE PO ANGIELSKU.
  //
  // `succeeded` i `failed` czytają etykietę ze słownika, ale `delivered`,
  // `pending`, `retry` i `dead` mają w `atoms.tsx` (linie 21-46) angielskie
  // literały. Te cztery statusy opisują DOSTAWY WEBHOOKÓW i pojawiają się
  // w śladzie korelacji — czyli dokładnie tam, gdzie polski redaktor diagnozuje
  // integrację, która nie zadziałała.
  //
  // Bramka i18n tego nie łapie, bo nie ma tu wywołania `t()` z kluczem do
  // sprawdzenia — jest goły string. Ten test opisuje stan OBECNY, żeby naprawa
  // miała punkt odniesienia; idzie ona osobnym commitem.
  // -------------------------------------------------------------------------
  it("DEFEKT: statusy dostaw outboxu są po angielsku niezależnie od języka panelu", () => {
    for (const language of ["pl", "en"]) {
      h.language = language;
      for (const status of ["delivered", "pending", "retry", "dead"]) {
        render(<RunStatusBadge status={status} />);
        // Docelowo: `adminWorkflows.runs.status<Nazwa>` z tłumaczeniem PL/EN.
        expect(screen.getByText(status), `${language}/${status}`).toBeInTheDocument();
        cleanup();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// EventTypeChip
// ---------------------------------------------------------------------------

describe("EventTypeChip", () => {
  it("pokazuje typ zdarzenia dosłownie, w elemencie <code>", () => {
    // Typ zdarzenia to kontrakt z bazą (`<agregat>.<czasownik>.v<n>`) - jest
    // identyfikatorem technicznym, więc NIE podlega tłumaczeniu ani skracaniu.
    const { container } = render(<EventTypeChip type="post.published.v1" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("post.published.v1");
  });

  it("przekazuje className wywołującego (chip jedzie w gęstych wierszach)", () => {
    const { container } = render(<EventTypeChip type="comment.created.v1" className="ml-2" />);
    expect(container.querySelector("code")?.className).toContain("ml-2");
  });
});

// ---------------------------------------------------------------------------
// DateTimeText
// ---------------------------------------------------------------------------

describe("DateTimeText", () => {
  const ISO = "2026-08-18T10:00:00.000Z";

  it("brak daty to słowo „nigdy”, nie pusty element", () => {
    // Kolumna „ostatni przebieg" dla przepisu, który nigdy się nie odpalił.
    render(<DateTimeText iso={null} />);
    expect(screen.getByText("adminWorkflows.common.never")).toBeInTheDocument();
  });

  it("data jedzie w <time> z maszynowym dateTime", () => {
    // Wartość maszynowa musi zostać nietknięta niezależnie od formatowania -
    // to ona jest źródłem prawdy przy kopiowaniu do zgłoszenia błędu.
    const { container } = render(<DateTimeText iso={ISO} />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(ISO);
    expect(time?.textContent?.trim()).not.toBe("");
  });

  it("formatuje POLSKIM locale, gdy panel jest po polsku", () => {
    h.language = "pl";
    const { container } = render(<DateTimeText iso={ISO} />);
    const text = container.querySelector("time")?.textContent ?? "";
    // pl-PL: dzień.miesiąc.rok i zegar 24-godzinny (brak AM/PM).
    expect(text).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(text).not.toMatch(/AM|PM/);
  });

  it("formatuje BRYTYJSKIM locale, gdy panel jest po angielsku", () => {
    // Ślad korelacji to narzędzie diagnostyczne - odczyt daty w złym locale
    // myli przy ustalaniu kolejności zdarzeń.
    h.language = "en";
    const { container } = render(<DateTimeText iso={ISO} />);
    const text = container.querySelector("time")?.textContent ?? "";
    expect(text).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("przekazuje className wywołującego", () => {
    const { container } = render(<DateTimeText iso={ISO} className="text-muted-foreground" />);
    expect(container.querySelector("time")?.className).toContain("text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// StepChips
// ---------------------------------------------------------------------------

describe("StepChips", () => {
  it("numeruje kroki od 1 i nazywa akcje ze słownika", () => {
    // Numeracja to nie ozdoba: kroki wykonują się PO KOLEI, a przepis „najpierw
    // utwórz lead, potem powiadom" robi co innego niż odwrotny.
    render(
      <StepChips
        steps={
          [
            { action: "create_crm_lead", params: {} },
            { action: "notify_staff", params: {} },
          ] as never
        }
      />,
    );
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.actions.create_crm_lead.name")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.actions.notify_staff.name")).toBeInTheDocument();
  });

  it("POMIJA kroki o akcji nieznanej silnikowi", () => {
    // `parseWorkflowSteps` odrzuca obce akcje, bo silnik rzuca na nie wyjątkiem.
    // Chip dla takiej akcji sugerowałby, że przepis coś robi - a ten krok
    // zostanie zignorowany.
    render(
      <StepChips
        steps={
          [
            { action: "notify_staff", params: {} },
            { action: "wyslij_gołębia", params: {} },
          ] as never
        }
      />,
    );
    expect(screen.getByText("adminWorkflows.actions.notify_staff.name")).toBeInTheDocument();
    expect(screen.queryByText(/gołębia/)).toBeNull();
    // Został DOKŁADNIE jeden chip - numeracja nie zostawia dziury.
    expect(screen.queryByText("2.")).toBeNull();
  });

  it("pusta lista kroków renderuje pusty kontener, nie błąd", () => {
    const { container } = render(<StepChips steps={[] as never} />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("zdeformowana kolumna `steps` nie wysypuje karty przepisu", () => {
    // Wiersz zapisany starszą wersją edytora albo ręcznie w bazie.
    for (const raw of [null, "tekst", 42, { action: "notify_staff" }]) {
      const { container } = render(<StepChips steps={raw as never} />);
      expect(container.textContent?.trim()).toBe("");
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// useActionName
// ---------------------------------------------------------------------------

describe("useActionName", () => {
  it("buduje klucz i18n dla KAŻDEJ akcji z katalogu silnika", () => {
    // Katalog akcji jest kontraktem z CASE w `public.run_workflow_step`.
    // Akcja dodana do katalogu bez etykiety pokazałaby redaktorowi goły klucz.
    const { result } = renderHook(() => useActionName());
    for (const action of WORKFLOW_ACTIONS) {
      expect(result.current(action)).toBe(`adminWorkflows.actions.${action}.name`);
    }
  });

  it("zwraca stabilną funkcję nazywającą, nie gotowy słownik", () => {
    const { result } = renderHook(() => useActionName());
    expect(result.current).toBeTypeOf("function");
  });
});
