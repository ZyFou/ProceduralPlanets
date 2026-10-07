import { translate } from '../i18n/locale.js';
// Same-origin by default: Vite proxies /api to the local API in development,
// and production builds receive VITE_API_URL (the API host) at build time.
const browserDefault = '/api/v1';

export const API_BASE_URL = String(import.meta.env.VITE_API_URL ?? browserDefault).trim().replace(/\/+$/, '') || browserDefault;

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function avatarUrl(user) {
  if (!user?.id || !user.avatarUpdatedAt) return null;
  return `${getApiBaseUrl()}/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
}

/** Card image of a cloud project (summaries carry `thumbnailUpdatedAt`). */
export function projectThumbnailUrl(project) {
  if (!project?.id || !project.thumbnailUpdatedAt) return null;
  return `${getApiBaseUrl()}/projects/${encodeURIComponent(project.id)}/thumbnail?v=${encodeURIComponent(project.thumbnailUpdatedAt)}`;
}

export class AuthApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0, fields = {} } = {}) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      signal,
      credentials: 'include',
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AuthApiError(translate('The account server is unavailable. Try again later.'), {
      code: 'API_UNAVAILABLE',
    });
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AuthApiError(payload?.error?.message ?? translate('The request could not be completed.'), {
      code: payload?.error?.code,
      status: response.status,
      fields: payload?.error?.fields,
    });
  }
  return payload;
}

export const authApi = {
  session: (options) => apiRequest('/auth/session', options),
  register: (input) => apiRequest('/auth/register', { method: 'POST', body: input }),
  login: (input) => apiRequest('/auth/login', { method: 'POST', body: input }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  updateProfile: (input) => apiRequest('/me', { method: 'PATCH', body: input }),
  updateAvatar: (dataUrl) => apiRequest('/me/avatar', { method: 'PUT', body: { dataUrl } }),
  removeAvatar: () => apiRequest('/me/avatar', { method: 'DELETE' }),
  changePassword: (input) => apiRequest('/me/password', { method: 'PUT', body: input }),
};
