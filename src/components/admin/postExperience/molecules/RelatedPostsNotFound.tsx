import { useTranslation } from "react-i18next";
import { ensureI18n } from "@/lib/i18n-admin-related-posts";

/**
 * Molekuła: widok „nie znaleziono" trasy panelu rekomendacji.
 *
 * OSOBNY PLIK, NIE EKSPORT Z ORGANIZMU - i to jest decyzja zmierzona, nie
 * estetyczna. Gdy plik trasy importował z modułu organizmu DWIE rzeczy (panel
 * i ten widok), Vite wydzielał organizm do własnego chunku i sam podział
 * kosztował ~2 KB gzip; pozostałe trzy panele modułu, importowane pojedynczo,
 * wchodzą wprost do chunku swojej trasy. Rozdzielenie plików wyrównuje to
 * z resztą modułu, a widok zachowuje własny test.
 */
export function RelatedPostsNotFound() {
  ensureI18n();
  const { t } = useTranslation();
  return <div className="p-8">{t("adminRelatedPosts.notFound")}</div>;
}
