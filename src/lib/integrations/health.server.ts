import { tokenStorageReady } from "@/lib/crypto/tokens.server";
import { makeWebhookConfigured } from "@/lib/integrations/make.server";
import { SOCIAL_PROVIDERS } from "@/lib/oauth/providers";

export type IntegrationHealth = {
  id: string;
  label: string;
  owner: string;
  connectionStatus: "awaiting_setup" | "configured";
  oauthActivated: false;
  credentialsPresent: boolean;
  missing: string[];
  callbackPath: string | null;
  scopes: string[];
};

function envSet(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim());
}

export function integrationHealth(): IntegrationHealth[] {
  const social = SOCIAL_PROVIDERS.map((provider) => {
    const missing = [provider.clientIdEnv, provider.clientSecretEnv, "TOKEN_ENCRYPTION_KEY"].filter(
      (name) => (name === "TOKEN_ENCRYPTION_KEY" ? !tokenStorageReady() : !envSet(name)),
    );
    return {
      id: provider.id,
      label: provider.label,
      owner: provider.owner,
      connectionStatus: "awaiting_setup" as const,
      oauthActivated: false as const,
      credentialsPresent: missing.length === 0,
      missing,
      callbackPath: provider.callbackPath,
      scopes: [...provider.scopes],
    };
  });

  return [
    ...social,
    {
      id: "make",
      label: "Make",
      owner: "אוטומציה",
      connectionStatus: makeWebhookConfigured() ? "configured" : "awaiting_setup",
      oauthActivated: false,
      credentialsPresent: makeWebhookConfigured(),
      missing: makeWebhookConfigured() ? [] : ["MAKE_WEBHOOK_URL"],
      callbackPath: null,
      scopes: [],
    },
  ];
}
