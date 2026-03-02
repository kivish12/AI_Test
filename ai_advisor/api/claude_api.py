import frappe
import requests
import json
from datetime import datetime, timedelta


def get_claude_api_key():
    return frappe.conf.get("claude_api_key") or None


@frappe.whitelist()
def save_settings(claude_api_key):
    try:
        frappe.utils.set_site_config("claude_api_key", claude_api_key)
        return {"success": True}
    except Exception as e:
        try:
            from frappe.utils.site_config import update_site_config
            update_site_config("claude_api_key", claude_api_key)
            return {"success": True}
        except Exception as e2:
            return {"success": False, "error": str(e2)}


@frappe.whitelist()
def get_settings():
    key = get_claude_api_key()
    return {
        "success": True,
        "has_key": bool(key),
        "key_preview": f"sk-ant-...{key[-6:]}" if key and len(key) > 10 else None
    }


@frappe.whitelist()
def get_business_snapshot():
    try:
        today = datetime.today().strftime("%Y-%m-%d")
        today_date = datetime.today().date()
        month_start = datetime.today().replace(day=1).strftime("%Y-%m-%d")
        week_end = (today_date + timedelta(days=7)).strftime("%Y-%m-%d")
        month_end = (today_date + timedelta(days=30)).strftime("%Y-%m-%d")

        # ── RECEIVABLES ──────────────────────────────────────────────────────
        receivables = frappe.db.sql("""
            SELECT customer, name, outstanding_amount, due_date, status,
                   territory, customer_group
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND outstanding_amount > 0
            ORDER BY outstanding_amount DESC LIMIT 50
        """, as_dict=True)

        overdue = [r for r in receivables if r.get("due_date") and str(r["due_date"]) < today]
        total_receivables = sum(float(r["outstanding_amount"] or 0) for r in receivables)
        total_overdue = sum(float(r["outstanding_amount"] or 0) for r in overdue)

        # ── PAYABLES ─────────────────────────────────────────────────────────
        payables = frappe.db.sql("""
            SELECT supplier, name, outstanding_amount, due_date, bill_no
            FROM `tabPurchase Invoice`
            WHERE docstatus = 1 AND outstanding_amount > 0
            ORDER BY due_date ASC LIMIT 50
        """, as_dict=True)
        total_payables = sum(float(p["outstanding_amount"] or 0) for p in payables)
        due_this_week = [p for p in payables if p.get("due_date") and str(p["due_date"]) <= week_end]
        due_next_30 = [p for p in payables if p.get("due_date") and str(p["due_date"]) <= month_end]
        due_this_week_total = sum(float(p["outstanding_amount"] or 0) for p in due_this_week)
        due_next_30_total = sum(float(p["outstanding_amount"] or 0) for p in due_next_30)

        # ── BANK & CASH BALANCES ──────────────────────────────────────────────
        bank_accounts = frappe.db.sql("""
            SELECT a.name as account, a.account_name, a.account_currency,
                   COALESCE(SUM(gl.debit - gl.credit), 0) as balance
            FROM `tabAccount` a
            LEFT JOIN `tabGL Entry` gl ON gl.account = a.name AND gl.is_cancelled = 0
            WHERE a.account_type IN ('Bank', 'Cash') AND a.is_group = 0
            GROUP BY a.name, a.account_name, a.account_currency
            ORDER BY balance DESC
        """, as_dict=True)
        total_bank_balance = sum(float(b["balance"] or 0) for b in bank_accounts)

        # ── CHART OF ACCOUNTS ─────────────────────────────────────────────────
        coa_balances = frappe.db.sql("""
            SELECT a.root_type, a.account_type, a.account_name,
                   COALESCE(SUM(gl.debit - gl.credit), 0) as balance
            FROM `tabAccount` a
            LEFT JOIN `tabGL Entry` gl ON gl.account = a.name AND gl.is_cancelled = 0
            WHERE a.is_group = 0
              AND a.root_type IN ('Asset', 'Liability', 'Income', 'Expense')
            GROUP BY a.name, a.account_name, a.root_type, a.account_type
            HAVING ABS(balance) > 0
            ORDER BY a.root_type, ABS(balance) DESC
        """, as_dict=True)

        coa_summary = {}
        for row in coa_balances:
            rt = row["root_type"]
            if rt not in coa_summary:
                coa_summary[rt] = {"total": 0, "accounts": []}
            bal = float(row["balance"] or 0)
            coa_summary[rt]["total"] += bal
            if len(coa_summary[rt]["accounts"]) < 15:
                coa_summary[rt]["accounts"].append({
                    "account": row["account_name"],
                    "type": row["account_type"],
                    "balance": bal
                })

        # ── MTD SALES ────────────────────────────────────────────────────────
        mtd = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as total
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND posting_date >= %s
        """, (month_start,), as_dict=True)
        mtd_total = float(mtd[0]["total"]) if mtd else 0

        # ── SALES BY TERRITORY ────────────────────────────────────────────────
        sales_by_territory = frappe.db.sql("""
            SELECT territory,
                   SUM(grand_total) as revenue,
                   COUNT(*) as orders,
                   COUNT(DISTINCT customer) as customers
            FROM `tabSales Invoice`
            WHERE docstatus = 1
              AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
              AND territory IS NOT NULL AND territory != ''
            GROUP BY territory
            ORDER BY revenue DESC
        """, as_dict=True)

        # ── SALES BY ITEM (fast vs slow movers) ───────────────────────────────
        item_sales = frappe.db.sql("""
            SELECT
                sii.item_code,
                sii.item_name,
                SUM(sii.qty) as qty_sold,
                SUM(sii.amount) as revenue,
                COUNT(DISTINCT si.name) as invoice_count,
                MAX(si.posting_date) as last_sold_date
            FROM `tabSales Invoice Item` sii
            JOIN `tabSales Invoice` si ON si.name = sii.parent
            WHERE si.docstatus = 1
              AND si.posting_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY sii.item_code, sii.item_name
            ORDER BY revenue DESC
            LIMIT 50
        """, as_dict=True)

        # Classify fast vs slow movers
        fast_movers = []
        slow_movers = []
        dead_stock = []
        ninety_days_ago = (today_date - timedelta(days=90)).strftime("%Y-%m-%d")
        one_eighty_days_ago = (today_date - timedelta(days=180)).strftime("%Y-%m-%d")

        for item in item_sales:
            last_sold = str(item.get("last_sold_date", ""))
            if last_sold >= ninety_days_ago:
                fast_movers.append(item)
            elif last_sold >= one_eighty_days_ago:
                slow_movers.append(item)
            else:
                dead_stock.append(item)

        # ── CURRENT STOCK LEVELS ──────────────────────────────────────────────
        current_stock = frappe.db.sql("""
            SELECT b.item_code, i.item_name,
                   b.actual_qty, b.reserved_qty,
                   (b.actual_qty - b.reserved_qty) as available_qty,
                   i.stock_uom,
                   i.standard_selling_rate as selling_price,
                   i.valuation_rate as cost_price
            FROM `tabBin` b
            JOIN `tabItem` i ON i.name = b.item_code
            WHERE b.actual_qty > 0
            ORDER BY (b.actual_qty * i.valuation_rate) DESC
            LIMIT 50
        """, as_dict=True)

        # ── LOW STOCK / REORDER ───────────────────────────────────────────────
        try:
            low_stock = frappe.db.sql("""
                SELECT b.item_code, i.item_name, b.actual_qty,
                       ir.warehouse_reorder_level as reorder_level,
                       ir.warehouse_reorder_qty as reorder_qty,
                       i.stock_uom,
                       i.standard_buying_price as buying_price
                FROM `tabBin` b
                JOIN `tabItem` i ON i.name = b.item_code
                JOIN `tabItem Reorder` ir ON ir.parent = b.item_code
                WHERE b.actual_qty <= ir.warehouse_reorder_level
                  AND ir.warehouse_reorder_level > 0
                ORDER BY (b.actual_qty / NULLIF(ir.warehouse_reorder_level, 0)) ASC
                LIMIT 20
            """, as_dict=True)
        except Exception:
            low_stock = []

        # ── SALES TREND ───────────────────────────────────────────────────────
        sales_trend = frappe.db.sql("""
            SELECT DATE_FORMAT(posting_date,'%%Y-%%m') as month,
                   SUM(grand_total) as amount, COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus = 1
              AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(posting_date,'%%Y-%%m')
            ORDER BY month ASC
        """, as_dict=True)

        # ── TOP CUSTOMERS ─────────────────────────────────────────────────────
        top_customers = frappe.db.sql("""
            SELECT customer, customer_group, territory,
                   SUM(grand_total) as revenue, COUNT(*) as orders
            FROM `tabSales Invoice`
            WHERE docstatus = 1
              AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY customer, customer_group, territory
            ORDER BY revenue DESC LIMIT 15
        """, as_dict=True)

        # ── PURCHASE HISTORY (what we buy and from whom) ──────────────────────
        purchase_history = frappe.db.sql("""
            SELECT pii.item_code, pii.item_name, pii.supplier,
                   SUM(pii.qty) as qty_purchased,
                   AVG(pii.rate) as avg_rate,
                   MAX(pi.posting_date) as last_purchased
            FROM `tabPurchase Invoice Item` pii
            JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
            WHERE pi.docstatus = 1
              AND pi.posting_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY pii.item_code, pii.item_name, pii.supplier
            ORDER BY qty_purchased DESC
            LIMIT 30
        """, as_dict=True)

        # ── RECENT PAYMENTS ───────────────────────────────────────────────────
        recent_receipts = frappe.db.sql("""
            SELECT party as customer, SUM(paid_amount) as amount,
                   MAX(posting_date) as last_date
            FROM `tabPayment Entry`
            WHERE docstatus = 1 AND payment_type = 'Receive'
              AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY party ORDER BY amount DESC LIMIT 10
        """, as_dict=True)

        recent_payments_made = frappe.db.sql("""
            SELECT party as supplier, SUM(paid_amount) as amount,
                   MAX(posting_date) as last_date
            FROM `tabPayment Entry`
            WHERE docstatus = 1 AND payment_type = 'Pay'
              AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY party ORDER BY amount DESC LIMIT 10
        """, as_dict=True)

        return {
            "success": True,
            "kpis": {
                "total_bank_balance": total_bank_balance,
                "total_receivables": total_receivables,
                "total_overdue": total_overdue,
                "overdue_count": len(overdue),
                "total_payables": total_payables,
                "payables_count": len(payables),
                "due_this_week": due_this_week_total,
                "due_this_week_count": len(due_this_week),
                "due_next_30_days": due_next_30_total,
                "mtd_sales": mtd_total,
                "open_invoices": len(receivables),
                "net_cash_after_week_dues": total_bank_balance - due_this_week_total,
                "net_cash_after_30day_dues": total_bank_balance - due_next_30_total,
            },
            "bank_accounts": [
                {
                    "account": b["account_name"],
                    "balance": float(b["balance"] or 0),
                    "currency": b["account_currency"]
                } for b in bank_accounts
            ],
            "chart_of_accounts": coa_summary,
            "overdue_customers": [
                {
                    "customer": r["customer"],
                    "invoice": r["name"],
                    "amount": float(r["outstanding_amount"] or 0),
                    "due_date": str(r["due_date"]),
                    "days_overdue": (today_date - r["due_date"]).days if r.get("due_date") else 0,
                    "territory": r.get("territory")
                } for r in overdue[:20]
            ],
            "all_payables": [
                {
                    "supplier": p["supplier"],
                    "invoice": p["name"],
                    "amount": float(p["outstanding_amount"] or 0),
                    "due_date": str(p["due_date"]),
                    "days_until_due": (p["due_date"] - today_date).days if p.get("due_date") else 0,
                    "overdue": bool(p.get("due_date") and p["due_date"] < today_date)
                } for p in payables[:30]
            ],
            "due_this_week_payables": [
                {
                    "supplier": p["supplier"],
                    "amount": float(p["outstanding_amount"] or 0),
                    "due_date": str(p["due_date"]),
                    "invoice": p["name"]
                } for p in due_this_week
            ],
            "sales_trend": [
                {"month": s["month"], "amount": float(s["amount"] or 0), "count": s["count"]}
                for s in sales_trend
            ],
            "sales_by_territory": [
                {
                    "territory": t["territory"],
                    "revenue": float(t["revenue"] or 0),
                    "orders": t["orders"],
                    "customers": t["customers"]
                } for t in sales_by_territory
            ],
            "top_customers": [
                {
                    "customer": c["customer"],
                    "revenue": float(c["revenue"] or 0),
                    "orders": c["orders"],
                    "territory": c.get("territory"),
                    "group": c.get("customer_group")
                } for c in top_customers
            ],
            "fast_moving_items": [
                {
                    "item": i["item_code"],
                    "name": i["item_name"],
                    "qty_sold": float(i["qty_sold"] or 0),
                    "revenue": float(i["revenue"] or 0),
                    "last_sold": str(i["last_sold_date"])
                } for i in fast_movers[:20]
            ],
            "slow_moving_items": [
                {
                    "item": i["item_code"],
                    "name": i["item_name"],
                    "qty_sold": float(i["qty_sold"] or 0),
                    "revenue": float(i["revenue"] or 0),
                    "last_sold": str(i["last_sold_date"])
                } for i in slow_movers[:20]
            ],
            "dead_stock_items": [
                {
                    "item": i["item_code"],
                    "name": i["item_name"],
                    "qty_sold": float(i["qty_sold"] or 0),
                    "last_sold": str(i["last_sold_date"])
                } for i in dead_stock[:20]
            ],
            "current_stock": [
                {
                    "item": s["item_code"],
                    "name": s["item_name"],
                    "available_qty": float(s["available_qty"] or 0),
                    "uom": s["stock_uom"],
                    "selling_price": float(s["selling_price"] or 0),
                    "cost_price": float(s["cost_price"] or 0),
                    "stock_value": float(s["available_qty"] or 0) * float(s["cost_price"] or 0)
                } for s in current_stock
            ],
            "low_stock_reorder": [
                {
                    "item": s["item_code"],
                    "name": s["item_name"],
                    "stock": float(s["actual_qty"] or 0),
                    "reorder_level": float(s["reorder_level"] or 0),
                    "reorder_qty": float(s.get("reorder_qty") or 0),
                    "uom": s["stock_uom"],
                    "buying_price": float(s.get("buying_price") or 0)
                } for s in low_stock
            ],
            "purchase_history": [
                {
                    "item": p["item_code"],
                    "name": p["item_name"],
                    "supplier": p["supplier"],
                    "qty_purchased": float(p["qty_purchased"] or 0),
                    "avg_rate": float(p["avg_rate"] or 0),
                    "last_purchased": str(p["last_purchased"])
                } for p in purchase_history
            ],
            "recent_receipts_30d": [
                {
                    "customer": r["customer"],
                    "amount": float(r["amount"] or 0),
                    "last_payment": str(r["last_date"])
                } for r in recent_receipts
            ],
            "recent_payments_made_30d": [
                {
                    "supplier": p["supplier"],
                    "amount": float(p["amount"] or 0),
                    "last_payment": str(p["last_date"])
                } for p in recent_payments_made
            ]
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "AI Advisor - get_business_snapshot")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def ask_claude(question, context_data=None):
    api_key = get_claude_api_key()
    if not api_key:
        return {"success": False, "error": "Claude API key not set. Click ⚙ Settings to add your key."}

    if context_data and isinstance(context_data, str):
        try:
            context_data = json.loads(context_data)
        except Exception:
            context_data = {}

    if not context_data:
        snapshot = get_business_snapshot()
        context_data = snapshot if snapshot.get("success") else {}

    system_prompt = """You are an embedded AI CFO and operations advisor inside ERPNext for a Kenyan SME.

You have access to LIVE data including:
- Bank balances per account
- Full chart of accounts (assets, liabilities, income, expenses)
- Outstanding receivables with customer names, amounts, days overdue, territory
- All payables with due dates — this week and next 30 days
- Net cash position after paying dues
- Sales performance by territory and customer
- Fast moving, slow moving, and dead stock items
- Current stock levels with values
- Reorder alerts with suggested quantities
- Purchase history per item and supplier
- Recent payments in and out

YOU ARE A REAL CFO. Give advice on:

CASH MANAGEMENT:
- Exact cheque amounts and which supplier to pay first
- How much cash to keep in reserve based on upcoming obligations
- Whether they can afford all dues or need to prioritize
- Which receivables to collect urgently to cover payment gaps

INVENTORY:
- Which items to reorder urgently and in what quantity
- Which slow movers to discount and by how much to clear stock
- Which dead stock to stop reordering entirely
- Optimal order quantities based on sales velocity

SALES & TERRITORY:
- Which territories are performing and which need focus
- Which customer segments to prioritize
- Which routes/areas have the best return

RESPONSE RULES:
- Always use exact KES amounts from the data
- Name specific suppliers, customers, items, territories
- Give numbered action lists
- Warn if cash position is tight
- Be a real advisor — direct, specific, no filler"""

    user_message = (
        f"{question}\n\n"
        f"LIVE ERPNEXT DATA:\n"
        f"{json.dumps(context_data, indent=2, default=str)}\n\n"
        f"Today: {datetime.today().strftime('%A, %d %B %Y')}"
    )

    try:
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 2000,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}]
            },
            timeout=45
        )
        resp.raise_for_status()
        data = resp.json()
        return {"success": True, "response": data["content"][0]["text"]}
    except requests.exceptions.Timeout:
        return {"success": False, "error": "Claude timed out. Please try again."}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "AI Advisor - ask_claude")
        return {"success": False, "error": str(e)}
