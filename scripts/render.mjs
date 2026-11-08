// Genera los PNG de cada carrusel a partir de los JSON de la carpeta "datos".
// Solo procesa los carruseles que todavía no tienen imágenes en "docs/c/<id>/".
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = process.cwd();
const DATOS = path.join(RAIZ, 'datos');
const SALIDA = path.join(RAIZ, 'docs', 'c');
const PLANTILLA = pathToFileURL(path.join(RAIZ, 'plantilla', 'carrusel.html')).href;

const pendientes = fs
  .readdirSync(DATOS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DATOS, f), 'utf8')))
  .filter((d) => !fs.existsSync(path.join(SALIDA, d.id, 'listo.json')));

if (pendientes.length === 0) {
  console.log('No hay carruseles pendientes.');
  process.exit(0);
}

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await pagina.goto(PLANTILLA, { waitUntil: 'networkidle' });
await pagina.evaluate(() => document.fonts.ready);

for (const datos of pendientes) {
  const carpeta = path.join(SALIDA, datos.id);
  fs.mkdirSync(carpeta, { recursive: true });
  const imagenes = [];
  const avisos = [];

  for (let i = 0; i < datos.diapositivas.length; i++) {
    await pagina.evaluate(([d, n]) => window.pintar(d, n), [datos, i]);
    await pagina.evaluate(() => document.fonts.ready);
    const desborda = await pagina.evaluate(() => document.body.dataset.desborda);
    if (desborda === 'si') avisos.push(`La diapositiva ${i + 1} no cabe ni con la letra mínima.`);

    const nombre = `${String(i + 1).padStart(2, '0')}.png`;
    await pagina.locator('#lienzo').screenshot({ path: path.join(carpeta, nombre) });
    imagenes.push(nombre);
  }

  // Marca de "terminado": n8n la consulta para saber que las imágenes ya están publicadas
  fs.writeFileSync(
    path.join(carpeta, 'listo.json'),
    JSON.stringify({ id: datos.id, imagenes, avisos, generado: new Date().toISOString() }, null, 2)
  );
  console.log(`${datos.id}: ${imagenes.length} imágenes${avisos.length ? ' · ' + avisos.join(' ') : ''}`);
}

await navegador.close();
