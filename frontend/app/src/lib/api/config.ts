import { apiGet } from './client';

export type AppConfig = {
  bitrix_portal: string;
  currency: { primary: string; secondary: string };
};

export function getConfig() {
  return apiGet<AppConfig>('/api/config');
}
