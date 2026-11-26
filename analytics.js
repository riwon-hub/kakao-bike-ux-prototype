/* 사용 기록 (애널리틱스)
 * 참여자 한 명 = 세션 하나. 페이지를 새로 열 때(또는 「다음 참여자 시작」) 새 세션이 시작됨.
 * - 화면별 머문 시간: 휴대폰 화면(data-stage), 과태료 안내 창, 안내 슬라이드, 설문을 각각 화면으로 기록
 * - 클릭: 휴대폰 화면 안의 모든 터치를 좌표·대상과 함께 기록
 *   ok = 버튼 등을 누름 / dead = 아무 기능 없는 곳을 누름 / disabled = 비활성 버튼 / back = 뒤로가기
 *   blocked = 눌렀더니 "등록된 주소가 없어요" 같은 안내만 뜸(프로토타입에서 막힌 기능)
 * - 연타(같은 곳 1.2초 안에 3번 이상), 처음부터 다시, 시나리오 변경도 기록
 * 기록은 이 기기 브라우저(localStorage)에 저장되고 report.html 에서 확인·내보내기 할 수 있음.
 */
(() => {
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
    prototype_start: null, done_at: null, survey_submitted: false
  };
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
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); };
  addEventListener('pagehide', () => { closeVisit(); save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  /* ---------- 지금 화면 ---------- */
  function currentKey() {
    if (document.querySelector('.survey')) return 'survey';
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
    if (session.prototype_start == null && !key.startsWith('slide') && key !== 'survey') session.prototype_start = visit.enter;
    if (key === 'done' && session.done_at == null) session.done_at = visit.enter;
    if (!key.startsWith('slide') && key !== 'survey') scheduleShot(key);
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
    if (screen.startsWith('slide') || screen === 'survey') return;
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
