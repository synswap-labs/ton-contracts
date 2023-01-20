import { compileFunc } from "@ton-community/func-js";
import { ContractExecutor, ContractSystem } from "ton-emulator";
import { Treasure } from "ton-emulator/dist/treasure/Treasure";
import { readFileSync } from "fs";
import { beginCell, Cell, Contract, Dictionary, toNano } from "ton";

type CompilationTargets = {
  [name: string]: string;
};

type JettonContractsData = {
  minter: Cell;
  wallet: Cell;
};

export const createJettonContracts = async (): Promise<JettonContractsData> => {
  // Compile jetton minter contract.
  const minter_targets: CompilationTargets = {
    "stdlib.fc": "func/wrapped-swap/stdlib.fc",
    "opcodes.fc": "func/wrapped-swap/opcodes.fc",
    "utils.fc": "func/wrapped-swap/utils.fc",
    "params.fc": "func/wrapped-swap/params.fc",
    "jetton-minter.fc": "func/wrapped-swap/jetton-minter.fc",
  };

  const minterResult = await compileFunc({
    targets: Object.keys(minter_targets),
    sources: Object.keys(minter_targets).reduce(
      (a, v) => ({ ...a, [v]: readFileSync(minter_targets[v]).toString() }),
      {}
    ),
  });

  if (minterResult.status === "error") {
    throw new Error(minterResult.message);
  }

  const jetton_minter_code = Cell.fromBoc(
    Buffer.from(minterResult.codeBoc, "base64")
  )[0];

  // Compile jetton wallet contract.
  const wallet_targets: CompilationTargets = {
    "stdlib.fc": "func/wrapped-swap/stdlib.fc",
    "opcodes.fc": "func/wrapped-swap/opcodes.fc",
    "utils.fc": "func/wrapped-swap/utils.fc",
    "params.fc": "func/wrapped-swap/params.fc",
    "jetton-minter.fc": "func/wrapped-swap/jetton-minter.fc",
  };

  const walletResult = await compileFunc({
    targets: Object.keys(wallet_targets),
    sources: Object.keys(wallet_targets).reduce(
      (a, v) => ({ ...a, [v]: readFileSync(wallet_targets[v]).toString() }),
      {}
    ),
  });

  if (walletResult.status === "error") {
    throw new Error(walletResult.message);
  }

  const jetton_wallet_code = Cell.fromBoc(
    Buffer.from(walletResult.codeBoc, "base64")
  )[0];

  return {
    minter: jetton_minter_code,
    wallet: jetton_wallet_code,
  };
};

export const createBridge = async (
  system: ContractSystem,
  treasure: Treasure
): Promise<ContractExecutor> => {
  const jettonData = await createJettonContracts();

  const targets: CompilationTargets = {
    "stdlib.fc": "func/wrapped-swap/stdlib.fc",
    "opcodes.fc": "func/wrapped-swap/opcodes.fc",
    "errors.fc": "func/wrapped-swap/errors.fc",
    "utils.fc": "func/wrapped-swap/utils.fc",
    "params.fc": "func/wrapped-swap/params.fc",
    "bridge.fc": "func/wrapped-swap/bridge.fc",
  };

  const compilationResult = await compileFunc({
    targets: Object.keys(targets),
    sources: Object.keys(targets).reduce(
      (a, v) => ({ ...a, [v]: readFileSync(targets[v]).toString() }),
      {}
    ),
  });

  if (compilationResult.status === "error") {
    throw new Error(compilationResult.message);
  }

  // Set treasure public key as oracle.
  const oracles_dict = Dictionary.empty(
    Dictionary.Keys.Buffer(32),
    Dictionary.Values.Dictionary(
      Dictionary.Keys.Uint(8),
      Dictionary.Values.BigUint(160)
    )
  );
  oracles_dict.set(treasure.address.hash, Dictionary.empty()); // Value should store chain_id -> pubkey dict in future.

  const jettons_dict = Dictionary.empty(
    Dictionary.Keys.Uint(32), // chain_id
    Dictionary.Values.Address() // address
  );

  const bridge_code = Cell.fromBoc(
    Buffer.from(compilationResult.codeBoc, "base64")
  )[0];

  const data = beginCell()
    .storeAddress(treasure.address) // admin address
    .storeDict(oracles_dict) // dict of oracles
    .storeDict(jettons_dict) // dict with jettons info
    .storeRef(jettonData.minter) // jetton minter code
    .storeRef(jettonData.wallet) // jetton wallet code
    .endCell();

  const contract = await ContractExecutor.create(
    { code: bridge_code, data, balance: BigInt(10) },
    system
  );

  await treasure.send({
    sendMode: 0,
    to: contract.address,
    value: toNano(10),
    init: { code: bridge_code, data },
    body: beginCell().endCell(),
    bounce: false,
  });
  await system.run();

  return contract;
};

export const getBalance = async (
  system: ContractSystem,
  contract: Contract
): Promise<bigint> => {
  return (await system.provider(contract).getState()).balance;
};
