import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('payroll_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('payroll_token');
      localStorage.removeItem('payroll_role');
      window.location.href = '/payroll-app/login';
    }
    return Promise.reject(err);
  }
);
