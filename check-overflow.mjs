// Check which slides overflow their 720px height
// Usage: node check-overflow.mjs [slide_number]
import puppeteer from 'puppeteer';

const targetSlide = process.argv[2] ? parseInt(process.argv[2]) : null;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 15000 });

// Wait for reveal to init
await page.waitForSelector('.reveal.ready', { timeout: 5000 }).catch(() => {});
await new Promise(r => setTimeout(r, 1000));

const results = await page.evaluate(() => {
  const slides = document.querySelectorAll('.reveal .slides > section');
  const out = [];
  slides.forEach((sec, i) => {
    const sh = sec.scrollHeight;
    const ch = sec.clientHeight;
    const overflow = sh - ch;
    if (overflow > 5) {
      const title = sec.querySelector('h2, h1');
      out.push({
        slide: i + 1,
        title: title ? title.textContent.trim() : '(no title)',
        scrollHeight: sh,
        clientHeight: ch,
        overflow
      });
    }
  });
  return out;
});

if (results.length === 0) {
  console.log('✓ No slides overflow.');
} else {
  const filtered = targetSlide ? results.filter(r => r.slide === targetSlide) : results;
  if (filtered.length === 0) {
    console.log(targetSlide ? `✓ Slide ${targetSlide} fits.` : '✓ No slides overflow.');
  } else {
    console.log(`⚠ ${filtered.length} slide(s) overflow:\n`);
    for (const r of filtered) {
      console.log(`  Slide ${r.slide}: "${r.title}" — ${r.overflow}px over (content: ${r.scrollHeight}px, available: ${r.clientHeight}px)`);
    }
  }
}

await browser.close();
