// Formatowanie karty „Profil w serwisie" na karcie kontaktu CRM.
//
// Rozmiar pliku CV i rok z daty to reguły prezentacji, które stały wewnątrz
// `ProfileSyncCard` - razem z zapytaniem i renderem, więc niesprawdzalne inaczej
// niż przez render całej karty. Format jest widoczny dla sprzedaży („2,4 MB",
// „2019"), a dane wejściowe bywają puste albo uszkodzone.
import { nullIfBlank } from "@/lib/crm/text";

/** Rozmiar pliku w jednostce czytelnej dla człowieka (B / KB / MB). */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sam rok z daty ISO; pusty napis dla braku i dla daty nieparsowalnej. */
export function formatYear(iso: string | null | undefined): string {
  if (!iso) return "";
  const year = new Date(iso).getFullYear();
  return Number.isFinite(year) ? String(year) : "";
}

/** Zakres lat doświadczenia/wykształcenia: „2019-2023" albo „2019-" (trwa). */
export function formatYearRange(
  from: string | null | undefined,
  to: string | null | undefined,
  ongoing = false,
): string {
  const start = formatYear(from);
  const end = formatYear(to);
  if (!start && !end) return "";
  if (ongoing || !end) return start ? `${start}-` : "";
  return start ? `${start}-${end}` : end;
}

/** Nazwa osoby z profilu - kolejność: nazwa wyświetlana, imię+nazwisko, e-mail. */
export function profileDisplayName(profile: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const parts = [profile.first_name, profile.last_name]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return (
    nullIfBlank(profile.display_name) ?? nullIfBlank(parts) ?? nullIfBlank(profile.email) ?? ""
  );
}
