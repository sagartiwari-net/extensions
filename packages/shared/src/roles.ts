export const ADMIN_ROLES = ['master', 'reseller'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isMaster(role: string): role is 'master' {
  return role === 'master';
}