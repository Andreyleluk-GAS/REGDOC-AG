/**
 * Общие утилиты для бэкенда
 */

export const normalizePlate = (plate) => {
    if (!plate) return '';
    const map = {'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','Y':'У','X':'Х'};
    return plate.toUpperCase()
        .replace(/[ABEKMHOPCTYX]/g, char => map[char] || char)
        .replace(/[^А-ЯЁA-Z0-9]/g, '');
};

export const normalizeName = (name) => {
    if (!name) return '';
    return name.trim().replace(/\s+/g, '_');
};
