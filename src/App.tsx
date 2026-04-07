import React, { Component, useState, useEffect, createContext, useContext, useRef } from 'react';
import { 
  Building2, 
  Users, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  LogOut, 
  LayoutDashboard, 
  ClipboardList, 
  UserPlus, 
  BarChart3, 
  QrCode, 
  Camera, 
  ChevronRight, 
  Plus, 
  Search, 
  Filter, 
  Menu, 
  X, 
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  UserCheck,
  UserMinus,
  MapPin,
  ArrowRight,
  User,
  Volume2,
  Phone,
  RefreshCw
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import { format, isAfter, isBefore, parseISO } from 'date-fns';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from './firebase';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  User as UserType, 
  OutpassRequest, 
  Room, 
  RequestStatus, 
  AuthResponse 
} from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const safeJSONParse = (str: any) => {
  if (!str || typeof str !== 'string' || str === 'undefined' || str === 'null' || str.trim() === '' || str === '[object Object]') {
    return null;
  }
  try {
    // Extra safety: check if it's a valid JSON structure before parsing
    if (!str.startsWith('{') && !str.startsWith('[')) {
      return null;
    }
    return JSON.parse(str);
  } catch (e) {
    console.error("JSON parse error", e);
    return null;
  }
};

// --- Auth Context ---

interface AuthContextType {
  user: UserType | null;
  token: string | null;
  login: (data: AuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Error Handling ---

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
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const auth = getAuth();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo, null, 2));
  throw new Error(JSON.stringify(errInfo));
}

const safeFetch = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type");
  
  if (contentType && contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) {
      if (data.error && data.operationType) {
        throw new Error(JSON.stringify(data));
      }
      throw new Error(data.message || `Request failed with status ${res.status}`);
    }
    return data;
  } else {
    // Not JSON - likely a 404 or HTML error page from a static host like Netlify
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("API endpoint not found. If you are using Netlify, please ensure your backend server is running and accessible.");
      }
      const text = await res.text();
      throw new Error(`Server error (${res.status}): ${text.slice(0, 100)}...`);
    }
    return await res.text();
  }
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const self = this as any;
    if (self.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(self.state.error?.message || "");
        if (parsed.error) errorMessage = `Firestore Error: ${parsed.error} (${parsed.operationType} on ${parsed.path})`;
      } catch (e) {
        errorMessage = self.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-xl max-w-md w-full border border-red-100">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle className="w-8 h-8" />
              <h2 className="text-xl font-bold">Application Error</h2>
            </div>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return self.props.children;
  }
}

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserType | null>(() => {
    const saved = localStorage.getItem('user');
    const parsed = safeJSONParse(saved);
    if (!parsed) {
      if (saved && saved !== 'null' && saved !== 'undefined') {
        localStorage.removeItem('user');
      }
      return null;
    }
    return parsed;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  const login = (data: AuthResponse) => {
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('token', data.token);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// --- Components ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' | 'icon' }>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const variants = {
      primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
      secondary: "bg-indigo-100 text-indigo-700 hover:bg-indigo-200",
      outline: "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
      ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
      danger: "bg-rose-500 text-white hover:bg-rose-600 shadow-sm",
    };
    const sizes = {
      sm: "px-3 py-1.5 text-xs",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-base",
      icon: "p-2",
    };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all",
        className
      )}
      {...props}
    />
  )
);

const Card = ({ children, className, ...props }: { children: React.ReactNode, className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden", className)} {...props}>
    {children}
  </div>
);

// --- Auth Pages ---

const LoginPage = ({ role }: { role: 'student' | 'warden' | 'security' | 'hod' }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const data = await safeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role }),
      });
      login(data);
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full p-8">
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
          <Building2 className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900">Hostel Pass</h1>
        <p className="text-zinc-500 text-sm mt-1 capitalize">{role} Portal</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-700 ml-1">Login ID</label>
          <Input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your ID" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-700 ml-1">Password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-rose-600 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <Button type="submit" className="w-full h-11" disabled={isLoading}>
          {isLoading ? "Processing..." : "Sign In"}
        </Button>
      </form>
    </Card>
  );
};

// --- Student Dashboard ---

const StudentDashboard = () => {
  const { user, token, logout } = useAuth();
  const [requests, setRequests] = useState<OutpassRequest[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPass, setSelectedPass] = useState<OutpassRequest | null>(null);

  const [formData, setFormData] = useState({
    reason: '',
    outTime: '',
    returnTime: '',
    type: 'outpass' as any,
    photo: '',
    bedNumber: user?.bedNumber || '',
    rollNumber: user?.id || '',
    studentPhone: user?.studentPhone || '',
  });

  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        bedNumber: user.bedNumber || '',
        rollNumber: user.id || '',
        studentPhone: user.studentPhone || '',
        photo: '',
      }));
    }
  }, [user]);

  const [isCapturing, setIsCapturing] = useState(false);
  const [otpStep, setOtpStep] = useState<'form' | 'otp'>('form');
  const [otp, setOtp] = useState('');
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSimulation, setIsSimulation] = useState(false);
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const startCamera = async () => {
    setIsCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access denied", err);
      setIsCapturing(false);
      alert("Could not access camera. Please check permissions.");
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const photo = canvas.toDataURL('image/jpeg', 0.7);
        setFormData({ ...formData, photo });
        stopCamera();
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "requests"),
      where("studentId", "==", user.id),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reqData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OutpassRequest));
      setRequests(reqData);
    }, (err) => handleFirestoreError(err, OperationType.LIST, "requests"));

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (selectedPass) {
      const updatedPass = requests.find(r => r.id === selectedPass.id);
      if (updatedPass && updatedPass.status === 'returned') {
        setSelectedPass(null);
      }
    }
  }, [requests, selectedPass]);

  const handleSendOtp = async () => {
    setIsSendingOtp(true);
    try {
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        setOtpStep('otp');
        if (data.isSimulation) {
          setIsSimulation(true);
          setDebugOtp(data.debugOtp);
        } else {
          setIsSimulation(false);
          setDebugOtp(null);
        }
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to send OTP. Please try again.");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
      alert("Error sending OTP.");
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsOtpVerified(true);
        // Proceed to final submission
        await submitRequest();
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Invalid OTP.");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
      alert("Error verifying OTP.");
    } finally {
      setIsLoading(false);
    }
  };

  const submitRequest = async () => {
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          studentName: user?.name,
          roomNumber: user?.roomNumber,
          parentVerified: true
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsModalOpen(false);
        setOtpStep('form');
        setOtp('');
        setIsOtpVerified(false);
        setFormData({ 
          reason: '', 
          outTime: '', 
          returnTime: '', 
          type: 'outpass' as any, 
          photo: '', 
          bedNumber: user?.bedNumber || '', 
          rollNumber: user?.id || '', 
          studentPhone: user?.studentPhone || '' 
        });
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to submit request.");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
      alert("Error submitting request.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.photo) {
      alert("Please capture your photo to send OTP.");
      return;
    }
    // Instead of direct submit, trigger OTP
    handleSendOtp();
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-zinc-900">Hostel Pass</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-bold text-zinc-900">{user?.name}</p>
              <p className="text-xs text-zinc-500">Room {user?.roomNumber} | Bed {user?.bedNumber}</p>
            </div>
            {user?.name && (
              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                {user.name.charAt(0)}
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={logout}>
              <LogOut className="w-6 h-6" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">My Requests</h1>
            <p className="text-zinc-500 text-sm">Manage your outing permissions</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setIsModalOpen(true)} className="gap-2">
              <Plus className="w-5 h-5" />
              New Request
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          {requests.length === 0 ? (
            <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed border-2">
              <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                <ClipboardList className="w-8 h-8 text-zinc-400" />
              </div>
              <p className="text-zinc-500 font-medium">No requests found</p>
              <p className="text-zinc-400 text-sm mt-1">Submit your first outpass request to get started</p>
            </Card>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-indigo-200 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="flex gap-2 shrink-0">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center",
                      req.status === 'approved' ? "bg-emerald-100 text-emerald-600" :
                      req.status === 'rejected' ? "bg-rose-100 text-rose-600" :
                      "bg-amber-100 text-amber-600"
                    )}>
                      {req.type === 'home_pass' ? <Building2 className="w-6 h-6" /> :
                       <LogOut className="w-6 h-6" />}
                    </div>
                    {req.photo && (
                      <img 
                        src={req.photo} 
                        alt="Verification" 
                        className="w-10 h-10 rounded-xl object-cover border border-zinc-100 shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-zinc-900">{req.reason}</h3>
                      <span className="px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded text-[10px] font-bold uppercase tracking-widest">
                        {req.passId}
                      </span>
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold uppercase tracking-widest">
                        {(req.type || 'outpass').replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Calendar className="w-4 h-4" />
                        {format(parseISO(req.createdAt), 'MMM d, yyyy')}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <span className="font-bold">Roll:</span> {req.rollNumber || 'N/A'}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <span className="font-bold">Bed:</span> {req.bedNumber || 'N/A'}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Clock className="w-4 h-4" />
                        {format(parseISO(req.outTime), 'hh:mm a')} - {format(parseISO(req.returnTime), 'hh:mm a')}
                      </div>
                      {req.type === 'home_pass' && req.status === 'approved' && (
                        <div className={cn(
                          "flex items-center gap-1.5 text-xs font-bold",
                          req.parentsIntimated ? "text-emerald-600" : "text-rose-600"
                        )}>
                          <Phone className="w-4 h-4" />
                          Parents Intimated: {req.parentsIntimated ? 'YES' : 'NO'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    req.status === 'approved' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                    req.status === 'rejected' ? "bg-rose-50 text-rose-700 border border-rose-100" :
                    req.status === 'hod_pending' ? "bg-blue-50 text-blue-700 border border-blue-100" :
                    req.status === 'out' ? "bg-amber-50 text-amber-700 border border-amber-100" :
                    req.status === 'returned' ? "bg-zinc-50 text-zinc-700 border border-zinc-100" :
                    "bg-amber-50 text-amber-700 border border-amber-100"
                  )}>
                    {req.status === 'hod_pending' ? 'Pending Warden Approval' : 
                     req.status === 'pending' ? 'Pending HOD Approval' : 
                     req.status === 'out' ? 'Currently Out' :
                     req.status === 'returned' ? 'Returned' :
                     req.status}
                  </div>
                  {(req.status === 'approved' || req.status === 'out') && (
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setSelectedPass(req)}>
                      <QrCode className="w-5 h-5" />
                      View Pass
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {isModalOpen && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <Card className="w-full max-w-lg p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-zinc-900">
                {otpStep === 'form' ? 'New Outpass Request' : 'Parent Verification'}
              </h2>
              <Button variant="ghost" size="icon" onClick={() => { setIsModalOpen(false); setOtpStep('form'); }}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {otpStep === 'form' ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 ml-1">Request Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'outpass', label: 'Out Pass' },
                      { id: 'home_pass', label: 'Home Pass' },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setFormData({...formData, type: t.id as any})}
                        className={cn(
                          "py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all",
                          formData.type === t.id 
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-md" 
                            : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Roll Number</label>
                    <Input 
                      value={formData.rollNumber} 
                      readOnly
                      className="bg-zinc-50 text-zinc-500 cursor-not-allowed"
                      placeholder="e.g. 25495a0427" 
                      required 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Bed Number</label>
                    <Input 
                      value={formData.bedNumber} 
                      readOnly
                      className="bg-zinc-50 text-zinc-500 cursor-not-allowed"
                      placeholder="e.g. B-12" 
                      required 
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 ml-1">Student Phone Number</label>
                  <Input 
                    value={formData.studentPhone} 
                    readOnly
                    className="bg-zinc-50 text-zinc-500 cursor-not-allowed"
                    placeholder="e.g. 9876543210" 
                    required 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 ml-1">Reason for Request</label>
                  <Input 
                    value={formData.reason} 
                    onChange={(e) => setFormData({...formData, reason: e.target.value})} 
                    placeholder="e.g. Medical Checkup, Shopping, Home Visit" 
                    required 
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Out Time</label>
                    <Input 
                      type="datetime-local" 
                      value={formData.outTime} 
                      onChange={(e) => setFormData({...formData, outTime: e.target.value})} 
                      required 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Return Time</label>
                    <Input 
                      type="datetime-local" 
                      value={formData.returnTime} 
                      onChange={(e) => setFormData({...formData, returnTime: e.target.value})} 
                      required 
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 ml-1">Live Verification Photo</label>
                  <div className="relative aspect-video bg-zinc-900 rounded-2xl overflow-hidden border-4 border-zinc-100 shadow-inner group">
                    {isCapturing ? (
                      <div className="relative w-full h-full">
                        <video 
                          ref={videoRef} 
                          autoPlay 
                          playsInline 
                          className="w-full h-full object-cover scale-x-[-1]" 
                        />
                        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
                          <Button 
                            type="button" 
                            onClick={capturePhoto}
                            className="w-full h-12 bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 text-white font-bold rounded-xl shadow-xl flex items-center justify-center gap-2"
                          >
                            <Camera className="w-5 h-5" />
                            Capture Photo
                          </Button>
                        </div>
                      </div>
                    ) : formData.photo ? (
                      <div className="relative w-full h-full">
                        <img 
                          src={formData.photo} 
                          alt="Captured" 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Button 
                            type="button" 
                            size="sm" 
                            variant="secondary" 
                            className="gap-2"
                            onClick={startCamera}
                          >
                            <RefreshCw className="w-4 h-4" />
                            Retake Photo
                          </Button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-emerald-600/80 text-white text-[10px] font-bold py-2 uppercase tracking-widest text-center backdrop-blur-sm">
                          Photo Captured Successfully
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
                          <Camera className="w-8 h-8 text-white/40" />
                        </div>
                        <Button 
                          type="button" 
                          onClick={startCamera}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 py-3 shadow-lg flex items-center gap-2"
                        >
                          <Camera className="w-5 h-5" />
                          Start Camera
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="flex-1" disabled={isSendingOtp || !formData.photo}>
                    {isSendingOtp ? "Sending OTP..." : "Request Parent OTP"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldQuestion className="w-8 h-8" />
                  </div>
                  <p className="text-zinc-600 text-sm">
                    An OTP has been sent to your parent's registered mobile number <b>8985990133</b>. Please enter it below to verify.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-700 ml-1">Enter 6-digit OTP</label>
                  <Input 
                    type="text" 
                    maxLength={6}
                    value={otp} 
                    onChange={(e) => setOtp(e.target.value)} 
                    placeholder="000000"
                    className="text-center text-2xl tracking-[0.5em] font-bold h-14"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <Button 
                    onClick={handleVerifyOtp} 
                    className="w-full h-12 text-lg" 
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? "Verifying..." : "Verify & Submit"}
                  </Button>
                  {isSimulation && (
                    <Button 
                      variant="outline" 
                      className="w-full border-dashed border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                      onClick={() => {
                        if (debugOtp) {
                          setOtp(debugOtp);
                          alert(`Demo Mode: OTP ${debugOtp} auto-filled. Click 'Verify & Submit' to proceed.`);
                        }
                      }}
                    >
                      Skip Verification (Demo Mode)
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    onClick={() => setOtpStep('form')} 
                    disabled={isLoading}
                  >
                    Back to Form
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {selectedPass && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <Card className="w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-indigo-600 p-6 text-center text-white relative">
              <div className="absolute top-4 right-4 opacity-20 font-black text-2xl tracking-tighter">
                {selectedPass.passId}
              </div>
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-xl font-bold">Approved Outpass</h2>
              <p className="text-indigo-100 text-sm opacity-80">Valid for single exit/entry</p>
            </div>
            <div className="p-8 flex flex-col items-center">
              {selectedPass.photo && (
                <div className="w-32 h-32 rounded-2xl overflow-hidden border-4 border-white shadow-lg mb-6">
                  <img src={selectedPass.photo} alt="Student" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
              )}
              <div className="bg-white p-4 rounded-2xl border-2 border-zinc-100 mb-6 shadow-sm">
                <QRCodeSVG 
                  value={JSON.stringify({ 
                    id: selectedPass.id, 
                    studentId: selectedPass.studentId,
                    validUntil: selectedPass.returnTime 
                  })} 
                  size={160} 
                  level="H"
                />
              </div>
              
              <div className="w-full space-y-4 text-sm">
                <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                  <span className="text-zinc-400 font-medium">Student</span>
                  <span className="font-bold text-zinc-900">{selectedPass.studentName}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                  <span className="text-zinc-400 font-medium">Roll Number</span>
                  <span className="font-bold text-zinc-900">{selectedPass.rollNumber || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                  <span className="text-zinc-400 font-medium">Phone</span>
                  <span className="font-bold text-zinc-900">{selectedPass.studentPhone || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                  <span className="text-zinc-400 font-medium">Room / Bed</span>
                  <span className="font-bold text-zinc-900">{selectedPass.roomNumber} / {selectedPass.bedNumber || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                  <span className="text-zinc-400 font-medium">Out Time</span>
                  <span className="font-bold text-zinc-900">{format(parseISO(selectedPass.outTime), 'MMM d, hh:mm a')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-medium">Return Time</span>
                  <span className="font-bold text-zinc-900">{format(parseISO(selectedPass.returnTime), 'MMM d, hh:mm a')}</span>
                </div>
              </div>

              <Button variant="primary" className="w-full mt-8" onClick={() => setSelectedPass(null)}>
                Close Pass
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// --- Warden Photo Capture Modal ---

const WardenPhotoModal = ({ isOpen, onClose, onCapture, isHomePass, parentPhone, studentLivePhoto }: { isOpen: boolean, onClose: () => void, onCapture: (photo: string, parentsIntimated?: boolean) => void, isHomePass?: boolean, parentPhone?: string, studentLivePhoto?: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parentsIntimated, setParentsIntimated] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      startCamera();
      setParentsIntimated(false);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err) {
      setError("Could not access camera");
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const photo = canvas.toDataURL('image/jpeg', 0.7);
        onCapture(photo, parentsIntimated);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <Card className="w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="font-bold text-zinc-900">Warden Verification</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-5 h-5" />
          </Button>
        </div>
        <div className="p-6">
          <div className="flex justify-center gap-4 mb-6">
            {studentLivePhoto && (
              <div className="flex flex-col items-center gap-1">
                <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-indigo-100 shadow-sm">
                  <img src={studentLivePhoto} alt="Live" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
                <span className="text-[8px] font-bold text-indigo-600 uppercase tracking-widest">Live</span>
              </div>
            )}
          </div>

          <p className="text-sm text-zinc-500 mb-4 text-center">Please capture your photo to approve this request.</p>
          <div className="aspect-video bg-zinc-900 rounded-2xl overflow-hidden relative mb-6 border-4 border-zinc-100 shadow-inner">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-rose-50/90 p-4 text-center">
                <p className="text-rose-600 text-sm font-medium">{error}</p>
              </div>
            )}
          </div>

          {isHomePass && (
            <div className="mb-6 p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                  <Phone className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-zinc-900">Intimate Parents?</p>
                  <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">Home Pass Requirement</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {parentPhone && (
                  <a 
                    href={`tel:${parentPhone}`}
                    className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center hover:bg-emerald-100 transition-all shadow-sm border border-emerald-100"
                    title="Call Parent"
                  >
                    <Phone className="w-5 h-5" />
                  </a>
                )}
                <div className="flex bg-white p-1 rounded-xl border border-zinc-200">
                  <button 
                    onClick={() => setParentsIntimated(true)}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                      parentsIntimated ? "bg-indigo-600 text-white shadow-md" : "text-zinc-500 hover:bg-zinc-50"
                    )}
                  >
                    Yes
                  </button>
                  <button 
                    onClick={() => setParentsIntimated(false)}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                      !parentsIntimated ? "bg-rose-600 text-white shadow-md" : "text-zinc-500 hover:bg-zinc-50"
                    )}
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button variant="primary" className="flex-1 gap-2" onClick={() => {
              if (videoRef.current && canvasRef.current) {
                const video = videoRef.current;
                const canvas = canvasRef.current;
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const photo = canvas.toDataURL('image/jpeg', 0.7);
                  onCapture(photo, parentsIntimated);
                }
              }
            }} disabled={!!error}>
              <Camera className="w-4 h-4" />
              Capture & Approve
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

// --- Warden Dashboard ---

const playNotificationSound = async () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    const playBeep = (freq: number, startTime: number, duration: number) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, startTime);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    // Play a sequence of "Ding-Dong" sounds to last ~5 seconds
    const now = audioCtx.currentTime;
    for (let i = 0; i < 7; i++) {
      const offset = i * 0.75;
      playBeep(880, now + offset, 0.4); // High note
      playBeep(660, now + offset + 0.2, 0.6); // Lower note
    }
  } catch (e) {
    console.error("Audio playback failed:", e);
  }
};

const HODDashboard = () => {
  const { user, token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'requests' | 'reports'>('requests');
  const [requests, setRequests] = useState<OutpassRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [requestFilter, setRequestFilter] = useState<RequestStatus | 'all'>('all');
  const [isHODPhotoModalOpen, setIsHODPhotoModalOpen] = useState(false);
  const [requestToApprove, setRequestToApprove] = useState<string | null>(null);

  const fetchData = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch('/api/requests/all', { headers });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setRequests(data);
      } else if (!res.ok) {
        // If it's a JSON error from handleFirestoreError, throw it so ErrorBoundary can catch it
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        throw new Error(data.message || "Failed to fetch data");
      }
    } catch (err: any) {
      console.error("Fetch data error:", err);
      // Re-throw to be caught by ErrorBoundary if it's a critical error
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!token || !db) return;
    
    const q = query(
      collection(db, "requests"),
      where("status", "==", "pending")
    );

    let isInitial = true;
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (isInitial) {
        isInitial = false;
        return;
      }
      
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          playNotificationSound();
          fetchData();
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "requests");
    });

    return () => unsubscribe();
  }, [token]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const pendingCount = requests.filter(r => r.status === 'pending').length;
      if (pendingCount > 0) {
        playNotificationSound();
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [requests]);

  const handleRequestAction = async (id: string, status: RequestStatus, remarks?: string, hodPhoto?: string) => {
    if (status === 'hod_pending' && !hodPhoto) {
      setRequestToApprove(id);
      setIsHODPhotoModalOpen(true);
      return;
    }

    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, hodRemarks: remarks, hodPhoto }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchData();
        setIsHODPhotoModalOpen(false);
        setRequestToApprove(null);
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        throw new Error(data.message || "Failed to update request");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const filteredRequests = requests.filter(r => 
    (requestFilter === 'all' ? (r.status === 'pending' || r.status === 'hod_pending' || r.status === 'approved' || r.status === 'rejected') : r.status === requestFilter) &&
    (r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) || r.roomNumber.includes(searchTerm))
  );

  return (
    <div className="min-h-screen bg-[#F8F9FC] flex font-sans">
      {/* Sidebar */}
      <aside className={cn(
        "bg-white border-r border-zinc-100 transition-all duration-300 flex flex-col z-40",
        isSidebarOpen ? "w-72" : "w-20"
      )}>
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-100">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          {isSidebarOpen && <span className="font-black text-xl text-zinc-900 tracking-tighter uppercase">HOD Panel</span>}
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-4">
          {[
            { id: 'requests', label: 'Approvals', icon: CheckCircle2 },
            { id: 'reports', label: 'Reports', icon: BarChart3 },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all group",
                activeTab === item.id 
                  ? "bg-indigo-50 text-indigo-600" 
                  : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
              )}
            >
              <item.icon className={cn("w-6 h-6", activeTab === item.id ? "text-indigo-600" : "text-zinc-400 group-hover:text-zinc-600")} />
              {isSidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-50">
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-rose-500 hover:bg-rose-50 transition-all"
          >
            <LogOut className="w-6 h-6" />
            {isSidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-20 bg-white border-b border-zinc-100 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              <Menu className="w-6 h-6" />
            </Button>
            <h2 className="text-xl font-bold text-zinc-900 capitalize">{activeTab}</h2>
          </div>
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={playNotificationSound}
              className="hidden sm:flex items-center gap-2 border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            >
              <Volume2 className="w-4 h-4" />
              <span>Test Sound</span>
            </Button>
            <div className="text-right">
              <p className="text-sm font-bold text-zinc-900">{user?.name}</p>
              <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Head of Department</p>
            </div>
            {user?.name && (
              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                {user.name.charAt(0)}
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'requests' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <Input 
                    placeholder="Search by student name or room..." 
                    className="pl-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-zinc-400 mr-1" />
                  {(['all', 'pending', 'hod_pending', 'approved', 'rejected'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setRequestFilter(f)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all",
                        requestFilter === f ? "bg-indigo-600 text-white" : "bg-white text-zinc-500 border border-zinc-200 hover:border-zinc-300"
                      )}
                    >
                      {f === 'hod_pending' ? 'HOD Approved' : f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                {filteredRequests.map((req) => (
                  <div key={req.id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                      <div className="flex items-start gap-4">
                        <div className="flex gap-2 shrink-0">
                          {req.photo ? (
                            <div className="relative group">
                              <img 
                                src={req.photo} 
                                alt="Verification" 
                                className="w-28 h-28 rounded-2xl object-cover border-2 border-indigo-100 shadow-sm"
                                referrerPolicy="no-referrer"
                              />
                              <span className="absolute -bottom-1 -right-1 bg-indigo-600 text-white text-[8px] px-1 rounded font-bold opacity-0 group-hover:opacity-100 transition-opacity">Live</span>
                            </div>
                          ) : (
                            <div className="w-28 h-28 bg-zinc-100 rounded-2xl flex items-center justify-center">
                              <User className="w-10 h-10 text-zinc-400" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="font-bold text-zinc-900 text-lg">{req.studentName}</h3>
                            <span className="px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[10px] font-bold uppercase tracking-widest">
                              {req.passId}
                            </span>
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                              Room {req.roomNumber} - Bed {req.bedNumber || 'N/A'}
                            </span>
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                              Roll: {req.rollNumber || 'N/A'}
                            </span>
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                              Phone: {req.studentPhone || 'N/A'}
                            </span>
                          </div>
                          <p className="text-zinc-500 text-sm mt-1">{req.reason}</p>
                          <div className="flex items-center gap-4 mt-3">
                            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                              <Clock className="w-3.5 h-3.5" />
                              {format(parseISO(req.outTime), 'MMM d, hh:mm a')} - {format(parseISO(req.returnTime), 'hh:mm a')}
                            </div>
                            {req.parentPhone && (
                              <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Parent: {req.parentPhone}
                              </div>
                            )}
                            {req.type === 'home_pass' && req.status === 'approved' && (
                              <div className={cn(
                                "flex items-center gap-1.5 text-xs font-bold",
                                req.parentsIntimated ? "text-emerald-600" : "text-rose-600"
                              )}>
                                <Phone className="w-3.5 h-3.5" />
                                Parents Intimated: {req.parentsIntimated ? 'YES' : 'NO'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {req.status === 'pending' ? (
                          <>
                            <Button variant="danger" size="sm" className="gap-2" onClick={() => handleRequestAction(req.id, 'rejected')}>
                              <XCircle className="w-5 h-5" />
                              Reject
                            </Button>
                            <Button variant="primary" size="sm" className="gap-2" onClick={() => handleRequestAction(req.id, 'hod_pending')}>
                              <CheckCircle2 className="w-5 h-5" />
                              Approve
                            </Button>
                          </>
                        ) : (
                          <div className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold",
                            (req.status === 'approved' || req.status === 'hod_pending') ? "bg-emerald-50 text-emerald-700" : 
                            req.status === 'out' ? "bg-amber-50 text-amber-700" :
                            req.status === 'returned' ? "bg-zinc-50 text-zinc-700" :
                            "bg-rose-50 text-rose-700"
                          )}>
                            {(req.status === 'approved' || req.status === 'hod_pending') ? <CheckCircle2 className="w-5 h-5" /> : 
                             req.status === 'out' ? <LogOut className="w-5 h-5" /> :
                             req.status === 'returned' ? <CheckCircle2 className="w-5 h-5" /> :
                             <XCircle className="w-5 h-5" />}
                            <span className="capitalize">
                              {req.status === 'hod_pending' ? 'HOD Approved' : 
                               req.status === 'out' ? 'Currently Out' :
                               req.status}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {filteredRequests.length === 0 && (
                  <div className="p-12 text-center bg-white rounded-3xl border border-dashed border-zinc-200">
                    <ClipboardList className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                    <p className="text-zinc-500 font-bold">No requests found</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* HOD Photo Modal */}
      {isHODPhotoModalOpen && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <Card className="w-full max-w-md p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-zinc-900">HOD Verification</h2>
              <Button variant="ghost" size="icon" onClick={() => setIsHODPhotoModalOpen(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="space-y-6">
              <p className="text-zinc-500 text-sm">Please capture a photo to confirm your approval.</p>
              <div className="relative aspect-video bg-zinc-100 rounded-2xl overflow-hidden border border-zinc-200">
                <HODPhotoCapture onCapture={(photo) => {
                  if (requestToApprove) {
                    handleRequestAction(requestToApprove, 'hod_pending', undefined, photo);
                  }
                }} />
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

const HODPhotoCapture = ({ onCapture }: { onCapture: (photo: string) => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCapturing(true);
      }
    } catch (err) {
      console.error(err);
      alert("Could not access camera");
    }
  };

  const capture = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(videoRef.current, 0, 0);
      const photo = canvas.toDataURL('image/jpeg');
      
      // Stop camera
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      
      onCapture(photo);
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="w-full h-full relative">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <div className="absolute bottom-4 left-0 right-0 flex justify-center">
        <Button onClick={capture} variant="primary" className="gap-2">
          <Camera className="w-4 h-4" />
          Capture & Approve
        </Button>
      </div>
    </div>
  );
};

const WardenDashboard = () => {
  const { user, token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'occupancy' | 'requests' | 'students' | 'reports' | 'scanner' | 'live'>('occupancy');
  const [requests, setRequests] = useState<OutpassRequest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [students, setStudents] = useState<UserType[]>([]);
  const [roomChecks, setRoomChecks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [scannedRequest, setScannedRequest] = useState<OutpassRequest | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [isActuallyScanning, setIsActuallyScanning] = useState(false);
  const [cameraMode, setCameraMode] = useState<'environment' | 'user'>('environment');
  const [manualId, setManualId] = useState('');
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);

  const [requestFilter, setRequestFilter] = useState<RequestStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<'all' | 'ground' | 'second' | 'third'>('all');
  const [isAddRoomModalOpen, setIsAddRoomModalOpen] = useState(false);
  const [isRoomCheckModalOpen, setIsRoomCheckModalOpen] = useState(false);
  const [isRoomHistoryModalOpen, setIsRoomHistoryModalOpen] = useState(false);
  const [roomCheckData, setRoomCheckData] = useState({ roomNumber: '', presentCount: 0, onlineCount: 0, checkType: 'morning' as any });
  const [newRoomData, setNewRoomData] = useState({ roomNumber: '', capacity: 4 });
  const [isAssigningStudent, setIsAssigningStudent] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<UserType | null>(null);
  const [isWardenPhotoModalOpen, setIsWardenPhotoModalOpen] = useState(false);
  const [requestToApprove, setRequestToApprove] = useState<string | null>(null);
  const [studentPage, setStudentPage] = useState(1);
  const [editingStudent, setEditingStudent] = useState<UserType | null>(null);
  const [editFormData, setEditFormData] = useState({ name: '', roomNumber: '', bedNumber: '', studentPhone: '' });
  const studentsPerPage = 50;

  const fetchData = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const [reqRes, roomRes, studentRes, checkRes] = await Promise.all([
        fetch('/api/requests/all', { headers }),
        fetch('/api/rooms', { headers }),
        fetch('/api/students', { headers }),
        fetch('/api/room-checks/latest', { headers })
      ]);

      const parseRes = async (res: Response) => {
        const contentType = res.headers.get("content-type");
        let data;
        if (contentType && contentType.includes("application/json")) {
          data = await res.json();
        } else {
          const text = await res.text();
          console.error(`Expected JSON from ${res.url} but got:`, text.substring(0, 100));
          return null;
        }

        if (!res.ok) {
          if (data && data.error && data.operationType) {
            throw new Error(JSON.stringify(data));
          }
          throw new Error(data?.message || `Request to ${res.url} failed with status ${res.status}`);
        }
        return data;
      };

      const reqData = await parseRes(reqRes);
      const roomData = await parseRes(roomRes);
      const studentData = await parseRes(studentRes);
      const checkData = await parseRes(checkRes);

      if (reqData && Array.isArray(reqData)) setRequests(reqData);
      if (roomData && Array.isArray(roomData)) setRooms(roomData);
      if (studentData && Array.isArray(studentData)) setStudents(studentData);
      if (checkData && Array.isArray(checkData)) setRoomChecks(checkData);
    } catch (err: any) {
      console.error("Fetch data error:", err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!token || !db) return;
    
    const q = query(
      collection(db, "requests"),
      where("status", "==", "hod_pending")
    );

    let isInitial = true;
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (isInitial) {
        isInitial = false;
        return;
      }
      
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          playNotificationSound();
          fetchData();
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "requests");
    });

    return () => unsubscribe();
  }, [token]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const pendingCount = requests.filter(r => r.status === 'hod_pending').length;
      if (pendingCount > 0) {
        playNotificationSound();
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [requests]);

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent || !token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/students/${editingStudent.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editFormData)
      });
      const data = await res.json();
      if (res.ok) {
        alert("Student details updated successfully");
        setEditingStudent(null);
        fetchData();
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to update student");
      }
    } catch (err: any) {
      console.error("Update student error:", err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
      alert("Network error updating student");
    } finally {
      setIsLoading(false);
    }
  };

  const startScanner = async () => {
    if (isTransitioningRef.current) return;
    const readerElement = document.getElementById("warden-reader");
    if (!readerElement) return;

    isTransitioningRef.current = true;
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.stop();
        setIsActuallyScanning(false);
      }

      const scanner = new Html5Qrcode("warden-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: cameraMode },
        { 
          fps: 20, 
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdgeSize * 0.7);
            return {
              width: qrboxSize,
              height: qrboxSize
            };
          },
          aspectRatio: 1.0
        },
        async (decodedText) => {
          const parsed = safeJSONParse(decodedText);
          if (parsed && parsed.id) {
            setIsScanning(false);
            setIsActuallyScanning(false);
            
            // Stop scanner
            if (scannerRef.current && scannerRef.current.isScanning) {
              await scannerRef.current.stop();
            }

            try {
              const res = await fetch(`/api/requests/verify/${parsed.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const request = await res.json();
              if (res.ok) {
                setScannedRequest(request);
              } else {
                if (request.error && request.operationType) {
                  throw new Error(JSON.stringify(request));
                }
                alert(request.message || "Invalid QR Code");
                setIsScanning(true);
              }
            } catch (err: any) {
              console.error(err);
              if (err.message && err.message.includes('"operationType"')) {
                throw err;
              }
              alert("Network error verifying QR code");
              setIsScanning(true);
            }
          }
        },
        (err) => {
          // Silent error for scanning
        }
      );
      setIsActuallyScanning(true);
      setScannerError('');
    } catch (err) {
      console.error("Warden scanner error:", err);
      setScannerError("Could not access camera. Please check permissions.");
      setIsActuallyScanning(false);
    } finally {
      isTransitioningRef.current = false;
    }
  };

  const toggleCamera = async () => {
    if (isTransitioningRef.current) return;
    const newMode = cameraMode === 'environment' ? 'user' : 'environment';
    setCameraMode(newMode);
    if (scannerRef.current && scannerRef.current.isScanning) {
      isTransitioningRef.current = true;
      try {
        await scannerRef.current.stop();
        setIsActuallyScanning(false);
        // Small delay before restart
        setTimeout(() => startScanner(), 100);
      } catch (err) {
        console.error("Failed to stop scanner for toggle", err);
      } finally {
        isTransitioningRef.current = false;
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'scanner' && isScanning && !scannedRequest) {
      const timer = setTimeout(() => {
        startScanner();
      }, 1000);
      return () => {
        clearTimeout(timer);
        if (scannerRef.current && scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(e => console.error("Failed to stop warden scanner", e));
        }
      };
    } else if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current.stop().catch(e => console.error("Failed to stop warden scanner", e));
    }
  }, [activeTab, isScanning, scannedRequest, token]);

  const getLiveStatus = (roomNumber: string) => {
    const room = rooms.find(r => r.roomNumber === roomNumber);
    if (!room) return { in: 0, out: 0, total: 0, outStudents: [] };
    
    const now = new Date();
    const outStudents = requests.filter(req => 
      req.roomNumber === roomNumber && 
      (req.status === 'out' || (req.status === 'approved' && isAfter(now, parseISO(req.outTime)) && isBefore(now, parseISO(req.returnTime))))
    );
    
    const outCount = outStudents.length;
    const totalOccupants = room.occupants.length;
    const inCount = Math.max(0, totalOccupants - outCount);
    
    return { in: inCount, out: outCount, total: totalOccupants, outStudents };
  };

  const handleRequestAction = async (id: string, status: RequestStatus, remarks?: string, wardenPhoto?: string, parentsIntimated?: boolean) => {
    if (status === 'approved' && !wardenPhoto) {
      setRequestToApprove(id);
      setIsWardenPhotoModalOpen(true);
      return;
    }

    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, remarks, wardenPhoto, parentsIntimated }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchData();
        setIsWardenPhotoModalOpen(false);
        setRequestToApprove(null);
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        throw new Error(data.message || "Failed to update request");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newRoomData),
      });
      const data = await res.json();
      if (res.ok) {
        setIsAddRoomModalOpen(false);
        setNewRoomData({ roomNumber: '', capacity: 4 });
        fetchData();
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to add room");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const handleRoomCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCheckData.presentCount < roomCheckData.onlineCount) {
      alert("Invalid Data: Present members cannot be less than online members.");
      return;
    }
    try {
      const res = await fetch('/api/room-checks', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(roomCheckData),
      });
      const data = await res.json();
      if (res.ok) {
        setIsRoomCheckModalOpen(false);
        setRoomCheckData({ roomNumber: '', presentCount: 0, onlineCount: 0, checkType: 'morning' });
        fetchData();
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to record room check");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const handleRoomOccupantAction = async (roomNumber: string, studentId: string, action: 'add' | 'remove') => {
    try {
      const res = await fetch(`/api/rooms/${roomNumber}/occupants`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ studentId, action }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchData();
        // Update selected room state to reflect changes
        if (selectedRoom) {
          const updatedOccupants = action === 'add' 
            ? [...selectedRoom.occupants, studentId]
            : selectedRoom.occupants.filter(id => id !== studentId);
          setSelectedRoom({ ...selectedRoom, occupants: updatedOccupants });
        }
        setIsAssigningStudent(false);
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to update occupants");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const handleToggleOnline = async (roomNumber: string, studentId: string, isOnline: boolean) => {
    try {
      const res = await fetch(`/api/rooms/${roomNumber}/online`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ studentId, isOnline }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchData();
        if (selectedRoom) {
          const updatedOnline = isOnline 
            ? [...(selectedRoom.onlineStudents || []), studentId]
            : (selectedRoom.onlineStudents || []).filter(id => id !== studentId);
          setSelectedRoom({ ...selectedRoom, onlineStudents: updatedOnline });
        }
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to update online status");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const handleSeedOnline = async () => {
    try {
      const res = await fetch('/api/rooms/seed-online', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`
        },
      });
      const data = await res.json();
      if (res.ok) {
        fetchData();
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        alert(data.message || "Failed to seed online status");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  const outingTrends = React.useMemo(() => {
    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return format(d, 'EEE');
    }).reverse();

    const counts = last7Days.reduce((acc, day) => ({ ...acc, [day]: 0 }), {} as Record<string, number>);

    requests.forEach(req => {
      const reqDate = parseISO(req.createdAt);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - reqDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays < 7) {
        const day = format(reqDate, 'EEE');
        if (counts[day] !== undefined) {
          counts[day]++;
        }
      }
    });

    return last7Days.map(day => ({ day, count: counts[day] }));
  }, [requests]);

  const menuItems = [
    { id: 'occupancy', label: 'Room Occupancy', icon: Building2 },
    { id: 'requests', label: 'Outpass Requests', icon: ClipboardList },
    { id: 'students', label: 'Student Directory', icon: Users },
    { id: 'reports', label: 'Analytics & Reports', icon: BarChart3 },
    { id: 'scanner', label: 'Security Scanner', icon: Camera },
  ];

  const totalOut = requests.filter(r => r.status === 'out').length;
  const totalInHostel = students.length - totalOut;
  const totalOnlineInRooms = rooms.reduce((acc, room) => acc + (room.onlineStudents?.length || 0), 0);
  const totalExtra = roomChecks.reduce((acc, check) => acc + check.extraCount, 0);

  const getLatestCheck = (roomNumber: string) => {
    return roomChecks.find(c => c.roomNumber === roomNumber);
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex">
      <aside className={cn(
        "bg-zinc-900 text-white transition-all duration-300 fixed inset-y-0 left-0 z-50 lg:relative",
        isSidebarOpen ? "w-64" : "w-0 lg:w-20 overflow-hidden"
      )}>
        <div className="h-16 flex items-center px-6 border-b border-zinc-800">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          {isSidebarOpen && <span className="ml-3 font-bold text-lg">Warden Hub</span>}
        </div>

        <nav className="p-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                activeTab === item.id 
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/20" 
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              )}
            >
              <item.icon className="w-7 h-7 shrink-0" />
              {isSidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="absolute bottom-4 left-0 right-0 px-4">
          <button 
            onClick={logout}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all",
              !isSidebarOpen && "justify-center"
            )}
          >
            <LogOut className="w-7 h-7 shrink-0" />
            {isSidebarOpen && <span className="font-medium text-sm">Sign Out</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-zinc-100 flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-zinc-100 rounded-lg lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="font-bold text-zinc-900 capitalize">{(activeTab || '').replace('-', ' ')}</h2>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={playNotificationSound}
              className="hidden sm:flex items-center gap-2 border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            >
              <Volume2 className="w-4 h-4" />
              <span>Test Sound</span>
            </Button>
            <div className="text-right">
              <p className="text-sm font-bold text-zinc-900">{user?.name}</p>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Chief Warden</p>
            </div>
            {user?.name && (
              <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center border border-zinc-200 font-bold text-zinc-600">
                {user.name.charAt(0)}
              </div>
            )}
          </div>
        </header>

        <div className="p-6 lg:p-8 max-w-7xl mx-auto w-full">
          <WardenPhotoModal 
            isOpen={isWardenPhotoModalOpen} 
            onClose={() => {
              setIsWardenPhotoModalOpen(false);
              setRequestToApprove(null);
            }}
            isHomePass={requests.find(r => r.id === requestToApprove)?.type === 'home_pass'}
            parentPhone={requests.find(r => r.id === requestToApprove)?.parentPhone}
            studentLivePhoto={requests.find(r => r.id === requestToApprove)?.photo}
            onCapture={(photo, parentsIntimated) => {
              if (requestToApprove) {
                handleRequestAction(requestToApprove, 'approved', undefined, photo, parentsIntimated);
              }
            }}
          />
          {activeTab === 'occupancy' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h3 className="text-2xl font-black text-zinc-900 uppercase tracking-tight">Room Allocation</h3>
                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
                  {[
                    { id: 'all', label: 'All Floors' },
                    { id: 'ground', label: 'Ground (1-100)' },
                    { id: 'second', label: 'Second (101-200)' },
                    { id: 'third', label: 'Third (201-300)' },
                  ].map((floor) => (
                    <button
                      key={floor.id}
                      onClick={() => setSelectedFloor(floor.id as any)}
                      className={cn(
                        "px-4 py-2 text-sm font-bold rounded-xl whitespace-nowrap transition-all",
                        selectedFloor === floor.id 
                          ? "bg-indigo-600 text-white shadow-md" 
                          : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
                      )}
                    >
                      {floor.label}
                    </button>
                  ))}
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <Button onClick={handleSeedOnline} variant="ghost" size="sm" className="gap-2 text-zinc-500 hover:text-indigo-600">
                      <BarChart3 className="w-6 h-6" />
                      Randomize Online
                    </Button>
                    <Button onClick={() => setIsRoomCheckModalOpen(true)} variant="primary" size="sm" className="gap-2">
                      <UserCheck className="w-6 h-6" />
                      Record Check
                    </Button>
                    <Button onClick={() => setIsAddRoomModalOpen(true)} variant="outline" size="sm" className="gap-2">
                      <Plus className="w-6 h-6" />
                      Add Room
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                {[
                  { label: 'Total Rooms', value: rooms.length, icon: Building2, color: 'indigo' },
                  { label: 'Occupied', value: rooms.filter(r => r.occupants.length > 0).length, icon: UserCheck, color: 'emerald' },
                  { label: 'Available', value: rooms.filter(r => r.occupants.length === 0).length, icon: UserMinus, color: 'amber' },
                  { label: 'Total Students', value: students.length, icon: Users, color: 'blue' },
                  { label: 'In Hostel', value: totalInHostel, icon: MapPin, color: 'emerald' },
                  { label: 'Online in Rooms', value: totalOnlineInRooms, icon: Building2, color: 'indigo' },
                  { label: 'Total Extra', value: totalExtra, icon: AlertCircle, color: 'rose' },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className={cn("p-4 rounded-2xl", stat.color === 'indigo' ? "bg-indigo-50 text-indigo-600" : stat.color === 'emerald' ? "bg-emerald-50 text-emerald-600" : stat.color === 'amber' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600")}>
                        <stat.icon className="w-8 h-8" />
                      </div>
                    </div>
                    <p className="text-4xl font-black text-zinc-900">{stat.value}</p>
                    <p className="text-xs text-zinc-400 mt-2 font-bold uppercase tracking-widest">{stat.label}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
                {rooms
                  .filter(room => {
                    const num = parseInt(room.roomNumber);
                    if (selectedFloor === 'ground') return num >= 1 && num <= 100;
                    if (selectedFloor === 'second') return num >= 101 && num <= 200;
                    if (selectedFloor === 'third') return num >= 201 && num <= 300;
                    return true;
                  })
                  .map((room) => {
                    const onlineCount = room.onlineStudents?.length || 0;
                    const offlineCount = room.occupants.length - onlineCount;
                    return (
                      <div 
                        key={room.roomNumber} 
                        onClick={() => setSelectedRoom(room)}
                        className={cn(
                          "bg-white rounded-3xl border border-zinc-100 shadow-md overflow-hidden p-8 text-center border-2 transition-all cursor-pointer hover:scale-105 relative",
                          room.occupants.length === room.capacity ? "border-rose-100 bg-rose-50/30" :
                          room.occupants.length > 0 ? "border-indigo-100 bg-indigo-50/30" :
                          "border-zinc-100 hover:border-indigo-200"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                              {parseInt(room.roomNumber) <= 100 ? 'Ground' : parseInt(room.roomNumber) <= 200 ? 'Second' : 'Third'}
                            </p>
                            {getLatestCheck(room.roomNumber)?.extraCount > 0 && (
                              <div className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[8px] font-black rounded uppercase tracking-tighter animate-pulse">
                                Extra: {getLatestCheck(room.roomNumber).extraCount}
                              </div>
                            )}
                          </div>
                          {onlineCount > 0 && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span className="text-xs font-black text-emerald-600 uppercase tracking-tighter">{onlineCount} Online</span>
                            </div>
                          )}
                        </div>
                        <p className="text-6xl font-black text-zinc-900 tracking-tighter">{room.roomNumber}</p>
                        <div className="flex items-center justify-center gap-4 mt-8">
                          {[...Array(room.capacity)].map((_, i) => {
                            const isOccupied = i < room.occupants.length;
                            const isOnline = isOccupied && room.onlineStudents?.includes(room.occupants[i]);
                            return (
                              <div 
                                key={i} 
                                className={cn(
                                  "w-10 h-16 rounded-full transition-all",
                                  isOnline ? "bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.7)]" : isOccupied ? "bg-indigo-600" : "bg-zinc-200"
                                )} 
                              />
                            );
                          })}
                        </div>
                        <p className="text-sm font-bold text-zinc-500 mt-6">
                          {room.occupants.length}/{room.capacity} Occupied
                        </p>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Room History Modal */}
          {isRoomHistoryModalOpen && selectedRoom && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <Card className="w-full max-w-lg p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900">Room {selectedRoom.roomNumber} History</h2>
                    <p className="text-zinc-500 text-sm">Physical check records</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setIsRoomHistoryModalOpen(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                
                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                  {roomChecks
                    .filter(c => c.roomNumber === selectedRoom.roomNumber)
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((check, i) => (
                      <div key={i} className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{check.checkType}</span>
                          <span className="text-[10px] font-bold text-zinc-500">{format(parseISO(check.createdAt), 'MMM d, hh:mm a')}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-[8px] text-zinc-400 font-bold uppercase">Present</p>
                            <p className="text-sm font-bold text-zinc-900">{check.presentCount}</p>
                          </div>
                          <div>
                            <p className="text-[8px] text-zinc-400 font-bold uppercase">Online</p>
                            <p className="text-sm font-bold text-zinc-900">{check.onlineCount}</p>
                          </div>
                          <div>
                            <p className="text-[8px] text-rose-400 font-bold uppercase">Extra</p>
                            <p className="text-sm font-bold text-rose-600">{check.extraCount}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  {roomChecks.filter(c => c.roomNumber === selectedRoom.roomNumber).length === 0 && (
                    <div className="text-center py-12 text-zinc-400">
                      <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p>No check history available</p>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* Room Check Modal */}
          {isRoomCheckModalOpen && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <Card className="w-full max-w-md p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-zinc-900">Record Room Check</h2>
                  <Button variant="ghost" size="icon" onClick={() => setIsRoomCheckModalOpen(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <form onSubmit={handleRoomCheck} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Room Number</label>
                    <select 
                      className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={roomCheckData.roomNumber}
                      onChange={(e) => setRoomCheckData({...roomCheckData, roomNumber: e.target.value})}
                      required
                    >
                      <option value="">Select Room</option>
                      {rooms.map(r => (
                        <option key={r.roomNumber} value={r.roomNumber}>{r.roomNumber}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 ml-1">Present Members</label>
                      <Input 
                        type="number"
                        value={roomCheckData.presentCount} 
                        onChange={(e) => setRoomCheckData({...roomCheckData, presentCount: parseInt(e.target.value)})} 
                        min="0"
                        max="10"
                        required 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 ml-1">Online Class</label>
                      <Input 
                        type="number"
                        value={roomCheckData.onlineCount} 
                        onChange={(e) => setRoomCheckData({...roomCheckData, onlineCount: parseInt(e.target.value)})} 
                        min="0"
                        max="10"
                        required 
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Check Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['morning', 'afternoon', 'evening'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setRoomCheckData({...roomCheckData, checkType: t as any})}
                          className={cn(
                            "py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all",
                            roomCheckData.checkType === t 
                              ? "bg-indigo-600 text-white border-indigo-600" 
                              : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300"
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-2">
                    <div className="flex justify-between text-xs font-medium text-zinc-500">
                      <span>Extra Members</span>
                      <span className={cn(
                        "font-bold",
                        roomCheckData.presentCount < roomCheckData.onlineCount ? "text-rose-500" : "text-zinc-900"
                      )}>
                        {roomCheckData.presentCount < roomCheckData.onlineCount ? "Invalid Data" : roomCheckData.presentCount - roomCheckData.onlineCount}
                      </span>
                    </div>
                  </div>
                  <Button type="submit" className="w-full mt-4" disabled={roomCheckData.presentCount < roomCheckData.onlineCount}>
                    Save Check
                  </Button>
                </form>
              </Card>
            </div>
          )}

          {/* Add Room Modal */}
          {isAddRoomModalOpen && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <Card className="w-full max-w-md p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-zinc-900">Add New Room</h2>
                  <Button variant="ghost" size="icon" onClick={() => setIsAddRoomModalOpen(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <form onSubmit={handleAddRoom} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Room Number</label>
                    <Input 
                      value={newRoomData.roomNumber} 
                      onChange={(e) => setNewRoomData({...newRoomData, roomNumber: e.target.value})} 
                      placeholder="e.g. A-101" 
                      required 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Capacity</label>
                    <Input 
                      type="number"
                      value={newRoomData.capacity} 
                      onChange={(e) => setNewRoomData({...newRoomData, capacity: parseInt(e.target.value)})} 
                      min="1"
                      max="10"
                      required 
                    />
                  </div>
                  <Button type="submit" className="w-full mt-4">Create Room</Button>
                </form>
              </Card>
            </div>
          )}

          {/* Room Details Modal */}
          {selectedRoom && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <Card className="w-full max-w-md p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900">Room {selectedRoom.roomNumber}</h2>
                    <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                      {parseInt(selectedRoom.roomNumber) <= 100 ? 'Ground' : parseInt(selectedRoom.roomNumber) <= 200 ? 'Second' : 'Third'} Floor
                    </p>
                    <p className="text-zinc-500 text-sm">Capacity: {selectedRoom.capacity} Students</p>
                    <div className="flex items-center gap-3 mt-4">
                      {[...Array(selectedRoom.capacity)].map((_, i) => {
                        const isOccupied = i < selectedRoom.occupants.length;
                        const isOnline = isOccupied && selectedRoom.onlineStudents?.includes(selectedRoom.occupants[i]);
                        return (
                          <div 
                            key={i} 
                            className={cn(
                              "w-8 h-12 rounded-full transition-all",
                              isOnline ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.6)]" : isOccupied ? "bg-indigo-600" : "bg-zinc-200"
                            )} 
                          />
                        );
                      })}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedRoom(null)}>
                    <X className="w-6 h-6" />
                  </Button>
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Current Occupants</h3>
                  
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-emerald-50 p-2 rounded-xl border border-emerald-100 text-center">
                      <p className="text-lg font-bold text-emerald-600">{selectedRoom.onlineStudents?.length || 0}</p>
                      <p className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">Online</p>
                    </div>
                    <div className="bg-zinc-50 p-2 rounded-xl border border-zinc-100 text-center">
                      <p className="text-lg font-bold text-zinc-600">{(selectedRoom.occupants.length || 0) - (selectedRoom.onlineStudents?.length || 0)}</p>
                      <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Offline</p>
                    </div>
                    <div className="bg-rose-50 p-2 rounded-xl border border-rose-100 text-center">
                      <p className="text-lg font-bold text-rose-600">{getLatestCheck(selectedRoom.roomNumber)?.extraCount || 0}</p>
                      <p className="text-[8px] font-bold text-rose-500 uppercase tracking-widest">Extra in Room</p>
                    </div>
                  </div>

                  <div className="flex gap-2 mb-4">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1 gap-2"
                      onClick={() => setIsRoomHistoryModalOpen(true)}
                    >
                      <History className="w-4 h-4" />
                      View History
                    </Button>
                    <Button 
                      variant="primary" 
                      size="sm" 
                      className="flex-1 gap-2"
                      onClick={() => {
                        setRoomCheckData({ ...roomCheckData, roomNumber: selectedRoom.roomNumber });
                        setIsRoomCheckModalOpen(true);
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Record Check
                    </Button>
                  </div>

                  {getLatestCheck(selectedRoom.roomNumber) && (
                    <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Latest Physical Check</h3>
                        <span className="text-[8px] font-bold text-zinc-400">
                          {format(parseISO(getLatestCheck(selectedRoom.roomNumber)!.createdAt), 'MMM d, hh:mm a')}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">Present</p>
                          <p className="text-sm font-bold text-zinc-900">{getLatestCheck(selectedRoom.roomNumber)!.presentCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">Online</p>
                          <p className="text-sm font-bold text-zinc-900">{getLatestCheck(selectedRoom.roomNumber)!.onlineCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">Type</p>
                          <p className="text-sm font-bold text-zinc-900 capitalize">{getLatestCheck(selectedRoom.roomNumber)!.checkType}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedRoom.occupants.length === 0 ? (
                    <div className="p-8 text-center bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                      <Users className="w-10 h-10 text-zinc-300 mx-auto mb-2" />
                      <p className="text-zinc-400 text-sm">No students assigned to this room</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedRoom.occupants.map((studentId) => {
                        const student = students.find(s => s.id === studentId);
                        const isOnline = selectedRoom.onlineStudents?.includes(studentId);
                        return (
                          <div key={studentId} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold text-xs">
                                {student?.name.charAt(0) || '?'}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-zinc-900">{student?.name || 'Unknown Student'}</p>
                                <div className="flex items-center gap-2">
                                  <p className="text-[10px] text-zinc-500">{studentId}</p>
                                  <span className={cn(
                                    "text-[8px] font-black uppercase tracking-tighter px-1 rounded",
                                    isOnline ? "bg-emerald-100 text-emerald-600" : "bg-zinc-200 text-zinc-500"
                                  )}>
                                    {isOnline ? 'Online' : 'Offline'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className={cn(
                                  "text-[10px] font-bold h-8",
                                  isOnline ? "text-zinc-400" : "text-emerald-600 hover:bg-emerald-50"
                                )}
                                onClick={() => handleToggleOnline(selectedRoom.roomNumber, studentId, !isOnline)}
                              >
                                {isOnline ? 'Set Offline' : 'Set Online'}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-8"
                                onClick={() => handleRoomOccupantAction(selectedRoom.roomNumber, studentId, 'remove')}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  {selectedRoom.occupants.length < selectedRoom.capacity && (
                    <div className="mt-6">
                      {!isAssigningStudent ? (
                        <Button onClick={() => setIsAssigningStudent(true)} variant="outline" className="w-full gap-2">
                          <Plus className="w-4 h-4" />
                          Assign Student
                        </Button>
                      ) : (
                        <div className="space-y-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-200 animate-in slide-in-from-top-2 duration-200">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Select Student</h4>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsAssigningStudent(false)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                            {students
                              .filter(s => !s.roomNumber || s.roomNumber === "")
                              .map(student => (
                                <button
                                  key={student.id}
                                  onClick={() => handleRoomOccupantAction(selectedRoom.roomNumber, student.id, 'add')}
                                  className="w-full text-left p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-sm font-medium text-zinc-700 flex items-center justify-between group"
                                >
                                  <span>{student.name}</span>
                                  <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                              ))}
                            {students.filter(s => !s.roomNumber || s.roomNumber === "").length === 0 && (
                              <p className="text-[10px] text-zinc-400 text-center py-2 italic">No unassigned students found</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <Input 
                    placeholder="Search by student name or room..." 
                    className="pl-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-zinc-400 mr-1" />
                  {(['all', 'pending', 'hod_pending', 'approved', 'rejected'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setRequestFilter(f)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all",
                        requestFilter === f ? "bg-indigo-600 text-white" : "bg-white text-zinc-500 border border-zinc-200 hover:border-zinc-300"
                      )}
                    >
                      {f === 'hod_pending' ? 'HOD Approved' : f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                {requests
                  .filter(r => 
                    (requestFilter === 'all' ? (r.status === 'hod_pending' || r.status === 'approved' || r.status === 'rejected') : r.status === requestFilter) &&
                    (r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) || r.roomNumber.includes(searchTerm))
                  )
                  .map((req) => (
                    <div key={req.id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden p-6">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                          <div className="flex gap-2 shrink-0">
                            {req.photo ? (
                              <div className="relative group">
                                <img 
                                  src={req.photo} 
                                  alt="Verification" 
                                  className="w-28 h-28 rounded-2xl object-cover border-2 border-indigo-100 shadow-sm"
                                  referrerPolicy="no-referrer"
                                />
                                <span className="absolute -bottom-1 -right-1 bg-indigo-600 text-white text-[8px] px-1 rounded font-bold opacity-0 group-hover:opacity-100 transition-opacity">Live</span>
                              </div>
                            ) : (
                              <div className="w-28 h-28 bg-zinc-100 rounded-2xl flex items-center justify-center">
                                <User className="w-10 h-10 text-zinc-400" />
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-3">
                              <h3 className="font-bold text-zinc-900 text-lg">{req.studentName}</h3>
                              <span className="px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[10px] font-bold uppercase tracking-widest">
                                {req.passId}
                              </span>
                              <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                                Room {req.roomNumber} - Bed {req.bedNumber || 'N/A'}
                              </span>
                              <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                                Roll: {req.rollNumber || 'N/A'}
                              </span>
                              <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                                Phone: {req.studentPhone || 'N/A'}
                              </span>
                              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-[10px] font-bold uppercase tracking-widest">
                                {(req.type || 'outpass').replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-zinc-500 text-sm mt-1">{req.reason}</p>
                            <div className="flex items-center gap-4 mt-3">
                              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                                <Clock className="w-3.5 h-3.5" />
                                {format(parseISO(req.outTime), 'MMM d, hh:mm a')} - {format(parseISO(req.returnTime), 'hh:mm a')}
                              </div>
                              {req.parentPhone && (
                                <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Parent: {req.parentPhone}
                                </div>
                              )}
                              {req.type === 'home_pass' && req.status === 'approved' && (
                                <div className={cn(
                                  "flex items-center gap-1.5 text-xs font-bold",
                                  req.parentsIntimated ? "text-emerald-600" : "text-rose-600"
                                )}>
                                  <Phone className="w-3.5 h-3.5" />
                                  Parents Intimated: {req.parentsIntimated ? 'YES' : 'NO'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {req.status === 'hod_pending' ? (
                            <>
                              <Button variant="danger" size="sm" className="gap-2" onClick={() => handleRequestAction(req.id, 'rejected')}>
                                <XCircle className="w-5 h-5" />
                                Reject
                              </Button>
                              <Button variant="primary" size="sm" className="gap-2" onClick={() => handleRequestAction(req.id, 'approved')}>
                                <CheckCircle2 className="w-5 h-5" />
                                Approve
                              </Button>
                            </>
                          ) : (
                            <div className={cn(
                              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold",
                              req.status === 'approved' ? "bg-emerald-50 text-emerald-700" : 
                              req.status === 'out' ? "bg-amber-50 text-amber-700" :
                              req.status === 'returned' ? "bg-zinc-50 text-zinc-700" :
                              "bg-rose-50 text-rose-700"
                            )}>
                              {req.status === 'approved' ? <CheckCircle2 className="w-5 h-5" /> : 
                               req.status === 'out' ? <LogOut className="w-5 h-5" /> :
                               req.status === 'returned' ? <CheckCircle2 className="w-5 h-5" /> :
                               <XCircle className="w-5 h-5" />}
                              <span className="capitalize">
                                {req.status === 'out' ? 'Currently Out' : req.status}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {activeTab === 'students' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="relative w-full sm:max-w-md">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                  <Input 
                    placeholder="Search by name, ID or room..." 
                    className="pl-11"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setStudentPage(1);
                    }}
                  />
                </div>
                <p className="text-sm text-zinc-500 font-medium">
                  Showing {Math.min(studentsPerPage, students.filter(s => 
                    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (s.roomNumber && s.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                  ).length)} of {students.filter(s => 
                    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (s.roomNumber && s.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                  ).length} students
                </p>
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-100">
                        <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Student</th>
                        <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">ID</th>
                        <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Room</th>
                        <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Phone</th>
                        <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {students
                        .filter(s => 
                          s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (s.roomNumber && s.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                        )
                        .slice((studentPage - 1) * studentsPerPage, studentPage * studentsPerPage)
                        .map((student) => (
                          <tr key={student.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold text-lg">
                                  {student.name.charAt(0)}
                                </div>
                                <span className="font-bold text-zinc-900">{student.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-zinc-500 font-mono">{student.id}</td>
                            <td className="px-6 py-4">
                              <span className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md text-xs font-bold">
                                {student.roomNumber || 'Unassigned'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-zinc-500">{student.studentPhone || 'N/A'}</td>
                            <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setSelectedStudent(student)}>View History</Button>
                              <Button variant="outline" size="sm" onClick={() => {
                                setEditingStudent(student);
                                setEditFormData({
                                  name: student.name,
                                  roomNumber: student.roomNumber || '',
                                  bedNumber: student.bedNumber || '',
                                  studentPhone: student.studentPhone || ''
                                });
                              }}>Edit</Button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Pagination */}
              <div className="flex items-center justify-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={studentPage === 1}
                  onClick={() => setStudentPage(p => p - 1)}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, Math.ceil(students.filter(s => 
                    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (s.roomNumber && s.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                  ).length / studentsPerPage)))].map((_, i) => {
                    const pageNum = i + 1;
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setStudentPage(pageNum)}
                        className={cn(
                          "w-8 h-8 rounded-lg text-xs font-bold transition-all",
                          studentPage === pageNum 
                            ? "bg-indigo-600 text-white shadow-sm" 
                            : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
                        )}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  {Math.ceil(students.filter(s => 
                    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (s.roomNumber && s.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                  ).length / studentsPerPage) > 5 && (
                    <span className="text-zinc-400 px-2">...</span>
                  )}
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={studentPage >= Math.ceil(students.filter(s => 
                    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (s.roomNumber && s.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                  ).length / studentsPerPage)}
                  onClick={() => setStudentPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Student History Modal */}
          {selectedStudent && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <Card className="w-full max-w-2xl p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center font-bold text-lg">
                      {selectedStudent.name.charAt(0)}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-zinc-900">{selectedStudent.name}</h2>
                      <p className="text-zinc-500 text-sm">Room {selectedStudent.roomNumber || 'Unassigned'} | Bed {selectedStudent.bedNumber || 'N/A'}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedStudent(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Request History</h3>
                  {requests.filter(r => r.studentId === selectedStudent.id).length === 0 ? (
                    <div className="p-12 text-center bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                      <ClipboardList className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                      <p className="text-zinc-400 text-sm">No request history found for this student</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {requests
                        .filter(r => r.studentId === selectedStudent.id)
                        .map(req => (
                          <div key={req.id} className="p-4 bg-white rounded-xl border border-zinc-100 shadow-sm flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              {req.photo && (
                                <img 
                                  src={req.photo} 
                                  alt="Verification" 
                                  className="w-10 h-10 rounded-lg object-cover border border-zinc-100 shadow-sm"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              <div>
                                <p className="font-bold text-zinc-900 text-sm">{req.reason}</p>
                                <p className="text-[10px] text-zinc-500 mt-1">
                                  {format(parseISO(req.outTime), 'MMM d, hh:mm a')} - {format(parseISO(req.returnTime), 'hh:mm a')}
                                </p>
                              </div>
                            </div>
                            <div className={cn(
                              "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                              req.status === 'approved' ? "bg-emerald-50 text-emerald-700" :
                              req.status === 'rejected' ? "bg-rose-50 text-rose-700" :
                              "bg-amber-50 text-amber-700"
                            )}>
                              {req.status}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="p-6">
                  <h3 className="text-lg font-bold mb-6">Outing Trends (Last 7 Days)</h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={outingTrends}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          cursor={{ fill: '#f4f4f5' }}
                        />
                        <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="text-lg font-bold mb-6">Occupancy Distribution</h3>
                  <div className="h-80 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Occupied', value: rooms.filter(r => r.occupants.length > 0).length },
                            { name: 'Vacant', value: rooms.filter(r => r.occupants.length === 0).length },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                          isAnimationActive={false}
                        >
                          <Cell key="cell-occupied" fill="#4f46e5" />
                          <Cell key="cell-vacant" fill="#e4e4e7" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'scanner' && (
            <div className="max-w-xl mx-auto">
              {!scannedRequest ? (
                <Card className="p-8 text-center">
                  <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Camera className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Security Verification</h3>
                  <p className="text-zinc-500 mb-8">Scan student outpass QR code to verify validity</p>
                  
                  <div className="aspect-square bg-zinc-900 rounded-3xl overflow-hidden relative mb-4 border-4 border-zinc-100 shadow-inner">
                    <div id="warden-reader" className="w-full h-full"></div>
                    <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none z-10">
                      <div className="w-full h-full border-2 border-indigo-500/50 rounded-2xl relative">
                        <div className="absolute top-0 left-0 w-full h-0.5 bg-indigo-500 animate-scan" />
                      </div>
                    </div>
                    {(!isActuallyScanning) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-20">
                        <Button onClick={startScanner} className="gap-2">
                          <Camera className="w-5 h-5" />
                          Start Camera
                        </Button>
                      </div>
                    )}
                    {isActuallyScanning && (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        className="absolute bottom-4 right-4 z-20 opacity-80 hover:opacity-100"
                        onClick={toggleCamera}
                      >
                        Switch Camera
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-zinc-500"
                      onClick={() => setIsManualEntry(!isManualEntry)}
                    >
                      {isManualEntry ? "Hide Manual Entry" : "Manual ID Entry"}
                    </Button>

                    {isManualEntry && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Enter Request ID"
                          className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                          value={manualId}
                          onChange={(e) => setManualId(e.target.value)}
                        />
                        <Button onClick={async () => {
                          const parsed = { id: manualId };
                          try {
                            const res = await fetch(`/api/requests/verify/${parsed.id}`, {
                              headers: { 'Authorization': `Bearer ${token}` }
                            });
                            const request = await res.json();
                            if (res.ok && request.id) {
                              setScannedRequest(request);
                              setIsScanning(false);
                              setIsActuallyScanning(false);
                            } else {
                              if (request.error && request.operationType) {
                                throw new Error(JSON.stringify(request));
                              }
                              alert(request.message || "Invalid ID");
                            }
                          } catch (err: any) {
                            console.error(err);
                            if (err.message && err.message.includes('"operationType"')) {
                              throw err;
                            }
                            alert("Error verifying ID");
                          }
                        }}>
                          Verify
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  {scannerError && (
                    <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm flex flex-col items-center gap-3 justify-center">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {scannerError}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => { setScannerError(''); setIsScanning(false); setTimeout(() => setIsScanning(true), 100); }}>
                        Retry Camera
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-3 text-sm font-medium text-zinc-400">
                    <ShieldCheck className="w-4 h-4" />
                    Secure Verification System
                  </div>
                </Card>
              ) : (
                <Card className="overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="bg-indigo-600 p-6 text-center text-white">
                    <h2 className="text-xl font-bold">Verification Result</h2>
                    <p className="text-indigo-100 text-sm opacity-80">Student Outpass Details</p>
                  </div>
                  <div className="p-8">
                    <div className="flex flex-col items-center mb-8">
                      {scannedRequest.photo ? (
                        <div className="w-48 h-48 rounded-2xl overflow-hidden border-4 border-white shadow-xl mb-4">
                          <img src={scannedRequest.photo} alt="Student" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                      ) : (
                        <div className="w-48 h-48 bg-zinc-100 rounded-2xl flex items-center justify-center border-4 border-white shadow-xl mb-4">
                          <User className="w-16 h-16 text-zinc-300" />
                        </div>
                      )}
                      <h3 className="text-2xl font-bold text-zinc-900">{scannedRequest.studentName}</h3>
                      <div className="flex flex-col items-center gap-1 mt-1">
                        <p className="text-zinc-500 font-medium">Room {scannedRequest.roomNumber} - Bed {scannedRequest.bedNumber || 'N/A'}</p>
                        <p className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Roll: {scannedRequest.rollNumber || 'N/A'}</p>
                        <p className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Phone: {scannedRequest.studentPhone || 'N/A'}</p>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-4">
                        <div className={cn(
                          "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider",
                          scannedRequest.status === 'approved' ? "bg-emerald-100 text-emerald-700" :
                          scannedRequest.status === 'out' ? "bg-amber-100 text-amber-700" :
                          scannedRequest.status === 'returned' ? "bg-blue-100 text-blue-700" :
                          "bg-zinc-100 text-zinc-700"
                        )}>
                          {scannedRequest.status}
                        </div>
                        {scannedRequest.status === 'out' && isAfter(new Date(), parseISO(scannedRequest.returnTime)) && (
                          <div className="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-100 text-rose-700 flex items-center gap-1.5 animate-pulse">
                            <AlertCircle className="w-3 h-3" />
                            Expired
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4 text-sm mb-8">
                      <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                        <span className="text-zinc-400 font-medium">Reason</span>
                        <span className="font-bold text-zinc-900">{scannedRequest.reason}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                        <span className="text-zinc-400 font-medium">Out Time</span>
                        <span className="font-bold text-zinc-900">{format(parseISO(scannedRequest.outTime), 'MMM d, hh:mm a')}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                        <span className="text-zinc-400 font-medium">Return Time</span>
                        <span className="font-bold text-zinc-900">{format(parseISO(scannedRequest.returnTime), 'MMM d, hh:mm a')}</span>
                      </div>
                      {scannedRequest.parentPhone && (
                        <div className="flex justify-between items-center">
                          <span className="text-zinc-400 font-medium">Parent Contact</span>
                          <span className="font-bold text-indigo-600">{scannedRequest.parentPhone}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Button 
                        variant="primary" 
                        className="h-12" 
                        disabled={scannedRequest.status !== 'approved'}
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/requests/${scannedRequest.id}/status`, {
                              method: 'PATCH',
                              headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                              },
                              body: JSON.stringify({ status: 'out' }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setScannedRequest(null);
                              setIsScanning(true);
                              fetchData();
                            } else {
                              if (data.error && data.operationType) {
                                throw new Error(JSON.stringify(data));
                              }
                              alert(data.message || "Failed to update status");
                            }
                          } catch (err: any) {
                            console.error(err);
                            if (err.message && err.message.includes('"operationType"')) {
                              throw err;
                            }
                          }
                        }}
                      >
                        Mark Exit
                      </Button>
                      <Button 
                        variant="secondary" 
                        className="h-12"
                        disabled={scannedRequest.status !== 'out'}
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/requests/${scannedRequest.id}/status`, {
                              method: 'PATCH',
                              headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                              },
                              body: JSON.stringify({ status: 'returned' }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setScannedRequest(null);
                              setIsScanning(true);
                              fetchData();
                            } else {
                              if (data.error && data.operationType) {
                                throw new Error(JSON.stringify(data));
                              }
                              alert(data.message || "Failed to update status");
                            }
                          } catch (err: any) {
                            console.error(err);
                            if (err.message && err.message.includes('"operationType"')) {
                              throw err;
                            }
                          }
                        }}
                      >
                        Mark Entry
                      </Button>
                    </div>
                    <Button 
                      variant="ghost" 
                      className="w-full mt-4" 
                      onClick={() => {
                        setScannedRequest(null);
                        setIsScanning(true);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}
          {/* Edit Student Modal */}
          {editingStudent && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <Card className="w-full max-w-md p-8 animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-zinc-900">Edit Student Details</h2>
                  <Button variant="ghost" size="icon" onClick={() => setEditingStudent(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <form onSubmit={handleUpdateStudent} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Full Name</label>
                    <Input 
                      value={editFormData.name} 
                      onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} 
                      required 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 ml-1">Room Number</label>
                      <Input 
                        value={editFormData.roomNumber} 
                        onChange={(e) => setEditFormData({...editFormData, roomNumber: e.target.value})} 
                        required 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 ml-1">Bed Number</label>
                      <Input 
                        value={editFormData.bedNumber} 
                        onChange={(e) => setEditFormData({...editFormData, bedNumber: e.target.value})} 
                        required 
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700 ml-1">Student Phone</label>
                    <Input 
                      value={editFormData.studentPhone} 
                      onChange={(e) => setEditFormData({...editFormData, studentPhone: e.target.value})} 
                      required 
                    />
                  </div>
                  <Button type="submit" variant="primary" className="w-full h-12 mt-4" disabled={isLoading}>
                    {isLoading ? "Updating..." : "Save Changes"}
                  </Button>
                </form>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// --- Security Dashboard ---

const SecurityDashboard = () => {
  const { user, token, logout } = useAuth();
  const [scannedRequest, setScannedRequest] = useState<OutpassRequest | null>(null);
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(true);
  const [isActuallyScanning, setIsActuallyScanning] = useState(false);
  const [cameraMode, setCameraMode] = useState<'environment' | 'user'>('environment');
  const [manualId, setManualId] = useState('');
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [stats, setStats] = useState({ in: 0, out: 0 });
  const [outRequests, setOutRequests] = useState<OutpassRequest[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    // Listen for all students to get total count
    const studentsQuery = query(collection(db, "users"), where("role", "==", "student"));
    const unsubscribeStudents = onSnapshot(studentsQuery, (snapshot) => {
      setTotalStudents(snapshot.size);
    }, (err) => handleFirestoreError(err, OperationType.LIST, "users"));

    // Listen for out requests
    const outRequestsQuery = query(
      collection(db, "requests"), 
      where("status", "==", "out"),
      orderBy("createdAt", "desc")
    );
    const unsubscribeOut = onSnapshot(outRequestsQuery, (snapshot) => {
      const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OutpassRequest));
      setOutRequests(requests);
      setStats(prev => ({ ...prev, out: requests.length }));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "requests"));

    return () => {
      unsubscribeStudents();
      unsubscribeOut();
    };
  }, []);

  useEffect(() => {
    setStats(prev => ({ ...prev, in: totalStudents - outRequests.length }));
  }, [totalStudents, outRequests]);

  const stopScanner = async () => {
    if (isTransitioningRef.current) return;
    if (scannerRef.current && scannerRef.current.isScanning) {
      isTransitioningRef.current = true;
      try {
        await scannerRef.current.stop();
        setIsActuallyScanning(false);
      } catch (e) {
        console.error("Failed to stop scanner", e);
      } finally {
        isTransitioningRef.current = false;
      }
    }
  };

  const startScanner = async () => {
    if (isTransitioningRef.current) return;
    const readerElement = document.getElementById("reader");
    if (!readerElement) return;

    isTransitioningRef.current = true;
    try {
      // If already scanning, stop it first
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.stop();
        setIsActuallyScanning(false);
      }

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: cameraMode },
        { 
          fps: 20, 
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdgeSize * 0.7);
            return {
              width: qrboxSize,
              height: qrboxSize
            };
          },
          aspectRatio: 1.0
        },
        (decodedText) => {
          const parsed = safeJSONParse(decodedText);
          if (parsed && parsed.id) {
            handleScan(decodedText);
          }
        },
        (err) => {
          // Silent error for scanning
        }
      );
      setIsActuallyScanning(true);
      setError('');
    } catch (err: any) {
      console.error("Scanner error:", err);
      if (err.name === 'NotAllowedError' || err === 'NotAllowedError') {
        setError("Camera permission denied. Please allow camera access in your browser settings and refresh.");
      } else {
        setError("Could not access camera. Please check permissions and ensure no other app is using it.");
      }
      setIsActuallyScanning(false);
    } finally {
      isTransitioningRef.current = false;
    }
  };

  const toggleCamera = async () => {
    const newMode = cameraMode === 'environment' ? 'user' : 'environment';
    setCameraMode(newMode);
    if (scannerRef.current && scannerRef.current.isScanning) {
      await stopScanner();
      // Small delay before restart
      setTimeout(() => startScanner(), 100);
    }
  };

  useEffect(() => {
    if (isScanning && !scannedRequest) {
      const timer = setTimeout(() => {
        startScanner();
      }, 1000);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [isScanning, scannedRequest, token]);

  const handleScan = async (text: string) => {
    const parsed = safeJSONParse(text);
    if (!parsed || !parsed.id) return;

    setIsScanning(false);
    setIsActuallyScanning(false);
    setError('');
    
    // Stop scanner immediately on successful scan
    await stopScanner();

    try {
      const res = await fetch(`/api/requests/verify/${parsed.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const request = await res.json();
      if (res.ok) {
        setScannedRequest(request);
      } else {
        if (request.error && request.operationType) {
          throw new Error(JSON.stringify(request));
        }
        setError(request.message || "Invalid QR Code");
        setIsScanning(true);
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
      setError("Network error verifying QR code");
      setIsScanning(true);
    }
  };

  const updateStatus = async (status: RequestStatus) => {
    if (!scannedRequest) return;
    try {
      const res = await fetch(`/api/requests/${scannedRequest.id}/status`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok) {
        setScannedRequest(null);
        setIsScanning(true);
      } else {
        if (data.error && data.operationType) {
          throw new Error(JSON.stringify(data));
        }
        setError(data.message || "Failed to update status");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('"operationType"')) {
        throw err;
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-zinc-900">Security Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-bold text-zinc-900">{user?.name}</p>
              <p className="text-xs text-zinc-500">Security Personnel</p>
            </div>
            {user?.name && (
              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                {user.name.charAt(0)}
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={logout}>
              <LogOut className="w-6 h-6" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-12">
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card className="p-4 bg-indigo-50 border-indigo-100 flex flex-col items-center">
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-1">Total Students</span>
            <span className="text-2xl font-bold text-indigo-700">{totalStudents}</span>
          </Card>
          <Card className="p-4 bg-emerald-50 border-emerald-100 flex flex-col items-center">
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">In Hostel</span>
            <span className="text-2xl font-bold text-emerald-700">{stats.in}</span>
          </Card>
          <Card className="p-4 bg-amber-50 border-amber-100 flex flex-col items-center">
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Out</span>
            <span className="text-2xl font-bold text-amber-700">{stats.out}</span>
          </Card>
        </div>
        {!scannedRequest ? (
          <Card className="p-8 text-center">
            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Camera className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold mb-2">Scan Outpass</h3>
            <p className="text-zinc-500 mb-8">Point camera at student's QR code</p>
            
            <div className="aspect-square bg-zinc-900 rounded-3xl overflow-hidden relative mb-4 border-4 border-zinc-100 shadow-inner">
              <div id="reader" className="w-full h-full"></div>
              <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none z-10">
                <div className="w-full h-full border-2 border-indigo-500/50 rounded-2xl relative">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-indigo-500 animate-scan" />
                </div>
              </div>
              {(!isActuallyScanning) && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-20">
                  <Button onClick={startScanner} className="gap-2">
                    <Camera className="w-5 h-5" />
                    Start Camera
                  </Button>
                </div>
              )}
              {isActuallyScanning && (
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="absolute bottom-4 right-4 z-20 opacity-80 hover:opacity-100"
                  onClick={toggleCamera}
                >
                  Switch Camera
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-zinc-500"
                onClick={() => setIsManualEntry(!isManualEntry)}
              >
                {isManualEntry ? "Hide Manual Entry" : "Manual ID Entry"}
              </Button>

              {isManualEntry && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter Request ID"
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                  />
                  <Button onClick={() => handleScan(JSON.stringify({ id: manualId }))}>
                    Verify
                  </Button>
                </div>
              )}
            </div>

            {error && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm flex flex-col items-center gap-3 justify-center">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
                <Button variant="outline" size="sm" onClick={() => { setError(''); setIsScanning(false); setTimeout(() => setIsScanning(true), 100); }}>
                  Retry Camera
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <Card className="overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-indigo-600 p-6 text-center text-white">
              <h2 className="text-xl font-bold">Student Details</h2>
              <p className="text-indigo-100 text-sm opacity-80">Verify identity and outpass status</p>
            </div>
            <div className="p-8">
              <div className="flex flex-col items-center mb-8">
                <div className="flex gap-4 mb-6">
                  {scannedRequest.photo && (
                    <div className="w-40 h-40 rounded-2xl overflow-hidden border-4 border-white shadow-xl relative">
                      <img src={scannedRequest.photo} alt="Verification" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute bottom-0 left-0 right-0 bg-indigo-600/90 text-white text-[10px] font-bold py-2 uppercase tracking-widest text-center backdrop-blur-sm">
                        Live Photo
                      </div>
                    </div>
                  )}
                  {!scannedRequest.photo && (
                    <div className="w-40 h-40 bg-zinc-100 rounded-2xl flex items-center justify-center border-4 border-white shadow-xl">
                      <User className="w-16 h-16 text-zinc-300" />
                    </div>
                  )}
                </div>
                
                <div className="text-center">
                  <h3 className="text-2xl font-bold text-zinc-900">{scannedRequest.studentName}</h3>
                  <div className="flex flex-col items-center gap-1 mt-1">
                    <p className="text-zinc-500 font-medium">Room {scannedRequest.roomNumber} - Bed {scannedRequest.bedNumber || 'N/A'}</p>
                    <p className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Roll: {scannedRequest.rollNumber || 'N/A'}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 mt-4">
                  <div className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border",
                    scannedRequest.status === 'approved' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                    scannedRequest.status === 'out' ? "bg-amber-50 text-amber-700 border-amber-100" :
                    scannedRequest.status === 'returned' ? "bg-blue-50 text-blue-700 border-blue-100" :
                    "bg-zinc-50 text-zinc-700 border-zinc-100"
                  )}>
                    {scannedRequest.status === 'out' ? 'Currently Out' : scannedRequest.status}
                  </div>
                  {scannedRequest.status === 'out' && isAfter(new Date(), parseISO(scannedRequest.returnTime)) && (
                    <div className="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-100 text-rose-700 flex items-center gap-1.5 animate-pulse">
                      <AlertCircle className="w-3 h-3" />
                      Expired
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-zinc-50 rounded-2xl p-6 space-y-4 text-sm mb-8 border border-zinc-100">
                <div className="flex justify-between items-center border-b border-zinc-200/50 pb-2">
                  <span className="text-zinc-400 font-medium uppercase text-[10px] tracking-widest">Pass ID</span>
                  <span className="font-bold text-indigo-600">{scannedRequest.passId}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-200/50 pb-2">
                  <span className="text-zinc-400 font-medium uppercase text-[10px] tracking-widest">Reason</span>
                  <span className="font-bold text-zinc-900">{scannedRequest.reason}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-200/50 pb-2">
                  <span className="text-zinc-400 font-medium uppercase text-[10px] tracking-widest">Out Time</span>
                  <span className="font-bold text-zinc-900">{format(parseISO(scannedRequest.outTime), 'MMM d, hh:mm a')}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-200/50 pb-2">
                  <span className="text-zinc-400 font-medium uppercase text-[10px] tracking-widest">Student Phone</span>
                  <span className="font-bold text-zinc-900">{scannedRequest.studentPhone || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-medium uppercase text-[10px] tracking-widest">Return Time</span>
                  <span className="font-bold text-zinc-900">{format(parseISO(scannedRequest.returnTime), 'MMM d, hh:mm a')}</span>
                </div>
              </div>

              {scannedRequest.wardenPhoto && (
                <div className="mb-8 p-6 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-4">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Approved By Warden</p>
                  </div>
                  <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-white shadow-md">
                    <img src={scannedRequest.wardenPhoto} alt="Warden" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="primary" 
                  className="h-12" 
                  disabled={scannedRequest.status !== 'approved'}
                  onClick={() => updateStatus('out')}
                >
                  Mark Exit
                </Button>
                <Button 
                  variant="secondary" 
                  className="h-12"
                  disabled={scannedRequest.status !== 'out'}
                  onClick={() => updateStatus('returned')}
                >
                  Mark Entry
                </Button>
              </div>
              <Button 
                variant="ghost" 
                className="w-full mt-4" 
                onClick={() => {
                  setScannedRequest(null);
                  setIsScanning(true);
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </main>

      {/* Out Students List Section */}
      <section className="max-w-xl mx-auto px-6 pb-20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-900">Students Currently Out</h2>
            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-bold">
              {outRequests.length}
            </span>
          </div>
        </div>

        {outRequests.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-2">
            <div className="w-12 h-12 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-6 h-6" />
            </div>
            <p className="text-zinc-500">No students are currently out</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {outRequests.map((req) => (
              <Card key={req.id} className="p-4 hover:shadow-md transition-shadow group cursor-pointer" onClick={() => handleScan(JSON.stringify({ id: req.id }))}>
                <div className="flex gap-4">
                  <div className="flex gap-2 shrink-0">
                    {req.photo ? (
                      <div className="relative">
                        <img 
                          src={req.photo} 
                          alt={req.studentName} 
                          className="w-16 h-16 rounded-xl object-cover border-2 border-indigo-100 shadow-sm"
                          referrerPolicy="no-referrer"
                        />
                        <span className="absolute -bottom-1 -right-1 bg-indigo-600 text-[8px] text-white px-1 rounded font-bold">LIVE</span>
                      </div>
                    ) : (
                      <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center">
                        <User className="w-8 h-8 text-zinc-300" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-zinc-900 truncate">{req.studentName}</h3>
                      <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded text-[8px] font-bold uppercase tracking-widest">
                        {req.passId}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mb-2">Room {req.roomNumber} - Bed {req.bedNumber || 'N/A'}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                        Out Since: {format(parseISO(req.outTime), 'hh:mm a')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <ChevronRight className="w-5 h-5 text-zinc-300 group-hover:text-indigo-500 transition-colors" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

// --- Main App ---

const AppContent = () => {
  const { user } = useAuth();
  const [activeRole, setActiveRole] = useState<'student' | 'warden' | 'security' | 'hod'>('student');

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="flex bg-white p-1 rounded-2xl border border-zinc-200 mb-8">
              <button 
                onClick={() => setActiveRole('student')}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                  activeRole === 'student' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Student
              </button>
              <button 
                onClick={() => setActiveRole('hod')}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                  activeRole === 'hod' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                HOD
              </button>
              <button 
                onClick={() => setActiveRole('warden')}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                  activeRole === 'warden' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Warden
              </button>
              <button 
                onClick={() => setActiveRole('security')}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                  activeRole === 'security' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                Security
              </button>
            </div>
            <LoginPage role={activeRole} />
          </div>
        </div>
      </div>
    );
  }

  if (user.role === 'student') return <StudentDashboard />;
  if (user.role === 'hod') return <HODDashboard />;
  if (user.role === 'warden') return <WardenDashboard />;
  if (user.role === 'security') return <SecurityDashboard />;
  return null;
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
