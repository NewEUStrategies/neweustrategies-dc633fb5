import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ from: null as unknown, lang: "pl" }));
vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

import { renderRoute } from "@/test/routeHarness";
import { Route as RedemptionsRoute } from "@/routes/admin.coupons.redemptions";

const db = () => h.from as SupabaseFromStub;

beforeEach(() => {
  db().reset();
  db().setResponse("b2b_coupon_redemptions", ok([]));
});

describe("debug", () => {
  it("kalendarz", async () => {
    const view = await renderRoute({
      route: RedemptionsRoute,
      path: "/admin/coupons/redemptions",
      initialEntry: "/admin/coupons/redemptions",
    });
    await waitFor(() => expect(db().chainsFor("b2b_coupon_redemptions").length).toBe(1));
    const label = screen.getByText("Od");
    const btn = label.parentElement?.querySelector("button");
    console.log("PRZYCISK:", btn?.textContent);
    fireEvent.click(btn as HTMLElement);
    const cells = await screen.findAllByRole("gridcell");
    console.log("KOMOREK:", cells.length, "pierwsza:", cells[0]?.outerHTML.slice(0, 200));
    const c15 = cells.find((c) => c.textContent?.trim() === "15");
    console.log("C15BTN:", c15?.querySelector("button")?.outerHTML.slice(0, 500));
    const btn15 = c15?.querySelector("button") as HTMLElement;
    console.log("BTN15 attrs:", btn15.getAttribute("data-day"), btn15.getAttribute("disabled"), btn15.getAttribute("aria-disabled"), btn15.tagName);
    fireEvent.click(btn15);
    await new Promise((r) => setTimeout(r, 200));
    console.log("WYBRANE:", Array.from(document.querySelectorAll('[data-selected-single="true"]')).map((e) => e.getAttribute("data-day")));
    console.log("BODY buttons:", Array.from(document.querySelectorAll("button")).slice(0, 4).map((b) => b.textContent?.slice(0, 30)));
    console.log("CHAINS:", db().chainsFor("b2b_coupon_redemptions").length);
    console.log("PRZYCISK PO:", label.parentElement?.querySelector("button")?.textContent);
    expect(view.currentPath()).toBe("/admin/coupons/redemptions");
  });
});
