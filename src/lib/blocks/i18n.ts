// Cienki wrapper na useTranslation() dla edytora i widoków bloków.
// Wszystkie klucze żyją w `blocks.{fields|ui|editors|viewers}.*`.
// Dzięki temu w edytorach i statycznych etykietach widoków pisze się
// `t.field("urlPh")` zamiast pełnego `t("blocks.fields.urlPh")`.

import { useTranslation } from "react-i18next";

export interface BlocksI18n {
  /** Surowy t (dla rzadkich kluczy spoza namespace). */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** blocks.fields.* */
  field: (key: string, opts?: Record<string, unknown>) => string;
  /** blocks.ui.* */
  ui: (key: string, opts?: Record<string, unknown>) => string;
  /** blocks.editors.<group>.<key> */
  editor: (group: string, key: string, opts?: Record<string, unknown>) => string;
  /** blocks.viewers.* (publiczne renderery) */
  viewer: (key: string, opts?: Record<string, unknown>) => string;
}

export function useBlocksI18n(): BlocksI18n {
  const { t } = useTranslation();
  return {
    t: (k, o) => t(k, o) as string,
    field: (k, o) => t(`blocks.fields.${k}`, o) as string,
    ui: (k, o) => t(`blocks.ui.${k}`, o) as string,
    editor: (g, k, o) => t(`blocks.editors.${g}.${k}`, o) as string,
    viewer: (k, o) => t(`blocks.viewers.${k}`, o) as string,
  };
}
