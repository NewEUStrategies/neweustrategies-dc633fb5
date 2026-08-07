// MOLEKUŁA: dystans w sieci = odznaka stopnia + droga do niej.
//
// Jeden komponent dla wszystkich powierzchni, bo „2°" bez „przez Annę" jest
// ciekawostką, a nie wskazówką - i odwrotnie. Stan przychodzi z zewnątrz
// (batchowany `connection_statuses` albo wiersz `connection_suggestions`),
// więc molekuła nie robi żadnego zapytania i nadaje się do list.
import { cn } from "@/lib/utils";
import {
  isDegreeVisible,
  type ConnectionBridge,
  type ConnectionDegree,
} from "@/lib/network/degree";
import { DegreeBadge } from "../atoms/DegreeBadge";
import { ConnectionPathTrail } from "./ConnectionPathTrail";
import { useNetworkDegreeLabels } from "../useDegreeLabels";

export interface ConnectionDistanceProps {
  degree: ConnectionDegree;
  bridge: ConnectionBridge | null;
  targetName: string;
  targetAvatarUrl?: string | null;
  /**
   * `trail` - pełna ścieżka „Ty -> Anna -> Marek" (karty, profil),
   * `via`   - skrót „przez Annę" dla wierszy, w których nie ma na nią miejsca,
   * `none`  - sama odznaka.
   */
  path?: "trail" | "via" | "none";
  density?: "full" | "compact";
  /** Patrz ConnectionPathTrail - `false` wewnątrz linku całej karty. */
  interactive?: boolean;
  className?: string;
}

export function ConnectionDistance({
  degree,
  bridge,
  targetName,
  targetAvatarUrl,
  path = "trail",
  density = "compact",
  interactive = true,
  className,
}: ConnectionDistanceProps) {
  const labels = useNetworkDegreeLabels();
  if (!isDegreeVisible(degree)) return null;

  const showVia = path === "via" && degree !== 1 && bridge !== null;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5",
        className,
      )}
    >
      <DegreeBadge degree={degree} size={density === "full" ? "sm" : "xs"} />
      {path === "trail" && (
        <ConnectionPathTrail
          degree={degree}
          bridge={bridge}
          targetName={targetName}
          targetAvatarUrl={targetAvatarUrl}
          density={density}
          interactive={interactive}
        />
      )}
      {showVia && bridge !== null && (
        <span className="truncate text-[11px] text-muted-foreground">
          {labels.via(bridge.name)}
        </span>
      )}
    </span>
  );
}
