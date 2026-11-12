'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { start } = require('../server');

let gameServer;
let mainWindow;

async function createWindow() {
  // Start the existing authoritative game server on an available local port.
  gameServer = await start(0);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e1424',
    title: 'Tank Duel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the system browser, never in the game window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${gameServer.port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start Tank Duel:', error);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error('Failed to recreate Tank Duel window:', error);
      app.quit();
    });
  }
});

app.on('before-quit', () => {
  if (gameServer) {
    const server = gameServer;
    gameServer = null;
    server.close().catch((error) => console.error('Server shutdown failed:', error));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
