// Genera las imágenes de los carruseles a partir de los JSON de la carpeta "datos".
// Cada JSON puede ser un lote (varios carruseles + aviso a n8n) o un carrusel suelto.
// Solo procesa los carruseles que todavía no tienen imágenes en "docs/c/<id>/".
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = process.cwd();
const DATOS = path.join(RAIZ, 'datos');
const SALIDA = path.join(RAIZ, 'docs', 'c');
const PLANTILLA = pathToFileURL(path.join(RAIZ, 'plantilla', 'carrusel.html')).href;
const RESULTADO = path.join(RAIZ, 'resultado-lotes.json'); // lo lee avisar.mjs (no se guarda en el repositorio)

const yaGenerado = (id) => fs.existsSync(path.join(SALIDA, id, 'listo.json'));

// Leer todos los JSON y normalizarlos a lotes
const lotes = fs
  .readdirSync(DATOS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DATOS, f), 'utf8')))
  .map((j) => (Array.isArray(j.carruseles) ? j : { lote_id: j.id, carruseles: [j] }))
  .filter((lote) => lote.carruseles.some((c) => !yaGenerado(c.id)));

if (lotes.length === 0) {
  console.log('No hay carruseles pendientes.');
  fs.writeFileSync(RESULTADO, '[]');
  process.exit(0);
}

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await pagina.goto(PLANTILLA, { waitUntil: 'networkidle' });
await pagina.evaluate(() => document.fonts.ready);

const resultados = [];

for (const lote of lotes) {
  const resumen = { lote_id: lote.lote_id, resume_url: lote.resume_url || null, carruseles: [] };

  for (const datos of lote.carruseles) {
    const carpeta = path.join(SALIDA, datos.id);

    if (yaGenerado(datos.id)) {
      resumen.carruseles.push(JSON.parse(fs.readFileSync(path.join(carpeta, 'listo.json'), 'utf8')));
      continue;
    }

    fs.mkdirSync(carpeta, { recursive: true });
    const imagenes = [];
    const avisos = [];

    for (let i = 0; i < datos.diapositivas.length; i++) {
      await pagina.evaluate(([d, n]) => window.pintar(d, n), [datos, i]);
      await pagina.evaluate(() => document.fonts.ready);
      const desborda = await pagina.evaluate(() => document.body.dataset.desborda);
      if (desborda === 'si') avisos.push(`La diapositiva ${i + 1} no cabe ni con la letra mínima.`);

      // Instagram solo acepta JPEG en la publicación por API
      const nombre = `${String(i + 1).padStart(2, '0')}.jpg`;
      await pagina.locator('#lienzo').screenshot({ path: path.join(carpeta, nombre), type: 'jpeg', quality: 92 });
      imagenes.push(nombre);
    }

    // Hoja de vista previa con todas las diapositivas (para la aprobación por Telegram)
    const hoja = await navegador.newPage({ viewport: { width: 2200, height: 600 }, deviceScaleFactor: 1 });
    const miniaturas = imagenes
      .map((n) => `<img src="data:image/jpeg;base64,${fs.readFileSync(path.join(carpeta, n)).toString('base64')}">`)
      .join('');
    await hoja.setContent(
      `<html><body style="margin:0;background:#DDE3E6">
        <div id="hoja" style="display:grid;grid-template-columns:repeat(4,520px);gap:20px;padding:20px;width:max-content">
          ${miniaturas}
        </div>
        <style>img{width:520px;height:650px;display:block;border-radius:12px}</style>
      </body></html>`,
      { waitUntil: 'load' }
    );
    await hoja.locator('#hoja').screenshot({ path: path.join(carpeta, 'hoja.jpg'), type: 'jpeg', quality: 85 });
    await hoja.close();

    const listo = { id: datos.id, imagenes, hoja: 'hoja.jpg', avisos, generado: new Date().toISOString() };
    fs.writeFileSync(path.join(carpeta, 'listo.json'), JSON.stringify(listo, null, 2));
    resumen.carruseles.push(listo);
    console.log(`${datos.id}: ${imagenes.length} imágenes${avisos.length ? ' · ' + avisos.join(' ') : ''}`);
  }

  resultados.push(resumen);
}

await navegador.close();
fs.writeFileSync(RESULTADO, JSON.stringify(resultados, null, 2));
