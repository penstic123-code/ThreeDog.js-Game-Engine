// Weather display names (string table weather.<name>); a game that adds a weather adds its name with i18n.add.
export const STRINGS = {
  'zh-CN': { 'module.weather': '天气', 'weather.clear': '晴', 'weather.cloudy': '多云', 'weather.overcast': '阴', 'weather.rain': '雨', 'weather.storm': '暴雨',
    'weather.snow': '雪', 'weather.fog': '雾', 'weather.auto': '自动变化' },
  en: { 'module.weather': 'weather', 'weather.clear': 'Clear', 'weather.cloudy': 'Cloudy', 'weather.overcast': 'Overcast', 'weather.rain': 'Rain', 'weather.storm': 'Storm',
    'weather.snow': 'Snow', 'weather.fog': 'Fog', 'weather.auto': 'Auto' },
};

// Errors of weather() / the weather table
export const ERR = {
  types: "weather({ types }): the game's weather table, name -> { cloud, sun, fog, wind, rain, snow, grey, lightning } (left-out fields are calm), at least one; got {got}. Seven temperate ones: weather(presets.weather.temperate) with presets from 'threedog'",
  field: "weather type '{k}': field {f} must be a number (every field blends smoothly on change); got {got}",
  start: "weather({ start }): '{got}' is not one of this game's weather types ({list})",
  pool: "weather({ autoPool }): '{got}' is not one of this game's weather types ({list})",
};
