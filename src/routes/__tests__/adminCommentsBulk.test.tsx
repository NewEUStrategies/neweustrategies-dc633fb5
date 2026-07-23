import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Kolejka moderacji: dane z API, akcje zbiorcze przez bulkModerateComments.
const { bulkSpy, modSpy, rows } = vi.hoisted(() => ({
  bulkSpy: vi.fn(async () => 1),
  modSpy: vi.fn(async () => undefined),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/comments/api", () => ({
  fetchAdminComments: async () => rows,
  bulkModerateComments: bulkSpy,
  moderateComment: modSpy,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminComments } from "@/routes/admin.comments";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function comment(id: string, name: string) {
  return {
    id,
    post_id: "p1",
    user_id: "u-" + id,
    author_name: null,
    body: "body " + id,
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    edited_at: null,
    author: { id: "u-" + id, display_name: name, avatar_url: null, slug: null },
    post: { id: "p1", slug: "post", title_pl: "Wpis", title_en: "Post" },
  };
}

beforeEach(() => {
  bulkSpy.mockClear();
  modSpy.mockClear();
  rows.length = 0;
  rows.push(comment("c1", "Ala"), comment("c2", "Bok"));
});

// Pasek akcji zbiorczych to kontener nagłówkowego checkboxa „zaznacz widoczne".
function bulkBar(): HTMLElement {
  const boxes = screen.getAllByRole("checkbox");
  return boxes[0].parentElement as HTMLElement;
}

describe("AdminComments - bulk moderation", () => {
  it("bulk-approves the selected rows via bulkModerateComments (no confirm)", async () => {
    wrap(<AdminComments />);
    await screen.findByText("Ala");
    // checkbox[0] = zaznacz widoczne; [1] = pierwszy wiersz.
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    const approve = within(bulkBar()).getAllByRole("button")[0];
    fireEvent.click(approve);
    await waitFor(() => expect(bulkSpy).toHaveBeenCalledTimes(1));
    expect(bulkSpy).toHaveBeenCalledWith(["c1"], "approved");
    // Akcja zbiorcza nie chodzi przez per-wierszowy moderateComment.
    expect(modSpy).not.toHaveBeenCalled();
  });

  it("select-all then delete asks for confirmation before applying", async () => {
    wrap(<AdminComments />);
    await screen.findByText("Ala");
    fireEvent.click(screen.getAllByRole("checkbox")[0]); // zaznacz widoczne
    // Delete to trzeci przycisk paska (approve, spam, delete).
    const del = within(bulkBar()).getAllByRole("button")[2];
    fireEvent.click(del);
    // Destrukcyjna akcja NIE wykonuje się bez potwierdzenia.
    expect(bulkSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    // Ostatni przycisk stopki dialogu to „Wykonaj" (po „Anuluj").
    const actions = within(dialog).getAllByRole("button");
    fireEvent.click(actions[actions.length - 1]);
    await waitFor(() => expect(bulkSpy).toHaveBeenCalledTimes(1));
    expect(bulkSpy).toHaveBeenCalledWith(["c1", "c2"], "deleted");
  });

  it("cancelling the confirm dialog applies nothing", async () => {
    wrap(<AdminComments />);
    await screen.findByText("Ala");
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(within(bulkBar()).getAllByRole("button")[2]); // delete
    const dialog = await screen.findByRole("alertdialog");
    const actions = within(dialog).getAllByRole("button");
    fireEvent.click(actions[0]); // Anuluj (pierwszy)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(bulkSpy).not.toHaveBeenCalled();
  });
});
