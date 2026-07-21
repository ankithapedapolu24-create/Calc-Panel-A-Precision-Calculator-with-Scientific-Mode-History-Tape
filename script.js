/* =========================================================================
   CALC/PANEL — Calculator logic
   Sections:
   1. State
   2. Display helpers (formatting, rendering)
   3. Core arithmetic engine (digits, operators, equals, chaining)
   4. Percentage
   5. Scientific functions
   6. Memory functions
   7. History (paper tape)
   8. Button wiring + keyboard support
   9. Sound effects
   10. Theme + tape visibility toggles
   11. Copy result
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. STATE
   ------------------------------------------------------------------------- */
const state = {
  current: "0",        // string currently shown / being typed
  previous: null,       // number, left-hand operand
  operator: null,        // pending operator: + - * / ^
  waitingForNew: false,  // true right after an operator/equals/sci function
  lastOperator: null,    // for repeat-equals chaining (5 + 3 = = =)
  lastOperand: null,
  isError: false,
  memory: 0,
  hasMemory: false,
};

let expressionText = ""; // top row of the LCD
const history = [];       // { expr, result }

/* -------------------------------------------------------------------------
   2. DISPLAY HELPERS
   ------------------------------------------------------------------------- */
const resultEl = document.getElementById("result");
const expressionEl = document.getElementById("expression");
const memIndicator = document.getElementById("memIndicator");

// Insert thousands separators into the integer part only, preserve decimals as typed.
function formatForDisplay(str){
  if (str === "Error" || str === undefined || str === null) return "Error";
  let sign = "";
  let value = str;
  if (value.startsWith("-")){ sign = "-"; value = value.slice(1); }
  const [intPart, decPart] = value.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + withCommas + (decPart !== undefined ? "." + decPart : "");
}

// Round away floating-point noise (e.g. 0.1 + 0.2) and turn a number into a clean string.
function toDisplayString(num){
  if (!isFinite(num) || isNaN(num)) return "Error";
  const rounded = Math.round((num + Number.EPSILON) * 1e10) / 1e10;
  return rounded.toString();
}

function updateDisplay(){
  resultEl.textContent = formatForDisplay(state.current);
  resultEl.classList.toggle("error", state.current === "Error");
  expressionEl.innerHTML = expressionText || "&nbsp;";
  memIndicator.hidden = !state.hasMemory;
}

/* -------------------------------------------------------------------------
   3. CORE ARITHMETIC ENGINE
   ------------------------------------------------------------------------- */
const OP_SYMBOLS = { "+": "+", "-": "\u2212", "*": "\u00d7", "/": "\u00f7", "^": "^" };

function inputDigit(digit){
  if (state.isError) clearAll();

  if (state.waitingForNew){
    state.current = digit === "0" ? "0" : digit;
    state.waitingForNew = false;
  } else if (state.current === "0"){
    state.current = digit;
  } else {
    // Cap length so the LCD doesn't overflow into unreadable territory.
    if (state.current.replace("-", "").replace(".", "").length < 15){
      state.current += digit;
    }
  }
  updateDisplay();
}

function inputDecimal(){
  if (state.isError) clearAll();

  if (state.waitingForNew){
    state.current = "0.";
    state.waitingForNew = false;
  } else if (!state.current.includes(".")){
    // Prevent multiple decimal points.
    state.current += ".";
  }
  updateDisplay();
}

function backspace(){
  if (state.isError){ clearAll(); return; }
  if (state.waitingForNew) return; // nothing to erase from a just-committed value

  state.current = state.current.length > 1 ? state.current.slice(0, -1) : "0";
  updateDisplay();
}

function clearAll(){
  state.current = "0";
  state.previous = null;
  state.operator = null;
  state.waitingForNew = false;
  state.lastOperator = null;
  state.lastOperand = null;
  state.isError = false;
  expressionText = "";
  updateDisplay();
}

function chooseOperator(op){
  if (state.isError) return;

  if (state.operator !== null && !state.waitingForNew){
    // Chained calculation: resolve the pending operation before starting the next.
    runCompute();
  }

  state.previous = parseFloat(state.current);
  state.operator = op;
  state.waitingForNew = true;
  expressionText = `${formatForDisplay(trimTrailingDot(state.current))} ${OP_SYMBOLS[op]}`;
  updateDisplay();
}

function performCompute(a, b, op){
  switch (op){
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? Infinity : a / b;
    case "^": return Math.pow(a, b);
    default: return b;
  }
}

function runCompute(){
  if (state.operator === null || state.previous === null) return;

  const a = state.previous;
  const b = parseFloat(state.current);
  const op = state.operator;
  const rawResult = performCompute(a, b, op);

  const exprLabel = `${formatForDisplay(a.toString())} ${OP_SYMBOLS[op]} ${formatForDisplay(b.toString())}`;

  if (!isFinite(rawResult)){
    showError();
    addHistory(exprLabel + " =", "Error");
    return;
  }

  state.lastOperator = op;
  state.lastOperand = b;
  state.current = toDisplayString(rawResult);
  state.previous = null;
  state.operator = null;
  state.waitingForNew = true;
  expressionText = exprLabel + " =";

  addHistory(exprLabel, formatForDisplay(state.current));
  updateDisplay();
}

// The "=" button: normal compute, or repeats the last operation if pressed again.
function equalsPressed(){
  if (state.isError) return;

  if (state.operator !== null){
    runCompute();
  } else if (state.lastOperator !== null){
    state.previous = parseFloat(state.current);
    state.operator = state.lastOperator;
    state.current = toDisplayString(state.lastOperand);
    runCompute();
  }
}

function showError(){
  state.current = "Error";
  state.previous = null;
  state.operator = null;
  state.waitingForNew = true;
  state.isError = true;
  updateDisplay();
}

function trimTrailingDot(str){
  return str.endsWith(".") ? str.slice(0, -1) : str;
}

/* -------------------------------------------------------------------------
   4. PERCENTAGE
   ------------------------------------------------------------------------- */
function applyPercent(){
  if (state.isError) return;
  const current = parseFloat(state.current);

  if (state.operator !== null && state.previous !== null){
    // e.g. 200 + 10%  ->  10% of 200 = 20, so 200 + 20
    state.current = toDisplayString(state.previous * (current / 100));
  } else {
    state.current = toDisplayString(current / 100);
  }
  state.waitingForNew = true;
  updateDisplay();
}

/* -------------------------------------------------------------------------
   5. SCIENTIFIC FUNCTIONS
   ------------------------------------------------------------------------- */
function applySciFunction(name){
  if (state.isError) clearAll();
  const x = parseFloat(state.current);
  let result, label;

  switch (name){
    case "sin": result = Math.sin(x * Math.PI / 180); label = `sin(${formatForDisplay(state.current)})`; break;
    case "cos": result = Math.cos(x * Math.PI / 180); label = `cos(${formatForDisplay(state.current)})`; break;
    case "tan": result = Math.tan(x * Math.PI / 180); label = `tan(${formatForDisplay(state.current)})`; break;
    case "log":
      if (x <= 0){ showError(); addHistory(`log(${x})`, "Error"); return; }
      result = Math.log10(x); label = `log(${formatForDisplay(state.current)})`;
      break;
    case "sqrt":
      if (x < 0){ showError(); addHistory(`\u221a(${x})`, "Error"); return; }
      result = Math.sqrt(x); label = `\u221a(${formatForDisplay(state.current)})`;
      break;
    case "square": result = x * x; label = `(${formatForDisplay(state.current)})\u00b2`; break;
    case "pi": result = Math.PI; label = "\u03c0"; break;
    default: return;
  }

  state.current = toDisplayString(result);
  expressionText = `${label} =`;
  state.waitingForNew = true;
  addHistory(label, formatForDisplay(state.current));
  updateDisplay();
}

/* -------------------------------------------------------------------------
   6. MEMORY FUNCTIONS
   ------------------------------------------------------------------------- */
function memoryAction(action){
  const current = parseFloat(state.current) || 0;

  switch (action){
    case "mc":
      state.memory = 0;
      state.hasMemory = false;
      break;
    case "mr":
      state.current = toDisplayString(state.memory);
      state.waitingForNew = true;
      break;
    case "m-plus":
      state.memory += current;
      state.hasMemory = true;
      break;
    case "m-minus":
      state.memory -= current;
      state.hasMemory = true;
      break;
  }
  updateDisplay();
}

/* -------------------------------------------------------------------------
   7. HISTORY (PAPER TAPE)
   ------------------------------------------------------------------------- */
const tapeFeed = document.getElementById("tapeFeed");
const tapeEmpty = document.getElementById("tapeEmpty");

function addHistory(expr, result){
  history.unshift({ expr, result });
  if (history.length > 50) history.pop();
  renderHistory();
}

function renderHistory(){
  tapeFeed.innerHTML = "";

  if (history.length === 0){
    tapeFeed.appendChild(tapeEmpty);
    return;
  }

  history.forEach(entry => {
    const item = document.createElement("div");
    item.className = "tape-entry";
    item.innerHTML = `
      <span class="entry-expr">${entry.expr}</span>
      <span class="entry-result">${entry.result}</span>
    `;
    item.addEventListener("click", () => {
      state.current = String(parseFloat(entry.result.replace(/,/g, "")) || 0);
      state.waitingForNew = true;
      expressionText = "";
      updateDisplay();
    });
    tapeFeed.appendChild(item);
  });
}

document.getElementById("clearHistory").addEventListener("click", () => {
  history.length = 0;
  renderHistory();
});

/* -------------------------------------------------------------------------
   8. BUTTON WIRING + KEYBOARD SUPPORT
   ------------------------------------------------------------------------- */
function pressEffect(btn){
  btn.classList.remove("pressed");
  void btn.offsetWidth;
  btn.classList.add("pressed");
}

document.querySelectorAll("[data-num]").forEach(btn => {
  btn.addEventListener("click", () => { inputDigit(btn.dataset.num); pressEffect(btn); playClick(); });
});

document.querySelectorAll("[data-op]").forEach(btn => {
  btn.addEventListener("click", () => {
    const op = btn.dataset.op;
    if (op === "%") applyPercent(); else chooseOperator(op);
    pressEffect(btn);
    playClick();
  });
});

document.querySelectorAll("[data-sci]").forEach(btn => {
  btn.addEventListener("click", () => { applySciFunction(btn.dataset.sci); pressEffect(btn); playClick(); });
});

document.querySelectorAll("[data-mem]").forEach(btn => {
  btn.addEventListener("click", () => { memoryAction(btn.dataset.mem); pressEffect(btn); playClick(); });
});

document.querySelectorAll("[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "clear") clearAll();
    else if (action === "backspace") backspace();
    else if (action === "decimal") inputDecimal();
    else if (action === "equals") equalsPressed();
    pressEffect(btn);
    playClick();
  });
});

// Mode switch: Standard <-> Scientific
const sciGrid = document.getElementById("sciGrid");
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    sciGrid.hidden = btn.dataset.mode !== "scientific";
  });
});

// Keyboard support
document.addEventListener("keydown", (e) => {
  if (e.key >= "0" && e.key <= "9"){ inputDigit(e.key); return; }

  switch (e.key){
    case ".": inputDecimal(); break;
    case "+": chooseOperator("+"); break;
    case "-": chooseOperator("-"); break;
    case "*": chooseOperator("*"); break;
    case "/": e.preventDefault(); chooseOperator("/"); break;
    case "%": applyPercent(); break;
    case "Enter":
    case "=": e.preventDefault(); equalsPressed(); break;
    case "Backspace": backspace(); break;
    case "Escape": clearAll(); break;
    default: return;
  }
});

/* -------------------------------------------------------------------------
   9. SOUND EFFECTS (synthesized — no audio files needed)
   ------------------------------------------------------------------------- */
let soundOn = true;
let audioCtx = null;

function playClick(){
  if (!soundOn) return;
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 620;
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.06);
  } catch (err){ /* Web Audio unavailable — fail silently */ }
}

const soundToggle = document.getElementById("soundToggle");
soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  soundToggle.setAttribute("aria-pressed", String(soundOn));
});

/* -------------------------------------------------------------------------
   10. THEME + TAPE VISIBILITY TOGGLES
   ------------------------------------------------------------------------- */
document.getElementById("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("light");
});

const tape = document.getElementById("tape");
const historyToggle = document.getElementById("historyToggle");
let tapeVisible = true;

historyToggle.addEventListener("click", () => {
  tapeVisible = !tapeVisible;
  tape.style.display = tapeVisible ? "" : "none";
  historyToggle.setAttribute("aria-pressed", String(tapeVisible));
  historyToggle.classList.toggle("active-state", tapeVisible);
});
historyToggle.classList.add("active-state");
historyToggle.setAttribute("aria-pressed", "true");

/* -------------------------------------------------------------------------
   11. COPY RESULT
   ------------------------------------------------------------------------- */
const copyBtn = document.getElementById("copyBtn");

copyBtn.addEventListener("click", async () => {
  const value = state.current;
  try{
    await navigator.clipboard.writeText(value);
  } catch (err){
    // Fallback for browsers/contexts without Clipboard API access.
    const temp = document.createElement("textarea");
    temp.value = value;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
  }
  copyBtn.classList.add("copied");
  setTimeout(() => copyBtn.classList.remove("copied"), 900);
});

/* -------------------------------------------------------------------------
   INIT
   ------------------------------------------------------------------------- */
updateDisplay();
