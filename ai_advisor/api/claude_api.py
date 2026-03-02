import frappe
import requests
import json
from datetime import datetime, timedelta


def get_claude_api_key():
    """Fetch Claude API key from ERPNext Singles (AI Advisor Settings doctype)."""
    try:
        return frappe.db.get_single_value("AI Advisor Settings", "claude_api_key")
    except Exception:
        return None


@frappe.whitelist()
def get_business_snapshot():
    """Pull live ERPNext data for the dashboard KPIs."""
    try:
        today = datetime.today().strftime("%Y-%m-%d")
        month_start = datetime.today().replace(day=1).strftime("%Y-%m-%d")

        # Outstanding Sales Invoices
        receivables = frappe.db.sql("""
            SELECT customer, name, outstanding_amount, due_date, status
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND outstanding_amount > 0
            ORDER BY outstanding_amount DESC
            LIMIT 50
        """, as_dict=True)

        overdue = [r for r in receivables if r.get("due_date") and str(r["due_date"]) < today]
        total_receivables = sum(r["outstanding_amount"] for r in receivables)
        total_overdue = sum(r["outstanding_amount"] for r in overdue)

        # Outstanding Purchase Invoices
        payables = frappe.db.sql("""
            SELECT supplier, name, outstanding_amount, due_date, status
            FROM `tabPurchase Invoice`
            WHERE docstatus = 1 AND outstanding_amount > 0
            ORDER BY due_date ASC
            LIMIT 50
        """, as_dict=True)
        total_payables = sum(p["outstanding_amount"] for p in payables)

        # Month-to-date sales
        mtd_sales = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as total
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND posting_date >= %s
        """, (month_start,), as_dict=True)
        mtd_total = mtd_sales[0]["total"] if mtd_sales else 0

        # Last 6 months sales trend
        sales_trend = frappe.db.sql("""
            SELECT 
                DATE_FORMAT(posting_date, '%%Y-%%m') as month,
                SUM(grand_total) as amount,
                COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(posting_date, '%%Y-%%m')
            ORDER BY month ASC
        """, as_dict=True)

        # Top customers
        top_customers = frappe.db.sql("""
            SELECT customer, SUM(grand_total) as revenue, COUNT(*) as orders
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND posting_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY customer
            ORDER BY revenue DESC
            LIMIT 10
        """, as_dict=True)

        # Low stock items (items below reorder level)
        low_stock = frappe.db.sql("""
            SELECT 
                b.item_code,
                b.item_name,
                b.actual_qty,
                i.reorder_level,
                i.stock_uom
            FROM `tabBin` b
            JOIN `tabItem` i ON i.name = b.item_code
            WHERE b.actual_qty <= i.reorder_level AND i.reorder_level > 0
            ORDER BY (b.actual_qty / NULLIF(i.reorder_level, 0)) ASC
            LIMIT 20
        """, as_dict=True)

        return {
            "success": True,
            "kpis": {
                "total_receivables": float(total_receivables),
                "total_overdue": float(total_overdue),
                "overdue_count": len(overdue),
                "total_payables": float(total_payables),
                "payables_count": len(payables),
                "mtd_sales": float(mtd_total),
                "open_invoices": len(receivables),
            },
            "overdue_customers": [
                {
                    "customer": r["customer"],
                    "invoice": r["name"],
                    "amount": float(r["outstanding_amount"]),
                    "due_date": str(r["due_date"]),
                    "days_overdue": (datetime.today().date() - r["due_date"]).days if r.get("due_date") else 0
                } for r in overdue[:20]
            ],
            "payables": [
                {
                    "supplier": p["supplier"],
                    "invoice": p["name"],
                    "amount": float(p["outstanding_amount"]),
                    "due_date": str(p["due_date"]),
                } for p in payables[:20]
            ],
            "sales_trend": [
                {"month": s["month"], "amount": float(s["amount"]), "count": s["count"]}
                for s in sales_trend
            ],
            "top_customers": [
                {"customer": c["customer"], "revenue": float(c["revenue"]), "orders": c["orders"]}
                for c in top_customers
            ],
            "low_stock": [
                {
                    "item": s["item_code"],
                    "name": s["item_name"],
                    "stock": float(s["actual_qty"]),
                    "reorder_level": float(s["reorder_level"]),
                    "uom": s["stock_uom"]
                } for s in low_stock
            ]
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "AI Advisor - get_business_snapshot")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def ask_claude(question, context_data=None):
    """
    Proxy Claude API call through Frappe backend.
    This keeps the API key secure on the server — never exposed to the browser.
    """
    api_key = get_claude_api_key()
    if not api_key:
        frappe.throw("Claude API key not configured. Go to AI Advisor Settings.")

    if context_data and isinstance(context_data, str):
        try:
            context_data = json.loads(context_data)
        except Exception:
            context_data = {}

    # Build rich context from live data if not provided
    if not context_data:
        snapshot = get_business_snapshot()
        context_data = snapshot if snapshot.get("success") else {}

    system_prompt = """You are an AI business advisor embedded inside ERPNext for a Kenyan SME.
You have access to live financial and operational data from their ERP system.
Be direct, concise, and actionable. Use KES currency. Prioritize by financial impact.
Format with clear sections. Bold key numbers. Always end with a clear "Next Action" recommendation."""

    user_message = f"""{question}

LIVE BUSINESS DATA:
{json.dumps(context_data, indent=2, default=str)}

Today's date: {datetime.today().strftime('%d %B %Y')}"""

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}]
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        return {
            "success": True,
            "response": data["content"][0]["text"],
            "tokens_used": data.get("usage", {})
        }
    except requests.exceptions.Timeout:
        return {"success": False, "error": "Request timed out. Try again."}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "AI Advisor - ask_claude")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def save_settings(claude_api_key):
    """Save Claude API key to Single doctype."""
    try:
        doc = frappe.get_single("AI Advisor Settings")
        doc.claude_api_key = claude_api_key
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_settings():
    """Return settings (masked API key)."""
    try:
        key = frappe.db.get_single_value("AI Advisor Settings", "claude_api_key")
        return {
            "success": True,
            "has_key": bool(key),
            "key_preview": f"sk-ant-...{key[-6:]}" if key and len(key) > 10 else None
        }
    except Exception:
        return {"success": True, "has_key": False, "key_preview": None}
