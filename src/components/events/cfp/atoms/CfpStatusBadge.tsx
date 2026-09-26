// Atom: plakietka stanu zgłoszenia w naborze prelegentów.
//
// WSPÓLNA DLA PANELU I STRONY PRELEGENTA. Etykiety stoją w nakładce uczestnika
// (`eventCfp.statuses.*`), więc plakietka nie wnosi do chunku publicznego ani
// jednego napisu panelu - panel może ją importować, odwrotnie nic nie płynie.
//
// TONACJA Z TOKENÓW, NIE Z KOLORÓW. Przyjęte i potwierdzone = wariant główny,
// odrzucone = destrukcyjny, stany w toku = drugorzędny, stany końcowe bez
// dalszych kroków (wycofane, rezygnacja, rezerwa, szkic) = obrys.
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  CFP_SUBMISSION_STATUS_LABEL_KEYS,
  type CfpSubmissionStatus,
} from "@/lib/events/cfpEnums";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

type Variant = "default" | "secondary" | "destructive" | "outline";

export const CFP_STATUS_VARIANT: Record<CfpSubmissionStatus, Variant> = {
  draft: "outline",
  submitted: "secondary",
  under_review: "secondary",
  changes_requested: "secondary",
  accepted: "default",
  waitlisted: "outline",
  rejected: "destructive",
  withdrawn: "outline",
  confirmed: "default",
  declined: "outline",
};

export function CfpStatusBadge({ status }: { status: CfpSubmissionStatus }) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  return (
    <Badge variant={CFP_STATUS_VARIANT[status]} data-status={status}>
      {t(CFP_SUBMISSION_STATUS_LABEL_KEYS[status])}
    </Badge>
  );
}
