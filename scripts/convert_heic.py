import os
import glob
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

folder = r"C:\Users\37800395\Documents\Proyecto IP\proyecto-amy\media\amy"
patterns = [os.path.join(folder, "*.heic"), os.path.join(folder, "*.HEIC")]

files = []
for p in patterns:
    files.extend(glob.glob(p))

print(f"Encontrados: {len(files)} archivos HEIC")

converted = 0
errors = 0
for path in files:
    try:
        out = os.path.splitext(path)[0] + ".jpg"
        if os.path.exists(out):
            print(f"  YA EXISTE: {os.path.basename(out)}")
            continue
        img = Image.open(path)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        img.save(out, "JPEG", quality=88, optimize=True)
        converted += 1
        print(f"  OK: {os.path.basename(path)} -> {os.path.basename(out)}")
    except Exception as e:
        errors += 1
        print(f"  ERROR: {os.path.basename(path)} -- {e}")

print(f"\nResultado: {converted} convertidos, {errors} errores")