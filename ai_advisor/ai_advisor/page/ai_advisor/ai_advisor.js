frappe.pages['ai_advisor'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: '🤖 AI Business Advisor',
		single_column: true
	});

	// Inject styles
	injectStyles();

	// Render the full dashboard
	$(wrapper).find('.layout-main-section').html(getDashboardHTML());

	// Init app
	initApp(page);
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let appState = {
	data: null,
	loading: false,
	currentView: 'dashboard',
	chatHistory: [],
	hasKey: false,
};

// ─── INIT ────────────────────────────────────────────────────────────────────
function initApp(page) {
	// Add toolbar buttons
	page.add_button('↻ Refresh', () => loadData(), { btn_class: 'btn-default' });
	page.add_button('⚙ Settings', () => showSettings(), { btn_class: 'btn-default' });

	// Nav listeners
	document.querySelectorAll('.aia-nav-item').forEach(el => {
		el.addEventListener('click', () => {
			const view = el.dataset.view;
			switchView(view);
			document.querySelectorAll('.aia-nav-item').forEach(n => n.classList.remove('active'));
			el.classList.add('active');
		});
	});

	// Quick action buttons
	document.querySelectorAll('.aia-quick-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const q = btn.dataset.q;
			if (q) askClaude(q);
		});
	});

	// Chat input
	const chatInput = document.getElementById('aia-chat-input');
	if (chatInput) {
		chatInput.addEventListener('keypress', e => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendChatMsg();
			}
		});
	}

	// Check if API key is set
	checkSettings();

	// Load data
	loadData();
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
async function checkSettings() {
	try {
		const r = await frappe.call({ method: 'ai_advisor.api.claude_api.get_settings' });
		if (r.message?.has_key) {
			appState.hasKey = true;
			updateKeyStatus(true, r.message.key_preview);
		} else {
			updateKeyStatus(false, null);
		}
	} catch(e) {}
}

function updateKeyStatus(hasKey, preview) {
	const el = document.getElementById('aia-key-status');
	if (!el) return;
	if (hasKey) {
		el.innerHTML = `<span style="color:#00e5a0">✅ Claude connected (${preview})</span>`;
	} else {
		el.innerHTML = `<span style="color:#ff6b6b">⚠️ Claude API key not set — go to ⚙ Settings</span>`;
	}
}

function showSettings() {
	const d = new frappe.ui.Dialog({
		title: 'AI Advisor Settings',
		fields: [
			{
				label: 'Claude API Key',
				fieldname: 'claude_api_key',
				fieldtype: 'Password',
				description: 'Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>. Saved securely on the server.',
				reqd: 1
			},
			{
				label: 'How to get an API key',
				fieldname: 'info_html',
				fieldtype: 'HTML',
				options: `<div style="background:#f8f9fa;padding:12px;border-radius:6px;font-size:12px;line-height:1.6">
					<b>Steps:</b><br>
					1. Go to <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a><br>
					2. Sign up / Log in → API Keys → Create Key<br>
					3. Copy the key (starts with <code>sk-ant-</code>)<br>
					4. Paste it above and click Save<br>
					<br>
					<b>Cost:</b> Claude Sonnet ~$0.003 per query. A typical business with 50 queries/day = ~$4.50/month.
				</div>`
			}
		],
		primary_action_label: 'Save',
		primary_action: async function(values) {
			const r = await frappe.call({
				method: 'ai_advisor.api.claude_api.save_settings',
				args: { claude_api_key: values.claude_api_key }
			});
			if (r.message?.success) {
				frappe.show_alert({ message: '✅ API key saved!', indicator: 'green' });
				appState.hasKey = true;
				checkSettings();
				d.hide();
			} else {
				frappe.msgprint('Error saving key: ' + (r.message?.error || 'Unknown error'));
			}
		}
	});
	d.show();
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadData() {
	setLoading(true);
	try {
		const r = await frappe.call({ method: 'ai_advisor.api.claude_api.get_business_snapshot' });
		if (r.message?.success) {
			appState.data = r.message;
			renderAllData(r.message);
			frappe.show_alert({ message: '✅ Data refreshed', indicator: 'green' });
		} else {
			frappe.show_alert({ message: '⚠️ Could not load ERP data', indicator: 'orange' });
		}
	} catch(e) {
		frappe.show_alert({ message: 'Error loading data: ' + e.message, indicator: 'red' });
	}
	setLoading(false);
}

function setLoading(v) {
	appState.loading = v;
	const spinner = document.getElementById('aia-spinner');
	if (spinner) spinner.style.display = v ? 'flex' : 'none';
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderAllData(d) {
	const kpi = d.kpis || {};
	setText('aia-kpi-rec', fmt(kpi.total_receivables || 0));
	setText('aia-kpi-rec-sub', `${kpi.open_invoices || 0} open invoices`);
	setText('aia-kpi-od', fmt(kpi.total_overdue || 0));
	setText('aia-kpi-od-sub', `${kpi.overdue_count || 0} overdue`);
	setText('aia-kpi-pay', fmt(kpi.total_payables || 0));
	setText('aia-kpi-pay-sub', `${kpi.payables_count || 0} bills pending`);
	setText('aia-kpi-sales', fmt(kpi.mtd_sales || 0));
	setText('aia-kpi-sales-sub', 'Month to date');

	// Overdue table
	renderOverdueTable(d.overdue_customers || []);

	// Payables table
	renderPayablesTable(d.payables || []);

	// Sales chart
	renderSalesChart(d.sales_trend || []);

	// Top customers
	renderTopCustomers(d.top_customers || []);

	// Low stock
	renderLowStock(d.low_stock || []);
}

function renderOverdueTable(rows) {
	const el = document.getElementById('aia-overdue-rows');
	if (!el) return;
	if (!rows.length) {
		el.innerHTML = `<tr><td colspan="4" class="aia-empty-row">✅ No overdue customers</td></tr>`;
		return;
	}
	el.innerHTML = rows.map(r => {
		const cls = r.days_overdue > 60 ? 'aia-badge-red' : r.days_overdue > 30 ? 'aia-badge-orange' : 'aia-badge-yellow';
		return `<tr>
			<td><b>${r.customer}</b></td>
			<td style="color:#ff6b6b;font-weight:600">${fmt(r.amount)}</td>
			<td><span class="aia-badge ${cls}">${r.days_overdue}d overdue</span></td>
			<td>
				<button class="aia-mini-btn" onclick="draftFollowup('${esc(r.customer)}', '${fmt(r.amount)}', ${r.days_overdue})">
					✉️ Follow up
				</button>
			</td>
		</tr>`;
	}).join('');
	setText('aia-overdue-count', `${rows.length} overdue`);
}

function renderPayablesTable(rows) {
	const el = document.getElementById('aia-payables-rows');
	if (!el) return;
	if (!rows.length) {
		el.innerHTML = `<tr><td colspan="3" class="aia-empty-row">✅ No outstanding payables</td></tr>`;
		return;
	}
	el.innerHTML = rows.map(p => {
		const d = new Date(p.due_date);
		const daysLeft = Math.floor((d - new Date()) / 86400000);
		const cls = daysLeft < 0 ? 'aia-badge-red' : daysLeft < 7 ? 'aia-badge-orange' : 'aia-badge-green';
		const label = daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`;
		return `<tr>
			<td><b>${p.supplier}</b></td>
			<td style="color:#ffb347;font-weight:600">${fmt(p.amount)}</td>
			<td><span class="aia-badge ${cls}">${label}</span></td>
		</tr>`;
	}).join('');
	setText('aia-payables-count', `${rows.length} bills`);
}

function renderSalesChart(trend) {
	const el = document.getElementById('aia-sales-chart');
	if (!el || !trend.length) return;
	const max = Math.max(...trend.map(t => t.amount), 1);
	el.innerHTML = trend.map(t => {
		const pct = Math.round(t.amount / max * 100);
		const isMax = t.amount === max;
		return `<div class="aia-bar-row">
			<div class="aia-bar-label">
				<span>${t.month}</span>
				<span style="color:#00e5a0">${fmt(t.amount)}</span>
			</div>
			<div class="aia-bar-track">
				<div class="aia-bar-fill ${isMax ? 'aia-bar-peak' : ''}" style="width:${pct}%"></div>
			</div>
		</div>`;
	}).join('');
}

function renderTopCustomers(customers) {
	const el = document.getElementById('aia-top-customers-rows');
	if (!el) return;
	if (!customers.length) {
		el.innerHTML = `<tr><td colspan="3" class="aia-empty-row">No data</td></tr>`;
		return;
	}
	el.innerHTML = customers.map((c, i) => `<tr>
		<td><span style="color:var(--text-muted);margin-right:8px">${i+1}</span><b>${c.customer}</b></td>
		<td style="color:#00e5a0;font-weight:600">${fmt(c.revenue)}</td>
		<td style="color:var(--text-muted)">${c.orders} orders</td>
	</tr>`).join('');
}

function renderLowStock(items) {
	const el = document.getElementById('aia-stock-rows');
	if (!el) return;
	if (!items.length) {
		el.innerHTML = `<tr><td colspan="4" class="aia-empty-row">✅ All items above reorder level</td></tr>`;
		return;
	}
	el.innerHTML = items.map(s => {
		const pct = Math.round(s.stock / s.reorder_level * 100);
		const cls = pct < 30 ? 'aia-badge-red' : pct < 60 ? 'aia-badge-orange' : 'aia-badge-yellow';
		return `<tr>
			<td><b>${s.name || s.item}</b></td>
			<td>${s.stock} ${s.uom}</td>
			<td>${s.reorder_level} ${s.uom}</td>
			<td><span class="aia-badge ${cls}">${pct}% of reorder</span></td>
		</tr>`;
	}).join('');
	setText('aia-stock-count', `${items.length} items low`);
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
function switchView(view) {
	appState.currentView = view;
	document.querySelectorAll('.aia-view').forEach(v => v.classList.remove('active'));
	const el = document.getElementById(`aia-view-${view}`);
	if (el) el.classList.add('active');
}

// ─── AI CHAT ─────────────────────────────────────────────────────────────────
async function askClaude(question) {
	// Switch to advisor view
	switchView('advisor');
	document.querySelectorAll('.aia-nav-item').forEach(n => n.classList.remove('active'));
	document.querySelector('[data-view="advisor"]')?.classList.add('active');

	const chat = document.getElementById('aia-chat-messages');
	const emptyState = chat.querySelector('.aia-chat-empty');
	if (emptyState) emptyState.remove();

	// Add user message
	addChatMsg(chat, 'user', question);

	// Add typing indicator
	const typing = addChatMsg(chat, 'ai', `<div class="aia-typing"><span></span><span></span><span></span></div>`);
	chat.scrollTop = chat.scrollHeight;

	// Disable send
	const sendBtn = document.getElementById('aia-send-btn');
	if (sendBtn) sendBtn.disabled = true;

	try {
		const contextStr = appState.data ? JSON.stringify(appState.data) : '{}';
		const r = await frappe.call({
			method: 'ai_advisor.api.claude_api.ask_claude',
			args: { question, context_data: contextStr }
		});

		const bubble = typing.querySelector('.aia-msg-bubble');
		if (r.message?.success) {
			bubble.innerHTML = formatAIResponse(r.message.response);
		} else {
			bubble.innerHTML = `<span style="color:#ff6b6b">❌ ${r.message?.error || 'Unknown error'}</span>`;
		}
	} catch(e) {
		typing.querySelector('.aia-msg-bubble').innerHTML = `<span style="color:#ff6b6b">❌ ${e.message}</span>`;
	}

	if (sendBtn) sendBtn.disabled = false;
	chat.scrollTop = chat.scrollHeight;
}

async function sendChatMsg() {
	const input = document.getElementById('aia-chat-input');
	const msg = input?.value?.trim();
	if (!msg) return;
	input.value = '';
	await askClaude(msg);
}

function addChatMsg(container, role, content) {
	const el = document.createElement('div');
	el.className = `aia-msg aia-msg-${role}`;
	el.innerHTML = `
		<div class="aia-msg-avatar">${role === 'ai' ? '🤖' : '👤'}</div>
		<div class="aia-msg-bubble">${content}</div>
	`;
	container.appendChild(el);
	return el;
}

function formatAIResponse(text) {
	// Convert markdown-ish formatting to HTML
	return text
		.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
		.replace(/\n\n/g, '</p><p>')
		.replace(/\n/g, '<br>')
		.replace(/^/, '<p>').replace(/$/, '</p>');
}

async function draftFollowup(customer, amount, days) {
	await askClaude(`Draft a professional follow-up message for ${customer} who owes ${amount} and is ${days} days overdue. Be firm but professional. Include a specific payment deadline (7 days from today). Format for WhatsApp.`);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function fmt(n) {
	n = parseFloat(n) || 0;
	if (n >= 1000000) return 'KES ' + (n/1000000).toFixed(1) + 'M';
	if (n >= 1000) return 'KES ' + (n/1000).toFixed(0) + 'K';
	return 'KES ' + n.toFixed(0);
}

function setText(id, text) {
	const el = document.getElementById(id);
	if (el) el.textContent = text;
}

function esc(str) {
	return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ─── HTML TEMPLATE ────────────────────────────────────────────────────────────
function getDashboardHTML() {
	return `
<div class="aia-wrap">

	<!-- SIDEBAR NAV -->
	<div class="aia-sidebar">
		<div class="aia-brand">
			<div class="aia-brand-dot"></div>
			<div>
				<div class="aia-brand-sub">POWERED BY CLAUDE</div>
				<div class="aia-brand-name">AI Advisor</div>
			</div>
		</div>

		<div class="aia-key-status" id="aia-key-status">
			<span style="color:var(--text-muted)">Checking connection...</span>
		</div>

		<nav class="aia-nav">
			<div class="aia-nav-item active" data-view="dashboard">
				<span>📊</span> Overview
			</div>
			<div class="aia-nav-item" data-view="receivables">
				<span>💰</span> Receivables
			</div>
			<div class="aia-nav-item" data-view="payables">
				<span>🧾</span> Payables
			</div>
			<div class="aia-nav-item" data-view="inventory">
				<span>📦</span> Reorder Alerts
			</div>
			<div class="aia-nav-item" data-view="sales">
				<span>📈</span> Sales Report
			</div>
			<div class="aia-nav-item" data-view="advisor">
				<span>🤖</span> AI Advisor
			</div>
		</nav>

		<div class="aia-quick-section">
			<div class="aia-quick-label">QUICK ASKS</div>
			<button class="aia-quick-btn" data-q="Give me my morning business summary. What are the 3 most urgent things today?">☀️ Morning Brief</button>
			<button class="aia-quick-btn" data-q="Who are my highest risk debtors right now and what should I do?">🚨 Risk Alert</button>
			<button class="aia-quick-btn" data-q="Which suppliers should I prioritize paying this week and why?">💳 Pay Priority</button>
			<button class="aia-quick-btn" data-q="Give me a complete business health assessment with key metrics and recommendations.">❤️ Health Check</button>
		</div>
	</div>

	<!-- MAIN CONTENT -->
	<div class="aia-main">

		<!-- Loading overlay -->
		<div class="aia-spinner" id="aia-spinner">
			<div class="aia-spinner-dots">
				<span></span><span></span><span></span>
			</div>
			<div style="font-size:12px;color:var(--text-muted);letter-spacing:2px">LOADING ERP DATA...</div>
		</div>

		<!-- OVERVIEW -->
		<div class="aia-view active" id="aia-view-dashboard">

			<div class="aia-kpi-grid">
				<div class="aia-kpi aia-kpi-green">
					<div class="aia-kpi-label">Total Receivables</div>
					<div class="aia-kpi-value" id="aia-kpi-rec">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-rec-sub">Loading...</div>
				</div>
				<div class="aia-kpi aia-kpi-red">
					<div class="aia-kpi-label">Overdue Amount</div>
					<div class="aia-kpi-value" id="aia-kpi-od">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-od-sub">Loading...</div>
				</div>
				<div class="aia-kpi aia-kpi-orange">
					<div class="aia-kpi-label">Payables Due</div>
					<div class="aia-kpi-value" id="aia-kpi-pay">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-pay-sub">Loading...</div>
				</div>
				<div class="aia-kpi aia-kpi-purple">
					<div class="aia-kpi-label">MTD Sales</div>
					<div class="aia-kpi-value" id="aia-kpi-sales">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-sales-sub">Loading...</div>
				</div>
			</div>

			<div class="aia-panel-grid">
				<div class="aia-panel">
					<div class="aia-panel-header">
						<div class="aia-panel-title">🚨 Overdue Customers</div>
						<span class="aia-badge aia-badge-red" id="aia-overdue-count">—</span>
					</div>
					<table class="aia-table">
						<thead><tr><th>Customer</th><th>Amount</th><th>Days</th><th>Action</th></tr></thead>
						<tbody id="aia-overdue-rows">
							<tr><td colspan="4" class="aia-empty-row">Loading...</td></tr>
						</tbody>
					</table>
				</div>

				<div class="aia-panel">
					<div class="aia-panel-header">
						<div class="aia-panel-title">💳 Suppliers to Pay</div>
						<span class="aia-badge aia-badge-orange" id="aia-payables-count">—</span>
					</div>
					<table class="aia-table">
						<thead><tr><th>Supplier</th><th>Amount</th><th>Due</th></tr></thead>
						<tbody id="aia-payables-rows">
							<tr><td colspan="3" class="aia-empty-row">Loading...</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>

		<!-- RECEIVABLES -->
		<div class="aia-view" id="aia-view-receivables">
			<div class="aia-view-header">💰 Customer Receivables</div>
			<div class="aia-panel">
				<div class="aia-panel-header">
					<div class="aia-panel-title">All Outstanding Invoices</div>
				</div>
				<table class="aia-table">
					<thead><tr><th>Customer</th><th>Amount</th><th>Days Overdue</th><th>Action</th></tr></thead>
					<tbody id="aia-overdue-rows-full">
						<tr><td colspan="4" class="aia-empty-row">Loading...</td></tr>
					</tbody>
				</table>
			</div>
		</div>

		<!-- PAYABLES -->
		<div class="aia-view" id="aia-view-payables">
			<div class="aia-view-header">🧾 Supplier Payables</div>
			<div class="aia-panel">
				<div class="aia-panel-header">
					<div class="aia-panel-title">Bills to Pay</div>
				</div>
				<table class="aia-table">
					<thead><tr><th>Supplier</th><th>Amount</th><th>Due</th></tr></thead>
					<tbody id="aia-payables-rows-full">
						<tr><td colspan="3" class="aia-empty-row">Loading...</td></tr>
					</tbody>
				</table>
			</div>
		</div>

		<!-- INVENTORY -->
		<div class="aia-view" id="aia-view-inventory">
			<div class="aia-view-header">📦 Reorder Alerts</div>
			<div class="aia-panel">
				<div class="aia-panel-header">
					<div class="aia-panel-title">Items Below Reorder Level</div>
					<span class="aia-badge aia-badge-orange" id="aia-stock-count">—</span>
				</div>
				<table class="aia-table">
					<thead><tr><th>Item</th><th>Current Stock</th><th>Reorder Level</th><th>Status</th></tr></thead>
					<tbody id="aia-stock-rows">
						<tr><td colspan="4" class="aia-empty-row">Loading...</td></tr>
					</tbody>
				</table>
			</div>
		</div>

		<!-- SALES -->
		<div class="aia-view" id="aia-view-sales">
			<div class="aia-view-header">📈 Sales Report</div>
			<div class="aia-panel-grid">
				<div class="aia-panel">
					<div class="aia-panel-header"><div class="aia-panel-title">6-Month Revenue Trend</div></div>
					<div style="padding:20px 16px" id="aia-sales-chart">
						<div class="aia-empty-row">Loading chart...</div>
					</div>
				</div>
				<div class="aia-panel">
					<div class="aia-panel-header"><div class="aia-panel-title">Top Customers (12 months)</div></div>
					<table class="aia-table">
						<thead><tr><th>#</th><th>Customer</th><th>Revenue</th><th>Orders</th></tr></thead>
						<tbody id="aia-top-customers-rows">
							<tr><td colspan="4" class="aia-empty-row">Loading...</td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>

		<!-- AI ADVISOR -->
		<div class="aia-view" id="aia-view-advisor">
			<div class="aia-view-header">🤖 AI Business Advisor</div>
			<div class="aia-panel aia-chat-panel">
				<div class="aia-quick-bar">
					<button class="aia-quick-btn" data-q="Who are my highest risk debtors right now? Rank them and tell me exactly what to do.">🚨 High Risk Debtors</button>
					<button class="aia-quick-btn" data-q="Which products should I reorder urgently based on current stock and sales velocity?">📦 Urgent Reorders</button>
					<button class="aia-quick-btn" data-q="Which suppliers should I pay first this week? Give me a prioritized payment plan.">💳 Pay Priority</button>
					<button class="aia-quick-btn" data-q="What are my top 5 revenue growth opportunities right now based on customer and sales data?">💡 Opportunities</button>
					<button class="aia-quick-btn" data-q="Forecast my cash flow for the next 30 days based on receivables and payables.">💧 Cash Forecast</button>
				</div>
				<div class="aia-chat-messages" id="aia-chat-messages">
					<div class="aia-chat-empty">
						<div class="aia-chat-empty-icon">🤖</div>
						<div>Ask me anything about your business.<br>I have live access to your ERPNext data.</div>
					</div>
				</div>
				<div class="aia-chat-input-row">
					<input 
						class="aia-chat-input" 
						id="aia-chat-input" 
						placeholder="Ask about customers, payments, stock, sales..." 
					/>
					<button class="aia-send-btn" id="aia-send-btn" onclick="sendChatMsg()">↑</button>
				</div>
			</div>
		</div>

	</div>
</div>`;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
function injectStyles() {
	if (document.getElementById('aia-styles')) return;
	const style = document.createElement('style');
	style.id = 'aia-styles';
	style.textContent = `
		.aia-wrap {
			display: flex;
			height: calc(100vh - 110px);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			font-size: 13px;
			color: var(--text-color);
			gap: 0;
		}

		/* SIDEBAR */
		.aia-sidebar {
			width: 220px;
			min-width: 220px;
			border-right: 1px solid var(--border-color);
			display: flex;
			flex-direction: column;
			gap: 0;
			background: var(--card-bg);
			padding-bottom: 16px;
		}

		.aia-brand {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 16px 14px;
			border-bottom: 1px solid var(--border-color);
		}
		.aia-brand-dot {
			width: 10px; height: 10px;
			border-radius: 50%;
			background: #00e5a0;
			box-shadow: 0 0 8px #00e5a0;
			flex-shrink: 0;
			animation: aia-pulse 2s infinite;
		}
		@keyframes aia-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
		.aia-brand-sub { font-size: 9px; color: var(--text-muted); letter-spacing: 2px; }
		.aia-brand-name { font-size: 16px; font-weight: 700; }

		.aia-key-status {
			padding: 8px 14px;
			font-size: 11px;
			border-bottom: 1px solid var(--border-color);
		}

		.aia-nav { display: flex; flex-direction: column; gap: 2px; padding: 8px; flex: 1; }
		.aia-nav-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: 6px;
			cursor: pointer;
			color: var(--text-muted);
			font-size: 12px;
			transition: all 0.15s;
		}
		.aia-nav-item:hover { background: var(--control-bg); color: var(--text-color); }
		.aia-nav-item.active { background: rgba(0,229,160,0.1); color: #00e5a0; font-weight: 600; }

		.aia-quick-section {
			padding: 8px;
			border-top: 1px solid var(--border-color);
		}
		.aia-quick-label {
			font-size: 9px;
			letter-spacing: 2px;
			color: var(--text-muted);
			padding: 4px 2px 6px;
		}
		.aia-quick-btn {
			display: block;
			width: 100%;
			text-align: left;
			background: var(--control-bg);
			border: 1px solid var(--border-color);
			border-radius: 5px;
			padding: 6px 10px;
			font-size: 11px;
			cursor: pointer;
			margin-bottom: 4px;
			color: var(--text-color);
			transition: all 0.15s;
			font-family: inherit;
		}
		.aia-quick-btn:hover { border-color: #00e5a0; color: #00e5a0; background: rgba(0,229,160,0.04); }

		/* MAIN */
		.aia-main {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			position: relative;
		}

		/* Spinner */
		.aia-spinner {
			display: none;
			position: absolute;
			inset: 0;
			background: rgba(255,255,255,0.7);
			z-index: 100;
			align-items: center;
			justify-content: center;
			flex-direction: column;
			gap: 12px;
		}
		.aia-spinner-dots { display: flex; gap: 6px; }
		.aia-spinner-dots span {
			width: 8px; height: 8px;
			border-radius: 50%;
			background: #00e5a0;
			animation: aia-bounce 1.2s infinite;
		}
		.aia-spinner-dots span:nth-child(2) { animation-delay: .2s; }
		.aia-spinner-dots span:nth-child(3) { animation-delay: .4s; }
		@keyframes aia-bounce { 0%,60%,100%{transform:translateY(0);opacity:.4} 30%{transform:translateY(-6px);opacity:1} }

		/* VIEWS */
		.aia-view { display: none; }
		.aia-view.active { display: block; }
		.aia-view-header {
			font-size: 18px;
			font-weight: 700;
			margin-bottom: 16px;
		}

		/* KPI GRID */
		.aia-kpi-grid {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			gap: 12px;
			margin-bottom: 16px;
		}
		.aia-kpi {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 10px;
			padding: 16px;
			border-top: 3px solid transparent;
		}
		.aia-kpi-green { border-top-color: #00e5a0; }
		.aia-kpi-red { border-top-color: #ff6b6b; }
		.aia-kpi-orange { border-top-color: #ffb347; }
		.aia-kpi-purple { border-top-color: #7c6cfa; }
		.aia-kpi-label { font-size: 10px; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; }
		.aia-kpi-value { font-size: 22px; font-weight: 700; margin: 6px 0 3px; line-height: 1; }
		.aia-kpi-sub { font-size: 11px; color: var(--text-muted); }

		/* PANEL */
		.aia-panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
		.aia-panel {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 10px;
			overflow: hidden;
			margin-bottom: 16px;
		}
		.aia-panel-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12px 16px;
			border-bottom: 1px solid var(--border-color);
		}
		.aia-panel-title { font-weight: 600; font-size: 13px; }

		/* TABLE */
		.aia-table { width: 100%; border-collapse: collapse; }
		.aia-table th {
			font-size: 10px;
			letter-spacing: 1px;
			text-transform: uppercase;
			color: var(--text-muted);
			padding: 8px 16px;
			text-align: left;
			border-bottom: 1px solid var(--border-color);
			font-weight: 500;
		}
		.aia-table td { padding: 9px 16px; border-bottom: 1px solid var(--border-color); }
		.aia-table tr:last-child td { border-bottom: none; }
		.aia-table tr:hover td { background: var(--control-bg); }
		.aia-empty-row { text-align: center; padding: 24px; color: var(--text-muted); font-size: 12px; }

		/* BADGES */
		.aia-badge { font-size: 10px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
		.aia-badge-red { background: rgba(255,107,107,0.12); color: #ff6b6b; border: 1px solid rgba(255,107,107,0.2); }
		.aia-badge-orange { background: rgba(255,179,71,0.12); color: #ffb347; border: 1px solid rgba(255,179,71,0.2); }
		.aia-badge-yellow { background: rgba(255,220,100,0.12); color: #dba800; border: 1px solid rgba(255,220,100,0.2); }
		.aia-badge-green { background: rgba(0,229,160,0.1); color: #00c986; border: 1px solid rgba(0,229,160,0.2); }

		/* MINI BTN */
		.aia-mini-btn {
			background: var(--control-bg);
			border: 1px solid var(--border-color);
			border-radius: 4px;
			padding: 3px 8px;
			font-size: 11px;
			cursor: pointer;
			font-family: inherit;
			transition: all 0.15s;
		}
		.aia-mini-btn:hover { border-color: #00e5a0; }

		/* BAR CHART */
		.aia-bar-row { margin-bottom: 10px; }
		.aia-bar-label { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; color: var(--text-muted); }
		.aia-bar-track { background: var(--control-bg); border-radius: 3px; height: 6px; overflow: hidden; }
		.aia-bar-fill { height: 100%; border-radius: 3px; background: #7c6cfa; transition: width 0.8s ease; }
		.aia-bar-peak { background: #00e5a0; }

		/* CHAT */
		.aia-chat-panel { display: flex; flex-direction: column; height: calc(100vh - 200px); }
		.aia-quick-bar {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			padding: 10px 14px;
			border-bottom: 1px solid var(--border-color);
		}
		.aia-quick-bar .aia-quick-btn { display: inline-block; width: auto; margin: 0; }
		.aia-chat-messages {
			flex: 1;
			overflow-y: auto;
			padding: 16px;
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.aia-chat-empty {
			text-align: center;
			margin: auto;
			color: var(--text-muted);
			font-size: 13px;
			line-height: 1.8;
		}
		.aia-chat-empty-icon { font-size: 36px; margin-bottom: 10px; opacity: 0.5; }
		.aia-msg { display: flex; gap: 8px; max-width: 85%; }
		.aia-msg-user { flex-direction: row-reverse; align-self: flex-end; }
		.aia-msg-avatar { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--control-bg); }
		.aia-msg-bubble {
			background: var(--control-bg);
			border: 1px solid var(--border-color);
			border-radius: 8px;
			padding: 10px 14px;
			font-size: 12px;
			line-height: 1.7;
		}
		.aia-msg-user .aia-msg-bubble { background: rgba(0,229,160,0.07); border-color: rgba(0,229,160,0.2); }
		.aia-typing { display: flex; gap: 4px; align-items: center; }
		.aia-typing span { width: 6px; height: 6px; background: #00e5a0; border-radius: 50%; animation: aia-bounce 1.2s infinite; }
		.aia-typing span:nth-child(2) { animation-delay: .2s; }
		.aia-typing span:nth-child(3) { animation-delay: .4s; }
		.aia-chat-input-row {
			display: flex;
			gap: 8px;
			padding: 12px 14px;
			border-top: 1px solid var(--border-color);
		}
		.aia-chat-input {
			flex: 1;
			border: 1px solid var(--border-color);
			border-radius: 6px;
			padding: 8px 12px;
			font-family: inherit;
			font-size: 13px;
			background: var(--control-bg);
			color: var(--text-color);
			outline: none;
			transition: border-color 0.2s;
		}
		.aia-chat-input:focus { border-color: #00e5a0; }
		.aia-send-btn {
			background: #00e5a0;
			color: #000;
			border: none;
			border-radius: 6px;
			width: 36px;
			font-size: 16px;
			cursor: pointer;
			font-weight: 700;
			transition: opacity 0.15s;
		}
		.aia-send-btn:hover { opacity: 0.8; }
		.aia-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }

		@media (max-width: 1024px) {
			.aia-kpi-grid { grid-template-columns: repeat(2, 1fr); }
			.aia-panel-grid { grid-template-columns: 1fr; }
		}
	`;
	document.head.appendChild(style);
}
