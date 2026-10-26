const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const CreditPackage = require("../models/CreditPackage");
const { updateCreditPackage } = require("./paymentController");

const originalFindByIdAndUpdate = CreditPackage.findByIdAndUpdate;

afterEach(() => {
    CreditPackage.findByIdAndUpdate = originalFindByIdAndUpdate;
});

const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

test("admin package price update accepts integer paise and validates before writing", async () => {
    const update = {
        _id: "package-1",
        amountPaise: 9900,
        active: true,
    };
    CreditPackage.findByIdAndUpdate = async (_id, changes) => ({
        ...update,
        amountPaise: changes.$set.amountPaise,
    });
    const response = makeResponse();

    await updateCreditPackage({ params: { id: "package-1" }, body: { amountPaise: 9900 } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.package.amountPaise, 9900);
});

test("admin package price update rejects invalid prices", async () => {
    CreditPackage.findByIdAndUpdate = async () => {
        throw new Error("Database should not be written for an invalid price.");
    };
    const response = makeResponse();

    await updateCreditPackage({ params: { id: "package-1" }, body: { amountPaise: 89.5 } }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /price must be between/i);
});
