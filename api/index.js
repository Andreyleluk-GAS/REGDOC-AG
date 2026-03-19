import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createClient } from 'webdav';
import dotenv from 'dotenv';
import { Document, Packer, Paragraph, TextRun } from 'docx';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); 

app.use(cors());
app.use(express.json());

const client = createClient(
    "https://webdav.cloud.mail.ru/",
    {
        username: process.env.VK_CLOUD_EMAIL,
        password: process.env.VK_CLOUD_PASSWORD
    }
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function createDirWithRetry(path) {
    if (await client.exists(path) === false) {
        await client.createDirectory(path);
        await sleep(500); 
    }
}

async function uploadFileWithRetry(path, buffer, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await client.putFileContents(path, buffer);
            return; 
        } catch (error) {
            console.log(`⚠️ Облако тормозит (Попытка ${i + 1} из ${retries}). Ждем 2 сек...`);
            if (i === retries - 1) throw error; 
            await sleep(2000); 
        }
    }
}

app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        console.log('--- Обработка новой заявки (Время Екатеринбурга) ---');
        
        const { clientType, docType, fullName, companyName, licensePlate, conversionType } = req.body;
        const files = req.files;

        // --- ЛОГИКА ВРЕМЕНИ ЕКАТЕРИНБУРГА (UTC+5) ---
        const now = new Date();
        const ekbTime = new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Asia/Yekaterinburg',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(now);

        const getValue = (type) => ekbTime.find(p => p.type === type).value;

        const Y = getValue('year');
        const M = getValue('month');
        const D = getValue('day');
        const HH = getValue('hour');
        const mm = getValue('minute');

        const timestamp = `${Y}.${M}.${D}_${HH}.${mm}`;
        // ------------------------------------------

        const rawName = clientType === 'legal' ? companyName : fullName;
        const formattedName = rawName.trim().replace(/\s+/g, '_');
        const cleanPlate = licensePlate.replace(/[\/\s]/g, '');
        
        const mainFolderName = `${timestamp}_${formattedName}_${cleanPlate}`;
        const subFolderName = docType === 'pz' ? 'Для ПЗ' : 'Для ПБ';

        const rootPath = `/RegDoc_Заявки`;
        const clientPath = `${rootPath}/${mainFolderName}`;
        const finalPath = `${clientPath}/${subFolderName}`;

        await createDirWithRetry(rootPath);
        await createDirWithRetry(clientPath);
        await createDirWithRetry(finalPath);

        const doc = new Document({
            sections: [{
                children: [
                    new Paragraph({ children: [new TextRun({ text: "Тип переоборудования:", bold: true, size: 28 })] }),
                    new Paragraph({ children: [new TextRun({ text: conversionType || "Не указано", size: 24 })] }),
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        await uploadFileWithRetry(`${finalPath}/описание.docx`, buffer);

        const russianNames = { 'passport': 'ПАСПОРТ', 'snils': 'СНИЛС', 'sts': 'СТС', 'pts': 'ПТС' };
        const counters = {};

        for (const file of files) {
            const categoryBase = russianNames[file.fieldname] || file.fieldname.toUpperCase();
            counters[categoryBase] = (counters[categoryBase] || 0) + 1;
            const extension = file.originalname.split('.').pop();
            const newFileName = `${categoryBase}_${counters[categoryBase]}.${extension}`;
            
            await uploadFileWithRetry(`${finalPath}/${newFileName}`, file.buffer);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default app;