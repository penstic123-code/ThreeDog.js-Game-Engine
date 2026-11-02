// R43 every JSDoc block in the hand-written d.ts documents a member. A /** */ block followed directly by another /** */ block, a // comment
// or the closing } of its interface documents nothing: the editor shows it on the next member (wrong text) or nowhere, and the member it
// was written for is usually gone (EngineOptions.batching lost its line this way while its JSDoc stayed). Level: error.
// Criteria: in index.d.ts and types/*.d.ts (not types/generated, which npm run map writes from the JS), the text after a block's */ up to the
// next non-blank character starts with /**, // or }. Known limit: a JSDoc followed by a member of another kind of declaration is not judged.
import { read, dtsFiles, P } from './_lib.mjs';

const NEXT = /\*\/[ \t]*\r?\n\s*(\/\*\*|\/\/|\})/g;

export default {
  id: 'R43', title: 'Every JSDoc block in the hand-written d.ts documents a member',
  run() {
    const out = [];
    for (const f of dtsFiles()) {
      if (f.startsWith(P.TYPES_REL + '/generated/')) continue;
      const text = read(f);
      for (const m of text.matchAll(NEXT)) {
        const line = text.slice(0, m.index).split('\n').length;
        const what = m[1] === '}' ? 'the closing } (its member is missing)' : m[1] === '//' ? 'a // comment' : 'another JSDoc block';
        out.push({ level: 'error', file: f, line, msg: `a JSDoc block is followed by ${what}, so it documents nothing`,
          fix: 'put the member it describes right under it, merge it into the next block, or delete it' });
      }
    }
    return out;
  },
};
