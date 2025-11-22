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
  // משתמשים ב-password עבור "מספר סוכן" לצורך הפשטות
  const { ticket, password = '85005' } = req.body; 
  
  if (!ticket) {
    return res.status(400).json({ error: 'ticket is required' });
  }

  let browser;
  
  try {
    // 1. פותח דפדפן (עם תיקוני 502/OOM ופתרון ל-Could not find Chrome)
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
    
    // 3. *** שלב חדש: מחכה ומקליד את מספר הסוכן ***
    // מניח שהסלקטור הוא input כלשהו בתוך ה-div של השדה
    const agentCodeSelector = 'input[type="tel"]'; // נפוץ לשימוש במספרים
    await page.waitForSelector(agentCodeSelector, { timeout: 60000 });
    
    // מקליד את מה ששלחנו כ-password לשדה מספר סוכן
    await page.type(agentCodeSelector, password); 

    // 4. *** שלב חדש: לוחץ על כפתור "המשך" ***
    // מחפש כפתור עם טקסט 'המשך'
    const continueButtonSelector = 'button:has-text("המשך")'; 
    await page.waitForSelector(continueButtonSelector, { timeout: 10000 });
    await page.click(continueButtonSelector);
    
    // 5. *** שלב חדש: מחכה לשדה הסיסמה האמיתי לאחר המעבר ***
    // (הדף השני לאחר הלחיצה)
    // מחכים לשדה הסיסמה האמיתי שסביר להניח מופיע כעת
    const passwordSelector = 'input[type="password"]';
    await page.waitForSelector(passwordSelector, { timeout: 30000 });
    
    // 6. מקליד את הסיסמה שוב (בשלב זה זו הסיסמה האמיתית 85005)
    await page.type(passwordSelector, password); 
    
    // 7. מוצא את כפתור השליחה
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
    // אם יש עדיין שגיאה, מציג אותה
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) {
      await browser.close();  // סוגר את הדפדפן כדי לשחרר זיכרון
    }
  }
});

// ========== חלק 4: הפעלת השרת ==========
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
