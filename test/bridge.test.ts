import {
  Address,
  beginCell,
  Cell,
  Dictionary,
  toNano,
  TransactionComputeVm,
  TransactionDescriptionGeneric,
  TupleItemCell,
} from "ton";
import { ContractExecutor, ContractSystem, Treasure } from "ton-emulator";
import {
  buildTokenMetadataCell,
  deployBridge,
  deployJettonMinter,
  getBalance,
  sha256,
} from "./helpers";
import chai, { expect } from "chai";
import BN from "bn.js";
import chaiBn from "chai-bn";
import { inspect } from "util";

chai.use(chaiBn(BN));

describe("Test wrapped swap", () => {
  let system: ContractSystem;
  let treasure: Treasure;
  let oracleTreasure: Treasure;
  let bridge: ContractExecutor;

  before(async () => {
    system = await ContractSystem.create();
    treasure = system.treasure("random-treasure");
    oracleTreasure = system.treasure("oracle-treasure");
    bridge = await deployBridge(system, oracleTreasure);
  });

  it("checks bridge data", async () => {
    const bridgeData = await bridge.get("get_bridge_data");
    expect(bridgeData.success).to.be.true;

    if (bridgeData.success) {
      expect(bridgeData.stack.readNumber()).to.be.equal(0); // admin address workchain
      expect(bridgeData.stack.readBigNumber().toString(16)).to.be.equal(
        oracleTreasure.address.hash.toString("hex")
      ); // admin address hash

      // Check that oracle was added to the bridge.
      expect(
        bridgeData.stack
          .readCell()
          .beginParse()
          .loadDictDirect(
            Dictionary.Keys.Buffer(32),
            Dictionary.Values.Dictionary(
              Dictionary.Keys.Uint(32),
              Dictionary.Values.BigUint(160)
            )
          )
          .has(oracleTreasure.address.hash)
      ).to.be.true;

      expect(bridgeData.stack.pop().type).to.be.equal("null"); // empty jettons dict
      expect(bridgeData.stack.pop().type).to.be.equal("cell"); // jetton minter code
      expect(bridgeData.stack.pop().type).to.be.equal("cell"); // jetton wallet code
    }
  });

  it("should lock TONs and emit log message", async () => {
    const destinationAddress = 0x142d6db735cdb50bfc6ec65f94830320c6c7a245n;
    const destinationCoinId = 1;
    const value = toNano(2);

    const body = beginCell()
      .storeUint(destinationAddress, 160)
      .storeUint(destinationCoinId, 32)
      .endCell()
      .beginParse();

    await treasure.send({
      sendMode: 1,
      to: bridge.address,
      value: value,
      body: beginCell()
        .storeUint(1, 32) // op
        .storeUint(111, 64) // query id
        .storeSlice(body)
        .endCell(),
      bounce: true,
    });
    let txs = await system.run();

    let resp = txs[txs.length - 1].outMessages;
    let cs = resp.get(0)?.body.beginParse()!;

    const logDestinationAddress = cs.loadUintBig(160).toString(16);
    const logDestinationCoinId = cs.loadUint(32);
    const logFromAddressHash = cs.loadUintBig(256).toString(16);
    const logFromAddress = Address.parseRaw(
      bridge.address.workChain + ":" + logFromAddressHash
    );
    const logMsgValue = cs.loadCoins();

    expect(logDestinationAddress).to.be.equal(destinationAddress.toString(16));
    expect(logDestinationCoinId).to.be.equal(destinationCoinId);
    expect(logFromAddress.equals(treasure.address)).to.be.true;
    expect(logMsgValue).to.be.equal(value);
  });

  it("should unlock TONs to destination address", async () => {
    const destinationAddress = treasure.address;
    const value = toNano(2);
    const oldBalance = await getBalance(system, treasure);
    const feeValue = 10000000n;

    const body = beginCell()
      .storeAddress(destinationAddress)
      .storeCoins(value)
      .endCell()
      .beginParse();

    await oracleTreasure.send({
      sendMode: 0,
      to: bridge.address,
      value: feeValue,
      body: beginCell()
        .storeUint(2, 32) // op
        .storeUint(111, 64) // query id
        .storeSlice(body)
        .endCell(),
      bounce: true,
    });
    let txs = await system.run();

    expect(
      txs.filter(
        (tx) =>
          (tx.description as any).aborted !== undefined &&
          (tx.description as any).aborted === true
      ),
      "Some of transactions aborted"
    ).to.be.empty;

    let newBalance = await getBalance(system, treasure);

    // TODO: calculate exact value with fees and compare for equality.
    expect(newBalance.toString()).to.be.bignumber.greaterThan(
      oldBalance.toString()
    );
  });

  it("should fail to unlock TONs because of non oracle account", async () => {
    const destinationAddress = treasure.address;
    const value = toNano(2);
    const feeValue = 100000000n;

    const body = beginCell()
      .storeAddress(destinationAddress)
      .storeUint(value, 64)
      .endCell()
      .beginParse();

    // Send transaction from non oracle account.
    await treasure.send({
      sendMode: 0,
      to: bridge.address,
      value: feeValue,
      body: beginCell()
        .storeUint(2, 32) // op
        .storeUint(111, 64) // query id
        .storeSlice(body)
        .endCell(),
      bounce: false,
    });
    let txs = await system.run();

    expect(
      txs.filter(
        (tx) =>
          (tx.description as any).aborted !== undefined &&
          (tx.description as any).aborted === true
      ),
      "Transaction was not aborted"
    ).to.be.not.empty;

    let desc = txs[txs.length - 1].description as TransactionDescriptionGeneric;
    let computePhase = desc.computePhase as TransactionComputeVm;

    // 402 exit code - the sender is not an oracle.
    expect(computePhase.exitCode).to.be.equal(402);
  });

  it("should add new jetton to bridge", async () => {
    const jettonCoinId = 1729;
    const metadata = buildTokenMetadataCell({
      name: "Wrapped TZS",
      symbol: "bTZS",
      image: "https://example.com/image.png",
      description: "some description for the test jetton",
    });
    const feeValue = toNano(1);

    const jetton = await deployJettonMinter(
      system,
      oracleTreasure,
      bridge.address,
      metadata
    );

    const body = beginCell()
      .storeUint(jettonCoinId, 32)
      .storeAddress(jetton.address)
      .endCell()
      .beginParse();

    await oracleTreasure.send({
      sendMode: 0,
      to: bridge.address,
      value: feeValue,
      body: beginCell()
        .storeUint(3, 32) // op
        .storeUint(111, 64) // query id
        .storeSlice(body)
        .endCell(),
      bounce: false,
    });

    let txs = await system.run();

    expect(
      txs.filter(
        (tx) =>
          (tx.description as any).aborted !== undefined &&
          (tx.description as any).aborted === true
      ),
      "Some of transactions aborted"
    ).to.be.empty;

    const bridgeData = await bridge.get("get_bridge_data");
    expect(bridgeData.success).to.be.true;

    if (bridgeData.success) {
      bridgeData.stack.skip(); // skip admin address wc
      bridgeData.stack.skip(); // skip admin address hash
      bridgeData.stack.skip(); // skip oracles

      const jettonsDictCell = bridgeData.stack.pop();

      // TODO: c4 is not updated for some reason. A bug in ton-emulator?

      expect(jettonsDictCell.type).to.be.equal("cell");

      const jettonsDict = (jettonsDictCell as TupleItemCell).cell
        .beginParse()
        .loadDictDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Address());

      expect(jettonsDict.get(jettonCoinId)).to.be.equal(jetton.address);
    }
  });

  it("should mint jetton to destination address", async () => {
    const destinationAddress = treasure.address;
    const jettonCoinId = 1;
    const jettonAmount = 1000n;
    const feeValue = toNano(1);

    const body = beginCell()
      .storeAddress(destinationAddress)
      .storeUint(jettonCoinId, 32)
      .storeCoins(jettonAmount)
      .endCell()
      .beginParse();

    await oracleTreasure.send({
      sendMode: 0,
      to: bridge.address,
      value: feeValue,
      body: beginCell()
        .storeUint(21, 32) // op
        .storeUint(111, 64) // query id
        .storeSlice(body)
        .endCell(),
      bounce: false,
    });

    let txs = await system.run();

    expect(
      txs.filter(
        (tx) =>
          (tx.description as any).aborted !== undefined &&
          (tx.description as any).aborted === true
      ),
      "Some of transactions aborted"
    ).to.be.empty;
  });
});
