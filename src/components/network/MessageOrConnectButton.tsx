// Komponent łączący DirectMessageButton i ConnectButton: w zależności od
// relacji z odbiorcą pokazuje albo przycisk wiadomości (gdy "connected"),
// albo zaproszenie do sieci kontaktów. Używany w miejscach, gdzie na
// pierwszym planie ma być akcja kontaktowa, a oba przyciski nie stoją obok
// siebie (np. karty w klubach, wyniki wyszukiwania osób).
import { useAuth } from "@/hooks/useAuth";
import { ConnectButton } from "@/components/network/ConnectButton";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useConnectionStatuses, type ConnectionState } from "@/lib/network/useConnections";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MessageOrConnectButtonProps {
  userId: string;
  displayName: string;
  displayAvatar?: string | null;
  /** Kompaktowy przycisk h-8 (listy, kafelki wyszukiwarki). */
  compact?: boolean;
  /** Tylko ikona - do wąskich pigułek i kart w gridzie. */
  iconOnly?: boolean;
  className?: string;
  /**
   * Opcjonalny, znany z góry status relacji (np. z batchowanego RPC).
   * Gdy pominięty, komponent pobiera status samodzielnie.
   */
  connectionState?: ConnectionState;
}

export function MessageOrConnectButton({
  userId,
  displayName,
  displayAvatar,
  compact,
  iconOnly,
  className,
  connectionState,
}: MessageOrConnectButtonProps) {
  const { user } = useAuth();
  const modules = useCommunityModules();
  const selfFetch = connectionState === undefined;

  const statusQ = useConnectionStatuses(
    selfFetch && modules.connections_enabled && user && user.id !== userId ? [userId] : [],
  );
  const resolved = connectionState ?? statusQ.data?.get(userId) ?? null;
  const isLoading = selfFetch && statusQ.isLoading;

  // Stabilny placeholder podczas ładowania - unikamy layout shiftu.
  if (isLoading) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled
        aria-hidden
        className={cn(
          "rounded-[6px] shrink-0 opacity-60 cursor-not-allowed",
          compact || iconOnly ? "h-8 w-8" : "h-9 w-9",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </Button>
    );
  }

  if (resolved?.status === "connected") {
    return (
      <DirectMessageButton
        userId={userId}
        displayName={displayName}
        displayAvatar={displayAvatar}
        compact={compact}
        iconOnly={iconOnly}
        className={className}
        connectionState={resolved}
      />
    );
  }

  return (
    <ConnectButton
      userId={userId}
      displayName={displayName}
      state={resolved ?? undefined}
      compact={compact}
      iconOnly={iconOnly}
      className={className}
    />
  );
}
