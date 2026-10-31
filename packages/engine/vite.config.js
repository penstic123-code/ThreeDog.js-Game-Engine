import { gameConfig } from '@threedog/tools/vite';

// Engine package: serves the example pages (index.html open world, city.html small town); when running tests (THREEDOG_TEST) it also adds the tests/<name>/index.html test pages
export default gameConfig(import.meta.dirname);
