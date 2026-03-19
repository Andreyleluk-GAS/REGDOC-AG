import React from 'react';
import RegistrationFlow from './components/RegistrationFlow';
import { ShieldCheck } from 'lucide-react';

function App() {
  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 font-sans">
      <div className="max-w-2xl mx-auto space-y-6">
        
        {/* Шапка с логотипом и версией (осталась без изменений) */}
        <header className="flex justify-between items-center mb-2">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-slate-900 leading-none">
              REG<span className="text-red-600">DOC</span>
            </h1>
            <p className="text-[10px] font-bold text-green-700 uppercase tracking-[0.1em] mt-1">
              Automatic registration service
            </p>
          </div>
          <div className="bg-slate-200/60 text-slate-500 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider">
            LIVE VERSION
          </div>
        </header>

        {/* Темная карточка */}
        <div className="bg-[#111827] rounded-[32px] p-8 sm:p-10 text-white shadow-xl relative overflow-hidden">
          {/* Контейнер flex для разделения заголовка и бейджа по краям */}
          <div className="flex justify-between items-start mb-4 sm:mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight max-w-[70%]">
              Регистрация изменений в ГИБДД
            </h2>
            
            {/* Надпись ОФИЦИАЛЬНО — перемещена вправо и сделана ЗОЛОТОЙ */}
            <div className="flex items-center gap-1.5 border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 rounded-full flex-shrink-0 mt-1">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
              <span className="text-[10px] sm:text-xs font-bold text-amber-400 uppercase tracking-wider">
                Официально
              </span>
            </div>
          </div>
          
          <p className="text-slate-400 text-sm sm:text-base leading-relaxed max-w-xl">
            Загрузите фото документов, и мы подготовим пакет для внесения изменений в конструкцию ТС.
          </p>
        </div>

        <main>
          {/* Наша рабочая форма */}
          <RegistrationFlow />
        </main>

      </div>
    </div>
  );
}

export default App;