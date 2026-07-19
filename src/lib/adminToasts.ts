// Współdzielone toasty admina bez wymagania hooka useTranslation.
// Bezpośredni odczyt z instancji i18next - używane w callbacku / mutation
// gdzie hook nie jest dostępny, oraz w plikach które nie chcą pełnej migracji.
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-toasts";

export const adminToast = {
  saved: () => i18n.t("adminToasts.saved"),
  deleted: () => i18n.t("adminToasts.deleted"),
  sent: () => i18n.t("adminToasts.sent"),
  added: () => i18n.t("adminToasts.added"),
  updated: () => i18n.t("adminToasts.updated"),
  error: () => i18n.t("adminToasts.error"),
  nameRequired: () => i18n.t("adminToasts.nameRequired"),
  keyRequired: () => i18n.t("adminToasts.keyRequired"),
  emptyContent: () => i18n.t("adminToasts.emptyContent"),
  fileTooBig: () => i18n.t("adminToasts.fileTooBig"),
  imageRequired: () => i18n.t("adminToasts.imageRequired"),
  missingTenant: () => i18n.t("adminToasts.missingTenant"),
  labelRequired: () => i18n.t("adminToasts.labelRequired"),
  prewarmDone: () => i18n.t("adminToasts.prewarmDone"),
  settingsSaved: () => i18n.t("adminToasts.settingsSaved"),
  layoutSaved: () => i18n.t("adminToasts.layoutSaved"),
};
