"use strict";

import {
  connectToFirebase,
  describeError
} from "./shared/firebase.js";

import {
  generateRoomCode,
  buildPhoneUrl
} from "./shared/room-code.js";


// =============================================================
// 2人用 ジャングルバルーンシューティング（PC側）
// ローカルのES module importを使わないため、QRと接続コードは
// 公開前の確認画面でも必ず生成されます。
// =============================================================



const GAME_TIME = 20;
const START_BALLOON_COUNT_PER_SIDE = 3;
const LAST_BALLOON_COUNT_PER_SIDE = 4;
const ADD_BALLOON_AT_SECONDS = 10;
const GOLD_BALLOON_RATE = 0.10;
const BALLOON_WIDTH = 170;
const BALLOON_HEIGHT = 230;
const TOP_MARGIN = 125;
const SIDE_MARGIN = 18;

const normalBalloons = [
  { image: "images/redballoon.png", points: 1 },
  { image: "images/blueballoon.png", points: 1 },
  { image: "images/yellowballoon.png", points: 1 }
];
const goldBalloon = { image: "images/goldballoon.png", points: 5 };

const sounds = {
  shot: new Audio("sound/shot.mp3"),
  hit: new Audio("sound/hit.mp3"),
  miss: new Audio("sound/miss.mp3"),
  clear: new Audio("sound/clear.mp3")
};

const game = document.getElementById("game");
const timeElement = document.getElementById("time");
const instruction = document.getElementById("instruction");
const countdown = document.getElementById("countdown");
const resultOverlay = document.getElementById("resultOverlay");
const message = document.getElementById("message");
const firebaseStatus = document.getElementById("firebaseStatus");
const regenerateButton = document.getElementById("regenerateRoomButton");
const pageWarning = document.getElementById("pageWarning");

const players = [1, 2].map((number) => ({
  number,
  roomId: "",
  connected: false,
  ready: false,
  score: 0,
  aimX: 0.5,
  aimY: 0.5,
  screenX: 0,
  screenY: 0,
  lastFireCounter: null,
  balloons: [],
  side: document.getElementById(`player${number}Side`),
  balloonArea: document.getElementById(`balloonArea${number}`),
  scope: document.getElementById(`scope${number}`),
  flash: document.getElementById(`shotFlash${number}`),
  scoreBox: document.querySelector(`#player${number}Side .scoreBox`),
  scoreElement: document.getElementById(`score${number}`),
  qrElement: document.getElementById(`qrCode${number}`),
  codeElement: document.getElementById(`roomCode${number}`),
  connectElement: document.getElementById(`connect${number}`),
  readyElement: document.getElementById(`ready${number}`)
}));

let firebase = null;
let gamePlaying = false;
let countdownRunning = false;
let gameTimer = null;
let remainingTime = GAME_TIME;
let extraBalloonAdded = false;





function renderQrCode(container, text) {
  container.innerHTML = "";
  try {
    if (typeof window.qrcode !== "function") {
      throw new Error("QRライブラリ未読込");
    }
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    container.innerHTML = qr.createImgTag(5, 4);
    const image = container.querySelector("img");
    if (image) image.alt = "スマホ接続用QRコード";
  } catch (error) {
    const fallback = document.createElement("div");
    fallback.className = "qrError";
    fallback.textContent = "QRを表示できません。下の接続コードを入力してください。";
    container.appendChild(fallback);
    console.error(error);
  }
}

function makeRooms() {
  const room1 = generateRoomCode();
  let room2 = generateRoomCode();
  while (room2 === room1) room2 = generateRoomCode();

  players[0].roomId = room1;
  players[1].roomId = room2;

  players.forEach((player) => {
    player.codeElement.textContent = player.roomId;
    const phoneUrl = new URL(buildPhoneUrl(player.roomId));
    phoneUrl.searchParams.set("player", String(player.number));

    renderQrCode(
      player.qrElement,
      phoneUrl.toString()
    );
  });
}

function showPageWarning() {
  if (location.protocol === "file:") {
    pageWarning.hidden = false;
    pageWarning.textContent =
      "QRと接続コードの確認はできますが、スマホ接続とジャイロ操作にはGitHub PagesなどのHTTPS公開が必要です。";
  }
}

function updatePairingView() {
  players.forEach((player) => {
    player.connectElement.textContent = player.connected
      ? "スマホ接続済み"
      : "スマホ接続待ち";
    player.connectElement.classList.toggle("connected", player.connected);

    player.readyElement.textContent = player.ready
      ? "スタートOK！"
      : "スタート待ち";
    player.readyElement.classList.toggle("ready", player.ready);
  });

  const bothConnected = players.every((player) => player.connected);
  game.classList.toggle("paired", bothConnected);

  if (bothConnected && !gamePlaying && !countdownRunning) {
    instruction.textContent = "ふたりともスマホの「スタート」を押してね！";
  }

  if (
    bothConnected &&
    players.every((player) => player.ready) &&
    !gamePlaying &&
    !countdownRunning
  ) {
    startGame();
  }
}





async function resetReadyFlags() {
  players.forEach((player) => {
    player.ready = false;
  });
  updatePairingView();

  if (!firebase) return;
  await Promise.all(
    players.map((player) =>
      firebase
        .set(firebase.ref(firebase.database, `rooms/${player.roomId}/ready`), false)
        .catch(() => {})
    )
  );
}

function listenToPlayer(player) {
  const roomPath = `rooms/${player.roomId}`;

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/phoneConnected`),
    (snapshot) => {
      player.connected = snapshot.val() === true;
      updatePairingView();
    }
  );

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/ready`),
    (snapshot) => {
      player.ready = snapshot.val() === true;
      updatePairingView();
    }
  );

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/aim`),
    (snapshot) => {
      const value = snapshot.val();
      if (!value || typeof value.x !== "number" || typeof value.y !== "number") return;
      player.aimX = Math.max(0, Math.min(1, value.x));
      player.aimY = Math.max(0, Math.min(1, value.y));
      player.scope.classList.add("detected");
    }
  );

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/fireCounter`),
    (snapshot) => {
      const value = Number(snapshot.val()) || 0;
      if (player.lastFireCounter === null) {
        player.lastFireCounter = value;
        return;
      }
      if (value !== player.lastFireCounter) {
        player.lastFireCounter = value;
        if (gamePlaying) shoot(player);
      }
    }
  );
}
async function initializeFirebase() {
  try {
    firebase = await connectToFirebase();
    firebaseStatus.textContent = "Firebase接続完了";

    await resetReadyFlags();
    players.forEach(listenToPlayer);
  } catch (error) {
    firebaseStatus.textContent = `Firebase接続エラー：${describeError(error)}`;
    console.error(error);
  }
}

function updateScopePositions() {
  const halfWidth = window.innerWidth / 2;
  players.forEach((player) => {
    player.screenX = (player.number === 1 ? 0 : halfWidth) + player.aimX * halfWidth;
    player.screenY = player.aimY * window.innerHeight;
    player.scope.style.left = `${player.aimX * 100}%`;
    player.scope.style.top = `${player.aimY * 100}%`;
  });
  requestAnimationFrame(updateScopePositions);
}

function playSound(audio, volume = 0.6) {
  const copy = audio.cloneNode();
  copy.volume = volume;
  copy.play().catch(() => {});
}

function chooseBalloonData() {
  if (Math.random() < GOLD_BALLOON_RATE) return goldBalloon;
  return normalBalloons[Math.floor(Math.random() * normalBalloons.length)];
}

function placeBalloon(player, balloon) {
  const width = player.side.clientWidth;
  const height = player.side.clientHeight;
  const maxX = Math.max(1, width - BALLOON_WIDTH - SIDE_MARGIN * 2);
  const maxY = Math.max(1, height - BALLOON_HEIGHT - TOP_MARGIN - 45);
  balloon.style.left = `${SIDE_MARGIN + Math.random() * maxX}px`;
  balloon.style.top = `${TOP_MARGIN + Math.random() * maxY}px`;
}

function createBalloon(player) {
  const data = chooseBalloonData();
  const balloon = document.createElement("img");
  balloon.className = "balloon";
  balloon.src = data.image;
  balloon.alt = "風船";
  balloon.dataset.points = String(data.points);
  placeBalloon(player, balloon);
  player.balloonArea.appendChild(balloon);
  player.balloons.push(balloon);
}

function setBalloonCount(player, count) {
  while (player.balloons.length < count) createBalloon(player);
  while (player.balloons.length > count) {
    const balloon = player.balloons.pop();
    balloon.remove();
  }
}

function removeAllBalloons() {
  players.forEach((player) => {
    player.balloons.forEach((balloon) => balloon.remove());
    player.balloons = [];
  });
}

function findHitBalloon(player) {
  for (let i = player.balloons.length - 1; i >= 0; i -= 1) {
    const balloon = player.balloons[i];
    const rect = balloon.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.30;
    const normalizedX = (player.screenX - centerX) / (rect.width * 0.38);
    const normalizedY = (player.screenY - centerY) / (rect.height * 0.40);
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
      return balloon;
    }
  }
  return null;
}

function showShotFlash(player) {
  player.flash.style.left = `${player.aimX * 100}%`;
  player.flash.style.top = `${player.aimY * 100}%`;
  player.flash.classList.remove("show");
  void player.flash.offsetWidth;
  player.flash.classList.add("show");
}

function shoot(player) {
  playSound(sounds.shot, 0.42);
  showShotFlash(player);
  const balloon = findHitBalloon(player);

  if (!balloon) {
    playSound(sounds.miss, 0.5);
    return;
  }

  playSound(sounds.hit, 0.68);
  const points = Number(balloon.dataset.points) || 1;
  player.score += points;
  player.scoreElement.textContent = String(player.score);
  player.scoreElement.classList.remove("bump");
  void player.scoreElement.offsetWidth;
  player.scoreElement.classList.add("bump");

  const rect = balloon.getBoundingClientRect();
  const sideRect = player.side.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "scorePopup";
  popup.textContent = `+${points}`;
  popup.style.left = `${rect.left - sideRect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top + rect.height * 0.3}px`;
  player.side.appendChild(popup);
  setTimeout(() => popup.remove(), 750);

  player.balloons = player.balloons.filter((item) => item !== balloon);
  balloon.classList.add("hit");
  balloon.style.transform = `translate(${(Math.random() - 0.5) * 360}px, -380px) rotate(${Math.random() * 700}deg) scale(0.3)`;

  setTimeout(() => {
    balloon.remove();
    if (gamePlaying) createBalloon(player);
  }, 480);
}

function showCountdownText(text) {
  return new Promise((resolve) => {
    countdown.textContent = text;
    setTimeout(() => {
      countdown.textContent = "";
      resolve();
    }, 700);
  });
}

async function startGame() {
  if (gamePlaying || countdownRunning) return;
  countdownRunning = true;
  extraBalloonAdded = false;
  resultOverlay.classList.remove("show");
  message.classList.remove("show");
  players.forEach((player) => {

    player.score = 0;
    player.scoreElement.textContent = "0";

    player.scoreBox.classList.remove("finalScore");

    const textNode = Array.from(player.scoreBox.childNodes).find(
        node => node.nodeType === Node.TEXT_NODE
    );

    if(textNode){
        textNode.textContent = "スコア ";
    }

});
    remainingTime = GAME_TIME;
  timeElement.textContent = String(remainingTime);
  timeElement.classList.remove("danger");
  removeAllBalloons();

  instruction.textContent = "じゅんびしてね！";
  await showCountdownText("3");
  await showCountdownText("2");
  await showCountdownText("1");
  await showCountdownText("GO!");

  gamePlaying = true;
  countdownRunning = false;
  instruction.textContent = "風船をねらって発射しよう！";

  players.forEach((player) =>
    setBalloonCount(player, START_BALLOON_COUNT_PER_SIDE)
  );

  gameTimer = setInterval(() => {
    remainingTime -= 1;
    timeElement.textContent = String(remainingTime);
    if (remainingTime <= 5) timeElement.classList.add("danger");

    if (!extraBalloonAdded && remainingTime <= ADD_BALLOON_AT_SECONDS) {
      extraBalloonAdded = true;
      players.forEach((player) =>
        setBalloonCount(player, LAST_BALLOON_COUNT_PER_SIDE)
      );
    }

    if (remainingTime <= 0) endGame();
  }, 1000);
}

async function endGame() {
  if (!gamePlaying) return;
  gamePlaying = false;
  clearInterval(gameTimer);
  gameTimer = null;
  playSound(sounds.clear, 0.72);
  removeAllBalloons();

  resultOverlay.classList.remove("show");
　message.classList.remove("show");
  players.forEach((player) => {

    player.scoreBox.classList.add("finalScore");

    const textNode = Array.from(player.scoreBox.childNodes).find(
        node => node.nodeType === Node.TEXT_NODE
    );

    if(textNode){
        textNode.textContent = "スコア ";
    }

});
    instruction.textContent = "もう一度遊ぶときは、ふたりともスタート！";
  await resetReadyFlags();
}

regenerateButton.addEventListener("click", () => {
  window.location.reload();
});

window.addEventListener("resize", () => {
  setTimeout(() => {
    players.forEach((player) =>
      player.balloons.forEach((balloon) => placeBalloon(player, balloon))
    );
  }, 50);
});

// QRと接続コードを最優先で表示する。
makeRooms();
showPageWarning();
updatePairingView();
updateScopePositions();
initializeFirebase();
