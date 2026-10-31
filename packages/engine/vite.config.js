import { gameConfig } from '@threedog/tools/vite';

// Engine package: serves the example page (index.html, open world); when running tests (THREEDOG_TEST) it also adds the tests/<name>/index.html test pages
export default gameConfig(import.meta.dirname);
