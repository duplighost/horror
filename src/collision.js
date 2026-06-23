// Cheap broadphase collision in the XZ plane. The player is a circle; the world
// is made of circles (trees, columns) and axis-aligned boxes (walls). A uniform
// grid keeps it fast even with a thousand trees, and "push-out" resolution gives
// natural wall-sliding.

export class ColliderField {
  constructor(cell = 4) {
    this.cell = cell;
    this.grid = new Map();
    this.circles = [];
    this.boxes = [];
    this.dynamic = [];   // toggleable boxes (doors); few, iterated directly
  }
  // returns a handle; set handle.active=false to disable (door opens)
  addDynamicBox(minx, minz, maxx, maxz, tag = 0) {
    const h = { minx, minz, maxx, maxz, tag, active: true };
    this.dynamic.push(h); return h;
  }
  _key(cx, cz) { return cx + ',' + cz; }
  _insert(idxType, idx, minx, minz, maxx, maxz) {
    const c = this.cell;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c);
    const z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, z);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push((idxType << 24) | idx);
    }
  }
  addCircle(x, z, r, tag = 0) {
    const idx = this.circles.length;
    this.circles.push({ x, z, r, tag });
    this._insert(0, idx, x - r, z - r, x + r, z + r);
  }
  addBox(minx, minz, maxx, maxz, tag = 0) {
    const idx = this.boxes.length;
    this.boxes.push({ minx, minz, maxx, maxz, tag });
    this._insert(1, idx, minx, minz, maxx, maxz);
  }
  // gather candidate collider ids near a point
  _near(x, z, r) {
    const c = this.cell, out = new Set();
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const arr = this.grid.get(this._key(gx, gz));
      if (arr) for (const v of arr) out.add(v);
    }
    return out;
  }
  // resolve a circle (px,pz,r) out of all overlapping colliders. Returns moved
  // position plus whether anything was hit (for footstep/thud feedback).
  resolve(px, pz, r) {
    let hit = false, tag = 0;
    for (let iter = 0; iter < 3; iter++) {
      const cands = this._near(px, pz, r + 0.5);
      let moved = false;
      // active dynamic boxes (doors) resolved every iteration
      for (const b of this.dynamic) {
        if (!b.active) continue;
        const cx = Math.max(b.minx, Math.min(px, b.maxx));
        const cz = Math.max(b.minz, Math.min(pz, b.maxz));
        const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz);
        if (d < r && d > 0.00001) { const push = r - d; px += (dx / d) * push; pz += (dz / d) * push; moved = true; hit = true; tag = b.tag; }
        else if (d <= 0.00001) {   // centre inside the box (e.g. a wall sealing onto you): push out the short axis
          const left = px - b.minx, right = b.maxx - px, up = pz - b.minz, down = b.maxz - pz;
          const m = Math.min(left, right, up, down);
          if (m === left) px = b.minx - r; else if (m === right) px = b.maxx + r;
          else if (m === up) pz = b.minz - r; else pz = b.maxz + r;
          moved = true; hit = true; tag = b.tag;
        }
      }
      for (const v of cands) {
        const type = v >>> 24, idx = v & 0xFFFFFF;
        if (type === 0) {
          const cc = this.circles[idx];
          const dx = px - cc.x, dz = pz - cc.z;
          const d = Math.hypot(dx, dz), min = r + cc.r;
          if (d < min && d > 0.00001) {
            const push = (min - d);
            px += (dx / d) * push; pz += (dz / d) * push;
            moved = true; hit = true; tag = cc.tag;
          } else if (d <= 0.00001) { px += min; moved = true; hit = true; }
        } else {
          const b = this.boxes[idx];
          const cx = Math.max(b.minx, Math.min(px, b.maxx));
          const cz = Math.max(b.minz, Math.min(pz, b.maxz));
          const dx = px - cx, dz = pz - cz;
          const d = Math.hypot(dx, dz);
          if (d < r && d > 0.00001) {
            const push = (r - d);
            px += (dx / d) * push; pz += (dz / d) * push;
            moved = true; hit = true; tag = b.tag;
          } else if (d <= 0.00001) {
            // center inside box: push out along the smallest axis
            const left = px - b.minx, right = b.maxx - px;
            const up = pz - b.minz, down = b.maxz - pz;
            const m = Math.min(left, right, up, down);
            if (m === left) px = b.minx - r; else if (m === right) px = b.maxx + r;
            else if (m === up) pz = b.minz - r; else pz = b.maxz + r;
            moved = true; hit = true; tag = b.tag;
          }
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz, hit, tag };
  }
  // is the straight segment from (x0,z0) to (x1,z1) clear of boxes? (sight/AI)
  segmentClear(x0, z0, x1, z1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (this.cell * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const cands = this._near(x, z, 0.1);
      for (const v of cands) {
        if ((v >>> 24) === 1) {
          const b = this.boxes[v & 0xFFFFFF];
          if (x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz) return false;
        }
      }
    }
    return true;
  }
}
