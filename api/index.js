import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createClient } from 'webdav';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import jwt from 'jsonwebtoken';
import authRouter from './authRouter.js';
import { loadStore, migrateUsersFromWebdav } from './userStore.js';
import { loadRequests, withRequestsLock, migrateLocalJsonToSQLite, syncFolders, isDuplicate, getNextId } from './requestsStore.js';
import { normalizePlate, normalizeName } from './utils.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); 
app.use(cors()); app.use(express.json());

// ─── WebDAV client (объявляем заранее, нужен для миграции и upload) ───
const WEBDAV_REQUESTS_XLSX = '/RegDoc_Заявки/_USERS/requests.xlsx';

const client = createClient('https://webdav.cloud.mail.ru/', {
    username: process.env.VK_CLOUD_EMAIL,
    password: process.env.VK_CLOUD_PASSWORD
});

// ─── Автомиграция при старте: JSON -> SQLite (и WebDAV -> SQLite для users) ───
migrateUsersFromWebdav().catch(e => console.error('[startup] users migration error:', e.message));
migrateLocalJsonToSQLite().catch(e => console.error('[startup] requests migration error:', e.message));

// ─── Фоновая синхронизация JSON обратно в XLSX на сервере (раз в 10 минут) ───
import { syncJsonToRemoteXlsx } from './requestsStore.js';
setInterval(() => {
    syncJsonToRemoteXlsx(client, WEBDAV_REQUESTS_XLSX).catch(e => 
        console.error('[bg-sync] periodic sync error:', e.message)
    );
}, 600000); 

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'regdoc-api' });
});

// Получение списка всех email (только для админа)
app.get('/api/users/emails', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        
        const store = await loadStore();
        const emails = store.users.map(u => u.email);
        res.json(emails);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Получение заявок пользователя
app.get('/api/my-requests', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const userEmail = decoded.email.toLowerCase();

        // loadRequests() читает из SQLite (мгновенно)
        const allRequests = await loadRequests();
        const userReqs = userEmail === 'admin'
            ? allRequests
            : allRequests.filter(r => String(r.email || '').toLowerCase() === userEmail);

        res.json(userReqs);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Изменение ФИО (только админ) по ID
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

            const r = requests[idx];
            const oldFolderName = await findFolderById(id);
            
            r.full_name = newFio.trim();

            if (oldFolderName) {
                const dateParts = String(r.DATE).split('.');
                const fName = normalizeName(r.full_name);
                const fPlate = normalizePlate(r.car_number);
                const newFullFolderName = `${id}_[${dateParts[2]}.${dateParts[1]}.${dateParts[0]}][${fName}][${fPlate}]`;
                
                if (oldFolderName !== newFullFolderName) {
                    client.moveFile(`/RegDoc_Заявки/${oldFolderName}`, `/RegDoc_Заявки/${newFullFolderName}`)
                      .catch(e => console.error('[rename] Error:', e.message));
                }
            }
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Удаление заявки (только админ) по ID
app.post('/api/requests/delete', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });

        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID missing' });

        const folderName = await findFolderById(id);

        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx > -1) {
                requests.splice(idx, 1);
            }
        });

        if (folderName) {
            client.deleteFile(`/RegDoc_Заявки/${folderName}`)
              .catch(e => console.error('[bg-delete] Error:', e.message));
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Изменение заявителя Email (только админ) по ID
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
            if (idx > -1) {
                requests[idx].email = newEmail.toLowerCase();
            }
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Отметка файла как проверенного (только админ)
app.post('/api/requests/verify-file', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        if (decoded.email !== 'admin') return res.status(403).json({ error: 'Forbidden' });

        const { id, docType, filename, verified, isFullyVerified } = req.body;
        if (!id || !docType || !filename) {
            console.error('[verify-file] Missing params:', { id, docType, filename });
            return res.status(400).json({ error: 'Missing parameters' });
        }

        await withRequestsLock(async (requests) => {
            const idx = requests.findIndex(r => String(r.ID) === String(id));
            if (idx === -1) {
                console.error('[verify-file] Request ID not found:', id);
                throw new Error('Request not found');
            }

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
    } catch (error) { 
        console.error('[verify-file] Error:', error.message);
        res.status(500).json({ error: error.message }); 
    }
});

// Добавление/обновление комментария к файлу (чат по файлу)
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
            
            if (role === 'user' && r.email.toLowerCase() !== decoded.email.toLowerCase()) {
                throw new Error('Forbidden: not your request');
            }

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

// Удаление конкретного файла (админ или владелец заявки)
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
            if (!r || String(r.email || '').toLowerCase() !== decoded.email.toLowerCase()) {
                return res.status(403).json({ error: 'Forbidden: not your request' });
            }
        }

        const folderName = await findFolderById(id);
        if (!folderName) return res.status(404).json({ error: 'Folder not found' });

        const sub = docType === 'pz' ? 'Для ПЗ' : 'Для ПБ';
        const filePath = `/RegDoc_Заявки/${folderName}/${sub}/${filename}`;

        if (await client.exists(filePath)) {
            await client.deleteFile(filePath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found on server' });
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Просмотр файла (прокси)
app.get('/api/requests/view-file', async (req, res) => {
    try {
        const { id, docType, filename } = req.query;
        if (!id || !docType || !filename) return res.status(400).send('Missing parameters');

        const folderName = await findFolderById(id);
        if (!folderName) return res.status(404).send('Folder not found');

        const sub = docType === 'pz' ? 'Для ПЗ' : 'Для ПБ';
        const filePath = `/RegDoc_Заявки/${folderName}/${sub}/${filename}`;

        if (!await client.exists(filePath)) return res.status(404).send('File not found');

        const stream = client.createReadStream(filePath);
        const ext = filename.split('.').pop().toLowerCase();
        
        const mimeTypes = { 'pdf': 'application/pdf', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
        
        stream.pipe(res);
    } catch (error) { res.status(500).send(error.message); }
});

app.post('/api/auth/login', (req, res, next) => {
    const { email, password } = req.body;
    if (email === 'admin' && password === 'admin888') {
        const token = jwt.sign({ id: 'admin', email: 'admin' }, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        return res.json({ token, user: { id: 'admin', email: 'admin', verified: true } });
    }
    next();
});

app.get('/api/auth/me', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
            if (decoded.email === 'admin') {
                return res.json({ user: { id: 'admin', email: 'admin', verified: true } });
            }
        } catch(e) {}
    }
    next();
});

app.use('/api/auth', authRouter);

async function findFolderById(id) {
    try {
        const items = await client.getDirectoryContents('/RegDoc_Заявки');
        const folder = items.find(i => i.type === 'directory' && i.basename.startsWith(id + '_'));
        if (folder) return folder.basename;
        
        // Поиск по старому формату (если ID еще нет в названии папки)
        const all = await loadRequests();
        const r = all.find(x => String(x.ID) === String(id));
        if (r) {
            const dateParts = String(r.DATE).split('.');
            const fName = normalizeName(r.full_name);
            const fPlate = normalizePlate(r.car_number);
            const oldName = `[${dateParts[2]}.${dateParts[1]}.${dateParts[0]}][${fName}][${fPlate}]`;
            if (items.some(i => i.basename === oldName)) return oldName;
        }
        return null;
    } catch (e) { return null; }
}

// Вспомогательная функция для глубокой проверки статуса заявки по её папке
async function getDetailedFolderStatus(folderName, requestData = null) {
    const fullPath = `/RegDoc_Заявки/${folderName}`;
    const res = {
        type_PZ: 'no', type_PB: 'no', 
        type_PZ_ready: 'no', type_PB_ready: 'no',
        hasFiles_PZ: 'no', hasFiles_PB: 'no',
        isVerified_PZ: 'no', isVerified_PB: 'no'
    };

    try {
        if (!await client.exists(fullPath)) return res;

        const contents = await client.getDirectoryContents(fullPath);
        const subfolders = contents.filter(i => i.type === 'directory');

        const checkSubContent = async (subName, folderKey) => {
            const sub = subfolders.find(f => f.basename === subName);
            if (!sub) return;

            res[`type_${folderKey}`] = 'yes';
            // Получаем содержимое подпапки
            const subContents = await client.getDirectoryContents(`${fullPath}/${subName}`).catch(() => []);
            const files = subContents.filter(i => i.type === 'file');

            const hasDescription = files.some(f => f.basename.toLowerCase() === 'описание.docx');
            const hasFiles = files.some(f => 
                f.basename.toLowerCase() !== 'описание.docx' && 
                !f.basename.toUpperCase().includes('ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ') && 
                !f.basename.toUpperCase().includes('ПРОТОКОЛ_БЕЗОПАСНОСТИ')
            );
            const isReady = files.some(f => 
                (folderKey === 'PZ' && f.basename.toUpperCase().includes('ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ')) ||
                (folderKey === 'PB' && f.basename.toUpperCase().includes('ПРОТОКОЛ_БЕЗОПАСНОСТИ'))
            );

            // "Документы" — считаем только реальные документы, исключая "описание" и финальный результат
            if (hasFiles) {
                res[`hasFiles_${folderKey}`] = 'yes';
            }
            if (isReady) {
                res[`type_${folderKey}_ready`] = 'yes';
            }
        };

        await Promise.all([
            checkSubContent('Для ПЗ', 'PZ'),
            checkSubContent('Для ПБ', 'PB')
        ]);
        
        // Достаем статусы верификации из requestData если есть
        if (requestData && requestData.verified_sections) {
            res.isVerified_PZ = requestData.verified_sections.pz ? 'yes' : 'no';
            res.isVerified_PB = requestData.verified_sections.pb ? 'yes' : 'no';
        }

    } catch (e) {
        console.error(`[getDetailedFolderStatus] error for ${folderName}:`, e.message);
    }
    return res;
}

async function syncRequestRecord(folderName, email, type_requests = null) {
    console.log(`[syncRequestRecord] Folder: ${folderName}, Email: ${email}`);
    
    // Парсим название папки (с учетом возможного ID_)
    const idMatch = folderName.match(/^(\d{4})_/);
    const idFromFolder = idMatch ? idMatch[1] : null;

    const match = folderName.match(/\[(\d{4})\.(\d{2})\.(\d{2})\]\[(.*?)\]\[(.*?)\]/);
    if (!match) {
        console.warn(`[syncRequestRecord] Failed to parse folder name: ${folderName}`);
        return;
    }

    const dateStr = `${match[3]}.${match[2]}.${match[1]}`;
    const fullName = match[4].replace(/_/g, ' ');
    const plate = match[5];

    const status = await getDetailedFolderStatus(folderName);
    console.log(`[syncRequestRecord] Status detected:`, status);

    await withRequestsLock(async (requests) => {
        const userEmail = email.toLowerCase();
        const plateKey = normalizePlate(plate);
        const nameKey = normalizeName(fullName);
        
        // Ищем существующую запись
        let idx = -1;
        if (idFromFolder) {
            idx = requests.findIndex(r => String(r.ID) === idFromFolder);
        } else {
            idx = requests.findIndex(r => 
                normalizePlate(String(r.car_number || '')) === plateKey && 
                normalizeName(String(r.full_name || '')) === nameKey
            );
        }

        const record = {
            DATE: dateStr,
            full_name: fullName,
            car_number: plate,
            email: userEmail,
            ...status,
            type_requests: (type_requests !== null) ? type_requests : (idx > -1 ? (requests[idx].type_requests || '') : '')
        };

        if (idx > -1) {
            const existingID = requests[idx].ID;
            requests[idx] = { ...record, ID: existingID };
        } else {
            // ID назначится автоматом в withRequestsLock
            requests.push(record);
        }
    });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/api/check-plate', async (req, res) => {
    try {
        const { plate } = req.query;
        if (!plate) return res.status(400).json({ error: 'Номер не указан' });
        const searchPlate = normalizePlate(plate);
        const rootPath = `/RegDoc_Заявки`;
        if (await client.exists(rootPath) === false) return res.json({ found: false });
        const items = await client.getDirectoryContents(rootPath);
        
        const folder = items.find(i => {
            if (i.type !== 'directory') return false;
            const match = i.basename.match(/\[.*?\]\[.*?\]\[(.*?)\]/);
            if (match) return normalizePlate(match[1]) === searchPlate;
            const oldParts = i.basename.split('_');
            return normalizePlate(oldParts[oldParts.length - 1]) === searchPlate;
        });

        if (folder) {
            const match = folder.basename.match(/\[.*?\]\[(.*?)\]\[.*?\]/);
            const extractedName = match ? match[1].replace(/_/g, ' ') : "Клиент";
            
            const existingFiles = {
                passport: [], snils: [], sts: [], pts: [], egrn: [],
                balloon_passport: [], act_opresovki: [], cert_gbo: [], cert_balloon: [],
                pte: [], zd: [], form207: [], gibdd_zayavlenie: [],
                photo_left: [], photo_right: [], photo_rear: [], photo_front: [],
                photo_hood: [], photo_vin: [], photo_kuzov: [], photo_tablichka: [],
                photo_balloon_place: [], photo_balloon_tablichka: [], photo_vent: [],
                photo_mult: [], photo_reduktor: [], photo_ebu: [], photo_forsunki: [], photo_vzu: []
            };

            const pzFilesMap = { passport: [], snils: [], sts: [], pts: [], egrn: [] };

            const ruToEnMap = {
                'ПАСПОРТ': 'passport', 'СНИЛС': 'snils', 'СТС': 'sts', 'ПТС': 'pts',
                'ВЫПИСКА_ЕГРН': 'egrn', 'ПАСПОРТ_БАЛЛОНА': 'balloon_passport',
                'АКТ_ОПРЕССОВКИ': 'act_opresovki', 'СЕРТИФИКАТ_ГБО': 'cert_gbo',
                'СЕРТИФИКАТ_БАЛЛОНА': 'cert_balloon', 'ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ': 'pte',
                'ЗАЯВЛЕНИЕ_ДЕКЛАРАЦИЯ': 'zd', 'ФОРМА_207': 'form207', 'ЗАЯВЛЕНИЕ_ГИБДД': 'gibdd_zayavlenie',
                'ФОТО_СЛЕВА': 'photo_left', 'ФОТО_СПРАВА': 'photo_right', 'ФОТО_СЗАДИ': 'photo_rear',
                'ФОТО_СПЕРЕДИ': 'photo_front', 'ФОТО_КАПОТ': 'photo_hood', 'ФОТО_VIN': 'photo_vin',
                'ФОТО_НОМЕР_КУЗОВА': 'photo_kuzov', 'ФОТО_ТАБЛИЧКА': 'photo_tablichka',
                'ФОТО_МЕСТО_БАЛЛОНА': 'photo_balloon_place', 'ФОТО_ТАБЛИЧКА_БАЛЛОНА': 'photo_balloon_tablichka',
                'ФОТО_ВЕНТ_КАНАЛОВ': 'photo_vent', 'ФОТО_МУЛЬТ': 'photo_mult', 'ФОТО_РЕДУКТОР': 'photo_reduktor',
                'ФОТО_ЭБУ': 'photo_ebu', 'ФОТО_ФОРСУНКИ': 'photo_forsunki', 'ФОТО_ВЗУ': 'photo_vzu'
            };

            let hasDescription = false; 
            const subFolders = ['Для ПЗ', 'Для ПБ'];
            for (const sub of subFolders) {
                const subPath = `${folder.filename}/${sub}`;
                if (await client.exists(subPath)) {
                    const contents = await client.getDirectoryContents(subPath);
                    contents.forEach(file => {
                        if (file.type === 'file') {
                            if (file.basename.toLowerCase() === 'описание.docx') {
                                hasDescription = true;
                            } else if (!file.basename.includes('.docx')) {
                                const name = file.basename.toUpperCase();
                                for (const [ru, en] of Object.entries(ruToEnMap)) {
                                    if (name.startsWith(ru + '_')) {
                                        existingFiles[en].push(file.basename);
                                        if (sub === 'Для ПЗ' && pzFilesMap[en] !== undefined) {
                                            pzFilesMap[en].push(file.basename);
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    });
                }
            }
            return res.json({ 
                found: true, 
                fullName: extractedName, 
                existingFiles, 
                pzFiles: pzFilesMap, 
                hasDescription, 
                folderName: folder.basename,
                verified_files: (await loadRequests()).find(r => normalizePlate(String(r.car_number)) === searchPlate)?.verified_files || {},
                file_comments: (await loadRequests()).find(r => normalizePlate(String(r.car_number)) === searchPlate)?.file_comments || {}
            });
        }
        res.json({ found: false });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

async function createDirWithRetry(path) {
    if (await client.exists(path) === false) {
        await client.createDirectory(path);
        await sleep(300); 
    }
}

async function uploadFileWithRetry(path, buffer) {
    for (let i = 0; i < 3; i++) {
        try { await client.putFileContents(path, buffer); return; } catch (e) { await sleep(1000); }
    }
}

app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        const { step, folderName, clientType, docType, fullName, companyName, licensePlate, conversionType, updateDescription } = req.body;
        
        let userEmail = "";
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
            userEmail = decoded.email;
        }

        if (step === 'sync_request') {
            // Больше не создаем запись здесь автоматически, 
            // так как она должна появляться только при 'commit_request'
            return res.json({ success: true });
        }

        if (step === 'commit_request') {
            const { type_requests } = req.body;
            if (userEmail && folderName) {
                await syncRequestRecord(folderName, userEmail, type_requests);
                return res.json({ success: true, committed: true });
            }
            return res.status(400).json({ error: 'Missing data for commit' });
        }

        if (step === 'main_folder') {
            const { clientType, fullName, companyName, licensePlate, type_requests } = req.body;
            const now = new Date();
            const ekb = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Asia/Yekaterinburg', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
            const getV = (t) => ekb.find(p => p.type === t).value;
            const datePart = `[${getV('year')}.${getV('month')}.${getV('day')}]`;
            
            const rawName = clientType === 'legal' ? companyName : fullName;
            const namePart = `[${normalizeName(rawName)}]`;
            const platePart = `[${normalizePlate(licensePlate)}]`;
            
            // Генерируем ID для новой заявки
            const allReqs = await loadRequests();
            const nextId = getNextId(allReqs);
            
            const newFolderName = `${nextId}_${datePart}${namePart}${platePart}`;
            await createDirWithRetry(`/RegDoc_Заявки`);
            await createDirWithRetry(`/RegDoc_Заявки/${newFolderName}`);
            
            // Запись в JSON больше НЕ делается на этом этапе (только на commit_request)
            return res.json({ success: true, folderName: newFolderName });
        }

        const clientPath = `/RegDoc_Заявки/${folderName}`;
        const finalPath = `${clientPath}/${docType === 'pz' ? 'Для ПЗ' : 'Для ПБ'}`;

        if (step === 'delete_folder') {
            if (await client.exists(clientPath)) {
                await client.deleteFile(clientPath); 
            }
            return res.json({ success: true });
        }

        if (step === 'sub_folder') {
            await createDirWithRetry(finalPath);
            return res.json({ success: true });
        }

        if (step === 'single_file') {
            const file = req.files[0];
            const russianNames = {
                'passport': 'ПАСПОРТ', 'snils': 'СНИЛС', 'sts': 'СТС', 'pts': 'ПТС',
                'egrn': 'ВЫПИСКА_ЕГРН', 'balloon_passport': 'ПАСПОРТ_БАЛЛОНА',
                'act_opresovki': 'АКТ_ОПРЕССОВКИ', 'cert_gbo': 'СЕРТИФИКАТ_ГБО',
                'cert_balloon': 'СЕРТИФИКАТ_БАЛЛОНА', 'pte': 'ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ',
                'zd': 'ЗАЯВЛЕНИЕ_ДЕКЛАРАЦИЯ', 'form207': 'ФОРМА_207', 'gibdd_zayavlenie': 'ЗАЯВЛЕНИЕ_ГИБДД',
                'photo_left': 'ФОТО_СЛЕВА', 'photo_right': 'ФОТО_СПРАВА', 'photo_rear': 'ФОТО_СЗАДИ',
                'photo_front': 'ФОТО_СПЕРЕДИ', 'photo_hood': 'ФОТО_КАПОТ', 'photo_vin': 'ФОТО_VIN',
                'photo_kuzov': 'ФОТО_НОМЕР_КУЗОВА', 'photo_tablichka': 'ФОТО_ТАБЛИЧКА',
                'photo_balloon_place': 'ФОТО_МЕСТО_БАЛЛОНА', 'photo_balloon_tablichka': 'ФОТО_ТАБЛИЧКА_БАЛЛОНА',
                'photo_vent': 'ФОТО_ВЕНТ_КАНАЛОВ', 'photo_mult': 'ФОТО_МУЛЬТ', 'photo_reduktor': 'ФОТО_РЕДУКТОР',
                'photo_ebu': 'ФОТО_ЭБУ', 'photo_forsunki': 'ФОТО_ФОРСУНКИ', 'photo_vzu': 'ФОТО_ВЗУ'
            };
            const cat = russianNames[file.fieldname] || 'ФАЙЛ';

            let existingFileNames = [];
            if (await client.exists(finalPath)) {
                const existingItems = await client.getDirectoryContents(finalPath);
                existingFileNames = existingItems.filter(i => i.type === 'file').map(i => i.basename.toUpperCase());
            }

            let maxNum = 0;
            existingFileNames.forEach(name => {
                if (name.startsWith(cat + '_')) {
                    const parts = name.split('_');
                    if (parts.length > 1) {
                        const num = parseInt(parts[1]);
                        if (!isNaN(num) && num > maxNum) maxNum = num;
                    }
                }
            });

            const ext = file.originalname.split('.').pop().toLowerCase();
            const newFileName = `${cat}_${maxNum + 1}.${ext}`;
            await uploadFileWithRetry(`${finalPath}/${newFileName}`, file.buffer);
            
            if (userEmail) await syncRequestRecord(folderName, userEmail);
            return res.json({ success: true });
        }

        if (step === 'doc_file') {
            if (updateDescription !== 'false' && docType === 'pz') {
                const doc = new Document({sections: [{children: [new Paragraph({children: [new TextRun({text: "Тип переоборудования:", bold: true, size: 28})]}) , new Paragraph({children: [new TextRun({text: conversionType || "", size: 24})]})]}]});
                const docBuf = await Packer.toBuffer(doc);
                await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
            }

            const filesToCopyStr = req.body.filesToCopy;
            let filesToCopy = [];
            if (filesToCopyStr) {
                try { filesToCopy = JSON.parse(filesToCopyStr); } catch(e){}
            }

            if (filesToCopy.length > 0 && docType === 'pb') {
                const pzPath = `/RegDoc_Заявки/${folderName}/Для ПЗ`;
                if (await client.exists(pzPath)) {
                    const pzItems = await client.getDirectoryContents(pzPath);
                    const ruToEnMapCopy = { 'ПАСПОРТ_': 'passport', 'СНИЛС_': 'snils', 'СТС_': 'sts', 'ПТС_': 'pts', 'ВЫПИСКА_ЕГРН_': 'egrn' };
                    for (const item of pzItems) {
                        if (item.type === 'file') {
                            const name = item.basename.toUpperCase();
                            for (const [ru, en] of Object.entries(ruToEnMapCopy)) {
                                if (name.startsWith(ru) && filesToCopy.includes(en)) {
                                    const targetFile = `${finalPath}/${item.basename}`;
                                    if (await client.exists(targetFile) === false) {
                                        await client.copyFile(item.filename, targetFile);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return res.json({ success: true });
        }

        res.json({ success: false, error: "Unknown step" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default app;