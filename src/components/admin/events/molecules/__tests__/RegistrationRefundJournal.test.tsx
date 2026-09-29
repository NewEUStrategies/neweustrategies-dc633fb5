import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { axeViolations } from "@/test/axe";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (!h.rpc) throw new Error("Missing RPC plan");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));
const { RegistrationRefundJournal } = await import("../RegistrationRefundJournal");
const base = "adminEventRegistration.refundJournal";
const row = {
  id: "job-1",
  payment_order_id: "order-1",
  person_name: "Anna Test",
  state: "needs_review",
  attempts: 1,
  last_error: "active_registrations_share_payment",
  next_attempt_at: "2026-09-29T12:00:00Z",
  created_at: "2026-09-29T12:00:00Z",
};
beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData("admin_event_refund_jobs", [row]);
});
afterEach(cleanup);
function open() {
  const view = renderWithQueryClient(<RegistrationRefundJournal eventId="event-1" />);
  fireEvent.click(screen.getByRole("button", { name: `${base}.title` }));
  return view;
}
it("defers the read until expanded and scopes it to the event", async () => {
  const view = renderWithQueryClient(<RegistrationRefundJournal eventId="event-1" />);
  expect(h.rpc?.calls).toHaveLength(0);
  const trigger = screen.getByRole("button", { name: `${base}.title` });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  expect(await screen.findByText("Anna Test")).toBeInTheDocument();
  expect(h.rpc?.lastCall("admin_event_refund_jobs")?.args).toEqual({ p_event_id: "event-1" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await axeViolations(view.container)).toEqual([]);
});
it("shows why a shared group payment needs a decision", async () => {
  open();
  expect(await screen.findByText(`${base}.reviewHint`)).toBeInTheDocument();
  expect(screen.getByText(`${base}.states.needs_review`)).toBeInTheDocument();
});
it.each([null, [{ ...row, state: "unknown" }]])(
  "treats invalid data as a read failure, not an empty journal: %j",
  async (data) => {
    h.rpc?.setData("admin_event_refund_jobs", data);
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${base}.loadError`);
    expect(screen.queryByText(`${base}.empty`)).not.toBeInTheDocument();
  },
);
it("retries a failed read and refreshes after registration mutation invalidation", async () => {
  h.rpc?.setError("admin_event_refund_jobs", "unavailable");
  const view = open();
  await screen.findByRole("alert");
  h.rpc?.setData("admin_event_refund_jobs", [row]);
  fireEvent.click(screen.getByRole("button", { name: `${base}.refresh` }));
  await screen.findByText("Anna Test");
  h.rpc?.setData("admin_event_refund_jobs", []);
  await view.queryClient.invalidateQueries({ queryKey: registrationKeys.event("event-1") });
  expect(await screen.findByText(`${base}.empty`)).toBeInTheDocument();
});
