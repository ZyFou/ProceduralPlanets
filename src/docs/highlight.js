// ============================================================================
// A small syntax highlighter for the documentation's code blocks. It only
// needs to colour the languages the docs use (JS/TS, shell, HTML, JSON,
// GLSL), so each language is a list of sticky regexes tried in order at
// every position; the first match becomes a token, anything else is plain.
// ============================================================================

const JS_KEYWORDS = 'await|async|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield|as|interface|type|implements';
const JS_LITERALS = 'true|false|null|undefined|NaN|Infinity';
const GLSL_TYPES = 'void|bool|int|uint|float|vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4|sampler2D|samplerCube|sampler3D';
const GLSL_KEYWORDS = 'uniform|varying|attribute|in|out|inout|const|return|if|else|for|while|break|continue|discard|precision|highp|mediump|lowp|struct';

const js = [
  ['comment', /\/\/[^\n]*/y],
  ['comment', /\/\*[\s\S]*?\*\//y],
  ['string', /`(?:\\[\s\S]|[^`\\])*`/y],
  ['string', /'(?:\\.|[^'\\\n])*'/y],
  ['string', /"(?:\\.|[^"\\\n])*"/y],
  ['number', /\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/y],
  ['keyword', new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, 'y')],
  ['literal', new RegExp(`\\b(?:${JS_LITERALS})\\b`, 'y')],
  ['type', /\b[A-Z][\w$]*\b/y],
  ['fn', /\b[a-z_$][\w$]*(?=\s*\()/y],
  ['property', /(?<=\.)[a-zA-Z_$][\w$]*/y],
];

const shell = [
  ['comment', /#[^\n]*/y],
  ['string', /'[^'\n]*'/y],
  ['string', /"(?:\\.|[^"\\\n])*"/y],
  ['keyword', /(?<=^|\n|&&\s*|\|\s*)[a-zA-Z][\w.-]*/y],
  ['flag', /(?<=\s)--?[\w-]+/y],
];

const html = [
  ['comment', /<!--[\s\S]*?-->/y],
  ['tag', /<\/?[a-zA-Z][\w-]*/y],
  ['tag', /\/?>/y],
  ['string', /"[^"]*"/y],
  ['property', /\b[a-zA-Z-]+(?==)/y],
];

const json = [
  ['property', /"(?:\\.|[^"\\\n])*"(?=\s*:)/y],
  ['string', /"(?:\\.|[^"\\\n])*"/y],
  ['number', /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/y],
  ['literal', /\b(?:true|false|null)\b/y],
];

const glsl = [
  ['comment', /\/\/[^\n]*/y],
  ['comment', /\/\*[\s\S]*?\*\//y],
  ['number', /\b\d+(?:\.\d*)?(?:e[+-]?\d+)?\b/y],
  ['type', new RegExp(`\\b(?:${GLSL_TYPES})\\b`, 'y')],
  ['keyword', new RegExp(`\\b(?:${GLSL_KEYWORDS})\\b`, 'y')],
  ['fn', /\b[a-zA-Z_]\w*(?=\s*\()/y],
];

const LANGUAGES = {
  js, javascript: js, ts: js, typescript: js, jsx: js, mjs: js,
  sh: shell, bash: shell, shell, console: shell,
  html, xml: html,
  json,
  glsl,
};

/** The display name of a fence's language tag. */
export function languageLabel(lang) {
  const key = (lang || '').toLowerCase();
  if (['js', 'javascript', 'mjs', 'jsx'].includes(key)) return 'JavaScript';
  if (['ts', 'typescript'].includes(key)) return 'TypeScript';
  if (['sh', 'bash', 'shell', 'console'].includes(key)) return 'Terminal';
  if (key === 'html') return 'HTML';
  if (key === 'json') return 'JSON';
  if (key === 'glsl') return 'GLSL';
  return key ? key.toUpperCase() : 'Text';
}

/**
 * Split code into [{ type, text }] tokens. type is null for plain text.
 * Unknown languages come back as a single plain token.
 */
export function highlight(code, lang) {
  const rules = LANGUAGES[(lang || '').toLowerCase()];
  if (!rules) return [{ type: null, text: code }];
  const tokens = [];
  let plain = '';
  let i = 0;
  while (i < code.length) {
    let matched = null;
    for (const [type, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) { matched = { type, text: m[0] }; break; }
    }
    if (matched) {
      if (plain) { tokens.push({ type: null, text: plain }); plain = ''; }
      tokens.push(matched);
      i += matched.text.length;
    } else {
      plain += code[i];
      i += 1;
    }
  }
  if (plain) tokens.push({ type: null, text: plain });
  return tokens;
}
