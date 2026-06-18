'use strict';

const LIMIT = 280;

// ── Character counting ────────────────────────────────────────────────────────
function charWidth(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303F) ||
    (cp >= 0x3040 && cp <= 0x33FF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0x9FFF) ||
    (cp >= 0xA000 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x2A6DF) ||
    (cp >= 0x2A700 && cp <= 0x2CEAF) ||
    (cp >= 0x2CEB0 && cp <= 0x2EBEF)
  ) ? 2 : 1;
}

function countUnits(str) {
  let n = 0;
  for (const ch of str) n += charWidth(ch.codePointAt(0));
  return n;
}

// ── Core split ────────────────────────────────────────────────────────────────
function doSplit(text, limit) {
  const tweets = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (countUnits(remaining) <= limit) { tweets.push(remaining); break; }
    const pos = findSplitPos(remaining, limit);
    const piece = remaining.slice(0, pos).trimEnd();
    if (piece.length === 0) { tweets.push(remaining.trimEnd()); break; }
    tweets.push(piece);
    remaining = remaining.slice(pos).trimStart();
  }
  return tweets;
}

function findSplitPos(text, limit) {
  let maxPos = 0, units = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    const charLen = cp > 0xFFFF ? 2 : 1;
    const w = charWidth(cp);
    if (units + w > limit) break;
    units += w;
    i += charLen;
    maxPos = i;
  }
  const region = text.slice(0, maxPos);
  const floor = Math.floor(maxPos * 0.4);

  const p1 = region.lastIndexOf('\n\n');
  if (p1 >= floor) return p1 + 2;
  const p2 = region.lastIndexOf('\n');
  if (p2 >= floor) return p2 + 1;

  let lastS = -1, lastP = -1, m;
  const sr = /[。！？!?]/g;
  while ((m = sr.exec(region)) !== null) lastS = m.index + 1;
  if (lastS >= floor) return lastS;
  const pr = /[、,]/g;
  while ((m = pr.exec(region)) !== null) lastP = m.index + 1;
  if (lastP >= floor) return lastP;

  const sp = region.lastIndexOf(' ');
  if (sp > 0) return sp + 1;
  return maxPos;
}

// ── State ─────────────────────────────────────────────────────────────────────
// posts[] stores RAW texts without numbering suffix; numbering is applied at render/copy time.
let posts = [];
// postSeparators[i] = the newline(s) originally between posts[i] and posts[i+1] ('' | '\n' | '\n\n')
let postSeparators = [];

// Scan trimmedText to find the whitespace gap between adjacent post texts and
// extract only its newline structure (at most '\n\n').
function buildSeparators(trimmedText, postTexts) {
  const seps = [];
  let cursor = 0;
  for (let i = 0; i < postTexts.length - 1; i++) {
    const ai = trimmedText.indexOf(postTexts[i], cursor);
    if (ai < 0) { seps.push(''); continue; }
    const ae = ai + postTexts[i].length;
    const bi = trimmedText.indexOf(postTexts[i + 1], ae);
    if (bi < 0) { seps.push(''); cursor = ae; continue; }
    const nl = trimmedText.slice(ae, bi).replace(/[^\n]/g, '').slice(0, 2);
    seps.push(nl);
    cursor = ae;
  }
  return seps;
}

function effectiveLimitForN(n) {
  if (!toggleEl || !toggleEl.checked || n === 0) return LIMIT;
  return LIMIT - countUnits(` (${n}/${n})`);
}

function resetPostsFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) { posts = []; postSeparators = []; return; }
  if (!toggleEl.checked) {
    posts = doSplit(trimmed, LIMIT);
    postSeparators = buildSeparators(trimmed, posts);
    return;
  }
  let total = doSplit(trimmed, LIMIT).length;
  let result;
  for (let i = 0; i < 4; i++) {
    result = doSplit(trimmed, effectiveLimitForN(total));
    if (result.length === total) break;
    total = result.length;
  }
  posts = result;
  postSeparators = buildSeparators(trimmed, posts);
}

// ── Break-point analysis ──────────────────────────────────────────────────────
function getBracketRanges(text) {
  const openers = {
    '[':']', '(':')','<':'>','{':'}',
    '「':'」','（':'）','『':'』','【':'】',
    '［':'］','〈':'〉','《':'》','〔':'〕',
  };
  const closerSet = new Set(Object.values(openers));
  const stack = [];
  const ranges = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (openers[ch]) {
      stack.push({ closer: openers[ch], start: i + 1 });
    } else if (closerSet.has(ch) && stack.length && stack[stack.length - 1].closer === ch) {
      const { start } = stack.pop();
      ranges.push({ start, end: i }); // interior: [start, end)  (end = index of closing bracket)
    }
  }
  return ranges;
}

function getBreakPoints(text) {
  const brackets = getBracketRanges(text);
  // pos is the index right after the punctuation; check if that punctuation sits inside brackets
  const inside = pos => brackets.some(r => r.start < pos && pos <= r.end);

  const pts = [];
  const add = (pos, strength) => {
    if (pos > 0 && pos < text.length && !inside(pos)) pts.push({ pos, strength });
  };
  let m;
  const sr = /[。！？!?\n]/g;
  while ((m = sr.exec(text)) !== null) add(m.index + m[0].length, 'strong');
  const pr = /[、,]/g;
  while ((m = pr.exec(text)) !== null) add(m.index + m[0].length, 'medium');
  const spr = / +/g;
  while ((m = spr.exec(text)) !== null) add(m.index + m[0].length, 'weak');

  const seen = new Set();
  return pts
    .filter(b => !seen.has(b.pos) && seen.add(b.pos))
    .sort((a, b) => a.pos - b.pos);
}

// best: prefer strong > medium > weak; among ties, prefer those closer to target end
function pickBest(candidates, max, fromEnd = true) {
  const ranked = [
    ...candidates.filter(b => b.strength === 'strong'),
    ...candidates.filter(b => b.strength === 'medium'),
    ...candidates.filter(b => b.strength === 'weak'),
  ];
  return fromEnd ? ranked.slice(-max) : ranked.slice(0, max);
}

function getSplitSuggestions(postIndex) {
  const text = posts[postIndex];
  const len = text.length;

  // Check if the entire post fits in the previous post (merge-all eligibility).
  let canMergeAll = false;
  if (postIndex > 0) {
    const prevUnits = countUnits(posts[postIndex - 1]);
    const prevSuffixUnits = toggleEl.checked
      ? countUnits(` (${postIndex}/${posts.length})`) : 0;
    const prevRemaining = LIMIT - prevUnits - prevSuffixUnits;
    const sepUnits = countUnits(postSeparators[postIndex - 1] ?? '');
    canMergeAll = sepUnits + countUnits(text) <= prevRemaining;
  }

  if (len < 20) return { front: [], back: [], canMergeAll };

  const all = getBreakPoints(text);

  // ── Back half: split positions between 50 %–92 % of text length ──
  const backMin = Math.floor(len * 0.5);
  const backMax = Math.floor(len * 0.92);
  const backCandidates = all.filter(b => b.pos >= backMin && b.pos <= backMax);
  const back = pickBest(backCandidates, 2, true).map(b => b.pos);

  // ── Front half: positions between 8 %–48 %, only if prev post has room ──
  let front = [];
  if (postIndex > 0) {
    const prevUnits = countUnits(posts[postIndex - 1]);
    // Account for numbering suffix on the previous post
    const prevSuffixUnits = toggleEl.checked
      ? countUnits(` (${postIndex}/${posts.length})`)
      : 0;
    const prevRemaining = LIMIT - prevUnits - prevSuffixUnits;

    if (prevRemaining >= 15) {
      const frontMin = Math.floor(len * 0.08);
      const frontMax = Math.floor(len * 0.48);
      const frontCandidates = all.filter(b => {
        if (b.pos < frontMin || b.pos > frontMax) return false;
        const moved = countUnits(text.slice(0, b.pos).trimEnd());
        return moved <= prevRemaining;
      });
      front = pickBest(frontCandidates, 2, false).map(b => b.pos);
    }
  }

  return { front, back, canMergeAll };
}

// ── Split actions ─────────────────────────────────────────────────────────────
function applyBackSplit(postIndex, charPos) {
  const text = posts[postIndex];
  const newHead = text.slice(0, charPos).trimEnd();
  const overflow = text.slice(charPos).trimStart();
  if (!overflow.trim()) return;

  const tailText = [overflow, ...posts.slice(postIndex + 1)]
    .filter(s => s.trim())
    .join('\n');

  const headPosts = [...posts.slice(0, postIndex), newHead];
  const headSeps  = postSeparators.slice(0, postIndex); // separators before split point

  let tailSplit;
  if (!toggleEl.checked) {
    tailSplit = doSplit(tailText, LIMIT);
  } else {
    let total = headPosts.length + doSplit(tailText, LIMIT).length;
    for (let i = 0; i < 4; i++) {
      tailSplit = doSplit(tailText, effectiveLimitForN(total));
      const next = headPosts.length + tailSplit.length;
      if (next === total) break;
      total = next;
    }
  }

  posts = [...headPosts, ...tailSplit];
  // Back-split positions are mid-text cuts, so all new separators are ''.
  postSeparators = [...headSeps, ...new Array(tailSplit.length).fill('')];

  renderFromPosts();
}

function applyFrontSplit(postIndex, charPos) {
  if (postIndex === 0) return;
  const text = posts[postIndex];
  const moveText = text.slice(0, charPos).trimEnd();
  const newCurrent = text.slice(charPos).trimStart();
  if (!moveText) return;

  // Use the separator that existed in the original text between these two posts.
  const sep = postSeparators[postIndex - 1] ?? '';
  posts[postIndex - 1] = posts[postIndex - 1].trimEnd() + sep + moveText;

  if (newCurrent.trim()) {
    posts[postIndex] = newCurrent;
    // The new boundary is a mid-text cut with no original newline.
    postSeparators[postIndex - 1] = '';
  } else {
    posts.splice(postIndex, 1);
    postSeparators.splice(postIndex - 1, 1);
  }

  renderFromPosts();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
// Inline split/merge icons (no text, icon only)
const ICON_SPLIT    = `<svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="1" x2="5" y2="10"/><path d="M2 7 L5 11 L8 7"/></svg>`;
const ICON_MERGE_UP = `<svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="13" x2="5" y2="4"/><path d="M2 7 L5 3 L8 7"/></svg>`;

const COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const COPY_ICON_LARGE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

async function copyToClipboard(text) {
  if (navigator.clipboard) { await navigator.clipboard.writeText(text); return; }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function flashCopied(btn, isSmall) {
  btn.innerHTML = `${CHECK_ICON} コピー完了`;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerHTML = isSmall ? `${COPY_ICON} コピー` : `${COPY_ICON_LARGE} 全てコピー`;
    btn.classList.remove('copied');
  }, 2000);
}

// ── Card body with inline suggestions ────────────────────────────────────────
function buildCardBody(rawText, postIndex, total) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tweet-card-body';

  const { front, back, canMergeAll } = getSplitSuggestions(postIndex);
  const allSuggestions = [
    ...front.map(p => ({ p, type: 'front' })),
    ...back.map(p => ({ p, type: 'back' })),
  ].sort((a, b) => a.p - b.p);

  if (allSuggestions.length === 0) {
    const seg = document.createElement('span');
    seg.className = 'text-segment';
    seg.textContent = rawText;
    wrapper.appendChild(seg);
  } else {
    let lastPos = 0;
    for (const { p, type } of allSuggestions) {
      if (p > lastPos) {
        const seg = document.createElement('span');
        seg.className = 'text-segment';
        seg.textContent = rawText.slice(lastPos, p);
        wrapper.appendChild(seg);
      }

      const span = document.createElement('span');
      span.className = `split-suggest split-${type}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-suggest-btn';

      if (type === 'back') {
        btn.innerHTML = ICON_SPLIT;
        btn.title = 'ここで分割して次のPostに送る';
        btn.setAttribute('aria-label', 'ここで分割');
        btn.addEventListener('click', () => applyBackSplit(postIndex, p));
      } else {
        btn.innerHTML = ICON_MERGE_UP;
        btn.title = '前のPostの末尾に移動する';
        btn.setAttribute('aria-label', '前のPostへ');
        btn.addEventListener('click', () => applyFrontSplit(postIndex, p));
      }

      span.appendChild(btn);
      wrapper.appendChild(span);
      lastPos = p;
    }
    if (lastPos < rawText.length) {
      const seg = document.createElement('span');
      seg.className = 'text-segment';
      seg.textContent = rawText.slice(lastPos);
      wrapper.appendChild(seg);
    }
  }

  if (toggleEl.checked) {
    const suffix = document.createElement('span');
    suffix.className = 'tweet-suffix';
    suffix.textContent = ` (${postIndex + 1}/${total})`;
    wrapper.appendChild(suffix);
  }

  if (canMergeAll) {
    const row = document.createElement('div');
    row.className = 'merge-all-row';

    const lineL = document.createElement('div');
    lineL.className = 'merge-all-line';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'merge-all-btn';
    btn.innerHTML = `${ICON_MERGE_UP} 全文を前のPostへ`;
    btn.title = '前のPostの末尾にこのPost全体を結合する';
    btn.addEventListener('click', () => applyFrontSplit(postIndex, posts[postIndex].length));
    const lineR = document.createElement('div');
    lineR.className = 'merge-all-line';

    row.appendChild(lineL);
    row.appendChild(btn);
    row.appendChild(lineR);
    wrapper.appendChild(row);
  }

  return wrapper;
}

function createCard(postIndex, total) {
  const rawText = posts[postIndex];
  const suffix = toggleEl.checked ? ` (${postIndex + 1}/${total})` : '';
  const displayText = rawText + suffix;
  const units = countUnits(displayText);
  const pct = units / LIMIT;
  const charClass = pct >= 1 ? 'danger' : pct >= 0.9 ? 'warn' : 'ok';
  const barWidth = Math.min(100, Math.round(pct * 100));

  const card = document.createElement('article');
  card.className = 'tweet-card';
  card.style.animationDelay = `${postIndex * 30}ms`;

  const header = document.createElement('div');
  header.className = 'tweet-card-header';
  header.innerHTML = `
    <span class="tweet-number">Post ${postIndex + 1} / ${total}</span>
    <div class="tweet-card-actions">
      <span class="tweet-chars ${charClass}">${units}/280</span>
      <button class="btn btn-copy" type="button" aria-label="この Post をコピー">
        ${COPY_ICON} コピー
      </button>
    </div>
  `;
  header.querySelector('.btn-copy').addEventListener('click', async function () {
    try { await copyToClipboard(displayText); flashCopied(this, true); } catch {}
  });

  card.appendChild(header);
  card.appendChild(buildCardBody(rawText, postIndex, total));

  const progress = document.createElement('div');
  progress.className = 'tweet-progress';
  progress.innerHTML = `<div class="tweet-progress-bar ${charClass}" style="width:${barWidth}%"></div>`;
  card.appendChild(progress);

  return card;
}

// ── Render ────────────────────────────────────────────────────────────────────
let currentTweets = [];

function renderFromPosts() {
  const total = posts.length;
  if (total === 0) {
    outputSection.innerHTML = '';
    outputSection.appendChild(emptyState);
    copyAllBtn.disabled = true;
    tweetCountEl.textContent = '';
    currentTweets = [];
    return;
  }

  tweetCountEl.textContent = `${total} Posts`;
  copyAllBtn.disabled = false;
  currentTweets = posts.map((t, i) =>
    toggleEl.checked ? `${t} (${i + 1}/${total})` : t
  );

  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) frag.appendChild(createCard(i, total));
  outputSection.innerHTML = '';
  outputSection.appendChild(frag);
}

function render() {
  const text = textareaEl.value;
  totalCharsEl.textContent = `${countUnits(text).toLocaleString()} 文字`;
  resetPostsFromText(text);
  renderFromPosts();
}

// ── DOM refs & event wiring ───────────────────────────────────────────────────
const textareaEl    = document.getElementById('input-text');
const totalCharsEl  = document.getElementById('total-chars');
const toggleEl      = document.getElementById('numbering-toggle');
const outputSection = document.getElementById('output-section');
const emptyState    = document.getElementById('empty-state');
const copyAllBtn    = document.getElementById('copy-all-btn');
const tweetCountEl  = document.getElementById('tweet-count');

copyAllBtn.addEventListener('click', async function () {
  if (!currentTweets.length) return;
  try { await copyToClipboard(currentTweets.join('\n\n')); flashCopied(this, false); } catch {}
});

textareaEl.addEventListener('input', render);
toggleEl.addEventListener('change', render);

render();

// ── PWA ───────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
