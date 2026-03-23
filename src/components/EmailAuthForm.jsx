import React, { useState } from 'react';
import { Loader2, Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function EmailAuthForm({ initialMode }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState(initialMode === 'login' ? 'login' : 'register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'register' && password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        const data = await register(email, password);
        if (data.needsVerification) {
          setInfo(data.message || 'Проверьте почту и перейдите по ссылке.');
        }
      }
    } catch (err) {
      setError(err.message || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-regdoc-grey overflow-hidden p-6 sm:p-8 max-w-md mx-auto w-full">
      <div className="flex rounded-2xl bg-regdoc-grey/50 p-1 mb-6">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setError('');
            setInfo('');
          }}
          className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
            mode === 'login' ? 'bg-white text-regdoc-navy shadow-sm' : 'text-regdoc-navy/50'
          }`}
        >
          Вход
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setError('');
            setInfo('');
          }}
          className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
            mode === 'register' ? 'bg-white text-regdoc-navy shadow-sm' : 'text-regdoc-navy/50'
          }`}
        >
          Регистрация
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-regdoc-navy/45 uppercase ml-1 tracking-wider">Email</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-regdoc-navy/30" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full pl-12 pr-4 py-4 bg-regdoc-grey/35 border border-regdoc-grey rounded-2xl outline-none focus:border-regdoc-cyan focus:bg-white transition-all"
              placeholder="you@example.com"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-regdoc-navy/45 uppercase ml-1 tracking-wider">Пароль</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-regdoc-navy/30" />
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full pl-12 pr-4 py-4 bg-regdoc-grey/35 border border-regdoc-grey rounded-2xl outline-none focus:border-regdoc-cyan focus:bg-white transition-all"
              placeholder="Не менее 8 символов"
            />
          </div>
        </div>

        {mode === 'register' && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-regdoc-navy/45 uppercase ml-1 tracking-wider">
              Пароль ещё раз
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-regdoc-navy/30" />
              <input
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={8}
                className="w-full pl-12 pr-4 py-4 bg-regdoc-grey/35 border border-regdoc-grey rounded-2xl outline-none focus:border-regdoc-cyan focus:bg-white transition-all"
                placeholder="Повторите пароль"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">{error}</div>
        )}
        {info && (
          <div className="text-sm text-regdoc-teal bg-regdoc-mist border border-regdoc-cyan/25 rounded-2xl px-4 py-3">
            {info}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-regdoc-cyan text-regdoc-navy font-bold rounded-2xl shadow-lg hover:bg-regdoc-teal transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin w-5 h-5" /> : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </form>
    </div>
  );
}
