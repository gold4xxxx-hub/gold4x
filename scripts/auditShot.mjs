/**
 * Screenshot a page at an exact viewport, and report layout problems.
 *
 * Why not `chrome --headless --window-size=W,H --screenshot`: on Windows the
 * window has a ~500px minimum width, so a requested 390 comes back as 500. That
 * is not a small inaccuracy - it means the phone layout being reviewed is
 * simply never rendered, and every "looks fine on mobile" claim is unverified.
 * `--force-device-scale-factor` changes nothing, because the window is clamped
 * before scaling is applied.
 *
 * So this drives Chrome over the DevTools Protocol instead and calls
 * Emulation.setDeviceMetricsOverride, which sets the layout viewport directly
 * and is not subject to the window minimum. Rendering then happens at the
 * requested width, which is what a phone would actually lay out.
 *
 * It also collects layout diagnostics in the same pass, so a regression shows
 * up as a number rather than as something noticed by eye later.
 *
 * Usage:
 *   node scripts/auditShot.mjs <url> <out.png> [w] [h] [dpr] [clipY] [clipH] [scrollY]
 *
 * clipY/clipH capture a horizontal band instead of the whole page. A phone page
 * is ~2600px tall; downscaled to fit, 9px text is unreadable and small
 * alignment faults hide. Capturing a band keeps the detail legible.
 *
 * scrollY scrolls first. Sticky elements only exist once the page has scrolled
 * past them, so without this there is no way to check where a sticky bar comes
 * to rest.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Chrome is looked up rather than hard-coded, so this runs on a dev machine. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = {
    win32: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
  for (const p of roots[process.platform] || []) if (existsSync(p)) return p;
  throw new Error(
    'No Chrome/Edge found. Set CHROME_PATH to the executable and retry.',
  );
}

const CHROME = findChrome();

const [url, out, wArg, hArg, dprArg, clipYArg, clipHArg, scrollYArg] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/auditShot.mjs <url> <out.png> [w] [h] [dpr] [clipY] [clipH] [scrollY]');
  process.exit(2);
}
const width = Number(wArg || 390);
const height = Number(hArg || 844);
const dpr = Number(dprArg || 2);
const scale = Math.min(dpr, 3); // capture at 2x is plenty; 3x only fills disk
const clipY = clipYArg ? Number(clipYArg) : null;
const clipH = clipHArg ? Number(clipHArg) : 700;
const scrollY = scrollYArg ? Number(scrollYArg) : 0;

const profile = mkdtempSync(join(tmpdir(), 'auditshot-'));
const port = 9222 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging target');
}

/** Minimal CDP client over the built-in WebSocket. */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.rej(new Error(msg.error.message));
      else slot.res(msg.result);
    });
  });
}

/**
 * Layout problems that are invisible in a screenshot at a glance: text
 * spilling past its container, and containers whose content is wider than
 * themselves. Content inside a horizontal scroller is excluded, because there
 * extending past the edge is the point.
 */
const AUDIT = `(() => {
  const bad = [];
  const scroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  const limitOf = (el) => {
    const fixed = el.closest('[data-fixed]');
    return fixed
      ? fixed.getBoundingClientRect().right
      : document.documentElement.clientWidth;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && el.dataset.boundary !== '1') continue;
    // Screen-reader-only text (visually-hidden utility) is supposed to report a
    // scrollWidth larger than its 1px box. Not a layout fault.
    if (cs.clipPath && cs.clipPath.includes('inset(50%)')) continue;
    if (cs.clip && cs.clip.replace(/\\s/g, '') === 'rect(0,0,0,0)') continue;
    const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    const limit = limitOf(el);
    if (r.right > limit + 0.5 && !scroller(el)) {
      bad.push('OVERFLOW-X ' + name + ' right=' + r.right.toFixed(0) + ' limit=' + limit.toFixed(0) +
        ' :: ' + (el.textContent || '').trim().slice(0, 48));
    }
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
      bad.push('CLIPPED ' + name + ' scroll=' + el.scrollWidth + ' client=' + el.clientWidth +
        ' :: ' + (el.textContent || '').trim().slice(0, 48));
    }
  }
  return {
    viewport: document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight,
    docScrollW: document.documentElement.scrollWidth,
    bad,
  };
})()`;

try {
  const cdp = await connect(await targets());

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: width < 700,
    // A real touch device reports hover:none, which several rules here key off.
    // Without this a phone screenshot silently exercises the desktop affordances.
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: width < 700, maxTouchPoints: 5 });

  await cdp.send('Page.navigate', { url });
  await sleep(1400);

  if (scrollY) {
    await cdp.send('Runtime.evaluate', {
      expression: `window.scrollTo(0, ${scrollY}); window.scrollY`,
      returnByValue: true,
    });
    await sleep(500);
  }

  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: AUDIT,
    returnByValue: true,
  });
  const report = evaluated.result?.value;

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    // clip and captureBeyondViewport both work in page coordinates, so they
    // ignore the scroll offset and would photograph the top of the document
    // again. A scrolled capture has to be the viewport, unclipped.
    ...(scrollY || clipY === null
      ? { captureBeyondViewport: !scrollY }
      : { captureBeyondViewport: true, clip: { x: 0, y: clipY, width, height: clipH, scale: 1 } }),
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  if (report) {
    console.log(`viewport ${report.viewport}  docScrollW ${report.docScrollW}  ->  ${out}`);
    if (report.docScrollW > width) console.log(`  !! horizontal page scroll: ${report.docScrollW} > ${width}`);
    if (report.bad?.length) {
      console.log(`  layout problems (${report.bad.length}):`);
      for (const b of report.bad.slice(0, 25)) console.log('   ' + b);
      if (report.bad.length > 25) console.log(`   ...and ${report.bad.length - 25} more`);
    } else {
      console.log('  no layout problems');
    }
  } else {
    console.log(`screenshot written -> ${out} (diagnostic unavailable)`);
  }
  cdp.close();
} finally {
  chrome.kill();
  // Chrome holds the profile for a moment after the kill signal lands, and
  // rmSync throws EPERM rather than waiting. Cleanup is best-effort: a leftover
  // temp profile is not worth failing a screenshot run over.
  await sleep(400);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* will be cleared by the OS temp sweeper */ }
}