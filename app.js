const { supabaseUrl, supabasePublishableKey } = window.SJMM_CONFIG;
const incomingUrl = new URL(window.location.href);
const incomingHash = new URLSearchParams(incomingUrl.hash.slice(1));
const recoveryInUrl = incomingHash.get("type") === "recovery" || incomingUrl.searchParams.get("type") === "recovery" || Boolean(incomingHash.get("error_code"));
const appBaseUrl = new URL("./", document.currentScript?.src || incomingUrl);
appBaseUrl.hash = "";
appBaseUrl.search = "";
const passwordRecoveryRedirect = appBaseUrl.href;
const db = window.supabase.createClient(supabaseUrl, supabasePublishableKey);
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];

function mountPasswordRecoveryUi(){
  if($("#passwordRecoveryModal"))return;
  document.body.insertAdjacentHTML("beforeend",`<div id="passwordRecoveryModal" class="modal" hidden>
    <div class="modal-card small recovery-card" role="dialog" aria-modal="true" aria-labelledby="passwordRecoveryTitle" aria-describedby="passwordRecoveryHelp">
      <div class="modal-brand brand"><img src="LOGOSMALL.png" alt="" /><div><strong>St. Jude</strong><span>Music Ministry</span></div></div>
      <p class="eyebrow">Account recovery</p><h2 id="passwordRecoveryTitle">Choose a new password</h2>
      <p id="passwordRecoveryHelp" class="muted">Enter a new password for your volunteer account.</p>
      <form id="passwordRecoveryForm" class="form-panel">
        <label>New password<span class="password-wrap"><input id="recoveryPassword" type="password" minlength="8" autocomplete="new-password" required disabled /><button class="show-password" type="button" data-target="recoveryPassword">Show</button></span><small>Use at least 8 characters.</small></label>
        <label>Confirm new password<span class="password-wrap"><input id="recoveryPasswordConfirm" type="password" minlength="8" autocomplete="new-password" required disabled /><button class="show-password" type="button" data-target="recoveryPasswordConfirm">Show</button></span></label>
        <button id="saveRecoveryPassword" class="primary full" type="submit" disabled>Save new password</button>
      </form>
      <p id="recoveryStatus" class="recovery-status" role="status" aria-live="polite">Verifying your reset link…</p>
      <button id="returnToLogin" class="text-button recovery-return" type="button" hidden>Return to sign in</button>
    </div>
  </div>`);
  const style=document.createElement("style");
  style.textContent=".recovery-card h2{font-size:2rem;color:var(--green);margin-bottom:8px}.recovery-card .form-panel{margin-top:24px}.recovery-status{min-height:1.3em;margin:16px 0 0;color:var(--green-2);font-size:.86rem;font-weight:600;line-height:1.45;text-align:center}.recovery-status.error{color:#9c342d}.recovery-return{display:block;margin:12px auto 0}";
  document.head.appendChild(style);
}
mountPasswordRecoveryUi();

const sampleAccount = { householdId:"demo", household:"The Kochel Family", members:[
  {id:"1",name:"Richard Kochel",role:"Adult · Account manager",volunteerId:"RichardK",initials:"RK",interests:["Music","Liturgy"]},
  {id:"2",name:"Sarah Kochel",role:"Adult",volunteerId:"SarahK",initials:"SK",interests:["Hospitality"]},
  {id:"3",name:"Marcus-Lee",role:"Child · Guardian managed",volunteerId:"MarcusLee",initials:"ML",interests:["Children’s choir"]}
], emails:[{id:"e1",value:"sample@example.com",owner:"Richard",primary:true}], phones:[{id:"p1",value:"(260) 555-0148",owner:"Richard",primary:true}], signups:[], opportunities:[] };
let account = null, demoMode = false, createStep = 1, recoveryMode = recoveryInUrl, recoveryReady = false;

function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3200)}
function initials(name){return name.split(/\s+/).filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase()}
function showApp(){$("#loginView").hidden=true;$("#accountView").hidden=false;renderAll()}
function showLogin(){$("#accountView").hidden=true;$("#loginView").hidden=false;$(".sidebar").classList.remove("open")}
function setRecoveryStatus(message,isError=false){const status=$("#recoveryStatus");status.textContent=message;status.classList.toggle("error",isError)}
function showPasswordRecovery(message="Your reset link is ready. Choose a new password.",isError=false){
  recoveryMode=true;
  $("#loginView").hidden=false;
  $("#accountView").hidden=true;
  $("#passwordRecoveryModal").hidden=false;
  setRecoveryStatus(message,isError);
  if(recoveryReady)$("#recoveryPassword").focus();
}
function setRecoveryReady(){recoveryReady=true;["#recoveryPassword","#recoveryPasswordConfirm","#saveRecoveryPassword"].forEach(selector=>$(selector).disabled=false);$("#returnToLogin").hidden=true;showPasswordRecovery()}

async function ensureHousehold(user){
  const membership=await db.from("household_users").select("household_id").eq("user_id",user.id).maybeSingle();
  if(membership.error)throw membership.error;
  if(membership.data)return membership.data.household_id;
  const meta=user.user_metadata||{};
  if(!meta.household_name||!meta.volunteer_id||!meta.manager_name||!meta.phone)throw new Error("Your account needs ministry assistance to finish its household profile.");
  const household=await db.from("households").insert({account_name:meta.household_name,created_by:user.id}).select("id").single();
  if(household.error)throw household.error;
  const member=await db.from("family_members").insert({household_id:household.data.id,display_name:meta.manager_name,member_type:"adult",volunteer_id:meta.volunteer_id,interests:["Music Ministry"]}).select("id").single();
  if(member.error)throw member.error;
  const contacts=await db.from("contact_methods").insert([
    {household_id:household.data.id,family_member_id:member.data.id,contact_type:"email",contact_value:user.email,label:"Primary",is_primary:true},
    {household_id:household.data.id,family_member_id:member.data.id,contact_type:"phone",contact_value:meta.phone,label:"Primary",is_primary:true}
  ]);
  if(contacts.error)throw contacts.error;
  return household.data.id;
}

async function loadAccount(){
  const {data:{user}}=await db.auth.getUser(); if(!user)return showLogin();
  const adminAccess=await db.from("admin_users").select("user_id").eq("user_id",user.id).maybeSingle();
  $("#adminShortcut").hidden=Boolean(adminAccess.error||!adminAccess.data);
  const householdId=await ensureHousehold(user);
  const results=await Promise.all([
    db.from("households").select("id,account_name").eq("id",householdId).single(),
    db.from("family_members").select("*").eq("household_id",householdId).eq("active",true).order("created_at"),
    db.from("contact_methods").select("*").eq("household_id",householdId).order("created_at"),
    db.from("opportunities").select("*").eq("active",true).order("starts_at"),
    db.from("signups").select("*,opportunities(*)").eq("household_id",householdId).neq("status","cancelled").order("created_at")
  ]);
  const failed=results.find(x=>x.error); if(failed)throw failed.error;
  const [household,members,contacts,opportunities,signups]=results;
  const names=Object.fromEntries(members.data.map(x=>[x.id,x.display_name]));
  account={householdId,household:household.data.account_name,
    members:members.data.map((m,i)=>({id:m.id,name:m.display_name,role:m.member_type==="child"?"Child · Guardian managed":i===0?"Adult · Account manager":"Adult",volunteerId:m.volunteer_id,initials:initials(m.display_name),interests:m.interests||[]})),
    emails:contacts.data.filter(x=>x.contact_type==="email").map(x=>({id:x.id,value:x.contact_value,owner:names[x.family_member_id]||"Household",primary:x.is_primary})),
    phones:contacts.data.filter(x=>x.contact_type==="phone").map(x=>({id:x.id,value:x.contact_value,owner:names[x.family_member_id]||"Household",primary:x.is_primary})),
    opportunities:opportunities.data,signups:signups.data.map(x=>({...x,person:names[x.family_member_id]||"Household"}))};
  demoMode=false;showApp();
}

$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;const r=await db.auth.signInWithPassword({email:$("#loginIdentity").value.trim(),password:$("#loginPassword").value});b.disabled=false;if(r.error)return toast(r.error.message);try{await loadAccount()}catch(err){toast(err.message)}});
$("#demoLogin").onclick=()=>{account=structuredClone(sampleAccount);demoMode=true;showApp()};
$("#logout").onclick=async()=>{if(!demoMode)await db.auth.signOut();account=null;showLogin()};
$$('.show-password').forEach(b=>b.onclick=()=>{const i=document.getElementById(b.dataset.target);i.type=i.type==="password"?"text":"password";b.textContent=i.type==="password"?"Show":"Hide"});

$("#passwordRecoveryForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!recoveryReady)return setRecoveryStatus("This reset link is no longer valid. Please request a new one from the sign-in page.",true);
  const password=$("#recoveryPassword").value,confirmation=$("#recoveryPasswordConfirm").value;
  if(password.length<8)return setRecoveryStatus("Your new password must contain at least 8 characters.",true);
  if(password!==confirmation)return setRecoveryStatus("The two passwords do not match. Please try again.",true);
  const button=$("#saveRecoveryPassword");button.disabled=true;setRecoveryStatus("Saving your new password…");
  const {error}=await db.auth.updateUser({password});
  if(error){button.disabled=false;return setRecoveryStatus(error.message,true)}
  await db.auth.signOut();
  recoveryMode=false;recoveryReady=false;
  $("#passwordRecoveryModal").hidden=true;
  $("#passwordRecoveryForm").reset();
  window.history.replaceState({},document.title,passwordRecoveryRedirect);
  showLogin();
  toast("Password updated. Sign in with your new password.");
});
$("#returnToLogin").onclick=()=>{recoveryMode=false;$("#passwordRecoveryModal").hidden=true;window.history.replaceState({},document.title,passwordRecoveryRedirect);showLogin()};

function updateSteps(){$$(".form-step").forEach(s=>s.classList.toggle("active",+s.dataset.step===createStep));$$('.steps span').forEach((s,i)=>s.classList.toggle("active",i<createStep));$("#backStep").hidden=createStep===1;$("#nextStep").hidden=createStep===3;$("#submitAccount").hidden=createStep!==3}
$("#openCreate").onclick=()=>{createStep=1;updateSteps();$("#createModal").hidden=false};$("#closeCreate").onclick=()=>$("#createModal").hidden=true;
$$('input[name="accountType"]').forEach(r=>r.onchange=()=>{$$(".choice").forEach(c=>c.classList.toggle("selected",c.contains(r)&&r.checked))});
$("#volunteerId").addEventListener("input",e=>{e.target.value=e.target.value.replace(/[^A-Za-z0-9_-]/g,"");$("#idStatus").textContent=e.target.value.length>=3?"Your ID will be checked when the account is created.":"Use 3–32 letters, numbers, hyphens, or underscores."});
$("#nextStep").onclick=()=>{const fields=[...$(`.form-step[data-step="${createStep}"]`).querySelectorAll("input[required]")];if(fields.some(f=>!f.reportValidity()))return;createStep++;updateSteps()};$("#backStep").onclick=()=>{createStep--;updateSteps()};
$("#createForm").addEventListener("submit",async e=>{e.preventDefault();const b=$("#submitAccount");b.disabled=true;const r=await db.auth.signUp({email:$("#primaryEmail").value.trim(),password:$("#newPassword").value,options:{data:{household_name:$("#householdName").value.trim(),manager_name:$("#accountManagerName").value.trim(),volunteer_id:$("#volunteerId").value.trim(),phone:$("#primaryPhone").value.trim()}}});b.disabled=false;if(r.error)return toast(r.error.message);$("#createModal").hidden=true;if(!r.data.session)return toast("Account started. Check your email to confirm it, then sign in here.");try{await loadAccount();toast("Your volunteer account is ready!")}catch(err){toast(err.message)}});

function renderAll(){const p=account.members[0]||{volunteerId:""};$("#topHousehold").textContent=account.household;$("#householdCardName").textContent=account.household;$("#dashboardId").textContent=`SJ-${p.volunteerId}`;$("#statFamily").textContent=account.members.length;$("#statUpcoming").textContent=account.signups.length;$("#signupCount").textContent=account.signups.length;$("#settingsHousehold").value=account.household;$("#settingsId").value=p.volunteerId;$("#memberAvatars").innerHTML=account.members.map(m=>`<span class="member-avatar" title="${m.name}">${m.initials}</span>`).join("");renderSignups();renderOpportunities();renderFamily();renderContacts()}
function signupHTML(s,full=false){const o=s.opportunities||{},d=o.starts_at?new Date(o.starts_at):new Date();return `<article class="${full?'signup-row':'commitment'}"><div class="date-block"><small>${d.toLocaleString('en-US',{month:'short'})}</small><b>${String(d.getDate()).padStart(2,'0')}</b></div><div><h3>${o.title||'Volunteer commitment'}</h3><p>${o.location||''}</p></div><span class="person-tag">${s.person}</span>${full?`<button class="secondary cancel-signup" data-id="${s.id}">Cancel</button>`:''}</article>`}
function renderSignups(){$("#upcomingList").innerHTML=account.signups.length?account.signups.slice(0,3).map(s=>signupHTML(s)).join(""):`<div class="empty"><p>No commitments yet.</p><button class="text-button" data-go="opportunities">Find an opportunity</button></div>`;$("#allSignups").innerHTML=account.signups.length?account.signups.map(s=>signupHTML(s,true)).join(""):`<p class="muted">Your household has no upcoming sign-ups.</p>`;$$('.cancel-signup').forEach(b=>b.onclick=async()=>{if(demoMode)return toast("Sample account sign-ups are read-only.");const r=await db.from("signups").update({status:"cancelled"}).eq("id",b.dataset.id);if(r.error)return toast(r.error.message);await loadAccount();toast("Signup cancelled")});bindGoButtons()}
function opportunityHTML(o){const joined=account.signups.some(s=>s.opportunity_id===o.id),d=new Date(o.starts_at);return `<article class="opportunity-card" data-category="${o.category.toLowerCase()}" data-family="${o.family_friendly}"><span class="category">${o.family_friendly?'Family-friendly':o.category}</span><h3>${o.title}</h3><p>${o.description}</p><div class="opportunity-meta"><span>◷ ${d.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</span></div><button class="${joined?'secondary':'primary'} signup-opportunity" data-id="${o.id}" ${joined?'disabled':''}>${joined?'Already signed up':'View & sign up'}</button></article>`}
function renderOpportunities(){const empty=`<p class="muted">New opportunities will appear here when the ministry publishes them.</p>`;$("#suggestionCards").innerHTML=account.opportunities.length?account.opportunities.slice(0,3).map(opportunityHTML).join(""):empty;$("#allOpportunities").innerHTML=account.opportunities.length?account.opportunities.map(opportunityHTML).join(""):empty;$$('.signup-opportunity:not([disabled])').forEach(b=>b.onclick=()=>openSignup(b.dataset.id));bindGoButtons()}
function openSignup(id){if(demoMode)return toast("Sign in to a real account to volunteer.");const o=account.opportunities.find(x=>x.id===id);$("#simpleModalContent").innerHTML=`<p class="eyebrow">Volunteer opportunity</p><h2>${o.title}</h2><p class="muted">${o.description}</p><label>Who is volunteering?<select id="signupPerson">${account.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join("")}</select></label><button id="confirmSignup" class="primary full">Confirm signup</button>`;$("#simpleModal").hidden=false;$("#confirmSignup").onclick=async()=>{const r=await db.from("signups").insert({household_id:account.householdId,family_member_id:$("#signupPerson").value,opportunity_id:id});if(r.error)return toast(r.error.message);$("#simpleModal").hidden=true;await loadAccount();toast("Volunteer signup confirmed!")}}
function renderFamily(){$("#familyList").innerHTML=account.members.map(m=>`<article class="family-card"><div class="large-initials">${m.initials}</div><h3>${m.name}</h3><p>${m.role}</p><div class="id-chip"><span>Volunteer ID</span><b>SJ-${m.volunteerId}</b></div><div class="interest-tags">${m.interests.map(i=>`<span>${i}</span>`).join("")}</div></article>`).join("")}
function contactHTML(c,t){return `<div class="contact-row"><div><b>${c.value}</b><p>${c.owner} ${c.primary?'<span class="primary-badge">Primary</span>':''}</p></div><button class="icon-button remove-contact" data-type="${t}" data-id="${c.id}" aria-label="Remove contact">•••</button></div>`}
function renderContacts(){$("#emailList").innerHTML=account.emails.map(c=>contactHTML(c,"emails")).join("");$("#phoneList").innerHTML=account.phones.map(c=>contactHTML(c,"phones")).join("");$$('.remove-contact').forEach(b=>b.onclick=()=>toast("Contact removal will require confirmation in a future update."))}
function contactModal(type){if(demoMode)return toast("Sign in to manage contacts.");const phone=type==="phones";$("#simpleModalContent").innerHTML=`<p class="eyebrow">Household contact</p><h2>Add ${phone?'phone number':'email address'}</h2>${phone?'<p class="privacy-note">Used to validate account as well as for volunteer-related communications.</p>':''}<label>${phone?'Phone number':'Email address'}<input id="newContactValue" type="${phone?'tel':'email'}" required /></label><label>Belongs to<select id="contactOwner"><option value="">Whole household</option>${account.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join("")}</select></label><button id="saveContact" class="primary full">Add contact</button>`;$("#simpleModal").hidden=false;$("#saveContact").onclick=async()=>{const value=$("#newContactValue").value.trim();if(!value)return toast("Enter the contact information first.");const r=await db.from("contact_methods").insert({household_id:account.householdId,family_member_id:$("#contactOwner").value||null,contact_type:phone?"phone":"email",contact_value:value,label:"Additional"});if(r.error)return toast(r.error.message);$("#simpleModal").hidden=true;await loadAccount();toast("Contact added")}}
$$('.add-email').forEach(b=>b.onclick=()=>contactModal("emails"));$$('.add-phone').forEach(b=>b.onclick=()=>contactModal("phones"));$("#addContact").onclick=()=>contactModal("phones");
$("#addMember").onclick=()=>{if(demoMode)return toast("Sign in to manage family members.");$("#simpleModalContent").innerHTML=`<p class="eyebrow">Household profile</p><h2>Add a family member</h2><p class="muted">Children do not need their own account, email, phone number, or password.</p><label>Full name<input id="memberName" maxlength="100" /></label><label>Profile type<select id="memberRole"><option value="adult">Adult</option><option value="child">Child · Guardian managed</option></select></label><label>Volunteer ID<div class="id-field"><span>SJ-</span><input id="memberVolunteerId" pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" /></div></label><label>Interests<input id="memberInterests" placeholder="Music, hospitality, family events" /></label><button id="saveMember" class="primary full">Add family member</button>`;$("#simpleModal").hidden=false;$("#saveMember").onclick=async()=>{const name=$("#memberName").value.trim(),vid=$("#memberVolunteerId").value.trim();if(!name||!vid)return toast("Enter a name and Volunteer ID.");const r=await db.from("family_members").insert({household_id:account.householdId,display_name:name,member_type:$("#memberRole").value,volunteer_id:vid,interests:$("#memberInterests").value.split(",").map(x=>x.trim()).filter(Boolean)});if(r.error)return toast(r.error.code==="23505"?"That Volunteer ID is already in use.":r.error.message);$("#simpleModal").hidden=true;await loadAccount();toast("Family member added")}};
$("#settingsForm").addEventListener("submit",async e=>{e.preventDefault();if(demoMode)return toast("Sample settings are read-only.");const p=account.members[0],results=await Promise.all([db.from("households").update({account_name:$("#settingsHousehold").value.trim()}).eq("id",account.householdId),db.from("family_members").update({volunteer_id:$("#settingsId").value.trim().replace(/^SJ-/i,"")}).eq("id",p.id)]),failed=results.find(x=>x.error);if(failed)return toast(failed.error.message);await loadAccount();toast("Account settings saved")});

$$('.nav-item[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page));function navigate(page){$$('.nav-item[data-page]').forEach(b=>b.classList.toggle("active",b.dataset.page===page));$$('.page').forEach(p=>p.classList.toggle("active",p.id===`${page}Page`));$(".sidebar").classList.remove("open");window.scrollTo(0,0)}
function bindGoButtons(){$$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go))}bindGoButtons();$("#menuToggle").onclick=()=>$(".sidebar").classList.toggle("open");$$('.simple-close').forEach(b=>b.onclick=()=>$("#simpleModal").hidden=true);
$$('.filter').forEach(b=>b.onclick=()=>{$$('.filter').forEach(x=>x.classList.remove("active"));b.classList.add("active");const f=b.dataset.filter;$$('#allOpportunities .opportunity-card').forEach(c=>c.style.display=f==="all"||(f==="family"&&c.dataset.family==="true")||c.dataset.category===f?"flex":"none")});
$$('[data-demo]').forEach(b=>b.onclick=async()=>{if(b.dataset.demo==="forgot"){const email=$("#loginIdentity").value.trim();if(!email)return toast("Enter your email address first.");b.disabled=true;const r=await db.auth.resetPasswordForEmail(email,{redirectTo:passwordRecoveryRedirect});b.disabled=false;return toast(r.error?r.error.message:"Password recovery instructions were sent.")}toast("Contact the St. Jude Music Ministry office for assistance.")});
db.auth.onAuthStateChange(event=>{if(event==="PASSWORD_RECOVERY")setRecoveryReady()});
if(recoveryInUrl)showPasswordRecovery("Verifying your reset link…");
db.auth.getSession().then(({data,error})=>{
  if(error)return recoveryInUrl?showPasswordRecovery(error.message,true):toast(error.message);
  if(recoveryInUrl&&data.session)return setRecoveryReady();
  if(!recoveryMode&&data.session)return loadAccount().catch(err=>toast(err.message));
  if(recoveryInUrl)setTimeout(async()=>{const {data:retry}=await db.auth.getSession();if(retry.session)return setRecoveryReady();$("#returnToLogin").hidden=false;showPasswordRecovery(incomingHash.get("error_description")?.replace(/\+/g," ")||"This reset link is invalid or has expired. Return to sign in and request a new link.",true)},800);
});
