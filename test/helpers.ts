import { compileFunc } from "@ton-community/func-js";
import { ContractExecutor, ContractSystem } from "ton-emulator";
import { Treasure } from "ton-emulator/dist/treasure/Treasure";
import { readFileSync } from "fs";
import { beginCell, Cell, toNano } from "ton";

type CompilationTargets = {
  [name: string]: string;
};

export const createBridge = async (
  system: ContractSystem,
  treasure: Treasure
): Promise<ContractExecutor> => {
  const targets: CompilationTargets = {
    "stdlib.fc": "func/stdlib.fc",
    "opcodes.fc": "func/opcodes.fc",
    "errors.fc": "func/errors.fc",
    "utils.fc": "func/utils.fc",
    "bridge.fc": "func/bridge.fc",
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

  const code = Cell.fromBoc(
    Buffer.from(compilationResult.codeBoc, "base64")
  )[0];
  const data = beginCell().endCell();
  const contract = await ContractExecutor.create(
    { code, data, balance: BigInt(0) },
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
  contract: ContractExecutor
): Promise<bigint> => {
  return (await system.provider(contract).getState()).balance;
};