/* 사용 기록 (애널리틱스)
 * 참여자 한 명 = 세션 하나. 페이지를 새로 열 때(또는 「다음 참여자 시작」) 새 세션이 시작됨.
 * - 화면별 머문 시간: 휴대폰 화면(data-stage), 과태료 안내 창, 안내 슬라이드, 설문을 각각 화면으로 기록
 * - 클릭: 휴대폰 화면 안의 모든 터치를 좌표·대상과 함께 기록
 *   ok = 버튼 등을 누름 / dead = 아무 기능 없는 곳을 누름 / disabled = 비활성 버튼 / back = 뒤로가기
 *   blocked = 눌렀더니 "등록된 주소가 없어요" 같은 안내만 뜸(프로토타입에서 막힌 기능)
 * - 연타(같은 곳 1.2초 안에 3번 이상), 처음부터 다시, 시나리오 변경도 기록
 * 기록은 이 기기 브라우저(localStorage)에 저장되고 report.html 에서 확인·내보내기 할 수 있음.
 * 같은 기록과 설문 응답은 구글 스프레드시트(Apps Script 웹 앱)로도 자동 전송됨.
 */
(() => {
  /* ---------- 구글 스프레드시트 자동 전송 ---------- */
  // 소영 님 구글 계정의 Apps Script 웹 앱. 쓰기만 열려 있고, 읽기는 진행자 키가 있어야 함.
  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbzPyIFotwW2onkwtzBDuqo2MtwtJ4CgVsXuYq7WuYeU-ObOP_L_X3USNLqhBmGYxIw1QA/exec';
  const QUEUE_KEY = 'kakaoBikeSyncQueue';
  window.KAKAOBIKE_SYNC_URL = SYNC_URL;
  const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
  const writeQueue = queue => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* 용량 초과 시 다음 기회에 */ } };
  let flushing = false;
  async function flushQueue() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    let failed = false;
    try {
      for (const item of readQueue()) {
        try {
          const body = JSON.stringify(item);
          await fetch(SYNC_URL, { method: 'POST', mode: 'no-cors', keepalive: body.length < 60000, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
          // 보낸 항목만 큐에서 뺌 (보내는 사이 같은 세션이 새로 바뀌었으면 그건 남김)
          writeQueue(readQueue().filter(q => !(q.qid === item.qid && JSON.stringify(q) === body)));
        } catch { failed = true; break; /* 오프라인 등: 나중에 다시 */ }
      }
    } finally {
      flushing = false;
      if (!failed && readQueue().length) setTimeout(flushQueue, 500);
    }
  }
  // 설문 응답은 쌓아서 보내고, 사용 기록은 세션마다 최신 것 하나만 보냄
  window.kakaoBikeSync = (type, data) => {
    const qid = type + ':' + (type === 'session' ? data.id : Date.now() + Math.random());
    const queue = readQueue().filter(q => q.qid !== qid);
    queue.push({ qid, type, data });
    writeQueue(queue);
    flushQueue();
  };
  setInterval(flushQueue, 15000);
  addEventListener('online', flushQueue);
  flushQueue();

  const KEY = 'kakaoBikeAnalytics';
  const SHOT_KEY = 'kakaoBikeAnalyticsShots';
  const W = 402, H = 874;
  const phone = document.getElementById('phone');
  if (!phone) return;
  const dialog = document.getElementById('penalty');
  const toast = document.getElementById('toast');
  const scenario = document.getElementById('scenario');
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  const session = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    started_at: new Date().toISOString(),
    scenario: scenario ? scenario.options[scenario.selectedIndex].text : '',
    viewport: innerWidth + 'x' + innerHeight,
    visits: [], clicks: [], events: [],
    participant: window.kakaoBikeParticipant || '',
    prototype_start: null, done_at: null, survey_submitted: false
  };
  addEventListener('kakaobike:participant', event => { session.participant = event.detail; saveSoon(); });
  window.kakaoBikeAnalytics = session;

  /* ---------- 저장 ---------- */
  const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  let saveTimer = 0;
  function save() {
    // 안내 슬라이드만 넘기고 끝난 세션은 저장하지 않음
    if (session.prototype_start == null) return;
    if (visit) { visit.leave = now(); visit.ms = visit.leave - visit.enter; }
    try {
      const all = readAll().filter(s => s.id !== session.id);
      all.push(session);
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (error) { console.warn('사용 기록 저장 실패', error); }
    paintCount();
    syncSoon();
  }
  let lastSync = 0, syncTimer = 0;
  function syncSoon(force) {
    if (session.prototype_start == null) return;
    clearTimeout(syncTimer);
    const wait = force ? 0 : Math.max(0, 10000 - (Date.now() - lastSync));
    syncTimer = setTimeout(() => { lastSync = Date.now(); window.kakaoBikeSync('session', session); }, wait);
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); };
  function sendNow() {
    if (session.prototype_start == null) return;
    save();
    clearTimeout(syncTimer);
    const item = { qid: 'session:' + session.id, type: 'session', data: session };
    const queue = readQueue().filter(q => q.qid !== item.qid);
    queue.push(item);
    writeQueue(queue);
    // 창을 닫는 순간에도 전송되도록 beacon 사용
    if (navigator.sendBeacon && navigator.sendBeacon(SYNC_URL, new Blob([JSON.stringify(item)], { type: 'text/plain;charset=utf-8' }))) {
      writeQueue(readQueue().filter(q => q.qid !== item.qid));
    }
  }
  addEventListener('pagehide', () => { closeVisit(); sendNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sendNow(); });

  /* ---------- 지금 화면 ---------- */
  function currentKey() {
    if (document.querySelector('.flow-start')) return 'start';
    if (document.querySelector('.survey:not([hidden])')) return 'survey';
    const deck = document.querySelector('.intro-deck');
    if (deck) {
      const on = [...deck.querySelectorAll('.intro-dots i')].findIndex(dot => dot.classList.contains('on'));
      return 'slide' + (on + 1 || 1);
    }
    if (dialog && dialog.open) return 'penalty';
    const stage = phone.dataset.stage || 'home';
    if (stage === 'ride' && phone.dataset.warning === 'true') return 'ride_warning';
    return stage;
  }
  let visit = null;
  function closeVisit() {
    if (!visit) return;
    visit.leave = now();
    visit.ms = visit.leave - visit.enter;
    visit = null;
  }
  function checkScreen() {
    const key = currentKey();
    if (visit && visit.key === key) return key;
    closeVisit();
    visit = { key, enter: now(), leave: null, ms: null };
    session.visits.push(visit);
    const pre = key.startsWith('slide') || key === 'survey' || key === 'start';
    if (session.prototype_start == null && !pre) session.prototype_start = visit.enter;
    if (key === 'done' && session.done_at == null) { session.done_at = visit.enter; setTimeout(() => syncSoon(true), 1000); }
    if (!pre) scheduleShot(key);
    saveSoon();
    return key;
  }
  setInterval(checkScreen, 200);
  setInterval(save, 5000);
  checkScreen();

  /* ---------- 클릭 ---------- */
  const INTERACTIVE = 'button,a[href],input,select,textarea,label,summary,[role="button"],[role="tab"],[role="radio"],[role="switch"]';
  function interactiveAncestor(el) {
    for (let node = el; node && node !== phone.parentNode; node = node.parentElement) {
      if (node.matches?.(INTERACTIVE) || typeof node.onclick === 'function') return node;
      if (node === phone) break;
    }
    return null;
  }
  function labelOf(el) {
    if (!el) return '';
    const text = el.getAttribute('aria-label') || el.innerText || el.getAttribute('alt') || el.getAttribute('title') || '';
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 30);
    return clean || (el.id ? '#' + el.id : el.tagName.toLowerCase());
  }
  let lastToast = '';
  function toPhone(event) {
    const r = phone.getBoundingClientRect();
    return [
      Math.round(Math.max(0, Math.min(W, (event.clientX - r.left) / r.width * W))),
      Math.round(Math.max(0, Math.min(H, (event.clientY - r.top) / r.height * H)))
    ];
  }
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element) || !phone.contains(target)) return;
    const screen = checkScreen();
    if (screen.startsWith('slide') || screen === 'survey' || screen === 'start') return;
    const hit = interactiveAncestor(target);
    const [x, y] = toPhone(event);
    const label = hit ? labelOf(hit) : '';
    let kind = 'ok';
    if (!hit) kind = 'dead';
    else if (hit.disabled || hit.getAttribute('aria-disabled') === 'true') kind = 'disabled';
    else if (/back|뒤로/i.test((hit.id || '') + ' ' + (hit.getAttribute('aria-label') || '')) || label === '‹') kind = 'back';
    const click = { t: now(), screen, x, y, kind, target: hit ? (hit.id || '') : '', label: label || (target.id ? '#' + target.id : '빈 곳') };
    session.clicks.push(click);
    lastToast = toast?.classList.contains('shown') ? toast.textContent : '';
    // 클릭 결과 확인: 화면 이동 / 안내 토스트
    setTimeout(() => {
      const after = currentKey();
      if (after !== screen) click.to = after;
      if (toast?.classList.contains('shown') && toast.textContent && toast.textContent !== lastToast) {
        click.toast = toast.textContent.trim().slice(0, 60);
        if (click.kind === 'ok' && !click.to) click.kind = 'blocked';
      }
      saveSoon();
    }, 700);
    // 연타
    const recent = session.clicks.filter(c => c.screen === screen && click.t - c.t < 1200 && Math.hypot(c.x - x, c.y - y) < 30);
    if (recent.length === 3) session.events.push({ t: click.t, type: 'rage', screen, x, y, label: click.label });
    saveSoon();
  }, true);

  /* ---------- 진행자 동작 ---------- */
  document.getElementById('reset')?.addEventListener('click', () => {
    session.events.push({ t: now(), type: 'restart', screen: currentKey() });
    saveSoon();
  });
  scenario?.addEventListener('change', () => {
    session.events.push({ t: now(), type: 'scenario', screen: currentKey(), value: scenario.options[scenario.selectedIndex].text });
    session.scenario = scenario.options[scenario.selectedIndex].text;
    saveSoon();
  });
  // 설문 제출 감지
  new MutationObserver(() => {
    if (!session.survey_submitted && document.querySelector('.survey-done')) {
      session.survey_submitted = true;
      session.events.push({ t: now(), type: 'survey_submitted', screen: 'survey' });
      save();
      syncSoon(true);
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* ---------- 화면 캡처 (리포트 히트맵 배경용, 화면마다 한 번) ---------- */
  const readShots = () => { try { return JSON.parse(localStorage.getItem(SHOT_KEY) || '{}'); } catch { return {}; } };
  const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'visibility', 'display'];
  function inlineSvgStyles() {
    const restore = [];
    for (const el of phone.querySelectorAll('svg *')) {
      const computed = getComputedStyle(el);
      const before = el.getAttribute('style');
      restore.push([el, before]);
      el.setAttribute('style', (before ? before + ';' : '') + SVG_PROPS.map(p => `${p}:${computed.getPropertyValue(p)}`).join(';'));
    }
    return () => { for (const [el, before] of restore) before == null ? el.removeAttribute('style') : el.setAttribute('style', before); };
  }
  let shotTimer = 0, shooting = false;
  function scheduleShot(key) {
    if (!window.htmlToImage || readShots()[key]) return;
    clearTimeout(shotTimer);
    shotTimer = setTimeout(async () => {
      if (shooting || currentKey() !== key || readShots()[key]) return;
      shooting = true;
      const restore = inlineSvgStyles();
      try {
        const url = await htmlToImage.toJpeg(phone, {
          width: W, height: H, pixelRatio: 1, quality: 0.72, cacheBust: false, skipFonts: true, backgroundColor: '#ffffff',
          filter: node => !(node.tagName === 'IMG' && !node.getAttribute('src')),
          imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
          style: { transform: 'none', translate: 'none', scale: 'none', left: '0', top: '0', margin: '0' }
        });
        const shots = readShots();
        shots[key] = url;
        localStorage.setItem(SHOT_KEY, JSON.stringify(shots));
      } catch (error) {
        console.warn('화면 캡처 실패', key, error);
      } finally {
        restore();
        shooting = false;
      }
    }, 1200);
  }

  /* ---------- 진행자 패널 버튼 ---------- */
  let link;
  function paintCount() {
    if (link) link.textContent = `사용 분석 리포트 (${readAll().length}명)`;
  }
  const controls = document.querySelector('.controls');
  if (controls) {
    link = document.createElement('a');
    link.className = 'reset survey-open analytics-open';
    link.href = 'report.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.textDecoration = 'none';
    link.style.color = 'inherit';
    controls.append(link);
    paintCount();
  }
})();
