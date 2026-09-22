const express=require("express"),session=require("express-session"),bcrypt=require("bcryptjs"),helmet=require("helmet"),compression=require("compression");
const {createClient}=require("@supabase/supabase-js");

const PORT=process.env.PORT||3000;
const SECRET=process.env.SESSION_SECRET||"CHANGE-ME-SET-IN-RENDER";
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");process.exit(1)}
const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const app=express();

app.use(helmet({contentSecurityPolicy:false}));
app.use(compression());
app.use(express.json());
app.use(session({secret:SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",maxAge:2592000000}}));

const auth=(q,r,n)=>q.session.user?n():r.status(401).json({error:"Connexion requise"});
const admin=(q,r,n)=>q.session.user?.role==="admin"?n():r.status(403).json({error:"Accès administrateur requis"});
const staff=(q,r,n)=>["admin","operator"].includes(q.session.user?.role)?n():r.status(403).json({error:"Accès caisse requis"});
const ownClientId=q=>q.session.user?.role==="participant"?String(q.session.user.clientId):null;
const cid=x=>String(x);
const next=async(table)=>{
  const {data,error}=await sb.from(table).select("id");
  if(error)throw error;
  const nums=(data||[]).map(x=>Number(x.id)).filter(Number.isFinite);
  return nums.length?Math.max(...nums)+1:1;
};

async function ensureSetup(){
  const {data:products,error:pe}=await sb.from("products").select("id");
  if(pe)throw pe;
  const have=new Set((products||[]).map(x=>String(x.id)));
  const wanted=[{id:"repas",name:"Repas",price:5,icon:"🍽️",active:true},{id:"aperitif",name:"Apéro",price:5,icon:"🍹",active:true}];
  for(const p of wanted)if(!have.has(p.id)){const {error}=await sb.from("products").insert(p);if(error)throw error}
  const {data:settings,error:se}=await sb.from("settings").select("key").eq("key","revolut_link").maybeSingle();
  if(se)throw se;
  if(!settings){const {error}=await sb.from("settings").insert({key:"revolut_link",value:"https://revolut.me/amamoh"});if(error)throw error}
  const {data:users,error:ue}=await sb.from("users").select("username");
  if(ue)throw ue;
  const haveUsers=new Set((users||[]).map(x=>x.username));
  const admins=[
    {id:"1",username:"admin",password:process.env.ADMIN_PASSWORD||"Admin123!",role:"admin"},
    {id:"2",username:"caisse",password:process.env.OPERATOR_PASSWORD||"Caisse123!",role:"operator"}
  ];
  for(const u of admins)if(!haveUsers.has(u.username)){const {error}=await sb.from("users").insert({id:u.id,username:u.username,password_hash:bcrypt.hashSync(u.password,10),role:u.role});if(error)throw error}
}

async function getClient(id){
  const {data:c,error}=await sb.from("clients").select("*").eq("id",cid(id)).maybeSingle();
  if(error)throw error;if(!c)return null;
  const {data:tx,error:te}=await sb.from("transactions").select("amount").eq("client_id",cid(c.id));
  if(te)throw te;
  return {...c,balance:(tx||[]).reduce((s,t)=>s+Number(t.amount),0)};
}
async function getClientHistory(id){
  const {data,error}=await sb.from("transactions").select("*").eq("client_id",cid(id)).order("created_at",{ascending:false}).limit(50);
  if(error)throw error;return data||[];
}

app.get("/api/health",async(q,r)=>{try{await ensureSetup();r.json({ok:true})}catch(e){console.error(e);r.status(500).json({ok:false,error:"Base de données indisponible"})}});

app.post("/api/login",async(q,r)=>{try{
  const username=String(q.body.username||"").trim().toLowerCase(),password=String(q.body.password||"");
  const {data:u,error}=await sb.from("users").select("*").eq("username",username).maybeSingle();
  if(error)throw error;
  if(u&&bcrypt.compareSync(password,u.password_hash)){q.session.user={id:u.id,username:u.username,role:u.role};return r.json({user:q.session.user})}
  const {data:c,error:ce}=await sb.from("clients").select("*").eq("id",username).eq("active",true).maybeSingle();
  if(ce)throw ce;
  if(c&&String(c.pin)===password){q.session.user={id:"p-"+cid(c.id),username:cid(c.id),role:"participant",clientId:cid(c.id)};return r.json({user:q.session.user})}
  r.status(401).json({error:"Identifiants incorrects"});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.post("/api/logout",(q,r)=>q.session.destroy(()=>r.json({ok:true})));
app.get("/api/me",(q,r)=>r.json({user:q.session.user||null}));

app.get("/api/dashboard",staff,async(q,r)=>{try{
  const {data:tx,error:te}=await sb.from("transactions").select("amount,created_at");if(te)throw te;
  const {data:clients,error:ce}=await sb.from("clients").select("id").eq("active",true);if(ce)throw ce;
  const all=tx||[],start=new Date();start.setHours(0,0,0,0),today=all.filter(t=>new Date(t.created_at)>=start);
  r.json({total:all.reduce((s,t)=>s+Number(t.amount),0),todayNet:today.reduce((s,t)=>s+Number(t.amount),0),credits:all.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0),expenses:all.filter(t=>Number(t.amount)<0).reduce((s,t)=>s-Number(t.amount),0),clients:(clients||[]).length});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.get("/api/clients",auth,async(q,r)=>{try{
  if(q.session.user?.role==="participant")return r.json([await getClient(q.session.user.clientId)].filter(Boolean));
  const x=String(q.query.q||"").toLowerCase().trim();let query=sb.from("clients").select("*").eq("active",true).order("name",{ascending:true}).limit(100);
  const {data,error}=await query;if(error)throw error;
  const filtered=(data||[]).filter(c=>!x||String(c.name).toLowerCase().includes(x)||cid(c.id).toLowerCase()===x);
  const out=[];for(const c of filtered)out.push(await getClient(c.id));r.json(out);
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.get("/api/clients/:id",auth,async(q,r)=>{try{
  if(q.session.user?.role==="participant"&&cid(q.params.id)!==cid(q.session.user.clientId))return r.status(403).json({error:"Accès interdit"});
  const c=await getClient(q.params.id);if(!c)return r.status(404).json({error:"Personne introuvable"});
  r.json({...c,history:await getClientHistory(c.id)});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.get("/api/products",auth,async(q,r)=>{try{const {data,error}=await sb.from("products").select("*").eq("active",true);if(error)throw error;r.json(data||[])}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.get("/api/settings",auth,async(q,r)=>{try{const {data,error}=await sb.from("settings").select("value").eq("key","revolut_link").maybeSingle();if(error)throw error;r.json({revolut_link:data?.value||""})}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.put("/api/settings",admin,async(q,r)=>{try{const value=String(q.body.revolut_link||"").trim();const {error}=await sb.from("settings").upsert({key:"revolut_link",value});if(error)throw error;r.json({revolut_link:value})}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.get("/api/pending-credits",auth,async(q,r)=>{try{
  let query=sb.from("pending_credits").select("*").order("created_at",{ascending:false});
  if(q.session.user?.role==="participant")query=query.eq("client_id",cid(q.session.user.clientId));
  const {data,error}=await query;if(error)throw error;r.json(data||[]);
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.post("/api/pending-credits",auth,async(q,r)=>{try{
  const requestedId=cid(q.body.clientId);if(q.session.user?.role==="participant"&&requestedId!==cid(q.session.user.clientId))return r.status(403).json({error:"Accès interdit"});
  const c=await getClient(requestedId),a=Number(q.body.amount);if(!c||!Number.isFinite(a)||a<=0)return r.status(400).json({error:"Montant invalide"});
  const p={id:String(await next("pending_credits")),created_at:new Date().toISOString(),client_id:cid(c.id),amount:a,status:"pending"};const {data,error}=await sb.from("pending_credits").insert(p).select().single();if(error)throw error;r.json(data);
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.post("/api/pending-credits/:id/validate",staff,async(q,r)=>{try{
  const {data:p,error:pe}=await sb.from("pending_credits").select("*").eq("id",cid(q.params.id)).eq("status","pending").maybeSingle();if(pe)throw pe;if(!p)return r.status(404).json({error:"Demande introuvable"});
  const now=new Date().toISOString();const {data:updated,error:ue}=await sb.from("pending_credits").update({status:"validated",validated_at:now}).eq("id",p.id).select().single();if(ue)throw ue;
  const t={id:String(await next("transactions")),created_at:now,client_id:p.client_id,operation:"Crédit Revolut",product_id:null,method:"Revolut",amount:Number(p.amount),created_by:q.session.user.username};const {data:tx,error:te}=await sb.from("transactions").insert(t).select().single();if(te)throw te;
  r.json({pending:updated,transaction:tx,client:await getClient(p.client_id)});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.post("/api/pending-credits/:id/reject",staff,async(q,r)=>{try{const {data,error}=await sb.from("pending_credits").update({status:"rejected",rejected_at:new Date().toISOString()}).eq("id",cid(q.params.id)).eq("status","pending").select().maybeSingle();if(error)throw error;if(!data)return r.status(404).json({error:"Demande introuvable"});r.json(data)}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.post("/api/transactions",staff,async(q,r)=>{try{
  const c=await getClient(q.body.clientId);const {data:p,error:pe}=await sb.from("products").select("*").eq("id",cid(q.body.productId)).eq("active",true).maybeSingle();if(pe)throw pe;if(!c||!p)return r.status(404).json({error:"Personne ou produit introuvable"});
  const t={id:String(await next("transactions")),created_at:new Date().toISOString(),client_id:cid(c.id),operation:p.name,product_id:p.id,method:String(q.body.method||"Virement"),amount:-Math.abs(Number(p.price)),created_by:q.session.user.username};const {data,error}=await sb.from("transactions").insert(t).select().single();if(error)throw error;r.json({transaction:t,client:await getClient(c.id)});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.post("/api/credit",staff,async(q,r)=>{try{
  const c=await getClient(q.body.clientId),a=Number(q.body.amount);if(!c||!Number.isFinite(a)||a<=0)return r.status(400).json({error:"Montant invalide"});
  const t={id:String(await next("transactions")),created_at:new Date().toISOString(),client_id:cid(c.id),operation:"Crédit",product_id:null,method:String(q.body.method||"Virement"),amount:a,created_by:q.session.user.username};const {error}=await sb.from("transactions").insert(t);if(error)throw error;r.json({transaction:t,client:await getClient(c.id)});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.post("/api/clients",admin,async(q,r)=>{try{
  const id=cid(q.body.id||"").trim(),name=String(q.body.name||"").trim();if(!id||!name)return r.status(400).json({error:"ID et nom obligatoires"});
  const {data:exists}=await sb.from("clients").select("id").eq("id",id).maybeSingle();if(exists)return r.status(400).json({error:"Cet ID existe déjà"});
  const {data:all}=await sb.from("clients").select("pin");const used=new Set((all||[]).map(c=>String(c.pin||"")));let pin;do{pin=String(Math.floor(1000+Math.random()*9000))}while(used.has(pin));
  const {data:c,error}=await sb.from("clients").insert({id,name,pin,active:true}).select().single();if(error)throw error;r.json({...await getClient(id),pin:c.pin});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.delete("/api/clients/:id",admin,async(q,r)=>{try{
  const id=cid(q.params.id);for(const table of ["transactions","pending_credits"]){const {error}=await sb.from(table).delete().eq("client_id",id);if(error)throw error}const {error}=await sb.from("clients").delete().eq("id",id);if(error)throw error;r.json({ok:true});
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});
app.put("/api/clients/:id",admin,async(q,r)=>{try{
  const id=cid(q.params.id);const patch={};if(q.body.name!==undefined)patch.name=String(q.body.name).trim();if(q.body.active!==undefined)patch.active=!!q.body.active;if(q.body.pin!==undefined){const pin=String(q.body.pin).trim();if(!/^\d{4}$/.test(pin))return r.status(400).json({error:"Le code doit contenir 4 chiffres"});patch.pin=pin}
  const {error}=await sb.from("clients").update(patch).eq("id",id);if(error)throw error;r.json(await getClient(id));
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.get("/api/history",auth,async(q,r)=>{try{
  let query=sb.from("transactions").select("*").order("created_at",{ascending:false}).limit(300);if(q.session.user?.role==="participant")query=query.eq("client_id",cid(q.session.user.clientId));const {data,error}=await query;if(error)throw error;
  const clients={};for(const t of data||[]){if(!clients[t.client_id]){const c=await getClient(t.client_id);clients[t.client_id]=c?.name||t.client_id}}r.json((data||[]).map(t=>({...t,name:clients[t.client_id]||t.client_id})));
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.get("/api/export",admin,async(q,r)=>{try{
  const out={};for(const table of ["users","clients","products","transactions","pending_credits","settings"]){const {data,error}=await sb.from(table).select("*");if(error)throw error;out[table]=data||[]}
  r.setHeader("Content-Disposition","attachment; filename=caisse-backup.json");r.json(out);
}catch(e){console.error(e);r.status(500).json({error:"Erreur serveur"})}});

app.use(express.static(require("path").join(__dirname,"public")));
app.get("/{*splat}",(q,r)=>r.sendFile(require("path").join(__dirname,"public","index.html")));

ensureSetup().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log(`Caisse Repas V7 running on port ${PORT}`))).catch(e=>{console.error("Startup error:",e);process.exit(1)});
