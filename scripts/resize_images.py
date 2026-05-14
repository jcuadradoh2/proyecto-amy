from PIL import Image
import os, glob

MAX_PX = 1440
QUALITY = 83
folder = r"C:\Users\37800395\Documents\Proyecto IP\proyecto-amy\media\amy"

patterns = ["*.jpg","*.JPG","*.jpeg","*.JPEG","*.png","*.PNG"]
files = []
for p in patterns:
    for f in glob.glob(os.path.join(folder, p)):
        if f not in files:
            files.append(f)

print(f"Imágenes encontradas: {len(files)}")
resized = skipped = errors = 0

for path in files:
    try:
        img = Image.open(path)
        w, h = img.size
        if max(w, h) <= MAX_PX:
            skipped += 1
            continue
        ratio = MAX_PX / max(w, h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.convert("RGB")
        img = img.resize(new_size, Image.LANCZOS)
        img.save(path, "JPEG", quality=QUALITY, optimize=True)
        new_kb = os.path.getsize(path) / 1024
        print(f"  {os.path.basename(path)}: {w}x{h} → {new_size[0]}x{new_size[1]}  ({new_kb:.0f} KB)")
        resized += 1
    except Exception as e:
        print(f"  ERROR {os.path.basename(path)}: {e}")
        errors += 1

print(f"\nRedimensionadas: {resized}  |  Ya eran pequeñas: {skipped}  |  Errores: {errors}")
