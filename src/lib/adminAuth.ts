import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export type AdminUser = {
  id: string;
  nome: string;
};

export type AdminAuthStatus = {
  configured: boolean;
  provided: boolean;
  authorized: boolean;
  localFallback: boolean;
};

function normalizeSecret(value: string | null | undefined) {
  let secret = String(value ?? "").trim();

  if (
    (secret.startsWith('"') && secret.endsWith('"')) ||
    (secret.startsWith("'") && secret.endsWith("'"))
  ) {
    secret = secret.slice(1, -1).trim();
  }

  const bearerMatch = secret.match(/^Bearer\s+(.+)$/i);
  return (bearerMatch?.[1] ?? secret).trim();
}

function readProvidedSecret(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const tokenHeader = request.headers.get("x-admin-secret");
  return normalizeSecret(tokenHeader || authorization);
}

export function getAdminAuthStatus(request: NextRequest): AdminAuthStatus {
  const configuredSecret = normalizeSecret(process.env.COLETA_ADMIN_SECRET);
  const providedSecret = readProvidedSecret(request);
  const localFallback = !configuredSecret && process.env.NODE_ENV !== "production";

  return {
    configured: Boolean(configuredSecret),
    provided: Boolean(providedSecret),
    authorized: Boolean(configuredSecret && providedSecret === configuredSecret),
    localFallback,
  };
}

/**
 * Autoriza um request admin. Ordem de preferência:
 * 1. Cookie de sessão (login pela interface) — caminho principal.
 * 2. Segredo via header (cron, CLI e scripts server-to-server).
 * 3. Fallback de desenvolvimento local sem segredo configurado.
 */
export function getAuthorizedAdmin(request: NextRequest): AdminUser | null {
  const sessionUser = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (sessionUser) {
    return sessionUser;
  }

  const auth = getAdminAuthStatus(request);

  if (auth.authorized) {
    return {
      id: request.headers.get("x-admin-user") || "admin",
      nome: request.headers.get("x-admin-user") || "Administrador",
    };
  }

  if (auth.localFallback) {
    return {
      id: request.headers.get("x-admin-user") || "dev-admin",
      nome: request.headers.get("x-admin-user") || "Administrador local",
    };
  }

  return null;
}

export function isAuthorizedAdmin(request: NextRequest) {
  return Boolean(getAuthorizedAdmin(request));
}
