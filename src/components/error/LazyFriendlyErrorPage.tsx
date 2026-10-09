// Leniwa granica wokół `FriendlyErrorPage`.
//
// Ekran błędu nie bierze udziału w UDANYM pierwszym renderze żadnej strony,
// a statyczne importy z `router.tsx`, `__root.tsx`, `ErrorBoundary` i
// `RouteErrorFallback` trzymały go (12,9 kB źródeł + 11 ikon lucide) w chunku
// wejściowym każdej strony publicznej. Tutaj `React.lazy` wynosi go poza boot;
// WSZYSTKIE cztery miejsca montują ten wrapper, bo jeden pozostały import
// statyczny wciągnąłby moduł z powrotem do chunku wejściowego.
//
// SSR: `React.lazy` renderuje się na serwerze w strumieniu - najpierw idzie
// fallback, a treść ekranu dostrumieniowuje się po rozwiązaniu modułu
// (`stream.allReady`). Fallback jest celowo BEZ SŁÓW: rezerwuje wysokość
// ekranu (zero CLS), a słownik awaryjny czyta dopiero sam ekran - przez to
// ani jeden tekst nie powstaje w dwóch miejscach.
//
// `ChunkLoadGate`: jeśli pobranie chunku ekranu padnie (sieć leży - a to
// częsta PRZYCZYNA samego błędu), `lazy` rzuciłby do nadrzędnej granicy
// i strona zostałaby pusta. Tu kończy się minimalną kartą ze słownika
// awaryjnego (`errorCopy` nie potrzebuje providera i18n) i przeładowaniem.
import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from "react";
import { errorCopy } from "@/lib/errorCopy";
import type { FriendlyErrorPageProps } from "./FriendlyErrorPage";

const FriendlyErrorPage = lazy(() =>
  import("./FriendlyErrorPage").then((m) => ({ default: m.FriendlyErrorPage })),
);

type Variant = NonNullable<FriendlyErrorPageProps["variant"]>;

/** Rezerwacja miejsca na czas pobierania chunku - te same wymiary co ekran. */
function ReservedSpace({ variant }: { variant: Variant }) {
  return (
    <div
      aria-busy="true"
      className={
        variant === "compact"
          ? "min-h-[16rem] rounded-[6px] border border-border bg-card"
          : "min-h-[calc(100vh-4rem)] bg-background"
      }
    />
  );
}

/** Ostatnia linia obrony: chunk ekranu błędu nie dojechał. */
function ChunkLoadFallback({ variant }: { variant: Variant }) {
  const copy = errorCopy();
  // Bez `noindex`: ta karta znaczy, że chunk nie dojechał - stan chwilowy
  // z definicji (reguła w `FriendlyErrorPage`). Tekst awarii nie trafia za to
  // do fragmentu wyniku (`data-nosnippet`).
  return (
    <div
      role="alert"
      data-nosnippet
      className={
        variant === "compact"
          ? "rounded-[6px] border border-border bg-card p-6 text-card-foreground"
          : "flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 bg-background px-4 text-center"
      }
    >
      <h1 className="font-display text-xl font-semibold text-foreground">{copy.errorTitle}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{copy.errorBody}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex h-11 items-center justify-center rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {copy.tryAgain}
      </button>
    </div>
  );
}

interface GateProps {
  children: ReactNode;
  variant: Variant;
}

class ChunkLoadGate extends Component<GateProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error("[error-page] nie udało się załadować chunku ekranu błędu", error);
  }

  render(): ReactNode {
    return this.state.failed ? (
      <ChunkLoadFallback variant={this.props.variant} />
    ) : (
      this.props.children
    );
  }
}

export function LazyFriendlyErrorPage(props: FriendlyErrorPageProps) {
  const variant = props.variant ?? "page";
  return (
    <ChunkLoadGate variant={variant}>
      <Suspense fallback={<ReservedSpace variant={variant} />}>
        <FriendlyErrorPage {...props} />
      </Suspense>
    </ChunkLoadGate>
  );
}
