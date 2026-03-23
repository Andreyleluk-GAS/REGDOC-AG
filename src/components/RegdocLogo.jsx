import React from 'react';

/** Текстовый логотип: REG (navy) + DOC (cyan), без пиктограммы. */
export default function RegdocLogo({ className = '', showTagline = true, size = 'default' }) {
  const titleClass = size === 'compact' ? 'text-2xl' : 'text-3xl sm:text-4xl';
  return (
    <div className={`min-w-0 ${className}`}>
      <div className={`font-display font-bold tracking-tight leading-none ${titleClass}`}>
        <span className="text-regdoc-navy">REG</span>
        <span className="text-regdoc-cyan">DOC</span>
      </div>
      {showTagline && (
        <p className="mt-1 text-[10px] font-semibold text-regdoc-navy/70 uppercase tracking-[0.12em]">
          Automatic registration service
        </p>
      )}
    </div>
  );
}
