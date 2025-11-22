// ========== חלק 1: הגדרות בסיסיות ==========
const express = require('express');        // ספריית שרת
const puppeteer = require('puppeteer');    // ספריית דפדפן אוטומטי

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ========== חלק 2: בדיקת תקינות ==========
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Harel PDF Downloader is running' });
});

// ========== חלק 3: הפונקציה העיקרית ==========
app.post('/download-pdf', async (req, res) => {
  // מקבל ticket (ואופציונלי: password) מ-Make
  const { ticket, password = '85005' } = req.body;
  
  if (!ticket) {
    return res.status(400).json({ error: 'ticket is required' });
  }

  let browser;
  
  try {
    // 1. פותח דפדפן
    browser = await puppeteer.launch({
      headless: true,  // דפדפן נסתר (לא רואים חלון)
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // 2. נכנס לעמוד של הראל
    const url = `https://ngapps.harel-group.co.il/single-doc-viewer/?ticket=${ticket}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // 3. מחכה לשדה הסיסמה
    await page.waitForSelector('input[type="password"]');
    
    // 4. מקליד את הסיסמה (005 או מה ששלחת)
    await page.type('input[type="password"]', password);
    
    // 5. מוצא את כפתור השליחה
    const submitButton = await page.$('button[type="submit"]');
    
    // 6. מאזין לתשובה עם הPDF
    const pdfPromise = page.waitForResponse(
      response => response.url().includes('single-doc-viewer') && 
                  response.headers()['content-type']?.includes('pdf')
    );
    
    // 7. לוחץ על הכפתור
    await submitButton.click();
    
    // 8. מחכה לקובץ PDF
    const pdfResponse = await pdfPromise;
    const pdfBuffer = await pdfResponse.buffer();
    
    // 9. ממיר לbase64 ושולח בחזרה
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
      await browser.close();  // סוגר את הדפדפן
    }
  }
});

// ========== חלק 4: הפעלת השרת ==========
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
