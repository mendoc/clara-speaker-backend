/**
 * Le redactor par défaut de gaxios masque `client_secret` et `grant_type`, mais PAS
 * `refresh_token` : logger une GaxiosError brute écrit le token de l'utilisateur en
 * clair dans les logs Netlify. On n'expose donc que les champs sans secret.
 */
export function formatError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const { code, status } = error as Error & { code?: unknown; status?: unknown };

  return {
    name: error.name,
    message: error.message,
    ...(code !== undefined && { code }),
    ...(status !== undefined && { status }),
    stack: error.stack,
  };
}
