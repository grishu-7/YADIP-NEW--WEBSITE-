require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const admin = require("firebase-admin");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb", verify: (req,res,buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(express.urlencoded({ extended: false }));

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.resolve(__dirname, "..");
const dbDir = path.join(ROOT, "database");
fs.mkdirSync(dbDir, { recursive: true });
const sql = new Database(path.join(dbDir, "app.sqlite"));
sql.pragma("journal_mode = WAL");
sql.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, uid TEXT NOT NULL, email TEXT, product_id TEXT NOT NULL,
 plan_key TEXT, pid TEXT, duration_string TEXT, amount REAL NOT NULL,
 payment_id TEXT, status TEXT NOT NULL, api_status TEXT NOT NULL DEFAULT 'not_started',
 redirect_url TEXT, key_value TEXT, expires_at TEXT, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_id) WHERE payment_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, event TEXT, order_id TEXT, detail TEXT, created_at TEXT
);
`);

const getSetting = (key, fallback="") => {
  const row = sql.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : fallback;
};
const setSetting = (key, value) => sql.prepare(
  "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
).run(key, String(value ?? ""));
const now = () => new Date().toISOString();

// Safe non-secret defaults. Secrets remain in environment variables or protected admin settings.
if (!getSetting("resellerApiUrl")) setSetting("resellerApiUrl", process.env.RESELLER_API_URL || "https://bantibhaiya.to/api/reseller_v1.php");
if (!getSetting("paymentApiUrl")) setSetting("paymentApiUrl", process.env.FAMPAY_CREATE_ORDER_URL || "https://famgateway.in/api/create-order");
if (!getSetting("paymentVerifyUrl")) setSetting("paymentVerifyUrl", process.env.FAMPAY_VERIFY_ORDER_URL || "https://famgateway.in/api/verify-order.php");
const log = (level,event,orderId,detail) => sql.prepare(
  "INSERT INTO logs(level,event,order_id,detail,created_at) VALUES(?,?,?,?,?)"
).run(level,event,orderId || null, typeof detail === "string" ? detail : JSON.stringify(detail), now());

let firebaseDb = null;
let firebaseReady = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(creds), databaseURL: process.env.FIREBASE_DATABASE_URL });
    firebaseDb = admin.database();
    firebaseReady = true;
  }
} catch (e) { log("error","firebase_init",null,e.message); }

async function verifyUser(req,res,next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
    if (!firebaseReady) return res.status(503).json({error:"Firebase Admin is not configured"});
    req.user = await admin.auth().verifyIdToken(h.slice(7));
    next();
  } catch (e) { return res.status(401).json({error:"Invalid authentication token"}); }
}
async function verifyAdmin(req,res,next) {
  await verifyUser(req,res,async () => {
    const allowed = (process.env.ADMIN_EMAILS || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes((req.user.email || "").toLowerCase())) return res.status(403).json({error:"Admin access denied"});
    next();
  });
}
function publicSettings() {
  const keys = [
    "apiBaseUrl","resellerApiUrl","resellerApiKey","resellerMasterKey","resellerExtraParams",
    "paymentApiUrl","paymentVerifyUrl","paymentApiKey","paymentSecret","merchantId","callbackUrl","paymentWebhookUrl","defaultPid",
    "defaultDuration","videoUrl"
  ];
  const out={}; for (const k of keys) out[k]=getSetting(k,"");
  return out;
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

async function httpRequest(url, options={}) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), Number(process.env.OUTBOUND_TIMEOUT_MS||20000));
  try {
    const r = await fetch(url,{...options,signal:controller.signal});
    const text = await r.text();
    let data; try { data=JSON.parse(text); } catch { data={raw:text}; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${typeof data.raw==="string"?data.raw.slice(0,500):"request failed"}`);
    return data;
  } finally { clearTimeout(timer); }
}
async function httpJson(url, options={}) {
  return httpRequest(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
}
async function httpForm(url, fields, headers={}) {
  const body = new URLSearchParams();
  for (const [k,v] of Object.entries(fields)) if (v !== undefined && v !== null && String(v) !== "") body.set(k,String(v));
  return httpRequest(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...(headers||{})},body});
}

async function getProduct(productId) {
  if (!firebaseReady) throw new Error("Firebase Admin not configured");
  const snap = await firebaseDb.ref(`panels/${productId}`).once("value");
  if (!snap.exists()) throw new Error("Product not found");
  return { id: productId, ...snap.val() };
}

function buildResellerPayload(order, product) {
  const extra = safeJson(getSetting("resellerExtraParams",""));
  const pid = order.pid || product.pid || product.productId || getSetting("defaultPid");
  const duration = order.duration_string || product.durationString || product.resellerDurationString || getSetting("defaultDuration");
  const payload = {
    ...extra,
    action: "buy",
    product_id: pid,
    duration
  };
  // Device-bound/V1 products may require android_id. V2 products can omit it.
  const androidId = product.androidId || product.android_id || extra.android_id;
  if (androidId) payload.android_id = androidId;
  return payload;
}
function extractResellerKey(data) {
  const candidates = [
    data?.key, data?.license_key, data?.licenseKey, data?.generated_key,
    data?.data?.key, data?.data?.license_key, data?.data?.licenseKey,
    data?.result?.key, data?.result?.license_key
  ];
  const found = candidates.find(v => typeof v === "string" && v.trim());
  return found ? found.trim() : null;
}
async function generateKey(orderId) {
  const order = sql.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "paid") throw new Error("Order is not paid");
  if (order.key_value) return order.key_value;
  const product = await getProduct(order.product_id);
  const url = getSetting("resellerApiUrl", process.env.RESELLER_API_URL || "https://bantibhaiya.to/api/reseller_v1.php");
  const apiKey = getSetting("resellerApiKey", process.env.RESELLER_API_KEY || "");
  const master = getSetting("resellerMasterKey", process.env.RESELLER_MASTER_KEY || "");
  if (!url || !apiKey || !master) throw new Error("Reseller API URL, API Key and Master Key are required");
  const payload = buildResellerPayload(order,product);
  if (!payload.product_id) throw new Error("Reseller Product PID is not configured");
  if (!payload.duration) throw new Error("Reseller Duration String is not configured");
  const data = await httpForm(url,payload,{
    "x-master-key": master,
    "User-Agent": "YADIPWEB-Premium/4.0"
  });
  const status = String(data?.status || data?.success || data?.result || "").toLowerCase();
  if (status === "error" || data?.success === false) {
    throw new Error(String(data?.message || data?.error || "Reseller API rejected the purchase").slice(0,500));
  }
  const key = extractResellerKey(data);
  if (!key) throw new Error(`Reseller API returned no key: ${JSON.stringify(data).slice(0,500)}`);
  const expires = data.expires_at || data.expiry || data.expiration || data.data?.expires_at || data.data?.expiry || null;
  sql.prepare("UPDATE orders SET key_value=?,expires_at=?,api_status='success',updated_at=? WHERE id=? AND key_value IS NULL")
    .run(String(key), expires, now(), orderId);
  if (firebaseReady) {
    await firebaseDb.ref(`orders/${order.uid}/${order.id}`).update({
      status:"approved", key:String(key), api_status:"success", payment_id:order.payment_id || null,
      expiry:expires || order.duration_string || null, updatedAt:admin.database.ServerValue.TIMESTAMP
    });
  }
  log("info","key_generated",orderId,{product:order.product_id,pid:payload.product_id,duration:payload.duration});
  return String(key);
}

async function createPayment(order) {
  const url=getSetting("paymentApiUrl", process.env.FAMPAY_CREATE_ORDER_URL || "https://famgateway.in/api/create-order");
  const verifyUrl=getSetting("paymentVerifyUrl", process.env.FAMPAY_VERIFY_ORDER_URL || "https://famgateway.in/api/verify-order.php");
  if (!url) throw new Error("FamGateway create-order URL is not configured");
  const apiKey=getSetting("paymentApiKey", process.env.FAMPAY_API_KEY || "");
  if (!apiKey) throw new Error("FamGateway API Key is not configured");
  const base = process.env.PUBLIC_BASE_URL || "";
  const webhook = getSetting("paymentWebhookUrl", process.env.FAMPAY_WEBHOOK_URL || `${base}/api/payment/webhook`);
  const redirect = getSetting("callbackUrl", process.env.FAMPAY_REDIRECT_URL || `${base}/?payment=success`);
  const payload={
    amount:Number(order.amount.toFixed ? order.amount.toFixed(2) : order.amount),
    customer_email:order.email || undefined,
    redirect_url:redirect || undefined,
    webhook_url:webhook || undefined,
    customer_name:order.email || "YADIP Customer"
  };
  const data=await httpJson(url,{method:"POST",headers:{"X-Api-Key":apiKey},body:JSON.stringify(payload)});
  if (String(data?.status||"").toLowerCase() !== "success") throw new Error(String(data?.message||data?.error||"FamGateway order creation failed").slice(0,500));
  const d=data.data||data;
  return {
    paymentId:d.order_id || data.order_id || null,
    redirectUrl:d.checkout_url || data.checkout_url || d.redirect_url || data.redirect_url || null,
    qrUrl:d.qr_url || null,
    upiIntent:d.upi_intent || null,
    verifyUrl,
    raw:data
  };
}
async function verifyPayment(order,paymentId) {
  const url=getSetting("paymentVerifyUrl", process.env.FAMPAY_VERIFY_ORDER_URL || "https://famgateway.in/api/verify-order.php");
  if (!url) throw new Error("FamGateway verify-order URL is not configured");
  const apiKey=getSetting("paymentApiKey", process.env.FAMPAY_API_KEY || "");
  if (!apiKey) throw new Error("FamGateway API Key is not configured");
  if (!paymentId) throw new Error("FamGateway order_id is missing");
  const u=new URL(url);
  u.searchParams.set("order_id",paymentId);
  const data=await httpRequest(u.toString(),{method:"GET",headers:{"X-Api-Key":apiKey,"Accept":"application/json"}});
  const status=String(data.status || data.payment_status || data.data?.status || "").toLowerCase();
  const paid=status==="success" || status==="paid" || status==="successful" || data.paid===true || data.data?.paid===true;
  return {paid,status,utr:data.utr||data.data?.utr||null,raw:data};
}

app.get("/api/health",(req,res)=>res.json({ok:true,time:now(),firebase:firebaseReady}));
app.get("/api/config/public",(req,res)=>res.json({videoUrl:getSetting("videoUrl","")}));

app.get("/api/admin/settings",verifyAdmin,(req,res)=>res.json({settings:publicSettings()}));
app.put("/api/admin/settings",verifyAdmin,(req,res)=>{
  const allowed=["apiBaseUrl","resellerApiUrl","resellerApiKey","resellerMasterKey","resellerExtraParams",
    "paymentApiUrl","paymentVerifyUrl","paymentApiKey","paymentSecret","merchantId","callbackUrl","paymentWebhookUrl","defaultPid","defaultDuration","videoUrl"];
  for(const k of allowed) if(Object.prototype.hasOwnProperty.call(req.body,k)) setSetting(k,req.body[k]);
  res.json({ok:true});
});
app.post("/api/admin/test/reseller",verifyAdmin,async(req,res)=>{
  try {
    const url=getSetting("resellerApiUrl",process.env.RESELLER_API_URL||"");
    const key=getSetting("resellerApiKey",process.env.RESELLER_API_KEY||"");
    const master=getSetting("resellerMasterKey",process.env.RESELLER_MASTER_KEY||"");
    const pid=getSetting("defaultPid",process.env.RESELLER_DEFAULT_PID||"");
    const duration=getSetting("defaultDuration",process.env.RESELLER_DEFAULT_DURATION||"");
    if(!url || !key || !master) throw new Error("Reseller API URL, API Key and Master Key are required");
    new URL(url);
    if(!pid || !duration) return res.json({ok:true,configured:true,liveTest:false,message:"Credentials are configured. Live test is disabled because the reseller endpoint action=buy creates a real key."});
    res.json({ok:true,configured:true,liveTest:false,message:"Configuration valid. Live buy test was not executed to avoid creating a real paid key."});
  } catch(e){ res.status(400).json({error:e.message}); }
});
app.get("/api/admin/orders",verifyAdmin,(req,res)=>{
  const limit=Math.min(Number(req.query.limit||200),500);
  const rows=sql.prepare("SELECT id,uid,email,product_id,plan_key,pid,duration_string,amount,payment_id,status,api_status,key_value,expires_at,error,created_at,updated_at FROM orders ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json({orders:rows.map(o=>({...o,key:o.key_value}))});
});

app.post("/api/admin/test/payment",verifyAdmin,async(req,res)=>{
  try {
    const url=getSetting("paymentApiUrl",process.env.FAMPAY_CREATE_ORDER_URL||"https://famgateway.in/api/create-order");
    const key=getSetting("paymentApiKey",process.env.FAMPAY_API_KEY||"");
    if(!url || !key) throw new Error("FamGateway create-order URL and API Key are required");
    new URL(url);
    res.json({ok:true,configured:true,liveTest:false,message:"FamGateway configuration is valid. No real payment order was created during the test."});
  } catch(e){ res.status(400).json({error:e.message}); }
});

app.post("/api/deposits",verifyUser,async(req,res)=>{
  const amount=Number(req.body.amount), phone=String(req.body.phone||"").trim();
  if(!Number.isFinite(amount)||amount<=0||phone.length<10) return res.status(400).json({error:"Invalid amount or phone"});
  const id="DEP"+Date.now()+crypto.randomBytes(3).toString("hex").toUpperCase();
  const order={id,uid:req.user.uid,email:req.user.email||"",product_id:"WALLET",amount,payment_id:null};
  try {
    const payment=await createPayment(order);
    sql.prepare(`INSERT INTO orders(id,uid,email,product_id,amount,payment_id,status,api_status,redirect_url,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,order.uid,order.email,"WALLET",amount,payment.paymentId,"deposit_pending","not_applicable",payment.redirectUrl,now(),now());
    res.json({order_id:id,payment_id:payment.paymentId,redirect_url:payment.redirectUrl,status:"pending"});
  } catch(e) { log("error","deposit_create",id,e.message); res.status(400).json({error:e.message}); }
});
app.get("/api/deposits/:id",verifyUser,(req,res)=>{
  const o=sql.prepare("SELECT id,amount,payment_id,status,created_at,updated_at FROM orders WHERE id=? AND uid=? AND product_id='WALLET'").get(req.params.id,req.user.uid);
  if(!o) return res.status(404).json({error:"Deposit not found"});
  res.json({order_id:o.id,amount:o.amount,payment_id:o.payment_id,status:o.status,created_at:o.created_at,updated_at:o.updated_at});
});

app.post("/api/orders",verifyUser,async(req,res)=>{
  const {productId,planKey,couponId}=req.body;
  let amount=Number(req.body.amount);
  if(!productId || !Number.isFinite(amount) || amount<=0) return res.status(400).json({error:"Invalid product or amount"});
  try {
    const product=await getProduct(productId);
    const plan=product.plans?.[planKey];
    if(!plan) return res.status(400).json({error:"Invalid plan"});
    // Never trust the browser's price.
    amount=Number(plan.price||0);
    if(amount<=0) return res.status(400).json({error:"Invalid product price"});
    const pid=product.pid || product.productId || getSetting("defaultPid");
    const duration=product.durationString || product.resellerDurationString || plan.durationString || plan.label || getSetting("defaultDuration");
    const id="ORD"+Date.now()+crypto.randomBytes(3).toString("hex").toUpperCase();
    const created=now();
    sql.prepare(`INSERT INTO orders(id,uid,email,product_id,plan_key,pid,duration_string,amount,status,api_status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,req.user.uid,req.user.email||"",productId,planKey,pid,duration,amount,"pending","not_started",created,created);
    const order=sql.prepare("SELECT * FROM orders WHERE id=?").get(id);
    const payment=await createPayment(order);
    sql.prepare("UPDATE orders SET payment_id=?,redirect_url=?,updated_at=? WHERE id=?").run(payment.paymentId,payment.redirectUrl,now(),id);
    if(firebaseReady) await firebaseDb.ref(`orders/${req.user.uid}/${id}`).set({
      id,panelId:productId,panelName:product.name||"Product",plan:planKey,label:plan.label||planKey,
      price:amount,status:"pending",payment_id:payment.paymentId||null,pid,duration_string:duration,
      date:created,uid:req.user.uid,email:req.user.email||""
    });
    res.json({order_id:id,payment_id:payment.paymentId,redirect_url:payment.redirectUrl,status:"pending"});
  } catch(e){ log("error","order_create",null,e.message); res.status(400).json({error:e.message}); }
});

app.get("/api/orders/:id",verifyUser,async(req,res)=>{
  let o=sql.prepare("SELECT * FROM orders WHERE id=? AND uid=?").get(req.params.id,req.user.uid);
  if(!o) return res.status(404).json({error:"Order not found"});
  // Authoritative server-side FamGateway verification during client polling.
  if(o.status==="pending" && o.payment_id && o.product_id!=="WALLET") {
    try { await settleOrder(o,o.payment_id); } catch(e) { log("warn","payment_poll",o.id,e.message); }
    o=sql.prepare("SELECT * FROM orders WHERE id=? AND uid=?").get(req.params.id,req.user.uid);
  }
  res.json({...o,key:o.key_value});
});

async function settleOrder(order,paymentId) {
  const fresh=sql.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  if(!fresh) throw new Error("Order not found");
  if(fresh.key_value) return fresh;
  if(fresh.status==="paid" || fresh.status==="deposit_success") return fresh;
  const result=await verifyPayment(fresh,paymentId || fresh.payment_id);
  if(!result.paid) {
    sql.prepare("UPDATE orders SET status=?,payment_id=?,updated_at=? WHERE id=?").run("pending",paymentId||fresh.payment_id,now(),fresh.id);
    return sql.prepare("SELECT * FROM orders WHERE id=?").get(fresh.id);
  }
  const updated=sql.prepare("UPDATE orders SET status='paid',payment_id=?,updated_at=? WHERE id=? AND status!='paid'").run(paymentId||fresh.payment_id,now(),fresh.id);
  const paid=sql.prepare("SELECT * FROM orders WHERE id=?").get(fresh.id);
  if (fresh.product_id === "WALLET") {
    sql.prepare("UPDATE orders SET status='deposit_success',api_status='not_applicable',updated_at=? WHERE id=?").run(now(),fresh.id);
    if (firebaseReady) {
      await firebaseDb.ref(`transactions/${fresh.uid}/${fresh.id}`).set({
        id:fresh.id,type:"deposit_auto",amount:fresh.amount,status:"approved",date:now(),payment_id:fresh.payment_id
      });
      await firebaseDb.ref(`users/${fresh.uid}/balance`).transaction(v => (Number(v)||0)+Number(fresh.amount));
      await firebaseDb.ref(`gateway_payments/${fresh.id}`).update({status:"approved",amount:fresh.amount,payment_id:fresh.payment_id});
    }
  } else {
    try { await generateKey(fresh.id); }
    catch(e) {
      sql.prepare("UPDATE orders SET api_status='failed',error=?,updated_at=? WHERE id=?").run(e.message,now(),fresh.id);
      log("error","key_generation",fresh.id,e.message);
    }
  }
  return sql.prepare("SELECT * FROM orders WHERE id=?").get(fresh.id);
}

function findOrderForGateway(reqBody) {
  const suppliedOrderId = String(reqBody?.order_id || reqBody?.orderId || "");
  const suppliedPaymentId = String(reqBody?.payment_id || reqBody?.transaction_id || reqBody?.txn_id || "");
  let order = suppliedOrderId ? sql.prepare("SELECT * FROM orders WHERE id=?").get(suppliedOrderId) : null;
  let paymentId = suppliedPaymentId || null;
  if (!order && suppliedOrderId) {
    order = sql.prepare("SELECT * FROM orders WHERE payment_id=?").get(suppliedOrderId);
    if (order) paymentId = suppliedOrderId;
  }
  if (!order && suppliedPaymentId) order = sql.prepare("SELECT * FROM orders WHERE payment_id=?").get(suppliedPaymentId);
  return {order,paymentId};
}
function verifyWebhookSignature(req) {
  const secret=getSetting("paymentSecret",process.env.FAMPAY_WEBHOOK_SECRET||"");
  if(!secret) return true;
  const signature=String(req.headers["x-webhook-signature"] || req.headers["x-signature"] || req.headers["x-famgateway-signature"] || "").trim().replace(/^sha256=/i,"");
  if(!signature || !req.rawBody) return false;
  const expected=crypto.createHmac("sha256",secret).update(req.rawBody).digest("hex");
  const a=Buffer.from(signature,"utf8"), b=Buffer.from(expected,"utf8");
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
app.post("/api/payment/callback",async(req,res)=>{
  try {
    const {order,paymentId}=findOrderForGateway(req.body);
    if(!order) return res.status(404).send("unknown order");
    await settleOrder(order,paymentId || order.payment_id);
    res.json({ok:true});
  } catch(e){ log("error","payment_callback",req.body?.order_id,e.message); res.status(400).json({error:e.message}); }
});

app.post("/api/payment/webhook",async(req,res)=>{
  try {
    if(!verifyWebhookSignature(req)) return res.status(401).json({error:"Invalid webhook signature"});
    const {order,paymentId}=findOrderForGateway(req.body);
    if(!order) return res.status(404).json({error:"Order not found"});
    await settleOrder(order,paymentId || order.payment_id);
    res.json({ok:true});
  } catch(e){ log("error","payment_webhook",null,e.message); res.status(400).json({error:e.message}); }
});

app.use(express.static(ROOT,{index:"index.html",dotfiles:"ignore"}));
app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found"});
  res.sendFile(path.join(ROOT,"index.html"));
});

app.listen(PORT,"0.0.0.0",()=>console.log(`YADIP backend listening on ${PORT}`));
