// Wiersz warunku i wspólne pola arkuszy edytora ścieżki (S8.3c) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Odrzucenie, nie przycięcie: pola liczą długość jak walidator
//      (`z.string().trim()`), wartość spoza limitu zostaje w polu z błędem
//      i licznikiem, a do szkicu nie idzie nic (ani wersja ucięta).
//   2. Lista warunków oddaje do szkicu wyłącznie komplet poprawnych wierszy
//      (`PredicateSchema`); wiersz chwilowo niekompletny czeka lokalnie.
//   3. Otwarcie/kliknięcie wskazuje tylko e-mail z listy dozwolonych (przodek
//      kroku) - inny jest błędem `predicate_not_ancestor_email`.
//   4. Filtr wejścia ostrzega o warunkach historii (zawsze fałsz).
//   5. Katalog wyzwalaczy S5 ma etykiety PL/EN dla KAŻDEGO pola warunku i KAŻDEJ
//      wartości z listy - nowe pole w katalogu bez etykiety oblewa test.
//   6. Pola warunku zdarzenia składa `buildTriggerCondition` (puste znikają).
//   7. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async () => (await import("@/test/i18nReal")).reactI18nextMock("pl"));

import {
  BufferedTextField,
  ConditionFields,
  PredicateList,
  conditionFieldLabelKey,
  conditionValueLabelKey,
  defaultPredicateDraft,
  listFieldError,
  parseIntField,
  parseListText,
  predicateDraftIssue,
  textFieldError,
  type PredicateContext,
} from "../PredicateRow";
import i18n from "@/lib/i18n";
import { journeysStepsDictionaries } from "@/lib/i18n-admin-journeys-steps";
import { journeyLabelKey } from "@/lib/journeys/labels";
import {
  JOURNEY_PREDICATE_KINDS,
  PredicateSchema,
  type JourneyPredicate,
} from "@/lib/journeys/predicates";
import { JOURNEY_TRIGGERS } from "@/lib/journeys/triggers";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-crm-lifecycle";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

const t = realT("pl");

afterEach(cleanup);

function renderUi(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const EMAILS: PredicateContext = {
  emailNodes: [{ id: "mail_1", label: "Krok 2: „Witaj”" }],
  triggerEventType: "subscription.expired.v1",
};

/** Lista sterowana jak w arkuszu: wartość wraca z „sesji” po każdym oddaniu. */
function ControlledList(props: {
  initial: JourneyPredicate[];
  context?: PredicateContext;
  entryFilter?: boolean;
  min?: number;
  onCommit: (predicates: JourneyPredicate[]) => void;
}) {
  const [value, setValue] = useState<JourneyPredicate[]>(props.initial);
  return (
    <PredicateList
      id="p"
      legend="Warunki"
      value={value}
      min={props.min ?? 0}
      max={20}
      context={props.context ?? EMAILS}
      entryFilter={props.entryFilter}
      onCommit={(next) => {
        props.onCommit(next);
        setValue(next);
      }}
    />
  );
}

describe("pomocnicze limity pól", () => {
  it("tekst: długość po przycięciu brzegów, za długi i pusty wymagany są błędem", () => {
    expect(textFieldError("  abc  ", { min: 1, max: 3 })).toBeNull();
    expect(textFieldError("   ", { min: 1, max: 3 })?.key).toBe(
      "adminJourneys.sheetField.error.required",
    );
    expect(textFieldError("abcd", { max: 3 })).toEqual({
      key: "adminJourneys.sheetField.error.tooLong",
      values: { max: 3 },
    });
    expect(textFieldError("lista!", { max: 64, pattern: /^[a-z]+$/ })?.key).toBe(
      "adminJourneys.sheetField.error.pattern",
    );
  });

  it("liczba: całkowita z zakresu; ułamek, śmieci i spoza zakresu odrzucone", () => {
    expect(parseIntField("05", { min: 0, max: 60 })).toEqual({ value: 5, error: null });
    expect(parseIntField("5.5", { min: 0, max: 60 }).error?.key).toBe(
      "adminJourneys.sheetField.error.range",
    );
    expect(parseIntField("61", { min: 0, max: 60 }).value).toBeNull();
    expect(parseIntField("", { min: 1, max: 9, optional: true })).toEqual({
      value: null,
      error: null,
    });
    expect(parseIntField("", { min: 1, max: 9 }).error?.key).toBe(
      "adminJourneys.sheetField.error.required",
    );
  });

  it("lista: przecinki, puste pomijane, limit liczby i długości pozycji", () => {
    expect(parseListText(" a, ,b ,")).toEqual(["a", "b"]);
    expect(listFieldError([], { min: 1, max: 2, itemMax: 3 })?.key).toBe(
      "adminJourneys.sheetField.error.listCount",
    );
    expect(listFieldError(["abcd"], { min: 1, max: 2, itemMax: 3 })?.key).toBe(
      "adminJourneys.sheetField.error.listItem",
    );
    expect(listFieldError(["ab"], { min: 1, max: 2, itemMax: 3 })).toBeNull();
  });
});

describe("katalog wyzwalaczy S5 - etykiety pól i wartości warunku", () => {
  it("każde pole warunku każdego wyzwalacza ma etykietę PL i EN", () => {
    const missing: string[] = [];
    for (const def of JOURNEY_TRIGGERS) {
      for (const field of def.conditionFields) {
        const key = conditionFieldLabelKey(field.key);
        for (const lng of ["pl", "en"] as const) {
          if (!i18n.exists(key, { lng })) missing.push(`${lng}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("każda wartość z listy pola warunku ma etykietę PL i EN", () => {
    const missing: string[] = [];
    for (const def of JOURNEY_TRIGGERS) {
      for (const field of def.conditionFields) {
        for (const option of field.options ?? []) {
          const key = conditionValueLabelKey(def.eventType, field.key, option);
          if (key === null) {
            missing.push(`${def.eventType}:${field.key}=${option} (brak klucza)`);
            continue;
          }
          for (const lng of ["pl", "en"] as const) {
            if (!i18n.exists(key, { lng })) missing.push(`${lng}:${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("zdania o zmiennych maila nie zawierają składni interpolacji (`{{…}}` zjadłby i18next)", () => {
    for (const lang of ["pl", "en"] as const) {
      const hint = journeysStepsDictionaries[lang].adminJourneys.emailStep.variablesHint;
      expect(hint).not.toMatch(/\{\{/);
    }
  });
});

describe("wiersz startowy rodzaju i jego kompletność", () => {
  it("rodzaje z wyborem zaczynają puste (czekają na administratora), zgoda i e-mail od razu poprawne", () => {
    const ready = JOURNEY_PREDICATE_KINDS.filter(
      (kind) => predicateDraftIssue(defaultPredicateDraft(kind, EMAILS), EMAILS) === null,
    );
    expect(ready.sort()).toEqual(
      [
        "club_member",
        "consent",
        "email_clicked",
        "email_opened",
        "event_registered",
        "event_since_enrollment",
        "plan",
      ].sort(),
    );
    // Gotowy wiersz przechodzi schemat S5 bez zmian.
    for (const kind of ready) {
      expect(PredicateSchema.safeParse(defaultPredicateDraft(kind, EMAILS)).success).toBe(true);
    }
  });

  it("e-mail spoza listy dozwolonych (nie przodek) to błąd walidatora grafu", () => {
    const issue = predicateDraftIssue({ kind: "email_opened", nodeId: "mail_9" }, EMAILS);
    expect(issue?.key).toBe(journeyLabelKey("graphIssue", "predicate_not_ancestor_email"));
  });
});

describe("PredicateList - lista warunków", () => {
  it("niekompletny wiersz czeka lokalnie, komplet idzie do szkicu", () => {
    const onCommit = vi.fn();
    renderUi(<ControlledList initial={[{ kind: "consent", marketing: true }]} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText(t("adminJourneys.predicateRow.kind")), {
      target: { value: "has_tag" },
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(t("adminJourneys.predicateRow.pending"))).toBeTruthy();

    fireEvent.change(screen.getByLabelText(t("adminJourneys.predicateRow.tag")), {
      target: { value: " vip " },
    });
    expect(onCommit).toHaveBeenLastCalledWith([{ kind: "has_tag", tag: "vip" }]);
    expect(screen.queryByText(t("adminJourneys.predicateRow.pending"))).toBeNull();
  });

  it("tag ponad 64 znaki: błąd i licznik, do szkicu nie trafia ani pełny, ani ucięty", () => {
    const onCommit = vi.fn();
    renderUi(<ControlledList initial={[{ kind: "has_tag", tag: "vip" }]} onCommit={onCommit} />);
    const input = screen.getByLabelText(t("adminJourneys.predicateRow.tag")) as HTMLInputElement;
    const long = "x".repeat(65);
    fireEvent.change(input, { target: { value: long } });

    expect(input.value).toBe(long);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(t("adminJourneys.sheetField.error.tooLong", { max: 64 }))).toBeTruthy();
    expect(screen.getByText(t("adminJourneys.common.counter", { count: 65, max: 64 }))).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.hasAttribute("maxlength")).toBe(false);
  });

  it("otwarcie: e-mail spoza dozwolonych pokazuje błąd, wybór dozwolonego oddaje warunek", () => {
    const onCommit = vi.fn();
    renderUi(
      <ControlledList initial={[{ kind: "email_opened", nodeId: "mail_9" }]} onCommit={onCommit} />,
    );
    const select = screen.getByLabelText(t("adminJourneys.predicateRow.email"));
    expect(
      screen.getByText(t(journeyLabelKey("graphIssue", "predicate_not_ancestor_email"))),
    ).toBeTruthy();
    expect(
      within(select).getByText(t("adminJourneys.predicateRow.emailUnknown", { id: "mail_9" })),
    ).toBeTruthy();

    fireEvent.change(select, { target: { value: "mail_1" } });
    expect(onCommit).toHaveBeenLastCalledWith([{ kind: "email_opened", nodeId: "mail_1" }]);
  });

  it("bez maili na drodze rodzaje otwarcia i kliknięcia są niedostępne", () => {
    renderUi(
      <ControlledList
        initial={[{ kind: "consent", marketing: true }]}
        context={{ emailNodes: [], triggerEventType: null }}
        onCommit={vi.fn()}
      />,
    );
    const kind = screen.getByLabelText(t("adminJourneys.predicateRow.kind")) as HTMLSelectElement;
    const option = (value: string) =>
      [...kind.options].find((candidate) => candidate.value === value) as HTMLOptionElement;
    expect(option("email_opened").disabled).toBe(true);
    expect(option("email_clicked").disabled).toBe(true);
    expect(option("has_tag").disabled).toBe(false);
  });

  it("filtr wejścia ostrzega o warunkach historii (w chwili wejścia zawsze fałsz)", () => {
    renderUi(
      <ControlledList
        initial={[{ kind: "email_opened", nodeId: "mail_1" }]}
        entryFilter
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByText(t(journeyLabelKey("graphIssue", "entry_filter_history")))).toBeTruthy();
  });

  it("pole zdarzenia wejścia: wartości z katalogu jako pola wyboru (win-back: powód ≠ pauza)", () => {
    const onCommit = vi.fn();
    renderUi(<ControlledList initial={[]} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.predicateRow.add") }));
    // Nowy wiersz = zgoda marketingowa (kompletny) - od razu w szkicu.
    expect(onCommit).toHaveBeenLastCalledWith([{ kind: "consent", marketing: true }]);

    fireEvent.change(screen.getByLabelText(t("adminJourneys.predicateRow.kind")), {
      target: { value: "trigger_field" },
    });
    // Wiersz startowy wskazuje pierwszy klucz ładunku - wybieramy powód wygaśnięcia.
    fireEvent.change(screen.getByLabelText(t("adminJourneys.predicateRow.field")), {
      target: { value: "reason" },
    });
    fireEvent.change(screen.getByLabelText(t("adminJourneys.predicateRow.fieldOp")), {
      target: { value: "not_in" },
    });
    fireEvent.click(
      screen.getByLabelText(t("adminJourneys.sheetField.value.expiredReason.paused")),
    );
    expect(onCommit).toHaveBeenLastCalledWith([
      { kind: "trigger_field", key: "reason", op: "not_in", values: ["paused"] },
    ]);
  });

  it("usunięcie wiersza poniżej minimum jest niedostępne (`if_else` ma co najmniej 1 warunek)", () => {
    renderUi(
      <ControlledList initial={[{ kind: "consent", marketing: true }]} min={1} onCommit={vi.fn()} />,
    );
    const remove = screen.getByRole("button", {
      name: t("adminJourneys.predicateRow.remove", { number: 1 }),
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });

  it("axe bez naruszeń (kilka rodzajów naraz)", async () => {
    const { container } = renderUi(
      <ControlledList
        initial={[
          { kind: "email_clicked", nodeId: "mail_1", urlContains: "cennik" },
          { kind: "crm_stage", in: ["new"] },
          { kind: "plan", op: "tier_in", tierKeys: ["pro"] },
          { kind: "trigger_field", key: "tier_key", op: "in", values: ["pro"] },
        ]}
        entryFilter
        onCommit={vi.fn()}
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("ConditionFields - warunek zdarzenia", () => {
  it("wartość z listy i tak/nie składa `buildTriggerCondition`; pusta znika", () => {
    const onCommit = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<Record<string, string | number | boolean>>({});
      return (
        <ConditionFields
          idPrefix="c"
          eventType="checkout.abandoned.v1"
          value={value}
          onCommit={(next) => {
            onCommit(next);
            setValue(next);
          }}
        />
      );
    }
    renderUi(<Controlled />);
    fireEvent.change(screen.getByLabelText(t("adminJourneys.sheetField.condition.kind")), {
      target: { value: "subscription" },
    });
    expect(onCommit).toHaveBeenLastCalledWith({ kind: "subscription" });
    fireEvent.change(screen.getByLabelText(t("adminJourneys.sheetField.condition.has_coupon")), {
      target: { value: "false" },
    });
    expect(onCommit).toHaveBeenLastCalledWith({ kind: "subscription", has_coupon: false });
    fireEvent.change(screen.getByLabelText(t("adminJourneys.sheetField.condition.kind")), {
      target: { value: "" },
    });
    expect(onCommit).toHaveBeenLastCalledWith({ has_coupon: false });
  });

  it("napis ponad 200 znaków nie trafia do warunku", () => {
    const onCommit = vi.fn();
    renderUi(
      <ConditionFields idPrefix="c" eventType="checkout.abandoned.v1" value={{}} onCommit={onCommit} />,
    );
    fireEvent.change(screen.getByLabelText(t("adminJourneys.sheetField.condition.tier_key")), {
      target: { value: "x".repeat(201) },
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(t("adminJourneys.sheetField.error.tooLong", { max: 200 }))).toBeTruthy();
  });

  it("zdarzenie bez pól warunku mówi, że liczy się każde zdarzenie typu", () => {
    renderUi(
      <ConditionFields
        idPrefix="c"
        eventType="metering.quota_exhausted.v1"
        value={{}}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByText(t("adminJourneys.sheetField.conditionNone"))).toBeTruthy();
  });
});

describe("BufferedTextField - bufor a cofnij", () => {
  it("wartość z zewnątrz (cofnij) wraca do pola, własna zostaje bez zmiany napisu", () => {
    function Harness() {
      const [value, setValue] = useState("abc");
      return (
        <>
          <BufferedTextField id="f" label="Pole" value={value} max={10} onCommit={setValue} />
          <button type="button" onClick={() => setValue("zewn")}>
            cofnij
          </button>
        </>
      );
    }
    renderUi(<Harness />);
    const input = screen.getByLabelText("Pole") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abcd " } });
    // Spacja na końcu zostaje w polu (szkic dostał wartość przyciętą).
    expect(input.value).toBe("abcd ");
    fireEvent.click(screen.getByRole("button", { name: "cofnij" }));
    expect(input.value).toBe("zewn");
  });
});
