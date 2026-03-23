import React, { useMemo, useState, useEffect } from 'react';
import RegistrationFlow from './components/RegistrationFlow';
import RegdocLogo from './components/RegdocLogo';
import RegdocIcon from './components/RegdocIcon';
import LandingPage from './components/LandingPage';
import EmailAuthForm from './components/EmailAuthForm';
import { ShieldCheck, Loader2, FileText, CheckCircle2, AlertTriangle } from 'lucide-react'; // Изменено: Calendar удален, AlertTriangle добавлен
import { useAuth } from './context/AuthContext.jsx';
import { authFetch } from './lib/api.js';

// Изменено: Функция форматирования номера
const formatPlate = (plate) => {
  if (!plate) return '';
  const clean = plate.replace(/[^А-ЯЁA-Z0-9]/gi, '').toUpperCase();
  const match = clean.match(/^([А-ЯЁA-Z])(\d{3})([А-ЯЁA-Z]{2})(\d{2,3})$/i);
  if (match) {
    return `${match[1]} ${match[2]} ${match[3]} / ${match[4]}`;
  }
  return plate;
};

function App() {
  const { user, booting, banner, clearBanner, logout } = useAuth();
  const [screen, setScreen] = useState('landing'); // 'landing' | 'register' | 'cabinet'
  
  const [requests, setRequests] = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null); // Изменено: Состояние для редактируемой заявки
  const [workAlert, setWorkAlert] = useState(false); // Изменено: Состояние для алерта "Документы в работе"

  const cta = useMemo(
    () => ({
      onRegister: () => { setEditingRequest(null); setScreen('register'); }, // Изменено
      onEditRequest: (req, docType) => { setEditingRequest({...req, targetDocType: docType}); setScreen('register'); }, // Изменено: Переход к дозагрузке
      onCabinet: () => setScreen('cabinet'),
      onHome: () => { setEditingRequest(null); setScreen('landing'); }, // Изменено
    }),
    [],
  );

  // Изменено: Локальный компонент для плашек статуса
  const StatusBadge = ({ label, isGreen, onClick, tooltip }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${isGreen ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal hover:border-regdoc-cyan' : 'border-gray-200 text-red-500 bg-red-50 hover:border-red-300'}`}
    >
      <CheckCircle2 size={12} className={isGreen ? 'text-regdoc-cyan' : 'text-red-400'} />
      {label}
    </button>
  );

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
                  {/* Изменено: Новый макет элемента списка заявок */}
                  {requests.map((req, idx) => {
                    const isPZ_Submitted = req.type_PZ === 'yes';
                    const isPB_Submitted = req.type_PB === 'yes';
                    const isPZ_Ready = false; // Forced Red для текущей задачи
                    const isPB_Ready = false; // Forced Red для текущей задачи

                    return (
                      <div key={idx} className="p-4 rounded-2xl border border-regdoc-grey bg-regdoc-grey/20">
                        <div className="flex justify-between items-center gap-4">
                          {/* Слева: Номер ТС и ФИО */}
                          <div className="shrink-0">
                            <div className="text-xl font-black text-regdoc-navy tracking-tight">{formatPlate(req.car_number)}</div>
                            <div className="text-[10px] font-bold text-regdoc-navy/40 uppercase">{req.full_name?.replace(/_/g, ' ')}</div>
                          </div>

                          {/* Справа: Плашки статуса */}
                          <div className="flex gap-2 flex-wrap justify-end">
                            <StatusBadge
                              label="Документы для ПЗ"
                              isGreen={isPZ_Submitted}
                              onClick={() => cta.onEditRequest(req, 'pz')}
                              tooltip={!isPZ_Submitted ? "Не хватает документов" : undefined}
                            />
                            <StatusBadge
                              label="ПЗ: готово"
                              isGreen={isPZ_Ready}
                              onClick={() => !isPZ_Ready ? setWorkAlert(true) : null}
                            />
                            <StatusBadge
                              label="Документы для ПБ"
                              isGreen={isPB_Submitted}
                              onClick={() => cta.onEditRequest(req, 'pb')}
                              tooltip={!isPB_Submitted ? "Не хватает документов" : undefined}
                            />
                            <StatusBadge
                              label="ПБ: готово"
                              isGreen={isPB_Ready}
                              onClick={() => !isPB_Ready ? setWorkAlert(true) : null}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Изменено: Алерт "Документы в работе" */}
              {workAlert && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                  <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl border border-regdoc-grey">
                    <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-6" />
                    <h3 className="text-xl font-bold text-regdoc-navy mb-3">Документы в работе</h3>
                    <p className="text-sm text-regdoc-navy/70 mb-8">Ваша заявка находится в стадии обработки. Как только документы будут готовы, они появятся здесь.</p>
                    <button
                      onClick={() => setWorkAlert(false)}
                      className="w-full py-3 bg-regdoc-navy text-white font-bold rounded-xl hover:bg-regdoc-teal transition-all"
                    >
                      Назад
                    </button>
                  </div>
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
            <RegistrationFlow editingRequest={editingRequest} /> {/* Изменено: Передача редактируемой заявки */}
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