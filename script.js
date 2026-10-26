const soundToggle = document.getElementById("sound-toggle");
const aboutDialog = document.getElementById("about-dialog");
const statusMessage = document.getElementById("status-message");
const playButton = document.getElementById("play-button");
const landingScreen = document.querySelector(".landing");
const crewScreen = document.getElementById("crew-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const continueButton = document.getElementById("continue-button");
const crewStatus = document.getElementById("crew-status");
const gameScreen = document.getElementById("game-screen");
const gameStatus = document.getElementById("game-status");
const playScreen = document.getElementById("play-screen");
const liveBoard = document.getElementById("live-board");
const roomStatus = document.getElementById("room-status");
const crewChoices = { role: null, mode: null };
let selectedBoardSize = 7;
// 2 players -> 7x7, 3-4 players -> 10x10, 5-6 players -> 12x12
function boardSizeForPlayers(total) { return total <= 2 ? 7 : total <= 4 ? 10 : 12; }
let selectedCrewCount = 3;
let selectedPoliceCount = 3;
let currentRoomCode = "";
let supabaseClient = null;
let activeRoomChannel = null;
let isRoomHost = false;
function makeRoomPlayerId() { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `player-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
let roomPlayerId = makeRoomPlayerId();
let roomConfig = null;
let mySlot = 0;
let lobbySel = null; // { type: "move", side, index } or { type: "kick", playerId }
let roomStarted = false;
let operationStarted = false;

// ---------- Audio: looping background track + click sound ----------
const bgMusic = new Audio("bellachao.m4a");
bgMusic.loop = true;
bgMusic.volume = 0.5;
bgMusic.preload = "auto";
const clickSound = new Audio("click.mp3");
clickSound.preload = "auto";
clickSound.volume = 0.7;

// Sound is on by default; only an explicit "false" saved by the toggle turns it off.
function readSavedSound() { try { return localStorage.getItem("evader-sound-enabled") !== "false"; } catch { return true; } }
function saveSound(enabled) { try { localStorage.setItem("evader-sound-enabled", String(enabled)); } catch { /* storage unavailable */ } }
function isSoundOn() { return soundToggle.getAttribute("aria-pressed") === "true"; }

function startMusic() {
  if (!isSoundOn()) return;
  const attempt = bgMusic.play();
  if (attempt && attempt.catch) attempt.catch(() => { /* autoplay blocked; retried on first interaction */ });
}
function setSoundEnabled(enabled) {
  soundToggle.setAttribute("aria-pressed", String(enabled));
  soundToggle.setAttribute("aria-label", enabled ? "Turn sound off" : "Turn sound on");
  soundToggle.title = enabled ? "Sound on" : "Sound off";
  saveSound(enabled);
  document.documentElement.dataset.sound = enabled ? "on" : "off";
  if (enabled) startMusic(); else bgMusic.pause();
}
setSoundEnabled(readSavedSound());

// Browsers block autoplay, so start the music on the first click, key press or touch.
["pointerdown", "keydown", "touchstart"].forEach((type) =>
  document.addEventListener(type, function unlock() {
    startMusic();
    if (!bgMusic.paused || !isSoundOn()) {
      ["pointerdown", "keydown", "touchstart"].forEach((t) => document.removeEventListener(t, unlock, true));
    }
  }, true)
);

// Click sound for every button on every screen
document.addEventListener("click", (event) => {
  if (!isSoundOn()) return;
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const sfx = clickSound.cloneNode();
  sfx.volume = clickSound.volume;
  sfx.play().catch(() => {});
});

soundToggle.addEventListener("click", () => {
  setSoundEnabled(!isSoundOn());
  statusMessage.textContent = isSoundOn() ? "Sound enabled." : "Sound muted.";
});
document.getElementById("about-button").addEventListener("click", () => aboutDialog.showModal());
document.getElementById("close-about").addEventListener("click", () => aboutDialog.close());
document.getElementById("done-about").addEventListener("click", () => aboutDialog.close());
aboutDialog.addEventListener("click", (event) => { if (event.target === aboutDialog) aboutDialog.close(); });
aboutDialog.addEventListener("close", () => document.getElementById("about-button").focus());

// ---------- Screen helper ----------
const modeScreen = document.getElementById("mode-screen");
const sideScreen = document.getElementById("side-screen");
const createScreen = document.getElementById("create-screen");
const joinScreen = document.getElementById("join-screen");
const ALL_SCREENS = [crewScreen, modeScreen, sideScreen, createScreen, joinScreen, lobbyScreen, gameScreen, playScreen, document.getElementById("victory-screen")];
function showScreen(target) {
  ALL_SCREENS.forEach((screen) => { screen.hidden = screen !== target; });
  landingScreen.hidden = target !== landingScreen;
  window.scrollTo(0, 0);
}
let toastTimer = null;
function toast(message) {
  const el = document.getElementById("toast"); el.textContent = message; el.hidden = false;
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { el.hidden = true; }, 3500);
}
document.querySelectorAll("[data-back]").forEach((btn) => btn.addEventListener("click", () => showScreen(document.getElementById(btn.dataset.back))));

// ---------- Page 2: player name ----------
const nameInput = document.getElementById("player-name");
let playerName = "";
try { playerName = localStorage.getItem("evader-player-name") || ""; } catch { /* storage unavailable */ }
function cleanName(value) { return String(value || "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16); }
nameInput.value = cleanName(playerName);
function syncName() {
  const ok = cleanName(nameInput.value).length >= 2;
  continueButton.classList.toggle("is-inactive", !ok);
  if (ok) crewStatus.textContent = "";
}
["input", "change", "keyup", "compositionend"].forEach((type) => nameInput.addEventListener(type, syncName));
nameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") continueButton.click(); });
syncName();
playButton.addEventListener("click", () => { showScreen(crewScreen); nameInput.focus(); });
document.getElementById("back-to-home").addEventListener("click", (event) => { event.preventDefault(); showScreen(landingScreen); playButton.focus(); });
continueButton.addEventListener("click", () => {
  if (cleanName(nameInput.value).length < 2) {
    crewStatus.textContent = "Enter a name with at least 2 letters or numbers.";
    nameInput.focus();
    return;
  }
  playerName = cleanName(nameInput.value);
  nameInput.value = playerName;
  try { localStorage.setItem("evader-player-name", playerName); } catch { /* storage unavailable */ }
  showScreen(modeScreen);
});

// ---------- Page 3: mode ----------
document.getElementById("mode-single").addEventListener("click", () => {
  crewChoices.mode = "single-player"; crewChoices.role = null;
  document.getElementById("side-start").disabled = true;
  document.querySelectorAll('[data-choice="role"]').forEach((o) => o.setAttribute("aria-pressed", "false"));
  showScreen(sideScreen);
});
document.querySelectorAll('[data-choice="role"]').forEach((button) => button.addEventListener("click", () => {
  crewChoices.role = button.dataset.value;
  document.querySelectorAll('[data-choice="role"]').forEach((o) => o.setAttribute("aria-pressed", String(o === button)));
  document.getElementById("side-start").disabled = false;
}));
document.getElementById("side-start").addEventListener("click", () => { if (crewChoices.role) showBriefing(); });
document.getElementById("mode-create").addEventListener("click", () => { crewChoices.mode = "multiplayer"; showScreen(createScreen); });
document.getElementById("mode-join").addEventListener("click", () => {
  crewChoices.mode = "multiplayer"; showScreen(joinScreen);
  document.getElementById("room-search").value = "";
  document.getElementById("join-selected").hidden = true;
  document.getElementById("join-status").textContent = "Refreshing live rooms…";
  refreshLobby().then(() => renderLiveRooms()).catch((error) => { document.getElementById("join-status").textContent = error.message; });
});

function boardSizeForSetup() {
  if (crewChoices.mode !== "multiplayer" || !roomConfig) { selectedCrewCount = 1; selectedPoliceCount = 1; return boardSizeForPlayers(2); }
  selectedCrewCount = roomConfig.crewCount;
  selectedPoliceCount = roomConfig.policeCount;
  return boardSizeForPlayers(selectedCrewCount + selectedPoliceCount);
}
function showBriefing() {
  selectedBoardSize = boardSizeForSetup();
  showScreen(gameScreen);
  document.getElementById("selected-side-title").innerHTML = crewChoices.role === "crew" ? "HEIST<br><span>CREW</span>" : "THE<br><span>POLICE</span>";
  document.getElementById("selected-mode").textContent = crewChoices.mode === "single-player" ? "SINGLE PLAYER" : `ONLINE ROOM ${currentRoomCode} · ${selectedCrewCount} CREW + ${selectedPoliceCount} POLICE · ${selectedBoardSize}×${selectedBoardSize}`;
  document.getElementById("objective-copy").textContent = "Crew: grab the cash and get everyone out through the door. Police: catch the crew, or drag a wall onto the board to block a path.";
  gameStatus.textContent = "Crew moves first. On your turn, your moves light up on their own.";
  const roomDetails = document.getElementById("briefing-room-details");
  roomDetails.hidden = crewChoices.mode !== "multiplayer";
  roomDetails.textContent = crewChoices.mode === "multiplayer" ? `ROOM ${currentRoomCode || "LOCAL"} · ${selectedCrewCount} heist crew + ${selectedPoliceCount} police = ${selectedCrewCount + selectedPoliceCount} total players.` : "";
  const beginButton = document.getElementById("begin-operation");
  beginButton.disabled = crewChoices.mode === "multiplayer" && !isRoomHost;
  beginButton.innerHTML = crewChoices.mode === "multiplayer" && !isRoomHost ? "Waiting for host" : "Begin operation";
  document.getElementById("back-to-crew").focus();
}

// ---------- Online rooms ----------
// Rooms are listed on a shared "evader-lobby" presence channel. A password is never sent in the clear:
// the host publishes only a salted check-hash, and the game channel name includes a second hash that
// only people who know the password can compute.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let lobbyChannel = null, lobbyReady = null, lobbyRefreshPromise = null, hostRoomInfo = null, roomChannelKey = "", roomJoinedAt = "", selectedRoom = null;

async function deriveRoomSecret(salt, purpose, password) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(`${purpose}:${salt}`), iterations: 210000 }, key, 256);
  return Array.from(new Uint8Array(bits), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function legacyRoomSecret(salt, purpose, password) {
  const text = new TextEncoder().encode(`${salt}:${purpose === "check" ? "check" : "chan"}:${password}`);
  const bits = await crypto.subtle.digest("SHA-256", text);
  return Array.from(new Uint8Array(bits), (value) => value.toString(16).padStart(2, "0")).join("");
}
function randomString(length, alphabet) {
  const values = new Uint32Array(length); crypto.getRandomValues(values);
  return Array.from(values, (n) => alphabet[n % alphabet.length]).join("");
}
function getClient() {
  const config = window.EVADER_SUPABASE_CONFIG;
  if (!config || !config.url || config.url.includes("YOUR_PROJECT_REF") || !config.publishableKey || config.publishableKey.includes("REPLACE_ME")) {
    throw new Error("Add your Supabase Project URL and publishable key to supabase-config.js first.");
  }
  if (!window.supabase?.createClient) throw new Error("Supabase failed to load. Check your internet connection and reload.");
  if (!supabaseClient) supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
  return supabaseClient;
}
function openLobby() {
  if (lobbyReady) return lobbyReady;
  const channel = getClient().channel("evader-lobby", { config: { presence: { key: roomPlayerId } } });
  lobbyChannel = channel;
  channel.on("presence", { event: "sync" }, () => renderLiveRooms());
  lobbyReady = new Promise((resolve, reject) => {
    const fail = (message) => { window.clearTimeout(timer); lobbyReady = null; lobbyChannel = null; reject(new Error(message)); };
    const timer = window.setTimeout(() => fail("Could not reach the room lobby. Check the Supabase URL and key."), 12000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") { window.clearTimeout(timer); resolve(channel); }
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) fail(`Lobby connection failed (${status}). Check Supabase Realtime is enabled.`);
    });
  });
  return lobbyReady;
}
async function refreshLobby() {
  if (hostRoomInfo) return openLobby();
  if (lobbyRefreshPromise) return lobbyRefreshPromise;
  lobbyRefreshPromise = (async () => {
    const oldChannel = lobbyChannel;
    lobbyChannel = null;
    lobbyReady = null;
    if (oldChannel && supabaseClient) { try { await supabaseClient.removeChannel(oldChannel); } catch { /* stale channel */ } }
    return openLobby();
  })();
  try { return await lobbyRefreshPromise; }
  finally { lobbyRefreshPromise = null; }
}
function liveRooms() {
  if (!lobbyChannel) return [];
  const seen = new Set();
  return Object.values(lobbyChannel.presenceState()).flat().map((p) => p.room).filter((r) => {
    if (!r || r.started || !/^[A-Z0-9]{5}$/.test(r.code) || seen.has(r.code)) return false;
    if (![r.crew, r.police].every((n) => Number.isInteger(n) && n >= 1 && n <= 3)) return false;
    r.host = cleanName(r.host) || "Host";
    seen.add(r.code); return true;
  });
}
function announceRoom() {
  if (!lobbyChannel || !hostRoomInfo) return;
  lobbyChannel.track({ room: { ...hostRoomInfo, players: currentRoomPlayers().length } }).catch(() => {});
}

// ----- Join screen: search, live list, password -----
function renderLiveRooms() {
  const list = document.getElementById("live-rooms");
  const query = document.getElementById("room-search").value.trim().toUpperCase();
  const rooms = liveRooms().filter((r) => !query || r.code.startsWith(query));
  list.replaceChildren();
  rooms.forEach((room) => {
    const li = document.createElement("li"); const btn = document.createElement("button");
    btn.type = "button"; btn.className = "room-row"; btn.setAttribute("aria-pressed", String(selectedRoom?.code === room.code));
    const left = document.createElement("span"); left.className = "room-host"; left.textContent = `${room.host}'s room${room.hasPw ? " 🔒" : ""}`;
    const right = document.createElement("span"); right.className = "room-meta"; right.textContent = `${room.code} · ${room.crew} CREW + ${room.police} POLICE · ${Math.min(Number(room.players) || 0, 6)}/${room.crew + room.police}`;
    btn.append(left, right); btn.addEventListener("click", () => selectRoom(room)); li.append(btn); list.append(li);
  });
  document.getElementById("join-status").textContent = rooms.length ? "Pick a room to join." : (query ? `No live room matches “${query}”.` : "No live rooms right now. Ask a host to create one.");
}
function selectRoom(room) {
  selectedRoom = room;
  document.getElementById("join-selected").hidden = false;
  document.getElementById("join-selected-label").textContent = `${room.host}'S ROOM${room.hasPw ? " · PASSWORD REQUIRED" : ""}`;
  const pw = document.getElementById("join-password"); pw.hidden = !room.hasPw; pw.value = "";
  renderLiveRooms();
  (room.hasPw ? pw : document.getElementById("join-room-confirm")).focus();
}
document.getElementById("room-search").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); renderLiveRooms(); });

// ----- Create -----
document.getElementById("create-room-confirm").addEventListener("click", async () => {
  const status = document.getElementById("create-status");
  const createButton = document.getElementById("create-room-confirm");
  if (createButton.disabled) return;
  const crew = Number(document.getElementById("crew-player-count").value), police = Number(document.getElementById("police-player-count").value);
  const password = document.getElementById("room-password").value;
  
  createButton.disabled = true;
  status.textContent = "Creating room…";
  try {
    await refreshLobby();
    const taken = new Set(liveRooms().map((r) => r.code));
    let code; do { code = randomString(5, ROOM_CODE_ALPHABET); } while (taken.has(code));
    const room = { code, crew, police, hasPw: Boolean(password), host: cleanName(playerName) || "Host" };
    roomChannelKey = "";
    if (password) {
      room.salt = randomString(16, ROOM_CODE_ALPHABET);
      room.hashVersion = 2;
      room.check = await deriveRoomSecret(room.salt, "check", password);
      roomChannelKey = (await deriveRoomSecret(room.salt, "channel", password)).slice(0, 24);
    }
    hostRoomInfo = room; currentRoomCode = code; isRoomHost = true; roomStarted = false; operationStarted = false; crewChoices.role = "crew"; mySlot = 0; lobbySel = null;
    roomConfig = { crewCount: crew, policeCount: police, totalPlayers: crew + police };
    await connectToRoom(code, true);
    document.getElementById("room-password").value = "";
    document.getElementById("created-room-code").textContent = code;
    showScreen(lobbyScreen); announceRoom();
    roomStatus.textContent = password ? "Room is password protected. Share the code and password." : "Open room. Share the code with your players.";
  } catch (error) { await leaveRoom(); status.textContent = error.message; }
  finally { createButton.disabled = false; }
});

// ----- Join -----
document.getElementById("join-room-confirm").addEventListener("click", async () => {
  const status = document.getElementById("join-status"); const room = selectedRoom;
  const joinButton = document.getElementById("join-room-confirm");
  if (joinButton.disabled) return;
  if (!room) { status.textContent = "Pick a room first."; return; }
  joinButton.disabled = true;
  try {
    roomChannelKey = "";
    if (room.hasPw) {
      const password = document.getElementById("join-password").value;
      if (!password) { status.textContent = "Enter the room password."; return; }
      
      const secret = room.hashVersion === 2 ? deriveRoomSecret : legacyRoomSecret;
      if (await secret(room.salt, "check", password) !== room.check) { status.textContent = "Wrong password."; return; }
      roomChannelKey = (await secret(room.salt, "channel", password)).slice(0, 24);
    }
    status.textContent = `Joining ${room.code}…`;
    isRoomHost = false; currentRoomCode = room.code; roomStarted = false; operationStarted = false;
    roomConfig = { crewCount: room.crew, policeCount: room.police, totalPlayers: room.crew + room.police };
    await connectToRoom(room.code, false);
    document.getElementById("created-room-code").textContent = room.code;
    document.getElementById("join-password").value = "";
    showScreen(lobbyScreen);
    roomStatus.textContent = "Connected. Waiting for the host to start.";
  } catch (error) { await leaveRoom(); status.textContent = error.message; }
  finally { joinButton.disabled = false; }
});

// ----- Lobby -----
document.getElementById("back-to-setup").addEventListener("click", async () => { await leaveRoom(); showScreen(modeScreen); });
document.getElementById("slot-action").addEventListener("click", confirmSlotAction);
document.getElementById("start-room").addEventListener("click", async () => {
  const button = document.getElementById("start-room");
  if (!isRoomHost || roomStarted || button.disabled) return;
  button.disabled = true;
  button.textContent = "Starting…";
  try {
    await broadcastRoom("room-start", getRoomConfig());
    roomStarted = true;
    if (hostRoomInfo) hostRoomInfo.started = true;
    try { await trackSelf(); } catch { /* the room is already locked; presence will expire normally */ }
    if (lobbyChannel) { try { await lobbyChannel.untrack(); } catch { /* presence expires on disconnect */ } }
    hostRoomInfo = null;
    button.textContent = "Room started";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Start game";
    roomStatus.textContent = error.message;
    return;
  }
  showBriefing();
});
function trackSelf() {
  return activeRoomChannel.track({ playerId: roomPlayerId, name: cleanName(playerName) || "Player", role: crewChoices.role, slot: mySlot, host: isRoomHost, started: roomStarted, inGame: operationStarted, joinedAt: roomJoinedAt });
}
const byJoinTime = (a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt));
// Every client computes the same slot layout from presence: earliest joiner wins a contested slot.
function computeSlots() {
  const out = { crew: Array(roomConfig.crewCount).fill(null), police: Array(roomConfig.policeCount).fill(null) };
  const later = [];
  currentRoomPlayers().sort(byJoinTime).forEach((p) => {
    const list = out[p.role]; if (!list) return;
    if (Number.isInteger(p.slot) && p.slot >= 0 && p.slot < list.length && !list[p.slot]) list[p.slot] = p; else later.push(p);
  });
  later.forEach((p) => { const list = out[p.role]; const i = list ? list.indexOf(null) : -1; if (i >= 0) list[i] = p; });
  return out;
}
function slotNameOf(playerId) { return cleanName(currentRoomPlayers().find((p) => p.playerId === playerId)?.name) || "Player"; }
function clearLobbySel() { lobbySel = null; renderSlots(); }
function onSlotTap(side, index, player) {
  if (!player) lobbySel = { type: "move", side, index };
  else if (player.playerId === roomPlayerId) lobbySel = null;
  else if (isRoomHost) lobbySel = lobbySel?.playerId === player.playerId ? null : { type: "kick", playerId: player.playerId };
  else return;
  renderSlots();
}
async function confirmSlotAction() {
  const sel = lobbySel; if (!sel || !activeRoomChannel) return;
  if (sel.type === "move") {
    if (computeSlots()[sel.side][sel.index]) { roomStatus.textContent = "Someone just took that slot."; clearLobbySel(); return; }
    crewChoices.role = sel.side; mySlot = sel.index; lobbySel = null;
    try { await trackSelf(); } catch { roomStatus.textContent = "Could not change position."; }
  } else if (sel.type === "kick" && isRoomHost) {
    const name = slotNameOf(sel.playerId); lobbySel = null; renderSlots();
    try { await broadcastRoom("kick", { targetId: sel.playerId }); roomStatus.textContent = `${name} was removed from the room.`; }
    catch (error) { roomStatus.textContent = error.message; }
  }
}
function resetRoomUI() {
  currentRoomCode = ""; isRoomHost = false; roomConfig = null; mySlot = 0; lobbySel = null; hostRoomInfo = null; roomChannelKey = ""; selectedRoom = null; roomStarted = false; operationStarted = false; roomPlayerId = makeRoomPlayerId();
  document.getElementById("created-room-code").textContent = "-----";
  const startButton = document.getElementById("start-room"); startButton.textContent = "Start game"; startButton.disabled = true;
  document.getElementById("room-player-status").textContent = ""; roomStatus.textContent = "";
  document.getElementById("join-selected").hidden = true;
}
async function leaveRoom() {
  const channel = activeRoomChannel; activeRoomChannel = null;
  if (lobbyChannel) { try { await lobbyChannel.untrack(); } catch { /* ignore */ } }
  if (channel && supabaseClient) { try { await supabaseClient.removeChannel(channel); } catch { /* already closed */ } }
  resetRoomUI();
}
function getRoomConfig() { return { crewCount: roomConfig.crewCount, policeCount: roomConfig.policeCount, totalPlayers: roomConfig.crewCount + roomConfig.policeCount }; }
function applyRoomConfig(config) {
  if (!config || !Number.isInteger(config.crewCount) || !Number.isInteger(config.policeCount)) return;
  if (config.crewCount < 1 || config.crewCount > 3 || config.policeCount < 1 || config.policeCount > 3) return;
  roomConfig = { crewCount: config.crewCount, policeCount: config.policeCount, totalPlayers: config.crewCount + config.policeCount };
  selectedCrewCount = config.crewCount; selectedPoliceCount = config.policeCount;
  selectedBoardSize = boardSizeForPlayers(selectedCrewCount + selectedPoliceCount);
}
function currentRoomPlayers() {
  if (!activeRoomChannel) return [];
  return Object.values(activeRoomChannel.presenceState()).flat();
}
function reconcileRoomHost() {
  if (!activeRoomChannel) return;
  const players = currentRoomPlayers();
  const hosts = players.filter((player) => player.host);
  const candidates = hosts.length ? hosts : players;
  const elected = [...candidates].sort((a, b) => byJoinTime(a, b) || String(a.playerId).localeCompare(String(b.playerId)))[0];
  if (!elected) return;
  const shouldHost = elected.playerId === roomPlayerId;
  if (shouldHost === isRoomHost) return;
  isRoomHost = shouldHost;
  if (isRoomHost) {
    if (!roomStarted) {
      const listing = selectedRoom || {};
      hostRoomInfo = { ...listing, code: currentRoomCode, crew: roomConfig.crewCount, police: roomConfig.policeCount, hasPw: Boolean(roomChannelKey), host: cleanName(playerName) || "Host", started: false };
    }
    trackSelf().catch(() => {});
  }
  updateRoomPresence();
}
function isFromHost(payload) { return currentRoomPlayers().some((p) => p.playerId === payload?.senderId && p.host); }
async function broadcastRoom(event, payload) {
  if (!activeRoomChannel) return;
  const result = await activeRoomChannel.send({ type: "broadcast", event, payload: { ...payload, senderId: roomPlayerId } });
  if (result !== "ok") throw new Error("Could not send an update to the room. Check the connection and try again.");
}
function renderSlots() {
  if (!roomConfig) return;
  const slots = computeSlots();
  if (lobbySel?.type === "move" && slots[lobbySel.side][lobbySel.index]) lobbySel = null;
  if (lobbySel?.type === "kick" && !currentRoomPlayers().some((p) => p.playerId === lobbySel.playerId)) lobbySel = null;
  ["crew", "police"].forEach((side) => {
    const list = document.getElementById(`${side}-slots`); list.replaceChildren();
    slots[side].forEach((p, i) => {
      const li = document.createElement("li"), btn = document.createElement("button");
      btn.type = "button";
      const picked = lobbySel && ((lobbySel.type === "move" && lobbySel.side === side && lobbySel.index === i) || (lobbySel.type === "kick" && p && lobbySel.playerId === p.playerId));
      btn.className = `slot${p ? " filled" : ""}${p?.playerId === roomPlayerId ? " mine" : ""}${picked ? ` picked${lobbySel.type === "kick" ? " kick" : ""}` : ""}`;
      btn.textContent = p ? `${cleanName(p.name) || "Player"}${p.host ? " ★" : ""}${p.playerId === roomPlayerId ? " (you)" : ""}` : "Open";
      btn.disabled = Boolean(p) && p.playerId !== roomPlayerId && !isRoomHost;
      btn.setAttribute("aria-pressed", String(Boolean(picked)));
      btn.addEventListener("click", () => onSlotTap(side, i, p));
      li.append(btn); list.append(li);
    });
    document.getElementById(`${side}-slot-count`).textContent = `${slots[side].filter(Boolean).length}/${slots[side].length}`;
  });
  const action = document.getElementById("slot-action");
  action.disabled = !lobbySel; action.classList.toggle("danger", lobbySel?.type === "kick");
  action.textContent = !lobbySel ? (isRoomHost ? "Tap a slot" : "Tap an open slot") : lobbySel.type === "move" ? "Confirm move" : `Kick ${slotNameOf(lobbySel.playerId)}`;
}
function updateRoomPresence() {
  if (!roomConfig) return;
  const players = currentRoomPlayers();
  if (players.some((player) => player.started)) roomStarted = true;
  reconcileRoomHost();
  renderSlots();
  const host = players.find((p) => p.host);
  document.getElementById("lobby-host").textContent = `${(cleanName(host?.name) || "Host").toUpperCase()}'S ROOM`;
  const crewN = players.filter((p) => p.role === "crew").length, policeN = players.filter((p) => p.role === "police").length;
  document.getElementById("room-player-status").textContent = `${players.length}/${roomConfig.totalPlayers} connected`;
  if (isRoomHost) {
    const full = crewN === roomConfig.crewCount && policeN === roomConfig.policeCount;
    const startButton = document.getElementById("start-room");
    startButton.disabled = !full || roomStarted;
    startButton.textContent = roomStarted ? "Room started" : "Start game";
    startButton.title = roomStarted ? "This room cannot be restarted" : full ? "Start the match" : "Fill every crew and police slot to start";
    roomStatus.textContent = full ? "Everyone is in. Start the game." : "Waiting for players…";
    announceRoom();
  } else document.getElementById("start-room").textContent = roomStarted ? "Room started" : "Waiting for host";
  if (!gameScreen.hidden && crewChoices.mode === "multiplayer") {
    const beginButton = document.getElementById("begin-operation");
    beginButton.disabled = !isRoomHost || !roomStarted || operationStarted;
    beginButton.textContent = !isRoomHost ? "Waiting for host" : operationStarted ? "Operation started" : "Begin operation";
  }
  if (boardState && !boardState.winner && activeRoomChannel) {
    renderLiveBoard();
    if (isComputerTurn()) scheduleComputerMove();
  }
}
async function connectToRoom(code, host) {
  const client = getClient();
  if (activeRoomChannel) { await client.removeChannel(activeRoomChannel); activeRoomChannel = null; }
  isRoomHost = host; roomJoinedAt = new Date().toISOString();
  const channel = client.channel(`evader-room-${code}${roomChannelKey ? `-${roomChannelKey}` : ""}`, { config: { presence: { key: roomPlayerId }, broadcast: { ack: true, self: false } } });
  activeRoomChannel = channel;
  channel
    .on("presence", { event: "sync" }, () => updateRoomPresence())
    .on("broadcast", { event: "room-start" }, ({ payload }) => {
      if (isRoomHost || roomStarted || !isFromHost(payload)) return;
      roomStarted = true;
      hostRoomInfo = null;
      trackSelf().catch(() => {});
      if (lobbyChannel) lobbyChannel.untrack().catch(() => {});
      applyRoomConfig(payload); showBriefing(); roomStatus.textContent = "The host opened the match briefing.";
    })
    .on("broadcast", { event: "kick" }, async ({ payload }) => {
      if (isRoomHost || !isFromHost(payload) || payload.targetId !== roomPlayerId) return;
      await leaveRoom(); showScreen(joinScreen);
      refreshLobby().then(() => renderLiveRooms()).catch((error) => { document.getElementById("join-status").textContent = error.message; });
      toast("The host removed you from the room.");
    })
    .on("broadcast", { event: "game-start" }, ({ payload }) => {
      if (isRoomHost || !isFromHost(payload) || operationStarted) return;
      if (!applyBoardSnapshot(payload.state, 0)) { roomStatus.textContent = "Rejected an invalid game state."; return; }
      roomStarted = true;
      operationStarted = true;
      trackSelf().catch(() => {});
      showScreen(playScreen);
      renderLiveBoard();
    })
    .on("broadcast", { event: "state-request" }, ({ payload }) => {
      const requester = currentRoomPlayers().find((player) => player.playerId === payload.senderId);
      if (!isRoomHost || !operationStarted || !requester) return;
      const state = serializeBoardSnapshot();
      if (requester.inGame || payload.inGame) broadcastRoom("game-state", { revision: boardRevision, force: true, state }).catch(() => {});
      else broadcastRoom("game-start", { revision: 0, state }).catch(() => {});
    })
    .on("broadcast", { event: "game-state" }, ({ payload }) => {
      const sender = currentRoomPlayers().find((player) => player.playerId === payload.senderId);
      if (payload.senderId === roomPlayerId || !sender) return;
      const forcedHostSync = Boolean(payload.force && sender.host);
      if (!Number.isInteger(payload.revision) || (!forcedHostSync && payload.revision <= boardRevision) || !applyBoardSnapshot(payload.state, payload.revision)) return;
      if (!operationStarted) { operationStarted = true; roomStarted = true; showScreen(playScreen); }
      renderLiveBoard();
      if (isRoomHost) broadcastRoom("game-state", { revision: boardRevision, state: serializeBoardSnapshot() }).catch(() => {});
    });
  let settled = false;
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Room connection timed out. Check the project URL and key.")), 12000);
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        window.clearTimeout(timeout);
        try {
          if (host && currentRoomPlayers().some((p) => p.host && p.playerId !== roomPlayerId)) throw new Error("That room code is already in use. Create the room again.");
          if (!host) { // let presence sync, then take a free slot (crew first)
            await new Promise((r) => window.setTimeout(r, 600));
            if (!currentRoomPlayers().some((p) => p.host)) throw new Error("No active host found for this room. It may have closed.");
            if (currentRoomPlayers().some((p) => p.started)) throw new Error("This room has already started and no longer accepts players.");
            const free = computeSlots();
            let i = free.crew.indexOf(null);
            if (i >= 0) { crewChoices.role = "crew"; mySlot = i; }
            else if ((i = free.police.indexOf(null)) >= 0) { crewChoices.role = "police"; mySlot = i; }
            else throw new Error("This room is full.");
          }
          if (await trackSelf() !== "ok") throw new Error("Could not join the room.");
          settled = true; resolve(); updateRoomPresence();
        } catch (error) { reject(error); }
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        window.clearTimeout(timeout);
        if (!settled) reject(new Error(`Room connection failed (${status}). Check Supabase Realtime is enabled.`));
        else if (activeRoomChannel === channel) { const lost = "Lost connection to the room. Leave and rejoin."; roomStatus.textContent = lost; setGameMessage(lost); }
      }
    });
  });
}

document.getElementById("back-to-crew").addEventListener("click", () => {
  if (crewChoices.mode === "multiplayer" && activeRoomChannel) showScreen(lobbyScreen); else showScreen(sideScreen);
});
document.getElementById("begin-operation").addEventListener("click", async () => {
  if (crewChoices.mode === "multiplayer" && (!isRoomHost || !activeRoomChannel || !roomStarted || operationStarted)) return;
  operationStarted = crewChoices.mode === "multiplayer";
  const button = document.getElementById("begin-operation");
  button.disabled = crewChoices.mode === "multiplayer";
  button.textContent = crewChoices.mode === "multiplayer" ? "Operation started" : "Begin operation";
  gameScreen.hidden = true; playScreen.hidden = false; startOperation(); window.scrollTo(0, 0);
  if (crewChoices.mode === "multiplayer") {
    try { await trackSelf(); } catch { /* presence will be refreshed by the channel */ }
    broadcastRoom("game-start", { revision: 0, state: serializeBoardSnapshot() }).catch((error) => setGameMessage(error.message));
  }
});

let boardState;
let boardRevision = 0;
let computerTimer = null;
function clearComputerTimer() { if (computerTimer) { window.clearTimeout(computerTimer); computerTimer = null; } }
function scheduleComputerMove() { clearComputerTimer(); computerTimer = window.setTimeout(makeComputerMove, 300); }
const perimeter = (size) => [
  ...Array.from({ length: size }, (_, col) => ({ row: 0, col })),
  ...Array.from({ length: size - 1 }, (_, i) => ({ row: i + 1, col: size - 1 })),
  ...Array.from({ length: size - 1 }, (_, i) => ({ row: size - 1, col: size - 2 - i })),
  ...Array.from({ length: size - 2 }, (_, i) => ({ row: size - 2 - i, col: 0 }))
];
const edgeKey = (a, b) => [a.row + "," + a.col, b.row + "," + b.col].sort().join("|");
const rnd = (n) => Math.floor(Math.random() * n);
function outwardSides(row, col, size) {
  const sides = [];
  if (row === 0) sides.push("top"); if (row === size - 1) sides.push("bottom");
  if (col === 0) sides.push("left"); if (col === size - 1) sides.push("right");
  return sides;
}
function randomDoor(size, blockedKeys, avoid) {
  for (let i = 0; i < 500; i += 1) {
    const edge = rnd(4), pos = rnd(size);
    const row = edge === 0 ? 0 : edge === 1 ? size - 1 : pos, col = edge === 2 ? 0 : edge === 3 ? size - 1 : pos;
    if (blockedKeys.has(row + "," + col) || (avoid && avoid.row === row && avoid.col === col)) continue;
    const sides = outwardSides(row, col, size);
    return { row, col, side: sides[rnd(sides.length)] };
  }
  return { row: 0, col: Math.floor(size / 2), side: "top" };
}
function rosterFor(side, count) {
  if (crewChoices.mode !== "multiplayer") {
    const human = selectedHumanSide() === side;
    return [{ name: human ? (cleanName(playerName) || "YOU") : "CPU", owner: human ? roomPlayerId : "cpu" }];
  }
  const players = computeSlots()[side].filter(Boolean);
  return Array.from({ length: count }, (_, i) => ({ name: cleanName(players[i]?.name) || `Player ${i + 1}`, owner: players[i]?.playerId || "" }));
}
function freshBoardState() {
  const size = selectedBoardSize, multi = crewChoices.mode === "multiplayer";
  const crewN = multi ? selectedCrewCount : 1, policeN = multi ? selectedPoliceCount : 1;
  const taken = new Set();
  const randCell = (ok) => {
    for (let i = 0; i < 800; i += 1) {
      const row = rnd(size), col = rnd(size);
      if (!taken.has(row + "," + col) && (!ok || ok(row, col))) { taken.add(row + "," + col); return { row, col }; }
    }
    return { row: 1, col: 1 };
  };
  const door = randomDoor(size, taken); taken.add(door.row + "," + door.col);
  const crewRoster = rosterFor("crew", crewN), policeRoster = rosterFor("police", policeN);
  const crew = crewRoster.map((r, i) => ({ ...randCell(), id: `crew-${i + 1}`, num: i + 1, ...r, captured: false, escaped: false }));
  const police = policeRoster.map((r, i) => ({ ...randCell((row, col) => crew.every((c) => Math.abs(c.row - row) + Math.abs(c.col - col) >= 4)), id: `police-${i + 1}`, num: i + 1, ...r, captured: false }));
  const cash = Array.from({ length: 1 + rnd(2) }, () => randCell((row, col) => row > 0 && col > 0 && row < size - 1 && col < size - 1));
  return { size, crew, police, cash, door, walls: new Set(), activeSide: "crew", phaseIds: [], actedIds: new Set(), selectedId: null, barricadeMode: false, barricadeAnchor: null, winner: null };
}
function relocateDoorAndCash() {
  const size = boardState.size, occupied = new Set([...boardState.crew, ...boardState.police].filter((p) => !p.captured && !p.escaped).map((p) => p.row + "," + p.col));
  boardState.door = randomDoor(size, occupied, boardState.door);
  const used = new Set([...occupied, boardState.door.row + "," + boardState.door.col]);
  boardState.cash = boardState.cash.map(() => {
    for (let i = 0; i < 500; i += 1) {
      const row = 1 + rnd(size - 2), col = 1 + rnd(size - 2);
      if (!used.has(row + "," + col)) { used.add(row + "," + col); return { row, col }; }
    }
    return { row: 1, col: 1 };
  });
}
function boardConnected() {
  const seen = new Set(["0,0"]), queue = [{ row: 0, col: 0 }];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const next = { row: cur.row + dr, col: cur.col + dc }, k = next.row + "," + next.col;
      if (!insideBoard(next.row, next.col) || seen.has(k) || blocked(cur, next)) continue;
      seen.add(k); queue.push(next);
    }
  }
  return seen.size === boardState.size * boardState.size;
}
function myUnactedPieces() {
  const next = nextActingPiece();
  return next && isMine(next) ? [next] : [];
}
// Team members act one after another (by player number), so two players can never overwrite each other's moves.
function nextActingPiece() {
  const live = sidePieces(boardState.activeSide);
  return boardState.phaseIds.map((id) => live.find((p) => p.id === id)).find((p) => p && !boardState.actedIds.has(p.id)) || null;
}
function sidePieces(side) { return boardState[side].filter((piece) => side === "crew" ? !piece.captured && !piece.escaped : !piece.captured); }
function pieceAt(row, col) { return ["crew", "police"].flatMap((side) => sidePieces(side).map((piece) => ({ side, piece }))).find(({ piece }) => piece.row === row && piece.col === col) || null; }
function insideBoard(row, col) { return row >= 0 && row < boardState.size && col >= 0 && col < boardState.size; }
function blocked(a, b) { return boardState.walls.has(edgeKey(a, b)); }
function legalMoves(piece, side) {
  const moves = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const row = piece.row + dr, col = piece.col + dc, destination = { row, col };
    if (!insideBoard(row, col) || blocked(piece, destination)) continue;
    const occupant = pieceAt(row, col);
    if (occupant?.side === side) continue;
    moves.push(destination);
  }
  return moves;
}
function pathExists(from, to) {
  const seen = new Set([from.row + "," + from.col]), queue = [{ row: from.row, col: from.col }];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.row === to.row && cur.col === to.col) return true;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const next = { row: cur.row + dr, col: cur.col + dc }, key = next.row + "," + next.col;
      if (!insideBoard(next.row, next.col) || seen.has(key) || blocked(cur, next)) continue;
      seen.add(key); queue.push(next);
    }
  }
  return false;
}
function selectedHumanSide() { return crewChoices.role || "crew"; }
function isOwnerConnected(ownerId) { return Boolean(ownerId) && currentRoomPlayers().some((player) => player.playerId === ownerId); }
function isComputerTurn() {
  if (crewChoices.mode === "single-player") return boardState.activeSide !== selectedHumanSide();
  if (crewChoices.mode === "multiplayer" && isRoomHost && activeRoomChannel && boardState) {
    const next = nextActingPiece();
    return Boolean(next && !isOwnerConnected(next.owner));
  }
  return false;
}
function isRemoteTurn() { return crewChoices.mode === "multiplayer" && Boolean(activeRoomChannel) && !isComputerTurn() && (boardState.activeSide !== selectedHumanSide() || !myUnactedPieces().length); }
function isPieceTurn(side, piece) {
  return !boardState.winner && boardState.activeSide === side && nextActingPiece()?.id === piece.id;
}
function renderLiveBoard() {
  liveBoard.replaceChildren();
  liveBoard.style.gridTemplateColumns = `repeat(${boardState.size}, minmax(0, 1fr))`;
  liveBoard.style.gridTemplateRows = `repeat(${boardState.size}, minmax(0, 1fr))`;
  liveBoard.style.setProperty("--n", String(boardState.size));
  // On your own turn your piece is picked for you, so its moves are already lit.
  if (!boardState.winner && !boardState.selectedId && !isComputerTurn() && !isRemoteTurn()) {
    const mine = myUnactedPieces(); if (mine.length === 1) boardState.selectedId = mine[0].id;
  }
  const focusedCell = document.activeElement?.classList?.contains("play-cell") ? { row: document.activeElement.dataset.row, col: document.activeElement.dataset.col } : null;
  const selected = sidePieces(boardState.activeSide).find((piece) => piece.id === boardState.selectedId);
  const targets = selected && !isComputerTurn() && !isRemoteTurn() ? legalMoves(selected, boardState.activeSide) : [];
  const door = boardState.door, mySide = selectedHumanSide();
  for (let row = 0; row < boardState.size; row += 1) for (let col = 0; col < boardState.size; col += 1) {
    const cell = document.createElement("button"); cell.type = "button"; cell.className = "play-cell";
    cell.dataset.row = String(row); cell.dataset.col = String(col); cell.addEventListener("click", handleBoardCellClick);
    const occupant = pieceAt(row, col), isSelected = occupant?.piece.id === boardState.selectedId;
    if (row === 0 || col === 0 || row === boardState.size - 1 || col === boardState.size - 1) cell.classList.add("edge-cell");
    if (isSelected) cell.classList.add("selected-cell");
    if (targets.some((m) => m.row === row && m.col === col)) cell.classList.add("legal-cell");
    const wallClasses = [];
    if (row > 0 && blocked({ row, col }, { row: row - 1, col })) wallClasses.push("wall-top");
    if (col > 0 && blocked({ row, col }, { row, col: col - 1 })) wallClasses.push("wall-left");
    if (wallClasses.length) cell.classList.add(...wallClasses);
    wallClasses.forEach((cls) => { const bar = document.createElement("i"); bar.className = `wall-bar ${cls}`; bar.setAttribute("aria-hidden", "true"); cell.append(bar); });
    let token = null;
    const isDoor = row === door.row && col === door.col;
    if (isDoor) cell.classList.add("door-cell", `door-${door.side}`);
    if (occupant) {
      const ally = occupant.side === mySide, crewPiece = occupant.side === "crew";
      token = [`${crewPiece ? "N" : "P"}${occupant.piece.num}`, `${occupant.side}-token ${ally ? "ally" : "enemy"}`, `${ally ? "Your team" : "Opponent"} ${crewPiece ? "heist crew" : "police"} ${occupant.piece.num}`];
    } else if (boardState.cash.some((c) => c.row === row && c.col === col)) token = ["$", "cash-token", "Cash"];
    if (token) {
      const marker = document.createElement("span");
      marker.className = `play-token ${token[1]}${occupant?.piece.carrying ? " carrying" : ""}${occupant && isPieceTurn(occupant.side, occupant.piece) ? " turn-glow" : ""}`;
      marker.textContent = token[0]; marker.setAttribute("aria-hidden", "true"); cell.append(marker);
    }
    const isMove = cell.classList.contains("legal-cell");
    cell.setAttribute("aria-label", `Row ${row + 1}, column ${col + 1}${token ? `, ${token[2]}${occupant?.piece.carrying ? " carrying cash" : ""}` : ""}${isSelected ? ", selected" : ""}${isMove ? ", legal move" : ""}${cell.classList.contains("wall-top") ? ", wall above" : ""}${cell.classList.contains("wall-left") ? ", wall left" : ""}`);
    if (isDoor) cell.setAttribute("aria-label", `${cell.getAttribute("aria-label")}, exit door`);
    liveBoard.append(cell);
  }
  if (focusedCell) liveBoard.querySelector(`.play-cell[data-row="${focusedCell.row}"][data-col="${focusedCell.col}"]`)?.focus({ preventScroll: true });
  renderRoster();
  const tray = document.getElementById("wall-tray");
  tray.hidden = mySide !== "police";
  tray.classList.toggle("is-off", !canBuildWall());
  playScreen.classList.toggle("game-over", Boolean(boardState.winner));
}
function renderRoster() {
  const mySide = selectedHumanSide(), box = document.getElementById("roster");
  box.replaceChildren();
  [[mySide, "ally", "YOUR TEAM"], [mySide === "crew" ? "police" : "crew", "enemy", "OPPONENTS"]].forEach(([side, tone, label]) => {
    const row = document.createElement("div"); row.className = `roster-row ${tone}`;
    const title = document.createElement("span"); title.className = "roster-label"; title.textContent = label; row.append(title);
    boardState[side].forEach((piece) => {
      const live = sidePieces(side).includes(piece);
      const item = document.createElement("span"); item.className = `roster-player${isPieceTurn(side, piece) && live ? " active" : ""}${live ? "" : " out"}`;
      const num = document.createElement("b"); num.textContent = String(piece.num);
      const disconnected = crewChoices.mode === "multiplayer" && !isOwnerConnected(piece.owner);
      item.append(num, document.createTextNode(`${cleanName(piece.name) || `Player ${piece.num}`}${disconnected ? " · BOT" : ""}${piece.escaped ? " ✓" : ""}`));
      row.append(item);
    });
    box.append(row);
  });
}
function setGameMessage(message) { document.getElementById("live-message").textContent = message; }
function serializeBoardSnapshot() {
  if (!boardState) return null;
  return { ...boardState, selectedId: null, barricadeMode: false, barricadeAnchor: null, walls: [...boardState.walls], phaseIds: [...boardState.phaseIds], actedIds: [...boardState.actedIds] };
}
function isValidBoardSnapshot(snapshot) {
  if (!snapshot || snapshot.size !== selectedBoardSize || ![7, 10, 12].includes(snapshot.size)) return false;
  if (!Array.isArray(snapshot.crew) || snapshot.crew.length !== selectedCrewCount || !Array.isArray(snapshot.police) || snapshot.police.length !== selectedPoliceCount) return false;
  const ids = new Set();
  for (const [side, pieces] of [["crew", snapshot.crew], ["police", snapshot.police]]) {
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (!piece || piece.id !== `${side}-${index + 1}` || !Number.isInteger(piece.row) || !Number.isInteger(piece.col) || piece.row < 0 || piece.col < 0 || piece.row >= snapshot.size || piece.col >= snapshot.size || typeof piece.owner !== "string" || typeof piece.captured !== "boolean") return false;
      if (side === "crew" && typeof piece.escaped !== "boolean") return false;
      ids.add(piece.id);
    }
  }
  if (!Array.isArray(snapshot.phaseIds) || snapshot.phaseIds.some((id) => !ids.has(id)) || new Set(snapshot.phaseIds).size !== snapshot.phaseIds.length) return false;
  if (!Array.isArray(snapshot.actedIds) || snapshot.actedIds.some((id) => !snapshot.phaseIds.includes(id)) || new Set(snapshot.actedIds).size !== snapshot.actedIds.length) return false;
  if (!Array.isArray(snapshot.cash) || snapshot.cash.length > 2 || snapshot.cash.some((cell) => !cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.col < 0 || cell.row >= snapshot.size || cell.col >= snapshot.size)) return false;
  if (!snapshot.door || !Number.isInteger(snapshot.door.row) || !Number.isInteger(snapshot.door.col) || snapshot.door.row < 0 || snapshot.door.col < 0 || snapshot.door.row >= snapshot.size || snapshot.door.col >= snapshot.size || !["top", "right", "bottom", "left"].includes(snapshot.door.side)) return false;
  if (!Array.isArray(snapshot.walls) || snapshot.walls.length > snapshot.size * snapshot.size * 2 || snapshot.walls.some((edge) => typeof edge !== "string" || !/^\d+,\d+\|\d+,\d+$/.test(edge))) return false;
  if (!["crew", "police"].includes(snapshot.activeSide) || ![null, "crew", "police"].includes(snapshot.winner)) return false;
  return true;
}
function applyBoardSnapshot(snapshot, revision = 0) {
  if (!isValidBoardSnapshot(snapshot)) return false;
  boardState = { ...snapshot, walls: new Set(snapshot.walls), phaseIds: [...snapshot.phaseIds], actedIds: new Set(snapshot.actedIds) };
  boardRevision = Number.isInteger(revision) ? revision : 0;
  if (boardState.winner) showVictoryScreen();
  return true;
}
function broadcastBoardSnapshot() {
  if (crewChoices.mode === "multiplayer" && activeRoomChannel) {
    boardRevision += 1;
    broadcastRoom("game-state", { revision: boardRevision, state: serializeBoardSnapshot() }).catch((error) => setGameMessage(error.message));
  }
}
function beginTeamPhase(side) {
  boardState.activeSide = side; boardState.selectedId = null; boardState.barricadeMode = false; boardState.barricadeAnchor = null;
  boardState.phaseIds = sidePieces(side).map((piece) => piece.id); boardState.actedIds = new Set();
  skipUnavailableActions();
}
let consecutiveSkips = 0;
function skipUnavailableActions() {
  if (consecutiveSkips > 4) {
    // Neither team can move (barricades boxed everyone in). Clear them so play can continue.
    consecutiveSkips = 0; boardState.walls.clear();
    boardState.phaseIds.forEach((id) => boardState.actedIds.delete(id));
    setGameMessage("Deadlock: every route was blocked, so the barricades were cleared.");
  }
  const unacted = boardState.phaseIds.filter((id) => sidePieces(boardState.activeSide).some((p) => p.id === id) && !boardState.actedIds.has(id));
  if (!unacted.length) {
    consecutiveSkips += 1;
    if (sidePieces("crew").length === 0) { declareWinnerIfOver(); renderLiveBoard(); if (boardState.winner) showVictoryScreen(); }
    else beginTeamPhase(boardState.activeSide === "crew" ? "police" : "crew");
    return;
  }
  const upNext = nextActingPiece();
  if (upNext && !legalMoves(upNext, boardState.activeSide).length) {
    boardState.actedIds.add(upNext.id);
    skipUnavailableActions(); return;
  }
  consecutiveSkips = 0;
  renderLiveBoard();
  if (isComputerTurn()) scheduleComputerMove();
}
function isMine(piece) {
  if (crewChoices.mode !== "multiplayer") return true;
  return piece.owner === roomPlayerId || (isRoomHost && Boolean(activeRoomChannel) && !isOwnerConnected(piece.owner));
}
function handleBoardCellClick(event) {
  if (boardState.winner || isComputerTurn() || isRemoteTurn()) return;
  const row = Number(event.currentTarget.dataset.row), col = Number(event.currentTarget.dataset.col), occupant = pieceAt(row, col);
  if (boardState.selectedId) {
    const selected = sidePieces(boardState.activeSide).find((piece) => piece.id === boardState.selectedId);
    const move = selected && legalMoves(selected, boardState.activeSide).find((target) => target.row === row && target.col === col);
    if (move) { movePiece(selected, boardState.activeSide, move); return; }
  }
  boardState.selectedId = occupant?.side === boardState.activeSide && !boardState.actedIds.has(occupant.piece.id) && isMine(occupant.piece) ? occupant.piece.id : null;
  setGameMessage("Tap a glowing square to move.");
  renderLiveBoard();
}

// ---------- Police walls: drag a wall onto any edge of the board ----------
const wallShadow = document.getElementById("wall-shadow");
const liveFrame = document.getElementById("live-frame");
let wallDrag = null;
function canBuildWall() {
  return Boolean(boardState) && !boardState.winner && boardState.activeSide === "police" && selectedHumanSide() === "police" && !isComputerTurn() && !isRemoteTurn() && myUnactedPieces().length > 0;
}
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function wallEdgeAt(x, y, orient) {
  const rect = liveBoard.getBoundingClientRect(), n = boardState.size, cell = rect.width / n;
  const px = x - rect.left, py = y - rect.top;
  if (px < -cell || py < -cell || px > rect.width + cell || py > rect.height + cell) return null;
  let a, b, box;
  if (orient === "h") {
    const line = clampN(Math.round(py / cell), 1, n - 1), col = clampN(Math.floor(px / cell), 0, n - 1);
    a = { row: line - 1, col }; b = { row: line, col }; box = { left: col * cell, top: line * cell - 3, width: cell, height: 6 };
  } else {
    const line = clampN(Math.round(px / cell), 1, n - 1), row = clampN(Math.floor(py / cell), 0, n - 1);
    a = { row, col: line - 1 }; b = { row, col: line }; box = { left: line * cell - 3, top: row * cell, width: 6, height: cell };
  }
  const key = edgeKey(a, b);
  let valid = !boardState.walls.has(key), reason = valid ? "" : "There is already a wall there.";
  if (valid) { boardState.walls.add(key); if (!boardConnected()) { valid = false; reason = "That wall would seal off an area."; } boardState.walls.delete(key); }
  return { key, box, valid, reason, cell };
}
function showWallShadow(edge) {
  if (!edge) { wallShadow.hidden = true; return; }
  const board = liveBoard.getBoundingClientRect(), frame = liveFrame.getBoundingClientRect();
  Object.assign(wallShadow.style, {
    left: `${board.left - frame.left - liveFrame.clientLeft + edge.box.left}px`, top: `${board.top - frame.top - liveFrame.clientTop + edge.box.top}px`,
    width: `${edge.box.width}px`, height: `${edge.box.height}px`
  });
  wallShadow.classList.toggle("invalid", !edge.valid); wallShadow.hidden = false;
}
function updateWallDrag(event) {
  const x = event.clientX, y = event.clientY - wallDrag.lift;
  const cell = liveBoard.getBoundingClientRect().width / boardState.size;
  const horizontal = wallDrag.orient === "h";
  Object.assign(wallDrag.ghost.style, { width: `${horizontal ? cell : 8}px`, height: `${horizontal ? 8 : cell}px`, left: `${x}px`, top: `${y}px` });
  wallDrag.edge = wallEdgeAt(x, y, wallDrag.orient);
  showWallShadow(wallDrag.edge);
}
function endWallDrag(event, apply) {
  if (!wallDrag || event.pointerId !== wallDrag.pointerId) return;
  const { ghost, edge } = wallDrag; wallDrag = null;
  ghost.remove(); showWallShadow(null);
  if (!apply) return;
  if (!edge) { setGameMessage("Drop the wall on the board."); return; }
  if (!edge.valid) { setGameMessage(edge.reason); return; }
  if (!canBuildWall()) return;
  const unit = myUnactedPieces()[0];
  boardState.walls.add(edge.key);
  finishPieceAction(unit.id, "Wall built.");
}
document.querySelectorAll(".wall-chip").forEach((chip) => {
  chip.addEventListener("pointerdown", (event) => {
    if (wallDrag) return;
    if (!canBuildWall()) { setGameMessage("You can build a wall on your turn."); return; }
    event.preventDefault(); chip.setPointerCapture(event.pointerId);
    const ghost = document.createElement("div"); ghost.className = "wall-ghost"; document.body.append(ghost);
    wallDrag = { orient: chip.dataset.orient, pointerId: event.pointerId, lift: event.pointerType === "touch" ? 56 : 0, ghost, edge: null };
    updateWallDrag(event);
  });
  chip.addEventListener("pointermove", (event) => { if (wallDrag && event.pointerId === wallDrag.pointerId) updateWallDrag(event); });
  chip.addEventListener("pointerup", (event) => endWallDrag(event, true));
  chip.addEventListener("pointercancel", (event) => endWallDrag(event, false));
});
function movePiece(piece, side, destination) {
  const target = pieceAt(destination.row, destination.col);
  if (target) {
    if (target.side === "crew") { target.piece.captured = true; setGameMessage(`Police caught crew ${target.piece.num}.`); }
    else {
      piece.captured = true; setGameMessage(`Crew ${piece.num} ran into the police and was caught.`);
      declareWinnerIfOver(); finishPieceAction(piece.id, boardState.winner ? null : undefined); return;
    }
  }
  piece.row = destination.row; piece.col = destination.col;
  if (side === "crew") {
    if (boardState.cash.some((c) => c.row === piece.row && c.col === piece.col)) {
      boardState.cash = boardState.cash.filter((c) => !(c.row === piece.row && c.col === piece.col));
      boardState.cash.push({ row: -1, col: -1 }); relocateDoorAndCash();
      setGameMessage("Cash grabbed. The door and the cash moved to new spots.");
    }
    if (piece.row === boardState.door.row && piece.col === boardState.door.col) {
      piece.escaped = true;
      setGameMessage(crewChoices.mode === "multiplayer" ? `Crew ${piece.num} escaped through the door.` : "The crew escaped through the door!");
    }
  }
  declareWinnerIfOver(); finishPieceAction(piece.id, boardState.winner ? null : undefined);
}
function declareWinnerIfOver() {
  if (boardState.winner) return false;
  if (boardState.crew.some((p) => p.captured)) {
    boardState.winner = "police";
    setGameMessage("A crew member was caught. Police win!");
    return true;
  }
  if (sidePieces("crew").length) return false;
  boardState.winner = "crew";
  setGameMessage("The crew made it out. Crew wins!");
  return true;
}
function showVictoryScreen() {
  if (!boardState.winner) return;
  const crewWon = boardState.winner === "crew", mySide = selectedHumanSide(), iWon = boardState.winner === mySide;
  const art = document.getElementById("victory-art");
  art.style.backgroundImage = `url("assets/${crewWon ? "crewvictory.png" : "policevictory.png"}")`;
  art.setAttribute("aria-label", crewWon ? "The heist crew celebrates their escape" : "The police have stopped the heist crew");
  const sideName = mySide === "crew" ? "CREW" : "POLICE";
  document.getElementById("victory-title").innerHTML = `${sideName}<br><span>${iWon ? "WINS" : "LOSES"}</span>`;
  document.getElementById("victory-copy").textContent = crewWon
    ? (mySide === "crew" ? "You reached the door and escaped." : "The crew reached the door. The police were too slow.")
    : (mySide === "police" ? "You caught a crew member. You stopped the heist." : "A crew member was caught. The heist failed.");
  const replayButton = document.getElementById("play-again");
  replayButton.disabled = crewChoices.mode === "multiplayer";
  replayButton.textContent = replayButton.disabled ? "Room cannot restart" : "Play again";
  playScreen.hidden = true;
  document.getElementById("victory-screen").hidden = false;
  document.getElementById("play-again").focus();
  window.scrollTo(0, 0);
}
function finishPieceAction(pieceId, message) {
  boardState.actedIds.add(pieceId); boardState.selectedId = null; boardState.barricadeMode = false; boardState.barricadeAnchor = null;
  if (message) setGameMessage(message);
  if (boardState.winner) { broadcastBoardSnapshot(); renderLiveBoard(); showVictoryScreen(); return; }
  const oldSide = boardState.activeSide;
  const left = boardState.phaseIds.some((id) => sidePieces(oldSide).some((p) => p.id === id) && !boardState.actedIds.has(id));
  if (left) { renderLiveBoard(); if (isComputerTurn()) scheduleComputerMove(); }
  else beginTeamPhase(oldSide === "crew" ? "police" : "crew");
  broadcastBoardSnapshot();
}
function makeComputerMove() {
  if (boardState.winner || !isComputerTurn()) return;
  const unacted = boardState.phaseIds.filter((id) => sidePieces(boardState.activeSide).some((p) => p.id === id) && !boardState.actedIds.has(id));
  const candidates = unacted.flatMap((id) => { const piece = sidePieces(boardState.activeSide).find((p) => p.id === id); return legalMoves(piece, boardState.activeSide).map((move) => ({ piece, move })); });
  if (!candidates.length) { unacted.forEach((id) => boardState.actedIds.add(id)); skipUnavailableActions(); return; }
  const side = boardState.activeSide;
  candidates.sort((a, b) => computerMoveScore(a, side) - computerMoveScore(b, side));
  const best = computerMoveScore(candidates[0], side), options = candidates.filter((candidate) => computerMoveScore(candidate, side) === best);
  const choice = options[Math.floor(Math.random() * options.length)]; movePiece(choice.piece, side, choice.move);
}
function manhattan(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }
function pathDistance(from, to) {
  const seen = new Set([from.row + "," + from.col]);
  let frontier = [{ row: from.row, col: from.col }], steps = 0;
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      if (cur.row === to.row && cur.col === to.col) return steps;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const n = { row: cur.row + dr, col: cur.col + dc }, key = n.row + "," + n.col;
        if (!insideBoard(n.row, n.col) || seen.has(key) || blocked(cur, n)) continue;
        seen.add(key); next.push(n);
      }
    }
    frontier = next; steps += 1;
  }
  return manhattan(from, to) + 1000;
}
function computerMoveScore(candidate, side) {
  const { piece, move } = candidate, target = pieceAt(move.row, move.col);
  if (side === "crew") return (target?.side === "police" ? 100 : 0) + pathDistance(move, boardState.door);
  const crew = sidePieces("crew");
  const nearest = [...crew].sort((a, b) => manhattan(a, piece) - manhattan(b, piece))[0];
  return (target?.side === "crew" ? -100 : 0) + (nearest ? pathDistance(move, nearest) : 0);
}
function startOperation() {
  clearComputerTimer();
  boardRevision = 0;
  document.getElementById("victory-screen").hidden = true;
  consecutiveSkips = 0;
  boardState = freshBoardState();
  document.getElementById("live-board").setAttribute("aria-label", `${boardState.size} by ${boardState.size} interactive heist board`);
  playScreen.classList.remove("game-over"); setGameMessage("Crew moves first. Tap a glowing square to move.");
  beginTeamPhase("crew");
}
const leaveDialog = document.getElementById("leave-dialog");
document.getElementById("back-to-briefing").addEventListener("click", () => {
  document.getElementById("leave-copy").textContent = crewChoices.mode === "multiplayer"
    ? "The match is still running. If you leave, you drop out of the room and your team plays without you."
    : "The match is still running. If you leave now, your progress is lost.";
  leaveDialog.showModal();
});
document.getElementById("leave-stay").addEventListener("click", () => leaveDialog.close());
leaveDialog.addEventListener("click", (event) => { if (event.target === leaveDialog) leaveDialog.close(); });
document.getElementById("leave-confirm").addEventListener("click", async () => {
  leaveDialog.close(); clearComputerTimer(); wallDrag?.ghost.remove(); wallDrag = null;
  if (crewChoices.mode === "multiplayer") { await leaveRoom(); showScreen(modeScreen); return; }
  playScreen.hidden = true; gameScreen.hidden = false; window.scrollTo(0, 0); document.getElementById("begin-operation").focus();
});
document.getElementById("play-again").addEventListener("click", () => {
  if (crewChoices.mode === "multiplayer") return;
  document.getElementById("victory-screen").hidden = true;
  playScreen.hidden = false;
  startOperation();
  if (crewChoices.mode === "multiplayer") broadcastRoom("game-start", { state: serializeBoardSnapshot() });
});
document.getElementById("victory-home").addEventListener("click", goHome);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!joinScreen.hidden && !hostRoomInfo) {
    refreshLobby().then(() => renderLiveRooms()).catch((error) => { document.getElementById("join-status").textContent = error.message; });
  }
  if (activeRoomChannel && roomStarted && !isRoomHost) {
    broadcastRoom("state-request", { inGame: operationStarted }).catch(() => {});
  }
});
window.addEventListener("pagehide", () => {
  if (activeRoomChannel) activeRoomChannel.untrack().catch(() => {});
  if (lobbyChannel) lobbyChannel.untrack().catch(() => {});
});
window.addEventListener("offline", () => {
  if (!activeRoomChannel) return;
  setGameMessage("Connection lost. You have left the room; the host will keep the match moving.");
  roomStatus.textContent = "Connection lost. Rejoin is not available after a room starts.";
  void leaveRoom();
  showScreen(modeScreen);
  toast("Connection lost. You were removed from the room.");
});
function goHome() {
  clearComputerTimer();
  leaveRoom();
  showScreen(landingScreen); playButton.focus();
}
document.querySelectorAll(".lobby-topbar .wordmark, .game-topbar .wordmark, .play-topbar .wordmark").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); goHome(); }));
