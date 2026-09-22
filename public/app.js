const $=s=>document.querySelector(s);
let me=null,selectedClient=null,selectedProduct=null,selectedMethod="Virement",creditAmount="",revolutLink="";

async function api(url,opts={}){const r=await fetch(url,{headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||"Erreur");return d}
function euro(v){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(Number(v)||0)}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function init(){try{me=(await api("/api/me")).user}catch{}if(me)showMain();else $("#login").classList.remove("hidden")}
function showMain(){
  $("#login").classList.add("hidden");$("#main").classList.remove("hidden");
  $("#roleBadge").textContent=me.role==="admin"?"ADMIN":me.role==="operator"?"CAISSE":"PARTICIPANT";
  document.querySelectorAll(".adminOnly").forEach(x=>x.classList.toggle("hidden",me.role!=="admin"));
  document.querySelectorAll(".tab").forEach(x=>{if(me.role==="participant"&&["history","credits"].includes(x.dataset.page))x.classList.add("hidden")});
  if(me.role==="participant"){
    $("#heroEyebrow").textContent="MON ESPACE";
    $("#heroTitle").textContent="Bonjour 👋";
    $("#heroText").textContent="Voici votre carte repas.";
    $("#search").closest(".search-box").classList.add("hidden");
    $("#stats").classList.add("hidden");
    loadParticipant();
  } else {
    loadDashboard();loadClients();loadHistory();loadCredits();if(me.role==="admin")loadAdmin();
  }
}
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();$("#loginError").textContent="";try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({username:$("#username").value,password:$("#password").value})});me=d.user;showMain()}catch(x){$("#loginError").textContent=x.message}});
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
  $("#page-"+b.dataset.page).classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"});
});
$("#search").addEventListener("input",()=>loadClients($("#search").value));
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();$("#search").focus()}});

async function loadClients(q=""){
  const rows=await api("/api/clients?"+new URLSearchParams({q}));
  $("#resultsLabel").textContent=`${rows.length} personne${rows.length>1?"s":""}`;
  $("#clients").innerHTML=rows.length?rows.map(c=>{
    const cls=c.balance<=0?"empty":c.balance<10?"low":"ok",label=c.balance<=0?"ÉPUISÉ":c.balance<10?"FAIBLE":"OK";
    return `<article class="client"><div><h3>${esc(c.name)}</h3><small>ID ${esc(c.id)}</small><br><button class="open-btn" onclick="openClient('${esc(c.id)}')">Ouvrir la fiche →</button></div><div><div class="balance ${cls}">${euro(c.balance)}</div><div class="status ${cls}"><i class="status-dot"></i>${label}</div></div></article>`
  }).join(""):`<div class="empty">Aucune personne trouvée.</div>`;
}
async function loadParticipant(){
  const rows=await api("/api/clients");
  if(!rows.length)return;
  const c=rows[0];
  $("#participantCard").classList.remove("hidden");
  $("#participantCard").innerHTML=`<small>MA CARTE · ID ${esc(c.id)}</small><h2>${esc(c.name)}</h2><div class="participant-balance">${euro(c.balance)}</div><p>Solde disponible</p><div class="participant-actions"><button class="primary" onclick="openClient('${esc(c.id)}')">💰 Gérer ma carte</button></div>`;
  $("#clients").innerHTML="";
}
async function loadDashboard(){
  const d=await api("/api/dashboard");
  $("#stats").innerHTML=`<div class="stat"><span>Solde total cartes</span><b>${euro(d.total)}</b></div><div class="stat"><span>Net aujourd'hui</span><b>${euro(d.todayNet)}</b></div><div class="stat"><span>Crédits</span><b>${euro(d.credits)}</b></div><div class="stat"><span>Personnes</span><b>${d.clients}</b></div>`;
}
async function openClient(id){
  selectedClient=await api("/api/clients/"+id);selectedProduct=null;creditAmount="";selectedMethod="Virement";renderModal();
}
function renderModal(){
  const c=selectedClient;
  const products=window.products||[];
  const participant=me?.role==="participant";
  const staffControls=participant?"":`
    <div class="ops">${products.map(p=>`<button class="op" onclick="selectProduct('${esc(p.id)}')">${esc(p.icon||"🛒")}<br>${esc(p.name)}<small>-${euro(p.price)}</small></button>`).join("")}</div>
    <div class="credit-box"><h3>💰 Ajouter du crédit</h3><div class="credit-form"><input id="creditInput" type="number" min="0.01" step="0.01" placeholder="Montant en €" value="${esc(creditAmount)}" oninput="creditAmount=this.value"><button class="primary" onclick="creditClient()">Créditer manuellement</button></div><button class="revolut-btn" onclick="requestRevolutCredit()">🔴 Demander un crédit avec Revolut</button></div>
    <div class="method"><button class="${selectedMethod==="Virement"?"selected":""}" onclick="selectMethod('Virement')">Virement</button><button class="${selectedMethod==="Espèces"?"selected":""}" onclick="selectMethod('Espèces')">Espèces</button><button class="${selectedMethod==="Carte"?"selected":""}" onclick="selectMethod('Carte')">Carte</button></div>
    <button class="primary confirm" ${selectedProduct?"":"disabled"} onclick="confirmConsumption()">VALIDER ${selectedProduct?esc(selectedProduct.name):"une consommation"}</button>`;
  const participantControls=participant?`
    <div class="credit-box"><h3>💰 Ajouter du crédit</h3><div class="credit-form"><input id="creditInput" type="number" min="0.01" step="0.01" placeholder="Montant en €" value="${esc(creditAmount)}" oninput="creditAmount=this.value"></div><button class="revolut-btn" onclick="requestRevolutCredit()">🔴 Demander un crédit avec Revolut</button></div>`:"";
  $("#modalContent").innerHTML=`
    <div class="person-head"><small>ID ${esc(c.id)}</small><h2>${esc(c.name)}</h2><div class="person-balance">${euro(c.balance)}</div><div>Solde actuel</div></div>
    ${participant?participantControls:staffControls}
    <div style="margin-top:20px"><h3>Dernières opérations</h3>${c.history.slice(0,8).map(t=>`<div class="tx"><div><b>${esc(t.operation)}</b><br><small>${new Date(t.created_at).toLocaleString("fr-FR")} · ${esc(t.method)}</small></div><b class="${t.amount>=0?"plus":"minus"}">${t.amount>=0?"+":""}${euro(t.amount)}</b></div>`).join("")||"<small>Aucune opération</small>"}</div>`;
  $("#modal").classList.remove("hidden");
}
async function refreshModal(){selectedClient=await api("/api/clients/"+selectedClient.id);renderModal()}
async function loadProducts(){window.products=await api("/api/products")}
function selectProduct(id){selectedProduct=(window.products||[]).find(p=>String(p.id)===String(id))||null;renderModal()}
function selectMethod(m){selectedMethod=m;renderModal()}
async function confirmConsumption(){
  if(!selectedProduct)return;
  try{await api("/api/transactions",{method:"POST",body:JSON.stringify({clientId:selectedClient.id,productId:selectedProduct.id,method:selectedMethod})});selectedProduct=null;await loadProducts();await refreshModal();await loadDashboard();await loadClients($("#search").value);await loadHistory()}
  catch(e){alert(e.message)}
}
async function requestRevolutCredit(){
  const amount=Number(creditAmount);
  if(!Number.isFinite(amount)||amount<=0)return alert("Entre un montant supérieur à 0 €.");
  const s=await api("/api/settings");
  if(!s.revolut_link)return alert("Le lien Revolut n'est pas encore configuré dans Administration.");
  try{
    await api("/api/pending-credits",{method:"POST",body:JSON.stringify({clientId:selectedClient.id,amount})});
    window.open(s.revolut_link,"_blank");
    alert("Demande enregistrée. Après ton paiement Revolut, la validation sera faite par la caisse.");
    creditAmount="";await loadCredits();
  }catch(e){alert(e.message)}
}
async function creditClient(){
  const amount=Number(creditAmount);
  if(!Number.isFinite(amount)||amount<=0)return alert("Entre un montant supérieur à 0 €.");
  try{await api("/api/credit",{method:"POST",body:JSON.stringify({clientId:selectedClient.id,amount,method:selectedMethod})});creditAmount="";await refreshModal();await loadDashboard();await loadClients($("#search").value);await loadHistory()}
  catch(e){alert(e.message)}
}
$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
$("#modal").onclick=e=>{if(e.target.id==="modal")$("#modal").classList.add("hidden")};

async function loadHistory(){
  const rows=await api("/api/history");
  $("#history").innerHTML=rows.map(t=>`<div class="tx"><div><b>${esc(t.name)}</b> · ${esc(t.operation)}<br><small>ID ${esc(t.client_id)} · ${new Date(t.created_at).toLocaleString("fr-FR")} · ${esc(t.method)} · ${esc(t.created_by)}</small></div><b class="${t.amount>=0?"plus":"minus"}">${t.amount>=0?"+":""}${euro(t.amount)}</b></div>`).join("")||"<p>Aucune opération.</p>";
}
$("#refreshHistory").onclick=loadHistory;

async function loadCredits(){
  try{
    const rows=await api("/api/pending-credits");
    const pending=rows.filter(x=>x.status==="pending");
    $("#pendingCredits").innerHTML=pending.map(p=>`<div class="tx pending"><div><b>${esc(p.client_id)}</b> demande <b>${euro(p.amount)}</b><br><small>${new Date(p.created_at).toLocaleString("fr-FR")}</small></div>${["admin","operator"].includes(me?.role)?`<span><button class="soft-btn" onclick="validateCredit('${esc(p.id)}')">✓ Valider</button> <button class="soft-btn" onclick="rejectCredit('${esc(p.id)}')">✕ Refuser</button></span>`:"<small>En attente de vérification</small>"}</div>`).join("")||"<p>Aucune demande en attente.</p>";
  }catch(e){}
}
window.validateCredit=async id=>{try{await api("/api/pending-credits/"+id+"/validate",{method:"POST"});await loadCredits();await loadDashboard();await loadClients($("#search").value);await loadHistory();alert("Crédit ajouté.");}catch(e){alert(e.message)}};
window.rejectCredit=async id=>{if(!confirm("Refuser cette demande ?"))return;try{await api("/api/pending-credits/"+id+"/reject",{method:"POST"});await loadCredits()}catch(e){alert(e.message)}};
$("#refreshCredits").onclick=loadCredits;

async function loadAdmin(){
  await loadProducts();
  const st=await api("/api/settings"); $("#revolutLink").value=st.revolut_link||"";
  $("#adminProducts").innerHTML=window.products.map(p=>`<div class="admin-row product-row"><span><b>${esc(p.icon||"🛒")} ${esc(p.name)}</b><small>ID ${esc(p.id)}</small></span><span><input class="mini-input" id="price-${esc(p.id)}" type="number" min="0.01" step="0.01" value="${Number(p.price).toFixed(2)}"><button class="soft-btn" onclick="saveProduct('${esc(p.id)}')">Enregistrer</button></span></div>`).join("");
  const rows=await api("/api/clients");
  $("#adminClients").innerHTML=rows.map(c=>`<div class="admin-row"><span><b>${esc(c.id)}</b> · ${esc(c.name)}<small>Code participant : <strong>${esc(c.pin||"—")}</strong></small></span><span>${euro(c.balance)} <button class="soft-btn" onclick="changePin('${esc(c.id)}')">Code</button> <button class="danger-btn" onclick="deleteClient('${esc(c.id)}')">Supprimer</button></span></div>`).join("")||"<small>Aucune personne.</small>";
}
window.saveProduct=async id=>{
  const price=Number(document.querySelector("#price-"+CSS.escape(id)).value);
  try{await api("/api/products/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({price})});await loadAdmin();await loadProducts();alert("Tarif enregistré.");}
  catch(e){alert(e.message)}
};
$("#addClientForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{await api("/api/clients",{method:"POST",body:JSON.stringify({id:f.get("id"),name:f.get("name")})});e.target.reset();await loadClients($("#search").value);await loadAdmin();await loadDashboard();alert("Personne ajoutée.");}
  catch(x){alert(x.message)}
});
$("#addProductForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{await api("/api/products",{method:"POST",body:JSON.stringify({id:f.get("id"),name:f.get("name"),price:f.get("price"),icon:f.get("icon")})});e.target.reset();await loadAdmin();await loadProducts();alert("Produit ajouté.");}
  catch(x){alert(x.message)}
});
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
loadProducts().catch(()=>{});
init();

$("#saveRevolut").onclick=async()=>{try{await api("/api/settings",{method:"PUT",body:JSON.stringify({revolut_link:$("#revolutLink").value})});alert("Lien Revolut enregistré.");}catch(e){alert(e.message)}};

window.deleteClient=async id=>{
  if(!confirm("Supprimer cette personne et toutes ses opérations de test ?"))return;
  try{await api("/api/clients/"+encodeURIComponent(id),{method:"DELETE"});await loadAdmin();await loadClients($("#search").value);await loadDashboard();await loadHistory();await loadCredits();alert("Personne supprimée.");}
  catch(e){alert(e.message)}
};

window.changePin=async id=>{const pin=prompt("Nouveau code à 4 chiffres pour cette personne :");if(pin===null)return;if(!/^\d{4}$/.test(pin))return alert("Le code doit contenir exactement 4 chiffres.");try{await api("/api/clients/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({pin})});await loadAdmin();alert("Code modifié.");}catch(e){alert(e.message)}};
