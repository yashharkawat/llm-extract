// Sample documents for the demo (made up; any resemblance to real companies is accidental).
export const SAMPLES = {
  invoice_clean: {
    schema: "invoice",
    label: "Invoice (adds up)",
    text: `NORTHWIND DESIGN STUDIO
billing@northwinddesign.co

TAX INVOICE
Invoice No: NW-2026-0142
Invoice date: 3 September 2026
Due date: 17 September 2026
Bill to: BrightSmile Dental Clinics, Bengaluru

Description                         Qty   Unit price     Amount
Website redesign (5 pages)            1    42,000.00  42,000.00
WhatsApp booking widget setup         1     8,500.00   8,500.00
Monthly maintenance (Sep)             2     3,000.00   6,000.00

Subtotal                                              56,500.00
GST 18%                                               10,170.00
Total due (INR)                                       66,670.00`,
  },
  invoice_bad: {
    schema: "invoice",
    label: "Invoice (subtotal is wrong)",
    text: `Kestrel Cloud Services Ltd.
accounts@kestrelcloud.io

Invoice #KC-88317
Date: 2026-08-28      Payment due: 2026-09-27

Item                        Qty   Unit     Amount
Managed Postgres (Aug)       1   120.00    120.00
Object storage 500 GB        1    11.50     11.50
Support plan (Pro)           1    49.00     49.00

Subtotal                                   190.50
VAT 20%                                     36.10
TOTAL (USD)                                216.60`,
  },
  email_lead: {
    schema: "email",
    label: "Email lead",
    text: `From: Priya Raman <priya@lumenhealth.in>
Subject: WhatsApp appointment bot for our 3 clinics

Hi Yash,

We run Lumen Health, three physiotherapy clinics in Chennai. Our front desk is drowning in WhatsApp messages asking for slots and prices. We'd like a WhatsApp assistant that answers FAQs, books sessions into our Google Calendar and sends reminders the day before.

Our budget is around ₹80,000 for the first version, and we'd like it live before 15 October 2026 because we're opening a fourth clinic then. Could we get on a call this week?

Thanks,
Priya Raman
Operations Lead, Lumen Health`,
  },
};
