import { Attachment } from './core';

export interface Crop { x: number; y: number; width: number; height: number }
export function chooseRegion(): Promise<Crop | null> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.dataset.paperchat = 'crop';
    Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483647', cursor: 'crosshair', background: '#17382922' });
    const hint = document.createElement('div'); hint.textContent = 'Drag around a figure or table · Escape to cancel';
    Object.assign(hint.style, { position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', padding: '9px 15px', borderRadius: '9px', background: '#125a50', color: 'white', font: '14px -apple-system,sans-serif', pointerEvents: 'none' });
    const box = document.createElement('div'); Object.assign(box.style, { position: 'fixed', border: '2px solid #087768', background: '#ffffff11', pointerEvents: 'none' });
    overlay.append(hint, box); document.documentElement.append(overlay);
    let start: { x: number; y: number } | null = null;
    const cleanup = (value: Crop | null) => { document.removeEventListener('keydown', escape, true); overlay.remove(); resolve(value); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cleanup(null); } };
    document.addEventListener('keydown', escape, true);
    overlay.onpointerdown = event => { if (event.button !== 0) return; start = { x: event.clientX, y: event.clientY }; overlay.setPointerCapture(event.pointerId); event.preventDefault(); };
    overlay.onpointermove = event => {
      if (!start) return;
      Object.assign(box.style, { left: Math.min(start.x, event.clientX) + 'px', top: Math.min(start.y, event.clientY) + 'px', width: Math.abs(event.clientX - start.x) + 'px', height: Math.abs(event.clientY - start.y) + 'px' });
    };
    overlay.onpointerup = event => {
      if (!start) return;
      const value = { x: Math.max(0, Math.min(start.x, event.clientX)), y: Math.max(0, Math.min(start.y, event.clientY)), width: Math.abs(start.x - event.clientX), height: Math.abs(start.y - event.clientY) };
      cleanup(value.width >= 12 && value.height >= 12 ? value : null);
    };
  });
}
export async function cropImage(dataURL: string, rect: Crop, viewportWidth: number, label: string): Promise<Attachment> {
  const image = new Image(); image.src = dataURL; await image.decode();
  const scale = image.naturalWidth / viewportWidth;
  const width = Math.min(rect.width * scale, image.naturalWidth - rect.x * scale), height = Math.min(rect.height * scale, image.naturalHeight - rect.y * scale);
  if (width <= 0 || height <= 0) throw new Error('The figure region is outside the visible page.');
  const factor = Math.min(1, 1800 / Math.max(width, height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width * factor); canvas.height = Math.round(height * factor);
  canvas.getContext('2d')!.drawImage(image, rect.x * scale, rect.y * scale, width, height, 0, 0, canvas.width, canvas.height);
  return { dataURL: canvas.toDataURL('image/jpeg', 0.9), label };
}
