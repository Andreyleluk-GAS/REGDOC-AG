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

// Функция-помощник для микро-пауз
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🛡 Бронебойная функция для создания папок с повторными попытками
async function createDirWithRetry(path) {
    if (await client.exists(path) === false) {
        await client.createDirectory(path);
        await sleep(500); // Даем Mail.ru полсекунды на "осознание", что папка создана
    }
}

// 🛡 Бронебойная функция для загрузки файлов (если Mail.ru выдает 504, пробуем снова)
async function uploadFileWithRetry(path, buffer, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await client.putFileContents(path, buffer);
            return; // Успешно загрузили - выходим
        } catch (error) {
            console.log(`⚠️ Облако тормозит (Попытка ${i + 1} из ${retries}). Ждем 2 сек...`);
            if (i === retries - 1) throw error; // Если попытки закончились - сдаемся
            await sleep(2000); // Ждем 2 секунды перед повтором
        }
    }
}

app.post('/api/upload', upload.any(), async (req, res) => {
    try {
        console.log('--- Обработка новой заявки (Бронебойный режим) ---');
        
        const { clientType, docType, fullName, companyName, licensePlate, conversionType } = req.body;
        const files = req.files;

        // Формируем дату и имена
        const now = new Date();
        const Y = now.getFullYear();
        const M = String(now.getMonth() + 1).padStart(2, '0');
        const D = String(now.getDate()).padStart(2, '0');
        const HH = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const timestamp = `${Y}.${M}.${D}_${HH}.${mm}`;

        const rawName = clientType === 'legal' ? companyName : fullName;
        const formattedName = rawName.trim().replace(/\s+/g, '_');
        const cleanPlate = licensePlate.replace(/[\/\s]/g, '');
        
        const mainFolderName = `${timestamp}_${formattedName}_${cleanPlate}`;
        const subFolderName = docType === 'pz' ? 'Для ПЗ' : 'Для ПБ';

        const rootPath = `/RegDoc_Заявки`;
        const clientPath = `${rootPath}/${mainFolderName}`;
        const finalPath = `${clientPath}/${subFolderName}`;

        console.log(`Создаю структуру папок...`);

        // Создаем папки аккуратно, с паузами
        await createDirWithRetry(rootPath);
        await createDirWithRetry(clientPath);
        await createDirWithRetry(finalPath);

        // --- ГЕНЕРАЦИЯ WORD ФАЙЛА ---
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
        console.log('✅ Файл описание.docx создан');

        // --- ЗАГРУЗКА ФОТОГРАФИЙ ---
        const russianNames = { 'passport': 'ПАСПОРТ', 'snils': 'СНИЛС', 'sts': 'СТС', 'pts': 'ПТС' };
        const counters = {};

        for (const file of files) {
            const categoryBase = russianNames[file.fieldname] || file.fieldname.toUpperCase();
            counters[categoryBase] = (counters[categoryBase] || 0) + 1;
            const extension = file.originalname.split('.').pop();
            const newFileName = `${categoryBase}_${counters[categoryBase]}.${extension}`;
            
            console.log(`Отправляю в облако: ${newFileName}`);
            // Используем нашу функцию с повторными попытками
            await uploadFileWithRetry(`${finalPath}/${newFileName}`, file.buffer);
            console.log(`✅ Загружен: ${newFileName}`);
        }

        console.log('🚀 Заявка успешно сохранена!');
        res.json({ success: true });

    } catch (error) {
        console.error('❌ Финальная Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(3000, () => {
    console.log(`✅ Сервер REGDOC запущен (Защита от 504 Timeout активна)`);
});