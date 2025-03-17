const canvas = document.getElementById("mazeCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("gameStatus");
const scoreDisplay = document.getElementById("scoreDisplay");
const restartButton = document.getElementById("restartButton");
const urlParams = new URLSearchParams(window.location.search);
const difficulty = urlParams.get("difficulty");
let mazeSize = difficulty === "easy" ? 10 : difficulty === "medium" ? 20 : 30;
const cellSize = canvas.width / mazeSize;
let maze = [];
const goal = { x: mazeSize - 2, y: mazeSize - 2 };
let agents = [
    { name: "SARSA", pos: { x: 1, y: 1 }, color: "blue", finished: false, prevAction: null, path: [], visited: new Set(), deadEndVisited: new Set() },
    { name: "Q-Learning", pos: { x: 1, y: 1 }, color: "green", finished: false, prevAction: null, path: [], visited: new Set(), deadEndVisited: new Set() },
    { name: "사용자", pos: { x: 1, y: 1 }, color: "red", finished: false, prevAction: null, path: [], visited: new Set(), deadEndVisited: new Set(), isUser: true }
];
let optimalPath = new Set();
let optimalPathCoords = [];
let gameOver = false;
let wins = 0;
let losses = 0;

const actions = ["up", "down", "left", "right"];
let qTables = agents.map(() => Array(mazeSize).fill().map(() => Array(mazeSize).fill().map(() => actions.reduce((acc, a) => ({ ...acc, [a]: 0 }), {}))));
let moveCache = {};
const oppositeActions = { "up": "down", "down": "up", "left": "right", "right": "left" };

function bfsShortestPath(maze, start, goal) {
    const queue = [{ x: start.x, y: start.y, path: [] }];
    const visited = new Set();
    visited.add(`${start.y},${start.x}`);
    while (queue.length > 0) {
        const { x, y, path } = queue.shift();
        if (x === goal.x && y === goal.y) {
            const pathSet = new Set(path.map(p => `${p.y},${p.x}`));
            pathSet.add(`${goal.y},${goal.x}`);
            optimalPathCoords = [...path, { x: goal.x, y: goal.y }];
            return pathSet;
        }
        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (let [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < mazeSize && ny >= 0 && ny < mazeSize && maze[ny][nx] !== 1 && !visited.has(`${ny},${nx}`)) {
                visited.add(`${ny},${nx}`);
                queue.push({ x: nx, y: ny, path: [...path, { x: nx, y: ny }] });
            }
        }
    }
    return new Set();
}

function generateMaze() {
    maze = Array(mazeSize).fill().map(() => Array(mazeSize).fill(1));
    const frontiers = [];
    function addFrontiers(x, y) {
        const dirs = [[0, 2], [2, 0], [0, -2], [-2, 0]];
        for (let [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < mazeSize && ny >= 0 && ny < mazeSize && maze[ny][nx] === 1) {
                frontiers.push({ x: nx, y: ny, parentX: x, parentY: y });
            }
        }
    }
    maze[1][1] = 0;
    addFrontiers(1, 1);
    while (frontiers.length > 0) {
        const idx = Math.floor(Math.random() * frontiers.length);
        const { x, y, parentX, parentY } = frontiers.splice(idx, 1)[0];
        if (maze[y][x] === 1) {
            maze[y][x] = 0;
            maze[(y + parentY) / 2][(x + parentX) / 2] = 0;
            addFrontiers(x, y);
        }
    }
    maze[mazeSize - 2][mazeSize - 2] = 2;
    for (let i = mazeSize - 3; i >= 0; i--) {
        if (maze[mazeSize - 2][i] === 0) break;
        maze[mazeSize - 2][i] = 0;
    }
    for (let i = mazeSize - 3; i >= 0; i--) {
        if (maze[i][mazeSize - 2] === 0) break;
        maze[i][mazeSize - 2] = 0;
    }
}

function simplifyMaze() {
    if (mazeSize > 20) {
        for (let y = 1; y < mazeSize - 1; y += 2) {
            for (let x = 1; x < mazeSize - 1; x += 2) {
                if (Math.random() < 0.2) maze[y][x] = 0;
            }
        }
    }
}

function precomputeMoves() {
    for (let y = 0; y < mazeSize; y++) {
        for (let x = 0; x < mazeSize; x++) {
            if (maze[y][x] !== 1) {
                const key = `${y},${x}`;
                moveCache[key] = actions.filter(action => {
                    const next = getNextState({ x, y }, action);
                    return next.x !== x || next.y !== y;
                });
            }
        }
    }
}

function drawMaze() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const userAgent = agents.find(a => a.isUser);
    const { x: ux, y: uy } = userAgent.pos;

    for (let y = 0; y < mazeSize; y++) {
        for (let x = 0; x < mazeSize; x++) {
            if (gameOver) {
                if (maze[y][x] === 1) ctx.fillStyle = "#333";
                else if (maze[y][x] === 2) ctx.fillStyle = "yellow";
                else ctx.fillStyle = "#fff";
            } else {
                const dist = Math.abs(x - ux) + Math.abs(y - uy);
                if (dist <= 1 || (x === goal.x && y === goal.y)) {
                    if (maze[y][x] === 1) ctx.fillStyle = "#333";
                    else if (maze[y][x] === 2) ctx.fillStyle = "yellow";
                    else ctx.fillStyle = "#fff";
                } else {
                    ctx.fillStyle = "#000";
                }
            }
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }

    agents.forEach(agent => {
        if (!agent.finished || gameOver) {
            ctx.fillStyle = agent.color;
            ctx.fillRect(agent.pos.x * cellSize + cellSize / 4, agent.pos.y * cellSize + cellSize / 4, cellSize / 2, cellSize / 2);
        }
    });

    if (gameOver) visualizePaths();
}

function visualizePaths() {
    agents.forEach(agent => {
        ctx.strokeStyle = agent.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        agent.path.forEach((pos, i) => {
            const x = pos.x * cellSize + cellSize / 2;
            const y = pos.y * cellSize + cellSize / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    });
}

function manhattanDistance(pos) {
    return Math.abs(pos.x - goal.x) + Math.abs(pos.y - goal.y);
}

function isJunction(pos) {
    let openPaths = 0;
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let [dx, dy] of dirs) {
        const nx = pos.x + dx, ny = pos.y + dy;
        if (nx >= 0 && nx < mazeSize && ny >= 0 && ny < mazeSize && maze[ny][nx] !== 1) openPaths++;
    }
    return openPaths > 2;
}

function isDeadEnd(pos) {
    let openPaths = 0;
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let [dx, dy] of dirs) {
        const nx = pos.x + dx, ny = pos.y + dy;
        if (nx >= 0 && nx < mazeSize && ny >= 0 && ny < mazeSize && maze[ny][nx] !== 1) openPaths++;
    }
    return openPaths <= 1;
}

function chooseAction(qTable, state, epsilon = 0.01) {
    if (Math.random() < epsilon) return actions[Math.floor(Math.random() * actions.length)];
    const qValues = qTable[state.y][state.x];
    return actions.reduce((best, a) => qValues[a] > qValues[best] ? a : best, actions[0]);
}

function getNextState(pos, action) {
    let { x, y } = { ...pos };
    if (action === "up") y--;
    else if (action === "down") y++;
    else if (action === "left") x--;
    else if (action === "right") x++;
    if (x < 0 || x >= mazeSize || y < 0 || y >= mazeSize || maze[y][x] === 1) return pos;
    return { x, y };
}

function getReward(agent, pos, nextPos, action, prevAction) {
    const key = `${nextPos.y},${nextPos.x}`;
    if (maze[nextPos.y][nextPos.x] === 2) return 10000;
    if (pos.x === nextPos.x && pos.y === nextPos.y) return -15;
    if (agent.visited.has(key)) return -30;
    if (agent.deadEndVisited.has(key)) return -100;
    const distBefore = manhattanDistance(pos);
    const distAfter = manhattanDistance(nextPos);
    let reward = (distBefore - distAfter) * 3;
    if (isJunction(pos) && optimalPath.has(key)) reward += 100;
    if (isDeadEnd(pos) && prevAction && action === oppositeActions[prevAction]) {
        reward += 10;
        agent.deadEndVisited.add(`${pos.y},${pos.x}`);
    }
    return reward - 3;
}

function updateSARSA(agentIdx, state, action, reward, nextState, nextAction) {
    const alpha = 0.01, gamma = 0.9;
    const qTable = qTables[agentIdx];
    const q = qTable[state.y][state.x][action];
    const nextQ = qTable[nextState.y][nextState.x][nextAction];
    qTable[state.y][state.x][action] = q + alpha * (reward + gamma * nextQ - q);
}

function updateQLearning(agentIdx, state, action, reward, nextState) {
    const alpha = 0.01, gamma = 0.9;
    const qTable = qTables[agentIdx];
    const q = qTable[state.y][state.x][action];
    const nextQ = Math.max(...Object.values(qTable[nextState.y][nextState.x]));
    qTable[state.y][state.x][action] = q + alpha * (reward + gamma * nextQ - q);
}

function moveUserAgent(action) {
    if (gameOver) return;
    const userAgent = agents.find(a => a.isUser);
    if (!userAgent || userAgent.finished) return;
    const nextState = getNextState(userAgent.pos, action);
    if (nextState.x !== userAgent.pos.x || nextState.y !== userAgent.pos.y) {
        userAgent.pos = nextState;
        userAgent.prevAction = action;
        userAgent.path.push({ ...userAgent.pos });
        userAgent.visited.add(`${userAgent.pos.y},${userAgent.pos.x}`);
        if (maze[userAgent.pos.y][userAgent.pos.x] === 2) {
            userAgent.finished = true;
            endGame("사용자 승리! 축하합니다!");
        }
    }
    drawMaze();
}

document.addEventListener("keydown", (event) => {
    event.preventDefault();
    switch (event.key) {
        case "ArrowUp": moveUserAgent("up"); break;
        case "ArrowDown": moveUserAgent("down"); break;
        case "ArrowLeft": moveUserAgent("left"); break;
        case "ArrowRight": moveUserAgent("right"); break;
    }
});

function endGame(message) {
    gameOver = true;
    status.textContent = message;
    drawMaze();
    
    if (message.includes("사용자 승리")) {
        wins++;
    } else {
        losses++;
    }
    scoreDisplay.textContent = `승: ${wins} | 패: ${losses}`;
    restartButton.style.display = "block";
}

function restartGame() {
    gameOver = false;
    agents = [
        { name: "SARSA", pos: { x: 1, y: 1 }, color: "blue", finished: false, prevAction: null, path: [], visited: new Set(), deadEndVisited: new Set() },
        { name: "Q-Learning", pos: { x: 1, y: 1 }, color: "green", finished: false, prevAction: null, path: [], visited: new Set(), deadEndVisited: new Set() },
        { name: "사용자", pos: { x: 1, y: 1 }, color: "red", finished: false, prevAction: null, path: [], visited: new Set(), deadEndVisited: new Set(), isUser: true }
    ];
    qTables = agents.map(() => Array(mazeSize).fill().map(() => Array(mazeSize).fill().map(() => actions.reduce((acc, a) => ({ ...acc, [a]: 0 }), {}))));
    moveCache = {};
    optimalPath = new Set();
    optimalPathCoords = [];
    status.textContent = "대결 시작 중...";
    restartButton.style.display = "none";
    startGame();
}

restartButton.addEventListener("click", restartGame);

function startGame() {
    generateMaze();
    simplifyMaze();
    precomputeMoves();
    const start = { x: 1, y: 1 };
    optimalPath = bfsShortestPath(maze, start, goal);
    drawMaze();

    let renderCounter = 0;
    function gameLoop() {
        if (gameOver) return;

        renderCounter++;
        // AI 이동 속도를 1/3으로 줄이기 위해 3프레임마다 한 번만 이동
        if (renderCounter % 30 === 0) {
            agents.forEach((agent, idx) => {
                if (agent.finished || agent.isUser) return;
                const state = { ...agent.pos };
                const action = chooseAction(qTables[idx], state);
                const nextState = getNextState(state, action);
                const reward = getReward(agent, state, nextState, action, agent.prevAction);

                if (idx === 0) updateSARSA(idx, state, action, reward, nextState, chooseAction(qTables[idx], nextState));
                else if (idx === 1) updateQLearning(idx, state, action, reward, nextState);

                agent.pos = nextState;
                agent.prevAction = action;
                agent.path.push({ ...agent.pos });
                agent.visited.add(`${agent.pos.y},${agent.pos.x}`);

                if (maze[agent.pos.y][agent.pos.x] === 2) {
                    agent.finished = true;
                    endGame(`${agent.name} 승리!`);
                }
            });
        }

        drawMaze();
        if (!agents.every(a => a.finished)) requestAnimationFrame(gameLoop);
    }
    requestAnimationFrame(gameLoop);
}

scoreDisplay.textContent = `승: ${wins} | 패: ${losses}`;
restartButton.style.display = "none";
startGame();
