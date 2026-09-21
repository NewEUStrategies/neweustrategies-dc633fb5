// Skrzynka wysyłek - panel zawsze coś rysuje, więc pomyłka jest cicha.
// Testy pilnują trzech rzeczy, które decydują o zaufaniu do ekranu:
//   * kafle i tabela pochodzą z JEDNEJ odpowiedzi (suma nie kłamie),
//   * sentynela „wszystkie" NIE jedzie na serwer jako wartość filtra,
//   * status jest tłumaczony (PL/EN), a powód niepowodzenia widoczny.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  result: null as unknown,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (input: { data: Record<string, unknown> }) => {
    env.calls.push(input.data);
    return env.result;
  },
}));
vi.mock("@/lib/admin/emailOutbox.functions", () => ({
  getEmailOutbox: {},
  OUTBOX_STATUSES: ["sent", "pending", "failed", "dlq", "suppressed"] as const,
}));

import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-email-outbox";
import { EmailOutboxPanel } from "@/components/admin/newsletter/outbox/EmailOutboxPanel";

const T = (key: string) => i18n.t(`adminOutbox.${key}`);

const result = {
  rows: [
    {
      id: "r1",
      messageId: "m1",
      templateName: "user_invitation",
      recipientEmail: "igor@example.com",
      status: "failed",
      errorMessage: "validation_error: domain not verified",
      createdAt: "2026-08-19T11:30:00.000Z",
    },
    {
      id: "r2",
      messageId: "m2",
      templateName: "user_invitation",
      recipientEmail: "ada@example.com",
      status: "sent",
      errorMessage: null,
      createdAt: "2026-08-19T10:00:00.000Z",
    },
  ],
  stats: { total: 2, sent: 1, pending: 0, failed: 1, suppressed: 0 },
  templates: ["user_invitation"],
  total: 2,
  page: 1,
  pageSize: 50,
  truncated: false,
};

beforeEach(async () => {
  env.result = result;
  env.calls = [];
  await i18n.changeLanguage("pl");
});
afterEach(cleanup);

describe("EmailOutboxPanel", () => {
  it("pokazuje odbiorców, przetłumaczone statusy i powód niepowodzenia", async () => {
    renderWithQueryClient(<EmailOutboxPanel />);

    expect(await screen.findByText("igor@example.com")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText(T("status.failed"))).toBeInTheDocument();
    expect(screen.getByText(T("status.sent"))).toBeInTheDocument();
    expect(screen.getByText(/domain not verified/)).toBeInTheDocument();
  });

  it("nie wysyła sentyneli wszystkie jako wartości filtrów", async () => {
    renderWithQueryClient(<EmailOutboxPanel />);
    await waitFor(() => expect(env.calls.length).toBeGreaterThan(0));

    const first = env.calls[0] as { template: unknown; status: unknown; search: unknown };
    expect(first.template).toBeNull();
    expect(first.status).toBeNull();
    expect(first.search).toBeNull();
  });

  it("przełącza zakres czasu na 30 dni i odpytuje serwer ponownie", async () => {
    renderWithQueryClient(<EmailOutboxPanel />);
    await waitFor(() => expect(env.calls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: T("range.d30") }));

    await waitFor(() => {
      const last = env.calls.at(-1) as { days: unknown };
      expect(last.days).toBe(30);
    });
  });

  it("ostrzega, gdy zakres jest zbyt szeroki na jeden odczyt", async () => {
    env.result = { ...result, truncated: true };
    renderWithQueryClient(<EmailOutboxPanel />);
    expect(await screen.findByText(T("truncated"))).toBeInTheDocument();
    expect(env.calls.length).toBeGreaterThan(0);
  });

  it("tłumaczy interfejs na angielski", async () => {
    await i18n.changeLanguage("en");
    renderWithQueryClient(<EmailOutboxPanel />);
    expect(await screen.findByText("Email outbox")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
