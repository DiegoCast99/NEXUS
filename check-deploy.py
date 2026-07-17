#!/usr/bin/env python3
"""
Chequeo pre-deploy de cache-busting (sin dependencias).

    ./check-deploy.py

El problema que evita
---------------------
El Service Worker cachea los estaticos por URL COMPLETA (incluido el ?v=).
Si editas un archivo pero no le cambias el ?v=, el navegador sigue sirviendo
la version vieja aunque el servidor tenga la nueva. El deploy "funciona" pero
el usuario no ve el cambio, y el sintoma no apunta al cache.

La regla
--------
    Si el contenido cambio respecto de lo publicado
    y el ?v= es el mismo  ->  ERROR: hay que bumpear la version.

Compara cada asset versionado del HTML local contra el sitio publicado.
"""
import re
import sys
import urllib.request
import urllib.error

SITE = "https://warm-cocada-f0f020.netlify.app"
PAGES = ["dashboard.html", "index.html"]
ASSET_RE = re.compile(r'(?:href|src)="\./([^"?]+)\?v=([^"]*)"')

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def fetch(url):
    """Devuelve (contenido, None) o (None, motivo)."""
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.read(), None
    except urllib.error.HTTPError as e:
        return None, "HTTP %s" % e.code
    except Exception as e:
        return None, str(e)[:60]


def read_local(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def main():
    stale, nuevos, bumpeados, sin_cambios, avisos = [], [], [], [], []

    for page in PAGES:
        local_html = read_local(page)
        if local_html is None:
            continue
        remote_html, err = fetch("%s/%s" % (SITE, page))
        if remote_html is None:
            avisos.append("no se pudo bajar %s del sitio (%s)" % (page, err))
            continue

        # Version que pide cada HTML: la local (la que vas a subir) y la publicada.
        local_vers = dict(ASSET_RE.findall(local_html.decode("utf-8", "replace")))
        remote_vers = dict(ASSET_RE.findall(remote_html.decode("utf-8", "replace")))

        for asset, lver in local_vers.items():
            local_bytes = read_local(asset)
            if local_bytes is None:
                avisos.append("%s referenciado en %s pero no existe local" % (asset, page))
                continue

            rver = remote_vers.get(asset)
            remote_bytes, err = fetch("%s/%s" % (SITE, asset))

            if remote_bytes is None:
                nuevos.append((asset, lver))          # todavia no publicado
                continue
            if local_bytes == remote_bytes:
                sin_cambios.append(asset)             # nada que bumpear
                continue
            # El contenido cambio: la version TIENE que ser distinta.
            if rver is not None and lver == rver:
                stale.append((asset, lver))
            else:
                bumpeados.append((asset, rver, lver))

    print("\nChequeo de cache — %s\n" % SITE.replace("https://", ""))
    for a in sorted(set(sin_cambios)):
        print("  %sOK%s     %-42s %ssin cambios%s" % (GREEN, RESET, a, DIM, RESET))
    for a, rv, lv in bumpeados:
        print("  %sOK%s     %-42s cambio, version bumpeada (%s -> %s)" % (GREEN, RESET, a, rv, lv))
    for a, v in nuevos:
        print("  %sNUEVO%s  %-42s aun no publicado (?v=%s)" % (YELLOW, RESET, a, v))
    for a, v in stale:
        print("  %sSTALE%s  %-42s CAMBIO pero sigue en ?v=%s" % (RED, RESET, a, v))
    for w in avisos:
        print("  %s!%s      %s" % (YELLOW, RESET, w))

    print()
    if stale:
        print("%sNO DEPLOYES.%s %d archivo(s) cambiaron sin bumpear su ?v=." % (RED, RESET, len(stale)))
        print("Tus usuarios verian la version vieja cacheada. Bumpea en el HTML:\n")
        for a, v in stale:
            print("    %s?v=%s   ->   subile la version" % (a.split("/")[-1], v))
        print()
        return 1

    print("%sTodo bien.%s Podes deployar." % (GREEN, RESET))
    return 0


if __name__ == "__main__":
    sys.exit(main())
