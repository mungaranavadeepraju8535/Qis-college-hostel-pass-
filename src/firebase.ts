import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let db: any;
let app: any;

async function testFrontendConnection(firestoreDb: any) {
  try {
    console.log("Testing frontend Firestore connection...");
    // Use a timeout to detect if it's hanging
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Connection timeout")), 15000)
    );
    
    await Promise.race([
      getDocFromServer(doc(firestoreDb, 'test', 'connection')),
      timeoutPromise
    ]);
    
    console.log("Frontend Firestore connection successful!");
  } catch (error: any) {
    console.error("Firestore Error Details:", {
      message: error.message,
      code: error.code,
      name: error.name,
      stack: error.stack
    });
    
    if (error.message.includes('the client is offline') || error.message.includes('Connection timeout')) {
      console.error("CRITICAL: Frontend Firestore configuration is incorrect or backend is unreachable. The client is offline.");
    } else {
      console.warn("Frontend Firestore connection test failed (this might be normal if the doc doesn't exist, but it should not be 'offline'):", error.message);
    }
  }
}

async function initializeFirebase() {
  try {
    console.log("Initializing frontend Firebase with project ID:", firebaseConfig.projectId);
    app = initializeApp(firebaseConfig);
    
    // Try with specific database ID first
    if (firebaseConfig.firestoreDatabaseId) {
      db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
      await testFrontendConnection(db);
    } else {
      db = getFirestore(app);
      await testFrontendConnection(db);
    }
  } catch (error: any) {
    console.warn("Frontend Firestore initialization with specific ID failed, falling back to default:", error.message);
    try {
      db = getFirestore(app);
      await testFrontendConnection(db);
    } catch (fallbackError: any) {
      console.error("Firebase initialization failed completely in frontend:", fallbackError.message);
    }
  }
}

initializeFirebase();

export { db };
