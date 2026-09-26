// Okno „Udostępnij raport sponsorowi" (`SponsorReportShareDialog`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TOKEN W ADRESIE ZAPYTANIA ZAMIAST WE FRAGMENCIE - link z okna musi
//      mieć postać `<origin>/events/<slug>/sponsor-report#t=<token>`.
//   2. TOKEN ZOSTAJE PO ZAMKNIĘCIU - ponowne otwarcie ma zaczynać od
//      formularza, a nie od starego linku.
//   3. ZŁY FORMULARZ IDZIE DO BAZY - brak sponsora, za krótka etykieta albo
//      data spoza zakresu zatrzymują wydanie z komunikatem przy polu.
//   4. KONTAKTY WŁĄCZONE DOMYŚLNIE - przełącznik startuje wyłączony.
//   5. ODMOWA BAZY I SCHOWKA BEZ SŁOWA - obie kończą się komunikatem.
//
// Zegar zamrożony (15.06.2099, 12:00 UTC): domyślna ważność i granice pola
// daty liczą się od chwili otwarcia okna.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { freezeClock } from "@/test/time";

type Result = { onSuccess?: (value: unknown) => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  hookEventIds: [] as string[],
  outcome: { token: "Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab" } as Record<string, unknown> | Error,
  pending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    error,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    error?: string | null;
  }) => (
    <>
      <select
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="">-</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {String(option.label)}
          </option>
        ))}
      </select>
      {error ? <p id={`${id}-err`}>{error}</p> : null}
    </>
  ),
}));
vi.mock("@/lib/events/useSponsorReport", () => ({
  useIssueSponsorReportLink: (eventId: string) => {
    h.hookEventIds.push(eventId);
    return {
      isPending: h.pending,
      mutate: (input: unknown, result: Result) => {
        h.calls.push(input);
        if (h.outcome instanceof Error) result.onError?.(h.outcome);
        else result.onSuccess?.(h.outcome);
      },
    };
  },
}));

const { SponsorReportShareDialog } =
  await import("@/components/admin/events/molecules/SponsorReportShareDialog");

freezeClock();

const S = "adminEventSponsorReport.share";
const TOKEN = "Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab";
const SPONSORS = [
  { id: "s1", name: "Acme" },
  { id: "s2", name: "Beta" },
];

let openChanges: boolean[] = [];

function dialog(props: { open?: boolean; sponsorId?: string; eventEndsAt?: string | null } = {}) {
  return (
    <SponsorReportShareDialog
      open={props.open ?? true}
      onOpenChange={(next) => openChanges.push(next)}
      eventId="ev1"
      eventSlug="kongres-2099"
      eventEndsAt={props.eventEndsAt === undefined ? "2099-06-21T16:00:00Z" : props.eventEndsAt}
      sponsors={SPONSORS}
      sponsorId={props.sponsorId ?? "s1"}
    />
  );
}

const field = (key: string) => screen.getByLabelText(`${S}.${key}`);
const submit = () =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: `${S}.issue` }));
  });

beforeEach(() => {
  h.calls = [];
  h.hookEventIds = [];
  h.outcome = { token: TOKEN };
  h.pending = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  openChanges = [];
});

describe("formularz", () => {
  it("zamknięte okno nic nie rysuje", () => {
    render(dialog({ open: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("startuje od sponsora z wiersza, pustej etykiety, ważności do 60 dni po wydarzeniu i bez kontaktów", () => {
    render(dialog());
    expect(screen.getByRole("dialog", { name: `${S}.title` })).toBeTruthy();
    expect(field("sponsor")).toHaveProperty("value", "s1");
    expect(field("label")).toHaveProperty("value", "");
    const expires = field("expiresOn");
    expect(expires).toHaveProperty("value", "2099-08-20");
    expect(expires.getAttribute("min")).toBe("2099-06-16");
    expect(expires.getAttribute("max")).toBe("2099-12-11");
    expect(screen.getByRole("switch")).toHaveProperty("checked", false);
    expect(screen.getByText(`${S}.includeLeadsHint`)).toBeTruthy();
    expect(new Set(h.hookEventIds)).toEqual(new Set(["ev1"]));
  });

  it("zły formularz nie idzie do bazy, a każde złe pole mówi, co jest nie tak", () => {
    render(dialog({ sponsorId: "" }));
    fireEvent.change(field("label"), { target: { value: " x " } });
    fireEvent.change(field("expiresOn"), { target: { value: "2099-06-15" } });
    submit();
    expect(h.calls).toEqual([]);
    expect(field("sponsor")).toHaveAccessibleDescription(`${S}.invalidSponsor`);
    expect(field("label").getAttribute("aria-invalid")).toBe("true");
    expect(field("label")).toHaveAccessibleDescription(`${S}.invalidLabel`);
    expect(field("expiresOn")).toHaveAccessibleDescription(`${S}.invalidExpires`);
  });

  it("pole bez błędu opisuje podpowiedź, nie błąd", () => {
    render(dialog());
    expect(field("label")).toHaveAccessibleDescription(`${S}.labelHint`);
    expect(field("expiresOn")).toHaveAccessibleDescription(`${S}.expiresHint`);
    expect(field("label").hasAttribute("aria-invalid")).toBe(false);
  });

  it("w trakcie wydawania przycisk jest zgaszony i mówi, że trwa", () => {
    h.pending = true;
    render(dialog());
    expect(screen.getByRole("button", { name: `${S}.issuing` })).toHaveProperty("disabled", true);
  });

  it("anulowanie zamyka okno bez wydania linku", () => {
    render(dialog());
    fireEvent.click(screen.getByRole("button", { name: `${S}.cancel` }));
    expect(openChanges).toEqual([false]);
    expect(h.calls).toEqual([]);
  });
});

describe("wydanie linku", () => {
  function fillAndIssue() {
    fireEvent.change(field("sponsor"), { target: { value: "s2" } });
    fireEvent.change(field("label"), { target: { value: "  Dział marketingu  " } });
    fireEvent.change(field("expiresOn"), { target: { value: "2099-07-01" } });
    fireEvent.click(screen.getByRole("switch"));
    submit();
  }

  it("poprawny formularz idzie do bazy; link niesie token we FRAGMENCIE i widać go raz", () => {
    render(dialog());
    fillAndIssue();
    expect(h.calls).toEqual([
      {
        sponsorId: "s2",
        label: "Dział marketingu",
        expiresAt: "2099-07-01T23:59:59.000Z",
        includeLeads: true,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}.created`);
    expect(screen.getByRole("status").textContent).toBe(`${S}.tokenOnce`);
    const link = field("linkLabel") as HTMLInputElement;
    expect(link.readOnly).toBe(true);
    expect(link.value).toBe(
      `${window.location.origin}/events/kongres-2099/sponsor-report#t=${TOKEN}`,
    );
    expect(new URL(link.value).search).toBe("");
    // Zaznaczenie przy fokusie ułatwia ręczne kopiowanie.
    fireEvent.focus(link);
  });

  it("kopiowanie: sukces i odmowa schowka kończą się komunikatem", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("x"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(dialog());
    fillAndIssue();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${S}.copy` }));
    });
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/events/kongres-2099/sponsor-report#t=${TOKEN}`,
    );
    expect(h.toastSuccess).toHaveBeenLastCalledWith(`${S}.copied`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${S}.copy` }));
    });
    expect(h.toastError).toHaveBeenCalledWith(`${S}.copyFailed`);
  });

  it("„gotowe” zamyka okno, a ponowne otwarcie zaczyna od formularza bez starego tokenu", () => {
    const { rerender } = render(dialog());
    fillAndIssue();
    fireEvent.click(screen.getByRole("button", { name: `${S}.done` }));
    expect(openChanges).toEqual([false]);
    rerender(dialog({ open: false }));
    rerender(dialog({ open: true, sponsorId: "s1" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(field("label")).toHaveProperty("value", "");
    expect(within(screen.getByRole("dialog")).queryByDisplayValue(new RegExp(TOKEN))).toBeNull();
  });

  it("odmowa bazy zostawia formularz i mówi zdaniem ze słownika", () => {
    h.outcome = new Error("too_many_links: a sponsor may have at most 10 active links");
    render(dialog());
    fillAndIssue();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(String(h.toastError.mock.calls[0]?.[0])).not.toContain("too_many_links:");
    expect(screen.queryByRole("status")).toBeNull();
    expect(field("label")).toHaveProperty("value", "  Dział marketingu  ");
  });

  it("wydarzenie bez daty końca: ważność liczona od dziś", () => {
    render(dialog({ eventEndsAt: null }));
    expect(field("expiresOn")).toHaveProperty("value", "2099-08-14");
  });
});
