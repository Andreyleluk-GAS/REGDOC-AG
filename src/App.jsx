import React, { useMemo, useState, useEffect, useCallback } from 'react';
import RegistrationFlow from './components/RegistrationFlow';
import RegdocLogo from './components/RegdocLogo';
import RegdocIcon from './components/RegdocIcon';
import LandingPage from './components/LandingPage';
import EmailAuthForm from './components/EmailAuthForm';
import { ShieldCheck, Loader2, FileText, CheckCircle2, AlertTriangle, Edit2, Check, Trash2, X, RefreshCw } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { authFetch } from './lib/api.js';
import { useRequests } from './lib/useRequests.js';

import { formatPlate, formatFIO } from './lib/formatters.js';

// ──────────────────────────────────────────────
// Toast Notification
// ──────────────────────────────────────────────
function Toast({ message, type = 'error', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl font-semibold text-sm animate-slide-up
      ${type === 'error' ? 'bg-red-500 text-white' : 'bg-regdoc-teal text-white'}`}>
      {type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X size={14} /></button>
    </div>
  );
}

function App() {
  const { user, booting, banner, clearBanner, logout } = useAuth();
  const [screen, setScreen] = useState('landing'); // 'landing' | 'register' | 'cabinet'
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [editingRequest, setEditingRequest] = useState(null);
  const [activeAlert, setActiveAlert] = useState(null);
  const [toast, setToast] = useState(null); // { message, type }

  // Admin states
  const [allEmails, setAllEmails] = useState([]);
  const [editingEmailReqId, setEditingEmailReqId] = useState(null);
  const [selectedNewEmail, setSelectedNewEmail] = useState('');
  const [editingFioReqId, setEditingFioReqId] = useState(null);
  const [selectedNewFio, setSelectedNewFio] = useState('');
  const [deletingReq, setDeletingReq] = useState(null);

  // ─── useRequests hook ───
  const {
    requests,
    loading: loadingReqs,
    load: loadRequests,
    reload: reloadRequests,
    optimisticDelete,
    optimisticEditFio,
    optimisticEditEmail,
  } = useRequests();

  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
  }, []);

  const cta = useMemo(
    () => ({
      onRegister: () => { setEditingRequest(null); setAuthMode('register'); setScreen('register'); },
      onLogin: () => { setAuthMode('login'); setScreen('cabinet'); },
      onEditRequest: (req, docType, step = 4) => {
        setEditingRequest({...req, targetDocType: docType, forcedStep: step});
        setScreen('register');
      },
      onCabinet: () => setScreen('cabinet'),
      onHome: () => { setEditingRequest(null); setScreen('landing'); },
    }),
    [],
  );

  const StatusBadge = ({ label, isGreen, isAmber, onClick, tooltip }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border transition-all flex-1 sm:flex-none 
        ${isGreen ? 'bg-regdoc-mist border-regdoc-cyan/30 text-regdoc-teal hover:border-regdoc-cyan' : 
          isAmber ? 'bg-[#FFF7ED] border-[#FED7AA] text-[#FF7F50] hover:border-[#FF7F50]' :
          'border-gray-200 text-red-500 bg-red-50 hover:border-red-300'}`}
    >
      <CheckCircle2 size={12} className={`shrink-0 ${isGreen ? 'text-regdoc-cyan' : isAmber ? 'text-[#FF7F50]' : 'text-red-400'}`} />
      <span className="whitespace-nowrap truncate">{label}</span>
    </button>
  );

  // ─── Загрузка при входе пользователя ───
  useEffect(() => {
    if (!user) return;

    // Загружаем заявки (один раз — хук кэширует)
    loadRequests().then(() => {
      // После загрузки — определяем screen
      // Note: requests обновится через setState, поэтому читаем из loadRequest возврата
    });

    if (user.email === 'admin') {
      authFetch('/api/users/emails')
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setAllEmails(data); })
        .catch(e => console.error(e));
    }
  }, [user, loadRequests]);

  // ─── Автоматическая навигация после логина и загрузки ───
  useEffect(() => {
    if (!user || loadingReqs) return;
    
    // Перенаправляем только если экран ещё не был определён (например, после логина)
    if (screen === 'landing') {
        if (requests.length > 0) {
            setScreen('cabinet');
        } else {
            setScreen('register');
        }
    } 
    // Если пользователь в кабинете и записей ноль (после загрузки или удаления)
    else if (screen === 'cabinet' && requests.length === 0 && !loadingReqs) {
        setScreen('register');
    }
  }, [user, requests.length, loadingReqs, screen]); 

  const handleFlowComplete = useCallback(() => {
    setEditingRequest(null);
    // Принудительная перезагрузка (новая заявка создана)
    reloadRequests().then(() => {
      setScreen('cabinet');
    });
  }, [reloadRequests]);

  // ─── Optimistic delete ───
  const confirmDeleteRequest = useCallback(async () => {
    if (!deletingReq) return;
    const req = deletingReq;
    setDeletingReq(null); // закрываем модал сразу
    await optimisticDelete(req, (msg) => showToast(msg));
  }, [deletingReq, optimisticDelete, showToast]);

  // ─── Optimistic FIO edit ───
  const handleApplyFioChange = useCallback(async (req) => {
    if (!selectedNewFio || selectedNewFio.trim() === req.full_name?.replace(/_/g, ' ')) {
      setEditingFioReqId(null);
      return;
    }
    const fio = selectedNewFio.trim();
    setEditingFioReqId(null); // закрываем инпут сразу
    await optimisticEditFio(req, fio, (msg) => showToast(msg));
  }, [selectedNewFio, optimisticEditFio, showToast]);

  // ─── Optimistic Email edit ───
  const handleApplyEmailChange = useCallback(async (req) => {
    if (!selectedNewEmail || selectedNewEmail === req.email) {
      setEditingEmailReqId(null);
      return;
    }
    const email = selectedNewEmail;
    setEditingEmailReqId(null); // закрываем сразу
    await optimisticEditEmail(req, email, (msg) => showToast(msg));
  }, [selectedNewEmail, optimisticEditEmail, showToast]);

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
        <header className="mb-2 sm:mb-4">
          <div className="flex flex-row items-center justify-between gap-2">
            <RegdocLogo size="compact" />
            <div className="flex items-center justify-end gap-2 shrink-0">
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
                    else showToast('У вас еще нет заявок', 'error');
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
          <main><LandingPage onRegister={cta.onRegister} onLogin={cta.onLogin} /></main>
        ) : showLogin ? (
          <main className="space-y-4"><EmailAuthForm initialMode={authMode} /></main>
        ) : screen === 'cabinet' ? (
          <main className="space-y-4">
            <div className="bg-white rounded-3xl shadow-xl border border-regdoc-grey p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-regdoc-navy">
                    {user?.email === 'admin' ? 'Все заявки' : 'Мои заявки'}
                </h2>
                <div className="flex items-center gap-2">
                  {/* Кнопка обновления без блокировки UI */}
                  <button
                    onClick={reloadRequests}
                    disabled={loadingReqs}
                    title="Обновить список"
                    className="p-2 rounded-xl border border-regdoc-grey/60 text-regdoc-navy/50 hover:text-regdoc-cyan hover:border-regdoc-cyan transition-all disabled:opacity-40"
                  >
                    <RefreshCw size={15} className={loadingReqs ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={cta.onRegister} className="px-4 py-2 bg-regdoc-cyan text-white text-xs font-bold rounded-xl hover:bg-regdoc-teal transition-all shadow-md">+ Новая заявка</button>
                </div>
              </div>

              {/* Скелетон вместо полного блокирующего спиннера */}
              {loadingReqs && requests.length === 0 ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => (
                    <div key={i} className="p-4 rounded-2xl border border-regdoc-grey bg-regdoc-grey/20 animate-pulse">
                      <div className="flex justify-between items-center gap-4">
                        <div className="space-y-2">
                          <div className="h-5 w-32 bg-regdoc-grey rounded-lg" />
                          <div className="h-3 w-24 bg-regdoc-grey/60 rounded-lg" />
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          <div className="flex gap-2">
                            <div className="h-8 w-28 bg-regdoc-grey rounded-xl" />
                            <div className="h-8 w-14 bg-regdoc-grey rounded-xl" />
                          </div>
                          <div className="flex gap-2">
                            <div className="h-8 w-28 bg-regdoc-grey rounded-xl" />
                            <div className="h-8 w-14 bg-regdoc-grey rounded-xl" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : requests.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-regdoc-grey rounded-2xl">
                  <FileText className="w-12 h-12 text-regdoc-grey mx-auto mb-3" /><p className="text-regdoc-navy/50 text-sm font-medium">У вас пока нет активных заявок</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((req, idx) => {
                    const isPZ_Ready = req.type_PZ_ready === 'yes';
                    const isPB_Ready = req.type_PB_ready === 'yes';

                    let reqActionNeeded = false;
                    let actionDocType = 'pz';
                    if (req.file_comments) {
                        const isAdmin = user?.email === 'admin';
                        for (const docType of ['pz', 'pb']) {
                            const docComments = req.file_comments[docType];
                            if (!docComments) continue;
                            const hasAction = Object.values(docComments).some(cData => 
                                isAdmin ? cData.expertUnread : (cData.status === 'needs_fix' && !cData.userReply)
                            );
                            if (hasAction) {
                                reqActionNeeded = true;
                                actionDocType = docType;
                                break;
                            }
                        }
                    }

                    return (
                      <div key={req.ID} className={`p-4 rounded-2xl border transition-all hover:shadow-sm ${reqActionNeeded ? (user?.email === 'admin' ? 'border-regdoc-cyan/30 bg-regdoc-mist' : 'border-red-200 bg-red-50') : 'border-regdoc-grey bg-regdoc-grey/20 hover:border-regdoc-cyan/30'}`}>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <div className="shrink-0 w-full sm:w-auto">
                            <div className="flex items-start justify-between sm:justify-start gap-4">
                                <div className="flex flex-col">
                                    <div className="text-[10px] font-bold text-regdoc-navy/30 mb-0.5">ID: {req.ID}</div>
                                    <div className="text-xl font-black text-regdoc-navy tracking-tight flex items-center gap-2">
                                        {formatPlate(req.car_number)}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {reqActionNeeded && (
                                        <button onClick={() => cta.onEditRequest(req, actionDocType, 4)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all text-[10px] font-bold uppercase tracking-wider shadow-sm border ${user?.email === 'admin' ? 'bg-white border-regdoc-cyan/40 text-regdoc-teal hover:bg-regdoc-cyan/10' : 'bg-white border-red-300 text-red-600 hover:bg-red-50'}`}>
                                            <AlertTriangle size={14} strokeWidth={2.5} /> {user?.email === 'admin' ? 'Новый ответ' : 'Устранить замечания'}
                                        </button>
                                    )}
                                    {user?.email === 'admin' && (
                                        <button onClick={() => setDeletingReq(req)} className="text-red-400 hover:text-red-500 transition-colors p-1" title="Удалить заявку">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-1">
                                        <div className="text-[10px] font-bold text-regdoc-navy/40 uppercase truncate max-w-[150px]">{req.full_name?.replace(/_/g, ' ')}</div>
                                        {user?.email === 'admin' && (
                                            <button
                                                onClick={() => {
                                                    setEditingFioReqId(req.ID);
                                                    setSelectedNewFio(req.full_name?.replace(/_/g, ' '));
                                                }}
                                                className="text-regdoc-cyan hover:text-regdoc-teal p-0.5"
                                                title="Изменить ФИО"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                        )}
                            </div>

                            {user?.email === 'admin' && (
                                <div className="text-[10px] font-bold text-regdoc-cyan uppercase mt-1 flex items-center gap-2 flex-wrap">
                                    <span>Заявитель:</span>
                                    {editingEmailReqId === req.ID ? (
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
                                                    setEditingEmailReqId(req.ID);
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
                                isGreen={req.isVerified_PZ === 'yes'}
                                isAmber={req.type_PZ === 'yes' && req.isVerified_PZ !== 'yes'}
                                onClick={() => cta.onEditRequest(req, 'pz', req.type_PZ === 'yes' ? 4 : 3)}
                                tooltip={req.isVerified_PZ !== 'yes' ? (req.type_PZ === 'yes' ? "Ожидает проверки" : "Не хватает документов") : "Проверено"}
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
                                isGreen={req.isVerified_PB === 'yes'}
                                isAmber={req.type_PB === 'yes' && req.isVerified_PB !== 'yes'}
                                onClick={() => cta.onEditRequest(req, 'pb', req.type_PB === 'yes' ? 4 : 3)}
                                tooltip={req.isVerified_PB !== 'yes' ? (req.type_PB === 'yes' ? "Ожидает проверки" : "Не хватает документов") : "Проверено"}
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

              {/* Диалог подтверждения удаления */}
              {deletingReq && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                  <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl border border-red-100">
                    <Trash2 className="w-16 h-16 mx-auto mb-4 sm:mb-6 text-red-500" />
                    <h3 className="text-lg sm:text-xl font-bold text-regdoc-navy mb-2 sm:mb-3">Удалить заявку?</h3>
                    <p className="text-xs sm:text-sm text-regdoc-navy/70 mb-6 sm:mb-8 px-2">
                      Вы уверены, что хотите удалить заявку <strong>{formatPlate(deletingReq.car_number)}</strong> ({deletingReq.full_name?.replace(/_/g, ' ')})?<br/><br/>Это действие сотрет все файлы с сервера без возможности восстановления.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeletingReq(null)} className="flex-1 py-2.5 sm:py-3 bg-regdoc-grey text-regdoc-navy font-bold rounded-xl hover:bg-gray-300 transition-all text-sm">Отмена</button>
                        <button onClick={confirmDeleteRequest} className="flex-1 py-2.5 sm:py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-all text-sm shadow-md">Удалить</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Диалог изменения ФИО */}
              {editingFioReqId && requests.find(r => r.ID === editingFioReqId) && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                  <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl border border-regdoc-grey">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-regdoc-mist rounded-2xl text-regdoc-cyan">
                            <Edit2 size={24} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-regdoc-navy leading-none">Изменить ФИО</h3>
                            <p className="text-[10px] font-bold text-regdoc-navy/30 uppercase mt-1">Для заявки {requests.find(r => r.ID === editingFioReqId)?.car_number}</p>
                        </div>
                    </div>
                    
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-regdoc-navy/45 uppercase ml-1 tracking-wider">ФИО ИЛИ НАЗВАНИЕ</label>
                            <input 
                                type="text"
                                value={selectedNewFio}
                                onChange={e => setSelectedNewFio(formatFIO(e.target.value))}
                                onKeyDown={e => { 
                                    if (e.key === 'Enter') handleApplyFioChange(requests.find(r => r.ID === editingFioReqId)); 
                                    if (e.key === 'Escape') setEditingFioReqId(null); 
                                }}
                                className="w-full p-4 bg-regdoc-grey/40 border border-regdoc-grey rounded-2xl outline-none focus:border-regdoc-cyan focus:bg-white transition-all text-regdoc-navy font-bold"
                                placeholder="Иванов Иван Иванович"
                                autoFocus
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button 
                                onClick={() => setEditingFioReqId(null)} 
                                className="flex-1 py-3 bg-regdoc-grey text-regdoc-navy font-bold rounded-xl hover:bg-gray-300 transition-all text-sm"
                            >
                                Отмена
                            </button>
                            <button 
                                onClick={() => handleApplyFioChange(requests.find(r => r.ID === editingFioReqId))} 
                                className="flex-1 py-3 bg-regdoc-cyan text-white font-bold rounded-xl hover:bg-regdoc-teal transition-all text-sm shadow-md"
                            >
                                Сохранить
                            </button>
                        </div>
                    </div>
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
            <RegistrationFlow editingRequest={editingRequest} user={user} onComplete={handleFlowComplete} />
          </main>
        )}
        <footer className="text-center text-[11px] text-regdoc-navy/45 pb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <RegdocIcon name="gears" className="w-4 h-4 text-regdoc-teal shrink-0" /><span>Технологичность · Прозрачность · Удобство</span>
        </footer>
      </div>

      {/* Toast-уведомление */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default App;