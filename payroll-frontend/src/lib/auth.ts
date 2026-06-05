export type Role = 'admin' | 'owner' | 'closer' | 'hunter' | 'marketolog' | 'assistant' | '';

export function getToken() { return localStorage.getItem('payroll_token') || ''; }
export function getRole(): Role { return (localStorage.getItem('payroll_role') as Role) || ''; }
export function isAdmin() { const r = getRole(); return r === 'admin' || r === 'owner'; }

export function saveAuth(token: string, role: string) {
  localStorage.setItem('payroll_token', token);
  localStorage.setItem('payroll_role', role);
}
export function clearAuth() {
  localStorage.removeItem('payroll_token');
  localStorage.removeItem('payroll_role');
}
export function isLoggedIn() { return !!getToken(); }
