// Items for the bag window of the ui view. stack is the max per slot; color is the color when dropped on the ground.
export default {
  apple: { name: 'Apple', icon: '🍎', desc: 'Crisp and a little sour', stack: 20 },
  key: { name: 'Brass key', icon: '🗝', desc: 'Opens nothing in particular', stack: 1, color: 0xc8a850 },
  wood: { name: 'Wood', icon: '🪵', desc: 'Dry and light', color: 0x8a5a36 },
};

export const startItems = { apple: 5, key: 1, wood: 12 };
