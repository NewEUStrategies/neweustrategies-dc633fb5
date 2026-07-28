import type { ComponentType } from "react";

import {
  freeRsvpEnTemplate,
  freeRsvpPlTemplate,
  newsletterConfirmedTemplate,
  subscriptionCanceledTemplate,
  subscriptionConfirmedTemplate,
  subscriptionDowngradedTemplate,
  subscriptionRenewedTemplate,
  subscriptionUpgradedTemplate,
} from "./app-transactional-templates";

export interface TemplateEntry {
  component: ComponentType<Record<string, unknown>>;
  subject: string | ((data: Record<string, unknown>) => string);
  displayName?: string;
  previewData?: Record<string, unknown>;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  "free-rsvp-pl": freeRsvpPlTemplate,
  "free-rsvp-en": freeRsvpEnTemplate,
  "subscription-confirmed": subscriptionConfirmedTemplate,
  "subscription-renewed": subscriptionRenewedTemplate,
  "subscription-canceled": subscriptionCanceledTemplate,
  "subscription-upgraded": subscriptionUpgradedTemplate,
  "subscription-downgraded": subscriptionDowngradedTemplate,
  "newsletter-confirmed": newsletterConfirmedTemplate,
};
