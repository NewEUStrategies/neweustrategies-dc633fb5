// MOLEKUŁA: ścieżka kontaktu - „Ty -> Anna -> Marek".
//
// To jest brakujące ogniwo luki #6: baza od zawsze umiała policzyć drugi
// stopień, ale użytkownik nigdy nie widział, PRZEZ KOGO ta droga biegnie.
// Odznaka mówi „jak daleko", ścieżka mówi „którędy" - i dopiero razem
// zamieniają liczbę we wskazówkę operacyjną (kogo poprosić o wprowadzenie).
//
// Węzły:
//   1° -> Ty -> Osoba                (nie ma czego mostkować)
//   2° -> Ty -> Most -> Osoba
//   3° -> Ty -> Most -> (ukryty) -> Osoba
// Środkowy węzeł 3. stopnia jest nienazwany z rozmysłem - to kontakt mojego
// kontaktu, nie mój; ujawnienie go byłoby wyciekiem cudzej sieci.
//
// Gdy baza nie miała prawa nazwać mostu (profil bez opt-inu `discoverable`),
// ścieżka degraduje się do samego dystansu i komponent nic nie renderuje -
// odznaka stopnia zostaje i to ona niesie wtedy całą informację.
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isDegreeVisible,
  type ConnectionBridge,
  type ConnectionDegree,
} from "@/lib/network/degree";
import { PathNode, type PathNodeVariant } from "../atoms/PathNode";
import { useNetworkDegreeLabels } from "../useDegreeLabels";

export interface ConnectionPathTrailProps {
  degree: ConnectionDegree;
  bridge: ConnectionBridge | null;
  /** Osoba na końcu ścieżki (ta, której kartę/profil właśnie oglądam). */
  targetName: string;
  targetAvatarUrl?: string | null;
  targetSlug?: string | null;
  /** `full` - z awatarami (profil), `compact` - sama typografia (karty list). */
  density?: "full" | "compact";
  /**
   * Czy most ma być linkiem do profilu. Na kartach list ścieżka mieszka
   * WEWNĄTRZ linku całej karty, a `<a>` w `<a>` to nieprawidłowy HTML -
   * tam przekazujemy `false` i most zostaje tekstem.
   */
  interactive?: boolean;
  className?: string;
}

interface TrailNode {
  readonly key: string;
  readonly variant: PathNodeVariant;
  readonly label: string;
  readonly avatarUrl?: string | null;
  readonly slug?: string | null;
}

export function ConnectionPathTrail({
  degree,
  bridge,
  targetName,
  targetAvatarUrl,
  density = "compact",
  interactive = true,
  className,
}: ConnectionPathTrailProps) {
  const labels = useNetworkDegreeLabels();

  // Bez mostu ścieżka miałaby jedno ogniwo mniej niż mówi stopień - lepiej nie
  // rysować jej wcale niż rysować drogę, której nie umiemy pokazać.
  if (!isDegreeVisible(degree) || degree === 1 || !bridge) return null;

  const nodes: TrailNode[] = [
    { key: "you", variant: "you", label: labels.you },
    {
      key: `bridge-${bridge.id}`,
      variant: "person",
      label: bridge.name,
      avatarUrl: bridge.avatarUrl,
      slug: interactive ? bridge.slug : null,
    },
    ...(degree === 3 ? [{ key: "hidden", variant: "hidden" as const, label: labels.hidden }] : []),
    {
      key: "target",
      variant: "person",
      label: targetName,
      avatarUrl: targetAvatarUrl,
      // Cel ścieżki nie jest linkiem: albo już go oglądam, albo jego karta
      // obok ma własny, bogatszy odnośnik. Dwa linki do tego samego profilu
      // w jednym wierszu to szum dla czytnika ekranu.
      slug: null,
    },
  ];

  const spoken = nodes.map((node) => node.label).join(" - ");

  return (
    <span
      // Ścieżka jest jednym komunikatem, nie listą linków do przeklikania:
      // grupa z etykietą daje czytnikowi ekranu pełne zdanie przy wejściu,
      // nie odbierając przy tym fokusu linkowi mostu (to wykluczałoby się
      // z `aria-hidden` na treści).
      role="group"
      aria-label={labels.pathAria(spoken)}
      className={cn(
        "inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted-foreground",
        density === "full" && "text-xs",
        className,
      )}
    >
      {nodes.map((node, index) => (
        <span key={node.key} className="inline-flex min-w-0 items-center gap-1">
          {index > 0 && (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />
          )}
          <PathNode
            variant={node.variant}
            label={node.label}
            avatarUrl={node.avatarUrl}
            slug={node.slug}
            density={density}
          />
        </span>
      ))}
    </span>
  );
}
