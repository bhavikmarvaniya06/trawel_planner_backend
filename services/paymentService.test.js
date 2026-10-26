const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { createPaymentService, getRazorpayCredentials } = require("./paymentService");

const makeQuery = (resolve) => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: resolve,
    then(resolvePromise, rejectPromise) {
        return resolve().then(resolvePromise, rejectPromise);
    },
});

const createFixture = () => {
    const user = {
        _id: "user-1",
        freeTripUsed: false,
        tripCredits: 0,
        processedPaymentIds: [],
    };
    const packages = [];
    const payments = [];
    const fetchedPayments = new Map();
    const gateway = {
        orders: {
            create: async (order) => ({
                id: "order_test_123",
                amount: order.amount,
                currency: order.currency,
            }),
        },
        payments: {
            fetch: async (paymentId) => fetchedPayments.get(paymentId),
        },
    };

    const CreditPackageModel = {
        async updateOne(filter, update) {
            if (!packages.some((item) => item.key === filter.key) && update.$setOnInsert) {
                packages.push({ ...update.$setOnInsert, _id: `package-${packages.length + 1}` });
            }
        },
        find(filter) {
            return {
                sort() {
                    return {
                        lean: async () => packages.filter((item) => filter.active === undefined || item.active === filter.active),
                    };
                },
            };
        },
        findOne(filter) {
            return makeQuery(async () => packages.find((item) => item.key === filter.key && item.active === filter.active) || null);
        },
    };

    const PaymentModel = {
        async create(record) {
            const payment = { ...record, _id: `payment-${payments.length + 1}` };
            payments.push(payment);
            return payment;
        },
        async findOne(filter) {
            return payments.find((item) => (
                (!filter._id || item._id === filter._id)
                && (!filter.status || item.status === filter.status)
                && (!filter.razorpayPaymentId || item.razorpayPaymentId === filter.razorpayPaymentId)
                && (!filter.razorpayOrderId || item.razorpayOrderId === filter.razorpayOrderId)
                && (!filter.user || item.user === filter.user)
            )) || null;
        },
        async updateOne(filter, update) {
            const payment = payments.find((item) => item._id === filter._id);
            if (!payment || (filter.status?.$ne === "paid" && payment.status === "paid")) return { matchedCount: 0 };
            if (filter.$or && !filter.$or.some((condition) => (
                condition.razorpayPaymentId?.$exists === false && payment.razorpayPaymentId === undefined
                || condition.razorpayPaymentId === null && payment.razorpayPaymentId == null
                || condition.razorpayPaymentId === payment.razorpayPaymentId
            ))) return { matchedCount: 0 };
            Object.assign(payment, update.$set);
            return { matchedCount: 1 };
        },
    };

    const UserModel = {
        findById(id) {
            return makeQuery(async () => id === user._id ? user : null);
        },
        async updateOne(filter, update) {
            if (filter._id !== user._id) return { matchedCount: 0 };
            if (filter.processedPaymentIds?.$ne && user.processedPaymentIds.includes(filter.processedPaymentIds.$ne)) {
                return { matchedCount: 0 };
            }
            if (filter.freeTripUsed && filter.freeTripUsed.$ne === true && user.freeTripUsed === true) {
                return { matchedCount: 0 };
            }
            if (filter.tripCredits && user.tripCredits <= filter.tripCredits.$gt) return { matchedCount: 0 };
            if (update.$inc) {
                user.tripCredits += update.$inc.tripCredits;
            }
            if (update.$addToSet) {
                user.processedPaymentIds.push(update.$addToSet.processedPaymentIds);
            }
            if (update.$set) Object.assign(user, update.$set);
            return { matchedCount: 1 };
        },
        findOneAndUpdate(filter, update) {
            return makeQuery(async () => {
                if (filter._id !== user._id) return null;
                if (filter.freeTripUsed && user.freeTripUsed === true) return null;
                if (filter.tripCredits && user.tripCredits <= filter.tripCredits.$gt) return null;
                if (update.$set) Object.assign(user, update.$set);
                if (update.$inc) user.tripCredits += update.$inc.tripCredits;
                return user;
            });
        },
    };

    const service = createPaymentService({
        UserModel,
        PaymentModel,
        CreditPackageModel,
        credentialsFactory: () => ({ keyId: "rzp_test_mock", keySecret: "test_secret" }),
        gatewayFactory: () => gateway,
    });

    return { service, user, packages, payments, fetchedPayments };
};

const makeSignature = (orderId, paymentId) => crypto
    .createHmac("sha256", "test_secret")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

test("only accepts configured Razorpay Test Mode credentials", () => {
    const originalKeyId = process.env.RAZORPAY_KEY_ID;
    const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const originalMode = process.env.RAZORPAY_MODE;
    try {
        process.env.RAZORPAY_MODE = "test";
        process.env.RAZORPAY_KEY_ID = "rzp_test_example";
        process.env.RAZORPAY_KEY_SECRET = "example_test_secret";
        assert.deepEqual(getRazorpayCredentials(), {
            keyId: "rzp_test_example",
            keySecret: "example_test_secret",
        });

        process.env.RAZORPAY_KEY_ID = "rzp_live_example";
        assert.throws(getRazorpayCredentials, { statusCode: 503 });
    } finally {
        if (originalKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
        else process.env.RAZORPAY_KEY_ID = originalKeyId;
        if (originalKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
        else process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
        if (originalMode === undefined) delete process.env.RAZORPAY_MODE;
        else process.env.RAZORPAY_MODE = originalMode;
    }
});

test("creates a test order using only server-side package pricing", async () => {
    const { service, packages, payments } = createFixture();

    const order = await service.createOrder({ userId: "user-1", packageKey: "one-trip" });

    assert.equal(order.amount, 8900);
    assert.equal(order.currency, "INR");
    assert.equal(order.testMode, true);
    assert.equal(packages.length, 3);
    assert.equal(payments[0].amountPaise, 8900);
    assert.equal(payments[0].credits, 1);
    assert.equal(payments[0].status, "pending");
});

test("grants credits only after signature and captured-payment verification, idempotently", async () => {
    const { service, user, payments, fetchedPayments } = createFixture();
    await service.createOrder({ userId: "user-1", packageKey: "two-trips" });
    fetchedPayments.set("pay_test_123", {
        id: "pay_test_123",
        order_id: "order_test_123",
        status: "captured",
        amount: 14900,
        currency: "INR",
    });
    const callback = {
        userId: "user-1",
        orderId: "order_test_123",
        paymentId: "pay_test_123",
        signature: makeSignature("order_test_123", "pay_test_123"),
    };

    const [firstResult, secondResult] = await Promise.all([
        service.verifyPayment(callback),
        service.verifyPayment(callback),
    ]);

    assert.equal(firstResult.tripCredits, 2);
    assert.equal(secondResult.tripCredits, 2);
    assert.equal(user.tripCredits, 2);
    assert.equal(user.processedPaymentIds.length, 1);
    assert.equal(payments[0].status, "paid");
    assert.equal(payments[0].razorpayPaymentId, "pay_test_123");
});

test("rejects a captured payment whose order, amount, or currency differs", async () => {
    const { service, user, fetchedPayments } = createFixture();
    await service.createOrder({ userId: "user-1", packageKey: "one-trip" });
    fetchedPayments.set("pay_test_123", {
        order_id: "different_order",
        status: "captured",
        amount: 8900,
        currency: "INR",
    });

    await assert.rejects(
        service.verifyPayment({
            userId: "user-1",
            orderId: "order_test_123",
            paymentId: "pay_test_123",
            signature: makeSignature("order_test_123", "pay_test_123"),
        }),
        { statusCode: 400 }
    );
    assert.equal(user.tripCredits, 0);
});

test("does not allow a different account to verify an order", async () => {
    const { service, user } = createFixture();
    await service.createOrder({ userId: "user-1", packageKey: "one-trip" });

    await assert.rejects(
        service.verifyPayment({
            userId: "attacker",
            orderId: "order_test_123",
            paymentId: "pay_test_123",
            signature: makeSignature("order_test_123", "pay_test_123"),
        }),
        { statusCode: 404 }
    );
    assert.equal(user.tripCredits, 0);
});

test("rejects invalid signatures and does not grant credits", async () => {
    const { service, user } = createFixture();
    await service.createOrder({ userId: "user-1", packageKey: "one-trip" });

    await assert.rejects(
        service.verifyPayment({
            userId: "user-1",
            orderId: "order_test_123",
            paymentId: "pay_test_123",
            signature: "f".repeat(64),
        }),
        { statusCode: 400 }
    );
    assert.equal(user.tripCredits, 0);
});

test("rejects uncaptured or amount-mismatched gateway payments", async () => {
    const { service, user, fetchedPayments } = createFixture();
    await service.createOrder({ userId: "user-1", packageKey: "one-trip" });
    fetchedPayments.set("pay_test_123", {
        order_id: "order_test_123",
        status: "authorized",
        amount: 8900,
        currency: "INR",
    });

    await assert.rejects(
        service.verifyPayment({
            userId: "user-1",
            orderId: "order_test_123",
            paymentId: "pay_test_123",
            signature: makeSignature("order_test_123", "pay_test_123"),
        }),
        { statusCode: 400 }
    );
    assert.equal(user.tripCredits, 0);
});

test("consumes one free trip before paid credits and rejects exhausted accounts", async () => {
    const { service, user } = createFixture();

    const freeTrip = await service.consumeTripCredit("user-1");
    assert.equal(freeTrip.type, "free");
    assert.equal(user.freeTripUsed, true);

    user.tripCredits = 1;
    const creditedTrip = await service.consumeTripCredit("user-1");
    assert.equal(creditedTrip.type, "credit");
    assert.equal(user.tripCredits, 0);

    await assert.rejects(service.consumeTripCredit("user-1"), { statusCode: 402 });

    await service.refundTripCredit("user-1", creditedTrip);
    assert.equal(user.tripCredits, 1);
});
