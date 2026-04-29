import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createClient } from 'webdav';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import jwt from 'jsonwebtoken';
import authRouter from './authRouter.js';
import { loadStore, migrateUsersFromWebdav } from './userStore.js';
import { loadRequests, withRequestsLock, migrateLocalJsonToSQLite, isDuplicate, getNextId } from './requestsStore.js';
import { normalizePlate, normalizeName } from './utils.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json());

const WEBDAV_REQUESTS_XLSX = '/RegDoc_Заявки/_USERS/requests.xlsx';

const client = createClient('https://webdav.cloud.mail.ru/', {
    username: process.env.VK_CLOUD_EMAIL,
    password: process.env.VK_CLOUD_PASSWORD
});

migrateUsersFromWebdav().catch(e => console.error('[startup] users migration error:', e.message));
migrateLocalJsonToSQLite().catch(e => console.error('[startup] requests migration error:', e.message));

// ========== WebDAV HEALTH CHECK AT STARTUP ==========
(async () => {
    console.log('[webdav-healthcheck] Testing WebDAV connection...');
    try {
        const rootExists = await client.exists('/RegDoc_Заявки');
        console.log(`✅ WebDAV connection OK - root folder exists: ${rootExists}`);
    } catch (e) {
        console.error('❌ WebDAV CONNECTION FAILED:', e.message);
        if (e.response) {
            console.error('   Response status:', e.response.status);
            console.error('   Response body:', e.response.body);
        }
    }
})();

import { syncJsonToRemoteXlsx } from './requestsStore.js';
setInterval(() => {
    syncJsonToRemoteXlsx(client, WEBDAV_REQUESTS_XLSX).catch(e =>
        console.error('[bg-sync] periodic sync error:', e.message)
    );
}, 600000);

// ========== НОВЫЙ СПЕЦИАЛЬНЫЙ ЭНДПОИНТ ДЛЯ VERIFY FILE ==========
app.post('/api/verify-file', async (req, res) => {
    console.log('[/api/verify-file] START - body:', JSON.stringify(req.body));
    try {
        const { folderName, docType, fileName } = req.body;

        if (!folderName) {
            console.log('[/api/verify-file] ERROR: folderName missing');
            return res.status(400).json({ error: 'folderName missing' });
        }
        if (!fileName) {
            console.log('[/api/verify-file] ERROR: fileName missing');
            return res.status(400).json({ error: 'fileName missing' });
        }
        if (!docType) {
            console.log('[/api/verify-file] ERROR: docType missing');
            return res.status(400).json({ error: 'docType missing' });
        }

        console.log('[/api/verify-file] Processing:', { folderName, docType, fileName });

        const safeDocType = docType || 'pz';
        const docTypeFolder = safeDocType === 'pz' ? 'Для ПЗ' : 'Для ПБ';
        const folderPath = `/RegDoc_Заявки/${folderName}/${docTypeFolder}`;
        const verifiedJsonPath = `${folderPath}/verified.json`;

        console.log('[/api/verify-file] folderPath:', folderPath);
        console.log('[/api/verify-file] verifiedJsonPath:', verifiedJsonPath);

        // Создаём папку если её нет
        let folderExists = false;
        try {
            folderExists = await client.exists(folderPath);
            console.log('[/api/verify-file] folderExists:', folderExists);
        } catch (e) {
            console.log('[/api/verify-file] folderExists error:', e.message);
        }
        if (!folderExists) {
            try {
                await client.createDirectory(folderPath);
                await sleep(500);
                console.log('[/api/verify-file] Created folder');
            } catch (e) {
                console.log('[/api/verify-file] Create folder error:', e.message);
            }
        }

        // Читаем текущий verified.json
        let verifiedList = [];
        try {
            const rawContent = await client.getFileContents(verifiedJsonPath, { format: 'binary' });
            const content = Buffer.isBuffer(rawContent) ? rawContent.toString('utf-8') : String(rawContent);
            verifiedList = JSON.parse(content);
            if (!Array.isArray(verifiedList)) verifiedList = [];
            console.log('[/api/verify-file] Read existing list:', verifiedList);
        } catch (e) {
            console.log('[/api/verify-file] Read error (file may not exist):', e.message);
            verifiedList = [];
        }

        // Добавляем файл если его нет
        if (!verifiedList.includes(fileName)) {
            verifiedList.push(fileName);
            console.log('[/api/verify-file] Added file, new list:', verifiedList);
        }

        // Записываем в WebDAV
        const jsonContent = JSON.stringify(verifiedList);
        let writeSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await client.putFileContents(verifiedJsonPath, Buffer.from(jsonContent));
                await sleep(200);
                writeSuccess = true;
                console.log('[/api/verify-file] WebDAV write OK, attempt:', attempt);
                break;
            } catch (e) {
                console.log('[/api/verify-file] WebDAV write attempt', attempt, 'failed:', e.message);
                await sleep(500);
            }
        }

        if (!writeSuccess) {
            console.log('[/api/verify-file] WebDAV write FAILED after 3 attempts');
            return res.status(500).json({ error: 'Failed to write to WebDAV' });
        }

        // Сохраняем в БАЗУ ДАННЫХ
        console.log('[/api/verify-file] Saving to database...');
        try {
            const reqId = folderName.split('_')[0];
            await withRequestsLock(async (requests) => {
                const idx = requests.findIndex(r => String(r.ID) === String(reqId));
                if (idx === -1) {
                    requests.push({ ID: reqId, DATE: new Date().toLocaleDateString('ru-RU'), full_name: '', car_number: '', email: '', verified_files: { [safeDocType]: { [fileName]: true } } });
                    console.log('[/api/verify-file] Created new DB record');
                } else {
                    if (!requests[idx].verified_files) requests[idx].verified_files = {};
                    if (!requests[idx].verified_files[safeDocType]) requests[idx].verified_files[safeDocType] = {};
                    requests[idx].verified_files[safeDocType][fileName] = true;
                    console.log('[/api/verify-file] Updated DB record');
                }
            });
            console.log('[/api/verify-file] Database save OK');
        } catch (e) {
            console.error('[/api/verify-file] DB error:', e.message);
        }

        // Формируем ответ
        const responseObj = { [safeDocType]: {} };
        verifiedList.forEach(f => { responseObj[safeDocType][f] = true; });

        const allReqs = await loadRequests();
        const reqId = folderName.split('_')[0];
        const dbReq = allReqs.find(r => String(r.ID) === String(reqId));

        console.log('[/api/verify-file] END - success');
        res.json({
            success: true,
            verified: true,
            fileName: fileName,
            verifiedFiles: responseObj,
            verified_files: dbReq?.verified_files || {}
        });

    } catch (error) {
        console.error('[/api/verify-file] EXCEPTION:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ========== КОНЕЦ НОВОГО ЭНДПОИНТА ==========

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * БЕЗОПАСНОЕ рекурсивное создание структуры папок в WebDAV.
 * Разбивает путь на части и создаёт каждую папку по очереди.
 * Защита от: undefined, пустых путей, двойных слэшей, попытки создать корень '/'
 */
async function ensureDirectoryExists(targetPath) {
    console.log('🔥 ПУТЬ ДЛЯ СОЗДАНИЯ ПАПОК:', targetPath);

    // Защита от undefined или пустого пути
    if (!targetPath || typeof targetPath !== 'string') {
        console.error('[ensureDirectoryExists] ERROR: targetPath is invalid:', targetPath);
        throw new Error('Путь для создания папки невалиден: ' + String(targetPath));
    }

    // Разбиваем путь, убираем пустые элементы и ведущий слэш
    const cleanPath = targetPath.startsWith('/') ? targetPath.slice(1) : targetPath;
    const parts = cleanPath.split('/').filter(p => p && p.trim().length > 0);

    console.log('[ensureDirectoryExists] Parts:', parts);

    if (parts.length === 0) {
        console.error('[ensureDirectoryExists] ERROR: No parts to create');
        throw new Error('Нечего создавать - путь не содержит директорий');
    }

    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        // НЕ кодируем - webdav библиотека сама кодирует при отправке HTTP
        currentPath = '/' + parts.slice(0, i + 1).join('/');

        console.log('[ensureDirectoryExists] Step', i + 1, '/', parts.length, '- checking:', currentPath);

        try {
            const exists = await client.exists(currentPath);
            console.log('[ensureDirectoryExists] exists:', exists);

            if (!exists) {
                console.log('[ensureDirectoryExists] Creating directory:', currentPath);
                await client.createDirectory(currentPath);
                console.log('[ensureDirectoryExists] ✅ Created:', currentPath);
                await sleep(300);
            } else {
                console.log('[ensureDirectoryExists] Already exists, skip:', currentPath);
            }
        } catch (error) {
            console.error('[ensureDirectoryExists] ❌ ERROR for path:', currentPath);
            console.error('[ensureDirectoryExists] Error message:', error.message);
            console.error('[ensureDirectoryExists] HTTP Status:', error.response?.status);
            console.error('[ensureDirectoryExists] Response body:', error.response?.body);
            throw new Error(`Не удалось создать папку "${part}" в пути ${currentPath}. Сервер вернул: ${error.message}`);
        }
    }

    console.log('[ensureDirectoryExists] ✅ END - all folders created for:', targetPath);
}

app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'regdoc-api' });
});

// ========== ЭНДПОИНТ ИНИЦИАЛИЗАЦИИ ПАПКИ ==========
app.post('/api/init-folder', async (req, res) => {
    console.log('[/api/init-folder] START - body:', JSON.stringify(req.body));
    try {
        const { path } = req.body;

        if (!path) {
            console.error('[/api/init-folder] ERROR: path is missing');
            return res.status(400).json({ error: 'Путь не указан' });
        }

        console.log('[/api/init-folder] Requested path:', path);

        // ЗАПРЕТ: НИКАКИХ encodeURI или encodeURIComponent! WebDAV ожидает СЫРЫЕ строки
        const targetPath = path;

        try {
            const exists = await client.exists(targetPath);
            console.log('[/api/init-folder] exists:', exists);

            if (!exists) {
                console.log('[/api/init-folder] Creating directory:', targetPath);
                await client.createDirectory(targetPath);
                console.log('[/api/init-folder] ✅ SUCCESS - Created:', targetPath);
            } else {
                console.log('[/api/init-folder] Directory already exists, skip');
            }

            res.status(200).json({ success: true, path: targetPath });
        } catch (webdavError) {
            console.error('[/api/init-folder] 🔥 WebDAV ERROR:', webdavError.message);
            console.error('[/api/init-folder] HTTP Status:', webdavError.response?.status);
            console.error('[/api/init-folder] Response body:', webdavError.response?.body);
            return res.status(500).json({ error: 'Не удалось создать папку в облаке: ' + webdavError.message });
        }
    } catch (error) {
        console.error('[/api/init-folder] FATAL ERROR:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера: ' + error.message });
    }
});

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

app.get('/api/my-requests', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const userEmail = decoded.email.toLowerCase();
        const allRequests = await loadRequests();
        const userReqs = userEmail === 'admin'
            ? allRequests
            : allRequests.filter(r => String(r.email || '').toLowerCase() === userEmail);
        res.json(userReqs);
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
            if (idx > -1) requests.splice(idx, 1);
        });
        if (folderName) client.deleteFile(`/RegDoc_Заявки/${folderName}`).catch(e => console.error('[bg-delete] Error:', e.message));
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

// ========== TOGGLE PZ ACCEPTED (Admin only) ==========
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
            console.log(`[toggle-pz-accepted] Request ${id}: ${current ? 'unapproved' : 'approved'}`);
        });

        res.json({ success: true, isPzAccepted: newStatus });
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
            if (role === 'user' && r.email.toLowerCase() !== decoded.email.toLowerCase()) throw new Error('Forbidden: not your request');
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
            if (!r || String(r.email || '').toLowerCase() !== decoded.email.toLowerCase()) return res.status(403).json({ error: 'Forbidden: not your request' });
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
    if (email === 'test' && password === 'admin888') {
        const token = jwt.sign({ id: 'test', email: 'test' }, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        return res.json({ token, user: { id: 'test', email: 'test', verified: true } });
    }
    next();
});

app.get('/api/auth/me', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
            if (decoded.email === 'admin') return res.json({ user: { id: 'admin', email: 'admin', verified: true } });
            if (decoded.email === 'test') return res.json({ user: { id: 'test', email: 'test', verified: true } });
        } catch (e) { }
    }
    next();
});

app.use('/api/auth', authRouter);

async function findFolderById(id) {
    try {
        const items = await client.getDirectoryContents('/RegDoc_Заявки');
        const folder = items.find(i => i.type === 'directory' && i.basename.startsWith(id + '_'));
        if (folder) return folder.basename;
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

async function getDetailedFolderStatus(folderName, requestData = null) {
    const fullPath = `/RegDoc_Заявки/${folderName}`;
    const res = { type_PZ: 'no', type_PB: 'no', type_PZ_ready: 'no', type_PB_ready: 'no', hasFiles_PZ: 'no', hasFiles_PB: 'no', isVerified_PZ: 'no', isVerified_PB: 'no' };
    try {
        if (!await client.exists(fullPath)) return res;
        const contents = await client.getDirectoryContents(fullPath);
        const subfolders = contents.filter(i => i.type === 'directory');
        const checkSubContent = async (subName, folderKey) => {
            const sub = subfolders.find(f => f.basename === subName);
            if (!sub) return;
            res[`type_${folderKey}`] = 'yes';
            const subContents = await client.getDirectoryContents(`${fullPath}/${subName}`).catch(() => []);
            const files = subContents.filter(i => i.type === 'file');
            const hasDescription = files.some(f => f.basename.toLowerCase() === 'описание.docx');
            const hasFiles = files.some(f => f.basename.toLowerCase() !== 'описание.docx' && !f.basename.toUpperCase().includes('ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ') && !f.basename.toUpperCase().includes('ПРОТОКОЛ_БЕЗОПАСНОСТИ'));
            const isReady = files.some(f => (folderKey === 'PZ' && f.basename.toUpperCase().includes('ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ')) || (folderKey === 'PB' && f.basename.toUpperCase().includes('ПРОТОКОЛ_БЕЗОПАСНОСТИ')));
            if (hasFiles) res[`hasFiles_${folderKey}`] = 'yes';
            if (isReady) res[`type_${folderKey}_ready`] = 'yes';
        };
        await Promise.all([checkSubContent('Для ПЗ', 'PZ'), checkSubContent('Для ПБ', 'PB')]);
        if (requestData && requestData.verified_sections) {
            res.isVerified_PZ = requestData.verified_sections.pz ? 'yes' : 'no';
            res.isVerified_PB = requestData.verified_sections.pb ? 'yes' : 'no';
        }
    } catch (e) { console.error(`[getDetailedFolderStatus] error for ${folderName}:`, e.message); }
    return res;
}

async function syncRequestRecord(folderName, email, type_requests = null) {
    console.log(`[syncRequestRecord] Folder: ${folderName}, Email: ${email}`);
    const idMatch = folderName.match(/^(\d{4})_/);
    const idFromFolder = idMatch ? idMatch[1] : null;
    const match = folderName.match(/\[(\d{4})\.(\d{2})\.(\d{2})\]\[(.*?)\]\[(.*?)\]/);
    if (!match) { console.warn(`[syncRequestRecord] Failed to parse folder name: ${folderName}`); return; }
    const dateStr = `${match[3]}.${match[2]}.${match[1]}`;
    const fullName = match[4].replace(/_/g, ' ');
    const plate = match[5];
    const status = await getDetailedFolderStatus(folderName);
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
        const rootPath = `/RegDoc_Заявки`;

        // Проверяем соединение с WebDAV
        let rootExists = false;
        try {
            rootExists = await client.exists(rootPath);
        } catch (webdavErr) {
            console.error('[/api/check-plate] WebDAV exists check failed:', webdavErr.message);
            if (webdavErr.response) {
                console.error('   WebDAV status:', webdavErr.response.status);
            }
            return res.status(503).json({ error: 'Cloud connection failed', details: webdavErr.message });
        }

        if (rootExists === false) {
            console.log('[/api/check-plate] Root folder not found, returning found:false');
            return res.json({ found: false });
        }

        let items;
        try {
            items = await client.getDirectoryContents(rootPath);
        } catch (dirErr) {
            console.error('[/api/check-plate] WebDAV directory listing failed:', dirErr.message);
            return res.status(503).json({ error: 'Cannot read cloud folder', details: dirErr.message });
        }
        const folder = items.find(i => {
            if (i.type !== 'directory') return false;
            const match = i.basename.match(/\[.*?\]\[.*?\]\[(.*?)\]/);
            if (match) return normalizePlate(match[1]) === searchPlate;
            const oldParts = i.basename.split('_');
            return normalizePlate(oldParts[oldParts.length - 1]) === searchPlate;
        });
        if (folder) {
            console.log('[check-plate] FOUND FOLDER:', folder.basename);
            const match = folder.basename.match(/\[.*?\]\[(.*?)\]\[.*?\]/);
            const extractedName = match ? match[1].replace(/_/g, ' ') : "Клиент";
            const generateEmptyMap = () => ({ passport: [], snils: [], sts: [], pts: [], egrn: [], balloon_passport: [], act_opresovki: [], cert_gbo: [], cert_balloon: [], pte: [], zd: [], form207: [], gibdd_zayavlenie: [], photo_left: [], photo_right: [], photo_rear: [], photo_front: [], photo_hood: [], photo_vin: [], photo_kuzov: [], photo_tablichka: [], photo_balloon_place: [], photo_balloon_tablichka: [], photo_vent: [], photo_mult: [], photo_reduktor: [], photo_ebu: [], photo_forsunki: [], photo_vzu: [] });
            const existingFiles_PZ = generateEmptyMap();
            const existingFiles_PB = generateEmptyMap();
            const pzFilesMap = { passport: [], snils: [], sts: [], pts: [], egrn: [] };
            const ruToEnMap = { 'ПАСПОРТ': 'passport', 'СНИЛС': 'snils', 'СТС': 'sts', 'ПТС': 'pts', 'ВЫПИСКА_ЕГРН': 'egrn', 'ПАСПОРТ_БАЛЛОНА': 'balloon_passport', 'АКТ_ОПРЕССОВКИ': 'act_opresovki', 'СЕРТИФИКАТ_ГБО': 'cert_gbo', 'СЕРТИФИКАТ_БАЛЛОНА': 'cert_balloon', 'ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ': 'pte', 'ЗАЯВЛЕНИЕ_ДЕКЛАРАЦИЯ': 'zd', 'ФОРМА_207': 'form207', 'ЗАЯВЛЕНИЕ_ГИБДД': 'gibdd_zayavlenie', 'ФОТО_СЛЕВА': 'photo_left', 'ФОТО_СПРАВА': 'photo_right', 'ФОТО_СЗАДИ': 'photo_rear', 'ФОТО_СПЕРЕДИ': 'photo_front', 'ФОТО_КАПОТ': 'photo_hood', 'ФОТО_VIN': 'photo_vin', 'ФОТО_НОМЕР_КУЗОВА': 'photo_kuzov', 'ФОТО_ТАБЛИЧКА': 'photo_tablichka', 'ФОТО_МЕСТО_БАЛЛОНА': 'photo_balloon_place', 'ФОТО_ТАБЛИЧКА_БАЛЛОНА': 'photo_balloon_tablichka', 'ФОТО_ВЕНТ_КАНАЛОВ': 'photo_vent', 'ФОТО_МУЛЬТ': 'photo_mult', 'ФОТО_РЕДУКТОР': 'photo_reduktor', 'ФОТО_ЭБУ': 'photo_ebu', 'ФОТО_ФОРСУНКИ': 'photo_forsunki', 'ФОТО_ВЗУ': 'photo_vzu' };
            let hasDescription = false;
            const subFolders = ['Для ПЗ', 'Для ПБ'];
            const verifiedFiles = { pz: [], pb: [] };

            // Сначала проверим что реально лежит ВНУТРИ папки заявки
            const folderPath = `/RegDoc_Заявки/${folder.basename}`;
            console.log('[check-plate] Listing actual contents of folder:', folderPath);
            try {
                const folderContents = await client.getDirectoryContents(folderPath);
                console.log('[check-plate] ACTUAL folder contents:', folderContents.map(i => ({ name: i.basename, type: i.type })));
            } catch (e) {
                console.error('[check-plate] Failed to list folder contents:', e.message);
            }

            for (const sub of subFolders) {
                // ИСПРАВЛЕНО: используем ПОЛНЫЙ путь с /RegDoc_Заявки/
                const subPath = `/RegDoc_Заявки/${folder.basename}/${sub}`;
                console.log('[check-plate] Checking subPath:', subPath);
                let subExists = false;
                try {
                    subExists = await client.exists(subPath);
                    console.log('[check-plate] subPath exists:', subExists);
                } catch (e) {
                    console.error('[check-plate] exists check error:', e.message);
                }
                if (subExists) {
                    const contents = await client.getDirectoryContents(subPath);
                    console.log(`[check-plate] Folder: ${subPath} - Found ${contents.length} items`);
                    console.log('[check-plate] Files in WebDAV:', contents.filter(f => f.type === 'file').map(f => f.basename));

                    const targetMap = sub === 'Для ПЗ' ? existingFiles_PZ : existingFiles_PB;
                    const subKey = sub === 'Для ПЗ' ? 'pz' : 'pb';
                    contents.forEach(file => {
                        if (file.type === 'file') {
                            if (file.basename.toLowerCase() === 'описание.docx') hasDescription = true;
                            else if (!file.basename.includes('.docx') && !file.basename.includes('verified.json')) {
                                const name = file.basename.toUpperCase();
                                let matched = false;
                                for (const [ru, en] of Object.entries(ruToEnMap)) {
                                    if (name.startsWith(ru + '_')) {
                                        targetMap[en].push(file.basename);
                                        console.log(`[check-plate] MAPPED: ${file.basename} -> ${en}`);
                                        if (sub === 'Для ПЗ' && pzFilesMap[en] !== undefined) pzFilesMap[en].push(file.basename);
                                        matched = true;
                                        break;
                                    }
                                }
                                if (!matched) {
                                    console.log(`[check-plate] UNMAPPED file: ${file.basename}`);
                                }
                            }
                        }
                    });
                    console.log(`[check-plate] existingFiles_PZ:`, JSON.stringify(existingFiles_PZ));
                    const verifiedJsonPath = `${subPath}/verified.json`;
                    if (await client.exists(verifiedJsonPath)) {
                        try {
                            const rawContent = await client.getFileContents(verifiedJsonPath, { format: 'binary' });
                            const vContent = Buffer.isBuffer(rawContent) ? rawContent.toString('utf-8') : String(rawContent);
                            verifiedFiles[subKey] = JSON.parse(vContent);
                        } catch (e) { verifiedFiles[subKey] = []; }
                    }
                }
            }
            console.log('[check-plate] Loading verified_files from database...');
            const allRequests = await loadRequests();
            const dbRequest = allRequests.find(r => normalizePlate(String(r.car_number)) === searchPlate);
            console.log('[check-plate] Found DB request:', dbRequest ? `ID=${dbRequest.ID}` : 'NOT FOUND');
            const dbVerifiedFiles = dbRequest?.verified_files || {};
            const dbFileComments = dbRequest?.file_comments || {};
            console.log('[check-plate] Database verified_files:', JSON.stringify(dbVerifiedFiles));
            const combinedVerifiedFilesPZ = { ...(dbVerifiedFiles.pz || {}) };
            const combinedVerifiedFilesPB = { ...(dbVerifiedFiles.pb || {}) };
            (verifiedFiles.pz || []).forEach(f => { combinedVerifiedFilesPZ[f] = true; });
            (verifiedFiles.pb || []).forEach(f => { combinedVerifiedFilesPB[f] = true; });
            const combinedVerifiedFiles = { pz: combinedVerifiedFilesPZ, pb: combinedVerifiedFilesPB };
            console.log('[check-plate] Combined verifiedFiles:', JSON.stringify(combinedVerifiedFiles));
            return res.json({ found: true, fullName: extractedName, existingFiles_PZ, existingFiles_PB, existingFiles: existingFiles_PZ, pzFiles: pzFilesMap, hasDescription, folderName: folder.basename, verifiedFiles: combinedVerifiedFiles, verified_files: dbVerifiedFiles, file_comments: dbFileComments });
        }
        res.json({ found: false });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

async function createDirWithRetry(path) {
    console.log('[createDirWithRetry] Checking path:', path);
    try {
        const exists = await client.exists(path);
        console.log('[createDirWithRetry] exists:', exists);
        if (exists === false) {
            console.log('[createDirWithRetry] Creating directory:', path);
            await client.createDirectory(path);
            console.log('[createDirWithRetry] Directory created');
            await sleep(300);
        } else {
            console.log('[createDirWithRetry] Directory already exists, skip');
        }
    } catch (e) {
        console.error('[createDirWithRetry] Error:', e.message);
        // Пробуем создать даже если exists() выбросил ошибку
        try {
            console.log('[createDirWithRetry] Trying to create anyway:', path);
            await client.createDirectory(path);
            console.log('[createDirWithRetry] Force-created directory');
            await sleep(300);
        } catch (e2) {
            console.error('[createDirWithRetry] Force-create failed:', e2.message);
        }
    }
}

async function uploadFileWithRetry(path, buffer) {
    for (let i = 0; i < 3; i++) { try { await client.putFileContents(path, buffer); return; } catch (e) { await sleep(1000); } }
}

app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        const { step, folderName, clientType, docType, fullName, companyName, licensePlate, conversionType, updateDescription } = req.body;

        if (step === 'toggle_verify_file') {
            const { fileName, docType: fileDocType } = req.body;
            console.log('[toggle_verify_file] START - fileName:', fileName, 'folderName:', folderName);
            if (!fileName) return res.status(400).json({ error: 'fileName missing' });
            if (!folderName) return res.status(400).json({ error: 'folderName missing' });

            const safeDocType = fileDocType || 'pz';
            const docTypeFolder = safeDocType === 'pz' ? 'Для ПЗ' : 'Для ПБ';
            const folderPath = `/RegDoc_Заявки/${folderName}/${docTypeFolder}`;
            const verifiedJsonPath = `${folderPath}/verified.json`;

            let folderExists = false;
            try { folderExists = await client.exists(folderPath); } catch (e) { }
            if (!folderExists) {
                try { await client.createDirectory(folderPath); await sleep(500); } catch (e) { }
            }

            let verifiedList = [];
            try {
                const rawContent = await client.getFileContents(verifiedJsonPath, { format: 'binary' });
                const content = Buffer.isBuffer(rawContent) ? rawContent.toString('utf-8') : String(rawContent);
                verifiedList = JSON.parse(content);
                if (!Array.isArray(verifiedList)) verifiedList = [];
            } catch (e) { verifiedList = []; }

            if (!verifiedList.includes(fileName)) {
                verifiedList.push(fileName);
                console.log('[toggle_verify_file] Added file, list:', verifiedList);
            }

            const jsonContent = JSON.stringify(verifiedList);
            let writeSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await client.putFileContents(verifiedJsonPath, Buffer.from(jsonContent));
                    await sleep(200);
                    writeSuccess = true;
                    console.log('[toggle_verify_file] WebDAV write OK');
                    break;
                } catch (e) { await sleep(500); }
            }

            try {
                const reqId = folderName.split('_')[0];
                await withRequestsLock(async (requests) => {
                    const idx = requests.findIndex(r => String(r.ID) === String(reqId));
                    if (idx === -1) {
                        requests.push({ ID: reqId, DATE: new Date().toLocaleDateString('ru-RU'), full_name: '', car_number: '', email: '', verified_files: { [safeDocType]: { [fileName]: true } } });
                        console.log('[toggle_verify_file] Created new record');
                    } else {
                        if (!requests[idx].verified_files) requests[idx].verified_files = {};
                        if (!requests[idx].verified_files[safeDocType]) requests[idx].verified_files[safeDocType] = {};
                        requests[idx].verified_files[safeDocType][fileName] = true;
                        console.log('[toggle_verify_file] Updated record');
                    }
                });
                console.log('[toggle_verify_file] Database save OK');
            } catch (e) { console.error('[toggle_verify_file] DB error:', e.message); }

            const responseVerifiedFiles = { [safeDocType]: {} };
            verifiedList.forEach(f => { responseVerifiedFiles[safeDocType][f] = true; });
            const dbRequestForResponse = (await loadRequests()).find(r => String(r.ID) === String(reqId.split('_')[0]));
            console.log('[toggle_verify_file] END');
            return res.json({ success: true, verified: true, fileName: fileName, verifiedFiles: responseVerifiedFiles, verified_files: dbRequestForResponse?.verified_files || {} });
        }

        if (step === 'sync_request') {
            return res.json({ success: true });
        }

        if (step === 'commit_request') {
            const { type_requests } = req.body;
            if (folderName) {
                return res.json({ success: true, committed: true });
            }
            return res.status(400).json({ error: 'Missing data for commit' });
        }

        if (!folderName) {
            return res.status(400).json({ error: 'folderName missing' });
        }

        const clientPath = `/RegDoc_Заявки/${folderName}`;
        const finalPath = `${clientPath}/${docType === 'pz' ? 'Для ПЗ' : 'Для ПБ'}`;

        if (step === 'delete_folder') {
            if (await client.exists(clientPath)) await client.deleteFile(clientPath);
            return res.json({ success: true });
        }

        if (step === 'sub_folder') {
            await createDirWithRetry(finalPath);
            return res.json({ success: true });
        }

        if (!docType) {
            return res.status(400).json({ error: 'docType missing' });
        }

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
            await createDirWithRetry(`/RegDoc_Заявки`);
            await createDirWithRetry(`/RegDoc_Заявки/${newFolderName}`);
            return res.json({ success: true, folderName: newFolderName });
        }

        if (step === 'single_file') {
            console.log('[upload:single_file] START - folderName:', folderName, 'docType:', docType);

            // === ШАГ 1: Проверка Multer/парсера файлов ===
            if (!req.files || req.files.length === 0) {
                console.error('[upload:single_file] FATAL: No files in request!');
                return res.status(400).json({ error: 'Файл не получен бэкендом. Проверьте форму загрузки.' });
            }
            const file = req.files[0];
            console.log('[upload:single_file] File received:', {
                fieldname: file.fieldname,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                bufferLength: file.buffer ? file.buffer.length : 'NO_BUFFER'
            });

            if (!file.buffer || file.buffer.length === 0) {
                console.error('[upload:single_file] FATAL: Buffer is empty!');
                return res.status(400).json({ error: 'Файл пустой или повреждён.' });
            }

            // === ШАГ 2: Проверка WebDAV авторизации ===
            console.log('[upload:single_file] Checking WebDAV client...');
            try {
                const testPath = '/RegDoc_Заявки';
                const rootExists = await client.exists(testPath);
                console.log('[upload:single_file] WebDAV auth OK - root exists:', rootExists);
            } catch (authErr) {
                console.error('[upload:single_file] WebDAV AUTH ERROR:', authErr.message);
                console.error('[upload:single_file] WebDAV Status:', authErr.response?.status);
                console.error('[upload:single_file] WebDAV Body:', authErr.response?.body);
                return res.status(503).json({ error: 'Ошибка авторизации облака: ' + authErr.message });
            }

            // === ШАГ 3: Создание папок (ensureDirectoryExists) ===
            try {
                console.log('[upload:single_file] Ensuring clientPath:', clientPath);
                await ensureDirectoryExists(clientPath);
                console.log('[upload:single_file] Ensuring finalPath:', finalPath);
                await ensureDirectoryExists(finalPath);
            } catch (ensureErr) {
                console.error('[upload:single_file] FATAL: Failed to create directory structure:', ensureErr.message);
                return res.status(500).json({ error: 'Ошибка создания папок: ' + ensureErr.message });
            }

            // === ШАГ 4: Генерация имени файла ===
            const russianNames = { 'passport': 'ПАСПОРТ', 'snils': 'СНИЛС', 'sts': 'СТС', 'pts': 'ПТС', 'egrn': 'ВЫПИСКА_ЕГРН', 'balloon_passport': 'ПАСПОРТ_БАЛЛОНА', 'act_opresovki': 'АКТ_ОПРЕССОВКИ', 'cert_gbo': 'СЕРТИФИКАТ_ГБО', 'cert_balloon': 'СЕРТИФИКАТ_БАЛЛОНА', 'pte': 'ПРЕДВАРИТЕЛЬНОЕ_ЗАКЛЮЧЕНИЕ', 'zd': 'ЗАЯВЛЕНИЕ_ДЕКЛАРАЦИЯ', 'form207': 'ФОРМА_207', 'gibdd_zayavlenie': 'ЗАЯВЛЕНИЕ_ГИБДД', 'photo_left': 'ФОТО_СЛЕВА', 'photo_right': 'ФОТО_СПРАВА', 'photo_rear': 'ФОТО_СЗАДИ', 'photo_front': 'ФОТО_СПЕРЕДИ', 'photo_hood': 'ФОТО_КАПОТ', 'photo_vin': 'ФОТО_VIN', 'photo_kuzov': 'ФОТО_НОМЕР_КУЗОВА', 'photo_tablichka': 'ФОТО_ТАБЛИЧКА', 'photo_balloon_place': 'ФОТО_МЕСТО_БАЛЛОНА', 'photo_balloon_tablichka': 'ФОТО_ТАБЛИЧКА_БАЛЛОНА', 'photo_vent': 'ФОТО_ВЕНТ_КАНАЛОВ', 'photo_mult': 'ФОТО_МУЛЬТ', 'photo_reduktor': 'ФОТО_РЕДУКТОР', 'photo_ebu': 'ФОТО_ЭБУ', 'photo_forsunki': 'ФОТО_ФОРСУНКИ', 'photo_vzu': 'ФОТО_ВЗУ' };
            const cat = russianNames[file.fieldname] || 'ФАЙЛ';

            // Получаем список существующих файлов
            let existingFileNames = [];
            try {
                const existingItems = await client.getDirectoryContents(finalPath);
                existingFileNames = existingItems.filter(i => i.type === 'file').map(i => i.basename.toUpperCase());
                console.log('[upload:single_file] Existing files:', existingFileNames);
            } catch (e) {
                console.log('[upload:single_file] Could not list dir:', e.message);
            }

            // Ищем максимальный номер
            let maxNum = 0;
            existingFileNames.forEach(name => {
                if (name.startsWith(cat + '_')) {
                    const parts = name.split('_');
                    if (parts.length > 1) { const num = parseInt(parts[1]); if (!isNaN(num) && num > maxNum) maxNum = num; }
                }
            });

            // Формируем новое имя файла (НЕ меняем оригинальное имя, только добавляем префикс)
            const ext = file.originalname.split('.').pop().toLowerCase();
            const uniqueId = Date.now();
            const newFileName = `${cat}_${maxNum + 1}_${uniqueId}.${ext}`;

            // Убеждаемся что путь не содержит двойных слэшей
            const targetPath = `${finalPath}/${newFileName}`.replace(/\/+/g, '/');
            console.log('[upload:single_file] Target path (cleaned):', targetPath);

            // === ШАГ 5: Загрузка с retry ===
            let uploaded = false;
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`[upload:single_file] Uploading (attempt ${attempt}/3)...`);
                    await client.putFileContents(targetPath, file.buffer);
                    uploaded = true;
                    console.log('[upload:single_file] ✅ SUCCESS on attempt', attempt, '- file:', newFileName);

                    // Подтверждаем что файл загружен - проверяем его наличие
                    const exists = await client.exists(targetPath);
                    console.log('[upload:single_file] File exists after upload:', exists);
                    break;
                } catch (e) {
                    lastError = e;
                    console.error(`[upload:single_file] ❌ Attempt ${attempt} FAILED:`, e.message);
                    console.error('[upload:single_file] HTTP Status:', e.response?.status);
                    console.error('[upload:single_file] Response body:', e.response?.body);
                    if (attempt < 3) await sleep(500);
                }
            }

            if (!uploaded) {
                console.error('[upload:single_file] 💀 ALL ATTEMPTS FAILED');
                console.error('[upload:single_file] Last error:', lastError?.message);
                console.error('[upload:single_file] Last error status:', lastError?.response?.status);
                return res.status(500).json({
                    error: `Ошибка WebDAV: ${lastError?.message || 'Неизвестная ошибка'}`,
                    details: lastError?.response?.body || lastError?.message
                });
            }

            return res.json({ success: true, fileName: newFileName });
        }

        if (step === 'doc_file') {
            if (updateDescription !== 'false' && docType === 'pz') {
                const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: "Тип переоборудования:", bold: true, size: 28 })] }), new Paragraph({ children: [new TextRun({ text: conversionType || "", size: 24 })] })] }] });
                const docBuf = await Packer.toBuffer(doc);
                await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
            }
            const filesToCopyStr = req.body.filesToCopy;
            let filesToCopy = [];
            if (filesToCopyStr) { try { filesToCopy = JSON.parse(filesToCopyStr); } catch (e) { } }
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
                                    if (await client.exists(targetFile) === false) await client.copyFile(item.filename, targetFile);
                                }
                            }
                        }
                    }
                }
            }
            return res.json({ success: true });
        }

        if (step === 'save_edit') {
            if (updateDescription !== 'false' && docType === 'pz') {
                const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: "Тип переоборудования:", bold: true, size: 28 })] }), new Paragraph({ children: [new TextRun({ text: conversionType || "", size: 24 })] })] }] });
                const docBuf = await Packer.toBuffer(doc);
                await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
            }
            const filesToCopyStr = req.body.filesToCopy;
            let filesToCopy = [];
            if (filesToCopyStr) { try { filesToCopy = JSON.parse(filesToCopyStr); } catch (e) { } }
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
                                    if (await client.exists(targetFile) === false) await client.copyFile(item.filename, targetFile);
                                }
                            }
                        }
                    }
                }
            }
            return res.json({ success: true });
        }

        if (step === 'verify_files') {
            const verifiedFilesStr = req.body.verifiedFiles;
            let verifiedFiles = {};
            if (verifiedFilesStr) { try { verifiedFiles = JSON.parse(verifiedFilesStr); } catch (e) { console.error('[verify_files] Parse error:', e.message); } }
            try {
                const allRequests = await loadRequests();
                const reqId = folderName.split('_')[0];
                const req = allRequests.find(r => String(r.ID) === reqId);
                if (req) {
                    await withRequestsLock(async (requests) => {
                        const idx = requests.findIndex(r => String(r.ID) === String(reqId));
                        if (idx > -1) {
                            if (!requests[idx].verified_files) requests[idx].verified_files = {};
                            requests[idx].verified_files[docType] = verifiedFiles[docType] || {};
                        }
                    });
                    console.log('[verify_files] Saved for request', reqId);
                }
            } catch (e) { console.error('[verify_files] Error:', e.message); }
            return res.json({ success: true });
        }

        res.json({ success: false, error: "Unknown step" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default app;