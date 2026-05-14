/* ════════════════════════════════════════════════════════════════
   amy · una colección de recuerdos
   React 18 (UMD) · TF.js MobileNet · No build step
   ════════════════════════════════════════════════════════════════ */

const {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback
} = React;

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
  nav_promesa: 'promesa',
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
const CATEGORY_RULES = [{
  cat: 'retratos',
  re: /\b(person|people|face|portrait|man|woman|girl|boy|baby|smile|wedding|bride|groom|hat|sunglass|hair|t.?shirt|gown|suit|jersey|skirt|sweater|bath|swimsuit|kimono|jean|jeans|tie|cardigan|cloak|miniskirt|maillot|brassiere)\b/i
}, {
  cat: 'flores',
  re: /\b(daisy|rose|tulip|flower|blossom|orchid|petal|sunflower|bouquet|hibiscus|magnolia|yellow lady)\b/i
}, {
  cat: 'paisajes',
  re: /\b(mountain|valley|lake|coast|cliff|seashore|beach|sand|forest|tree|field|sky|horizon|ocean|sea|river|waterfall|park|volcano|geyser|alp|promontory|lakeside|sandbar|seacoast|reef|coral|meadow|hay)\b/i
}, {
  cat: 'sabores',
  re: /\b(pizza|cake|coffee|cup|bread|pasta|burger|ice.?cream|dessert|fruit|wine|bottle|plate|dining|restaurant|meal|sandwich|salad|cookie|chocolate|pastry|guacamole|burrito|taco|carbonara|hot ?dog|cheeseburger|espresso|red wine|french loaf|pretzel|trifle|consomme)\b/i
}, {
  cat: 'animales',
  re: /\b(dog|cat|puppy|kitten|bird|horse|rabbit|fish|terrier|retriever|shepherd|poodle|labrador|husky|tabby|persian|siamese|chihuahua|spaniel|bulldog|pug|collie|setter|hound|panda|hamster|guinea pig|squirrel|deer)\b/i
}, {
  cat: 'ciudad',
  re: /\b(building|street|city|architecture|tower|bridge|skyscraper|church|castle|car|taxi|bus|train|station|store|shop|theater|monument|palace|library|movie theater|prison|barbershop|bookshop|patio|window|balcony|pillar|column)\b/i
}, {
  cat: 'noche',
  re: /\b(night|dark|fireworks|candle|lamp|bonfire|stage|concert|disco|moon|starr?y|spotlight|torch|jack.?o.?lantern|comet|planet|nebula)\b/i
}];
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
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/* ──────────────── manifest hook ──────────────── */
function useManifest() {
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch('media/manifest.json', {
      cache: 'no-cache'
    }).then(r => r.ok ? r.json() : Promise.reject(new Error('No se pudo cargar el manifest'))).then(setManifest).catch(e => {
      setErr(e.message);
      setManifest({
        items: [],
        generated: null,
        count: 0
      });
    });
  }, []);
  return {
    manifest,
    err
  };
}

/* ──────────────── classifier hook ────────────────
   Desktop only: loads TF.js + MobileNet dynamically and classifies.
   Mobile: uses localStorage cache only, skips model load entirely. */

const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function useClassifier(items) {
  const [tags, setTags] = useState(() => loadCache());
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({
    done: 0,
    total: 0
  });
  const cancelled = useRef(false);
  useEffect(() => {
    if (!items || items.length === 0) {
      setStatus('done');
      return;
    }
    cancelled.current = false;
    const pending = items.filter(it => it.type === 'image' && !tags[it.id]);

    // Tag videos and finish early if nothing needs classification
    const next = {
      ...tags
    };
    let dirty = false;
    for (const it of items) {
      if (it.type === 'video' && !next[it.id]) {
        next[it.id] = 'videos';
        dirty = true;
      }
    }
    if (pending.length === 0) {
      setStatus('done');
      if (dirty) {
        setTags(next);
        saveCache(next);
      }
      return;
    }

    // Mobile: skip model, mark pending as 'momentos' from cache
    if (isMobile) {
      for (const it of pending) next[it.id] = 'momentos';
      setTags(next);
      saveCache(next);
      setStatus('done');
      return;
    }
    (async () => {
      setStatus('loading');
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js');
        if (cancelled.current) return;
        const model = await mobilenet.load({
          version: 2,
          alpha: 0.5
        });
        if (cancelled.current) return;
        setStatus('classifying');
        setProgress({
          done: 0,
          total: pending.length
        });
        for (const it of items) {
          if (it.type === 'video' && !next[it.id]) next[it.id] = 'videos';
        }
        let done = 0;
        for (const item of pending) {
          if (cancelled.current) return;
          try {
            next[item.id] = await classifyOne(model, item.src);
          } catch {
            next[item.id] = 'momentos';
          }
          done++;
          setProgress({
            done,
            total: pending.length
          });
          if (done % 4 === 0) {
            setTags({
              ...next
            });
            saveCache(next);
          }
        }
        setTags(next);
        saveCache(next);
        setStatus('done');
      } catch (e) {
        console.warn('classifier failed', e);
        for (const it of items) {
          if (!next[it.id]) next[it.id] = it.type === 'video' ? 'videos' : 'momentos';
        }
        setTags(next);
        saveCache(next);
        setStatus('done');
      }
    })();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  return {
    tags,
    status,
    progress
  };
}
function classifyOne(model, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        const preds = await model.classify(img, 3);
        resolve(bucketize(preds));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = src;
  });
}

/* ──────────────── keyboard hook ──────────────── */
function useKeyboard(handlers) {
  useEffect(() => {
    const fn = e => {
      const h = handlers[e.key];
      if (h) {
        e.preventDefault();
        h(e);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [handlers]);
}

/* ──────────────── helpers ──────────────── */
function pad(n, w = 3) {
  return String(n).padStart(w, '0');
}
function todayLabel() {
  const d = new Date();
  const day = pad(d.getDate(), 2);
  const mo = pad(d.getMonth() + 1, 2);
  const yr = d.getFullYear();
  return `${day} · ${mo} · ${yr}`;
}
function romanYear(n) {
  const map = [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
  let r = '',
    x = n;
  for (const [s, v] of map) while (x >= v) {
    r += s;
    x -= v;
  }
  return r;
}

/* ════════════════════════════════════════════════════════════════
   Lock screen
   ═══════════════════════════════════════════════════════════════ */
const _H = '2d7aeba500efbe193ce084ea7669e3a6c37ce96c4b042836d57726364dfe27ed';
async function _digest(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function LockScreen({
  onUnlock
}) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault();
    if (!val.trim()) return;
    setBusy(true);
    const h = await _digest(val.trim().toLowerCase());
    if (h === _H) {
      sessionStorage.setItem('_a', '1');
      onUnlock();
    } else {
      setErr(true);
      setShake(true);
      setVal('');
      setBusy(false);
      setTimeout(() => setShake(false), 600);
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "lock-screen"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lock-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand lock-brand"
  }, "amy"), /*#__PURE__*/React.createElement("div", {
    className: "rule-gold",
    style: {
      maxWidth: 120,
      margin: '1.5rem auto'
    }
  }), /*#__PURE__*/React.createElement("p", {
    className: "display-italic lock-hint"
  }, "ingresa tus iniciales para continuar"), /*#__PURE__*/React.createElement("form", {
    onSubmit: handleSubmit,
    className: `lock-form${shake ? ' lock-shake' : ''}`
  }, /*#__PURE__*/React.createElement("input", {
    className: "lock-input",
    type: "text",
    maxLength: 8,
    value: val,
    onChange: e => {
      setVal(e.target.value);
      setErr(false);
    },
    placeholder: "_ _ _ _",
    autoFocus: true,
    autoComplete: "off",
    spellCheck: false
  }), err && /*#__PURE__*/React.createElement("p", {
    className: "lock-err eyebrow"
  }, "iniciales incorrectas \xB7 int\xE9ntalo de nuevo"), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn-line lock-btn",
    disabled: busy || !val.trim()
  }, /*#__PURE__*/React.createElement("span", null, busy ? '···' : 'entrar')))));
}

/* ════════════════════════════════════════════════════════════════
   APP root
   ═══════════════════════════════════════════════════════════════ */
function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('_a') === '1');
  const [scene, setScene] = useState('cover');
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [activeCat, setActiveCat] = useState('todos');
  const {
    manifest,
    err
  } = useManifest();
  const items = manifest?.items || [];
  const {
    tags,
    status,
    progress
  } = useClassifier(items);
  const filteredItems = useMemo(() => {
    if (activeCat === 'todos') return items;
    return items.filter(it => (tags[it.id] || 'momentos') === activeCat);
  }, [items, tags, activeCat]);
  const catCounts = useMemo(() => {
    const out = {
      todos: items.length
    };
    for (const cat of CAT_ORDER) if (cat !== 'todos') out[cat] = 0;
    for (const it of items) {
      const c = tags[it.id] || (it.type === 'video' ? 'videos' : 'momentos');
      out[c] = (out[c] || 0) + 1;
    }
    return out;
  }, [items, tags]);
  const openLightbox = useCallback(globalIdx => setLightboxIdx(globalIdx), []);
  const closeLightbox = useCallback(() => setLightboxIdx(null), []);
  if (!unlocked) return /*#__PURE__*/React.createElement(LockScreen, {
    onUnlock: () => setUnlocked(true)
  });
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Header, {
    scene: scene,
    setScene: setScene,
    hasItems: items.length > 0
  }), /*#__PURE__*/React.createElement("main", {
    className: "pt-24"
  }, scene === 'cover' && /*#__PURE__*/React.createElement(Cover, {
    items: items,
    onEnter: () => setScene('gallery'),
    onTour: () => items.length > 0 ? setScene('tour') : setScene('gallery'),
    count: items.length,
    generated: manifest?.generated
  }), scene === 'gallery' && /*#__PURE__*/React.createElement(Gallery, {
    items: items,
    filteredItems: filteredItems,
    tags: tags,
    counts: catCounts,
    activeCat: activeCat,
    setActiveCat: setActiveCat,
    onOpen: openLightbox,
    status: status,
    progress: progress
  })), scene === 'tour' && items.length > 0 && /*#__PURE__*/React.createElement(Tour, {
    items: items,
    tags: tags,
    onExit: () => setScene('gallery')
  }), scene === 'promesa' && /*#__PURE__*/React.createElement(Promesa, {
    onCierre: () => setScene('cierre'),
    onBack: () => setScene('cover')
  }), scene === 'cierre' && /*#__PURE__*/React.createElement(Cierre, {
    onBack: () => setScene('promesa')
  }), lightboxIdx !== null && items[lightboxIdx] && /*#__PURE__*/React.createElement(Lightbox, {
    items: items,
    index: lightboxIdx,
    tags: tags,
    onClose: closeLightbox,
    onNav: d => setLightboxIdx(i => (i + d + items.length) % items.length)
  }), /*#__PURE__*/React.createElement(Footer, null));
}

/* ════════════════════════════════════════════════════════════════
   Header
   ═══════════════════════════════════════════════════════════════ */
function Header({
  scene,
  setScene,
  hasItems
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "fixed top-0 inset-x-0 z-50 bg-bone/85 backdrop-blur-sm border-b border-line"
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-[1600px] mx-auto px-6 lg:px-12 py-5 flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setScene('cover'),
    className: "brand no-select",
    "aria-label": "Inicio"
  }, T.brand), /*#__PURE__*/React.createElement("nav", {
    className: "flex items-center gap-1 sm:gap-4"
  }, /*#__PURE__*/React.createElement("button", {
    "data-active": scene === 'cover',
    className: "btn-ghost",
    onClick: () => setScene('cover')
  }, T.nav_cover), /*#__PURE__*/React.createElement("button", {
    "data-active": scene === 'gallery',
    className: "btn-ghost",
    onClick: () => setScene('gallery')
  }, T.nav_gallery), /*#__PURE__*/React.createElement("button", {
    "data-active": scene === 'tour',
    className: "btn-ghost",
    onClick: () => hasItems && setScene('tour'),
    disabled: !hasItems,
    style: {
      opacity: hasItems ? 1 : 0.35
    }
  }, T.nav_tour), /*#__PURE__*/React.createElement("button", {
    "data-active": scene === 'promesa' || scene === 'cierre',
    className: "btn-ghost",
    onClick: () => setScene('promesa'),
    style: {
      color: scene === 'promesa' || scene === 'cierre' ? 'var(--rose-deep)' : undefined,
      borderBottomColor: scene === 'promesa' || scene === 'cierre' ? 'var(--rose-deep)' : undefined
    }
  }, T.nav_promesa)), /*#__PURE__*/React.createElement("div", {
    className: "hidden sm:block eyebrow tabular"
  }, todayLabel())));
}

/* ════════════════════════════════════════════════════════════════
   Cover (landing)
   ═══════════════════════════════════════════════════════════════ */
function Cover({
  items,
  onEnter,
  onTour,
  count,
  generated
}) {
  const hero = items.find(it => it.type === 'image');
  return /*#__PURE__*/React.createElement("section", {
    className: "max-w-[1600px] mx-auto px-6 lg:px-12 pt-12 pb-28"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-12 gap-6 lg:gap-12 items-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "col-span-12 lg:col-span-7 stagger"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, T.eyebrow), /*#__PURE__*/React.createElement("h1", {
    className: "display mt-10 text-[16vw] sm:text-[12vw] lg:text-[9.2vw]"
  }, /*#__PURE__*/React.createElement("span", {
    className: "block"
  }, T.headline_a), /*#__PURE__*/React.createElement("span", {
    className: "block display-italic",
    style: {
      fontFamily: '"Instrument Serif", serif',
      fontStyle: 'italic',
      fontWeight: 400,
      marginLeft: '0.6em'
    }
  }, T.headline_b)), /*#__PURE__*/React.createElement("div", {
    className: "rule-gold mt-10 max-w-[280px]"
  }), /*#__PURE__*/React.createElement("p", {
    className: "display-italic mt-8 text-2xl sm:text-3xl text-ink-soft max-w-xl"
  }, T.quote), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-4 mt-12"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-line",
    onClick: onEnter
  }, /*#__PURE__*/React.createElement("span", null, T.cta_gallery)), items.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn-line",
    onClick: onTour,
    style: {
      borderColor: 'var(--rose-deep)',
      color: 'var(--rose-deep)'
    }
  }, /*#__PURE__*/React.createElement("span", null, T.cta_tour))), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap items-center gap-x-4 gap-y-1 mt-12 eyebrow tabular"
  }, /*#__PURE__*/React.createElement("span", null, romanYear(new Date().getFullYear())), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, count, " ", count === 1 ? T.piece : 'piezas'), generated && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    className: "hidden sm:inline"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    className: "hidden sm:inline"
  }, "actualizado ", new Date(generated).toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "col-span-12 lg:col-span-5 rise"
  }, hero ? /*#__PURE__*/React.createElement("figure", {
    className: "cover-aside"
  }, /*#__PURE__*/React.createElement("img", {
    src: hero.src,
    alt: "",
    loading: "eager"
  })) : /*#__PURE__*/React.createElement("figure", {
    className: "cover-empty"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono"
  }, "A")), /*#__PURE__*/React.createElement("figcaption", {
    className: "mt-3 flex justify-between eyebrow"
  }, /*#__PURE__*/React.createElement("span", null, "N\xBA 001"), /*#__PURE__*/React.createElement("span", null, "retrato \xB7 de archivo")))));
}

/* ════════════════════════════════════════════════════════════════
   Gallery (masonry)
   ═══════════════════════════════════════════════════════════════ */
const PAGE_SIZE = 24;
function Gallery({
  items,
  filteredItems,
  tags,
  counts,
  activeCat,
  setActiveCat,
  onOpen,
  status,
  progress
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const indexOf = useCallback(id => items.findIndex(x => x.id === id), [items]);
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [activeCat]);
  if (!items || items.length === 0) return /*#__PURE__*/React.createElement(EmptyState, null);
  const shown = filteredItems.slice(0, visible);
  const hasMore = visible < filteredItems.length;
  return /*#__PURE__*/React.createElement("section", {
    className: "max-w-[1600px] mx-auto px-6 lg:px-12 pb-32"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap items-end justify-between gap-6 mt-6 mb-10"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, "archivo \xB7 ", T.brand), /*#__PURE__*/React.createElement("h2", {
    className: "display mt-3 text-5xl sm:text-6xl"
  }, "la galer\xEDa")), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col items-end gap-2"
  }, /*#__PURE__*/React.createElement(ClassifierStatus, {
    status: status,
    progress: progress
  }), /*#__PURE__*/React.createElement("div", {
    className: "eyebrow tabular"
  }, shown.length, " / ", filteredItems.length, " piezas"))), /*#__PURE__*/React.createElement("div", {
    className: "rule-fine mb-8"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2 mb-12"
  }, CAT_ORDER.filter(c => c === 'todos' || (counts[c] || 0) > 0).map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "chip",
    "data-active": activeCat === c,
    onClick: () => setActiveCat(c)
  }, CAT_LABEL[c], /*#__PURE__*/React.createElement("span", {
    className: "chip-count tabular"
  }, counts[c] || 0)))), filteredItems.length === 0 ? /*#__PURE__*/React.createElement("p", {
    className: "display-italic text-2xl text-muted my-20"
  }, T.no_results, ".") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "masonry"
  }, shown.map((it, i) => /*#__PURE__*/React.createElement(Tile, {
    key: it.id,
    item: it,
    n: indexOf(it.id) + 1,
    cat: tags[it.id],
    onOpen: () => onOpen(indexOf(it.id)),
    delay: Math.min(i, 12) * 0.05
  }))), hasMore && /*#__PURE__*/React.createElement("div", {
    className: "flex justify-center mt-16"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-line",
    onClick: () => setVisible(v => v + PAGE_SIZE)
  }, /*#__PURE__*/React.createElement("span", null, "cargar m\xE1s \xB7 ", filteredItems.length - visible, " restantes")))));
}
function Tile({
  item,
  n,
  cat,
  onOpen,
  delay
}) {
  const isVideo = item.type === 'video';
  const videoRef = useRef(null);
  useEffect(() => {
    if (!isVideo) return;
    const el = videoRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.preload = 'metadata';
        obs.disconnect();
      }
    }, {
      rootMargin: '200px',
      threshold: 0
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isVideo]);
  return /*#__PURE__*/React.createElement("figure", {
    className: "tile tile-enter no-select",
    style: {
      animationDelay: `${delay}s`
    },
    onClick: onOpen
  }, isVideo ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("video", {
    ref: videoRef,
    className: "tile-video",
    src: item.src,
    preload: "none",
    muted: true,
    playsInline: true
  }), /*#__PURE__*/React.createElement("span", {
    className: "tile-play",
    "aria-label": "reproducir"
  })) : /*#__PURE__*/React.createElement("img", {
    className: "tile-img",
    src: item.src,
    alt: "",
    loading: "lazy",
    decoding: "async"
  }), /*#__PURE__*/React.createElement("figcaption", {
    className: "tile-caption"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tile-num tabular"
  }, "N\xBA ", pad(n)), /*#__PURE__*/React.createElement("span", {
    className: "tile-cat"
  }, cat || (isVideo ? 'video' : '·'))));
}
function ClassifierStatus({
  status,
  progress
}) {
  if (status === 'idle' || status === 'done') {
    return /*#__PURE__*/React.createElement("div", {
      className: "status done"
    }, T.loaded);
  }
  if (status === 'loading') {
    return /*#__PURE__*/React.createElement("div", {
      className: "status"
    }, T.loading, " \xB7 cargando modelo");
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "status tabular"
  }, T.loading, " \xB7 ", progress.done, "/", progress.total);
}

/* ════════════════════════════════════════════════════════════════
   Empty state
   ═══════════════════════════════════════════════════════════════ */
function EmptyState() {
  return /*#__PURE__*/React.createElement("section", {
    className: "max-w-3xl mx-auto px-6 lg:px-12 py-32 stagger"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, "archivo \xB7 vac\xEDo"), /*#__PURE__*/React.createElement("h2", {
    className: "display mt-6 text-5xl sm:text-6xl"
  }, T.empty_title, "."), /*#__PURE__*/React.createElement("div", {
    className: "rule-gold mt-8 max-w-[200px]"
  }), /*#__PURE__*/React.createElement("ol", {
    className: "mt-12 space-y-8 text-lg text-ink-soft"
  }, /*#__PURE__*/React.createElement("li", {
    className: "flex gap-6"
  }, /*#__PURE__*/React.createElement("span", {
    className: "numeral text-3xl text-rose-deep"
  }, "i."), /*#__PURE__*/React.createElement("span", null, T.empty_body, ' ', /*#__PURE__*/React.createElement("code", {
    className: "code-block"
  }, "/media/amy/"))), /*#__PURE__*/React.createElement("li", {
    className: "flex gap-6"
  }, /*#__PURE__*/React.createElement("span", {
    className: "numeral text-3xl text-rose-deep"
  }, "ii."), /*#__PURE__*/React.createElement("span", null, T.empty_step, ' ', /*#__PURE__*/React.createElement("code", {
    className: "code-block"
  }, "node scripts/generate-manifest.mjs"))), /*#__PURE__*/React.createElement("li", {
    className: "flex gap-6"
  }, /*#__PURE__*/React.createElement("span", {
    className: "numeral text-3xl text-rose-deep"
  }, "iii."), /*#__PURE__*/React.createElement("span", null, T.empty_refresh))));
}

/* ════════════════════════════════════════════════════════════════
   Tour (auto-play slideshow)
   ═══════════════════════════════════════════════════════════════ */
const SLIDE_DURATION = 6500; // ms for images

function Tour({
  items,
  tags,
  onExit
}) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const tickRef = useRef(null);
  const startRef = useRef(Date.now());
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing]);
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, []);
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
      const p = Math.min(100, elapsed / SLIDE_DURATION * 100);
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
  return /*#__PURE__*/React.createElement("div", {
    className: "tour-stage no-select",
    role: "dialog",
    "aria-label": "Tour virtual"
  }, /*#__PURE__*/React.createElement("audio", {
    ref: audioRef,
    src: "media/tour-music.mp3",
    loop: true,
    preload: "auto",
    style: {
      display: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "tour-slide",
    "data-state": "active",
    key: cur.id
  }, isVideo ? /*#__PURE__*/React.createElement("video", {
    ref: videoRef,
    src: cur.src,
    autoPlay: playing,
    muted: true,
    playsInline: true
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("img", {
    className: "tour-bg",
    src: cur.src,
    alt: "",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("img", {
    className: "tour-fg",
    src: cur.src,
    alt: ""
  }))), /*#__PURE__*/React.createElement("div", {
    className: "tour-vignette",
    "aria-hidden": true
  }), /*#__PURE__*/React.createElement("div", {
    className: "tour-progress",
    style: {
      '--p': `${progress}%`
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "tour-exit",
    onClick: onExit
  }, T.tour_exit), /*#__PURE__*/React.createElement("div", {
    className: "tour-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num tabular"
  }, "N\xBA ", pad(idx + 1), " / ", pad(items.length)), /*#__PURE__*/React.createElement("div", {
    className: "cat"
  }, cat), /*#__PURE__*/React.createElement("div", {
    className: "quote"
  }, idx === 0 ? T.quote : /*#__PURE__*/React.createElement(React.Fragment, null, "\xAB", cur.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), "\xBB"))), /*#__PURE__*/React.createElement("div", {
    className: "tour-controls"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tour-btn",
    onClick: prev,
    title: "anterior \xB7 \u2190"
  }, "\u2039"), /*#__PURE__*/React.createElement("button", {
    className: "tour-btn lg",
    onClick: () => setPlaying(p => !p),
    title: "pausar \xB7 espacio"
  }, playing ? '❚❚' : '▶'), /*#__PURE__*/React.createElement("button", {
    className: "tour-btn",
    onClick: next,
    title: "siguiente \xB7 \u2192"
  }, "\u203A")));
}

/* ════════════════════════════════════════════════════════════════
   Lightbox
   ═══════════════════════════════════════════════════════════════ */
function Lightbox({
  items,
  index,
  tags,
  onClose,
  onNav
}) {
  const cur = items[index];
  const isVideo = cur?.type === 'video';
  const cat = tags[cur.id] || (isVideo ? 'video' : 'momentos');
  useKeyboard({
    Escape: onClose,
    ArrowRight: () => onNav(1),
    ArrowLeft: () => onNav(-1)
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "lightbox-shade",
    role: "dialog",
    "aria-modal": "true",
    onClick: e => {
      if (e.target.classList.contains('lightbox-shade') || e.target.classList.contains('lightbox-stage')) onClose();
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "lightbox-close",
    onClick: onClose
  }, T.lightbox_close, " \xB7 esc"), /*#__PURE__*/React.createElement("div", {
    className: "lightbox-stage"
  }, items.length > 1 && /*#__PURE__*/React.createElement("button", {
    className: "lightbox-nav lightbox-prev",
    onClick: () => onNav(-1),
    "aria-label": "anterior"
  }, "\u2039"), isVideo ? /*#__PURE__*/React.createElement("video", {
    className: "lightbox-media",
    src: cur.src,
    controls: true,
    autoPlay: true,
    playsInline: true,
    key: cur.id
  }) : /*#__PURE__*/React.createElement("img", {
    className: "lightbox-media",
    src: cur.src,
    alt: "",
    key: cur.id
  }), items.length > 1 && /*#__PURE__*/React.createElement("button", {
    className: "lightbox-nav lightbox-next",
    onClick: () => onNav(1),
    "aria-label": "siguiente"
  }, "\u203A")), /*#__PURE__*/React.createElement("div", {
    className: "lightbox-meta"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "numeral tabular",
    style: {
      fontSize: '0.95rem',
      color: 'var(--gold-2)'
    }
  }, "N\xBA ", pad(index + 1), " / ", pad(items.length)), /*#__PURE__*/React.createElement("div", {
    className: "caps",
    style: {
      marginTop: '0.35rem',
      color: 'rgba(245,237,224,0.7)'
    }
  }, cat)), /*#__PURE__*/React.createElement("div", {
    className: "display-italic",
    style: {
      fontSize: 'clamp(0.85rem, 2.5vw, 1.5rem)',
      color: 'rgba(245,237,224,0.9)',
      textAlign: 'right',
      maxWidth: '50%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, cur.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))));
}

/* ════════════════════════════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════════════════════════ */
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    className: "border-t border-line mt-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-[1600px] mx-auto px-6 lg:px-12 py-10 flex flex-wrap items-center justify-between gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, T.brand, " \xB7 ", romanYear(new Date().getFullYear())), /*#__PURE__*/React.createElement("div", {
    className: "display-italic text-ink-soft text-xl"
  }, "una colecci\xF3n personal."), /*#__PURE__*/React.createElement("div", {
    className: "eyebrow tabular"
  }, todayLabel())));
}

/* ════════════════════════════════════════════════════════════════
   PetalCanvas — canvas lluvia de pétalos (shared)
   ═══════════════════════════════════════════════════════════════ */
function PetalCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;
    const COLORS = ['#c4536a', '#e8899a', '#f2c4cc', '#a03050', '#d4607a', '#b84060', '#f0a8b4', '#fad0d8', '#de8095', '#7b1d30'];
    let W,
      H,
      petals = [];
    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);
    function mk() {
      return {
        x: Math.random() * W * 1.2 - W * 0.1,
        y: -20 - Math.random() * 60,
        size: 5 + Math.random() * 11,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        vy: 0.6 + Math.random() * 1.1,
        vx: -0.3 + Math.random() * 0.6,
        rot: Math.random() * Math.PI * 2,
        drot: -0.013 + Math.random() * 0.026,
        sw: Math.random() * Math.PI * 2,
        dsw: 0.008 + Math.random() * 0.01,
        amp: 0.3 + Math.random() * 0.7,
        alpha: 0.38 + Math.random() * 0.5,
        sy: 0.45 + Math.random() * 0.5
      };
    }
    for (let i = 0; i < 50; i++) {
      const p = mk();
      p.y = Math.random() * H;
      petals.push(p);
    }
    function draw(p) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, p.sy);
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * .8, -s * .4, s * .9, s * .5, 0, s);
      ctx.bezierCurveTo(-s * .9, s * .5, -s * .8, -s * .4, 0, -s);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s * .8);
      ctx.quadraticCurveTo(s * .08, 0, 0, s * .8);
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = .4;
      ctx.stroke();
      ctx.restore();
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      if (petals.length < 65 && Math.random() < .3) petals.push(mk());
      for (let i = petals.length - 1; i >= 0; i--) {
        const p = petals[i];
        p.sw += p.dsw;
        p.x += p.vx + Math.sin(p.sw) * p.amp;
        p.y += p.vy;
        p.rot += p.drot;
        draw(p);
        if (p.y > H + 30 || p.x < -60 || p.x > W + 60) petals.splice(i, 1);
      }
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: ref,
    style: {
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 61
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   Promesa scene
   ═══════════════════════════════════════════════════════════════ */
function Promesa({
  onCierre,
  onBack
}) {
  const [promised, setPromised] = useState(false);
  const btnRef = useRef(null);
  function spawnHearts(cx, cy) {
    const emojis = ['❤', '🩷', '💗', '💖', '💕'];
    for (let i = 0; i < 13; i++) {
      const el = document.createElement('div');
      el.className = 'heart-float';
      const dx = -80 + Math.random() * 160;
      const dy = -100 + Math.random() * 60;
      el.textContent = emojis[i % emojis.length];
      el.style.cssText = `left:${cx + dx}px;top:${cy + dy}px;font-size:${0.85 + Math.random() * 0.9}rem;animation-delay:${i * 0.045}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1500 + i * 50);
    }
  }
  function handlePromise() {
    const btn = btnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      spawnHearts(r.left + r.width / 2, r.top + r.height / 2);
    }
    setPromised(true);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "scene-dark"
  }, /*#__PURE__*/React.createElement(PetalCanvas, null), /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    className: "dark-nav-btn",
    style: {
      position: 'fixed',
      top: '1.4rem',
      left: 'clamp(1.25rem,5vw,3rem)',
      zIndex: 70
    }
  }, "\u2190 volver"), /*#__PURE__*/React.createElement("div", {
    className: "scene-dark-content"
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      minHeight: '70vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '6rem 1.5rem 3rem'
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "dark-eyebrow",
    style: {
      marginBottom: '2rem',
      animation: 'rise .9s .1s both'
    }
  }, "una promesa \xB7 para siempre"), /*#__PURE__*/React.createElement("h1", {
    className: "display",
    style: {
      fontSize: 'clamp(3.2rem,13vw,9rem)',
      color: '#f5ede0',
      lineHeight: '.93',
      textShadow: '0 0 60px rgba(196,83,106,.2)',
      animation: 'rise 1s .25s both'
    }
  }, "la"), /*#__PURE__*/React.createElement("h1", {
    className: "display-italic",
    style: {
      fontSize: 'clamp(3rem,12vw,8.5rem)',
      color: '#e8899a',
      marginTop: '-0.06em',
      lineHeight: '.93',
      textShadow: '0 0 60px rgba(196,83,106,.25)',
      animation: 'rise 1s .4s both'
    }
  }, "promesa"), /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      width: 120,
      margin: '2rem auto',
      animation: 'fade .8s .7s both'
    }
  }), /*#__PURE__*/React.createElement("p", {
    className: "display-italic",
    style: {
      fontSize: 'clamp(1rem,2.8vw,1.5rem)',
      color: 'rgba(242,196,204,.75)',
      maxWidth: 440,
      lineHeight: 1.65,
      animation: 'rise .9s .85s both'
    }
  }, "\xABalgunas cosas no necesitan firma,", /*#__PURE__*/React.createElement("br", null), "solo dos me\xF1iques entrelazados.\xBB")), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '2rem 1.5rem 4rem',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'clamp(2rem,6vw,5rem)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "polaroid-dark"
  }, /*#__PURE__*/React.createElement("img", {
    src: "media/pinki_promise.jpeg",
    alt: "La promesa"
  }), /*#__PURE__*/React.createElement("p", {
    className: "polaroid-dark-cap"
  }, "\xABno te voy a dejar, amorcito.\xBB")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 400,
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "dark-eyebrow",
    style: {
      marginBottom: '1.2rem'
    }
  }, "lo que dijiste \xB7 lo que prometiste"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: '"Instrument Serif",Georgia,serif',
      fontStyle: 'italic',
      fontSize: 'clamp(1.3rem,3.5vw,1.85rem)',
      lineHeight: 1.65,
      color: '#f2c4cc'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      marginBottom: '.8rem'
    }
  }, "\"No te voy a dejar amorcito.\""), /*#__PURE__*/React.createElement("p", {
    style: {
      color: '#e8899a'
    }
  }, "Hicimos ", /*#__PURE__*/React.createElement("em", null, "pinki promesa"), ".")), /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      margin: '1.5rem 0',
      maxWidth: 160
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: '"Instrument Serif",Georgia,serif',
      fontStyle: 'italic',
      fontSize: '1rem',
      color: 'rgba(245,237,224,.5)',
      lineHeight: 1.8
    }
  }, "Las palabras que se dicen a las 8:30 de la noche, cuando la verdad pesa m\xE1s que cualquier otra cosa, son las que m\xE1s importan."))), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 1.5rem 5rem',
      display: 'flex',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "promise-box",
    style: {
      maxWidth: 640,
      width: '100%',
      padding: 'clamp(2rem,5vw,3.5rem)',
      textAlign: 'center',
      borderRadius: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "corner-dec tl"
  }), /*#__PURE__*/React.createElement("div", {
    className: "corner-dec tr"
  }), /*#__PURE__*/React.createElement("div", {
    className: "corner-dec bl"
  }), /*#__PURE__*/React.createElement("div", {
    className: "corner-dec br"
  }), /*#__PURE__*/React.createElement("p", {
    className: "dark-eyebrow",
    style: {
      marginBottom: '1.5rem',
      position: 'relative'
    }
  }, "algo que nunca debes olvidar"), /*#__PURE__*/React.createElement("p", {
    className: "display-italic",
    style: {
      fontSize: 'clamp(1.3rem,3.8vw,2rem)',
      color: '#f5ede0',
      lineHeight: 1.72,
      position: 'relative'
    }
  }, "Y aunque el tiempo pase y el mundo cambie, hay algo que llevamos grabado en el alma:", ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#e8899a'
    }
  }, "prometimos no dejarnos.")), /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      margin: '1.8rem auto',
      width: 100,
      position: 'relative'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: '"Instrument Serif",Georgia,serif',
      fontStyle: 'italic',
      fontSize: 'clamp(.95rem,2.6vw,1.2rem)',
      color: 'rgba(242,196,204,.72)',
      lineHeight: 1.85,
      maxWidth: 460,
      margin: '0 auto',
      position: 'relative'
    }
  }, "Ahora que las cosas han cambiado entre nosotros y decidiste ponerle fin a nuestra historia, prometo seguir am\xE1ndote el resto de mi vida, prometo jam\xE1s olvidarte y si en alg\xFAn momento decides volver, aqu\xED estar\xE9 esper\xE1ndote."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '2.2rem',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1rem'
    }
  }, /*#__PURE__*/React.createElement("button", {
    ref: btnRef,
    onClick: handlePromise,
    className: "btn-promise"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '1rem'
    }
  }, "\uD83E\uDD19"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      zIndex: 1
    }
  }, promised ? '· promesa renovada ·' : '· renovar la promesa ·')), promised && /*#__PURE__*/React.createElement("p", {
    className: "display-italic",
    style: {
      color: 'rgba(201,168,76,.85)',
      fontSize: '1rem',
      animation: 'fade .6s both'
    }
  }, "\u2764 prometemos no olvidarnos \u2764")))), /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 1.5rem 4rem',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: 'clamp(1.5rem,4vw,3.5rem)'
    }
  }, [{
    src: 'media/amy/IMG_0529_2.PNG',
    cap: 'un momento nuestro.',
    rot: '-2.5deg'
  }, {
    src: 'media/amy/IMG002.jpeg',
    cap: 'guardado en el alma.',
    rot: '2deg'
  }].map(({
    src,
    cap,
    rot
  }) => /*#__PURE__*/React.createElement("div", {
    key: src,
    className: "polaroid-dark",
    style: {
      transform: `rotate(${rot})`,
      maxWidth: 240
    },
    onMouseEnter: e => e.currentTarget.style.transform = 'rotate(0deg) scale(1.03)',
    onMouseLeave: e => e.currentTarget.style.transform = `rotate(${rot})`
  }, /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "",
    style: {
      objectFit: 'cover',
      aspectRatio: '3/4'
    }
  }), /*#__PURE__*/React.createElement("p", {
    className: "polaroid-dark-cap"
  }, cap)))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      paddingBottom: '5rem'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      width: 60,
      margin: '0 auto 2.5rem'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onCierre,
    className: "btn-promise",
    style: {
      gap: '.75rem'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      zIndex: 1
    }
  }, "continuar"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '1rem',
      position: 'relative',
      zIndex: 1
    }
  }, "\u2192")))));
}

/* ════════════════════════════════════════════════════════════════
   Cierre scene — pantalla final
   ═══════════════════════════════════════════════════════════════ */
function Cierre({
  onBack
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "scene-dark",
    style: {
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(PetalCanvas, null), /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    className: "dark-nav-btn",
    style: {
      position: 'fixed',
      top: '1.4rem',
      left: 'clamp(1.25rem,5vw,3rem)',
      zIndex: 70
    }
  }, "\u2190 volver"), /*#__PURE__*/React.createElement("div", {
    className: "scene-dark-content",
    style: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '5rem 1.5rem'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '3rem',
      animation: 'fade 1.2s .2s both'
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "dark-eyebrow",
    style: {
      marginBottom: '.9rem'
    }
  }, "fin \xB7 y comienzo"), /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      width: 80,
      margin: '0 auto'
    }
  })), /*#__PURE__*/React.createElement("h1", {
    className: "display-italic cierre-glow",
    style: {
      fontSize: 'clamp(2rem,6.5vw,5rem)',
      color: '#f5ede0',
      lineHeight: 1.25,
      maxWidth: 720,
      letterSpacing: '-.01em'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cierre-line",
    style: {
      animationDelay: '.3s',
      display: 'block'
    }
  }, "\xABGracias por todos"), /*#__PURE__*/React.createElement("span", {
    className: "cierre-line",
    style: {
      animationDelay: '.7s',
      display: 'block',
      color: '#e8899a'
    }
  }, "estos momentos"), /*#__PURE__*/React.createElement("span", {
    className: "cierre-line",
    style: {
      animationDelay: '1.1s',
      display: 'block'
    }
  }, "que pas\xE9 junto a t\xED.\xBB")), /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      width: 120,
      margin: '3rem auto',
      animation: 'fade 1s 1.8s both'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: '"Instrument Serif",Georgia,serif',
      fontStyle: 'italic',
      fontSize: 'clamp(1rem,2.8vw,1.45rem)',
      color: 'rgba(242,196,204,.6)',
      maxWidth: 480,
      lineHeight: 1.8,
      animation: 'rise 1s 2s both'
    }
  }, "Cada fotograf\xEDa guarda un pedazo de lo que somos \u2014 de lo que construimos juntos, sin prisa, con amor."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '3.5rem',
      animation: 'fade 1s 2.6s both'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dark-rule",
    style: {
      width: 48,
      margin: '0 auto 1.4rem'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: '"Fraunces",Georgia,serif',
      fontVariationSettings: '"SOFT" 80',
      fontSize: '.68rem',
      letterSpacing: '.28em',
      textTransform: 'lowercase',
      color: 'rgba(201,168,76,.55)'
    }
  }, "amy \xB7 MMXXV")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '2.5rem',
      animation: 'fade 1s 3s both'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '2rem',
      display: 'inline-block',
      animation: 'pulse 2.4s ease-in-out infinite'
    }
  }, "\u2764"))));
}

/* ──────────────── mount ──────────────── */
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
