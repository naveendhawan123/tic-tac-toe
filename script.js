// ==========================================
// 1. SUPABASE CREDENTIALS (PASTE YOURS HERE)
// ==========================================
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// 2. PLAYER PERSISTENT IDENTITY
// ==========================================
let playerId = localStorage.getItem("ttt_player_id");
if (!playerId) {
  playerId = "user_" + Math.random().toString(36).substring(2, 9);
  localStorage.setItem("ttt_player_id", playerId);
}

// State
let currentGame = null;
let realtimeChannel = null;

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

const WIN_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

// ==========================================
// 3. AUTO-JOIN VIA INVITE LINK
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get("game");
  if (codeParam) {
    const cleanCode = codeParam.trim().toUpperCase();
    inputCode.value = cleanCode;
    joinGame(cleanCode);
  }
});

// ==========================================
// 4. EVENT LISTENERS
// ==========================================
btnCreate.addEventListener("click", createGame);

btnJoin.addEventListener("click", () => {
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

// ==========================================
// 5. GAME ACTIONS
// ==========================================

// Create a new room
async function createGame() {
  lobbyError.textContent = "";
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { data, error } = await supabase
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

  if (error) {
    lobbyError.textContent = "Could not create game. Check Supabase keys.";
    console.error(error);
    return;
  }

  enterGame(data);
}

// Join an existing room
async function joinGame(code) {
  lobbyError.textContent = "";

  const { data: game, error } = await supabase
    .from("games")
    .select()
    .eq("id", code)
    .single();

  if (error || !game) {
    lobbyError.textContent = "Game not found. Check code or create new.";
    return;
  }

  // If Player O slot is free, join as Player O
  if (!game.player_o && game.player_x !== playerId) {
    const { data: updated, error: updateError } = await supabase
      .from("games")
      .update({
        player_o: playerId,
        status: "playing"
      })
      .eq("id", code)
      .select()
      .single();

    if (updateError) {
      lobbyError.textContent = "Could not join game.";
      return;
    }
    enterGame(updated);
  } else {
    // Check if the user is already player_x or player_o
    if (game.player_x !== playerId && game.player_o !== playerId) {
      lobbyError.textContent = "This game already has 2 players.";
      return;
    }
    enterGame(game);
  }
}

// Switch UI and subscribe to Realtime
function enterGame(game) {
  currentGame = game;
  lobbyView.style.display = "none";
  gameView.style.display = "block";
  lblCode.textContent = game.id;

  // Add game code to URL bar without refreshing
  const url = new URL(window.location);
  url.searchParams.set("game", game.id);
  window.history.pushState({}, "", url);

  render(currentGame);
  subscribeRealtime(game.id);
}

// Subscribe to Supabase Realtime changes on this specific game row
function subscribeRealtime(code) {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase
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

// Render game state to the screen
function render(game) {
  const isX = game.player_x === playerId;
  const isO = game.player_o === playerId;
  const mySymbol = isX ? "X" : isO ? "O" : null;

  lblRole.textContent = mySymbol
    ? `You are Player: ${mySymbol}`
    : `You are Spectating`;

  // Render board cells
  cells.forEach((cell, idx) => {
    cell.textContent = game.board[idx];
    const isOccupied = game.board[idx] !== "";
    const isMyTurn = game.status === "playing" && game.turn === mySymbol;
    cell.disabled = isOccupied || !isMyTurn;
  });

  // Render status & buttons
  if (game.status === "waiting") {
    lblTurn.textContent = "Waiting for Player 2...";
    btnRematch.style.display = "none";
  } else if (game.status === "playing") {
    btnRematch.style.display = "none";
    if (game.turn === mySymbol) {
      lblTurn.textContent = "Your turn!";
    } else {
      lblTurn.textContent = `Player ${game.turn}'s turn...`;
    }
  } else if (game.status === "won") {
    btnRematch.style.display = "inline-block";
    if (game.winner === mySymbol) {
      lblTurn.textContent = "You won!";
    } else {
      lblTurn.textContent = `Player ${game.winner} won!`;
    }
  } else if (game.status === "draw") {
    btnRematch.style.display = "inline-block";
    lblTurn.textContent = "It's a draw!";
  }
}

// Make a move
async function handleCellClick(index) {
  const isX = currentGame.player_x === playerId;
  const isO = currentGame.player_o === playerId;
  const mySymbol = isX ? "X" : isO ? "O" : null;

  if (!mySymbol || currentGame.status !== "playing" || currentGame.turn !== mySymbol) {
    return;
  }

  if (currentGame.board[index] !== "") {
    return;
  }

  const updatedBoard = [...currentGame.board];
  updatedBoard[index] = mySymbol;

  // Check victory / draw
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

  // Update in Supabase
  const { data, error } = await supabase
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
    if (b[x] && b[x] === b[y] && b[x] === b[z]) {
      return b[x];
    }
  }
  return null;
}

// Play Again (Reset board)
async function requestRematch() {
  const { data, error } = await supabase
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

// Leave game and return to lobby
function leaveGame() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  currentGame = null;

  // Clean URL
  const url = new URL(window.location);
  url.searchParams.delete("game");
  window.history.pushState({}, "", url);

  gameView.style.display = "none";
  lobbyView.style.display = "block";
  inputCode.value = "";
  lobbyError.textContent = "";
}
