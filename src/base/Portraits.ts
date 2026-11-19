import { CHARACTERS, type CharacterId, type Mood } from '../content/characters';

/**
 * Portrait images for the conversation screen.
 * Real art (public/portraits/<id>/<mood>.png, listed in content/characters.ts) is used when it
 * exists; otherwise a simple drawn placeholder bust is generated, with an expression per mood.
 */
export function portraitUrl(id: CharacterId, mood: Mood): string {
  const c = CHARACTERS[id];
  if (c.art.length > 0) {
    const m = c.art.includes(mood) ? mood : c.art.includes('neutral') ? 'neutral' : c.art[0];
    return `./portraits/${id}/${m}.png`;
  }
  return placeholder(id, mood);
}

const cache = new Map<string, string>();

function placeholder(id: CharacterId, mood: Mood): string {
  const key = `${id}:${mood}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const svg = id === 'pilot' ? pilotSvg(mood) : id === 'bot' ? botSvg(mood) : crewSvg(id, mood);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}

const INK = '#1b1233';

/** Eyes, brows and mouth for each mood (centred on a face at 200, 230). */
function face(mood: Mood): string {
  const eyeY = 225;
  const eyes = {
    neutral: `<circle cx="168" cy="${eyeY}" r="9"/><circle cx="232" cy="${eyeY}" r="9"/>`,
    happy: `<path d="M156 ${eyeY + 4} Q168 ${eyeY - 10} 180 ${eyeY + 4}" /><path d="M220 ${eyeY + 4} Q232 ${eyeY - 10} 244 ${eyeY + 4}" />`,
    annoyed: `<circle cx="168" cy="${eyeY + 3}" r="8"/><circle cx="232" cy="${eyeY + 3}" r="8"/>`,
    surprised: `<circle cx="168" cy="${eyeY}" r="12" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="168" cy="${eyeY}" r="5"/><circle cx="232" cy="${eyeY}" r="12" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="232" cy="${eyeY}" r="5"/>`,
    sad: `<circle cx="168" cy="${eyeY + 4}" r="8"/><circle cx="232" cy="${eyeY + 4}" r="8"/>`,
  }[mood];
  const brows = {
    neutral: `<path d="M150 200 L184 198"/><path d="M216 198 L250 200"/>`,
    happy: `<path d="M150 196 Q167 186 184 194"/><path d="M216 194 Q233 186 250 196"/>`,
    annoyed: `<path d="M150 194 L186 206"/><path d="M214 206 L250 194"/>`,
    surprised: `<path d="M150 186 Q167 174 184 184"/><path d="M216 184 Q233 174 250 186"/>`,
    sad: `<path d="M150 206 L184 196"/><path d="M216 196 L250 206"/>`,
  }[mood];
  const mouth = {
    neutral: `<path d="M180 282 L220 282"/>`,
    happy: `<path d="M172 274 Q200 304 228 274"/>`,
    annoyed: `<path d="M180 288 L222 280"/>`,
    surprised: `<ellipse cx="200" cy="284" rx="12" ry="16" fill="${INK}"/>`,
    sad: `<path d="M176 292 Q200 270 224 292"/>`,
  }[mood];
  return `<g fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linecap="round" fill-opacity="1">
    <g stroke-width="0">${mood === 'happy' ? '' : eyes}</g>${mood === 'happy' ? `<g fill="none">${eyes}</g>` : ''}
    <g fill="none">${brows}${mood === 'surprised' ? '' : mouth}</g>${mood === 'surprised' ? mouth : ''}
  </g>`;
}

/** A waist-up crew member with a distinct silhouette per character. */
function crewSvg(id: 'rook' | 'juno' | 'pip', mood: Mood): string {
  const c = CHARACTERS[id];
  const skin = { rook: '#c98e66', juno: '#8d5a45', pip: '#f2c9a0' }[id];
  const hair = { rook: '#3a3448', juno: '#ff6fd0', pip: '#f2a23a' }[id];
  const suit = { rook: '#7a2b2b', juno: '#2a3150', pip: '#e8eef5' }[id];
  const trim = { rook: '#e2733a', juno: '#ff5fd2', pip: '#2fa8b5' }[id];
  // Character details.
  const hairShape = {
    // Rook: buzz cut and a scar.
    rook: `<path d="M128 214 Q130 140 200 132 Q270 140 272 214 Q262 168 200 164 Q138 168 128 214Z" fill="${hair}"/>
           <path d="M236 248 L252 276" stroke="#8a4a3a" stroke-width="5" stroke-linecap="round"/>`,
    // Juno: big swept hair and hoop earrings.
    juno: `<path d="M118 260 Q96 120 210 112 Q312 118 290 230 Q282 170 226 160 Q170 176 150 200 Q140 230 118 260Z" fill="${hair}"/>
           <circle cx="126" cy="262" r="14" fill="none" stroke="#ffd36b" stroke-width="6"/><circle cx="274" cy="262" r="14" fill="none" stroke="#ffd36b" stroke-width="6"/>`,
    // Pip: messy hair and goggles pushed up on the forehead.
    pip: `<path d="M126 206 Q120 136 200 128 Q284 132 276 206 L262 176 L246 196 L230 166 L212 190 L196 162 L178 192 L160 168 L146 196Z" fill="${hair}"/>
          <rect x="140" y="170" width="120" height="16" rx="8" fill="#3a3448"/>
          <circle cx="172" cy="178" r="20" fill="#9ff4ff" stroke="#3a3448" stroke-width="7"/><circle cx="228" cy="178" r="20" fill="#9ff4ff" stroke="#3a3448" stroke-width="7"/>`,
  }[id];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560">
    <defs><radialGradient id="g" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="${c.color}" stop-opacity="0.55"/><stop offset="1" stop-color="${c.color}" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="200" cy="300" rx="200" ry="260" fill="url(#g)"/>
    <path d="M40 560 Q50 400 140 370 L260 370 Q350 400 360 560Z" fill="${suit}" stroke="${INK}" stroke-width="8"/>
    <path d="M140 370 L200 440 L260 370" fill="none" stroke="${trim}" stroke-width="12"/>
    <rect x="172" y="320" width="56" height="60" fill="${skin}" stroke="${INK}" stroke-width="7"/>
    <ellipse cx="200" cy="230" rx="78" ry="96" fill="${skin}" stroke="${INK}" stroke-width="8"/>
    ${hairShape}
    ${face(mood)}
    <text x="200" y="548" font-family="sans-serif" font-size="18" fill="#fff" fill-opacity="0.45" text-anchor="middle">PLACEHOLDER</text>
  </svg>`;
}

/** The player: always helmeted, so the visor shows the "mood" as a little light pattern. */
function pilotSvg(mood: Mood): string {
  const visorGlow = { neutral: '#6ff7ff', happy: '#9fffd0', annoyed: '#ffb36b', surprised: '#ffffff', sad: '#7fa8ff' }[mood];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560">
    <defs><radialGradient id="g" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#e2733a" stop-opacity="0.5"/><stop offset="1" stop-color="#e2733a" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="200" cy="300" rx="200" ry="260" fill="url(#g)"/>
    <path d="M30 560 Q40 390 130 360 L270 360 Q360 390 370 560Z" fill="#ece4d4" stroke="${INK}" stroke-width="8"/>
    <path d="M110 420 L290 420 L270 500 L130 500Z" fill="#e2733a" stroke="${INK}" stroke-width="7"/>
    <ellipse cx="78" cy="400" rx="56" ry="40" fill="#e2733a" stroke="${INK}" stroke-width="7"/>
    <ellipse cx="322" cy="400" rx="56" ry="40" fill="#e2733a" stroke="${INK}" stroke-width="7"/>
    <circle cx="200" cy="230" r="130" fill="#ece4d4" stroke="${INK}" stroke-width="9"/>
    <rect x="186" y="96" width="28" height="70" rx="10" fill="#e2733a" stroke="${INK}" stroke-width="6"/>
    <path d="M100 220 Q200 150 300 220 Q300 310 200 320 Q100 310 100 220Z" fill="#1d2a3a" stroke="${INK}" stroke-width="8"/>
    <path d="M118 222 Q200 166 282 222" fill="none" stroke="${visorGlow}" stroke-width="10" stroke-linecap="round" opacity="0.9"/>
    <path d="M150 250 Q200 236 250 250" fill="none" stroke="${visorGlow}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>
    <text x="200" y="548" font-family="sans-serif" font-size="18" fill="#fff" fill-opacity="0.45" text-anchor="middle">PLACEHOLDER</text>
  </svg>`;
}

/** BOLT: a retro robot with a CRT screen for a face (the expression is drawn on the screen). */
function botSvg(mood: Mood): string {
  const g = '#7dff9a';
  const eyes = {
    neutral: `<rect x="150" y="200" width="26" height="34" rx="4"/><rect x="224" y="200" width="26" height="34" rx="4"/>`,
    happy: `<path d="M146 226 L163 206 L180 226" fill="none" stroke="${g}" stroke-width="10"/><path d="M220 226 L237 206 L254 226" fill="none" stroke="${g}" stroke-width="10"/>`,
    annoyed: `<rect x="148" y="214" width="32" height="12"/><rect x="220" y="214" width="32" height="12"/>`,
    surprised: `<rect x="144" y="194" width="38" height="44" fill="none" stroke="${g}" stroke-width="8"/><rect x="218" y="194" width="38" height="44" fill="none" stroke="${g}" stroke-width="8"/>`,
    sad: `<rect x="150" y="214" width="26" height="22" rx="4"/><rect x="224" y="214" width="26" height="22" rx="4"/>`,
  }[mood];
  const mouth = {
    neutral: `<rect x="170" y="262" width="60" height="8"/>`,
    happy: `<path d="M160 258 L180 276 L220 276 L240 258" fill="none" stroke="${g}" stroke-width="9"/>`,
    annoyed: `<path d="M164 270 L184 262 L204 270 L224 262 L240 270" fill="none" stroke="${g}" stroke-width="7"/>`,
    surprised: `<rect x="186" y="254" width="28" height="28" fill="none" stroke="${g}" stroke-width="7"/>`,
    sad: `<path d="M160 278 L180 262 L220 262 L240 278" fill="none" stroke="${g}" stroke-width="9"/>`,
  }[mood];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560">
    <defs><radialGradient id="g" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#2fb5a0" stop-opacity="0.55"/><stop offset="1" stop-color="#2fb5a0" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="200" cy="300" rx="200" ry="260" fill="url(#g)"/>
    <path d="M60 560 Q70 410 140 390 L260 390 Q330 410 340 560Z" fill="#e8dfcc" stroke="${INK}" stroke-width="8"/>
    <rect x="120" y="440" width="160" height="60" rx="10" fill="#26304a" stroke="${INK}" stroke-width="6"/>
    <circle cx="150" cy="470" r="10" fill="#ffb347"/><circle cx="185" cy="470" r="10" fill="#ff4a4a"/><circle cx="220" cy="470" r="10" fill="#6ff7ff"/>
    <rect x="176" y="350" width="48" height="50" fill="#26304a" stroke="${INK}" stroke-width="7"/>
    <line x1="200" y1="110" x2="200" y2="70" stroke="${INK}" stroke-width="7"/><circle cx="200" cy="62" r="14" fill="#ff4a4a" stroke="${INK}" stroke-width="6"/>
    <rect x="88" y="110" width="224" height="250" rx="40" fill="#e2733a" stroke="${INK}" stroke-width="9"/>
    <rect x="72" y="190" width="20" height="70" rx="6" fill="#26304a" stroke="${INK}" stroke-width="6"/><rect x="308" y="190" width="20" height="70" rx="6" fill="#26304a" stroke="${INK}" stroke-width="6"/>
    <rect x="118" y="160" width="164" height="150" rx="26" fill="#0d2a1e" stroke="${INK}" stroke-width="8"/>
    <g fill="${g}">${eyes}${mouth}</g>
    <text x="200" y="548" font-family="sans-serif" font-size="18" fill="#fff" fill-opacity="0.45" text-anchor="middle">PLACEHOLDER</text>
  </svg>`;
}
