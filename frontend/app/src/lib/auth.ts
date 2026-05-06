import { apiGet } from "./api/client";

const TOKEN_KEY = "auth.token";
const USERNAME_KEY = "auth.username";
const ROLE_KEY = "auth.role";

export type DashboardRole =
  | "admin"
  | "owner"
  | "closer"
  | "marketolog"
  | "hunter";
export type AuthStatus = { enabled: boolean; admin_username: string | null };
export type AuthMe = {
  username: string;
  auth_enabled: boolean;
  role: string;
  emp_id?: number | null;
};

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function getStoredUsername(): string | null {
  try {
    return localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}
export function getStoredRole(): DashboardRole {
  try {
    const r = localStorage.getItem(ROLE_KEY);
    if (r === "owner" || r === "closer" || r === "marketolog" || r === "hunter")
      return r;
    return "admin";
  } catch {
    return "admin";
  }
}
export function setStoredToken(
  token: string,
  username: string,
  role: DashboardRole = "admin",
) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}
export function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(ROLE_KEY);
  } catch {
    /* ignore */
  }
}

export function getAuthStatus() {
  return apiGet<AuthStatus>("/api/auth/status");
}

export async function login(
  password: string,
  username = "admin",
): Promise<{
  access_token: string;
  username: string;
  role: string;
  emp_id?: number | null;
}> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, username }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}
