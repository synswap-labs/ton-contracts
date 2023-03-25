import { Address, beginCell, Cell, contractAddress } from 'ton-core';
import fs from 'fs';

const walletJSON = JSON.parse(fs.readFileSync('./build/JettonWallet.compiled.json').toString());

export class JettonWallet {
    static readonly code = Cell.fromBoc(Buffer.from(walletJSON.hex, 'hex'))[0];

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
}
