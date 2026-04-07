import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer, enableIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let db: any;
let app: any;

async function testFrontendConnection(firestoreDb: any) {
  try {
    console.log("Testing frontend Firestore connection...");
    // Use a shorter timeout for the test
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Connection timeout")), 5000)
    );
    
    await Promise.race([
      getDocFromServer(doc(firestoreDb, 'test', 'connection')),
      timeoutPromise
    ]);
    
    console.log("Frontend Firestore connection successful!");
    return true;
  } catch (error: any) {
    console.warn("Firestore connection test failed:", error.message);
    return false;
  }
}

async function initializeFirebase() {
  try {
    console.log("Initializing frontend Firebase with project ID:", firebaseConfig.projectId);
    app = initializeApp(firebaseConfig);
    
    let success = false;

    // Try with specific database ID first if provided
    if (firebaseConfig.firestoreDatabaseId) {
      console.log("Attempting to use specific database ID:", firebaseConfig.firestoreDatabaseId);
      db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
      success = await testFrontendConnection(db);
    }

    // Fallback to default database if specific ID failed or wasn't provided
    if (!success) {
      console.log("Falling back to default database...");
      db = getFirestore(app);
      success = await testFrontendConnection(db);
    }

    if (!success) {
      console.error("CRITICAL: Could not establish a healthy connection to Firestore. The app may be in offline mode.");
    }

    // Enable offline persistence
    try {
      await enableIndexedDbPersistence(db);
      console.log("Firestore persistence enabled");
    } catch (err: any) {
      if (err.code === 'failed-precondition') {
        console.warn("Persistence failed: Multiple tabs open");
      } else if (err.code === 'unimplemented') {
        console.warn("Persistence is not supported by this browser");
      }
    }

  } catch (error: any) {
    console.error("Firebase initialization failed completely in frontend:", error.message);
  }
}

initializeFirebase();

export { db };
