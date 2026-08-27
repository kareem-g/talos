import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://localhost:3000/session/82b06f08-e5bf-4fc8-aa07-731b4381d01a', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1. Check chat scroll container exists and is scrollable
const scrollInfo = await page.evaluate(() => {
  const el = document.querySelector('.scroll-thin.overscroll-contain');
  if (!el) return { found: false };
  return { found: true, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, canScroll: el.scrollHeight > el.clientHeight };
});
console.log('CHAT SCROLL:', JSON.stringify(scrollInfo));

// 2. Switch to Files view in right panel and check files show
const filesIcon = page.locator('.w-12').getByTitle('Files');
await filesIcon.click();
await page.waitForTimeout(1500);

const fileEntries = await page.evaluate(() => {
  // The files panel shows entries with the dir indicator
  const items = document.querySelectorAll('.scroll-thin.min-h-0.flex-1.overflow-y-auto.px-1\\.5.pb-3 button, .overflow-y-auto.px-1\\.5.pb-3 button');
  const all = [];
  items.forEach(b => {
    const name = b.querySelector('.truncate')?.textContent?.toString() || '';
    const isDir = !!b.querySelector('.text-accent');
    all.push({ name, isDir });
  });
  return all;
});
console.log('FILE ENTRIES:', JSON.stringify(fileEntries.slice(0, 12)));
const hasFiles = fileEntries.some(e => !e.isDir);
const hasDirs = fileEntries.some(e => e.isDir);
console.log('HAS FILES:', hasFiles, 'HAS DIRS:', hasDirs);

// 3. Check navigation: is there a ".." button or breadcrumbs to go up?
const navInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const upBtn = btns.find(b => b.textContent?.trim() === '..');
  const hasBreadcrumbs = !!document.querySelector('.overflow-x-auto.px-3');
  return { hasUpButton: !!upBtn, hasBreadcrumbs };
});
console.log('NAVIGATION:', JSON.stringify(navInfo));

console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
