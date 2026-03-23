import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createClient } from 'webdav';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import jwt from 'jsonwebtoken';
import authRouter from './authRouter.js';
import { loadRequests, withRequestsLock } from './userStore.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); 
app.use(cors()); app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'regdoc-api' });
});

app.get('/api/my-requests', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
        const userEmail = decoded.email.toLowerCase();

        const allRequests = await loadRequests();
        const userReqs = allRequests.filter(r => String(r.email).toLowerCase() === userEmail);
        
        const updates = [];
        for (let r of userReqs) {
            const dateParts = String(r.DATE).split('.');
            if (dateParts.length === 3) {
                const fName = String(r.full_name || '').trim().replace(/\s+/g, '_');
                const fPlate = normalizePlate(String(r.car_number || ''));
                const folderName = `[${dateParts[2]}.${dateParts[1]}.${dateParts[0]}][${fName}][${fPlate}]`;
                
                const pzExists = await client.exists(`/RegDoc_Заявки/${folderName}/Для ПЗ`);
                const pbExists = await client.exists(`/RegDoc_Заявки/${folderName}/Для ПБ`);
                
                const pzStatus = pzExists ? 'yes' : 'no';
                const pbStatus = pbExists ? 'yes' : 'no';
                
                if (r.type_PZ !== pzStatus || r.type_PB !== pbStatus) {
                    r.type_PZ = pzStatus;
                    r.type_PB = pbStatus;
                    updates.push(r);
                }
            }
        }

        if (updates.length > 0) {
            await withRequestsLock(async (requestsToUpdate) => {
                for (let u of updates) {
                    const idx = requestsToUpdate.findIndex(mainR => 
                        normalizePlate(String(mainR.car_number || '')) === normalizePlate(String(u.car_number || '')) && 
                        mainR.DATE === u.DATE && 
                        String(mainR.email || '').toLowerCase() === userEmail
                    );
                    if (idx > -1) {
                        requestsToUpdate[idx].type_PZ = u.type_PZ;
                        requestsToUpdate[idx].type_PB = u.type_PB;
                    }
                }
            });
        }

        res.json(userReqs);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.use('/api/auth', authRouter);

const client = createClient("https://webdav.cloud.mail.ru/", {
    username: process.env.VK_CLOUD_EMAIL,
    password: process.env.VK_CLOUD_PASSWORD
});

const normalizePlate = (plate) => {
    const map = {'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','Y':'У','X':'Х'};
    return plate.toUpperCase().replace(/[ABEKMHOPCTYX]/g, char => map[char] || char).replace(/[^А-ЯЁ0-9]/g, '');
};

async function syncRequestRecord(folderName, email) {
    const match = folderName.match(/\[(\d{4})\.(\d{2})\.(\d{2})\]\[(.*?)\]\[(.*?)\]/);
    if (!match) return;

    const dateStr = `${match[3]}.${match[2]}.${match[1]}`;
    const fullName = match[4].replace(/_/g, ' ');
    const plate = match[5];

    await withRequestsLock(async (requests) => {
        const userEmail = email.toLowerCase();
        const plateKey = normalizePlate(plate);
        
        let idx = requests.findIndex(r => 
            normalizePlate(String(r.car_number || '')) === plateKey && 
            String(r.email || '').toLowerCase() === userEmail
        );

        const pzExists = await client.exists(`/RegDoc_Заявки/${folderName}/Для ПЗ`);
        const pbExists = await client.exists(`/RegDoc_Заявки/${folderName}/Для ПБ`);

        const record = {
            DATE: dateStr,
            full_name: fullName,
            car_number: plate,
            email: userEmail,
            type_PZ: pzExists ? 'yes' : 'no',
            type_PB: pbExists ? 'yes' : 'no'
        };

        if (idx > -1) requests[idx] = record;
        else requests.push(record);
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
            
            // ИЗМЕНЕНО: Расширенная карта всех типов файлов для проверки наличия в облаке
            const existingFiles = {
                passport: [], snils: [], sts: [], pts: [], egrn: [],
                balloon_passport: [], act_opresovki: [], cert_gbo: [], cert_balloon: [],
                pte: [], zd: [], form207: [], gibdd_zayavlenie: [],
                photo_left: [], photo_right: [], photo_rear: [], photo_front: [],
                photo_hood: [], photo_vin: [], photo_kuzov: [], photo_tablichka: [],
                photo_balloon_place: [], photo_balloon_tablichka: [], photo_vent: [],
                photo_mult: [], photo_reduktor: [], photo_ebu: [], photo_forsunki: [], photo_vzu: []
            };

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
                                        break;
                                    }
                                }
                            }
                        }
                    });
                }
            }
            return res.json({ found: true, fullName: extractedName, existingFiles, hasDescription, folderName: folder.basename });
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
        const { step, folderName, clientType, docType, fullName, companyName, licensePlate, conversionType, updateDescription, copyDocsFromPZ } = req.body;
        
        let userEmail = "";
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET-in-env');
            userEmail = decoded.email;
        }

        if (step === 'sync_request') {
            if (userEmail && folderName) await syncRequestRecord(folderName, userEmail);
            return res.json({ success: true });
        }

        if (step === 'main_folder') {
            const now = new Date();
            const ekb = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Asia/Yekaterinburg', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
            const getV = (t) => ekb.find(p => p.type === t).value;
            const datePart = `[${getV('year')}.${getV('month')}.${getV('day')}]`;
            const rawName = clientType === 'legal' ? companyName : fullName;
            const namePart = `[${rawName.trim().replace(/\s+/g, '_')}]`;
            const platePart = `[${normalizePlate(licensePlate)}]`;
            
            const newFolderName = `${datePart}${namePart}${platePart}`;
            await createDirWithRetry(`/RegDoc_Заявки`);
            await createDirWithRetry(`/RegDoc_Заявки/${newFolderName}`);
            
            if (userEmail) await syncRequestRecord(newFolderName, userEmail);
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
            if (userEmail) await syncRequestRecord(folderName, userEmail);
            return res.json({ success: true });
        }

        // ИЗМЕНЕНО: Расширенная карта имен для загрузки файлов
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

        // ИЗМЕНЕНО: Логика копирования базовых файлов из ПЗ в ПБ
        if (step === 'doc_file') {
            if (updateDescription !== 'false' && docType === 'pz') {
                const doc = new Document({sections: [{children: [new Paragraph({children: [new TextRun({text: "Тип переоборудования:", bold: true, size: 28})]}) , new Paragraph({children: [new TextRun({text: conversionType || "", size: 24})]})]}]});
                const docBuf = await Packer.toBuffer(doc);
                await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
            }

            if (copyDocsFromPZ === 'true' && docType === 'pb') {
                const pzPath = `/RegDoc_Заявки/${folderName}/Для ПЗ`;
                if (await client.exists(pzPath)) {
                    const pzItems = await client.getDirectoryContents(pzPath);
                    for (const item of pzItems) {
                        if (item.type === 'file') {
                            const name = item.basename.toUpperCase();
                            if (name.startsWith('ПАСПОРТ_') || name.startsWith('СНИЛС_') || name.startsWith('СТС_') || name.startsWith('ПТС_') || name.startsWith('ВЫПИСКА_ЕГРН_')) {
                                const targetFile = `${finalPath}/${item.basename}`;
                                if (await client.exists(targetFile) === false) {
                                    await client.copyFile(item.filename, targetFile);
                                }
                            }
                        }
                    }
                }
            }

            if (userEmail) await syncRequestRecord(folderName, userEmail);
            return res.json({ success: true });
        }

        res.json({ success: false, error: "Unknown step" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default app;