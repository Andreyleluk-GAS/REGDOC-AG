import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createClient } from 'webdav';
import dotenv from 'dotenv';
import { Document, Packer, Paragraph, TextRun } from 'docx';

dotenv.config();
const app = express();
const upload = multer({ storage: multer.memoryStorage() }); 
app.use(cors()); app.use(express.json());

const client = createClient("https://webdav.cloud.mail.ru/", {
    username: process.env.VK_CLOUD_EMAIL,
    password: process.env.VK_CLOUD_PASSWORD
});

const normalizePlate = (plate) => {
    const map = {'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','Y':'У','X':'Х'};
    return plate.toUpperCase().replace(/[ABEKMHOPCTYX]/g, char => map[char] || char).replace(/[^А-ЯЁ0-9]/g, '');
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/api/check-plate', async (req, res) => {
    try {
        const { plate } = req.query;
        if (!plate) return res.status(400).json({ error: 'Номер не указан' });
        const searchPlate = normalizePlate(plate);
        const rootPath = `/RegDoc_Заявки`;
        if (await client.exists(rootPath) === false) return res.json({ found: false });
        const items = await client.getDirectoryContents(rootPath);
        const folder = items.find(i => i.type === 'directory' && normalizePlate(i.basename).includes(searchPlate));

        if (folder) {
            const match = folder.basename.match(/\[.*?\]\[(.*?)\]\[.*?\]/);
            const extractedName = match ? match[1].replace(/_/g, ' ') : "Клиент";
            const existingFiles = { passport: [], snils: [], sts: [], pts: [] };
            let hasDescription = false; // --- ДОБАВЛЕНО: Флаг наличия описания
            const subFolders = ['Для ПЗ', 'Для ПБ'];
            for (const sub of subFolders) {
                const subPath = `${folder.filename}/${sub}`;
                if (await client.exists(subPath)) {
                    const contents = await client.getDirectoryContents(subPath);
                    contents.forEach(file => {
                        if (file.type === 'file') {
                            // --- ДОБАВЛЕНО: Ищем описание.docx
                            if (file.basename.toLowerCase() === 'описание.docx') {
                                hasDescription = true;
                            } else if (!file.basename.includes('.docx')) {
                                const name = file.basename.toUpperCase();
                                if (name.includes('ПАСПОРТ')) existingFiles.passport.push(file.basename);
                                if (name.includes('СНИЛС')) existingFiles.snils.push(file.basename);
                                if (name.includes('СТС')) existingFiles.sts.push(file.basename);
                                if (name.includes('ПТС')) existingFiles.pts.push(file.basename);
                            }
                        }
                    });
                }
            }
            return res.json({ found: true, fullName: extractedName, existingFiles, hasDescription });
        }
        res.json({ found: false });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

async function createDirWithRetry(path) {
    if (await client.exists(path) === false) {
        await client.createDirectory(path);
        await sleep(500); 
    }
}

async function uploadFileWithRetry(path, buffer) {
    for (let i = 0; i < 3; i++) {
        try { await client.putFileContents(path, buffer); return; } catch (e) { await sleep(2000); }
    }
}

app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        // --- ДОБАВЛЕНО: Принимаем флаг updateDescription
        const { clientType, docType, fullName, companyName, licensePlate, conversionType, updateDescription } = req.body;
        
        const now = new Date();
        const ekb = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Asia/Yekaterinburg', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
        const getV = (t) => ekb.find(p => p.type === t).value;
        const datePart = `[${getV('year')}.${getV('month')}.${getV('day')}]`;

        const rawName = clientType === 'legal' ? companyName : fullName;
        const namePart = `[${rawName.trim().replace(/\s+/g, '_')}]`;
        const platePart = `[${normalizePlate(licensePlate)}]`;
        
        const mainFolderName = `${datePart}${namePart}${platePart}`;
        const subFolderName = docType === 'pz' ? 'Для ПЗ' : 'Для ПБ';
        
        const rootPath = `/RegDoc_Заявки`;
        const clientPath = `${rootPath}/${mainFolderName}`;
        const finalPath = `${clientPath}/${subFolderName}`;

        await createDirWithRetry(rootPath);
        await createDirWithRetry(clientPath);
        await createDirWithRetry(finalPath);

        // --- ДОБАВЛЕНО: Создаем описание.docx только если разрешено
        if (updateDescription !== 'false') {
            const doc = new Document({sections: [{children: [new Paragraph({children: [new TextRun({text: "Тип переоборудования:", bold: true, size: 28})]}) , new Paragraph({children: [new TextRun({text: conversionType || "", size: 24})]})]}]});
            const docBuf = await Packer.toBuffer(doc);
            await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
        }

        const russianNames = { 'passport': 'ПАСПОРТ', 'snils': 'СНИЛС', 'sts': 'СТС', 'pts': 'ПТС' };
        
        let existingFileNames = [];
        if (await client.exists(finalPath)) {
            const existingItems = await client.getDirectoryContents(finalPath);
            existingFileNames = existingItems.filter(i => i.type === 'file').map(i => i.basename.toUpperCase());
        }

        const counters = { 'ПАСПОРТ': 0, 'СНИЛС': 0, 'СТС': 0, 'ПТС': 0, 'ФАЙЛ': 0 };

        existingFileNames.forEach(name => {
            Object.keys(counters).forEach(cat => {
                if (name.startsWith(cat + '_')) {
                    const parts = name.split('_');
                    if (parts.length > 1) {
                        const num = parseInt(parts[1]);
                        if (!isNaN(num) && num > counters[cat]) {
                            counters[cat] = num;
                        }
                    }
                }
            });
        });

        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const cat = russianNames[file.fieldname] || 'ФАЙЛ';
            
            counters[cat]++; 
            const ext = file.originalname.split('.').pop().toLowerCase();
            const newFileName = `${cat}_${counters[cat]}.${ext}`;
            
            await uploadFileWithRetry(`${finalPath}/${newFileName}`, file.buffer);
        }

        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default app;