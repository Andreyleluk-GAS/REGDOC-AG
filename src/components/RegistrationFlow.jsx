import React, { useState } from 'react';
import { Check, ChevronRight, User, Briefcase, FileSignature, FileCheck2, Camera, Paperclip, Loader2, FileText, CheckCircle2, RotateCw, History, PlusCircle, AlertCircle, UploadCloud, Trash2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';

const steps = [
  { id: 1, title: 'Заявитель' }, { id: 2, title: 'Данные' }, { id: 3, title: 'Услуга' }, { id: 4, title: 'Документы' }, { id: 5, title: 'Описание' },
];

export default function RegistrationFlow() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [modal, setModal] = useState({ show: false, title: '', message: '', type: 'info' });

  const [formData, setFormData] = useState({ fullName: '', companyName: '', licensePlate: '', conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).' });
  const [clientType, setClientType] = useState('individual');
  const [docType, setDocType] = useState('pz');

  // Состояние файлов
  const [files, setFiles] = useState({ passport: [], snils: [], sts: [], pts: [] });
  // Состояние статуса загрузки для каждого раздела: 'idle' | 'uploading' | 'success'
  const [uploadStatus, setUploadStatus] = useState({ passport: 'idle', snils: 'idle', sts: 'idle', pts: 'idle' });
  // Процент загрузки (симуляция для плавности)
  const [uploadProgress, setUploadProgress] = useState({ passport: 0, snils: 0, sts: 0, pts: 0 });

  const showAlert = (title, message, type = 'info') => setModal({ show: true, title, message, type });

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

  const handleFileChange = async (e, category) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setIsCompressing(true);
    try {
      const processed = await Promise.all(selected.map(async (file) => {
        if (file.type === 'application/pdf') {
            if (file.size/1024/1024 > 8) { showAlert("Ошибка", `PDF ${file.name} > 8МБ`, "error"); return null; }
            return file;
        }
        const blob = await imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1920, useWebWorker: true });
        return new File([blob], file.name, { type: file.type });
      }));
      setFiles(prev => ({ ...prev, [category]: [...prev[category], ...processed.filter(f => f !== null)] }));
      setUploadStatus(prev => ({ ...prev, [category]: 'idle' })); // Сбрасываем статус при добавлении новых
    } finally { setIsCompressing(false); e.target.value = ''; }
  };

  // ФУНКЦИЯ ЗАГРУЗКИ ОДНОГО РАЗДЕЛА
  const uploadCategory = async (category) => {
    if (files[category].length === 0) return;
    
    setUploadStatus(prev => ({ ...prev, [category]: 'uploading' }));
    setUploadProgress(prev => ({ ...prev, [category]: 10 }));

    const data = new FormData();
    data.append('clientType', clientType);
    data.append('docType', docType);
    data.append('fullName', formData.fullName);
    data.append('companyName', formData.companyName);
    data.append('licensePlate', formData.licensePlate);
    files[category].forEach(f => data.append(category, f));

    try {
        // Симуляция движения ползунка
        const interval = setInterval(() => {
            setUploadProgress(prev => ({ 
                ...prev, 
                [category]: prev[category] < 90 ? prev[category] + 10 : 90 
            }));
        }, 400);

        const res = await fetch('/api/upload', { method: 'POST', body: data });
        clearInterval(interval);

        if (res.ok) {
            setUploadProgress(prev => ({ ...prev, [category]: 100 }));
            setTimeout(() => setUploadStatus(prev => ({ ...prev, [category]: 'success' })), 500);
        } else {
            throw new Error();
        }
    } catch (e) {
        setUploadStatus(prev => ({ ...prev, [category]: 'idle' }));
        showAlert("Ошибка", "Не удалось загрузить этот блок. Попробуйте снова.", "error");
    }
  };

  const handleFinalSubmit = async () => {
    // Проверка: всё ли загружено
    const pending = Object.keys(files).filter(cat => files[cat].length > 0 && uploadStatus[cat] !== 'success');
    if (pending.length > 0) {
        return showAlert("Внимание", "Загрузите выбранные файлы (нажмите на кнопку со стрелкой в каждом блоке)", "info");
    }

    setIsSubmitting(true);
    try {
        // Отправляем финальный запрос для создания DOCX
        const data = new FormData();
        data.append('isDocOnly', 'true');
        Object.entries(formData).forEach(([k,v]) => data.append(k,v));
        data.append('clientType', clientType);
        data.append('docType', docType);

        const res = await fetch('/api/upload', { method: 'POST', body: data });
        if (res.ok) setShowSuccess(true);
    } finally { setIsSubmitting(false); }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden max-w-2xl mx-auto relative">
      
      {/* Модалки (Успех, Ошибка, Загрузка) */}
      {modal.show && <Modal data={modal} onClose={() => setModal({...modal, show: false})} />}
      {showSuccess && <SuccessModal />}
      {isCompressing && <Loader label="Сжатие фото..." />}

      {/* Прогресс шагов */}
      <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between px-8 sm:px-12">
        {steps.map((s) => (
          <div key={s.id} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${currentStep >= s.id ? 'bg-brandGreen border-brandGreen text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
            {currentStep > s.id ? <Check size={14} /> : s.id}
          </div>
        ))}
      </div>

      <div className="p-6 sm:p-8">
        {currentStep === 1 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2">
                <h3 className="font-bold text-lg text-slate-800">Кто собственник ТС?</h3>
                <SelectionCard active={clientType === 'individual'} onClick={() => setClientType('individual')} icon={<User />} title="Физическое лицо" desc="Частный владелец" />
                <SelectionCard active={clientType === 'legal'} onClick={() => setClientType('legal')} icon={<Briefcase />} title="Юридическое лицо / ИП" desc="На компанию" />
            </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-5 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800">Данные автомобиля</h3>
            <Input label="Гос. номер автомобиля" value={formData.licensePlate} onInput={handlePlateInput} placeholder="А 123 АА / 77" isMono />
            {clientType === 'legal' && <Input label="Название компании" value={formData.companyName} onChange={v => setFormData({...formData, companyName: v})} placeholder="ООО Элит Газ" />}
            <Input label="ФИО собственника полностью" value={formData.fullName} onChange={v => setFormData({...formData, fullName: v})} placeholder="Иванов Иван Иванович" />
          </div>
        )}

        {currentStep === 3 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2">
                <h3 className="font-bold text-lg text-slate-800">Что оформляем?</h3>
                <SelectionCard active={docType === 'pz'} onClick={() => setDocType('pz')} icon={<FileSignature />} title="Предварительное заключение (ПЗ)" desc="До установки ГБО" />
                <SelectionCard active={docType === 'pb'} onClick={() => setDocType('pb')} icon={<FileCheck2 />} title="Протокол безопасности (ПБ)" desc="После установки" />
            </div>
        )}

        {/* ШАГ 4: ЗАГРУЗКА С ПОЛОСКОЙ ПРОГРЕССА */}
        {currentStep === 4 && (
          <div className="space-y-4 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800">Загрузите документы</h3>
            {['passport', 'snils', 'sts', 'pts'].map(cat => (
                <UploadCard 
                    key={cat}
                    title={cat === 'passport' ? 'Паспорт' : cat.toUpperCase()}
                    desc="Нажмите на иконку для выбора"
                    files={files[cat]}
                    status={uploadStatus[cat]}
                    progress={uploadProgress[cat]}
                    onUpload={(e) => handleFileChange(e, cat)}
                    onStartUpload={() => uploadCategory(cat)}
                    onRemove={(i) => setFiles({...files, [cat]: files[cat].filter((_,idx)=>idx!==i)})}
                />
            ))}
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4">
            <h3 className="font-bold text-lg text-slate-800">Тип переоборудования</h3>
            <textarea className="w-full h-44 p-5 border border-slate-200 rounded-2xl outline-none focus:border-brandGreen bg-slate-50/30 text-slate-700" value={formData.conversionType} onChange={e => setFormData({...formData, conversionType: e.target.value})} />
          </div>
        )}

        <div className="mt-8 flex gap-3">
          {currentStep > 1 && <button onClick={() => setCurrentStep(prev => prev - 1)} className="px-6 py-4 rounded-2xl border border-slate-200 font-bold text-slate-500">Назад</button>}
          <button onClick={() => {
            if (currentStep === 2 && (!formData.fullName || !formData.licensePlate)) return showAlert("Внимание", "Заполните все данные", "info");
            if (currentStep < 5) setCurrentStep(prev => prev + 1); 
            else handleFinalSubmit();
          }} className="flex-1 py-4 bg-brandGreen text-white font-bold rounded-2xl shadow-lg">
            {isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : (currentStep === 5 ? 'Завершить оформление' : 'Далее')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ОБНОВЛЕННЫЙ ВЕРХНИЙ КОМПОНЕНТ КАРТОЧКИ ЗАГРУЗКИ
function UploadCard({ title, desc, files, status, progress, onUpload, onStartUpload, onRemove }) {
  return (
    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/40 relative overflow-hidden">
      
      {/* Полоска прогресса снизу */}
      {status === 'uploading' && (
          <div className="absolute bottom-0 left-0 h-1 bg-green-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
      )}

      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-bold text-slate-800 text-sm">{title}</div>
            {status === 'success' && <CheckCircle2 size={16} className="text-brandGreen animate-in zoom-in" />}
          </div>
          <div className="text-[10px] text-slate-400 uppercase font-bold mt-1">{desc}</div>
        </div>

        <div className="flex gap-2">
            {/* Кнопка выбора файла */}
            {status !== 'success' && (
                <label className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100 cursor-pointer text-slate-500 hover:text-brandGreen active:scale-95 transition-all">
                    <Paperclip size={20} />
                    <input type="file" multiple className="hidden" onChange={onUpload} accept="image/*,.pdf" />
                </label>
            )}

            {/* Кнопка СТАРТА ЗАГРУЗКИ (Появляется когда файлы выбраны) */}
            {files.length > 0 && status === 'idle' && (
                <button 
                    onClick={onStartUpload}
                    className="bg-brandGreen p-2.5 rounded-xl shadow-md text-white hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 px-4"
                >
                    <UploadCloud size={20} />
                    <span className="text-xs font-bold uppercase">Загрузить</span>
                </button>
            )}
        </div>
      </div>

      {/* Список файлов */}
      <div className="flex flex-wrap gap-2 mt-3">
        {files.map((f, i) => (
            <div key={i} className={`px-2.5 py-1.5 rounded-xl text-[10px] flex items-center gap-2 border transition-all ${status === 'success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                <span className="truncate max-w-[120px] font-medium">{f.name}</span>
                {status === 'idle' && (
                    <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 font-bold p-1">✕</button>
                )}
            </div>
        ))}
      </div>
    </div>
  );
}

// Маленькие вспомогательные компоненты для чистоты кода
function SelectionCard({ active, onClick, icon, title, desc }) {
    return (
      <div onClick={onClick} className={`p-4 rounded-2xl border-2 cursor-pointer flex items-center gap-4 transition-all ${active ? 'border-brandGreen bg-green-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
        <div className={`p-3 rounded-xl ${active ? 'bg-brandGreen text-white' : 'bg-slate-100 text-slate-400'}`}>{icon}</div>
        <div className="flex-1">
          <div className="font-bold text-slate-800 text-sm">{title}</div>
          <div className="text-[11px] text-slate-500">{desc}</div>
        </div>
      </div>
    );
}

function Input({ label, value, onChange, onInput, placeholder, isMono }) {
    return (
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 tracking-wider">{label}</label>
        <input type="text" value={value} onInput={onInput} onChange={e => onChange && onChange(e.target.value)} placeholder={placeholder} className={`w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-brandGreen transition-all ${isMono ? 'font-mono text-lg tracking-widest' : ''}`} />
      </div>
    );
}

function Modal({ data, onClose }) {
    return (
        <div className="absolute inset-0 bg-[#111827]/40 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white rounded-[40px] p-8 w-full max-w-sm text-center shadow-2xl">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${data.type === 'error' ? 'bg-red-100 text-red-500' : 'bg-blue-100 text-blue-500'}`}>
                    {data.type === 'error' ? <AlertCircle size={32} /> : <Info size={32} />}
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">{data.title}</h3>
                <p className="text-slate-500 text-sm mb-8">{data.message}</p>
                <button onClick={onClose} className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl">Понятно</button>
            </div>
        </div>
    );
}

function Loader({ label }) {
    return (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl">
          <Loader2 className="w-10 h-10 text-brandGreen animate-spin mb-3" />
          <p className="text-slate-700 font-semibold">{label}</p>
        </div>
    );
}

function SuccessModal() {
    return (
        <div className="absolute inset-0 bg-[#111827]/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white rounded-[40px] p-10 w-full max-w-sm text-center shadow-2xl">
            <div className="w-20 h-20 bg-green-100 text-brandGreen rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 size={48} /></div>
            <p className="text-xl font-bold text-slate-800 mb-8">Заявка принята в работу!</p>
            <button onClick={() => window.location.reload()} className="w-full py-4 bg-brandGreen text-white font-bold rounded-2xl shadow-lg shadow-green-900/20">Отлично</button>
          </div>
        </div>
    );
}