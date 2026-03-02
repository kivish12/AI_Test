import frappe

def has_permission(doc, ptype=None, user=None):
    return frappe.has_role("System Manager")
