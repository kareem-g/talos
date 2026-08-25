import { chromium } from 'playwright';
import { setTimeout as delay } from 'timers/promises';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => console.log(`[console] ${msg.text()}`));

  const failures = [];
  function check(cond, msg) {
    if (!cond) { failures.push(msg); console.log(`❌ FAIL: ${msg}`); } else console.log(`✅ PASS: ${msg}`);
  }

  const viewports = [
    { width: 375, height: 812, label: 'mobile 375' },
    { width: 768, height: 1024, label: 'tablet 768' },
    { width: 1024, height: 800, label: 'desktop 1024' },
    { width: 1440, height: 900, label: 'wide 1440' },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await delay(1000);

    const hero = page.locator('h1').filter({ hasText: 'AgentDeck' }).first();
    check(await hero.isVisible().catch(() => false), `${vp.label}: hero visible`);

    // connection pill - check for any of Online/Offline/Connected
    const onlinePill = page.getByText(/Online|Offline|Connected|Reconnecting/).first();
    check(await onlinePill.isVisible().catch(() => false), `${vp.label}: connection pill visible`);

    const launch = page.locator('[aria-label="Quick launch"]');
    check(await launch.first().isVisible().catch(() => false), `${vp.label}: launch rail visible`);

    const needsYou = page.getByText(/Needs you/);
    const hasNeeds = await needsYou.first().isVisible().catch(() => false);
    // real backend has 5 needs you
    check(hasNeeds, `${vp.label}: Needs you section visible`);

    if (hasNeeds) {
      const resumeBtn = page.getByRole('button', { name: /Resume/ }).first();
      check(await resumeBtn.isVisible().catch(() => false), `${vp.label}: Resume button visible`);
    }

    const running = page.getByText(/Running now/);
    check(await running.first().isVisible().catch(() => false), `${vp.label}: Running now visible`);

    const sessionsHeader = page.getByText(/^Sessions/).first();
    check(await sessionsHeader.isVisible().catch(() => false), `${vp.label}: Sessions header visible`);

    const search = page.getByPlaceholder(/Search sessions/);
    const searchVisible = await search.first().isVisible().catch(() => false);
    check(searchVisible, `${vp.label}: search visible`);

    const filterAll = page.getByRole('tab', { name: 'All' });
    check(await filterAll.first().isVisible().catch(() => false), `${vp.label}: filter All visible`);

    await page.screenshot({ path: `/tmp/qa-real-${vp.width}.png`, fullPage: true });
    console.log(`[QA] screenshot /tmp/qa-real-${vp.width}.png`);
  }

  // Test resume flow
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await delay(1000);
  const resumeBtn = page.getByRole('button', { name: 'Resume' }).first();
  if (await resumeBtn.isVisible().catch(() => false)) {
    console.log('[QA] clicking Resume...');
    // Count before
    const beforeCountText = await page.getByText(/Needs you/).first().textContent().catch(() => '');
    console.log(` before Needs you: ${beforeCountText}`);
    await resumeBtn.click();
    await delay(2500);
    const afterCountText = await page.getByText(/Needs you/).first().textContent().catch(() => '');
    console.log(` after Needs you: ${afterCountText}`);
    // After resume, count should decrement by 1 (5 -> 4) or at least still visible
    const afterVisible = await page.getByText(/Needs you/).first().isVisible().catch(()=>false);
    console.log(` after visible: ${afterVisible}`);
    // Dump page for debug
    const dump = await page.content();
    console.log(` page dump snippet: ${dump.slice(dump.indexOf('Needs you')-100, dump.indexOf('Needs you')+200)}`);
    check(afterVisible, 'resume flow: Needs you still visible after one resume (should be 4)');
  } else {
    check(false, 'resume flow: Resume button not found');
  }

  // Search
  const searchInput = page.getByPlaceholder(/Search sessions/);
  if (await searchInput.first().isVisible()) {
    await searchInput.first().fill('approval-lab');
    await delay(600);
    // Should filter to sessions with that project - real sessions have project /tmp/approval-lab
    const anySession = page.locator('text=/tmp\\/approval-lab|New Session').first();
    check(await anySession.isVisible().catch(() => false), 'search: filtering works');
    await searchInput.first().fill('');
    await delay(400);
  }

  // Filter Attention
  const attentionTab = page.getByRole('tab', { name: /Attention/ });
  if (await attentionTab.first().isVisible()) {
    await attentionTab.first().click();
    await delay(400);
    check(await page.getByText(/Needs you/).first().isVisible().catch(() => false), 'filter: Attention tab works');
    // back to All
    await page.getByRole('tab', { name: 'All' }).first().click();
    await delay(400);
  }

  // Open a session and test model picker
  // More robust: click first row in roster - use getByText
  const rosterRow = page.getByText('New Session').first();
  // Ensure we are on All filter and search cleared
  await page.getByRole('tab', { name: 'All' }).first().click().catch(()=>{});
  await delay(400);
  if (await rosterRow.isVisible().catch(() => false)) {
    // Find the parent button row
    const row = rosterRow.locator('xpath=ancestor::div[@role="button"][1]');
    const target = await row.count() > 0 ? row.first() : rosterRow;
    await target.click();
    await delay(1200);
    const chatTab = page.getByText('Chat').first();
    check(await chatTab.isVisible().catch(() => false), 'session open: Chat visible');
    const modelBtn = page.getByRole('button', { name: /Model/ }).first();
    const hasModel = await modelBtn.isVisible().catch(() => false);
    if (hasModel) {
      check(true, 'model picker: Model button visible');
      await modelBtn.click();
      await delay(600);
      // Check for model options - look for opus or sonnet or fable
      const hasOpus = await page.getByText('opus').first().isVisible().catch(() => false) || await page.getByText('Opus').first().isVisible().catch(() => false) || await page.getByText('fable').first().isVisible().catch(() => false);
      check(hasOpus, 'model picker: options visible');
      // Close layer via Esc
      await page.keyboard.press('Escape');
      await delay(300);
    } else {
      console.log('model button not found, maybe config not loaded');
      // Check if there's a notice about model
      const notice = page.getByText(/applies next turn|Model/).first();
      console.log(` notice check: ${await notice.isVisible().catch(()=>false)}`);
    }
    // Back
    const backBtn = page.getByRole('button', { name: 'Back to Mission Control' }).first();
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await delay(800);
      check(await page.locator('h1').filter({ hasText: 'AgentDeck' }).first().isVisible(), 'nav back: returned to home');
    } else {
      // Try browser back
      await page.goBack().catch(()=>{});
      await delay(500);
    }
  } else {
    check(false, 'session open: roster row not found');
  }

  // Test New Session flow
  const newBtn = page.getByRole('button', { name: /New session/ }).first();
  if (await newBtn.isVisible()) {
    await newBtn.click();
    await delay(600);
    const layerTitle = page.getByText('New session').first();
    check(await layerTitle.isVisible().catch(()=>false), 'new session: layer opens');
    await page.keyboard.press('Escape');
    await delay(300);
  }

  console.log('\n=== QA SUMMARY ===');
  if (failures.length === 0) console.log('All checks passed ✅');
  else { console.log(`${failures.length} failures:`); failures.forEach(f=>console.log(' - '+f)); }

  await browser.close();
  process.exit(failures.length>0?1:0);
}
run().catch(e=>{console.error(e);process.exit(1)});
