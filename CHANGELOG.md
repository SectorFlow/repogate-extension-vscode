# RepoGate VS Code Extension v1.10.0 - Changelog

This version introduces a complete overhaul of the Microsoft Entra ID authentication flow to provide persistent sessions and a seamless developer experience.

## ✨ New Features

- **Persistent Authentication**: Implemented the full OAuth 2.0 refresh token flow for Microsoft Entra ID. Your authentication session now persists across device restarts and extended periods of inactivity, for up to 90 days.
- **Automatic Token Refresh**: The extension now automatically refreshes your access token in the background, ensuring you stay signed in without interruption.
- **Startup Authentication**: On launch, the extension will automatically attempt to refresh your session if it has expired, getting you back to work faster.
- **Enhanced Security**: Implemented refresh token rotation, where a new refresh token is issued on each refresh, and the old one is invalidated. Refresh tokens are securely stored using encryption.

## 🐛 Bug Fixes

- **Resolved Session Expiration**: Fixed the core issue where authentication sessions would expire after a short period, requiring frequent re-authentication.

## 🛠️ Technical Changes

- **Backend**: 
    - Updated the database schema to securely store encrypted refresh tokens.
    - Overhauled the `/auth/entra/refresh` endpoint to use Microsoft refresh tokens for obtaining new access tokens.
    - The `/auth/entra/callback` endpoint now requests the `offline_access` scope and captures the refresh token.
- **VS Code Extension**:
    - The `authManager` now securely stores and manages both access and refresh tokens.
    - Implemented startup token refresh logic in `ensureAuthOrPrompt()`.
    - The `refreshToken()` method now sends the refresh token to the backend for rotation.
