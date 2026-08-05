// Granica awarii wątku: błąd renderowania w dymku zostaje w panelu (komunikat
// + „odśwież wątek"), a nie zamienia całego ekranu wiadomości w stronę błędu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { ChatSurfaceBoundary } from "../ChatSurfaceBoundary";

// Raport błędu leci do platformy - w teście nie chcemy sieci ani szumu w logach.
vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: vi.fn(),
}));

afterEach(cleanup);

function Boom({ crash }: { crash: boolean }) {
  if (crash) throw new Error("bubble render failed");
  return <p>Wątek</p>;
}

describe("ChatSurfaceBoundary", () => {
  it("keeps a render fault inside the panel and offers a retry", () => {
    // React loguje przechwycony błąd - wyciszamy tylko na czas testu.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ChatSurfaceBoundary>
        <Boom crash />
      </ChatSurfaceBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(chatPl.chat.surfaceError.title)).toBeTruthy();

    // Po naprawie danych "odśwież wątek" wraca do normalnego widoku.
    rerender(
      <ChatSurfaceBoundary>
        <Boom crash={false} />
      </ChatSurfaceBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.surfaceError.retry }));
    expect(screen.getByText("Wątek")).toBeTruthy();
    spy.mockRestore();
  });
});
