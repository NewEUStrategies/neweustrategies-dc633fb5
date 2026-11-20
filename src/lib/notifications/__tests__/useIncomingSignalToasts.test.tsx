import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableChangeHandler } from "@/lib/realtime/tableChannelHub";

const UID = "b0000000-0000-0000-0000-00000000000b";
const hub = vi.hoisted(() => ({
  handlers: [] as Array<(payload: unknown) => void>,
  specs: [] as unknown[],
  unsubscribed: 0,
}));
const sonner = vi.hoisted(() => ({ toast: vi.fn(), dismiss: vi.fn() }));
const update = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: UID } }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(sonner.toast, { dismiss: sonner.dismiss }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        update(values);
        const chain = { eq: () => chain, is: async () => ({ error: null }) };
        return chain;
      },
    }),
  },
}));
vi.mock("@/lib/realtime/tableChannelHub", () => ({
  subscribeToTable: (spec: unknown, handler: TableChangeHandler) => {
    hub.specs.push(spec);
    hub.handlers.push(handler as (payload: unknown) => void);
    return () => {
      hub.unsubscribed += 1;
    };
  },
}));

import { useIncomingSignalToasts } from "../useIncomingSignalToasts";

function insert(row: Record<string, unknown>) {
  for (const handler of hub.handlers) handler({ eventType: "INSERT", new: row, old: {} });
}

const ping = {
  id: "n-2",
  user_id: UID,
  kind: "club",
  icon: null,
  href: "/club/klub/t/temat",
  read_at: null,
  title_pl: "Poproszono Cię o zdanie",
  title_en: "You were asked to weigh in",
  body_pl: "Anna prosi o Twoje zdanie.",
};

describe("useIncomingSignalToasts", () => {
  beforeEach(() => {
    hub.handlers = [];
    hub.specs = [];
    hub.unsubscribed = 0;
    sonner.toast.mockReset();
    sonner.dismiss.mockReset();
    update.mockReset();
  });

  it("prośba o zdanie pokazuje jedno okienko z akcją otwarcia", () => {
    const onOpen = vi.fn();
    renderHook(() => useIncomingSignalToasts(true, onOpen));
    expect(hub.specs).toEqual([{ table: "notifications", filter: `user_id=eq.${UID}` }]);

    const row = { ...ping, created_at: new Date().toISOString() };
    insert(row);
    insert(row);
    expect(sonner.toast).toHaveBeenCalledTimes(1);
    const [title, options] = sonner.toast.mock.calls[0] as [
      string,
      { id: string; action: { onClick: () => void } },
    ];
    expect(title).toBe("Poproszono Cię o zdanie");
    expect(options.id).toBe("signal:n-2");

    options.action.onClick();
    expect(onOpen).toHaveBeenCalledWith("/club/klub/t/temat");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ read_at: expect.any(String) }));
  });

  it("zwykłe powiadomienie nie daje okienka", () => {
    renderHook(() => useIncomingSignalToasts(true, vi.fn()));
    insert({
      id: "n-3",
      user_id: UID,
      kind: "connection",
      title_pl: "Nowe zaproszenie",
      created_at: new Date().toISOString(),
    });
    expect(sonner.toast).not.toHaveBeenCalled();
  });

  it("wyłączone - bez kanału; odmontowanie zamyka kanał i okienka", () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useIncomingSignalToasts(enabled, vi.fn()),
      { initialProps: { enabled: false } },
    );
    expect(hub.specs).toHaveLength(0);
    rerender({ enabled: true });
    insert({ ...ping, created_at: new Date().toISOString() });
    unmount();
    expect(hub.unsubscribed).toBe(1);
    expect(sonner.dismiss).toHaveBeenCalledWith("signal:n-2");
  });
});
