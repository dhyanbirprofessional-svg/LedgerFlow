/* LedgerFlow — Complete Offline-First Personal Finance & Expense Tracker Engine */
(function () {
  "use strict";

  const CURRENCIES = {
    INR: { symbol: "₹", name: "Indian Rupee", rateToUSD: 0.0119 },
    USD: { symbol: "$", name: "US Dollar", rateToUSD: 1.0 },
    EUR: { symbol: "€", name: "Euro", rateToUSD: 1.08 },
    GBP: { symbol: "£", name: "British Pound", rateToUSD: 1.27 },
    JPY: { symbol: "¥", name: "Japanese Yen", rateToUSD: 0.0065 },
    AED: { symbol: "د.إ", name: "UAE Dirham", rateToUSD: 0.272 },
    CAD: { symbol: "C$", name: "Canadian Dollar", rateToUSD: 0.72 },
    AUD: { symbol: "A$", name: "Australian Dollar", rateToUSD: 0.65 },
    SGD: { symbol: "S$", name: "Singapore Dollar", rateToUSD: 0.74 }
  };

  const DEFAULT_CATEGORIES = [
    { id: "food", name: "Food & Dining", icon: "🍽️", color: "#f97316", type: "expense", costNature: "variable" },
    { id: "groceries", name: "Groceries", icon: "🛒", color: "#10b981", type: "expense", costNature: "variable" },
    { id: "transport", name: "Transport & Fuel", icon: "🚗", color: "#0ea5e9", type: "expense", costNature: "variable" },
    { id: "housing", name: "Rent & Housing", icon: "🏠", color: "#6366f1", type: "expense", costNature: "fixed" },
    { id: "utilities", name: "Utilities & Internet", icon: "⚡", color: "#eab308", type: "expense", costNature: "fixed" },
    { id: "emi_loan", name: "Loans & EMIs", icon: "🏦", color: "#dc2626", type: "expense", costNature: "fixed" },
    { id: "sip_invest", name: "Investments & SIP", icon: "📊", color: "#0284c7", type: "expense", costNature: "fixed" },
    { id: "subscriptions", name: "Subscriptions", icon: "🔄", color: "#8b5cf6", type: "expense", costNature: "fixed" },
    { id: "bank_fees", name: "Bank Charges & Fees", icon: "🧾", color: "#64748b", type: "expense", costNature: "fixed" },
    { id: "shopping", name: "Shopping", icon: "🛍️", color: "#ec4899", type: "expense", costNature: "variable" },
    { id: "health", name: "Health & Fitness", icon: "💊", color: "#14b8a6", type: "expense", costNature: "variable" },
    { id: "travel", name: "Travel", icon: "✈️", color: "#3b82f6", type: "expense", costNature: "variable" },
    { id: "entertainment", name: "Entertainment", icon: "🎬", color: "#f43f5e", type: "expense", costNature: "variable" },
    { id: "education", name: "Education & Books", icon: "📚", color: "#06b6d4", type: "expense", costNature: "variable" },
    { id: "personal_transfer", name: "People & Transfers Out", icon: "🤝", color: "#a855f7", type: "expense", costNature: "variable" },
    { id: "other_exp", name: "Other Expense", icon: "📦", color: "#64748b", type: "expense", costNature: "variable" },
    { id: "salary", name: "Salary & Payroll", icon: "💼", color: "#10b981", type: "income" },
    { id: "freelance", name: "Freelance & Consulting", icon: "💻", color: "#4f46e5", type: "income" },
    { id: "investments", name: "Dividends & Interest", icon: "📈", color: "#0ea5e9", type: "income" },
    { id: "refund", name: "Refunds & Cashback", icon: "🎁", color: "#f59e0b", type: "income" },
    { id: "transfer", name: "Account Transfer", icon: "⇄", color: "#64748b", type: "transfer" }
  ];

  const URL_PARAMS = new URLSearchParams(window.location.search);
  const API_TOKEN = URL_PARAMS.get("token") || "";
  const IS_PREVIEW_PARAM = URL_PARAMS.get("preview") === "1";
  const APP_VERSION = "1.0.9";
  const GITHUB_REPO = "dhyanbirprofessional-svg/LedgerFlow";

  let isDesktopHost = false;
  let isAndroidHost = Boolean(window.LedgerFlowAndroid) || window.location.hostname === "ledgerflow.local";
  let latestUpdateInfo = null;
  let updateBannerDismissed = false;
  let currentView = "overview";
  let currentPeriod = "this_month";
  let customPeriodStart = "";
  let customPeriodEnd = "";
  let selectedMonthKey = "";
  let monthlyTierFilter = "all";
  let selectedLedgerId = "bank_all";
  let ledgerSubView = "bank"; // "bank" | "directory"
  let ledgerAccountFilter = "all";
  let ledgerMobileSide = "dr";
  let ledgerLineSearch = "";
  let ledgerDirSearch = "";
  let ledgerDirType = "all";
  let drawingsExpanded = false;
  let audioCtxInstance = null;
  let selectedTxIds = new Set();
  let csvParsedState = null;
  let pendingUploadFile = null; // { file, dataUrl }
  let pendingExportOnly = false;
  let pendingReceiptData = null; // { id, name, dataUrl }
  let splitLinesDraft = [];

  const txFilters = {
    search: "",
    type: "all",
    category: "all",
    account: "all",
    ledger: "all",
    dateFrom: "",
    dateTo: "",
    taxOnly: false,
    sort: "date_desc"
  };

  let state = null;

  /* ---------- Utilities ---------- */
  function uid(prefix = "id") {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function dateTimeLocalNow(offsetDays = 0, hour = null) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    if (hour !== null) d.setHours(hour, 15, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function convertToBase(amount, fromCurrency) {
    const base = state.settings.currency || "INR";
    if (!fromCurrency || fromCurrency === base) return Number(amount) || 0;
    const rates = state.settings.fxRates || {};
    const fromUSD = rates[fromCurrency] ?? CURRENCIES[fromCurrency]?.rateToUSD ?? 1;
    const baseUSD = rates[base] ?? CURRENCIES[base]?.rateToUSD ?? 1;
    return (Number(amount) || 0) * (fromUSD / baseUSD);
  }

  function fmtMoney(amount, currencyOverride = null, showSign = false) {
    const cur = currencyOverride || state.settings.currency || "INR";
    const sym = CURRENCIES[cur]?.symbol || cur + " ";
    const num = Number(amount) || 0;
    const abs = Math.abs(num);
    const locale = cur === "INR" ? "en-IN" : "en-US";
    const formatted = abs.toLocaleString(locale, { minimumFractionDigits: abs % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
    const sign = num < 0 ? "-" : (showSign && num > 0 ? "+" : "");
    return `${sign}${sym}${formatted}`;
  }

  function fmtShortDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function getCat(id) {
    return (state.categories || DEFAULT_CATEGORIES).find((c) => c.id === id) || {
      id: "other_exp", name: "Uncategorized", icon: "📦", color: "#64748b", type: "expense"
    };
  }

  function getAcc(id) {
    return (state.accounts || []).find((a) => a.id === id) || { id: "", name: "Unknown Account", type: "bank", initialBalance: 0 };
  }

  function toast(msg) {
    const box = document.getElementById("toast-container");
    if (!box) return;
    const raw = String(msg || "").trim();
    const shortMsg = raw.length > 220 ? raw.slice(0, 217) + "…" : raw;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = shortMsg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const androidAsyncWaiters = new Map();
  let androidAsyncSeq = 1;
  window.__lfAndroidAsyncResolve = function (cbId, payloadJson) {
    const fn = androidAsyncWaiters.get(cbId);
    if (!fn) return;
    androidAsyncWaiters.delete(cbId);
    fn(payloadJson);
  };

  function yieldToUi() {
    return new Promise((r) => setTimeout(r, 0));
  }

  let pdfProgressTimer = null;
  let pdfProgressStartedAt = 0;

  function updatePdfProgressPhases(activePhase) {
    const order = ["indexing", "decoding", "reading", "building"];
    const phaseMap = {
      starting: 0, queued: 0, indexing: 0,
      decoding: 1,
      reading: 2,
      building: 3, align: 3, done: 4
    };
    const activeIdx = Object.prototype.hasOwnProperty.call(phaseMap, activePhase) ? phaseMap[activePhase] : -1;
    const container = document.getElementById("pdf-progress-phases");
    if (!container) return;
    container.classList.toggle("hidden", activeIdx < 0);
    if (activeIdx < 0) return;
    container.querySelectorAll("[data-phase-step]").forEach((el) => {
      const idx = order.indexOf(el.dataset.phaseStep);
      el.classList.toggle("done", idx >= 0 && idx < activeIdx);
      el.classList.toggle("active", idx === activeIdx);
    });
  }

  function showPdfProgress(title = "Reading PDF Statement...", sub = "Preparing file...", opts = {}) {
    const modal = document.getElementById("pdf-progress-modal");
    if (!modal) return;
    const tEl = document.getElementById("pdf-progress-title");
    const sEl = document.getElementById("pdf-progress-sub");
    const elEl = document.getElementById("pdf-progress-elapsed");
    if (tEl) tEl.textContent = title;
    if (sEl) sEl.textContent = sub;
    if (pdfProgressTimer) { clearInterval(pdfProgressTimer); pdfProgressTimer = null; }
    pdfProgressStartedAt = Date.now();
    if (elEl) elEl.textContent = "0.0s";
    pdfProgressTimer = setInterval(() => {
      const e = document.getElementById("pdf-progress-elapsed");
      if (e) e.textContent = ((Date.now() - pdfProgressStartedAt) / 1000).toFixed(1) + "s";
    }, 200);
    updatePdfProgress({
      phase: opts.phase || (/pdf/i.test(title) ? "indexing" : ""),
      percent: typeof opts.percent === "number" ? opts.percent : 6,
      stats: opts.stats || "Starting...",
      feed: Array.isArray(opts.feed) ? opts.feed : []
    });
    modal.classList.remove("hidden");
  }

  function updatePdfProgress(subOrOpts, title = null) {
    const tEl = document.getElementById("pdf-progress-title");
    const sEl = document.getElementById("pdf-progress-sub");
    const pctEl = document.getElementById("pdf-progress-pct");
    const fillEl = document.getElementById("pdf-progress-fill");
    const statsEl = document.getElementById("pdf-progress-stats");
    const feedEl = document.getElementById("pdf-progress-feed");
    const opts = (subOrOpts && typeof subOrOpts === "object") ? subOrOpts : { sub: subOrOpts };
    const nextTitle = title !== null ? title : opts.title;
    if (nextTitle !== undefined && nextTitle !== null && tEl) tEl.textContent = nextTitle;
    if (opts.sub !== undefined && opts.sub !== null && sEl) sEl.textContent = opts.sub;
    if (opts.phase !== undefined) updatePdfProgressPhases(opts.phase);
    if (typeof opts.percent === "number") {
      const p = Math.max(0, Math.min(100, Math.round(opts.percent)));
      if (pctEl) pctEl.textContent = p + "%";
      if (fillEl) fillEl.style.width = p + "%";
    }
    if (opts.stats !== undefined && statsEl) statsEl.textContent = opts.stats;
    if (Array.isArray(opts.feed) && feedEl) {
      if (opts.feed.length === 0) {
        feedEl.classList.add("hidden");
        feedEl.innerHTML = "";
      } else {
        feedEl.classList.remove("hidden");
        feedEl.innerHTML = opts.feed.slice(-6).map((item) =>
          `<div class="lf-progress-feed-row"><span class="lf-progress-feed-dot"></span><span>${esc(String(item || ""))}</span></div>`
        ).join("");
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    }
  }

  function hidePdfProgress() {
    if (pdfProgressTimer) { clearInterval(pdfProgressTimer); pdfProgressTimer = null; }
    const modal = document.getElementById("pdf-progress-modal");
    if (modal) modal.classList.add("hidden");
  }

  function showFullUpdateOverlay({ title = "Installing Update...", sub = "Downloading package...", percent = 25, readyToRestart = false, onRestart = null } = {}) {
    const ov = document.getElementById("full-update-overlay");
    if (!ov) return;
    const sp = document.getElementById("full-upd-spinner");
    const ic = document.getElementById("full-upd-icon");
    const tEl = document.getElementById("full-upd-title");
    const sEl = document.getElementById("full-upd-sub");
    const fEl = document.getElementById("full-upd-fill");
    const btn = document.getElementById("full-upd-restart-btn");
    if (tEl) tEl.textContent = title;
    if (sEl) sEl.textContent = sub;
    if (fEl) fEl.style.width = Math.max(0, Math.min(100, Math.round(percent))) + "%";
    if (sp) sp.classList.toggle("hidden", !!readyToRestart);
    if (ic) ic.classList.toggle("hidden", !readyToRestart);
    if (btn) {
      btn.classList.toggle("hidden", !readyToRestart);
      btn.onclick = typeof onRestart === "function" ? onRestart : null;
    }
    ov.classList.remove("hidden");
  }

  function hideFullUpdateOverlay() {
    const ov = document.getElementById("full-update-overlay");
    if (ov) ov.classList.add("hidden");
  }

  function isGeminiConnected() {
    const cfg = state.settings?.aiConfig || {};
    return cfg.provider === "gemini" && cfg.mode !== "local" && String(cfg.apiKey || "").trim().length >= 10;
  }

  function openQuickGeminiConnectModal(onConnected = null) {
    const cfg = state.settings.aiConfig || {};
    openSubModal("Connect Free Google Gemini Key", `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="info-banner text-sm">
          <strong>PDF Statement Verifier:</strong> Gemini is used <strong>only</strong> to analyze &amp; verify PDF bank statements before pushing entries into your ledger (not as a chatbot).
        </div>
        <div class="text-xs muted">
          1. Click <strong>Get Free Gemini Key</strong> below to open Google AI Studio (100% free, no credit card).<br/>
          2. Create an API key, copy it, and paste it below.
        </div>
        <div>
          <a class="btn btn-secondary btn-sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get Free Gemini Key &nearr;</a>
        </div>
        <div class="field">
          <label>Gemini API Key (stored locally in your vault)</label>
          <div class="input-group">
            <input id="quick-gemini-key-input" type="password" placeholder="AIza..." value="${esc(cfg.apiKey || "")}" autocomplete="off" />
            <button type="button" class="btn btn-secondary btn-sm" id="quick-gemini-key-toggle">Show</button>
          </div>
        </div>
        <div id="quick-gemini-status" class="text-xs muted"></div>
        <div class="modal-footer" style="margin-top:4px;padding-top:10px;">
          <button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="quick-gemini-save-btn">Save &amp; Connect Gemini</button>
        </div>
      </div>
    `);

    const inp = document.getElementById("quick-gemini-key-input");
    const tog = document.getElementById("quick-gemini-key-toggle");
    const saveBtn = document.getElementById("quick-gemini-save-btn");
    const statusEl = document.getElementById("quick-gemini-status");
    if (tog && inp) {
      tog.onclick = () => {
        inp.type = inp.type === "password" ? "text" : "password";
        tog.textContent = inp.type === "password" ? "Show" : "Hide";
      };
    }
    if (inp) setTimeout(() => inp.focus(), 40);
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const key = String(inp?.value || "").trim();
        if (key.length < 10) {
          if (statusEl) { statusEl.textContent = "Please paste a valid Gemini API key."; statusEl.style.color = "var(--rose)"; }
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = "Verifying…";
        if (statusEl) { statusEl.textContent = "Testing connection to Google Gemini…"; statusEl.style.color = "var(--muted)"; }
        const nextCfg = Object.assign({}, state.settings.aiConfig || {}, {
          provider: "gemini",
          mode: (state.settings.aiConfig?.mode === "local" || !state.settings.aiConfig?.mode) ? "hybrid" : state.settings.aiConfig.mode,
          apiKey: key
        });
        try {
          const gRes = await callGeminiWithFallback({
            contents: [{ role: "user", parts: [{ text: "Reply OK" }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8 }
          }, nextCfg);
          state.settings.aiConfig = nextCfg;
          await saveState();
          closeModal("sub-modal");
          toast(`✓ Gemini connected (${gRes.model}).`);
          if (typeof onConnected === "function") onConnected();
          else renderCurrentView();
        } catch (err) {
          if (statusEl) { statusEl.textContent = "Connection error: " + (err?.message || "Failed"); statusEl.style.color = "var(--rose)"; }
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save & Connect Gemini";
        }
      };
    }
  }

  function callAndroidAsync(methodName, args, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const bridge = window.LedgerFlowAndroid;
      if (!bridge || typeof bridge[methodName] !== "function") {
        return reject(new Error("Android bridge method missing: " + methodName));
      }
      const cbId = "cb_" + (androidAsyncSeq++);
      const tid = setTimeout(() => {
        if (androidAsyncWaiters.has(cbId)) {
          androidAsyncWaiters.delete(cbId);
          reject(new Error("Android request timed out."));
        }
      }, timeoutMs);
      androidAsyncWaiters.set(cbId, (jsonStr) => {
        clearTimeout(tid);
        resolve(jsonStr);
      });
      try {
        bridge[methodName](cbId, ...args);
      } catch (err) {
        clearTimeout(tid);
        androidAsyncWaiters.delete(cbId);
        reject(err);
      }
    });
  }

  async function sha256(text) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const data = new TextEncoder().encode(text);
        const hash = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (_) {}
    }
    // Deterministic fallback hash when WebCrypto subtle is unavailable in sandboxed previews
    let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
      h1 ^= text.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= text.charCodeAt(i) + i;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
    return ((h1 >>> 0).toString(16).padStart(8, "0")) + ((h2 >>> 0).toString(16).padStart(8, "0"));
  }

  /* ---------- Clean Blank Initial Vault ---------- */
  const DEFAULT_GEMINI_API_KEY = "";

  function createBlankState(preserveSettings = null) {
    const baseSettings = {
      currency: preserveSettings?.currency || "INR",
      theme: preserveSettings?.theme || "light",
      privacyMode: !!preserveSettings?.privacyMode,
      monthlyOverallCap: 0,
      pinHash: preserveSettings?.pinHash || "",
      pinDisabledByUser: preserveSettings?.pinDisabledByUser !== false,
      biometricLock: !!preserveSettings?.biometricLock,
      pettyExpenseMax: preserveSettings?.pettyExpenseMax || 200,
      bigExpenseMin: preserveSettings?.bigExpenseMin || 2500,
      fxRates: preserveSettings?.fxRates || { INR: 0.0119, USD: 1.0, EUR: 1.08, GBP: 1.27, JPY: 0.0065, AED: 0.272, CAD: 0.72, AUD: 0.65, SGD: 0.74 },
      aiConfig: preserveSettings?.aiConfig
        ? { ...preserveSettings.aiConfig }
        : {
            mode: "hybrid",
            provider: DEFAULT_GEMINI_API_KEY ? "gemini" : "none",
            apiKey: DEFAULT_GEMINI_API_KEY,
            endpoint: "",
            model: "",
            customPrompt: ""
          },
      aiMemory: preserveSettings?.aiMemory ? { ...preserveSettings.aiMemory } : {}
    };
    return {
      version: 1,
      settings: baseSettings,
      categories: DEFAULT_CATEGORIES,
      accounts: [
        { id: "acc_main", name: "Primary Account", type: "bank", currency: baseSettings.currency, initialBalance: 0, creditLimit: 0, color: "#4f46e5" }
      ],
      transactions: [],
      budgets: [],
      recurring: [],
      goals: [],
      ious: [],
      rules: [],
      ledgers: [],
      importLogs: [],
      receiptsMeta: {}
    };
  }

  function ensureStateDefaults() {
    if (!state.settings) state.settings = {};
    if (!state.settings.currency) state.settings.currency = "INR";
    if (!state.settings.pettyExpenseMax) state.settings.pettyExpenseMax = 200;
    if (!state.settings.bigExpenseMin) state.settings.bigExpenseMin = 2500;
    if (!state.settings.aiConfig) {
      state.settings.aiConfig = {
        mode: "hybrid",
        provider: DEFAULT_GEMINI_API_KEY ? "gemini" : "none",
        apiKey: DEFAULT_GEMINI_API_KEY,
        endpoint: "",
        model: "",
        customPrompt: ""
      };
    } else if (DEFAULT_GEMINI_API_KEY && !state.settings.aiConfig.apiKey) {
      state.settings.aiConfig.apiKey = DEFAULT_GEMINI_API_KEY;
      if (!state.settings.aiConfig.provider || state.settings.aiConfig.provider === "none") {
        state.settings.aiConfig.provider = "gemini";
      }
    }
    if (!state.settings.aiMemory) state.settings.aiMemory = {};
    if (!state.settings.drawingsRule) {
      state.settings.drawingsRule = { enabled: false, min: 1, max: 500, side: "debits" };
    }
    if (typeof state.settings.mobileSound !== "boolean") state.settings.mobileSound = true;
    if (typeof state.settings.mobileAnimations !== "boolean") state.settings.mobileAnimations = true;
    if (!state.ledgers) state.ledgers = [];
    if (!state.ledgers.some((l) => l.id === "led_drawings" || l.type === "drawings")) {
      state.ledgers.unshift({
        id: "led_drawings",
        name: "Drawings (Self / Personal)",
        type: "drawings",
        color: "#f59e0b",
        notes: "Cash withdrawals, self transfers & personal drawings"
      });
    }
    if (!state.categories) state.categories = [];
    const existingIds = new Set(state.categories.map((c) => c.id));
    for (const def of DEFAULT_CATEGORIES) {
      if (!existingIds.has(def.id)) {
        state.categories.push({ ...def });
      } else {
        const cur = state.categories.find((c) => c.id === def.id);
        if (cur && !cur.costNature && def.costNature) cur.costNature = def.costNature;
      }
    }
    if (!state.transactions) state.transactions = [];
    if (!Array.isArray(state.importLogs)) state.importLogs = [];
    if (!state.accounts || !state.accounts.length) {
      state.accounts = [{ id: "acc_main", name: "Primary Account", type: "bank", currency: state.settings.currency, initialBalance: 0, creditLimit: 0, color: "#4f46e5" }];
    }
  }

  /* ---------- Optional Demo Data (Only if user clicks Load Sample in Settings) ---------- */
  function createDemoData() {
    const accounts = [
      { id: "acc_bank", name: "HDFC Savings Primary", type: "bank", currency: "INR", initialBalance: 185000, creditLimit: 0, color: "#4f46e5" },
      { id: "acc_cc", name: "Sapphire Rewards Card", type: "credit", currency: "INR", initialBalance: -12400, creditLimit: 250000, color: "#ec4899" },
      { id: "acc_cash", name: "Cash Wallet", type: "cash", currency: "INR", initialBalance: 6500, creditLimit: 0, color: "#10b981" },
      { id: "acc_sav", name: "Emergency High-Yield Vault", type: "savings", currency: "INR", initialBalance: 320000, creditLimit: 0, color: "#0ea5e9" }
    ];

    const transactions = [
      { id: "t1", type: "income", amount: 118000, currency: "INR", baseAmount: 118000, date: dateTimeLocalNow(-24, 10), payee: "TechCorp Monthly Salary", category: "salary", accountId: "acc_bank", method: "Bank Transfer", tags: ["payroll"], notes: "Monthly direct deposit", taxDeductible: false, reconciled: true },
      { id: "t2", type: "expense", amount: 24500, currency: "INR", baseAmount: 24500, date: dateTimeLocalNow(-22, 9), payee: "Skyline Apartments Rent", category: "housing", accountId: "acc_bank", method: "Bank Transfer", tags: ["fixed"], notes: "Monthly lease", taxDeductible: false, reconciled: true },
      { id: "t3", type: "expense", amount: 4280, currency: "INR", baseAmount: 4280, date: dateTimeLocalNow(-19, 18), payee: "Nature's Basket Fresh", category: "groceries", accountId: "acc_cc", method: "Card", tags: ["home"], notes: "Weekly produce & pantry", taxDeductible: false, reconciled: true, splits: [{ category: "groceries", amount: 3480, note: "Produce" }, { category: "shopping", amount: 800, note: "Kitchen supplies" }] },
      { id: "t4", type: "expense", amount: 1499, currency: "INR", baseAmount: 1499, date: dateTimeLocalNow(-17, 11), payee: "FiberNet Gigabit Broadband", category: "utilities", accountId: "acc_bank", method: "Auto-Debit", tags: ["wfh", "internet"], notes: "Home + work internet", taxDeductible: true, reconciled: true },
      { id: "t5", type: "expense", amount: 24, currency: "USD", baseAmount: convertStatic(24, "USD", "INR"), date: dateTimeLocalNow(-14, 15), payee: "Cloud Workspace Pro", category: "subscriptions", accountId: "acc_cc", method: "Card", tags: ["software", "work"], notes: "Foreign currency SaaS billing", taxDeductible: true, reconciled: true },
      { id: "t6", type: "expense", amount: 2150, currency: "INR", baseAmount: 2150, date: dateTimeLocalNow(-11, 20), payee: "Blue Tokai & Bistro", category: "food", accountId: "acc_cc", method: "UPI", tags: ["dining"], notes: "Dinner with friends", taxDeductible: false, reconciled: true },
      { id: "t7", type: "income", amount: 22500, currency: "INR", baseAmount: 22500, date: dateTimeLocalNow(-9, 14), payee: "UI Consulting Sprint", category: "freelance", accountId: "acc_bank", method: "Bank Transfer", tags: ["client"], notes: "Design system audit", taxDeductible: false, reconciled: true },
      { id: "t8", type: "expense", amount: 3400, currency: "INR", baseAmount: 3400, date: dateTimeLocalNow(-7, 17), payee: "Shell Fuel Station", category: "transport", accountId: "acc_cc", method: "Card", tags: ["commute"], notes: "Full tank", taxDeductible: false, reconciled: true },
      { id: "t9", type: "transfer", amount: 20000, currency: "INR", baseAmount: 20000, date: dateTimeLocalNow(-5, 12), payee: "Transfer to Emergency Vault", category: "transfer", accountId: "acc_bank", toAccountId: "acc_sav", method: "Bank Transfer", tags: ["savings"], notes: "Monthly automated sweep", taxDeductible: false, reconciled: true },
      { id: "t10", type: "expense", amount: 1850, currency: "INR", baseAmount: 1850, date: dateTimeLocalNow(-3, 19), payee: "CultFit Wellness Membership", category: "health", accountId: "acc_cc", method: "Auto-Debit", tags: ["fitness"], notes: "Gym monthly pass", taxDeductible: false, reconciled: true },
      { id: "t11", type: "expense", amount: 960, currency: "INR", baseAmount: 960, date: dateTimeLocalNow(-1, 13), payee: "Local Farmers Market", category: "groceries", accountId: "acc_cash", method: "Cash", tags: ["fresh"], notes: "Cash purchase", taxDeductible: false, reconciled: true },
      { id: "t12", type: "expense", amount: 3890, currency: "INR", baseAmount: 3890, date: dateTimeLocalNow(0, 10), payee: "Uniqlo Essentials", category: "shopping", accountId: "acc_cc", method: "Card", tags: ["apparel"], notes: "Work shirts", taxDeductible: false, reconciled: true },
      // Previous months for rich trends
      { id: "t_m1_1", type: "income", amount: 118000, currency: "INR", baseAmount: 118000, date: dateTimeLocalNow(-54, 10), payee: "TechCorp Monthly Salary", category: "salary", accountId: "acc_bank", method: "Bank Transfer", tags: ["payroll"], notes: "", taxDeductible: false, reconciled: true },
      { id: "t_m1_2", type: "expense", amount: 24500, currency: "INR", baseAmount: 24500, date: dateTimeLocalNow(-52, 9), payee: "Skyline Apartments Rent", category: "housing", accountId: "acc_bank", method: "Bank Transfer", tags: ["fixed"], notes: "", taxDeductible: false, reconciled: true },
      { id: "t_m1_3", type: "expense", amount: 14200, currency: "INR", baseAmount: 14200, date: dateTimeLocalNow(-45, 16), payee: "Groceries & Dining Bundle", category: "food", accountId: "acc_cc", method: "Card", tags: [], notes: "", taxDeductible: false, reconciled: true },
      { id: "t_m1_4", type: "expense", amount: 18900, currency: "INR", baseAmount: 18900, date: dateTimeLocalNow(-41, 12), payee: "Weekend Flight Booking", category: "travel", accountId: "acc_cc", method: "Card", tags: ["trip"], notes: "", taxDeductible: false, reconciled: true },
      { id: "t_m2_1", type: "income", amount: 118000, currency: "INR", baseAmount: 118000, date: dateTimeLocalNow(-84, 10), payee: "TechCorp Monthly Salary", category: "salary", accountId: "acc_bank", method: "Bank Transfer", tags: ["payroll"], notes: "", taxDeductible: false, reconciled: true },
      { id: "t_m2_2", type: "expense", amount: 24500, currency: "INR", baseAmount: 24500, date: dateTimeLocalNow(-82, 9), payee: "Skyline Apartments Rent", category: "housing", accountId: "acc_bank", method: "Bank Transfer", tags: ["fixed"], notes: "", taxDeductible: false, reconciled: true },
      { id: "t_m2_3", type: "expense", amount: 16400, currency: "INR", baseAmount: 16400, date: dateTimeLocalNow(-74, 14), payee: "Home Electronics & Desk", category: "shopping", accountId: "acc_cc", method: "Card", tags: ["wfh"], notes: "Monitor arm & lamp", taxDeductible: true, reconciled: true },
      { id: "t_m2_4", type: "expense", amount: 7200, currency: "INR", baseAmount: 7200, date: dateTimeLocalNow(-68, 19), payee: "Supermarket Monthly Run", category: "groceries", accountId: "acc_cc", method: "Card", tags: [], notes: "", taxDeductible: false, reconciled: true }
    ];

    const budgets = [
      { id: "b_food", category: "food", limit: 8000, rollover: true },
      { id: "b_groc", category: "groceries", limit: 10000, rollover: false },
      { id: "b_shop", category: "shopping", limit: 7000, rollover: false },
      { id: "b_trans", category: "transport", limit: 5000, rollover: true },
      { id: "b_sub", category: "subscriptions", limit: 3500, rollover: false }
    ];

    const recurring = [
      { id: "r1", payee: "Skyline Apartments Rent", type: "expense", amount: 24500, currency: "INR", category: "housing", accountId: "acc_bank", frequency: "monthly", nextDue: todayISO(6), autoPost: true, active: true },
      { id: "r2", payee: "Cloud Workspace Pro", type: "expense", amount: 24, currency: "USD", category: "subscriptions", accountId: "acc_cc", frequency: "monthly", nextDue: todayISO(2), autoPost: false, active: true },
      { id: "r3", payee: "Spotify & Music Family", type: "expense", amount: 299, currency: "INR", category: "subscriptions", accountId: "acc_cc", frequency: "monthly", nextDue: todayISO(0), autoPost: false, active: true },
      { id: "r4", payee: "FiberNet Gigabit Broadband", type: "expense", amount: 1499, currency: "INR", category: "utilities", accountId: "acc_bank", frequency: "monthly", nextDue: todayISO(13), autoPost: true, active: true }
    ];

    const goals = [
      { id: "g1", name: "Japan Autumn Trip", target: 180000, saved: 98000, deadline: todayISO(210), color: "#4f46e5" },
      { id: "g2", name: "6-Month Emergency Runway", target: 400000, saved: 320000, deadline: todayISO(300), color: "#10b981" },
      { id: "g3", name: "MacBook Pro Upgrade", target: 165000, saved: 62000, deadline: todayISO(150), color: "#0ea5e9" }
    ];

    const ious = [
      { id: "iou1", person: "Aarav Sharma", direction: "owed_to_me", amount: 2450, description: "Split dinner & cab at Indiranagar", date: todayISO(-4), settled: false },
      { id: "iou2", person: "Maya Patel", direction: "owed_to_me", amount: 1800, description: "Concert tickets share", date: todayISO(-10), settled: false },
      { id: "iou3", person: "Rohan Verma", direction: "i_owe", amount: 950, description: "Shared Airbnb snacks", date: todayISO(-2), settled: false }
    ];

    const rules = [
      { id: "rule1", field: "payee", operator: "contains", pattern: "swiggy|zomato|bistro|cafe", category: "food", tags: ["dining"], taxDeductible: false, active: true },
      { id: "rule2", field: "payee", operator: "contains", pattern: "uber|ola|shell|metro|fuel", category: "transport", tags: ["commute"], taxDeductible: false, active: true },
      { id: "rule3", field: "payee", operator: "contains", pattern: "aws|github|cloud|adobe|fibernet", category: "subscriptions", tags: ["work", "software"], taxDeductible: true, active: true }
    ];

    return {
      version: 1,
      settings: {
        currency: "INR",
        theme: "light",
        privacyMode: false,
        monthlyOverallCap: 65000,
        pinHash: "",
        fxRates: { INR: 0.0119, USD: 1.0, EUR: 1.08, GBP: 1.27, JPY: 0.0065, AED: 0.272, CAD: 0.72, AUD: 0.65, SGD: 0.74 }
      },
      categories: DEFAULT_CATEGORIES,
      accounts,
      transactions,
      budgets,
      recurring,
      goals,
      ious,
      rules,
      receiptsMeta: {}
    };
  }

  function convertStatic(amount, from, to) {
    const rFrom = CURRENCIES[from]?.rateToUSD || 1;
    const rTo = CURRENCIES[to]?.rateToUSD || 1;
    return Math.round(amount * (rFrom / rTo) * 100) / 100;
  }

  /* ---------- Persistence Layer (Desktop/Android Native Host + Preview Fallback) ---------- */
  async function callAndroidParser(bodyText) {
    const bridge = window.LedgerFlowAndroid;
    if (!bridge) throw new Error("Android parser unavailable");
    if (typeof bridge.parseStatementJsonAsync === "function") {
      const raw = await callAndroidAsync("parseStatementJsonAsync", [String(bodyText || "")], 180000);
      return JSON.parse(raw);
    }
    if (typeof bridge.parseStatementJson !== "function") {
      throw new Error("Android parser unavailable");
    }
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(JSON.parse(bridge.parseStatementJson(String(bodyText || ""))));
        } catch (err) {
          reject(err);
        }
      }, 16);
    });
  }

  async function parseStatementWithLiveProgress(payloadObj, onUpdate = null) {
    const bodyStr = JSON.stringify(payloadObj || {});
    const emit = (st) => {
      if (typeof onUpdate === "function" && st) onUpdate(st);
    };

    // Android streaming job path
    if (window.LedgerFlowAndroid) {
      const bridge = window.LedgerFlowAndroid;
      if (typeof bridge.startParseStatementJob === "function" && typeof bridge.getParseStatementJobStatus === "function") {
        const startRes = JSON.parse(bridge.startParseStatementJob(bodyStr));
        if (!startRes || !startRes.ok || !startRes.jobId) {
          throw new Error(startRes?.error || "Could not start Android parser job.");
        }
        while (true) {
          await new Promise((r) => setTimeout(r, 180));
          const st = JSON.parse(bridge.getParseStatementJobStatus(startRes.jobId));
          emit(st);
          if (st.done) {
            if (!st.result) throw new Error(st.error || "Parser job ended without result.");
            return st.result;
          }
        }
      }
      return await callAndroidParser(bodyStr);
    }

    // Windows desktop host streaming job path
    if (isDesktopHost) {
      const hdrs = { "Content-Type": "application/json" };
      if (API_TOKEN) hdrs["X-LedgerFlow-Token"] = API_TOKEN;
      let startRes = null;
      try {
        const r = await fetch("/api/parse-statement-start", { method: "POST", headers: hdrs, body: bodyStr });
        if (r.ok) startRes = await r.json();
      } catch (_) {}
      if (startRes && startRes.ok && startRes.jobId) {
        while (true) {
          await new Promise((r) => setTimeout(r, 180));
          const sr = await fetch(`/api/parse-statement-status?job=${encodeURIComponent(startRes.jobId)}`, { headers: hdrs, cache: "no-store" });
          if (!sr.ok) throw new Error("HTTP " + sr.status);
          const st = await sr.json();
          emit(st);
          if (st.done) {
            if (!st.result) throw new Error(st.error || "Parser job ended without result.");
            return st.result;
          }
        }
      }
      return await apiFetch("/api/parse-statement", { method: "POST", body: bodyStr });
    }

    return await apiFetch("/api/parse-statement", { method: "POST", body: bodyStr });
  }

  async function apiFetch(path, options = {}) {
    if (window.LedgerFlowAndroid) {
      const method = String(options.method || "GET").toUpperCase();
      if (path === "/api/state" && method === "GET") {
        return JSON.parse(window.LedgerFlowAndroid.getStateJson());
      }
      if (path === "/api/state" && method === "POST") {
        return JSON.parse(window.LedgerFlowAndroid.saveStateJson(String(options.body || "")));
      }
      if (path === "/api/parse-statement" && method === "POST") {
        return await callAndroidParser(options.body);
      }
      if (path === "/api/ping") return { ok: true };
    }
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (API_TOKEN) headers["X-LedgerFlow-Token"] = API_TOKEN;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadState() {
    if (!IS_PREVIEW_PARAM && window.location.protocol.startsWith("http")) {
      try {
        const res = await apiFetch("/api/state");
        if (res && res.host) {
          isDesktopHost = true;
          if (res.platform === "android") isAndroidHost = true;
          document.getElementById("storage-badge").textContent = isAndroidHost ? "Mobile Vault" : "Desktop Vault";
          if (res.data) {
            state = res.data;
          } else {
            state = createBlankState();
            await saveState();
            setTimeout(() => toast("LedgerFlow ready! All balances start at zero — click '+ Add Entry' to insert your amounts."), 600);
          }
          return;
        }
      } catch (e) {
        // Fallback to preview mode
      }
    }
    isDesktopHost = false;
    document.getElementById("storage-badge").textContent = "Interactive Preview";
    try {
      const saved = localStorage.getItem("ledgerflow_preview_v1");
      state = saved ? JSON.parse(saved) : createBlankState();
    } catch (_) {
      state = createBlankState();
    }
  }

  async function saveState() {
    if (!state) return;
    if (isDesktopHost) {
      try {
        await apiFetch("/api/state", { method: "POST", body: JSON.stringify(state) });
      } catch (e) {
        toast("Warning: failed to save to disk (" + e.message + ")");
      }
    } else {
      try {
        localStorage.setItem("ledgerflow_preview_v1", JSON.stringify(state));
      } catch (_) {}
    }
  }

  /* ---------- Financial Calculations ---------- */
  function getAccountBalance(accountId) {
    const acc = getAcc(accountId);
    let bal = Number(acc.initialBalance) || 0;
    for (const t of state.transactions) {
      const val = convertToBase(t.amount, t.currency);
      if (t.type === "income" && t.accountId === accountId) bal += val;
      else if (t.type === "expense" && t.accountId === accountId) bal -= val;
      else if (t.type === "transfer") {
        if (t.accountId === accountId) bal -= val;
        if (t.toAccountId === accountId) bal += val;
      }
    }
    return bal;
  }

  function getTotalNetWorth() {
    return (state.accounts || []).reduce((sum, a) => sum + getAccountBalance(a.id), 0);
  }

  function getLiquidBalance() {
    return (state.accounts || [])
      .filter((a) => a.type !== "credit")
      .reduce((sum, a) => sum + getAccountBalance(a.id), 0);
  }

  function getPeriodBounds(period = currentPeriod) {
    const now = new Date();
    const startOfMonth = (y, m) => new Date(y, m, 1, 0, 0, 0, 0);
    const endOfMonth = (y, m) => new Date(y, m + 1, 0, 23, 59, 59, 999);
    if (period === "this_month") {
      return { start: startOfMonth(now.getFullYear(), now.getMonth()), end: endOfMonth(now.getFullYear(), now.getMonth()), label: "This Month" };
    }
    if (period === "last_month") {
      const m = now.getMonth() - 1;
      return { start: startOfMonth(now.getFullYear(), m), end: endOfMonth(now.getFullYear(), m), label: "Last Month" };
    }
    if (period === "90d") {
      const s = new Date(now);
      s.setDate(s.getDate() - 90);
      return { start: s, end: now, label: "Last 90 Days" };
    }
    if (period === "this_year") {
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999), label: "This Year" };
    }
    if (period === "custom" && customPeriodStart && customPeriodEnd) {
      const s = new Date(customPeriodStart + "T00:00:00");
      const e = new Date(customPeriodEnd + "T23:59:59.999");
      if (!isNaN(s) && !isNaN(e)) {
        const lbl = `${s.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${e.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}`;
        return { start: s, end: e, label: lbl };
      }
    }
    return { start: new Date(2000, 0, 1), end: new Date(2099, 11, 31, 23, 59, 59, 999), label: "All Time" };
  }

  function formatDateYMD(d) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function formatAccountLabel(a) {
    if (!a) return "Account";
    const bank = String(a.bankName || "").trim();
    const last4 = String(a.accountNumberLast4 || "").trim();
    const tail = last4 ? ` (••${last4})` : "";
    return bank ? `${bank} — ${a.name}${tail}` : `${a.name}${tail}`;
  }

  function getLedger(id) {
    if (!id) return null;
    return (state.ledgers || []).find((l) => l.id === id) || null;
  }

  const PARTY_STOPWORDS = new Set([
    "bank", "cash", "self", "upi", "imps", "neft", "rtgs", "mmt", "p2a", "p2p", "p2m",
    "transfer", "payment", "entry", "debit", "credit", "reversal", "refund", "interest",
    "charges", "charge", "fees", "fee", "clearing", "cheque", "mandate", "autopay",
    "hdfc", "sbin", "icic", "utib", "punb", "kkbk", "yesb", "barb", "cnrb", "idfb", "indb",
    "india", "limited", "private", "associates", "account", "online", "mobile", "branch"
  ]);

  function cleanPersonTokens(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/\b[a-z]{4}0[a-z0-9]{6}\b/gi, " ")
      .replace(/\b(mr|mrs|ms|shri|smt|dr|miss)\b\.?/gi, " ")
      .replace(/\b\d{4,}\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !PARTY_STOPWORDS.has(w));
  }

  function buildLedgerMatchCache() {
    const byNorm = new Map();
    const list = (state.ledgers || []).filter((l) => l && l.type !== "drawings");
    for (const l of list) {
      const ln = normalizePayeeKey(l.name);
      if (ln && !byNorm.has(ln)) byNorm.set(ln, l);
      if (Array.isArray(l.aliases)) {
        for (const a of l.aliases) {
          const an = normalizePayeeKey(a);
          if (an && !byNorm.has(an)) byNorm.set(an, l);
        }
      }
    }
    return { list, byNorm };
  }

  function findBestMatchingLedger(tx, rawNarration = "", ledgerCache = null) {
    const ledgers = ledgerCache ? ledgerCache.list : (state.ledgers || []).filter((l) => l && l.type !== "drawings");
    if (!ledgers.length) return null;

    const pNorm = normalizePayeeKey(tx.payee);
    if (ledgerCache && pNorm && ledgerCache.byNorm.has(pNorm)) {
      return ledgerCache.byNorm.get(pNorm);
    }

    const fullText = `${tx.payee || ""} ${rawNarration || ""} ${tx.notes || ""}`;
    const normFull = " " + fullText.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    const txTokens = new Set(cleanPersonTokens(fullText));

    // 1. Exact normalized name or alias match on payee
    if (!ledgerCache) {
      for (const l of ledgers) {
        const lNorm = normalizePayeeKey(l.name);
        if (pNorm && lNorm && pNorm === lNorm) return l;
        if (Array.isArray(l.aliases) && l.aliases.some((a) => normalizePayeeKey(a) === pNorm)) return l;
      }
    }

    // 2. Whole-phrase or multi-token match inside full narration (catches IMPS/NEFT/UPI variants)
    let best = null;
    let bestScore = 0;
    for (const l of ledgers) {
      const lNorm = normalizePayeeKey(l.name);
      const lTokens = cleanPersonTokens(l.name);
      let score = 0;

      if (lNorm.length >= 4 && !PARTY_STOPWORDS.has(lNorm) && normFull.includes(" " + lNorm + " ")) {
        score = 100 + lNorm.length;
      } else if (Array.isArray(l.aliases)) {
        for (const al of l.aliases) {
          const alNorm = normalizePayeeKey(al);
          if (alNorm.length >= 4 && normFull.includes(" " + alNorm + " ")) {
            score = Math.max(score, 95 + alNorm.length);
          }
        }
      }

      if (score === 0 && lTokens.length >= 2 && txTokens.size >= 2) {
        const matchedCount = lTokens.filter((tok) => txTokens.has(tok)).length;
        if (matchedCount === lTokens.length || (matchedCount >= 2 && matchedCount / lTokens.length >= 0.75)) {
          score = 70 + matchedCount * 10;
        }
      } else if (score === 0 && lTokens.length === 1 && lTokens[0].length >= 5 && txTokens.has(lTokens[0])) {
        // Single distinctive first/last name token (5+ chars, not a stopword)
        score = 55 + lTokens[0].length;
      }

      if (score > 0 && (l.isUserCreated || l.protectedFromDrawings)) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  }

  function findOrCreateLedger(name, type = "person", ledgerCache = null) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const norm = normalizePayeeKey(cleanName);
    if (!state.ledgers) state.ledgers = [];
    if (ledgerCache && norm && ledgerCache.byNorm.has(norm)) {
      return ledgerCache.byNorm.get(norm);
    }
    const existing = state.ledgers.find((l) =>
      l.name.toLowerCase() === cleanName.toLowerCase()
      || (norm && normalizePayeeKey(l.name) === norm)
      || (Array.isArray(l.aliases) && l.aliases.some((a) => normalizePayeeKey(a) === norm))
    );
    if (existing) return existing;
    const palette = ["#4f46e5", "#10b981", "#0ea5e9", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316"];
    const color = type === "drawings" ? "#f59e0b" : palette[state.ledgers.length % palette.length];
    const led = {
      id: uid("led"),
      name: cleanName,
      type: type || "person",
      aliases: [],
      color,
      notes: "Auto-created from bank narration"
    };
    state.ledgers.push(led);
    if (ledgerCache) {
      ledgerCache.list.push(led);
      if (norm && !ledgerCache.byNorm.has(norm)) ledgerCache.byNorm.set(norm, led);
    }
    return led;
  }

  function autoAssignLedgerForTx(tx, rawNarration = "", createMissing = true, ledgerCache = null) {
    if (!tx || tx.type === "transfer") return tx;
    if (tx.ledgerId && getLedger(tx.ledgerId)) return tx;

    const mem = state.settings.aiMemory || {};
    const pKey = normalizePayeeKey(tx.payee);
    if (pKey && mem[pKey] && mem[pKey].ledgerId && getLedger(mem[pKey].ledgerId)) {
      tx.ledgerId = mem[pKey].ledgerId;
      return tx;
    }

    const hay = `${tx.payee || ""} ${rawNarration || ""} ${tx.notes || ""}`.toLowerCase();
    // Drawings detection: cash/ATM withdrawals, self transfers, wallet/personal drawings
    if (/(atm\s*wdl|atm\s*cash|cash\s*withdrawal|\bself\b|drawings?|own account)/.test(hay)) {
      tx.ledgerId = "led_drawings";
      return tx;
    }

    // First try matching any existing person/party ledger across full narration (catches IMPS/NEFT/UPI variants!)
    const matchedExisting = findBestMatchingLedger(tx, rawNarration, ledgerCache);
    if (matchedExisting) {
      tx.ledgerId = matchedExisting.id;
      if (matchedExisting.protectedFromDrawings || matchedExisting.isUserCreated) {
        tx.keepSeparateLedger = true;
      }
      return tx;
    }

    // Named Person / Party detection from UPI/IMPS/NEFT/RTGS narrations
    const cleanPayee = String(tx.payee || "").trim();
    const isGeneric = !cleanPayee || cleanPayee.length < 3
      || /^(upi reversal|bank entry|bank debit|bank credit|bank interest|debit card|bank ach|internal transfer|imps transfer|neft transfer|rtgs transfer)/i.test(cleanPayee);
    const fullNar = `${rawNarration || ""} ${tx.notes || ""}`;
    const isPartyCandidate = tx.category === "personal_transfer"
      || (tx.method === "UPI" && tx.category === "other_exp")
      || (tx.type === "income" && /^(salary|freelance|refund)$/.test(tx.category) && !/reversal|interest/i.test(cleanPayee))
      || /\b(neft|imps|rtgs|mmt\/imps|upi\/(dr|cr))\b/i.test(fullNar);

    if (!isGeneric && isPartyCandidate && createMissing) {
      const led = findOrCreateLedger(cleanPayee, "person", ledgerCache);
      if (led) tx.ledgerId = led.id;
    }
    return tx;
  }

  function getTransactionsInRange(start, end) {
    return (state.transactions || []).filter((t) => {
      const d = new Date(t.date);
      return d >= start && d <= end;
    });
  }

  function txBaseAmount(t) {
    return convertToBase(t.amount, t.currency);
  }

  function getCategorySpendingMap(txList) {
    const map = {};
    for (const t of txList) {
      if (t.type !== "expense") continue;
      if (t.splits && t.splits.length) {
        const scale = txBaseAmount(t) / Math.max(Number(t.amount) || 1, 0.0001);
        for (const sp of t.splits) {
          map[sp.category] = (map[sp.category] || 0) + (Number(sp.amount) || 0) * scale;
        }
      } else {
        map[t.category] = (map[t.category] || 0) + txBaseAmount(t);
      }
    }
    return map;
  }

  /* ---------- Smart Rules & Recurring Engine ---------- */
  function matchRule(rule, payee, notes) {
    if (!rule.active || !rule.pattern) return false;
    const target = ((rule.field === "notes" ? notes : payee) || "").toLowerCase();
    const pat = rule.pattern.toLowerCase();
    try {
      if (rule.operator === "startsWith") return target.startsWith(pat);
      if (rule.operator === "regex") return new RegExp(rule.pattern, "i").test(rule.field === "notes" ? notes : payee);
      // contains supports pipe-separated alternatives like "swiggy|zomato"
      return pat.split("|").some((p) => p.trim() && target.includes(p.trim()));
    } catch (_) {
      return false;
    }
  }

  function applyRulesToTx(tx) {
    if (tx.type === "transfer") return tx;
    for (const r of state.rules || []) {
      if (matchRule(r, tx.payee, tx.notes)) {
        if (r.category) tx.category = r.category;
        if (r.tags && r.tags.length) {
          tx.tags = Array.from(new Set([...(tx.tags || []), ...r.tags]));
        }
        if (r.taxDeductible) tx.taxDeductible = true;
        break;
      }
    }
    return tx;
  }

  function advanceDueDate(dateStr, freq) {
    const d = new Date(dateStr + "T09:00:00");
    if (freq === "daily") d.setDate(d.getDate() + 1);
    else if (freq === "weekly") d.setDate(d.getDate() + 7);
    else if (freq === "biweekly") d.setDate(d.getDate() + 14);
    else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }

  function processAutoRecurring() {
    const today = todayISO(0);
    let posted = 0;
    for (const r of state.recurring || []) {
      if (!r.active || !r.autoPost) continue;
      let guard = 0;
      while (r.nextDue <= today && guard < 12) {
        state.transactions.unshift({
          id: uid("tx"),
          type: r.type || "expense",
          amount: r.amount,
          currency: r.currency || state.settings.currency,
          baseAmount: convertToBase(r.amount, r.currency),
          date: r.nextDue + "T09:00",
          payee: r.payee,
          category: r.category,
          accountId: r.accountId,
          method: "Auto-Debit",
          tags: ["recurring"],
          notes: "Auto-posted recurring bill",
          taxDeductible: false,
          reconciled: true
        });
        r.nextDue = advanceDueDate(r.nextDue, r.frequency);
        posted++;
        guard++;
      }
    }
    if (posted > 0) {
      saveState();
      toast(`Auto-posted ${posted} scheduled recurring transaction(s).`);
    }
  }

  function getDueRecurringCount() {
    const soon = todayISO(3);
    return (state.recurring || []).filter((r) => r.active && r.nextDue <= soon).length;
  }

  /* ---------- Interactive SVG Charts ---------- */
  function renderCashFlowChart(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const txs = getTransactionsInRange(start, end);
      const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + txBaseAmount(t), 0);
      const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + txBaseAmount(t), 0);
      months.push({ label: d.toLocaleDateString("en-US", { month: "short" }), income, expense, net: income - expense });
    }

    const maxVal = Math.max(1000, ...months.flatMap((m) => [m.income, m.expense]));
    if (months.every((m) => m.income === 0 && m.expense === 0)) {
      el.innerHTML = `<div class="muted text-sm" style="padding:48px 0;text-align:center;">No transactions yet — add your first income or expense to see 6-month cash flow trends.</div>`;
      return;
    }
    const W = 560, H = 225, padL = 52, padR = 16, padT = 18, padB = 30;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    const groupW = chartW / months.length;
    const barW = Math.min(20, groupW * 0.28);

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const y = padT + chartH * (1 - frac);
      const val = maxVal * frac;
      const lbl = val >= 100000 ? (val / 100000).toFixed(1) + "L" : val >= 1000 ? Math.round(val / 1000) + "k" : Math.round(val);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 3" />
              <text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-soft)" font-size="11">${lbl}</text>`;
    }).join("");

    const bars = months.map((m, idx) => {
      const cx = padL + groupW * idx + groupW / 2;
      const ih = (m.income / maxVal) * chartH;
      const eh = (m.expense / maxVal) * chartH;
      const iy = padT + chartH - ih;
      const ey = padT + chartH - eh;
      return `
        <g class="cf-group" data-idx="${idx}">
          <rect x="${cx - barW - 2}" y="${iy}" width="${barW}" height="${Math.max(2, ih)}" rx="5" fill="#10b981" opacity="0.9"/>
          <rect x="${cx + 2}" y="${ey}" width="${barW}" height="${Math.max(2, eh)}" rx="5" fill="#4f46e5" opacity="0.9"/>
          <text x="${cx}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11.5" font-weight="600">${m.label}</text>
          <rect x="${padL + groupW * idx}" y="${padT}" width="${groupW}" height="${chartH}" fill="transparent" class="cf-hover-zone" data-label="${esc(m.label)}" data-inc="${m.income}" data-exp="${m.expense}" data-net="${m.net}"/>
        </g>`;
    }).join("");

    el.innerHTML = `
      <div class="chart-container">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible;">
          ${gridLines}${bars}
        </svg>
        <div class="chart-tooltip hidden" id="${containerId}-tip"></div>
      </div>`;

    const tip = document.getElementById(`${containerId}-tip`);
    el.querySelectorAll(".cf-hover-zone").forEach((z) => {
      z.addEventListener("mousemove", (e) => {
        const rect = el.getBoundingClientRect();
        tip.classList.remove("hidden");
        tip.style.left = (e.clientX - rect.left) + "px";
        tip.style.top = (e.clientY - rect.top - 8) + "px";
        tip.innerHTML = `<strong>${z.dataset.label}</strong><br/>Total Credits: ${fmtMoney(z.dataset.inc)}<br/>Total Debits: ${fmtMoney(z.dataset.exp)}<br/>Net Savings: ${fmtMoney(z.dataset.net, null, true)}`;
      });
      z.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    });
  }

  function renderCategoryDonut(containerId, txList) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const map = getCategorySpendingMap(txList);
    const entries = Object.entries(map)
      .map(([id, val]) => ({ cat: getCat(id), val }))
      .filter((x) => x.val > 0)
      .sort((a, b) => b.val - a.val);

    const total = entries.reduce((s, e) => s + e.val, 0);
    if (total <= 0) {
      el.innerHTML = `<div class="muted text-sm" style="padding:36px 0;text-align:center;">No expense data for this period.</div>`;
      return;
    }

    const size = 176, cx = 88, cy = 88, r = 64, circ = 2 * Math.PI * r;
    let offset = 0;
    const slices = entries.slice(0, 7).map((item) => {
      const pct = item.val / total;
      const dash = pct * circ;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent" stroke="${item.cat.color}" stroke-width="22"
        stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}"
        style="cursor:pointer;transition:opacity 0.15s;" data-cat="${item.cat.id}" />`;
      offset += dash;
      return seg;
    }).join("");

    const legend = entries.slice(0, 6).map((item) => {
      const pct = Math.round((item.val / total) * 100);
      return `
        <div class="legend-row" data-cat-drill="${item.cat.id}">
          <div class="legend-left">
            <span class="legend-swatch" style="background:${item.cat.color}"></span>
            <span class="truncate text-sm">${item.cat.icon} ${esc(item.cat.name)}</span>
          </div>
          <div class="text-right">
            <strong class="text-sm money-val">${fmtMoney(item.val)}</strong>
            <span class="text-xs muted">(${pct}%)</span>
          </div>
        </div>`;
    }).join("");

    el.innerHTML = `
      <div class="donut-wrap">
        <div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0;">
          <svg viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);width:100%;height:100%;">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent" stroke="var(--surface-2)" stroke-width="22"/>
            ${slices}
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center;">
            <span class="text-xs muted">Total Spend</span>
            <strong class="money-val" style="font-size:15px;">${fmtMoney(total)}</strong>
          </div>
        </div>
        <div class="donut-legend">${legend}</div>
      </div>`;

    el.querySelectorAll("[data-cat-drill],[data-cat]").forEach((node) => {
      node.addEventListener("click", () => {
        const cid = node.dataset.catDrill || node.dataset.cat;
        txFilters.category = cid;
        switchView("transactions");
      });
    });
  }

  /* ---------- Views Rendering ---------- */
  function updateSidebarMeta() {
    document.getElementById("nav-tx-count").textContent = (state.transactions || []).length;
    const lc = document.getElementById("nav-ledger-count");
    if (lc) lc.textContent = (state.ledgers || []).length;
    const due = getDueRecurringCount();
    const dueBadge = document.getElementById("nav-due-count");
    dueBadge.textContent = due;
    dueBadge.classList.toggle("hidden", due === 0);
    document.getElementById("sidebar-net-worth").textContent = fmtMoney(getTotalNetWorth());
  }

  const MOBILE_SWIPE_VIEWS = ["overview", "ledgers", "transactions"];

  function syncMobileNavIndicator(view, progressOffset = 0) {
    const nav = document.getElementById("mobile-bottom-nav");
    const pill = document.getElementById("mobile-nav-indicator");
    if (!nav || !pill) return;
    const activeBtn = nav.querySelector(`.mobile-nav-item[data-view="${view}"]`);
    if (!activeBtn) {
      pill.style.opacity = "0";
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    if (!navRect.width || !btnRect.width) return;

    let left = btnRect.left - navRect.left;
    let width = btnRect.width;
    const idx = MOBILE_SWIPE_VIEWS.indexOf(view);
    if (progressOffset && idx >= 0) {
      const targetIdx = idx + (progressOffset > 0 ? 1 : -1);
      if (targetIdx >= 0 && targetIdx < MOBILE_SWIPE_VIEWS.length) {
        const nextBtn = nav.querySelector(`.mobile-nav-item[data-view="${MOBILE_SWIPE_VIEWS[targetIdx]}"]`);
        if (nextBtn) {
          const nextRect = nextBtn.getBoundingClientRect();
          const t = Math.min(1, Math.abs(progressOffset));
          const targetLeft = nextRect.left - navRect.left;
          left = left + (targetLeft - left) * t;
          width = width + (nextRect.width - width) * t;
        }
      }
    }
    pill.style.opacity = "1";
    pill.style.width = `${Math.max(44, width).toFixed(1)}px`;
    pill.style.transform = `translate3d(${left.toFixed(1)}px, 0, 0)`;
  }

  function switchView(view, opts = {}) {
    currentView = view;
    document.querySelectorAll("#nav-list .nav-item, .sidebar-footer .nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    document.querySelectorAll("#mobile-bottom-nav .mobile-nav-item[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    const moreBtn = document.getElementById("mobile-nav-more");
    if (moreBtn) moreBtn.classList.toggle("active", !["overview", "ledgers", "transactions"].includes(view));
    closeMobileDrawer();

    const titles = {
      overview: ["Overview", "Available balance, Total Credits, Total Debits & linked sources"],
      ledgers: ["Bank & Party Ledgers", "Dr. Side inflows & Cr. Side outflows, Drawings & Separate Person Ledgers"],
      monthly: ["Monthly Cost & Trend Intelligence", "Summary, trend analysis, Fixed vs Variable bifurcation, and Petty / Big / Special expenses"],
      transactions: ["Transactions Ledger", "Search, filter, split, attach receipts, and bulk edit"],
      budgets: ["Budgets & Safe-to-Spend", "Monthly category limits, rollover envelopes, and spending pace"],
      recurring: ["Subscriptions & Bills", "Track recurring bills, annual burn rate, and upcoming dues"],
      accounts: ["Accounts & Cards", "Bank accounts, cash wallets, credit limits, and balances"],
      goals: ["Goals & Split IOUs", "Savings targets and shared expense settlements"],
      analytics: ["Analytics & Tax Reports", "Trends, spending heatmap, top merchants, and PDF export"],
      rules: ["Smart Automation Rules", "Auto-categorize, tag, and flag transactions automatically"],
      ai: ["LedgerFlow AI Intelligence", "Built-in Local Financial Brain + Optional Free Google Gemini Integration"],
      settings: ["Import, Backup & Settings", "Currencies, custom categories, Password lock, and vault backups"]
    };
    const [t, sub] = titles[view] || ["LedgerFlow", ""];
    document.getElementById("page-title").textContent = t;
    document.getElementById("page-subtitle").textContent = sub;

    const container = document.getElementById("view-container");
    if (container) {
      container.classList.toggle("no-cascade", !!opts.fromSwipeDir);
    }
    if (view === "overview") renderOverview(container);
    else if (view === "ledgers") renderLedgersView(container);
    else if (view === "monthly") renderMonthlyIntelligenceView(container);
    else if (view === "transactions") renderTransactionsView(container);
    else if (view === "budgets") renderBudgetsView(container);
    else if (view === "recurring") renderRecurringView(container);
    else if (view === "accounts") renderAccountsView(container);
    else if (view === "goals") renderGoalsView(container);
    else if (view === "analytics") renderAnalyticsView(container);
    else if (view === "rules") renderRulesView(container);
    else if (view === "ai") renderAiAssistantView(container);
    else if (view === "settings") renderSettingsView(container);

    // Stamp Laminar cascade indices on view children for fluid mobile entrance
    if (container && container.children && !opts.fromSwipeDir) {
      Array.from(container.children).forEach((child, idx) => {
        child.style.setProperty("--stagger-i", String(Math.min(idx, 10)));
      });
    }

    if (container && opts.fromSwipeDir) {
      container.classList.remove("swipe-out-left", "swipe-out-right", "swipe-settle");
      container.classList.add("swipe-dragging");
      const startX = opts.fromSwipeDir > 0 ? "28vw" : "-28vw";
      container.style.transform = `translate3d(${startX}, 0, 0) scale(0.98)`;
      container.style.opacity = "0.55";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.classList.remove("swipe-dragging");
          container.classList.add("swipe-settle");
          container.style.transform = "translate3d(0, 0, 0) scale(1)";
          container.style.opacity = "1";
          setTimeout(() => {
            if (!container.classList.contains("swipe-dragging")) {
              container.classList.remove("swipe-settle");
              container.style.transform = "";
              container.style.opacity = "";
            }
          }, 460);
        });
      });
    }

    requestAnimationFrame(() => syncMobileNavIndicator(view));
    updateSidebarMeta();
  }

  function generateSmartInsights(periodTxs) {
    const insights = [];
    const exp = periodTxs.filter((t) => t.type === "expense").reduce((s, t) => s + txBaseAmount(t), 0);
    const inc = periodTxs.filter((t) => t.type === "income").reduce((s, t) => s + txBaseAmount(t), 0);
    if (inc > 0) {
      const rate = Math.round(((inc - exp) / inc) * 100);
      insights.push({
        color: rate >= 25 ? "var(--emerald)" : rate >= 10 ? "var(--amber)" : "var(--rose)",
        title: `Savings rate is ${rate}%`,
        desc: rate >= 25 ? "Healthy cash surplus this period. Keep compounding your goals." : "Spending is absorbing most of your inflow; inspect top discretionary categories."
      });
    }
    // Over-budget check
    const now = new Date();
    const monthTxs = getTransactionsInRange(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59));
    const catMap = getCategorySpendingMap(monthTxs);
    for (const b of state.budgets || []) {
      const spent = catMap[b.category] || 0;
      if (spent > b.limit) {
        insights.push({
          color: "var(--rose)",
          title: `${getCat(b.category).name} exceeded budget`,
          desc: `Spent ${fmtMoney(spent)} vs ${fmtMoney(b.limit)} limit (+${fmtMoney(spent - b.limit)}).`
        });
      }
    }
    const taxTotal = periodTxs.filter((t) => t.taxDeductible).reduce((s, t) => s + txBaseAmount(t), 0);
    if (taxTotal > 0) {
      insights.push({
        color: "var(--sky)",
        title: `${fmtMoney(taxTotal)} in tax-deductible items`,
        desc: "Export a clean deduction summary anytime from Analytics & Tax."
      });
    }
    const due = getDueRecurringCount();
    if (due > 0) {
      insights.push({
        color: "var(--amber)",
        title: `${due} recurring bill(s) due within 3 days`,
        desc: "Review Subscriptions & Bills to record or auto-post upcoming payments."
      });
    }
    const catTotals = Object.entries(getCategorySpendingMap(periodTxs)).sort((a, b) => b[1] - a[1]);
    if (catTotals.length && exp > 0) {
      const [topCatId, topAmt] = catTotals[0];
      const pct = Math.round((topAmt / exp) * 100);
      insights.push({
        color: getCat(topCatId).color || "var(--primary)",
        title: `Top spend: ${getCat(topCatId).name} (${pct}%)`,
        desc: `${fmtMoney(topAmt)} out of ${fmtMoney(exp)} total outflows in this period.`
      });
    }
    const pettyMax = Number(state.settings.pettyExpenseMax) || 200;
    const pettyTxs = periodTxs.filter((t) => t.type === "expense" && txBaseAmount(t) <= pettyMax);
    if (pettyTxs.length >= 5) {
      const pettySum = pettyTxs.reduce((s, t) => s + txBaseAmount(t), 0);
      insights.push({
        color: "var(--amber)",
        title: `Petty UPI drain: ${pettyTxs.length} small spends`,
        desc: `${fmtMoney(pettySum)} across transactions under ${fmtMoney(pettyMax)} each.`
      });
    }
    return insights.slice(0, 5);
  }

  function openCustomRangePicker(onApplied = null) {
    const cur = getPeriodBounds();
    const defStart = customPeriodStart || formatDateYMD(cur.start);
    const defEnd = customPeriodEnd || formatDateYMD(cur.end);
    openSubModal("Select Date Range or Month", `
      <form id="custom-range-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field">
          <label>Quick Month Select</label>
          <input id="cr-month" type="month" value="${defStart.slice(0, 7)}" />
        </div>
        <div class="form-grid-2">
          <div class="field"><label>From Date</label><input id="cr-from" type="date" value="${defStart}" required /></div>
          <div class="field"><label>To Date</label><input id="cr-to" type="date" value="${defEnd}" required /></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Apply Date Range</button>
        </div>
      </form>`);
    document.getElementById("cr-month").onchange = (e) => {
      if (!e.target.value) return;
      const [y, m] = e.target.value.split("-").map(Number);
      const s = new Date(y, m - 1, 1);
      const en = new Date(y, m, 0);
      document.getElementById("cr-from").value = formatDateYMD(s);
      document.getElementById("cr-to").value = formatDateYMD(en);
    };
    document.getElementById("custom-range-form").onsubmit = (e) => {
      e.preventDefault();
      customPeriodStart = document.getElementById("cr-from").value;
      customPeriodEnd = document.getElementById("cr-to").value;
      if (customPeriodStart > customPeriodEnd) {
        const tmp = customPeriodStart; customPeriodStart = customPeriodEnd; customPeriodEnd = tmp;
      }
      currentPeriod = "custom";
      const gp = document.getElementById("global-period-select");
      if (gp) gp.value = "custom";
      closeModal("sub-modal");
      if (onApplied) onApplied();
      else switchView(currentView);
    };
  }

  function renderOverview(root) {
    const { start, end, label } = getPeriodBounds();
    const txs = getTransactionsInRange(start, end);
    const totalCredits = txs.filter((t) => t.type === "income").reduce((s, t) => s + txBaseAmount(t), 0);
    const totalDebits = txs.filter((t) => t.type === "expense").reduce((s, t) => s + txBaseAmount(t), 0);
    const net = totalCredits - totalDebits;
    const savingsRate = totalCredits > 0 ? Math.round((net / totalCredits) * 100) : 0;
    const liquid = getLiquidBalance();
    const creditCount = txs.filter((t) => t.type === "income").length;
    const debitCount = txs.filter((t) => t.type === "expense").length;

    // Daily safe-to-spend check for current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthExp = getTransactionsInRange(monthStart, now).filter((t) => t.type === "expense").reduce((s, t) => s + txBaseAmount(t), 0);
    const cap = Number(state.settings.monthlyOverallCap) || 0;

    const monthCatMap = getCategorySpendingMap(getTransactionsInRange(monthStart, new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)));
    const budgetHtml = (state.budgets || []).slice(0, 4).map((b) => {
      const cat = getCat(b.category);
      const spent = monthCatMap[b.category] || 0;
      const pct = Math.min(100, Math.round((spent / Math.max(1, b.limit)) * 100));
      const color = pct >= 100 ? "var(--rose)" : pct >= 78 ? "var(--amber)" : "var(--emerald)";
      return `
        <div style="margin-bottom:12px;">
          <div class="flex-between text-sm mb-2">
            <span>${cat.icon} <strong>${esc(cat.name)}</strong></span>
            <span class="money-val">${fmtMoney(spent)} <span class="muted">/ ${fmtMoney(b.limit)}</span></span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${color};"></div></div>
        </div>`;
    }).join("");

    const insights = generateSmartInsights(txs);
    const recent = [...txs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

    root.innerHTML = `
      <div class="date-range-bar flex-between">
        <div class="flex-gap" style="flex-wrap:wrap;">
          <span class="text-xs muted" style="font-weight:600;">Active Range:</span>
          <strong class="text-sm">${esc(label)}</strong>
          <span class="tag-chip">${esc(formatDateYMD(start))} &rarr; ${esc(formatDateYMD(end))}</span>
        </div>
        <div class="flex-gap" style="flex-wrap:wrap;">
          <button class="btn btn-secondary btn-xs" id="ov-ask-ai-btn">✨ Ask AI</button>
          <button class="btn btn-secondary btn-xs" id="ov-change-range-btn">Change Month / Date Range</button>
          <button class="btn btn-primary btn-xs" id="ov-open-bank-ledger-btn">Open Bank Ledger (Dr/Cr)</button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card clickable" id="kpi-avail-card" title="Click to inspect Accounts & Cards">
          <div class="kpi-top"><span class="kpi-label">Available Balance</span><span class="kpi-icon" style="background:var(--primary-soft);color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></span></div>
          <div class="kpi-val money-val">${fmtMoney(liquid)}</div>
          <div class="kpi-foot"><span class="delta-pill delta-neutral">${(state.accounts || []).length} account(s)</span><span class="kpi-source-link">Accounts &rarr;</span></div>
        </div>
        <div class="kpi-card clickable" id="kpi-credits-card" title="Click to open Dr. Side (Total Credits) in Bank Ledger">
          <div class="kpi-top"><span class="kpi-label">Total Credits (${esc(label)})</span><span class="kpi-icon" style="background:var(--emerald-soft);color:var(--emerald);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></span></div>
          <div class="kpi-val money-val amount-income">${fmtMoney(totalCredits)}</div>
          <div class="kpi-foot"><span class="delta-pill delta-up">${creditCount} credit(s)</span><span class="kpi-source-link">Bank Ledger Dr. &rarr;</span></div>
        </div>
        <div class="kpi-card clickable" id="kpi-debits-card" title="Click to open Cr. Side (Total Debits) in Bank Ledger">
          <div class="kpi-top"><span class="kpi-label">Total Debits (${esc(label)})</span><span class="kpi-icon" style="background:var(--rose-soft);color:var(--rose);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg></span></div>
          <div class="kpi-val money-val">${fmtMoney(totalDebits)}</div>
          <div class="kpi-foot"><span class="delta-pill delta-neutral">${debitCount} debit(s)</span><span class="kpi-source-link">Bank Ledger Cr. &rarr;</span></div>
        </div>
        <div class="kpi-card clickable" id="kpi-net-card" title="Click to view Net Savings breakdown in Monthly Intelligence & Bank Ledger">
          <div class="kpi-top"><span class="kpi-label">Net Savings (${esc(label)})</span><span class="kpi-icon" style="background:var(--sky-soft);color:var(--sky);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span></div>
          <div class="kpi-val money-val" style="color:${net >= 0 ? "var(--emerald)" : "var(--rose)"};">${fmtMoney(net, null, true)}</div>
          <div class="kpi-foot"><span class="delta-pill ${savingsRate >= 20 ? "delta-up" : "delta-neutral"}">${savingsRate}% rate</span><span class="kpi-source-link">Source Summary &rarr;</span></div>
        </div>
      </div>

      <div class="grid-main-side mb-4">
        <div class="card">
          <div class="card-header">
            <div><h3 class="card-title">6-Month Cash Flow</h3><p class="card-subtitle">Total Credits (emerald) vs Total Debits (indigo) — hover for exact figures</p></div>
          </div>
          <div id="overview-cashflow-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div><h3 class="card-title">Debits by Category</h3><p class="card-subtitle">${esc(label)} — click a slice to view matching entries</p></div>
          </div>
          <div id="overview-donut-chart"></div>
        </div>
      </div>

      <div class="grid-main-side">
        <div class="card">
          <div class="card-header">
            <div><h3 class="card-title">Activity (${esc(label)})</h3><p class="card-subtitle">Click any row to edit or reassign its Separate Ledger</p></div>
            <button class="btn btn-ghost btn-sm" id="ov-view-all-tx">View All &rarr;</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <tbody>
                ${recent.length ? recent.map((t) => renderTxMiniRow(t)).join("") : `<tr><td colspan="2" style="text-align:center;padding:34px;" class="muted">No entries in ${esc(label)}. Try changing the date range or importing a bank statement.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="card">
            <div class="card-header">
              <div><h3 class="card-title">Monthly Budget Pulse</h3><p class="card-subtitle">${cap > 0 ? `Overall cap: <span class="money-val">${fmtMoney(cap)}</span>` : "No monthly cap set yet"}</p></div>
              <button class="btn btn-ghost btn-sm" id="ov-manage-budgets">Manage</button>
            </div>
            ${budgetHtml || `<p class="muted text-sm">No category budgets configured yet.</p>`}
          </div>

          <div class="card">
            <div class="card-header"><h3 class="card-title">Smart Insights</h3></div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${insights.length ? insights.map((i) => `
                <div class="insight-item">
                  <span class="insight-dot" style="background:${i.color}"></span>
                  <div><strong class="text-sm">${esc(i.title)}</strong><div class="text-xs muted">${esc(i.desc)}</div></div>
                </div>`).join("") : `<p class="muted text-sm">Add entries or set budgets to see automated insights here.</p>`}
            </div>
          </div>
        </div>
      </div>
    `;

    renderCashFlowChart("overview-cashflow-chart");
    renderCategoryDonut("overview-donut-chart", txs);

    document.getElementById("ov-ask-ai-btn").onclick = () => switchView("ai");
    document.getElementById("ov-change-range-btn").onclick = () => openCustomRangePicker();
    document.getElementById("ov-open-bank-ledger-btn").onclick = () => {
      selectedLedgerId = "bank_all";
      switchView("ledgers");
    };
    document.getElementById("kpi-avail-card").onclick = () => switchView("accounts");
    document.getElementById("kpi-credits-card").onclick = () => {
      selectedLedgerId = "bank_all";
      ledgerMobileSide = "dr";
      customPeriodStart = formatDateYMD(start);
      customPeriodEnd = formatDateYMD(end);
      switchView("ledgers");
    };
    document.getElementById("kpi-debits-card").onclick = () => {
      selectedLedgerId = "bank_all";
      ledgerMobileSide = "cr";
      customPeriodStart = formatDateYMD(start);
      customPeriodEnd = formatDateYMD(end);
      switchView("ledgers");
    };
    document.getElementById("kpi-net-card").onclick = () => {
      selectedMonthKey = formatDateYMD(end).slice(0, 7);
      switchView("monthly");
    };
    document.getElementById("ov-view-all-tx").onclick = () => {
      txFilters.dateFrom = formatDateYMD(start);
      txFilters.dateTo = formatDateYMD(end);
      txFilters.type = "all";
      switchView("transactions");
    };
    document.getElementById("ov-manage-budgets").onclick = () => switchView("budgets");
    bindTxRowActions(root);
  }

  function renderTxMiniRow(t) {
    const cat = getCat(t.category);
    const sign = t.type === "income" ? "+" : t.type === "expense" ? "-" : "";
    const cls = t.type === "income" ? "amount-income" : t.type === "transfer" ? "amount-transfer" : "amount-expense";
    return `
      <tr data-edit-tx="${t.id}" style="cursor:pointer;">
        <td>
          <div class="tx-payee-cell">
            <div class="cat-avatar" style="background:${cat.color}1a;">${cat.icon}</div>
            <div>
              <strong>${esc(t.payee)}</strong>
              <div class="text-xs muted">${esc(cat.name)} &bull; ${fmtShortDate(t.date)}</div>
            </div>
          </div>
        </td>
        <td class="text-right">
          <div class="${cls} money-val">${sign}${fmtMoney(txBaseAmount(t))}</div>
          ${t.currency !== state.settings.currency ? `<div class="text-xs muted money-val">${fmtMoney(t.amount, t.currency)}</div>` : ""}
        </td>
      </tr>`;
  }

  /* ---------- Bank & Party Ledgers View (Line-Wise Ledgers Column + Bank Dr/Cr T-Account + Drawings Figure Range) ---------- */
  function openLedgerModal(editId = null) {
    const led = editId ? getLedger(editId) : null;
    const protectChecked = led ? (led.type !== "drawings" && !!led.protectedFromDrawings) : true;
    openSubModal(led ? "Edit Separate Ledger" : "Create Separate Ledger", `
      <form id="ledger-edit-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field">
          <label>Ledger / Person Name <span class="req">*</span></label>
          <input id="lf-name" required value="${led ? esc(led.name) : ""}" placeholder="e.g. Rahul Kumar, Drawings, Office Rent, Supplier" />
        </div>
        <div class="form-grid-2">
          <div class="field">
            <label>Ledger Type</label>
            <select id="lf-type">
              <option value="person" ${!led || led.type === "person" ? "selected" : ""}>Personal / Party Account</option>
              <option value="drawings" ${led?.type === "drawings" ? "selected" : ""}>Drawings (Self / Personal Withdrawals)</option>
              <option value="vendor" ${led?.type === "vendor" ? "selected" : ""}>Vendor / Supplier</option>
              <option value="other" ${led?.type === "other" ? "selected" : ""}>Other Separate Ledger</option>
            </select>
          </div>
          <div class="field">
            <label>Aliases / Bank Narration Keywords</label>
            <input id="lf-aliases" value="${led && led.aliases ? esc(led.aliases.join(", ")) : ""}" placeholder="e.g. rahul@ybl, 9876543210" />
          </div>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" id="lf-protect" ${protectChecked ? "checked" : ""} />
          <span>Keep Separate (protect from Drawings figure-range consolidation)</span>
        </label>
        <div class="field">
          <label>Notes</label>
          <input id="lf-notes" value="${led ? esc(led.notes || "") : ""}" placeholder="Optional purpose or relationship" />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">${led ? "Save Ledger" : "Create Ledger"}</button>
        </div>
      </form>`);
    document.getElementById("ledger-edit-form").onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById("lf-name").value.trim();
      const type = document.getElementById("lf-type").value;
      const aliases = document.getElementById("lf-aliases").value.split(",").map((s) => s.trim()).filter(Boolean);
      const protectedFromDrawings = type !== "drawings" && document.getElementById("lf-protect").checked;
      const notes = document.getElementById("lf-notes").value.trim();
      if (!name) return;
      if (led) {
        led.name = name; led.type = type; led.aliases = aliases; led.notes = notes;
        led.protectedFromDrawings = protectedFromDrawings;
      } else {
        const palette = ["#4f46e5", "#10b981", "#0ea5e9", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316"];
        const created = {
          id: uid("led"), name, type, aliases, notes,
          isUserCreated: true,
          protectedFromDrawings,
          color: type === "drawings" ? "#f59e0b" : palette[(state.ledgers || []).length % palette.length]
        };
        state.ledgers.push(created);
        selectedLedgerId = created.id;
      }
      saveState(); closeModal("sub-modal"); switchView("ledgers");
      toast(led ? "Ledger updated." : "Separate ledger created & protected.");
    };
  }

  function openAssignLedgerModal(txId) {
    const tx = (state.transactions || []).find((t) => t.id === txId);
    if (!tx) return;
    const ledOpts = (state.ledgers || []).map((l) => `<option value="${l.id}" ${tx.ledgerId === l.id ? "selected" : ""}>${l.type === "drawings" ? "💸" : (l.protectedFromDrawings || l.isUserCreated ? "🔒" : "👤")} ${esc(l.name)}</option>`).join("");
    openSubModal("Assign Separate Ledger / Drawings", `
      <form id="assign-led-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="text-sm" style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:10px;">
          <strong>${esc(tx.payee)}</strong> &bull; <strong class="money-val">${fmtMoney(txBaseAmount(tx))}</strong>
          <div class="text-xs muted">${esc(tx.notes || "")}</div>
        </div>
        <div class="field">
          <label>Select Separate Ledger or Drawings</label>
          <select id="al-select">
            <option value="">— Unassigned (Bank General) —</option>
            ${ledOpts}
          </select>
        </div>
        <div class="field">
          <label>Or Create New Separate Person Ledger (Protected)</label>
          <input id="al-new-name" placeholder="Type new person/party name (leave blank to use selection above)" value="" />
        </div>
        <label class="checkbox-label">
          <input type="checkbox" id="al-apply-similar" checked />
          <span>Also update matching "${esc(tx.payee)}" entries &amp; protect from Drawings range</span>
        </label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Assignment</button>
        </div>
      </form>`);
    document.getElementById("assign-led-form").onsubmit = (e) => {
      e.preventDefault();
      const newName = document.getElementById("al-new-name").value.trim();
      let targetLedId = document.getElementById("al-select").value;
      if (newName) {
        const created = findOrCreateLedger(newName, "person");
        if (created) {
          created.isUserCreated = true;
          created.protectedFromDrawings = true;
          targetLedId = created.id;
        }
      }
      const chosenLed = targetLedId ? getLedger(targetLedId) : null;
      if (chosenLed && chosenLed.type !== "drawings") {
        chosenLed.protectedFromDrawings = true;
      }
      const keepSep = !!(chosenLed && chosenLed.type !== "drawings");
      const applyAll = document.getElementById("al-apply-similar").checked;
      const pKey = normalizePayeeKey(tx.payee);
      if (applyAll && pKey) {
        let cnt = 0;
        for (const t of state.transactions || []) {
          if (normalizePayeeKey(t.payee) === pKey) {
            t.ledgerId = targetLedId || undefined;
            t.keepSeparateLedger = keepSep;
            if (targetLedId === "led_drawings" && t.costNature !== "fixed") t.tags = Array.from(new Set([...(t.tags || []), "drawings"]));
            cnt++;
          }
        }
        tx.ledgerId = targetLedId || undefined;
        tx.keepSeparateLedger = keepSep;
        learnFromTransaction(tx);
        toast(`Assigned ${cnt} matching entry(ies) & taught AI.`);
      } else {
        tx.ledgerId = targetLedId || undefined;
        tx.keepSeparateLedger = keepSep;
        learnFromTransaction(tx);
        toast("Ledger assignment saved.");
      }
      saveState();
      closeModal("sub-modal");
      switchView(currentView);
    };
  }

  function renderLedgersView(root) {
    const { start, end, label } = getPeriodBounds();
    const curStartStr = formatDateYMD(start);
    const curEndStr = formatDateYMD(end);

    const activeLed = selectedLedgerId !== "bank_all" ? getLedger(selectedLedgerId) : null;
    if (selectedLedgerId !== "bank_all" && !activeLed) selectedLedgerId = "bank_all";

    const matchesAcc = (t) => {
      if (ledgerAccountFilter === "all") return true;
      return t.accountId === ledgerAccountFilter || t.toAccountId === ledgerAccountFilter;
    };
    const isRowInflow = (t) => {
      if (t.type === "income") return true;
      if (t.type === "transfer" && ledgerAccountFilter !== "all" && t.toAccountId === ledgerAccountFilter) return true;
      return false;
    };
    const isRowOutflow = (t) => {
      if (t.type === "expense") return true;
      if (t.type === "transfer" && ledgerAccountFilter !== "all" && t.accountId === ledgerAccountFilter) return true;
      return false;
    };

    // Per-ledger stats across selected date range (keeps ALL parties separate in Ledger Directory!)
    const ledSums = {};
    for (const l of state.ledgers || []) ledSums[l.id] = { dr: 0, cr: 0, count: 0 };
    for (const t of (state.transactions || [])) {
      if (!matchesAcc(t) || !t.ledgerId) continue;
      const d = new Date(t.date);
      if (d < start || d > end) continue;
      if (!ledSums[t.ledgerId]) ledSums[t.ledgerId] = { dr: 0, cr: 0, count: 0 };
      const amt = txBaseAmount(t);
      if (isRowInflow(t)) ledSums[t.ledgerId].dr += amt;
      else if (isRowOutflow(t)) ledSums[t.ledgerId].cr += amt;
      ledSums[t.ledgerId].count++;
    }

    const subTabsHtml = `
      <div class="ledger-subtabs">
        <button type="button" class="tier-tab ${ledgerSubView === "bank" ? "active" : ""}" id="led-tab-bank">🏦 Bank &amp; Party Ledger</button>
        <button type="button" class="tier-tab ${ledgerSubView === "directory" ? "active" : ""}" id="led-tab-dir">📑 All Ledgers (${(state.ledgers || []).length})</button>
      </div>`;

    const isMobView = isMobileExperience();
    const commonToolbarHtml = `
      <div class="date-range-bar">
        <div class="ledger-bar-primary">
          <select id="led-acc-select">
            <option value="all">All Bank Accounts</option>
            ${(state.accounts || []).map((a) => `<option value="${a.id}" ${ledgerAccountFilter === a.id ? "selected" : ""}>${esc(formatAccountLabel(a))}</option>`).join("")}
          </select>
          <button type="button" class="btn btn-secondary btn-xs" id="led-add-bank-btn" title="Add Bank Account">+ Bank</button>
        </div>
        <details class="mobile-collapse-group" ${isMobView ? "" : "open"}>
          <summary class="mobile-collapse-summary">Date Range &amp; Ledger Actions &bull; <strong>${esc(label)}</strong></summary>
          <div class="ledger-bar-secondary">
            <input id="led-month-pick" type="month" value="${curStartStr.slice(0, 7)}" title="Jump to Month" />
            <label class="inline-date-field"><span class="text-xs muted">From</span><input id="led-from-date" type="date" value="${curStartStr}" /></label>
            <label class="inline-date-field"><span class="text-xs muted">To</span><input id="led-to-date" type="date" value="${curEndStr}" /></label>
            <button type="button" class="btn btn-secondary btn-sm" id="new-ledger-btn">+ New Ledger</button>
            <button type="button" class="btn btn-primary btn-sm" id="ai-sync-ledgers-btn">✨ AI Fetch Party Ledgers</button>
          </div>
        </details>
      </div>`;

    // SUB-VIEW 2: All Ledgers Line-Wise Directory (NO Drawings range option here!)
    if (ledgerSubView === "directory") {
      const q = ledgerDirSearch.trim().toLowerCase();
      const rows = (state.ledgers || []).filter((l) => {
        if (ledgerDirType !== "all" && l.type !== ledgerDirType) return false;
        if (q && !l.name.toLowerCase().includes(q) && !(l.notes || "").toLowerCase().includes(q)) return false;
        return true;
      });

      root.innerHTML = `
        ${subTabsHtml}
        ${commonToolbarHtml}
        <div class="filter-bar">
          <input id="led-dir-search" class="search-box" type="search" placeholder="Search person, party, drawings, or vendor ledger..." value="${esc(ledgerDirSearch)}" />
          <select id="led-dir-type">
            <option value="all" ${ledgerDirType === "all" ? "selected" : ""}>All Ledger Types</option>
            <option value="person" ${ledgerDirType === "person" ? "selected" : ""}>Personal / Party Accounts</option>
            <option value="drawings" ${ledgerDirType === "drawings" ? "selected" : ""}>Drawings</option>
            <option value="vendor" ${ledgerDirType === "vendor" ? "selected" : ""}>Vendor / Supplier</option>
            <option value="other" ${ledgerDirType === "other" ? "selected" : ""}>Other</option>
          </select>
        </div>

        <div class="card" style="padding:0;overflow:hidden;">
          <div class="card-header" style="padding:14px 16px;margin:0;border-bottom:1px solid var(--border);">
            <div>
              <h3 class="card-title">All Party &amp; Separate Ledgers — Line-by-Line (${rows.length})</h3>
              <p class="card-subtitle">All transaction parties are kept separately here for ${esc(label)}. Click any ledger line to view its Dr/Cr account.</p>
            </div>
          </div>
          <div class="table-wrap" style="border:none;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ledger / Party Name</th>
                  <th>Type</th>
                  <th>Rule Protection</th>
                  <th class="text-right">Entries</th>
                  <th class="text-right">Dr. Inflows</th>
                  <th class="text-right">Cr. Outflows</th>
                  <th class="text-right">Net Balance</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rows.length ? rows.map((l, idx) => {
                  const st = ledSums[l.id] || { dr: 0, cr: 0, count: 0 };
                  const netL = st.dr - st.cr;
                  const isProt = l.type !== "drawings" && (l.protectedFromDrawings || l.isUserCreated);
                  return `
                    <tr>
                      <td class="text-xs muted">${idx + 1}</td>
                      <td>
                        <button type="button" class="link-btn" data-open-dir-led="${l.id}" style="text-align:left;">
                          ${l.type === "drawings" ? "💸" : isProt ? "🔒" : "👤"} ${esc(l.name)}
                        </button>
                        ${l.notes ? `<div class="text-xs muted">${esc(l.notes)}</div>` : ""}
                      </td>
                      <td><span class="tag-chip">${esc(l.type)}</span></td>
                      <td>
                        ${l.type === "drawings"
                          ? `<span class="badge cost-pill-variable">Drawings Bucket</span>`
                          : isProt
                            ? `<span class="badge delta-up">Protected (Always Separate)</span>`
                            : `<span class="badge delta-neutral">Auto Party (Follows Range)</span>`}
                      </td>
                      <td class="text-right">${st.count}</td>
                      <td class="text-right money-val amount-income">${fmtMoney(st.dr)}</td>
                      <td class="text-right money-val">${fmtMoney(st.cr)}</td>
                      <td class="text-right money-val" style="color:${netL >= 0 ? "var(--emerald)" : "var(--rose)"};"><strong>${fmtMoney(netL, null, true)}</strong></td>
                      <td class="text-right" style="white-space:nowrap;">
                        ${l.type !== "drawings" ? `<button type="button" class="btn btn-ghost btn-xs" data-toggle-prot="${l.id}">${isProt ? "Unprotect" : "Protect"}</button>` : ""}
                        <button type="button" class="btn btn-ghost btn-xs" data-edit-led="${l.id}">Edit</button>
                        ${l.id !== "led_drawings" ? `<button type="button" class="btn btn-ghost btn-xs" style="color:var(--rose);" data-del-led="${l.id}">Del</button>` : ""}
                      </td>
                    </tr>`;
                }).join("") : `<tr><td colspan="9" class="muted text-sm" style="text-align:center;padding:34px;">No separate ledgers found. Click <strong>+ New Ledger</strong> or <strong>✨ AI Fetch Party Ledgers</strong>.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;

      bindLedgerCommonEvents(root);
      document.getElementById("led-dir-search").oninput = (e) => {
        ledgerDirSearch = e.target.value;
        const pos = e.target.selectionStart;
        renderLedgersView(root);
        const inp = document.getElementById("led-dir-search");
        if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (_) {} }
      };
      document.getElementById("led-dir-type").onchange = (e) => { ledgerDirType = e.target.value; renderLedgersView(root); };
      root.querySelectorAll("[data-open-dir-led]").forEach((b) => {
        b.onclick = () => { selectedLedgerId = b.dataset.openDirLed; ledgerSubView = "bank"; renderLedgersView(root); };
      });
      root.querySelectorAll("[data-toggle-prot]").forEach((b) => {
        b.onclick = () => {
          const l = getLedger(b.dataset.toggleProt);
          if (!l) return;
          l.protectedFromDrawings = !(l.protectedFromDrawings || l.isUserCreated);
          l.isUserCreated = l.protectedFromDrawings;
          saveState();
          renderLedgersView(root);
          toast(l.protectedFromDrawings ? `"${l.name}" protected — always stays separate.` : `"${l.name}" unprotected.`);
        };
      });
      root.querySelectorAll("[data-edit-led]").forEach((b) => { b.onclick = () => openLedgerModal(b.dataset.editLed); });
      root.querySelectorAll("[data-del-led]").forEach((b) => {
        b.onclick = () => {
          const lid = b.dataset.delLed;
          for (const t of state.transactions || []) {
            if (t.ledgerId === lid) { t.ledgerId = undefined; t.keepSeparateLedger = false; }
          }
          state.ledgers = (state.ledgers || []).filter((x) => x.id !== lid);
          if (selectedLedgerId === lid) selectedLedgerId = "bank_all";
          saveState(); updateSidebarMeta(); renderLedgersView(root); toast("Separate ledger deleted.");
        };
      });
      return;
    }

    // SUB-VIEW 1: Bank & Party Ledger (T-Account + Line-Wise Column + Drawings Figure Range)
    const dRule = state.settings.drawingsRule || { enabled: false, min: 1, max: 500, side: "debits" };
    const matchesLed = (t) => (!activeLed ? true : t.ledgerId === activeLed.id);
    const allEligible = (state.transactions || []).filter((t) => matchesAcc(t) && matchesLed(t));

    // Opening Balance strictly before start date
    let openingBal = 0;
    if (!activeLed) {
      openingBal = (state.accounts || [])
        .filter((a) => ledgerAccountFilter === "all" || a.id === ledgerAccountFilter)
        .reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
    }
    for (const t of allEligible) {
      const d = new Date(t.date);
      if (d < start) {
        const amt = txBaseAmount(t);
        if (isRowInflow(t)) openingBal += amt;
        else if (isRowOutflow(t)) openingBal -= amt;
      }
    }

    const inRange = allEligible
      .filter((t) => { const d = new Date(t.date); return d >= start && d <= end; })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const drRows = [];
    const crRows = [];
    const consolidatedDrawingsDr = [];
    const consolidatedDrawingsCr = [];
    let drTxSum = 0;
    let crTxSum = 0;

    const shouldConsolidateToDrawings = (t, amt, inflow) => {
      if (activeLed || !dRule.enabled) return false;
      const led = getLedger(t.ledgerId);
      // Explicit Drawings ledger always consolidates into Drawings summary when enabled
      if (t.ledgerId === "led_drawings") return true;
      // Exception: User-created / Protected Separate Ledgers or explicitly pinned entries are NEVER hampered!
      if (t.keepSeparateLedger || (led && (led.protectedFromDrawings || led.isUserCreated))) return false;
      // Check side filter & figure range
      if (dRule.side === "debits" && inflow) return false;
      const minV = Number(dRule.min) || 0;
      const maxV = Number(dRule.max) || 0;
      return amt >= minV && (maxV <= 0 || amt <= maxV);
    };

    for (const t of inRange) {
      const amt = txBaseAmount(t);
      if (isRowInflow(t)) {
        drTxSum += amt;
        if (shouldConsolidateToDrawings(t, amt, true)) consolidatedDrawingsDr.push({ tx: t, amt });
        else drRows.push({ tx: t, amt });
      } else if (isRowOutflow(t)) {
        crTxSum += amt;
        if (shouldConsolidateToDrawings(t, amt, false)) consolidatedDrawingsCr.push({ tx: t, amt });
        else crRows.push({ tx: t, amt });
      }
    }

    const closingBal = Math.round((openingBal + drTxSum - crTxSum) * 100) / 100;
    const balancedTotal = Math.max(
      (openingBal > 0 ? openingBal : 0) + drTxSum + (closingBal < 0 ? Math.abs(closingBal) : 0),
      (openingBal < 0 ? Math.abs(openingBal) : 0) + crTxSum + (closingBal > 0 ? closingBal : 0)
    );

    const renderLedChip = (t) => {
      const led = getLedger(t.ledgerId);
      if (led) {
        const icon = led.type === "drawings" ? "💸" : (led.protectedFromDrawings || led.isUserCreated ? "🔒" : "👤");
        return `<button type="button" class="ledger-chip-btn" data-assign-led="${t.id}" title="Click to assign Separate Ledger or Drawings">${icon} ${esc(led.name)}</button>`;
      }
      return `<button type="button" class="ledger-chip-btn" data-assign-led="${t.id}" style="color:var(--text-muted);" title="Assign to Separate Ledger or Drawings">+ Assign</button>`;
    };

    const renderConsolidatedDrawingsRow = (items, sidePrefix) => {
      if (!items.length) return "";
      const sumAmt = items.reduce((s, x) => s + x.amt, 0);
      return `
        <tr style="background:var(--amber-soft);">
          <td class="text-xs muted">${esc(curStartStr)}–${esc(curEndStr.slice(5))}</td>
          <td>
            <div class="flex-between" style="gap:6px;flex-wrap:wrap;">
              <strong>${sidePrefix} Drawings (Consolidated ₹${Number(dRule.min) || 0}–₹${Number(dRule.max) || 0})</strong>
              <button type="button" class="ledger-chip-btn" data-toggle-drawings-expand="1">${drawingsExpanded ? "Hide" : `View ${items.length}`}</button>
            </div>
            <div class="text-xs muted">${items.length} unpinned/range entries consolidated (protected ledgers excluded)</div>
          </td>
          <td class="text-right money-val"><strong>${fmtMoney(sumAmt)}</strong></td>
        </tr>
        ${drawingsExpanded ? items.map(({ tx, amt }) => `
          <tr style="background:var(--bg);">
            <td class="text-xs muted" style="padding-left:16px;">↳ ${fmtShortDate(tx.date)}</td>
            <td>
              <div class="flex-between" style="gap:6px;flex-wrap:wrap;">
                <span class="text-xs">${sidePrefix} ${esc(tx.payee)}</span>
                ${renderLedChip(tx)}
              </div>
            </td>
            <td class="text-right money-val text-xs">${fmtMoney(amt)}</td>
          </tr>`).join("") : ""}`;
    };

    const drBodyHtml = `
      ${openingBal > 0.009 && !activeLed ? `
        <tr style="background:var(--emerald-soft);">
          <td class="text-xs muted">${esc(curStartStr)}</td>
          <td><strong>To Balance b/d (Opening)</strong><div class="text-xs muted">Opening balance brought forward</div></td>
          <td class="text-right money-val amount-income">${fmtMoney(openingBal)}</td>
        </tr>` : ""}
      ${renderConsolidatedDrawingsRow(consolidatedDrawingsDr, "To")}
      ${drRows.map(({ tx, amt }) => `
        <tr>
          <td class="text-xs muted" style="white-space:nowrap;">${fmtShortDate(tx.date)}</td>
          <td>
            <div class="flex-between" style="gap:6px;flex-wrap:wrap;">
              <strong>To ${esc(tx.payee)}</strong>
              ${renderLedChip(tx)}
            </div>
            <div class="text-xs muted">${esc(getCat(tx.category).name)} &bull; ${esc(tx.method || "")}${tx.refId ? ` &bull; ${esc(tx.refId)}` : ""}</div>
          </td>
          <td class="text-right money-val amount-income"><strong>${fmtMoney(amt)}</strong></td>
        </tr>`).join("")}
      ${!drRows.length && !consolidatedDrawingsDr.length && !(openingBal > 0.009 && !activeLed) ? `<tr><td colspan="3" class="muted text-sm" style="text-align:center;padding:28px;">No Dr. Side inflows in this period.</td></tr>` : ""}
      ${closingBal < -0.009 && !activeLed ? `
        <tr style="background:var(--surface-2);">
          <td class="text-xs muted">${esc(curEndStr)}</td>
          <td><strong>To Balance c/d (Overdraft Closing)</strong></td>
          <td class="text-right money-val">${fmtMoney(Math.abs(closingBal))}</td>
        </tr>` : ""}`;

    const crBodyHtml = `
      ${openingBal < -0.009 && !activeLed ? `
        <tr style="background:var(--rose-soft);">
          <td class="text-xs muted">${esc(curStartStr)}</td>
          <td><strong>By Balance b/d (Opening Overdraft)</strong></td>
          <td class="text-right money-val">${fmtMoney(Math.abs(openingBal))}</td>
        </tr>` : ""}
      ${renderConsolidatedDrawingsRow(consolidatedDrawingsCr, "By")}
      ${crRows.map(({ tx, amt }) => `
        <tr>
          <td class="text-xs muted" style="white-space:nowrap;">${fmtShortDate(tx.date)}</td>
          <td>
            <div class="flex-between" style="gap:6px;flex-wrap:wrap;">
              <strong>By ${esc(tx.payee)}</strong>
              ${renderLedChip(tx)}
            </div>
            <div class="text-xs muted">${esc(getCat(tx.category).name)} &bull; ${esc(tx.method || "")}${tx.refId ? ` &bull; ${esc(tx.refId)}` : ""}</div>
          </td>
          <td class="text-right money-val"><strong>${fmtMoney(amt)}</strong></td>
        </tr>`).join("")}
      ${!crRows.length && !consolidatedDrawingsCr.length && !(openingBal < -0.009 && !activeLed) ? `<tr><td colspan="3" class="muted text-sm" style="text-align:center;padding:28px;">No Cr. Side outflows in this period.</td></tr>` : ""}
      ${closingBal > 0.009 && !activeLed ? `
        <tr style="background:var(--primary-soft);">
          <td class="text-xs muted">${esc(curEndStr)}</td>
          <td><strong>By Balance c/d (Closing Balance)</strong><div class="text-xs muted">Carried forward to next period</div></td>
          <td class="text-right money-val"><strong>${fmtMoney(closingBal)}</strong></td>
        </tr>` : ""}`;

    const combinedRowsHtml = inRange.map((t) => {
      const inflow = isRowInflow(t);
      const amt = txBaseAmount(t);
      return `
        <tr>
          <td class="text-xs muted">${fmtShortDate(t.date)}</td>
          <td>
            <div class="flex-between" style="gap:6px;flex-wrap:wrap;">
              <strong>${inflow ? "To" : "By"} ${esc(t.payee)}</strong>
              ${renderLedChip(t)}
            </div>
            <div class="text-xs muted">${esc(getCat(t.category).name)} &bull; ${esc(t.method || "")}</div>
          </td>
          <td class="text-right money-val amount-income">${inflow ? fmtMoney(amt) : ""}</td>
          <td class="text-right money-val">${!inflow ? fmtMoney(amt) : ""}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="4" class="muted text-sm" style="text-align:center;padding:28px;">No entries in selected range.</td></tr>`;

    const lineSearchQ = ledgerLineSearch.trim().toLowerCase();
    const sidebarLedgers = (state.ledgers || []).filter((l) => !lineSearchQ || l.name.toLowerCase().includes(lineSearchQ));

    root.innerHTML = `
      ${subTabsHtml}
      <div class="date-range-bar">
        <div class="ledger-bar-primary">
          <select id="led-view-select">
            <option value="bank_all" ${selectedLedgerId === "bank_all" ? "selected" : ""}>🏦 Bank Ledger (Final Dr/Cr)</option>
            ${(state.ledgers || []).map((l) => `<option value="${l.id}" ${selectedLedgerId === l.id ? "selected" : ""}>${l.type === "drawings" ? "💸" : (l.protectedFromDrawings || l.isUserCreated ? "🔒" : "👤")} ${esc(l.name)}</option>`).join("")}
          </select>
          <div id="led-acc-wrap" class="flex-gap">
            <select id="led-acc-select">
              <option value="all">All Bank Accounts</option>
              ${(state.accounts || []).map((a) => `<option value="${a.id}" ${ledgerAccountFilter === a.id ? "selected" : ""}>${esc(formatAccountLabel(a))}</option>`).join("")}
            </select>
            <button type="button" class="btn btn-secondary btn-xs" id="led-add-bank-btn" title="Add Bank Account">+ Bank</button>
          </div>
        </div>
        <details class="mobile-collapse-group" ${isMobView ? "" : "open"}>
          <summary class="mobile-collapse-summary">Date Range, Actions &amp; Export &bull; <strong>${esc(label)}</strong></summary>
          <div class="ledger-bar-secondary">
            <input id="led-month-pick" type="month" value="${curStartStr.slice(0, 7)}" title="Jump to Month" />
            <label class="inline-date-field"><span class="text-xs muted">From</span><input id="led-from-date" type="date" value="${curStartStr}" /></label>
            <label class="inline-date-field"><span class="text-xs muted">To</span><input id="led-to-date" type="date" value="${curEndStr}" /></label>
            <button type="button" class="btn btn-secondary btn-sm" id="new-ledger-btn">+ New Ledger</button>
            <button type="button" class="btn btn-primary btn-sm" id="ai-sync-ledgers-btn">✨ AI Fetch Party Ledgers</button>
            <button type="button" class="btn btn-ghost btn-sm" id="export-ledger-btn">Export CSV</button>
          </div>
        </details>
      </div>

      <!-- Drawings Figure Range Control (ONLY on Bank & Party Ledger page) -->
      ${!activeLed ? `
        <div class="drawings-rule-card">
          <div class="drawings-rule-head">
            <label class="checkbox-label">
              <input type="checkbox" id="led-drawings-enabled" ${dRule.enabled ? "checked" : ""} />
              <span><strong>Consolidate Drawings Figure Range</strong></span>
            </label>
            <div class="text-xs muted">Consolidates range entries under Drawings in Bank Ledger — user-created &amp; 🔒 Protected Separate Ledgers stay intact.</div>
          </div>
          <div class="drawings-rule-controls">
            <label class="inline-date-field"><span class="text-xs muted">Min ₹</span><input id="led-draw-min" type="number" min="0" step="50" value="${Number(dRule.min) || 0}" /></label>
            <label class="inline-date-field"><span class="text-xs muted">Max ₹</span><input id="led-draw-max" type="number" min="1" step="50" value="${Number(dRule.max) || 500}" /></label>
            <select id="led-draw-side">
              <option value="debits" ${dRule.side !== "both" ? "selected" : ""}>Outflows / Debits Only</option>
              <option value="both" ${dRule.side === "both" ? "selected" : ""}>Both Credits &amp; Debits</option>
            </select>
            <button type="button" class="btn btn-primary btn-xs" id="led-draw-apply-btn">Apply Range</button>
          </div>
        </div>` : `
        <div class="flex-between mb-3" style="padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;flex-wrap:wrap;gap:8px;">
          <div>
            <strong>${activeLed.type === "drawings" ? "💸" : "🔒"} Viewing Separate Ledger: ${esc(activeLed.name)}</strong>
            <span class="tag-chip">${esc(activeLed.type)}</span>
            ${activeLed.protectedFromDrawings || activeLed.isUserCreated ? `<span class="badge delta-up">Protected from Drawings Range</span>` : ""}
          </div>
          <div class="flex-gap">
            <button type="button" class="btn btn-secondary btn-xs" id="edit-active-led-btn">Edit Ledger</button>
            <button type="button" class="btn btn-ghost btn-xs" data-pick-led="bank_all">&larr; Back to Final Bank Ledger</button>
          </div>
        </div>`}

      <div class="ledger-split-layout">
        <!-- Line-by-Line All Ledgers Column (Desktop sidebar column) -->
        <aside class="ledger-line-col desktop-only-panel">
          <div class="ledger-line-col-head">
            <div class="flex-between">
              <strong class="text-sm">All Ledgers (${(state.ledgers || []).length})</strong>
              <button type="button" class="link-btn text-xs" id="open-dir-tab-link">Full List &rarr;</button>
            </div>
            <input id="led-line-search" type="search" placeholder="Filter party line..." value="${esc(ledgerLineSearch)}" style="padding:6px 9px;font-size:12.5px;" />
          </div>
          <div class="ledger-line-list">
            <button type="button" class="ledger-line-row ${selectedLedgerId === "bank_all" ? "active" : ""}" data-pick-led="bank_all">
              <div>
                <div>🏦 Bank Ledger (Final)</div>
                <div class="ledger-line-meta">Consolidated Dr/Cr book</div>
              </div>
              <span class="money-val text-xs"><strong>${fmtMoney(closingBal)}</strong></span>
            </button>
            ${sidebarLedgers.map((l) => {
              const st = ledSums[l.id] || { dr: 0, cr: 0, count: 0 };
              const netL = st.dr - st.cr;
              const isProt = l.type !== "drawings" && (l.protectedFromDrawings || l.isUserCreated);
              return `
                <button type="button" class="ledger-line-row ${selectedLedgerId === l.id ? "active" : ""}" data-pick-led="${l.id}">
                  <div style="min-width:0;">
                    <div class="truncate">${l.type === "drawings" ? "💸" : isProt ? "🔒" : "👤"} ${esc(l.name)}</div>
                    <div class="ledger-line-meta">${st.count} entries &bull; ${esc(l.type)}</div>
                  </div>
                  <span class="money-val text-xs" style="color:${netL >= 0 ? "var(--emerald)" : "var(--text-muted)"};">${fmtMoney(Math.abs(netL))}</span>
                </button>`;
            }).join("")}
          </div>
        </aside>

        <!-- T-Account Bank / Party Ledger Pane -->
        <div style="min-width:0;">
          <div class="kpi-grid">
            <div class="kpi-card">
              <span class="kpi-label">${activeLed ? "Ledger Scope" : "Opening Balance"}</span>
              <div class="kpi-val money-val">${activeLed ? esc(activeLed.type.toUpperCase()) : fmtMoney(openingBal)}</div>
              <div class="kpi-foot"><span class="delta-pill delta-neutral">${esc(label)}</span></div>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Dr. Side (Inflows / Credits Received)</span>
              <div class="kpi-val money-val amount-income">${fmtMoney(drTxSum)}</div>
              <div class="kpi-foot"><span class="delta-pill delta-up">${drRows.length + consolidatedDrawingsDr.length} Dr. entries</span></div>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Cr. Side (Outflows / Payments)</span>
              <div class="kpi-val money-val">${fmtMoney(crTxSum)}</div>
              <div class="kpi-foot"><span class="delta-pill delta-neutral">${crRows.length + consolidatedDrawingsCr.length} Cr. entries</span></div>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">${activeLed ? "Net Party / Drawings" : "Closing Balance"}</span>
              <div class="kpi-val money-val" style="color:${closingBal >= 0 ? "var(--emerald)" : "var(--rose)"};">${fmtMoney(activeLed ? (drTxSum - crTxSum) : closingBal, null, !!activeLed)}</div>
              <div class="kpi-foot"><span class="delta-pill delta-neutral">${activeLed ? (drTxSum >= crTxSum ? "Net Inflow" : "Net Outflow") : (dRule.enabled ? "Drawings Rule On" : "Balanced T-Ledger")}</span></div>
            </div>
          </div>

          <div class="ledger-mobile-tabs mb-3">
            <button type="button" class="tier-tab ${ledgerMobileSide === "dr" ? "active" : ""}" data-mside="dr">Dr. Side (${drRows.length + (consolidatedDrawingsDr.length ? 1 : 0)})</button>
            <button type="button" class="tier-tab ${ledgerMobileSide === "cr" ? "active" : ""}" data-mside="cr">Cr. Side (${crRows.length + (consolidatedDrawingsCr.length ? 1 : 0)})</button>
            <button type="button" class="tier-tab ${ledgerMobileSide === "all" ? "active" : ""}" data-mside="all">Combined</button>
          </div>

          ${ledgerMobileSide === "all" ? `
            <div class="card" style="padding:0;overflow:hidden;">
              <div class="table-wrap" style="border:none;">
                <table class="t-ledger-table">
                  <thead><tr><th>Date</th><th>Particulars &amp; Separate Ledger</th><th class="text-right">Dr. (Inflow)</th><th class="text-right">Cr. (Outflow)</th></tr></thead>
                  <tbody>${combinedRowsHtml}</tbody>
                </table>
              </div>
            </div>
          ` : `
            <div class="t-ledger-grid">
              <div class="t-ledger-col ${ledgerMobileSide !== "dr" ? "mobile-hidden" : ""}">
                <div class="t-ledger-head t-ledger-head-dr">
                  <span>Dr. Side — Receipts / Inflows</span>
                  <span>${drRows.length + consolidatedDrawingsDr.length} entries</span>
                </div>
                <div class="t-ledger-body">
                  <table class="t-ledger-table">
                    <thead><tr><th>Date</th><th>To Particulars &amp; Ledger</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>${drBodyHtml}</tbody>
                  </table>
                </div>
                <div class="t-ledger-total">
                  <span>Total Dr.</span>
                  <span class="money-val amount-income">${fmtMoney(activeLed ? drTxSum : balancedTotal)}</span>
                </div>
              </div>

              <div class="t-ledger-col ${ledgerMobileSide !== "cr" ? "mobile-hidden" : ""}">
                <div class="t-ledger-head t-ledger-head-cr">
                  <span>Cr. Side — Payments / Outflows</span>
                  <span>${crRows.length + consolidatedDrawingsCr.length} entries</span>
                </div>
                <div class="t-ledger-body">
                  <table class="t-ledger-table">
                    <thead><tr><th>Date</th><th>By Particulars &amp; Ledger</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>${crBodyHtml}</tbody>
                  </table>
                </div>
                <div class="t-ledger-total">
                  <span>Total Cr.</span>
                  <span class="money-val">${fmtMoney(activeLed ? crTxSum : balancedTotal)}</span>
                </div>
              </div>
            </div>
          `}
        </div>
      </div>`;

    bindLedgerCommonEvents(root);
    document.getElementById("led-view-select").onchange = (e) => { selectedLedgerId = e.target.value; renderLedgersView(root); };
    const lineSearchInp = document.getElementById("led-line-search");
    if (lineSearchInp) {
      lineSearchInp.oninput = (e) => {
        ledgerLineSearch = e.target.value;
        const pos = e.target.selectionStart;
        renderLedgersView(root);
        const inp = document.getElementById("led-line-search");
        if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (_) {} }
      };
    }
    const dirTabLink = document.getElementById("open-dir-tab-link");
    if (dirTabLink) dirTabLink.onclick = () => { ledgerSubView = "directory"; renderLedgersView(root); };
    const editActiveBtn = document.getElementById("edit-active-led-btn");
    if (editActiveBtn && activeLed) editActiveBtn.onclick = () => openLedgerModal(activeLed.id);

    const applyDrawingsRule = () => {
      state.settings.drawingsRule = {
        enabled: !!document.getElementById("led-drawings-enabled")?.checked,
        min: Math.max(0, Number(document.getElementById("led-draw-min")?.value) || 0),
        max: Math.max(0, Number(document.getElementById("led-draw-max")?.value) || 0),
        side: document.getElementById("led-draw-side")?.value || "debits"
      };
      saveState();
      renderLedgersView(root);
      toast(state.settings.drawingsRule.enabled ? "Drawings range consolidation updated." : "Drawings range consolidation turned off.");
    };
    const drawChk = document.getElementById("led-drawings-enabled");
    if (drawChk) drawChk.onchange = applyDrawingsRule;
    const drawApply = document.getElementById("led-draw-apply-btn");
    if (drawApply) drawApply.onclick = applyDrawingsRule;

    document.getElementById("export-ledger-btn").onclick = () => {
      const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = ["Side", "Date", "Particulars", "SeparateLedger", "Category", "Method", "Ref", "Dr_Inflow", "Cr_Outflow"];
      const csvRows = inRange.map((t) => {
        const inf = isRowInflow(t);
        const amt = txBaseAmount(t).toFixed(2);
        const ledName = getLedger(t.ledgerId)?.name || "";
        return [
          inf ? "Dr" : "Cr", t.date.slice(0, 10), (inf ? "To " : "By ") + t.payee,
          ledName, getCat(t.category).name, t.method || "", t.refId || "",
          inf ? amt : "", !inf ? amt : ""
        ].map(escCsv).join(",");
      });
      const slug = (activeLed ? activeLed.name : "bank-ledger").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      downloadFile(`ledgerflow-${slug}-${curStartStr}-to-${curEndStr}.csv`, "\uFEFF" + [header.join(","), ...csvRows].join("\n"), "text/csv;charset=utf-8;");
      toast("Ledger CSV exported.");
    };

    root.querySelectorAll("[data-pick-led]").forEach((b) => {
      b.onclick = () => { selectedLedgerId = b.dataset.pickLed; renderLedgersView(root); };
    });
    root.querySelectorAll("[data-mside]").forEach((b) => {
      b.onclick = () => { ledgerMobileSide = b.dataset.mside; renderLedgersView(root); };
    });
    root.querySelectorAll("[data-assign-led]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); openAssignLedgerModal(b.dataset.assignLed); };
    });
    root.querySelectorAll("[data-toggle-drawings-expand]").forEach((b) => {
      b.onclick = () => { drawingsExpanded = !drawingsExpanded; renderLedgersView(root); };
    });

    function bindLedgerCommonEvents(scopeRoot) {
      document.getElementById("led-tab-bank").onclick = () => { ledgerSubView = "bank"; renderLedgersView(scopeRoot); };
      document.getElementById("led-tab-dir").onclick = () => { ledgerSubView = "directory"; renderLedgersView(scopeRoot); };
      document.getElementById("led-acc-select").onchange = (e) => { ledgerAccountFilter = e.target.value; renderLedgersView(scopeRoot); };
      document.getElementById("led-add-bank-btn").onclick = () => {
        openAccountModal(null, (created) => {
          ledgerAccountFilter = created.id;
          renderLedgersView(scopeRoot);
        });
      };
      document.getElementById("led-month-pick").onchange = (e) => {
        if (!e.target.value) return;
        const [y, m] = e.target.value.split("-").map(Number);
        customPeriodStart = formatDateYMD(new Date(y, m - 1, 1));
        customPeriodEnd = formatDateYMD(new Date(y, m, 0));
        currentPeriod = "custom";
        const gp = document.getElementById("global-period-select");
        if (gp) gp.value = "custom";
        renderLedgersView(scopeRoot);
      };
      const applyDates = () => {
        const f = document.getElementById("led-from-date").value;
        const t = document.getElementById("led-to-date").value;
        if (f && t) {
          customPeriodStart = f <= t ? f : t;
          customPeriodEnd = f <= t ? t : f;
          currentPeriod = "custom";
          const gp = document.getElementById("global-period-select");
          if (gp) gp.value = "custom";
          renderLedgersView(scopeRoot);
        }
      };
      document.getElementById("led-from-date").onchange = applyDates;
      document.getElementById("led-to-date").onchange = applyDates;
      document.getElementById("new-ledger-btn").onclick = () => openLedgerModal();
      document.getElementById("ai-sync-ledgers-btn").onclick = async () => {
        const btn = document.getElementById("ai-sync-ledgers-btn");
        btn.disabled = true; btn.textContent = "Fetching…";
        try {
          const res = await runHybridAIClassification(state.transactions || [], { onlyUncertain: true });
          let linked = 0;
          for (const t of state.transactions || []) {
            const rawSrc = t.rawNarration || t.notes || "";
            if (rawSrc && /^(imps|mmt|neft|rtgs|upi|by transfer|to transfer)/i.test(t.payee || "")) {
              const reparsed = parseBankNarration(rawSrc, t.type === "income");
              if (reparsed.payee && reparsed.payee.length >= 3 && !/^(imps|neft|rtgs|bank )/i.test(reparsed.payee)) {
                t.payee = reparsed.payee;
                if (reparsed.method) t.method = reparsed.method;
              }
            }
            const before = t.ledgerId;
            autoAssignLedgerForTx(t, rawSrc, true);
            if (t.ledgerId !== before) linked++;
          }
          await saveState();
          updateSidebarMeta();
          renderLedgersView(scopeRoot);
          toast(`✨ Synced ledgers: ${linked} entry(ies) linked via ${res.source}.`);
        } catch (err) {
          toast("Ledger AI sync failed: " + err.message);
        } finally {
          btn.disabled = false; btn.textContent = "✨ AI Fetch Party Ledgers";
        }
      };
    }
  }

  /* ---------- Transactions View ---------- */
  function getFilteredTransactions() {
    let list = [...(state.transactions || [])];
    const q = txFilters.search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        (t.payee || "").toLowerCase().includes(q) ||
        (t.notes || "").toLowerCase().includes(q) ||
        getCat(t.category).name.toLowerCase().includes(q) ||
        (t.tags || []).some((tg) => tg.toLowerCase().includes(q))
      );
    }
    if (txFilters.type !== "all") list = list.filter((t) => t.type === txFilters.type);
    if (txFilters.category !== "all") {
      list = list.filter((t) => t.category === txFilters.category || (t.splits && t.splits.some((s) => s.category === txFilters.category)));
    }
    if (txFilters.account !== "all") {
      list = list.filter((t) => t.accountId === txFilters.account || t.toAccountId === txFilters.account);
    }
    if (txFilters.ledger && txFilters.ledger !== "all") {
      list = list.filter((t) => t.ledgerId === txFilters.ledger);
    }
    if (txFilters.dateFrom) {
      const fDt = new Date(txFilters.dateFrom + "T00:00:00");
      list = list.filter((t) => new Date(t.date) >= fDt);
    }
    if (txFilters.dateTo) {
      const tDt = new Date(txFilters.dateTo + "T23:59:59.999");
      list = list.filter((t) => new Date(t.date) <= tDt);
    }
    if (txFilters.taxOnly) list = list.filter((t) => t.taxDeductible);

    list.sort((a, b) => {
      if (txFilters.sort === "date_asc") return new Date(a.date) - new Date(b.date);
      if (txFilters.sort === "amt_desc") return txBaseAmount(b) - txBaseAmount(a);
      if (txFilters.sort === "amt_asc") return txBaseAmount(a) - txBaseAmount(b);
      return new Date(b.date) - new Date(a.date);
    });
    return list;
  }

  function renderTransactionsView(root) {
    const filtered = getFilteredTransactions();
    const totalOut = filtered.filter((t) => t.type === "expense").reduce((s, t) => s + txBaseAmount(t), 0);
    const totalIn = filtered.filter((t) => t.type === "income").reduce((s, t) => s + txBaseAmount(t), 0);
    const isMobView = isMobileExperience();
    const activeFilterCount = (txFilters.type !== "all" ? 1 : 0)
      + (txFilters.category !== "all" ? 1 : 0)
      + (txFilters.account !== "all" ? 1 : 0)
      + (txFilters.dateFrom ? 1 : 0)
      + (txFilters.dateTo ? 1 : 0)
      + (txFilters.taxOnly ? 1 : 0);

    root.innerHTML = `
      <div class="filter-bar">
        <input id="flt-search" class="search-box" type="search" placeholder="Search merchant, notes, tags, or category..." value="${esc(txFilters.search)}" />
        <details class="mobile-collapse-group filter-collapse" ${isMobView ? "" : "open"}>
          <summary class="mobile-collapse-summary">Filters, Sort &amp; Tools${activeFilterCount ? ` (${activeFilterCount} active)` : ""}</summary>
          <div class="filter-controls-grid">
            <select id="flt-type">
              <option value="all" ${txFilters.type === "all" ? "selected" : ""}>All Types</option>
              <option value="expense" ${txFilters.type === "expense" ? "selected" : ""}>Expenses</option>
              <option value="income" ${txFilters.type === "income" ? "selected" : ""}>Income</option>
              <option value="transfer" ${txFilters.type === "transfer" ? "selected" : ""}>Transfers</option>
            </select>
            <select id="flt-cat">
              <option value="all">All Categories</option>
              ${(state.categories || []).map((c) => `<option value="${c.id}" ${txFilters.category === c.id ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}
            </select>
            <select id="flt-acc">
              <option value="all">All Accounts</option>
              ${(state.accounts || []).map((a) => `<option value="${a.id}" ${txFilters.account === a.id ? "selected" : ""}>${esc(formatAccountLabel(a))}</option>`).join("")}
            </select>
            <select id="flt-sort">
              <option value="date_desc" ${txFilters.sort === "date_desc" ? "selected" : ""}>Newest First</option>
              <option value="date_asc" ${txFilters.sort === "date_asc" ? "selected" : ""}>Oldest First</option>
              <option value="amt_desc" ${txFilters.sort === "amt_desc" ? "selected" : ""}>Highest Amount</option>
              <option value="amt_asc" ${txFilters.sort === "amt_asc" ? "selected" : ""}>Lowest Amount</option>
            </select>
            <input id="flt-from" type="date" value="${esc(txFilters.dateFrom || "")}" title="From Date" />
            <input id="flt-to" type="date" value="${esc(txFilters.dateTo || "")}" title="To Date" />
            <label class="checkbox-label"><input type="checkbox" id="flt-tax" ${txFilters.taxOnly ? "checked" : ""}/> Tax Only</label>
            <button class="btn btn-primary btn-sm" id="ai-classify-btn" title="Run Hybrid AI on uncertain/all filtered entries">✨ AI Classify</button>
            <button class="btn btn-secondary btn-sm" id="export-csv-btn">Export CSV</button>
          </div>
        </details>
      </div>

      <div class="flex-between mb-3" style="flex-wrap:wrap;gap:10px;">
        <div class="text-sm muted">
          Showing <strong>${filtered.length}</strong> entries &bull;
          Inflow: <strong class="amount-income money-val">${fmtMoney(totalIn)}</strong> &bull;
          Outflow: <strong class="money-val">${fmtMoney(totalOut)}</strong>
        </div>
        <div id="bulk-bar" class="${selectedTxIds.size ? "" : "hidden"} flex-gap">
          <span class="text-sm"><strong>${selectedTxIds.size}</strong> selected</span>
          <button class="btn btn-secondary btn-xs" id="bulk-cat-btn">Set Category</button>
          <button class="btn btn-danger btn-xs" id="bulk-del-btn">Delete Selected</button>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-wrap" style="border:none;">
          <table class="data-table tx-card-table">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" id="tx-select-all" ${filtered.length && selectedTxIds.size === filtered.length ? "checked" : ""}/></th>
                <th>Merchant & Details</th>
                <th>Category</th>
                <th>Account</th>
                <th>Date</th>
                <th class="text-right">Amount</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length ? filtered.map((t) => {
                const cat = getCat(t.category);
                const acc = getAcc(t.accountId);
                const toAcc = t.toAccountId ? getAcc(t.toAccountId) : null;
                const sign = t.type === "income" ? "+" : t.type === "expense" ? "-" : "";
                const cls = t.type === "income" ? "amount-income" : t.type === "transfer" ? "amount-transfer" : "amount-expense";
                return `
                  <tr>
                    <td><input type="checkbox" class="tx-row-chk" data-id="${t.id}" ${selectedTxIds.has(t.id) ? "checked" : ""}/></td>
                    <td>
                      <div class="tx-payee-cell">
                        <div class="cat-avatar" style="background:${cat.color}1a;">${cat.icon}</div>
                        <div>
                          <strong>${esc(t.payee)}</strong>
                          ${t.splits && t.splits.length ? `<span class="tag-chip">Split (${t.splits.length})</span>` : ""}
                          ${t.aiReason ? `<span class="tag-chip" title="${esc(t.aiReason)}" style="background:var(--primary-soft);color:var(--primary);">✨ AI</span>` : ""}
                          ${t.taxDeductible ? `<span class="tag-chip" style="color:var(--sky);">Tax Deductible</span>` : ""}
                          ${t.receipt ? `<button class="link-btn text-xs" data-view-receipt="${t.id}">📎 Receipt</button>` : ""}
                          <div class="text-xs muted">${esc(t.notes || t.method || "")} ${(t.tags || []).map((tg) => "#" + esc(tg)).join(" ")}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="badge" style="background:${cat.color}18;color:${cat.color};"><span class="badge-dot" style="background:${cat.color};"></span>${esc(cat.name)}</span></td>
                    <td class="text-sm">${esc(acc.name)}${toAcc ? ` &rarr; ${esc(toAcc.name)}` : ""}</td>
                    <td class="text-sm muted">${fmtShortDate(t.date)}</td>
                    <td class="text-right">
                      <div class="${cls} money-val">${sign}${fmtMoney(txBaseAmount(t))}</div>
                      ${t.currency !== state.settings.currency ? `<div class="text-xs muted money-val">${fmtMoney(t.amount, t.currency)}</div>` : ""}
                    </td>
                    <td class="text-right">
                      <button class="btn btn-ghost btn-xs" data-edit-tx="${t.id}">Edit</button>
                      <button class="btn btn-ghost btn-xs" style="color:var(--rose);" data-del-tx="${t.id}">Del</button>
                    </td>
                  </tr>`;
              }).join("") : `<tr><td colspan="7" style="text-align:center;padding:42px;" class="muted">No matching transactions found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById("flt-search").oninput = (e) => {
      txFilters.search = e.target.value;
      const pos = e.target.selectionStart;
      renderTransactionsView(root);
      const inp = document.getElementById("flt-search");
      if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (_) {} }
    };
    document.getElementById("flt-type").onchange = (e) => { txFilters.type = e.target.value; renderTransactionsView(root); };
    document.getElementById("flt-cat").onchange = (e) => { txFilters.category = e.target.value; renderTransactionsView(root); };
    document.getElementById("flt-acc").onchange = (e) => { txFilters.account = e.target.value; renderTransactionsView(root); };
    document.getElementById("flt-from").onchange = (e) => { txFilters.dateFrom = e.target.value; renderTransactionsView(root); };
    document.getElementById("flt-to").onchange = (e) => { txFilters.dateTo = e.target.value; renderTransactionsView(root); };
    document.getElementById("flt-sort").onchange = (e) => { txFilters.sort = e.target.value; renderTransactionsView(root); };
    document.getElementById("flt-tax").onchange = (e) => { txFilters.taxOnly = e.target.checked; renderTransactionsView(root); };
    document.getElementById("ai-classify-btn").onclick = async () => {
      const btn = document.getElementById("ai-classify-btn");
      btn.disabled = true;
      btn.textContent = "Classifying…";
      try {
        const res = await runHybridAIClassification(filtered, { onlyUncertain: false });
        await saveState();
        renderTransactionsView(root);
        toast(`✨ AI classified ${res.updated} entry(ies) via ${res.source}.`);
      } catch (err) {
        toast("AI classification failed: " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "✨ AI Classify";
      }
    };
    document.getElementById("export-csv-btn").onclick = () => exportTransactionsCSV(filtered);

    document.getElementById("tx-select-all").onchange = (e) => {
      if (e.target.checked) filtered.forEach((t) => selectedTxIds.add(t.id));
      else selectedTxIds.clear();
      renderTransactionsView(root);
    };
    root.querySelectorAll(".tx-row-chk").forEach((c) => {
      c.onchange = () => {
        if (c.checked) selectedTxIds.add(c.dataset.id);
        else selectedTxIds.delete(c.dataset.id);
        renderTransactionsView(root);
      };
    });

    const bulkDel = document.getElementById("bulk-del-btn");
    if (bulkDel) bulkDel.onclick = () => {
      state.transactions = state.transactions.filter((t) => !selectedTxIds.has(t.id));
      selectedTxIds.clear();
      saveState();
      toast("Selected transactions deleted.");
      renderTransactionsView(root);
      updateSidebarMeta();
    };

    const bulkCat = document.getElementById("bulk-cat-btn");
    if (bulkCat) bulkCat.onclick = () => openBulkCategoryModal();

    bindTxRowActions(root);
  }

  function bindTxRowActions(root) {
    root.querySelectorAll("[data-edit-tx]").forEach((el) => {
      el.onclick = () => openTxModal(el.dataset.editTx);
    });
    root.querySelectorAll("[data-del-tx]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        state.transactions = state.transactions.filter((t) => t.id !== el.dataset.delTx);
        saveState();
        toast("Transaction removed.");
        switchView(currentView);
      };
    });
    root.querySelectorAll("[data-view-receipt]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const tx = state.transactions.find((t) => t.id === el.dataset.viewReceipt);
        if (tx && tx.receipt) openReceiptViewer(tx.receipt);
      };
    });
  }

  /* ---------- Budgets View ---------- */
  function renderBudgetsView(root) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const curMap = getCategorySpendingMap(getTransactionsInRange(start, end));
    const prevMap = getCategorySpendingMap(getTransactionsInRange(prevStart, prevEnd));
    const totalSpent = Object.values(curMap).reduce((s, v) => s + v, 0);
    const cap = Number(state.settings.monthlyOverallCap) || 0;
    const daysInMonth = end.getDate();
    const dayOfMonth = now.getDate();
    const projected = Math.round((totalSpent / Math.max(1, dayOfMonth)) * daysInMonth);
    const capPct = cap > 0 ? Math.min(100, Math.round((totalSpent / cap) * 100)) : 0;

    root.innerHTML = `
      <div class="card mb-4">
        <div class="card-header">
          <div>
            <h3 class="card-title">Monthly Overall Spending Cap</h3>
            <p class="card-subtitle">Day ${dayOfMonth} of ${daysInMonth} &bull; Projected Month-End: <strong class="money-val">${fmtMoney(projected)}</strong></p>
          </div>
          <div class="flex-gap">
            <button class="btn btn-secondary btn-sm" id="edit-overall-cap-btn">${cap > 0 ? "Edit Monthly Cap" : "Set Monthly Cap"}</button>
            <button class="btn btn-primary btn-sm" id="add-budget-btn">+ New Category Budget</button>
          </div>
        </div>
        <div class="flex-between mb-2">
          <strong class="text-lg money-val">${fmtMoney(totalSpent)} spent</strong>
          <span class="muted money-val">${cap > 0 ? `Limit: ${fmtMoney(cap)} (${capPct}%)` : "No monthly cap set"}</span>
        </div>
        <div class="progress-track" style="height:12px;"><div class="progress-fill" style="width:${capPct}%;background:${capPct >= 100 ? "var(--rose)" : capPct >= 80 ? "var(--amber)" : "var(--primary)"};"></div></div>
      </div>

      ${(state.budgets || []).length ? `<div class="grid-3">
        ${(state.budgets || []).map((b) => {
          const cat = getCat(b.category);
          const spent = curMap[b.category] || 0;
          const prevSpent = prevMap[b.category] || 0;
          const rolloverBonus = b.rollover ? Math.max(0, b.limit - prevSpent) : 0;
          const effLimit = b.limit + rolloverBonus;
          const pct = Math.min(100, Math.round((spent / Math.max(1, effLimit)) * 100));
          const rem = effLimit - spent;
          const color = pct >= 100 ? "var(--rose)" : pct >= 78 ? "var(--amber)" : "var(--emerald)";
          return `
            <div class="card">
              <div class="flex-between mb-2">
                <div class="flex-gap"><span style="font-size:20px;">${cat.icon}</span><div><strong>${esc(cat.name)}</strong>${b.rollover ? `<div class="text-xs muted">Rollover +${fmtMoney(rolloverBonus)}</div>` : ""}</div></div>
                <button class="btn btn-ghost btn-xs" data-del-budget="${b.id}" style="color:var(--rose);">Remove</button>
              </div>
              <div class="flex-between text-sm mb-2">
                <span class="money-val"><strong>${fmtMoney(spent)}</strong> / ${fmtMoney(effLimit)}</span>
                <span class="delta-pill ${rem >= 0 ? "delta-up" : "delta-down"} money-val">${rem >= 0 ? fmtMoney(rem) + " left" : fmtMoney(Math.abs(rem)) + " over"}</span>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${color};"></div></div>
            </div>`;
        }).join("")}
      </div>` : `<div class="card muted text-sm" style="text-align:center;padding:36px;">No category budgets configured yet. Click <strong>+ New Category Budget</strong> to add your own limits.</div>`}
    `;

    document.getElementById("edit-overall-cap-btn").onclick = () => {
      openSubModal("Set Monthly Spending Cap", `
        <form id="cap-form" class="field">
          <label>Monthly Total Spending Target (${state.settings.currency}) — set 0 to clear</label>
          <input id="cap-input" type="number" min="0" step="100" value="${cap > 0 ? cap : ""}" placeholder="Enter monthly limit" required />
          <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Save Cap</button></div>
        </form>`);
      document.getElementById("cap-form").onsubmit = (e) => {
        e.preventDefault();
        state.settings.monthlyOverallCap = Math.max(0, Number(document.getElementById("cap-input").value) || 0);
        saveState(); closeModal("sub-modal"); renderBudgetsView(root); toast("Monthly cap updated.");
      };
    };

    document.getElementById("add-budget-btn").onclick = () => openBudgetModal();
    root.querySelectorAll("[data-del-budget]").forEach((btn) => {
      btn.onclick = () => {
        state.budgets = state.budgets.filter((b) => b.id !== btn.dataset.delBudget);
        saveState(); renderBudgetsView(root); toast("Budget removed.");
      };
    });
  }

  /* ---------- Recurring & Subscriptions View ---------- */
  function renderRecurringView(root) {
    const active = (state.recurring || []).filter((r) => r.active);
    const freqMult = { daily: 365, weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
    const annualBurn = active.filter((r) => r.type !== "income").reduce((s, r) => s + convertToBase(r.amount, r.currency) * (freqMult[r.frequency] || 12), 0);
    const soon = todayISO(5);
    const dueList = active.filter((r) => r.nextDue <= soon);

    root.innerHTML = `
      <div class="kpi-grid kpi-grid-3">
        <div class="kpi-card"><span class="kpi-label">Annual Subscription & Bill Burn</span><div class="kpi-val money-val">${fmtMoney(annualBurn)}</div><span class="kpi-foot">~<span class="money-val">${fmtMoney(annualBurn / 12)}</span> / month</span></div>
        <div class="kpi-card"><span class="kpi-label">Active Recurring Rules</span><div class="kpi-val">${active.length}</div><span class="kpi-foot">${active.filter((r) => r.autoPost).length} set to auto-post</span></div>
        <div class="kpi-card"><span class="kpi-label">Due Within 5 Days</span><div class="kpi-val" style="color:${dueList.length ? "var(--amber)" : "var(--emerald)"};">${dueList.length}</div><span class="kpi-foot">Actionable upcoming bills</span></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div><h3 class="card-title">Scheduled Bills & Subscriptions</h3><p class="card-subtitle">Record due payments in 1 click or let Auto-Post handle them</p></div>
          <button class="btn btn-primary btn-sm" id="add-rec-btn">+ Add Recurring Bill</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Frequency</th><th>Next Due</th><th>Auto-Post</th><th class="text-right">Amount</th><th class="text-right">Actions</th></tr></thead>
            <tbody>
              ${(state.recurring || []).length ? (state.recurring || []).map((r) => {
                const cat = getCat(r.category);
                const isDue = r.active && r.nextDue <= todayISO(3);
                return `
                  <tr>
                    <td><div class="tx-payee-cell"><div class="cat-avatar" style="background:${cat.color}1a;">${cat.icon}</div><div><strong>${esc(r.payee)}</strong><div class="text-xs muted">${esc(getAcc(r.accountId).name)}</div></div></div></td>
                    <td><span class="tag-chip">${esc(r.frequency)}</span></td>
                    <td><span class="${isDue ? "delta-pill delta-down" : "text-sm"}">${fmtShortDate(r.nextDue)}</span></td>
                    <td>${r.autoPost ? "Enabled" : "Manual"}</td>
                    <td class="text-right money-val"><strong>${fmtMoney(convertToBase(r.amount, r.currency))}</strong></td>
                    <td class="text-right">
                      <button class="btn btn-secondary btn-xs" data-pay-rec="${r.id}">Record Now</button>
                      <button class="btn btn-ghost btn-xs" style="color:var(--rose);" data-del-rec="${r.id}">Del</button>
                    </td>
                  </tr>`;
              }).join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:34px;">No recurring bills or subscriptions added yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById("add-rec-btn").onclick = () => openRecurringModal();
    root.querySelectorAll("[data-pay-rec]").forEach((btn) => {
      btn.onclick = () => {
        const r = state.recurring.find((x) => x.id === btn.dataset.payRec);
        if (!r) return;
        state.transactions.unshift({
          id: uid("tx"), type: r.type || "expense", amount: r.amount, currency: r.currency || state.settings.currency,
          baseAmount: convertToBase(r.amount, r.currency), date: dateTimeLocalNow(0),
          payee: r.payee, category: r.category, accountId: r.accountId, method: "Auto-Debit",
          tags: ["recurring"], notes: "Recorded from Subscriptions & Bills", taxDeductible: false, reconciled: true
        });
        r.nextDue = advanceDueDate(r.nextDue, r.frequency);
        saveState(); toast(`Recorded ${r.payee} and advanced next due date.`);
        renderRecurringView(root); updateSidebarMeta();
      };
    });
    root.querySelectorAll("[data-del-rec]").forEach((btn) => {
      btn.onclick = () => {
        state.recurring = state.recurring.filter((x) => x.id !== btn.dataset.delRec);
        saveState(); renderRecurringView(root); updateSidebarMeta();
      };
    });
  }

  /* ---------- Accounts & Multi-Bank Management View ---------- */
  function renderAccountsView(root) {
    const accounts = state.accounts || [];
    const bankGroups = {};
    for (const a of accounts) {
      const bKey = (a.bankName || (a.type === "cash" ? "Cash Wallet" : "Other Bank / General")).trim();
      if (!bankGroups[bKey]) bankGroups[bKey] = { bankName: bKey, total: 0, count: 0 };
      bankGroups[bKey].total += getAccountBalance(a.id);
      bankGroups[bKey].count++;
    }
    const bankSummary = Object.values(bankGroups);

    root.innerHTML = `
      <div class="flex-between mb-3" style="flex-wrap:wrap;gap:10px;">
        <div>
          <div class="text-sm muted">Combined Balance Across ${accounts.length} Account(s) in ${bankSummary.length} Bank(s)</div>
          <strong class="text-lg money-val" style="color:var(--text);font-size:22px;">${fmtMoney(getTotalNetWorth())}</strong>
        </div>
        <button class="btn btn-primary btn-sm" id="add-account-btn">+ Add Bank Account / Card</button>
      </div>

      ${bankSummary.length ? `
        <div class="card mb-4">
          <div class="card-header">
            <div><h3 class="card-title">Bank-Wise Balance Breakdown</h3><p class="card-subtitle">Track multiple accounts in the same bank or across different banks</p></div>
          </div>
          <div class="grid-3">
            ${bankSummary.map((bg) => `
              <div style="padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--bg);">
                <div class="flex-between">
                  <strong class="text-sm">${esc(bg.bankName)}</strong>
                  <span class="tag-chip">${bg.count} a/c</span>
                </div>
                <div class="kpi-val money-val mt-2" style="font-size:18px;color:${bg.total < 0 ? "var(--rose)" : "var(--emerald)"};">${fmtMoney(bg.total)}</div>
              </div>`).join("")}
          </div>
        </div>` : ""}

      <div class="grid-3">
        ${accounts.map((a) => {
          const bal = getAccountBalance(a.id);
          const isCredit = a.type === "credit";
          const used = isCredit ? Math.max(0, -bal) : 0;
          const util = isCredit && a.creditLimit > 0 ? Math.min(100, Math.round((used / a.creditLimit) * 100)) : 0;
          const typeLbl = a.type === "bank" ? "SAVINGS" : a.type === "current" ? "CURRENT" : a.type.toUpperCase();
          return `
            <div class="card">
              <div class="flex-between mb-2">
                <div>
                  <div class="flex-gap" style="flex-wrap:wrap;">
                    <span class="tag-chip">${esc(typeLbl)}</span>
                    ${a.bankName ? `<span class="tag-chip" style="background:var(--primary-soft);color:var(--primary);">${esc(a.bankName)}</span>` : ""}
                    ${a.accountNumberLast4 ? `<span class="tag-chip">••${esc(a.accountNumberLast4)}</span>` : ""}
                  </div>
                  <h3 class="card-title mt-2">${esc(a.name)}</h3>
                </div>
                <button class="btn btn-ghost btn-xs" data-acc-ledger="${a.id}">Bank Ledger &rarr;</button>
              </div>
              <div class="kpi-val money-val" style="color:${bal < 0 ? "var(--rose)" : "var(--text)"};">${fmtMoney(bal)}</div>
              ${isCredit && a.creditLimit > 0 ? `
                <div class="mt-3">
                  <div class="flex-between text-xs muted mb-2"><span>Credit Utilization</span><span>${util}% of ${fmtMoney(a.creditLimit)}</span></div>
                  <div class="progress-track"><div class="progress-fill" style="width:${util}%;background:${util > 60 ? "var(--rose)" : "var(--primary)"};"></div></div>
                </div>` : `<div class="text-xs muted mt-3">Starting balance: <span class="money-val">${fmtMoney(a.initialBalance)}</span></div>`}
              <div class="flex-between mt-3" style="padding-top:10px;border-top:1px solid var(--border);flex-wrap:wrap;gap:6px;">
                <div class="flex-gap">
                  <button class="btn btn-secondary btn-xs" data-edit-acc="${a.id}">Edit</button>
                  <button class="btn btn-secondary btn-xs" data-reconcile-acc="${a.id}">Reconcile</button>
                  <button class="btn btn-ghost btn-xs" data-filter-acc="${a.id}">Entries</button>
                </div>
                <button class="btn btn-ghost btn-xs" style="color:var(--rose);" data-del-acc="${a.id}">Delete</button>
              </div>
            </div>`;
        }).join("")}
      </div>`;

    document.getElementById("add-account-btn").onclick = () => openAccountModal();
    root.querySelectorAll("[data-edit-acc]").forEach((b) => {
      b.onclick = () => openAccountModal(b.dataset.editAcc);
    });
    root.querySelectorAll("[data-acc-ledger]").forEach((b) => {
      b.onclick = () => {
        selectedLedgerId = "bank_all";
        ledgerSubView = "bank";
        ledgerAccountFilter = b.dataset.accLedger;
        switchView("ledgers");
      };
    });
    root.querySelectorAll("[data-filter-acc]").forEach((b) => {
      b.onclick = () => { txFilters.account = b.dataset.filterAcc; switchView("transactions"); };
    });
    root.querySelectorAll("[data-reconcile-acc]").forEach((b) => {
      b.onclick = () => openReconcileModal(b.dataset.reconcileAcc);
    });
    root.querySelectorAll("[data-del-acc]").forEach((b) => {
      b.onclick = () => {
        if ((state.accounts || []).length <= 1) return toast("Keep at least one account.");
        state.accounts = state.accounts.filter((x) => x.id !== b.dataset.delAcc);
        saveState(); renderAccountsView(root); updateSidebarMeta(); toast("Account deleted.");
      };
    });
  }

  /* ---------- Goals & Split IOUs View ---------- */
  function renderGoalsView(root) {
    const owedToMe = (state.ious || []).filter((i) => !i.settled && i.direction === "owed_to_me").reduce((s, i) => s + Number(i.amount), 0);
    const iOwe = (state.ious || []).filter((i) => !i.settled && i.direction === "i_owe").reduce((s, i) => s + Number(i.amount), 0);

    root.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div><h3 class="card-title">Savings Goals</h3><p class="card-subtitle">Track milestones and contribute anytime</p></div>
            <button class="btn btn-primary btn-sm" id="add-goal-btn">+ New Goal</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${(state.goals || []).length ? (state.goals || []).map((g) => {
              const pct = Math.min(100, Math.round((g.saved / Math.max(1, g.target)) * 100));
              return `
                <div style="padding:14px;border:1px solid var(--border);border-radius:12px;">
                  <div class="flex-between mb-2">
                    <div><strong>${esc(g.name)}</strong><div class="text-xs muted">Target by ${fmtShortDate(g.deadline)}</div></div>
                    <div class="flex-gap">
                      <button class="btn btn-secondary btn-xs" data-contrib-goal="${g.id}">+ Contribute</button>
                      <button class="btn btn-ghost btn-xs" style="color:var(--rose);" data-del-goal="${g.id}">Del</button>
                    </div>
                  </div>
                  <div class="flex-between text-sm mb-2">
                    <span class="money-val"><strong>${fmtMoney(g.saved)}</strong> / ${fmtMoney(g.target)}</span>
                    <span class="badge" style="background:${g.color}1c;color:${g.color};">${pct}%</span>
                  </div>
                  <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${g.color};"></div></div>
                </div>`;
            }).join("") : `<p class="muted text-sm" style="padding:20px 0;text-align:center;">No savings goals yet. Click <strong>+ New Goal</strong> to add your target.</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Split Bills & IOUs</h3>
              <p class="card-subtitle">Owed to you: <strong class="amount-income money-val">${fmtMoney(owedToMe)}</strong> &bull; You owe: <strong style="color:var(--rose);" class="money-val">${fmtMoney(iOwe)}</strong></p>
            </div>
            <button class="btn btn-primary btn-sm" id="add-iou-btn">+ Add Split IOU</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${(state.ious || []).length ? (state.ious || []).map((iou) => `
              <div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;opacity:${iou.settled ? 0.55 : 1};" class="flex-between">
                <div>
                  <strong>${esc(iou.person)}</strong>
                  <span class="delta-pill ${iou.settled ? "delta-neutral" : iou.direction === "owed_to_me" ? "delta-up" : "delta-down"}">
                    ${iou.settled ? "Settled" : iou.direction === "owed_to_me" ? "Owes you" : "You owe"}
                  </span>
                  <div class="text-xs muted mt-2">${esc(iou.description)} &bull; ${fmtShortDate(iou.date)}</div>
                </div>
                <div class="text-right">
                  <div class="money-val" style="font-weight:700;">${fmtMoney(iou.amount)}</div>
                  ${!iou.settled ? `<button class="btn btn-secondary btn-xs mt-2" data-settle-iou="${iou.id}">Settle Up</button>` : ""}
                </div>
              </div>`).join("") : `<p class="muted text-sm" style="padding:20px 0;text-align:center;">No split bills or IOUs recorded yet.</p>`}
          </div>
        </div>
      </div>`;

    document.getElementById("add-goal-btn").onclick = () => openGoalModal();
    document.getElementById("add-iou-btn").onclick = () => openIouModal();

    root.querySelectorAll("[data-contrib-goal]").forEach((b) => {
      b.onclick = () => {
        const g = state.goals.find((x) => x.id === b.dataset.contribGoal);
        openSubModal(`Contribute to ${g.name}`, `
          <form id="contrib-form" class="field">
            <label>Amount (${state.settings.currency})</label>
            <input id="contrib-amt" type="number" min="1" step="any" placeholder="Enter amount" required />
            <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Add Contribution</button></div>
          </form>`);
        document.getElementById("contrib-form").onsubmit = (e) => {
          e.preventDefault();
          g.saved += Number(document.getElementById("contrib-amt").value) || 0;
          saveState(); closeModal("sub-modal"); renderGoalsView(root); toast("Goal progress updated!");
        };
      };
    });

    root.querySelectorAll("[data-del-goal]").forEach((b) => {
      b.onclick = () => { state.goals = state.goals.filter((g) => g.id !== b.dataset.delGoal); saveState(); renderGoalsView(root); };
    });

    root.querySelectorAll("[data-settle-iou]").forEach((b) => {
      b.onclick = () => {
        const iou = state.ious.find((x) => x.id === b.dataset.settleIou);
        if (!iou) return;
        iou.settled = true;
        state.transactions.unshift({
          id: uid("tx"),
          type: iou.direction === "owed_to_me" ? "income" : "expense",
          amount: iou.amount, currency: state.settings.currency, baseAmount: iou.amount,
          date: dateTimeLocalNow(0), payee: `Settlement: ${iou.person}`,
          category: iou.direction === "owed_to_me" ? "refund" : "other_exp",
          accountId: state.accounts[0]?.id || "acc_bank", method: "UPI",
          tags: ["split-settlement"], notes: iou.description, taxDeductible: false, reconciled: true
        });
        saveState(); renderGoalsView(root); updateSidebarMeta(); toast(`Settled balance with ${iou.person}.`);
      };
    });
  }

  /* ---------- Analytics & Tax View ---------- */
  function renderAnalyticsView(root) {
    const { start, end, label } = getPeriodBounds();
    const txs = getTransactionsInRange(start, end);
    const taxItems = txs.filter((t) => t.taxDeductible && t.type === "expense");
    const taxTotal = taxItems.reduce((s, t) => s + txBaseAmount(t), 0);

    // Top Merchants
    const merch = {};
    txs.filter((t) => t.type === "expense").forEach((t) => {
      merch[t.payee] = (merch[t.payee] || 0) + txBaseAmount(t);
    });
    const topMerch = Object.entries(merch).sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Daily heatmap for current month
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daySpend = {};
    for (let d = 1; d <= daysInMonth; d++) daySpend[d] = 0;
    state.transactions.filter((t) => {
      const dt = new Date(t.date);
      return t.type === "expense" && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
    }).forEach((t) => {
      const d = new Date(t.date).getDate();
      daySpend[d] = (daySpend[d] || 0) + txBaseAmount(t);
    });
    const maxDay = Math.max(1, ...Object.values(daySpend));

    root.innerHTML = `
      <div class="flex-between mb-4">
        <div class="text-sm muted">Analytics scope: <strong>${label}</strong></div>
        <button class="btn btn-primary btn-sm" id="print-pdf-btn">Print / Save PDF Statement</button>
      </div>

      <div class="grid-2 mb-4">
        <div class="card">
          <div class="card-header"><div><h3 class="card-title">Monthly Spending Heatmap</h3><p class="card-subtitle">Daily expense intensity for ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p></div></div>
          <div class="heatmap-grid">
            ${Object.entries(daySpend).map(([day, val]) => {
              const alpha = val === 0 ? 0.04 : Math.min(0.85, 0.18 + (val / maxDay) * 0.72);
              const bg = val === 0 ? "var(--bg)" : `rgba(79, 70, 229, ${alpha.toFixed(2)})`;
              const fg = alpha > 0.45 ? "#fff" : "var(--text)";
              return `<div class="heat-cell" style="background:${bg};color:${fg};" title="Day ${day}: ${fmtMoney(val)}"><span>${day}</span></div>`;
            }).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div><h3 class="card-title">Top Merchants (${label})</h3><p class="card-subtitle">Where your spending concentrates</p></div></div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${topMerch.length ? topMerch.map(([name, val]) => {
              const pct = Math.round((val / Math.max(1, topMerch[0][1])) * 100);
              return `
                <div>
                  <div class="flex-between text-sm mb-2"><strong>${esc(name)}</strong><span class="money-val">${fmtMoney(val)}</span></div>
                  <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:var(--primary);"></div></div>
                </div>`;
            }).join("") : `<p class="muted text-sm">No merchant data in this period.</p>`}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div><h3 class="card-title">Tax-Deductible & Business Expenses (${label})</h3><p class="card-subtitle">Total claimable / business tracked: <strong class="money-val">${fmtMoney(taxTotal)}</strong></p></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Tags</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
              ${taxItems.length ? taxItems.map((t) => `
                <tr>
                  <td>${fmtShortDate(t.date)}</td>
                  <td><strong>${esc(t.payee)}</strong></td>
                  <td>${getCat(t.category).icon} ${esc(getCat(t.category).name)}</td>
                  <td>${(t.tags || []).map((tg) => `<span class="tag-chip">#${esc(tg)}</span>`).join(" ")}</td>
                  <td class="text-right money-val"><strong>${fmtMoney(txBaseAmount(t))}</strong></td>
                </tr>`).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px;">No tax-deductible transactions flagged in this period.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById("print-pdf-btn").onclick = async () => {
      showPdfProgress("🖨 Generating PDF Statement Report...", "Preparing charts & tax summary for print...", { percent: 45, stats: "Rendering printable statement..." });
      await yieldToUi();
      setTimeout(() => {
        updatePdfProgress({ sub: "Opening system Print / Save PDF dialog...", percent: 100, stats: "Report ready!" });
        setTimeout(() => { hidePdfProgress(); window.print(); }, 180);
      }, 120);
    };
  }

  /* ---------- Smart Rules View ---------- */
  function renderRulesView(root) {
    root.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div><h3 class="card-title">Auto-Categorization & Tagging Rules</h3><p class="card-subtitle">Automatically classify manual entries and CSV bank imports</p></div>
          <div class="flex-gap">
            <button class="btn btn-secondary btn-sm" id="run-all-rules-btn">Run Rules on All Transactions</button>
            <button class="btn btn-primary btn-sm" id="add-rule-btn">+ New Smart Rule</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>If Field</th><th>Condition</th><th>Assign Category</th><th>Auto Tags & Flags</th><th class="text-right">Actions</th></tr></thead>
            <tbody>
              ${(state.rules || []).length ? (state.rules || []).map((r) => {
                const cat = getCat(r.category);
                return `
                  <tr>
                    <td><span class="tag-chip">${esc(r.field)}</span></td>
                    <td>${esc(r.operator)} <code>${esc(r.pattern)}</code></td>
                    <td><span class="badge" style="background:${cat.color}1a;color:${cat.color};">${cat.icon} ${esc(cat.name)}</span></td>
                    <td>${(r.tags || []).map((t) => `<span class="tag-chip">#${esc(t)}</span>`).join(" ")} ${r.taxDeductible ? `<span class="tag-chip" style="color:var(--sky);">Tax Deductible</span>` : ""}</td>
                    <td class="text-right"><button class="btn btn-ghost btn-xs" style="color:var(--rose);" data-del-rule="${r.id}">Delete</button></td>
                  </tr>`;
              }).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:34px;">No smart rules yet. Click <strong>+ New Smart Rule</strong> to auto-categorize entries.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById("add-rule-btn").onclick = () => openRuleModal();
    document.getElementById("run-all-rules-btn").onclick = () => {
      let updated = 0;
      state.transactions.forEach((t) => {
        const before = t.category + "|" + (t.tags || []).join(",");
        applyRulesToTx(t);
        if (t.category + "|" + (t.tags || []).join(",") !== before) updated++;
      });
      saveState();
      toast(`Smart rules checked all entries (${updated} updated).`);
    };
    root.querySelectorAll("[data-del-rule]").forEach((b) => {
      b.onclick = () => { state.rules = state.rules.filter((r) => r.id !== b.dataset.delRule); saveState(); renderRulesView(root); };
    });
  }

  /* ---------- Built-in AI Intelligence & Free Gemini Financial Assistant ---------- */
  let aiChatHistory = [];

  function analyzeFinancesLocally() {
    const txs = (state.transactions || []).filter((t) => t && t.type !== "transfer");
    const expenses = txs.filter((t) => t.type === "expense");
    const incomes = txs.filter((t) => t.type === "income");
    const totalOut = expenses.reduce((s, t) => s + txBaseAmount(t), 0);
    const totalIn = incomes.reduce((s, t) => s + txBaseAmount(t), 0);
    const net = totalIn - totalOut;
    const savingsRate = totalIn > 0 ? Math.round((net / totalIn) * 100) : 0;

    const byMonth = {};
    const byCat = {};
    const byPayee = {};
    for (const t of txs) {
      const mk = getMonthKey(t.date) || "unknown";
      if (!byMonth[mk]) byMonth[mk] = { month: mk, in: 0, out: 0, count: 0 };
      const amt = txBaseAmount(t);
      byMonth[mk].count++;
      if (t.type === "income") byMonth[mk].in += amt;
      else byMonth[mk].out += amt;

      if (t.type === "expense") {
        byCat[t.category] = (byCat[t.category] || 0) + amt;
        const pk = normalizePayeeKey(t.payee) || "unknown";
        if (!byPayee[pk]) byPayee[pk] = { key: pk, name: t.payee || "Unknown", total: 0, count: 0, months: new Set(), cat: t.category, txIds: [] };
        byPayee[pk].total += amt;
        byPayee[pk].count++;
        byPayee[pk].months.add(mk);
        byPayee[pk].txIds.push(t.id);
      }
    }

    const monthsSorted = Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month));
    const topCats = Object.entries(byCat).map(([id, total]) => ({ id, name: getCat(id).name, icon: getCat(id).icon, total })).sort((a, b) => b.total - a.total);
    const topPayees = Object.values(byPayee).sort((a, b) => b.total - a.total);
    const recurringCandidates = Object.values(byPayee)
      .filter((p) => p.months.size >= 2 || (p.count >= 3 && p.total >= 200))
      .map((p) => ({ name: p.name, total: p.total, count: p.count, months: p.months.size, avg: p.total / p.count, cat: p.cat }))
      .sort((a, b) => (b.months - a.months) || (b.total - a.total))
      .slice(0, 10);

    const pettyMax = Number(state.settings.pettyExpenseMax) || 200;
    const bigMin = Number(state.settings.bigExpenseMin) || 2500;
    const pettyTxs = expenses.filter((t) => txBaseAmount(t) <= pettyMax);
    const pettyTotal = pettyTxs.reduce((s, t) => s + txBaseAmount(t), 0);
    const bigTxs = expenses.filter((t) => txBaseAmount(t) >= bigMin).sort((a, b) => txBaseAmount(b) - txBaseAmount(a));
    const bigTotal = bigTxs.reduce((s, t) => s + txBaseAmount(t), 0);

    const unlabelled = expenses.filter((t) => t.category === "personal_transfer" || t.category === "other_exp");
    const messyCount = txs.filter((t) => {
      const p = String(t.payee || "");
      return /-\s+-|\b(WDL|DEP)\s+TFR\b|\bAT\s+\d{4,6}\b|^\d{10,}|^(?:UPI|IMPS|NEFT)\//i.test(p);
    }).length;

    return {
      txCount: txs.length,
      totalIn, totalOut, net, savingsRate,
      liquidBalance: getLiquidBalance(),
      monthsSorted, topCats, topPayees, recurringCandidates,
      pettyMax, pettyCount: pettyTxs.length, pettyTotal,
      bigMin, bigTxs, bigTotal,
      unlabelled, messyCount
    };
  }

  function answerFinancialQueryLocally(question) {
    const q = String(question || "").trim();
    const ql = q.toLowerCase();
    const a = analyzeFinancesLocally();
    if (!a.txCount) {
      return "Your ledger has no transactions yet. Import a bank statement (PDF/Excel/CSV) or add an entry, and I will analyze your cash flow, payees, and savings immediately.";
    }

    // 1. Recurring / Subscriptions
    if (/(subscri|recurr|repeat|habit|bill|monthly charge|auto.?debit)/i.test(ql)) {
      if (!a.recurringCandidates.length) return "I did not detect any payees repeating across multiple months yet.";
      const lines = a.recurringCandidates.slice(0, 7).map((r, i) =>
        `${i + 1}. ${r.name}: ${fmtMoney(r.total)} total (${r.count}x across ${r.months} mo, avg ${fmtMoney(r.avg)})`
      );
      return `Discovered ${a.recurringCandidates.length} repeat/habitual payees:\n${lines.join("\n")}`;
    }

    // 2. Spikes / Big / Petty / Leaks
    if (/(spike|big|largest|highest|unusual|anomal|petty|small|leak|drain)/i.test(ql)) {
      const topBig = a.bigTxs.slice(0, 5).map((t, i) =>
        `${i + 1}. ${t.payee} on ${String(t.date).slice(0, 10)}: ${fmtMoney(txBaseAmount(t))} (${getCat(t.category).name})`
      );
      return `Spike & Petty-Drain Check:\n• High-value spends (>= ${fmtMoney(a.bigMin)}): ${a.bigTxs.length} entries totaling ${fmtMoney(a.bigTotal)}\n${topBig.length ? topBig.join("\n") + "\n" : ""}• Petty spends (<= ${fmtMoney(a.pettyMax)}): ${a.pettyCount} entries totaling ${fmtMoney(a.pettyTotal)}`;
    }

    // 3. Top Payees / People
    if (/(top|who|payee|person|people|merchant|transfer)/i.test(ql) && !/(category|where did)/i.test(ql)) {
      const top = a.topPayees.slice(0, 8).map((p, i) =>
        `${i + 1}. ${p.name}: ${fmtMoney(p.total)} (${p.count}x, ${getCat(p.cat).name})`
      );
      return `Top Payees by Total Outflow:\n${top.join("\n")}`;
    }

    // 4. Income / Credits / Salary
    if (/(income|earn|salary|credit|inflow|deposit)/i.test(ql) && !/(save|saving)/i.test(ql)) {
      const incTxs = (state.transactions || []).filter((t) => t.type === "income");
      const incByPayee = {};
      for (const t of incTxs) {
        const k = t.payee || "Income";
        incByPayee[k] = (incByPayee[k] || 0) + txBaseAmount(t);
      }
      const topInc = Object.entries(incByPayee).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v], i) => `${i + 1}. ${k}: ${fmtMoney(v)}`);
      return `Total Credits: ${fmtMoney(a.totalIn)} across ${incTxs.length} entries.\nTop inflow sources:\n${topInc.join("\n")}`;
    }

    // 4.5 Account balances & Party Ledgers
    if (/(account|bank\s*balance|card|wallet|cash\s*in\s*hand)/i.test(ql) && (state.accounts || []).length) {
      const accLines = (state.accounts || []).map((acc) => {
        const bal = typeof getAccountBalance === "function" ? getAccountBalance(acc.id) : (acc.initialBalance || 0);
        return `• ${acc.name} (${acc.type || "bank"}): ${fmtMoney(bal)}`;
      });
      return `Your Accounts (${accLines.length}):\n${accLines.join("\n")}\nTotal Liquid Balance: ${fmtMoney(a.liquidBalance)}`;
    }
    if (/(ledger|owe|owing|lent|borrow|party|receivable|payable)/i.test(ql) && (state.ledgers || []).length) {
      const lMap = {};
      for (const t of state.transactions || []) {
        if (!t.ledgerId) continue;
        lMap[t.ledgerId] = (lMap[t.ledgerId] || 0) + (t.type === "income" ? txBaseAmount(t) : -txBaseAmount(t));
      }
      const nonZero = (state.ledgers || [])
        .map((l) => ({ name: l.name, net: lMap[l.id] || 0 }))
        .filter((x) => Math.abs(x.net) > 0.01)
        .sort((x, y) => Math.abs(y.net) - Math.abs(x.net))
        .slice(0, 8);
      if (nonZero.length) {
        return `Party / Ledger Balances:\n${nonZero.map((x) => `• ${x.name}: ${fmtMoney(x.net)}`).join("\n")}`;
      }
    }

    // 5. Savings / Advice / Balance
    if (/(save|saving|budget|advice|plan|balance|net worth)/i.test(ql)) {
      const top3 = a.topCats.slice(0, 3).map((c) => `${c.name} (${fmtMoney(c.total)})`).join(", ");
      const trimTarget = Math.round(a.pettyTotal * 0.25);
      return `Financial Health & Savings Summary:\n• Available Balance: ${fmtMoney(a.liquidBalance)}\n• Total Inflow: ${fmtMoney(a.totalIn)} | Outflow: ${fmtMoney(a.totalOut)} | Net: ${fmtMoney(a.net)} (${a.savingsRate}% savings rate)\n• Top 3 spend areas: ${top3}\n• Actionable tip: Trimming 25% of your ${a.pettyCount} petty spends (${fmtMoney(a.pettyTotal)}) frees ~${fmtMoney(trimTarget)}. Review ${a.unlabelled.length} unlabelled transfers to sharpen budgets.`;
    }

    // 6. Specific merchant or category keyword search
    const stopWords = new Set(["how", "much", "did", "spend", "spent", "on", "for", "the", "this", "last", "month", "year", "what", "is", "my", "in", "to", "me", "tell", "show", "about", "all", "total", "and", "of"]);
    const tokens = ql.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
    if (tokens.length && !/(where|money|go|summary|overview|breakdown)/i.test(ql)) {
      const matches = (state.transactions || []).filter((t) => {
        const hay = `${t.payee || ""} ${getCat(t.category).name} ${t.notes || ""}`.toLowerCase();
        return tokens.some((tok) => hay.includes(tok));
      });
      if (matches.length) {
        const mOut = matches.filter((t) => t.type === "expense").reduce((s, t) => s + txBaseAmount(t), 0);
        const mIn = matches.filter((t) => t.type === "income").reduce((s, t) => s + txBaseAmount(t), 0);
        const sample = matches.slice(0, 6).map((t) => `• ${String(t.date).slice(0, 10)} | ${t.payee}: ${t.type === "income" ? "+" : "-"}${fmtMoney(txBaseAmount(t))}`).join("\n");
        return `Matched ${matches.length} entry(ies) for "${tokens.join(" ")}":\nOutflow: ${fmtMoney(mOut)} | Inflow: ${fmtMoney(mIn)}\n${sample}`;
      }
    }

    // 7. Default: Complete Spending Breakdown (this month + overall)
    const curMk = getMonthKey(todayISO());
    const curM = a.monthsSorted.find((m) => m.month === curMk) || a.monthsSorted[0];
    const catLines = a.topCats.slice(0, 6).map((c, i) => {
      const pct = a.totalOut > 0 ? Math.round((c.total / a.totalOut) * 100) : 0;
      return `${i + 1}. ${c.icon} ${c.name}: ${fmtMoney(c.total)} (${pct}%)`;
    });
    return `Spending Breakdown (${a.txCount} entries):\n• ${curM ? `Latest Month (${curM.month}): In ${fmtMoney(curM.in)} / Out ${fmtMoney(curM.out)}` : ""}\n• All-Time: In ${fmtMoney(a.totalIn)} | Out ${fmtMoney(a.totalOut)} | Savings Rate: ${a.savingsRate}%\n\nTop Categories:\n${catLines.join("\n")}`;
  }

  function buildAiChatFinancialContext(question) {
    const a = analyzeFinancesLocally();
    const ql = String(question || "").toLowerCase();
    const stopWords = new Set(["how", "much", "did", "spend", "spent", "what", "when", "where", "who", "why", "can", "could", "should", "the", "for", "this", "last", "month", "year", "with", "from", "about", "all", "total", "give", "show", "tell", "list", "analyze"]);
    const qTokens = ql.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));

    const txs = state.transactions || [];
    const matched = [];
    if (qTokens.length) {
      for (let i = 0; i < txs.length && matched.length < 35; i++) {
        const t = txs[i];
        const hay = `${t.date || ""} ${t.payee || ""} ${getCat(t.category).name} ${t.notes || ""} ${t.rawNarration || ""}`.toLowerCase();
        if (qTokens.some((tok) => hay.includes(tok))) {
          matched.push({
            date: String(t.date || "").slice(0, 10),
            type: t.type,
            amt: txBaseAmount(t),
            payee: t.payee,
            cat: getCat(t.category).name,
            note: String(t.notes || "").slice(0, 60)
          });
        }
      }
    }
    const recent = txs.slice(0, 20).map((t) => ({
      date: String(t.date || "").slice(0, 10),
      type: t.type,
      amt: txBaseAmount(t),
      payee: t.payee,
      cat: getCat(t.category).name
    }));
    const accs = (state.accounts || []).map((acc) => ({
      name: acc.name,
      type: acc.type,
      balance: getAccountBalance(acc.id)
    }));
    const partyBalances = {};
    for (const t of txs) {
      if (t.ledgerId) partyBalances[t.ledgerId] = (partyBalances[t.ledgerId] || 0) + (t.type === "income" ? txBaseAmount(t) : -txBaseAmount(t));
    }
    const topLedgers = (state.ledgers || [])
      .map((l) => ({ name: l.name, type: l.type, net: Math.round((partyBalances[l.id] || 0) * 100) / 100 }))
      .filter((l) => Math.abs(l.net) > 0.01)
      .sort((x, y) => Math.abs(y.net) - Math.abs(x.net))
      .slice(0, 12);

    return {
      currency: state.settings?.currency || "INR",
      today: todayISO(),
      totals: { txCount: a.txCount, totalIn: Math.round(a.totalIn), totalOut: Math.round(a.totalOut), net: Math.round(a.net), savingsRatePct: a.savingsRate, liquidBalance: Math.round(a.liquidBalance), netWorth: Math.round(getTotalNetWorth()) },
      accounts: accs,
      months: a.monthsSorted.slice(0, 12),
      topCategories: a.topCats.slice(0, 10).map((c) => ({ name: c.name, total: Math.round(c.total) })),
      topPayees: a.topPayees.slice(0, 15).map((p) => ({ name: p.name, total: Math.round(p.total), count: p.count })),
      recurringCandidates: a.recurringCandidates.slice(0, 8).map((r) => ({ name: r.name, total: Math.round(r.total), count: r.count, months: r.months })),
      partyLedgers: topLedgers,
      budgets: (state.budgets || []).map((b) => ({ cat: getCat(b.category).name, limit: b.amount })),
      matchedTransactions: matched,
      recentTransactions: matched.length >= 15 ? [] : recent
    };
  }

  async function askLedgerFlowAI(question) {
    const q = String(question || "").trim();
    if (!q) return { text: "", source: "Local Brain" };
    const aiCfg = state.settings?.aiConfig || {};
    const prov = aiCfg.provider || "none";
    const hasRemote = prov !== "none" && aiCfg.mode !== "local" && (prov === "ollama" || String(aiCfg.apiKey || "").trim().length >= 10);

    if (hasRemote) {
      try {
        const ctx = buildAiChatFinancialContext(q);
        const sysPrompt =
          "You are LedgerFlow AI, an expert personal finance assistant analyzing the user's real ledger data.\n" +
          `Primary currency: ${ctx.currency}. Today: ${ctx.today}.\n` +
          "Answer the user's question clearly, accurately, and concisely using ONLY the supplied financial JSON data. Cite exact amounts, payees, dates, and trends. If something is missing from the data, say so clearly." +
          (aiCfg.customPrompt ? `\nUser instructions: ${aiCfg.customPrompt}` : "");
        const historyMsgs = aiChatHistory.slice(-6).map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: String(m.text || "").slice(0, 600) }]
        }));

        if (prov === "gemini") {
          const contents = [
            { role: "user", parts: [{ text: `LEDGER_SNAPSHOT_JSON:\n${JSON.stringify(ctx)}` }] },
            { role: "model", parts: [{ text: "Understood. I have your exact ledger snapshot. Ask your question." }] },
            ...historyMsgs,
            { role: "user", parts: [{ text: q }] }
          ];
          const gRes = await callGeminiWithFallback({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents,
            generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
          }, aiCfg);
          const ans = String(gRes.text || "").trim();
          if (ans) return { text: ans, source: `Google Gemini (${gRes.model})` };
        } else {
          const base = (aiCfg.endpoint || (prov === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
          const model = aiCfg.model || (prov === "ollama" ? "llama3.2" : "gpt-4o-mini");
          const headers = {};
          if (aiCfg.apiKey) headers.Authorization = `Bearer ${aiCfg.apiKey.trim()}`;
          const oRes = await aiNativePost(`${base}/chat/completions`, headers, {
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: `LEDGER_SNAPSHOT_JSON:\n${JSON.stringify(ctx)}\n\nQuestion: ${q}` }
            ]
          });
          const ans = String(oRes?.choices?.[0]?.message?.content || "").trim();
          if (ans) return { text: ans, source: `${prov.toUpperCase()} (${model})` };
        }
      } catch (err) {
        const localAns = answerFinancialQueryLocally(q);
        return {
          text: `${localAns}\n\n[Note: Live AI fallback triggered — ${err?.message || "network/rate limit"}]`,
          source: "Local Financial Engine (Gemini Fallback)"
        };
      }
    }

    return {
      text: answerFinancialQueryLocally(q),
      source: "LedgerFlow Local Brain (Connect Gemini for full conversational Q&A)"
    };
  }

  async function runSmartPayeeCleanupAndClassify(onProgress = null) {
    const list = state.transactions || [];
    const total = list.length;
    showPdfProgress("✨ Analyzing & Cleaning Payees...", `Scanning ${total} transaction(s)...`, {
      percent: 8,
      stats: `0 / ${total} analyzed`
    });
    try {
      let cleaned = 0;
      const histIdx = buildHistoricalClassifierIndex();
      const recentFeed = [];
      for (let i = 0; i < total; i++) {
        const t = list[i];
        const rawSrc = t.rawNarration || t.notes || "";
        let nextPayee = t.payee || "";
        if (rawSrc) {
          const reparsed = parseBankNarration(rawSrc, t.type === "income");
          if (reparsed.payee && reparsed.payee !== nextPayee) {
            nextPayee = reparsed.payee;
          }
        }
        nextPayee = cleanBankPayeeDisplay(nextPayee, rawSrc) || nextPayee;
        if (nextPayee && nextPayee !== t.payee) {
          t.payee = nextPayee;
          cleaned++;
          recentFeed.push(`Cleaned: ${t.payee}`);
          if (recentFeed.length > 6) recentFeed.shift();
        }
        if (t.type !== "transfer") autoClassifyBankTx(t, rawSrc, histIdx);
        if (i % 200 === 199 || i === total - 1) {
          const pct = total ? Math.round(10 + 45 * (i + 1) / total) : 55;
          updatePdfProgress({
            sub: `Normalizing narrations & local payee matching...`,
            percent: pct,
            stats: `${i + 1} / ${total} transactions scanned • ${cleaned} cleaned`,
            feed: recentFeed
          });
          await yieldToUi();
        }
      }
      const aiRes = await runHybridAIClassification(list, {
        onlyUncertain: state.settings.aiConfig?.mode !== "llm_all",
        onProgress: (msg, pctVal, feedArr) => {
          if (typeof onProgress === "function") onProgress(msg);
          updatePdfProgress({
            sub: msg,
            percent: typeof pctVal === "number" ? Math.round(55 + pctVal * 0.4) : 75,
            feed: feedArr
          });
        }
      });
      updatePdfProgress({ sub: "Saving updated classifications to vault...", percent: 97 });
      await saveState();
      return { cleaned, classified: aiRes.updated, source: aiRes.source };
    } finally {
      hidePdfProgress();
    }
  }

  function renderAiAssistantView(root) {
    const a = analyzeFinancesLocally();
    const cfg = state.settings.aiConfig || {};
    const geminiOn = isGeminiConnected();
    const engineLabel = geminiOn
      ? "Google Gemini AI + Local Financial Engine"
      : (cfg.provider && cfg.provider !== "none" && cfg.mode !== "local"
        ? `${cfg.provider.toUpperCase()} AI + Local Engine`
        : "Built-in Local Brain (Connect Gemini for deep Q&A)");

    const topUnlabelled = Object.values(a.unlabelled.reduce((acc, t) => {
      const k = normalizePayeeKey(t.payee) || t.payee;
      if (!acc[k]) acc[k] = { key: k, payee: t.payee, total: 0, count: 0 };
      acc[k].total += txBaseAmount(t);
      acc[k].count++;
      return acc;
    }, {})).sort((x, y) => y.total - x.total).slice(0, 6);

    const catOptionsHtml = (state.categories || [])
      .filter((c) => c.type === "expense")
      .map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`)
      .join("");

    root.innerHTML = `
      <div class="info-banner mb-4" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <strong>Active Intelligence: ${esc(engineLabel)}</strong>
          <div class="text-xs muted mt-1">Analyzes your accounts, ledgers, categories &amp; PDF statements (${Object.keys(state.settings.aiMemory || {}).length} learned payee(s)). ${geminiOn ? "Ask natural questions below powered by Gemini + your local vault." : "Connect your free Gemini key for full conversational Q&A & PDF verification."}</div>
        </div>
        <div class="flex-gap" style="flex-wrap:wrap;">
          ${geminiOn
            ? `<button class="btn btn-secondary btn-sm" id="ai-connect-gemini-btn">✓ Gemini Connected</button>`
            : `<button class="btn btn-primary btn-sm" id="ai-connect-gemini-btn">✨ Connect Free Gemini Key</button>`}
          <button class="btn btn-secondary btn-sm" id="ai-open-importer-btn">📄 Analyze PDF Statement</button>
          <button class="btn btn-primary btn-sm" id="ai-clean-classify-btn">✨ Clean Payees &amp; Auto-Classify</button>
        </div>
      </div>

      <div class="grid-main-side mb-4">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Ask LedgerFlow AI</h3>
              <p class="card-subtitle">Ask anything about your spending, payees, subscriptions, spikes, or savings</p>
            </div>
            <button class="btn btn-ghost btn-xs" id="ai-clear-chat-btn">Clear</button>
          </div>
          <div class="ai-chat-thread" id="ai-chat-thread">
            ${aiChatHistory.length ? aiChatHistory.map((m) => `
              <div class="ai-msg ${m.role === "user" ? "ai-msg-user" : "ai-msg-bot"}">
                ${m.source ? `<div class="ai-msg-meta">${esc(m.source)}</div>` : ""}
                <div style="white-space:pre-line;">${esc(m.text)}</div>
              </div>
            `).join("") : `
              <div class="ai-msg ai-msg-bot">
                <div class="ai-msg-meta">LedgerFlow Intelligence</div>
                <div>I have analyzed <strong>${a.txCount}</strong> transactions (Inflow: <strong>${fmtMoney(a.totalIn)}</strong>, Outflow: <strong>${fmtMoney(a.totalOut)}</strong>, Savings Rate: <strong>${a.savingsRate}%</strong>). Ask me anything below or tap a quick prompt!</div>
              </div>
            `}
          </div>
          <div class="ai-chip-row">
            <button type="button" class="ai-prompt-chip" data-ai-q="Where did my money go?">Where did my money go?</button>
            <button type="button" class="ai-prompt-chip" data-ai-q="Who are my top payees?">Top payees</button>
            <button type="button" class="ai-prompt-chip" data-ai-q="Find subscriptions and recurring spends">Recurring &amp; subscriptions</button>
            <button type="button" class="ai-prompt-chip" data-ai-q="Show big spikes and petty UPI drain">Spikes &amp; petty drain</button>
            <button type="button" class="ai-prompt-chip" data-ai-q="How can I save more?">Savings plan</button>
          </div>
          <form id="ai-chat-form" class="input-group mt-3">
            <input id="ai-chat-input" type="text" placeholder="Ask e.g. 'How much did I spend on Swiggy?' or 'Find repeat bills'..." autocomplete="off" />
            <button type="submit" class="btn btn-primary" id="ai-chat-send-btn">Ask</button>
          </form>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="card">
            <div class="card-header">
              <div><h3 class="card-title">Discovered Repeat Spends</h3><p class="card-subtitle">Auto-detected from multi-month history</p></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${a.recurringCandidates.length ? a.recurringCandidates.slice(0, 5).map((r) => `
                <div class="flex-between text-sm" style="padding:7px 0;border-bottom:1px solid var(--border);">
                  <div><strong>${esc(r.name)}</strong><div class="text-xs muted">${r.count}x across ${r.months} month(s)</div></div>
                  <div class="text-right"><strong class="money-val">${fmtMoney(r.total)}</strong><div class="text-xs muted">avg ${fmtMoney(r.avg)}</div></div>
                </div>
              `).join("") : `<p class="muted text-sm">No multi-month repeating payees detected yet.</p>`}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div><h3 class="card-title">Quick Teach AI (${a.unlabelled.length} unlabelled)</h3><p class="card-subtitle">Assign once — LedgerFlow remembers permanently</p></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${topUnlabelled.length ? topUnlabelled.map((u) => `
                <div class="flex-between" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
                  <div style="min-width:0;flex:1;">
                    <strong class="text-sm">${esc(u.payee)}</strong>
                    <div class="text-xs muted">${u.count}x &bull; <span class="money-val">${fmtMoney(u.total)}</span></div>
                  </div>
                  <select class="select-compact" data-teach-payee="${esc(u.key)}" style="max-width:155px;">
                    <option value="">Teach category…</option>
                    ${catOptionsHtml}
                  </select>
                </div>
              `).join("") : `<p class="muted text-sm">All expense payees are neatly categorized!</p>`}
            </div>
          </div>
        </div>
      </div>
    `;

    const thread = document.getElementById("ai-chat-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;

    const askQuestion = async (qText) => {
      const q = String(qText || "").trim();
      if (!q) return;
      aiChatHistory.push({ role: "user", text: q });
      renderAiAssistantView(root);
      const inp = document.getElementById("ai-chat-input");
      const sendBtn = document.getElementById("ai-chat-send-btn");
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Thinking…"; }
      const ans = await askLedgerFlowAI(q);
      aiChatHistory.push({ role: "bot", text: ans.text, source: ans.source });
      renderAiAssistantView(root);
      const inp2 = document.getElementById("ai-chat-input");
      if (inp2) inp2.focus();
    };

    document.getElementById("ai-chat-form").onsubmit = (e) => {
      e.preventDefault();
      askQuestion(document.getElementById("ai-chat-input").value);
    };
    root.querySelectorAll("[data-ai-q]").forEach((btn) => {
      btn.onclick = () => askQuestion(btn.dataset.aiQ);
    });
    document.getElementById("ai-clear-chat-btn").onclick = () => {
      aiChatHistory = [];
      renderAiAssistantView(root);
    };
    const connGemBtn = document.getElementById("ai-connect-gemini-btn");
    if (connGemBtn) connGemBtn.onclick = () => openQuickGeminiConnectModal(() => renderAiAssistantView(root));
    const openImpAiBtn = document.getElementById("ai-open-importer-btn");
    if (openImpAiBtn) openImpAiBtn.onclick = () => openStatementModal();
    document.getElementById("ai-clean-classify-btn").onclick = async () => {
      const btn = document.getElementById("ai-clean-classify-btn");
      btn.disabled = true;
      btn.textContent = "Cleaning & Classifying…";
      try {
        const res = await runSmartPayeeCleanupAndClassify((m) => { btn.textContent = m; });
        renderAiAssistantView(root);
        toast(`✨ Cleaned ${res.cleaned} payee(s) & classified ${res.classified} entry(ies) via ${res.source}.`);
      } catch (err) {
        toast("Cleanup error: " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "✨ Clean Payees & Auto-Classify";
      }
    };
    root.querySelectorAll("[data-teach-payee]").forEach((sel) => {
      sel.onchange = () => {
        const catId = sel.value;
        const pKey = sel.dataset.teachPayee;
        if (!catId || !pKey) return;
        let count = 0;
        for (const t of state.transactions || []) {
          if (t.type === "expense" && normalizePayeeKey(t.payee) === pKey) {
            t.category = catId;
            t.aiConfidence = 1.0;
            t.aiReason = "Taught by user";
            learnFromTransaction(t);
            count++;
          }
        }
        saveState();
        renderAiAssistantView(root);
        toast(`Learned! Updated ${count} transaction(s) to ${getCat(catId).name}.`);
      };
    });
  }

  /* ---------- Settings, Currency, Categories, PIN & Backup View ---------- */
  function renderSettingsView(root) {
    root.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">General & Primary Currency</h3></div>
          <div class="field mb-3">
            <label>Primary Display Currency</label>
            <select id="set-currency">
              ${Object.entries(CURRENCIES).map(([code, info]) => `<option value="${code}" ${state.settings.currency === code ? "selected" : ""}>${code} (${info.symbol}) — ${info.name}</option>`).join("")}
            </select>
          </div>
          <div class="field mb-3">
            <label>Add Custom Category</label>
            <div class="input-group cat-add-group">
              <input id="new-cat-icon" style="width:62px;text-align:center;" value="✨" maxlength="2" />
              <input id="new-cat-name" placeholder="Category name (e.g. Pets, Childcare)" style="min-width:150px;flex:1;" />
              <select id="new-cat-type" style="width:115px;min-width:115px;flex-shrink:0;"><option value="expense">Expense</option><option value="income">Income</option></select>
              <button class="btn btn-secondary btn-sm" id="add-cat-btn">Add</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${(state.categories || []).map((c) => `<span class="tag-chip">${c.icon} ${esc(c.name)}</span>`).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Security, Backups & Vault</h3></div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;gap:10px;flex-wrap:wrap;">
              <div>
                <strong>Biometric Unlock (Fingerprint / Face / Hello)</strong>
                <div class="text-xs muted">${state.settings.biometricLock ? "Active — device biometrics required on launch" : "Off — enable quick biometric unlock without a password"}</div>
              </div>
              <button class="btn ${state.settings.biometricLock ? "btn-danger" : "btn-primary"} btn-sm" id="toggle-biometric-btn">${state.settings.biometricLock ? "Disable Biometrics" : "Enable Biometrics"}</button>
            </div>

            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;gap:10px;flex-wrap:wrap;">
              <div>
                <strong>Optional App Password Lock</strong>
                <div class="text-xs muted">${state.settings.pinHash ? "Custom password is active" : "No password — app opens directly"}</div>
              </div>
              <div class="flex-gap">
                <button class="btn btn-secondary btn-sm" id="set-pin-btn">${state.settings.pinHash ? "Change Password" : "Set Password"}</button>
                ${state.settings.pinHash ? `<button class="btn btn-danger btn-sm" id="clear-pin-btn">Remove</button>` : ""}
              </div>
            </div>

            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;gap:10px;flex-wrap:wrap;">
              <div>
                <strong>Mobile Living Flow &amp; Logo Sound</strong>
                <div class="text-xs muted">ColorOS-style Laminar animations, opening chime &amp; tactile feedback on mobile</div>
              </div>
              <div class="flex-gap" style="flex-wrap:wrap;">
                <label class="checkbox-label"><input type="checkbox" id="set-mobile-anim" ${state.settings.mobileAnimations !== false ? "checked" : ""} /> Motion</label>
                <label class="checkbox-label"><input type="checkbox" id="set-mobile-sound" ${state.settings.mobileSound !== false ? "checked" : ""} /> Sound</label>
                <button type="button" class="btn btn-secondary btn-xs" id="test-chime-btn">Play Chime</button>
              </div>
            </div>

            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;">
              <div><strong>Full JSON Vault Backup</strong><div class="text-xs muted">Export all transactions, budgets, goals, and rules</div></div>
              <button class="btn btn-secondary btn-sm" id="download-json-btn">Export JSON</button>
            </div>

            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;">
              <div><strong>Restore from JSON Backup</strong><div class="text-xs muted">Load a previously exported LedgerFlow backup file</div></div>
              <div><input type="file" id="restore-json-input" accept=".json" class="hidden" /><button class="btn btn-secondary btn-sm" id="restore-json-btn">Restore File</button></div>
            </div>

            ${isDesktopHost && !isAndroidHost ? `
            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;">
              <div><strong>Windows AppData Vault Folder</strong><div class="text-xs muted">Inspect automatic daily backups & saved receipts</div></div>
              <button class="btn btn-secondary btn-sm" id="open-vault-dir-btn">Open Folder</button>
            </div>` : ""}

            <div class="flex-between" style="padding:12px;border:1px solid var(--border);border-radius:10px;">
              <div><strong>Reset / Load Sample Data</strong><div class="text-xs muted">Restore demo dataset or wipe clean to start fresh</div></div>
              <div class="flex-gap">
                <button class="btn btn-ghost btn-sm" id="load-demo-btn">Load Sample</button>
                <button class="btn btn-danger btn-sm" id="wipe-empty-btn">Start Blank</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header">
          <div>
            <h3 class="card-title">✨ LedgerFlow AI &amp; PDF Analyzer (Built-in Brain + Free Google Gemini)</h3>
            <p class="card-subtitle">Connect a free Gemini API key for smart financial Q&amp;A chat, payee cleanup, and pre-import PDF statement verification</p>
          </div>
          <span class="tag-chip">${Object.keys(state.settings.aiMemory || {}).length} learned payee(s)</span>
        </div>
        <div class="info-banner mb-3" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <span><strong>Free Gemini Key Setup:</strong> Google AI Studio gives a 100% free Gemini API key (no credit card). Create one, paste below, and LedgerFlow auto-switches across free Gemini models if one hits rate limit.</span>
          <a class="btn btn-secondary btn-xs" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get Free Gemini Key &nearr;</a>
        </div>
        <div class="form-grid-2">
          <div class="field">
            <label>AI Provider</label>
            <select id="set-ai-provider">
              <option value="none" ${(state.settings.aiConfig?.provider || "none") === "none" ? "selected" : ""}>Built-in Offline Intelligence Only (Free, Zero Internet)</option>
              <option value="gemini" ${state.settings.aiConfig?.provider === "gemini" ? "selected" : ""}>Google Gemini API (Free Tier Supported)</option>
              <option value="openai" ${state.settings.aiConfig?.provider === "openai" ? "selected" : ""}>OpenAI / OpenAI-Compatible API</option>
              <option value="ollama" ${state.settings.aiConfig?.provider === "ollama" ? "selected" : ""}>Local LLM (Ollama / LM Studio — Free Offline)</option>
            </select>
          </div>
          <div class="field">
            <label>Intelligence Mode</label>
            <select id="set-ai-mode">
              <option value="hybrid" ${(state.settings.aiConfig?.mode || "hybrid") === "hybrid" ? "selected" : ""}>Hybrid (Fast Local AI + LLM only on uncertain narrations)</option>
              <option value="local" ${state.settings.aiConfig?.mode === "local" ? "selected" : ""}>Offline Local Only (Never send data externally)</option>
              <option value="llm_all" ${state.settings.aiConfig?.mode === "llm_all" ? "selected" : ""}>Full LLM (Send every narration to configured AI)</option>
            </select>
          </div>
        </div>
        <div class="form-grid-3 mt-3" id="ai-remote-fields">
          <div class="field">
            <label>API Key (stored locally in vault)</label>
            <div class="input-group">
              <input id="set-ai-key" type="password" placeholder="Paste API key (blank for Ollama)" value="${esc(state.settings.aiConfig?.apiKey || "")}" autocomplete="off" />
              <button type="button" class="btn btn-secondary btn-sm" id="set-ai-key-toggle">Show</button>
            </div>
          </div>
          <div class="field">
            <label>Model Name</label>
            <input id="set-ai-model" type="text" placeholder="${state.settings.aiConfig?.provider === "openai" ? "gpt-4o-mini" : state.settings.aiConfig?.provider === "ollama" ? "llama3.2" : "gemini-3.8-flash"}" value="${esc(state.settings.aiConfig?.model || "")}" />
          </div>
          <div class="field">
            <label>Custom Endpoint URL (Optional)</label>
            <input id="set-ai-endpoint" type="text" placeholder="Leave blank for default or Ollama URL" value="${esc(state.settings.aiConfig?.endpoint || "")}" />
          </div>
        </div>
        <div class="field mt-3">
          <label>Custom AI Instructions / Rules (Plain English)</label>
          <textarea id="set-ai-prompt" rows="2" placeholder="e.g. Treat transfers to Rahul as Rent & Housing (fixed). Flag electronics purchases over ₹5000 as Special. Classify Vishal/Zudio as Shopping.">${esc(state.settings.aiConfig?.customPrompt || "")}</textarea>
        </div>
        <div class="flex-between mt-3" style="flex-wrap:wrap;gap:10px;">
          <div class="text-xs muted" id="ai-status-msg">Ready — Local payee learning is always active.</div>
          <div class="flex-gap" style="flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost btn-sm" id="ai-clear-mem-btn">Reset Learned Memory</button>
            <button type="button" class="btn btn-secondary btn-sm" id="ai-test-btn">Save &amp; Test AI</button>
            <button type="button" class="btn btn-primary btn-sm" id="ai-reclassify-all-btn">✨ Re-Classify All Entries</button>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header">
          <div>
            <h3 class="card-title">📑 Bank Statement Import Logs (${(state.importLogs || []).length})</h3>
            <p class="card-subtitle">Delete an individual import batch (e.g., if uploaded to the wrong bank) and re-upload cleanly to the right account</p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="set-open-importer-btn">+ Upload Statement</button>
        </div>
        <div id="settings-import-logs-list" style="display:flex;flex-direction:column;gap:8px;">
          ${renderImportLogsListHtml()}
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header">
          <div>
            <h3 class="card-title">🔄 App Updates &amp; GitHub Link</h3>
            <p class="card-subtitle">Installed version <strong>v${APP_VERSION}</strong> • Linked repo <code>${GITHUB_REPO}</code></p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" id="check-update-btn">Check for Updates</button>
            <button type="button" class="btn btn-primary btn-sm ${latestUpdateInfo && latestUpdateInfo.hasUpdate ? "" : "hidden"}" id="install-update-btn">Update to v${esc(latestUpdateInfo?.version || "")}</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1;">
            <label>GitHub Access Token (optional — only needed if repo is Private)</label>
            <input type="password" id="set-gh-token" value="${esc(state.settings.githubToken || "")}" placeholder="ghp_... (leave blank for Public repo)" autocomplete="off">
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button type="button" class="btn btn-secondary btn-sm" id="save-gh-token-btn">Save Token</button>
          </div>
        </div>
        <div id="update-status-msg" class="text-muted text-sm" style="margin-top:8px;">
          ${latestUpdateInfo && latestUpdateInfo.hasUpdate
            ? `New version v${esc(latestUpdateInfo.version)} is available on GitHub.`
            : "Checks GitHub Releases &amp; version.json automatically on launch."}
        </div>
      </div>`;

    bindImportLogActions(document.getElementById("settings-import-logs-list"), () => renderSettingsView(root));
    const openImpBtn = document.getElementById("set-open-importer-btn");
    if (openImpBtn) openImpBtn.onclick = () => openStatementModal();

    const ghSaveBtn = document.getElementById("save-gh-token-btn");
    if (ghSaveBtn) {
      ghSaveBtn.onclick = async () => {
        state.settings.githubToken = String(document.getElementById("set-gh-token")?.value || "").trim();
        await saveState();
        toast("GitHub token saved.");
      };
    }
    const chkUpdBtn = document.getElementById("check-update-btn");
    if (chkUpdBtn) {
      chkUpdBtn.onclick = async () => {
        const msgEl = document.getElementById("update-status-msg");
        if (msgEl) msgEl.textContent = "Checking GitHub for updates…";
        chkUpdBtn.disabled = true;
        const res = await checkForAppUpdates(false);
        chkUpdBtn.disabled = false;
        if (msgEl) {
          if (res.error) msgEl.textContent = res.error;
          else if (res.hasUpdate) msgEl.textContent = `Update available: v${res.version} (installed v${APP_VERSION}).`;
          else msgEl.textContent = `You are up to date (v${APP_VERSION}).`;
        }
        const instBtn = document.getElementById("install-update-btn");
        if (instBtn) {
          instBtn.classList.toggle("hidden", !(res && res.hasUpdate));
          if (res && res.hasUpdate) instBtn.textContent = `Update to v${res.version}`;
        }
      };
    }
    const instUpdBtn = document.getElementById("install-update-btn");
    if (instUpdBtn) {
      instUpdBtn.onclick = () => triggerAppUpdateInstall();
    }

    document.getElementById("set-currency").onchange = (e) => {
      state.settings.currency = e.target.value;
      saveState(); toast(`Display currency set to ${e.target.value}.`); updateSidebarMeta();
    };
    document.getElementById("add-cat-btn").onclick = () => {
      const name = document.getElementById("new-cat-name").value.trim();
      if (!name) return;
      state.categories.push({
        id: uid("cat"), name,
        icon: document.getElementById("new-cat-icon").value || "✨",
        color: "#6366f1", type: document.getElementById("new-cat-type").value
      });
      saveState(); renderSettingsView(root); toast("Category added.");
    };
    document.getElementById("toggle-biometric-btn").onclick = async () => {
      if (state.settings.biometricLock) {
        state.settings.biometricLock = false;
        await saveState();
        renderSettingsView(root);
        toast("Biometric unlock disabled.");
        return;
      }
      const res = await requestBiometricAuth();
      if (res.ok) {
        state.settings.biometricLock = true;
        await saveState();
        renderSettingsView(root);
        toast("Biometric unlock enabled.");
      } else {
        toast(res.error || "Biometrics unavailable or cancelled. Enable Fingerprint/Face/Windows Hello in device Settings first.");
      }
    };
    document.getElementById("set-pin-btn").onclick = () => {
      openSubModal("Set Vault Password", `
        <form id="pin-set-form" class="field">
          <label>Enter Password / Passcode (4 to 32 characters)</label>
          <input id="pin-new-val" type="password" minlength="4" maxlength="32" placeholder="Enter password" required />
          <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Save Password</button></div>
        </form>`);
      document.getElementById("pin-set-form").onsubmit = async (e) => {
        e.preventDefault();
        state.settings.pinHash = await sha256(document.getElementById("pin-new-val").value);
        state.settings.pinDisabledByUser = false;
        await saveState(); closeModal("sub-modal"); renderSettingsView(root); toast("Vault password enabled.");
      };
    };
    const clearPin = document.getElementById("clear-pin-btn");
    if (clearPin) clearPin.onclick = () => {
      state.settings.pinHash = "";
      state.settings.pinDisabledByUser = true;
      saveState(); renderSettingsView(root); toast("Vault password removed.");
    };

    const mobAnim = document.getElementById("set-mobile-anim");
    if (mobAnim) mobAnim.onchange = (e) => {
      state.settings.mobileAnimations = e.target.checked;
      document.body.classList.toggle("laminar-anim", state.settings.mobileAnimations);
      saveState();
    };
    const mobSound = document.getElementById("set-mobile-sound");
    if (mobSound) mobSound.onchange = (e) => {
      state.settings.mobileSound = e.target.checked;
      saveState();
    };
    const testChime = document.getElementById("test-chime-btn");
    if (testChime) testChime.onclick = () => playLogoChime(true);

    document.getElementById("download-json-btn").onclick = async () => {
      const cnt = (state.transactions || []).length;
      showPdfProgress("💾 Generating Vault Backup...", `Packaging ${cnt} transaction(s)...`, { percent: 40, stats: `${cnt} entries` });
      await yieldToUi();
      try {
        const jsonStr = JSON.stringify(state, null, 2);
        updatePdfProgress({ sub: "Writing JSON backup file...", percent: 95, stats: `${(jsonStr.length / 1024).toFixed(1)} KB` });
        downloadFile(`ledgerflow-backup-${todayISO()}.json`, jsonStr, "application/json");
        toast("Vault JSON backup exported.");
      } finally {
        hidePdfProgress();
      }
    };
    document.getElementById("restore-json-btn").onclick = () => document.getElementById("restore-json-input").click();
    document.getElementById("restore-json-input").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed.transactions || !parsed.accounts) throw new Error("Invalid backup structure");
          state = parsed; saveState(); switchView("overview"); toast("Vault backup restored!");
        } catch (err) { toast("Restore failed: " + err.message); }
      };
      reader.readAsText(file);
    };
    const openDir = document.getElementById("open-vault-dir-btn");
    if (openDir) openDir.onclick = () => apiFetch("/api/open-data-dir", { method: "POST" }).catch(() => {});
    document.getElementById("load-demo-btn").onclick = () => { state = createDemoData(); saveState(); switchView("overview"); toast("Sample data loaded."); };
    document.getElementById("wipe-empty-btn").onclick = () => {
      state = createBlankState(state.settings);
      saveState(); switchView("overview"); toast("Vault cleared — all balances reset to zero.");
    };

    const syncAiConfigFromInputs = () => {
      if (!state.settings.aiConfig) state.settings.aiConfig = {};
      let prov = document.getElementById("set-ai-provider").value;
      const key = document.getElementById("set-ai-key").value.trim();
      if (prov === "none" && /^AIza[0-9A-Za-z_-]{15,}$/.test(key)) {
        prov = "gemini";
        document.getElementById("set-ai-provider").value = "gemini";
      }
      state.settings.aiConfig.provider = prov;
      state.settings.aiConfig.mode = document.getElementById("set-ai-mode").value;
      state.settings.aiConfig.apiKey = key;
      state.settings.aiConfig.model = document.getElementById("set-ai-model").value.trim();
      state.settings.aiConfig.endpoint = document.getElementById("set-ai-endpoint").value.trim();
      state.settings.aiConfig.customPrompt = document.getElementById("set-ai-prompt").value.trim();
      saveState();
    };
    ["set-ai-provider", "set-ai-mode", "set-ai-key", "set-ai-model", "set-ai-endpoint", "set-ai-prompt"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.onchange = () => {
        syncAiConfigFromInputs();
        if (id === "set-ai-provider") renderSettingsView(root);
      };
    });
    document.getElementById("set-ai-key-toggle").onclick = () => {
      const kInp = document.getElementById("set-ai-key");
      const show = kInp.type === "password";
      kInp.type = show ? "text" : "password";
      document.getElementById("set-ai-key-toggle").textContent = show ? "Hide" : "Show";
    };
    document.getElementById("ai-clear-mem-btn").onclick = () => {
      state.settings.aiMemory = {};
      saveState();
      renderSettingsView(root);
      toast("Learned AI payee memory reset.");
    };
    document.getElementById("ai-test-btn").onclick = async () => {
      syncAiConfigFromInputs();
      const statusEl = document.getElementById("ai-status-msg");
      const cfg = state.settings.aiConfig;
      if (cfg.provider === "none" || cfg.mode === "local") {
        statusEl.textContent = "Offline Local AI active (" + Object.keys(state.settings.aiMemory || {}).length + " learned patterns).";
        return toast("Offline Local AI settings saved.");
      }
      statusEl.textContent = "Testing " + cfg.provider + " connection…";
      try {
        const sample = [{ id: "test_1", type: "expense", date: todayISO() + "T12:00", amount: 450, currency: state.settings.currency, payee: "APOLLO PHARMACY", notes: "UPI/DR/123/APOLLO/YESB/apollo@ybl/medicines" }];
        const out = await classifyBatchWithLLM(sample, cfg);
        statusEl.textContent = "Connected ✓ (" + (out[0]?.category || "ok") + " — " + (out[0]?.costNature || "variable") + ")";
        toast("AI connection verified successfully!");
      } catch (err) {
        statusEl.textContent = "Connection error: " + err.message;
        toast("AI test failed: " + err.message);
      }
    };
    document.getElementById("ai-reclassify-all-btn").onclick = async () => {
      syncAiConfigFromInputs();
      const btn = document.getElementById("ai-reclassify-all-btn");
      const statusEl = document.getElementById("ai-status-msg");
      btn.disabled = true;
      btn.textContent = "Running AI…";
      showPdfProgress("✨ Analyzing & Re-Classifying Entries...", `Inspecting ${(state.transactions || []).length} transaction(s)...`, { percent: 10 });
      try {
        const res = await runHybridAIClassification(state.transactions || [], {
          onlyUncertain: state.settings.aiConfig.mode !== "llm_all",
          onProgress: (msg, pctVal, feedArr) => {
            statusEl.textContent = msg;
            updatePdfProgress({
              sub: msg,
              percent: typeof pctVal === "number" ? pctVal : 65,
              feed: feedArr
            });
          }
        });
        updatePdfProgress({ sub: "Saving updated entries...", percent: 96 });
        await saveState();
        statusEl.textContent = `Updated ${res.updated} transaction(s) via ${res.source}.`;
        toast(`✨ Re-classified ${res.updated} transaction(s)!`);
      } catch (err) {
        statusEl.textContent = "Error: " + err.message;
        toast("AI re-classify failed: " + err.message);
      } finally {
        hidePdfProgress();
        btn.disabled = false;
        btn.textContent = "✨ Re-Classify All Entries";
      }
    };
  }

  /* ---------- Transaction Modal + Splits + Receipts ---------- */
  function openTxModal(editId = null) {
    const tx = editId ? state.transactions.find((t) => t.id === editId) : null;
    document.getElementById("tx-modal-title").textContent = tx ? "Edit Transaction" : "New Transaction";
    document.getElementById("tx-id").value = tx ? tx.id : "";

    const curSel = document.getElementById("tx-currency");
    curSel.innerHTML = Object.keys(CURRENCIES).map((c) => `<option value="${c}">${c}</option>`).join("");
    curSel.value = tx ? tx.currency : state.settings.currency;

    const accSel = document.getElementById("tx-account");
    const toAccSel = document.getElementById("tx-to-account");
    const accOpts = (state.accounts || []).map((a) => `<option value="${a.id}">${esc(formatAccountLabel(a))}</option>`).join("");
    accSel.innerHTML = accOpts;
    toAccSel.innerHTML = accOpts;
    if (tx) {
      accSel.value = tx.accountId;
      if (tx.toAccountId) toAccSel.value = tx.toAccountId;
    } else if (state.accounts.length > 1) {
      toAccSel.value = state.accounts[1].id;
    }

    const catSel = document.getElementById("tx-category");
    catSel.innerHTML = (state.categories || []).filter((c) => c.id !== "transfer").map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("");
    catSel.value = tx ? tx.category : "food";

    // Payee autocomplete
    const uniquePayees = Array.from(new Set(state.transactions.map((t) => t.payee))).slice(0, 30);
    document.getElementById("payee-suggestions").innerHTML = uniquePayees.map((p) => `<option value="${esc(p)}">`).join("");

    document.getElementById("tx-amount").value = tx ? tx.amount : "";
    document.getElementById("tx-date").value = tx ? tx.date.slice(0, 16) : dateTimeLocalNow(0);
    document.getElementById("tx-payee").value = tx ? tx.payee : "";
    document.getElementById("tx-method").value = tx ? tx.method : "Card";
    document.getElementById("tx-cost-nature").value = tx && tx.costNature ? tx.costNature : "auto";
    const ledSel = document.getElementById("tx-ledger");
    if (ledSel) {
      ledSel.innerHTML = `<option value="">— Bank General (No Separate Ledger) —</option>`
        + (state.ledgers || []).map((l) => `<option value="${l.id}">${l.type === "drawings" ? "💸 " : "👤 "}${esc(l.name)}</option>`).join("");
      ledSel.value = tx && tx.ledgerId ? tx.ledgerId : "";
    }
    document.getElementById("tx-tags").value = tx ? (tx.tags || []).join(", ") : "";
    document.getElementById("tx-notes").value = tx ? (tx.notes || "") : "";
    document.getElementById("tx-special").checked = tx ? !!tx.isSpecial : false;
    document.getElementById("tx-tax-deductible").checked = tx ? !!tx.taxDeductible : false;
    document.getElementById("tx-reconciled").checked = tx ? tx.reconciled !== false : true;

    document.getElementById("tx-receipt-input").value = "";
    pendingReceiptData = tx && tx.receipt ? tx.receipt : null;
    updateReceiptLabel();

    splitLinesDraft = tx && tx.splits ? tx.splits.map((s) => ({ ...s })) : [];
    document.getElementById("split-builder").classList.toggle("hidden", splitLinesDraft.length === 0);
    renderSplitRows();

    setTxTypeTab(tx ? tx.type : "expense");
    updateFxHint();
    document.getElementById("tx-modal").classList.remove("hidden");
  }

  function setTxTypeTab(type) {
    document.querySelectorAll("#tx-type-tabs .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
    const isTransfer = type === "transfer";
    document.getElementById("tx-to-account-field").classList.toggle("hidden", !isTransfer);
    document.getElementById("tx-category-row").classList.toggle("hidden", isTransfer);
    document.getElementById("tx-account-label").textContent = isTransfer ? "From Source Account *" : "Account / Card *";
    document.getElementById("tx-payee-label").textContent = isTransfer ? "Transfer Label *" : "Merchant / Payee *";
    if (isTransfer && !document.getElementById("tx-payee").value) document.getElementById("tx-payee").value = "Internal Transfer";
  }

  function updateFxHint() {
    const cur = document.getElementById("tx-currency").value;
    const amt = Number(document.getElementById("tx-amount").value) || 0;
    const hint = document.getElementById("tx-fx-hint");
    if (cur !== state.settings.currency && amt > 0) {
      hint.classList.remove("hidden");
      hint.textContent = `≈ ${fmtMoney(convertToBase(amt, cur))} in ${state.settings.currency}`;
    } else {
      hint.classList.add("hidden");
    }
  }

  function renderSplitRows() {
    const box = document.getElementById("split-rows");
    const total = Number(document.getElementById("tx-amount").value) || 0;
    const allocated = splitLinesDraft.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    document.getElementById("split-remaining-label").textContent = `Remaining: ${(total - allocated).toFixed(2)}`;

    box.innerHTML = splitLinesDraft.map((row, idx) => `
      <div class="split-row">
        <select class="sp-cat" data-idx="${idx}">${(state.categories || []).filter((c) => c.id !== "transfer").map((c) => `<option value="${c.id}" ${row.category === c.id ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select>
        <input class="sp-amt" data-idx="${idx}" type="number" step="0.01" placeholder="Amount" value="${row.amount || ""}" />
        <input class="sp-note" data-idx="${idx}" type="text" placeholder="Item note" value="${esc(row.note || "")}" />
        <button type="button" class="icon-btn sp-del" data-idx="${idx}">&times;</button>
      </div>`).join("");

    box.querySelectorAll(".sp-cat").forEach((el) => { el.onchange = () => { splitLinesDraft[el.dataset.idx].category = el.value; }; });
    box.querySelectorAll(".sp-amt").forEach((el) => { el.oninput = () => { splitLinesDraft[el.dataset.idx].amount = Number(el.value) || 0; renderSplitRows(); }; });
    box.querySelectorAll(".sp-note").forEach((el) => { el.oninput = () => { splitLinesDraft[el.dataset.idx].note = el.value; }; });
    box.querySelectorAll(".sp-del").forEach((el) => { el.onclick = () => { splitLinesDraft.splice(Number(el.dataset.idx), 1); renderSplitRows(); }; });
  }

  function updateReceiptLabel() {
    document.getElementById("tx-receipt-name").textContent = pendingReceiptData ? pendingReceiptData.name : "No file attached";
    document.getElementById("tx-receipt-clear").classList.toggle("hidden", !pendingReceiptData);
  }

  function openReceiptViewer(receipt) {
    const isPdf = (receipt.name || "").toLowerCase().endsWith(".pdf") || (receipt.dataUrl || "").startsWith("data:application/pdf");
    const content = isPdf
      ? `<iframe src="${receipt.dataUrl}" style="width:100%;height:460px;border:1px solid var(--border);border-radius:10px;"></iframe>`
      : `<img src="${receipt.dataUrl}" alt="Receipt" style="max-width:100%;max-height:480px;border-radius:10px;display:block;margin:0 auto;" />`;
    openSubModal(`Receipt: ${esc(receipt.name)}`, content);
  }

  /* ---------- Sub-Modals ---------- */
  function openSubModal(title, html, sizeClass = "") {
    const box = document.getElementById("sub-modal-box");
    box.className = "modal " + sizeClass;
    document.getElementById("sub-modal-title").textContent = title;
    document.getElementById("sub-modal-body").innerHTML = html;
    document.getElementById("sub-modal").classList.remove("hidden");
  }

  function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
  }

  function openBulkCategoryModal() {
    openSubModal("Bulk Set Category", `
      <form id="bulk-cat-form" class="field">
        <label>Assign Category to ${selectedTxIds.size} Selected Transactions</label>
        <select id="bulk-cat-val">${(state.categories || []).map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("")}</select>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Apply Category</button></div>
      </form>`);
    document.getElementById("bulk-cat-form").onsubmit = (e) => {
      e.preventDefault();
      const cat = document.getElementById("bulk-cat-val").value;
      state.transactions.forEach((t) => {
        if (selectedTxIds.has(t.id)) {
          t.category = cat;
          learnFromTransaction(t);
        }
      });
      selectedTxIds.clear(); saveState(); closeModal("sub-modal"); switchView("transactions"); toast("Bulk category updated & learned.");
    };
  }

  function openBudgetModal() {
    openSubModal("New Category Budget", `
      <form id="new-budget-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field"><label>Category</label><select id="nb-cat">${(state.categories || []).filter((c) => c.type === "expense").map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Monthly Limit (${state.settings.currency})</label><input id="nb-lim" type="number" min="1" step="100" required /></div>
        <label class="checkbox-label"><input type="checkbox" id="nb-roll"/> Rollover unused balance to next month</label>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Save Budget</button></div>
      </form>`);
    document.getElementById("new-budget-form").onsubmit = (e) => {
      e.preventDefault();
      const category = document.getElementById("nb-cat").value;
      const limit = Number(document.getElementById("nb-lim").value) || 0;
      const rollover = document.getElementById("nb-roll").checked;
      const existing = state.budgets.find((b) => b.category === category);
      if (existing) { existing.limit = limit; existing.rollover = rollover; }
      else state.budgets.push({ id: uid("b"), category, limit, rollover });
      saveState(); closeModal("sub-modal"); switchView("budgets"); toast("Budget saved.");
    };
  }

  function openRecurringModal() {
    openSubModal("Add Recurring Bill / Subscription", `
      <form id="rec-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field"><label>Payee / Subscription Name</label><input id="rf-payee" required placeholder="e.g. Netflix, Rent, SIP" /></div>
        <div class="form-grid-2">
          <div class="field"><label>Amount</label><input id="rf-amt" type="number" step="0.01" min="1" required /></div>
          <div class="field"><label>Frequency</label><select id="rf-freq"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="biweekly">Bi-Weekly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label>Category</label><select id="rf-cat">${(state.categories || []).filter((c) => c.id !== "transfer").map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Account</label><select id="rf-acc">${(state.accounts || []).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Next Due Date</label><input id="rf-due" type="date" value="${todayISO(1)}" required /></div>
        <label class="checkbox-label"><input type="checkbox" id="rf-auto"/> Auto-post automatically on due date</label>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Create Schedule</button></div>
      </form>`);
    document.getElementById("rec-form").onsubmit = (e) => {
      e.preventDefault();
      state.recurring.push({
        id: uid("r"), payee: document.getElementById("rf-payee").value.trim(), type: "expense",
        amount: Number(document.getElementById("rf-amt").value), currency: state.settings.currency,
        frequency: document.getElementById("rf-freq").value, category: document.getElementById("rf-cat").value,
        accountId: document.getElementById("rf-acc").value, nextDue: document.getElementById("rf-due").value,
        autoPost: document.getElementById("rf-auto").checked, active: true
      });
      saveState(); closeModal("sub-modal"); switchView("recurring"); toast("Recurring schedule added.");
    };
  }

  function openAccountModal(editId = null, onSaved = null) {
    const acc = editId ? state.accounts.find((a) => a.id === editId) : null;
    openSubModal(acc ? "Edit Bank Account / Card" : "Add Bank Account / Card", `
      <form id="acc-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-grid-2">
          <div class="field">
            <label>Bank / Institution Name <span class="req">*</span></label>
            <input id="af-bank" required list="bank-suggestions" value="${acc ? esc(acc.bankName || "") : ""}" placeholder="e.g. State Bank of India, HDFC Bank, ICICI" />
            <datalist id="bank-suggestions">
              <option value="State Bank of India (SBI)">
              <option value="HDFC Bank">
              <option value="ICICI Bank">
              <option value="Axis Bank">
              <option value="Kotak Mahindra Bank">
              <option value="Punjab National Bank">
              <option value="Bank of Baroda">
              <option value="Canara Bank">
              <option value="IndusInd Bank">
              <option value="Yes Bank">
              <option value="Cash Wallet">
            </datalist>
          </div>
          <div class="field">
            <label>Account Label / Branch <span class="req">*</span></label>
            <input id="af-name" required value="${acc ? esc(acc.name) : ""}" placeholder="e.g. Main Savings, Business Current, Salary A/C" />
          </div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label>Account Type</label><select id="af-type">
            <option value="bank" ${!acc || acc?.type === "bank" ? "selected" : ""}>Savings Bank Account</option>
            <option value="current" ${acc?.type === "current" ? "selected" : ""}>Current / Business Account</option>
            <option value="credit" ${acc?.type === "credit" ? "selected" : ""}>Credit Card</option>
            <option value="cash" ${acc?.type === "cash" ? "selected" : ""}>Cash Wallet</option>
            <option value="savings" ${acc?.type === "savings" ? "selected" : ""}>Savings Vault / FD</option>
            <option value="investment" ${acc?.type === "investment" ? "selected" : ""}>Investment / Demat</option>
          </select></div>
          <div class="field">
            <label>Account No. Last 4 Digits (Optional)</label>
            <input id="af-last4" maxlength="8" value="${acc ? esc(acc.accountNumberLast4 || "") : ""}" placeholder="e.g. 4199" />
          </div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label>Starting / Opening Balance</label><input id="af-bal" type="number" step="0.01" value="${acc ? acc.initialBalance : 0}" required /></div>
          <div class="field"><label>Credit Limit (Cards only, 0 otherwise)</label><input id="af-lim" type="number" step="100" value="${acc ? (acc.creditLimit || 0) : 0}" /></div>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">${acc ? "Save Bank Account" : "Add Bank Account"}</button></div>
      </form>`);
    document.getElementById("acc-form").onsubmit = (e) => {
      e.preventDefault();
      const bankName = document.getElementById("af-bank").value.trim();
      const name = document.getElementById("af-name").value.trim();
      const type = document.getElementById("af-type").value;
      const accountNumberLast4 = document.getElementById("af-last4").value.trim();
      const initialBalance = Number(document.getElementById("af-bal").value) || 0;
      const creditLimit = Number(document.getElementById("af-lim").value) || 0;
      let savedAcc = acc;
      if (acc) {
        acc.bankName = bankName; acc.name = name; acc.type = type;
        acc.accountNumberLast4 = accountNumberLast4;
        acc.initialBalance = initialBalance; acc.creditLimit = creditLimit;
      } else {
        savedAcc = {
          id: uid("acc"), bankName, name, accountNumberLast4, type,
          currency: state.settings.currency, initialBalance, creditLimit, color: "#4f46e5"
        };
        state.accounts.push(savedAcc);
      }
      saveState();
      closeModal("sub-modal");
      if (onSaved) onSaved(savedAcc);
      else switchView(currentView);
      toast(acc ? "Bank account updated." : "Bank account added.");
    };
  }

  function openReconcileModal(accountId) {
    const acc = getAcc(accountId);
    const curBal = getAccountBalance(accountId);
    openSubModal(`Reconcile: ${esc(acc.name)}`, `
      <form id="rec-acc-form" class="field">
        <p class="text-sm muted">Current calculated balance: <strong class="money-val">${fmtMoney(curBal)}</strong></p>
        <label>Actual Bank / Statement Balance</label>
        <input id="actual-bal-input" type="number" step="0.01" value="${curBal.toFixed(2)}" required />
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Post Adjustment</button></div>
      </form>`);
    document.getElementById("rec-acc-form").onsubmit = (e) => {
      e.preventDefault();
      const target = Number(document.getElementById("actual-bal-input").value);
      const diff = target - curBal;
      if (Math.abs(diff) > 0.009) {
        state.transactions.unshift({
          id: uid("tx"), type: diff >= 0 ? "income" : "expense", amount: Math.abs(diff),
          currency: state.settings.currency, baseAmount: Math.abs(diff), date: dateTimeLocalNow(0),
          payee: "Balance Reconciliation Adjustment", category: diff >= 0 ? "refund" : "other_exp",
          accountId, method: "Bank Transfer", tags: ["reconcile"], notes: "Statement balance alignment", taxDeductible: false, reconciled: true
        });
        saveState();
      }
      closeModal("sub-modal"); switchView("accounts"); toast("Account reconciled.");
    };
  }

  function openGoalModal() {
    openSubModal("New Savings Goal", `
      <form id="goal-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field"><label>Goal Name</label><input id="gf-name" required placeholder="e.g. Home Down Payment" /></div>
        <div class="form-grid-2">
          <div class="field"><label>Target Amount</label><input id="gf-target" type="number" min="1" step="any" required /></div>
          <div class="field"><label>Already Saved</label><input id="gf-saved" type="number" min="0" step="any" value="0" /></div>
        </div>
        <div class="field"><label>Target Date</label><input id="gf-date" type="date" value="${todayISO(180)}" required /></div>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Save Goal</button></div>
      </form>`);
    document.getElementById("goal-form").onsubmit = (e) => {
      e.preventDefault();
      state.goals.push({
        id: uid("g"), name: document.getElementById("gf-name").value.trim(),
        target: Number(document.getElementById("gf-target").value), saved: Number(document.getElementById("gf-saved").value) || 0,
        deadline: document.getElementById("gf-date").value, color: "#10b981"
      });
      saveState(); closeModal("sub-modal"); switchView("goals"); toast("Savings goal created.");
    };
  }

  function openIouModal() {
    openSubModal("Add Split Bill / IOU", `
      <form id="iou-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field"><label>Person Name</label><input id="if-person" required placeholder="e.g. Alex" /></div>
        <div class="form-grid-2">
          <div class="field"><label>Direction</label><select id="if-dir"><option value="owed_to_me">They owe me</option><option value="i_owe">I owe them</option></select></div>
          <div class="field"><label>Share Amount</label><input id="if-amt" type="number" step="0.01" min="1" required /></div>
        </div>
        <div class="field"><label>Description</label><input id="if-desc" required placeholder="e.g. Dinner split" /></div>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Add IOU</button></div>
      </form>`);
    document.getElementById("iou-form").onsubmit = (e) => {
      e.preventDefault();
      state.ious.unshift({
        id: uid("iou"), person: document.getElementById("if-person").value.trim(),
        direction: document.getElementById("if-dir").value, amount: Number(document.getElementById("if-amt").value),
        description: document.getElementById("if-desc").value.trim(), date: todayISO(0), settled: false
      });
      saveState(); closeModal("sub-modal"); switchView("goals"); toast("Split IOU added.");
    };
  }

  function openRuleModal() {
    openSubModal("Create Smart Rule", `
      <form id="rule-form" style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-grid-2">
          <div class="field"><label>Match Field</label><select id="rl-field"><option value="payee">Merchant / Payee</option><option value="notes">Notes</option></select></div>
          <div class="field"><label>Operator</label><select id="rl-op"><option value="contains">Contains (use | for OR)</option><option value="startsWith">Starts With</option><option value="regex">Regex</option></select></div>
        </div>
        <div class="field"><label>Pattern</label><input id="rl-pat" required placeholder="e.g. starbucks|coffee|cafe" /></div>
        <div class="form-grid-2">
          <div class="field"><label>Assign Category</label><select id="rl-cat">${(state.categories || []).filter((c) => c.id !== "transfer").map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Add Tags</label><input id="rl-tags" placeholder="e.g. coffee, client" /></div>
        </div>
        <label class="checkbox-label"><input type="checkbox" id="rl-tax"/> Mark matching entries as Tax-Deductible</label>
        <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close="sub-modal">Cancel</button><button type="submit" class="btn btn-primary">Save Rule</button></div>
      </form>`);
    document.getElementById("rule-form").onsubmit = (e) => {
      e.preventDefault();
      state.rules.push({
        id: uid("rule"), field: document.getElementById("rl-field").value, operator: document.getElementById("rl-op").value,
        pattern: document.getElementById("rl-pat").value.trim(), category: document.getElementById("rl-cat").value,
        tags: document.getElementById("rl-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
        taxDeductible: document.getElementById("rl-tax").checked, active: true
      });
      saveState(); closeModal("sub-modal"); switchView("rules"); toast("Smart rule created.");
    };
  }

  /* ---------- Monthly Cost & Trend Intelligence Engine ---------- */
  function getMonthKey(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr).slice(0, 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatMonthLabel(monthKey) {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || "";
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  function shiftMonthKey(monthKey, delta) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function getRecurringPayeeSet() {
    const payeeMonths = {};
    for (const t of state.transactions || []) {
      if (t.type !== "expense") continue;
      const key = (t.payee || "").trim().toLowerCase();
      const mk = getMonthKey(t.date);
      if (!key || !mk) continue;
      if (!payeeMonths[key]) payeeMonths[key] = new Set();
      payeeMonths[key].add(mk);
    }
    const rec = new Set();
    for (const [k, months] of Object.entries(payeeMonths)) {
      if (months.size >= 3) rec.add(k);
    }
    return rec;
  }

  function resolveCostNature(tx, recurringPayees = null) {
    if (tx.costNature === "fixed" || tx.costNature === "variable") return tx.costNature;
    const cat = getCat(tx.category);
    if (cat.costNature === "fixed") return "fixed";
    const tags = (tx.tags || []).map((x) => x.toLowerCase());
    if (tags.includes("fixed") || tags.includes("recurring") || tags.includes("emi") || tags.includes("rent") || tags.includes("sip")) return "fixed";
    if (tags.includes("variable")) return "variable";
    const txt = `${tx.payee || ""} ${tx.notes || ""}`.toLowerCase();
    if (/\b(emi|nach|achdr|mandate|bajaj fi|idfc first|tatacap|rent|broadband|fibernet|mutual f|groww|sip|amc|autopay)\b/.test(txt)) return "fixed";
    if (tx.method === "Auto-Debit") return "fixed";
    const amt = txBaseAmount(tx);
    if (amt >= 250 && recurringPayees && recurringPayees.has((tx.payee || "").trim().toLowerCase())) {
      return "fixed";
    }
    return "variable";
  }

  function computeMonthlyAnalytics(monthKey, recurringPayees = null) {
    const recSet = recurringPayees || getRecurringPayeeSet();
    const pettyMax = Number(state.settings.pettyExpenseMax) || 200;
    const bigMin = Number(state.settings.bigExpenseMin) || 2500;

    const allTxs = (state.transactions || []).filter((t) => getMonthKey(t.date) === monthKey);
    const incomes = allTxs.filter((t) => t.type === "income");
    const expenses = allTxs.filter((t) => t.type === "expense");

    const totalIncome = incomes.reduce((s, t) => s + txBaseAmount(t), 0);
    const totalExpense = expenses.reduce((s, t) => s + txBaseAmount(t), 0);
    const net = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.round((net / totalIncome) * 100) : 0;

    // Statistical median for automatic Special outlier detection
    const sortedAmts = expenses.map((t) => txBaseAmount(t)).sort((a, b) => a - b);
    const median = sortedAmts.length ? sortedAmts[Math.floor(sortedAmts.length / 2)] : 0;
    const outlierCutoff = Math.max(bigMin * 1.5, median * 6, totalExpense * 0.12);

    const enriched = expenses.map((t) => {
      const amt = txBaseAmount(t);
      const nature = resolveCostNature(t, recSet);
      let sizeTier = "regular";
      if (amt <= pettyMax) sizeTier = "petty";
      else if (amt >= bigMin) sizeTier = "big";

      const autoSpecial = (amt >= outlierCutoff && nature === "variable" && !recSet.has((t.payee || "").trim().toLowerCase()))
        || (t.tags || []).some((tg) => /special|one-?off|travel|wedding|appliance|medical/i.test(tg));
      const isSpecial = typeof t.isSpecial === "boolean" ? t.isSpecial : autoSpecial;

      return { tx: t, amt, nature, sizeTier, isSpecial };
    });

    const fixedItems = enriched.filter((e) => e.nature === "fixed");
    const variableItems = enriched.filter((e) => e.nature === "variable");
    const pettyItems = enriched.filter((e) => e.sizeTier === "petty");
    const regularItems = enriched.filter((e) => e.sizeTier === "regular");
    const bigItems = enriched.filter((e) => e.sizeTier === "big");
    const specialItems = enriched.filter((e) => e.isSpecial);

    const sum = (arr) => arr.reduce((s, e) => s + e.amt, 0);
    const fixedTotal = sum(fixedItems);
    const variableTotal = sum(variableItems);
    const pettyTotal = sum(pettyItems);
    const regularTotal = sum(regularItems);
    const bigTotal = sum(bigItems);
    const specialTotal = sum(specialItems);
    const normalizedExpense = Math.max(0, totalExpense - specialTotal);

    return {
      monthKey,
      label: formatMonthLabel(monthKey),
      incomes,
      expenses,
      enriched,
      totalIncome,
      totalExpense,
      net,
      savingsRate,
      fixedItems,
      variableItems,
      fixedTotal,
      variableTotal,
      pettyItems,
      regularItems,
      bigItems,
      specialItems,
      pettyTotal,
      regularTotal,
      bigTotal,
      specialTotal,
      normalizedExpense,
      pettyMax,
      bigMin
    };
  }

  function renderMonthlyTrendChart(containerId, centerMonthKey, recSet) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const mk = shiftMonthKey(centerMonthKey, -i);
      const a = computeMonthlyAnalytics(mk, recSet);
      const [y, m] = mk.split("-").map(Number);
      months.push({
        mk,
        label: new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        income: a.totalIncome,
        fixed: a.fixedTotal,
        variable: a.variableTotal,
        totalExp: a.totalExpense,
        petty: a.pettyTotal,
        big: a.bigTotal
      });
    }

    const maxVal = Math.max(1000, ...months.flatMap((m) => [m.income, m.totalExp]));
    const W = 620, H = 240, padL = 54, padR = 16, padT = 18, padB = 34;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    const groupW = chartW / months.length;
    const barW = Math.min(20, groupW * 0.25);

    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = padT + chartH * (1 - f);
      const v = maxVal * f;
      const lbl = v >= 100000 ? (v / 100000).toFixed(1) + "L" : v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 3" />
              <text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-soft)" font-size="11">${lbl}</text>`;
    }).join("");

    const bars = months.map((m, idx) => {
      const cx = padL + groupW * idx + groupW / 2;
      const incH = (m.income / maxVal) * chartH;
      const fixH = (m.fixed / maxVal) * chartH;
      const varH = (m.variable / maxVal) * chartH;
      const isActive = m.mk === centerMonthKey;
      return `
        <g>
          ${isActive ? `<rect x="${padL + groupW * idx + 4}" y="${padT}" width="${groupW - 8}" height="${chartH}" rx="6" fill="var(--primary-soft)" opacity="0.55"/>` : ""}
          <rect x="${cx - barW - 2}" y="${padT + chartH - incH}" width="${barW}" height="${Math.max(2, incH)}" rx="4" fill="#10b981" opacity="0.9"/>
          <rect x="${cx + 2}" y="${padT + chartH - varH}" width="${barW}" height="${Math.max(0, varH)}" rx="2" fill="#f59e0b" opacity="0.92"/>
          <rect x="${cx + 2}" y="${padT + chartH - varH - fixH}" width="${barW}" height="${Math.max(0, fixH)}" rx="4" fill="#4f46e5" opacity="0.95"/>
          <text x="${cx}" y="${H - 10}" text-anchor="middle" fill="${isActive ? "var(--primary)" : "var(--text-muted)"}" font-size="11.5" font-weight="${isActive ? "700" : "600"}">${m.label}</text>
          <rect x="${padL + groupW * idx}" y="${padT}" width="${groupW}" height="${chartH}" fill="transparent" class="mt-hover-zone"
            data-label="${esc(m.label)}" data-inc="${m.income}" data-fix="${m.fixed}" data-var="${m.variable}" data-petty="${m.petty}" data-big="${m.big}" data-tot="${m.totalExp}" />
        </g>`;
    }).join("");

    el.innerHTML = `
      <div class="chart-container">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible;">${grid}${bars}</svg>
        <div class="chart-tooltip hidden" id="${containerId}-tip"></div>
      </div>
      <div class="flex-gap mt-2 text-xs muted" style="justify-content:center;flex-wrap:wrap;gap:14px;">
        <span><span class="legend-swatch" style="display:inline-block;background:#10b981;vertical-align:middle;"></span> Income</span>
        <span><span class="legend-swatch" style="display:inline-block;background:#4f46e5;vertical-align:middle;"></span> Fixed Cost</span>
        <span><span class="legend-swatch" style="display:inline-block;background:#f59e0b;vertical-align:middle;"></span> Variable Cost</span>
      </div>`;

    const tip = document.getElementById(`${containerId}-tip`);
    el.querySelectorAll(".mt-hover-zone").forEach((z) => {
      z.addEventListener("mousemove", (e) => {
        const rect = el.getBoundingClientRect();
        tip.classList.remove("hidden");
        tip.style.left = (e.clientX - rect.left) + "px";
        tip.style.top = (e.clientY - rect.top - 8) + "px";
        tip.innerHTML = `<strong>${z.dataset.label}</strong><br/>Income: ${fmtMoney(z.dataset.inc)}<br/>Total Spend: ${fmtMoney(z.dataset.tot)}<br/>Fixed: ${fmtMoney(z.dataset.fix)} | Variable: ${fmtMoney(z.dataset.var)}<br/>Petty: ${fmtMoney(z.dataset.petty)} | Big: ${fmtMoney(z.dataset.big)}`;
      });
      z.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    });
  }

  function renderDailyCumulativeCurve(containerId, curAnalytics, prevAnalytics) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const [y, m] = curAnalytics.monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();

    const buildCum = (expenses, days) => {
      const daily = new Array(days).fill(0);
      for (const t of expenses) {
        const d = new Date(t.date).getDate();
        if (d >= 1 && d <= days) daily[d - 1] += txBaseAmount(t);
      }
      const cum = [];
      let run = 0;
      for (let i = 0; i < days; i++) { run += daily[i]; cum.push(run); }
      return cum;
    };

    const curCum = buildCum(curAnalytics.expenses, daysInMonth);
    const prevCum = buildCum(prevAnalytics.expenses, daysInMonth);
    const maxY = Math.max(1000, curCum[curCum.length - 1] || 0, prevCum[prevCum.length - 1] || 0);

    const W = 540, H = 210, padL = 52, padR = 16, padT = 16, padB = 28;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    const toPts = (arr) => arr.map((v, i) => {
      const x = padL + (i / Math.max(1, arr.length - 1)) * chartW;
      const py = padT + chartH - (v / maxY) * chartH;
      return `${x.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");

    const grid = [0, 0.5, 1].map((f) => {
      const py = padT + chartH * (1 - f);
      const v = maxY * f;
      const lbl = v >= 100000 ? (v / 100000).toFixed(1) + "L" : v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v);
      return `<line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="var(--border)" stroke-dasharray="3 3"/>
              <text x="${padL - 8}" y="${py + 4}" text-anchor="end" fill="var(--text-soft)" font-size="11">${lbl}</text>`;
    }).join("");

    const dayLabels = [1, 8, 15, 22, daysInMonth].map((d) => {
      const x = padL + ((d - 1) / Math.max(1, daysInMonth - 1)) * chartW;
      return `<text x="${x}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11">Day ${d}</text>`;
    }).join("");

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible;">
        ${grid}${dayLabels}
        <polyline fill="none" stroke="var(--text-soft)" stroke-width="2" stroke-dasharray="5 4" points="${toPts(prevCum)}" />
        <polyline fill="none" stroke="var(--primary)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" points="${toPts(curCum)}" />
      </svg>
      <div class="flex-gap mt-2 text-xs muted" style="justify-content:center;gap:16px;">
        <span><span class="legend-swatch" style="display:inline-block;background:var(--primary);vertical-align:middle;"></span> ${esc(curAnalytics.label)}</span>
        <span><span class="legend-swatch" style="display:inline-block;background:var(--text-soft);vertical-align:middle;"></span> Previous Month (${esc(prevAnalytics.label)})</span>
      </div>`;
  }

  function renderMonthlyIntelligenceView(root) {
    const recSet = getRecurringPayeeSet();
    const monthSet = new Set();
    for (const t of state.transactions || []) {
      const mk = getMonthKey(t.date);
      if (mk && /^\d{4}-\d{2}$/.test(mk)) monthSet.add(mk);
    }
    const nowKey = getMonthKey(new Date().toISOString());
    if (monthSet.size === 0) monthSet.add(nowKey);
    const availableMonths = Array.from(monthSet).sort().reverse();
    if (!selectedMonthKey || !monthSet.has(selectedMonthKey)) {
      selectedMonthKey = availableMonths[0];
    }

    const cur = computeMonthlyAnalytics(selectedMonthKey, recSet);
    const prevKey = shiftMonthKey(selectedMonthKey, -1);
    const prev = computeMonthlyAnalytics(prevKey, recSet);

    // 3-month rolling average before selected month
    const histMonths = [1, 2, 3].map((k) => computeMonthlyAnalytics(shiftMonthKey(selectedMonthKey, -k), recSet)).filter((a) => a.totalExpense > 0);
    const avg3Exp = histMonths.length ? histMonths.reduce((s, a) => s + a.totalExpense, 0) / histMonths.length : 0;

    const pctDelta = (c, p) => {
      if (!p) return null;
      return Math.round(((c - p) / p) * 100);
    };
    const incDelta = pctDelta(cur.totalIncome, prev.totalIncome);
    const expDelta = pctDelta(cur.totalExpense, prev.totalExpense);
    const fixedPct = cur.totalExpense > 0 ? Math.round((cur.fixedTotal / cur.totalExpense) * 100) : 0;
    const varPct = cur.totalExpense > 0 ? 100 - fixedPct : 0;
    const fixedIncomeCov = cur.totalIncome > 0 ? Math.round((cur.fixedTotal / cur.totalIncome) * 100) : 0;

    // Group Fixed & Variable by category
    const groupByCat = (items) => {
      const map = {};
      for (const it of items) {
        const cid = it.tx.category || "other_exp";
        map[cid] = (map[cid] || 0) + it.amt;
      }
      return Object.entries(map).map(([cid, val]) => ({ cat: getCat(cid), val })).sort((a, b) => b.val - a.val);
    };
    const fixedCats = groupByCat(cur.fixedItems);
    const varCats = groupByCat(cur.variableItems);

    // Weekly breakdown for selected month
    const weeks = [
      { label: "Week 1 (1–7)", min: 1, max: 7 },
      { label: "Week 2 (8–14)", min: 8, max: 14 },
      { label: "Week 3 (15–21)", min: 15, max: 21 },
      { label: "Week 4+ (22–End)", min: 22, max: 31 }
    ].map((w) => {
      const wItems = cur.enriched.filter((e) => {
        const d = new Date(e.tx.date).getDate();
        return d >= w.min && d <= w.max;
      });
      const sumW = (fn) => wItems.filter(fn).reduce((s, e) => s + e.amt, 0);
      return {
        label: w.label,
        count: wItems.length,
        fixed: sumW((e) => e.nature === "fixed"),
        variable: sumW((e) => e.nature === "variable"),
        petty: sumW((e) => e.sizeTier === "petty"),
        big: sumW((e) => e.sizeTier === "big"),
        total: sumW(() => true)
      };
    });

    // Category MoM trend
    const curCatMap = getCategorySpendingMap(cur.expenses);
    const prevCatMap = getCategorySpendingMap(prev.expenses);
    const catTrendRows = Object.keys(curCatMap)
      .map((cid) => {
        const cVal = curCatMap[cid] || 0;
        const pVal = prevCatMap[cid] || 0;
        const dPct = pVal > 0 ? Math.round(((cVal - pVal) / pVal) * 100) : null;
        return { cat: getCat(cid), cVal, pVal, dPct };
      })
      .sort((a, b) => b.cVal - a.cVal);

    // Top Petty Payees
    const pettyPayees = {};
    cur.pettyItems.forEach((e) => {
      const name = e.tx.payee || "Unknown";
      if (!pettyPayees[name]) pettyPayees[name] = { count: 0, total: 0 };
      pettyPayees[name].count++;
      pettyPayees[name].total += e.amt;
    });
    const topPetty = Object.entries(pettyPayees).sort((a, b) => b[1].total - a[1].total).slice(0, 4);

    // Narrative insights for same month
    const narrative = [];
    if (cur.expenses.length === 0 && cur.incomes.length === 0) {
      narrative.push(`No transactions recorded for ${cur.label}. Upload your bank statement or add entries to generate this month's summary.`);
    } else {
      narrative.push(`In <strong>${esc(cur.label)}</strong>, total inflow was <strong class="amount-income money-val">${fmtMoney(cur.totalIncome)}</strong> and total outflow was <strong class="money-val">${fmtMoney(cur.totalExpense)}</strong>, leaving a net ${cur.net >= 0 ? "surplus" : "deficit"} of <strong class="money-val">${fmtMoney(cur.net, null, true)}</strong> (${cur.savingsRate}% savings rate).`);
      narrative.push(`Cost structure: <strong>${fixedPct}% Fixed</strong> (<span class="money-val">${fmtMoney(cur.fixedTotal)}</span>) vs <strong>${varPct}% Variable</strong> (<span class="money-val">${fmtMoney(cur.variableTotal)}</span>). Fixed obligations absorb <strong>${fixedIncomeCov}%</strong> of this month's income.`);
      if (cur.pettyItems.length) {
        narrative.push(`Petty spending (≤ ${fmtMoney(cur.pettyMax)}): <strong>${cur.pettyItems.length} small transactions</strong> added up to <strong class="money-val">${fmtMoney(cur.pettyTotal)}</strong> (${cur.totalExpense > 0 ? Math.round((cur.pettyTotal / cur.totalExpense) * 100) : 0}% of total spend).`);
      }
      if (cur.specialItems.length) {
        narrative.push(`Special / one-off outlays: <strong>${cur.specialItems.length} item(s)</strong> totaling <strong class="money-val">${fmtMoney(cur.specialTotal)}</strong>. Excluding special spikes, baseline monthly burn was <strong class="money-val">${fmtMoney(cur.normalizedExpense)}</strong>.`);
      }
      if (avg3Exp > 0) {
        const vsAvg = Math.round(((cur.totalExpense - avg3Exp) / avg3Exp) * 100);
        narrative.push(`Spend trend vs prior 3-month average (<span class="money-val">${fmtMoney(avg3Exp)}</span>): <strong>${vsAvg >= 0 ? "+" + vsAvg : vsAvg}%</strong>.`);
      }
    }

    // Filterable itemized list for selected month
    const filteredItems = cur.enriched.filter((e) => {
      if (monthlyTierFilter === "fixed") return e.nature === "fixed";
      if (monthlyTierFilter === "variable") return e.nature === "variable";
      if (monthlyTierFilter === "petty") return e.sizeTier === "petty";
      if (monthlyTierFilter === "regular") return e.sizeTier === "regular";
      if (monthlyTierFilter === "big") return e.sizeTier === "big";
      if (monthlyTierFilter === "special") return e.isSpecial;
      return true;
    }).sort((a, b) => b.amt - a.amt);

    root.innerHTML = `
      <div class="month-nav-bar">
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="mi-prev-month">&larr; Prev</button>
          <select id="mi-month-select" class="select-compact" style="font-weight:700;">
            ${availableMonths.map((mk) => `<option value="${mk}" ${mk === selectedMonthKey ? "selected" : ""}>${esc(formatMonthLabel(mk))}</option>`).join("")}
          </select>
          <button class="btn btn-secondary btn-sm" id="mi-next-month">Next &rarr;</button>
        </div>
        <div class="threshold-inline text-xs">
          <span class="muted">Petty ≤</span>
          <input id="mi-petty-max" type="number" min="10" step="50" value="${cur.pettyMax}" />
          <span class="muted">Big ≥</span>
          <input id="mi-big-min" type="number" min="100" step="250" value="${cur.bigMin}" />
          <button class="btn btn-secondary btn-xs" id="mi-apply-thresholds">Apply</button>
        </div>
      </div>

      <div class="narrative-box">
        <div class="flex-between">
          <strong class="text-sm">Executive Summary — ${esc(cur.label)}</strong>
          <span class="tag-chip">${cur.incomes.length} credits &bull; ${cur.expenses.length} debits</span>
        </div>
        ${narrative.map((line) => `<div class="text-sm">${line}</div>`).join("")}
      </div>

      <!-- KPI Summary -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">Monthly Income</span>
          <div class="kpi-val money-val amount-income">${fmtMoney(cur.totalIncome)}</div>
          <div class="kpi-foot">
            ${incDelta !== null ? `<span class="delta-pill ${incDelta >= 0 ? "delta-up" : "delta-down"}">${incDelta >= 0 ? "+" : ""}${incDelta}% vs prev</span>` : `<span class="delta-pill delta-neutral">${cur.incomes.length} inflows</span>`}
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Monthly Expenses</span>
          <div class="kpi-val money-val">${fmtMoney(cur.totalExpense)}</div>
          <div class="kpi-foot">
            ${expDelta !== null ? `<span class="delta-pill ${expDelta <= 0 ? "delta-up" : "delta-down"}">${expDelta >= 0 ? "+" : ""}${expDelta}% vs prev</span>` : `<span class="delta-pill delta-neutral">${cur.expenses.length} outflows</span>`}
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Net Cash Flow</span>
          <div class="kpi-val money-val" style="color:${cur.net >= 0 ? "var(--emerald)" : "var(--rose)"};">${fmtMoney(cur.net, null, true)}</div>
          <div class="kpi-foot"><span class="delta-pill ${cur.savingsRate >= 20 ? "delta-up" : "delta-neutral"}">${cur.savingsRate}% savings rate</span></div>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Baseline Burn (Excl. Special)</span>
          <div class="kpi-val money-val">${fmtMoney(cur.normalizedExpense)}</div>
          <div class="kpi-foot"><span class="delta-pill delta-neutral">${cur.specialItems.length} special spike(s) excluded</span></div>
        </div>
      </div>

      <!-- Fixed vs Variable Cost Bifurcation -->
      <div class="card mb-4">
        <div class="card-header">
          <div>
            <h3 class="card-title">Fixed vs. Variable Cost Bifurcation (${esc(cur.label)})</h3>
            <p class="card-subtitle">Predictable obligations (EMIs, SIPs, Bills, Subscriptions, Recurring) vs. discretionary spending</p>
          </div>
          <span class="badge cost-pill-fixed">${fixedPct}% Fixed &bull; ${varPct}% Variable</span>
        </div>
        <div class="split-meter">
          <div class="split-seg" style="width:${fixedPct}%;background:var(--primary);" title="Fixed: ${fmtMoney(cur.fixedTotal)}"></div>
          <div class="split-seg" style="width:${varPct}%;background:var(--amber);" title="Variable: ${fmtMoney(cur.variableTotal)}"></div>
        </div>
        <div class="grid-2 mt-3">
          <div style="padding:14px;border:1px solid var(--border);border-radius:12px;">
            <div class="flex-between mb-2">
              <strong>Fixed Costs (${cur.fixedItems.length} entries)</strong>
              <strong class="money-val" style="color:var(--primary);">${fmtMoney(cur.fixedTotal)}</strong>
            </div>
            <div class="text-xs muted mb-3">${fixedPct}% of expenses &bull; ${fixedIncomeCov}% of income</div>
            ${fixedCats.length ? fixedCats.map((c) => `
              <div class="flex-between text-sm" style="padding:4px 0;">
                <span>${c.cat.icon} ${esc(c.cat.name)}</span>
                <span class="money-val"><strong>${fmtMoney(c.val)}</strong> <span class="text-xs muted">(${cur.fixedTotal ? Math.round((c.val / cur.fixedTotal) * 100) : 0}%)</span></span>
              </div>`).join("") : `<p class="muted text-xs">No fixed costs detected for this month.</p>`}
          </div>
          <div style="padding:14px;border:1px solid var(--border);border-radius:12px;">
            <div class="flex-between mb-2">
              <strong>Variable Costs (${cur.variableItems.length} entries)</strong>
              <strong class="money-val" style="color:var(--amber);">${fmtMoney(cur.variableTotal)}</strong>
            </div>
            <div class="text-xs muted mb-3">${varPct}% of expenses &bull; Discretionary &amp; day-to-day</div>
            ${varCats.length ? varCats.slice(0, 8).map((c) => `
              <div class="flex-between text-sm" style="padding:4px 0;">
                <span>${c.cat.icon} ${esc(c.cat.name)}</span>
                <span class="money-val"><strong>${fmtMoney(c.val)}</strong> <span class="text-xs muted">(${cur.variableTotal ? Math.round((c.val / cur.variableTotal) * 100) : 0}%)</span></span>
              </div>`).join("") : `<p class="muted text-xs">No variable costs detected for this month.</p>`}
          </div>
        </div>
      </div>

      <!-- Petty, Regular, Big & Special Expense Tiers -->
      <div class="kpi-grid mb-4">
        <div class="kpi-card">
          <div class="kpi-top"><span class="kpi-label">Petty Expenses (≤ ${fmtMoney(cur.pettyMax)})</span><span class="badge tier-petty">${cur.pettyItems.length}</span></div>
          <div class="kpi-val money-val">${fmtMoney(cur.pettyTotal)}</div>
          <div class="kpi-foot"><span>${cur.totalExpense ? Math.round((cur.pettyTotal / cur.totalExpense) * 100) : 0}% of spend &bull; Avg ${fmtMoney(cur.pettyItems.length ? cur.pettyTotal / cur.pettyItems.length : 0)}</span></div>
          ${topPetty.length ? `<div class="text-xs muted mt-2">Top: ${topPetty.map(([n, v]) => `${esc(n)} (${v.count}x)`).join(", ")}</div>` : ""}
        </div>
        <div class="kpi-card">
          <div class="kpi-top"><span class="kpi-label">Regular (${fmtMoney(cur.pettyMax + 1)}–${fmtMoney(cur.bigMin - 1)})</span><span class="badge tier-regular">${cur.regularItems.length}</span></div>
          <div class="kpi-val money-val">${fmtMoney(cur.regularTotal)}</div>
          <div class="kpi-foot"><span>${cur.totalExpense ? Math.round((cur.regularTotal / cur.totalExpense) * 100) : 0}% of spend &bull; Mid-size routine</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top"><span class="kpi-label">Big Expenses (≥ ${fmtMoney(cur.bigMin)})</span><span class="badge tier-big">${cur.bigItems.length}</span></div>
          <div class="kpi-val money-val">${fmtMoney(cur.bigTotal)}</div>
          <div class="kpi-foot"><span>${cur.totalExpense ? Math.round((cur.bigTotal / cur.totalExpense) * 100) : 0}% of spend &bull; High-ticket outlays</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top"><span class="kpi-label">Special / One-Off Spikes</span><span class="badge tier-special">${cur.specialItems.length}</span></div>
          <div class="kpi-val money-val" style="color:var(--rose);">${fmtMoney(cur.specialTotal)}</div>
          <div class="kpi-foot"><span>${cur.totalExpense ? Math.round((cur.specialTotal / cur.totalExpense) * 100) : 0}% of spend &bull; Outliers &amp; tagged</span></div>
        </div>
      </div>

      <!-- Trend Analysis -->
      <div class="grid-2 mb-4">
        <div class="card">
          <div class="card-header">
            <div><h3 class="card-title">6-Month Trend Analysis</h3><p class="card-subtitle">Income, Fixed Cost, and Variable Cost trajectory up to ${esc(cur.label)}</p></div>
          </div>
          <div id="mi-trend-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div><h3 class="card-title">Same-Month Cumulative Spend Pace</h3><p class="card-subtitle">Daily cumulative outflow vs. ${esc(prev.label)}</p></div>
          </div>
          <div id="mi-daily-curve"></div>
        </div>
      </div>

      <!-- Weekly & Category MoM Trends -->
      <div class="grid-2 mb-4">
        <div class="card">
          <div class="card-header"><div><h3 class="card-title">Weekly Burn Breakdown (${esc(cur.label)})</h3><p class="card-subtitle">Fixed, Variable, Petty &amp; Big per week</p></div></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Week</th><th class="text-right">Fixed</th><th class="text-right">Variable</th><th class="text-right">Petty</th><th class="text-right">Big</th><th class="text-right">Total</th></tr></thead>
              <tbody>
                ${weeks.map((w) => `
                  <tr>
                    <td><strong>${w.label}</strong> <span class="text-xs muted">(${w.count})</span></td>
                    <td class="text-right money-val">${fmtMoney(w.fixed)}</td>
                    <td class="text-right money-val">${fmtMoney(w.variable)}</td>
                    <td class="text-right money-val">${fmtMoney(w.petty)}</td>
                    <td class="text-right money-val">${fmtMoney(w.big)}</td>
                    <td class="text-right money-val"><strong>${fmtMoney(w.total)}</strong></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div><h3 class="card-title">Category Month-over-Month Trend</h3><p class="card-subtitle">${esc(cur.label)} vs. ${esc(prev.label)}</p></div></div>
          <div class="table-wrap" style="max-height:260px;">
            <table class="data-table">
              <thead><tr><th>Category</th><th class="text-right">This Month</th><th class="text-right">Prev Month</th><th class="text-right">Trend</th></tr></thead>
              <tbody>
                ${catTrendRows.length ? catTrendRows.map((r) => `
                  <tr>
                    <td>${r.cat.icon} <strong>${esc(r.cat.name)}</strong></td>
                    <td class="text-right money-val">${fmtMoney(r.cVal)}</td>
                    <td class="text-right money-val muted">${fmtMoney(r.pVal)}</td>
                    <td class="text-right">${r.dPct === null ? `<span class="delta-pill delta-neutral">New</span>` : `<span class="delta-pill ${r.dPct <= 0 ? "delta-up" : "delta-down"}">${r.dPct >= 0 ? "+" : ""}${r.dPct}%</span>`}</td>
                  </tr>`).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:24px;">No expenses in ${esc(cur.label)}.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Interactive Itemized Breakdown -->
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
          <div>
            <h3 class="card-title">Itemized Expense Bifurcation (${esc(cur.label)})</h3>
            <p class="card-subtitle">Click Fixed/Variable or ★ Special on any row to fine-tune classification</p>
          </div>
          <div class="tier-tabs">
            <button class="tier-tab ${monthlyTierFilter === "all" ? "active" : ""}" data-tier="all">All (${cur.enriched.length})</button>
            <button class="tier-tab ${monthlyTierFilter === "fixed" ? "active" : ""}" data-tier="fixed">Fixed (${cur.fixedItems.length})</button>
            <button class="tier-tab ${monthlyTierFilter === "variable" ? "active" : ""}" data-tier="variable">Variable (${cur.variableItems.length})</button>
            <button class="tier-tab ${monthlyTierFilter === "petty" ? "active" : ""}" data-tier="petty">Petty (${cur.pettyItems.length})</button>
            <button class="tier-tab ${monthlyTierFilter === "regular" ? "active" : ""}" data-tier="regular">Regular (${cur.regularItems.length})</button>
            <button class="tier-tab ${monthlyTierFilter === "big" ? "active" : ""}" data-tier="big">Big (${cur.bigItems.length})</button>
            <button class="tier-tab ${monthlyTierFilter === "special" ? "active" : ""}" data-tier="special">★ Special (${cur.specialItems.length})</button>
          </div>
        </div>
        <div class="table-wrap" style="max-height:420px;">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Cost Type</th><th>Size / Special</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
              ${filteredItems.length ? filteredItems.slice(0, 150).map((e) => {
                const cat = getCat(e.tx.category);
                const tierLabel = e.sizeTier === "petty" ? "Petty" : e.sizeTier === "big" ? "Big" : "Regular";
                return `
                  <tr>
                    <td class="text-sm muted">${fmtShortDate(e.tx.date)}</td>
                    <td><strong>${esc(e.tx.payee)}</strong><div class="text-xs muted">${esc(e.tx.method || "")}</div></td>
                    <td>${cat.icon} ${esc(cat.name)}</td>
                    <td>
                      <button class="btn btn-xs ${e.nature === "fixed" ? "cost-pill-fixed" : "cost-pill-variable"}" data-toggle-nature="${e.tx.id}" title="Click to switch Fixed / Variable">
                        ${e.nature === "fixed" ? "Fixed" : "Variable"}
                      </button>
                    </td>
                    <td>
                      <span class="badge tier-${e.sizeTier}">${tierLabel}</span>
                      <button class="btn btn-xs ${e.isSpecial ? "tier-special" : "btn-ghost"}" data-toggle-special="${e.tx.id}" data-cur-special="${e.isSpecial ? "1" : "0"}" title="Toggle Special / One-off">
                        ${e.isSpecial ? "★ Special" : "☆"}
                      </button>
                    </td>
                    <td class="text-right money-val"><strong>${fmtMoney(e.amt)}</strong></td>
                  </tr>`;
              }).join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:30px;">No entries match this filter in ${esc(cur.label)}.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderMonthlyTrendChart("mi-trend-chart", selectedMonthKey, recSet);
    renderDailyCumulativeCurve("mi-daily-curve", cur, prev);

    document.getElementById("mi-month-select").onchange = (e) => {
      selectedMonthKey = e.target.value;
      renderMonthlyIntelligenceView(root);
    };
    document.getElementById("mi-prev-month").onclick = () => {
      const idx = availableMonths.indexOf(selectedMonthKey);
      if (idx >= 0 && idx + 1 < availableMonths.length) {
        selectedMonthKey = availableMonths[idx + 1];
        renderMonthlyIntelligenceView(root);
      }
    };
    document.getElementById("mi-next-month").onclick = () => {
      const idx = availableMonths.indexOf(selectedMonthKey);
      if (idx > 0) {
        selectedMonthKey = availableMonths[idx - 1];
        renderMonthlyIntelligenceView(root);
      }
    };
    document.getElementById("mi-apply-thresholds").onclick = () => {
      state.settings.pettyExpenseMax = Math.max(1, Number(document.getElementById("mi-petty-max").value) || 200);
      state.settings.bigExpenseMin = Math.max(10, Number(document.getElementById("mi-big-min").value) || 2500);
      saveState();
      renderMonthlyIntelligenceView(root);
      toast("Thresholds updated.");
    };
    root.querySelectorAll("[data-tier]").forEach((btn) => {
      btn.onclick = () => {
        monthlyTierFilter = btn.dataset.tier;
        renderMonthlyIntelligenceView(root);
      };
    });
    root.querySelectorAll("[data-toggle-nature]").forEach((btn) => {
      btn.onclick = () => {
        const tx = state.transactions.find((t) => t.id === btn.dataset.toggleNature);
        if (!tx) return;
        const curN = resolveCostNature(tx, recSet);
        tx.costNature = curN === "fixed" ? "variable" : "fixed";
        saveState();
        renderMonthlyIntelligenceView(root);
      };
    });
    root.querySelectorAll("[data-toggle-special]").forEach((btn) => {
      btn.onclick = () => {
        const tx = state.transactions.find((t) => t.id === btn.dataset.toggleSpecial);
        if (!tx) return;
        tx.isSpecial = btn.dataset.curSpecial !== "1";
        saveState();
        renderMonthlyIntelligenceView(root);
      };
    });
  }

  /* ---------- Smart Bank Statement Importer (Excel & CSV) & Exporter ---------- */
  function parseCSVText(text) {
    const rows = [];
    let row = [], cur = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(cur.trim()); cur = ""; }
        else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && text[i + 1] === "\n") i++;
          row.push(cur.trim());
          if (row.some((cell) => cell !== "")) rows.push(row);
          row = []; cur = "";
        } else cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur.trim()); if (row.some((c) => c !== "")) rows.push(row); }
    return rows;
  }

  function unwrapBankText(raw) {
    return String(raw || "")
      .replace(/\r?\n /g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractBankMeta(rows) {
    const meta = { summaries: [] };
    const detectBankFromText = (txt) => {
      if (/indian\s*bank|\bidib0/i.test(txt)) return "Indian Bank";
      if (/state bank of india|\bsbin0/i.test(txt)) return "State Bank of India";
      if (/punjab national bank|\bpnb\b|\bpunb0/i.test(txt)) return "Punjab National Bank (PNB)";
      if (/hdfc bank|\bhdfc0/i.test(txt)) return "HDFC Bank";
      if (/icici bank|\bicic0/i.test(txt)) return "ICICI Bank";
      if (/axis bank|\butib0/i.test(txt)) return "Axis Bank";
      if (/kotak mahindra|\bkkbk0/i.test(txt)) return "Kotak Mahindra Bank";
      if (/bank of baroda|\bbarb0/i.test(txt)) return "Bank of Baroda";
      if (/canara bank|\bcnrb0/i.test(txt)) return "Canara Bank";
      return "";
    };
    const headerScanEnd = Math.min(rows.length, 30);
    for (let i = 0; i < headerScanEnd && !meta.bank; i++) {
      meta.bank = detectBankFromText((rows[i] || []).filter(Boolean).join(" | "));
    }
    let sawClosingBal = false;
    let lastClosingBal = null;
    for (let i = 0; i < rows.length; i++) {
      const joined = (rows[i] || []).filter(Boolean).join(" | ");
      if (!meta.bank && i >= headerScanEnd && i < 120) {
        meta.bank = detectBankFromText(joined);
      }
      if (!meta.accountNumber) {
        const accM = joined.match(/Account\s*(?:Statement\s*For\s*Account|Number|No\.?)\s*[:\-]\s*\|?\s*([X*\d]{4,})/i);
        if (accM) meta.accountNumber = accM[1].trim();
      }
      if (!meta.period) {
        const perM = joined.match(/Statement\s*(?:From|Period)\s*[:\-]?\s*\|?\s*([^\n]+?)(?:\s*\|\s*Nominee|\s*$)/i);
        if (perM) {
          let cleanPer = perM[1].replace(/\|/g, " ").replace(/\s+/g, " ").trim();
          if (i + 1 < rows.length) {
            const nextJ = (rows[i + 1] || []).filter(Boolean).join(" | ");
            const toM = nextJ.match(/\bTo\s*[:\-]\s*\|?\s*(\d{1,2}[\-\/\s][A-Za-z0-9]+[\-\/\s]\d{2,4})/i);
            if (toM && !cleanPer.toLowerCase().includes("to ")) cleanPer += " to " + toM[1].trim();
          }
          if (/\d/.test(cleanPer)) meta.period = cleanPer;
        }
      }
      if (!meta.balance) {
        const balM = joined.match(/Clear(?:ed)?\s*Balance\s*[:\-]\s*\|?\s*([^\n|]+)/i);
        if (balM) meta.balance = balM[1].trim();
      }
      const closeM = joined.match(/CLOSING\s+BALANCE\s*[:\-]\s*\|?\s*([^\n|]+)/i);
      if (closeM) {
        sawClosingBal = true;
        lastClosingBal = parseAmountNumber(closeM[1]);
      }
      // SBI / standard "Brought Forward | Dr Count | Cr Count | Total Debits | Total Credits | Closing" summary
      if (/Brought Forward/i.test(joined) && /Dr\s*Count/i.test(joined) && i + 1 < rows.length) {
        const rawVals = (rows[i + 1] || []).map((c) => String(c || "").trim()).filter(Boolean);
        const vals = rawVals.length >= 6 ? rawVals : rawVals.join(" ").split(/\s+/).filter(Boolean);
        if (vals.length >= 6) {
          const bf = parseAmountNumber(vals[0]);
          const drCount = parseInt(String(vals[1] || "").replace(/\D/g, ""), 10) || 0;
          const crCount = parseInt(String(vals[2] || "").replace(/\D/g, ""), 10) || 0;
          const totalDebits = parseAmountNumber(vals[3]);
          const totalCredits = parseAmountNumber(vals[4]);
          const closingBal = parseAmountNumber(vals[5]);
          if (drCount > 0 || crCount > 0 || totalDebits > 0 || totalCredits > 0) {
            meta.summaries.push({ bf, drCount, crCount, totalDebits, totalCredits, closingBal });
          }
        }
      } else if (/Brought Forward/i.test(joined) && meta.openingBalance === undefined) {
        const vals = (rows[i] || []).map((c) => String(c || "").trim()).filter(Boolean);
        const balToken = vals.find((v) => /[\d,]+\.\d{1,2}/.test(v));
        if (balToken) meta.openingBalance = parseAmountNumber(balToken);
      }
      // Indian Bank final grand summary: "Dr. Count: | 109 | Cr. Count: | 2556 | 930949.42 | 953124.50" after CLOSING BALANCE
      if (sawClosingBal && /Dr\.?\s*Count\s*:/i.test(joined) && /Cr\.?\s*Count\s*:/i.test(joined)) {
        const drM = joined.match(/Dr\.?\s*Count\s*:\s*\|?\s*(\d+)/i);
        const crM = joined.match(/Cr\.?\s*Count\s*:\s*\|?\s*(\d+)/i);
        const nums = (rows[i] || []).map((c) => String(c || "").trim()).filter((v) => /^\s*-?[\d,]+\.\d{2}\s*$/.test(v));
        if (drM && crM && nums.length >= 2) {
          meta.summaries = [{
            bf: meta.openingBalance !== undefined ? meta.openingBalance : null,
            drCount: parseInt(drM[1], 10) || 0,
            crCount: parseInt(crM[1], 10) || 0,
            totalDebits: Math.abs(parseAmountNumber(nums[nums.length - 2])),
            totalCredits: Math.abs(parseAmountNumber(nums[nums.length - 1])),
            closingBal: lastClosingBal
          }];
          sawClosingBal = false;
        }
      }
    }
    return meta;
  }

  function isStatementHeaderRow(row) {
    const cells = (row || []).map((c) => String(c || "").toLowerCase().trim());
    if (cells.filter(Boolean).length < 3) return false;
    const joined = cells.join(" ");
    if (/^(page no|account statement for account|statement period|branch details|customer details)/i.test(joined)) return false;
    const hasDate = cells.some((c) => /\b(date|dt|txndt|trandt|valdt)\b/.test(c));
    const hasDesc = cells.some((c) => /(details|particulars|particular|description|narration|remarks|remark|payee|memo)/.test(c));
    const hasAmt = cells.some((c) => /(debit|withdrawal|credit|deposit|amount|\bamt\b|\bdr\b|\bcr\b)/.test(c));
    return hasDate && hasDesc && hasAmt;
  }

  function detectHeaderRowIndex(rows) {
    let bestIdx = 0, bestScore = -1;
    const scanMax = Math.min(rows.length, 65);
    for (let i = 0; i < scanMax; i++) {
      const cells = rows[i].map((c) => String(c || "").toLowerCase().trim());
      if (cells.filter(Boolean).length < 3) continue;
      let score = 0;
      if (cells.some((c) => /\b(date|dt|txndt|trandt|valdt)\b/.test(c))) score += 3;
      if (cells.some((c) => /(details|particulars|particular|description|narration|remarks|remark|payee|memo)/.test(c))) score += 3;
      if (cells.some((c) => /(debit|withdrawal|\bdr\b)/.test(c))) score += 2;
      if (cells.some((c) => /(credit|deposit|\bcr\b)/.test(c))) score += 2;
      if (cells.some((c) => /\b(amount|amt|balance)\b/.test(c))) score += 2;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestScore >= 4 ? bestIdx : -1;
  }

  function pickCleanPartyFromSegments(segments) {
    const noiseRe = /^(p2a|p2p|p2m|mmt|imps|neft|rtgs|upi|in|out|dr|cr|ib|mb|rib|mob|tfr|wdl|dep|transfer|by transfer|to transfer|payment|remit|ok|na|xx+|0+)$/i;
    const ifscRe = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
    const bankShortRe = /^(hdfc|sbin|icic|utib|punb|kkbk|yesb|barb|cnrb|idfb|indb|fdrl|ratn|paytm|airp|ipos|ppiw|pytm|sbi|pnb|icici|axis|kotak|bob)$/i;
    let best = "";
    for (const rawSeg of segments || []) {
      const seg = String(rawSeg || "")
        .replace(/\s+\d{8,}\s+AT\s+\d+.*$/i, "")
        .replace(/^(by|to)\s+transfer[\s\-:]*/i, "")
        .trim();
      if (!seg || seg.length < 2) continue;
      if (/^\d+$/.test(seg) || ifscRe.test(seg) || noiseRe.test(seg) || bankShortRe.test(seg)) continue;
      if (/^[\d\s\-\/:.]+$/.test(seg)) continue;
      if (/[a-zA-Z]{2,}/.test(seg)) {
        // Prefer human/party names with spaces or longer text over short codes
        if (!best || ((seg.includes(" ") && !best.includes(" ")) || seg.length > best.length)) {
          best = seg;
        }
      }
    }
    return best;
  }

  function cleanBankPayeeDisplay(rawPayee, rawNarration = "") {
    let p = unwrapBankText(rawPayee || "")
      .replace(/(?:^|\s)-\s+-(?:\s|$)/g, " ")
      .replace(/^(?:WDL\s+TFR|DEP\s+TFR|POS\s+ATM\s+PURCH(?:\s+OTHPG)?|CEMTEX\s+DEP|CREDIT\s+Chq|DEBIT\s+Chq)\s+/i, "")
      .replace(/\s+\d{8,}\s+AT\s+\d+.*$/i, "")
      .replace(/\s+(?:WDL|DEP)\s*TFR$/i, "")
      .replace(/\s+POS\s+ATM\s+PURCH(?:\s+OTHPG)?$/i, "")
      .trim();
    const refLead = p.match(/^(\d{10,14})\s*(?:OF\s+)?([A-Za-z].+)$/i);
    if (refLead) p = refLead[2].trim();
    p = p.replace(/\s+AT\s+\d{4,6}\b.*$/i, "").trim();

    const hay = `${p} ${rawNarration || ""}`.toLowerCase();
    const merchantRules = [
      [/\bswiggy\b/, "Swiggy"],
      [/\bzomato\b/, "Zomato"],
      [/\bblinkit\b/, "Blinkit"],
      [/\bzepto\b/, "Zepto"],
      [/\binstamart\b/, "Swiggy Instamart"],
      [/\bbigbasket\b/, "BigBasket"],
      [/\bd[\s-]?mart\b/, "DMart"],
      [/\bamazon(?:\s*pay)?\b/, "Amazon"],
      [/\bflipkart\b/, "Flipkart"],
      [/\bmyntra\b/, "Myntra"],
      [/\bajio\b/, "Ajio"],
      [/\bnykaa\b/, "Nykaa"],
      [/\bmeesho\b/, "Meesho"],
      [/\bjio\s*plat|\bjiohotstar\b|\breliance\s*jio\b/, (h) => /hotstar/.test(h) ? "JioHotstar" : "Jio"],
      [/\bairtel\b/, "Airtel"],
      [/\birctc\b/, "IRCTC"],
      [/\buber\b/, "Uber"],
      [/\bola\b/, "Ola"],
      [/\brapido\b/, "Rapido"],
      [/\bredbus\b/, "RedBus"],
      [/\beasytripplanner\b/, "EaseMyTrip"],
      [/\bmakemytrip\b/, "MakeMyTrip"],
      [/\bagoda\b/, "Agoda"],
      [/\bbookmyshow\b/, "BookMyShow"],
      [/\bone97\b|\bpaytm\b/, "Paytm"],
      [/\bgoogle\s*i\b|\bgoog-payme/, "Google Pay"],
      [/\bcpbgnloyalitysbie\b|\bsbiepay\b/, "SBIePay"],
      [/\bgroww\b/, "Groww"],
      [/\bupstox\b/, "Upstox"],
      [/\bzerodha\b/, "Zerodha"],
      [/\bnetflix\b/, "Netflix"],
      [/\bspotify\b/, "Spotify"],
      [/\byoutube\b/, "YouTube"],
      [/\bopenai\b|\bchatgpt\b/, "OpenAI / ChatGPT"]
    ];
    for (const [re, label] of merchantRules) {
      if (re.test(p.toLowerCase())) {
        return typeof label === "function" ? label(hay) : label;
      }
    }
    if (p.length > 48) p = p.slice(0, 48).trim();
    return p;
  }

  function parseBankNarration(rawDetails, isCredit) {
    const clean = unwrapBankText(rawDetails)
      .replace(/(?:^|\s)-\s+-(?:\s|$)/g, " ")
      .replace(/\s*\/?\s*BRANCH\s*:\s*(?:ATM\s+)?SERVICE\s+BRANCH(?:\s*\([^)]*\))?.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    let payee = clean || "Bank Entry";
    let method = "Bank Transfer";
    let refNo = "";

    // 0. Indian Bank IFSC-prefixed UPI / clearing formats: "UTIB0000837/NEHA KUMARI /XXXXX37928/.../UPI/509127669817/..."
    const ifscUpiM = clean.match(/^([A-Z]{4}0[A-Z0-9]{6})\/([^\/]+)(?:\/|$)/i);
    if (ifscUpiM) {
      method = /\/UPI\//i.test(clean) ? "UPI" : "Bank Transfer";
      const refM = clean.match(/\/UPI\/(\d{8,})/i) || clean.match(/\/(\d{10,})/);
      if (refM) refNo = refM[1];
      const rawParty = ifscUpiM[2].trim();
      payee = cleanBankPayeeDisplay(rawParty, clean) || rawParty;
      return { payee, method, refNo, raw: clean };
    }

    // 0b. INW_CLG cheque clearing: "INW_CLG :ClgInwPr: PREMSONS MOTOR ,ChqNo:186292,"
    const inwM = clean.match(/^INW_CLG\s*:(?:[^:]+:)?\s*([^,]+)/i);
    if (inwM) {
      method = "Cheque";
      const chqNoM = clean.match(/ChqNo\s*:\s*(\d+)/i);
      if (chqNoM) refNo = chqNoM[1];
      payee = cleanBankPayeeDisplay(inwM[1].replace(/,?\s*\/BRANCH.*$/i, "").trim(), clean) || inwM[1].trim();
      return { payee, method, refNo, raw: clean };
    }

    // 1. UPI/DR/123456/Name/BANK/vpa/remark...
    const upiM = clean.match(/UPI\/(DR|CR|REV|DRC|REVERSAL|REF)\/(\d+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/i);
    if (upiM) {
      method = "UPI";
      refNo = upiM[2] || "";
      const kind = upiM[1].toUpperCase();
      if (kind === "REV" || kind === "DRC" || kind === "REVERSAL") {
        payee = "UPI Reversal / Refund";
      } else if (kind === "REF" && /^(cr|dr|na|nil|\d+)$/i.test((upiM[3] || "").trim())) {
        payee = "UPI Refund / Reversal";
      } else {
        payee = cleanBankPayeeDisplay((upiM[3] || "UPI Payment").trim(), clean) || (upiM[3] || "UPI Payment").trim();
      }
      return { payee, method, refNo, raw: clean };
    }

    // 1b. UPI/REV/535635857611 (without name)
    const revM = clean.match(/UPI\/(?:REV|DRC|REVERSAL)\/(\d+)/i);
    if (revM) {
      return { payee: "UPI Reversal / Refund", method: "UPI", refNo: revM[1], raw: clean };
    }

    // 2. Dash/slash UPI variants (UPI-NAME-VPA-REF or UPI/NAME/VPA, with optional SBI WDL/DEP TFR prefix)
    const upiDashM = clean.match(/^(?:(?:WDL|DEP)\s+TFR\s+)?(?:UPI|UPIAR|UPIRV)[\-\/](.+)$/i);
    if (upiDashM) {
      method = "UPI";
      const parts = upiDashM[1].split(/[\/\-]/).map((s) => s.trim()).filter(Boolean);
      const digits = parts.find((p) => /^\d{8,}$/.test(p));
      if (digits) refNo = digits;
      if (/^(rev|drc|reversal)/i.test(parts[0] || "")) {
        return { payee: "UPI Reversal / Refund", method, refNo, raw: clean };
      }
      const picked = pickCleanPartyFromSegments(parts);
      if (picked) return { payee: picked, method, refNo, raw: clean };
    }

    // 3. Payment Gateways & Credit Card Bill Payments (PNB: RAZORPAY /..., payu/..., CCPMT/...)
    const rzM = clean.match(/RAZORPAY\s*\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/i);
    if (rzM) {
      method = "Online Payment";
      refNo = rzM[2] || rzM[1] || "";
      const desc = (rzM[3] || "").trim();
      payee = desc && !/^bill payment$/i.test(desc) ? desc : "Razorpay Online Payment";
      return { payee, method, refNo, raw: clean };
    }

    const payuM = clean.match(/^payu\/([^/]+)(?:\/([^/]+))?(?:\/([^/]*))?/i);
    if (payuM) {
      method = "Online Payment";
      refNo = payuM[1] || "";
      const desc = (payuM[3] || "").trim();
      payee = desc ? desc : "PayU Online Payment";
      return { payee, method, refNo, raw: clean };
    }

    const ccM = clean.match(/^CCPMT\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?/i);
    if (ccM) {
      method = "Card Payment";
      refNo = ccM[2] || ccM[1] || "";
      const desc = (ccM[3] || "").trim();
      payee = desc && !/^bill payment$/i.test(desc) ? `CC Bill: ${desc}` : "Credit Card Bill Payment";
      return { payee, method, refNo, raw: clean };
    }

    // 4. Cheque Clearing (O/W CLEARING INST NO:040664 AMOUNT:40000)
    const chqM = clean.match(/(O\/W|I\/W)\s*CLEARING\s*(?:INST\s*NO\s*[:\-]?\s*(\d+))?/i);
    if (chqM) {
      method = "Cheque";
      refNo = chqM[2] || "";
      payee = chqM[2] ? `Cheque Clearing #${chqM[2]}` : "Cheque Clearing";
      return { payee, method, refNo, raw: clean };
    }

    // 5. NEFT / RTGS (handles NEFT*IFSC*REF*NAME, NEFT/REF/NAME, NEFT-CR-IFSC-NAME, BY TRANSFER-NEFT...)
    const neftM = clean.match(/(?:NEFT|RTGS)\*([A-Z0-9]+)\*([A-Z0-9]+)\*([^\r\n]+)/i);
    if (neftM) {
      method = "Bank Transfer";
      refNo = neftM[2] || "";
      const rawTail = neftM[3].replace(/\s+\d{8,}\s+AT\s+\d+.*$/i, "").trim();
      const segs = rawTail.split(/[\/\*]/);
      payee = pickCleanPartyFromSegments(segs) || rawTail || "NEFT Transfer";
      return { payee, method, refNo, raw: clean };
    }
    if (/\b(NEFT|RTGS)\b/i.test(clean)) {
      method = "Bank Transfer";
      const segs = clean.replace(/^.*?\b(?:NEFT|RTGS)\b[\s\/:\-\*]*/i, "").split(/[\/\*\-:|]+/);
      const refCand = segs.find((s) => /^[A-Z0-9]{8,}$/i.test(s.trim()) && /\d{5,}/.test(s));
      if (refCand) refNo = refCand.trim();
      const picked = pickCleanPartyFromSegments(segs);
      if (picked) return { payee: picked, method, refNo, raw: clean };
    }

    // 6. IMPS (handles IMPS/REF/NAME, IMPS/P2A/REF/NAME, MMT/IMPS/REF/NAME, IMPS-REF-NAME, BY TRANSFER-IMPS/...)
    if (/\bIMPS\b|MMT\/IMPS/i.test(clean)) {
      method = "Bank Transfer";
      const afterImps = clean.replace(/^.*?\bIMPS(?:[A-Z]{0,3})?\b[\s\/:\-\*]*/i, "");
      const segs = afterImps.split(/[\/\*\-:|]+/).map((s) => s.trim()).filter(Boolean);
      const refCand = segs.find((s) => /^\d{6,}$/.test(s) || /^[A-Z0-9]*\d{7,}[A-Z0-9]*$/i.test(s));
      if (refCand) refNo = refCand;
      const picked = pickCleanPartyFromSegments(segs);
      if (picked) {
        return { payee: picked, method, refNo, raw: clean };
      }
    }

    // 7. ACH / NACH / CMP MANDATE / Auto-Debit
    if (/\b(ACHDr|NACH|E\s*mandate|ACH CHARGES|CMP\s*MANDATE)\b/i.test(clean)) {
      method = "Auto-Debit";
      if (/ACH CHARGES/i.test(clean)) payee = "Bank ACH Mandate Charges";
      else if (/IDFC/i.test(clean)) payee = "IDFC First Bank EMI";
      else if (/TATA\s*CAP/i.test(clean)) payee = "Tata Capital EMI";
      else payee = clean.replace(/^(DEBIT\s+)?(ACHDr|CMP\s*MANDATE\s*DEBIT)\s+([A-Z0-9]+\s+)?/i, "").trim() || "Auto-Debit Mandate";
      const refAch = clean.match(/[A-Z]{4}\d{8,}/);
      if (refAch) refNo = refAch[0];
      return { payee, method, refNo, raw: clean };
    }

    // 8. Interest / Deposit Closure / Bank SMS & ATM Card Fees
    if (/INTEREST\s+CREDIT|[:\s]Int\.Pd\s*:/i.test(clean)) {
      return { payee: "Bank Interest Credit", method: "Bank Transfer", refNo: "", raw: clean };
    }
    if (/Closure\s+Proceeds/i.test(clean)) {
      const fdRef = clean.match(/^([A-Z0-9]{8,})\s*:/i);
      return { payee: "FD / Deposit Closure Proceeds", method: "Bank Transfer", refNo: fdRef ? fdRef[1] : "", raw: clean };
    }
    if (/SMS\s*CHRG\s*FOR/i.test(clean)) {
      return { payee: "Bank SMS Alert Charges", method: "Bank Charges", refNo: "", raw: clean };
    }
    if (/ATMCard\s*AMC|ATM\s*ANN\.?\s*CHRG/i.test(clean)) {
      return { payee: "Debit Card Annual Fee (AMC)", method: "Bank Charges", refNo: "", raw: clean };
    }

    const cleanedFallback = cleanBankPayeeDisplay(clean, clean);
    payee = cleanedFallback || (isCredit ? "Bank Credit" : "Bank Debit");
    return { payee, method, refNo, raw: clean };
  }

  function normalizePayeeKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/^(upi|neft|imps|ach|nach|pos)\b[\s\/:\-]*/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function learnFromTransaction(tx) {
    if (!tx || tx.type === "transfer" || !tx.payee) return;
    const key = normalizePayeeKey(tx.payee);
    if (!key || key.length < 2 || /^(upi reversal|bank entry|internal transfer)/.test(key)) return;
    if (!state.settings.aiMemory) state.settings.aiMemory = {};
    if ((tx.category && tx.category !== "other_exp") || tx.ledgerId) {
      state.settings.aiMemory[key] = {
        category: tx.category,
        costNature: tx.costNature || undefined,
        isSpecial: typeof tx.isSpecial === "boolean" ? tx.isSpecial : undefined,
        ledgerId: tx.ledgerId || undefined,
        payee: tx.payee.trim(),
        updatedAt: Date.now()
      };
    }
  }

  function buildHistoricalClassifierIndex() {
    const byPayee = {};
    const expenses = [];
    for (const t of state.transactions || []) {
      const k = normalizePayeeKey(t.payee);
      if (t.type === "expense") expenses.push(txBaseAmount(t));
      if (!k) continue;
      if (!byPayee[k]) {
        byPayee[k] = { cats: {}, natures: {}, months: new Set(), amounts: [] };
      }
      const entry = byPayee[k];
      if (t.category && t.category !== "other_exp") {
        entry.cats[t.category] = (entry.cats[t.category] || 0) + 1;
      }
      if (t.costNature === "fixed" || t.costNature === "variable") {
        entry.natures[t.costNature] = (entry.natures[t.costNature] || 0) + 1;
      }
      const mk = getMonthKey(t.date);
      if (mk) entry.months.add(mk);
      entry.amounts.push(txBaseAmount(t));
    }
    expenses.sort((a, b) => a - b);
    const medianExp = expenses.length ? expenses[Math.floor(expenses.length / 2)] : 500;
    const bigMin = Number(state.settings.bigExpenseMin) || 2500;
    const specialCutoff = Math.max(bigMin * 2, medianExp * 6);
    return { byPayee, medianExp, specialCutoff };
  }

  function autoClassifyBankTx(tx, rawNarration, histIdx = null) {
    applyRulesToTx(tx);
    const hasCustomMatch = (state.rules || []).some((r) => matchRule(r, tx.payee, tx.notes));
    if (hasCustomMatch) {
      tx.aiConfidence = 1.0;
      tx.aiReason = "Matched Smart Rule";
      return tx;
    }

    const mem = state.settings.aiMemory || {};
    const pKey = normalizePayeeKey(tx.payee);
    if (pKey && mem[pKey]) {
      const m = mem[pKey];
      tx.category = m.category;
      if (m.costNature) tx.costNature = m.costNature;
      if (typeof m.isSpecial === "boolean") tx.isSpecial = m.isSpecial;
      tx.aiConfidence = 0.97;
      tx.aiReason = "Learned from your past edit";
      return tx;
    }

    const idx = histIdx || buildHistoricalClassifierIndex();
    const hist = pKey ? idx.byPayee[pKey] : null;
    if (hist) {
      const bestCat = Object.entries(hist.cats).sort((a, b) => b[1] - a[1])[0];
      if (bestCat && bestCat[1] >= 1) {
        tx.category = bestCat[0];
        const bestNat = Object.entries(hist.natures).sort((a, b) => b[1] - a[1])[0];
        if (bestNat) tx.costNature = bestNat[0];
        else if (hist.months.size >= 2) {
          const avg = hist.amounts.reduce((s, v) => s + v, 0) / hist.amounts.length;
          const curA = txBaseAmount(tx);
          if (avg >= 200 && Math.abs(curA - avg) / avg <= 0.15) tx.costNature = "fixed";
        }
        tx.aiConfidence = 0.9;
        tx.aiReason = hist.months.size >= 2 ? "Recurring history (" + hist.months.size + " mos)" : "Matched prior payee";
        return tx;
      }
    }

    // Check if narration matches an existing party ledger (e.g. IMPS/NEFT matching a UPI person ledger)
    const matchedLed = findBestMatchingLedger(tx, rawNarration);
    if (matchedLed) {
      tx.ledgerId = matchedLed.id;
      if (matchedLed.protectedFromDrawings || matchedLed.isUserCreated) tx.keepSeparateLedger = true;
      const sameLedTxs = (state.transactions || []).filter((t) => t.ledgerId === matchedLed.id && t.type === tx.type && t.category && t.category !== "other_exp");
      if (sameLedTxs.length > 0) {
        const catCounts = {};
        sameLedTxs.forEach((t) => { catCounts[t.category] = (catCounts[t.category] || 0) + 1; });
        const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
        if (topCat) {
          tx.category = topCat[0];
          tx.aiConfidence = 0.91;
          tx.aiReason = `Matched party ledger (${matchedLed.name})`;
          return tx;
        }
      }
    }

    const hay = `${tx.payee} ${rawNarration || ""} ${tx.notes || ""}`.toLowerCase();
    if (tx.type === "income") {
      if (/(interest credit|int\.pd|closure proceeds|dividend|nextbillion|indian clearing|bse clearing|nse clearing|gr0ww invest|groww invest|zerodha)/.test(hay)) {
        tx.category = "investments"; tx.aiConfidence = 0.92; tx.aiReason = "Interest / investment payout";
      } else if (/(upi\/rev|cemtex|upi\/drc|refund|cashback|reversal|google i.*goog-payme)/.test(hay)) {
        tx.category = "refund"; tx.aiConfidence = 0.92; tx.aiReason = "Refund / reversal pattern";
      } else if (/(associates|salary|payroll|pvt ltd|technologies|solutions|neft|stipend)/.test(hay)) {
        tx.category = "salary"; tx.aiConfidence = 0.88; tx.aiReason = "Payroll / NEFT credit";
      } else {
        tx.category = "refund"; tx.aiConfidence = 0.55; tx.aiReason = "General credit";
      }
      return tx;
    }

    // Expenses: Fixed obligations vs Variable sectors + VPA/remark hints
    let conf = 0.9;
    let reason = "Pattern match";
    if (/(bajaj fi|bflautopay|idfc|tatacap|tata capital|nach|achdr|cmp mandate|emi\b|loan|hdfc ltd|home credit|kissht|navi fin)/.test(hay)) {
      tx.category = "emi_loan"; tx.costNature = "fixed"; reason = "Loan / EMI mandate";
    } else if (/(mutual f|groww|zerodha|sip\b|iccl|kuvera|upstox|coin by|ppf|nps)/.test(hay)) {
      tx.category = "sip_invest"; tx.costNature = "fixed"; reason = "Investment / SIP";
    } else if (/(ach charges|amc\b|atmcard|atm ann\.?\s*chrg|sms alert|sms chrg|folio chg|gst on|stamp duty|penalty)/.test(hay)) {
      tx.category = "bank_fees"; tx.costNature = "fixed"; reason = "Bank charge / fee";
    } else if (/(ccpmt|credit card|card bill)/.test(hay)) {
      tx.category = "utilities"; tx.costNature = "fixed"; reason = "Credit card bill payment";
    } else if (/(house rent|room rent|flat rent|pg rent|hostel fee|landlord|nobroker|society maint|maintenance)/.test(hay)) {
      tx.category = "housing"; tx.costNature = "fixed"; reason = "Housing / rent";
    } else if (/(gpayrechar|recharge|euronet|fibernet|broadband|electricity|electric bill|bescom|tata power|adani elec|water bill|gas bill|piped gas|indane|bharatgas|hp gas|amazonpayb|amazon pay|jio\b|airtel|bsnl|vi\b|vodafone)/.test(hay)) {
      tx.category = "utilities"; tx.costNature = "fixed"; reason = "Utility / recharge bill";
    } else if (/(hotstar|jiohotstar|netflix|spotify|youtube|apple\.com|playstore|google p|cosmofeed|creator|skillcou|astrotal|srimandir|dostt|virality|sbipmopad|bunch mi|frnd|prime video|adobe|chatgpt|openai|claude)/.test(hay)) {
      tx.category = "subscriptions"; tx.costNature = "fixed"; reason = "Subscription / digital recurring";
    } else if (/(bigbasket|blinkit|zepto|instamart|dmart|d-mart|reliance fresh|smart bazaar|more retail|kirana|ration|veg|vegetable|fruit|sudha milk|dairy|mother dairy|amul|grocer)/.test(hay)) {
      tx.category = "groceries"; tx.costNature = "variable"; reason = "Groceries / pantry";
    } else if (/(dominos|zomato|swiggy|eatndrink|chai pani|cafe|coffee|softy|bistro|restaurant|hotel|tata hotel|dhaba|bakery|sweets|haldiram|kfc|mcdonald|pizza|biryani|mess|tiffin|dinner|lunch|snacks)/.test(hay)) {
      tx.category = "food"; tx.costNature = "variable"; reason = "Food & dining";
    } else if (/(flipkart|amazon|myntra|ajio|nykaa|meesho|v mart|v2 retail|zudio|vishal|yousta|fashnear|delhiver|utkal el|saad ele|shree ba|suvidhac|gupta st|asha stor|gopal st|new mode|u style|classic|selectio|jmd-1|rajiv st|mart\b|store\b|traders|fashion|apparel|mobile|electron|croma|reliance digital)/.test(hay)) {
      tx.category = "shopping"; tx.costNature = "variable"; reason = "Retail / shopping";
    } else if (/(rapido|uber|ola|ndg moto|fuel|petrol|diesel|hpcl|bpcl|iocl|indian oil|shell|fastag|toll|metro|irctc|railway|bus|auto\b|cab\b|indigo|air india|vistara|makemytrip|goibibo|redbus)/.test(hay)) {
      tx.category = "transport"; tx.costNature = "variable"; reason = "Transport / fuel / transit";
    } else if (/(bookmyshow|bigtree|pjp cine|cinema|pvr|inox|ticket|gaming|playstation|steam)/.test(hay)) {
      tx.category = "entertainment"; tx.costNature = "variable"; reason = "Entertainment";
    } else if (/(hellohair|hello hair|medical|pharma|apollo|medplus|1mg|pharmeasy|netmeds|chemist|clinic|doctor|hospital|diagnostic|pathology|lab\b|dental|opticals|gym|fitness|cultfit)/.test(hay)) {
      tx.category = "health"; tx.costNature = "variable"; reason = "Health / medical";
    } else if (/(school|college|tuition|exam fee|coursera|udemy|book\b|stationery|xerox|print)/.test(hay)) {
      tx.category = "education"; tx.costNature = "variable"; reason = "Education & books";
    } else if (tx.method === "UPI") {
      tx.category = "personal_transfer"; tx.costNature = "variable"; conf = 0.45; reason = "Unmatched UPI payee (AI candidate)";
    } else {
      tx.category = "other_exp"; tx.costNature = "variable"; conf = 0.35; reason = "Uncategorized entry (AI candidate)";
    }

    if (typeof tx.isSpecial !== "boolean" && txBaseAmount(tx) >= idx.specialCutoff && tx.costNature !== "fixed") {
      tx.isSpecial = true;
      reason += " + High-value spike";
    }
    tx.aiConfidence = conf;
    tx.aiReason = reason;
    return tx;
  }

  async function aiNativePost(url, headers, bodyObj) {
    const bodyStr = JSON.stringify(bodyObj);
    if (window.LedgerFlowAndroid) {
      let raw;
      if (typeof window.LedgerFlowAndroid.aiHttpPostAsync === "function") {
        raw = await callAndroidAsync("aiHttpPostAsync", [url, JSON.stringify(headers || {}), bodyStr]);
      } else if (typeof window.LedgerFlowAndroid.aiHttpPost === "function") {
        raw = window.LedgerFlowAndroid.aiHttpPost(url, JSON.stringify(headers || {}), bodyStr);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed.ok) throw new Error(parsed.error || ("HTTP " + parsed.status));
        return JSON.parse(parsed.body || "{}");
      }
    }
    if (isDesktopHost) {
      const proxyRes = await apiFetch("/api/ai-http", {
        method: "POST",
        body: JSON.stringify({ url, headers: headers || {}, body: bodyStr })
      });
      if (!proxyRes.ok) throw new Error(proxyRes.error || ("HTTP " + proxyRes.status));
      return JSON.parse(proxyRes.body || "{}");
    }
    const resp = await fetch(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: bodyStr });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()));
    return resp.json();
  }

  function extractJsonArrayFromLlmText(text) {
    const cleaned = String(text || "").replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const startObj = cleaned.indexOf("{");
    const startArr = cleaned.indexOf("[");
    if (startArr >= 0 && (startObj < 0 || startArr < startObj)) {
      const endArr = cleaned.lastIndexOf("]");
      if (endArr > startArr) return JSON.parse(cleaned.slice(startArr, endArr + 1));
    }
    if (startObj >= 0) {
      const endObj = cleaned.lastIndexOf("}");
      if (endObj > startObj) {
        const obj = JSON.parse(cleaned.slice(startObj, endObj + 1));
        if (Array.isArray(obj)) return obj;
        if (Array.isArray(obj.items)) return obj.items;
        if (Array.isArray(obj.results)) return obj.results;
        if (Array.isArray(obj.transactions)) return obj.transactions;
      }
    }
    return JSON.parse(cleaned);
  }

  let resolvedGeminiModelCache = "";

  async function discoverGeminiFlashModels(base, key) {
    try {
      const resp = await fetch(`${base}/models?key=${encodeURIComponent(key)}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      const list = (data && Array.isArray(data.models) ? data.models : [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => String(m.name || "").replace(/^models\//i, ""))
        .filter((n) => /^gemini-/i.test(n) && !/embedding|vision|aqa|tts|image|robotics/i.test(n));
      list.sort((a, b) => {
        const aFlash = /flash/i.test(a) ? 0 : 1;
        const bFlash = /flash/i.test(b) ? 0 : 1;
        return aFlash !== bFlash ? aFlash - bFlash : b.localeCompare(a);
      });
      return list.slice(0, 6);
    } catch (_) {
      return [];
    }
  }

  async function callGeminiWithFallback(bodyObj, aiCfg) {
    const key = String(aiCfg?.apiKey || "").trim();
    if (!key) throw new Error("Gemini API key is missing. Add a free key from aistudio.google.com/apikey in Settings.");
    const base = (aiCfg?.endpoint || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const rawPrimary = String(aiCfg?.model || "").trim().replace(/^models\//i, "");
    const retiredRe = /^gemini-(1\.0|1\.5|2\.0)-/i;
    const primary = (rawPrimary && !retiredRe.test(rawPrimary)) ? rawPrimary : (resolvedGeminiModelCache || "gemini-3.8-flash");
    const queue = [primary, "gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
      .filter((m, idx, arr) => m && arr.indexOf(m) === idx);
    const tried = new Set();
    let discoveredTried = false;
    let lastErr = null;

    while (queue.length > 0) {
      const model = queue.shift();
      if (!model || tried.has(model)) continue;
      tried.add(model);
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      try {
        const json = await aiNativePost(url, {}, bodyObj);
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        resolvedGeminiModelCache = model;
        if (rawPrimary && retiredRe.test(rawPrimary) && state?.settings?.aiConfig) {
          state.settings.aiConfig.model = model;
          saveState();
        }
        return { text, model };
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || "");
        if (!/HTTP\s+(429|404|503)\b/i.test(msg)) throw err;
        const sugM = msg.match(/use\s+(?:models\/)?(gemini-[A-Za-z0-9._-]+)/i);
        if (sugM && sugM[1] && !tried.has(sugM[1])) {
          queue.unshift(sugM[1]);
        } else if (queue.length === 0 && !discoveredTried) {
          discoveredTried = true;
          const liveModels = await discoverGeminiFlashModels(base, key);
          for (const lm of liveModels) {
            if (!tried.has(lm)) queue.push(lm);
          }
        }
      }
    }
    throw lastErr || new Error("Gemini request failed.");
  }

  async function classifyBatchWithLLM(txBatch, aiCfg) {
    const catList = (state.categories || [])
      .filter((c) => c.id !== "transfer")
      .map((c) => `${c.id} (${c.type}: ${c.name})`)
      .join(", ");
    const payloadRows = txBatch.map((t, i) => ({
      idx: i,
      date: String(t.date || "").slice(0, 10),
      type: t.type,
      amount: t.amount,
      currency: t.currency || state.settings.currency,
      payee: t.payee,
      narration: String(t.notes || "").slice(0, 140)
    }));

    const sysPrompt =
      "You are LedgerFlow's financial transaction intelligence classifier. " +
      "Analyze each bank transaction narration and output a JSON array matching the input idx values.\n" +
      "Valid category IDs: " + catList + "\n" +
      "Rules:\n" +
      "- For each item return: {\"idx\": number, \"category\": string, \"costNature\": \"fixed\"|\"variable\", \"isSpecial\": boolean, \"cleanPayee\": string, \"ledgerType\": \"drawings\"|\"person\"|\"none\", \"personName\": string, \"reason\": string}.\n" +
      "- costNature=\"fixed\" for rent, EMIs, loans, SIPs, utilities, internet, insurance, subscriptions; \"variable\" for groceries, dining, shopping, fuel, one-offs, personal transfers.\n" +
      "- ledgerType=\"drawings\" for ATM cash withdrawals, self transfers, or personal drawings; \"person\" (with clean personName) for named individuals/parties/clients; \"none\" for regular shops/bills.\n" +
      "- isSpecial=true only for rare/one-off/large discretionary spikes (medical emergency, travel booking, appliance/electronics, wedding, repair), given bigExpenseMin=" + (state.settings.bigExpenseMin || 2500) + ".\n" +
      (aiCfg.customPrompt ? "- USER CUSTOM RULES (highest priority): " + aiCfg.customPrompt + "\n" : "") +
      "Return ONLY valid JSON array (no markdown outside JSON).";

    const userPrompt = JSON.stringify(payloadRows);
    const prov = aiCfg.provider || "none";
    let textOut = "";

    if (prov === "gemini") {
      const gRes = await callGeminiWithFallback({
        systemInstruction: { parts: [{ text: sysPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      }, aiCfg);
      textOut = gRes.text;
    } else if (prov === "openai") {
      if (!aiCfg.apiKey && !aiCfg.endpoint) throw new Error("OpenAI API key is missing in Settings.");
      const model = aiCfg.model || "gpt-4o-mini";
      const url = aiCfg.endpoint || "https://api.openai.com/v1/chat/completions";
      const hdrs = aiCfg.apiKey ? { Authorization: "Bearer " + aiCfg.apiKey } : {};
      const json = await aiNativePost(url, hdrs, {
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt }
        ]
      });
      textOut = json?.choices?.[0]?.message?.content || "";
    } else if (prov === "ollama") {
      const model = aiCfg.model || "llama3.2";
      const url = aiCfg.endpoint || "http://localhost:11434/api/chat";
      const json = await aiNativePost(url, {}, {
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt }
        ]
      });
      textOut = json?.message?.content || "";
    } else {
      throw new Error("No external AI provider selected.");
    }

    const parsed = extractJsonArrayFromLlmText(textOut);
    if (!Array.isArray(parsed)) throw new Error("AI returned unexpected format.");
    return parsed;
  }

  /* ---------- Mandatory Internet Connectivity Gate ---------- */
  let isCurrentlyOnline = true;
  let netPollTimer = null;

  async function checkLiveInternetConnection() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return false;
    }
    try {
      if (window.LedgerFlowAndroid && typeof window.LedgerFlowAndroid.checkOnlineJson === "function") {
        const res = JSON.parse(window.LedgerFlowAndroid.checkOnlineJson());
        return Boolean(res && res.online);
      }
      if (isDesktopHost) {
        const res = await apiFetch("/api/net-check");
        return Boolean(res && res.online);
      }
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const tid = ctrl ? setTimeout(() => ctrl.abort(), 3500) : null;
      try {
        await fetch("https://clients3.google.com/generate_204", { mode: "no-cors", cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
        return true;
      } finally {
        if (tid) clearTimeout(tid);
      }
    } catch (_) {
      return false;
    }
  }

  async function verifyMandatoryOnlineGate(reasonMsg = "") {
    const ok = await checkLiveInternetConnection();
    isCurrentlyOnline = ok;
    const overlay = document.getElementById("net-lock-overlay");
    const statusEl = document.getElementById("net-lock-status");
    const subEl = document.getElementById("net-lock-subtitle");
    if (overlay) {
      overlay.classList.toggle("hidden", ok);
      overlay.setAttribute("aria-hidden", ok ? "true" : "false");
    }
    if (!ok) {
      if (subEl && reasonMsg) subEl.textContent = reasonMsg;
      if (statusEl) statusEl.textContent = "Offline — waiting for active internet connection…";
      if (!netPollTimer) {
        netPollTimer = setInterval(async () => {
          const recovered = await checkLiveInternetConnection();
          if (recovered) {
            clearInterval(netPollTimer);
            netPollTimer = null;
            isCurrentlyOnline = true;
            const ov = document.getElementById("net-lock-overlay");
            if (ov) { ov.classList.add("hidden"); ov.setAttribute("aria-hidden", "true"); }
            toast("Internet connection restored.");
          }
        }, 4000);
      }
    } else if (netPollTimer) {
      clearInterval(netPollTimer);
      netPollTimer = null;
    }
    return ok;
  }

  /* ---------- GitHub Release Update Checker (Desktop + Android) ---------- */
  function compareSemver(a, b) {
    const pa = String(a || "0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b || "0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length, 3);
    for (let i = 0; i < len; i++) {
      const va = pa[i] || 0;
      const vb = pb[i] || 0;
      if (va > vb) return 1;
      if (va < vb) return -1;
    }
    return 0;
  }

  function renderAppUpdateBanner() {
    const dot = document.getElementById("topbar-update-dot");
    if (dot) dot.classList.toggle("hidden", !(latestUpdateInfo && latestUpdateInfo.hasUpdate));
    const banner = document.getElementById("app-update-banner");
    if (!banner) return;
    if (!latestUpdateInfo || !latestUpdateInfo.hasUpdate || updateBannerDismissed) {
      banner.classList.add("hidden");
      return;
    }
    const titleEl = document.getElementById("app-update-title");
    const notesEl = document.getElementById("app-update-notes");
    const btnEl = document.getElementById("app-update-install-btn");
    if (titleEl) titleEl.textContent = `Update Available: LedgerFlow v${latestUpdateInfo.version}`;
    if (notesEl) notesEl.textContent = latestUpdateInfo.notes ? String(latestUpdateInfo.notes).slice(0, 140) : `Installed v${APP_VERSION} → GitHub v${latestUpdateInfo.version}`;
    if (btnEl) btnEl.textContent = "Install Update Now";
    banner.classList.remove("hidden");
  }

  async function openInteractiveUpdateModal() {
    openSubModal("Software & App Updates", `
      <div id="upd-modal-body" style="display:flex;flex-direction:column;gap:12px;">
        <div class="text-sm">Installed version: <strong>v${APP_VERSION}</strong></div>
        <div id="upd-modal-status" class="info-banner text-sm">⏳ Checking GitHub Releases (<code>${GITHUB_REPO}</code>)…</div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close="sub-modal">Close</button>
          <button type="button" class="btn btn-primary hidden" id="upd-modal-install-btn">Install Update Now</button>
        </div>
      </div>`);
    const res = await checkForAppUpdates(true);
    const stEl = document.getElementById("upd-modal-status");
    const instBtn = document.getElementById("upd-modal-install-btn");
    if (!stEl) return;
    if (!res || !res.ok) {
      stEl.textContent = res?.error || "Could not check GitHub updates. Check your internet connection.";
      return;
    }
    if (res.hasUpdate) {
      stEl.innerHTML = `<strong>New Version Available: v${esc(res.version)}</strong><div class="text-xs muted mt-1">${esc(res.notes || "Latest Windows installer & Android APK ready on GitHub.")}</div>`;
      if (instBtn) {
        instBtn.textContent = isAndroidHost ? `Download & Install v${res.version}` : `Update & Restart to v${res.version}`;
        instBtn.classList.remove("hidden");
        instBtn.onclick = async () => {
          instBtn.disabled = true;
          instBtn.textContent = "Downloading & Installing…";
          await triggerAppUpdateInstall();
          instBtn.disabled = false;
          instBtn.textContent = isAndroidHost ? `Download & Install v${res.version}` : `Update & Restart to v${res.version}`;
        };
      }
    } else {
      stEl.innerHTML = `✓ You are already on the latest version (<strong>v${APP_VERSION}</strong>).`;
    }
  }

  async function checkForAppUpdates(silent = true) {
    const ghToken = String(state?.settings?.githubToken || "").trim();
    try {
      let info = null;
      if (window.LedgerFlowAndroid) {
        if (typeof window.LedgerFlowAndroid.checkUpdateJsonAsync === "function") {
          info = JSON.parse(await callAndroidAsync("checkUpdateJsonAsync", [ghToken]));
        } else if (typeof window.LedgerFlowAndroid.checkUpdateJson === "function") {
          info = JSON.parse(window.LedgerFlowAndroid.checkUpdateJson(ghToken));
        }
      } else if (isDesktopHost) {
        const hdrs = { "X-LedgerFlow-Token": API_TOKEN };
        if (ghToken) hdrs["X-GitHub-Token"] = ghToken;
        const r = await fetch("/api/check-update", { headers: hdrs, cache: "no-store" });
        info = await r.json();
      } else {
        const hdrs = { Accept: "application/vnd.github+json" };
        if (ghToken) hdrs.Authorization = "Bearer " + ghToken;
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: hdrs, cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          const assets = Array.isArray(d.assets) ? d.assets : [];
          const win = assets.find((x) => /\.exe$/i.test(x.name || ""));
          const apk = assets.find((x) => /\.apk$/i.test(x.name || ""));
          info = {
            ok: true,
            version: String(d.tag_name || "").replace(/^v/i, ""),
            notes: d.body || "",
            windowsUrl: win ? win.browser_download_url : "",
            androidUrl: apk ? apk.browser_download_url : "",
            releaseUrl: d.html_url || `https://github.com/${GITHUB_REPO}/releases`
          };
        } else {
          info = { ok: false, status: r.status, error: r.status === 404 ? "No public release found (repo may be private or no release published yet)." : `GitHub HTTP ${r.status}` };
        }
      }
      if (!info || !info.ok) {
        if (!silent && info?.error) toast(info.error, true);
        return { ok: false, hasUpdate: false, error: info?.error || "Could not check GitHub updates." };
      }
      const remoteVer = String(info.version || "").replace(/^v/i, "").trim();
      const hasUpdate = remoteVer && compareSemver(remoteVer, APP_VERSION) > 0;
      latestUpdateInfo = {
        ok: true,
        hasUpdate: Boolean(hasUpdate),
        version: remoteVer || APP_VERSION,
        notes: info.notes || "",
        windowsUrl: info.windowsUrl || "",
        androidUrl: info.androidUrl || "",
        releaseUrl: info.releaseUrl || `https://github.com/${GITHUB_REPO}/releases`
      };
      if (hasUpdate) updateBannerDismissed = false;
      renderAppUpdateBanner();
      if (!silent) {
        toast(hasUpdate ? `Update v${remoteVer} is available on GitHub!` : `LedgerFlow v${APP_VERSION} is up to date.`);
      }
      return latestUpdateInfo;
    } catch (err) {
      if (!silent) toast("Update check failed: " + (err?.message || err), true);
      return { ok: false, hasUpdate: false, error: err?.message || String(err) };
    }
  }

  async function triggerAppUpdateInstall() {
    if (!latestUpdateInfo || !latestUpdateInfo.hasUpdate) {
      await checkForAppUpdates(false);
      return;
    }
    const ghToken = String(state?.settings?.githubToken || "").trim();
    const targetUrl = isAndroidHost
      ? (latestUpdateInfo.androidUrl || latestUpdateInfo.releaseUrl)
      : (latestUpdateInfo.windowsUrl || latestUpdateInfo.releaseUrl);
    if (!targetUrl) {
      toast("No release package URL found. Opening GitHub Releases…", true);
      return;
    }
    if (isAndroidHost && window.LedgerFlowAndroid) {
      if (typeof window.LedgerFlowAndroid.downloadAndInstallApkAsync === "function") {
        showFullUpdateOverlay({
          title: `Installing LedgerFlow v${latestUpdateInfo.version}...`,
          sub: "Downloading Android APK package from GitHub...",
          percent: 35,
          readyToRestart: false
        });
        try {
          const raw = await callAndroidAsync("downloadAndInstallApkAsync", [targetUrl, ghToken], 120000);
          const res = JSON.parse(raw || "{}");
          if (res && res.ok) {
            showFullUpdateOverlay({
              title: `Update v${latestUpdateInfo.version} Downloaded`,
              sub: "Confirm Android's install prompt, then tap below if needed to reopen or check update.",
              percent: 100,
              readyToRestart: true,
              onRestart: () => { hideFullUpdateOverlay(); window.location.reload(); }
            });
          } else {
            hideFullUpdateOverlay();
            toast(res?.error || "Could not launch APK installer.");
          }
        } catch (e) {
          hideFullUpdateOverlay();
          toast("APK update failed: " + (e?.message || e));
        }
        return;
      }
      if (typeof window.LedgerFlowAndroid.openExternalUrl === "function") {
        window.LedgerFlowAndroid.openExternalUrl(targetUrl);
        toast("Opening GitHub APK download…");
        return;
      }
    }
    if (isDesktopHost) {
      if (!/\.exe(\?|$)/i.test(targetUrl)) {
        window.open(targetUrl, "_blank");
        return;
      }
      showFullUpdateOverlay({
        title: `Downloading LedgerFlow v${latestUpdateInfo.version}...`,
        sub: "Preparing Windows update installer in the background. Please wait...",
        percent: 40,
        readyToRestart: false
      });
      try {
        const res = await apiFetch("/api/install-update", {
          method: "POST",
          body: JSON.stringify({ url: targetUrl, token: ghToken })
        });
        if (!res || !res.ok) {
          hideFullUpdateOverlay();
          toast(res?.error || "Update download failed.", true);
          return;
        }
        showFullUpdateOverlay({
          title: `Update v${latestUpdateInfo.version} Ready — Restart Required`,
          sub: "Restart LedgerFlow to install the new version and close this old window cleanly.",
          percent: 100,
          readyToRestart: true,
          onRestart: async () => {
            showFullUpdateOverlay({
              title: `Restarting to v${latestUpdateInfo.version}...`,
              sub: "Closing current session and launching the updated app...",
              percent: 100,
              readyToRestart: false
            });
            try {
              await apiFetch("/api/apply-update-restart", { method: "POST", body: "{}" });
            } catch (_) {}
            setTimeout(() => { try { window.close(); } catch (_) {} }, 180);
          }
        });
      } catch (e) {
        hideFullUpdateOverlay();
        toast("Update download failed: " + (e?.message || e), true);
      }
      return;
    }
    window.open(targetUrl, "_blank");
  }

  async function runHybridAIClassification(txList, opts = {}) {
    const list = (txList || []).filter((t) => t && t.type !== "transfer");
    if (!list.length) return { updated: 0, source: "none" };

    const histIdx = buildHistoricalClassifierIndex();
    let updated = 0;
    const uncertain = [];

    for (const t of list) {
      const prevCat = t.category;
      const prevNat = t.costNature;
      const prevSpec = t.isSpecial;
      autoClassifyBankTx(t, t.notes || "", histIdx);
      if (t.category !== prevCat || t.costNature !== prevNat || t.isSpecial !== prevSpec) updated++;
      if ((t.aiConfidence || 0) < 0.78 || t.category === "other_exp" || t.category === "personal_transfer") {
        uncertain.push(t);
      }
    }

    const cfg = state.settings.aiConfig || {};
    const useLlm = cfg.provider && cfg.provider !== "none" && cfg.mode !== "local";
    if (!useLlm) {
      return { updated, source: "Offline Local AI" };
    }

    const targets = (opts.onlyUncertain !== false && cfg.mode !== "llm_all")
      ? (uncertain.length ? uncertain : [])
      : list;
    if (!targets.length) {
      return { updated, source: "Offline Local AI (100% confident)" };
    }

    const validCatIds = new Set((state.categories || []).map((c) => c.id));
    const batchSize = 25;
    let llmUpdated = 0;
    const feedArr = [];
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const bIdx = Math.floor(i / batchSize) + 1;
      const bTot = Math.ceil(targets.length / batchSize);
      const pct = Math.min(95, Math.round(15 + 80 * bIdx / Math.max(1, bTot)));
      if (opts.onProgress) opts.onProgress(`Analyzing batch ${bIdx} of ${bTot} with ${cfg.provider} (${Math.min(i + batch.length, targets.length)}/${targets.length})…`, pct, feedArr);
      const results = await classifyBatchWithLLM(batch, cfg);
      for (const r of results) {
        const tx = batch[Number(r.idx)];
        if (!tx) continue;
        if (r.category && validCatIds.has(r.category) && r.category !== "transfer") {
          tx.category = r.category;
        }
        if (r.costNature === "fixed" || r.costNature === "variable") {
          tx.costNature = r.costNature;
        }
        if (typeof r.isSpecial === "boolean") {
          tx.isSpecial = r.isSpecial;
        }
        if (r.cleanPayee && String(r.cleanPayee).trim().length >= 2) {
          tx.payee = String(r.cleanPayee).trim().slice(0, 60);
        }
        if (r.ledgerType === "drawings") {
          tx.ledgerId = "led_drawings";
        } else if (r.ledgerType === "person" && r.personName && String(r.personName).trim().length >= 2) {
          const led = findOrCreateLedger(String(r.personName).trim(), "person");
          if (led) tx.ledgerId = led.id;
        }
        tx.aiConfidence = 0.95;
        tx.aiReason = `${cfg.provider.toUpperCase()}: ${String(r.reason || "Classified by AI").slice(0, 80)}`;
        learnFromTransaction(tx);
        feedArr.push(`${tx.payee} → ${getCat(tx.category).name}`);
        if (feedArr.length > 6) feedArr.shift();
        llmUpdated++;
      }
      if (opts.onProgress) opts.onProgress(`Completed batch ${bIdx} of ${bTot} (${llmUpdated} refined)`, pct, feedArr);
    }

    return { updated: Math.max(updated, llmUpdated), source: `Hybrid (${cfg.provider})` };
  }

  function detectDateFormatMode(rows, dateColIdx, hasIndianContext) {
    let dmyVotes = 0, mdyVotes = 0;
    for (const r of rows.slice(0, 120)) {
      const s = String(r[dateColIdx] || "").trim();
      const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
      if (m) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a > 12) dmyVotes += 5;
        if (b > 12) mdyVotes += 5;
      }
    }
    if (dmyVotes > mdyVotes) return "dmy";
    if (mdyVotes > dmyVotes) return "mdy";
    return hasIndianContext ? "dmy" : "dmy";
  }

  function parseBankDate(raw, fmtMode = "dmy") {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;

    // 1. ISO YYYY-MM-DD or YYYY/MM/DD (with optional time)
    const mIso = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i);
    if (mIso) {
      const y = Number(mIso[1]), month = Number(mIso[2]), day = Number(mIso[3]);
      if (y >= 1990 && y <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00`;
      }
    }

    // 2. Numeric DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (with optional time)
    const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i);
    if (m) {
      let a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
      if (y < 100) y += 2000;
      if (y < 1990 || y > 2099) return null;
      let day, month;
      if (fmtMode === "mdy" && a <= 12) { month = a; day = b; }
      else { day = a; month = b; }
      if (month > 12 && day <= 12) { const tmp = day; day = month; month = tmp; }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00`;
      }
    }

    // 3. Alpha month: DD-MMM-YYYY, DD MMM, YYYY, or MMM DD, YYYY
    const mAlpha = s.match(/^(\d{1,2})[\s\-\/,]+([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})(?:\s+\d{1,2}:\d{2}.*)?$/)
      || s.match(/^([A-Za-z]{3,9})[\s\-\/,]+(\d{1,2})[\s\-\/,]+(\d{2,4})(?:\s+\d{1,2}:\d{2}.*)?$/);
    if (mAlpha) {
      const firstIsNum = /^\d+$/.test(mAlpha[1]);
      const dayPart = firstIsNum ? mAlpha[1] : mAlpha[2];
      const monPart = firstIsNum ? mAlpha[2] : mAlpha[1];
      const yr = mAlpha[3].length === 2 ? "20" + mAlpha[3] : mAlpha[3];
      const parsed = new Date(`${monPart} ${dayPart}, ${yr}`);
      if (!isNaN(parsed)) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}T12:00`;
      }
    }

    // 4. Unformatted Excel date serial (e.g. 46306)
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const serial = Number(s);
      if (serial >= 30000 && serial <= 70000) {
        const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
        if (!isNaN(dt)) return dt.toISOString().slice(0, 10) + "T12:00";
      }
    }
    return null;
  }

  function parseAmountNumber(raw) {
    if (raw === null || raw === undefined) return 0;
    const s = String(raw).trim();
    if (!s) return 0;
    const isCrBal = /(?:\b|\d)\s*\(?CR\.?\s*\)?\s*$/i.test(s);
    const isDrBal = !isCrBal && /(?:\b|\d)\s*\(?DR\.?\s*\)?\s*$/i.test(s);
    const isParenNeg = /^\(.*\)$/.test(s) && !isCrBal;
    const cleaned = s.replace(/\s*\(?(CR|DR)\.?\s*\)?\s*$/i, "").replace(/,/g, "").replace(/[^0-9.-]/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    return (isParenNeg || isDrBal) ? -Math.abs(num) : num;
  }

  function setCsvModalTab(tabName) {
    const isLogs = tabName === "logs";
    document.querySelectorAll("#csv-mode-tabs .seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.csvTab === tabName);
    });
    const up = document.getElementById("csv-upload-panel");
    const lp = document.getElementById("csv-logs-panel");
    if (up) up.classList.toggle("hidden", isLogs);
    if (lp) lp.classList.toggle("hidden", !isLogs);
    if (isLogs) renderCsvImportLogs();
  }

  function renderImportLogsListHtml() {
    const logs = state?.importLogs || [];
    if (!logs.length) {
      return `<div class="muted text-sm" style="padding:18px;text-align:center;border:1px dashed var(--border);border-radius:12px;">No statement imports recorded yet.</div>`;
    }
    return logs.map((log) => {
      const acc = getAcc(log.accountId);
      const accLbl = acc && acc.id ? formatAccountLabel(acc) : (log.accountName || "Bank Account");
      const when = log.importedAt ? new Date(log.importedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      const liveCount = (state.transactions || []).filter((t) => t.importId === log.id).length;
      return `
        <div class="import-log-card" style="padding:11px 13px;border:1px solid var(--border);border-radius:12px;background:var(--bg);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="min-width:0;flex:1 1 220px;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong class="text-sm">${esc(log.fileName || "Statement")}</strong>
              ${log.format ? `<span class="tag-chip">${esc(String(log.format).toUpperCase())}</span>` : ""}
              <span class="badge delta-up">${liveCount} live / ${log.importedCount || 0} entered</span>
            </div>
            <div class="text-xs muted mt-2">
              Bank: <strong>${esc(accLbl)}</strong>
              ${log.dateFrom && log.dateTo ? ` &bull; ${esc(log.dateFrom)} &rarr; ${esc(log.dateTo)}` : ""}
              ${when ? ` &bull; ${esc(when)}` : ""}
            </div>
            <div class="text-xs muted">
              Dr: <span class="money-val">${fmtMoney(log.totalDebit || 0)}</span> &bull;
              Cr: <span class="money-val amount-income">${fmtMoney(log.totalCredit || 0)}</span>
              ${log.skippedDupes ? ` &bull; ${log.skippedDupes} dupe(s) skipped` : ""}
            </div>
          </div>
          <div class="flex-gap" style="flex-shrink:0;">
            <button type="button" class="btn btn-danger btn-xs" data-del-import="${esc(log.id)}">Delete Import</button>
          </div>
        </div>`;
    }).join("");
  }

  function renderCsvImportLogs() {
    const cntEl = document.getElementById("csv-logs-count");
    if (cntEl) cntEl.textContent = String((state?.importLogs || []).length);
    const listEl = document.getElementById("csv-logs-list");
    if (!listEl) return;
    listEl.innerHTML = renderImportLogsListHtml();
    bindImportLogActions(listEl, () => renderCsvImportLogs());
  }

  function bindImportLogActions(container, onAfterDelete = null) {
    if (!container) return;
    container.querySelectorAll("[data-del-import]").forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.armed !== "1") {
          btn.dataset.armed = "1";
          btn.textContent = "Confirm Delete?";
          setTimeout(() => {
            if (btn.isConnected && btn.dataset.armed === "1") {
              btn.dataset.armed = "0";
              btn.textContent = "Delete Import";
            }
          }, 3500);
          return;
        }
        deleteImportBatch(btn.dataset.delImport);
        if (onAfterDelete) onAfterDelete();
      };
    });
  }

  function deleteImportBatch(importId) {
    const logs = state.importLogs || [];
    const log = logs.find((l) => l.id === importId);
    if (!log) return;

    const removedTxs = (state.transactions || []).filter((t) => t.importId === importId);
    for (const t of removedTxs) selectedTxIds.delete(t.id);
    state.transactions = (state.transactions || []).filter((t) => t.importId !== importId);

    // Recompute or restore account opening balance cleanly
    const acc = (state.accounts || []).find((a) => a.id === log.accountId);
    if (acc && log.balanceSynced) {
      let bestTx = null;
      for (const t of state.transactions || []) {
        if (t.accountId !== acc.id || typeof t.bankBalance !== "number") continue;
        if (!bestTx || t.date > bestTx.date || (t.date === bestTx.date && (t.seq || 0) > (bestTx.seq || 0))) {
          bestTx = t;
        }
      }
      if (bestTx) {
        let netTx = 0;
        for (const t of state.transactions || []) {
          const v = convertToBase(t.amount, t.currency);
          if (t.type === "income" && t.accountId === acc.id) netTx += v;
          else if (t.type === "expense" && t.accountId === acc.id) netTx -= v;
          else if (t.type === "transfer") {
            if (t.accountId === acc.id) netTx -= v;
            if (t.toAccountId === acc.id) netTx += v;
          }
        }
        acc.initialBalance = Math.round((bestTx.bankBalance - netTx) * 100) / 100;
      } else if (typeof log.prevInitialBalance === "number") {
        acc.initialBalance = log.prevInitialBalance;
      }
    }

    // Remove auto-created non-user ledgers that now have 0 transactions
    const usedLedgerIds = new Set((state.transactions || []).map((t) => t.ledgerId).filter(Boolean));
    state.ledgers = (state.ledgers || []).filter((l) =>
      l.id === "led_drawings" || l.isUserCreated || l.protectedFromDrawings || usedLedgerIds.has(l.id)
    );

    state.importLogs = logs.filter((l) => l.id !== importId);
    saveState();
    updateSidebarMeta();
    const cntEl = document.getElementById("csv-logs-count");
    if (cntEl) cntEl.textContent = String(state.importLogs.length);
    switchView(currentView);
    toast(`Deleted import "${log.fileName}" (${removedTxs.length} transaction(s) removed). You can now re-upload to the correct bank.`);
  }

  function openStatementModal() {
    document.getElementById("csv-target-account").innerHTML = (state.accounts || []).map((a) => `<option value="${a.id}">${esc(formatAccountLabel(a))}</option>`).join("");
    document.getElementById("csv-mapping-section").classList.add("hidden");
    document.getElementById("stmt-password-box").classList.add("hidden");
    const ocrPanel = document.getElementById("csv-ocr-panel");
    if (ocrPanel) ocrPanel.classList.add("hidden");
    const protChk = document.getElementById("csv-is-protected");
    if (protChk) protChk.checked = false;
    const pwInput = document.getElementById("stmt-file-password");
    pwInput.value = "";
    pwInput.type = "password";
    const toggleBtn = document.getElementById("stmt-pw-toggle-btn");
    if (toggleBtn) toggleBtn.textContent = "Show";
    document.getElementById("stmt-pw-desc").textContent = "Enter the Excel or PDF password to unlock it and import or export entries.";
    pendingUploadFile = null;
    pendingExportOnly = false;
    const adv = document.getElementById("csv-advanced-details");
    if (adv) adv.open = false;
    const cntEl = document.getElementById("csv-logs-count");
    if (cntEl) cntEl.textContent = String((state?.importLogs || []).length);
    setCsvModalTab("upload");
    document.getElementById("csv-modal").classList.remove("hidden");
  }

  function loadRowsIntoStatementModal(allRows, meta = {}, exportAfterUnlock = false) {
    if (!allRows || allRows.length < 2) return toast("Statement appears empty or unreadable.");
    let headerIdx = detectHeaderRowIndex(allRows);
    let syntheticHeaders = false;
    if (headerIdx < 0) {
      headerIdx = 0;
      syntheticHeaders = true;
    }
    csvParsedState = { allRows, headerIdx, meta, syntheticHeaders, aiOverrides: new Map(), geminiAudit: null };
    const repEl = document.getElementById("csv-gemini-report");
    if (repEl) { repEl.classList.add("hidden"); repEl.innerHTML = ""; }

    const accSel = document.getElementById("csv-target-account");
    if (!accSel.options.length) {
      accSel.innerHTML = (state.accounts || []).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    }
    document.getElementById("csv-header-row").innerHTML = allRows.slice(0, Math.min(40, allRows.length - 1)).map((r, i) =>
      `<option value="${i}" ${i === headerIdx ? "selected" : ""}>Row ${i + 1}: ${esc(r.filter(Boolean).slice(0, 3).join(" | ").slice(0, 42))}</option>`
    ).join("");

    applyHeaderRowSelection(headerIdx, syntheticHeaders);

    const reviewWanted = document.getElementById("csv-review-before-import")?.checked;
    const { entries, isReverseChrono } = buildStatementEntriesFromState();

    const banner = document.getElementById("stmt-meta-banner");
    const metaParts = [];
    if (meta.bank) metaParts.push(`<strong>${esc(meta.bank)}</strong>`);
    if (meta.accountNumber) metaParts.push(`A/C: <code>${esc(meta.accountNumber)}</code>`);
    if (meta.period) metaParts.push(`Period: ${esc(meta.period)}`);
    if (meta.balance) metaParts.push(`Clear Bal: <strong>${esc(meta.balance)}</strong>`);
    if (meta.viaOcr) metaParts.push(`<span class="badge">OCR + AI</span>`);
    if (isReverseChrono) metaParts.push(`<span class="badge">Upside-Down Auto-Sorted</span>`);
    if (metaParts.length) {
      banner.innerHTML = metaParts.join(" &bull; ");
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }

    if (exportAfterUnlock) {
      if (entries.length > 0) {
        exportTransactionsCSV(entries);
        return;
      }
      exportParsedRowsCSV(allRows);
      return;
    }

    const aiCfg = state.settings.aiConfig || {};
    const hasGeminiCheck = aiCfg.provider === "gemini" && aiCfg.mode !== "local" && String(aiCfg.apiKey || "").trim().length > 10;
    const isPdfSource = String(meta.format || "").toLowerCase().startsWith("pdf") || /\.pdf$/i.test(meta.fileName || "");

    let summaryMismatch = false;
    const sums = meta?.summaries || [];
    if (sums.length && entries.length > 0) {
      let dCnt = 0, cCnt = 0, dSum = 0, cSum = 0;
      for (const e of entries) {
        if (e.type === "expense") { dCnt++; dSum += e.amount; }
        else { cCnt++; cSum += e.amount; }
      }
      const expDr = sums.reduce((s, x) => s + x.drCount, 0);
      const expCr = sums.reduce((s, x) => s + x.crCount, 0);
      const expDeb = sums.reduce((s, x) => s + x.totalDebits, 0);
      const expCred = sums.reduce((s, x) => s + x.totalCredits, 0);
      if (dCnt !== expDr || cCnt !== expCr || Math.abs(dSum - expDeb) >= 0.05 || Math.abs(cSum - expCred) >= 0.05) {
        summaryMismatch = true;
      }
    }

    // Pause before pushing entries when Gemini PDF check is enabled, Preview is checked, or Statement Summary differs
    if (!reviewWanted && !summaryMismatch && !(hasGeminiCheck && isPdfSource) && entries.length > 0) {
      confirmStatementImport();
      return;
    }

    document.getElementById("csv-mapping-section").classList.remove("hidden");
    const chkBtnInit = document.getElementById("csv-gemini-check-btn");
    if (chkBtnInit) chkBtnInit.textContent = hasGeminiCheck ? "Check PDF with Gemini" : "✨ Connect Gemini Key";
    if (entries.length === 0) {
      const adv = document.getElementById("csv-advanced-details");
      if (adv) adv.open = true;
    }
    refreshCSVPreview();
    if (summaryMismatch && repEl) {
      repEl.className = "mb-3";
      repEl.style.borderColor = "var(--amber)";
      repEl.innerHTML = "<strong>⚠ Balance / Count Check:</strong> Statement Summary total differs from extracted entries. Check details or run <strong>Check PDF with Gemini</strong> before clicking Auto-Enter Entries.";
    }

    if (hasGeminiCheck && entries.length > 0) {
      verifyStatementWithGeminiBeforeImport();
    }
  }

  async function verifyStatementWithGeminiBeforeImport() {
    if (!csvParsedState) return;
    const repEl = document.getElementById("csv-gemini-report");
    const chkBtn = document.getElementById("csv-gemini-check-btn");
    const aiCfg = state.settings.aiConfig || {};
    if (aiCfg.provider !== "gemini" || aiCfg.mode === "local" || String(aiCfg.apiKey || "").trim().length < 10) {
      if (repEl) {
        repEl.className = "mb-3";
        repEl.innerHTML = "<strong>Gemini PDF Check:</strong> Add your free Gemini API key to auto-check PDF entries before pushing.";
      }
      openQuickGeminiConnectModal(() => verifyStatementWithGeminiBeforeImport());
      return;
    }

    const { entries } = buildStatementEntriesFromState();
    if (!entries.length) return toast("No parsed entries to verify.");
    if (repEl) {
      repEl.className = "mb-3";
      repEl.innerHTML = `⏳ <strong>Gemini PDF Check:</strong> Analyzing ${entries.length} extracted entry(ies) before pushing to your ledger…`;
    }
    if (chkBtn) { chkBtn.disabled = true; chkBtn.textContent = "Checking PDF…"; }
    showPdfProgress("✨ Gemini AI is Reading PDF...", `Sending ${Math.min(entries.length, 80)} sample(s) of ${entries.length} entries to Gemini...`, {
      percent: 25,
      stats: `Checking ${entries.length} extracted entry(ies)...`,
      feed: entries.slice(0, 5).map((e) => `${String(e.date || "").slice(0, 10)} • ${e.payee} • ${fmtMoney(e.amount)}`)
    });

    try {
      const catIds = (state.categories || []).map((c) => `${c.id} (${c.type})`).join(", ");
      const compactRows = entries.slice(0, 80).map((e, idx) => ({
        seq: idx + 1,
        date: String(e.date || "").slice(0, 10),
        type: e.type,
        amount: e.amount,
        balance: e.bankBalance ?? null,
        payee: e.payee,
        category: e.category,
        raw: String(e.rawNarration || e.notes || "").slice(0, 140)
      }));
      const auditPrompt =
        "You are LedgerFlow's pre-import PDF Bank Statement Auditor. Analyze extracted rows BEFORE they are pushed to the user's ledger.\n" +
        `Valid category ids: ${catIds}\n` +
        "Return ONLY valid JSON: {\"summary\":\"short 1-line check result\",\"warnings\":[\"optional array of detected anomalies or balance/debit-credit issues\"],\"fixes\":[{\"seq\":1,\"type\":\"expense|income\",\"payee\":\"Cleaned Name\",\"category\":\"valid_cat_id\",\"costNature\":\"fixed|variable\",\"note\":\"reason\"}]}\n" +
        "- Check if any debit/credit direction looks flipped vs narration (UPI/DR = expense, UPI/CR or REV = income) or if payee names can be cleaner or categorized better.\n" +
        "- Only include entries in fixes[] that actually need cleaner payee/category/type correction.\n" +
        (aiCfg.customPrompt ? `User rules: ${aiCfg.customPrompt}\n` : "");

      updatePdfProgress({ sub: "Waiting for Gemini AI statement audit response...", percent: 55 });
      const gRes = await callGeminiWithFallback({
        systemInstruction: { parts: [{ text: auditPrompt }] },
        contents: [{
          role: "user",
          parts: [{
            text: JSON.stringify({
              bank: csvParsedState.meta?.bank || "",
              period: csvParsedState.meta?.period || "",
              summaries: csvParsedState.meta?.summaries || [],
              entries: compactRows
            })
          }]
        }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      }, aiCfg);

      updatePdfProgress({ sub: "Applying Gemini refinements to preview table...", percent: 88 });
      const cleaned = String(gRes.text || "").replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const sIdx = cleaned.indexOf("{");
      const eIdx = cleaned.lastIndexOf("}");
      const obj = (sIdx >= 0 && eIdx > sIdx) ? JSON.parse(cleaned.slice(sIdx, eIdx + 1)) : JSON.parse(cleaned);

      const overrides = new Map();
      const validCatSet = new Set((state.categories || []).map((c) => c.id));
      let fixCount = 0;
      const fixFeed = [];
      if (Array.isArray(obj.fixes)) {
        for (const f of obj.fixes) {
          const seqNum = Number(f?.seq);
          if (!seqNum || seqNum < 1) continue;
          const patch = {};
          if (f.type === "expense" || f.type === "income") patch.type = f.type;
          if (f.payee && String(f.payee).trim()) patch.payee = String(f.payee).trim().slice(0, 60);
          if (f.category && validCatSet.has(f.category)) patch.category = f.category;
          if (f.costNature === "fixed" || f.costNature === "variable") patch.costNature = f.costNature;
          if (Object.keys(patch).length) {
            overrides.set(seqNum, patch);
            fixCount++;
            if (fixFeed.length < 6) fixFeed.push(`#${seqNum}: ${patch.payee || ""} ${patch.category ? "→ " + patch.category : ""}`.trim());
          }
        }
      }
      csvParsedState.aiOverrides = overrides;
      const warnings = Array.isArray(obj.warnings) ? obj.warnings.filter(Boolean) : [];
      csvParsedState.geminiAudit = { model: gRes.model, summary: obj.summary || "", warnings, fixCount };
      updatePdfProgress({
        sub: `Done! Verified via ${gRes.model}`,
        percent: 100,
        stats: `${entries.length} checked • ${fixCount} refined`,
        feed: fixFeed
      });
      refreshCSVPreview();
      if (repEl) {
        const warnHtml = warnings.length
          ? `<ul style="margin:6px 0 0 18px;padding:0;color:var(--rose);">${warnings.slice(0, 5).map((w) => `<li>${esc(String(w))}</li>`).join("")}</ul>`
          : "";
        repEl.className = "mb-3";
        repEl.style.borderColor = warnings.length ? "var(--amber)" : "var(--emerald)";
        repEl.innerHTML = `<strong>✓ Gemini (${esc(gRes.model)}) Pre-Import Check:</strong> ${esc(obj.summary || `Verified ${entries.length} entry(ies)`)}${fixCount ? ` • Refined ${fixCount} row(s)` : ""}. Review below and click <strong>Auto-Enter Entries</strong>.${warnHtml}`;
      }
      toast(`Gemini checked ${entries.length} PDF entry(ies)${fixCount ? ` (${fixCount} refined)` : ""}.`);
    } catch (err) {
      if (repEl) {
        repEl.className = "mb-3";
        repEl.style.borderColor = "var(--amber)";
        repEl.innerHTML = `<strong>Gemini Check Note:</strong> ${esc(err?.message || "Could not verify right now")} — you can still inspect the parsed table below and tap <strong>Auto-Enter Entries</strong>.`;
      }
    } finally {
      hidePdfProgress();
      if (chkBtn) { chkBtn.disabled = false; chkBtn.textContent = isGeminiConnected() ? "Check PDF with Gemini" : "✨ Connect Gemini Key"; }
    }
  }

  function exportParsedRowsCSV(rows) {
    const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = rows.map((r) => (r || []).map(escCsv).join(",")).join("\n");
    downloadFile(`ledgerflow-unlocked-${todayISO()}.csv`, "\uFEFF" + csv, "text/csv;charset=utf-8;");
    toast("Unlocked statement exported as CSV.");
  }

  function detectColumnsFromHeaders(headers, sampleRows = []) {
    const findIdx = (keys) => {
      for (const k of keys) {
        const idx = headers.findIndex((h) => String(h || "").toLowerCase().includes(k));
        if (idx >= 0) return idx;
      }
      return -1;
    };
    let dateIdx = findIdx(["txn date", "transaction date", "tran date", "post date", "txn dt", "value date", "date"]);
    let payeeIdx = findIdx(["narration", "particulars", "particular", "remarks", "remark", "details", "description", "memo", "payee"]);
    let debitIdx = headers.findIndex((h) => /(debit|withdrawal|\bdr\b)/i.test(String(h || "")) && !/(dr\s*\/\s*cr|cr\s*\/\s*dr|withdrawal.*deposit|deposit.*withdrawal)/i.test(String(h || "")));
    let creditIdx = headers.findIndex((h) => /(credit|deposit|\bcr\b)/i.test(String(h || "")) && !/(dr\s*\/\s*cr|cr\s*\/\s*dr|withdrawal.*deposit|deposit.*withdrawal)/i.test(String(h || "")));
    let drCrIdx = headers.findIndex((h) => /(^\s*(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn\s*type|indicator)\s*$|dr\s*\/\s*cr|cr\s*\/\s*dr)/i.test(String(h || "")));
    let refIdx = headers.findIndex((h) => /(ref|cheque|chq|utr)/i.test(String(h || "")));
    let balIdx = headers.findIndex((h) => /\bbalance\b/i.test(String(h || "")));
    let amtIdx = findIdx(["amount", "amt", "withdrawal(dr)/ deposit(cr)", "debit/credit", "value", "debit"]);

    // Content-based inference for non-standard/headerless statements
    if (sampleRows && sampleRows.length && (dateIdx < 0 || payeeIdx < 0 || (amtIdx < 0 && debitIdx < 0 && creditIdx < 0))) {
      const probe = sampleRows.filter((r) => Array.isArray(r) && r.filter(Boolean).length >= 3).slice(0, 45);
      const colCount = Math.max(headers.length, ...probe.map((r) => r.length), 0);
      const stats = Array.from({ length: colCount }, () => ({ dates: 0, nums: 0, balSuffix: 0, textLen: 0, texts: 0 }));
      for (const r of probe) {
        for (let c = 0; c < colCount; c++) {
          const val = String(r[c] || "").trim();
          if (!val) continue;
          if (/^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-][A-Za-z]{3}[\s\-]\d{2,4})/.test(val)) stats[c].dates++;
          if (/\b(CR|DR)\.?\s*$/i.test(val) && /\d/.test(val)) stats[c].balSuffix++;
          const stripped = val.replace(/,/g, "").replace(/\s*(CR|DR)\.?\s*$/i, "");
          if (/^-?\d+(\.\d{1,2})?$/.test(stripped)) stats[c].nums++;
          else if (/[a-zA-Z]/.test(val)) { stats[c].texts++; stats[c].textLen += val.length; }
        }
      }
      if (dateIdx < 0) {
        const bestDateCol = stats.map((s, idx) => [s.dates, idx]).sort((a, b) => b[0] - a[0])[0];
        if (bestDateCol && bestDateCol[0] >= 2) dateIdx = bestDateCol[1];
      }
      if (payeeIdx < 0) {
        const bestTextCol = stats
          .map((s, idx) => [idx === dateIdx ? 0 : s.textLen, idx])
          .sort((a, b) => b[0] - a[0])[0];
        if (bestTextCol && bestTextCol[0] > 0) payeeIdx = bestTextCol[1];
      }
      if (balIdx < 0) {
        const balCol = stats.findIndex((s) => s.balSuffix >= 2);
        if (balCol >= 0) balIdx = balCol;
      }
      if (debitIdx < 0 && creditIdx < 0 && amtIdx < 0) {
        const numCols = stats
          .map((s, idx) => ({ idx, nums: s.nums, hasBal: idx === balIdx || s.balSuffix > 0 }))
          .filter((x) => x.idx !== dateIdx && x.idx !== payeeIdx && x.nums >= 1 && !x.hasBal);
        if (numCols.length >= 2) {
          debitIdx = numCols[0].idx;
          creditIdx = numCols[1].idx;
        } else if (numCols.length === 1) {
          amtIdx = numCols[0].idx;
        }
      }
    }

    const maxCol = Math.max(0, headers.length - 1);
    return {
      dateIdx: dateIdx >= 0 ? dateIdx : 0,
      payeeIdx: payeeIdx >= 0 ? payeeIdx : Math.min(1, maxCol),
      debitIdx,
      creditIdx,
      drCrIdx,
      refIdx,
      balIdx,
      amtIdx: amtIdx >= 0 ? amtIdx : Math.min(2, maxCol)
    };
  }

  function applyHeaderRowSelection(headerIdx, includeHeaderInData = false) {
    if (!csvParsedState) return;
    csvParsedState.headerIdx = headerIdx;
    const headers = csvParsedState.allRows[headerIdx] || [];
    const dataRows = includeHeaderInData ? csvParsedState.allRows : csvParsedState.allRows.slice(headerIdx + 1);
    csvParsedState.headers = headers;
    csvParsedState.dataRows = dataRows;

    const maxCols = Math.max(headers.length, ...dataRows.slice(0, 15).map((r) => (r || []).length), 1);
    const colOpts = Array.from({ length: maxCols }, (_, i) => {
      const h = headers[i];
      return `<option value="${i}">${esc(h && !includeHeaderInData ? h : "Col " + (i + 1))}</option>`;
    }).join("");
    ["csv-col-date", "csv-col-payee", "csv-col-debit", "csv-col-credit", "csv-col-amount"].forEach((id) => {
      document.getElementById(id).innerHTML = colOpts;
    });

    const cols = detectColumnsFromHeaders(includeHeaderInData ? [] : headers, dataRows);
    csvParsedState.refIdx = cols.refIdx;
    csvParsedState.balIdx = cols.balIdx;
    csvParsedState.drCrIdx = cols.drCrIdx;

    document.getElementById("csv-col-date").value = cols.dateIdx;
    document.getElementById("csv-col-payee").value = cols.payeeIdx;

    const hasSplit = cols.debitIdx >= 0 && cols.creditIdx >= 0 && cols.debitIdx !== cols.creditIdx;
    document.getElementById("csv-amount-mode").value = hasSplit ? "split" : "single";
    if (hasSplit) {
      document.getElementById("csv-col-debit").value = cols.debitIdx;
      document.getElementById("csv-col-credit").value = cols.creditIdx;
    } else {
      document.getElementById("csv-col-amount").value = cols.amtIdx;
    }

    const fmt = detectDateFormatMode(dataRows, cols.dateIdx, !!(csvParsedState.meta?.bank || state.settings.currency === "INR"));
    document.getElementById("csv-date-format").value = fmt;
    toggleAmountModeUI();
  }

  function toggleAmountModeUI() {
    const mode = document.getElementById("csv-amount-mode").value;
    const isSplit = mode === "split";
    document.getElementById("csv-debit-wrap").classList.toggle("hidden", !isSplit);
    document.getElementById("csv-credit-wrap").classList.toggle("hidden", !isSplit);
    document.getElementById("csv-single-amt-wrap").classList.toggle("hidden", isSplit);
    document.getElementById("csv-invert-wrap").classList.toggle("hidden", isSplit);
  }

  function buildStatementEntriesFromState() {
    if (!csvParsedState) return { entries: [], openingBalance: null, isReverseChrono: false };
    let dIdx = Number(document.getElementById("csv-col-date").value);
    let pIdx = Number(document.getElementById("csv-col-payee").value);
    let mode = document.getElementById("csv-amount-mode").value;
    let debIdx = Number(document.getElementById("csv-col-debit").value);
    let credIdx = Number(document.getElementById("csv-col-credit").value);
    let amtIdx = Number(document.getElementById("csv-col-amount").value);
    const invert = document.getElementById("csv-invert-signs").checked;
    const accId = document.getElementById("csv-target-account").value;
    let fmtMode = document.getElementById("csv-date-format").value;
    if (fmtMode === "auto") fmtMode = detectDateFormatMode(csvParsedState.dataRows, dIdx, true);

    let refIdx = csvParsedState.refIdx;
    let balIdx = csvParsedState.balIdx;
    let drCrIdx = csvParsedState.drCrIdx ?? -1;
    const histIdx = buildHistoricalClassifierIndex();
    const entries = [];
    let pendingRow = null;
    let pendingAmountRow = null;
    let upcomingPreLines = [];
    let inSummaryBlock = false;
    const isDashPlaceholder = (s) => /^[-–—]+(?:\s+[-–—]+)*$/.test(s) || /^(na|n\/a|nil)$/i.test(s);
    const stripInlineDashes = (s) => String(s || "").replace(/(?:^|\s)-\s+-(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    const standaloneHdrRe = /^(value\s+date|post\s+date|txn\s+date|details|particulars|particular|narration|ref(\s*no)?\/?|cheque(\s*no)?|chq(\s*no)?|no\.?|debit(\s*\(₹\))?|credit(\s*\(₹\))?|balance(\s*\(₹\))?|amount(\s*\(₹\))?|dr|cr|₹|rs\.?|-+|\s)+$/i;
    const newTxPrefixRe = /^(?:[A-Z]{4}0[A-Z0-9]{6}\/|WDL\s+TFR|DEP\s+TFR|POS\s+ATM(?:\s+PURCH)?|ATM\s+(?:WDL|CASH)|CASH\s+(?:DEP|WDL)|CREDIT\s+(?:Chq|TFR|TRANSFER)|DEBIT\s+(?:Chq|TFR|TRANSFER)|CEMTEX\s+DEP|BY\s+TRANSFER|TO\s+TRANSFER|TRANSFER\s+(?:FROM|TO)|BULK\s+POSTING|CLG\s+CHQ|INW_CLG\b|INTEREST\s+CREDIT|UPI\/(?:DR|CR|REV|DRC|REVERSAL|REF)\/|IMPS\/|NEFT[\*\/\-]|RTGS[\*\/\-]|ACH(?:DR|CR)?[\s\/\-]|NACH[\s\/\-]|Mobile\/|Mr\.\s|Mrs\.\s|Ms\.\s)/i;
    const branchCompleteRe = /\bSERVICE\s+BRANCH\b|\bCORE\s+BANKING\s+DATA\b|\bCENTRE$/i;

    const extractRowAmount = (r) => {
      let type = "expense", absAmt = 0;
      if (mode === "split") {
        const deb = Math.abs(parseAmountNumber(r[debIdx]));
        const cred = Math.abs(parseAmountNumber(r[credIdx]));
        if (deb > 0) { type = "expense"; absAmt = deb; }
        else if (cred > 0) { type = "income"; absAmt = cred; }
      } else {
        let amt = parseAmountNumber(r[amtIdx]);
        if (invert) amt = -amt;
        if (Math.abs(amt) > 0) {
          type = amt >= 0 ? "income" : "expense";
          absAmt = Math.abs(amt);
          if (drCrIdx >= 0) {
            const ind = String(r[drCrIdx] || "").trim();
            if (/^(dr|debit|d)\.?$/i.test(ind)) type = "expense";
            else if (/^(cr|credit|c)\.?$/i.test(ind)) type = "income";
          }
        }
      }
      return { type, absAmt };
    };

    const extractExtraText = (r) => {
      const parts = [];
      for (let c = 0; c < r.length; c++) {
        if (c === dIdx || c === debIdx || c === credIdx || c === amtIdx || c === balIdx || c === drCrIdx || c === refIdx) continue;
        let t = unwrapBankText(r[c] || "");
        if (!t || isDashPlaceholder(t)) continue;
        if (/^-?[\d,]+\.\d{1,2}(\s*(CR|DR)\.?)?$/i.test(t)) continue;
        if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(t)) continue;
        // Strip leading duplicate date when Value Date & Details merged on one cell (e.g. "31/03/26 PROCESSING FEE")
        const leadDateM = t.match(/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\s+(.+)$/);
        if (leadDateM) t = leadDateM[1].trim();
        if (t && !isDashPlaceholder(t)) parts.push(t);
      }
      return parts.join(" ").trim();
    };

    const pushEntry = (isoDate, rawNarr, type, absAmt, refColVal, rowBal) => {
      const parsed = parseBankNarration(rawNarr, type === "income");
      const cleanColRef = refColVal && !isDashPlaceholder(refColVal) && refColVal !== "000000" ? refColVal : "";
      const refId = parsed.refNo || cleanColRef;
      const draft = autoClassifyBankTx({
        id: uid("tx"),
        type,
        amount: absAmt,
        currency: state.settings.currency,
        baseAmount: absAmt,
        date: isoDate,
        payee: parsed.payee,
        category: type === "income" ? "salary" : "other_exp",
        accountId: accId,
        method: parsed.method,
        refId: refId || undefined,
        bankBalance: rowBal !== null ? rowBal : undefined,
        rawNarration: unwrapBankText(rawNarr),
        seq: entries.length + 1,
        tags: ["bank-import"],
        notes: parsed.raw || "Imported from bank statement",
        taxDeductible: false,
        reconciled: true
      }, unwrapBankText(rawNarr), histIdx);
      entries.push(draft);
    };

    for (let i = 0; i < csvParsedState.dataRows.length; i++) {
      const r = csvParsedState.dataRows[i];
      if (!r || !r.length) continue;

      // Support combined multi-statement uploads where a new table header repeats mid-file
      if (isStatementHeaderRow(r)) {
        pendingRow = null;
        pendingAmountRow = null;
        upcomingPreLines = [];
        inSummaryBlock = false;
        const nextCols = detectColumnsFromHeaders(r, csvParsedState.dataRows.slice(i + 1));
        dIdx = nextCols.dateIdx;
        pIdx = nextCols.payeeIdx;
        refIdx = nextCols.refIdx;
        balIdx = nextCols.balIdx;
        drCrIdx = nextCols.drCrIdx ?? -1;
        if (nextCols.debitIdx >= 0 && nextCols.creditIdx >= 0 && nextCols.debitIdx !== nextCols.creditIdx) {
          mode = "split";
          debIdx = nextCols.debitIdx;
          credIdx = nextCols.creditIdx;
        } else {
          mode = "single";
          amtIdx = nextCols.amtIdx;
        }
        continue;
      }

      const joined = unwrapBankText(r.join(" "));
      if (/\b(statement\s+summary|brought\s+forward\s*\(|dr\.?\s*count\b.*\bcr\.?\s*count|total\s+debits\b.*\btotal\s+credits)\b/i.test(joined)
        || /^carried\s+forward\b/i.test(joined)
        || /^closing\s+balance\s*:/i.test(joined)) {
        pendingRow = null;
        pendingAmountRow = null;
        upcomingPreLines = [];
        inSummaryBlock = true;
        continue;
      }
      if (inSummaryBlock) continue;
      if (/(please do not share|debit\/credit card number|personal identification number|power of attorney holder|letter of authority|computer generated statement|does not require a signature|abbreviations are as under|end of statement|\*\*\*\s*end\s+of|about:blank)/i.test(joined)
        || /^(page(\s*no\.?)?\b|account statement|statement\s+of\s+account|opening balance|closing balance|total\b|grand total|carried forward|brought forward|statement summary|ifsc\s*(?:code)?\s*:|micr\s*:|branch\s*(?:code)?\s*:|account\s*no\s*:|cleared\s*balance|uncleared\s*amount|drawing\s*power|ckyc\s*id|nominee\s*name|nominee\s*type)/i.test(joined)) {
        pendingRow = null;
        pendingAmountRow = null;
        upcomingPreLines = [];
        continue;
      }

      const isoDate = parseBankDate(r[dIdx], fmtMode);
      const { type, absAmt } = extractRowAmount(r);
      const rowBal = (balIdx >= 0 && r[balIdx] !== undefined && String(r[balIdx]).trim() !== "")
        ? parseAmountNumber(r[balIdx])
        : null;
      const rawCellVal = stripInlineDashes(unwrapBankText(r[pIdx] || ""));
      const rawNarrCell = isDashPlaceholder(rawCellVal) ? "" : rawCellVal;
      const colRefRaw = refIdx >= 0 ? String(r[refIdx] || "").trim() : "";
      const colRef = isDashPlaceholder(colRefRaw) ? "" : colRefRaw;

      if (!isoDate) {
        if (absAmt < 0.01 && !newTxPrefixRe.test(joined) && standaloneHdrRe.test(joined)) {
          continue;
        }
        const extra = stripInlineDashes([rawNarrCell, extractExtraText(r)].filter(Boolean).join(" "));
        const dedupExtra = (rawNarrCell && extractExtraText(r) && extractExtraText(r) !== rawNarrCell)
          ? stripInlineDashes(`${rawNarrCell} ${extractExtraText(r)}`)
          : stripInlineDashes(rawNarrCell || extractExtraText(r));
        const lineExtra = dedupExtra || extra;

        if (pendingRow) {
          const cleanLead = lineExtra.replace(/^[\s\-–—•|]+/, "").trim();
          if (cleanLead && newTxPrefixRe.test(cleanLead)) {
            // Previous pendingRow was a zero-amount bank memo (e.g. Acknowledgement); next transaction started
            pendingRow = null;
            upcomingPreLines.push(cleanLead);
          } else {
            if (lineExtra) pendingRow.rawNarration = `${pendingRow.rawNarration} ${lineExtra}`.trim();
            if (colRef && !pendingRow.colRef) pendingRow.colRef = colRef;
            if (pendingRow.rowBal === null && rowBal !== null) pendingRow.rowBal = rowBal;
            if (absAmt >= 0.01) {
              pushEntry(pendingRow.isoDate, pendingRow.rawNarration, type, absAmt, pendingRow.colRef, pendingRow.rowBal);
              pendingRow = null;
            }
          }
        } else if (absAmt >= 0.01) {
          // PDF Y-skew placed amount/balance slightly above its Date cell
          const pre = upcomingPreLines.length ? upcomingPreLines.join(" ") : "";
          upcomingPreLines = [];
          pendingAmountRow = {
            type,
            absAmt,
            rowBal,
            colRef,
            extra: [pre, lineExtra].filter(Boolean).join(" ").trim()
          };
        } else if (absAmt < 0.01 && lineExtra) {
          const cleanLead = lineExtra.replace(/^[\s\-–—•|]+/, "").trim();
          const prev = entries.length ? entries[entries.length - 1] : null;
          if (upcomingPreLines.length > 0 || !prev || prev._narrationClosed || newTxPrefixRe.test(cleanLead)) {
            upcomingPreLines.push(cleanLead);
          } else if (pendingAmountRow) {
            pendingAmountRow.extra = `${pendingAmountRow.extra} ${lineExtra}`.trim();
            if (pendingAmountRow.rowBal === null && rowBal !== null) pendingAmountRow.rowBal = rowBal;
          } else {
            // Multi-line wrapped PDF narration continuation row
            const mergedRaw = stripInlineDashes(`${prev.rawNarration} ${lineExtra}`);
            const reParsed = parseBankNarration(mergedRaw, prev.type === "income");
            prev.rawNarration = mergedRaw;
            prev.payee = reParsed.payee;
            prev.method = reParsed.method;
            prev.notes = reParsed.raw || prev.notes;
            if (!prev.refId && (reParsed.refNo || colRef)) prev.refId = reParsed.refNo || colRef;
            if (prev.bankBalance === undefined && rowBal !== null) prev.bankBalance = rowBal;
            if (branchCompleteRe.test(cleanLead)) prev._narrationClosed = true;
            autoClassifyBankTx(prev, mergedRaw, histIdx);
          }
        }
        continue;
      }

      pendingRow = null;
      const preText = upcomingPreLines.length ? upcomingPreLines.join(" ") : "";
      upcomingPreLines = [];
      const extraSide = extractExtraText(r);
      const rowText = (rawNarrCell && extraSide && extraSide !== rawNarrCell)
        ? `${rawNarrCell} ${extraSide}`
        : (rawNarrCell || extraSide);
      const combinedNarr = stripInlineDashes([preText, rowText].filter(Boolean).join(" "));

      if (absAmt < 0.01) {
        if (pendingAmountRow) {
          const pairedNarr = stripInlineDashes([pendingAmountRow.extra, combinedNarr].filter(Boolean).join(" "));
          pushEntry(isoDate, pairedNarr, pendingAmountRow.type, pendingAmountRow.absAmt, pendingAmountRow.colRef || colRef, pendingAmountRow.rowBal ?? rowBal);
          pendingAmountRow = null;
          continue;
        }
        if (combinedNarr) {
          pendingRow = {
            isoDate,
            rawNarration: combinedNarr,
            colRef,
            rowBal
          };
        }
        continue;
      }

      pendingAmountRow = null;
      pushEntry(isoDate, combinedNarr, type, absAmt, colRef, rowBal);
    }

    // Detect reverse-chronological ("upside-down", newest-at-top) statements such as PNB
    let isReverseChrono = false;
    if (entries.length >= 2) {
      let ascPairs = 0, descPairs = 0;
      for (let i = 1; i < entries.length; i++) {
        const dPrev = entries[i - 1].date.slice(0, 10);
        const dCur = entries[i].date.slice(0, 10);
        if (dPrev > dCur) descPairs++;
        else if (dPrev < dCur) ascPairs++;
      }
      if (descPairs > ascPairs) {
        isReverseChrono = true;
      } else if (descPairs === 0 && ascPairs === 0) {
        // All on same day: check running balance continuity (newest-first satisfies cur.bal + cur.dr - cur.cr == next.bal)
        let revBalMatches = 0, fwdBalMatches = 0;
        for (let i = 0; i < entries.length - 1; i++) {
          const a = entries[i], b = entries[i + 1];
          if (typeof a.bankBalance === "number" && typeof b.bankBalance === "number") {
            const aDr = a.type === "expense" ? a.amount : 0;
            const aCr = a.type === "income" ? a.amount : 0;
            if (Math.abs((a.bankBalance + aDr - aCr) - b.bankBalance) < 0.05) revBalMatches++;
            const bDr = b.type === "expense" ? b.amount : 0;
            const bCr = b.type === "income" ? b.amount : 0;
            if (Math.abs((a.bankBalance - bDr + bCr) - b.bankBalance) < 0.05) fwdBalMatches++;
          }
        }
        if (revBalMatches > fwdBalMatches) isReverseChrono = true;
      }
    }

    if (isReverseChrono) {
      entries.reverse();
    }

    // Normalize strictly oldest -> newest with monotonic timestamps & seq within each date
    const perDateCounter = new Map();
    const aiOv = csvParsedState.aiOverrides;
    entries.forEach((e, idx) => {
      delete e._narrationClosed;
      e.seq = idx + 1;
      if (aiOv instanceof Map && aiOv.has(e.seq)) {
        const p = aiOv.get(e.seq);
        if (p.type) e.type = p.type;
        if (p.payee) e.payee = p.payee;
        if (p.category) e.category = p.category;
        if (p.costNature) e.costNature = p.costNature;
      }
      const d10 = String(e.date || "").slice(0, 10);
      const slot = perDateCounter.get(d10) || 0;
      perDateCounter.set(d10, slot + 1);
      const mins = Math.min(839, slot); // 09:00 .. 22:59 keeps chronological intra-day sort
      const hh = String(9 + Math.floor(mins / 60)).padStart(2, "0");
      const mm = String(mins % 60).padStart(2, "0");
      e.date = `${d10}T${hh}:${mm}`;
    });

    let openingBalance = null;
    if (csvParsedState.meta?.summaries?.length) {
      const sums = csvParsedState.meta.summaries;
      if (sums.length > 1) {
        openingBalance = sums[sums.length - 1].bf;
      } else {
        openingBalance = sums[0].bf;
      }
    } else if (entries.length) {
      const firstChrono = entries[0];
      if (typeof firstChrono.bankBalance === "number") {
        const dr = firstChrono.type === "expense" ? firstChrono.amount : 0;
        const cr = firstChrono.type === "income" ? firstChrono.amount : 0;
        openingBalance = Math.round((firstChrono.bankBalance + dr - cr) * 100) / 100;
      }
    }

    return { entries, openingBalance, isReverseChrono };
  }

  function normDupNarration(txt) {
    return unwrapBankText(txt || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function buildDupKeys(entry) {
    const acc = String(entry.accountId || "");
    const d10 = String(entry.date || "").slice(0, 10);
    const typ = String(entry.type || "");
    const amt = Number(entry.amount || 0).toFixed(2);
    const nar = normDupNarration(entry.rawNarration || entry.notes || "");
    const pay = String(entry.payee || "").toLowerCase().trim();
    const keys = [];
    if (nar && !/^imported from bank statement$/.test(nar)) {
      keys.push(`${acc}|${d10}|${typ}|${amt}|nar:${nar}`);
    }
    if (typeof entry.bankBalance === "number" && !isNaN(entry.bankBalance)) {
      keys.push(`${acc}|${d10}|${typ}|${amt}|bal:${Number(entry.bankBalance).toFixed(2)}`);
    }
    keys.push(`${acc}|${d10}|${typ}|${amt}|pay:${pay}`);
    return keys;
  }

  function isEntryDuplicate(entry, existingRefSet, existingSigCounts, seenInBatchCounts) {
    const acc = String(entry.accountId || "");
    if (entry.refId && existingRefSet.has(`${acc}|${entry.type}|${String(entry.refId).toLowerCase()}`)) return true;
    if (entry.refId && existingRefSet.has(`${entry.type}|${String(entry.refId).toLowerCase()}`)) return true;

    const keys = buildDupKeys(entry);
    let isDupe = false;
    for (const sig of keys) {
      const seenBatch = seenInBatchCounts.get(sig) || 0;
      const existingCount = existingSigCounts.get(sig) || 0;
      if (existingCount > 0 && seenBatch < existingCount) {
        isDupe = true;
      }
    }
    for (const sig of keys) {
      seenInBatchCounts.set(sig, (seenInBatchCounts.get(sig) || 0) + 1);
    }
    return isDupe;
  }

  function buildExistingDuplicateIndex() {
    const existingRefSet = new Set();
    const existingSigCounts = new Map();
    for (const t of state.transactions || []) {
      const acc = String(t.accountId || "");
      if (t.refId) {
        existingRefSet.add(`${acc}|${t.type}|${String(t.refId).toLowerCase()}`);
        existingRefSet.add(`${t.type}|${String(t.refId).toLowerCase()}`);
      }
      for (const sig of buildDupKeys(t)) {
        existingSigCounts.set(sig, (existingSigCounts.get(sig) || 0) + 1);
      }
    }
    return { existingRefSet, existingSigCounts };
  }

  function refreshCSVPreview() {
    if (!csvParsedState) return;
    const skipDupes = document.getElementById("csv-skip-dupes").checked;
    const { entries, openingBalance } = buildStatementEntriesFromState();
    const { existingRefSet, existingSigCounts } = buildExistingDuplicateIndex();
    const seenBatch = new Map();

    let readyCount = 0, dupeCount = 0, totalDebit = 0, totalCredit = 0, drCnt = 0, crCnt = 0;
    const previewHtml = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.type === "expense") { drCnt++; totalDebit += e.amount; }
      else { crCnt++; totalCredit += e.amount; }
      const dupe = isEntryDuplicate(e, existingRefSet, existingSigCounts, seenBatch);
      if (dupe && skipDupes) dupeCount++;
      else readyCount++;

      if (previewHtml.length < 25) {
        const cat = getCat(e.category);
        const nature = e.type === "expense" ? resolveCostNature(e) : "";
        previewHtml.push(`<tr>
          <td class="text-sm">${fmtShortDate(e.date)}</td>
          <td><strong>${esc(e.payee)}</strong><div class="text-xs muted">${esc(e.method)}${e.refId ? ` &bull; ${esc(e.refId)}` : ""}</div></td>
          <td>${cat.icon} ${esc(cat.name)}</td>
          <td>${nature ? `<span class="badge ${nature === "fixed" ? "cost-pill-fixed" : "cost-pill-variable"}">${nature}</span>` : `<span class="delta-pill delta-up">Credit</span>`}</td>
          <td class="text-right money-val ${e.type === "income" ? "amount-income" : ""}">${e.type === "income" ? "+" : "-"}${fmtMoney(e.amount)}</td>
          <td>${dupe ? `<span class="delta-pill delta-down">Duplicate</span>` : `<span class="delta-pill delta-up">Ready</span>`}</td>
        </tr>`);
      }
    }

    const openLbl = document.getElementById("csv-sync-opening-label");
    if (openLbl) {
      openLbl.textContent = openingBalance !== null
        ? `Set account opening balance to ${fmtMoney(openingBalance)}`
        : "Sync account opening balance from statement";
    }

    let auditBadge = "";
    const sums = csvParsedState.meta?.summaries || [];
    if (sums.length) {
      const expDr = sums.reduce((s, x) => s + x.drCount, 0);
      const expCr = sums.reduce((s, x) => s + x.crCount, 0);
      const expDeb = sums.reduce((s, x) => s + x.totalDebits, 0);
      const expCred = sums.reduce((s, x) => s + x.totalCredits, 0);
      const ok = drCnt === expDr && crCnt === expCr && Math.abs(totalDebit - expDeb) < 0.05 && Math.abs(totalCredit - expCred) < 0.05;
      auditBadge = ok
        ? `<span class="delta-pill delta-up">100% Bank Reconciled (${drCnt} Dr / ${crCnt} Cr) ✓</span>`
        : `<span class="delta-pill delta-down">Check: Bank ${expDr} Dr/${expCr} Cr vs Parsed ${drCnt} Dr/${crCnt} Cr</span>`;
    }

    document.getElementById("csv-preview-table").innerHTML = `
      <thead><tr><th>Date</th><th>Extracted Payee</th><th>Auto Category</th><th>Nature</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
      <tbody>${previewHtml.join("") || `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px;">No valid transaction rows matched these columns. Check Date Format or Header Row.</td></tr>`}</tbody>`;
    document.getElementById("csv-summary-text").innerHTML =
      `Found <strong>${entries.length}</strong> entries (${readyCount} new, ${dupeCount} duplicate) &bull; Debits: <strong>${fmtMoney(totalDebit)}</strong> &bull; Credits: <strong class="amount-income">${fmtMoney(totalCredit)}</strong> ${auditBadge}`;
  }

  async function confirmStatementImport() {
    if (!csvParsedState) return;
    if (!(await verifyMandatoryOnlineGate("Internet connection is required to verify and import statement entries."))) {
      return toast("Internet connection required before importing entries.");
    }
    const skipDupes = document.getElementById("csv-skip-dupes").checked;
    const syncOpening = document.getElementById("csv-sync-opening")?.checked;
    const accId = document.getElementById("csv-target-account").value;
    showPdfProgress("📥 Entering Statement Transactions...", "Preparing duplicate index & ledger matching...", {
      percent: 10,
      stats: "Initializing..."
    });

    try {
      await yieldToUi();
      const { entries, openingBalance } = buildStatementEntriesFromState();
      const { existingRefSet, existingSigCounts } = buildExistingDuplicateIndex();
      const ledgerCache = buildLedgerMatchCache();
      const seenBatch = new Map();

      const hadExistingTx = (state.transactions || []).some((t) => t.accountId === accId);
      const targetAcc = (state.accounts || []).find((a) => a.id === accId);
      const prevInitBal = targetAcc ? (Number(targetAcc.initialBalance) || 0) : 0;
      const batchId = uid("imp");

      let imported = 0, skipped = 0;
      let impDebit = 0, impCredit = 0;
      const toInsert = [];
      const feedBuf = [];
      const totalEntries = entries.length;

      for (let idx = 0; idx < totalEntries; idx++) {
        const e = entries[idx];
        const dupe = isEntryDuplicate(e, existingRefSet, existingSigCounts, seenBatch);
        if (dupe && skipDupes) { skipped++; }
        else {
          e.importId = batchId;
          autoAssignLedgerForTx(e, e.notes || "", true, ledgerCache);
          if (e.type === "expense") impDebit += Number(e.amount) || 0;
          else if (e.type === "income") impCredit += Number(e.amount) || 0;
          toInsert.push(e);
          imported++;
          feedBuf.push(`${String(e.date || "").slice(0, 10)} • ${e.payee} • ${e.type === "income" ? "+" : "-"}${fmtMoney(e.amount)}`);
          if (feedBuf.length > 6) feedBuf.shift();
        }
        if (idx % 200 === 199 || idx === totalEntries - 1) {
          const pct = totalEntries ? Math.round(12 + 78 * (idx + 1) / totalEntries) : 90;
          updatePdfProgress({
            sub: `Matching duplicates & party ledgers...`,
            percent: pct,
            stats: `${idx + 1} / ${totalEntries} processed • ${imported} new, ${skipped} skipped`,
            feed: feedBuf
          });
          await yieldToUi();
        }
      }

      let earliestDate = "", latestDate = "";
      if (toInsert.length) {
        updatePdfProgress({ sub: `Saving ${toInsert.length} entry(ies) into ledger...`, percent: 94 });
        await yieldToUi();
        state.transactions = [...toInsert.slice().reverse(), ...state.transactions];
        latestDate = toInsert.reduce((mx, t) => t.date > mx ? t.date : mx, "");
        if (latestDate) selectedMonthKey = getMonthKey(latestDate);
        earliestDate = toInsert.reduce((mn, t) => !mn || t.date < mn ? t.date : mn, "");
        if (earliestDate && latestDate) {
          customPeriodStart = earliestDate.slice(0, 10);
          customPeriodEnd = latestDate.slice(0, 10);
        }
      }

      if (syncOpening && targetAcc) {
        let bestTx = null;
        for (const t of [...(state.transactions || []), ...entries]) {
          if (t.accountId !== accId || typeof t.bankBalance !== "number") continue;
          if (!bestTx || t.date > bestTx.date || (t.date === bestTx.date && (t.seq || 0) > (bestTx.seq || 0))) {
            bestTx = t;
          }
        }
        if (bestTx) {
          let netTx = 0;
          for (const t of state.transactions || []) {
            const v = convertToBase(t.amount, t.currency);
            if (t.type === "income" && t.accountId === accId) netTx += v;
            else if (t.type === "expense" && t.accountId === accId) netTx -= v;
            else if (t.type === "transfer") {
              if (t.accountId === accId) netTx -= v;
              if (t.toAccountId === accId) netTx += v;
            }
          }
          targetAcc.initialBalance = Math.round((bestTx.bankBalance - netTx) * 100) / 100;
        } else if (openingBalance !== null && !hadExistingTx) {
          targetAcc.initialBalance = openingBalance;
        }
      }

      if (imported > 0) {
        if (!Array.isArray(state.importLogs)) state.importLogs = [];
        state.importLogs.unshift({
          id: batchId,
          fileName: csvParsedState.meta?.fileName || csvParsedState.meta?.bank || "Bank Statement",
          format: csvParsedState.meta?.format || "",
          bankMeta: csvParsedState.meta?.bank || "",
          accountId: accId,
          accountName: targetAcc ? formatAccountLabel(targetAcc) : "Account",
          importedAt: new Date().toISOString(),
          importedCount: imported,
          skippedDupes: skipped,
          totalDebit: Math.round(impDebit * 100) / 100,
          totalCredit: Math.round(impCredit * 100) / 100,
          dateFrom: earliestDate ? earliestDate.slice(0, 10) : "",
          dateTo: latestDate ? latestDate.slice(0, 10) : "",
          balanceSynced: !!syncOpening,
          prevInitialBalance: prevInitBal,
          newInitialBalance: targetAcc ? targetAcc.initialBalance : prevInitBal
        });
      }

      if (toInsert.length || syncOpening) {
        updatePdfProgress({ sub: "Persisting vault snapshot...", percent: 98 });
        await saveState();
      }
      closeModal("csv-modal");
      if (imported > 0) {
        selectedLedgerId = "bank_all";
        ledgerAccountFilter = accId || "all";
      }
      switchView(imported > 0 ? "ledgers" : currentView);
      toast(`Auto-entered ${imported} bank entry(ies)${skipped ? `, skipped ${skipped} already-fed overlap(s)` : ""}.`);
    } finally {
      hidePdfProgress();
    }
  }

  /* ---------- Local PDF + Unstructured / Upside-Down Statement Engine ---------- */
  function parseJsPdfCMap(text) {
    const map = {};
    let keyHexLen = 0;
    const hexToUtf16 = (hx) => {
      const h = hx.length % 2 === 1 ? "0" + hx : hx;
      const bytes = new Uint8Array(h.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16) || 0;
      if (bytes.length >= 2 && bytes.length % 2 === 0) {
        let s = "";
        for (let i = 0; i < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return s;
      }
      return String.fromCharCode(...bytes);
    };
    for (const m of text.matchAll(/beginbfchar\s+([\s\S]*?)\s+endbfchar/g)) {
      for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const src = p[1].toUpperCase();
        if (src.length > keyHexLen) keyHexLen = src.length;
        map[src] = hexToUtf16(p[2]);
      }
    }
    for (const m of text.matchAll(/beginbfrange\s+([\s\S]*?)\s+endbfrange/g)) {
      for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const w = r[1].length;
        if (w > keyHexLen) keyHexLen = w;
        const sCode = parseInt(r[1], 16), eCode = parseInt(r[2], 16), dCode = parseInt(r[3], 16);
        if (!isNaN(sCode) && !isNaN(eCode) && !isNaN(dCode) && eCode >= sCode && (eCode - sCode) <= 4096) {
          for (let c = sCode; c <= eCode; c++) {
            map[c.toString(16).toUpperCase().padStart(w, "0")] = String.fromCodePoint(dCode + (c - sCode));
          }
        }
      }
    }
    return { map, keyHexLen };
  }

  async function extractPdfReadableText(arrayBuffer) {
    try {
      const bytes = new Uint8Array(arrayBuffer);
      const latin = new TextDecoder("latin1").decode(bytes);
      const streams = [latin];

      if (typeof DecompressionStream === "function") {
        let pos = 0;
        while (pos < latin.length) {
          const sIdx = latin.indexOf("stream", pos);
          if (sIdx < 0) break;
          let dStart = sIdx + 6;
          if (latin[dStart] === "\r") dStart++;
          if (latin[dStart] === "\n") dStart++;
          const eIdx = latin.indexOf("endstream", dStart);
          if (eIdx < 0) break;
          let dEnd = eIdx;
          if (dEnd > dStart && bytes[dEnd - 1] === 10) dEnd--;
          if (dEnd > dStart && bytes[dEnd - 1] === 13) dEnd--;
          if (dEnd > dStart + 4 && (bytes[dStart] & 0x0F) === 8) {
            const slice = bytes.slice(dStart, dEnd);
            for (const fmt of ["deflate", "deflate-raw"]) {
              try {
                const ds = new DecompressionStream(fmt);
                const writer = ds.writable.getWriter();
                writer.write(slice);
                writer.close();
                const decBuf = await new Response(ds.readable).arrayBuffer();
                if (decBuf.byteLength > 0) {
                  streams.push(new TextDecoder("latin1").decode(new Uint8Array(decBuf)));
                  break;
                }
              } catch (_) {}
            }
          }
          pos = eIdx + 9;
        }
      }

      const globalCMap = { map: {}, keyHexLen: 0 };
      for (const st of streams) {
        if (st.includes("beginbfchar") || st.includes("beginbfrange")) {
          const cm = parseJsPdfCMap(st);
          if (cm.keyHexLen > globalCMap.keyHexLen) globalCMap.keyHexLen = cm.keyHexLen;
          Object.assign(globalCMap.map, cm.map);
        }
      }
      const hasCMap = Object.keys(globalCMap.map).length > 0;

      const decodeHex = (hexRaw) => {
        const hex = hexRaw.replace(/\s+/g, "").toUpperCase();
        if (!hex) return "";
        if (hasCMap) {
          const step = globalCMap.keyHexLen >= 4 && hex.length % 4 === 0 ? 4 : 2;
          let out = "", hits = 0;
          for (let i = 0; i + step <= hex.length; i += step) {
            const k = hex.slice(i, i + step);
            if (globalCMap.map[k] !== undefined) { out += globalCMap.map[k]; hits++; }
            else {
              const cp = parseInt(k, 16);
              if (cp >= 32 && cp < 0xD800) out += String.fromCharCode(cp);
            }
          }
          if (hits > 0) return out;
        }
        let s = "";
        for (let i = 0; i + 1 < hex.length; i += 2) {
          const cp = parseInt(hex.slice(i, i + 2), 16);
          if (cp >= 32) s += String.fromCharCode(cp);
        }
        return s;
      };

      const chunks = [];
      for (const st of streams) {
        if (st.includes("beginbfchar") || st.includes("beginbfrange")) continue;
        if (!/\b(BT|Tj|TJ)\b/.test(st)) continue;
        let curLine = "";
        const opRe = /(\((?:[^()\\]|\\.)*\)|<([0-9A-Fa-f\s]+)>)\s*(Tj|'|")|\[((?:[^\[\]]|\([^)]*\))*)\]\s*TJ|\b(Td|TD|Tm|T\*|ET)\b/g;
        let m;
        while ((m = opRe.exec(st)) !== null) {
          if (m[3]) {
            const txt = m[2] ? decodeHex(m[2]) : m[1].slice(1, -1).replace(/\\([()\\])/g, "$1").replace(/\\n/g, " ");
            curLine += (curLine && !curLine.endsWith(" ") ? " " : "") + txt;
          } else if (m[4]) {
            const items = m[4].match(/\((?:[^()\\]|\\.)*\)|<([0-9A-Fa-f\s]+)>|-?\d+(?:\.\d+)?/g) || [];
            let piece = "";
            for (const it of items) {
              if (it.startsWith("(")) piece += it.slice(1, -1).replace(/\\([()\\])/g, "$1");
              else if (it.startsWith("<")) piece += decodeHex(it.slice(1, -1));
              else {
                const k = Number(it);
                if (k < -1200) piece += " | ";
                else if (k < -140 && piece && !piece.endsWith(" ")) piece += " ";
              }
            }
            curLine += (curLine && !curLine.endsWith(" ") ? " " : "") + piece;
          } else if (m[5]) {
            if (curLine.trim()) chunks.push(curLine.trim());
            curLine = "";
          }
        }
        if (curLine.trim()) chunks.push(curLine.trim());
      }
      const combined = chunks.join("\n").trim();
      return combined.length >= 20 ? combined : "";
    } catch (_) {
      return "";
    }
  }

  function parseUnstructuredStatementText(rawText) {
    const rawLines = String(rawText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) return [];

    // 1. Check if delimited tabular (CSV/TSV/Pipe)
    const pipeOrTab = rawLines.filter((l) => l.includes("|") || l.includes("\t")).length;
    if (pipeOrTab >= Math.max(2, Math.floor(rawLines.length * 0.4))) {
      const sep = rawLines.some((l) => l.includes("\t")) ? "\t" : "|";
      const tabRows = rawLines.map((l) => l.split(sep).map((c) => c.trim()));
      const hIdx = detectHeaderRowIndex(tabRows);
      if (hIdx >= 0) return tabRows;
    }

    // 2. Group multi-line OCR/PDF entries starting with optional Sr.No + Date token
    const dateTokenSrc = String.raw`(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\s\-][A-Za-z]{3,9},?[\s\-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})`;
    const dateStartRe = new RegExp(String.raw`^(?:\d{1,4}[\s|]+)?` + dateTokenSrc + String.raw`\b`);
    const secondDateRe = new RegExp(String.raw`^(?:[\s|]+)` + dateTokenSrc + String.raw`\b`);
    const amtTokenRe = /(?:₹|INR|Rs\.?\s*)?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*\(?(?:CR|DR)\.?\)?)?/gi;
    const grouped = [];
    for (const ln of rawLines) {
      if (/^(page\s*(no|\d+\s+of)|account statement|statement period|computer generated|branch details|customer details|abbreviations|brought forward|opening balance|closing balance)/i.test(ln)) continue;
      if (dateStartRe.test(ln)) grouped.push(ln);
      else if (grouped.length && !/^(total|grand total|statement summary)/i.test(ln)) grouped[grouped.length - 1] += " " + ln;
    }

    const parsedDrafts = [];
    for (const block of grouped) {
      const dm = block.match(dateStartRe);
      if (!dm) continue;
      const dateStr = dm[1];
      let rest = block.slice(dm[0].length);
      const dm2 = rest.match(secondDateRe);
      if (dm2) rest = rest.slice(dm2[0].length);
      rest = rest.trim();

      const amts = rest.match(amtTokenRe) || [];
      let txAmtStr = "", balStr = "", balNum = null;
      if (amts.length >= 1) {
        const cleanAmts = amts.map((a) => a.trim());
        const balIdx = cleanAmts.findIndex((a) => /\b(CR|DR)\.?\s*$/i.test(a));
        if (balIdx >= 0) {
          balStr = cleanAmts[balIdx];
          cleanAmts.splice(balIdx, 1);
        } else if (cleanAmts.length >= 2) {
          balStr = cleanAmts.pop();
        }
        txAmtStr = (cleanAmts.pop() || "").trim();
        if (balStr) balNum = parseAmountNumber(balStr);
      }
      const txNum = txAmtStr ? Math.abs(parseAmountNumber(txAmtStr)) : 0;
      const nar = rest.replace(amtTokenRe, " ").replace(/\|/g, " ").replace(/\s+/g, " ").trim() || "Statement Entry";
      if (txNum > 0) parsedDrafts.push({ dateStr, nar, txAmtStr, txNum, balStr, balNum, rest });
    }

    // Use running balance delta across rows when available to disambiguate Debit vs Credit
    const out = [["Date", "Narration", "Debit", "Credit", "Balance"]];
    for (let i = 0; i < parsedDrafts.length; i++) {
      const cur = parsedDrafts[i];
      let side = "";
      if (i > 0 && typeof cur.balNum === "number" && typeof parsedDrafts[i - 1].balNum === "number") {
        const diff = cur.balNum - parsedDrafts[i - 1].balNum;
        if (Math.abs(Math.abs(diff) - cur.txNum) < 0.05) {
          side = diff >= 0 ? "cr" : "dr";
        }
      }
      if (!side && i + 1 < parsedDrafts.length && typeof cur.balNum === "number" && typeof parsedDrafts[i + 1].balNum === "number") {
        // Check reverse-chrono neighbor too
        const diffRev = cur.balNum - parsedDrafts[i + 1].balNum;
        if (Math.abs(Math.abs(diffRev) - cur.txNum) < 0.05) {
          side = diffRev >= 0 ? "cr" : "dr";
        }
      }
      if (!side) {
        const hintStr = cur.rest + " " + cur.txAmtStr;
        const isCrHint = /\b(cr|credit|deposit|upi\/cr|dep\b|interest|int\.pd|closure proceeds|o\/w clearing|refund|salary|by transfer)\b/i.test(hintStr);
        const isDrHint = /\b(dr|debit|withdrawal|upi\/dr|wdl\b|chrg|razorpay|payu|ccpmt|to transfer|atm)\b/i.test(hintStr);
        side = (isCrHint && !isDrHint) ? "cr" : "dr";
      }
      const cleanAmt = cur.txAmtStr.replace(/\s*(CR|DR)\.?\s*$/i, "").replace(/^[₹INRrs.\s]+/i, "").trim();
      out.push([cur.dateStr, cur.nar, side === "dr" ? cleanAmt : "", side === "cr" ? cleanAmt : "", cur.balStr]);
    }
    return out.length > 1 ? out : [];
  }

  async function extractStatementViaOcrAi({ rawText = "", rows = null, dataUrl = "", mimeType = "", fileName = "" }) {
    const aiCfg = state.settings.aiConfig || {};
    const prov = aiCfg.provider || "none";
    const textInput = rawText || (Array.isArray(rows) ? rows.map((r) => (r || []).filter(Boolean).join(" | ")).join("\n") : "");

    // Fallback cleanly to offline smart OCR parser if no external AI provider is configured
    if (!prov || prov === "none") {
      const offline = parseUnstructuredStatementText(textInput);
      if (offline.length > 1) return { rows: offline, viaOcr: true };
      throw new Error("Configure Gemini or OpenAI in Settings -> AI to OCR PDFs/images, or paste readable transaction lines.");
    }

    const ocrPrompt =
      "You are LedgerFlow's Bank Statement OCR & Format Normalizer.\n" +
      "Step 1: Read ALL text / columns / table entries carefully (first perform accurate OCR/transcription, ignoring repeated page headers like 'Page No', branch headers, and legal footers).\n" +
      "Step 2: Understand ANY bank format even if upside-down (newest-first, reverse-chronological), merged multi-line narrations, non-standard headers, or CR/DR suffixes.\n" +
      "Step 3: Return ONLY a valid JSON array of transaction objects ordered cleanly with fields:\n" +
      "[{\"date\":\"YYYY-MM-DD\",\"narration\":\"full original narration/particulars\",\"refNo\":\"optional utr/cheque\",\"debit\":0,\"credit\":0,\"balance\":\"optional numeric or CR/DR string\"}]\n" +
      "- Put positive number in debit for outflows/withdrawals and credit for inflows/deposits (never both non-zero).\n" +
      "- Preserve exact original narration text so duplicate detection remains accurate.\n" +
      "Return ONLY raw JSON array, zero prose or markdown.";

    let textOut = "";
    const isMedia = Boolean(dataUrl && (mimeType.startsWith("image/") || mimeType === "application/pdf"));
    const b64Payload = isMedia && dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;

    if (prov === "gemini") {
      const parts = [];
      if (isMedia) {
        parts.push({ inlineData: { mimeType: mimeType || "application/pdf", data: b64Payload } });
        parts.push({ text: `Extract bank statement from file "${fileName}" following instructions.` });
      } else {
        parts.push({ text: `RAW STATEMENT TEXT (${fileName || "pasted"}):\n\n${textInput.slice(0, 65000)}` });
      }
      const gRes = await callGeminiWithFallback({
        systemInstruction: { parts: [{ text: ocrPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.05, responseMimeType: "application/json" }
      }, aiCfg);
      textOut = gRes.text;
    } else if (prov === "openai") {
      if (!aiCfg.apiKey && !aiCfg.endpoint) throw new Error("OpenAI API key is missing in Settings.");
      const model = aiCfg.model || "gpt-4o-mini";
      const url = aiCfg.endpoint || "https://api.openai.com/v1/chat/completions";
      const hdrs = aiCfg.apiKey ? { Authorization: "Bearer " + aiCfg.apiKey } : {};
      const userContent = isMedia && mimeType.startsWith("image/")
        ? [
            { type: "text", text: `OCR and extract bank statement entries from "${fileName}".` },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        : `RAW STATEMENT TEXT (${fileName || "pasted"}):\n\n${textInput.slice(0, 55000)}`;
      const json = await aiNativePost(url, hdrs, {
        model,
        temperature: 0.05,
        messages: [
          { role: "system", content: ocrPrompt },
          { role: "user", content: userContent }
        ]
      });
      textOut = json?.choices?.[0]?.message?.content || "";
    } else if (prov === "ollama") {
      const model = aiCfg.model || "llama3.2";
      const url = aiCfg.endpoint || "http://localhost:11434/api/chat";
      const json = await aiNativePost(url, {}, {
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: ocrPrompt },
          { role: "user", content: textInput.slice(0, 45000) }
        ]
      });
      textOut = json?.message?.content || "";
    }

    const arr = extractJsonArrayFromLlmText(textOut);
    if (!Array.isArray(arr) || !arr.length) {
      const fallback = parseUnstructuredStatementText(textInput);
      if (fallback.length > 1) return { rows: fallback, viaOcr: true };
      throw new Error("OCR/AI could not extract transaction rows from this document.");
    }
    const normalized = [["Txn Date", "Narration", "Ref No", "Withdrawal", "Deposit", "Balance"]];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      normalized.push([
        String(item.date || ""),
        String(item.narration || item.details || item.particulars || "Bank Entry"),
        String(item.refNo || item.ref || ""),
        Number(item.debit || item.withdrawal || 0) > 0 ? String(item.debit || item.withdrawal) : "",
        Number(item.credit || item.deposit || 0) > 0 ? String(item.credit || item.deposit) : "",
        item.balance !== undefined && item.balance !== null ? String(item.balance) : ""
      ]);
    }
    return { rows: normalized, viaOcr: true };
  }

  async function handleUploadedStatementFile(file, passwordOverride = null, exportOnly = false) {
    if (!file) return;
    if (!(await verifyMandatoryOnlineGate("Internet connection is required to intelligently read PDFs and bank statements."))) {
      return toast("Internet connection required to read statements.");
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const mime = (file.type || "").toLowerCase();
    const pwBox = document.getElementById("stmt-password-box");
    const pwInput = document.getElementById("stmt-file-password");
    const protChk = document.getElementById("csv-is-protected");
    const chosenPw = passwordOverride !== null ? passwordOverride : (pwInput.value || "");

    const readAsDataUrl = (f) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("File read failed"));
      r.readAsDataURL(f);
    });

    // 1. Images -> OCR + AI Extraction; PDFs -> Local Parser first (zero API required)
    const isImage = mime.startsWith("image/") || /^(png|jpg|jpeg|webp|bmp|heic)$/i.test(ext);
    const isPdf = mime === "application/pdf" || ext === "pdf";

    if (isPdf) {
      let handedOffToModal = false;
      try {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        showPdfProgress("📄 Reading PDF Statement...", `Loading "${file.name}" (${sizeMb} MB)...`, {
          percent: 3,
          stats: "Encoding file for local parser..."
        });
        await yieldToUi();
        const dataUrl = await readAsDataUrl(file);
        pendingUploadFile = { file, dataUrl };
        if (isDesktopHost) {
          if (protChk && protChk.checked && !chosenPw) {
            hidePdfProgress();
            pwBox.classList.remove("hidden");
            document.getElementById("stmt-pw-desc").textContent = "Enter the PDF password for \"" + file.name + "\", then tap Unlock & Enter or Unlock & Export CSV.";
            setTimeout(() => pwInput.focus(), 40);
            return;
          }
          updatePdfProgress({
            phase: "indexing",
            sub: `Reading "${file.name}" (${sizeMb} MB) locally...`,
            percent: 3,
            stats: "Indexing PDF objects..."
          });
          const res = await parseStatementWithLiveProgress(
            { fileName: file.name, base64: dataUrl, password: chosenPw },
            (st) => {
              const pgTxt = st.totalPages > 0 ? `Page ${st.currentPage} / ${st.totalPages}` : (st.phase === "decoding" ? "Decoding streams..." : "Scanning PDF bytes...");
              const txTxt = st.txCount > 0 ? ` • ${st.txCount} row(s) found` : "";
              updatePdfProgress({
                phase: st.phase || "indexing",
                sub: st.stage || `Reading "${file.name}"...`,
                percent: typeof st.percent === "number" ? st.percent : 15,
                stats: `${pgTxt}${txTxt}`,
                feed: Array.isArray(st.recentTx) ? st.recentTx : undefined
              });
            }
          );
          if (res && !res.ok && res.needsPassword) {
            hidePdfProgress();
            if (protChk) protChk.checked = true;
            pwBox.classList.remove("hidden");
            document.getElementById("stmt-pw-desc").textContent = chosenPw
              ? "Incorrect PDF password. Check and re-enter the password for \"" + file.name + "\"."
              : "This PDF file is password-protected. Enter the PDF password below:";
            pwInput.select();
            pwInput.focus();
            return;
          }
          if (res && res.ok && Array.isArray(res.rows) && res.rows.length > 0) {
            const totalRows = res.rows.length;
            updatePdfProgress({
              sub: "Categorizing & preparing extracted transactions...",
              percent: 96,
              stats: `${totalRows} row(s) extracted • Rendering table...`
            });
            await yieldToUi();
            hidePdfProgress();
            handedOffToModal = true;
            pwBox.classList.add("hidden");
            const doExport = exportOnly || pendingExportOnly;
            pendingExportOnly = false;
            const parsedRows = res.rows;
            const meta = extractBankMeta(parsedRows);
            meta.fileName = file.name;
            meta.format = res.format || "pdf";
            if (detectHeaderRowIndex(parsedRows) >= 0) {
              loadRowsIntoStatementModal(parsedRows, meta, doExport);
              return;
            }
            const lineParsed = parseUnstructuredStatementText(parsedRows.map((r) => (r || []).filter(Boolean).join(" | ")).join("\n"));
            if (lineParsed.length > 1) {
              loadRowsIntoStatementModal(lineParsed, meta, doExport);
              return;
            }
            loadRowsIntoStatementModal(parsedRows, meta, doExport);
            return;
          }
          if (res && res.format === "pdf-encrypted") {
            return toast(res.error || "Could not unlock this encrypted PDF.");
          }
          // If scanned PDF and external AI is configured, fall back to AI Vision/PDF OCR
          const aiCfg = state.settings.aiConfig || {};
          if (aiCfg.provider && aiCfg.provider !== "none" && aiCfg.mode !== "local") {
            updatePdfProgress({ title: "🧠 AI is Reading Scanned PDF...", sub: "Scanned PDF detected — extracting transactions via Vision AI...", percent: 45, stats: "Running Vision OCR..." });
            const ocrRes = await extractStatementViaOcrAi({ rawText: "", dataUrl, mimeType: "application/pdf", fileName: file.name });
            hidePdfProgress();
            handedOffToModal = true;
            const meta = extractBankMeta(ocrRes.rows);
            meta.viaOcr = true;
            meta.fileName = file.name;
            meta.format = "pdf-ocr";
            loadRowsIntoStatementModal(ocrRes.rows, meta, exportOnly);
            return;
          }
          return toast((res && res.error) || "Could not extract transactions from this PDF.");
        }

        // Browser preview fallback (no native host): decompress PDF locally in JS
        updatePdfProgress({ sub: `Extracting text from "${file.name}" in browser...`, percent: 35, stats: "Reading browser stream..." });
        const buf = await file.arrayBuffer();
        const rawLatin = new TextDecoder("latin1").decode(new Uint8Array(buf));
        if (/\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(rawLatin)) {
          return toast("Password-protected PDF decryption requires the installed LedgerFlow Windows or Android app.");
        }
        const localText = await extractPdfReadableText(buf);
        const offlineRows = parseUnstructuredStatementText(localText);
        if (offlineRows.length > 1) {
          hidePdfProgress();
          handedOffToModal = true;
          const meta = extractBankMeta(offlineRows);
          meta.fileName = file.name;
          meta.format = "pdf";
          loadRowsIntoStatementModal(offlineRows, meta, exportOnly);
          return;
        }
        const aiCfg = state.settings.aiConfig || {};
        if (aiCfg.provider && aiCfg.provider !== "none" && aiCfg.mode !== "local") {
          updatePdfProgress({ title: "✨ AI is Reading PDF...", sub: "Analyzing extracted text with AI...", percent: 65, stats: "AI OCR..." });
          const ocrRes = await extractStatementViaOcrAi({ rawText: localText, dataUrl, mimeType: "application/pdf", fileName: file.name });
          hidePdfProgress();
          handedOffToModal = true;
          const meta = extractBankMeta(ocrRes.rows);
          meta.viaOcr = true;
          meta.fileName = file.name;
          meta.format = "pdf-ocr";
          loadRowsIntoStatementModal(ocrRes.rows, meta, exportOnly);
          return;
        }
        return toast("No selectable text found in this PDF. Export as Excel/CSV, paste text in 'Paste / OCR Text', or use the Windows/Android LedgerFlow app.");
      } catch (err) {
        toast("PDF import error: " + err.message);
      } finally {
        if (!handedOffToModal) hidePdfProgress();
      }
      return;
    }

    if (isImage) {
      try {
        toast("🔍 Converting statement image via OCR + AI...");
        const dataUrl = await readAsDataUrl(file);
        const ocrRes = await extractStatementViaOcrAi({
          rawText: "",
          dataUrl,
          mimeType: mime || "image/png",
          fileName: file.name
        });
        const meta = extractBankMeta(ocrRes.rows);
        meta.viaOcr = true;
        meta.fileName = file.name;
        meta.format = ext || "image";
        loadRowsIntoStatementModal(ocrRes.rows, meta, exportOnly);
      } catch (err) {
        toast("Image OCR extraction: " + err.message);
      }
      return;
    }

    if (isDesktopHost) {
      let handedOffToModal = false;
      try {
        const dataUrl = await readAsDataUrl(file);
        pendingUploadFile = { file, dataUrl };
        if (protChk && protChk.checked && !chosenPw) {
          pwBox.classList.remove("hidden");
          document.getElementById("stmt-pw-desc").textContent = "Enter the password for \"" + file.name + "\", then tap Unlock & Enter or Unlock & Export CSV.";
          setTimeout(() => pwInput.focus(), 40);
          return;
        }
        showPdfProgress("📊 Reading Excel / Spreadsheet...", `Parsing "${file.name}"...`, { percent: 25, stats: "Decoding workbook..." });
        const res = await parseStatementWithLiveProgress(
          { fileName: file.name, base64: dataUrl, password: chosenPw },
          (st) => updatePdfProgress({ sub: st.stage || `Reading "${file.name}"...`, percent: typeof st.percent === "number" ? st.percent : 50 })
        );
        if (!res.ok) {
          if (res.needsPassword) {
            hidePdfProgress();
            if (protChk) protChk.checked = true;
            pwBox.classList.remove("hidden");
            document.getElementById("stmt-pw-desc").textContent = chosenPw
              ? "Incorrect password. Check and re-enter the Excel password for \"" + file.name + "\"."
              : "This Excel file is password-protected. Enter the password below:";
            pwInput.select();
            pwInput.focus();
            return;
          }
          return toast(res.error || "Could not parse bank statement.");
        }
        pwBox.classList.add("hidden");
        const parsedRows = res.rows || [];
        const doExport = exportOnly || pendingExportOnly;
        pendingExportOnly = false;

        // If header/columns didn't parse directly (non-standard layout), auto-run OCR/AI format normalization
        const hIdx = detectHeaderRowIndex(parsedRows);
        if (parsedRows.length >= 2 && hIdx < 0) {
          try {
            updatePdfProgress({ title: "🧠 Normalizing Non-Standard Format...", sub: "Analyzing layout with AI...", percent: 70 });
            const ocrRes = await extractStatementViaOcrAi({ rows: parsedRows, fileName: file.name });
            hidePdfProgress();
            handedOffToModal = true;
            const oMeta = extractBankMeta(parsedRows);
            oMeta.viaOcr = true;
            oMeta.fileName = file.name;
            oMeta.format = res.format || ext;
            loadRowsIntoStatementModal(ocrRes.rows, oMeta, doExport);
            return;
          } catch (_) {}
        }

        hidePdfProgress();
        handedOffToModal = true;
        const meta = extractBankMeta(parsedRows);
        meta.fileName = file.name;
        meta.format = res.format || ext;
        loadRowsIntoStatementModal(parsedRows, meta, doExport);
      } catch (err) {
        toast("Upload failed: " + err.message);
      } finally {
        if (!handedOffToModal) hidePdfProgress();
      }
    } else {
      if (ext === "xlsx" || ext === "xls") {
        toast("Binary Excel (.xlsx/.xls) parsing requires the LedgerFlow app. In preview mode, upload .csv.");
        return;
      }
      const r = new FileReader();
      r.onload = async () => {
        const rawStr = String(r.result || "");
        let rows = parseCSVText(rawStr);
        if (!rows || rows.length < 2 || detectHeaderRowIndex(rows) < 0) {
          try {
            const ocrRes = await extractStatementViaOcrAi({ rawText: rawStr, rows, fileName: file.name });
            const oMeta = extractBankMeta(ocrRes.rows);
            oMeta.viaOcr = true;
            oMeta.fileName = file.name;
            oMeta.format = ext || "csv";
            loadRowsIntoStatementModal(ocrRes.rows, oMeta, exportOnly);
            return;
          } catch (_) {}
        }
        const meta = extractBankMeta(rows);
        meta.fileName = file.name;
        meta.format = ext || "csv";
        loadRowsIntoStatementModal(rows, meta, exportOnly);
      };
      r.readAsText(file);
    }
  }

  async function exportTransactionsCSV(list) {
    const items = list || [];
    const showDlg = items.length > 300;
    if (showDlg) {
      showPdfProgress("📤 Generating CSV Export...", `Formatting ${items.length} transaction(s)...`, { percent: 25, stats: `0 / ${items.length}` });
      await yieldToUi();
    }
    try {
      const header = ["Date", "Type", "Payee", "Category", "Account", "Amount", "Currency", "BaseAmount", "Method", "TaxDeductible", "Tags", "Notes"];
      const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = items.map((t) => [
        t.date, t.type, t.payee, getCat(t.category).name, getAcc(t.accountId).name,
        t.amount, t.currency, txBaseAmount(t).toFixed(2), t.method || "", t.taxDeductible ? "Yes" : "No",
        (t.tags || []).join(";"), t.notes || ""
      ].map(escCsv).join(","));
      if (showDlg) updatePdfProgress({ sub: "Writing CSV file...", percent: 95, stats: `${items.length} / ${items.length}` });
      downloadFile(`ledgerflow-transactions-${todayISO()}.csv`, "\uFEFF" + [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8;");
      toast("CSV exported.");
    } finally {
      if (showDlg) hidePdfProgress();
    }
  }

  function downloadFile(filename, content, mime) {
    if (window.LedgerFlowAndroid && typeof window.LedgerFlowAndroid.saveExportFile === "function") {
      try {
        window.LedgerFlowAndroid.saveExportFile(filename, mime || "application/octet-stream", content);
        return;
      } catch (_) {}
    }
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- Command Palette (Ctrl+K) ---------- */
  function openCommandPalette() {
    const modal = document.getElementById("cmd-modal");
    const input = document.getElementById("cmd-input");
    modal.classList.remove("hidden");
    input.value = "";
    renderCmdResults("");
    setTimeout(() => input.focus(), 20);
  }

  function renderCmdResults(query) {
    const q = query.trim().toLowerCase();
    const commands = [
      { label: "New Expense / Transaction", hint: "Shortcut: N", fn: () => openTxModal() },
      { label: "Toggle Dark / Light Theme", hint: "Shortcut: T", fn: () => toggleTheme() },
      { label: "Toggle Privacy Blur Mode", hint: "Shortcut: P", fn: () => togglePrivacyMode() },
      { label: "Import Bank Excel / CSV Statement", hint: "Importer", fn: () => openStatementModal() },
      { label: "Go to Overview Dashboard", hint: "View", fn: () => switchView("overview") },
      { label: "Go to Bank & Party Ledgers (Dr/Cr)", hint: "View", fn: () => switchView("ledgers") },
      { label: "Go to Monthly Intelligence (Fixed/Variable, Petty/Big, Trends)", hint: "View", fn: () => switchView("monthly") },
      { label: "Go to Transactions Ledger", hint: "View", fn: () => switchView("transactions") },
      { label: "Go to Budgets", hint: "View", fn: () => switchView("budgets") },
      { label: "Go to Subscriptions & Bills", hint: "View", fn: () => switchView("recurring") },
      { label: "Go to Accounts & Cards", hint: "View", fn: () => switchView("accounts") },
      { label: "Go to Goals & Split IOUs", hint: "View", fn: () => switchView("goals") },
      { label: "Go to Analytics & Tax PDF", hint: "View", fn: () => switchView("analytics") },
      { label: "Go to Smart Automation Rules", hint: "View", fn: () => switchView("rules") },
      { label: "Open AI Intelligence & Financial Assistant", hint: "View", fn: () => switchView("ai") },
      { label: "Go to Import, Backup & Settings", hint: "View", fn: () => switchView("settings") }
    ].filter((c) => !q || c.label.toLowerCase().includes(q));

    const box = document.getElementById("cmd-results");
    box.innerHTML = commands.map((c, idx) => `
      <button class="cmd-item" data-cmd-idx="${idx}"><span>${esc(c.label)}</span><span class="text-xs muted">${esc(c.hint)}</span></button>
    `).join("") || `<div class="muted text-sm" style="padding:14px;">No matching actions.</div>`;

    box.querySelectorAll(".cmd-item").forEach((el) => {
      el.onclick = () => {
        closeModal("cmd-modal");
        commands[Number(el.dataset.cmdIdx)].fn();
      };
    });
  }

  /* ---------- Theme, Privacy & PIN ---------- */
  function applyTheme() {
    const theme = state.settings.theme || "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("sun-icon").classList.toggle("hidden", theme === "light");
    document.getElementById("moon-icon").classList.toggle("hidden", theme === "dark");
    const metaTheme = document.getElementById("meta-theme-color");
    if (metaTheme) metaTheme.setAttribute("content", theme === "dark" ? "#121824" : "#ffffff");
    if (window.LedgerFlowAndroid && typeof window.LedgerFlowAndroid.setStatusBarTheme === "function") {
      try { window.LedgerFlowAndroid.setStatusBarTheme(theme); } catch (_) {}
    }
  }

  function toggleTheme() {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    applyTheme(); saveState();
  }

  function applyPrivacyMode() {
    const on = !!state.settings.privacyMode;
    document.body.classList.toggle("privacy-mode", on);
    document.getElementById("eye-open-icon").classList.toggle("hidden", on);
    document.getElementById("eye-closed-icon").classList.toggle("hidden", !on);
  }

  function togglePrivacyMode() {
    state.settings.privacyMode = !state.settings.privacyMode;
    applyPrivacyMode(); saveState();
  }

  function openMobileDrawer() {
    const sb = document.getElementById("sidebar");
    const bd = document.getElementById("mobile-drawer-backdrop");
    if (sb) sb.classList.add("open");
    if (bd) bd.classList.remove("hidden");
  }

  function closeMobileDrawer() {
    const sb = document.getElementById("sidebar");
    const bd = document.getElementById("mobile-drawer-backdrop");
    if (sb) sb.classList.remove("open");
    if (bd) bd.classList.add("hidden");
  }

  /* ---------- Event Wiring & Boot ---------- */
  function wireGlobalEvents() {
    document.querySelectorAll("#nav-list .nav-item, .sidebar-footer .nav-item[data-view]").forEach((btn) => {
      btn.onclick = () => switchView(btn.dataset.view);
    });
    const sbUpdBtn = document.getElementById("sidebar-check-update-btn");
    if (sbUpdBtn) sbUpdBtn.onclick = () => { closeMobileDrawer(); openInteractiveUpdateModal(); };
    const tbUpdBtn = document.getElementById("topbar-update-btn");
    if (tbUpdBtn) tbUpdBtn.onclick = () => openInteractiveUpdateModal();
    document.querySelectorAll("#mobile-bottom-nav .mobile-nav-item[data-view]").forEach((btn) => {
      btn.onclick = () => switchView(btn.dataset.view);
    });
    const mFab = document.getElementById("mobile-fab-add");
    if (mFab) mFab.onclick = () => openTxModal();
    const mMore = document.getElementById("mobile-nav-more");
    if (mMore) mMore.onclick = () => openMobileDrawer();
    const mBack = document.getElementById("mobile-drawer-backdrop");
    if (mBack) mBack.onclick = closeMobileDrawer;

    document.getElementById("mobile-menu-btn").onclick = openMobileDrawer;
    document.getElementById("sidebar-collapse-btn").onclick = closeMobileDrawer;

    document.getElementById("global-period-select").onchange = (e) => {
      if (e.target.value === "custom") {
        openCustomRangePicker();
        return;
      }
      currentPeriod = e.target.value;
      switchView(currentView);
    };
    document.getElementById("theme-toggle-btn").onclick = toggleTheme;
    document.getElementById("privacy-toggle-btn").onclick = togglePrivacyMode;
    document.getElementById("quick-add-btn").onclick = () => openTxModal();
    document.getElementById("cmd-palette-btn").onclick = openCommandPalette;
    document.getElementById("open-csv-import-btn").onclick = () => openStatementModal();

    document.addEventListener("click", (e) => {
      const closeTarget = e.target.closest("[data-close]");
      if (closeTarget) closeModal(closeTarget.dataset.close);
      if (e.target.classList.contains("modal-backdrop")) e.target.classList.add("hidden");
    });

    // Transaction Modal Events
    document.querySelectorAll("#tx-type-tabs .seg-btn").forEach((btn) => {
      btn.onclick = () => setTxTypeTab(btn.dataset.type);
    });
    document.getElementById("tx-currency").onchange = updateFxHint;
    document.getElementById("tx-amount").oninput = () => {
      updateFxHint();
      if (!document.getElementById("split-builder").classList.contains("hidden")) renderSplitRows();
    };
    document.getElementById("toggle-split-btn").onclick = () => {
      const box = document.getElementById("split-builder");
      const opening = box.classList.contains("hidden");
      box.classList.toggle("hidden", !opening);
      if (opening && splitLinesDraft.length === 0) {
        const amt = Number(document.getElementById("tx-amount").value) || 0;
        splitLinesDraft.push({ category: document.getElementById("tx-category").value, amount: amt, note: "" });
      }
      if (!opening) splitLinesDraft = [];
      renderSplitRows();
    };
    document.getElementById("add-split-row-btn").onclick = () => {
      splitLinesDraft.push({ category: "groceries", amount: 0, note: "" });
      renderSplitRows();
    };

    document.getElementById("tx-receipt-btn").onclick = () => document.getElementById("tx-receipt-input").click();
    document.getElementById("tx-receipt-clear").onclick = () => { pendingReceiptData = null; updateReceiptLabel(); };
    document.getElementById("tx-receipt-input").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) return toast("Receipt file must be under 4 MB.");
      const reader = new FileReader();
      reader.onload = () => { pendingReceiptData = { name: f.name, dataUrl: reader.result }; updateReceiptLabel(); };
      reader.readAsDataURL(f);
    };

    document.getElementById("tx-form").onsubmit = (e) => {
      e.preventDefault();
      const id = document.getElementById("tx-id").value;
      const type = document.querySelector("#tx-type-tabs .seg-btn.active").dataset.type;
      const amount = Number(document.getElementById("tx-amount").value);
      const currency = document.getElementById("tx-currency").value;
      const costNatureSel = document.getElementById("tx-cost-nature").value;
      const ledVal = document.getElementById("tx-ledger") ? document.getElementById("tx-ledger").value : "";
      const txObj = {
        id: id || uid("tx"),
        type,
        amount,
        currency,
        baseAmount: convertToBase(amount, currency),
        date: document.getElementById("tx-date").value,
        payee: document.getElementById("tx-payee").value.trim(),
        accountId: document.getElementById("tx-account").value,
        toAccountId: type === "transfer" ? document.getElementById("tx-to-account").value : undefined,
        category: type === "transfer" ? "transfer" : document.getElementById("tx-category").value,
        method: document.getElementById("tx-method").value,
        costNature: costNatureSel === "auto" ? undefined : costNatureSel,
        ledgerId: ledVal || undefined,
        isSpecial: document.getElementById("tx-special").checked,
        tags: document.getElementById("tx-tags").value.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
        notes: document.getElementById("tx-notes").value.trim(),
        taxDeductible: document.getElementById("tx-tax-deductible").checked,
        reconciled: document.getElementById("tx-reconciled").checked,
        splits: !document.getElementById("split-builder").classList.contains("hidden") && splitLinesDraft.length ? splitLinesDraft : undefined,
        receipt: pendingReceiptData || undefined
      };
      if (!id) applyRulesToTx(txObj);
      else learnFromTransaction(txObj);
      const idx = state.transactions.findIndex((t) => t.id === txObj.id);
      if (idx >= 0) state.transactions[idx] = txObj;
      else state.transactions.unshift(txObj);
      saveState();
      closeModal("tx-modal");
      switchView(currentView);
      toast(id ? "Transaction updated." : "Transaction recorded.");
    };

    // Smart Bank Statement Importer Wiring (Excel & CSV)
    document.querySelectorAll("#csv-mode-tabs .seg-btn").forEach((btn) => {
      btn.onclick = () => setCsvModalTab(btn.dataset.csvTab);
    });
    const csvAddBank = document.getElementById("csv-add-bank-btn");
    if (csvAddBank) csvAddBank.onclick = () => {
      openAccountModal(null, (created) => {
        const sel = document.getElementById("csv-target-account");
        if (sel) {
          sel.innerHTML = (state.accounts || []).map((a) => `<option value="${a.id}">${esc(formatAccountLabel(a))}</option>`).join("");
          sel.value = created.id;
        }
      });
    };
    document.getElementById("csv-browse-btn").onclick = () => document.getElementById("csv-file-input").click();
    const pdfBtn = document.getElementById("csv-pdf-btn");
    const pdfInput = document.getElementById("csv-pdf-input");
    if (pdfBtn && pdfInput) {
      pdfBtn.onclick = () => pdfInput.click();
      pdfInput.onchange = (e) => {
        const f = e.target.files[0];
        if (f) handleUploadedStatementFile(f);
        e.target.value = "";
      };
    }
    const ocrToggleBtn = document.getElementById("csv-ocr-toggle-btn");
    if (ocrToggleBtn) {
      ocrToggleBtn.onclick = () => {
        const p = document.getElementById("csv-ocr-panel");
        if (!p) return;
        p.classList.toggle("hidden");
        if (!p.classList.contains("hidden")) {
          setTimeout(() => document.getElementById("csv-ocr-text")?.focus(), 40);
        }
      };
    }
    const ocrOfflineBtn = document.getElementById("csv-ocr-offline-btn");
    if (ocrOfflineBtn) {
      ocrOfflineBtn.onclick = () => {
        const txt = document.getElementById("csv-ocr-text")?.value || "";
        const rows = parseUnstructuredStatementText(txt);
        if (rows.length <= 1) return toast("Could not spot statement rows. Try OCR + AI Extract or paste full date/amount lines.");
        const meta = extractBankMeta(rows);
        meta.viaOcr = true;
        loadRowsIntoStatementModal(rows, meta, false);
      };
    }
    const ocrAiBtn = document.getElementById("csv-ocr-ai-btn");
    if (ocrAiBtn) {
      ocrAiBtn.onclick = async () => {
        const txt = document.getElementById("csv-ocr-text")?.value || "";
        if (!txt.trim()) return toast("Paste statement or OCR text first.");
        ocrAiBtn.disabled = true;
        ocrAiBtn.textContent = "Converting OCR...";
        try {
          const ocrRes = await extractStatementViaOcrAi({ rawText: txt, fileName: "pasted-ocr.txt" });
          const meta = extractBankMeta(ocrRes.rows);
          meta.viaOcr = true;
          loadRowsIntoStatementModal(ocrRes.rows, meta, false);
        } catch (err) {
          toast("OCR + AI error: " + err.message);
        } finally {
          ocrAiBtn.disabled = false;
          ocrAiBtn.textContent = "OCR + AI Extract & Feed";
        }
      };
    }
    document.getElementById("csv-file-input").onchange = (e) => {
      const f = e.target.files[0];
      if (f) handleUploadedStatementFile(f);
      e.target.value = "";
    };
    const dz = document.getElementById("csv-dropzone");
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("dragover"); };
    dz.ondragleave = () => dz.classList.remove("dragover");
    dz.ondrop = (e) => {
      e.preventDefault(); dz.classList.remove("dragover");
      const f = e.dataTransfer.files[0];
      if (f) handleUploadedStatementFile(f);
    };
    document.getElementById("csv-is-protected").onchange = (e) => {
      const pwBox = document.getElementById("stmt-password-box");
      pwBox.classList.toggle("hidden", !e.target.checked);
      if (e.target.checked) {
        setTimeout(() => document.getElementById("stmt-file-password").focus(), 40);
      }
    };
    document.getElementById("stmt-pw-toggle-btn").onclick = () => {
      const pwInp = document.getElementById("stmt-file-password");
      const show = pwInp.type === "password";
      pwInp.type = show ? "text" : "password";
      document.getElementById("stmt-pw-toggle-btn").textContent = show ? "Hide" : "Show";
    };
    const triggerStmtUnlock = (exportOnly) => {
      const pw = document.getElementById("stmt-file-password").value;
      if (!pendingUploadFile?.file) {
        pendingExportOnly = !!exportOnly;
        if (!pw) toast("Select your Excel or PDF file to unlock with password.");
        document.getElementById("csv-file-input").click();
        return;
      }
      if (!pw) {
        toast("Please enter the file password.");
        document.getElementById("stmt-file-password").focus();
        return;
      }
      handleUploadedStatementFile(pendingUploadFile.file, pw, exportOnly);
    };
    document.getElementById("stmt-file-password").onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); triggerStmtUnlock(false); }
    };
    document.getElementById("stmt-unlock-retry-btn").onclick = () => triggerStmtUnlock(false);
    document.getElementById("stmt-unlock-export-btn").onclick = () => triggerStmtUnlock(true);
    document.getElementById("csv-export-parsed-btn").onclick = () => {
      const { entries } = buildStatementEntriesFromState();
      if (entries.length > 0) exportTransactionsCSV(entries);
      else if (csvParsedState?.allRows?.length) exportParsedRowsCSV(csvParsedState.allRows);
    };
    document.getElementById("csv-load-sample-btn").onclick = () => {
      const sampleCsv =
        "Date,Details,Ref No/Cheque No,Debit,Credit,Balance\n" +
        "01/10/2026,DEP TFR NEFT*HDFC0000001*HDFCH01318070505*NKD ASSOCIATES,,,25000.00,27165.13\n" +
        "02/10/2026,WDL TFR UPI/DR/103585547846/BAJAJ FI/HDFC/bflautopay/UPI,000000,3749.00,,23416.13\n" +
        "03/10/2026,DEBIT ACHDr NACH00000000023239 IDFC FIRST BAN,000000,2866.00,,20550.13\n" +
        "05/10/2026,WDL TFR UPI/DR/627832564254/DINESH P/IPOS/eatndrink@/UPI,000000,60.00,,20490.13\n" +
        "06/10/2026,WDL TFR UPI/DR/622857747702/NDG MOTO/HDFC/vyapar.173/UPI,000000,15000.00,,5490.13\n";
      const rows = parseCSVText(sampleCsv);
      loadRowsIntoStatementModal(rows, { bank: "Sample SBI Statement" });
    };
    document.getElementById("csv-header-row").onchange = (e) => {
      applyHeaderRowSelection(Number(e.target.value));
      refreshCSVPreview();
    };
    document.getElementById("csv-amount-mode").onchange = () => {
      toggleAmountModeUI();
      refreshCSVPreview();
    };
    ["csv-col-date", "csv-col-payee", "csv-col-debit", "csv-col-credit", "csv-col-amount", "csv-date-format", "csv-invert-signs", "csv-skip-dupes"].forEach((id) => {
      document.getElementById(id).onchange = refreshCSVPreview;
    });
    const gemChkBtn = document.getElementById("csv-gemini-check-btn");
    if (gemChkBtn) gemChkBtn.onclick = verifyStatementWithGeminiBeforeImport;
    document.getElementById("csv-confirm-import-btn").onclick = confirmStatementImport;

    // Command Palette & Hotkeys
    document.getElementById("cmd-input").oninput = (e) => renderCmdResults(e.target.value);
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); openCommandPalette(); return;
      }
      if (e.key === "Escape") {
        ["tx-modal", "sub-modal", "csv-modal", "cmd-modal"].forEach(closeModal);
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
      if (e.key.toLowerCase() === "n") { e.preventDefault(); openTxModal(); }
      else if (e.key.toLowerCase() === "t") { toggleTheme(); }
      else if (e.key.toLowerCase() === "p") { togglePrivacyMode(); }
    });
  }

  function requestBiometricAuth() {
    return new Promise(async (resolve) => {
      if (window.LedgerFlowAndroid && typeof window.LedgerFlowAndroid.authenticateBiometric === "function") {
        let avail = true;
        try {
          if (typeof window.LedgerFlowAndroid.isBiometricAvailable === "function") {
            avail = !!window.LedgerFlowAndroid.isBiometricAvailable();
          }
        } catch (_) {}
        if (!avail) {
          resolve({ ok: false, error: "Set up Fingerprint, Face, or screen lock in Android Settings first." });
          return;
        }
        window.ledgerFlowBiometricResult = (ok, err) => {
          window.ledgerFlowBiometricResult = null;
          resolve({ ok: !!ok, error: err || "" });
        };
        try {
          window.LedgerFlowAndroid.authenticateBiometric();
        } catch (ex) {
          window.ledgerFlowBiometricResult = null;
          resolve({ ok: false, error: ex.message });
        }
        return;
      }
      if (isDesktopHost) {
        try {
          const st = await apiFetch("/api/biometric-status");
          if (!st || !st.available) {
            resolve({ ok: false, error: "Windows Hello biometrics/PIN is not configured on this PC." });
            return;
          }
          const auth = await apiFetch("/api/biometric-auth", { method: "POST", body: "{}" });
          resolve({ ok: !!(auth && auth.ok), error: auth?.error || "" });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
        return;
      }
      resolve({ ok: false, error: "Biometric unlock requires the installed LedgerFlow Windows or Android app." });
    });
  }

  function isMobileExperience() {
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    return isAndroidHost || window.innerWidth <= 820 || (coarse && window.innerWidth <= 1024);
  }

  function playLogoChime(force = false) {
    if (!force && state?.settings?.mobileSound === false) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxInstance) audioCtxInstance = new AC();
      if (audioCtxInstance.state === "suspended") {
        audioCtxInstance.resume().catch(() => {});
      }
      const ctx = audioCtxInstance;
      const now = ctx.currentTime + 0.02;
      const notes = [523.25, 659.25, 783.99, 987.77]; // C5 E5 G5 B5 luminous chime
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i === 0 ? "triangle" : "sine";
        osc.frequency.setValueAtTime(freq, now + i * 0.09);
        gain.gain.setValueAtTime(0.0001, now + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.08 / (1 + i * 0.15), now + i * 0.09 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.85);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.9);
      });
    } catch (_) {}
  }

  function playLaminarTapFeedback() {
    if (!isMobileExperience() || state?.settings?.mobileSound === false) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxInstance) audioCtxInstance = new AC();
      if (audioCtxInstance.state === "suspended") audioCtxInstance.resume().catch(() => {});
      const ctx = audioCtxInstance;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(920, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.032);
      g.gain.setValueAtTime(0.025, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.036);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch (_) {}
  }

  function wireMobileSwipeNavigation() {
    const container = document.getElementById("view-container");
    if (!container) return;

    let tracking = false;
    let lockedHorizontal = false;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let curDx = 0;
    let rafId = 0;

    const resetVisual = (animateBack) => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      container.classList.remove("swipe-dragging");
      if (animateBack) {
        container.classList.add("swipe-settle");
        container.style.transform = "translate3d(0, 0, 0)";
        container.style.opacity = "1";
        syncMobileNavIndicator(currentView, 0);
        setTimeout(() => {
          if (!tracking) {
            container.classList.remove("swipe-settle");
            container.style.transform = "";
            container.style.opacity = "";
          }
        }, 440);
      } else {
        container.classList.remove("swipe-settle");
        container.style.transform = "";
        container.style.opacity = "";
      }
    };

    container.addEventListener("touchstart", (e) => {
      if (!isMobileExperience() || !e.touches || e.touches.length !== 1) return;
      if (!MOBILE_SWIPE_VIEWS.includes(currentView)) return;
      if (e.target.closest("input, select, textarea, .table-wrap, .t-ledger-body, .ledger-line-list, [type='range']")) return;
      const t = e.touches[0];
      tracking = true;
      lockedHorizontal = false;
      startX = t.clientX;
      startY = t.clientY;
      curDx = 0;
      startTime = performance.now();
    }, { passive: true });

    container.addEventListener("touchmove", (e) => {
      if (!tracking || !e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!lockedHorizontal) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
          tracking = false;
          return;
        }
        if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          lockedHorizontal = true;
          container.classList.remove("swipe-settle");
          container.classList.add("swipe-dragging");
        } else {
          return;
        }
      }

      const idx = MOBILE_SWIPE_VIEWS.indexOf(currentView);
      const wantDir = dx < 0 ? 1 : -1;
      const atEdge = (wantDir < 0 && idx === 0) || (wantDir > 0 && idx === MOBILE_SWIPE_VIEWS.length - 1);
      // Smooth fluid resistance at boundaries vs responsive liquid follow between views
      curDx = atEdge ? dx * 0.28 : dx * 0.86;
      const w = Math.max(container.clientWidth || window.innerWidth, 280);
      const progress = Math.max(-1, Math.min(1, -curDx / w));

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (!lockedHorizontal) return;
          const opacity = Math.max(0.72, 1 - Math.abs(curDx) / (w * 2.2));
          container.style.transform = `translate3d(${curDx.toFixed(1)}px, 0, 0)`;
          container.style.opacity = opacity.toFixed(3);
          if (!atEdge) syncMobileNavIndicator(currentView, progress * 0.85);
        });
      }
    }, { passive: true });

    const finishSwipe = () => {
      if (!tracking) return;
      const wasLocked = lockedHorizontal;
      tracking = false;
      lockedHorizontal = false;
      if (!wasLocked) return;

      const dt = Math.max(16, performance.now() - startTime);
      const velocity = Math.abs(curDx) / dt;
      const w = Math.max(container.clientWidth || window.innerWidth, 280);
      const idx = MOBILE_SWIPE_VIEWS.indexOf(currentView);
      const dir = curDx < 0 ? 1 : -1;
      const nextIdx = idx + dir;

      if (nextIdx >= 0 && nextIdx < MOBILE_SWIPE_VIEWS.length && (Math.abs(curDx) > w * 0.22 || (velocity > 0.36 && Math.abs(curDx) > 36))) {
        playLaminarTapFeedback();
        container.classList.remove("swipe-dragging", "swipe-settle");
        container.classList.add(dir > 0 ? "swipe-out-left" : "swipe-out-right");
        const nextView = MOBILE_SWIPE_VIEWS[nextIdx];
        setTimeout(() => {
          switchView(nextView, { fromSwipeDir: dir });
        }, 125);
      } else {
        resetVisual(true);
      }
    };

    container.addEventListener("touchend", finishSwipe, { passive: true });
    container.addEventListener("touchcancel", () => {
      const wasLocked = lockedHorizontal;
      tracking = false;
      lockedHorizontal = false;
      if (wasLocked) resetVisual(true);
    }, { passive: true });

    window.addEventListener("resize", () => syncMobileNavIndicator(currentView));
  }

  function wireLaminarTouchFeedback() {
    let chimePlayedOnGesture = false;
    const onPointerDown = (e) => {
      if (!chimePlayedOnGesture && audioCtxInstance && audioCtxInstance.state === "suspended") {
        audioCtxInstance.resume().catch(() => {});
        chimePlayedOnGesture = true;
      }
      if (!isMobileExperience()) return;
      const target = e.target.closest(".card, .kpi-card.clickable, .btn, .mobile-nav-item, .mobile-nav-fab, .ledger-pill");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;
      target.style.setProperty("--tap-x", x.toFixed(1) + "%");
      target.style.setProperty("--tap-y", y.toFixed(1) + "%");
      target.classList.add("tapping");
      setTimeout(() => target.classList.remove("tapping"), 260);
      if (target.matches(".btn, .mobile-nav-item, .mobile-nav-fab, .kpi-card.clickable")) {
        playLaminarTapFeedback();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
  }

  function runMobileSplash() {
    if (!isMobileExperience() || state?.settings?.mobileAnimations === false) return;
    const splash = document.getElementById("mobile-splash-overlay");
    if (!splash) return;
    splash.classList.remove("hidden");
    playLogoChime(false);
    setTimeout(() => {
      splash.classList.add("splash-hide");
      setTimeout(() => splash.classList.add("hidden"), 320);
    }, 650);
  }

  async function boot() {
    await loadState();
    ensureStateDefaults();
    applyTheme();
    applyPrivacyMode();
    document.body.classList.toggle("laminar-anim", state.settings.mobileAnimations !== false);
    wireGlobalEvents();
    wireLaminarTouchFeedback();
    wireMobileSwipeNavigation();
    runMobileSplash();

    const retryNetBtn = document.getElementById("net-retry-btn");
    if (retryNetBtn) {
      retryNetBtn.onclick = async () => {
        const st = document.getElementById("net-lock-status");
        if (st) st.textContent = "Checking network connectivity…";
        const ok = await verifyMandatoryOnlineGate();
        if (!ok && st) st.textContent = "Still offline — please check Wi-Fi or mobile data.";
      };
    }
    window.addEventListener("offline", () => { verifyMandatoryOnlineGate(); });
    window.addEventListener("online", () => { verifyMandatoryOnlineGate(); });
    verifyMandatoryOnlineGate();
    setInterval(() => { verifyMandatoryOnlineGate(); }, 25000);

    const updInstallBtn = document.getElementById("app-update-install-btn");
    if (updInstallBtn) updInstallBtn.onclick = () => triggerAppUpdateInstall();
    const updDismissBtn = document.getElementById("app-update-dismiss-btn");
    if (updDismissBtn) updDismissBtn.onclick = () => { updateBannerDismissed = true; renderAppUpdateBanner(); };
    setTimeout(() => { checkForAppUpdates(true); }, 2500);

    const needsBio = !!state.settings.biometricLock;
    const needsPin = !!state.settings.pinHash;

    if (needsBio || needsPin) {
      const overlay = document.getElementById("pin-lock-overlay");
      const bioBtn = document.getElementById("biometric-unlock-btn");
      const pwGroup = document.getElementById("pin-password-group");
      const subLbl = document.getElementById("pin-lock-subtitle");
      const errBox = document.getElementById("pin-error");

      overlay.classList.remove("hidden");
      bioBtn.classList.toggle("hidden", !needsBio);
      pwGroup.classList.toggle("hidden", !needsPin);
      subLbl.textContent = needsBio && !needsPin
        ? "Verify with Fingerprint, Face, or Device Lock to open LedgerFlow."
        : needsBio && needsPin
          ? "Unlock with Biometrics or enter your password."
          : "Enter your password to unlock your local vault.";

      const finishUnlock = () => {
        errBox.classList.add("hidden");
        overlay.classList.add("hidden");
        processAutoRecurring();
        switchView("overview");
      };

      const tryBio = async () => {
        errBox.classList.add("hidden");
        const res = await requestBiometricAuth();
        if (res.ok) {
          finishUnlock();
        } else {
          errBox.textContent = res.error || "Biometric verification cancelled. Tap Unlock with Biometrics to retry.";
          errBox.classList.remove("hidden");
        }
      };
      bioBtn.onclick = tryBio;

      const tryUnlock = async () => {
        const val = document.getElementById("pin-unlock-input").value;
        if (await sha256(val) === state.settings.pinHash) {
          finishUnlock();
        } else {
          errBox.textContent = "Incorrect password. Try again.";
          errBox.classList.remove("hidden");
        }
      };
      document.getElementById("pin-unlock-btn").onclick = tryUnlock;
      document.getElementById("pin-unlock-input").onkeydown = (e) => { if (e.key === "Enter") tryUnlock(); };

      if (needsBio) setTimeout(tryBio, 180);
    } else {
      processAutoRecurring();
      switchView("overview");
    }

    // Desktop heartbeat / clean shutdown signaling (not needed on Android WebView)
    if (isDesktopHost && !isAndroidHost) {
      setInterval(() => {
        fetch("/api/ping", { method: "POST", headers: { "X-LedgerFlow-Token": API_TOKEN } }).catch(() => {});
      }, 4000);
      window.addEventListener("pagehide", () => {
        try { navigator.sendBeacon("/api/bye?token=" + encodeURIComponent(API_TOKEN)); } catch (_) {}
      });
    }

    // Android hardware Back button handler
    window.ledgerFlowHandleBack = function () {
      for (const id of ["tx-modal", "sub-modal", "csv-modal", "cmd-modal"]) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains("hidden")) {
          closeModal(id);
          return "handled";
        }
      }
      const sb = document.getElementById("sidebar");
      if (sb && sb.classList.contains("open")) {
        closeMobileDrawer();
        return "handled";
      }
      if (currentView !== "overview") {
        switchView("overview");
        return "handled";
      }
      return "exit";
    };
  }

  boot();
})();
