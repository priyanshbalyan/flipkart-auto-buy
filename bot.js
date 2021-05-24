'use strict';
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36';
const X_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36 FKUA/website/42/website/Desktop';
const COOKIE_PATH = 'cookie.txt';
const UPI_CODE = process.env.UPI_CODE;
const LID = new URLSearchParams(process.env.URL).get('lid');

const creds = { loginId: process.env.EMAIL, password: process.env.PASSWORD };

const mainHeaders = {
    'User-Agent': USER_AGENT,
    'X-User-Agent': X_USER_AGENT,
    'Content-Type': 'application/json'
}

const CHALK = {
    YELLOW: '\x1b[33m%s\x1b[0m',
    CYAN: '\x1b[36m%s\x1b[0m'
}

// ----------------------------- Helpers --------------------------
const temp = console.log
console.log = (arg1, arg2 = '', arg3 = '') => {
    const time = new Date().toLocaleString();
    temp(CHALK.CYAN, time, arg1, arg2, arg3);
}

async function request(url, config, method = 'post', retries = 10) {

    if (retries <= 0) throw new Error('MAX RETRIES EXCEEDED');
    const requestConfig = {
        url,
        method,
        ...config
    };
    let response;

    try {
        response = await axios(requestConfig);
    } catch (error) {
        if (error.response && error.response.status === 406) {
            console.log('DC Change occured. Retrying...');
            if (fs.existsSync(COOKIE_PATH)) fs.unlinkSync(COOKIE_PATH);
            await sleep(2000);
            return await request(url, config, method, retries - 1);
        }
        if (error.response && error.response.status === 429) {
            console.log('Too many requests, trying again in 60 seconds');
            await sleep(60000);
            return await request(url, config, method, retries - 1);
        }
        console.log('AXIOS ERROR:', error.message);
        console.log(error.response.status, error.response.data);
        process.exit();
    }

    if (!response || response.status !== 200) {
        if (response) console.log('REQUEST ERROR', response.status, response.data);
        else console.log('ERROR EMPTY RESPONSE');
        process.exit();
    }

    return response;
}

async function saveCookie(cookieString) {
    return fs.writeFileSync(COOKIE_PATH, cookieString);
}

function getCookie() {
    return fs.readFileSync(COOKIE_PATH, 'utf8');
}

async function sleep(ms) {
    await new Promise(resolve => setTimeout(() => resolve(), ms));
}

async function get(url) {
    const payload = {
        headers: {
            'User-Agent': USER_AGENT,
            'X-User-Agent': X_USER_AGENT,
        }
    };
    return await request(url, payload, 'get');
}

async function authGet(url) {
    const payload = {
        headers: {
            'User-Agent': USER_AGENT,
            'X-User-Agent': X_USER_AGENT,
            'Cookie': getCookie()
        }
    };
    return await request(url, payload, 'get');
}

async function post(url, config) {
    return await request(url, config, 'post');
}

async function authPost(url, config) {
    const payload = {
        headers: {...mainHeaders, 'Cookie': getCookie() },
        data: JSON.stringify(config),
    };

    return await request(url, payload, 'post');
}


// -------------------- Main Functions ---------------------
async function authenticate(retries = 3) {
    if (retries <= 0) console.log('Max login retries exceeded');

    // Checking for existing cookies
    if (!fs.existsSync(COOKIE_PATH)) {
        console.log('No login cookies found, authenticating...');
        const response = await get('https://flipkart.com/');

        // save initial cookie
        await saveCookie(response.headers['set-cookie'].join('; '));
        const authResponse = await authPost('https://1.rome.api.flipkart.com/api/4/user/authenticate', creds);
        console.log('AUTH RESPONSE:', authResponse.status, authResponse.data);
        // save auth cookies
        await saveCookie(authResponse.headers['set-cookie'].join('; '));

        if (!authResponse.data.SESSION.email) {
            console.log('Incorrect login, retrying...');
            await sleep(2000);
            return authenticate(retries - 1);
        }
        console.log('Successfully authenticated. Logged in as ', authResponse.data.SESSION.email);
    }


}

async function emptyCart() {
    console.log('Trying to empty cart');
    const viewCartPayload = {
        pageUri: "/viewcart?otracker=PP_GoToCart",
        pageContext: { fetchSeoData: "true" }
    };
    const fetchResponse = await authPost("https://1.rome.api.flipkart.com/api/4/page/fetch", viewCartPayload);
    try {
        const slots = fetchResponse.data['RESPONSE']['slots'];
        if (slots.length < 7) {
            console.log('Cart is already empty');
            return;
        }
        const data = slots[6]["widget"]["data"]["actions"][1]["value"]["popupDetails"]["data"]["actions"][1]["action"]["params"];
        const listId = data["listingId"];
        const productId = data["productId"];
        console.log('List id: ', listId);
        console.log('ProductId: ', productId);
        const emptyCartPayload = {
            "actionRequestContext": {
                "pageUri": "/viewcart",
                "type": "CART_REMOVE",
                "pageNumber": 1,
                "items": [{ "listingId": listId, "productId": productId }]
            }
        }
        await authPost("https://1.rome.api.flipkart.com/api/1/action/view", emptyCartPayload);
        console.log('Cart emptied.');
    } catch (error) {
        console.log('Error emptying cart: ', error.message);
    }
}

async function addToCart(retries = 10000, sleepTime = 5000) {
    if (!retries) {
        console.log('Max retries exceeded');
        process.exit();
    }
    // Adding product to cart
    console.log('Trying to add requested product to cart...');
    const cartPayload = {
        "cartContext": {
            [LID]: { "quantity": 1 }
        }
    };

    const cartResponse = await authPost("https://1.rome.api.flipkart.com/api/5/cart", cartPayload);
    if (cartResponse.data.RESPONSE.cartResponse[LID].errorMessage) {
        console.log('ERROR:', cartResponse.data.RESPONSE.cartResponse[LID].errorMessage);
        console.log('Retrying...');
        await sleep(sleepTime);
        await addToCart(retries - 1);
    }
}

async function checkout() {
    const payload = { checkoutType: "PHYSICAL" };
    const response = await authPost("https://1.rome.api.flipkart.com/api/5/checkout?loginFlow=false", payload);
    const itemId = response.data["RESPONSE"]["orderSummary"]["requestedStores"][0]["buyableStateItems"][0]["cartItemRefId"];
    // selecting user's default address
    const address = response.data['RESPONSE']['addressData']['billingAddressInfos'].filter(item => item.isDefault)[0];
    const addressId = address.id;

    console.log('ITEM ID:', itemId);
    console.log('ADDRESS ID:', addressId);
    console.log(`Default address found: \n${address.addressLine1} ${address.addressLine2} \n${address.city} ${address.pincode} \n${address.name} ${address.phone}`)
}

async function getPaymentToken() {
    const response = await authGet('https://1.rome.api.flipkart.com/api/3/checkout/paymentToken');

    const token = response.data["RESPONSE"]["getPaymentToken"]["token"]
    console.log('Received payment token:', CHALK.YELLOW, token);
    saveCookie(response.headers['set-cookie'].join('; '));
    return token;
}

async function pollForPayment(token, transactionId, sleep = 1000, retries = 100) {
    // Polling to check payment confirmation
    if (retries <= 0) throw new Error('Max Retries exceeded');
    const payload = { token: token, transactionId: transactionId };
    const response = await authPost('https://1.pay.payzippy.com/fkpay/api/v3/payments/upi/poll', payload)
    if (response.data['response_status'] !== 'SUCCESS') {
        console.log('Polling for payment completion...');
        await sleep(1000);
        return await pollForPayment(token, transactionId, sleep, retries - 1);
    }

    saveCookie(response.headers['set-cookie'].join('; '))

    console.log('Payment completed!');
    const primaryAction = response.data['primary_action'];
    const primaryActionURL = primaryAction['target'];
    const primaryActionData = primaryAction['parameters'];
    const payResponse = await authPost(primaryActionURL, primaryActionData);
    console.log(payResponse.status, payResponse.headers);
}

async function startPaymentProcess() {
    const token = await getPaymentToken();

    // Payment Step 1
    const payload1 = { "payment_instrument": "UPI", "token": token };
    // Uses UPI for payment
    const queryString1 = `https://1.payments.flipkart.com/fkpay/api/v3/payments/pay?instrument=UPI&token=${token}`;
    const r1 = await authPost(queryString1, payload1);

    // Payment Step 2
    const payload2 = { token: token };
    const queryString2 = `https://1.pay.payzippy.com/fkpay/api/v3/payments/upi/options?token=${token}`;
    const r2 = await authPost(queryString2, payload2);

    // Payment Step 3
    payload3 = {
        upi_details: {
            upi_code: UPI_CODE,
            payment_instrument: 'UPI_COLLECT',
            token: token
        }
    };
    const queryString3 = `https://1.pay.payzippy.com/fkpay/api/v3/payments/paywithdetails?token=${token}`;
    const r3 = await authPost(queryString3, payload3);

    console.log('UPI payment request sent. Accept the payment to confirm order of item');

    // Payment Step 4
    const payload4 = {
        upi_details: { app_code: 'collect_flow', upi_code: UPI_CODE },
        payment_instrument: 'UPI_COLLECT',
        token: token,
        section_info: { section_name: 'OTHERS' }
    }
    const queryString4 = `https://1.pay.payzippy.com/fkpay/api/v3/payments/paywithdetails?token=${token}`;
    const r4 = await authPost(queryString4, payload4);
    const transactionId = r4.data['txn_id']
    console.log('Transaction ID generated: ', transactionId);

    await pollForPayment(token, transactionId);
}

async function init() {
    await authenticate();
    await emptyCart();
    await addToCart();
    console.log('\x07');
    console.log('Product added to cart.');

    await checkout();
    await startPaymentProcess();
    console.log('Product bought. Check your email for order details');
}

init();