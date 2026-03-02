# 🤖 AI Advisor for ERPNext

A Claude-powered Business Intelligence dashboard that lives inside your ERPNext/Frappe desk.

## What it does

- **Live KPIs** — Receivables, overdue amounts, payables, month-to-date sales
- **Overdue Customers** — Ranked by amount with one-click follow-up drafting
- **Suppliers to Pay** — Priority-ranked by due date
- **Reorder Alerts** — Items below reorder level based on your stock data
- **Sales Report** — 6-month trend chart + top customers by revenue
- **AI Advisor Chat** — Ask anything in plain English, Claude answers using your live ERP data

## Installation on Frappe Cloud

### Option A: Manual install via Frappe Cloud Dashboard

1. Log into your Frappe Cloud account at https://frappecloud.com
2. Go to your site → **Apps** → **Install App**
3. Upload this zip OR provide the GitHub repo URL
4. After install, run: `bench --site yoursite.frappe.cloud migrate`

### Option B: Install via bench (if you have SSH access)

```bash
# SSH into your server
cd /home/frappe/frappe-bench

# Get the app (upload to GitHub first, or use local path)
bench get-app ai_advisor /path/to/ai_advisor

# Install on your site
bench --site yoursite.frappe.cloud install-app ai_advisor

# Run migrations to create the Settings doctype
bench --site yoursite.frappe.cloud migrate
```

### Option C: GitHub (Recommended for Frappe Cloud)

1. Upload the `ai_advisor` folder to a GitHub repo
2. In Frappe Cloud → Your Site → Apps → Add App from GitHub
3. Follow the prompts

## Configuration

After installing:

1. In ERPNext, go to **Search** → type "AI Advisor" → open the page
2. Click **⚙ Settings** in the top toolbar
3. Paste your Claude API key (get it from https://console.anthropic.com)
4. Click **Save**
5. Click **↻ Refresh** to load your live data

## Getting a Claude API Key

1. Go to https://console.anthropic.com
2. Sign up / Log in
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-`)
5. Paste it in AI Advisor Settings

## Estimated API Cost

Using Claude Sonnet (recommended):
- ~$0.003 per query
- 50 queries/day = ~$4.50/month
- 200 queries/day = ~$18/month

## Permissions

The AI Advisor page is accessible to:
- System Manager
- Accounts Manager
- Accounts User
- Sales Manager
- Purchase Manager

The API key settings are only accessible to **System Manager**.

## Security

- Your Claude API key is stored encrypted in the ERPNext database
- All Claude API calls are made from the **server side** (not the browser)
- The key is never exposed in the frontend JavaScript
- ERPNext's existing role-based permissions apply to all data queries

## Support

Built for ERPNext v14+ on Frappe Cloud.
Requires Python 3.10+ and the `requests` library (auto-installed).
