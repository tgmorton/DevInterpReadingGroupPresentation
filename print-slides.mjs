import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

// Use reveal.js print-pdf mode
await page.goto('http://localhost:8000/?print-pdf', { waitUntil: 'networkidle2', timeout: 30000 });

// Wait for reveal + MathJax
await page.waitForSelector('.reveal.ready', { timeout: 10000 }).catch(() => {});
await new Promise(r => setTimeout(r, 5000));

// Reveal all fragments
await page.evaluate(() => {
  document.querySelectorAll('.fragment').forEach(el => {
    el.classList.add('visible');
    el.style.opacity = '1';
    el.style.visibility = 'visible';
  });
});

await page.pdf({
  path: 'presentation.pdf',
  width: '1280px',
  height: '720px',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  preferCSSPageSize: false,
});

console.log('✓ PDF saved to presentation.pdf');
await browser.close();
