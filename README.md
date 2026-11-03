# ASCII Stories

Arte ASCII a color y pixel art animado para historias, con audio propio.
Todo se procesa en el navegador: sin servidor, sin cuentas.

- Especificación y hoja de ruta: `docs/spec.md`

## Usar en el ordenador

```
npm install
npm run dev        # http://localhost:5173
```

Mejor en Chrome o Brave (WebCodecs para exportar MP4).

## Publicarlo para usarlo desde el móvil

La app es 100 % estática: `npm run build` genera `dist/`, que se puede subir a cualquier hosting
estático. Requiere **HTTPS** (sin él el navegador desactiva WebCodecs y el modo sin conexión).

**GitHub Pages** (incluido el flujo `.github/workflows/deploy.yml`):
1. Crea un repositorio en GitHub y sube este proyecto (`git remote add origin …` y `git push -u origin main`).
2. En el repositorio: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
3. En cada `git push` a `main` se compila y publica en `https://<usuario>.github.io/<repositorio>/`.

**Netlify / Cloudflare Pages**: ejecuta `npm run build` y arrastra la carpeta `dist/` (Netlify Drop), o conecta el repositorio
con comando de build `npm run build` y carpeta de salida `dist`.

En el iPhone: abre la dirección en Safari → Compartir → *Añadir a pantalla de inicio*. Se instala como app y,
tras la primera visita, funciona sin conexión.

## Notas para el móvil
- GIF animado: Chrome/Brave usan `ImageDecoder`; Safari usa un decodificador en JavaScript (`gifuct-js`).
- Exportar MP4 necesita WebCodecs (`VideoEncoder`/`AudioEncoder`); si el navegador no los tiene, exporta GIF o PNG.
- Tras exportar, el botón «Compartir / Guardar» abre la hoja de compartir del móvil (Fotos, Instagram…).
