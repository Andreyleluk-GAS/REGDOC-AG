import React, { useMemo, useState, useEffect } from 'react';
import RegistrationFlow from './components/RegistrationFlow';
import RegdocLogo from './components/RegdocLogo';
import RegdocIcon from './components/RegdocIcon';
import LandingPage from './components/LandingPage';
import EmailAuthForm from './components/EmailAuthForm';
// ИЗМЕНЕНО: Добавлены иконки Edit2 и Check
import { ShieldCheck, Loader2, FileText, CheckCircle2, AlertTriangle, Edit2, Check } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { authFetch } from './lib/api.js';

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
  const [editingRequest, setEditingRequest] = useState(null);
  
  const [activeAlert, setActiveAlert] = useState(null);

  // ИЗМЕНЕНО: Состояния для редактирования заявителя
  const [allEmails, setAllEmails] = useState([]);
  const [editingEmailReqId, setEditingEmailReqId] = useState(null);
  const [selectedNewEmail, setSelectedNewEmail] = useState('');

  const cta = useMemo(
    () => ({
      onRegister: () => { setEditingRequest(null); setScreen('register'); },
      onEditRequest: (req, docType, step = 4) => { 
        setEditingRequest({...req, targetDocType: docType, forcedStep: step}); 
        setScreen('register'); 
      },
      onCabinet: () => setScreen('cabinet'),
      onHome: () => { setEditingRequest(null); setScreen('landing'); },
    }),
    [],
  );

  const StatusBadge = ({ label, isGreen, onClick, tooltip }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border transition-all flex-1 sm:flex-none ${isGreen ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal hover:border-regdoc-cyan' : 'border-gray-200 text-red-500 bg-red-50 hover:border-red-300'}`}
    >
      <CheckCircle2 size={12} className={`shrink-0 ${isGreen ? 'text-regdoc-cyan' : 'text-red-400'}`} />
      <span className="whitespace-nowrap truncate">{label}</span>
    </button>
  );

  const handleFlowComplete = () => {
    setEditingRequest(null);
    setLoadingReqs(true);
    authFetch('/api/my-requests')
      .then(res => res.json())
      .then(data => { 
        if (Array.isArray(data)) {
          setRequests(data);
          if (data.length > 0) setScreen('cabinet');
          else setScreen('register');
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoadingReqs(false));
  };

  useEffect(() => {
    if (user) {
      setLoadingReqs(true);
      authFetch('/api/my-requests')
        .then(res => res.json())
        .then(data => { 
          if (Array.isArray(data)) {
            setRequests(data);
            if (screen === 'landing') {
               if (data.length > 0) setScreen('cabinet');
               else setScreen('register');
            } else if (screen === 'cabinet' && data.length === 0) {
               setScreen('register');
            }
          }
        })
        .catch(err => console.error(err))
        .finally(() => setLoadingReqs(false));
        
      // ИЗМЕНЕНО: Загрузка всех email для выпадающего списка админа
      if (user.email === 'admin') {
          authFetch('/api/users/emails')
              .then(res => res.json())
              .then(data => { if (Array.isArray(data)) setAllEmails(data); })
              .catch(err => console.error(err));
      }
    }
  }, [user, screen]);

  // ИЗМЕНЕНО: Функция сохранения нового заявителя
  const handleApplyEmailChange = async (req) => {
      if (!selectedNewEmail || selectedNewEmail === req.email) {
          setEditingEmailReqId(null);
          return;
      }
      setLoadingReqs(true);
      try {
          await authFetch('/api/requests/change-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  car_number: req.car_number,
                  date: req.DATE,
                  newEmail: selectedNewEmail
              })
          });
          const res = await authFetch('/api/my-requests');
          const data = await res.json();
          if (Array.isArray(data)) setRequests(data);
      } catch(e) {
          console.error(e);
      } finally {
          setEditingEmailReqId(null);
          setLoadingReqs(false);
      }
  };

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
              {screen === 'register' && (
                <button
                  type="button"
                  onClick={() => {
                    if (requests.length > 0) cta.onCabinet();
                    else alert("У вас еще нет заявок");
                  }}
                  className={`px-4 py-2 rounded-2xl border border-regdoc-grey/60 font-bold text-sm transition-all ${requests.length > 0 ? "bg-white/70 text-regdoc-navy hover:bg-white" : "bg-gray-100 text-gray-400 opacity-50 cursor-not-allowed"}`}
                >
                  К списку заявок
                </button>
              )}
            </div>
          </div>
        </header>
        )}

        {banner && (
          <div className={`rounded-2xl px-4 py-3 text-sm font-semibold border ${banner.type === 'ok' ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal' : 'bg-red-50 border-red-100 text-red-700'}`}>
            <div className="flex justify-between gap-3 items-start">
              <span>{banner.text}</span>
              <button type="button" onClick={clearBanner} className="text-regdoc-navy/45 hover:text-regdoc-navy shrink-0">✕</button>
            </div>
          </div>
        )}

        {screen === 'landing' ? (
          <main><LandingPage onRegister={cta.onRegister} onCabinet={cta.onCabinet} /></main>
        ) : showLogin ? (
          <main className="space-y-4"><EmailAuthForm initialMode={screen === 'register' ? 'register' : 'login'} /></main>
        ) : screen === 'cabinet' ? (
          <main className="space-y-4">
            <div className="bg-white rounded-3xl shadow-xl border border-regdoc-grey p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                {/* ИЗМЕНЕНО: Заголовок "Все заявки" для админа */}
                <h2 className="text-xl font-bold text-regdoc-navy">
                    {user?.email === 'admin' ? 'Все заявки' : 'Мои заявки'}
                </h2>
                <button onClick={cta.onRegister} className="px-4 py-2 bg-regdoc-cyan text-white text-xs font-bold rounded-xl hover:bg-regdoc-teal transition-all shadow-md">+ Новая заявка</button>
              </div>

              {loadingReqs ? (
                <div className="flex flex-col items-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 text-regdoc-cyan animate-spin" /><p className="text-xs font-bold text-regdoc-navy/40 uppercase tracking-widest">Загрузка списка...</p>
                </div>
              ) : requests.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-regdoc-grey rounded-2xl">
                  <FileText className="w-12 h-12 text-regdoc-grey mx-auto mb-3" /><p className="text-regdoc-navy/50 text-sm font-medium">У вас пока нет активных заявок</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((req, idx) => {
                    const isPZ_Ready = false; 
                    const isPB_Ready = false;

                    return (
                      <div key={idx} className="p-4 rounded-2xl border border-regdoc-grey bg-regdoc-grey/20">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <div className="shrink-0 w-full sm:w-auto">
                            <div className="text-xl font-black text-regdoc-navy tracking-tight">{formatPlate(req.car_number)}</div>
                            <div className="text-[10px] font-bold text-regdoc-navy/40 uppercase">{req.full_name?.replace(/_/g, ' ')}</div>
                            
                            {/* ИЗМЕНЕНО: Блок "Заявитель" с возможностью редактирования */}
                            {user?.email === 'admin' && (
                                <div className="text-[10px] font-bold text-regdoc-cyan uppercase mt-1 flex items-center gap-2 flex-wrap">
                                    <span>Заявитель:</span>
                                    {editingEmailReqId === req.car_number + req.DATE ? (
                                        <div className="flex items-center gap-1">
                                            <select 
                                                value={selectedNewEmail} 
                                                onChange={e => setSelectedNewEmail(e.target.value)}
                                                className="bg-white border border-regdoc-cyan rounded text-[10px] px-1 py-0.5 text-regdoc-navy outline-none"
                                            >
                                                <option value="">Выберите email</option>
                                                {allEmails.map(em => (
                                                    <option key={em} value={em}>{em}</option>
                                                ))}
                                            </select>
                                            {selectedNewEmail && selectedNewEmail !== req.email && (
                                                <button onClick={() => handleApplyEmailChange(req)} className="p-0.5 bg-regdoc-cyan text-white rounded hover:bg-regdoc-teal transition-all">
                                                    <Check size={12} strokeWidth={3} />
                                                </button>
                                            )}
                                            <button onClick={() => setEditingEmailReqId(null)} className="p-0.5 bg-regdoc-grey text-regdoc-navy rounded hover:bg-gray-300 transition-all">
                                                ✕
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1">
                                            <span className="text-regdoc-navy">{req.email}</span>
                                            <button 
                                                onClick={() => {
                                                    setEditingEmailReqId(req.car_number + req.DATE);
                                                    setSelectedNewEmail(req.email);
                                                }} 
                                                className="text-regdoc-cyan hover:text-regdoc-teal"
                                                title="Изменить заявителя"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                          </div>
                          <div className="flex flex-col gap-2 w-full sm:w-auto items-end">
                            <div className="flex gap-2 w-full sm:w-auto">
                              <StatusBadge 
                                label="Документы ПЗ" 
                                isGreen={req.type_PZ === 'yes'} 
                                onClick={() => cta.onEditRequest(req, 'pz', req.type_PZ === 'yes' ? 4 : 3)} 
                                tooltip={req.type_PZ !== 'yes' ? "Не хватает документов" : undefined} 
                              />
                              <StatusBadge 
                                label="ПЗ" 
                                isGreen={isPZ_Ready} 
                                onClick={() => setActiveAlert(isPZ_Ready ? 'dev' : 'work')} 
                              />
                            </div>
                            <div className="flex gap-2 w-full sm:w-auto">
                              <StatusBadge 
                                label="Документы ПБ" 
                                isGreen={req.type_PB === 'yes'} 
                                onClick={() => cta.onEditRequest(req, 'pb', req.type_PB === 'yes' ? 4 : 3)} 
                                tooltip={req.type_PB !== 'yes' ? "Не хватает документов" : undefined} 
                              />
                              <StatusBadge 
                                label="ПБ" 
                                isGreen={isPB_Ready} 
                                onClick={() => setActiveAlert(isPB_Ready ? 'dev' : 'work')} 
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeAlert && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                  <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl border border-regdoc-grey">
                    <AlertTriangle className={`w-16 h-16 mx-auto mb-6 ${activeAlert === 'work' ? 'text-amber-500' : 'text-regdoc-cyan'}`} />
                    <h3 className="text-xl font-bold text-regdoc-navy mb-3">
                      {activeAlert === 'work' ? 'Документы в работе' : 'Раздел в разработке'}
                    </h3>
                    <p className="text-sm text-regdoc-navy/70 mb-8">
                      {activeAlert === 'work' 
                        ? 'Ваша заявка находится в стадии обработки. Как только документы будут готовы, они появятся здесь.'
                        : 'Данный функционал скоро появится. Вы сможете просматривать и скачивать готовые файлы.'}
                    </p>
                    <button onClick={() => setActiveAlert(null)} className="w-full py-3 bg-regdoc-navy text-white font-bold rounded-xl hover:bg-regdoc-teal transition-all">Назад</button>
                  </div>
                </div>
              )}
            </div>
          </main>
        ) : (
          <main>
            <div className="flex justify-end">
              <div className="hidden md:block bg-regdoc-navy rounded-[20px] px-3 py-2 text-white/80 text-[11px] font-bold tracking-wider mb-3">
                <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" />Официально</div>
              </div>
            </div>
            <RegistrationFlow editingRequest={editingRequest} onComplete={handleFlowComplete} />
          </main>
        )}
        <footer className="text-center text-[11px] text-regdoc-navy/45 pb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <RegdocIcon name="gears" className="w-4 h-4 text-regdoc-teal shrink-0" /><span>Технологичность · Прозрачность · Удобство</span>
        </footer>
      </div>
    </div>
  );
}

export default App;