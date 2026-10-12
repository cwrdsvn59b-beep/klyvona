/** The only social network a customer can start or finish from the public routes. */
export function customerOAuthProvider(provider: string): "instagram" | "disabled" {
  return provider === "instagram" ? "instagram" : "disabled";
}

export const CUSTOMER_CONNECT_PLATFORMS = ["instagram"] as const;
