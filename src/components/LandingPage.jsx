import React from 'react';
import RegdocLogo from './RegdocLogo';

export default function LandingPage({ onRegister, onCabinet }) {
  return (
    <div className="relative bg-white rounded-[32px] shadow-xl border border-regdoc-grey/90 overflow-hidden">
      <div className="relative px-8 pt-8 pb-10 sm:px-12 sm:pt-10 sm:pb-12">
        <div className="flex items-start justify-between gap-4">
          <RegdocLogo size="default" />
        </div>

        <div className="mt-6 sm:mt-8 flex flex-col items-center text-center">
          <img
            src="/regdoc-hero.png"
            alt="REGDOC: автомобиль, шестерня, документ с отметкой"
            className="w-full max-w-lg sm:max-w-2xl h-auto mx-auto mb-6 sm:mb-8 object-contain select-none"
            width={800}
            height={400}
            decoding="async"
          />

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold font-display leading-tight max-w-xl">
            <span className="text-regdoc-navy">Добро пожаловать в </span>
            <span className="text-regdoc-navy">REG</span>
            <span className="text-regdoc-cyan">DOC</span>
          </h1>
          <p className="mt-3 sm:mt-4 text-sm sm:text-base text-regdoc-navy/65 leading-relaxed max-w-lg">
            Автоматизируем подготовку документов для регистрации изменений в ГИБДД.
          </p>
        </div>

        <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
          <button
            type="button"
            onClick={onCabinet}
            className="flex-1 py-4 rounded-2xl border-2 border-regdoc-navy/20 bg-white text-regdoc-navy font-bold text-base hover:border-regdoc-cyan hover:bg-regdoc-mist/50 transition-all"
          >
            Войти
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="flex-1 py-4 rounded-2xl bg-regdoc-cyan text-regdoc-navy font-bold text-base shadow-lg shadow-regdoc-navy/10 hover:bg-regdoc-teal transition-colors"
          >
            Зарегистрироваться
          </button>
        </div>
      </div>
    </div>
  );
}
