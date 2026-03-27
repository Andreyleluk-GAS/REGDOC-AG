export const enToRuMap = {
    'q':'й', 'w':'ц', 'e':'у', 'r':'к', 't':'е', 'y':'н', 'u':'г', 'i':'ш', 'o':'щ', 'p':'з', '[':'х', ']':'ъ',
    'a':'ф', 's':'ы', 'd':'в', 'f':'а', 'g':'п', 'h':'р', 'j':'о', 'k':'л', 'l':'д', ';':'ж', "'":'э',
    'z':'я', 'x':'ч', 'c':'с', 'v':'м', 'b':'и', 'n':'т', 'm':'ь', ',':'б', '.':'ю', '`':'ё',
    'Q':'Й', 'W':'Ц', 'E':'У', 'R':'К', 'T':'Е', 'Y':'Н', 'U':'Г', 'I':'Ш', 'O':'Щ', 'P':'З', '{':'Х', '}':'Ъ',
    'A':'Ф', 'S':'Ы', 'D':'В', 'F':'А', 'G':'П', 'H':'Р', 'J':'О', 'K':'Л', 'L':'Д', ':':'Ж', '"':'Э',
    'Z':'Я', 'X':'Ч', 'C':'С', 'V':'М', 'B':'И', 'N':'Т', 'M':'Ь', '<':'Б', '>':'Ю', '~':'Ё'
};

export const formatFIO = (val) => {
    let translated = '';
    for(let i=0; i<val.length; i++) {
        translated += enToRuMap[val[i]] || val[i];
    }
    let clean = translated.replace(/[^А-Яа-яЁё\s\-]/g, ''); // Added hyphen just in case, though user didn't ask. User said "Russian". 
    // Wait, user said exactly: "Не важно какая раскладка пишется всегда на русском. Первая буквав влове всегда заглавная все следующие прописные. Просле введения пробела Новое слово тоже начинается в заглавной и далее все прописные."
    
    // Split by space and handle capitalization
    let formatted = clean.split(' ').map(word => {
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
    
    return formatted;
};

export const formatPlate = (plate) => {
    if (!plate) return '';
    const clean = plate.replace(/[^А-ЯЁA-Z0-9]/gi, '').toUpperCase();
    const match = clean.match(/^([А-ЯЁA-Z])(\d{3})([А-ЯЁA-Z]{2})(\d{2,3})$/i);
    if (match) {
        return `${match[1]} ${match[2]} ${match[3]} / ${match[4]}`;
    }
    return plate;
};
