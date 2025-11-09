import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";
import fetch from "node-fetch";
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

// Helper function to get ALL repositories (including paginated results)
async function getAllRepositories(username, accessToken = null) {
  let allRepos = [];
  let page = 1;
  const perPage = 100;
  
  try {
    while (true) {
      const headers = {};
      if (accessToken) {
        headers.Authorization = `token ${accessToken}`;
      }
      
      const response = await axios.get(
        `https://api.github.com/users/${username}/repos?per_page=${perPage}&page=${page}&sort=updated`,
        { headers }
      );
      
      if (response.data.length === 0) {
        break;
      }
      
      allRepos = allRepos.concat(response.data);
      
      // Check if we've reached the last page
      const linkHeader = response.headers.link;
      if (!linkHeader || !linkHeader.includes('rel="next"')) {
        break;
      }
      
      page++;
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return allRepos;
  } catch (error) {
    console.error(`Error fetching repositories for ${username}:`, error.message);
    throw error;
  }
}

// Helper function to get ALL commits from a repository
async function getCommitsForRepository(owner, repo, username, accessToken = null) {
  let allCommits = [];
  let page = 1;
  const perPage = 100;
  
  try {
    while (true) {
      const headers = {};
      if (accessToken) {
        headers.Authorization = `token ${accessToken}`;
      }
      
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/commits?author=${username}&per_page=${perPage}&page=${page}`,
        { headers }
      );
      
      if (response.data.length === 0) {
        break;
      }
      
      allCommits = allCommits.concat(response.data);
      
      // Check if we've reached the last page
      const linkHeader = response.headers.link;
      if (!linkHeader || !linkHeader.includes('rel="next"')) {
        break;
      }
      
      page++;
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return allCommits.length;
  } catch (error) {
    // Some repos might be empty or have no commits, or we might not have access
    if (error.response && error.response.status === 409) {
      // Empty repository
      return 0;
    }
    console.error(`Error fetching commits for ${owner}/${repo}:`, error.message);
    return 0;
  }
}

// ⚙️ Fetch ALL GitHub data & calculate points (COMPREHENSIVE VERSION)
app.get("/api/points/:username", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { username } = req.params;
    
    // Get user data to check if we have access token
    const userRef = db.collection("users").doc(username);
    const userDoc = await userRef.get();
    let accessToken = null;
    
    if (userDoc.exists && userDoc.data().accessToken) {
      accessToken = userDoc.data().accessToken;
    }

    console.log(`📊 Fetching comprehensive data for ${username}...`);

    // Get ALL repositories
    const allRepos = await getAllRepositories(username, accessToken);
    const repoCount = allRepos.length;

    console.log(`📁 Found ${repoCount} repositories for ${username}`);

    // Get total commits from ALL repositories
    let totalCommits = 0;
    let processedRepos = 0;
    
    // Process repositories in batches to avoid rate limiting
    for (const repo of allRepos) {
      try {
        const commitCount = await getCommitsForRepository(
          repo.owner.login, 
          repo.name, 
          username, 
          accessToken
        );
        
        totalCommits += commitCount;
        processedRepos++;
        
        console.log(`📝 ${repo.name}: ${commitCount} commits (${processedRepos}/${repoCount})`);
        
        // Add delay between repository requests
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`Error processing repo ${repo.name}:`, error.message);
        processedRepos++;
      }
    }

    // Calculate points (you can adjust the formula)
    const points = (repoCount * 10) + (totalCommits * 3);

    console.log(`🎯 Final stats for ${username}: ${repoCount} repos, ${totalCommits} commits, ${points} points`);

    // Update user data
    await userRef.set(
      { 
        repoCount, 
        commitCount: totalCommits, 
        points,
        lastUpdated: new Date().toISOString(),
        lastFullScan: new Date().toISOString()
      },
      { merge: true }
    );

    res.json({ 
      username, 
      repoCount, 
      commitCount: totalCommits, 
      points,
      message: `Comprehensive scan completed: ${repoCount} repositories, ${totalCommits} commits`
    });
  } catch (err) {
    console.error("❌ Error calculating comprehensive points:", err.message);
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
        lastUpdated: data.lastUpdated,
        lastFullScan: data.lastFullScan
      };
    });
    
    res.json(leaderboard);
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Quick scan endpoint (faster, uses public data only)
app.get("/api/quick-scan/:username", async (req, res) => {
  try {
    const { username } = req.params;
    
    // Get public repositories count
    const reposResponse = await axios.get(`https://api.github.com/users/${username}/repos?per_page=100`);
    const repoCount = reposResponse.data.length;

    // Get public events to estimate commits
    const eventsResponse = await axios.get(`https://api.github.com/users/${username}/events/public`);
    const commitCount = eventsResponse.data.filter((e) => e.type === "PushEvent").length;

    

    const SELF_URL = "https://backend-4ave.onrender.com/auth/github";

    setInterval(() => {
      fetch(SELF_URL + "/api/status")
        .then(() => console.log("Pinged self to stay awake"))
        .catch((err) => console.log("Ping failed:", err.message));
    }, 1000 * 60 * 3);

    // Calculate points
    const points = (repoCount * 5) + (commitCount * 2);

    res.json({
      username,
      repoCount,
      commitCount,
      points,
      message: "Quick scan completed (public data only)"
    });
  } catch (error) {
    console.error("❌ Error in quick scan:", error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});