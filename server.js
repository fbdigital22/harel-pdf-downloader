// ========== חלק 1: הגדרות בסיסיות ==========
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ========== בדיקת שרת ==========
app.get('/', (req, res) => res.send('Server is Up'));

// ========== הפונקציה להורדת ה-PDF ==========
app.post('/download-pdf', async (req, res) => {
  console.log('--- התחלת תהליך הורדה ---');
  const { ticket, password = '85005' } = req.body;
  
  if (!ticket) return res.status(400).json({ error: 'ticket is required' });

  let browser;
  try {
    // 1. הרצת דפדפן עם הגדרות אופטימליות ל-Render
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
    
    // הגדרת User Agent למניעת חסימות אבטחה בסיסיות
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

    // 4. *** החלק הקריטי: הגדרת המלכודת ל-PDF ***
    // אנחנו מכינים את ההאזנה *לפני* הלחיצה, אבל לא מחכים לניווט של הדף!
    // אנחנו מחפשים תגובה שהיא גם מה-viewer וגם מסוג PDF
    const pdfPromise = page.waitForResponse(response => {
        // בודק אם ה-URL מכיל את המילה Viewer וגם שהתוכן הוא PDF
        return response.url().includes('single-doc-viewer') && 
               response.headers()['content-type'] &&
               response.headers()['content-type'].toLowerCase().includes('pdf');
    }, { timeout: 90000 }); // נותן לזה זמן נדיב של 90 שניות

    // 5. לחיצה על כפתור "המשך"
    console.log('Clicking submit...');
    const continueButtonSelector = 'button[type="submit"]'; 
    await page.click(continueButtonSelector);
    
    // 6. המתנה אך ורק לקובץ (בלי לחכות שהדף ייטען)
    console.log('Waiting for PDF response packet...');
    const pdfResponse = await pdfPromise;
    
    if (!pdfResponse) {
        throw new Error('PDF response was null');
    }

    console.log('PDF packet received! Downloading buffer...');
    const pdfBuffer = await pdfResponse.buffer();
    
    // 7. המרה ושליחה
    const base64Pdf = pdfBuffer.toString('base64');
    console.log('Done. Sending back to Make.');
    
    res.json({
      success: true,
      pdf: base64Pdf,
      filename: `harel_${Date.now()}.pdf`,
      size: pdfBuffer.length
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
