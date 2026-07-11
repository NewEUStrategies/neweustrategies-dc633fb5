// Molecule: cross-module presence - kto teraz ogląda tę encję (task/lead/
// dokument/rozmowa). Jedna implementacja wskaźnika dla wszystkich modułów,
// oparta o uogólnione useEntityPresence; stos inicjałów + dostępna etykieta.
import "@/lib/i18n-cohesion";
import { useTranslation } from "react-i18next";
import { useEntityPresence, type PresenceEntityType } from "@/lib/realtime/useEntityPresence";
import { cn } from "@/lib/utils";

export interface PresenceIndicatorProps {
  entityType: PresenceEntityType;
  entityId: string | null | undefined;
  className?: string;
  /** Maks. liczba widocznych awatarów; reszta jako "+N". */
  maxAvatars?: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p.charAt(0).toUpperCase()).join("");
  return initials || "?";
}

export function PresenceIndicator({
  entityType,
  entityId,
  className,
  maxAvatars = 4,
}: PresenceIndicatorProps) {
  const { t } = useTranslation();
  const peers = useEntityPresence(entityType, entityId);
  if (!peers.length) return null;

  const visible = peers.slice(0, maxAvatars);
  const overflow = peers.length - visible.length;
  const names = peers.map((p) => p.name).join(", ");

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("cohesion.presence.viewingNow", { count: peers.length })}
      title={`${t("cohesion.presence.here")} ${names}`}
      className={cn("flex items-center gap-1.5", className)}
    >
      <div className="flex -space-x-1.5">
        {visible.map((peer) => (
          <span
            key={peer.userId}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-primary/15 text-[9px] font-medium text-primary"
            aria-hidden="true"
          >
            {initialsOf(peer.name)}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium text-muted-foreground"
            aria-hidden="true"
          >
            +{overflow}
          </span>
        )}
      </div>
      <span className="hidden text-[11px] text-muted-foreground sm:inline">
        {t("cohesion.presence.viewingNow", { count: peers.length })}
      </span>
    </div>
  );
}
