// Resizing the drawing buffer clears it immediately. Paint before the next browser frame.
export function observeCanvasSize(canvas, context, paint) {
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const pixelsWide = Math.max(1, Math.round(width * scale));
    const pixelsHigh = Math.max(1, Math.round(height * scale));
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    context?.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0);
    paint(width, height);
  });
  observer.observe(canvas);
}
