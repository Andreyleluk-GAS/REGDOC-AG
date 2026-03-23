import React, { useMemo, useState, useEffect } from 'react'; // Изменено: добавлен useEffect
import RegistrationFlow from './components/RegistrationFlow';
import RegdocLogo from './components/RegdocLogo';
import RegdocIcon from './components/RegdocIcon';
import LandingPage from './components/LandingPage';
import EmailAuthForm from './components/EmailAuthForm';
import { ShieldCheck, Loader2, FileText, Calendar, CheckCircle2 } from 'lucide-react'; // Изменено: новые иконки
import { useAuth } from './context/AuthContext.jsx';
import { authFetch } from './lib/api.js'; // НОВОЕ

function App() {
  const { user, booting, banner, clearBanner, logout } = useAuth();
  const [screen, setScreen] = useState('landing'); // 'landing' | 'register' | 'cabinet'
  
  // НОВОЕ: Состояние для списка заявок
  const [requests, setRequests] = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(false);

  const cta = useMemo(
    () => ({
      onRegister: () => setScreen('register'),
      onCabinet: () => setScreen('cabinet'),
      onHome: () => setScreen('landing'),
    }),
    [],
  );

  // НОВОЕ: Загрузка заявок при переходе в кабинет
  useEffect(() => {
    if (screen === 'cabinet' && user) {
      setLoadingReqs(true);
      authFetch('/api/my-requests')
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setRequests(data); })
        .catch(err => console.error(err))
        .finally(() => setLoadingReqs(false));
    }
  }, [screen, user]);

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
        ) : screen === 'cabinet' ? (
          <main className="space-y-4">
            <div className="bg-white rounded-3xl shadow-xl border border-regdoc-grey p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-regdoc-navy">Мои заявки</h2>
                <button 
                  onClick={cta.onRegister}
                  className="px-4 py-2 bg-regdoc-cyan text-white text-xs font-bold rounded-xl hover:bg-regdoc-teal transition-all shadow-md"
                >
                  + Новая заявка
                </button>
              </div>

              {loadingReqs ? (
                <div className="flex flex-col items-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 text-regdoc-cyan animate-spin" />
                  <p className="text-xs font-bold text-regdoc-navy/40 uppercase tracking-widest">Загрузка списка...</p>
                </div>
              ) : requests.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-regdoc-grey rounded-2xl">
                  <FileText className="w-12 h-12 text-regdoc-grey mx-auto mb-3" />
                  <p className="text-regdoc-navy/50 text-sm font-medium">У вас пока нет активных заявок</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((req, idx) => (
                    <div key={idx} className="p-4 rounded-2xl border border-regdoc-grey bg-regdoc-grey/20 hover:border-regdoc-cyan/50 transition-all group">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="text-lg font-black text-regdoc-navy tracking-tight">{req.car_number}</div>
                          <div className="text-[10px] font-bold text-regdoc-navy/40 uppercase">{req.full_name?.replace(/_/g, ' ')}</div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-regdoc-navy/30 bg-white px-2 py-1 rounded-lg border border-regdoc-grey">
                          <Calendar size={12} /> {req.DATE}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border ${req.type_PZ === 'yes' ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal' : 'bg-white border-regdoc-grey text-regdoc-navy/20'}`}>
                          {req.type_PZ === 'yes' && <CheckCircle2 size={12} />} ПЗ: {req.type_PZ === 'yes' ? 'Готово' : 'Нет'}
                        </div>
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border ${req.type_PB === 'yes' ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal' : 'bg-white border-regdoc-grey text-regdoc-navy/20'}`}>
                          {req.type_PB === 'yes' && <CheckCircle2 size={12} />} ПБ: {req.type_PB === 'yes' ? 'Готово' : 'Нет'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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