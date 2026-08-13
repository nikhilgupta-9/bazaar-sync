// utils/loadRazorpayCheckout.js — lazily injects Razorpay's Checkout script
// once. Not an npm package: this is the standard browser-integration path
// (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
let loadPromise = null;

export function loadRazorpayCheckout() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve(window.Razorpay);
        script.onerror = () => {
            loadPromise = null;
            reject(new Error("Failed to load Razorpay checkout script"));
        };
        document.body.appendChild(script);
    });

    return loadPromise;
}
