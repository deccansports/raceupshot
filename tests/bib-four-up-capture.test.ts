// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRINT_CAPTURE_ROOT_STYLE } from '../lib/bib-print-pdf';

describe.skipIf(process.env.BIB_VISUAL_VERIFY !== '1')('four-up browser capture', () => {
  it('captures all four offset BIBs inside their own raster viewport', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'raceupshot-four-up-capture-'));
    const library = await readFile('node_modules/html-to-image/dist/html-to-image.js', 'utf8');
    const html = `<!doctype html><html><body><div style="position:relative;width:420px;height:297px">
      ${['rgb(255,0,0)', 'rgb(0,128,0)', 'rgb(0,0,255)', 'rgb(255,255,0)'].map((color, i) => `<div class="bib" style="position:absolute;left:${i % 2 * 210}px;top:${Math.floor(i / 2) * 148.5}px;width:210px;height:148.5px;background:${color}">${i + 1}</div>`).join('')}
      </div><script>${library}</script><script>
      // Headless dump-dom does not advance animation frames reliably under
      // virtual time. Only replace the scheduling primitive, not rendering.
      window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
      (async () => {
        try {
          const results = [];
          for (const bib of document.querySelectorAll('.bib')) {
            const canvas = await htmlToImage.toCanvas(bib, {width:210,height:149,pixelRatio:1,fontEmbedCSS:'',style:${JSON.stringify(PRINT_CAPTURE_ROOT_STYLE)}});
            results.push(Array.from(canvas.getContext('2d').getImageData(100,75,1,1).data));
          }
          document.body.setAttribute('data-captured', JSON.stringify(results));
        } catch(error) { document.body.setAttribute('data-error', String(error)); }
      })();</script></body></html>`;
    const file = join(folder, 'capture.html'); await writeFile(file, html);
    const { stdout } = await promisify(execFile)('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless', '--disable-gpu', '--disable-extensions', '--no-sandbox', `--user-data-dir=${join(folder, 'chrome')}`, '--virtual-time-budget=15000', '--dump-dom', `file://${file}`,
    ], { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
    expect(stdout).not.toContain('data-error=');
    expect(stdout).toContain('data-captured="[[255,0,0,255],[0,128,0,255],[0,0,255,255],[255,255,0,255]]"');
  }, 60000);
});
