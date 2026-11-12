# Tank Duel Desktop (Electron)

This branch adds a Windows desktop shell around the existing Tank Duel web game.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run in development

```powershell
npm install
npm run start:desktop
```

Electron starts the existing authoritative HTTP/WebSocket game server on an available local port and opens the current game UI in a desktop window. No separate server terminal is required.

## Build a Windows installer

```powershell
npm install
npm run pack:win
```

The installer will be written to `dist/`.

## Multiplayer notes

This first desktop milestone runs a local copy of the game server. It is suitable for local/private-host development and testing. Online matchmaking between different PCs still needs a publicly reachable deployed game server. The current browser client connects to the same origin as the game page; a later networking configuration step will let desktop clients use the production server while retaining local/private-host mode.
