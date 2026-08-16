const disabledLocalSecret = "local-development-disabled";

export function getPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Operatus identity is not configured.");
  }

  return { url, publishableKey };
}

export function getServerEnv() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const tokenPepper = process.env.OPERATUS_NODE_TOKEN_PEPPER;

  if (!secretKey || !tokenPepper || secretKey === disabledLocalSecret || tokenPepper === disabledLocalSecret) {
    throw new Error("Operatus node control is disabled in this environment.");
  }

  return { ...getPublicEnv(), secretKey, tokenPepper };
}
