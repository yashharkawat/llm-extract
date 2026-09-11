// Zod schemas: the contract the model's JSON must meet before anything downstream sees it.
// Numbers are coerced ("56500" -> 56500) but "56,500.00" still fails, which triggers a retry with the error.
import { z } from "zod";

const num = z.coerce.number().finite();
const money = num.nonnegative();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "is not a real calendar date");
const currency = z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code such as USD, EUR or INR");

export const Invoice = z.object({
  vendor_name: z.string().min(1),
  vendor_email: z.string().email().nullable(),
  invoice_number: z.string().min(1),
  invoice_date: isoDate,
  due_date: isoDate.nullable(),
  currency,
  line_items: z
    .array(z.object({ description: z.string().min(1), quantity: num.positive(), unit_price: money, amount: money }))
    .min(1, "an invoice needs at least one line item"),
  subtotal: money,
  tax: money.nullable(),
  total: money,
});

export const EmailLead = z.object({
  sender_name: z.string().min(1),
  sender_email: z.string().email(),
  company: z.string().nullable(),
  intent: z.enum(["new_project", "support", "partnership", "job_application", "spam", "other"]),
  services_requested: z.array(z.string().min(1)),
  budget: z.object({ amount: money, currency }).nullable(),
  deadline: isoDate.nullable(),
  urgency: z.enum(["low", "medium", "high"]),
  summary: z.string().min(10).max(400),
});

export const SCHEMAS = {
  invoice: {
    label: "Invoice",
    schema: Invoice,
    instructions:
      "Extract an invoice. Fields: vendor_name; vendor_email (null if absent); invoice_number (exactly as printed); " +
      "invoice_date and due_date as YYYY-MM-DD (due_date null if absent); currency as an ISO 4217 code; " +
      "line_items as an array of {description, quantity, unit_price, amount}; subtotal; tax (null if none); total. " +
      "All money values are plain numbers with no currency symbols or thousands separators. " +
      "Copy values exactly as the document states them, even if they look wrong. Never invent or correct values.",
  },
  email: {
    label: "Email lead",
    schema: EmailLead,
    instructions:
      "Extract a sales lead from an email. Fields: sender_name; sender_email; company (null if absent); " +
      "intent (one of new_project, support, partnership, job_application, spam, other); services_requested (array of short strings); " +
      "budget as {amount, currency} with amount a plain number and currency an ISO 4217 code, or null if no budget is stated; " +
      "deadline as YYYY-MM-DD or null; urgency (low, medium or high); summary (one or two sentences, under 400 characters). " +
      "Never invent a budget or deadline that the email does not state.",
  },
};
