// Sloty leniwej powierzchni GPC - jedyne wejście dla banera i centrum
// prywatności. Każdy slot sam decyduje, czy jest co pokazywać, więc wołający nie
// musi pamiętać ani o warunku, ani o `Suspense`.
//
// Wszystkie trzy `lazy()` celują w TEN SAM moduł (`GpcSurface`), więc bundler
// tworzy JEDEN async chunk - pobierany raz, niezależnie od tego, ile slotów
// pojawi się na stronie. `fallback={null}` jest właściwym fallbackiem: klamra
// GPC działa już synchronicznie (patrz `lib/consent/gpc.ts`), a to jest wyłącznie
// jej wyjaśnienie - nie ma tu stanu, którego brak byłby mylący.
//
// Etykiety badge'y są wstrzykiwane WEWNĄTRZ chunka (a nie przez `t()` u
// wołającego), bo nakładka i18n `consentGpc.*` też jedzie tym chunkiem - inaczej
// baner musiałby ją importować statycznie i cały zabieg nie miałby sensu.
import { Suspense, lazy } from "react";
import type { GpcSource } from "@/lib/consent/gpc";

const GpcNoticeLazy = lazy(() =>
  import("@/components/consent/GpcSurface").then((m) => ({ default: m.GpcNotice })),
);
const GpcBadgeLazy = lazy(() =>
  import("@/components/consent/GpcSurface").then((m) => ({ default: m.GpcBadge })),
);
const GpcRegistryNoteLazy = lazy(() =>
  import("@/components/consent/GpcSurface").then((m) => ({ default: m.GpcRegistryNote })),
);
const GpcDeclarationLinkLazy = lazy(() =>
  import("@/components/consent/GpcSurface").then((m) => ({ default: m.GpcDeclarationLink })),
);

export interface GpcNoticeSlotProps {
  /** Czy sygnał jest w ogóle aktywny - `false` nie renderuje nawet Suspense. */
  active: boolean;
  source: GpcSource;
  /** Sygnał aktywny, ale nadpisany świadomą zgodą użytkownika. */
  overridden?: boolean;
  onRestore?: () => void;
  variant?: "card" | "compact";
  className?: string;
}

/** Nota o sygnale GPC - nic nie renderuje, dopóki sygnału nie ma. */
export function GpcNoticeSlot({ active, ...props }: GpcNoticeSlotProps) {
  if (!active) return null;
  return (
    <Suspense fallback={null}>
      <GpcNoticeLazy {...props} />
    </Suspense>
  );
}

/** Znacznik „GPC" z etykietą kategorii wyłączonej sygnałem. */
export function GpcCategoryBadgeSlot({ clamped }: { clamped: boolean }) {
  if (!clamped) return null;
  return (
    <Suspense fallback={null}>
      <GpcBadgeLazy labelKey="consentGpc.categoryLocked" />
    </Suspense>
  );
}

/** Znacznik „GPC" przy wpisie audytu podjętym przy aktywnym sygnale. */
export function GpcEventBadgeSlot({ gpc }: { gpc: boolean }) {
  if (!gpc) return null;
  return (
    <Suspense fallback={null}>
      <GpcBadgeLazy labelKey="consentGpc.registry.active" />
    </Suspense>
  );
}

/** Objaśnienie kolumny GPC - tylko gdy historia realnie ją zawiera. */
export function GpcRegistryNoteSlot({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Suspense fallback={null}>
      <GpcRegistryNoteLazy />
    </Suspense>
  );
}

/**
 * Deklaracja honorowania sygnału + link do `/.well-known/gpc.json`. Renderowana
 * bezwarunkowo (oświadczenie obowiązuje niezależnie od sygnału konkretnej osoby),
 * ale wciąż z leniwego chunka - to ta sama nakładka i18n.
 */
export function GpcDeclarationSlot({ className }: { className?: string }) {
  return (
    <Suspense fallback={null}>
      <GpcDeclarationLinkLazy className={className} />
    </Suspense>
  );
}
