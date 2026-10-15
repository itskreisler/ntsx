import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

async function verify() {
  console.log('Starting preview server...');
  const server = spawn('npx', ['astro', 'preview', '--port', '4321'], {
    cwd: path.join(process.cwd(), 'web'),
    stdio: 'ignore'
  });

  // Wait for server to boot
  await new Promise((res) => setTimeout(res, 2500));

  console.log('Launching browser...');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: '/home/jules/verification/videos/' }
  });

  const page = await context.newPage();
  await page.goto('http://localhost:4321', { waitUntil: 'networkidle' });

  // Take hero screenshot
  await page.screenshot({ path: '/home/jules/verification/screenshots/ntsx_hero_page.png' });

  // Open modal
  const openModalBtn = page.locator('#open-modal-btn');
  if (await openModalBtn.isVisible()) {
    await openModalBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/home/jules/verification/screenshots/ntsx_modal.png' });
    await page.locator('#close-modal-btn').click();
    await page.waitForTimeout(300);
  }

  // Full page screenshot
  await page.screenshot({ path: '/home/jules/verification/screenshots/ntsx_full_page.png', fullPage: true });

  await context.close();
  await browser.close();
  server.kill();

  console.log('Verification completed successfully!');
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
