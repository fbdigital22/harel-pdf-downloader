const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;
const sleep = promisify(setTimeout);

app.use(express.json());

// נתיב ההורדה הזמני (ב-Render מותר לכתוב ל-/tmp)
const DOWNLOAD_PATH = '/tmp/downloads';

// ניקוי תיקייה בהפעלה
if (!fs.existsSync(DOWNLOAD_PATH)) {
    fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
}

app.get('/', (req, res) => res.send('Filesystem Downloader is Ready'));

app.post('/download-pdf', async (req, res) => {
    console.log('--- התחלת תהליך (שיטת שמירה לדיסק) ---');
    const { ticket, password = '85005' } = req.body;

    if (!ticket) return res.status(400).json({ error: 'ticket is required' });

    // ניקוי קבצים ישנים מהתיקייה לפני התחלה
    fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));

    let browser;
    try {
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
        
        // *** הפקודה שמכריחה הורדה לדיסק ***
        // אנחנו מתחברים לפרוטוקול של כרום ואומרים לו: "כל קובץ שיורד - לתיקייה הזו!"
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOAD_PATH,
        });

        console.log(`Navigating to Harel...`);
        const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log('Typing agent code...');
        const agentCodeSelector = '#tz0';
        await page.waitForSelector(agentCodeSelector, { timeout: 15000 });
        await page.type(agentCodeSelector, password);

        console.log('Clicking submit & Waiting for file...');
        const continueButtonSelector = 'button[type="submit"]';
        await page.click(continueButtonSelector);

        // *** לולאת המתנה לקובץ ***
        // אנחנו בודקים את התיקייה כל חצי שנייה לראות אם הקובץ הגיע
        let downloadedFile = null;
        const maxWaitTime = 60000; // מחכים מקסימום דקה
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const files = fs.readdirSync(DOWNLOAD_PATH);
            // מחפשים קובץ שנגמר ב-pdf ולא נגמר ב-crdownload (קובץ זמני של כרום)
            const found = files.find(file => file.toLowerCase().endsWith('.pdf'));
            
            if (found) {
                // מוודאים שהקובץ סיים לרדת (גודל סטטי)
                downloadedFile = path.join(DOWNLOAD_PATH, found);
                console.log(`File detected on disk: ${found}`);
                await sleep(1000); // נותנים לו שנייה אחרונה להיסגר
                break;
            }
            await sleep(500); // בדיקה חוזרת
        }

        if (!downloadedFile) {
            throw new Error('Timeout: File did not appear in the download folder.');
        }

        // קריאת הקובץ מהדיסק
        console.log('Reading file from disk...');
        const pdfBuffer = fs.readFileSync(downloadedFile);
        
        // המרה ושליחה
        const base64Pdf = pdfBuffer.toString('base64');
        console.log(`Success! PDF size: ${pdfBuffer.length}`);

        res.json({
            success: true,
            pdf: base64Pdf,
            filename: path.basename(downloadedFile),
            size: pdfBuffer.length
        });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
        // (אופציונלי) ניקוי התיקייה בסוף
        try {
            if (fs.existsSync(DOWNLOAD_PATH)) {
                fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));
            }
        } catch (e) { console.error('Cleanup error', e); }
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
