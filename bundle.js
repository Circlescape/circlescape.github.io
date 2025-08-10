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

// ===== Config =====
const CONFIG = {
	map: { width: 4000, height: 4000, grid: 80, borderColor: '#56b979', bgColor: '#2e8a4c' },
				player: { radius: 40, handRadius: 17, handOffsetMult: 1.15, moveSpeed: 340, accel: 2800, friction: 0.86, skinBase: '#f4c9a3', skinShade: '#ebb894', outline: '#c58e62', nameBg: 'rgba(255,255,255,0.55)', nameTag: { padX: 16, padY: 6, radius: 14, bgStart: '#ffffffcc', bgEnd: '#ffffff99', stroke: 'rgba(0,0,0,0.25)', text: '#3d2a1c', shadow: 'rgba(0,0,0,0.25)' } },
	camera: { smooth: 0.12, zoom: 1, lookAhead: 0.18, maxLook: 140 },
				objects: { treeCount: 45, stoneCount: 18, bushCount: 16 },
				gather: { radius: 140, hitInterval: 0.45, coneDeg: 85 }, // coneDeg: allowable aim cone for hits
				render: { pixelSnap: true, fixedUpdate: true, fixedFps: 120 },
				combat: { playerDamage: 15, hitFlashMs: 180, bloodParticles: 10 },
	playerStats: { maxHP: 100 },
	collision: { tolerance: 12, velocityDamp: 0.65 },
	debug: { showFps: true }
};

// ===== Canvas & Pattern =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = Math.max(1, window.devicePixelRatio || 1);
let terrainPattern = null;
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
addEventListener('mousemove', e=>{ mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
let mouseDown = false;
addEventListener('mousedown', ()=>{ mouseDown = true; }, { passive: true });
addEventListener('mouseup', ()=>{ mouseDown = false; }, { passive: true });

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
	}
	update(dt){
		// Store previous for interpolation
		this.prevX = this.x; this.prevY = this.y;
		// Movement
		const { accel, moveSpeed, friction } = CONFIG.player;
		let ax=0, ay=0;
		if (keys['KeyW']) ay -= 1;
		if (keys['KeyS']) ay += 1;
		if (keys['KeyA']) ax -= 1;
		if (keys['KeyD']) ax += 1;
		const mag = Math.hypot(ax,ay) || 1;
		ax/=mag; ay/=mag;
		this.vx += ax * accel * dt;
		this.vy += ay * accel * dt;
		// Speed clamp
		const sp = Math.hypot(this.vx,this.vy);
		const maxSp = moveSpeed;
		if (sp>maxSp){ const s=maxSp/sp; this.vx*=s; this.vy*=s; }
		// Friction
		this.vx *= Math.pow(friction, dt*60);
		this.vy *= Math.pow(friction, dt*60);
		this.x += this.vx * dt;
		this.y += this.vy * dt;
		// Angle toward mouse
		const wx = camera.x - innerWidth/2 + mouse.x;
		const wy = camera.y - innerHeight/2 + mouse.y;
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
		// Compute anticipation + extension curve
		let rawExt = 0; // can be negative for anticipation
		let phase = 0; // 0..1 visible extension
		if (this.punchActive || this.punchT < 1){
			const t = this.punchT; // 0..1
			const anticip = 0.14; // back motion duration
			const extendPeak = 0.46; // time of maximum extension
			if (t < anticip){
				const a = t/anticip; // 0..1
				rawExt = -0.22 * (1 - (1-a)*(1-a)); // ease out backwards
			} else if (t < extendPeak){
				const f = (t - anticip)/(extendPeak - anticip);
				rawExt = Math.pow(f,0.55); // accelerate into strike
			} else {
				const r = (t - extendPeak)/(1 - extendPeak);
				rawExt = 1 - r*r*r; // smooth retract
			}
			phase = Math.max(0, Math.min(1, rawExt));
		}
		const strike = this.punchingHand;
		const baseOffset = radius * handOffsetMult;
		const strikeOffset = baseOffset + phase * radius * 1.0;
		const restOffset = baseOffset - phase * radius * 0.22 + (rawExt<0 ? rawExt * radius * 0.30 : 0);
		const forwardBiasStrike = 0.60 + phase * 0.30;
		const forwardBiasRest = 0.42 - phase * 0.08;
		const leftBias = (strike===0?forwardBiasStrike:forwardBiasRest);
		const rightBias = (strike===1?forwardBiasStrike:forwardBiasRest);
	// Interpolated position for render
	const px = this.prevX + (this.x - this.prevX) * renderAlpha;
	const py = this.prevY + (this.y - this.prevY) * renderAlpha;
	const leftAngle = this.angle + (Math.PI/2)*(1-leftBias);
	const rightAngle = this.angle - (Math.PI/2)*(1-rightBias);
	const hxL = px + Math.cos(leftAngle) * (strike===0?strikeOffset:restOffset);
	const hyL = py + Math.sin(leftAngle) * (strike===0?strikeOffset:restOffset);
	const hxR = px + Math.cos(rightAngle) * (strike===1?strikeOffset:restOffset);
	const hyR = py + Math.sin(rightAngle) * (strike===1?strikeOffset:restOffset);

		g.save();
		if (phase>0){
			const sx = 1 - 0.09 * phase;
			const sy = 1 + 0.09 * phase;
			g.translate(px,py); g.scale(sx,sy); g.translate(-px,-py);
		}
		// Hands under body
		g.fillStyle = skinBase; g.lineWidth=1.3; g.strokeStyle=outline;
		const strikeScale = 1 + phase * 0.60;
		const restScale = 1 - phase * 0.18;
		g.beginPath(); g.arc(hxL,hyL,handRadius*(strike===0?strikeScale:restScale),0,Math.PI*2); g.fill(); g.stroke();
		g.beginPath(); g.arc(hxR,hyR,handRadius*(strike===1?strikeScale:restScale),0,Math.PI*2); g.fill(); g.stroke();
	// (Motion trail removed per request)
		// Body
		g.beginPath(); g.arc(px,py,radius,0,Math.PI*2);
		const bodyGrad = g.createRadialGradient(px+radius*0.35,py+radius*0.4,radius*0.1,px,py,radius);
		bodyGrad.addColorStop(0,skinBase); bodyGrad.addColorStop(1,skinShade);
		let flash = 0; const sinceHit = now() - this.lastPlayerHit; if (sinceHit < CONFIG.combat.hitFlashMs){ flash = 1 - sinceHit/CONFIG.combat.hitFlashMs; }
		if (flash>0){
			g.fillStyle = '#ff3d2d'; g.globalAlpha = 0.6 + 0.4*flash; g.fill(); g.globalAlpha=1;
			g.fillStyle = bodyGrad; g.globalAlpha = 1 - 0.55*flash; g.fill(); g.globalAlpha=1;
		} else { g.fillStyle = bodyGrad; g.fill(); }
		g.lineWidth=1.3; g.strokeStyle=outline; g.stroke();
		g.restore();
		// Name Tag
		const tagCfg = CONFIG.player.nameTag;
		g.font='600 15px Rubik, sans-serif'; g.textAlign='center';
		const baseName = this.name;
		const textWidth = g.measureText(baseName).width;
		const tw = textWidth + tagCfg.padX; const th = 24;
		const tagY = py - radius - 18;
		const tx = px - tw/2; const ty = tagY - th + 8;
		g.save();
		// shadow
		g.fillStyle=tagCfg.shadow; g.beginPath();
		if (g.roundRect) g.roundRect(tx+2,ty+3,tw,th,tagCfg.radius); else g.rect(tx+2,ty+3,tw,th);
		g.fill();
		const grad = g.createLinearGradient(tx,ty,tx,ty+th);
		grad.addColorStop(0,tagCfg.bgStart); grad.addColorStop(1,tagCfg.bgEnd);
		g.fillStyle=grad; g.beginPath();
		if (g.roundRect) g.roundRect(tx,ty,tw,th,tagCfg.radius); else g.rect(tx,ty,tw,th);
		g.fill();
		g.lineWidth=1.3; g.strokeStyle=tagCfg.stroke; g.beginPath();
		if (g.roundRect) g.roundRect(tx+0.5,ty+0.5,tw-1,th-1,tagCfg.radius-4); else g.rect(tx+0.5,ty+0.5,tw-1,th-1);
		g.stroke();
		g.fillStyle='rgba(255,255,255,0.55)'; g.fillText(baseName,px,tagY-1);
		g.fillStyle=tagCfg.text; g.fillText(baseName,px,tagY-2);
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
	const halfW = innerWidth/2; const halfH = innerHeight/2;
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
	const startX = Math.floor((camera.x - innerWidth/2) / grid) * grid;
	const endX = Math.floor((camera.x + innerWidth/2) / grid) * grid;
	const startY = Math.floor((camera.y - innerHeight/2) / grid) * grid;
	const endY = Math.floor((camera.y + innerHeight/2) / grid) * grid;
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
		menuEl.classList.remove('hidden');
		hudEl.classList.add('hidden');
		settingsButton.classList.add('hidden');
		inGame = false;
		canvas.classList.add('menu-blur');
	} else {
		menuEl.classList.add('hidden');
		hudEl.classList.remove('hidden');
		settingsButton.classList.remove('hidden');
		inGame = true;
		canvas.classList.remove('menu-blur');
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
	camera.x = myPlayer.x; camera.y = myPlayer.y;
	generateWorld();
	updateResourceHUD();
	// Sync settings UI state (FPS toggle)
	fpsToggle.checked = CONFIG.debug.showFps;
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
	rtcPeer.onicecandidate = e=>{ if (e.candidate) return; const payload = { sdp: rtcPeer.localDescription }; if (currentOfferId) payload.id = currentOfferId; taJoinAnswer.value = btoa(JSON.stringify(payload)); if (joinStatusEl) joinStatusEl.textContent='Send this reply to host then click Enter World'; const btnEnter=document.getElementById('btn-join-enter'); if (btnEnter) btnEnter.disabled=false; };
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
		if (!inGame){ const name=(document.getElementById('player-name').value||'Player').trim(); startGame(name); }
		// Hide mp menu for host on first successful connection if still visible
		if (isHost && mpMenu && !mpMenu.classList.contains('hidden')){ mpMenu.classList.add('hidden'); }
		// send initial world snapshot (host only)
		if (isHost){ sendWorldSnapshot(dc); }
		if (isHost && hostStatusEl){ hostStatusEl.textContent = 'Player connected. Total: '+ hostPeers.size; }
		if (!isHost && joinStatusEl){ joinStatusEl.textContent='Connected!'; if (!mpMenu.classList.contains('hidden')) hideMpMenu(); }
	};
	dc.onmessage = e=>{
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
	if (msg.t === 'pushCorr'){
		for (const rp of msg.players){
			if (rp.id === myNetId) continue; // we only receive corrections for others
			const p = remotePlayers.get(rp.id); if (!p) continue;
			p.prevX = p.x; p.prevY = p.y;
			p.x = rp.x; p.y = rp.y;
		}
		return;
	}
	if (msg.t === 'pHit'){
		// Player got hit (either us or a remote player)
		if (msg.id === myNetId && myPlayer){
			myPlayer.hp = clamp(msg.hp,0,CONFIG.playerStats.maxHP); myPlayer.lastPlayerHit = now(); screenShake = Math.min(screenShake+3,10); spawnBloodEffect(myPlayer.x,myPlayer.y);
		}else{
			const p = remotePlayers.get(msg.id); if (p){ p.hp = clamp(msg.hp,0,CONFIG.playerStats.maxHP); p.lastPlayerHit = now(); spawnBloodEffect(p.x,p.y); }
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
			// Track previous angle for smoothing (shortest arc interpolation later)
			if (oldAngle === undefined) p.prevAngle = p.angle; else p.prevAngle = oldAngle;
			p.lastUpdate = now();
			p.basePunchT = rp.punchT; p.basePunchUpdate = p.lastUpdate;
			// Host processes remote player's attack onset
			if (isHost && p.punchActive && !wasPunching){ processPlayerAttack(p, rp.id); }
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
	}
}

let myNetId = Math.random().toString(36).slice(2,9);
function collectState(){
	return { id: myNetId, name: myPlayer?.name||'?', x: myPlayer?.x||0, y: myPlayer?.y||0, angle: myPlayer?.angle||0, punchT: myPlayer?.punchT||1, punchActive: !!myPlayer?.punchActive, hand: myPlayer?.punchingHand||0, hp: myPlayer?.hp ?? CONFIG.playerStats.maxHP };
}
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
setInterval(()=>{ if (inGame && myPlayer) broadcastState(); }, 1000/12);

function sendWorldSnapshot(dc){
	if (!dc || dc.readyState!=='open') return;
	const snapshot = { t:'worldSnapshot', objects: worldObjects.map(o=>({...o})) };
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
		const smoothAngle = prevAng + d * alpha;
		const hitFlash = (now() - (p.lastPlayerHit||0)) < CONFIG.combat.hitFlashMs;
		drawPlayerShape(g,{ name:p.name,x:ix,y:iy,angle:smoothAngle,punchT,punchActive:p.punchActive,punchingHand:p.hand||0,phaseInfo, hitFlash });
		// Remote health bar
		if (p.hp != null){ drawHealthBar(g, { x: ix, y: iy, hp: p.hp }); }
	}
}

function computePunchPhase(t, active){
	let rawExt=0, phase=0; if (active || t<1){ const anticip=0.14, extendPeak=0.46; if (t<anticip){ const a=t/anticip; rawExt=-0.22*(1-(1-a)*(1-a)); } else if (t<extendPeak){ const f=(t-anticip)/(extendPeak-anticip); rawExt=Math.pow(f,0.55);} else { const r=(t-extendPeak)/(1-extendPeak); rawExt=1-r*r*r;} phase=Math.max(0,Math.min(1,rawExt)); } return {rawExt,phase}; }
function drawPlayerShape(g, info){
	const { radius, handRadius, skinBase, skinShade, outline, handOffsetMult, nameTag } = CONFIG.player;
	const { x: px, y: py, angle, punchT, punchingHand: strike, phaseInfo, name, hitFlash } = info;
	const rawExt = phaseInfo.rawExt, phase = phaseInfo.phase;
	const baseOffset = radius * handOffsetMult;
	const strikeOffset = baseOffset + phase * radius * 1.0;
	const restOffset = baseOffset - phase * radius * 0.22 + (rawExt<0 ? rawExt * radius * 0.30 : 0);
	const forwardBiasStrike = 0.60 + phase * 0.30; const forwardBiasRest = 0.42 - phase * 0.08;
	const leftBias = (strike===0?forwardBiasStrike:forwardBiasRest); const rightBias=(strike===1?forwardBiasStrike:forwardBiasRest);
	const leftAngle = angle + (Math.PI/2)*(1-leftBias); const rightAngle = angle - (Math.PI/2)*(1-rightBias);
	const hxL = px + Math.cos(leftAngle) * (strike===0?strikeOffset:restOffset); const hyL = py + Math.sin(leftAngle)*(strike===0?strikeOffset:restOffset);
	const hxR = px + Math.cos(rightAngle) * (strike===1?strikeOffset:restOffset); const hyR = py + Math.sin(rightAngle)*(strike===1?strikeOffset:restOffset);
	// Scale squash for punch
	g.save(); if (phase>0){ const sx=1-0.09*phase, sy=1+0.09*phase; g.translate(px,py); g.scale(sx,sy); g.translate(-px,-py);} g.fillStyle=skinBase; g.lineWidth=1.3; g.strokeStyle=outline; const strikeScale=1+phase*0.60; const restScale=1-phase*0.18;
	g.beginPath(); g.arc(hxL,hyL,handRadius*(strike===0?strikeScale:restScale),0,Math.PI*2); g.fill(); g.stroke();
	g.beginPath(); g.arc(hxR,hyR,handRadius*(strike===1?strikeScale:restScale),0,Math.PI*2); g.fill(); g.stroke();
	// Body
	g.beginPath(); g.arc(px,py,radius,0,Math.PI*2); const bodyGrad=g.createRadialGradient(px+radius*0.35,py+radius*0.4,radius*0.1,px,py,radius); bodyGrad.addColorStop(0,skinBase); bodyGrad.addColorStop(1,skinShade);
	if (hitFlash){ g.fillStyle='#ff3d2d'; g.globalAlpha=0.7; g.fill(); g.globalAlpha=1; g.fillStyle=bodyGrad; g.globalAlpha=0.55; g.fill(); g.globalAlpha=1; } else { g.fillStyle=bodyGrad; g.fill(); }
	g.stroke(); g.restore();
	// Name tag
	g.font='600 15px Rubik, sans-serif'; g.textAlign='center'; const baseName=name; const textWidth=g.measureText(baseName).width; const tw=textWidth+nameTag.padX; const th=24; const tagY=py - radius - 18; const tx=px - tw/2; const ty=tagY - th + 8;
	g.save(); g.fillStyle=nameTag.shadow; g.beginPath(); if (g.roundRect) g.roundRect(tx+2,ty+3,tw,th,nameTag.radius); else g.rect(tx+2,ty+3,tw,th); g.fill(); const grad=g.createLinearGradient(tx,ty,tx,ty+th); grad.addColorStop(0,nameTag.bgStart); grad.addColorStop(1,nameTag.bgEnd); g.fillStyle=grad; g.beginPath(); if (g.roundRect) g.roundRect(tx,ty,tw,th,nameTag.radius); else g.rect(tx,ty,tw,th); g.fill(); g.lineWidth=1.3; g.strokeStyle=nameTag.stroke; g.beginPath(); if (g.roundRect) g.roundRect(tx+0.5,ty+0.5,tw-1,th-1,nameTag.radius-4); else g.rect(tx+0.5,ty+0.5,tw-1,th-1); g.stroke(); g.fillStyle='rgba(255,255,255,0.55)'; g.fillText(baseName,px,tagY-1); g.fillStyle=nameTag.text; g.fillText(baseName,px,tagY-2); g.restore();
}

btnHost?.addEventListener('click', startHost);
btnApplyAnswer?.addEventListener('click', applyAnswer);
// Explicit join button flow
const btnJoinStart = document.getElementById('btn-join-start');
const btnJoinEnter = document.getElementById('btn-join-enter');
btnJoinStart?.addEventListener('click', () => {
	const code = taJoinOffer.value.trim();
	if (code.length < 10){ if (joinStatusEl) joinStatusEl.textContent='Invalid host code'; return; }
	if (joinStatusEl) joinStatusEl.textContent='Connecting...';
	joinHost().then(()=>{
		if (joinStatusEl) joinStatusEl.textContent='Generating reply...';
		// reply will appear after ICE completes (we set in onicecandidate)
	});
});
btnJoinEnter?.addEventListener('click', ()=>{
	if (!inGame){ const name=(document.getElementById('player-name').value||'Player').trim(); startGame(name); }
	if (joinStatusEl) joinStatusEl.textContent='Waiting for host acceptance...';
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
		if (!myPlayer.dead){ myPlayer.update(step); }
		updateCamera(step, myPlayer);
		resolveCollisions(myPlayer);
		resolvePlayerCollisions(myPlayer);
		if (isHost) hostResolvePlayerPush();
		if (!myPlayer.dead && myPlayer.hp <= 0){ handleLocalDeath(); }
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
	let tx = -camera.x + innerWidth/2 + sx;
	let ty = -camera.y + innerHeight/2 + sy;
	if (CONFIG.render?.pixelSnap){ tx = Math.round(tx); ty = Math.round(ty); }
	ctx.translate(tx,ty);
	clear(ctx);
	drawGrid(ctx);
	if (myPlayer){ myPlayer.draw(ctx); drawHealthBar(ctx, myPlayer); }
	// remote players after local player (same layer ordering for now)
	drawRemotePlayers(ctx);
	drawObjects(ctx);
	drawHitEffects(ctx, simTimeThisFrame);
	ctx.restore();
	// FPS HUD
	if (CONFIG.debug.showFps){
		ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
		ctx.font='12px Rubik, sans-serif'; ctx.fillStyle='rgba(255,255,255,0.6)';
		let text = fps+' FPS';
		if (pingMs!=null){ text += '  |  '+Math.round(pingMs)+' ms'; }
		ctx.fillText(text,10, innerHeight-12);
		ctx.restore();
	}
	frames++; if (t - fpsLast > 1000){ fps = frames; frames = 0; fpsLast = t; }
	// Periodic ping
	if (inGame && (t - _lastPingSend) > _pingInterval){ sendPing(); }
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ===== Networking Placeholder =====
// Future: establish WebSocket connection, sync state, broadcast inputs.
// Structure: network.connect() -> send join w/ name -> receive world snapshot & diff updates.

// Explicit initial state
menuEl.classList.remove('hidden');
hudEl.classList.add('hidden');
canvas.classList.add('menu-blur');
inGame = false;
settingsButton.classList.add('hidden');

// Expose for console debugging
window.__game = { camera, get player() { return myPlayer; } };

// ===== World Objects Generation =====
function generateWorld() {
	worldObjects.length = 0;
	randScatter('tree', CONFIG.objects.treeCount);
	randScatter('stone', CONFIG.objects.stoneCount);
	randScatter('bush', CONFIG.objects.bushCount);
	worldObjectsById.clear(); for (const o of worldObjects) worldObjectsById.set(o.id,o);
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
function handlePunch(){
	if (!inGame || !myPlayer) return;
	const t = now()/1000;
	if (t - lastGatherAttempt < CONFIG.gather.hitInterval) return;
	lastGatherAttempt = t;
	myPlayer.punchActive = true; myPlayer.punchT = 0;
	myPlayer.punchingHand = 1 - myPlayer.punchingHand; // alternate
	const range = CONFIG.gather.radius;
	const cone = (CONFIG.gather.coneDeg||90) * Math.PI/180; // radians
	const halfCone = cone * 0.5;
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
		if (best.type==='tree') resources.wood += 1; else if (best.type==='stone') resources.stone += 1; else if (best.type==='bush') resources.food += 1;
		updateResourceHUD();
		best.lastHit = now();
		screenShake = Math.min(screenShake + 4, 10);
		spawnHitEffect(best.x, best.y, best.type);
		broadcastHitLocal(best.id);
	}
	// Player combat (host authoritative): detect remote players inside cone and range, apply damage
	if (isHost){
		const dmg = CONFIG.combat.playerDamage||10;
		for (const [pid,p] of remotePlayers){
			if (p.x==null) continue;
			const dx = p.x - myPlayer.x; const dy = p.y - myPlayer.y; const d = Math.hypot(dx,dy);
			if (d > range*0.75) continue; // slightly shorter than resource range
			let ang = Math.atan2(dy,dx) - myPlayer.angle; ang = (ang + Math.PI) % (Math.PI*2) - Math.PI;
			if (Math.abs(ang) > halfCone) continue;
			// apply damage
			p.hp = clamp((p.hp ?? CONFIG.playerStats.maxHP) - dmg, 0, CONFIG.playerStats.maxHP);
			p.lastPlayerHit = now();
			spawnBloodEffect(p.x,p.y);
			// broadcast hit to all peers (including victim) and self (loopback not needed but okay)
			for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'pHit', id: pid, hp: p.hp }));
		}
	}
}

// Auto continue punching while holding
function autoPunchLoop(){
	if (mouseDown) handlePunch();
	requestAnimationFrame(autoPunchLoop);
}
requestAnimationFrame(autoPunchLoop);

// Host-side: process attack from remote player p (with id attackerId)
function processPlayerAttack(p, attackerId){
	if (!isHost) return;
	const range = CONFIG.gather.radius;
	const cone = (CONFIG.gather.coneDeg||90) * Math.PI/180;
	const halfCone = cone*0.5;
	const dmg = CONFIG.combat.playerDamage||10;
	// Potential targets: host player + other remotes
	const targets = [];
	if (myPlayer) targets.push({ id: myNetId, obj: myPlayer, isLocal:true });
	for (const [id,r] of remotePlayers){ if (id!==attackerId) targets.push({ id, obj:r }); }
	for (const t of targets){
		const obj = t.obj; if (!obj || obj.x==null) continue;
		const dx = obj.x - p.x; const dy = obj.y - p.y; const d = Math.hypot(dx,dy); if (d > range*0.75) continue;
		let ang = Math.atan2(dy,dx) - p.angle; ang = (ang + Math.PI) % (Math.PI*2) - Math.PI; if (Math.abs(ang) > halfCone) continue;
		obj.hp = clamp((obj.hp ?? CONFIG.playerStats.maxHP) - dmg,0,CONFIG.playerStats.maxHP);
		obj.lastPlayerHit = now(); spawnBloodEffect(obj.x,obj.y); screenShake = Math.min(screenShake+3,10);
		for (const { dc } of hostPeers.values()) if (dc.readyState==='open') dc.send(JSON.stringify({ t:'pHit', id: t.id, hp: obj.hp }));
	}
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
function updateResourceHUD() {
	elResWood.textContent = resources.wood;
	elResStone.textContent = resources.stone;
	elResFood.textContent = resources.food;
	resPanel.classList.remove('hidden');
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
