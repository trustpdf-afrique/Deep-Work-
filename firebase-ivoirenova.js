/* IVOIRENOVA — couche Firebase complète (SDK COMPAT 10.12.5).
 * Les écrans synchrones existants gardent leur cache local ; Firebase devient la source
 * partagée après la migration initiale. Les données privées restent isolées par UID.
 */
(function () {
  'use strict';
  const config = window.IVOIRENOVA_FIREBASE_CONFIG;
  if (!config || !window.firebase) { console.error('IVOIRENOVA : SDK/configuration Firebase introuvable.'); return; }
  try { if (!firebase.apps.length) firebase.initializeApp(config); }
  catch (e) { console.error('IVOIRENOVA : initialisation Firebase impossible', e); return; }

  const auth = firebase.auth(), db = firebase.firestore(), storage = firebase.storage();
  const ADMIN_EMAIL = 'ztv5525@gmail.com';
  const SERVER_TIME = () => firebase.firestore.FieldValue.serverTimestamp();
  const META_REF = db.collection('appMeta').doc('sync');
  const publicMap = {
    ivoirenova_matieres: 'matieres', ivoirenova_cours: 'courses',
    ivoirenova_ads: 'ads', ivoirenova_informations: 'informations',
    ivoirenova_classes: 'classes', ivoirenova_reviews: 'reviews'
  };
  const listeners = [], pending = new Map(), latestSnapshots = new Map();
  let syncStartedFor = '', syncingRemote = false, cloudInitialized = false;
  const isAdmin = user => !!user && String(user.email || '').toLowerCase() === ADMIN_EMAIL;
  const safeId = value => String(value || '').replace(/[\\/#?\[\]]/g, '_').slice(0, 140) || ('item_' + Date.now());
  const localSet = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Cache local indisponible', e); } };
  const localGet = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const currentKey = uid => 'ivoirenova_student_chats_' + uid;
  const safeUserRecord = user => { const copy = { ...(user || {}) }; ['password','motDePasse','motdepasse','passwordHash','hashedPassword','passHash','secret'].forEach(k => delete copy[k]); return copy; };

  function refreshForKey(key) {
    try {
      if (key === 'ivoirenova_matieres' || key === 'ivoirenova_cours' || key === 'ivoirenova_classes') {
        if (typeof appState !== 'undefined') {
          if (key === 'ivoirenova_matieres') appState.matieres = localGet(key) || [];
          if (key === 'ivoirenova_cours') appState.coursPdf = localGet(key) || [];
        }
        if (typeof populateStudentSubjects === 'function') populateStudentSubjects();
        if (key === 'ivoirenova_classes' && typeof syncClassOptions === 'function') syncClassOptions();
      }
      if (key === 'ivoirenova_ads' && typeof renderStudentAds === 'function') renderStudentAds();
      if ((key === 'ivoirenova_ads' || key === 'ivoirenova_informations') && typeof updateNotificationBadge === 'function') updateNotificationBadge();
      if (key === 'ivoirenova_subscriptions' && typeof appState !== 'undefined' && appState.currentUser) {
        const area = document.getElementById('moduleContentArea');
        if (area && area.dataset.module === 'abonnements' && typeof renderSubscriptionsModule === 'function') renderSubscriptionsModule(area);
        if (typeof refreshIvoAccountBlock === 'function') refreshIvoAccountBlock();
      }
      if (key === 'ivoirenova_users' && typeof updateDashboardStats === 'function') updateDashboardStats();
      const area = document.getElementById('moduleContentArea');
      if (area && typeof window.ivoFirebase?.isAdmin === 'function' && window.ivoFirebase.isAdmin()) {
        const renderers = { ivoirenova_matieres: 'renderMatieresModule', ivoirenova_cours: 'renderCoursesModule', ivoirenova_ads: 'renderAdsModule', ivoirenova_informations: 'renderInformationsModule', ivoirenova_classes: 'renderClassesModule', ivoirenova_subscriptions: 'renderSubscriptionsModule', ivoirenova_reviews: 'renderReviewsModule', ivoirenova_users: 'renderUsersModule' };
        const fn = window[renderers[key]];
        const expected = { ivoirenova_matieres: 'matieres', ivoirenova_cours: 'cours-pdf', ivoirenova_ads: 'publicites', ivoirenova_informations: 'informations', ivoirenova_classes: 'classes', ivoirenova_subscriptions: 'abonnements', ivoirenova_reviews: 'avis', ivoirenova_users: 'utilisateurs' };
        if (fn && area.dataset.module === expected[key]) fn(area);
      }
      if (typeof window.refreshStudentAdminData === 'function') window.refreshStudentAdminData();
    } catch (e) { console.warn('Rafraîchissement UI impossible', e); }
  }

  async function writeRows(collection, rows, { deleteMissing = true } = {}) {
    const normalized = Array.isArray(rows) ? rows : [];
    const desired = new Map(normalized.filter(x => x && x.id != null).map(x => [safeId(x.id), x]));
    const snap = deleteMissing ? await db.collection(collection).get() : { docs: [] };
    let batch = db.batch(), ops = 0;
    for (const doc of snap.docs) {
      if (!desired.has(doc.id)) { batch.delete(doc.ref); ops++; }
      if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    for (const [id, row] of desired) {
      batch.set(db.collection(collection).doc(id), { ...row, id, updatedAt: SERVER_TIME() }, { merge: true });
      ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops) await batch.commit();
  }

  async function syncStudentSubscriptions(rows, user) {
    const ownEmail = String(user.email || '').toLowerCase();
    const own = (Array.isArray(rows) ? rows : []).filter(x => String(x.email || '').toLowerCase() === ownEmail);
    for (const row of own) {
      const id = safeId(row.id);
      const ref = db.collection('subscriptions').doc(id);
      // On n’effectue pas de lecture préalable : un document inexistant est protégé
      // par les règles Firestore. La règle n’autorise à l’élève que le statut pending.
      if (row.status !== 'pending') continue;
      const data = { ...row, id, ownerUid: user.uid, email: user.email, status: 'pending', updatedAt: SERVER_TIME() };
      await ref.set(data, { merge: true });
    }
  }

  async function syncStore(key, value) {
    const user = auth.currentUser;
    if (!user || syncingRemote) return;
    if (publicMap[key]) {
      const collection = publicMap[key];
      if (collection === 'reviews' && !isAdmin(user)) {
        for (const row of (Array.isArray(value) ? value : [])) {
          const id = user.uid + '_' + safeId(row.id);
          const ref = db.collection('reviews').doc(id);
          await ref.set({ ...row, id, ownerUid: user.uid, updatedAt: SERVER_TIME() }, { merge: true });
        }
        return;
      }
      if (!isAdmin(user)) return; // Un eleve ne publie pas les donnees partagees.
      await writeRows(collection, value);
      return;
    }
    if (key === 'ivoirenova_subscriptions') {
      if (isAdmin(user)) {
        const usersSnap = await db.collection('users').get();
        const uidByEmail = new Map(usersSnap.docs.map(d => [String(d.data().email || '').toLowerCase(), d.id]));
        const rows = (Array.isArray(value) ? value : []).map(row => ({ ...row, ownerUid: uidByEmail.get(String(row.email || '').toLowerCase()) || row.ownerUid || '' }));
        await writeRows('subscriptions', rows);
      } else await syncStudentSubscriptions(value, user);
      return;
    }
    if (key === 'ivoirenova_settings' || key === 'ivoirenova_ia_settings') {
      if (!isAdmin(user)) return;
      const id = key === 'ivoirenova_settings' ? 'app' : 'ia';
      await db.collection('settings').doc(id).set({ value, updatedAt: SERVER_TIME() }, { merge: true });
      return;
    }
    if (key === 'ivoirenova_users') {
      if (!isAdmin(user)) return;
      const rows = Array.isArray(value) ? value : [];
      for (let i = 0; i < rows.length; i += 400) {
        const batch = db.batch();
        rows.slice(i, i + 400).filter(u => u && (u.uid || u.id)).forEach(u => {
          const id = String(u.uid || u.id);
          batch.set(db.collection('users').doc(id), { ...safeUserRecord(u), uid: id, updatedAt: SERVER_TIME() }, { merge: true });
        });
        await batch.commit();
      }
      return;
    }
    const chatPrefix = 'ivoirenova_student_chats_';
    if (key.startsWith(chatPrefix)) {
      const uid = key.slice(chatPrefix.length);
      if (uid !== user.uid) return;
      await writePrivateRows(user.uid, 'conversations', value);
      return;
    }
    const readPrefix = 'ivoirenova_notifications_read_';
    if (key === 'ivoirenova_notifications_read' || key.startsWith(readPrefix)) {
      const scopedUid = key === 'ivoirenova_notifications_read' ? user.uid : key.slice(readPrefix.length);
      if (scopedUid !== user.uid) return;
      await db.collection('users').doc(user.uid).collection('preferences').doc('notifications')
        .set({ read: Array.isArray(value) ? value : [], updatedAt: SERVER_TIME() }, { merge: true });
    }
  }

  function queueStoreSync(key, value) {
    if (!auth.currentUser || syncingRemote) return;
    clearTimeout(pending.get(key));
    // Une courte temporisation regroupe les changements rapides de l'administration.
    // En cas de coupure réseau passagère, on réessaie sans modifier les écrans existants.
    const timer = setTimeout(async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await syncStore(key, value);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const transient = !navigator.onLine || /network|unavailable|deadline-exceeded|resource-exhausted/i.test(String(err.code || '') + ' ' + String(err.message || ''));
          if (!transient || attempt === 3) break;
          await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
        }
      }
      pending.delete(key);
      if (lastError) {
        console.error('Échec de synchronisation IVOIRENOVA (' + key + ')', lastError);
        emit('ivoirenova:sync-error', { key, message: lastError.message || 'Erreur Firebase' });
      }
    }, 300);
    pending.set(key, timer);
  }

  async function writePrivateRows(uid, collection, rows) {
    const ref = db.collection('users').doc(uid).collection(collection);
    const normalized = Array.isArray(rows) ? rows : [];
    const desired = new Map(normalized.filter(x => x && x.id != null).map(x => [safeId(x.id), x]));
    const snap = await ref.get(); let batch = db.batch(), ops = 0;
    for (const d of snap.docs) if (!desired.has(d.id)) { batch.delete(d.ref); ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; } }
    for (const [id, row] of desired) { batch.set(ref.doc(id), { ...row, updatedAt: SERVER_TIME() }, { merge: true }); ops++; if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; } }
    if (ops) await batch.commit();
  }

  function applySnapshot(collection, localKey, snapshot) {
    const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    latestSnapshots.set(localKey, rows);
    if (rows.length || cloudInitialized || localGet(localKey) == null) {
      syncingRemote = true; localSet(localKey, rows); syncingRemote = false;
      refreshForKey(localKey);
    }
    emit('ivoirenova:data-updated', { collection, key: localKey, count: rows.length });
  }

  function listenCollection(collection, localKey) {
    listeners.push(db.collection(collection).onSnapshot(snapshot => applySnapshot(collection, localKey, snapshot), err => {
      console.error('Lecture temps réel impossible (' + collection + ')', err);
      emit('ivoirenova:sync-error', { key: localKey, message: err.message || 'Lecture Firebase impossible' });
    }));
  }

  // Les classes doivent être visibles sur l'écran d'inscription AVANT la connexion.
  // Cette écoute publique reste active même lorsqu'aucun élève n'est encore connecté.
  db.collection('classes').onSnapshot(snapshot => {
    applySnapshot('classes', 'ivoirenova_classes', snapshot);
  }, err => {
    console.error('Chargement public des classes impossible', err);
    emit('ivoirenova:sync-error', { key: 'ivoirenova_classes', message: err.message || 'Lecture des classes impossible' });
  });

  function stopListeners() { listeners.splice(0).forEach(fn => { try { fn(); } catch (_) {} }); syncStartedFor = ''; latestSnapshots.clear(); cloudInitialized = false; }

  function startRealtimeSync(user) {
    if (!user) { stopListeners(); return; }
    if (syncStartedFor === user.uid) return;
    stopListeners(); syncStartedFor = user.uid;
    listeners.push(META_REF.onSnapshot(doc => {
      cloudInitialized = !!(doc.exists && doc.data().initialized === true);
      if (cloudInitialized) latestSnapshots.forEach((rows, key) => {
        syncingRemote = true; localSet(key, rows); syncingRemote = false; refreshForKey(key);
      });
    }, err => console.warn('État de synchronisation indisponible', err)));

    Object.entries(publicMap).forEach(([key, collection]) => {
      // Les classes ont déjà une écoute publique indépendante de l'authentification.
      if (collection === 'classes') return;
      if (collection === 'reviews' && !isAdmin(user)) return;
      listenCollection(collection, key);
    });
    ['ivoirenova_settings', 'ivoirenova_ia_settings'].forEach(key => {
      const id = key === 'ivoirenova_settings' ? 'app' : 'ia';
      listeners.push(db.collection('settings').doc(id).onSnapshot(doc => {
        if (!doc.exists) return;
        syncingRemote = true; localSet(key, doc.data().value || {}); syncingRemote = false;
      }, err => console.warn('Paramètres non synchronisés', err)));
    });

    // Abonnements : toutes les demandes pour l’administrateur, uniquement les siennes pour un élève.
    const subQuery = isAdmin(user) ? db.collection('subscriptions') : db.collection('subscriptions').where('ownerUid', '==', user.uid);
    listeners.push(subQuery.onSnapshot(snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      syncingRemote = true; localSet('ivoirenova_subscriptions', rows); syncingRemote = false;
      refreshForKey('ivoirenova_subscriptions');
      emit('ivoirenova:data-updated', { collection: 'subscriptions', key: 'ivoirenova_subscriptions', count: rows.length });
    }, err => emit('ivoirenova:sync-error', { key: 'ivoirenova_subscriptions', message: err.message })));

    // L’administrateur voit la liste complète ; un élève ne lit que son propre profil.
    if (isAdmin(user)) {
      listeners.push(db.collection('users').onSnapshot(snap => {
        const rows = snap.docs.map(d => ({ id: d.id, uid: d.id, ...safeUserRecord(d.data()) }));
        syncingRemote = true; localSet('ivoirenova_users', rows); syncingRemote = false;
        if (typeof appState !== 'undefined') { appState.users = rows; refreshForKey('ivoirenova_users'); }
      }, err => console.warn('Liste des élèves non synchronisée', err)));
    } else {
      listeners.push(db.collection('users').doc(user.uid).onSnapshot(doc => {
        if (!doc.exists) return;
        const profile = { id: user.uid, uid: user.uid, ...safeUserRecord(doc.data()), email: user.email };
        if (typeof appState !== 'undefined' && appState.currentUser) {
          appState.currentUser = { ...appState.currentUser, ...profile };
          const list = Array.isArray(appState.users) ? appState.users : [];
          const index = list.findIndex(x => x.id === user.uid);
          if (index >= 0) list[index] = appState.currentUser; else list.push(appState.currentUser);
          appState.users = list;
          if (typeof refreshIvoAccountBlock === 'function') refreshIvoAccountBlock();
          if (typeof studentHasAccess === 'function' && !studentHasAccess()) { try { showExpiredAccess?.(); } catch (_) {} }
        }
      }, err => console.warn('Profil élève non synchronisé', err)));
    }

    const chatsRef = db.collection('users').doc(user.uid).collection('conversations');
    listeners.push(chatsRef.onSnapshot(async snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const key = currentKey(user.uid), legacy = localGet(key);
      if (rows.length || cloudInitialized) {
        syncingRemote = true; localSet(key, rows); syncingRemote = false;
      } else if (Array.isArray(legacy) && legacy.length) {
        try { await writePrivateRows(user.uid, 'conversations', legacy); } catch (e) { console.warn('Migration de l’historique local impossible', e); }
      }
      try { if (typeof renderStudentConversationHistory === 'function') renderStudentConversationHistory(); } catch (_) {}
    }, err => console.warn('Historique privé non synchronisé', err)));

    const prefRef = db.collection('users').doc(user.uid).collection('preferences').doc('notifications');
    listeners.push(prefRef.onSnapshot(async doc => {
      const key = 'ivoirenova_notifications_read_' + user.uid;
      if (doc.exists) { syncingRemote = true; localSet(key, doc.data().read || []); syncingRemote = false; }
      else { const legacy = localGet(key); if (Array.isArray(legacy) && legacy.length) { try { await prefRef.set({ read: legacy, updatedAt: SERVER_TIME() }, { merge: true }); } catch (_) {} } }
      try { if (typeof updateNotificationBadge === 'function') updateNotificationBadge(); } catch (_) {}
    }, () => {}));
  }

  async function uploadPdf(file, { category = 'course', title = '', classe = '', matiere = '', id: requestedId = '' } = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Connexion requise pour envoyer un PDF.');
    if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) throw new Error('Sélectionnez un fichier PDF.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Le PDF dépasse la limite de 10 Mo.');
    const id = requestedId || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
    const path = `pdf/${user.uid}/${id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const ref = storage.ref().child(path); await ref.put(file, { contentType: 'application/pdf' });
    const url = await ref.getDownloadURL();
    const doc = { id, ownerUid: user.uid, category, title: title || file.name, fileName: file.name, storagePath: path, downloadURL: url, classe, matiere, published: category === 'course', createdAt: SERVER_TIME() };
    await db.collection('pdfDocuments').doc(id).set(doc, { merge: true });
    return { ...doc, downloadURL: url };
  }

  async function uploadDataUrl(dataUrl, { folder = 'documents', id, fileName = 'document', contentType = '' } = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Connexion requise pour envoyer un fichier.');
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!match) throw new Error('Fichier local illisible.');
    const type = contentType || match[1] || 'application/octet-stream';
    const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type });
    if (blob.size > 10 * 1024 * 1024) throw new Error('Fichier trop volumineux (10 Mo maximum).');
    const docId = id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
    const path = `${folder}/${user.uid}/${docId}/${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const ref = storage.ref().child(path); await ref.put(blob, { contentType: type });
    return { storagePath: path, downloadURL: await ref.getDownloadURL(), fileName, ownerUid: user.uid };
  }

  async function migrateLocalData() {
    const user = auth.currentUser;
    if (!isAdmin(user)) throw new Error('Connectez-vous avec le compte administrateur pour lancer la migration.');
    const report = { migrated: [], skipped: [], errors: [] };
    const keys = ['ivoirenova_users','ivoirenova_matieres','ivoirenova_cours','ivoirenova_ads','ivoirenova_informations','ivoirenova_classes','ivoirenova_subscriptions','ivoirenova_reviews','ivoirenova_settings','ivoirenova_ia_settings'];
    for (const key of keys) {
      const value = localGet(key); if (value == null) { report.skipped.push(key); continue; }
      try {
        let prepared = value;
        if (key === 'ivoirenova_cours' && Array.isArray(value)) {
          prepared = [];
          for (const row of value) {
            const copy = { ...row };
            if (copy.data && String(copy.data).startsWith('data:')) {
              const uploaded = await uploadDataUrl(copy.data, { folder: 'pdf', id: copy.id, fileName: copy.fileName || 'cours.pdf', contentType: 'application/pdf' });
              Object.assign(copy, uploaded); copy.data = '';
              await db.collection('pdfDocuments').doc(String(copy.id)).set({ id: String(copy.id), ownerUid: user.uid, category: 'course', title: copy.titre || copy.fileName, fileName: copy.fileName, ...uploaded, classe: copy.classe, matiere: copy.matiere, published: true }, { merge: true });
            }
            prepared.push(copy);
          }
        }
        if ((key === 'ivoirenova_informations' || key === 'ivoirenova_ads') && Array.isArray(value)) {
          prepared = [];
          for (const row of value) {
            const copy = { ...row };
            if (copy.data && String(copy.data).startsWith('data:')) {
              const uploaded = await uploadDataUrl(copy.data, { folder: 'documents', id: copy.id, fileName: copy.fileName || (key === 'ivoirenova_ads' ? 'media' : 'information.pdf') });
              Object.assign(copy, uploaded); copy.data = '';
            }
            prepared.push(copy);
          }
        }
        if (key === 'ivoirenova_subscriptions' && Array.isArray(prepared)) {
          const usersSnap = await db.collection('users').get();
          const uidByEmail = new Map(usersSnap.docs.map(d => [String(d.data().email || '').toLowerCase(), d.id]));
          prepared = prepared.map(row => ({ ...row, ownerUid: uidByEmail.get(String(row.email || '').toLowerCase()) || row.ownerUid || '' }));
          await writeRows('subscriptions', prepared);
        } else if (publicMap[key]) await writeRows(publicMap[key], prepared);
        else if (key === 'ivoirenova_settings' || key === 'ivoirenova_ia_settings') await syncStore(key, prepared);
        else if (key === 'ivoirenova_users') await syncStore(key, prepared);
        report.migrated.push({ key, count: Array.isArray(prepared) ? prepared.length : 1 });
      } catch (e) { report.errors.push({ key, message: e.message || String(e) }); }
    }
    const chats = localGet(currentKey(user.uid));
    if (Array.isArray(chats)) { try { await writePrivateRows(user.uid, 'conversations', chats); report.migrated.push({ key: 'conversations', count: chats.length }); } catch (e) { report.errors.push({ key: 'conversations', message: e.message || String(e) }); } }
    if (!report.errors.length) {
      await META_REF.set({ initialized: true, initializedAt: SERVER_TIME(), initializedBy: user.uid, schemaVersion: 2 }, { merge: true });
      cloudInitialized = true;
    }
    return report;
  }

  window.ivoFirebase = {
    auth, db, storage, ready: true, currentUser: () => auth.currentUser,
    isAdmin: () => isAdmin(auth.currentUser), signIn: (email, password) => auth.signInWithEmailAndPassword(email, password),
    signOut: () => auth.signOut(), queueStoreSync, syncStore, startRealtimeSync, migrateLocalData, uploadPdf, uploadDataUrl,
    signUp: async (email, password, profile = {}) => {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: [profile.nom, profile.prenom].filter(Boolean).join(' ') });
      await db.collection('users').doc(cred.user.uid).set({ uid: cred.user.uid, email: cred.user.email, ...profile, createdAt: SERVER_TIME() }, { merge: true });
      return cred.user;
    },
    savePrivateData: async (collection, id, data) => {
      const u = auth.currentUser; if (!u) throw new Error('Connectez-vous pour enregistrer vos données.');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(collection)) throw new Error('Nom de rubrique invalide.');
      await db.collection('users').doc(u.uid).collection(collection).doc(String(id)).set({ ...data, updatedAt: SERVER_TIME() }, { merge: true });
    },
    listPrivateData: async collection => {
      const u = auth.currentUser; if (!u) throw new Error('Connectez-vous pour consulter vos données.');
      const snap = await db.collection('users').doc(u.uid).collection(collection).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    deleteMyPdf: async id => {
      const u = auth.currentUser; if (!u) throw new Error('Connexion requise.');
      const ref = db.collection('pdfDocuments').doc(String(id)), snap = await ref.get();
      if (!snap.exists || (!isAdmin(u) && snap.data().ownerUid !== u.uid)) throw new Error('Suppression non autorisée.');
      if (snap.data().storagePath) await storage.ref().child(snap.data().storagePath).delete();
      await ref.delete();
    }
  };

  auth.onAuthStateChanged(user => { startRealtimeSync(user); emit('ivoirenova:auth', { user }); });
  window.addEventListener('ivoirenova:sync-error', e => {
    console.warn('Certaines données n’ont pas été envoyées au cloud :', e.detail);
    try { if (typeof showStudentToast === 'function') showStudentToast('Synchronisation Firebase impossible. Vérifiez les règles et votre connexion.', true); } catch (_) {}
  });
  console.info('IVOIRENOVA : Firebase prêt — synchronisation temps réel activée.');
})();
