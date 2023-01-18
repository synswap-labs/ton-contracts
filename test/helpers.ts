import { compileFunc } from "@ton-community/func-js";
import { ContractExecutor, ContractSystem } from "ton-emulator";
import { Treasure } from "ton-emulator/dist/treasure/Treasure";
import { readFileSync } from "fs";
import {
  beginCell,
  Cell,
  Contract,
  Dictionary,
  DictionaryKeyTypes,
  toNano,
} from "ton";

type CompilationTargets = {
  [name: string]: string;
};

export const createBridge = async (
  system: ContractSystem,
  treasure: Treasure
): Promise<ContractExecutor> => {
  const targets: CompilationTargets = {
    "stdlib.fc": "func/wrapped-swap/stdlib.fc",
    "opcodes.fc": "func/wrapped-swap/opcodes.fc",
    "errors.fc": "func/wrapped-swap/errors.fc",
    "utils.fc": "func/wrapped-swap/utils.fc",
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

  const code = Cell.fromBoc(
    Buffer.from(compilationResult.codeBoc, "base64")
  )[0];
  const data = beginCell().storeDict(oracles_dict).endCell();
  const contract = await ContractExecutor.create(
    { code, data, balance: BigInt(10) },
    system
  );

  await treasure.send({
    sendMode: 0,
    to: contract.address,
    value: toNano(10),
    init: { code, data },
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
