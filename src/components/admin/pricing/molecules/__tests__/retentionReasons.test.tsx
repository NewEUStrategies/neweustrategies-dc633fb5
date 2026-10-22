// Powody rezygnacji w Cenniku (I9, Z-S7-08 - Z-S2-04/Z-S2-11 poza hubem):
// `not_given` i `stripe:<kod>` słowami panelu, „bez podanego powodu" POZA
// rankingiem - ta sama reguła co karta powodów w hubie (`ChurnReasonsCard`).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-pricing";
import { axeViolations, summarize } from "@/test/axe";
import { RetentionFeedbackList } from "@/components/admin/pricing/molecules/RetentionFeedbackList";
import { RetentionStatsCards } from "@/components/admin/pricing/molecules/RetentionStatsCards";
import { retentionReasonLabel } from "@/lib/retention/reasonLabel";
import type { RetentionFeedbackRow } from "@/lib/retention/queries";

function row(id: string, reason: string | null): RetentionFeedbackRow {
  return {
    id,
    tenant_id: "tenant-1",
    user_id: "user-1",
    reason_id: null,
    reason_label: reason,
    subscription_id: null,
    comment: null,
    offer_shown: false,
    offer_accepted: false,
    coupon_code: null,
    outcome: "cancelled",
    flow_started_at: null,
    created_at: "2026-10-20T10:00:00.000Z",
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("retentionReasonLabel - jedna reguła dla huba i Cennika", () => {
  it("rozpoznaje trzy rodzaje zapisu", () => {
    expect(retentionReasonLabel("not_given")).toEqual({ kind: "not_given" });
    expect(retentionReasonLabel("stripe:too_expensive")).toEqual({
      kind: "stripe",
      code: "too_expensive",
    });
    expect(retentionReasonLabel("stripe: ")).toEqual({ kind: "stripe", code: "-" });
    expect(retentionReasonLabel("Za drogo")).toEqual({ kind: "text", text: "Za drogo" });
  });
});

describe("RetentionFeedbackList - powód słowami panelu", () => {
  it("PL: „Bez podanego powodu”, „Portal Stripe: <kod>”, treść dialogu bez zmian", () => {
    render(
      <RetentionFeedbackList
        feedback={[
          row("a", "not_given"),
          row("b", "stripe:switched_service"),
          row("c", "Za drogo"),
        ]}
      />,
    );
    expect(screen.getByText("Bez podanego powodu")).toBeInTheDocument();
    expect(screen.getByText("Portal Stripe: switched_service")).toBeInTheDocument();
    expect(screen.getByText("Za drogo")).toBeInTheDocument();
    expect(screen.queryByText("not_given")).toBeNull();
  });

  it("EN: ten sam podział w drugim języku; axe bez naruszeń", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(
      <RetentionFeedbackList feedback={[row("a", "not_given"), row("b", "stripe:low_quality")]} />,
    );
    expect(screen.getByText("No reason given")).toBeInTheDocument();
    expect(screen.getByText("Stripe customer portal: low_quality")).toBeInTheDocument();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("RetentionStatsCards - „bez podanego powodu” pod rankingiem, nie w nim", () => {
  it("ranking pokazuje powody, a liczba odpowiedzi bez powodu stoi osobno", () => {
    render(
      <RetentionStatsCards
        stats={{
          total: 5,
          accepted: 0,
          acceptRate: null,
          topReasons: [
            ["stripe:too_expensive", 1],
            ["Za drogo", 1],
          ],
          notGiven: 3,
        }}
      />,
    );
    const list = screen.getByRole("list");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Portal Stripe: too_expensive1", "Za drogo1"]);
    expect(screen.getByText("Bez podanego powodu: 3")).toBeInTheDocument();
  });

  it("bez odpowiedzi „bez powodu” - bez dodatkowej linii", () => {
    render(
      <RetentionStatsCards
        stats={{
          total: 1,
          accepted: 0,
          acceptRate: null,
          topReasons: [["Za drogo", 1]],
          notGiven: 0,
        }}
      />,
    );
    expect(screen.queryByText(/Bez podanego powodu/)).toBeNull();
  });
});
