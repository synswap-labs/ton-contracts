import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
    toNano,
} from 'ton-core';
import fs from 'fs';

const bridgeJSON = JSON.parse(fs.readFileSync('./build/Bridge.compiled.json').toString());

export class Bridge implements Contract {
    static readonly code = Cell.fromBoc(Buffer.from(bridgeJSON.hex, 'hex'))[0];

    readonly address: Address;
    readonly init?: { code: Cell; data: Cell };

    constructor(
        workchain: number,
        initParams: {
            adminAddr: Address;
            oracleAddr: Address;
            feeAddr: Address;
            feeRate: number;
            jettonMinterCode: Cell;
            jettonWalletCode: Cell;
        }
    ) {
        const oraclesDict = Dictionary.empty(
            Dictionary.Keys.Buffer(32),
            Dictionary.Values.Dictionary(Dictionary.Keys.Uint(32), Dictionary.Values.BigUint(160))
        );
        oraclesDict.set(initParams.oracleAddr.hash, Dictionary.empty()); // Value should store coin_id -> pubkey dict in future.

        const jettonsDict = Dictionary.empty(
            Dictionary.Keys.Uint(32), // coin_id
            Dictionary.Values.Address() // address
        );

        const data = beginCell()
            .storeAddress(initParams.adminAddr) // admin address
            .storeDict(oraclesDict) // dict of oracles
            .storeDict(jettonsDict) // dict with jettons info
            .storeRef(initParams.jettonMinterCode) // jetton minter code
            .storeRef(initParams.jettonWalletCode) // jetton wallet code
            .endCell();

        this.init = { code: Bridge.code, data };
        this.address = contractAddress(workchain, this.init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendLock(
        provider: ContractProvider,
        via: Sender,
        params: {
            value?: bigint;
            destinationAddress: bigint;
            destinationCoinId: number;
        }
    ) {
        const body = beginCell()
            .storeUint(params.destinationAddress, 160)
            .storeUint(params.destinationCoinId, 32)
            .endCell()
            .beginParse();

        await provider.internal(via, {
            value: params.value ?? toNano('0.05'),
            body: beginCell()
                .storeUint(1, 32) // op
                .storeUint(0, 64) // query id
                .storeSlice(body)
                .endCell(),
        });
    }

    async sendUnlock(
        provider: ContractProvider,
        via: Sender,
        params: {
            value?: bigint;
            address: Address;
            amount: bigint;
        }
    ) {
        const body = beginCell().storeAddress(params.address).storeCoins(params.amount).endCell().beginParse();

        await provider.internal(via, {
            value: params.value ?? toNano('0.2'),
            bounce: true,
            sendMode: SendMode.NONE,
            body: beginCell()
                .storeUint(2, 32) // op
                .storeUint(0, 64) // query id
                .storeSlice(body)
                .endCell(),
        });
    }

    async sendAddJetton(
        provider: ContractProvider,
        via: Sender,
        params: {
            value?: bigint;
            coinId: number;
            data: Cell;
        }
    ) {
        const body = beginCell().storeUint(params.coinId, 32).storeRef(params.data).endCell().beginParse();

        await provider.internal(via, {
            value: params.value ?? toNano('0.5'),
            body: beginCell()
                .storeUint(3, 32) // op
                .storeUint(0, 64) // query id
                .storeSlice(body)
                .endCell(),
        });
    }

    async sendMintJetton(
        provider: ContractProvider,
        via: Sender,
        params: {
            value?: bigint;
            address: Address;
            coinId: number;
            amount: bigint;
            forwardAmount: bigint;
        }
    ) {
        const body = beginCell()
            .storeAddress(params.address)
            .storeUint(params.coinId, 32)
            .storeCoins(params.amount)
            .storeCoins(params.forwardAmount)
            .endCell()
            .beginParse();

        await provider.internal(via, {
            value: params.value ?? toNano('0.2'),
            body: beginCell()
                .storeUint(21, 32) // op
                .storeUint(0, 64) // query id
                .storeSlice(body)
                .endCell(),
        });
    }

    async getBridgeData(provider: ContractProvider) {
        const res = await provider.get('get_bridge_data', []);

        const workchain = res.stack.readNumber();
        const adminAddrHash = res.stack.readBigNumber();
        const oracles = res.stack
            .readCell()
            .beginParse()
            .loadDictDirect(
                Dictionary.Keys.Buffer(32),
                Dictionary.Values.Dictionary(Dictionary.Keys.Uint(32), Dictionary.Values.BigUint(160))
            );
        const jettons = res.stack.readCell().beginParse().loadDictDirect(
            Dictionary.Keys.Uint(32), // coin_id
            Dictionary.Values.Address() // address
        );

        return {
            workchain,
            adminAddrHash,
            oracles,
            jettons,
        };
    }

    async getBridgeDataStack(provider: ContractProvider) {
        const res = await provider.get('get_bridge_data', []);

        return res.stack;
    }

    async getJettonWalletAddress(provider: ContractProvider, coinId: number, ownerAddress: Address) {
        const res = await provider.get('get_jetton_wallet_address', [
            { type: 'int', value: BigInt(coinId) },
            { type: 'slice', cell: beginCell().storeAddress(ownerAddress).endCell() },
        ]);

        return res.stack.readAddress();
    }
}
