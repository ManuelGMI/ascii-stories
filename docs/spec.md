# ASCII Stories — Especificación

> Nombre provisional. Web app personal, para usar en el Mac (navegador), que convierte
> fotos, GIFs y vídeos en arte ASCII a color o pixel art de alta calidad, con texto
> limpio encima y audio propio. Pensada para historias de Instagram (9:16).

## Objetivo

- **La estrella:** el estilizado ASCII / pixel art de altísimo nivel, también a color y animado.
- **Lo segundo:** poder usar cualquier canción o audio propio (los que no están en Instagram).
- Uso personal: sin cuentas, sin servidor, sin pagos. Todo se procesa en el propio navegador.

## Referencia visual

Captura de un post de Reddit (r/TopologyAI): escena 3D low-poly con un shader ASCII aplicado.
Rasgos del efecto:

- Cuadrícula de caracteres (`o s = # - / \ |`…), cada uno con el color de su celda.
- Carácter elegido por **luminosidad** (zonas claras → caracteres densos).
- **Bordes direccionales**: en contornos se usan `/ \ | _` según la inclinación del borde.
  Es lo que da el aspecto de "altísimo nivel".
- Scanlines horizontales sutiles.

Nota: el efecto luce más con imágenes de formas limpias y sombreado plano (como el low-poly).
Idea futura: un modo de escena 3D low-poly propia.

## Entradas

| Tipo | Formatos | Notas |
|---|---|---|
| Imagen | PNG, JPG, WEBP | Se puede animar (ver "Animaciones") |
| GIF | GIF animado | Se procesa fotograma a fotograma |
| Vídeo | MP4, MOV, WEBM | Extracción a **30 o 60 fps** (elegible) |
| Audio | MP3, M4A, WAV | Recorte del fragmento exacto + volumen |

## Estilos

1. **ASCII a color** — el de la referencia. Prioridad máxima.
2. **ASCII monocromo** — un color sobre fondo oscuro (verde terminal, ámbar, blanco "noir").
3. **Pixel art** — píxeles grandes con paleta limitada (Game Boy, NES, PICO-8, personalizada).
4. **Dithering** — tramado ordenado (Bayer) o difusión de error.

Controles por estilo: tamaño de celda, juego de caracteres, intensidad y umbral de bordes,
brillo / contraste / saturación, paleta, scanlines, brillo tipo CRT (bloom), color de fondo.

## Animaciones (para imágenes fijas)

- **Revelado:** aparición carácter a carácter o por barrido.
- **Parpadeo:** caracteres que cambian sutilmente, pantalla "viva".
- **Lluvia** estilo Matrix que forma la imagen.
- **Scanlines en movimiento** y destellos CRT.
- **Pulso al ritmo de la música:** brillo / tamaño reaccionan al audio.

## Calidad en vídeo

- Extracción fotograma a fotograma exacta a **30 o 60 fps** (no captura en tiempo real).
- Bordes estables entre fotogramas (suavizado temporal) para que los caracteres no tiemblen.
- Vista previa en tiempo real con la tarjeta gráfica mientras se ajusta.
- Exportación a resolución completa 1080×1920.

## Texto

- Capas de texto **limpio** por encima del ASCII (no se convierte).
- Tipografía, tamaño, color, fondo, posición, animación de entrada.
- Tiempo de aparición y desaparición (p. ej. sincronizado con la canción).

## Exportación

| Formato | Uso | Detalle |
|---|---|---|
| MP4 (H.264 + AAC) | Instagram | 1080×1920, 30 o 60 fps, con audio |
| GIF | Compartir en otros sitios | Sin audio, 256 colores por fotograma (paleta optimizada + dithering) |

Notas:
- Instagram reproduce las historias a 30 fps; el MP4 a 60 fps se verá más fluido en el Mac
  y en otras plataformas, pero Instagram puede convertirlo. Conviene probar ambos.
- Instagram puede silenciar audio con derechos de autor al publicar; no depende de la app.
- El ASCII monocromo es el que mejor queda en GIF.

## Tecnología prevista

- **Render:** WebGL2 con shaders (luminancia, detección de bordes Sobel / DoG, atlas de caracteres).
- **Vídeo:** WebCodecs (`VideoDecoder` / `VideoEncoder`) para decodificar y codificar fotograma a
  fotograma, y un muxer MP4 en el navegador.
- **GIF:** codificador GIF en JavaScript con cuantización de paleta.
- **Audio:** Web Audio API (recorte, volumen, análisis de ritmo para el "pulso").
- **Proyecto:** Vite + TypeScript. Navegador recomendado: Chrome (mejor soporte de WebCodecs).

## Hoja de ruta

1. Motor ASCII a color sobre imagen, con todos los controles.
2. Aplicarlo a vídeo y GIF (30 / 60 fps) con vista previa en vivo.
3. Animaciones para imagen fija (revelado, parpadeo, scanlines).
4. Capas de texto limpio + audio propio con recorte.
5. Exportación MP4 y GIF.
6. Estilos pixel art y dithering.
7. Pulso al ritmo de la música.

## Fuera de alcance (por ahora)

Cuentas de usuario, servidor, publicación directa en Instagram, versión móvil.
