// Prueba de extremo a extremo de la app de Android en un emulador (la lanza el CI).
//
// Se conecta al WebView del APK de depuración por el protocolo de DevTools (adb forward), recorre la app como una
// persona y falla si hay cualquier error de consola, excepción o violación de CSP / Trusted Types.
// Uso: node scripts/android-e2e.mjs <carpeta-de-capturas>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = 'io.github.bertmarti.repartito';
const OUT = process.argv[2] ?? 'e2e';
mkdirSync(OUT, { recursive: true });

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => writeFileSync(`${OUT}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p']));

let pid = '';
for (let i = 0; i < 30 && !pid; i++) {
  await sleep(1000);
  pid = adb('shell', 'pidof', APP);
}
if (!pid) throw new Error('La app no arrancó');
await sleep(4000);
adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);

let page;
for (let i = 0; i < 20 && !page; i++) {
  await sleep(1000);
  const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json(), () => []);
  page = targets.find((t) => t.type === 'page' && t.url.startsWith('https://localhost'));
}
if (!page) throw new Error('No aparece el WebView de la app');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
let seq = 0;
const waiters = new Map();
const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (Number.isInteger(d.id) && waiters.has(d.id)) {
    const resolve = waiters.get(d.id);
    waiters.delete(d.id);
    resolve(d);
    return;
  }
  if (d.method === 'Runtime.exceptionThrown') problems.push(`excepción: ${d.params.exceptionDetails.text} ${d.params.exceptionDetails.exception?.description ?? ''}`);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push(`console.error: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push(`log: ${d.params.entry.text}`);
};
const send = (method, params = {}) => new Promise((resolve) => (waiters.set(++seq, resolve), ws.send(JSON.stringify({ id: seq, method, params }))));
const ev = async (expression) => {
  const d = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (d.result?.exceptionDetails) throw new Error(`Fallo en la página: ${JSON.stringify(d.result.exceptionDetails)}`);
  return d.result?.result?.value;
};
const H = `const lbl = (b) => b.getAttribute('aria-label') || b.textContent.trim();
  const click = async (re) => { const b = [...document.querySelectorAll('button')].find((b) => re.test(lbl(b))); if (!b) throw new Error('No hay botón ' + re); b.click(); await new Promise((r) => setTimeout(r, 900)); };`;
const check = (ok, what) => {
  if (!ok) throw new Error(`Comprobación fallida: ${what}`);
  console.log('✓', what);
};

await send('Runtime.enable');
await send('Log.enable');
// Recarga con los dominios ya activos, para no perder errores del arranque.
await send('Page.enable');
await send('Page.reload');
await sleep(4000);
shot('01-inicio');

const boot = await ev(`return {
  origin: location.origin,
  native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
  csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
  sw: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  h: document.querySelector('h1, h2')?.textContent ?? '',
};`);
check(boot.origin === 'https://localhost', `origen propio de la app (${boot.origin})`);
check(boot.native, 'Capacitor detecta la plataforma nativa');
check(boot.csp.includes("require-trusted-types-for 'script'") && boot.csp.includes('trusted-types repartito-sw'), 'CSP con Trusted Types');
check(boot.sw === 0, 'sin service worker en la app');
check(boot.h.length > 0, `pantalla de inicio («${boot.h}»)`);

await ev(`${H} await click(/^(Probar con un grupo de ejemplo|Try a sample group)$/);`);
await sleep(1000);
shot('02-grupo');
const group = await ev(`return { title: document.querySelector('h1, h2')?.textContent ?? '', saved: (localStorage.getItem('repartito:v1:grupos') || '').length };`);
check(group.saved > 100, 'el grupo de ejemplo se guarda en el almacenamiento de la app');

await ev(`${H} await click(/^(Saldos|Balances)$/);`);
shot('03-saldos');

await ev(`${H} await click(/^(Compartir y sincronizar|Share and sync)$/); await click(/^(Crear enlace|Create link)$/); await new Promise((r) => setTimeout(r, 1500));`);
shot('04-compartir');
const link = await ev(`return [...document.querySelectorAll('.sheet input')].map((i) => i.value).find((v) => v.includes('#g=')) ?? '';`);
check(link.startsWith('https://bertmarti.github.io/repartito/#g=1.'), 'el enlace compartido apunta a la web pública');

// «Compartir con Repartito»: un ACTION_SEND como el de WhatsApp, con la app ya abierta (onNewIntent → ShareInbox).
const dialogs = `return [...document.querySelectorAll('[role=dialog] h2')].map((h) => h.textContent.trim());`;
const sendText = (text) =>
  adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.SEND', '-t', 'text/plain', '--es', 'android.intent.extra.TEXT', `'${text}'`, '-n', `${APP}/.MainActivity`);
await ev(`history.go(-(history.state?.repartito ?? 0)); await new Promise((r) => setTimeout(r, 900));`);
sendText(`Grupo: ${link}`);
await sleep(2500);
shot('05-compartido-enlace');
const received = await ev(dialogs);
check(received.some((h) => /^(Grupo recibido|Group received)$/.test(h)), `un enlace compartido abre la vista previa del grupo (${received.join(', ')})`);
const clean = await ev(`return location.search === '' && !location.href.includes('#g=');`);
check(clean, 'nada de lo compartido queda en la dirección');

await ev(`history.go(-(history.state?.repartito ?? 0)); await new Promise((r) => setTimeout(r, 900));`);
sendText('Cena del viernes');
await sleep(2500);
shot('06-compartido-texto');
const expense = await ev(`return { dialogs: [...document.querySelectorAll('[role=dialog] h2')].map((h) => h.textContent.trim()), values: [...document.querySelectorAll('[role=dialog] input')].map((i) => i.value) };`);
check(expense.dialogs.some((h) => /^(Nuevo gasto|New expense)$/.test(h)) && expense.values.includes('Cena del viernes'), 'un texto compartido abre «Nuevo gasto» con el concepto');

// Una URL cualquiera no se abre ni se navega a ella.
await ev(`history.go(-(history.state?.repartito ?? 0)); await new Promise((r) => setTimeout(r, 900));`);
sendText('https://example.com/');
await sleep(2500);
const after = await ev(`return { href: location.href, dialogs: document.querySelectorAll('[role=dialog]').length };`);
check(after.href.startsWith('https://localhost/') && after.dialogs === 0, 'una URL ajena no se abre');

ws.close();
check(problems.length === 0, `consola sin errores${problems.length ? ':\n  ' + problems.join('\n  ') : ''}`);
