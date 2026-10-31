// Who acts for the local user (part of Engine, mixed into Engine.prototype). engine.actor is a world record id, default 'player'.
// Modules that ask "who is interacting / standing in a trigger zone / being guided by a marker" read engine.actorPosition() instead of engine.player,
// so a game hands control to a vehicle, another squad member or a selected unit by setting engine.actor, and ops default ctx.actor to it.

export const actorMethods = {
  /**
   * Where an actor is now: the player's live position for 'player' (engine.focus when there is no player), else its model or world record position.
   * null when the id is unknown. Defaults to engine.actor, the one the local user controls.
   * @example engine.actor = 'boat_1';                 // the player boards a boat: interactions, trigger zones and markers now measure from the boat
   * const p = engine.actorPosition();                 // { x, y, z } of the boat
   * @param {string} [id]
   * @returns {{ x: number, y: number, z: number } | null}
   */
  actorPosition(id = this.actor) {
    // without any player (builder, strategy view) the camera focus stands in for 'player'
    return this._actorObject(id)?.position ?? this.world?.get(id)?.position ?? (id === 'player' ? this.focus : null);
  },
  /** @internal The actor's three.js object right now (player root, or the world model when built); null when it has none */
  _actorObject(id = this.actor) {
    if (id === 'player' && this.player) return this.player.root;
    return this.world?.view(id) ?? null;
  },
};
