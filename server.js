const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const pdf = require('pdf-parse'); 

const app = express();
const PORT = process.env.PORT || 3000;
const sleep = promisify(setTimeout);

app.use(express.json());

// נתיב ההורדה הזמני
const DOWNLOAD_PATH = '/tmp/downloads';
if (!fs.existsSync(DOWNLOAD_PATH)) {
    fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
}

app.get('/', (req, res) => res.send('PDF Downloader with Data Extraction is Ready'));

// פונקציה מרכזית לביצוע כל הלוגיקה (משותפת לשני ה-Endpoints)
async function processPdf(ticket, password) {
    let browser;
    let downloadedFile = null;
    let extractedData = {};
    let pdfBuffer = null;

    try {
        // 1. הגדרות Puppeteer
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            defaultViewport: chromium.defaultViewport,
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--disable-gpu'],
        });

        const page = await browser.newPage();
        
        // הגדרת התנהגות הורדה לדיסק
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOAD_PATH,
        });

        await sleep(Math.floor(Math.random() * 3000) + 2000); 

        const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const agentCodeSelector = '#tz0';
        await page.waitForSelector(agentCodeSelector, { timeout: 60000 });
        await page.type(agentCodeSelector, password);

        const continueButtonSelector = 'button[type="submit"]';
        await page.click(continueButtonSelector);

        // 2. המתנה להורדה
        const maxWaitTime = 90000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const files = fs.readdirSync(DOWNLOAD_PATH);
            const found = files.find(file => file.toLowerCase().endsWith('.pdf'));
            
            if (found) {
                downloadedFile = path.join(DOWNLOAD_PATH, found);
                await sleep(1000); 
                break;
            }
            await sleep(500); 
        }

        if (!downloadedFile) {
            throw new Error('Timeout: File did not appear in the download folder.');
        }

        // 3. קריאה, ניתוח וחילוץ נתונים
        pdfBuffer = fs.readFileSync(downloadedFile);
        const data = await pdf(pdfBuffer);
        const rawText = data.text;
        
        // חילוץ נתון 1: מספר חשבון
        const accNumRegex = /(\d+)מחשבון/; 
        const accMatch = accNumRegex.exec(rawText);
        extractedData.accountNumber = accMatch && accMatch[1] ? accMatch[1].trim() : 'Not Found';

        // חילוץ נתון 3: תאריך העסקה (התיקון הסופי)
        const dateRegex = /(\d{1,2}\/\d{1,2}\/\d{4}).*?הננו להודיעך/; 
        const dateMatch = dateRegex.exec(rawText);
        extractedData.transactionDate = dateMatch && dateMatch[1] ? dateMatch[1].trim() : 'Not Found';

        // חילוץ נתון 2: סכום סה"כ לתשלום
        const totalAmountRegex = /₪([\d\.\,]+)\s*סה"כ/; 
        const totalMatch = totalAmountRegex.exec(rawText);
        extractedData.totalAmount = totalMatch && totalMatch[1] ? totalMatch[1].trim().replace(/,/g, '') : 'Amount Not Found'; 
        extractedData.filename = path.basename(downloadedFile);
        
        return { extractedData, pdfBuffer, success: true, downloadedFile };

    } catch (error) {
        throw new Error(`Processing Error: ${error.message}`);
    } finally {
        if (browser) await browser.close();
        // ניקוי קבצים (נשאיר אותם אם הכל הצליח כדי שה-Endpoint השני יוכל להשתמש בהם)
        // אבל נמחק אם הייתה שגיאה
        if (!extractedData.accountNumber) {
             try {
                if (fs.existsSync(DOWNLOAD_PATH)) {
                    fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));
                }
            } catch (e) { console.error('Cleanup error', e); }
        }
    }
}

// Endpoint 1: משיכת הנתונים המחולצים (JSON)
app.post('/extract-data', async (req, res) => {
    console.log('--- Endpoint /extract-data: START ---');
    const { ticket, password = '85005' } = req.body; 

    if (!ticket) return res.status(400).json({ error: 'ticket is required' });

    try {
        const result = await processPdf(ticket, password);
        
        // שומר את הקובץ ב-TEMP כדי שה-Endpoint השני יוכל להשתמש בו מיד
        // (אחרת נצטרך לרוץ על כל הלוגיקה שוב)
        // אם אתה משתמש ב-Render, זה יעבוד רק למשך זמן קצר מאוד עד שהקובץ נמחק
        
        res.json({
            success: true,
            extractedData: result.extractedData
        });

    } catch (error) {
        console.error('Extraction Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint 2: הורדת הקובץ הבינארי הגולמי (PDF)
app.post('/download-pdf', async (req, res) => {
    console.log('--- Endpoint /download-pdf: START ---');
    const { ticket, password = '85005' } = req.body; 

    if (!ticket) return res.status(400).json({ error: 'ticket is required' });

    try {
        // בגלל מגבלות שרתים ללא מצב (Stateless), אנו מבצעים את כל הלוגיקה שוב
        const result = await processPdf(ticket, password); 
        
        // שליחת הנתונים הבינאריים ישירות ללקוח (Make)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${result.extractedData.filename}`);
        
        res.send(result.pdfBuffer); 
        
    } catch (error) {
        console.error('Download Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
    // ניקוי הקבצים לאחר סיום
    try {
        if (fs.existsSync(DOWNLOAD_PATH)) {
            fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));
        }
    } catch (e) { console.error('Cleanup error', e); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
