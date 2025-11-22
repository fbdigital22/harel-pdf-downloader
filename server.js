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
    
    // 3. *** תיקון סלקטור 1: שינוי ל-input[type="text"] ***
    // מחפש את שדה מספר הסוכן
    const agentCodeSelector = 'input[type="text"]'; 
    await page.waitForSelector(agentCodeSelector, { timeout: 60000 });
    
    // מקליד את מספר הסוכן
    await page.type(agentCodeSelector, password); 

    // 4. *** תיקון סלקטור 2: מחפש כפתור submit (או הכפתור הראשי) ***
    // מניח שכפתור 'המשך' הוא כפתור submit
    const continueButtonSelector = 'button[type="submit"]'; 
    await page.waitForSelector(continueButtonSelector, { timeout: 10000 });
    await page.click(continueButtonSelector);
    
    // 5. מחכה לשדה הסיסמה האמיתי לאחר המעבר
    const passwordSelector = 'input[type="password"]';
    await page.waitForSelector(passwordSelector, { timeout: 30000 });
    
    // 6. מקליד את הסיסמה האמיתית
    await page.type(passwordSelector, password); 
    
    // 7. מוצא את כפתור השליחה הסופי (כנראה אותו סלקטור)
    const submitButton = await page.$('button[type="submit"]');
    
    // 8. מאזין לתשובה עם הPDF
    const pdfPromise = page.waitForResponse(
      response => response.url().includes('single-doc-viewer') && 
                  response.headers()['content-type']?.includes('pdf')
    );
    
    // 9. לוחץ על כפתור השליחה הסופי
    await submitButton.click();
    
    // 10. מחכה לקובץ PDF ומקבל את התוכן שלו
    const pdfResponse = await pdfPromise;
    const pdfBuffer = await pdfResponse.buffer();
    
    // 11. ממיר לbase64 ושולח בחזרה
    const base64Pdf = pdfBuffer.toString('base64');
    
    res.json({
      success: true,
      pdf: base64Pdf,
      filename: `harel_${Date.now()}.pdf`,
      size: pdfBuffer.length
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// ========== חלק 4: הפעלת השרת ==========
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
