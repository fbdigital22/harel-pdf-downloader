const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const pdf = require('pdf-parse'); // ייבוא ספריית ניתוח PDF

const app = express();
const PORT = process.env.PORT || 3000;
const sleep = promisify(setTimeout);

app.use(express.json());

// נתיב ההורדה הזמני (ב-Render מותר לכתוב ל-/tmp)
const DOWNLOAD_PATH = '/tmp/downloads';
if (!fs.existsSync(DOWNLOAD_PATH)) {
    fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
}

app.get('/', (req, res) => res.send('PDF Downloader with Data Extraction is Ready'));

app.post('/download-pdf', async (req, res) => {
    console.log('--- התחלת תהליך (קוד סופי) ---');
    // מקבלים את ה-password מה-Body של הבקשה; ברירת המחדל היא 85005
    const { ticket, password = '85005' } = req.body; 

    if (!ticket) return res.status(400).json({ error: 'ticket is required' });

    // ניקוי קבצים ישנים
    fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));

    let browser;
    try {
        // 1. הגדרות Puppeteer והכנה להורדה
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
        
        // הגדרת התנהגות הורדה לדיסק (CDP Session)
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOAD_PATH,
        });

        console.log(`Navigating to Harel with ticket: ${ticket}`);
        const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log(`Typing agent code: ${password}`);
        const agentCodeSelector = '#tz0';
        await page.waitForSelector(agentCodeSelector, { timeout: 15000 });
        await page.type(agentCodeSelector, password);

        console.log('Clicking submit & Waiting for file...');
        const continueButtonSelector = 'button[type="submit"]';
        await page.click(continueButtonSelector);

        // 2. המתנה להורדה לדיסק
        let downloadedFile = null;
        const maxWaitTime = 60000; // מקסימום דקה
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
        
        // הדפסת הטקסט הגולמי ללוגים לצורך וידוא
        console.log('--- RAW TEXT FOR DEBUGGING (Start) ---');
        console.log(rawText.substring(0, 1000));
        console.log('--- RAW TEXT FOR DEBUGGING (End) ---');
        
        // *** 🛠️ חילוץ נתון 1: מספר חשבון (מותאם למיקום החדש) ***
        // תופס סדרת ספרות המופיעה **מיד לפני** המילה 'מחשבון' בטקסט הגולמי.
        const accNumRegex = /(\d+)מחשבון/; 
        const accMatch = accNumRegex.exec(rawText);
        const accountNumber = accMatch && accMatch[1] ? accMatch[1].trim() : 'Not Found';

        // *** 🛠️ חילוץ נתון 2: סכום סה"כ לתשלום (מותאם לקידוד הפוך ופסיקים) ***
        // התבנית תופסת את המספר (מודבק ל-₪, כולל פסיקים/נקודות) ואז בודקת שהוא מלווה ב-'סה"כ'
        const totalAmountRegex = /₪([\d\.\,]+)\s*סה"כ/; 
        const totalMatch = totalAmountRegex.exec(rawText);
        
        // מנקים פסיקים לפני שמירת הסכום
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
        console.error('Final Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
        // ניקוי תיקיית ההורדות בסוף
        try {
            if (fs.existsSync(DOWNLOAD_PATH)) {
                fs.readdirSync(DOWNLOAD_PATH).forEach(f => fs.unlinkSync(path.join(DOWNLOAD_PATH, f)));
            }
        } catch (e) { console.error('Cleanup error', e); }
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
