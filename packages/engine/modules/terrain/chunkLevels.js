// Chunk loading detail: forcing one chunk ready now and choosing per-species detail level by ring (mixed into ChunkManager.prototype).
// Split out of ChunkManager.js; the methods use the manager state (chunks, ready, edits, T, density) through this.

/** Stand-in for engine.vegetation when the vegetation module is not installed */
export const NO_VEG = { baseNames: () => [], nearNames: () => [], list: () => [], get: () => null };

export const chunkLevels = {
  _forceReady(c) {
    if (c.state === 'ready') return true;
    const i = this.ready.findIndex(r => r.terrain && r.cx === c.cx && r.cz === c.cz && r.gen === c.gen && r.ev === this.edits.version(c.key));
    let r = i >= 0 ? this.ready.splice(i, 1)[0] : null;
    if (!r) {
      const veg = this.engine.vegetation || NO_VEG;
      r = { terrain: this.T.buildChunk(c.cx, c.cz), veg: {} };
      for (const name of veg.baseNames()) r.veg[name] = this.T.place(c.cx, c.cz, veg.get(name).rule, this.density);
    }
    this._applyTerrain(c, r.terrain);
    for (const name in r.veg) this._applyVeg(c, name, r.veg[name]);
    c.level = -1;
    return true;
  },

  _setLevel(c, ring) {
    if (c.level === ring) return;
    c.level = ring;
    const veg = this.engine.vegetation || NO_VEG;
    for (const sp of veg.list()) {
      const im = c.veg[sp.name];
      if (sp.nearOnly) {
        // detailDone: this species was already placed here and came back empty; without it the empty result would reset the level and re-ask forever
        if (ring <= sp.maxRing && !im && !c.pendingDetail && !c.detailDone.has(sp.name)) {
          c.pendingDetail = true;
          this._send(this._job(c, false, veg.nearNames()));
        } else if (ring > sp.maxRing + 1 && im) { veg.unmount(c, sp.name); c.detailDone.delete(sp.name); }
        continue;
      }
      if (im) veg.levelOf(im, sp, ring);
    }
  },
};
