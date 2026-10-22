// Render prośby o zgodę na pomiar otwarć i kliknięć (I9d-Y2): treść z panelu
// albo domyślna -> temat, HTML i tekst dla kolejki poczty.
//
// JEDNO miejsce renderu dla wysyłki (`measurementReconfirmMail.server.ts`)
// i podglądu w panelu (`previewNewsletterMeasurementEmail`) - admin widzi
// dokładnie ten mail, który wyjdzie. React Email ładowany DYNAMICZNIE.
import * as React from "react";

import {
  resolveNewsletterMeasurementCopy,
  type NewsletterMeasurementCopyOverrides,
  type NewsletterMeasurementLang,
} from "./measurementReconfirm";

export interface MeasurementReconfirmRenderInput {
  lang: NewsletterMeasurementLang;
  overrides: NewsletterMeasurementCopyOverrides;
  firstName: string | null;
  confirmUrl: string;
  unsubscribeUrl: string | null;
  /** Origin serwisu najemcy (logo i stopka prowadzą na jego stronę). */
  siteUrl: string;
}

export interface MeasurementReconfirmRendered {
  subject: string;
  html: string;
  text: string;
}

export async function renderMeasurementReconfirmEmail(
  input: MeasurementReconfirmRenderInput,
): Promise<MeasurementReconfirmRendered> {
  const firstName = input.firstName?.trim() || null;
  const copy = resolveNewsletterMeasurementCopy(input.overrides, input.lang, {
    firstName: firstName ?? "",
  });
  const [{ render }, { MeasurementReconfirmEmail }] = await Promise.all([
    import("@react-email/render"),
    import("./measurementReconfirmEmail"),
  ]);
  const element = React.createElement(MeasurementReconfirmEmail, {
    lang: input.lang,
    siteUrl: input.siteUrl,
    copy,
    firstName,
    confirmUrl: input.confirmUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: copy.subject, html, text };
}
