// Game-specific key actions: action name -> default key and display label. What a press does lives in main.js (engine.input.pressed('action name')).
// Built-in module actions (move, jump, interact E, inventory I, quests J, photo P...) need no entry here.
export default {
  save: { keys: ['KeyK'], label: '存档' },
  load: { keys: ['KeyL'], label: '读档' },
  kick: { keys: ['KeyF'], label: '推/踢' },
  chop: { keys: ['KeyC'], label: '砍树' },
};
