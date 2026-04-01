import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Crown, 
  Trophy,
  RotateCcw, 
  Play, 
  X, 
  Check,
  Info,
  Settings,
  Volume2,
  VolumeX,
  Home,
  RefreshCw, 
  Gamepad,
  Gamepad2
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc,
  doc,
  query, 
  where,
  orderBy, 
  limit, 
  getDocs, 
  serverTimestamp
} from 'firebase/firestore';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- UTILS ---
/**
 * Utility function to merge Tailwind CSS classes safely.
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates a unique ID for the current week (e.g., "2024-W14").
 * Used for weekly leaderboard resets.
 */
const getWeekId = () => {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNumber}`;
};

// --- TELEGRAM SDK BRIDGE ---
/**
 * Integration with Telegram WebApp SDK for haptics and theme synchronization.
 */
const tg = (window as any).Telegram?.WebApp;

const haptic = {
  impact: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
    tg?.HapticFeedback?.impactOccurred(style);
  },
  notification: (type: 'error' | 'success' | 'warning') => {
    tg?.HapticFeedback?.notificationOccurred(type);
  },
  selection: () => {
    tg?.HapticFeedback?.selectionChanged();
  }
};

// --- FIREBASE SERVICE ---
/**
 * Firebase configuration. 
 * Note: In a production environment, these should be handled via environment variables.
 */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let db: any = null;
try {
  // Initialize Firebase only if valid credentials are provided.
  if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_")) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
} catch (e) {
  console.error("Firebase initialization failed:", e);
}

// --- GAME CONSTANTS ---
/**
 * Simple Audio Service using Web Audio API to synthesize game sounds.
 * This avoids the need for external assets and reduces load time.
 * We use oscillators to create 'retro' game sounds.
 */
let audioCtx: AudioContext | null = null;

/**
 * Plays a synthesized sound effect.
 * @param type - The type of sound to play ('place', 'clear', 'select').
 * @param enabled - Whether sound is currently enabled in settings.
 */
const playSound = (type: 'place' | 'clear' | 'select', enabled: boolean) => {
  if (!enabled) return;
  
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    
    // Resume context if it was suspended by the browser (common in modern browsers)
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    
    // Different sound profiles for different game actions
    if (type === 'select') {
      // Short high-pitched blip for selection
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'place') {
      // Lower frequency 'thud' for placing a block
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else {
      // Rising pitch for clearing lines
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch (e) {
    console.warn('Audio context failed', e);
  }
};

const GRID_SIZE = 8;
const XP_PER_BLOCK = 10;
const XP_PER_LINE = 100;
const COMBO_MULTIPLIER = 1.5;

/**
 * Mock data for the leaderboard to be used when offline or during development.
 * This provides a realistic starting point for the UI and helps programmers
 * understand the data structure expected by the leaderboard components.
 */
const MOCK_LEADERBOARD = [
  { id: 'm1', username: 'Alex_Gamer', score: 25400, level: 12 },
  { id: 'm2', username: 'Sarah_Blocks', score: 21200, level: 10 },
  { id: 'm3', username: 'PuzzleMaster', score: 18900, level: 9 },
  { id: 'm4', username: 'NeonKnight', score: 15600, level: 7 },
  { id: 'm5', username: 'BlockStar', score: 12300, level: 6 },
  { id: 'm6', username: 'ZenPlayer', score: 9800, level: 5 },
  { id: 'm7', username: 'QuickClick', score: 7500, level: 4 },
  { id: 'm8', username: 'TheArchitect', score: 5400, level: 3 },
  { id: 'm9', username: 'Newbie_01', score: 3200, level: 2 },
  { id: 'm10', username: 'Guest_User', score: 1200, level: 1 },
  { id: 'm11', username: 'RetroFan', score: 850, level: 1 },
  { id: 'm12', username: 'Blocky', score: 500, level: 1 },
  { id: 'm13', username: 'Alpha', score: 450, level: 1 },
  { id: 'm14', username: 'Beta', score: 300, level: 1 },
  { id: 'm15', username: 'Gamma', score: 150, level: 1 },
];

type Shape = {
  id: string;
  matrix: number[][];
  color: string;
};

/**
 * All possible block shapes in the game.
 * 1 represents a block, 0 represents empty space.
 * Each matrix defines the layout of the shape.
 */
const SHAPES: Shape[] = [
  { id: '1x1', matrix: [[1]], color: 'bg-[#ffcc00]' }, // Single dot
  { id: '1x2', matrix: [[1, 1]], color: 'bg-[#ffcc00]' }, // Horizontal 2-block
  { id: '1x3', matrix: [[1, 1, 1]], color: 'bg-[#ffcc00]' }, // Horizontal 3-block
  { id: '1x4', matrix: [[1, 1, 1, 1]], color: 'bg-[#ffcc00]' }, // Horizontal 4-block
  { id: '2x2', matrix: [[1, 1], [1, 1]], color: 'bg-[#9933cc]' }, // Square
  { id: '3x3', matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], color: 'bg-[#cc2222]' }, // Large Square
  { id: 'L', matrix: [[1, 0], [1, 0], [1, 1]], color: 'bg-[#ff8c00]' }, // L shape
  { id: 'L-rev', matrix: [[0, 1], [0, 1], [1, 1]], color: 'bg-[#00d2ff]' }, // Reverse L shape
  { id: 'T', matrix: [[1, 1, 1], [0, 1, 0]], color: 'bg-[#33cc33]' }, // T shape
  { id: 'Z', matrix: [[1, 1, 0], [0, 1, 1]], color: 'bg-[#cc2222]' }, // Z shape
  { id: 'S', matrix: [[0, 1, 1], [1, 1, 0]], color: 'bg-[#33cc33]' }, // S shape
  { id: '3x3-corner', matrix: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], color: 'bg-[#ffcc00]' }, // Corner shape (5 blocks) - Top Left
  { id: '3x3-corner-2', matrix: [[1, 1, 1], [0, 0, 1], [0, 0, 1]], color: 'bg-[#ffcc00]' }, // Corner shape (5 blocks) - Top Right
  { id: '3x3-corner-3', matrix: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], color: 'bg-[#ffcc00]' }, // Corner shape (5 blocks) - Bottom Left
  { id: '3x3-corner-4', matrix: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], color: 'bg-[#ffcc00]' }, // Corner shape (5 blocks) - Bottom Right
  { id: 'corner-2x2-1', matrix: [[1, 1], [1, 0]], color: 'bg-[#00d2ff]' }, // 2x2 Corner (3 blocks) - Top Left
  { id: 'corner-2x2-2', matrix: [[1, 1], [0, 1]], color: 'bg-[#00d2ff]' }, // 2x2 Corner (3 blocks) - Top Right
  { id: 'corner-2x2-3', matrix: [[1, 0], [1, 1]], color: 'bg-[#00d2ff]' }, // 2x2 Corner (3 blocks) - Bottom Left
  { id: 'corner-2x2-4', matrix: [[0, 1], [1, 1]], color: 'bg-[#00d2ff]' }, // 2x2 Corner (3 blocks) - Bottom Right
  { id: '3x2', matrix: [[1, 1, 1], [1, 1, 1]], color: 'bg-[#cc2222]' }, // 3x2 rectangle
  { id: '4x2', matrix: [[1, 1, 1, 1], [1, 1, 1, 1]], color: 'bg-[#ffcc00]' }, // 4x2 rectangle
  { id: '2x1', matrix: [[1], [1]], color: 'bg-[#33cc33]' }, // Vertical 2-block
  { id: '3x1', matrix: [[1], [1], [1]], color: 'bg-[#33cc33]' }, // Vertical 3-block
  { id: '4x1', matrix: [[1], [1], [1], [1]], color: 'bg-[#33cc33]' }, // Vertical 4-block
  { id: '1x5', matrix: [[1, 1, 1, 1, 1]], color: 'bg-[#ffcc00]' }, // Horizontal 5-block
  { id: '5x1', matrix: [[1], [1], [1], [1], [1]], color: 'bg-[#33cc33]' }, // Vertical 5-block
  { id: 'side-t-left', matrix: [[1, 0], [1, 1], [1, 0]], color: 'bg-[#9933cc]' }, // Side T shape Left
  { id: 'side-t-right', matrix: [[0, 1], [1, 1], [0, 1]], color: 'bg-[#9933cc]' }, // Side T shape Right
  { id: 'diag-left', matrix: [[1, 0], [0, 1]], color: 'bg-[#00d2ff]' }, // Diagonal 2-block Left
  { id: 'diag-right', matrix: [[0, 1], [1, 0]], color: 'bg-[#00d2ff]' }, // Diagonal 2-block Right
];

// --- SHAPE GENERATION LOGIC ---
/**
 * A "Bag" system for shape generation.
 * This ensures that every shape from the SHAPES array is used exactly once 
 * before any shape is repeated, providing maximum variety and preventing 
 * the "same shapes repeating" issue.
 */
let shapeBag: Shape[] = [];

/**
 * Refills and shuffles the shape bag.
 */
const refillBag = () => {
  // Create a copy of all shapes and shuffle them using Fisher-Yates algorithm
  const newBag = [...SHAPES];
  for (let i = newBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newBag[i], newBag[j]] = [newBag[j], newBag[i]];
  }
  shapeBag = newBag;
};

/**
 * Gets a set of random shapes using the bag system.
 * @param count - Number of shapes to generate (usually 3).
 * @param level - Current game level (can be used for difficulty scaling).
 */
const getRandomShapes = (count: number, level: number): Shape[] => {
  const result: Shape[] = [];
  
  for (let i = 0; i < count; i++) {
    // If bag is empty, refill it
    if (shapeBag.length === 0) {
      refillBag();
    }
    
    // Take the next shape from the bag
    const shape = shapeBag.pop()!;
    
    // Generate a unique ID for this specific instance of the shape
    const uniqueId = `${shape.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
    result.push({ ...shape, id: uniqueId });
  }
  
  return result;
};

export default function App() {
  // --- STATE ---
  const [grid, setGrid] = useState<string[][]>(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill('')));
  const [availableShapes, setAvailableShapes] = useState<Shape[]>([]);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [combo, setCombo] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isMenu, setIsMenu] = useState(true);
  const [leaderboardData, setLeaderboardData] = useState<any[]>(MOCK_LEADERBOARD);
  const [isOffline, setIsOffline] = useState(!db);
  const [draggedShape, setDraggedShape] = useState<Shape | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [ghostPosition, setGhostPosition] = useState<{ r: number, c: number } | null>(null);
  const [cellSize, setCellSize] = useState(45);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [refreshCount, setRefreshCount] = useState(3);
  const [showAd, setShowAd] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [floatingScores, setFloatingScores] = useState<{ id: string, score: number, x: number, y: number }[]>([]);
  
  // Stats for Game Over screen
  const [totalLinesCleared, setTotalLinesCleared] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  
  // Leaderboard submission state
  const [username, setUsername] = useState(tg?.initDataUnsafe?.user?.first_name || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'info' | 'error' } | null>(null);
  const [hasSavedUsername, setHasSavedUsername] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const dragContainerRef = useRef<HTMLDivElement>(null);

  // Load persistent username
  useEffect(() => {
    const saved = localStorage.getItem('blockBlast_username');
    if (saved) {
      setUsername(saved);
      setHasSavedUsername(true);
    }
  }, []);

  /**
   * Resets the game state to start a new session.
   */
  const restartGame = () => {
    setGrid(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill('')));
    setAvailableShapes(getRandomShapes(3, 1));
    setScore(0);
    setGameOver(false);
    setCombo(0);
    setXp(0);
    setLevel(1);
    setRefreshCount(3);
    setTotalLinesCleared(0);
    setMaxCombo(0);
    haptic.notification('success');
  };

  // --- LEADERBOARD RESET LOGIC ---
  /**
   * Clears the local leaderboard data from LocalStorage and resets the state to empty.
   * This completely removes all players from the leaderboard as requested.
   * 
   * NOTE FOR OTHER PROGRAMMERS:
   * We use a 'blockBlast_leaderboard_cleared' flag to distinguish between 
   * a fresh install (where we show mock data) and an explicit user reset 
   * (where we should show an empty list).
   */
  const resetLeaderboard = () => {
    // 1. Clear the local storage entry for leaderboard scores
    localStorage.removeItem('blockBlast_leaderboard');
    // 2. Set a flag that it was explicitly cleared so mock data doesn't reappear on refresh
    localStorage.setItem('blockBlast_leaderboard_cleared', 'true');
    
    // 3. Clear the saved username so the user can enter it again
    localStorage.removeItem('blockBlast_username');
    setUsername(tg?.initDataUnsafe?.user?.first_name || '');
    setHasSavedUsername(false);
    
    // 4. Clear the state completely to update the UI immediately
    setLeaderboardData([]);
    
    // 5. Provide haptic feedback to the user via Telegram SDK to confirm the action
    haptic.notification('success');
    showToast("Leaderboard and name cleared!", "info");
    
    // 6. Log for debugging
    console.log("Leaderboard cleared successfully");
  };

  // --- EFFECTS ---

  /**
   * Initial setup: Telegram SDK, High Score retrieval, and initial shapes.
   */
  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
      document.body.style.backgroundColor = tg.themeParams.bg_color || '#1a1a1a';
    }

    const savedHighScore = localStorage.getItem('blockBlast_highScore');
    if (savedHighScore) setHighScore(parseInt(savedHighScore));

    const onboarded = localStorage.getItem('blockBlast_onboarded');
    if (!onboarded) {
      setShowOnboarding(true);
    }

    setAvailableShapes(getRandomShapes(3, 1));
  }, []);

  /**
   * Level calculation based on current XP.
   */
  const xpToNextLevel = useMemo(() => level * 500, [level]);
  
  useEffect(() => {
    if (xp >= xpToNextLevel) {
      setLevel(prev => prev + 1);
      setXp(prev => prev - xpToNextLevel);
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 2000);
      haptic.notification('success');
    }
  }, [xp, xpToNextLevel]);

  /**
   * Fetches leaderboard data from Firebase or LocalStorage.
   */
  const fetchLeaderboard = useCallback(async () => {
    const wasCleared = localStorage.getItem('blockBlast_leaderboard_cleared');

    if (!db) {
      const stored = localStorage.getItem('blockBlast_leaderboard');
      if (stored === null) {
        // First time or cleared - show mock data as a starting point
        // but if the user explicitly cleared it, we should respect that.
        if (wasCleared) {
          setLeaderboardData([]);
        } else {
          setLeaderboardData([...MOCK_LEADERBOARD]);
        }
        return;
      }
      
      const local = JSON.parse(stored);
      setLeaderboardData(local.sort((a: any, b: any) => b.score - a.score).slice(0, 10));
      return;
    }

    try {
      const currentWeekId = getWeekId();
      const q = query(
        collection(db, 'leaderboard'), 
        where('weekId', '==', currentWeekId),
        orderBy('score', 'desc'), 
        limit(10)
      );
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (data.length > 0) {
        setLeaderboardData(data);
      } else {
        // If Firebase is empty, respect the cleared flag
        setLeaderboardData(wasCleared ? [] : [...MOCK_LEADERBOARD]);
      }
    } catch (e) {
      console.error("Error fetching leaderboard:", e);
      // Fallback to global top scores
      try {
        const fallbackQ = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10));
        const fallbackSnapshot = await getDocs(fallbackQ);
        const fallbackData = fallbackSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        if (fallbackData.length > 0) {
          setLeaderboardData(fallbackData);
        } else {
          setLeaderboardData(wasCleared ? [] : [...MOCK_LEADERBOARD]);
        }
      } catch (err) {
        setIsOffline(true);
        setLeaderboardData(wasCleared ? [] : [...MOCK_LEADERBOARD]);
      }
    }
  }, [db]);

  useEffect(() => {
    if (showLeaderboard) fetchLeaderboard();
  }, [showLeaderboard, fetchLeaderboard]);

  // --- GAME LOGIC ---

  /**
   * Checks if a shape can be placed at a specific grid coordinate.
   * It iterates through the shape's matrix and checks if each '1' (block)
   * falls within grid boundaries and doesn't overlap with an existing block.
   * 
   * @param shape - The shape object containing the matrix.
   * @param startR - Starting row index on the grid.
   * @param startC - Starting column index on the grid.
   * @param currentGrid - The current state of the game grid.
   * @returns boolean - True if placement is valid, false otherwise.
   */
  const canPlaceShape = (shape: Shape, startR: number, startC: number, currentGrid: string[][]) => {
    for (let r = 0; r < shape.matrix.length; r++) {
      for (let c = 0; c < shape.matrix[r].length; c++) {
        if (shape.matrix[r][c] === 1) {
          const gridR = startR + r;
          const gridC = startC + c;
          // Boundary check and collision check
          if (gridR < 0 || gridR >= GRID_SIZE || gridC < 0 || gridC >= GRID_SIZE || currentGrid[gridR][gridC] !== '') {
            return false;
          }
        }
      }
    }
    return true;
  };

  /**
   * Checks if any of the available shapes can be placed anywhere on the grid.
   * This is called after every move to determine if the game has reached a 'Game Over' state.
   * 
   * @param shapes - Array of shapes currently in the tray.
   * @param currentGrid - The current state of the game grid.
   * @returns boolean - True if no shapes can be placed (Game Over), false otherwise.
   */
  const checkGameOver = (shapes: Shape[], currentGrid: string[][]) => {
    for (const shape of shapes) {
      // Brute-force check every possible position on the grid for this shape
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          if (canPlaceShape(shape, r, c, currentGrid)) return false;
        }
      }
    }
    return true;
  };

  /**
   * Places a shape on the grid, checks for completed lines, and updates score/XP.
   * This is the core game loop function triggered when a player successfully drops a block.
   * 
   * @param shape - The shape being placed.
   * @param startR - The row index where the shape is dropped.
   * @param startC - The column index where the shape is dropped.
   */
  const placeShape = (shape: Shape, startR: number, startC: number) => {
    const newGrid = grid.map(row => [...row]);
    let blocksPlaced = 0;

    // 1. Fill the grid cells with the shape's color
    for (let r = 0; r < shape.matrix.length; r++) {
      for (let c = 0; c < shape.matrix[r].length; c++) {
        if (shape.matrix[r][c] === 1) {
          newGrid[startR + r][startC + c] = shape.color;
          blocksPlaced++;
        }
      }
    }

    // 2. Identify rows and columns that are now completely full
    const rowsToClear: number[] = [];
    const colsToClear: number[] = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      if (newGrid[r].every(cell => cell !== '')) rowsToClear.push(r);
    }

    for (let c = 0; c < GRID_SIZE; c++) {
      let isFull = true;
      for (let r = 0; r < GRID_SIZE; r++) {
        if (newGrid[r][c] === '') {
          isFull = false;
          break;
        }
      }
      if (isFull) colsToClear.push(c);
    }

    const linesCleared = rowsToClear.length + colsToClear.length;
    
    // 3. Clear the identified lines (set them back to empty strings)
    rowsToClear.forEach(r => {
      for (let c = 0; c < GRID_SIZE; c++) newGrid[r][c] = '';
    });

    colsToClear.forEach(c => {
      for (let r = 0; r < GRID_SIZE; r++) newGrid[r][c] = '';
    });

    // 4. Scoring logic: 
    // Base points = blocks placed * 10
    // Line bonus = lines cleared * 100 (multiplied by 1.5 if more than 1 line cleared at once)
    // Combo multiplier = total points * current combo streak
    const points = (blocksPlaced * XP_PER_BLOCK) + (linesCleared * XP_PER_LINE * (linesCleared > 1 ? COMBO_MULTIPLIER : 1));
    const finalPoints = Math.round(points * (combo > 0 ? combo : 1));

    setScore(prev => prev + finalPoints);
    setXp(prev => prev + finalPoints);
    setGrid(newGrid);
    
    // Trigger floating score at the placement position
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      const centerX = startC * (rect.width / GRID_SIZE) + (shape.matrix[0].length * (rect.width / GRID_SIZE)) / 2;
      const centerY = startR * (rect.height / GRID_SIZE) + (shape.matrix.length * (rect.height / GRID_SIZE)) / 2;
      
      const newFloatingScore = {
        id: `score-${Date.now()}-${Math.random()}`,
        score: finalPoints,
        x: centerX,
        y: centerY
      };
      
      setFloatingScores(prev => [...prev, newFloatingScore]);
      setTimeout(() => {
        setFloatingScores(prev => prev.filter(fs => fs.id !== newFloatingScore.id));
      }, 1000);
    }
    
    if (linesCleared > 0) {
      setCombo(prev => {
        const next = prev + 1;
        if (next > maxCombo) setMaxCombo(next);
        return next;
      });
      setTotalLinesCleared(prev => prev + linesCleared);
      haptic.notification('success');
      playSound('clear', soundEnabled);
      
      // Trigger screen shake for combos
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 300);
    } else {
      setCombo(0);
      haptic.impact('medium');
      playSound('place', soundEnabled);
    }

    // 5. Refill the shapes tray if all 3 shapes have been used
    const remainingShapes = availableShapes.filter(s => s.id !== shape.id);
    if (remainingShapes.length === 0) {
      const nextShapes = getRandomShapes(3, level);
      setAvailableShapes(nextShapes);
      // Check if the new set of shapes can be placed; if not, game over.
      if (checkGameOver(nextShapes, newGrid)) handleGameOver(score + finalPoints);
    } else {
      setAvailableShapes(remainingShapes);
      // Check if remaining shapes can still be placed.
      if (checkGameOver(remainingShapes, newGrid)) handleGameOver(score + finalPoints);
    }
  };

  /**
   * Handles game over state, updates high score.
   */
  const handleGameOver = async (finalScore: number) => {
    setGameOver(true);
    setIsSubmitted(false);
    setSubmitError(null);
    haptic.notification('error');

    if (finalScore > highScore) {
      setHighScore(finalScore);
      localStorage.setItem('blockBlast_highScore', finalScore.toString());
    }

    // Auto-submit if username is already saved
    const savedUsername = localStorage.getItem('blockBlast_username');
    if (savedUsername) {
      // We need to wait a tiny bit to ensure state is updated or just use the local variables
      setTimeout(() => {
        submitScore();
      }, 500);
    }
  };

  /**
   * Submits the score to the leaderboard with username validation.
   */
  const submitScore = async () => {
    // 1. Basic validation
    if (!username || username.trim().length < 3) {
      setSubmitError("Username must be at least 3 characters.");
      return;
    }
    if (username.length > 20) {
      setSubmitError("Username must be 20 characters or less.");
      return;
    }
    
    // Alphanumeric and underscores only
    const validChars = /^[a-zA-Z0-9_]+$/;
    if (!validChars.test(username)) {
      setSubmitError("Only letters, numbers, and underscores allowed.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const currentUserId = tg?.initDataUnsafe?.user?.id?.toString() || 'local';
      
      // 2. Check for uniqueness if Firebase is available
      if (db) {
        // Check if username is taken by SOMEONE ELSE
        const nameQuery = query(collection(db, 'leaderboard'), where('username', '==', username.trim()));
        const nameSnapshot = await getDocs(nameQuery);
        const nameTakenByOther = nameSnapshot.docs.some(doc => doc.data().userId !== currentUserId);
        
        if (nameTakenByOther) {
          setSubmitError("This username is already taken.");
          setIsSubmitting(false);
          return;
        }

        // Check if THIS USER already has a record
        const userQuery = query(collection(db, 'leaderboard'), where('userId', '==', currentUserId));
        const userSnapshot = await getDocs(userQuery);

        if (!userSnapshot.empty) {
          const existingDoc = userSnapshot.docs[0];
          const existingData = existingDoc.data();
          
          // Update if score is higher
          if (score > existingData.score) {
            await updateDoc(doc(db, 'leaderboard', existingDoc.id), {
              username: username.trim(),
              score: score,
              level: level,
              linesCleared: totalLinesCleared,
              maxCombo: maxCombo,
              timestamp: serverTimestamp()
            });
          } else {
            // Just update username if it changed
            await updateDoc(doc(db, 'leaderboard', existingDoc.id), {
              username: username.trim()
            });
          }
        } else {
          // Create new record
          const entry = {
            userId: currentUserId,
            username: username.trim(),
            score: score,
            level: level,
            linesCleared: totalLinesCleared,
            maxCombo: maxCombo,
            weekId: getWeekId(),
            timestamp: serverTimestamp()
          };
          await addDoc(collection(db, 'leaderboard'), entry);
        }
      } else {
        // Local storage fallback
        const local = JSON.parse(localStorage.getItem('blockBlast_leaderboard') || '[]');
        
        // Check uniqueness in local storage
        const nameTakenByOther = local.some((e: any) => e.username === username.trim() && e.userId !== currentUserId);
        
        if (nameTakenByOther) {
          setSubmitError("This username is already taken.");
          setIsSubmitting(false);
          return;
        }

        const existingIndex = local.findIndex((e: any) => e.userId === currentUserId);
        
        if (existingIndex !== -1) {
          if (score > local[existingIndex].score) {
            local[existingIndex] = {
              ...local[existingIndex],
              username: username.trim(),
              score: score,
              level: level,
              linesCleared: totalLinesCleared,
              maxCombo: maxCombo,
              timestamp: new Date().toISOString()
            };
          } else {
            local[existingIndex].username = username.trim();
          }
        } else {
          const entry = {
            userId: currentUserId,
            username: username.trim(),
            score: score,
            level: level,
            linesCleared: totalLinesCleared,
            maxCombo: maxCombo,
            weekId: getWeekId(),
            timestamp: new Date().toISOString()
          };
          local.push(entry);
        }

        local.sort((a: any, b: any) => b.score - a.score);
        localStorage.setItem('blockBlast_leaderboard', JSON.stringify(local.slice(0, 50)));
      }

      setIsSubmitted(true);
      localStorage.setItem('blockBlast_username', username.trim());
      setHasSavedUsername(true);
      haptic.notification('success');
      showToast("Score submitted successfully!", "success");
      fetchLeaderboard(); // Refresh leaderboard data
    } catch (e) {
      console.error("Error saving to leaderboard:", e);
      setSubmitError("Failed to submit score. Please try again.");
      showToast("Submission failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Shows a temporary toast notification.
   */
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Refreshes the available shapes in the tray (limited uses).
   */
  const refreshShapes = () => {
    if (refreshCount > 0 && !gameOver) {
      setAvailableShapes(getRandomShapes(3, level));
      setRefreshCount(prev => prev - 1);
      haptic.impact('medium');
    }
  };

  // --- DRAG HANDLERS ---

  /**
   * Triggered when user starts dragging a shape from the tray.
   */
  const handleDragStart = (shape: Shape, e: React.TouchEvent | React.MouseEvent) => {
    if (gameOver) return;
    setDraggedShape(shape);
    const pos = 'touches' in e ? e.touches[0] : e;
    setDragPosition({ x: pos.clientX, y: pos.clientY });
    
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      // Calculate cell size dynamically based on grid width to ensure perfect alignment
      const calculatedCellSize = (rect.width - 38) / GRID_SIZE;
      setCellSize(calculatedCellSize);
    }
    
    // Position the drag container immediately
    requestAnimationFrame(() => {
      if (dragContainerRef.current) {
        dragContainerRef.current.style.transform = `translate3d(${pos.clientX}px, ${pos.clientY}px, 0) translate(-50%, -50%)`;
      }
    });
    
    haptic.selection();
    playSound('select', soundEnabled);
  };

  /**
   * Updates drag position and calculates ghost (preview) position on the grid.
   */
  const handleDragMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!draggedShape) return;
    const pos = 'touches' in e ? e.touches[0] : e;
    
    // Direct DOM update for high performance (60fps)
    if (dragContainerRef.current) {
      dragContainerRef.current.style.transform = `translate3d(${pos.clientX}px, ${pos.clientY}px, 0) translate(-50%, -50%)`;
    }
    
    setDragPosition({ x: pos.clientX, y: pos.clientY });

    // Snap to grid logic
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      const currentCellSize = (rect.width - 38) / GRID_SIZE;
      const contentLeft = rect.left + 12;
      const contentTop = rect.top + 12;
      const cellWithGap = currentCellSize + 2;
      
      const shapeWidth = (draggedShape.matrix[0].length * currentCellSize) + ((draggedShape.matrix[0].length - 1) * 2);
      const shapeHeight = (draggedShape.matrix.length * currentCellSize) + ((draggedShape.matrix.length - 1) * 2);
      
      const shapeLeft = pos.clientX - shapeWidth / 2;
      const shapeTop = pos.clientY - shapeHeight / 2;
      
      const relX = shapeLeft - contentLeft;
      const relY = shapeTop - contentTop;
      
      const c = Math.round(relX / cellWithGap);
      const r = Math.round(relY / cellWithGap);

      if (r > -GRID_SIZE && r < GRID_SIZE && c > -GRID_SIZE && c < GRID_SIZE) {
        setGhostPosition({ r, c });
      } else {
        setGhostPosition(null);
      }
    }
  };

  /**
   * Handles dropping the shape. Places it if position is valid.
   */
  const handleDragEnd = () => {
    if (draggedShape && ghostPosition) {
      if (canPlaceShape(draggedShape, ghostPosition.r, ghostPosition.c, grid)) {
        placeShape(draggedShape, ghostPosition.r, ghostPosition.c);
      }
    }
    setDraggedShape(null);
    setGhostPosition(null);
  };

  // --- RENDER ---
  const renderMenu = () => (
    <div className="flex flex-col h-full w-full max-w-md mx-auto select-none overflow-hidden bg-[#3252a8] items-center justify-center p-8">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-12"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-4 bg-white/20 blur-2xl rounded-full animate-pulse" />
            <div className="relative grid grid-cols-3 gap-2 p-4 bg-white/10 rounded-3xl border border-white/20 backdrop-blur-sm">
              {[1, 1, 1, 1, 1, 1, 1, 1, 1].map((_, i) => (
                <div key={i} className="w-8 h-8 bg-yellow-400 rounded-lg shadow-[inset_2px_2px_2px_rgba(255,255,255,0.4),inset_-2px_-2px_2px_rgba(0,0,0,0.4)]" />
              ))}
            </div>
          </div>
          <h1 className="text-6xl font-black text-white tracking-tighter text-center leading-none">
            BLOCK<br/>BLAST
          </h1>
        </div>

        <div className="flex flex-col gap-4 w-full">
          <button 
            onClick={() => setIsMenu(false)}
            className="w-full py-6 bg-white text-[#3252a8] font-black rounded-[2rem] shadow-[0_8px_0_#cbd5e1] active:translate-y-1 active:shadow-[0_4px_0_#cbd5e1] transition-all text-2xl uppercase tracking-widest flex items-center justify-center gap-3"
          >
            <Play fill="currentColor" size={28} />
            Play
          </button>

          <button 
            onClick={() => setShowLeaderboard(true)}
            className="w-full py-5 bg-amber-400 text-white font-black rounded-[2rem] shadow-[0_8px_0_#d97706] active:translate-y-1 active:shadow-[0_4px_0_#d97706] transition-all text-xl uppercase tracking-widest flex items-center justify-center gap-3"
          >
            <Crown fill="currentColor" size={24} />
            Rating
          </button>

          {/* How to Play Button: Triggers the onboarding tutorial */}
          <button 
            onClick={() => { setOnboardingStep(0); setShowOnboarding(true); }}
            className="w-full py-5 bg-blue-500 text-white font-black rounded-[2rem] shadow-[0_8px_0_#1e3a8a] active:translate-y-1 active:shadow-[0_4px_0_#1e3a8a] transition-all text-xl uppercase tracking-widest flex items-center justify-center gap-4 px-8"
          >
            {/* Gamepad2 icon - moved slightly right and made more prominent with thicker stroke as requested */}
            <Gamepad2 size={32} strokeWidth={3} className="translate-y-[-1px] ml-2 shrink-0" />
            <span>How to Play</span>
          </button>
        </div>
      </motion.div>
    </div>
  );

  const renderGame = () => (
    <div className="flex flex-col h-full w-full max-w-md mx-auto select-none overflow-hidden bg-transparent">
      {/* Header Section: Displays current score, high score, and level progress */}
      <div className="p-6 flex flex-col items-center z-10">
        <div className="flex justify-between w-full items-start">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 bg-white/10 rounded-full text-white/80 hover:bg-white/20 transition-colors"
              title="Open Settings"
            >
              <Settings size={24} />
            </button>
            <button 
              onClick={restartGame}
              className="p-2 bg-white/10 rounded-full text-white/80 hover:bg-white/20 transition-colors"
              title="Restart Game"
            >
              <RotateCcw size={24} />
            </button>
            <div className="flex flex-col">
              <span className="text-5xl font-black text-white">{score}</span>
            </div>
          </div>
          
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-1 text-[#ffcc33]">
              <Crown size={28} fill="currentColor" />
            </div>
            <span className="text-2xl font-black text-[#ffcc33]">{highScore}</span>
          </div>
        </div>

        {/* Level Progress Bar */}
        <div className="w-full mt-4 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/60 font-black whitespace-nowrap">Level {level}</span>
          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden border border-white/5">
            <motion.div 
              className="h-full bg-white/80"
              initial={{ width: 0 }}
              animate={{ width: `${(xp / xpToNextLevel) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Grid Container: The main game board */}
      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div 
          ref={gridRef}
          animate={isShaking ? {
            x: [0, -10, 10, -10, 10, 0],
            y: [0, 5, -5, 5, -5, 0]
          } : {}}
          transition={{ duration: 0.3 }}
          className="relative grid grid-cols-8 gap-[2px] p-2 bg-[#0a122a] rounded-xl aspect-square w-full max-w-[400px] border-[4px] border-[#0a122a]"
          style={{ gridTemplateRows: 'repeat(8, 1fr)' }}
        >
          {/* Floating Scores */}
          <AnimatePresence>
            {floatingScores.map(fs => (
              <motion.div
                key={fs.id}
                initial={{ opacity: 0, scale: 0.5, y: 0 }}
                animate={{ opacity: 1, scale: 1.2, y: -100 }}
                exit={{ opacity: 0, scale: 1.5 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute pointer-events-none z-50 font-black text-2xl text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                style={{ 
                  left: fs.x, 
                  top: fs.y,
                  transform: 'translate(-50%, -50%)' 
                }}
              >
                +{fs.score}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Render the 8x8 grid cells */}
          {grid.map((row, r) => (
            <React.Fragment key={`grid-row-${r}`}>
              {row.map((cell, c) => (
                <div 
                  key={`grid-cell-${r}-${c}`} 
                  className={cn(
                    "rounded-[4px] relative overflow-hidden border border-black/10 transition-all duration-200",
                    // 3D effect: shadow for filled blocks, inset shadow for empty cells
                    cell ? cn(cell, "shadow-[0_4px_0_rgba(0,0,0,0.3)]") : "bg-[#1a2b4b] shadow-[inset_0_3px_6px_rgba(0,0,0,0.5)]"
                  )}
                >
                  {/* Beveling effect for filled blocks */}
                  {cell && (
                    <>
                      <div className="absolute inset-0 border-[4px] border-t-white/40 border-l-white/20 border-r-black/20 border-b-black/40 pointer-events-none" />
                      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                    </>
                  )}
                </div>
              ))}
            </React.Fragment>
          ))}

          {/* Ghost Preview - Snapping instantly, no transitions */}
          {draggedShape && ghostPosition && (
            <div 
              className="absolute inset-0 pointer-events-none grid grid-cols-8 gap-[2px] p-2"
              style={{ gridTemplateRows: 'repeat(8, 1fr)' }}
            >
              {draggedShape.matrix.map((row, r) => (
                <React.Fragment key={`ghost-row-${r}`}>
                  {row.map((val, c) => {
                    if (val === 0) return null;
                    const gridR = ghostPosition.r + r;
                    const gridC = ghostPosition.c + c;
                    if (gridR < 0 || gridR >= GRID_SIZE || gridC < 0 || gridC >= GRID_SIZE) return null;
                    
                    const isValid = canPlaceShape(draggedShape, ghostPosition.r, ghostPosition.c, grid);
                    
                    return (
                      <div 
                        key={`ghost-${r}-${c}`}
                        className={cn(
                          "rounded-[4px] border border-white/10",
                          isValid ? "bg-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)]" : "bg-red-500/10"
                        )}
                        style={{ 
                          gridRowStart: gridR + 1, 
                          gridColumnStart: gridC + 1,
                        }}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Combo Display */}
      <AnimatePresence mode="wait">
        {combo > 1 && (
          <motion.div 
            key={`combo-${combo}`}
            initial={{ opacity: 0, scale: 0.5, rotate: -10, y: 20 }}
            animate={{ 
              opacity: 1, 
              scale: [1, 1.2, 1], 
              rotate: [0, 5, -5, 0],
              y: 0 
            }}
            exit={{ opacity: 0, scale: 1.5, y: -50 }}
            transition={{ 
              default: { type: "spring", stiffness: 400, damping: 15 },
              scale: { duration: 0.3 },
              rotate: { duration: 0.3 }
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50 flex flex-col items-center"
          >
            <motion.span 
              animate={{ 
                color: combo > 5 ? ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"] : "#3b82f6" 
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className={cn(
                "font-black italic drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] text-center",
                combo > 8 ? "text-6xl" : combo > 5 ? "text-5xl" : "text-4xl"
              )}
            >
              {combo > 8 ? "UNBELIEVABLE!" : 
               combo > 6 ? "PERFECT!" : 
               combo > 4 ? "AMAZING!" : 
               combo > 2 ? "GREAT!" : "GOOD!"}
            </motion.span>
            <motion.span 
              className={cn(
                "font-black italic text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]",
                combo > 8 ? "text-5xl" : combo > 5 ? "text-4xl" : "text-3xl"
              )}
            >
              COMBO x{combo}
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shapes Tray */}
      <div className="relative h-40 p-4 flex justify-around items-center gap-4">
        {/* Refresh Button */}
        {availableShapes.length > 0 && !gameOver && (
          <button 
            onClick={refreshShapes}
            disabled={refreshCount <= 0}
            className={cn(
              "absolute -top-6 right-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 z-20",
              refreshCount > 0 ? "bg-white text-[#3252a8] border-2 border-[#3252a8]" : "bg-gray-300 text-gray-500 cursor-not-allowed"
            )}
          >
            <div className="relative flex items-center justify-center">
              <RefreshCw size={24} />
              <Play size={10} className="absolute fill-current ml-[1px]" />
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                {refreshCount}
              </span>
            </div>
          </button>
        )}

        {availableShapes.map((shape) => (
          <div 
            key={shape.id}
            className="relative flex items-center justify-center w-28 h-28"
            onTouchStart={(e) => handleDragStart(shape, e)}
            onMouseDown={(e) => handleDragStart(shape, e)}
          >
            <div 
              className={cn(
                "grid gap-[1px]",
                draggedShape?.id === shape.id ? "opacity-0" : "opacity-100"
              )}
              style={{ 
                gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)`,
                gridTemplateRows: `repeat(${shape.matrix.length}, 1fr)`
              }}
            >
              {shape.matrix.map((row, r) => (
                <React.Fragment key={`shape-${shape.id}-row-${r}`}>
                  {row.map((val, c) => (
                    <div 
                      key={`shape-cell-${shape.id}-${r}-${c}`}
                      className={cn(
                        "w-7 h-7 rounded-[3px] relative overflow-hidden",
                        val === 1 ? cn(shape.color, "border border-black/10 shadow-[0_2px_0_rgba(0,0,0,0.3)]") : "bg-transparent"
                      )}
                    >
                      {val === 1 && (
                        <>
                          <div className="absolute inset-0 border-[3px] border-t-white/40 border-l-white/20 border-r-black/20 border-b-black/40 pointer-events-none" />
                          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                        </>
                      )}
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Ad Block Placeholder: Reserved space for future monetization */}
      {showAd && (
        <div className="px-4 pb-4 w-full">
          <div className="bg-white/10 border border-white/20 rounded-2xl p-4 flex flex-col items-center gap-2 relative overflow-hidden">
            <button 
              onClick={() => setShowAd(false)}
              className="absolute top-2 right-2 text-white/40 hover:text-white"
            >
              <X size={16} />
            </button>
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Advertisement</span>
            <div className="w-full h-20 bg-white/5 rounded-xl flex items-center justify-center border border-dashed border-white/10">
              <span className="text-white/20 font-black italic">ADS PLACEHOLDER</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Dragged Shape: The shape currently being moved by the user */}
      {draggedShape && (
        <div 
          ref={dragContainerRef}
          className="fixed pointer-events-none z-50 transition-none"
          style={{ 
            left: 0,
            top: 0,
            willChange: 'transform',
            filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.4))'
          }}
        >
          <div 
            className="grid gap-[2px] transition-none"
            style={{ 
              gridTemplateColumns: `repeat(${draggedShape.matrix[0].length}, 1fr)`,
              gridTemplateRows: `repeat(${draggedShape.matrix.length}, 1fr)`
            }}
          >
              {draggedShape.matrix.map((row, r) => (
                <React.Fragment key={`drag-row-${draggedShape.id}-${r}`}>
                  {row.map((val, c) => (
                    <div 
                      key={`drag-cell-${draggedShape.id}-${r}-${c}`}
                    className={cn(
                      "rounded-[4px] relative overflow-hidden transition-none",
                      val === 1 ? cn(draggedShape.color, "border border-black/20 shadow-[0_6px_0_rgba(0,0,0,0.4),0_12px_20px_rgba(0,0,0,0.3)]") : "bg-transparent"
                    )}
                    style={{ 
                      width: `${cellSize}px`,
                      height: `${cellSize}px`
                    }}
                  >
                    {val === 1 && (
                      <>
                        <div className="absolute inset-0 border-[6px] border-t-white/40 border-l-white/20 border-r-black/20 border-b-black/40 pointer-events-none transition-none" />
                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none transition-none" />
                      </>
                    )}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full max-w-md mx-auto select-none overflow-hidden bg-transparent" 
         onTouchMove={handleDragMove} 
         onTouchEnd={handleDragEnd}
         onMouseMove={handleDragMove}
         onMouseUp={handleDragEnd}>
      
      {isMenu ? renderMenu() : renderGame()}

      {/* Modals */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl"
            >
              <div className="p-8 flex flex-col gap-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-3xl font-black text-slate-800 tracking-tight">SETTINGS</h2>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="flex flex-col gap-4">
                  <button 
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    className="flex items-center justify-between p-5 bg-slate-50 rounded-3xl hover:bg-slate-100 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white rounded-2xl shadow-sm text-slate-600 group-active:scale-90 transition-transform">
                        {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
                      </div>
                      <span className="font-bold text-slate-700">Sound Effects</span>
                    </div>
                    <div className={cn(
                      "w-12 h-6 rounded-full transition-colors relative",
                      soundEnabled ? "bg-green-500" : "bg-slate-300"
                    )}>
                      <motion.div 
                        animate={{ x: soundEnabled ? 24 : 4 }}
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                      />
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                      setShowSettings(false);
                      setIsMenu(true);
                    }}
                    className="flex items-center gap-4 p-5 bg-slate-50 rounded-3xl hover:bg-slate-100 transition-all group"
                  >
                    <div className="p-3 bg-white rounded-2xl shadow-sm text-slate-600 group-active:scale-90 transition-transform">
                      <Home size={24} />
                    </div>
                    <span className="font-bold text-slate-700">Main Menu</span>
                  </button>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-5 bg-[#3252a8] text-white font-black rounded-3xl shadow-lg active:scale-95 transition-transform uppercase tracking-widest mt-2"
                >
                  Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gameOver && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white text-black w-full max-w-sm rounded-[2.5rem] p-8 flex flex-col items-center text-center shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="w-16 h-16 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mb-4">
                <X size={32} strokeWidth={3} />
              </div>
              <h2 className="text-3xl font-black mb-1">GAME OVER</h2>
              <p className="text-gray-500 mb-6 font-medium">Final Score: <span className="text-blue-600 font-black">{score}</span></p>
              
              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 w-full mb-6">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold block mb-1">Lines</span>
                  <span className="text-xl font-black text-slate-700">{totalLinesCleared}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold block mb-1">Max Combo</span>
                  <span className="text-xl font-black text-slate-700">x{maxCombo}</span>
                </div>
              </div>

              {/* Leaderboard Submission */}
              {!isSubmitted ? (
                <div className="w-full bg-slate-50 p-5 rounded-3xl border border-slate-100 mb-6">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">Leaderboard Submission</span>
                  
                  {!hasSavedUsername ? (
                    <div className="relative mb-3">
                      <input 
                        type="text" 
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter username..."
                        maxLength={20}
                        className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 focus:border-blue-500 outline-none transition-all"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">
                        {username.length}/20
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-white border-2 border-slate-100 rounded-xl px-4 py-3 mb-3">
                      <div className="flex flex-col items-start">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Submit as</span>
                        <span className="font-black text-slate-700">{username}</span>
                      </div>
                      <button 
                        onClick={() => setHasSavedUsername(false)}
                        className="text-[10px] font-black text-blue-500 hover:text-blue-600 uppercase tracking-widest"
                      >
                        Edit
                      </button>
                    </div>
                  )}

                  {submitError && (
                    <p className="text-red-500 text-xs font-bold mb-3">{submitError}</p>
                  )}
                  <button 
                    onClick={submitScore}
                    disabled={isSubmitting}
                    className="w-full bg-blue-500 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "SUBMITTING..." : "SUBMIT SCORE"}
                  </button>
                </div>
              ) : (
                <div className="w-full bg-green-50 p-5 rounded-3xl border border-green-100 mb-6 flex flex-col items-center">
                  <div className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center mb-2">
                    <Check size={20} strokeWidth={3} />
                  </div>
                  <span className="text-green-600 font-black text-sm">SCORE SUBMITTED!</span>
                </div>
              )}

              <div className="flex flex-col gap-3 w-full">
                <button 
                  onClick={restartGame}
                  className="w-full bg-[#3252a8] text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-blue-900/20"
                >
                  <Play size={20} fill="currentColor" />
                  PLAY AGAIN
                </button>
                
                <button 
                  onClick={() => { setGameOver(false); setShowLeaderboard(true); }}
                  className="w-full bg-slate-100 text-slate-600 font-black py-4 rounded-2xl hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Trophy size={18} />
                  RANK
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showLeaderboard && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden flex flex-col max-h-[80vh] shadow-2xl"
            >
              <div className="p-6 flex justify-between items-center bg-white border-b border-slate-100 shadow-sm">
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black flex items-center gap-2 text-slate-800">
                    <Crown className="text-amber-500" />
                    LEADERBOARD
                  </h2>
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 font-black mt-0.5">
                    Weekly Top Players
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={resetLeaderboard}
                    className="p-2 bg-red-50 text-red-500 rounded-full hover:bg-red-100 transition-colors"
                    title="Reset Leaderboard"
                  >
                    <RotateCcw size={20} />
                  </button>
                  <button 
                    onClick={() => setShowLeaderboard(false)}
                    className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {leaderboardData.length > 0 ? leaderboardData.map((entry, index) => (
                  <motion.div 
                    key={entry.id || `leader-item-${index}-${entry.userId || entry.username || 'anon'}-${entry.score}-${entry.timestamp || Date.now()}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-2xl border transition-all",
                      index === 0 ? "bg-amber-50 border-amber-200 shadow-sm" : "bg-slate-50 border-slate-100"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center font-black text-lg shadow-sm",
                        index === 0 ? "bg-amber-400 text-white" : 
                        index === 1 ? "bg-slate-300 text-white" : 
                        index === 2 ? "bg-orange-300 text-white" : "bg-white text-slate-400"
                      )}>
                        {index + 1}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-700 truncate max-w-[120px]">
                          {entry.username || entry.name || 'Player'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-tighter">
                          Points: {entry.score.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xl font-black text-slate-800">{entry.score.toLocaleString()}</span>
                    </div>
                  </motion.div>
                )) : (
                  <div className="flex flex-col items-center justify-center py-20 opacity-20">
                    <Crown size={64} className="mb-4" />
                    <span className="font-black uppercase tracking-widest text-sm">No scores yet!</span>
                  </div>
                )}
              </div>
              
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
                <button 
                  onClick={() => setShowLeaderboard(false)}
                  className="w-full py-4 bg-[#3252a8] text-white font-black rounded-2xl shadow-lg active:scale-95 transition-transform uppercase tracking-widest"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showLevelUp && (
          <motion.div 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1.2, opacity: 1 }}
            exit={{ scale: 2, opacity: 0 }}
            className="fixed inset-0 z-[120] pointer-events-none flex items-center justify-center"
          >
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white px-10 py-6 rounded-3xl border-4 border-white/20 backdrop-blur-sm">
              <h2 className="text-5xl font-black italic tracking-tighter">LEVEL UP!</h2>
              <div className="text-center text-blue-100 font-black uppercase tracking-widest text-xs mt-1">
                Difficulty Increased
              </div>
            </div>
          </motion.div>
        )}

        {showOnboarding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white text-slate-800 w-full max-w-sm rounded-[3rem] p-8 flex flex-col items-center text-center shadow-2xl"
            >
              <AnimatePresence mode="wait">
                {onboardingStep === 0 && (
                  <motion.div 
                    key="step0"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col items-center"
                  >
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center mb-6">
                      <Trophy size={40} strokeWidth={2.5} />
                    </div>
                    <h2 className="text-3xl font-black mb-4 tracking-tight">WELCOME!</h2>
                    <p className="text-slate-500 font-bold leading-relaxed">
                      Block Blast is a puzzle game where your goal is to score as many points as possible by placing blocks on the grid.
                    </p>
                  </motion.div>
                )}

                {onboardingStep === 1 && (
                  <motion.div 
                    key="step1"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col items-center"
                  >
                    <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-3xl flex items-center justify-center mb-6">
                      <Play size={40} fill="currentColor" className="rotate-90" />
                    </div>
                    <h2 className="text-3xl font-black mb-4 tracking-tight">DRAG BLOCKS</h2>
                    <p className="text-slate-500 font-bold leading-relaxed">
                      Drag shapes from the tray at the bottom and drop them onto the 8x8 grid. You can place them anywhere they fit!
                    </p>
                  </motion.div>
                )}

                {onboardingStep === 2 && (
                  <motion.div 
                    key="step2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col items-center"
                  >
                    <div className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mb-6">
                      <div className="grid grid-cols-2 gap-1">
                        <div className="w-4 h-4 bg-green-500 rounded-sm" />
                        <div className="w-4 h-4 bg-green-500 rounded-sm" />
                        <div className="w-4 h-4 bg-green-500 rounded-sm" />
                        <div className="w-4 h-4 bg-green-500 rounded-sm" />
                      </div>
                    </div>
                    <h2 className="text-3xl font-black mb-4 tracking-tight">CLEAR LINES</h2>
                    <p className="text-slate-500 font-bold leading-relaxed">
                      Fill an entire row or column to clear it. Clearing multiple lines at once gives you a huge score bonus!
                    </p>
                  </motion.div>
                )}

                {onboardingStep === 3 && (
                  <motion.div 
                    key="step3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col items-center"
                  >
                    <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-3xl flex items-center justify-center mb-6">
                      <X size={40} strokeWidth={3} />
                    </div>
                    <h2 className="text-3xl font-black mb-4 tracking-tight">STRATEGY</h2>
                    <p className="text-slate-500 font-bold leading-relaxed">
                      The game ends when you can't fit any more blocks. Plan ahead and keep the grid clear to survive!
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-4 w-full mt-10">
                {onboardingStep > 0 && (
                  <button 
                    onClick={() => setOnboardingStep(prev => prev - 1)}
                    className="flex-1 py-5 bg-slate-100 text-slate-500 font-black rounded-3xl active:scale-95 transition-transform uppercase tracking-widest"
                  >
                    Back
                  </button>
                )}
                <button 
                  onClick={() => {
                    if (onboardingStep < 3) {
                      setOnboardingStep(prev => prev + 1);
                    } else {
                      setShowOnboarding(false);
                      localStorage.setItem('blockBlast_onboarded', 'true');
                    }
                  }}
                  className="flex-[2] py-5 bg-[#3252a8] text-white font-black rounded-3xl shadow-lg active:scale-95 transition-transform uppercase tracking-widest"
                >
                  {onboardingStep < 3 ? 'Next' : 'Got it!'}
                </button>
              </div>

              <div className="flex gap-2 mt-6">
                {[0, 1, 2, 3].map(i => (
                  <div 
                    key={i} 
                    className={cn(
                      "w-2 h-2 rounded-full transition-all duration-300",
                      onboardingStep === i ? "w-6 bg-[#3252a8]" : "bg-slate-200"
                    )} 
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[1000] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[200px]"
            style={{ 
              backgroundColor: toast.type === 'error' ? '#ef4444' : toast.type === 'success' ? '#22c55e' : '#3b82f6',
              color: 'white'
            }}
          >
            {toast.type === 'success' && <Check size={18} strokeWidth={3} />}
            {toast.type === 'error' && <X size={18} strokeWidth={3} />}
            <span className="font-bold text-sm">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
