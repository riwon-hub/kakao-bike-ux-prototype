/* 사용 분석 리포트: analytics.js 가 이 기기에 저장한 기록을 화면별·참여자별로 정리 */
{
  const KEY = 'kakaoBikeAnalytics';
  const SHOT_KEY = 'kakaoBikeAnalyticsShots';
  const OFF_KEY = 'kakaoBikeAnalyticsExcluded';
  const W = 402, H = 874;
  const ORDER = ['slide1', 'slide2', 'slide3', 'slide4', 'slide5', 'home', 'search', 'zone', 'pick', 'scan', 'ride', 'ride_warning', 'penalty', 'arrived', 'camera', 'photo', 'pay', 'done', 'survey'];
  const NAMES = {
    slide1: '안내 슬라이드 1', slide2: '안내 슬라이드 2', slide3: '안내 슬라이드 3', slide4: '안내 슬라이드 4', slide5: '안내 슬라이드 5',
    home: '홈', search: '목적지 검색', zone: '반납 구역 선택', pick: '바이크 선택', scan: 'QR 스캔', ride: '주행 중',
    ride_warning: '주행 중 (경고)', penalty: '과태료 안내 창', arrived: '도착', camera: '반납 사진 촬영', photo: '사진 확인',
    pay: '결제', done: '반납 완료', survey: '설문'
  };
  // 머문 시간이 애니메이션·읽기 속도로 정해지는 화면은 '막힘' 판단에서 뺌
  const NO_STUCK = new Set(['ride', 'ride_warning', 'survey', 'done', 'slide1', 'slide2', 'slide3', 'slide4', 'slide5']);
  const FUNNEL = ['home', 'search', 'zone', 'pick', 'scan', 'ride', 'arrived', 'camera', 'photo', 'pay', 'done'];
  const KIND = { ok: ['정상 클릭', '#16a34a'], dead: ['빈 곳 클릭', '#e11d48'], disabled: ['비활성 버튼', '#9ca3af'], back: ['뒤로가기', '#f59e0b'], blocked: ['막힌 기능', '#0ea5e9'] };
  const MISS = new Set(['dead', 'disabled', 'blocked']);

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const sec = ms => ms == null ? '-' : (ms / 1000).toFixed(1) + '초';
  const median = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '-';
  const name = key => NAMES[key] || key;
  const order = key => { const i = ORDER.indexOf(key); return i < 0 ? 99 : i; };

  let heatMode = 'heat';

  function load() {
    const sessions = read(KEY, []).sort((a, b) => a.started_at.localeCompare(b.started_at));
    sessions.forEach((s, i) => { s.label = 'P' + (i + 1); });
    const off = new Set(read(OFF_KEY, []));
    return { all: sessions, used: sessions.filter(s => !off.has(s.id)), off, shots: read(SHOT_KEY, {}) };
  }
  function dwellBy(s) {
    const out = {};
    for (const v of s.visits) {
      const ms = v.ms ?? (v.leave ?? v.enter) - v.enter;
      out[v.key] = (out[v.key] || 0) + Math.max(0, ms);
    }
    return out;
  }
  const taskMs = s => s.done_at != null && s.prototype_start != null ? s.done_at - s.prototype_start : null;

  function analyse(sessions) {
    const screens = {};
    const get = key => screens[key] ||= { key, reached: 0, dwell: [], visits: 0, clicks: [], stuck: 0, rage: 0 };
    for (const s of sessions) {
      const d = dwellBy(s);
      for (const [key, ms] of Object.entries(d)) { const x = get(key); x.reached++; x.dwell.push(ms); }
      for (const v of s.visits) get(v.key).visits++;
      for (const c of s.clicks) get(c.screen).clicks.push({ ...c, who: s.label });
      for (const e of s.events) if (e.type === 'rage') get(e.screen).rage++;
    }
    for (const x of Object.values(screens)) {
      x.median = median(x.dwell);
      x.mean = mean(x.dwell);
      x.max = x.dwell.length ? Math.max(...x.dwell) : null;
      x.limit = Math.max(10000, (x.median || 0) * 2);
      if (!NO_STUCK.has(x.key)) x.stuck = x.dwell.filter(ms => ms > x.limit).length;
      x.miss = x.clicks.filter(c => MISS.has(c.kind)).length;
      x.back = x.clicks.filter(c => c.kind === 'back').length;
      x.revisit = Math.max(0, x.visits - x.reached);
    }
    return Object.values(screens).sort((a, b) => order(a.key) - order(b.key));
  }

  /* ---------- 그리기 ---------- */
  function render() {
    const { all, used, off, shots } = load();
    $('sub').textContent = `이 기기에 저장된 참여자 ${all.length}명` + (off.size ? ` · 분석 제외 ${all.length - used.length}명` : '') + ' · 다른 기기 기록은 「가져오기」로 합칠 수 있어요';
    const main = $('main');
    if (!all.length) {
      main.innerHTML = '<section class="empty">아직 기록이 없어요. 프로토타입을 한 번 진행하면 여기에 쌓여요.</section>';
      return;
    }
    const screens = analyse(used);
    const tasks = used.map(taskMs).filter(v => v != null);
    const clicks = used.flatMap(s => s.clicks);
    const misses = clicks.filter(c => MISS.has(c.kind)).length;
    const stuckTotal = screens.reduce((a, x) => a + x.stuck, 0);
    const restarts = used.reduce((a, s) => a + s.events.filter(e => e.type === 'restart').length, 0);
    const completed = used.filter(s => s.done_at != null).length;

    main.innerHTML = `
      <section>
        <h2>한눈에 보기</h2>
        <div class="kpis">
          <div class="kpi"><span>분석 참여자</span><b>${used.length}명</b><small>설문 제출 ${used.filter(s => s.survey_submitted).length}명</small></div>
          <div class="kpi"><span>과업 완료율</span><b>${pct(completed, used.length)}</b><small>반납 완료까지 도달 ${completed}명</small></div>
          <div class="kpi"><span>과업 시간 (중앙값)</span><b>${sec(median(tasks))}</b><small>홈 → 반납 완료 · 평균 ${sec(mean(tasks))}</small></div>
          <div class="kpi"><span>잘못 누른 클릭</span><b>${misses}회</b><small>전체 클릭 ${clicks.length}회 중 ${pct(misses, clicks.length)}</small></div>
          <div class="kpi"><span>막힘 의심</span><b>${stuckTotal}건</b><small>오래 머묾 기준 · 처음부터 다시 ${restarts}회</small></div>
        </div>
        <p class="note">잘못 누른 클릭 = 아무 기능 없는 곳(빈 곳) + 비활성 버튼 + 눌러도 안내만 뜨는 막힌 기능. 막힘 의심 = 한 화면에 10초 또는 그 화면 중앙값의 2배보다 오래 머문 경우 (주행·슬라이드·설문 화면 제외).</p>
      </section>
      <section>
        <h2>과업 흐름 (어디까지 갔나)</h2>
        <div class="funnel">${FUNNEL.map(key => {
          const x = screens.find(s => s.key === key); const n = x ? x.reached : 0;
          return `<div class="frow"><span>${esc(name(key))}</span><div class="fbar"><i style="width:${used.length ? n / used.length * 100 : 0}%"></i></div><span class="n">${n}명 · ${pct(n, used.length)}</span></div>`;
        }).join('')}</div>
      </section>
      <section>
        <h2>화면별 체류 시간 · 클릭</h2>
        <div class="scroll"><table>
          <thead><tr><th>화면</th><th class="n">도달</th><th class="n">머문 시간 중앙값</th><th class="n">평균</th><th class="n">최대</th><th class="n">재방문</th><th class="n">1인당 클릭</th><th class="n">잘못 누름</th><th class="n">뒤로가기</th><th class="n">연타</th><th>막힘 의심</th></tr></thead>
          <tbody>${screens.map(x => `<tr>
            <td>${esc(name(x.key))}</td><td class="n">${x.reached}명</td><td class="n">${sec(x.median)}</td><td class="n">${sec(x.mean)}</td><td class="n">${sec(x.max)}</td>
            <td class="n">${x.revisit}</td><td class="n">${x.reached ? (x.clicks.length / x.reached).toFixed(1) : '-'}</td>
            <td class="n">${x.miss} <small>(${pct(x.miss, x.clicks.length)})</small></td><td class="n">${x.back}</td><td class="n">${x.rage}</td>
            <td>${NO_STUCK.has(x.key) ? '<small>해당 없음</small>' : x.stuck ? `<span class="flag warn">${x.stuck}명</span>` : '<span class="flag good">없음</span>'}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="note">주행 중 화면의 머문 시간은 주행 애니메이션 길이로 정해져요. 안내 슬라이드 시간은 읽는 시간이에요.</p>
      </section>
      <section>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h2 style="margin:0">화면별 클릭 지도</h2>
          <div class="seg"><button data-mode="heat" aria-pressed="${heatMode === 'heat'}">히트맵</button><button data-mode="dots" aria-pressed="${heatMode === 'dots'}">클릭 점</button></div>
        </div>
        <div class="legend">${Object.values(KIND).map(([label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('')}</div>
        <div class="grid" style="margin-top:14px">${screens.filter(x => !x.key.startsWith('slide') && x.key !== 'survey').map(x => screenCard(x, used.length)).join('')}</div>
      </section>
      <section>
        <h2>참여자별 기록</h2>
        <div class="scroll"><table>
          <thead><tr><th>분석 포함</th><th>참여자</th><th>시작</th><th>시나리오</th><th>완료</th><th class="n">과업 시간</th><th class="n">클릭</th><th class="n">잘못 누름</th><th class="n">뒤로</th><th class="n">처음부터</th><th>지나간 화면</th><th></th></tr></thead>
          <tbody>${all.map(s => {
            const miss = s.clicks.filter(c => MISS.has(c.kind)).length;
            const path = s.visits.filter(v => !v.key.startsWith('slide')).map(v => name(v.key)).filter((k, i, a) => k !== a[i - 1]).join(' → ');
            return `<tr class="${off.has(s.id) ? 'off' : ''}">
              <td><input type="checkbox" data-include="${esc(s.id)}" ${off.has(s.id) ? '' : 'checked'} aria-label="${esc(s.label)} 분석 포함"></td>
              <td><b>${esc(s.label)}</b></td><td>${esc(new Date(s.started_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td>
              <td>${esc(s.scenario)}</td><td>${s.done_at != null ? '<span class="flag good">완료</span>' : '<span class="flag warn">미완료</span>'}</td>
              <td class="n">${sec(taskMs(s))}</td><td class="n">${s.clicks.length}</td><td class="n">${miss}</td><td class="n">${s.clicks.filter(c => c.kind === 'back').length}</td>
              <td class="n">${s.events.filter(e => e.type === 'restart').length}</td><td class="path">${esc(path)}</td>
              <td><button data-delete="${esc(s.id)}">삭제</button></td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="note">진행자가 미리 눌러본 기록 같은 건 체크를 풀면 분석에서 빠져요.</p>
      </section>`;

    main.querySelectorAll('canvas[data-screen]').forEach(canvas => drawMap(canvas, screens.find(x => x.key === canvas.dataset.screen), shots[canvas.dataset.screen]));
    main.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { heatMode = b.dataset.mode; render(); });
    main.querySelectorAll('[data-include]').forEach(box => box.onchange = () => {
      const set = new Set(read(OFF_KEY, []));
      box.checked ? set.delete(box.dataset.include) : set.add(box.dataset.include);
      write(OFF_KEY, [...set]);
      render();
    });
    main.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => {
      if (b.dataset.armed) {
        write(KEY, read(KEY, []).filter(s => s.id !== b.dataset.delete));
        render();
      } else { b.dataset.armed = '1'; b.textContent = '한 번 더 눌러 삭제'; b.classList.add('danger'); }
    });
  }

  function screenCard(x, people) {
    const count = (list, keyFn) => {
      const map = new Map();
      for (const c of list) { const k = keyFn(c); const e = map.get(k) || { n: 0, who: new Set() }; e.n++; e.who.add(c.who); map.set(k, e); }
      return [...map.entries()].sort((a, b) => b[1].n - a[1].n);
    };
    const good = count(x.clicks.filter(c => c.kind === 'ok' || c.kind === 'back'), c => c.label);
    const bad = count(x.clicks.filter(c => MISS.has(c.kind)), c => c.kind === 'blocked' ? `${c.label} → "${c.toast || '안내'}"` : c.kind === 'disabled' ? `${c.label} (비활성)` : `빈 곳 (${c.label})`);
    const li = rows => rows.slice(0, 6).map(([label, e]) => `<li><span title="${esc(label)}">${esc(label)}</span><b>${e.n}회 · ${pct(e.who.size, x.reached)}</b></li>`).join('');
    return `<div class="screen">
      <div><h3>${esc(name(x.key))}</h3><div class="meta">${x.reached}명 도달 · 머문 시간 중앙값 ${sec(x.median)} · 클릭 ${x.clicks.length}회</div></div>
      <canvas data-screen="${esc(x.key)}" width="${W}" height="${H}" aria-label="${esc(name(x.key))} 클릭 지도"></canvas>
      ${good.length ? `<div><div class="meta">많이 누른 곳 (횟수 · 누른 사람 비율)</div><ul class="list">${li(good)}</ul></div>` : ''}
      ${bad.length ? `<div><div class="meta">잘못 누른 곳</div><ul class="list bad">${li(bad)}</ul></div>` : ''}
    </div>`;
  }

  function drawMap(canvas, x, shot) {
    const ctx = canvas.getContext('2d');
    const paint = () => {
      if (heatMode === 'heat' && x.clicks.length) {
        const heat = document.createElement('canvas');
        heat.width = W; heat.height = H;
        const h = heat.getContext('2d');
        for (const c of x.clicks) {
          const g = h.createRadialGradient(c.x, c.y, 0, c.x, c.y, 34);
          g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          h.fillStyle = g; h.fillRect(c.x - 34, c.y - 34, 68, 68);
        }
        const img = h.getImageData(0, 0, W, H);
        let peak = 0;
        for (let i = 3; i < img.data.length; i += 4) peak = Math.max(peak, img.data[i]);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = img.data[i + 3] / (peak || 1);
          if (v < 0.04) { img.data[i + 3] = 0; continue; }
          // 파랑 → 초록 → 노랑 → 빨강
          const r = v < .5 ? 0 : Math.min(255, (v - .5) * 2 * 255 + 60), gg = v < .5 ? v * 2 * 255 : 255 - (v - .5) * 2 * 200, b = v < .35 ? 255 - v * 500 : 0;
          img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = Math.max(0, b); img.data[i + 3] = Math.min(200, 60 + v * 170);
        }
        h.putImageData(img, 0, 0);
        ctx.drawImage(heat, 0, 0);
      }
      for (const c of x.clicks) {
        if (heatMode === 'heat' && c.kind === 'ok') continue;
        ctx.beginPath(); ctx.arc(c.x, c.y, heatMode === 'heat' ? 6 : 8, 0, Math.PI * 2);
        ctx.fillStyle = KIND[c.kind]?.[1] || '#111'; ctx.globalAlpha = .85; ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
    };
    ctx.fillStyle = '#eceef2'; ctx.fillRect(0, 0, W, H);
    if (shot) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, W, H); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, 0, W, H); paint(); };
      img.onerror = paint;
      img.src = shot;
    } else {
      ctx.fillStyle = '#6b7280'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('화면 캡처 없음', W / 2, H / 2);
      paint();
    }
  }

  /* ---------- 내보내기 · 가져오기 ---------- */
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = (headers, rows) => '﻿' + [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');

  $('exportJson').onclick = () => {
    const data = { app: 'kakao-bike-analytics', exported_at: new Date().toISOString(), sessions: read(KEY, []), shots: read(SHOT_KEY, {}) };
    download(`kakao-bike-analytics_${stamp()}_${data.sessions.length}명.json`, JSON.stringify(data), 'application/json');
  };
  $('importJson').onchange = async event => {
    const sessions = read(KEY, []), shots = read(SHOT_KEY, {});
    const ids = new Set(sessions.map(s => s.id));
    let added = 0;
    for (const file of event.target.files) {
      try {
        const data = JSON.parse(await file.text());
        for (const s of data.sessions || []) if (s && s.id && !ids.has(s.id)) { sessions.push(s); ids.add(s.id); added++; }
        for (const [k, v] of Object.entries(data.shots || {})) if (!shots[k] && typeof v === 'string' && v.startsWith('data:image/')) shots[k] = v;
      } catch { /* 형식이 다른 파일은 건너뜀 */ }
    }
    write(KEY, sessions);
    try { write(SHOT_KEY, shots); } catch { /* 용량 초과 시 캡처는 생략 */ }
    event.target.value = '';
    render();
    $('sub').textContent += ` · 새 기록 ${added}명 가져옴`;
  };
  $('csvScreens').onclick = () => {
    const screens = analyse(load().used);
    download(`kakao-bike-화면별요약_${stamp()}.csv`, csv(
      ['화면', '도달(명)', '머문시간_중앙값(초)', '평균(초)', '최대(초)', '재방문', '클릭', '잘못누름', '뒤로가기', '연타', '막힘의심(명)'],
      screens.map(x => [name(x.key), x.reached, (x.median / 1000).toFixed(1), (x.mean / 1000).toFixed(1), (x.max / 1000).toFixed(1), x.revisit, x.clicks.length, x.miss, x.back, x.rage, NO_STUCK.has(x.key) ? '' : x.stuck])
    ), 'text/csv');
  };
  $('csvClicks').onclick = () => {
    const { used } = load();
    download(`kakao-bike-클릭원본_${stamp()}.csv`, csv(
      ['참여자', '세션ID', '시각(초)', '화면', '종류', '누른 것', 'x', 'y', '이동한 화면', '뜬 안내'],
      used.flatMap(s => s.clicks.map(c => [s.label, s.id, (c.t / 1000).toFixed(2), name(c.screen), KIND[c.kind]?.[0] || c.kind, c.label, c.x, c.y, c.to ? name(c.to) : '', c.toast || '']))
    ), 'text/csv');
  };
  $('csvSessions').onclick = () => {
    const { used } = load();
    const keys = ORDER.filter(k => used.some(s => s.visits.some(v => v.key === k)));
    download(`kakao-bike-참여자별_${stamp()}.csv`, csv(
      ['참여자', '세션ID', '시작', '시나리오', '완료', '과업시간(초)', '클릭', '잘못누름', '뒤로가기', '처음부터', '설문제출', ...keys.map(k => name(k) + '(초)')],
      used.map(s => {
        const d = dwellBy(s);
        return [s.label, s.id, s.started_at, s.scenario, s.done_at != null ? 'Y' : 'N', taskMs(s) == null ? '' : (taskMs(s) / 1000).toFixed(1), s.clicks.length,
          s.clicks.filter(c => MISS.has(c.kind)).length, s.clicks.filter(c => c.kind === 'back').length, s.events.filter(e => e.type === 'restart').length,
          s.survey_submitted ? 'Y' : 'N', ...keys.map(k => d[k] == null ? '' : (d[k] / 1000).toFixed(1))];
      })
    ), 'text/csv');
  };
  $('clear').onclick = () => $('confirm').classList.add('on');
  $('clearNo').onclick = () => $('confirm').classList.remove('on');
  $('clearYes').onclick = () => {
    localStorage.removeItem(KEY); localStorage.removeItem(SHOT_KEY); localStorage.removeItem(OFF_KEY);
    $('confirm').classList.remove('on');
    render();
  };
  addEventListener('storage', render);
  render();
}
