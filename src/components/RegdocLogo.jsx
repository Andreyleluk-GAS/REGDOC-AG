import React from 'react';

/** Логотип: Только текст. */
export default function RegdocLogo({ className = '', size = 'default', showTagline = true }) {
  const containerClass = size === 'compact' ? 'gap-2' : 'gap-3 sm:gap-4';
  const titleClass = size === 'compact' ? 'text-2xl' : 'text-3xl sm:text-4xl';
  
  return (
    <div className={`flex items-center ${containerClass} ${className}`}>
      <div className="min-w-0">
        <div className={`font-display font-bold tracking-tight leading-none ${titleClass}`}>
          <span className="text-regdoc-navy">REG</span>
          <span className="text-regdoc-cyan">DOC</span>
        </div>
        {showTagline && (
          <p className="mt-1 text-[10px] sm:text-[11px] font-bold text-regdoc-navy/70 uppercase tracking-[0.12em]">
            Automatic registration service
          </p>
        )}
      </div>
    </div>
  );
}
