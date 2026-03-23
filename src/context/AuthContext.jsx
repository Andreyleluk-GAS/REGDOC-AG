import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getToken, setStoredToken, authFetch } from '../lib/api.js';
import { postJson } from '../lib/fetchApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(() => Boolean(getToken()));
  const [banner, setBanner] = useState(null);

  const applySession = useCallback((nextToken, nextUser) => {
    setStoredToken(nextToken);
    setToken(nextToken || null);
    setUser(nextUser || null);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setBooting(false);
      return;
    }
    let cancelled = false;
    setBooting(true);
    authFetch('/api/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('me');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('verify');
    if (!v) return;
    const dedupeKey = `regdoc_verify_${v}`;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, '1');

    const next = new URLSearchParams(window.location.search);
    next.delete('verify');
    const qs = next.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);

    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: v }),
    })
      .then(async (res) => ({ res, data: await res.json().catch(() => ({})) }))
      .then(({ res, data }) => {
        if (res.ok && data.token && data.user) {
          applySession(data.token, data.user);
          setBanner({ type: 'ok', text: data.message || 'Email подтверждён. Можно войти в кабинет.' });
        } else {
          setBanner({ type: 'err', text: data.error || 'Не удалось подтвердить email' });
        }
      })
      .catch(() => setBanner({ type: 'err', text: 'Ошибка сети при подтверждении' }));
  }, [applySession]);

  const login = useCallback(async (email, password) => {
    try {
      const data = await postJson('/api/auth/login', { email, password });
      applySession(data.token, data.user);
      return data;
    } catch (e) {
      if (e.payload?.needsVerification) {
        const err = new Error(e.message);
        err.needsVerification = true;
        throw err;
      }
      throw e;
    }
  }, [applySession]);

  const register = useCallback(async (email, password) => {
    const data = await postJson('/api/auth/register', { email, password });
    if (data.token && data.user) {
      applySession(data.token, data.user);
    }
    return data;
  }, [applySession]);

  const value = useMemo(
    () => ({
      user,
      token,
      booting,
      banner,
      clearBanner: () => setBanner(null),
      login,
      register,
      logout,
      applySession,
    }),
    [user, token, booting, banner, login, register, logout, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
