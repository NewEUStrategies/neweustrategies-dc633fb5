// Molecule: cross-module presence - kto teraz ogląda tę encję (task/lead/
// dokument/rozmowa). Jedna implementacja wskaźnika dla wszystkich modułów,
// oparta o uogólnione useEntityPresence; stos twarzy + dostępna etykieta.
//
// Stos to wspólny `AvatarGroup` - ten sam ruch obecności co w klubach: kto
// wchodzi, dołącza na koniec; kto wychodzi, gaśnie, a reszta zsuwa się na
// sprężynie. Zmianę składu ogłasza region `aria-live` stosu, odroczony, żeby
// seria wejść dała jedno zdanie zamiast pięciu.
import "@/lib/i18n-cohesion";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AvatarGroup, type AvatarGroupItem } from "@/components/atoms/AvatarGroup";
import { useEntityPresence, type PresenceEntityType } from "@/lib/realtime/useEntityPresence";
import { cn } from "@/lib/utils";

export interface PresenceIndicatorProps {
  entityType: PresenceEntityType;
  entityId: string | null | undefined;
  className?: string;
  /** Maks. liczba widocznych awatarów; reszta jako "+N". */
  maxAvatars?: number;
}

export function PresenceIndicator({
  entityType,
  entityId,
  className,
  maxAvatars = 4,
}: PresenceIndicatorProps) {
  const { t } = useTranslation();
  const peers = useEntityPresence(entityType, entityId);
  const items = useMemo<AvatarGroupItem[]>(
    () => peers.map((peer) => ({ id: peer.userId, name: peer.name })),
    [peers],
  );
  if (!peers.length) return null;

  const viewing = t("cohesion.presence.viewingNow", { count: peers.length });
  const names = peers.map((p) => p.name).join(", ");

  return (
    <div
      title={`${t("cohesion.presence.here")} ${names}`}
      className={cn("flex items-center gap-1.5", className)}
    >
      <AvatarGroup
        items={items}
        maxVisible={maxAvatars}
        size={20}
        interactive={false}
        label={viewing}
        announce={(all) => `${t("cohesion.presence.here")} ${all.join(", ")}`}
      />
      <span className="hidden text-[11px] text-muted-foreground sm:inline" aria-hidden="true">
        {viewing}
      </span>
    </div>
  );
}
