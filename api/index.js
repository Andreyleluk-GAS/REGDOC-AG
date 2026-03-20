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
            const existingFiles = { passport: [], snils: [], sts: [], pts: [] };
            
            // СТРОГАЯ ЛОКАЛЬНАЯ ПРАВКА: Проверяем наличие описания для ПЗ и ПБ отдельно
            let hasDescriptionPZ = false; 
            let hasDescriptionPB = false; 
            
            const subFolders = ['Для ПЗ', 'Для ПБ'];
            for (const sub of subFolders) {
                const subPath = `${folder.filename}/${sub}`;
                if (await client.exists(subPath)) {
                    const contents = await client.getDirectoryContents(subPath);
                    contents.forEach(file => {
                        if (file.type === 'file') {
                            if (file.basename.toLowerCase() === 'описание.docx') {
                                if (sub === 'Для ПЗ') hasDescriptionPZ = true;
                                if (sub === 'Для ПБ') hasDescriptionPB = true;
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
            return res.json({ found: true, fullName: extractedName, existingFiles, hasDescriptionPZ, hasDescriptionPB, folderName: folder.basename });
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
            const russianNames = { 'passport': 'ПАСПОРТ', 'snils': 'СНИЛС', 'sts': 'СТС', 'pts': 'ПТС' };
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
            return res.json({ success: true });
        }

        if (step === 'doc_file') {
            if (updateDescription !== 'false') {
                const doc = new Document({sections: [{children: [new Paragraph({children: [new TextRun({text: "Тип переоборудования:", bold: true, size: 28})]}) , new Paragraph({children: [new TextRun({text: conversionType || "", size: 24})]})]}]});
                const docBuf = await Packer.toBuffer(doc);
                await uploadFileWithRetry(`${finalPath}/описание.docx`, docBuf);
            }
            return res.json({ success: true });
        }

        res.json({ success: false, error: "Unknown step" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default app;