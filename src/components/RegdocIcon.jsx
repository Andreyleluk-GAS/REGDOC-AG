import React from 'react';

const IDS = {
  carWrench: 'regdoc-car-wrench',
  docCheck: 'regdoc-doc-check',
  gears: 'regdoc-gears',
  folderDoc: 'regdoc-folder-doc',
  toggle: 'regdoc-toggle',
};

/**
 * Sprite icon from /regdoc-icons.svg (line-art, navy + cyan accent).
 */
export default function RegdocIcon({ name, className = 'w-6 h-6 text-regdoc-navy', title }) {
  const id = IDS[name];
  if (!id) return null;
  return (
    <svg className={className} role={title ? 'img' : 'presentation'} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <use href={`/regdoc-icons.svg#${id}`} />
    </svg>
  );
}
