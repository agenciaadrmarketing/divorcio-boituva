// Gera o snapshot HTML estático (primeira dobra instantânea) e o injeta em index.html
// entre <!--PRE-START--> e <!--PRE-END-->. Uso (na raiz do projeto):
//   npm i playwright-core && node build/prerender.mjs
// Rode novamente sempre que editar o conteúdo/estilo do index.html.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import { extname, join } from 'node:path';

const root = process.cwd();
const START = '<!--PRE-START-->', END = '<!--PRE-END-->';
const html = readFileSync(join(root, 'index.html'), 'utf8');
const a = html.indexOf(START), b = html.indexOf(END);
const clean = a >= 0 ? html.slice(0, a) + html.slice(b + END.length) : html;
writeFileSync(join(root, '__prerender_src.html'), clean);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  try { const p = decodeURIComponent(q.url.split('?')[0]); r.setHeader('Content-Type', types[extname(p)] || 'text/plain'); r.end(readFileSync(join(root, p))); }
  catch { r.statusCode = 404; r.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 412, height: 823 } });
await page.goto(`http://localhost:${port}/__prerender_src.html`);
await page.waitForSelector('#dc-root h1');
await page.waitForTimeout(1500);
const { css, body } = await page.evaluate(() => {
  const css = [...document.head.querySelectorAll('style')].filter(s => !s.hasAttribute('data-keep')).map(s => s.textContent).join('\n');
  const root = document.getElementById('dc-root').cloneNode(true);
  root.querySelectorAll('[data-dc-tpl]').forEach(e => e.removeAttribute('data-dc-tpl'));
  root.querySelectorAll('mapa-brasil').forEach(e => { const d = document.createElement('div'); d.setAttribute('style', 'min-height:320px'); e.replaceWith(d); });
  root.querySelectorAll('iframe').forEach(e => e.removeAttribute('src'));
  root.querySelectorAll('script').forEach(e => e.remove());
  return { css, body: root.innerHTML };
});
await browser.close(); server.close(); unlinkSync(join(root, '__prerender_src.html'));

const fixed = body.replace(/\breveal in\b/g, 'reveal');
// O hero do snapshot é mais alto que o real (+90px) para que a imagem real, ao entrar, nunca
// seja maior que a do snapshot e não vire um novo candidato a LCP (que atrasaria o LCP até o React montar).
const swap = `<script>(function(){var h=document.getElementById('pre');if(!h)return;var d=0;function go(){if(d)return;d=1;requestAnimationFrame(function(){requestAnimationFrame(function(){var s=document.getElementById('pre-css');h.remove();if(s)s.remove();})})}function w(){var r=document.getElementById('dc-root');if(!r){return}if(r.childNodes.length){go();return}new MutationObserver(function(m,o){if(r.childNodes.length){o.disconnect();go()}}).observe(r,{childList:true})}new MutationObserver(function(m,o){if(document.getElementById('dc-root')){o.disconnect();w()}}).observe(document.body,{childList:true});})();</script>`;
const block = `${START}<style id="pre-css">${css}\n#pre ~ #dc-root{display:none}\n#pre .hero-sec{padding-bottom:214px!important}</style><div id="pre">${fixed}</div>${swap}${END}`;
writeFileSync(join(root, 'index.html'), clean.replace('<x-dc>', block + '\n<x-dc>'));
console.log('snapshot:', Math.round(block.length / 1024), 'KB');
