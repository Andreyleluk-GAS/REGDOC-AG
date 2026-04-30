import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import jwt from 'jsonwebtoken';
import authRouter from './authRouter.js';
import { loadRequests, withRequestsLock, getNextId } from './requestsStore.js';
import { normalizePlate, normalizeName } from './utils.js';

// ========== СЛОВАРЬ КАТЕГОРИЙ ДЛЯ КРАСИВОГО ПЕРЕИМЕНОВАНИЯ ФАЙЛОВ ==========
const categoryNames = {
    pts: 'ПТС', sts: 'СРТС', passport: 'Паспорт', snils: 'СНИЛС',
    egrn: 'ЕГРН', balloon_passport: 'Паспорт_баллона',
    act_opresovki: 'Акт_опрессовки', cert_gbo: 'Сертификат_ГБО',
    cert_balloon: 'Сертификат_баллона', pte: 'ПЗ', zd: 'Заявление_декларация',
    form207: 'Форма_207', gibdd_zayavlenie: 'Заявление_в_ГИБДД',
    photo_left: 'Фото_слева', photo_right: 'Фото_справа', photo_rear: 'Фото_сзади',
    photo_front: 'Фото_спереди', photo_hood: 'Под_капотом', photo_vin: 'VIN',
    photo_kuzov: 'Номер_кузова', photo_tablichka: 'Табличка',
    photo_balloon_place: 'Место_баллона', photo_balloon_tablichka: 'Табличка_баллона',
    photo_vent: 'Вент_каналы', photo_mult: 'Мультиклапан', photo_reduktor: 'Редуктор',
    photo_ebu: 'ЭБУ', photo_forsunki: 'Форсунки', photo_vzu: 'ВЗУ'
};

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'regdoc-api' });
});

app.use('/api/auth', authRouter);

// ========== ME (GET CURRENT USER) ==========
app.get('/api/me', async (req, res) => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Не авторизован' });
    const token = h.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const { findUserById } = await import('./db-postgres.js');
        const user = await findUserById(payload.sub);
        if (!user || !user.verified) return res.status(401).json({ error: 'Не авторизован' });
        return res.json({ user: { id: user.id, email: user.email, verified: user.verified, role: user.role || 'user' } });
    } catch {
        return res.status(401).json({ error: 'Не авторизован' });
    }
});

app.post('/api/requests/init', async (req, res) => {
    try {
        const { clientType, fullName, companyName, licensePlate, type_requests, authorEmail, authorName } = req.body;
        if (!fullName || !licensePlate) return res.status(400).json({ success: false, error: 'Не переданы обязательные данные' });

        const now = new Date();
        const ekb = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const getV = (t) => ekb.find(p => p.type === t).value;
        const datePart = `[${getV('year')}.${getV('month')}.${getV('day')}]`;
        const rawName = clientType === 'legal' ? companyName : fullName;
        const namePart = `[${normalizeName(rawName)}]`;
        const platePart = `[${normalizePlate(licensePlate)}]`;
        const allReqs = await loadRequests();
        const nextId = getNextId(allReqs);
        const newFolderName = `${nextId}_${datePart}${namePart}${platePart}`;

        let finalAuthor = 'Системный (не определен)';
        try {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
                if (decoded.email) finalAuthor = decoded.email.toLowerCase();
                else if (decoded.username) finalAuthor = decoded.username;
                else if (decoded.id) finalAuthor = decoded.id;
            }
        } catch (e) { console.log('[/api/requests/init] JWT verification failed:', e.message); }
        if (finalAuthor === 'Системный (не определен)') {
            if (authorEmail && authorEmail.trim()) finalAuthor = authorEmail.toLowerCase();
            else if (authorName && authorName.trim()) finalAuthor = authorName.trim();
        }
        console.log('[INIT] Создание заявки. Автор:', finalAuthor);

        await syncRequestRecord(newFolderName, finalAuthor, type_requests);
        res.status(200).json({ success: true, folderName: newFolderName });
    } catch (error) {
        console.error('[/api/requests/init] Ошибка:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/my-requests', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Не авторизован' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const userEmail = decoded.email.toLowerCase();
        const allRequests = await loadRequests();
        const userReqs = userEmail === 'admin' ? allRequests : allRequests.filter(r => String(r.email || '').toLowerCase() === userEmail);
        res.json(userReqs);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/users/emails', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const allRequests = await loadRequests();
        const emails = [...new Set(allRequests.map(r => r.email).filter(Boolean))];
        res.json(emails);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/edit-fio', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const { id, newFio } = req.body;
        if (!id || !newFio) return res.status(400).json({ error: 'ID or newFio missing' });
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx === -1) throw new Error('Request not found');
            requests[idx].full_name = newFio.trim();
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/delete', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID missing' });
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx > -1) requests.splice(idx, 1);
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/change-email', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const { id, newEmail } = req.body;
        if (!id || !newEmail) return res.status(400).json({ error: 'ID or newEmail missing' });
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx > -1) requests[idx].email = newEmail.toLowerCase();
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/toggle-pz-accepted', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID missing' });
        let newStatus = 'no';
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx === -1) throw new Error('Request not found');
            const current = requests[idx].isPzAccepted === 'yes';
            requests[idx].isPzAccepted = current ? 'no' : 'yes';
            newStatus = requests[idx].isPzAccepted;
        });
        res.json({ success: true, isPzAccepted: newStatus });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/toggle-pb-accepted', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID missing' });
        let newStatus = 'no';
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx === -1) throw new Error('Request not found');
            const current = requests[idx].isPbAccepted === 'yes';
            requests[idx].isPbAccepted = current ? 'no' : 'yes';
            newStatus = requests[idx].isPbAccepted;
        });
        res.json({ success: true, isPbAccepted: newStatus });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/verify-file', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        const { id, docType, filename, verified, isFullyVerified } = req.body;
        if (!id || !docType || !filename) return res.status(400).json({ error: 'Missing parameters' });
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx === -1) throw new Error('Request not found');
            const r = requests[idx];
            if (!r.verified_files) r.verified_files = {};
            if (!r.verified_files[docType]) r.verified_files[docType] = {};
            r.verified_files[docType][filename] = !!verified;
            if (typeof isFullyVerified !== 'undefined') {
                if (!r.verified_sections) r.verified_sections = {};
                r.verified_sections[docType] = !!isFullyVerified;
            }
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/file-comment', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const role = decoded.email === 'admin' ? 'admin' : 'user';
        const { id, docType, filename, comment, status, userReply, expertUnread } = req.body;
        if (!id || !docType || !filename) return res.status(400).json({ error: 'Missing parameters' });
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx === -1) throw new Error('Request not found');
            const r = requests[idx];
            if (role === 'user' && r.email && r.email.toLowerCase() !== decoded.email.toLowerCase()) throw new Error('Forbidden');
            if (!r.file_comments) r.file_comments = {};
            if (!r.file_comments[docType]) r.file_comments[docType] = {};
            const existing = r.file_comments[docType][filename] || {};
            if (role === 'admin') {
                r.file_comments[docType][filename] = {
                    ...existing,
                    status: status !== undefined ? status : existing.status,
                    comment: comment !== undefined ? comment : existing.comment,
                    expertUnread: expertUnread !== undefined ? expertUnread : false
                };
            } else if (role === 'user') {
                r.file_comments[docType][filename] = {
                    ...existing,
                    userReply: userReply !== undefined ? userReply : existing.userReply,
                    expertUnread: true
                };
            }
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/requests/delete-file', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const role = decoded.email === 'admin' ? 'admin' : 'user';
        const { id, docType, filename } = req.body;
        if (!id || !docType || !filename) return res.status(400).json({ error: 'Missing parameters' });
        if (role === 'user') {
            const allReqs = await loadRequests();
            const r = allReqs.find(req => String(req.ID) === String(id));
            if (!r || String(r.email || '').toLowerCase() !== decoded.email.toLowerCase()) return res.status(403).json({ error: 'Forbidden' });
        }
        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx > -1) {
                if (requests[idx].verified_files?.[docType]?.[filename]) {
                    delete requests[idx].verified_files[docType][filename];
                }
            }
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

async function syncRequestRecord(folderName, email, type_requests = null) {
    console.log(`[syncRequestRecord] Folder: ${folderName}, Email: ${email}`);
    const idMatch = folderName.match(/^(\d{4})_/);
    const idFromFolder = idMatch ? idMatch[1] : null;
    const match = folderName.match(/\[(\d{4})\.(\d{2})\.(\d{2})\]\[(.*?)\]\[(.*?)\]/);
    if (!match) { console.warn(`[syncRequestRecord] Failed to parse folder name: ${folderName}`); return; }
    const dateStr = `${match[3]}.${match[2]}.${match[1]}`;
    const fullName = match[4].replace(/_/g, ' ');
    const plate = match[5];
    const status = { type_PZ: 'no', type_PB: 'no', type_PZ_ready: 'no', type_PB_ready: 'no', hasFiles_PZ: 'no', hasFiles_PB: 'no', isVerified_PZ: 'no', isVerified_PB: 'no' };
    await withRequestsLock(async (requests) => {
        const userEmail = email.toLowerCase();
        const plateKey = normalizePlate(plate);
        const nameKey = normalizeName(fullName);
        let idx = -1;
        if (idFromFolder) idx = requests.findIndex(r => String(r.ID) === idFromFolder);
        else idx = requests.findIndex(r => normalizePlate(String(r.car_number || '')) === plateKey && normalizeName(String(r.full_name || '')) === nameKey);
        const record = { DATE: dateStr, full_name: fullName, car_number: plate, email: userEmail, ...status, type_requests: (type_requests !== null) ? type_requests : (idx > -1 ? (requests[idx].type_requests || '') : '') };
        if (idx > -1) { const existingID = requests[idx].ID; requests[idx] = { ...record, ID: existingID }; }
        else requests.push(record);
    });
}

app.get('/api/check-plate', async (req, res) => {
    try {
        const { plate } = req.query;
        if (!plate) return res.status(400).json({ error: 'Номер не указан' });
        const searchPlate = normalizePlate(plate);
        const allRequests = await loadRequests();
        const dbRequest = allRequests.find(r => normalizePlate(String(r.car_number || '')) === searchPlate);
        if (dbRequest) {
            return res.json({
                found: true,
                fullName: dbRequest.full_name || 'Клиент',
                folderName: dbRequest.folder_name || '',
                email: dbRequest.email || '',
                car_number: dbRequest.car_number || '',
                verified_files: dbRequest.verified_files || {},
                file_comments: dbRequest.file_comments || {},
                isPzAccepted: dbRequest.isPzAccepted || 'no',
                isPbAccepted: dbRequest.isPbAccepted || 'no',
                type_requests: dbRequest.type_requests || '',
                DATE: dbRequest.DATE || '',
                ID: dbRequest.ID || ''
            });
        }
        res.json({ found: false });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

async function uploadFileWithRetry(path, buffer) {
    for (let i = 0; i < 3; i++) {
        try { return; } catch (e) { await sleep(1000); }
    }
}

app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        const { step, folderName, clientType, docType, fullName, companyName, licensePlate, conversionType, updateDescription } = req.body;

        if (step === 'sync_request') return res.json({ success: true });
        if (step === 'commit_request') return res.json({ success: true, committed: true });

        if (!folderName) return res.status(400).json({ error: 'folderName missing' });

        if (step === 'delete_folder') return res.json({ success: true });

        const finalPath = `/RegDoc_Заявки/${folderName}/${docType === 'pz' ? 'Для ПЗ' : 'Для ПБ'}`;

        if (step === 'sub_folder') return res.json({ success: true });

        if (!docType) return res.status(400).json({ error: 'docType missing' });

        if (step === 'main_folder') {
            const now = new Date();
            const ekb = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
            const getV = (t) => ekb.find(p => p.type === t).value;
            const datePart = `[${getV('year')}.${getV('month')}.${getV('day')}]`;
            const rawName = clientType === 'legal' ? companyName : fullName;
            const namePart = `[${normalizeName(rawName)}]`;
            const platePart = `[${normalizePlate(licensePlate)}]`;
            const allReqs = await loadRequests();
            const nextId = getNextId(allReqs);
            const newFolderName = `${nextId}_${datePart}${namePart}${platePart}`;
            return res.json({ success: true, folderName: newFolderName });
        }

        if (step === 'single_file') {
            try {
                const targetFolder = `/RegDoc_Заявки/${folderName}`;
                const docTypeLocal = docType;
                if (!req.files || req.files.length === 0) throw new Error("Файл не найден");
                const uploadedFile = req.files[0];
                const category = uploadedFile.fieldname;
                const categoryNamesLocal = {
                    pts: 'ПТС', sts: 'СРТС', passport: 'Паспорт', snils: 'СНИЛС',
                    egrn: 'ЕГРН', balloon_passport: 'Паспорт_баллона',
                    act_opresovki: 'Акт_опрессовки', cert_gbo: 'Сертификат_ГБО',
                    cert_balloon: 'Сертификат_баллона', pte: 'ПЗ', zd: 'Заявление_декларация',
                    form207: 'Форма_207', gibdd_zayavlenie: 'Заявление_в_ГИБДД',
                    photo_left: 'Фото_слева', photo_right: 'Фото_справа', photo_rear: 'Фото_сзади',
                    photo_front: 'Фото_спереди', photo_hood: 'Под_капотом', photo_vin: 'VIN',
                    photo_kuzov: 'Номер_кузова', photo_tablichka: 'Табличка',
                    photo_balloon_place: 'Место_баллона', photo_balloon_tablichka: 'Табличка_баллона',
                    photo_vent: 'Вент_каналы', photo_mult: 'Мультиклапан', photo_reduktor: 'Редуктор',
                    photo_ebu: 'ЭБУ', photo_forsunki: 'Форсунки', photo_vzu: 'ВЗУ'
                };
                let baseName = categoryNamesLocal[category] || category.toUpperCase();
                const ext = uploadedFile.originalname.split('.').pop().toLowerCase();
                const docFolder = docTypeLocal === 'pz' ? 'Для ПЗ' : 'Для ПБ';
                const fullTargetFolder = `${targetFolder}/${docFolder}`;
                const newIndex = 1;
                const finalFileName = `${baseName}_${newIndex}.${ext}`;
                console.log(`[single_file] Saved: ${uploadedFile.originalname} -> ${finalFileName}`);
                return res.status(200).json({ success: true, fileName: finalFileName });
            } catch (err) {
                console.error("🔥 ОШИБКА В single_file:", err.message);
                return res.status(500).json({ error: err.message });
            }
        }

        if (step === 'doc_file' || step === 'save_edit') {
            if (updateDescription !== 'false' && docType === 'pz') {
                const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: "Тип переоборудования:", bold: true, size: 28 })] }), new Paragraph({ children: [new TextRun({ text: conversionType || "", size: 24 })] })] }] });
                const docBuf = await Packer.toBuffer(doc);
                await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
            }
            return res.json({ success: true });
        }

        if (step === 'verify_files') {
            const verifiedFilesStr = req.body.verifiedFiles;
            let verifiedFiles = {};
            if (verifiedFilesStr) { try { verifiedFiles = JSON.parse(verifiedFilesStr); } catch (e) { } }
            try {
                const reqId = folderName.split('_')[0];
                await withRequestsLock(async (requests) => {
                    const idx = requests.findIndex(r => String(r.ID) === String(reqId));
                    if (idx > -1) {
                        if (!requests[idx].verified_files) requests[idx].verified_files = {};
                        requests[idx].verified_files[docType] = verifiedFiles[docType] || {};
                    }
                });
            } catch (e) { console.error('[verify_files] Error:', e.message); }
            return res.json({ success: true });
        }

        res.json({ success: false, error: "Unknown step" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default app;
