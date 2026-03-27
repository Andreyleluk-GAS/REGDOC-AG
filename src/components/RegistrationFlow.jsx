import React, { useState, useEffect } from 'react';
import { Check, ChevronRight, User, Briefcase, FileSignature, FileCheck2, Camera, Paperclip, Loader2, FileText, CheckCircle2, Save, RotateCw, History, PlusCircle, AlertCircle, Info, XCircle, MessageCircle, X, Trash2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { authFetch } from '../lib/api.js';
import { formatFIO } from '../lib/formatters.js';

export default function RegistrationFlow({ editingRequest, user, onComplete }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const [modal, setModal] = useState({ show: false, title: '', message: '', type: 'info' });

  const [activeFolderName, setActiveFolderName] = useState('');
  const [isNewApplication, setIsNewApplication] = useState(true);
  const [showExitPrompt, setShowExitPrompt] = useState(false);

  const [hasExistingDescription, setHasExistingDescription] = useState(false);
  const [isDescriptionEditable, setIsDescriptionEditable] = useState(true);

  const [clientType, setClientType] = useState('individual');
  const [docType, setDocType] = useState('pz');
  
  const [availablePzFiles, setAvailablePzFiles] = useState({});
  const [selectedPzCopies, setSelectedPzCopies] = useState({});

  const [formData, setFormData] = useState({ fullName: '', companyName: '', licensePlate: '', conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).' });
  const [verifiedFiles, setVerifiedFiles] = useState({});
  const [fileComments, setFileComments] = useState({});
  const [fileToDelete, setFileToDelete] = useState(null);
  const [remarksModal, setRemarksModal] = useState({ show: false, adding: false, newText: '' });
  const [gboOption, setGboOption] = useState('install_propan');
  const [addTsu, setAddTsu] = useState(false);

  useEffect(() => {
      if (!isDescriptionEditable) return;
      
      const isPropan = gboOption.includes('propan');
      const gasType = isPropan ? 'пропан' : 'метан';
      
      let text = '';
      
      if (gboOption.includes('gasdiesel')) {
          text = `На транспортное средство предполагается установка комплекта газодизельного оборудования для работы в двухтопливном режиме и использования для питания двигателя природного газа (${gasType})`;
      } else {
          let baseAction = 'установка комплекта газобаллонного оборудования';
          if (gboOption.includes('dismantle')) baseAction = 'демонтаж комплекта газобаллонного оборудования';
          text = `На транспортное средство предполагается ${baseAction} для питания двигателя природным газом (${gasType})`;
      }
      
      if (addTsu) text += ` и установка ТСУ`;
      text += `.`;
      
      setFormData(prev => ({ ...prev, conversionType: text }));
  }, [gboOption, addTsu, isDescriptionEditable]);

  const getTypeRequests = () => {
    const isPropan = gboOption.includes('propan');
    const prefix = isPropan ? 'propane_' : 'methane_';
    let action = 'installation';
    if (gboOption.includes('dismantle')) action = 'dismantling';
    if (gboOption.includes('gasdiesel')) action = 'gas_diesel';
    let res = prefix + action;
    if (addTsu) res += '+STU';
    return res;
  };

  const defaultFiles = {
      passport: [], snils: [], sts: [], pts: [], egrn: [],
      balloon_passport: [], act_opresovki: [], cert_gbo: [], cert_balloon: [],
      pte: [], zd: [], form207: [], gibdd_zayavlenie: [],
      photo_left: [], photo_right: [], photo_rear: [], photo_front: [],
      photo_hood: [], photo_vin: [], photo_kuzov: [], photo_tablichka: [],
      photo_balloon_place: [], photo_balloon_tablichka: [], photo_vent: [],
      photo_mult: [], photo_reduktor: [], photo_ebu: [], photo_forsunki: [], photo_vzu: []
  };

  const [files, setFiles] = useState(defaultFiles);
  const [existingCloudFiles, setExistingCloudFiles] = useState(defaultFiles);
  const [fileStatuses, setFileStatuses] = useState({});

  const steps = [
    { id: 1, title: 'Заявитель' }, 
    { id: 2, title: 'Данные' }, 
    { id: 3, title: 'Услуга' }, 
    { id: 4, title: 'Документы' }, 
    { id: 5, title: docType === 'pz' ? 'Описание' : 'Фотографии' },
  ];
  const commitRequest = async () => {
    if (activeFolderName) {
        const data = new FormData();
        data.append('step', 'commit_request');
        data.append('folderName', activeFolderName);
        data.append('type_requests', getTypeRequests());
        try {
            await authFetch('/api/upload', { method: 'POST', body: data });
        } catch (e) {
            console.error('Commit failed:', e);
        }
    }
  };

  const finishFlow = async () => {
      setIsSubmitting(true);
      await commitRequest();
      setIsSubmitting(false);
      if (onComplete) onComplete();
      else window.location.reload();
  };

  useEffect(() => {
    const handleBeforeUnload = (e) => {
        if (currentStep > 2 && currentStep < 6 && !showSuccess && isNewApplication) {
            e.preventDefault();
            e.returnValue = 'Заявка не завершена. Данные могут быть утеряны.';
            return e.returnValue;
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
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

        if (editingRequest.car_number) {
            setIsSearching(true);
            authFetch(`/api/check-plate?plate=${encodeURIComponent(editingRequest.car_number)}`)
                .then(res => {
                    if (!res.ok) throw new Error('Ошибка сервера');
                    return res.json();
                })
                .then(data => {
                    if (data.found) {
                        setActiveFolderName(data.folderName);
                        const targetDocType = editingRequest.targetDocType || 'pz';
                        const specificFiles = targetDocType === 'pz' ? data.existingFiles_PZ : data.existingFiles_PB;
                        if (specificFiles) setExistingCloudFiles({...defaultFiles, ...specificFiles});
                        
                        if (data.pzFiles) {
                            setAvailablePzFiles({
                                passport: data.pzFiles.passport?.length > 0,
                                snils: data.pzFiles.snils?.length > 0,
                                sts: data.pzFiles.sts?.length > 0,
                                pts: data.pzFiles.pts?.length > 0,
                                egrn: data.pzFiles.egrn?.length > 0,
                            });
                        }

                        if (data.hasDescription) {
                            setHasExistingDescription(true);
                            setIsDescriptionEditable(false);
                        }
                        if (data.verified_files) {
                            setVerifiedFiles(data.verified_files);
                        }
                        if (data.file_comments) {
                            setFileComments(data.file_comments);
                        }
                        setCurrentStep(editingRequest.forcedStep || 3);
                    } else {
                        showAlert("Ошибка", "Папка заявки не найдена на сервере.", "error");
                        setCurrentStep(1);
                    }
                })
                .catch(e => {
                    showAlert("Ошибка связи", "Не удалось загрузить данные заявки. Проверьте интернет-соединение.", "error");
                    setCurrentStep(1);
                })
                .finally(() => {
                    setIsSearching(false);
                });
        }
    } else {
        setVerifiedFiles({});
        setFileComments({});
        setCurrentStep(1);
        setIsNewApplication(true);
        setActiveFolderName('');
        setAvailablePzFiles({});
        setSelectedPzCopies({});
        setFormData({ fullName: '', companyName: '', licensePlate: '', conversionType: 'На транспортное средство предполагается установка комплекта газобаллонного оборудования для питания двигателя природным газом (пропан).' });
        setFiles(defaultFiles);
        setExistingCloudFiles(defaultFiles);
        setGboOption('install_propan');
        setAddTsu(false);
    }
  }, [editingRequest]);

  const toggleVerifyFile = (filename) => {
      const isVerified = verifiedFiles[docType]?.[filename] || false;
      const next = !isVerified;
      
      const newVerifiedFiles = {
          ...verifiedFiles,
          [docType]: {
              ...(verifiedFiles[docType] || {}),
              [filename]: next
          }
      };
      setVerifiedFiles(newVerifiedFiles);
  };

  const saveVerificationFile = async (filename) => {
      const reqId = editingRequest?.ID;
      if (!reqId) return;

      // Рассчитываем итоговую верификацию всего раздела
      // Раздел верифицирован, если для каждого обязательного поля ЕСТЬ хотя бы один файл И ВСЕ файлы в обязательных полях верифицированы.
      const currentCategories = docType === 'pz' ? 
          (clientType === 'individual' ? ['pts', 'sts', 'passport', 'snils'] : ['egrn', 'passport', 'pts', 'sts']) :
          ['pts', 'sts', 'passport', 'snils', 'balloon_passport', 'act_opresovki', 'cert_gbo', 'cert_balloon', 'pte', 'zd', 'form207', 'gibdd_zayavlenie'];

      // Проверяем: у всех ли категорий есть файлы и все ли они проверены
      const allOk = currentCategories.every(cat => {
          const catFiles = existingCloudFiles[cat] || [];
          if (catFiles.length === 0) return false; // обязательное поле пусто - раздел не готов
          return catFiles.every(fname => verifiedFiles[docType]?.[fname] === true);
      });

      try {
          await authFetch('/api/requests/verify-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                  id: reqId, 
                  docType, 
                  filename: filename, 
                  verified: verifiedFiles[docType]?.[filename],
                  isFullyVerified: allOk 
              })
          });
      } catch (e) {
          console.error('Save file verification failed:', e);
      }
  };

  const requestDeleteFile = (category, filename) => {
      setFileToDelete({ category, filename });
  };

  const confirmDeleteFileOnServer = async () => {
      if (!fileToDelete) return;
      const { category, filename } = fileToDelete;
      const reqId = editingRequest?.ID;
      if (!reqId) { setFileToDelete(null); return; }

      try {
          const res = await authFetch('/api/requests/delete-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: reqId, docType, filename })
          });
          if (res.ok) {
              setExistingCloudFiles(prev => ({
                  ...prev,
                  [category]: prev[category].filter(f => f !== filename)
              }));
          }
      } catch (e) {
          console.error('Delete failed:', e);
      }
      setFileToDelete(null);
  };

  const openFile = (filename) => {
      const reqId = editingRequest?.ID;
      if (!reqId) return;
      window.open(`/api/requests/view-file?id=${reqId}&docType=${docType}&filename=${encodeURIComponent(filename)}`, '_blank');
  };

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
      
      let authTok = '';
      try { authTok = localStorage.getItem('token') || localStorage.getItem('regdoc_token') || ''; } catch(e){}
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
      finishFlow(); 
  };

  const validateFullName = (name) => {
    const fioRegex = /^[А-ЯЁ][а-яё]+(\s+[А-ЯЁ][а-яё]+)+$/;
    return fioRegex.test(name.trim());
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
    setFormData({ ...formData, fullName: formatFIO(val) });
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

      setFiles(prev => ({ ...prev, [category]: [...(prev[category] || []), ...valid] }));
    } finally { setIsCompressing(false); e.target.value = ''; }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const data = new FormData();
    data.append('step', 'doc_file');
    data.append('folderName', activeFolderName);
    data.append('docType', docType);
    data.append('conversionType', formData.conversionType);
    
    const toCopy = Object.keys(selectedPzCopies).filter(k => selectedPzCopies[k]);
    data.append('filesToCopy', JSON.stringify(toCopy));
    
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
              data.append('type_requests', getTypeRequests());
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

      if (currentStep < 5) {
          setCurrentStep(prev => prev + 1); 
      } else {
          if (isAnyFileUploading) return showAlert("Загрузка файлов", "Пожалуйста, дождитесь окончания загрузки файлов.", "info");
          if (isAnyFilePending) return showAlert("Внимание", "Необходимо нажать кнопку загрузки для всех выбранных файлов.", "info");
          handleSubmit();
      }
  };

  const renderUploadCard = (title, desc, category) => {
      const existing = existingCloudFiles[category] || [];
      const canCopy = docType === 'pb' && availablePzFiles[category] && existing.length === 0;
      const isCopied = selectedPzCopies[category] || false;
      return (
          <UploadCard 
              key={category}
              title={title} 
              desc={desc} 
              files={files[category] || []} 
              existing={existing} 
              onUpload={e => handleFileChange(e, category)} 
              onRemove={i => setFiles({...files, [category]: files[category].filter((_,idx)=>idx!==i)})} 
              fileStatuses={fileStatuses} 
              onSimulateUpload={(f) => handleRealUpload(f, category)}
              canCopy={canCopy}
              isCopied={isCopied}
              onToggleCopy={() => setSelectedPzCopies(prev => ({...prev, [category]: !prev[category]}))}
              isAdmin={user?.email === 'admin'}
              canDeleteExisting={user?.email === 'admin' || !isNewApplication}
              verifiedFiles={verifiedFiles[docType] || {}}
              onToggleVerify={toggleVerifyFile}
              onSaveVerify={saveVerificationFile}
              onDeleteExisting={(fname) => requestDeleteFile(category, fname)}
              onViewFile={(fname) => openFile(fname)}
          />
      );
  };

  const saveNewRemark = async () => {
      if (!remarksModal.newText.trim()) return;
      const reqId = editingRequest?.ID;
      if (!reqId) return;

      const history = Array.isArray(fileComments[docType]?.general?.comment) ? fileComments[docType].general.comment : [];
      
      const newHistory = [...history, {
          date: new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
          text: remarksModal.newText.trim(),
          resolved: false
      }];

      const payload = {
          id: reqId,
          docType,
          filename: 'general',
          comment: newHistory,
          status: 'needs_fix'
      };

      try {
          const res = await authFetch('/api/requests/file-comment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          if (res.ok) {
              setFileComments(prev => ({
                  ...prev,
                  [docType]: {
                      ...(prev[docType] || {}),
                      'general': {
                          ...((prev[docType] || {})['general'] || {}),
                          ...payload,
                          expertUnread: false
                      }
                  }
              }));
              setRemarksModal({ show: true, adding: false, newText: '' });
          }
      } catch (e) {
          console.error('Save remark failed:', e);
      }
  };

  const toggleResolveRemark = async (index) => {
      const isAdmin = user?.email === 'admin';
      const history = Array.isArray(fileComments[docType]?.general?.comment) ? [...fileComments[docType].general.comment] : [];
      if (!history[index]) return;
      
      history[index] = { ...history[index], resolved: !history[index].resolved };

      const payload = {
          id: editingRequest?.ID,
          docType,
          filename: 'general',
          comment: history,
          status: 'needs_fix'
      };

      const resolvedCount = history.filter(h => h.resolved).length;
      if (!isAdmin) {
          payload.userReply = `Устранено: ${resolvedCount}`;
      }

      try {
          const res = await authFetch('/api/requests/file-comment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          if (res.ok) {
              setFileComments(prev => ({
                  ...prev,
                  [docType]: {
                      ...(prev[docType] || {}),
                      'general': {
                          ...((prev[docType] || {})['general'] || {}),
                          ...payload,
                          expertUnread: !isAdmin
                      }
                  }
              }));
          }
      } catch(e) {
          console.error('Toggle resolve failed:', e);
      }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-regdoc-grey overflow-hidden max-w-2xl mx-auto relative min-h-[500px]">

      {remarksModal.show && (
        <div className="absolute inset-0 bg-regdoc-navy/80 backdrop-blur-sm z-[250] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-[32px] p-6 sm:p-8 w-full max-w-md shadow-2xl flex flex-col border border-regdoc-grey max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 shrink-0">
                <h3 className="text-xl font-bold text-regdoc-navy leading-none flex items-center gap-2"><MessageCircle size={22} className="text-regdoc-cyan"/> Замечания по разделу</h3>
                <button onClick={() => setRemarksModal({...remarksModal, show: false})} className="p-2 bg-regdoc-grey/40 text-regdoc-navy/60 hover:bg-regdoc-grey hover:text-regdoc-navy rounded-xl transition-all"><X size={20}/></button>
            </div>

            <div className="overflow-y-auto flex-1 mb-6 space-y-3 pr-1 minimal-scrollbar">
                {Array.isArray(fileComments[docType]?.general?.comment) && fileComments[docType].general.comment.length > 0 ? (
                    fileComments[docType].general.comment.map((r, i) => (
                        <div key={i} className={`p-4 rounded-2xl border shadow-sm animate-in slide-in-from-bottom-2 ${r.resolved ? 'bg-regdoc-mist border-regdoc-cyan/30' : 'bg-red-50 border-red-100'}`}>
                            <div className={`text-[10px] font-bold mb-1.5 flex justify-between items-center uppercase tracking-widest ${r.resolved ? 'text-regdoc-teal' : 'text-red-400'}`}>
                                <span>Замечание №{i+1}</span>
                                <div className="flex items-center gap-2 pl-2">
                                    <span className="hidden sm:inline">{r.date}</span>
                                    <span className="sm:hidden text-[8px]">{r.date.split(',')[0]}</span>
                                    <label className={`flex items-center gap-1 cursor-pointer select-none ml-1 sm:ml-2 px-2 py-1 rounded-full transition-all ${r.resolved ? 'bg-regdoc-teal text-white' : 'bg-white border text-red-500 border-red-200 hover:bg-red-100'}`}>
                                        <input type="checkbox" checked={!!r.resolved} onChange={() => toggleResolveRemark(i)} className="hidden" />
                                        <Check size={12} strokeWidth={3}/>
                                        <span className="text-[9px]">{r.resolved ? 'Отработано' : 'Устранить'}</span>
                                    </label>
                                </div>
                            </div>
                            <p className={`text-sm font-bold whitespace-pre-wrap leading-relaxed mt-2 ${r.resolved ? 'text-regdoc-navy/60 line-through decoration-regdoc-teal/40 opacity-80' : 'text-red-600'}`}>{r.text}</p>
                        </div>
                    ))
                ) : (
                    <div className="text-center p-6 text-regdoc-navy/40 font-bold text-sm bg-regdoc-grey/30 rounded-2xl border border-dashed border-regdoc-grey">Замечаний от эксперта пока нет.</div>
                )}
            </div>

            <div className="shrink-0 mt-auto">
                {user?.email === 'admin' ? (
                    remarksModal.adding ? (
                        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-regdoc-cyan shadow-sm flex flex-col gap-3 animate-in fade-in">
                            <textarea 
                                className="w-full p-3 bg-regdoc-mist/30 border border-regdoc-grey rounded-xl outline-none focus:border-regdoc-cyan focus:bg-white text-sm h-28 resize-none font-medium text-regdoc-navy transition-all" 
                                placeholder="Новое замечание..."
                                value={remarksModal.newText}
                                onChange={e => setRemarksModal({...remarksModal, newText: e.target.value})}
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <button onClick={() => setRemarksModal({...remarksModal, adding: false, newText: ''})} className="flex-1 py-3 bg-regdoc-grey text-regdoc-navy/60 hover:text-regdoc-navy font-bold rounded-xl text-sm transition-all outline-none">Отмена</button>
                                <button onClick={saveNewRemark} className="flex-1 py-3 bg-regdoc-cyan text-white font-bold rounded-xl text-sm shadow-md hover:bg-regdoc-teal transition-all outline-none">Сохранить</button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setRemarksModal({...remarksModal, adding: true})} className="w-full py-4 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-200 hover:bg-red-100 hover:text-red-600 transition-all outline-none flex items-center justify-center gap-2">
                            <PlusCircle size={18} strokeWidth={2.5}/> Добавить замечание
                        </button>
                    )
                ) : null}
            </div>
          </div>
        </div>
      )}

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
            <p className="text-regdoc-navy/55 text-sm mb-8">Вы хотите завершить отправку (сохранить загруженные файлы) или отменить и полностью удалить всю папку с сервера?</p>
            <div className="space-y-3">
                <button onClick={() => setShowExitPrompt(false)} className="w-full py-4 bg-regdoc-cyan text-white font-bold rounded-2xl hover:bg-regdoc-teal transition-all">Завершить отправку</button>
                <button onClick={() => setShowExitPrompt(false)} className="w-full py-4 bg-regdoc-grey text-regdoc-navy/65 font-bold rounded-2xl hover:bg-regdoc-grey/80 transition-all">Назад</button>
                <button onClick={handleAbortAndClean} disabled={isSubmitting} className="w-full py-4 bg-red-50 text-red-600 font-bold rounded-2xl hover:bg-red-100 transition-all">{isSubmitting ? <Loader2 className="animate-spin mx-auto" /> : "Удалить заявку и выйти"}</button>
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
            <button onClick={finishFlow} className="w-full py-4 bg-regdoc-cyan text-white font-bold rounded-2xl shadow-lg shadow-regdoc-navy/25 hover:bg-regdoc-teal transition-colors">Отлично</button>
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
          <div key={s.id} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${currentStep >= s.id ? 'bg-regdoc-orange border-regdoc-orange text-white' : 'bg-white border-regdoc-grey text-regdoc-navy/35'}`}>
            {currentStep > s.id ? <Check size={14} /> : s.id}
          </div>
        ))}
      </div>

      <div className="p-4 sm:p-8">
        
        {currentStep >= 3 && (
            <div className="bg-regdoc-mist/30 border border-regdoc-cyan/20 rounded-2xl p-4 sm:p-5 mb-5 sm:mb-6 flex flex-col sm:flex-row justify-between items-start gap-4">
                <div>
                    <div className="text-[10px] sm:text-[11px] font-bold text-regdoc-navy/45 uppercase tracking-wider mb-1 sm:mb-1.5">
                        {docType === 'pz' ? 'Заявка на Предварительное заключение' : 'Заявка на Протокол безопасности'}
                    </div>
                    <div className="font-bold text-regdoc-navy text-sm sm:text-base leading-tight">Гос. номер: <span className="text-regdoc-cyan tracking-wider">{formData.licensePlate}</span></div>
                    <div className="text-[11px] sm:text-xs text-regdoc-navy/70 leading-tight mt-1">ФИО: {formData.fullName || 'Не указано'}</div>
                </div>
                {(user?.email === 'admin' || (Array.isArray(fileComments[docType]?.general?.comment) && fileComments[docType].general.comment.length > 0)) && (() => {
                    const comments = Array.isArray(fileComments[docType]?.general?.comment) ? fileComments[docType].general.comment : [];
                    const hasUnresolved = comments.some(c => !c.resolved);
                    const countUnresolved = comments.filter(c => !c.resolved).length;
                    const resolvedCount = comments.filter(c => c.resolved).length;
                    
                    const btnClass = hasUnresolved && comments.length > 0 
                        ? 'bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 hover:text-red-600' 
                        : (comments.length > 0 ? 'bg-regdoc-mist text-regdoc-teal border border-regdoc-cyan hover:bg-regdoc-cyan/20' : 'bg-white text-regdoc-navy/60 border border-regdoc-grey hover:border-regdoc-cyan hover:text-regdoc-cyan');

                    return (
                        <button 
                            onClick={() => setRemarksModal({ show: true, adding: false, newText: '' })} 
                            className={`flex flex-col items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-bold text-[10px] sm:text-[11px] transition-all tracking-wider shadow-sm uppercase outline-none shrink-0 ${btnClass}`}
                        >
                            <div className="flex items-center gap-2">
                                <MessageCircle size={16} strokeWidth={2.5}/> Замечания
                                {countUnresolved > 0 && <span className="bg-red-500 text-white rounded-full px-2 py-0.5 text-[10px] leading-none">{countUnresolved}</span>}
                                {countUnresolved === 0 && comments.length > 0 && <CheckCircle2 size={16} className="text-regdoc-teal"/>}
                            </div>
                            {user?.email === 'admin' && resolvedCount > 0 && (
                                <div className="text-[9px] text-regdoc-teal leading-tight capitalize-first px-2 rounded-md bg-white border border-regdoc-cyan/30 mt-0.5">Устранено: {resolvedCount}</div>
                            )}
                        </button>
                    );
                })()}
            </div>
        )}

        {currentStep === 1 && (
            <div className="space-y-6 animate-in slide-in-from-bottom-2">
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
          <div className="space-y-2 sm:space-y-4 animate-in slide-in-from-bottom-2">
            <h3 className="font-bold text-lg text-regdoc-navy">Загрузите фотографии или PDF</h3>
            
            <div className="bg-regdoc-mist p-3 rounded-2xl flex gap-3 text-regdoc-teal text-xs border border-regdoc-cyan/25">
              <Info size={16} className="shrink-0 mt-0.5 text-regdoc-cyan" />
              <p>Ограничение по размеру одного файла — <b>не более 5 МБ</b>.</p>
            </div>
            
            {docType === 'pz' && clientType === 'individual' && (
                <>
                    {renderUploadCard("ПТС / ЭПТС", "Одним файлом", "pts")}
                    {renderUploadCard("СРТС", "Одним файлом", "sts")}
                    {renderUploadCard("Паспорт собственника", "2 разворота", "passport")}
                    {renderUploadCard("СНИЛС", "Скан или четкое фото", "snils")}
                </>
            )}

            {docType === 'pz' && clientType === 'legal' && (
                <>
                    {renderUploadCard("Выписка из ЕГРН", "Если собственник юр. лицо", "egrn")}
                    {renderUploadCard("Паспорт", "Представителя+доверенность или руководителя", "passport")}
                    {renderUploadCard("ПТС / ЭПТС", "Одним файлом", "pts")}
                    {renderUploadCard("СРТС", "Одним файлом", "sts")}
                </>
            )}

            {docType === 'pb' && (
                <>
                    {renderUploadCard("ПТС / ЭПТС", "Одним файлом", "pts")}
                    {renderUploadCard("СРТС", "Одним файлом", "sts")}
                    {renderUploadCard("Паспорт", "Собственника", "passport")}
                    {renderUploadCard("СНИЛС", "Скан или четкое фото", "snils")}
                    {renderUploadCard("Паспорт на баллон", "Одним файлом", "balloon_passport")}
                    {renderUploadCard("Акт опрессовки", "Если баллон старше 2х лет", "act_opresovki")}
                    {renderUploadCard("Сертификат ГБО", "На оборудование", "cert_gbo")}
                    {renderUploadCard("Сертификат баллона", "На баллон", "cert_balloon")}
                    {renderUploadCard("Предварительное заключение", "Одним файлом", "pte")}
                    {renderUploadCard("Заявление декларация", "Подписанная", "zd")}
                    {renderUploadCard("Форма 207", "Одним файлом", "form207")}
                    {renderUploadCard("Заявление в ГИБДД", "Подписанное", "gibdd_zayavlenie")}
                </>
            )}
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-2 sm:space-y-4 animate-in slide-in-from-bottom-2">
            {docType === 'pz' ? (
                <>
                    <div className="flex justify-between items-center mb-2 sm:mb-4">
                        <h3 className="font-bold text-base sm:text-lg text-regdoc-navy">Тип переоборудования</h3>
                        {hasExistingDescription && !isDescriptionEditable && (
                            <button 
                                onClick={() => setIsDescriptionEditable(true)}
                                className="px-4 py-1.5 bg-regdoc-grey text-regdoc-navy/65 font-bold rounded-xl shadow-sm hover:bg-regdoc-grey/80 transition-all text-[11px] uppercase tracking-wider"
                            >
                                Изменить
                            </button>
                        )}
                    </div>
                    
                    {(!hasExistingDescription || isDescriptionEditable) && (
                        <div className="bg-regdoc-grey/25 p-4 rounded-2xl border border-regdoc-grey mb-3 font-sans animate-in slide-in-from-top-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <div className="font-bold text-regdoc-navy mb-2 text-[10px] uppercase tracking-widest text-regdoc-navy/60">Пропан</div>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="radio" name="gbo_opt" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={gboOption==='install_propan'} onChange={() => setGboOption('install_propan')} />
                                            <span className={`text-sm ${gboOption==='install_propan'?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Установка ГБО Пропан</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="radio" name="gbo_opt" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={gboOption==='dismantle_propan'} onChange={() => setGboOption('dismantle_propan')} />
                                            <span className={`text-sm ${gboOption==='dismantle_propan'?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Демонтаж ГБО Пропан</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="radio" name="gbo_opt" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={gboOption==='gasdiesel_propan'} onChange={() => setGboOption('gasdiesel_propan')} />
                                            <span className={`text-sm ${gboOption==='gasdiesel_propan'?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Газодизель ГБО Пропан</span>
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <div className="font-bold text-regdoc-navy mb-2 text-[10px] uppercase tracking-widest text-regdoc-navy/60">Метан</div>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="radio" name="gbo_opt" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={gboOption==='install_metan'} onChange={() => setGboOption('install_metan')} />
                                            <span className={`text-sm ${gboOption==='install_metan'?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Установка ГБО Метан</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="radio" name="gbo_opt" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={gboOption==='dismantle_metan'} onChange={() => setGboOption('dismantle_metan')} />
                                            <span className={`text-sm ${gboOption==='dismantle_metan'?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Демонтаж ГБО Метан</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="radio" name="gbo_opt" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={gboOption==='gasdiesel_metan'} onChange={() => setGboOption('gasdiesel_metan')} />
                                            <span className={`text-sm ${gboOption==='gasdiesel_metan'?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Газодизель ГБО Метан</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <hr className="border-regdoc-grey/80 my-3" />
                            <div>
                                <div className="font-bold text-regdoc-navy mb-2 text-[10px] uppercase tracking-widest text-regdoc-navy/60">Дополнительно</div>
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input type="checkbox" className="w-4 h-4 accent-regdoc-orange cursor-pointer" checked={addTsu} onChange={(e) => setAddTsu(e.target.checked)} />
                                    <span className={`text-sm ${addTsu?'font-bold text-regdoc-navy':'text-regdoc-navy/70 group-hover:text-regdoc-navy'}`}>Установка ТСУ</span>
                                </label>
                            </div>
                        </div>
                    )}

                    <textarea 
                        className={`w-full h-36 p-5 rounded-2xl outline-none focus:border-regdoc-cyan leading-relaxed transition-all text-sm shrink-0 ${!isDescriptionEditable ? 'bg-regdoc-grey/50 border border-regdoc-grey text-regdoc-navy/40 cursor-not-allowed' : 'bg-white border border-regdoc-grey text-regdoc-navy'}`} 
                        value={formData.conversionType} 
                        onChange={e => setFormData({...formData, conversionType: e.target.value})} 
                        disabled={!isDescriptionEditable}
                    />
                </>
            ) : (
                <>
                    <h3 className="font-bold text-base sm:text-lg text-regdoc-navy mb-2 sm:mb-4">Фотографии ТС</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {renderUploadCard("Фото ТС слева", "", "photo_left")}
                        {renderUploadCard("Фото ТС справа", "", "photo_right")}
                        {renderUploadCard("Фото ТС сзади", "", "photo_rear")}
                        {renderUploadCard("Фото ТС спереди", "", "photo_front")}
                        {renderUploadCard("Капот открыт", "", "photo_hood")}
                        {renderUploadCard("VIN / номер шасси", "В 3-х местах", "photo_vin")}
                        {renderUploadCard("Номер кузова", "", "photo_kuzov")}
                        {renderUploadCard("Табличка идентификации", "", "photo_tablichka")}
                        {renderUploadCard("Место баллона", "", "photo_balloon_place")}
                        {renderUploadCard("Табличка баллона", "", "photo_balloon_tablichka")}
                        {renderUploadCard("Вент. каналы", "Если баллон в багажнике", "photo_vent")}
                        {renderUploadCard("Мульт с катушкой", "", "photo_mult")}
                        {renderUploadCard("Редуктор", "", "photo_reduktor")}
                        {renderUploadCard("ЭБУ", "", "photo_ebu")}
                        {renderUploadCard("Форсунки", "", "photo_forsunki")}
                        {renderUploadCard("ВЗУ", "", "photo_vzu")}
                    </div>
                </>
            )}
          </div>
        )}

        <div className="mt-6 sm:mt-8 flex flex-col gap-3 sm:gap-4">
          <div className="flex gap-2 sm:gap-3">
            {currentStep > 1 && currentStep < 5 && (
              <button onClick={() => {
                  if (currentStep === 4 && isAnyFileUploading) {
                      return showAlert("Загрузка файлов", "Пожалуйста, дождитесь окончания загрузки файлов перед переходом на другой этап.", "info");
                  }
                  setCurrentStep(prev => prev - 1);
              }} className="px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-regdoc-grey font-bold text-sm sm:text-base text-regdoc-navy/50 hover:bg-regdoc-grey/40 transition-all">Назад</button>
            )}

            {currentStep === 5 && (
              <button onClick={() => { setCurrentStep(prev => prev - 1); }} className="px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-regdoc-grey font-bold text-sm sm:text-base text-regdoc-navy/50 hover:bg-regdoc-grey/40 transition-all">Назад</button>
            )}

            <button onClick={handleNextStep} disabled={isSubmitting} className="flex-1 py-3 sm:py-4 bg-regdoc-cyan text-white font-bold text-sm sm:text-base rounded-xl sm:rounded-2xl shadow-lg shadow-regdoc-navy/10 hover:bg-regdoc-teal transition-colors flex items-center justify-center disabled:opacity-60">
              {isSubmitting ? <Loader2 className="animate-spin" /> : (currentStep === 5 ? 'Отправить документы' : 'Далее')}
            </button>
          </div>
          
          {currentStep === 5 && isNewApplication && (
              <button onClick={() => setShowExitPrompt(true)} className="mx-auto px-6 py-2.5 rounded-2xl border border-red-200 bg-red-50 text-sm font-bold text-red-500 hover:bg-red-100 transition-all">Отменить</button>
          )}
        </div>
      </div>
      
      {fileToDelete && (
        <div className="fixed inset-0 bg-regdoc-navy/80 backdrop-blur-sm z-[250] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-[32px] p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl border border-red-100 animate-in zoom-in-95 duration-200">
              <Trash2 className="w-16 h-16 mx-auto mb-4 sm:mb-6 text-red-500" />
              <h3 className="text-lg sm:text-xl font-bold text-regdoc-navy mb-2 sm:mb-3">Удалить файл?</h3>
              <p className="text-xs sm:text-sm text-regdoc-navy/70 mb-6 sm:mb-8 px-2 font-medium">
                Вы уверены, что хотите удалить файл <strong>{fileToDelete.filename}</strong>?<br/><br/>Это действие нельзя отменить.
              </p>
              <div className="flex gap-3">
                  <button onClick={() => setFileToDelete(null)} className="flex-1 py-3 sm:py-3.5 bg-regdoc-grey text-regdoc-navy font-bold rounded-2xl hover:bg-gray-300 transition-all text-sm outline-none">Отмена</button>
                  <button onClick={confirmDeleteFileOnServer} className="flex-1 py-3 sm:py-3.5 bg-red-500 text-white font-bold rounded-2xl hover:bg-red-600 transition-all text-sm shadow-md outline-none border border-red-600">Удалить</button>
              </div>
            </div>
        </div>
      )}


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

function UploadCard({ title, desc, category, files, existing, onUpload, onRemove, fileStatuses, onSimulateUpload, canCopy, isCopied, onToggleCopy, isAdmin, canDeleteExisting, verifiedFiles, onToggleVerify, onSaveVerify, onDeleteExisting, onViewFile, fileComments, onOpenChat }) {
  return (
    <div className="border border-regdoc-grey rounded-2xl p-2.5 sm:p-4 bg-regdoc-grey/35 h-full flex flex-col">
      <div className="flex justify-between items-start mb-2 sm:mb-3">
        <div>
          <div className="font-bold text-regdoc-navy text-xs sm:text-sm leading-none">{title}</div>
          {desc && <div className="text-[9px] sm:text-[10px] text-regdoc-navy/45 uppercase font-bold mt-1 tracking-tight">{desc}</div>}
          
          {/* Copy toggle moved to inline row */}

        </div>
        <div className="flex gap-2 shrink-0 ml-2">
            {(isAdmin || fileComments?.[`@category_${category}`]) && onOpenChat && (
                <button 
                  onClick={() => onOpenChat(category, true)} 
                  className={`p-2 sm:p-2.5 rounded-xl shadow-sm border ${
                      fileComments?.[`@category_${category}`]?.status === 'needs_fix' 
                      ? 'bg-amber-100 border-amber-400 text-amber-600 hover:bg-amber-200' 
                      : 'bg-white border-regdoc-grey text-regdoc-navy/50 hover:text-regdoc-cyan'
                  } active:scale-95 transition-all relative outline-none`}
                  title="Замечания к этому разделу документов"
                >
                    <MessageCircle size={18} className="sm:w-5 sm:h-5" />
                    {((fileComments?.[`@category_${category}`]?.expertUnread && isAdmin) || (fileComments?.[`@category_${category}`]?.status === 'needs_fix' && !fileComments?.[`@category_${category}`]?.userReply && !isAdmin)) && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-white shadow-sm"></span>
                    )}
                </button>
            )}
            <label className="bg-white p-2 sm:p-2.5 rounded-xl shadow-sm border border-regdoc-grey cursor-pointer text-regdoc-navy/50 hover:text-regdoc-cyan active:scale-95 transition-all"><Paperclip size={18} className="sm:w-5 sm:h-5" /><input type="file" multiple className="hidden" onChange={onUpload} accept="image/*,.pdf" /></label>
            <label className="sm:hidden bg-white p-2 rounded-xl shadow-sm border border-regdoc-grey cursor-pointer text-regdoc-cyan active:scale-95 transition-all"><Camera size={18} /><input type="file" className="hidden" onChange={onUpload} accept="image/*" capture="environment" /></label>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-auto">
        
        {canCopy && (
             <div className={`bg-white border p-1.5 sm:p-2 rounded-xl flex items-center gap-2 sm:gap-3 shadow-sm animate-in zoom-in-95 w-full transition-all flex-wrap sm:flex-nowrap ${isCopied ? 'border-regdoc-orange' : 'border-regdoc-cyan/25'}`}>
                 <div className="flex items-center gap-1.5 shrink-0">
                     <CheckCircle2 size={16} className={isCopied ? 'text-regdoc-orange' : 'text-regdoc-navy/30'} />
                     <span className="font-medium text-regdoc-navy text-[11px] sm:text-xs">взять из ПЗ</span>
                 </div>
                 
                 <div className="flex items-center gap-2 shrink-0 cursor-pointer group" onClick={onToggleCopy}>
                    <div className={`w-8 h-4 sm:w-10 sm:h-5 rounded-full transition-colors flex items-center px-0.5 ${isCopied ? 'bg-regdoc-orange' : 'bg-regdoc-grey group-hover:bg-regdoc-cyan/50'}`}>
                        <div className={`w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-white shadow-sm transition-transform ${isCopied ? 'translate-x-4 sm:translate-x-5' : 'translate-x-0'}`}></div>
                    </div>
                 </div>

                 {isCopied && (
                     <div className="bg-regdoc-orange/10 text-regdoc-orange px-2 py-1 rounded-lg text-[9px] sm:text-[10px] font-bold truncate animate-in fade-in slide-in-from-left-2 w-full sm:w-auto mt-1 sm:mt-0">
                         документ будет загружен из документов для ПЗ
                     </div>
                 )}
             </div>
        )}

        {existing && existing.map((name, i) => {
            const isVerified = verifiedFiles[name] === true;

            return (
                <div key={i} className={`p-1.5 sm:p-1.5 sm:pl-3 rounded-xl flex flex-col sm:flex-row sm:items-center gap-2.5 animate-in zoom-in-95 w-full justify-between items-start border ${isVerified ? 'bg-regdoc-mist border-regdoc-cyan/30' : 'bg-white border-regdoc-grey shadow-sm hover:shadow-md transition-shadow'}`}>
                    <div className="flex items-center gap-2 flex-1 w-full overflow-hidden">
                        <FileText size={16} className={isVerified ? 'text-regdoc-cyan shrink-0' : 'text-regdoc-navy/40 shrink-0'} />
                        <button onClick={() => onViewFile(name)} className="flex items-center text-left flex-1 min-w-0 hover:underline decoration-regdoc-cyan outline-none">
                            <span className={`text-[12px] font-bold truncate ${isVerified ? 'text-regdoc-teal' : 'text-regdoc-navy/80'}`}>{name}</span>
                        </button>
                    </div>

                    <div className="flex sm:justify-end gap-2 w-full sm:w-auto mt-0.5 sm:mt-0 items-stretch shrink-0">
                        {isAdmin && (
                            <div className="flex bg-gray-50 border border-gray-200 rounded-lg overflow-hidden shrink-0 shadow-sm transition-all hover:border-gray-300 group focus-within:ring-2 focus-within:ring-regdoc-cyan">
                                <label className={`flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-1.5 cursor-pointer transition-all ${isVerified ? 'bg-regdoc-teal text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'} outline-none flex-1 sm:flex-none`}>
                                    <input type="checkbox" checked={isVerified} onChange={() => onToggleVerify(name)} className="hidden" />
                                    <Check size={16} strokeWidth={isVerified ? 3 : 2.5} />
                                    <span className="text-[10px] font-bold tracking-wider leading-none mr-0.5 select-none uppercase">Проверено</span>
                                </label>
                                
                                <button 
                                    onClick={() => onSaveVerify(name)}
                                    className={`px-3 py-2 sm:py-1.5 flex items-center justify-center transition-all border-l ${isVerified ? 'border-regdoc-teal/20 bg-regdoc-teal text-white hover:brightness-110' : 'border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-regdoc-navy'} outline-none relative hover-active-scale`}
                                    title="Сохранить отметку о проверке этого файла"
                                >
                                    <Save size={16} />
                                </button>
                            </div>
                        )}

                        {canDeleteExisting && (
                            <button onClick={() => onDeleteExisting(name)} className="px-4 py-2 sm:py-1.5 text-red-500 bg-red-50 hover:bg-red-500 hover:text-white border border-red-100 uppercase rounded-lg transition-all text-[10px] font-bold shrink-0 shadow-sm outline-none w-full sm:w-auto text-center active:scale-95 tracking-wide flex-1 sm:flex-none flex items-center justify-center">Удалить</button>
                        )}
                    </div>
                </div>
            );
        })}
        {files.map((f, i) => {
            const key = f.name + f.size;
            const status = fileStatuses && fileStatuses[key] ? fileStatuses[key] : { state: 'pending', progress: 0 };
            return (
                <div key={i} className="bg-white border border-regdoc-cyan/25 p-1.5 sm:p-2 rounded-xl flex flex-col gap-1 sm:gap-1.5 shadow-sm animate-in zoom-in-95 min-w-[120px] sm:min-w-[140px] flex-1">
                    <div className="flex items-center justify-between gap-1 sm:gap-2">
                        <span className="truncate max-w-[90px] sm:max-w-[120px] font-medium text-regdoc-navy text-[11px] sm:text-xs">{f.name}</span>
                        <div className="flex items-center gap-2 sm:gap-4 shrink-0 ml-1 sm:ml-3">
                            {status.state === 'pending' && (
                                <button onClick={() => onSimulateUpload(f)} className="text-white bg-regdoc-cyan hover:bg-regdoc-teal rounded-lg p-2 sm:p-3 transition-all shadow-md active:scale-95 flex items-center justify-center" title="Загрузить на сервер">
                                    <Check size={16} strokeWidth={4} className="sm:w-5 sm:h-5" />
                                </button>
                            )}
                            {status.state === 'done' && (
                                <CheckCircle2 size={20} className="text-regdoc-cyan sm:w-6 sm:h-6" />
                            )}
                            {status.state !== 'done' && status.state !== 'uploading' && (
                                <button onClick={() => onRemove(i)} className="text-red-500 hover:text-white bg-red-50 hover:bg-red-500 font-black p-1.5 px-3 sm:p-3 sm:px-5 rounded-lg transition-all text-xs sm:text-base shadow-sm active:scale-95 flex items-center justify-center" title="Удалить">✕</button>
                            )}
                        </div>
                    </div>
                    {status.state === 'uploading' && (
                        <div className="w-full bg-regdoc-grey h-1 sm:h-1.5 rounded-full overflow-hidden mt-1">
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