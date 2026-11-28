const embeddedImages = {"arrival-img01BrailleBlock1.svg": "assets/arrival-img01BrailleBlock1.svg", "arrival-img02SubwayEntrance1.svg": "assets/arrival-img02SubwayEntrance1.svg", "arrival-img03Crosswalk1.svg": "assets/arrival-img03Crosswalk1.svg", "arrival-img04BusTaxiStop1.svg": "assets/arrival-img04BusTaxiStop1.svg", "arrival-img05Road1.svg": "assets/arrival-img05Road1.svg", "arrival-img06Elevator1.svg": "assets/arrival-img06Elevator1.svg", "pick-imgImage95.png": "assets/home-imgImage98.png", "pick-imgImage96.png": "assets/pick-imgImage96.png", "pick-imgImage98.png": "assets/pick-imgImage98.png"};
'use strict';
const byId = id => document.getElementById(id);
const phone = byId('phone');
const mobileViewport = matchMedia('(max-width:700px), (max-width:1000px) and (pointer:coarse)');
if(mobileViewport.matches) byId('scenario').value='restricted';
const picker = byId('picker');
const overlay = byId('overlay');
const dialog = byId('penalty');
const mapWorld = byId('mapWorld');
const rider = byId('rider');
const arrivalBike = byId('arrivalBike');
const ridingImage = rider.getAttribute('src');
const arrivalImage = 'assets/exactdone-imgImage89.png';
const arrivalPose = new Image();
arrivalPose.src = arrivalImage;
const rideMeter = byId('rideMeter');
const meterProgress = byId('meterProgress');
const meterText = byId('meterText');
const meterPrice = byId('meterPrice');
const routeCasing = byId('routeCasing');
const routePast = byId('routePast');
const routeArrows = byId('routeArrows');
const navigationLine = byId('navigationLine');
const cycleLine = byId('cycleLine');
const bikes = [
  { id:'NN4815', minutes:190, walk:2, meters:150, img:'pick-imgImage95.png', x:191, y:206, brand:'T',
    approach:'M201 278 L202 264 L191 258 V234', badge:[292,275] },
  { id:'NN4821', minutes:156, walk:3, meters:225, img:'pick-imgImage96.png', x:62, y:158, brand:'T',
    approach:'M201 278 L202 264 L118 268 Q92 263 75 246 L62 206 V186', badge:[300,300] },
  { id:'JA3896', minutes:120, walk:5, meters:375, img:'pick-imgImage98.png', x:250, y:134, brand:'G',
    approach:'M201 278 L242 266 L290 242 Q304 231 300 208 L289 170 269 152', badge:[110,300] }
];
const normalRoute = [[204,574],[204,474],[168,474],[168,439],[168,349],[168,265],[199,265]];
byId('rideScenery').dataset.route=JSON.stringify(normalRoute);
const departureIndex = 2;
const deviationRoute = [...normalRoute.slice(0,departureIndex+1),[112,474],[112,394]];
const recoveryWaypoints = [[146,382],[175,369],[201,341],[199,265]];
const normalRideDuration = 28000;
const deviationDuration = 15500;
const recoveryDuration = 10000;
const rideMetersPerUnit = .78;
const turnThreshold = 25 * Math.PI / 180;
const ratePerMinute = 200;
const demoStartTime = 60_000;
const penaltyFee = 20_000;
const destinations = {
  campus: { query:'단국대학교 정문', pin:'단국대학교 정문', walkMinutes:3 },
  gate: { query:'단국대학교 정문', pin:'단국대학교 정문', walkMinutes:2 }
};
const entryScreens = {home:byId('bikeHome'),search:byId('bikeSearch'),zone:byId('bikeZone')};
const zoneMarker = byId('zoneMarker');
const zoneArea = byId('zoneArea');
const returnShape = zoneArea.querySelector('path');
const otherReturnShapes = Array.from(entryScreens.zone.querySelectorAll('.zone-return-shape path'));
const restrictedZoneShapes = Array.from(entryScreens.zone.querySelectorAll('.zone-hit-region'), zone=>zone.querySelector('path'));
const returnPinStart = {x:167.5,y:479};
const destinationPin = {x:322.5,y:501};
const defaultWalkDistance = Math.hypot(returnPinStart.x-destinationPin.x,returnPinStart.y-destinationPin.y);
let returnPin = returnPinStart;
let canReturnHere = true;
let zoneDrag;
const destinationInput = byId('destinationInput');
const searchRows = Array.from(byId('searchResults').querySelectorAll('.search-row'));
let destination = destinations.campus;
let zoneOrigin = 'search';
let pickerOrigin = 'zone';
const svgNamespace = 'http://www.w3.org/2000/svg';
const state = { selected:0, saved:false, expanded:false, rideTime:0, stage:'pick', elapsed:0, paused:false, restricted:false, restrictedElapsed:0, deviating:false, recovering:false, fee:false, route:normalRoute, riderPosition:normalRoute[0] };
const pinButtons = [];
const cardButtons = [];
const nextCards = [];
const pickupLine = byId('pickupLine');
const pickupHalo = byId('pickupHalo');
const pickupDistance = byId('pickupDistance');
const pickupLocation = byId('pickupLocation');
const pickupOrigin = pickupLocation.getAttribute('transform');
const [pickupStartX,pickupStartY]=pickupOrigin.match(/-?\d+(?:\.\d+)?/g).map(Number);
let pickupPosition={x:pickupStartX,y:pickupStartY};
const pickupMotionPath = byId('pickupMotionPath');
let pickupFrame = 0;
let toastTimer;
let lastTime = performance.now();
let gestureY = null;
let dragHandled = false;
let returnStage = "ride";
const currency = number => number.toLocaleString('ko-KR') + '원';
const rideMinutes = () => Math.floor(state.rideTime/60_000);
const rideFare = () => rideMinutes()*ratePerMinute;
const totalFare = () => rideFare()+(state.fee?penaltyFee:0);
let routeSegments=[],routeManeuvers=[],routeLength=0,routeJoined='',earlierRoute='';
const restrictedBlocks = Array.from(document.querySelectorAll('.map-restricted'));
let visibleRestrictedBlocks;
function notify(message, appearance='default') {
  const toast = byId('toast');
  toast.dataset.appearance=appearance;
  toast.textContent = message;
  toast.classList.add('shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('shown'), 1800);
}
function buildPicker() {
  for (const [x,y] of [[132,212],[360,311]]) {
    const marker=document.createElement('span');
    marker.className='unavailable-pin';
    marker.style.left=x+'px';
    marker.style.top=y+'px';
    marker.innerHTML='<img src="assets/pick-imgIconBike.svg" alt=""><span>사용불가</span>';
    byId('pickupMapWorld').append(marker);
  }
  for (const [index,bike] of bikes.entries()) {
    const pin = document.createElement('button');
    pin.className = 'pin';
    pin.type = 'button';
    pin.style.left = bike.x + 'px';
    pin.style.top = bike.y + 'px';
    pin.setAttribute('aria-label',bike.id + ' 지도에서 선택');
    pin.innerHTML = '<b>' + bike.brand + '</b><img src="assets/pick-imgIconBike.svg" alt="">';
    pin.addEventListener('click', () => selectBike(index));
    byId('pickupMapWorld').append(pin);
    pinButtons.push(pin);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.setAttribute('aria-label',bike.id + ' 선택');
    card.innerHTML = '<img src="' + embeddedImages[bike.img] + '" alt=""><span class="card-text">' + (index===0?'<span class="bike-badge">인기 최고</span>':'') + '<span><strong>' + bike.id + '</strong> &nbsp;·&nbsp; <b><img class="battery" src="assets/pick-imgBattery.svg" alt="배터리">' + bike.minutes + '분</b></span><small>도보 ' + bike.walk + '분 · 분당 200원</small></span><span class="sound" aria-hidden="true"><img src="assets/pick-imgIcon.svg" alt=""></span>';
    card.addEventListener('click', () => {
      state.expanded=false;
      selectBike(index);
    });
    byId('cards').append(card);
    cardButtons.push(card);
    const preview = document.createElement('div');
    preview.className='card';
    preview.innerHTML=card.innerHTML;
    byId('nextBikes').append(preview);
    nextCards.push(preview);
  }
}
function selectBike(index) {
  if(index!==state.selected){state.selected=index;state.saved=false;}
  updatePicker();
}
function updatePicker() {
  const selectedBike=bikes[state.selected];
  pickupLine.setAttribute('d',selectedBike.approach);
  pickupHalo.setAttribute('d',selectedBike.approach);
  if(!state.saved) resetPickupLocation();
  const arrived=pickupLocation.hasAttribute('data-arrived');
  pickupDistance.hidden=arrived;
  pickupDistance.style.left=selectedBike.badge[0]+'px';
  pickupDistance.style.top=selectedBike.badge[1]+'px';
  const distance='약 '+selectedBike.meters+'m · 도보 '+selectedBike.walk+'분';
  if(pickupDistance.textContent!==distance) pickupDistance.textContent=distance;
  picker.classList.toggle('expanded',state.expanded);
  picker.classList.toggle('saved',state.saved);
  byId('sheetHandle').setAttribute('aria-expanded',String(state.expanded));
  byId('sheetHandle').setAttribute('aria-label',state.expanded?'주변 바이크 목록 접기':'주변 바이크 목록 펼치기');
  byId('pickerTitle').innerHTML = state.expanded ? '주변 바이크 3대' : '반납 위치까지 갈 수 있는<br>내 근처 바이크';
  for(const [i,pin] of pinButtons.entries()){
    pin.setAttribute('aria-pressed',String(state.selected===i));
    cardButtons[i].setAttribute('aria-pressed',String(state.selected===i));
    cardButtons[i].hidden=!state.expanded&&state.selected!==i;
    nextCards[i].hidden=state.selected===i;
  }
  byId('secondary').querySelector('img').hidden=state.saved;
  byId('secondary').querySelector('span').textContent = state.saved?'찜 해제':'QR 스캔하기';
  const approaching=state.saved&&!arrived;
  byId('primary').textContent=state.saved?(arrived?'이용 시작':'바이크로 이동 중'):'찜하기';
  byId('primary').disabled=approaching;
  byId('primary').setAttribute('aria-busy',String(approaching));
  updatePickupCamera();
}
// Center the map camera in the space between the top controls and the moving sheet.
// The map, bike pins, walking route and location share one camera transform.
function updatePickupCamera() {
  if(state.stage!=='pick') return;
  const report=phone.querySelector('.pick-map-report');
  const home=byId('pickerBack');
  const top=Math.max(report.offsetTop+report.offsetHeight,home.offsetTop+home.offsetHeight)+12;
  const bottom=phone.clientHeight-picker.offsetHeight;
  phone.style.setProperty('--pickup-camera-x',(phone.clientWidth/2-pickupPosition.x)+'px');
  phone.style.setProperty('--pickup-camera-y',((top+bottom)/2-pickupPosition.y)+'px');
}
function setPickupPosition(point) {
  pickupPosition={x:point.x,y:point.y};
  pickupLocation.setAttribute('transform','translate('+point.x+' '+point.y+')');
  updatePickupCamera();
}
function resetPickupLocation() {
  cancelAnimationFrame(pickupFrame);
  pickupFrame=0;
  pickupMotionPath.setAttribute('stroke-dasharray','0 1');
  setPickupPosition({x:pickupStartX,y:pickupStartY});
  pickupLocation.removeAttribute('data-arrived');
  const toast=byId('toast');
  if(toast.dataset.appearance==='pickup') toast.classList.remove('shown');
}
function moveToSavedBike() {
  const bike=bikes[state.selected];
  const finish=()=>{
    pickupFrame=0;
    setPickupPosition(bike);
    pickupLocation.setAttribute('data-arrived','');
    updatePicker();
    notify('바이크에 도착했어요','pickup');
  };
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
  pickupMotionPath.setAttribute('d',bike.approach+' L'+bike.x+' '+bike.y);
  const length=pickupMotionPath.getTotalLength();
  const duration=720;
  const startedAt=performance.now();
  const frame=now=>{
    const progress=Math.min(1,(now-startedAt)/duration);
    if(progress===1){finish();return;}
    const travelled=1-Math.pow(1-progress,2);
    const point=pickupMotionPath.getPointAtLength(length*travelled);
    pickupMotionPath.setAttribute('stroke-dasharray',travelled+' 1');
    setPickupPosition(point);
    pickupFrame=requestAnimationFrame(frame);
  };
  pickupFrame=requestAnimationFrame(frame);
}
function saveSelectedBike() {
  state.saved=true;
  updatePicker();
  moveToSavedBike();
}
const rideCards = byId('rideCards');
const rideBikeCard = byId('rideBikeCard');
let rideCardGesture;
let rideCardWheel={delta:0,time:0,handled:false};
function showRideCard(card) {
  const showBike=card==='bike';
  rideCards.dataset.card=card;
  byId('nav').inert=showBike;
  rideBikeCard.inert=!showBike;
  byId('nav').setAttribute('aria-hidden',String(showBike));
  rideBikeCard.setAttribute('aria-hidden',String(!showBike));
  byId('showNavigationCard').setAttribute('aria-pressed',String(!showBike));
  byId('showRideBikeCard').setAttribute('aria-pressed',String(showBike));
}
function endRideCardGesture() {
  rideCardGesture=undefined;
  rideCards.removeAttribute('data-dragging');
  rideCards.style.removeProperty('--card-drag');
}
function switchRideCardFromSwipe(delta) {
  if(delta<0&&rideCards.dataset.card==='navigation') showRideCard('bike');
  else if(delta>0&&rideCards.dataset.card==='bike') showRideCard('navigation');
}
function stage(name) {
  state.stage=name;
  if (phone.contains(document.activeElement)) document.activeElement.blur();
  phone.dataset.stage=name;
  updatePickupCamera();
  rideCards.hidden=name!=='ride';
  updateRiderMotion();
  const pick=name==='pick', riding=name==='ride'||name==='arrived';
  if(!pick) resetPickupLocation();
  byId('toast').classList.remove('shown');
  for(const [entry,section] of Object.entries(entryScreens)) section.hidden=name!==entry;
  byId('pickerBack').hidden=!pick;
  picker.inert=!pick;
  byId('pins').inert=!pick;
  phone.querySelector('.ride-ui').inert=!riding;
  if(pick||riding||name in entryScreens) overlay.hidden=true;
  const arrived=name==='arrived';
  byId('arrival').hidden=!arrived;
  arrivalBike.hidden=!arrived;
  if(arrived){
    byId('arrivalFare').textContent='요금 '+currency(rideFare());
    byId('arrivalTime').textContent=rideMinutes()+'분 이용';
    arrivalBike.src=cardButtons[state.selected].querySelector('img').src;
    arrivalBike.alt='주차한 바이크 '+bikes[state.selected].id;
  }
  rider.src=arrived?arrivalImage:ridingImage;
  rider.alt=arrived?'자전거에서 내려 엄지를 든 춘식이':'자전거를 타는 춘식이';
  byId('pause').disabled=name==='arrived';
}
function screen(title, content, back, dark=false) {
  overlay.classList.toggle('camera',dark);
  overlay.classList.remove('receipt-screen','payment-screen');
  overlay.innerHTML = '<header>' + (back?'<button id="screenBack" aria-label="뒤로">‹</button>':'') + '<b>' + title + '</b></header>' + content;
  overlay.hidden=false;
  if(back) byId('screenBack').onclick=back;
  overlay.querySelector('button')?.focus({preventScroll:true});
}
function reset() {
  byId("hint").textContent = "목적지를 검색하고 반납할 지역과 바이크를 골라 보세요.";
  if(dialog.open) dialog.close();
  Object.assign(state,{selected:0,saved:false,expanded:false,elapsed:0,paused:false,restricted:false,restrictedElapsed:0,deviating:false,recovering:false,fee:false,route:normalRoute,riderPosition:normalRoute[0]});
  byId('nav').dataset.warning='false';
  phone.dataset.warning='false';
  byId('pause').textContent='ⓘ 일시정지';
  updatePicker();
  setDestination(destinations.campus);
  destinationInput.value='';
  byId('rangeFilter').checked=false;
  setVehicleFilter('all');
  toggleVehiclePanel(false);
  stage('home');
}
function start() {
  earlierRoute='';
  const bike=bikes[state.selected];
  byId('rideBikeNumber').textContent=bike.id;
  byId('rideBikeBattery').textContent=bike.minutes+'분';
  byId('rideBikePrice').textContent='잠금해제 무료 + 분당 '+currency(ratePerMinute);
  endRideCardGesture();
  showRideCard('navigation');
  rideCardWheel={delta:0,time:0,handled:false};
  state.deviating=byId('scenario').value==='restricted';
  state.recovering=false;
  setRoute(normalRoute);
  state.elapsed=0;
  state.rideTime=demoStartTime;
  paintRideTime();
  state.paused=false;
  state.restricted=false;
  state.restrictedElapsed=0;
  updateRide(0);
  stage('ride');
  byId('hint').textContent='춘식이가 이동해요. 이용 종료 버튼을 눌러 반납을 체험할 수 있어요.';
}
function routePath(points) {
  return points.length>1?'M'+points.map(point=>point.join(' ')).join(' L'):'';
}
function measureRideRoute(route) {
  let offset=0;
  return route.slice(1).map((end,i)=>{
    const start=route[i], dx=end[0]-start[0], dy=end[1]-start[1];
    const length=Math.hypot(dx,dy);
    const cycle=dx===0&&start[0]===normalRoute[3][0]
      &&Math.min(start[1],end[1])>=normalRoute[4][1]
      &&Math.max(start[1],end[1])<=normalRoute[3][1];
    const segment={start,end,dx,dy,length,offset,cycle};
    offset+=length;
    return segment;
  }).filter(segment=>segment.length>0);
}
function rideRouteLength(segments) {
  const last=segments.at(-1);
  return last?last.offset+last.length:0;
}
const deviationSegments=measureRideRoute(deviationRoute);
const deviationLength=rideRouteLength(deviationSegments);
const departureDistance=deviationSegments[departureIndex].offset;
function ridePositionAt(segments,distance) {
  const segment=segments.find(part=>distance<part.offset+part.length);
  if(!segment) return segments.at(-1).end;
  const ratio=(distance-segment.offset)/segment.length;
  return [segment.start[0]+segment.dx*ratio,segment.start[1]+segment.dy*ratio];
}
function setRoute(route) {
  state.route=route;
  routeSegments=measureRideRoute(route);
  routeLength=rideRouteLength(routeSegments);
  routeManeuvers=[];
  for(let i=1;i<routeSegments.length;i++){
    const incoming=routeSegments[i-1], outgoing=routeSegments[i];
    const cross=incoming.dx*outgoing.dy-incoming.dy*outgoing.dx;
    const dot=incoming.dx*outgoing.dx+incoming.dy*outgoing.dy;
    const angle=Math.atan2(cross,dot);
    if(Math.abs(angle)>=turnThreshold){
      routeManeuvers.push({offset:outgoing.offset,direction:angle<0?'left':'right'});
    }
  }
  routeJoined=routePath(route);
  routeCasing.setAttribute('d',earlierRoute+routeJoined);
  routeArrows.replaceChildren();
  for(const segment of routeSegments){
    const {start,dx,dy,length,offset}=segment;
    const angle=Math.atan2(dy,dx)*180/Math.PI;
    const first=16+((34-offset%34)%34);
    for(let step=first;step<length-8;step+=34){
      const arrow=document.createElementNS(svgNamespace,'path');
      arrow.setAttribute('d','M-4 -4L4 0-4 4-2 0Z');
      arrow.setAttribute('transform','translate('+(start[0]+dx*step/length)+' '+(start[1]+dy*step/length)+') rotate('+angle+')');
      arrow.dataset.offset=offset+step;
      routeArrows.append(arrow);
    }
  }
}
function drawRoute(progress) {
  const distance=progress*routeLength;
  let point=state.route[0];
  let regular='',cycle='';
  const passed=[point];
  for(const segment of routeSegments){
    const {start,end,dx,dy,length,offset}=segment;
    const covered=Math.min(length,Math.max(0,distance-offset));
    const join=[start[0]+dx*covered/length,start[1]+dy*covered/length];
    if(covered>0){point=join;passed.push(join);}
    if(covered<length){
      const future=routePath([join,end]);
      if(segment.cycle) cycle+=future;
      else regular+=future;
    }
  }
  navigationLine.setAttribute('d',regular);
  cycleLine.setAttribute('d',cycle);
  routePast.setAttribute('d',earlierRoute+routePath(passed));
  for(const arrow of routeArrows.children) arrow.classList.toggle('passed',Number(arrow.dataset.offset)<=distance+8);
  return point;
}
function updateRiderMotion() {
  phone.dataset.pedaling=String(state.stage==='ride'&&!state.paused&&!dialog.open
    && (!state.deviating||state.elapsed<deviationDuration));
}
function updateNavigation(progress,warning) {
  const travelled=progress*routeLength;
  const next=routeManeuvers.find(maneuver=>maneuver.offset>travelled);
  const remaining=(next?.offset??routeLength)-travelled;
  const needsReturn=warning&&!state.recovering;
  const direction=needsReturn?'right':next?.direction??'straight';
  const remainingMeters=remaining*rideMetersPerUnit;
  const roundedMeters=remainingMeters<=10?10:Math.max(20,Math.round(remainingMeters/20)*20);
  const distance=String(needsReturn?120:roundedMeters);
  const nav=byId('nav');
  const instruction=needsReturn?'반납 가능 구역까지 '+distance+'m':distance+'m 앞 '+({left:'좌회전',right:'우회전',straight:'직진'}[direction]);
  if(nav.dataset.direction!==direction) nav.dataset.direction=direction;
  if(byId('distance').textContent!==distance) byId('distance').textContent=distance;
  const maneuver=byId('navManeuver');
  if(maneuver.getAttribute('aria-label')!==instruction) maneuver.setAttribute('aria-label',instruction);
  const label=warning?'서비스 불가 구역':state.recovering?'반납 가능 구역으로 이동 중':'10:03 도착 예정';
  if(byId('navLabel').textContent!==label) byId('navLabel').textContent=label;
}
function updateRide(progress) {
  const deviationDistance=progress*deviationLength;
  const guidanceProgress=state.deviating?Math.min(deviationDistance,departureDistance)/routeLength:progress;
  const guidedPosition=drawRoute(guidanceProgress);
  const position=state.deviating?ridePositionAt(deviationSegments,deviationDistance):guidedPosition;
  state.riderPosition=position;
  const [x,y]=position;
  // Keep the rider in the lower half while the map scrolls with the route.
  const [originX,originY]=normalRoute[0];
  const shiftX=(originX-x)*.78;
  const shiftY=(originY-y)*.94;
  mapWorld.style.transform='translate3d('+shiftX+'px,'+shiftY+'px,0)';
  mapWorld.style.setProperty('--rider-x',x+'px');
  mapWorld.style.setProperty('--rider-y',y+'px');
  byId('railRider').style.bottom=guidanceProgress*88+'%';
  byId('nav').style.setProperty('--progress', guidanceProgress*100+'%');
  const mapPoint=new DOMPoint(x,y);
  const warning=visibleRestrictedBlocks.some(block=>block.isPointInFill(mapPoint));
  state.restricted=warning;
  byId('nav').dataset.warning=String(warning);
  phone.dataset.warning=String(warning);
  const navigationProgress=state.deviating?Math.min(guidanceProgress,(departureDistance-1)/routeLength):guidanceProgress;
  updateNavigation(navigationProgress,warning);
  const movementSegments=state.deviating?deviationSegments:routeSegments;
  const movementDistance=progress*(state.deviating?deviationLength:routeLength);
  const movementSegment=movementSegments.find(segment=>movementDistance<segment.offset+segment.length)??movementSegments.at(-1);
  byId('rideScenery').dispatchEvent(new CustomEvent('ride-progress',{
    detail:{position,direction:[movementSegment.dx,movementSegment.dy],route:state.deviating?deviationRoute:state.route,distance:movementDistance}
  }));
  updateRiderMotion();
  if(progress===1&&!warning&&!state.deviating) stage('arrived');
}
function paintRideTime() {
  const withinMinute=(state.rideTime%60_000)/1000;
  meterProgress.setAttribute('stroke-dasharray',withinMinute+' '+(60-withinMinute));
  const minutes=rideMinutes();
  const label='이용 시간 '+minutes+'분 '+Math.floor(withinMinute)+'초';
  if(rideMeter.getAttribute('aria-label')===label) return;
  meterText.textContent=minutes+'분';
  meterPrice.textContent=currency(rideFare());
  rideMeter.setAttribute('aria-label',label);
}
function rideProgress(time) {
  if(time>=1) return 1;
  const acceleration=.08, braking=.12;
  const scale=1/(1-(acceleration+braking)/2);
  if(time<acceleration){
    return scale*(time/2-acceleration*Math.sin(Math.PI*time/acceleration)/(2*Math.PI));
  }
  if(time>1-braking){
    const remaining=1-time;
    return 1-scale*(remaining/2-braking*Math.sin(Math.PI*remaining/braking)/(2*Math.PI));
  }
  return scale*(time-acceleration/2);
}
function tick(now) {
  const delta=Math.max(0,now-lastTime);
  lastTime=now;
  if(state.stage==='ride'&&!dialog.open&&!state.paused){
    const activeDelta=Math.min(70,delta);
    state.elapsed+=activeDelta;
    state.rideTime+=delta;
    paintRideTime();
    const duration=state.recovering?recoveryDuration:state.deviating?deviationDuration:normalRideDuration;
    updateRide(rideProgress(Math.min(1,state.elapsed/duration)));
    // Only mobile tests automatically rejoin the planned route after the warning.
    if(mobileViewport.matches&&state.deviating&&state.restricted){
      state.restrictedElapsed+=activeDelta;
      if(state.restrictedElapsed>=1000) resumePlannedRoute();
    } else state.restrictedElapsed=0;
  }
  requestAnimationFrame(tick);
}
function camera(fee=false, preview=false) {
  if(dialog.open) dialog.close();
  state.fee=fee;
  stage(preview?'photo':'camera');
  const actions=preview?'<div class="actions photo-actions"><button id="retake" class="btn secondary">다시 찍기</button><button id="submitPhoto" class="btn primary">사진 제출</button></div>':'<button id="capture" class="shutter" aria-label="반납 사진 촬영">◎</button>';
  screen('반납 위치 촬영','<p>'+(preview?'반납 사진을 확인해 주세요':'주차한 바이크를 촬영하기')+'</p><div class="preview"><img src="assets/camera-img.png" alt="주차한 바이크 예시 사진"></div>'+actions,()=>stage(returnStage),true);
  if(preview){byId('retake').onclick=()=>camera(fee);byId('submitPhoto').onclick=payment;}
  else byId('capture').onclick=()=>camera(fee,true);
}
function payment() {
  stage('pay');
  screen('결제','<h2>바이크 이용 요금을 결제해 주세요</h2><div class="invoice"><div>바이크 이용 요금 <b>'+currency(rideFare())+'</b></div>'+(state.fee?'<div>과태료 <b>20,000원</b></div>':'')+'<div>총 결제 금액 <strong>'+currency(totalFare())+'</strong></div></div><div class="actions"><button id="pay" class="btn primary">'+currency(totalFare())+' 결제하기</button></div>',()=>camera(state.fee,true));
  overlay.classList.add('payment-screen');
  byId('pay').onclick=receipt;
}
function receipt(){
  const routeMap = `
    <div class="route-preview" role="img" aria-label="출발 지점에서 도착 지점까지의 이용 경로">
      <img src="assets/exactdone-imgImage94.png" alt="">
      <svg class="receipt-route-overlay" viewBox="0 0 1774 887" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path class="receipt-route-casing" d="M375 685V495H842V233"/>
        <path class="receipt-route-trace" d="M375 685V495H842V233"/>
        <circle class="receipt-route-stop" cx="375" cy="685" r="28"/>
        <circle class="receipt-route-stop receipt-route-end" cx="842" cy="233" r="28"/>
      </svg>
      <span>출발</span><span>도착</span>
    </div>`;
  stage('done');
  screen('반납 완료','<div class="receipt"><img class="receipt-check" src="assets/exactdone-imgGroup34.svg" alt=""><h2>반납이 완료되었습니다</h2><img class="receipt-mascot" src="assets/exactdone-imgImage89.png" alt=""></div><div class="receipt-route"><div><b>이용 경로</b><b>총 2.4 km　'+rideMinutes()+'분</b></div>'+routeMap+'</div><div class="receipt-price"><span><img src="assets/exactdone-imgIconCard.svg" alt=""> 결제금액</span><b>'+currency(totalFare())+'</b></div><div class="receipt-help"><span><img src="assets/exactdone-imgIconInfo.svg" alt="">고장 접수</span><span><img src="assets/exactdone-imgIconAlert.svg" alt="">서비스 문의</span></div><div class="actions"><button id="home" class="btn primary">바이크 홈</button></div>');
  overlay.classList.add('receipt-screen');
  byId('home').onclick=reset;
}
function setDestination(place) {
  destination=place;
  for(const id of ['homeDestination','zoneDestination']) byId(id).textContent=place.query;
  byId('reviewBikeDestination').textContent=place.pin;
  for(const id of ['zonePinLabel','ridePinDestination','rideDestination']) byId(id).textContent=place.pin;
}
const searchKey = text => text.normalize('NFC').replace(/\s/g,'');
function updateSearch() {
  const query=searchKey(destinationInput.value);
  byId('clearSearch').hidden=!destinationInput.value;
  for(const row of searchRows){
    const label=searchKey(row.dataset.query??destinations[row.dataset.place].query);
    row.hidden=Boolean(query)&&!label.includes(query)&&!query.startsWith(label);
  }
  byId('searchEmpty').hidden=searchRows.some(row=>!row.hidden);
}
function openSearch(value) {
  destinationInput.value=value;
  updateSearch();
  stage('search');
  destinationInput.focus({preventScroll:true});
  destinationInput.setSelectionRange?.(value.length,value.length);
}
function openZone(place, origin) {
  zoneOrigin=origin;
  setDestination(place);
  stage('zone');
  moveReturnPin(returnPinStart,false);
}
// Test the original map shapes in map coordinates, independent of phone tilt/scale.
function pointInZone(shape,position) {
  const svg=shape.ownerSVGElement;
  if(getComputedStyle(svg).display==='none') return false;
  const box=svg===returnShape.ownerSVGElement?zoneArea:svg;
  const style=getComputedStyle(box);
  const view=svg.viewBox.baseVal;
  const point=new DOMPoint(
    (position.x-parseFloat(style.left))*view.width/parseFloat(style.width)+view.x,
    (position.y-parseFloat(style.top))*view.height/parseFloat(style.height)+view.y
  );
  return shape.isPointInFill(point);
}
function zonePointerPosition(event) {
  return new DOMPoint(event.clientX,event.clientY)
    .matrixTransform(byId('zoneWalkLine').getScreenCTM().inverse());
}
function moveReturnPin(position, selected=false) {
  returnPin={x:Math.min(382,Math.max(20,position.x)),y:Math.min(675,Math.max(220,position.y))};
  const restricted=restrictedZoneShapes.some(shape=>pointInZone(shape,returnPin));
  const inRecommendedArea=!restricted&&pointInZone(returnShape,returnPin);
  const otherArea=restricted||inRecommendedArea?undefined:otherReturnShapes.find(shape=>pointInZone(shape,returnPin));
  canReturnHere=inRecommendedArea||Boolean(otherArea);
  for(const shape of otherReturnShapes){
    shape.toggleAttribute('data-active',shape===otherArea);
    shape.ownerSVGElement.setAttribute('aria-pressed',String(shape===otherArea&&selected));
  }
  const distance=Math.hypot(returnPin.x-destinationPin.x,returnPin.y-destinationPin.y);
  const walk='도보 '+Math.max(1,Math.round(distance*destination.walkMinutes/defaultWalkDistance))+'분';
  zoneMarker.style.setProperty('--zone-x',returnPin.x+'px');
  zoneMarker.style.setProperty('--zone-y',returnPin.y+'px');
  zoneMarker.toggleAttribute('data-unavailable',!canReturnHere);
  zoneMarker.setAttribute('aria-label',canReturnHere?walk+' 반납 가능 구역 선택':'반납 불가능 지역');
  byId('zoneWalkTime').textContent=walk;
  byId('zoneWalkLine').classList.toggle('zone-line-hidden',!canReturnHere);
  byId('zoneWalkSegment').setAttribute('x1',returnPin.x);
  byId('zoneWalkSegment').setAttribute('y1',returnPin.y);
  byId('findBike').setAttribute('aria-disabled',String(!canReturnHere));
  zoneArea.toggleAttribute('data-unselected',!inRecommendedArea);
  zoneArea.setAttribute('aria-pressed',String(inRecommendedArea&&selected));
  zoneMarker.setAttribute('aria-pressed',String(canReturnHere&&selected));
}
function openPicker(origin,index=0) {
  pickerOrigin=origin;
  state.saved=false;
  state.expanded=false;
  selectBike(index);
  stage('pick');
}
const homePinPositions = [[54,221,1],[169,293,2],[121,130,0],[204,378,0],[239,244,null]];
function buildHomeMarkers() {
  for(const [x,y,index] of homePinPositions){
    const isBike=index!==null;
    const marker=document.createElement('button');
    marker.type='button';
    marker.className='home-map-pin';
    marker.dataset.vehicle=isBike?'bike':'kickboard';
    marker.style.left=x+'px';
    marker.style.top=y+'px';
    marker.setAttribute('aria-label',isBike?bikes[index].id+' 바이크 보기':'킥보드 정보');
    const vehicleIcon=isBike?'assets/home-imgIcon.svg':'assets/home-imgIcon1.svg';
    marker.innerHTML='<img class="pin-halo" src="assets/home-imgHalo.svg" alt=""><img class="pin-body" src="assets/home-imgBody.svg" alt=""><img class="pin-vehicle" src="'+vehicleIcon+'" alt=""><span class="pin-brand" aria-hidden="true">T</span><span class="pin-battery" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
    marker.onclick=()=>isBike?openPicker('home',index):notify('이 프로토타입에서는 바이크를 이용할 수 있어요.');
    byId('homeMarkers').append(marker);
  }
}
let homeVehicle='all';
function setVehicleFilter(vehicle) {
  homeVehicle=vehicle;
  for(const button of byId('vehicleFilters').querySelectorAll('button')) button.setAttribute('aria-pressed',String(button.dataset.vehicle===vehicle));
  const onlyBikes=byId('rangeFilter').checked;
  for(const marker of byId('homeMarkers').children) {
    marker.hidden=(vehicle!=='all'&&marker.dataset.vehicle!==vehicle)||(onlyBikes&&marker.dataset.vehicle!=='bike');
  }
  byId('recommendedBikeCard').hidden=vehicle==='kickboard';
}
function toggleVehiclePanel(open) {
  byId('vehiclePanel').hidden=!open;
  byId('homeFilter').setAttribute('aria-expanded',String(open));
}

byId('destinationSearch').onclick=()=>openSearch(destination.query);
byId('campusShortcut').onclick=()=>openZone(destinations.campus,'home');
byId('recommendedBike').onclick=()=>openPicker('home');
byId('homeBikeNumber').textContent=bikes[0].id;
byId('homeBikeBattery').textContent=bikes[0].minutes+'분';
byId('saveHomeBike').onclick=()=>{
  openPicker('home');
  saveSelectedBike();
};
byId('homeBack').onclick=reset;
byId('homeFilter').onclick=()=>toggleVehiclePanel(byId('vehiclePanel').hidden);
byId('applyFilters').onclick=()=>{setVehicleFilter(homeVehicle);toggleVehiclePanel(false);};
byId('vehicleFilters').onclick=event=>{
  const vehicle=event.target.closest('[data-vehicle]')?.dataset.vehicle;
  if(vehicle) setVehicleFilter(vehicle);
};
byId('homeNotice').onclick=byId('homePromo').onclick=()=>notify('카카오 T 바이크 첫 30분은 990원!');
for(const id of ['homePlace','searchHomePlace']) byId(id).onclick=()=>notify('등록된 집 주소가 없어요.');
for(const id of ['workPlace','searchWorkPlace']) byId(id).onclick=()=>notify('등록된 회사 주소가 없어요.');
byId('sampleDestinations').onclick=()=>openSearch('단국대학교');
byId('stationShortcut').onclick=()=>openSearch('죽전역');
byId('searchBack').onclick=()=>stage('home');
byId('clearSearch').onclick=()=>{destinationInput.value='';updateSearch();destinationInput.focus({preventScroll:true});};
destinationInput.oninput=updateSearch;
byId('destinationForm').onsubmit=event=>{
  event.preventDefault();
  const firstMatch=searchRows.find(row=>row.dataset.place&&!row.hidden);
  if(firstMatch) openZone(destinations[firstMatch.dataset.place],'search');
};
byId('searchResults').onclick=event=>{
  const row=event.target.closest('.search-row');
  if(row?.dataset.place) openZone(destinations[row.dataset.place],'search');
  else if(row?.dataset.query) openSearch(row.dataset.query);
};
byId('zoneBack').onclick=()=>zoneOrigin==='search'?openSearch(destinationInput.value):stage('home');
byId('changeDestination').onclick=()=>openSearch(destination.query);
zoneArea.onclick=()=>moveReturnPin(returnPinStart,true);
for(const shape of otherReturnShapes){
  const region=shape.ownerSVGElement;
  const park=region.classList.contains('zone-park');
  const point=park?{x:300,y:280}:{x:65,y:540};
  region.setAttribute('role','button');
  region.setAttribute('tabindex','0');
  region.removeAttribute('aria-hidden');
  region.setAttribute('aria-label',(park?'비발디공원':'남서쪽')+' 반납 가능 구역 선택');
  region.onclick=()=>moveReturnPin(point,true);
  region.onkeydown=event=>{
    if(event.key!=='Enter'&&event.key!==' ') return;
    event.preventDefault();
    moveReturnPin(point,true);
  };
}

zoneMarker.onclick=()=>moveReturnPin(returnPin,true);
zoneMarker.onpointerdown=event=>{
  if(!event.isPrimary||event.button!==0) return;
  const point=zonePointerPosition(event);
  zoneDrag={id:event.pointerId,x:returnPin.x-point.x,y:returnPin.y-point.y};
  zoneMarker.setPointerCapture(event.pointerId);
  zoneMarker.toggleAttribute('data-dragging',true);
};
zoneMarker.onpointermove=zoneMarker.onpointerup=event=>{
  if(zoneDrag?.id!==event.pointerId) return;
  const point=zonePointerPosition(event);
  moveReturnPin({x:point.x+zoneDrag.x,y:point.y+zoneDrag.y},true);
};
zoneMarker.onlostpointercapture=()=>{
  zoneDrag=undefined;
  zoneMarker.removeAttribute('data-dragging');
};
const arrowOffsets={ArrowUp:[0,-16],ArrowRight:[16,0],ArrowDown:[0,16],ArrowLeft:[-16,0]};
zoneMarker.onkeydown=event=>{
  const offset=arrowOffsets[event.key];
  if(!offset&&event.key!=='Home') return;
  event.preventDefault();
  const position=offset?{x:returnPin.x+offset[0],y:returnPin.y+offset[1]}:returnPinStart;
  moveReturnPin(position,true);
};
byId('zoneLocate').onclick=()=>{moveReturnPin(returnPinStart,true);zoneMarker.focus({preventScroll:true});};
byId('findBike').onclick=()=>{
  if(canReturnHere) openPicker('zone');
  else notify('파란색 반납 가능 지역으로 핀을 옮겨 주세요.');
};
byId('pickerBack').onclick=()=>stage(pickerOrigin);
byId('homeScan').onclick=()=>{state.selected=0;state.saved=false;updatePicker();openScanner('home');};

buildPicker();
buildHomeMarkers();
updatePicker();
stage('home');
const parking=[
 ['BrailleBlock','점자 보도 블록'],['SubwayEntrance','지하철 역 입구'],['Crosswalk','횡단보도 앞'],['BusTaxiStop','버스·택시 정류장'],['Road','도로 및 차도'],['Elevator','교통약자 엘리베이터']
];
parking.forEach(([name,label],i)=>byId('parking').insertAdjacentHTML('beforeend','<span><img src="'+embeddedImages['arrival-img0'+(i+1)+name+'1.svg']+'" alt="">'+label+'</span>'));
const viewport=byId('viewport');
new ResizeObserver(([entry])=>{
  phone.style.setProperty('--screen-scale',String(entry.contentRect.width/402));
}).observe(viewport);
mobileViewport.addEventListener('change',()=>{
  if(state.stage!=='ride') byId('scenario').value=mobileViewport.matches?'restricted':'normal';
});
new ResizeObserver(updatePickupCamera).observe(picker);
phone.dataset.theme='purple';
dialog.dataset.theme='purple';
visibleRestrictedBlocks=restrictedBlocks.filter(block=>getComputedStyle(block).display!=='none');
byId('reset').onclick=reset;
const handle=byId('sheetHandle');
handle.onclick=()=>{if(!dragHandled){state.expanded=!state.expanded;updatePicker();}dragHandled=false;};
handle.onpointerdown=e=>{gestureY=e.clientY;dragHandled=false;handle.setPointerCapture(e.pointerId);};
handle.onpointerup=e=>{
  const dy=e.clientY-gestureY;
  if(gestureY!==null&&Math.abs(dy)>21){state.expanded=dy<0;dragHandled=true;updatePicker();}
  gestureY=null;
};
handle.onpointercancel=()=>{gestureY=null;dragHandled=false;};
byId('primary').onclick=()=>{
  if(state.saved){
    if(pickupLocation.hasAttribute('data-arrived')) start();
  } else saveSelectedBike();
};
function openScanner(origin) {
  stage('scan');
  screen('QR 스캔하기','<p>'+bikes[state.selected].id+' 바이크의 QR 코드를 스캔해 주세요.</p><div class="qr" aria-hidden="true">▦</div><div class="actions"><button class="btn primary" id="scan">스캔 완료</button></div>',()=>stage(origin),true);
  byId('scan').onclick=start;
}
byId('secondary').onclick=()=>{
  if(state.saved){state.saved=false;updatePicker();return;}
  openScanner('pick');
};
byId('pause').onclick=()=>{state.paused=!state.paused;byId('pause').textContent=state.paused?'이용 재개':'ⓘ 일시정지';updateRiderMotion();};
function positionDialog(){
  const bounds=phone.getBoundingClientRect();
  dialog.style.setProperty('--dialog-left', Math.max(0,bounds.left)+'px');
  dialog.style.setProperty('--dialog-bottom', Math.max(0,innerHeight-bounds.bottom)+'px');
  dialog.style.setProperty('--dialog-scale', bounds.width/402);
}
window.addEventListener('resize',()=>{if(dialog.open)positionDialog();});
byId('end').onclick=()=>{
  returnStage=state.stage;
  if(state.restricted){positionDialog();dialog.showModal();updateRiderMotion();}
  else camera();
};
dialog.addEventListener('close',updateRiderMotion);
byId('continue').onclick=()=>dialog.close();
byId('acceptFee').onclick=()=>camera(true);
function resumeRideRoute(waypoints){
  if(dialog.open) dialog.close();
  const position=state.riderPosition;
  earlierRoute=routePast.getAttribute('d')??'';
  setRoute([position,...waypoints]);state.elapsed=0;state.deviating=false;state.recovering=true;state.paused=false;state.restrictedElapsed=0;
  byId('pause').textContent='ⓘ 일시정지';
  updateRide(0);
}
function resumePlannedRoute(){
  const [x,y]=state.riderPosition;
  let nearest,joinIndex,distance=Infinity;
  for(let i=departureIndex;i<normalRoute.length-1;i++){
    const [ax,ay]=normalRoute[i], [bx,by]=normalRoute[i+1];
    const dx=bx-ax, dy=by-ay;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
    const point=[ax+t*dx,ay+t*dy];
    const candidate=Math.hypot(x-point[0],y-point[1]);
    if(candidate<distance){distance=candidate;nearest=point;joinIndex=i;}
  }
  resumeRideRoute([nearest,...normalRoute.slice(joinIndex+1)]);
};
byId('reroute').onclick=()=>resumeRideRoute(recoveryWaypoints);
byId('showNavigationCard').onclick=()=>showRideCard('navigation');
byId('showRideBikeCard').onclick=()=>showRideCard('bike');
byId('rideBikeFareHelp').onclick=()=>notify('잠금해제 비용 없이 1분당 '+currency(ratePerMinute)+'이 계산돼요.');
byId('rideBikeHelp').onclick=()=>notify('바이크에 문제가 있으면 안전한 곳에 정차해 주세요.');
rideCards.onpointerdown=event=>{
  if(!event.isPrimary||event.button!==0) return;
  const width=rideCards.offsetWidth;
  rideCardGesture={id:event.pointerId,x:event.clientX,y:event.clientY,width,scale:rideCards.getBoundingClientRect().width/width};
};
rideCards.onpointermove=event=>{
  if(rideCardGesture?.id!==event.pointerId) return;
  const dx=event.clientX-rideCardGesture.x;
  if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(event.clientY-rideCardGesture.y)) return;
  if(!rideCards.hasPointerCapture(event.pointerId)) rideCards.setPointerCapture(event.pointerId);
  const {scale,width}=rideCardGesture;
  const offset=Math.max(-width,Math.min(width,dx/scale));
  const drag=rideCards.dataset.card==='bike'?Math.max(0,offset):Math.min(0,offset);
  rideCards.setAttribute('data-dragging','');
  rideCards.style.setProperty('--card-drag',drag+'px');
};
rideCards.onpointerup=event=>{
  if(rideCardGesture?.id!==event.pointerId) return;
  const dx=event.clientX-rideCardGesture.x;
  const swipe=Math.abs(dx)>=36*rideCardGesture.scale&&Math.abs(dx)>Math.abs(event.clientY-rideCardGesture.y);
  endRideCardGesture();
  if(swipe) switchRideCardFromSwipe(dx);
};
rideCards.onpointercancel=endRideCardGesture;
rideCards.onlostpointercapture=event=>{if(event.target===rideCards)endRideCardGesture();};
rideCards.addEventListener('wheel',event=>{
  if(event.ctrlKey||Math.abs(event.deltaX)<=Math.abs(event.deltaY)) return;
  event.preventDefault();
  if(event.timeStamp-rideCardWheel.time>140) rideCardWheel={delta:0,time:0,handled:false};
  rideCardWheel.time=event.timeStamp;
  if(rideCardWheel.handled) return;
  const unit=event.deltaMode===1?16:event.deltaMode===2?rideCards.clientWidth:1;
  rideCardWheel.delta-=event.deltaX*unit;
  if(Math.abs(rideCardWheel.delta)<36) return;
  rideCardWheel.handled=true;
  switchRideCardFromSwipe(rideCardWheel.delta);
},{passive:false});
requestAnimationFrame(tick);
