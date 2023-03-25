import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    toNano,
} from 'ton-core';
import fs from 'fs';

const walletJSON = JSON.parse(fs.readFileSync('./build/JettonWallet.compiled.json').toString());

export class JettonWallet implements Contract {
    static readonly code = Cell.fromBoc(Buffer.from(walletJSON.hex, 'hex'))[0];

    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonWallet(address);
    }

    static calculateAddress = (ownerAddr: Address, masterAddr: Address): Address => {
        let data = beginCell()
            .storeCoins(0)
            .storeAddress(ownerAddr)
            .storeAddress(masterAddr)
            .storeRef(JettonWallet.code)
            .endCell();
        let init = { code: JettonWallet.code, data };

        return contractAddress(0, init);
    };

    async sendBurn(
        provider: ContractProvider,
        via: Sender,
        params: {
            value?: bigint;
            amount: bigint;
            coinId: number;
            destAddr: bigint;
        }
    ) {
        let payload = Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
        payload.set(0x4fe560c1, beginCell().storeUint(params.destAddr, 160).endCell());
        payload.set(0x53c2ce98, beginCell().storeUint(params.coinId, 32).endCell());

        const body = beginCell().storeCoins(params.amount).storeAddress(null).storeDict(payload).endCell().beginParse();

        await provider.internal(via, {
            value: params.value ?? toNano('0.5'),
            body: beginCell()
                .storeUint(0x595f07bc, 32) // op
                .storeUint(0, 64) // query id
                .storeSlice(body)
                .endCell(),
        });
    }
}
