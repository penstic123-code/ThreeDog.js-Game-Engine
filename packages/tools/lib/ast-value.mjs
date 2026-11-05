// The value a literal's syntax tree stands for: the one copy shared by content write-back (content-write.mjs) and `threedog tune write` (tune.mjs).
// Why undefined for code and not a guess: both callers rewrite the file from what this returns, so a value it cannot read must stay the author's text, never drop out.

/** The name of an object property's key; null when it is computed @param {any} p */
export const keyName = p => p.computed ? null : p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null;

/**
 * The value of a literal node (strings, numbers, -1, arrays, objects, a template without ${}); undefined when it is code
 * @param {any} n
 * @param {(literal: any) => any} [read]  what one Literal node means (tune reads 0x3388aa back as a color)
 * @returns {any}
 */
export function literalValue(n, read = l => l.value) {
  if (!n) return undefined;
  if (n.type === 'Literal') return read(n);
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal') return -n.argument.value;
  if (n.type === 'TemplateLiteral' && !n.expressions.length) return n.quasis[0].value.cooked;
  if (n.type === 'ArrayExpression') { const a = n.elements.map(x => literalValue(x, read)); return a.includes(undefined) ? undefined : a; }
  if (n.type === 'ObjectExpression') {
    const o = {};
    for (const p of n.properties) { const k = p.type === 'Property' ? keyName(p) : null, v = k == null ? undefined : literalValue(p.value, read); if (v === undefined) return undefined; o[k] = v; }
    return o;
  }
  return undefined;
}
