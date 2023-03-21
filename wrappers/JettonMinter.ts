import { Address, beginCell, Cell, contractAddress } from 'ton-core';
import fs from 'fs';
import { JettonWallet } from './JettonWallet';

const minterJSON = JSON.parse(fs.readFileSync('./build/JettonMinter.compiled.json').toString());

export class JettonMinter {
    static readonly code = Cell.fromBoc(Buffer.from(minterJSON.hex, 'hex'))[0];

    static calculateAddress = (totalSupply: number, adminAddr: Address, content: Cell): Address => {
        let data = beginCell()
            .storeCoins(totalSupply)
            .storeAddress(adminAddr)
            .storeRef(content)
            .storeRef(JettonWallet.code)
            .endCell();
        let init = { code: JettonMinter.code, data };

        return contractAddress(0, init);
    };
}
