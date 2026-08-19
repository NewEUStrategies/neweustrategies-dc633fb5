// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageOrConnectButton } from "./MessageOrConnectButton";
import * as useAuth from "@/hooks/useAuth";
import * as useCommunity from "@/lib/community/useCommunityModules";
import * as useConnections from "@/lib/network/useConnections";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

vi.spyOn(useAuth, "useAuth").mockReturnValue({ user: { id: "viewer" } } as ReturnType<typeof useAuth.useAuth>);
vi.spyOn(useCommunity, "useCommunityModules").mockReturnValue({ connections_enabled: true } as ReturnType<typeof useCommunity.useCommunityModules>);

const NO_CONNECTION: useConnections.ConnectionState = {
  status: "none",
  connectionId: null,
  mutualCount: 0,
  canInvite: true,
  degree: 0,
  bridge: null,
};

const CONNECTED: useConnections.ConnectionState = { ...NO_CONNECTION, status: "connected", canInvite: false, degree: 1 };

describe("MessageOrConnectButton", () => {
  it("renders ConnectButton when not connected", () => {
    render(
      <MessageOrConnectButton
        userId="target"
        displayName="Target"
        displayAvatar={null}
        compact
        iconOnly
        connectionState={NO_CONNECTION}
      />,
      { wrapper: Wrapper },
    );
    // ConnectButton renders an aria-label with display name
    expect(screen.getByLabelText(/Dodaj/)).toBeInTheDocument();
  });

  it("renders DirectMessageButton when connected", () => {
    render(
      <MessageOrConnectButton
        userId="target"
        displayName="Target"
        displayAvatar={null}
        compact
        iconOnly
        connectionState={CONNECTED}
      />,
      { wrapper: Wrapper },
    );
    // DirectMessageButton renders an aria-label with display name
    expect(screen.getByLabelText(/Target/)).toBeInTheDocument();
  });
});
