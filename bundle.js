/* 2D Multiplayer Base (client-only prototype)
 * Features implemented:
 * - Player entity: main circle + two smaller hand circles
 * - Large map with grid & border constraints
 * - Smooth camera following player with interpolation + slight lookahead
 * - Basic input (WASD + mouse aim)
 * - Responsive resize & high-DPI scaling
 * - HUD + Main Menu UI interactions
 * - Structure placeholders for future networking (socket placeholder)
 */

// ===== Utility =====
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now();
function lerpColor(c1,c2,t){
	t = clamp(t,0,1);
	const p = v=>parseInt(v,16);
	if (c1.startsWith('#')) c1=c1.slice(1); if (c2.startsWith('#')) c2=c2.slice(1);
	if (c1.length===3) c1=c1.split('').map(x=>x+x).join('');
	if (c2.length===3) c2=c2.split('').map(x=>x+x).join('');
	const r1=p(c1.slice(0,2)), g1=p(c1.slice(2,4)), b1=p(c1.slice(4,6));
	const r2=p(c2.slice(0,2)), g2=p(c2.slice(2,4)), b2=p(c2.slice(4,6));
	const r=Math.round(lerp(r1,r2,t)), g=Math.round(lerp(g1,g2,t)), b=Math.round(lerp(b1,b2,t));
	const h = v=>v.toString(16).padStart(2,'0');
	return '#'+h(r)+h(g)+h(b);
}

// ===== Config =====
const CONFIG = {
	map: { width: 4000, height: 4000, grid: 80, borderColor: '#56b979', bgColor: '#2e8a4c' },
				player: { radius: 40, handRadius: 17, handOffsetMult: 1.15, moveSpeed: 340, accel: 2800, friction: 0.86, skinBase: '#f4c9a3', skinShade: '#ebb894', outline: '#c58e62', nameBg: 'rgba(255,255,255,0.55)', nameTag: { padX: 16, padY: 6, radius: 14, bgStart: '#ffffffcc', bgEnd: '#ffffff99', stroke: 'rgba(0,0,0,0.25)', text: '#3d2a1c', shadow: 'rgba(0,0,0,0.25)' } },
	camera: { smooth: 0.12, zoom: 1.18, lookAhead: 0.18, maxLook: 140 }, // zoom >1 = slightly closer
	food: { healPerApple: 25, eatDuration: 1.15 },
	bladeLen: 70,
				objects: { treeCount: 45, stoneCount: 18, bushCount: 16 },
				gather: { radius: 140, hitInterval: 0.45, coneDeg: 85 }, // coneDeg: allowable aim cone for hits
				render: { pixelSnap: true, fixedUpdate: true, fixedFps: 120 },
				combat: { playerDamage: 9, hitFlashMs: 180, bloodParticles: 10, animalResist: { cow: 0.65, pig: 0.8, wolf: 1 } },
				animals: { count: { cow: 6, pig: 6, wolf: 3 }, wanderSpeed: 100, wolfSpeed: 180, wolfDamage: 14, biteInterval: 1.2, biteRange: 95 },
	playerStats: { maxHP: 100 },
	collision: { tolerance: 12, velocityDamp: 0.65 },
	debug: { showFps: true },
	tools: {
		axe: { woodMult: 3, stoneMult: 1, damageMult: 1.1, reach: 1.18 },
		pickaxe: { woodMult: 1, stoneMult: 3, damageMult: 1.0, reach: 1.18 },
		sword: { woodMult: 1, stoneMult: 1, damageMult: 2.0, reach: 1.28 }
	}
};

// ===== Canvas & Pattern =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = Math.max(1, window.devicePixelRatio || 1);
let terrainPattern = null;

// ===== Audio (Menu + Occasional Ambient) =====
// Created early so event listeners ready before user interaction (play is triggered on click events to satisfy autoplay policies).
let audioMainMenu = null;
let audioBg1 = null;
let _ambientTimer = null;
let _audioInitialized = false;
let _userConsent = false;
function initAudioOnce(){
	if (_audioInitialized) return; _audioInitialized = true;
	audioMainMenu = new Audio('audio/mainmenu.mp3');
	audioMainMenu.loop = true; // continuous in menu
	audioMainMenu.volume = 0.30; // quieter
	audioBg1 = new Audio('audio/background1.mp3');
	audioBg1.loop = false; // play sporadically
	audioBg1.volume = 0.22; // quieter ambient track
	audioBg1.addEventListener('ended', ()=>{ // schedule next after natural completion
		if (!inGame) return; // don't schedule if left game
		scheduleAmbientMusic();
	});
}
function playMenuMusic(){
	initAudioOnce();
	try { if (audioBg1) { audioBg1.pause(); } } catch{}
	if (audioMainMenu){
		try { audioMainMenu.currentTime = (audioMainMenu.currentTime||0); audioMainMenu.play().catch(()=>{}); } catch{}
	}
}
function stopMenuMusic(){
	if (audioMainMenu){ try { audioMainMenu.pause(); } catch{} }
}
function stopAmbient(){
	if (_ambientTimer){ clearTimeout(_ambientTimer); _ambientTimer=null; }
	if (audioBg1){ try { audioBg1.pause(); } catch{} }
}
function scheduleAmbientMusic(immediate){
	if (!inGame) return; initAudioOnce();
	if (_ambientTimer){ clearTimeout(_ambientTimer); _ambientTimer=null; }
	const delay = immediate? 0 : (15000 + Math.random()*45000); // 15s to ~60s
	_ambientTimer = setTimeout(()=>{
		if (!inGame) return; initAudioOnce();
		try { audioBg1.currentTime = 0; audioBg1.play().catch(()=>{}); } catch{}
	}, delay);
}
// User interaction hooks to ensure audio context allowed
document.addEventListener('click', initAudioOnce, { once:true, passive:true });
document.addEventListener('keydown', initAudioOnce, { once:true, passive:true });

// Consent modal handling
const consentModal = document.getElementById('start-warning');
const consentOverlay = document.getElementById('start-overlay');
const btnConsent = document.getElementById('btn-consent');
function showConsentIfNeeded(){
	if (consentModal){ consentModal.classList.remove('hidden'); }
	if (consentOverlay){ consentOverlay.classList.remove('hidden'); }
	// Temporarily block interactions behind
	const m = document.getElementById('main-menu'); if (m) m.style.pointerEvents='none';
}
function hideConsent(){
	if (consentModal){ consentModal.classList.add('hidden'); }
	if (consentOverlay){ consentOverlay.classList.add('hidden'); }
	const m = document.getElementById('main-menu'); if (m) m.style.pointerEvents='auto';
}
function acceptConsent(){
	_userConsent = true;
	hideConsent();
	initAudioOnce(); playMenuMusic();
}
btnConsent?.addEventListener('click', acceptConsent);
// Show consent modal ASAP
showConsentIfNeeded();
function rebuildTerrainPattern(){
	const c = document.createElement('canvas');
	c.width = c.height = 160;
	const g = c.getContext('2d');
	const grad = g.createLinearGradient(0,0,0,160);
	grad.addColorStop(0,'#3aa85e');
	grad.addColorStop(1,'#2e8a4c');
	g.fillStyle = grad; g.fillRect(0,0,160,160);
	for (let i=0;i<160;i++) { // subtle speckles
		g.fillStyle = Math.random()<0.5? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
		g.fillRect(Math.random()*160, Math.random()*160, 1.2, 1.2);
	}
	terrainPattern = ctx.createPattern(c,'repeat');
}
function resize(){
	dpr = Math.max(1, window.devicePixelRatio||1);
	canvas.width = innerWidth * dpr;
	canvas.height = innerHeight * dpr;
	canvas.style.width = innerWidth+'px';
	canvas.style.height = innerHeight+'px';
}
addEventListener('resize', resize);
resize();
rebuildTerrainPattern();

// ===== Input =====
const keys = {};
addEventListener('keydown', e=>{ keys[e.code]=true; });
addEventListener('keyup', e=>{ keys[e.code]=false; });
const mouse = { x: innerWidth/2, y: innerHeight/2 };
let _lastMouseMoveTime = now();
addEventListener('mousemove', e=>{ mouse.x = e.clientX; mouse.y = e.clientY; _lastMouseMoveTime = now(); }, { passive: true });
let mouseDown = false;
addEventListener('mousedown', (e)=>{ 
	// Ignore clicks on UI elements (anything that's not the canvas)
	if (e && e.target && e.target!==canvas) return;
	mouseDown = true; 
	if (chatInputActive) return; // disable actions while typing
	if (inGame && buildingItem){ // priority: place structure
		attemptPlaceStructure();
		return; // don't trigger punch
	}
}, { passive: true });
addEventListener('mouseup', ()=>{ mouseDown = false; }, { passive: true });

// ===== Chat =====
const chatMessages = []; // {id, playerId, text, time}
let chatInputActive = false; let chatBuffer='';
function pushChatMessage(playerId, text){
	if (!text) return;
	const id = 'c'+Math.random().toString(36).slice(2,9);
	chatMessages.push({ id, playerId, text: text.slice(0,120), time: now() });
	// trim
	while (chatMessages.length>80) chatMessages.shift();
}
addEventListener('keydown', e=>{
	if (e.code==='Enter'){
		if (!inGame) return;
		if (!chatInputActive){ chatInputActive=true; chatBuffer=''; e.preventDefault(); }
		else {
				const textMsg = chatBuffer.trim();
				if (textMsg){
					pushChatMessage(myNetId, textMsg);
					if (isHost){ for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'chat', from: myNetId, text: textMsg })); }
				}
			chatInputActive=false; chatBuffer=''; e.preventDefault();
		}
	}
	else if (chatInputActive){
		if (e.code==='Escape'){ chatInputActive=false; chatBuffer=''; e.preventDefault(); }
		else if (e.code==='Backspace'){ chatBuffer = chatBuffer.slice(0,-1); e.preventDefault(); }
		else if (e.key && e.key.length===1 && !e.metaKey && !e.ctrlKey && chatBuffer.length<120){ chatBuffer += e.key; e.preventDefault(); }
		// Suppress other game hotkeys while typing
		return;
	}
});

function drawChatBubbles(g){
	const lifetime = 6000; // ms visible full, fade after
	// Track stacking per player so multiple recent messages don't overlap
	const stackMap = new Map(); // playerId -> nextY (starting from base)
	for (let i=chatMessages.length-1;i>=0;i--){
		const m = chatMessages[i];
		const p = (m.playerId===myNetId)? myPlayer : remotePlayers.get(m.playerId);
		if (!p || p.x==null) continue;
		const age = now() - m.time; if (age > lifetime+2000) continue; // skip very old
		const alpha = age>lifetime? Math.max(0,1 - (age-lifetime)/2000):1; if (alpha<=0) continue;
		const px = (p.prevX!==undefined)? p.prevX + (p.x - p.prevX)*renderAlpha : p.x;
		const py = (p.prevY!==undefined)? p.prevY + (p.y - p.prevY)*renderAlpha : p.y;
		g.save(); g.font='600 15px Rubik, sans-serif';
		const text = m.text; const padX=16; const tw = Math.min(240, g.measureText(text).width + padX); const th=30; const gap=6;
		// base Y above head
		const baseY = py - CONFIG.player.radius - 86;
		let nextY = stackMap.get(m.playerId);
		if (nextY==null){ nextY = baseY; } else { nextY -= (th + gap); }
		stackMap.set(m.playerId, nextY);
		const bx = px - tw/2; const by = nextY;
		g.globalAlpha = alpha;
		// Minimal flat bubble
		g.fillStyle='rgba(255,255,255,0.88)'; g.beginPath(); if (g.roundRect) g.roundRect(bx,by,tw,th,12); else g.rect(bx,by,tw,th); g.fill();
		g.fillStyle='#111'; g.textAlign='center';
		// Simple clipping if text would overflow width; ellipsis
		let renderText = text; const maxChars = 60; if (renderText.length>maxChars) renderText = renderText.slice(0,maxChars-1)+'…';
		g.fillText(renderText, px, by+th/2+5);
		g.restore();
	}
}

// ===== Player =====
class Player {
	constructor(name){
		this.name = name;
		this.x = CONFIG.map.width/2;
		this.y = CONFIG.map.height/2;
		this.vx = 0; this.vy = 0;
		this.prevX = this.x; this.prevY = this.y;
		this.angle = 0;
		this.punchActive = false;
		this.punchT = 1; // 1 = idle
		this.punchingHand = 0; // 0 left, 1 right
		this.hp = CONFIG.playerStats.maxHP;
		this.lastPlayerHit = -9999; // timestamp for hit flash
		this.dead = false;
		this.food = 0;
		this.knockTimer = 0; // seconds remaining of knockback control dampening
		// Smoothed eye direction (prevents pupil teleport when target changes)
		this._eyeDx = 1; this._eyeDy = 0; this._eyeInit = false;
	}
	_getGazeDirection(px,py){
		// If this is the local player use mouse if recently moved; else track nearest entity.
		const idleMs = 1200;
		let tx=null, ty=null; const nowT = now();
		if (this===myPlayer && (nowT - _lastMouseMoveTime) < idleMs){
			// Project world point from mouse with zoom compensation
			const z = CONFIG.camera.zoom || 1;
			tx = camera.x - innerWidth/(2*z) + mouse.x / z; ty = camera.y - innerHeight/(2*z) + mouse.y / z;
		} else {
			// Find nearest animal, player, or resource object
			let best=null, bd=1e9; const consider = [];
			for (const a of animals){ if (a.hp>0){ consider.push({x:a.x,y:a.y}); } }
			// Other players
			for (const [id,p] of remotePlayers){ if (p.x!=null) consider.push({x:p.x,y:p.y}); }
			// Include self only for remote helpers (not for local to avoid self-focus)
			for (const o of worldObjects){ consider.push({x:o.x,y:o.y}); }
			for (const c of consider){ const d=Math.hypot(c.x-px,c.y-py); if (d<bd){ bd=d; best=c; } }
			if (best){ tx=best.x; ty=best.y; }
		}
		if (tx==null){ return {dx:Math.cos(this.angle), dy:Math.sin(this.angle)}; }
		const dx=tx-px, dy=ty-py; const len=Math.hypot(dx,dy)||1; return {dx:dx/len, dy:dy/len};
	}
	_drawEyes(g, px, py, radius){
		const eyeOffsetAngle = this.angle; // base facing
		const separation = radius*0.68; // wider distance between eyes
		const eyeR = radius*0.22; // larger eyes
		// Gracefully handle cases where _getGazeDirection is absent (e.g. remote helper objects)
		const desired = (this._getGazeDirection? this._getGazeDirection(px,py) : { dx: Math.cos(this.angle), dy: Math.sin(this.angle) });
		// Initialize on first draw to avoid slide-in from default
		if (!this._eyeInit){ this._eyeDx = desired.dx; this._eyeDy = desired.dy; this._eyeInit = true; }
		// Smooth toward desired direction (frame-rate independent approximation)
		const smooth = 0.22; // higher = faster response
		this._eyeDx += (desired.dx - this._eyeDx) * smooth;
		this._eyeDy += (desired.dy - this._eyeDy) * smooth;
		// Normalize to avoid drift length changes
		let len = Math.hypot(this._eyeDx, this._eyeDy) || 1; this._eyeDx/=len; this._eyeDy/=len;
		const dx = this._eyeDx, dy = this._eyeDy;
		// Eye positions relative to facing perpendicular
		const perp = eyeOffsetAngle + Math.PI/2;
		const exMidX = px + Math.cos(this.angle)*radius*0.23; // further forward
		const exMidY = py + Math.sin(this.angle)*radius*0.23;
		const leftX = exMidX + Math.cos(perp)*(-separation/2);
		const leftY = exMidY + Math.sin(perp)*(-separation/2);
		const rightX = exMidX + Math.cos(perp)*(separation/2);
		const rightY = exMidY + Math.sin(perp)*(separation/2);
		// Pupil displacement toward gaze
		const pupilRange = eyeR*0.50; // keep proportional movement
		const pdx = dx * pupilRange;
		const pdy = dy * pupilRange;
		g.save();
		g.fillStyle = '#ffffff'; g.strokeStyle='rgba(0,0,0,0.55)'; g.lineWidth=1.1;
		g.beginPath(); g.arc(leftX,leftY,eyeR,0,Math.PI*2); g.fill(); g.stroke();
		g.beginPath(); g.arc(rightX,rightY,eyeR,0,Math.PI*2); g.fill(); g.stroke();
		g.fillStyle='#2b2b2b';
		g.beginPath(); g.arc(leftX+pdx,leftY+pdy,eyeR*0.45,0,Math.PI*2); g.fill();
		g.beginPath(); g.arc(rightX+pdx,rightY+pdy,eyeR*0.45,0,Math.PI*2); g.fill();
		g.restore();
	}
	update(dt){
		// Store previous for interpolation
		this.prevX = this.x; this.prevY = this.y;
		// Eating apple logic
		if (this===myPlayer && eating){
			const dur = CONFIG.food.eatDuration;
			const elapsed = (now()-eatStart)/1000;
			eatT = elapsed / dur;
			if (eatT >= 1){
				myPlayer.hp = eatingTargetHP; // finalize
				resources.food = Math.max(0, resources.food - 1); updateResourceHUD();
				eating=false; eatT=0;
				// auto re-equip last non-food item if exists and still owned
				if (equippedItem==='apple'){
					if (lastNonFoodItem && hasItem(lastNonFoodItem)) equippedItem = lastNonFoodItem; else equippedItem = null;
					lastNonFoodItem = null;
				}
				if (resources.food<=0 && equippedItem==='apple') equippedItem=null; // empty if no more apples
				highlightEquipped?.();
			}else{
				// Smooth interpolate HP toward target during eating
				myPlayer.hp = eatingStartHP + (eatingTargetHP - eatingStartHP) * Math.min(1, eatT);
			}
		}
		// Movement
		const { accel, moveSpeed, friction } = CONFIG.player;
		let ax=0, ay=0;
		if (this.knockTimer <= 0){
			if (keys['KeyW']) ay -= 1;
			if (keys['KeyS']) ay += 1;
			if (keys['KeyA']) ax -= 1;
			if (keys['KeyD']) ax += 1;
		} else { this.knockTimer -= dt; }
		const mag = Math.hypot(ax,ay) || 1;
		ax/=mag; ay/=mag;
		this.vx += ax * accel * dt;
		this.vy += ay * accel * dt;
		// Speed clamp
		const sp = Math.hypot(this.vx,this.vy);
		const maxSp = moveSpeed;
		if (sp>maxSp){ const s=maxSp/sp; this.vx*=s; this.vy*=s; }
		// Friction
		const fr = Math.pow(friction, dt*60);
		this.vx *= fr; this.vy *= fr;
		if (this.knockTimer > 0){ // extra decay of knockback over its duration
			this.vx *= 0.90; this.vy *= 0.90;
		}
		this.x += this.vx * dt;
		this.y += this.vy * dt;
		// Angle toward mouse
		const z = CONFIG.camera.zoom || 1;
		const wx = camera.x - innerWidth/(2*z) + mouse.x / z;
		const wy = camera.y - innerHeight/(2*z) + mouse.y / z;
		this.angle = Math.atan2(wy - this.y, wx - this.x);
		// Punch timeline
		if (this.punchActive){
			const duration = 0.28;
			this.punchT += dt / duration;
			if (this.punchT >= 1){ this.punchT = 1; this.punchActive = false; }
		}
	}
	draw(g){
		const { radius, handRadius, skinBase, skinShade, outline, handOffsetMult } = CONFIG.player;
		// Improved punch / swing timeline with anticipation, fast mid, and follow-through.
		// rawExt ranges approx [-0.25, 1.1]; phase (0..1) for impact scaling.
		let rawExt=0, phase=0; if (!eating && (this.punchActive || this.punchT<1)){
			const t=this.punchT;
			const anticip=0.16; // longer anticipation
			const accelPeak=0.38; // when swing speed peaks / impact moment
			const follow=0.72; // end of follow-through decel phase
			if (t<anticip){ // ease-out backward pull
				const a=t/anticip; rawExt = -0.25 * (1 - (1-a)*(1-a));
			} else if (t<accelPeak){ // fast accelerate forward (ease-in power)
				const f=(t-anticip)/(accelPeak-anticip); rawExt = Math.pow(f,0.9);
			} else if (t<follow){ // slight overshoot then begin retract
				const f=(t-accelPeak)/(follow-accelPeak); rawExt = 1 + 0.10 * Math.sin(f*Math.PI*0.9) * (1-f*0.85);
			} else { // retract to rest
				const f=(t-follow)/(1-follow); rawExt = 1 - f*f*0.55;
			}
			phase = clamp(rawExt,0,1);
		}
		const holding = !!equippedItem;
		const eatingLocal = eating && this===myPlayer && equippedItem==='apple';
		const px = this.prevX + (this.x - this.prevX) * renderAlpha;
		const py = this.prevY + (this.y - this.prevY) * renderAlpha;
		let hxL,hyL,hxR,hyR; let strikeScale=1, restScale=1;
		g.save();
		if (holding){
			// Dynamic forward extension & arc width vary with rawExt for snappier feel
			const baseForward = radius*0.78; const forward = eatingLocal ? baseForward*0.70 : (baseForward + radius * 0.28 * phase); // closer while eating
			const gripWidth = radius*1.35;
			const perpAng=this.angle+Math.PI/2;
			// Swing angle: map rawExt (-back) to (forward) with acceleration and slight overshoot
			const swing = (rawExt-0.45)*1.25; // shift center slightly earlier
			const arcMag = 0.60; // base arc
			const adjPerp=perpAng + swing*arcMag;
			// Hands center with slight easing toward extension
			const cx=px+Math.cos(this.angle)*forward; const cy=py+Math.sin(this.angle)*forward;
			hxL=cx+Math.cos(adjPerp)*(-gripWidth/2); hyL=cy+Math.sin(adjPerp)*(-gripWidth/2);
			hxR=cx+Math.cos(adjPerp)*(gripWidth/2); hyR=cy+Math.sin(adjPerp)*(gripWidth/2);
			// Impact scaling & mild body squash
			strikeScale=1+phase*0.30; restScale=1+phase*0.18;
			if (phase>0){ const squash = 0.06*phase; const stretch=0.06*phase; g.translate(px,py); g.scale(1-squash,1+stretch); g.translate(-px,-py);} 
			g.fillStyle=skinBase; g.lineWidth=1.3; g.strokeStyle=outline;
			g.beginPath(); g.arc(hxL,hyL,handRadius*strikeScale,0,Math.PI*2); g.fill(); g.stroke();
			g.beginPath(); g.arc(hxR,hyR,handRadius*restScale,0,Math.PI*2); g.fill(); g.stroke();
			// Tool midpoint + lag (tool trails slightly behind rotation for weight feel)
			let midX=(hxL+hxR)/2, midY=(hyL+hyR)/2;
			midX+=Math.cos(this.angle)*radius*0.30; midY+=Math.sin(this.angle)*radius*0.30;
			// Tool rotational lag
			const lag = 0.20*(1-phase); // more lag early
			let toolAng=adjPerp+Math.PI - lag*(swing*0.9);
			if (equippedItem==='apple'){ toolAng += 3.45; }
			let scale= (equippedItem==='apple')? 0.95 : 1.38; let lift= (equippedItem==='apple'?0.02:0.06); let animPhase=phase;
			if (eatingLocal){ toolAng=this.angle; scale=0.90; lift=0.015; animPhase=0; }
			drawTool(g,equippedItem,midX,midY,toolAng,animPhase,scale,null,lift);
			if (eatingLocal){
				// bite mask effect (simple): draw an arc cutout
				const prog=eatT; if (prog>0){ g.save(); g.globalCompositeOperation='destination-out'; g.translate(midX,midY); g.rotate(toolAng); g.beginPath(); g.arc(12,0,24, -0.6+prog*1.2, 0.6+prog*1.2); g.fill(); g.restore(); }
			}
		}
		else {
			const strike=this.punchingHand; const baseOffset=radius*handOffsetMult; const strikeOffset=baseOffset + phase*radius*1.0; const restOffset=baseOffset - phase*radius*0.22 + (rawExt<0?rawExt*radius*0.30:0); const forwardBiasStrike=0.60+phase*0.30; const forwardBiasRest=0.42 - phase*0.08; const leftBias=(strike===0?forwardBiasStrike:forwardBiasRest); const rightBias=(strike===1?forwardBiasStrike:forwardBiasRest); const leftAng=this.angle + (Math.PI/2)*(1-leftBias); const rightAng=this.angle - (Math.PI/2)*(1-rightBias); hxL=px+Math.cos(leftAng)*(strike===0?strikeOffset:restOffset); hyL=py+Math.sin(leftAng)*(strike===0?strikeOffset:restOffset); hxR=px+Math.cos(rightAng)*(strike===1?strikeOffset:restOffset); hyR=py+Math.sin(rightAng)*(strike===1?strikeOffset:restOffset); if (phase>0){ const sx=1-0.09*phase, sy=1+0.09*phase; g.translate(px,py); g.scale(sx,sy); g.translate(-px,-py);} g.fillStyle=skinBase; g.lineWidth=1.3; g.strokeStyle=outline; const strikeScaleLocal=1+phase*0.60; const restScaleLocal=1-phase*0.18; g.beginPath(); g.arc(hxL,hyL,handRadius*(strike===0?strikeScaleLocal:restScaleLocal),0,Math.PI*2); g.fill(); g.stroke(); g.beginPath(); g.arc(hxR,hyR,handRadius*(strike===1?strikeScaleLocal:restScaleLocal),0,Math.PI*2); g.fill(); g.stroke(); if (equippedItem){ const midX=(hxL+hxR)/2, midY=(hyL+hyR)/2; const toolAng=this.angle + (strike===0?0.15:-0.15); drawTool(g,equippedItem,midX,midY,toolAng,phase,1.2,null,0.05); } }
		// Body
		g.beginPath(); g.arc(px,py,radius,0,Math.PI*2); const bodyGrad=g.createRadialGradient(px+radius*0.35,py+radius*0.4,radius*0.1,px,py,radius); bodyGrad.addColorStop(0,skinBase); bodyGrad.addColorStop(1,skinShade); let flash=0; const sinceHit=now()-this.lastPlayerHit; if (sinceHit<CONFIG.combat.hitFlashMs){ flash=1 - sinceHit/CONFIG.combat.hitFlashMs; }
		if (flash>0){ g.fillStyle='#ff3d2d'; g.globalAlpha=0.6+0.4*flash; g.fill(); g.globalAlpha=1; g.fillStyle=bodyGrad; g.globalAlpha=1-0.55*flash; g.fill(); g.globalAlpha=1; } else { g.fillStyle=bodyGrad; g.fill(); }
		g.lineWidth=1.3; g.strokeStyle=outline; g.stroke(); g.restore();
		// Eyes
		this._drawEyes(g, px, py, radius);
		// Name Tag (simplified: no background, outlined text)
		const baseName = this.name;
		const nameY = py - radius - 18; // baseline reference
		g.save();
		g.font = '600 19px Rubik, sans-serif';
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		// Stroke outline first
		g.lineWidth = 1.3;
		g.strokeStyle = 'rgba(0,0,0,0.85)';
		g.lineJoin = 'round';
		g.miterLimit = 2;
		g.strokeText(baseName, px, nameY);
		// Fill text
		g.fillStyle = '#ffffff';
		g.fillText(baseName, px, nameY);
		g.restore();
	}
}
let screenShakeTime = 0; // for smooth shake phase accumulation

// ===== Camera =====
const camera = { x:0, y:0 };
function updateCamera(dt, player) {
	// desired center is player plus lookahead from velocity
	const lookMag = clamp(Math.hypot(player.vx, player.vy) * CONFIG.camera.lookAhead, 0, CONFIG.camera.maxLook);
	const dir = Math.atan2(player.vy, player.vx);
	const lx = isNaN(dir) ? 0 : Math.cos(dir) * lookMag;
	const ly = isNaN(dir) ? 0 : Math.sin(dir) * lookMag;
	const targetX = player.x + lx;
	const targetY = player.y + ly;
	camera.x = lerp(camera.x, targetX, 1 - Math.pow(1 - CONFIG.camera.smooth, dt*60));
	camera.y = lerp(camera.y, targetY, 1 - Math.pow(1 - CONFIG.camera.smooth, dt*60));
	// Clamp camera to map (keeping screen inside bounds)
	const z = CONFIG.camera.zoom || 1;
	const halfW = innerWidth/(2*z); const halfH = innerHeight/(2*z);
	camera.x = clamp(camera.x, halfW, CONFIG.map.width - halfW);
	camera.y = clamp(camera.y, halfH, CONFIG.map.height - halfH);
}

// ===== World Rendering =====
function drawGrid(g) {
	const { grid, width, height, bgColor } = CONFIG.map;
	// Plain background (entire map once per frame)
	g.fillStyle = bgColor;
	g.fillRect(0,0,width,height);
	// Regular grid lines only
	g.lineWidth = 1.3;
	g.strokeStyle = 'rgba(255,255,255,0.06)';
	const z = CONFIG.camera.zoom || 1;
	const viewHalfW = innerWidth/(2*z);
	const viewHalfH = innerHeight/(2*z);
	const startX = Math.floor((camera.x - viewHalfW) / grid) * grid;
	const endX = Math.floor((camera.x + viewHalfW) / grid) * grid;
	const startY = Math.floor((camera.y - viewHalfH) / grid) * grid;
	const endY = Math.floor((camera.y + viewHalfH) / grid) * grid;
	const half = (CONFIG.render?.pixelSnap) ? 0.5 : 0;
	g.beginPath();
	for (let x = startX; x <= endX; x += grid) { g.moveTo(x+half, startY); g.lineTo(x+half, endY); }
	for (let y = startY; y <= endY; y += grid) { g.moveTo(startX, y+half); g.lineTo(endX, y+half); }
	g.stroke();
}

function clear(g) { /* Plain background handled in drawGrid */ }

// ===== Game State =====
let myPlayer = null;
let inGame = false;
const worldObjects = []; // {type,x,y,hp,maxHP,variant}
	const worldObjectsById = new Map();
const resources = { wood:0, stone:0, food:0 };
let lastGatherAttempt = 0;
const hitEffects = []; // particle bursts when hitting
let screenShake = 0; // shake magnitude
let renderAlpha = 1; // interpolation factor for rendering
let menuCamT = 0; // menu camera time accumulator
let menuSimSeeded = false; // world generated for menu backdrop

// ===== UI / Menu =====
const menuEl = document.getElementById('main-menu');
const hudEl = document.getElementById('hud');
const hudName = document.getElementById('hud-name');
const deathScreenEl = document.getElementById('death-screen');
const btnRespawn = document.getElementById('btn-respawn');
const btnLeave = document.getElementById('btn-leave');
// Extended UI elements (floating gear & settings)
const settingsButton = document.getElementById('btn-settings');
const overlayEl = document.getElementById('overlay');
const settingsModalEl = document.getElementById('settings-modal');
const fpsToggle = document.getElementById('opt-fps');
const btnCloseSettings = document.getElementById('btn-close-settings');
document.getElementById('btn-play').addEventListener('click', () => {
	const name = (document.getElementById('player-name').value || 'Player').trim();
	startGame(name);
});
addEventListener('keydown', e => {
	if (e.code === 'Escape') {
		if (inGame) toggleMenu();
	}
});

function toggleMenu(force) {
	const show = force !== undefined ? force : menuEl.classList.contains('hidden');
	if (show) {
		// If host is returning to menu, close server
		if (isHost) hostShutdown();
		// Audio: switch to menu track
		stopAmbient(); playMenuMusic();
		menuEl.classList.remove('hidden');
		hudEl.classList.add('hidden');
		settingsButton.classList.add('hidden');
		inGame = false;
		canvas.classList.add('menu-blur');
		// Seed world once for animated background
		if (!menuSimSeeded){ try { generateWorld(); menuSimSeeded=true; } catch(e) { console.warn('menu world gen failed', e); } }
	} else {
		menuEl.classList.add('hidden');
		hudEl.classList.remove('hidden');
		settingsButton.classList.remove('hidden');
		inGame = true;
		canvas.classList.remove('menu-blur');
		// Audio: leave menu -> stop menu music & schedule ambient loop (immediate first play)
		stopMenuMusic(); scheduleAmbientMusic(true);
	}
}

function startGame(name) {
	myPlayer = new Player(name);
	myPlayer.hp = CONFIG.playerStats.maxHP;
	hudName.textContent = name;
	toggleMenu(false);
	if (deathScreenEl) deathScreenEl.classList.add('hidden');
	// Force-hide multiplayer menu if still open (joining path)
	if (typeof mpMenu !== 'undefined' && mpMenu && !mpMenu.classList.contains('hidden')) mpMenu.classList.add('hidden');
	if (!menuSimSeeded){ generateWorld(); menuSimSeeded=true; }
	camera.x = myPlayer.x; camera.y = myPlayer.y;
	updateResourceHUD();
	showHotbar();
	// Sync settings UI state (FPS toggle)
	fpsToggle.checked = CONFIG.debug.showFps;
	// Audio: ensure ambient schedule if not already (startGame might be invoked directly from multiplayer connection)
	stopMenuMusic(); scheduleAmbientMusic(true);
}

// ===== Settings & Overlay Logic =====
function openSettings() {
	fpsToggle.checked = CONFIG.debug.showFps;
	settingsModalEl.classList.remove('hidden');
	overlayEl.classList.add('active');
	overlayEl.setAttribute('aria-hidden','false');
}
function closeSettings() {
	settingsModalEl.classList.add('hidden');
	overlayEl.classList.remove('active');
	overlayEl.setAttribute('aria-hidden','true');
}
settingsButton?.addEventListener('click', () => openSettings());
btnCloseSettings?.addEventListener('click', () => closeSettings());
overlayEl?.addEventListener('click', () => closeSettings());
fpsToggle?.addEventListener('change', () => { CONFIG.debug.showFps = fpsToggle.checked; });

// ===== Death & Respawn =====
function handleLocalDeath(){
	if (!myPlayer || myPlayer.dead) return;
	myPlayer.dead = true;
	if (deathScreenEl){ deathScreenEl.classList.remove('hidden'); }
	if (hudEl) hudEl.classList.add('hidden');
}
function respawnPlayer(){
	if (!myPlayer) return;
	myPlayer.dead = false;
	myPlayer.hp = CONFIG.playerStats.maxHP;
	myPlayer.x = CONFIG.map.width/2 + (Math.random()*200-100);
	myPlayer.y = CONFIG.map.height/2 + (Math.random()*200-100);
	myPlayer.vx = myPlayer.vy = 0;
	myPlayer.lastPlayerHit = -9999;
	if (deathScreenEl) deathScreenEl.classList.add('hidden');
	if (hudEl) hudEl.classList.remove('hidden');
}
btnRespawn?.addEventListener('click', () => respawnPlayer());
btnLeave?.addEventListener('click', () => { if (deathScreenEl) deathScreenEl.classList.add('hidden'); toggleMenu(true); });

function hostShutdown(){
	if (!isHost) return;
	// Notify connected clients
	for (const { dc } of hostPeers.values()) if (dc.readyState==='open') { try { dc.send(JSON.stringify({ t:'hostClose' })); } catch {} }
	// Close all peer connections
	for (const { pc, dc } of hostPeers.values()){
		try { dc.close(); } catch {}
		try { pc.close(); } catch {}
	}
	if (pendingHostPeer){ try { pendingHostPeer.dc.close(); } catch{} try { pendingHostPeer.pc.close(); } catch{} pendingHostPeer=null; }
	hostPeers.clear();
	isHost = false;
}

// ===== Multiplayer (Peer-to-Peer WebRTC manual signaling) =====
const mpMenu = document.getElementById('mp-menu');
const btnMp = document.getElementById('btn-mp');
const btnBackMenu = document.getElementById('btn-back-menu');
const btnHost = document.getElementById('btn-host');
const hostSection = document.getElementById('host-section');
const taHostOffer = document.getElementById('host-offer');
const taHostAnswer = document.getElementById('host-answer');
const btnApplyAnswer = document.getElementById('btn-apply-answer');
const taJoinOffer = document.getElementById('join-offer');
const taJoinAnswer = document.getElementById('join-answer');
// Simplified UI extra elements
const hostStatusEl = document.getElementById('host-status');
const hostPlayerCountEl = document.getElementById('host-player-count');

let isHost = false;
// Multi-peer: host maintains many peer connections; client has one
let rtcPeer = null; // joining peer's single connection OR temporary during host offer creation
let dataChannel = null; // joining client single channel
const hostPeers = new Map(); // id -> { pc, dc }
const remotePlayers = new Map(); // id -> {x,y,name,punchT,punchActive,hand}
// Track remote resources (authoritative server copy). Initialized lazily when host receives first state.
const remoteResources = new Map(); // id -> { wood, stone, food }
// Resource sync throttle for client
let _lastResourceSync = 0;

function showMpMenu(){
	menuEl.classList.add('hidden');
	mpMenu.classList.remove('hidden');
}
function hideMpMenu(){
	mpMenu.classList.add('hidden');
	menuEl.classList.remove('hidden');
}
btnMp?.addEventListener('click', showMpMenu);
btnBackMenu?.addEventListener('click', hideMpMenu);

// Hosting flow (one-at-a-time manual handshake but keeps multiple connections)
let pendingHostPeer = null; // { pc, dc }
async function startHost(){
	isHost = true;
	createNewHostOffer();
	hostSection.classList.remove('hidden');
}
async function createNewHostOffer(){
	// create a fresh RTCPeerConnection waiting for a joiner
	const pc = new RTCPeerConnection({ iceServers: [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' }
	] });
	const dc = pc.createDataChannel('game');
	const joinId = Math.random().toString(36).slice(2,9);
	pendJoinId = joinId;
	pendingHostPeer = { pc, dc, id: joinId };
	wireDataChannel(dc, joinId);
	pc.onicecandidate = e=>{ if (e.candidate) return; taHostOffer.value = btoa(JSON.stringify({ sdp: pc.localDescription, id: joinId })); };
	await pc.setLocalDescription(await pc.createOffer());
}
let pendJoinId = null;
async function applyAnswer(){
	if (!pendingHostPeer) return;
	const txt = taHostAnswer.value.trim();
	if (!txt) return;
	let parsed; try { parsed = JSON.parse(atob(txt)); } catch { return; }
	if (parsed.id && parsed.id !== pendJoinId) { console.warn('Answer id mismatch'); return; }
	// Guard against race / duplicate apply
	const state = pendingHostPeer.pc.signalingState;
	if (state === 'stable'){ console.warn('Answer already applied (state stable), ignoring duplicate'); return; }
	if (state !== 'have-local-offer') { console.warn('Unexpected signaling state ('+state+'), skipping applyAnswer'); return; }
	try { await pendingHostPeer.pc.setRemoteDescription(parsed.sdp); }
	catch(err){
		// Suppress noisy duplicate warnings by checking state again
		if (pendingHostPeer.pc.signalingState === 'stable'){ console.warn('Remote description already set, ignoring'); return; }
		console.warn('setRemoteDescription failed', err); return;
	}
	// Move to active peers list now that connection established
	hostPeers.set(pendJoinId, { pc: pendingHostPeer.pc, dc: pendingHostPeer.dc });
	pendingHostPeer = null; pendJoinId = null; taHostAnswer.value='';
	// Generate another offer for additional players
	createNewHostOffer();
}
let joiningInProgress = false;
async function joinHost(){
	if (joiningInProgress) return;
	joiningInProgress = true;
	isHost = false;
	rtcPeer = new RTCPeerConnection({ iceServers: [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' }
	] });
	rtcPeer.ondatachannel = e=>{ dataChannel = e.channel; wireDataChannel(e.channel, 'host'); };
	let currentOfferId = null;
	rtcPeer.onicecandidate = e=>{ if (e.candidate) return; const payload = { sdp: rtcPeer.localDescription }; if (currentOfferId) payload.id = currentOfferId; taJoinAnswer.value = btoa(JSON.stringify(payload)); if (joinStatusEl) joinStatusEl.textContent='Send this reply to host then click Enter World'; if (btnEnter) btnEnter.disabled=false; };
	const offerText = taJoinOffer.value.trim();
	if (!offerText){ if (joinStatusEl) joinStatusEl.textContent='Host code required'; joiningInProgress=false; return; }
	let parsed; try { parsed = JSON.parse(atob(offerText)); } catch { if (joinStatusEl) joinStatusEl.textContent='Invalid host code'; joiningInProgress=false; return; }
	if (parsed.id) currentOfferId = parsed.id;
	await rtcPeer.setRemoteDescription(parsed.sdp).catch(err=>{ console.warn('join setRemoteDescription failed', err); joiningInProgress=false; return; });
	if (rtcPeer.signalingState === 'closed'){ joiningInProgress=false; return; }
	await rtcPeer.setLocalDescription(await rtcPeer.createAnswer());
	joiningInProgress = false;
}
const joinStatusEl = document.getElementById('join-status');

function wireDataChannel(dc, remoteId){
	if (!dc) return;
	dc.onopen = ()=>{
		// data channel opened
		if (!inGame){ const name=(document.getElementById('player-name').value||'Player').trim(); startGame(name); }
		// Hide mp menu for host on first successful connection if still visible
		if (isHost && mpMenu && !mpMenu.classList.contains('hidden')){ mpMenu.classList.add('hidden'); }
		// send initial world snapshot (host only)
		if (isHost){ sendWorldSnapshot(dc); }
		if (isHost && hostStatusEl){ hostStatusEl.textContent = 'Player connected. Total: '+ hostPeers.size; }
		if (!isHost && joinStatusEl){ joinStatusEl.textContent='Connected!'; if (!mpMenu.classList.contains('hidden')) hideMpMenu(); }
	};
	dc.onmessage = e=>{
		if (e.data instanceof ArrayBuffer){ handleBinaryComboPacket(e.data); return; }
		if (e.data && typeof e.data !== 'string' && e.data.byteLength){ handleBinaryComboPacket(e.data); return; }
		try { const msg = JSON.parse(e.data); handleNetMessage(msg, dc, remoteId); } catch {}
	};
	dc.onclose = ()=>{
		if (isHost){
			for (const [id,obj] of hostPeers){ if (obj.dc===dc){ hostPeers.delete(id); remotePlayers.delete(id); break; } }
			if (hostStatusEl) hostStatusEl.textContent = 'Player left. Total: '+ hostPeers.size;
			if (hostPlayerCountEl) hostPlayerCountEl.textContent = '('+ hostPeers.size +' joined)';
		}
	};
}

function handleNetMessage(msg, dc, remoteId){
	if (msg.t === 'hostClose'){
		// Host shutting down
		if (!isHost){
			inGame = false;
			if (joinStatusEl) joinStatusEl.textContent = 'Host disconnected';
			if (deathScreenEl) deathScreenEl.classList.add('hidden');
			if (!menuEl.classList.contains('hidden')){} else toggleMenu(true);
		}
		return;
	}
	if (msg.t === 'ping'){
		// echo back to measure RTT at sender
		if (dc && dc.readyState==='open') dc.send(JSON.stringify({ t:'pong', ts: msg.ts }));
		return;
	}
	if (msg.t === 'pong'){
		if (typeof msg.ts === 'number'){
			const rtt = now() - msg.ts;
			pingMs = pingMs==null ? rtt : (pingMs*0.6 + rtt*0.4);
		}
		return;
	}
	if (msg.t === 'inp'){
		// Host receives raw input; store for simulation
		if (isHost && remoteId){ const inp={ dx:msg.dx||0, dy:msg.dy||0, ang:msg.ang||0, seq:msg.seq||0 }; _hostPlayerInputs.set(remoteId, inp); }
		return;
	}
	if (msg.t === 'pushCorr'){
		for (const rp of msg.players){
			if (rp.id === myNetId){
				if (!myPlayer) continue;
				const err = Math.hypot(myPlayer.x - rp.x, myPlayer.y - rp.y);
				if (err > 4){
					myPlayer.x = rp.x; myPlayer.y = rp.y; myPlayer.vx=0; myPlayer.vy=0;
					// prune confirmed inputs
					const replay = _pendingInputs.filter(i=>i.seq > rp.seq);
					_pendingInputs = replay.slice(-80);
					for (const inp of replay){ _simulateMoveStep(myPlayer, inp.dx, inp.dy, inp.ang, 1/60); }
				}
				continue;
			}
			const p = remotePlayers.get(rp.id); if (!p) continue; p.prevX = p.x; p.prevY = p.y; p.x = rp.x; p.y = rp.y;
		}
		return;
	}
	if (msg.t === 'pHit'){
		// Player got hit (either us or a remote player)
		if (msg.id === myNetId && myPlayer){
			myPlayer.hp = clamp(msg.hp,0,CONFIG.playerStats.maxHP); myPlayer.lastPlayerHit = now(); screenShake = Math.min(screenShake+3,10); spawnBloodEffect(myPlayer.x,myPlayer.y);
			// Apply networked knockback impulse if provided
			if (msg.kx!=null && msg.ky!=null){ myPlayer.vx = (myPlayer.vx||0) + msg.kx; myPlayer.vy = (myPlayer.vy||0) + msg.ky; myPlayer.knockTimer = 0.18; }
		}else{
			const p = remotePlayers.get(msg.id); if (p){ p.hp = clamp(msg.hp,0,CONFIG.playerStats.maxHP); p.lastPlayerHit = now(); spawnBloodEffect(p.x,p.y); if (msg.kx!=null && msg.ky!=null){ p.vx = (p.vx||0)+msg.kx; p.vy = (p.vy||0)+msg.ky; p.knockTimer=0.18; } }
		}
		return;
	}
	if (msg.t === 'attack'){
		// Reliable attack trigger from client; host processes (ignore if not host)
		if (isHost){
			const rid = remoteId; if (rid){ const p = remotePlayers.get(rid); if (p){ p.punchActive = true; p.punchT = 0; p.eq = msg.eq || p.eq; p.angle = typeof msg.angle==='number'? msg.angle : p.angle; processPlayerAttack(p, rid, msg); } }
		}
		return;
	}
	if (msg.t === 'state'){
		for (const rp of msg.players){
			if (rp.id === myNetId) continue;
			let p = remotePlayers.get(rp.id);
			if (!p){ p = {}; remotePlayers.set(rp.id,p); }
			if (p.x === undefined){ p.x = rp.x; p.y = rp.y; p.prevX = rp.x; p.prevY = rp.y; }
			else { p.prevX = p.x; p.prevY = p.y; }
			const oldAngle = p.angle;
			const wasPunching = p.punchActive;
			Object.assign(p,rp);
			p.eq = rp.eq || null; // equipped tool id
			// Track previous angle for smoothing (shortest arc interpolation later)
			if (oldAngle === undefined) p.prevAngle = p.angle; else p.prevAngle = oldAngle;
			p.lastUpdate = now();
			p.basePunchT = rp.punchT; p.basePunchUpdate = p.lastUpdate;
			// Host processes remote player's attack onset
			if (isHost && p.punchActive && !wasPunching){ processPlayerAttack(p, rp.id, rp); }
		}
		// Host relays state from one client to others (simple broadcast)
		if (isHost && dc){
			broadcastStateToOthers(dc);
		}
	}
	else if (msg.t === 'hit'){
		const o = worldObjectsById.get(msg.id);
		if (o){
			o.lastHit = now(); spawnHitEffect(o.x,o.y,o.type);
		}
		if (isHost && dc){ broadcastHitToOthers(dc, msg.id); }
	}
	else if (msg.t === 'worldSnapshot'){
		// Replace local world with host's authoritative version
		worldObjects.length = 0;
		for (const o of msg.objects){ worldObjects.push(o); }
		worldObjectsById.clear(); for (const o of worldObjects) worldObjectsById.set(o.id,o);
		if (msg.structures){ structures.length = 0; for (const s of msg.structures){ structures.push(s); } }
	}
	else if (msg.t === 'placeStruct'){
		// Host broadcasts placement to clients (or echo). Reconcile predicted ghost if present.
		if (msg.s){
			// received structure placement
			let existing = structures.find(z=>z.id===msg.s.id);
			if (existing){
				// Overwrite predicted ghost with authoritative data
				existing.type = msg.s.type; existing.x = msg.s.x; existing.y = msg.s.y;
				existing.hp = msg.s.hp; existing.maxHP = msg.s.maxHP; existing.rad = msg.s.rad;
				existing.passPlayer = msg.s.passPlayer; existing.passAnimals = msg.s.passAnimals;
				delete existing._pred;
			}else{
				structures.push({ ...msg.s });
			}
			// Originating client: reconcile resources & ensure no rollback will remove structure
			if (!isHost && msg.orig === myNetId){
				if (msg.res){ for (const k in msg.res){ resources[k]=msg.res[k]; } updateResourceHUD?.(); }
			}
		}
	}
	else if (msg.t === 'structHit'){
		// Structure took damage; update hp and show feedback
		const s = structures.find(z=>z.id===msg.id);
		if (s){
			s.hp = msg.hp;
			s._hitFlash = now();
			// Spawn hit particles (derive FX type from structure type or provided st)
			const stType = msg.st || s.type;
			try { const fxType = (stType && stType.indexOf('stone')!==-1) ? 'stone' : 'tree'; spawnHitEffect(s.x, s.y, fxType); } catch(e) { /* ignore */ }
			// If destroyed (hp==0) host will send structGone separately; don't remove here
		}
	}
	else if (msg.t === 'structGone'){
		const idx = structures.findIndex(z=>z.id===msg.id);
		if (idx>=0) structures.splice(idx,1);
	}
	else if (msg.t === 'buildReq'){
		// Only host should process and then broadcast result
		if (!isHost) return;
		// host received build request
		const rid = remoteId; if (!rid) return; // must be known peer
		let rp = remotePlayers.get(rid); if (!rp){ rp={ id:rid, x:null, y:null }; remotePlayers.set(rid,rp); }
		const { kind, x, y, cid, res:clientRes } = msg; const rec = BUILD_RECIPES[kind]; if (!rec){ console.warn('[host] buildReq unknown kind', kind); return; }
		if (clientRes){ let snap = remoteResources.get(rid); if (!snap){ snap={ wood:0,stone:0,food:0 }; remoteResources.set(rid,snap); } for (const k of ['wood','stone','food']) if (typeof clientRes[k]==='number') snap[k]=clientRes[k]; }
		let rRes = remoteResources.get(rid); if (!rRes){ rRes = { wood: 0, stone: 0, food: 0 }; remoteResources.set(rid, rRes); }
		// Relaxed checks
		let costBlocked=false; for (const k in rec.cost){ if ((rRes[k]||0) < rec.cost[k]) costBlocked=true; }
		if (costBlocked && !clientRes){ console.warn('[host] buildReq rejected cost'); return; }
		if (rp.x!=null && rp.y!=null){ const dx=x-rp.x, dy=y-rp.y; const dist=Math.hypot(dx,dy); if (dist>BUILD_PLACE_DIST+120){ console.warn('[host] buildReq rejected distance', dist); return; } }
		if (!canPlaceStructure(x,y, rec.rad)){ console.warn('[host] buildReq rejected overlap/bounds'); return; }
		for (const k in rec.cost){ if ((rRes[k]||0) >= rec.cost[k]) rRes[k]-=rec.cost[k]; else rRes[k]=0; }
		const sId = cid && typeof cid==='string'? cid : ('s'+Math.random().toString(36).slice(2,9));
		let existing = structures.find(z=>z.id===sId);
		if (!existing){ existing = { id:sId, type:kind, x, y, hp:rec.hp, maxHP:rec.maxHP, rad:rec.rad, passPlayer:rec.passPlayer, passAnimals:rec.passAnimals }; structures.push(existing); }
		else { existing.type=kind; existing.x=x; existing.y=y; existing.hp=rec.hp; existing.maxHP=rec.maxHP; delete existing._pred; }
		const payload = JSON.stringify({ t:'placeStruct', s: existing, orig: rid, res: rRes });
		for (const { dc } of hostPeers.values()) if (dc.readyState==='open'){ dc.send(payload); }
		const peer = hostPeers.get(rid); if (peer && peer.dc && peer.dc.readyState==='open'){ peer.dc.send(JSON.stringify({ t:'resources', set: rRes })); }
	}
	else if (msg.t === 'resourcesSet'){
		// Remote client declaring its resources (host authoritative copy update)
		if (!isHost) return;
		const rid = remoteId; if (!rid) return;
		let rRes = remoteResources.get(rid); if (!rRes){ rRes = { wood:0,stone:0,food:0 }; remoteResources.set(rid, rRes); }
		if (msg.set){ for (const k in msg.set){ if (typeof msg.set[k]==='number') rRes[k]=msg.set[k]; } }
	}
	else if (msg.t === 'resources'){
		// Sync resource delta or absolute from host
		if (msg.set){ for (const k in msg.set){ resources[k]=msg.set[k]; } updateResourceHUD?.(); }
	}
	else if (msg.t === 'animals'){
		if (!isHost){
			const nowT = now();
			const map = new Map(); for (const a of animals) map.set(a.id,a);
			for (const a of animals) a._updated=false;
			for (const na of msg.list){
				let a = map.get(na.id);
				// removed stray broadcast line that referenced undefined payload (bug)
				if (!a){
					a = { id:na.id, type:na.type, x:na.x, y:na.y, prevX:na.x, prevY:na.y, heading:newHeading, prevHeading:newHeading, hp:na.hp, dead:na.dead, vx:na.vx||0, vy:na.vy||0, lastUpdate: nowT, snaps: [] };
					animals.push(a);
				} else {
					a.prevX=a.x; a.prevY=a.y; a.prevHeading=a.heading; a.x=na.x; a.y=na.y; a.vx=na.vx||0; a.vy=na.vy||0; a.heading=newHeading; a.hp=na.hp; a.dead=na.dead; a.type=na.type; a.lastUpdate=nowT;
				}
				// Snapshot buffering for position smoothing
				if (!a.snaps) a.snaps=[];
				a.snaps.push({ t: nowT, x: a.x, y: a.y, heading: a.heading });
				if (a.snaps.length>14) a.snaps.splice(0, a.snaps.length-14);
				a._updated=true;
			}
			for (let i=animals.length-1;i>=0;i--){ if (!animals[i]._updated) animals.splice(i,1); }
		}
	}
	else if (msg.t === 'combo'){
		// Combined player state (single host player) + animal delta list
		if (!isHost){
			if (typeof msg.seq === 'number'){
				if (window._lastComboSeq != null && msg.seq > window._lastComboSeq + 1){
					window._animalRenderDelay = Math.min(240, (window._animalRenderDelay||120) * 1.25);
				}else if (window._lastComboSeq != null && msg.seq === window._lastComboSeq + 1){
					if (window._animalRenderDelay && window._animalRenderDelay > 120) window._animalRenderDelay -= 5;
				}
				window._lastComboSeq = msg.seq;
			}
			if (msg.state){ // treat like state for host player only (ignored if our id)
				if (msg.state.id !== myNetId){
					let p = remotePlayers.get(msg.state.id); if (!p){ p={}; remotePlayers.set(msg.state.id,p); }
					if (p.x===undefined){ p.x=msg.state.x; p.y=msg.state.y; p.prevX=msg.state.x; p.prevY=msg.state.y; } else { p.prevX=p.x; p.prevY=p.y; }
					const oldAngle=p.angle; Object.assign(p,msg.state); if (oldAngle===undefined) p.prevAngle=p.angle; else p.prevAngle=oldAngle; p.lastUpdate=now();
				}
			}
			if (Array.isArray(msg.animals)){
				const nowT=now();
				const byId=new Map(); for (const a of animals) byId.set(a.id,a);
				for (const d of msg.animals){
					if (d.gone){ const idx=animals.findIndex(a=>a.id===d.id); if (idx>=0) animals.splice(idx,1); continue; }
					if (d.nid!=null && d.id){ // mapping entry
						_nidToOrig.set(d.nid, d.id); if (!_origToNid.has(d.id)) _origToNid.set(d.id,d.nid);
						continue; // mapping entries don't carry pos
					}
					let a = byId.get(d.id);
					if (!a){
						if (!d.x||d.y===undefined) continue; // need full data
						a = { id:d.id, type:d.type||'?', x:d.x, y:d.y, prevX:d.x, prevY:d.y, heading:d.heading||0, prevHeading:d.heading||0, hp:d.hp||0, dead:!!d.dead, lastUpdate:nowT, snaps:[] };
						animals.push(a); byId.set(a.id,a);
					}else{
						if (d.x!==undefined && d.y!==undefined){ a.prevX=a.x; a.prevY=a.y; a.x=d.x; a.y=d.y; }
						if (d.heading!==undefined){ a.prevHeading=a.heading; a.heading=d.heading; }
						if (d.hp!==undefined) a.hp=d.hp; if (d.dead!==undefined) a.dead=!!d.dead; if (d.type) a.type=d.type;
						if (a.snaps){ a.snaps.push({ t:nowT, x:a.x,y:a.y,heading:a.heading }); if (a.snaps.length>14) a.snaps.splice(0,a.snaps.length-14); }
					}
					a.lastUpdate=nowT; // for alpha fallback
				}
				// Adaptive interpolation delay update (track spacing)
				if (!window._animalInterArrivals) window._animalInterArrivals=[];
				const arr=window._animalInterArrivals; arr.push(nowT); if (arr.length>20) arr.shift();
				if (arr.length>=3){
					let intervals=[]; for (let i=1;i<arr.length;i++) intervals.push(arr[i]-arr[i-1]);
					intervals.sort((a,b)=>a-b); const mid=intervals[Math.floor(intervals.length/2)]||80; window._animalRenderDelay = Math.min(200, Math.max(60, mid*1.6));
				}
			}
		}
		return; // combo handled
	}
	else if (msg.t === 'aHit'){
		// Remote animal hit particle
		if (!isHost){ spawnBloodEffect(msg.x, msg.y); }
	}
	else if (msg.t === 'chat'){
		// Chat from remote or host relay
		const from = msg.from || remoteId || myNetId; // if host echo, include from field
		pushChatMessage(from, msg.text||'');
		// Host relays to others (excluding sender dc)
		if (isHost && dc){ for (const { dc:dc2 } of hostPeers.values()) if (dc2!==dc && dc2.readyState==='open') dc2.send(JSON.stringify({ t:'chat', from, text: msg.text })); }
	}
}

let myNetId = Math.random().toString(36).slice(2,9);
// --- Network aggregation / delta state ---
let _netTickCounter = 0;
const ANIMAL_FULL_EVERY = 24; // every ~2s at 12Hz
let _lastAnimalSnapshot = new Map(); // id -> {x,y,hp,heading,dead}
let _animalsLastInInterest = new Set();
let _comboSeq = 0; // sequence numbering for combo packets
const ANIMAL_INTEREST_RADIUS = 900; // px radius per player for inclusion
// --- Binary combo packet support (experimental) ---
const USE_BINARY_COMBO = true; // set false to fall back to JSON-only
let _nextAnimalNid = 1; // host-side incremental numeric ids for animals
function ensureAnimalNid(a){ if (a._nid == null) a._nid = _nextAnimalNid++; }
// Mapping for numeric id <-> original id (client side uses to reconcile gone events)
const _nidToOrig = new Map(); // nid -> original string id
const _origToNid = new Map(); // original id -> nid
// === Prediction & Reconciliation Setup ===
let _inputSeq = 0; // client input sequence counter
let _pendingInputs = []; // unacknowledged inputs for replay
let _lastInputSend = 0; const INPUT_SEND_INTERVAL = 1000/30; // 30Hz
const _hostPlayerInputs = new Map(); // host: playerId -> latest input
function _gatherMoveAxis(){ if (chatInputActive) return {dx:0,dy:0}; let dx=0,dy=0; if (keys['KeyW']) dy-=1; if (keys['KeyS']) dy+=1; if (keys['KeyA']) dx-=1; if (keys['KeyD']) dx+=1; const m=Math.hypot(dx,dy)||1; return {dx:dx/m, dy:dy/m}; }
function _maybeSendInput(){ if (isHost||!inGame||!dataChannel||dataChannel.readyState!=='open'||!myPlayer) return; const t=now(); if (t-_lastInputSend<INPUT_SEND_INTERVAL) return; _lastInputSend=t; const {dx,dy}=_gatherMoveAxis(); const ang=myPlayer.angle||0; const seq=_inputSeq++; const pkt={ t:'inp', seq, dx, dy, ang }; try{ dataChannel.send(JSON.stringify(pkt)); }catch{} _pendingInputs.push(pkt); if (_pendingInputs.length>120) _pendingInputs.splice(0,_pendingInputs.length-120); }
setInterval(_maybeSendInput, 8);
function _simulateMoveStep(p, dx, dy, ang, dt){ const { accel, moveSpeed, friction } = CONFIG.player; if (p.vx==null) p.vx=0; if (p.vy==null) p.vy=0; const mag=Math.hypot(dx,dy)||1; dx/=mag; dy/=mag; p.vx += dx*accel*dt; p.vy += dy*accel*dt; const sp=Math.hypot(p.vx,p.vy); if (sp>moveSpeed){ const s=moveSpeed/sp; p.vx*=s; p.vy*=s; } const fr=Math.pow(friction,dt*60); p.vx*=fr; p.vy*=fr; p.x+=p.vx*dt; p.y+=p.vy*dt; p.x=clamp(p.x,CONFIG.player.radius,CONFIG.map.width-CONFIG.player.radius); p.y=clamp(p.y,CONFIG.player.radius,CONFIG.map.height-CONFIG.player.radius); if (typeof ang==='number') p.angle=ang; }
if (isHost) setInterval(()=>{ for (const [id,p] of remotePlayers){ const inp=_hostPlayerInputs.get(id); if (!inp) continue; _simulateMoveStep(p, inp.dx, inp.dy, inp.ang, 1/60); } if (remotePlayers.size){ if (Math.random()<0.2){ const corr=[]; for (const [id,p] of remotePlayers){ const inp=_hostPlayerInputs.get(id); corr.push({ id, x:p.x, y:p.y, seq: inp?inp.seq:0 }); } const payload=JSON.stringify({ t:'pushCorr', players: corr }); for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(payload); } } }, 1000/60);
function buildAnimalDelta(){
	const changed = [];
	// In single-player (no peers), include all animals (skip interest culling to avoid pop-in)
	const playersPos=[]; if (myPlayer) playersPos.push({x:myPlayer.x,y:myPlayer.y}); for (const [id,p] of remotePlayers){ if (p.x!=null) playersPos.push({x:p.x,y:p.y}); }
	const singlePlayer = !remotePlayers.size && hostPeers.size===0;
	function inInterest(a){ if (singlePlayer) return true; if (!playersPos.length) return true; const R2 = ANIMAL_INTEREST_RADIUS*ANIMAL_INTEREST_RADIUS; const ax=a.x, ay=a.y; for (const pl of playersPos){ const dx=pl.x-ax, dy=pl.y-ay; if (dx*dx+dy*dy <= R2) return true; } return false; }
	const currentInterest = new Set();
	for (const a of animals){
		if (!inInterest(a)) continue;
		ensureAnimalNid(a); // assign numeric id for binary packing
		currentInterest.add(a.id);
		const prev = _lastAnimalSnapshot.get(a.id);
		const rec = { id:a.id }; let dirty=false;
		if (!prev || _netTickCounter % ANIMAL_FULL_EVERY === 0){
			rec.x=a.x; rec.y=a.y; rec.hp=a.hp; rec.heading=a.heading; rec.dead=!!a.dead; rec.type=a.type; dirty=true; rec.full=1;
		}else{
			if (!prev || prev.x!==a.x || prev.y!==a.y){ rec.x=a.x; rec.y=a.y; dirty=true; }
			if (!prev || prev.hp!==a.hp){ rec.hp=a.hp; dirty=true; }
			if (!prev || prev.heading!==a.heading){ rec.heading=a.heading; dirty=true; }
			if (!prev || prev.dead!==!!a.dead){ rec.dead=!!a.dead; dirty=true; }
			if (!prev || prev.type!==a.type){ rec.type=a.type; dirty=true; }
		}
		if (dirty){ changed.push(rec); _lastAnimalSnapshot.set(a.id,{ x:a.x,y:a.y,hp:a.hp,heading:a.heading,dead:!!a.dead,type:a.type }); }
	}
	// animals leaving interest
	for (const id of _animalsLastInInterest){ if (!currentInterest.has(id)){ changed.push({ id, gone:1 }); _lastAnimalSnapshot.delete(id); } }
	_animalsLastInInterest = currentInterest;
	// removed from world entirely
	for (const id of [..._lastAnimalSnapshot.keys()]){ if (!animals.find(a=>a.id===id)){ changed.push({ id, gone:1 }); _lastAnimalSnapshot.delete(id); } }
	return changed;
}

function collectPlayerState(){ return { id: myNetId, name: myPlayer?.name||'?', x: myPlayer?.x||0, y: myPlayer?.y||0, angle: myPlayer?.angle||0, punchT: myPlayer?.punchT||1, punchActive: !!myPlayer?.punchActive, hand: myPlayer?.punchingHand||0, hp: myPlayer?.hp ?? CONFIG.playerStats.maxHP, eq: equippedItem || null }; }

function networkTick(){
	if (!inGame) return;
	// Client: purge stale animals not updated recently (>6s) to avoid frozen ghosts
	const offlineSingle = (!rtcPeer && !dataChannel && hostPeers.size===0);
	if (!isHost && !offlineSingle){
		const nowT = now();
		for (let i=animals.length-1;i>=0;i--){ const a=animals[i]; if ((nowT - (a.lastUpdate||0)) > 6000){ animals.splice(i,1); } }
	}
	if (isHost){
		// Skip network combo packing entirely in pure single-player to avoid unintended pruning/teleport side-effects
		if (hostPeers.size===0 && remotePlayers.size===0){ return; }
		const stateObj = collectPlayerState();
		const animalDelta = buildAnimalDelta();
		if (USE_BINARY_COMBO){
			const changedAlive = animalDelta.filter(r=>!r.gone);
			const count = changedAlive.length;
			if (count){
				// Packet layout: [u8 magic=0xCB][u8 ver=2][u32 seq][u16 count][per: u16 nid,i16 x,i16 y,u16 hp,u8 heading,u8 type,u8 flags]
				// x,y encoded with POS_SCALE fractional precision
				const POS_SCALE = 4; // 1/4 pixel precision
				const BYTES_PER = 13;
				const buf = new ArrayBuffer(2+4+2 + count*BYTES_PER);
				const dv = new DataView(buf); let off=0;
				dv.setUint8(off++,0xCB); dv.setUint8(off++,2);
				const seq = _comboSeq++; dv.setUint32(off,seq,true); off+=4; dv.setUint16(off,count,true); off+=2;
				const TYPE_IDX={cow:0,pig:1,wolf:2};
				for (const rec of changedAlive){ const a=animals.find(z=>z.id===rec.id); if (!a) continue; const nid=a._nid||0; dv.setUint16(off,nid,true); off+=2; dv.setInt16(off, (a.x*POS_SCALE)|0, true); off+=2; dv.setInt16(off, (a.y*POS_SCALE)|0, true); off+=2; dv.setUint16(off,a.hp&0xFFFF,true); off+=2; const h=((a.heading%(Math.PI*2))+Math.PI*2)%(Math.PI*2); dv.setUint8(off,(h/(Math.PI*2)*255)|0); off+=1; dv.setUint8(off,TYPE_IDX[a.type]||0); off+=1; let flags=0; if (a.dead) flags|=1; if (rec.full) flags|=2; dv.setUint8(off,flags); off+=1; }
				for (const { dc } of hostPeers.values()) if (dc.readyState==='open'){ try { dc.send(buf); } catch {} }
				// JSON companion for player state + gone list + id<->nid mapping entries
				const gone = animalDelta.filter(r=>r.gone);
				const mappings = [];
				for (const rec of changedAlive){ // include mapping for any with full snapshot or first time
					const a = animals.find(z=>z.id===rec.id); if (!a) continue; if (rec.full || !_origToNid.has(a.id)){ _origToNid.set(a.id,a._nid); mappings.push({ id:a.id, nid:a._nid }); }
				}
				const comboPayload = { t:'combo', seq: seq, state: stateObj, animals: [...gone, ...mappings] };
				const json = JSON.stringify(comboPayload);
				for (const { dc } of hostPeers.values()) if (dc.readyState==='open'){ try { dc.send(json); } catch {} }
			} else {
				// no alive changes -> send JSON only
				const combo = JSON.stringify({ t:'combo', seq:_comboSeq++, state: stateObj, animals: animalDelta });
				for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(combo);
			}
		} else {
			const combo = JSON.stringify({ t:'combo', seq:_comboSeq++, state: stateObj, animals: animalDelta });
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(combo);
		}
	} else {
		// just send our state (unchanged)
		broadcastStateSingle(dataChannel);
	}
	_netTickCounter++;
}
setInterval(networkTick, 1000/12);
function collectState(){ return collectPlayerState(); }
function broadcastStateSingle(dc){
	if (!dc || dc.readyState!=='open') return;
	const payload = { t:'state', players: [ collectState() ] };
	dc.send(JSON.stringify(payload));
}
function broadcastState(){
	if (isHost){
		for (const { dc } of hostPeers.values()) broadcastStateSingle(dc);
		if (hostPlayerCountEl) hostPlayerCountEl.textContent = '('+ hostPeers.size +' joined)';
	} else {
		broadcastStateSingle(dataChannel);
	}
}
function broadcastStateToOthers(excludeDc){
	if (!isHost) return;
	const payload = { t:'state', players: [ collectState() ] };
	for (const { dc } of hostPeers.values()) if (dc!==excludeDc) dc.send(JSON.stringify(payload));
}
// (Replaced by aggregated networkTick)

// Animal broadcast (lower rate)
// broadcastAnimals no longer used (kept for backward compatibility if called elsewhere)
function broadcastAnimals(){ /* merged into combo */ }

// Deprecated: use unified placeStruct broadcast inside buildReq / attemptPlaceStructure host path
function broadcastStructure(s){
	if (!isHost) return;
	const payload = JSON.stringify({ t:'placeStruct', s, orig: myNetId });
	for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(payload);
}

// --- Binary combo decode (client side) ---
function handleBinaryComboPacket(buf){
	if (isHost) return; if (!(buf instanceof ArrayBuffer)) return;
	const dv=new DataView(buf); if (dv.byteLength<8) return; if (dv.getUint8(0)!==0xCB) return; const ver=dv.getUint8(1); if (!(ver===1||ver===2)) return;
	let off=2; const seq=dv.getUint32(off,true); off+=4; const count=dv.getUint16(off,true); off+=2; const POS_SCALE = (ver===2?4:1);
	if (window._lastComboSeq != null && seq > window._lastComboSeq + 1){ window._animalRenderDelay = Math.min(240,(window._animalRenderDelay||120)*1.25);} else if (window._lastComboSeq != null && seq === window._lastComboSeq + 1){ if (window._animalRenderDelay && window._animalRenderDelay>120) window._animalRenderDelay -=5; }
	window._lastComboSeq = seq;
	const TYPE_NAME=['cow','pig','wolf']; const nowT=now();
	for (let i=0;i<count;i++){
		if (off+13>dv.byteLength) break; const nid=dv.getUint16(off,true); off+=2; const xRaw=dv.getInt16(off,true); off+=2; const yRaw=dv.getInt16(off,true); off+=2; const hp=dv.getUint16(off,true); off+=2; const hByte=dv.getUint8(off++); const heading=(hByte/255)*(Math.PI*2); const tIdx=dv.getUint8(off++); const type=TYPE_NAME[tIdx]||'cow'; const flags=dv.getUint8(off++); const dead=!!(flags&1); const x = xRaw / POS_SCALE; const y = yRaw / POS_SCALE;
		let a=animals.find(z=>z._nid===nid);
		if (!a){ a={ id:'a'+nid, _nid:nid, type, x, y, prevX:x, prevY:y, heading, prevHeading:heading, hp, dead, snaps:[], lastUpdate:nowT }; animals.push(a); }
		else { a.prevX=a.x; a.prevY=a.y; a.prevHeading=a.heading; a.x=x; a.y=y; a.heading=heading; a.hp=hp; a.dead=dead; a.type=type; a.lastUpdate=nowT; }
		if (a.snaps){ a.snaps.push({ t:nowT, x:a.x,y:a.y,heading:a.heading }); if (a.snaps.length>14) a.snaps.splice(0,a.snaps.length-14); }
		if (!a.history) a.history=[]; a.history.push({ t:nowT, x:a.x, y:a.y }); if (a.history.length>60) a.history.shift();
	}
}

function sendWorldSnapshot(dc){
	if (!dc || dc.readyState!=='open') return;
	const snapshot = { t:'worldSnapshot', objects: worldObjects.map(o=>({...o})), structures: structures.map(s=>({...s})) };
	dc.send(JSON.stringify(snapshot));
}

// Hit event broadcast helpers
function broadcastHitLocal(id){
	if (isHost){ broadcastHitToAll(id); }
	else if (dataChannel && dataChannel.readyState==='open') dataChannel.send(JSON.stringify({ t:'hit', id }));
}
function broadcastHitToAll(id){ if (isHost){ for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'hit', id })); } }
function broadcastHitToOthers(excludeDc, id){ if (!isHost) return; for (const { dc } of hostPeers.values()) if (dc!==excludeDc && dc.readyState==='open') dc.send(JSON.stringify({ t:'hit', id })); }

// Draw remote players
const _origPlayerDraw = Player.prototype.draw;
function drawRemotePlayers(g){
	for (const [id,p] of remotePlayers){
		const targetInterval = 1000/12; const age = p.lastUpdate ? (now() - p.lastUpdate) : 0; let alpha = age/targetInterval; if (alpha>1) alpha=1; if (alpha<0) alpha=0;
		const ix = (p.prevX!==undefined)? p.prevX + (p.x - p.prevX)*alpha : p.x;
		const iy = (p.prevY!==undefined)? p.prevY + (p.y - p.prevY)*alpha : p.y;
		// Predict punch anim
		const duration=0.28; let punchT=p.punchT; if (p.punchActive || punchT<1){ const baseT=p.basePunchT??p.punchT; const dt=(now() - (p.basePunchUpdate||p.lastUpdate))/1000; punchT=Math.min(1, baseT + dt/duration); }
		const phaseInfo = computePunchPhase(punchT, p.punchActive);
		// Angle smoothing (shortest arc) between previous and current angle using same alpha
		let ang = p.angle || 0; let prevAng = p.prevAngle ?? ang;
		let d = ang - prevAng; while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2;
		const interpAngle = prevAng + d * alpha;
		// Lightweight smoothing: approach target at max angular speed; ensures visible updates
		if (p._renderAngle == null) p._renderAngle = interpAngle;
		let diffA = interpAngle - p._renderAngle; while (diffA > Math.PI) diffA -= Math.PI*2; while (diffA < -Math.PI) diffA += Math.PI*2;
		const maxSpeed = 10; // rad/sec cap, fairly quick
		const dtSec = (now() - (p._lastAngleTime||0)) / 1000; p._lastAngleTime = now();
		const maxStep = maxSpeed * dtSec;
		if (Math.abs(diffA) <= maxStep) p._renderAngle = interpAngle; else p._renderAngle += Math.sign(diffA)*maxStep;
		const smoothAngle = p._renderAngle;
		const hitFlash = (now() - (p.lastPlayerHit||0)) < CONFIG.combat.hitFlashMs;
		// Provide a lightweight ref for eyes with its own smoothed direction state & method
		if (!p._eyeHelper){
			p._eyeHelper = {
				angle: smoothAngle,
				_eyeDx: 1, _eyeDy: 0, _eyeInit: false,
				_getGazeDirection(px,py){
					// Remote: track local player's position or predicted facing for subtle motion
					// Find a nearby focus target (nearest animal/player/object) similar to player logic
					let tx=null, ty=null; let best=null, bd=1e9;
					for (const a of animals){ if (a.hp>0){ const d=Math.hypot(a.x-px,a.y-py); if (d<bd){ bd=d; best=a; } } }
					for (const [id,rp] of remotePlayers){ if (rp.x!=null){ const d=Math.hypot(rp.x-px,rp.y-py); if (d<bd){ bd=d; best=rp; } } }
					if (myPlayer && myPlayer!==this && myPlayer.x!=null){ const d=Math.hypot(myPlayer.x-px,myPlayer.y-py); if (d<bd){ bd=d; best=myPlayer; } }
					for (const o of worldObjects){ const d=Math.hypot(o.x-px,o.y-py); if (d<bd){ bd=d; best=o; } }
					if (best){ tx=best.x; ty=best.y; }
					if (tx==null){ return { dx: Math.cos(this.angle), dy: Math.sin(this.angle) }; }
					const dx=tx-px, dy=ty-py; const len=Math.hypot(dx,dy)||1; return { dx:dx/len, dy:dy/len };
				}
			};
		}
		p._eyeHelper.angle = smoothAngle;
		drawPlayerShape(g,{ name:p.name,x:ix,y:iy,angle:smoothAngle,punchT,punchActive:p.punchActive,punchingHand:p.hand||0,phaseInfo, hitFlash, eq: p.eq, _playerRef: p._eyeHelper });
		// Remote health bar
		if (p.hp != null){ drawHealthBar(g, { x: ix, y: iy, hp: p.hp }); }
	}
}

function computePunchPhase(t, active){
	// Mirror improved local timeline.
	let rawExt=0, phase=0; if (active || t<1){
		const anticip=0.16, accelPeak=0.38, follow=0.72;
		if (t<anticip){ const a=t/anticip; rawExt=-0.25*(1-(1-a)*(1-a)); }
		else if (t<accelPeak){ const f=(t-anticip)/(accelPeak-anticip); rawExt=Math.pow(f,0.9); }
		else if (t<follow){ const f=(t-accelPeak)/(follow-accelPeak); rawExt=1 + 0.10*Math.sin(f*Math.PI*0.9)*(1-f*0.85); }
		else { const f=(t-follow)/(1-follow); rawExt=1 - f*f*0.55; }
		phase=clamp(rawExt,0,1);
	}
	return {rawExt,phase};
}
function drawPlayerShape(g, info){
	const { radius, handRadius, skinBase, skinShade, outline, handOffsetMult, nameTag } = CONFIG.player;
	const { x: px, y: py, angle, punchingHand: strike, phaseInfo, name, hitFlash, eq } = info;
	const rawExt = phaseInfo.rawExt, phase = phaseInfo.phase;
	const holdingTool = !!eq;
	let hxL,hyL,hxR,hyR; let strikeScale=1, restScale=1;
	g.save();
	if (holdingTool){
		const gripWidth=radius*1.35; const baseForward=radius*0.78; const forward=baseForward + radius*0.28*phase;
		const perpAng=angle+Math.PI/2; const swing=(rawExt-0.45)*1.25; const arcMag=0.60; const adjPerpAng=perpAng + swing*arcMag;
		const cx=px+Math.cos(angle)*forward, cy=py+Math.sin(angle)*forward;
		hxL=cx+Math.cos(adjPerpAng)*(-gripWidth/2); hyL=cy+Math.sin(adjPerpAng)*(-gripWidth/2);
		hxR=cx+Math.cos(adjPerpAng)*(gripWidth/2); hyR=cy+Math.sin(adjPerpAng)*(gripWidth/2);
		strikeScale=1+phase*0.30; restScale=1+phase*0.18;
		if (phase>0){ const squash=0.06*phase, stretch=0.06*phase; g.translate(px,py); g.scale(1-squash,1+stretch); g.translate(-px,-py);} 
		g.fillStyle=skinBase; g.lineWidth=1.3; g.strokeStyle=outline;
		g.beginPath(); g.arc(hxL,hyL,handRadius*strikeScale,0,Math.PI*2); g.fill(); g.stroke();
		g.beginPath(); g.arc(hxR,hyR,handRadius*restScale,0,Math.PI*2); g.fill(); g.stroke();
		let midX=(hxL+hxR)/2, midY=(hyL+hyR)/2; midX+=Math.cos(angle)*radius*0.30; midY+=Math.sin(angle)*radius*0.30;
		const lag=0.20*(1-phase); let toolAng=adjPerpAng+Math.PI - lag*(swing*0.9);
		if (eq==='apple'){ toolAng += 3.45; }
		const scale = (eq==='apple')? 0.95 : 1.48;
		const lift = (eq==='apple')? 0.02 : 0.06;
		drawTool(g, eq, midX, midY, toolAng, phase, scale, null, lift);
	} else {
		// Original punch-based single-hand posture
		const baseOffset = radius * handOffsetMult;
		const strikeOffset = baseOffset + phase * radius * 1.0;
		const restOffset = baseOffset - phase * radius * 0.22 + (rawExt<0 ? rawExt * radius * 0.30 : 0);
		const forwardBiasStrike = 0.60 + phase * 0.30; const forwardBiasRest = 0.42 - phase * 0.08;
		const leftBias = (strike===0?forwardBiasStrike:forwardBiasRest); const rightBias=(strike===1?forwardBiasStrike:forwardBiasRest);
		const leftAngle = angle + (Math.PI/2)*(1-leftBias); const rightAngle = angle - (Math.PI/2)*(1-rightBias);
		hxL = px + Math.cos(leftAngle) * (strike===0?strikeOffset:restOffset); hyL = py + Math.sin(leftAngle)*(strike===0?strikeOffset:restOffset);
		hxR = px + Math.cos(rightAngle) * (strike===1?strikeOffset:restOffset); hyR = py + Math.sin(rightAngle)*(strike===1?strikeOffset:restOffset);
		if (phase>0){ const sx=1-0.09*phase, sy=1+0.09*phase; g.translate(px,py); g.scale(sx,sy); g.translate(-px,-py);} g.fillStyle=skinBase; g.lineWidth=1.3; g.strokeStyle=outline;
		const strikeScaleLocal=1+phase*0.60; const restScaleLocal=1-phase*0.18; strikeScale=strikeScaleLocal; restScale=restScaleLocal;
		g.beginPath(); g.arc(hxL,hyL,handRadius*(strike===0?strikeScale:restScale),0,Math.PI*2); g.fill(); g.stroke();
		g.beginPath(); g.arc(hxR,hyR,handRadius*(strike===1?strikeScale:restScale),0,Math.PI*2); g.fill(); g.stroke();
		if (eq){ const midX=(hxL+hxR)/2, midY=(hyL+hyR)/2; const toolAng = angle + (strike===0?0.15:-0.15); drawTool(g, eq, midX, midY, toolAng, phase, 1.2, null, 0.05); }
	}
	// Body on top
	g.beginPath(); g.arc(px,py,radius,0,Math.PI*2); const bodyGrad=g.createRadialGradient(px+radius*0.35,py+radius*0.4,radius*0.1,px,py,radius); bodyGrad.addColorStop(0,skinBase); bodyGrad.addColorStop(1,skinShade);
	if (hitFlash){ g.fillStyle='#ff3d2d'; g.globalAlpha=0.7; g.fill(); g.globalAlpha=1; g.fillStyle=bodyGrad; g.globalAlpha=0.55; g.fill(); g.globalAlpha=1; } else { g.fillStyle=bodyGrad; g.fill(); }
	g.stroke(); g.restore();
	// Eyes for remote (reuse Player prototype methods via temporary call if available)
	if (Player.prototype._drawEyes){ Player.prototype._drawEyes.call(info._playerRef||myPlayer, g, px, py, radius); }
	// Name Tag (simplified outlined text to match local player)
	const baseName = name || '?';
	const tagY = py - radius - 18;
	g.save();
	g.font = '600 19px Rubik, sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.lineWidth = 1.3;
	g.strokeStyle = 'rgba(0,0,0,0.85)';
	g.lineJoin = 'round';
	g.miterLimit = 2;
	g.strokeText(baseName, px, tagY);
	g.fillStyle = '#ffffff';
	g.fillText(baseName, px, tagY);
	g.restore();
}

btnHost?.addEventListener('click', startHost);
btnApplyAnswer?.addEventListener('click', applyAnswer);
// Explicit join button flow
const btnJoinStart = document.getElementById('btn-join-start');
btnJoinStart?.addEventListener('click', () => {
	const code = taJoinOffer.value.trim();
	if (code.length < 10){ if (joinStatusEl) joinStatusEl.textContent='Invalid host code'; return; }
	if (joinStatusEl) joinStatusEl.textContent='Connecting...';
	joinHost().then(()=>{
		if (joinStatusEl) joinStatusEl.textContent='Generating reply...';
		// reply will appear after ICE completes (we set in onicecandidate)
	});
});
// Host auto-apply when pressing connect
btnApplyAnswer?.addEventListener('click', () => { applyAnswer().then(()=>{ if (hostStatusEl) hostStatusEl.textContent='Player connected'; }); });

// Copy button handling
document.addEventListener('click', e=>{
	const tgt = e.target;
	if (tgt && tgt.matches('.copy-btn')){
		const id = tgt.getAttribute('data-copy');
		const ta = id && document.getElementById(id);
		if (ta && ta.value.trim()){
			try { navigator.clipboard.writeText(ta.value.trim()); tgt.textContent='Copied'; setTimeout(()=>{ tgt.textContent='Copy'; },1400);} catch {}
		}
	}
});

// Allow Esc to close settings first
addEventListener('keydown', e => {
	if (e.code === 'Escape') {
		if (!settingsModalEl.classList.contains('hidden')) { closeSettings(); e.stopPropagation(); }
	}
});

// ===== Main Loop =====
let last = now();
let accumulator = 0;
let fps = 0, fpsLast = 0, frames = 0;
// Ping tracking (round-trip time). We send a ping every few seconds and compute RTT when pong received.
let pingMs = null; let _lastPingSend = 0; const _pingInterval = 2000; // ms
function sendPing(){
	_lastPingSend = now();
	const payload = JSON.stringify({ t:'ping', ts: _lastPingSend });
	if (isHost){
		for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(payload);
	} else if (dataChannel && dataChannel.readyState==='open') {
		dataChannel.send(payload);
	}
}
function simulate(step){
	if (inGame && myPlayer) {
		if (!myPlayer.dead && !chatInputActive){ myPlayer.update(step); }
		updateCamera(step, myPlayer);
		resolveCollisions(myPlayer);
		resolvePlayerCollisions(myPlayer);
		// Apply animal collisions locally for all clients (non-host approximate using received animal positions)
		resolvePlayerAnimalCollision(myPlayer);
		if (isHost) hostResolvePlayerPush();
		if (!myPlayer.dead && myPlayer.hp <= 0){ handleLocalDeath(); }
	}
	updateAnimals(step);
	// Host (or single-player authoritative) performs animal physics: collisions & respawns
	if (isHost || (!rtcPeer && !dataChannel && hostPeers.size===0)){
		resolveAnimalCollisions();
		if (myPlayer) resolvePlayerAnimalCollision(myPlayer);
		// remote players vs animals (host only)
		if (isHost){ for (const p of remotePlayers.values()){ if (p.x!=null) resolvePlayerAnimalCollision(p); } }
		updateAnimalRespawns();
	}
	screenShake = Math.max(0, screenShake - 60 * step * 0.9);
	screenShakeTime += step;
}
function frame(){
	const t = now();
	let delta = (t - last)/1000; last = t;
	if (delta > 0.25) delta = 0.25; // clamp huge pauses
	let simTimeThisFrame = 0;
	if (CONFIG.render?.fixedUpdate){
		const step = 1 / (CONFIG.render.fixedFps || 120);
		accumulator += delta;
		// prevent spiral of death
		if (accumulator > step * 5) accumulator = step * 5;
		while (accumulator >= step){
			simulate(step);
			accumulator -= step;
			simTimeThisFrame += step;
		}
		renderAlpha = accumulator / step; // fraction toward next step
	} else {
		simulate(delta);
		simTimeThisFrame = delta;
		renderAlpha = 1; // direct use
	}
	// Render
	ctx.setTransform(1,0,0,1,0,0);
	ctx.clearRect(0,0,canvas.width,canvas.height);
	ctx.scale(dpr,dpr);
	ctx.save();
	let sx=0, sy=0; if (screenShake>0){
		const tShake = screenShakeTime * 55;
		const a = screenShake;
		sx = (Math.sin(tShake*1.3) * 0.6 + Math.sin(tShake*2.7+1.2)*0.4) * a;
		sy = (Math.cos(tShake*1.1+0.5) * 0.6 + Math.sin(tShake*1.9+2.2)*0.4) * a;
	}
	const camZoom = CONFIG.camera.zoom || 1;
	ctx.scale(camZoom, camZoom);
	let tx = -camera.x + innerWidth/(2*camZoom) + sx;
	let ty = -camera.y + innerHeight/(2*camZoom) + sy;
	if (CONFIG.render?.pixelSnap){ tx = Math.round(tx); ty = Math.round(ty); }
	ctx.translate(tx,ty);
	clear(ctx);
	drawGrid(ctx);
	if (myPlayer){ myPlayer.draw(ctx); drawHealthBar(ctx, myPlayer); }
	// remote players after local player (same layer ordering for now)
	drawRemotePlayers(ctx);
	drawAnimals(ctx);
	drawObjects(ctx);
	drawStructures(ctx);
	drawChatBubbles(ctx);
	drawHitEffects(ctx, simTimeThisFrame);
	ctx.restore();
	// FPS HUD
	if (CONFIG.debug.showFps){
		ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
		ctx.font='12px Rubik, sans-serif'; ctx.fillStyle='rgba(255,255,255,0.6)';
		let text = fps+' FPS';
		if (pingMs!=null){ text += '  |  '+Math.round(pingMs)+' ms'; }
		// Bottom-left HUD text with 10px margin
		ctx.fillText(text,10, innerHeight-10-2); // slight nudge for baseline
		if (chatInputActive){ ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fillText('Chat: '+chatBuffer+'_', 10, innerHeight-10-18); }
		ctx.restore();
	}
	// Side chat overlay persistent log (in-game) - keep clear of FPS & chat input area
	if (inGame){
		ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
		const lineH = 18;
		// Reserve bottom space: 26px for FPS line, +20px if chat input active, +10px margin
		let reserved = 26 + 10; // fps + bottom margin
		if (chatInputActive) reserved += 20; // extra line for input
		const maxFeedHeight = 260; // desired height
		let available = innerHeight - reserved - 10; // minus top margin for feed top
		if (available < 60) available = 60; // minimal
		const feedHeight = Math.min(maxFeedHeight, available);
		const feedX = 10;
		const feedBottom = innerHeight - reserved; // bottom Y where log must stop
		const feedTop = feedBottom - feedHeight;
		ctx.font='13px Rubik, sans-serif'; ctx.textBaseline='top';
		const maxLines = Math.floor(feedHeight / lineH);
		const visible = chatMessages.slice(-maxLines);
		let i=0; const startY = feedBottom - visible.length*lineH; // bottom align inside region
		for (const m of visible){
			const sender = (m.playerId===myNetId)? 'You' : (remotePlayers.get(m.playerId)?.name||'???');
			let txt = sender+': '+m.text; if (txt.length>180) txt = txt.slice(0,177)+'…';
			ctx.fillStyle='rgba(255,255,255,0.82)';
			const y = startY + i*lineH;
			if (y >= feedTop) ctx.fillText(txt, feedX, y);
			i++;
		}
		ctx.restore();
	}
	frames++; if (t - fpsLast > 1000){ fps = frames; frames = 0; fpsLast = t; }
	// Periodic ping
	if (inGame && (t - _lastPingSend) > _pingInterval){ sendPing(); }
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Enhance existing frame loop by monkey-patching frame function if not already
if (!window._menuCamHook){
	window._menuCamHook = true;
	// Wrap requestAnimationFrame hook we earlier set for lag comp; integrate via global flag updates inside frame
	const _origFrame = frame;
	// NOTE: Can't redefine frame easily since declared; instead augment via animation of camera inside rendering pipeline.
	// We'll inject a lightweight ticker using RAF.
	(function menuPanLoop(){
		if (!inGame){
			if (!menuSimSeeded){ try { generateWorld(); menuSimSeeded=true; } catch{} }
			menuCamT += 1/60;
			const W = CONFIG.map.width, H = CONFIG.map.height;
			// Figure-eight style path using Lissajous curves
			const cx = W*0.5 + Math.cos(menuCamT*0.10)*W*0.25;
			const cy = H*0.5 + Math.sin(menuCamT*0.14 + Math.sin(menuCamT*0.07)*0.4)*H*0.22;
			camera.x += (cx - camera.x)*0.035;
			camera.y += (cy - camera.y)*0.035;
			screenShake *= 0.9; // damp any leftover shake in menu
		}
		requestAnimationFrame(menuPanLoop);
	})();
}

// ===== Networking Placeholder =====
// Future: establish WebSocket connection, sync state, broadcast inputs.
// Structure: network.connect() -> send join w/ name -> receive world snapshot & diff updates.

// Explicit initial state
menuEl.classList.remove('hidden');
hudEl.classList.add('hidden');
canvas.classList.add('menu-blur');
inGame = false;
settingsButton.classList.add('hidden');
// Consent required each load; no persistence.

// Expose for console debugging
window.__game = { camera, get player() { return myPlayer; } };

// Enforce UI margins at runtime (in case of dynamic CSS overrides or scaling)
function enforceUIMargins(){
	const m = 10;
	const gear = document.getElementById('btn-settings'); if (gear){
		gear.style.top = m+'px';
		gear.style.right = m+'px';
		gear.style.margin='0';
		// Verify actual layout (allowing sub-pixel variance)
		requestAnimationFrame(()=>{
			const rect = gear.getBoundingClientRect();
			const topDiff = Math.abs(rect.top - m);
			const rightComputed = innerWidth - rect.right; // distance from right edge
			const rightDiff = Math.abs(rightComputed - m);
		});
	}
	const hudBox = document.getElementById('hud'); if (hudBox){ hudBox.style.top = m+'px'; hudBox.style.left = m+'px'; }
	const resPanel = document.getElementById('res-panel'); if (resPanel){ resPanel.style.bottom = m+'px'; resPanel.style.right = m+'px'; }
}
addEventListener('resize', enforceUIMargins);
setTimeout(enforceUIMargins, 0);
setInterval(enforceUIMargins, 1500); // periodic safeguard

// ===== World Objects Generation =====
function generateWorld() {
	worldObjects.length = 0;
	randScatter('tree', CONFIG.objects.treeCount);
	randScatter('stone', CONFIG.objects.stoneCount);
	randScatter('bush', CONFIG.objects.bushCount);
	worldObjectsById.clear(); for (const o of worldObjects) worldObjectsById.set(o.id,o);
	// generate animals (host OR pure single-player authoritative)
	if (isHost || (!rtcPeer && !dataChannel && hostPeers.size===0)){
		animals.length = 0;
		spawnAnimals('cow', CONFIG.animals.count.cow);
		spawnAnimals('pig', CONFIG.animals.count.pig);
		spawnAnimals('wolf', CONFIG.animals.count.wolf);
	}
}

// ===== Animals =====
const animals = [];// {id,type,x,y,vx,vy,dirTimer, targetId, hp,lastBite}
// Animal sprite loading (replace procedural drawing). Provide your own 256x256 (recommended) PNGs in /assets/ folder.
const animalSprites = {
	cow:  { src: 'assets/cow.png',  img: new Image(), scale: 1.05 },
	pig:  { src: 'assets/pig.png',  img: new Image(), scale: 0.95 },
	wolf: { src: 'assets/wolf.png', img: new Image(), scale: 1.00 }
};
// Tool sprite support with high-res image option. Provide 256x256 (or larger) PNGs in /assets.
// If image fails or missing, falls back to procedural drawing.
const toolSprites = {
	axe:    { kind:'axe',   handle:'#c69556', handleEdge:'#5a3a18', head:'#444',  headEdge:'#222', bladeLen:130, anchor:0.35, src:'assets/axe.png',   img:new Image(), ready:false }, // anchor = fraction along width where hands grip
	pickaxe:{ kind:'pick',  handle:'#c69556', handleEdge:'#5a3a18', head:'#999',  headEdge:'#444', bladeLen:130, anchor:0.50, src:'assets/pickaxe.png',img:new Image(), ready:false },
	sword:  { kind:'sword', handle:'#c69556', handleEdge:'#5a3a18', blade:'#ddd', bladeEdge:'#666', guard:'#b8863b', bladeLen:130, anchor:0.42, src:'assets/sword.png', img:new Image(), ready:false },
	apple:  { kind:'apple', skin:'#d8342c', shine:'#ffaea8', stem:'#52371c', leaf:'#3d861f', bladeLen:70, anchor:0.52, src:'assets/food.png', img:new Image(), ready:false }
};
for (const k in toolSprites){
	const t=toolSprites[k]; if (!t.src) continue; t.img.onload=()=>{ t.ready=true; }; t.img.onerror=()=>{ t.ready=false; }; t.img.src=t.src;
}
// drawTool alignment:
//  If toolSprites[id].anchor provided (0..1), that fraction across image width is placed at (x,y) between hands.
//  Else legacy gripShift (fraction of length to shift left) may be passed.
//  liftShift: moves sprite upward (negative local Y) to raise head edge above hands.
function drawTool(g, id, x, y, ang, phase, extraScale, gripShift, liftShift){
	const t = toolSprites[id]; if (!t) return;
	const logicalLen = t.bladeLen || 110; // on-screen target width/length
	g.save();
	g.translate(x,y);
	g.rotate(ang);
	const baseScale = 0.85 + (phase||0)*0.25; const scale = baseScale * (extraScale||1);
	g.scale(scale,scale);
	if (t.anchor != null){
		// Anchor fraction -> shift so anchor sits at origin. Center would be 0.5.
		// Default uses 0.65 reference; axe gets a closer 0.55 so hands sit further from the head.
		const ref = (t.kind === 'axe') ? 0.55 : 0.65;
		const shift = (ref - t.anchor) * logicalLen; // positive shift moves image right (head further forward)
		g.translate(shift, 0);
	} else if (gripShift){
		g.translate(-logicalLen * gripShift, 0);
	}
	if (liftShift){ g.translate(0, -logicalLen * liftShift); }
	if (t.ready){
		// Draw image centered, scaled to logicalLen maintaining aspect
		const iw = t.img.naturalWidth || logicalLen; const ih = t.img.naturalHeight || logicalLen;
		const aspect = ih/iw; const targetW = logicalLen; const targetH = targetW * aspect;
		g.imageSmoothingEnabled = true;
		g.drawImage(t.img, -targetW/2, -targetH/2, targetW, targetH);
	} else {
		// Procedural fallback
		if (t.kind==='axe'){
			g.fillStyle=t.handle; g.strokeStyle=t.handleEdge; g.lineWidth=3; g.beginPath(); g.roundRect?.(-38,-6,76,12,6) ?? g.rect(-38,-6,76,12); g.fill(); g.stroke();
			g.fillStyle=t.head; g.strokeStyle=t.headEdge; g.beginPath(); g.roundRect?.(10,-18,34,36,6) ?? g.rect(10,-18,34,36); g.fill(); g.stroke();
		} else if (t.kind==='pick'){
			g.fillStyle=t.handle; g.strokeStyle=t.handleEdge; g.lineWidth=3; g.beginPath(); g.roundRect?.(-40,-5,80,10,5) ?? g.rect(-40,-5,80,10); g.fill(); g.stroke();
			g.fillStyle=t.head; g.strokeStyle=t.headEdge; g.lineWidth=3; g.beginPath(); g.roundRect?.(-6,-24,12,48,5) ?? g.rect(-6,-24,12,48); g.fill(); g.stroke();
		} else if (t.kind==='sword'){
			g.fillStyle=t.blade; g.strokeStyle=t.bladeEdge; g.lineWidth=3; g.beginPath(); g.roundRect?.(-6,-48,12,96,6) ?? g.rect(-6,-48,12,96); g.fill(); g.stroke();
			g.fillStyle=t.guard; g.beginPath(); g.roundRect?.(-20,-6,40,12,4) ?? g.rect(-20,-6,40,12); g.fill();
			g.fillStyle=t.handle; g.beginPath(); g.roundRect?.(-4,48,8,14,4) ?? g.rect(-4,48,8,14); g.fill(); g.strokeStyle=t.handleEdge; g.stroke();
		} else if (t.kind==='apple'){
			// Simple apple shape
			g.fillStyle=t.skin; g.strokeStyle='#7a1814'; g.lineWidth=3;
			g.beginPath(); g.ellipse(0,0,34,40,0,0,Math.PI*2); g.fill(); g.stroke();
			// highlight
			g.fillStyle=t.shine; g.beginPath(); g.ellipse(-10,-8,10,16,0,0,Math.PI*2); g.globalAlpha=0.55; g.fill(); g.globalAlpha=1;
			// stem
			g.strokeStyle=t.stem; g.lineWidth=4; g.beginPath(); g.moveTo(4,-32); g.lineTo(4,-48); g.stroke();
			// leaf
			g.fillStyle=t.leaf; g.beginPath(); g.ellipse(12,-44,10,16,0.6,0,Math.PI*2); g.fill();
		}
	}
	g.restore();
}
// Logical target draw size (square) each sprite will be fit into (increase to make animals appear larger)
let ANIMAL_BASE_DRAW = 228; // 1.2x bigger than 190
for (const k in animalSprites){
	const s=animalSprites[k];
	s.ready = false;
	s.img.onload = ()=>{ s.ready = true; s.w=s.img.naturalWidth||128; s.h=s.img.naturalHeight||128; };
	s.img.onerror = ()=>{ console.warn('[AnimalSprite] Failed to load', s.src); };
	s.img.src = s.src;
}
function spawnAnimals(type,count){
	for (let i=0;i<count;i++){
		const maxHP = type==='wolf'?70: (type==='cow'?120:90);
		animals.push({ id:'a'+Math.random().toString(36).slice(2,9), type, x: Math.random()*CONFIG.map.width, y: Math.random()*CONFIG.map.height, vx:0, vy:0, dirTimer:0, hp: maxHP, maxHP, lastBite:0,
			state: (type==='wolf'?'roam':'idle'), stateTimer: 0, targetId: null, grazeTimer:0, fleeTimer:0, lastSeenX:null, lastSeenY:null, energy: 1,
			_goalVx:0, _goalVy:0, wanderDir: Math.random()*Math.PI*2, turnRate: (type==='wolf'?2.6:1.9), _fleeVecX:null, _fleeVecY:null, heading: Math.random()*Math.PI*2 });
	}
}
function updateAnimals(dt){
	// Host simulates for multiplayer; in pure single-player (no peers / no connection) we simulate locally too.
	const offlineSingle = (!rtcPeer && !dataChannel && hostPeers.size===0);
	if (!(isHost || offlineSingle)) return;
	for (const a of animals){
		if (a.hp<=0) continue;
		if (a.type==='wolf') updateWolf(a,dt); else updateGrazer(a,dt);
		// Steering: move current velocity toward goal velocity smoothly (prevents hopping)
		const maxAccel = (a.type==='wolf'? 900: 520); // px/s^2
		const gvx = a._goalVx || 0; const gvy = a._goalVy || 0;
		const dvx = gvx - a.vx; const dvy = gvy - a.vy;
		const dSpeed = Math.hypot(dvx,dvy);
		const maxChange = maxAccel * dt;
		if (dSpeed > maxChange){ const s = maxChange / dSpeed; a.vx += dvx * s; a.vy += dvy * s; } else { a.vx = gvx; a.vy = gvy; }
		// Mild friction
		const fr = 1 - 0.28*dt; a.vx *= fr; a.vy *= fr;
		// integrate
		a.x += a.vx * dt; a.y += a.vy * dt;
		a.x = clamp(a.x,40,CONFIG.map.width-40); a.y = clamp(a.y,40,CONFIG.map.height-40);
		if (offlineSingle) a.lastUpdate = now(); // keep fresh so purge logic never removes
	}
}
// === Enhanced AI ===
function updateGrazer(a,dt){
	const baseSpeed = CONFIG.animals.wanderSpeed * 1.12; // slight speed increase
	const threatRange = 340; const hardThreat = 190;
	// Threat detection (wolves or player)
	let nearestWolfDist=Infinity;
	for (const w of animals){ if (w.type==='wolf' && w.hp>0){ const d=Math.hypot(w.x-a.x,w.y-a.y); if (d<nearestWolfDist) nearestWolfDist=d; } }
	let playerDist = (myPlayer && !myPlayer.dead)? Math.hypot(myPlayer.x-a.x,myPlayer.y-a.y):Infinity;
	// State transitions
	switch(a.state){
		case 'idle':
			if (a.stateTimer<=0){ a.stateTimer = 0.6 + Math.random()*1.2; if (Math.random()<0.55){ a.state='graze'; a.grazeTimer= 0.8 + Math.random()*2.2; } else { a.state='wander'; a.dirTimer=0; } }
			break;
		case 'graze':
			a.grazeTimer -= dt; if (a.grazeTimer<=0){ a.state='idle'; a.stateTimer=0; }
			// subtle micro drift affects goal velocity not instantaneous speed
			if (Math.random()<0.08){ a.wanderDir += (Math.random()*0.6-0.3); }
			break;
		case 'wander':
			a.dirTimer -= dt; if (a.dirTimer<=0){ a.dirTimer = 1.2 + Math.random()*2.2; a.wanderDir += (Math.random()*1.2 - 0.6); }
			// small random curvature
			if (Math.random()<0.03){ a.wanderDir += (Math.random()*0.5-0.25); }
			break;
		case 'flee':
			a.fleeTimer -= dt; if (a.fleeTimer<=0){ a.state='idle'; a.stateTimer=0; }
			break;
	}
	// Trigger flee only if already been hurt OR a wolf is extremely close
	if (a.hp < a.maxHP || nearestWolfDist < hardThreat){
		if ((nearestWolfDist < threatRange || playerDist < hardThreat) && a.state!=='flee'){
			const tx = (nearestWolfDist < playerDist)? (animals.find(w=>w.type==='wolf' && Math.hypot(w.x-a.x,w.y-a.y)===nearestWolfDist) || null) : myPlayer;
			if (tx){
				const dx=a.x - tx.x; const dy=a.y - tx.y; const d=Math.hypot(dx,dy)||1;
				a._fleeVecX = dx/d; a._fleeVecY = dy/d; // persist flee direction
				const fleeSp = baseSpeed* (playerDist<hardThreat||nearestWolfDist<hardThreat? 1.85:1.5);
				a._goalVx = a._fleeVecX * fleeSp; a._goalVy = a._fleeVecY * fleeSp;
				a.wanderDir = Math.atan2(a._fleeVecY,a._fleeVecX);
				a.state='flee'; a.fleeTimer = 1.1 + Math.random()*0.7;
			}
		}
	}
	// Auto-kick into wander if nearly stationary & not fleeing
	// Determine goal velocity
	let desiredSpeed = (a.state==='flee')? baseSpeed*1.9 : (a.state==='wander'? baseSpeed*(0.85+Math.random()*0.08) : baseSpeed*0.18);
	if (a.state==='idle') desiredSpeed = baseSpeed*0.05;
	// Add wander direction evolution (skip while actively fleeing to maintain escape heading)
	if (a.state==='wander' || a.state==='graze'){ a.wanderDir += (Math.random()*0.2 - 0.1)*dt*4; }
	if (a.state==='flee' && a._fleeVecX!=null){
		// Slowly damp random wanderDir back toward flee vector to avoid snapping back
		const fleeAng = Math.atan2(a._fleeVecY,a._fleeVecX);
		let diff = fleeAng - a.wanderDir; while(diff>Math.PI) diff-=Math.PI*2; while(diff<-Math.PI) diff+=Math.PI*2;
		a.wanderDir += diff * Math.min(1, dt*6); // quick alignment
	}
	const dir = (a.state==='flee' && a._fleeVecX!=null) ? Math.atan2(a._fleeVecY,a._fleeVecX) : a.wanderDir;
	// Basic avoidance (objects & other animals) influences heading
	let ax=0, ay=0; let avoidCount=0;
	for (const o of worldObjects){ const dx=a.x-o.x, dy=a.y-o.y; const d=Math.hypot(dx,dy); if (d<160){ const f=(160-d)/160; ax += dx/d * f*f; ay += dy/d * f*f; avoidCount++; } }
	for (const o of animals){ if (o===a||o.hp<=0) continue; const dx=a.x-o.x, dy=a.y-o.y; const d=Math.hypot(dx,dy); if (d<110){ const f=(110-d)/110; ax += dx/d * f*f*0.5; ay += dy/d * f*f*0.5; avoidCount++; } }
	if (avoidCount){ const avAng=Math.atan2(ay,ax); // blend away
		const blend=0.55; const baseAng=dir; let diff=avAng-baseAng; while(diff>Math.PI) diff-=Math.PI*2; while(diff<-Math.PI) diff+=Math.PI*2; a.wanderDir = baseAng + diff*blend; }
	const gvx = Math.cos(a.wanderDir)*desiredSpeed; const gvy = Math.sin(a.wanderDir)*desiredSpeed;
	a._goalVx = gvx; a._goalVy = gvy;
	// Derive heading so clients can render proper angle (wolves already set heading separately)
	if (gvx*gvx + gvy*gvy > 4){ // moving meaningfully
		const desired = Math.atan2(gvy, gvx);
		if (a.heading==null) a.heading = desired; else {
			let diff = desired - a.heading; while(diff>Math.PI) diff-=Math.PI*2; while(diff<-Math.PI) diff+=Math.PI*2;
			a.heading += diff * Math.min(1, dt*5); // smooth turn for grazers
		}
	}
}

function updateWolf(a,dt){
	// Initialize heading if missing (backward compatibility)
	if (a.heading == null) a.heading = Math.random()*Math.PI*2;
	// Manage energy (0..1) for sprint/pounce
	a.energy = clamp(a.energy + dt*0.20, 0,1);
	const vision=560; const biteRange=CONFIG.animals.biteRange; const pounceRange = 150; const packRadius=320;
	// Acquire / retain target
	let target = null; let bestScore = -Infinity;
	const consider = (obj, kind)=>{
		if (!obj) return; if (kind==='player' && (obj.dead||obj.hp<=0)) return; if (kind==='animal' && obj.hp<=0) return;
		const dx=obj.x-a.x, dy=obj.y-a.y; const d=Math.hypot(dx,dy); if (d>vision) return;
		// scoring: prefer closer + injured
		let score = 500 - d;
		if (kind==='animal'){ const frac = obj.hp/ (obj.maxHP||100); score += (1-frac)*120; }
		if (kind==='player') score += 80; // slight bias toward player
		if (score>bestScore){ bestScore=score; target={kind, ref:obj}; }
	};
	// Consider all players (host + remotes) so wolves don't ignore non-host players
	if (myPlayer) consider(myPlayer,'player');
	if (remotePlayers){ for (const [rid, rp] of remotePlayers){ if (rp) consider(rp,'player'); } }
	for (const o of animals){ if (o===a || o.type==='wolf') continue; consider(o,'animal'); }
	if (!target){
		// roam
		if (a.state!=='roam'){ a.state='roam'; a.dirTimer=0; }
	}else{
		// track
		if (a.state==='roam') a.state='chase';
	}
	// Pack awareness (simple: detect other wolves chasing same target)
	let packCount=0; if (target){ for (const w of animals){ if (w!==a && w.type==='wolf' && w.hp>0 && w.state==='chase'){ if (w.targetId===target.ref.id || w.targetId===target.ref?.id){ packCount++; } } } }
	a.targetId = target? target.ref.id||null : null;
	// State handling with turn speed limit
	const MAX_TURN = 3.4; // rad/s regular
	const CHASE_TURN = 4.2; // rad/s when actively chasing
	switch(a.state){
		case 'roam': {
			// wander direction adjustments
			a.dirTimer -= dt; if (a.dirTimer<=0){ a.dirTimer = 1.4 + Math.random()*2.0; a.wanderDir += (Math.random()*1.0 - 0.5); }
			if (Math.random()<0.02) a.wanderDir += (Math.random()*0.4-0.2);
			const desiredAngle = a.wanderDir;
			let diff = desiredAngle - a.heading; while(diff>Math.PI) diff -= Math.PI*2; while(diff<-Math.PI) diff += Math.PI*2;
			const turn = Math.sign(diff) * Math.min(Math.abs(diff), MAX_TURN*dt);
			a.heading += turn;
			const roamSp = CONFIG.animals.wolfSpeed * 0.55;
			a._goalVx = Math.cos(a.heading)*roamSp; a._goalVy = Math.sin(a.heading)*roamSp;
			break; }
		case 'chase': {
			if (!target){ a.state='roam'; break; }
			const tx=target.ref.x, ty=target.ref.y; const dx=tx-a.x, dy=ty-a.y; const dist=Math.hypot(dx,dy)||1;
			let baseAngle = Math.atan2(dy,dx);
			// pack circling modifies desired angle slightly
			if (packCount>0){ const tang = (packCount%2===0?1:-1); baseAngle += tang * 0.35; }
			let diff = baseAngle - a.heading; while(diff>Math.PI) diff -= Math.PI*2; while(diff<-Math.PI) diff += Math.PI*2;
			const turnRate = CHASE_TURN * (dist<160?1.3:1); // tighten when close
			a.heading += Math.sign(diff) * Math.min(Math.abs(diff), turnRate*dt);
			let sp = CONFIG.animals.wolfSpeed * 1.15;
			if (dist>420 && a.energy>0.4){ sp*=1.55; a.energy -= dt*0.55; }
			// Transition to pounce
			if (dist < pounceRange && a.energy>0.5){ a.state='pounce'; a.stateTimer=0.25; a.energy -= 0.5; }
			a._goalVx = Math.cos(a.heading)*sp; a._goalVy = Math.sin(a.heading)*sp;
			// Bite check after updating heading
			if (dist < biteRange && (now()/1000 - a.lastBite) > CONFIG.animals.biteInterval){
				a.lastBite = now()/1000;
				if (target.kind==='player'){
					// Resolve victim id (host or remote)
					const victimId = (target.ref === myPlayer) ? myNetId : a.targetId;
					if (victimId === myNetId && myPlayer){
						myPlayer.hp = clamp(myPlayer.hp - CONFIG.animals.wolfDamage,0,CONFIG.playerStats.maxHP);
						myPlayer.lastPlayerHit = now();
						spawnBloodEffect(myPlayer.x,myPlayer.y);
						const imp = applyPlayerKnockback(myPlayer, a.x, a.y, 320);
						for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'pHit', id: myNetId, hp: myPlayer.hp, kx: imp.kx, ky: imp.ky }));
					}else if (victimId && remotePlayers.has(victimId)){
						const rp = remotePlayers.get(victimId);
						if (rp){
							rp.hp = clamp((rp.hp ?? CONFIG.playerStats.maxHP) - CONFIG.animals.wolfDamage,0,CONFIG.playerStats.maxHP);
							rp.lastPlayerHit = now();
							spawnBloodEffect(rp.x,rp.y);
							const imp2 = applyPlayerKnockback(rp, a.x, a.y, 320);
							for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'pHit', id: victimId, hp: rp.hp, kx: imp2.kx, ky: imp2.ky }));
						}
					}
				}else { target.ref.hp = Math.max(0, target.ref.hp - CONFIG.animals.wolfDamage); applyAnimalKnockback(target.ref, a.x, a.y, 240); }
			}
			break; }
		case 'pounce': {
			if (!target){ a.state='roam'; break; }
			a.stateTimer -= dt;
			const pxT=target.ref.x, pyT=target.ref.y; const pdx=pxT-a.x, pdy=pyT-a.y; const pd=Math.hypot(pdx,pdy)||1;
			const burst=CONFIG.animals.wolfSpeed*2.2;
			// snap heading faster in pounce
			const desiredAngle = Math.atan2(pdy,pdx);
			let diff = desiredAngle - a.heading; while(diff>Math.PI) diff -= Math.PI*2; while(diff<-Math.PI) diff += Math.PI*2;
			a.heading += Math.sign(diff) * Math.min(Math.abs(diff), (CHASE_TURN*1.6)*dt);
			a._goalVx = Math.cos(a.heading)*burst; a._goalVy = Math.sin(a.heading)*burst;
			if (a.stateTimer<=0) a.state='chase';
			break; }
	}
	// Mild passive energy regen already handled; no direct vx modification here (steering system handles)
}
function drawAnimals(g){
	for (const a of animals){ if (a.hp<=0) continue; drawAnimal(g,a); }
}
function drawAnimal(g,a){
	// Time-shifted interpolation using buffered snapshots for smooth motion (similar to classic client-side lerp buffer)
	let rx=a.x, ry=a.y, ang = a.heading||0;
	if (a.snaps && a.snaps.length>=2){
		const delay = window._animalRenderDelay || 120; const renderTime = now() - delay;
		let s1=a.snaps[0], s2=a.snaps[a.snaps.length-1];
		for (let i=a.snaps.length-2;i>=0;i--){ const s=a.snaps[i]; if (s.t <= renderTime){ s1=s; s2=a.snaps[i+1]||s; break; } }
		const span = Math.max(1, s2.t - s1.t); const f = clamp((renderTime - s1.t)/span,0,1);
		rx = s1.x + (s2.x - s1.x)*f; ry = s1.y + (s2.y - s1.y)*f;
		let h1 = s1.heading, h2 = s2.heading; let dh=h2-h1; while(dh>Math.PI) dh-=Math.PI*2; while(dh<-Math.PI) dh+=Math.PI*2; ang = h1 + dh*f;
		// Additional mild forward prediction near latest snapshot to hide stall
		if (f>0.95 && s2===a.snaps[a.snaps.length-1] && a.snaps.length>=2){ const last = a.snaps[a.snaps.length-1]; const prev = a.snaps[a.snaps.length-2]; const dtMs = Math.max(1,last.t - prev.t); const vx=(last.x - prev.x)/dtMs; const vy=(last.y - prev.y)/dtMs; const lead = (f-0.95)/0.05; rx += vx*dtMs*0.25*lead; ry += vy*dtMs*0.25*lead; }
	}
	// Angle smoothing cap (reuse previous render angle)
	if (a._renderHead==null) a._renderHead = ang; else { let diff=ang - a._renderHead; while(diff>Math.PI) diff-=Math.PI*2; while(diff<-Math.PI) diff+=Math.PI*2; const dtSec=Math.max(0.001,(now()-(a._lastHeadTime||now()))/1000); a._lastHeadTime=now(); const maxTurn=8*dtSec; if (Math.abs(diff)<=maxTurn) a._renderHead=ang; else a._renderHead += Math.sign(diff)*maxTurn; }
	ang = a._renderHead;
	const spr = animalSprites[a.type];
	if (!(spr && spr.ready)) return;
	g.save(); g.translate(rx,ry); g.rotate(ang);
	const srcSize = Math.max(spr.w||0, spr.h||0) || 128;
	const target = ANIMAL_BASE_DRAW; const scale = (spr.scale||1) * (target / srcSize); const drawSize = srcSize * scale;
	g.drawImage(spr.img, -drawSize/2, -drawSize/2, drawSize, drawSize);
	g.restore();
	// Health bar (non-rotated) - smaller + color by hostility (wolf = hostile => red tint, others green)
	const maxHP = a.maxHP || (a.type==='wolf'?70:(a.type==='cow'?120:90));
	const pct = Math.max(0, Math.min(1, a.hp / maxHP));
	const sprScale = (animalSprites[a.type]?.scale)||1;
	// Match player health bar size
	const bw = 90; // same width as player bar
	const bh = 12; // same height as player bar
	const offsetY = ANIMAL_BASE_DRAW * 0.50 * sprScale + 6; // vertical placement relative to animal sprite
	const x0 = rx - bw/2; const y0 = ry + offsetY;
	const hostile = (a.type === 'wolf');
	const fillCol = hostile ? '#ff5a52' : '#33c24d';
	const borderCol = hostile ? '#a52a24' : '#1d5a2c';
	const bgCol = 'rgba(0,0,0,0.45)';
	g.save();
	g.fillStyle = bgCol;
	if (g.roundRect) { g.beginPath(); g.roundRect(x0, y0, bw, bh, 6); g.fill(); }
	else { g.fillRect(x0, y0, bw, bh); }
	const wFill = bw * pct;
	g.fillStyle = fillCol;
	if (wFill > 0){ if (g.roundRect){ g.beginPath(); g.roundRect(x0, y0, wFill, bh, 6); g.fill(); } else { g.fillRect(x0, y0, wFill, bh); } }
	g.lineWidth = 1.3; g.strokeStyle = borderCol;
	if (g.roundRect){ g.beginPath(); g.roundRect(x0+0.5, y0+0.5, bw-1, bh-1, 5); g.stroke(); }
	else { g.strokeRect(x0+0.5, y0+0.5, bw-1, bh-1); }
	g.restore();
}

function randScatter(type, count) {
	for (let i=0;i<count;i++) {
		const pad = 200;
		let attempts=0, x, y;
		let radiusGuess = type==='tree'?175: type==='stone'?70:60; // base separation radius (trees slightly larger)
		do {
			x = pad + Math.random()*(CONFIG.map.width - pad*2);
			y = pad + Math.random()*(CONFIG.map.height - pad*2);
			attempts++;
			if (attempts>400) break; // fail-safe
		} while (overlapsExisting(x,y,radiusGuess));
		const o = { id: 'o'+Math.random().toString(36).slice(2,9), type, x, y, variant: (Math.random()*8)|0 };
		if (type==='tree') { o.maxHP = 100; o.hp = o.maxHP; o.colR = 110; }
		else if (type==='stone') { o.maxHP = 120; o.hp = o.maxHP; o.colR = 60; }
		else if (type==='bush') { o.maxHP = 60; o.hp = o.maxHP; o.colR = 55; }
		// Precompute berries for bushes so they don't flicker
		if (type==='bush') {
			const berryCount = 5 + (o.variant % 3);
			o.berries = [];
			for (let b=0;b<berryCount;b++) {
				const angle = Math.random()*Math.PI*2;
				const dist = 12 + Math.random()*14; // within bush
				o.berries.push({ x: Math.cos(angle)*dist, y: Math.sin(angle)*dist*0.75, r: 5 + Math.random()*2 });
			}
		}
		worldObjects.push(o);
	}
}

function overlapsExisting(x,y,r) {
	for (const o of worldObjects) {
		const rr = (o.colR||50) + r + 12; // pad
		if (Math.hypot(o.x - x, o.y - y) < rr) return true;
	}
	return false;
}

// ===== Punch Gathering (1 resource per hit, objects persist) =====
addEventListener('mousedown', handlePunch);
function isAnimalAuthority(){ return isHost || (!rtcPeer && !dataChannel && hostPeers.size===0); }
function handlePunch(e){
	if (chatInputActive) return; // no punching while typing
	if (e && e.target && e.target!==canvas) return; // clicked UI
	if (!inGame || !myPlayer) return;
	// If eating an apple or simply holding apple (no attacking), ignore punch
	if (equippedItem==='apple'){
		if (!eating && resources.food>0 && myPlayer.hp < CONFIG.playerStats.maxHP){
			// start eating
			eating=true; eatStart=now(); eatT=0; eatingStartHP = myPlayer.hp; eatingTargetHP = clamp(eatingStartHP + CONFIG.food.healPerApple,0,CONFIG.playerStats.maxHP);
		}
		return;
	}
	if (eating) return; // safety
	const t = now()/1000;
	if (t - lastGatherAttempt < CONFIG.gather.hitInterval) return;
	lastGatherAttempt = t;
	myPlayer.punchActive = true; myPlayer.punchT = 0;
	// Explicit attack message so host always processes tool hits even if state packet drops
	if (!isHost && dataChannel && dataChannel.readyState==='open'){
		// Include client timestamp for lag compensation (host will rewind up to configured window)
		try { dataChannel.send(JSON.stringify({ t:'attack', eq: equippedItem||null, angle: myPlayer.angle, ts: now() })); } catch{}
	}
	myPlayer.punchingHand = 1 - myPlayer.punchingHand; // alternate
	let range = CONFIG.gather.radius;
	const cone = (CONFIG.gather.coneDeg||90) * Math.PI/180; // radians
	const halfCone = cone * 0.5;
	// Tool multipliers
	const toolConf = equippedItem ? CONFIG.tools[equippedItem] : null;
	if (toolConf?.reach){ range *= toolConf.reach; }
	const woodMult = toolConf?.woodMult || 1;
	const stoneMult = toolConf?.stoneMult || 1;
	const dmgMult = toolConf?.damageMult || 1;
	let best=null, bestDist=Infinity;
	for (const o of worldObjects) {
		const dx = o.x - myPlayer.x;
		const dy = o.y - myPlayer.y;
		const d = Math.hypot(dx, dy);
		if (d > range) continue;
		// angle difference
		let ang = Math.atan2(dy,dx) - myPlayer.angle;
		// wrap to [-PI,PI]
		ang = (ang + Math.PI) % (Math.PI*2) - Math.PI;
		if (Math.abs(ang) > halfCone) continue; // outside aim cone
		if (d < bestDist) { best = o; bestDist = d; }
	}
	if (best){
		if (best.type==='tree') resources.wood += Math.max(1, Math.round(1 * woodMult));
		else if (best.type==='stone') resources.stone += Math.max(1, Math.round(1 * stoneMult));
		else if (best.type==='bush') resources.food += 1;
		updateResourceHUD();
		best.lastHit = now();
		screenShake = Math.min(screenShake + 4, 10);
		spawnHitEffect(best.x, best.y, best.type);
		broadcastHitLocal(best.id);
	}
	// Attempt to damage closest structure within range (secondary - requires angle)
	let sBest=null, sBestDist=Infinity;
	for (const s of structures){
		const dx = s.x - myPlayer.x; const dy = s.y - myPlayer.y; const d=Math.hypot(dx,dy); if (d>range) continue; let ang=Math.atan2(dy,dx)-myPlayer.angle; ang=(ang+Math.PI)%(Math.PI*2)-Math.PI; if (Math.abs(ang)>halfCone) continue; if (d<sBestDist){ sBest=s; sBestDist=d; }
	}
	if (sBest){
		const offlineSolo = (!rtcPeer && !dataChannel && hostPeers.size===0);
		if (isHost || offlineSolo){
			applyStructureDamage(sBest, Math.round((CONFIG.combat.playerDamage||10)*dmgMult));
		}
	}
	// Player combat (authoritative side only): detect remote players (if host) and animals
	if (isAnimalAuthority()){
		const baseDmg = (CONFIG.combat.playerDamage||10) * dmgMult;
		// Animal hits (host only)
		for (const a of animals){
			if (a.dead) continue;
			const dx = a.x - myPlayer.x; const dy = a.y - myPlayer.y; const dist = Math.hypot(dx,dy);
			const ar = getAnimalRadius(a)*0.9; // effective body radius (slightly larger)
			// Primary range test (allow some slack beyond gather range based on animal size)
			if (dist > range + ar*0.35) continue;
			// Overlap close-contact auto-hit (grace zone ignores angle if basically touching)
			const close = dist < ar + 14;
			let ang = 0;
			if (!close){
				ang = Math.atan2(dy,dx) - myPlayer.angle; ang = (ang + Math.PI) % (Math.PI*2) - Math.PI; if (Math.abs(ang) > halfCone) continue;
			}
			const resist = (CONFIG.combat.animalResist?.[a.type]) ?? 1; const dmg = Math.max(1, Math.round(baseDmg * resist));
			applyAnimalDamage(a, dmg, myNetId); screenShake = Math.min(screenShake+2,10);
		}
		if (isHost){
			for (const [pid,p] of remotePlayers){
			if (p.x==null) continue;
			const dx = p.x - myPlayer.x; const dy = p.y - myPlayer.y; const d = Math.hypot(dx,dy);
			if (d > range*0.75) continue; // slightly shorter than resource range
			let ang = Math.atan2(dy,dx) - myPlayer.angle; ang = (ang + Math.PI) % (Math.PI*2) - Math.PI;
			if (Math.abs(ang) > halfCone) continue;
			// apply damage
			p.hp = clamp((p.hp ?? CONFIG.playerStats.maxHP) - baseDmg, 0, CONFIG.playerStats.maxHP);
			p.lastPlayerHit = now();
			spawnBloodEffect(p.x,p.y);
			const imp = applyPlayerKnockback(p, myPlayer.x, myPlayer.y, 360);
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'pHit', id: pid, hp: p.hp, kx: imp.kx, ky: imp.ky }));
		}
		}
	}
}

// Auto continue punching while holding
function autoPunchLoop(){
	if (mouseDown && !eating && !buildingItem) handlePunch();
	requestAnimationFrame(autoPunchLoop);
}
requestAnimationFrame(autoPunchLoop);

// Host-side: process attack from remote player p (with id attackerId)
// Helper: ensure a rolling positional history exists for an entity (player or animal)
function _pushHist(obj){
	if (!obj) return;
	const t = now();
	if (!obj.hist) obj.hist = [];
	const h = obj.hist;
	// Only push if moved meaningfully or >40ms elapsed to limit spam
	if (h.length){
		const last = h[h.length-1];
		if ((t - last.t) < 40 && Math.hypot((obj.x||0)-last.x,(obj.y||0)-last.y) < 2) return;
	}
	h.push({ t, x: obj.x, y: obj.y, angle: obj.angle||obj.heading||0 });
	// Prune > 1500ms old to bound memory
	const cutoff = t - 1500;
	while(h.length && h[0].t < cutoff) h.shift();
}
// Rewind helper: sample historical position by linear interpolation
function _rewind(obj, tWant){
	if (!obj || !obj.hist || obj.hist.length<2) return { x: obj.x, y: obj.y, angle: obj.angle||obj.heading||0 };
	const h = obj.hist;
	// Clamp to bounds
	if (tWant >= h[h.length-1].t) return { x:h[h.length-1].x, y:h[h.length-1].y, angle:h[h.length-1].angle };
	if (tWant <= h[0].t) return { x:h[0].x, y:h[0].y, angle:h[0].angle };
	// Find interval (linear scan backwards - small buffer)
	for (let i=h.length-2;i>=0;i--){
		const a=h[i], b=h[i+1];
		if (a.t <= tWant && b.t >= tWant){
			const span=b.t-a.t||1; const f=(tWant-a.t)/span;
			let angA=a.angle, angB=b.angle; let d=angB-angA; while(d>Math.PI) d-=Math.PI*2; while(d<-Math.PI) d+=Math.PI*2; const ang=angA + d*f;
			return { x: a.x + (b.x-a.x)*f, y: a.y + (b.y-a.y)*f, angle: ang };
		}
	}
	return { x: obj.x, y: obj.y, angle: obj.angle||obj.heading||0 };
}

// Periodic history sampler (host only). Called from main loop; also clients keep local myPlayer for fairness when host rewinds victims.
function _recordHistories(){
	// Host records all entities; clients record only local player so host can rewind them (sent positions are still host authoritative though).
	if (myPlayer) _pushHist(myPlayer);
	if (isHost){
		for (const [,rp] of remotePlayers) if (rp && rp.x!=null) _pushHist(rp);
		for (const a of animals) if (a && a.hp>0) _pushHist(a);
	}
}

// Inject history recording into existing animation / simulation loop by wrapping requestAnimationFrame (idempotent guard)
if (!window._lagCompHistHooked){
	window._lagCompHistHooked = true;
	const _origRAF = window.requestAnimationFrame;
	window.requestAnimationFrame = function(fn){
		return _origRAF.call(window, function(ts){
			try { _recordHistories(); } catch{}
			fn(ts);
		});
	};
}

function processPlayerAttack(p, attackerId, attackMsg){
	// Allow in pure offline single-player (no peers, no rtc connections) as well as host
	const offlineSolo = (!rtcPeer && !dataChannel && hostPeers.size===0);
	if (!(isHost || offlineSolo)) return;
	let range = CONFIG.gather.radius;
	const cone = (CONFIG.gather.coneDeg||90) * Math.PI/180;
	const halfCone = cone*0.5;
	const toolConf = p.eq ? CONFIG.tools[p.eq] : null;
	if (toolConf?.reach){ range *= toolConf.reach; }
	const baseDmg = (CONFIG.combat.playerDamage||10) * (toolConf?.damageMult||1);
	// --- Lag compensation setup ---
	const hostNow = now();
	const cfgLag = (CONFIG.combat && CONFIG.combat.lagCompMs) || 350; // max rewind window ms
	let attackTime = hostNow;
	if (attackMsg && attackMsg.ts){
		// Clamp to window & not future
		const raw = Math.min(attackMsg.ts, hostNow);
		const diff = hostNow - raw;
		// If diff huge (clock skew), fall back to half window
		if (diff >=0 && diff <= 2000) attackTime = hostNow - Math.min(diff, cfgLag);
		else attackTime = hostNow - cfgLag*0.5;
	}else{
		attackTime = hostNow - cfgLag*0.33; // heuristic if no timestamp
	}
	// Acquire rewound attacker pose (angle influences cone)
	let rewAtt = _rewind(p, attackTime);
	const attackerAngle = attackMsg?.angle != null ? attackMsg.angle : rewAtt.angle;
	// --- Animals ---
	// Animal hits from remote player (host authoritative)
	for (const a of animals){
		if (a.dead) continue;
		// Rewind target
		const rewA = _rewind(a, attackTime);
		const dx = rewA.x - rewAtt.x; const dy = rewA.y - rewAtt.y; const dist = Math.hypot(dx,dy);
		const ar = getAnimalRadius(a)*0.9;
		if (dist > range + ar*0.35) continue;
		const close = dist < ar + 14;
		let ang = 0;
		if (!close){ ang = Math.atan2(dy,dx) - attackerAngle; ang = (ang + Math.PI) % (Math.PI*2) - Math.PI; if (Math.abs(ang) > halfCone) continue; }
		const resist = (CONFIG.combat.animalResist?.[a.type]) ?? 1; const dmg = Math.max(1, Math.round(baseDmg * resist));
		applyAnimalDamage(a, dmg, attackerId);
	}
	// Potential targets: host player + other remotes
	const targets = [];
	if (myPlayer) targets.push({ id: myNetId, obj: myPlayer, isLocal:true });
	for (const [id,r] of remotePlayers){ if (id!==attackerId) targets.push({ id, obj:r }); }
	for (const t of targets){
		const obj = t.obj; if (!obj || obj.x==null) continue;
		const rewObj = _rewind(obj, attackTime);
		const dx = rewObj.x - rewAtt.x; const dy = rewObj.y - rewAtt.y; const d = Math.hypot(dx,dy); if (d > range*0.75) continue;
		let ang = Math.atan2(dy,dx) - attackerAngle; ang = (ang + Math.PI) % (Math.PI*2) - Math.PI; if (Math.abs(ang) > halfCone) continue;
		obj.hp = clamp((obj.hp ?? CONFIG.playerStats.maxHP) - baseDmg,0,CONFIG.playerStats.maxHP);
		obj.lastPlayerHit = now(); spawnBloodEffect(obj.x,obj.y); screenShake = Math.min(screenShake+3,10);
		// Knockback feedback (use current positions for effect)
		const imp = applyPlayerKnockback(obj, p.x, p.y, 360);
		// Only broadcast player hit to peers if actually host in multiplayer
		if (isHost){ for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'pHit', id: t.id, hp: obj.hp, kx: imp.kx, ky: imp.ky })); }
	}
	// Structures (host authoritative)
	for (const s of structures){
		const dx = s.x - rewAtt.x; const dy = s.y - rewAtt.y; const d=Math.hypot(dx,dy); if (d>range) continue; let ang=Math.atan2(dy,dx)-attackerAngle; ang=(ang+Math.PI)%(Math.PI*2)-Math.PI; if (Math.abs(ang)>halfCone) continue; applyStructureDamage(s, Math.round(baseDmg)); }
}

// ===== Animal Combat / Respawn / Collisions =====
function getAnimalRadius(a){ return a.type==='cow'? 70 : a.type==='pig'? 60 : 62; }
function applyAnimalDamage(a, dmg, attackerId){
	if (a.dead) return;
	a.hp -= dmg;
	if (a.hp <= 0){
		a.hp = 0; a.dead = true; a.deathT = now(); awardFood(attackerId, a.type);
		if (isHost){
			broadcastAnimals();
			// death blood effect for others
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'aHit', x:a.x, y:a.y }));
		}
	} else {
		// small feedback
		spawnBloodEffect(a.x,a.y);
		if (isHost){
			broadcastAnimals();
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'aHit', x:a.x, y:a.y }));
		}
		// Force flee reaction for neutral animals when first hit
		if (a.type!=='wolf' && a.state!=='flee'){
			let sx=null, sy=null;
			if (attackerId === myNetId && myPlayer){ sx=myPlayer.x; sy=myPlayer.y; }
			else { const rp=remotePlayers.get(attackerId); if (rp && rp.x!=null){ sx=rp.x; sy=rp.y; } }
			if (sx!=null){ const dx=a.x - sx; const dy=a.y - sy; const d=Math.hypot(dx,dy)||1; a._fleeVecX = dx/d; a._fleeVecY = dy/d; a.wanderDir = Math.atan2(a._fleeVecY,a._fleeVecX); a.state='flee'; a.fleeTimer = 1.2; }
		}
	}
	// Knockback from attacker position
	if (isAnimalAuthority()){
		let sx=null, sy=null;
		if (attackerId === myNetId && myPlayer){ sx=myPlayer.x; sy=myPlayer.y; }
		else { const rp=remotePlayers.get(attackerId); if (rp && rp.x!=null){ sx=rp.x; sy=rp.y; } }
		if (sx!=null) applyAnimalKnockback(a, sx, sy, 260);
	}
}
function applyStructureDamage(s, dmg){
	// Treat pure offline single-player as authoritative host so structures can be damaged locally
	const offlineSolo = (!rtcPeer && !dataChannel && hostPeers.size===0);
	if (!(isHost || offlineSolo) || !s) return;
	// Apply damage & local feedback (particles & flash always local)
	s.hp -= dmg; if (s.hp<0) s.hp=0; s._hitFlash=now();
	try { const fxType = (s.type && s.type.indexOf('stone')!==-1) ? 'stone' : 'tree'; spawnHitEffect(s.x, s.y, fxType); } catch(e) { /* ignore */ }
	// Only broadcast to connected peers if we are actual multiplayer host
	if (isHost){
		const payload = JSON.stringify({ t:'structHit', id:s.id, hp:s.hp, st:s.type });
		for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(payload);
	}
	if (s.hp<=0){
		const idx=structures.indexOf(s); if (idx>=0) structures.splice(idx,1);
		if (isHost){
			const gone = JSON.stringify({ t:'structGone', id:s.id });
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(gone);
		}
	}
}
function awardFood(playerId, type){
	// Reduced food drops to slow progression (was pig 50, wolf 120, cow 230). Adjusted scaling.
	const add = type==='pig'?10 : type==='wolf'?50 : 30;
	if (playerId === myNetId && myPlayer){
		myPlayer.food = (myPlayer.food||0)+add;
		// Also reflect into general resources food if that's what's shown in HUD
		if (resources){ resources.food = (resources.food||0) + add; updateResourceHUD?.(); }
	}
	if (isHost){
		if (playerId !== myNetId){
			const peer = hostPeers.get(playerId);
			if (peer && peer.dc && peer.dc.readyState==='open'){
				peer.dc.send(JSON.stringify({ t:'food', add }));
			}
		}
	}
}
function updateAnimalRespawns(){
	if (!(isHost || (!rtcPeer && !dataChannel && hostPeers.size===0))) return;
	const nowT = now();
	// 1. Despawn fully dead animals after a delay (so corpse can be seen) then possibly respawn later by population logic
	for (let i=animals.length-1;i>=0;i--){
		const a=animals[i];
		if (a.dead){
			// After 5s remove from array
			if (a.deathT && (nowT - a.deathT) > 5000){ animals.splice(i,1); }
		}
	}
	// 2. Maintain target counts (simple: if below configured count, spawn new)
	const counts = { cow:0, pig:0, wolf:0 };
	for (const a of animals){ if (!a.dead && counts[a.type]!==undefined) counts[a.type]++; }
	function need(type){ return (CONFIG.animals.count[type]||0) - (counts[type]||0); }
	const needWolf = need('wolf'); const needCow=need('cow'); const needPig=need('pig');
	if (needWolf>0) spawnAnimals('wolf', needWolf);
	if (needCow>0) spawnAnimals('cow', needCow);
	if (needPig>0) spawnAnimals('pig', needPig);
	// 3. Broadcast updated animal list to clients if host (simple approach; could be optimized)
	if (isHost && hostPeers.size>0){ broadcastAnimals(); }
}
function resolveAnimalCollisions(){
	for (let i=0;i<animals.length;i++){
		const a=animals[i]; if (a.dead) continue; const rA=getAnimalRadius(a);
		for (let j=i+1;j<animals.length;j++){
			const b=animals[j]; if (b.dead) continue; const rB=getAnimalRadius(b); const dx=b.x-a.x, dy=b.y-a.y; const d=dx*dx+dy*dy; const min=(rA+rB)*0.55; if (d>0 && d < min*min){ const dist=Math.sqrt(d)||0.001; const push=(min-dist)/2; const nx=dx/dist, ny=dy/dist; a.x-=nx*push; a.y-=ny*push; b.x+=nx*push; b.y+=ny*push; }
		}
		for (const o of worldObjects){ const rr=(o.colR||50) + rA*0.5; const dx=a.x-o.x, dy=a.y-o.y; const d=dx*dx+dy*dy; if (d< rr*rr){ const dist=Math.sqrt(d)||0.001; const push=rr-dist; const nx=dx/dist, ny=dy/dist; a.x+=nx*push; a.y+=ny*push; } }
	}
}
function resolvePlayerAnimalCollision(player){
	for (const a of animals){ if (a.dead) continue; const r=getAnimalRadius(a)*0.5 + CONFIG.player.radius*0.8; const dx=player.x-a.x, dy=player.y-a.y; const d=dx*dx+dy*dy; if (d< r*r && d>0){ const dist=Math.sqrt(d); const push=r-dist; const nx=dx/dist, ny=dy/dist; player.x+=nx*push; player.y+=ny*push; } }
}

// ===== Knockback Utilities =====
function applyPlayerKnockback(player, srcX, srcY, force){
	const dx = player.x - srcX; const dy = player.y - srcY; let d=Math.hypot(dx,dy); if (d<0.001){ d=0.001; }
	const nx=dx/d, ny=dy/d; const f = force||320;
	const beforeVx = player.vx||0, beforeVy = player.vy||0;
	player.vx = beforeVx + nx * f; player.vy = beforeVy + ny * f;
	player.knockTimer = 0.18; // brief movement suppression
	return { kx: player.vx - beforeVx, ky: player.vy - beforeVy };
}
function applyAnimalKnockback(animal, srcX, srcY, force){
	if (animal.dead) return;
	const dx = animal.x - srcX; const dy = animal.y - srcY; let d=Math.hypot(dx,dy); if (d<0.001){ d=0.001; }
	const nx=dx/d, ny=dy/d; const f = force||250;
	animal.vx = (animal.vx||0) + nx * f;
	animal.vy = (animal.vy||0) + ny * f;
}

function spawnHitEffect(x,y,type){
	const palette = type==='tree'? ['#d5ffd9','#8dffaf','#ffffff'] : type==='stone'? ['#e2e6ed','#bcc4cf','#ffffff'] : ['#ffe1d7','#ffc9bd','#ffffff'];
	const particles=[];
	for (let i=0;i<8;i++) {
		const ang = Math.random()*Math.PI*2;
		const spd = 160 + Math.random()*140;
		particles.push({ x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life: 260 + Math.random()*140, start: now(), r: 6 + Math.random()*4, c: palette[i%palette.length] });
	}
	hitEffects.push({ particles });
}

function spawnBloodEffect(x,y){
	const palette = ['#ff3535','#ff6845','#ff9a6a','#ffffff'];
	const particles=[]; const n = CONFIG.combat.bloodParticles||10;
	for (let i=0;i<n;i++){
		const ang = Math.random()*Math.PI*2;
		const spd = 220 + Math.random()*260;
		particles.push({ x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life: 340 + Math.random()*220, start: now(), r: 5 + Math.random()*6, c: palette[i%palette.length] });
	}
	hitEffects.push({ particles });
}

// ===== Resource HUD =====
const elResWood = document.getElementById('res-wood');
const elResStone = document.getElementById('res-stone');
const elResFood = document.getElementById('res-food');
const resPanel = document.getElementById('res-panel');
// Hotbar elements & logic
const hotbarEl = document.getElementById('hotbar');
let hotbarIndex = 0; // active slot (0-based)
const HOTBAR_SIZE = 4; // reduced (removed slots 5 & 6)
function updateHotbarActive(){
	if (!hotbarEl) return;
	for (const slot of hotbarEl.querySelectorAll('.hot-slot')){
		const idx = parseInt(slot.getAttribute('data-slot')) - 1;
		if (idx === hotbarIndex) slot.classList.add('active'); else slot.classList.remove('active');
	}
}
function showHotbar(){ if (hotbarEl){ hotbarEl.classList.remove('hidden'); updateHotbarActive(); } }
addEventListener('keydown', e=>{
	if (!inGame) return;
	if (chatInputActive){ // suppress all game hotkeys while typing (except Enter handled earlier)
		if (e.code && e.code.startsWith('Digit')){ e.preventDefault(); return; }
		if (e.code==='KeyE' || e.code==='Escape'){ e.preventDefault(); return; }
	}
	if (e.code && e.code.startsWith('Digit')){
		const d = parseInt(e.key,10);
		if (d>=1 && d<=HOTBAR_SIZE){ hotbarIndex = d-1; updateHotbarActive();
			// When switching hotbar via number while any panel is open, hide previous contextual UI
			if (inventoryOpen && hotbarIndex!==1){ closeInventory(); }
			if (buildPanelOpen && hotbarIndex!==3){ closeBuildPanel(); buildingItem=null; }
			// If we were holding a structure preview (buildingItem) and switch away from the build slot (index 3 -> hotbarIndex 3), cancel it
			if (hotbarIndex!==3 && !buildPanelOpen && buildingItem){ buildingItem=null; }
			if (hotbarIndex===0){ // slot 1 -> bare hands
				// cancel eating if currently eating apple
				if (eating){ eating=false; eatT=0; }
				if (equippedItem==='apple' && eating) { eating=false; eatT=0; }
				equippedItem = null; highlightEquipped?.();
			}
			if (hotbarIndex===2){ // slot 3 (0-based)
				if (resources.food>0){ if (equippedItem && equippedItem!=='apple') lastNonFoodItem = equippedItem; equippedItem = 'apple'; eating=false; eatT=0; highlightEquipped?.(); }
			}
			if (hotbarIndex===3){ // slot 4 => building structures toggle
				// Opening build panel closes inventory if open
				if (!buildPanelOpen){ closeInventory(); }
				if (buildPanelOpen){ closeBuildPanel(); buildingItem=null; }
				else if (buildingItem){ buildingItem=null; }
				else { buildingItem=null; openBuildPanel(); }
				if (buildPanelOpen) { equippedItem=null; highlightEquipped?.(); }
			}
		}
	}
});
// Inventory + Crafting (E key or hotbar slot 2)
const inventoryPanel = document.getElementById('inventory-panel');
const ownedItems = new Set(); // items player has crafted
let inventoryOpen = false;
let equippedItem = null;
let eating = false; let eatT = 0; let eatStart = 0; // apple eating state
let eatingStartHP = 0; let eatingTargetHP = 0; // tracked for smooth regen without instant full heal
let lastNonFoodItem = null; // remember previously equipped tool to restore after eating
// Crafting recipes
const CRAFT_RECIPES = {
	stone_pickaxe: { name: 'Stone Pickaxe', gives: 'pickaxe', cost: { wood:20, stone:30 } },
	stone_axe:     { name: 'Stone Axe',     gives: 'axe',     cost: { wood:10, stone:20 } },
	stone_sword:   { name: 'Stone Sword',   gives: 'sword',   cost: { wood:10, stone:30 } }
};
function hasItem(id){ return ownedItems.has(id); }
function canCraft(key){ const r = CRAFT_RECIPES[key]; if(!r) return false; // disallow if already owned
	if (r && ownedItems.has(r.gives)) return false;
	for (const res in r.cost){ if ((resources[res]||0) < r.cost[res]) return false; }
	return true; }
function craftItem(key){ const r = CRAFT_RECIPES[key]; if(!r || ownedItems.has(r.gives) || !canCraft(key)) return; for (const res in r.cost){ resources[res]-=r.cost[res]; if (resources[res]<0) resources[res]=0; } ownedItems.add(r.gives); if (!equippedItem) equippedItem = r.gives; updateResourceHUD(); highlightEquipped(); updateCraftingUI(); }
function highlightEquipped(){ if (!inventoryPanel) return; for (const btn of inventoryPanel.querySelectorAll('.inv-item')){ const id=btn.getAttribute('data-item'); let owned = hasItem(id); if (id==='apple') owned = resources.food>0; btn.classList.toggle('owned', owned); btn.classList.toggle('selected', owned && id===equippedItem); btn.disabled = !owned; btn.style.opacity = owned? '1' : '0.35'; } }
function updateCraftingUI(){ if (!inventoryPanel) return; inventoryPanel.querySelectorAll('.craft-recipe').forEach(rec=>{ const key=rec.getAttribute('data-recipe'); const r=CRAFT_RECIPES[key]; if(!r) return; const already = ownedItems.has(r.gives); const craftable = canCraft(key); rec.classList.toggle('crafted', already); rec.classList.toggle('craftable', craftable && !already); rec.classList.toggle('unavailable', !craftable && !already); rec.querySelectorAll('.need').forEach(span=>{ const res=span.getAttribute('data-res'); const need=parseInt(span.getAttribute('data-val'),10)||0; if ((resources[res]||0) < need) span.classList.add('lack'); else span.classList.remove('lack'); }); const btn=rec.querySelector('.craft-btn'); if (btn){ if (already){ btn.textContent='Owned'; btn.disabled=true; } else { btn.textContent='Craft'; btn.disabled = !craftable; } } }); }
function openInventory(){ if (inventoryPanel && !inventoryOpen){ inventoryPanel.classList.remove('hidden'); inventoryOpen=true; highlightEquipped(); updateCraftingUI(); } }
function closeInventory(){ if (inventoryPanel && inventoryOpen){ inventoryPanel.classList.add('hidden'); inventoryOpen=false; } }
function toggleInventory(force){ const want = force!=null?force:!inventoryOpen; if (want) openInventory(); else closeInventory(); }
inventoryPanel?.addEventListener('click', e=>{ const craftBtn = e.target.closest('.craft-btn'); if (craftBtn){ craftItem(craftBtn.getAttribute('data-make')); return; } const btn = e.target.closest('.inv-item'); if (!btn) return; const id = btn.getAttribute('data-item'); if (!hasItem(id)) return; equippedItem = id; highlightEquipped(); });
addEventListener('keydown', e=>{ if (!inGame) return; if (chatInputActive){ if (e.code.startsWith('Digit')|| e.code==='KeyE' || e.code==='Escape'){ e.preventDefault(); return; } }
 if (e.code==='KeyE'){ toggleInventory(); e.preventDefault(); return; }
 if (e.code && e.code.startsWith('Digit')){ const d=parseInt(e.key,10); if (d===2){ toggleInventory(); } else if (inventoryOpen && d>=1 && d<=HOTBAR_SIZE){ toggleInventory(false); } }
 if (e.code==='Escape' && inventoryOpen){ closeInventory(); } });

// Global click-off to hide UI panels when clicking outside them
document.addEventListener('mousedown', (e)=>{
	// Ignore if chat typing or not in game
	if (!inGame || chatInputActive) return;
	const target = e.target;
	// Inventory panel
	if (inventoryOpen && inventoryPanel){
		if (!inventoryPanel.contains(target)) closeInventory();
	}
	// Build panel (if defined in DOM & state variable exists)
	const buildPanelEl = document.getElementById('build-panel');
	if (typeof buildPanelOpen !== 'undefined' && buildPanelOpen && buildPanelEl){
		if (!buildPanelEl.contains(target)) { try { closeBuildPanel(); } catch{} buildingItem=null; }
	}
	// Settings panel (optional future panel with id 'settings-panel' and flag settingsOpen)
	const settingsPanelEl = document.getElementById('settings-panel');
	if (settingsPanelEl && typeof settingsOpen !== 'undefined' && settingsOpen){
		if (!settingsPanelEl.contains(target)) { try { settingsPanelEl.classList.add('hidden'); settingsOpen=false; } catch{} }
	}
});
function updateResourceHUD() {
	elResWood.textContent = resources.wood;
	elResStone.textContent = resources.stone;
	elResFood.textContent = resources.food;
	resPanel.classList.remove('hidden');
	if (inventoryOpen) { try { updateCraftingUI(); } catch{} }
	// throttle client->host resource sync
	if (!isHost && dataChannel && dataChannel.readyState==='open'){
		const nowT = now();
		if (nowT - _lastResourceSync > 450){
			_lastResourceSync = nowT;
			try { dataChannel.send(JSON.stringify({ t:'resourcesSet', set:{ wood:resources.wood, stone:resources.stone, food:resources.food } })); } catch{}
		}
	}
}

// ===== Render Objects =====
function drawObjects(g) {
	// Draw under player; simple layering by y for minor depth: sort but limit cost
	worldObjects.sort((a,b)=>a.y-b.y);
	for (const o of worldObjects) {
		// Highlight / scale on recent hit
		const hitAge = o.lastHit ? (now() - o.lastHit) / 300 : 1; // ms scale
		const active = hitAge < 1;
		const scale = active ? 1 + 0.18 * (1 - hitAge) : 1;
		g.save();
		if (active) {
			g.translate(o.x, o.y);
			g.scale(scale, scale);
			g.translate(-o.x, -o.y);
		}
		if (o.type==='tree') drawTree(g,o);
		else if (o.type==='stone') drawStone(g,o);
		else if (o.type==='bush') drawBush(g,o);
		g.restore();
	}
}

function drawTree(g,o){
	// Classic 5-point star canopy (slightly bigger than prior)
	const outerR = 155; // star outer radius
	const innerR = 78;  // inner radius adjusted
	const cx = o.x; const cy = o.y - 6;
	const rot = (o.variant * 0.4) % (Math.PI*2);
	g.beginPath();
	for (let i=0;i<10;i++) {
		const ang = rot + Math.PI/2 + i * Math.PI/5;
		const rad = (i % 2 === 0 ? outerR : innerR) * (1 + 0.02*Math.sin(o.variant + i));
		const px = cx + Math.cos(ang)*rad;
		const py = cy + Math.sin(ang)*rad;
		if (i===0) g.moveTo(px,py); else g.lineTo(px,py);
	}
	g.closePath();
	// Flash overlay if hit
	const flash = o.lastHit && (now() - o.lastHit) < 120;
	const baseFill = '#5a7f47';
	g.fillStyle = flash ? '#7fb35f' : baseFill; g.fill();
	g.lineWidth = 1.3; g.strokeStyle = '#2e4025'; g.lineJoin='round'; g.stroke();
	// Inner star to add depth but keep star identity
	g.beginPath();
	for (let i=0;i<10;i++) {
		const ang = rot + Math.PI/2 + i * Math.PI/5;
		const rad = (i % 2 === 0 ? outerR*0.55 : innerR*0.55);
		const px = cx + Math.cos(ang)*rad;
		const py = cy + Math.sin(ang)*rad;
		if (i===0) g.moveTo(px,py); else g.lineTo(px,py);
	}
	g.closePath();
	g.fillStyle = '#6d9960'; g.fill();
}
function drawStone(g,o){
	// Big flat hex w/ inner hex (not vertically squashed)
	const size = 70; const cx=o.x, cy=o.y - 4;
	g.beginPath();
	for (let i=0;i<6;i++) {
		const ang = Math.PI/6 + i * Math.PI/3 + o.variant*0.05;
		const px = cx + Math.cos(ang)*size;
		const py = cy + Math.sin(ang)*size;
		if (i===0) g.moveTo(px,py); else g.lineTo(px,py);
	}
	g.closePath();
	const flash = o.lastHit && (now() - o.lastHit) < 120;
	g.fillStyle = flash ? '#7b8293' : '#626879'; g.fill();
	g.lineWidth=1.3; g.strokeStyle = '#2b2f38'; g.lineJoin='round'; g.stroke();
	// Inner hex
	const inner = size*0.55;
	g.beginPath();
	for (let i=0;i<6;i++) {
		const ang = Math.PI/6 + i * Math.PI/3 + o.variant*0.05;
		const px = cx + Math.cos(ang)*inner;
		const py = cy + Math.sin(ang)*inner;
		if (i===0) g.moveTo(px,py); else g.lineTo(px,py);
	}
	g.closePath();
	g.fillStyle = '#747c8d'; g.fill();
}
function drawBush(g,o){
	// True rounded hex using quadratic corners so it differs from stones
	const size = 68; const cx=o.x, cy=o.y - 4;
	const sides = 6;
	const corner = size * 0.38; // corner radius influence
	const pts = [];
	for (let i=0;i<sides;i++) {
		const ang = Math.PI/6 + i * (Math.PI*2/sides) + o.variant*0.07;
		pts.push({ x: cx + Math.cos(ang)*size, y: cy + Math.sin(ang)*size });
	}
	// Outer rounded path
	g.beginPath();
	for (let i=0;i<sides;i++) {
		const curr = pts[i];
		const prev = pts[(i-1+sides)%sides];
		const next = pts[(i+1)%sides];
		const vPrev = normalize(curr.x - prev.x, curr.y - prev.y);
		const vNext = normalize(curr.x - next.x, curr.y - next.y);
		// Points where curve starts/ends along edges
		const p1 = { x: curr.x - vPrev.x * corner, y: curr.y - vPrev.y * corner };
		const p2 = { x: curr.x - vNext.x * corner, y: curr.y - vNext.y * corner };
		if (i===0) g.moveTo(p1.x, p1.y); else g.lineTo(p1.x, p1.y);
		g.quadraticCurveTo(curr.x, curr.y, p2.x, p2.y);
	}
	g.closePath();
	const flash = o.lastHit && (now() - o.lastHit) < 120;
	g.fillStyle = flash ? '#53b562' : '#3b8f4c'; g.fill();
	g.lineWidth=1.3; g.strokeStyle='#1e4e2a'; g.stroke();
	// Inner rounded hex (smaller)
	const innerScale = 0.6;
	g.beginPath();
	for (let i=0;i<sides;i++) {
		const curr = pts[i];
		const prev = pts[(i-1+sides)%sides];
		const next = pts[(i+1)%sides];
		const cxn = cx + (curr.x - cx)*innerScale;
		const cyn = cy + (curr.y - cy)*innerScale;
		const pxn = cx + (prev.x - cx)*innerScale;
		const npx = cx + (next.x - cx)*innerScale;
		const pyn = cy + (prev.y - cy)*innerScale;
		const npy = cy + (next.y - cy)*innerScale;
		const vPrev = normalize(cxn - pxn, cyn - pyn);
		const vNext = normalize(cxn - npx, cyn - npy);
		const cr = corner * innerScale * 0.9;
		const p1 = { x: cxn - vPrev.x * cr, y: cyn - vPrev.y * cr };
		const p2 = { x: cxn - vNext.x * cr, y: cyn - vNext.y * cr };
		if (i===0) g.moveTo(p1.x,p1.y); else g.lineTo(p1.x,p1.y);
		g.quadraticCurveTo(cxn, cyn, p2.x, p2.y);
	}
	g.closePath();
	g.fillStyle = flash ? '#68d37a' : '#4cab60'; g.fill();
	// Berries
	if (o.berries) {
		g.fillStyle = '#2f6dff';
		for (const b of o.berries) {
			g.beginPath(); g.arc(cx + b.x*0.85, cy + b.y*0.85, b.r, 0, Math.PI*2); g.fill();
		}
	}
}

function normalize(x,y){
	const d = Math.hypot(x,y) || 1; return { x: x/d, y: y/d };
}

// ===== Collision Resolution =====
function resolveCollisions(player) {
	for (const o of worldObjects) {
		if (o.hp<=0) continue;
		let rObj = (o.colR || 60);
		if (o.type === 'tree') rObj *= 0.82; // allow closer approach inside star points
		const rPlayer = CONFIG.player.radius;
		const dx = player.x - o.x;
		const dy = player.y - o.y;
		const dist = Math.hypot(dx,dy);
		const tol = CONFIG.collision.tolerance;
		const minDist = rObj + rPlayer - tol; // allow proximity before push
		if (dist < minDist) {
			const nx = dist===0?1:dx/dist;
			const ny = dist===0?0:dy/dist;
			const push = (minDist - dist);
			player.x += nx * push;
			player.y += ny * push;
			// project velocity onto normal and damp only separating penetration component
			const vn = player.vx * nx + player.vy * ny;
			if (vn < 0) {
				player.vx -= vn * nx * (1 + CONFIG.collision.velocityDamp);
				player.vy -= vn * ny * (1 + CONFIG.collision.velocityDamp);
			}
		}
	}
	// Clamp again to map
	const r = CONFIG.player.radius;
	player.x = clamp(player.x, r, CONFIG.map.width - r);
	player.y = clamp(player.y, r, CONFIG.map.height - r);
}

// ===== Player vs Player Collision (local player against remote snapshots) =====
function resolvePlayerCollisions(local){
	if (!remotePlayers.size) return;
	const r = CONFIG.player.radius;
	for (const p of remotePlayers.values()){
		if (p.x == null || p.y == null) continue;
		const dx = local.x - p.x;
		const dy = local.y - p.y;
		let dist = Math.hypot(dx,dy);
		const minDist = r*2 - 4; // small overlap allowance
		if (dist < 0.0001){ // prevent NaN
			// random tiny nudge
			const angle = Math.random()*Math.PI*2;
			local.x += Math.cos(angle)*0.5;
			local.y += Math.sin(angle)*0.5;
			continue;
		}
		if (dist < minDist){
			const nx = dx/dist;
			const ny = dy/dist;
			const push = (minDist - dist)*0.5; // only push local half distance for softer effect
			local.x += nx * push;
			local.y += ny * push;
			// velocity slide
			const vn = local.vx * nx + local.vy * ny;
			if (vn < 0){
				local.vx -= vn * nx;
				local.vy -= vn * ny;
			}
		}
	}
}

// Host authoritative push resolution among all players (local host + remotes)
function hostResolvePlayerPush(){
	// Build combined array of players: host's player plus remote snapshots
	if (!myPlayer) return;
	const list = [];
	list.push({ isLocal:true, obj: myPlayer, id: myNetId });
	for (const [id,p] of remotePlayers) list.push({ isLocal:false, obj:p, id });
	const r = CONFIG.player.radius;
	let changed = false;
	for (let i=0;i<list.length;i++){
		for (let j=i+1;j<list.length;j++){
			const A = list[i].obj; const B = list[j].obj;
			if (A.x==null||B.x==null) continue;
			const dx = A.x - B.x; const dy = A.y - B.y; let dist=Math.hypot(dx,dy);
			const minDist = r*2 - 4;
			if (dist===0){ dist=0.0001; }
			if (dist < minDist){
				const nx = dx/dist, ny = dy/dist;
				const overlap = (minDist - dist);
				// equal push
				const push = overlap * 0.5;
				A.x += nx * push; A.y += ny * push;
				B.x -= nx * push; B.y -= ny * push;
				changed = true;
				// damp velocities along normal for both if they exist
				if (A.vx!=null){ const vnA = A.vx*nx + A.vy*ny; if (vnA>0){ A.vx -= vnA*nx; A.vy -= vnA*ny; } }
				if (B.vx!=null){ const vnB = B.vx*nx + B.vy*ny; if (vnB<0){ B.vx -= vnB*nx; B.vy -= vnB*ny; } }
			}
		}
	}
	if (changed){
		// Broadcast corrected positions
		for (const { dc } of hostPeers.values()) if (dc.readyState==='open'){
			const corrections = list.filter(e=>!e.isLocal).map(e=>({ id:e.id, x:e.obj.x, y:e.obj.y }));
			if (corrections.length){ dc.send(JSON.stringify({ t:'pushCorr', players: corrections })); }
		}
	}
}

// ===== Health Bar Render =====
function drawHealthBar(g, player) {
	if (player.hp == null) return;
	const pct = clamp(player.hp / CONFIG.playerStats.maxHP, 0,1);
	const width = 90; const height = 12; const x = player.x - width/2; const y = player.y + CONFIG.player.radius + 14;
	g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.roundRect ? g.roundRect(x, y, width, height, 6) : g.rect(x,y,width,height); g.fill();
	const wFill = width * pct;
	g.fillStyle = '#33c24d';
	g.beginPath(); g.roundRect ? g.roundRect(x, y, wFill, height, 6) : g.rect(x,y,wFill,height); g.fill();
	g.lineWidth = 1.3; g.strokeStyle = '#1d5a2c'; g.beginPath(); g.roundRect ? g.roundRect(x+0.5,y+0.5,width-1,height-1,5) : g.rect(x+0.5,y+0.5,width-1,height-1); g.stroke();
}

// ===== Hit Effects Rendering =====
function drawHitEffects(g, dt){
	for (let i=hitEffects.length-1;i>=0;i--) {
		const he = hitEffects[i];
		for (let j=he.particles.length-1;j>=0;j--) {
			const p = he.particles[j];
			const age = now() - p.start;
			if (age > p.life) { he.particles.splice(j,1); continue; }
			const k = age / p.life;
			p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt;
			g.globalAlpha = 1 - k;
			g.fillStyle = p.c;
			g.beginPath(); g.arc(p.x, p.y, p.r * (1 - k*0.6), 0, Math.PI*2); g.fill();
		}
		if (!he.particles.length) hitEffects.splice(i,1);
	}
	g.globalAlpha = 1;
}

// ===== Player-Built Structures (Hotbar 4) =====
// Structures are simple hex tiles (walls / door) with health & resource costs. Door lets players pass, blocks animals.
const structures = []; // {id,type,x,y,hp,maxHP,rad,passPlayer,passAnimals}
const BUILD_RECIPES = {
	woodWall:  { name:'Wood Wall',  cost:{ wood:5 },    hp:100, maxHP:100, rad:70, passPlayer:false, passAnimals:false },
	stoneWall: { name:'Stone Wall', cost:{ stone:5 },   hp:300, maxHP:300, rad:70, passPlayer:false, passAnimals:false },
	door:      { name:'Door',       cost:{ wood:1 },    hp:100, maxHP:100, rad:70, passPlayer:true,  passAnimals:false }
};
let buildingItem = null; // key from BUILD_RECIPES when equipped
let buildPanel = null; // UI element for selection
let buildPanelOpen = false;
// Track remote resources (authoritative on host) if not already declared
// remoteResources already declared earlier; ensure it exists on window for host/client symmetry
if (!window.remoteResources) window.remoteResources = remoteResources;
const BUILD_PLACE_DIST = 180; // distance from player along facing for placement (assumption)
// Structure authority: host OR single-player (no rtcPeer/dataChannel and no host peers).
function isStructureAuthority(){ return isHost || (!rtcPeer && !dataChannel && hostPeers.size===0); }

function ensureBuildPanel(){
	if (buildPanel) return;
	buildPanel = document.createElement('div');
	buildPanel.id = 'build-panel';
	// Reuse inventory styling classes for consistency
	try { buildPanel.classList.add('inv','build-panel'); } catch{}
	// Layout & container styling aligned with inventory aesthetic
	buildPanel.style.position='absolute';
	buildPanel.style.bottom='90px';
	buildPanel.style.left='50%';
	buildPanel.style.transform='translateX(-50%)';
	buildPanel.style.background='rgba(14,30,20,0.72)';
	buildPanel.style.padding='24px 30px 24px';
	buildPanel.style.border='1px solid rgba(70,140,100,0.35)';
	buildPanel.style.borderRadius='20px';
	buildPanel.style.display='flex';
	buildPanel.style.flexDirection='column';
	buildPanel.style.gap='14px';
	buildPanel.style.width='min(600px, 90vw)';
	buildPanel.style.boxShadow='0 4px 18px -4px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05)';
	buildPanel.style.zIndex='150';
	buildPanel.style.backdropFilter='blur(7px) saturate(1.4)';
	buildPanel.style.webkitBackdropFilter='blur(7px) saturate(1.4)';
	buildPanel.style.font='500 14px Rubik, sans-serif';
	buildPanel.style.color='#fff';
	buildPanel.style.letterSpacing='0.25px';
	// Heading (visually hidden but for accessibility ARIA label)
	buildPanel.setAttribute('role','dialog');
	buildPanel.setAttribute('aria-label','Build Structures');
	// Title heading similar to inventory menu
	const title = document.createElement('h3');
	title.className='inv-title';
	title.textContent='Build';
	title.style.margin='0 0 18px';
	// Left aligned like inventory (inv-title already styles)
	buildPanel.appendChild(title);
	for (const k of Object.keys(BUILD_RECIPES)){
		const r = BUILD_RECIPES[k];
		const btn = document.createElement('button');
		btn.className='build-btn';
		btn.innerHTML = '<span class="b-name">'+r.name+'</span>'+
			'<span class="b-cost">'+Object.entries(r.cost).map(([res,val])=>'<i class="fa-solid '+(res==='wood'?'fa-tree':res==='stone'?'fa-gem':'fa-apple-whole')+'"></i>'+val).join(' ')+'</span>';
		btn.style.cursor='pointer';
		btn.style.display='flex';
		btn.style.flexDirection='column';
		btn.style.alignItems='flex-start';
		btn.style.justifyContent='space-between';
		btn.style.gap='6px';
		btn.style.font='500 14px Rubik, sans-serif';
		btn.style.padding='10px 12px 9px';
		btn.style.borderRadius='12px';
		btn.style.border='1px solid rgba(255,255,255,0.12)';
		btn.style.background='linear-gradient(145deg,rgba(255,255,255,0.10),rgba(255,255,255,0.05))';
		btn.style.color='#fff';
		btn.style.position='relative';
		btn.style.transition='background .18s, border-color .18s, box-shadow .18s';
		btn.style.boxShadow='0 2px 6px -2px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)';
		btn.querySelector('.b-cost')?.style || (function(){ /* style via CSS injection below */ })();
		btn.addEventListener('mouseenter',()=>{ btn.style.background='linear-gradient(145deg,rgba(255,255,255,0.18),rgba(255,255,255,0.09))'; btn.style.borderColor='rgba(255,255,255,0.22)'; });
		btn.addEventListener('mouseleave',()=>{ btn.style.background='linear-gradient(145deg,rgba(255,255,255,0.10),rgba(255,255,255,0.05))'; btn.style.borderColor='rgba(255,255,255,0.12)'; });
		btn.addEventListener('mousedown',()=>{ btn.style.boxShadow='0 0 0 2px rgba(255,255,255,0.18) inset, 0 2px 4px -2px rgba(0,0,0,0.6)'; });
		btn.addEventListener('mouseup',()=>{ btn.style.boxShadow='0 2px 6px -2px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)'; });
		btn.addEventListener('focus',()=>{ btn.style.outline='2px solid #4cc2ff'; btn.style.outlineOffset='2px'; });
		btn.addEventListener('blur',()=>{ btn.style.outline='none'; });
		// Dynamic affordability state
		function refreshAffordable(){
			const can = canAffordBuild(k);
			btn.style.opacity = can? '1' : '0.55';
			btn.style.filter = can? 'none' : 'grayscale(0.6)';
		}
		refreshAffordable();
		btn._refreshAffordable = refreshAffordable;
		btn.addEventListener('click',()=>{
			if (!canAffordBuild(k)) { flashBtn(btn); return; }
			buildingItem = k; buildPanelOpen=false; if (buildPanel){ buildPanel.remove(); buildPanel=null; }
			// selecting closes inventory if open
			if (inventoryOpen) closeInventory();
		});
		buildPanel.appendChild(btn);
	}
	document.body.appendChild(buildPanel);
	// Inject lightweight CSS for nested spans if not already added
	if (!document.getElementById('build-panel-inline-style')){
		const style = document.createElement('style');
		style.id='build-panel-inline-style';
		style.textContent = '#build-panel .build-btn .b-name{font-weight:600;font-size:14px;line-height:1.1;}#build-panel .build-btn .b-cost{display:flex;gap:10px;font-size:12px;opacity:.9;font-weight:500;}#build-panel .build-btn .b-cost i{margin-right:4px;opacity:.85;}#build-panel .build-btn:focus-visible{outline:2px solid #4cc2ff;outline-offset:2px;}';
		document.head.appendChild(style);
	}
}
function openBuildPanel(){ if (!buildPanel || !document.body.contains(buildPanel)) buildPanel=null; ensureBuildPanel(); if (!buildPanelOpen){ buildPanelOpen=true; buildPanel.style.display='flex'; } }
function closeBuildPanel(){ if (buildPanel && buildPanelOpen){ buildPanelOpen=false; buildPanel.remove(); buildPanel=null; } }
function toggleBuildPanel(){ if (buildPanelOpen) closeBuildPanel(); else openBuildPanel(); }
function canAffordBuild(key){ const rec = BUILD_RECIPES[key]; if (!rec) return false; for (const res in rec.cost){ if ((resources[res]||0) < rec.cost[res]) return false; } return true; }
function deductBuildCost(key){ const rec = BUILD_RECIPES[key]; if (!rec) return; for (const res in rec.cost){ resources[res]-=rec.cost[res]; if (resources[res]<0) resources[res]=0; } updateResourceHUD(); }
function flashBtn(btn){ const prev = btn.style.boxShadow; btn.style.boxShadow='0 0 0 3px #ff3d3d,0 0 12px #ff3d3d'; setTimeout(()=>{ btn.style.boxShadow=prev; },260); }
function cancelBuilding(){ buildingItem=null; closeBuildPanel(); }

function attemptPlaceStructure(){
	if (!buildingItem || !myPlayer) return;
	const rec = BUILD_RECIPES[buildingItem]; if (!rec) return;
	if (!canAffordBuild(buildingItem)) return; // silently ignore if insufficient
	// placement position
	const px = myPlayer.x + Math.cos(myPlayer.angle)*BUILD_PLACE_DIST;
	const py = myPlayer.y + Math.sin(myPlayer.angle)*BUILD_PLACE_DIST;
	if (!canPlaceStructure(px,py,rec.rad)) return; // invalid location
	const sId = 's'+Math.random().toString(36).slice(2,9);
	const s = { id:sId, type:buildingItem, x:px, y:py, hp:rec.hp, maxHP:rec.maxHP, rad:rec.rad, passPlayer:rec.passPlayer, passAnimals:rec.passAnimals };
	if (isStructureAuthority()){
		structures.push(s);
		deductBuildCost(buildingItem);
		if (isHost){
			// Use new unified broadcast format
			const payload = JSON.stringify({ t:'placeStruct', s, orig: myNetId });
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(payload);
		}
		// broadcast updated resources for host player only (simple authoritative sync of host's resources not needed to others, skip)
	} else {
		// client prediction: tentatively show structure ghost until host confirms
		// Predict with full hp; do NOT deduct cost yet (host authoritative)
		structures.push({ ...s, _pred:true, _predStart: now() });
		const preRes = { wood: resources.wood, stone: resources.stone, food: resources.food };
		const msg = { t:'buildReq', kind: buildingItem, x:px, y:py, cid: sId, res: preRes };
		if (dataChannel && dataChannel.readyState==='open'){ try{ dataChannel.send(JSON.stringify(msg)); }catch(e){ console.warn('buildReq send failed', e); } }
		else { console.warn('[client] buildReq NOT SENT (no open dataChannel)'); }
		// Set timeout to rollback if not confirmed
		// Rollback only if still predicted AND we haven't seen any activity (host denial). Shorter window.
		setTimeout(()=>{
			const idx=structures.findIndex(z=>z.id===sId && z._pred);
			if (idx>=0){
				// If still predicted after timeout -> host never confirmed -> rollback
				structures.splice(idx,1);
			}
		}, 15000); // extended for debugging
	}
}
function canPlaceStructure(x,y,rad){
	// bounds
	if (x<rad || y<rad || x>CONFIG.map.width-rad || y>CONFIG.map.height-rad) return false;
	// no overlap with existing structures
	for (const s of structures){ const d=Math.hypot(s.x-x,s.y-y); if (d < (s.rad+rad)*0.95) return false; }
	// avoid world resource objects
	for (const o of worldObjects){ const rr=(o.colR||60); const d=Math.hypot(o.x-x,o.y-y); if (d < rr + rad*0.75) return false; }
	return true;
}
function drawStructures(g){
	for (const s of structures){ drawStructure(g,s); }
	// preview
	if (buildingItem && myPlayer){ const rec=BUILD_RECIPES[buildingItem]; const px=myPlayer.x + Math.cos(myPlayer.angle)*BUILD_PLACE_DIST; const py=myPlayer.y + Math.sin(myPlayer.angle)*BUILD_PLACE_DIST; const ok = canPlaceStructure(px,py,rec.rad) && canAffordBuild(buildingItem); drawStructure(g,{ x:px,y:py,rad:rec.rad,type:buildingItem,preview:true, ok }); }
}
function drawStructure(g,s){
	const rad = s.rad || 70; const sides=6; const angOff = Math.PI/6; // flat top hex
	g.save();
	g.translate(s.x, s.y);
	if (s.preview){ g.globalAlpha = 0.55; }
	if (s._pred){ g.globalAlpha *= 0.65; }
	g.beginPath();
	for (let i=0;i<sides;i++){ const a = angOff + i*(Math.PI*2/sides); const x = Math.cos(a)*rad; const y = Math.sin(a)*rad; if (i===0) g.moveTo(x,y); else g.lineTo(x,y); }
	g.closePath();
	let fill='#666', stroke='#222';
	if (s.type==='woodWall'){ fill='#7d5330'; stroke='#2f1b0c'; }
	else if (s.type==='stoneWall'){ fill='#6d727d'; stroke='#2b2f38'; }
	else if (s.type==='door'){ fill='rgba(70,44,20,0.70)'; stroke='#2a1709'; }
	if (s.preview){ if (!s.ok) fill='#aa2222'; }
	if (s._pred){ fill = '#888888'; stroke='#444'; }
	// Flash on hit
	let baseFill = fill;
	if (!s.preview && !s._pred && s._hitFlash && (now()-s._hitFlash)<150){
		const k = 1 - (now()-s._hitFlash)/150; fill = '#ff6b5b'; g.globalAlpha = 0.7 + 0.3*k;
	}
	g.fillStyle=fill; g.fill(); g.globalAlpha=1; g.lineWidth=1.6; g.strokeStyle=stroke; g.stroke();
	// inner hex for depth
	g.beginPath();
	const inner = rad*0.55;
	for (let i=0;i<sides;i++){ const a = angOff + i*(Math.PI*2/sides); const x = Math.cos(a)*inner; const y = Math.sin(a)*inner; if (i===0) g.moveTo(x,y); else g.lineTo(x,y); }
	g.closePath();
	let innerFill = s.type==='stoneWall'? '#8a909d' : (s.type==='woodWall'? '#936542' : (s.type==='door'? '#5a3a1d' : '#9c6d44'));
	if (!s.preview && s.hp!=null && s.maxHP){ const pct = s.hp/s.maxHP; if (pct<0.5){ innerFill = lerpColor(innerFill,'#ff3d2d', 1-pct*2); } }
	g.fillStyle = innerFill;
	if (s.preview){ g.globalAlpha*=0.8; }
	g.fill();
	g.restore();
	// Health bar (not for preview) show when damaged
	if (!s.preview && !s._pred && s.hp!=null && s.maxHP && s.hp < s.maxHP){
		const pct = clamp(s.hp / s.maxHP,0,1);
		const bw=70, bh=10; const x0 = s.x - bw/2; const y0 = s.y - (s.rad||70) - 18;
		g.save(); g.fillStyle='rgba(0,0,0,0.5)'; g.beginPath(); g.roundRect? g.roundRect(x0,y0,bw,bh,5):g.rect(x0,y0,bw,bh); g.fill(); g.fillStyle='#ffbf36'; if (pct>0){ const w=bw*pct; g.beginPath(); g.roundRect? g.roundRect(x0,y0,w,bh,5):g.rect(x0,y0,w,bh); g.fill(); } g.lineWidth=1.2; g.strokeStyle='#1e1e1e'; g.beginPath(); g.roundRect? g.roundRect(x0+0.5,y0+0.5,bw-1,bh-1,4):g.rect(x0+0.5,y0+0.5,bw-1,bh-1); g.stroke(); g.restore();
	}
}

// Integrate structure collisions (players & animals)
const _origResolveCollisions = resolveCollisions;
resolveCollisions = function(player){
	_origResolveCollisions(player);
	// extra: block against walls (skip door for players)
	for (const s of structures){ if (s.passPlayer) continue; const dx=player.x-s.x, dy=player.y-s.y; const dist=Math.hypot(dx,dy)||0.001; const min = (s.rad||70) + CONFIG.player.radius - 10; if (dist<min){ const nx=dx/dist, ny=dy/dist; const push=min-dist; player.x+=nx*push; player.y+=ny*push; const vn=player.vx*nx+player.vy*ny; if (vn<0){ player.vx-=vn*nx; player.vy-=vn*ny; } } }
};
const _origResolveAnimalCollisions = resolveAnimalCollisions;
resolveAnimalCollisions = function(){
	_origResolveAnimalCollisions();
	// block animals on all structures (even doors)
	for (const a of animals){ if (a.dead) continue; const ar=getAnimalRadius(a)*0.5; for (const s of structures){ if (s.passAnimals) continue; const dx=a.x-s.x, dy=a.y-s.y; const dist=Math.hypot(dx,dy)||0.001; const min=(s.rad||70) + ar - 10; if (dist<min){ const nx=dx/dist, ny=dy/dist; const push=min-dist; a.x+=nx*push; a.y+=ny*push; } } }
};

