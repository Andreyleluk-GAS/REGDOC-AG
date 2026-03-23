import React, { useState, useEffect } from 'react';
import { Check, ChevronRight, User, Briefcase, FileSignature, FileCheck2, Camera, Paperclip, Loader2, FileText, CheckCircle2, RotateCw, History, PlusCircle, AlertCircle, Info, XCircle } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { authFetch, getToken } from '../lib/api.js';

const steps = [
  { id: 1, title: 'Заявитель' }, 
  { id: 2, title: 'Данные' }, 
  { id: 3, title: 'Услуга' }, 
  { id: 4, title: 'Документы' }, 
  { id: 5, title: 'Описание' },
];

export default function RegistrationFlow({ editingRequest }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const [modal, setModal] = useState({ show: false, title: '', message: '', type: 'info' });
  const [searchCache, setSearchCache] = useState(null);
  const [showDecision, setShowDecision] = useState(false);

  const [activeFolderName, setActiveFolderName] = useState('');
  const [isNewApplication, setIsNewApplication] = useState(true);
  const [showExitPrompt, setShowExitPrompt] = useState(false);

  const [hasExistingDescription, setHasExistingDescription] = useState(false);
  const [isDescriptionEditable, setIsDescriptionEditable] = useState(true);

  const [clientType, setClientType] = useState('individual');
  const [docType, setDocType] = useState('pz');
  const [formData, setFormData] = useState({ fullName: '', companyName: '', licensePlate: '', conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).' });
  
  const [files, setFiles] = useState({ passport: [], snils: [], sts: [], pts: [] });
  const [existingCloudFiles, setExistingCloudFiles] = useState({ passport: [], snils: [], sts: [], pts: [] });
  const [fileStatuses, setFileStatuses] = useState({});

  // ИЗМЕНЕНО: Добавлена функция фоновой проверки и синхронизации папок
  const triggerSync = () => {
      if (activeFolderName) {
          const data = new FormData();
          data.append('step', 'sync_request');
          data.append('folderName', activeFolderName);
          const authTok = getToken();
          if (authTok) {
              fetch('/api/upload', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${authTok}` },
                  body: data,
                  keepalive: true
              }).catch(() => {});
          }
      }
  };

  // ИЗМЕНЕНО: Синхронизация при закрытии окна или уходе со страницы
  useEffect(() => {
    const handleBeforeUnload = (e) => {
        triggerSync();
        if (currentStep > 2 && currentStep < 6 && !showSuccess && isNewApplication) {
            e.preventDefault();
            e.returnValue = 'Заявка не завершена. Данные могут быть утеряны.';
            return e.returnValue;
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        triggerSync(); // Срабатывает при выходе к списку заявок (размонтирование)
    };
  }, [currentStep, showSuccess, isNewApplication, activeFolderName]);

  const showAlert = (title, message, type = 'info') => {
    setModal({ show: true, title, message, type });
  };

  useEffect(() => {
    if (editingRequest) {
        setFormData(prev => ({
            ...prev,
            licensePlate: editingRequest.car_number || '',
            fullName: (editingRequest.full_name || '').replace(/_/g, ' ')
        }));
        setDocType(editingRequest.targetDocType || 'pz');
        setIsNewApplication(false);

        setIsSearching(true);
        authFetch(`/api/check-plate?plate=${encodeURIComponent(editingRequest.car_number)}`)
            .then(res => res.json())
            .then(data => {
                if (data.found) {
                    setActiveFolderName(data.folderName);
                    if (data.existingFiles) setExistingCloudFiles(data.existingFiles);
                    if (data.hasDescription) {
                        setHasExistingDescription(true);
                        setIsDescriptionEditable(false);
                    }
                    setCurrentStep(editingRequest.forcedStep || 3);
                } else {
                    showAlert("Ошибка", "Папка заявки не найдена на сервере.", "error");
                    setCurrentStep(1);
                }
            })
            .catch(e => {
                showAlert("Ошибка связи", "Не удалось загрузить данные заявки.", "error");
                setCurrentStep(1);
            })
            .finally(() => {
                setIsSearching(false);
            });
    } else {
        setCurrentStep(1);
        setIsNewApplication(true);
        setActiveFolderName('');
        setFormData({ fullName: '', companyName: '', licensePlate: '', conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).' });
        setFiles({ passport: [], snils: [], sts: [], pts: [] });
        setExistingCloudFiles({ passport: [], snils: [], sts: [], pts: [] });
    }
  }, [editingRequest]);

  const handleRealUpload = (file, category, index) => {
      const key = file.name + file.size;
      setFileStatuses(prev => ({ ...prev, [key]: { state: 'uploading', progress: 0 } }));

      const data = new FormData();
      data.append('step', 'single_file');
      data.append('folderName', activeFolderName);
      data.append('docType', docType);
      data.append(category, file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);
      const authTok = getToken();
      if (authTok) xhr.setRequestHeader('Authorization', `Bearer ${authTok}`);
      
      xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);
              setFileStatuses(prev => ({ ...prev, [key]: { state: 'uploading', progress } }));
          }
      };

      xhr.onload = () => {
          if (xhr.status === 200) {
              setFileStatuses(prev => ({ ...prev, [key]: { state: 'done', progress: 100 } }));
          } else {
              setFileStatuses(prev => ({ ...prev, [key]: { state: 'error', progress: 0 } }));
              showAlert("Ошибка", "Не удалось загрузить файл " + file.name, "error");
          }
      };

      xhr.onerror = () => {
          setFileStatuses(prev => ({ ...prev, [key]: { state: 'error', progress: 0 } }));
          showAlert("Ошибка", "Обрыв сети при загрузке", "error");
      };

      xhr.send(data);
  };

  const handleAbortAndClean = async () => {
      if (isNewApplication && activeFolderName) {
          setIsSubmitting(true);
          const data = new FormData();
          data.append('step', 'delete_folder');
          data.append('folderName', activeFolderName);
          try { await authFetch('/api/upload', { method: 'POST', body: data }); } catch(e) {}
      }
      window.location.reload(); 
  };

  const validateFullName = (name) => {
    const fioRegex = /^[А-ЯЁ][а-яё]+(\s+[А-ЯЁ][а-яё]+)+$/;
    return fioRegex.test(name.trim());
  };

  const checkExistingApplication = async () => {
    if (!formData.licensePlate.trim()) {
        showAlert("Внимание", "Пожалуйста, введите гос. номер для поиска", "info");
        return;
    }
    setIsSearching(true);
    try {
      const res = await authFetch(`/api/check-plate?plate=${encodeURIComponent(formData.licensePlate)}`);
      const data = await res.json();
      if (data.found) {
        setSearchCache(data);
        setShowDecision(true);
      } else {
        showAlert("Не найдено", "Заявка с таким номером не найдена. Вы можете заполнить её с нуля.", "info");
      }
    } catch (e) { 
        showAlert("Ошибка", "Не удалось связаться с сервером. Проверьте интернет.", "error"); 
    }
    finally { setIsSearching(false); }
  };

  const handleDecision = (choice) => {
    if (choice === 'continue') {
      setFormData(prev => ({ ...prev, fullName: searchCache.fullName }));
      if (searchCache.existingFiles) setExistingCloudFiles(searchCache.existingFiles);
      setActiveFolderName(searchCache.folderName);
      setIsNewApplication(false);
      
      if (searchCache.hasDescription) {
          setHasExistingDescription(true);
          setIsDescriptionEditable(false);
      }
    } else {
      setFormData(prev => ({ ...prev, fullName: '', companyName: '' }));
      setFiles({ passport: [], snils: [], sts: [], pts: [] });
      setExistingCloudFiles({ passport: [], snils: [], sts: [], pts: [] });
      setActiveFolderName('');
      setIsNewApplication(true);
      setHasExistingDescription(false);
      setIsDescriptionEditable(true);
    }
    setShowDecision(false);
    setCurrentStep(2);
  };

  const handlePlateInput = (e) => {
    let raw = e.target.value.toUpperCase();
    const enToRu = {'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','Y':'У','X':'Х'};
    let clean = '';
    for(let i=0; i<raw.length; i++) clean += enToRu[raw[i]] || raw[i];
    clean = clean.replace(/[^АВЕКМНОРСТУХ0-9]/g, '');
    let f = '';
    if (clean[0]) f += /[АВЕКМНОРСТУХ]/.test(clean[0]) ? clean[0] : '';
    if (clean.length > 1) f += ' ' + clean.slice(1, 4).replace(/[^0-9]/g, '');
    if (clean.length > 4) f += ' ' + clean.slice(4, 6).replace(/[^АВЕКМНОРСТУХ]/g, '');
    if (clean.length > 6) f += ' / ' + clean.slice(6, 9).replace(/[^0-9]/g, '');
    setFormData({ ...formData, licensePlate: f });
  };

  const handleFullNameChange = (val) => {
    const enToRu = {
        'q':'й', 'w':'ц', 'e':'у', 'r':'к', 't':'е', 'y':'н', 'u':'г', 'i':'ш', 'o':'щ', 'p':'з', '[':'х', ']':'ъ',
        'a':'ф', 's':'ы', 'd':'в', 'f':'а', 'g':'п', 'h':'р', 'j':'о', 'k':'л', 'l':'д', ';':'ж', "'":'э',
        'z':'я', 'x':'ч', 'c':'с', 'v':'м', 'b':'и', 'n':'т', 'm':'ь', ',':'б', '.':'ю', '`':'ё',
        'Q':'Й', 'W':'Ц', 'E':'У', 'R':'К', 'T':'Е', 'Y':'Н', 'U':'Г', 'I':'Ш', 'O':'Щ', 'P':'З', '{':'Х', '}':'Ъ',
        'A':'Ф', 'S':'Ы', 'D':'В', 'F':'А', 'G':'П', 'H':'Р', 'J':'О', 'K':'Л', 'L':'Д', ':':'Ж', '"':'Э',
        'Z':'Я', 'X':'Ч', 'C':'С', 'V':'М', 'B':'И', 'N':'Т', 'M':'Ь', '<':'Б', '>':'Ю', '~':'Ё'
    };
    let translated = '';
    for(let i=0; i<val.length; i++) {
        translated += enToRu[val[i]] || val[i];
    }
    let clean = translated.replace(/[^А-Яа-яЁё\s]/g, '');
    let formatted = clean.split(' ').map(word => {
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
    
    setFormData({ ...formData, fullName: formatted });
  };

  const handleFileChange = async (e, category) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setIsCompressing(true);
    try {
      const processed = await Promise.all(selected.map(async (file) => {
        if (file.type === 'application/pdf') {
            if (file.size/1024/1024 > 8) {
                showAlert("Файл слишком большой", `PDF ${file.name} превышает 8 МБ.`, "error");
                return null;
            }
            return file;
        }
        if (file.type.startsWith('image/')) {
            const blob = await imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1920, useWebWorker: true });
            return new File([blob], file.name, { type: file.type });
        }
        return null;
      }));
      const valid = processed.filter(f => f !== null);
      
      setFileStatuses(prev => {
          const nextStats = { ...prev };
          valid.forEach(f => {
              nextStats[f.name + f.size] = { state: 'pending', progress: 0 };
          });
          return nextStats;
      });

      setFiles(prev => ({ ...prev, [category]: [...prev[category], ...valid] }));
    } finally { setIsCompressing(false); e.target.value = ''; }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const data = new FormData();
    data.append('step', 'doc_file');
    data.append('folderName', activeFolderName);
    data.append('docType', docType);
    data.append('conversionType', formData.conversionType);
    
    const isPz = docType === 'pz';
    const needsDescription = isPz && (!hasExistingDescription || isDescriptionEditable);
    data.append('updateDescription', needsDescription.toString());

    try {
      const res = await authFetch('/api/upload', { method: 'POST', body: data });
      if (res.ok) setShowSuccess(true);
      else showAlert("Ошибка", "Не удалось завершить заявку.", "error");
    } catch(e) {
        showAlert("Ошибка связи", "Сервер не отвечает.", "error");
    } finally { setIsSubmitting(false); }
  };

  const isAnyFileUploading = Object.values(fileStatuses).some(status => status.state === 'uploading');
  const isAnyFilePending = Object.values(fileStatuses).some(status => status.state === 'pending');

  const handleNextStep = async () => {
      triggerSync(); // ИЗМЕНЕНО: Выполняется проверка папок при нажатии Далее
      if (currentStep === 1) { setCurrentStep(2); return; }
      
      if (currentStep === 2) {
          if (!formData.licensePlate.trim() || formData.licensePlate.length < 6) return showAlert("Ошибка", "Введите корректный гос. номер автомобиля", "error");
          if (clientType === 'legal' && !formData.companyName) return showAlert("Внимание", "Пожалуйста, укажите название компании", "info");
          if (!validateFullName(formData.fullName)) return showAlert("Неверный формат", "Заполните ФИО полностью на русском языке (как в паспорте)", "error");
          
          if (!activeFolderName) {
              setIsSubmitting(true);
              const data = new FormData();
              data.append('step', 'main_folder');
              data.append('clientType', clientType);
              data.append('fullName', formData.fullName);
              data.append('companyName', formData.companyName);
              data.append('licensePlate', formData.licensePlate);
              try {
                  const res = await authFetch('/api/upload', { method: 'POST', body: data });
                  const json = await res.json();
                  if (json.success) setActiveFolderName(json.folderName);
              } catch (e) {
                  setIsSubmitting(false);
                  return showAlert("Ошибка", "Не удалось создать папку на сервере", "error");
              }
              setIsSubmitting(false);
          }
      }

      if (currentStep === 3) {
          setIsSubmitting(true);
          const data = new FormData();
          data.append('step', 'sub_folder');
          data.append('folderName', activeFolderName);
          data.append('docType', docType);
          try {
              await authFetch('/api/upload', { method: 'POST', body: data });
          } catch (e) {
              setIsSubmitting(false);
              return showAlert("Ошибка", "Не удалось создать раздел услуги", "error");
          }
          setIsSubmitting(false);
      }

      if (currentStep === 4) {
          if (isAnyFileUploading) {
              return showAlert("Загрузка файлов", "Пожалуйста, дождитесь окончания загрузки файлов перед переходом на другой этап.", "info");
          }
          if (isAnyFilePending) {
              return showAlert("Внимание", "Для перехода на следующий этап необходимо нажать кнопку загрузки для всех выбранных файлов.", "info");
          }
      }

      if (currentStep < 5) setCurrentStep(prev => prev + 1); 
      else handleSubmit();
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-regdoc-grey overflow-hidden max-w-2xl mx-auto relative min-h-[500px]">
      
      {modal.show && (
        <div className="absolute inset-0 bg-regdoc-navy/40 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-[40px] p-8 w-full max-w-sm text-center shadow-2xl border-t-4 border-regdoc-cyan/40">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${modal.type === 'error' ? 'bg-red-100 text-red-500' : 'bg-regdoc-mist text-regdoc-cyan'}`}>
              {modal.type === 'error' ? <AlertCircle size={32} /> : <Info size={32} />}
            </div>
            <h3 className="text-xl font-bold text-regdoc-navy mb-2">{modal.title}</h3>
            <p className="text-regdoc-navy/55 text-sm leading-relaxed mb-8">{modal.message}</p>
            <button 
                onClick={() => setModal({ ...modal, show: false })}
                className="w-full py-4 bg-regdoc-cyan text-white font-bold rounded-2xl hover:bg-regdoc-teal transition-all shadow-lg"
            >
                Понятно
            </button>
          </div>
        </div>
      )}

      {showExitPrompt && (
        <div className="absolute inset-0 bg-regdoc-navy/95 backdrop-blur-md z-[150] flex items-center justify-center p-6 animate-in zoom-in-95">
          <div className="bg-white rounded-[40px] p-8 w-full max-w-md shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4"><XCircle size={32} /></div>
            <h3 className="text-xl font-bold text-regdoc-navy mb-2">Отменить заявку?</h3>
            <p className="text-regdoc-navy/55 text-sm mb-8">Вы хотите завершить отправку (сохранить загруженные файлов) или отменить и полностью удалить всю папку с сервера?</p>
            <div className="space-y-3">
                <button onClick={() => setShowExitPrompt(false)} className="w-full py-4 bg-regdoc-cyan text-white font-bold rounded-2xl hover:bg-regdoc-teal transition-all">Завершить отправку</button>
                <button onClick={() => setShowExitPrompt(false)} className="w-full py-4 bg-regdoc-grey text-regdoc-navy/65 font-bold rounded-2xl hover:bg-regdoc-grey/80 transition-all">Назад</button>
                <button onClick={handleAbortAndClean} disabled={isSubmitting} className="w-full py-4 bg-red-50 text-red-600 font-bold rounded-2xl hover:bg-red-100 transition-all">{isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : "Удалить заявку и выйти"}</button>
            </div>
          </div>
        </div>
      )}

      {showDecision && (
        <div className="absolute inset-0 bg-regdoc-navy/95 backdrop-blur-md z-[110] flex items-center justify-center p-6 animate-in zoom-in-95">
          <div className="bg-white rounded-[40px] p-8 w-full max-w-md shadow-2xl">
            <div className="w-16 h-16 bg-regdoc-orange/15 text-regdoc-orange rounded-full flex items-center justify-center mx-auto mb-4"><History size={32} /></div>
            <h3 className="text-xl font-bold text-regdoc-navy text-center mb-2">Найдена заявка!</h3>
            <p className="text-regdoc-navy/55 text-center text-sm mb-8">Для автомобиля <b>{formData.licensePlate}</b>. Как поступим?</p>
            <div className="space-y-3">
                <button onClick={() => handleDecision('continue')} className="w-full py-4 bg-regdoc-cyan text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-regdoc-teal transition-all"><RotateCw size={18} /> Продолжить</button>
                <button onClick={() => handleDecision('new')} className="w-full py-4 bg-regdoc-grey text-regdoc-navy/65 font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-regdoc-grey/80 transition-all"><PlusCircle size={18} /> Создать новую</button>
            </div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="absolute inset-0 bg-regdoc-navy/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white rounded-[40px] p-10 w-full max-w-sm text-center shadow-2xl">
            <div className="w-20 h-20 bg-regdoc-mist text-regdoc-cyan rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 size={48} /></div>
            <h3 className="text-regdoc-navy/40 text-[10px] font-bold uppercase tracking-[0.2em] mb-2 text-center">Ответ от регистратора:</h3>
            <p className="text-xl font-bold text-regdoc-navy mb-8 text-center">Заявка принята в работу!</p>
            <button onClick={() => window.location.reload()} className="w-full py-4 bg-regdoc-cyan text-white font-bold rounded-2xl shadow-lg shadow-regdoc-navy/25 hover:bg-regdoc-teal transition-colors">Отлично</button>
          </div>
        </div>
      )}

      {(isCompressing || isSearching) && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl">
          <Loader2 className="w-10 h-10 text-regdoc-cyan animate-spin mb-3" />
          <p className="text-regdoc-navy font-semibold">{isSearching ? 'Связь с облаком...' : 'Сжатие файлов...'}</p>
        </div>
      )}

      <div className="bg-regdoc-grey/60 p-4 border-b border-regdoc-grey flex justify-between px-8 sm:px-12">
        {steps.map((s) => (
          <div key={s.id} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${currentStep >= s.id ? 'bg-regdoc-cyan border-regdoc-cyan text-white' : 'bg-white border-regdoc-grey text-regdoc-navy/35'}`}>
            {currentStep > s.id ? <Check size={14} /> : s.id}
          </div>
        ))}
      </div>

      <div className="p-6 sm:p-8">
        
        {currentStep === 1 && (
            <div className="space-y-6 animate-in slide-in-from-bottom-2">
                <div className="space-y-3">
                    <h3 className="font-bold text-lg text-regdoc-navy">Начните с номера авто</h3>
                    <div className="relative">
                        <Input label="Гос. номер автомобиля (необязательно)" value={formData.licensePlate} onChange={() => {}} onInput={handlePlateInput} placeholder="А 123 АА / 77" isMono />
                        <button onClick={checkExistingApplication} className="absolute right-3 bottom-3 p-2 bg-regdoc-cyan text-white rounded-xl shadow-md hover:bg-regdoc-teal hover:scale-105 active:scale-95 transition-all"><RotateCw size={20} className={isSearching ? 'animate-spin' : ''} /></button>
                    </div>
                </div>
                <hr className="border-regdoc-grey" />
                <div className="space-y-4">
                    <h3 className="font-bold text-lg text-regdoc-navy">Кто собственник ТС?</h3>
                    <SelectionCard active={clientType === 'individual'} onClick={() => setClientType('individual')} icon={<User />} title="Физическое лицо" desc="Частный владелец" />
                    <SelectionCard active={clientType === 'legal'} onClick={() => setClientType('legal')} icon={<Briefcase />} title="Юридическое лицо / ИП" desc="На компанию" />
                </div>
            </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-5 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-regdoc-navy">Персональные данные</h3>
            <Input label="Гос. номер автомобиля (ОБЯЗАТЕЛЬНО)" value={formData.licensePlate} onChange={() => {}} onInput={handlePlateInput} placeholder="А 123 АА / 77" isMono />
            {clientType === 'legal' && <Input label="Название компании" value={formData.companyName} onChange={v => setFormData({...formData, companyName: v})} placeholder="ООО Элит Газ" />}
            <Input label={clientType === 'legal' ? "ФИО представителя" : "ФИО собственника полностью"} value={formData.fullName} onChange={handleFullNameChange} placeholder="Иванов Иван Иванович" />
          </div>
        )}

        {currentStep === 3 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2">
                <h3 className="font-bold text-lg text-regdoc-navy">Что оформляем?</h3>
                <SelectionCard active={docType === 'pz'} onClick={() => setDocType('pz')} icon={<FileSignature />} title="Предварительное заключение (ПЗ)" desc="До установки ГБО" />
                <SelectionCard active={docType === 'pb'} onClick={() => setDocType('pb')} icon={<FileCheck2 />} title="Протокол безопасности (ПБ)" desc="После установки" />
            </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-regdoc-navy">Загрузите фотографии или PDF</h3>
            <div className="bg-regdoc-mist p-3 rounded-2xl flex gap-3 text-regdoc-teal text-xs border border-regdoc-cyan/25">
              <Info size={16} className="shrink-0 mt-0.5 text-regdoc-cyan" />
              <p>Ограничение по размеру одного файла — <b>не более 5 МБ</b>.</p>
            </div>
            <UploadCard title="Паспорт собственника" desc="2 разворота" files={files.passport} existing={existingCloudFiles.passport} onUpload={e => handleFileChange(e, 'passport')} onRemove={i => setFiles({...files, passport: files.passport.filter((_,idx)=>idx!==i)})} fileStatuses={fileStatuses} onSimulateUpload={(f) => handleRealUpload(f, 'passport')} />
            <UploadCard title="СНИЛС" desc="Лицевая сторона" files={files.snils} existing={existingCloudFiles.snils} onUpload={e => handleFileChange(e, 'snils')} onRemove={i => setFiles({...files, snils: files.snils.filter((_,idx)=>idx!==i)})} fileStatuses={fileStatuses} onSimulateUpload={(f) => handleRealUpload(f, 'snils')} />
            <UploadCard title="СТС" desc="Обе стороны" files={files.sts} existing={existingCloudFiles.sts} onUpload={e => handleFileChange(e, 'sts')} onRemove={i => setFiles({...files, sts: files.sts.filter((_,idx)=>idx!==i)})} fileStatuses={fileStatuses} onSimulateUpload={(f) => handleRealUpload(f, 'sts')} />
            <UploadCard title="ПТС" desc="Все страницы" files={files.pts} existing={existingCloudFiles.pts} onUpload={e => handleFileChange(e, 'pts')} onRemove={i => setFiles({...files, pts: files.pts.filter((_,idx)=>idx!==i)})} fileStatuses={fileStatuses} onSimulateUpload={(f) => handleRealUpload(f, 'pts')} />
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-lg text-regdoc-navy">Тип переоборудования</h3>
                {hasExistingDescription && !isDescriptionEditable && (
                    <button 
                        onClick={() => setIsDescriptionEditable(true)}
                        className="px-4 py-1.5 bg-regdoc-grey text-regdoc-navy/65 font-bold rounded-xl shadow-sm hover:bg-regdoc-grey/80 transition-all text-[11px] uppercase tracking-wider"
                    >
                        Изменить
                    </button>
                )}
            </div>
            <textarea 
                className={`w-full h-44 p-5 rounded-2xl outline-none focus:border-regdoc-cyan leading-relaxed transition-all ${!isDescriptionEditable ? 'bg-regdoc-grey/50 border border-regdoc-grey text-regdoc-navy/40 cursor-not-allowed' : 'bg-white border border-regdoc-grey text-regdoc-navy'}`} 
                value={formData.conversionType} 
                onChange={e => setFormData({...formData, conversionType: e.target.value})} 
                disabled={!isDescriptionEditable}
            />
          </div>
        )}

        <div className="mt-8 flex flex-col gap-4">
          <div className="flex gap-3">
            {currentStep > 1 && currentStep < 5 && (
              <button onClick={() => {
                  triggerSync(); // ИЗМЕНЕНО: Выполняется проверка папок при нажатии Назад
                  if (currentStep === 4 && isAnyFileUploading) {
                      return showAlert("Загрузка файлов", "Пожалуйста, дождитесь окончания загрузки файлов перед переходом на другой этап.", "info");
                  }
                  setCurrentStep(prev => prev - 1);
              }} className="px-6 py-4 rounded-2xl border border-regdoc-grey font-bold text-regdoc-navy/50 hover:bg-regdoc-grey/40 transition-all">Назад</button>
            )}

            {currentStep === 5 && (
              <button onClick={() => { triggerSync(); setCurrentStep(prev => prev - 1); }} className="px-6 py-4 rounded-2xl border border-regdoc-grey font-bold text-regdoc-navy/50 hover:bg-regdoc-grey/40 transition-all">Назад</button>
            )}

            <button onClick={handleNextStep} disabled={isSubmitting} className="flex-1 py-4 bg-regdoc-cyan text-white font-bold rounded-2xl shadow-lg shadow-regdoc-navy/10 hover:bg-regdoc-teal transition-colors flex items-center justify-center disabled:opacity-60">
              {isSubmitting ? <Loader2 className="animate-spin" /> : (currentStep === 5 ? 'Отправить документы' : 'Далее')}
            </button>
          </div>
          
          {currentStep === 5 && isNewApplication && (
              <button onClick={() => setShowExitPrompt(true)} className="mx-auto px-6 py-2.5 rounded-2xl border border-red-200 bg-red-50 text-sm font-bold text-red-500 hover:bg-red-100 transition-all">Отменить</button>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectionCard({ active, onClick, icon, title, desc }) {
  return (
    <div onClick={onClick} className={`p-4 rounded-2xl border-2 cursor-pointer flex items-center gap-4 transition-all ${active ? 'border-regdoc-cyan bg-regdoc-mist shadow-sm' : 'border-regdoc-grey bg-white shadow-sm hover:border-regdoc-grey'}`}>
      <div className={`p-3 rounded-xl ${active ? 'bg-regdoc-cyan text-white' : 'bg-regdoc-grey/80 text-regdoc-navy/40'}`}>{icon}</div>
      <div className="flex-1">
        <div className="font-bold text-regdoc-navy text-sm">{title}</div>
        <div className="text-[11px] text-regdoc-navy/50 leading-tight">{desc}</div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, onInput, placeholder, isMono }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-regdoc-navy/45 uppercase ml-1 tracking-wider">{label}</label>
      <input type="text" value={value} onInput={onInput} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`w-full p-4 bg-regdoc-grey/40 border border-regdoc-grey rounded-2xl outline-none focus:border-regdoc-cyan focus:bg-white transition-all ${isMono ? 'font-mono text-lg tracking-widest' : ''}`} />
    </div>
  );
}

function UploadCard({ title, desc, files, existing, onUpload, onRemove, fileStatuses, onSimulateUpload }) {
  return (
    <div className="border border-regdoc-grey rounded-2xl p-4 bg-regdoc-grey/35">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-bold text-regdoc-navy text-sm leading-none">{title}</div>
          <div className="text-[10px] text-regdoc-navy/45 uppercase font-bold mt-1 tracking-tight">{desc}</div>
        </div>
        <div className="flex gap-2">
            <label className="bg-white p-2.5 rounded-xl shadow-sm border border-regdoc-grey cursor-pointer text-regdoc-navy/50 hover:text-regdoc-cyan active:scale-95 transition-all"><Paperclip size={20} /><input type="file" multiple className="hidden" onChange={onUpload} accept="image/*,.pdf" /></label>
            <label className="sm:hidden bg-white p-2.5 rounded-xl shadow-sm border border-regdoc-grey cursor-pointer text-regdoc-cyan active:scale-95 transition-all"><Camera size={20} /><input type="file" className="hidden" onChange={onUpload} accept="image/*" capture="environment" /></label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {existing && existing.map((name, i) => (
            <div key={i} className="bg-regdoc-mist border border-regdoc-cyan/30 px-2.5 py-1.5 rounded-xl text-[10px] text-regdoc-teal flex items-center gap-1 font-semibold animate-in zoom-in-95">
                <Check size={10} strokeWidth={3} /> {name} (В облаке)
            </div>
        ))}
        {files.map((f, i) => {
            const key = f.name + f.size;
            const status = fileStatuses && fileStatuses[key] ? fileStatuses[key] : { state: 'pending', progress: 0 };
            return (
                <div key={i} className="bg-white border border-regdoc-cyan/25 p-2 rounded-xl text-[10px] flex flex-col gap-1.5 shadow-sm animate-in zoom-in-95 min-w-[140px] flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="truncate max-w-[100px] font-medium text-regdoc-navy">{f.name}</span>
                        <div className="flex items-center gap-1">
                            {status.state === 'pending' && (
                                <button onClick={() => onSimulateUpload(f)} className="text-white bg-regdoc-cyan hover:bg-regdoc-teal rounded-md p-0.5 transition-colors shadow-md" title="Загрузить на сервер">
                                    <Check size={12} strokeWidth={4} />
                                </button>
                            )}
                            {status.state === 'done' && (
                                <CheckCircle2 size={14} className="text-regdoc-cyan" />
                            )}
                            {status.state !== 'done' && status.state !== 'uploading' && (
                                <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 font-bold p-1 transition-colors" title="Удалить">✕</button>
                            )}
                        </div>
                    </div>
                    {status.state === 'uploading' && (
                        <div className="w-full bg-regdoc-grey h-1.5 rounded-full overflow-hidden">
                            <div className="bg-regdoc-cyan h-full transition-all duration-200" style={{ width: `${status.progress}%` }}></div>
                        </div>
                    )}
                </div>
            );
        })}
      </div>
    </div>
  );
}