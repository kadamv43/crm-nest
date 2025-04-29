const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');

let mainWindow;
let nestProcess = null; // Variable to keep track of the running NestJS process

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load your HTML file (where you will put the button)
  mainWindow.loadFile('index.html');
}

// Start NestJS process
function startNestJS() {
  if (nestProcess === null) {
    // Start the NestJS server using spawn
    nestProcess = spawn('npm', ['run', 'start:prod'], {
      cwd: path.join(__dirname, 'dist'),
    });

    nestProcess.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    nestProcess.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    nestProcess.on('close', (code) => {
      console.log(`NestJS process exited with code ${code}`);
      nestProcess = null;
    });
  }
}

// Stop NestJS process
function stopNestJS() {
  if (nestProcess) {
    nestProcess.kill('SIGINT'); // Send termination signal
    nestProcess = null;
  }
}

// Listen for start/stop events from renderer process (UI)
ipcMain.handle('start-nestjs', () => {
  startNestJS();
});

ipcMain.handle('stop-nestjs', () => {
  stopNestJS();
});

app.whenReady().then(() => {
  createWindow();

  // For MacOS specific behavior
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
