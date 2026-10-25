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
let selectedBoardSize = 9;
let selectedCrewCount = 3;
let selectedPoliceCount = 3;
let currentRoomCode = "";
let supabaseClient = null;
let activeRoomChannel = null;
let isRoomHost = false;
let roomPlayerId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let roomConfig = null;

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
document.querySelectorAll("[data-back]").forEach((btn) => btn.addEventListener("click", () => showScreen(document.getElementById(btn.dataset.back))));

// ---------- Page 2: player name ----------
const nameInput = document.getElementById("player-name");
let playerName = "";
try { playerName = localStorage.getItem("evader-player-name") || ""; } catch { /* storage unavailable */ }
function cleanName(value) { return String(value || "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16); }
nameInput.value = cleanName(playerName);
function syncName() { continueButton.disabled = cleanName(nameInput.value).length < 2; }
nameInput.addEventListener("input", syncName);
nameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") continueButton.click(); });
syncName();
playButton.addEventListener("click", () => { showScreen(crewScreen); nameInput.focus(); });
document.getElementById("back-to-home").addEventListener("click", (event) => { event.preventDefault(); showScreen(landingScreen); playButton.focus(); });
continueButton.addEventListener("click", () => {
  if (continueButton.disabled) return;
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
  document.getElementById("join-status").textContent = "Connecting to live rooms…";
  openLobby().then(() => renderLiveRooms()).catch((error) => { document.getElementById("join-status").textContent = error.message; });
});

function boardSizeForSetup() {
  if (crewChoices.mode !== "multiplayer" || !roomConfig) { selectedCrewCount = 1; selectedPoliceCount = 1; return 9; }
  selectedCrewCount = roomConfig.crewCount;
  selectedPoliceCount = roomConfig.policeCount;
  return 3 * (selectedCrewCount + selectedPoliceCount) + 3; // total 2 -> 9x9, total 4 -> 15x15
}
function showBriefing() {
  selectedBoardSize = boardSizeForSetup();
  showScreen(gameScreen);
  document.getElementById("selected-side-title").innerHTML = crewChoices.role === "crew" ? "HEIST<br><span>CREW</span>" : "THE<br><span>POLICE</span>";
  document.getElementById("selected-mode").textContent = crewChoices.mode === "single-player" ? "SINGLE PLAYER" : `ONLINE ROOM ${currentRoomCode} · ${selectedCrewCount} CREW + ${selectedPoliceCount} POLICE · ${selectedBoardSize}×${selectedBoardSize}`;
  document.getElementById("objective-copy").textContent = "The crew moves as a team, gathers the cash, and must get every member out. Police can catch crew or barricade a passage.";
  gameStatus.textContent = "Board layout ready. The crew team takes the first phase.";
  const roomDetails = document.getElementById("briefing-room-details");
  roomDetails.hidden = crewChoices.mode !== "multiplayer";
  roomDetails.textContent = crewChoices.mode === "multiplayer" ? `ROOM ${currentRoomCode || "LOCAL"} · ${selectedCrewCount} heist crew + ${selectedPoliceCount} police = ${selectedCrewCount + selectedPoliceCount} total players.` : "";
  const beginButton = document.getElementById("begin-operation");
  beginButton.disabled = crewChoices.mode === "multiplayer" && !isRoomHost;
  beginButton.innerHTML = crewChoices.mode === "multiplayer" && !isRoomHost ? "Waiting for host" : 'Begin operation <span class="button-arrow" aria-hidden="true">↗</span>';
  document.getElementById("back-to-crew").focus();
}

// ---------- Online rooms ----------
// Rooms are listed on a shared "evader-lobby" presence channel. A password is never sent in the clear:
// the host publishes only a salted check-hash, and the game channel name includes a second hash that
// only people who know the password can compute.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let lobbyChannel = null, lobbyReady = null, hostRoomInfo = null, roomChannelKey = "", roomJoinedAt = "", selectedRoom = null;

async function sha(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
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
function liveRooms() {
  if (!lobbyChannel) return [];
  const seen = new Set();
  return Object.values(lobbyChannel.presenceState()).flat().map((p) => p.room).filter((r) => {
    if (!r || !/^[A-Z0-9]{5}$/.test(r.code) || seen.has(r.code)) return false;
    if (![r.crew, r.police].every((n) => Number.isInteger(n) && n >= 1 && n <= 3)) return false;
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
    const left = document.createElement("span"); left.textContent = `${room.code}${room.hasPw ? " 🔒" : ""}`;
    const right = document.createElement("span"); right.textContent = `${room.crew} CREW + ${room.police} POLICE · ${Math.min(Number(room.players) || 0, 6)}/${room.crew + room.police}`;
    btn.append(left, right); btn.addEventListener("click", () => selectRoom(room)); li.append(btn); list.append(li);
  });
  document.getElementById("join-status").textContent = rooms.length ? "Pick a room to join." : (query ? `No live room matches “${query}”.` : "No live rooms right now. Ask a host to create one.");
}
function selectRoom(room) {
  selectedRoom = room;
  document.getElementById("join-selected").hidden = false;
  document.getElementById("join-selected-label").textContent = `ROOM ${room.code}${room.hasPw ? " · PASSWORD REQUIRED" : ""}`;
  const pw = document.getElementById("join-password"); pw.hidden = !room.hasPw; pw.value = "";
  renderLiveRooms();
  (room.hasPw ? pw : document.getElementById("join-room-confirm")).focus();
}
document.getElementById("room-search").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); renderLiveRooms(); });

// ----- Create -----
document.getElementById("create-room-confirm").addEventListener("click", async () => {
  const status = document.getElementById("create-status");
  const crew = Number(document.getElementById("crew-player-count").value), police = Number(document.getElementById("police-player-count").value);
  const password = document.getElementById("room-password").value;
  status.textContent = "Creating room…";
  try {
    await openLobby();
    const taken = new Set(liveRooms().map((r) => r.code));
    let code; do { code = randomString(5, ROOM_CODE_ALPHABET); } while (taken.has(code));
    const room = { code, crew, police, hasPw: Boolean(password) };
    roomChannelKey = "";
    if (password) {
      room.salt = randomString(16, ROOM_CODE_ALPHABET);
      room.check = await sha(`${room.salt}:check:${password}`);
      roomChannelKey = (await sha(`${room.salt}:chan:${password}`)).slice(0, 24);
    }
    hostRoomInfo = room; currentRoomCode = code; isRoomHost = true; crewChoices.role = "crew";
    roomConfig = { crewCount: crew, policeCount: police, totalPlayers: crew + police };
    await connectToRoom(code, true);
    document.getElementById("room-password").value = "";
    document.getElementById("created-room-code").textContent = code;
    showScreen(lobbyScreen); announceRoom();
    roomStatus.textContent = password ? "Room is password protected. Share the code and password." : "Open room. Share the code with your players.";
  } catch (error) { await leaveRoom(); status.textContent = error.message; }
});

// ----- Join -----
document.getElementById("join-room-confirm").addEventListener("click", async () => {
  const status = document.getElementById("join-status"); const room = selectedRoom;
  if (!room) { status.textContent = "Pick a room first."; return; }
  try {
    roomChannelKey = "";
    if (room.hasPw) {
      const password = document.getElementById("join-password").value;
      if (!password) { status.textContent = "Enter the room password."; return; }
      if (await sha(`${room.salt}:check:${password}`) !== room.check) { status.textContent = "Wrong password."; return; }
      roomChannelKey = (await sha(`${room.salt}:chan:${password}`)).slice(0, 24);
    }
    status.textContent = `Joining ${room.code}…`;
    isRoomHost = false; currentRoomCode = room.code;
    roomConfig = { crewCount: room.crew, policeCount: room.police, totalPlayers: room.crew + room.police };
    await connectToRoom(room.code, false);
    document.getElementById("created-room-code").textContent = room.code;
    document.getElementById("join-password").value = "";
    showScreen(lobbyScreen);
    roomStatus.textContent = "Connected. Waiting for the host to start.";
  } catch (error) { await leaveRoom(); status.textContent = error.message; }
});

// ----- Lobby -----
document.getElementById("back-to-setup").addEventListener("click", async () => { await leaveRoom(); showScreen(modeScreen); });
document.getElementById("join-crew-side").addEventListener("click", () => switchSide("crew"));
document.getElementById("join-police-side").addEventListener("click", () => switchSide("police"));
document.getElementById("start-room").addEventListener("click", async () => {
  if (!isRoomHost || document.getElementById("start-room").disabled) return;
  try { await broadcastRoom("room-start", getRoomConfig()); }
  catch (error) { roomStatus.textContent = error.message; return; }
  showBriefing();
});
function trackSelf() {
  return activeRoomChannel.track({ playerId: roomPlayerId, name: cleanName(playerName) || "Player", role: crewChoices.role, host: isRoomHost, joinedAt: roomJoinedAt });
}
async function switchSide(side) {
  if (!activeRoomChannel || crewChoices.role === side) return;
  const cap = side === "crew" ? roomConfig.crewCount : roomConfig.policeCount;
  const taken = currentRoomPlayers().filter((p) => p.role === side && p.playerId !== roomPlayerId).length;
  if (taken >= cap) { roomStatus.textContent = "That side is full."; return; }
  crewChoices.role = side;
  try { await trackSelf(); } catch { roomStatus.textContent = "Could not switch sides."; }
}
function resetRoomUI() {
  currentRoomCode = ""; isRoomHost = false; roomConfig = null; hostRoomInfo = null; roomChannelKey = ""; selectedRoom = null;
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
  selectedBoardSize = 3 * (selectedCrewCount + selectedPoliceCount) + 3;
}
function currentRoomPlayers() {
  if (!activeRoomChannel) return [];
  return Object.values(activeRoomChannel.presenceState()).flat();
}
function isFromHost(payload) { return currentRoomPlayers().some((p) => p.playerId === payload?.senderId && p.host); }
async function broadcastRoom(event, payload) {
  if (!activeRoomChannel) return;
  const result = await activeRoomChannel.send({ type: "broadcast", event, payload: { ...payload, senderId: roomPlayerId } });
  if (result !== "ok") throw new Error("Could not send an update to the room. Check the connection and try again.");
}
function renderSlots() {
  const players = currentRoomPlayers().sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  [["crew", roomConfig.crewCount], ["police", roomConfig.policeCount]].forEach(([side, cap]) => {
    const list = document.getElementById(`${side}-slots`); list.replaceChildren();
    const mine = players.filter((p) => p.role === side);
    for (let i = 0; i < Math.max(cap, mine.length); i++) {
      const li = document.createElement("li"), p = mine[i];
      li.className = p ? "slot filled" : "slot";
      li.textContent = p ? `${cleanName(p.name) || "Player"}${p.host ? " ★ HOST" : ""}${p.playerId === roomPlayerId ? " (you)" : ""}` : "Waiting for player…";
      list.append(li);
    }
    document.getElementById(`${side}-slot-count`).textContent = `${mine.length}/${cap}`;
  });
}
function updateRoomPresence() {
  if (!roomConfig) return;
  renderSlots();
  const players = currentRoomPlayers();
  const crewN = players.filter((p) => p.role === "crew").length, policeN = players.filter((p) => p.role === "police").length;
  document.getElementById("room-player-status").textContent = `${players.length}/${roomConfig.totalPlayers} connected`;
  if (isRoomHost) {
    const full = crewN === roomConfig.crewCount && policeN === roomConfig.policeCount;
    const startButton = document.getElementById("start-room");
    startButton.disabled = !full;
    startButton.title = full ? "Start the match" : "Fill every crew and police slot to start";
    roomStatus.textContent = full ? "Everyone is in. Start the game." : "Waiting for players to fill both sides…";
    announceRoom();
  } else document.getElementById("start-room").textContent = "Waiting for host";
}
async function connectToRoom(code, host) {
  const client = getClient();
  if (activeRoomChannel) { await client.removeChannel(activeRoomChannel); activeRoomChannel = null; }
  isRoomHost = host; roomJoinedAt = new Date().toISOString();
  const channel = client.channel(`evader-room-${code}${roomChannelKey ? `-${roomChannelKey}` : ""}`, { config: { presence: { key: roomPlayerId } } });
  activeRoomChannel = channel;
  channel
    .on("presence", { event: "sync" }, () => updateRoomPresence())
    .on("broadcast", { event: "room-start" }, ({ payload }) => {
      if (isRoomHost || !isFromHost(payload)) return;
      applyRoomConfig(payload); showBriefing(); roomStatus.textContent = "The host opened the match briefing.";
    })
    .on("broadcast", { event: "game-start" }, ({ payload }) => {
      if (isRoomHost || !isFromHost(payload)) return;
      applyBoardSnapshot(payload.state);
      showScreen(playScreen);
      renderLiveBoard();
    })
    .on("broadcast", { event: "game-state" }, ({ payload }) => {
      if (payload.senderId === roomPlayerId) return;
      applyBoardSnapshot(payload.state);
      renderLiveBoard();
    });
  let settled = false;
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Room connection timed out. Check the project URL and key.")), 12000);
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        window.clearTimeout(timeout);
        try {
          if (!host) { // let presence sync, then take a free slot (crew first)
            await new Promise((r) => window.setTimeout(r, 600));
            const players = currentRoomPlayers();
            const crewN = players.filter((p) => p.role === "crew").length, policeN = players.filter((p) => p.role === "police").length;
            if (!players.some((p) => p.host)) throw new Error("No active host found for this room. It may have closed.");
            if (crewN < roomConfig.crewCount) crewChoices.role = "crew";
            else if (policeN < roomConfig.policeCount) crewChoices.role = "police";
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
document.getElementById("begin-operation").addEventListener("click", () => {
  if (crewChoices.mode === "multiplayer" && (!isRoomHost || !activeRoomChannel)) return;
  gameScreen.hidden = true; playScreen.hidden = false; startOperation(); window.scrollTo(0, 0);
  if (crewChoices.mode === "multiplayer") broadcastRoom("game-start", { state: serializeBoardSnapshot() });
  document.getElementById("restart-operation").focus();
});

let boardState;
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
function makeStarts(size) {
  const mid = Math.floor(size / 2), edge = size - 1;
  const crewCount = crewChoices.mode === "multiplayer" ? selectedCrewCount : 1;
  const policeCount = crewChoices.mode === "multiplayer" ? selectedPoliceCount : 1;
  const crewPositions = Array.from({ length: crewCount }, (_, i) => ({ row: edge, col: mid - Math.floor((crewCount - 1) / 2) + i }));
  const policePositions = [{ row: 0, col: 1 }, { row: 0, col: edge - 1 }, { row: 1, col: mid }].slice(0, policeCount);
  return {
    crew: crewPositions.map((p, i) => ({ ...p, id: `crew-${i + 1}`, carrying: false, captured: false, escaped: false })),
    police: policePositions.map((p, i) => ({ ...p, id: `police-${i + 1}`, captured: false }))
  };
}
function freshBoardState() {
  const size = selectedBoardSize;
  const starts = makeStarts(size);
  return {
    size, ...starts,
    cash: { row: Math.floor(size / 2), col: Math.floor(size / 2), available: true },
    hatchIndex: Math.floor(size / 2), hatchPositions: perimeter(size),
    walls: new Set(), activeSide: "crew", phaseIds: [], actedIds: new Set(),
    selectedId: null, barricadeMode: false, barricadeAnchor: null, winner: null
  };
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
function isComputerTurn() { return crewChoices.mode === "single-player" && boardState.activeSide !== selectedHumanSide(); }
function isRemoteTurn() { return crewChoices.mode === "multiplayer" && activeRoomChannel && boardState.activeSide !== selectedHumanSide(); }
function renderLiveBoard() {
  liveBoard.replaceChildren();
  liveBoard.style.gridTemplateColumns = `repeat(${boardState.size}, minmax(0, 1fr))`;
  liveBoard.style.gridTemplateRows = `repeat(${boardState.size}, minmax(0, 1fr))`;
  liveBoard.style.setProperty("--n", String(boardState.size));
  const focusedCell = document.activeElement?.classList?.contains("play-cell") ? { row: document.activeElement.dataset.row, col: document.activeElement.dataset.col } : null;
  document.getElementById("live-grid-size").innerHTML = `${String(boardState.size).padStart(2, "0")} <i>×</i> ${String(boardState.size).padStart(2, "0")}`;
  const selected = sidePieces(boardState.activeSide).find((piece) => piece.id === boardState.selectedId);
  const targets = selected ? legalMoves(selected, boardState.activeSide) : [];
  const hatch = boardState.hatchPositions[boardState.hatchIndex];
  for (let row = 0; row < boardState.size; row += 1) for (let col = 0; col < boardState.size; col += 1) {
    const cell = document.createElement("button"); cell.type = "button"; cell.className = "play-cell";
    cell.dataset.row = String(row); cell.dataset.col = String(col); cell.addEventListener("click", handleBoardCellClick);
    const occupant = pieceAt(row, col), isSelected = occupant?.piece.id === boardState.selectedId;
    if (row === 0 || col === 0 || row === boardState.size - 1 || col === boardState.size - 1) cell.classList.add("edge-cell");
    if (isSelected) cell.classList.add("selected-cell");
    if (boardState.barricadeAnchor?.row === row && boardState.barricadeAnchor?.col === col) cell.classList.add("barricade-anchor");
    if (targets.some((m) => m.row === row && m.col === col)) cell.classList.add("legal-cell");
    const wallClasses = [];
    if (row > 0 && blocked({ row, col }, { row: row - 1, col })) wallClasses.push("wall-top");
    if (col > 0 && blocked({ row, col }, { row, col: col - 1 })) wallClasses.push("wall-left");
    if (wallClasses.length) cell.classList.add(...wallClasses);
    let token = null;
    if (occupant) token = occupant.side === "crew" ? [occupant.piece.carrying ? "N$" : "N", "crew-token", "Heist crew"] : ["P", "police-token", "Police"];
    else if (boardState.cash.available && row === boardState.cash.row && col === boardState.cash.col) token = ["$", "cash-token", "Cash"];
    else if (row === hatch.row && col === hatch.col) token = ["↗", "exit-token", "Moving escape hatch"];
    if (token) {
      const marker = document.createElement("span");
      marker.className = `play-token ${token[1]}${occupant?.piece.carrying ? " carrying" : ""}`;
      marker.textContent = token[0]; marker.setAttribute("aria-hidden", "true"); cell.append(marker);
    }
    const isMove = cell.classList.contains("legal-cell");
    cell.setAttribute("aria-label", `Row ${row + 1}, column ${col + 1}${token ? `, ${token[2]}${occupant?.piece.carrying ? " carrying cash" : ""}` : ""}${isSelected ? ", selected" : ""}${isMove ? ", legal move" : ""}${cell.classList.contains("wall-top") ? ", barricade above" : ""}${cell.classList.contains("wall-left") ? ", barricade left" : ""}`);
    liveBoard.append(cell);
  }
  if (focusedCell) liveBoard.querySelector(`.play-cell[data-row="${focusedCell.row}"][data-col="${focusedCell.col}"]`)?.focus({ preventScroll: true });
  const crewTurn = boardState.activeSide === "crew";
  document.getElementById("turn-name").textContent = crewTurn ? "HEIST CREW" : "POLICE";
  document.getElementById("turn-indicator").classList.toggle("police-turn", !crewTurn);
  const remainingPhase = boardState.phaseIds.filter((id) => sidePieces(boardState.activeSide).some((p) => p.id === id) && !boardState.actedIds.has(id)).length;
  document.getElementById("turn-subtitle").textContent = boardState.winner ? `${boardState.winner === "crew" ? "Heist Crew" : "Police"} win` : isComputerTurn() ? "Computer team phase" : isRemoteTurn() ? "Waiting for the other team" : `Team phase · ${remainingPhase} action${remainingPhase === 1 ? "" : "s"} left`;
  document.getElementById("live-objective").textContent = "Crew: collect the cash and get every crew member out through the moving hatch. Police: catch the crew or place barricades without sealing every route.";
  const barricadeButton = document.getElementById("barricade-toggle");
  barricadeButton.hidden = Boolean(boardState.winner) || boardState.activeSide !== "police" || isComputerTurn() || isRemoteTurn();
  barricadeButton.setAttribute("aria-pressed", String(boardState.barricadeMode));
  barricadeButton.textContent = boardState.barricadeMode ? "Cancel barricade" : "Place barricade";
  playScreen.classList.toggle("game-over", Boolean(boardState.winner));
  const restartButton = document.getElementById("restart-operation");
  restartButton.textContent = boardState.winner ? "Play again" : "Restart operation";
  restartButton.disabled = crewChoices.mode === "multiplayer" && !isRoomHost;
}
function setGameMessage(message) { document.getElementById("live-message").textContent = message; }
function serializeBoardSnapshot() {
  if (!boardState) return null;
  return { ...boardState, walls: [...boardState.walls], phaseIds: [...boardState.phaseIds], actedIds: [...boardState.actedIds] };
}
function applyBoardSnapshot(snapshot) {
  if (!snapshot) return;
  boardState = { ...snapshot, walls: new Set(snapshot.walls || []), phaseIds: snapshot.phaseIds || [], actedIds: new Set(snapshot.actedIds || []) };
  if (boardState.winner) showVictoryScreen();
}
function broadcastBoardSnapshot() {
  if (crewChoices.mode === "multiplayer" && activeRoomChannel) {
    broadcastRoom("game-state", { senderId: roomPlayerId, state: serializeBoardSnapshot() }).catch((error) => setGameMessage(error.message));
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
  if (!unacted.some((id) => legalMoves(sidePieces(boardState.activeSide).find((p) => p.id === id), boardState.activeSide).length)) {
    unacted.forEach((id) => boardState.actedIds.add(id));
    skipUnavailableActions(); return;
  }
  consecutiveSkips = 0;
  renderLiveBoard();
  if (isComputerTurn()) scheduleComputerMove();
}
function handleBoardCellClick(event) {
  if (boardState.winner || isComputerTurn() || isRemoteTurn()) return;
  const row = Number(event.currentTarget.dataset.row), col = Number(event.currentTarget.dataset.col), occupant = pieceAt(row, col);
  if (boardState.barricadeMode) {
    if (!boardState.selectedId && occupant?.side === "police" && !boardState.actedIds.has(occupant.piece.id)) {
      boardState.selectedId = occupant.piece.id; setGameMessage("Police unit selected. Choose any two adjacent squares to barricade their passage."); renderLiveBoard(); return;
    }
    if (!boardState.selectedId) { setGameMessage("Select an unused police unit first."); return; }
    if (!boardState.barricadeAnchor) {
      boardState.barricadeAnchor = { row, col };
      setGameMessage("Now choose a square directly beside it. The barricade can be placed anywhere on the board.");
      renderLiveBoard();
      return;
    }
    const first = boardState.barricadeAnchor, second = { row, col };
    const distance = Math.abs(first.row - second.row) + Math.abs(first.col - second.col);
    if (distance !== 1) { setGameMessage("Choose a square directly beside the first one."); return; }
    const key = edgeKey(first, second);
    if (boardState.walls.has(key)) { setGameMessage("That passage is already barricaded."); return; }
    boardState.walls.add(key);
    const hatchCell = boardState.hatchPositions[boardState.hatchIndex];
    const trapped = sidePieces("crew").some((p) => legalMoves(p, "crew").length === 0 || !pathExists(p, hatchCell));
    if (trapped) { boardState.walls.delete(key); setGameMessage("That barricade would completely trap a crew member."); return; }
    finishPieceAction(boardState.selectedId, "Passage barricaded."); return;
  }
  if (boardState.selectedId) {
    const selected = sidePieces(boardState.activeSide).find((piece) => piece.id === boardState.selectedId);
    const move = selected && legalMoves(selected, boardState.activeSide).find((target) => target.row === row && target.col === col);
    if (move) { movePiece(selected, boardState.activeSide, move); return; }
  }
  if (occupant?.side === boardState.activeSide && !boardState.actedIds.has(occupant.piece.id)) {
    boardState.selectedId = occupant.piece.id; setGameMessage("Choose a glowing square. Each active unit acts once in its team phase."); renderLiveBoard();
  } else { boardState.selectedId = null; setGameMessage("Select an unused unit from the current team phase."); renderLiveBoard(); }
}
document.getElementById("barricade-toggle").addEventListener("click", () => {
  if (boardState.winner || boardState.activeSide !== "police" || isComputerTurn() || isRemoteTurn()) return;
  boardState.barricadeMode = !boardState.barricadeMode;
  boardState.selectedId = null;
  boardState.barricadeAnchor = null;
  setGameMessage(boardState.barricadeMode ? "Select a police unit, then an adjacent passage." : "Barricade cancelled."); renderLiveBoard();
});
function movePiece(piece, side, destination) {
  const target = pieceAt(destination.row, destination.col);
  if (target) {
    if (target.side === "crew") {
      target.piece.captured = true;
      if (target.piece.carrying) { boardState.cash.available = true; boardState.cash.row = target.piece.row; boardState.cash.col = target.piece.col; target.piece.carrying = false; }
      setGameMessage("Police captured a crew member.");
    } else {
      // A crew member walking into a police unit is the one who gets caught.
      piece.captured = true;
      if (piece.carrying) { boardState.cash.available = true; boardState.cash.row = destination.row; boardState.cash.col = destination.col; piece.carrying = false; }
      setGameMessage("A crew member ran into the police and was caught.");
      declareWinnerIfOver();
      finishPieceAction(piece.id, boardState.winner ? null : undefined);
      return;
    }
  }
  piece.row = destination.row; piece.col = destination.col;
  if (side === "crew" && boardState.cash.available && piece.row === boardState.cash.row && piece.col === boardState.cash.col) {
    boardState.cash.available = false; piece.carrying = true;
    boardState.hatchIndex = (boardState.hatchIndex + Math.floor(boardState.hatchPositions.length / 2)) % boardState.hatchPositions.length;
    setGameMessage("Cash secured. The escape hatch has shifted to the far side of the vault.");
  }
  const hatch = boardState.hatchPositions[boardState.hatchIndex];
  if (side === "crew" && piece.carrying && piece.row === hatch.row && piece.col === hatch.col) {
    piece.escaped = true; piece.carrying = false; respawnCash(); setGameMessage("A crew member escaped through the hatch. More cash is out for the rest of the crew.");
  }
  declareWinnerIfOver();
  finishPieceAction(piece.id, boardState.winner ? null : undefined);
}
function declareWinnerIfOver() {
  if (boardState.winner || sidePieces("crew").length) return false;
  // Crew wins only if every member escaped; any capture means the police win.
  boardState.winner = boardState.crew.every((p) => p.escaped) ? "crew" : "police";
  setGameMessage(boardState.winner === "crew" ? "Every crew member escaped. The heist is complete!" : "Police caught a crew member. Heist foiled.");
  return true;
}
function showVictoryScreen() {
  if (!boardState.winner) return;
  const crewWon = boardState.winner === "crew";
  const art = document.getElementById("victory-art");
  art.style.backgroundImage = `url("assets/${crewWon ? "crew-victory.jpg" : "police-victory.jpg"}")`;
  art.setAttribute("aria-label", crewWon ? "The heist crew celebrates their escape" : "The police have stopped the heist crew");
  document.getElementById("victory-title").innerHTML = crewWon ? "THE HEIST<br><span>SUCCEEDED</span>" : "THE HEIST<br><span>FOILED</span>";
  document.getElementById("victory-copy").textContent = crewWon ? "Every crew member made it out. The cash is yours." : "The police stopped the escape and secured the vault.";
  const replayButton = document.getElementById("play-again");
  replayButton.disabled = crewChoices.mode === "multiplayer" && !isRoomHost;
  replayButton.innerHTML = replayButton.disabled ? "Waiting for host" : 'Play again <span class="button-arrow" aria-hidden="true">↗</span>';
  playScreen.hidden = true;
  document.getElementById("victory-screen").hidden = false;
  document.getElementById("play-again").focus();
  window.scrollTo(0, 0);
}
function respawnCash() {
  if (!sidePieces("crew").length) return;
  const mid = Math.floor(boardState.size / 2), hatch = boardState.hatchPositions[boardState.hatchIndex];
  const free = [];
  for (let row = 1; row < boardState.size - 1; row += 1) for (let col = 1; col < boardState.size - 1; col += 1) {
    if (!pieceAt(row, col) && !(row === hatch.row && col === hatch.col)) free.push({ row, col });
  }
  free.sort((a, b) => manhattan(a, { row: mid, col: mid }) - manhattan(b, { row: mid, col: mid }));
  const spot = free[0];
  if (spot) { boardState.cash.row = spot.row; boardState.cash.col = spot.col; boardState.cash.available = true; }
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
  if (side === "crew") {
    const hatchCell = boardState.hatchPositions[boardState.hatchIndex];
    const goal = piece.carrying || !boardState.cash.available ? hatchCell : boardState.cash;
    return (target?.side === "police" ? 100 : 0) + pathDistance(move, goal);
  }
  const crew = sidePieces("crew");
  const nearest = [...crew].sort((a, b) => manhattan(a, piece) - manhattan(b, piece))[0];
  return (target?.side === "crew" ? -100 : 0) + (nearest ? pathDistance(move, nearest) : 0);
}
function startOperation() {
  clearComputerTimer();
  document.getElementById("victory-screen").hidden = true;
  consecutiveSkips = 0;
  boardState = freshBoardState();
  document.getElementById("live-board").setAttribute("aria-label", `${boardState.size} by ${boardState.size} interactive heist board`);
  playScreen.classList.remove("game-over"); setGameMessage("Crew team phase: each crew member takes one action.");
  beginTeamPhase("crew");
}
document.getElementById("back-to-briefing").addEventListener("click", () => {
  clearComputerTimer(); playScreen.hidden = true; gameScreen.hidden = false; window.scrollTo(0, 0); document.getElementById("begin-operation").focus();
});
document.getElementById("restart-operation").addEventListener("click", () => {
  if (crewChoices.mode === "multiplayer" && !isRoomHost) return;
  startOperation();
  if (crewChoices.mode === "multiplayer") broadcastRoom("game-start", { state: serializeBoardSnapshot() });
});
document.getElementById("play-again").addEventListener("click", () => {
  if (crewChoices.mode === "multiplayer" && !isRoomHost) return;
  document.getElementById("victory-screen").hidden = true;
  playScreen.hidden = false;
  startOperation();
  if (crewChoices.mode === "multiplayer") broadcastRoom("game-start", { state: serializeBoardSnapshot() });
});
document.getElementById("victory-home").addEventListener("click", goHome);

function goHome() {
  clearComputerTimer();
  leaveRoom();
  showScreen(landingScreen); playButton.focus();
}
document.querySelectorAll(".lobby-topbar .wordmark, .game-topbar .wordmark, .play-topbar .wordmark").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); goHome(); }));
