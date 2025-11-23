// ========== חלק 1: הגדרות בסיסיות ==========
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium'); 

const app = express();
const PORT = process.env.PORT || 3000;

// מאפשר קריאת גוף הבקשה
app.use(express.json());

// בדיקת שרת
app.get('/', (req, res) => res.send('Server is Up & Running'));

// ========== הפונקציה להורדת ה-PDF ==========
app.post('/download-pdf', async (req, res) => {
  console.log('--- התחלת תהליך הורדה (גרסה מתוקנת) ---');
  const { ticket, password = '85005' } = req.body;
  
  if (!ticket) return res.status(400).json({ error: 'ticket is required' });

  let browser;
  try {
    // 1. הרצת דפדפן
    browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(), 
      headless: chromium.headless, 
      defaultViewport: chromium.defaultViewport,
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    
    // User Agent כדי להיראות כמו דפדפן רגיל
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // 2. כניסה לדף
    const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); 
    
    // 3. הזנת מספר סוכן (#tz0)
    console.log('Searching for agent input...');
    const agentCodeSelector = '#tz0'; 
    await page.waitForSelector(agentCodeSelector, { timeout: 15000 });
    await page.type(agentCodeSelector, password); 

    // 4. *** המסננת החכמה ***
    // אנחנו מגדירים למה אנחנו מחכים לפני הלחיצה
    const pdfPromise = page.waitForResponse(response => {
        // בדיקה 1: האם ה-URL נכון?
        const isUrlMatch = response.url().includes('single-doc-viewer');
        
        // בדיקה 2: האם זה קובץ PDF?
        const contentType = response.headers()['content-type'];
        const isPdf = contentType && contentType.toLowerCase().includes('pdf');
        
        // בדיקה 3 (התיקון החדש): האם הבקשה הצליחה (200) והיא לא preflight?
        // אנחנו רוצים רק סטטוס 200. לא 204, לא 302, ולא OPTIONS.
        const isStatusOk = response.status() === 200;
        const isMethodGet = response.request().method() === 'GET';

        // לוגים לצורך דיבוג - יופיעו ב-Render אם משהו לא עובד
        if (isUrlMatch) {
            console.log(`Potential Match Found: Status=${response.status()}, Method=${response.request().method()}, Type=${contentType}`);
        }

        return isUrlMatch && isPdf && isStatusOk && isMethodGet;
    }, { timeout: 60000 }); // מחכים עד 60 שניות לקובץ

    // 5. לחיצה על כפתור "המשך"
    console.log('Clicking submit...');
    const continueButtonSelector = 'button[type="submit"]'; 
    await page.click(continueButtonSelector);
    
    // 6. המתנה לקובץ האמיתי
    console.log('Waiting for PDF response packet...');
    const pdfResponse = await pdfPromise;
    
    if (!pdfResponse) {
        throw new Error('PDF response was null or timed out');
    }

    // ניסיון קריאה זהיר
    console.log('PDF packet matched! Status:', pdfResponse.status());
    
    // הוספנו פה בדיקה אם הקריאה נכשלת למרות הכל
    let pdfBuffer;
    try {
        pdfBuffer = await pdfResponse.buffer();
    } catch (bufferError) {
        console.error('Failed to read buffer:', bufferError);
        throw new Error(`Buffer read failed: ${bufferError.message}`);
    }
    
    console.log(`Downloaded ${pdfBuffer.length} bytes.`);

    // 7. המרה ושליחה
    const base64Pdf = pdfBuffer.toString('base64');
    
    res.json({
      success: true,
      pdf: base64Pdf,
      filename: `harel_${Date.now()}.pdf`,
      size: pdfBuffer.length
    });
    
  } catch (error) {
    console.error('Final Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
