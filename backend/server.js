require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const DEMO_MODE = String(process.env.DEMO_MODE || "true").toLowerCase() === "true";
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabase ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const authClient = hasSupabase ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map(s => s.trim());

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error("Origin not allowed")); } }));
app.use(express.json({ limit: "12kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false }));
app.use("/api/appointments", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }));

const servicesSeed = [
  { id: "svc-cleaning", name: "Teeth Cleaning", description: "A gentle professional clean to help keep your smile fresh and healthy.", duration_minutes: 30, price: 3500, is_active: true },
  { id: "svc-checkup", name: "Dental Check-up", description: "A routine oral health check with clear guidance on your next steps.", duration_minutes: 30, price: 2000, is_active: true },
  { id: "svc-whitening", name: "Smile Whitening", description: "Discuss cosmetic whitening options suited to your smile.", duration_minutes: 45, price: 8000, is_active: true },
  { id: "svc-braces", name: "Braces Consultation", description: "Explore orthodontic options and ask questions in a consultation.", duration_minutes: 30, price: 2500, is_active: true },
  { id: "svc-root", name: "Root Canal Consultation", description: "An assessment appointment to discuss symptoms and treatment options.", duration_minutes: 45, price: 4000, is_active: true },
  { id: "svc-emergency", name: "Urgent Dental Visit", description: "Request an urgent visit; the clinic will contact you to confirm availability.", duration_minutes: 30, price: null, is_active: true }
];
const demoAppointments = [
  { id: "demo-appt-1001", patient_name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", service_id: "svc-checkup", service_name: "Dental Check-up", preferred_at: new Date(Date.now() + 86400000).toISOString(), status: "pending", message: "Routine check-up", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "demo-appt-1002", patient_name: "Hamza Ali", email: "hamza@example.com", phone: "+92 321 7654321", service_id: "svc-cleaning", service_name: "Teeth Cleaning", preferred_at: new Date(Date.now() + 172800000).toISOString(), status: "confirmed", message: "Prefer an afternoon slot", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "demo-appt-1003", patient_name: "Sara Ahmed", email: "sara@example.com", phone: "+92 333 9876543", service_id: "svc-whitening", service_name: "Smile Whitening", preferred_at: new Date(Date.now() + 259200000).toISOString(), status: "completed", message: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];
const clinicSettings = { clinic_name: "SmileCare Dental Studio", phone: "+92 300 123 4567", email: "hello@smilecare.example", address: "Gulberg, Lahore, Pakistan", opening_hours: { Monday: "9:00 AM – 7:00 PM", Tuesday: "9:00 AM – 7:00 PM", Wednesday: "9:00 AM – 7:00 PM", Thursday: "9:00 AM – 7:00 PM", Friday: "9:00 AM – 7:00 PM", Saturday: "10:00 AM – 4:00 PM", Sunday: "Closed" } };

function isDemo() { return DEMO_MODE || !hasSupabase; }
function clean(value, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function validEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function errorResponse(res, status, message) { return res.status(status).json({ success: false, message }); }
function serviceName(id) { return servicesSeed.find(s => s.id === id)?.name || "Dental appointment"; }

async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return errorResponse(res, 401, "Please sign in to continue.");
  if (isDemo() && token === "demo-session-token") { req.admin = { email: process.env.DEMO_ADMIN_EMAIL || "demo@smilecare.local" }; return next(); }
  if (!hasSupabase) return errorResponse(res, 503, "Authentication is not configured. Set up Supabase first.");
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return errorResponse(res, 401, "Your session has expired. Please sign in again.");
    const email = (data.user.email || "").toLowerCase();
    const admins = (process.env.ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(email)) return errorResponse(res, 403, "This account does not have staff access.");
    req.admin = { id: data.user.id, email };
    next();
  } catch { return errorResponse(res, 401, "Could not verify your session."); }
}

app.get("/api/health", (req, res) => res.json({ success: true, message: "SmileCare API is running", mode: isDemo() ? "demo" : "supabase" }));

app.post("/api/auth/login", async (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return errorResponse(res, 400, "Enter your email and password.");
  if (isDemo()) {
    const demoEmail = (process.env.DEMO_ADMIN_EMAIL || "demo@smilecare.local").toLowerCase();
    const demoPassword = process.env.DEMO_ADMIN_PASSWORD || "SmileCareDemo123!";
    const emailOk = email === demoEmail;
    const passOk = password.length === demoPassword.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(demoPassword));
    if (!emailOk || !passOk) return errorResponse(res, 401, "Email or password is incorrect.");
    return res.json({ success: true, token: "demo-session-token", user: { email } });
  }
  try {
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return errorResponse(res, 401, "Email or password is incorrect.");
    const admins = (process.env.ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(email)) { await authClient.auth.signOut(); return errorResponse(res, 403, "This account does not have staff access."); }
    return res.json({ success: true, token: data.session.access_token, user: { email: data.user.email } });
  } catch { return errorResponse(res, 500, "Sign-in is temporarily unavailable."); }
});

app.get("/api/services", async (req, res) => {
  if (isDemo()) return res.json({ success: true, data: servicesSeed.filter(s => s.is_active) });
  const { data, error } = await supabase.from("services").select("id,name,description,duration_minutes,price,is_active").eq("is_active", true).order("name");
if (error) {
  console.error("Supabase services error:", {
    message: error.message,
    code: error.code,
    details: error.details,
  });

  return errorResponse(res, 500, "Could not load services.");
}
  res.json({ success: true, data });
});

app.get("/api/settings", (req, res) => res.json({ success: true, data: clinicSettings }));

app.post("/api/appointments", async (req, res) => {
  const patient_name = clean(req.body?.patient_name, 100);
  const email = clean(req.body?.email, 254).toLowerCase();
  const phone = clean(req.body?.phone, 30);
  const service_id = clean(req.body?.service_id, 80);
  const preferred_at = clean(req.body?.preferred_at, 60);
  const message = clean(req.body?.message, 1000);
  const consent = req.body?.consent === true;
  if (patient_name.length < 2) return errorResponse(res, 400, "Please enter your full name.");
  if (!phone || phone.replace(/\D/g, "").length < 7) return errorResponse(res, 400, "Please enter a valid phone number.");
  if (!validEmail(email)) return errorResponse(res, 400, "Please enter a valid email address or leave it blank.");
  if (!service_id || !preferred_at || Number.isNaN(Date.parse(preferred_at))) return errorResponse(res, 400, "Choose a service and preferred date/time.");
  if (Date.parse(preferred_at) < Date.now() - 60000) return errorResponse(res, 400, "Please choose a future date and time.");
  if (!consent) return errorResponse(res, 400, "Please confirm that the clinic may contact you about this request.");
  if (isDemo()) {
    const service = servicesSeed.find(s => s.id === service_id && s.is_active);
    if (!service) return errorResponse(res, 400, "Choose one of the available services.");
    const item = { id: `demo-${crypto.randomUUID()}`, patient_name, email: email || null, phone, service_id, service_name: service.name, preferred_at: new Date(preferred_at).toISOString(), status: "pending", message, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    demoAppointments.unshift(item);
    return res.status(201).json({ success: true, message: "Your appointment request has been received. The clinic will contact you to confirm the time.", data: { id: item.id, status: item.status } });
  }
  const { data: service, error: serviceError } = await supabase.from("services").select("id,name").eq("id", service_id).eq("is_active", true).maybeSingle();
  if (serviceError || !service) return errorResponse(res, 400, "Choose one of the available services.");
  const { data, error } = await supabase.from("appointments").insert({ patient_name, email: email || null, phone, service_id, preferred_at: new Date(preferred_at).toISOString(), status: "pending", message: message || null, consent_to_contact: true }).select("id,status").single();
  if (error) return errorResponse(res, 500, "We could not save your request. Please try again.");
  res.status(201).json({ success: true, message: "Your appointment request has been received. The clinic will contact you to confirm the time.", data });
});

app.get("/api/admin/appointments", requireAdmin, async (req, res) => {
  const status = clean(req.query.status, 20);
  const search = clean(req.query.search, 100).toLowerCase();
  if (isDemo()) {
    let rows = [...demoAppointments];
    if (["pending", "confirmed", "completed", "cancelled"].includes(status)) rows = rows.filter(a => a.status === status);
    if (search) rows = rows.filter(a => [a.patient_name, a.phone, a.email, a.service_name].some(v => (v || "").toLowerCase().includes(search)));
    return res.json({ success: true, data: rows });
  }
  let query = supabase.from("appointments").select("id,patient_name,email,phone,service_id,preferred_at,status,message,created_at,updated_at,services(name)").order("preferred_at", { ascending: true }).limit(500);
  if (["pending", "confirmed", "completed", "cancelled"].includes(status)) query = query.eq("status", status);
  if (search) query = query.or(`patient_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) return errorResponse(res, 500, "Could not load appointments.");
  res.json({ success: true, data: (data || []).map(a => ({ ...a, service_name: a.services?.name || "Dental appointment", services: undefined })) });
});

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  let rows;
  if (isDemo()) rows = demoAppointments;
  else {
    const { data, error } = await supabase.from("appointments").select("id,status,preferred_at,created_at").limit(2000);
    if (error) return errorResponse(res, 500, "Could not load dashboard.");
    rows = data || [];
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  res.json({ success: true, data: { total: rows.length, pending: rows.filter(a => a.status === "pending").length, confirmed: rows.filter(a => a.status === "confirmed").length, completed: rows.filter(a => a.status === "completed").length, today: rows.filter(a => { const d = new Date(a.preferred_at); return d >= today && d < tomorrow && ["confirmed", "pending"].includes(a.status); }).length, upcoming: rows.filter(a => new Date(a.preferred_at) >= new Date() && ["confirmed", "pending"].includes(a.status)).length } });
});

app.patch("/api/admin/appointments/:id/status", requireAdmin, async (req, res) => {
  const status = clean(req.body?.status, 20);
  if (!["pending", "confirmed", "completed", "cancelled"].includes(status)) return errorResponse(res, 400, "Choose a valid appointment status.");
  const id = clean(req.params.id, 100);
  if (isDemo()) {
    const item = demoAppointments.find(a => a.id === id);
    if (!item) return errorResponse(res, 404, "Appointment not found.");
    item.status = status; item.updated_at = new Date().toISOString();
    return res.json({ success: true, message: "Appointment status updated.", data: item });
  }
  const { data, error } = await supabase.from("appointments").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select("id,status,updated_at").maybeSingle();
  if (error) return errorResponse(res, 500, "Could not update appointment status.");
  if (!data) return errorResponse(res, 404, "Appointment not found.");
  res.json({ success: true, message: "Appointment status updated.", data });
});

app.use((req, res) => errorResponse(res, 404, "That endpoint was not found."));
app.use((err, req, res, next) => {
  if (err?.message === "Origin not allowed") return errorResponse(res, 403, "This website origin is not allowed.");
  console.error("API error:", err?.message || "Unknown error");
  if (res.headersSent) return next(err);
  return errorResponse(res, 500, "Something went wrong. Please try again.");
});
app.listen(PORT, () => console.log(`SmileCare API listening on http://localhost:${PORT} (${isDemo() ? "demo mode" : "Supabase mode"})`));
