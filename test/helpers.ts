import { compileFunc } from "@ton-community/func-js";
import { ContractExecutor, ContractSystem } from "ton-emulator";
import { Treasure } from "ton-emulator/dist/treasure/Treasure";
import { readFileSync } from "fs";
import { Address, beginCell, Cell, Contract, Dictionary, toNano } from "ton";
import { Sha256 } from "@aws-crypto/sha256-js";
import { inspect } from "util";

type CompilationTargets = {
  [name: string]: string;
};

type JettonContractsData = {
  minter: Cell;
  wallet: Cell;
};

export type JettonMetaDataKeys = "name" | "description" | "image" | "symbol";

const jettonOnChainMetadataSpec: {
  [key in JettonMetaDataKeys]: "utf8" | "ascii" | undefined;
} = {
  name: "utf8",
  description: "utf8",
  image: "ascii",
  symbol: "utf8",
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
    "jetton-wallet.fc": "func/wrapped-swap/jetton-wallet.fc",
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

export const deployJettonMinter = async (
  system: ContractSystem,
  treasure: Treasure,
  adminAddress: Address,
  metadata: Cell
): Promise<ContractExecutor> => {
  const jettonData = await createJettonContracts();

  const data = beginCell()
    .storeCoins(0)
    .storeAddress(adminAddress) // admin address
    .storeRef(metadata)
    .storeRef(jettonData.wallet)
    .endCell();

  const contract = await ContractExecutor.create(
    { code: jettonData.minter, data, balance: BigInt(10) },
    system
  );

  await treasure.send({
    sendMode: 0,
    to: contract.address,
    value: toNano(10),
    init: { code: jettonData.minter, data },
    body: beginCell().endCell(),
    bounce: false,
  });
  await system.run();

  return contract;
};

export const deployBridge = async (
  system: ContractSystem,
  treasure: Treasure
): Promise<ContractExecutor> => {
  const jettonCode = await createJettonContracts();

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
      Dictionary.Keys.Uint(32),
      Dictionary.Values.BigUint(160)
    )
  );
  oracles_dict.set(treasure.address.hash, Dictionary.empty()); // Value should store coin_id -> pubkey dict in future.

  const jettons_dict = Dictionary.empty(
    Dictionary.Keys.Uint(32), // coin_id
    Dictionary.Values.Address() // address
  );

  const bridge_code = Cell.fromBoc(
    Buffer.from(compilationResult.codeBoc, "base64")
  )[0];

  const data = beginCell()
    .storeAddress(treasure.address) // admin address
    .storeDict(oracles_dict) // dict of oracles
    .storeDict(jettons_dict) // dict with jettons info
    .storeRef(jettonCode.minter) // jetton minter code
    .storeRef(jettonCode.wallet) // jetton wallet code
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

const ONCHAIN_CONTENT_PREFIX = 0x00;
const SNAKE_PREFIX = 0x00;

export const buildTokenMetadataCell = (data: {
  [s: string]: string | undefined;
}): Cell => {
  const CELL_CAPACITY = 1023;
  const PREFIX_SIZE = 8;
  const CELL_MAX_SIZE_BYTES = Math.floor((CELL_CAPACITY - PREFIX_SIZE) / 8);
  const KEYLEN = 256;
  const dict = Dictionary.empty(
    Dictionary.Keys.Buffer(KEYLEN / 8),
    Dictionary.Values.Cell()
  );

  Object.entries(data).forEach(([k, v]: [string, string | undefined]) => {
    if (!jettonOnChainMetadataSpec[k as JettonMetaDataKeys])
      throw new Error(`Unsupported onchain key: ${k}`);
    if (v === undefined || v === "") return;

    let bufferToStore = Buffer.from(
      v,
      jettonOnChainMetadataSpec[k as JettonMetaDataKeys]
    );

    const rootCell = beginCell();
    rootCell.storeUint(SNAKE_PREFIX, PREFIX_SIZE);
    let currentCell = rootCell;

    while (bufferToStore.length > 0) {
      currentCell.storeBuffer(bufferToStore.subarray(0, CELL_MAX_SIZE_BYTES));
      bufferToStore = bufferToStore.subarray(CELL_MAX_SIZE_BYTES);
      if (bufferToStore.length > 0) {
        let newCell = beginCell();
        currentCell.storeRef(newCell);
        currentCell = newCell;
      }
    }

    dict.set(sha256(k), rootCell.endCell());
  });

  return beginCell()
    .storeInt(ONCHAIN_CONTENT_PREFIX, PREFIX_SIZE)
    .storeDict(dict)
    .endCell();
};

export const sha256 = (str: string) => {
  const sha = new Sha256();
  sha.update(str);
  return Buffer.from(sha.digestSync());
};
