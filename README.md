# amy · una colección de recuerdos

Tour virtual estático para GitHub Pages. Galería editorial + slideshow cinematográfico con clasificación de imágenes por IA 100 % en el navegador (TensorFlow.js + MobileNet, sin API keys ni backend).

## Stack

- **React 18** vía CDN UMD (sin build)
- **Babel standalone** para transpilar JSX en el navegador
- **Tailwind CSS** vía Play CDN con tema editorial extendido
- **TensorFlow.js + MobileNet** para etiquetar imágenes en cliente
- **Fraunces · Instrument Serif · DM Sans** desde Google Fonts

## Estructura

```
proyecto-amy/
├── index.html                  ← entrada
├── assets/
│   ├── styles.css              ← sistema de diseño editorial
│   └── app.jsx                 ← app React (Cover / Galería / Tour / Lightbox)
├── scripts/
│   └── generate-manifest.mjs   ← genera media/manifest.json
└── media/
    ├── manifest.json           ← índice generado
    └── amy/                    ← TUS fotos y videos aquí
```

## Uso

### 1 · agregar recuerdos

Copia tus fotos y videos a `media/amy/`. Acepta:

- imágenes: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`
- videos: `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`

### 2 · generar el manifest

GitHub Pages no permite listar directorios, así que necesitamos un índice estático:

```bash
node scripts/generate-manifest.mjs
```

Requiere Node ≥ 18. Esto crea/actualiza `media/manifest.json` con todos los archivos válidos ordenados por fecha de modificación.

### 3 · servir localmente

JSX se transpila en el navegador, así que necesitas un servidor HTTP (no abrir `file://`).

```bash
# opción a — python
python -m http.server 8000

# opción b — node
npx serve .

# opción c — vscode
# instala la extensión "Live Server" y haz click derecho → "Open with Live Server"
```

Abre <http://localhost:8000>.

### 4 · publicar en GitHub Pages

1. `git add . && git commit -m "media: nuevos recuerdos" && git push`
2. En el repo: **Settings → Pages → Source: Deploy from branch → `master` / `(root)`**
3. Tu sitio estará en `https://<usuario>.github.io/proyecto-amy/`

> ⚠️ Recuerda correr `node scripts/generate-manifest.mjs` antes de cada push si agregaste o quitaste archivos.

## Clasificación con IA

La primera vez que se carga el sitio, MobileNet (~17 MB) descarga al navegador y clasifica cada imagen en una de las siguientes categorías:

`retratos · paisajes · flores · sabores · animales · ciudad · noche · momentos · videos`

Los resultados se guardan en `localStorage` para no reclasificar en futuras visitas. El estado se ve en la esquina superior derecha de la galería.

## Modos de visualización

- **Cover** — portada editorial estilo revista, con el primer recuerdo como pieza Nº 001
- **Galería** — masonry CSS con filtros por categoría IA, números tipo catálogo de museo
- **Tour** — slideshow fullscreen con efecto Ken Burns, transiciones suaves, viñeta cinematográfica, controles de teclado (`←` `→` `espacio` `esc`)
- **Lightbox** — visor inmersivo con navegación por teclado

## Personalización rápida

- Paleta de colores: variables CSS en `assets/styles.css` (`:root`) y `tailwind.config` en `index.html`
- Textos en español: objeto `T` al inicio de `assets/app.jsx`
- Categorías IA: array `CATEGORY_RULES` en `assets/app.jsx`
- Duración por slide en el tour: constante `SLIDE_DURATION` en `assets/app.jsx`

---

*hecho con cariño · MMXXVI*
