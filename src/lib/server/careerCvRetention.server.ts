// Job retencji plików CV - strona wykonawcza.
//
// PODZIAŁ ODPOWIEDZIALNOŚCI: SQL decyduje CO skasować (`career_cv_gc_scan`
// wypełnia kolejkę), ten moduł WYKONUJE usunięcie. Powód jest twardy: instrukcja
// SQL nie usuwa obiektu z magazynu - DELETE z `storage.objects` zostawia plik
// w koszu Storage'a, bo klucz obiektu buduje się z wiersza. Skasować potrafi
// wyłącznie API magazynu, czyli `storage.remove()` z kluczem service-role.
//
// Dwa źródła śmieci, oba realne:
//   1. PORZUCONY KREATOR - plik ląduje w buckecie przy WYBORZE, przed wysyłką
//      formularza, więc kandydat, który zamknie kartę, zostawia CV bez
//      zgłoszenia. Bez tego joba leżało tam na zawsze.
//   2. RETENCJA - proces domknięty (hired / rejected / withdrawn) starszy niż
//      `career_settings.cv_retention_days`. Otwarty proces NIE traci CV bez
//      względu na wiek.
//
// Job jest idempotentny i wznawialny: kolejka jest claimowana z licznikiem prób,
// a partia, która padnie w połowie, wraca w kolejnym ticku.
import { CV_BUCKET } from "@/lib/careers/cvUpload";
import {
  emptyRetentionResult,
  parseCvGcClaims,
  parseCvGcScan,
  type CvRetentionResult,
} from "@/lib/careers/cvRetention";

/** Górny limit jednej partii - trzyma tick w budżecie czasu crona. */
const SCAN_LIMIT = 200;
const DELETE_LIMIT = 50;

/**
 * Jeden przebieg retencji CV.
 *
 * Nie rzuca przy błędzie pojedynczej ścieżki: pozycja wraca do kolejki z
 * `last_error`, a przebieg raportuje `failed`. Rzuca tylko wtedy, gdy nie da się
 * wykonać samego skanu/claimu - to znaczy, że job jest zepsuty, a nie dane.
 */
export async function runCareerCvRetention(): Promise<CvRetentionResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const result = emptyRetentionResult();

  const { data: scanRaw, error: scanErr } = await supabaseAdmin.rpc("career_cv_gc_scan", {
    _limit: SCAN_LIMIT,
  });
  if (scanErr) throw new Error(`career_cv_gc_scan: ${scanErr.message}`);
  const scan = parseCvGcScan(scanRaw);
  result.scannedOrphans = scan.orphans;
  result.scannedRetention = scan.retention;

  const { data: claimRaw, error: claimErr } = await supabaseAdmin.rpc("career_cv_gc_claim", {
    _limit: DELETE_LIMIT,
  });
  if (claimErr) throw new Error(`career_cv_gc_claim: ${claimErr.message}`);
  const claims = parseCvGcClaims(claimRaw);
  result.claimed = claims.length;

  if (claims.length > 0) {
    const paths = claims.map((c) => c.path);
    const { data: removed, error: removeErr } = await supabaseAdmin.storage
      .from(CV_BUCKET)
      .remove(paths);

    if (removeErr) {
      // Cała partia nie poszła (np. magazyn niedostępny). Oddajemy ją kolejce -
      // `claimed_at` jest zerowany, więc następny tick ją powtórzy, a licznik
      // prób i tak zamknie pętlę na ścieżce trwale nie do usunięcia.
      for (const path of paths) {
        await supabaseAdmin.rpc("career_cv_gc_fail", {
          _path: path,
          _error: removeErr.message,
        });
      }
      result.failed = paths.length;
    } else {
      // `remove()` zwraca obiekty faktycznie usunięte. Ścieżka, której magazyn
      // nie zna (plik już nie istnieje, a wiersz kolejki został), jest dla nas
      // ZROBIONA - inaczej wisiałaby do wyczerpania prób i blokowała partię.
      const removedNames = new Set(
        (removed ?? []).map((o) => (o as { name?: string }).name).filter(Boolean) as string[],
      );
      const done = paths.filter((p) => removedNames.has(p) || removedNames.size === 0);
      const settled = done.length > 0 ? done : paths;

      const { data: cleared, error: doneErr } = await supabaseAdmin.rpc("career_cv_gc_done", {
        _paths: settled,
      });
      if (doneErr) throw new Error(`career_cv_gc_done: ${doneErr.message}`);
      result.deleted = typeof cleared === "number" ? cleared : settled.length;
    }
  }

  const { count } = await supabaseAdmin
    .from("career_cv_gc_queue")
    .select("id", { count: "exact", head: true });
  result.pending = count ?? 0;

  return result;
}
