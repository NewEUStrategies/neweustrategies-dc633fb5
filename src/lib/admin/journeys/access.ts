// UPRAWNIENIA I MFA W UI ŚCIEŻEK (S8) - lustro bramek serwera, nie autorytet.
//
// KTO CO MOŻE (SPEC §2.5, `journeys.functions.ts`): odczyt, szkic, treść maila,
// test na sobie i wyjście kontaktu - `requireCrmStaff` (admin albo redaktor);
// publikacja, status, ustawienia silnika i pominięcie czekania -
// `requireAdmin`. Panel nie proponuje akcji, którą serwer odrzuci: redaktor
// widzi ustawienia silnika w podglądzie, a nie formularz kończący się
// odmową po kliknięciu „Zapisz”.
//
// ROLE DOKŁADNE, NIE `isAdmin`. `useAuth().isAdmin` liczy też `super_admin`,
// a polityki ścieżek (`is_admin_or_editor()`, `has_role(…, 'admin')`) pytają
// o wiersz `admin`/`editor` w najemcy - sam `super_admin` dostałby edytor,
// w którym baza bez błędu zwraca zero wierszy. Ta sama reguła co
// `RevenueHubLayout` i `hubTabsFor(roles)`.
//
// MFA. Middleware `requireCrmStaff`/`requireAdmin` rzuca
// `Error("Forbidden: mfa_required …")` wyłącznie dla kont z drugim składnikiem
// i sesją `aal1` (`require-staff.ts`). Rozpoznajemy dosłowny token, jak
// `platformGateDenial` w panelu płatności - komunikat odmowy ROLI ma inny tekst
// („Forbidden: … role … required”), a wszystko inne to zwykły błąd odczytu.
//
// Moduł bez zależności runtime (liść).

/** Role, które UI ścieżek rozróżnia (pozostałe nie dają żadnej zdolności). */
export type JourneyRole = "admin" | "editor";

export interface JourneyCapabilities {
  /** Szkic: graf, ustawienia, treść maili, tworzenie i instalacja szablonu. */
  canEdit: boolean;
  /** Publikacja wersji oraz pauza, wznowienie i archiwum. */
  canPublish: boolean;
  /** Ustawienia silnika (włączenie, limit, cisza nocna, nadawca, piksel). */
  canManageEngine: boolean;
  /** „Pomiń oczekiwanie” zapisu testowego. */
  canSkipWait: boolean;
  /** „Testuj na sobie” i wyjście własnego zapisu testowego. */
  canTest: boolean;
}

const NONE: JourneyCapabilities = {
  canEdit: false,
  canPublish: false,
  canManageEngine: false,
  canSkipWait: false,
  canTest: false,
};

export function journeyCapabilities(roles: readonly string[]): JourneyCapabilities {
  const admin = roles.includes("admin");
  const editor = roles.includes("editor");
  if (!admin && !editor) return NONE;
  return {
    canEdit: true,
    canPublish: admin,
    canManageEngine: admin,
    canSkipWait: admin,
    canTest: true,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Odmowa z powodu braku `aal2` (dosłowny token middleware). */
export function isMfaRequiredError(error: unknown): boolean {
  return /mfa_required/.test(messageOf(error));
}

/**
 * Odmowa ROLI z middleware (`Forbidden: CRM staff role … required`,
 * `Forbidden: admin role required`). Weryfikacja roli zakończona awarią
 * („could not verify”) to NIE jest odmowa - ponowienie może przejść.
 */
export function isRoleDeniedError(error: unknown): boolean {
  const message = messageOf(error);
  if (isMfaRequiredError(error)) return false;
  return /^Forbidden: (?!could not verify).*role.* required$/.test(message);
}

/** Jedno rozstrzygnięcie dla ekranu: co pokazać zamiast treści. */
export type JourneyAccessDenial = "mfa_required" | "role" | null;

export function journeyAccessDenial(error: unknown): JourneyAccessDenial {
  if (error === null || error === undefined) return null;
  if (isMfaRequiredError(error)) return "mfa_required";
  if (isRoleDeniedError(error)) return "role";
  return null;
}
