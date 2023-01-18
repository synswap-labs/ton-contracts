import {
  Address,
  beginCell,
  toNano,
  TransactionComputeVm,
  TransactionDescriptionGeneric,
} from "ton";
import { ContractExecutor, ContractSystem, Treasure } from "ton-emulator";
import { createBridge, getBalance } from "./helpers";
import chai, { expect } from "chai";
import BN from "bn.js";
import chaiBn from "chai-bn";

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
    bridge = await createBridge(system, oracleTreasure);
  });

  it("should lock TONs and emit log message", async () => {
    const destinationAddress = 0x142d6db735cdb50bfc6ec65f94830320c6c7a245n;
    const destinationChainId = 1;
    const value = toNano(2);

    const body = beginCell()
      .storeUint(destinationAddress, 160)
      .storeUint(destinationChainId, 32)
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
    const logDestinationChainId = cs.loadUint(32);
    const logFromAddressHash = cs.loadUintBig(256).toString(16);
    const logFromAddress = Address.parseRaw(
      bridge.address.workChain + ":" + logFromAddressHash
    );
    const logMsgValue = cs.loadUintBig(64);

    expect(logDestinationAddress).to.be.equal(destinationAddress.toString(16));
    expect(logDestinationChainId).to.be.equal(destinationChainId);
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
      .storeUint(value, 64)
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
    const feeValue = 10000000n;

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
});
