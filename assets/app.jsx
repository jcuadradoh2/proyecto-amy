/* ════════════════════════════════════════════════════════════════
   amy · una colección de recuerdos
   React 18 (UMD) · TF.js MobileNet · No build step
   ════════════════════════════════════════════════════════════════ */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ──────────────── i18n strings ──────────────── */
const T = {
  brand: 'amy',
  eyebrow: 'Vol. I · una colección personal',
  headline_a: 'una colección',
  headline_b: 'de recuerdos',
  quote: '«cada momento, vivido dos veces.»',
  cta_gallery: 'entrar a la galería',
  cta_tour: 'comenzar el tour',
  nav_cover: 'inicio',
  nav_gallery: 'galería',
  nav_tour: 'tour',
  empty_title: 'aún no hay recuerdos guardados',
  empty_body: 'agrega tus fotos y videos a la carpeta',
  empty_step: 'luego, desde la raíz del proyecto, ejecuta',
  empty_refresh: 'recarga este sitio cuando termine.',
  loading: 'clasificando con ia',
  loaded: 'listo',
  tour_exit: 'salir del tour',
  lightbox_close: 'cerrar',
  filter_all: 'todos',
  no_results: 'no hay piezas en esta categoría todavía',
  category: 'categoría',
  piece: 'pieza'
};

/* ──────────────── AI categorization rules ────────────────
   Maps ImageNet predictions (en) → Spanish categories.
   First match wins, scanning top 3 predictions. */
const CATEGORY_RULES = [
  { cat: 'retratos', re: /\b(person|people|face|portrait|man|woman|girl|boy|baby|smile|wedding|bride|groom|hat|sunglass|hair|t.?shirt|gown|suit|jersey|skirt|sweater|bath|swimsuit|kimono|jean|jeans|tie|cardigan|cloak|miniskirt|maillot|brassiere)\b/i },
  { cat: 'flores',   re: /\b(daisy|rose|tulip|flower|blossom|orchid|petal|sunflower|bouquet|hibiscus|magnolia|yellow lady)\b/i },
  { cat: 'paisajes', re: /\b(mountain|valley|lake|coast|cliff|seashore|beach|sand|forest|tree|field|sky|horizon|ocean|sea|river|waterfall|park|volcano|geyser|alp|promontory|lakeside|sandbar|seacoast|reef|coral|meadow|hay)\b/i },
  { cat: 'sabores',  re: /\b(pizza|cake|coffee|cup|bread|pasta|burger|ice.?cream|dessert|fruit|wine|bottle|plate|dining|restaurant|meal|sandwich|salad|cookie|chocolate|pastry|guacamole|burrito|taco|carbonara|hot ?dog|cheeseburger|espresso|red wine|french loaf|pretzel|trifle|consomme)\b/i },
  { cat: 'animales', re: /\b(dog|cat|puppy|kitten|bird|horse|rabbit|fish|terrier|retriever|shepherd|poodle|labrador|husky|tabby|persian|siamese|chihuahua|spaniel|bulldog|pug|collie|setter|hound|panda|hamster|guinea pig|squirrel|deer)\b/i },
  { cat: 'ciudad',   re: /\b(building|street|city|architecture|tower|bridge|skyscraper|church|castle|car|taxi|bus|train|station|store|shop|theater|monument|palace|library|movie theater|prison|barbershop|bookshop|patio|window|balcony|pillar|column)\b/i },
  { cat: 'noche',    re: /\b(night|dark|fireworks|candle|lamp|bonfire|stage|concert|disco|moon|starr?y|spotlight|torch|jack.?o.?lantern|comet|planet|nebula)\b/i }
];

const CAT_ORDER = ['todos', 'retratos', 'paisajes', 'flores', 'sabores', 'animales', 'ciudad', 'noche', 'momentos', 'videos'];
const CAT_LABEL = {
  todos: 'todos',
  retratos: 'retratos',
  paisajes: 'paisajes',
  flores: 'flores',
  sabores: 'sabores',
  animales: 'animales',
  ciudad: 'ciudad',
  noche: 'noche',
  momentos: 'momentos',
  videos: 'videos'
};

function bucketize(predictions) {
  if (!predictions || predictions.length === 0) return 'momentos';
  for (const p of predictions.slice(0, 3)) {
    for (const rule of CATEGORY_RULES) {
      if (rule.re.test(p.className)) return rule.cat;
    }
  }
  return 'momentos';
}

/* ──────────────── localStorage cache ──────────────── */
const CACHE_KEY = 'amy.classifications.v1';

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

/* ──────────────── manifest hook ──────────────── */
function useManifest() {
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('media/manifest.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('No se pudo cargar el manifest')))
      .then(setManifest)
      .catch(e => { setErr(e.message); setManifest({ items: [], generated: null, count: 0 }); });
  }, []);

  return { manifest, err };
}

/* ──────────────── classifier hook ────────────────
   Loads MobileNet once, classifies each image, caches results. */
function useClassifier(items) {
  const [tags, setTags] = useState(() => loadCache());
  const [status, setStatus] = useState('idle'); // idle | loading | classifying | done
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelled = useRef(false);

  useEffect(() => {
    if (!items || items.length === 0) { setStatus('done'); return; }
    cancelled.current = false;

    const pending = items.filter(it => it.type === 'image' && !tags[it.id]);
    if (pending.length === 0) {
      setStatus('done');
      // ensure all videos have a tag
      const next = { ...tags };
      let dirty = false;
      for (const it of items) {
        if (it.type === 'video' && !next[it.id]) { next[it.id] = 'videos'; dirty = true; }
      }
      if (dirty) { setTags(next); saveCache(next); }
      return;
    }

    (async () => {
      setStatus('loading');
      try {
        const model = await mobilenet.load({ version: 2, alpha: 1.0 });
        if (cancelled.current) return;
        setStatus('classifying');
        setProgress({ done: 0, total: pending.length });

        const next = { ...tags };
        // also pre-tag videos
        for (const it of items) {
          if (it.type === 'video' && !next[it.id]) next[it.id] = 'videos';
        }

        let done = 0;
        for (const item of pending) {
          if (cancelled.current) return;
          try {
            const cat = await classifyOne(model, item.src);
            next[item.id] = cat;
          } catch {
            next[item.id] = 'momentos';
          }
          done++;
          setProgress({ done, total: pending.length });
          if (done % 4 === 0) { setTags({ ...next }); saveCache(next); }
        }
        setTags(next);
        saveCache(next);
        setStatus('done');
      } catch (e) {
        console.warn('classifier failed', e);
        // graceful fallback: mark everything as 'momentos'
        const next = { ...tags };
        for (const it of items) {
          if (!next[it.id]) next[it.id] = it.type === 'video' ? 'videos' : 'momentos';
        }
        setTags(next);
        saveCache(next);
        setStatus('done');
      }
    })();

    return () => { cancelled.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return { tags, status, progress };
}

function classifyOne(model, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        const preds = await model.classify(img, 3);
        resolve(bucketize(preds));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = src;
  });
}

/* ──────────────── keyboard hook ──────────────── */
function useKeyboard(handlers) {
  useEffect(() => {
    const fn = (e) => {
      const h = handlers[e.key];
      if (h) { e.preventDefault(); h(e); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [handlers]);
}

/* ──────────────── helpers ──────────────── */
function pad(n, w = 3) { return String(n).padStart(w, '0'); }
function todayLabel() {
  const d = new Date();
  const day = pad(d.getDate(), 2);
  const mo = pad(d.getMonth() + 1, 2);
  const yr = d.getFullYear();
  return `${day} · ${mo} · ${yr}`;
}
function romanYear(n) {
  const map = [['M',1000],['CM',900],['D',500],['CD',400],['C',100],['XC',90],['L',50],['XL',40],['X',10],['IX',9],['V',5],['IV',4],['I',1]];
  let r = '', x = n;
  for (const [s, v] of map) while (x >= v) { r += s; x -= v; }
  return r;
}

/* ════════════════════════════════════════════════════════════════
   APP root
   ═══════════════════════════════════════════════════════════════ */
function App() {
  const [scene, setScene] = useState('cover');
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [activeCat, setActiveCat] = useState('todos');

  const { manifest, err } = useManifest();
  const items = manifest?.items || [];
  const { tags, status, progress } = useClassifier(items);

  const filteredItems = useMemo(() => {
    if (activeCat === 'todos') return items;
    return items.filter(it => (tags[it.id] || 'momentos') === activeCat);
  }, [items, tags, activeCat]);

  const catCounts = useMemo(() => {
    const out = { todos: items.length };
    for (const cat of CAT_ORDER) if (cat !== 'todos') out[cat] = 0;
    for (const it of items) {
      const c = tags[it.id] || (it.type === 'video' ? 'videos' : 'momentos');
      out[c] = (out[c] || 0) + 1;
    }
    return out;
  }, [items, tags]);

  const openLightbox = useCallback((globalIdx) => setLightboxIdx(globalIdx), []);
  const closeLightbox = useCallback(() => setLightboxIdx(null), []);

  return (
    <React.Fragment>
      <Header scene={scene} setScene={setScene} hasItems={items.length > 0} />

      <main className="pt-24">
        {scene === 'cover' && (
          <Cover
            items={items}
            onEnter={() => setScene('gallery')}
            onTour={() => items.length > 0 ? setScene('tour') : setScene('gallery')}
            count={items.length}
            generated={manifest?.generated}
          />
        )}

        {scene === 'gallery' && (
          <Gallery
            items={items}
            filteredItems={filteredItems}
            tags={tags}
            counts={catCounts}
            activeCat={activeCat}
            setActiveCat={setActiveCat}
            onOpen={openLightbox}
            status={status}
            progress={progress}
          />
        )}
      </main>

      {scene === 'tour' && items.length > 0 && (
        <Tour items={items} tags={tags} onExit={() => setScene('gallery')} />
      )}

      {lightboxIdx !== null && items[lightboxIdx] && (
        <Lightbox
          items={items}
          index={lightboxIdx}
          tags={tags}
          onClose={closeLightbox}
          onNav={(d) => setLightboxIdx(i => (i + d + items.length) % items.length)}
        />
      )}

      <Footer />
    </React.Fragment>
  );
}

/* ════════════════════════════════════════════════════════════════
   Header
   ═══════════════════════════════════════════════════════════════ */
function Header({ scene, setScene, hasItems }) {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-bone/85 backdrop-blur-sm border-b border-line">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-12 py-5 flex items-center justify-between">
        <button onClick={() => setScene('cover')} className="brand no-select" aria-label="Inicio">
          {T.brand}
        </button>

        <nav className="flex items-center gap-1 sm:gap-4">
          <button
            data-active={scene === 'cover'}
            className="btn-ghost"
            onClick={() => setScene('cover')}>
            {T.nav_cover}
          </button>
          <button
            data-active={scene === 'gallery'}
            className="btn-ghost"
            onClick={() => setScene('gallery')}>
            {T.nav_gallery}
          </button>
          <button
            data-active={scene === 'tour'}
            className="btn-ghost"
            onClick={() => hasItems && setScene('tour')}
            disabled={!hasItems}
            style={{ opacity: hasItems ? 1 : 0.35 }}>
            {T.nav_tour}
          </button>
        </nav>

        <div className="hidden sm:block eyebrow tabular">{todayLabel()}</div>
      </div>
    </header>
  );
}

/* ════════════════════════════════════════════════════════════════
   Cover (landing)
   ═══════════════════════════════════════════════════════════════ */
function Cover({ items, onEnter, onTour, count, generated }) {
  const hero = items.find(it => it.type === 'image');

  return (
    <section className="max-w-[1600px] mx-auto px-6 lg:px-12 pt-12 pb-28">
      <div className="grid grid-cols-12 gap-6 lg:gap-12 items-center">
        {/* LEFT — text column */}
        <div className="col-span-12 lg:col-span-7 stagger">
          <div className="eyebrow">{T.eyebrow}</div>

          <h1 className="display mt-10 text-[16vw] sm:text-[12vw] lg:text-[9.2vw]">
            <span className="block">{T.headline_a}</span>
            <span className="block display-italic" style={{
              fontFamily: '"Instrument Serif", serif',
              fontStyle: 'italic',
              fontWeight: 400,
              marginLeft: '0.6em'
            }}>
              {T.headline_b}
            </span>
          </h1>

          <div className="rule-gold mt-10 max-w-[280px]"></div>

          <p className="display-italic mt-8 text-2xl sm:text-3xl text-ink-soft max-w-xl">
            {T.quote}
          </p>

          <div className="flex flex-wrap gap-4 mt-12">
            <button className="btn-line" onClick={onEnter}>
              <span>{T.cta_gallery}</span>
            </button>
            {items.length > 0 && (
              <button className="btn-line" onClick={onTour} style={{ borderColor: 'var(--rose-deep)', color: 'var(--rose-deep)' }}>
                <span>{T.cta_tour}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-8 mt-16 eyebrow tabular">
            <span>{romanYear(new Date().getFullYear())}</span>
            <span aria-hidden>·</span>
            <span>{count} {count === 1 ? T.piece : 'piezas'}</span>
            {generated && (<>
              <span aria-hidden>·</span>
              <span>actualizado {new Date(generated).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </>)}
          </div>
        </div>

        {/* RIGHT — image column */}
        <div className="col-span-12 lg:col-span-5 rise">
          {hero ? (
            <figure className="cover-aside">
              <img src={hero.src} alt="" loading="eager" />
            </figure>
          ) : (
            <figure className="cover-empty">
              <span className="mono">A</span>
            </figure>
          )}
          <figcaption className="mt-3 flex justify-between eyebrow">
            <span>Nº 001</span>
            <span>retrato · de archivo</span>
          </figcaption>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Gallery (masonry)
   ═══════════════════════════════════════════════════════════════ */
function Gallery({ items, filteredItems, tags, counts, activeCat, setActiveCat, onOpen, status, progress }) {
  const indexOf = useCallback((id) => items.findIndex(x => x.id === id), [items]);

  if (!items || items.length === 0) return <EmptyState />;

  return (
    <section className="max-w-[1600px] mx-auto px-6 lg:px-12 pb-32">
      {/* Header strip */}
      <div className="flex flex-wrap items-end justify-between gap-6 mt-6 mb-10">
        <div>
          <div className="eyebrow">archivo · {T.brand}</div>
          <h2 className="display mt-3 text-5xl sm:text-6xl">la galería</h2>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ClassifierStatus status={status} progress={progress} />
          <div className="eyebrow tabular">
            {filteredItems.length} / {items.length} piezas
          </div>
        </div>
      </div>

      <div className="rule-fine mb-8"></div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-12">
        {CAT_ORDER.filter(c => c === 'todos' || (counts[c] || 0) > 0).map(c => (
          <button
            key={c}
            className="chip"
            data-active={activeCat === c}
            onClick={() => setActiveCat(c)}>
            {CAT_LABEL[c]}
            <span className="chip-count tabular">{counts[c] || 0}</span>
          </button>
        ))}
      </div>

      {/* Masonry */}
      {filteredItems.length === 0 ? (
        <p className="display-italic text-2xl text-muted my-20">{T.no_results}.</p>
      ) : (
        <div className="masonry">
          {filteredItems.map((it, i) => (
            <Tile
              key={it.id}
              item={it}
              n={indexOf(it.id) + 1}
              cat={tags[it.id]}
              onOpen={() => onOpen(indexOf(it.id))}
              delay={Math.min(i, 12) * 0.05}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Tile({ item, n, cat, onOpen, delay }) {
  const isVideo = item.type === 'video';
  return (
    <figure
      className="tile tile-enter no-select"
      style={{ animationDelay: `${delay}s` }}
      onClick={onOpen}>
      {isVideo ? (
        <React.Fragment>
          <video
            className="tile-video"
            src={item.src}
            preload="metadata"
            muted
            playsInline
          />
          <span className="tile-play">▶ ver</span>
        </React.Fragment>
      ) : (
        <img className="tile-img" src={item.src} alt="" loading="lazy" decoding="async" />
      )}
      <figcaption className="tile-caption">
        <span className="tile-num tabular">Nº {pad(n)}</span>
        <span className="tile-cat">{cat || (isVideo ? 'video' : '·')}</span>
      </figcaption>
    </figure>
  );
}

function ClassifierStatus({ status, progress }) {
  if (status === 'idle' || status === 'done') {
    return <div className="status done">{T.loaded}</div>;
  }
  if (status === 'loading') {
    return <div className="status">{T.loading} · cargando modelo</div>;
  }
  return (
    <div className="status tabular">
      {T.loading} · {progress.done}/{progress.total}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Empty state
   ═══════════════════════════════════════════════════════════════ */
function EmptyState() {
  return (
    <section className="max-w-3xl mx-auto px-6 lg:px-12 py-32 stagger">
      <div className="eyebrow">archivo · vacío</div>
      <h2 className="display mt-6 text-5xl sm:text-6xl">{T.empty_title}.</h2>
      <div className="rule-gold mt-8 max-w-[200px]"></div>

      <ol className="mt-12 space-y-8 text-lg text-ink-soft">
        <li className="flex gap-6">
          <span className="numeral text-3xl text-rose-deep">i.</span>
          <span>
            {T.empty_body}{' '}
            <code className="code-block">/media/amy/</code>
          </span>
        </li>
        <li className="flex gap-6">
          <span className="numeral text-3xl text-rose-deep">ii.</span>
          <span>
            {T.empty_step}{' '}
            <code className="code-block">node scripts/generate-manifest.mjs</code>
          </span>
        </li>
        <li className="flex gap-6">
          <span className="numeral text-3xl text-rose-deep">iii.</span>
          <span>{T.empty_refresh}</span>
        </li>
      </ol>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Tour (auto-play slideshow)
   ═══════════════════════════════════════════════════════════════ */
const SLIDE_DURATION = 6500; // ms for images

function Tour({ items, tags, onExit }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const tickRef = useRef(null);
  const startRef = useRef(Date.now());
  const videoRef = useRef(null);

  const cur = items[idx];
  const isVideo = cur?.type === 'video';

  const next = useCallback(() => setIdx(i => (i + 1) % items.length), [items.length]);
  const prev = useCallback(() => setIdx(i => (i - 1 + items.length) % items.length), [items.length]);

  // Tick for progress + auto-advance
  useEffect(() => {
    if (!playing) return;
    startRef.current = Date.now();
    setProgress(0);

    if (isVideo) {
      // Let the video play, advance on ended (handled below)
      return;
    }

    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(100, (elapsed / SLIDE_DURATION) * 100);
      setProgress(p);
      if (p >= 100) {
        clearInterval(tickRef.current);
        next();
      }
    }, 80);
    return () => clearInterval(tickRef.current);
  }, [idx, playing, isVideo, next]);

  useKeyboard({
    Escape: onExit,
    ArrowRight: next,
    ArrowLeft: prev,
    ' ': () => setPlaying(p => !p)
  });

  // Video → advance on end
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnd = () => playing && next();
    v.addEventListener('ended', onEnd);
    return () => v.removeEventListener('ended', onEnd);
  }, [idx, playing, next]);

  if (!cur) return null;

  const cat = tags[cur.id] || (isVideo ? 'video' : 'momentos');

  return (
    <div className="tour-stage no-select" role="dialog" aria-label="Tour virtual">
      {/* Two slides for crossfade effect: previous frame fades while current rises */}
      <div className="tour-slide" data-state="active" key={cur.id}>
        {isVideo ? (
          <video
            ref={videoRef}
            src={cur.src}
            autoPlay={playing}
            muted
            playsInline
          />
        ) : (
          <img src={cur.src} alt="" />
        )}
      </div>

      <div className="tour-vignette" aria-hidden></div>

      {/* Progress */}
      <div className="tour-progress" style={{ '--p': `${progress}%` }}></div>

      <button className="tour-exit" onClick={onExit}>{T.tour_exit}</button>

      <div className="tour-meta">
        <div className="num tabular">Nº {pad(idx + 1)} / {pad(items.length)}</div>
        <div className="cat">{cat}</div>
        <div className="quote">
          {idx === 0 ? T.quote : (
            <React.Fragment>«{cur.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}»</React.Fragment>
          )}
        </div>
      </div>

      <div className="tour-controls">
        <button className="tour-btn" onClick={prev} title="anterior · ←">‹</button>
        <button className="tour-btn lg" onClick={() => setPlaying(p => !p)} title="pausar · espacio">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="tour-btn" onClick={next} title="siguiente · →">›</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Lightbox
   ═══════════════════════════════════════════════════════════════ */
function Lightbox({ items, index, tags, onClose, onNav }) {
  const cur = items[index];
  const isVideo = cur?.type === 'video';
  const cat = tags[cur.id] || (isVideo ? 'video' : 'momentos');

  useKeyboard({
    Escape: onClose,
    ArrowRight: () => onNav(1),
    ArrowLeft: () => onNav(-1)
  });

  return (
    <div className="lightbox-shade" role="dialog" aria-modal="true" onClick={(e) => { if (e.target.classList.contains('lightbox-shade') || e.target.classList.contains('lightbox-stage')) onClose(); }}>
      <button className="lightbox-close" onClick={onClose}>{T.lightbox_close} · esc</button>

      <div className="lightbox-stage">
        {items.length > 1 && (
          <button className="lightbox-nav lightbox-prev" onClick={() => onNav(-1)} aria-label="anterior">‹</button>
        )}

        {isVideo ? (
          <video className="lightbox-media" src={cur.src} controls autoPlay playsInline key={cur.id} />
        ) : (
          <img className="lightbox-media" src={cur.src} alt="" key={cur.id} />
        )}

        {items.length > 1 && (
          <button className="lightbox-nav lightbox-next" onClick={() => onNav(1)} aria-label="siguiente">›</button>
        )}
      </div>

      <div className="lightbox-meta">
        <div>
          <div className="numeral tabular" style={{ fontSize: '0.95rem', color: 'var(--gold-2)' }}>
            Nº {pad(index + 1)} / {pad(items.length)}
          </div>
          <div className="caps" style={{ marginTop: '0.35rem', color: 'rgba(245,237,224,0.7)' }}>
            {cat}
          </div>
        </div>
        <div className="display-italic" style={{ fontSize: '1.5rem', color: 'rgba(245,237,224,0.9)', textAlign: 'right', maxWidth: '40%' }}>
          {cur.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════════════════════════ */
function Footer() {
  return (
    <footer className="border-t border-line mt-0">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-12 py-10 flex flex-wrap items-center justify-between gap-4">
        <div className="eyebrow">{T.brand} · {romanYear(new Date().getFullYear())}</div>
        <div className="display-italic text-ink-soft text-xl">una colección personal.</div>
        <div className="eyebrow tabular">{todayLabel()}</div>
      </div>
    </footer>
  );
}

/* ──────────────── mount ──────────────── */
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
