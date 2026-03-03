frappe.pages['ai_advisor'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: '🤖 AI Business Advisor',
		single_column: true
	});

	injectStyles();
	$(wrapper).find('.layout-main-section').html(getDashboardHTML());
	initApp(page);
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let appState = {
	data: null,
	loading: false,
	currentView: 'dashboard',
	hasKey: false,
};

// ─── INIT ────────────────────────────────────────────────────────────────────
function initApp(page) {
	page.add_button('↻ Refresh', () => loadData(), { btn_class: 'btn-default' });
	page.add_button('⚙ Settings', () => showSettings(), { btn_class: 'btn-default' });

	document.querySelectorAll('.aia-nav-item').forEach(el => {
		el.addEventListener('click', () => {
			const view = el.dataset.view;
			switchView(view);
			document.querySelectorAll('.aia-nav-item').forEach(n => n.classList.remove('active'));
			el.classList.add('active');
		});
	});

	document.querySelectorAll('.aia-quick-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const q = btn.dataset.q;
			if (q) askClaude(q);
		});
	});

	const chatInput = document.getElementById('aia-chat-input');
	if (chatInput) {
		chatInput.addEventListener('keypress', e => {
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
		});
	}

	checkSettings();
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
	el.innerHTML = hasKey
		? `<span style="color:#00e5a0">✅ Claude connected (${preview})</span>`
		: `<span style="color:#ff6b6b">⚠️ API key not set — ⚙ Settings</span>`;
}

function showSettings() {
	const d = new frappe.ui.Dialog({
		title: 'AI Advisor Settings',
		fields: [
			{
				label: 'Claude API Key', fieldname: 'claude_api_key', fieldtype: 'Password',
				description: 'Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>.', reqd: 1
			},
			{
				label: 'Info', fieldname: 'info_html', fieldtype: 'HTML',
				options: `<div style="background:#f8f9fa;padding:12px;border-radius:6px;font-size:12px;line-height:1.6">
					<b>Steps:</b><br>1. Go to <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a><br>
					2. Sign up → API Keys → Create Key<br>3. Copy key (starts with <code>sk-ant-</code>)<br>4. Paste above and Save<br><br>
					<b>Cost:</b> ~$0.003/query. 50 queries/day ≈ KES 580/month.
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
				appState.hasKey = true; checkSettings(); d.hide();
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
			frappe.show_alert({ message: '⚠️ ' + (r.message?.error || 'Could not load data'), indicator: 'orange' });
		}
	} catch(e) {
		frappe.show_alert({ message: 'Error: ' + e.message, indicator: 'red' });
	}
	setLoading(false);
}

function setLoading(v) {
	appState.loading = v;
	const s = document.getElementById('aia-spinner');
	if (s) s.style.display = v ? 'flex' : 'none';
}

// ─── MASTER RENDER ────────────────────────────────────────────────────────────
function renderAllData(d) {
	const kpi = d.kpis || {};

	// KPI Cards
	setText('aia-kpi-bank',      fmt(kpi.total_bank_balance || 0));
	setText('aia-kpi-bank-sub',  `Net after 30d: ${fmt(kpi.net_cash_after_30day_dues || 0)}`);
	setText('aia-kpi-rec',       fmt(kpi.total_receivables || 0));
	setText('aia-kpi-rec-sub',   `${kpi.open_invoices || 0} open invoices`);
	setText('aia-kpi-od',        fmt(kpi.total_overdue || 0));
	setText('aia-kpi-od-sub',    `${kpi.overdue_count || 0} overdue`);
	setText('aia-kpi-pay',       fmt(kpi.total_payables || 0));
	setText('aia-kpi-pay-sub',   `Due this week: ${fmt(kpi.due_this_week || 0)}`);
	setText('aia-kpi-sales',     fmt(kpi.mtd_sales || 0));
	setText('aia-kpi-sales-sub', 'Month to date');

	// Cash cover banner
	const coverEl = document.getElementById('aia-cash-cover');
	if (coverEl) {
		const cw = kpi.can_cover_week_dues, cm = kpi.can_cover_30day_dues;
		const bank = kpi.total_bank_balance || 0;
		const dw = kpi.due_this_week || 0, d30 = kpi.due_next_30_days || 0;
		coverEl.innerHTML = `
			<div class="aia-cash-indicator ${cw?'ok':'warn'}">
				${cw?'✅':'⚠️'} <b>This week:</b> Bank ${fmt(bank)} vs ${fmt(dw)} due —
				${cw ? 'Fully covered' : '<span style="color:#ff6b6b">SHORTFALL ' + fmt(dw - bank) + '</span>'}
			</div>
			<div class="aia-cash-indicator ${cm?'ok':'warn'}" style="margin-top:6px">
				${cm?'✅':'⚠️'} <b>Next 30 days:</b> ${fmt(d30)} due —
				${cm ? 'Fully covered' : '<span style="color:#ff6b6b">SHORTFALL ' + fmt(d30 - bank) + '</span>'}
			</div>`;
	}

	// Dashboard widgets
	renderOverdueWidget(d.overdue_customers || []);
	// FIX: use suppliers_to_pay (grouped) — fall back to all_payables if not present
	renderPayablesWidget(d.suppliers_to_pay || d.all_payables || []);

	// Full tab views
	renderReceivablesFull(d.overdue_customers || [], kpi);
	renderPayablesFull(d.suppliers_to_pay || [], d.all_payables || [], kpi);
	// FIX: use low_stock_reorder (correct key from Python)
	renderInventoryFull(d.low_stock_reorder || [], d.fast_moving_items || [], d.slow_moving_items || [], d.dead_stock_items || []);
	renderSalesReport(d);
}

// ─── OVERVIEW: OVERDUE WIDGET ─────────────────────────────────────────────────
function renderOverdueWidget(rows) {
	const el = document.getElementById('aia-overdue-rows');
	if (!el) return;
	setText('aia-overdue-count', `${rows.length} overdue`);
	if (!rows.length) {
		el.innerHTML = `<tr><td colspan="4" class="aia-empty-row">✅ No overdue customers</td></tr>`;
		return;
	}
	el.innerHTML = rows.slice(0, 8).map(r => {
		const cls = r.days_overdue > 60 ? 'aia-badge-red' : r.days_overdue > 30 ? 'aia-badge-orange' : 'aia-badge-yellow';
		return `<tr>
			<td><b>${r.customer}</b></td>
			<td style="color:#ff6b6b;font-weight:600">${fmt(r.amount)}</td>
			<td><span class="aia-badge ${cls}">${r.days_overdue}d</span></td>
			<td><button class="aia-mini-btn" onclick="draftFollowup('${esc(r.customer)}','${fmt(r.amount)}',${r.days_overdue})">✉️</button></td>
		</tr>`;
	}).join('');
}

// ─── OVERVIEW: PAYABLES WIDGET ────────────────────────────────────────────────
function renderPayablesWidget(rows) {
	const el = document.getElementById('aia-payables-rows');
	if (!el) return;
	setText('aia-payables-count', `${rows.length} suppliers`);
	if (!rows.length) {
		el.innerHTML = `<tr><td colspan="3" class="aia-empty-row">✅ No outstanding payables</td></tr>`;
		return;
	}
	// supports both grouped (suppliers_to_pay) and flat (all_payables)
	el.innerHTML = rows.slice(0, 8).map(p => {
		const isGrouped = p.total_outstanding !== undefined;
		const amount = isGrouped ? p.total_outstanding : p.amount;
		const due    = isGrouped ? p.earliest_due    : p.due_date;
		let label, cls;
		if (!due || due === 'No due date' || due === 'None') {
			cls = 'aia-badge-red'; label = 'No due date';
		} else {
			const dl = Math.floor((new Date(due) - new Date()) / 86400000);
			cls   = dl < 0 ? 'aia-badge-red' : dl < 7 ? 'aia-badge-orange' : 'aia-badge-green';
			label = dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? 'Due today' : `${dl}d left`;
		}
		return `<tr>
			<td><b>${p.supplier}</b></td>
			<td style="color:#ffb347;font-weight:600">${fmt(amount)}</td>
			<td><span class="aia-badge ${cls}">${label}</span></td>
		</tr>`;
	}).join('');
}

// ─── RECEIVABLES FULL VIEW ────────────────────────────────────────────────────
function renderReceivablesFull(overdue, kpis) {
	const el = document.getElementById('aia-receivables-body');
	if (!el) return;

	if (!overdue.length) {
		el.innerHTML = `<div class="aia-empty-state">✅ No overdue receivables — all customers are current.</div>`;
		return;
	}

	const over60  = overdue.filter(r => r.days_overdue > 60);
	const over30  = overdue.filter(r => r.days_overdue > 30 && r.days_overdue <= 60);
	const under30 = overdue.filter(r => r.days_overdue <= 30);
	const buckets = [
		{ label: '1–30 days',  items: under30, cls: 'aia-badge-yellow' },
		{ label: '31–60 days', items: over30,  cls: 'aia-badge-orange' },
		{ label: '60+ days',   items: over60,  cls: 'aia-badge-red'    },
	];

	el.innerHTML = `
		<div class="aia-aging-strip">
			${buckets.map(b => `
				<div class="aia-aging-bucket">
					<div class="aia-aging-label">${b.label}</div>
					<div class="aia-aging-amount">${fmt(b.items.reduce((s,r)=>s+r.amount,0))}</div>
					<div class="aia-aging-count">${b.items.length} invoice${b.items.length!==1?'s':''}</div>
				</div>
				<div class="aia-aging-divider"></div>`).join('')}
			<div class="aia-aging-bucket aia-aging-total">
				<div class="aia-aging-label">TOTAL OVERDUE</div>
				<div class="aia-aging-amount" style="color:#ff6b6b">${fmt(overdue.reduce((s,r)=>s+r.amount,0))}</div>
				<div class="aia-aging-count">${overdue.length} invoices</div>
			</div>
		</div>
		<div class="aia-panel" style="margin-top:14px">
			<div class="aia-panel-header">
				<div class="aia-panel-title">All Overdue Invoices</div>
				<button class="aia-mini-btn" onclick="askClaude('List all overdue customers ranked by amount. For each give a collection priority and specific action to take today.')">🤖 AI Collection Plan</button>
			</div>
			<table class="aia-table">
				<thead><tr><th>Customer</th><th>Invoice</th><th>Amount</th><th>Due Date</th><th>Days Overdue</th><th>Territory</th><th>Action</th></tr></thead>
				<tbody>
					${overdue.map(r => {
						const cls = r.days_overdue > 60 ? 'aia-badge-red' : r.days_overdue > 30 ? 'aia-badge-orange' : 'aia-badge-yellow';
						return `<tr>
							<td><b>${r.customer}</b></td>
							<td style="font-size:11px;color:var(--text-muted)">${r.invoice||'—'}</td>
							<td style="color:#ff6b6b;font-weight:600">${fmt(r.amount)}</td>
							<td style="font-size:11px">${r.due_date||'—'}</td>
							<td><span class="aia-badge ${cls}">${r.days_overdue}d</span></td>
							<td style="font-size:11px;color:var(--text-muted)">${r.territory||'—'}</td>
							<td><button class="aia-mini-btn" onclick="draftFollowup('${esc(r.customer)}','${fmt(r.amount)}',${r.days_overdue})">✉️ Follow up</button></td>
						</tr>`;
					}).join('')}
				</tbody>
			</table>
		</div>`;
}

// ─── PAYABLES FULL VIEW ───────────────────────────────────────────────────────
function renderPayablesFull(grouped, flat, kpis) {
	const el = document.getElementById('aia-payables-body');
	if (!el) return;

	// prefer grouped view; fall back to flat
	const rows = grouped.length ? grouped : flat;
	if (!rows.length) {
		el.innerHTML = `<div class="aia-empty-state">✅ No outstanding payables.</div>`;
		return;
	}

	const bank  = kpis.total_bank_balance  || 0;
	const dueW  = kpis.due_this_week       || 0;
	const due30 = kpis.due_next_30_days    || 0;
	const total = kpis.total_payables      || 0;
	const isGrouped = rows[0].total_outstanding !== undefined;

	el.innerHTML = `
		<div class="aia-pay-position">
			<div class="aia-pay-pos-item">
				<div class="aia-pay-pos-label">Bank Balance</div>
				<div class="aia-pay-pos-val" style="color:#00e5a0">${fmt(bank)}</div>
			</div>
			<div class="aia-pay-pos-arrow">→</div>
			<div class="aia-pay-pos-item">
				<div class="aia-pay-pos-label">Due This Week</div>
				<div class="aia-pay-pos-val" style="color:${bank>=dueW?'#00e5a0':'#ff6b6b'}">${fmt(dueW)}</div>
			</div>
			<div class="aia-pay-pos-arrow">→</div>
			<div class="aia-pay-pos-item">
				<div class="aia-pay-pos-label">Due Next 30 Days</div>
				<div class="aia-pay-pos-val" style="color:${bank>=due30?'#00e5a0':'#ff6b6b'}">${fmt(due30)}</div>
			</div>
			<div class="aia-pay-pos-arrow">→</div>
			<div class="aia-pay-pos-item">
				<div class="aia-pay-pos-label">Total Outstanding</div>
				<div class="aia-pay-pos-val" style="color:#ffb347">${fmt(total)}</div>
			</div>
			<button class="aia-mini-btn" style="margin-left:auto" onclick="askClaude('Give me an exact payment schedule. Who to pay, how much, in what order, and which receivables to collect first if cash is tight.')">🤖 AI Payment Plan</button>
		</div>
		<div class="aia-panel" style="margin-top:14px">
			<div class="aia-panel-header">
				<div class="aia-panel-title">Suppliers to Pay — Priority Order</div>
			</div>
			<table class="aia-table">
				<thead><tr><th>Supplier</th><th>Amount Due</th><th>Earliest Due</th><th>Invoices</th><th>Status</th></tr></thead>
				<tbody>
					${rows.map(p => {
						const amount  = isGrouped ? p.total_outstanding : p.amount;
						const due     = isGrouped ? p.earliest_due      : p.due_date;
						const invCnt  = isGrouped ? p.invoice_count      : 1;
						let label, cls;
						if (!due || due === 'No due date' || due === 'None') {
							cls = 'aia-badge-red'; label = 'No due date';
						} else {
							const dl = Math.floor((new Date(due) - new Date()) / 86400000);
							cls   = dl < 0 ? 'aia-badge-red' : dl < 7 ? 'aia-badge-orange' : 'aia-badge-green';
							label = dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? 'Due today' : `Due in ${dl}d`;
						}
						return `<tr>
							<td><b>${p.supplier}</b></td>
							<td style="color:#ffb347;font-weight:600">${fmt(amount)}</td>
							<td style="font-size:11px">${due||'—'}</td>
							<td style="font-size:11px;color:var(--text-muted)">${invCnt} invoice${invCnt!==1?'s':''}</td>
							<td><span class="aia-badge ${cls}">${label}</span></td>
						</tr>`;
					}).join('')}
				</tbody>
			</table>
		</div>`;
}

// ─── INVENTORY FULL VIEW ──────────────────────────────────────────────────────
function renderInventoryFull(lowStock, fast, slow, dead) {
	// FIX: update the badge count in the view header
	setText('aia-stock-count', `${lowStock.length} items low`);

	const el = document.getElementById('aia-inventory-body');
	if (!el) return;

	const reorderHtml = lowStock.length ? `
		<div class="aia-panel" style="margin-bottom:14px">
			<div class="aia-panel-header">
				<div class="aia-panel-title">🔴 Items Below Reorder Level</div>
				<button class="aia-mini-btn" onclick="askClaude('Which items are critically low? Give exact order quantities, suggested suppliers and urgency for each.')">🤖 AI Order Plan</button>
			</div>
			<table class="aia-table">
				<thead><tr><th>Item</th><th>Warehouse</th><th>In Stock</th><th>Reorder Level</th><th>Reorder Qty</th><th>Buy Price</th><th>Status</th></tr></thead>
				<tbody>
					${lowStock.map(s => {
						const pct = s.reorder_level > 0 ? Math.round(s.stock / s.reorder_level * 100) : 0;
						const cls = pct < 30 ? 'aia-badge-red' : pct < 60 ? 'aia-badge-orange' : 'aia-badge-yellow';
						return `<tr>
							<td><b>${s.name||s.item}</b><br><span style="font-size:10px;color:var(--text-muted)">${s.item}</span></td>
							<td style="font-size:11px;color:var(--text-muted)">${s.warehouse||'—'}</td>
							<td><b style="color:#ff6b6b">${s.stock}</b> ${s.uom}</td>
							<td>${s.reorder_level} ${s.uom}</td>
							<td style="color:#00e5a0;font-weight:600">${s.reorder_qty>0?s.reorder_qty+' '+s.uom:'—'}</td>
							<td style="font-size:11px">${s.buying_price>0?fmt(s.buying_price):'—'}</td>
							<td><span class="aia-badge ${cls}">${pct}% of level</span></td>
						</tr>`;
					}).join('')}
				</tbody>
			</table>
		</div>` : `<div class="aia-empty-state" style="margin-bottom:14px">✅ All items are above reorder level.</div>`;

	const fastHtml = fast.length ? `
		<div class="aia-panel" style="margin-bottom:14px">
			<div class="aia-panel-header">
				<div class="aia-panel-title">🟢 Fast Moving Items <span style="font-size:11px;font-weight:400;color:var(--text-muted)">sold last 90 days</span></div>
			</div>
			<table class="aia-table">
				<thead><tr><th>Item</th><th>Qty Sold</th><th>Revenue</th><th>Last Sold</th></tr></thead>
				<tbody>${fast.slice(0,15).map(i=>`<tr>
					<td><b>${i.name||i.item}</b></td>
					<td>${i.qty_sold}</td>
					<td style="color:#00e5a0;font-weight:600">${fmt(i.revenue)}</td>
					<td style="font-size:11px;color:var(--text-muted)">${i.last_sold}</td>
				</tr>`).join('')}</tbody>
			</table>
		</div>` : '';

	const slowHtml = slow.length ? `
		<div class="aia-panel" style="margin-bottom:14px">
			<div class="aia-panel-header">
				<div class="aia-panel-title">🟡 Slow Moving Items <span style="font-size:11px;font-weight:400;color:var(--text-muted)">90–180 days</span></div>
				<button class="aia-mini-btn" onclick="askClaude('Which slow moving items should I discount? Give a specific discount % for each to clear stock quickly.')">🤖 Discount Strategy</button>
			</div>
			<table class="aia-table">
				<thead><tr><th>Item</th><th>Qty Sold</th><th>Revenue</th><th>Last Sold</th><th>Action</th></tr></thead>
				<tbody>${slow.slice(0,15).map(i=>`<tr>
					<td><b>${i.name||i.item}</b></td>
					<td style="color:var(--text-muted)">${i.qty_sold}</td>
					<td style="color:#ffb347">${fmt(i.revenue)}</td>
					<td style="font-size:11px;color:var(--text-muted)">${i.last_sold}</td>
					<td><span class="aia-badge aia-badge-yellow">Consider discount</span></td>
				</tr>`).join('')}</tbody>
			</table>
		</div>` : '';

	const deadHtml = dead.length ? `
		<div class="aia-panel">
			<div class="aia-panel-header">
				<div class="aia-panel-title">🔴 Dead Stock <span style="font-size:11px;font-weight:400;color:var(--text-muted)">180+ days no sales</span></div>
			</div>
			<table class="aia-table">
				<thead><tr><th>Item</th><th>Qty Sold (yr)</th><th>Last Sold</th><th>Recommendation</th></tr></thead>
				<tbody>${dead.slice(0,15).map(i=>`<tr>
					<td><b>${i.name||i.item}</b></td>
					<td style="color:var(--text-muted)">${i.qty_sold}</td>
					<td style="font-size:11px;color:#ff6b6b">${i.last_sold}</td>
					<td><span class="aia-badge aia-badge-red">Stop reordering</span></td>
				</tr>`).join('')}</tbody>
			</table>
		</div>` : '';

	el.innerHTML = reorderHtml + fastHtml + slowHtml + deadHtml;
}

// ─── SALES REPORT (CFO GRADE) ─────────────────────────────────────────────────
function renderSalesReport(d) {
	const el = document.getElementById('aia-sales-body');
	if (!el) return;

	const kpis        = d.kpis || {};
	const trend       = d.sales_trend || [];
	const territories = d.sales_by_territory || [];
	const topCust     = d.top_customers || [];
	const fast        = d.fast_moving_items || [];
	const forecast    = (d.seasonal_forecast_this_month || {}).items || [];
	const nextFc      = (d.seasonal_forecast_next_month  || {}).items || [];
	const mtdName     = (d.seasonal_forecast_this_month  || {}).month_name || '';
	const nextName    = (d.seasonal_forecast_next_month  || {}).month_name || '';

	const amounts = trend.map(t => t.amount);
	const maxAmt  = Math.max(...amounts, 1);
	const total6m = amounts.reduce((a, b) => a + b, 0);
	const avg6m   = trend.length ? total6m / trend.length : 0;
	const last2   = amounts.slice(-2);
	const mom     = last2.length === 2 && last2[0] > 0 ? ((last2[1]-last2[0])/last2[0]*100).toFixed(1) : null;
	const totTerr = territories.reduce((s, t) => s + t.revenue, 0);

	el.innerHTML = `
	<!-- Executive Summary -->
	<div class="aia-exec-banner">
		<div class="aia-exec-stat">
			<div class="aia-exec-label">MTD Revenue</div>
			<div class="aia-exec-val">${fmt(kpis.mtd_sales||0)}</div>
		</div>
		<div class="aia-exec-divider"></div>
		<div class="aia-exec-stat">
			<div class="aia-exec-label">6-Month Total</div>
			<div class="aia-exec-val">${fmt(total6m)}</div>
		</div>
		<div class="aia-exec-divider"></div>
		<div class="aia-exec-stat">
			<div class="aia-exec-label">Monthly Average</div>
			<div class="aia-exec-val">${fmt(avg6m)}</div>
		</div>
		<div class="aia-exec-divider"></div>
		<div class="aia-exec-stat">
			<div class="aia-exec-label">MoM Change</div>
			<div class="aia-exec-val" style="color:${mom===null?'inherit':parseFloat(mom)>=0?'#00e5a0':'#ff6b6b'}">
				${mom===null ? '—' : (parseFloat(mom)>=0?'▲':'▼')+' '+Math.abs(mom)+'%'}
			</div>
		</div>
		<div class="aia-exec-divider"></div>
		<div class="aia-exec-stat">
			<div class="aia-exec-label">Top Customers</div>
			<div class="aia-exec-val">${topCust.length}</div>
		</div>
		<div class="aia-exec-divider"></div>
		<div class="aia-exec-stat">
			<div class="aia-exec-label">Territories</div>
			<div class="aia-exec-val">${territories.length}</div>
		</div>
		<button class="aia-mini-btn" style="margin-left:auto;align-self:center"
			onclick="askClaude('Give me a complete CFO-level sales analysis: revenue trends, growth drivers, top customers, territory performance, product mix, and top 5 strategic recommendations.')">
			🤖 Full CFO Analysis
		</button>
	</div>

	<div class="aia-sales-grid">

		<!-- Revenue Trend Chart -->
		<div class="aia-panel aia-panel-wide">
			<div class="aia-panel-header">
				<div class="aia-panel-title">📊 Revenue Trend — Last 6 Months</div>
				${mom!==null ? `<span class="aia-badge ${parseFloat(mom)>=0?'aia-badge-green':'aia-badge-red'}">${parseFloat(mom)>=0?'▲':'▼'} ${Math.abs(mom)}% month-on-month</span>` : ''}
			</div>
			<div class="aia-chart-area">
				${trend.length ? trend.map(t => {
					const pct = Math.round(t.amount / maxAmt * 100);
					const isMax = t.amount === maxAmt;
					const isLast = t === trend[trend.length-1];
					return `<div class="aia-bar-col">
						<div class="aia-bar-val" style="color:${isLast?'#00e5a0':'var(--text-muted)'}">${fmt(t.amount)}</div>
						<div class="aia-bar-wrap">
							<div class="aia-bar-v ${isMax?'aia-bar-peak':''} ${isLast?'aia-bar-current':''}" style="height:${Math.max(pct,4)}%"></div>
						</div>
						<div class="aia-bar-month">${t.month}</div>
						<div style="font-size:9px;color:var(--text-muted);text-align:center">${t.count} orders</div>
					</div>`;
				}).join('') : '<div class="aia-empty-row">No trend data</div>'}
			</div>
		</div>

		<!-- Territory Performance -->
		<div class="aia-panel">
			<div class="aia-panel-header">
				<div class="aia-panel-title">🗺️ Revenue by Territory</div>
				<span style="font-size:11px;color:var(--text-muted)">Last 6 months</span>
			</div>
			${territories.length ? `
			<table class="aia-table">
				<thead><tr><th>Territory</th><th>Revenue</th><th>Share</th><th>Orders</th><th>Customers</th></tr></thead>
				<tbody>
					${territories.map((t, i) => {
						const share = totTerr > 0 ? (t.revenue/totTerr*100).toFixed(1) : 0;
						const barW  = territories[0].revenue > 0 ? Math.round(t.revenue/territories[0].revenue*80) : 0;
						return `<tr>
							<td>
								<div style="display:flex;align-items:center;gap:8px">
									<span style="font-size:10px;color:var(--text-muted);width:14px">${i+1}</span>
									<div>
										<b>${t.territory}</b>
										<div style="margin-top:3px;height:3px;width:${barW}px;background:${i===0?'#00e5a0':'#7c6cfa'};border-radius:2px"></div>
									</div>
								</div>
							</td>
							<td style="color:#00e5a0;font-weight:600">${fmt(t.revenue)}</td>
							<td style="font-size:11px;color:var(--text-muted)">${share}%</td>
							<td style="font-size:11px">${t.orders}</td>
							<td style="font-size:11px">${t.customers}</td>
						</tr>`;
					}).join('')}
				</tbody>
			</table>` : '<div class="aia-empty-row">No territory data</div>'}
		</div>

		<!-- Top Customers -->
		<div class="aia-panel">
			<div class="aia-panel-header">
				<div class="aia-panel-title">👥 Top Customers — Last 12 Months</div>
			</div>
			${topCust.length ? `
			<table class="aia-table">
				<thead><tr><th>#</th><th>Customer</th><th>Revenue</th><th>Orders</th><th>Territory</th></tr></thead>
				<tbody>
					${topCust.map((c,i) => `<tr>
						<td style="color:var(--text-muted);font-size:11px">${i+1}</td>
						<td><b>${c.customer}</b><br><span style="font-size:10px;color:var(--text-muted)">${c.group||''}</span></td>
						<td style="color:#00e5a0;font-weight:600">${fmt(c.revenue)}</td>
						<td style="font-size:11px">${c.orders}</td>
						<td style="font-size:11px;color:var(--text-muted)">${c.territory||'—'}</td>
					</tr>`).join('')}
				</tbody>
			</table>` : '<div class="aia-empty-row">No data</div>'}
		</div>

		<!-- Top Products -->
		<div class="aia-panel">
			<div class="aia-panel-header">
				<div class="aia-panel-title">📦 Top Selling Products — Last 12 Months</div>
			</div>
			${fast.length ? `
			<table class="aia-table">
				<thead><tr><th>#</th><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Last Sold</th></tr></thead>
				<tbody>
					${fast.slice(0,12).map((i,idx) => `<tr>
						<td style="color:var(--text-muted);font-size:11px">${idx+1}</td>
						<td><b>${i.name||i.item}</b><br><span style="font-size:10px;color:var(--text-muted)">${i.item}</span></td>
						<td style="font-size:11px">${i.qty_sold}</td>
						<td style="color:#00e5a0;font-weight:600">${fmt(i.revenue)}</td>
						<td style="font-size:11px;color:var(--text-muted)">${i.last_sold}</td>
					</tr>`).join('')}
				</tbody>
			</table>` : '<div class="aia-empty-row">No product data</div>'}
		</div>

		${forecast.length ? `
		<!-- Seasonal Forecast This Month -->
		<div class="aia-panel aia-panel-wide">
			<div class="aia-panel-header">
				<div class="aia-panel-title">🔮 Seasonal Sales Forecast — ${mtdName}</div>
				<div style="display:flex;gap:8px;align-items:center">
					<span style="font-size:11px;color:var(--text-muted)">Based on same month last 2 years</span>
					<button class="aia-mini-btn" onclick="askClaude('Based on the seasonal forecast, which items need urgent stock replenishment? Give exact order quantities and cost estimates.')">🤖 Order Plan</button>
				</div>
			</div>
			<table class="aia-table">
				<thead><tr><th>Item</th><th>Forecast Qty</th><th>Forecast Revenue</th><th>Current Stock</th><th>Order Qty Needed</th><th>Status</th></tr></thead>
				<tbody>
					${forecast.slice(0,15).map(f => `<tr>
						<td><b>${f.item_name}</b><br><span style="font-size:10px;color:var(--text-muted)">${f.item_code}</span></td>
						<td>${f.avg_qty_forecast}</td>
						<td style="color:#7c6cfa;font-weight:600">${fmt(f.avg_revenue_forecast)}</td>
						<td style="color:${f.current_stock<f.avg_qty_forecast?'#ff6b6b':'#00e5a0'};font-weight:600">${f.current_stock}</td>
						<td style="color:${f.recommended_order_qty>0?'#ffb347':'var(--text-muted)'};font-weight:600">
							${f.recommended_order_qty > 0 ? f.recommended_order_qty : '✅ Sufficient'}
						</td>
						<td><span class="aia-badge ${f.urgent?'aia-badge-red':'aia-badge-green'}">${f.urgent?'⚠️ URGENT ORDER':'✅ Covered'}</span></td>
					</tr>`).join('')}
				</tbody>
			</table>
		</div>` : ''}

		${nextFc.filter(f => f.order_now_for_next_month > 0).length ? `
		<!-- Next Month Order Plan -->
		<div class="aia-panel aia-panel-wide">
			<div class="aia-panel-header">
				<div class="aia-panel-title">📅 Order Now for Next Month — ${nextName}</div>
				<span style="font-size:11px;color:var(--text-muted)">Place purchase orders now to avoid stockouts next month</span>
			</div>
			<table class="aia-table">
				<thead><tr><th>Item</th><th>Expected Demand</th><th>Expected Revenue</th><th>Current Stock</th><th>Order Qty Now</th></tr></thead>
				<tbody>
					${nextFc.filter(f=>f.order_now_for_next_month>0).slice(0,10).map(f=>`<tr>
						<td><b>${f.item_name}</b></td>
						<td>${f.avg_qty_forecast}</td>
						<td style="color:#7c6cfa">${fmt(f.avg_revenue_forecast)}</td>
						<td style="color:var(--text-muted)">${f.current_stock}</td>
						<td style="color:#ffb347;font-weight:600">${f.order_now_for_next_month}</td>
					</tr>`).join('')}
				</tbody>
			</table>
		</div>` : ''}

	</div>`;
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
	switchView('advisor');
	document.querySelectorAll('.aia-nav-item').forEach(n => n.classList.remove('active'));
	document.querySelector('[data-view="advisor"]')?.classList.add('active');

	const chat = document.getElementById('aia-chat-messages');
	const empty = chat.querySelector('.aia-chat-empty');
	if (empty) empty.remove();

	addChatMsg(chat, 'user', question);
	const typing = addChatMsg(chat, 'ai', `<div class="aia-typing"><span></span><span></span><span></span></div>`);
	chat.scrollTop = chat.scrollHeight;

	const btn = document.getElementById('aia-send-btn');
	if (btn) btn.disabled = true;

	try {
		const r = await frappe.call({
			method: 'ai_advisor.api.claude_api.ask_claude',
			args: { question, context_data: JSON.stringify(appState.data || {}) }
		});
		const bubble = typing.querySelector('.aia-msg-bubble');
		bubble.innerHTML = r.message?.success
			? formatAIResponse(r.message.response)
			: `<span style="color:#ff6b6b">❌ ${r.message?.error || 'Unknown error'}</span>`;
	} catch(e) {
		typing.querySelector('.aia-msg-bubble').innerHTML = `<span style="color:#ff6b6b">❌ ${e.message}</span>`;
	}

	if (btn) btn.disabled = false;
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
	el.innerHTML = `<div class="aia-msg-avatar">${role==='ai'?'🤖':'👤'}</div><div class="aia-msg-bubble">${content}</div>`;
	container.appendChild(el);
	return el;
}

function formatAIResponse(text) {
	return text
		.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
		.replace(/^#{1,3}\s(.+)$/gm, '<div class="aia-resp-heading">$1</div>')
		.replace(/^[-•]\s(.+)$/gm, '<div class="aia-resp-bullet">• $1</div>')
		.replace(/\n\n/g, '<br><br>')
		.replace(/\n/g, '<br>');
}

async function draftFollowup(customer, amount, days) {
	await askClaude(`Draft a professional follow-up for ${customer} who owes ${amount} and is ${days} days overdue. Be firm but professional. Set a 7-day payment deadline. Format for WhatsApp.`);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function fmt(n) {
	n = parseFloat(n) || 0;
	if (n >= 1000000) return 'KES ' + (n/1000000).toFixed(2) + 'M';
	if (n >= 1000)    return 'KES ' + (n/1000).toFixed(1) + 'K';
	return 'KES ' + n.toFixed(0);
}
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function esc(s) { return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

// ─── HTML ────────────────────────────────────────────────────────────────────
function getDashboardHTML() { return `
<div class="aia-wrap">
	<div class="aia-sidebar">
		<div class="aia-brand">
			<div class="aia-brand-dot"></div>
			<div><div class="aia-brand-sub">POWERED BY CLAUDE</div><div class="aia-brand-name">AI Advisor</div></div>
		</div>
		<div class="aia-key-status" id="aia-key-status"><span style="color:var(--text-muted)">Checking...</span></div>
		<nav class="aia-nav">
			<div class="aia-nav-item active" data-view="dashboard"><span>📊</span> Overview</div>
			<div class="aia-nav-item" data-view="receivables"><span>💰</span> Receivables</div>
			<div class="aia-nav-item" data-view="payables"><span>🧾</span> Payables</div>
			<div class="aia-nav-item" data-view="inventory"><span>📦</span> Inventory</div>
			<div class="aia-nav-item" data-view="sales"><span>📈</span> Sales Report</div>
			<div class="aia-nav-item" data-view="advisor"><span>🤖</span> AI Advisor</div>
		</nav>
		<div class="aia-quick-section">
			<div class="aia-quick-label">QUICK ASKS</div>
			<button class="aia-quick-btn" data-q="Give me my morning business summary. What are the 3 most urgent things I must action today?">☀️ Morning Brief</button>
			<button class="aia-quick-btn" data-q="Who are my highest risk debtors right now and what should I do about each one?">🚨 Risk Alert</button>
			<button class="aia-quick-btn" data-q="Which suppliers should I prioritize paying this week? Give exact amounts and order.">💳 Pay Priority</button>
			<button class="aia-quick-btn" data-q="Give me a complete business health assessment with key metrics and top 5 recommendations.">❤️ Health Check</button>
		</div>
	</div>

	<div class="aia-main">
		<div class="aia-spinner" id="aia-spinner">
			<div class="aia-spinner-dots"><span></span><span></span><span></span></div>
			<div style="font-size:11px;color:var(--text-muted);letter-spacing:2px;margin-top:8px">LOADING ERP DATA...</div>
		</div>

		<!-- OVERVIEW -->
		<div class="aia-view active" id="aia-view-dashboard">
			<div class="aia-kpi-grid">
				<div class="aia-kpi aia-kpi-blue">
					<div class="aia-kpi-label">Bank Balance</div>
					<div class="aia-kpi-value" id="aia-kpi-bank">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-bank-sub">Loading...</div>
				</div>
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
					<div class="aia-kpi-label">Payables Outstanding</div>
					<div class="aia-kpi-value" id="aia-kpi-pay">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-pay-sub">Loading...</div>
				</div>
				<div class="aia-kpi aia-kpi-purple">
					<div class="aia-kpi-label">MTD Sales</div>
					<div class="aia-kpi-value" id="aia-kpi-sales">—</div>
					<div class="aia-kpi-sub" id="aia-kpi-sales-sub">Loading...</div>
				</div>
			</div>
			<div id="aia-cash-cover" class="aia-cash-cover-wrap"></div>
			<div class="aia-panel-grid">
				<div class="aia-panel">
					<div class="aia-panel-header">
						<div class="aia-panel-title">🚨 Overdue Customers</div>
						<span class="aia-badge aia-badge-red" id="aia-overdue-count">—</span>
					</div>
					<table class="aia-table">
						<thead><tr><th>Customer</th><th>Amount</th><th>Days</th><th></th></tr></thead>
						<tbody id="aia-overdue-rows"><tr><td colspan="4" class="aia-empty-row">Loading...</td></tr></tbody>
					</table>
				</div>
				<div class="aia-panel">
					<div class="aia-panel-header">
						<div class="aia-panel-title">💳 Suppliers to Pay</div>
						<span class="aia-badge aia-badge-orange" id="aia-payables-count">—</span>
					</div>
					<table class="aia-table">
						<thead><tr><th>Supplier</th><th>Amount</th><th>Due</th></tr></thead>
						<tbody id="aia-payables-rows"><tr><td colspan="3" class="aia-empty-row">Loading...</td></tr></tbody>
					</table>
				</div>
			</div>
		</div>

		<!-- RECEIVABLES -->
		<div class="aia-view" id="aia-view-receivables">
			<div class="aia-view-header">💰 Customer Receivables</div>
			<div id="aia-receivables-body"><div class="aia-empty-row">Loading...</div></div>
		</div>

		<!-- PAYABLES -->
		<div class="aia-view" id="aia-view-payables">
			<div class="aia-view-header">🧾 Supplier Payables</div>
			<div id="aia-payables-body"><div class="aia-empty-row">Loading...</div></div>
		</div>

		<!-- INVENTORY -->
		<div class="aia-view" id="aia-view-inventory">
			<div class="aia-view-header">📦 Inventory Intelligence <span class="aia-badge aia-badge-orange" id="aia-stock-count" style="font-size:12px;margin-left:8px">—</span></div>
			<div id="aia-inventory-body"><div class="aia-empty-row">Loading...</div></div>
		</div>

		<!-- SALES REPORT -->
		<div class="aia-view" id="aia-view-sales">
			<div class="aia-view-header">📈 Sales Report</div>
			<div id="aia-sales-body"><div class="aia-empty-row">Loading...</div></div>
		</div>

		<!-- AI ADVISOR -->
		<div class="aia-view" id="aia-view-advisor">
			<div class="aia-view-header">🤖 AI Business Advisor</div>
			<div class="aia-panel aia-chat-panel">
				<div class="aia-quick-bar">
					<button class="aia-quick-btn" data-q="Rank my highest risk debtors and give exact action for each.">🚨 High Risk Debtors</button>
					<button class="aia-quick-btn" data-q="Which products need urgent reorder based on current stock and this month's forecast?">📦 Urgent Reorders</button>
					<button class="aia-quick-btn" data-q="Give me a prioritized supplier payment plan for this week with exact amounts.">💳 Pay Priority</button>
					<button class="aia-quick-btn" data-q="What are my top 5 revenue growth opportunities based on my customer and sales data?">💡 Opportunities</button>
					<button class="aia-quick-btn" data-q="Forecast my cash flow for the next 30 days based on receivables, payables and sales trend.">💧 Cash Forecast</button>
				</div>
				<div class="aia-chat-messages" id="aia-chat-messages">
					<div class="aia-chat-empty">
						<div class="aia-chat-empty-icon">🤖</div>
						<div>Ask me anything about your business.<br>I have live access to your ERPNext data.</div>
					</div>
				</div>
				<div class="aia-chat-input-row">
					<input class="aia-chat-input" id="aia-chat-input" placeholder="Ask about customers, payments, stock, sales..." />
					<button class="aia-send-btn" id="aia-send-btn" onclick="sendChatMsg()">↑</button>
				</div>
			</div>
		</div>

	</div>
</div>`; }

// ─── STYLES ───────────────────────────────────────────────────────────────────
function injectStyles() {
	if (document.getElementById('aia-styles')) return;
	const s = document.createElement('style');
	s.id = 'aia-styles';
	s.textContent = `
	.aia-wrap{display:flex;height:calc(100vh - 110px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:var(--text-color);}
	.aia-sidebar{width:220px;min-width:220px;border-right:1px solid var(--border-color);display:flex;flex-direction:column;background:var(--card-bg);padding-bottom:16px;overflow-y:auto;}
	.aia-brand{display:flex;align-items:center;gap:10px;padding:16px 14px;border-bottom:1px solid var(--border-color);}
	.aia-brand-dot{width:10px;height:10px;border-radius:50%;background:#00e5a0;box-shadow:0 0 8px #00e5a0;flex-shrink:0;animation:aia-pulse 2s infinite;}
	@keyframes aia-pulse{0%,100%{opacity:1}50%{opacity:.4}}
	.aia-brand-sub{font-size:9px;color:var(--text-muted);letter-spacing:2px;}
	.aia-brand-name{font-size:16px;font-weight:700;}
	.aia-key-status{padding:8px 14px;font-size:11px;border-bottom:1px solid var(--border-color);}
	.aia-nav{display:flex;flex-direction:column;gap:2px;padding:8px;flex:1;}
	.aia-nav-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;color:var(--text-muted);font-size:12px;transition:all .15s;}
	.aia-nav-item:hover{background:var(--control-bg);color:var(--text-color);}
	.aia-nav-item.active{background:rgba(0,229,160,.1);color:#00e5a0;font-weight:600;}
	.aia-quick-section{padding:8px;border-top:1px solid var(--border-color);}
	.aia-quick-label{font-size:9px;letter-spacing:2px;color:var(--text-muted);padding:4px 2px 6px;}
	.aia-quick-btn{display:block;width:100%;text-align:left;background:var(--control-bg);border:1px solid var(--border-color);border-radius:5px;padding:6px 10px;font-size:11px;cursor:pointer;margin-bottom:4px;color:var(--text-color);transition:all .15s;font-family:inherit;}
	.aia-quick-btn:hover{border-color:#00e5a0;color:#00e5a0;background:rgba(0,229,160,.04);}
	.aia-main{flex:1;overflow-y:auto;padding:20px;position:relative;}
	.aia-spinner{display:none;position:absolute;inset:0;background:rgba(255,255,255,.85);z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:12px;}
	.aia-spinner-dots{display:flex;gap:6px;}
	.aia-spinner-dots span{width:8px;height:8px;border-radius:50%;background:#00e5a0;animation:aia-bounce 1.2s infinite;}
	.aia-spinner-dots span:nth-child(2){animation-delay:.2s;}.aia-spinner-dots span:nth-child(3){animation-delay:.4s;}
	@keyframes aia-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-6px);opacity:1}}
	.aia-view{display:none;}.aia-view.active{display:block;}
	.aia-view-header{font-size:18px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px;}
	.aia-kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px;}
	.aia-kpi{background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;padding:14px 16px;border-top:3px solid transparent;}
	.aia-kpi-blue{border-top-color:#4dabf7;}.aia-kpi-green{border-top-color:#00e5a0;}.aia-kpi-red{border-top-color:#ff6b6b;}.aia-kpi-orange{border-top-color:#ffb347;}.aia-kpi-purple{border-top-color:#7c6cfa;}
	.aia-kpi-label{font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;}
	.aia-kpi-value{font-size:20px;font-weight:700;margin:6px 0 3px;line-height:1;}
	.aia-kpi-sub{font-size:11px;color:var(--text-muted);}
	.aia-cash-cover-wrap{margin-bottom:14px;}
	.aia-cash-indicator{background:var(--card-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px 16px;font-size:12px;}
	.aia-cash-indicator.warn{border-color:rgba(255,107,107,.3);background:rgba(255,107,107,.04);}
	.aia-cash-indicator.ok{border-color:rgba(0,229,160,.2);background:rgba(0,229,160,.03);}
	.aia-panel-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
	.aia-panel{background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;overflow:hidden;margin-bottom:16px;}
	.aia-panel-wide{grid-column:1/-1;}
	.aia-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-color);flex-wrap:wrap;gap:8px;}
	.aia-panel-title{font-weight:600;font-size:13px;}
	.aia-table{width:100%;border-collapse:collapse;}
	.aia-table th{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);padding:8px 16px;text-align:left;border-bottom:1px solid var(--border-color);font-weight:500;}
	.aia-table td{padding:9px 16px;border-bottom:1px solid var(--border-color);vertical-align:middle;}
	.aia-table tr:last-child td{border-bottom:none;}.aia-table tr:hover td{background:var(--control-bg);}
	.aia-empty-row{text-align:center;padding:28px;color:var(--text-muted);font-size:12px;}
	.aia-empty-state{text-align:center;padding:32px;color:var(--text-muted);font-size:13px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;}
	.aia-badge{font-size:10px;padding:2px 8px;border-radius:12px;font-weight:500;white-space:nowrap;}
	.aia-badge-red{background:rgba(255,107,107,.12);color:#ff6b6b;border:1px solid rgba(255,107,107,.2);}
	.aia-badge-orange{background:rgba(255,179,71,.12);color:#ffb347;border:1px solid rgba(255,179,71,.2);}
	.aia-badge-yellow{background:rgba(255,220,100,.12);color:#dba800;border:1px solid rgba(255,220,100,.2);}
	.aia-badge-green{background:rgba(0,229,160,.1);color:#00c986;border:1px solid rgba(0,229,160,.2);}
	.aia-mini-btn{background:var(--control-bg);border:1px solid var(--border-color);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;color:var(--text-color);}
	.aia-mini-btn:hover{border-color:#00e5a0;color:#00e5a0;}
	.aia-aging-strip{display:flex;align-items:stretch;background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;overflow:hidden;}
	.aia-aging-bucket{flex:1;padding:16px 20px;text-align:center;}
	.aia-aging-total{background:rgba(255,107,107,.04);}
	.aia-aging-divider{width:1px;background:var(--border-color);}
	.aia-aging-label{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;}
	.aia-aging-amount{font-size:18px;font-weight:700;margin-bottom:3px;}
	.aia-aging-count{font-size:11px;color:var(--text-muted);}
	.aia-pay-position{display:flex;align-items:center;background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;gap:12px;flex-wrap:wrap;margin-bottom:4px;}
	.aia-pay-pos-item{text-align:center;flex:1;min-width:90px;}
	.aia-pay-pos-label{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;}
	.aia-pay-pos-val{font-size:18px;font-weight:700;}
	.aia-pay-pos-arrow{font-size:18px;color:var(--text-muted);flex-shrink:0;}
	.aia-exec-banner{display:flex;align-items:center;background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
	.aia-exec-stat{flex:1;text-align:center;min-width:80px;}
	.aia-exec-label{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;}
	.aia-exec-val{font-size:20px;font-weight:700;}
	.aia-exec-divider{width:1px;height:40px;background:var(--border-color);margin:0 4px;}
	.aia-sales-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
	.aia-chart-area{display:flex;align-items:flex-end;justify-content:space-around;padding:16px 16px 8px;height:180px;gap:8px;}
	.aia-bar-col{display:flex;flex-direction:column;align-items:center;flex:1;height:100%;}
	.aia-bar-val{font-size:10px;color:var(--text-muted);margin-bottom:4px;text-align:center;white-space:nowrap;}
	.aia-bar-wrap{flex:1;width:100%;display:flex;align-items:flex-end;}
	.aia-bar-v{width:100%;border-radius:4px 4px 0 0;background:#7c6cfa;transition:height .8s ease;min-height:4px;}
	.aia-bar-peak{background:#ffb347;}.aia-bar-current{background:#00e5a0;}
	.aia-bar-month{font-size:10px;color:var(--text-muted);margin-top:5px;text-align:center;}
	.aia-chat-panel{display:flex;flex-direction:column;height:calc(100vh - 200px);}
	.aia-quick-bar{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--border-color);}
	.aia-quick-bar .aia-quick-btn{display:inline-block;width:auto;margin:0;}
	.aia-chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;}
	.aia-chat-empty{text-align:center;margin:auto;color:var(--text-muted);font-size:13px;line-height:1.8;}
	.aia-chat-empty-icon{font-size:36px;margin-bottom:10px;opacity:.5;}
	.aia-msg{display:flex;gap:8px;max-width:88%;}
	.aia-msg-user{flex-direction:row-reverse;align-self:flex-end;}
	.aia-msg-avatar{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;background:var(--control-bg);}
	.aia-msg-bubble{background:var(--control-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px 14px;font-size:12px;line-height:1.7;}
	.aia-msg-user .aia-msg-bubble{background:rgba(0,229,160,.07);border-color:rgba(0,229,160,.2);}
	.aia-resp-heading{font-weight:700;font-size:13px;margin:10px 0 4px;border-bottom:1px solid var(--border-color);padding-bottom:4px;}
	.aia-resp-bullet{padding:2px 0 2px 4px;}
	.aia-typing{display:flex;gap:4px;align-items:center;padding:4px 0;}
	.aia-typing span{width:6px;height:6px;background:#00e5a0;border-radius:50%;animation:aia-bounce 1.2s infinite;}
	.aia-typing span:nth-child(2){animation-delay:.2s;}.aia-typing span:nth-child(3){animation-delay:.4s;}
	.aia-chat-input-row{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border-color);}
	.aia-chat-input{flex:1;border:1px solid var(--border-color);border-radius:6px;padding:8px 12px;font-family:inherit;font-size:13px;background:var(--control-bg);color:var(--text-color);outline:none;transition:border-color .2s;}
	.aia-chat-input:focus{border-color:#00e5a0;}
	.aia-send-btn{background:#00e5a0;color:#000;border:none;border-radius:6px;width:36px;font-size:16px;cursor:pointer;font-weight:700;transition:opacity .15s;}
	.aia-send-btn:hover{opacity:.8;}.aia-send-btn:disabled{opacity:.3;cursor:not-allowed;}
	@media(max-width:1200px){.aia-kpi-grid{grid-template-columns:repeat(3,1fr);}.aia-sales-grid{grid-template-columns:1fr;}}
	@media(max-width:900px){.aia-kpi-grid{grid-template-columns:repeat(2,1fr);}.aia-panel-grid{grid-template-columns:1fr;}}
	`;
	document.head.appendChild(s);
}
