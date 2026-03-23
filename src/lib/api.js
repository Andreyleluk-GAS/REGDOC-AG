const TOKEN_KEY = 'regdoc_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** @returns {Record<string, string>} */
export function authHeaders() {
  const t = getToken();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

export async function authFetch(url, options = {}) {
  const headers = { ...options.headers, ...authHeaders() };
  return fetch(url, { ...options, headers });
}
