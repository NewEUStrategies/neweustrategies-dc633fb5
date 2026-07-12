// Bilingual (PL/EN) error-to-toast mapper. Mirrors src/lib/errorCopy.ts: it
// resolves the language via currentLang() (NOT i18next), so it works inside
// TanStack server-fn onError callbacks that may run outside the React i18next
// provider. It maps known Supabase / Postgres / Storage / Auth error shapes to
// friendly copy, ALWAYS console.error's the raw error for debugging, and NEVER
// passes the raw error.message to the user-facing toast.
import { toast } from "sonner";
import { currentLang } from "@/lib/i18n/localeRuntime";

// Fallback bucket chosen by the call site when no specific code matches.
export type ToastErrorKind = "save" | "load" | "delete" | "upload" | "generic";

type Copy = Record<string, string>;

// Category copy keyed by an internal id resolved from the error code/shape.
const COPY: Record<"pl" | "en", Copy> = {
  pl: {
    duplicate: "Taki wpis już istnieje.",
    inUse: "Nie można usunąć — element jest nadal używany.",
    missingField: "Uzupełnij wymagane pola.",
    invalidValue: "Nieprawidłowa wartość.",
    forbidden: "Nie masz uprawnień do tej operacji.",
    sessionExpired: "Sesja wygasła. Zaloguj się ponownie.",
    network: "Problem z połączeniem. Sprawdź internet i spróbuj ponownie.",
    fileTooLarge: "Plik jest za duży.",
    save: "Nie udało się zapisać zmian.",
    load: "Nie udało się wczytać danych.",
    delete: "Nie udało się usunąć.",
    upload: "Nie udało się wgrać pliku.",
    generic: "Coś poszło nie tak. Spróbuj ponownie.",
  },
  en: {
    duplicate: "This item already exists.",
    inUse: "Can't delete — this item is still in use.",
    missingField: "Please fill in the required fields.",
    invalidValue: "That value isn't allowed.",
    forbidden: "You don't have permission to do that.",
    sessionExpired: "Your session expired. Please sign in again.",
    network: "Connection problem. Check your internet and try again.",
    fileTooLarge: "This file is too large.",
    save: "Couldn't save your changes.",
    load: "Couldn't load the data.",
    delete: "Couldn't delete that.",
    upload: "Couldn't upload the file.",
    generic: "Something went wrong. Please try again.",
  },
};

function extract(e: unknown): { code?: string; status?: number; message: string } {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return {
      code: typeof o.code === "string" ? o.code : undefined,
      status:
        typeof o.status === "number"
          ? o.status
          : typeof o.statusCode === "number"
            ? o.statusCode
            : undefined,
      message: typeof o.message === "string" ? o.message : String(e),
    };
  }
  return { message: String(e) };
}

function classify(e: unknown, fallback: ToastErrorKind): string {
  const { code, status, message } = extract(e);
  const m = message.toLowerCase();
  switch (code) {
    case "23505":
      return "duplicate";
    case "23503":
      return "inUse";
    case "23502":
      return "missingField";
    case "23514":
      return "invalidValue";
    case "42501":
      return "forbidden";
    case "PGRST301":
      return "sessionExpired";
  }
  if (status === 413 || m.includes("maximum allowed size") || m.includes("payload too large"))
    return "fileTooLarge";
  if (
    status === 401 ||
    status === 403 ||
    m.includes("row-level security") ||
    m.includes("permission denied")
  )
    return "forbidden";
  if (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("network request failed")
  )
    return "network";
  return fallback;
}

/**
 * Show a friendly, localized error toast. The raw error is logged to the
 * console for debugging and is NEVER shown to the user.
 */
export function toastError(e: unknown, fallback: ToastErrorKind = "generic"): void {
  // Always surface the real error to developers.
  console.error("[toastError]", e);
  const lang = currentLang() === "pl" ? "pl" : "en";
  const key = classify(e, fallback);
  toast.error(COPY[lang][key] ?? COPY[lang].generic);
}
