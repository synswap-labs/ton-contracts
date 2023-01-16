import { beginCell, toNano } from "ton";
import { ContractExecutor, ContractSystem, Treasure } from "ton-emulator";
import { createBridge } from "./helpers";
import { expect } from "chai";

describe("Test wrapping bridge", () => {
  let system: ContractSystem;
  let treasure: Treasure;
  let bridge: ContractExecutor;

  before(async () => {
    system = await ContractSystem.create();
    treasure = system.treasure("random-treasure");
    bridge = await createBridge(system, treasure);
  });

  it("should lock TONs and emit log message", async () => {
    const destinationAddress = 0x142d6db735cdb50bfc6ec65f94830320c6c7a245n;
    const destinationChainId = 1;

    const body = beginCell()
      .storeUint(destinationAddress, 160)
      .storeUint(destinationChainId, 8)
      .endCell()
      .beginParse();

    await treasure.send({
      sendMode: 0,
      to: bridge.address,
      value: toNano(1),
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
    const logDestinationChainId = cs.loadUint(8);

    expect(logDestinationAddress).to.be.equal(destinationAddress.toString(16));
    expect(logDestinationChainId).to.be.equal(destinationChainId);
  });
});
