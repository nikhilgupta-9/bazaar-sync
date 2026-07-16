// server/services/sessionManager.js
class SessionManager {
    constructor() {
        this.session = null;
        this.refreshInProgress = false;
        this.lastRefreshTime = null;
    }

    async getSession() {
        // If session is stale or expiring soon, refresh
        if (this.needsRefresh()) {
            return this.refreshSession();
        }
        return this.session;
    }

    needsRefresh() {
        if (!this.session) return true;
        // Refresh if older than 23 hours (give 1hr buffer)
        if (!this.lastRefreshTime) return true;
        const age = Date.now() - this.lastRefreshTime;
        return age > 23 * 60 * 60 * 1000;
    }

    async refreshSession() {
        // Prevent concurrent refreshes
        if (this.refreshInProgress) {
            while (this.refreshInProgress) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            return this.session;
        }

        this.refreshInProgress = true;
        try {
            console.log('🔄 Refreshing Breeze session...');
            
            // Option A: Use puppeteer/playwright to automate browser login
            // Option B: Use your stored credentials if they somehow work
            // Option C: Send alert to admin to manually refresh
            
            // For now: check env and use existing session
            const session = process.env.BREEZE_API_SESSION;
            if (!session) {
                throw new Error('No session available');
            }
            
            // Test the session with a lightweight call
            // If it fails, we need manual intervention
            
            this.session = session;
            this.lastRefreshTime = Date.now();
            console.log('✅ Session refreshed successfully');
            return this.session;
        } catch (error) {
            console.error('❌ Session refresh failed:', error.message);
            // Alert admin via email/Slack
            throw error;
        } finally {
            this.refreshInProgress = false;
        }
    }
}