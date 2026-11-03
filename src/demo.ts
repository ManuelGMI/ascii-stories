// Imagen de prueba generada por código (formas limpias con sombreado plano,
// el tipo de imagen donde mejor luce el efecto) para usar sin cargar nada.
export function makeDemoImage(): HTMLCanvasElement {
  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1b1f5e');
  sky.addColorStop(0.45, '#c2417a');
  sky.addColorStop(0.7, '#ffb36b');
  sky.addColorStop(1, '#1a0f2e');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  const sun = g.createRadialGradient(540, 980, 20, 540, 980, 330);
  sun.addColorStop(0, '#fff6c9');
  sun.addColorStop(0.6, '#ffd36b');
  sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun;
  g.beginPath();
  g.arc(540, 980, 330, 0, Math.PI * 2);
  g.fill();

  const tri = (pts: [number, number][], color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(...pts[0]);
    pts.slice(1).forEach((p) => g.lineTo(...p));
    g.closePath();
    g.fill();
  };
  // Montañas low-poly (caras claras/oscuras)
  tri([[-50, 1500], [260, 1000], [520, 1500]], '#3a2a6b');
  tri([[260, 1000], [520, 1500], [330, 1500]], '#2b1e52');
  tri([[380, 1500], [760, 880], [1150, 1500]], '#4c3585');
  tri([[760, 880], [1150, 1500], [900, 1500]], '#33245f');
  tri([[760, 880], [650, 1500], [900, 1500]], '#5f45a3');
  tri([[-50, 1920], [0, 1560], [1130, 1620], [1130, 1920]], '#120a24');
  tri([[0, 1700], [540, 1560], [1130, 1740], [1130, 1920], [0, 1920]], '#0b0618');

  // Planeta con anillo
  g.fillStyle = '#7ad7ff';
  g.beginPath();
  g.arc(220, 330, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2d86b8';
  g.beginPath();
  g.arc(220, 330, 120, -Math.PI / 2, Math.PI / 2);
  g.fill();
  g.strokeStyle = '#ffe1f0';
  g.lineWidth = 14;
  g.beginPath();
  g.ellipse(220, 330, 200, 48, -0.35, 0, Math.PI * 2);
  g.stroke();

  // Estrellas
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 70; i++) {
    const x = (i * 337) % W, y = (i * 211) % 700;
    g.fillRect(x, y, 5, 5);
  }
  return c;
}
