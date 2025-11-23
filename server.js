const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const pdf = require('pdf-parse'); // ייבוא ספריית הניתוח

const app = express();
const PORT = process.env.PORT || 3000;
const sleep = promisify(setTimeout);

app.use(express.json());

const DOWNLOAD_PATH = '/tmp/downloads';
if (!fs.existsSync(DOWNLOAD_PATH)) {
    fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
}

app.get('/', (req, res) => res.send('PDF Downloader with Data Extraction is Ready'));

app.post('/download-pdf', async (req, res) => {
    console.log('--- התחלת תהליך (עם חילוץ נתונים) ---');
    const { ticket, password = '85005' } = req.body;

    if (!ticket) return res.status(400).json({ error: 'ticket is required' });

    fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));

    let browser;
    try {
        // 1. הגדרות Puppeteer
        browser = await puppeteer.launch({
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            defaultViewport: chromium.defaultViewport,
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--disable-gpu',
            ],
        });

        const page = await browser.newPage();
        
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOAD_PATH,
        });

        const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const agentCodeSelector = '#tz0';
        await page.waitForSelector(agentCodeSelector, { timeout: 15000 });
        await page.type(agentCodeSelector, password);

        const continueButtonSelector = 'button[type="submit"]';
        await page.click(continueButtonSelector);

        // 2. המתנה להורדה לדיסק
        let downloadedFile = null;
        const maxWaitTime = 60000; 
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const files = fs.readdirSync(DOWNLOAD_PATH);
            const found = files.find(file => file.toLowerCase().endsWith('.pdf'));
            
            if (found) {
                downloadedFile = path.join(DOWNLOAD_PATH, found);
                console.log(`File detected on disk: ${found}`);
                await sleep(1000); 
                break;
            }
            await sleep(500); 
        }

        if (!downloadedFile) {
            throw new Error('Timeout: File did not appear in the download folder.');
        }

        // 3. קריאה, ניתוח וחילוץ נתונים
        const pdfBuffer = fs.readFileSync(downloadedFile);
        
        // המרת ה-PDF לטקסט גולמי
        const data = await pdf(pdfBuffer);
        const rawText = data.text;
        
        // **** טיפ לווידוא: הדפס את כל הטקסט הגולמי ללוגים ****
        // הדבר הזה יאפשר לך לראות אם ה-RegEx עובד נכון.
        // אם הנתונים לא נשלפים, הסתכל בלוגים כדי לראות את הרווחים והמעברי שורה בטקסט הגולמי.
        console.log('--- RAW TEXT FOR DEBUGGING (Start) ---');
        console.log(rawText.substring(0, 1000)); // מדפיס רק את 1000 התווים הראשונים
        console.log('--- RAW TEXT FOR DEBUGGING (End) ---');
        
        // חילוץ נתון 1: מספר חשבון (מספר תכנית)
        // התבנית מחפשת אחרי "חשבון" ואז רווחים ואז קבוצת מספרים
        const accNumRegex = /מספר חשבון\s*(\d+)/;
        const accMatch = accNumRegex.exec(rawText);
        const accountNumber = accMatch && accMatch[1] ? accMatch[1].trim() : 'Not Found';

        // חילוץ נתון 2: סכום סה"כ לתשלום (318.71 ₪)
        // התבנית מחפשת אחרי "סה"כ:" ואז סימן ₪ ואז המספר
        // (משתמשים ב-\s* לכל סוגי הרווחים)
        const totalAmountRegex = /סה"כ:\s*₪\s*([\d\.\,]+)/;
        const totalMatch = totalAmountRegex.exec(rawText);
        
        let totalAmount = totalMatch && totalMatch[1] ? totalMatch[1].trim().replace(/,/g, '') : 'Amount Not Found'; 
        
        console.log(`Extracted Account Number: ${accountNumber}`);
        console.log(`Extracted Total Amount: ${totalAmount}`);


        // 4. שליחת התשובה
        const base64Pdf = pdfBuffer.toString('base64');

        res.json({
            success: true,
            pdf: base64Pdf,
            filename: path.basename(downloadedFile),
            size: pdfBuffer.length,
            extractedData: {
                accountNumber: accountNumber,
                totalAmount: totalAmount
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
        try {
            if (fs.existsSync(DOWNLOAD_PATH)) {
                fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));
            }
        } catch (e) { console.error('Cleanup error', e); }
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
