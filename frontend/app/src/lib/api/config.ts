import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';

export type AppConfig = {
  bitrix_portal: string;
  currency: { primary: string; secondary: string };
};

export function getConfig() {
  return apiGet<AppConfig>('/api/config');
}

/**
 * Bitrix portal origin, trailing slash stripped, e.g.
 * "https://thompsonschool.bitrix24.kz".
 *
 * Always build CRM deep links from this. Several pages were copied from the
 * Mountain dashboard with the portal baked in, so their links opened
 * mountain.bitrix24.kz and 404'd for Thompson users.
 */
export function useBitrixPortal(): string {
  const q = useQuery({ queryKey: ['config'], queryFn: getConfig, staleTime: Infinity });
  return (q.data?.bitrix_portal ?? '').replace(/\/+$/, '');
}
