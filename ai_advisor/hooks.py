app_name = "ai_advisor"
app_title = "AI Advisor"
app_publisher = "Your Company"
app_description = "Claude AI Business Advisor Dashboard for ERPNext"
app_email = "admin@yourcompany.com"
app_license = "MIT"
app_version = "1.0.0"

# App icon shown in Frappe desk
app_icon = "octicon octicon-hubot"
app_color = "#00e5a0"

# Include page in desk
page_js = {"ai_advisor": "public/js/ai_advisor.js"}

# Website route rules (optional)
website_route_rules = []

# Permissions
has_permission = {
    "AI Advisor Settings": "ai_advisor.ai_advisor.ai_advisor_settings.ai_advisor_settings.has_permission"
}
