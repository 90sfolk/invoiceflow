// InvoiceFlow — Application Logic
// Config (SUPABASE_URL, SUPABASE_KEY) is defined in index.html

let currentUser = null
let allInvoices = []
let logoDataUrl = null
let signatureDataUrl = null
let createMode = 'invoice'

// ── INLINE INVOICE NUMBER EDIT ────────────────────────────
function startEditInvNum(id, currentNum, spanEl) {
  const wrap = document.getElementById('num-wrap-' + id)
  if (!wrap || wrap.querySelector('input')) return // already editing

  const input = document.createElement('input')
  input.className = 'invoice-num-input'
  input.value = currentNum
  input.title = 'Press Enter to save, Esc to cancel'

  wrap.innerHTML = ''
  wrap.appendChild(input)
  input.focus()
  input.select()

  const save = async () => {
    const newNum = input.value.trim()
    if (!newNum || newNum === currentNum) {
      // restore original
      wrap.innerHTML = `<span class="invoice-num" title="Click to edit" onclick="startEditInvNum('${id}','${currentNum}',this)" style="cursor:pointer;border-bottom:1px dashed var(--accent);">${currentNum}</span>`
      return
    }
    const { error } = await db.from('invoices').update({ invoice_number: newNum }).eq('id', id)
    if (error) {
      showToast('❌ Could not update invoice number')
      wrap.innerHTML = `<span class="invoice-num" title="Click to edit" onclick="startEditInvNum('${id}','${currentNum}',this)" style="cursor:pointer;border-bottom:1px dashed var(--accent);">${currentNum}</span>`
    } else {
      showToast('✅ Invoice number updated!')
      // Update local state
      const inv = allInvoices.find(i => i.id === id)
      if (inv) inv.invoice_number = newNum
      wrap.innerHTML = `<span class="invoice-num" title="Click to edit" onclick="startEditInvNum('${id}','${newNum}',this)" style="cursor:pointer;border-bottom:1px dashed var(--accent);">${newNum}</span>`
    }
  }

  const cancel = () => {
    wrap.innerHTML = `<span class="invoice-num" title="Click to edit" onclick="startEditInvNum('${id}','${currentNum}',this)" style="cursor:pointer;border-bottom:1px dashed var(--accent);">${currentNum}</span>`
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); save() }
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  })
  input.addEventListener('blur', save)
}

// ── REPORTS ───────────────────────────────────────────────
let incomeChart = null
let statusChart = null
let reportFrom = null
let reportTo = null

function initReportDates() {
  const now = new Date()
  const from = new Date(now.getFullYear(), 0, 1) // Jan 1 this year
  reportFrom = from.toISOString().split('T')[0]
  reportTo   = now.toISOString().split('T')[0]
  document.getElementById('report-from').value = reportFrom
  document.getElementById('report-to').value   = reportTo
}

function setQuick(period, el) {
  document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'))
  el.classList.add('active')
  const now = new Date()
  let from
  if (period === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (period === 'quarter') {
    from = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  } else if (period === 'year') {
    from = new Date(now.getFullYear(), 0, 1)
  } else {
    from = new Date(2000, 0, 1)
  }
  reportFrom = from.toISOString().split('T')[0]
  reportTo   = now.toISOString().split('T')[0]
  document.getElementById('report-from').value = reportFrom
  document.getElementById('report-to').value   = reportTo
  renderReports()
}

function applyDateRange() {
  reportFrom = document.getElementById('report-from').value
  reportTo   = document.getElementById('report-to').value
  document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'))
  renderReports()
}

function getFilteredInvoices() {
  return allInvoices.filter(inv => {
    if (!inv.issue_date) return true
    return inv.issue_date >= reportFrom && inv.issue_date <= reportTo
  })
}

function renderReports() {
  const invoices = getFilteredInvoices()
  const cur = companySettings.currency || 'USD'
  const fmt = n => formatMoney(n, cur)
  const sum = arr => arr.reduce((s, i) => s + i.total, 0)

  const paid      = invoices.filter(i => i.status === 'paid')
  const sent      = invoices.filter(i => i.status === 'sent')
  const overdue   = invoices.filter(i => i.status === 'overdue')
  const draft     = invoices.filter(i => i.status === 'draft')
  const outstanding = [...sent, ...overdue]
  const allBilled = invoices.filter(i => i.status !== 'estimate')

  // Subtitle
  const fromLabel = new Date(reportFrom+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  const toLabel   = new Date(reportTo+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  document.getElementById('report-subtitle').textContent = `${fromLabel} — ${toLabel}`

  // KPIs
  document.getElementById('kpi-income').textContent       = fmt(sum(paid))
  document.getElementById('kpi-income-sub').textContent   = `${paid.length} paid invoice${paid.length !== 1 ? 's' : ''}`
  document.getElementById('kpi-outstanding').textContent  = fmt(sum(outstanding))
  document.getElementById('kpi-outstanding-sub').textContent = `${outstanding.length} invoices`
  document.getElementById('kpi-overdue').textContent      = fmt(sum(overdue))
  document.getElementById('kpi-overdue-sub').textContent  = `${overdue.length} invoice${overdue.length !== 1 ? 's' : ''}`
  document.getElementById('kpi-total').textContent        = fmt(sum(allBilled))
  document.getElementById('kpi-total-sub').textContent    = `${allBilled.length} invoices`

  renderIncomeChart(invoices, cur)
  renderStatusChart(paid, sent, overdue, draft, fmt)
  renderTopClients(invoices, cur, fmt)
  renderAvgMetrics(invoices, paid, fmt)
}

function renderIncomeChart(invoices, cur) {
  // Group paid invoices by month
  const months = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    months[key] = 0
  }
  invoices.filter(i => i.status === 'paid' && i.issue_date).forEach(inv => {
    const key = inv.issue_date.substring(0, 7)
    if (key in months) months[key] = (months[key] || 0) + inv.total
  })

  const labels = Object.keys(months).map(k => {
    const [y, m] = k.split('-')
    return new Date(+y, +m-1, 1).toLocaleDateString('en-US', {month:'short', year:'2-digit'})
  })
  const data = Object.values(months)

  const ctx = document.getElementById('income-chart').getContext('2d')
  if (incomeChart) incomeChart.destroy()
  incomeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Income',
        data,
        backgroundColor: 'rgba(62,207,142,0.25)',
        borderColor: '#3ecf8e',
        borderWidth: 2,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatMoney(ctx.parsed.y, cur)
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b72', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b72', font: { size: 11 }, callback: v => formatMoney(v, cur) } }
      }
    }
  })
}

function renderStatusChart(paid, sent, overdue, draft, fmt) {
  const data   = [paid.length, sent.length, overdue.length, draft.length].filter((_,i) => [paid,sent,overdue,draft][i].length > 0)
  const labels = ['Paid','Sent','Overdue','Draft'].filter((_,i) => [paid,sent,overdue,draft][i].length > 0)
  const colors = ['#3ecf8e','#7c6af7','#f97066','#6b6b72'].filter((_,i) => [paid,sent,overdue,draft][i].length > 0)
  const amts   = [paid,sent,overdue,draft].filter(a => a.length > 0)

  const ctx = document.getElementById('status-chart').getContext('2d')
  if (statusChart) statusChart.destroy()

  if (data.length === 0) {
    document.getElementById('donut-legend').innerHTML = '<div style="color:var(--muted);font-size:12px;">No invoices in this period</div>'
    return
  }

  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
    options: {
      responsive: false,
      cutout: '70%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}` } } }
    }
  })

  document.getElementById('donut-legend').innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <div>
        <div style="font-size:12px;color:var(--text)">${l}</div>
        <div style="font-size:11px;color:var(--muted)">${amts[i].length} inv · ${fmt(amts[i].reduce((s,x)=>s+x.total,0))}</div>
      </div>
    </div>
  `).join('')
}

function renderTopClients(invoices, cur, fmt) {
  const clientMap = {}
  invoices.filter(i => i.status === 'paid' && i.clients?.name).forEach(inv => {
    const name = inv.clients.name
    if (!clientMap[name]) clientMap[name] = { total: 0, count: 0 }
    clientMap[name].total += inv.total
    clientMap[name].count++
  })

  const sorted = Object.entries(clientMap).sort((a,b) => b[1].total - a[1].total).slice(0, 5)
  const maxVal = sorted[0]?.[1].total || 1

  if (!sorted.length) {
    document.getElementById('top-clients-list').innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">No paid invoices in this period</div>'
    return
  }

  document.getElementById('top-clients-list').innerHTML = sorted.map(([name, data], i) => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
        <div style="font-size:13px;font-weight:500;">${sanitise(name)}</div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:13px;color:#3ecf8e;">${fmt(data.total)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:6px;background:var(--surface2);border-radius:4px;overflow:hidden;">
          <div style="width:${(data.total/maxVal*100).toFixed(1)}%;height:100%;background:#3ecf8e;border-radius:4px;transition:width .4s;"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);width:60px;">${data.count} inv</div>
      </div>
    </div>
  `).join('')
}

function renderAvgMetrics(invoices, paid, fmt) {
  const billed = invoices.filter(i => i.status !== 'estimate')
  const avgInvoice = billed.length ? billed.reduce((s,i)=>s+i.total,0)/billed.length : 0
  const collectRate = billed.length ? (paid.length/billed.length*100).toFixed(0) : 0
  const largestInv = billed.length ? Math.max(...billed.map(i=>i.total)) : 0
  const totalClients = new Set(invoices.filter(i=>i.clients?.name).map(i=>i.clients.name)).size

  document.getElementById('avg-metrics').innerHTML = `
    <div class="avg-row">
      <div class="avg-label">Average invoice value</div>
      <div class="avg-value">${fmt(avgInvoice)}</div>
    </div>
    <div class="avg-row">
      <div class="avg-label">Collection rate</div>
      <div class="avg-value" style="color:#3ecf8e">${collectRate}%</div>
    </div>
    <div class="avg-row">
      <div class="avg-label">Largest invoice</div>
      <div class="avg-value">${fmt(largestInv)}</div>
    </div>
    <div class="avg-row">
      <div class="avg-label">Active clients</div>
      <div class="avg-value">${totalClients}</div>
    </div>
    <div class="avg-row">
      <div class="avg-label">Total invoices</div>
      <div class="avg-value">${billed.length}</div>
    </div>
  `
}

// ── CURRENCY ──────────────────────────────────────────────

// ── XSS PROTECTION ────────────────────────────────────────
function sanitise(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}


const CURRENCIES = {
  USD: { symbol: '$',  name: 'US Dollar',          decimals: 2 },
  EUR: { symbol: '€',  name: 'Euro',                decimals: 2 },
  IDR: { symbol: 'Rp', name: 'Indonesian Rupiah',   decimals: 0 },
  GBP: { symbol: '£',  name: 'British Pound',       decimals: 2 },
  SGD: { symbol: 'S$', name: 'Singapore Dollar',    decimals: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar',   decimals: 2 },
  JPY: { symbol: '¥',  name: 'Japanese Yen',        decimals: 0 },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit',   decimals: 2 },
}

function getCurrencySymbol(code) {
  return (CURRENCIES[code] || CURRENCIES['USD']).symbol
}

function formatMoney(amount, currencyCode) {
  const cur = CURRENCIES[currencyCode] || CURRENCIES['USD']
  const formatted = Number(amount).toLocaleString('en', {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals
  })
  return cur.symbol + formatted
}

function updateCurrencySymbol() {
  const code = document.getElementById('inv-currency').value
  const sym = getCurrencySymbol(code)
  document.getElementById('rate-header').textContent = `Rate (${sym})`
  calcTotal()
}

// ── SUBSCRIPTION ──────────────────────────────────────────
let subscriptionStatus = null // 'trial' | 'active' | 'expired' | 'free'

async function checkSubscription() {
  // Check Supabase for subscription record
  const { data } = await db.from('subscriptions')
    .select('*')
    .eq('user_id', currentUser.id)
    .single()

  const now = new Date()

  if (!data) {
    // New user — start free trial
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString()
    await db.from('subscriptions').insert({
      user_id: currentUser.id,
      status: 'trial',
      trial_ends_at: trialEnd
    })
    subscriptionStatus = 'trial'
    updatePlanBadge()
    return
  }

  if (data.status === 'active') {
    subscriptionStatus = 'active'
  } else if (data.status === 'trial') {
    const trialEnd = new Date(data.trial_ends_at)
    if (now < trialEnd) {
      subscriptionStatus = 'trial'
      const daysLeft = Math.ceil((trialEnd - now) / 86400000)
      updatePlanBadge(`Trial — ${daysLeft}d left`)
    } else {
      subscriptionStatus = 'expired'
      updatePlanBadge('Trial expired')
    }
  } else {
    subscriptionStatus = 'expired'
    updatePlanBadge('Trial expired')
  }

  updatePlanBadge()
}

function updatePlanBadge(label) {
  const el = document.getElementById('user-plan')
  const banner = document.getElementById('trial-banner')
  const bannerText = document.getElementById('trial-banner-text')

  if (subscriptionStatus === 'active') {
    if (el) { el.textContent = '✦ Pro'; el.style.color = 'var(--paid)' }
    if (banner) banner.style.display = 'none'
  } else if (subscriptionStatus === 'trial') {
    if (el) { el.textContent = label || '✦ Free Trial'; el.style.color = 'var(--accent)' }
    if (banner) { banner.style.display = 'flex'; bannerText.textContent = label ? `${label} remaining on your free trial.` : 'You are on a 14-day free trial.' }
  } else {
    if (el) { el.textContent = '⚠ Trial Ended'; el.style.color = 'var(--overdue)' }
    if (banner) { banner.style.display = 'flex'; banner.style.background = 'rgba(249,112,102,.1)'; banner.style.borderColor = 'rgba(249,112,102,.3)'; banner.style.color = 'var(--overdue)'; bannerText.textContent = 'Your free trial has ended. Subscribe to keep using InvoiceFlow.' }
  }
  updateAccountMenu()
}

function canCreateInvoice() {
  if (subscriptionStatus === 'active') return true
  if (subscriptionStatus === 'trial') return true
  // Expired — check free limit
  const nonEstimate = allInvoices.filter(i => i.status !== 'estimate')
  return nonEstimate.length < FREE_INVOICE_LIMIT
}

function showPaywall(context) {
  const title = document.getElementById('paywall-title')
  const sub   = document.getElementById('paywall-sub')
  const dismissBtn = document.getElementById('paywall-dismiss')

  if (context === 'expired') {
    title.textContent = 'Your free trial has ended'
    sub.textContent = 'Subscribe to InvoiceFlow Pro to continue creating unlimited invoices and access all features.'
    dismissBtn.style.display = 'inline-flex'
  } else if (context === 'limit') {
    title.textContent = `You've used your ${FREE_INVOICE_LIMIT} free invoices`
    sub.textContent = 'Upgrade to InvoiceFlow Pro for unlimited invoices, estimates, PDF exports, client portal and more.'
    dismissBtn.style.display = 'inline-flex'
  }
  document.getElementById('paywall-modal').classList.add('open')
}

function dismissPaywall() {
  document.getElementById('paywall-modal').classList.remove('open')
}

async function goToCheckout() {
  showToast('🍋 Opening checkout...')
  try {
    // Call our secure Edge Function — LS API key never leaves the server
    const session = await db.auth.getSession()
    const token = session.data.session?.access_token
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lemon-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'checkout' })
    })
    const data = await res.json()
    if (data.url) {
      window.open(data.url, '_blank')
      dismissPaywall()
      showToast('🍋 Checkout opened in new tab!')
    } else {
      throw new Error(data.error || 'No checkout URL')
    }
  } catch(e) {
    showToast('❌ Could not open checkout: ' + e.message)
  }
}

async function openBillingPortal() {
  showToast('Opening billing portal...')
  try {
    const session = await db.auth.getSession()
    const token = session.data.session?.access_token
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lemon-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'portal' })
    })
    const data = await res.json()
    if (data.url) {
      window.open(data.url, '_blank')
    } else {
      showToast('❌ ' + (data.error || 'No active subscription found'))
    }
  } catch(e) {
    showToast('❌ Could not open billing portal')
  }
}

// ── AUTH ──────────────────────────────────────────────────
function switchAuthTab(tab, el) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'))
  el.classList.add('active')
  document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none'
  document.getElementById('auth-signup').style.display = tab === 'signup' ? 'block' : 'none'
  document.getElementById('auth-error').classList.remove('show')
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error')
  el.textContent = msg; el.classList.add('show')
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) return showAuthError('Please fill in all fields.')
  const btn = document.querySelector('#auth-login .auth-btn')
  btn.disabled = true; btn.textContent = 'Signing in...'
  const { error } = await db.auth.signInWithPassword({ email, password })
  btn.disabled = false; btn.textContent = 'Sign In →'
  if (error) showAuthError(error.message)
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value
  if (!email || !password) return showAuthError('Please fill in all fields.')
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.')
  const btn = document.querySelector('#auth-signup .auth-btn')
  btn.disabled = true; btn.textContent = 'Creating account...'
  const { error } = await db.auth.signUp({ email, password })
  btn.disabled = false; btn.textContent = 'Create Free Account →'
  if (error) showAuthError(error.message)
  else showAuthError('✅ Check your email to confirm your account, then sign in.')
}

async function handleLogout() {
  await db.auth.signOut()
}

// ── INIT ──────────────────────────────────────────────────
db.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    currentUser = session.user
    document.getElementById('auth-screen').classList.add('hidden')
    document.getElementById('app').classList.add('visible')
    const email = currentUser.email
    document.getElementById('user-email-display').textContent = email
    document.getElementById('user-avatar').textContent = email[0].toUpperCase()
    updateAccountMenu()
    loadInvoices()
    loadCompanySettings()
    setupCreateForm()
    initReportDates()
    checkSubscription()
  } else {
    currentUser = null
    document.getElementById('auth-screen').classList.remove('hidden')
    document.getElementById('app').classList.remove('visible')
  }
})

// ── NAVIGATION ────────────────────────────────────────────
function showView(name, el) {
  // Gate invoice/estimate creation behind subscription
  if (name === 'create') {
    if (subscriptionStatus === 'expired') { showPaywall('expired'); return }
    if (!canCreateInvoice()) { showPaywall('limit'); return }
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById('view-' + name).classList.add('active')
  // Don't mark create button as active — it's an action button, not a page
  if (el && name !== 'create') el.classList.add('active')
  if (name === 'create') setupCreateForm()
  if (name === 'dashboard' || name === 'invoices') loadInvoices()
  if (name === 'estimates') loadEstimates()
  if (name === 'reports') { initReportDates(); renderReports() }
  if (name === 'clients') loadClients()
  if (name === 'account') loadAccountPage()
}

function showEstimateForm() {
  createMode = 'estimate'
  showView('create', document.querySelector('[onclick*=create]'))
}

// ── LOAD INVOICES ─────────────────────────────────────────
async function loadInvoices() {
  const { data, error } = await db
    .from('invoices')
    .select('*, clients(name, email, phone, address), line_items(quantity, rate)')
    .order('created_at', { ascending: false })

  if (error) { showToast('❌ Error loading invoices'); return }

  allInvoices = (data || []).map(inv => ({
    ...inv,
    total: (inv.line_items || []).reduce((s, l) => s + (l.quantity * l.rate), 0)
  }))

  renderStats()
  renderInvoiceTable('dashboard-table-body', allInvoices.slice(0, 5))
  renderInvoiceTable('invoices-table-body', allInvoices)
}

function renderStats() {
  const paid = allInvoices.filter(i => i.status === 'paid')
  const pending = allInvoices.filter(i => i.status === 'sent')
  const overdue = allInvoices.filter(i => i.status === 'overdue')
  const outstanding = [...pending, ...overdue]
  const sum = arr => arr.reduce((s, i) => s + i.total, 0)
  const defaultCur = companySettings.currency || 'USD'
  const fmt = n => formatMoney(n, defaultCur)
  document.getElementById('stat-outstanding').textContent = fmt(sum(outstanding))
  document.getElementById('stat-outstanding-sub').textContent = outstanding.length + ' invoices'
  document.getElementById('stat-paid').textContent = fmt(sum(paid))
  document.getElementById('stat-paid-sub').textContent = paid.length + ' invoices'
  document.getElementById('stat-pending').textContent = fmt(sum(pending))
  document.getElementById('stat-pending-sub').textContent = pending.length + ' invoices sent'
  document.getElementById('stat-overdue').textContent = fmt(sum(overdue))
  document.getElementById('stat-overdue-sub').textContent = overdue.length + ' overdue'
  document.getElementById('dash-subtitle').textContent = allInvoices.length + ' total invoices'
}

function renderInvoiceTable(tbodyId, invoices) {
  const tbody = document.getElementById(tbodyId)
  if (!invoices.length) {
    tbody.innerHTML = `<tr class="loading-row"><td colspan="6" style="text-align:center;padding:50px;color:var(--muted)">No invoices yet — create your first one!</td></tr>`
    return
  }
  tbody.innerHTML = invoices.map(inv => `
    <tr>
      <td>
        <div class="invoice-num-wrap" id="num-wrap-${inv.id}">
          <span class="invoice-num" title="Click to edit" onclick="startEditInvNum('${inv.id}','${(inv.invoice_number||'').replace(/'/g,"\\'")}',this)" style="cursor:pointer;border-bottom:1px dashed var(--accent);">${sanitise(inv.invoice_number || '#INV')}</span>
        </div>
      </td>
      <td><div class="client-name">${sanitise(inv.clients?.name || '—')}</div><div class="client-email">${sanitise(inv.clients?.email || '')}</div></td>
      <td><div class="amount">${formatMoney(inv.total, inv.currency || 'USD')}</div></td>
      <td>${inv.due_date ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
      <td><span class="badge badge-${inv.status}">${inv.status}</span></td>
      <td><div class="action-btns">
        <button class="icon-btn" title="View" onclick="viewInvoice('${inv.id}')">👁</button>
        <button class="icon-btn" title="Duplicate" onclick="duplicateInvoice('${inv.id}')">⧉</button>
        ${inv.status !== 'paid' ? `<button class="icon-btn" title="Remind" onclick="openReminder('${(inv.clients?.name||'').replace(/'/g,"\\'")}','${inv.invoice_number}','$${inv.total}')">🔔</button>` : ''}
        ${inv.status !== 'paid' ? `<button class="icon-btn" title="Mark Paid" onclick="markPaid('${inv.id}')">✓</button>` : ''}
        <button class="icon-btn" title="Delete" onclick="deleteInvoice('${inv.id}')">✕</button>
      </div></td>
    </tr>
  `).join('')
}

function filterInvoices(filter, el) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'))
  el.classList.add('active')
  const filtered = filter === 'all' ? allInvoices : allInvoices.filter(i => i.status === filter)
  renderInvoiceTable('invoices-table-body', filtered)
}

// ── MARK PAID / DELETE ────────────────────────────────────
async function markPaid(id) {
  const { error } = await db.from('invoices').update({ status: 'paid' }).eq('id', id)
  if (error) showToast('❌ Error'); else { showToast('✅ Marked as paid!'); loadInvoices() }
}

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return
  await db.from('line_items').delete().eq('invoice_id', id)
  const { error } = await db.from('invoices').delete().eq('id', id)
  if (error) showToast('❌ Error'); else { showToast('🗑 Deleted'); loadInvoices() }
}

// ── CREATE FORM SETUP ─────────────────────────────────────
function setupCreateForm() {
  const today = new Date().toISOString().split('T')[0]
  const due = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  document.getElementById('inv-issue-date').value = today
  document.getElementById('inv-due-date').value = due
  document.getElementById('tax-rate').value = 0

  // Auto-fill payment info from company settings
  if (companySettings.currency) {
    document.getElementById('inv-currency').value = companySettings.currency
  }
  updateCurrencySymbol()
  if (companySettings.payment_method) {
    const pm = document.getElementById('inv-payment-method')
    for (let opt of pm.options) { if (opt.value === companySettings.payment_method) { opt.selected = true; break } }
  }
  if (companySettings.payment_details) document.getElementById('inv-payment-details').value = companySettings.payment_details
  if (companySettings.default_notes) document.getElementById('inv-notes').value = companySettings.default_notes

  const isEstimate = createMode === 'estimate'
  const prefix = isEstimate ? '#EST-' : '#INV-'
  const nextNum = prefix + String(allInvoices.length + 1).padStart(4, '0')
  document.getElementById('inv-number').value = nextNum
  document.getElementById('new-invoice-num').textContent = nextNum + ' · Draft'
  document.getElementById('create-page-title').textContent = isEstimate ? 'New Estimate' : 'New Invoice'
  document.getElementById('btn-send').style.display = isEstimate ? 'none' : 'inline-flex'
  document.getElementById('btn-save-estimate').style.display = isEstimate ? 'inline-flex' : 'none'

  updateCreateFormBanner()
  document.getElementById('line-items').innerHTML = ''
  addLine(); addLine()
  calcTotal()
  createMode = 'invoice'
}

// ── LINE ITEMS ────────────────────────────────────────────
function addLine() {
  const row = document.createElement('div')
  row.className = 'line-item-row'
  row.innerHTML = `
    <input class="form-input li-desc" placeholder="Service description" />
    <input class="form-input li-qty" value="1" oninput="calcTotal()" />
    <input class="form-input li-rate" value="0" oninput="calcTotal()" />
    <input class="form-input li-total" value="$0" readonly style="color:var(--accent)" />
    <button class="icon-btn" onclick="removeLine(this)">✕</button>
  `
  document.getElementById('line-items').appendChild(row)
}

function removeLine(btn) { btn.closest('.line-item-row').remove(); calcTotal() }

function calcTotal() {
  const code = document.getElementById('inv-currency')?.value || 'USD'
  const sym = getCurrencySymbol(code)
  let subtotal = 0
  document.querySelectorAll('#line-items .line-item-row').forEach(row => {
    const qty  = parseFloat(row.querySelector('.li-qty').value)  || 0
    const rate = parseFloat(row.querySelector('.li-rate').value) || 0
    const rt = qty * rate; subtotal += rt
    row.querySelector('.li-total').value = formatMoney(rt, code)
  })
  const taxRate = parseFloat(document.getElementById('tax-rate').value) || 0
  const taxAmt  = subtotal * (taxRate / 100)
  const total   = subtotal + taxAmt
  document.getElementById('subtotal').textContent    = formatMoney(subtotal, code)
  document.getElementById('tax-amount').textContent  = formatMoney(taxAmt, code)
  document.getElementById('grand-total').textContent = formatMoney(total, code)
}

// ── SAVE INVOICE ──────────────────────────────────────────
async function saveInvoice(status) {
  const clientName = document.getElementById('client-name').value.trim()
  if (!clientName) { showToast('❌ Please enter a client name'); return }

  const btnSend = document.getElementById('btn-send')
  const btnDraft = document.getElementById('btn-save-draft')
  btnSend.disabled = true; btnDraft.disabled = true
  btnSend.textContent = 'Saving...'

  try {
    // Find or create client
    let clientId = null
    const { data: existing } = await db.from('clients').select('id').eq('user_id', currentUser.id).eq('name', clientName).limit(1)
    if (existing?.length) {
      clientId = existing[0].id
    } else {
      const { data: nc, error: ce } = await db.from('clients').insert({
        user_id: currentUser.id,
        name: clientName,
        email: document.getElementById('client-email').value.trim(),
        phone: document.getElementById('client-phone')?.value.trim() || '',
        address: document.getElementById('client-address').value.trim()
      }).select('id').single()
      if (ce) throw ce
      clientId = nc.id
    }

    // Save invoice
    const { data: inv, error: ie } = await db.from('invoices').insert({
      user_id: currentUser.id,
      client_id: clientId,
      invoice_number: document.getElementById('inv-number').value,
      status,
      issue_date: document.getElementById('inv-issue-date').value,
      due_date: document.getElementById('inv-due-date').value,
      notes: document.getElementById('inv-notes').value,
      tax_rate: parseFloat(document.getElementById('tax-rate').value) || 0,
      currency: document.getElementById('inv-currency').value || 'USD'
    }).select('id').single()
    if (ie) throw ie

    // Save line items
    const lines = []
    document.querySelectorAll('#line-items .line-item-row').forEach(row => {
      const desc = row.querySelector('.li-desc').value.trim()
      const qty = parseFloat(row.querySelector('.li-qty').value) || 0
      const rate = parseFloat(row.querySelector('.li-rate').value) || 0
      if (desc) lines.push({ invoice_id: inv.id, description: desc, quantity: qty, rate })
    })
    if (lines.length) { const { error: le } = await db.from('line_items').insert(lines); if (le) throw le }

    showToast(status === 'sent' ? '📧 Invoice sent!' : '💾 Draft saved!')
    await loadInvoices()
    showView('invoices', document.querySelector('[onclick*=invoices]'))
  } catch (err) {
    showToast('❌ ' + err.message)
  } finally {
    btnSend.disabled = false; btnDraft.disabled = false
    btnSend.textContent = '✉ Send Invoice'
  }
}

// ── VIEW INVOICE DETAIL ───────────────────────────────────
let detailInvoice = null

async function viewInvoice(id) {
  const { data, error } = await db
    .from('invoices')
    .select('*, clients(name, email, phone, address), line_items(description, quantity, rate)')
    .eq('id', id)
    .single()

  if (error) { showToast('❌ Could not load invoice'); return }
  detailInvoice = { ...data, total: (data.line_items || []).reduce((s, l) => s + (l.quantity * l.rate), 0) }

  const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : '—'

  document.getElementById('detail-inv-number').textContent = data.invoice_number || '#INV'
  document.getElementById('detail-inv-status').textContent = 'Status: ' + data.status + '  ·  Currency: ' + (data.currency || 'USD')

  document.getElementById('detail-from').innerHTML = `
    <strong>${sanitise(companySettings.name || currentUser.email)}</strong><br>
    <span style="color:var(--muted);font-size:12px;">${sanitise(companySettings.email || '')}</span><br>
    <span style="color:var(--muted);font-size:12px;">${sanitise(companySettings.address || '')}</span>
  `
  document.getElementById('detail-to').innerHTML = `
    <strong>${data.clients?.name || '—'}</strong><br>
    ${data.clients?.email || ''}<br>
    ${data.clients?.address || ''}
  `

  document.getElementById('detail-issue-date').textContent = fmt(data.issue_date)
  document.getElementById('detail-due-date').textContent = fmt(data.due_date)
  document.getElementById('detail-payment-method').textContent = data.payment_method || '—'
  document.getElementById('detail-notes').textContent = data.notes || '—'

  const badge = document.getElementById('detail-badge')
  badge.className = 'badge badge-' + data.status
  badge.textContent = data.status

  const markBtn    = document.getElementById('detail-mark-paid-btn')
  const remindBtn  = document.getElementById('detail-remind-btn')
  const convertBtn = document.getElementById('detail-convert-btn')
  const sendBtn    = document.getElementById('detail-send-btn')
  const sendWaItem = document.getElementById('send-wa-item')
  const sendLinkItem = document.getElementById('send-link-item')
  const isEstimate = data.status === 'estimate'
  const isPaid     = data.status === 'paid'

  markBtn.style.display    = (isPaid || isEstimate) ? 'none' : 'inline-flex'
  remindBtn.style.display  = (isPaid || isEstimate) ? 'none' : 'inline-flex'
  convertBtn.style.display = isEstimate ? 'inline-flex' : 'none'

  // Update send button label
  if (sendBtn) sendBtn.innerHTML = isEstimate
    ? '✉ Send Estimate <span style="font-size:10px;margin-left:2px;">▾</span>'
    : '✉ Send Invoice <span style="font-size:10px;margin-left:2px;">▾</span>'

  // Update WA item context
  if (sendWaItem) sendWaItem.onclick = () => { sendWhatsApp(isEstimate ? 'estimate' : 'invoice'); closeSendDropdown() }

  // Hide share link for estimates (no portal token)
  if (sendLinkItem) sendLinkItem.style.display = isEstimate ? 'none' : 'flex'

  // Tax
  const subtotal = (data.line_items||[]).reduce((s,l) => s+(l.quantity*l.rate), 0)
  const taxRate = data.tax_rate || 0
  const taxAmt = subtotal * (taxRate/100)
  const grandTotal = subtotal + taxAmt
  document.getElementById('detail-subtotal').textContent = formatMoney(subtotal, data.currency || 'USD')
  document.getElementById('detail-tax-label').textContent = `Tax (${taxRate}%)`
  document.getElementById('detail-tax-amount').textContent = formatMoney(taxAmt, data.currency || 'USD')
  document.getElementById('detail-grand-total').textContent = formatMoney(grandTotal, data.currency || 'USD')
  document.getElementById('detail-total').textContent = formatMoney(grandTotal, data.currency || 'USD')

  const lineItemsEl = document.getElementById('detail-line-items')
  lineItemsEl.innerHTML = (data.line_items || []).map(l => `
    <div class="line-item-row" style="pointer-events:none;">
      <input class="form-input" value="${sanitise(l.description || '')}" readonly />
      <input class="form-input" value="${l.quantity}" readonly />
      <input class="form-input" value="$${l.rate.toLocaleString()}" readonly />
      <input class="form-input" value="$${(l.quantity * l.rate).toLocaleString()}" readonly style="color:var(--accent)" />
      <div></div>
    </div>
  `).join('')

  showView('detail', null)
}

async function markPaidFromDetail() {
  if (!detailInvoice) return
  await markPaid(detailInvoice.id)
  await viewInvoice(detailInvoice.id)
}

function openReminderFromDetail() {
  if (!detailInvoice) return
  openReminder(
    detailInvoice.clients?.name,
    detailInvoice.invoice_number,
    '$' + detailInvoice.total.toLocaleString()
  )
}

// ── COMPANY SETTINGS ─────────────────────────────────────
let companySettings = {}

async function loadCompanySettings() {
  const { data } = await db.from('company_settings')
    .select('*')
    .eq('user_id', currentUser.id)
    .single()

  if (data) {
    companySettings = data
    logoDataUrl = data.logo_url || null
    signatureDataUrl = data.signature_url || null

    document.getElementById('settings-name').value = data.name || ''
    document.getElementById('settings-email').value = data.email || ''
    document.getElementById('settings-phone').value = data.phone || ''
    document.getElementById('settings-address').value = data.address || ''
    document.getElementById('settings-website').value = data.website || ''
    document.getElementById('settings-payment-details').value = data.payment_details || ''
    document.getElementById('settings-notes').value = data.default_notes || ''
    const brandColor = data.brand_color || '#ffc800'
    document.getElementById('settings-brand-color').value = brandColor
    updateColorPreview(brandColor)
    if (data.currency) {
      document.getElementById('settings-currency').value = data.currency
    }
    const pm = document.getElementById('settings-payment-method')
    if (data.payment_method) {
      for (let opt of pm.options) { if (opt.value === data.payment_method) { opt.selected = true; break } }
    }
    if (data.logo_url) {
      document.getElementById('settings-logo-preview').src = data.logo_url
      document.getElementById('settings-logo-preview').style.display = 'block'
      document.getElementById('settings-logo-placeholder').style.display = 'none'
    }
    if (data.signature_url) {
      document.getElementById('settings-sign-preview').src = data.signature_url
      document.getElementById('settings-sign-preview').style.display = 'block'
      document.getElementById('settings-sign-placeholder').style.display = 'none'
      document.getElementById('sign-preview-img').src = data.signature_url
      document.getElementById('sign-preview-img').style.display = 'block'
      document.getElementById('sign-preview-empty').style.display = 'none'
    }
  }
  updateCreateFormBanner()
}

function updateCreateFormBanner() {
  const s = companySettings
  document.getElementById('create-company-name').textContent = s.name || '— Set up your company first'
  document.getElementById('create-company-email').textContent = s.email || ''
  document.getElementById('create-company-address').textContent = s.address || ''
  const logoEl = document.getElementById('create-logo-preview')
  if (s.logo_url) {
    logoEl.src = s.logo_url
    logoEl.style.display = 'block'
  } else {
    logoEl.style.display = 'none'
  }
}

async function saveCompanySettings() {
  const payload = {
    user_id: currentUser.id,
    name: document.getElementById('settings-name').value.trim(),
    email: document.getElementById('settings-email').value.trim(),
    phone: document.getElementById('settings-phone').value.trim(),
    address: document.getElementById('settings-address').value.trim(),
    website: document.getElementById('settings-website').value.trim(),
    payment_method: document.getElementById('settings-payment-method').value,
    payment_details: document.getElementById('settings-payment-details').value.trim(),
    default_notes: document.getElementById('settings-notes').value.trim(),
    currency: document.getElementById('settings-currency').value || 'USD',
    brand_color: document.getElementById('settings-brand-color').value || '#ffc800',
    logo_url: logoDataUrl || null,
    signature_url: signatureDataUrl || null
  }

  const { error } = await db.from('company_settings')
    .upsert(payload, { onConflict: 'user_id' })

  if (error) { showToast('❌ Error saving: ' + error.message); return }

  companySettings = payload
  updateCreateFormBanner()
  showToast('✅ Company settings saved!')
  showView('dashboard', document.querySelector('[onclick*=dashboard]'))
}

function updateColorPreview(hex) {
  document.getElementById('color-bar-preview').style.background = hex
  document.getElementById('color-hex-label').textContent = hex.toUpperCase()
}

function setColor(hex) {
  document.getElementById('settings-brand-color').value = hex
  updateColorPreview(hex)
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return [r, g, b]
}

// Decide if text on brand color should be dark or light
function textOnColor(rgb) {
  const lum = (0.299*rgb[0] + 0.587*rgb[1] + 0.114*rgb[2]) / 255
  return lum > 0.5 ? [30,30,30] : [255,255,255]
}

function handleSignatureUpload(input) {
  const file = input.files[0]
  if (!file) return
  if (file.size > 1024 * 1024) { showToast('❌ Signature must be under 1MB'); return }
  const reader = new FileReader()
  reader.onload = e => {
    signatureDataUrl = e.target.result
    document.getElementById('settings-sign-preview').src = signatureDataUrl
    document.getElementById('settings-sign-preview').style.display = 'block'
    document.getElementById('settings-sign-placeholder').style.display = 'none'
    document.getElementById('sign-preview-img').src = signatureDataUrl
    document.getElementById('sign-preview-img').style.display = 'block'
    document.getElementById('sign-preview-empty').style.display = 'none'
  }
  reader.readAsDataURL(file)
}

function clearSignature() {
  signatureDataUrl = null
  document.getElementById('settings-sign-preview').style.display = 'none'
  document.getElementById('settings-sign-placeholder').style.display = 'flex'
  document.getElementById('settings-sign-upload').value = ''
  document.getElementById('sign-preview-img').style.display = 'none'
  document.getElementById('sign-preview-empty').style.display = 'block'
}

function handleSettingsLogoUpload(input) {
  const file = input.files[0]
  if (!file) return
  if (file.size > 1024 * 1024) { showToast('❌ Logo must be under 1MB'); return }
  const reader = new FileReader()
  reader.onload = e => {
    logoDataUrl = e.target.result
    const preview = document.getElementById('settings-logo-preview')
    preview.src = logoDataUrl
    preview.style.display = 'block'
    document.getElementById('settings-logo-placeholder').style.display = 'none'
  }
  reader.readAsDataURL(file)
}

function clearSettingsLogo() {
  logoDataUrl = null
  document.getElementById('settings-logo-preview').style.display = 'none'
  document.getElementById('settings-logo-placeholder').style.display = 'flex'
  document.getElementById('settings-logo-upload').value = ''
}

// ── LOGO UPLOAD ───────────────────────────────────────────
function handleLogoUpload(input) {
  const file = input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = e => {
    logoDataUrl = e.target.result
    const preview = document.getElementById('logo-preview')
    preview.src = logoDataUrl
    preview.style.display = 'block'
    document.getElementById('logo-label').textContent = file.name
    document.getElementById('logo-clear').style.display = 'flex'
  }
  reader.readAsDataURL(file)
}

function clearLogo() {
  logoDataUrl = null
  document.getElementById('logo-preview').style.display = 'none'
  document.getElementById('logo-label').textContent = 'Click to upload logo'
  document.getElementById('logo-clear').style.display = 'none'
  document.getElementById('logo-upload').value = ''
}

// ── DUPLICATE INVOICE ─────────────────────────────────────
async function duplicateInvoice(id) {
  const inv = allInvoices.find(i => i.id === id)
  if (!inv) return

  const { data: full } = await db.from('invoices')
    .select('*, clients(name, email, phone, address), line_items(description, quantity, rate)')
    .eq('id', id).single()
  if (!full) return

  const nextNum = '#INV-' + String(allInvoices.length + 1).padStart(4, '0')

  const { data: newInv, error } = await db.from('invoices').insert({
    user_id: currentUser.id,
    client_id: full.client_id,
    invoice_number: nextNum + '-COPY',
    status: 'draft',
    issue_date: new Date().toISOString().split('T')[0],
    due_date: full.due_date,
    notes: full.notes,
    tax_rate: full.tax_rate || 0
  }).select('id').single()

  if (error) { showToast('❌ Error duplicating'); return }

  const lines = (full.line_items || []).map(l => ({
    invoice_id: newInv.id,
    description: l.description,
    quantity: l.quantity,
    rate: l.rate
  }))
  if (lines.length) await db.from('line_items').insert(lines)

  showToast('⧉ Invoice duplicated!')
  await loadInvoices()
}

// ── LOAD ESTIMATES ────────────────────────────────────────
async function loadEstimates() {
  const { data, error } = await db
    .from('invoices')
    .select('*, clients(name, email, phone, address), line_items(quantity, rate)')
    .eq('status', 'estimate')
    .order('created_at', { ascending: false })

  if (error) { showToast('❌ Error loading estimates'); return }

  const estimates = (data || []).map(inv => ({
    ...inv,
    total: (inv.line_items || []).reduce((s, l) => s + (l.quantity * l.rate), 0)
  }))

  const tbody = document.getElementById('estimates-table-body')
  if (!estimates.length) {
    tbody.innerHTML = `<tr class="loading-row"><td colspan="6" style="text-align:center;padding:50px;color:var(--muted)">No estimates yet — create your first quote!</td></tr>`
    return
  }
  tbody.innerHTML = estimates.map(inv => `
    <tr>
      <td><div class="invoice-num">${sanitise(inv.invoice_number || '#EST')}</div></td>
      <td><div class="client-name">${sanitise(inv.clients?.name || '—')}</div><div class="client-email">${sanitise(inv.clients?.email || '')}</div></td>
      <td><div class="amount">${formatMoney(inv.total, inv.currency || 'USD')}</div></td>
      <td>${inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
      <td><span class="badge badge-draft">estimate</span></td>
      <td><div class="action-btns">
        <button class="icon-btn" title="View & Convert" onclick="viewInvoice('${inv.id}')">👁</button>
        <button class="icon-btn" title="Delete" onclick="deleteInvoice('${inv.id}')">✕</button>
      </div></td>
    </tr>
  `).join('')
}

// ── CONVERT ESTIMATE TO INVOICE ───────────────────────────
async function convertEstimateToInvoice() {
  if (!detailInvoice) return
  const nextNum = '#INV-' + String(allInvoices.length + 1).padStart(4, '0')
  const { error } = await db.from('invoices').update({
    status: 'draft',
    invoice_number: nextNum
  }).eq('id', detailInvoice.id)

  if (error) { showToast('❌ Error converting'); return }
  showToast('✅ Converted to invoice!')
  await loadInvoices()
  await viewInvoice(detailInvoice.id)
}

// ── DOWNLOAD PDF ──────────────────────────────────────────
function downloadPDF() {
  if (!detailInvoice) return
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const inv = detailInvoice
  const W = 210, L = 14, R = W - 14

  const fmt   = d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) : '—'
  const invCurrency = inv.currency || companySettings.currency || 'USD'
  const money = n => formatMoney(n, invCurrency)

  // Brand color
  const brandHex = companySettings.brand_color || '#ffc800'
  const BRAND    = hexToRgb(brandHex)
  const TXONCOL  = textOnColor(BRAND)
  const DARK     = [40,  40,  40]
  const MID      = [110, 110, 110]
  const LIGHT    = [200, 200, 200]
  const ROWALT   = [246, 246, 246]
  const WHITE    = [255, 255, 255]
  const THEADBG  = [50,  50,  50]

  // White page
  doc.setFillColor(255,255,255)
  doc.rect(0,0,W,297,'F')

  // ── TOP THIN BRAND BAR (full width, 3mm)
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, W, 3, 'F')

  // ── LOGO ONLY (top left, below thin bar)
  let logoBottomY = 10
  if (companySettings.logo_url) {
    try {
      doc.addImage(companySettings.logo_url, 'PNG', L, 7, 18, 18)
      logoBottomY = 28
    } catch(e) { logoBottomY = 10 }
  }

  // ── THICK BRAND BAR with "INVOICE" inside it
  // Bar sits below logo area, full width
  const barY = logoBottomY + 2
  const barH = 12
  doc.setFillColor(...BRAND)
  doc.rect(0, barY, W, barH, 'F')

  // "INVOICE" label right-aligned inside the bar, vertically centred
  const docLabel = inv.status === 'estimate' ? 'ESTIMATE' : 'INVOICE'
  doc.setFont('helvetica','bold').setFontSize(14).setTextColor(...TXONCOL)
  doc.text(docLabel, R, barY + barH/2 + 2.5, { align:'right' })

  // Invoice number inside bar, left side (smaller)
  doc.setFont('helvetica','normal').setFontSize(8).setTextColor(...TXONCOL)
  doc.setGState && doc.setGState(doc.GState({ opacity: 0.75 }))
  doc.text(inv.invoice_number || '#INV-0001', L, barY + barH/2 + 2.5)
  doc.setGState && doc.setGState(doc.GState({ opacity: 1 }))

  // ── INVOICE TO + META (below bar)
  const sectionY = barY + barH + 10

  doc.setFont('helvetica','bold').setFontSize(8.5).setTextColor(...DARK)
  doc.text('Invoice to:', L, sectionY)

  doc.setFont('helvetica','bold').setFontSize(11).setTextColor(...DARK)
  doc.text(inv.clients?.name || '—', L, sectionY + 6)

  doc.setFont('helvetica','normal').setFontSize(8).setTextColor(...MID)
  let cy = sectionY + 11
  if (inv.clients?.email)   { doc.text(inv.clients.email,   L, cy); cy += 4.5 }
  if (inv.clients?.address) { doc.text(inv.clients.address, L, cy) }

  // Right side meta
  const mLX = 122, mVX = 195
  doc.setFont('helvetica','bold').setFontSize(9).setTextColor(...DARK)
  doc.text('Invoice #', mLX, sectionY)
  doc.text('Date',      mLX, sectionY + 7)
  doc.text('Due Date',  mLX, sectionY + 14)
  doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...MID)
  doc.text(inv.invoice_number || '—', mVX, sectionY,      { align:'right' })
  doc.text(fmt(inv.issue_date),        mVX, sectionY + 7,  { align:'right' })
  doc.text(fmt(inv.due_date),          mVX, sectionY + 14, { align:'right' })

  // ── LINE ITEMS TABLE
  const tableStartY = sectionY + 24
  const rows = (inv.line_items||[]).map((l,i) => [
    String(i+1),
    l.description || '—',
    { content: money(l.rate),             styles:{ halign:'right' } },
    { content: String(l.quantity),        styles:{ halign:'center' } },
    { content: money(l.quantity*l.rate),  styles:{ halign:'right', fontStyle:'bold' } },
  ])

  doc.autoTable({
    startY: tableStartY,
    head: [['SL.', 'Item Description', 'Price', 'Qty.', 'Total']],
    body: rows,
    theme: 'plain',
    margin: { left:L, right:14 },
    styles: {
      font:'helvetica', fontSize:9,
      textColor: DARK,
      cellPadding: { top:3.5, bottom:3.5, left:3, right:3 },
    },
    headStyles: {
      fillColor: THEADBG,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: { top:4, bottom:4, left:3, right:3 },
    },
    alternateRowStyles: { fillColor: ROWALT },
    columnStyles: {
      0: { cellWidth:10,  halign:'center' },
      1: { cellWidth:'auto' },
      2: { cellWidth:26,  halign:'right' },
      3: { cellWidth:16,  halign:'center' },
      4: { cellWidth:26,  halign:'right' },
    },
    tableLineColor: LIGHT,
    tableLineWidth: 0.1,
  })

  // ── TOTALS
  const subtotal = (inv.line_items||[]).reduce((s,l) => s+(l.quantity*l.rate), 0)
  const taxRate  = inv.tax_rate || 0
  const taxAmt   = subtotal * (taxRate/100)
  const grand    = subtotal + taxAmt
  const tableEndY = doc.lastAutoTable.finalY
  const tL = 130

  let by = tableEndY + 10
  doc.setFont('helvetica','bold').setFontSize(9).setTextColor(...DARK)
  doc.text('Thank you for your business', L, by)

  by += 7
  doc.setFont('helvetica','bold').setFontSize(8).setTextColor(...DARK)
  doc.text('Terms & Conditions', L, by)
  by += 5
  doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(...MID)
  doc.text('Payment is due within 14 days of invoice date.', L, by)

  if (companySettings.payment_details) {
    by += 8
    doc.setFont('helvetica','bold').setFontSize(8).setTextColor(...DARK)
    doc.text('Payment Info:', L, by)
    by += 5
    doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(...MID)
    doc.splitTextToSize(companySettings.payment_details, 80)
        .forEach(line => { doc.text(line, L, by); by += 4.5 })
  }

  const tBaseY = tableEndY + 10
  doc.setFont('helvetica','normal').setFontSize(9).setTextColor(...DARK)
  doc.text('Sub Total:', tL, tBaseY)
  doc.text(money(subtotal), R, tBaseY, { align:'right' })
  doc.text('Tax:', tL, tBaseY + 7)
  doc.text(taxRate > 0 ? money(taxAmt) : '0.00%', R, tBaseY + 7, { align:'right' })

  // Brand-colored total box
  const totBoxY = tBaseY + 12
  doc.setFillColor(...BRAND)
  doc.rect(tL, totBoxY, R - tL, 11, 'F')
  doc.setFont('helvetica','bold').setFontSize(10.5).setTextColor(...TXONCOL)
  doc.text('Total:', tL + 3, totBoxY + 7.5)
  doc.text(money(grand), R - 3, totBoxY + 7.5, { align:'right' })

  // ── FOOTER — pinned to bottom
  const signAreaY = 252
  const signLineY = 272

  // Signature image if available
  if (companySettings.signature_url) {
    try {
      doc.addImage(companySettings.signature_url, 'PNG', R - 50, signAreaY, 46, 18)
    } catch(e) {}
  }

  // Authorised sign line (right-aligned)
  doc.setDrawColor(...DARK).setLineWidth(0.3)
  doc.line(R - 50, signLineY, R, signLineY)
  doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(...MID)
  doc.text('Authorised Sign', R - 25, signLineY + 5, { align:'center' })

  // Full-width brand bar above dark footer
  doc.setFillColor(...BRAND)
  doc.rect(0, signLineY + 9, W, 3, 'F')

  // Dark footer bar
  doc.setFillColor(...DARK)
  doc.rect(0, signLineY + 12, W, 14, 'F')
  doc.setFont('helvetica','normal').setFontSize(8).setTextColor(200,200,200)
  const fi = [
    companySettings.phone   || 'Phone #',
    companySettings.address || 'Address',
    companySettings.website || 'Website',
  ]
  doc.text(fi[0], L,    signLineY + 21)
  doc.text(fi[1], W/2,  signLineY + 21, { align:'center' })
  doc.text(fi[2], R,    signLineY + 21, { align:'right' })
  doc.setTextColor(...BRAND)
  doc.setFontSize(10)
  doc.text('|', W/2 - 25, signLineY + 21)
  doc.text('|', W/2 + 22, signLineY + 21)

  // Bottom brand bar
  doc.setFillColor(...BRAND)
  doc.rect(0, signLineY + 26, W, 3, 'F')

  doc.save((inv.invoice_number||'invoice')+'.pdf')
  showToast('📄 PDF downloaded!')
}

// ── CLIENT PORTAL ─────────────────────────────────────────
async function sharePortalLink() {
  if (!detailInvoice) return

  // Check if token already exists
  let token = detailInvoice.portal_token

  if (!token) {
    // Generate a unique token
    token = crypto.randomUUID().replace(/-/g,'')

    const { error } = await db.from('invoices')
      .update({ portal_token: token })
      .eq('id', detailInvoice.id)

    if (error) { showToast('❌ Could not generate link'); return }
    detailInvoice.portal_token = token
  }

  const portalUrl = `${window.location.origin}/portal.html?token=${token}`

  // Copy to clipboard
  try {
    await navigator.clipboard.writeText(portalUrl)
    showToast('🔗 Portal link copied to clipboard!')
  } catch(e) {
    prompt('Copy this link and send to your client:', portalUrl)
  }
}

// ── EMAIL ─────────────────────────────────────────────────
function openEmailModal() {
  if (!detailInvoice) return
  const inv = detailInvoice
  const cur = inv.currency || companySettings.currency || 'USD'
  const total = formatMoney(inv.total, cur)
  const dueDate = inv.due_date
    ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})
    : '—'
  const fromName = companySettings.name || currentUser.email
  const clientName = inv.clients?.name || 'there'
  const clientEmail = inv.clients?.email || ''

  // Pre-fill fields
  document.getElementById('email-to').value = clientEmail
  document.getElementById('email-cc').value = ''
  document.getElementById('email-subject').value =
    `Invoice ${inv.invoice_number} from ${fromName} — ${total}`

  // Build email body
  const lineItemsText = (inv.line_items || [])
    .filter(l => l.description)
    .map(l => `  • ${l.description} — ${formatMoney(l.quantity * l.rate, cur)}`)
    .join('\n')

  const taxRate = inv.tax_rate || 0
  const subtotal = (inv.line_items||[]).reduce((s,l) => s + (l.quantity * l.rate), 0)
  const taxAmt = subtotal * (taxRate / 100)
  const grand = subtotal + taxAmt

  let body = `Hi ${clientName},\n\nPlease find attached invoice ${inv.invoice_number} for ${total}, due on ${dueDate}.\n\n`

  body += `--- Invoice Summary ---\n`
  if (lineItemsText) body += `${lineItemsText}\n`
  if (taxRate > 0) {
    body += `\n  Subtotal: ${formatMoney(subtotal, cur)}`
    body += `\n  Tax (${taxRate}%): ${formatMoney(taxAmt, cur)}`
  }
  body += `\n  Total Due: ${formatMoney(grand, cur)}`
  body += `\n  Due Date: ${dueDate}\n`

  if (companySettings.payment_details) {
    body += `\n--- Payment Info ---\n  ${companySettings.payment_details}\n`
  }

  body += `\nIf you have any questions about this invoice, please don't hesitate to reach out.\n`

  // Add portal link if available
  if (inv.portal_token) {
    const portalUrl = `${window.location.origin}/portal.html?token=${inv.portal_token}`
    body += `\nView your invoice online: ${portalUrl}\n`
  }

  body += `\nThank you for your business!\n\n${fromName}`
  if (companySettings.email) body += `\n${companySettings.email}`
  if (companySettings.phone) body += `\n${companySettings.phone}`
  if (companySettings.website) body += `\n${companySettings.website}`

  document.getElementById('email-body').value = body

  // Summary box
  document.getElementById('email-modal-sub').textContent =
    `Sending ${inv.invoice_number} to ${clientName}`
  document.getElementById('email-summary').innerHTML = `
    <strong>Invoice:</strong> ${inv.invoice_number} &nbsp;·&nbsp;
    <strong>Amount:</strong> ${total} &nbsp;·&nbsp;
    <strong>Due:</strong> ${dueDate}<br>
    <strong>Client:</strong> ${clientName} &nbsp;·&nbsp;
    <strong>Email:</strong> ${clientEmail || '(no email saved)'}
  `

  document.getElementById('email-modal').classList.add('open')
}

function closeEmailModal() {
  document.getElementById('email-modal').classList.remove('open')
}

function sendEmail() {
  const to      = document.getElementById('email-to').value.trim()
  const cc      = document.getElementById('email-cc').value.trim()
  const subject = document.getElementById('email-subject').value.trim()
  const body    = document.getElementById('email-body').value.trim()

  if (!to) { showToast('❌ Please enter a recipient email'); return }

  // Build mailto URL
  let mailto = `mailto:${encodeURIComponent(to)}`
  const params = []
  if (cc)      params.push(`cc=${encodeURIComponent(cc)}`)
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body)    params.push(`body=${encodeURIComponent(body)}`)
  if (params.length) mailto += '?' + params.join('&')

  // Download PDF first, then open mail client
  downloadPDF()
  setTimeout(() => {
    window.location.href = mailto
    closeEmailModal()
    showToast('📧 Email client opened! Attach the downloaded PDF.')
  }, 800)
}

document.getElementById('email-modal').addEventListener('click', function(e) {
  if (e.target === this) closeEmailModal()
})

// ── REMINDER ──────────────────────────────────────────────
function openReminder(name, num, amount) {
  document.getElementById('modal-sub').textContent = `Reminder for ${num} · ${name}`
  document.getElementById('rp-name').textContent = name || 'Client'
  document.getElementById('rp-num').textContent = num || '#INV'
  document.getElementById('rp-amount').textContent = amount || '$0'
  document.getElementById('rp-from').textContent = currentUser?.email || 'You'
  document.getElementById('reminder-modal').classList.add('open')
}
function closeReminder() { document.getElementById('reminder-modal').classList.remove('open') }
function sendReminder() { closeReminder(); showToast('🔔 Reminder sent!') }

// ── TOAST ─────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast')
  document.getElementById('toast-msg').textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3000)
}

document.getElementById('reminder-modal').addEventListener('click', function(e) {
  if (e.target === this) closeReminder()
})
// ── CLIENTS ───────────────────────────────────────────────
let allClients = []
let filteredClients = []
let clientSortMode = 'revenue'
let selectedClient = null

async function loadClients() {
  const { data, error } = await db
    .from('invoices')
    .select('*, clients(id, name, email, phone, address), line_items(quantity, rate)')
    .neq('status', 'estimate')
    .order('created_at', { ascending: false })

  if (error) { showToast('❌ Error loading clients'); return }

  // Group by client
  const clientMap = {}
  ;(data || []).forEach(inv => {
    if (!inv.clients) return
    const cid = inv.clients.id
    const total = (inv.line_items || []).reduce((s, l) => s + (l.quantity * l.rate), 0)
    if (!clientMap[cid]) {
      clientMap[cid] = {
        id:       cid,
        name:     inv.clients.name,
        email:    inv.clients.email || '',
        address:  inv.clients.address || '',
        invoices: [],
        totalBilled:   0,
        totalPaid:     0,
        lastInvoiceAt: null,
      }
    }
    clientMap[cid].invoices.push({ ...inv, total })
    clientMap[cid].totalBilled += total
    if (inv.status === 'paid') clientMap[cid].totalPaid += total
    if (!clientMap[cid].lastInvoiceAt || inv.issue_date > clientMap[cid].lastInvoiceAt) {
      clientMap[cid].lastInvoiceAt = inv.issue_date
    }
  })

  allClients = Object.values(clientMap)
  filteredClients = [...allClients]
  document.getElementById('clients-subtitle').textContent =
    `${allClients.length} client${allClients.length !== 1 ? 's' : ''}`

  sortAndRenderClients()
}

function sortAndRenderClients() {
  const sorted = [...filteredClients]
  if (clientSortMode === 'revenue') {
    sorted.sort((a, b) => b.totalBilled - a.totalBilled)
  } else if (clientSortMode === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name))
  } else if (clientSortMode === 'recent') {
    sorted.sort((a, b) => (b.lastInvoiceAt || '').localeCompare(a.lastInvoiceAt || ''))
  }
  renderClientsTable(sorted)
}

function sortClients(mode, el) {
  clientSortMode = mode
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'))
  el.classList.add('active')
  sortAndRenderClients()
}

function filterClients(query) {
  const q = query.toLowerCase().trim()
  filteredClients = q
    ? allClients.filter(c =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
      )
    : [...allClients]
  sortAndRenderClients()
}

function renderClientsTable(clients) {
  const cur = companySettings.currency || 'USD'
  const tbody = document.getElementById('clients-table-body')

  if (!clients.length) {
    tbody.innerHTML = `<tr class="loading-row"><td colspan="7" style="text-align:center;padding:50px;color:var(--muted)">No clients found</td></tr>`
    return
  }

  tbody.innerHTML = clients.map(c => {
    const outstanding = c.totalBilled - c.totalPaid
    const lastDate = c.lastInvoiceAt
      ? new Date(c.lastInvoiceAt + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
      : '—'
    const initials = c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    return `<tr class="client-row" onclick="openClientPanel('${c.id}')">
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="client-avatar">${sanitise(initials)}</div>
          <div class="client-info">
            <div class="client-row-name">${sanitise(c.name)}</div>
            <div class="client-row-email">${sanitise(c.email)}</div>
          </div>
        </div>
      </td>
      <td>${c.invoices.length}</td>
      <td style="font-weight:500;">${formatMoney(c.totalBilled, cur)}</td>
      <td style="color:var(--paid);font-weight:500;">${formatMoney(c.totalPaid, cur)}</td>
      <td style="color:${outstanding > 0 ? 'var(--pending)' : 'var(--muted)'};">${formatMoney(outstanding, cur)}</td>
      <td>${lastDate}</td>
      <td>
        <div class="action-btns">
          <button class="icon-btn" title="New Invoice" onclick="event.stopPropagation();newInvoiceForClientId('${c.id}','${sanitise(c.name)}')">＋</button>
          ${c.email ? `<button class="icon-btn" title="Email" onclick="event.stopPropagation();window.location.href='mailto:${sanitise(c.email)}'">✉</button>` : ''}
        </div>
      </td>
    </tr>`
  }).join('')
}

function openClientPanel(clientId) {
  const client = allClients.find(c => c.id === clientId)
  if (!client) return
  selectedClient = client

  const cur = companySettings.currency || 'USD'
  const outstanding = client.totalBilled - client.totalPaid
  const initials = client.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  document.getElementById('cp-avatar').textContent    = sanitise(initials)
  document.getElementById('cp-name').textContent      = sanitise(client.name)
  document.getElementById('cp-email').textContent     = sanitise(client.email)
  document.getElementById('cp-total-billed').textContent = formatMoney(client.totalBilled, cur)
  document.getElementById('cp-total-paid').textContent   = formatMoney(client.totalPaid, cur)
  document.getElementById('cp-outstanding').textContent  = formatMoney(outstanding, cur)
  document.getElementById('cp-inv-count').textContent    = client.invoices.length

  // Email button
  const emailBtn = document.getElementById('cp-email-btn')
  emailBtn.style.display = client.email ? 'inline-flex' : 'none'
  // WhatsApp button
  const waBtn = document.getElementById('cp-wa-btn')
  if (waBtn) waBtn.style.display = client.phone ? 'inline-flex' : 'none'

  // Invoice list
  const invList = document.getElementById('cp-invoice-list')
  if (!client.invoices.length) {
    invList.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px;">No invoices yet</div>`
  } else {
    invList.innerHTML = client.invoices.map(inv => `
      <div class="cp-inv-row" onclick="viewInvoice('${inv.id}')" style="cursor:pointer;">
        <div>
          <div class="cp-inv-num">${sanitise(inv.invoice_number || '#INV')}</div>
          <div class="cp-inv-date">${inv.issue_date ? new Date(inv.issue_date + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="badge badge-${inv.status}">${inv.status}</span>
          <div class="cp-inv-amount">${formatMoney(inv.total, inv.currency || cur)}</div>
        </div>
      </div>
    `).join('')
  }

  document.getElementById('client-panel-overlay').classList.add('open')
  document.getElementById('client-panel').classList.add('open')
}

function closeClientPanel() {
  document.getElementById('client-panel-overlay').classList.remove('open')
  document.getElementById('client-panel').classList.remove('open')
  selectedClient = null
}

function newInvoiceForClient() {
  if (!selectedClient) return
  closeClientPanel()
  newInvoiceForClientId(selectedClient.id, selectedClient.name)
}

function newInvoiceForClientId(clientId, clientName) {
  showView('create', document.querySelector('[onclick*=create]'))
  // Pre-fill client name after form is set up
  setTimeout(() => {
    const nameInput = document.getElementById('client-name')
    if (nameInput) nameInput.value = clientName
  }, 50)
}

function emailClient() {
  if (!selectedClient?.email) return
  window.location.href = `mailto:${selectedClient.email}`
}

// ── SEND DROPDOWN ─────────────────────────────────────────
function toggleSendDropdown(e) {
  e.stopPropagation()
  document.getElementById('send-dropdown-menu').classList.toggle('open')
}

function closeSendDropdown() {
  document.getElementById('send-dropdown-menu')?.classList.remove('open')
}

// Close dropdown when clicking anywhere else
document.addEventListener('click', () => closeSendDropdown())

// ── WHATSAPP ──────────────────────────────────────────────
function cleanPhone(phone) {
  // Strip spaces, dashes, brackets — keep + and digits
  let p = (phone || '').replace(/[\s\-().]/g, '')
  // Convert leading 0 to country code (Indonesia default +62)
  if (p.startsWith('0')) p = '+62' + p.slice(1)
  // Remove + for wa.me URL
  return p.replace(/^\+/, '')
}

function buildWaUrl(phone, message) {
  const p = cleanPhone(phone)
  const text = encodeURIComponent(message)
  return p
    ? `https://wa.me/${p}?text=${text}`
    : `https://wa.me/?text=${text}`
}

function sendWhatsApp(context) {
  if (!detailInvoice) return
  const inv  = detailInvoice
  const cur  = inv.currency || companySettings.currency || 'USD'
  const total = formatMoney(inv.total, cur)
  const from  = companySettings.name || currentUser.email
  const dueDate = inv.due_date
    ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
    : '—'
  const clientName = inv.clients?.name || 'there'
  const phone = inv.clients?.phone || ''

  let message = ''

  if (context === 'invoice') {
    message = `Hi ${clientName},\n\nPlease find your invoice from ${from}:\n\n📄 *${inv.invoice_number}*\n💰 Amount: *${total}*\n📅 Due: ${dueDate}\n`
    if (inv.payment_method) message += `\n💳 Payment: ${inv.payment_method}`
    if (companySettings.payment_details) message += `\n${companySettings.payment_details}`
    if (inv.portal_token) {
      const portalUrl = `${window.location.origin}/portal.html?token=${inv.portal_token}`
      message += `\n\n🔗 View invoice online:\n${portalUrl}`
    }
    message += `\n\nThank you for your business! 🙏`
  } else if (context === 'estimate') {
    message = `Hi ${clientName},\n\nHere is your estimate from ${from}:\n\n📋 *${inv.invoice_number}*\n💰 Total: *${total}*\n`
    if (inv.notes) message += `\n📝 ${inv.notes}`
    message += `\n\nPlease let us know if you'd like to proceed. Thank you! 🙏`
  }

  const waUrl = buildWaUrl(phone, message)
  window.open(waUrl, '_blank')
  showToast('💬 Opening WhatsApp...')
}

function sendReminderWhatsApp() {
  if (!detailInvoice) return
  const inv   = detailInvoice
  const cur   = inv.currency || companySettings.currency || 'USD'
  const total = formatMoney(inv.total, cur)
  const from  = companySettings.name || currentUser.email
  const dueDate = inv.due_date
    ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
    : '—'
  const clientName = inv.clients?.name || 'there'
  const phone = inv.clients?.phone || ''

  let message = `Hi ${clientName},\n\nThis is a friendly reminder from *${from}*.\n\n`
  message += `📄 Invoice *${inv.invoice_number}*\n`
  message += `💰 Amount: *${total}*\n`
  message += `📅 Due date: ${dueDate}\n`
  if (inv.status === 'overdue') message += `\n⚠️ This invoice is now *overdue*.\n`
  if (companySettings.payment_details) message += `\n💳 Payment details:\n${companySettings.payment_details}\n`
  if (inv.portal_token) {
    const portalUrl = `${window.location.origin}/portal.html?token=${inv.portal_token}`
    message += `\n🔗 View invoice:\n${portalUrl}\n`
  }
  message += `\nPlease let us know if you have any questions. Thank you! 🙏`

  const waUrl = buildWaUrl(phone, message)
  window.open(waUrl, '_blank')
  closeReminder()
  showToast('💬 Opening WhatsApp reminder...')
}

function whatsAppClient() {
  if (!selectedClient) return
  const phone = selectedClient.phone || ''
  const name  = selectedClient.name
  const from  = companySettings.name || currentUser.email
  const message = `Hi ${name}, this is ${from}. How can I help you today? 😊`
  const waUrl = buildWaUrl(phone, message)
  window.open(waUrl, '_blank')
}

// ── ACCOUNT SETTINGS ──────────────────────────────────────
function loadAccountPage() {
  const email = currentUser?.email || '—'
  const created = currentUser?.created_at
    ? new Date(currentUser.created_at).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
    : '—'

  document.getElementById('account-avatar').textContent      = email[0].toUpperCase()
  document.getElementById('account-email-display').textContent = email
  document.getElementById('account-new-email').value         = email
  document.getElementById('account-session-email').textContent = email
  document.getElementById('account-joined').textContent      = `Joined ${created}`

  // Plan display
  const planEl = document.getElementById('account-plan-display')
  if (subscriptionStatus === 'active') {
    planEl.textContent = '✦ Pro Plan — Active'
    planEl.style.color = 'var(--paid)'
  } else if (subscriptionStatus === 'trial') {
    planEl.textContent = '✦ Free Trial'
    planEl.style.color = 'var(--accent)'
  } else {
    planEl.textContent = '⚠ Trial Expired'
    planEl.style.color = 'var(--overdue)'
  }

  // Password strength listener
  const pwInput = document.getElementById('account-new-password')
  if (pwInput) pwInput.addEventListener('input', e => checkPasswordStrength(e.target.value))
}

function checkPasswordStrength(pw) {
  const fill  = document.getElementById('password-strength-fill')
  const label = document.getElementById('password-strength-label')
  if (!pw) { fill.style.width = '0%'; label.textContent = ''; return }

  let score = 0
  if (pw.length >= 6)  score++
  if (pw.length >= 10) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++

  const levels = [
    { pct:'20%', color:'var(--overdue)',  text:'Very weak' },
    { pct:'40%', color:'var(--overdue)',  text:'Weak' },
    { pct:'60%', color:'var(--pending)',  text:'Fair' },
    { pct:'80%', color:'var(--accent)',   text:'Good' },
    { pct:'100%',color:'var(--paid)',     text:'Strong 💪' },
  ]
  const lvl = levels[Math.min(score, 4)]
  fill.style.width      = lvl.pct
  fill.style.background = lvl.color
  label.textContent     = lvl.text
  label.style.color     = lvl.color
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId)
  if (input.type === 'password') {
    input.type = 'text'
    btn.textContent = '🙈'
  } else {
    input.type = 'password'
    btn.textContent = '👁'
  }
}

async function updateEmail() {
  const newEmail = document.getElementById('account-new-email').value.trim()
  if (!newEmail) { showToast('❌ Please enter an email'); return }
  if (newEmail === currentUser.email) { showToast('ℹ️ That is already your email'); return }

  const { error } = await db.auth.updateUser({ email: newEmail })
  if (error) {
    showToast('❌ ' + error.message)
  } else {
    showToast('✅ Check your new email to confirm the change!')
  }
}

async function updatePassword() {
  const newPw  = document.getElementById('account-new-password').value
  const confPw = document.getElementById('account-confirm-password').value

  if (!newPw)              { showToast('❌ Please enter a new password'); return }
  if (newPw.length < 6)    { showToast('❌ Password must be at least 6 characters'); return }
  if (newPw !== confPw)    { showToast('❌ Passwords do not match'); return }

  const { error } = await db.auth.updateUser({ password: newPw })
  if (error) {
    showToast('❌ ' + error.message)
  } else {
    showToast('✅ Password updated successfully!')
    document.getElementById('account-new-password').value     = ''
    document.getElementById('account-confirm-password').value = ''
    document.getElementById('password-strength-fill').style.width = '0%'
    document.getElementById('password-strength-label').textContent = ''
  }
}

async function confirmDeleteAccount() {
  const confirmed = confirm(
    '⚠️ Delete your account?\n\nThis will permanently delete:\n• All your invoices\n• All your clients\n• All your data\n\nThis CANNOT be undone. Type "DELETE" to confirm.'
  )
  if (!confirmed) return

  const typed = prompt('Type DELETE to confirm account deletion:')
  if (typed !== 'DELETE') { showToast('Cancelled — account not deleted'); return }

  showToast('🗑 Deleting account...')
  try {
    // Delete all user data first
    await db.from('line_items').delete().in('invoice_id',
      (await db.from('invoices').select('id').eq('user_id', currentUser.id)).data?.map(i => i.id) || []
    )
    await db.from('invoices').delete().eq('user_id', currentUser.id)
    await db.from('clients').delete().eq('user_id', currentUser.id)
    await db.from('company_settings').delete().eq('user_id', currentUser.id)
    await db.from('subscriptions').delete().eq('user_id', currentUser.id)

    // Sign out
    await db.auth.signOut()
    showToast('Account deleted. Goodbye!')
  } catch(e) {
    showToast('❌ Error deleting account: ' + e.message)
  }
}

// ── ACCOUNT MENU ──────────────────────────────────────────
function toggleAccountMenu(e) {
  e.stopPropagation()
  document.getElementById('account-menu').classList.toggle('open')
}

function closeAccountMenu() {
  document.getElementById('account-menu')?.classList.remove('open')
}

document.addEventListener('click', () => closeAccountMenu())

function updateAccountMenu() {
  const email = currentUser?.email || '—'
  const initial = email[0].toUpperCase()

  // Update all avatar/email displays
  ;['user-avatar','menu-avatar'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.textContent = initial
  })
  ;['user-email-display','menu-email'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.textContent = email
  })

  // Plan badge
  const planText = subscriptionStatus === 'active'
    ? '✦ Pro'
    : subscriptionStatus === 'trial'
    ? '✦ Free Trial'
    : '⚠ Trial Expired'
  const planColor = subscriptionStatus === 'active'
    ? 'var(--paid)'
    : subscriptionStatus === 'trial'
    ? 'var(--accent)'
    : 'var(--overdue)'

  ;['user-plan','menu-plan'].forEach(id => {
    const el = document.getElementById(id)
    if (el) { el.textContent = planText; el.style.color = planColor }
  })
}
