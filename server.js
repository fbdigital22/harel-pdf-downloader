// ========== חלק 1: הגדרות בסיסיות ==========
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ========== חלק 2: בדיקת תקינות ==========
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Harel PDF Downloader is running' });
});

// ========== חלק 3: הפונקציה העיקרית ==========
app.post('/download-pdf', async (req, res) => {
  const { ticket, password = '85005' } = req.body; 
  
  if (!ticket) {
    return res.status(400).json({ error: 'ticket is required' });
  }

  let browser;
  
  try {
    // 1. פותח דפדפן (עם תיקוני OOM/יציבות)
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
    
    // 2. נכנס לעמוד הכניסה הנכון
    const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' }); 
    
    // 3. *** מכינים את המאזינים לפני הפעולה שתפעיל אותם ***
    // מחכה לניווט (URL חדש) - עם timeout מוגדל ו-networkidle2
    const navigationPromise = page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: 60000 // הגדלת זמן ההמתנה ל-60 שניות
    });
    
    // מכין את ה-Promise שמאזין לתגובת ה-PDF
    const pdfPromise = page.waitForResponse(
      response => response.url().includes('single-doc-viewer') && 
                  response.headers()['content-type']?.includes('pdf')
    );
    
    // 4. שלב 1: הזנת מספר סוכן (#tz0)
    const agentCodeSelector = '#tz0'; 
    await page.waitForSelector(agentCodeSelector, { timeout: 60000 });
    await page.type(agentCodeSelector, password); 

    // 5. לוחץ על כפתור המשך (submit)
    const continueButtonSelector = 'button[type="submit"]'; 
    await page.click(continueButtonSelector);
    
    // 6. *** ממתינים לטעינת הדף ולתגובת ה-PDF במקביל ***
    await Promise.all([
        navigationPromise, // מחכה שהדף יעבור ל-single-doc-viewer (עד שרשת רגועה)
        pdfPromise         // מחכה שתגובת ה-PDF תגיע
    ]);
    
    // 7. מקבל את הבאפר של ה-PDF מתגובת הרשת
    const pdfResponse = await pdfPromise;
    const pdfBuffer = await pdfResponse.buffer();
    
    // 8. ממיר לbase64 ושולח בחזרה
    const base64Pdf = pdfBuffer.toString('base64');
    
    res.json({
      success: true,
      pdf: base64Pdf,
      filename: `harel_${Date.now()}.pdf`,
      size: pdfBuffer.length
    });
    
  } catch (error) {
    // אם יש עדיין שגיאה, מציג אותה
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) {
      await browser.close(); // סוגר את הדפדפן כדי לשחרר זיכרון
    }
  }
});

// ========== חלק 4: הפעלת השרת ==========
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
