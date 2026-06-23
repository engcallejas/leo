import type { IntegrationType } from "../types";
import { clickupProvider } from "./clickup";
import type { IntegrationProvider } from "./provider";
import { sentryProvider } from "./sentry";

const REGISTRY: Record<IntegrationType, IntegrationProvider> = {
  sentry: sentryProvider,
  clickup: clickupProvider,
};

export function getProvider(type: IntegrationType): IntegrationProvider {
  const p = REGISTRY[type];
  if (!p) throw new Error(`Unknown integration type: ${type}`);
  return p;
}

export const INTEGRATION_TYPES: IntegrationType[] = ["sentry", "clickup"];

export { type IntegrationProvider } from "./provider";
