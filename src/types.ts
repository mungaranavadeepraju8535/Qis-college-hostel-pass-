export type UserRole = 'student' | 'warden' | 'security' | 'hod';
export type RequestStatus = 'pending' | 'hod_pending' | 'approved' | 'rejected' | 'out' | 'returned';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roomNumber?: string;
  bedNumber?: string;
  studentPhone?: string;
}

export interface Room {
  roomNumber: string;
  capacity: number;
  occupants: string[]; // Array of student names or IDs
  onlineStudents?: string[]; // Array of student IDs who are online
}

export type RequestType = 'outpass' | 'home_pass';

export interface OutpassRequest {
  id: string;
  studentId: string;
  studentName: string;
  roomNumber: string;
  reason: string;
  outTime: string;
  returnTime: string;
  status: RequestStatus;
  type: RequestType;
  remarks?: string;
  createdAt: string;
  photo?: string; // Base64 photo
  wardenPhoto?: string; // Base64 warden photo
  hodPhoto?: string; // Base64 hod photo
  hodRemarks?: string;
  parentVerified?: boolean;
  parentPhone?: string;
  parentsIntimated?: boolean;
  passId: string;
  bedNumber?: string;
  rollNumber?: string;
  studentPhone?: string;
}

export interface RoomCheck {
  id?: string;
  roomNumber: string;
  presentCount: number;
  onlineCount: number;
  extraCount: number;
  checkType: 'morning' | 'afternoon' | 'evening';
  recordedBy: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
