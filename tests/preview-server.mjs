// Disposable, localhost-only reader check. Synthetic PDF is generated in memory.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const port = 47831;
const pdfObjects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ...['BT /F1 22 Tf 60 720 Td (Synthetic paper: randomized study) Tj 0 -45 Td /F1 14 Tf (Methods: 300 participants in two treatment groups.) Tj ET',
    'BT /F1 22 Tf 60 720 Td (Results and limitations) Tj 0 -45 Td /F1 14 Tf (The treatment improved the measured response.) Tj 0 -30 Td (Follow-up was limited to six months.) Tj ET'].map(text => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`)
];
let pdf = '%PDF-1.4\n'; const offsets = [0];
pdfObjects.forEach((text, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${text}\nendobj\n`; });
const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const mock = `window.browser={runtime:{getURL:p=>new URL(p,location.href).href,onMessage:{addListener:()=>{},removeListener:()=>{}},sendMessage:async m=>m.type==='paperchat.reader-source'?{source:'http://127.0.0.1:${port}/fixture.pdf'}:{ok:true,connected:false,historyReady:false}},tabs:{getCurrent:async()=>({id:1})},permissions:{request:async()=>true}};`;
const sampleAnswer = '## Methods\nThe authors compared two randomized groups and adjusted for sample variability [S4, S4, S5] [S5]. The same source supports the follow-up design [S4].\n\n## Limitations\n**Limited follow-up:** observation ended after six months [S7, S7]. Longer follow-up is needed before drawing conclusions about lasting effects [S7].';
const uiMock = `const listeners=new Set();let preferences={};window.browser={runtime:{onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendMessage:async m=>{const p=m.payload;if(p.action==='status')return {ok:true,connected:true,historyReady:true};if(p.action==='models')return {ok:true,models:[{slug:'fixture',name:'Demo model',reasoningLevels:['low','medium','high'],defaultReasoning:'medium'}]};if(p.action==='readHistory')return {ok:true,conversation:{messages:[{role:'assistant',state:'complete',createdAt:'2026-10-07T00:00:00Z',text:${JSON.stringify(sampleAnswer)}}]}};return {ok:true};}},storage:{local:{get:async()=>({'paperchat.preferences':preferences}),set:async x=>{preferences=x['paperchat.preferences'];}}}};document.addEventListener('DOMContentLoaded',()=>{for(const fn of [...listeners])fn({type:'paperchat.toggle'});});`;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/ui.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic citation layout</title><style>body{font:18px/1.65 system-ui;max-width:850px;margin:50px auto;padding:0 30px;color:#163b43}h1{line-height:1.2}</style><article><h1>Synthetic methods paper</h1><p>This fictional source and reply are a local UI fixture. No account or model requests are made.</p><h2>Processing time-course measurements and correcting for sample variability</h2><p>The experiment assigned participants to treatment and control groups at random.</p><p>The authors adjusted the measurements for sample variability and assessed outcomes after six months.</p><h2>Study limitations and interpretation</h2><p>Follow-up was limited to six months; lasting effects require further investigation.</p></article><script src="mock-ui.js" defer></script><script src="content.js" defer></script></html>');
      return;
    }
    if (pathname === '/mock-ui.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(uiMock); return; }
    if (pathname === '/article.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic paper: randomized study</title><style>body{font:18px/1.65 system-ui;max-width:850px;margin:50px auto;padding:0 30px;color:#163b43}h1{line-height:1.2}aside{background:#eef5f5;padding:20px}</style><article><h1>Synthetic paper: randomized study</h1><p>This fictional paper is a disposable test fixture for PaperChat.</p><h2>Abstract</h2><p>A randomized study compared two treatment groups. The treatment improved the measured response, with limited follow-up.</p><h2>Methods</h2><p>The study enrolled 300 participants in two treatment groups. Participants were assigned randomly to the treatment and control groups.</p><h2>Results</h2><p>The treatment improved the measured response compared with the control group.</p><h2>Limitations</h2><p>Follow-up was limited to six months. This test fixture provides no numerical effect size or statistical significance.</p><h2>Conclusion</h2><p>The intervention warrants further study with longer follow-up.</p></article><aside><a href="/fixture.pdf">Open the same synthetic paper as a two-page PDF</a></aside></html>');
      return;
    }
    if (pathname === '/fixture.pdf') { response.setHeader('Content-Type', 'application/pdf'); response.end(Buffer.from(pdf)); return; }
    if (pathname === '/mock.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(mock); return; }
    const name = pathname === '/' ? 'reader.html' : pathname.slice(1);
    if (name.includes('..')) { response.writeHead(400); response.end(); return; }
    let bytes = await readFile(path.join('dist', name));
    if (name === 'reader.html') bytes = Buffer.from(bytes.toString().replace('<script src="reader.js">', '<script src="mock.js"></script><script src="reader.js">'));
    response.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream'); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log('Synthetic PDF preview: http://127.0.0.1:' + port));
