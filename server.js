import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Improved Firebase initialization with better error handling
let firebaseApp;
let db;

try {
  console.log("Initializing Firebase...");
  
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  
  // Fix newlines in private key for production
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });
  
  db = getFirestore();
  console.log("✅ Firebase initialized successfully");
} catch (error) {
  console.error("❌ Firebase initialization failed:", error.message);
  console.error("Please check your FIREBASE_SERVICE_ACCOUNT environment variable");
  process.exit(1);
}

// 🔐 GitHub OAuth setup
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: "https://backend-4ave.onrender.com/auth/github/callback",
      scope: ["user", "repo"]
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        if (!db) {
          throw new Error("Firestore not initialized");
        }

        const userRef = db.collection("users").doc(profile.username);
        const userDoc = await userRef.get();

        const userData = {
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName || profile.username,
          avatar_url: profile._json.avatar_url,
          accessToken: accessToken,
          lastLogin: new Date().toISOString(),
          points: 0,
          repoCount: 0,
          commitCount: 0,
          dailyCheckIns: 0
        };

        if (!userDoc.exists) {
          await userRef.set(userData);
        } else {
          await userRef.set(userData, { merge: true });
        }

        done(null, userData);
      } catch (error) {
        console.error("❌ Error in GitHub strategy:", error.message);
        done(error, null);
      }
    }
  )
);

app.use(passport.initialize());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "Developer Leaderboard API is running",
    timestamp: new Date().toISOString()
  });
});

// 🔑 Auth routes
app.get("/auth/github", passport.authenticate("github"));

app.get(
  "/auth/github/callback",
  passport.authenticate("github", { 
    session: false,
    failureRedirect: "https://devleaderboard.vercel.app/"
  }),
  (req, res) => {
    res.redirect(`https://devleaderboard.vercel.app/?username=${req.user.username}`);
  }
);

// ⚙️ Fetch GitHub data & calculate points
app.get("/api/points/:username", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { username } = req.params;
    const [repos, events] = await Promise.all([
      axios.get(`https://api.github.com/users/${username}/repos`),
      axios.get(`https://api.github.com/users/${username}/events/public`),
    ]);

    const repoCount = repos.data.length;
    const commitCount = events.data.filter((e) => e.type === "PushEvent").length;
    const points = repoCount * 5 + commitCount * 2;

    await db.collection("users").doc(username).set(
      { 
        repoCount, 
        commitCount, 
        points,
        lastUpdated: new Date().toISOString()
      },
      { merge: true }
    );

    res.json({ username, repoCount, commitCount, points });
  } catch (err) {
    console.error("❌ Error calculating points:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔓 DAILY CHECK-IN ENDPOINT
app.post("/api/checkin/:username", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { username } = req.params;
    const userRef = db.collection("users").doc(username);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const newPoints = (userData.points || 0) + 1;
      
      await userRef.update({
        points: newPoints,
        dailyCheckIns: (userData.dailyCheckIns || 0) + 1,
        lastCheckIn: new Date().toISOString()
      });
      
      res.json({ 
        success: true, 
        message: "Daily check-in successful! +1 point",
        newPoints: newPoints
      });
    } else {
      res.status(404).json({ 
        success: false, 
        error: "User not found. Please login with GitHub first." 
      });
    }
  } catch (error) {
    console.error("❌ Error during check-in:", error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🏆 Leaderboard endpoint
app.get("/api/leaderboard", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const snapshot = await db.collection("users")
      .orderBy("points", "desc")
      .get();
    
    const leaderboard = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        username: data.username,
        displayName: data.displayName || data.username,
        avatar_url: data.avatar_url,
        points: data.points || 0,
        repoCount: data.repoCount || 0,
        commitCount: data.commitCount || 0,
        dailyCheckIns: data.dailyCheckIns || 0,
        lastLogin: data.lastLogin,
        lastUpdated: data.lastUpdated
      };
    });
    
    res.json(leaderboard);
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check Firebase connection
app.get("/api/debug/firebase", async (req, res) => {
  try {
    if (!db) {
      return res.json({ status: "error", message: "Firestore not initialized" });
    }
    
    // Test a simple query
    const testRef = db.collection("test");
    await testRef.add({ test: true, timestamp: new Date().toISOString() });
    
    res.json({ 
      status: "success", 
      message: "Firebase connection is working",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ 
      status: "error", 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});