import { useEffect, useState } from "react";

import { subscribeToAuthRequired } from "../client/api";
import { bootstrapAuthTokenFromQuery, clearAuthCookie, readAuthCookie, writeAuthCookie } from "../lib/auth";
import type { UseAuthOptions, UseAuthResult } from "../types";

export function useAuth(options: UseAuthOptions): UseAuthResult {
  const { clearErrors } = options;
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const [authBlocked, setAuthBlocked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    bootstrapAuthTokenFromQuery();
    setAuthBootstrapped(true);
  }, []);

  useEffect(() => subscribeToAuthRequired(() => {
    const hadCookie = Boolean(readAuthCookie());
    clearAuthCookie();
    setAuthBlocked(true);
    setAuthError(hadCookie ? "Incorrect access token." : null);
    clearErrors();
  }), [clearErrors]);

  function submitAuthToken(token: string) {
    writeAuthCookie(token);
    setAuthError(null);
    clearErrors();
    setAuthBlocked(false);
  }

  return {
    authBlocked,
    authBootstrapped,
    authError,
    submitAuthToken,
  };
}
