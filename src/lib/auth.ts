import { AUTH_COOKIE_NAME, AUTH_QUERY_PARAM } from "../shared/auth.js";

export function bootstrapAuthTokenFromQuery(): void {
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get(AUTH_QUERY_PARAM)?.trim() ?? "";
  if (!token) {
    return;
  }

  writeAuthCookie(token);
  searchParams.delete(AUTH_QUERY_PARAM);
  const nextSearch = searchParams.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

export function writeAuthCookie(token: string): void {
  document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=2592000; Path=/; SameSite=Lax`;
}

export function clearAuthCookie(): void {
  document.cookie = `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export function readAuthCookie(): string | null {
  for (const entry of document.cookie.split(";")) {
    const [name, ...valueParts] = entry.trim().split("=");
    if (name !== AUTH_COOKIE_NAME) {
      continue;
    }

    return decodeURIComponent(valueParts.join("="));
  }

  return null;
}
