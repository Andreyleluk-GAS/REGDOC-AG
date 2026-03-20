import React, { useState } from 'react';
import { Check, ChevronRight, User, Briefcase, FileSignature, FileCheck2, Camera, Paperclip, Loader2, FileText, CheckCircle2, RotateCw } from 'lucide-react';
import imageCompression from 'browser-image-compression';

const steps = [
  { id: 1, title: 'Заявитель' }, { id: 2, title: 'Услуга' }, { id: 3, title: 'Данные' }, { id: 4, title: 'Документы' }, { id: 5, title: 'Описание' },
];

export default function RegistrationFlow() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const [clientType, setClientType] = useState('individual');
  const [docType, setDocType] = useState('pz');
  const [formData, setFormData] = useState({ fullName: '', companyName: '', licensePlate: '', conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).' });
  
  const [files, setFiles] = useState({ passport: [], snils: [], sts: [], pts: [] });
  const [existingCloudFiles, setExistingCloudFiles] = useState({ passport: [], snils: [], sts: [], pts: [] });

  const checkExistingApplication = async () => {
    if (!formData.licensePlate.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/check-plate?plate=${encodeURIComponent(formData.licensePlate)}`);
      const data = await res.json();
      if (data.found) {
        setFormData(prev => ({ ...prev, fullName: data.fullName }));
        if (data.existingFiles) setExistingCloudFiles(data.existingFiles);
        alert("Заявка найдена! Данные ФИО и список загруженных файлов обновлены.");
      } else {
        alert("Заявка с таким номером не найдена. Продолжите ввод вручную.");
      }
    } catch (e) { alert("Ошибка при проверке номера."); }
    finally { setIsSearching(false); }
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

  const handleFileChange = async (e, category) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setIsCompressing(true);
    try {
      const processed = await Promise.all(selected.map(async (file) => {
        if (file.type === 'application/pdf') return file.size/1024/1024 > 8 ? null : file;
        if (file.type.startsWith('image/')) {
            const blob = await imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1920, useWebWorker: true });
            return new File([blob], file.name, { type: file.type });
        }
        return null;
      }));
      const valid = processed.filter(f => f !== null);
      setFiles(prev => ({ ...prev, [category]: [...prev[category], ...valid] }));
    } finally { setIsCompressing(false); e.target.value = ''; }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const data = new FormData();
    Object.entries(formData).forEach(([k,v]) => data.append(k,v));
    data.append('clientType', clientType); data.append('docType', docType);
    Object.keys(files).forEach(cat => files[cat].forEach(f => data.append(cat, f)));
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: data });
      if (res.ok) setShowSuccess(true);
      else alert("Ошибка при отправке.");
    } finally { setIsSubmitting(false); }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden max-w-2xl mx-auto relative">
      {showSuccess && (
        <div className="absolute inset-0 bg-[#111827]/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white rounded-[40px] p-10 w-full max-w-sm text-center shadow-2xl">
            <div className="w-20 h-20 bg-green-100 text-brandGreen rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 size={48} /></div>
            <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">Ответ от регистратора:</h3>
            <p className="text-xl font-bold text-slate-800 mb-8">Заявка принята в работу!</p>
            <button onClick={() => window.location.reload()} className="w-full py-4 bg-brandGreen text-white font-bold rounded-2xl shadow-lg shadow-green-900/20">Отлично</button>
          </div>
        </div>
      )}

      {(isCompressing || isSearching) && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl">
          <Loader2 className="w-10 h-10 text-brandGreen animate-spin mb-3" />
          <p className="text-slate-700 font-semibold">{isSearching ? 'Проверяем номер в облаке...' : 'Сжимаем фото...'}</p>
        </div>
      )}

      <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between px-8 sm:px-12">
        {steps.map((s) => (
          <div key={s.id} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${currentStep >= s.id ? 'bg-brandGreen border-brandGreen text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
            {currentStep > s.id ? <Check size={14} /> : s.id}
          </div>
        ))}
      </div>

      <div className="p-6 sm:p-8">
        {currentStep === 3 && (
          <div className="space-y-5 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800">Заполните данные</h3>
            <div className="relative">
                <Input label="Гос. номер автомобиля" value={formData.licensePlate} onChange={() => {}} onInput={handlePlateInput} placeholder="А 123 АА / 77" isMono />
                <button 
                    onClick={checkExistingApplication}
                    className="absolute right-3 bottom-3 p-2 bg-brandGreen text-white rounded-xl shadow-md hover:bg-green-700 transition-all"
                    title="Проверить наличие заявки"
                >
                    <RotateCw size={20} className={isSearching ? 'animate-spin' : ''} />
                </button>
            </div>
            {clientType === 'legal' && <Input label="Название компании" value={formData.companyName} onChange={v => setFormData({...formData, companyName: v})} placeholder="ООО Элит Газ" />}
            <Input label={clientType === 'legal' ? "ФИО представителя" : "ФИО собственника полностью"} value={formData.fullName} onChange={v => setFormData({...formData, fullName: v})} placeholder="Иванов Иван Иванович" />
          </div>
        )}
        
        {currentStep === 1 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2">
                <h3 className="font-bold text-lg text-slate-800">Кто собственник ТС?</h3>
                <SelectionCard active={clientType === 'individual'} onClick={() => setClientType('individual')} icon={<User />} title="Физическое лицо" desc="Частный владелец" />
                <SelectionCard active={clientType === 'legal'} onClick={() => setClientType('legal')} icon={<Briefcase />} title="Юридическое лицо / ИП" desc="На компанию" />
            </div>
        )}

        {currentStep === 2 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2">
                <h3 className="font-bold text-lg text-slate-800">Выберите тип документа</h3>
                <SelectionCard active={docType === 'pz'} onClick={() => setDocType('pz')} icon={<FileSignature />} title="Предварительное заключение (ПЗ)" desc="До установки ГБО" />
                <SelectionCard active={docType === 'pb'} onClick={() => setDocType('pb')} icon={<FileCheck2 />} title="Протокол безопасности (ПБ)" desc="После установки" />
            </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800">Загрузите фотографии или PDF</h3>
            <UploadCard title="Паспорт собственника" desc="2 разворота" files={files.passport} existing={existingCloudFiles.passport} onUpload={e => handleFileChange(e, 'passport')} onRemove={i => setFiles({...files, passport: files.passport.filter((_,idx)=>idx!==i)})} />
            <UploadCard title="СНИЛС" desc="Лицевая сторона" files={files.snils} existing={existingCloudFiles.snils} onUpload={e => handleFileChange(e, 'snils')} onRemove={i => setFiles({...files, snils: files.snils.filter((_,idx)=>idx!==i)})} />
            <UploadCard title="СТС" desc="Обе стороны" files={files.sts} existing={existingCloudFiles.sts} onUpload={e => handleFileChange(e, 'sts')} onRemove={i => setFiles({...files, sts: files.sts.filter((_,idx)=>idx!==i)})} />
            <UploadCard title="ПТС" desc="Все страницы" files={files.pts} existing={existingCloudFiles.pts} onUpload={e => handleFileChange(e, 'pts')} onRemove={i => setFiles({...files, pts: files.pts.filter((_,idx)=>idx!==i)})} />
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4">
            <h3 className="font-bold text-lg text-slate-800">Тип переоборудования</h3>
            <textarea className="w-full h-44 p-5 border border-slate-200 rounded-2xl outline-none focus:border-brandGreen bg-slate-50/30" value={formData.conversionType} onChange={e => setFormData({...formData, conversionType: e.target.value})} />
          </div>
        )}

        <div className="mt-8 flex gap-3">
          {currentStep > 1 && <button onClick={() => setCurrentStep(prev => prev - 1)} className="px-6 py-4 rounded-2xl border border-slate-200 font-bold text-slate-500">Назад</button>}
          <button onClick={() => {
            if (currentStep === 3 && (!formData.fullName || !formData.licensePlate)) return alert("Заполните данные");
            if (currentStep < 5) setCurrentStep(prev => prev + 1); else handleSubmit();
          }} className="flex-1 py-4 bg-brandGreen text-white font-bold rounded-2xl shadow-lg shadow-green-900/10">
            {isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : (currentStep === 5 ? 'Отправить' : 'Далее')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectionCard({ active, onClick, icon, title, desc }) {
  return (
    <div onClick={onClick} className={`p-4 rounded-2xl border-2 cursor-pointer flex items-center gap-4 transition-all ${active ? 'border-brandGreen bg-green-50' : 'border-slate-100 bg-white'}`}>
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
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">{label}</label>
      <input type="text" value={value} onInput={onInput} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-brandGreen ${isMono ? 'font-mono text-lg tracking-widest' : ''}`} />
    </div>
  );
}

function UploadCard({ title, desc, files, existing, onUpload, onRemove }) {
  return (
    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/40">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-bold text-slate-800 text-sm leading-none">{title}</div>
          <div className="text-[10px] text-slate-400 uppercase font-bold mt-1">{desc}</div>
        </div>
        <div className="flex gap-2">
            <label className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100 cursor-pointer text-slate-500 hover:text-brandGreen"><Paperclip size={20} /><input type="file" multiple className="hidden" onChange={onUpload} accept="image/*,.pdf" /></label>
            <label className="sm:hidden bg-white p-2.5 rounded-xl shadow-sm border border-slate-100 cursor-pointer text-brandGreen"><Camera size={20} /><input type="file" className="hidden" onChange={onUpload} accept="image/*" capture="environment" /></label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {existing && existing.map((name, i) => (
            <div key={i} className="bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-xl text-[10px] text-green-700 flex items-center gap-1">
                <Check size={10} /> {name} (В облаке)
            </div>
        ))}
        {files.map((f, i) => (
            <div key={i} className="bg-white border border-brandGreen/20 px-2.5 py-1.5 rounded-xl text-[10px] flex items-center gap-2">
                <span className="truncate max-w-[100px]">{f.name}</span>
                <button onClick={() => onRemove(i)} className="text-red-400 font-bold">✕</button>
            </div>
        ))}
      </div>
    </div>
  );
}