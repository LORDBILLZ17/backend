# GitHub Leaderboard API

## Overview
This is a Node.js API server built with Express that provides leaderboard functionality for GitHub users. It uses Passport.js for GitHub OAuth 2.0 authentication and Firebase Firestore for data persistence.

## Features
- **Express**: Handles routing and server-side logic for the RESTful API.
- **Firebase Firestore**: Serves as the NoSQL database for storing user profiles, points, and activity data.
- **Passport.js (passport-github2)**: Manages OAuth 2.0 authentication flow with GitHub.
- **Axios**: Facilitates server-side HTTP requests to the public GitHub API to fetch user data.

## Getting Started
### Installation
1.  **Clone the repository:**
    ```bash
    git clone https://github.com/LORDBILLZ17/backend.git
    ```
2.  **Navigate to the project directory:**
    ```bash
    cd backend
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Create a `.env` file** in the root directory and add the environment variables listed below.

5.  **Run the server:**
    ```bash
    node server.js
    ```
    The server will be running on `http://localhost:5000`.

### Environment Variables
You must create a `.env` file in the root of the project with the following variables:

-   `GITHUB_CLIENT_ID`: Your GitHub application's Client ID.
    ```
    GITHUB_CLIENT_ID="your_github_oauth_app_client_id"
    ```
-   `GITHUB_CLIENT_SECRET`: Your GitHub application's Client Secret.
    ```
    GITHUB_CLIENT_SECRET="your_github_oauth_app_client_secret"
    ```
-   `FIREBASE_SERVICE_ACCOUNT`: Your Firebase service account JSON key. The JSON must be stringified.
    ```
    FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"your-project-id",...}'
    ```

## API Documentation
### Base URL
`http://localhost:5000`

### Endpoints
#### GET /auth/github
Initiates the GitHub OAuth2 authentication process. Users will be redirected to GitHub to authorize the application.

**Request**:
No payload required.

**Response**:
Redirects to the GitHub authorization screen.

**Errors**:
- None directly from this endpoint; errors are handled by Passport.js or GitHub.

---
#### GET /auth/github/callback
The callback URL that GitHub redirects to after successful authentication. It handles user creation/update in the database and redirects to the frontend.

**Request**:
No payload required. GitHub provides `code` and `state` as query parameters.

**Response**:
Redirects to `http://localhost:5173/?username=<USERNAME>` upon success or `http://localhost:5173/` on failure.

**Errors**:
- Errors during database operations are logged to the console.

---
#### GET /api/points/:username
Calculates a user's points based on their public repository and commit counts from the GitHub API, then updates the user's record in Firestore.

**Request**:
URL parameter `username` is required.
Example: `/api/points/octocat`

**Response**:
```json
{
  "username": "octocat",
  "repoCount": 8,
  "commitCount": 0,
  "points": 40
}
```

**Errors**:
- **500 Internal Server Error**: If fetching data from the GitHub API fails or a database update error occurs.
  ```json
  {
    "error": "Request failed with status code 404"
  }
  ```

---
#### POST /api/checkin/:username
Allows a user to perform a daily check-in, awarding them 1 point.

**Request**:
URL parameter `username` is required. No request body.
Example: `/api/checkin/octocat`

**Response**:
```json
{
  "success": true,
  "message": "Daily check-in successful! +1 point",
  "newPoints": 41
}
```

**Errors**:
- **404 Not Found**: If the specified user does not exist in the database.
  ```json
  {
    "success": false,
    "error": "User not found. Please login with GitHub first."
  }
  ```
- **500 Internal Server Error**: For any other server-side or database errors.
  ```json
  {
    "success": false,
    "error": "Firestore error message here"
  }
  ```

---
#### GET /api/leaderboard
Retrieves a list of all users from the database, ordered by their points in descending order.

**Request**:
No payload required.

**Response**:
```json
[
  {
    "id": "583231",
    "username": "octocat",
    "displayName": "The Octocat",
    "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
    "points": 41,
    "repoCount": 8,
    "commitCount": 0,
    "dailyCheckIns": 1,
    "lastLogin": "2023-10-27T10:00:00.000Z",
    "lastUpdated": "2023-10-27T10:05:00.000Z"
  },
  {
    "id": "123456",
    "username": "anotheruser",
    "displayName": "Another User",
    "avatar_url": "https://avatars.githubusercontent.com/u/123456?v=4",
    "points": 20,
    "repoCount": 2,
    "commitCount": 5,
    "dailyCheckIns": 0,
    "lastLogin": "2023-10-26T08:00:00.000Z",
    "lastUpdated": "2023-10-26T08:05:00.000Z"
  }
]
```

**Errors**:
- **500 Internal Server Error**: If the database query fails.
  ```json
  {
    "error": "Error fetching leaderboard: Firestore error message here"
  }
  ```

---
#### GET /api/debug/user/:username
A utility endpoint to fetch and view the raw data for a specific user stored in Firestore.

**Request**:
URL parameter `username` is required.
Example: `/api/debug/user/octocat`

**Response**:
**User Found**:
```json
{
  "exists": true,
  "data": {
    "id": "583231",
    "username": "octocat",
    "displayName": "The Octocat",
    "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
    "accessToken": "gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "lastLogin": "2023-10-27T10:00:00.000Z",
    "points": 41,
    "repoCount": 8,
    "commitCount": 0,
    "dailyCheckIns": 1
  }
}
```
**User Not Found**:
```json
{
  "exists": false,
  "message": "User not found in database"
}
```

**Errors**:
- **500 Internal Server Error**: For any server-side or database errors.
  ```json
  {
    "error": "Debug error: Firestore error message here"
  }
  ```
[![Readme was generated by Dokugen](https://img.shields.io/badge/Readme%20was%20generated%20by-Dokugen-brightgreen)](https://www.npmjs.com/package/dokugen)