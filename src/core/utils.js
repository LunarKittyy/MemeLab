// Small stateless math helpers used across rendering and interaction code.

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function deg2rad(d) {
  return (d * Math.PI) / 180;
}

export function rad2deg(r) {
  return (r * 180) / Math.PI;
}

export function rotVec(x, y, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}
