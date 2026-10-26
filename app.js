import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

/* ================= ÉTAT ================= */
let currentUser = null;
let unsubscribe = null;      // écouteur temps réel Firestore
let resources = [];
let editingId = null;
let mode = "login";          // "login" | "register"
const filters = { category: "", fav: false };

/* ================= UTILITAIRES ================= */
const AUTH_ERRORS = {
  "auth/email-already-in-use": "Cet email est déjà utilisé.",
  "auth/invalid-email": "Adresse email invalide.",
  "auth/weak-password": "Mot de passe trop faible (6 caractères minimum).",
  "auth/missing-password": "Veuillez saisir un mot de passe.",
  "auth/invalid-credential": "Email ou mot de passe incorrect.",
  "auth/user-not-found": "Aucun compte avec cet email.",
  "auth/wrong-password": "Mot de passe incorrect.",
  "auth/too-many-requests": "Trop de tentatives. Réessayez plus tard.",
  "auth/network-request-failed": "Erreur réseau. Vérifiez votre connexion."
};
const authMsg = (e) => AUTH_ERRORS[e.code] || "Une erreur est survenue. Réessayez.";

// n'accepte que http(s) : bloque javascript:
function isValidUrl(v) {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

// Garde : toute action réservée vérifie la session (en plus des règles Firestore)
function requireUser() {
  if (!currentUser) throw new Error("Connexion requise.");
  return currentUser;
}
const resCol = () => collection(db, "users", requireUser().uid, "resources");
const resDoc = (id) => doc(db, "users", requireUser().uid, "resources", id);

/* ================= AUTHENTIFICATION ================= */
function setMode(m) {
  mode = m;
  const reg = m === "register";
  $("authTitle").textContent = reg ? "Créer un compte" : "Connexion";
  $("authBtn").textContent = reg ? "Créer mon compte" : "Se connecter";
  $("swText").textContent = reg ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("swLink").textContent = reg ? "Se connecter" : "Créer un compte";
  $("password").autocomplete = reg ? "new-password" : "current-password";
  $("authError").textContent = "";
}
$("swLink").onclick = (e) => { e.preventDefault(); setMode(mode === "login" ? "register" : "login"); };

$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) { $("authError").textContent = "Email et mot de passe obligatoires."; return; }
  $("authBtn").disabled = true;
  $("authError").textContent = "";
  try {
    if (mode === "register") await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
    $("authForm").reset();
  } catch (err) {
    $("authError").textContent = authMsg(err);
  } finally {
    $("authBtn").disabled = false;
  }
};

$("logout").onclick = () => signOut(auth);

// Point d'entrée : réagit à chaque changement de session
onAuthStateChanged(auth, (user) => {
  stopListening();                       // toujours couper l'ancien écouteur
  currentUser = user;
  resources = [];
  resetForm();
  if (user) {
    $("userEmail").textContent = user.email;
    $("userBtn").textContent = (user.email[0] || "?").toUpperCase();
    $("status").hidden = true;
    $("userBox").hidden = false;
    $("logout").hidden = false;
    $("seg").hidden = false;
    $("authView").hidden = true;
    $("appView").hidden = false;
    startListening(user.uid);
  } else {
    $("status").textContent = "Non connecté";
    $("status").hidden = false;
    $("userBox").hidden = true;
    $("userMenu").hidden = true;
    $("logout").hidden = true;
    $("seg").hidden = true;
    $("authView").hidden = false;
    $("appView").hidden = true;
    $("list").replaceChildren();
  }
});

/* ================= TEMPS RÉEL ================= */
function startListening(uid) {
  setState("Chargement des ressources…");
  unsubscribe = onSnapshot(
    collection(db, "users", uid, "resources"),
    (snap) => {
      resources = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      resources.sort((a, b) => (b.createdAt?.seconds ?? Infinity) - (a.createdAt?.seconds ?? Infinity));
      render();
    },
    (err) => {
      console.error(err);
      setState(
        err.code === "permission-denied"
          ? "Accès refusé par les règles de sécurité."
          : "Erreur de connexion à la base de données. Vérifiez votre réseau.",
        true
      );
    }
  );
}
function stopListening() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

window.addEventListener("offline", () => ($("offline").hidden = false));
window.addEventListener("online", () => ($("offline").hidden = true));

/* ================= RENDU ================= */
function setState(msg, isError = false) {
  $("state").textContent = msg;
  $("state").className = "state" + (isError ? " error" : "");
  $("list").replaceChildren();
}

function refreshCategoryFilter() {
  const cats = [...new Set(resources.map((r) => r.category))].sort();
  const sel = $("fCat");
  sel.replaceChildren(new Option("Toutes les catégories", ""));
  cats.forEach((c) => sel.append(new Option(c, c)));
  sel.value = cats.includes(filters.category) ? filters.category : "";
  filters.category = sel.value;
}

function visible() {
  return resources.filter(
    (r) => (!filters.category || r.category === filters.category) && (!filters.fav || r.favorite)
  );
}

function setNav() {
  $("navFav").classList.toggle("on", filters.fav);
  $("navHome").classList.toggle("on", !filters.fav);
}
const favicon = (url) => {
  try { return "https://www.google.com/s2/favicons?sz=128&domain=" + new URL(url).hostname; }
  catch { return ""; }
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;   // textContent : pas d'injection HTML
  return e;
}

const CURRENCIES = { XOF: "FCFA", EUR: "€", USD: "$", GBP: "£", MAD: "MAD" };
const DEFAULT_CURRENCY = "XOF";   // FCFA par défaut
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
const priceLabel = (p, c) =>
  p > 0 ? p.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " " + (CURRENCIES[c] || CURRENCIES[DEFAULT_CURRENCY]) : "Gratuit";

function card(r) {
  const href = isValidUrl(r.url) ? r.url : "#";
  const li = el("li", "rcard");

  // Vignette cliquable (ouvre le lien)
  const thumb = el("div", "thumb");
  const tl = el("a", "tl"); tl.href = href; tl.target = "_blank"; tl.rel = "noopener noreferrer"; tl.title = "Ouvrir le lien";
  const img = el("img"); img.alt = ""; img.src = favicon(r.url); img.onerror = () => img.remove();
  tl.append(el("span", "letter", (r.title[0] || "?").toUpperCase()), img);

  // Boutons visibles seulement au survol de la carte
  const acts = el("div", "acts");
  const edit = el("button", "ib edit"); edit.type = "button"; edit.title = "Modifier"; edit.setAttribute("aria-label", "Modifier");
  edit.innerHTML = ICON_EDIT; edit.onclick = () => startEdit(r);
  const del = el("button", "ib del"); del.type = "button"; del.title = "Supprimer"; del.setAttribute("aria-label", "Supprimer");
  del.innerHTML = ICON_DEL; del.onclick = () => remove(r);
  acts.append(edit, del);
  thumb.append(tl, acts);

  // Titre (lien)
  const name = el("a", "pill name"); name.href = href; name.target = "_blank"; name.rel = "noopener noreferrer";
  name.title = r.description || r.title;
  name.append(el("span", "clamp", r.title));

  // Catégorie / prix / favori
  const heart = el("button", "hbtn" + (r.favorite ? " on" : ""), "♥");
  heart.type = "button";
  heart.title = r.favorite ? "Retirer des favoris" : "Ajouter aux favoris";
  heart.onclick = () => toggleFav(r);
  const row = el("div", "row2");
  row.append(el("span", "pill cat", r.category), el("span", "pill price", priceLabel(Number(r.price) || 0, r.currency)), heart);

  li.append(thumb, name, row);
  return li;
}

function render() {
  setNav();
  refreshCategoryFilter();
  const rows = visible();
  if (!rows.length) {
    setState(
      !resources.length ? "Aucune ressource pour le moment. Cliquez sur « Ajouter une ressource »."
      : filters.fav ? "Vous n'avez pas encore de favoris."
      : "Aucune ressource ne correspond au filtre."
    );
    return;
  }
  $("state").textContent = "";
  $("list").replaceChildren(...rows.map(card));
}

/* ================= CRUD ================= */
function resetForm() {
  editingId = null;
  $("resForm").reset();
  $("formTitle").textContent = "Ajouter une ressource";
  $("saveBtn").textContent = "Ajouter";
  if ($("dlg").open) $("dlg").close();
  if ($("delDlg").open) $("delDlg").close();
  $("formError").textContent = "";
}

$("resForm").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("title").value.trim();
  const url = $("url").value.trim();
  if (!title) { $("formError").textContent = "Le titre est obligatoire."; return; }
  if (!isValidUrl(url)) { $("formError").textContent = "URL invalide (http:// ou https://)."; return; }
  const rawPrice = $("price").value.trim();
  const priceVal = rawPrice === "" ? 0 : Number(rawPrice);
  if (!Number.isFinite(priceVal) || priceVal < 0) { $("formError").textContent = "Prix invalide (0 ou plus)."; return; }

  const data = {
    title, url,
    category: $("category").value,
    description: $("description").value.trim(),
    price: priceVal,
    currency: $("currency").value
  };
  $("saveBtn").disabled = true;
  try {
    const user = requireUser();
    if (editingId) {
      const old = resources.find((r) => r.id === editingId);
      await updateDoc(resDoc(editingId), { ...data, favorite: old ? !!old.favorite : false, userId: user.uid });
    } else {
      await addDoc(resCol(), { ...data, favorite: false, userId: user.uid, createdAt: serverTimestamp() });
    }
    resetForm();
  } catch (err) {
    console.error(err);
    $("formError").textContent = "Enregistrement impossible : " + (err.code === "permission-denied" ? "accès refusé." : "vérifiez votre connexion.");
  } finally {
    $("saveBtn").disabled = false;
  }
};

function startEdit(r) {
  editingId = r.id;
  $("title").value = r.title;
  $("url").value = r.url;
  $("category").value = r.category;
  $("description").value = r.description || "";
  $("price").value = r.price > 0 ? r.price : "";
  $("currency").value = CURRENCIES[r.currency] ? r.currency : DEFAULT_CURRENCY;
  $("formTitle").textContent = "Modifier la ressource";
  $("saveBtn").textContent = "Enregistrer";
  $("cancelEdit").hidden = false;
  $("dlg").showModal();
  $("title").focus();
}
$("cancelEdit").onclick = resetForm;

async function toggleFav(r) {
  try { await updateDoc(resDoc(r.id), { favorite: !r.favorite }); }
  catch (err) { console.error(err); setState("Impossible de modifier le favori.", true); }
}

let toDelete = null;

function remove(r) {
  toDelete = r;
  $("delName").textContent = r.title;
  $("delError").textContent = "";
  $("delDlg").showModal();
}
$("delCancel").onclick = () => { toDelete = null; $("delDlg").close(); };
$("delOk").onclick = async () => {
  if (!toDelete) return;
  $("delOk").disabled = true;
  try {
    await deleteDoc(resDoc(toDelete.id));
    if (editingId === toDelete.id) resetForm();
    toDelete = null;
    $("delDlg").close();
  } catch (err) {
    console.error(err);
    $("delError").textContent = "Suppression impossible. Vérifiez votre connexion.";
  } finally {
    $("delOk").disabled = false;
  }
};

/* ================= FILTRES ================= */
$("fCat").onchange = (e) => { filters.category = e.target.value; render(); };
$("navFav").onclick = () => { filters.fav = true; render(); };
$("navHome").onclick = () => { filters.fav = false; render(); };
$("openAdd").onclick = () => { resetForm(); $("dlg").showModal(); };

/* ================= MENU UTILISATEUR ================= */
$("userBtn").onclick = (e) => { e.stopPropagation(); $("userMenu").hidden = !$("userMenu").hidden; };
document.addEventListener("click", (e) => { if (!$("userBox").contains(e.target)) $("userMenu").hidden = true; });