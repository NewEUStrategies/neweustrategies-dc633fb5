// EventGroupButton: „wydarzenie jako iskra" - host albo staff tworzy trwały
// krąg czatu z uczestników RSVP. RPC jest idempotentne, więc drugi klik ma
// tylko otworzyć istniejącą grupę. Testujemy krąg uprawnionych (host / staff),
// zależność od modułu czatu w tenancie, status wydarzenia oraz mapowanie
// „brak uczestników" na osobny komunikat zamiast surowego błędu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  NETWORK_IDS,
  failingMutation,
  idleMutation,
  pendingMutation,
  succeedingMutation,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  isStaff: false,
  modules: { chat_enabled: true },
  createGroup: null as unknown,
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastErrorMapper: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isStaff: h.isStaff }),
}));
vi.mock("@/lib/community/useCommunityModules", () => ({ useCommunityModules: () => h.modules }));
vi.mock("@/lib/network/useConnections", () => ({ useCreateEventGroup: () => h.createGroup }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastErrorMapper }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import { EventGroupButton } from "@/components/network/EventGroupButton";

const createGroup = (): MutationStub<string, string> =>
  h.createGroup as MutationStub<string, string>;

function renderButton(overrides: { hostUserId?: string | null; eventStatus?: string } = {}) {
  return render(
    <EventGroupButton
      eventId={NETWORK_IDS.event}
      hostUserId={overrides.hostUserId ?? NETWORK_IDS.me}
      eventStatus={overrides.eventStatus ?? "published"}
    />,
  );
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.isStaff = false;
  h.modules = { chat_enabled: true };
  h.createGroup = idleMutation<string, string>();
  h.navigate.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastErrorMapper.mockClear();
});

describe("EventGroupButton - krąg uprawnionych", () => {
  it("host wydarzenia widzi panel tworzenia grupy", () => {
    renderButton();
    expect(screen.getByText(k("network.eventGroupCreate"))).toBeInTheDocument();
    expect(screen.getByText(k("network.eventGroupHint"))).toBeInTheDocument();
  });

  it("staff widzi panel także dla cudzego wydarzenia", () => {
    h.isStaff = true;
    renderButton({ hostUserId: "kto-inny" });
    expect(screen.getByRole("button", { name: k("network.eventGroupOpen") })).toBeInTheDocument();
  });

  it("zwykły uczestnik: panel niewidoczny", () => {
    renderButton({ hostUserId: "kto-inny" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("anon: panel niewidoczny nawet gdy hostUserId jest puste", () => {
    h.user = null;
    const { container } = renderButton({ hostUserId: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("moduł czatu wyłączony w tenancie: panel niewidoczny", () => {
    h.modules = { chat_enabled: false };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("wydarzenie nieopublikowane (szkic / odwołane): panel niewidoczny", () => {
    const { container } = renderButton({ eventStatus: "draft" });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EventGroupButton - tworzenie grupy", () => {
  it("sukces: toast i przejście do konwersacji w /messages", () => {
    h.createGroup = succeedingMutation<string, string>(NETWORK_IDS.conversation);
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: k("network.eventGroupOpen") }));

    expect(createGroup().lastVars()).toBe(NETWORK_IDS.event);
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.eventGroupCreated"));
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/messages",
      search: { c: NETWORK_IDS.conversation },
    });
  });

  it("brak uczestników z RSVP: własny komunikat, bez generycznego mappera", () => {
    h.createGroup = failingMutation<string, string>("create_event_group: no attendees");
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: k("network.eventGroupOpen") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.eventGroupEmpty"));
    expect(h.toastErrorMapper).not.toHaveBeenCalled();
  });

  it("brak kwalifikujących się członków: ten sam komunikat", () => {
    h.createGroup = failingMutation<string, string>("create_event_group: no eligible members");
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: k("network.eventGroupOpen") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.eventGroupEmpty"));
  });

  it("inny błąd: generyczny mapper z kubełkiem zapisu", () => {
    h.createGroup = failingMutation<string, string>("permission denied");
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: k("network.eventGroupOpen") }));
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
    expect(h.toastErrorMapper.mock.calls[0][1]).toBe("save");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("tworzenie w locie: przycisk zablokowany (RPC jest idempotentne, ale nie zapraszamy do dubli)", () => {
    h.createGroup = pendingMutation<string, string>();
    renderButton();
    expect(screen.getByRole("button", { name: k("network.eventGroupOpen") })).toBeDisabled();
  });
});
