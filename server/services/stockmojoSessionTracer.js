// server/services/stockmojoSessionTracer.js — Automated StockMojo Session & Auth Headers Tracer
// Automatically launches a background browser session, intercepts network requests to StockMojo,
// and extracts live `T`, `J`, `Cookie`, and `Authorization` headers for seamless historical extraction.

const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');
const axios = require('axios');

const SESSION_FILE = path.join(__dirname, '../config/stockmojo_session.json');
const PROFILE_DIR = path.join(__dirname, '../data/stockmojo_browser_profile');

if (!fs.existsSync(path.dirname(SESSION_FILE))) {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
}
if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

function findChromeExecutable() {
    const platform = os.platform();
    if (platform === 'darwin') {
        const macPaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
        ];
        for (const p of macPaths) {
            if (fs.existsSync(p)) return p;
        }
    } else if (platform === 'win32') {
        const winPaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`
        ];
        for (const p of winPaths) {
            if (p && fs.existsSync(p)) return p;
        }
    } else {
        const linuxPaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
        ];
        for (const p of linuxPaths) {
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

function getStoredSession() {
    if (!fs.existsSync(SESSION_FILE)) return null;
    try {
        const raw = fs.readFileSync(SESSION_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

function saveSession(headers) {
    try {
        const data = {
            ...headers,
            captured_at: new Date().toISOString(),
            captured_epoch: Date.now()
        };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log('[StockMojo Tracer] ✅ Live session headers saved to stockmojo_session.json!');
        return data;
    } catch (err) {
        console.error('[StockMojo Tracer] Failed to write session file:', err.message);
        return headers;
    }
}

async function captureFreshSession({ headless = true, timeoutMs = 45000, targetSymbol = 'NIFTY' } = {}) {
    const chromePath = findChromeExecutable();
    if (!chromePath) {
        throw new Error('Google Chrome executable not found on this system. Please install Google Chrome.');
    }

    console.log(`[StockMojo Tracer] 🚀 Launching automated browser tracer (headless: ${headless})...`);

    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: headless ? 'new' : false,
        userDataDir: PROFILE_DIR,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800'
        ],
        defaultViewport: { width: 1280, height: 800 }
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );

        let capturedHeaders = null;
        let isDone = false;

        // Enable Request Interception to sniff headers
        await page.setRequestInterception(true);

        page.on('request', (req) => {
            const url = req.url();
            const headers = req.headers();

            // Trace headers sent to data.stockmojo.in or user.stockmojo.in
            if (url.includes('stockmojo.in') && (url.includes('/simulator') || url.includes('/v1/') || url.includes('data.stockmojo.in'))) {
                const tHeader = headers['t'] || headers['T'];
                const jHeader = headers['j'] || headers['J'];
                const authHeader = headers['authorization'] || headers['Authorization'];
                const cookieHeader = headers['cookie'] || headers['Cookie'];

                if (tHeader || jHeader || cookieHeader || authHeader) {
                    capturedHeaders = {
                        T: tHeader || '',
                        J: jHeader || '',
                        Authorization: authHeader || '',
                        Cookie: cookieHeader || '',
                        UserAgent: headers['user-agent'] || ''
                    };
                    isDone = true;
                }
            }
            req.continue().catch(() => {});
        });

        console.log('[StockMojo Tracer] Navigating to StockMojo Simulator...');
        await page.goto('https://stockmojo.in/simulator', {
            waitUntil: 'networkidle2',
            timeout: timeoutMs
        }).catch(() => {});

        // Wait a few seconds for network activity to capture headers
        const startTime = Date.now();
        while (!isDone && (Date.now() - startTime < timeoutMs)) {
            await new Promise((r) => setTimeout(r, 500));
        }

        // Also fetch all cookies from the page
        const cookies = await page.cookies();
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

        if (!capturedHeaders) {
            capturedHeaders = {
                T: '',
                J: '',
                Authorization: '',
                Cookie: cookieString,
                UserAgent: await page.evaluate(() => navigator.userAgent)
            };
        } else if (!capturedHeaders.Cookie && cookieString) {
            capturedHeaders.Cookie = cookieString;
        }

        const saved = saveSession(capturedHeaders);
        await browser.close();
        return saved;
    } catch (err) {
        await browser.close().catch(() => {});
        throw err;
    }
}

async function getValidSessionHeaders(forceRefresh = false) {
    let session = getStoredSession();

    // If no session exists or older than 12 hours or forced refresh
    const isStale = !session || !session.captured_epoch || (Date.now() - session.captured_epoch > 12 * 3600 * 1000);

    if (!session || forceRefresh || isStale) {
        console.log('[StockMojo Tracer] Refreshing session headers automatically...');
        try {
            session = await captureFreshSession({ headless: true });
        } catch (err) {
            console.warn('[StockMojo Tracer] Auto-capture headless failed:', err.message);
            if (session) {
                console.log('[StockMojo Tracer] Falling back to previously stored session headers.');
                return session;
            }
        }
    }

    return session || {};
}

// CLI test / Interactive login
if (require.main === module) {
    const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i');
    console.log(`\n======================================================`);
    console.log(`[StockMojo Auto-Session Tracer]`);
    console.log(`Mode: ${isInteractive ? 'Interactive (Login UI)' : 'Headless Auto-Trace'}`);
    console.log(`======================================================\n`);

    captureFreshSession({ headless: !isInteractive, timeoutMs: isInteractive ? 120000 : 30000 })
        .then((session) => {
            console.log('\n[StockMojo Tracer] Intercepted Session Details:');
            console.log('T Header:     ', session.T ? `${session.T.substring(0, 30)}...` : '(empty)');
            console.log('J Header:     ', session.J ? `${session.J.substring(0, 30)}...` : '(empty)');
            console.log('Cookie Length:', (session.Cookie || '').length, 'chars');
            console.log('\nSession is ready for automated historical data extraction!\n');
            process.exit(0);
        })
        .catch((err) => {
            console.error('[StockMojo Tracer Error]', err.message);
            process.exit(1);
        });
}

module.exports = {
    getValidSessionHeaders,
    captureFreshSession,
    getStoredSession,
    saveSession
};
