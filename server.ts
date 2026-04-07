import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { initializeApp } from "firebase/app";
import { 
  initializeFirestore,
  collection, 
  doc, 
  getDoc, 
  getDocFromServer,
  setDoc, 
  getDocs, 
  query, 
  where, 
  updateDoc, 
  addDoc,
  orderBy,
  writeBatch,
  terminate
} from "firebase/firestore";

// Load Firebase config using fs to avoid ESM import attribute issues
let firebaseConfig: any = {};
try {
  if (fs.existsSync("./firebase-applet-config.json")) {
    firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  } else {
    console.warn("firebase-applet-config.json not found. Firebase will not be initialized.");
  }
} catch (err) {
  console.error("Failed to read firebase-applet-config.json:", err);
}

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "hostel-pass-secret-key";

let db: any;
let firebaseApp: any;

try {
  // Initialize Firebase
  console.log("Initializing Firebase with project ID:", firebaseConfig.projectId);
  if (!firebaseConfig.projectId) {
    console.error("CRITICAL: firebase-applet-config.json is missing projectId!");
  }
  firebaseApp = initializeApp(firebaseConfig);
  
  const firestoreSettings = {
    experimentalForceLongPolling: true,
  };

  // Try initializing with the specific database ID
  try {
    db = initializeFirestore(firebaseApp, firestoreSettings, firebaseConfig.firestoreDatabaseId);
    console.log("Firestore initialized with database ID:", firebaseConfig.firestoreDatabaseId);
  } catch (idError: any) {
    console.warn("Firestore initialization with specific ID failed, falling back to default database:", idError.message);
    db = initializeFirestore(firebaseApp, firestoreSettings);
    console.log("Firestore initialized with default database.");
  }
} catch (error: any) {
  console.error("Firebase initialization failed completely:", error.message);
}

app.use(cors());
app.use(express.json());

// Middleware for JWT Authentication
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ message: "Forbidden" });
    req.user = user;
    next();
  });
};

import twilio from "twilio";

// --- OTP Store ---
const otpStore = new Map<string, string>();

// --- Twilio Client ---
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) 
  : null;

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (sid && token && from) {
    try {
      const client = twilio(sid, token);
      await client.messages.create({
        body,
        from,
        to
      });
      console.log(`SMS sent to ${to} via Twilio`);
      return { success: true };
    } catch (err: any) {
      console.error("Twilio SMS failed:", err.message);
      return { success: false, error: `Twilio Error: ${err.message}` };
    }
  } else {
    console.log(`\n--- SMS SIMULATION (NO TWILIO KEYS) ---`);
    console.log(`To: ${to}`);
    console.log(`Body: ${body}`);
    console.log(`---------------------------------------\n`);
    return { success: false, error: "Real SMS not configured. Twilio credentials missing in Settings." };
  }
}

// --- Health Check ---
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    firebaseInitialized: !!db,
    timestamp: new Date().toISOString()
  });
});

// --- Auth Routes ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(res: any, error: any, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: "server-side-auth", // Simplified for server-side
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo, null, 2));
  if (res && typeof res.status === 'function') {
    res.status(500).json(errInfo);
  } else {
    console.error("Critical: handleFirestoreError called without valid res object");
  }
}

const BOOTSTRAP_USERS = [
  {
    id: "25495a0427",
    name: "M NAVADEEP RAJU",
    email: "25495a0427",
    password: "853525",
    role: "student",
    roomNumber: "130",
    bedNumber: "1",
    studentPhone: "9391853525"
  },
  {
    id: "22093ec158",
    name: "Warden User",
    email: "22093ec158",
    password: "853525",
    role: "warden"
  },
  {
    id: "security1",
    name: "Security Guard",
    email: "security1",
    password: "password",
    role: "security"
  },
  {
    id: "hod1",
    name: "HOD User",
    email: "hod1",
    password: "password",
    role: "hod"
  }
];

const FIRST_NAMES = ["Aarav", "Vihaan", "Aditya", "Arjun", "Sai", "Ishaan", "Krishna", "Aryan", "Shaurya", "Atharv", "Ananya", "Diya", "Pari", "Myra", "Aadhya", "Saanvi", "Ishani", "Aavya", "Kiara", "Zoya"];
const LAST_NAMES = ["Sharma", "Verma", "Gupta", "Malhotra", "Kapoor", "Singh", "Reddy", "Patel", "Iyer", "Nair", "Joshi", "Chopra", "Mehra", "Bose", "Das", "Kulkarni", "Deshmukh", "Pande", "Rao", "Yadav"];

function getRandomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

async function bootstrapUsers() {
  console.log("Starting bootstrap process with project ID:", firebaseConfig.projectId);
  
  // 1. Bootstrap Fixed Users
  for (const user of BOOTSTRAP_USERS) {
    try {
      const userRef = doc(db, "users", user.id);
      const userDoc = await getDoc(userRef);
      
      const hashedPassword = await bcrypt.hash(user.password, 10);
      const { password, ...userData } = user;
      
      if (!userDoc.exists()) {
        await setDoc(userRef, {
          ...userData,
          password: hashedPassword
        });
        console.log(`Bootstrapped fixed user: ${user.id} (${user.role})`);
      } else {
        // Always overwrite the fixed users to ensure they have the correct password and details (removes old fields)
        await setDoc(userRef, {
          ...userData,
          password: hashedPassword
        });
        console.log(`Updated fixed user: ${user.id} (${user.role})`);
      }
    } catch (err: any) {
      console.error(`Failed to bootstrap user ${user.id}:`, err.message);
      throw err;
    }
  }

  // 2. Check if we need to bootstrap rooms and students
  const room1Ref = doc(db, "rooms", "1");
  try {
    const room1Doc = await getDocFromServer(room1Ref);
    if (room1Doc.exists()) {
      console.log("Rooms already bootstrapped. Skipping large bootstrap.");
      return;
    }
  } catch (error: any) {
    console.warn("Could not check room bootstrap status from server, might be first run or connection issue:", error.message);
    // If it's a "not found" error, we should proceed with bootstrap.
    // If it's a connection error, it will fail later anyway.
  }

  console.log("Generating 300 rooms and 1500 students...");
  const hashedPassword = await bcrypt.hash("853525", 10);

  // Generate rooms: 1-100 (Ground), 101-200 (Second), 201-300 (Third)
  // We'll use batches of 500 operations.
  // 300 rooms * (1 room doc + 5 student docs) = 1800 docs.
  // 1800 / 500 = 3.6 batches.
  
  let batch = writeBatch(db);
  let opCount = 0;

  for (let i = 1; i <= 300; i++) {
    const roomNumber = i.toString();
    const occupants: string[] = [];

    // Create 5 students for each room
    for (let j = 1; j <= 5; j++) {
      const studentId = `S-${roomNumber}-${j}`;
      const name = getRandomName();
      
      const studentData = {
        id: studentId,
        name: name,
        email: studentId,
        password: hashedPassword,
        role: "student",
        roomNumber: roomNumber
      };

      batch.set(doc(db, "users", studentId), studentData);
      occupants.push(studentId);
      opCount++;

      if (opCount >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
        console.log(`Committed batch at room ${i}, student ${j}`);
      }
    }

    // Create room
    batch.set(doc(db, "rooms", roomNumber), {
      roomNumber: roomNumber, // Store as field too
      capacity: 5,
      occupants: occupants
    });
    opCount++;

    if (opCount >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
      console.log(`Committed batch at room ${i}`);
    }
  }

  if (opCount > 0) {
    await batch.commit();
    console.log("Committed final batch.");
  }

  console.log("Bootstrap complete!");
}

app.post("/api/auth/register", async (req, res) => {
  res.status(403).json({ message: "Registration is currently disabled." });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password, role } = req.body;
  console.log(`Login attempt for email: ${email}, role: ${role}`);

  try {
    const userDoc = await getDoc(doc(db, "users", email));
    
    if (!userDoc.exists()) {
      console.warn(`User document not found for email: ${email}`);
      return res.status(401).json({ message: "Invalid Login ID or Password." });
    }

    const user = userDoc.data();
    console.log(`User found: ${user.name}, role: ${user.role}`);

    if (user.role !== role) {
      console.warn(`Role mismatch for user ${email}. Expected: ${role}, Found: ${user.role}`);
      return res.status(401).json({ message: "Invalid Login ID or Password." });
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.warn(`Invalid password for user ${email}`);
      return res.status(401).json({ message: "Invalid Login ID or Password." });
    }

    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET);
    const { password: _, ...userWithoutPassword } = user;
    console.log(`Login successful for user: ${user.id}`);
    res.json({ token, user: userWithoutPassword });
  } catch (error: any) {
    console.error(`Login error for user ${email}:`, error);
    handleFirestoreError(res, error, OperationType.GET, "users");
  }
});

// --- OTP Routes ---

app.post("/api/otp/send", authenticateToken, async (req: any, res) => {
  try {
    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(req.user.id, otp);
    
    const parentPhone = "+918985990133"; // Ensure E.164 format for real SMS
    const body = `Your child ${req.user.name} is requesting an outpass. OTP: ${otp}`;
    
    const result = await sendSms(parentPhone, body);
    
    if (result.success) {
      res.json({ message: "OTP sent to parent's phone number" });
    } else {
      // If real SMS failed or not configured, return OTP in response for testing
      res.json({ 
        message: result.error,
        debugOtp: otp,
        isSimulation: true
      });
    }
  } catch (error: any) {
    console.error("OTP send error:", error);
    res.status(500).json({ message: "Failed to send OTP", error: error.message });
  }
});

app.post("/api/otp/verify", authenticateToken, (req: any, res) => {
  const { otp } = req.body;
  const storedOtp = otpStore.get(req.user.id);
  
  if (storedOtp && storedOtp === otp) {
    // Clear OTP after successful verification
    otpStore.delete(req.user.id);
    res.json({ success: true, message: "OTP verified successfully" });
  } else {
    res.status(400).json({ success: false, message: "Invalid OTP" });
  }
});

// --- Student Routes ---

app.post("/api/requests", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ message: "Forbidden" });

  const { studentName, roomNumber, bedNumber, rollNumber, studentPhone, reason, outTime, returnTime, type, photo, parentVerified } = req.body;
  console.log(`Received request from student ${req.user.id}: ${type}`);
  
  const passId = `${type === 'home_pass' ? 'HP' : 'OP'}-${Math.floor(100000 + Math.random() * 900000)}`;
  
  const newRequest = {
    studentId: req.user.id,
    studentName: studentName || "",
    roomNumber: roomNumber || "",
    bedNumber: bedNumber || "",
    rollNumber: rollNumber || "",
    studentPhone: studentPhone || "",
    reason: reason || "",
    outTime: outTime || "",
    returnTime: returnTime || "",
    type: type || "outpass", // outpass, home_pass
    status: type === 'outpass' ? 'hod_pending' : 'pending',
    photo: photo || "",
    parentVerified: parentVerified || false,
    parentPhone: "8985990133", // Hardcoded for now as per requirement
    createdAt: new Date().toISOString(),
    passId
  };

  try {
    if (!db) {
      handleFirestoreError(res, new Error("Database not initialized"), OperationType.WRITE, "requests");
      return;
    }
    const docRef = await addDoc(collection(db, "requests"), newRequest);
    console.log(`Request created with ID: ${docRef.id}`);
    res.status(201).json({ id: docRef.id, ...newRequest });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.CREATE, "requests");
  }
});

app.get("/api/requests/student", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ message: "Forbidden" });

  try {
    const q = query(collection(db, "requests"), where("studentId", "==", req.user.id), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    const requests = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(requests);
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.LIST, "requests");
  }
});

// --- Warden Routes ---

app.get("/api/requests/all", authenticateToken, async (req: any, res) => {
  console.log(`GET /api/requests/all called by user: ${req.user.id} (${req.user.role})`);
  if (req.user.role !== 'warden' && req.user.role !== 'hod') {
    console.warn(`Forbidden access attempt to /api/requests/all by role: ${req.user.role}`);
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const q = query(collection(db, "requests"), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    const requests = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`Successfully fetched ${requests.length} requests.`);
    res.json(requests);
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.LIST, "requests");
  }
});

app.patch("/api/requests/:id", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden' && req.user.role !== 'hod') return res.status(403).json({ message: "Forbidden" });

  const { status, remarks, wardenPhoto, hodPhoto, hodRemarks, parentsIntimated } = req.body;
  try {
    const requestRef = doc(db, "requests", req.params.id);
    const updateData: any = { 
      status, 
    };
    
    if (req.user.role === 'warden') {
      if (remarks !== undefined) updateData.remarks = remarks;
      if (wardenPhoto) updateData.wardenPhoto = wardenPhoto;
      if (parentsIntimated !== undefined) updateData.parentsIntimated = parentsIntimated;
    } else if (req.user.role === 'hod') {
      if (hodRemarks !== undefined) updateData.hodRemarks = hodRemarks;
      if (hodPhoto) updateData.hodPhoto = hodPhoto;
    }
    
    await updateDoc(requestRef, updateData);
    
    // If fully approved, simulate sending SMS to parent
    if (status === 'approved') {
      const requestDoc = await getDoc(requestRef);
      const request = requestDoc.data();
      const parentPhone = "+918985990133";
      let body = `Your child ${request?.studentName}'s outpass request has been APPROVED. Details: Type: ${request?.type}, Out: ${request?.outTime}, Return: ${request?.returnTime}`;
      
      if (request?.type === 'home_pass') {
        body += `. Parent Intimated: ${request?.parentsIntimated ? 'YES' : 'NO'}`;
      }
      
      await sendSms(parentPhone, body);
    }
    
    res.json({ message: "Request updated successfully" });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.UPDATE, `requests/${req.params.id}`);
  }
});

app.patch("/api/rooms/:roomNumber/online", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  const { studentId, isOnline } = req.body;
  try {
    const roomRef = doc(db, "rooms", req.params.roomNumber);
    const roomDoc = await getDoc(roomRef);
    if (!roomDoc.exists()) return res.status(404).json({ message: "Room not found" });

    const room = roomDoc.data();
    let onlineStudents = room.onlineStudents || [];

    if (isOnline) {
      if (!onlineStudents.includes(studentId)) {
        onlineStudents.push(studentId);
      }
    } else {
      onlineStudents = onlineStudents.filter((id: string) => id !== studentId);
    }

    await updateDoc(roomRef, { onlineStudents });
    res.json({ message: "Room online status updated successfully" });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.UPDATE, `rooms/${req.params.roomNumber}`);
  }
});

app.post("/api/rooms/seed-online", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  try {
    const roomsSnapshot = await getDocs(collection(db, "rooms"));
    const batch = writeBatch(db);

    roomsSnapshot.docs.forEach(roomDoc => {
      const room = roomDoc.data();
      const occupants = room.occupants || [];
      // Randomly select some occupants to be online
      const onlineStudents = occupants.filter(() => Math.random() > 0.5);
      batch.update(roomDoc.ref, { onlineStudents });
    });

    await batch.commit();
    res.json({ message: "Random online status seeded successfully" });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.WRITE, "rooms/seed-online");
  }
});

app.get("/api/rooms/my-room", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ message: "Forbidden" });

  try {
    const userDoc = await getDoc(doc(db, "users", req.user.id));
    if (!userDoc.exists()) return res.status(404).json({ message: "User not found" });
    const user = userDoc.data();
    if (!user.roomNumber) return res.status(400).json({ message: "No room assigned" });

    const roomDoc = await getDoc(doc(db, "rooms", user.roomNumber));
    if (!roomDoc.exists()) return res.status(404).json({ message: "Room not found" });
    const room = roomDoc.data();

    // Get all outpass requests for this room that are 'out'
    const q = query(collection(db, "requests"), where("roomNumber", "==", user.roomNumber), where("status", "==", "out"));
    const querySnapshot = await getDocs(q);
    const outCount = querySnapshot.size;
    const total = room.occupants.length;
    const inCount = Math.max(0, total - outCount);

    res.json({ in: inCount, out: outCount, total });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.GET, "rooms/my-room");
  }
});

app.get("/api/rooms", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  try {
    const querySnapshot = await getDocs(collection(db, "rooms"));
    const rooms = querySnapshot.docs.map(doc => ({ roomNumber: doc.id, ...doc.data() }));
    // Sort rooms numerically by room number
    rooms.sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber));
    res.json(rooms);
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.LIST, "rooms");
  }
});

app.post("/api/rooms", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  const { roomNumber, capacity } = req.body;
  try {
    await setDoc(doc(db, "rooms", roomNumber), { capacity, occupants: [] });
    res.status(201).json({ roomNumber, capacity, occupants: [] });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.WRITE, `rooms/${roomNumber}`);
  }
});

// --- Room Check Routes ---

app.post("/api/room-checks", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  const { roomNumber, presentCount, onlineCount, checkType } = req.body;
  
  if (presentCount < onlineCount) {
    return res.status(400).json({ message: "Invalid Data: Present members cannot be less than online members." });
  }

  const extraCount = presentCount - onlineCount;
  const newCheck = {
    roomNumber,
    presentCount,
    onlineCount,
    extraCount,
    checkType, // morning, afternoon, evening
    recordedBy: req.user.id,
    createdAt: new Date().toISOString()
  };

  try {
    await addDoc(collection(db, "roomChecks"), newCheck);
    res.status(201).json(newCheck);
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.CREATE, "roomChecks");
  }
});

app.get("/api/room-checks/latest", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  try {
    const q = query(collection(db, "roomChecks"), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    const checks = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Get only the latest check for each room
    const latestChecks: Record<string, any> = {};
    checks.forEach((check: any) => {
      if (!latestChecks[check.roomNumber]) {
        latestChecks[check.roomNumber] = check;
      }
    });
    
    res.json(Object.values(latestChecks));
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.LIST, "roomChecks");
  }
});

app.get("/api/students", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  try {
    const q = query(collection(db, "users"), where("role", "==", "student"));
    const querySnapshot = await getDocs(q);
    const students = querySnapshot.docs.map(doc => {
      const data = doc.data();
      const { password: _, ...studentWithoutPassword } = data;
      return studentWithoutPassword;
    });
    res.json(students);
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.LIST, "users");
  }
});

app.patch("/api/rooms/:roomNumber/occupants", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  const { studentId, action } = req.body;
  const { roomNumber } = req.params;

  try {
    const roomRef = doc(db, "rooms", roomNumber);
    const roomDoc = await getDoc(roomRef);
    if (!roomDoc.exists()) return res.status(404).json({ message: "Room not found" });

    const roomData = roomDoc.data();
    let occupants = roomData.occupants || [];

    if (action === 'add') {
      if (occupants.length >= roomData.capacity) {
        return res.status(400).json({ message: "Room is at full capacity" });
      }
      occupants.push(studentId);
      await updateDoc(doc(db, "users", studentId), { roomNumber });
    } else {
      occupants = occupants.filter((id: string) => id !== studentId);
      await updateDoc(doc(db, "users", studentId), { roomNumber: "" });
    }

    await updateDoc(roomRef, { occupants });
    res.json({ message: "Occupants updated" });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.UPDATE, `rooms/${roomNumber}`);
  }
});

app.patch("/api/students/:id", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'warden') return res.status(403).json({ message: "Forbidden" });

  const { name, roomNumber, bedNumber, studentPhone } = req.body;
  try {
    const userRef = doc(db, "users", req.params.id);
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (roomNumber !== undefined) updateData.roomNumber = roomNumber;
    if (bedNumber !== undefined) updateData.bedNumber = bedNumber;
    if (studentPhone !== undefined) updateData.studentPhone = studentPhone;

    await updateDoc(userRef, updateData);
    res.json({ message: "Student details updated successfully" });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.UPDATE, `users/${req.params.id}`);
  }
});

// --- Security Scanner Route ---

app.get("/api/requests/verify/:id", async (req, res) => {
  try {
    const requestDoc = await getDoc(doc(db, "requests", req.params.id));
    if (!requestDoc.exists()) {
      return res.status(404).json({ message: "Request not found" });
    }
    const request = requestDoc.data();
    
    res.json({ id: requestDoc.id, ...request });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.GET, `requests/${req.params.id}`);
  }
});

// --- Security Routes ---

app.patch("/api/requests/:id/status", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'security' && req.user.role !== 'warden' && req.user.role !== 'hod') return res.status(403).json({ message: "Forbidden" });

  const { status } = req.body;
  try {
    const requestRef = doc(db, "requests", req.params.id);
    await updateDoc(requestRef, { status });
    res.json({ message: `Status updated to ${status}` });
  } catch (error: any) {
    handleFirestoreError(res, error, OperationType.UPDATE, `requests/${req.params.id}`);
  }
});

// --- Vite Integration ---

async function testConnection() {
  if (!db) return;
  try {
    console.log("Testing Firestore connection...");
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection successful!");
  } catch (error: any) {
    if (error.message.includes('the client is offline')) {
      console.error("CRITICAL: Firestore configuration is incorrect. The client is offline.");
    } else {
      console.error("Firestore connection test failed:", error.message);
    }
  }
}

async function startServer() {
  // Handle 404 for API routes BEFORE Vite/SPA fallback so they return JSON
  app.all("/api/*", (req, res) => {
    res.status(404).json({ message: `API route not found: ${req.originalUrl}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // --- Global Error Handler ---
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global error handler caught:", err.message);
  try {
    const errorInfo = JSON.parse(err.message);
    if (errorInfo.error && errorInfo.operationType) {
      return res.status(500).json(errorInfo);
    }
  } catch (e) {
    // Not a JSON error
  }
  res.status(500).json({ message: err.message || "Internal Server Error" });
});

app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (db) {
      await testConnection();
      try {
        await bootstrapUsers();
      } catch (error) {
        console.error("Bootstrap failed:", error);
      }
    } else {
      console.warn("Skipping bootstrap because Firebase is not initialized.");
    }
  });
}

startServer();
