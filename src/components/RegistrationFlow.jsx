import React, { useState } from 'react';
import { Check, ChevronRight, User, Briefcase, FileSignature, FileCheck2, Camera, Paperclip, Loader2, FileText, CheckCircle2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';

const steps = [
  { id: 1, title: 'Заявитель' },
  { id: 2, title: 'Услуга' },
  { id: 3, title: 'Данные' },
  { id: 4, title: 'Документы' },
  { id: 5, title: 'Описание' },
];

export default function RegistrationFlow() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false); // Состояние для нашего нового окна
  
  const [clientType, setClientType] = useState('individual');
  const [docType, setDocType] = useState('pz');
  const [formData, setFormData] = useState({ 
    fullName: '', 
    companyName: '', 
    licensePlate: '',
    conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).'
  });
  
  const [files, setFiles] = useState({
    passport: [],
    snils: [],
    sts: [],
    pts: []
  });

  const handlePlateInput = (e) => {
    let raw = e.target.value.toUpperCase();
    const enToRu = {'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','Y':'У','X':'Х'};
    let clean = '';
    for(let i=0; i<raw.length; i++) clean += enToRu[raw[i]] || raw[i];
    clean = clean.replace(/[^АВЕКМНОРСТУХ0-9]/g, '');
    
    let formatted = '';
    let chars = clean.split('');
    if (chars.length > 0) formatted += /[АВЕКМНОРСТУХ]/.test(chars[0]) ? chars[0] : '';
    if (chars.length > 1) {
        let nums = chars.slice(1, 4).join('').replace(/[^0-9]/g, '');
        if (nums) formatted += ' ' + nums;
    }
    if (chars.length > 4) {
        let letters = chars.slice(4, 6).join('').replace(/[^АВЕКМНОРСТУХ]/g, '');
        if (letters) formatted += ' ' + letters;
    }
    if (chars.length > 6) {
        let region = chars.slice(6, 9).join('').replace(/[^0-9]/g, '');
        if (region) formatted += ' / ' + region;
    }
    setFormData({ ...formData, licensePlate: formatted });
  };

  const handleFileChange = async (e, category) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;

    setIsCompressing(true);

    const options = {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    };

    try {
      const processedFiles = await Promise.all(
        selectedFiles.map(async (file) => {
          if (file.type === 'application/pdf') {
            const sizeInMB = file.size / (1024 * 1024);
            if (sizeInMB > 8) {
              alert(`Файл ${file.name} слишком тяжелый. Максимальный размер PDF - 8 МБ.`);
              return null;
            }
            return file;
          }
          
          if (file.type.startsWith('image/')) {
            try {
              const compressedBlob = await imageCompression(file, options);
              return new File([compressedBlob], file.name, { type: file.type });
            } catch (err) {
              return file;
            }
          }
          return null; 
        })
      );

      const validFiles = processedFiles.filter(f => f !== null);
      setFiles(prev => ({ ...prev, [category]: [...prev[category], ...validFiles] }));
      e.target.value = '';
    } catch (error) {
      alert('Ошибка при обработке файлов.');
    } finally {
      setIsCompressing(false);
    }
  };

  const removeFile = (category, index) => {
    setFiles(prev => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const submitData = new FormData();
    submitData.append('clientType', clientType);
    submitData.append('docType', docType);
    submitData.append('fullName', formData.fullName);
    submitData.append('companyName', formData.companyName);
    submitData.append('licensePlate', formData.licensePlate);
    submitData.append('conversionType', formData.conversionType);
    
    Object.keys(files).forEach(category => {
      files[category].forEach(file => {
        submitData.append(category, file);
      });
    });

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: submitData,
      });

      if (response.ok) {
        // Вместо alert() показываем наше окно
        setShowSuccess(true);
      } else {
        alert("Ошибка при отправке данных на сервер.");
      }
    } catch (error) {
      alert("⚠️ Сервер не отвечает.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden max-w-2xl mx-auto transition-all relative">
      
      {/* 🚀 НАШЕ НОВОЕ ОКНО УСПЕХА */}
      {showSuccess && (
        <div className="absolute inset-0 bg-[#111827]/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-[40px] p-10 w-full max-w-sm text-center shadow-2xl scale-in-center">
            <div className="w-20 h-20 bg-green-100 text-brandGreen rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 size={48} />
            </div>
            <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">
              Ответ от регистратора:
            </h3>
            <p className="text-xl font-bold text-slate-800 leading-tight mb-8">
              Ваша заявка и документы приняты в работу!
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-brandGreen text-white font-bold rounded-2xl hover:opacity-90 transition-all shadow-lg shadow-green-900/20"
            >
              Отлично
            </button>
          </div>
        </div>
      )}

      {isCompressing && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl">
          <Loader2 className="w-10 h-10 text-brandGreen animate-spin mb-3" />
          <p className="text-slate-700 font-semibold animate-pulse">Обработка файлов...</p>
        </div>
      )}

      <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between px-8 sm:px-12">
        {steps.map((s) => (
          <div key={s.id} className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${currentStep >= s.id ? 'bg-brandGreen border-brandGreen text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
              {currentStep > s.id ? <Check size={14} strokeWidth={3} /> : s.id}
            </div>
          </div>
        ))}
      </div>

      <div className="p-6 sm:p-8">
        {currentStep === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800 mb-2">Кто собственник ТС?</h3>
            <SelectionCard active={clientType === 'individual'} onClick={() => setClientType('individual')} icon={<User />} title="Физическое лицо" desc="Частный владелец автомобиля" />
            <SelectionCard active={clientType === 'legal'} onClick={() => setClientType('legal')} icon={<Briefcase />} title="Юридическое лицо / ИП" desc="Автомобиль оформлен на компанию" />
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800 mb-2">Выберите тип документа</h3>
            <SelectionCard active={docType === 'pz'} onClick={() => setDocType('pz')} icon={<FileSignature />} title="Предварительное заключение (ПЗ)" desc="Оформляется до установки оборудования" />
            <SelectionCard active={docType === 'pb'} onClick={() => setDocType('pb')} icon={<FileCheck2 />} title="Протокол безопасности (ПБ)" desc="Оформляется после монтажа и проверки" />
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800 mb-2">Заполните данные</h3>
            {clientType === 'legal' && (
               <Input label="Название компании / ИП" value={formData.companyName} onChange={v => setFormData({...formData, companyName: v})} placeholder="Например: ООО Элит Газ" />
            )}
            <Input label={clientType === 'legal' ? "ФИО представителя" : "ФИО собственника полностью"} value={formData.fullName} onChange={v => setFormData({...formData, fullName: v})} placeholder="Иванов Иван Иванович" />
            <Input label="Гос. номер автомобиля" value={formData.licensePlate} onChange={() => {}} onInput={handlePlateInput} placeholder="А 123 АА / 77" isMono />
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800 mb-2">Загрузите фотографии или PDF</h3>
            <UploadCard title="Паспорт собственника" desc="2 разворота: главная + актуальная прописка" files={files.passport} onUpload={e => handleFileChange(e, 'passport')} onRemove={i => removeFile('passport', i)} />
            <UploadCard title="СНИЛС" desc="Лицевая сторона документа" files={files.snils} onUpload={e => handleFileChange(e, 'snils')} onRemove={i => removeFile('snils', i)} />
            <UploadCard title="СТС" desc="Обе стороны (пластиковое свидетельство)" files={files.sts} onUpload={e => handleFileChange(e, 'sts')} onRemove={i => removeFile('sts', i)} />
            <UploadCard title="ПТС" desc="Все страницы (бумажный разворот или ЭПТС)" files={files.pts} onUpload={e => handleFileChange(e, 'pts')} onRemove={i => removeFile('pts', i)} />
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-slate-800">Тип переоборудования</h3>
            <div className="bg-blue-50 p-4 rounded-2xl flex gap-3 text-blue-700 text-sm mb-2 border border-blue-100">
              <FileText size={20} className="shrink-0" />
              <p>В свободной форме описываются предполагаемые работы, например:</p>
            </div>
            <textarea 
              className="w-full h-44 p-5 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brandGreen/20 focus:border-brandGreen outline-none text-slate-700 leading-relaxed transition-all bg-slate-50/30"
              value={formData.conversionType}
              onChange={(e) => setFormData({...formData, conversionType: e.target.value})}
            />
          </div>
        )}

        <div className="mt-8 flex gap-3">
          {currentStep > 1 && (
            <button 
              onClick={() => setCurrentStep(prev => prev - 1)} 
              disabled={isSubmitting || isCompressing}
              className="px-6 py-4 rounded-2xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Назад
            </button>
          )}
          <button 
            onClick={() => {
              if (currentStep === 3) {
                if (!formData.fullName.trim() || !formData.licensePlate.trim()) {
                  alert("Пожалуйста, заполните ФИО и Гос. номер");
                  return;
                }
              }
              if (currentStep === 4) {
                if (files.passport.length === 0) { alert("Загрузите фото или PDF ПАСПОРТА"); return; }
                if (files.snils.length === 0) { alert("Загрузите фото или PDF СНИЛС"); return; }
                if (files.sts.length === 0) { alert("Загрузите фото или PDF СТС"); return; }
                if (files.pts.length === 0) { alert("Загрузите фото или PDF ПТС"); return; }
              }
              if (currentStep < 5) setCurrentStep(prev => prev + 1);
              else handleSubmit();
            }}
            disabled={isSubmitting || isCompressing}
            className="flex-1 py-4 px-6 rounded-2xl bg-brandGreen text-white font-bold shadow-lg shadow-green-900/10 flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-70"
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : (currentStep === 5 ? 'Отправить документы' : 'Далее')}
            {!isSubmitting && currentStep < 5 && <ChevronRight size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectionCard({ active, onClick, icon, title, desc }) {
  return (
    <div onClick={onClick} className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-4 ${active ? 'border-brandGreen bg-green-50' : 'border-slate-100 bg-white hover:border-slate-200 shadow-sm'}`}>
      <div className={`p-3 rounded-xl ${active ? 'bg-brandGreen text-white' : 'bg-slate-100 text-slate-400'}`}>{icon}</div>
      <div className="flex-1">
        <div className="font-bold text-slate-800 text-sm">{title}</div>
        <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{desc}</div>
      </div>
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${active ? 'border-brandGreen' : 'border-slate-300'}`}>
        {active && <div className="w-2.5 h-2.5 rounded-full bg-brandGreen"></div>}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, onInput, placeholder, isMono }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 tracking-wider">{label}</label>
      <input 
        type="text" 
        value={value} 
        onInput={onInput} 
        onChange={e => onChange(e.target.value)} 
        placeholder={placeholder} 
        className={`w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-brandGreen focus:bg-white transition-all ${isMono ? 'font-mono text-lg tracking-widest' : ''}`} 
      />
    </div>
  );
}

function UploadCard({ title, desc, files, onUpload, onRemove }) {
  return (
    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/40">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-3">
        <div>
          <div className="font-bold text-slate-800 text-sm leading-none">{title}</div>
          <div className="text-[10px] text-slate-400 uppercase font-bold mt-1 tracking-tight">{desc}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100 cursor-pointer text-slate-500 hover:text-brandGreen hover:scale-105 active:scale-95 transition-all flex items-center justify-center">
            <Paperclip size={20} />
            <input type="file" multiple className="hidden" onChange={onUpload} accept="image/*,.pdf" />
          </label>
          <label className="sm:hidden bg-white p-2.5 rounded-xl shadow-sm border border-slate-100 cursor-pointer text-brandGreen hover:scale-105 active:scale-95 transition-all flex items-center justify-center">
            <Camera size={20} />
            <input type="file" className="hidden" onChange={onUpload} accept="image/*" capture="environment" />
          </label>
        </div>
      </div>
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {files.map((f, i) => (
            <div key={i} className="bg-white border border-brandGreen/20 px-2.5 py-1.5 rounded-xl text-[10px] flex items-center gap-2 shadow-sm animate-in zoom-in-95">
              <span className="max-w-[120px] truncate font-semibold text-slate-600">{f.name}</span>
              <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 font-bold p-1">✕</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-slate-300 italic mt-1 ml-0.5">Файлы еще не выбраны...</div>
      )}
    </div>
  );
}