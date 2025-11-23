// ========== חלק 1: הגדרות בסיסיות ==========
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium'); 
// הוספנו את 'axios' ו-'fs' כדי להוריד את הקובץ ישירות
const axios = require('axios'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => res.send('Server is Up'));

// ========== הפונקציה להורדת ה-PDF ==========
app.post('/download-pdf', async (req, res) => {
  console.log('--- התחלת תהליך הורדה (גרסה עוקפת דפדפן) ---');
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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // 2. כניסה לדף
    const url = `https://digital.harel-group.co.il/generic-identification/?ticket=${ticket}`;
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); 
    
    // 3. הזנת מספר סוכן (#tz0)
    console.log('Entering agent code...');
    const agentCodeSelector = '#tz0'; 
    await page.waitForSelector(agentCodeSelector, { timeout: 15000 });
    await page.type(agentCodeSelector, password); 

    // 4. האזנה לכתובת ה-PDF (אבל לא לתוכן!)
    // אנחנו רק רוצים לדעת מה ה-URL הסופי המדויק
    let pdfUrl = null;
    
    // אנחנו מפעילים יירוט בקשות כדי לתפוס את ה-URL של ה-PDF
    await page.setRequestInterception(true);
    
    page.on('request', request => {
        // אם זו הבקשה ל-PDF, נשמור את ה-URL ונבטל את הבקשה בדפדפן (כדי למנוע הורדה כפולה/שגיאה)
        if (request.url().includes('single-doc-viewer') && !pdfUrl) {
            console.log('Captured PDF URL:', request.url());
            pdfUrl = request.url();
            request.abort(); // עוצרים את הדפדפן מלהוריד בעצמו!
        } else {
            request.continue();
        }
    });

    // 5. לחיצה על כפתור "המשך"
    console.log('Clicking submit...');
    const continueButtonSelector = 'button[type="submit"]'; 
    await page.click(continueButtonSelector);
    
    // 6. מחכים עד שנתפוס את ה-URL
    console.log('Waiting for PDF URL capture...');
    // לולאה פשוטה שתחכה עד ש-pdfUrl יתמלא (עד 30 שניות)
    const startTime = Date.now();
    while (!pdfUrl && (Date.now() - startTime < 30000)) {
        await new Promise(r => setTimeout(r, 500));
    }

    if (!pdfUrl) {
        throw new Error('Timeout: Could not capture PDF URL');
    }

    // 7. שלב הקסם: שימוש ב-Cookies להורדה ישירה
    // עכשיו שיש לנו את ה-URL ואנחנו מחוברים, ניקח את ה-Cookies
    console.log('Getting cookies...');
    const cookies = await page.cookies();
    
    // ממירים את העוגיות לפורמט ש-Axios מבין
    const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

    console.log('Downloading directly via Axios...');
    // מורידים את הקובץ ישירות מהשרת, עוקפים את מנגנון ההורדה של Chrome
    const response = await axios({
        method: 'GET',
        url: pdfUrl,
        headers: {
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        },
        responseType: 'arraybuffer' // חשוב מאוד כדי לקבל את הקובץ הבינארי
    });

    console.log('Download complete via Axios!');
    const pdfBuffer = Buffer.from(response.data);

    // 8. המרה ושליחה
    const base64Pdf = pdfBuffer.toString('base64');
    
    res.json({
      success: true,
      pdf: base64Pdf,
      filename: `harel_${Date.now()}.pdf`,
      size: pdfBuffer.length
    });
    
  } catch (error) {
    console.error('Final Error:', error.message);
    // אם זו שגיאה של Axios, נדפיס פרטים נוספים
    if (error.response) {
        console.error('Axios Error Data:', error.response.data.toString());
    }
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
