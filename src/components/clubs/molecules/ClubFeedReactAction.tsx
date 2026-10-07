// Molekuła: akcja „Zareaguj" pod kartą strumienia - z paletą reakcji.
//
// DWA GESTY, JEDEN PRZYCISK. Kliknięcie jest gestem sekundowym i stawia
// reakcję domyślną („wnosi wiedzę" - jakość wypowiedzi, nie deklaracja zdania),
// a kliknięcie postawionej reakcji ją zdejmuje. Pełna paleta sześciu reakcji
// otwiera się na ŻĄDANIE:
//   * myszą      - po krótkim zatrzymaniu kursora nad przyciskiem,
//   * dotykiem   - po przytrzymaniu (kliknięcie po przytrzymaniu nie liczy się),
//   * klawiaturą - strzałką w górę; strzałki w bok chodzą po palecie, Escape
//                  wraca do przycisku,
//   * czytnikiem ekranu - osobnym przyciskiem „Wybierz reakcję" tuż za akcją
//                  (widocznym przy fokusie z klawiatury): w trybie przeglądania
//                  NVDA/JAWS strzałki należą do wirtualnego kursora, więc sam
//                  skrót nie wystarcza.
// Paleta znika po wyborze, po zjechaniu kursorem, po dotknięciu poza nią
// i gdy fokus z niej wyjdzie (Tab). Fokus chodzi po palecie jednym
// przystankiem tabulacji (roving tabindex).
//
// RUCH. Glify wskakują kaskadą z lekkim przestrzeleniem (`club-reaction-pop`),
// a najechany glif podnosi się i powiększa z podpisem nad sobą. Postawienie
// reakcji odbija piktogram w przycisku (`club-reaction-tap`). Animacja
// wejścia i animacja najazdu siedzą na DWÓCH elementach: animacja z
// `fill-mode: both` trzyma `transform` i zjadałaby transformację najazdu.
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  CLUB_REACTION_ICONS,
  ClubReactionGlyph,
  clubReactionInkClass,
} from "@/components/clubs/atoms/ClubReactionGlyph";
import {
  CLUB_FEED_ACTION_ICON,
  CLUB_FEED_ACTION_LABEL,
  clubFeedActionClass,
} from "@/components/clubs/molecules/ClubFeedCard";
import {
  CLUB_QUALITY_REACTIONS,
  CLUB_STANCE_REACTIONS,
  type ClubReactionKind,
  type ClubReactionTally,
} from "@/lib/clubs/types";

/** Reakcja stawiana jednym kliknięciem. */
const CLUB_DEFAULT_REACTION: ClubReactionKind = "insightful";

const ORDER: readonly ClubReactionKind[] = [...CLUB_QUALITY_REACTIONS, ...CLUB_STANCE_REACTIONS];
const HOVER_OPEN_MS = 380;
const HOVER_CLOSE_MS = 260;
const LONG_PRESS_MS = 420;

export function ClubFeedReactAction({
  tallies,
  disabled = false,
  onToggle,
}: {
  tallies: readonly ClubReactionTally[];
  disabled?: boolean;
  onToggle: (kind: ClubReactionKind, active: boolean) => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  // Jedyny przystanek tabulacji w palecie - przesuwa się ze strzałkami.
  const [activeIndex, setActiveIndex] = useState(0);
  // Zmiana klucza restartuje animację odbicia piktogramu.
  const [tapKey, setTapKey] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOpened = useRef(false);
  const focusFirst = useRef(false);

  const isMine = (kind: ClubReactionKind): boolean =>
    tallies.some((tally) => tally.kind === kind && tally.mine);
  const mine = ORDER.find(isMine) ?? null;
  const shown = mine ?? CLUB_DEFAULT_REACTION;
  const Icon = CLUB_REACTION_ICONS[shown];

  const clearTimers = useCallback((): void => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    hoverTimer.current = null;
    pressTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Dotknięcie albo kliknięcie poza paletą ją zamyka.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Otwarcie z klawiatury przenosi fokus na pierwszy glif - po renderze palety.
  // Zamknięcie zdejmuje niewykorzystaną flagę, żeby późniejsze otwarcie
  // najazdem nie wyrwało fokusu z miejsca, w którym akurat jest użytkownik.
  useEffect(() => {
    if (!open) {
      focusFirst.current = false;
      return;
    }
    if (focusFirst.current) {
      focusFirst.current = false;
      optionRefs.current[0]?.focus({ preventScroll: true });
    }
  }, [open]);

  /** Otwarcie z klawiatury lub czytnika: fokus na pierwszy glif. */
  const openFromKeyboard = (): void => {
    clearTimers();
    setActiveIndex(0);
    if (open) {
      optionRefs.current[0]?.focus({ preventScroll: true });
      return;
    }
    focusFirst.current = true;
    setOpen(true);
  };

  const choose = (kind: ClubReactionKind): void => {
    clearTimers();
    const active = isMine(kind);
    setOpen(false);
    if (!active) setTapKey((key) => key + 1);
    onToggle(kind, active);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const primary = (): void => {
    // Kliknięcie anuluje otwarcie zaplanowane najazdem - inaczej paleta
    // wyskakiwałaby chwilę PO postawieniu reakcji.
    clearTimers();
    if (pressOpened.current) {
      pressOpened.current = false;
      return;
    }
    setOpen(false);
    if (mine !== null) {
      onToggle(mine, true);
      return;
    }
    setTapKey((key) => key + 1);
    onToggle(CLUB_DEFAULT_REACTION, false);
  };

  const label = mine !== null ? t(`club.reaction.${mine}`) : t("club.hub.feed.addReaction");

  return (
    <div
      ref={rootRef}
      className="relative flex min-w-0 flex-1"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse" || disabled) return;
        clearTimers();
        hoverTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimers();
        hoverTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
      }}
      onBlur={(event) => {
        // Fokus wyszedł poza akcję i paletę (Tab) - paleta nie może zostać
        // nad kartą. Brak `relatedTarget` (klik w coś niefokusowalnego)
        // obsługuje nasłuch `pointerdown` wyżej.
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          clearTimers();
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-pressed={mine !== null}
        aria-describedby={hintId}
        aria-label={
          mine !== null
            ? t("club.hub.feed.reactionRemove", { reaction: label })
            : t("club.hub.feed.reactionDefault", {
                reaction: t(`club.reaction.${CLUB_DEFAULT_REACTION}`),
              })
        }
        data-testid="club-add-reaction"
        data-reaction={mine ?? undefined}
        className={clubFeedActionClass({
          className: mine !== null ? clubReactionInkClass(mine) : undefined,
        })}
        onClick={primary}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          pressOpened.current = false;
          if (pressTimer.current !== null) clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => {
            pressOpened.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => {
          if (pressTimer.current !== null) clearTimeout(pressTimer.current);
        }}
        onPointerCancel={() => {
          if (pressTimer.current !== null) clearTimeout(pressTimer.current);
        }}
        onContextMenu={(event) => {
          // Przytrzymanie na telefonie nie może otwierać menu systemowego.
          if (pressOpened.current) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            openFromKeyboard();
          } else if (event.key === "Escape" && open) {
            setOpen(false);
          }
        }}
      >
        <span key={tapKey} className={cn("inline-flex", tapKey > 0 && "club-reaction-tap")}>
          <Icon
            className={CLUB_FEED_ACTION_ICON}
            strokeWidth={mine !== null ? 2.4 : 2}
            aria-hidden="true"
          />
        </span>
        <span className={CLUB_FEED_ACTION_LABEL}>{label}</span>
      </button>
      <span id={hintId} className="sr-only">
        {t("club.hub.feed.reactionHint")}
      </span>
      {/* Wejście do palety dla czytnika ekranu i klawiatury - niewidoczne,
          dopóki nie dostanie fokusu, żeby nie rozbijać równych kolumn akcji. */}
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
        data-testid="club-reaction-picker-toggle"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openFromKeyboard();
        }}
        className={cn(
          "sr-only",
          "focus-visible:not-sr-only focus-visible:absolute focus-visible:-top-3 focus-visible:right-1 focus-visible:z-40",
          "focus-visible:rounded-md focus-visible:bg-popover focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs",
          "focus-visible:font-medium focus-visible:text-popover-foreground focus-visible:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {t("club.hub.feed.reactionPicker")}
      </button>

      {open ? (
        <div
          id={pickerId}
          role="toolbar"
          aria-label={t("club.hub.feed.reactionPicker")}
          data-testid="club-reaction-picker"
          className={cn(
            "club-feed-picker-in absolute bottom-full left-0 z-30 mb-1.5 flex items-center gap-0.5",
            "rounded-xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-lg",
          )}
          onKeyDown={(event) => {
            const current = optionRefs.current.findIndex((node) => node === document.activeElement);
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              const step = event.key === "ArrowRight" ? 1 : -1;
              const next = (current + step + ORDER.length) % ORDER.length;
              setActiveIndex(next);
              optionRefs.current[next]?.focus();
            }
          }}
        >
          {ORDER.map((kind, index) => {
            const active = isMine(kind);
            const reaction = t(`club.reaction.${kind}`);
            return (
              <span key={kind} className="contents">
                {/* Włos między oceną wypowiedzi a deklaracją zdania. */}
                {index === CLUB_QUALITY_REACTIONS.length ? (
                  <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
                ) : null}
                <span
                  className="club-reaction-pop inline-flex"
                  style={{ "--pop-i": index } as CSSProperties}
                >
                  <button
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    aria-pressed={active}
                    aria-label={reaction}
                    tabIndex={index === activeIndex ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => choose(kind)}
                    data-testid={`club-reaction-option-${kind}`}
                    className="group/glyph relative grid h-10 w-10 place-items-center rounded-full focus-visible:outline-none"
                  >
                    <ClubReactionGlyph
                      kind={kind}
                      size="lg"
                      className={cn(
                        "transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                        "group-hover/glyph:-translate-y-1.5 group-hover/glyph:scale-125",
                        "group-focus-visible/glyph:-translate-y-1.5 group-focus-visible/glyph:scale-125",
                        "motion-reduce:transition-none motion-reduce:group-hover/glyph:translate-y-0 motion-reduce:group-hover/glyph:scale-100",
                        active && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover",
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md",
                        "bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-sm",
                        "transition-opacity duration-150 group-hover/glyph:opacity-100 group-focus-visible/glyph:opacity-100",
                      )}
                    >
                      {reaction}
                    </span>
                  </button>
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
