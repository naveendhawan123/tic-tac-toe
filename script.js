// ==========================================
// 1. SUPABASE CREDENTIALS (PASTE YOURS HERE)
// ==========================================
const SUPABASE_URL = "https://rryztjivmxkvkfgeilwm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_RwDTHg7TjFSppEV9NZTw6Q_1GMO1d6x";

// DOM Elements
const lobbyView = document.getElementById("lobby-view");
const gameView = document.getElementById("game-view");
const btnCreate = document.getElementById("btn-create");
const btnJoin = document.getElementById("btn-join");
const inputCode = document.getElementById("input-code");
const lobbyError = document.getElementById("lobby-error");

const lblCode = document.getElementById("lbl-code");
const btnCopy = document.getElementById("btn-copy");
const copyStatus = document.getElementById("copy-status");
const lblRole = document.getElementById("lbl-role");
const lblTurn = document.getElementById("lbl-turn");
const cells = document.querySelectorAll(".cell");
const btnRematch = document.getElementById("btn-rematch");
const btnLeave = document.getElementById("btn-leave");

// Initialize Supabase client avoiding variable collision
let supabaseClient = null;

if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR_SUPABASE") || !SUPABASE_URL.startsWith("https://")) {
  lobbyError.innerHTML = "Configuration error: Enter a valid <code>SUPABASE_URL</code> in <code>script.js</code>.";
} else if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
  lobbyError.innerHTML = "Configuration error: Enter your <code>SUPABASE_ANON_KEY</code> in <code>script.js</code>.";
} else if (!window.supabase) {
  lobbyError.textContent = "Supabase CDN failed to load. Check your network connection.";
} else {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    lobbyError.textContent = "Initialization failed: " + err.message;
  }
}

// Persistent Player Identity
let playerId = localStorage.getItem("ttt_player_id");
if (!playerId) {
  playerId = "user_" + Math.random().toString(36).substring(2, 9);
  localStorage.setItem("ttt_player_id", playerId);
}

// State
let currentGame = null;
let realtimeChannel = null;

const WIN_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

// Auto-join via invite link on page load
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get("game");
  if (codeParam && supabaseClient) {
    const cleanCode = codeParam.trim().toUpperCase();
    inputCode.value = cleanCode;
    joinGame(cleanCode);
  }
});

// Event Listeners
btnCreate.addEventListener("click", () => {
  if (!supabaseClient) {
    lobbyError.textContent = "Database client not ready. Check your Supabase URL & Key.";
    return;
  }
  createGame();
});

btnJoin.addEventListener("click", () => {
  if (!supabaseClient) return;
  const code = inputCode.value.trim().toUpperCase();
  if (!code) {
    lobbyError.textContent = "Please enter a 6-character code.";
    return;
  }
  joinGame(code);
});

btnCopy.addEventListener("click", () => {
  const inviteLink = `${window.location.origin}${window.location.pathname}?game=${currentGame.id}`;
  navigator.clipboard.writeText(inviteLink).then(() => {
    copyStatus.textContent = "Invite link copied to clipboard!";
    setTimeout(() => { copyStatus.textContent = ""; }, 2500);
  });
});

cells.forEach(cell => {
  cell.addEventListener("click", () => {
    const idx = parseInt(cell.getAttribute("data-idx"), 10);
    handleCellClick(idx);
  });
});

btnRematch.addEventListener("click", requestRematch);
btnLeave.addEventListener("click", leaveGame);

// 1. Create Game
async function createGame() {
  lobbyError.textContent = "Creating game...";
  btnCreate.disabled = true;

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  try {
    const { data, error } = await supabaseClient
      .from("games")
      .insert([{
        id: code,
        player_x: playerId,
        player_o: null,
        board: ["", "", "", "", "", "", "", "", ""],
        turn: "X",
        status: "waiting",
        winner: null
      }])
      .select()
      .single();

    btnCreate.disabled = false;

    if (error) {
      lobbyError.textContent = "Database error: " + error.message;
      console.error(error);
      return;
    }

    lobbyError.textContent = "";
    enterGame(data);
  } catch (err) {
    btnCreate.disabled = false;
    lobbyError.textContent = "Unexpected error: " + err.message;
    console.error(err);
  }
}

// 2. Join Game
async function joinGame(code) {
  lobbyError.textContent = "Joining game...";
  btnJoin.disabled = true;

  try {
    const { data: game, error } = await supabaseClient
      .from("games")
      .select()
      .eq("id", code)
      .single();

    btnJoin.disabled = false;

    if (error || !game) {
      lobbyError.textContent = "Game code not found. Please verify the code.";
      return;
    }

    if (!game.player_o && game.player_x !== playerId) {
      const { data: updated, error: updateError } = await supabaseClient
        .from("games")
        .update({
          player_o: playerId,
          status: "playing"
        })
        .eq("id", code)
        .select()
        .single();

      if (updateError) {
        lobbyError.textContent = "Failed to join: " + updateError.message;
        return;
      }
      lobbyError.textContent = "";
      enterGame(updated);
    } else {
      if (game.player_x !== playerId && game.player_o !== playerId) {
        lobbyError.textContent = "This game room is already full.";
        return;
      }
      lobbyError.textContent = "";
      enterGame(game);
    }
  } catch (err) {
    btnJoin.disabled = false;
    lobbyError.textContent = "Network error: " + err.message;
  }
}

// 3. Enter Game & Setup View
function enterGame(game) {
  currentGame = game;
  lobbyView.style.display = "none";
  gameView.style.display = "block";
  lblCode.textContent = game.id;

  const url = new URL(window.location);
  url.searchParams.set("game", game.id);
  window.history.pushState({}, "", url);

  render(currentGame);
  subscribeRealtime(game.id);
}

// 4. Realtime Subscription
function subscribeRealtime(code) {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel(`game-${code}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "games",
        filter: `id=eq.${code}`
      },
      (payload) => {
        currentGame = payload.new;
        render(currentGame);
      }
    )
    .subscribe();
}

// 5. Render Board & State
function render(game) {
  const isX = game.player_x === playerId;
  const isO = game.player_o === playerId;
  const mySymbol = isX ? "X" : isO ? "O" : null;

  lblRole.textContent = mySymbol
    ? `You are Player: ${mySymbol}`
    : `Spectating`;

  cells.forEach((cell, idx) => {
    cell.textContent = game.board[idx];
    const isOccupied = game.board[idx] !== "";
    const isMyTurn = game.status === "playing" && game.turn === mySymbol;
    cell.disabled = isOccupied || !isMyTurn;
  });

  if (game.status === "waiting") {
    lblTurn.textContent = "Waiting for Player 2...";
    btnRematch.style.display = "none";
  } else if (game.status === "playing") {
    btnRematch.style.display = "none";
    lblTurn.textContent = game.turn === mySymbol ? "Your turn!" : `Player ${game.turn}'s turn...`;
  } else if (game.status === "won") {
    btnRematch.style.display = "inline-block";
    lblTurn.textContent = game.winner === mySymbol ? "You won!" : `Player ${game.winner} won!`;
  } else if (game.status === "draw") {
    btnRematch.style.display = "inline-block";
    lblTurn.textContent = "It's a draw!";
  }
}

// 6. Handle Clicks / Moves
async function handleCellClick(index) {
  const isX = currentGame.player_x === playerId;
  const isO = currentGame.player_o === playerId;
  const mySymbol = isX ? "X" : isO ? "O" : null;

  if (!mySymbol || currentGame.status !== "playing" || currentGame.turn !== mySymbol || currentGame.board[index] !== "") {
    return;
  }

  const updatedBoard = [...currentGame.board];
  updatedBoard[index] = mySymbol;

  const winner = checkWinner(updatedBoard);
  const isDraw = !winner && updatedBoard.every(sq => sq !== "");

  let nextStatus = "playing";
  let nextTurn = currentGame.turn === "X" ? "O" : "X";
  let winningSymbol = null;

  if (winner) {
    nextStatus = "won";
    winningSymbol = winner;
  } else if (isDraw) {
    nextStatus = "draw";
  }

  const { data, error } = await supabaseClient
    .from("games")
    .update({
      board: updatedBoard,
      turn: nextTurn,
      status: nextStatus,
      winner: winningSymbol
    })
    .eq("id", currentGame.id)
    .select()
    .single();

  if (!error && data) {
    currentGame = data;
    render(currentGame);
  }
}

function checkWinner(b) {
  for (const [x, y, z] of WIN_COMBOS) {
    if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x];
  }
  return null;
}

// 7. Rematch
async function requestRematch() {
  const { data, error } = await supabaseClient
    .from("games")
    .update({
      board: ["", "", "", "", "", "", "", "", ""],
      turn: "X",
      status: "playing",
      winner: null
    })
    .eq("id", currentGame.id)
    .select()
    .single();

  if (!error && data) {
    currentGame = data;
    render(currentGame);
  }
}

// 8. Leave Game
function leaveGame() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  currentGame = null;

  const url = new URL(window.location);
  url.searchParams.delete("game");
  window.history.pushState({}, "", url);

  gameView.style.display = "none";
  lobbyView.style.display = "block";
  inputCode.value = "";
  lobbyError.textContent = "";
}
