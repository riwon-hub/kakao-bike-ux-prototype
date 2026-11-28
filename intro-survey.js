/* 테스트 진행 흐름: 안내 슬라이드 → 프로토타입 → 사후 설문
 * - 슬라이드: 화면 아무 곳이나 터치하면 다음, 왼쪽 가장자리 터치(또는 ←)는 이전. 마지막 장 다음은 프로토타입.
 * - 반납 완료 화면에서 「이용 완료」를 누르면 3분 설문 안내를 표시하고 설문으로 이어짐.
 * - 응답은 이 기기 브라우저(localStorage)에 쌓이고, 패널의 「설문 응답 CSV」로 내려받음.
 * - 시작할 때 참여자 이름(닉네임)을 받고, 화면 맨 위 진행바로 슬라이드·프로토타입·설문을 오갈 수 있음.
 */
(() => {
  // 안내 슬라이드 이미지 (순서대로). 비어 있으면 슬라이드 없이 바로 프로토타입이 시작됨.
  const SLIDES = window.INTRO_SLIDES || [];
  const STORE_KEY = 'kakaoBikeSurveyResponses';

  const LIKERT_SECTIONS = [
    ['A', '이해도', [
      'A1. 이 화면이 어떤 상황(시간에 쫓겨 반납 구역을 찾아 반납할 때)에서 쓰이는지 이해했다.',
      'A2. 각 화면에서 다음에 무엇을 해야 하는지 알 수 있었다.',
      'A3. 목적지 핀의 역할이 무엇인지 바로 알 수 있었다.',
      'A4. 길안내 카드가 빨갛게 바뀐 이유를 바로 알 수 있었다.'
    ]],
    ['B', '디자인', [
      'B1. 반납 가능 구역과 아닌 구역이 명확하게 구분되어 보였다.',
      'B2. 이용 중 화면의 타이머, 안내, 도착 예정 시각, 요금이 한눈에 들어왔다.',
      'B3. 상단바의 크기와 위치가 정보를 확인하기에 적절했다.',
      'B4. 서비스 불가 구역 경고가 눈에 잘 띄었다.',
      'B5. 화면이 복잡하지 않고 필요한 정보만 보였다.'
    ]],
    ['C', '사용성', [
      'C1. 과업을 완료하는 데 어려움이 없었다.',
      'C2. 목적지 입력부터 대여까지 조작 과정이 단순했다.',
      'C3. 반납 구역을 확인하는 과정에 어려움이 없었다.',
      'C4. 선택한 반납 구역으로 길안내가 설정되었다는 것을 확인할 수 있었다.',
      'C5. 반납 구역을 잘못 알고 반납할 가능성이 낮다고 느꼈다.'
    ]],
    ['D', '상황적 제약', [
      'D1. 화면을 확인하는 데 드는 시간이 부담스럽지 않았다.',
      'D2. 정보를 확인하려고 화면을 오래 보거나 여러 번 다시 볼 필요가 적었다.',
      'D3. 신호 대기 등 멈춰 있는 동안 짧게 확인하는 방식으로 사용할 수 있을 것 같다.',
      'D4. 시간이 급한 상황(수업 지각 등)에서도 반납 구역을 빠르게 확인할 수 있을 것 같다.',
      'D5. 실제로 자전거를 타면서도 쓸 수 있을 것 같다.'
    ]]
  ];
  const BASIC = [
    ['frequency', '카카오 T 바이크 이용 빈도', ['주 3회 이상', '주 1~2회', '월 1~3회', '월 1회 미만']],
    ['fare_uncertainty', '예상 요금을 알 수 없어서 카카오 T 바이크 이용을 망설이거나 다른 이동 수단을 고른 적이 있나요?', ['자주 있다', '가끔 있다', '거의 없다', '전혀 없다']]
  ];
  const LIKERT_IDS = LIKERT_SECTIONS.flatMap(([, , items]) => items.map(text => text.split('.')[0]));
  const REQUIRED = [...BASIC.map(([id]) => id), ...LIKERT_IDS];

  const phone = document.getElementById('phone');
  const scenario = document.getElementById('scenario');
  const controls = document.querySelector('.controls');
  let prototypeStartedAt = 0;
  let participant = '';
  let lastSlide = 0;
  let closeDeck = null;

  /* ---------- 참여자 이름 ---------- */
  function askName(then) {
    const box = document.createElement('div');
    box.className = 'flow-start';
    box.innerHTML = `<form class="flow-start-card" novalidate>
      <h1>사용성 테스트를 시작할게요</h1>
      <p>기록에 쓸 이름이나 닉네임을 적어 주세요.</p>
      <input name="name" type="text" maxlength="30" autocomplete="off" placeholder="예: 소영, 참여자3" aria-label="이름 또는 닉네임">
      <small class="flow-start-error" hidden>이름이나 닉네임을 적어 주세요.</small>
      <button type="submit">시작하기</button>
    </form>`;
    document.body.append(box);
    const form = box.querySelector('form');
    const input = form.querySelector('input');
    setTimeout(() => input.focus(), 50);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { form.querySelector('.flow-start-error').hidden = false; input.focus(); return; }
      participant = name;
      window.kakaoBikeParticipant = name;
      window.dispatchEvent(new CustomEvent('kakaobike:participant', { detail: name }));
      box.remove();
      then();
    });
  }

  /* ---------- 안내 슬라이드 ---------- */
  function showIntro(startAt = lastSlide) {
    if (!SLIDES.length || document.querySelector('.intro-deck')) return;
    let index = Math.min(Math.max(0, startAt), SLIDES.length - 1);
    const deck = document.createElement('div');
    deck.className = 'intro-deck';
    deck.setAttribute('role', 'dialog');
    deck.setAttribute('aria-label', '테스트 안내');
    deck.innerHTML = `<img alt=""><div class="intro-prev" aria-label="이전 장"></div>
      <div class="intro-hint"><span class="intro-dots">${SLIDES.map(() => '<i></i>').join('')}</span><span class="intro-label"></span></div>`;
    document.body.append(deck);
    // 미리 불러와서 넘길 때 깜빡이지 않게
    SLIDES.forEach(src => { const img = new Image(); img.src = src; });
    const paint = () => {
      lastSlide = index;
      deck.querySelector('img').src = SLIDES[index];
      deck.querySelectorAll('.intro-dots i').forEach((dot, i) => dot.classList.toggle('on', i === index));
      deck.querySelector('.intro-label').textContent = index === SLIDES.length - 1 ? '터치하면 프로토타입을 시작해요' : '터치하면 다음 장으로';
    };
    const close = () => {
      deck.remove();
      document.removeEventListener('keydown', onKey);
      closeDeck = null;
      if (!prototypeStartedAt) prototypeStartedAt = Date.now();
      paintNav();
    };
    closeDeck = close;
    const next = () => { if (index < SLIDES.length - 1) { index++; paint(); } else close(); };
    const prev = () => { if (index > 0) { index--; paint(); } };
    const onKey = event => {
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(event.key)) { event.preventDefault(); next(); }
      if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); prev(); }
    };
    deck.addEventListener('click', event => (event.target.classList.contains('intro-prev') ? prev() : next()));
    document.addEventListener('keydown', onKey);
    paint();
  }

  /* ---------- 설문으로 넘어가기 ---------- */
  let cta;
  let surveyInvite;
  let ctaUnlocked = false;
  function showCta() {
    if (cta || surveyInvite?.open || document.querySelector('.survey:not([hidden])')) return;
    cta = document.createElement('div');
    cta.className = 'survey-cta';
    cta.innerHTML = '<span>체험 후 설문은 약 3분 정도 소요돼요.</span><button type="button">설문 시작하기</button>';
    cta.querySelector('button').onclick = openSurvey;
    document.body.append(cta);
  }
  function hideCta() { cta?.remove(); cta = null; }
  function showSurveyInvite() {
    if (phone.dataset.stage !== 'done') return;
    ctaUnlocked = true;
    hideCta();
    if (!surveyInvite) {
      surveyInvite = document.createElement('dialog');
      surveyInvite.className = 'survey-invite';
      surveyInvite.setAttribute('aria-labelledby', 'surveyInviteTitle');
      surveyInvite.setAttribute('aria-describedby', 'surveyInviteDescription');
      surveyInvite.innerHTML = `<h2 id="surveyInviteTitle">설문으로 넘어가시겠어요?</h2>
        <p id="surveyInviteDescription">체험해 주셔서 감사해요.<br>설문은 약 3분 정도 소요돼요.</p>
        <div class="survey-invite-actions"><button type="button" data-act="later">완료 화면 보기</button>
        <button type="button" data-act="survey" autofocus>설문 시작하기</button></div>`;
      surveyInvite.querySelector('[data-act="later"]').onclick = () => surveyInvite.close();
      surveyInvite.querySelector('[data-act="survey"]').onclick = openSurvey;
      surveyInvite.addEventListener('close', syncCta);
      document.body.append(surveyInvite);
    }
    if (!surveyInvite.open) surveyInvite.showModal();
  }
  window.addEventListener('kakaobike:complete', showSurveyInvite);
  function syncCta() {
    const onPrototype = !document.querySelector('.survey:not([hidden])') && !document.querySelector('.intro-deck');
    if (ctaUnlocked && onPrototype && phone.dataset.stage !== 'done') showCta(); else hideCta();
  }

  /* ---------- 설문 ---------- */
  const esc = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function choiceGroup(name, options, cls = '') {
    return `<div class="choices ${cls}" role="radiogroup">${options.map(([value, label]) =>
      `<label><input type="radio" name="${name}" value="${esc(value)}"><span>${esc(label)}</span></label>`).join('')}</div>`;
  }
  function hideSurvey() {
    const existing = document.querySelector('.survey');
    if (existing) existing.hidden = true;
  }
  function openSurvey() {
    if (surveyInvite?.open) surveyInvite.close();
    hideCta();
    closeDeck?.();
    const existing = document.querySelector('.survey');
    if (existing) { existing.hidden = false; paintNav(); return; }
    const root = document.createElement('div');
    root.className = 'survey';
    root.innerHTML = `
      <div class="survey-progress"><div class="bar"><i></i></div><b class="count"></b></div>
      <form class="survey-body" novalidate>
        <h1>사용성 테스트 후 설문지</h1>
        <p class="survey-lead">약 3분 정도 소요돼요. 방금 체험한 프로토타입에 대해 느낀 대로 답해 주세요. 정답은 없어요.</p>
        <p class="survey-scale">A~D 문항: 1 전혀 그렇지 않다 · 2 그렇지 않다 · 3 보통이다 · 4 그렇다 · 5 매우 그렇다</p>
        <section><h2>기본 질문</h2>${BASIC.map(([id, title, options]) => `
          <div class="q" data-q="${id}"><p class="q-title">${esc(title)}</p>${choiceGroup(id, options.map(o => [o, o]))}</div>`).join('')}
        </section>
        ${LIKERT_SECTIONS.map(([letter, title, items]) => `<section><h2>${letter}. ${title}</h2>${items.map(text => {
          const id = text.split('.')[0];
          return `<div class="q" data-q="${id}"><p class="q-title"><small>${id}</small>${esc(text.slice(id.length + 2))}</p>
            ${choiceGroup(id, [1, 2, 3, 4, 5].map(n => [String(n), String(n)]), 'likert')}
            <div class="likert-ends"><span>전혀 그렇지 않다</span><span>매우 그렇다</span></div></div>`;
        }).join('')}</section>`).join('')}
        <section><h2>E. 개방형</h2>
          <div class="q" data-q="E1"><p class="q-title"><small>E1</small>가장 불편하거나 이해하기 어려웠던 부분은 무엇이었나요? 이유도 함께 적어주세요.</p>
          <textarea name="E1" placeholder="자유롭게 적어 주세요 (선택)"></textarea></div>
        </section>
        <div class="survey-submit"><button type="submit" aria-disabled="true">제출하기</button></div>
      </form>`;
    document.body.append(root);
    const form = root.querySelector('form');
    const update = () => {
      const data = new FormData(form);
      const done = REQUIRED.filter(id => data.get(id)).length;
      root.querySelector('.bar i').style.width = done / REQUIRED.length * 100 + '%';
      root.querySelector('.count').textContent = `${done} / ${REQUIRED.length}`;
      root.querySelector('.survey-submit button').setAttribute('aria-disabled', String(done < REQUIRED.length));
      for (const id of REQUIRED) if (data.get(id)) form.querySelector(`[data-q="${id}"]`).classList.remove('missing');
    };
    form.addEventListener('change', update);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      const missing = REQUIRED.filter(id => !data.get(id));
      if (missing.length) {
        missing.forEach(id => form.querySelector(`[data-q="${id}"]`).classList.add('missing'));
        form.querySelector(`[data-q="${missing[0]}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const response = {
        submitted_at: new Date().toISOString(),
        scenario: scenario ? scenario.options[scenario.selectedIndex].text : '',
        participant,
        prototype_minutes: prototypeStartedAt ? ((Date.now() - prototypeStartedAt) / 60000).toFixed(1) : '',
        analytics_session: window.kakaoBikeAnalytics ? window.kakaoBikeAnalytics.id : ''
      };
      for (const id of [...REQUIRED, 'E1']) response[id] = (data.get(id) || '').toString().trim();
      const all = readAll();
      all.push(response);
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
      // 구글 스프레드시트로 자동 전송 (analytics.js)
      try { window.kakaoBikeSync?.('survey', response); } catch { /* 전송 실패해도 이 기기에는 저장됨 */ }
      paintExportCount();
      showThanks(root, all.length);
    });
    update();
    root.scrollTop = 0;
    paintNav();
  }
  function showThanks(root, count) {
    root.innerHTML = `<div class="survey-done"><div>
      <h1>참여해 주셔서 감사합니다!</h1>
      <p>응답이 저장되었어요. 진행자에게 기기를 돌려주세요.</p>
      <div class="row"><button class="primary" type="button" data-act="next">다음 참여자 시작</button>
      <button type="button" data-act="csv">응답 CSV 내려받기 (${count}건)</button></div></div></div>`;
    root.querySelector('[data-act="next"]').onclick = () => location.reload();
    root.querySelector('[data-act="csv"]').onclick = downloadCsv;
  }

  /* ---------- 응답 내보내기 ---------- */
  function readAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  }
  function downloadCsv() {
    const rows = readAll();
    const headers = ['submitted_at', 'participant', 'scenario', 'prototype_minutes', 'analytics_session', ...REQUIRED, 'E1'];
    const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kakao-bike-survey_${new Date().toISOString().slice(0, 10)}_${rows.length}건.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- 진행자용 버튼 (왼쪽 테스트 설정 패널) ---------- */
  let exportButton;
  function paintExportCount() { if (exportButton) exportButton.textContent = `설문 응답 CSV (${readAll().length}건)`; }
  if (controls) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'reset survey-open';
    open.textContent = '설문으로 이동';
    open.onclick = openSurvey;
    exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'reset survey-open';
    exportButton.onclick = downloadCsv;
    controls.append(open, exportButton);
    paintExportCount();
  }

  /* ---------- 상단 진행바 (단계 이동) ---------- */
  const STEPS = [['intro', '안내 슬라이드'], ['proto', '프로토타입'], ['survey', '설문']].filter(([key]) => key !== 'intro' || SLIDES.length);
  const nav = document.createElement('nav');
  nav.className = 'flow-nav';
  nav.setAttribute('aria-label', '테스트 진행 단계');
  nav.innerHTML = `<div class="flow-steps">${STEPS.map(([key, label], i) =>
    `<button type="button" data-step="${key}"><span class="flow-dot">${i + 1}</span><span class="flow-label">${label}<em></em></span></button>`).join('<span class="flow-link" aria-hidden="true"></span>')}</div>
    <div class="flow-track" aria-hidden="true"><i></i></div>`;
  nav.hidden = true;
  document.body.append(nav);
  let protoDone = false;
  function currentStep() {
    if (document.querySelector('.survey:not([hidden])')) return 'survey';
    if (document.querySelector('.intro-deck')) return 'intro';
    return 'proto';
  }
  function surveyProgress() {
    const form = document.querySelector('.survey form');
    if (document.querySelector('.survey-done')) return [REQUIRED.length, REQUIRED.length];
    if (!form) return [0, REQUIRED.length];
    const data = new FormData(form);
    return [REQUIRED.filter(id => data.get(id)).length, REQUIRED.length];
  }
  function paintNav() {
    const step = currentStep();
    if (phone.dataset.stage === 'done') protoDone = true;
    const at = STEPS.findIndex(([key]) => key === step);
    const [answered, total] = surveyProgress();
    const sub = {
      intro: `${lastSlide + 1}/${SLIDES.length}`,
      proto: protoDone ? '완료' : '',
      survey: document.querySelector('.survey-done') ? '제출 완료' : `${answered}/${total}`
    };
    nav.querySelectorAll('[data-step]').forEach((button, i) => {
      button.dataset.state = i < at ? 'done' : i === at ? 'current' : 'next';
      button.setAttribute('aria-current', String(i === at));
      button.querySelector('em').textContent = sub[button.dataset.step] ? ' ' + sub[button.dataset.step] : '';
    });
    nav.querySelectorAll('.flow-link').forEach((link, i) => link.classList.toggle('on', i < at));
    const part = step === 'intro' ? (lastSlide + 1) / SLIDES.length : step === 'proto' ? (protoDone ? 1 : 0.5) : answered / total;
    nav.querySelector('.flow-track i').style.width = Math.min(100, (at + part) / STEPS.length * 100) + '%';
  }
  function goTo(step) {
    if (step === 'intro') { hideSurvey(); hideCta(); showIntro(); }
    if (step === 'proto') { closeDeck?.(); hideSurvey(); }
    if (step === 'survey') openSurvey();
    paintNav();
  }
  // 슬라이드를 넘길 때 페이지 전체 클릭으로 처리되지 않도록 막음
  nav.addEventListener('click', event => {
    event.stopPropagation();
    const button = event.target.closest('[data-step]');
    if (button) goTo(button.dataset.step);
  });
  setInterval(() => { paintNav(); syncCta(); }, 400);

  askName(() => {
    nav.hidden = false;
    document.body.classList.add('has-flow-bar');
    if (SLIDES.length) showIntro(0);
    else prototypeStartedAt = Date.now();
    paintNav();
  });
})();
