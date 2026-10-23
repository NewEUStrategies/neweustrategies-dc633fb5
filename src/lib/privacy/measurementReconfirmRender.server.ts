// Render prośby o zgodę na pomiar otwarć i kliknięć (I9d-Y2, I9d-Y2b): treść
// -> temat, HTML i tekst dla kolejki poczty. Prośba z panelu - treść z panelu
// albo domyślna; prośba po zapisie (`origin = 'signup'`) - treść STAŁA,
// nadpisania z panelu ignorowane (`resolveNewsletterMeasurementMailCopy`).
//
// JEDNO miejsce renderu dla wysyłki (`measurementReconfirmMail.server.ts`)
// i podglądu w panelu (`previewNewsletterMeasurementEmail`) - admin widzi
// dokładnie ten mail, który wyjdzie. React Email ładowany DYNAMICZNIE.
import * as React from "react";

import {
  resolveNewsletterMeasurementMailCopy,
  type NewsletterMeasurementCopyOverrides,
  type NewsletterMeasurementLang,
  type NewsletterMeasurementOrigin,
} from "./measurementReconfirm";

export interface MeasurementReconfirmRenderInput {
  lang: NewsletterMeasurementLang;
  /** Pochodzenie prośby; brak = `panel` (podgląd w panelu). */
  origin?: NewsletterMeasurementOrigin;
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
  const copy = resolveNewsletterMeasurementMailCopy(
    input.origin ?? "panel",
    input.overrides,
    input.lang,
    { firstName: firstName ?? "" },
  );
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
