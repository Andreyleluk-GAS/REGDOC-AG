import React, { useMemo, useState } from 'react';
import RegistrationFlow from './components/RegistrationFlow';
import RegdocLogo from './components/RegdocLogo';
import RegdocIcon from './components/RegdocIcon';
import LandingPage from './components/LandingPage';
import EmailAuthForm from './components/EmailAuthForm';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';

function App() {
  const { user, booting, banner, clearBanner, logout } = useAuth();
  const [screen, setScreen] = useState('landing'); // 'landing' | 'register' | 'cabinet'

  const cta = useMemo(
    () => ({
      onRegister: () => setScreen('register'),
      onCabinet: () => setScreen('cabinet'),
      onHome: () => setScreen('landing'),
    }),
    [],
  );

  const needAuth = screen === 'register' || screen === 'cabinet';
  const showLogin = needAuth && !user && !booting;

  if (booting && needAuth) {
    return (
      <div className="min-h-screen p-4 sm:p-8 font-sans text-regdoc-navy flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-regdoc-navy/70">
          <Loader2 className="w-10 h-10 text-regdoc-cyan animate-spin" />
          <p className="text-sm font-semibold">Загрузка сессии…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8 font-sans text-regdoc-navy">
      <div className="max-w-2xl mx-auto space-y-6">
        {screen !== 'landing' && (
        <header className="mb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <RegdocLogo />
            <div className="flex items-center gap-2">
              {user && (
                <span className="text-xs font-medium text-regdoc-navy/55 max-w-[200px] truncate hidden sm:inline">
                  {user.email}
                </span>
              )}
              {user && (
                <button
                  type="button"
                  onClick={logout}
                  className="px-4 py-2 rounded-2xl border border-regdoc-grey/60 bg-white/70 text-regdoc-navy font-bold text-sm hover:bg-white transition-all"
                >
                  Выйти
                </button>
              )}
              {screen !== 'landing' && (
                <button
                  type="button"
                  onClick={cta.onHome}
                  className="px-4 py-2 rounded-2xl border border-regdoc-grey/60 bg-white/70 text-regdoc-navy font-bold text-sm hover:bg-white transition-all"
                >
                  На главную
                </button>
              )}
            </div>
          </div>
        </header>
        )}

        {banner && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-semibold border ${
              banner.type === 'ok'
                ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal'
                : 'bg-red-50 border-red-100 text-red-700'
            }`}
          >
            <div className="flex justify-between gap-3 items-start">
              <span>{banner.text}</span>
              <button type="button" onClick={clearBanner} className="text-regdoc-navy/45 hover:text-regdoc-navy shrink-0">
                ✕
              </button>
            </div>
          </div>
        )}

        {screen === 'landing' ? (
          <main>
            <LandingPage onRegister={cta.onRegister} onCabinet={cta.onCabinet} />
          </main>
        ) : showLogin ? (
          <main className="space-y-4">
            <EmailAuthForm initialMode={screen === 'register' ? 'register' : 'login'} />
          </main>
        ) : (
          <main>
            <div className="flex justify-end">
              <div className="hidden md:block bg-regdoc-navy rounded-[20px] px-3 py-2 text-white/80 text-[11px] font-bold tracking-wider mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  Официально
                </div>
              </div>
            </div>
            <RegistrationFlow />
          </main>
        )}

        <footer className="text-center text-[11px] text-regdoc-navy/45 pb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <RegdocIcon name="gears" className="w-4 h-4 text-regdoc-teal shrink-0" />
          <span>Технологичность · Прозрачность · Удобство</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
