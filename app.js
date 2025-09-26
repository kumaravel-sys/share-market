// CONFIG - change these
const CONFIG = {
  // List of 9 real symbols (these are the actual symbols used to fetch financial info).
  // Replace with actual NSE/BSE symbols required by your API: e.g. "TCS.NS" or "TCS.BO" or "TCS" depending on API.
  symbols: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "LT", "ITC", "SBIN", "AXISBANK"],
  // Display names you can change via UI (initial)
  displayNames: ["Reliance", "TCS", "HDFC Bank", "Infosys", "ICICI Bank", "L&T", "ITC", "State Bank", "Axis Bank"],

  // API config - YOU MUST PROVIDE YOUR OWN KEY & ENDPOINT
  // Example placeholder for Alpha Vantage style:
  api: {
    // endpoint template: function(symbol, key) => url string
    // You MUST edit this to match whatever API you choose (Alpha Vantage, Finnhub, TwelveData, etc.)
    endpoint: (symbol, apikey) => `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apikey}`,
    apikey: "REPLACE_WITH_YOUR_API_KEY"
  },

  // polling interval ms for live refresh
  refreshInterval: 60_000 // 60s
};

// ---- Application state ----
let state = {
  names: [...CONFIG.displayNames],
  symbols: [...CONFIG.symbols],
  data: {}, // symbol => latest fetched info
  passwordHash: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd54a" // placeholder sha256("password") prefix (not real)
};

// ---- Utilities ----
function $(id){ return document.getElementById(id) }
function el(tag, attrs={}, ...children){
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k,v);
  });
  children.forEach(c => { if(typeof c==="string") e.appendChild(document.createTextNode(c)); else e.appendChild(c); });
  return e;
}

// Simple SHA-256 via SubtleCrypto for password check
async function sha256hex(message){
  const enc = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ---- Password lock ----
const lockScreen = $('lock-screen'), appEl = $('app'), unlockBtn = $('unlock-btn');
unlockBtn.addEventListener('click', async ()=>{
  const pw = $('password-input').value || "";
  // For demo: Accept if password equals "schoolpass" (hard-coded) OR matches stored hash.
  // Replace the logic with a server side check if you need real security.
  const h = await sha256hex(pw);
  // For demo we accept "schoolpass" or any password that matches stored hash.
  if(pw === "schoolpass" || h.startsWith(state.passwordHash)){
    lockScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    initApp();
  } else {
    $('lock-msg').textContent = "Wrong password — contact admin.";
  }
});

// ---- Render stock cards ----
function renderCards(){
  const grid = $('stocks-grid');
  grid.innerHTML = "";
  state.symbols.forEach((sym, i) => {
    const display = state.names[i] || sym;
    const card = el('div',{class:"card"});
    const row = el('div',{class:"row"},
      el('div',{}, el('div',{class:"stock-name"},display), el('div',{class:"stock-symbol muted"},sym)),
      el('div',{}, el('div',{class:"price"}, "—"), el('div',{class:"muted"}, "—"))
    );
    const canvas = el('canvas',{id:`chart-${i}`,height:60});
    card.appendChild(row);
    card.appendChild(canvas);
    // name small edit button
    grid.appendChild(card);
  });
}

// Chart holders
const charts = {};

// Fill price & build charts
function updateCardWithData(i, symbol, quote){
  const card = document.querySelectorAll('.card')[i];
  if(!card) return;
  // quote convention: { price: number, changePct: number, history: [numbers] }
  const priceEl = card.querySelector('.price');
  const changeEl = card.querySelector('.muted') || el('div',{class:'muted'});
  priceEl.textContent = quote.price!=null ? Number(quote.price).toFixed(2) : "—";
  changeEl.textContent = quote.changePct!=null ? `${quote.changePct >=0 ? '+' : ''}${quote.changePct.toFixed(2)}%` : "";
  if(quote.changePct >= 0) priceEl.classList.add('change-up'); else priceEl.classList.remove('change-up');
  if(quote.changePct < 0) priceEl.classList.add('change-down'); else priceEl.classList.remove('change-down');

  // chart
  const ctx = document.getElementById(`chart-${i}`);
  if(!ctx) return;
  if(charts[i]) {
    charts[i].data.datasets[0].data = quote.history || [quote.price];
    charts[i].update();
  } else {
    charts[i] = new Chart(ctx.getContext('2d'), {
      type:'line',
      data:{
        labels: (quote.history || [quote.price]).map((_,idx)=>idx+1),
        datasets:[{
          data: quote.history || [quote.price],
          borderColor: quote.changePct >= 0 ? '#00e676' : '#ff5252',
          backgroundColor: 'rgba(0,0,0,0)',
          tension: 0.35,
          borderWidth: 2,
          pointRadius:0
        }]
      },
      options:{
        animation:false,
        plugins:{legend:{display:false}},
        scales:{x:{display:false}, y:{display:false}},
        elements:{point:{radius:0}}
      }
    });
  }
}

// ---- Data fetching ----
// Generic fetch wrapper that tries the API then falls back to mock
async function fetchQuoteFor(symbol){
  const apiEndpoint = CONFIG.api.endpoint(symbol, CONFIG.api.apikey);
  try{
    if(!CONFIG.api.apikey || CONFIG.api.apikey.includes("REPLACE")) throw new Error("No API key configured");
    const res = await fetch(apiEndpoint);
    const json = await res.json();
    // Parse the response according to service. For AlphaVantage GLOBAL_QUOTE example:
    // { "Global Quote": { "01. symbol":"XYZ", "05. price":"123.45", "10. change percent":"+1.23%" } }
    if(json["Global Quote"]){
      const g = json["Global Quote"];
      const price = parseFloat(g["05. price"]);
      const changePctRaw = g["10. change percent"] || g["10. change percent"] || null;
      const changePct = changePctRaw ? parseFloat(changePctRaw.replace('%','')) : null;
      // No historic data from this endpoint — make a small fake history around price
      const history = Array.from({length:12}, (_,k)=> price * (1 + ((Math.random()-0.5)/50)));
      return { price, changePct, history };
    }

    // Attempt other common formats (example: {c:current, dp:percent})
    if(json.c || json.current){
      const price = json.c || json.current;
      const changePct = json.dp || json.dp;
      const history = json.historical?.map(h=>h.close) || [price];
      return { price, changePct, history };
    }

    // If none matched, throw to go to fallback
    throw new Error("Unexpected API format");
  }catch(err){
    // fallback mock data
    console.warn("Using mock data for", symbol, err.message);
    const base = 100 + Math.random()*200;
    const history = Array.from({length:12}, (_,k)=> Number((base*(1 + (Math.sin(k/3)/50) + (Math.random()-0.5)/100)).toFixed(2)));
    const price = history[history.length-1];
    const prev = history[history.length-2] || price;
    const changePct = ((price - prev)/prev)*100;
    return { price, changePct, history };
  }
}

async function refreshAll(){
  const promises = state.symbols.map(sym => fetchQuoteFor(sym));
  const results = await Promise.all(promises);
  results.forEach((q,i) => {
    state.data[state.symbols[i]] = q;
    updateCardWithData(i, state.symbols[i], q);
  });
}

// ---- Settings UI ----
function renderNamesEditor(){
  const container = $('names-edit');
  container.innerHTML = "";
  state.names.forEach((n,i) => {
    const input = el('input',{value:n, oninput: (e)=> {
      state.names[i] = e.target.value;
      // update UI card title immediately
      const nameEl = document.querySelectorAll('.stock-name')[i];
      if(nameEl) nameEl.textContent = state.names[i];
      // save to localStorage
      localStorage.setItem('displayNames', JSON.stringify(state.names));
    }});
    container.appendChild(input);
  });
}

// Reset names
$('reset-names').addEventListener('click', ()=>{
  state.names = [...CONFIG.displayNames];
  localStorage.removeItem('displayNames');
  renderNamesEditor();
  document.querySelectorAll('.stock-name').forEach((el,i)=> el.textContent = state.names[i]);
});

// Background color control
$('bg-color').addEventListener('input', (e)=>{
  document.documentElement.style.setProperty('--bg', e.target.value);
});

// Demat embed controls
$('open-demat').addEventListener('click', ()=>{
  const defaultUrl = $('demat-url').value || '';
  if(!defaultUrl) window.alert('Enter your demat site URL in the Demat section first.');
  else window.open(defaultUrl, '_blank');
});
$('open-demat-new').addEventListener('click', ()=>{
  const url = $('demat-url').value || '';
  if(url) window.open(url, '_blank');
});
$('embed-demat').addEventListener('click', ()=>{
  const url = $('demat-url').value || '';
  if(!url) return alert('Provide a demat site URL to embed');
  const wrap = $('demat-frame-wrap');
  const frame = $('demat-frame');
  frame.src = url;
  wrap.classList.remove('hidden');
});

// ---- Initialize App ----
function initApp(){
  // load saved custom names
  const saved = localStorage.getItem('displayNames');
  if(saved){
    try{ state.names = JSON.parse(saved) }catch(e){}
  }
  renderCards();
  renderNamesEditor();
  // initial fetch + polling
  refreshAll();
  setInterval(refreshAll, CONFIG.refreshInterval);
}
