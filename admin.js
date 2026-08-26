const { supabaseUrl, supabasePublishableKey } = window.SJMM_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabasePublishableKey);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let adminUser = null;
let opportunities = [];
let signups = [];
let opportunityFilter = "upcoming";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function toast(message, isError = false) {
  const element = $("#adminToast");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3600);
}

function initials(name) {
  return String(name || "Admin").split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(value, options = { dateStyle: "medium", timeStyle: "short" }) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString("en-US", options);
}

function localInputValue(value) {
  const date = value ? new Date(value) : new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showLogin(message = "") {
  $("#adminApp").hidden = true;
  $("#adminLogin").hidden = false;
  $("#adminLoginStatus").textContent = message;
}

function showAdmin() {
  $("#adminLogin").hidden = true;
  $("#adminApp").hidden = false;
  const displayName = adminUser?.user_metadata?.manager_name || adminUser?.email?.split("@")[0] || "Admin";
  $("#adminInitials").textContent = initials(displayName);
}

async function verifyAdmin(user) {
  if (!user) return false;
  const { data, error } = await db.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function loadAdminData() {
  const [opportunityResult, signupResult] = await Promise.all([
    db.from("opportunities").select("*").order("starts_at", { ascending: true }),
    db.from("signups").select("id,status,created_at,opportunity_id,family_member_id,opportunities(id,title,starts_at,location),family_members(id,display_name,volunteer_id)").order("created_at", { ascending: false })
  ]);
  const failed = [opportunityResult, signupResult].find((result) => result.error);
  if (failed) throw failed.error;
  opportunities = opportunityResult.data || [];
  signups = signupResult.data || [];
  renderAll();
}

function activeSignupRows() {
  return signups.filter((signup) => signup.status !== "cancelled");
}

function signupCountFor(opportunityId) {
  return activeSignupRows().filter((signup) => signup.opportunity_id === opportunityId).length;
}

function renderAll() {
  const now = Date.now();
  const upcoming = opportunities.filter((item) => item.active && new Date(item.starts_at).getTime() >= now);
  const activeSignups = activeSignupRows();
  const uniqueVolunteers = new Set(activeSignups.map((signup) => signup.family_member_id));
  $("#upcomingCount").textContent = upcoming.length;
  $("#totalSignupCount").textContent = activeSignups.length;
  $("#volunteerCount").textContent = uniqueVolunteers.size;
  renderDashboard(upcoming);
  renderOpportunities();
  renderSignups();
}

function renderDashboard(upcoming) {
  const container = $("#dashboardOpportunities");
  if (!upcoming.length) {
    container.innerHTML = `<div class="empty"><h3>No upcoming opportunities yet</h3><p>Create your first opportunity and publish it when you are ready.</p><button class="text-button" data-open-form>Create an opportunity</button></div>`;
    bindOpenFormButtons();
    return;
  }
  container.innerHTML = upcoming.slice(0, 6).map((item) => {
    const date = new Date(item.starts_at);
    return `<article class="dashboard-row">
      <div class="date-block"><small>${date.toLocaleString("en-US", { month: "short" })}</small><b>${date.getDate()}</b></div>
      <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.location || "Location not set")} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p></div>
      <span class="count-badge">${signupCountFor(item.id)} signed up</span>
    </article>`;
  }).join("");
}

function filteredOpportunities() {
  const now = Date.now();
  const query = $("#opportunitySearch").value.trim().toLowerCase();
  return opportunities.filter((item) => {
    const matchesFilter = opportunityFilter === "all"
      || (opportunityFilter === "upcoming" && item.active && new Date(item.starts_at).getTime() >= now)
      || (opportunityFilter === "drafts" && !item.active);
    const haystack = `${item.title} ${item.category} ${item.location} ${item.description}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function renderOpportunities() {
  const container = $("#opportunityList");
  const rows = filteredOpportunities();
  if (!rows.length) {
    container.innerHTML = `<div class="empty"><h3>No matching opportunities</h3><p>Change the filter or create a new opportunity.</p><button class="primary" data-open-form>Create an opportunity</button></div>`;
    bindOpenFormButtons();
    return;
  }
  container.innerHTML = rows.map((item) => {
    const date = new Date(item.starts_at);
    const count = signupCountFor(item.id);
    const capacity = item.capacity ? `${count} of ${item.capacity}` : `${count}`;
    return `<article class="opportunity-row ${item.active ? "" : "inactive"}">
      <div class="opportunity-date"><small>${date.toLocaleString("en-US", { month: "short" })}</small><b>${date.getDate()}</b><span>${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></div>
      <div class="opportunity-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || "No description")}</p><div class="tag-row"><span class="tag">${escapeHtml(item.category)}</span>${item.family_friendly ? '<span class="tag family">Family-friendly</span>' : ""}${item.active ? "" : '<span class="tag draft">Draft / archived</span>'}</div></div>
      <div class="opportunity-meta"><b>${escapeHtml(item.location || "Location not set")}</b><p>${formatDate(item.starts_at)}</p></div>
      <div class="roster-count"><b>${capacity}</b><small>${item.capacity ? "spots filled" : "sign-ups"}</small></div>
      <div class="row-actions"><button class="icon-action edit-opportunity" data-id="${item.id}">Edit</button><button class="icon-action toggle-opportunity" data-id="${item.id}" data-active="${item.active}">${item.active ? "Archive" : "Publish"}</button></div>
    </article>`;
  }).join("");
  $$(".edit-opportunity").forEach((button) => button.onclick = () => openOpportunityForm(opportunities.find((item) => item.id === button.dataset.id)));
  $$(".toggle-opportunity").forEach((button) => button.onclick = () => toggleOpportunity(button.dataset.id, button.dataset.active === "true"));
}

function signupMatchesFilter(signup) {
  const query = $("#signupSearch").value.trim().toLowerCase();
  const statusFilter = $("#signupStatusFilter").value;
  const statusMatches = statusFilter === "all"
    || (statusFilter === "active" && signup.status !== "cancelled")
    || signup.status === statusFilter;
  const haystack = `${signup.family_members?.display_name || ""} ${signup.family_members?.volunteer_id || ""} ${signup.opportunities?.title || ""}`.toLowerCase();
  return statusMatches && (!query || haystack.includes(query));
}

function renderSignups() {
  const rows = signups.filter(signupMatchesFilter);
  const container = $("#signupRoster");
  if (!rows.length) {
    container.innerHTML = `<div class="empty"><h3>No sign-ups found</h3><p>Volunteer registrations will appear here automatically.</p></div>`;
    return;
  }
  container.innerHTML = `<table class="roster-table"><thead><tr><th>Volunteer</th><th>Volunteer ID</th><th>Opportunity</th><th>Date</th><th>Status</th><th>Signed up</th></tr></thead><tbody>${rows.map((signup) => `<tr>
    <td><b>${escapeHtml(signup.family_members?.display_name || "Unknown volunteer")}</b></td>
    <td class="volunteer-id">SJ-${escapeHtml(signup.family_members?.volunteer_id || "—")}</td>
    <td>${escapeHtml(signup.opportunities?.title || "Deleted opportunity")}</td>
    <td>${signup.opportunities?.starts_at ? formatDate(signup.opportunities.starts_at, { dateStyle: "medium" }) : "—"}</td>
    <td><span class="status-pill ${escapeHtml(signup.status)}">${escapeHtml(signup.status.replaceAll("_", " "))}</span></td>
    <td>${formatDate(signup.created_at, { dateStyle: "medium" })}</td>
  </tr>`).join("")}</tbody></table>`;
}

function setDefaultOpportunityTimes() {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  $("#opportunityStarts").value = localInputValue(start);
  $("#opportunityEnds").value = localInputValue(end);
}

function openOpportunityForm(item = null) {
  $("#opportunityForm").reset();
  $("#opportunityId").value = item?.id || "";
  $("#opportunityFormTitle").textContent = item ? "Edit opportunity" : "Create an opportunity";
  if (item) {
    $("#opportunityTitle").value = item.title;
    $("#opportunityCategory").value = item.category;
    $("#opportunityLocation").value = item.location || "";
    $("#opportunityStarts").value = localInputValue(item.starts_at);
    $("#opportunityEnds").value = item.ends_at ? localInputValue(item.ends_at) : "";
    $("#opportunityCapacity").value = item.capacity || "";
    $("#opportunityDescription").value = item.description || "";
    $("#opportunityFamilyFriendly").checked = item.family_friendly;
    $("#opportunityPublished").checked = item.active;
  } else {
    setDefaultOpportunityTimes();
    $("#opportunityPublished").checked = true;
  }
  $("#opportunityModal").hidden = false;
  $("#opportunityTitle").focus();
}

function closeOpportunityForm() {
  $("#opportunityModal").hidden = true;
}

async function saveOpportunity(event) {
  event.preventDefault();
  const startsAt = new Date($("#opportunityStarts").value);
  const endsValue = $("#opportunityEnds").value;
  const endsAt = endsValue ? new Date(endsValue) : null;
  if (endsAt && endsAt < startsAt) return toast("The ending time must be after the starting time.", true);
  const capacityValue = $("#opportunityCapacity").value;
  const payload = {
    title: $("#opportunityTitle").value.trim(),
    category: $("#opportunityCategory").value,
    location: $("#opportunityLocation").value.trim(),
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
    capacity: capacityValue ? Number(capacityValue) : null,
    description: $("#opportunityDescription").value.trim(),
    family_friendly: $("#opportunityFamilyFriendly").checked,
    active: $("#opportunityPublished").checked
  };
  const id = $("#opportunityId").value;
  const button = $("#saveOpportunity");
  button.disabled = true;
  button.textContent = "Saving…";
  const result = id
    ? await db.from("opportunities").update(payload).eq("id", id)
    : await db.from("opportunities").insert(payload);
  button.disabled = false;
  button.textContent = "Save opportunity";
  if (result.error) return toast(result.error.message, true);
  closeOpportunityForm();
  await loadAdminData();
  toast(id ? "Opportunity updated." : "Opportunity created.");
}

async function toggleOpportunity(id, currentlyActive) {
  const { error } = await db.from("opportunities").update({ active: !currentlyActive }).eq("id", id);
  if (error) return toast(error.message, true);
  await loadAdminData();
  toast(currentlyActive ? "Opportunity archived." : "Opportunity published.");
}

function navigate(pageName) {
  $$(".nav-item[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === pageName));
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `${pageName}Page`));
  $(".sidebar").classList.remove("open");
  window.scrollTo(0, 0);
}

function downloadRoster() {
  const rows = signups.filter(signupMatchesFilter);
  if (!rows.length) return toast("There are no roster rows to download.", true);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    ["Volunteer", "Volunteer ID", "Opportunity", "Opportunity date", "Location", "Status", "Signup date"],
    ...rows.map((signup) => [
      signup.family_members?.display_name,
      `SJ-${signup.family_members?.volunteer_id || ""}`,
      signup.opportunities?.title,
      signup.opportunities?.starts_at ? formatDate(signup.opportunities.starts_at) : "",
      signup.opportunities?.location,
      signup.status,
      formatDate(signup.created_at)
    ])
  ].map((row) => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `st-jude-volunteer-roster-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindOpenFormButtons() {
  $$('[data-open-form]').forEach((button) => button.onclick = () => openOpportunityForm());
}

$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#adminSignIn");
  button.disabled = true;
  $("#adminLoginStatus").textContent = "Signing in…";
  const { data, error } = await db.auth.signInWithPassword({ email: $("#adminEmail").value.trim(), password: $("#adminPassword").value });
  button.disabled = false;
  if (error) return showLogin(error.message);
  try {
    if (!(await verifyAdmin(data.user))) return showLogin("This account does not have administrator access.");
    adminUser = data.user;
    showAdmin();
    await loadAdminData();
  } catch (adminError) {
    showLogin(adminError.message);
  }
});

$("#showAdminPassword").onclick = () => {
  const input = $("#adminPassword");
  input.type = input.type === "password" ? "text" : "password";
  $("#showAdminPassword").textContent = input.type === "password" ? "Show" : "Hide";
};

$("#adminLogout").onclick = async () => {
  await db.auth.signOut();
  adminUser = null;
  opportunities = [];
  signups = [];
  showLogin();
};

$("#adminMenuToggle").onclick = () => $(".sidebar").classList.toggle("open");
$$(".nav-item[data-page]").forEach((button) => button.onclick = () => navigate(button.dataset.page));
$$("[data-page-link]").forEach((button) => button.onclick = () => navigate(button.dataset.pageLink));
$$(".filter").forEach((button) => button.onclick = () => {
  opportunityFilter = button.dataset.filter;
  $$(".filter").forEach((item) => item.classList.toggle("active", item === button));
  renderOpportunities();
});
$("#opportunitySearch").addEventListener("input", renderOpportunities);
$("#signupSearch").addEventListener("input", renderSignups);
$("#signupStatusFilter").addEventListener("change", renderSignups);
$("#closeOpportunityModal").onclick = closeOpportunityForm;
$("#cancelOpportunity").onclick = closeOpportunityForm;
$("#opportunityModal").addEventListener("click", (event) => { if (event.target === $("#opportunityModal")) closeOpportunityForm(); });
$("#opportunityForm").addEventListener("submit", saveOpportunity);
$("#downloadRoster").onclick = downloadRoster;
bindOpenFormButtons();

db.auth.getSession().then(async ({ data, error }) => {
  if (error) return showLogin(error.message);
  if (!data.session) return showLogin();
  try {
    if (!(await verifyAdmin(data.session.user))) return showLogin("You are signed in, but this account does not have administrator access.");
    adminUser = data.session.user;
    showAdmin();
    await loadAdminData();
  } catch (adminError) {
    showLogin(adminError.message);
  }
});
