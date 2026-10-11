container.innerHTML = htmlContent;

const setup = db.canvas('#pongCanvas');
if (!setup) return;
const { canvas, ctx, width, height, clear } = setup;

const arcadeStore = db.storage('pong_arcade_stats');
const statsState = db.state({
  playerWins: arcadeStore.get('player_wins', 0),
  aiWins: arcadeStore.get('ai_wins', 0)
}, (st) => {
  const pWinsEl = $('#player-wins-count');
  const aiWinsEl = $('#ai-wins-count');
  if (pWinsEl) pWinsEl.innerText = st.playerWins;
  if (aiWinsEl) aiWinsEl.innerText = st.aiWins;
  arcadeStore.set('player_wins', st.playerWins);
  arcadeStore.set('ai_wins', st.aiWins);
});

if ($('#player-wins-count')) $('#player-wins-count').innerText = statsState.val.playerWins;
if ($('#ai-wins-count')) $('#ai-wins-count').innerText = statsState.val.aiWins;

let secondsElapsed = 0;
const matchTimer = db.timer(1000, () => {
  secondsElapsed++;
  const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
  const secs = (secondsElapsed % 60).toString().padStart(2, '0');
  const timerEl = $('#match-timer');
  if (timerEl) timerEl.innerText = `${mins}:${secs}`;
});

let playerY = height / 2 - 35;
let aiY = height / 2 - 35;
const paddleWidth = 10;
const paddleHeight = 70;

let ballX = width / 2;
let ballY = height / 2;
let ballSpeedX = 5;
let ballSpeedY = 2.5;
const ballSize = 8;

let playerScore = 0;
let aiScore = 0;
let upPressed = false;
let downPressed = false;

// Event handlers with guaranteed cleanup to prevent stacking
const handleKeyDown = (e) => {
  if (['ArrowUp', 'w', 'W'].includes(e.key)) upPressed = true;
  if (['ArrowDown', 's', 'S'].includes(e.key)) downPressed = true;
  if (e.key === ' ') {
    e.preventDefault();
    const startBtn = $('#start-btn');
    if (startBtn) startBtn.click();
  }
};

const handleKeyUp = (e) => {
  if (['ArrowUp', 'w', 'W'].includes(e.key)) upPressed = false;
  if (['ArrowDown', 's', 'S'].includes(e.key)) downPressed = false;
};

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

db.onCleanup(() => {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);
});

const gameLoop = db.loop((delta, time) => {
  if (!gameLoop.isRunning) return;

  if (upPressed) playerY -= 7;
  if (downPressed) playerY += 7;
  playerY = Math.max(0, Math.min(height - paddleHeight, playerY));

  const aiCenter = aiY + paddleHeight / 2;
  if (aiCenter < ballY - 12) aiY += 3.8;
  else if (aiCenter > ballY + 12) aiY -= 3.8;
  aiY = Math.max(0, Math.min(height - paddleHeight, aiY));

  ballX += ballSpeedX;
  ballY += ballSpeedY;

  if (ballY <= 0 || ballY >= height - ballSize) {
    ballSpeedY *= -1;
    db.beep(300, 0.04, 'square', 0.05);
  }

  if (ballX <= 25 + paddleWidth && ballY >= playerY && ballY <= playerY + paddleHeight) {
    ballSpeedX *= -1;
    ballSpeedX *= 1.04;
    db.beep(550, 0.06, 'sine', 0.1);
  }
  if (ballX >= width - 25 - paddleWidth && ballY >= aiY && ballY <= aiY + paddleHeight) {
    ballSpeedX *= -1;
    ballSpeedX *= 1.04;
    db.beep(550, 0.06, 'sine', 0.1);
  }

  if (ballX < 0) {
    aiScore++;
    const aiEl = $('#ai-score');
    if (aiEl) aiEl.innerText = aiScore;
    db.beep(120, 0.2, 'sawtooth', 0.1);
    
    const matchEnded = checkWinCondition();
    if (!matchEnded) {
      db.notify("AI Scored!");
    }
    resetBall(-4);
  } else if (ballX > width) {
    playerScore++;
    const pEl = $('#player-score');
    if (pEl) pEl.innerText = playerScore;
    db.beep(880, 0.2, 'sine', 0.1);
    
    const matchEnded = checkWinCondition();
    if (!matchEnded) {
      db.notify("Point for Player! 🎉");
    }
    resetBall(4);
  }

  drawFrame();
});

function checkWinCondition() {
  if (playerScore >= 5 || aiScore >= 5) {
    const winner = playerScore >= 5 ? "Player" : "AI";
    
    gameLoop.stop();
    matchTimer.stop();
    
    db.notify(`🏆 ${winner} wins the match (5 points)!`);
    db.beep(880, 0.4, 'sine', 0.2);

    if (winner === "Player") {
      statsState.update(st => ({ ...st, playerWins: st.playerWins + 1 }));
    } else {
      statsState.update(st => ({ ...st, aiWins: st.aiWins + 1 }));
    }

    playerScore = 0;
    aiScore = 0;
    const pEl = $('#player-score');
    const aiEl = $('#ai-score');
    if (pEl) pEl.innerText = 0;
    if (aiEl) aiEl.innerText = 0;

    secondsElapsed = 0;
    const timerEl = $('#match-timer');
    if (timerEl) timerEl.innerText = "00:00";

    const startBtn = $('#start-btn');
    if (startBtn) {
      startBtn.innerText = "▶ Play Again";
      startBtn.classList.add('accent');
    }
    
    return true;
  }
  return false;
}

function resetBall(dirX) {
  ballX = width / 2;
  ballY = height / 2;
  ballSpeedX = dirX;
  ballSpeedY = 2.5;
}

function drawFrame() {
  clear('#0f111a');
  ctx.strokeStyle = '#313244';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#cba6f7';
  ctx.fillRect(15, playerY, paddleWidth, paddleHeight);
  ctx.fillRect(width - 15 - paddleWidth, aiY, paddleWidth, paddleHeight);
  ctx.fillRect(ballX, ballY, ballSize, ballSize);
}

drawFrame();

const startBtn = $('#start-btn');
if (startBtn) {
  startBtn.onclick = () => {
    if (gameLoop.isRunning) {
      gameLoop.stop();
      matchTimer.stop();
      startBtn.innerText = "▶ Resume Match (Spacebar)";
      startBtn.classList.add('accent');
      db.notify("Match Paused");
    } else {
      gameLoop.start();
      matchTimer.start();
      startBtn.innerText = "⏸ Pause Match (Spacebar)";
      startBtn.classList.remove('accent');
      db.notify("Match Started!");
    }
  };
}

$('#reset-board-btn').onclick = () => {
  arcadeStore.clear();
  statsState.val = { playerWins: 0, aiWins: 0 };
  db.notify("Leaderboard stats reset to 0!");
};

db.onCleanup(() => {
  gameLoop.stop();
  matchTimer.stop();
});